import type { FingeringWork } from "./fingeringWorker";
import type { FingeringLayout } from "./fingeringLayout";
import type { VisualSidecar } from "./types";
import type { AnnotationAction } from "./annotationStatus";

export const FINGERING_PAGE_LIMIT = 3;
export interface FingeringTask { key: string; source?: VisualSidecar; work: Omit<FingeringWork, "token"> }
export interface FingeringPageResult {
  task: FingeringTask; layout?: FingeringLayout; status: string; milliseconds?: number;
  action?: AnnotationAction; reason?: string; detail?: string;
}
export interface FingeringWorkerPort {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  postMessage(message: FingeringWork): void;
  terminate(): void;
}
export function sameFingeringTask(a: FingeringTask, b: FingeringTask): boolean {
  return a.key === b.key && a.work.pageIndex === b.work.pageIndex && (a.source ?? a.work.sidecar) === (b.source ?? b.work.sidecar);
}
/** Keep authoritative links and exact placement contours, omit unrelated debug layers. */
export function fingeringSidecarPacket(sidecar: VisualSidecar): VisualSidecar {
  return { version: sidecar.version, source_image_size: sidecar.source_image_size, notes: sidecar.notes,
    annotation_geometry: sidecar.annotation_geometry, ink_obstacles: sidecar.ink_obstacles,
    annotation_analysis_error: sidecar.annotation_analysis_error, annotation_geometry_error: sidecar.annotation_geometry_error,
    annotation_geometry_rejection: sidecar.annotation_geometry_rejection,
    visual_groups: sidecar.visual_groups.map(group => ({ visual_group_id: group.visual_group_id,
      staff_group_index: group.staff_group_index, staff_index: group.staff_index, staff_position: group.staff_position,
      center: group.center, bbox: group.bbox, notehead_contours: group.notehead_contours, stem_contours: group.stem_contours,
      musicxml_id: group.musicxml_id, visual_status: group.visual_status, provenance: group.provenance,
      moment_id: group.moment_id, chord_id: group.chord_id, repair_actions: group.repair_actions })) };
}
/** At most three desired pages and one in-flight task. No playback/policy state. */
export class FingeringScheduler {
  private wanted: FingeringTask[] = [];
  private cache = new Map<number, FingeringPageResult>();
  private worker?: FingeringWorkerPort;
  private active?: { task: FingeringTask; token: number };
  private token = 0;
  private disposed = false;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(private factory: () => FingeringWorkerPort,
    private publish: (pages: ReadonlyMap<number, FingeringPageResult>) => void, private timeoutMs = 15000) {}
  update(tasks: readonly FingeringTask[]) {
    if (this.disposed) return;
    this.wanted = tasks.slice(0, FINGERING_PAGE_LIMIT);
    for (const [index, entry] of this.cache) {
      if (!this.wanted.some(task => sameFingeringTask(task, entry.task))) this.cache.delete(index);
    }
    if (this.active && !this.wanted.some(task => sameFingeringTask(task, this.active!.task))) this.stopWorker();
    this.publish(new Map(this.cache)); this.next();
  }
  private stopWorker() {
    clearTimeout(this.timeout); this.worker?.terminate(); this.worker = undefined; this.active = undefined;
  }
  private next() {
    if (this.disposed || this.active) return;
    const task = this.wanted.find(task => !this.cache.has(task.work.pageIndex));
    if (!task) return;
    const token = ++this.token;
    this.active = { task, token };
    const fail = (status: string) => {
      if (this.disposed || this.active?.token !== token) return;
      this.stopWorker();
      this.cache.set(task.work.pageIndex, { task, status, action: "none" });
      this.publish(new Map(this.cache)); this.next();
    };
    try {
      this.worker ??= this.factory();
      this.worker.onmessage = ({ data }) => {
        if (this.disposed || this.active?.token !== token || data.token !== token) return;
        clearTimeout(this.timeout); this.active = undefined;
        this.cache.set(task.work.pageIndex, { task, layout: data.error ? undefined : data.result,
          status: data.error ?? "Ready; unsupported/crowded notes omitted", milliseconds: data.milliseconds,
          action: data.action, reason: data.reason, detail: data.detail });
        this.publish(new Map(this.cache)); this.next();
      };
      this.worker.onerror = () => fail("Fingering worker unavailable");
      this.timeout = setTimeout(() => fail("Fingering placement timed out"), this.timeoutMs);
      this.worker.postMessage({ ...task.work, token });
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  }
  dispose() { this.disposed = true; this.stopWorker(); this.cache.clear(); this.wanted = []; }
}

export function prioritizedFingeringPages(indices: readonly number[], visible: readonly number[]): number[] {
  const available = new Set(indices);
  const result = [...new Set(visible)].filter(index => available.has(index)).slice(0, FINGERING_PAGE_LIMIT);
  if (!result.length && indices.length) result.push(indices[0]);
  const last = indices.indexOf(result.at(-1)!);
  if (result.length < FINGERING_PAGE_LIMIT && last >= 0 && last + 1 < indices.length) result.push(indices[last + 1]);
  return result;
}
