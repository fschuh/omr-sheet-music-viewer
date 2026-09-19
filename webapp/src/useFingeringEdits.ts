import { useEffect, useMemo, useState } from "react";
import { fingeringDocumentId } from "./fingeringPolicy";
import { annotationRevisions, editsKey, effectiveFingerings, emptyFingeringEdits, parseFingeringEdits, preserveEditSources, type FingeringEdits } from "./fingeringEdits";
import type { LoadedDocument } from "./types";
import { supportedFinger } from "./fingeringAnnotations";

const EMPTY_REVISIONS: Record<string, string> = {};
type Undo = Pick<FingeringEdits, "values" | "hidden">;
export function useFingeringEdits(document: LoadedDocument | null) {
  const id = fingeringDocumentId(document?.cachePath);
  const pages = document?.pages, identity = document?.jobId;
  const initial = useMemo(() => {
    try { return { edits: parseFingeringEdits(id ? localStorage.getItem(editsKey(id)) : null, id ?? ""), error: "", invalid: false }; }
    catch (error) { return { edits: emptyFingeringEdits(id ?? ""), error: String(error), invalid: true }; }
  }, [id]);
  const [saved, setSaved] = useState<{ initial: typeof initial; edits: FingeringEdits; history: Undo[]; error: string }>();
  const state = saved?.initial === initial ? saved : { ...initial, history: [] };
  const [resolved, setResolved] = useState<{ pages: typeof pages; identity: typeof identity; revisions: Record<string, string>; error?: string }>();
  useEffect(() => {
    let disposed = false;
    if (pages) void annotationRevisions(pages, () => disposed).then(revisions => {
      if (!disposed) setResolved({ pages, identity, revisions });
    }).catch(error => { if (!disposed) setResolved({ pages, identity, revisions: {}, error: String(error) }); });
    return () => { disposed = true; };
  }, [pages, identity]);
  const revisions = resolved?.pages === pages && resolved?.identity === identity ? resolved?.revisions ?? EMPTY_REVISIONS : EMPTY_REVISIONS;
  const write = (edits: FingeringEdits, history: Undo[]) => {
    if (!id || initial.invalid) return;
    let error = "";
    try { localStorage.setItem(editsKey(id), JSON.stringify(edits)); }
    catch { error = "Finger edits changed for this session but could not be saved"; }
    setSaved({ initial, edits, history, error });
  };
  useEffect(() => {
    if (!id || initial.invalid || document?.fingeringStatus !== "ready") return;
    const next = preserveEditSources(state.edits, document.sourceFingerings, revisions);
    if (next !== state.edits) write(next, state.history);
  }, [id, initial, document?.fingeringStatus, document?.sourceFingerings, revisions, state.edits]);
  const values = useMemo(() => effectiveFingerings(document?.predictedFingerings, state.edits, revisions),
    [document?.predictedFingerings, state.edits, revisions]);
  const change = (noteId: string, update: { finger?: number | null; hidden?: boolean }) => {
    const annotationRevision = revisions[noteId];
    if (!annotationRevision) return;
    if (update.finger !== undefined && update.finger !== null && !supportedFinger(update.finger)) return;
    const next = { ...state.edits, values: { ...state.edits.values }, hidden: { ...state.edits.hidden } };
    if (update.finger === null) delete next.values[noteId];
    else if (update.finger !== undefined) next.values[noteId] = { finger: update.finger, annotationRevision };
    if (update.hidden === false) delete next.hidden[noteId];
    else if (update.hidden === true) next.hidden[noteId] = { annotationRevision };
    write(next, [...state.history, { values: state.edits.values, hidden: state.edits.hidden }].slice(-20));
  };
  return { edits: state.edits, revisions, values, change, available: Boolean(id) && !initial.invalid,
    error: state.error || (resolved?.pages === pages ? resolved?.error : "") || "",
    staleCount: resolved?.pages === pages ? new Set([...Object.entries(state.edits.values), ...Object.entries(state.edits.hidden)]
      .filter(([key, edit]) => edit.annotationRevision !== revisions[key]).map(([key]) => key)).size : 0,
    discardStale: () => {
      if (resolved?.pages !== pages) return;
      const values = Object.fromEntries(Object.entries(state.edits.values).filter(([key, edit]) => edit.annotationRevision === revisions[key]));
      const hidden = Object.fromEntries(Object.entries(state.edits.hidden).filter(([key, edit]) => edit.annotationRevision === revisions[key]));
      write({ ...state.edits, values, hidden }, [...state.history, { values: state.edits.values, hidden: state.edits.hidden }].slice(-20));
    },
    canUndo: state.history.length > 0,
    undo: () => { const previous = state.history.at(-1); if (previous) write({ ...state.edits, ...previous }, state.history.slice(0, -1)); },
  };
}
