import assert from "node:assert/strict";
import test from "node:test";
import { annotationStaffs, staffAt } from "./staffGeometry";
import { createObstacleMap } from "./fingeringObstacles";
import { buildFingeringRequests, type MusicalNoteIdentity } from "./scoreFingerings";
import { documentNoteId, musicPageNumbers } from "./scoreIdentity";
import type { PredictedFingering } from "./fingering";
import { boxesOverlap, layoutFingerings, type FingeringFontMetrics } from "./fingeringLayout";
import type { ObstacleMap } from "./fingeringObstacles";
import type { VisualBBox } from "./types";
import type { AnnotationStaff, VisualSidecar } from "./types";
import { applyFingeringPolicy, emptyFingeringPolicy, fingeringDocumentId, parseFingeringPolicy } from "./fingeringPolicy";
import { fingeringSidecarPacket, FingeringScheduler, prioritizedFingeringPages, type FingeringTask, type FingeringWorkerPort, type FingeringPageResult } from "./fingeringScheduler";
import type { FingeringWork } from "./fingeringWorker";

class FakeFingeringWorker implements FingeringWorkerPort {
  onmessage: FingeringWorkerPort["onmessage"] = null;
  onerror: FingeringWorkerPort["onerror"] = null;
  messages: FingeringWork[] = [];
  terminated = false;
  postMessage(work: FingeringWork) { this.messages.push(work); }
  terminate() { this.terminated = true; }
  reply() { this.onmessage?.({ data: { token: this.messages.at(-1)!.token, result: { placed: [], suppressed: [] } } } as MessageEvent); }
}
function schedulerTask(index: number, key = "v1"): FingeringTask {
  return { key, work: { pageIndex: index, musicPageNumber: index + 1, sidecar, values: {}, musicalNotes: {}, metrics: { family: "fixture", digits: {} } } };
}
test("compact worker packets preserve every placement request and omit debug-only layers", () => {
  const { score, values, music } = requestFixture(true);
  score.raw_stem_contours = [{ debug_id: 1, contour: [[0, 0]], bbox: [] }];
  score.visual_groups[0].detected_notehead_contours = [[[0, 0]]];
  const packet = fingeringSidecarPacket(score);
  assert.equal(packet.raw_stem_contours, undefined);
  assert.equal(packet.visual_groups[0].detected_notehead_contours, undefined);
  assert.equal(packet.visual_groups[0].notehead_contours, score.visual_groups[0].notehead_contours);
  assert.deepEqual(buildFingeringRequests(5, 2, packet, values, music), buildFingeringRequests(5, 2, score, values, music));
});
test("scheduler bounds a long score, prioritizes visible pages and reuses unchanged results", () => {
  assert.deepEqual(prioritizedFingeringPages([0, 2, 3, 4, 5], [3, 4]), [3, 4, 5]);
  assert.deepEqual(prioritizedFingeringPages([0, 2, 3, 4, 5], [0, 2, 3, 4]), [0, 2, 3]);
  const worker = new FakeFingeringWorker();
  let output: ReadonlyMap<number, FingeringPageResult> = new Map();
  const scheduler = new FingeringScheduler(() => worker, pages => { output = pages; });
  const tasks = Array.from({ length: 100 }, (_, i) => schedulerTask(i));
  scheduler.update(tasks);
  for (let i = 0; i < 3; i++) worker.reply();
  assert.equal(output.size, 3); assert.equal(worker.messages.length, 3);
  scheduler.update(tasks.map(task => ({ ...task })));
  assert.equal(worker.messages.length, 3, "color/policy/selection updates need no work");
  scheduler.update(tasks.slice(1, 4)); worker.reply();
  assert.deepEqual([...output.keys()], [1, 2, 3]);
  assert.equal(worker.messages.length, 4);
  scheduler.dispose(); assert.equal(worker.terminated, true);
});
test("stale values, geometry and disposed document results cannot publish", () => {
  const workers: FakeFingeringWorker[] = [];
  let output: ReadonlyMap<number, FingeringPageResult> = new Map();
  const scheduler = new FingeringScheduler(() => { const worker = new FakeFingeringWorker(); workers.push(worker); return worker; }, pages => { output = pages; });
  scheduler.update([schedulerTask(0)]);
  const stale = workers[0].onmessage!;
  scheduler.update([schedulerTask(0, "changed-values")]);
  assert.equal(workers[0].terminated, true);
  stale({ data: { token: 1, result: { placed: ["wrong document"] } } } as MessageEvent);
  assert.equal(output.size, 0);
  workers[1].reply(); assert.equal(output.size, 1);
  const changed = schedulerTask(0, "changed-values"); changed.work.sidecar = structuredClone(sidecar);
  scheduler.update([changed]); assert.equal(output.size, 0);
  const before = output;
  scheduler.dispose(); workers[1].reply();
  assert.equal(output, before);
});
test("worker failure is local and timeouts terminate the task", async () => {
  let output: ReadonlyMap<number, FingeringPageResult> = new Map();
  const worker = new FakeFingeringWorker();
  const scheduler = new FingeringScheduler(() => worker, pages => { output = pages; }, 5);
  scheduler.update([schedulerTask(0)]);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.match(output.get(0)!.status, /timed out/); assert.equal(worker.terminated, true);
  scheduler.dispose();
  const failed = new FingeringScheduler(() => { throw new Error("worker unavailable"); }, pages => { output = pages; });
  failed.update([schedulerTask(1)]);
  assert.match(output.get(1)!.status, /unavailable/); failed.dispose();
});

const staff: AnnotationStaff = {
  staff_id: "staff-0-0", staff_group_index: 0, staff_index: 0, system_index: 0,
  lines: Array.from({ length: 5 }, (_, i) => [[10, 100 + i * 10], [300, 110 + i * 10]]),
  spacing: [[10, 10], [300, 10]], extent: [10, 100, 300, 150],
};
const sidecar: VisualSidecar = { version: 3, source_image_size: [400, 600], notes: [], visual_groups: [], annotation_geometry: { version: 1, staffs: [staff] } };

test("exclusions are content scoped, validated and survive serialization", () => {
  const id = "a".repeat(64);
  assert.equal(fingeringDocumentId(`/cache/${id}/`), id);
  assert.equal(fingeringDocumentId("session-job-123"), undefined);
  const policy = emptyFingeringPolicy(id);
  policy.pages[2] = { disabled: true, regions: [{ id: "region", rasterId: "image", bounds: [10, 20, 30, 40] }] };
  assert.deepEqual(parseFingeringPolicy(JSON.stringify(policy), id), policy);
  assert.throws(() => parseFingeringPolicy(JSON.stringify(policy), "b".repeat(64)), /invalid/);
  policy.pages[2].regions[0].bounds[0] = NaN;
  assert.throws(() => parseFingeringPolicy(JSON.stringify(policy), id), /invalid/);
});

test("anchor exclusions hide whole chords without changing values or positions and reject changed rasters", () => {
  const { score, values, music } = requestFixture(true);
  const requests = buildFingeringRequests(5, 2, score, values, music);
  const layout = { placed: [{ request: requests.requests[0], bounds: [90, 20, 110, 50] as VisualBBox,
    fontSize: 12, x: 100, baselines: [25, 35, 45], lane: 0 }], suppressed: [] };
  const original = JSON.stringify({ layout, values });
  const policy = emptyFingeringPolicy("a".repeat(64));
  policy.pages[5] = { disabled: false, regions: [{ id: "r", rasterId: "original", bounds: [95, 125, 105, 135] }] };
  assert.equal(applyFingeringPolicy(layout, policy, 5, "original")?.placed.length, 0);
  assert.equal(applyFingeringPolicy(layout, policy, 5, "changed")?.placed.length, 1);
  assert.equal(applyFingeringPolicy(layout, policy, 4, "original")?.placed.length, 1);
  policy.pages[5].regions = [];
  assert.deepEqual(applyFingeringPolicy(layout, policy, 5, "original"), layout);
  policy.pages[5].disabled = true;
  assert.equal(applyFingeringPolicy(layout, policy, 5, "original")?.placed.length, 0);
  policy.disabled = true;
  assert.equal(applyFingeringPolicy(layout, policy, 4, "original")?.placed.length, 0);
  assert.equal(JSON.stringify({ layout, values }), original);
});

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
  music["page-2-note-1"].tieStop = true;
  score.notes.push(score.notes[0]);
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.counts.pitched, 3);
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every(r => r.digits.length === 1));
  assert.equal(result.omissions[0].reason, "tie-continuation");
});

test("independent stems on one physical onset are suppressed instead of appearing as a false stack", () => {
  const { score, values, music } = requestFixture();
  score.visual_groups.forEach(g => { g.moment_id = "same"; });
  const result = buildFingeringRequests(5, 2, score, values, music);
  assert.equal(result.requests.length, 0);
  assert.ok(result.omissions.every(o => o.reason === "unsupported-voices"));
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

const metrics: FingeringFontMetrics = { family: "test-metrics", digits: Object.fromEntries(
  [1, 2, 3, 4, 5].map(d => [d, { left: 0.3, right: 0.3, ascent: 0.7, descent: 0.1 }])) };
function rectangleInk(rectangles: VisualBBox[]): ObstacleMap {
  return { width: 400, height: 600, bytes: 0, isClear: (bounds, clearance = 0) =>
    bounds[0] >= clearance && bounds[1] >= clearance && bounds[2] <= 400 - clearance && bounds[3] <= 600 - clearance &&
    !rectangles.some(rectangle => boxesOverlap(bounds, rectangle, clearance)) };
}

test("placement avoids a beam and a slur crossing the preferred lanes, deterministically", () => {
  const { score, values, music } = requestFixture();
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  const ink = rectangleInk([[75, 82, 120, 95], [130, 74, 190, 78]]);
  const first = layoutFingerings(requests, [staff], ink, metrics);
  assert.equal(first.placed.length, 3);
  assert.ok(first.placed.every(p => ink.isClear(p.bounds, 1.8)));
  assert.deepEqual(layoutFingerings(requests, [staff], ink, metrics), first);
  assert.ok(first.placed.some(p => p.lane > 0));
});

test("adjacent digit collisions are hard constraints including against reserved overlays", () => {
  const { score, values, music } = requestFixture();
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  requests.forEach(r => { r.anchor[0] = 100; r.digits[0].anchor[0] = 100; });
  const reserved: VisualBBox[] = [[80, 84, 120, 96]];
  const result = layoutFingerings(requests, [staff], rectangleInk([]), metrics, reserved);
  for (const [i, placed] of result.placed.entries()) {
    assert.ok(!reserved.some(box => boxesOverlap(box, placed.bounds, 1.8)));
    assert.ok(!result.placed.slice(i + 1).some(other => boxesOverlap(placed.bounds, other.bounds, 1.8)));
  }
  assert.equal(result.placed.length + result.suppressed.length, 3);
});

test("a tall chord is one collision object with preserved digit-to-note baselines", () => {
  const { score, values, music } = requestFixture(true);
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  const result = layoutFingerings(requests, [staff], rectangleInk([]), metrics);
  assert.equal(result.placed.length, 1);
  const p = result.placed[0];
  assert.equal(p.baselines.length, 3);
  assert.ok(p.bounds[3] - p.bounds[1] > 30);
  assert.ok(p.baselines[0] < p.baselines[1] && p.baselines[1] < p.baselines[2]);
});

test("no legal whitespace and unreadable sizes suppress instead of escaping or shrinking", () => {
  const { score, values, music } = requestFixture();
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  const result = layoutFingerings(requests, [staff], rectangleInk([[0, 0, 400, 600]]), metrics);
  assert.equal(result.placed.length, 0);
  assert.equal(result.suppressed.length, 3);
  assert.ok(result.suppressed.every(s => s.reason === "printed-ink"));
  requests[0].spacing = 5;
  assert.equal(layoutFingerings([requests[0]], [staff], rectangleInk([]), metrics).suppressed[0].reason, "minimum-size");
});

test("neighboring system boundaries constrain tall stacks", () => {
  const { score, values, music } = requestFixture(true);
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  const neighbor: AnnotationStaff = { ...staff, staff_id: "previous", system_index: 10, extent: [10, 40, 300, 95] };
  const result = layoutFingerings(requests, [neighbor, staff], rectangleInk([]), metrics);
  assert.equal(result.placed.length, 0);
  assert.equal(result.suppressed[0].reason, "system-boundary");
});

test("a measure baseline clears the full stem envelope instead of weaving through beam gaps", () => {
  const { score, values, music } = requestFixture();
  const { requests } = buildFingeringRequests(5, 2, score, values, music);
  requests[1].notationTop = 60;
  const result = layoutFingerings(requests, [staff], rectangleInk([]), metrics);
  assert.equal(result.placed.length, 3);
  assert.ok(result.placed.every(p => p.bounds[3] < 60));
  assert.equal(new Set(result.placed.map(p => p.bounds[3])).size, 1);
});
