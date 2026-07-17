from __future__ import annotations

import io
import json
import sys

from sheet_music_worker.__main__ import WorkerServer, _reserve_protocol_output


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
