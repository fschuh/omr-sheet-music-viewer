// Turns recognized PDF pages into note geometry and score facts. This is the only
// place outside PDF-specific UI that reads homr's visual sidecar.
import type { Bounds, GeometryNote, NoteheadGeometry, PageNoteGeometry } from "./noteGeometry";
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

/**
 * Geometry of linked visual groups and the notes that point at them. Diagnostic and
 * unlinked groups are left out. Note IDs get `idPrefix`, the page scope the merged
 * MusicXML gives them.
 */
export function sidecarNoteGeometry(
  sidecar: VisualSidecar,
  pageIndex: number,
  idPrefix: string,
): PageNoteGeometry {
  const cacheKey = `${pageIndex}:${idPrefix}`;
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
  const result = { pageIndex, noteheads, notes };
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

/** Note geometry of every recognized page, in page order. */
export function pdfNoteGeometry(pages: readonly DocumentPage[]): PageNoteGeometry[] {
  const prefixes = musicPagePrefixes(pages);
  return [...pages]
    .sort((first, second) => first.index - second.index)
    .flatMap((page) =>
      page.visualSidecar
        ? [sidecarNoteGeometry(page.visualSidecar, page.index, prefixes.get(page.index) ?? "")]
        : [],
    );
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
