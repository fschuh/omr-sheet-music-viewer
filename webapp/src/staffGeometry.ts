import type { AnnotationStaff, VisualSidecar } from "./types";

export const ANNOTATION_GEOMETRY_CAPABILITY = "physical-staff-curves-v1";

/** Reason codes, kept identical to the producer's so both sides read alike. */
export type AnnotationGeometryReason =
  | "unsupported-version" | "missing-staffs" | "invalid-staff-entry" | "invalid-staff-indices"
  | "duplicate-staff-identity" | "invalid-line-count" | "inconsistent-sample-count"
  | "coordinates-out-of-bounds" | "non-increasing-x" | "invalid-spacing-samples"
  | "misaligned-sample-x" | "implausible-staff-spacing" | "spacing-disagreement"
  | "extent-disagreement" | "missing-staff-reference";

export interface AnnotationGeometryRejection {
  ok: false;
  reason: AnnotationGeometryReason;
  message: string;
  staffId?: string;
  staffGroupIndex?: number;
  staffIndex?: number;
  systemIndex?: number;
  sampleIndex?: number;
  x?: number;
}
export type AnnotationGeometryResult = { ok: true; staffs: readonly AnnotationStaff[] } | AnnotationGeometryRejection;

const MESSAGES: Record<AnnotationGeometryReason, string> = {
  "unsupported-version": "Unsupported annotation geometry version",
  "missing-staffs": "Annotation geometry requires physical staffs",
  "invalid-staff-entry": "Invalid physical staff",
  "invalid-staff-indices": "Invalid physical staff indices",
  "duplicate-staff-identity": "Duplicate or invalid physical staff identity",
  "invalid-line-count": "Physical staff requires five sampled lines",
  "inconsistent-sample-count": "Staff lines require a common sample grid",
  "coordinates-out-of-bounds": "Staff coordinates must be finite and inside the source image",
  "non-increasing-x": "Staff samples must have increasing x",
  "invalid-spacing-samples": "Invalid local spacing samples",
  "misaligned-sample-x": "Staff samples must share x coordinates",
  "implausible-staff-spacing": "Unordered lines or implausible staff spacing",
  "spacing-disagreement": "Local spacing disagrees with staff lines",
  "extent-disagreement": "Staff extent disagrees with sampled lines",
  "missing-staff-reference": "Visual group references missing physical staff geometry",
};

function reject(reason: AnnotationGeometryReason, details: Omit<AnnotationGeometryRejection, "ok" | "reason" | "message"> = {}): AnnotationGeometryRejection {
  return { ok: false, reason, message: MESSAGES[reason], ...details };
}

function staffIdentity(staff: Partial<AnnotationStaff>): Omit<AnnotationGeometryRejection, "ok" | "reason" | "message"> {
  const details: Omit<AnnotationGeometryRejection, "ok" | "reason" | "message"> = {};
  if (typeof staff.staff_id === "string" && staff.staff_id) details.staffId = staff.staff_id;
  if (Number.isInteger(staff.staff_group_index)) details.staffGroupIndex = staff.staff_group_index;
  if (Number.isInteger(staff.staff_index)) details.staffIndex = staff.staff_index;
  if (Number.isInteger(staff.system_index)) details.systemIndex = staff.system_index;
  return details;
}

/**
 * Validate advertised v1 geometry and say why when it does not hold.
 *
 * The caller needs the cause, not only the absence: a payload this viewer cannot
 * read is a contract incompatibility, which is a different thing from a producer
 * that examined its own detection and refused it.
 */
export function validateAnnotationGeometry(sidecar: VisualSidecar): AnnotationGeometryResult {
  const geometry = sidecar.annotation_geometry;
  if (!geometry || geometry.version !== 1) return reject("unsupported-version");
  if (!Array.isArray(geometry.staffs) || !geometry.staffs.length) return reject("missing-staffs");
  const keys = new Set<string>();
  const ids = new Set<string>();
  const [width, height] = sidecar.source_image_size;
  for (const staff of geometry.staffs) {
    if (!staff || typeof staff !== "object") return reject("invalid-staff-entry");
    const identity = staffIdentity(staff);
    if (![staff.staff_group_index, staff.staff_index, staff.system_index].every(i => Number.isInteger(i) && i >= 0)) return reject("invalid-staff-indices", identity);
    const key = `${staff.staff_group_index}:${staff.staff_index}`;
    if (!staff.staff_id || typeof staff.staff_id !== "string" || keys.has(key) || ids.has(staff.staff_id)) return reject("duplicate-staff-identity", identity);
    keys.add(key); ids.add(staff.staff_id);
    if (!Array.isArray(staff.lines) || staff.lines.length !== 5 || !staff.lines.every(Array.isArray)) return reject("invalid-line-count", identity);
    const size = staff.lines[0].length;
    if (size < 2 || !staff.lines.every(line => line.length === size)) return reject("inconsistent-sample-count", identity);
    if (!Array.isArray(staff.spacing) || staff.spacing.length !== size) return reject("invalid-spacing-samples", identity);
    for (let i = 0; i < size; i++) {
      const points = staff.lines.map(line => line[i]);
      const at = { ...identity, sampleIndex: i };
      if (!points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height)) return reject("coordinates-out-of-bounds", at);
      const x = points[0][0], unit = (points[4][1] - points[0][1]) / 4;
      const spacing = staff.spacing[i];
      if (!Array.isArray(spacing) || spacing.length !== 2 || !spacing.every(Number.isFinite)) return reject("invalid-spacing-samples", { ...at, x });
      if (points.some(p => p[0] !== x) || spacing[0] !== x) return reject("misaligned-sample-x", { ...at, x });
      if (i > 0 && staff.lines[0][i - 1][0] >= x) return reject("non-increasing-x", { ...at, x });
      if (unit < 1 || unit > height / 10 || points.slice(1).some((p, j) => p[1] - points[j][1] < unit * 0.5 || p[1] - points[j][1] > unit * 1.5)) return reject("implausible-staff-spacing", { ...at, x });
      if (Math.abs(spacing[1] - unit) > 0.01) return reject("spacing-disagreement", { ...at, x });
    }
    const expected = [staff.lines[0][0][0], Math.min(...staff.lines[0].map(p => p[1])), staff.lines[0][size - 1][0], Math.max(...staff.lines[4].map(p => p[1]))];
    if (!Array.isArray(staff.extent) || staff.extent.length !== 4 || staff.extent.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > 0.01)) return reject("extent-disagreement", identity);
  }
  const orphan = sidecar.visual_groups.find(g => !keys.has(`${g.staff_group_index}:${g.staff_index}`));
  if (orphan) return reject("missing-staff-reference", { staffGroupIndex: orphan.staff_group_index, staffIndex: orphan.staff_index });
  return { ok: true, staffs: geometry.staffs };
}

/** Compatibility wrapper for callers that only need the staffs or nothing. */
export function annotationStaffs(sidecar: VisualSidecar): readonly AnnotationStaff[] | undefined {
  const result = validateAnnotationGeometry(sidecar);
  return result.ok ? result.staffs : undefined;
}

/** Interpolate in the producer's common grid; never extrapolate past staff extent. */
export function staffAt(staff: AnnotationStaff, x: number): { top: number; bottom: number; spacing: number } | undefined {
  const grid = staff.spacing;
  if (!Number.isFinite(x) || x < grid[0][0] || x > grid[grid.length - 1][0]) return undefined;
  const end = Math.max(1, grid.findIndex(p => p[0] >= x));
  const t = (x - grid[end - 1][0]) / (grid[end][0] - grid[end - 1][0]);
  const value = (samples: number[][]) => samples[end - 1][1] * (1 - t) + samples[end][1] * t;
  return { top: value(staff.lines[0]), bottom: value(staff.lines[4]), spacing: value(grid) };
}
