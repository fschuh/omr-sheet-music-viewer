// The MusicXML viewer's public API. Code outside this folder imports only this file.
import type { PageNoteGeometry } from "../noteGeometry";
import type { DocumentPage, LoadedDocument } from "../types";
import { musicXmlLoadedDocument } from "./document/loadedDocument";
import { pageNoteGeometry, viewerIds } from "./geometry/pageNoteGeometry";
import { documentMusicXml } from "./import/documentMusicXml";
import { importMusicXml } from "./import/parseMusicXml";
import { pageFormat } from "./layout/pageFormat";
import { layoutScore } from "./layout/pages";
import { readScoreFile, type MusicXmlScoreFile } from "./scoreData/scoreData";

export type { LayoutPage as MusicXmlPage } from "./model/layout";
export { MusicXmlImportError } from "./import/parseMusicXml";
export { MusicXmlPageSurface, type HighlightKind } from "./render/MusicXmlPageSurface";
export { showScoreDataFolder, showScoreSource } from "./scoreData/scoreData";

const MUSIC_XML_EXTENSION = /\.(musicxml|xml|mxl)$/i;

/** Whether a chosen file opens as MusicXML rather than through PDF recognition. */
export function isMusicXmlPath(path: string): boolean {
  return MUSIC_XML_EXTENSION.test(path);
}

/** Imports and lays out a score file that has been read. */
export function musicXmlScoreDocument(jobId: string, file: MusicXmlScoreFile): LoadedDocument {
  const imported = importMusicXml(file.musicXml);
  const layout = layoutScore(imported.score, pageFormat(imported.score.defaults));
  const pageStarts = new Map(layout.pages.slice(1).map((page) => [page.firstMeasure, page.index + 1]));
  return musicXmlLoadedDocument(jobId, file, layout, documentMusicXml(imported, viewerIds(layout), pageStarts));
}

/** Reads, imports and lays out a MusicXML score file. */
export async function openMusicXmlScore(path: string, jobId: string): Promise<LoadedDocument> {
  return musicXmlScoreDocument(jobId, await readScoreFile(path));
}

/** Note geometry of every engraved page, in page order. */
export function musicXmlNoteGeometry(pages: readonly DocumentPage[]): PageNoteGeometry[] {
  return pages.flatMap((page) => (page.surface ? [pageNoteGeometry(page.surface)] : []));
}
