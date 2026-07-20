import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackTimeline,
  initialPlaybackState,
  playbackPitchForNote,
  playbackGroupIdsForPage,
  runPlaybackCommand,
  seekPlaybackToGroup,
  type PlaybackCommand,
  type PlaybackState,
} from "./playback";
import type { DocumentPage, VisualGroup, VisualSidecar, VisualSidecarNote } from "./types";

function group(id: string, staffIndex: number, staveIndex: number, x: number, y: number): VisualGroup {
  return {
    visual_group_id: id,
    staff_index: staffIndex,
    stave_index: staveIndex,
    staff_position: 0,
    center: [x, y],
    bbox: [x - 10, y - 8, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [],
    stem_contours: [],
    musicxml_ids: [`note-${id}`],
  };
}

function page(index: number, groups: VisualGroup[], measures: number[]): DocumentPage {
  const sidecar: VisualSidecar = {
    version: 1,
    source_image_size: [1000, 1400],
    visual_groups: groups,
    notes: groups.map((value, groupIndex) => ({
      musicxml_id: `note-${value.visual_group_id}`,
      part: 1,
      measure: measures[groupIndex],
      staff: value.stave_index + 1,
      voice: 1,
      pitch: "C4",
      duration: "note_4",
      match_confidence: 1,
      visual_group_id: value.visual_group_id,
    })),
    unmatched_musicxml_notes: [],
    unmatched_visual_notes: [],
  };
  return { index, status: "complete", width: 1000, height: 1400, visualSidecar: sidecar };
}

function activeAtFirst(pages: DocumentPage[]): { timeline: ReturnType<typeof buildPlaybackTimeline>; state: PlaybackState } {
  const timeline = buildPlaybackTimeline(pages);
  return { timeline, state: runPlaybackCommand(timeline, initialPlaybackState, "togglePlayback") };
}

function run(
  timeline: ReturnType<typeof buildPlaybackTimeline>,
  state: PlaybackState,
  command: PlaybackCommand,
): PlaybackState {
  return runPlaybackCommand(timeline, state, command);
}

test("prefers the resolved MusicXML accidental over a natural-only sidecar pitch", () => {
  const note: VisualSidecarNote = {
    musicxml_id: "note-flat",
    part: 1,
    measure: 1,
    staff: 1,
    voice: 1,
    pitch: "A3",
    duration: "note_4",
    match_confidence: 1,
    visual_group_id: "flat",
  };

  assert.equal(playbackPitchForNote(note, new Map([["note-flat", "A♭3"]])), "A♭3");
});

test("groups a chord and aligned notes in different clefs into one playhead moment", () => {
  const upper = group("upper", 0, 0, 200, 250);
  const chord = group("chord", 0, 0, 212, 270);
  chord.stem_component_ids = ["stem-1"];
  upper.stem_component_ids = ["stem-1"];
  const lower = group("lower", 0, 1, 204, 420);
  const timeline = buildPlaybackTimeline([page(0, [upper, chord, lower], [1, 1, 1])]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["chord", "lower", "upper"]);
  assert.deepEqual(timeline[0].pitches, ["C4"]);
});

test("keeps vertically aligned notes on different systems as separate moments", () => {
  const timeline = buildPlaybackTimeline([
    page(0, [group("system-1", 0, 0, 200, 250), group("system-2", 1, 0, 200, 750)], [1, 3]),
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].visualGroupIds[0], "system-1");
  assert.equal(timeline[1].visualGroupIds[0], "system-2");
});

test("moves by notes and clamps at the first and last moments", () => {
  const { timeline, state: first } = activeAtFirst([
    page(0, [group("a", 0, 0, 100, 200), group("b", 0, 0, 200, 200)], [1, 1]),
  ]);
  const beforeFirst = run(timeline, first, "backwardNote");
  const second = run(timeline, first, "forwardNote");
  const afterLast = run(timeline, second, "forwardNote");

  assert.equal(beforeFirst.currentMomentId, timeline[0].id);
  assert.equal(second.currentMomentId, timeline[1].id);
  assert.equal(afterLast.currentMomentId, timeline[1].id);
});

test("seeks playback to a mouse-selected group and continues navigation there", () => {
  const upperFirst = group("upper-first", 0, 0, 100, 200);
  const lowerFirst = group("lower-first", 0, 1, 102, 400);
  const upperSecond = group("upper-second", 0, 0, 200, 200);
  const lowerSecond = group("lower-second", 0, 1, 202, 400);
  const { timeline, state: first } = activeAtFirst([
    page(0, [upperFirst, lowerFirst, upperSecond, lowerSecond], [1, 1, 1, 1]),
  ]);

  const selected = seekPlaybackToGroup(timeline, first, {
    pageIndex: 0,
    visualGroupId: "lower-second",
  });
  const previous = run(timeline, selected, "backwardNote");

  assert.equal(selected.currentMomentId, timeline[1].id);
  assert.deepEqual(timeline[1].visualGroupIds, ["lower-second", "upper-second"]);
  assert.equal(previous.currentMomentId, timeline[0].id);
});

test("starts playback at a group selected before entering playback mode", () => {
  const timeline = buildPlaybackTimeline([
    page(
      0,
      [group("first", 0, 0, 100, 200), group("selected", 0, 0, 200, 200)],
      [1, 1],
    ),
  ]);

  const active = runPlaybackCommand(timeline, initialPlaybackState, "togglePlayback", {
    pageIndex: 0,
    visualGroupId: "selected",
  });

  assert.equal(active.active, true);
  assert.equal(active.currentMomentId, timeline[1].id);
});

test("ignores mouse selection outside playback or when the group has no timeline moment", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const active = run(timeline, initialPlaybackState, "togglePlayback");

  assert.equal(
    seekPlaybackToGroup(timeline, initialPlaybackState, { pageIndex: 0, visualGroupId: "a" }),
    initialPlaybackState,
  );
  assert.equal(
    seekPlaybackToGroup(timeline, active, { pageIndex: 0, visualGroupId: "missing" }),
    active,
  );
  assert.equal(seekPlaybackToGroup(timeline, active, null), active);
});

test("moves to the first moment of the next and previous bars", () => {
  const { timeline, state: first } = activeAtFirst([
    page(
      0,
      [group("a", 0, 0, 100, 200), group("b", 0, 0, 200, 200), group("c", 0, 0, 300, 200)],
      [1, 1, 2],
    ),
  ]);
  const second = run(timeline, first, "forwardNote");
  const nextBar = run(timeline, second, "forwardBar");
  const previousBar = run(timeline, nextBar, "backwardBar");

  assert.equal(nextBar.currentMomentId, timeline[2].id);
  assert.equal(previousBar.currentMomentId, timeline[0].id);
});

test("page commands target page beginnings and the document edges", () => {
  const pages = [
    page(0, [group("p1a", 0, 0, 100, 200), group("p1b", 0, 0, 200, 200)], [1, 1]),
    page(1, [group("p2a", 0, 0, 100, 200), group("p2b", 0, 0, 200, 200)], [2, 2]),
  ];
  const { timeline, state: first } = activeAtFirst(pages);
  const pageTwo = run(timeline, first, "forwardPage");
  const pageOne = run(timeline, pageTwo, "backwardPage");
  const last = run(timeline, pageTwo, "forwardPage");
  const firstAgain = run(timeline, pageOne, "backwardPage");

  assert.equal(pageTwo.currentMomentId, timeline[2].id);
  assert.equal(pageOne.currentMomentId, timeline[0].id);
  assert.equal(last.currentMomentId, timeline[3].id);
  assert.equal(firstAgain.currentMomentId, timeline[0].id);
});

test("navigation is inactive outside playback mode and toggle exits cleanly", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  assert.equal(run(timeline, initialPlaybackState, "forwardNote"), initialPlaybackState);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  assert.deepEqual(run(timeline, active, "togglePlayback"), initialPlaybackState);
});

test("note sounds toggle only in playback mode and survive leaving playback", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  assert.equal(run(timeline, initialPlaybackState, "toggleNoteSounds"), initialPlaybackState);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  const muted = run(timeline, active, "toggleNoteSounds");
  assert.equal(muted.noteSoundsEnabled, false);
  const inactive = run(timeline, muted, "togglePlayback");
  assert.equal(inactive.active, false);
  assert.equal(inactive.noteSoundsEnabled, false);
  assert.equal(run(timeline, inactive, "togglePlayback").noteSoundsEnabled, false);
});

test("reuses the empty page selection so memoized overlays stay memoized", () => {
  const { timeline } = activeAtFirst([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const firstEmptySelection = playbackGroupIdsForPage(timeline[0], 1);
  const secondEmptySelection = playbackGroupIdsForPage(timeline[0], 2);
  const inactiveSelection = playbackGroupIdsForPage(null, 0);

  assert.equal(firstEmptySelection, secondEmptySelection);
  assert.equal(secondEmptySelection, inactiveSelection);
  assert.equal(playbackGroupIdsForPage(timeline[0], 0), timeline[0].visualGroupIds);
});
