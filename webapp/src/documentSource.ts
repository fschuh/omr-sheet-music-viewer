// What the app shows for each kind of document source.
import type { LoadedDocument } from "./types";

/**
 * Diagnostics, worker logs and the debug overlays describe homr's recognition of a PDF,
 * so they are offered only for PDFs.
 */
export function diagnosticsAvailable(document: LoadedDocument | null): boolean {
  return document?.source.kind !== "musicxml";
}

export interface DocumentFolder {
  kind: "pdf-cache" | "score-data";
  /** Undefined until the folder is known. */
  path: string | undefined;
  label: string;
  title: string;
}

/** The folder that holds what the app stores for a document. */
export function documentFolder(document: LoadedDocument): DocumentFolder {
  const { source } = document;
  if (source.kind === "musicxml") {
    return {
      kind: "score-data",
      path: source.scoreDataPath,
      label: "Open score data folder",
      title: source.scoreDataPath ?? "The score data folder is available after the score is opened",
    };
  }
  return {
    kind: "pdf-cache",
    path: source.cachePath,
    label: "Open cache folder",
    title: source.cachePath ?? "The cache folder is available after the PDF is opened",
  };
}
