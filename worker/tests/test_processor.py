import json
import threading
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from PIL import Image

from sheet_music_worker.homr_engine import NoMusicDetectedError
from sheet_music_worker.processor import (
    VISUAL_SIDECAR_CACHE_REVISION,
    PdfProcessor,
    sha256_file,
    validate_artifacts,
)


class FakeHomrEngine:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def process_image(self, image_path: Path) -> tuple[Path, Path]:
        self.calls.append(image_path)
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
                    "visual_groups": [],
                    "notes": [{"musicxml_id": "homr-note-1", "pitch": None}],
                }
            ),
            encoding="utf-8",
        )
        return music_xml, visual_sidecar


class SecondPageFailureEngine(FakeHomrEngine):
    def process_image(self, image_path: Path) -> tuple[Path, Path]:
        if image_path.stem == "0002":
            raise RuntimeError("deliberate page failure")
        return super().process_image(image_path)


class FirstPageNoMusicEngine(FakeHomrEngine):
    def process_image(self, image_path: Path) -> tuple[Path, Path]:
        if image_path.stem == "0001":
            self.calls.append(image_path)
            raise NoMusicDetectedError("No staffs found")
        return super().process_image(image_path)


class EmptySidecarEngine(FakeHomrEngine):
    def process_image(self, image_path: Path) -> tuple[Path, Path]:
        music_xml, visual_sidecar = super().process_image(image_path)
        visual_sidecar.write_text(
            json.dumps({"visual_groups": [], "notes": []}), encoding="utf-8"
        )
        return music_xml, visual_sidecar


def test_sha256_file_is_content_based(tmp_path: Path) -> None:
    first = tmp_path / "first.pdf"
    second = tmp_path / "second.pdf"
    first.write_bytes(b"same PDF bytes")
    second.write_bytes(b"same PDF bytes")
    assert sha256_file(first) == sha256_file(second)


def test_validate_artifacts_accepts_readable_outputs(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text(
        json.dumps(
            {"visual_groups": [], "notes": [{"musicxml_id": "homr-note-1"}]}
        ),
        encoding="utf-8",
    )
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert validate_artifacts(page, tmp_path)


def test_validate_artifacts_rejects_a_page_without_notes(tmp_path: Path) -> None:
    pages = tmp_path / "pages"
    pages.mkdir()
    (pages / "0001.png").write_bytes(b"png")
    (pages / "0001.musicxml").write_text("<score-partwise />", encoding="utf-8")
    (pages / "0001.homr.visual.json").write_text(
        json.dumps({"visual_groups": [], "notes": []}), encoding="utf-8"
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
