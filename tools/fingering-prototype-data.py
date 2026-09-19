"""Prepare isolated, matched producer artifacts for the layout feasibility review.

PYTHONPATH=../homr:worker .venv/bin/python tools/fingering-prototype-data.py
Existing packets are reused. No original/cache artifact or fixture lock is changed.
"""
import argparse
import json
from pathlib import Path
import shutil
import time

from homr.main import ProcessingConfig, process_image
from homr.music_xml_generator import XmlGeneratorArguments
from homr.visual_sidecar.annotation_geometry import validate_annotation_geometry
from sheet_music_worker.fingering_obstacles import page_ink_artifact

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--split", choices=["development", "held-out", "all"], default="development")
parser.add_argument("--id")
args = parser.parse_args()
manifest = json.loads((root / "plans/fingering-fixtures.json").read_text())
config = ProcessingConfig(enable_debug=False, enable_cache=False, write_staff_positions=False,
                          read_staff_positions=False, selected_staff=-1, transformer_use_gpu=False,
                          segnet_use_gpu=False, coreml_encoder=False, write_visual_sidecar=True)
for fixture in manifest["fixtures"]:
    if args.split != "all" and fixture["split"] != args.split or args.id and fixture["id"] != args.id:
        continue
    destination = root / "testdata/fingering-prototype" / fixture["id"]
    destination.mkdir(parents=True, exist_ok=True)
    if (destination / "packet.js").exists():
        print("Reusing", fixture["id"], flush=True)
        continue
    start = time.perf_counter()
    try:
        page = destination / "page.png"
        shutil.copyfile(root.parent / fixture["image"]["path"], page)
        generated = process_image(str(page), config, XmlGeneratorArguments())
        sidecar = json.loads(generated.visual_sidecar_path.read_text())
        validate_annotation_geometry(sidecar)
        if not sidecar.get("annotation_geometry"):
            raise ValueError(sidecar.get("annotation_geometry_error", "Annotation geometry unavailable"))
        sidecar["ink_obstacles"] = page_ink_artifact(page)
        packet = {"id": fixture["id"], "split": fixture["split"], "sidecar": sidecar,
                  "musicXml": generated.musicxml_path.read_text(), "source": fixture["source"],
                  "recognition_seconds": round(time.perf_counter() - start, 3)}
        # Inline script JSON escapes '<' so MusicXML cannot terminate a script element.
        (destination / "packet.js").write_text("window.fingeringFixture=" + json.dumps(packet).replace("<", "\\u003c") + ";")
        (destination / "review.html").write_text('''<!doctype html><meta charset="utf-8">
<title>Fingering feasibility review</title><style>body{margin:0;background:white;font-family:Arial,sans-serif}#page{position:relative;width:100%}#page img{width:100%;display:block}#page svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#metrics{display:none}</style>
<div id="page"><img src="page.png"></div><pre id="metrics"></pre><script src="packet.js"></script><script src="../prototype.js"></script>''')
        print("PREPARED", fixture["id"], flush=True)
    except Exception as error:
        (destination / "failure.json").write_text(json.dumps({"id": fixture["id"], "error": str(error)}, indent=2))
        print("UNAVAILABLE", fixture["id"], str(error), flush=True)
