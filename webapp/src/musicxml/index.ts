// The MusicXML viewer's public API. Code outside this folder imports only this file.
import type { LoadedDocument } from "../types";
import { musicXmlLoadedDocument } from "./document/loadedDocument";
import { parseMusicXml } from "./import/parseMusicXml";
import { pageFormat } from "./layout/pageFormat";
import { layoutPages } from "./layout/pages";
import { readScoreFile, type MusicXmlScoreFile } from "./scoreData/scoreData";

export type { LayoutPage as MusicXmlPage } from "./model/layout";
export { MusicXmlImportError } from "./import/parseMusicXml";
export { MusicXmlPageSurface } from "./render/MusicXmlPageSurface";
export { showScoreDataFolder, showScoreSource } from "./scoreData/scoreData";

const MUSIC_XML_EXTENSION = /\.(musicxml|xml|mxl)$/i;

/** Whether a chosen file opens as MusicXML rather than through PDF recognition. */
export function isMusicXmlPath(path: string): boolean {
  return MUSIC_XML_EXTENSION.test(path);
}

/** Imports and lays out a score file that has been read. */
export function musicXmlScoreDocument(jobId: string, file: MusicXmlScoreFile): LoadedDocument {
  const score = parseMusicXml(file.musicXml);
  return musicXmlLoadedDocument(jobId, file, layoutPages(score, pageFormat(score.defaults)));
}

/** Reads, imports and lays out a MusicXML score file. */
export async function openMusicXmlScore(path: string, jobId: string): Promise<LoadedDocument> {
  return musicXmlScoreDocument(jobId, await readScoreFile(path));
}
