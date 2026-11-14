// The MusicXML viewer's public API. Code outside this folder imports only this file.
import type { PageNoteGeometry } from "../noteGeometry";
import type { DocumentPage, LoadedDocument } from "../types";
import { musicXmlLoadedDocument } from "./document/loadedDocument";
import { pageNoteGeometry, viewerIds } from "./geometry/pageNoteGeometry";
import { documentMusicXml } from "./import/documentMusicXml";
import { importMusicXml } from "./import/parseMusicXml";
import type { ScoreModel } from "./model/score";
import { pageFormat } from "./layout/pageFormat";
import { layoutScore, type LayoutOptions } from "./layout/pages";
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
  labelsNeedRoom,
  type FingeringLabelLayout,
  type FingeringLabelPlacement,
  type FingeringLabelStack,
} from "./layout/fingeringLabels";
export {
  constraintSignature,
  noteKeyOf,
  viewerIdsByKey,
  resolveFingering,
  resolveFingerings,
  withOverride,
  type EffectiveFingering,
  type FingeringSource,
} from "./scoreData/fingerings";
export type { FingeringOverride, FingeringOverrides } from "./scoreData/overrides";
export { MusicXmlImportError } from "./import/parseMusicXml";
export { MusicXmlNoteMarks, MusicXmlPageSurface, type HighlightKind } from "./render/MusicXmlPageSurface";
export { preparePageImages, usePageImage } from "./render/MusicXmlPageImage";
export { showScoreDataFolder, showScoreSource } from "./scoreData/scoreData";

const MUSIC_XML_EXTENSION = /\.(musicxml|xml|mxl)$/i;

/** Whether a chosen file opens as MusicXML rather than through PDF recognition. */
export function isMusicXmlPath(path: string): boolean {
  return MUSIC_XML_EXTENSION.test(path);
}

function laidOut(jobId: string, file: MusicXmlScoreFile, options: LayoutOptions): { document: LoadedDocument; score: ScoreModel } {
  const imported = importMusicXml(file.musicXml);
  // Writing the document MusicXML takes the imported XML apart; the score model is kept whole.
  const score = imported.score;
  const layout = layoutScore(score, pageFormat(score.defaults), options);
  const pageStarts = new Map(layout.pages.slice(1).map((page) => [page.firstMeasure, page.index + 1]));
  return { document: musicXmlLoadedDocument(jobId, file, layout, documentMusicXml(imported, viewerIds(layout), pageStarts)), score };
}

/**
 * The open score laid out again from its score model, with the usual document MusicXML's note
 * IDs moved to the pages they are on now. Its page breaks stay the usual layout's, which only
 * realtime's page steps read; it serves while editing fingers, where playback is off.
 */
function laidOutAgain(base: LoadedDocument, score: ScoreModel, file: MusicXmlScoreFile, options: LayoutOptions): LoadedDocument {
  const layout = layoutScore(score, pageFormat(score.defaults), options);
  const ids = viewerIds(layout);
  const musicXml = (base.documentMusicXml ?? "").replace(/(<note\b[^>]*\bid=")page-\d+-([^"]+)"/g, (match, start: string, key: string) => {
    const id = ids.get(key);
    return id ? `${start}${id}"` : match;
  });
  return musicXmlLoadedDocument(base.jobId, file, layout, musicXml);
}

// The open score's file and its layouts: the usual one, and the last one with room for
// fingering labels, for the hands the notes were then played by. Switching between them lays
// the score out again only when hands have changed.
let opened: {
  jobId: string;
  file: MusicXmlScoreFile;
  score: ScoreModel;
  plain: LoadedDocument;
  roomy: { hands: string; layout: LoadedDocument } | null;
} | null = null;

/** Imports and lays out a score file that has been read. */
export function musicXmlScoreDocument(jobId: string, file: MusicXmlScoreFile): LoadedDocument {
  const { document, score } = laidOut(jobId, file, {});
  opened = { jobId, file, score, plain: document, roomy: null };
  return document;
}

/**
 * The open score laid out again, with room for a fingering label by every note or without:
 * its pages and document MusicXML change, and everything else about the document is kept.
 * With room, `movedHands` gives the notes moved to the other hand, by structural key (true for
 * the left), whose labels need room on that side. Notes keep their structural keys, but may
 * move to other pages, so viewer IDs change. Null for a document that is not the open
 * MusicXML score.
 */
export function relayoutMusicXmlScore(
  document: LoadedDocument,
  fingeringRoom: boolean,
  movedHands: Readonly<Record<string, boolean>> = {},
): LoadedDocument | null {
  if (document.source.kind !== "musicxml" || opened?.jobId !== document.jobId) return null;
  let layout = opened.plain;
  if (fingeringRoom) {
    const hands = JSON.stringify(Object.entries(movedHands).sort(([a], [b]) => a.localeCompare(b)));
    if (opened.roomy?.hands !== hands) {
      opened.roomy = {
        hands,
        layout: laidOutAgain(opened.plain, opened.score, opened.file, { fingeringRoom, movedHand: (key) => movedHands[key] }),
      };
    }
    layout = opened.roomy.layout;
  }
  return { ...document, pageCount: layout.pageCount, pages: layout.pages, documentMusicXml: layout.documentMusicXml };
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
