// Structural note keys (section 3.5 of the plan): part, measure by position, staff,
// voice, onset, and written pitch, such as `P1-m12-s1-v1-t3_8-E5`. Keys use only letters,
// digits, `-` and `_`, so every key is a valid XML ID, and they do not depend on layout.
import { fractionKey, type Fraction } from "../model/fraction";

/** Characters outside the key alphabet, and `-`, which separates the key's fields. */
function keyToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_") || "_";
}

const ALTER_TOKENS = new Map([
  [-2, "bb"],
  [-1, "b"],
  [0, ""],
  [1, "s"],
  [2, "x"],
]);

/** Written pitch: `E5`, `Fs5` for F sharp, `Bb4`, `Fx5` for F double sharp. */
export function pitchToken(step: string, alter: number, octave: number): string {
  const accidental = ALTER_TOKENS.get(alter) ?? `a${keyToken(String(alter))}`;
  return `${step}${accidental}${octave}`;
}

export interface ChordPosition {
  partId: string;
  /** Zero-based position of the measure in the part. */
  measureIndex: number;
  staff: number;
  voice: string;
  onset: Fraction;
  /** One-based position among the grace chords before this onset; null for other chords. */
  graceOrdinal: number | null;
}

/** The key of a chord: its notes' keys without the pitch. */
export function chordKey(position: ChordPosition): string {
  const grace = position.graceOrdinal === null ? "" : `-g${position.graceOrdinal}`;
  return (
    `${keyToken(position.partId)}-m${position.measureIndex + 1}-s${position.staff}` +
    `-v${keyToken(position.voice)}-t${fractionKey(position.onset)}${grace}`
  );
}

/** Hands out keys, numbering repeats of the same key `-2`, `-3`, and so on. */
export class NoteKeyAllocator {
  private readonly counts = new Map<string, number>();

  allocate(base: string): string {
    const count = (this.counts.get(base) ?? 0) + 1;
    this.counts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }
}
