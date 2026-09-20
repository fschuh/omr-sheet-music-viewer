"""Preparation must preserve pinned existing files, including partial results."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "scan_prepare", Path(__file__).with_name("fingering-scan-prepare.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ScanPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "plans").mkdir()
        self.entry = {"pdf": "score.pdf", "image": "page.png", "sidecar": "sidecar.json", "musicxml": "page.xml"}
        for key in ("pdf", "image", "sidecar", "musicxml"):
            value = key.encode()
            (self.root / self.entry[key]).write_bytes(value)
            self.entry[f"{key}_sha256"] = hashlib.sha256(value).hexdigest()
        (self.root / "plans/fingering-recognition-scans.json").write_text(
            json.dumps({"pages": {"test": self.entry}}))

    def run_prepare(self, recognize=False):
        args = ["prepare", "--pdf-root", str(self.root)] + (["--recognize"] if recognize else [])
        with patch.object(prepare, "ROOT", self.root), patch.object(prepare.sys, "argv", args), \
                contextlib.redirect_stdout(io.StringIO()):
            prepare.main()

    def test_existing_pinned_inputs_are_verified_without_subprocesses(self):
        with patch.object(prepare.subprocess, "run") as run:
            self.run_prepare(recognize=True)
        run.assert_not_called()
        self.assertEqual((self.root / "score.pdf").read_bytes(), b"pdf")

    def test_mismatched_existing_image_is_not_overwritten(self):
        (self.root / "page.png").write_bytes(b"user change")
        with patch.object(prepare.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "Hash mismatch"):
                self.run_prepare()
        run.assert_not_called()
        self.assertEqual((self.root / "page.png").read_bytes(), b"user change")

    def test_partial_recognition_is_preserved_even_when_recognition_requested(self):
        (self.root / "page.xml").unlink()
        with patch.object(prepare.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "Partial existing"):
                self.run_prepare(recognize=True)
        run.assert_not_called()
        self.assertEqual((self.root / "sidecar.json").read_bytes(), b"sidecar")

    def test_missing_recognition_requires_explicit_flag(self):
        (self.root / "page.xml").unlink()
        (self.root / "sidecar.json").unlink()
        with patch.object(prepare.subprocess, "run") as run:
            with self.assertRaisesRegex(FileNotFoundError, "use --recognize"):
                self.run_prepare()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
