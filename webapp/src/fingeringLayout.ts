import type { FingeringRequest } from "./scoreFingerings";
import type { ObstacleMap } from "./fingeringObstacles";
import type { AnnotationStaff, VisualBBox } from "./types";
import { staffAt } from "./staffGeometry";

export const FINGERING_LAYOUT_VERSION = "staff-lanes-v1";
export const FINGERING_FONT = "Arial, sans-serif";
const FONT_SPACES = 1.2;
const MIN_FONT_PIXELS = 10;
const CLEARANCE_SPACES = 0.18;
const SEARCH_WIDTH = 24;

export interface DigitMetric { left: number; right: number; ascent: number; descent: number }
export interface FingeringFontMetrics {
  family: string;
  /** Measured with alphabetic baseline and centered text, normalized by font size. */
  digits: Record<number, DigitMetric>;
}
export interface PlacedFingering {
  request: FingeringRequest;
  bounds: VisualBBox;
  fontSize: number;
  x: number;
  baselines: number[];
  lane: number;
}
export type PlacementReason = "minimum-size" | "system-boundary" | "printed-ink" | "overlay-collision" | "crowded";
export interface FingeringLayout {
  placed: PlacedFingering[];
  suppressed: { request: FingeringRequest; reason: PlacementReason }[];
}

export function measureFingeringFont(context: Pick<CanvasRenderingContext2D, "font" | "textAlign" | "textBaseline" | "measureText">): FingeringFontMetrics {
  context.font = `100px ${FINGERING_FONT}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const digits: Record<number, DigitMetric> = {};
  for (let digit = 1; digit <= 5; digit++) {
    const measured = context.measureText(String(digit));
    const metric = { left: measured.actualBoundingBoxLeft / 100, right: measured.actualBoundingBoxRight / 100,
      ascent: measured.actualBoundingBoxAscent / 100, descent: measured.actualBoundingBoxDescent / 100 };
    if (!Object.values(metric).every(Number.isFinite) || metric.left + metric.right <= 0 || metric.ascent + metric.descent <= 0) {
      throw new Error("Fingering font metrics unavailable");
    }
    digits[digit] = metric;
  }
  return { family: FINGERING_FONT, digits };
}

export function boxesOverlap(a: VisualBBox, b: VisualBBox, clearance = 0): boolean {
  return a[0] - clearance < b[2] && a[2] + clearance > b[0] && a[1] - clearance < b[3] && a[3] + clearance > b[1];
}

function systemRegion(request: FingeringRequest, staffs: readonly AnnotationStaff[], height: number): [number, number] {
  const own = staffs.filter(s => s.system_index === request.staff.system_index);
  const top = Math.min(...own.map(s => s.extent[1]));
  const bottom = Math.max(...own.map(s => s.extent[3]));
  const above = staffs.filter(s => s.system_index !== request.staff.system_index && s.extent[3] <= top);
  const below = staffs.filter(s => s.system_index !== request.staff.system_index && s.extent[1] >= bottom);
  return [above.length ? (top + Math.max(...above.map(s => s.extent[3]))) / 2 : 0,
    below.length ? (bottom + Math.min(...below.map(s => s.extent[1]))) / 2 : height];
}

function candidatesFor(
  request: FingeringRequest, neighbors: readonly FingeringRequest[], staffs: readonly AnnotationStaff[],
  ink: ObstacleMap, metrics: FingeringFontMetrics, reserved: readonly VisualBBox[],
): { candidates: PlacedFingering[]; reason: PlacementReason } {
  const fontSize = request.spacing * FONT_SPACES;
  if (fontSize < MIN_FONT_PIXELS) return { candidates: [], reason: "minimum-size" };
  const digitMetrics = request.digits.map(d => metrics.digits[d.value.finger]);
  if (digitMetrics.some(m => !m || !Object.values(m).every(Number.isFinite))) throw new Error("Missing fingering digit metrics");
  const ascent = Math.max(...digitMetrics.map(m => m.ascent)) * fontSize;
  const descent = Math.max(...digitMetrics.map(m => m.descent)) * fontSize;
  const lineHeight = (ascent + descent) + request.spacing * 0.12;
  const height = ascent + descent + (request.digits.length - 1) * lineHeight;
  const left = Math.max(...digitMetrics.map(m => m.left)) * fontSize;
  const right = Math.max(...digitMetrics.map(m => m.right)) * fontSize;
  const [systemTop, systemBottom] = systemRegion(request, staffs, ink.height);
  const previousX = Math.max(request.staff.extent[0], ...neighbors.filter(n => n.anchor[0] < request.anchor[0]).map(n => n.anchor[0]));
  const nextX = Math.min(request.staff.extent[2], ...neighbors.filter(n => n.anchor[0] > request.anchor[0]).map(n => n.anchor[0]));
  const minX = Math.max(request.staff.extent[0], (previousX + request.anchor[0]) / 2);
  const maxX = Math.min(request.staff.extent[2], (nextX + request.anchor[0]) / 2);
  const clearance = request.spacing * CLEARANCE_SPACES;
  const candidates: PlacedFingering[] = [];
  let reason: PlacementReason = "system-boundary";
  for (let lane = 0; lane < 5; lane++) {
    for (const shift of [0, -0.3, 0.3]) {
      const x = request.anchor[0] + shift * request.spacing;
      const staff = staffAt(request.staff, x);
      if (!staff || x < minX || x > maxX) continue;
      const anchor = request.side === "above"
        ? Math.min(staff.top, ...request.digits.map(d => d.anchor[1]))
        : Math.max(staff.bottom, ...request.digits.map(d => d.anchor[1]));
      const edge = anchor + (request.side === "above" ? -1 : 1) * request.spacing * (0.65 + lane * 0.85);
      const top = request.side === "above" ? edge - height : edge;
      const bounds: VisualBBox = [x - left, top, x + right, top + height];
      if (bounds[1] - clearance < systemTop || bounds[3] + clearance > systemBottom || bounds[0] - clearance < 0 || bounds[2] + clearance > ink.width) continue;
      if (!ink.isClear(bounds, clearance)) { reason = "printed-ink"; continue; }
      if (reserved.some(box => boxesOverlap(bounds, box, clearance))) { reason = "overlay-collision"; continue; }
      candidates.push({ request, bounds, x, fontSize, baselines: request.digits.map((_, i) => top + ascent + i * lineHeight), lane });
    }
  }
  return { candidates, reason };
}

/** Bounded beam search over short measure/staff sequences, with hard collision constraints. */
export function layoutFingerings(
  requests: readonly FingeringRequest[], staffs: readonly AnnotationStaff[], ink: ObstacleMap,
  metrics: FingeringFontMetrics, reserved: readonly VisualBBox[] = [],
): FingeringLayout {
  const result: FingeringLayout = { placed: [], suppressed: [] };
  const groups = new Map<string, FingeringRequest[]>();
  for (const request of [...requests].sort((a, b) => a.staff.system_index - b.staff.system_index || a.staff.staff_index - b.staff.staff_index || a.measure - b.measure || a.anchor[0] - b.anchor[0] || a.id.localeCompare(b.id))) {
    const key = `${request.staff.staff_id}:${request.measure}`;
    const group = groups.get(key) ?? [];
    group.push(request); groups.set(key, group);
  }
  interface State { score: number; placed: PlacedFingering[]; suppressed: FingeringLayout["suppressed"]; last?: PlacedFingering; order: number }
  let order = 0;
  for (const sequence of groups.values()) {
    // A pathological measure cannot grow a search history without bound.
    for (let start = 0; start < sequence.length; start += 32) {
      let states: State[] = [{ score: 0, placed: [], suppressed: [], order: order++ }];
      for (const request of sequence.slice(start, start + 32)) {
        const { candidates, reason } = candidatesFor(request, sequence, staffs, ink, metrics,
          [...reserved, ...result.placed.map(p => p.bounds)]);
        const next: State[] = [];
        for (const state of states) {
          next.push({ ...state, score: state.score + 24 * request.digits.length,
            suppressed: [...state.suppressed, { request, reason: candidates.length ? "crowded" : reason }], order: order++ });
          for (const candidate of candidates) {
            if (state.placed.some(p => boxesOverlap(p.bounds, candidate.bounds, request.spacing * CLEARANCE_SPACES))) continue;
            const previous = state.last;
            const baseline = request.side === "above" ? candidate.bounds[3] : candidate.bounds[1];
            const previousBaseline = previous && (request.side === "above" ? previous.bounds[3] : previous.bounds[1]);
            const continuity = previousBaseline === undefined ? 0 : Math.abs(baseline - previousBaseline) / request.spacing;
            const score = state.score + candidate.lane * 0.65 + Math.abs(candidate.x - request.anchor[0]) / request.spacing + continuity * 1.2;
            next.push({ score, placed: [...state.placed, candidate], suppressed: state.suppressed, last: candidate, order: order++ });
          }
        }
        next.sort((a, b) => a.score - b.score || a.order - b.order);
        states = next.slice(0, SEARCH_WIDTH);
      }
      result.placed.push(...states[0].placed);
      result.suppressed.push(...states[0].suppressed);
    }
  }
  return result;
}
