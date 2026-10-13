// Prepares the score for layout: numbers the staves of all parts, tracks the clef, key
// and time in effect, decides which accidentals are printed, and divides every measure
// into segments, the onsets that are aligned across all staves (MuseScore's Segment).
import type { GlyphName } from "../fonts/smufl";
import {
  compare,
  fraction,
  minFraction,
  subtract,
  ZERO,
  type Fraction,
} from "../model/fraction";
import type { ChordModel, EndingMark, KeyChange, ScoreModel, TimeChange } from "../model/score";
import { clefsEqual, keyAlterations, TREBLE_CLEF, type Clef } from "./staffPosition";

export interface StaffRef {
  part: number;
  /** One-based staff number within the part. */
  staffNumber: number;
}

export interface PreparedChord {
  model: ChordModel;
  part: number;
  /** Index into PreparedScore.staves. */
  staff: number;
  measureIndex: number;
  clef: Clef;
  /** The accidental printed before each note, in note order. */
  accidentals: (GlyphName | null)[];
  /** More than one voice uses the staff in this measure. */
  sharedStaff: boolean;
}

export interface ClefDisplay {
  staff: number;
  clef: Clef;
}

export interface Segment {
  onset: Fraction;
  /** Until the next segment or the end of the measure. */
  duration: Fraction;
  chords: PreparedChord[];
  /** Grace chords before this onset, in order. */
  graces: PreparedChord[];
  /** Clef changes drawn before this segment's chords. */
  clefChanges: ClefDisplay[];
}

export interface PreparedMeasure {
  index: number;
  number: string;
  duration: Fraction;
  time: TimeChange;
  /** A time signature printed at the start of the measure. */
  timeChange: TimeChange | null;
  /** In effect at the start, per staff. */
  clefs: Clef[];
  fifths: number[];
  /** Key signatures printed at the start, per staff; null where the key does not change. */
  keyChanges: (number | null)[];
  /** The key before the measure, per staff, which a key change cancels. */
  previousFifths: number[];
  /** Clef changes printed at the start of the measure. */
  startClefChanges: ClefDisplay[];
  segments: Segment[];
  /** The right barline's style. */
  barStyle: string;
  /** The measure starts with a start-repeat barline. */
  startRepeat: boolean;
  /** The measure ends with an end-repeat barline. */
  endRepeat: boolean;
  /** A volta starting at this measure, and how one ending here ends. */
  endingStart: EndingMark | null;
  endingEnd: "stop" | "discontinue" | null;
}

export interface PreparedScore {
  staves: StaffRef[];
  /** For each part, its staves' indexes. */
  partStaves: number[][];
  measures: PreparedMeasure[];
}

const DEFAULT_TIME: TimeChange = { onset: ZERO, beats: "4", beatType: "4", symbol: "normal" };

function timeLength(time: TimeChange): Fraction {
  const beats = time.beats.split("+").reduce((total, value) => total + (Number(value) || 0), 0);
  const beatType = Number(time.beatType) || 4;
  return fraction(Math.max(1, beats), beatType);
}

const ACCIDENTAL_GLYPHS: Record<string, GlyphName> = {
  sharp: "accidentalSharp",
  natural: "accidentalNatural",
  flat: "accidentalFlat",
  "double-sharp": "accidentalDoubleSharp",
  "sharp-sharp": "accidentalDoubleSharp",
  "flat-flat": "accidentalDoubleFlat",
  "double-flat": "accidentalDoubleFlat",
  "natural-sharp": "accidentalNaturalSharp",
  "natural-flat": "accidentalNaturalFlat",
  "triple-sharp": "accidentalTripleSharp",
  "triple-flat": "accidentalTripleFlat",
};

function alterGlyph(alter: number): GlyphName | null {
  switch (alter) {
    case 0: return "accidentalNatural";
    case 1: return "accidentalSharp";
    case -1: return "accidentalFlat";
    case 2: return "accidentalDoubleSharp";
    case -2: return "accidentalDoubleFlat";
    case 3: return "accidentalTripleSharp";
    case -3: return "accidentalTripleFlat";
    default: return null;
  }
}

/** Chords in time order, grace chords before the onset they lead to. */
function timeOrder(first: ChordModel, second: ChordModel): number {
  const byOnset = compare(first.onset, second.onset);
  if (byOnset !== 0) return byOnset;
  return Number(first.grace === null) - Number(second.grace === null);
}

/**
 * Accidentals as engraved: a note shows one when its alteration differs from what the key
 * and earlier notes on its staff line in the measure imply, or when the file prints one.
 * A tied note continues its accidental and shows none unless the file prints one.
 */
function decideAccidentals(chords: PreparedChord[], fifths: number, keyChanges: KeyChange[]): void {
  let key = keyAlterations(fifths);
  const measureAlterations = new Map<string, number>();
  const pendingKeys = [...keyChanges].sort((a, b) => compare(a.onset, b.onset));
  for (const chord of [...chords].sort((a, b) => timeOrder(a.model, b.model))) {
    while (pendingKeys.length && compare(pendingKeys[0].onset, chord.model.onset) <= 0) {
      key = keyAlterations(pendingKeys.shift()!.fifths);
    }
    chord.accidentals = chord.model.notes.map((note) => {
      if (note.unpitched) return null;
      const line = `${note.step}${note.octave}`;
      const implied = measureAlterations.get(line) ?? key.get(note.step) ?? 0;
      measureAlterations.set(line, note.alter);
      if (note.accidental) return ACCIDENTAL_GLYPHS[note.accidental] ?? alterGlyph(note.alter);
      if (note.tieStop || note.alter === implied) return null;
      return alterGlyph(note.alter);
    });
  }
}

export function prepareScore(score: ScoreModel): PreparedScore {
  const staves: StaffRef[] = [];
  const partStaves = score.parts.map((part, partIndex) => {
    const staffCount = Math.max(
      part.staffCount,
      ...part.measures.flatMap((measure) => measure.chords.map((chord) => chord.staff)),
    );
    return Array.from({ length: staffCount }, (_, offset) => {
      staves.push({ part: partIndex, staffNumber: offset + 1 });
      return staves.length - 1;
    });
  });
  const clefs: Clef[] = staves.map(() => TREBLE_CLEF);
  const fifths: number[] = staves.map(() => 0);
  let time = DEFAULT_TIME;

  const measures = score.measures.map((shared, measureIndex): PreparedMeasure => {
    const startClefs = [...clefs];
    const startFifths = [...fifths];
    const previousFifths = [...fifths];
    const keyChanges: (number | null)[] = staves.map(() => null);
    const startClefChanges: ClefDisplay[] = [];
    const clefsAtOnset: { staff: number; onset: Fraction; clef: Clef }[] = [];
    let timeChange: TimeChange | null = null;
    const chords: PreparedChord[] = [];

    score.parts.forEach((part, partIndex) => {
      const measure = part.measures[measureIndex];
      for (const change of measure.times) {
        if (compare(change.onset, ZERO) === 0) {
          time = change;
          timeChange = change;
        }
      }
      for (const change of measure.keys) {
        const targets = change.staff === null
          ? partStaves[partIndex]
          : [partStaves[partIndex][change.staff - 1]].filter((staff) => staff !== undefined);
        for (const staff of targets) {
          if (compare(change.onset, ZERO) === 0) {
            if (measureIndex > 0 && startFifths[staff] !== change.fifths) keyChanges[staff] = change.fifths;
            startFifths[staff] = change.fifths;
          }
          fifths[staff] = change.fifths;
        }
      }
      for (const change of measure.clefs) {
        const staff = partStaves[partIndex][change.staff - 1];
        if (staff === undefined) continue;
        const clef: Clef = { sign: change.sign, line: change.line, octaveChange: change.octaveChange };
        clefsAtOnset.push({ staff, onset: change.onset, clef });
      }
      for (const chord of measure.chords) {
        const staff = partStaves[partIndex][chord.staff - 1];
        chords.push({
          model: chord,
          part: partIndex,
          staff,
          measureIndex,
          clef: TREBLE_CLEF,
          accidentals: [],
          sharedStaff: false,
        });
      }
    });

    // A measure is as long as its content, so pickups stay short; an empty one fills its time signature.
    const duration = compare(shared.duration, ZERO) > 0 ? shared.duration : timeLength(time);
    const segmentClefs: { onset: Fraction; display: ClefDisplay }[] = [];
    // Clef changes take effect from their onset; one at the very end applies to the next measure.
    for (const { staff, onset, clef } of clefsAtOnset.sort((a, b) => compare(a.onset, b.onset))) {
      if (compare(onset, ZERO) === 0) {
        if (measureIndex > 0 && !clefsEqual(startClefs[staff], clef)) startClefChanges.push({ staff, clef });
        startClefs[staff] = clef;
      } else if (compare(onset, duration) < 0) {
        segmentClefs.push({ onset, display: { staff, clef } });
      }
      clefs[staff] = clef;
    }
    for (const chord of chords) {
      let clef = startClefs[chord.staff];
      for (const change of segmentClefs) {
        if (change.display.staff === chord.staff && compare(change.onset, chord.model.onset) <= 0) clef = change.display.clef;
      }
      chord.clef = clef;
    }

    // Accidentals and voice sharing are decided per staff.
    staves.forEach((_, staff) => {
      const onStaff = chords.filter((chord) => chord.staff === staff);
      const voices = new Set(onStaff.filter((chord) => chord.model.printed).map((chord) => chord.model.voice));
      for (const chord of onStaff) chord.sharedStaff = voices.size > 1;
      decideAccidentals(
        onStaff,
        startFifths[staff],
        score.parts[staves[staff].part].measures[measureIndex].keys.filter(
          (change) => compare(change.onset, ZERO) > 0 && (change.staff === null || change.staff === staves[staff].staffNumber),
        ),
      );
    });

    const onsets = [...new Map(
      chords
        .filter((chord) => chord.model.grace === null && compare(chord.model.onset, duration) < 0)
        .map((chord) => [`${chord.model.onset.n}/${chord.model.onset.d}`, chord.model.onset]),
    ).values()].sort(compare);
    if (onsets.length === 0) onsets.push(ZERO);
    const segments: Segment[] = onsets.map((onset, index) => ({
      onset,
      duration: subtract(index + 1 < onsets.length ? onsets[index + 1] : duration, onset),
      chords: [],
      graces: [],
      clefChanges: [],
    }));
    const segmentAt = (onset: Fraction): Segment => {
      // The first segment at or after the onset; grace notes at the end lead nowhere and join the last.
      return segments.find((segment) => compare(segment.onset, onset) >= 0) ?? segments[segments.length - 1];
    };
    for (const chord of [...chords].sort((a, b) => timeOrder(a.model, b.model))) {
      const segment = segmentAt(chord.model.onset);
      if (chord.model.grace) segment.graces.push(chord);
      else segment.chords.push(chord);
    }
    for (const { onset, display } of segmentClefs) segmentAt(onset).clefChanges.push(display);

    const barlines = score.parts.flatMap((part) => part.measures[measureIndex].barlines);
    const right = barlines.filter((barline) => barline.location === "right");
    const barStyle = right.find((barline) => barline.style !== "regular")?.style ?? right[0]?.style ?? "regular";
    const endings = barlines.flatMap((barline) => (barline.ending ? [barline.ending] : []));

    return {
      index: measureIndex,
      number: shared.number,
      duration,
      time,
      timeChange,
      clefs: startClefs,
      fifths: startFifths,
      keyChanges,
      previousFifths,
      startClefChanges,
      segments,
      barStyle,
      startRepeat: barlines.some((barline) => barline.location === "left" && barline.repeat === "forward"),
      endRepeat: right.some((barline) => barline.repeat === "backward"),
      endingStart: endings.find((ending) => ending.type === "start") ?? null,
      endingEnd: endings.find((ending) => ending.type !== "start")?.type as "stop" | "discontinue" | undefined ?? null,
    };
  });
  return { staves, partStaves, measures };
}

/** The shortest chord or rest that starts at a segment; the segment's own length if none does. */
export function shortestAt(segment: Segment): Fraction {
  const durations = segment.chords
    .map((chord) => chord.model.duration)
    .filter((duration) => compare(duration, ZERO) > 0);
  return durations.length > 0 ? durations.reduce(minFraction) : segment.duration;
}
