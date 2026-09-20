#!/usr/bin/env python3
"""Measure how far detected staff curves depart from an ideal five-line grid.

The producer currently gates optional geometry on one property only: every
adjacent line gap at a sample must stay within half to one and a half times that
sample's mean gap. Placement, by contrast, reads only the outer lines and the
derived spacing. Whether the inner lines agree with an ideal grid anchored to the
outer lines is therefore a *different* property from the one being enforced, and
neither is evidence for the other.

This tool measures both, over accepted and rejected staffs alike, so that the
decision about which property should gate placement rests on distributions rather
than on the one page that happened to fail.

Inputs are sidecars that advertise geometry, and pre-validation captures written
by ``HOMR_ANNOTATION_GEOMETRY_CAPTURE_DIR`` for pages whose geometry was rejected.
Everything is read-only.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any, Iterable

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]

PERCENTILES = (50, 90, 99, 99.9, 100)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return math.nan
    ordered = sorted(values)
    if fraction >= 100:
        return ordered[-1]
    position = (len(ordered) - 1) * fraction / 100
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def summarize(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "mean": round(statistics.fmean(values), 5),
        **{f"p{p:g}": round(percentile(values, p), 5) for p in PERCENTILES},
    }


def staff_samples(staff: dict[str, Any]) -> dict[str, Any]:
    """Per-sample residuals for one physical staff.

    ``inner_deviation`` is the distance of each inner line from where an ideal,
    evenly spaced grid anchored to that sample's own outer lines would put it,
    expressed in staff spaces. ``gap_ratio`` is what the producer's validator
    actually tests.
    """
    lines = staff["lines"]
    size = len(lines[0])
    inner_deviation: list[float] = []
    worst_inner: list[float] = []
    gap_ratio_min: list[float] = []
    gap_ratio_max: list[float] = []
    units: list[float] = []
    top_step: list[float] = []
    bottom_step: list[float] = []
    unit_step: list[float] = []
    slope_step: list[float] = []
    leave_one_out_top: list[float] = []
    leave_one_out_bottom: list[float] = []
    leave_one_out_unit: list[float] = []
    neighbour_span: list[float] = []
    chord_vs_neighbour_slope: list[float] = []
    violating_samples: list[dict[str, Any]] = []

    previous: dict[str, float] | None = None
    for i in range(size):
        ys = [lines[j][i][1] for j in range(5)]
        x = lines[0][i][0]
        unit = (ys[4] - ys[0]) / 4
        if unit <= 0:
            violating_samples.append({"sample_index": i, "x": x, "reason": "non-positive-unit"})
            previous = None
            continue
        units.append(unit)
        gaps = [ys[j + 1] - ys[j] for j in range(4)]
        ratios = [gap / unit for gap in gaps]
        gap_ratio_min.append(min(ratios))
        gap_ratio_max.append(max(ratios))
        deviations = [abs(ys[j] - (ys[0] + j * unit)) / unit for j in (1, 2, 3)]
        inner_deviation.extend(deviations)
        worst_inner.append(max(deviations))
        if min(ratios) < 0.5 or max(ratios) > 1.5:
            violating_samples.append(
                {
                    "sample_index": i,
                    "x": round(x, 4),
                    "reason": "gap-ratio",
                    "gaps": [round(g, 4) for g in gaps],
                    "unit": round(unit, 4),
                    "worst_inner_deviation_spaces": round(max(deviations), 4),
                }
            )
        current = {"x": x, "top": ys[0], "bottom": ys[4], "unit": unit}
        if previous is not None:
            span = current["x"] - previous["x"]
            top_step.append(abs(current["top"] - previous["top"]) / unit)
            bottom_step.append(abs(current["bottom"] - previous["bottom"]) / unit)
            unit_step.append(abs(current["unit"] - previous["unit"]) / unit)
            if span > 0:
                slope_step.append(abs(current["top"] - previous["top"]) / span)
        previous = current

    # What the consumer would actually interpolate if one sample were dropped. This
    # is the quantity a bounded removal has to stay inside, and measuring it on
    # staffs that already pass gives the bound an empirical basis.
    for i in range(1, size - 1):
        left = [lines[j][i - 1] for j in range(5)]
        right = [lines[j][i + 1] for j in range(5)]
        here = [lines[j][i] for j in range(5)]
        span = right[0][0] - left[0][0]
        unit = (here[4][1] - here[0][1]) / 4
        if span <= 0 or unit <= 0:
            continue
        t = (here[0][0] - left[0][0]) / span
        chord = lambda a, b: a[1] + (b[1] - a[1]) * t  # noqa: E731
        leave_one_out_top.append(abs(here[0][1] - chord(left[0], right[0])) / unit)
        leave_one_out_bottom.append(abs(here[4][1] - chord(left[4], right[4])) / unit)
        left_unit = (left[4][1] - left[0][1]) / 4
        right_unit = (right[4][1] - right[0][1]) / 4
        leave_one_out_unit.append(abs(unit - (left_unit + (right_unit - left_unit) * t)) / unit)
        neighbour_span.append(span / unit)
        # How far the chord across a removed sample departs from where the local
        # slope just outside it was heading, integrated over the span. This is the
        # slope-agreement quantity a bounded removal has to stay inside.
        chord_slope = (right[0][1] - left[0][1]) / span
        for outside in (i - 2, i + 2):
            if 0 <= outside < size:
                near = lines[0][i - 1 if outside < i else i + 1]
                far = lines[0][outside]
                step = near[0] - far[0]
                if step != 0:
                    local = (near[1] - far[1]) / step
                    chord_vs_neighbour_slope.append(abs(chord_slope - local) * span / unit)

    return {
        "staff_id": staff.get("staff_id"),
        "system_index": staff.get("system_index"),
        "samples": size,
        "median_unit": round(statistics.median(units), 4) if units else None,
        "violating_samples": violating_samples,
        "metrics": {
            "inner_deviation_spaces": inner_deviation,
            "worst_inner_deviation_spaces": worst_inner,
            "gap_ratio_min": gap_ratio_min,
            "gap_ratio_max": gap_ratio_max,
            "outer_top_step_spaces": top_step,
            "outer_bottom_step_spaces": bottom_step,
            "unit_step_spaces": unit_step,
            "outer_top_slope": slope_step,
            "leave_one_out_top_spaces": leave_one_out_top,
            "leave_one_out_bottom_spaces": leave_one_out_bottom,
            "leave_one_out_unit_spaces": leave_one_out_unit,
            "neighbour_span_spaces": neighbour_span,
            "chord_vs_neighbour_slope_spaces": chord_vs_neighbour_slope,
        },
    }


def page_staffs(path: Path) -> tuple[str, list[dict[str, Any]], dict[str, Any] | None]:
    """Return ``(kind, staffs, rejection)`` for a sidecar or a capture file.

    A sidecar that advertises no geometry and reports no reason was written before
    the capability existed. Calling that a rejection would invent a verdict the
    producer never reached.
    """
    document = json.loads(path.read_text(encoding="utf-8"))
    if "pre_validation_staffs" in document:
        return "capture", document["pre_validation_staffs"], (
            document["diagnostics"][0] if document.get("diagnostics") else None
        )
    geometry = document.get("annotation_geometry")
    if geometry:
        return "accepted", geometry["staffs"], None
    rejection = document.get("annotation_geometry_rejection") or (
        {"message": document["annotation_geometry_error"]}
        if document.get("annotation_geometry_error")
        else None
    )
    return ("rejected-without-capture" if rejection else "legacy-missing"), [], rejection


def merge(metrics: Iterable[dict[str, list[float]]]) -> dict[str, list[float]]:
    merged: dict[str, list[float]] = {}
    for entry in metrics:
        for key, values in entry.items():
            merged.setdefault(key, []).extend(values)
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        help="sidecars, capture files, or directories containing them",
    )
    parser.add_argument("--output", type=Path, required=True, help="JSON report path")
    parser.add_argument(
        "--label",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="give one input an explicit corpus label",
    )
    arguments = parser.parse_args()

    labels = dict(entry.split("=", 1) for entry in arguments.label)
    paths: list[Path] = []
    for entry in arguments.inputs:
        if entry.is_dir():
            paths.extend(sorted(entry.rglob("*.homr.visual.json")))
            paths.extend(sorted(entry.rglob("*.annotation-capture.json")))
        else:
            paths.append(entry)

    pages: list[dict[str, Any]] = []
    for path in paths:
        kind, staffs, rejection = page_staffs(path)
        measured = [staff_samples(staff) for staff in staffs]
        pages.append(
            {
                "path": str(path),
                "label": labels.get(str(path), path.stem),
                "kind": kind,
                "rejection": rejection,
                "staff_count": len(measured),
                "staffs": [
                    {key: value for key, value in staff.items() if key != "metrics"}
                    for staff in measured
                ],
                "_metrics": [staff["metrics"] for staff in measured],
            }
        )

    report: dict[str, Any] = {"version": 1, "percentiles": list(PERCENTILES), "pages": []}
    by_kind: dict[str, list[dict[str, list[float]]]] = {}
    for page in pages:
        metrics = merge(page["_metrics"])
        by_kind.setdefault(page["kind"], []).extend(page["_metrics"])
        report["pages"].append(
            {
                **{key: value for key, value in page.items() if key != "_metrics"},
                "summary": {key: summarize(values) for key, values in metrics.items()},
            }
        )
    report["corpus"] = {
        kind: {key: summarize(values) for key, values in merge(entries).items()}
        for kind, entries in by_kind.items()
    }
    report["corpus"]["all"] = {
        key: summarize(values)
        for key, values in merge(entry for entries in by_kind.values() for entry in entries).items()
    }

    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2), encoding="utf-8")

    for kind, summary in report["corpus"].items():
        print(f"\n== {kind} ==")
        for key in (
            "worst_inner_deviation_spaces",
            "gap_ratio_min",
            "gap_ratio_max",
            "outer_top_step_spaces",
            "unit_step_spaces",
            "leave_one_out_top_spaces",
            "leave_one_out_bottom_spaces",
            "leave_one_out_unit_spaces",
            "neighbour_span_spaces",
            "chord_vs_neighbour_slope_spaces",
        ):
            entry = summary.get(key, {"count": 0})
            if entry["count"]:
                print(
                    f"  {key:32s} n={entry['count']:7d} "
                    f"p50={entry['p50']:.4f} p90={entry['p90']:.4f} "
                    f"p99={entry['p99']:.4f} max={entry['p100']:.4f}"
                )
    print(f"\nReport: {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
