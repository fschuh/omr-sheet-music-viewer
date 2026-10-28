import assert from "node:assert/strict";
import test from "node:test";
import { PIANO_KEYS } from "../PianoKeyboard";
import type { PerformanceNote, PerformanceRoute } from "../realtime";
import {
  HIGHWAY_HALF_WIDTH,
  highwayCamera,
  highwayKeyLane,
  highwayLayout,
  highwayLookaheadQuarters,
  highwayTrackForRoute,
  highwayTrackForSteps,
  highwayTrackLooped,
  keyApproachProgress,
  keyboardSurfaceMatrix,
  keyboardSurfaceTransform,
  NOTE_HEIGHTS,
  NOTE_INSTANCE_FLOATS,
  NOTE_LANE_INSET,
  practiceStepPositions,
  projectSurfacePoint,
  projectToNdc,
  uprightX,
  visibleNoteRange,
  wholeKeyNoteSpan,
} from "./highwayModel";
import { approachLevel } from "./keyApproachPainter";
import { FULL_KEYBOARD_RANGE } from "../keyboardView";

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
  // C#4 is the second of five equal parts across C4 to E4, a tenth of a white key
  // left of the C4/D4 edge.
  const c4 = highwayKeyLane(60)!;
  const d4 = highwayKeyLane(62)!;
  assert.ok(Math.abs(highwayKeyLane(61)!.center - ((c4.center + d4.center) / 2 - 0.1)) < 1e-9);
  assert.equal(highwayKeyLane(20), null);
  assert.equal(highwayKeyLane(109), null);
});

test("lanes tile the keyboard edge to edge, as the floor draws them", () => {
  const lanes = PIANO_KEYS.map((key) => highwayKeyLane(key.midi)!).sort((a, b) => a.left - b.left);
  assert.equal(lanes[0].left, -HIGHWAY_HALF_WIDTH);
  assert.equal(lanes.at(-1)!.right, HIGHWAY_HALF_WIDTH);
  for (let index = 1; index < lanes.length; index += 1) {
    assert.ok(Math.abs(lanes[index].left - lanes[index - 1].right) < 1e-9,
      `${lanes[index - 1].midi} meets ${lanes[index].midi}`);
  }
  // Each lane is its key's back: a fifth of C to E, or a seventh of F to B.
  const width = (midi: number) => highwayKeyLane(midi)!.right - highwayKeyLane(midi)!.left;
  for (const midi of [60, 61, 62, 63, 64]) assert.ok(Math.abs(width(midi) - 3 / 5) < 1e-9, `${midi}`);
  for (const midi of [65, 66, 67, 68, 69, 70, 71]) assert.ok(Math.abs(width(midi) - 4 / 7) < 1e-9, `${midi}`);
  // The white keys' straight edges run on to the back.
  assert.ok(Math.abs(highwayKeyLane(64)!.right - (highwayKeyLane(64)!.center + 0.5)) < 1e-9, "E4/F4");
  assert.ok(Math.abs(highwayKeyLane(72)!.left - (highwayKeyLane(72)!.center - 0.5)) < 1e-9, "B4/C5");
  // With no black key beyond them, A0 and C8 reach the keyboard's ends.
  assert.ok(Math.abs(width(21) - 6 / 7) < 1e-9, "A0");
  assert.equal(width(108), 1, "C8");
});

test("each note fills its key's lane, short of the edges, so neighbours never overlap", () => {
  const notes = highwayTrackForRoute(route(PIANO_KEYS.map((key) => note(key.name, key.name, 0, 1)))).notes;
  assert.equal(notes.count, PIANO_KEYS.length);
  const spans = Array.from(notes.midis, (midi, index) => {
    const center = notes.instances[index * NOTE_INSTANCE_FLOATS];
    const half = notes.instances[index * NOTE_INSTANCE_FLOATS + 1];
    const lane = highwayKeyLane(midi)!;
    assert.ok(Math.abs(center - half - (lane.left + NOTE_LANE_INSET)) < 1e-6, `${midi} left`);
    assert.ok(Math.abs(center + half - (lane.right - NOTE_LANE_INSET)) < 1e-6, `${midi} right`);
    return { midi, left: center - half, right: center + half };
  }).sort((a, b) => a.left - b.left);
  for (let index = 1; index < spans.length; index += 1) {
    assert.ok(spans[index].left - spans[index - 1].right > 2 * NOTE_LANE_INSET - 1e-6,
      `${spans[index - 1].midi} and ${spans[index].midi} keep apart`);
  }
});

test("a white-key note as wide as its whole key finds the key from its track", () => {
  const notes = highwayTrackForRoute(route(PIANO_KEYS.map((key) => note(key.name, key.name, 0, 1)))).notes;
  for (let index = 0; index < notes.count; index += 1) {
    const lane = highwayKeyLane(notes.midis[index])!;
    if (lane.black) continue;
    const span = wholeKeyNoteSpan(notes.instances[index * NOTE_INSTANCE_FLOATS]);
    assert.ok(Math.abs(span.center - lane.center) < 1e-6, `${lane.midi}: the key's middle`);
    assert.ok(Math.abs(span.halfWidth - (0.5 - NOTE_LANE_INSET)) < 1e-9);
  }
});

test("a raised note's top stands straight above its lane on screen", () => {
  for (const tilt of [0, 34, 65]) {
    const layout = highwayLayout({ range: FULL_KEYBOARD_RANGE, tilt, keyboard3d: false }, 1600, 480);
    const camera = highwayCamera(1600 / 480, layout);
    for (const x of [-25.5, -8.2, 0.3, 17, 26]) {
      for (const z of [0, -camera.length / 2, -camera.length]) {
        const floor = projectToNdc(camera.viewProjection, [x, 0, z])[0];
        const top = projectToNdc(camera.viewProjection, [uprightX(camera.viewProjection, x, 0.3, z), 0.3, z])[0];
        assert.ok(Math.abs(top - floor) < 1e-5, `tilt ${tilt}, x ${x}, z ${z}`);
        // Left where it was, the top would lean out at the hit line: the shift is real.
        if (Math.abs(x) > 8 && z === 0) {
          const leaning = projectToNdc(camera.viewProjection, [x, 0.3, z])[0];
          assert.ok(Math.abs(leaning - floor) > 1e-3, `tilt ${tilt}, x ${x}: leans unmoved`);
        }
      }
    }
  }
});

test("builds note instances in score seconds, black-key notes as wide and as tall", () => {
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
  assert.equal(white[2], 0);
  assert.equal(black[2], 1);
  assert.ok(Math.abs(black[1] - white[1]) < 1e-6, "C4's and C♯4's notes are as wide");
  assert.ok(black[1] * 2 < 0.6, "and narrower than their key");
  for (const style of ["raised", "flat"] as const) {
    const { white: whiteHeight, black: blackHeight } = NOTE_HEIGHTS[style];
    assert.ok(blackHeight >= whiteHeight, `${style}: drawn over a white-key neighbour`);
    assert.ok(blackHeight - whiteHeight < 0.02, `${style}: but the same height to the eye`);
  }
});

test("keeps each note's hand and predicted finger", () => {
  const twoHands = route([
    { ...note("rh", "E5", 0, 1), left: false },
    { ...note("lh", "C3", 0, 1), left: true },
    { ...note("unknown", "G4", 1, 2) },
    { ...note("tied", "A4", 2, 3), fingeringMusicXmlId: "rh" },
  ]);
  const fingerings = { rh: { finger: 3, left: false }, lh: { finger: 5, left: true } };
  const notes = highwayTrackForRoute(twoHands, "both", fingerings).notes;
  const byMidi = Object.fromEntries(Array.from(notes.midis, (midi, index) => [midi, {
    left: notes.lefts[index],
    shaderLeft: notes.instances[index * NOTE_INSTANCE_FLOATS + 3],
    finger: notes.instances[index * NOTE_INSTANCE_FLOATS + 7],
  }]));
  assert.deepEqual(byMidi, {
    76: { left: 0, shaderLeft: 0, finger: 3 },
    48: { left: 1, shaderLeft: 1, finger: 5 },
    67: { left: 0, shaderLeft: 0, finger: 0 },
    69: { left: 0, shaderLeft: 0, finger: 3 },
  });
  assert.notEqual(highwayTrackForRoute(twoHands, "both"), highwayTrackForRoute(twoHands, "both", fingerings),
    "new fingerings rebuild the cached track");

  const hands = new Uint8Array(88);
  const progress = new Float32Array(88);
  keyApproachProgress(notes, -0.6, 1, progress, hands);
  assert.equal(hands[76 - 21], 1);
  assert.equal(hands[48 - 21], 2);
  assert.equal(hands[67 - 21], 0, "beyond the window");

  const looped = highwayTrackLooped(highwayTrackForRoute(twoHands, "both", fingerings), { start: 0, end: 2 }, 4);
  const repeat = Array.from(looped.notes.midis).lastIndexOf(48);
  assert.equal(looped.notes.lefts[repeat], 1, "a loop's repeats keep the hand");
  assert.equal(looped.notes.instances[repeat * NOTE_INSTANCE_FLOATS + 7], 5, "and the finger");
});

test("takes note-by-note fingers and hands from the keyboard notes", () => {
  const track = highwayTrackForSteps([{
    pitches: ["C4", "C3"],
    keyboardNotes: [{ pitch: "C4", left: false, finger: 1 }, { pitch: "C3", left: true, finger: 5 }],
    notes: [
      { pitch: "C4", left: false, startsAttack: true },
      { pitch: "C3", left: true, startsAttack: true },
    ],
    barKey: "b1",
  }]);
  const byMidi = Object.fromEntries(Array.from(track.notes.midis, (midi, index) => [
    midi,
    [track.notes.lefts[index], track.notes.instances[index * NOTE_INSTANCE_FLOATS + 7]],
  ]));
  assert.deepEqual(byMidi, { 60: [0, 1], 48: [1, 5] });
});

test("a fixed-tempo track keeps every beat the same length through a tempo change", () => {
  const changing = {
    ...route([note("slow", "C4", 0, 1), note("fast", "D4", 2, 3)], 60),
    tempoSegments: [{ offset: 0, bpm: 60 }, { offset: 2, bpm: 120 }],
  };
  // In seconds the quarter after the change is half as long, so its note is too.
  const seconds = highwayTrackForRoute(changing).notes;
  assert.deepEqual(Array.from(seconds.starts), [0, 2]);
  assert.deepEqual(Array.from(seconds.ends), [1, 2.5]);
  const quarters = highwayTrackForRoute(changing, "both", undefined, "quarters");
  assert.notEqual(quarters, highwayTrackForRoute(changing), "cached per axis");
  assert.deepEqual(Array.from(quarters.notes.starts), [0, 2]);
  assert.deepEqual(Array.from(quarters.notes.ends), [1, 3]);
  assert.deepEqual(Array.from(quarters.lines.times), [0, 1, 2, 3]);
  // The window holds what the usual lookahead plays at the opening tempo.
  assert.equal(highwayLookaheadQuarters(120), 6.4);
  assert.equal(highwayLookaheadQuarters(60), 3.2);
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
  const instanceGhost = left.instances[6 + NOTE_INSTANCE_FLOATS * left.midis.indexOf(72)];
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

test("paints approach progress in whole percent, never rounding a coming note away", () => {
  assert.equal(approachLevel(0), 0);
  assert.equal(approachLevel(1e-6), 0.01);
  assert.equal(approachLevel(0.123), 0.12);
  assert.equal(approachLevel(1), 1);
});

test("fits a range's hit line to the canvas width at any tilt, narrowing less the flatter it is", () => {
  // C4 to C5: eight white keys.
  const options = { range: { low: 60, high: 72 }, keyboard3d: false };
  let previousNarrowing = 0;
  for (const tilt of [0, 20, 34, 50, 65]) {
    const layout = highwayLayout({ ...options, tilt }, 1200, 400);
    assert.equal(layout.halfWidth, 4);
    assert.equal(layout.center, highwayKeyLane(65)!.center + 0.5, "centred on the F4/G4 edge");
    const camera = highwayCamera(3, layout);
    const [leftX, leftY] = projectToNdc(camera.viewProjection, [layout.center - 4, 0, 0]);
    const [rightX] = projectToNdc(camera.viewProjection, [layout.center + 4, 0, 0]);
    const [farRightX, farY] = projectToNdc(camera.viewProjection, [layout.center + 4, 0, -camera.length]);
    assert.ok(Math.abs(leftX + 1) < 1e-4 && Math.abs(rightX - 1) < 1e-4, `width at ${tilt}°`);
    assert.ok(Math.abs(leftY + 1) < 1e-4, `bottom at ${tilt}°`);
    assert.ok(Math.abs(farY - 1) < 1e-4, `top at ${tilt}°`);
    const narrowing = 1 - farRightX;
    if (tilt === 0) assert.ok(narrowing < 1e-4, "seen straight on, the far end is as wide");
    else assert.ok(narrowing > previousNarrowing, `steeper perspective at ${tilt}°`);
    previousNarrowing = narrowing;
  }
});

test("lays a 3D keyboard on the floor in front of the hit line, inside the canvas", () => {
  for (const [width, height, tilt] of [[1800, 500, 34], [1800, 500, 0], [1800, 500, 65], [900, 700, 34], [2400, 240, 50]]) {
    const layout = highwayLayout({ range: FULL_KEYBOARD_RANGE, tilt, keyboard3d: true }, width, height);
    const keyboard = layout.keyboard!;
    assert.ok(keyboard.depth > 0 && keyboard.depth <= 6, `depth ${keyboard.depth}`);
    const camera = highwayCamera(width / height, layout);
    assert.ok(camera.length > 0, "the highway keeps its length");
    const project = (point: [number, number, number]) => projectToNdc(camera.viewProjection, point);
    // The bottom of the front faces fills the bottom edge.
    const [frontLeftX, frontY] = project([-HIGHWAY_HALF_WIDTH, -keyboard.frontFace, keyboard.depth]);
    assert.ok(Math.abs(frontLeftX + 1) < 1e-4 && Math.abs(frontY + 1) < 1e-4, `front edge ${width}x${height} ${tilt}°`);
    const [, farY] = project([0, 0, -camera.length]);
    assert.ok(Math.abs(farY - 1) < 1e-4, "far end on the top edge");
    const [, hitY] = project([0, 0, 0]);
    assert.ok((hitY + 1) / 2 <= 0.42 + 1e-3, `the keys leave the highway most of the canvas (${(hitY + 1) / 2})`);

    // The CSS matrix agrees with the camera: the surface's corners land where the camera puts them.
    const matrix = keyboardSurfaceMatrix(camera, layout, width, height);
    const unitPx = width / (2 * layout.halfWidth);
    const toPx = ([x, y]: [number, number, number]) => [(x + 1) / 2 * width, (1 - y) / 2 * height];
    for (const [localX, localY, localZ, world] of [
      [0, 0, 0, [-HIGHWAY_HALF_WIDTH, 0, 0]],
      [width, keyboard.depth * unitPx, 0, [HIGHWAY_HALF_WIDTH, 0, keyboard.depth]],
      [width / 2, 0, keyboard.blackHeight * unitPx, [0, keyboard.blackHeight, 0]],
    ] as const) {
      const [px, py] = projectSurfacePoint(matrix, localX, localY, localZ);
      const [expectedX, expectedY] = toPx(project([...world]));
      assert.ok(Math.abs(px - expectedX) < 0.01 && Math.abs(py - expectedY) < 0.01, `${localX},${localY},${localZ}`);
    }
  }
  assert.equal(highwayLayout({ range: FULL_KEYBOARD_RANGE, tilt: 34, keyboard3d: false }, 1800, 500).keyboard, null);
});

test("splits the keyboard matrix into the parent's perspective and an affine transform", () => {
  for (const [width, height, tilt] of [[1800, 500, 34], [1800, 500, 0], [1800, 500, 65], [900, 700, 34], [2400, 240, 50]]) {
    const layout = highwayLayout({ range: FULL_KEYBOARD_RANGE, tilt, keyboard3d: true }, width, height);
    const keyboard = layout.keyboard!;
    const camera = highwayCamera(width / height, layout);
    const matrix = keyboardSurfaceMatrix(camera, layout, width, height);
    const { perspective, transform } = keyboardSurfaceTransform(camera, layout, width, height);
    // WebKitGTK misdraws preserve-3d children when the element's own transform projects.
    assert.deepEqual([transform[3], transform[7], transform[11], transform[15]], [0, 0, 0, 1]);
    assert.ok(perspective > 0);
    const unitPx = width / (2 * layout.halfWidth);
    for (const [x, y, z] of [
      [0, 0, 0],
      [width, keyboard.depth * unitPx, 0],
      [width / 2, keyboard.depth * unitPx, -keyboard.frontFace * unitPx],
      [width / 3, 0, keyboard.blackHeight * unitPx],
    ]) {
      // CSS perspective about the parent's centre, after the element's own transform.
      const ax = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
      const ay = transform[1] * x + transform[5] * y + transform[9] * z + transform[13];
      const az = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];
      const shrink = perspective / (perspective - az);
      const [expectedX, expectedY] = projectSurfacePoint(matrix, x, y, z);
      assert.ok(
        Math.abs(width / 2 + (ax - width / 2) * shrink - expectedX) < 0.05 &&
          Math.abs(height / 2 + (ay - height / 2) * shrink - expectedY) < 0.05,
        `${width}x${height} ${tilt}° at ${x},${y},${z}`,
      );
    }
  }
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

test("a looped track repeats the loop's notes past its end, with a loop line at each start-over", async () => {
  const { highwayTrackLooped, LOOP_LINE_STRENGTH } = await import("./highwayModel");
  // Steps 0–3: C4, then the loop D4 E4 (bars 2 and 3), then F4 after it.
  const track = highwayTrackForSteps([
    { pitches: ["C4"], keyboardNotes: [{ pitch: "C4" }], barKey: "b1" },
    { pitches: ["D4"], keyboardNotes: [{ pitch: "D4" }], barKey: "b2" },
    { pitches: ["E4"], keyboardNotes: [{ pitch: "E4" }], barKey: "b3" },
    { pitches: ["F4"], keyboardNotes: [{ pitch: "F4" }], barKey: "b4" },
  ]);
  assert.equal(highwayTrackLooped(track, null, 4), track);
  const looped = highwayTrackLooped(track, { start: 1, end: 3 }, 4);
  const notes = Array.from({ length: looped.notes.count }, (_, index) => [
    looped.notes.midis[index],
    looped.notes.starts[index],
    looped.notes.ends[index],
  ]);
  // After the loop's last note comes its first again, never F4 or C4, one pass behind
  // and as far ahead as the window reaches.
  assert.deepEqual(notes, [
    [62, -1, 0], [64, 0, 1],
    [62, 1, 2], [64, 2, 3],
    [62, 3, 4], [64, 4, 5],
    [62, 5, 6], [64, 6, 7],
  ]);
  const lines = Array.from({ length: looped.lines.count }, (_, index) => [
    looped.lines.times[index],
    looped.lines.instances[index * 2 + 1],
  ]);
  // Bar 3's line repeats inside each pass; every start-over is a loop line.
  assert.deepEqual(lines, [
    [-1, LOOP_LINE_STRENGTH], [0, 1],
    [1, LOOP_LINE_STRENGTH], [2, 1],
    [3, LOOP_LINE_STRENGTH], [4, 1],
    [5, LOOP_LINE_STRENGTH], [6, 1],
    [7, LOOP_LINE_STRENGTH],
  ]);
  assert.equal(highwayTrackLooped(track, { start: 1, end: 3 }, 4), looped);
  assert.notEqual(highwayTrackLooped(track, { start: 1, end: 2 }, 4), looped);
});

test("a looped realtime route shows its start again after its end", async () => {
  const { highwayTrackLooped } = await import("./highwayModel");
  // Two quarters at 120 BPM: the loop lasts one second.
  const track = highwayTrackForRoute({ ...route([note("a", "C4", 0, 1), note("b", "D4", 1, 2)]), totalQuarters: 2 });
  const looped = highwayTrackLooped(track, { start: 0, end: 1 }, 3.2);
  const ahead = Array.from({ length: looped.notes.count }, (_, index) => [looped.notes.midis[index], looped.notes.starts[index]])
    .filter(([, start]) => start >= 1 && start < 2);
  assert.deepEqual(ahead, [[60, 1], [62, 1.5]]);
  // The window reaches past one pass, so more passes follow.
  assert.ok(looped.notes.starts[looped.notes.count - 1] >= 1 + 3.2 - 1);
});
