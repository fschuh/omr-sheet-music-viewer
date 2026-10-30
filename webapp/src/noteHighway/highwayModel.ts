import type { PredictedFingering } from "../fingering";
import {
  FIRST_PIANO_MIDI,
  LAST_PIANO_MIDI,
  PIANO_KEYS,
  pianoKeys,
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

/**
 * Where the far end of the highway sits, as a fraction of the workspace height.
 * The score above it stays fully visible; the faded far end overlaps a little.
 */
export const NOTE_HIGHWAY_TOP_FRACTION = 0.46;

/** Realtime: real seconds between a note appearing at the far end and reaching the keys. */
export const HIGHWAY_LOOKAHEAD_SECONDS = 3.2;

/**
 * Realtime at a fixed tempo: the quarters the highway shows, as many as reach the keys
 * in HIGHWAY_LOOKAHEAD_SECONDS at the score's opening tempo, so the two time scales
 * look alike there at full speed.
 */
export function highwayLookaheadQuarters(openingBpm: number): number {
  return HIGHWAY_LOOKAHEAD_SECONDS * (openingBpm > 0 ? openingBpm : 120) / 60;
}
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
 * A note fills its key's lane, the width its key has at the back, where it meets the
 * hit line: at a real piano's black-key width, nearly the same for every key (see
 * pianoKeyBackSpan). It
 * stays this far inside each lane edge, so the lane's border shows between notes
 * on neighbouring keys as the gap between the keys does.
 */
export const NOTE_LANE_INSET = 0.03;

/**
 * A white-key note drawn as wide as its whole key, from its instance's centre (its
 * track's middle): a white key's track lies inside the key, and keys start on whole
 * world x, so the key's middle is half a key past the track middle's floor. The note
 * shader does the same; black-key notes, drawn over, keep their track.
 */
export function wholeKeyNoteSpan(trackCenter: number): { center: number; halfWidth: number } {
  return { center: Math.floor(trackCenter) + 0.5, halfWidth: 0.5 - NOTE_LANE_INSET };
}

/**
 * Notes on black keys are darker; both stand the same height. Black-key notes
 * stand a hair taller, so where two touch the black-key note is drawn over.
 */
export const NOTE_HEIGHTS: Readonly<Record<HighwayNoteStyle, { white: number; black: number }>> = {
  raised: { white: 0.3, black: 0.315 },
  flat: { white: 0.004, black: 0.012 },
};

/** Floats per note instance: centre x, half width, black, left hand, start, end, ghost, finger, layer. */
export const NOTE_INSTANCE_FLOATS = 9;
/** Floats per grid line instance: time, strength. */
export const GRID_LINE_INSTANCE_FLOATS = 2;

const MEASURE_LINE_STRENGTH = 1;
const BEAT_LINE_STRENGTH = 0.32;
/** Grid lines stronger than a bar line are drawn in the loop colour. */
export const LOOP_LINE_STRENGTH = 2;

export interface HighwayKeyLane {
  midi: number;
  black: boolean;
  /** The key's middle in world x: a white key's at its front, a black key's anywhere. */
  center: number;
  /** World x of the lane's edges, as the floor draws it: the key's back. */
  left: number;
  right: number;
}

function keyLane(key: (typeof PIANO_KEYS)[number]): HighwayKeyLane {
  const left = key.back.left - HIGHWAY_HALF_WIDTH;
  const right = key.back.right - HIGHWAY_HALF_WIDTH;
  return {
    midi: key.midi,
    black: key.black,
    center: key.black ? (left + right) / 2 : key.whiteIndex + 0.5 - HIGHWAY_HALF_WIDTH,
    left,
    right,
  };
}

const keyLaneLayouts = new Map<number, ReadonlyMap<number, HighwayKeyLane>>();

/** Every key's lane, with black keys `blackKeyWidth` times a real piano's; see pianoKeyBackSpan. */
function keyLanes(blackKeyWidth: number): ReadonlyMap<number, HighwayKeyLane> {
  let lanes = keyLaneLayouts.get(blackKeyWidth);
  if (!lanes) {
    lanes = new Map(pianoKeys(blackKeyWidth).map((key) => [key.midi, keyLane(key)]));
    keyLaneLayouts.set(blackKeyWidth, lanes);
  }
  return lanes;
}

const KEY_LANES = keyLanes(1);

export function highwayKeyLane(midi: number, blackKeyWidth = 1): HighwayKeyLane | null {
  return keyLanes(blackKeyWidth).get(midi) ?? null;
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
  /** Each note's end as written, before its hand struck its key again; see restruckNotes. */
  writtenEnds: Float64Array;
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
 * Everything the highway draws, on one time axis: unscaled score seconds or score
 * quarters in realtime mode, moment steps in note-by-note mode. The renderer only needs the
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

function writeLane(instances: Float32Array, offset: number, lane: HighwayKeyLane): void {
  instances[offset] = (lane.left + lane.right) / 2;
  instances[offset + 1] = (lane.right - lane.left) / 2 - NOTE_LANE_INSET;
}

interface DrawnNote extends TrackNote {
  /** 0 on the floor; one more for each note of the other hand it lies over. */
  layer: number;
  writtenEnd: number;
}

/**
 * A hand striking a key it holds lets it up first, so its held note is cut there and
 * the new note holds on for as long as either needs; striking it twice at once strikes
 * it once. A note the other hand strikes on that key lies over the held note, a layer
 * up, and both last as written; of two struck together, the shorter lies over the
 * longer. Ghosts of the other hand are kept apart: they neither
 * cut nor lie over the practised hand's notes.
 */
function restruckNotes(source: TrackNote[]): DrawnNote[] {
  const drawn: DrawnNote[] = [];
  const soundingByKey = new Map<string, DrawnNote[]>();
  for (const note of [...source].sort((left, right) => left.start - right.start)) {
    const id = `${note.midi}:${note.ghost}`;
    const sounding = (soundingByKey.get(id) ?? []).filter((held) => held.end > note.start);
    const own = sounding.find((held) => held.left === note.left);
    if (own && own.start === note.start) {
      own.end = Math.max(own.end, note.end);
      own.writtenEnd = Math.max(own.writtenEnd, note.end);
      own.finger ||= note.finger;
      soundingByKey.set(id, sounding);
      continue;
    }
    const struck: DrawnNote = { ...note, layer: 0, writtenEnd: note.end };
    if (own) {
      struck.end = Math.max(struck.end, own.end);
      // Unless told otherwise, the finger holding the key strikes it again.
      struck.finger ||= own.finger;
      own.end = note.start;
    }
    const other = sounding.find((held) => held.left !== note.left);
    if (other && other.start === note.start && other.end < struck.end) {
      // Struck together, the shorter note lies over the longer.
      struck.layer = other.layer;
      other.layer += 1;
    } else if (other) {
      struck.layer = other.layer + 1;
    }
    soundingByKey.set(id, other ? [other, struck] : [struck]);
    drawn.push(struck);
  }
  return drawn;
}

/** Tracks are packed in a real piano's lanes. */
function packNotes(source: TrackNote[]): HighwayNotes {
  const notes = restruckNotes(source.filter((note) => KEY_LANES.has(note.midi) && note.end > note.start))
    .map((note) => ({ ...note, lane: KEY_LANES.get(note.midi)! }));
  const instances = new Float32Array(notes.length * NOTE_INSTANCE_FLOATS);
  const starts = new Float64Array(notes.length);
  const ends = new Float64Array(notes.length);
  const midis = new Uint8Array(notes.length);
  const ghosts = new Uint8Array(notes.length);
  const lefts = new Uint8Array(notes.length);
  const writtenEnds = new Float64Array(notes.length);
  let maxDuration = 0;
  notes.forEach(({ lane, start, end, ghost, left, finger, layer, writtenEnd }, index) => {
    const offset = index * NOTE_INSTANCE_FLOATS;
    writeLane(instances, offset, lane);
    instances[offset + 2] = lane.black ? 1 : 0;
    instances[offset + 3] = left ? 1 : 0;
    instances[offset + 4] = start;
    instances[offset + 5] = end;
    instances[offset + 6] = ghost ? 1 : 0;
    instances[offset + 7] = finger;
    instances[offset + 8] = layer;
    starts[index] = start;
    ends[index] = end;
    midis[index] = lane.midi;
    ghosts[index] = ghost ? 1 : 0;
    lefts[index] = left ? 1 : 0;
    writtenEnds[index] = writtenEnd;
    maxDuration = Math.max(maxDuration, end - start);
  });
  return { instances, starts, ends, midis, ghosts, lefts, writtenEnds, count: notes.length, maxDuration };
}

/**
 * The notes' instances with every note in its key's lane for black keys
 * `blackKeyWidth` times a real piano's: the track's own at 1, otherwise a copy.
 */
export function highwayNoteInstances(notes: HighwayNotes, blackKeyWidth: number): Float32Array {
  if (blackKeyWidth === 1) return notes.instances;
  const lanes = keyLanes(blackKeyWidth);
  const instances = notes.instances.slice();
  for (let index = 0; index < notes.count; index += 1) {
    writeLane(instances, index * NOTE_INSTANCE_FLOATS, lanes.get(notes.midis[index])!);
  }
  return instances;
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

/** A realtime track's time axis: unscaled score seconds, or the route's quarters. */
export type RouteTrackAxis = "seconds" | "quarters";

const routeTracks = new WeakMap<
  PerformanceRoute,
  Map<string, { fingerings: FingeringsById | undefined; track: HighwayTrack }>
>();

type FingeringsById = Readonly<Record<string, PredictedFingering>>;

/**
 * Realtime track in unscaled score seconds (tempo map applied, tempo multiplier
 * not), so it survives tempo-multiplier changes; the caller scales the lookahead
 * window instead. On the "quarters" axis no tempo applies at all, so every beat is
 * as long as any other. A strong line marks every bar start and a faint one each
 * quarter. While one hand is practised the other hand's notes are ghosts. Each
 * note keeps its hand, and its finger from `fingerings` where one is predicted.
 * Cached per route, which is rebuilt on every seek, hand, axis and fingerings.
 */
export function highwayTrackForRoute(
  route: PerformanceRoute,
  hand: PracticeHand = "both",
  fingerings?: FingeringsById,
  axis: RouteTrackAxis = "seconds",
): HighwayTrack {
  const byKey = routeTracks.get(route) ?? new Map();
  routeTracks.set(route, byKey);
  const key = `${hand}:${axis}`;
  const cached = byKey.get(key);
  if (cached && cached.fingerings === fingerings) return cached.track;
  const timeAt = axis === "quarters"
    ? (offset: number) => Math.min(route.totalQuarters, Math.max(0, offset))
    : (offset: number) => scoreOffsetToSeconds(route, offset, 1);
  const notes: TrackNote[] = [];
  for (const note of route.notes) {
    const midi = pianoMidi(note.pitch);
    if (midi === null) continue;
    const fingeringId = note.fingeringMusicXmlId === undefined ? note.musicXmlId : note.fingeringMusicXmlId;
    const predicted = fingeringId ? fingerings?.[fingeringId] : undefined;
    notes.push({
      midi,
      start: timeAt(note.onset),
      end: timeAt(note.release),
      ghost: !noteInPracticeHand(note.left, hand),
      left: (predicted?.left ?? note.left) === true,
      finger: validFinger(predicted?.finger),
    });
  }
  const lines: TrackLine[] = [];
  for (const occurrence of route.occurrences) {
    lines.push({
      time: timeAt(occurrence.scoreStart),
      strength: MEASURE_LINE_STRENGTH,
    });
    for (let beat = occurrence.scoreStart + 1; beat < occurrence.scoreEnd - 1e-6; beat += 1) {
      lines.push({ time: timeAt(beat), strength: BEAT_LINE_STRENGTH });
    }
  }
  const track = { notes: packNotes(notes), lines: packLines(lines) };
  byKey.set(key, { fingerings, track });
  return track;
}

/** A loop on a track's time axis: what plays from `start` up to `end` repeats. */
export interface HighwayLoop {
  start: number;
  end: number;
}

const loopTracks = new WeakMap<
  HighwayTrack,
  { loop: HighwayLoop; window: number; leadIn: boolean; track: HighwayTrack }
>();

/**
 * The track as a loop plays it: the loop's notes and lines over and over, so what comes
 * after the loop's end is its start again, as far ahead as `window` reaches, and the pass
 * before it lies behind, unless the loop is still counting in to its first pass. Each
 * start-over is a loop-coloured line across every lane, so the repeat can be seen coming.
 * Cached per track for the last loop, window and lead-in asked.
 */
export function highwayTrackLooped(
  track: HighwayTrack,
  loop: HighwayLoop | null,
  window: number,
  leadIn = false,
): HighwayTrack {
  if (!loop || !(loop.end > loop.start)) return track;
  const cached = loopTracks.get(track);
  if (
    cached?.loop.start === loop.start && cached.loop.end === loop.end &&
    cached.window === window && cached.leadIn === leadIn
  ) {
    return cached.track;
  }
  const length = loop.end - loop.start;
  const passes = Math.max(1, Math.ceil(window / length));
  // The notes as written: packing the passes strikes their keys again.
  const loopNotes: TrackNote[] = [];
  for (let index = 0; index < track.notes.count; index += 1) {
    const start = track.notes.starts[index];
    if (start < loop.start - 1e-9 || start >= loop.end - 1e-9) continue;
    loopNotes.push({
      midi: track.notes.midis[index],
      start,
      end: Math.min(loop.end, track.notes.writtenEnds[index]),
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
  for (let pass = leadIn ? 0 : -1; pass <= passes; pass += 1) {
    const shift = pass * length;
    notes.push(...loopNotes.map((note) => ({ ...note, start: note.start + shift, end: note.end + shift })));
    lines.push({ time: loop.start + shift, strength: LOOP_LINE_STRENGTH });
    lines.push(...loopLines.map((line) => ({ ...line, time: line.time + shift })));
  }
  lines.push({ time: loop.start + (passes + 1) * length, strength: LOOP_LINE_STRENGTH });
  const looped = { notes: packNotes(notes), lines: packLines(lines) };
  loopTracks.set(track, { loop: { ...loop }, window, leadIn, track: looped });
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

/**
 * keyboardSurfaceMatrix split in two for CSS: a `perspective` distance (CSS px)
 * for the canvas-sized parent, about its centre (the default perspective-origin),
 * and an affine matrix3d for the element. Together they place the element exactly
 * as the single matrix does. WebKitGTK draws the preserve-3d children of an
 * element whose own transform carries perspective flat at the page's top left;
 * perspective that comes from the parent it draws correctly.
 */
export function keyboardSurfaceTransform(
  camera: HighwayCamera,
  layout: HighwayLayout,
  cssWidth: number,
  cssHeight: number,
): { perspective: number; transform: Float32Array } {
  const matrix = keyboardSurfaceMatrix(camera, layout, cssWidth, cssHeight);
  // The parent's perspective is P = T(origin) * perspective(d) * T(-origin), whose
  // rows are x - (ox / d) z, y - (oy / d) z, z and w = 1 - z / d. Solving P * A = s M
  // for an affine A gives A's z row from M's w row, then its x and y rows. With d
  // the camera's focal length in px, A is the camera's view scaled into CSS px.
  const fov = (CAMERA_FOV_DEGREES * Math.PI) / 180;
  const perspective = cssHeight / 2 / Math.tan(fov / 2);
  const originX = cssWidth / 2;
  const originY = cssHeight / 2;
  const scale = 1 / matrix[15];
  const transform = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    const z = perspective * ((column === 3 ? 1 : 0) - scale * matrix[column * 4 + 3]);
    transform[column * 4] = scale * matrix[column * 4] + (originX / perspective) * z;
    transform[column * 4 + 1] = scale * matrix[column * 4 + 1] + (originY / perspective) * z;
    transform[column * 4 + 2] = z;
    transform[column * 4 + 3] = column === 3 ? 1 : 0;
  }
  return { perspective, transform };
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
/**
 * Where a point `height` above the floor at (x, z) must sit for the camera to see it
 * straight above (x, 0, z). The camera looks along the highway without turning
 * sideways, so only x needs moving. A raised note's top, put here, keeps its sides
 * upright on screen instead of leaning out over the next lane toward the edges;
 * the note shader does the same.
 */
export function uprightX(viewProjection: Float32Array, x: number, height: number, z: number): number {
  const [floorX] = projectToNdc(viewProjection, [x, 0, z]);
  const clipX = viewProjection[0] * x + viewProjection[4] * height + viewProjection[8] * z + viewProjection[12];
  const clipW = viewProjection[3] * x + viewProjection[7] * height + viewProjection[11] * z + viewProjection[15];
  return x + (floorX * clipW - clipX) / viewProjection[0];
}

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
