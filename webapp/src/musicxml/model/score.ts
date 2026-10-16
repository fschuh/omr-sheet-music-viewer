// What the engraver knows about a score, independent of how it is laid out. It holds
// only what layout reads so far and grows with each notation it supports. Times are
// fractions of a whole note; MusicXML lengths stay in tenths of a staff space.
import type { Fraction } from "./fraction";

export interface ScoreModel {
  defaults: ScoreDefaults;
  /** Text the file places on its pages, such as the title and composer. */
  credits: CreditModel[];
  /** Titles from `<work>`, `<movement-title>` and `<identification>`, for scores without credits. */
  titles: { title: string | null; subtitle: string | null; composer: string | null };
  parts: PartModel[];
  /** The score's measures by position, with what applies to all parts. */
  measures: MeasureModel[];
}

/** Layout hints from `<defaults>`, in tenths. */
export interface ScoreDefaults {
  /** `millimeters` millimetres correspond to `tenths` tenths. */
  scaling: { millimeters: number; tenths: number } | null;
  pageSize: { width: number; height: number } | null;
  pageMargins: Margins | null;
  systemLayout: SystemLayout;
  /** The distance between staves of a system, from the bottom of one to the top of the next. */
  staffDistance: number | null;
}

export interface Margins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** In tenths; null where the file says nothing. */
export interface SystemLayout {
  leftMargin: number | null;
  rightMargin: number | null;
  /** From the bottom of one system to the top of the next. */
  systemDistance: number | null;
  /** From the top page margin to the top of the page's first system. */
  topSystemDistance: number | null;
}

export interface CreditRun {
  text: string;
  /** In points; null where the file gives none, leaving the size to the credit's role. */
  fontSize: number | null;
  italic: boolean;
  bold: boolean;
}

export interface CreditModel {
  page: number;
  /** The file's `credit-type`s, such as "title", "composer" or "rights". */
  types: string[];
  /** In tenths from the page's bottom left. */
  x: number;
  y: number;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom" | "baseline";
  runs: CreditRun[];
}

export interface MeasureModel {
  /** The printed number, which can repeat or be missing; layout counts by position. */
  number: string;
  /** Some part asks for a page break before this measure. */
  newPage: boolean;
  /** Some part asks for a system break before this measure. */
  newSystem: boolean;
  /** Layout a `<print>` element asks for from this measure on. */
  systemLayout: SystemLayout;
  staffDistance: number | null;
  /** The measure's length: the furthest any part's content reaches. */
  duration: Fraction;
}

export interface PartModel {
  id: string;
  name: string;
  staffCount: number;
  measures: PartMeasureModel[];
}

export interface PartMeasureModel {
  clefs: ClefChange[];
  keys: KeyChange[];
  times: TimeChange[];
  chords: ChordModel[];
  barlines: BarlineModel[];
  directions: DirectionModel[];
}

export type Placement = "above" | "below" | null;

/** A printed direction: what `<direction-type>` holds, at an onset on a staff. */
export interface DirectionModel {
  onset: Fraction;
  staff: number;
  placement: Placement;
  items: DirectionItem[];
}

export type DirectionItem =
  | { kind: "dynamics"; text: string }
  | { kind: "wedge"; type: "crescendo" | "diminuendo" | "stop"; number: string }
  | { kind: "words"; text: string; italic: boolean; bold: boolean; size: number | null }
  | { kind: "metronome"; beatUnit: string; dots: number; perMinute: string; parentheses: boolean }
  | { kind: "pedal"; type: "start" | "stop" | "change"; line: boolean }
  | { kind: "octave-shift"; type: "up" | "down" | "stop"; size: number; number: string }
  /** A symbol named by its SMuFL glyph, from `<other-direction smufl="…">`. */
  | { kind: "symbol"; smufl: string };

export type ClefSign = "G" | "F" | "C" | "percussion" | "TAB" | "none";

export interface ClefChange {
  onset: Fraction;
  staff: number;
  sign: ClefSign;
  /** Staff line the clef marks, counted from the bottom. */
  line: number;
  octaveChange: number;
}

export interface KeyChange {
  onset: Fraction;
  /** Null when the key applies to every staff of the part. */
  staff: number | null;
  fifths: number;
}

export interface TimeChange {
  onset: Fraction;
  beats: string;
  beatType: string;
  symbol: "normal" | "common" | "cut" | "single-number" | "none";
}

export interface BarlineModel {
  location: "left" | "right" | "middle";
  style: string;
  repeat: "forward" | "backward" | null;
  ending: EndingMark | null;
}

/** A volta's start or end, as a barline marks it. */
export interface EndingMark {
  number: string;
  type: "start" | "stop" | "discontinue";
  /** The printed text, such as "1."; the number followed by a dot when the file gives none. */
  text: string;
}

export type NoteType =
  | "maxima"
  | "long"
  | "breve"
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "16th"
  | "32nd"
  | "64th"
  | "128th"
  | "256th"
  | "512th"
  | "1024th";

export type BeamValue = "begin" | "continue" | "end" | "forward hook" | "backward hook";

/** The notes, or the rest, one voice has at one onset on one staff. */
export interface ChordModel {
  /** Unique in the score; the note keys of its notes without the pitch. */
  id: string;
  staff: number;
  voice: string;
  onset: Fraction;
  /** Zero for grace notes. */
  duration: Fraction;
  /** The notated type; null when the file gives none. */
  type: NoteType | null;
  dots: number;
  rest: boolean;
  /** A rest that fills its measure. */
  measureRest: boolean;
  /** Where the file places a rest, as a pitch on the staff. */
  restPosition: { step: string; octave: number } | null;
  grace: { slash: boolean } | null;
  cue: boolean;
  /** False for chords the file marks as not printed; they still sound. */
  printed: boolean;
  stem: "up" | "down" | "none" | "double" | null;
  /** Tuplets starting at this chord, and the numbers of those ending at it. */
  tupletStarts: TupletStart[];
  tupletStops: string[];
  slurs: SlurMark[];
  /** Articulations by MusicXML name, such as "staccato" or "strong-accent". */
  articulations: { name: string; placement: Placement }[];
  fermata: { inverted: boolean; shape: string } | null;
  ornaments: { name: "trill-mark" | "mordent" | "inverted-mordent" | "turn" | "inverted-turn"; placement: Placement }[];
  wavyLines: { type: "start" | "stop" | "continue"; number: string }[];
  arpeggiate: { direction: "up" | "down" | null; number: string } | null;
  tremolo: { type: "single" | "start" | "stop" | "unmeasured"; marks: number } | null;
  /** Beam values by level: index 0 is the eighth-note beam. */
  beams: (BeamValue | null)[];
  notes: NoteModel[];
}

export interface SlurMark {
  type: "start" | "stop" | "continue";
  number: string;
  placement: Placement;
}

export interface TupletStart {
  number: string;
  /** Null when the file leaves it to the engraver. */
  bracket: boolean | null;
  showNumber: "actual" | "both" | "none";
  placement: "above" | "below" | null;
  actual: number;
  normal: number;
}

export interface NoteModel {
  /** The structural note key (section 3.5 of the plan). */
  key: string;
  step: string;
  alter: number;
  octave: number;
  /** An unpitched note, placed by its display step and octave. */
  unpitched: boolean;
  /** The accidental the file prints, by MusicXML name; null when it prints none. */
  accidental: string | null;
  /** The printed accidental is a courtesy one, in parentheses. */
  accidentalParentheses: boolean;
  /** Fingerings the score prints for the note, such as "3" or "1-2". */
  fingerings: { text: string; placement: Placement }[];
  tieStart: boolean;
  tieStop: boolean;
}
