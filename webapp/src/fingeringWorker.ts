import { createObstacleMap, type ObstacleMap } from "./fingeringObstacles";
import { layoutFingerings, type FingeringFontMetrics } from "./fingeringLayout";
import { buildFingeringRequests, type MusicalNoteIdentity } from "./scoreFingerings";
import type { EffectiveFingering } from "./fingeringAnnotations";
import type { PredictedFingering } from "./fingering";
import type { VisualBBox, VisualSidecar } from "./types";

export interface FingeringWork {
  token: number;
  pageIndex: number;
  musicPageNumber: number;
  sidecar: VisualSidecar;
  values: Record<string, PredictedFingering | EffectiveFingering>;
  musicalNotes: Record<string, MusicalNoteIdentity>;
  metrics: FingeringFontMetrics;
  reserved?: VisualBBox[];
}

const masks = new Map<string, { signature: string; data: string; map: ObstacleMap }>();
self.onmessage = ({ data: work }: MessageEvent<FingeringWork>) => {
  try {
    const start = performance.now();
    const artifact = work.sidecar.ink_obstacles;
    if (!artifact) throw new Error(work.sidecar.annotation_analysis_error ?? "Page ink unavailable; regenerate this page");
    if (!work.sidecar.annotation_geometry) throw new Error(work.sidecar.annotation_geometry_error ?? "Staff geometry unavailable; regenerate this page");
    const key = artifact.raster_sha256;
    const signature = JSON.stringify([artifact.version, artifact.encoding, artifact.source_image_size, artifact.mask_size, artifact.source_pixels_per_cell]);
    let cached = masks.get(key);
    if (!cached || cached.signature !== signature || cached.data !== artifact.data) {
      cached = { signature, data: artifact.data, map: createObstacleMap(artifact) };
    }
    masks.delete(key); masks.set(key, cached);
    while (masks.size > 2) masks.delete(masks.keys().next().value!);
    const requests = buildFingeringRequests(work.pageIndex, work.musicPageNumber, work.sidecar, work.values, work.musicalNotes);
    const result = layoutFingerings(requests.requests, work.sidecar.annotation_geometry.staffs, cached.map, work.metrics, work.reserved);
    self.postMessage({ token: work.token, requests, result, milliseconds: performance.now() - start,
      integralBytes: cached.map.bytes });
  } catch (error) {
    self.postMessage({ token: work.token, error: error instanceof Error ? error.message : String(error) });
  }
};
