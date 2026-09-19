"""Prepare a local challenge page. Never modifies the source PDF or user cache.

PYTHONPATH=../homr .venv/bin/python tools/fingering-prepare.py /path/to/score.pdf
Outputs ignored testdata/fingering/<pdf-sha256>/0001.{png,musicxml,homr.visual.json}.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess

from homr.main import ProcessingConfig, process_image
from homr.music_xml_generator import XmlGeneratorArguments

parser = argparse.ArgumentParser()
parser.add_argument("pdf", type=Path)
parser.add_argument("--page", type=int, default=1)
args = parser.parse_args()
digest = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
output = Path(__file__).resolve().parents[1] / "testdata/fingering" / digest
output.mkdir(parents=True, exist_ok=True)
base = output / f"{args.page:04}"
subprocess.run(["pdftoppm", "-f", str(args.page), "-singlefile", "-scale-to-x", "1920",
                "-scale-to-y", "-1", "-png", str(args.pdf), str(base)], check=True)
config = ProcessingConfig(enable_debug=False, enable_cache=False, write_staff_positions=False,
                          read_staff_positions=False, selected_staff=-1, transformer_use_gpu=False,
                          segnet_use_gpu=False, coreml_encoder=False, write_visual_sidecar=True)
result = process_image(str(base.with_suffix(".png")), config, XmlGeneratorArguments())
print(result)
