import type { PredictedFingering } from "../fingering";
import {
  BLACK_KEY_WIDTH_IN_WHITE_KEYS,
  FIRST_PIANO_MIDI,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  pianoKeyWhiteIndex,
  WHITE_KEY_COUNT,
  type HighwayNoteStyle,
  type KeyboardRange,
} from "../keyboardView";
import { pitchToMidi } from "../piano";
import {
  momentHasPracticeHandAttack,
  noteInPracticeHand,
  type PracticeHand,
} from "../playback";
import { scoreOffsetToSeconds, type PerformanceRoute } from "../realtime";

/**
 * World units are white-key widths, with x = 0 at the middle of the 88-key
 * keyboard; the highway spans the keys PianoKeyboard shows, all 88 or fewer. The
 * floor is the y = 0 plane, the hit line is z = 0 and the far end is z = -length.
 * A 3D keyboard lies on the floor in front of the hit line, from z = 0 to its depth.
 */
export const HIGHWAY_HALF_WIDTH = WHITE_KEY_COUNT / 2;
export const BLACK_KEY_LANE_HALF_WIDTH = BLACK_KEY_WIDTH_IN_WHITE_KEYS / 2;

/**
 * Where the far end of the highway sits, as a fraction of the workspace height.
 * The score above it stays fully visible; the faded far end overlaps a little.
 */
export const NOTE_HIGHWAY_TOP_FRACTION = 0.46;

/** Realtime: real seconds between a note appearing at the far end and reaching the keys. */
export const HIGHWAY_LOOKAHEAD_SECONDS = 3.2;
/** Note-by-note: how many upcoming moments the highway shows. */
export const HIGHWAY_LOOKAHEAD_STEPS = 8;

/**
 * How far the highway leans back by default, and the camera's vertical field of
 * view. The tilt is 90° less the camera's pitch below the horizon: 0 looks
 * straight down at the floor. The default is steeper than a game highway so the
 * score stays readable above and behind it, and narrows the far end to about
 * 0.7 of the keyboard width.
 */
export const DEFAULT_HIGHWAY_TILT_DEGREES = 34;
const CAMERA_FOV_DEGREES = 30;

/**
 * Notes on white keys are wide, notes on black keys as narrow as their key, and
 * darker; both stand the same height. Black-key notes stand a hair taller, so a
 * black-key note beside a white-key one at the same time is drawn over it.
 */
export const WHITE_NOTE_HALF_WIDTH = 0.42;
export const BLACK_NOTE_HALF_WIDTH = 0.3;
export const NOTE_HEIGHTS: Readonly<Record<HighwayNoteStyle, { white: number; black: number }>> = {
  raised: { white: 0.3, black: 0.315 },
  flat: { white: 0.004, black: 0.012 },
};

/** Floats per note instance: centre x, half width, black, left hand, start, end, ghost, finger. */
export const NOTE_INSTANCE_FLOATS = 8;
/** Floats per grid line instance: time, strength. */
export const GRID_LINE_INSTANCE_FLOATS = 2;

const MEASURE_LINE_STRENGTH = 1;
const BEAT_LINE_STRENGTH = 0.32;
/** Grid lines stronger than a bar line are drawn in the loop colour. */
export const LOOP_LINE_STRENGTH = 2;

export interface HighwayKeyLane {
  midi: number;
  black: boolean;
  /** Lane centre in world x. */
  center: number;
}

const KEY_LANES: ReadonlyMap<number, HighwayKeyLane> = new Map(
  PIANO_KEYS.map((key) => [
    key.midi,
    {
      midi: key.midi,
      black: key.black,
      // Black keys straddle a white-key boundary; white keys sit on their own middle.
      center: (key.black ? key.whiteIndex : key.whiteIndex + 0.5) - HIGHWAY_HALF_WIDTH,
    },
  ]),
);

export function highwayKeyLane(midi: number): HighwayKeyLane | null {
  return KEY_LANES.get(midi) ?? null;
}

export interface HighwayNotes {
  /** Interleaved per-instance attributes, sorted by start time. */
  instances: Float32Array;
  starts: Float64Array;
  ends: Float64Array;
  midis: Uint8Array;
  /** 1 for the other hand's notes while one hand is practised: drawn faintly, never lighting keys. */
  ghosts: Uint8Array;
  /** 1 for left-hand notes; notes of an unknown hand count as the right hand's. */
  lefts: Uint8Array;
  count: number;
  /** Longest note, so a binary search on starts can find every note still sounding. */
  maxDuration: number;
}

export interface HighwayGridLines {
  instances: Float32Array;
  times: Float64Array;
  count: number;
}

/**
 * Everything the highway draws, on one time axis: unscaled score seconds in
 * realtime mode, moment steps in note-by-note mode. The renderer only needs the
 * axis to be monotonic; the caller picks a matching lookahead window.
 */
export interface HighwayTrack {
  notes: HighwayNotes;
  lines: HighwayGridLines;
}

interface TrackNote {
  midi: number;
  start: number;
  end: number;
  ghost: boolean;
  left: boolean;
  /** 1 to 5, or 0 when no fingering is known. */
  finger: number;
}

interface TrackLine {
  time: number;
  strength: number;
}

function packNotes(source: TrackNote[]): HighwayNotes {
  const notes = source
    .flatMap((note) => {
      const lane = KEY_LANES.get(note.midi);
      return lane && note.end > note.start ? [{ ...note, lane }] : [];
    })
    .sort((left, right) => left.start - right.start);
  const instances = new Float32Array(notes.length * NOTE_INSTANCE_FLOATS);
  const starts = new Float64Array(notes.length);
  const ends = new Float64Array(notes.length);
  const midis = new Uint8Array(notes.length);
  const ghosts = new Uint8Array(notes.length);
  const lefts = new Uint8Array(notes.length);
  let maxDuration = 0;
  notes.forEach(({ lane, start, end, ghost, left, finger }, index) => {
    const offset = index * NOTE_INSTANCE_FLOATS;
    instances[offset] = lane.center;
    instances[offset + 1] = lane.black ? BLACK_NOTE_HALF_WIDTH : WHITE_NOTE_HALF_WIDTH;
    instances[offset + 2] = lane.black ? 1 : 0;
    instances[offset + 3] = left ? 1 : 0;
    instances[offset + 4] = start;
    instances[offset + 5] = end;
    instances[offset + 6] = ghost ? 1 : 0;
    instances[offset + 7] = finger;
    starts[index] = start;
    ends[index] = end;
    midis[index] = lane.midi;
    ghosts[index] = ghost ? 1 : 0;
    lefts[index] = left ? 1 : 0;
    maxDuration = Math.max(maxDuration, end - start);
  });
  return { instances, starts, ends, midis, ghosts, lefts, count: notes.length, maxDuration };
}

function packLines(source: TrackLine[]): HighwayGridLines {
  const lines = [...source].sort((left, right) => left.time - right.time);
  const instances = new Float32Array(lines.length * GRID_LINE_INSTANCE_FLOATS);
  const times = new Float64Array(lines.length);
  lines.forEach(({ time, strength }, index) => {
    instances[index * GRID_LINE_INSTANCE_FLOATS] = time;
    instances[index * GRID_LINE_INSTANCE_FLOATS + 1] = strength;
    times[index] = time;
  });
  return { instances, times, count: lines.length };
}

function pianoMidi(pitch: string): number | null {
  const midi = pitchToMidi(pitch);
  return midi !== null && midi >= FIRST_PIANO_MIDI && midi <= LAST_PIANO_MIDI ? midi : null;
}

function validFinger(finger: number | undefined): number {
  return finger !== undefined && finger >= 1 && finger <= 5 ? finger : 0;
}

const routeTracks = new WeakMap<
  PerformanceRoute,
  Map<PracticeHand, { fingerings: FingeringsById | undefined; track: HighwayTrack }>
>();

type FingeringsById = Readonly<Record<string, PredictedFingering>>;

/**
 * Realtime track in unscaled score seconds (tempo map applied, tempo multiplier
 * not), so it survives tempo-multiplier changes; the caller scales the lookahead
 * window instead. A strong line marks every bar start and a faint one each
 * quarter. While one hand is practised the other hand's notes are ghosts. Each
 * note keeps its hand, and its finger from `fingerings` where one is predicted.
 * Cached per route, which is rebuilt on every seek, hand and fingerings.
 */
export function highwayTrackForRoute(
  route: PerformanceRoute,
  hand: PracticeHand = "both",
  fingerings?: FingeringsById,
): HighwayTrack {
  const byHand = routeTracks.get(route) ?? new Map();
  routeTracks.set(route, byHand);
  const cached = byHand.get(hand);
  if (cached && cached.fingerings === fingerings) return cached.track;
  const notes: TrackNote[] = [];
  for (const note of route.notes) {
    const midi = pianoMidi(note.pitch);
    if (midi === null) continue;
    const fingeringId = note.fingeringMusicXmlId === undefined ? note.musicXmlId : note.fingeringMusicXmlId;
    const predicted = fingeringId ? fingerings?.[fingeringId] : undefined;
    notes.push({
      midi,
      start: scoreOffsetToSeconds(route, note.onset, 1),
      end: scoreOffsetToSeconds(route, note.release, 1),
      ghost: !noteInPracticeHand(note.left, hand),
      left: (predicted?.left ?? note.left) === true,
      finger: validFinger(predicted?.finger),
    });
  }
  const lines: TrackLine[] = [];
  for (const occurrence of route.occurrences) {
    lines.push({
      time: scoreOffsetToSeconds(route, occurrence.scoreStart, 1),
      strength: MEASURE_LINE_STRENGTH,
    });
    for (let beat = occurrence.scoreStart + 1; beat < occurrence.scoreEnd - 1e-6; beat += 1) {
      lines.push({ time: scoreOffsetToSeconds(route, beat, 1), strength: BEAT_LINE_STRENGTH });
    }
  }
  const track = { notes: packNotes(notes), lines: packLines(lines) };
  byHand.set(hand, { fingerings, track });
  return track;
}

/** A loop on a track's time axis: what plays from `start` up to `end` repeats. */
export interface HighwayLoop {
  start: number;
  end: number;
}

const loopTracks = new WeakMap<HighwayTrack, { loop: HighwayLoop; window: number; track: HighwayTrack }>();

/**
 * The track as a loop plays it: the loop's notes and lines over and over, so what comes
 * after the loop's end is its start again, as far ahead as `window` reaches, and the pass
 * before it lies behind. Each start-over is a loop-coloured line across every lane, so
 * the repeat can be seen coming. Cached per track for the last loop and window asked.
 */
export function highwayTrackLooped(
  track: HighwayTrack,
  loop: HighwayLoop | null,
  window: number,
): HighwayTrack {
  if (!loop || !(loop.end > loop.start)) return track;
  const cached = loopTracks.get(track);
  if (cached?.loop.start === loop.start && cached.loop.end === loop.end && cached.window === window) {
    return cached.track;
  }
  const length = loop.end - loop.start;
  const passes = Math.max(1, Math.ceil(window / length));
  const loopNotes: TrackNote[] = [];
  for (let index = 0; index < track.notes.count; index += 1) {
    const start = track.notes.starts[index];
    if (start < loop.start - 1e-9 || start >= loop.end - 1e-9) continue;
    loopNotes.push({
      midi: track.notes.midis[index],
      start,
      end: Math.min(loop.end, track.notes.ends[index]),
      ghost: track.notes.ghosts[index] === 1,
      left: track.notes.lefts[index] === 1,
      finger: track.notes.instances[index * NOTE_INSTANCE_FLOATS + 7],
    });
  }
  const loopLines: TrackLine[] = [];
  for (let index = 0; index < track.lines.count; index += 1) {
    const time = track.lines.times[index];
    if (time <= loop.start + 1e-9 || time >= loop.end - 1e-9) continue;
    loopLines.push({ time, strength: track.lines.instances[index * GRID_LINE_INSTANCE_FLOATS + 1] });
  }
  const notes: TrackNote[] = [];
  const lines: TrackLine[] = [];
  for (let pass = -1; pass <= passes; pass += 1) {
    const shift = pass * length;
    notes.push(...loopNotes.map((note) => ({ ...note, start: note.start + shift, end: note.end + shift })));
    lines.push({ time: loop.start + shift, strength: LOOP_LINE_STRENGTH });
    lines.push(...loopLines.map((line) => ({ ...line, time: line.time + shift })));
  }
  lines.push({ time: loop.start + (passes + 1) * length, strength: LOOP_LINE_STRENGTH });
  const looped = { notes: packNotes(notes), lines: packLines(lines) };
  loopTracks.set(track, { loop: { ...loop }, window, track: looped });
  return looped;
}

/** The parts of a note-by-note playback moment the highway reads. */
export interface HighwayStepMoment {
  /** Pitches attacked at this moment. */
  pitches: readonly string[];
  /** Every pitch shown on the keyboard here, including tied notes held over. */
  keyboardNotes: readonly { pitch: string; left?: boolean; finger?: number }[];
  /** Per-note hands, when known; see PlaybackMoment.notes. */
  notes?: readonly { pitch: string; left?: boolean; startsAttack: boolean }[];
  barKey: string;
}

/**
 * Step positions for the full timeline: moments the practised hand plays in are
 * whole steps 0, 1, 2… (matching their index in the one-hand timeline), and the
 * skipped moments between two of them are spread evenly across that step.
 */
export function practiceStepPositions(
  moments: readonly HighwayStepMoment[],
  hand: PracticeHand,
): number[] {
  const practiced = moments.map((moment) => momentHasPracticeHandAttack(moment, hand));
  const positions = new Array<number>(moments.length);
  let step = -1;
  let index = 0;
  while (index < moments.length) {
    if (practiced[index]) {
      step += 1;
      positions[index] = step;
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < moments.length && !practiced[runEnd]) runEnd += 1;
    const run = runEnd - index;
    for (let offset = 0; offset < run; offset += 1) {
      positions[index + offset] = step + (offset + 1) / (run + 1);
    }
    index = runEnd;
  }
  return positions;
}

/**
 * Note-by-note track, since moments carry an order but no durations. A
 * practised note lasts until the practised hand's next step; while one hand is
 * practised the other hand's notes are ghosts lasting until the next moment.
 * Ties extend a note through the moments that hold it, and a strong line marks
 * each bar's first moment.
 */
export function highwayTrackForSteps(
  moments: readonly HighwayStepMoment[],
  hand: PracticeHand = "both",
): HighwayTrack {
  const positions = practiceStepPositions(moments, hand);
  const notes: TrackNote[] = [];
  const lines: TrackLine[] = [];
  let open = new Map<number, TrackNote>();
  moments.forEach((moment, index) => {
    const position = positions[index];
    const nextMoment = positions[index + 1] ?? position + 1;
    const nextStep = Math.floor(position) + 1;
    const endFor = (ghost: boolean) => (ghost ? nextMoment : nextStep);
    if (index === 0 || moment.barKey !== moments[index - 1].barKey) {
      lines.push({ time: position, strength: MEASURE_LINE_STRENGTH });
    }
    // A key both hands strike at once is drawn as the practised hand's.
    const attacked = new Map<number, { ghost: boolean; left: boolean }>();
    const attacks = moment.notes
      ? moment.notes.filter((note) => note.startsAttack)
      : moment.pitches.map((pitch) => ({ pitch, left: undefined }));
    for (const { pitch, left } of attacks) {
      const midi = pianoMidi(pitch);
      if (midi === null) continue;
      const ghost = !noteInPracticeHand(left, hand);
      const previous = attacked.get(midi);
      if (!previous || (previous.ghost && !ghost)) attacked.set(midi, { ghost, left: left === true });
    }
    const next = new Map<number, TrackNote>();
    for (const { pitch } of moment.keyboardNotes) {
      const midi = pianoMidi(pitch);
      if (midi === null || attacked.has(midi) || next.has(midi)) continue;
      const held = open.get(midi);
      if (held) {
        held.end = Math.max(held.end, endFor(held.ghost));
        next.set(midi, held);
      }
    }
    for (const [midi, { ghost, left }] of attacked) {
      const shown = moment.keyboardNotes.find((candidate) =>
        candidate.finger !== undefined &&
        (candidate.left === undefined || candidate.left === left) &&
        pianoMidi(candidate.pitch) === midi,
      );
      const note = { midi, start: position, end: endFor(ghost), ghost, left, finger: validFinger(shown?.finger) };
      notes.push(note);
      next.set(midi, note);
    }
    open = next;
  });
  return { notes: packNotes(notes), lines: packLines(lines) };
}

/** First index in sorted[0, count) whose value is >= target. */
export function lowerBound(sorted: ArrayLike<number>, count: number, target: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** First index in sorted[0, count) whose value is > target. */
export function upperBound(sorted: ArrayLike<number>, count: number, target: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Instance range that can be on the highway at `now`: anything started late
 * enough to still be sounding, up to the far end of the window. The shader
 * hides the few finished notes the range still includes.
 */
export function visibleNoteRange(
  notes: HighwayNotes,
  now: number,
  window: number,
): { start: number; end: number } {
  return {
    start: lowerBound(notes.starts, notes.count, now - notes.maxDuration - 1),
    end: upperBound(notes.starts, notes.count, now + window),
  };
}

/**
 * How long, in track time, a key keeps its full approach level after its note
 * starts, bridging the frame or two before the keyboard's own "playing"
 * highlight takes over.
 */
const APPROACH_HOLD = 0.08;

/**
 * Writes, per key (index = midi - 21), how close that key's next note is: just
 * above 0 as it enters the far end of the window, 1 when it is due. Keys with no
 * note in the window get 0. Ghost notes of the other hand never light a key.
 * `hands`, when given, gets that note's hand per key: 1 right, 2 left, 0 none.
 */
export function keyApproachProgress(
  notes: HighwayNotes,
  now: number,
  window: number,
  out: Float32Array,
  hands?: Uint8Array,
): void {
  out.fill(0);
  hands?.fill(0);
  if (!(window > 0)) return;
  const begin = lowerBound(notes.starts, notes.count, now - APPROACH_HOLD);
  const end = upperBound(notes.starts, notes.count, now + window);
  // Starts are ascending, so the first note met for a key is its nearest one.
  for (let index = begin; index < end; index += 1) {
    if (notes.ghosts[index]) continue;
    const key = notes.midis[index] - FIRST_PIANO_MIDI;
    if (out[key] > 0) continue;
    const remaining = notes.starts[index] - now;
    out[key] = Math.max(1e-6, Math.min(1, 1 - remaining / window));
    if (hands) hands[key] = notes.lefts[index] ? 2 : 1;
  }
}

export interface HighwayCamera {
  /** Column-major view-projection matrix. */
  viewProjection: Float32Array;
  /** World length of the highway from the hit line to the far end. */
  length: number;
}

/** The keys of a 3D keyboard as solids lying on the floor, in world units. */
export interface KeyboardSolid {
  /** Length of the white keys, from the hit line toward the viewer. */
  depth: number;
  /** How far the white keys' front faces drop below the floor. */
  frontFace: number;
  /** How high the black keys stand above the white ones. */
  blackHeight: number;
  /**
   * Black keys taper as a real piano's do: how far each side of the top sits in
   * from the key's footprint, and how far its front edge sits back.
   */
  blackSideTaper: number;
  blackFrontTaper: number;
}

/** Where the highway and its keys sit in the world, for one canvas size. */
export interface HighwayLayout {
  /** World x of the middle of the keys shown. */
  center: number;
  halfWidth: number;
  tilt: number;
  /** Null for a flat keyboard drawn below the canvas. */
  keyboard: KeyboardSolid | null;
}

export interface HighwayViewOptions {
  range: KeyboardRange;
  tilt: number;
  keyboard3d: boolean;
}

export const FULL_HIGHWAY_LAYOUT: Readonly<HighwayLayout> = Object.freeze({
  center: 0,
  halfWidth: HIGHWAY_HALF_WIDTH,
  tilt: DEFAULT_HIGHWAY_TILT_DEGREES,
  keyboard: null,
});

/** A real white key is about six times as long as it is wide. */
const MAX_KEY_DEPTH = 6;
/** Most of the canvas a 3D keyboard may take, so the highway keeps the rest. */
const MAX_KEYBOARD_SHARE = 0.42;

function keyboardSolid(depth: number): KeyboardSolid {
  const blackHeight = Math.min(0.4, 0.1 * depth);
  // The top is about two thirds as wide as the footprint, and the front slopes back.
  return {
    depth,
    frontFace: Math.min(0.45, 0.12 * depth),
    blackHeight,
    blackSideTaper: 0.25 * blackHeight,
    blackFrontTaper: 0.5 * blackHeight,
  };
}

/** The share of the canvas height, from its bottom, a layout's 3D keyboard covers. */
function keyboardShare(aspect: number, layout: HighwayLayout): number {
  const camera = highwayCamera(aspect, layout);
  const [, hitY] = projectToNdc(camera.viewProjection, [layout.center, 0, 0]);
  return camera.length > 0 ? (hitY + 1) / 2 : 1;
}

/**
 * The highway over the keys of `range`. A 3D keyboard is as deep as the flat
 * keyboard is tall (about a third of the canvas, in canvas pixels at its front
 * edge), but no longer than a real key, and shortened until the highway keeps
 * most of the canvas at the chosen tilt.
 */
export function highwayLayout(
  options: HighwayViewOptions,
  cssWidth: number,
  cssHeight: number,
): HighwayLayout {
  const low = pianoKeyWhiteIndex(options.range.low);
  const high = pianoKeyWhiteIndex(options.range.high) + 1;
  const base: HighwayLayout = {
    center: (low + high) / 2 - HIGHWAY_HALF_WIDTH,
    halfWidth: (high - low) / 2,
    tilt: options.tilt,
    keyboard: null,
  };
  if (!options.keyboard3d || !(cssWidth > 0) || !(cssHeight > 0)) return base;
  const pixelsPerUnit = cssWidth / (2 * base.halfWidth);
  const aspect = cssWidth / cssHeight;
  let depth = Math.min(MAX_KEY_DEPTH, Math.min(220, Math.max(110, cssHeight * 0.34)) / pixelsPerUnit);
  if (keyboardShare(aspect, { ...base, keyboard: keyboardSolid(depth) }) > MAX_KEYBOARD_SHARE) {
    let shorter = 0;
    let longer = depth;
    for (let step = 0; step < 24; step += 1) {
      const middle = (shorter + longer) / 2;
      if (keyboardShare(aspect, { ...base, keyboard: keyboardSolid(middle) }) > MAX_KEYBOARD_SHARE) longer = middle;
      else shorter = middle;
    }
    depth = shorter;
  }
  return { ...base, keyboard: keyboardSolid(depth) };
}

function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Places the camera so the near edge of the scene lands exactly on the canvas
 * bottom edge, spanning its full width, and the far end of the floor lands
 * exactly on the canvas top edge, whatever the canvas aspect ratio. The near
 * edge is the hit line, or with a 3D keyboard the bottom of its front faces.
 */
export function highwayCamera(
  aspect: number,
  layout: HighwayLayout = FULL_HIGHWAY_LAYOUT,
): HighwayCamera {
  const pitch = ((90 - layout.tilt) * Math.PI) / 180;
  const fov = (CAMERA_FOV_DEGREES * Math.PI) / 180;
  const bottomRay = pitch + fov / 2;
  const topRay = pitch - fov / 2;
  const anchorZ = layout.keyboard?.depth ?? 0;
  const anchorY = -(layout.keyboard?.frontFace ?? 0);
  // With the eye one unit above the near edge, the bottom frustum ray must meet it.
  const unitEyeZ = Math.cos(bottomRay) / Math.sin(bottomRay);
  const unitNearDepth = Math.sin(pitch) + unitEyeZ * Math.cos(pitch);
  // Scale the eye height so the near edge's half width fills the horizontal half-FOV.
  const eyeHeight = layout.halfWidth / (Math.tan(fov / 2) * aspect * unitNearDepth);
  const eyeY = anchorY + eyeHeight;
  const eyeZ = anchorZ + eyeHeight * unitEyeZ;
  const length = eyeY / Math.tan(topRay) - eyeZ;
  const farDepth = eyeY * Math.sin(pitch) + (eyeZ + length) * Math.cos(pitch);

  // View basis for a camera at (center, eyeY, eyeZ) looking down by `pitch`.
  const forward = [0, -Math.sin(pitch), -Math.cos(pitch)];
  const back = [0, -forward[1], -forward[2]];
  const up = [0, Math.cos(pitch), -Math.sin(pitch)];
  const eye = [layout.center, eyeY, eyeZ];
  const dot = (left: number[], right: number[]) =>
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const view = new Float32Array([
    1, up[0], back[0], 0,
    0, up[1], back[1], 0,
    0, up[2], back[2], 0,
    -eye[0], -dot(up, eye), -dot(back, eye), 1,
  ]);
  const projection = perspective(
    fov,
    aspect,
    eyeHeight * unitNearDepth * 0.25,
    Math.max(farDepth, eyeHeight * unitNearDepth) * 4,
  );
  return { viewProjection: multiply(projection, view), length };
}

/** Depth scale for CSS: the browser only orders the keyboard's faces by it. */
const CSS_DEPTH_SCALE = 1000;

/**
 * A CSS matrix3d, column-major, that lays an element `cssWidth` wide (the
 * canvas width) flat on the floor between the hit line and the keyboard's front
 * edge, as the camera sees it: its top edge on the hit line, its left edge at the
 * first key shown, one world unit `cssWidth / (2 halfWidth)` pixels, and CSS z
 * (toward the viewer) pointing up from the floor. Place the element at the
 * canvas's top-left corner with transform-origin 0 0.
 */
export function keyboardSurfaceMatrix(
  camera: HighwayCamera,
  layout: HighwayLayout,
  cssWidth: number,
  cssHeight: number,
): Float32Array {
  const unit = (2 * layout.halfWidth) / cssWidth;
  const surface = [
    unit, 0, 0, 0,
    0, 0, unit, 0,
    0, unit, 0, 0,
    layout.center - layout.halfWidth, 0, 0, 1,
  ];
  const screen = [
    cssWidth / 2, 0, 0, 0,
    0, -cssHeight / 2, 0, 0,
    0, 0, -CSS_DEPTH_SCALE, 0,
    cssWidth / 2, cssHeight / 2, 0, 1,
  ];
  return multiply(screen, multiply(camera.viewProjection, surface));
}

/** Where a point of the keyboard surface (CSS px, z up) lands on the canvas, in CSS px. */
export function projectSurfacePoint(
  matrix: ArrayLike<number>,
  x: number,
  y: number,
  z = 0,
): [number, number] {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
  ];
}

/** Projects a world point to normalized device coordinates. */
export function projectToNdc(
  viewProjection: Float32Array,
  point: readonly [number, number, number],
): [number, number, number] {
  const [x, y, z] = point;
  const clip = [0, 1, 2, 3].map((row) =>
    viewProjection[row] * x +
    viewProjection[4 + row] * y +
    viewProjection[8 + row] * z +
    viewProjection[12 + row],
  );
  return [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
}
