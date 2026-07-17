import json
import threading
from pathlib import Path

from PIL import Image

from sheet_music_worker.processor import (
    VISUAL_SIDECAR_VERSION,
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
        music_xml.write_text("<score-partwise />", encoding="utf-8")
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
        json.dumps({"visual_groups": [], "notes": []}), encoding="utf-8"
    )
    page = {
        "image": "pages/0001.png",
        "musicXml": "pages/0001.musicxml",
        "visualSidecar": "pages/0001.homr.visual.json",
    }
    assert validate_artifacts(page, tmp_path)


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
    pdf_path = tmp_path / "score.pdf"
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


def test_pdf_processing_invalidates_an_older_sidecar_generation(tmp_path: Path) -> None:
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
    manifest["visualSidecarVersion"] = VISUAL_SIDECAR_VERSION - 1
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
