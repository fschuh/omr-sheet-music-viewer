// A score laid out into pages, ready to draw. Lengths are page pixels: 300 per inch,
// the resolution PDF pages are rasterized at, so viewer constants in pixels behave the
// same for both. Rendering draws these items and computes nothing.
import type { GlyphName } from "../fonts/smufl";

export interface PageFormat {
  width: number;
  height: number;
  /** The distance between two staff lines. */
  staffSpace: number;
  margins: { left: number; right: number; top: number; bottom: number };
}

export type Bounds = [left: number, top: number, right: number, bottom: number];

export type Drawable =
  /** A font glyph with its origin at (x, y), at `scale` times the staff's size. */
  | { kind: "glyph"; glyph: GlyphName; x: number; y: number; scale: number; scaleY?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number }
  /** A filled polygon, such as a beam: x, y pairs. */
  | { kind: "polygon"; points: number[] }
  /** A filled outline as SVG path data, such as a tie. */
  | { kind: "path"; d: string }
  /** One line of text at its baseline; `runs`, when given, style its parts and replace `text`. */
  | { kind: "text"; text: string; runs?: TextRun[]; x: number; y: number; size: number; anchor: "start" | "middle" | "end" };

export interface TextRun {
  text: string;
  /** In page pixels; the line's size when absent. */
  size?: number;
  italic?: boolean;
  bold?: boolean;
}

/** A drawn note, with what is drawn for it alone. */
export interface LayoutNote {
  /** Structural note key; it also identifies the notehead on its page. */
  key: string;
  /** Scientific pitch as written, such as "F#5"; null for an unpitched note. */
  pitch: string | null;
  grace: boolean;
  /** One-based measure position. */
  measure: number;
  center: [number, number];
  headBounds: Bounds;
  /** Notehead, accidental and dots. */
  items: Drawable[];
}

/** A drawn chord: its notes and what they share. */
export interface LayoutChord {
  id: string;
  /** The system on the page, counted from the top. */
  systemIndex: number;
  /** Chords struck together in a system share this ID. */
  momentId: string;
  notes: LayoutNote[];
  /** Stem, flag and grace slash. */
  items: Drawable[];
  stemBounds: Bounds | null;
}

export interface LayoutPage {
  index: number;
  /** The measure the page starts with, by position. */
  firstMeasure: number;
  width: number;
  height: number;
  staffSpace: number;
  /** Everything that does not belong to a note: staves, clefs, rests, beams, barlines. */
  items: Drawable[];
  chords: LayoutChord[];
}

export interface LayoutModel {
  format: PageFormat;
  pages: LayoutPage[];
}
