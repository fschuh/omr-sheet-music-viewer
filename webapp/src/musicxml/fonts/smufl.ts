// The Leland SMuFL font: the glyphs the engraver draws, their codepoints, and their
// metadata. Lengths are staff spaces with y pointing down, as in page coordinates;
// SMuFL's own metadata points y up. One em of the font is four staff spaces.
import metadata from "./leland_metadata.json";

/** Codepoints from the SMuFL glyph names list. */
const CODEPOINTS = {
  noteheadDoubleWhole: 0xe0a0,
  noteheadWhole: 0xe0a2,
  noteheadHalf: 0xe0a3,
  noteheadBlack: 0xe0a4,
  restLonga: 0xe4e1,
  restDoubleWhole: 0xe4e2,
  restWhole: 0xe4e3,
  restHalf: 0xe4e4,
  restQuarter: 0xe4e5,
  rest8th: 0xe4e6,
  rest16th: 0xe4e7,
  rest32nd: 0xe4e8,
  rest64th: 0xe4e9,
  rest128th: 0xe4ea,
  flag8thUp: 0xe240,
  flag8thDown: 0xe241,
  flag16thUp: 0xe242,
  flag16thDown: 0xe243,
  flag32ndUp: 0xe244,
  flag32ndDown: 0xe245,
  flag64thUp: 0xe246,
  flag64thDown: 0xe247,
  flag128thUp: 0xe248,
  flag128thDown: 0xe249,
  accidentalFlat: 0xe260,
  accidentalNatural: 0xe261,
  accidentalSharp: 0xe262,
  accidentalDoubleSharp: 0xe263,
  accidentalDoubleFlat: 0xe264,
  accidentalTripleSharp: 0xe265,
  accidentalTripleFlat: 0xe266,
  accidentalNaturalFlat: 0xe267,
  accidentalNaturalSharp: 0xe268,
  gClef: 0xe050,
  gClef15mb: 0xe051,
  gClef8vb: 0xe052,
  gClef8va: 0xe053,
  gClef15ma: 0xe054,
  cClef: 0xe05c,
  fClef: 0xe062,
  fClef8vb: 0xe064,
  fClef8va: 0xe065,
  unpitchedPercussionClef1: 0xe069,
  "6stringTabClef": 0xe06d,
  gClefChange: 0xe07a,
  cClefChange: 0xe07b,
  fClefChange: 0xe07c,
  timeSig0: 0xe080,
  timeSig1: 0xe081,
  timeSig2: 0xe082,
  timeSig3: 0xe083,
  timeSig4: 0xe084,
  timeSig5: 0xe085,
  timeSig6: 0xe086,
  timeSig7: 0xe087,
  timeSig8: 0xe088,
  timeSig9: 0xe089,
  timeSigCommon: 0xe08a,
  timeSigCutCommon: 0xe08b,
  augmentationDot: 0xe1e7,
  brace: 0xe000,
  tuplet0: 0xe880,
  tuplet1: 0xe881,
  tuplet2: 0xe882,
  tuplet3: 0xe883,
  tuplet4: 0xe884,
  tuplet5: 0xe885,
  tuplet6: 0xe886,
  tuplet7: 0xe887,
  tuplet8: 0xe888,
  tuplet9: 0xe889,
  tupletColon: 0xe88a,
  repeatDots: 0xe043,
  accidentalParensLeft: 0xe26a,
  accidentalParensRight: 0xe26b,
} as const;

export type GlyphName = keyof typeof CODEPOINTS;

export const GLYPH_NAMES = Object.keys(CODEPOINTS) as GlyphName[];

export function glyphText(name: GlyphName): string {
  return String.fromCodePoint(CODEPOINTS[name]);
}

/** A glyph's extent around its origin, with y pointing down. */
export interface GlyphBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type Point = [number, number];

const boxes = metadata.glyphBBoxes as unknown as Record<string, { bBoxNE: Point; bBoxSW: Point }>;
const anchors = metadata.glyphsWithAnchors as unknown as Record<string, Record<string, Point>>;

export function glyphBox(name: GlyphName): GlyphBox {
  const box = boxes[name];
  if (!box) throw new Error(`Leland has no bounding box for ${name}`);
  return { left: box.bBoxSW[0], right: box.bBoxNE[0], top: -box.bBoxNE[1], bottom: -box.bBoxSW[1] };
}

export function glyphWidth(name: GlyphName): number {
  const box = glyphBox(name);
  return box.right - box.left;
}

/** A named anchor, such as `stemUpSE`, with y pointing down; null when the glyph has none. */
export function glyphAnchor(name: GlyphName, anchor: string): Point | null {
  const point = anchors[name]?.[anchor];
  return point ? [point[0], -point[1]] : null;
}

/** Line thicknesses and other engraving defaults the font recommends. */
export const ENGRAVING_DEFAULTS = metadata.engravingDefaults;
