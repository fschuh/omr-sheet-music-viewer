import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPitchName,
  layoutNoteLabels,
  noteLabelsOverlap,
  selectedGroupIds,
} from "./noteLabels";
import type { VisualGroup, VisualSidecar } from "./types";

function group(
  index: number,
  x: number,
  y: number,
  stemComponentIds: string[] = [],
  staveIndex = 0,
): VisualGroup {
  return {
    visual_group_id: `group-${index}`,
    staff_index: 0,
    stave_index: staveIndex,
    staff_position: index,
    center: [x, y],
    bbox: [x - 10, y - 8, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [],
    stem_contours: [],
    stem_component_ids: stemComponentIds,
    musicxml_ids: [`note-${index}`],
  };
}

function sidecar(groups: VisualGroup[], pitches: string[]): VisualSidecar {
  return {
    version: 1,
    source_image_size: [2550, 3301],
    visual_groups: groups,
    notes: groups.map((value, index) => ({
      musicxml_id: `note-${index}`,
      part: 1,
      measure: 1,
      staff: 1,
      voice: 1,
      pitch: pitches[index],
      duration: "note_4",
      match_confidence: 1,
      visual_group_id: value.visual_group_id,
    })),
    unmatched_musicxml_notes: [],
    unmatched_visual_notes: [],
  };
}

test("formats natural, flat, sharp, and double-sharp pitches", () => {
  assert.equal(formatPitchName("C", 3), "C3");
  assert.equal(formatPitchName("E", 3, -1), "E♭3");
  assert.equal(formatPitchName("E", 3, 1), "E♯3");
  assert.equal(formatPitchName("F", 5, 2), "F♯♯5");
});

test("puts a single highlighted label immediately to the right of its note", () => {
  const visualGroup = group(0, 500, 500);
  const labels = layoutNoteLabels(
    sidecar([visualGroup], ["Eb3"]),
    new Set([visualGroup.visual_group_id]),
    2550,
    3301,
  );
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, "E♭3");
  assert.ok(labels[0].x > 510);
});

test("keeps every label disjoint in a 486-note highlight-all stress case", () => {
  const groups = Array.from({ length: 486 }, (_, index) => group(index, 1275, 1650));
  const labels = layoutNoteLabels(
    sidecar(groups, groups.map(() => "C#4")),
    new Set(groups.map((value) => value.visual_group_id)),
    2550,
    3301,
  );
  assert.equal(labels.length, groups.length);
  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      assert.equal(
        noteLabelsOverlap(labels[first], labels[second]),
        false,
        `${labels[first].key} overlaps ${labels[second].key}`,
      );
    }
  }
});

test("selects vertically aligned chord members when stem detection is missing", () => {
  const groups = [group(0, 500, 480), group(1, 500, 520)];
  const data = sidecar(groups, ["G5", "B4"]);

  assert.deepEqual(
    selectedGroupIds(
      data,
      { pageIndex: 0, visualGroupId: groups[1].visual_group_id },
      0,
      false,
    ),
    new Set(groups.map((value) => value.visual_group_id)),
  );
});

test("does not select horizontally adjacent chord columns", () => {
  const groups = [
    group(0, 500, 480),
    group(1, 500, 520),
    group(2, 535, 480),
    group(3, 535, 520),
  ];
  const data = sidecar(groups, ["G5", "B4", "G5", "B4"]);

  assert.deepEqual(
    selectedGroupIds(
      data,
      { pageIndex: 0, visualGroupId: groups[0].visual_group_id },
      0,
      false,
    ),
    new Set([groups[0].visual_group_id, groups[1].visual_group_id]),
  );
});

test("does not select an aligned note on another stave in the same system", () => {
  const groups = [group(0, 500, 480), group(1, 500, 720, [], 1)];
  const data = sidecar(groups, ["G5", "G2"]);

  assert.deepEqual(
    selectedGroupIds(
      data,
      { pageIndex: 0, visualGroupId: groups[0].visual_group_id },
      0,
      false,
    ),
    new Set([groups[0].visual_group_id]),
  );
});

test("keeps shared-stem chord members selected when noteheads are offset", () => {
  const groups = [group(0, 500, 480, ["stem-1"]), group(1, 512, 500, ["stem-1"])];
  const data = sidecar(groups, ["F5", "E5"]);

  assert.deepEqual(
    selectedGroupIds(
      data,
      { pageIndex: 0, visualGroupId: groups[0].visual_group_id },
      0,
      false,
    ),
    new Set(groups.map((value) => value.visual_group_id)),
  );
});
