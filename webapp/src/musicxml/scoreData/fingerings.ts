// Fingerings for a MusicXML score (section 4.3 of the plan). Three layers decide a note's
// finger: the player's override, else the finger the score prints, else the model's
// prediction. Predictions live in the score's data folder as fingerings.json, keyed by
// structural note keys so they outlast layout changes; overrides live beside them in
// fingering-overrides.json. Printed fingers and overrides are constraints of the model: it
// keeps their fingers and hands and predicts the other notes around them. Predictions record
// which constraints they were fitted to, so the editor knows when a re-fit would change
// them; they are reused while the model and the key scheme match, and predicted again
// otherwise. The score file is never written.
import {
  FINGERING_MODEL,
  predictFingerings,
  printedFingerings,
  tiedContinuations,
  type FingeringConstraint,
  type FingeringPredictor,
  type PredictedFingering,
} from "../../fingering";
import { OVERRIDES_FILE, overridesFile, parseOverrides, type FingeringOverride, type FingeringOverrides } from "./overrides";
import type { ScoreDataStore } from "./scoreData";

export const FINGERINGS_FILE = "fingerings.json";
const SCHEMA_VERSION = 2;
/** The structural note key scheme of section 3.5. */
export const NOTE_KEY_SCHEME = 1;

export interface FingeringsFile {
  schemaVersion: number;
  model: string;
  noteKeyScheme: number;
  /** The signature of the printed fingers and overrides the predictions were fitted to. */
  constraints: string;
  predicted: Record<string, PredictedFingering>;
}

function isFingering(value: unknown): value is PredictedFingering {
  const candidate = value as PredictedFingering;
  return (
    typeof candidate === "object" && candidate !== null &&
    Number.isInteger(candidate.finger) && candidate.finger >= 1 && candidate.finger <= 5 &&
    typeof candidate.left === "boolean"
  );
}

export interface StoredPredictions {
  predicted: Record<string, PredictedFingering>;
  constraints: string;
}

/** The stored predictions by note key, or null when they are missing, malformed or stale. */
export function storedPredictions(text: string | null): StoredPredictions | null {
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
    typeof file.constraints !== "string" ||
    typeof file.predicted !== "object" || file.predicted === null ||
    !Object.values(file.predicted).every(isFingering)
  ) {
    return null;
  }
  return { predicted: file.predicted, constraints: file.constraints };
}

export function fingeringsFile(predicted: Record<string, PredictedFingering>, constraints: string): string {
  const file: FingeringsFile = {
    schemaVersion: SCHEMA_VERSION,
    model: FINGERING_MODEL,
    noteKeyScheme: NOTE_KEY_SCHEME,
    constraints,
    predicted,
  };
  return JSON.stringify(file);
}

const VIEWER_PREFIX = /^page-\d+-/;

/** Viewer IDs carry the page; stored data does not. */
export function noteKeyOf(viewerId: string): string {
  return viewerId.replace(VIEWER_PREFIX, "");
}

/** cyrb53: a short, stable hash, enough to tell one set of constraints from another. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** What the model must respect for each note, by structural key. */
function constraintsByKey(
  printed: Readonly<Record<string, PredictedFingering>>,
  overrides: FingeringOverrides,
): Map<string, FingeringConstraint> {
  const result = new Map<string, FingeringConstraint>();
  for (const [id, fingering] of Object.entries(printed)) result.set(noteKeyOf(id), { finger: fingering.finger });
  for (const [key, override] of Object.entries(overrides)) {
    const constraint = { ...result.get(key) };
    if (override.finger !== undefined) constraint.finger = override.finger;
    if (override.left !== undefined) constraint.left = override.left;
    result.set(key, constraint);
  }
  return result;
}

/** Tells the printed fingers and overrides predictions were fitted to from any others. */
export function constraintSignature(
  printed: Readonly<Record<string, PredictedFingering>>,
  overrides: FingeringOverrides,
): string {
  const entries = [...constraintsByKey(printed, overrides)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, constraint]) => `${key}:${constraint.finger ?? ""}:${constraint.left === undefined ? "" : constraint.left ? "L" : "R"}`);
  return hash(entries.join("|"));
}

export interface ScoreFingerings {
  /** The model's fingers by viewer ID, each with the hand its staff and clef imply. */
  predicted: Record<string, PredictedFingering>;
  /** Fingers the score prints, by viewer ID. */
  printed: Record<string, PredictedFingering>;
  /** Each held note, tied on from another, mapped to the note that starts its tie, by viewer ID. */
  tiedTo: Record<string, string>;
  /** The player's fingerings, by structural key. */
  overrides: FingeringOverrides;
  /** Why the overrides file could not be read; edits are then kept for the session only. */
  overridesError: string | null;
  /** The constraint signature the predictions were fitted to. */
  fittedConstraints: string;
  /** Whether the predictions came from the data folder. */
  fromStore: boolean;
}

/** Each note's viewer ID, by structural key, from a document MusicXML. */
export function viewerIdsByKey(documentMusicXml: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of documentMusicXml.matchAll(/<note\b[^>]*\bid="([^"]+)"/g)) {
    result.set(noteKeyOf(match[1]), match[1]);
  }
  return result;
}

function byViewerId(
  byKey: Readonly<Record<string, PredictedFingering>>,
  viewerIdByKey: ReadonlyMap<string, string>,
): Record<string, PredictedFingering> {
  const result: Record<string, PredictedFingering> = {};
  for (const [key, fingering] of Object.entries(byKey)) {
    const id = viewerIdByKey.get(key);
    if (id) result[id] = fingering;
  }
  return result;
}

/**
 * Predicts the score around its printed fingers and overrides, by structural key. Notes
 * with a fixed finger keep `previous`'s prediction when there is one, so that resetting an
 * override shows what the model would choose, not the finger it was told.
 */
async function fittedPredictions(
  documentMusicXml: string,
  predict: FingeringPredictor,
  printed: Readonly<Record<string, PredictedFingering>>,
  overrides: FingeringOverrides,
  previous: Readonly<Record<string, PredictedFingering>> = {},
): Promise<Record<string, PredictedFingering>> {
  const constraints = constraintsByKey(printed, overrides);
  const { fingeringsByMusicXmlId } = await predictFingerings(
    documentMusicXml,
    predict,
    (id) => constraints.get(noteKeyOf(id)),
  );
  const previousByKey = new Map(Object.entries(previous).map(([id, fingering]) => [noteKeyOf(id), fingering]));
  return Object.fromEntries(
    Object.entries(fingeringsByMusicXmlId).map(([id, fingering]) => {
      const key = noteKeyOf(id);
      const fixed = constraints.get(key)?.finger !== undefined;
      return [key, (fixed ? previousByKey.get(key) : undefined) ?? fingering];
    }),
  );
}

/**
 * Loads a score's fingerings: its overrides, and stored predictions when they are current,
 * else new ones fitted to its printed fingers and overrides, which are stored for next time.
 * A failed write keeps the predictions for this session.
 */
export async function loadScoreFingerings(
  documentMusicXml: string,
  store: ScoreDataStore,
  predict: FingeringPredictor,
  onPredicting: () => void = () => {},
): Promise<ScoreFingerings> {
  const printed = printedFingerings(documentMusicXml);
  const tiedTo = tiedContinuations(documentMusicXml);
  const viewerIdByKey = viewerIdsByKey(documentMusicXml);

  let overrides: FingeringOverrides = {};
  let overridesError: string | null = null;
  try {
    overrides = parseOverrides(await store.read(OVERRIDES_FILE), NOTE_KEY_SCHEME);
  } catch (error) {
    overridesError = error instanceof Error ? error.message : String(error);
  }

  const stored = storedPredictions(await store.read(FINGERINGS_FILE));
  if (stored) {
    return {
      predicted: byViewerId(stored.predicted, viewerIdByKey),
      printed,
      tiedTo,
      overrides,
      overridesError,
      fittedConstraints: stored.constraints,
      fromStore: true,
    };
  }
  onPredicting();
  const predictedByKey = await fittedPredictions(documentMusicXml, predict, printed, overrides);
  const fittedConstraints = constraintSignature(printed, overrides);
  try {
    await store.write(FINGERINGS_FILE, fingeringsFile(predictedByKey, fittedConstraints));
  } catch (error) {
    console.warn("The predicted fingerings could not be stored", error);
  }
  return {
    predicted: byViewerId(predictedByKey, viewerIdByKey),
    printed,
    tiedTo,
    overrides,
    overridesError,
    fittedConstraints,
    fromStore: false,
  };
}

/**
 * Predicts the score again around its printed fingers and the given overrides, and stores
 * the result. The overrides themselves are not changed.
 */
export async function refitScoreFingerings(
  documentMusicXml: string,
  store: ScoreDataStore,
  predict: FingeringPredictor,
  current: Pick<ScoreFingerings, "predicted" | "printed">,
  overrides: FingeringOverrides,
): Promise<Pick<ScoreFingerings, "predicted" | "fittedConstraints">> {
  const predictedByKey = await fittedPredictions(documentMusicXml, predict, current.printed, overrides, current.predicted);
  const fittedConstraints = constraintSignature(current.printed, overrides);
  await store.write(FINGERINGS_FILE, fingeringsFile(predictedByKey, fittedConstraints));
  return { predicted: byViewerId(predictedByKey, viewerIdsByKey(documentMusicXml)), fittedConstraints };
}

export async function saveScoreOverrides(store: ScoreDataStore, overrides: FingeringOverrides): Promise<void> {
  await store.write(OVERRIDES_FILE, overridesFile(overrides, NOTE_KEY_SCHEME));
}

/** Who decided a note's finger. */
export type FingeringSource = "yours" | "printed" | "predicted";

export interface EffectiveFingering extends PredictedFingering {
  source: FingeringSource;
  /** The hand the note's staff and clef imply. */
  staffLeft: boolean;
  /** The player moved the note to the other hand. */
  handMoved: boolean;
  /** What the note would have without the player's finger. */
  baseFinger: number;
  /** Whether that finger is printed rather than predicted. */
  basePrinted: boolean;
  /** For a held note, the note whose tie it continues, whose finger and hand it takes. */
  tiedTo?: string;
}

/**
 * Each note's finger and hand, by viewer ID: the player's, else printed, else predicted.
 * A held note, tied on from another, is played by the finger holding that note. A note
 * without a printed finger or a prediction has none.
 */
export function resolveFingerings(
  fingerings: Pick<ScoreFingerings, "predicted" | "printed"> & Partial<Pick<ScoreFingerings, "tiedTo">>,
  overrides: FingeringOverrides,
): Record<string, EffectiveFingering> {
  const result: Record<string, EffectiveFingering> = {};
  const tiedTo = fingerings.tiedTo ?? {};
  const ids = new Set([...Object.keys(fingerings.predicted), ...Object.keys(fingerings.printed)]);
  for (const id of ids) {
    if (tiedTo[id]) continue;
    const fingering = resolveFingering(fingerings, overrides, id);
    if (fingering) result[id] = fingering;
  }
  for (const [held, start] of Object.entries(tiedTo)) {
    if (result[start]) result[held] = { ...result[start], tiedTo: start };
  }
  return result;
}

/** One note's finger and hand, as resolveFingerings gives them, without resolving the others. */
export function resolveFingering(
  fingerings: Pick<ScoreFingerings, "predicted" | "printed"> & Partial<Pick<ScoreFingerings, "tiedTo">>,
  overrides: FingeringOverrides,
  id: string,
): EffectiveFingering | undefined {
  const start = fingerings.tiedTo?.[id];
  if (start) {
    const held = resolveFingering(fingerings, overrides, start);
    return held && { ...held, tiedTo: start };
  }
  const printed = fingerings.printed[id];
  const base = printed ?? fingerings.predicted[id];
  if (!base) return undefined;
  const override: FingeringOverride | undefined = overrides[noteKeyOf(id)];
  const left = override?.left ?? base.left;
  return {
    finger: override?.finger ?? base.finger,
    left,
    source: override?.finger !== undefined ? "yours" : printed ? "printed" : "predicted",
    staffLeft: base.left,
    handMoved: left !== base.left,
    baseFinger: base.finger,
    basePrinted: Boolean(printed),
  };
}

/**
 * The overrides with one note's changed. A finger the score already prints and a hand the
 * staff already implies are no change, so they are dropped; a note left with neither has no
 * override.
 */
export function withOverride(
  overrides: FingeringOverrides,
  viewerId: string,
  change: FingeringOverride | null,
  effective: EffectiveFingering,
): FingeringOverrides {
  const key = noteKeyOf(viewerId);
  const next: Record<string, FingeringOverride> = { ...overrides };
  if (change === null) {
    delete next[key];
    return next;
  }
  const merged: FingeringOverride = { ...next[key], ...change };
  if (merged.finger !== undefined && effective.basePrinted && merged.finger === effective.baseFinger) delete merged.finger;
  if (merged.left !== undefined && merged.left === effective.staffLeft) delete merged.left;
  if (merged.finger === undefined && merged.left === undefined) delete next[key];
  else next[key] = merged;
  return next;
}
