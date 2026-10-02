import { pitchToMidi } from "../piano";
import {
  BLACK_KEY_WIDTH_IN_WHITE_KEYS,
  FIRST_PIANO_MIDI,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  WHITE_KEY_COUNT,
} from "../PianoKeyboard";
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

/** Real seconds between a note appearing at the far end and reaching the keys. */
export const HIGHWAY_LOOKAHEAD_SECONDS = 3.2;

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

/** Floats per note instance: centre x, half width, height, black, start s, end s. */
export const NOTE_INSTANCE_FLOATS = 6;
/** Floats per grid line instance: time s, strength. */
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
  count: number;
  /** Longest note, so a binary search on starts can find every note still sounding. */
  maxDurationSeconds: number;
}

/**
 * Times are unscaled score seconds (tempo map applied, tempo multiplier not), so
 * the instance data survives tempo-multiplier changes; the renderer scales the
 * lookahead window instead.
 */
export function buildHighwayNotes(route: PerformanceRoute): HighwayNotes {
  const notes: { lane: HighwayKeyLane; start: number; end: number }[] = [];
  for (const note of route.notes) {
    const midi = pitchToMidi(note.pitch);
    if (midi === null || midi < FIRST_PIANO_MIDI || midi > LAST_PIANO_MIDI) continue;
    const lane = KEY_LANES.get(midi);
    if (!lane) continue;
    const start = scoreOffsetToSeconds(route, note.onset, 1);
    const end = scoreOffsetToSeconds(route, note.release, 1);
    if (!(end > start)) continue;
    notes.push({ lane, start, end });
  }
  notes.sort((left, right) => left.start - right.start);

  const instances = new Float32Array(notes.length * NOTE_INSTANCE_FLOATS);
  const starts = new Float64Array(notes.length);
  const ends = new Float64Array(notes.length);
  const midis = new Uint8Array(notes.length);
  let maxDurationSeconds = 0;
  notes.forEach(({ lane, start, end }, index) => {
    const offset = index * NOTE_INSTANCE_FLOATS;
    instances[offset] = lane.center;
    instances[offset + 1] = lane.black ? BLACK_NOTE_HALF_WIDTH : WHITE_NOTE_HALF_WIDTH;
    instances[offset + 2] = lane.black ? BLACK_NOTE_HEIGHT : WHITE_NOTE_HEIGHT;
    instances[offset + 3] = lane.black ? 1 : 0;
    instances[offset + 4] = start;
    instances[offset + 5] = end;
    starts[index] = start;
    ends[index] = end;
    midis[index] = lane.midi;
    maxDurationSeconds = Math.max(maxDurationSeconds, end - start);
  });
  return { instances, starts, ends, midis, count: notes.length, maxDurationSeconds };
}

export interface HighwayGridLines {
  instances: Float32Array;
  times: Float64Array;
  count: number;
}

/** A strong line at every bar start of the route and a faint one on each quarter. */
export function buildHighwayGridLines(route: PerformanceRoute): HighwayGridLines {
  const lines: { time: number; strength: number }[] = [];
  for (const occurrence of route.occurrences) {
    lines.push({
      time: scoreOffsetToSeconds(route, occurrence.scoreStart, 1),
      strength: MEASURE_LINE_STRENGTH,
    });
    for (let beat = occurrence.scoreStart + 1; beat < occurrence.scoreEnd - 1e-6; beat += 1) {
      lines.push({ time: scoreOffsetToSeconds(route, beat, 1), strength: BEAT_LINE_STRENGTH });
    }
  }
  lines.sort((left, right) => left.time - right.time);
  const instances = new Float32Array(lines.length * GRID_LINE_INSTANCE_FLOATS);
  const times = new Float64Array(lines.length);
  lines.forEach(({ time, strength }, index) => {
    instances[index * GRID_LINE_INSTANCE_FLOATS] = time;
    instances[index * GRID_LINE_INSTANCE_FLOATS + 1] = strength;
    times[index] = time;
  });
  return { instances, times, count: lines.length };
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
  nowSeconds: number,
  windowSeconds: number,
): { start: number; end: number } {
  return {
    start: lowerBound(notes.starts, notes.count, nowSeconds - notes.maxDurationSeconds - 1),
    end: upperBound(notes.starts, notes.count, nowSeconds + windowSeconds),
  };
}

/**
 * How long a key keeps its full approach level after its note starts, bridging
 * the frame or two before the keyboard's own "playing" highlight takes over.
 */
const APPROACH_HOLD_SECONDS = 0.08;

/**
 * Writes, per key (index = midi - 21), how close that key's next note is: just
 * above 0 as it enters the far end of the window, 1 when it is due. Keys with no
 * note in the window get 0.
 */
export function keyApproachProgress(
  notes: HighwayNotes,
  nowSeconds: number,
  windowSeconds: number,
  out: Float32Array,
): void {
  out.fill(0);
  if (!(windowSeconds > 0)) return;
  const begin = lowerBound(notes.starts, notes.count, nowSeconds - APPROACH_HOLD_SECONDS);
  const end = upperBound(notes.starts, notes.count, nowSeconds + windowSeconds);
  // Starts are ascending, so the first note met for a key is its nearest one.
  for (let index = begin; index < end; index += 1) {
    const key = notes.midis[index] - FIRST_PIANO_MIDI;
    if (out[key] > 0) continue;
    const remaining = notes.starts[index] - nowSeconds;
    out[key] = Math.max(1e-6, Math.min(1, 1 - remaining / windowSeconds));
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
