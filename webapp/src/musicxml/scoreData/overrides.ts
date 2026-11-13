// The player's own fingerings for a MusicXML score, in its data folder as
// fingering-overrides.json. They are user data: predictions are regenerated, overrides never
// are, so they live in a file of their own that only the fingering editor writes. A finger
// and a hand are kept apart, so a note can be moved to the other hand while the model still
// chooses its finger.
export const OVERRIDES_FILE = "fingering-overrides.json";
const SCHEMA_VERSION = 1;

/** A note's override: the finger, the hand, or both. */
export interface FingeringOverride {
  finger?: number;
  left?: boolean;
}

/** Overrides by structural note key. */
export type FingeringOverrides = Readonly<Record<string, FingeringOverride>>;

interface OverridesFile {
  schemaVersion: number;
  noteKeyScheme: number;
  overrides: Record<string, FingeringOverride>;
}

function isOverride(value: unknown): value is FingeringOverride {
  if (typeof value !== "object" || value === null) return false;
  const { finger, left } = value as FingeringOverride;
  const fingerValid = finger === undefined || (Number.isInteger(finger) && finger >= 1 && finger <= 5);
  const leftValid = left === undefined || typeof left === "boolean";
  return fingerValid && leftValid && (finger !== undefined || left !== undefined);
}

/**
 * The overrides a file holds; none when there is no file. A file that cannot be read throws,
 * so the caller can leave it alone rather than replace the player's work with nothing.
 */
export function parseOverrides(text: string | null, noteKeyScheme: number): FingeringOverrides {
  if (text === null) return {};
  let file: Partial<OverridesFile>;
  try {
    file = JSON.parse(text) as Partial<OverridesFile>;
  } catch {
    throw new Error(`${OVERRIDES_FILE} is not valid JSON`);
  }
  if (file.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${OVERRIDES_FILE} has schema version ${String(file.schemaVersion)}, not ${SCHEMA_VERSION}`);
  }
  if (file.noteKeyScheme !== noteKeyScheme) {
    throw new Error(`${OVERRIDES_FILE} uses note key scheme ${String(file.noteKeyScheme)}, not ${noteKeyScheme}`);
  }
  if (typeof file.overrides !== "object" || file.overrides === null || !Object.values(file.overrides).every(isOverride)) {
    throw new Error(`${OVERRIDES_FILE} holds an override that is not a finger from 1 to 5 or a hand`);
  }
  return file.overrides;
}

export function overridesFile(overrides: FingeringOverrides, noteKeyScheme: number): string {
  const file: OverridesFile = {
    schemaVersion: SCHEMA_VERSION,
    noteKeyScheme,
    overrides: Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))),
  };
  return JSON.stringify(file, null, 1);
}
