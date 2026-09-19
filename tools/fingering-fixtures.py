"""Snapshot/verify local overlay fixtures without copying privately held score scans.

Run from any directory: python3 tools/fingering-fixtures.py [--snapshot].
The snapshot is printed to stdout for review; verification never updates the lock.
"""

import hashlib
import json
from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
RUN = "omr-evals/runs/pitch-reference/baseline-multi-gpu-2/cases"
CASES = [
    ("flawless/bach-bwv846-prelude-in-c-major", 1, "development", "regular broken chords"),
    ("flawless/bach-bwv846-prelude-in-c-major", 3, "held-out", "chords and final system"),
    ("flawless/bach-bwv784-invention-no-13-in-a-minor", 1, "development", "dense independent beamed voices"),
    ("flawless/bach-bwv784-invention-no-13-in-a-minor", 2, "held-out", "dense continuation"),
    ("flawless/mozart-k545-piano-sonata-16-I-allegro", 1, "development", "ordinary classical notation and slurs"),
    ("flawless/mozart-k545-piano-sonata-16-I-allegro", 2, "held-out", "runs and ledger notes"),
    ("flawless/mozart-k545-piano-sonata-16-II-andante", 1, "development", "slow melody and accompaniment"),
    ("flawless/mozart-k545-piano-sonata-16-III-presto-rondo", 1, "held-out", "dense articulation"),
    ("slightly-flawed/beethoven-fur-elise", 1, "development", "ledger notes, clef changes, chords and repeats"),
    ("slightly-flawed/beethoven-fur-elise", 2, "held-out", "recognition and association challenge"),
    ("flawless/chrono-trigger-fanfare-1-luccas-theme", 1, "development", "short game arrangement"),
    ("slightly-flawed/super-mario-bros-ground-theme", 1, "development", "syncopation and chord stacks"),
]


def artifact(relative):
    data = (WORKSPACE / relative).read_bytes()
    return {"path": relative, "sha256": hashlib.sha256(data).hexdigest()}


def snapshot():
    fixtures = []
    unavailable = []
    selections = [(case, page, split, purpose, f"{RUN}/{case}/pages/page-{page:04}",
                   f"omr-evals/cases/{case}/source.pdf") for case, page, split, purpose in CASES]
    for number, suffix in [(9, " - Butterfly"), (2, ""), (6, ""), (7, ""), (12, "")]:
        source = Path.home() / f"Documents/sheet-music/Classical/Chopin - Etude 25 No {number}{suffix}.pdf"
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        base = Path.home() / f".cache/com.homr.sheetmusicviewer/pdf-cache/{digest}/pages/0001"
        if not base.with_suffix(".png").is_file():
            base = ROOT / "testdata/fingering" / digest / "0001"
        selections.append((f"chopin-25-{number}", 1, "held-out" if number in (7, 12) else "development",
                           "existing printed fingerings, dense chords and long slurs", str(base), str(source)))
    for case, page, split, purpose, base, source in selections:
        image = artifact(base + ".png")
        if case == "chopin-25-6":
            unavailable.append({"id": case, "source": artifact(source), "image": image,
                                "reason": "HOMR rejects vnote-246: physical staff 1, expected 0 (1920px CPU inference)",
                                "purpose": "printed digit/ink review only; no authoritative note alignment"})
            continue
        xml = artifact(base + ".musicxml")
        sidecar = artifact(base + ".homr.visual.json")
        data = json.loads((WORKSPACE / sidecar["path"]).read_text())
        png = (WORKSPACE / image["path"]).read_bytes()
        dimensions = list(struct.unpack(">II", png[16:24]))
        assert dimensions == data["source_image_size"], base
        notes = ET.parse(WORKSPACE / xml["path"]).findall(".//note")
        ids = [n.get("id") for n in notes if n.find("pitch") is not None]
        assert all(ids) and len(ids) == len(set(ids)), base
        assert set(ids) == {n["musicxml_id"] for n in data["notes"] if n["pitch"]}, base
        # Fixed test values, deliberately independent of model and editorial quality.
        # Include all pitched notes, even when they lack a usable visual link.
        values = {id_: 1 + i % 5 for i, id_ in enumerate(ids)}
        fixtures.append({
            "id": f"{case.split('/')[-1]}-{page}", "split": split,
            "purpose": purpose, "source": artifact(source),
            "rights": "Local evaluation only; edition/arrangement redistribution license not established. Do not copy source assets into this repository.",
            "image": image, "musicxml": xml, "sidecar": sidecar,
            "dimensions": dimensions, "fixed_layout_values": values,
        })
    return {"version": 1, "value_origin": "synthetic cyclic 1–5; layout-only, not model accuracy", "fixtures": fixtures,
            "unavailable_references": unavailable}


if __name__ == "__main__":
    current = snapshot()
    if "--snapshot" in sys.argv:
        print(json.dumps(current, indent=2, ensure_ascii=False))
    else:
        locked = json.loads((ROOT / "plans/fingering-fixtures.json").read_text())
        assert current == locked, "Fixture drift: review source, dimensions, IDs and hashes before replacing the lock"
        print(f"Verified {len(current['fixtures'])} fixture pages: hashes, PNG dimensions, MusicXML IDs and fixed values")
