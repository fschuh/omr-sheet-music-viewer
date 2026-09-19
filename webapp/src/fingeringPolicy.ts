import type { FingeringLayout } from "./fingeringLayout";
import type { VisualBBox } from "./types";

export interface FingeringRegion { id: string; rasterId: string; bounds: VisualBBox }
export interface FingeringPagePolicy { disabled: boolean; regions: FingeringRegion[] }
export interface FingeringPolicy {
  version: 1; documentId: string; disabled: boolean;
  pages: Record<number, FingeringPagePolicy>;
}
export const policyKey = (id: string) => `homr.fingering-policy.v1.${id}`;
export function fingeringDocumentId(cachePath?: string): string | undefined {
  const last = cachePath?.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
  return last && /^[a-f0-9]{64}$/i.test(last) ? last.toLowerCase() : undefined;
}
export function emptyFingeringPolicy(id: string): FingeringPolicy {
  return { version: 1, documentId: id, disabled: false, pages: {} };
}
export function parseFingeringPolicy(raw: string | null, id: string): FingeringPolicy {
  if (raw === null) return emptyFingeringPolicy(id);
  const value = JSON.parse(raw) as FingeringPolicy;
  if (!value || value.version !== 1 || value.documentId !== id || typeof value.disabled !== "boolean"
    || !value.pages || typeof value.pages !== "object" || Array.isArray(value.pages)
    || Object.entries(value.pages).some(([index, page]) => !/^\d+$/.test(index) || !page
      || typeof page.disabled !== "boolean" || !Array.isArray(page.regions) || page.regions.length > 1000
      || page.regions.some(region => !region || typeof region.id !== "string" || typeof region.rasterId !== "string"
        || !Array.isArray(region.bounds) || region.bounds.length !== 4 || !region.bounds.every(Number.isFinite)
        || region.bounds[0] < 0 || region.bounds[1] < 0 || region.bounds[0] >= region.bounds[2] || region.bounds[1] >= region.bounds[3]))) {
    throw new Error("Saved fingering exclusions are invalid; they were not overwritten");
  }
  return value;
}
export function anchorInRegion(anchor: readonly number[], bounds: VisualBBox): boolean {
  return anchor[0] >= bounds[0] && anchor[0] <= bounds[2] && anchor[1] >= bounds[1] && anchor[1] <= bounds[3];
}
/** Partial exclusion hides the complete stack; it must not look like a complete chord. */
export function applyFingeringPolicy(layout: FingeringLayout | undefined, policy: FingeringPolicy,
  pageIndex: number, rasterId?: string): FingeringLayout | undefined {
  if (!layout) return undefined;
  const page = policy.pages[pageIndex];
  const regions = page?.regions.filter(region => region.rasterId === rasterId) ?? [];
  return { ...layout, placed: policy.disabled || page?.disabled ? [] : layout.placed.filter(label =>
    !label.request.digits.some(digit => regions.some(region => anchorInRegion(digit.anchor, region.bounds)))) };
}
