export type VisualPoint = [number, number];
export type VisualBBox = [number, number, number, number];

export interface NoteheadEllipse {
  center: VisualPoint;
  rx: number;
  ry: number;
  angle: number;
}

export interface SidecarNote {
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
  detected_stem_contours?: VisualPoint[][];
  stem_contours: VisualPoint[][];
  musicxml_ids: string[];
}

export interface RawStemContour {
  debug_id: number;
  contour: VisualPoint[];
  bbox: VisualPoint[];
}

export interface Sidecar {
  version: number;
  source_image_size: [number, number];
  raw_stem_contours?: RawStemContour[];
  notes: SidecarNote[];
  visual_groups: VisualGroup[];
  unmatched_musicxml_notes: string[];
  unmatched_visual_notes: string[];
}

export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}
