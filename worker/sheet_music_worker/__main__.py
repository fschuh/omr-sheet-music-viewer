from __future__ import annotations

import json
import sys
import threading
import traceback
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from sheet_music_worker import PROTOCOL_VERSION, WORKER_VERSION
from sheet_music_worker.processor import PdfProcessor


class WorkerServer:
    def __init__(self) -> None:
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active_job_id: str | None = None
        self._active_thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._processor = PdfProcessor(self.emit)

    def emit(self, event: dict[str, Any]) -> None:
        with self._write_lock:
            sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def serve(self) -> None:
        # ONNX Runtime and HOMR load native libraries. Initialize them on the
        # process main thread before recognition is dispatched to a job thread.
        self._processor.initialize()
        try:
            homr_version = version("homr")
        except PackageNotFoundError:
            homr_version = "unknown"
        self.emit(
            {
                "type": "hello",
                "protocol": PROTOCOL_VERSION,
                "workerVersion": WORKER_VERSION,
                "homrVersion": homr_version,
            }
        )

        for line in sys.stdin:
            try:
                command = json.loads(line.lstrip("\ufeff"))
                self._handle(command)
            except Exception as error:
                self.emit(
                    {
                        "type": "protocol_error",
                        "message": str(error),
                    }
                )
        # This also makes one-shot protocol smoke tests deterministic when stdin
        # closes immediately after a process_pdf request.
        active_thread = self._active_thread
        if active_thread is not None:
            active_thread.join()

    def _handle(self, command: dict[str, Any]) -> None:
        if command.get("protocol") != PROTOCOL_VERSION:
            raise ValueError("Unsupported worker protocol")
        method = command.get("method")
        params = command.get("params", {})
        if method == "process_pdf":
            job_id = str(params["jobId"])
            details = {
                "job_id": job_id,
                "pdf_path": Path(params["pdfPath"]),
                "cache_root": Path(params["cacheRoot"]),
            }
            self._jobs[job_id] = details
            self._start(details)
        elif method == "cancel_job":
            if params.get("jobId") == self._active_job_id:
                self._cancel.set()
        elif method == "retry_page":
            job_id = str(params["jobId"])
            if job_id not in self._jobs:
                raise ValueError("Unknown job")
            self._start(self._jobs[job_id], int(params["pageIndex"]))
        else:
            raise ValueError(f"Unknown worker method: {method}")

    def _start(self, details: dict[str, Any], page_index: int | None = None) -> None:
        with self._state_lock:
            if self._active_thread is not None and self._active_thread.is_alive():
                raise RuntimeError("A PDF is already being processed")
            self._cancel = threading.Event()
            self._active_job_id = details["job_id"]
            self._active_thread = threading.Thread(
                target=self._run,
                args=(details, self._cancel, page_index),
                daemon=True,
            )
            self._active_thread.start()

    def _run(
        self, details: dict[str, Any], cancel: threading.Event, page_index: int | None
    ) -> None:
        try:
            self._processor.process_pdf(
                **details,
                cancel=cancel,
                force_page_index=page_index,
            )
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            self.emit(
                {
                    "type": "job_failed",
                    "jobId": details["job_id"],
                    "error": {"message": str(error)},
                }
            )
        finally:
            with self._state_lock:
                self._active_job_id = None


def main() -> None:
    WorkerServer().serve()


if __name__ == "__main__":
    main()
