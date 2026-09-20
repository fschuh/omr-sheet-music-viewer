import assert from "node:assert/strict";
import test from "node:test";
import { annotationStatus } from "./annotationStatus";
import { annotationStaffs, staffAt, validateAnnotationGeometry } from "./staffGeometry";
import type { AnnotationStaff, VisualSidecar } from "./types";

const WIDTH = 1000, HEIGHT = 1400;

function staff(overrides: Partial<AnnotationStaff> = {}, samples = [10, 110, 210]): AnnotationStaff {
  const unit = 10;
  const lines = [0, 1, 2, 3, 4].map(line => samples.map(x => [x, 100 + line * unit + x * 0.01] as [number, number]));
  return {
    staff_id: "staff-0-0", staff_group_index: 0, staff_index: 0, system_index: 0,
    lines, spacing: samples.map(x => [x, unit] as [number, number]),
    extent: [lines[0][0][0], Math.min(...lines[0].map(p => p[1])), lines[0][lines[0].length - 1][0], Math.max(...lines[4].map(p => p[1]))],
    ...overrides,
  };
}

function sidecar(overrides: Partial<VisualSidecar> = {}, staffs: AnnotationStaff[] = [staff()]): VisualSidecar {
  return {
    version: 3, source_image_size: [WIDTH, HEIGHT], notes: [], visual_groups: [],
    annotation_geometry: { version: 1, staffs },
    ink_obstacles: { version: 1, encoding: "base64-bitset-msb", source_image_size: [WIDTH, HEIGHT],
      mask_size: [10, 14], source_pixels_per_cell: [100, 100], raster_sha256: "abc", threshold: 0.5, data: "" },
    ...overrides,
  } as VisualSidecar;
}

test("valid geometry is supported and keeps interpolation inside the staff extent", () => {
  const document = sidecar();
  const result = validateAnnotationGeometry(document);
  assert.equal(result.ok, true);
  assert.equal(annotationStaffs(document)?.length, 1);
  assert.equal(annotationStatus(document).state, "supported");
  const inside = staffAt(document.annotation_geometry!.staffs[0], 110);
  assert.ok(inside && Math.abs(inside.spacing - 10) < 1e-9);
  assert.equal(staffAt(document.annotation_geometry!.staffs[0], 9.9), undefined);
  assert.equal(staffAt(document.annotation_geometry!.staffs[0], 210.1), undefined);
});

test("each advertised-geometry defect returns its own reason code", () => {
  const cases: [string, () => VisualSidecar][] = [
    ["unsupported-version", () => sidecar({ annotation_geometry: { version: 2, staffs: [staff()] } as never })],
    ["missing-staffs", () => sidecar({ annotation_geometry: { version: 1, staffs: [] } })],
    ["invalid-staff-indices", () => sidecar({}, [staff({ staff_index: -1 })])],
    ["duplicate-staff-identity", () => sidecar({}, [staff(), staff({ staff_id: "other" })])],
    ["invalid-line-count", () => sidecar({}, [staff({ lines: [[[10, 10]], [[10, 20]]] as never })])],
    ["inconsistent-sample-count", () => { const s = staff(); s.lines[2] = s.lines[2].slice(0, 2); return sidecar({}, [s]); }],
    ["coordinates-out-of-bounds", () => { const s = staff(); s.lines[0][0] = [10, HEIGHT + 5]; return sidecar({}, [s]); }],
    ["non-increasing-x", () => { const s = staff(); for (const line of s.lines) line[1][0] = line[0][0] + 0.0; s.spacing[1][0] = s.spacing[0][0]; return sidecar({}, [s]); }],
    ["misaligned-sample-x", () => { const s = staff(); s.lines[3][1][0] += 1; return sidecar({}, [s]); }],
    ["implausible-staff-spacing", () => { const s = staff(); s.lines[1][0][1] = s.lines[0][0][1] + 0.4; return sidecar({}, [s]); }],
    ["spacing-disagreement", () => { const s = staff(); s.spacing[0][1] = 11; return sidecar({}, [s]); }],
    ["extent-disagreement", () => { const s = staff(); s.extent = [s.extent[0] + 2, s.extent[1], s.extent[2], s.extent[3]]; return sidecar({}, [s]); }],
    ["missing-staff-reference", () => sidecar({ visual_groups: [{ staff_group_index: 9, staff_index: 0 }] as never })],
  ];
  for (const [reason, build] of cases) {
    const result = validateAnnotationGeometry(build());
    assert.equal(result.ok, false, `${reason} should not validate`);
    assert.equal((result as { reason: string }).reason, reason);
  }
});

test("a payload this viewer cannot read is a contract mismatch, not a missing capability", () => {
  const broken = staff();
  broken.spacing[1][1] = 99;
  const status = annotationStatus(sidecar({}, [broken]));
  assert.equal(status.state, "malformed-geometry");
  assert.equal(status.reason, "spacing-disagreement");
  assert.equal(status.action, "none");
  assert.match(status.detail ?? "", /staff-0-0/);
  assert.doesNotMatch(status.message, /regenerate/i);
});

test("a producer rejection explains itself and never invites an unchanged retry", () => {
  const status = annotationStatus(sidecar({
    annotation_geometry: undefined,
    ink_obstacles: undefined,
    annotation_geometry_error: "Unordered lines or implausible staff spacing",
    annotation_geometry_rejection: {
      version: 1, reason: "implausible-staff-spacing", stage: "producer-validation",
      message: "Unordered lines or implausible staff spacing",
      staff_id: "staff-2-1", staff_group_index: 2, staff_index: 1, system_index: 2,
      sample_index: 33, x: 439.609375, gaps: [16.73, 28.77, 17.93, 11.29],
    },
  }));
  assert.equal(status.state, "producer-rejected");
  assert.equal(status.reason, "implausible-staff-spacing");
  assert.equal(status.stage, "producer-validation");
  assert.equal(status.action, "none");
  assert.match(status.detail ?? "", /staff staff-2-1, sample 33, x=440/);
  assert.doesNotMatch(status.message, /regenerate/i);
});

test("a rejection stays the explanation even though the ink it gates is also absent", () => {
  const status = annotationStatus(sidecar({
    annotation_geometry: undefined, ink_obstacles: undefined,
    annotation_geometry_error: "Unordered lines or implausible staff spacing",
  }));
  assert.equal(status.state, "producer-rejected");
  assert.doesNotMatch(status.message, /ink/i);
});

test("an ink failure is reported on its own only when the geometry it needs is usable", () => {
  const status = annotationStatus(sidecar({
    ink_obstacles: undefined, annotation_analysis_error: "Page raster unreadable",
  }));
  assert.equal(status.state, "ink-unavailable");
  assert.equal(status.message, "Page raster unreadable");
  assert.equal(status.action, "regenerate");
});

test("an artifact from before the capability keeps its targeted regeneration offer", () => {
  const status = annotationStatus(sidecar({ annotation_geometry: undefined, ink_obstacles: undefined }));
  assert.equal(status.state, "legacy-capability-missing");
  assert.equal(status.reason, "capability-absent");
  assert.equal(status.action, "regenerate");
  assert.match(status.message, /regenerate/i);
});

test("a rejected page carries no full grid into the message the reader sees", () => {
  const status = annotationStatus(sidecar({
    annotation_geometry: undefined, ink_obstacles: undefined,
    annotation_geometry_rejection: {
      version: 1, reason: "implausible-staff-spacing", stage: "worker-post-scale",
      message: "Unordered lines or implausible staff spacing", sample_index: 4, x: 12.5,
    },
  }));
  assert.ok((status.detail ?? "").length < 120);
  assert.equal(status.stage, "worker-post-scale");
});
