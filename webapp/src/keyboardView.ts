import { pitchToMidi } from "./piano";
import { noteInPracticeHand, type PracticeHand } from "./playback";

export const FIRST_PIANO_MIDI = 21; // A0
export const LAST_PIANO_MIDI = 108; // C8
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export const WHITE_KEY_COUNT = 52;
const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/** A stretch across the keyboard, in white keys from A0's left edge. */
export interface KeySpan {
  left: number;
  right: number;
}

export interface PianoKey {
  midi: number;
  name: string;
  black: boolean;
  /** White keys below this one; a black key shares the index of the white key above it. */
  whiteIndex: number;
  /** The key's width at the back, where the black keys are; see pianoKeyBackSpan. */
  back: KeySpan;
}

export function pianoKeyName(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Where a key sits at the back of the keyboard, in white keys from A0's left edge.
 * As on a real piano, the back of C to E is split into five equal parts and F to B
 * into seven, so within each group the black keys and the white keys' backs between
 * them are equally wide, and the E–F and B–C edges run straight from front to back.
 * A0 and C8 have no black key beyond them and keep their full width at that side.
 */
export function pianoKeyBackSpan(midi: number): KeySpan {
  const pitchClass = ((midi % 12) + 12) % 12;
  // C of this octave, in white keys from A0: C1 (MIDI 24) is the third white key.
  const c = 7 * Math.floor(midi / 12) - 12;
  const [start, part, index] = pitchClass <= 4
    ? [c, 3 / 5, pitchClass]
    : [c + 3, 4 / 7, pitchClass - 5];
  const left = midi === FIRST_PIANO_MIDI ? 0 : start + index * part;
  const right = midi === LAST_PIANO_MIDI ? WHITE_KEY_COUNT : start + (index + 1) * part;
  return { left, right };
}

function buildPianoKeys(): PianoKey[] {
  const keys: PianoKey[] = [];
  let whiteIndex = 0;
  for (let midi = FIRST_PIANO_MIDI; midi <= LAST_PIANO_MIDI; midi += 1) {
    const black = isBlackKey(midi);
    keys.push({ midi, name: pianoKeyName(midi), black, whiteIndex, back: pianoKeyBackSpan(midi) });
    if (!black) whiteIndex += 1;
  }
  return keys;
}

export const PIANO_KEYS: readonly PianoKey[] = buildPianoKeys();

/** The key's whiteIndex; see PianoKey. */
export function pianoKeyWhiteIndex(midi: number): number {
  const clamped = Math.min(LAST_PIANO_MIDI, Math.max(FIRST_PIANO_MIDI, midi));
  return PIANO_KEYS[clamped - FIRST_PIANO_MIDI].whiteIndex;
}

/** Which keys the keyboard and the highway show. */
export type KeyboardRangeMode = "full" | "song" | "practiced-hand";

/** How a key shows that its next note is on the way down the highway. */
export type UpcomingKeyEffect = "off" | "top-edge" | "tint" | "growing-tint" | "filling-meter";

/** Note blocks on the highway: boxes with a little volume, or flat tiles on its floor. */
export type HighwayNoteStyle = "raised" | "flat";

/**
 * How playback speed shows on the highway. "steady-speed": notes always take the same
 * real time to reach the keys, so a faster tempo fits more of the score on the highway
 * and its notes shorten. "fixed-tempo": a beat is always the same length, so notes keep
 * their size and come down faster or slower with the tempo.
 */
export type HighwayTimeScale = "steady-speed" | "fixed-tempo";

/**
 * How wide a white key's notes are on the highway: its track, the key's back between
 * the black keys, as black-key notes are; or the whole key, reaching under the black
 * keys' tracks beside it, so white-key notes stand out from black-key ones.
 */
export type WhiteNoteWidth = "track" | "whole-key";

export interface KeyboardViewSettings {
  range: KeyboardRangeMode;
  /** The narrowest a song or hand range gets, in white keys. */
  minimumWhiteKeys: number;
  /** Names every C (C1, C2…) on its key, so an octave can be found at a glance. */
  octaveLabels: boolean;
  /** A circle with the finger number on each played key. */
  fingerNumbers: boolean;
  /** The note name on each played key. */
  noteNames: boolean;
  upcomingEffect: UpcomingKeyEffect;
  /** How far up the highway a note is when its key starts to show it, as a share of the highway. */
  upcomingLead: number;
  rightHandColor: string;
  leftHandColor: string;
  /** How far the highway leans back from the screen, in degrees: 0 is seen straight on. */
  tilt: number;
  /** The keys lie on the highway's floor, tilted with it, instead of standing flat below it. */
  keyboard3d: boolean;
  noteStyle: HighwayNoteStyle;
  timeScale: HighwayTimeScale;
  whiteNoteWidth: WhiteNoteWidth;
  /**
   * Stretches the highway's time: 2 shows half as much time ahead, with every note
   * twice as long and twice as far from the next.
   */
  timeZoom: number;
  /** The finger number on each note block of the practised hand. */
  highwayFingerNumbers: boolean;
}

export const KEYBOARD_RANGE_MODES: readonly KeyboardRangeMode[] = ["full", "song", "practiced-hand"];
export const UPCOMING_KEY_EFFECTS: readonly UpcomingKeyEffect[] = [
  "off", "top-edge", "tint", "growing-tint", "filling-meter",
];
export const HIGHWAY_NOTE_STYLES: readonly HighwayNoteStyle[] = ["raised", "flat"];
export const HIGHWAY_TIME_SCALES: readonly HighwayTimeScale[] = ["steady-speed", "fixed-tempo"];
export const WHITE_NOTE_WIDTHS: readonly WhiteNoteWidth[] = ["track", "whole-key"];
export const UPCOMING_LEADS: readonly number[] = [0.125, 0.25, 0.5, 1];

export const MIN_TIME_ZOOM = 0.5;
export const MAX_TIME_ZOOM = 4;
export const MIN_TILT = 0;
export const MAX_TILT = 65;
export const MIN_WHITE_KEYS = 7;
export const MAX_WHITE_KEYS = 52;

export const DEFAULT_RIGHT_HAND_COLOR = "#2fbfa5";
export const DEFAULT_LEFT_HAND_COLOR = "#f28c38";

export const DEFAULT_KEYBOARD_VIEW_SETTINGS: Readonly<KeyboardViewSettings> = Object.freeze({
  range: "full",
  minimumWhiteKeys: 15,
  octaveLabels: true,
  fingerNumbers: true,
  noteNames: false,
  upcomingEffect: "growing-tint",
  upcomingLead: 0.25,
  rightHandColor: DEFAULT_RIGHT_HAND_COLOR,
  leftHandColor: DEFAULT_LEFT_HAND_COLOR,
  tilt: 34,
  keyboard3d: false,
  noteStyle: "raised",
  timeScale: "steady-speed",
  whiteNoteWidth: "track",
  timeZoom: 1,
  highwayFingerNumbers: true,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function clampedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/** Fills in, field by field, whatever a stored value is missing or got wrong. */
export function normalizeKeyboardViewSettings(stored: unknown): KeyboardViewSettings {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const defaults = DEFAULT_KEYBOARD_VIEW_SETTINGS;
  return {
    range: oneOf(KEYBOARD_RANGE_MODES, raw.range, defaults.range),
    minimumWhiteKeys: Math.round(
      clampedNumber(raw.minimumWhiteKeys, MIN_WHITE_KEYS, MAX_WHITE_KEYS, defaults.minimumWhiteKeys),
    ),
    octaveLabels: flag(raw.octaveLabels, defaults.octaveLabels),
    fingerNumbers: flag(raw.fingerNumbers, defaults.fingerNumbers),
    noteNames: flag(raw.noteNames, defaults.noteNames),
    upcomingEffect: oneOf(UPCOMING_KEY_EFFECTS, raw.upcomingEffect, defaults.upcomingEffect),
    upcomingLead: oneOf(UPCOMING_LEADS, raw.upcomingLead, defaults.upcomingLead),
    rightHandColor: color(raw.rightHandColor, defaults.rightHandColor),
    leftHandColor: color(raw.leftHandColor, defaults.leftHandColor),
    tilt: Math.round(clampedNumber(raw.tilt, MIN_TILT, MAX_TILT, defaults.tilt)),
    keyboard3d: flag(raw.keyboard3d, defaults.keyboard3d),
    noteStyle: oneOf(HIGHWAY_NOTE_STYLES, raw.noteStyle, defaults.noteStyle),
    timeScale: oneOf(HIGHWAY_TIME_SCALES, raw.timeScale, defaults.timeScale),
    whiteNoteWidth: oneOf(WHITE_NOTE_WIDTHS, raw.whiteNoteWidth, defaults.whiteNoteWidth),
    timeZoom: Math.round(10 * clampedNumber(raw.timeZoom, MIN_TIME_ZOOM, MAX_TIME_ZOOM, defaults.timeZoom)) / 10,
    highwayFingerNumbers: flag(raw.highwayFingerNumbers, defaults.highwayFingerNumbers),
  };
}

/** A hex colour scaled toward black by `factor`. */
export function shadeColor(hex: string, factor: number): string {
  const channels = [1, 3, 5].map((start) =>
    Math.round(Math.min(255, Math.max(0, parseInt(hex.slice(start, start + 2), 16) * factor))),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function colorChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number];
}

/** One hand's colours: notes on white keys take the base, notes on black keys the darker shade. */
export interface HandColor {
  base: string;
  dark: string;
}

export interface HandColors {
  right: HandColor;
  left: HandColor;
}

export function handColors(settings: Pick<KeyboardViewSettings, "rightHandColor" | "leftHandColor">): HandColors {
  return {
    right: { base: settings.rightHandColor, dark: shadeColor(settings.rightHandColor, 0.58) },
    left: { base: settings.leftHandColor, dark: shadeColor(settings.leftHandColor, 0.6) },
  };
}

/** The CSS custom properties the keyboard and its labels are coloured with. */
export function handColorProperties(colors: HandColors): Record<string, string> {
  return {
    "--hand-right": colors.right.base,
    "--hand-right-dark": colors.right.dark,
    "--hand-left": colors.left.base,
    "--hand-left-dark": colors.left.dark,
  };
}

/** A span of keys from `low` to `high`, both white keys, both included. */
export interface KeyboardRange {
  low: number;
  high: number;
}

export const FULL_KEYBOARD_RANGE: Readonly<KeyboardRange> = Object.freeze({
  low: FIRST_PIANO_MIDI,
  high: LAST_PIANO_MIDI,
});

function whiteBelow(midi: number): number {
  let next = midi - 1;
  while (isBlackKey(next)) next -= 1;
  return next;
}

function whiteAbove(midi: number): number {
  let next = midi + 1;
  while (isBlackKey(next)) next += 1;
  return next;
}

export function whiteKeyCount({ low, high }: KeyboardRange): number {
  let count = 0;
  for (let midi = low; midi <= high; midi += 1) if (!isBlackKey(midi)) count += 1;
  return count;
}

/**
 * The keys from the lowest to the highest note, with one more white key on each
 * side so the outer notes are not on the keyboard's edge, widened a white key at a
 * time (above first, then below) until it is `minimumWhiteKeys` wide. No notes,
 * or none on the piano, give the full keyboard.
 */
export function keyboardRangeForNotes(midis: Iterable<number>, minimumWhiteKeys: number): KeyboardRange {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const midi of midis) {
    if (midi < FIRST_PIANO_MIDI || midi > LAST_PIANO_MIDI) continue;
    lowest = Math.min(lowest, midi);
    highest = Math.max(highest, midi);
  }
  if (!Number.isFinite(lowest)) return { ...FULL_KEYBOARD_RANGE };
  // A black key's neighbours share its lane edges, so the white key under it counts as played.
  let low = Math.max(FIRST_PIANO_MIDI, whiteBelow(isBlackKey(lowest) ? lowest - 1 : lowest));
  let high = Math.min(LAST_PIANO_MIDI, whiteAbove(isBlackKey(highest) ? highest + 1 : highest));
  let count = whiteKeyCount({ low, high });
  const target = Math.min(MAX_WHITE_KEYS, minimumWhiteKeys);
  let above = true;
  while (count < target) {
    if ((above && high < LAST_PIANO_MIDI) || low <= FIRST_PIANO_MIDI) high = whiteAbove(high);
    else low = whiteBelow(low);
    above = !above;
    count += 1;
  }
  return { low, high };
}

/** The range a keyboard setting asks for, from every note of the score. */
export function keyboardRangeForSetting(
  mode: KeyboardRangeMode,
  minimumWhiteKeys: number,
  notes: Iterable<{ pitch: string; left?: boolean }>,
  practiceHand: PracticeHand,
): KeyboardRange {
  if (mode === "full") return { ...FULL_KEYBOARD_RANGE };
  const hand = mode === "practiced-hand" ? practiceHand : "both";
  const midis: number[] = [];
  for (const note of notes) {
    if (!noteInPracticeHand(note.left, hand)) continue;
    const midi = pitchToMidi(note.pitch);
    if (midi !== null) midis.push(midi);
  }
  return keyboardRangeForNotes(midis, minimumWhiteKeys);
}
