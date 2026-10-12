import assert from "node:assert/strict";
import test from "node:test";
import { PIANO_KEYS } from "../PianoKeyboard";
import type { PerformanceNote, PerformanceRoute } from "../realtime";
import {
  BLACK_NOTE_HEIGHT,
  HIGHWAY_HALF_WIDTH,
  highwayCamera,
  highwayKeyLane,
  highwayTrackForRoute,
  highwayTrackForSteps,
  keyApproachProgress,
  NOTE_INSTANCE_FLOATS,
  practiceStepPositions,
  projectToNdc,
  visibleNoteRange,
  WHITE_NOTE_HEIGHT,
} from "./highwayModel";
import { approachOpacity } from "./keyApproachPainter";

function note(id: string, pitch: string, onset: number, release: number): PerformanceNote {
  return { id, musicXmlId: id, pitch, dynamic: "mp", onset, release, visual: null };
}

function route(notes: PerformanceNote[], bpm = 120): PerformanceRoute {
  const totalQuarters = Math.max(4, ...notes.map((candidate) => candidate.release));
  return {
    occurrences: [{
      id: "m1",
      routeIndex: 0,
      measureIndex: 0,
      measureNumber: "1",
      pageNumber: 1,
      pass: 1,
      scoreStart: 0,
      scoreEnd: 4,
      localStart: 0,
    }],
    notes,
    events: [],
    tempoSegments: [{ offset: 0, bpm }],
    totalQuarters,
  };
}

test("puts every key's lane under that key on the 88-key keyboard", () => {
  for (const key of PIANO_KEYS) {
    const lane = highwayKeyLane(key.midi);
    assert.ok(lane, `lane for ${key.name}`);
    assert.equal(lane.black, key.black);
  }
  assert.equal(highwayKeyLane(21)?.center, 0.5 - HIGHWAY_HALF_WIDTH);
  assert.equal(highwayKeyLane(108)?.center, HIGHWAY_HALF_WIDTH - 0.5);
  // C#4 straddles the C4/D4 boundary.
  const c4 = highwayKeyLane(60)!;
  const d4 = highwayKeyLane(62)!;
  assert.equal(highwayKeyLane(61)?.center, (c4.center + d4.center) / 2);
  assert.equal(highwayKeyLane(20), null);
  assert.equal(highwayKeyLane(109), null);
});

test("builds note instances in score seconds with distinct black-key models", () => {
  const notes = highwayTrackForRoute(route([
    note("b", "C#4", 2, 3),
    note("a", "C4", 0, 1),
    note("out", "C9", 0, 1),
    note("empty", "D4", 1, 1),
  ])).notes;
  assert.equal(notes.count, 2);
  // 120 BPM: a quarter is half a second, and instances are sorted by start.
  assert.deepEqual(Array.from(notes.starts), [0, 1]);
  assert.deepEqual(Array.from(notes.ends), [0.5, 1.5]);
  assert.deepEqual(Array.from(notes.midis), [60, 61]);
  assert.equal(notes.maxDuration, 0.5);
  const white = notes.instances.subarray(0, NOTE_INSTANCE_FLOATS);
  const black = notes.instances.subarray(NOTE_INSTANCE_FLOATS, NOTE_INSTANCE_FLOATS * 2);
  assert.equal(white[3], 0);
  assert.equal(black[3], 1);
  assert.ok(Math.abs(white[2] - WHITE_NOTE_HEIGHT) < 1e-6);
  assert.ok(Math.abs(black[2] - BLACK_NOTE_HEIGHT) < 1e-6);
  assert.ok(black[1] < white[1], "black-key notes are narrower");
  assert.ok(black[2] > white[2], "black-key notes are taller");
});

test("marks bar starts strongly and quarters faintly", () => {
  const lines = highwayTrackForRoute(route([note("a", "C4", 0, 4)], 60)).lines;
  assert.deepEqual(Array.from(lines.times), [0, 1, 2, 3]);
  assert.ok(lines.instances[1] > lines.instances[3]);
});

test("lays note-by-note moments out one step each, extending tied notes", () => {
  const moment = (pitches: string[], held: string[], barKey: string) => ({
    pitches,
    keyboardNotes: [...pitches, ...held].map((pitch) => ({ pitch })),
    barKey,
  });
  const track = highwayTrackForSteps([
    moment(["C4", "E4"], [], "bar-1"),
    moment(["D4"], ["E4"], "bar-1"),
    moment(["E4"], [], "bar-2"),
    moment([], ["E4"], "bar-2"),
    // C4 is not held into this moment, so showing it here does not revive it.
    moment([], ["C4"], "bar-2"),
  ]);
  const notes = Array.from(track.notes.midis, (midi, index) => ({
    midi,
    start: track.notes.starts[index],
    end: track.notes.ends[index],
  }));
  assert.deepEqual(notes, [
    { midi: 60, start: 0, end: 1 },
    { midi: 64, start: 0, end: 2 },
    { midi: 62, start: 1, end: 2 },
    { midi: 64, start: 2, end: 4 },
  ]);
  assert.deepEqual(Array.from(track.lines.times), [0, 2], "a line at each bar's first moment");
});

test("ghosts the other hand's notes and keeps them from lighting keys", () => {
  const twoHands = route([
    { ...note("rh", "C5", 2, 3), left: false },
    { ...note("lh", "C3", 2, 3), left: true },
  ]);
  assert.deepEqual(Array.from(highwayTrackForRoute(twoHands).notes.ghosts), [0, 0]);
  const left = highwayTrackForRoute(twoHands, "left").notes;
  const ghostByMidi = Object.fromEntries(Array.from(left.midis, (midi, index) => [midi, left.ghosts[index]]));
  assert.deepEqual(ghostByMidi, { 72: 1, 48: 0 });
  const instanceGhost = left.instances[NOTE_INSTANCE_FLOATS - 1 + NOTE_INSTANCE_FLOATS * left.midis.indexOf(72)];
  assert.equal(instanceGhost, 1, "the shader receives the ghost flag");

  const progress = new Float32Array(88);
  keyApproachProgress(left, 0.5, 2, progress);
  assert.ok(progress[48 - 21] > 0);
  assert.equal(progress[72 - 21], 0);
});

test("spreads moments the practised hand skips between its steps", () => {
  const attack = (pitch: string, left: boolean) => ({ pitch, left, startsAttack: true });
  const moments = [
    { pitches: ["C5", "C3"], keyboardNotes: [], notes: [attack("C5", false), attack("C3", true)], barKey: "b1" },
    { pitches: ["D5"], keyboardNotes: [], notes: [attack("D5", false)], barKey: "b1" },
    { pitches: ["E3"], keyboardNotes: [], notes: [attack("E3", true)], barKey: "b1" },
  ];
  assert.deepEqual(practiceStepPositions(moments, "both"), [0, 1, 2]);
  assert.deepEqual(practiceStepPositions(moments, "left"), [0, 0.5, 1]);

  const track = highwayTrackForSteps(moments, "left");
  const notes = Array.from(track.notes.midis, (midi, index) => ({
    midi,
    start: track.notes.starts[index],
    end: track.notes.ends[index],
    ghost: track.notes.ghosts[index],
  })).sort((left, right) => left.start - right.start || left.midi - right.midi);
  assert.deepEqual(notes, [
    { midi: 48, start: 0, end: 1, ghost: 0 },
    { midi: 72, start: 0, end: 0.5, ghost: 1 },
    { midi: 74, start: 0.5, end: 1, ghost: 1 },
    { midi: 52, start: 1, end: 2, ghost: 0 },
  ]);
});

test("selects only notes that can be on the highway", () => {
  const notes = highwayTrackForRoute(route([
    note("long", "C4", 0, 16),
    note("past", "E4", 1, 2),
    note("soon", "G4", 12, 13),
    note("later", "A4", 30, 31),
  ])).notes;
  const { start, end } = visibleNoteRange(notes, 6, 3);
  const selected = Array.from(notes.midis.subarray(start, end));
  assert.ok(selected.includes(60), "a note still sounding stays in range");
  assert.ok(selected.includes(67), "a note inside the lookahead window is in range");
  assert.ok(!selected.includes(69), "a note beyond the window is out of range");
});

test("ramps each key toward its nearest upcoming note", () => {
  // 120 BPM: C4 at 2 s and again at 3 s, E4 at 1 s, G4 beyond a 2 s window.
  const notes = highwayTrackForRoute(route([
    note("c-first", "C4", 4, 5),
    note("c-again", "C4", 6, 7),
    note("e", "E4", 2, 3),
    note("g", "G4", 10, 11),
  ])).notes;
  const progress = new Float32Array(88);
  keyApproachProgress(notes, 0.5, 2, progress);
  assert.equal(progress[60 - 21], 0.25, "C4 follows its nearer note, 1.5 s away");
  assert.equal(progress[64 - 21], 0.75);
  assert.equal(progress[67 - 21], 0, "notes beyond the window leave the key dark");

  keyApproachProgress(notes, 1.0, 2, progress);
  assert.equal(progress[64 - 21], 1, "a key is fully lit when its note is due");
  keyApproachProgress(notes, 1.05, 2, progress);
  assert.equal(progress[64 - 21], 1, "and stays lit until the playing highlight takes over");
});

test("keeps far approaches faint and strengthens them near the keys", () => {
  assert.equal(approachOpacity(0), 0);
  const far = approachOpacity(0.05);
  const halfway = approachOpacity(0.5);
  const due = approachOpacity(1);
  assert.ok(far > 0 && far <= 0.07, `far ${far}`);
  assert.ok(halfway < (far + due) / 2, "eased, not linear");
  assert.ok(due > halfway && due <= 0.7, `due ${due}`);
});

test("fits the hit line to the canvas bottom and the far end to its top", () => {
  for (const aspect of [1.6, 3, 5.5]) {
    const camera = highwayCamera(aspect);
    const [leftX, leftY] = projectToNdc(camera.viewProjection, [-HIGHWAY_HALF_WIDTH, 0, 0]);
    const [rightX, rightY] = projectToNdc(camera.viewProjection, [HIGHWAY_HALF_WIDTH, 0, 0]);
    const [, farY] = projectToNdc(camera.viewProjection, [0, 0, -camera.length]);
    const [farRightX] = projectToNdc(camera.viewProjection, [HIGHWAY_HALF_WIDTH, 0, -camera.length]);
    assert.ok(Math.abs(leftX + 1) < 1e-4 && Math.abs(rightX - 1) < 1e-4, `width at ${aspect}`);
    assert.ok(Math.abs(leftY + 1) < 1e-4 && Math.abs(rightY + 1) < 1e-4, `bottom at ${aspect}`);
    assert.ok(Math.abs(farY - 1) < 1e-4, `top at ${aspect}`);
    assert.ok(farRightX > 0.6 && farRightX < 0.8, "the far end narrows in perspective");
  }
});
