#!/usr/bin/env python3
"""Run the pinned staff-geometry corpus through the real worker path.

Every entry in ``plans/staff-geometry-corpus.json`` is re-recognized into its own
isolated cache with pre-validation capture enabled, so that accepted and rejected
pages alike leave a grid behind to measure. Source PDFs and the application's own
cache are only read; everything written lands under the ignored ``testdata``
directory.

Previously passing pages are regression controls here, not geometric ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CORPUS = REPOSITORY_ROOT / "plans" / "staff-geometry-corpus.json"
REPRO = REPOSITORY_ROOT / "tools" / "staff-geometry-repro.py"
# Relative corpus paths are written from the multi-repository workspace root, the
# same convention plans/fingering-fixtures.json already uses.
WORKSPACE_ROOT = REPOSITORY_ROOT.parent


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPOSITORY_ROOT / "testdata" / "staff-geometry" / "corpus",
        help="directory for the isolated caches and captures",
    )
    parser.add_argument("--only", action="append", default=[], help="run just these entry ids")
    parser.add_argument("--role", action="append", default=[], help="run just these roles")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="leave entries that already produced a report untouched",
    )
    arguments = parser.parse_args()

    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    entries = [
        entry
        for entry in corpus["entries"]
        if (not arguments.only or entry["id"] in arguments.only)
        and (not arguments.role or entry["role"] in arguments.role)
    ]
    output = arguments.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for index, entry in enumerate(entries, start=1):
        destination = output / entry["id"]
        report_path = destination / "repro-report.json"
        pdf = Path(entry["pdf"])
        if not pdf.is_absolute():
            pdf = WORKSPACE_ROOT / pdf
        observed = sha256_file(pdf)
        record: dict[str, Any] = {
            "id": entry["id"],
            "role": entry["role"],
            "page": entry["page"],
            "pdf": str(pdf),
            "pdf_sha256_matches_pin": observed == entry["pdf_sha256"],
        }
        if arguments.skip_existing and report_path.is_file():
            record["status"] = "reused"
        else:
            print(f"[{index}/{len(entries)}] {entry['id']} page {entry['page']}", flush=True)
            started = time.monotonic()
            completed = subprocess.run(
                [
                    sys.executable,
                    str(REPRO),
                    str(pdf),
                    "--output",
                    str(destination),
                    "--page",
                    str(entry["page"]),
                    "--fresh",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            record["seconds"] = round(time.monotonic() - started, 1)
            record["status"] = "ok" if completed.returncode == 0 else "failed"
            if completed.returncode != 0:
                record["stderr_tail"] = completed.stderr[-2000:]
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding="utf-8"))
            page_name = f"{entry['page']:04d}.homr.visual.json"
            page = report["pages"].get(page_name)
            if page:
                record["state"] = page["state"]
                record["note_count"] = page["note_count"]
                record["ink_obstacles"] = page["ink_obstacles"]
                if page.get("rejection"):
                    record["rejection"] = {
                        key: page["rejection"].get(key)
                        for key in ("reason", "stage", "staff_id", "sample_index", "x", "gaps")
                    }
                if page.get("staffs"):
                    record["staff_count"] = len(page["staffs"])
        results.append(record)
        print(f"    -> {record.get('state', record['status'])}", flush=True)

    summary_path = output / "corpus-report.json"
    summary_path.write_text(
        json.dumps({"version": 1, "results": results}, indent=2) + "\n", encoding="utf-8"
    )
    states: dict[str, int] = {}
    for record in results:
        states[record.get("state", record["status"])] = (
            states.get(record.get("state", record["status"]), 0) + 1
        )
    print(json.dumps(states, indent=2))
    print(f"Report: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
