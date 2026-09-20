#!/usr/bin/env python3
"""Compare two corpus runs and report exactly what the repair changed.

Recovery is only allowed to affect the optional annotation copy of the detected
grid. This tool checks that claim against the artifacts themselves: the page
MusicXML, the note records, the note-to-visual-group links and the recognition
contours must be byte-identical between the two runs, and the only differences
anywhere must be inside the annotation geometry, its repairs, its rejection and
the ink analysis that is conditional on it.

Both runs are read-only inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]

#: Fields a repair is permitted to change. Everything else must match exactly.
ANNOTATION_FIELDS = {
    "annotation_geometry",
    "annotation_geometry_error",
    "annotation_geometry_rejection",
    "annotation_geometry_repairs",
    "annotation_analysis_error",
    "ink_obstacles",
}


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def page_paths(run: Path, entry: dict[str, Any], pdf_sha: str) -> tuple[Path, Path]:
    pages = run / entry["id"] / "cache" / "pdf-cache" / pdf_sha / "pages"
    stem = f"{entry['page']:04d}"
    return pages / f"{stem}.homr.visual.json", pages / f"{stem}.musicxml"


def annotation_state(sidecar: dict[str, Any]) -> str:
    if sidecar.get("annotation_geometry"):
        return "repaired" if sidecar.get("annotation_geometry_repairs") else "supported"
    return "rejected" if sidecar.get("annotation_geometry_error") else "absent"


def note_links(sidecar: dict[str, Any]) -> list[Any]:
    return [
        [note["musicxml_id"], note.get("visual_group_id"), note.get("alignment_method")]
        for note in sidecar["notes"]
    ]


def recognition_core(sidecar: dict[str, Any]) -> dict[str, Any]:
    """Everything a repair must leave untouched."""
    return {
        key: value for key, value in sidecar.items() if key not in ANNOTATION_FIELDS
    }


def compare_page(before_path: Path, after_path: Path) -> dict[str, Any]:
    before = json.loads(before_path.read_text(encoding="utf-8"))
    after = json.loads(after_path.read_text(encoding="utf-8"))
    changed = sorted(
        key
        for key in set(before) | set(after)
        if before.get(key) != after.get(key)
    )
    result: dict[str, Any] = {
        "before": annotation_state(before),
        "after": annotation_state(after),
        "note_count_before": len(before["notes"]),
        "note_count_after": len(after["notes"]),
        "note_ids_identical": [n["musicxml_id"] for n in before["notes"]]
        == [n["musicxml_id"] for n in after["notes"]],
        "note_links_identical": note_links(before) == note_links(after),
        "recognition_identical": digest(recognition_core(before))
        == digest(recognition_core(after)),
        "changed_fields": changed,
        "unexpected_changes": [key for key in changed if key not in ANNOTATION_FIELDS],
    }
    repairs = after.get("annotation_geometry_repairs")
    if repairs:
        result["repairs"] = [
            {
                "staff_id": staff["staff_id"],
                "kind": staff["kind"],
                "removed_count": staff["removed_count"],
                "removed_x": [round(entry["x"], 3) for entry in staff["removed"]],
            }
            for staff in repairs["staffs"]
        ]
    if after.get("annotation_geometry_rejection"):
        result["rejection"] = {
            key: after["annotation_geometry_rejection"].get(key)
            for key in ("reason", "stage", "staff_id", "sample_index")
        }
    if after.get("annotation_geometry"):
        result["staff_samples_after"] = [
            len(staff["spacing"]) for staff in after["annotation_geometry"]["staffs"]
        ]
    if before.get("annotation_geometry"):
        result["staff_samples_before"] = [
            len(staff["spacing"]) for staff in before["annotation_geometry"]["staffs"]
        ]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path, help="corpus run without the repair")
    parser.add_argument("after", type=Path, help="corpus run with the repair")
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    corpus = json.loads(
        (REPOSITORY_ROOT / "plans" / "staff-geometry-corpus.json").read_text(encoding="utf-8")
    )
    pages: dict[str, Any] = {}
    for entry in corpus["entries"]:
        pdf_sha = entry["pdf_sha256"]
        before_sidecar, before_xml = page_paths(arguments.before, entry, pdf_sha)
        after_sidecar, after_xml = page_paths(arguments.after, entry, pdf_sha)
        if not before_sidecar.is_file() or not after_sidecar.is_file():
            pages[entry["id"]] = {"status": "missing"}
            continue
        record = compare_page(before_sidecar, after_sidecar)
        record["role"] = entry["role"]
        record["musicxml_identical"] = (
            before_xml.read_bytes() == after_xml.read_bytes()
            if before_xml.is_file() and after_xml.is_file()
            else None
        )
        pages[entry["id"]] = record

    transitions: dict[str, int] = {}
    for record in pages.values():
        key = f"{record.get('before', '?')} -> {record.get('after', '?')}"
        transitions[key] = transitions.get(key, 0) + 1
    report = {
        "version": 1,
        "before": str(arguments.before),
        "after": str(arguments.after),
        "transitions": transitions,
        "violations": sorted(
            name
            for name, record in pages.items()
            if record.get("unexpected_changes")
            or record.get("musicxml_identical") is False
            or record.get("note_links_identical") is False
            or record.get("recognition_identical") is False
        ),
        "pages": pages,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    for name, record in pages.items():
        line = f"{name:46s} {record.get('before','?'):10s} -> {record.get('after','?'):10s}"
        if record.get("repairs"):
            line += "  " + ", ".join(
                f"{r['staff_id']} -{r['removed_count']}" for r in record["repairs"]
            )
        if record.get("rejection"):
            line += f"  [{record['rejection']['reason']}]"
        print(line)
    print(json.dumps(report["transitions"], indent=2))
    print(f"violations: {report['violations'] or 'none'}")
    print(f"Report: {arguments.output}")
    return 1 if report["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
