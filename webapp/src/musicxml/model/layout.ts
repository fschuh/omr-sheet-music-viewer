// A score laid out into pages. Lengths are page pixels: 300 per inch, the resolution PDF
// pages are rasterized at, so viewer constants in pixels behave the same for both.

export interface PageFormat {
  width: number;
  height: number;
  /** The distance between two staff lines. */
  staffSpace: number;
}

export interface LayoutPage {
  index: number;
  width: number;
  height: number;
}

export interface LayoutModel {
  format: PageFormat;
  pages: LayoutPage[];
}
