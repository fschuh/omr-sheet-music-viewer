// Turns placed systems into what rendering draws: staves, headers, barlines, beams and
// chords, converted from staff spaces to page pixels.
import { glyphBox, glyphAnchor, glyphWidth, ENGRAVING_DEFAULTS, type GlyphName } from "../fonts/smufl";
import { fractionKey } from "../model/fraction";
import type { Bounds, Drawable, LayoutChord, LayoutNote, LayoutPage, LayoutSystem, PageFormat } from "../model/layout";
import type { ScoreModel } from "../model/score";
import { STEM_WIDTH, type ChordShape } from "./chords";
import { pageCredits, titleBlock } from "./credits";
import {
  BARLINE_SEPARATION,
  BARLINE_WIDTH,
  headerWidth,
  headerWidths,
  REPEAT_DOTS_WIDTH,
  START_REPEAT_HEADER_DISTANCE,
  startRepeatOffset,
  keySignatureWidth,
  THICK_BARLINE_WIDTH,
  timeSignatureGlyphs,
  timeSignatureWidth,
} from "./horizontal";
import type { PreparedChord, PreparedMeasure, PreparedScore } from "./measureContent";
import { systemChords, type PlacedMeasure, type PlacedSystem } from "./pages";
import { clefGlyph, keyCancellation, keySignature, type Clef } from "./staffPosition";

const STAFF_LINE_WIDTH = ENGRAVING_DEFAULTS.staffLineThickness;
const LEDGER_WIDTH = ENGRAVING_DEFAULTS.legerLineThickness;
const CLEF_LEFT_MARGIN = 0.75;
const CLEF_KEY_DISTANCE = 0.8;
const KEY_TIME_DISTANCE = 1.0;
const CHANGE_DISTANCE = 0.5;
const KEY_ACCIDENTAL_GAP = 0.1;
const BRACE_DISTANCE = 0.35;
const MEASURE_NUMBER_SIZE = 1.6;
const COURTESY_DISTANCE = 0.5;

export interface DrawContext {
  score: ScoreModel;
  prepared: PreparedScore;
  shapes: Map<PreparedChord, ChordShape>;
  format: PageFormat;
  sp: number;
  firstSystem: PlacedSystem;
  /** Ties and other spanners, by the system they are drawn in. */
  spanners: Map<PlacedSystem, Drawable[]>;
}

function pitchName(step: string, alter: number, octave: number): string {
  const accidental = alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
  return `${step}${accidental}${octave}`;
}

export function drawPage(index: number, systems: PlacedSystem[], context: DrawContext): LayoutPage {
  const { sp } = context;
  const items: Drawable[] = [
    ...(index === 0 ? titleBlock(context.score, context.format).items : []),
    ...pageCredits(context.score, index, context.format),
  ];
  const chords: LayoutChord[] = [];
  const layoutSystems: LayoutSystem[] = [];
  // Drawing works in staff spaces; these convert to page pixels.
  const glyph = (name: GlyphName, x: number, y: number, scale = 1, scaleY?: number): Drawable => ({
    kind: "glyph", glyph: name, x: x * sp, y: y * sp, scale, ...(scaleY === undefined ? {} : { scaleY }),
  });
  const line = (x1: number, y1: number, x2: number, y2: number, width: number): Drawable => ({
    kind: "line", x1: x1 * sp, y1: y1 * sp, x2: x2 * sp, y2: y2 * sp, width: width * sp,
  });

  systems.forEach((system, systemIndex) => {
    const staffTop = (staff: number) => system.top + system.staffTops[staff];
    const first = system.measures[0].spacing.measure;
    const lastStaff = system.staffTops.length - 1;
    // A measure ends at the middle of its barline, where the next one begins.
    const measureEnds = system.measures.map((measure) => (measure.barlineX + measure.spacing.barlineWidth / 2) * sp);
    layoutSystems.push({
      top: staffTop(0) * sp,
      bottom: (staffTop(lastStaff) + 4) * sp,
      firstMeasure: system.plan.measures[0],
      barlines: [system.left * sp, ...measureEnds],
    });

    for (let staff = 0; staff <= lastStaff; staff += 1) {
      for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
        items.push(line(system.left, staffTop(staff) + lineIndex, system.right, staffTop(staff) + lineIndex, STAFF_LINE_WIDTH));
      }
    }
    if (lastStaff > 0) {
      items.push(line(system.left + BARLINE_WIDTH / 2, staffTop(0), system.left + BARLINE_WIDTH / 2, staffTop(lastStaff) + 4, BARLINE_WIDTH));
    }
    for (const staves of context.prepared.partStaves) {
      if (staves.length < 2) continue;
      const top = staffTop(staves[0]);
      const bottom = staffTop(staves[staves.length - 1]) + 4;
      const braceWidth = glyphWidth("brace");
      items.push(glyph("brace", system.left - BRACE_DISTANCE - braceWidth, bottom, 1, (bottom - top) / 4));
    }
    if (system !== context.firstSystem) {
      items.push({
        kind: "text",
        text: first.number,
        x: system.left * sp,
        y: (staffTop(0) - 2) * sp,
        size: MEASURE_NUMBER_SIZE * sp,
        anchor: "start",
      });
    }

    drawHeader(items, glyph, context, first, system.left, staffTop);
    system.measures.forEach((measure, position) => {
      if (position > 0) drawStartChanges(items, glyph, context, measure, staffTop);
      if (measure.spacing.measure.startRepeat) {
        const x = position === 0
          ? system.left + headerWidth(context.prepared, measure.spacing.measure) + START_REPEAT_HEADER_DISTANCE
          : measure.left + startRepeatOffset(measure.spacing.measure);
        drawStartRepeat(items, glyph, line, context.prepared, x, staffTop);
      }
      drawBarline(items, glyph, line, context.prepared, measure, staffTop);
      if (position === system.measures.length - 1 && measure.spacing.courtesyWidth > 0) {
        const next = context.prepared.measures[measure.spacing.measure.index + 1];
        if (next) drawCourtesy(items, glyph, context, next, measure.barlineX + measure.spacing.barlineWidth, staffTop);
      }
      measure.spacing.measure.segments.forEach((segment, segmentIndex) => {
        for (const change of segment.clefChanges) {
          const clef = clefGlyph(change.clef, true);
          if (!clef) continue;
          const x = measure.segmentX[segmentIndex] - measure.spacing.extents[segmentIndex].left[change.staff];
          items.push(glyph(clef.glyph, x, staffTop(change.staff) + clef.y));
        }
      });
    });
    items.push(...(context.spanners.get(system) ?? []));
    for (const beam of system.beams) {
      for (const segment of beam.segments) {
        items.push({
          kind: "polygon",
          points: [
            segment.x1, segment.y1, segment.x2, segment.y2,
            segment.x2, segment.y2 + segment.thickness, segment.x1, segment.y1 + segment.thickness,
          ].map((value, pointIndex) => (pointIndex % 2 === 0 ? value : value + system.top) * sp),
        });
      }
    }
    for (const chord of systemChords(system)) {
      const drawn = drawChord(chord, context.shapes.get(chord)!, system.chords.get(chord)!, staffTop(chord.staff), systemIndex, glyph, line, sp);
      if (drawn.chord) chords.push(drawn.chord);
      items.push(...drawn.items);
    }
  });
  return {
    index,
    firstMeasure: systems[0].plan.measures[0],
    width: context.format.width,
    height: context.format.height,
    staffSpace: sp,
    items,
    chords,
    systems: layoutSystems,
  };
}

type GlyphMaker = (name: GlyphName, x: number, y: number, scale?: number, scaleY?: number) => Drawable;
type LineMaker = (x1: number, y1: number, x2: number, y2: number, width: number) => Drawable;

function drawKeySignature(items: Drawable[], glyph: GlyphMaker, clef: Clef, fifths: number, x: number, top: number, previousFifths = 0): void {
  let cursor = x;
  for (const { glyph: name, position } of [...keyCancellation(clef, previousFifths, fifths), ...keySignature(clef, fifths)]) {
    items.push(glyph(name, cursor, top + position / 2));
    cursor += glyphWidth(name) + KEY_ACCIDENTAL_GAP;
  }
}

function drawTimeSignature(items: Drawable[], glyph: GlyphMaker, measure: PreparedMeasure, x: number, width: number, top: number): void {
  const time = measure.timeChange ?? measure.time;
  if (time.symbol === "none") return;
  const glyphs = timeSignatureGlyphs(time);
  if (glyphs.single) {
    items.push(glyph(glyphs.single, x + (width - glyphWidth(glyphs.single)) / 2, top + 2));
    return;
  }
  const row = (names: GlyphName[], y: number) => {
    const rowWidth = names.reduce((total, name) => total + glyphWidth(name), 0);
    let cursor = x + (width - rowWidth) / 2;
    for (const name of names) {
      items.push(glyph(name, cursor, y));
      cursor += glyphWidth(name);
    }
  };
  row(glyphs.numerator, top + 1);
  row(glyphs.denominator, top + 3);
}

function drawHeader(
  items: Drawable[],
  glyph: GlyphMaker,
  context: DrawContext,
  measure: PreparedMeasure,
  left: number,
  staffTop: (staff: number) => number,
): void {
  const widths = headerWidths(context.prepared, measure);
  const clefX = left + CLEF_LEFT_MARGIN;
  const keyX = clefX + widths.clef + CLEF_KEY_DISTANCE;
  const timeX = (widths.key > 0 ? keyX + widths.key : clefX + widths.clef) + KEY_TIME_DISTANCE;
  context.prepared.staves.forEach((_, staff) => {
    const top = staffTop(staff);
    const clef = clefGlyph(measure.clefs[staff], false);
    if (clef) items.push(glyph(clef.glyph, clefX, top + clef.y));
    drawKeySignature(items, glyph, measure.clefs[staff], measure.fifths[staff], keyX, top);
    if (widths.time > 0) drawTimeSignature(items, glyph, measure, timeX, widths.time, top);
  });
}

function drawStartChanges(
  items: Drawable[],
  glyph: GlyphMaker,
  context: DrawContext,
  placed: PlacedMeasure,
  staffTop: (staff: number) => number,
): void {
  const measure = placed.spacing.measure;
  let x = placed.left + BARLINE_WIDTH + CHANGE_DISTANCE;
  if (measure.startClefChanges.length) {
    let width = 0;
    for (const change of measure.startClefChanges) {
      const clef = clefGlyph(change.clef, true);
      if (!clef) continue;
      items.push(glyph(clef.glyph, x, staffTop(change.staff) + clef.y));
      width = Math.max(width, glyphBox(clef.glyph).right);
    }
    x += width + CHANGE_DISTANCE;
  }
  const keyWidths = measure.keyChanges.map((fifths, staff) =>
    fifths === null ? 0 : keySignatureWidth(measure.clefs[staff], fifths, measure.previousFifths[staff]));
  if (keyWidths.some((width) => width > 0)) {
    measure.keyChanges.forEach((fifths, staff) => {
      if (fifths !== null) drawKeySignature(items, glyph, measure.clefs[staff], fifths, x, staffTop(staff), measure.previousFifths[staff]);
    });
    x += Math.max(...keyWidths) + CHANGE_DISTANCE;
  }
  if (measure.timeChange) {
    const width = timeSignatureWidth(measure.timeChange);
    context.prepared.staves.forEach((_, staff) => drawTimeSignature(items, glyph, measure, x, width, staffTop(staff)));
  }
}

/** Courtesy key and time signatures at the end of a system, announcing the next one's. */
function drawCourtesy(
  items: Drawable[],
  glyph: GlyphMaker,
  context: DrawContext,
  next: PreparedMeasure,
  x: number,
  staffTop: (staff: number) => number,
): void {
  let cursor = x + COURTESY_DISTANCE;
  const keyWidths = next.keyChanges.map((fifths, staff) =>
    fifths === null ? 0 : keySignatureWidth(next.clefs[staff], fifths, next.previousFifths[staff]));
  if (keyWidths.some((width) => width > 0)) {
    next.keyChanges.forEach((fifths, staff) => {
      if (fifths !== null) drawKeySignature(items, glyph, next.clefs[staff], fifths, cursor, staffTop(staff), next.previousFifths[staff]);
    });
    cursor += Math.max(...keyWidths) + COURTESY_DISTANCE;
  }
  if (next.timeChange && next.index > 0) {
    const width = timeSignatureWidth(next.timeChange);
    context.prepared.staves.forEach((_, staff) => drawTimeSignature(items, glyph, next, cursor, width, staffTop(staff)));
  }
}

/** A start-repeat sign at `x`: thick line, thin line, then dots on every staff. */
function drawStartRepeat(
  items: Drawable[],
  glyph: GlyphMaker,
  line: LineMaker,
  prepared: PreparedScore,
  x: number,
  staffTop: (staff: number) => number,
): void {
  const thinX = x + THICK_BARLINE_WIDTH + BARLINE_SEPARATION + BARLINE_WIDTH / 2;
  for (const staves of prepared.partStaves) {
    const top = staffTop(staves[0]);
    const bottom = staffTop(staves[staves.length - 1]) + 4;
    items.push(line(x + THICK_BARLINE_WIDTH / 2, top, x + THICK_BARLINE_WIDTH / 2, bottom, THICK_BARLINE_WIDTH));
    items.push(line(thinX, top, thinX, bottom, BARLINE_WIDTH));
  }
  prepared.staves.forEach((_, staff) => {
    items.push(glyph("repeatDots", thinX + BARLINE_WIDTH / 2 + BARLINE_SEPARATION, staffTop(staff) + 4));
  });
}

function drawBarline(
  items: Drawable[],
  glyph: GlyphMaker,
  line: LineMaker,
  prepared: PreparedScore,
  placed: PlacedMeasure,
  staffTop: (staff: number) => number,
): void {
  const style = placed.spacing.measure.barStyle;
  let x = placed.barlineX;
  if (placed.spacing.measure.endRepeat) {
    prepared.staves.forEach((_, staff) => items.push(glyph("repeatDots", x, staffTop(staff) + 4)));
    x += REPEAT_DOTS_WIDTH + BARLINE_SEPARATION;
  }
  for (const staves of prepared.partStaves) {
    const top = staffTop(staves[0]);
    const bottom = staffTop(staves[staves.length - 1]) + 4;
    if (style === "light-heavy") {
      items.push(line(x + BARLINE_WIDTH / 2, top, x + BARLINE_WIDTH / 2, bottom, BARLINE_WIDTH));
      const thickX = x + BARLINE_WIDTH + BARLINE_SEPARATION + THICK_BARLINE_WIDTH / 2;
      items.push(line(thickX, top, thickX, bottom, THICK_BARLINE_WIDTH));
    } else if (style === "light-light") {
      items.push(line(x + BARLINE_WIDTH / 2, top, x + BARLINE_WIDTH / 2, bottom, BARLINE_WIDTH));
      const secondX = x + BARLINE_WIDTH * 1.5 + BARLINE_SEPARATION;
      items.push(line(secondX, top, secondX, bottom, BARLINE_WIDTH));
    } else {
      items.push(line(x + BARLINE_WIDTH / 2, top, x + BARLINE_WIDTH / 2, bottom, BARLINE_WIDTH));
    }
  }
}

function unionBounds(bounds: Bounds[]): Bounds {
  return [
    Math.min(...bounds.map((value) => value[0])),
    Math.min(...bounds.map((value) => value[1])),
    Math.max(...bounds.map((value) => value[2])),
    Math.max(...bounds.map((value) => value[3])),
  ];
}

function drawChord(
  chord: PreparedChord,
  shape: ChordShape,
  x: number,
  top: number,
  systemIndex: number,
  glyph: GlyphMaker,
  line: LineMaker,
  sp: number,
): { chord: LayoutChord | null; items: Drawable[] } {
  const model = chord.model;
  const printed = model.printed;
  const shared: Drawable[] = [];
  const dotsOf = (note: number) =>
    shape.dots.filter((dot) => dot.note === note).map((dot) => glyph("augmentationDot", x + dot.x, top + dot.y, shape.scale));
  if (shape.rest) {
    return { chord: null, items: printed ? [glyph(shape.rest.glyph, x + shape.rest.x, top + shape.rest.y, shape.scale), ...dotsOf(-1)] : [] };
  }
  if (printed) {
    for (const ledger of shape.ledgers) shared.push(line(x + ledger.x1, top + ledger.y, x + ledger.x2, top + ledger.y, LEDGER_WIDTH));
  }
  const chordItems: Drawable[] = [];
  let stemBounds: Bounds | null = null;
  if (shape.stem) {
    const stemX = x + shape.stem.x;
    const y1 = top + shape.stem.yStart;
    const y2 = top + shape.stem.yEnd;
    const width = STEM_WIDTH * shape.scale;
    stemBounds = [(stemX - width / 2) * sp, Math.min(y1, y2) * sp, (stemX + width / 2) * sp, Math.max(y1, y2) * sp];
    chordItems.push(line(stemX, y1, stemX, y2, width));
    if (shape.flag) {
      const anchor = glyphAnchor(shape.flag, shape.stem.up ? "stemUpNW" : "stemDownSW") ?? [0, 0];
      chordItems.push(glyph(shape.flag, stemX - width / 2 - anchor[0] * shape.scale, y2 - anchor[1] * shape.scale, shape.scale));
    }
    if (model.grace?.slash) {
      const direction = shape.stem.up ? 1 : -1;
      chordItems.push(line(stemX - 0.6 * shape.scale, y2 + direction * 1.6 * shape.scale, stemX + 0.8 * shape.scale, y2 + direction * 0.6 * shape.scale, 0.12));
    }
  }
  const momentId = model.grace ? model.id : `m${chord.measureIndex + 1}-t${fractionKey(model.onset)}`;
  const notes: LayoutNote[] = shape.notes.map((note) => {
    const noteModel = model.notes[note.index];
    const box = glyphBox(note.head);
    const headX = x + note.x;
    const headY = top + note.y;
    const headBounds: Bounds = [
      (headX + box.left * shape.scale) * sp,
      (headY + box.top * shape.scale) * sp,
      (headX + box.right * shape.scale) * sp,
      (headY + box.bottom * shape.scale) * sp,
    ];
    const items: Drawable[] = printed ? [glyph(note.head, headX, headY, shape.scale)] : [];
    if (printed && note.accidental) {
      const { glyph: name, x: accidentalX, y: accidentalY, parentheses } = note.accidental;
      items.push(glyph(name, x + accidentalX, top + accidentalY, shape.scale));
      if (parentheses) {
        items.push(glyph("accidentalParensLeft", x + accidentalX - glyphWidth("accidentalParensLeft") * shape.scale, top + accidentalY, shape.scale));
        items.push(glyph("accidentalParensRight", x + accidentalX + glyphWidth(name) * shape.scale, top + accidentalY, shape.scale));
      }
    }
    if (printed) items.push(...dotsOf(note.index));
    return {
      key: noteModel.key,
      pitch: noteModel.unpitched ? null : pitchName(noteModel.step, noteModel.alter, noteModel.octave),
      grace: model.grace !== null,
      measure: chord.measureIndex + 1,
      center: [(headBounds[0] + headBounds[2]) / 2, headY * sp],
      headBounds,
      items,
    };
  });
  return {
    chord: {
      id: model.id,
      systemIndex,
      momentId,
      notes,
      items: printed ? chordItems : [],
      stemBounds: stemBounds ? unionBounds([stemBounds, ...notes.map((note) => note.headBounds)]) : null,
    },
    items: shared,
  };
}

