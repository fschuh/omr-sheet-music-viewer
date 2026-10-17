from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: The request's name for each repair, by field.
_PARAMS = {
    "shared_notehead_timing": "sharedNoteheadTiming",
    "time_signatures": "timeSignatures",
    "tuplets": "tuplets",
}


@dataclass(frozen=True)
class RepairSettings:
    """The homr repairs a job asks for. Each is on unless the request turns it off."""

    # Where two voices share a notehead, start the next notes when the shorter voice's
    # note ends, as printed, instead of when the recognized longer value ends.
    shared_notehead_timing: bool = True
    # Write the time signatures printed on the page instead of the ones homr infers from
    # the bar lengths, and carry the meter from each page into the next.
    time_signatures: bool = True
    # Write as tuplets the notes the page shows are one: under a beam whose notes add up
    # to a triplet, or a bracketed numeral. Bars are measured against the printed time
    # signatures, so this needs them.
    tuplets: bool = True

    def __post_init__(self) -> None:
        if self.tuplets and not self.time_signatures:
            raise ValueError("repairs.tuplets needs repairs.timeSignatures")

    @classmethod
    def from_params(cls, value: Any) -> RepairSettings:
        """Read the ``repairs`` object of a process_pdf request; absent means defaults.

        Tuplets follow the time signatures when the request leaves them out."""
        if value is None:
            return cls()
        if not isinstance(value, dict):
            raise ValueError("repairs must be an object")
        unknown = set(value) - set(_PARAMS.values())
        if unknown:
            raise ValueError(f"Unknown repairs: {', '.join(sorted(unknown))}")
        for name in value:
            if not isinstance(value[name], bool):
                raise ValueError(f"repairs.{name} must be true or false")
        settings: dict[str, bool] = value
        time_signatures = settings.get("timeSignatures", True)
        return cls(
            shared_notehead_timing=settings.get("sharedNoteheadTiming", True),
            time_signatures=time_signatures,
            tuplets=settings.get("tuplets", time_signatures),
        )

    def to_manifest(self) -> dict[str, bool]:
        """How the cache records the repairs its pages were recognized with: pages
        recognized with other repairs are recognized again, in the same cache."""
        return {param: getattr(self, field) for field, param in _PARAMS.items()}
