"""Prepare hash-locked scan research inputs without touching source PDFs/caches.

Use --recognize only when the local OMR artifacts are absent. Existing artifacts
are verified, never overwritten. Changed outputs require manual gold-ID review.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def verify(path, digest):
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Hash mismatch: {path}; do not silently rebind gold annotations")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf-root", type=Path, default=Path.home() / "Documents/sheet-music/Scans")
    parser.add_argument("--recognize", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "plans/fingering-recognition-scans.json").read_text())
    for key, spec in manifest["pages"].items():
        pdf = args.pdf_root / spec["pdf"]
        verify(pdf, spec["pdf_sha256"])
        image = ROOT / spec["image"]
        image.parent.mkdir(parents=True, exist_ok=True)
        if not image.exists():
            subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-scale-to-x", "2550",
                            "-scale-to-y", "-1", "-png", str(pdf), str(image.with_suffix(""))], check=True)
        verify(image, spec["image_sha256"])
        artifacts = [ROOT / spec[field] for field in ("sidecar", "musicxml")]
        if not all(path.exists() for path in artifacts):
            if any(path.exists() for path in artifacts):
                raise ValueError(f"Partial existing artifacts for {key}; preserve and inspect them manually")
            if not args.recognize:
                raise FileNotFoundError(f"Missing OMR artifacts for {key}; use --recognize to generate locally")
            environment = dict(os.environ, PYTHONPATH=str(ROOT.parent / "homr"),
                               OMP_NUM_THREADS="4", OPENBLAS_NUM_THREADS="4")
            subprocess.run([sys.executable, str(ROOT / "tools/fingering-prepare.py"), str(pdf)],
                           cwd=ROOT, env=environment, check=True)
        for field in ("sidecar", "musicxml"):
            verify(ROOT / spec[field], spec[f"{field}_sha256"])
        print(f"Verified {key}", flush=True)


if __name__ == "__main__":
    main()
