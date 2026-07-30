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
  isHollowNotehead = false,
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
    is_hollow_notehead: isHollowNotehead,
    musicxml_ids: [`note-${index}`],
    visual_status: "fallback",
    provenance: "segmentation",
    moment_id: null,
    chord_id: null,
    repair_actions: [],
  };
}

function sidecar(groups: VisualGroup[], pitches: string[]): VisualSidecar {
  return {
    version: 2,
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
      alignment_method: "attention",
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

test("does not infer a chord from vertically aligned noteheads without a shared stem", () => {
  // Page 2, local measure 16 (document measure 34): these noteheads are
  // vertically aligned, but belong to independent voices and durations.
  const groups = [group(0, 1892.965, 2184.157), group(1, 1892.87, 2213.511)];
  const data = sidecar(groups, ["C5", "G4"]);
  data.notes[0].voice = 2;
  data.notes[1].duration = "note_8";

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

test("selects an aligned chord of stemless whole notes", () => {
  // Page 1, measure 9 bass clef: F3 and A3 form a whole-note chord.
  const groups = [
    group(0, 970.697, 2034.109, [], 1, true),
    group(1, 970.697, 2013.445, [], 1, true),
  ];
  const data = sidecar(groups, ["F3", "A3"]);
  for (const note of data.notes) {
    note.measure = 9;
    note.staff = 2;
    note.voice = 5;
    note.duration = "note_1";
  }

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

test("does not group aligned whole notes from different voices", () => {
  const groups = [
    group(0, 500, 480, [], 0, true),
    group(1, 500, 520, [], 0, true),
  ];
  const data = sidecar(groups, ["C5", "G4"]);
  data.notes[0].duration = "note_1";
  data.notes[1].duration = "note_1";
  data.notes[1].voice = 2;

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

test("does not select other aligned note columns without shared stems", () => {
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
    new Set([groups[0].visual_group_id]),
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

test("canonical chord selection uses chord_id instead of legacy geometry", () => {
  const groups = [group(0, 100, 100), group(1, 180, 160), group(2, 100, 220)];
  for (const candidate of groups) {
    candidate.visual_status = "canonical";
    candidate.moment_id = "moment-1";
  }
  groups[0].chord_id = "chord-1";
  groups[1].chord_id = "chord-1";
  groups[0].stem_component_ids = ["legacy-stem"];
  groups[2].stem_component_ids = ["legacy-stem"];
  const data = sidecar(groups, ["C5", "E4", "C3"]);

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

test("fallback chord selection also uses chord_id", () => {
  const groups = [group(0, 100, 100), group(1, 180, 160)];
  groups[0].chord_id = "chord-1";
  groups[1].chord_id = "chord-1";
  const data = sidecar(groups, ["C5", "E4"]);

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

test("diagnostic and unlinked groups are excluded from selection and labels", () => {
  const linked = group(0, 100, 100);
  const diagnostic = group(1, 180, 100);
  diagnostic.visual_status = "diagnostic";
  const unlinked = group(2, 260, 100);
  unlinked.musicxml_ids = [];
  const data = sidecar([linked, diagnostic, unlinked], ["C4", "D4", "E4"]);

  assert.deepEqual(
    selectedGroupIds(data, null, 0, true),
    new Set([linked.visual_group_id]),
  );
  assert.deepEqual(
    selectedGroupIds(
      data,
      { pageIndex: 0, visualGroupId: diagnostic.visual_group_id },
      0,
      false,
      true,
    ),
    new Set([diagnostic.visual_group_id]),
  );
  assert.equal(
    layoutNoteLabels(
      data,
      new Set([diagnostic.visual_group_id]),
      1000,
      1400,
    ).length,
    0,
  );
});
