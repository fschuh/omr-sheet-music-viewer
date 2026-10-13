// Beams: grouping beamed chords and choosing stem directions before spacing, then the
// beam line and stem ends once chords have their x positions. Lengths are staff spaces.
import { ENGRAVING_DEFAULTS } from "../fonts/smufl";
import { compare } from "../model/fraction";
import type { PreparedChord, PreparedMeasure } from "./measureContent";
import { flagCount, isUpperVoice, noteType, STEM_WIDTH, type ChordShape } from "./chords";
import { staffPosition } from "./staffPosition";

const BEAM_THICKNESS = ENGRAVING_DEFAULTS.beamThickness;
/** From one beam to the next: thickness plus the gap between them. */
const BEAM_STEP = ENGRAVING_DEFAULTS.beamThickness + ENGRAVING_DEFAULTS.beamSpacing;
const HOOK_LENGTH = 1.1;
const MIDDLE_POSITION = 4;
const MAX_SLANT = 1;

export type BeamGroup = PreparedChord[];

/** Chords joined by an eighth-note beam, per part and voice; grace notes beam among themselves. */
export function beamGroups(measure: PreparedMeasure): BeamGroup[] {
  const chords = measure.segments.flatMap((segment) => [...segment.graces, ...segment.chords]);
  const lanes = new Map<string, PreparedChord[]>();
  for (const chord of chords) {
    const lane = `${chord.part}|${chord.model.voice}|${chord.model.grace ? "grace" : "main"}`;
    lanes.set(lane, [...(lanes.get(lane) ?? []), chord]);
  }
  const groups: BeamGroup[] = [];
  for (const lane of lanes.values()) {
    let open: PreparedChord[] | null = null;
    for (const chord of [...lane].sort((a, b) => compare(a.model.onset, b.model.onset))) {
      const value = chord.model.rest ? null : chord.model.beams[0] ?? null;
      if (value === "begin" || (value === "continue" && !open)) {
        if (open && open.length > 1) groups.push(open);
        open = [chord];
      } else if (value === "continue" && open) {
        open.push(chord);
      } else if (value === "end" && open) {
        open.push(chord);
        if (open.length > 1) groups.push(open);
        open = null;
      } else {
        if (open && open.length > 1) groups.push(open);
        open = null;
      }
    }
    if (open && open.length > 1) groups.push(open);
  }
  return groups;
}

/** Stems go up when the note furthest from the middle line is below it. */
function upForPositions(positions: number[]): boolean {
  const above = MIDDLE_POSITION - Math.min(...positions);
  const below = Math.max(...positions) - MIDDLE_POSITION;
  return below > above;
}

function positions(chord: PreparedChord): number[] {
  return chord.model.notes.map((note) => staffPosition(chord.clef, note.step, note.octave));
}

/**
 * Stem directions: what the file encodes; else a beam group's notes together decide, a
 * voice sharing its staff keeps to its side, grace notes point up, and a lone chord
 * follows its note furthest from the middle line.
 */
export function stemDirections(measure: PreparedMeasure, groups: BeamGroup[]): Map<PreparedChord, boolean> {
  const result = new Map<PreparedChord, boolean>();
  const encoded = (chord: PreparedChord) =>
    chord.model.stem === "up" ? true : chord.model.stem === "down" ? false : null;
  for (const group of groups) {
    const shared = group.some((chord) => chord.sharedStaff);
    const groupUp = group[0].model.grace
      ? true
      : shared
        ? isUpperVoice(group[0].model.voice)
        : upForPositions(group.flatMap(positions));
    for (const chord of group) result.set(chord, encoded(chord) ?? groupUp);
  }
  for (const segment of measure.segments) {
    for (const chord of [...segment.graces, ...segment.chords]) {
      if (result.has(chord) || chord.model.notes.length === 0) continue;
      result.set(
        chord,
        encoded(chord) ??
          (chord.model.grace ? true : chord.sharedStaff ? isUpperVoice(chord.model.voice) : upForPositions(positions(chord))),
      );
    }
  }
  return result;
}

/** A chord placed on the page: its shape, origin and staff, in staff spaces. */
export interface PlacedChord {
  chord: PreparedChord;
  shape: ChordShape;
  x: number;
  staffTop: number;
}

export interface BeamDrawing {
  /** Filled quadrilaterals: x1, y1, x2, y2 along the edge nearest the stem end, then thickness. */
  segments: { x1: number; y1: number; x2: number; y2: number; thickness: number }[];
}

/**
 * Sets the stem ends of a beam group's chords and returns the beams to draw. The beam
 * follows the outer notes' direction with at most one staff space of slant, stays flat
 * when inner notes reach further than the outer ones, keeps every stem at least
 * 3.25 staff spaces plus the extra beams long, and reaches the middle line.
 */
export function layoutBeam(group: PlacedChord[]): BeamDrawing {
  const stemmed = group.filter((placed) => placed.shape.stem);
  if (stemmed.length < 2) return { segments: [] };
  const scale = stemmed[0].shape.scale;
  const levels = Math.max(1, ...stemmed.map((placed) => flagCount(noteType(placed.chord.model.type, placed.chord.model.duration))));
  const stemX = (placed: PlacedChord) => placed.x + placed.shape.stem!.x;
  const ups = stemmed.map((placed) => placed.shape.stem!.up);
  const mixed = ups.some((up) => up !== ups[0]);
  /** The notehead nearest the beam. */
  const beamSideY = (placed: PlacedChord) => {
    const ys = placed.shape.notes.map((note) => placed.staffTop + note.y);
    return placed.shape.stem!.up ? Math.min(...ys) : Math.max(...ys);
  };
  const minimumStem = (3.25 + (levels - 1) * BEAM_STEP) * scale;
  const first = stemmed[0];
  const last = stemmed[stemmed.length - 1];
  const x1 = stemX(first);
  const x2 = stemX(last);

  let slope = 0;
  let lineAtFirst: number;
  if (mixed) {
    // A kneed beam runs flat between the notes above it and the notes below it.
    const ends = stemmed.map((placed) => beamSideY(placed) + (placed.shape.stem!.up ? -2.5 : 2.5) * scale);
    lineAtFirst = ends.reduce((total, y) => total + y, 0) / ends.length;
  } else {
    const up = ups[0];
    const outer = [beamSideY(first), beamSideY(last)];
    const inner = stemmed.slice(1, -1).map(beamSideY);
    const innerReachesFurther = inner.some((y) => (up ? y < Math.min(...outer) : y > Math.max(...outer)));
    if (!innerReachesFurther && x2 > x1) {
      const rise = Math.max(-MAX_SLANT, Math.min(MAX_SLANT, (outer[1] - outer[0]) / 2));
      slope = rise / (x2 - x1);
    }
    const middle = stemmed[0].staffTop + MIDDLE_POSITION / 2;
    // Place the line as close to the notes as the shortest allowed stem permits.
    const offsets = stemmed.map((placed) => {
      const limit = beamSideY(placed) + (up ? -minimumStem : minimumStem);
      return limit - slope * (stemX(placed) - x1);
    });
    lineAtFirst = up ? Math.min(...offsets) : Math.max(...offsets);
    const middleOffsets = stemmed.map((placed) => placed.staffTop + MIDDLE_POSITION / 2 - slope * (stemX(placed) - x1));
    if (stemmed.every((placed) => placed.staffTop + MIDDLE_POSITION / 2 === middle)) {
      lineAtFirst = up ? Math.min(lineAtFirst, ...middleOffsets) : Math.max(lineAtFirst, ...middleOffsets);
    }
  }
  const lineY = (x: number) => lineAtFirst + slope * (x - x1);
  for (const placed of stemmed) {
    placed.shape.stem!.yEnd = lineY(stemX(placed)) - placed.staffTop;
  }

  // Beams sit on the stem-end side of the line and stack toward the notes.
  const towardNotes = (placed: PlacedChord) => (placed.shape.stem!.up ? 1 : -1);
  const segments: BeamDrawing["segments"] = [];
  const halfStem = (STEM_WIDTH * scale) / 2;
  for (let level = 1; level <= levels; level += 1) {
    const value = (placed: PlacedChord) => (level === 1 ? (placed.chord.model.beams[0] ?? "continue") : placed.chord.model.beams[level - 1] ?? null);
    let runStart: PlacedChord | null = null;
    stemmed.forEach((placed, index) => {
      const beam = value(placed);
      const offset = (level - 1) * BEAM_STEP * scale * towardNotes(placed);
      const add = (from: number, to: number) => {
        const direction = towardNotes(placed);
        segments.push({
          x1: from,
          y1: lineY(from) + offset,
          x2: to,
          y2: lineY(to) + offset,
          thickness: BEAM_THICKNESS * scale * direction,
        });
      };
      const x = stemX(placed);
      if (level === 1 && index === 0) runStart = placed;
      if (beam === "forward hook") add(x - halfStem, x + HOOK_LENGTH * scale);
      else if (beam === "backward hook") add(x - HOOK_LENGTH * scale, x + halfStem);
      else if (beam === "begin" && level > 1) runStart = placed;
      else if (beam === "continue" && level > 1 && !runStart) runStart = placed;
      const isRunEnd = level === 1 ? index === stemmed.length - 1 : beam === "end";
      if (isRunEnd && runStart) {
        add(stemX(runStart) - halfStem, x + halfStem);
        runStart = null;
      }
    });
  }
  return { segments };
}

