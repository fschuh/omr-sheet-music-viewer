// Maps the viewer's current note-geometry consumers onto the fixed interface that
// run.ts records. Only this file changes when the consumers' APIs change, so two
// recordings of the same inputs can be compared byte for byte.
import { playbackMomentExtents, hitTest, type PlaybackMomentExtents } from "../../src/DocumentViewer";
import { layoutNoteLabels, selectedGroupIds } from "../../src/noteLabels";
import { buildPlaybackTimeline, type PlaybackMoment } from "../../src/playback";
import type { PredictedFingering } from "../../src/fingering";
import { buildRealtimeVisualMap, type RealtimeScore, type VisualNoteTarget } from "../../src/realtime";
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

export const harness: ParityHarness = {
  timeline: (pages, fingerings, documentScore) =>
    buildPlaybackTimeline(pages, fingerings, documentScore),
  visualTargets: (pages) =>
    new Map([...buildRealtimeVisualMap(pages)].filter(([key]) => key.startsWith("page-"))),
  selection: (_pages, page, selected, highlightAll, diagnostics) =>
    page.visualSidecar
      ? [...selectedGroupIds(page.visualSidecar, selected, page.index, highlightAll, diagnostics)]
      : [],
  labels: (_pages, page, selectedIds) =>
    page.visualSidecar
      ? layoutNoteLabels(page.visualSidecar, selectedIds, page.width, page.height).map(
          ({ visualGroupId, text, x, y, width, height, fontSize, anchor, connector }) => ({
            visualGroupId, text, x, y, width, height, fontSize, anchor, connector,
          }),
        )
      : [],
  hit: (_pages, page, point, diagnostics) =>
    page.visualSidecar ? hitTest(page.visualSidecar, point, diagnostics)?.visual_group_id ?? null : null,
  extents: (_pages, page, moment) => playbackMomentExtents(page, moment),
};
