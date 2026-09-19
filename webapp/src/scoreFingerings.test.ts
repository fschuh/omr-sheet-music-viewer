import assert from "node:assert/strict";
import test from "node:test";
import { annotationStaffs, staffAt } from "./staffGeometry";
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
