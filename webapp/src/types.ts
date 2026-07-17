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
  staff: number;
  voice: number;
  pitch: string | null;
  duration: string;
  match_confidence: number;
  visual_group_id: string | null;
}

export interface VisualGroup {
  visual_group_id: string;
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
  musicxml_ids: string[];
}

export interface RawStemContour {
  debug_id: number;
  contour: VisualPoint[];
  bbox: VisualPoint[];
}

export interface VisualSidecar {
  version: number;
  source_image_size: [number, number];
  raw_stem_contours?: RawStemContour[];
  notes: VisualSidecarNote[];
  visual_groups: VisualGroup[];
  unmatched_musicxml_notes: string[];
  unmatched_visual_notes: string[];
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

export type DocumentPageStatus = "pending" | "processing" | "loading" | "complete" | "failed";

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

export interface LoadedDocument {
  jobId: string;
  name: string;
  pageCount: number;
  cacheStatus: "miss" | "partial" | "complete";
  cachePath?: string;
  status: JobStatus;
  pages: DocumentPage[];
}
