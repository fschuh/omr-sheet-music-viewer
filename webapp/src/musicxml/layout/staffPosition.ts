// Where pitches sit on a five-line staff. A staff position counts half staff spaces down
// from the top line: 0 is the top line, 8 the bottom line, negative values are above.
import type { GlyphName } from "../fonts/smufl";
import type { ClefSign } from "../model/score";

export interface Clef {
  sign: ClefSign;
  /** Staff line the clef marks, counted from the bottom. */
  line: number;
  octaveChange: number;
}

export const TREBLE_CLEF: Clef = { sign: "G", line: 2, octaveChange: 0 };

const STEP_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function diatonic(step: string, octave: number): number {
  return octave * 7 + (STEP_INDEX[step] ?? 0);
}

/** The pitch a clef's line stands for: G4, F3 or C4. Other clefs read like a G clef. */
function clefReference(clef: Clef): number {
  const base = clef.sign === "F" ? diatonic("F", 3) : clef.sign === "C" ? diatonic("C", 4) : diatonic("G", 4);
  return base + 7 * clef.octaveChange;
}

/** The y of the clef's line, in staff spaces below the top line. */
export function clefLineY(clef: Clef): number {
  return 5 - clef.line;
}

export function staffPosition(clef: Clef, step: string, octave: number): number {
  return clefLineY(clef) * 2 - (diatonic(step, octave) - clefReference(clef));
}

export function clefsEqual(a: Clef, b: Clef): boolean {
  return a.sign === b.sign && a.line === b.line && a.octaveChange === b.octaveChange;
}

/** The glyph for a clef, its origin's y in staff spaces below the top line, or null for none. */
export function clefGlyph(clef: Clef, change: boolean): { glyph: GlyphName; y: number } | null {
  const y = clefLineY(clef);
  switch (clef.sign) {
    case "G":
      if (change) return { glyph: "gClefChange", y };
      return {
        glyph:
          clef.octaveChange === -1 ? "gClef8vb"
          : clef.octaveChange === 1 ? "gClef8va"
          : clef.octaveChange === -2 ? "gClef15mb"
          : clef.octaveChange === 2 ? "gClef15ma"
          : "gClef",
        y,
      };
    case "F":
      if (change) return { glyph: "fClefChange", y };
      return {
        glyph: clef.octaveChange === -1 ? "fClef8vb" : clef.octaveChange === 1 ? "fClef8va" : "fClef",
        y,
      };
    case "C":
      return { glyph: change ? "cClefChange" : "cClef", y };
    case "percussion":
      return { glyph: "unpitchedPercussionClef1", y: 2 };
    case "TAB":
      return { glyph: "6stringTabClef", y: 2 };
    case "none":
      return null;
  }
}

const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
/** Positions on a treble staff. */
const TREBLE_SHARP_POSITIONS = [0, 3, -1, 2, 5, 1, 4];
const TREBLE_FLAT_POSITIONS = [4, 1, 5, 2, 6, 3, 7];

/** The alteration a key signature gives each step. */
export function keyAlterations(fifths: number): Map<string, number> {
  const result = new Map<string, number>();
  const count = Math.min(7, Math.abs(fifths));
  for (let index = 0; index < count; index += 1) {
    result.set(fifths > 0 ? SHARP_ORDER[index] : FLAT_ORDER[index], fifths > 0 ? 1 : -1);
  }
  return result;
}

/**
 * The naturals a key change prints before the new key: for every accidental of the old key
 * the new one does not keep, at the old accidental's place.
 */
export function keyCancellation(clef: Clef, oldFifths: number, newFifths: number): { glyph: GlyphName; position: number }[] {
  const old = keySignature(clef, oldFifths);
  const keep = Math.sign(oldFifths) === Math.sign(newFifths) ? Math.min(Math.abs(newFifths), old.length) : 0;
  return old.slice(keep).map(({ position }) => ({ glyph: "accidentalNatural", position }));
}

/** A key signature's accidentals with their staff positions, in drawing order. */
export function keySignature(clef: Clef, fifths: number): { glyph: GlyphName; position: number }[] {
  // Other clefs use the treble pattern moved to where their B4 sits, within an octave.
  const shift = ((((staffPosition(clef, "B", 4) - 4) % 7) + 10) % 7) - 3;
  const count = Math.min(7, Math.abs(fifths));
  const positions = fifths > 0 ? TREBLE_SHARP_POSITIONS : TREBLE_FLAT_POSITIONS;
  return Array.from({ length: count }, (_, index) => ({
    glyph: fifths > 0 ? "accidentalSharp" : "accidentalFlat",
    position: positions[index] + shift,
  }));
}
