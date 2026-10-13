// One chord or rest laid out around its origin: x = 0 is the left edge of the notehead
// column, y = 0 the staff's top line, lengths in staff spaces. Noteheads a second apart
// go to the other side of the stem, accidentals stack in columns to the left, dots go to
// the right, and ledger lines cover the noteheads beyond the staff.
import {
  ENGRAVING_DEFAULTS,
  glyphAnchor,
  glyphBox,
  glyphWidth,
  type GlyphName,
} from "../fonts/smufl";
import { compare, fraction, toNumber, type Fraction } from "../model/fraction";
import type { NoteType } from "../model/score";
import type { PreparedChord } from "./measureContent";
import { staffPosition } from "./staffPosition";

/** MuseScore's graceNoteMag and smallNoteMag. */
export const SMALL_SCALE = 0.7;
export const STEM_WIDTH = ENGRAVING_DEFAULTS.stemThickness;
const LEDGER_EXTENSION = ENGRAVING_DEFAULTS.legerLineExtension;
const ACCIDENTAL_NOTE_DISTANCE = 0.25;
const ACCIDENTAL_DISTANCE = 0.22;
const DOT_NOTE_DISTANCE = 0.5;
const DOT_DOT_DISTANCE = 0.65;
const MIDDLE_LINE = 2;

export interface NoteShape {
  /** Index into the chord's notes. */
  index: number;
  position: number;
  x: number;
  y: number;
  head: GlyphName;
  accidental: { glyph: GlyphName; x: number; y: number } | null;
}

export interface StemShape {
  up: boolean;
  x: number;
  /** Where the stem leaves the notehead furthest from its end. */
  yStart: number;
  yEnd: number;
}

export interface ChordShape {
  scale: number;
  notes: NoteShape[];
  rest: { glyph: GlyphName; x: number; y: number } | null;
  stem: StemShape | null;
  flag: GlyphName | null;
  /** Augmentation dots, each with the note it belongs to; -1 for a rest's dots. */
  dots: { x: number; y: number; note: number }[];
  ledgers: { y: number; x1: number; x2: number }[];
  /** How far the chord reaches left of its origin, as a positive length. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const TYPE_BY_LOG2: [number, NoteType][] = [
  [3, "maxima"], [2, "long"], [1, "breve"], [0, "whole"], [-1, "half"], [-2, "quarter"],
  [-3, "eighth"], [-4, "16th"], [-5, "32nd"], [-6, "64th"], [-7, "128th"],
];

/** The notated type, or one guessed from the duration when the file gives none. */
export function noteType(type: NoteType | null, duration: Fraction): NoteType {
  if (type) return type;
  const value = toNumber(duration);
  if (value <= 0) return "eighth";
  const log2 = Math.floor(Math.log2(value) + 1e-9);
  return TYPE_BY_LOG2.find(([candidate]) => candidate <= log2)?.[1] ?? "128th";
}

/** Beams or flags: 1 for an eighth, 2 for a 16th, and so on; 0 for longer notes. */
export function flagCount(type: NoteType): number {
  const counts: Partial<Record<NoteType, number>> = {
    eighth: 1, "16th": 2, "32nd": 3, "64th": 4, "128th": 5, "256th": 6, "512th": 7, "1024th": 8,
  };
  return counts[type] ?? 0;
}

export function hasStem(type: NoteType): boolean {
  return !["maxima", "long", "breve", "whole"].includes(type);
}

function noteheadGlyph(type: NoteType): GlyphName {
  if (type === "breve" || type === "long" || type === "maxima") return "noteheadDoubleWhole";
  if (type === "whole") return "noteheadWhole";
  if (type === "half") return "noteheadHalf";
  return "noteheadBlack";
}

const FLAGS: GlyphName[][] = [
  ["flag8thUp", "flag8thDown"],
  ["flag16thUp", "flag16thDown"],
  ["flag32ndUp", "flag32ndDown"],
  ["flag64thUp", "flag64thDown"],
  ["flag128thUp", "flag128thDown"],
];

function flagGlyph(type: NoteType, up: boolean): GlyphName | null {
  const count = flagCount(type);
  if (count === 0) return null;
  return FLAGS[Math.min(count, FLAGS.length) - 1][up ? 0 : 1];
}

/** Stems grow with their flags so the flags clear the notehead. */
export function stemLength(type: NoteType): number {
  return 3.5 + Math.max(0, flagCount(type) - 2) * 0.75;
}

function restGlyph(type: NoteType, measureRest: boolean, measureDuration: Fraction): GlyphName {
  if (measureRest) {
    return compare(measureDuration, fraction(2)) >= 0 ? "restDoubleWhole" : "restWhole";
  }
  const glyphs: Partial<Record<NoteType, GlyphName>> = {
    maxima: "restLonga", long: "restLonga", breve: "restDoubleWhole", whole: "restWhole",
    half: "restHalf", quarter: "restQuarter", eighth: "rest8th", "16th": "rest16th",
    "32nd": "rest32nd", "64th": "rest64th",
  };
  return glyphs[type] ?? "rest128th";
}

/** An odd voice number is an upper voice, as in MuseScore's piano voices 1 and 5. */
export function isUpperVoice(voice: string): boolean {
  const number = Number(voice);
  return !Number.isFinite(number) || number % 2 === 1;
}

function restY(chord: PreparedChord, glyph: GlyphName): number {
  const hangs = glyph === "restWhole";
  const rest = chord.model.restPosition;
  if (rest) {
    const y = staffPosition(chord.clef, rest.step, rest.octave) / 2;
    return hangs ? y - 1 : y;
  }
  if (!chord.sharedStaff) return hangs ? 1 : MIDDLE_LINE;
  const upper = isUpperVoice(chord.model.voice);
  if (hangs) return upper ? 0 : 3;
  return upper ? 1 : 3;
}

interface Placed {
  index: number;
  position: number;
  displaced: boolean;
}

/** Notes a second above or below a normally placed note move to the other side of the stem. */
function placeNoteheads(positions: number[], up: boolean): Placed[] {
  const placed = positions.map((position, index) => ({ index, position, displaced: false }));
  // Up stems work from the bottom note upward, down stems from the top note downward.
  const order = [...placed].sort((a, b) => (up ? b.position - a.position : a.position - b.position));
  for (let index = 1; index < order.length; index += 1) {
    const previous = order[index - 1];
    if (Math.abs(order[index].position - previous.position) <= 1 && !previous.displaced) {
      order[index].displaced = true;
    }
  }
  return placed;
}

/** Accidentals stack in columns leftward, top to bottom, wherever they do not overlap. */
function placeAccidentals(
  notes: NoteShape[],
  glyphs: (GlyphName | null)[],
  rightEdge: number,
  scale: number,
): void {
  const columns: { width: number; spans: [number, number][]; members: NoteShape[] }[] = [];
  const withAccidentals = notes
    .filter((note) => glyphs[note.index])
    .sort((a, b) => a.position - b.position);
  for (const note of withAccidentals) {
    const glyph = glyphs[note.index]!;
    const box = glyphBox(glyph);
    const span: [number, number] = [note.y + box.top * scale, note.y + box.bottom * scale];
    let column = columns.find((candidate) =>
      candidate.spans.every(([top, bottom]) => span[1] <= top + 0.05 || span[0] >= bottom - 0.05),
    );
    if (!column) {
      column = { width: 0, spans: [], members: [] };
      columns.push(column);
    }
    column.spans.push(span);
    column.members.push(note);
    column.width = Math.max(column.width, glyphWidth(glyph) * scale);
    note.accidental = { glyph, x: 0, y: note.y };
  }
  let right = rightEdge;
  for (const column of columns) {
    for (const note of column.members) {
      const glyph = note.accidental!.glyph;
      note.accidental!.x = right - glyphBox(glyph).right * scale;
    }
    right -= column.width + ACCIDENTAL_DISTANCE * scale;
  }
}

/**
 * Lays out a chord with the given stem direction (ignored for rests and stemless notes).
 * `beamed` chords get no flag; their stem ends are set later by the beam.
 */
export function layoutChord(
  chord: PreparedChord,
  up: boolean,
  beamed: boolean,
  measureDuration: Fraction,
): ChordShape {
  const model = chord.model;
  const scale = model.grace || model.cue ? SMALL_SCALE : 1;
  const type = noteType(model.type, model.duration);

  if (model.rest || model.notes.length === 0) {
    const glyph = restGlyph(type, model.measureRest, measureDuration);
    const box = glyphBox(glyph);
    const y = restY(chord, glyph);
    const dots: ChordShape["dots"] = [];
    for (let dot = 0; dot < model.dots; dot += 1) {
      // In the space above the rest's centre line.
      dots.push({ x: box.right * scale + (DOT_NOTE_DISTANCE + dot * DOT_DOT_DISTANCE) * scale, y: Math.floor(y) - 0.5, note: -1 });
    }
    return {
      scale,
      notes: [],
      rest: { glyph, x: 0, y },
      stem: null,
      flag: null,
      dots,
      ledgers: [],
      left: 0,
      right: dots.length ? dots[dots.length - 1].x + 0.4 * scale : box.right * scale,
      top: y + box.top * scale,
      bottom: y + box.bottom * scale,
    };
  }

  const head = noteheadGlyph(type);
  const headBox = glyphBox(head);
  const headWidth = (headBox.right - headBox.left) * scale;
  const stemmed = hasStem(type) && model.stem !== "none";
  const positions = model.notes.map((note) => staffPosition(chord.clef, note.step, note.octave));
  const shift = stemmed ? headWidth - STEM_WIDTH * scale : headWidth;
  const notes: NoteShape[] = placeNoteheads(positions, up || !stemmed).map(({ index, position, displaced }) => ({
    index,
    position,
    x: displaced ? (up || !stemmed ? shift : -shift) : 0,
    y: position / 2,
    head,
    accidental: null,
  }));

  const leftmostHead = Math.min(...notes.map((note) => note.x));
  placeAccidentals(notes, chord.accidentals, leftmostHead - ACCIDENTAL_NOTE_DISTANCE * scale, scale);

  const ledgers: ChordShape["ledgers"] = [];
  const minPosition = Math.min(...positions);
  const maxPosition = Math.max(...positions);
  const ledgerFor = (line: number, beyond: (position: number) => boolean) => {
    const covered = notes.filter((note) => beyond(note.position));
    ledgers.push({
      y: line / 2,
      x1: Math.min(...covered.map((note) => note.x)) - LEDGER_EXTENSION * scale,
      x2: Math.max(...covered.map((note) => note.x)) + headWidth + LEDGER_EXTENSION * scale,
    });
  };
  for (let line = -2; line >= minPosition; line -= 2) ledgerFor(line, (position) => position <= line);
  for (let line = 10; line <= maxPosition; line += 2) ledgerFor(line, (position) => position >= line);

  const headsRight = Math.max(...notes.map((note) => note.x)) + headWidth;
  const dots: ChordShape["dots"] = [];
  if (model.dots > 0) {
    // A note on a line puts its dots in the space above it, or below it in a lower voice;
    // notes whose dots would share a space share them, and the first note owns them.
    const lowerVoice = chord.sharedStaff && !isUpperVoice(model.voice);
    const owners = new Map<number, number>();
    positions.forEach((position, index) => {
      const dotPosition = position % 2 === 0 ? position + (lowerVoice ? 1 : -1) : position;
      if (!owners.has(dotPosition)) owners.set(dotPosition, index);
    });
    for (let dot = 0; dot < model.dots; dot += 1) {
      const x = headsRight + (DOT_NOTE_DISTANCE + dot * DOT_DOT_DISTANCE) * scale;
      for (const [position, note] of owners) dots.push({ x, y: position / 2, note });
    }
  }

  let stem: StemShape | null = null;
  let flag: GlyphName | null = null;
  if (stemmed) {
    const top = notes.reduce((best, note) => (note.position < best.position ? note : best));
    const bottom = notes.reduce((best, note) => (note.position > best.position ? note : best));
    const length = stemLength(type) * scale;
    if (up) {
      const anchor = glyphAnchor(head, "stemUpSE") ?? [headBox.right, 0];
      const yEnd = top.y - length;
      stem = {
        up,
        x: anchor[0] * scale - (STEM_WIDTH * scale) / 2,
        yStart: bottom.y + anchor[1] * scale,
        yEnd: model.grace ? yEnd : Math.min(yEnd, MIDDLE_LINE),
      };
    } else {
      const anchor = glyphAnchor(head, "stemDownNW") ?? [0, 0];
      const yEnd = bottom.y + length;
      stem = {
        up,
        x: anchor[0] * scale + (STEM_WIDTH * scale) / 2,
        yStart: top.y + anchor[1] * scale,
        yEnd: model.grace ? yEnd : Math.max(yEnd, MIDDLE_LINE),
      };
    }
    if (!beamed) flag = flagGlyph(type, up);
  }

  const accidentalLeft = Math.min(
    leftmostHead,
    ...notes.filter((note) => note.accidental).map((note) => note.accidental!.x),
  );
  const flagRight = flag && stem ? stem.x + glyphBox(flag).right * scale : -Infinity;
  const ledgerLeft = Math.min(leftmostHead, ...ledgers.map((ledger) => ledger.x1));
  const ledgerRight = Math.max(headsRight, ...ledgers.map((ledger) => ledger.x2));
  const ys = notes.map((note) => note.y);
  return {
    scale,
    notes,
    rest: null,
    stem,
    flag,
    dots,
    ledgers,
    left: -Math.min(accidentalLeft, ledgerLeft),
    right: Math.max(
      headsRight,
      ledgerRight,
      flagRight,
      ...dots.map((dot) => dot.x + glyphWidth("augmentationDot") * scale),
    ),
    top: Math.min(...ys.map((y) => y - 0.5), stem ? Math.min(stem.yStart, stem.yEnd) : Infinity),
    bottom: Math.max(...ys.map((y) => y + 0.5), stem ? Math.max(stem.yStart, stem.yEnd) : -Infinity),
  };
}
