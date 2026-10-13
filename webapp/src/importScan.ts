// Reads the imports of a source file, for the tests that enforce module boundaries.

export interface ImportRecord {
  specifier: string;
  /** The names brought in, including both sides of `as`; empty for side-effect imports. */
  names: string[];
}

function names(clause: string): string[] {
  return clause
    .replace(/[{}*]/g, " ")
    .split(/[\s,]+/)
    .filter((name) => name && name !== "type" && name !== "as");
}

/** Every static import, re-export, side-effect import and dynamic import in `source`. */
export function imports(source: string): ImportRecord[] {
  const patterns: [RegExp, (match: RegExpMatchArray) => ImportRecord][] = [
    [
      /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
      ([, clause, specifier]) => ({ specifier, names: names(clause) }),
    ],
    [
      /\bexport\s+(?:type\s+)?(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
      ([, clause, specifier]) => ({ specifier, names: names(clause) }),
    ],
    [/\bimport\s*\(?\s*["']([^"']+)["']/g, ([, specifier]) => ({ specifier, names: [] })],
  ];
  return patterns.flatMap(([pattern, record]) => [...source.matchAll(pattern)].map(record));
}

/** The visual sidecar's types and helpers in `types.ts`, which only PDF code may use. */
export const SIDECAR_NAMES = [
  "VisualSidecar",
  "VisualSidecarNote",
  "VisualGroup",
  "NoteheadEllipse",
  "RawStemContour",
  "isLinkedVisualGroup",
  "isSelectableVisualGroup",
];
