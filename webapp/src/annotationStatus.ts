import { validateAnnotationGeometry } from "./staffGeometry";
import type { AnnotationGeometryRejectionRecord, VisualSidecar } from "./types";

/**
 * Why optional annotations are, or are not, available for one page.
 *
 * Absence has several different causes and only one of them is fixed by running
 * the page again. Telling a reader to regenerate a page the producer has already
 * examined and refused sends them round a loop that cannot end.
 */
export type AnnotationSupportState =
  /** Geometry and page ink are both present and readable. */
  | "supported"
  /** Written before the capability existed: the producer never reached a verdict. */
  | "legacy-capability-missing"
  /** The producer or the worker examined this detection and refused it. */
  | "producer-rejected"
  /** Geometry is advertised but this viewer cannot read it: a contract mismatch. */
  | "malformed-geometry"
  /** Geometry is usable; the page ink analysis it also needs is not. */
  | "ink-unavailable";

/** What, if anything, the reader can usefully do. Never an automatic retry. */
export type AnnotationAction = "regenerate" | "none";

export interface AnnotationStatus {
  state: AnnotationSupportState;
  /** Stable reason code when one is known, from either side of the contract. */
  reason?: string;
  /** The stage that reached the verdict, when the producer recorded one. */
  stage?: string;
  /** The line shown next to the page. */
  message: string;
  /** Optional one-line locator, for a details view rather than the summary. */
  detail?: string;
  action: AnnotationAction;
}

export const SUPPORTED_MESSAGE = "Placing fingerings…";

function locator(record: AnnotationGeometryRejectionRecord | undefined): string | undefined {
  if (!record) return undefined;
  const parts = [record.reason, record.stage && `at ${record.stage}`, record.staff_id && `staff ${record.staff_id}`,
    record.sample_index !== undefined && `sample ${record.sample_index}`,
    record.x !== undefined && `x=${Math.round(record.x)}`].filter(Boolean);
  return parts.join(", ");
}

/**
 * Classify one page's optional-annotation support.
 *
 * Page ink is generated only when geometry is valid, so its absence after a
 * rejection is expected rather than an independent failure: the rejection stays
 * the explanation. An ink failure is reported on its own only when the geometry
 * it depends on is in fact usable.
 */
export function annotationStatus(sidecar: VisualSidecar): AnnotationStatus {
  if (sidecar.annotation_geometry) {
    const validated = validateAnnotationGeometry(sidecar);
    if (!validated.ok) {
      const where = [validated.staffId && `staff ${validated.staffId}`,
        validated.sampleIndex !== undefined && `sample ${validated.sampleIndex}`].filter(Boolean).join(", ");
      return {
        state: "malformed-geometry", reason: validated.reason, stage: "viewer-validation",
        message: "Staff geometry is not supported by this viewer; fingerings are unavailable for this page",
        detail: [validated.message, where].filter(Boolean).join(" — "),
        action: "none",
      };
    }
    if (!sidecar.ink_obstacles) {
      return {
        state: "ink-unavailable", reason: "ink-analysis-unavailable",
        message: sidecar.annotation_analysis_error ?? "Page ink unavailable; regenerate this page",
        action: "regenerate",
      };
    }
    return { state: "supported", message: SUPPORTED_MESSAGE, action: "none" };
  }
  const rejection = sidecar.annotation_geometry_rejection;
  if (rejection || sidecar.annotation_geometry_error) {
    return {
      state: "producer-rejected", reason: rejection?.reason ?? "validation-failed", stage: rejection?.stage,
      message: "Staff geometry was rejected; fingerings are unavailable for this page",
      detail: locator(rejection) ?? sidecar.annotation_geometry_error,
      action: "none",
    };
  }
  return {
    state: "legacy-capability-missing", reason: "capability-absent",
    message: "Staff geometry unavailable; regenerate to add geometry",
    action: "regenerate",
  };
}
