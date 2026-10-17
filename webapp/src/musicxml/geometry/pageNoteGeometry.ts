// A laid-out page as note geometry for the shared consumers: one notehead per note,
// identified by its structural key, with the note's viewer ID `page-<n>-<key>`.
import type { GeometryNote, NoteheadGeometry, PageNoteGeometry } from "../../noteGeometry";
import type { LayoutModel, LayoutPage } from "../model/layout";

const cache = new WeakMap<LayoutPage, PageNoteGeometry>();

/** Viewer IDs carry the page number, counted from 1, as PDF note IDs do. */
export function viewerIdPrefix(pageIndex: number): string {
  return `page-${pageIndex + 1}-`;
}

/** Every laid-out note's viewer ID, by note key. */
export function viewerIds(layout: LayoutModel): Map<string, string> {
  return new Map(layout.pages.flatMap((page) =>
    page.chords.flatMap((chord) => chord.notes.map((note) => [note.key, `${viewerIdPrefix(page.index)}${note.key}`] as const)),
  ));
}

export function pageNoteGeometry(page: LayoutPage): PageNoteGeometry {
  const cached = cache.get(page);
  if (cached) return cached;
  const noteheads: NoteheadGeometry[] = [];
  const notes: GeometryNote[] = [];
  for (const chord of page.chords) {
    for (const note of chord.notes) {
      noteheads.push({
        id: note.key,
        systemIndex: chord.systemIndex,
        center: note.center,
        noteheadBounds: note.headBounds,
        hitAreas: [note.headBounds],
        bounds: chord.stemBounds ?? note.headBounds,
        chordId: chord.id,
        momentId: chord.momentId,
      });
      notes.push({
        id: `${viewerIdPrefix(page.index)}${note.key}`,
        noteheadId: note.key,
        pitch: note.pitch,
        grace: note.grace,
        measure: note.measure,
      });
    }
  }
  const geometry: PageNoteGeometry = {
    pageIndex: page.index,
    noteheads,
    notes,
    // Note measures are already positions in the whole score.
    measureOffset: 0,
    systems: page.systems.map((system, index) => ({ index, ...system })),
  };
  cache.set(page, geometry);
  return geometry;
}
