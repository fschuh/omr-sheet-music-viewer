// Turns recognized PDF pages into note geometry and score facts. This is the only
// place outside PDF-specific UI that reads homr's visual sidecar.
import type {
  Bounds,
  GeometryNote,
  NoteheadGeometry,
  PageNoteGeometry,
  SystemGeometry,
} from "./noteGeometry";
import {
  emptyNoteScoreFacts,
  mergeNoteScoreFacts,
  noteScoreFacts,
  type NoteScoreFacts,
} from "./playback";
import { parseRealtimeMusicXml, type RealtimeScore } from "./realtime";
import type { DocumentPage, VisualGroup, VisualPoint, VisualSidecar, VisualSidecarNote } from "./types";
import { isLinkedVisualGroup } from "./types";

function pointBounds(points: VisualPoint[]): Bounds | null {
  if (points.length === 0) return null;
  let left = points[0][0];
  let top = points[0][1];
  let right = left;
  let bottom = top;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pitch labels are sorted by their anchors, and noteheads on one staff line share a y
 * exactly, so the notehead box keeps the arithmetic labels have always used: each shape
 * as origin and size, the union's far edges as origin plus size. Equivalent formulas
 * differ in the last bits and would reorder those labels.
 */
function unionRects(rects: Rect[]): Bounds | null {
  if (rects.length === 0) return null;
  return [
    Math.min(...rects.map((rect) => rect.x)),
    Math.min(...rects.map((rect) => rect.y)),
    Math.max(...rects.map((rect) => rect.x + rect.width)),
    Math.max(...rects.map((rect) => rect.y + rect.height)),
  ];
}

/** The fitted notehead ellipses, rotated; traced outlines when no ellipse was fitted. */
function noteheadBounds(group: VisualGroup): Bounds {
  const ellipses = (group.notehead_ellipses ?? []).map((ellipse): Rect => {
    const angle = (ellipse.angle * Math.PI) / 180;
    const halfWidth = Math.sqrt(
      (ellipse.rx * Math.cos(angle)) ** 2 + (ellipse.ry * Math.sin(angle)) ** 2,
    );
    const halfHeight = Math.sqrt(
      (ellipse.rx * Math.sin(angle)) ** 2 + (ellipse.ry * Math.cos(angle)) ** 2,
    );
    return {
      x: ellipse.center[0] - halfWidth,
      y: ellipse.center[1] - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
    };
  });
  const outlines = group.notehead_contours
    .map(pointBounds)
    .filter((value): value is Bounds => value !== null)
    .map(([left, top, right, bottom]): Rect => ({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }));
  const noteheads = unionRects(ellipses.length > 0 ? ellipses : outlines);
  if (noteheads) return noteheads;
  if (group.bbox.length === 4) return [...group.bbox] as Bounds;
  return [group.center[0] - 5, group.center[1] - 5, group.center[0] + 5, group.center[1] + 5];
}

function noteheadGeometry(group: VisualGroup): NoteheadGeometry {
  const notehead = noteheadBounds(group);
  return {
    id: group.visual_group_id,
    systemIndex: group.staff_group_index,
    center: group.center,
    noteheadBounds: notehead,
    // Clicks select by the traced outlines, which are what the page image shows.
    hitAreas: group.notehead_contours
      .map(pointBounds)
      .filter((value): value is Bounds => value !== null),
    // homr gives every group a box; one without falls back to its notehead.
    bounds: group.bbox.length === 4 ? ([...group.bbox] as Bounds) : notehead,
    chordId: group.chord_id,
    momentId: group.moment_id,
  };
}

function isGraceNote(note: VisualSidecarNote): boolean {
  return note.duration.startsWith("note_") && note.duration.includes("G");
}

const geometryCache = new WeakMap<VisualSidecar, Map<string, PageNoteGeometry>>();

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** homr counts staff positions in half spaces, upwards from 1 on the bottom line. */
const BOTTOM_LINE_POSITION = 1;
const TOP_LINE_POSITION = 9;

interface MeasureEvidence {
  /** Page-local, from 1. */
  measure: number;
  left: number;
  right: number;
}

interface StaffEvidence {
  staff: number;
  position: number;
  y: number;
}

interface SystemEvidence {
  index: number;
  measures: MeasureEvidence[];
  staffPoints: StaffEvidence[];
  /** Line heights of rests on the system, by physical staff, top to bottom. */
  restLines: Map<number, number[][]>;
  noteheadTop: number;
  noteheadBottom: number;
}

/**
 * Half a staff space, in page pixels: the fall in y per staff position, fitted to every
 * notehead of the page with each staff free to sit at its own height.
 */
function halfSpace(systems: readonly SystemEvidence[], fallback: number): number {
  let covariance = 0;
  let variance = 0;
  for (const system of systems) {
    const byStaff = new Map<number, StaffEvidence[]>();
    for (const point of system.staffPoints) {
      byStaff.set(point.staff, [...(byStaff.get(point.staff) ?? []), point]);
    }
    for (const points of byStaff.values()) {
      const meanPosition = points.reduce((total, point) => total + point.position, 0) / points.length;
      const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
      for (const point of points) {
        covariance += (point.position - meanPosition) * (point.y - meanY);
        variance += (point.position - meanPosition) ** 2;
      }
    }
  }
  const fitted = variance > 0 ? -covariance / variance : 0;
  return fitted > 0 ? fitted : fallback;
}

/** The y of a staff line at `linePosition`, from a rest's measured lines or the fitted noteheads. */
function staffLineY(
  system: SystemEvidence,
  staff: number,
  lineIndex: number,
  linePosition: number,
  half: number,
): number | null {
  const measured = median((system.restLines.get(staff) ?? []).map((lines) => lines[lineIndex]));
  if (measured !== null) return measured;
  const zero = median(
    system.staffPoints
      .filter((point) => point.staff === staff)
      .map((point) => point.y + point.position * half),
  );
  return zero === null ? null : zero - linePosition * half;
}

/**
 * Boundaries of `count` measures between `left` and `right`, from where each measure's
 * notes and rests lie: halfway across the gap between two measures that both have some,
 * and spread evenly over the gap a run of measures without any must fit in.
 */
function measureBoundaries(
  ranges: ReadonlyArray<{ left: number; right: number } | null>,
  left: number,
  right: number,
): number[] {
  const count = ranges.length;
  const boundaries = new Array<number>(count + 1);
  boundaries[0] = left;
  boundaries[count] = right;
  const known = ranges.flatMap((range, index) => (range ? [index] : []));
  // Each stretch of unknown boundaries lies between two edges: [from, to] in x.
  const fill = (firstBoundary: number, lastBoundary: number, from: number, to: number) => {
    const steps = lastBoundary - firstBoundary + 2;
    for (let boundary = firstBoundary; boundary <= lastBoundary; boundary += 1) {
      boundaries[boundary] = from + ((to - from) * (boundary - firstBoundary + 1)) / steps;
    }
  };
  if (known.length === 0) {
    fill(1, count - 1, left, right);
  } else {
    fill(1, known[0], left, ranges[known[0]]!.left);
    for (let position = 1; position < known.length; position += 1) {
      const previous = known[position - 1];
      const next = known[position];
      fill(previous + 1, next, ranges[previous]!.right, ranges[next]!.left);
    }
    const last = known[known.length - 1];
    fill(last + 1, count - 1, ranges[last]!.right, right);
  }
  // Misread measure numbers can cross; barlines never do.
  for (let index = 1; index <= count; index += 1) {
    boundaries[index] = Math.max(boundaries[index], boundaries[index - 1]);
  }
  return boundaries;
}

/**
 * The page's systems, estimated from what homr placed on it: the sidecar has no staff
 * lines or barlines, so staves are fitted to the noteheads' staff positions (or taken
 * from rests, which carry their staff's lines), and each barline is put between the
 * notes and rests of the measures on either side of it.
 */
function sidecarSystems(
  sidecar: VisualSidecar,
  noteheads: readonly NoteheadGeometry[],
  notes: readonly GeometryNote[],
  measureOffset: number,
  measureCount: number | undefined,
): SystemGeometry[] {
  const groups = new Map(sidecar.visual_groups.map((group) => [group.visual_group_id, group]));
  const measureByNotehead = new Map<string, number>();
  for (const note of notes) {
    const current = measureByNotehead.get(note.noteheadId);
    if (current === undefined || note.measure < current) measureByNotehead.set(note.noteheadId, note.measure);
  }
  const bySystem = new Map<number, SystemEvidence>();
  const systemFor = (index: number) => {
    let system = bySystem.get(index);
    if (!system) {
      system = {
        index,
        measures: [],
        staffPoints: [],
        restLines: new Map(),
        noteheadTop: Infinity,
        noteheadBottom: -Infinity,
      };
      bySystem.set(index, system);
    }
    return system;
  };
  const heights: number[] = [];
  for (const notehead of noteheads) {
    const system = systemFor(notehead.systemIndex);
    const [left, top, right, bottom] = notehead.noteheadBounds;
    heights.push(bottom - top);
    system.noteheadTop = Math.min(system.noteheadTop, top);
    system.noteheadBottom = Math.max(system.noteheadBottom, bottom);
    const measure = measureByNotehead.get(notehead.id);
    if (measure !== undefined) system.measures.push({ measure, left, right });
    const group = groups.get(notehead.id);
    if (group) {
      system.staffPoints.push({
        staff: group.staff_index,
        position: group.staff_position,
        y: notehead.center[1],
      });
    }
  }
  const restUnits: number[] = [];
  for (const rest of sidecar.rest_verification?.rests ?? []) {
    if (rest.staff_group_index === null || !rest.center) continue;
    const system = systemFor(rest.staff_group_index);
    const unit = rest.unit_size ?? median(heights) ?? 20;
    if (rest.unit_size) restUnits.push(rest.unit_size);
    system.measures.push({
      measure: rest.measure,
      left: rest.center[0] - unit * 0.6,
      right: rest.center[0] + unit * 0.6,
    });
    if (rest.staff_index !== null && rest.staff_lines.length === 5) {
      system.restLines.set(rest.staff_index, [...(system.restLines.get(rest.staff_index) ?? []), rest.staff_lines]);
    }
  }
  const systems = [...bySystem.values()]
    .filter((system) => system.measures.length > 0)
    .sort((first, second) => first.index - second.index);
  if (systems.length === 0) return [];
  const half = halfSpace(systems, (median(restUnits) ?? median(heights) ?? 20) / 2);
  const unit = half * 2;
  const lastMeasure = Math.max(
    measureCount ?? 0,
    ...systems.flatMap((system) => system.measures.map((evidence) => evidence.measure)),
  );

  // Each system takes the measures from its lowest one up to where the next system starts,
  // so the page's measures are all placed, once and in order, despite a misread number.
  const firsts: number[] = [];
  systems.forEach((system, position) => {
    const lowest = Math.min(...system.measures.map((evidence) => evidence.measure));
    firsts.push(position === 0 ? 1 : Math.min(lastMeasure, Math.max(lowest, firsts[position - 1] + 1)));
  });
  return systems.flatMap((system, position): SystemGeometry[] => {
    const first = firsts[position];
    const last = position + 1 < systems.length ? firsts[position + 1] - 1 : lastMeasure;
    if (last < first) return [];
    const ranges = Array.from({ length: last - first + 1 }, (_, offset) => {
      const inMeasure = system.measures.filter((evidence) => evidence.measure === first + offset);
      return inMeasure.length === 0
        ? null
        : {
            left: Math.min(...inMeasure.map((evidence) => evidence.left)),
            right: Math.max(...inMeasure.map((evidence) => evidence.right)),
          };
    });
    const left = Math.min(...system.measures.map((evidence) => evidence.left)) - unit;
    const right = Math.max(...system.measures.map((evidence) => evidence.right)) + unit;
    const staves = [
      ...system.staffPoints.map((point) => point.staff),
      ...system.restLines.keys(),
    ];
    const lowestStaff = staves.length > 0 ? Math.max(...staves) : 0;
    const top = staffLineY(system, 0, 0, TOP_LINE_POSITION, half) ??
      (Number.isFinite(system.noteheadTop) ? system.noteheadTop : system.measures[0].left);
    const bottom = staffLineY(system, lowestStaff, 4, BOTTOM_LINE_POSITION, half) ??
      (Number.isFinite(system.noteheadBottom) ? system.noteheadBottom : top + unit * 4);
    return [{
      index: system.index,
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      firstMeasure: measureOffset + first - 1,
      barlines: measureBoundaries(ranges, left, right),
    }];
  });
}

/**
 * Geometry of linked visual groups and the notes that point at them. Diagnostic and
 * unlinked groups are left out. Note IDs get `idPrefix`, the page scope the merged
 * MusicXML gives them. The page's measures follow `measureOffset` measures of earlier
 * pages; `measureCount`, when known from the page's MusicXML, is how many it has.
 */
export function sidecarNoteGeometry(
  sidecar: VisualSidecar,
  pageIndex: number,
  idPrefix: string,
  measureOffset = 0,
  measureCount?: number,
): PageNoteGeometry {
  const cacheKey = `${pageIndex}:${idPrefix}:${measureOffset}:${measureCount ?? ""}`;
  const cached = geometryCache.get(sidecar)?.get(cacheKey);
  if (cached) return cached;
  const noteheads = sidecar.visual_groups.filter(isLinkedVisualGroup).map(noteheadGeometry);
  const linkedIds = new Set(noteheads.map((notehead) => notehead.id));
  const notes = sidecar.notes.flatMap((note): GeometryNote[] =>
    note.visual_group_id && linkedIds.has(note.visual_group_id)
      ? [{
          id: `${idPrefix}${note.musicxml_id}`,
          noteheadId: note.visual_group_id,
          pitch: note.pitch,
          grace: isGraceNote(note),
          measure: note.measure,
        }]
      : [],
  );
  const result: PageNoteGeometry = {
    pageIndex,
    noteheads,
    notes,
    measureOffset,
    systems: sidecarSystems(sidecar, noteheads, notes, measureOffset, measureCount),
  };
  const byKey = geometryCache.get(sidecar) ?? new Map<string, PageNoteGeometry>();
  byKey.set(cacheKey, result);
  geometryCache.set(sidecar, byKey);
  return result;
}

/**
 * Diagnostic visual groups as noteheads, so Diagnostics can select them. They are never
 * part of the page's note geometry.
 */
export function diagnosticNoteheads(sidecar: VisualSidecar): NoteheadGeometry[] {
  return sidecar.visual_groups
    .filter((group) => group.visual_status === "diagnostic")
    .map(noteheadGeometry);
}

/**
 * The merged MusicXML numbers pages that hold music from 1, skipping pages without
 * music, and prefixes every note ID with `page-<number>-`.
 */
function musicPagePrefixes(pages: readonly DocumentPage[]): Map<number, string> {
  const result = new Map<number, string>();
  let musicPageNumber = 0;
  for (const page of [...pages].sort((first, second) => first.index - second.index)) {
    if (page.musicXml || page.visualSidecar || page.artifacts?.musicXmlPath) {
      musicPageNumber += 1;
      result.set(page.index, `page-${musicPageNumber}-`);
    }
  }
  return result;
}

/** How many measures a page's MusicXML holds: those of its first part. */
function pageMeasureCount(page: DocumentPage): number | undefined {
  if (page.musicXml) {
    const firstPart = page.musicXml.split(/<\/part\s*>/)[0];
    const count = firstPart.match(/<measure[\s>]/g)?.length ?? 0;
    if (count > 0) return count;
  }
  const measures = [
    ...(page.visualSidecar?.notes ?? []).map((note) => note.measure),
    ...(page.visualSidecar?.rest_verification?.rests ?? []).map((rest) => rest.measure),
  ];
  return measures.length > 0 ? Math.max(...measures) : undefined;
}

/** Note geometry of every recognized page, in page order. */
export function pdfNoteGeometry(pages: readonly DocumentPage[]): PageNoteGeometry[] {
  const prefixes = musicPagePrefixes(pages);
  // The merged MusicXML appends each music page's measures in page order.
  let measureOffset = 0;
  return [...pages]
    .sort((first, second) => first.index - second.index)
    .flatMap((page) => {
      if (!prefixes.has(page.index)) return [];
      const offset = measureOffset;
      const count = pageMeasureCount(page);
      measureOffset += count ?? 0;
      return page.visualSidecar
        ? [sidecarNoteGeometry(page.visualSidecar, page.index, prefixes.get(page.index) ?? "", offset, count)]
        : [];
    });
}

/**
 * Score facts for playback: from the merged document when it exists, otherwise from each
 * recognized page's own MusicXML, scoped the way the merge would scope it.
 */
export function pdfNoteScoreFacts(
  pages: readonly DocumentPage[],
  documentScore: RealtimeScore | null | undefined,
): NoteScoreFacts {
  if (documentScore) return noteScoreFacts(documentScore);
  const prefixes = musicPagePrefixes(pages);
  return mergeNoteScoreFacts(
    pages.flatMap((page) => {
      if (!page.visualSidecar || !page.musicXml) return [];
      try {
        return [noteScoreFacts(parseRealtimeMusicXml(page.musicXml), prefixes.get(page.index))];
      } catch {
        // Playback still uses the recognized notes of a page whose MusicXML does not parse.
        return [emptyNoteScoreFacts()];
      }
    }),
  );
}
