import { useEffect, useMemo, useState } from "react";
import { measureFingeringFont, type FingeringLayout } from "./fingeringLayout";
import { musicPageNumbers } from "./scoreIdentity";
import { annotationStaffs } from "./staffGeometry";
import type { LoadedDocument } from "./types";
import type { RealtimeScore } from "./realtime";
import type { MusicalNoteIdentity } from "./scoreFingerings";

export interface ScoreFingeringPage { layout?: FingeringLayout; status: string }
const EMPTY: Record<number, ScoreFingeringPage> = {};

/** A generation owns its worker; replacement terminates queued and stale work. */
export function useScoreFingerings(document: LoadedDocument | null, score: RealtimeScore | null, enabled: boolean) {
  const pages = document?.pages;
  const values = document?.predictedFingerings;
  const identity = document?.jobId;
  const input = useMemo(() => ({ pages, values, score, identity, enabled }), [pages, values, score, identity, enabled]);
  const [state, setState] = useState<{ input: typeof input; pages: Record<number, ScoreFingeringPage> }>();
  useEffect(() => {
    if (!enabled || !pages || !values || !score) return;
    let disposed = false;
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const results: Record<number, ScoreFingeringPage> = {};
    const publish = () => { if (!disposed) setState({ input, pages: { ...results } }); };
    const run = async () => {
      await globalThis.document.fonts.ready;
      if (disposed) return;
      const context = globalThis.document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("Fingering font measurement unavailable");
      const metrics = measureFingeringFont(context);
      const musicalNotes: Record<string, MusicalNoteIdentity> = {};
      score.measures.forEach((measure, index) => {
        for (const note of measure.notes) if (note.musicXmlId) musicalNotes[note.musicXmlId] = { ...note, measure: index };
      });
      const numbers = musicPageNumbers(pages);
      const queue = pages.filter(page => {
        if (page.status !== "complete") return false;
        const sidecar = page.visualSidecar;
        const status = !sidecar || !annotationStaffs(sidecar)
          ? "Staff geometry unavailable; regenerate this page"
          : !sidecar.ink_obstacles ? "Page ink unavailable; regenerate this page" : "Placing fingerings…";
        results[page.index] = { status };
        return Boolean(sidecar && annotationStaffs(sidecar) && sidecar.ink_obstacles && numbers.get(page.index));
      });
      publish();
      if (!queue.length) return;
      worker = new Worker(new URL("./fingeringWorker.ts", import.meta.url), { type: "module" });
      let token = 0;
      const next = () => {
        const page = queue.shift();
        if (!page || disposed) { worker?.terminate(); return; }
        const currentToken = ++token;
        worker!.onmessage = ({ data }) => {
          if (disposed || data.token !== currentToken) return;
          clearTimeout(timeout);
          results[page.index] = data.error ? { status: data.error } : {
            layout: data.result,
            status: `${data.result.placed.reduce((n: number, p: FingeringLayout["placed"][number]) => n + p.request.digits.length, 0)} digits shown; unsupported or crowded notes omitted`,
          };
          publish(); next();
        };
        worker!.onerror = () => fail("Fingering worker unavailable");
        timeout = setTimeout(() => fail("Fingering placement timed out"), 15000);
        worker!.postMessage({ token: currentToken, pageIndex: page.index, musicPageNumber: numbers.get(page.index),
          sidecar: page.visualSidecar, values, musicalNotes, metrics });
      };
      next();
    };
    const fail = (message: string) => {
      clearTimeout(timeout); worker?.terminate();
      for (const page of pages) if (!results[page.index]?.layout) results[page.index] = { status: message };
      publish();
    };
    void run().catch(error => fail(error instanceof Error ? error.message : String(error)));
    return () => { disposed = true; clearTimeout(timeout); worker?.terminate(); };
  }, [input]);
  return state?.input === input ? state.pages : EMPTY;
}
