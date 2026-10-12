import { pitchToMidi } from "../piano";
import {
  BLACK_KEY_WIDTH_IN_WHITE_KEYS,
  FIRST_PIANO_MIDI,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  WHITE_KEY_COUNT,
} from "../PianoKeyboard";
import {
  momentHasPracticeHandAttack,
  noteInPracticeHand,
  type PracticeHand,
} from "../playback";
import { scoreOffsetToSeconds, type PerformanceRoute } from "../realtime";

/**
 * World units are white-key widths, with x = 0 at the middle of the keyboard so
 * the highway's near edge spans exactly the 88 keys drawn by PianoKeyboard. The
 * floor is the y = 0 plane, the hit line is z = 0 and the far end is z = -length.
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
 * Camera pitch below the horizon and vertical field of view. Steeper than a
 * game highway so the score stays readable above and behind it; together they
 * set how much the far end narrows (about 0.7 of the keyboard width).
 */
const CAMERA_PITCH_DEGREES = 56;
const CAMERA_FOV_DEGREES = 30;

/**
 * Notes on white keys are wide, low slabs; notes on black keys are narrow, tall
 * blocks, so the two read apart by shape before colour.
 */
export const WHITE_NOTE_HALF_WIDTH = 0.4;
export const WHITE_NOTE_HEIGHT = 0.3;
export const BLACK_NOTE_HALF_WIDTH = 0.27;
export const BLACK_NOTE_HEIGHT = 0.9;

/** Floats per note instance: centre x, half width, height, black, start, end, ghost. */
export const NOTE_INSTANCE_FLOATS = 7;
/** Floats per grid line instance: time, strength. */
export const GRID_LINE_INSTANCE_FLOATS = 2;

const MEASURE_LINE_STRENGTH = 1;
const BEAT_LINE_STRENGTH = 0.32;

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
  let maxDuration = 0;
  notes.forEach(({ lane, start, end, ghost }, index) => {
    const offset = index * NOTE_INSTANCE_FLOATS;
    instances[offset] = lane.center;
    instances[offset + 1] = lane.black ? BLACK_NOTE_HALF_WIDTH : WHITE_NOTE_HALF_WIDTH;
    instances[offset + 2] = lane.black ? BLACK_NOTE_HEIGHT : WHITE_NOTE_HEIGHT;
    instances[offset + 3] = lane.black ? 1 : 0;
    instances[offset + 4] = start;
    instances[offset + 5] = end;
    instances[offset + 6] = ghost ? 1 : 0;
    starts[index] = start;
    ends[index] = end;
    midis[index] = lane.midi;
    ghosts[index] = ghost ? 1 : 0;
    maxDuration = Math.max(maxDuration, end - start);
  });
  return { instances, starts, ends, midis, ghosts, count: notes.length, maxDuration };
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

const routeTracks = new WeakMap<PerformanceRoute, Map<PracticeHand, HighwayTrack>>();

/**
 * Realtime track in unscaled score seconds (tempo map applied, tempo multiplier
 * not), so it survives tempo-multiplier changes; the caller scales the lookahead
 * window instead. A strong line marks every bar start and a faint one each
 * quarter. While one hand is practised the other hand's notes are ghosts.
 * Cached per route, which is rebuilt on every seek, and hand.
 */
export function highwayTrackForRoute(
  route: PerformanceRoute,
  hand: PracticeHand = "both",
): HighwayTrack {
  const byHand = routeTracks.get(route) ?? new Map<PracticeHand, HighwayTrack>();
  routeTracks.set(route, byHand);
  const cached = byHand.get(hand);
  if (cached) return cached;
  const notes: TrackNote[] = [];
  for (const note of route.notes) {
    const midi = pianoMidi(note.pitch);
    if (midi === null) continue;
    notes.push({
      midi,
      start: scoreOffsetToSeconds(route, note.onset, 1),
      end: scoreOffsetToSeconds(route, note.release, 1),
      ghost: !noteInPracticeHand(note.left, hand),
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
  byHand.set(hand, track);
  return track;
}

/** The parts of a note-by-note playback moment the highway reads. */
export interface HighwayStepMoment {
  /** Pitches attacked at this moment. */
  pitches: readonly string[];
  /** Every pitch shown on the keyboard here, including tied notes held over. */
  keyboardNotes: readonly { pitch: string; left?: boolean }[];
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
    // midi -> ghost; a key both hands strike at once is drawn as the practised hand's.
    const attacked = new Map<number, boolean>();
    const attacks = moment.notes
      ? moment.notes.filter((note) => note.startsAttack)
      : moment.pitches.map((pitch) => ({ pitch, left: undefined }));
    for (const { pitch, left } of attacks) {
      const midi = pianoMidi(pitch);
      if (midi === null) continue;
      const ghost = !noteInPracticeHand(left, hand);
      attacked.set(midi, (attacked.get(midi) ?? true) && ghost);
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
    for (const [midi, ghost] of attacked) {
      const note = { midi, start: position, end: endFor(ghost), ghost };
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
 */
export function keyApproachProgress(
  notes: HighwayNotes,
  now: number,
  window: number,
  out: Float32Array,
): void {
  out.fill(0);
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
  }
}

export interface HighwayCamera {
  /** Column-major view-projection matrix. */
  viewProjection: Float32Array;
  /** World length of the highway from the hit line to the far end. */
  length: number;
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

function multiply(a: Float32Array, b: Float32Array): Float32Array {
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
 * Places the camera so the hit line lands exactly on the canvas bottom edge,
 * spanning its full width (the keyboard's width), and the far end of the floor
 * lands exactly on the canvas top edge, whatever the canvas aspect ratio.
 */
export function highwayCamera(aspect: number): HighwayCamera {
  const pitch = (CAMERA_PITCH_DEGREES * Math.PI) / 180;
  const fov = (CAMERA_FOV_DEGREES * Math.PI) / 180;
  const bottomRay = pitch + fov / 2;
  const topRay = pitch - fov / 2;
  // With the eye at height 1, the bottom frustum ray must meet the floor at z = 0.
  const unitEyeZ = 1 / Math.tan(bottomRay);
  const unitNearDepth = Math.sin(pitch) + unitEyeZ * Math.cos(pitch);
  // Scale the eye height so the hit line's half width fills the horizontal half-FOV.
  const eyeY = HIGHWAY_HALF_WIDTH / (Math.tan(fov / 2) * aspect * unitNearDepth);
  const eyeZ = eyeY * unitEyeZ;
  const length = eyeY * (1 / Math.tan(topRay) - unitEyeZ);
  const farDepth = eyeY * Math.sin(pitch) + (eyeZ + length) * Math.cos(pitch);

  // View basis for a camera at (0, eyeY, eyeZ) looking down by `pitch`.
  const forward = [0, -Math.sin(pitch), -Math.cos(pitch)];
  const back = [0, -forward[1], -forward[2]];
  const up = [0, Math.cos(pitch), -Math.sin(pitch)];
  const eye = [0, eyeY, eyeZ];
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
    eyeY * unitNearDepth * 0.25,
    farDepth * 4,
  );
  return { viewProjection: multiply(projection, view), length };
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
