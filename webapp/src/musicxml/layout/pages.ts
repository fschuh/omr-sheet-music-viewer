// Lays out a whole score: chords, spacing, systems, staves and pages; drawing.ts turns the
// result into what rendering draws. Everything is computed in staff spaces and converted to
// page pixels when drawn.
import type { LayoutModel, PageFormat } from "../model/layout";
import type { ScoreModel } from "../model/score";
import { beamGroups, crossStaffBeamGaps, layoutBeam, stemDirections, type BeamDrawing, type BeamGroup, type PlacedChord } from "./beams";
import { avoidRestCollisions, layoutChord, stackSharedAccidentals, type ChordShape } from "./chords";
import { layoutDirections, type Box } from "./directions";
import { titleBlock } from "./credits";
import { drawPage } from "./drawing";
import { gapWidth, graceOffsets, measureSpacing, springWidth, type MeasureSpacing } from "./horizontal";
import { prepareScore, type PreparedChord, type PreparedScore } from "./measureContent";
import { layoutMarks } from "./marks";
import { chordExtent, layoutSlurs, layoutTies, layoutTuplets, layoutVoltas, mergeSpanners, notePlaces } from "./spanners";
import { breakSystems, type SystemPlan } from "./systems";

/** MuseScore's staffDistance and akkoladeDistance, from the bottom of one staff to the top of the next. */
const STAFF_DISTANCE = 6.5;
/** MuseScore's minSystemDistance. */
const SYSTEM_DISTANCE = 8.5;
/** MuseScore's staffUpperBorder: the default space above a page's first system. */
const TOP_SYSTEM_DISTANCE = 7;
const COLLISION_CLEARANCE = 1;
/** MuseScore's minVerticalDistance: the least room between what two staves reach into their gap. */
const MIN_VERTICAL_DISTANCE = 0.5;
/** MuseScore's skylineMinHorizontalClearance: closer side by side than this, things stack. */
const HORIZONTAL_CLEARANCE = 0.25;

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

/**
 * How far each staff's content reaches above its top line and below its bottom line. A chord
 * beamed across staves counts with its noteheads: its stem runs to the other staff's beam.
 */
function staffReach(
  staffCount: number,
  chords: PreparedChord[],
  shapes: Map<PreparedChord, ChordShape>,
  staffTops: number[],
  beams: BeamDrawing[],
  crossStaff: Set<PreparedChord>,
): { above: number[]; below: number[] } {
  const above = new Array<number>(staffCount).fill(0);
  const below = new Array<number>(staffCount).fill(0);
  for (const chord of chords) {
    const shape = shapes.get(chord)!;
    const ys = crossStaff.has(chord) && shape.notes.length > 0
      ? shape.notes.flatMap((note) => [note.y - 0.5, note.y + 0.5])
      : [shape.top, shape.bottom, ...(shape.stem ? [shape.stem.yEnd] : [])];
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
  reach: { above: number[]; below: number[] } | null,
): number[] {
  // Only the file's default: a distance a measure's print sets is its exporter's spread result
  // for that page, which MuseScore's import also leaves out.
  const encoded = tenths(score.defaults.staffDistance);
  return prepared.staves.slice(1).map((_, index) => {
    if (encoded !== null) return encoded;
    if (!reach) return STAFF_DISTANCE;
    return Math.max(STAFF_DISTANCE, reach.below[index] + reach.above[index + 1] + COLLISION_CLEARANCE);
  });
}

/**
 * What each staff of a system covers, relative to its top line: its chords, and the marks,
 * slurs, tuplets and directions placed against it.
 */
function staffSkylines(
  system: PlacedSystem, boxes: Box[], shapes: Map<PreparedChord, ChordShape>, staffCount: number, crossStaff: Set<PreparedChord>,
): Box[][] {
  const skylines = Array.from({ length: staffCount }, (): Box[] => []);
  const relative = (staff: number, box: Box): Box => {
    const top = system.top + system.staffTops[staff];
    return { x1: box.x1, x2: box.x2, top: box.top - top, bottom: box.bottom - top };
  };
  for (const chord of systemChords(system)) {
    // A chord beamed across staves counts with its notes only: its stem and beam reach the other staff.
    const extent = chordExtent(system, chord, shapes.get(chord)!, !crossStaff.has(chord));
    skylines[chord.staff].push(relative(chord.staff, { x1: extent.left, x2: extent.right, top: extent.top, bottom: extent.bottom }));
  }
  for (const box of boxes) if (box.staff !== undefined) skylines[box.staff].push(relative(box.staff, box));
  return skylines;
}

/**
 * The least distance from one staff's bottom line down to the next staff's top line that
 * keeps what they reach into the gap apart wherever it overlaps side by side, as MuseScore
 * spaces staves by their skylines.
 */
function skylineDistance(upper: Box[], lower: Box[]): number {
  let distance = -Infinity;
  for (const a of upper) {
    for (const b of lower) {
      if (a.x1 < b.x2 + HORIZONTAL_CLEARANCE && b.x1 < a.x2 + HORIZONTAL_CLEARANCE) {
        distance = Math.max(distance, a.bottom - 4 - b.top + MIN_VERTICAL_DISTANCE);
      }
    }
  }
  return distance;
}

/** Chord marks, slurs, tuplets and directions, each kept clear of those placed before it. */
function annotate(
  score: ScoreModel, prepared: PreparedScore, systems: PlacedSystem[], shapes: Map<PreparedChord, ChordShape>, sp: number,
  crossStaff: Set<PreparedChord>,
) {
  const marks = layoutMarks(systems, shapes, sp, crossStaff);
  const slurs = layoutSlurs(systems, shapes, sp, crossStaff);
  const tuplets = layoutTuplets(systems, shapes, sp, crossStaff);
  const taken = new Map(systems.map((system) => [system, [marks.boxes, slurs.boxes, tuplets.boxes].flatMap((boxes) => boxes.get(system) ?? [])]));
  return { marks, slurs, tuplets, directions: layoutDirections(score, prepared, systems, shapes, sp, taken, crossStaff) };
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
      stackSharedAccidentals(segment.chords, shapes);
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

  // Chords beamed across staves, which MuseScore leaves out of the staves' skylines.
  const crossStaff = new Set(groups.flat().filter((group) => new Set(group.map((chord) => chord.staff)).size > 1).flat());
  // Systems: horizontal placement, then staves spaced so their content does not collide.
  const systems: PlacedSystem[] = plans.map((plan) => {
    const placed = placeHorizontally(plan, spacings, shapes, margins.left + systemMargins(plan.measures[0]).left);
    const chords = systemChords(placed);
    let staffTops = topsFromGaps(staffGaps(score, prepared, null));
    let beams = layoutBeams({ ...placed, staffTops }, groups, shapes);
    staffTops = topsFromGaps(staffGaps(score, prepared, staffReach(staffCount, chords, shapes, staffTops, beams, crossStaff)));
    beams = layoutBeams({ ...placed, staffTops }, groups, shapes);
    return { ...placed, staffTops, top: 0, beams };
  });

  // Marks and directions are placed against their own staff, so where they sit relative to
  // it does not depend on the staff's place: placed once here, they show how far apart the
  // staves must be for what each reaches into the gap between them to clear the other's.
  // Chords beamed across staves, which MuseScore leaves out of the staves' skylines.
  const draft = annotate(score, prepared, systems, shapes, sp, crossStaff).directions.boxes;
  const skylines = new Map(systems.map((system) => {
    const skyline = staffSkylines(system, draft.get(system) ?? [], shapes, staffCount, crossStaff);
    const gaps = system.staffTops.slice(1).map((top, index) => top - system.staffTops[index] - 4);
    const beamed = system.plan.measures.flatMap((measure) => groups[measure]).map((group) => crossStaffBeamGaps(group, shapes));
    const needed = gaps.map((gap, index) => Math.max(
      gap, skylineDistance(skyline[index], skyline[index + 1]), ...beamed.map((beam) => beam.get(index) ?? -Infinity),
    ));
    if (needed.some((gap, index) => gap > gaps[index])) {
      system.staffTops = topsFromGaps(needed);
      system.beams = layoutBeams(system, groups, shapes);
    }
    return [system, skyline];
  }));

  const titleHeight = titleBlock(score, format).height / sp;
  // Pages: systems stack down each page and move to a new page when they do not fit at the
  // least distance between them. A distance the file sets is MuseScore's spread result, not a
  // minimum: on a page that cannot hold its systems at those distances, every one gives up the
  // same share of what it has beyond the least, as MuseScore's vertical spread would.
  const pagesOfSystems: { system: PlacedSystem; preferred: number; least: number }[][] = [];
  const pageTops: number[] = [];
  let used = 0;
  // Whether the current page began because the systems before it ran out of room, rather than
  // where the file breaks: the file's layout no longer holds, so its next page break is not
  // kept either, and the systems flow on instead of leaving a page nearly empty.
  let overflowed = false;
  systems.forEach((system, index) => {
    const first = system.plan.measures[0];
    // Only the file's defaults: the distances a measure's print sets are its exporter's spread
    // result for that page, which MuseScore's import also leaves out. They would space a page
    // unevenly once its systems are not those the exporter put there.
    const defaults = score.defaults.systemLayout;
    const reach = staffReach(staffCount, systemChords(system), shapes, system.staffTops, system.beams, crossStaff);
    const skyline = skylines.get(system)!;
    const height = system.staffTops[system.staffTops.length - 1] + 4;
    // The distance from the system before, which another page starts afresh.
    let preferred = 0;
    let least = 0;
    if (index > 0) {
      const previous = systems[index - 1];
      const previousReach = staffReach(staffCount, systemChords(previous), shapes, previous.staffTops, previous.beams, crossStaff);
      const clear = skylineDistance(skylines.get(previous)![staffCount - 1], skyline[0]);
      preferred = Math.max(
        tenths(defaults.systemDistance) ??
          Math.max(SYSTEM_DISTANCE, previousReach.below[staffCount - 1] + reach.above[0] + COLLISION_CLEARANCE),
        clear,
      );
      least = Math.min(preferred, Math.max(SYSTEM_DISTANCE, clear));
    }
    const page = pagesOfSystems[pagesOfSystems.length - 1];
    const fileBreak = score.measures[first].newPage && !overflowed;
    if (!page || fileBreak || used + least + height > pageHeight - margins.bottom) {
      overflowed = Boolean(page) && !fileBreak;
      // The title frame needs room above the first system, whatever distance the file asks for.
      const titleSpace = pagesOfSystems.length === 0 ? titleHeight : 0;
      const above = Math.max(reach.above[0], ...skyline[0].map((box) => -box.top));
      const clearOfTitle = titleSpace + Math.max(TOP_SYSTEM_DISTANCE, above + COLLISION_CLEARANCE);
      const encodedTop = tenths(defaults.topSystemDistance);
      const topDistance = encodedTop === null ? clearOfTitle : titleSpace > 0 ? Math.max(encodedTop, clearOfTitle) : encodedTop;
      pagesOfSystems.push([{ system, preferred: 0, least: 0 }]);
      pageTops.push(margins.top + topDistance);
      used = margins.top + topDistance + height;
    } else {
      page.push({ system, preferred, least });
      used += least + height;
    }
  });
  pagesOfSystems.forEach((page, pageIndex) => {
    const heights = page.reduce((total, { system }) => total + system.staffTops[system.staffTops.length - 1] + 4, 0);
    const least = page.reduce((total, entry) => total + entry.least, 0);
    const slack = page.reduce((total, entry) => total + entry.preferred - entry.least, 0);
    const room = pageHeight - margins.bottom - pageTops[pageIndex] - heights - least;
    const share = slack > 0 ? Math.max(0, Math.min(1, room / slack)) : 0;
    let top = pageTops[pageIndex];
    for (const entry of page) {
      top += entry.least + share * (entry.preferred - entry.least);
      entry.system.top = top;
      top += entry.system.staffTops[entry.system.staffTops.length - 1] + 4;
    }
  });

  const places = notePlaces(systems, shapes);
  const { marks, slurs, tuplets, directions } = annotate(score, prepared, systems, shapes, sp, crossStaff);
  const spanners = mergeSpanners(
    layoutTies(systems, places, sp),
    slurs.drawables,
    tuplets.drawables,
    layoutVoltas(systems, shapes, sp),
    marks.drawables,
    directions.drawables,
  );
  const pages = pagesOfSystems.map((page, pageIndex) =>
    drawPage(pageIndex, page.map((entry) => entry.system), { score, prepared, shapes, format, sp, firstSystem: systems[0], spanners }),
  );
  return { format, pages };
}
