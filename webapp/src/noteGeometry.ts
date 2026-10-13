// What the shared viewer code knows about the notes on a page, whatever the page came
// from. A recognized PDF page and an engraved MusicXML page both produce this, and
// playback, realtime, pitch labels, selection and hit testing read nothing else.
// It holds only what current features read; a feature that needs more extends it and
// every producer. Coordinates are page pixels.
import type { VisualGroupRef } from "./types";

export type Point = [x: number, y: number];
export type Bounds = [left: number, top: number, right: number, bottom: number];

/** One selectable, highlightable notehead. */
export interface NoteheadGeometry {
  /** Unique on the page; selection, highlighting and playback refer to the notehead by it. */
  id: string;
  /** The system on the page, counted from the top. */
  systemIndex: number;
  center: Point;
  /** The visible notehead: pitch labels are placed around it and playback orders moments by it. */
  noteheadBounds: Bounds;
  /** Areas that select the notehead when clicked, before the clearance hit testing adds. */
  hitAreas: Bounds[];
  /** The notehead with its stem: a click outside every hit area falls back to it, and systems are measured with it. */
  bounds: Bounds;
  /** Noteheads of one chord share an ID; selecting one selects all of them. */
  chordId: string | null;
  /** Noteheads struck together in a system share an ID; they form one playback moment. */
  momentId: string | null;
}

/** One score note, linked to the notehead that shows it. */
export interface GeometryNote {
  /** The page-scoped viewer ID, the same ID the note has in the document MusicXML. */
  id: string;
  noteheadId: string;
  /** Scientific pitch such as "F#5"; null when the note has no pitch. */
  pitch: string | null;
  grace: boolean;
  measure: number;
}

export interface PageNoteGeometry {
  pageIndex: number;
  /** In source order; consumers keep this order where it decides ties. */
  noteheads: NoteheadGeometry[];
  /** In source order. More than one note may share a notehead. */
  notes: GeometryNote[];
}

/** Clicks within this many pixels of a hit area select its notehead. */
const HIT_CLEARANCE = 3;

function contains(bounds: Bounds, point: Point, clearance = 0): boolean {
  return (
    point[0] >= bounds[0] - clearance &&
    point[0] <= bounds[2] + clearance &&
    point[1] >= bounds[1] - clearance &&
    point[1] <= bounds[3] + clearance
  );
}

/**
 * The notehead a click at `point` selects: among noteheads whose hit area is near the
 * point, or failing that whose bounds contain it, the preferred ones first and then the
 * one with the nearest center.
 */
export function hitTestNoteheads(
  noteheads: readonly NoteheadGeometry[],
  point: Point,
  preferred?: ReadonlySet<string>,
): NoteheadGeometry | null {
  const onNotehead = noteheads.filter((notehead) =>
    notehead.hitAreas.some((area) => contains(area, point, HIT_CLEARANCE)),
  );
  const candidates = onNotehead.length
    ? onNotehead
    : noteheads.filter((notehead) => contains(notehead.bounds, point));
  return (
    candidates.sort((first, second) => {
      if (preferred) {
        const firstPreferred = preferred.has(first.id);
        if (firstPreferred !== preferred.has(second.id)) return firstPreferred ? -1 : 1;
      }
      return (
        Math.hypot(point[0] - first.center[0], point[1] - first.center[1]) -
        Math.hypot(point[0] - second.center[0], point[1] - second.center[1])
      );
    })[0] ?? null
  );
}

/**
 * The noteheads to highlight on a page: all of them, or the selected notehead together
 * with the rest of its chord. A selected `standalone` notehead is highlighted on its own.
 */
export function selectedNoteheadIds(
  geometry: PageNoteGeometry | undefined,
  selected: VisualGroupRef | null,
  pageIndex: number,
  highlightAll: boolean,
  standalone: readonly NoteheadGeometry[] = [],
): Set<string> {
  const noteheads = geometry?.noteheads ?? [];
  if (highlightAll) return new Set(noteheads.map((notehead) => notehead.id));
  if (!selected || selected.pageIndex !== pageIndex) return new Set();
  const notehead = noteheads.find((candidate) => candidate.id === selected.visualGroupId);
  if (!notehead) {
    return standalone.some((candidate) => candidate.id === selected.visualGroupId)
      ? new Set([selected.visualGroupId])
      : new Set();
  }
  const result = new Set([notehead.id]);
  if (notehead.chordId !== null) {
    for (const candidate of noteheads) {
      if (candidate.chordId === notehead.chordId) result.add(candidate.id);
    }
  }
  return result;
}

export function noteGeometryByPage(
  geometry: readonly PageNoteGeometry[],
): Map<number, PageNoteGeometry> {
  return new Map(geometry.map((page) => [page.pageIndex, page]));
}
