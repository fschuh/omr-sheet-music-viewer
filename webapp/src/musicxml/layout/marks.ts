// Marks attached to a chord: articulations, fermatas, ornaments, printed fingerings,
// arpeggio signs and tremolo strokes. Lengths are staff spaces; drawables come out in page
// pixels.
import { glyphBox, glyphWidth, type GlyphName } from "../fonts/smufl";
import type { Drawable } from "../model/layout";
import type { Box } from "./directions";
import type { ChordModel, Placement } from "../model/score";
import { ARPEGGIO_WIDTH, isUpperVoice, type ChordShape } from "./chords";
import type { PreparedChord } from "./measureContent";
import { systemChords, type PlacedSystem } from "./pages";
import { chordExtent, systemMusicStart } from "./spanners";

const ARTICULATION_GLYPHS: Record<string, [GlyphName, GlyphName]> = {
  staccato: ["articStaccatoAbove", "articStaccatoBelow"],
  accent: ["articAccentAbove", "articAccentBelow"],
  tenuto: ["articTenutoAbove", "articTenutoBelow"],
  staccatissimo: ["articStaccatissimoAbove", "articStaccatissimoBelow"],
  spiccato: ["articStaccatissimoAbove", "articStaccatissimoBelow"],
  "strong-accent": ["articMarcatoAbove", "articMarcatoBelow"],
  "detached-legato": ["articTenutoStaccatoAbove", "articTenutoStaccatoBelow"],
};

const FERMATA_GLYPHS: Record<string, [GlyphName, GlyphName]> = {
  "": ["fermataAbove", "fermataBelow"],
  normal: ["fermataAbove", "fermataBelow"],
  angled: ["fermataShortAbove", "fermataShortBelow"],
  square: ["fermataLongAbove", "fermataLongBelow"],
  "double-square": ["fermataVeryLongAbove", "fermataVeryLongBelow"],
};

const ORNAMENT_GLYPHS: Record<ChordModel["ornaments"][number]["name"], GlyphName> = {
  "trill-mark": "ornamentTrill",
  "inverted-mordent": "ornamentShortTrill",
  mordent: "ornamentMordent",
  turn: "ornamentTurn",
  "inverted-turn": "ornamentTurnInverted",
};

const FINGERING_DIGITS: Record<string, GlyphName> = {
  "0": "fingering0", "1": "fingering1", "2": "fingering2", "3": "fingering3", "4": "fingering4", "5": "fingering5",
};

const FINGERING_SCALE = 0.9;
const MARK_GAP = 0.5;
const ARTICULATION_STEP = 0.75;

interface Pen {
  items: Drawable[];
  /** What each unrotated mark covers, in staff spaces. */
  boxes: Box[];
  glyph(name: GlyphName, x: number, y: number, scale?: number, rotate?: number): void;
  text(text: string, x: number, y: number, size: number): void;
}

function pen(sp: number): Pen {
  const items: Drawable[] = [];
  const boxes: Box[] = [];
  return {
    items,
    boxes,
    glyph: (name, x, y, scale = 1, rotate) => {
      items.push({ kind: "glyph", glyph: name, x: x * sp, y: y * sp, scale, ...(rotate === undefined ? {} : { rotate }) });
      if (rotate !== undefined) return;
      const box = glyphBox(name);
      boxes.push({ x1: x + box.left * scale, x2: x + box.right * scale, top: y + box.top * scale, bottom: y + box.bottom * scale });
    },
    text: (text, x, y, size) => {
      items.push({ kind: "text", text, x: x * sp, y: y * sp, size: size * sp, anchor: "middle" });
      const width = text.length * size * 0.5;
      boxes.push({ x1: x - width / 2, x2: x + width / 2, top: y - size * 0.75, bottom: y + size * 0.25 });
    },
  };
}

/** Which side a chord's marks go to: the file's placement, else away from the stem. */
function markSide(chord: PreparedChord, shape: ChordShape, placement: Placement): boolean {
  if (placement) return placement === "above";
  if (chord.sharedStaff) return isUpperVoice(chord.model.voice);
  return shape.stem ? !shape.stem.up : true;
}

/**
 * Fingerings go above on the top staff of a part and below on the others, unless voices
 * share the staff: then each voice's go on its own side.
 */
function fingeringAbove(chord: PreparedChord): boolean {
  if (chord.sharedStaff) return isUpperVoice(chord.model.voice);
  return chord.model.staff === 1;
}

/** A glyph centred on (x, y): SMuFL glyphs have their own origins. */
function centred(output: Pen, name: GlyphName, x: number, y: number, scale = 1): void {
  const box = glyphBox(name);
  output.glyph(name, x - ((box.left + box.right) / 2) * scale, y - ((box.top + box.bottom) / 2) * scale, scale);
}

/** Within the staff, marks sit in a space rather than on a line. */
function offLine(y: number, staffTop: number, above: boolean): number {
  const relative = y - staffTop;
  if (relative < -0.2 || relative > 4.2) return y;
  const nearest = Math.round(relative);
  if (Math.abs(relative - nearest) > 0.2) return y;
  return staffTop + nearest + (above ? -0.5 : 0.5);
}

/** Where a chord's trill line starts: after its trill sign, or above the chord without one. */
interface TrillAnchor {
  x: number;
  y: number;
}

function chordMarks(system: PlacedSystem, chord: PreparedChord, shape: ChordShape, output: Pen): TrillAnchor {
  const model = chord.model;
  const x = system.chords.get(chord)!;
  const staffTop = system.top + system.staffTops[chord.staff];
  const extent = chordExtent(system, chord, shape);
  const headCentre = shape.rest
    ? x + shape.rest.x + (glyphBox(shape.rest.glyph).right * shape.scale) / 2
    : x + (glyphWidth(shape.notes[0]?.head ?? "noteheadBlack") * shape.scale) / 2;
  const ys = shape.notes.map((note) => staffTop + note.y);
  const topNote = ys.length ? Math.min(...ys) : extent.top;
  const bottomNote = ys.length ? Math.max(...ys) : extent.bottom;

  // Articulations stack outward from the notehead on the side away from the stem.
  let above = 0;
  let below = 0;
  for (const articulation of model.articulations) {
    const glyphs = ARTICULATION_GLYPHS[articulation.name];
    if (!glyphs) continue;
    const up = markSide(chord, shape, articulation.placement);
    const stemOnSide = shape.stem && shape.stem.up === up;
    const start = up
      ? (stemOnSide ? staffTop + shape.stem!.yEnd : topNote) - 0.9
      : (stemOnSide ? staffTop + shape.stem!.yEnd : bottomNote) + 0.9;
    const y = offLine(up ? start - above : start + below, staffTop, up);
    centred(output, up ? glyphs[0] : glyphs[1], headCentre, y, shape.scale);
    if (up) above += ARTICULATION_STEP;
    else below += ARTICULATION_STEP;
  }

  let outerTop = Math.min(staffTop, extent.top) - above;
  let outerBottom = Math.max(staffTop + 4, extent.bottom) + below;
  if (model.fermata) {
    const glyphs = FERMATA_GLYPHS[model.fermata.shape] ?? FERMATA_GLYPHS[""];
    if (model.fermata.inverted) {
      const box = glyphBox(glyphs[1]);
      const y = outerBottom + MARK_GAP - box.top;
      output.glyph(glyphs[1], headCentre - (box.left + box.right) / 2, y);
      outerBottom = y + box.bottom;
    } else {
      const box = glyphBox(glyphs[0]);
      const y = outerTop - MARK_GAP - box.bottom;
      output.glyph(glyphs[0], headCentre - (box.left + box.right) / 2, y);
      outerTop = y + box.top;
    }
  }
  let trill: TrillAnchor | null = null;
  for (const ornament of model.ornaments) {
    const glyph = ORNAMENT_GLYPHS[ornament.name];
    const box = glyphBox(glyph);
    const x = headCentre - (box.left + box.right) / 2;
    if (ornament.placement === "below") {
      const y = outerBottom + MARK_GAP - box.top;
      output.glyph(glyph, x, y);
      outerBottom = y + box.bottom;
    } else {
      const y = outerTop - MARK_GAP - box.bottom;
      output.glyph(glyph, x, y);
      outerTop = y + box.top;
      if (ornament.name === "trill-mark") trill = { x: x + box.right + 0.2, y: y + (box.top + box.bottom) / 2 + 0.3 };
    }
  }

  // Fingerings stack over or under the chord in the order of its notes; several on one
  // note, a finger change, stand in a row.
  const fingered = shape.notes
    .map((note) => ({ note, fingerings: model.notes[note.index].fingerings }))
    .filter((entry) => entry.fingerings.length > 0)
    .sort((a, b) => a.note.position - b.note.position);
  if (fingered.length) {
    const placement = fingered[0].fingerings[0].placement;
    const up = placement ? placement === "above" : fingeringAbove(chord);
    const rows = fingered.map((entry) => entry.fingerings.map((fingering) => fingering.text));
    let y = up
      ? Math.min(topNote - 1.2, shape.stem && shape.stem.up ? staffTop + shape.stem.yEnd - 0.6 : Infinity)
      : Math.max(bottomNote + 1.2, shape.stem && !shape.stem.up ? staffTop + shape.stem.yEnd + 0.6 : -Infinity);
    for (const row of up ? [...rows].reverse() : rows) {
      const digits = row.flatMap((label) => [...label]);
      if (digits.every((digit) => FINGERING_DIGITS[digit])) {
        // One baseline for the row, centred on y by the row's tallest digits.
        const boxes = digits.map((digit) => glyphBox(FINGERING_DIGITS[digit]));
        const middle = (Math.min(...boxes.map((box) => box.top)) + Math.max(...boxes.map((box) => box.bottom))) / 2;
        const widths = boxes.map((box) => (box.right - box.left) * FINGERING_SCALE);
        let x = headCentre - widths.reduce((total, width) => total + width, 0) / 2;
        digits.forEach((digit, index) => {
          output.glyph(FINGERING_DIGITS[digit], x - boxes[index].left * FINGERING_SCALE, y - middle * FINGERING_SCALE, FINGERING_SCALE);
          x += widths[index];
        });
      } else {
        output.text(row.join(""), headCentre, y + 0.45, 1.3);
      }
      y += up ? -1.1 : 1.1;
    }
  }

  if (model.tremolo && shape.stem && (model.tremolo.type === "single" || model.tremolo.type === "unmeasured")) {
    const strokes = Math.max(1, Math.min(4, model.tremolo.marks || 3));
    const glyph = `tremolo${strokes}` as GlyphName;
    const stemX = x + shape.stem.x;
    const middle = staffTop + (shape.stem.yStart + shape.stem.yEnd) / 2;
    centred(output, glyph, stemX, middle, shape.scale);
  }
  return trill ?? { x: headCentre, y: outerTop - MARK_GAP - 0.5 };
}

/** A trill line: the wiggle repeated from one x to another, centred on y. */
function trillLine(output: Pen, from: number, to: number, y: number): void {
  const width = glyphWidth("wiggleTrill");
  const box = glyphBox("wiggleTrill");
  const count = Math.floor((to - from) / width);
  for (let index = 0; index < count; index += 1) {
    output.glyph("wiggleTrill", from + index * width, y - (box.top + box.bottom) / 2);
  }
}

/** Where a chord's sound ends on the page: at the part's next chord on its staff, or its barline. */
function chordEndX(system: PlacedSystem, chord: PreparedChord, chords: PreparedChord[]): number {
  const x = system.chords.get(chord)!;
  const next = chords
    .filter((other) => other.part === chord.part && other.staff === chord.staff && !other.model.grace)
    .map((other) => system.chords.get(other)!)
    .filter((value) => value > x + 0.01);
  if (next.length) return Math.min(...next) - 0.6;
  const position = system.plan.measures.indexOf(chord.measureIndex);
  return (system.measures[position]?.barlineX ?? system.right) - 0.4;
}

/** The wiggle of an arpeggio sign, from top to bottom, with an arrow where the roll has a direction. */
function arpeggioSign(output: Pen, x: number, top: number, bottom: number, direction: "up" | "down" | null): void {
  const segment = glyphWidth("wiggleArpeggiatoUp");
  const count = Math.max(1, Math.ceil((bottom - top) / segment));
  // The wiggle glyphs run left to right; turned a quarter turn they run bottom to top.
  for (let index = 0; index < count; index += 1) {
    output.glyph("wiggleArpeggiatoUp", x, bottom - index * segment, 1, -90);
  }
  if (direction === "up") output.glyph("wiggleArpeggiatoUpArrow", x, bottom - count * segment, 1, -90);
  if (direction === "down") output.glyph("wiggleArpeggiatoDownArrow", x, bottom + 0.2, 1, 90);
}

/**
 * Chord marks of every chord in each system, and arpeggio signs across a part's staves,
 * with the boxes the marks cover for directions to avoid.
 */
export function layoutMarks(
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
  sp: number,
): { drawables: Map<PlacedSystem, Drawable[]>; boxes: Map<PlacedSystem, Box[]> } {
  const drawables = new Map<PlacedSystem, Drawable[]>();
  const boxes = new Map<PlacedSystem, Box[]>();
  const outputs = new Map(systems.map((system) => [system, pen(sp)]));
  // Trill lines run from the chord that starts one to the end of the chord that stops it.
  const trills = new Map<string, { system: PlacedSystem; chord: PreparedChord; anchor: TrillAnchor }>();
  for (const system of systems) {
    const output = outputs.get(system)!;
    const chords = systemChords(system).sort((a, b) => system.chords.get(a)! - system.chords.get(b)!);
    for (const chord of chords) {
      if (!chord.model.printed) continue;
      const anchor = chordMarks(system, chord, shapes.get(chord)!, output);
      // In document order, so that a line starting and stopping on one note spans that note.
      for (const wavy of chord.model.wavyLines) {
        const key = `${chord.part}|${wavy.number}`;
        if (wavy.type === "start") trills.set(key, { system, chord, anchor });
        if (wavy.type !== "stop") continue;
        const start = trills.get(key);
        if (!start) continue;
        trills.delete(key);
        const end = chordEndX(system, chord, chords);
        if (start.system === system) {
          trillLine(output, start.anchor.x, end, start.anchor.y);
        } else {
          trillLine(outputs.get(start.system)!, start.anchor.x, start.system.right - 0.3, start.anchor.y);
          const middle = systems.slice(systems.indexOf(start.system) + 1, systems.indexOf(system));
          for (const between of middle) {
            const y = between.top + between.staffTops[start.chord.staff] - 1.5;
            trillLine(outputs.get(between)!, systemMusicStart(between), between.right - 0.3, y);
          }
          const y = system.top + system.staffTops[chord.staff] + (start.anchor.y - (start.system.top + start.system.staffTops[start.chord.staff]));
          trillLine(output, systemMusicStart(system), end, y);
        }
      }
    }
    // Arpeggio signs: chords of a part at one onset with the same number share one sign.
    const rolls = new Map<string, PreparedChord[]>();
    for (const chord of chords) {
      if (!chord.model.arpeggiate || chord.model.notes.length === 0) continue;
      const key = `${chord.part}|${chord.measureIndex}|${chord.model.onset.n}/${chord.model.onset.d}|${chord.model.arpeggiate.number}`;
      rolls.set(key, [...(rolls.get(key) ?? []), chord]);
    }
    for (const roll of rolls.values()) {
      const extents = roll.map((chord) => {
        const shape = shapes.get(chord)!;
        const staffTop = system.top + system.staffTops[chord.staff];
        const ys = shape.notes.map((note) => staffTop + note.y);
        return { left: system.chords.get(chord)! - shape.left, top: Math.min(...ys), bottom: Math.max(...ys) };
      });
      const x = Math.min(...extents.map((extent) => extent.left)) + 0.1;
      arpeggioSign(
        output,
        x + (ARPEGGIO_WIDTH - 0.5) / 2,
        Math.min(...extents.map((extent) => extent.top)) - 0.6,
        Math.max(...extents.map((extent) => extent.bottom)) + 0.6,
        roll[0].model.arpeggiate!.direction,
      );
    }
  }
  for (const [system, output] of outputs) {
    if (output.items.length) drawables.set(system, output.items);
    boxes.set(system, output.boxes);
  }
  return { drawables, boxes };
}
