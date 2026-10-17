import json
import threading
import xml.etree.ElementTree as ElementTree
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from PIL import Image

from sheet_music_worker import processor as processor_module
from sheet_music_worker.homr_engine import NoMusicDetectedError
from sheet_music_worker.repairs import RepairSettings
from sheet_music_worker.processor import (
    DOWNSAMPLE_OMR_INPUT,
    OMR_RESAMPLING,
    OMR_TARGET_WIDTH,
    RASTER_DPI,
    VISUAL_SIDECAR_CACHE_REVISION,
    PdfProcessor,
    note_value_verification_error,
    read_visual_sidecar,
    rest_verification_error,
    scale_visual_sidecar,
    sha256_file,
    validate_artifacts,
)


class FakeHomrEngine:
    """Writes a one-rest page. With time signatures read, the page starts from the meter
    passed in and ends in the one ``printed`` gives for it, if any."""

    def __init__(self, printed: dict[str, tuple[int, int]] | None = None) -> None:
        self.calls: list[Path] = []
        self.image_sizes: list[tuple[int, int]] = []
        self.repairs: list[RepairSettings] = []
        self.previous: list[tuple[int, int] | None] = []
        self.printed = printed or {}

    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        self.calls.append(image_path)
        self.repairs.append(repairs)
        self.previous.append(previous_time_signature)
        with Image.open(image_path) as image:
            self.image_sizes.append(image.size)
        page = image_path.stem.removesuffix(".omr")
        meters: dict[str, object] = {}
        if repairs.time_signatures:
            ended_in = self.printed.get(page, previous_time_signature)
            meters["time_signatures"] = {
                "version": 1,
                "carried_in": previous_time_signature and list(previous_time_signature),
                "carried_out": ended_in and list(ended_in),
                "tokens": [],
                "unmatched_reads": [],
            }
        music_xml = image_path.with_suffix(".musicxml")
        visual_sidecar = image_path.with_suffix(".homr.visual.json")
        music_xml.write_text(
            """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Voice</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note id="homr-note-1"><rest/><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>
""",
            encoding="utf-8",
        )
        visual_sidecar.write_text(
            json.dumps(
                {
                    "version": 3,
                    "source_image_size": list(self.image_sizes[-1]),
                    "visual_groups": [],
                    "notes": [
                        {
                            "musicxml_id": "homr-note-1",
                            "part": 1,
                            "measure": 1,
                            "musicxml_staff_number": 1,
                            "voice": 1,
                            "pitch": None,
                            "duration": "rest_1",
                            "match_confidence": 0,
                            "visual_group_id": None,
                            "alignment_method": "none",
                        }
                    ],
                    **meters,
                }
            ),
            encoding="utf-8",
        )
        return music_xml, visual_sidecar


class SecondPageFailureEngine(FakeHomrEngine):
    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        if image_path.stem.removesuffix(".omr") == "0002":
            raise RuntimeError("deliberate page failure")
        return super().process_image(image_path, repairs, previous_time_signature)


class FirstPageNoMusicEngine(FakeHomrEngine):
    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        if image_path.stem.removesuffix(".omr") == "0001":
            self.calls.append(image_path)
            raise NoMusicDetectedError("No staffs found")
        return super().process_image(image_path, repairs, previous_time_signature)


class EmptySidecarEngine(FakeHomrEngine):
    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        music_xml, visual_sidecar = super().process_image(
            image_path, repairs, previous_time_signature
        )
        visual_sidecar.write_text(
            json.dumps(
                {
                    "version": 3,
                    "source_image_size": list(self.image_sizes[-1]),
                    "visual_groups": [],
                    "notes": [],
                }
            ),
            encoding="utf-8",
        )
        return music_xml, visual_sidecar


def cross_staff_repaired_sidecar() -> dict[str, object]:
    return {
        "version": 3,
        "source_image_size": [100, 100],
        "visual_groups": [
            {
                "visual_group_id": "vnote-1",
                "staff_group_index": 0,
                "staff_index": 0,
                "staff_position": -5,
                "center": [20, 30],
                "bbox": [15, 25, 25, 35],
                "notehead_ellipses": [
                    {"center": [20, 30], "rx": 5, "ry": 4, "angle": 0}
                ],
                "notehead_contours": [],
                "stem_contours": [],
                "musicxml_id": "homr-note-1",
                "visual_status": "fallback",
                "provenance": "segmentation",
                "moment_id": "moment-1-1",
                "chord_id": None,
                "repair_actions": ["cross_staff_link_repaired"],
            }
        ],
        "notes": [
            {
                "musicxml_id": "homr-note-1",
                "part": 1,
                "measure": 1,
                "musicxml_staff_number": 2,
                "voice": 1,
                "pitch": "F#3",
                "duration": "note_8",
                "match_confidence": 1,
                "visual_group_id": "vnote-1",
                "alignment_method": "cross_staff_repair",
            }
        ],
    }


def test_sha256_file_is_content_based(tmp_path: Path) -> None:
    first = tmp_path / "first.pdf"
    second = tmp_path / "second.pdf"
    first.write_bytes(b"same PDF bytes")
    second.write_bytes(b"same PDF bytes")
    assert sha256_file(first) == sha256_file(second)


def test_omr_downsampling_is_disabled_by_default() -> None:
    assert DOWNSAMPLE_OMR_INPUT is False


def test_validate_artifacts_accepts_readable_outputs(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text(
        json.dumps(
            {
                "version": 3,
                "source_image_size": [100, 100],
                "visual_groups": [
                    {
                        "visual_group_id": "vnote-1",
                        "staff_group_index": 0,
                        "staff_index": 0,
                        "staff_position": 1,
                        "center": [20, 30],
                        "bbox": [15, 25, 25, 35],
                        "notehead_ellipses": [
                            {"center": [20, 30], "rx": 5, "ry": 4, "angle": 0}
                        ],
                        "notehead_contours": [[[15, 30], [20, 25], [25, 30], [20, 35]]],
                        "detected_notehead_contours": [],
                        "refined_notehead_contours": [],
                        "detected_stem_contours": [],
                        "stem_contours": [],
                        "stem_component_ids": [],
                        "is_hollow_notehead": False,
                        "musicxml_id": "homr-note-1",
                        "visual_status": "canonical",
                        "provenance": "segmentation",
                        "moment_id": "moment-1-1",
                        "chord_id": None,
                        "repair_actions": [],
                    }
                ],
                "notes": [
                    {
                        "musicxml_id": "homr-note-1",
                        "part": 1,
                        "measure": 1,
                        "musicxml_staff_number": 1,
                        "voice": 1,
                        "pitch": "C4",
                        "duration": "note_4",
                        "match_confidence": 0,
                        "visual_group_id": "vnote-1",
                        "alignment_method": "structural",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert validate_artifacts(page, tmp_path)


def test_read_visual_sidecar_accepts_marked_cross_staff_repair(tmp_path: Path) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = cross_staff_repaired_sidecar()
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    assert read_visual_sidecar(path) == sidecar


def test_read_visual_sidecar_rejects_incomplete_cross_staff_repair(
    tmp_path: Path,
) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = cross_staff_repaired_sidecar()
    visual_groups = sidecar["visual_groups"]
    assert isinstance(visual_groups, list)
    group = visual_groups[0]
    assert isinstance(group, dict)
    group["repair_actions"] = []
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    try:
        read_visual_sidecar(path)
    except ValueError as error:
        assert "Cross-staff repair metadata" in str(error)
    else:
        raise AssertionError("Expected incomplete cross-staff metadata to be rejected")


def rest_record(rest_id: str, status: str = "unsupported", **changes: object) -> dict[str, object]:
    record: dict[str, object] = {
        "rest_id": rest_id,
        "part": 1,
        "measure": 2,
        "musicxml_staff_number": 1,
        "voice": 1,
        "duration": "rest_8",
        "status": status,
        "reason": "no_rest_shaped_ink" if status == "unsupported" else "rest_shaped_ink",
        "staff_group_index": 0,
        "staff_index": 0,
        "center": [40, 50],
        "staff_lines": [30, 40, 50, 60, 70],
        "unit_size": 10,
        "position_estimated": False,
    }
    record.update(changes)
    return record


def sidecar_with_rests(*rests: dict[str, object]) -> dict[str, object]:
    sidecar = cross_staff_repaired_sidecar()
    sidecar["rest_verification"] = {"version": 1, "rests": list(rests)}
    return sidecar


def test_read_visual_sidecar_keeps_valid_rest_verification(tmp_path: Path) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = sidecar_with_rests(
        rest_record("homr-rest-1", "supported"),
        rest_record("homr-rest-2"),
        rest_record("homr-rest-3", "unverified", reason="multi_measure_rest", center=None,
                    staff_lines=[], unit_size=None),
    )
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    assert read_visual_sidecar(path) == sidecar


def test_read_visual_sidecar_drops_unusable_rest_verification_but_keeps_the_page(
    tmp_path: Path,
) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = sidecar_with_rests(rest_record("homr-rest-1", center=None))
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    result = read_visual_sidecar(path)

    assert "rest_verification" not in result
    assert result["notes"] == cross_staff_repaired_sidecar()["notes"]


def test_rest_verification_rules() -> None:
    notes = {"homr-note-1"}
    valid = {"version": 1, "rests": [rest_record("homr-rest-1")]}
    assert rest_verification_error(valid, notes) is None
    cases = [
        ("rest verification v1 is required", {"version": 2, "rests": []}),
        ("rest verification has no rest list", {"version": 1}),
        (
            "rest verification has an invalid rest record",
            {"version": 1, "rests": [rest_record("homr-rest-1", status="maybe")]},
        ),
        (
            "rest verification has an invalid rest record",
            {"version": 1, "rests": [rest_record("homr-rest-1", position_estimated="yes")]},
        ),
        (
            "rest verification IDs must be unique and distinct from note IDs",
            {"version": 1, "rests": [rest_record("homr-note-1")]},
        ),
        (
            "an unsupported rest needs a position, staff lines and a staff space",
            {"version": 1, "rests": [rest_record("homr-rest-1", staff_lines=[30, 40])]},
        ),
    ]
    for expected, block in cases:
        assert rest_verification_error(block, notes) == expected
    duplicate = {"version": 1, "rests": [rest_record("homr-rest-1"), rest_record("homr-rest-1")]}
    assert (
        rest_verification_error(duplicate, notes)
        == "rest verification IDs must be unique and distinct from note IDs"
    )


def note_value_record(musicxml_id: str = "homr-note-1", **changes: object) -> dict[str, object]:
    record: dict[str, object] = {
        "musicxml_id": musicxml_id,
        "printed": "eighth",
        "dotted": False,
        "status": "disagrees",
        "reason": "1_bands",
    }
    record.update(changes)
    return record


def test_read_visual_sidecar_keeps_valid_note_value_verification(tmp_path: Path) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = cross_staff_repaired_sidecar()
    sidecar["note_value_verification"] = {"version": 1, "notes": [note_value_record()]}
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    assert read_visual_sidecar(path) == sidecar


def test_read_visual_sidecar_drops_unusable_note_value_verification_but_keeps_the_page(
    tmp_path: Path,
) -> None:
    path = tmp_path / "score.homr.visual.json"
    sidecar = cross_staff_repaired_sidecar()
    sidecar["note_value_verification"] = {
        "version": 1,
        "notes": [note_value_record(printed="64th")],
    }
    path.write_text(json.dumps(sidecar), encoding="utf-8")

    result = read_visual_sidecar(path)

    assert "note_value_verification" not in result
    assert result["notes"] == cross_staff_repaired_sidecar()["notes"]


def test_note_value_verification_rules() -> None:
    notes = {"homr-note-1", "homr-note-2"}
    valid = {
        "version": 1,
        "notes": [
            note_value_record(),
            note_value_record("homr-note-2", printed=None, dotted=None, status="unknown",
                              reason="stem_unclear"),
        ],
    }
    assert note_value_verification_error(valid, notes) is None
    cases = [
        ("note value verification v1 is required", {"version": 2, "notes": []}),
        ("note value verification has no note list", {"version": 1}),
        (
            "note value verification has an invalid note record",
            {"version": 1, "notes": [note_value_record(status="maybe")]},
        ),
        (
            "note value verification has an invalid note record",
            {"version": 1, "notes": [note_value_record(dotted="yes")]},
        ),
        (
            "note value verification must name each linked note at most once",
            {"version": 1, "notes": [note_value_record("homr-rest-1")]},
        ),
        (
            "note value verification must name each linked note at most once",
            {"version": 1, "notes": [note_value_record(), note_value_record()]},
        ),
        (
            "a compared note needs its printed value",
            {"version": 1, "notes": [note_value_record(printed=None)]},
        ),
    ]
    for expected, block in cases:
        assert note_value_verification_error(block, notes) == expected


def test_scale_visual_sidecar_moves_rest_geometry_to_the_display_raster() -> None:
    sidecar = {
        "version": 3,
        "source_image_size": [100, 200],
        "notes": [],
        "visual_groups": [],
        "rest_verification": {
            "version": 1,
            "rests": [rest_record("homr-rest-1", "supported")],
        },
    }

    scale_visual_sidecar(sidecar, source_size=(100, 200), target_size=(200, 300))

    rest = sidecar["rest_verification"]["rests"][0]
    assert rest["center"] == [80.0, 75.0]
    assert rest["staff_lines"] == [45.0, 60.0, 75.0, 90.0, 105.0]
    assert rest["unit_size"] == 15.0


def test_scale_visual_sidecar_moves_tempo_marks_to_the_display_raster() -> None:
    sidecar = {
        "version": 3,
        "source_image_size": [100, 200],
        "notes": [],
        "visual_groups": [],
        "tempo_marks": {
            "version": 1,
            "marks": [
                {"text": "140", "box": [10.0, 20.0, 40.0, 30.0], "status": "written"},
                {"text": "96", "box": None, "status": "unread"},
            ],
        },
    }

    scale_visual_sidecar(sidecar, source_size=(100, 200), target_size=(200, 300))

    marks = sidecar["tempo_marks"]["marks"]
    assert marks[0]["box"] == [20.0, 30.0, 80.0, 45.0]
    assert marks[1]["box"] is None


def test_validate_artifacts_rejects_a_page_without_notes(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text(
        json.dumps(
            {
                "version": 3,
                "source_image_size": [100, 100],
                "visual_groups": [],
                "notes": [],
            }
        ),
        encoding="utf-8",
    )
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert not validate_artifacts(page, tmp_path)


def test_validate_artifacts_rejects_bad_sidecar(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text("not json", encoding="utf-8")
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert not validate_artifacts(page, tmp_path)


def test_validate_artifacts_rejects_v2_sidecar(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text(
        json.dumps(
            {
                "version": 2,
                "visual_groups": [],
                "notes": [{"musicxml_id": "homr-note-1"}],
            }
        ),
        encoding="utf-8",
    )
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert not validate_artifacts(page, tmp_path)


def test_read_visual_sidecar_rejects_disagreeing_v3_inverse_links(tmp_path: Path) -> None:
    path = tmp_path / "score.homr.visual.json"
    path.write_text(
        json.dumps(
            {
                "version": 3,
                "source_image_size": [100, 100],
                "notes": [
                    {
                        "musicxml_id": "homr-note-1",
                        "part": 1,
                        "measure": 1,
                        "musicxml_staff_number": 1,
                        "voice": 1,
                        "pitch": "C4",
                        "duration": "note_4",
                        "match_confidence": 1,
                        "visual_group_id": "vnote-1",
                        "alignment_method": "structural",
                    }
                ],
                "visual_groups": [
                    {
                        "visual_group_id": "vnote-1",
                        "staff_group_index": 0,
                        "staff_index": 0,
                        "staff_position": 1,
                        "center": [20, 30],
                        "bbox": [15, 25, 25, 35],
                        "notehead_ellipses": [
                            {"center": [20, 30], "rx": 5, "ry": 4, "angle": 0}
                        ],
                        "notehead_contours": [],
                        "stem_contours": [],
                        "musicxml_id": "different-note",
                        "visual_status": "canonical",
                        "provenance": "segmentation",
                        "moment_id": "moment-1",
                        "chord_id": None,
                        "repair_actions": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    try:
        read_visual_sidecar(path)
    except ValueError as error:
        assert "inverse links" in str(error)
    else:
        raise AssertionError("Expected invalid v3 links to be rejected")


def test_scale_visual_sidecar_moves_geometry_to_the_display_raster() -> None:
    sidecar = {
        "version": 3,
        "source_image_size": [100, 200],
        "preprocessing": {
            "autocrop_box": [5, 10, 90, 180],
            "cropped_size": [90, 180],
            "resized_size": [100, 200],
            "resize_scale": [100 / 90, 200 / 180],
            "prediction_size": [100, 200],
        },
        "notes": [],
        "raw_stem_contours": [
            {"debug_id": 1, "contour": [[1, 2], [3, 4]], "bbox": [[1, 2], [3, 4]]}
        ],
        "visual_groups": [
            {
                "visual_group_id": "diagnostic-1",
                "staff_group_index": 0,
                "staff_index": 0,
                "staff_position": 1,
                "musicxml_id": None,
                "visual_status": "diagnostic",
                "provenance": "segmentation",
                "moment_id": None,
                "chord_id": None,
                "repair_actions": ["unmatched_candidate"],
                "center": [10, 20],
                "bbox": [5, 10, 15, 30],
                "notehead_ellipses": [
                    {"center": [10, 20], "rx": 4, "ry": 2, "angle": -20}
                ],
                "notehead_contours": [[[5, 10], [15, 30]]],
                "detected_notehead_contours": [[[6, 11], [14, 29]]],
                "refined_notehead_contours": [],
                "detected_stem_contours": [[[10, 20], [11, 30]]],
                "stem_contours": [[[10, 20], [11, 30]]],
            }
        ],
    }

    result = scale_visual_sidecar(
        sidecar,
        source_size=(100, 200),
        target_size=(200, 300),
    )

    assert result["source_image_size"] == [200, 300]
    assert result["preprocessing"]["autocrop_box"] == [10, 15, 180, 270]
    assert result["preprocessing"]["cropped_size"] == [180, 270]
    assert result["preprocessing"]["resize_scale"] == [0.55555556, 0.74074074]
    assert result["raw_stem_contours"][0]["contour"] == [[2.0, 3.0], [6.0, 6.0]]
    group = result["visual_groups"][0]
    assert group["center"] == [20.0, 30.0]
    assert group["bbox"] == [10.0, 15.0, 30.0, 45.0]
    assert group["notehead_ellipses"] == [
        {"center": [20.0, 30.0], "rx": 7.0, "ry": 3.5, "angle": -20}
    ]
    assert group["stem_contours"] == [[[20.0, 30.0], [22.0, 45.0]]]
    assert group["visual_status"] == "diagnostic"
    assert group["repair_actions"] == ["unmatched_candidate"]


def test_pdf_processing_rasterizes_then_reuses_cache(tmp_path: Path) -> None:
    pdf_path = tmp_path / "Super Mario Bros - Underwater Theme.pdf"
    first_page = Image.new("RGB", (120, 80), "white")
    second_page = Image.new("RGB", (100, 120), "white")
    first_page.save(
        pdf_path,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=[second_page],
    )
    engine = FakeHomrEngine()

    first_events: list[dict[str, object]] = []
    PdfProcessor(first_events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="first",
        pdf_path=pdf_path,
        cache_root=tmp_path / "cache",
        cancel=threading.Event(),
    )
    assert len(engine.calls) == 2
    assert all(path.name.endswith(".omr.png") for path in engine.calls)
    assert sum(event.get("type") == "page_completed" for event in first_events) == 2
    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    merged_music_xml = cache_directory / "Super Mario Bros - Underwater Theme.musicxml"
    assert merged_music_xml.is_file()
    merged_root = ElementTree.parse(merged_music_xml).getroot()
    merged_measures = merged_root.findall("./part/measure")
    assert [measure.get("number") for measure in merged_measures] == ["1", "2"]
    assert merged_measures[1].find("print").attrib == {
        "new-page": "yes",
        "page-number": "2",
    }
    manifest = json.loads((cache_directory / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["rasterizer"]["dpi"] == RASTER_DPI
    assert manifest["omrInput"] == {
        "source": "displayRaster",
        "downsample": DOWNSAMPLE_OMR_INPUT,
        "targetWidth": None,
        "resampling": None,
    }
    assert not list((cache_directory / "pages").glob("*.omr*"))
    assert manifest["pages"][0]["width"] != OMR_TARGET_WIDTH
    assert engine.image_sizes == [
        (page["width"], page["height"]) for page in manifest["pages"]
    ]
    first_page_manifest = manifest["pages"][0]
    first_sidecar = json.loads(
        (cache_directory / first_page_manifest["visualSidecar"]).read_text(
            encoding="utf-8"
        )
    )
    assert first_sidecar["source_image_size"] == [
        first_page_manifest["width"],
        first_page_manifest["height"],
    ]
    assert manifest["documentMusicXml"] == "Super Mario Bros - Underwater Theme.musicxml"
    first_completed = [event for event in first_events if event.get("type") == "job_completed"]
    assert first_completed[0]["documentMusicXmlPath"] == str(merged_music_xml.resolve())

    annotated_music_xml = merged_music_xml.read_text(encoding="utf-8").replace(
        "</score-partwise>",
        "<!-- fingering-cache:v1 --></score-partwise>",
    )
    merged_music_xml.write_text(annotated_music_xml, encoding="utf-8")

    cached_events: list[dict[str, object]] = []
    PdfProcessor(cached_events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="second",
        pdf_path=pdf_path,
        cache_root=tmp_path / "cache",
        cancel=threading.Event(),
    )
    assert len(engine.calls) == 2
    completed = [event for event in cached_events if event.get("type") == "page_completed"]
    assert len(completed) == 2
    assert all(event["cached"] is True for event in completed)
    assert merged_music_xml.is_file()
    assert merged_music_xml.read_text(encoding="utf-8") == annotated_music_xml


def test_pdf_processing_writes_compact_json_and_reuses_indented_caches(tmp_path: Path) -> None:
    pdf_path = tmp_path / "score.pdf"
    Image.new("RGB", (120, 80), "white").save(pdf_path, "PDF", resolution=300)
    engine = FakeHomrEngine()

    def process() -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        PdfProcessor(events.append, engine).process_pdf(  # type: ignore[arg-type]
            job_id="job",
            pdf_path=pdf_path,
            cache_root=tmp_path / "cache",
            cancel=threading.Event(),
        )
        return events

    process()
    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    manifest_path = cache_directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sidecar_path = cache_directory / manifest["pages"][0]["visualSidecar"]
    for path in (manifest_path, sidecar_path):
        text = path.read_text(encoding="utf-8")
        assert text == json.dumps(json.loads(text), separators=(",", ":"))

    # Caches written indented by earlier versions hold the same data and stay valid.
    for path in (manifest_path, sidecar_path):
        indented = json.dumps(json.loads(path.read_text(encoding="utf-8")), indent=2)
        path.write_text(indented, encoding="utf-8")
    cached = [event for event in process() if event.get("type") == "page_completed"]
    assert len(engine.calls) == 1
    assert [event["cached"] for event in cached] == [True]


def test_repair_settings_are_read_from_the_request() -> None:
    assert RepairSettings.from_params(None) == RepairSettings()
    assert RepairSettings.from_params({}) == RepairSettings(
        shared_notehead_timing=True, time_signatures=True, tuplets=True
    )
    assert RepairSettings.from_params({"sharedNoteheadTiming": False}) == RepairSettings(
        shared_notehead_timing=False
    )
    assert RepairSettings.from_params({"tuplets": False}) == RepairSettings(tuplets=False)
    # Tuplets follow the time signatures when the request leaves them out.
    assert RepairSettings.from_params({"timeSignatures": False}) == RepairSettings(
        time_signatures=False, tuplets=False
    )
    for invalid in (
        [],
        "off",
        {"sharedNoteheadTiming": "false"},
        {"sharedNoteheadTimng": False},
        {"timeSignatures": 0},
        {"tuplets": None},
        {"timeSignatures": False, "tuplets": True},
    ):
        with pytest.raises(ValueError):
            RepairSettings.from_params(invalid)


def test_the_tuplet_repair_needs_the_time_signatures() -> None:
    with pytest.raises(ValueError):
        RepairSettings(time_signatures=False)
    RepairSettings(time_signatures=False, tuplets=False)


def test_pdf_processing_recognizes_pages_again_when_the_repairs_change(tmp_path: Path) -> None:
    pdf_path = tmp_path / "score.pdf"
    Image.new("RGB", (120, 80), "white").save(pdf_path, "PDF", resolution=300)
    engine = FakeHomrEngine()
    cache_root = tmp_path / "cache"
    off = RepairSettings(shared_notehead_timing=False)

    def process(repairs: RepairSettings) -> list[bool]:
        events: list[dict[str, object]] = []
        PdfProcessor(events.append, engine).process_pdf(  # type: ignore[arg-type]
            job_id="job",
            pdf_path=pdf_path,
            cache_root=cache_root,
            cancel=threading.Event(),
            repairs=repairs,
        )
        return [bool(e["cached"]) for e in events if e.get("type") == "page_completed"]

    def recorded_repairs() -> object:
        manifest_path = cache_root / "pdf-cache" / sha256_file(pdf_path) / "manifest.json"
        return json.loads(manifest_path.read_text(encoding="utf-8"))["repairs"]

    assert process(RepairSettings()) == [False]
    assert recorded_repairs() == {"sharedNoteheadTiming": True, "timeSignatures": True, "tuplets": True}
    assert process(off) == [False]
    assert recorded_repairs() == {"sharedNoteheadTiming": False, "timeSignatures": True, "tuplets": True}
    assert process(off) == [True]
    assert process(RepairSettings()) == [False]
    assert engine.repairs == [RepairSettings(), off, RepairSettings()]
    # One cache per PDF, however many repair settings it has been opened with.
    assert [path.name for path in (cache_root / "pdf-cache").iterdir()] == [
        sha256_file(pdf_path)
    ]


def test_pdf_processing_invalidates_an_older_sidecar_cache_revision(tmp_path: Path) -> None:
    pdf_path = tmp_path / "score.pdf"
    Image.new("RGB", (120, 80), "white").save(pdf_path, "PDF", resolution=300)
    engine = FakeHomrEngine()
    cache_root = tmp_path / "cache"

    PdfProcessor(lambda _event: None, engine).process_pdf(  # type: ignore[arg-type]
        job_id="first",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )
    assert len(engine.calls) == 1

    manifest_path = cache_root / "pdf-cache" / sha256_file(pdf_path) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["visualSidecarCacheRevision"] = VISUAL_SIDECAR_CACHE_REVISION - 1
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    refreshed_events: list[dict[str, object]] = []
    PdfProcessor(refreshed_events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="refreshed",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )

    assert len(engine.calls) == 2
    completed = [event for event in refreshed_events if event.get("type") == "page_completed"]
    assert len(completed) == 1
    assert completed[0]["cached"] is False


def test_pdf_processing_can_downsample_the_omr_input(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(processor_module, "DOWNSAMPLE_OMR_INPUT", True)
    pdf_path = tmp_path / "score.pdf"
    Image.new("RGB", (120, 80), "white").save(pdf_path, "PDF", resolution=300)
    engine = FakeHomrEngine()
    cache_root = tmp_path / "cache"

    PdfProcessor(lambda _event: None, engine).process_pdf(  # type: ignore[arg-type]
        job_id="downsampled",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )

    assert len(engine.image_sizes) == 1
    assert engine.image_sizes[0][0] == OMR_TARGET_WIDTH
    manifest_path = cache_root / "pdf-cache" / sha256_file(pdf_path) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["omrInput"] == {
        "source": "displayRaster",
        "downsample": True,
        "targetWidth": OMR_TARGET_WIDTH,
        "resampling": OMR_RESAMPLING,
    }


def test_pdf_processing_invalidates_an_older_omr_raster_configuration(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "score.pdf"
    Image.new("RGB", (120, 80), "white").save(pdf_path, "PDF", resolution=300)
    engine = FakeHomrEngine()
    cache_root = tmp_path / "cache"

    PdfProcessor(lambda _event: None, engine).process_pdf(  # type: ignore[arg-type]
        job_id="first",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )
    assert len(engine.calls) == 1

    manifest_path = cache_root / "pdf-cache" / sha256_file(pdf_path) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["omrInput"] = {
        "source": "displayRaster",
        "downsample": True,
        "targetWidth": OMR_TARGET_WIDTH,
        "resampling": "HAMMING",
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    completed_events: list[dict[str, object]] = []
    PdfProcessor(completed_events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="refreshed",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )

    assert len(engine.calls) == 2
    completed = [
        event for event in completed_events if event.get("type") == "page_completed"
    ]
    assert len(completed) == 1
    assert completed[0]["cached"] is False


def test_no_music_page_is_skipped_and_remaining_pages_are_merged(tmp_path: Path) -> None:
    pdf_path = tmp_path / "Score With Introduction.pdf"
    first_page = Image.new("RGB", (120, 80), "white")
    second_page = Image.new("RGB", (100, 120), "white")
    first_page.save(
        pdf_path,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=[second_page],
    )
    cache_root = tmp_path / "cache"
    engine = FirstPageNoMusicEngine()
    events: list[dict[str, object]] = []

    PdfProcessor(events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="first",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )

    cache_directory = cache_root / "pdf-cache" / sha256_file(pdf_path)
    merged_music_xml = cache_directory / "Score With Introduction.musicxml"
    assert merged_music_xml.is_file()
    assert len(ElementTree.parse(merged_music_xml).getroot().findall("./part/measure")) == 1
    manifest = json.loads((cache_directory / "manifest.json").read_text(encoding="utf-8"))
    assert [page["status"] for page in manifest["pages"]] == ["skipped", "complete"]
    assert manifest["documentMusicXml"] == "Score With Introduction.musicxml"
    skipped = [event for event in events if event.get("type") == "page_skipped"]
    assert skipped == [
        {
            "type": "page_skipped",
            "jobId": "first",
            "pageIndex": 0,
            "cached": False,
            "reason": "No staffs found",
        }
    ]
    job_completed = [event for event in events if event.get("type") == "job_completed"]
    assert job_completed[0]["status"] == "complete"
    assert job_completed[0]["completedPages"] == 1
    assert job_completed[0]["skippedPages"] == 1
    assert job_completed[0]["failedPages"] == 0

    cached_events: list[dict[str, object]] = []
    PdfProcessor(cached_events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="cached",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )

    assert len(engine.calls) == 2
    cached_skipped = [
        event for event in cached_events if event.get("type") == "page_skipped"
    ]
    assert len(cached_skipped) == 1
    assert cached_skipped[0]["cached"] is True
    assert merged_music_xml.is_file()


def test_page_with_empty_note_sidecar_is_skipped(tmp_path: Path) -> None:
    pdf_path = tmp_path / "No Music.pdf"
    Image.new("RGB", (120, 80), "white").save(
        pdf_path, "PDF", resolution=300
    )
    events: list[dict[str, object]] = []

    PdfProcessor(events.append, EmptySidecarEngine()).process_pdf(  # type: ignore[arg-type]
        job_id="empty",
        pdf_path=pdf_path,
        cache_root=tmp_path / "cache",
        cancel=threading.Event(),
    )

    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    manifest = json.loads((cache_directory / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["pages"][0]["status"] == "skipped"
    assert not (cache_directory / "No Music.musicxml").exists()
    skipped = [event for event in events if event.get("type") == "page_skipped"]
    assert skipped[0]["reason"] == "No notes detected"


def test_pdf_processing_does_not_merge_until_every_page_is_complete(tmp_path: Path) -> None:
    pdf_path = tmp_path / "Incomplete Score.pdf"
    first_page = Image.new("RGB", (120, 80), "white")
    second_page = Image.new("RGB", (100, 120), "white")
    first_page.save(
        pdf_path,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=[second_page],
    )
    events: list[dict[str, object]] = []

    PdfProcessor(events.append, SecondPageFailureEngine()).process_pdf(  # type: ignore[arg-type]
        job_id="partial",
        pdf_path=pdf_path,
        cache_root=tmp_path / "cache",
        cancel=threading.Event(),
    )

    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    assert not (cache_directory / "Incomplete Score.musicxml").exists()
    completed = [event for event in events if event.get("type") == "job_completed"]
    assert completed[0]["status"] == "partial"
    assert "documentMusicXmlPath" not in completed[0]


def test_failed_page_retry_removes_the_previous_merged_score(tmp_path: Path) -> None:
    pdf_path = tmp_path / "Retry Score.pdf"
    first_page = Image.new("RGB", (120, 80), "white")
    second_page = Image.new("RGB", (100, 120), "white")
    first_page.save(
        pdf_path,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=[second_page],
    )
    cache_root = tmp_path / "cache"
    PdfProcessor(lambda _event: None, FakeHomrEngine()).process_pdf(  # type: ignore[arg-type]
        job_id="complete",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
    )
    cache_directory = cache_root / "pdf-cache" / sha256_file(pdf_path)
    merged_music_xml = cache_directory / "Retry Score.musicxml"
    assert merged_music_xml.is_file()

    PdfProcessor(lambda _event: None, SecondPageFailureEngine()).process_pdf(  # type: ignore[arg-type]
        job_id="retry",
        pdf_path=pdf_path,
        cache_root=cache_root,
        cancel=threading.Event(),
        force_page_index=1,
    )

    assert not merged_music_xml.exists()
    manifest = json.loads((cache_directory / "manifest.json").read_text(encoding="utf-8"))
    assert "documentMusicXml" not in manifest


def three_page_pdf(tmp_path: Path) -> Path:
    pdf_path = tmp_path / "Three Pages.pdf"
    pages = [Image.new("RGB", (120, 80 + 10 * index), "white") for index in range(3)]
    pages[0].save(pdf_path, "PDF", resolution=300, save_all=True, append_images=pages[1:])
    return pdf_path


def run(
    engine: FakeHomrEngine,
    pdf_path: Path,
    tmp_path: Path,
    repairs: RepairSettings = RepairSettings(),
    force_page_index: int | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    PdfProcessor(events.append, engine).process_pdf(  # type: ignore[arg-type]
        job_id="job",
        pdf_path=pdf_path,
        cache_root=tmp_path / "cache",
        cancel=threading.Event(),
        repairs=repairs,
        force_page_index=force_page_index,
    )
    return events


def recognized(events: list[dict[str, Any]]) -> list[int]:
    return [e["pageIndex"] for e in events if e.get("type") == "page_completed" and not e["cached"]]


def manifest_pages(pdf_path: Path, tmp_path: Path) -> list[dict[str, Any]]:
    path = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path) / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8"))["pages"]


def test_each_page_starts_from_the_meter_the_page_before_ended_in(tmp_path: Path) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = FakeHomrEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path)
    assert engine.previous == [None, (3, 4), (3, 4)]
    pages = manifest_pages(pdf_path, tmp_path)
    assert [(p["timeSignatureIn"], p["timeSignatureAtEnd"]) for p in pages] == [
        (None, [3, 4]),
        ([3, 4], [3, 4]),
        ([3, 4], [3, 4]),
    ]
    # Opened again, every page is still from the meter it was recognized with.
    assert recognized(run(engine, pdf_path, tmp_path)) == []


def test_without_time_signatures_no_meter_is_passed_on(tmp_path: Path) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = FakeHomrEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path, RepairSettings(time_signatures=False, tuplets=False))
    assert engine.previous == [None, None, None]
    assert [p["timeSignatureAtEnd"] for p in manifest_pages(pdf_path, tmp_path)] == [None] * 3


class MiddlePageNoMusicEngine(FakeHomrEngine):
    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        if image_path.stem.removesuffix(".omr") == "0002":
            self.previous.append(previous_time_signature)
            raise NoMusicDetectedError("No staffs found")
        return super().process_image(image_path, repairs, previous_time_signature)


def test_a_page_without_music_passes_the_meter_on_and_a_failed_page_does_not(
    tmp_path: Path,
) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = MiddlePageNoMusicEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path)
    assert engine.previous == [None, (3, 4), (3, 4)]
    # The cached page without music still passes it on.
    assert recognized(run(engine, pdf_path, tmp_path)) == []
    failing = SecondPageFailureEngine(printed={"0001": (3, 4)})
    (tmp_path / "other").mkdir()
    run(failing, three_page_pdf(tmp_path / "other"), tmp_path / "other")
    assert failing.previous == [None, None]  # page 2 failed before recording; page 3 got none


class FlakySecondPageEngine(FakeHomrEngine):
    """Fails page 2 the first time it is recognized."""

    def __init__(self, printed: dict[str, tuple[int, int]] | None = None) -> None:
        super().__init__(printed)
        self.failed = False

    def process_image(
        self,
        image_path: Path,
        repairs: RepairSettings = RepairSettings(),
        previous_time_signature: tuple[int, int] | None = None,
    ) -> tuple[Path, Path]:
        if image_path.stem.removesuffix(".omr") == "0002" and not self.failed:
            self.failed = True
            raise RuntimeError("deliberate page failure")
        return super().process_image(image_path, repairs, previous_time_signature)


def test_a_retried_page_recognizes_the_pages_after_it_that_started_from_another_meter(
    tmp_path: Path,
) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = FlakySecondPageEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path)
    assert engine.previous == [None, None]  # page 3 started from nothing after the failure
    events = run(engine, pdf_path, tmp_path, force_page_index=1)
    assert recognized(events) == [1, 2]
    assert engine.previous[-2:] == [(3, 4), (3, 4)]
    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    assert (cache_directory / "Three Pages.musicxml").is_file()
    assert recognized(run(engine, pdf_path, tmp_path)) == []


def test_a_retry_that_ends_in_the_same_meter_recognizes_only_its_page(tmp_path: Path) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = FakeHomrEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path)
    assert recognized(run(engine, pdf_path, tmp_path, force_page_index=1)) == [1]
    assert recognized(run(engine, pdf_path, tmp_path, force_page_index=0)) == [0]


def test_a_cached_page_from_another_meter_is_recognized_again(tmp_path: Path) -> None:
    pdf_path = three_page_pdf(tmp_path)
    engine = FakeHomrEngine(printed={"0001": (3, 4)})
    run(engine, pdf_path, tmp_path)
    cache_directory = tmp_path / "cache" / "pdf-cache" / sha256_file(pdf_path)
    manifest_path = cache_directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["pages"][1]["timeSignatureIn"] = [2, 4]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    merged = cache_directory / "Three Pages.musicxml"
    merged.write_text("stale", encoding="utf-8")
    events = run(engine, pdf_path, tmp_path)
    assert recognized(events) == [1]
    assert next(e for e in events if e["type"] == "job_started")["cacheStatus"] == "partial"
    assert merged.read_text(encoding="utf-8") != "stale"


def test_homr_engine_hands_the_repairs_to_the_musicxml_writer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import homr.main

    from sheet_music_worker.homr_engine import HomrEngine

    written: list[tuple[bool, bool, bool, object, bool]] = []

    def fake_process_image(image_path: str, config: object, xml_arguments: Any) -> Any:
        written.append(
            (
                xml_arguments.repair_shared_notehead_timing,
                xml_arguments.read_time_signatures,
                xml_arguments.repair_tuplets,
                xml_arguments.time_signature_from_previous_page,
                xml_arguments.guess_meter_per_section,
            )
        )
        music_xml = tmp_path / "page.musicxml"
        visual_sidecar = tmp_path / "page.homr.visual.json"
        music_xml.write_text("<score-partwise/>", encoding="utf-8")
        visual_sidecar.write_text("{}", encoding="utf-8")
        return SimpleNamespace(musicxml_path=music_xml, visual_sidecar_path=visual_sidecar)

    monkeypatch.setattr(homr.main, "process_image", fake_process_image)
    engine = HomrEngine()
    monkeypatch.setattr(engine, "_initialized", True)
    monkeypatch.setattr(engine, "_config", object())
    engine.process_image(tmp_path / "page.png")
    engine.process_image(tmp_path / "page.png", RepairSettings(shared_notehead_timing=False))
    engine.process_image(tmp_path / "page.png", RepairSettings(tuplets=False), (3, 4))
    off = RepairSettings(time_signatures=False, tuplets=False)
    engine.process_image(tmp_path / "page.png", off, (3, 4))
    # The meter is guessed per section whatever the repairs: homr guesses one for the page
    # unless asked.
    assert written == [
        (True, True, True, None, True),
        (False, True, True, None, True),
        (True, True, False, (3, 4), True),
        (True, False, False, None, True),  # no meter is carried without time signatures
    ]
