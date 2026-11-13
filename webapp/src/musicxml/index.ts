// The MusicXML viewer's public API. Code outside this folder imports only this file.
import type { PageNoteGeometry } from "../noteGeometry";
import type { DocumentPage, LoadedDocument } from "../types";
import { musicXmlLoadedDocument } from "./document/loadedDocument";
import { pageNoteGeometry, viewerIds } from "./geometry/pageNoteGeometry";
import { documentMusicXml } from "./import/documentMusicXml";
import { importMusicXml } from "./import/parseMusicXml";
import { pageFormat } from "./layout/pageFormat";
import { layoutScore } from "./layout/pages";
import type { FingeringPredictor } from "../fingering";
import {
  loadScoreFingerings,
  refitScoreFingerings,
  saveScoreOverrides,
  type ScoreFingerings,
} from "./scoreData/fingerings";
import type { FingeringOverrides } from "./scoreData/overrides";
import { readScoreFile, scoreDataStore, type MusicXmlScoreFile } from "./scoreData/scoreData";

export type { LayoutPage as MusicXmlPage } from "./model/layout";
export {
  fingeringLabelLayout,
  type FingeringLabelLayout,
  type FingeringLabelPlacement,
  type FingeringLabelStack,
} from "./layout/fingeringLabels";
export {
  constraintSignature,
  noteKeyOf,
  resolveFingering,
  resolveFingerings,
  withOverride,
  type EffectiveFingering,
  type FingeringSource,
} from "./scoreData/fingerings";
export type { FingeringOverride, FingeringOverrides } from "./scoreData/overrides";
export { MusicXmlImportError } from "./import/parseMusicXml";
export { MusicXmlNoteMarks, MusicXmlPageSurface, type HighlightKind } from "./render/MusicXmlPageSurface";
export { usePageImage } from "./render/MusicXmlPageImage";
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

export type { ScoreFingerings };

/**
 * A MusicXML score's fingerings: stored predictions when current, else new ones stored in
 * its data folder; fingerings the score prints win.
 */
export function musicXmlFingerings(
  document: LoadedDocument,
  predict: FingeringPredictor,
  onPredicting?: () => void,
): Promise<ScoreFingerings> {
  if (document.source.kind !== "musicxml" || !document.source.scoreDataPath || !document.documentMusicXml) {
    return Promise.reject(new Error("Fingerings need an opened MusicXML score"));
  }
  return loadScoreFingerings(document.documentMusicXml, scoreDataStore(document.source.scoreDataPath), predict, onPredicting);
}

function scoreStore(document: LoadedDocument) {
  if (document.source.kind !== "musicxml" || !document.source.scoreDataPath || !document.documentMusicXml) {
    throw new Error("Fingerings need an opened MusicXML score");
  }
  return { store: scoreDataStore(document.source.scoreDataPath), musicXml: document.documentMusicXml };
}

/** Saves the player's fingerings in the score's data folder. */
export async function saveMusicXmlFingeringOverrides(
  document: LoadedDocument,
  overrides: FingeringOverrides,
): Promise<void> {
  await saveScoreOverrides(scoreStore(document).store, overrides);
}

/**
 * Predicts the score's fingerings again around its printed fingers and the player's
 * overrides, and stores them.
 */
export async function refitMusicXmlFingerings(
  document: LoadedDocument,
  predict: FingeringPredictor,
  current: Pick<ScoreFingerings, "predicted" | "printed">,
  overrides: FingeringOverrides,
): Promise<Pick<ScoreFingerings, "predicted" | "fittedConstraints">> {
  const { store, musicXml } = scoreStore(document);
  return refitScoreFingerings(musicXml, store, predict, current, overrides);
}

/** Note geometry of every engraved page, in page order. */
export function musicXmlNoteGeometry(pages: readonly DocumentPage[]): PageNoteGeometry[] {
  return pages.flatMap((page) => (page.surface ? [pageNoteGeometry(page.surface)] : []));
}
