from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RepairSettings:
    """The homr repairs a job asks for. Each is on unless the request turns it off."""

    # Where two voices share a notehead, start the next notes when the shorter voice's
    # note ends, as printed, instead of when the recognized longer value ends.
    shared_notehead_timing: bool = True

    @classmethod
    def from_params(cls, value: Any) -> RepairSettings:
        """Read the ``repairs`` object of a process_pdf request; absent means defaults."""
        if value is None:
            return cls()
        if not isinstance(value, dict):
            raise ValueError("repairs must be an object")
        unknown = set(value) - {"sharedNoteheadTiming"}
        if unknown:
            raise ValueError(f"Unknown repairs: {', '.join(sorted(unknown))}")
        shared_notehead_timing = value.get("sharedNoteheadTiming", True)
        if not isinstance(shared_notehead_timing, bool):
            raise ValueError("repairs.sharedNoteheadTiming must be true or false")
        return cls(shared_notehead_timing=shared_notehead_timing)

    def to_manifest(self) -> dict[str, bool]:
        """How the cache records the repairs its pages were recognized with: pages
        recognized with other repairs are recognized again, in the same cache."""
        return {"sharedNoteheadTiming": self.shared_notehead_timing}
