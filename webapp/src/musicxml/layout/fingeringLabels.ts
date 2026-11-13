// Where the fingering labels of an engraved page go. Right-hand fingers stand above their
// part and left-hand fingers below it, each moment's labels just clear of its chords and of
// whatever else the page draws in their column, such as pedal marks and tempo text. A note
// moved to the other hand moves its label to that hand's side. A hand's notes struck
// together share one stack, top note on top. Positions are page pixels.
import { glyphBox } from "../fonts/smufl";
import type { Bounds, Drawable, LayoutPage } from "../model/layout";

/** A label's diameter, in staff spaces. */
const LABEL_SIZE = 1.7;
/** Between the music and the nearest label, in staff spaces. */
const LABEL_GAP = 0.6;
/** Between two labels of a stack, in staff spaces. */
const STACK_GAP = 0.15;
/** Labels step past marks in their way by at most this, in staff spaces; further, they overlap. */
const MAXIMUM_SHIFT = 5;

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

/** Labels of one hand's notes struck together, when there is more than one. */
export interface FingeringLabelStack {
  id: string;
  x: number;
  top: number;
  bottom: number;
  left: boolean;
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
 */
export function fingeringLabelLayout(
  page: LayoutPage,
  handOf: (key: string) => boolean | undefined,
): FingeringLabelLayout {
  const sp = page.staffSpace;
  const size = LABEL_SIZE * sp;
  const step = size + STACK_GAP * sp;
  const gap = LABEL_GAP * sp;
  // The extent of the music struck at each moment of a part: its chords and the part's staves.
  const reach = new Map<string, { top: number; bottom: number }>();
  const groups = new Map<string, { left: boolean; notes: LabelledNote[]; place: string }>();
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
      const id = `${place}|${left ? "L" : "R"}`;
      const group = groups.get(id) ?? { left, notes: [], place };
      group.notes.push({ key: note.key, x: note.center[0], y: note.center[1] });
      groups.set(id, group);
    }
  }

  /**
   * How far from `start` a stack of `height` must stand, going down (or up, for the right
   * hand), to clear every obstacle in its column; `start` itself when it cannot within reach.
   */
  function clearOf(x: number, start: number, height: number, down: boolean, more: readonly Bounds[] = []): number {
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
      if (!moved) return edge;
      if (Math.abs(edge - start) > MAXIMUM_SHIFT * sp) return start;
    }
    return start;
  }

  const labels: FingeringLabelPlacement[] = [];
  const stacks: FingeringLabelStack[] = [];
  // Right-hand labels go first; left-hand ones then keep clear of those of the system below.
  const rightLabels: Bounds[] = [];
  const ordered = [...groups].sort(([, a], [, b]) => Number(a.left) - Number(b.left));
  for (const [id, group] of ordered) {
    const extent = reach.get(group.place)!;
    // Top note first; on the right hand's side the stack grows upward from the music.
    const notes = [...group.notes].sort((a, b) => a.y - b.y);
    const x = notes.reduce((total, note) => total + note.x, 0) / notes.length;
    const count = notes.length;
    const height = size + (count - 1) * step;
    const first = group.left
      ? clearOf(x, extent.bottom + gap, height, true, rightLabels) + size / 2
      : clearOf(x, extent.top - gap, height, false) - height + size / 2;
    if (!group.left) rightLabels.push([x - size / 2, first - size / 2, x + size / 2, first - size / 2 + height]);
    notes.forEach((note, index) => {
      labels.push({ key: note.key, x, y: first + index * step, left: group.left, stackId: id });
    });
    if (count > 1) {
      stacks.push({ id, x, top: first - size / 2, bottom: first + (count - 1) * step + size / 2, left: group.left });
    }
  }
  return { size, labels, stacks };
}
