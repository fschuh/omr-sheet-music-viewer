#!/usr/bin/env python3
"""Build browser review packets from a staff-geometry corpus run.

The layout review in `tools/fingering-render.mjs` reads a packet directory: a page
raster, a sidecar, the page MusicXML and a review page that draws the overlay and
the geometry debug view over the raster. `tools/fingering-prototype-data.py`
builds those for the fixture manifest; this builds them for any page of a corpus
run, which is how a repaired page gets looked at rather than only counted.

The review page derives its own cyclic fingering values from the page MusicXML,
because this reviews placement geometry and not model accuracy. Everything is
read from the corpus run and written under ignored testdata.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "worker"))

from sheet_music_worker.fingering_obstacles import page_ink_artifact  # noqa: E402

REVIEW_HTML = """<!doctype html><meta charset="utf-8">
<title>Staff geometry review</title><style>body{margin:0;background:white;font-family:Arial,sans-serif}\
#page{position:relative;width:100%}#page img{width:100%;display:block}\
#page svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}#metrics{display:none}</style>
<div id="page"><img src="page.png"></div><pre id="metrics"></pre>\
<script src="packet.js"></script><script src="../prototype.js"></script>"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="a corpus run directory")
    parser.add_argument("ids", nargs="+", help="corpus entry ids to prepare")
    parser.add_argument(
        "--output",
        type=Path,
        default=REPOSITORY_ROOT / "testdata" / "fingering-prototype",
        help="packet root, so the existing review tooling finds them",
    )
    arguments = parser.parse_args()

    corpus = json.loads(
        (REPOSITORY_ROOT / "plans" / "staff-geometry-corpus.json").read_text(encoding="utf-8")
    )
    entries = {entry["id"]: entry for entry in corpus["entries"]}
    for name in arguments.ids:
        entry = entries[name]
        pages = (
            arguments.run / name / "cache" / "pdf-cache" / entry["pdf_sha256"] / "pages"
        )
        stem = f"{entry['page']:04d}"
        sidecar = json.loads((pages / f"{stem}.homr.visual.json").read_text(encoding="utf-8"))
        destination = arguments.output / f"staff-geometry-{name}"
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pages / f"{stem}.png", destination / "page.png")
        if not sidecar.get("ink_obstacles"):
            sidecar["ink_obstacles"] = page_ink_artifact(destination / "page.png")
        packet = {
            "id": f"staff-geometry-{name}",
            "split": "staff-geometry",
            "sidecar": sidecar,
            "musicXml": (pages / f"{stem}.musicxml").read_text(encoding="utf-8"),
            "source": {"corpus_entry": name, "page": entry["page"], "role": entry["role"]},
            "repairs": sidecar.get("annotation_geometry_repairs"),
        }
        # Inline script JSON escapes '<' so MusicXML cannot terminate a script element.
        (destination / "packet.js").write_text(
            "window.fingeringFixture=" + json.dumps(packet).replace("<", "\\u003c") + ";",
            encoding="utf-8",
        )
        (destination / "review.html").write_text(REVIEW_HTML, encoding="utf-8")
        repairs = sidecar.get("annotation_geometry_repairs", {}).get("staffs", [])
        print(
            f"PREPARED staff-geometry-{name}: "
            f"{len(sidecar.get('annotation_geometry', {}).get('staffs', []))} staffs, "
            f"{sum(r['removed_count'] for r in repairs)} removed columns"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
