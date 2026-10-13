// Maps the viewer's current note-geometry consumers onto the fixed interface that
// run.ts records. Only this file changes when the consumers' APIs change, so two
// recordings of the same inputs can be compared byte for byte.
import {
  noteheadAt,
  pageDiagnosticNoteheads,
  playbackMomentExtents,
  type PlaybackMomentExtents,
} from "../../src/DocumentViewer";
import { selectedNoteheadIds, type PageNoteGeometry } from "../../src/noteGeometry";
import { layoutNoteLabels } from "../../src/noteLabels";
import { buildPlaybackTimeline, type PlaybackMoment } from "../../src/playback";
import type { PredictedFingering } from "../../src/fingering";
import { buildRealtimeVisualMap, type RealtimeScore, type VisualNoteTarget } from "../../src/realtime";
import { pdfNoteGeometry, pdfNoteScoreFacts } from "../../src/sidecarNoteGeometry";
import type { DocumentPage, VisualGroupRef, VisualPoint } from "../../src/types";

export interface LabelRecord {
  visualGroupId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  anchor: VisualPoint;
  connector: VisualPoint;
}

export interface ParityHarness {
  timeline(
    pages: DocumentPage[],
    fingerings: Record<string, PredictedFingering>,
    documentScore: RealtimeScore | null,
  ): PlaybackMoment[];
  /** Targets keyed by page-scoped note ID. */
  visualTargets(pages: DocumentPage[]): Map<string, VisualNoteTarget>;
  selection(
    pages: DocumentPage[],
    page: DocumentPage,
    selected: VisualGroupRef | null,
    highlightAll: boolean,
    diagnostics: boolean,
  ): string[];
  labels(pages: DocumentPage[], page: DocumentPage, selectedIds: Set<string>): LabelRecord[];
  hit(pages: DocumentPage[], page: DocumentPage, point: VisualPoint, diagnostics: boolean): string | null;
  extents(pages: DocumentPage[], page: DocumentPage, moment: PlaybackMoment): PlaybackMomentExtents | null;
}

const geometryCache = new WeakMap<DocumentPage[], PageNoteGeometry[]>();

function geometryOf(pages: DocumentPage[], page: DocumentPage): PageNoteGeometry | undefined {
  let geometry = geometryCache.get(pages);
  if (!geometry) {
    geometry = pdfNoteGeometry(pages);
    geometryCache.set(pages, geometry);
  }
  return geometry.find((candidate) => candidate.pageIndex === page.index);
}

export const harness: ParityHarness = {
  timeline: (pages, fingerings, documentScore) =>
    buildPlaybackTimeline(pdfNoteGeometry(pages), pdfNoteScoreFacts(pages, documentScore), fingerings),
  visualTargets: (pages) => buildRealtimeVisualMap(pdfNoteGeometry(pages)),
  selection: (pages, page, selected, highlightAll, diagnostics) => [
    ...selectedNoteheadIds(
      geometryOf(pages, page),
      selected,
      page.index,
      highlightAll,
      pageDiagnosticNoteheads(page, diagnostics),
    ),
  ],
  labels: (pages, page, selectedIds) => {
    const geometry = geometryOf(pages, page);
    return geometry
      ? layoutNoteLabels(geometry, selectedIds, page.width, page.height).map(
          ({ visualGroupId, text, x, y, width, height, fontSize, anchor, connector }) => ({
            visualGroupId, text, x, y, width, height, fontSize, anchor, connector,
          }),
        )
      : [];
  },
  hit: (pages, page, point, diagnostics) => {
    const geometry = geometryOf(pages, page);
    return geometry
      ? noteheadAt(geometry, pageDiagnosticNoteheads(page, diagnostics), point)?.id ?? null
      : null;
  },
  extents: (pages, page, moment) => playbackMomentExtents(geometryOf(pages, page), page, moment),
};
