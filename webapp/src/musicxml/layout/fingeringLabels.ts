// Where the fingering labels of an engraved page go. Right-hand fingers stand above their
// part and left-hand fingers below it, each moment's labels just clear of its chords and of
// whatever else the page draws in their column, such as pedal marks and tempo text. A note
// moved to the other hand moves its label to that hand's side. A chord's notes share one
// stack, top note on top. Another voice's chord struck with it on the same side has its own,
// a wider gap away; so do notes moved to the hand from the other staff, a stack for each chord
// they came from, outlined even when alone, to mark them moved. A side's stacks stand in pitch
// order, the higher above, so that they read as the chord the hand plays. So a stack holds
// only its own chord's notes. A moment's labels, above and below, stand in one line down the
// page, where most of its noteheads are, not drawn aside by a head set off a second.
// Positions are page pixels.
import { glyphBox } from "../fonts/smufl";
import type { Bounds, Drawable, LayoutPage } from "../model/layout";

/** A label's diameter, in staff spaces. */
export const LABEL_SIZE = 1.7;
/** Between the music and the nearest label, in staff spaces. */
export const LABEL_GAP = 0.6;
/** Between two labels of a stack, in staff spaces. */
export const STACK_GAP = 0.15;
/**
 * Between the labels of two groups on one side of a moment, such as two voices' chords or a
 * chord and the notes moved to its hand, in staff spaces: room for both stacks' outlines and
 * a gap between them.
 */
export const MOVED_GAP = 0.8;

/**
 * The side of the staff a label's stack stands on at its moment: its stack ID without the
 * group, which is a chord's or the notes moved there. Stacks sharing it stand in one column.
 */
export function labelColumn(stackId: string): string {
  return stackId.slice(0, stackId.lastIndexOf("|"));
}
/**
 * Labels step past marks in their way by at most this, in staff spaces; further, they overlap.
 * A page laid out with room for them has that room wherever they need it.
 */
const MAXIMUM_SHIFT = 5;
const ROOMY_MAXIMUM_SHIFT = 40;

export interface FingeringLabelPlacement {
  /** The note's structural key. */
  key: string;
  /** The label's centre. */
  x: number;
  y: number;
  left: boolean;
  /** Labels of one stack share this ID. */
  stackId: string;
}

/**
 * Labels of one hand's notes struck together, when there is more than one; and those of notes
 * moved to the hand, even one alone, whose outline marks them moved.
 */
export interface FingeringLabelStack {
  id: string;
  x: number;
  top: number;
  bottom: number;
  left: boolean;
  /** Notes the player moved to this hand from the other. */
  moved: boolean;
}

export interface FingeringLabelLayout {
  /** The labels' diameter. */
  size: number;
  labels: FingeringLabelPlacement[];
  stacks: FingeringLabelStack[];
}

interface LabelledNote {
  key: string;
  x: number;
  y: number;
  /** Its pitch as a semitone number; null for an unpitched note. */
  semitone: number | null;
}

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A pitch such as "F#5" as a semitone number, so that pitches compare; null when unreadable. */
function semitoneOf(pitch: string | null): number | null {
  const match = pitch ? /^([A-G])(#*|b*)(-?\d+)$/.exec(pitch) : null;
  if (!match) return null;
  const alter = match[2].startsWith("#") ? match[2].length : -match[2].length;
  return (Number(match[3]) + 1) * 12 + STEP_SEMITONES[match[1]] + alter;
}

/** What a drawn item covers, roughly; null for what labels may cross, such as slurs. */
function itemBounds(item: Drawable, sp: number): Bounds | null {
  switch (item.kind) {
    case "glyph": {
      if (item.rotate !== undefined) return null;
      const box = glyphBox(item.glyph);
      const scaleY = item.scaleY ?? 1;
      return [
        item.x + box.left * item.scale * sp,
        item.y + box.top * item.scale * scaleY * sp,
        item.x + box.right * item.scale * sp,
        item.y + box.bottom * item.scale * scaleY * sp,
      ];
    }
    case "text": {
      const length = item.runs ? item.runs.reduce((total, run) => total + run.text.length, 0) : item.text.length;
      const width = length * item.size * 0.5;
      const left = item.anchor === "start" ? item.x : item.anchor === "end" ? item.x - width : item.x - width / 2;
      return [left, item.y - item.size * 0.75, left + width, item.y + item.size * 0.25];
    }
    case "line":
      return [
        Math.min(item.x1, item.x2) - item.width / 2,
        Math.min(item.y1, item.y2) - item.width / 2,
        Math.max(item.x1, item.x2) + item.width / 2,
        Math.max(item.y1, item.y2) + item.width / 2,
      ];
    case "polygon": {
      const xs = item.points.filter((_, index) => index % 2 === 0);
      const ys = item.points.filter((_, index) => index % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case "path":
      return null;
  }
}

/**
 * Labels for the page's notes that have a hand: `handOf` says whether a note, by its
 * structural key, is played by the left hand, or undefined for a note without a label.
 * `moved` says whether the player moved it there from the other hand.
 */
export function fingeringLabelLayout(
  page: LayoutPage,
  handOf: (key: string) => boolean | undefined,
  moved: (key: string) => boolean = () => false,
): FingeringLabelLayout {
  const sp = page.staffSpace;
  const size = LABEL_SIZE * sp;
  const step = size + STACK_GAP * sp;
  const gap = LABEL_GAP * sp;
  // The extent of the music struck at each moment of a part: its chords and the part's staves.
  const reach = new Map<string, { top: number; bottom: number }>();
  const groups = new Map<string, { left: boolean; moved: boolean; notes: LabelledNote[]; place: string; column: string }>();
  const obstacles: Bounds[] = [];
  for (const item of page.items) {
    const bounds = itemBounds(item, sp);
    if (bounds) obstacles.push(bounds);
  }
  for (const chord of page.chords) {
    const place = `${chord.systemIndex}|${chord.momentId}|${chord.part}`;
    const staves = page.systems[chord.systemIndex]?.parts[chord.part];
    const extent = chord.stemBounds ?? [
      Math.min(...chord.notes.map((note) => note.headBounds[0])),
      Math.min(...chord.notes.map((note) => note.headBounds[1])),
      Math.max(...chord.notes.map((note) => note.headBounds[2])),
      Math.max(...chord.notes.map((note) => note.headBounds[3])),
    ];
    obstacles.push(extent);
    for (const note of chord.notes) {
      if (note.printedFingering) obstacles.push(note.printedFingering);
    }
    const current = reach.get(place) ?? {
      top: staves?.top ?? extent[1],
      bottom: staves?.bottom ?? extent[3],
    };
    reach.set(place, {
      top: Math.min(current.top, extent[1]),
      bottom: Math.max(current.bottom, extent[3]),
    });
    for (const note of chord.notes) {
      const left = handOf(note.key);
      if (left === undefined) continue;
      const crossed = moved(note.key);
      const column = `${place}|${left ? "L" : "R"}`;
      // A chord's notes moved to the other hand stand together, apart from another voice's.
      const id = `${column}|${crossed ? "moved-" : ""}${chord.id}`;
      const group = groups.get(id) ?? { left, moved: crossed, notes: [], place, column };
      group.notes.push({ key: note.key, x: note.center[0], y: note.center[1], semitone: semitoneOf(note.pitch) });
      groups.set(id, group);
    }
  }

  /**
   * How far from `start` a stack of `height` must stand, going down (or up, for the right
   * hand), to clear every obstacle in its column; `start` itself when it cannot within reach,
   * or without crossing `limit`, the edge of the next system (or the one before): a label
   * that cannot fit in its own system overlaps there rather than land in another.
   */
  function clearOf(x: number, start: number, height: number, down: boolean, limit: number, more: readonly Bounds[] = []): number {
    const left = x - size / 2 - gap / 2;
    const right = x + size / 2 + gap / 2;
    let edge = start;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const top = down ? edge : edge - height;
      const bottom = down ? edge + height : edge;
      let moved = false;
      for (const [x1, y1, x2, y2] of more.length ? [...obstacles, ...more] : obstacles) {
        if (x2 < left || x1 > right || y2 < top || y1 > bottom) continue;
        // Only what lies beyond the music's own edge stands in the way.
        if (down ? y2 <= start : y1 >= start) continue;
        edge = down ? Math.max(edge, y2 + gap) : Math.min(edge, y1 - gap);
        moved = true;
      }
      if (down ? edge + height > limit : edge - height < limit) return start;
      if (!moved) return edge;
      if (Math.abs(edge - start) > (page.fingeringRoom ? ROOMY_MAXIMUM_SHIFT : MAXIMUM_SHIFT) * sp) return start;
    }
    return start;
  }

  const labels: FingeringLabelPlacement[] = [];
  const stacks: FingeringLabelStack[] = [];
  // Right-hand labels go first; left-hand ones then keep clear of those of the system below.
  // A column, one side of the music at a moment, stands clear of what is in its way as one
  // block, so that its groups stay together: from the staff outward in pitch, the lowest first
  // above the music and the highest below it, notes moved to the hand among the hand's own, so
  // that the column reads top to bottom as the hand's chord. By height on the page where a
  // pitch is unknown; of two at one pitch, the moved notes go further out.
  const rightLabels: Bounds[] = [];
  const outward = (group: { left: boolean; notes: LabelledNote[] }, byPitch: boolean) => {
    const values = group.notes.map((note) => (byPitch ? -note.semitone! : note.y));
    return group.left ? Math.min(...values) : -Math.max(...values);
  };
  const pitched = (group: { notes: LabelledNote[] }) => group.notes.every((note) => note.semitone !== null);
  const ordered = [...groups].sort(([, a], [, b]) => {
    const byPitch = pitched(a) && pitched(b);
    return Number(a.left) - Number(b.left) || outward(a, byPitch) - outward(b, byPitch) || Number(a.moved) - Number(b.moved);
  });
  const columns = new Map<string, [string, (typeof ordered)[number][1]][]>();
  for (const entry of ordered) columns.set(entry[1].column, [...(columns.get(entry[1].column) ?? []), entry]);
  const apart = MOVED_GAP * sp;
  // Each moment's line: the median of its labelled noteheads, both hands', so that a head set
  // to the other side of its stem, as in a second, leaves it where the rest are.
  const momentXs = new Map<string, number[]>();
  for (const group of groups.values()) {
    momentXs.set(group.place, [...(momentXs.get(group.place) ?? []), ...group.notes.map((note) => note.x)]);
  }
  const momentX = new Map<string, number>();
  for (const [place, xs] of momentXs) {
    const sorted = [...xs].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    momentX.set(place, sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
  }
  for (const members of columns.values()) {
    const { left, place } = members[0][1];
    const music = reach.get(place)!;
    const system = Number(place.split("|")[0]);
    const columnX = momentX.get(place)!;
    const heights = members.map(([, group]) => size + (group.notes.length - 1) * step);
    // Two single notes of the hand's own voices stand as close as a stack's labels, without its
    // outline; a chord's outline, or notes moved from the other hand, take the wider gap.
    const gaps = members.slice(1).map(([, group], index) => {
      const before = members[index][1];
      const loose = (candidate: typeof group) => candidate.notes.length === 1 && !candidate.moved;
      return loose(group) && loose(before) ? step - size : apart;
    });
    const total = heights.reduce((sum, height) => sum + height, 0) + gaps.reduce((sum, gap) => sum + gap, 0);
    // The edge of the column nearest the music, from which its groups go outward.
    let edge = left
      ? clearOf(columnX, music.bottom + gap, total, true, page.systems[system + 1]?.top ?? Infinity, rightLabels)
      : clearOf(columnX, music.top - gap, total, false, page.systems[system - 1]?.bottom ?? -Infinity);
    if (!left) rightLabels.push([columnX - size / 2, edge - total, columnX + size / 2, edge]);
    members.forEach(([id, group], index) => {
      // Top note first.
      const notes = [...group.notes].sort((a, b) => a.y - b.y);
      const x = columnX;
      const height = heights[index];
      const top = left ? edge : edge - height;
      const after = gaps[index] ?? 0;
      edge = left ? edge + height + after : edge - height - after;
      const first = top + size / 2;
      notes.forEach((note, position) => {
        labels.push({ key: note.key, x, y: first + position * step, left, stackId: id });
      });
      if (notes.length > 1 || group.moved) stacks.push({ id, x, top, bottom: top + height, left, moved: group.moved });
    });
  }
  return { size, labels, stacks };
}

/**
 * Whether the page's labels, placed for the given hands, need more room than its layout gives
 * them: a stack below a system reaching the next system or the labels above it, a stack above
 * reaching the system before or the labels below that, or two stacks side by side on one side
 * of a system overlapping. Moving a note to the other hand can do any of these; otherwise its
 * label fits where the layout made room, and the score need not be laid out again.
 */
export function labelsNeedRoom(
  page: LayoutPage,
  handOf: (key: string) => boolean | undefined,
  moved?: (key: string) => boolean,
): boolean {
  const layout = fingeringLabelLayout(page, handOf, moved);
  const half = layout.size / 2;
  const gap = STACK_GAP * page.staffSpace;
  const systemOf = (label: FingeringLabelPlacement) => Number(label.stackId.slice(0, label.stackId.indexOf("|")));
  const bySystem = new Map<number, FingeringLabelPlacement[]>();
  for (const label of layout.labels) {
    const system = systemOf(label);
    bySystem.set(system, [...(bySystem.get(system) ?? []), label]);
  }
  for (let index = 0; index < page.systems.length; index += 1) {
    const labels = bySystem.get(index) ?? [];
    const next = page.systems[index + 1];
    if (next) {
      const lowest = Math.max(-Infinity, ...labels.filter((label) => label.left).map((label) => label.y + half));
      const nextLabels = bySystem.get(index + 1) ?? [];
      const ceiling = Math.min(next.top, ...nextLabels.filter((label) => !label.left).map((label) => label.y - half));
      if (lowest > ceiling - gap) return true;
    }
    // Stacks of one side, left to right: neighbours closer than a label overlap where their
    // heights meet.
    for (const left of [true, false]) {
      const stacks = new Map<string, { x: number; top: number; bottom: number }>();
      for (const label of labels.filter((candidate) => candidate.left === left)) {
        const stack = stacks.get(label.stackId) ?? { x: label.x, top: Infinity, bottom: -Infinity };
        stack.top = Math.min(stack.top, label.y - half);
        stack.bottom = Math.max(stack.bottom, label.y + half);
        stacks.set(label.stackId, stack);
      }
      const row = [...stacks.values()].sort((a, b) => a.x - b.x);
      for (let position = 1; position < row.length; position += 1) {
        const [a, b] = [row[position - 1], row[position]];
        if (b.x - a.x < layout.size - 0.5 && a.top < b.bottom && b.top < a.bottom) return true;
      }
    }
  }
  return false;
}
