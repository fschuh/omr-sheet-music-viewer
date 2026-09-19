import type { AnnotationStaff, VisualSidecar } from "./types";

export const ANNOTATION_GEOMETRY_CAPABILITY = "physical-staff-curves-v1";

export function annotationStaffs(sidecar: VisualSidecar): readonly AnnotationStaff[] | undefined {
  const geometry = sidecar.annotation_geometry;
  if (!geometry || geometry.version !== 1 || !Array.isArray(geometry.staffs) || !geometry.staffs.length) return undefined;
  const keys = new Set<string>();
  const ids = new Set<string>();
  const [width, height] = sidecar.source_image_size;
  for (const staff of geometry.staffs) {
    if (!staff || ![staff.staff_group_index, staff.staff_index, staff.system_index].every(i => Number.isInteger(i) && i >= 0)) return undefined;
    const key = `${staff.staff_group_index}:${staff.staff_index}`;
    if (!staff.staff_id || keys.has(key) || ids.has(staff.staff_id)) return undefined;
    keys.add(key); ids.add(staff.staff_id);
    if (!Array.isArray(staff.lines) || staff.lines.length !== 5 || !staff.lines.every(Array.isArray)) return undefined;
    const size = staff.lines[0].length;
    if (size < 2 || !staff.lines.every(line => line.length === size) || !Array.isArray(staff.spacing) || staff.spacing.length !== size) return undefined;
    for (let i = 0; i < size; i++) {
      const points = staff.lines.map(line => line[i]);
      if (!points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height)) return undefined;
      const x = points[0][0], unit = (points[4][1] - points[0][1]) / 4;
      if (unit < 1 || unit > height / 10 || points.some(p => p[0] !== x) || (i > 0 && staff.lines[0][i - 1][0] >= x)) return undefined;
      if (points.slice(1).some((p, j) => p[1] - points[j][1] < unit * 0.5 || p[1] - points[j][1] > unit * 1.5)) return undefined;
      const spacing = staff.spacing[i];
      if (!Array.isArray(spacing) || spacing.length !== 2 || spacing[0] !== x || !Number.isFinite(spacing[1]) || Math.abs(spacing[1] - unit) > 0.01) return undefined;
    }
    const expected = [staff.lines[0][0][0], Math.min(...staff.lines[0].map(p => p[1])), staff.lines[0][size - 1][0], Math.max(...staff.lines[4].map(p => p[1]))];
    if (!Array.isArray(staff.extent) || staff.extent.length !== 4 || staff.extent.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > 0.01)) return undefined;
  }
  return sidecar.visual_groups.every(g => keys.has(`${g.staff_group_index}:${g.staff_index}`)) ? geometry.staffs : undefined;
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
