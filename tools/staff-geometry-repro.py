#!/usr/bin/env python3
"""Reproduce annotation-geometry outcomes through the real worker path.

A standalone HOMR call is not the thing that failed: the worker renders the page,
optionally resizes it for OMR, scales the sidecar back onto the displayed raster
and validates it again. This driver therefore runs ``PdfProcessor.process_pdf``
itself, into an isolated cache root, and reports what each page's optional
annotation geometry ended up as.

The source PDF and the application's own cache are only ever read.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "worker"))

from sheet_music_worker.processor import PdfProcessor, sha256_file  # noqa: E402


def geometry_outcome(sidecar: dict[str, Any]) -> dict[str, Any]:
    geometry = sidecar.get("annotation_geometry")
    rejection = sidecar.get("annotation_geometry_rejection")
    outcome: dict[str, Any] = {
        "state": "supported" if geometry else "rejected" if rejection else "absent",
        "producer": sidecar.get("producer"),
        "source_image_size": sidecar.get("source_image_size"),
        "note_count": len(sidecar.get("notes", [])),
        "visual_group_count": len(sidecar.get("visual_groups", [])),
        "ink_obstacles": bool(sidecar.get("ink_obstacles")),
        "annotation_analysis_error": sidecar.get("annotation_analysis_error"),
        "annotation_geometry_error": sidecar.get("annotation_geometry_error"),
    }
    if rejection:
        outcome["rejection"] = rejection
    if geometry:
        outcome["staffs"] = [
            {
                "staff_id": staff["staff_id"],
                "system_index": staff["system_index"],
                "samples": len(staff["spacing"]),
                "extent": staff["extent"],
            }
            for staff in geometry["staffs"]
        ]
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="source PDF, opened read-only")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="directory for the isolated cache and the captured grids",
    )
    parser.add_argument(
        "--page", type=int, default=None, help="reprocess only this 1-based page"
    )
    parser.add_argument(
        "--fresh", action="store_true", help="delete the isolated cache before running"
    )
    arguments = parser.parse_args()

    output = arguments.output.resolve()
    if arguments.fresh and output.exists():
        shutil.rmtree(output)
    cache_root = output / "cache"
    capture_directory = output / "captures"
    cache_root.mkdir(parents=True, exist_ok=True)
    capture_directory.mkdir(parents=True, exist_ok=True)
    # Opt into the producer's pre-validation grid capture for this run only.
    os.environ["HOMR_ANNOTATION_GEOMETRY_CAPTURE_DIR"] = str(capture_directory)

    events: list[dict[str, Any]] = []
    processor = PdfProcessor(events.append)
    processor.process_pdf(
        job_id="staff-geometry-repro",
        pdf_path=arguments.pdf.resolve(),
        cache_root=cache_root,
        cancel=threading.Event(),
        force_page_index=None if arguments.page is None else arguments.page - 1,
    )

    pdf_sha = sha256_file(arguments.pdf.resolve())
    pages_directory = cache_root / "pdf-cache" / pdf_sha / "pages"
    report: dict[str, Any] = {
        "pdf": {"path": str(arguments.pdf), "sha256": pdf_sha},
        "events": events,
        "pages": {},
    }
    for path in sorted(pages_directory.glob("*.homr.visual.json")):
        sidecar = json.loads(path.read_text(encoding="utf-8"))
        report["pages"][path.name] = {
            "sidecar_sha256": sha256_file(path),
            **geometry_outcome(sidecar),
        }
    report["captures"] = sorted(p.name for p in capture_directory.glob("*.json"))

    report_path = output / "repro-report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({name: page["state"] for name, page in report["pages"].items()}, indent=2))
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
