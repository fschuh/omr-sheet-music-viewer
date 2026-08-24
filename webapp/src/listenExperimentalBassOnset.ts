/**
 * Task 26's experimental bass-onset axis, kept out of the production shape.
 *
 * `ListenMatcherThresholds` and `matcherOptionsForListenMatcherProfile` are the
 * production threshold shape and its single conversion, and Task 26 may extend
 * neither until it records `bass-axis-supported`. The round-two ablation grid
 * still has to be able to run the axis, so the value travels beside a threshold
 * set as an optional benchmark-only field and is applied by the one conversion
 * below, which every benchmark replay path uses.
 *
 * The compatibility default is the whole point of the design: a profile whose
 * bass gate equals its own general onset gate must reproduce that profile
 * exactly, so `null` and an absent field both mean "no axis" and the conversion
 * then emits no matcher option at all.
 */

import type { ChordMatcherOptions } from "./chordMatcher";
import {
  isListenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";

/** A benchmark threshold set that may carry the experimental bass-onset gate. */
export interface ListenExperimentalBassOnsetThresholds extends ListenMatcherThresholds {
  /** Absent or null means the general onset gate judges the bass, as it ships. */
  bassOnsetThreshold?: number | null;
}

function isBassOnsetThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The declared bass-onset gate of a threshold set, or null when it declares
 * none. An out-of-range declaration throws rather than being silently dropped:
 * a profile that believes it is running the axis must never be measured without
 * it and reported under its own identifier.
 */
export function listenExperimentalBassOnsetThreshold(
  profile: ListenExperimentalBassOnsetThresholds | ListenMatcherThresholds | ListenMatcherProfileId,
): number | null {
  if (typeof profile === "string") return null;
  const declared = (profile as ListenExperimentalBassOnsetThresholds).bassOnsetThreshold;
  if (declared === undefined || declared === null) return null;
  if (!isBassOnsetThreshold(declared)) {
    throw new Error(`Invalid experimental bass onset threshold: ${JSON.stringify(declared)}`);
  }
  return declared;
}

/**
 * The production conversion, plus the experimental gate when a benchmark
 * profile declares one.
 *
 * A profile without the field converts to exactly the object
 * `matcherOptionsForListenMatcherProfile` returns, so replaying the registry
 * through this function cannot differ from replaying it through production.
 */
export function matcherOptionsForListenExperimentalProfile(
  profile: ListenExperimentalBassOnsetThresholds | ListenMatcherThresholds | ListenMatcherProfileId,
): ChordMatcherOptions {
  const options = matcherOptionsForListenMatcherProfile(profile);
  const bassOnsetThreshold = listenExperimentalBassOnsetThreshold(profile);
  return bassOnsetThreshold === null ? options : { ...options, bassOnsetThreshold };
}

/**
 * The bare threshold set of a benchmark profile, carrying the experimental gate
 * when it has one.
 *
 * `listenMatcherThresholds` deliberately projects onto the five production
 * controls, so a replay path that normalizes through it would drop the axis and
 * measure a bass profile as its own twin.
 */
export function listenExperimentalThresholds(
  profile: ListenExperimentalBassOnsetThresholds | ListenMatcherThresholds,
): ListenExperimentalBassOnsetThresholds {
  if (!isListenMatcherThresholds(profile)) {
    throw new Error(`Invalid listen matcher profile: ${JSON.stringify(profile)}`);
  }
  const bassOnsetThreshold = listenExperimentalBassOnsetThreshold(profile);
  return Object.freeze({
    onsetThreshold: profile.onsetThreshold,
    targetNoteThreshold: profile.targetNoteThreshold,
    activeTargetThreshold: profile.activeTargetThreshold,
    extraNoteThreshold: profile.extraNoteThreshold,
    requireFreshBassOnset: profile.requireFreshBassOnset,
    ...(bassOnsetThreshold === null ? {} : { bassOnsetThreshold }),
  });
}
