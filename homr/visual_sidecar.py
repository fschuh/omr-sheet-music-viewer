import itertools
import json
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from homr import constants
from homr.bounding_boxes import BoundingEllipse, RotatedBoundingBox
from homr.model import Note, Staff
from homr.note_detection import split_clumps_of_noteheads
from homr.transformer.vocabulary import (
    EncodedSymbol,
    remove_duplicated_symbols,
    sort_token_chords,
)

STRETCHED_NOTEHEAD_ASPECT_RATIO = 2.0
HORIZONTAL_HOLLOW_NOTEHEAD_ASPECT_RATIO = 1.8
MAX_RECONSTRUCTED_STEM_DISTANCE_IN_NOTEHEADS = 8.0
MAX_STEM_COMPONENT_GAP_IN_NOTEHEADS = 1.5
VISUAL_MOMENT_X_TOLERANCE = 6.0
DUPLICATE_NOTEHEAD_AREA_RATIO = 0.6
DUPLICATE_NOTEHEAD_MAX_HORIZONTAL_DISTANCE = 1.5
DUPLICATE_NOTEHEAD_MAX_VERTICAL_DISTANCE = 0.3
MAX_CHORD_NOTEHEAD_HORIZONTAL_GAP_RATIO = 0.25
MAX_VISUAL_GROUP_DISTANCE_FROM_CLEF = 16.0


class StemRepairDirection(Enum):
    UP = "up"
    DOWN = "down"


def sounding_pitch(symbol: EncodedSymbol) -> str | None:
    if symbol.pitch in ("_", "."):
        return None
    if symbol.lift in ("#", "##", "b", "bb"):
        return f"{symbol.pitch[0]}{symbol.lift}{symbol.pitch[1:]}"
    return symbol.pitch


@dataclass(frozen=True)
class PreprocessingMetadata:
    source_image_size: tuple[int, int]
    autocrop_box: tuple[int, int, int, int]
    cropped_size: tuple[int, int]
    resized_size: tuple[int, int]
    resize_scale: tuple[float, float]
    prediction_size: tuple[int, int]

    def prediction_point_to_source(self, point: tuple[float, float]) -> tuple[float, float]:
        pred_w, pred_h = self.prediction_size
        resized_w, resized_h = self.resized_size
        crop_x, crop_y, _crop_w, _crop_h = self.autocrop_box
        x = point[0] * resized_w / pred_w
        y = point[1] * resized_h / pred_h
        return (x / self.resize_scale[0] + crop_x, y / self.resize_scale[1] + crop_y)

    def prediction_contour_to_source(self, contour: Any) -> list[list[float]]:
        points = np.asarray(contour).reshape(-1, 2)
        return [
            [round(x, 3), round(y, 3)]
            for x, y in (
                self.prediction_point_to_source((float(p[0]), float(p[1]))) for p in points
            )
        ]

    def _ellipse_to_json(self, ellipse: Any) -> dict[str, Any]:
        center, size, angle = ellipse
        width = float(size[0])
        height = float(size[1])
        if width >= height:
            rx = width / 2
            ry = height / 2
            svg_angle = float(angle)
        else:
            rx = height / 2
            ry = width / 2
            svg_angle = float(angle) + 90
        while svg_angle > 90:
            svg_angle -= 180
        while svg_angle <= -90:
            svg_angle += 180
        return {
            "center": [round(float(center[0]), 3), round(float(center[1]), 3)],
            "rx": round(rx, 3),
            "ry": round(ry, 3),
            "angle": round(svg_angle, 3),
        }

    def prediction_ellipse_to_source(self, ellipse: Any) -> dict[str, Any]:
        center, size, angle = ellipse
        pred_w, pred_h = self.prediction_size
        resized_w, resized_h = self.resized_size
        source_center = self.prediction_point_to_source((float(center[0]), float(center[1])))
        source_width = float(size[0]) * resized_w / pred_w / self.resize_scale[0]
        source_height = float(size[1]) * resized_h / pred_h / self.resize_scale[1]
        return self._ellipse_to_json((source_center, (source_width, source_height), angle))

    def prediction_contour_ellipse_to_source(
        self, contour: Any, fallback_ellipse: Any
    ) -> dict[str, Any]:
        source_points = np.asarray(self.prediction_contour_to_source(contour), dtype=np.float32)
        if len(source_points) >= 5:
            source_contour = source_points.reshape(-1, 1, 2)
            return self._ellipse_to_json(cv2.fitEllipse(source_contour))
        return self.prediction_ellipse_to_source(fallback_ellipse)


@dataclass
class VisualGroup:
    visual_id: str
    staff_index: int
    stave_index: int
    staff_position: int
    prediction_center: tuple[float, float]
    transformer_center: tuple[float, float] | None
    notehead_ellipses: list[dict[str, Any]]
    notehead_contours: list[list[list[float]]]
    detected_notehead_contours: list[list[list[float]]]
    refined_notehead_contours: list[list[list[float]]]
    detected_stem_contours: list[list[list[float]]]
    stem_contours: list[list[list[float]]]
    owned_stem_component_ids: list[str]
    is_hollow_notehead: bool
    duration: str | None = None
    linked_musicxml_ids: list[str] = field(default_factory=list)

    @property
    def bbox(self) -> list[float]:
        points = [
            point for contour in self.notehead_contours + self.stem_contours for point in contour
        ]
        if not points:
            return []
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]


@dataclass
class MusicXmlNoteRecord:
    musicxml_id: str
    part: int
    measure: int
    staff: int
    voice: int
    pitch: str | None
    duration: str
    match_confidence: float
    visual_group_id: str | None


@dataclass
class VisualMatch:
    symbol: EncodedSymbol
    visual_id: str | None
    confidence: float


@dataclass
class StructuralMatchPlan:
    assignments: list[tuple[int, int]]
    reserved_group_indices: set[int]


@dataclass
class StemOwnershipCache:
    component_by_fragment_id: dict[int, int]
    owner_note_ids_by_component: dict[int, set[int]]


class VisualSidecar:
    def __init__(
        self,
        metadata: PreprocessingMetadata,
        stem_fragments: list[RotatedBoundingBox] | None = None,
        notehead_mask: Any | None = None,
        notehead_candidates: list[Any] | None = None,
        source_image: Any | None = None,
    ) -> None:
        self.metadata = metadata
        self.stem_fragments = stem_fragments or []
        self.notehead_mask = notehead_mask
        self.notehead_candidates = notehead_candidates or []
        self.source_image = source_image
        self._recovery_notes_by_staff_id: dict[int, list[Note]] = {}
        self._stave_index_by_visual_id: dict[str, int] = {}
        self._stem_ownership_cache: StemOwnershipCache | None = None
        self.visual_groups: dict[str, VisualGroup] = {}
        self.matches_by_symbol_id: dict[int, VisualMatch] = {}
        self.musicxml_notes: list[MusicXmlNoteRecord] = []
        self.unmatched_visual_notes: set[str] = set()
        self._next_musicxml_note_id = 1
        self._next_recovered_visual_id = 1
        self._next_transformer_recovered_visual_id = 1

    def prepare_recovery_notes(self, staffs: list[Staff]) -> None:
        """Assign real, inference-excluded candidates to their nearest staff.

        These notes are used exclusively for sidecar geometry. They are never added to
        ``staff.symbols`` and therefore cannot affect TrOMR inference or MusicXML output.
        """
        self._recovery_notes_by_staff_id = {id(staff): [] for staff in staffs}
        self._stave_index_by_visual_id = {
            note.visual_id: self._stave_index_for_center(staff, note.center)
            for staff in staffs
            for note in staff.get_notes()
            if note.visual_id is not None
        }
        existing_notes = [note for staff in staffs for note in staff.get_notes()]
        for candidate in self.notehead_candidates:
            notehead = candidate.notehead
            eligible: list[Staff] = []
            for staff in staffs:
                if not staff.get_notes():
                    continue
                if not (
                    staff.min_x - constants.staff_position_tolerance
                    <= notehead.center[0]
                    <= staff.max_x + constants.staff_position_tolerance
                ):
                    continue
                sidecar_tolerance = (
                    constants.max_number_of_ledger_lines + 1
                ) * staff.average_unit_size
                if (
                    notehead.center[1] >= staff.min_y - sidecar_tolerance
                    and notehead.center[1] <= staff.max_y + sidecar_tolerance
                ):
                    eligible.append(staff)
            if not eligible:
                continue
            staff = min(
                eligible,
                key=lambda item: min(
                    np.linalg.norm(np.subtract(note.center, notehead.center))
                    for note in item.get_notes()
                ),
            )
            split_candidates = (
                split_clumps_of_noteheads(candidate, self.notehead_mask, staff)
                if self.notehead_mask is not None
                else [candidate]
            )
            for split_candidate in split_candidates:
                split_notehead = split_candidate.notehead
                if any(split_notehead.is_overlapping(note.box) for note in existing_notes):
                    continue
                point = staff.get_at(split_notehead.center[0])
                unit_size = point.average_unit_size if point is not None else staff.average_unit_size
                if (
                    split_notehead.size[0] < 0.45 * unit_size
                    # Keep the inference filter untouched. Sidecar recovery gets a
                    # small allowance for mask contours that include ledger-line ink.
                    or split_notehead.size[0] > 3.25 * unit_size
                    or split_notehead.size[1] < 0.45 * unit_size
                    or split_notehead.size[1] > 2 * unit_size
                ):
                    continue
                if point is not None:
                    position = point.find_position_in_unit_sizes(split_notehead)
                else:
                    nearest_point = min(
                        staff.grid, key=lambda item: abs(item.x - split_notehead.center[0])
                    )
                    position = nearest_point.find_position_in_unit_sizes(split_notehead)
                visual_id = f"vnote-recovered-{self._next_recovered_visual_id}"
                self._next_recovered_visual_id += 1
                self._stave_index_by_visual_id[visual_id] = self._stave_index_for_center(
                    staff, split_notehead.center
                )
                self._recovery_notes_by_staff_id[id(staff)].append(
                    Note(
                        split_notehead,
                        position,
                        split_candidate.stem,
                        split_candidate.stem_direction,
                        visual_id,
                    )
                )
        all_visual_notes = [note for staff in staffs for note in staff.get_notes()]
        all_visual_notes.extend(
            note
            for recovered in self._recovery_notes_by_staff_id.values()
            for note in recovered
        )
        self._stem_ownership_cache = self._build_stem_ownership_cache(all_visual_notes)

    def recovery_notes_for_staff(self, staff: Staff) -> list[Note]:
        return self._recovery_notes_by_staff_id.get(id(staff), [])

    @staticmethod
    def _stave_index_for_center(staff: Staff, center: tuple[float, float]) -> int:
        point = staff.get_at(center[0])
        if point is None:
            point = min(staff.grid, key=lambda candidate: abs(candidate.x - center[0]))
        lines_per_stave = constants.number_of_lines_on_a_staff
        line_groups = [
            point.y[index : index + lines_per_stave]
            for index in range(0, len(point.y), lines_per_stave)
        ]
        return min(
            range(len(line_groups)),
            key=lambda index: min(abs(line_y - center[1]) for line_y in line_groups[index]),
        )

    def add_staff_visual_notes(
        self, staff_index: int, original_notes: list[Note], transformed_notes: list[Note]
    ) -> None:
        stem_ownership = self._stem_ownership_cache or self._build_stem_ownership_cache(
            original_notes
        )
        for original, transformed in zip(original_notes, transformed_notes, strict=False):
            if original.visual_id is None:
                continue
            notehead_contour = self.metadata.prediction_contour_to_source(original.box.polygon)
            detected_notehead_contour = self._detected_notehead_contour(original)
            refined_notehead_contour = self._refined_notehead_contour(original, original_notes)
            recovered_stretched_notehead = (
                self._is_stretched_notehead(original) and refined_notehead_contour is not None
            )
            is_hollow_notehead = self._is_hollow_notehead(original)
            if recovered_stretched_notehead:
                notehead_contour = refined_notehead_contour
                notehead_ellipse = self._ellipse_from_source_contour(refined_notehead_contour)
            else:
                notehead_ellipse = self._notehead_ellipse_for_visual_sidecar(original)
            notehead_ellipse["_is_hollow"] = is_hollow_notehead
            detected_stem_contours = []
            if original.stem is not None:
                detected_stem_contours.append(
                    self.metadata.prediction_contour_to_source(original.stem.contours)
                )
            stem_contours = []
            stem = self._visual_sidecar_stem_for_note(original, stem_ownership)
            if stem is not None:
                stem_contours.append(
                    self.metadata.prediction_contour_to_source(stem.polygon)
                )
            owned_stem_component_ids = sorted(
                f"staff-{staff_index}-stem-{component}"
                for component, owner_note_ids in stem_ownership.owner_note_ids_by_component.items()
                if id(original) in owner_note_ids and len(owner_note_ids) > 1
            )
            self.visual_groups[original.visual_id] = VisualGroup(
                visual_id=original.visual_id,
                staff_index=staff_index,
                stave_index=self._stave_index_by_visual_id.get(original.visual_id, 0),
                staff_position=original.position,
                prediction_center=original.center,
                transformer_center=transformed.center,
                notehead_ellipses=[notehead_ellipse],
                notehead_contours=[notehead_contour],
                detected_notehead_contours=[detected_notehead_contour],
                refined_notehead_contours=(
                    [refined_notehead_contour] if refined_notehead_contour is not None else []
                ),
                detected_stem_contours=detected_stem_contours,
                stem_contours=stem_contours,
                owned_stem_component_ids=owned_stem_component_ids,
                is_hollow_notehead=is_hollow_notehead,
            )
            self.unmatched_visual_notes.add(original.visual_id)

    def _detected_notehead_contour(self, note: Note) -> list[list[float]]:
        """Return the segmentation contour while preserving the legacy polygon separately."""
        mask_contour = self._notehead_mask_contour(note)
        contour = mask_contour if mask_contour is not None else note.box.contours
        return self.metadata.prediction_contour_to_source(contour)

    def _ellipse_from_source_contour(self, contour: list[list[float]]) -> dict[str, Any]:
        points = np.asarray(contour, dtype=np.float32).reshape(-1, 1, 2)
        ellipse = self.metadata._ellipse_to_json(cv2.fitEllipse(points))
        ellipse["_fit_source"] = "recovered"
        return ellipse

    @staticmethod
    def _is_stretched_notehead(note: Note) -> bool:
        height = max(float(note.box.size[1]), 1.0)
        return float(note.box.size[0]) / height > STRETCHED_NOTEHEAD_ASPECT_RATIO

    def _is_hollow_notehead(self, note: Note) -> bool:
        if self.source_image is None:
            return False
        image = self.source_image
        if image.ndim == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        polygon = np.asarray(note.box.polygon, dtype=np.int32).reshape(-1, 2)
        left = max(0, int(np.min(polygon[:, 0])))
        top = max(0, int(np.min(polygon[:, 1])))
        right = min(image.shape[1], int(np.max(polygon[:, 0])) + 1)
        bottom = min(image.shape[0], int(np.max(polygon[:, 1])) + 1)
        if right <= left or bottom <= top:
            return False
        local_polygon = polygon - np.array([left, top])
        mask = np.zeros((bottom - top, right - left), dtype=np.uint8)
        cv2.fillPoly(mask, [local_polygon.reshape(-1, 1, 2)], 1)
        pixels = image[top:bottom, left:right][mask > 0]
        if len(pixels) == 0:
            return False
        return float(np.mean(pixels < 160)) < 0.7

    def _refined_notehead_contour(
        self, note: Note, neighboring_notes: list[Note]
    ) -> list[list[float]] | None:
        """Fit the outer notehead boundary to source-image darkness and contrast."""
        if self.source_image is None:
            return None
        image = self.source_image
        if image.ndim == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        expected_height = max(float(note.box.size[1]), 4.0)
        cx, cy = note.center
        close_neighbors = []
        for other in neighboring_notes:
            if other is note:
                continue
            delta_x = float(other.center[0] - cx)
            delta_y = float(other.center[1] - cy)
            distance = float(np.hypot(delta_x, delta_y))
            if 0 < distance <= expected_height * 2.2:
                close_neighbors.append((delta_x / distance, delta_y / distance, distance))
        radius_x = int(np.ceil(expected_height * 2.0))
        radius_y = int(np.ceil(expected_height * 1.5))
        left = max(0, int(round(cx)) - radius_x)
        right = min(image.shape[1], int(round(cx)) + radius_x + 1)
        top = max(0, int(round(cy)) - radius_y)
        bottom = min(image.shape[0], int(round(cy)) + radius_y + 1)
        if right - left < 7 or bottom - top < 7:
            return None

        darkness = 1.0 - image[top:bottom, left:right].astype(np.float32) / 255.0
        sample_angles = np.linspace(0, 2 * np.pi, 96, endpoint=False, dtype=np.float32)
        unit_x = np.cos(sample_angles)
        unit_y = np.sin(sample_angles)

        def sample(values_x: np.ndarray, values_y: np.ndarray) -> np.ndarray:
            ix = np.clip(np.rint(values_x - left).astype(np.int32), 0, darkness.shape[1] - 1)
            iy = np.clip(np.rint(values_y - top).astype(np.int32), 0, darkness.shape[0] - 1)
            return darkness[iy, ix]

        fill_angles = np.linspace(0, 2 * np.pi, 32, endpoint=False, dtype=np.float32)
        fill_unit_x = np.cos(fill_angles)
        fill_unit_y = np.sin(fill_angles)
        center_evidence = np.concatenate(
            [
                sample(
                    cx + expected_height * radius * fill_unit_x,
                    cy + expected_height * radius * fill_unit_y,
                )
                for radius in (0.08, 0.18, 0.28)
            ]
        )
        is_filled_notehead = float(np.mean(center_evidence)) >= 0.62

        def score(
            params: tuple[float, float, float, float, float],
            center_anchor: tuple[float, float] | None,
        ) -> float:
            center_x, center_y, radius_major, radius_minor, angle = params
            theta = np.deg2rad(angle)
            cos_t, sin_t = np.cos(theta), np.sin(theta)
            base_x = radius_major * unit_x
            base_y = radius_minor * unit_y

            def ring(scale: float) -> np.ndarray:
                return sample(
                    center_x + scale * (cos_t * base_x - sin_t * base_y),
                    center_y + scale * (sin_t * base_x + cos_t * base_y),
                )

            boundary = np.maximum.reduce([ring(0.94), ring(1.0), ring(1.06)])
            outside = np.minimum.reduce([ring(1.18), ring(1.26)])
            support = boundary * (1.0 - 0.65 * outside)
            # A staff or stem may occlude a small arc. A trimmed mean rewards the
            # supported outer boundary without letting those straight runs dominate.
            supported = np.sort(support)[10:]
            sectors = support.reshape(12, -1).max(axis=1)
            coverage = float(np.mean(sectors > 0.35))
            center_penalty = 0.0
            if center_anchor is not None:
                center_penalty = 0.025 * (
                    abs(center_x - center_anchor[0]) / expected_height
                    + abs(center_y - center_anchor[1]) / expected_height
                )
            neighbor_penalty = 0.0
            for direction_x, direction_y, distance in close_neighbors:
                local_direction_x = cos_t * direction_x + sin_t * direction_y
                local_direction_y = -sin_t * direction_x + cos_t * direction_y
                extent = np.sqrt(
                    (radius_major * local_direction_x) ** 2
                    + (radius_minor * local_direction_y) ** 2
                )
                center_shift = (center_x - cx) * direction_x + (center_y - cy) * direction_y
                # Adjacent chord heads may touch, but neither fitted boundary may
                # travel materially beyond the midpoint toward the other center.
                overflow = center_shift + extent - distance * 0.52
                neighbor_penalty += 1.5 * max(0.0, overflow / expected_height)
            interior_score = 0.0
            if is_filled_notehead:
                interior = np.concatenate(
                    [
                        ring(radius)
                        for radius in (0.12, 0.3, 0.48, 0.66)
                    ]
                )
                interior_score = 0.32 * float(np.mean(interior))
            return float(
                np.mean(supported)
                + 0.22 * coverage
                + interior_score
                - center_penalty
                - neighbor_penalty
            )

        initial_angles = (-35.0, -20.0, -5.0, 10.0)
        detection_is_stretched = self._is_stretched_notehead(note)
        initial_major_ratio = 0.62 if detection_is_stretched else 0.72
        initial_minor_ratio = 0.46 if detection_is_stretched else 0.50
        anchored = max(
            (
                (
                    cx,
                    cy,
                    expected_height * initial_major_ratio,
                    expected_height * initial_minor_ratio,
                    angle,
                )
                for angle in initial_angles
            ),
            key=lambda item: score(item, None),
        )
        recovered = anchored
        if detection_is_stretched:
            center_candidates = []
            for offset_x in np.linspace(-0.7, 0.7, 8):
                for offset_y in np.linspace(-0.6, 0.6, 7):
                    for angle in initial_angles:
                        center_candidates.append(
                            (
                                cx + float(offset_x) * expected_height,
                                cy + float(offset_y) * expected_height,
                                expected_height * 0.62,
                                expected_height * 0.46,
                                angle,
                            )
                        )
            recovered_candidate = max(center_candidates, key=lambda item: score(item, None))
            if score(recovered_candidate, None) >= score(anchored, None) + 0.045:
                recovered = recovered_candidate
        recovered_center = (recovered[0], recovered[1])

        candidates = [
            (
                recovered_center[0],
                recovered_center[1],
                expected_height * initial_major_ratio,
                expected_height * initial_minor_ratio,
                angle,
            )
            for angle in initial_angles
        ]
        params = max(candidates, key=lambda item: score(item, recovered_center))
        center_limit_x = 0.28 if detection_is_stretched else 0.75
        center_limit_y = 0.28 if detection_is_stretched else 0.65
        major_min = 0.50 if detection_is_stretched else 0.52
        major_max = 0.84 if detection_is_stretched else 0.95
        steps = ((0.24, 12.0), (0.12, 6.0), (0.06, 3.0), (0.03, 1.5))
        for relative_step, angle_step in steps:
            center_step = expected_height * relative_step
            dimensions = (
                (
                    0,
                    center_step,
                    recovered_center[0] - expected_height * center_limit_x,
                    recovered_center[0] + expected_height * center_limit_x,
                ),
                (
                    1,
                    center_step,
                    recovered_center[1] - expected_height * center_limit_y,
                    recovered_center[1] + expected_height * center_limit_y,
                ),
                (2, center_step, expected_height * major_min, expected_height * major_max),
                (3, center_step, expected_height * 0.36, expected_height * 0.68),
                (4, angle_step, -55.0, 25.0),
            )
            for index, amount, minimum, maximum in dimensions:
                options = []
                for offset in (-2, -1, 0, 1, 2):
                    option = list(params)
                    option[index] = min(max(option[index] + offset * amount, minimum), maximum)
                    if option[3] * 1.05 <= option[2] <= option[3] * 1.85:
                        options.append(tuple(option))
                params = max(options, key=lambda item: score(item, recovered_center))

        if score(params, recovered_center) < 0.34:
            return None
        center = (params[0], params[1])
        size = (params[2] * 2, params[3] * 2)
        angle = params[4]
        contour = cv2.ellipse2Poly(
            (int(round(center[0])), int(round(center[1]))),
            (max(1, int(round(size[0] / 2))), max(1, int(round(size[1] / 2)))),
            int(round(angle)),
            0,
            360,
            3,
        ).reshape(-1, 1, 2)
        return self.metadata.prediction_contour_to_source(contour)

    def _raw_stem_contours_for_output(self) -> list[dict[str, Any]]:
        return [
            {
                "debug_id": stem.debug_id,
                "contour": self.metadata.prediction_contour_to_source(stem.contours),
                "bbox": self.metadata.prediction_contour_to_source(stem.polygon),
            }
            for stem in self.stem_fragments
        ]

    def add_staff_matches(
        self,
        symbols: list[EncodedSymbol],
        staff_index: int,
        source_staff: Staff | None = None,
    ) -> None:
        # Match the same cleaned symbol identities that MusicXML generation will
        # retain. In particular, a duplicate pitch inside one predicted chord must
        # not consume a second visual group and shift every following note.
        symbols = remove_duplicated_symbols(symbols, cleanup_tuplets=False)
        self._discard_visual_groups_near_clefs(symbols, staff_index)
        self._discard_duplicate_notehead_fragments(staff_index)
        visual_groups = [
            group for group in self.visual_groups.values() if group.staff_index == staff_index
        ]
        note_symbols = [
            symbol
            for symbol in symbols
            if symbol.rhythm.startswith(("note", "rest")) and symbol.pitch not in ("_", ".")
        ]

        assignments = self._assign_around_locked_matches(
            note_symbols, visual_groups, []
        )

        moment_plan = self._structural_moment_assignments(symbols, note_symbols, visual_groups)
        if moment_plan is not None:
            assignments = self._assign_around_locked_matches(
                note_symbols,
                visual_groups,
                moment_plan.assignments,
                moment_plan.reserved_group_indices,
            )
        assignments = self._repair_chord_assignments(
            symbols, note_symbols, visual_groups, assignments
        )
        assignments = self._repair_adjacent_sequence_inversions(
            symbols, note_symbols, visual_groups, assignments
        )
        assignments = self._release_split_moment_outliers(
            symbols, note_symbols, visual_groups, assignments
        )
        assigned_symbols = {symbol_index for symbol_index, _ in assignments}

        assigned_group_by_symbol_id: dict[int, VisualGroup] = {}
        for symbol_index, group_index in assignments:
            symbol = note_symbols[symbol_index]
            visual_group = visual_groups[group_index]
            assigned_group_by_symbol_id[symbol.visual_match_id] = visual_group
            confidence = self._score_match(symbol, visual_group)
            visual_group.duration = symbol.rhythm
            self.matches_by_symbol_id[symbol.visual_match_id] = VisualMatch(
                symbol=symbol,
                visual_id=visual_group.visual_id,
                confidence=confidence,
            )
            self.unmatched_visual_notes.discard(visual_group.visual_id)

        for symbol_index, symbol in enumerate(note_symbols):
            if symbol_index in assigned_symbols:
                continue
            chord_mates = [
                (mate, assigned_group_by_symbol_id[mate.visual_match_id])
                for chord in sort_token_chords(symbols)
                if any(candidate.visual_match_id == symbol.visual_match_id for candidate in chord)
                for mate in chord
                if (
                    mate.visual_match_id != symbol.visual_match_id
                    and mate.visual_match_id in assigned_group_by_symbol_id
                )
            ]
            recovered_group = self._recover_transformer_chord_notehead(
                symbol,
                staff_index,
                source_staff,
                visual_groups,
                chord_mates,
            )
            if recovered_group is not None:
                self.visual_groups[recovered_group.visual_id] = recovered_group
                visual_groups.append(recovered_group)
                self.matches_by_symbol_id[symbol.visual_match_id] = VisualMatch(
                    symbol=symbol,
                    visual_id=recovered_group.visual_id,
                    confidence=self._score_match(symbol, recovered_group),
                )
                continue
            self.matches_by_symbol_id[symbol.visual_match_id] = VisualMatch(
                symbol=symbol,
                visual_id=None,
                confidence=0.0,
            )

        self._merge_split_whole_note_fragments(staff_index)

    def _discard_visual_groups_near_clefs(
        self, symbols: list[EncodedSymbol], staff_index: int
    ) -> None:
        """Remove notehead candidates sitting on recognized clef glyphs."""
        clef_centers = [
            symbol.coordinates
            for symbol in symbols
            if symbol.rhythm.startswith("clef") and symbol.coordinates is not None
        ]
        if not clef_centers:
            return
        clef_artifact_ids = {
            group.visual_id
            for group in self.visual_groups.values()
            if group.staff_index == staff_index
            and group.transformer_center is not None
            and any(
                np.linalg.norm(
                    np.subtract(group.transformer_center, clef_center)
                )
                <= MAX_VISUAL_GROUP_DISTANCE_FROM_CLEF
                for clef_center in clef_centers
            )
        }
        for visual_id in clef_artifact_ids:
            self.unmatched_visual_notes.discard(visual_id)
            del self.visual_groups[visual_id]

    def _discard_duplicate_notehead_fragments(self, staff_index: int) -> None:
        """Drop weak horizontal fragments duplicated from a nearby notehead.

        Segmentation can emit a small, hollow-looking fragment beside a full
        notehead while attaching both candidates to the exact same detected stem.
        Keeping both candidates shifts matching through dense note sequences. A
        genuine chord may also share a stem, so require the fragment to have much
        less detected ink and nearly the same vertical center as the full head.
        """
        staff_groups = [
            group
            for group in self.visual_groups.values()
            if group.staff_index == staff_index
        ]
        duplicate_ids: set[str] = set()
        for fragment in staff_groups:
            if not fragment.is_hollow_notehead or not fragment.detected_stem_contours:
                continue
            fragment_area = self._detected_notehead_area(fragment)
            fragment_bounds = self._source_notehead_bounds(fragment)
            if fragment_area <= 0 or fragment_bounds is None:
                continue
            for notehead in staff_groups:
                if (
                    notehead.visual_id == fragment.visual_id
                    or notehead.stave_index != fragment.stave_index
                    or notehead.detected_stem_contours
                    != fragment.detected_stem_contours
                ):
                    continue
                notehead_area = self._detected_notehead_area(notehead)
                notehead_bounds = self._source_notehead_bounds(notehead)
                if notehead_area <= 0 or notehead_bounds is None:
                    continue
                if fragment_area > notehead_area * DUPLICATE_NOTEHEAD_AREA_RATIO:
                    continue
                fragment_width = fragment_bounds[2] - fragment_bounds[0]
                fragment_height = fragment_bounds[3] - fragment_bounds[1]
                notehead_width = notehead_bounds[2] - notehead_bounds[0]
                notehead_height = notehead_bounds[3] - notehead_bounds[1]
                max_width = max(fragment_width, notehead_width, 1.0)
                max_height = max(fragment_height, notehead_height, 1.0)
                center_dx = abs(
                    fragment.prediction_center[0] - notehead.prediction_center[0]
                )
                center_dy = abs(
                    fragment.prediction_center[1] - notehead.prediction_center[1]
                )
                if (
                    center_dx
                    <= max_width * DUPLICATE_NOTEHEAD_MAX_HORIZONTAL_DISTANCE
                    and center_dy
                    <= max_height * DUPLICATE_NOTEHEAD_MAX_VERTICAL_DISTANCE
                ):
                    duplicate_ids.add(fragment.visual_id)
                    break

        for visual_id in duplicate_ids:
            self.unmatched_visual_notes.discard(visual_id)
            del self.visual_groups[visual_id]

    @staticmethod
    def _detected_notehead_area(group: VisualGroup) -> float:
        return sum(
            abs(
                cv2.contourArea(
                    np.asarray(contour, dtype=np.float32).reshape(-1, 1, 2)
                )
            )
            for contour in group.detected_notehead_contours
            if len(contour) >= 3
        )

    def _merge_split_whole_note_fragments(self, staff_index: int) -> None:
        """Rejoin whole-note heads split into touching horizontal fragments.

        Staff lines can divide the outline of a vertically stacked whole-note chord
        into four segmentation components: a left and right half for each actual
        head. Recognition still emits the correct two-note chord, leaving one half
        of each head unmatched. Rejoin only those tightly touching, stemless hollow
        fragments that share an exact staff position with a recognized whole note.
        """
        matched_groups = [
            group
            for group in self.visual_groups.values()
            if (
                group.staff_index == staff_index
                and group.duration is not None
                and group.duration.rstrip(".") == "note_1"
                and group.is_hollow_notehead
                and not group.stem_contours
            )
        ]
        for group in matched_groups:
            candidates = [
                candidate
                for candidate in self.visual_groups.values()
                if (
                    candidate.visual_id in self.unmatched_visual_notes
                    and candidate.staff_index == group.staff_index
                    and candidate.stave_index == group.stave_index
                    and candidate.staff_position == group.staff_position
                    and candidate.is_hollow_notehead
                    and not candidate.stem_contours
                    and self._looks_like_horizontal_notehead_fragment(group, candidate)
                )
            ]
            if not candidates:
                continue
            fragment = min(
                candidates,
                key=lambda candidate: abs(
                    candidate.prediction_center[0] - group.prediction_center[0]
                ),
            )
            self._merge_notehead_fragment(group, fragment)
            self.unmatched_visual_notes.discard(fragment.visual_id)
            del self.visual_groups[fragment.visual_id]

    @staticmethod
    def _source_notehead_bounds(group: VisualGroup) -> tuple[float, float, float, float] | None:
        points = [point for contour in group.notehead_contours for point in contour]
        if not points:
            return None
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return min(xs), min(ys), max(xs), max(ys)

    @classmethod
    def _looks_like_horizontal_notehead_fragment(
        cls, group: VisualGroup, candidate: VisualGroup
    ) -> bool:
        group_bounds = cls._source_notehead_bounds(group)
        candidate_bounds = cls._source_notehead_bounds(candidate)
        if group_bounds is None or candidate_bounds is None:
            return False
        group_left, group_top, group_right, group_bottom = group_bounds
        candidate_left, candidate_top, candidate_right, candidate_bottom = candidate_bounds
        group_width = max(group_right - group_left, 1.0)
        candidate_width = max(candidate_right - candidate_left, 1.0)
        group_height = max(group_bottom - group_top, 1.0)
        candidate_height = max(candidate_bottom - candidate_top, 1.0)
        vertical_overlap = min(group_bottom, candidate_bottom) - max(
            group_top, candidate_top
        )
        if vertical_overlap < min(group_height, candidate_height) * 0.75:
            return False
        horizontal_gap = max(
            0.0,
            max(group_left, candidate_left) - min(group_right, candidate_right),
        )
        if horizontal_gap > min(group_width, candidate_width) * 0.2:
            return False
        return abs(group.prediction_center[1] - candidate.prediction_center[1]) <= min(
            group_height, candidate_height
        ) * 0.2

    def _merge_notehead_fragment(self, group: VisualGroup, fragment: VisualGroup) -> None:
        group.notehead_contours.extend(fragment.notehead_contours)
        group.detected_notehead_contours.extend(fragment.detected_notehead_contours)
        group.refined_notehead_contours.extend(fragment.refined_notehead_contours)
        points = [point for contour in group.notehead_contours for point in contour]
        if len(points) >= 5:
            ellipse = cv2.fitEllipse(
                np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
            )
            fitted = self.metadata._ellipse_to_json(ellipse)
            fitted["_fit_source"] = "merged-fragments"
            fitted["_is_hollow"] = True
            group.notehead_ellipses = [fitted]
        group.prediction_center = (
            (group.prediction_center[0] + fragment.prediction_center[0]) / 2,
            (group.prediction_center[1] + fragment.prediction_center[1]) / 2,
        )

    def _structural_moment_assignments(
        self,
        symbols: list[EncodedSymbol],
        note_symbols: list[EncodedSymbol],
        visual_groups: list[VisualGroup],
    ) -> StructuralMatchPlan | None:
        """Align compatible recognition and visual moments in page order.

        Token chords preserve left-to-right musical moments, while visual x clusters
        preserve their page order. A weighted sequence alignment locks every complete
        per-stave moment it can prove, while skipping isolated missing or surplus
        moments. This is more reliable than individual transformer attention for
        repeated pitches and prevents one detection defect from shifting the rest of
        a system.

        TrOMR can also emit a real note rhythm whose pitch branch is ``_`` or ``.``.
        Such a symbol is deliberately absent from MusicXML, but it still occupies a
        visual moment. Keep it in the structural sequence and reserve its notehead so
        the following MusicXML note cannot claim that geometry.
        """
        symbol_index_by_match_id = {
            symbol.visual_match_id: index for index, symbol in enumerate(note_symbols)
        }
        symbol_moments = [
            [symbol for symbol in chord if self._symbol_occupies_visual_moment(symbol)]
            for chord in sort_token_chords(symbols)
        ]
        symbol_moments = [moment for moment in symbol_moments if moment]

        visual_moments: list[list[int]] = []
        for group_index in sorted(
            range(len(visual_groups)),
            key=lambda index: visual_groups[index].prediction_center[0],
        ):
            if not visual_moments:
                visual_moments.append([group_index])
                continue
            current_center = float(
                np.median(
                    [
                        visual_groups[index].prediction_center[0]
                        for index in visual_moments[-1]
                    ]
                )
            )
            if (
                abs(visual_groups[group_index].prediction_center[0] - current_center)
                <= VISUAL_MOMENT_X_TOLERANCE
            ):
                visual_moments[-1].append(group_index)
            else:
                visual_moments.append([group_index])

        assignments: list[tuple[int, int]] = []
        reserved_group_indices: set[int] = set()
        for symbol_moment_index, visual_moment_index in self._align_structural_moments(
            symbol_moments, visual_moments, visual_groups
        ):
            symbol_moment = symbol_moments[symbol_moment_index]
            visual_moment = visual_moments[visual_moment_index]
            symbols_by_stave: dict[int, list[EncodedSymbol]] = {}
            for symbol in symbol_moment:
                position = symbol.position
                stave_index = 1 if position == "lower" else 0
                symbols_by_stave.setdefault(stave_index, []).append(symbol)
            groups_by_stave: dict[int, list[int]] = {}
            for group_index in visual_moment:
                stave_index = visual_groups[group_index].stave_index
                groups_by_stave.setdefault(stave_index, []).append(group_index)
            for stave_index, stave_symbols in symbols_by_stave.items():
                stave_group_indices = groups_by_stave[stave_index]
                placeholder_symbols = [
                    symbol
                    for symbol in stave_symbols
                    if symbol.visual_match_id not in symbol_index_by_match_id
                ]
                available_group_indices = set(stave_group_indices)
                for placeholder in placeholder_symbols:
                    reserved_group_index = min(
                        available_group_indices,
                        key=lambda group_index: self._symbol_group_distance(
                            placeholder, visual_groups[group_index]
                        ),
                    )
                    available_group_indices.remove(reserved_group_index)
                    reserved_group_indices.add(reserved_group_index)

                stave_symbol_indices = [
                    symbol_index_by_match_id[symbol.visual_match_id]
                    for symbol in stave_symbols
                    if symbol.visual_match_id in symbol_index_by_match_id
                ]

                def pitch_height(symbol_index: int) -> int:
                    pitch_index = self._diatonic_pitch_index(note_symbols[symbol_index].pitch)
                    return pitch_index if pitch_index is not None else -1

                symbol_order = sorted(stave_symbol_indices, key=pitch_height, reverse=True)
                group_order = sorted(
                    available_group_indices,
                    key=lambda index: visual_groups[index].prediction_center[1],
                )
                assignments.extend(zip(symbol_order, group_order, strict=True))

        if not assignments and not reserved_group_indices:
            return None
        return StructuralMatchPlan(sorted(assignments), reserved_group_indices)

    @staticmethod
    def _symbol_occupies_visual_moment(symbol: EncodedSymbol) -> bool:
        if symbol.rhythm.startswith("note"):
            return True
        return symbol.rhythm.startswith("rest") and symbol.pitch not in ("_", ".")

    @classmethod
    def _align_structural_moments(
        cls,
        symbol_moments: list[list[EncodedSymbol]],
        visual_moments: list[list[int]],
        visual_groups: list[VisualGroup],
    ) -> list[tuple[int, int]]:
        """Return a maximum-weight, order-preserving alignment of equal shapes."""

        def symbol_shape(moment: list[EncodedSymbol]) -> tuple[int, int]:
            return (
                sum(symbol.position != "lower" for symbol in moment),
                sum(symbol.position == "lower" for symbol in moment),
            )

        def visual_shape(moment: list[int]) -> tuple[int, int]:
            return (
                sum(visual_groups[index].stave_index == 0 for index in moment),
                sum(visual_groups[index].stave_index == 1 for index in moment),
            )

        symbol_shapes = [symbol_shape(moment) for moment in symbol_moments]
        visual_shapes = [visual_shape(moment) for moment in visual_moments]
        symbol_count = len(symbol_moments)
        visual_count = len(visual_moments)
        visual_centers = [
            float(
                np.median(
                    [visual_groups[group_index].prediction_center[0] for group_index in moment]
                )
            )
            for moment in visual_moments
        ]
        # A staff line can split every head of a hollow chord into matching left
        # and right fragment columns. Neither column is a complete musical moment,
        # even though each has the expected per-stave count. Leave this distinctive
        # close duplicate pattern to attention matching and fragment rejoining.
        ambiguous_visual_moments = {
            visual_index
            for visual_index, shape in enumerate(visual_shapes)
            if sum(shape) > 1
            and any(
                visual_shapes[neighbor] == shape
                and abs(visual_centers[neighbor] - visual_centers[visual_index])
                <= VISUAL_MOMENT_X_TOLERANCE * 3
                for neighbor in (visual_index - 1, visual_index + 1)
                if 0 <= neighbor < visual_count
            )
        }
        # Score by noteheads first and matched moments second. The final term
        # selects the least-displaced alignment when repeated one-note shapes
        # admit several otherwise equivalent subsequences.
        scores: list[list[tuple[int, int, float]]] = [
            [(0, 0, 0.0) for _ in range(visual_count + 1)] for _ in range(symbol_count + 1)
        ]
        actions: list[list[str | None]] = [
            [None for _ in range(visual_count + 1)] for _ in range(symbol_count + 1)
        ]
        for symbol_index in range(1, symbol_count + 1):
            actions[symbol_index][0] = "skip-symbol"
        for visual_index in range(1, visual_count + 1):
            actions[0][visual_index] = "skip-visual"

        for symbol_index in range(1, symbol_count + 1):
            for visual_index in range(1, visual_count + 1):
                options = [
                    (scores[symbol_index - 1][visual_index], "skip-symbol"),
                    (scores[symbol_index][visual_index - 1], "skip-visual"),
                ]
                if (
                    symbol_shapes[symbol_index - 1] == visual_shapes[visual_index - 1]
                    and visual_index - 1 not in ambiguous_visual_moments
                ):
                    previous = scores[symbol_index - 1][visual_index - 1]
                    symbol_position = (symbol_index - 0.5) / max(symbol_count, 1)
                    visual_position = (visual_index - 0.5) / max(visual_count, 1)
                    options.append(
                        (
                            (
                                previous[0] + sum(symbol_shapes[symbol_index - 1]),
                                previous[1] + 1,
                                previous[2] - abs(symbol_position - visual_position),
                            ),
                            "match",
                        )
                    )
                score, action = max(
                    options,
                    key=lambda option: (
                        option[0],
                        option[1] == "match",
                        option[1] == "skip-visual",
                    ),
                )
                scores[symbol_index][visual_index] = score
                actions[symbol_index][visual_index] = action

        result: list[tuple[int, int]] = []
        symbol_index = symbol_count
        visual_index = visual_count
        while symbol_index > 0 or visual_index > 0:
            action = actions[symbol_index][visual_index]
            if action == "match":
                result.append((symbol_index - 1, visual_index - 1))
                symbol_index -= 1
                visual_index -= 1
            elif action == "skip-symbol":
                symbol_index -= 1
            elif action == "skip-visual":
                visual_index -= 1
            else:
                break
        result.reverse()
        return result

    @staticmethod
    def _assign_around_locked_matches(
        note_symbols: list[EncodedSymbol],
        visual_groups: list[VisualGroup],
        locked_assignments: list[tuple[int, int]],
        reserved_group_indices: set[int] | None = None,
    ) -> list[tuple[int, int]]:
        """Complete a one-to-one match without disturbing structural assignments."""
        assignments = list(locked_assignments)
        assigned_symbols = {symbol_index for symbol_index, _ in assignments}
        assigned_groups = {group_index for _, group_index in assignments}
        assigned_groups.update(reserved_group_indices or set())
        has_multiple_staves = any(group.stave_index == 1 for group in visual_groups)
        candidates: list[tuple[float, int, int]] = []
        for symbol_index, symbol in enumerate(note_symbols):
            if symbol_index in assigned_symbols or symbol.coordinates is None:
                continue
            if not bool(np.all(np.isfinite(symbol.coordinates))):
                continue
            for group_index, group in enumerate(visual_groups):
                if group_index in assigned_groups or group.transformer_center is None:
                    continue
                expected_stave_index = 1 if symbol.position == "lower" else 0
                if has_multiple_staves and group.stave_index != expected_stave_index:
                    continue
                if not bool(np.all(np.isfinite(group.transformer_center))):
                    continue
                candidates.append(
                    (
                        float(
                            np.linalg.norm(
                                np.subtract(symbol.coordinates, group.transformer_center)
                            )
                        ),
                        symbol_index,
                        group_index,
                    )
                )

        for _, symbol_index, group_index in sorted(candidates):
            if symbol_index in assigned_symbols or group_index in assigned_groups:
                continue
            assignments.append((symbol_index, group_index))
            assigned_symbols.add(symbol_index)
            assigned_groups.add(group_index)

        unmatched_symbol_indices = [
            index for index in range(len(note_symbols)) if index not in assigned_symbols
        ]
        for symbol_index in unmatched_symbol_indices:
            expected_stave_index = 1 if note_symbols[symbol_index].position == "lower" else 0
            compatible_group_indices = [
                index
                for index, group in enumerate(visual_groups)
                if index not in assigned_groups
                and (not has_multiple_staves or group.stave_index == expected_stave_index)
            ]
            if not compatible_group_indices:
                continue
            group_index = min(
                compatible_group_indices,
                key=lambda index: visual_groups[index].transformer_center or (0.0, 0.0),
            )
            assignments.append((symbol_index, group_index))
            assigned_symbols.add(symbol_index)
            assigned_groups.add(group_index)
        return sorted(assignments)

    def _repair_chord_assignments(
        self,
        symbols: list[EncodedSymbol],
        note_symbols: list[EncodedSymbol],
        visual_groups: list[VisualGroup],
        assignments: list[tuple[int, int]],
    ) -> list[tuple[int, int]]:
        """Keep recognized chord members on their shared physical stem.

        Transformer attention can exchange a lower chord member with an adjacent
        single note even when the top member is positioned correctly. Shared stem
        components provide stronger chord identity than those individual attention
        coordinates. Reassign the recognized chord by pitch height and give any
        displaced neighboring symbols the visual groups that the chord vacated.
        """
        group_by_symbol_index = dict(assignments)
        symbol_index_by_match_id = {
            symbol.visual_match_id: index for index, symbol in enumerate(note_symbols)
        }

        for chord in sort_token_chords(symbols):
            chord_symbol_indices = [
                symbol_index_by_match_id[symbol.visual_match_id]
                for symbol in chord
                if (
                    symbol.rhythm.startswith("note")
                    and symbol.visual_match_id in symbol_index_by_match_id
                )
            ]
            symbols_by_stave: dict[str, list[int]] = {}
            for symbol_index in chord_symbol_indices:
                position = note_symbols[symbol_index].position
                symbols_by_stave.setdefault(position, []).append(symbol_index)

            for stave_symbol_indices in symbols_by_stave.values():
                if len(stave_symbol_indices) < 2 or any(
                    index not in group_by_symbol_index for index in stave_symbol_indices
                ):
                    continue
                current_group_indices = [
                    group_by_symbol_index[index] for index in stave_symbol_indices
                ]
                component_candidates: list[list[int]] = []
                for current_group_index in current_group_indices:
                    current_group = visual_groups[current_group_index]
                    for component_id in current_group.owned_stem_component_ids:
                        candidates = [
                            group_index
                            for group_index, group in enumerate(visual_groups)
                            if (
                                group.stave_index == current_group.stave_index
                                and component_id in group.owned_stem_component_ids
                            )
                        ]
                        if len(candidates) == len(stave_symbol_indices):
                            component_candidates.append(candidates)
                if not component_candidates:
                    continue
                desired_group_indices = max(
                    component_candidates,
                    key=lambda candidates: len(set(candidates) & set(current_group_indices)),
                )

                def pitch_height(symbol_index: int) -> int:
                    pitch_index = self._diatonic_pitch_index(
                        note_symbols[symbol_index].pitch
                    )
                    return pitch_index if pitch_index is not None else -1

                symbol_order = sorted(
                    stave_symbol_indices,
                    key=pitch_height,
                    reverse=True,
                )
                group_order = sorted(
                    desired_group_indices,
                    key=lambda index: visual_groups[index].prediction_center[1],
                )
                desired_by_symbol = dict(zip(symbol_order, group_order, strict=True))
                if all(
                    group_by_symbol_index[symbol_index] == desired_group_index
                    for symbol_index, desired_group_index in desired_by_symbol.items()
                ):
                    continue

                symbol_by_group_index = {
                    group_index: symbol_index
                    for symbol_index, group_index in group_by_symbol_index.items()
                }
                entering_group_indices = [
                    index
                    for index in desired_group_indices
                    if index not in current_group_indices
                ]
                leaving_group_indices = [
                    index
                    for index in current_group_indices
                    if index not in desired_group_indices
                ]
                displaced_symbol_indices = [
                    symbol_by_group_index[index]
                    for index in entering_group_indices
                    if index in symbol_by_group_index
                ]
                if len(displaced_symbol_indices) != len(leaving_group_indices):
                    continue

                group_by_symbol_index.update(desired_by_symbol)
                if displaced_symbol_indices:
                    replacement_order = min(
                        itertools.permutations(leaving_group_indices),
                        key=lambda candidate_order: sum(
                            self._symbol_group_distance(
                                note_symbols[symbol_index], visual_groups[group_index]
                            )
                            for symbol_index, group_index in zip(
                                displaced_symbol_indices, candidate_order, strict=True
                            )
                        ),
                    )
                    group_by_symbol_index.update(
                        zip(displaced_symbol_indices, replacement_order, strict=True)
                    )

        return sorted(group_by_symbol_index.items())

    def _repair_adjacent_sequence_inversions(
        self,
        symbols: list[EncodedSymbol],
        note_symbols: list[EncodedSymbol],
        visual_groups: list[VisualGroup],
        assignments: list[tuple[int, int]],
    ) -> list[tuple[int, int]]:
        """Undo crossed attention matches between adjacent same-stave notes.

        Attention occasionally exchanges two neighboring notes in a scalar run.
        Musical order then points right-to-left while the assigned staff positions
        also contradict the pitches. Requiring both inversions makes the swap safe
        around chords, repeated pitches, and deliberately displaced noteheads.
        """
        group_by_symbol_index = dict(assignments)
        symbol_index_by_match_id = {
            symbol.visual_match_id: index for index, symbol in enumerate(note_symbols)
        }
        moments = [
            [
                symbol_index_by_match_id[symbol.visual_match_id]
                for symbol in chord
                if symbol.visual_match_id in symbol_index_by_match_id
            ]
            for chord in sort_token_chords(symbols)
        ]
        moments = [moment for moment in moments if moment]

        for _ in range(len(moments)):
            changed = False
            for first_moment, second_moment in zip(moments, moments[1:], strict=False):
                positions = {
                    note_symbols[index].position
                    for index in first_moment + second_moment
                }
                for position in positions:
                    first_indices = [
                        index
                        for index in first_moment
                        if note_symbols[index].position == position
                    ]
                    second_indices = [
                        index
                        for index in second_moment
                        if note_symbols[index].position == position
                    ]
                    if len(first_indices) != 1 or len(second_indices) != 1:
                        continue
                    first_symbol_index = first_indices[0]
                    second_symbol_index = second_indices[0]
                    if (
                        first_symbol_index not in group_by_symbol_index
                        or second_symbol_index not in group_by_symbol_index
                    ):
                        continue
                    first_symbol = note_symbols[first_symbol_index]
                    second_symbol = note_symbols[second_symbol_index]
                    if first_symbol.rhythm.rstrip(".") != second_symbol.rhythm.rstrip("."):
                        continue
                    first_pitch = self._diatonic_pitch_index(first_symbol.pitch)
                    second_pitch = self._diatonic_pitch_index(second_symbol.pitch)
                    if first_pitch is None or second_pitch is None or first_pitch == second_pitch:
                        continue
                    first_group_index = group_by_symbol_index[first_symbol_index]
                    second_group_index = group_by_symbol_index[second_symbol_index]
                    first_group = visual_groups[first_group_index]
                    second_group = visual_groups[second_group_index]
                    if first_group.stave_index != second_group.stave_index:
                        continue
                    if (
                        first_group.prediction_center[0]
                        <= second_group.prediction_center[0] + VISUAL_MOMENT_X_TOLERANCE
                    ):
                        continue
                    pitch_difference = first_pitch - second_pitch
                    position_difference = (
                        first_group.staff_position - second_group.staff_position
                    )
                    if pitch_difference * position_difference >= 0:
                        continue
                    group_by_symbol_index[first_symbol_index] = second_group_index
                    group_by_symbol_index[second_symbol_index] = first_group_index
                    changed = True
            if not changed:
                break

        return sorted(group_by_symbol_index.items())

    def _release_split_moment_outliers(
        self,
        symbols: list[EncodedSymbol],
        note_symbols: list[EncodedSymbol],
        visual_groups: list[VisualGroup],
        assignments: list[tuple[int, int]],
    ) -> list[tuple[int, int]]:
        """Unassign chord members pulled outside their neighboring moments.

        When one chord head is missing from segmentation, greedy attention can
        attach that member to an unrelated earlier notehead. If another member is
        correctly anchored between the previous and next musical moments, release
        only the outlier. The normal pixel-backed chord recovery can then recreate
        it at the anchor x-position.
        """
        group_by_symbol_index = dict(assignments)
        symbol_index_by_match_id = {
            symbol.visual_match_id: index for index, symbol in enumerate(note_symbols)
        }
        moments = [
            [
                symbol_index_by_match_id[symbol.visual_match_id]
                for symbol in chord
                if symbol.visual_match_id in symbol_index_by_match_id
            ]
            for chord in sort_token_chords(symbols)
        ]
        moments = [moment for moment in moments if moment]

        def assigned_center(moment: list[int]) -> float | None:
            centers = [
                visual_groups[group_by_symbol_index[index]].prediction_center[0]
                for index in moment
                if index in group_by_symbol_index
            ]
            return float(np.median(centers)) if centers else None

        moment_centers = [assigned_center(moment) for moment in moments]
        for moment_index, moment in enumerate(moments):
            assigned_indices = [index for index in moment if index in group_by_symbol_index]
            if len(assigned_indices) < 2:
                continue
            previous_center = next(
                (
                    moment_centers[index]
                    for index in range(moment_index - 1, -1, -1)
                    if moment_centers[index] is not None
                ),
                None,
            )
            next_center = next(
                (
                    moment_centers[index]
                    for index in range(moment_index + 1, len(moments))
                    if moment_centers[index] is not None
                ),
                None,
            )
            in_order: list[int] = []
            outliers: list[int] = []
            for symbol_index in assigned_indices:
                center_x = visual_groups[group_by_symbol_index[symbol_index]].prediction_center[0]
                follows_previous = (
                    previous_center is None
                    or center_x >= previous_center - VISUAL_MOMENT_X_TOLERANCE
                )
                precedes_next = (
                    next_center is None or center_x <= next_center + VISUAL_MOMENT_X_TOLERANCE
                )
                if follows_previous and precedes_next:
                    in_order.append(symbol_index)
                else:
                    outliers.append(symbol_index)
            if in_order:
                for symbol_index in outliers:
                    del group_by_symbol_index[symbol_index]

        return sorted(group_by_symbol_index.items())

    @staticmethod
    def _symbol_group_distance(symbol: EncodedSymbol, group: VisualGroup) -> float:
        if symbol.coordinates is None or group.transformer_center is None:
            return float("inf")
        return float(np.linalg.norm(np.subtract(symbol.coordinates, group.transformer_center)))

    def _recover_transformer_chord_notehead(
        self,
        symbol: EncodedSymbol,
        staff_index: int,
        source_staff: Staff | None,
        neighboring_groups: list[VisualGroup],
        chord_mates: list[tuple[EncodedSymbol, VisualGroup]],
    ) -> VisualGroup | None:
        """Recover a chord head that segmentation missed but TrOMR recognized.

        A matched same-stave chord member supplies an exact source anchor. Apply the
        recognized diatonic interval using the local five-line stave spacing, then
        require the source-image contour fitter to find supporting ink. Chord context
        and pixel evidence together keep hallucinated MusicXML notes unmatched.
        """
        if (
            self.source_image is None
            or source_staff is None
            or not chord_mates
            or not symbol.rhythm.startswith("note")
            or symbol.coordinates is None
            or not bool(np.all(np.isfinite(symbol.coordinates)))
        ):
            return None
        prediction_center: tuple[float, float] | None = None
        recovered_staff_position: int | None = None
        symbol_pitch_index = self._diatonic_pitch_index(symbol.pitch)
        for mate_symbol, mate_group in chord_mates:
            mate_pitch_index = self._diatonic_pitch_index(mate_symbol.pitch)
            if (
                mate_symbol.position != symbol.position
                or symbol_pitch_index is None
                or mate_pitch_index is None
            ):
                continue
            pitch_steps = symbol_pitch_index - mate_pitch_index
            mate_source_point = source_staff.get_at(mate_group.prediction_center[0])
            if mate_source_point is None:
                mate_source_point = min(
                    source_staff.grid,
                    key=lambda point: abs(point.x - mate_group.prediction_center[0]),
                )
            mate_line_index = int(
                np.argmin(
                    np.abs(
                        np.asarray(mate_source_point.y)
                        - float(mate_group.prediction_center[1])
                    )
                )
            )
            local_unit = self._local_staff_unit(mate_source_point, mate_line_index)
            prediction_center = (
                float(mate_group.prediction_center[0]),
                float(mate_group.prediction_center[1]) - pitch_steps * local_unit / 2,
            )
            recovered_staff_position = mate_group.staff_position + pitch_steps
            break
        if prediction_center is None or recovered_staff_position is None:
            return None
        source_point = source_staff.get_at(prediction_center[0])
        if source_point is None:
            source_point = min(
                source_staff.grid, key=lambda point: abs(point.x - prediction_center[0])
            )
        source_line_index = int(
            np.argmin(np.abs(np.asarray(source_point.y) - float(prediction_center[1])))
        )
        unit_size = max(self._local_staff_unit(source_point, source_line_index), 4.0)
        width = constants.NOTEHEAD_SIZE_RATIO * unit_size
        height = unit_size
        center = (float(prediction_center[0]), float(prediction_center[1]))
        axes = (max(2, int(round(width / 2))), max(2, int(round(height / 2))))
        contour = cv2.ellipse2Poly(
            (int(round(center[0])), int(round(center[1]))),
            axes,
            -20,
            0,
            360,
            5,
        ).reshape(-1, 1, 2)
        box = BoundingEllipse((center, (width, height), -20), contour)
        visual_id = f"vnote-transformer-recovered-{self._next_transformer_recovered_visual_id}"
        guessed_note = Note(
            box,
            recovered_staff_position,
            None,
            None,
            visual_id,
        )
        neighboring_notes = [
            Note(
                BoundingEllipse(
                    (
                        group.prediction_center,
                        (width, height),
                        -20,
                    ),
                    contour,
                ),
                group.staff_position,
                None,
                None,
                group.visual_id,
            )
            for group in neighboring_groups
            if group.staff_index == staff_index
        ]
        refined_contour = self._refined_notehead_contour(
            guessed_note, [guessed_note, *neighboring_notes]
        )
        if refined_contour is None:
            return None
        self._next_transformer_recovered_visual_id += 1
        notehead_ellipse = self._ellipse_from_source_contour(refined_contour)
        notehead_ellipse["_is_hollow"] = self._is_hollow_notehead(guessed_note)
        return VisualGroup(
            visual_id=visual_id,
            staff_index=staff_index,
            stave_index=self._stave_index_for_center(source_staff, center),
            staff_position=guessed_note.position,
            prediction_center=center,
            transformer_center=(float(symbol.coordinates[0]), float(symbol.coordinates[1])),
            notehead_ellipses=[notehead_ellipse],
            notehead_contours=[refined_contour],
            detected_notehead_contours=[],
            refined_notehead_contours=[refined_contour],
            detected_stem_contours=[],
            stem_contours=[],
            owned_stem_component_ids=[],
            is_hollow_notehead=self._is_hollow_notehead(guessed_note),
            duration=symbol.rhythm,
        )

    @staticmethod
    def _diatonic_pitch_index(pitch: str) -> int | None:
        if len(pitch) < 2 or pitch[0] not in "CDEFGAB":
            return None
        try:
            octave = int(pitch[1:])
        except ValueError:
            return None
        return octave * 7 + "CDEFGAB".index(pitch[0])

    @staticmethod
    def _local_staff_unit(point: Any, line_index: int) -> float:
        lines_per_stave = constants.number_of_lines_on_a_staff
        stave_start = (line_index // lines_per_stave) * lines_per_stave
        stave_lines = point.y[stave_start : stave_start + lines_per_stave]
        differences = np.diff(stave_lines)
        return float(np.median(differences)) if len(differences) else 1.0

    def _stem_component_ids_for_output(self, group: VisualGroup) -> list[str]:
        if group.duration is None:
            return []
        duration_class = group.duration.rstrip(".")
        result = []
        for component_id in group.owned_stem_component_ids:
            if any(
                candidate.visual_id != group.visual_id
                and candidate.duration is not None
                and candidate.duration.rstrip(".") == duration_class
                and component_id in candidate.owned_stem_component_ids
                and self._noteheads_can_share_chord_stem(group, candidate)
                for candidate in self.visual_groups.values()
            ):
                result.append(f"{component_id}-duration-{duration_class}")
        return result

    @classmethod
    def _noteheads_can_share_chord_stem(
        cls, first: VisualGroup, second: VisualGroup
    ) -> bool:
        first_bounds = cls._source_notehead_bounds(first)
        second_bounds = cls._source_notehead_bounds(second)
        if first_bounds is None or second_bounds is None:
            return False
        first_left, _first_top, first_right, _first_bottom = first_bounds
        second_left, _second_top, second_right, _second_bottom = second_bounds
        first_width = max(first_right - first_left, 1.0)
        second_width = max(second_right - second_left, 1.0)
        horizontal_gap = max(
            0.0,
            max(first_left, second_left) - min(first_right, second_right),
        )
        return (
            horizontal_gap
            <= min(first_width, second_width)
            * MAX_CHORD_NOTEHEAD_HORIZONTAL_GAP_RATIO
        )

    def create_musicxml_id(self) -> str:
        musicxml_id = f"homr-note-{self._next_musicxml_note_id}"
        self._next_musicxml_note_id += 1
        return musicxml_id

    def record_musicxml_note(
        self,
        musicxml_id: str,
        part: int,
        measure: int,
        staff: int,
        voice: int,
        symbol: EncodedSymbol,
    ) -> None:
        match = self.matches_by_symbol_id.get(symbol.visual_match_id)
        visual_id = match.visual_id if match is not None else None
        confidence = match.confidence if match is not None else 0.0
        pitch = sounding_pitch(symbol)
        if visual_id is not None and visual_id in self.visual_groups:
            self.visual_groups[visual_id].linked_musicxml_ids.append(musicxml_id)
        self.musicxml_notes.append(
            MusicXmlNoteRecord(
                musicxml_id=musicxml_id,
                part=part,
                measure=measure,
                staff=staff,
                voice=voice,
                pitch=pitch,
                duration=symbol.rhythm,
                match_confidence=confidence,
                visual_group_id=visual_id,
            )
        )

    def unmatched_musicxml_notes(self) -> list[str]:
        return [note.musicxml_id for note in self.musicxml_notes if note.visual_group_id is None]

    def _notehead_ellipse_for_visual_sidecar(self, note: Note) -> dict[str, Any]:
        points = np.asarray(note.box.contours).reshape(-1, 2)
        if len(points) < 5:
            ellipse = self.metadata.prediction_ellipse_to_source(note.box.box)
            ellipse["_fit_source"] = "fallback"
            return ellipse

        contour = self._notehead_mask_contour(note)
        if contour is not None:
            ellipse = self.metadata.prediction_contour_ellipse_to_source(contour, note.box.box)
            ellipse["_fit_source"] = "mask"
            return ellipse
        ellipse = self.metadata.prediction_contour_ellipse_to_source(
            note.box.contours, note.box.box
        )
        ellipse["_fit_source"] = "contour"
        return ellipse

    def _notehead_mask_contour(self, note: Note) -> Any | None:
        if self.notehead_mask is None:
            return None

        height, width = self.notehead_mask.shape[:2]
        left = max(0, int(np.floor(note.box.top_left[0])) - 1)
        top = max(0, int(np.floor(note.box.top_left[1])) - 1)
        right = min(width, int(np.ceil(note.box.bottom_right[0])) + 1)
        bottom = min(height, int(np.ceil(note.box.bottom_right[1])) + 1)
        if right <= left or bottom <= top:
            return None

        region = self.notehead_mask[top:bottom, left:right]
        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        contour = max(contours, key=cv2.contourArea)
        if len(contour) < 5:
            return None
        return contour + np.array([[[left, top]]])

    def _visual_sidecar_stem_for_note(
        self, note: Note, stem_ownership: StemOwnershipCache
    ) -> RotatedBoundingBox | None:
        stem_fragments = self._available_stem_fragments_for_note(note, stem_ownership)
        seed = self._best_visual_sidecar_stem_seed(note, stem_fragments)
        stem = (
            self._merge_visual_sidecar_stem_fragments(note, seed, stem_fragments)
            if seed is not None
            else None
        )
        if stem is not None and stem.center[0] >= note.center[0]:
            stem = self._repair_upward_visual_sidecar_stem(note, stem, stem_fragments)
            return self._repair_downward_visual_sidecar_stem(note, stem, stem_fragments)
        stem = self._repair_downward_visual_sidecar_stem(note, stem, stem_fragments)
        return self._repair_upward_visual_sidecar_stem(note, stem, stem_fragments)

    def _available_stem_fragments_for_note(
        self, note: Note, stem_ownership: StemOwnershipCache
    ) -> list[RotatedBoundingBox]:
        note_id = id(note)
        x_radius = max(20.0, float(note.box.size[0]) * 1.25)
        return [
            stem
            for stem in self.stem_fragments
            if abs(stem.center[0] - note.center[0]) <= x_radius
            if not (
                owners := stem_ownership.owner_note_ids_by_component.get(
                    stem_ownership.component_by_fragment_id[id(stem)], set()
                )
            )
            or note_id in owners
        ]

    def _build_stem_ownership_cache(
        self, notes: list[Note]
    ) -> StemOwnershipCache:
        if not self.stem_fragments:
            return StemOwnershipCache({}, {})

        widths = [float(note.box.size[0]) for note in notes]
        heights = [float(note.box.size[1]) for note in notes]
        x_tolerance = (
            self._stem_fragment_x_tolerance(
                float(np.median(widths)), float(np.median(heights))
            )
            if widths and heights
            else 4.0
        )
        max_vertical_gap = (
            max(
                4.0,
                float(np.median(heights)) * MAX_STEM_COMPONENT_GAP_IN_NOTEHEADS,
            )
            if heights
            else 4.0
        )

        parent = list(range(len(self.stem_fragments)))

        def find(index: int) -> int:
            while parent[index] != index:
                parent[index] = parent[parent[index]]
                index = parent[index]
            return index

        def union(first: int, second: int) -> None:
            first_root = find(first)
            second_root = find(second)
            if first_root != second_root:
                parent[second_root] = first_root

        sorted_indices = sorted(
            range(len(self.stem_fragments)),
            key=lambda index: self.stem_fragments[index].center[0],
        )
        for position, first_index in enumerate(sorted_indices):
            first = self.stem_fragments[first_index]
            next_position = position + 1
            while next_position < len(sorted_indices):
                second_index = sorted_indices[next_position]
                second = self.stem_fragments[second_index]
                if second.center[0] - first.center[0] > x_tolerance:
                    break
                if self._is_collinear_stem_fragment(
                    second, [first], x_tolerance, max_vertical_gap
                ):
                    union(first_index, second_index)
                next_position += 1

        component_by_fragment_id = {
            id(stem): find(index) for index, stem in enumerate(self.stem_fragments)
        }
        owner_note_ids_by_component: dict[int, set[int]] = {}
        notes_by_x = sorted(notes, key=lambda note: note.center[0])
        note_xs = [note.center[0] for note in notes_by_x]
        max_note_half_width = max(
            (float(note.box.size[0]) / 2 for note in notes_by_x), default=0.0
        )
        for index, stem in enumerate(self.stem_fragments):
            component = find(index)
            owners = owner_note_ids_by_component.setdefault(component, set())
            stem_bounds = self._stem_bounds(stem)
            x_padding = max_note_half_width + 2.0
            first_note = bisect_left(note_xs, stem_bounds[0] - x_padding)
            last_note = bisect_right(note_xs, stem_bounds[1] + x_padding)
            for note in notes_by_x[first_note:last_note]:
                if self._stem_bounds_touch_notehead(stem_bounds, note) or (
                    note.stem is not None and self._same_stem_fragment(stem, note.stem)
                ):
                    owners.add(id(note))

        return StemOwnershipCache(component_by_fragment_id, owner_note_ids_by_component)

    def _same_stem_fragment(
        self, first: RotatedBoundingBox, second: RotatedBoundingBox
    ) -> bool:
        return first is second or (
            np.allclose(first.center, second.center, atol=1.0)
            and np.allclose(first.size, second.size, atol=1.0)
        )

    def _stem_touches_notehead(self, stem: RotatedBoundingBox, note: Note) -> bool:
        return self._stem_bounds_touch_notehead(self._stem_bounds(stem), note)

    def _stem_bounds(
        self, stem: RotatedBoundingBox
    ) -> tuple[float, float, float, float]:
        points = np.asarray(stem.polygon, dtype=np.float32).reshape(-1, 2)
        return (
            float(np.min(points[:, 0])),
            float(np.max(points[:, 0])),
            float(np.min(points[:, 1])),
            float(np.max(points[:, 1])),
        )

    def _stem_bounds_touch_notehead(
        self, stem_bounds: tuple[float, float, float, float], note: Note
    ) -> bool:
        stem_left, stem_right, stem_top, stem_bottom = stem_bounds
        padding = 2.0
        note_left = min(note.box.top_left[0], note.box.bottom_left[0])
        note_right = max(note.box.top_right[0], note.box.bottom_right[0])
        note_top = min(note.box.top_left[1], note.box.top_right[1])
        note_bottom = max(note.box.bottom_left[1], note.box.bottom_right[1])
        return (
            stem_left <= note_right + padding
            and stem_right >= note_left - padding
            and stem_top <= note_bottom + padding
            and stem_bottom >= note_top - padding
        )

    def _best_visual_sidecar_stem_seed(
        self, note: Note, stem_fragments: list[RotatedBoundingBox]
    ) -> RotatedBoundingBox | None:
        if len(stem_fragments) == 0:
            return note.stem

        candidates = [
            stem
            for stem in stem_fragments
            if self._is_stem_seed_candidate(stem, note)
            and stem.is_overlapping(note.box.make_box_thicker(20))
        ]
        if note.stem is not None and self._is_stem_seed_candidate(note.stem, note):
            candidates.append(note.stem)
        if not candidates:
            return note.stem

        def score(stem: RotatedBoundingBox) -> float:
            note_left = min(note.box.top_left[0], note.box.bottom_left[0])
            note_right = max(note.box.top_right[0], note.box.bottom_right[0])
            note_center_x, note_center_y = note.center
            stem_top = min(stem.top_left[1], stem.top_right[1])
            stem_bottom = max(stem.bottom_left[1], stem.bottom_right[1])
            stem_x = stem.center[0]
            if stem_x >= note_center_x:
                attachment_error = abs(stem_x - note_right)
                extension = note_center_y - stem_top
            else:
                attachment_error = abs(stem_x - note_left)
                extension = stem_bottom - note_center_y
            height_bonus = max(stem_bottom - stem_top, 0) * 0.15
            return float(extension + height_bonus - 2.0 * attachment_error)

        current_score = score(note.stem) if note.stem is not None else float("-inf")
        best = max(candidates, key=score)
        improvement_needed = max(float(note.box.size[1]) * 0.5, 4.0)
        if best is not note.stem and score(best) < current_score + improvement_needed:
            return note.stem
        return best if score(best) > 0 else note.stem

    def _merge_visual_sidecar_stem_fragments(
        self,
        note: Note,
        seed: RotatedBoundingBox,
        stem_fragments: list[RotatedBoundingBox],
    ) -> RotatedBoundingBox:
        if len(stem_fragments) == 0:
            return seed

        notehead_height = max(float(note.box.size[1]), 1.0)
        x_tolerance = self._stem_fragment_x_tolerance(
            float(note.box.size[0]), float(note.box.size[1])
        )
        max_vertical_gap = notehead_height * 3
        fragments = [seed]
        changed = True
        while changed:
            changed = False
            for candidate in stem_fragments:
                if candidate in fragments:
                    continue
                if not self._is_stem_like_fragment(candidate, note):
                    continue
                if not self._is_collinear_stem_fragment(
                    candidate, fragments, x_tolerance, max_vertical_gap
                ):
                    continue
                fragments.append(candidate)
                changed = True

        if len(fragments) == 1:
            return seed

        contour = np.concatenate([fragment.polygon.reshape(-1, 1, 2) for fragment in fragments])
        merged = RotatedBoundingBox(cv2.minAreaRect(contour), contour, seed.debug_id)
        if not self._is_stem_like_fragment(merged, note):
            return seed
        return merged

    def _repair_downward_visual_sidecar_stem(
        self,
        note: Note,
        stem: RotatedBoundingBox | None,
        stem_fragments: list[RotatedBoundingBox],
    ) -> RotatedBoundingBox | None:
        return self._repair_visual_sidecar_stem(
            note, stem, StemRepairDirection.DOWN, stem_fragments
        )

    def _repair_upward_visual_sidecar_stem(
        self,
        note: Note,
        stem: RotatedBoundingBox | None,
        stem_fragments: list[RotatedBoundingBox],
    ) -> RotatedBoundingBox | None:
        return self._repair_visual_sidecar_stem(
            note, stem, StemRepairDirection.UP, stem_fragments
        )

    def _repair_visual_sidecar_stem(
        self,
        note: Note,
        stem: RotatedBoundingBox | None,
        direction: StemRepairDirection,
        stem_fragments: list[RotatedBoundingBox],
    ) -> RotatedBoundingBox | None:
        if len(stem_fragments) == 0:
            return stem
        if not self._needs_stem_repair(note, stem, direction):
            return stem

        note_left = min(note.box.top_left[0], note.box.bottom_left[0])
        note_right = max(note.box.top_right[0], note.box.bottom_right[0])
        notehead_height = max(float(note.box.size[1]), 1.0)
        x_tolerance = self._stem_fragment_x_tolerance(
            float(note.box.size[0]), float(note.box.size[1])
        )
        max_vertical_gap = notehead_height * 5

        candidates = [
            candidate
            for candidate in stem_fragments
            if self._is_stem_seed_candidate(candidate, note)
            and self._is_stem_repair_seed(
                candidate, note, x_tolerance, max_vertical_gap, direction
            )
        ]
        if not candidates:
            return stem

        def chain_from(seed: RotatedBoundingBox) -> list[RotatedBoundingBox]:
            fragments = [seed]
            changed = True
            while changed:
                changed = False
                for candidate in stem_fragments:
                    if candidate in fragments:
                        continue
                    if not self._is_stem_seed_candidate(candidate, note):
                        continue
                    if not self._is_collinear_stem_fragment(
                        candidate, fragments, x_tolerance, max_vertical_gap
                    ):
                        continue
                    fragments.append(candidate)
                    changed = True
            return fragments

        def score(seed: RotatedBoundingBox) -> float:
            fragments = chain_from(seed)
            points = np.concatenate([fragment.polygon.reshape(-1, 2) for fragment in fragments])
            x_center = float(np.mean(points[:, 0]))
            y_min = float(np.min(points[:, 1]))
            y_max = float(np.max(points[:, 1]))
            attachment_x = note_left if x_center < note.center[0] else note_right
            attachment_error = abs(x_center - attachment_x)
            if direction == StemRepairDirection.UP:
                gap_from_note = max(note.center[1] - y_max, 0.0)
                extension = note.center[1] - y_min
            else:
                gap_from_note = max(y_min - note.center[1], 0.0)
                extension = y_max - note.center[1]
            return extension - attachment_error * 2.0 - gap_from_note

        best_seed = max(candidates, key=score)
        if score(best_seed) <= max(notehead_height, 10.0):
            return stem

        fragments = chain_from(best_seed)
        points = np.concatenate([fragment.polygon.reshape(-1, 2) for fragment in fragments])
        x_min = float(np.min(points[:, 0]))
        x_max = float(np.max(points[:, 0]))
        width = max(x_max - x_min, 1.0)
        x_center = float(np.mean(points[:, 0]))
        half_width = min(max(width / 2, 1.0), max(float(note.box.size[0]) * 0.25, 3.0))
        if direction == StemRepairDirection.UP:
            y_min = float(np.min(points[:, 1]))
            y_max = max(float(np.max(points[:, 1])), float(note.center[1]))
        else:
            y_min = min(float(np.min(points[:, 1])), float(note.center[1]))
            y_max = float(np.max(points[:, 1]))
        contour = np.array(
            [
                [[x_center - half_width, y_min]],
                [[x_center + half_width, y_min]],
                [[x_center + half_width, y_max]],
                [[x_center - half_width, y_max]],
            ],
            dtype=np.float32,
        )
        repaired = RotatedBoundingBox(
            cv2.minAreaRect(contour),
            contour,
            stem.debug_id if stem is not None else best_seed.debug_id,
        )
        if not self._is_stem_like_fragment(repaired, note):
            return stem
        if stem is not None and not self._is_repaired_stem_better(note, stem, repaired):
            return stem
        return repaired

    def _needs_downward_stem_repair(
        self, note: Note, stem: RotatedBoundingBox | None
    ) -> bool:
        return self._needs_stem_repair(note, stem, StemRepairDirection.DOWN)

    def _needs_upward_stem_repair(
        self, note: Note, stem: RotatedBoundingBox | None
    ) -> bool:
        return self._needs_stem_repair(note, stem, StemRepairDirection.UP)

    def _needs_stem_repair(
        self,
        note: Note,
        stem: RotatedBoundingBox | None,
        direction: StemRepairDirection,
    ) -> bool:
        if stem is None:
            return True
        points = np.asarray(stem.polygon, dtype=np.float32).reshape(-1, 2)
        height = float(np.max(points[:, 1]) - np.min(points[:, 1]))
        top = float(np.min(points[:, 1]))
        bottom = float(np.max(points[:, 1]))
        notehead_height = max(float(note.box.size[1]), 1.0)
        if direction == StemRepairDirection.UP:
            stem_looks_right_way = stem.center[0] >= note.center[0] or top < note.center[1]
            has_bad_attachment = bottom < note.center[1] - notehead_height * 0.35
        else:
            stem_looks_right_way = stem.center[0] < note.center[0] or bottom > note.center[1]
            has_bad_attachment = top > note.center[1] + notehead_height * 0.35
        return stem_looks_right_way and (
            height < max(1.5 * notehead_height, 18.0) or has_bad_attachment
        )

    def _is_downward_repair_seed(
        self,
        stem: RotatedBoundingBox,
        note: Note,
        x_tolerance: float,
        max_vertical_gap: float,
    ) -> bool:
        return self._is_stem_repair_seed(
            stem, note, x_tolerance, max_vertical_gap, StemRepairDirection.DOWN
        )

    def _is_upward_repair_seed(
        self,
        stem: RotatedBoundingBox,
        note: Note,
        x_tolerance: float,
        max_vertical_gap: float,
    ) -> bool:
        return self._is_stem_repair_seed(
            stem, note, x_tolerance, max_vertical_gap, StemRepairDirection.UP
        )

    def _is_stem_repair_seed(
        self,
        stem: RotatedBoundingBox,
        note: Note,
        x_tolerance: float,
        max_vertical_gap: float,
        direction: StemRepairDirection,
    ) -> bool:
        stem_top = min(stem.top_left[1], stem.top_right[1])
        stem_bottom = max(stem.bottom_left[1], stem.bottom_right[1])
        if direction == StemRepairDirection.UP:
            if stem_top >= note.center[1]:
                return False
            if stem_bottom < note.center[1] - max_vertical_gap:
                return False
        else:
            if stem_bottom <= note.center[1]:
                return False
            if stem_top > note.center[1] + max_vertical_gap:
                return False
        note_left = min(note.box.top_left[0], note.box.bottom_left[0])
        note_right = max(note.box.top_right[0], note.box.bottom_right[0])
        attachment_x = note_left if stem.center[0] < note.center[0] else note_right
        return abs(stem.center[0] - attachment_x) <= x_tolerance

    def _is_repaired_stem_better(
        self, note: Note, current: RotatedBoundingBox, repaired: RotatedBoundingBox
    ) -> bool:
        current_points = np.asarray(current.polygon, dtype=np.float32).reshape(-1, 2)
        repaired_points = np.asarray(repaired.polygon, dtype=np.float32).reshape(-1, 2)
        current_height = float(np.max(current_points[:, 1]) - np.min(current_points[:, 1]))
        repaired_height = float(np.max(repaired_points[:, 1]) - np.min(repaired_points[:, 1]))
        return repaired_height >= current_height + max(float(note.box.size[1]) * 0.5, 4.0)

    def _is_stem_seed_candidate(self, stem: RotatedBoundingBox, note: Note) -> bool:
        points = np.asarray(stem.polygon, dtype=np.float32).reshape(-1, 2)
        width = float(np.max(points[:, 0]) - np.min(points[:, 0]))
        height = float(np.max(points[:, 1]) - np.min(points[:, 1]))
        notehead_width = max(float(note.box.size[0]), 1.0)
        notehead_height = max(float(note.box.size[1]), 1.0)
        max_width = max(8.0, notehead_width * 0.75)
        return (
            self._is_stem_fragment_near_note(points, note, notehead_height)
            and width <= max_width
            and height >= max(2.0 * max(width, 1.0), notehead_height * 0.45)
        )

    def _is_stem_like_fragment(self, stem: RotatedBoundingBox, note: Note) -> bool:
        points = np.asarray(stem.polygon, dtype=np.float32).reshape(-1, 2)
        width = float(np.max(points[:, 0]) - np.min(points[:, 0]))
        height = float(np.max(points[:, 1]) - np.min(points[:, 1]))
        notehead_width = max(float(note.box.size[0]), 1.0)
        notehead_height = max(float(note.box.size[1]), 1.0)
        max_width = max(8.0, notehead_width * 0.75)
        return (
            self._is_stem_fragment_near_note(points, note, notehead_height)
            and width <= max_width
            and height >= max(2.0 * max(width, 1.0), notehead_height * 0.75)
        )

    @staticmethod
    def _is_stem_fragment_near_note(
        points: Any, note: Note, notehead_height: float
    ) -> bool:
        """Keep stem recovery from crossing into unrelated vertically aligned notation."""
        max_distance = notehead_height * MAX_RECONSTRUCTED_STEM_DISTANCE_IN_NOTEHEADS
        top = float(np.min(points[:, 1]))
        bottom = float(np.max(points[:, 1]))
        return (
            top >= note.center[1] - max_distance
            and bottom <= note.center[1] + max_distance
        )

    def _is_collinear_stem_fragment(
        self,
        candidate: RotatedBoundingBox,
        fragments: list[RotatedBoundingBox],
        x_tolerance: float,
        max_vertical_gap: float,
    ) -> bool:
        if abs(candidate.center[0] - fragments[0].center[0]) > x_tolerance:
            return False
        for fragment in fragments:
            if abs(candidate.center[0] - fragment.center[0]) > x_tolerance:
                continue
            candidate_top = min(candidate.top_left[1], candidate.top_right[1])
            candidate_bottom = max(candidate.bottom_left[1], candidate.bottom_right[1])
            fragment_top = min(fragment.top_left[1], fragment.top_right[1])
            fragment_bottom = max(fragment.bottom_left[1], fragment.bottom_right[1])
            vertical_gap = max(candidate_top - fragment_bottom, fragment_top - candidate_bottom, 0)
            if vertical_gap <= max_vertical_gap:
                return True
        return False

    @staticmethod
    def _stem_fragment_x_tolerance(
        notehead_width: float, notehead_height: float
    ) -> float:
        """Allow segmentation drift without joining neighboring opposing stems."""
        return max(4.0, min(notehead_width, notehead_height) * 0.4)

    def _typical_notehead_angles_by_staff(self) -> dict[int, float]:
        angles_by_staff: dict[int, list[float]] = {}
        for group in self.visual_groups.values():
            for ellipse in group.notehead_ellipses:
                if ellipse.get("_fit_source") == "fallback":
                    continue
                if abs(float(ellipse["angle"])) < 6:
                    continue
                if float(ellipse["rx"]) <= float(ellipse["ry"]):
                    continue
                angles_by_staff.setdefault(group.staff_index, []).append(float(ellipse["angle"]))

        all_angles = [angle for angles in angles_by_staff.values() for angle in angles]
        global_angle = float(np.median(all_angles)) if all_angles else None
        result = {}
        for staff_index, angles in angles_by_staff.items():
            result[staff_index] = float(np.median(angles))
        if global_angle is not None:
            for group in self.visual_groups.values():
                result.setdefault(group.staff_index, global_angle)
        return result

    def _notehead_ellipses_for_output(
        self, group: VisualGroup, typical_angle: float | None
    ) -> list[dict[str, Any]]:
        ellipses = []
        for ellipse in group.notehead_ellipses:
            output = {key: value for key, value in ellipse.items() if not key.startswith("_")}
            fit_source = ellipse.get("_fit_source")
            aspect_ratio = float(output["rx"]) / max(float(output["ry"]), 1e-6)
            mask_angle_needs_fallback = (
                fit_source == "mask"
                and abs(float(output["angle"])) < 6
                and aspect_ratio < HORIZONTAL_HOLLOW_NOTEHEAD_ASPECT_RATIO
                and not bool(ellipse.get("_is_hollow", False))
            )
            if typical_angle is not None and (
                fit_source == "fallback"
                or mask_angle_needs_fallback
            ):
                output["angle"] = round(typical_angle, 3)
            ellipses.append(output)
        return ellipses

    def to_json_dict(self) -> dict[str, Any]:
        typical_angles_by_staff = self._typical_notehead_angles_by_staff()
        return {
            "version": 1,
            "source_image_size": list(self.metadata.source_image_size),
            "preprocessing": {
                "autocrop_box": list(self.metadata.autocrop_box),
                "cropped_size": list(self.metadata.cropped_size),
                "resized_size": list(self.metadata.resized_size),
                "resize_scale": [
                    round(self.metadata.resize_scale[0], 8),
                    round(self.metadata.resize_scale[1], 8),
                ],
                "prediction_size": list(self.metadata.prediction_size),
            },
            "notes": [record.__dict__ for record in self.musicxml_notes],
            "raw_stem_contours": self._raw_stem_contours_for_output(),
            "visual_groups": [
                {
                    "visual_group_id": group.visual_id,
                    "staff_index": group.staff_index,
                    "stave_index": group.stave_index,
                    "staff_position": group.staff_position,
                    "center": [
                        round(
                            self.metadata.prediction_point_to_source(group.prediction_center)[0], 3
                        ),
                        round(
                            self.metadata.prediction_point_to_source(group.prediction_center)[1], 3
                        ),
                    ],
                    "bbox": group.bbox,
                    "notehead_ellipses": self._notehead_ellipses_for_output(
                        group, typical_angles_by_staff.get(group.staff_index)
                    ),
                    "notehead_contours": group.notehead_contours,
                    "detected_notehead_contours": group.detected_notehead_contours,
                    "refined_notehead_contours": group.refined_notehead_contours,
                    "detected_stem_contours": group.detected_stem_contours,
                    "stem_contours": group.stem_contours,
                    "stem_component_ids": self._stem_component_ids_for_output(group),
                    "is_hollow_notehead": group.is_hollow_notehead,
                    "musicxml_ids": group.linked_musicxml_ids,
                }
                for group in sorted(self.visual_groups.values(), key=lambda g: g.visual_id)
            ],
            "unmatched_musicxml_notes": self.unmatched_musicxml_notes(),
            "unmatched_visual_notes": sorted(self.unmatched_visual_notes),
        }

    def _score_match(self, symbol: EncodedSymbol, visual_group: VisualGroup) -> float:
        score = 0.65
        if visual_group.transformer_center is not None and symbol.coordinates is not None:
            try:
                coords = np.asarray(symbol.coordinates).reshape(-1)
                if len(coords) >= 2:
                    dx = abs(float(coords[0]) - visual_group.transformer_center[0])
                    dy = abs(float(coords[1]) - visual_group.transformer_center[1])
                    score += max(0.0, 0.25 - (dx + dy) / 1000.0)
            except (TypeError, ValueError):
                pass
        return min(round(score, 3), 1.0)


def write_visual_sidecar(path: str, collector: VisualSidecar) -> None:
    visual_sidecar_path = Path(path)
    visual_sidecar_path.write_text(json.dumps(collector.to_json_dict(), indent=2), encoding="utf-8")
