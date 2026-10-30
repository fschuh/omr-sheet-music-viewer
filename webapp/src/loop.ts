// Loop mode: a run of whole measures that playback repeats. A loop is kept as measure
// positions in the document, never as page pixels, so it survives zoom, scrolling and
// re-layout; this module turns it into what the score overlay draws and decides where
// playback goes next while looping.
import type { PageNoteGeometry } from "./noteGeometry";
import type { LoopBoundaryCommand, PlaybackCommand, PlaybackMoment, PlaybackState } from "./playback";
import type { PerformanceRoute, RouteBarline, StructuralPosition } from "./realtime";

/**
 * Measures by their document position, from 0. Both ends lie on barlines: the loop
 * plays `startMeasure` up to, not including, `endMeasure`, and holds at least one measure.
 */
export interface LoopRegion {
  startMeasure: number;
  endMeasure: number;
}

export type LoopHandle = "start" | "end";

/** What realtime does at a loop's end: start the next pass at once, or count in to it. */
export const LOOP_RESTARTS = ["immediately", "count-in"] as const;
export type LoopRestart = (typeof LOOP_RESTARTS)[number];
export const DEFAULT_LOOP_RESTART: LoopRestart = "immediately";
export const LOOP_RESTART_LABELS: Readonly<Record<LoopRestart, string>> = {
  immediately: "Loop immediately",
  "count-in": "Count in before looping",
};
/** Why counting in before looping cannot be chosen while the count-in is off. */
export const LOOP_COUNT_IN_OFF_HINT =
  "The count-in is off. Choose a count-in under Settings, Playback to count in before looping.";

/**
 * What a loop does at its end: counting in takes the count-in's length, so with the
 * count-in off it loops immediately, keeping the choice for when it is back on.
 */
export function effectiveLoopRestart(restart: LoopRestart, countInOn: boolean): LoopRestart {
  return countInOn ? restart : "immediately";
}

/** A system of the score, where the loop overlay is drawn. Coordinates are page pixels. */
export interface LoopSystem {
  pageIndex: number;
  systemIndex: number;
  top: number;
  bottom: number;
  firstMeasure: number;
  /** Where each measure begins, then where the last one ends. */
  barlines: number[];
}

export function loopSystemMeasureCount(system: LoopSystem): number {
  return system.barlines.length - 1;
}

/** Every system of the document, in measure order. */
export function loopSystems(geometry: readonly PageNoteGeometry[]): LoopSystem[] {
  return geometry
    .flatMap((page) =>
      page.systems
        .filter((system) => system.barlines.length > 1)
        .map((system): LoopSystem => ({
          pageIndex: page.pageIndex,
          systemIndex: system.index,
          top: system.top,
          bottom: system.bottom,
          firstMeasure: system.firstMeasure,
          barlines: system.barlines,
        })),
    )
    .sort((first, second) => first.firstMeasure - second.firstMeasure || first.pageIndex - second.pageIndex);
}

/** How many measures the systems show: one past the last one. */
export function loopMeasureCount(systems: readonly LoopSystem[]): number {
  return Math.max(0, ...systems.map((system) => system.firstMeasure + loopSystemMeasureCount(system)));
}

/** The region kept inside `measureCount` measures and at least one measure long. */
export function clampLoopRegion(region: LoopRegion, measureCount: number): LoopRegion | null {
  if (measureCount < 1) return null;
  const startMeasure = Math.min(measureCount - 1, Math.max(0, Math.round(region.startMeasure)));
  const endMeasure = Math.min(measureCount, Math.max(startMeasure + 1, Math.round(region.endMeasure)));
  return { startMeasure, endMeasure };
}

/** The one-measure loop a new loop starts as, around the measure being played. */
export function loopAroundMeasure(measure: number, measureCount: number): LoopRegion | null {
  return clampLoopRegion({ startMeasure: measure, endMeasure: measure + 1 }, measureCount);
}

export function measureInLoop(measure: number | null | undefined, region: LoopRegion): boolean {
  return measure !== null && measure !== undefined &&
    measure >= region.startMeasure && measure < region.endMeasure;
}

/** "Bar 3" for one measure, "Bars 3–4" for several: printed bar numbers count from 1. */
export function loopLabel(region: LoopRegion): string {
  const first = region.startMeasure + 1;
  const last = region.endMeasure;
  return last === first ? `Bar ${first}` : `Bars ${first}–${last}`;
}

/** The bar a handle stands before (start) or after (end), counted from 1. */
export function loopHandleBar(region: LoopRegion, handle: LoopHandle): number {
  return handle === "start" ? region.startMeasure + 1 : region.endMeasure;
}

/**
 * Where a barline is drawn. A barline that ends one system and begins the next is one
 * boundary: as a loop's start it is drawn where the next system begins, and as its end
 * where the previous system ends.
 */
export function loopBoundaryPlacement(
  systems: readonly LoopSystem[],
  boundary: number,
  side: LoopHandle,
): { system: LoopSystem; x: number } | null {
  const measure = side === "start" ? boundary : boundary - 1;
  const system = systems.find((candidate) =>
    measure >= candidate.firstMeasure &&
    measure < candidate.firstMeasure + loopSystemMeasureCount(candidate),
  );
  return system ? { system, x: system.barlines[boundary - system.firstMeasure] } : null;
}

/** The loop's part of one system. */
export interface LoopSegment {
  system: LoopSystem;
  left: number;
  right: number;
  /** The loop begins here, with the start handle; otherwise it continues from the system before. */
  startsHere: boolean;
  /** The loop ends here, with the end handle; otherwise it continues on the next system. */
  endsHere: boolean;
}

export function loopSegments(systems: readonly LoopSystem[], region: LoopRegion): LoopSegment[] {
  return systems.flatMap((system): LoopSegment[] => {
    const first = system.firstMeasure;
    const end = first + loopSystemMeasureCount(system);
    const from = Math.max(first, region.startMeasure);
    const to = Math.min(end, region.endMeasure);
    if (from >= to) return [];
    return [{
      system,
      left: system.barlines[from - first],
      right: system.barlines[to - first],
      startsHere: from === region.startMeasure,
      endsHere: to === region.endMeasure,
    }];
  });
}

/** The parts of a system outside the loop, as [left, right] spans. */
export function loopDimSpans(system: LoopSystem, region: LoopRegion): Array<[number, number]> {
  const first = system.firstMeasure;
  const count = loopSystemMeasureCount(system);
  const from = Math.min(count, Math.max(0, region.startMeasure - first));
  const to = Math.min(count, Math.max(0, region.endMeasure - first));
  const spans: Array<[number, number]> = [];
  if (from > 0) spans.push([system.barlines[0], system.barlines[from]]);
  if (to < count) spans.push([system.barlines[Math.max(to, from)], system.barlines[count]]);
  return spans.filter(([left, right]) => right > left);
}

/** A system as it lies on screen, for following a dragged handle. */
export interface ScreenLoopSystem {
  /** The top of the system's first staff and the bottom of its last, in screen y. */
  top: number;
  bottom: number;
  firstMeasure: number;
  /** The system's barlines in screen x. */
  barlines: number[];
}

/**
 * The barline a handle dragged to (x, y) snaps to. A handle covers its system's staves
 * and `reach` above and below them, grip and all; the pointer's height picks the system
 * whose handle span it is in or nearest to, the one the handle is on while the pointer is
 * still within its span. Its x then picks the nearest barline on that system. The handle
 * keeps at least one measure between itself and the other handle.
 */
export function draggedLoopRegion(
  region: LoopRegion,
  handle: LoopHandle,
  systems: readonly ScreenLoopSystem[],
  x: number,
  y: number,
  measureCount: number,
  reach: { above: number; below: number },
): LoopRegion {
  const distance = (system: ScreenLoopSystem) =>
    Math.max(0, system.top - reach.above - y, y - (system.bottom + reach.below));
  const boundary = handle === "start" ? region.startMeasure : region.endMeasure;
  const measure = handle === "start" ? boundary : boundary - 1;
  const holding = systems.find((system) =>
    measure >= system.firstMeasure && measure < system.firstMeasure + system.barlines.length - 1,
  );
  let nearestSystem: ScreenLoopSystem | null = holding && distance(holding) === 0 ? holding : null;
  if (!nearestSystem) {
    for (const system of systems) {
      if (!nearestSystem || distance(system) < distance(nearestSystem)) nearestSystem = system;
    }
  }
  if (!nearestSystem) return region;
  let nearest = 0;
  nearestSystem.barlines.forEach((barline, index) => {
    if (Math.abs(barline - x) < Math.abs(nearestSystem!.barlines[nearest] - x)) nearest = index;
  });
  return moveLoopHandleTo(region, handle, nearestSystem.firstMeasure + nearest, measureCount);
}

/** The region with one handle on `boundary`, as close as it may come to the other one. */
export function moveLoopHandleTo(
  region: LoopRegion,
  handle: LoopHandle,
  boundary: number,
  measureCount: number,
): LoopRegion {
  if (handle === "start") {
    const startMeasure = Math.min(region.endMeasure - 1, Math.max(0, boundary));
    return startMeasure === region.startMeasure ? region : { ...region, startMeasure };
  }
  const endMeasure = Math.max(region.startMeasure + 1, Math.min(measureCount, boundary));
  return endMeasure === region.endMeasure ? region : { ...region, endMeasure };
}

/** The region after a shortcut moves one of its ends by a barline, or the same region when it cannot move. */
export function loopRegionAfterCommand(
  region: LoopRegion,
  command: LoopBoundaryCommand,
  measureCount: number,
): LoopRegion {
  const handle: LoopHandle = command === "loopStartEarlier" || command === "loopStartLater" ? "start" : "end";
  const step = command === "loopStartEarlier" || command === "loopEndEarlier" ? -1 : 1;
  const boundary = (handle === "start" ? region.startMeasure : region.endMeasure) + step;
  return moveLoopHandleTo(region, handle, boundary, measureCount);
}

function loopMomentIndexes(timeline: readonly PlaybackMoment[], region: LoopRegion): number[] {
  return timeline.flatMap((moment, index) => (measureInLoop(moment.measureIndex, region) ? [index] : []));
}

const FORWARD_COMMANDS: ReadonlySet<PlaybackCommand> = new Set(["forwardNote", "forwardBar", "forwardPage"]);

/**
 * Note-by-note playback kept inside the loop. A move that would leave it lands on the
 * loop's first moment instead; when it left forwards from inside, that starts the next
 * pass. Playback that starts outside the loop starts on its first moment.
 */
export function loopNoteByNoteState(
  timeline: readonly PlaybackMoment[],
  previous: PlaybackState,
  next: PlaybackState,
  command: PlaybackCommand | null,
  region: LoopRegion | null,
): { state: PlaybackState; nextPass: boolean } {
  if (!region || !next.active) return { state: next, nextPass: false };
  const indexes = loopMomentIndexes(timeline, region);
  if (indexes.length === 0) return { state: next, nextPass: false };
  const current = timeline.find((moment) => moment.id === next.currentMomentId);
  if (current && measureInLoop(current.measureIndex, region)) return { state: next, nextPass: false };
  const first = timeline[indexes[0]];
  const before = timeline.find((moment) => moment.id === previous.currentMomentId);
  const nextPass = previous.active && command !== null && FORWARD_COMMANDS.has(command) &&
    before !== undefined && measureInLoop(before.measureIndex, region);
  return { state: { ...next, currentMomentId: first.id }, nextPass };
}

/** Whether the note-by-note playhead stands inside the loop. */
export function noteByNoteInLoop(moment: PlaybackMoment | null, region: LoopRegion | null): boolean {
  return region !== null && moment !== null && measureInLoop(moment.measureIndex, region);
}

/**
 * Where a structural position falls in a loop's route, which begins at the loop's start:
 * the first time the route plays it, or null when the loop never does.
 */
export function loopRouteOffset(route: PerformanceRoute, position: StructuralPosition): number | null {
  for (const occurrence of route.occurrences) {
    if (occurrence.measureIndex !== position.measureIndex) continue;
    if (position.onset + 1e-6 < occurrence.localStart) continue;
    return Math.min(occurrence.scoreEnd, occurrence.scoreStart + position.onset - occurrence.localStart);
  }
  return null;
}

/**
 * Where a route's playhead is in the score: the measure and the time into it. In the
 * lead-in before the route begins, that is the route's start.
 */
export function routeStructuralPosition(route: PerformanceRoute, routeOffset: number): StructuralPosition | null {
  const offset = Math.max(0, routeOffset);
  const occurrence = route.occurrences.filter((item) => item.scoreStart <= offset + 1e-6).at(-1);
  return occurrence
    ? {
        measureIndex: occurrence.measureIndex,
        onset: occurrence.localStart + Math.max(0, offset - occurrence.scoreStart),
      }
    : null;
}

/**
 * The barline before the first measure a route plays, where its playhead waits through a
 * count-in; none when the route begins inside that measure.
 */
export function routeStartBarline(systems: readonly LoopSystem[], route: PerformanceRoute): RouteBarline | null {
  const first = route.occurrences[0];
  const placement = first && first.localStart === 0
    ? loopBoundaryPlacement(systems, first.measureIndex, "start")
    : null;
  return placement
    ? { pageIndex: placement.system.pageIndex, staffGroupIndex: placement.system.systemIndex, x: placement.x }
    : null;
}

/** The barline after the last measure a route plays, where its playhead stops. */
export function routeEndBarline(systems: readonly LoopSystem[], route: PerformanceRoute): RouteBarline | null {
  const last = route.occurrences.at(-1);
  const placement = last ? loopBoundaryPlacement(systems, last.measureIndex + 1, "end") : null;
  return placement
    ? { pageIndex: placement.system.pageIndex, staffGroupIndex: placement.system.systemIndex, x: placement.x }
    : null;
}
