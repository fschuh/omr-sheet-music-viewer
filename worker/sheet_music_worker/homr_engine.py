from __future__ import annotations

from pathlib import Path

from sheet_music_worker.logging import worker_log


class NoMusicDetectedError(RuntimeError):
    """HOMR could not find enough musical content to recognize a page."""


NO_MUSIC_ERROR_MESSAGES = frozenset({"No noteheads found", "No staffs found"})


class HomrEngine:
    """Small adapter around HOMR's current programmatic entry points.

    HOMR does not expose the planned public ``HomrEngine`` API yet. Keeping that
    compatibility detail here gives the worker one place to switch once it does.
    """

    def __init__(self) -> None:
        self._initialized = False
        self._config: object | None = None
        self._xml_arguments: object | None = None

    def initialize(self) -> None:
        if self._initialized:
            return

        worker_log("Initializing HOMR models and inference providers")
        worker_log("Loading ONNX Runtime")
        import onnxruntime as ort

        worker_log("Loading the HOMR recognition pipeline")
        from homr.main import ProcessingConfig, download_weights
        from homr.music_xml_generator import XmlGeneratorArguments
        from homr.onnx_providers import coreml_available, cuda_available

        worker_log("Detecting available inference providers")
        transformer_use_gpu = cuda_available()
        segnet_use_gpu = transformer_use_gpu or coreml_available()
        worker_log(
            "Inference providers: "
            f"transformer={'GPU' if transformer_use_gpu else 'CPU'}, "
            f"segmentation={'GPU' if segnet_use_gpu else 'CPU'}"
        )
        worker_log("Checking HOMR model files (downloads only if files are missing)")
        download_weights(segnet_use_gpu, transformer_use_gpu, False)
        worker_log("HOMR model files are ready")
        ort.set_default_logger_severity(3)

        self._config = ProcessingConfig(
            enable_debug=False,
            enable_cache=False,
            write_staff_positions=False,
            read_staff_positions=False,
            selected_staff=-1,
            transformer_use_gpu=transformer_use_gpu,
            segnet_use_gpu=segnet_use_gpu,
            coreml_encoder=False,
            write_visual_sidecar=True,
        )
        self._xml_arguments = XmlGeneratorArguments()
        self._initialized = True
        worker_log("HOMR initialization complete")

    def process_image(self, image_path: Path) -> tuple[Path, Path]:
        self.initialize()
        from homr.main import process_image

        if self._config is None or self._xml_arguments is None:
            raise RuntimeError("HOMR failed to initialize")

        try:
            result = process_image(str(image_path), self._config, self._xml_arguments)
        except Exception as error:
            if str(error) in NO_MUSIC_ERROR_MESSAGES:
                raise NoMusicDetectedError(str(error)) from error
            raise
        music_xml = result.musicxml_path
        visual_sidecar = result.visual_sidecar_path
        if visual_sidecar is None or not music_xml.is_file() or not visual_sidecar.is_file():
            raise RuntimeError("HOMR completed without producing its expected artifacts")
        return music_xml, visual_sidecar
