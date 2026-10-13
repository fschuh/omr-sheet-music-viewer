// Lays out a whole score: chords, spacing, systems, staves and pages, then turns the result
// into what rendering draws. Everything is computed in staff spaces and converted to page
// pixels at the end.
import { glyphBox, glyphAnchor, glyphWidth, ENGRAVING_DEFAULTS, type GlyphName } from "../fonts/smufl";
import { fractionKey } from "../model/fraction";
import type { Bounds, Drawable, LayoutChord, LayoutModel, LayoutNote, LayoutPage, PageFormat } from "../model/layout";
import type { ScoreModel } from "../model/score";
import { beamGroups, layoutBeam, stemDirections, type BeamDrawing, type BeamGroup, type PlacedChord } from "./beams";
import { layoutChord, STEM_WIDTH, type ChordShape } from "./chords";
import {
  BARLINE_SEPARATION,
  BARLINE_WIDTH,
  graceOffsets,
  headerWidths,
  keySignatureWidth,
  gapWidth,
  measureSpacing,
  springWidth,
  THICK_BARLINE_WIDTH,
  timeSignatureGlyphs,
  timeSignatureWidth,
  type MeasureSpacing,
} from "./horizontal";
import { prepareScore, type PreparedChord, type PreparedMeasure, type PreparedScore } from "./measureContent";
import { breakSystems, type SystemPlan } from "./systems";
import { clefGlyph, keySignature, type Clef } from "./staffPosition";

const STAFF_LINE_WIDTH = ENGRAVING_DEFAULTS.staffLineThickness;
const LEDGER_WIDTH = ENGRAVING_DEFAULTS.legerLineThickness;
/** MuseScore's staffDistance and akkoladeDistance, from the bottom of one staff to the top of the next. */
const STAFF_DISTANCE = 6.5;
/** MuseScore's minSystemDistance. */
const SYSTEM_DISTANCE = 8.5;
/** MuseScore's staffUpperBorder: the default space above a page's first system. */
const TOP_SYSTEM_DISTANCE = 7;
const COLLISION_CLEARANCE = 1;
const CLEF_LEFT_MARGIN = 0.75;
const CLEF_KEY_DISTANCE = 0.8;
const KEY_TIME_DISTANCE = 1.0;
const CHANGE_DISTANCE = 0.5;
const KEY_ACCIDENTAL_GAP = 0.1;
const BRACE_DISTANCE = 0.35;
const MEASURE_NUMBER_SIZE = 1.6;

const tenths = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : value / 10;

interface PlacedMeasure {
  spacing: MeasureSpacing;
  left: number;
  segmentX: number[];
  barlineX: number;
}

interface PlacedSystem {
  plan: SystemPlan;
  left: number;
  right: number;
  measures: PlacedMeasure[];
  chords: Map<PreparedChord, number>;
  /** Staff tops relative to the system's top line. */
  staffTops: number[];
  top: number;
  beams: BeamDrawing[];
}

function placeHorizontally(
  plan: SystemPlan,
  spacings: MeasureSpacing[],
  shapes: Map<PreparedChord, ChordShape>,
  left: number,
): Omit<PlacedSystem, "staffTops" | "top" | "beams"> {
  let cursor = left;
  const chords = new Map<PreparedChord, number>();
  const measures = plan.measures.map((index, position): PlacedMeasure => {
    const spacing = spacings[index];
    const measureLeft = cursor;
    const start = gapWidth(position === 0 ? spacing.start.systemStart : spacing.start.inside, plan.spacing.squeeze);
    let x = cursor + start;
    const segmentX: number[] = [];
    for (const spring of spacing.springs) {
      segmentX.push(x);
      x += springWidth(spring, plan.spacing);
    }
    const barlineX = x;
    cursor = barlineX + spacing.barlineWidth;
    const contentLeft = position === 0 ? measureLeft + start - 1 : measureLeft;
    spacing.measure.segments.forEach((segment, segmentIndex) => {
      const segmentLeft = segmentX[segmentIndex];
      for (const chord of segment.chords) {
        if (chord.model.measureRest) {
          const width = shapes.get(chord)!.right;
          chords.set(chord, (contentLeft + barlineX) / 2 - width / 2);
        } else {
          chords.set(chord, segmentLeft);
        }
      }
      for (let staff = 0; staff < spacing.extents[segmentIndex].left.length; staff += 1) {
        const graces = segment.graces.filter((chord) => chord.staff === staff);
        if (graces.length === 0) continue;
        const mainLeft = Math.max(0, ...segment.chords.filter((chord) => chord.staff === staff).map((chord) => shapes.get(chord)!.left));
        for (const [grace, offset] of graceOffsets(graces, shapes, mainLeft).offsets) chords.set(grace, segmentLeft + offset);
      }
    });
    return { spacing, left: measureLeft, segmentX, barlineX };
  });
  return { plan, left, right: cursor, measures, chords };
}

function systemChords(system: Pick<PlacedSystem, "measures">): PreparedChord[] {
  return system.measures.flatMap((measure) =>
    measure.spacing.measure.segments.flatMap((segment) => [...segment.graces, ...segment.chords]),
  );
}

function layoutBeams(
  system: Pick<PlacedSystem, "measures" | "chords" | "staffTops">,
  groups: BeamGroup[][],
  shapes: Map<PreparedChord, ChordShape>,
): BeamDrawing[] {
  return system.measures.flatMap((measure) =>
    groups[measure.spacing.measure.index].map((group) =>
      layoutBeam(group.map((chord): PlacedChord => ({
        chord,
        shape: shapes.get(chord)!,
        x: system.chords.get(chord)!,
        staffTop: system.staffTops[chord.staff],
      }))),
    ),
  );
}

/** How far each staff's content reaches above its top line and below its bottom line. */
function staffReach(
  staffCount: number,
  chords: PreparedChord[],
  shapes: Map<PreparedChord, ChordShape>,
  staffTops: number[],
  beams: BeamDrawing[],
): { above: number[]; below: number[] } {
  const above = new Array<number>(staffCount).fill(0);
  const below = new Array<number>(staffCount).fill(0);
  for (const chord of chords) {
    const shape = shapes.get(chord)!;
    const ys = [shape.top, shape.bottom, ...(shape.stem ? [shape.stem.yEnd] : [])];
    above[chord.staff] = Math.max(above[chord.staff], -Math.min(...ys));
    below[chord.staff] = Math.max(below[chord.staff], Math.max(...ys) - 4);
  }
  for (const beam of beams) {
    for (const segment of beam.segments) {
      for (const y of [segment.y1, segment.y2, segment.y1 + segment.thickness, segment.y2 + segment.thickness]) {
        const staff = staffTops.reduce((best, top, index) => (Math.abs(top + 2 - y) < Math.abs(staffTops[best] + 2 - y) ? index : best), 0);
        above[staff] = Math.max(above[staff], staffTops[staff] - y);
        below[staff] = Math.max(below[staff], y - staffTops[staff] - 4);
      }
    }
  }
  return { above, below };
}

function staffGaps(
  score: ScoreModel,
  prepared: PreparedScore,
  firstMeasure: number,
  reach: { above: number[]; below: number[] } | null,
): number[] {
  const encoded = tenths(score.measures[firstMeasure].staffDistance ?? score.defaults.staffDistance);
  return prepared.staves.slice(1).map((_, index) => {
    if (encoded !== null) return encoded;
    if (!reach) return STAFF_DISTANCE;
    return Math.max(STAFF_DISTANCE, reach.below[index] + reach.above[index + 1] + COLLISION_CLEARANCE);
  });
}

function topsFromGaps(gaps: number[]): number[] {
  const tops = [0];
  for (const gap of gaps) tops.push(tops[tops.length - 1] + 4 + gap);
  return tops;
}

export function layoutScore(score: ScoreModel, format: PageFormat): LayoutModel {
  const prepared = prepareScore(score);
  const staffCount = prepared.staves.length;
  const shapes = new Map<PreparedChord, ChordShape>();
  const groups: BeamGroup[][] = [];
  for (const measure of prepared.measures) {
    const measureGroups = beamGroups(measure);
    groups.push(measureGroups);
    const beamed = new Set(measureGroups.flat());
    const directions = stemDirections(measure, measureGroups);
    for (const segment of measure.segments) {
      for (const chord of [...segment.graces, ...segment.chords]) {
        shapes.set(chord, layoutChord(chord, directions.get(chord) ?? true, beamed.has(chord), measure.duration));
      }
    }
  }
  const spacings = prepared.measures.map((measure) => measureSpacing(prepared, measure, shapes));

  const sp = format.staffSpace;
  const pageWidth = format.width / sp;
  const pageHeight = format.height / sp;
  const margins = {
    left: format.margins.left / sp,
    right: format.margins.right / sp,
    top: format.margins.top / sp,
    bottom: format.margins.bottom / sp,
  };
  const systemMargins = (measureIndex: number) => {
    const layout = score.measures[measureIndex].systemLayout;
    const defaults = score.defaults.systemLayout;
    return {
      left: tenths(layout.leftMargin ?? defaults.leftMargin) ?? 0,
      right: tenths(layout.rightMargin ?? defaults.rightMargin) ?? 0,
    };
  };
  const plans = breakSystems(
    spacings,
    score.measures.map((measure) => measure.newSystem),
    (index) => pageWidth - margins.left - margins.right - systemMargins(index).left - systemMargins(index).right,
  );

  // Systems: horizontal placement, then staves spaced so their content does not collide.
  const systems: PlacedSystem[] = plans.map((plan) => {
    const placed = placeHorizontally(plan, spacings, shapes, margins.left + systemMargins(plan.measures[0]).left);
    const chords = systemChords(placed);
    let staffTops = topsFromGaps(staffGaps(score, prepared, plan.measures[0], null));
    let beams = layoutBeams({ ...placed, staffTops }, groups, shapes);
    staffTops = topsFromGaps(staffGaps(score, prepared, plan.measures[0], staffReach(staffCount, chords, shapes, staffTops, beams)));
    beams = layoutBeams({ ...placed, staffTops }, groups, shapes);
    return { ...placed, staffTops, top: 0, beams };
  });

  // Pages: systems stack down each page and move to a new page when they do not fit.
  const pagesOfSystems: PlacedSystem[][] = [];
  let previousBottom = 0;
  let previousBelow = 0;
  systems.forEach((system, index) => {
    const first = system.plan.measures[0];
    const layout = score.measures[first].systemLayout;
    const defaults = score.defaults.systemLayout;
    const reach = staffReach(staffCount, systemChords(system), shapes, system.staffTops, system.beams);
    const height = system.staffTops[system.staffTops.length - 1] + 4;
    const topDistance = tenths(layout.topSystemDistance ?? defaults.topSystemDistance) ?? Math.max(TOP_SYSTEM_DISTANCE, reach.above[0] + COLLISION_CLEARANCE);
    const systemDistance = tenths(layout.systemDistance ?? defaults.systemDistance) ??
      Math.max(SYSTEM_DISTANCE, previousBelow + reach.above[0] + COLLISION_CLEARANCE);
    const page = pagesOfSystems[pagesOfSystems.length - 1];
    let top = page ? previousBottom + systemDistance : margins.top + topDistance;
    if (!page || (index > 0 && score.measures[first].newPage) || top + height > pageHeight - margins.bottom) {
      top = margins.top + topDistance;
      pagesOfSystems.push([]);
    }
    system.top = top;
    pagesOfSystems[pagesOfSystems.length - 1].push(system);
    previousBottom = top + height;
    previousBelow = reach.below[staffCount - 1];
  });

  const pages = pagesOfSystems.map((pageSystems, pageIndex) =>
    drawPage(pageIndex, pageSystems, { score, prepared, shapes, format, sp, firstSystem: systems[0] }),
  );
  return { format, pages };
}

interface DrawContext {
  score: ScoreModel;
  prepared: PreparedScore;
  shapes: Map<PreparedChord, ChordShape>;
  format: PageFormat;
  sp: number;
  firstSystem: PlacedSystem;
}

function pitchName(step: string, alter: number, octave: number): string {
  const accidental = alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
  return `${step}${accidental}${octave}`;
}

function drawPage(index: number, systems: PlacedSystem[], context: DrawContext): LayoutPage {
  const { sp } = context;
  const items: Drawable[] = [];
  const chords: LayoutChord[] = [];
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
      drawBarline(items, line, context.prepared, measure, staffTop);
      measure.spacing.measure.segments.forEach((segment, segmentIndex) => {
        for (const change of segment.clefChanges) {
          const clef = clefGlyph(change.clef, true);
          if (!clef) continue;
          const x = measure.segmentX[segmentIndex] - measure.spacing.extents[segmentIndex].left[change.staff];
          items.push(glyph(clef.glyph, x, staffTop(change.staff) + clef.y));
        }
      });
    });
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
  };
}

type GlyphMaker = (name: GlyphName, x: number, y: number, scale?: number, scaleY?: number) => Drawable;
type LineMaker = (x1: number, y1: number, x2: number, y2: number, width: number) => Drawable;

function drawKeySignature(items: Drawable[], glyph: GlyphMaker, clef: Clef, fifths: number, x: number, top: number): void {
  let cursor = x;
  for (const { glyph: name, position } of keySignature(clef, fifths)) {
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
  const keyWidths = measure.keyChanges.map((fifths, staff) => (fifths === null ? 0 : keySignatureWidth(measure.clefs[staff], fifths)));
  if (keyWidths.some((width) => width > 0)) {
    measure.keyChanges.forEach((fifths, staff) => {
      if (fifths !== null) drawKeySignature(items, glyph, measure.clefs[staff], fifths, x, staffTop(staff));
    });
    x += Math.max(...keyWidths) + CHANGE_DISTANCE;
  }
  if (measure.timeChange) {
    const width = timeSignatureWidth(measure.timeChange);
    context.prepared.staves.forEach((_, staff) => drawTimeSignature(items, glyph, measure, x, width, staffTop(staff)));
  }
}

function drawBarline(
  items: Drawable[],
  line: LineMaker,
  prepared: PreparedScore,
  placed: PlacedMeasure,
  staffTop: (staff: number) => number,
): void {
  const style = placed.spacing.measure.barStyle;
  const x = placed.barlineX;
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
    if (printed && note.accidental) items.push(glyph(note.accidental.glyph, x + note.accidental.x, top + note.accidental.y, shape.scale));
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
