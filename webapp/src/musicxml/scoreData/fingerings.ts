// Fingerings for a MusicXML score (section 4.3 of the plan). Predictions live in the score's
// data folder as fingerings.json, keyed by structural note keys so they outlast layout
// changes; they are reused while the model and the key scheme match, and predicted again
// otherwise. Fingerings the score prints always win. The score file is never written.
import {
  FINGERING_MODEL,
  predictFingerings,
  printedFingerings,
  type FingeringPredictor,
  type PredictedFingering,
} from "../../fingering";
import type { ScoreDataStore } from "./scoreData";

export const FINGERINGS_FILE = "fingerings.json";
const SCHEMA_VERSION = 1;
/** The structural note key scheme of section 3.5. */
export const NOTE_KEY_SCHEME = 1;

export interface FingeringsFile {
  schemaVersion: number;
  model: string;
  noteKeyScheme: number;
  predicted: Record<string, PredictedFingering>;
  overrides: Record<string, PredictedFingering>;
}

function isFingering(value: unknown): value is PredictedFingering {
  const candidate = value as PredictedFingering;
  return (
    typeof candidate === "object" && candidate !== null &&
    Number.isInteger(candidate.finger) && candidate.finger >= 1 && candidate.finger <= 5 &&
    typeof candidate.left === "boolean"
  );
}

/** The stored predictions by note key, or null when they are missing, malformed or stale. */
export function storedPredictions(text: string | null): Record<string, PredictedFingering> | null {
  if (text === null) return null;
  let file: Partial<FingeringsFile>;
  try {
    file = JSON.parse(text) as Partial<FingeringsFile>;
  } catch {
    return null;
  }
  if (
    file.schemaVersion !== SCHEMA_VERSION ||
    file.model !== FINGERING_MODEL ||
    file.noteKeyScheme !== NOTE_KEY_SCHEME ||
    typeof file.predicted !== "object" || file.predicted === null ||
    !Object.values(file.predicted).every(isFingering)
  ) {
    return null;
  }
  return file.predicted;
}

export function fingeringsFile(predicted: Record<string, PredictedFingering>): string {
  const file: FingeringsFile = {
    schemaVersion: SCHEMA_VERSION,
    model: FINGERING_MODEL,
    noteKeyScheme: NOTE_KEY_SCHEME,
    predicted,
    overrides: {},
  };
  return JSON.stringify(file);
}

const VIEWER_PREFIX = /^page-\d+-/;

/** Viewer IDs carry the page; stored data does not. */
export function noteKeyOf(viewerId: string): string {
  return viewerId.replace(VIEWER_PREFIX, "");
}

export interface ScoreFingerings {
  /** By viewer ID: printed fingers, and predictions for the other notes. */
  fingeringsByMusicXmlId: Record<string, PredictedFingering>;
  /** How many notes have a fingering. */
  noteCount: number;
  /** Whether the predictions came from the data folder. */
  fromStore: boolean;
}

/**
 * Loads a score's fingerings: stored predictions when they are current, else new ones,
 * which are stored for next time. A failed write keeps the predictions for this session.
 */
export async function loadScoreFingerings(
  documentMusicXml: string,
  store: ScoreDataStore,
  predict: FingeringPredictor,
  onPredicting: () => void = () => {},
): Promise<ScoreFingerings> {
  const printed = printedFingerings(documentMusicXml);
  const viewerIdByKey = new Map<string, string>();
  for (const match of documentMusicXml.matchAll(/<note\b[^>]*\bid="([^"]+)"/g)) {
    viewerIdByKey.set(noteKeyOf(match[1]), match[1]);
  }

  let predictedByKey = storedPredictions(await store.read(FINGERINGS_FILE));
  const fromStore = predictedByKey !== null;
  if (!predictedByKey) {
    onPredicting();
    const { fingeringsByMusicXmlId } = await predictFingerings(documentMusicXml, predict);
    predictedByKey = Object.fromEntries(
      Object.entries(fingeringsByMusicXmlId).map(([id, fingering]) => [noteKeyOf(id), fingering]),
    );
    try {
      await store.write(FINGERINGS_FILE, fingeringsFile(predictedByKey));
    } catch (error) {
      console.warn("The predicted fingerings could not be stored", error);
    }
  }

  const fingeringsByMusicXmlId: Record<string, PredictedFingering> = {};
  for (const [key, fingering] of Object.entries(predictedByKey)) {
    const id = viewerIdByKey.get(key);
    if (id) fingeringsByMusicXmlId[id] = fingering;
  }
  // A printed finger is the score's own instruction and replaces the prediction.
  Object.assign(fingeringsByMusicXmlId, printed);
  return {
    fingeringsByMusicXmlId,
    noteCount: Object.keys(fingeringsByMusicXmlId).length,
    fromStore,
  };
}
