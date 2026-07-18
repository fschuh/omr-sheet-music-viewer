from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Callable

import pypdfium2 as pdfium

from sheet_music_worker import WORKER_VERSION
from sheet_music_worker.homr_engine import HomrEngine
from sheet_music_worker.logging import worker_log

RASTER_DPI = 300
MANIFEST_SCHEMA_VERSION = 1
VISUAL_SIDECAR_VERSION = 3

EventEmitter = Callable[[dict[str, Any]], None]


def package_version(package: str) -> str:
    try:
        return version(package)
    except PackageNotFoundError:
        return "unknown"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def validate_artifacts(page: dict[str, Any], cache_directory: Path) -> bool:
    try:
        image = cache_directory / page["image"]
        music_xml = cache_directory / page["musicXml"]
        visual_sidecar = cache_directory / page["visualSidecar"]
        if not all(path.is_file() and path.stat().st_size > 0 for path in (image, music_xml, visual_sidecar)):
            return False
        ElementTree.parse(music_xml)
        sidecar = json.loads(visual_sidecar.read_text(encoding="utf-8"))
        return (
            isinstance(sidecar, dict)
            and isinstance(sidecar.get("visual_groups"), list)
            and isinstance(sidecar.get("notes"), list)
        )
    except (KeyError, OSError, ValueError, ElementTree.ParseError):
        return False


@dataclass(frozen=True)
class DocumentIdentity:
    pdf_sha256: str
    byte_length: int
    homr_version: str
    rasterizer_version: str


class PdfProcessor:
    def __init__(self, emit: EventEmitter, homr_engine: HomrEngine | None = None) -> None:
        self._emit = emit
        self._homr = homr_engine or HomrEngine()

    def initialize(self) -> None:
        """Load native HOMR dependencies on the worker's main thread."""
        self._homr.initialize()

    def process_pdf(
        self,
        *,
        job_id: str,
        pdf_path: Path,
        cache_root: Path,
        cancel: threading.Event,
        force_page_index: int | None = None,
    ) -> None:
        if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
            raise ValueError(f"PDF does not exist: {pdf_path}")

        worker_log(f"Hashing PDF: {pdf_path}")
        identity = DocumentIdentity(
            pdf_sha256=sha256_file(pdf_path),
            byte_length=pdf_path.stat().st_size,
            homr_version=package_version("homr"),
            rasterizer_version=package_version("pypdfium2"),
        )
        cache_directory = cache_root / "pdf-cache" / identity.pdf_sha256
        pages_directory = cache_directory / "pages"
        pages_directory.mkdir(parents=True, exist_ok=True)
        manifest_path = cache_directory / "manifest.json"

        document = pdfium.PdfDocument(str(pdf_path))
        try:
            page_count = len(document)
            worker_log(f"Opened {pdf_path.name}: {page_count} page(s), rendering at {RASTER_DPI} DPI")
            manifest = self._load_manifest(manifest_path, identity, page_count)
            reusable = sum(
                1
                for page in manifest["pages"]
                if page.get("status") == "complete" and validate_artifacts(page, cache_directory)
            )
            cache_status = "complete" if reusable == page_count else "partial" if reusable else "miss"
            worker_log(f"Cache status: {cache_status} ({reusable}/{page_count} page(s) reusable)")
            self._emit(
                {
                    "type": "job_started",
                    "jobId": job_id,
                    "documentName": pdf_path.name,
                    "pageCount": page_count,
                    "cacheStatus": cache_status,
                    "cachePath": str(cache_directory),
                }
            )

            indices = [force_page_index] if force_page_index is not None else list(range(page_count))
            if any(index < 0 or index >= page_count for index in indices):
                raise ValueError("Page index is outside this PDF")

            completed = 0
            failed = 0
            for page_index in indices:
                if cancel.is_set():
                    worker_log("Cancellation requested; stopping between pages")
                    self._emit({"type": "job_completed", "jobId": job_id, "status": "cancelled"})
                    return

                page_manifest = manifest["pages"][page_index]
                if (
                    force_page_index is None
                    and page_manifest.get("status") == "complete"
                    and validate_artifacts(page_manifest, cache_directory)
                ):
                    completed += 1
                    worker_log(f"Page {page_index + 1}/{page_count}: using cached recognition")
                    self._emit_page_completed(job_id, page_index, page_manifest, cache_directory, True)
                    continue

                self._emit({"type": "page_started", "jobId": job_id, "pageIndex": page_index})
                page_started_at = time.perf_counter()
                try:
                    worker_log(f"Page {page_index + 1}/{page_count}: rasterizing")
                    rendered = self._render_page(document, page_index, pages_directory)
                    worker_log(
                        f"Page {page_index + 1}/{page_count}: rasterized to "
                        f"{rendered['width']}x{rendered['height']}; starting HOMR"
                    )
                    music_xml, visual_sidecar = self._homr.process_image(rendered["path"])
                    page_manifest.clear()
                    page_manifest.update(
                        {
                            "index": page_index,
                            "status": "complete",
                            "width": rendered["width"],
                            "height": rendered["height"],
                            "image": self._relative(cache_directory, rendered["path"]),
                            "musicXml": self._relative(cache_directory, music_xml),
                            "visualSidecar": self._relative(cache_directory, visual_sidecar),
                        }
                    )
                    atomic_write_json(manifest_path, manifest)
                    completed += 1
                    elapsed = time.perf_counter() - page_started_at
                    worker_log(
                        f"Page {page_index + 1}/{page_count}: HOMR completed in {elapsed:.1f}s"
                    )
                    self._emit_page_completed(
                        job_id, page_index, page_manifest, cache_directory, False
                    )
                except Exception as error:  # A failed page must not prevent later pages.
                    failed += 1
                    elapsed = time.perf_counter() - page_started_at
                    worker_log(
                        f"Page {page_index + 1}/{page_count}: failed after {elapsed:.1f}s: {error}"
                    )
                    page_manifest.clear()
                    page_manifest.update(
                        {"index": page_index, "status": "failed", "error": str(error)}
                    )
                    atomic_write_json(manifest_path, manifest)
                    self._emit(
                        {
                            "type": "page_failed",
                            "jobId": job_id,
                            "pageIndex": page_index,
                            "error": {"message": str(error)},
                        }
                    )

            status = "complete" if failed == 0 else "partial"
            worker_log(
                f"Job finished with status {status}: {completed} completed, {failed} failed"
            )
            self._emit(
                {
                    "type": "job_completed",
                    "jobId": job_id,
                    "status": status,
                    "completedPages": completed,
                    "failedPages": failed,
                }
            )
        finally:
            document.close()

    def _load_manifest(
        self, path: Path, identity: DocumentIdentity, page_count: int
    ) -> dict[str, Any]:
        expected = {
            "schemaVersion": MANIFEST_SCHEMA_VERSION,
            "pdfSha256": identity.pdf_sha256,
            "pdfByteLength": identity.byte_length,
            "homrVersion": identity.homr_version,
            "visualSidecarVersion": VISUAL_SIDECAR_VERSION,
            "rasterizer": {
                "name": "pypdfium2",
                "version": identity.rasterizer_version,
                "dpi": RASTER_DPI,
                "background": "white",
            },
        }
        if path.is_file():
            try:
                current = json.loads(path.read_text(encoding="utf-8"))
                matching = all(current.get(key) == value for key, value in expected.items())
                if matching and current.get("pageCount") == page_count and len(current.get("pages", [])) == page_count:
                    return current
            except (OSError, ValueError, TypeError):
                pass

        manifest: dict[str, Any] = {
            **expected,
            "workerVersion": WORKER_VERSION,
            "pageCount": page_count,
            "pages": [{"index": index, "status": "pending"} for index in range(page_count)],
        }
        atomic_write_json(path, manifest)
        return manifest

    def _render_page(
        self, document: pdfium.PdfDocument, page_index: int, pages_directory: Path
    ) -> dict[str, Any]:
        page_path = pages_directory / f"{page_index + 1:04d}.png"
        temporary = pages_directory / f"{page_index + 1:04d}.rendering.png"
        page = document[page_index]
        try:
            bitmap = page.render(
                scale=RASTER_DPI / 72,
                fill_color=(255, 255, 255, 255),
            )
            try:
                image = bitmap.to_pil().convert("RGB")
                image.save(temporary, format="PNG")
                width, height = image.size
            finally:
                bitmap.close()
        finally:
            page.close()
        os.replace(temporary, page_path)
        return {"path": page_path, "width": width, "height": height}

    def _emit_page_completed(
        self,
        job_id: str,
        page_index: int,
        page: dict[str, Any],
        cache_directory: Path,
        cached: bool,
    ) -> None:
        image = cache_directory / page["image"]
        music_xml = cache_directory / page["musicXml"]
        visual_sidecar = cache_directory / page["visualSidecar"]
        self._emit(
            {
                "type": "page_completed",
                "jobId": job_id,
                "pageIndex": page_index,
                "cached": cached,
                "artifacts": {
                    "imagePath": str(image.resolve()),
                    "musicXmlPath": str(music_xml.resolve()),
                    "visualSidecarPath": str(visual_sidecar.resolve()),
                    "width": page["width"],
                    "height": page["height"],
                    "musicXmlBytes": music_xml.stat().st_size,
                    "visualSidecarBytes": visual_sidecar.stat().st_size,
                },
            }
        )

    @staticmethod
    def _relative(base: Path, path: Path) -> str:
        return path.relative_to(base).as_posix()
