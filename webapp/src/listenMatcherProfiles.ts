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

/**
 * Stable, versioned identifiers. These are not UI labels.
 *
 * The `v1` entries are the first generation, selected from a Direct-only
 * sequence sweep before the Tone renderer and the dynamics corpora existed. They
 * are immutable historical references and are never edited in place.
 *
 * The `v2` entries are the frozen safe Pareto set of the multi-domain search
 * over the `discovery` partition of `listenTraceManifest`. `early`/`steady` name
 * the fresh-onset gate (0.45 accepts a softer attack than 0.50) and
 * `open`/`held` name the active-target gate (0.20 accepts weaker sustained
 * evidence than 0.275); all four raise the unexpected-note gate to 0.99.
 * `early-open-v2` repeats the values of `sensitive-v1`, and still receives its
 * own identifier: it was selected by a different corpus under a different rule,
 * and a later change to one generation must never silently move the other.
 */
export type ListenMatcherProfileId =
  | "baseline-v1"
  | "balanced-v1"
  | "sensitive-v1"
  | "early-open-v2"
  | "steady-open-v2"
  | "early-held-v2"
  | "steady-held-v2";

/**
 * The five confidence controls a matcher profile may set. Benchmarks explore
 * arbitrary threshold sets, including ones that relax the fresh-bass rule, so
 * this is the shared shape every replay and conversion accepts.
 */
export interface ListenMatcherThresholds {
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: boolean;
}

/** A named, production-eligible profile. Fresh bass onsets are always required. */
export interface ListenMatcherProfile extends ListenMatcherThresholds {
  id: ListenMatcherProfileId;
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
 *
 * Version 2 added the frozen multi-domain candidates. No version-1 entry moved.
 */
export const LISTEN_MATCHER_REGISTRY_VERSION = 2;

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
  "early-open-v2",
  "steady-open-v2",
  "early-held-v2",
  "steady-held-v2",
] as const);

/**
 * The frozen multi-domain candidate set, in the search's ranked order.
 *
 * Confirmation replay evaluates exactly these identifiers beside `baseline-v1`.
 * The list is frozen with the search that produced it: adding or removing an
 * entry after any confirmation outcome has been observed starts a new discovery
 * round rather than amending this one.
 */
export const LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS: readonly ListenMatcherProfileId[] =
  Object.freeze([
    "early-open-v2",
    "steady-open-v2",
    "early-held-v2",
    "steady-held-v2",
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
] as const satisfies readonly (keyof ListenMatcherThresholds)[];

function isThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** True when the value is a usable threshold set for matcher conversion. */
export function isListenMatcherThresholds(value: unknown): value is ListenMatcherThresholds {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ListenMatcherThresholds>;
  if (typeof candidate.requireFreshBassOnset !== "boolean") return false;
  return PROFILE_THRESHOLD_KEYS.every((key) => isThreshold(candidate[key]));
}

/** True when the value is a structurally valid, production-eligible profile. */
export function isListenMatcherProfile(value: unknown): value is ListenMatcherProfile {
  if (!isListenMatcherThresholds(value)) return false;
  const candidate = value as Partial<ListenMatcherProfile>;
  return isListenMatcherProfileId(candidate.id) && candidate.requireFreshBassOnset === true;
}

function frozenProfile(profile: ListenMatcherProfile): ListenMatcherProfile {
  if (!isListenMatcherProfile(profile)) {
    throw new Error(`Invalid listen matcher profile: ${JSON.stringify(profile)}`);
  }
  return Object.freeze(profile);
}

/**
 * Current production values, the two first-generation Direct sweep candidates
 * (`o0p500-t0p500-a0p350-x0p990-b1` and `o0p450-t0p500-a0p200-x0p990-b1`), and
 * the four multi-domain candidates, which are the sweep profiles
 * `o0p450-t0p500-a0p200-x0p990-b1`, `o0p500-t0p500-a0p200-x0p990-b1`,
 * `o0p450-t0p500-a0p275-x0p990-b1`, and `o0p500-t0p500-a0p275-x0p990-b1`.
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
  "early-open-v2": frozenProfile({
    id: "early-open-v2",
    onsetThreshold: 0.45,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.2,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
  "steady-open-v2": frozenProfile({
    id: "steady-open-v2",
    onsetThreshold: 0.5,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.2,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
  "early-held-v2": frozenProfile({
    id: "early-held-v2",
    onsetThreshold: 0.45,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.275,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
  "steady-held-v2": frozenProfile({
    id: "steady-held-v2",
    onsetThreshold: 0.5,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.275,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  }),
});

/**
 * The profile uncalibrated users, changed devices, invalid calibration records,
 * and rollback fall back to. Changing it is one reviewed production decision,
 * taken only after the frozen candidates pass their confirmation and live gates.
 *
 * The August 21, 2026 frozen automated confirmation rejected all four `v2`
 * candidates: each advances an omitted-bass safety fixture `baseline-v1`
 * refuses, and none holds the held-out Tone recognition floors. The production
 * decision recorded the following day is therefore `no-safe-candidate`, and this
 * constant is unchanged. Moving it now to a value picked in response to those
 * measurements would be post-result retuning; a different default needs a new
 * discovery round whose search accounts for isolated omitted-bass evidence.
 *
 * The August 25, 2026 round-two production decision leaves it unchanged again.
 * That round accepted no ablation, registered no candidate, and confirmed
 * nothing, so its bounded conclusion is
 * `round-two-grid-produced-no-eligible-improvement` with reason
 * `no-ablation-accepted`, and the approved-profile list it froze is exactly
 * `[baseline-v1]`. The searched grids did select profiles the stop rule then
 * refused; adopting one of them here would be choosing a value in response to
 * the measurements that refused it.
 *
 * Registry membership is not approval. This registry deliberately retains every
 * historical and rejected profile so a regression can be reproduced and a default
 * rolled back, which is why the approved list lives in
 * `listenRoundTwoProductionDecision.ts` and why any later calibration path must
 * ask that module — not this one — what it may offer.
 *
 * This constant is also the rollback. Every released profile stays in the
 * registry, so reverting a future default is one edit here rather than a
 * reconstruction of its values from the benchmark history.
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

/** The bare threshold set of a profile, without its registry identity. */
export function listenMatcherThresholds(
  profile: ListenMatcherThresholds,
): ListenMatcherThresholds {
  return Object.freeze({
    onsetThreshold: profile.onsetThreshold,
    targetNoteThreshold: profile.targetNoteThreshold,
    activeTargetThreshold: profile.activeTargetThreshold,
    extraNoteThreshold: profile.extraNoteThreshold,
    requireFreshBassOnset: profile.requireFreshBassOnset,
  });
}

/**
 * Resolves the profile listen mode should run with. Calibration will later add a
 * stored selection ahead of the default; production must never accept arbitrary
 * thresholds from a URL parameter or a stored JSON object.
 *
 * The optional override is the debug-surface selection: it is held in session
 * memory only, is never written to storage, and is cleared whenever the debug
 * panel is switched off, so a device that is merely reloaded is back on the
 * default. It names a registry identifier rather than carrying thresholds,
 * which is what keeps this from becoming the sensitivity slider the plan rules
 * out.
 *
 * An identifier that is not in the registry resolves to the default instead of
 * throwing, matching how an incompatible stored calibration record must behave:
 * an unusable selection leaves the user on the safe profile rather than
 * breaking listen mode.
 */
/**
 * The override that survives a debug-panel change.
 *
 * The picker lives inside the debug card, so an override left active behind a
 * hidden control would keep changing advancement behaviour with nothing on
 * screen saying so. Switching the panel off therefore returns listen mode to the
 * default, and this is a function rather than a line in a click handler so the
 * rule is tested rather than asserted in a comment.
 */
export function listenMatcherOverrideAfterDebugPanelChange(
  debugPanelEnabled: boolean,
  currentOverride: ListenMatcherProfileId | null,
): ListenMatcherProfileId | null {
  return debugPanelEnabled ? currentOverride : null;
}

export function resolveEffectiveListenMatcherProfile(
  override?: ListenMatcherProfileId | null,
): ListenMatcherProfile {
  if (override != null && isListenMatcherProfileId(override)) {
    return LISTEN_MATCHER_PROFILES[override];
  }
  return LISTEN_MATCHER_PROFILES[DEFAULT_LISTEN_MATCHER_PROFILE_ID];
}

/**
 * The single conversion from a profile, a registry identifier, or a benchmark
 * threshold set to complete matcher options. Production, trace replay, and every
 * benchmark must use this function so the fixed policy cannot drift between them.
 */
export function matcherOptionsForListenMatcherProfile(
  profile: ListenMatcherThresholds | ListenMatcherProfileId = DEFAULT_LISTEN_MATCHER_PROFILE_ID,
): ChordMatcherOptions {
  if (typeof profile === "string" && !isListenMatcherProfileId(profile)) {
    // Replay names profiles by identifier, so a misspelled candidate must fail
    // here rather than quietly become a second measurement of the default.
    throw new Error(`Unknown listen matcher profile identifier: ${profile}`);
  }
  const resolved = typeof profile === "string" ? getListenMatcherProfile(profile) : profile;
  if (!isListenMatcherThresholds(resolved)) {
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
