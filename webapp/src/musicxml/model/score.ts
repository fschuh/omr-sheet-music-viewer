// What the engraver knows about a score, independent of how it is laid out. It holds
// only what layout reads so far and grows with each notation it supports.

export interface ScoreModel {
  defaults: ScoreDefaults;
  /** The score's measures by position, across all parts. */
  measures: MeasureModel[];
}

/** Layout hints from `<defaults>`. MusicXML lengths are in tenths of a staff space. */
export interface ScoreDefaults {
  /** `millimeters` millimetres correspond to `tenths` tenths. */
  scaling: { millimeters: number; tenths: number } | null;
  /** In tenths. */
  pageSize: { width: number; height: number } | null;
}

export interface MeasureModel {
  /** A part asks for a page break before this measure. */
  newPage: boolean;
}
