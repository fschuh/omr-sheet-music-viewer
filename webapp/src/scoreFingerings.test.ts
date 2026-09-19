import assert from "node:assert/strict";
import test from "node:test";
import { annotationStaffs, staffAt } from "./staffGeometry";
import { createObstacleMap } from "./fingeringObstacles";
import { buildFingeringRequests, type MusicalNoteIdentity } from "./scoreFingerings";
import { documentNoteId, musicPageNumbers } from "./scoreIdentity";
import type { PredictedFingering } from "./fingering";
import type { AnnotationStaff, VisualSidecar } from "./types";

const staff: AnnotationStaff = {
  staff_id: "staff-0-0", staff_group_index: 0, staff_index: 0, system_index: 0,
  lines: Array.from({ length: 5 }, (_, i) => [[10, 100 + i * 10], [300, 110 + i * 10]]),
  spacing: [[10, 10], [300, 10]], extent: [10, 100, 300, 150],
};
const sidecar: VisualSidecar = { version: 3, source_image_size: [400, 600], notes: [], visual_groups: [], annotation_geometry: { version: 1, staffs: [staff] } };

test("geometry capability is additive and rejects malformed data", () => {
  assert.equal(annotationStaffs({ ...sidecar, annotation_geometry: undefined }), undefined);
  assert.deepEqual(annotationStaffs(sidecar), [staff]);
  const bad = structuredClone(sidecar);
  bad.annotation_geometry!.staffs[0].lines[1][0][1] = NaN;
  assert.equal(annotationStaffs(bad), undefined);
  const inconsistent = structuredClone(sidecar);
  inconsistent.annotation_geometry!.staffs[0].spacing[0][1] = 11;
  assert.equal(annotationStaffs(inconsistent), undefined);
});

test("staff interpolation retains skew and never extrapolates", () => {
  assert.deepEqual(staffAt(staff, 155), { top: 105, bottom: 145, spacing: 10 });
  assert.equal(staffAt(staff, 301), undefined);
  assert.equal(staffAt(staff, 9), undefined);
});

test("ink queries use full rectangles, independent x/y scale and one clearance margin", () => {
  const artifact = { version: 1 as const, encoding: "base64-bitset-msb" as const,
    source_image_size: [8, 2] as [number, number], mask_size: [4, 2] as [number, number],
    source_pixels_per_cell: [2, 1] as [number, number], raster_sha256: "fixture", threshold: 220, data: "IA==" };
  const map = createObstacleMap(artifact); // ink occupies original x=[4,6), y=[0,1)
  assert.equal(map.isClear([0, 0, 4, 1]), true);
  assert.equal(map.isClear([3, 0, 5, 1]), false);
  assert.equal(map.isClear([4, 1, 6, 2]), true);
  assert.equal(map.isClear([4, 1, 6, 2], 0.1), false);
  assert.equal(map.isClear([8, 0, 9, 1]), false);
  assert.throws(() => createObstacleMap({ ...artifact, data: "" }), /Truncated/);
});

function requestFixture(chord = false) {
  const score = structuredClone(sidecar);
  const values: Record<string, PredictedFingering> = {};
  const music: Record<string, MusicalNoteIdentity> = {};
  for (let i = 0; i < 3; i++) {
    const localId = `note-${i}`;
    const id = documentNoteId(2, localId);
    values[id] = { finger: [4, 1, 3][i], left: true };
    music[id] = { measure: 0, onset: chord ? 0 : i, voice: "1", partId: "P1", staff: 1, grace: false, tieStop: false };
    score.notes.push({ musicxml_id: localId, part: 1, measure: 1, musicxml_staff_number: 1, voice: 1, pitch: "C4", duration: "note_4", match_confidence: 1, visual_group_id: `g${i}`, alignment_method: "structural" });
    score.visual_groups.push({ visual_group_id: `g${i}`, staff_group_index: 0, staff_index: 0, staff_position: 5,
      center: [chord ? 100 : 100 + i * 30, 110 + i * 10], bbox: [], notehead_contours: [], stem_contours: [], musicxml_id: localId,
      visual_status: "canonical", provenance: "segmentation", moment_id: chord ? "moment" : `moment${i}`, chord_id: chord ? "chord" : null, repair_actions: [] });
  }
  return { score, values, music };
}

test("page identity matches merge ordinals across skipped PDF pages", () => {
  const pages = [{ index: 5, status: "complete" as const, width: 400, height: 600, musicXml: "xml" },
    { index: 1, status: "skipped" as const, width: 400, height: 600 },
    { index: 0, status: "complete" as const, width: 400, height: 600, musicXml: "xml" }];
  assert.deepEqual([...musicPageNumbers(pages)], [[0, 1], [5, 2]]);
  const { score, values, music } = requestFixture();
  assert.equal(buildFingeringRequests(5, 1, score, values, music).requests.length, 0);
  assert.equal(buildFingeringRequests(5, 2, score, values, music).requests.length, 3);
});

test("chords retain vertical digit order including left hand", () => {
  const { score, values, music } = requestFixture(true);
  score.visual_groups.reverse(); score.notes.reverse();
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0].digits.map(d => d.value.finger), [4, 1, 3]);
  assert.equal(result.counts.supported, 3);
});

test("diagnostic and partial stacks are never guessed", () => {
  const { score, values, music } = requestFixture(true);
  score.notes[2].visual_group_id = null;
  score.visual_groups[2].musicxml_id = null;
  score.visual_groups[2].visual_status = "diagnostic";
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.requests.length, 0);
  assert.deepEqual(result.counts, { pitched: 3, predicted: 3, linked: 2, supported: 0 });
  assert.equal(result.omissions.filter(o => o.reason === "missing-link").length, 1);
  assert.equal(result.omissions.filter(o => o.reason === "unsupported-chord").length, 2);
});

test("shared moment alone never creates a chord; ties and repeated inputs do not duplicate labels", () => {
  const { score, values, music } = requestFixture();
  score.visual_groups.forEach(g => { g.moment_id = "same"; });
  music["page-2-note-1"].tieStop = true;
  score.notes.push(score.notes[0]);
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.counts.pitched, 3);
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every(r => r.digits.length === 1));
  assert.equal(result.omissions[0].reason, "tie-continuation");
});

test("mixed-hand and missing-value stacks are reported", () => {
  const { score, values, music } = requestFixture(true);
  values["page-2-note-1"].left = false;
  assert.equal(buildFingeringRequests(5, 2, score, values, music).requests.length, 0);
  delete values["page-2-note-1"];
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.requests.length, 0);
  assert.ok(result.omissions.some(o => o.reason === "missing-prediction"));
});
