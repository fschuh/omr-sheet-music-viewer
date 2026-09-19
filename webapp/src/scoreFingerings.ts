import type { PredictedFingering } from "./fingering";
import { resolveFingering, type EffectiveFingering } from "./fingeringAnnotations";
import { documentNoteId } from "./scoreIdentity";
import { annotationStaffs, staffAt } from "./staffGeometry";
import type { AnnotationStaff, VisualPoint, VisualSidecar } from "./types";

export interface MusicalNoteIdentity {
  onset: number;
  measure: number;
  voice: string;
  partId: string;
  staff: number;
  grace: boolean;
  tieStop: boolean;
}

export interface FingeringDigit {
  documentId: string;
  localId: string;
  visualGroupId: string;
  anchor: VisualPoint;
  value: EffectiveFingering;
}

export interface FingeringRequest {
  id: string;
  pageIndex: number;
  momentId: string;
  chordId: string | null;
  measure: number;
  onset: number;
  staff: AnnotationStaff;
  spacing: number;
  anchor: VisualPoint;
  side: "above" | "below";
  notationTop: number;
  notationBottom: number;
  digits: FingeringDigit[];
}

export type RequestOmissionReason = "missing-link" | "missing-geometry" | "missing-prediction" |
  "missing-musical-identity" | "unsupported-chord" | "unsupported-cross-staff" | "unsupported-voices" | "unsupported-grace" | "tie-continuation";

export interface FingeringRequests {
  requests: FingeringRequest[];
  omissions: { documentId: string; reason: RequestOmissionReason }[];
  counts: { pitched: number; predicted: number; linked: number; supported: number };
}

/** One pass over printed notes, never over playback events or diagnostic candidates. */
export function buildFingeringRequests(
  pageIndex: number,
  musicPageNumber: number,
  sidecar: VisualSidecar,
  values: Readonly<Record<string, PredictedFingering | EffectiveFingering>>,
  musicalNotes: Readonly<Record<string, MusicalNoteIdentity>>,
): FingeringRequests {
  const result: FingeringRequests = { requests: [], omissions: [], counts: { pitched: 0, predicted: 0, linked: 0, supported: 0 } };
  const staffs = annotationStaffs(sidecar);
  const groups = new Map(sidecar.visual_groups.map(group => [group.visual_group_id, group]));
  const candidates: FingeringRequest[] = [];
  const seen = new Set<string>();
  for (const note of sidecar.notes) {
    if (!note.pitch || seen.has(note.musicxml_id)) continue;
    seen.add(note.musicxml_id);
    result.counts.pitched++;
    const id = documentNoteId(musicPageNumber, note.musicxml_id);
    const omit = (reason: RequestOmissionReason) => result.omissions.push({ documentId: id, reason });
    const rawValue = values[id];
    const value = rawValue && "source" in rawValue ? rawValue : resolveFingering(rawValue, undefined, "");
    if (value) result.counts.predicted++;
    const group = note.visual_group_id ? groups.get(note.visual_group_id) : undefined;
    const linked = group && group.visual_status !== "diagnostic" && group.musicxml_id === note.musicxml_id;
    if (linked) result.counts.linked++;
    if (!value) { omit("missing-prediction"); continue; }
    if (!linked || !group.moment_id) { omit("missing-link"); continue; }
    const staff = staffs?.find(s => s.staff_group_index === group.staff_group_index && s.staff_index === group.staff_index);
    const local = staff && staffAt(staff, group.center[0]);
    if (!staff || !local) { omit("missing-geometry"); continue; }
    const music = musicalNotes[id];
    if (!music) { omit("missing-musical-identity"); continue; }
    if (note.alignment_method === "cross_staff_repair" || note.musicxml_staff_number !== group.staff_index + 1) {
      omit("unsupported-cross-staff"); continue;
    }
    if (music.grace) { omit("unsupported-grace"); continue; }
    if (music.tieStop) { omit("tie-continuation"); continue; }
    const independentVoices = sidecar.visual_groups.some(other => other.visual_group_id !== group.visual_group_id &&
      other.visual_status !== "diagnostic" && other.musicxml_id && other.moment_id === group.moment_id &&
      other.staff_group_index === group.staff_group_index && other.staff_index === group.staff_index &&
      !(group.chord_id && other.chord_id === group.chord_id));
    if (independentVoices) { omit("unsupported-voices"); continue; }
    const ambiguousUnison = sidecar.visual_groups.some(other => other.visual_group_id !== group.visual_group_id &&
      other.moment_id === group.moment_id && other.staff_group_index === group.staff_group_index && other.staff_index === group.staff_index &&
      Math.abs(other.center[0] - group.center[0]) < local.spacing * 0.2 && Math.abs(other.center[1] - group.center[1]) < local.spacing * 0.2);
    const partiallyLinkedOnset = sidecar.notes.some(other => {
      const identity = musicalNotes[documentNoteId(musicPageNumber, other.musicxml_id)];
      return other.pitch && identity && identity.partId === music.partId && identity.measure === music.measure &&
        identity.onset === music.onset && identity.voice === music.voice && identity.staff === music.staff &&
        (!other.visual_group_id || groups.get(other.visual_group_id)?.musicxml_id !== other.musicxml_id);
    });
    if (ambiguousUnison || partiallyLinkedOnset) { omit("unsupported-chord"); continue; }
    const systemStaffs = staffs!.filter(s => s.system_index === staff.system_index).sort((a, b) => a.extent[1] - b.extent[1]);
    // Middle staves have no validated outside-system lane ownership yet.
    if (systemStaffs.length > 2) { omit("unsupported-cross-staff"); continue; }
    const side = systemStaffs.length === 2 && systemStaffs[1].staff_id === staff.staff_id ? "below" : "above";
    const notationY = [group.center[1], ...group.notehead_contours.flat().map(p => p[1]),
      ...group.stem_contours.flat().map(p => p[1])].filter(Number.isFinite);
    candidates.push({ id, pageIndex, momentId: group.moment_id, chordId: group.chord_id,
      measure: music.measure, onset: music.onset, staff, spacing: local.spacing,
      anchor: group.center, side, notationTop: Math.min(...notationY), notationBottom: Math.max(...notationY),
      digits: [{ documentId: id, localId: note.musicxml_id, visualGroupId: group.visual_group_id, anchor: group.center, value }],
    });
  }
  const visited = new Set<string>();
  for (const candidate of candidates) {
    if (visited.has(candidate.id)) continue;
    const members = candidate.chordId ? candidates.filter(c => c.chordId === candidate.chordId) : [candidate];
    for (const member of members) visited.add(member.id);
    if (candidate.chordId) {
      const geometryMembers = sidecar.visual_groups.filter(g => g.chord_id === candidate.chordId);
      const music = musicalNotes[candidate.id];
      const sameOnsetNotes = sidecar.notes.filter(n => {
        const other = musicalNotes[documentNoteId(musicPageNumber, n.musicxml_id)];
        return other && other.partId === music.partId && other.measure === music.measure && other.onset === music.onset && other.voice === music.voice && other.staff === music.staff && !other.grace;
      });
      const incomplete = sameOnsetNotes.some(n => !n.visual_group_id || !groups.get(n.visual_group_id)?.musicxml_id);
      const unsupported = geometryMembers.length !== members.length || incomplete || members.length < 2 || members.length > 5 ||
        members.some(m => m.staff.staff_id !== candidate.staff.staff_id || m.momentId !== candidate.momentId ||
          m.onset !== candidate.onset || m.measure !== candidate.measure || m.digits[0].value.left !== candidate.digits[0].value.left ||
          musicalNotes[m.id].voice !== music.voice || musicalNotes[m.id].partId !== music.partId);
      if (unsupported) {
        result.omissions.push(...members.map(m => ({ documentId: m.id, reason: "unsupported-chord" as const })));
        continue;
      }
    }
    const digits = members.flatMap(m => m.digits).sort((a, b) => a.anchor[1] - b.anchor[1] || a.documentId.localeCompare(b.documentId));
    if (digits.some((d, i) => i > 0 && Math.abs(d.anchor[1] - digits[i - 1].anchor[1]) < candidate.spacing * 0.2)) {
      result.omissions.push(...members.map(m => ({ documentId: m.id, reason: "unsupported-chord" as const })));
      continue;
    }
    result.requests.push({ ...candidate, digits, notationTop: Math.min(...members.map(m => m.notationTop)),
      notationBottom: Math.max(...members.map(m => m.notationBottom)),
      anchor: [digits.reduce((sum, d) => sum + d.anchor[0], 0) / digits.length,
      candidate.side === "above" ? digits[0].anchor[1] : digits[digits.length - 1].anchor[1]] });
    result.counts.supported += digits.length;
  }
  result.requests.sort((a, b) => a.staff.system_index - b.staff.system_index || a.staff.staff_index - b.staff.staff_index || a.anchor[0] - b.anchor[0] || a.id.localeCompare(b.id));
  return result;
}
