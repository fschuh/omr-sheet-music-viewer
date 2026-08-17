import type { ChordMatcherOptions } from "./chordMatcher";

/**
 * Production-neutral owner of the named listen-mode matcher profiles.
 *
 * A profile only reinterprets model confidence. Timing, target ordering,
 * carry-over, and advancement semantics live in the fixed policy below and are
 * identical for every profile, so selecting a profile can never change the
 * matcher state machine or its safety guarantees.
 *
 * This module must not import benchmark code; benchmarks consume it instead.
 */

/** Stable, versioned identifiers. These are not UI labels. */
export type ListenMatcherProfileId =
  | "baseline-v1"
  | "balanced-v1"
  | "sensitive-v1";

/** The five confidence controls a production-eligible profile may set. */
export interface ListenMatcherProfile {
  id: ListenMatcherProfileId;
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: true;
}

/** Timing and state-machine options shared by every production-eligible profile. */
export interface FixedListenMatcherPolicy {
  preTargetExtraLookbackMs: number;
  collectionWindowMs: number;
  settleMs: number;
  duplicateOnsetMs: number;
  wrongAttemptResetMs: number;
  refractoryMs: number;
  refractoryMode: ChordMatcherOptions["refractoryMode"];
}

/**
 * Bumped whenever profile values or the fixed policy change. A stored
 * calibration record from a different registry version must be discarded.
 */
export const LISTEN_MATCHER_REGISTRY_VERSION = 1;

/**
 * The exact timing/state-machine values listen mode has always run with: the
 * chord-matcher defaults plus the two online-AMT deviations (a 32 ms settle
 * matching the input cadence, and note-event refractory counting).
 */
export const FIXED_LISTEN_MATCHER_POLICY: FixedListenMatcherPolicy = Object.freeze({
  preTargetExtraLookbackMs: 30,
  collectionWindowMs: 400,
  settleMs: 32,
  duplicateOnsetMs: 120,
  wrongAttemptResetMs: 180,
  refractoryMs: 180,
  refractoryMode: "noteEvents",
});

export const LISTEN_MATCHER_PROFILE_IDS: readonly ListenMatcherProfileId[] = Object.freeze([
  "baseline-v1",
  "balanced-v1",
  "sensitive-v1",
] as const);

export function isListenMatcherProfileId(value: unknown): value is ListenMatcherProfileId {
  return typeof value === "string" &&
    (LISTEN_MATCHER_PROFILE_IDS as readonly string[]).includes(value);
}

const PROFILE_THRESHOLD_KEYS = [
  "onsetThreshold",
  "targetNoteThreshold",
  "activeTargetThreshold",
  "extraNoteThreshold",
] as const satisfies readonly (keyof ListenMatcherProfile)[];

function isThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** True when the value is a structurally valid, production-eligible profile. */
export function isListenMatcherProfile(value: unknown): value is ListenMatcherProfile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ListenMatcherProfile>;
  if (!isListenMatcherProfileId(candidate.id)) return false;
  if (candidate.requireFreshBassOnset !== true) return false;
  return PROFILE_THRESHOLD_KEYS.every((key) => isThreshold(candidate[key]));
}

function frozenProfile(profile: ListenMatcherProfile): ListenMatcherProfile {
  if (!isListenMatcherProfile(profile)) {
    throw new Error(`Invalid listen matcher profile: ${JSON.stringify(profile)}`);
  }
  return Object.freeze(profile);
}

/**
 * Current production values, the balanced sweep candidate
 * (`o0p500-t0p500-a0p350-x0p990-b1`), and the sensitive sweep candidate
 * (`o0p450-t0p500-a0p200-x0p990-b1`).
 */
export const LISTEN_MATCHER_PROFILES: Readonly<
  Record<ListenMatcherProfileId, ListenMatcherProfile>
> = Object.freeze({
  "baseline-v1": frozenProfile({
    id: "baseline-v1",
    onsetThreshold: 0.6,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    extraNoteThreshold: 0.97,
    requireFreshBassOnset: true,
  }),
  "balanced-v1": frozenProfile({
    id: "balanced-v1",
    onsetThreshold: 0.5,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
  "sensitive-v1": frozenProfile({
    id: "sensitive-v1",
    onsetThreshold: 0.45,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.2,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
});

/**
 * The profile uncalibrated users, changed devices, invalid calibration records,
 * and rollback fall back to. Changing it is one reviewed production decision.
 */
export const DEFAULT_LISTEN_MATCHER_PROFILE_ID: ListenMatcherProfileId = "baseline-v1";

/** Looks up a registry entry, or returns undefined for an unknown identifier. */
export function findListenMatcherProfile(id: unknown): ListenMatcherProfile | undefined {
  return isListenMatcherProfileId(id) ? LISTEN_MATCHER_PROFILES[id] : undefined;
}

/** Looks up a registry entry, falling back to the production default. */
export function getListenMatcherProfile(id: unknown): ListenMatcherProfile {
  return findListenMatcherProfile(id) ??
    LISTEN_MATCHER_PROFILES[DEFAULT_LISTEN_MATCHER_PROFILE_ID];
}

/**
 * The single conversion from a named profile to complete matcher options.
 * Production, trace replay, and every benchmark must use this function so the
 * fixed policy cannot drift between them.
 */
export function matcherOptionsForListenMatcherProfile(
  profile: ListenMatcherProfile | ListenMatcherProfileId = DEFAULT_LISTEN_MATCHER_PROFILE_ID,
): ChordMatcherOptions {
  const resolved = typeof profile === "string" ? getListenMatcherProfile(profile) : profile;
  if (!isListenMatcherProfile(resolved)) {
    throw new Error(`Invalid listen matcher profile: ${JSON.stringify(resolved)}`);
  }
  return {
    ...FIXED_LISTEN_MATCHER_POLICY,
    onsetThreshold: resolved.onsetThreshold,
    targetNoteThreshold: resolved.targetNoteThreshold,
    activeTargetThreshold: resolved.activeTargetThreshold,
    noteThreshold: resolved.extraNoteThreshold,
    requireFreshBassOnset: resolved.requireFreshBassOnset,
  };
}
