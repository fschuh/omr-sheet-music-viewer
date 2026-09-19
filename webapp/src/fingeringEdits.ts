import { resolveFingering, supportedFinger, type EffectiveFingering, type NoteValueOverride, type SourceFingerings } from "./fingeringAnnotations";
import { documentNoteId, musicPageNumbers } from "./scoreIdentity";
import type { PredictedFingering } from "./fingering";
import type { DocumentPage } from "./types";
import type { FingeringLayout } from "./fingeringLayout";

export interface FingeringEdits {
  version: 1; documentId: string;
  values: Record<string, NoteValueOverride>;
  hidden: Record<string, { annotationRevision: string }>;
  /** Sparse raw source snapshots, keyed by recognition revision, outside generated XML. */
  sources: Record<string, SourceFingerings>;
}
export const editsKey = (id: string) => `homr.fingering-edits.v1.${id}`;
export const emptyFingeringEdits = (id: string): FingeringEdits => ({ version: 1, documentId: id, values: {}, hidden: {}, sources: {} });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const revision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function parseFingeringEdits(raw: string | null, id: string): FingeringEdits {
  if (raw === null) return emptyFingeringEdits(id);
  const value = JSON.parse(raw) as FingeringEdits;
  if (!value || value.version !== 1 || value.documentId !== id || !record(value.values) || !record(value.hidden) || !record(value.sources)
    || Object.values(value.values).some(edit => !edit || !supportedFinger(edit.finger) || !revision(edit.annotationRevision))
    || Object.values(value.hidden).some(edit => !edit || !revision(edit.annotationRevision))
    || Object.entries(value.sources).some(([key, source]) => !revision(key) || !source || source.version !== 1 || !Array.isArray(source.notes)
      || source.notes.some(note => !note || typeof note.musicXmlId !== "string" || !Number.isInteger(note.noteIndex) || note.noteIndex < 0
        || !["source", "unknown-generated-cache"].includes(note.provenance) || !Array.isArray(note.markings)
        || note.markings.some(mark => !mark || typeof mark.text !== "string" || !record(mark.attributes)
          || Object.values(mark.attributes).some(attribute => typeof attribute !== "string"))))) {
    throw new Error("Saved finger edits are invalid; they were not overwritten");
  }
  return value;
}

/** No pitch/proximity reconciliation. Prediction annotations are deliberately absent. */
export async function annotationRevisions(pages: readonly DocumentPage[], cancelled = () => false): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const ordinals = musicPageNumbers(pages);
  for (const page of pages) {
    if (cancelled()) return {};
    const ordinal = ordinals.get(page.index), sidecar = page.visualSidecar;
    if (page.status !== "complete" || !page.musicXml || !sidecar || !ordinal) continue;
    const signature = JSON.stringify(["note-identity-v1", page.index, ordinal, page.musicXml,
      sidecar.source_image_size, sidecar.ink_obstacles?.raster_sha256,
      sidecar.notes.map(note => [note.musicxml_id, note.pitch, note.part, note.measure, note.voice, note.musicxml_staff_number, note.duration, note.visual_group_id]),
      sidecar.visual_groups.map(group => [group.visual_group_id, group.musicxml_id, group.visual_status, group.staff_group_index,
        group.staff_index, group.center, group.moment_id, group.chord_id])]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    for (const note of sidecar.notes) result[documentNoteId(ordinal, note.musicxml_id)] = key;
  }
  return result;
}
export function effectiveFingerings(predictions: Readonly<Record<string, PredictedFingering>> | undefined,
  edits: FingeringEdits, revisions: Readonly<Record<string, string>>): Record<string, EffectiveFingering> | undefined {
  if (!predictions) return undefined;
  const result: Record<string, EffectiveFingering> = {};
  for (const [id, prediction] of Object.entries(predictions)) {
    const value = resolveFingering(prediction, edits.values[id], revisions[id] ?? "");
    if (value) result[id] = value;
  }
  return result;
}
export function hideEditedFingerings(layout: FingeringLayout | undefined, edits: FingeringEdits,
  revisions: Readonly<Record<string, string>>): FingeringLayout | undefined {
  if (!layout) return undefined;
  return { ...layout, placed: layout.placed.filter(label => !label.request.digits.some(digit =>
    Boolean(revisions[digit.documentId]) && edits.hidden[digit.documentId]?.annotationRevision === revisions[digit.documentId])) };
}
export function preserveEditSources(edits: FingeringEdits, source: SourceFingerings | undefined,
  revisions: Readonly<Record<string, string>>): FingeringEdits {
  if (!source) return edits;
  const sources = { ...edits.sources };
  const incoming: Record<string, SourceFingerings> = {};
  for (const note of source.notes) {
    const key = note.musicXmlId && revisions[note.musicXmlId];
    if (!key || (!note.markings.length && note.provenance === "source")) continue;
    (incoming[key] ??= { version: 1, notes: [] }).notes.push(note);
  }
  let changed = false;
  for (const [key, snapshot] of Object.entries(incoming)) {
    if (!sources[key]) { sources[key] = snapshot; changed = true; }
  }
  return changed ? { ...edits, sources } : edits;
}
