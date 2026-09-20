"""Scoring regressions: offline, no OCR/model initialization required."""
import importlib.util
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "pilot", Path(__file__).with_name("fingering-recognition-pilot.py"))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class RecognitionPilotTests(unittest.TestCase):
    def test_scan_results_include_unavailable_targets_and_rescore_exactly(self):
        manifest_path = pilot.ROOT / "plans/fingering-recognition-scans.json"
        manifest = json.loads(manifest_path.read_text())
        report = json.loads((pilot.ROOT / "plans/fingering-recognition-scan-results.json").read_text())
        self.assertEqual(report["manifest_sha256"], hashlib.sha256(manifest_path.read_bytes()).hexdigest())
        gold = [g for w in manifest["windows"] for g in w["gold"]]
        self.assertEqual(len(gold), 32)
        self.assertEqual(sum(g["note"] is None for g in gold), 6)
        self.assertTrue(all(g.get("unavailable_reason") for g in gold if g["note"] is None))
        for field, metric in (("ocr_digits", "ocr_digit_candidates"), ("pdf_digits", "pdf_ascii_digit_candidates")):
            self.assertEqual(report[metric], pilot.summarize(report["windows"], field))
        self.assertEqual(report["ocr_digit_candidates"]["assignment"]["correct"], 12)
        self.assertEqual(report["ocr_digit_candidates"]["assignment"]["gold"], 32)
        for key, score in report["oracle_association"].items():
            self.assertEqual(score, pilot.metrics(
                sum(o["note"] is not None and o[key] == o["note"] for o in report["oracle"]),
                sum(o[key] is not None for o in report["oracle"]), len(gold)))
        for window in manifest["windows"]:
            self.assertEqual(next(w["gold"] for w in report["windows"] if w["id"] == window["id"]), window["gold"])
            for item in window["gold"]:
                x0, y0, x1, y1 = item["box"]
                a, b, c, d = window["bounds"]
                self.assertTrue(a <= x0 < x1 <= c and b <= y0 < y1 <= d)

    def test_committed_results_recompute_and_match_annotation_revision(self):
        manifest_path = pilot.ROOT / "plans/fingering-recognition-pilot.json"
        manifest = json.loads(manifest_path.read_text())
        report = json.loads((pilot.ROOT / "plans/fingering-recognition-results.json").read_text())
        self.assertEqual(report["manifest_sha256"], hashlib.sha256(manifest_path.read_bytes()).hexdigest())
        self.assertEqual(report["ocr_digit_candidates"], pilot.summarize(report["windows"], "ocr_digits"))
        self.assertEqual(report["pdf_ascii_digit_candidates"], pilot.summarize(report["windows"], "pdf_digits"))
        self.assertEqual(report["ocr_text_proposals"], pilot.summarize(report["windows"], "ocr_text")["location"])
        self.assertEqual({g["digit"] for w in manifest["windows"] for g in w["gold"]}, set("12345"))
        for window in manifest["windows"]:
            self.assertEqual(next(w["gold"] for w in report["windows"] if w["id"] == window["id"]), window["gold"])
            for gold in window["gold"]:
                x0, y0, x1, y1 = gold["box"]
                a, b, c, d = window["bounds"]
                self.assertTrue(a <= x0 < x1 <= c and b <= y0 < y1 <= d)

    def test_one_merged_proposal_cannot_recover_two_digits(self):
        gold = [{"box": [0, 0, 10, 10]}, {"box": [0, 12, 10, 22]}]
        self.assertEqual(len(pilot.match([{"box": [0, 0, 10, 22]}], gold)), 1)

    def test_duplicate_candidates_cannot_recover_one_digit_twice(self):
        box = {"box": [0, 0, 10, 10]}
        self.assertEqual(pilot.match([box, box], [box]), [(0, 0)])
        self.assertEqual(pilot.match([{"box": [20, 20, 30, 30]}], [box]), [])

    def test_wrong_value_and_wrong_note_are_separate_failures(self):
        gold = [{"box": [0, 0, 10, 10], "digit": "2", "note": "lower"}]
        row = {"gold": gold, "pred": [{"box": [0, 0, 10, 10], "text": "2", "note": "upper"}]}
        result = pilot.summarize([row], "pred")
        self.assertEqual(result["location"]["correct"], 1)
        self.assertEqual(result["value"]["correct"], 1)
        self.assertEqual(result["assignment"]["correct"], 0)
        row["pred"][0].update(text="3", note="lower")
        self.assertEqual(pilot.summarize([row], "pred")["value"]["correct"], 0)

    def test_missing_authoritative_link_never_counts_as_correct_null_assignment(self):
        row = {"gold": [{"box": [0, 0, 10, 10], "digit": "2", "note": None}],
               "pred": [{"box": [0, 0, 10, 10], "text": "2", "note": None}]}
        result = pilot.summarize([row], "pred")
        self.assertEqual(result["value"]["correct"], 1)
        self.assertEqual(result["assignment"]["correct"], 0)
        self.assertEqual(result["assignment"]["gold"], 1)

    def test_all_staffs_expands_pool_without_admitting_diagnostic_or_fallback_links(self):
        def group(identifier, system, staff, status):
            return {"musicxml_id": identifier, "staff_group_index": system, "staff_index": staff,
                    "visual_status": status, "center": [100, 200]}
        data = {"sidecar": {"source_image_size": [2600, 3600], "visual_groups": [
            group("first", 0, 0, "canonical"), group("bass", 0, 1, "canonical"),
            group("later", 2, 0, "canonical"), group("fallback", 0, 0, "fallback"),
            group(None, 0, 0, "diagnostic")]}}
        self.assertEqual(pilot.notes_for(data, 1300), [{"id": "first", "center": [50, 100]}])
        self.assertEqual([n["id"] for n in pilot.notes_for(data, 1300, True)], ["first", "bass", "later"])

    def test_below_staff_fingers_remain_unsupported_by_frozen_baseline(self):
        self.assertIsNone(pilot.associate([5, 30, 15, 40], [{"id": "above", "center": [10, 20]}]))

    def test_negative_windows_count_false_positives(self):
        row = {"gold": [], "pred": [{"box": [0, 0, 10, 10], "text": "3"}]}
        self.assertEqual(pilot.summarize([row], "pred")["location"],
                         {"correct": 0, "proposed": 1, "gold": 0, "precision": 0, "recall": None})

    def test_no_predictions_has_undefined_precision_not_perfect_precision(self):
        self.assertIsNone(pilot.metrics(0, 0, 15)["precision"])
        self.assertEqual(pilot.metrics(0, 0, 15)["recall"], 0)

    def test_chord_lower_digit_breaks_nearest_baseline(self):
        notes = [{"id": "upper", "center": [10, 30]}, {"id": "lower", "center": [10, 40]}]
        self.assertEqual(pilot.associate([5, 10, 15, 20], notes), "upper")
        self.assertIsNone(pilot.associate([5, 10, 15, 20], notes, conservative=True))
        self.assertIsNone(pilot.associate([100, 10, 110, 20], notes))

    def test_pdf_control_characters_are_preserved_not_interpreted_as_digits(self):
        raw = '<page width="612"><word xMin="1" yMin="2" xMax="3" yMax="4">\x01</word></page>'
        with patch.object(pilot.subprocess, "run", return_value=SimpleNamespace(stdout=raw)):
            words = pilot.pdf_words(Path("unused.pdf"), 1224)
        self.assertEqual(words, [{"text": "\x01", "box": [2, 4, 6, 8]}])

    def test_ocr_boxes_return_to_page_coordinates(self):
        output = SimpleNamespace(boxes=[[[0, 0], [20, 0], [20, 40], [0, 40]]], txts=["5"], scores=[.9])
        self.assertEqual(pilot.ocr_rows(output, [100, 200, 300, 400], 2),
                         [{"box": [100, 200, 110, 220], "text": "5", "score": .9}])


if __name__ == "__main__":
    unittest.main()
