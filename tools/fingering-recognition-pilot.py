"""Read-only, offline OCR experiment. No application integration or model training.

Run with the viewer .venv Python. --prepare-only renders the annotation review.
Coordinates in the manifest use a 1300-pixel page width, independent of source DPI.
"""
import argparse
import hashlib
import html
import importlib.metadata
import json
import math
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def packet(path):
    text = path.read_text()
    return json.loads(text.removeprefix("window.fingeringFixture=").removesuffix(";"))


def iou(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    return intersection / union if union else 0


def match(predictions, gold):
    """Deterministic, one-to-one greedy IoU >= .1; merged boxes cannot count twice."""
    edges = sorted(((-iou(p["box"], g["box"]), pi, gi)
                    for pi, p in enumerate(predictions) for gi, g in enumerate(gold)
                    if iou(p["box"], g["box"]) >= .1))
    used_p, used_g, pairs = set(), set(), []
    for _, pi, gi in edges:
        if pi not in used_p and gi not in used_g:
            used_p.add(pi)
            used_g.add(gi)
            pairs.append((pi, gi))
    return pairs


def metrics(correct, proposed, total):
    return {"correct": correct, "proposed": proposed, "gold": total,
            "precision": round(correct / proposed, 4) if proposed else None,
            "recall": round(correct / total, 4) if total else None}


def pdf_words(path, coordinate_width):
    # Poppler may emit literal control characters: this is NOT well-formed XML.
    raw = subprocess.run(["pdftotext", "-f", "1", "-l", "1", "-bbox", str(path), "-"],
                         check=True, capture_output=True, text=True).stdout
    width = float(re.search(r'<page width="([\d.]+)"', raw)[1])
    result = []
    for attrs, value in re.findall(r"<word ([^>]+)>(.*?)</word>", raw, re.S):
        values = dict(re.findall(r'(\w+)="([^"]+)"', attrs))
        result.append({"text": html.unescape(value), "box": [float(values[k]) * coordinate_width / width
                       for k in ("xMin", "yMin", "xMax", "yMax")]})
    return result


def notes_for(data, width, all_staffs=False):
    sidecar = data["sidecar"]
    scale = width / sidecar["source_image_size"][0]
    # Research baseline is explicitly restricted to the first upper staff.
    return [{"id": g["musicxml_id"], "center": [v * scale for v in g["center"]]}
            for g in sidecar["visual_groups"] if g.get("musicxml_id")
            and g.get("visual_status") == "canonical"
            and (all_staffs or g["staff_group_index"] == 0 and g["staff_index"] == 0)]


def associate(box, notes, conservative=False):
    x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    candidates = [n for n in notes if abs(n["center"][0] - x) <= 6
                  and 0 < n["center"][1] - y <= 70]
    if not candidates or conservative and len(candidates) != 1:
        return None
    return min(candidates, key=lambda n: (math.dist((x, y), n["center"]), n["id"]))["id"]


def ocr_rows(output, bounds, scale):
    if output.boxes is None:
        return []
    return [{"box": [float(min(p[0] for p in box)) / scale + bounds[0],
                     float(min(p[1] for p in box)) / scale + bounds[1],
                     float(max(p[0] for p in box)) / scale + bounds[0],
                     float(max(p[1] for p in box)) / scale + bounds[1]],
             "text": str(text), "score": round(float(score), 5)}
            for box, text, score in zip(output.boxes, output.txts, output.scores)]


def summarize(rows, field):
    counts = {"location": 0, "value": 0, "assignment": 0, "proposed": 0, "gold": 0}
    for row in rows:
        predictions, gold = row[field], row["gold"]
        pairs = match(predictions, gold)
        counts["proposed"] += len(predictions)
        counts["gold"] += len(gold)
        counts["location"] += len(pairs)
        for pi, gi in pairs:
            p, g = predictions[pi], gold[gi]
            counts["value"] += p["text"] == g["digit"]
            counts["assignment"] += (g["note"] is not None and
                                     p["text"] == g["digit"] and p.get("note") == g["note"])
    return {key: metrics(counts[key], counts["proposed"], counts["gold"])
            for key in ("location", "value", "assignment")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--manifest", type=Path, default=ROOT / "plans/fingering-recognition-pilot.json")
    parser.add_argument("--artifact-dir", type=Path, default=ROOT / "testdata/fingering-recognition")
    parser.add_argument("--pdf-root", type=Path, default=Path.home() / "Documents/sheet-music/Classical")
    parser.add_argument("--output", type=Path, default=ROOT / "testdata/fingering-recognition/results.json")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    width = manifest["coordinate_width"]
    out = args.artifact_dir
    out.mkdir(parents=True, exist_ok=True)
    pages = {}
    for key, spec in manifest["pages"].items():
        directory = ROOT / "testdata/fingering-prototype" / key
        image_path = ROOT / spec["image"] if "image" in spec else directory / "page.png"
        assert hashlib.sha256(image_path.read_bytes()).hexdigest() == spec["image_sha256"], key
        source = Image.open(image_path).convert("RGB")
        data, packet_hash = None, None
        if "sidecar" in spec:
            for field in ("sidecar", "musicxml"):
                assert hashlib.sha256((ROOT / spec[field]).read_bytes()).hexdigest() == spec[f"{field}_sha256"], field
            data = {"sidecar": json.loads((ROOT / spec["sidecar"]).read_text()),
                    "musicXml": (ROOT / spec["musicxml"]).read_text()}
        elif not spec.get("negative_only"):
            packet_hash = hashlib.sha256((directory / "packet.js").read_bytes()).hexdigest()
            assert packet_hash == spec["packet_sha256"], f"Changed note identities: {key}"
            data = packet(directory / "packet.js")
        else:
            assert all(not w["gold"] for w in manifest["windows"] if w["page"] == key)
        pages[key] = {"image": source, "notes": notes_for(data, width, spec.get("all_staffs", False)) if data else [],
                      "data": data, "packet_sha256": packet_hash}
    tiles = []
    for window in manifest["windows"]:
        page = pages[window["page"]]
        scale = page["image"].width / width
        bounds = window["bounds"]
        crop = page["image"].crop(tuple(round(v * scale) for v in bounds))
        crop.save(out / f'{window["id"]}.png')
        marked = crop.copy()
        draw = ImageDraw.Draw(marked)
        for index, gold in enumerate(window["gold"]):
            if gold["note"] is None:
                assert gold.get("unavailable_reason"), "Missing links must remain explicit in the denominator"
            else:
                assert any(n["id"] == gold["note"] for n in page["notes"]), gold
            box = [(gold["box"][i] - bounds[i % 2]) * scale for i in range(4)]
            draw.rectangle(box, outline="red", width=1)
            draw.text((box[0], box[1] - 12), str(index + 1), fill="blue")
            target = next((n["center"] for n in page["notes"] if n["id"] == gold["note"]),
                          gold.get("printed_note_center"))
            if target:
                tx, ty = (target[0] - bounds[0]) * scale, (target[1] - bounds[1]) * scale
                color = "green" if gold["note"] is not None else "orange"
                draw.line(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, tx, ty), fill=color, width=1)
                draw.ellipse((tx - 3, ty - 3, tx + 3, ty + 3), outline=color, width=2)
        marked.save(out / f'{window["id"]}-gold.png')
        for index, gold in enumerate(window["gold"]):
            glyph = page["image"].crop(tuple(round(v * scale) for v in gold["box"]))
            tile = Image.new("RGB", (150, 100), "white")
            glyph.thumbnail((80, 65))
            glyph = glyph.resize((glyph.width * 2, glyph.height * 2))
            tile.paste(glyph, (5, 24))
            ImageDraw.Draw(tile).text((3, 3), f'{window["id"][:6]} {index + 1}: {gold["digit"]}', fill="black")
            tiles.append(tile)
    atlas = Image.new("RGB", (750, math.ceil(len(tiles) / 5) * 100), "#dddddd")
    for index, tile in enumerate(tiles):
        atlas.paste(tile, (index % 5 * 150, index // 5 * 100))
    atlas.save(out / "gold-atlas.png")
    if args.prepare_only:
        print(out)
        return

    # Use installed/cached models only: fail before RapidOCR can download anything.
    import rapidocr
    from rapidocr import RapidOCR
    model_root = Path(rapidocr.__file__).parent / "models"
    model_names = {"Det": "ch_PP-OCRv4_det_infer.onnx", "Rec": "ch_PP-OCRv4_rec_infer.onnx",
                   "Cls": "ch_ppocr_mobile_v2.0_cls_infer.onnx"}
    params = {"EngineConfig.onnxruntime.intra_op_num_threads": 1,
              "EngineConfig.onnxruntime.inter_op_num_threads": 1, "Global.log_level": "error"}
    hashes = {}
    for kind, name in model_names.items():
        path = model_root / name
        assert path.is_file(), f"Missing local model {path}; no download permitted by this script"
        params[f"{kind}.model_path"] = str(path)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    engine = RapidOCR(params=params)
    import numpy as np
    rows, oracle = [], []
    start = time.perf_counter()
    for key, page in pages.items():
        pdf = args.pdf_root / manifest["pages"][key]["pdf"]
        assert hashlib.sha256(pdf.read_bytes()).hexdigest() == manifest["pages"][key]["pdf_sha256"], key
        page["pdf_words"] = pdf_words(pdf, width)
    for window in manifest["windows"]:
        page = pages[window["page"]]
        scale = page["image"].width / width
        bounds = window["bounds"]
        crop = page["image"].crop(tuple(round(v * scale) for v in bounds))
        # RapidOCR persists per-call flags; reset detection after each oracle-crop call.
        raw = ocr_rows(engine(np.array(crop), use_det=True, use_rec=True,
                              use_cls=False, text_score=.5), bounds, scale)
        candidates = [dict(p) for p in raw if re.fullmatch("[1-5]", p["text"])]
        for p in candidates:
            p["note"] = associate(p["box"], page["notes"])
        words = [w for w in page["pdf_words"] if bounds[0] <= (w["box"][0] + w["box"][2]) / 2 < bounds[2]
                 and bounds[1] <= (w["box"][1] + w["box"][3]) / 2 < bounds[3]]
        pdf_digits = [dict(w, note=associate(w["box"], page["notes"]))
                      for w in words if re.fullmatch("[1-5]", w["text"])]
        rows.append({**window, "ocr_text": raw, "ocr_digits": candidates, "pdf_digits": pdf_digits,
                     "pdf_non_ascii_words": sum(any(ord(c) < 32 for c in w["text"]) for w in words)})
        for gold in window["gold"]:
            glyph = page["image"].crop(tuple(round(v * scale) for v in gold["box"]))
            # Oracle location, no detection. Reject non-single digits; no coercion of glyph codes.
            rec = engine(np.array(glyph), use_det=False, use_cls=False, use_rec=True)
            text = rec.txts[0] if rec.txts else ""
            score = float(rec.scores[0]) if rec.scores else 0
            oracle.append({"window": window["id"], **gold, "text": text, "score": round(score, 5),
                           "accepted": bool(re.fullmatch("[1-5]", text)) and score >= .5,
                           "nearest_note": associate(gold["box"], page["notes"]),
                           "unambiguous_note": associate(gold["box"], page["notes"], conservative=True)})
    accepted = [o for o in oracle if o["accepted"]]
    report = {"scope": manifest["scope"], "rapidocr_version": importlib.metadata.version("rapidocr"),
              "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
              "model_sha256": hashes, "seconds": round(time.perf_counter() - start, 3),
              "packet_sha256": {k: p["packet_sha256"] for k, p in pages.items()},
              "source_musicxml_fingering_counts": {k: len(ET.fromstring(p["data"]["musicXml"]).findall(".//fingering"))
                                                    for k, p in pages.items() if p["data"]},
              "ocr_text_proposals": summarize(rows, "ocr_text")["location"],
              "ocr_digit_candidates": summarize(rows, "ocr_digits"),
              "pdf_ascii_digit_candidates": summarize(rows, "pdf_digits"),
              "oracle_transcription": metrics(sum(o["text"] == o["digit"] for o in accepted), len(accepted), len(oracle)),
              "oracle_association": {key: metrics(sum(o["note"] is not None and o[key] == o["note"] for o in oracle),
                                                    sum(o[key] is not None for o in oracle), len(oracle))
                                     for key in ("nearest_note", "unambiguous_note")},
              "windows": rows, "oracle": oracle}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ("windows", "oracle")}, indent=2))


if __name__ == "__main__":
    main()
