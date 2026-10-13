// Horizontal spacing, after MuseScore 4's HorizontalSpacing. Each gap between segments is
// a spring: its natural width grows by MuseScore's measureSpacing (1.5) for every doubling
// of the time it spans, starting from 3.5 staff spaces for a quarter note, and it never
// shrinks below what keeps the neighbouring symbols apart. A system is justified by
// finding the one force that makes its springs fill the width; when even the tightest
// springs are too wide, the paddings between symbols shrink, as in MuseScore's
// squeezeSystemToFit.
import { glyphBox, glyphWidth, type GlyphName } from "../fonts/smufl";
import { compare, toNumber, ZERO, type Fraction } from "../model/fraction";
import type { TimeChange } from "../model/score";
import type { PreparedChord, PreparedMeasure, PreparedScore, Segment } from "./measureContent";
import { shortestAt } from "./measureContent";
import type { ChordShape } from "./chords";
import { clefGlyph, keySignature, type Clef } from "./staffPosition";

const MEASURE_SPACING = 1.5;
const MIN_NOTE_DISTANCE = 0.35;
const BAR_NOTE_DISTANCE = 1.25;
const BAR_ACCIDENTAL_DISTANCE = 0.65;
const NOTE_BAR_DISTANCE = 1.5;
const GRACE_TO_MAIN_DISTANCE = 0.45;
const GRACE_TO_GRACE_DISTANCE = 0.3;
const CLEF_LEFT_MARGIN = 0.75;
const CLEF_KEY_DISTANCE = 0.8;
const KEY_TIME_DISTANCE = 1.0;
const HEADER_NOTE_DISTANCE = 2.0;
const HEADER_TIME_NOTE_DISTANCE = 1.5;
const CHANGE_DISTANCE = 0.5;
const KEY_ACCIDENTAL_GAP = 0.1;
export const BARLINE_WIDTH = 0.18;
export const THICK_BARLINE_WIDTH = 0.55;
export const BARLINE_SEPARATION = 0.37;

/** A width made of symbols, which never shrink, and padding between them, which can. */
export interface Gap {
  hard: number;
  padding: number;
}

export interface Spring extends Gap {
  stretch: number;
}

/** How a system is spaced: the spring force, and how much of the padding is kept. */
export interface Spacing {
  force: number;
  /** 1 keeps all padding; MuseScore keeps at least a little. */
  squeeze: number;
}

export const NATURAL_SPACING: Spacing = { force: 3.5, squeeze: 1 };
const MIN_SQUEEZE = 0.25;

export function gapWidth(gap: Gap, squeeze: number): number {
  return gap.hard + gap.padding * squeeze;
}

export function springWidth(spring: Spring, spacing: Spacing): number {
  return Math.max(gapWidth(spring, spacing.squeeze), spacing.force * spring.stretch);
}

function durationStretch(duration: Fraction): number {
  return MEASURE_SPACING ** Math.log2(toNumber(duration) / 0.25);
}

/** MuseScore's computeSegmentDurationStretch, without its polyrhythm refinements. */
function segmentStretch(segment: Segment): number {
  const shortest = shortestAt(segment);
  if (compare(shortest, segment.duration) === 0 || compare(shortest, ZERO) === 0) {
    return durationStretch(segment.duration);
  }
  return durationStretch(shortest) * (toNumber(segment.duration) / toNumber(shortest));
}

export function keySignatureWidth(clef: Clef, fifths: number): number {
  return keySignature(clef, fifths).reduce(
    (total, { glyph }) => total + glyphWidth(glyph) + KEY_ACCIDENTAL_GAP,
    0,
  );
}

/** Time signature digits, each number as wide as its glyphs together. */
export function timeSignatureGlyphs(time: TimeChange): { numerator: GlyphName[]; denominator: GlyphName[]; single: GlyphName | null } {
  if (time.symbol === "common") return { numerator: [], denominator: [], single: "timeSigCommon" };
  if (time.symbol === "cut") return { numerator: [], denominator: [], single: "timeSigCutCommon" };
  const digits = (text: string) =>
    [...text.replace(/[^0-9]/g, "")].map((digit) => `timeSig${digit}` as GlyphName);
  return { numerator: digits(time.beats), denominator: digits(time.beatType), single: null };
}

export function timeSignatureWidth(time: TimeChange): number {
  if (time.symbol === "none") return 0;
  const glyphs = timeSignatureGlyphs(time);
  if (glyphs.single) return glyphWidth(glyphs.single);
  const width = (names: GlyphName[]) => names.reduce((total, name) => total + glyphWidth(name), 0);
  return Math.max(width(glyphs.numerator), width(glyphs.denominator));
}

function clefWidth(clef: Clef, change: boolean): number {
  const glyph = clefGlyph(clef, change);
  return glyph ? glyphBox(glyph.glyph).right : 0;
}

/** Where each grace chord's origin sits, left of its main chord, and how far they reach. */
export function graceOffsets(
  graces: PreparedChord[],
  shapes: Map<PreparedChord, ChordShape>,
  mainLeft: number,
): { offsets: Map<PreparedChord, number>; reach: number } {
  const offsets = new Map<PreparedChord, number>();
  let edge = -(mainLeft + GRACE_TO_MAIN_DISTANCE);
  for (const grace of [...graces].reverse()) {
    const shape = shapes.get(grace)!;
    const x = edge - shape.right;
    offsets.set(grace, x);
    edge = x - shape.left - GRACE_TO_GRACE_DISTANCE;
  }
  return { offsets, reach: graces.length ? -(edge + GRACE_TO_GRACE_DISTANCE) : mainLeft };
}

export interface SegmentExtent {
  /** Per staff: how far the segment reaches left and right of its x. */
  left: number[];
  right: number[];
}

export function segmentExtent(
  segment: Segment,
  staffCount: number,
  shapes: Map<PreparedChord, ChordShape>,
): SegmentExtent {
  const left = new Array<number>(staffCount).fill(0);
  const right = new Array<number>(staffCount).fill(0);
  for (const chord of segment.chords) {
    const shape = shapes.get(chord)!;
    if (chord.model.measureRest) continue;
    left[chord.staff] = Math.max(left[chord.staff], shape.left);
    right[chord.staff] = Math.max(right[chord.staff], shape.right);
  }
  for (let staff = 0; staff < staffCount; staff += 1) {
    const graces = segment.graces.filter((chord) => chord.staff === staff);
    if (graces.length) left[staff] = graceOffsets(graces, shapes, left[staff]).reach;
    const clef = segment.clefChanges.find((change) => change.staff === staff);
    if (clef) left[staff] += clefWidth(clef.clef, true) + CHANGE_DISTANCE;
  }
  return { left, right };
}

export interface MeasureSpacing {
  measure: PreparedMeasure;
  /** From the measure's left edge to the first segment, at a system start and elsewhere. */
  start: { systemStart: Gap; inside: Gap };
  /** Between consecutive segments, then from the last segment to the barline. */
  springs: Spring[];
  extents: SegmentExtent[];
  barlineWidth: number;
}

/** The clef, key and time at the start of a system beginning with this measure. */
export function headerWidths(score: PreparedScore, measure: PreparedMeasure): { clef: number; key: number; time: number } {
  const showTime = measure.index === 0 || measure.timeChange !== null;
  return {
    clef: Math.max(0, ...score.staves.map((_, staff) => clefWidth(measure.clefs[staff], false))),
    key: Math.max(0, ...score.staves.map((_, staff) => keySignatureWidth(measure.clefs[staff], measure.fifths[staff]))),
    time: showTime ? timeSignatureWidth(measure.time) : 0,
  };
}

export function headerWidth(score: PreparedScore, measure: PreparedMeasure): number {
  const { clef, key, time } = headerWidths(score, measure);
  let width = CLEF_LEFT_MARGIN + clef;
  if (key > 0) width += CLEF_KEY_DISTANCE + key;
  if (time > 0) width += KEY_TIME_DISTANCE + time;
  return width;
}

/** Key, time and clef changes printed at the start of a measure inside a system. */
export function startChangesWidth(measure: PreparedMeasure): Gap {
  const width: Gap = { hard: 0, padding: 0 };
  const add = (hard: number) => {
    width.hard += hard;
    width.padding += CHANGE_DISTANCE;
  };
  const clefs = measure.startClefChanges.map((change) => clefWidth(change.clef, true));
  if (clefs.length) add(Math.max(...clefs));
  const keys = measure.keyChanges.flatMap((fifths, staff) =>
    fifths === null ? [] : [keySignatureWidth(measure.clefs[staff], fifths)],
  );
  if (keys.some((value) => value > 0)) add(Math.max(...keys));
  if (measure.timeChange && measure.index > 0) add(timeSignatureWidth(measure.timeChange));
  return width;
}

export function barlineWidth(style: string): number {
  if (style === "light-heavy") return BARLINE_WIDTH + BARLINE_SEPARATION + THICK_BARLINE_WIDTH;
  if (style === "light-light") return BARLINE_WIDTH * 2 + BARLINE_SEPARATION;
  return BARLINE_WIDTH;
}

export function measureSpacing(
  score: PreparedScore,
  measure: PreparedMeasure,
  shapes: Map<PreparedChord, ChordShape>,
): MeasureSpacing {
  const staffCount = score.staves.length;
  const extents = measure.segments.map((segment) => segmentExtent(segment, staffCount, shapes));
  const firstLeft = Math.max(0, ...extents[0].left);
  const showTime = measure.index === 0 || measure.timeChange !== null;
  const changes = startChangesWidth(measure);
  const systemStart: Gap = {
    hard: headerWidth(score, measure) + firstLeft,
    padding: showTime ? HEADER_TIME_NOTE_DISTANCE : HEADER_NOTE_DISTANCE,
  };
  const inside: Gap = firstLeft > 0
    ? { hard: changes.hard + firstLeft, padding: changes.padding + BAR_ACCIDENTAL_DISTANCE }
    : { hard: changes.hard, padding: changes.padding + BAR_NOTE_DISTANCE };

  const springs: Spring[] = measure.segments.map((segment, index) => {
    const stretch = segmentStretch(segment);
    const extent = extents[index];
    if (index + 1 < measure.segments.length) {
      const next = extents[index + 1];
      const hard = Math.max(...extent.right.map((right, staff) => right + next.left[staff]));
      return { hard, padding: MIN_NOTE_DISTANCE, stretch };
    }
    return { hard: Math.max(...extent.right), padding: NOTE_BAR_DISTANCE, stretch };
  });
  return {
    measure,
    start: { systemStart, inside },
    springs,
    extents,
    barlineWidth: barlineWidth(measure.barStyle),
  };
}

/** The width of a run of measures starting a system. */
export function systemWidth(spacings: MeasureSpacing[], spacing: Spacing): number {
  return spacings.reduce(
    (total, measure, index) =>
      total +
      gapWidth(index === 0 ? measure.start.systemStart : measure.start.inside, spacing.squeeze) +
      measure.springs.reduce((sum, spring) => sum + springWidth(spring, spacing), 0) +
      measure.barlineWidth,
    0,
  );
}

/** The smallest value in [low, high] for which `wide` holds, by bisection. */
function bisect(low: number, high: number, wide: (value: number) => boolean): number {
  for (let step = 0; step < 50; step += 1) {
    const middle = (low + high) / 2;
    if (wide(middle)) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}

/** The tightest spacing MuseScore would accept for a system. */
export const TIGHTEST_SPACING: Spacing = { force: 0, squeeze: MIN_SQUEEZE };

/**
 * The spacing that makes the measures exactly `width` wide: the force that stretches or
 * compresses the springs, or, when even the tightest springs are too wide, the squeeze
 * that shrinks the padding. Measures too wide even then keep the tightest spacing.
 */
export function justify(spacings: MeasureSpacing[], width: number): Spacing {
  if (systemWidth(spacings, { force: 0, squeeze: 1 }) <= width) {
    let high = NATURAL_SPACING.force;
    while (systemWidth(spacings, { force: high, squeeze: 1 }) < width) high *= 2;
    return { force: bisect(0, high, (force) => systemWidth(spacings, { force, squeeze: 1 }) >= width), squeeze: 1 };
  }
  if (systemWidth(spacings, TIGHTEST_SPACING) >= width) return TIGHTEST_SPACING;
  return { force: 0, squeeze: bisect(MIN_SQUEEZE, 1, (squeeze) => systemWidth(spacings, { force: 0, squeeze }) >= width) };
}

