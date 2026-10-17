// Directions placed once measures have their places: ottava lines, dynamics, hairpins,
// words, metronome marks and pedal marks. Each sits above or below its staff, clear of the
// notes it spans. Lengths are staff spaces; drawables come out in page pixels.
import { ENGRAVING_DEFAULTS, GLYPH_NAMES, glyphBox, glyphWidth, type GlyphName } from "../fonts/smufl";
import { compare, toNumber, type Fraction } from "../model/fraction";
import type { Drawable } from "../model/layout";
import type { DirectionItem, Placement, ScoreModel } from "../model/score";
import type { ChordShape } from "./chords";
import type { PreparedChord, PreparedScore } from "./measureContent";
import { systemChords, type PlacedMeasure, type PlacedSystem } from "./pages";
import { chordExtent } from "./spanners";

const POINTS_TO_STAFF_SPACES = (sp: number) => 300 / 72 / sp;
/** Metronome notes are drawn at text size, not notehead size. */
const METRONOME_SCALE = 0.6;

/** An estimate of a serif text's width: no text measurement is available during layout. */
function textWidth(text: string, size: number, bold: boolean): number {
  return text.length * size * (bold ? 0.5 : 0.45);
}
const WORDS_SIZE = 10;
const HAIRPIN_HEIGHT = 1.15;
const HAIRPIN_THICKNESS = ENGRAVING_DEFAULTS.hairpinThickness;
const PARTIAL_OPENING = 0.6;
/** Between the items of one direction: wider than the overlap margin of `Output.place`. */
const ITEM_GAP = 0.5;
const OTTAVA_THICKNESS = ENGRAVING_DEFAULTS.octaveLineThickness;
const PEDAL_THICKNESS = ENGRAVING_DEFAULTS.pedalLineThickness;

/** Where a measure and onset fall in its system: its segment, or between two in time. */
export function onsetX(placed: PlacedMeasure, onset: Fraction): number {
  const segments = placed.spacing.measure.segments;
  const exact = segments.findIndex((segment) => compare(segment.onset, onset) === 0);
  if (exact >= 0) return placed.segmentX[exact];
  if (compare(onset, placed.spacing.measure.duration) >= 0) return placed.barlineX;
  const next = segments.findIndex((segment) => compare(segment.onset, onset) > 0);
  if (next <= 0) return placed.segmentX[0];
  const from = toNumber(segments[next - 1].onset);
  const to = toNumber(segments[next].onset);
  const share = (toNumber(onset) - from) / (to - from);
  return placed.segmentX[next - 1] + share * (placed.segmentX[next] - placed.segmentX[next - 1]);
}

interface Located {
  system: PlacedSystem;
  x: number;
}

function locate(systems: PlacedSystem[], measureIndex: number, onset: Fraction): Located | null {
  for (const system of systems) {
    const placed = system.measures.find((measure) => measure.spacing.measure.index === measureIndex);
    if (placed) return { system, x: onsetX(placed, onset) };
  }
  return null;
}

/** How far a staff's notes reach up and down between two x positions, with the staff itself. */
function staffBand(
  system: PlacedSystem,
  staff: number,
  x1: number,
  x2: number,
  shapes: Map<PreparedChord, ChordShape>,
): { top: number; bottom: number } {
  const staffTop = system.top + system.staffTops[staff];
  let top = staffTop;
  let bottom = staffTop + 4;
  for (const chord of systemChords(system)) {
    if (chord.staff !== staff) continue;
    const extent = chordExtent(system, chord, shapes.get(chord)!);
    if (extent.right < x1 - 0.5 || extent.left > x2 + 0.5) continue;
    top = Math.min(top, extent.top);
    bottom = Math.max(bottom, extent.bottom);
  }
  return { top, bottom };
}

/** MuseScore's minimum distance between notes and the dynamics and tempo text beside them. */
const MIN_DISTANCE = 0.5;

/**
 * The baseline for marks above or below a staff between two x positions, for a mark reaching
 * `ascent` above its baseline and `descent` below it: `shift` from the default place, and
 * never closer than the minimum distance to the notes.
 */
function markBaseline(
  system: PlacedSystem,
  staff: number,
  x1: number,
  x2: number,
  above: boolean,
  shapes: Map<PreparedChord, ChordShape>,
  { ascent = 1.5, descent = 0.3, shift = 0 }: { ascent?: number; descent?: number; shift?: number } = {},
): number {
  const band = staffBand(system, staff, x1, x2, shapes);
  const staffTop = system.top + system.staffTops[staff];
  if (above) return Math.min(staffTop - 1.5 + shift, band.top - descent - MIN_DISTANCE);
  return Math.max(staffTop + 4 + 2.5 + shift, band.bottom + ascent + MIN_DISTANCE);
}

const DYNAMIC_LETTERS: Record<string, GlyphName> = {
  p: "dynamicPiano", m: "dynamicMezzo", f: "dynamicForte", r: "dynamicRinforzando",
  s: "dynamicSforzando", z: "dynamicZ", n: "dynamicNiente",
};

const BEAT_UNITS: Record<string, GlyphName> = {
  whole: "metNoteWhole", half: "metNoteHalfUp", quarter: "metNoteQuarterUp",
  eighth: "metNote8thUp", "16th": "metNote16thUp",
};

interface Context {
  systems: PlacedSystem[];
  shapes: Map<PreparedChord, ChordShape>;
  prepared: PreparedScore;
  sp: number;
  /** Chords beamed across staves: they count with their notes only between the staves. */
  crossStaff: Set<PreparedChord>;
}

/**
 * An area a mark covers, in staff spaces from the page's top left, and the staff it belongs
 * to. As MuseScore places marks against their own staff's skyline, a mark keeps clear of its
 * own staff's marks only; the staves then move apart until their marks clear each other. A
 * mark across staves belongs to none, and the marks of every staff keep clear of it.
 */
export interface Box {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
  staff?: number;
  /** Whether it is a dynamic, hairpin or expression: such marks ignore some others. */
  mark?: MarkKind;
}

type MarkKind = "dynamic" | "hairpin" | "expression";

/**
 * Whether a mark is placed without regard to another, as MuseScore's autoplace ignores them:
 * dynamics and hairpins ignore each other, and expressions each other.
 */
function ignores(a: MarkKind | undefined, b: MarkKind | undefined): boolean {
  if (!a || !b) return false;
  const dynamics = (kind: MarkKind) => kind === "dynamic" || kind === "hairpin";
  return (dynamics(a) && dynamics(b)) || (a === "expression" && b === "expression");
}

/** A mark to be centred in the gap between its part's staves once everything else is placed. */
interface Centrable {
  system: PlacedSystem;
  staff: number;
  above: boolean;
  box: Box;
  items: Drawable[];
  /** The places it snaps to: marks sharing one form a chain, aligned and moved together. */
  snaps: string[];
}

class Output {
  readonly bySystem = new Map<PlacedSystem, Drawable[]>();
  readonly boxes: Map<PlacedSystem, Box[]>;
  readonly centrable: Centrable[] = [];
  /** The box `place` added last. */
  private last: Box | null = null;
  /** `taken` holds what is already drawn, such as chord marks, for marks placed here to avoid. */
  constructor(readonly sp: number, taken: Map<PlacedSystem, Box[]> = new Map()) {
    this.boxes = new Map([...taken].map(([system, boxes]) => [system, [...boxes]]));
  }

  /**
   * Finds a baseline for a mark of a staff from x1 to x2 reaching `ascent` above and
   * `descent` below it: the given one, or further from the staff until none of the staff's
   * marks placed earlier overlaps.
   */
  place(
    system: PlacedSystem, staff: number, x1: number, x2: number, baseline: number, ascent: number, descent: number, above: boolean,
    mark?: Box["mark"],
  ): number {
    const placed = this.boxes.get(system) ?? [];
    const overlaps = (y: number) => placed.filter((box) => (box.staff === undefined || box.staff === staff) && !ignores(mark, box.mark) &&
      box.x2 > x1 - 0.2 && box.x1 < x2 + 0.2 && box.bottom > y - ascent - 0.2 && box.top < y + descent + 0.2);
    let y = baseline;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const overlapping = overlaps(y);
      if (overlapping.length === 0) break;
      y = above
        ? Math.min(...overlapping.map((box) => box.top)) - descent - 0.3
        : Math.max(...overlapping.map((box) => box.bottom)) + ascent + 0.3;
    }
    this.last = { x1, x2, top: y - ascent, bottom: y + descent, staff, ...(mark ? { mark } : {}) };
    placed.push(this.last);
    this.boxes.set(system, placed);
    return y;
  }

  /**
   * Draws a mark just placed with `place`, and keeps it to be centred between its part's
   * staves, as MuseScore centres dynamics, expressions and hairpins on a grand staff.
   */
  centred(system: PlacedSystem, staff: number, above: boolean, draw: () => void, snaps: string[] = []) {
    const box = this.last!;
    const before = this.bySystem.get(system)?.length ?? 0;
    draw();
    this.centrable.push({ system, staff, above, box, items: (this.bySystem.get(system) ?? []).slice(before), snaps });
  }

  add(system: PlacedSystem, item: Drawable) {
    this.bySystem.set(system, [...(this.bySystem.get(system) ?? []), item]);
  }
  glyph(system: PlacedSystem, glyph: GlyphName, x: number, y: number, scale = 1) {
    this.add(system, { kind: "glyph", glyph, x: x * this.sp, y: y * this.sp, scale });
  }
  line(system: PlacedSystem, x1: number, y1: number, x2: number, y2: number, width: number, dash?: [number, number]) {
    this.add(system, {
      kind: "line", x1: x1 * this.sp, y1: y1 * this.sp, x2: x2 * this.sp, y2: y2 * this.sp, width: width * this.sp,
      ...(dash ? { dash: [dash[0] * this.sp, dash[1] * this.sp] as [number, number] } : {}),
    });
  }
  text(system: PlacedSystem, text: string, x: number, y: number, size: number, italic = false, bold = false) {
    this.add(system, {
      kind: "text", text, runs: [{ text, italic: italic || undefined, bold: bold || undefined }],
      x: x * this.sp, y: y * this.sp, size: size * this.sp, anchor: "start",
    });
  }
}

/** Where a system's music begins, after its header: spanners continued from before start here. */
function musicStart(system: PlacedSystem): number {
  return system.measures[0].segmentX[0] - 1.5;
}

/**
 * Draws a spanner from one place to another: in one piece within a system, or as a piece in
 * each system it crosses.
 */
function eachPiece(
  systems: PlacedSystem[],
  from: Located,
  to: Located,
  draw: (system: PlacedSystem, x1: number, x2: number, first: boolean, last: boolean) => void,
): void {
  const start = systems.indexOf(from.system);
  const end = systems.indexOf(to.system);
  for (let index = start; index <= end; index += 1) {
    const system = systems[index];
    const x1 = index === start ? from.x : musicStart(system);
    const x2 = index === end ? to.x : system.right - 0.3;
    draw(system, x1, x2, index === start, index === end);
  }
}

function drawOttavas(context: Context, output: Output): void {
  const { systems, prepared, shapes } = context;
  for (const span of prepared.ottavas) {
    const from = locate(systems, span.startAt.measureIndex, span.startAt.onset);
    if (!from) continue;
    const last = systems[systems.length - 1];
    const to = span.stopAt ? locate(systems, span.stopAt.measureIndex, span.stopAt.onset) : { system: last, x: last.right - 0.3 };
    if (!to) continue;
    const above = span.shift < 0;
    const glyph: GlyphName = Math.abs(span.shift) === 2
      ? (above ? "quindicesimaAlta" : "quindicesimaBassa")
      : (above ? "ottavaAlta" : "ottavaBassa");
    eachPiece(systems, from, to, (system, x1, x2, _first, isLast) => {
      const band = staffBand(system, span.staff, x1, x2, shapes);
      const staffTop = system.top + system.staffTops[span.staff];
      const box = glyphBox(glyph);
      const baseline = output.place(
        system, span.staff, x1, x2,
        above ? Math.min(staffTop - 2, band.top - 1) : Math.max(staffTop + 4 + 3, band.bottom + 2.5),
        -box.top, box.bottom + 0.2, above,
      );
      output.glyph(system, glyph, x1, baseline);
      const lineY = baseline + (box.top + box.bottom) / 2;
      const lineStart = x1 + box.right + 0.3;
      if (x2 > lineStart) {
        output.line(system, lineStart, lineY, x2, lineY, OTTAVA_THICKNESS, [0.6, 0.4]);
        if (isLast && span.stopAt) output.line(system, x2, lineY, x2, lineY + (above ? 1 : -1), OTTAVA_THICKNESS);
      }
    });
  }
}

/** A direction item measured, to be drawn once its baseline is known. */
interface Piece {
  width: number;
  ascent: number;
  descent: number;
  draw(output: Output, system: PlacedSystem, x: number, y: number): void;
}

/** Note characters that words use for tempo equations, drawn with the music font's metronome notes. */
const NOTE_CHARACTERS: Record<string, GlyphName> = {
  "\u{1D15D}": "metNoteWhole", "\u{1D15E}": "metNoteHalfUp", "\u{1D15F}": "metNoteQuarterUp", "\u2669": "metNoteQuarterUp",
  "\u{1D160}": "metNote8thUp", "\u266A": "metNote8thUp", "\u{1D161}": "metNote16thUp",
};
const METRONOME_DOT_GAP = 0.15;

function wordsPiece(item: Extract<DirectionItem, { kind: "words" }>, wordsSize: number, sp: number): Piece {
  const size = item.size ? item.size * POINTS_TO_STAFF_SPACES(sp) : wordsSize;
  // Runs of text, and notes with the dots that follow them.
  const parts: ({ text: string } | { glyph: GlyphName; dots: number })[] = [];
  for (const character of item.text) {
    const glyph = NOTE_CHARACTERS[character];
    const last = parts[parts.length - 1];
    if (glyph) parts.push({ glyph, dots: 0 });
    else if (character === "." && last && "glyph" in last) last.dots += 1;
    else if (last && "text" in last) last.text += character;
    else parts.push({ text: character });
  }
  const partWidth = (part: (typeof parts)[number]) => "text" in part
    ? textWidth(part.text, size, item.bold)
    : (glyphWidth(part.glyph) + part.dots * (glyphWidth("metAugmentationDot") + METRONOME_DOT_GAP)) * METRONOME_SCALE;
  return {
    width: parts.reduce((total, part) => total + partWidth(part), 0),
    ascent: parts.some((part) => "glyph" in part) ? wordsSize * 1.1 : size * 0.75,
    descent: size * 0.25,
    draw: (output, system, start, y) => {
      let x = start;
      for (const part of parts) {
        if ("text" in part) {
          output.text(system, part.text, x, y, size, item.italic, item.bold);
        } else {
          output.glyph(system, part.glyph, x, y, METRONOME_SCALE);
          let dotX = x + glyphWidth(part.glyph) * METRONOME_SCALE;
          for (let dot = 0; dot < part.dots; dot += 1) {
            output.glyph(system, "metAugmentationDot", dotX + METRONOME_DOT_GAP * METRONOME_SCALE, y, METRONOME_SCALE);
            dotX += (glyphWidth("metAugmentationDot") + METRONOME_DOT_GAP) * METRONOME_SCALE;
          }
        }
        x += partWidth(part);
      }
    },
  };
}

function metronomePiece(item: Extract<DirectionItem, { kind: "metronome" }>, wordsSize: number): Piece {
  const note = BEAT_UNITS[item.beatUnit] ?? "metNoteQuarterUp";
  const label = ` = ${item.perMinute}${item.parentheses ? ")" : ""}`;
  const opening = item.parentheses ? textWidth("(", wordsSize, false) : 0;
  const noteWidth = (glyphWidth(note) + item.dots * (glyphWidth("metAugmentationDot") + METRONOME_DOT_GAP)) * METRONOME_SCALE;
  return {
    width: opening + noteWidth + textWidth(label, wordsSize, false),
    ascent: wordsSize * 1.1,
    descent: wordsSize * 0.25,
    draw: (output, system, start, y) => {
      let x = start;
      if (item.parentheses) {
        output.text(system, "(", x, y, wordsSize);
        x += opening;
      }
      output.glyph(system, note, x, y, METRONOME_SCALE);
      x += glyphWidth(note) * METRONOME_SCALE;
      for (let dot = 0; dot < item.dots; dot += 1) {
        output.glyph(system, "metAugmentationDot", x + METRONOME_DOT_GAP * METRONOME_SCALE, y, METRONOME_SCALE);
        x += (glyphWidth("metAugmentationDot") + METRONOME_DOT_GAP) * METRONOME_SCALE;
      }
      output.text(system, label, x, y, wordsSize);
    },
  };
}

function dynamicGlyphs(text: string): GlyphName[] | null {
  const glyphs = [...text].map((letter) => DYNAMIC_LETTERS[letter]);
  return glyphs.every(Boolean) ? glyphs : null;
}

function dynamicWidth(text: string): number {
  const glyphs = dynamicGlyphs(text);
  return glyphs ? glyphs.reduce((total, glyph) => total + glyphWidth(glyph), 0) : text.length * 0.9;
}

/** Where a dynamic is centred: under a notehead at its onset, from `cursor` on. */
function dynamicX(text: string, at: Located, cursor: number): number {
  return Math.max(cursor, at.x + 0.65 - dynamicWidth(text) / 2);
}

/** A place on a staff where a hairpin can snap to a dynamic or another hairpin. */
function snapKey(staff: number, measureIndex: number, onset: Fraction): string {
  return `${staff}|${measureIndex}|${toNumber(onset)}`;
}

/** MuseScore's autoplaceHairpinDynamicsDistance: between a hairpin and the dynamic it snaps to. */
const HAIRPIN_DYNAMIC_DISTANCE = 0.5;
/** Between a dynamic and the expression after it, near what MuseScore's computeDynamicExpressionDistance gives. */
const EXPRESSION_DYNAMIC_DISTANCE = 0.5;

/**
 * Directions of every system, with the boxes of everything placed, `taken` included, before
 * the marks that centre between staves move: what the staves must be spaced to clear.
 */
export function layoutDirections(
  score: ScoreModel,
  prepared: PreparedScore,
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
  sp: number,
  taken: Map<PlacedSystem, Box[]> = new Map(),
  crossStaff: Set<PreparedChord> = new Set(),
): { drawables: Map<PlacedSystem, Drawable[]>; boxes: Map<PlacedSystem, Box[]> } {
  const context: Context = { systems, shapes, prepared, sp, crossStaff };
  const output = new Output(sp, taken);
  drawOttavas(context, output);
  const wordsSize = WORDS_SIZE * POINTS_TO_STAFF_SPACES(sp);

  // Where dynamics stand, for hairpins to snap to.
  const dynamicSpans = new Map<string, { system: PlacedSystem; x1: number; x2: number; above: boolean }>();
  score.parts.forEach((part, partIndex) => part.measures.forEach((measure, measureIndex) => {
    for (const direction of measure.directions) {
      const at = locate(systems, measureIndex, direction.onset);
      if (!at) continue;
      const staff = prepared.partStaves[partIndex][direction.staff - 1] ?? prepared.partStaves[partIndex][0];
      const key = snapKey(staff, measureIndex, direction.onset);
      for (const item of direction.items) {
        if (item.kind === "dynamics" && !dynamicSpans.has(key)) {
          const x = dynamicX(item.text, at, at.x);
          dynamicSpans.set(key, { system: at.system, x1: x, x2: x + dynamicWidth(item.text), above: (direction.placement ?? "below") === "above" });
        }
      }
    }
  }));

  score.parts.forEach((part, partIndex) => {
    const partStaves = prepared.partStaves[partIndex];
    const wedges = new Map<string, { from: Located; snap: string; type: "crescendo" | "diminuendo"; staff: number; above: boolean }>();
    let pedal: { from: Located; line: boolean; changes: Located[] } | null = null;
    part.measures.forEach((measure, measureIndex) => {
      for (const direction of measure.directions) {
        const at = locate(systems, measureIndex, direction.onset);
        if (!at) continue;
        const staff = partStaves[direction.staff - 1] ?? partStaves[0];
        let cursor = at.x;
        const placementFor = (item: DirectionItem, fallback: Placement) =>
          (direction.placement ?? fallback) === "above";
        // A metronome mark and the words beside it are one tempo text, on one baseline, as
        // MuseScore imports them.
        type TempoItem = Extract<DirectionItem, { kind: "words" | "metronome" }>;
        const tempo: DirectionItem[] = direction.items.some((item) => item.kind === "metronome")
          ? direction.items.filter((item): item is TempoItem => item.kind === "words" || item.kind === "metronome")
          : [];
        if (tempo.length > 0) {
          const above = (direction.placement ?? "above") === "above";
          const pieces = (tempo as TempoItem[]).map((item) =>
            item.kind === "metronome" ? metronomePiece(item, wordsSize) : wordsPiece(item, wordsSize, sp));
          const width = pieces.reduce((total, piece) => total + piece.width, 0) + ITEM_GAP * (pieces.length - 1);
          const ascent = Math.max(...pieces.map((piece) => piece.ascent));
          const descent = Math.max(...pieces.map((piece) => piece.descent));
          const y = output.place(
            at.system, staff, cursor, cursor + width,
            markBaseline(at.system, staff, cursor, cursor + width, above, shapes, { ascent, descent }),
            ascent, descent, above,
          );
          for (const piece of pieces) {
            piece.draw(output, at.system, cursor, y);
            cursor += piece.width + ITEM_GAP;
          }
        }
        for (const item of direction.items) {
          if (tempo.includes(item)) continue;
          switch (item.kind) {
            case "dynamics": {
              const above = placementFor(item, "below");
              const glyphs = dynamicGlyphs(item.text);
              const width = dynamicWidth(item.text);
              const ascent = glyphs ? Math.max(...glyphs.map((glyph) => -glyphBox(glyph).top)) : 1.6;
              const descent = glyphs ? Math.max(...glyphs.map((glyph) => glyphBox(glyph).bottom)) : 0.6;
              let x = dynamicX(item.text, at, cursor);
              const place = snapKey(staff, measureIndex, direction.onset);
              const y = output.place(
                at.system, staff, x, x + width,
                markBaseline(at.system, staff, x, x + width, above, shapes, { ascent, descent, shift: above ? 0 : -0.5 }),
                ascent, descent, above, "dynamic",
              );
              output.centred(at.system, staff, above, () => {
                if (glyphs) {
                  for (const glyph of glyphs) {
                    output.glyph(at.system, glyph, x, y);
                    x += glyphWidth(glyph);
                  }
                } else {
                  output.text(at.system, item.text, x, y, wordsSize * 1.2, true, true);
                }
              }, [place]);
              cursor = at.x + width + ITEM_GAP;
              break;
            }
            case "words": {
              // Words MuseScore imports as a crescendo or diminuendo line's text, or as an
              // expression, are italic, go below unless placed, and centre like dynamics.
              const hairpinText = /cresc|dim/.test(item.text);
              const expression = hairpinText || (item.italic && direction.placement === "below");
              const above = placementFor(item, hairpinText ? "below" : "above");
              const piece = wordsPiece(hairpinText ? { ...item, italic: true } : item, wordsSize, sp);
              // An expression follows a dynamic on its side at its place, snapped to it.
              const place = snapKey(staff, measureIndex, direction.onset);
              const dynamic = expression ? dynamicSpans.get(place) : undefined;
              const snapped = dynamic && dynamic.system === at.system && dynamic.above === above;
              if (snapped) cursor = Math.max(cursor, dynamic.x2 + EXPRESSION_DYNAMIC_DISTANCE);
              const y = output.place(
                at.system, staff, cursor, cursor + piece.width,
                markBaseline(at.system, staff, cursor, cursor + piece.width, above, shapes),
                piece.ascent, piece.descent, above,
                expression ? "expression" : undefined,
              );
              const x = cursor;
              const draw = () => piece.draw(output, at.system, x, y);
              if (expression) output.centred(at.system, staff, above, draw, snapped ? [place] : []);
              else draw();
              cursor += piece.width + ITEM_GAP;
              break;
            }
            case "symbol": {
              // Only glyphs the font has; a name it lacks draws nothing.
              if (!(GLYPH_NAMES as string[]).includes(item.smufl)) break;
              const glyph = item.smufl as GlyphName;
              const above = placementFor(item, "above");
              const box = glyphBox(glyph);
              const x = Math.max(cursor, at.x + 0.65 - (box.left + box.right) / 2);
              const y = output.place(
                at.system, staff, x + box.left, x + box.right,
                markBaseline(at.system, staff, x + box.left, x + box.right, above, shapes),
                -box.top, box.bottom, above,
              );
              output.glyph(at.system, glyph, x, y);
              cursor = x + box.right + ITEM_GAP;
              break;
            }
            case "wedge": {
              const key = `${item.number}`;
              if (item.type === "stop") {
                const open = wedges.get(key);
                if (!open) break;
                wedges.delete(key);
                const stopSnap = snapKey(open.staff, measureIndex, direction.onset);
                eachPiece(systems, open.from, at, (system, x1, x2, first, last) => {
                  // As MuseScore snaps a hairpin: it starts after a dynamic on its side at its
                  // start, and ends before one at its stop.
                  const side = (span: ReturnType<typeof dynamicSpans.get>) =>
                    span?.system === system && span.above === open.above ? span : undefined;
                  const before = first ? side(dynamicSpans.get(open.snap)) : undefined;
                  if (before) x1 = Math.max(x1, before.x2 + HAIRPIN_DYNAMIC_DISTANCE);
                  const after = last ? side(dynamicSpans.get(stopSnap)) : undefined;
                  if (after) x2 = Math.min(x2, after.x1 - HAIRPIN_DYNAMIC_DISTANCE);
                  if (x2 <= x1) return;
                  const y = output.place(
                    system, open.staff, x1, x2,
                    markBaseline(system, open.staff, x1, x2, open.above, shapes) - (open.above ? 0.6 : 1.1),
                    HAIRPIN_HEIGHT / 2, HAIRPIN_HEIGHT / 2, open.above, "hairpin",
                  );
                  // Opening at each end, 0 to 1; a piece broken at a system edge stops partway.
                  const growing = open.type === "crescendo";
                  const atStart = first ? 0 : PARTIAL_OPENING;
                  const atEnd = last ? 1 : PARTIAL_OPENING;
                  const [left, right] = growing ? [atStart, atEnd] : [1 - atStart, 1 - atEnd];
                  const half = HAIRPIN_HEIGHT / 2;
                  output.centred(system, open.staff, open.above, () => {
                    output.line(system, x1, y - half * left, x2, y - half * right, HAIRPIN_THICKNESS);
                    output.line(system, x1, y + half * left, x2, y + half * right, HAIRPIN_THICKNESS);
                  }, [...(first ? [open.snap] : []), ...(last ? [stopSnap] : [])]);
                });
              } else {
                wedges.set(key, {
                  from: at, snap: snapKey(staff, measureIndex, direction.onset), type: item.type, staff,
                  above: (direction.placement ?? "below") === "above",
                });
              }
              break;
            }
            case "pedal": {
              if (item.type === "start") {
                pedal = { from: at, line: item.line, changes: [] };
              } else if (item.type === "change" && pedal) {
                pedal.changes.push(at);
              } else if (item.type === "stop" && pedal) {
                drawPedal(context, output, partStaves[partStaves.length - 1], pedal, at);
                pedal = null;
              }
              break;
            }
            default:
              break;
          }
        }
      }
    });
  });
  alignChains(output);
  const boxes = new Map([...output.boxes].map(([system, list]) => [system, list.map((box) => ({ ...box }))]));
  centreBetweenStaves(context, output);
  return { drawables: output.bySystem, boxes };
}

/** MuseScore's skylineMinHorizontalClearance: marks closer side by side than this stack. */
const HORIZONTAL_CLEARANCE = 0.25;

const besides = (a: Box, b: Box) => a.x1 < b.x2 + HORIZONTAL_CLEARANCE && b.x1 < a.x2 + HORIZONTAL_CLEARANCE;

/** Marks of a system and side joined by the places they snap to. */
function chains(marks: Centrable[]): Centrable[][] {
  const result: Centrable[][] = [];
  const seen = new Set<Centrable>();
  for (const mark of marks) {
    if (seen.has(mark)) continue;
    seen.add(mark);
    const chain = [mark];
    for (let index = 0; index < chain.length; index += 1) {
      for (const other of marks) {
        if (seen.has(other) || other.system !== mark.system || other.above !== mark.above) continue;
        if (!other.snaps.some((snap) => chain[index].snaps.includes(snap))) continue;
        seen.add(other);
        chain.push(other);
      }
    }
    result.push(chain);
  }
  return result;
}

function moveMark(mark: Centrable, move: number, sp: number): void {
  mark.box.top += move;
  mark.box.bottom += move;
  for (const item of mark.items) shiftDrawable(item, move * sp);
}

/** Lines up each chain of snapped dynamics and hairpins with its mark furthest from the staff, as MuseScore does. */
function alignChains(output: Output): void {
  const sp = output.sp;
  for (const chain of chains(output.centrable)) {
    const centre = (mark: Centrable) => (mark.box.top + mark.box.bottom) / 2;
    const target = chain[0].above ? Math.min(...chain.map(centre)) : Math.max(...chain.map(centre));
    for (const mark of chain) moveMark(mark, target - centre(mark), sp);
  }
}

function shiftDrawable(item: Drawable, dy: number): void {
  if (item.kind === "glyph" || item.kind === "text") item.y += dy;
  else if (item.kind === "line") {
    item.y1 += dy;
    item.y2 += dy;
  }
}

/**
 * Centres dynamics, expressions and hairpins in the gap between a part's staves, as
 * MuseScore does on a grand staff: each group of marks above one another moves to where it
 * has as much room above as below, between what the upper staff reaches down to and what the
 * lower staff reaches up to. A mark with another of its staff's marks beyond it stays put.
 */
function centreBetweenStaves(context: Context, output: Output): void {
  const { systems, shapes, prepared, sp, crossStaff } = context;
  for (const system of systems) {
    const gaps = new Map<string, { upper: number; lower: number; marks: Centrable[] }>();
    for (const mark of output.centrable) {
      if (mark.system !== system) continue;
      const partStaves = prepared.partStaves[prepared.staves[mark.staff].part];
      const other = partStaves[partStaves.indexOf(mark.staff) + (mark.above ? -1 : 1)];
      if (other === undefined) continue;
      const [upper, lower] = mark.above ? [other, mark.staff] : [mark.staff, other];
      const gap = gaps.get(`${upper}`) ?? { upper, lower, marks: [] };
      gap.marks.push(mark);
      gaps.set(`${upper}`, gap);
    }
    // What a staff covers: its lines, its chords, and its marks that stay where they are.
    const skyline = (staff: number, moving: Set<Box>): Box[] => {
      const top = system.top + system.staffTops[staff];
      return [
        { x1: -Infinity, x2: Infinity, top, bottom: top + 4 },
        ...systemChords(system).filter((chord) => chord.staff === staff).map((chord) => {
          const extent = chordExtent(system, chord, shapes.get(chord)!, !crossStaff.has(chord));
          return { x1: extent.left, x2: extent.right, top: extent.top, bottom: extent.bottom };
        }),
        ...(output.boxes.get(system) ?? []).filter((box) => box.staff === staff && !moving.has(box)),
      ];
    };
    for (const { upper, lower, marks } of gaps.values()) {
      const chained = chains(marks);
      const chainOf = (mark: Centrable) => chained.find((chain) => chain.includes(mark))!;
      let moving = new Set(marks);
      for (;;) {
        const movingBoxes = new Set([...moving].map((mark) => mark.box));
        const blocked = [...moving].filter((mark) => skyline(mark.staff, movingBoxes).some((box) => besides(box, mark.box) &&
          (mark.above ? box.bottom <= mark.box.top + 1e-6 : box.top >= mark.box.bottom - 1e-6)));
        if (blocked.length === 0) break;
        // A chain stays together: one blocked mark keeps its whole chain in place.
        const stay = new Set(blocked.flatMap(chainOf));
        moving = new Set([...moving].filter((mark) => !stay.has(mark)));
      }
      const movingBoxes = new Set([...moving].map((mark) => mark.box));
      const above = skyline(upper, movingBoxes);
      const below = skyline(lower, movingBoxes);
      // A chain, and marks above one another, move together.
      const groups: Centrable[][] = [];
      for (const chain of chained.filter((value) => moving.has(value[0]))) {
        const joined = groups.filter((group) => group.some((other) => chain.some((mark) => besides(other.box, mark.box))));
        const merged = [...joined.flat(), ...chain];
        groups.splice(0, groups.length, ...groups.filter((group) => !joined.includes(group)), merged);
      }
      for (const group of groups) {
        let spaceAbove = Infinity;
        let spaceBelow = Infinity;
        for (const { box } of group) {
          for (const other of above) if (besides(other, box)) spaceAbove = Math.min(spaceAbove, box.top - other.bottom - MIN_DISTANCE);
          for (const other of below) if (besides(other, box)) spaceBelow = Math.min(spaceBelow, other.top - box.bottom - MIN_DISTANCE);
        }
        const move = (spaceBelow - spaceAbove) / 2;
        for (const mark of group) moveMark(mark, move, sp);
      }
    }
  }
}

function drawPedal(
  context: Context,
  output: Output,
  staff: number,
  pedal: { from: Located; line: boolean; changes: Located[] },
  to: Located,
): void {
  const { systems, shapes, prepared } = context;
  const pedWidth = glyphWidth("keyboardPedalPed");
  eachPiece(systems, pedal.from, to, (system, x1, x2, first, last) => {
    // Inset, so that a pedal pressed again where the last one lifts stays on its line.
    const y = output.place(system, staff, x1 + 0.3, x2 - 0.3, markBaseline(system, staff, x1, x2, false, shapes) + 0.5, 1.3, 0.3, false);
    if (first) output.glyph(system, "keyboardPedalPed", x1, y);
    if (!pedal.line) {
      if (last) output.glyph(system, "keyboardPedalUp", x2, y);
      return;
    }
    const lineY = y;
    const start = first ? x1 + pedWidth + 0.3 : x1;
    // A pedal change lifts and presses again: a notch in the line.
    const notches = pedal.changes.filter((change) => change.system === system).map((change) => change.x);
    let cursor = start;
    for (const x of notches) {
      output.line(system, cursor, lineY, x - 0.4, lineY, PEDAL_THICKNESS);
      output.line(system, x - 0.4, lineY, x, lineY - 1, PEDAL_THICKNESS);
      output.line(system, x, lineY - 1, x + 0.4, lineY, PEDAL_THICKNESS);
      cursor = x + 0.4;
    }
    if (x2 > cursor) output.line(system, cursor, lineY, x2, lineY, PEDAL_THICKNESS);
    if (last) output.line(system, x2, lineY, x2, lineY - 1, PEDAL_THICKNESS);
  });
}
