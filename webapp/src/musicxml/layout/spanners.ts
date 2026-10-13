// Spanners: marks that connect notes or measures, laid out once every chord has its place.
// Lengths are staff spaces; drawables come out in page pixels.
import { ENGRAVING_DEFAULTS, glyphBox, type GlyphName } from "../fonts/smufl";
import type { Drawable } from "../model/layout";
import type { NoteModel, Placement, TupletStart } from "../model/score";
import { isUpperVoice, type ChordShape } from "./chords";
import type { PreparedChord } from "./measureContent";
import { systemChords, type PlacedSystem } from "./pages";
import { soundingPitch } from "./staffPosition";

const TIE_MID_THICKNESS = ENGRAVING_DEFAULTS.tieMidpointThickness;
const TIE_GAP = 0.12;
const TIE_NOTE_OFFSET = 0.3;
const MIDDLE_POSITION = 4;

/** Where a note was drawn, in staff spaces from the page's top left. */
export interface NotePlace {
  system: PlacedSystem;
  chord: PreparedChord;
  left: number;
  right: number;
  y: number;
  /** The tie's side: true above the note. */
  tieUp: boolean;
}

/**
 * Which side a note's tie bows to: away from the stem for a single note, upward for the
 * upper notes of a chord and downward for the lower ones, and toward their own side for
 * voices that share a staff.
 */
function tieSides(chord: PreparedChord, shape: ChordShape): Map<number, boolean> {
  const sides = new Map<number, boolean>();
  const notes = [...shape.notes].sort((a, b) => a.position - b.position);
  const stemUp = shape.stem?.up ?? null;
  const awayFromStem = (position: number) =>
    chord.sharedStaff ? isUpperVoice(chord.model.voice)
      : stemUp === null ? position < MIDDLE_POSITION : !stemUp;
  notes.forEach((note, index) => {
    if (notes.length === 1 || (notes.length % 2 === 1 && index === (notes.length - 1) / 2)) {
      sides.set(note.index, awayFromStem(note.position));
    } else {
      sides.set(note.index, index < notes.length / 2);
    }
  });
  return sides;
}

export function notePlaces(
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
): Map<NoteModel, NotePlace> {
  const places = new Map<NoteModel, NotePlace>();
  for (const system of systems) {
    for (const chord of systemChords(system)) {
      const shape = shapes.get(chord)!;
      const x = system.chords.get(chord)!;
      const staffTop = system.top + system.staffTops[chord.staff];
      const sides = tieSides(chord, shape);
      for (const note of shape.notes) {
        const box = glyphBox(note.head);
        places.set(chord.model.notes[note.index], {
          system,
          chord,
          left: x + note.x + box.left * shape.scale,
          right: x + note.x + box.right * shape.scale,
          y: staffTop + note.y,
          tieUp: sides.get(note.index)!,
        });
      }
    }
  }
  return places;
}

/**
 * A filled crescent from (x1, y1) to (x2, y2), bowing up or down, in page pixels. `control`
 * is how far the control points sit off the chord; the curve's peak is three quarters of it.
 */
export function curvePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  up: boolean,
  sp: number,
  options: { control?: number; thickness?: number } = {},
): Drawable {
  const length = Math.abs(x2 - x1);
  const control = options.control ?? Math.min(1.5, Math.max(0.5, 0.35 + length * 0.08));
  const height = control * (up ? -1 : 1);
  const inner = height - (options.thickness ?? TIE_MID_THICKNESS) * Math.sign(height);
  const c1 = x1 + (x2 - x1) / 4;
  const c2 = x2 - (x2 - x1) / 4;
  const p = (value: number) => +(value * sp).toFixed(2);
  return {
    kind: "path",
    d: `M${p(x1)} ${p(y1)}C${p(c1)} ${p(y1 + height)} ${p(c2)} ${p(y2 + height)} ${p(x2)} ${p(y2)}` +
      `C${p(c2)} ${p(y2 + inner)} ${p(c1)} ${p(y1 + inner)} ${p(x1)} ${p(y1)}Z`,
  };
}

/** Where a system's music starts, after its header: ties continued from before begin here. */
export function systemMusicStart(system: PlacedSystem): number {
  return system.measures[0].segmentX[0] - 1.5;
}

/**
 * Ties, joining each note that starts a tie to the next note of the same sound in its part,
 * under any spelling, that ends one. A tie across a system break is drawn in two halves.
 */
export function layoutTies(
  systems: PlacedSystem[],
  places: Map<NoteModel, NotePlace>,
  sp: number,
): Map<PlacedSystem, Drawable[]> {
  const result = new Map<PlacedSystem, Drawable[]>();
  const add = (system: PlacedSystem, item: Drawable) => result.set(system, [...(result.get(system) ?? []), item]);
  const open = new Map<string, { note: NoteModel; place: NotePlace }>();
  for (const system of systems) {
    const chords = systemChords(system)
      .filter((chord) => !chord.model.grace)
      .sort((a, b) => a.measureIndex - b.measureIndex || a.model.onset.n / a.model.onset.d - b.model.onset.n / b.model.onset.d);
    for (const chord of chords) {
      for (const note of chord.model.notes) {
        const place = places.get(note);
        if (!place) continue;
        // A tie joins one sound, which a respelling (D♭5 to C♯5) does not change.
        const key = `${chord.part}|${soundingPitch(note)}`;
        const start = note.tieStop ? open.get(key) : undefined;
        if (start) {
          open.delete(key);
          const up = start.place.tieUp;
          const offset = TIE_NOTE_OFFSET * (up ? -1 : 1);
          if (start.place.system === system) {
            add(system, curvePath(start.place.right + TIE_GAP, start.place.y + offset, place.left - TIE_GAP, place.y + offset, up, sp));
          } else {
            const from = start.place.system;
            add(from, curvePath(start.place.right + TIE_GAP, start.place.y + offset, from.right - 0.3, start.place.y + offset, up, sp));
            add(system, curvePath(systemMusicStart(system), place.y + offset, place.left - TIE_GAP, place.y + offset, up, sp));
          }
        }
        if (note.tieStart) open.set(key, { note, place });
      }
    }
  }
  return result;
}

const TUPLET_DISTANCE = 0.9;
const TUPLET_BRACKET_HOOK = 0.6;
const TUPLET_NUMBER_GAP = 0.3;
const TUPLET_BRACKET_THICKNESS = ENGRAVING_DEFAULTS.tupletBracketThickness;

const SLUR_THICKNESS = ENGRAVING_DEFAULTS.slurMidpointThickness;
const SLUR_NOTE_GAP = 0.5;
const SLUR_STEM_GAP = 0.3;
const SLUR_CLEARANCE = 0.6;
const SLUR_MAX_CONTROL = 5;

interface SlurStart {
  system: PlacedSystem;
  chord: PreparedChord;
  placement: Placement;
}

/** Whether a slur bows upward: the file's placement, else below only when every stem points up. */
function slurUp(start: PreparedChord, end: PreparedChord, shapes: Map<PreparedChord, ChordShape>, placement: Placement): boolean {
  if (placement) return placement === "above";
  if (start.sharedStaff) return isUpperVoice(start.model.voice);
  const stemsUp = [start, end].map((chord) => {
    const shape = shapes.get(chord)!;
    if (shape.stem) return shape.stem.up;
    const positions = shape.notes.map((note) => note.position);
    return positions.length > 0 && positions.reduce((sum, value) => sum + value, 0) / positions.length >= MIDDLE_POSITION;
  });
  return !stemsUp.every(Boolean);
}

/** Where a slur meets a chord: past the stem's end when the stem points the slur's way, else past the notehead. */
function slurAnchor(system: PlacedSystem, chord: PreparedChord, shape: ChordShape, up: boolean): { x: number; y: number } {
  const x = system.chords.get(chord)!;
  const staffTop = system.top + system.staffTops[chord.staff];
  const extent = chordExtent(system, chord, shape);
  if (shape.stem && shape.stem.up === up) {
    return { x: x + shape.stem.x, y: staffTop + shape.stem.yEnd + (up ? -SLUR_STEM_GAP : SLUR_STEM_GAP) };
  }
  const ys = shape.notes.map((note) => staffTop + note.y);
  const y = up
    ? (ys.length ? Math.min(...ys) : extent.top) - SLUR_NOTE_GAP
    : (ys.length ? Math.max(...ys) : extent.bottom) + SLUR_NOTE_GAP;
  return { x: (extent.left + extent.right) / 2, y };
}

/**
 * One piece of a slur within a system. The curve rises with its length, and further, or
 * its ends move out, so that it clears every chord of the part's staves it passes over.
 */
function slurPiece(
  system: PlacedSystem,
  from: { x: number; y: number },
  to: { x: number; y: number },
  up: boolean,
  over: { chord: PreparedChord; shape: ChordShape }[],
  sp: number,
): Drawable {
  const length = Math.max(0.1, to.x - from.x);
  const sign = up ? -1 : 1;
  let control = Math.min(2.5, Math.max(0.8, 0.6 + length * 0.1));
  const intrusions: { t: number; depth: number }[] = [];
  for (const { chord, shape } of over) {
    const extent = chordExtent(system, chord, shape);
    for (const x of [extent.left, extent.right]) {
      const t = (x - from.x) / length;
      if (t <= 0.02 || t >= 0.98) continue;
      const line = from.y + t * (to.y - from.y);
      // How far the chord reaches past the straight line between the slur's ends.
      const depth = up ? line - extent.top : extent.bottom - line;
      intrusions.push({ t, depth: depth + SLUR_CLEARANCE });
    }
  }
  for (const { t, depth } of intrusions) control = Math.max(control, Math.min(SLUR_MAX_CONTROL, depth / (3 * t * (1 - t))));
  const lift = Math.max(0, ...intrusions.map(({ t, depth }) => depth - 3 * t * (1 - t) * control));
  return curvePath(from.x, from.y + sign * lift, to.x, to.y + sign * lift, up, sp, { control, thickness: SLUR_THICKNESS });
}

/**
 * Slurs, joining each start to the next stop with the same number in its part. A slur
 * across system breaks is drawn in pieces: to the end of its first system, across any
 * systems between, and from the start of its last.
 */
export function layoutSlurs(
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
  sp: number,
): Map<PlacedSystem, Drawable[]> {
  const result = new Map<PlacedSystem, Drawable[]>();
  const add = (system: PlacedSystem, item: Drawable) => result.set(system, [...(result.get(system) ?? []), item]);
  const ordered = systems.map((system) =>
    systemChords(system)
      .filter((chord) => chord.model.printed)
      .sort((a, b) => system.chords.get(a)! - system.chords.get(b)!),
  );
  const chordsOver = (system: PlacedSystem, part: number, staves: Set<number>, left: number, right: number) =>
    ordered[systems.indexOf(system)]
      .filter((chord) => chord.part === part && staves.has(chord.staff))
      .filter((chord) => {
        const x = system.chords.get(chord)!;
        return x > left && x < right;
      })
      .map((chord) => ({ chord, shape: shapes.get(chord)! }));
  // Files reuse a number in other voices while a slur is open, so a stop closes the open
  // start of its own voice first, then of its own staff, then the latest.
  const open = new Map<string, SlurStart[]>();
  const close = (key: string, chord: PreparedChord): SlurStart | undefined => {
    const starts = [...(open.get(key) ?? [])].reverse();
    const match =
      starts.find((start) => start.chord.staff === chord.staff && start.chord.model.voice === chord.model.voice) ??
      starts.find((start) => start.chord.staff === chord.staff) ??
      starts[0];
    if (match) open.set(key, open.get(key)!.filter((start) => start !== match));
    return match;
  };
  systems.forEach((system, systemIndex) => {
    for (const chord of ordered[systemIndex]) {
      for (const mark of chord.model.slurs) {
        if (mark.type !== "stop") continue;
        const start = close(`${chord.part}|${mark.number}`, chord);
        if (!start) continue;
        const up = slurUp(start.chord, chord, shapes, start.placement);
        const staves = new Set([start.chord.staff, chord.staff]);
        const from = slurAnchor(start.system, start.chord, shapes.get(start.chord)!, up);
        const to = slurAnchor(system, chord, shapes.get(chord)!, up);
        if (start.system === system) {
          add(system, slurPiece(system, from, to, up, chordsOver(system, chord.part, staves, from.x, to.x), sp));
          continue;
        }
        const first = start.system;
        add(first, slurPiece(first, from, { x: first.right - 0.3, y: from.y }, up, chordsOver(first, chord.part, staves, from.x, first.right), sp));
        for (const middle of systems.slice(systems.indexOf(first) + 1, systemIndex)) {
          const staffTop = middle.top + middle.staffTops[start.chord.staff];
          const y = up ? staffTop - 1 : staffTop + 5;
          const left = systemMusicStart(middle);
          add(middle, slurPiece(middle, { x: left, y }, { x: middle.right - 0.3, y }, up, chordsOver(middle, chord.part, staves, left, middle.right), sp));
        }
        const left = systemMusicStart(system);
        add(system, slurPiece(system, { x: left, y: to.y }, to, up, chordsOver(system, chord.part, staves, left, to.x), sp));
      }
      for (const mark of chord.model.slurs) {
        if (mark.type !== "start") continue;
        const key = `${chord.part}|${mark.number}`;
        open.set(key, [...(open.get(key) ?? []), { system, chord, placement: mark.placement }]);
      }
    }
  });
  return result;
}

function tupletDigits(value: number): GlyphName[] {
  return [...String(value)].map((digit) => `tuplet${digit}` as GlyphName);
}

/** A chord's extent on the page, with its stem and beam. */
export function chordExtent(system: PlacedSystem, chord: PreparedChord, shape: ChordShape) {
  const x = system.chords.get(chord)!;
  const staffTop = system.top + system.staffTops[chord.staff];
  const xs = shape.rest
    ? [x + shape.rest.x, x + shape.rest.x + glyphBox(shape.rest.glyph).right * shape.scale]
    : shape.notes.flatMap((note) => [x + note.x, x + note.x + glyphBox(note.head).right * shape.scale]);
  const ys = [shape.top, shape.bottom, ...(shape.stem ? [shape.stem.yEnd] : [])].map((y) => staffTop + y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * Tuplets: the number centred over or under the group, beyond its stems and beams, and a
 * bracket when the file asks for one or the group is not beamed together. A tuplet is
 * drawn in the system it starts in.
 */
export function layoutTuplets(
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
  sp: number,
): Map<PlacedSystem, Drawable[]> {
  const result = new Map<PlacedSystem, Drawable[]>();
  const add = (system: PlacedSystem, items: Drawable[]) => result.set(system, [...(result.get(system) ?? []), ...items]);
  const open = new Map<string, { start: TupletStart; system: PlacedSystem; chords: PreparedChord[] }>();
  const groups: { start: TupletStart; system: PlacedSystem; chords: PreparedChord[] }[] = [];
  for (const system of systems) {
    const chords = systemChords(system)
      .filter((chord) => !chord.model.grace)
      .sort((a, b) => a.measureIndex - b.measureIndex || a.model.onset.n / a.model.onset.d - b.model.onset.n / b.model.onset.d);
    for (const chord of chords) {
      const lane = `${chord.part}|${chord.model.voice}`;
      for (const start of chord.model.tupletStarts) {
        open.set(`${lane}|${start.number}`, { start, system, chords: [] });
      }
      for (const [key, group] of open) {
        if (key.startsWith(`${lane}|`) && group.system === system) group.chords.push(chord);
      }
      for (const number of chord.model.tupletStops) {
        const key = `${lane}|${number}`;
        const group = open.get(key);
        if (group) groups.push(group);
        open.delete(key);
      }
    }
  }
  for (const { start, system, chords } of groups) {
    if (chords.length === 0) continue;
    const beamed = chords.every((chord) => !chord.model.rest && chord.model.beams[0]);
    const showBracket = start.bracket ?? !beamed;
    const extents = chords.map((chord) => chordExtent(system, chord, shapes.get(chord)!));
    const stems = chords.map((chord) => shapes.get(chord)!.stem).filter((stem) => stem !== null);
    const above = start.placement
      ? start.placement === "above"
      : !(stems.length > 0 && stems.every((stem) => !stem!.up));
    const left = Math.min(...extents.map((extent) => extent.left));
    const right = Math.max(...extents.map((extent) => extent.right));
    const y = above
      ? Math.min(...extents.map((extent) => extent.top)) - TUPLET_DISTANCE
      : Math.max(...extents.map((extent) => extent.bottom)) + TUPLET_DISTANCE;
    const glyphs: GlyphName[] = start.showNumber === "none" ? []
      : start.showNumber === "both" ? [...tupletDigits(start.actual), "tupletColon", ...tupletDigits(start.normal)]
      : tupletDigits(start.actual);
    const width = glyphs.reduce((total, glyph) => total + glyphBox(glyph).right, 0);
    const middle = (left + right) / 2;
    const items: Drawable[] = [];
    // Tuplet digits stand on their baseline and are about 1.45 spaces tall.
    let cursor = middle - width / 2;
    for (const glyph of glyphs) {
      items.push({ kind: "glyph", glyph, x: cursor * sp, y: (y + 0.72) * sp, scale: 1 });
      cursor += glyphBox(glyph).right;
    }
    if (showBracket) {
      const hook = above ? TUPLET_BRACKET_HOOK : -TUPLET_BRACKET_HOOK;
      const gapLeft = glyphs.length ? middle - width / 2 - TUPLET_NUMBER_GAP : middle;
      const gapRight = glyphs.length ? middle + width / 2 + TUPLET_NUMBER_GAP : middle;
      const line = (x1: number, y1: number, x2: number, y2: number): Drawable =>
        ({ kind: "line", x1: x1 * sp, y1: y1 * sp, x2: x2 * sp, y2: y2 * sp, width: TUPLET_BRACKET_THICKNESS * sp });
      items.push(
        line(left, y + hook, left, y), line(left, y, gapLeft, y),
        line(gapRight, y, right, y), line(right, y, right, y + hook),
      );
    }
    add(system, items);
  }
  return result;
}

/** Spanners of several kinds, by the system they are drawn in. */
export function mergeSpanners(...maps: Map<PlacedSystem, Drawable[]>[]): Map<PlacedSystem, Drawable[]> {
  const result = new Map<PlacedSystem, Drawable[]>();
  for (const map of maps) {
    for (const [system, items] of map) result.set(system, [...(result.get(system) ?? []), ...items]);
  }
  return result;
}

const VOLTA_HEIGHT = 3;
const VOLTA_HOOK = 1.9;
const VOLTA_TEXT_SIZE = 1.6;
const VOLTA_LINE_THICKNESS = ENGRAVING_DEFAULTS.repeatEndingLineThickness;

/**
 * Voltas: a bracket over the system's top staff from the measure an ending starts in to the
 * one it ends in, with its text, a hook at the start, and one at the end unless the ending
 * is discontinued. A volta across a system break continues in the next system.
 */
export function layoutVoltas(
  systems: PlacedSystem[],
  shapes: Map<PreparedChord, ChordShape>,
  sp: number,
): Map<PlacedSystem, Drawable[]> {
  const result = new Map<PlacedSystem, Drawable[]>();
  const line = (x1: number, y1: number, x2: number, y2: number): Drawable =>
    ({ kind: "line", x1: x1 * sp, y1: y1 * sp, x2: x2 * sp, y2: y2 * sp, width: VOLTA_LINE_THICKNESS * sp });
  let open: { text: string } | null = null;
  for (const system of systems) {
    const top = system.top + system.staffTops[0];
    // Clear of the top staff's notes in the system.
    const contentTop = Math.min(top, ...systemChords(system)
      .filter((chord) => chord.staff === 0)
      .map((chord) => chordExtent(system, chord, shapes.get(chord)!).top));
    const y = Math.min(top - VOLTA_HEIGHT, contentTop - 1.5);
    const items: Drawable[] = [];
    const firstMeasure = system.measures[0].spacing.measure;
    if (firstMeasure.startRepeat) open = null;
    let start: { x: number; text: string | null } | null = open ? { x: systemMusicStart(system), text: null } : null;
    const close = (end: number, hook: boolean) => {
      if (!start) return;
      if (start.text !== null) {
        items.push(line(start.x, y + VOLTA_HOOK, start.x, y));
        items.push({ kind: "text", text: start.text, x: (start.x + 0.4) * sp, y: (y + VOLTA_TEXT_SIZE) * sp, size: VOLTA_TEXT_SIZE * sp, anchor: "start" });
      }
      items.push(line(start.x, y, end, y));
      if (hook) items.push(line(end, y, end, y + VOLTA_HOOK));
      start = null;
      open = null;
    };
    system.measures.forEach((placed, position) => {
      const measure = placed.spacing.measure;
      // An ending never runs past a start-repeat, even when the file does not close it.
      if (measure.startRepeat && start && position > 0) close(placed.left - 0.3, false);
      if (measure.endingStart) {
        open = { text: measure.endingStart.text };
        const x = (position === 0 ? placed.segmentX[0] - 1.5 : placed.left) + 0.3;
        start = { x, text: measure.endingStart.text };
      }
      if (measure.endingEnd && start) close(placed.barlineX - 0.3, measure.endingEnd === "stop");
    });
    if (start) {
      // The volta goes on in the next system.
      const continuing: { text: string } | null = open;
      close(system.right - 0.3, false);
      open = continuing;
    }
    if (items.length) result.set(system, items);
  }
  return result;
}
