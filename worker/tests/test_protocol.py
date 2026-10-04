from __future__ import annotations

import io
import json
import sys

import pytest

from sheet_music_worker import PROTOCOL_VERSION
from sheet_music_worker.__main__ import WorkerServer, _reserve_protocol_output
from sheet_music_worker.repairs import RepairSettings


def test_dependency_stdout_is_logged_without_contaminating_protocol(monkeypatch) -> None:
    protocol_output = io.StringIO()
    log_output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", protocol_output)
    monkeypatch.setattr(sys, "stderr", log_output)

    server = WorkerServer(_reserve_protocol_output())
    print("dependency diagnostic")
    server.emit({"type": "test_event", "value": 42})

    assert log_output.getvalue() == "dependency diagnostic\n"
    protocol_lines = protocol_output.getvalue().splitlines()
    assert len(protocol_lines) == 1
    assert json.loads(protocol_lines[0]) == {"type": "test_event", "value": 42}


def test_process_pdf_requests_carry_their_repairs_to_the_job(monkeypatch) -> None:
    server = WorkerServer(io.StringIO())
    started: list[dict] = []
    monkeypatch.setattr(server, "_start", lambda details, page_index=None: started.append(details))

    def request(params: dict) -> None:
        server._handle(
            {
                "protocol": PROTOCOL_VERSION,
                "method": "process_pdf",
                "params": {"jobId": "job", "pdfPath": "score.pdf", "cacheRoot": "cache", **params},
            }
        )

    request({})
    request({"repairs": {"sharedNoteheadTiming": False}})
    assert [details["repairs"] for details in started] == [
        RepairSettings(),
        RepairSettings(shared_notehead_timing=False),
    ]
    with pytest.raises(ValueError):
        request({"repairs": {"sharedNoteheadTiming": "no"}})
    assert len(started) == 2
