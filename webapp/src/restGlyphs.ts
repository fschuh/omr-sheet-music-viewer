import type { SidecarRest } from "./types";

export type RestGlyphKind =
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "thirty-second";

export interface RestGlyph {
  kind: RestGlyphKind;
  /** Open strokes: the zigzag of a quarter rest, the stems of shorter rests. */
  strokes: string;
  /** Filled shapes: whole and half rest blocks, the dots of shorter rests. */
  fills: string;
}

/** Map a transformer token such as "rest_8.", "rest_12" or "note_16" to the rest it reads as. */
export function restGlyphKind(duration: string): RestGlyphKind {
  const value = Number(/_(\d+)/.exec(duration)?.[1] ?? "4");
  if (value <= 1) return "whole";
  // Tuplet values (6, 12, 24, ...) are drawn as the plain value they subdivide.
  const plain = 2 ** Math.floor(Math.log2(value));
  if (plain <= 2) return "half";
  if (plain === 4) return "quarter";
  if (plain === 8) return "eighth";
  if (plain === 16) return "sixteenth";
  return "thirty-second";
}

function dot(x: number, y: number, radius: number): string {
  return `M ${x - radius} ${y} a ${radius} ${radius} 0 1 0 ${2 * radius} 0 a ${radius} ${radius} 0 1 0 ${-2 * radius} 0 Z`;
}

function polyline(points: [number, number][]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

/**
 * A ghost of the rest the transformer read, drawn where it placed it: centred on the rest's
 * x, on the staff's middle line, scaled to one staff space. Returns null for a record that
 * lacks the geometry to place it.
 */
export function restGlyph(
  rest: Pick<SidecarRest, "duration" | "center" | "staff_lines" | "unit_size">,
): RestGlyph | null {
  if (rest.center === null || rest.unit_size === null || rest.staff_lines.length !== 5) {
    return null;
  }
  const u = rest.unit_size;
  const x = rest.center[0];
  const lines = rest.staff_lines;
  const middle = lines[2];
  const at = (dx: number, dy: number): [number, number] => [x + dx * u, middle + dy * u];
  const kind = restGlyphKind(rest.duration);
  const block = (top: number) =>
    `M ${x - 0.6 * u} ${top} H ${x + 0.6 * u} V ${top + 0.5 * u} H ${x - 0.6 * u} Z`;

  switch (kind) {
    case "whole":
      // Hangs from the second line.
      return { kind, strokes: "", fills: block(lines[1]) };
    case "half":
      // Sits on the middle line.
      return { kind, strokes: "", fills: block(middle - 0.5 * u) };
    case "quarter":
      return {
        kind,
        strokes: polyline([at(-0.15, -1.5), at(0.35, -0.85), at(-0.25, -0.1), at(0.3, 0.55), at(-0.25, 0.45), at(0.15, 1.35)]),
        fills: "",
      };
    default: {
      // A slanted stem with one dot per flag, the dots stepping down the stem.
      const flags = kind === "eighth" ? 1 : kind === "sixteenth" ? 2 : 3;
      const top = at(0.4, -0.6);
      const bottom = at(-0.15, -0.6 + 1.2 * flags + 0.5);
      const dots = Array.from({ length: flags }, (_, flag) => {
        const [dx, dy] = at(-0.25 - 0.12 * flag, -0.55 + 1.0 * flag);
        return dot(dx, dy, 0.22 * u);
      });
      return { kind, strokes: polyline([top, bottom]), fills: dots.join(" ") };
    }
  }
}
