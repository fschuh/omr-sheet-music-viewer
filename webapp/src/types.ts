export type VisualPoint = [number, number];
export type VisualBBox = [number, number, number, number];

export interface NoteheadEllipse {
  center: VisualPoint;
  rx: number;
  ry: number;
  angle: number;
}

export interface VisualSidecarNote {
  musicxml_id: string;
  part: number;
  measure: number;
  musicxml_staff_number: number;
  voice: number;
  pitch: string | null;
  duration: string;
  match_confidence: number;
  visual_group_id: string | null;
  alignment_method:
    | "structural"
    | "stem_repair"
    | "sequence_repair"
    | "cross_staff_repair"
    | "attention"
    | "none";
}

export interface VisualGroup {
  visual_group_id: string;
  staff_group_index: number;
  staff_index: number;
  staff_position: number;
  center: VisualPoint;
  bbox: VisualBBox | [];
  notehead_ellipses?: NoteheadEllipse[];
  notehead_contours: VisualPoint[][];
  detected_notehead_contours?: VisualPoint[][];
  refined_notehead_contours?: VisualPoint[][];
  detected_stem_contours?: VisualPoint[][];
  stem_contours: VisualPoint[][];
  stem_component_ids?: string[];
  is_hollow_notehead?: boolean;
  musicxml_id: string | null;
  visual_status: "canonical" | "fallback" | "diagnostic";
  provenance:
    | "segmentation"
    | "recovered_candidate"
    | "merged_fragments"
    | "transformer_recovered";
  moment_id: string | null;
  chord_id: string | null;
  repair_actions: string[];
}

export interface RawStemContour {
  debug_id: number;
  contour: VisualPoint[];
  bbox: VisualPoint[];
}

export interface VisualSidecar {
  version: 3;
  source_image_size: [number, number];
  raw_stem_contours?: RawStemContour[];
  notes: VisualSidecarNote[];
  visual_groups: VisualGroup[];
}

export function isLinkedVisualGroup(group: VisualGroup): boolean {
  return group.visual_status !== "diagnostic" && group.musicxml_id !== null;
}

export function isSelectableVisualGroup(
  group: VisualGroup,
  includeDiagnosticGroups = false,
): boolean {
  return (
    isLinkedVisualGroup(group) ||
    (includeDiagnosticGroups && group.visual_status === "diagnostic")
  );
}

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

export interface VisualGroupRef {
  pageIndex: number;
  visualGroupId: string;
}

export interface PageArtifacts {
  imagePath: string;
  musicXmlPath: string;
  visualSidecarPath: string;
  width: number;
  height: number;
  musicXmlBytes: number;
  visualSidecarBytes: number;
}

export type DocumentPageStatus = "pending" | "processing" | "loading" | "complete" | "skipped" | "failed";

export interface DocumentPage {
  index: number;
  status: DocumentPageStatus;
  width: number;
  height: number;
  imageUrl?: string;
  musicXml?: string;
  visualSidecar?: VisualSidecar;
  artifacts?: PageArtifacts;
  cached?: boolean;
  error?: string;
}

export type JobStatus = "opening" | "processing" | "complete" | "partial" | "cancelled" | "failed";
export type FingeringStatus = "pending" | "predicting" | "ready" | "failed";

export interface LoadedDocument {
  jobId: string;
  name: string;
  pageCount: number;
  cacheStatus: "miss" | "partial" | "complete";
  cachePath?: string;
  documentMusicXmlPath?: string;
  /** Parsed document-level playback always uses the merged, page-scoped MusicXML. */
  documentMusicXml?: string;
  fingeringStatus?: FingeringStatus;
  fingeringError?: string;
  predictedFingerings?: Record<string, import("./fingering").PredictedFingering>;
  predictedFingeringCount?: number;
  status: JobStatus;
  pages: DocumentPage[];
}
