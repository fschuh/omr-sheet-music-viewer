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
from PIL import Image

from sheet_music_worker import WORKER_VERSION
from sheet_music_worker.homr_engine import HomrEngine, NoMusicDetectedError
from sheet_music_worker.logging import worker_log
from sheet_music_worker.musicxml_merge import merge_musicxml_pages

RASTER_DPI = 300
# Set this to True to pre-resize PDF rasters before handing them to HOMR.
DOWNSAMPLE_OMR_INPUT = False
OMR_TARGET_WIDTH = 1920
# Used only when DOWNSAMPLE_OMR_INPUT is enabled.
OMR_RESAMPLING_FILTER = Image.Resampling.HAMMING
OMR_RESAMPLING = OMR_RESAMPLING_FILTER.name
MANIFEST_SCHEMA_VERSION = 1
VISUAL_SIDECAR_CACHE_REVISION = 39

VISUAL_STATUSES = {"canonical", "fallback", "diagnostic"}
VISUAL_PROVENANCES = {
    "segmentation",
    "recovered_candidate",
    "merged_fragments",
    "transformer_recovered",
}
ALIGNMENT_METHODS = {
    "structural",
    "stem_repair",
    "sequence_repair",
    "attention",
    "none",
}

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


def read_visual_sidecar(path: Path) -> dict[str, Any]:
    sidecar = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(sidecar, dict)
        or sidecar.get("version") != 2
        or not isinstance(sidecar.get("visual_groups"), list)
        or not isinstance(sidecar.get("notes"), list)
    ):
        raise ValueError("HOMR visual sidecar has an invalid structure")
    for group in sidecar["visual_groups"]:
        if (
            not isinstance(group, dict)
            or group.get("visual_status") not in VISUAL_STATUSES
            or group.get("provenance") not in VISUAL_PROVENANCES
            or not (
                group.get("moment_id") is None
                or isinstance(group.get("moment_id"), str)
            )
            or not (
                group.get("chord_id") is None
                or isinstance(group.get("chord_id"), str)
            )
            or not isinstance(group.get("repair_actions"), list)
            or not all(
                isinstance(action, str) for action in group["repair_actions"]
            )
        ):
            raise ValueError("HOMR visual sidecar has an invalid v2 visual group")
    if any(
        not isinstance(note, dict)
        or note.get("alignment_method") not in ALIGNMENT_METHODS
        for note in sidecar["notes"]
    ):
        raise ValueError("HOMR visual sidecar has an invalid v2 note record")
    return sidecar


def _scale_point(point: list[float], scale_x: float, scale_y: float) -> list[float]:
    return [round(float(point[0]) * scale_x, 3), round(float(point[1]) * scale_y, 3)]


def scale_visual_sidecar(
    sidecar: dict[str, Any],
    *,
    source_size: tuple[int, int],
    target_size: tuple[int, int],
) -> dict[str, Any]:
    """Move HOMR geometry from its private OMR raster onto the displayed raster."""
    declared_source = sidecar.get("source_image_size")
    if (
        isinstance(declared_source, list)
        and len(declared_source) == 2
        and all(
            isinstance(value, (int, float)) and value > 0 for value in declared_source
        )
    ):
        source_width, source_height = declared_source
    else:
        source_width, source_height = source_size

    target_width, target_height = target_size
    scale_x = target_width / source_width
    scale_y = target_height / source_height
    radius_scale = (scale_x + scale_y) / 2

    preprocessing = sidecar.get("preprocessing")
    if isinstance(preprocessing, dict):
        autocrop_box = preprocessing.get("autocrop_box")
        if isinstance(autocrop_box, list) and len(autocrop_box) == 4:
            preprocessing["autocrop_box"] = [
                round(float(autocrop_box[0]) * scale_x),
                round(float(autocrop_box[1]) * scale_y),
                round(float(autocrop_box[2]) * scale_x),
                round(float(autocrop_box[3]) * scale_y),
            ]
        cropped_size = preprocessing.get("cropped_size")
        if isinstance(cropped_size, list) and len(cropped_size) == 2:
            scaled_cropped_size = [
                round(float(cropped_size[0]) * scale_x),
                round(float(cropped_size[1]) * scale_y),
            ]
            preprocessing["cropped_size"] = scaled_cropped_size
            resized_size = preprocessing.get("resized_size")
            if (
                isinstance(resized_size, list)
                and len(resized_size) == 2
                and all(value > 0 for value in scaled_cropped_size)
            ):
                preprocessing["resize_scale"] = [
                    round(float(resized_size[0]) / scaled_cropped_size[0], 8),
                    round(float(resized_size[1]) / scaled_cropped_size[1], 8),
                ]

    for stem in sidecar.get("raw_stem_contours", []):
        for field in ("contour", "bbox"):
            points = stem.get(field, [])
            stem[field] = [_scale_point(point, scale_x, scale_y) for point in points]

    contour_fields = (
        "notehead_contours",
        "detected_notehead_contours",
        "refined_notehead_contours",
        "detected_stem_contours",
        "stem_contours",
    )
    for group in sidecar.get("visual_groups", []):
        center = group.get("center")
        if isinstance(center, list) and len(center) == 2:
            group["center"] = _scale_point(center, scale_x, scale_y)
        bbox = group.get("bbox")
        if isinstance(bbox, list) and len(bbox) == 4:
            group["bbox"] = [
                round(float(bbox[0]) * scale_x, 3),
                round(float(bbox[1]) * scale_y, 3),
                round(float(bbox[2]) * scale_x, 3),
                round(float(bbox[3]) * scale_y, 3),
            ]
        for ellipse in group.get("notehead_ellipses", []):
            ellipse["center"] = _scale_point(ellipse["center"], scale_x, scale_y)
            ellipse["rx"] = round(float(ellipse["rx"]) * radius_scale, 3)
            ellipse["ry"] = round(float(ellipse["ry"]) * radius_scale, 3)
        for field in contour_fields:
            contours = group.get(field, [])
            group[field] = [
                [_scale_point(point, scale_x, scale_y) for point in contour]
                for contour in contours
            ]

    sidecar["source_image_size"] = [target_width, target_height]
    return sidecar


def validate_artifacts(page: dict[str, Any], cache_directory: Path) -> bool:
    try:
        image = cache_directory / page["image"]
        music_xml = cache_directory / page["musicXml"]
        visual_sidecar = cache_directory / page["visualSidecar"]
        if not all(path.is_file() and path.stat().st_size > 0 for path in (image, music_xml, visual_sidecar)):
            return False
        ElementTree.parse(music_xml)
        sidecar = read_visual_sidecar(visual_sidecar)
        return len(sidecar["notes"]) > 0
    except (KeyError, OSError, ValueError, ElementTree.ParseError):
        return False


def validate_skipped_page(page: dict[str, Any], cache_directory: Path) -> bool:
    try:
        image = cache_directory / page["image"]
        return (
            page.get("status") == "skipped"
            and image.is_file()
            and image.stat().st_size > 0
            and isinstance(page.get("reason"), str)
            and bool(page["reason"])
        )
    except (KeyError, OSError):
        return False


def page_is_reusable(page: dict[str, Any], cache_directory: Path) -> bool:
    if page.get("status") == "complete":
        return validate_artifacts(page, cache_directory)
    return validate_skipped_page(page, cache_directory)


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
            omr_input_description = (
                f"{OMR_TARGET_WIDTH}px/{OMR_RESAMPLING}"
                if DOWNSAMPLE_OMR_INPUT
                else "the original display raster"
            )
            worker_log(
                f"Opened {pdf_path.name}: {page_count} page(s), rendering display images at "
                f"{RASTER_DPI} DPI and passing HOMR {omr_input_description}"
            )
            manifest = self._load_manifest(manifest_path, identity, page_count)
            reusable = sum(
                1 for page in manifest["pages"] if page_is_reusable(page, cache_directory)
            )
            document_music_xml_path = (
                cache_directory / pdf_path.with_suffix(".musicxml").name
            )
            if reusable != page_count or force_page_index is not None:
                document_music_xml_path.unlink(missing_ok=True)
                if manifest.pop("documentMusicXml", None) is not None:
                    atomic_write_json(manifest_path, manifest)
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
            skipped = 0
            failed = 0
            for page_index in indices:
                if cancel.is_set():
                    worker_log("Cancellation requested; stopping between pages")
                    self._emit({"type": "job_completed", "jobId": job_id, "status": "cancelled"})
                    return

                page_manifest = manifest["pages"][page_index]
                if (
                    force_page_index is None
                    and page_is_reusable(page_manifest, cache_directory)
                ):
                    if page_manifest.get("status") == "skipped":
                        skipped += 1
                        worker_log(
                            f"Page {page_index + 1}/{page_count}: using cached no-music result"
                        )
                        self._emit_page_skipped(job_id, page_index, page_manifest, True)
                    else:
                        completed += 1
                        worker_log(
                            f"Page {page_index + 1}/{page_count}: using cached recognition"
                        )
                        self._emit_page_completed(
                            job_id, page_index, page_manifest, cache_directory, True
                        )
                    continue

                self._emit({"type": "page_started", "jobId": job_id, "pageIndex": page_index})
                page_started_at = time.perf_counter()
                try:
                    worker_log(f"Page {page_index + 1}/{page_count}: rasterizing")
                    rendered = self._render_page(document, page_index, pages_directory)
                    worker_log(
                        f"Page {page_index + 1}/{page_count}: rasterized to "
                        f"{rendered['width']}x{rendered['height']} for display and "
                        f"{rendered['omr_width']}x{rendered['omr_height']} for HOMR"
                    )
                    try:
                        generated_xml, generated_sidecar = self._homr.process_image(
                            rendered["omr_path"]
                        )
                        music_xml, visual_sidecar = self._promote_homr_artifacts(
                            rendered, generated_xml, generated_sidecar
                        )
                    finally:
                        self._cleanup_omr_intermediates(rendered)
                    if len(read_visual_sidecar(visual_sidecar)["notes"]) == 0:
                        raise NoMusicDetectedError("No notes detected")
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
                except NoMusicDetectedError as error:
                    skipped += 1
                    elapsed = time.perf_counter() - page_started_at
                    worker_log(
                        f"Page {page_index + 1}/{page_count}: no music detected after "
                        f"{elapsed:.1f}s; skipping page ({error})"
                    )
                    page_manifest.clear()
                    page_manifest.update(
                        {
                            "index": page_index,
                            "status": "skipped",
                            "reason": str(error),
                            "width": rendered["width"],
                            "height": rendered["height"],
                            "image": self._relative(cache_directory, rendered["path"]),
                        }
                    )
                    atomic_write_json(manifest_path, manifest)
                    self._emit_page_skipped(job_id, page_index, page_manifest, False)
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

            document_music_xml: Path | None = None
            all_pages_resolved = all(
                page_is_reusable(page, cache_directory) for page in manifest["pages"]
            )
            page_music_xml = [
                cache_directory / page["musicXml"]
                for page in manifest["pages"]
                if page.get("status") == "complete"
                and validate_artifacts(page, cache_directory)
            ]
            if all_pages_resolved and page_music_xml:
                document_music_xml = document_music_xml_path
                relative_document_music_xml = self._relative(
                    cache_directory, document_music_xml
                )
                merged_score_is_reusable = (
                    force_page_index is None
                    and reusable == page_count
                    and manifest.get("documentMusicXml") == relative_document_music_xml
                    and document_music_xml.is_file()
                )
                if merged_score_is_reusable:
                    worker_log(f"Using cached merged MusicXML at {document_music_xml}")
                else:
                    worker_log(
                        f"Post-processing {len(page_music_xml)} page(s) into "
                        f"{document_music_xml.name}"
                    )
                    merge_musicxml_pages(page_music_xml, document_music_xml)
                    manifest["documentMusicXml"] = relative_document_music_xml
                    atomic_write_json(manifest_path, manifest)
                    worker_log(f"Merged MusicXML is ready at {document_music_xml}")

            status = "complete" if failed == 0 else "partial"
            worker_log(
                f"Job finished with status {status}: {completed} completed, "
                f"{skipped} skipped, {failed} failed"
            )
            event = {
                "type": "job_completed",
                "jobId": job_id,
                "status": status,
                "completedPages": completed,
                "skippedPages": skipped,
                "failedPages": failed,
            }
            if document_music_xml is not None:
                event["documentMusicXmlPath"] = str(document_music_xml.resolve())
            self._emit(event)
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
            "visualSidecarCacheRevision": VISUAL_SIDECAR_CACHE_REVISION,
            "rasterizer": {
                "name": "pypdfium2",
                "version": identity.rasterizer_version,
                "dpi": RASTER_DPI,
                "background": "white",
            },
            "omrInput": {
                "source": "displayRaster",
                "downsample": DOWNSAMPLE_OMR_INPUT,
                "targetWidth": OMR_TARGET_WIDTH if DOWNSAMPLE_OMR_INPUT else None,
                "resampling": OMR_RESAMPLING if DOWNSAMPLE_OMR_INPUT else None,
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
        omr_path = pages_directory / f"{page_index + 1:04d}.omr.png"
        omr_temporary = pages_directory / f"{page_index + 1:04d}.omr.rendering.png"
        page = document[page_index]
        try:
            bitmap = page.render(
                scale=RASTER_DPI / 72,
                fill_color=(255, 255, 255, 255),
            )
            try:
                image = bitmap.to_pil().convert("RGB")
                try:
                    image.save(temporary, format="PNG")
                    width, height = image.size
                    if DOWNSAMPLE_OMR_INPUT:
                        omr_width = OMR_TARGET_WIDTH
                        omr_height = round(height * omr_width / width)
                        omr_image = image.resize(
                            (omr_width, omr_height), resample=OMR_RESAMPLING_FILTER
                        )
                        try:
                            omr_image.save(omr_temporary, format="PNG")
                        finally:
                            omr_image.close()
                    else:
                        omr_width, omr_height = width, height
                        image.save(omr_temporary, format="PNG")
                finally:
                    image.close()
            finally:
                bitmap.close()
        finally:
            page.close()
        os.replace(temporary, page_path)
        os.replace(omr_temporary, omr_path)
        return {
            "path": page_path,
            "width": width,
            "height": height,
            "omr_path": omr_path,
            "omr_width": omr_width,
            "omr_height": omr_height,
        }

    @staticmethod
    def _promote_homr_artifacts(
        rendered: dict[str, Any], generated_xml: Path, generated_sidecar: Path
    ) -> tuple[Path, Path]:
        page_path = rendered["path"]
        music_xml = page_path.with_suffix(".musicxml")
        visual_sidecar = page_path.with_suffix(".homr.visual.json")
        sidecar = read_visual_sidecar(generated_sidecar)
        scale_visual_sidecar(
            sidecar,
            source_size=(rendered["omr_width"], rendered["omr_height"]),
            target_size=(rendered["width"], rendered["height"]),
        )
        atomic_write_json(visual_sidecar, sidecar)
        if generated_xml != music_xml:
            os.replace(generated_xml, music_xml)
        if generated_sidecar != visual_sidecar:
            generated_sidecar.unlink(missing_ok=True)
        return music_xml, visual_sidecar

    @staticmethod
    def _cleanup_omr_intermediates(rendered: dict[str, Any]) -> None:
        omr_path = rendered["omr_path"]
        for path in (
            omr_path,
            omr_path.with_suffix(".musicxml"),
            omr_path.with_suffix(".homr.visual.json"),
            omr_path.with_name(f"{omr_path.stem}_teaser.png"),
        ):
            path.unlink(missing_ok=True)

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

    def _emit_page_skipped(
        self,
        job_id: str,
        page_index: int,
        page: dict[str, Any],
        cached: bool,
    ) -> None:
        self._emit(
            {
                "type": "page_skipped",
                "jobId": job_id,
                "pageIndex": page_index,
                "cached": cached,
                "reason": page["reason"],
            }
        )

    @staticmethod
    def _relative(base: Path, path: Path) -> str:
        return path.relative_to(base).as_posix()
