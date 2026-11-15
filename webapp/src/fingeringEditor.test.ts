import assert from "node:assert/strict";
import test from "node:test";
import { applyTypedRun, editorLabelHand, editWalk, momentTargets, navigateWalk, printedFingerReplaced, withFingeringLayers } from "./fingeringEditor";
import { resolveFingerings, type FingeringOverrides } from "./musicxml";
import { buildPlaybackTimeline, timelineForPracticeHand, type PlaybackMoment } from "./playback";
import type { FingeringLayers, LoadedDocument } from "./types";

const id = (key: string) => `page-1-${key}`;

function moment(momentId: string, notes: [key: string, pitch: string, left: boolean][], startsAttack = true): PlaybackMoment {
  return {
    id: momentId,
    pageIndex: 0,
    staffGroupIndex: 0,
    measure: 1,
    measureIndex: 0,
    barKey: "bar",
    visualGroupIds: notes.map(([key]) => key),
    pitches: notes.map(([, pitch]) => pitch),
    dynamic: "mp",
    keyboardNotes: [],
    center: [0, 0],
    notes: notes.map(([key, pitch, left]) => ({ pitch, left, startsAttack, visualGroupId: key })),
  };
}

const layers: FingeringLayers = {
  predicted: {
    [id("a-E4")]: { finger: 1, left: false },
    [id("a-C5")]: { finger: 5, left: false },
    [id("a-A2")]: { finger: 5, left: true },
    [id("b-D5")]: { finger: 4, left: false },
    [id("c-E5")]: { finger: 5, left: false },
  },
  printed: { [id("a-A4")]: { finger: 3, left: false } },
  tiedTo: {},
  overrides: {},
  overridesError: null,
  fittedConstraints: "",
};
const fingerings = resolveFingerings(layers, {});
const resolve = (overrides: FingeringOverrides, id: string) => resolveFingerings(layers, overrides)[id];
const timeline = [
  moment("a", [["a-E4", "E4", false], ["a-C5", "C5", false], ["a-A4", "A4", false], ["a-A2", "A2", true], ["a-rest", "B4", false]]),
  moment("b", [["b-D5", "D5", false]]),
  moment("tied", [["c-E5", "E5", false]], false),
];

test("a moment's fingered notes are walked top note first, across both hands", () => {
  assert.deepEqual(momentTargets(timeline[0], fingerings).map((target) => target.pitch), ["C5", "A4", "E4", "A2"]);
  assert.deepEqual(momentTargets(timeline[2], fingerings), [], "a held note is not struck again");
  assert.deepEqual(editWalk(timeline, fingerings).map((target) => target.key), ["a-C5", "a-A4", "a-E4", "a-A2", "b-D5"]);
});

test("a typed run sets a finger per note and moves on, across moments", () => {
  const walk = editWalk(timeline, fingerings);
  const result = applyTypedRun("5 3 2-14", walk, 0, {}, resolve);
  assert.deepEqual(result.overrides, {
    "a-C5": { finger: 5 },
    "a-E4": { finger: 2 },
    "a-A2": { finger: 1 },
    "b-D5": { finger: 4 },
  }, "a printed finger typed again is no override");
  assert.equal(result.end, walk.length - 1, "the walk stops at its last note");
  assert.deepEqual(result.changed.length, 5);
});

test("0 restores the printed or predicted finger and h moves a note to the other hand without moving on", () => {
  const walk = editWalk(timeline, fingerings);
  const start = { "a-C5": { finger: 2 } };
  const reset = applyTypedRun("0", walk, 0, start, resolve);
  assert.deepEqual([reset.overrides, reset.end], [{}, 1]);
  const moved = applyTypedRun("h", walk, 2, {}, resolve);
  assert.deepEqual([moved.overrides, moved.end], [{ "a-E4": { left: true } }, 2]);
  const back = applyTypedRun("h", walk, 2, moved.overrides, resolve);
  assert.deepEqual(back.overrides, {}, "moving it back to its staff's hand is no override");
});

test("a document takes its fingerings resolved from its layers", () => {
  const document = withFingeringLayers({ jobId: "j", name: "s", pageCount: 1, status: "complete", pages: [], source: { kind: "musicxml", sourcePath: "s.musicxml" } } as LoadedDocument, {
    ...layers,
    overrides: { "a-E4": { finger: 3, left: true } },
  });
  assert.deepEqual(document.predictedFingerings?.[id("a-E4")], { finger: 3, left: true });
  assert.deepEqual(document.predictedFingerings?.[id("a-A4")], { finger: 3, left: false });
  assert.equal(document.predictedFingeringCount, 6);
});

test("practising one hand follows a note moved to the other hand", () => {
  const geometry = [{
    pageIndex: 0,
    measureOffset: 0,
    systems: [{ index: 0, top: 0, bottom: 100, firstMeasure: 0, barlines: [0, 100] }],
    noteheads: [
      { id: "P1-m1-s1-v1-t0-C5", systemIndex: 0, center: [10, 10] as [number, number], noteheadBounds: [5, 5, 15, 15] as [number, number, number, number], hitAreas: [], bounds: [5, 5, 15, 15] as [number, number, number, number], chordId: "c1", momentId: "m1-t0" },
      { id: "P1-m1-s2-v5-t0-C3", systemIndex: 0, center: [10, 80] as [number, number], noteheadBounds: [5, 75, 15, 85] as [number, number, number, number], hitAreas: [], bounds: [5, 75, 15, 85] as [number, number, number, number], chordId: "c2", momentId: "m1-t0" },
    ],
    notes: [
      { id: "page-1-P1-m1-s1-v1-t0-C5", noteheadId: "P1-m1-s1-v1-t0-C5", pitch: "C5", grace: false, measure: 1 },
      { id: "page-1-P1-m1-s2-v5-t0-C3", noteheadId: "P1-m1-s2-v5-t0-C3", pitch: "C3", grace: false, measure: 1 },
    ],
  }];
  const facts = {
    suppressedNoteIds: new Set<string>(),
    startsAttackByNoteId: new Map<string, boolean>(),
    dynamicByNoteId: new Map(),
    leftByNoteId: new Map([["page-1-P1-m1-s1-v1-t0-C5", false], ["page-1-P1-m1-s2-v5-t0-C3", true]]),
  };
  const fingers = {
    "page-1-P1-m1-s1-v1-t0-C5": { finger: 1, left: false },
    // The bass note, moved to the right hand.
    "page-1-P1-m1-s2-v5-t0-C3": { finger: 2, left: false },
  };
  const full = buildPlaybackTimeline(geometry, facts, fingers);
  const right = timelineForPracticeHand(full, "right");
  assert.deepEqual(right[0].pitches.sort(), ["C3", "C5"]);
  assert.deepEqual(timelineForPracticeHand(full, "left"), []);
});

test("the cursor moves by note, bar and page as the playhead does", () => {
  const target = (key: string, barKey: string, pageIndex = 0) => ({
    id: `page-${pageIndex + 1}-${key}`, pageIndex, key, pitch: "C4", momentId: key, measure: null, barKey,
    staffGroupIndex: 0, x: 0,
  });
  const walk = [
    target("a", "bar1"), target("b", "bar1"), target("c", "bar2"), target("d", "bar2"),
    target("e", "bar3", 1), target("f", "bar3", 1),
  ];
  assert.equal(navigateWalk(walk, 0, "forwardNote"), 1);
  assert.equal(navigateWalk(walk, 5, "forwardNote"), 5, "the last note stays");
  assert.equal(navigateWalk(walk, 0, "backwardNote"), 0);
  assert.equal(navigateWalk(walk, 1, "forwardBar"), 2);
  assert.equal(navigateWalk(walk, 3, "backwardBar"), 0, "back to the start of the bar before");
  assert.equal(navigateWalk(walk, 1, "backwardBar"), 0);
  assert.equal(navigateWalk(walk, 1, "forwardPage"), 4);
  assert.equal(navigateWalk(walk, 5, "backwardPage"), 0);
  assert.equal(navigateWalk(walk, 5, "rewind"), 0);
  assert.equal(navigateWalk([], 0, "forwardNote"), -1);
});

test("the cursor steps by system to the note across from it, nearest in pitch of a chord's", () => {
  const target = (key: string, pitch: string, staffGroupIndex: number, x: number, pageIndex = 0) => ({
    id: `page-${pageIndex + 1}-${key}`, pageIndex, key, pitch, momentId: `${pageIndex}-${staffGroupIndex}-${x}`,
    measure: null, barKey: `bar-${staffGroupIndex}`, staffGroupIndex, x,
  });
  const walk = [
    target("a-high", "E5", 0, 100), target("a-low", "C3", 0, 100), target("b", "G4", 0, 400),
    // A chord across from the first: its top note and its bass.
    target("c-high", "G5", 1, 110), target("c-low", "E3", 1, 110), target("d", "A4", 1, 380),
    target("e", "C4", 0, 90, 1),
  ];
  const step = (key: string, command: "forwardSystem" | "backwardSystem") =>
    walk[navigateWalk(walk, walk.findIndex((value) => value.key === key), command)].key;
  assert.equal(step("a-high", "forwardSystem"), "c-high");
  assert.equal(step("a-low", "forwardSystem"), "c-low", "the bass goes to the bass");
  assert.equal(step("b", "forwardSystem"), "d");
  assert.equal(step("c-low", "backwardSystem"), "a-low");
  assert.equal(step("d", "forwardSystem"), "e", "on to the next page");
  assert.equal(step("e", "forwardSystem"), "e", "the last system stays");
});

test("a printed finger gets a label once its note moves to the other hand, and is struck out", () => {
  const printed = { [id("a")]: { finger: 3, left: false } };
  const resolve = (overrides: FingeringOverrides) => resolveFingerings({ predicted: {}, printed }, overrides)[id("a")];
  const kept = resolve({});
  assert.equal(editorLabelHand(kept, true), undefined, "the score's digit shows it");
  assert.equal(printedFingerReplaced(kept), false);
  const moved = resolve({ a: { left: true } });
  assert.equal(moved.source, "printed");
  assert.equal(editorLabelHand(moved, true), true, "a label on the left hand's side");
  assert.equal(printedFingerReplaced(moved), true);
  const refingered = resolve({ a: { finger: 1 } });
  assert.equal(editorLabelHand(refingered, true), false);
  assert.equal(printedFingerReplaced(refingered), true);
  // A printed finger the page does not show as a digit, and a held note.
  assert.equal(editorLabelHand(kept, false), false);
  assert.equal(editorLabelHand({ ...kept, tiedTo: id("b") }, false), undefined);
});

test("a moment's notes go in the order their labels stand, notes moved to a hand beyond its own", () => {
  // A treble E5 moved to the left hand, and a bass E3 moved to the right hand.
  const chord = moment("m", [["e5", "E5", false], ["c5", "C5", false], ["e3", "E3", true], ["c3", "C3", true]]);
  const fingerings = {
    [id("e5")]: { finger: 1, left: true, handMoved: true },
    [id("c5")]: { finger: 2, left: false, handMoved: false },
    [id("e3")]: { finger: 3, left: false, handMoved: true },
    [id("c3")]: { finger: 5, left: true, handMoved: false },
  };
  // Above the treble the moved E3 stands over the right hand's own; below the bass the moved
  // E5 stands under the left hand's own.
  assert.deepEqual(momentTargets(chord, fingerings).map((target) => target.key), ["e3", "c5", "c3", "e5"]);
});
