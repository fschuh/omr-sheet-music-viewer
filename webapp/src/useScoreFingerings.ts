import { useEffect, useMemo, useRef, useState } from "react";
import { FINGERING_LAYOUT_VERSION, measureFingeringFont, type FingeringFontMetrics, type FingeringLayout } from "./fingeringLayout";
import { documentNoteId, musicPageNumbers } from "./scoreIdentity";
import { fingeringSidecarPacket, FingeringScheduler, prioritizedFingeringPages, sameFingeringTask, type FingeringPageResult, type FingeringTask, type FingeringWorkerPort } from "./fingeringScheduler";
import type { LoadedDocument } from "./types";
import type { RealtimeScore } from "./realtime";
import type { MusicalNoteIdentity } from "./scoreFingerings";

export interface ScoreFingeringPage { layout?: FingeringLayout; status: string }
const EMPTY_VISIBLE: readonly number[] = [];
const createWorker = () => new Worker(new URL("./fingeringWorker.ts", import.meta.url), { type: "module" }) as FingeringWorkerPort;

export function useScoreFingerings(document: LoadedDocument | null, score: RealtimeScore | null, enabled: boolean,
  visible: readonly number[] = EMPTY_VISIBLE, factory: () => FingeringWorkerPort = createWorker) {
  const pages = document?.pages, values = document?.predictedFingerings, identity = document?.jobId;
  const [font, setFont] = useState<{ metrics?: FingeringFontMetrics; error?: string }>({});
  const scheduler = useRef<FingeringScheduler | null>(null);
  const [stored, setStored] = useState<{ identity: typeof identity; entries: ReadonlyMap<number, FingeringPageResult> }>();
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void globalThis.document.fonts.ready.then(() => {
      if (disposed) return;
      const context = globalThis.document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Font measurement unavailable");
      setFont({ metrics: measureFingeringFont(context) });
    }).catch(error => { if (!disposed) setFont({ error: String(error) }); });
    return () => { disposed = true; };
  }, [enabled]);
  const musicalNotes = useMemo(() => {
    const notes: Record<string, MusicalNoteIdentity> = {};
    score?.measures.forEach((measure, index) => {
      for (const note of measure.notes) if (note.musicXmlId) notes[note.musicXmlId] = { ...note, measure: index };
    });
    return notes;
  }, [score]);
  const prepared = useMemo(() => {
    const statuses: Record<number, ScoreFingeringPage> = {}, tasks: FingeringTask[] = [];
    if (!enabled || !pages) return { statuses, tasks };
    const numbers = musicPageNumbers(pages);
    const indices = prioritizedFingeringPages(pages.filter(p => p.status !== "skipped").map(p => p.index), visible);
    for (const index of indices) {
      const page = pages.find(p => p.index === index)!;
      const sidecar = page.visualSidecar, ordinal = numbers.get(index);
      const status = page.status !== "complete" ? "Waiting for page recognition" :
        !values || !score ? "Waiting for predictions" :
        !sidecar?.annotation_geometry ? "Staff geometry unavailable; regenerate this page" :
        !sidecar.ink_obstacles ? "Page ink unavailable; regenerate this page" :
        font.error ?? (!font.metrics ? "Waiting for font readiness" : "Placing fingerings…");
      statuses[index] = { status };
      if (status !== "Placing fingerings…" || !sidecar || !ordinal || !font.metrics || !values) continue;
      const pageValues: NonNullable<typeof values> = {}, pageNotes: typeof musicalNotes = {};
      for (const note of sidecar.notes) {
        const id = documentNoteId(ordinal, note.musicxml_id);
        if (values[id]) pageValues[id] = values[id];
        if (musicalNotes[id]) pageNotes[id] = musicalNotes[id];
      }
      const key = JSON.stringify([FINGERING_LAYOUT_VERSION, ordinal, font.metrics, pageValues, pageNotes]);
      tasks.push({ key, source: sidecar, work: { pageIndex: index, musicPageNumber: ordinal, sidecar: fingeringSidecarPacket(sidecar), values: pageValues, musicalNotes: pageNotes, metrics: font.metrics } });
    }
    return { statuses, tasks };
  }, [enabled, pages, values, score, musicalNotes, visible, font]);
  useEffect(() => {
    if (!enabled) return;
    const instance = new FingeringScheduler(factory, entries => setStored({ identity, entries }));
    scheduler.current = instance;
    return () => { instance.dispose(); if (scheduler.current === instance) scheduler.current = null; };
  }, [identity, enabled, factory]);
  useEffect(() => { scheduler.current?.update(prepared.tasks); }, [prepared, identity, enabled, factory]);
  return useMemo(() => {
    const result = { ...prepared.statuses };
    if (enabled && stored && stored.identity === identity) for (const task of prepared.tasks) {
      const cached = stored.entries.get(task.work.pageIndex);
      if (cached && sameFingeringTask(cached.task, task)) result[task.work.pageIndex] = cached;
    }
    return result;
  }, [prepared, enabled, stored, identity]);
}
