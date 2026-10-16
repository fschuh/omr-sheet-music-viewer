// Lays out a whole score: chords, spacing, systems, staves and pages; drawing.ts turns the
// result into what rendering draws. Everything is computed in staff spaces and converted to
// page pixels when drawn.
import type { LayoutModel, PageFormat } from "../model/layout";
import type { ScoreModel } from "../model/score";
import { beamGroups, layoutBeam, stemDirections, type BeamDrawing, type BeamGroup, type PlacedChord } from "./beams";
import { avoidRestCollisions, layoutChord, type ChordShape } from "./chords";
import { layoutDirections } from "./directions";
import { titleBlock } from "./credits";
import { drawPage } from "./drawing";
import { gapWidth, graceOffsets, measureSpacing, springWidth, type MeasureSpacing } from "./horizontal";
import { prepareScore, type PreparedChord, type PreparedScore } from "./measureContent";
import { layoutMarks } from "./marks";
import { layoutSlurs, layoutTies, layoutTuplets, layoutVoltas, mergeSpanners, notePlaces } from "./spanners";
import { breakSystems, type SystemPlan } from "./systems";

/** MuseScore's staffDistance and akkoladeDistance, from the bottom of one staff to the top of the next. */
const STAFF_DISTANCE = 6.5;
/** MuseScore's minSystemDistance. */
const SYSTEM_DISTANCE = 8.5;
/** MuseScore's staffUpperBorder: the default space above a page's first system. */
const TOP_SYSTEM_DISTANCE = 7;
const COLLISION_CLEARANCE = 1;

const tenths = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : value / 10;

export interface PlacedMeasure {
  spacing: MeasureSpacing;
  left: number;
  segmentX: number[];
  barlineX: number;
}

export interface PlacedSystem {
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
  // Staff lines run on under the courtesy signatures after the last barline.
  const last = measures[measures.length - 1];
  return { plan, left, right: cursor + last.spacing.courtesyWidth, measures, chords };
}

export function systemChords(system: Pick<PlacedSystem, "measures">): PreparedChord[] {
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
      avoidRestCollisions(segment.chords, shapes);
    }
  }
  const spacings = prepared.measures.map((measure, index) =>
    measureSpacing(prepared, measure, shapes, prepared.measures[index + 1]));

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

  const titleHeight = titleBlock(score, format).height / sp;
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
    // The title frame needs room above the first system, whatever distance the file asks for.
    const titleSpace = pagesOfSystems.length === 0 ? titleHeight : 0;
    const clearOfTitle = titleSpace + Math.max(TOP_SYSTEM_DISTANCE, reach.above[0] + COLLISION_CLEARANCE);
    const encodedTop = tenths(layout.topSystemDistance ?? defaults.topSystemDistance);
    const topDistance = encodedTop === null ? clearOfTitle : titleSpace > 0 ? Math.max(encodedTop, clearOfTitle) : encodedTop;
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

  const places = notePlaces(systems, shapes);
  const marks = layoutMarks(systems, shapes, sp);
  const slurs = layoutSlurs(systems, shapes, sp);
  const tuplets = layoutTuplets(systems, shapes, sp);
  // Directions keep clear of the chord marks, slurs and tuplets drawn before them.
  const taken = new Map(systems.map((system) => [system, [marks.boxes, slurs.boxes, tuplets.boxes].flatMap((boxes) => boxes.get(system) ?? [])]));
  const spanners = mergeSpanners(
    layoutTies(systems, places, sp),
    slurs.drawables,
    tuplets.drawables,
    layoutVoltas(systems, shapes, sp),
    marks.drawables,
    layoutDirections(score, prepared, systems, shapes, sp, taken),
  );
  const pages = pagesOfSystems.map((pageSystems, pageIndex) =>
    drawPage(pageIndex, pageSystems, { score, prepared, shapes, format, sp, firstSystem: systems[0], spanners }),
  );
  return { format, pages };
}
