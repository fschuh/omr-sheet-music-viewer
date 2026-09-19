import type { DocumentPage } from "./types";

/** Matches worker/musicxml_merge.py: only recognized music pages consume an ordinal. */
export function musicPageNumbers(pages: readonly DocumentPage[]): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  let ordinal = 0;
  for (const page of [...pages].sort((a, b) => a.index - b.index)) {
    if (page.musicXml || page.visualSidecar || page.artifacts?.musicXmlPath) result.set(page.index, ++ordinal);
  }
  return result;
}

export function documentNoteId(musicPageNumber: number, localId: string): string {
  if (!Number.isInteger(musicPageNumber) || musicPageNumber < 1 || !localId) throw new Error("Invalid page-scoped note identity");
  return `page-${musicPageNumber}-${localId}`;
}
