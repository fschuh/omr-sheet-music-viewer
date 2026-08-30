/**
 * Task 26's round-two grid generator.
 *
 * The round-one generator in `listenMatcherSweepBenchmark` is immutable: its
 * grid size, rejection census, frontier, and recommendation are the historical
 * record that the Task 08 archive and the single-renderer sweep regressions must
 * keep reproducing exactly. A generator that gained a refinement point or an
 * axis would change all four, so round two adds this separate generator instead
 * and imports round one's grid unchanged for its first ablation.
 *
 * Nothing here selects anything. It emits the three staged grids and the matched
 * pairing the bass-support comparison reads; the staging, the frozen Task 24
 * stop rule, and the terminal outcome live in `listenRoundTwoAblationBenchmark`.
 */

import {
  LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS,
  LISTEN_MATCHER_SELECTION_POLICY,
  assertValidListenMatcherSelectionPolicy,
} from "../listenMatcherSelectionPolicy";
import {
  LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS,
  generateListenMatcherSweepProfiles,
  type ListenMatcherSweepProfile,
} from "./listenMatcherSweepBenchmark";
import { LISTEN_BASELINE_PROFILE } from "./listenBaselineParity";
import type { ListenExperimentalBassOnsetThresholds } from "../listenExperimentalBassOnset";

/** Bumped only when a staged grid's coordinates change. */
export const LISTEN_ROUND_TWO_GENERATOR_VERSION = 1;

/**
 * The three staged grids, in the order Task 26 runs them.
 *
 * Ablation one is the unchanged round-one grid against the version-2 corpus, so
 * the corpus change is measured on its own. Ablation two refines the existing
 * five-axis family, so grid resolution is measured against that. Ablation three
 * adds the bass axis over the identical refined grid, so the axis is measured
 * against its own matched control rather than against ablation two's separate
 * result.
 */
export type ListenRoundTwoAblationId =
  | "ablation-1-round-one-grid"
  | "ablation-2-refined-family"
  | "ablation-3-bass-axis";

export const LISTEN_ROUND_TWO_ABLATION_IDS: readonly ListenRoundTwoAblationId[] = Object.freeze([
  "ablation-1-round-one-grid",
  "ablation-2-refined-family",
  "ablation-3-bass-axis",
] as const);

/**
 * The two target-note points ablation two adds.
 *
 * Round one pinned `targetNoteThreshold` at 0.50 in all four selected profiles
 * while its neighbours sat 0.075 away, which is consistent both with the axis
 * being inert and with it being too coarsely gridded to show an effect. These
 * are the midpoints of the two intervals adjacent to the selected value, so the
 * refinement asks that question at half the round-one spacing on both sides.
 */
export const LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS: readonly number[] =
  Object.freeze([0.4625, 0.5375]);

/**
 * The bass-onset points ablation three crosses the refined grid with.
 *
 * Every one is read from Task 22's measured distributions rather than chosen for
 * symmetry. The strongest hallucinated bass onset in the isolated corpus is
 * 0.5267 (Direct) and 0.5094 (Tone), and the weakest genuine isolated bass onset
 * is 0.7161 (Direct), so 0.55 is the smallest raise that refuses both recorded
 * hallucinations, 0.60 is the incumbent's own gate and the top of the recorded
 * hallucination corridor, and 0.70 is the most aggressive refusal that still
 * admits every genuine isolated bass onset Task 22 measured. Nothing above 0.70
 * is offered, because it would refuse observed genuine attacks by construction.
 */
export const LISTEN_ROUND_TWO_BASS_ONSET_POINTS: readonly number[] =
  Object.freeze([0.55, 0.6, 0.7]);

/** One round-two grid row: a threshold set, its identity, and its pairing. */
export interface ListenRoundTwoSweepProfile
  extends ListenMatcherSweepProfile, ListenExperimentalBassOnsetThresholds {
  /** Null is the compatibility default: the general onset gate judges the bass. */
  bassOnsetThreshold: number | null;
  /**
   * The no-bass profile this row is compared against, identical in every other
   * coordinate. Null on the twins themselves.
   */
  matchedTwinProfileId: string | null;
}

export interface ListenRoundTwoGrid {
  ablation: ListenRoundTwoAblationId;
  generatorVersion: number;
  gridVersion: string;
  gridSize: number;
  bassAxisPresent: boolean;
  onsetThresholds: number[];
  targetNoteThresholds: number[];
  activeTargetThresholds: number[];
  extraNoteThresholds: number[];
  requireFreshBassOnsetValues: boolean[];
  bassOnsetThresholds: number[];
  matchedPairCount: number;
  profiles: ListenRoundTwoSweepProfile[];
}

/**
 * Round one's three-decimal identifier wherever it states the value exactly,
 * and a fourth decimal only where it would not.
 *
 * Every coordinate the two generations share therefore keeps the identifier
 * round one gave it — including the baseline profile the sweep looks up by name
 * — so a row can be followed from ablation to ablation, while a refinement point
 * like 0.4625 is named for what it is instead of being rounded into a value the
 * row does not hold.
 */
function stableThresholdId(value: number): string {
  const threeDecimals = value.toFixed(3);
  return (Number(threeDecimals) === value ? threeDecimals : value.toFixed(4)).replace(".", "p");
}

function ascending(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Round one's own distance metric, extended by how far a row departs from the
 * bass axis's compatibility default.
 *
 * The metric is a ranking tie-break, so a shared profile must score exactly what
 * round one scored it, and a bass variant must not be able to tie with the twin
 * it is supposed to be compared against.
 */
function profileDistanceFromBaseline(profile: {
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: boolean;
  bassOnsetThreshold: number | null;
}): number {
  return Math.abs(profile.onsetThreshold - LISTEN_BASELINE_PROFILE.onsetThreshold) +
    Math.abs(profile.targetNoteThreshold - LISTEN_BASELINE_PROFILE.targetNoteThreshold) +
    Math.abs(profile.activeTargetThreshold - LISTEN_BASELINE_PROFILE.activeTargetThreshold) +
    Math.abs(profile.extraNoteThreshold - LISTEN_BASELINE_PROFILE.extraNoteThreshold) +
    (profile.requireFreshBassOnset === LISTEN_BASELINE_PROFILE.requireFreshBassOnset ? 0 : 1) +
    (profile.bassOnsetThreshold === null
      ? 0
      : Math.abs(profile.bassOnsetThreshold - profile.onsetThreshold));
}

function refinedProfileId(profile: {
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: boolean;
}): string {
  return `o${stableThresholdId(profile.onsetThreshold)}` +
    `-t${stableThresholdId(profile.targetNoteThreshold)}` +
    `-a${stableThresholdId(profile.activeTargetThreshold)}` +
    `-x${stableThresholdId(profile.extraNoteThreshold)}` +
    `-b${profile.requireFreshBassOnset ? "1" : "0"}`;
}

/** The refined five-axis family. It adds no axis; every row is a no-bass twin. */
export function generateListenRoundTwoRefinedProfiles(): ListenRoundTwoSweepProfile[] {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  const profiles: ListenRoundTwoSweepProfile[] = [];
  for (const onsetThreshold of ascending(LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS)) {
    for (const targetNoteThreshold of ascending([
      ...LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS,
      ...LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS,
    ])) {
      for (const activeTargetThreshold of ascending([
        ...LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS,
        ...LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS,
      ])) {
        for (const extraNoteThreshold of ascending(LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS)) {
          // The `b0` half of round one's grid is refused structurally by the
          // safety rule — all 500 of it — so refining it would double a search
          // that cannot select any of its rows. The refinement keeps the fresh
          // bass requirement and records that the excluded half is unchanged.
          const profile = {
            onsetThreshold,
            targetNoteThreshold,
            activeTargetThreshold,
            extraNoteThreshold,
            requireFreshBassOnset: true,
            bassOnsetThreshold: null,
          };
          profiles.push({
            ...profile,
            id: refinedProfileId(profile),
            distanceFromProduction: profileDistanceFromBaseline(profile),
            matchedTwinProfileId: null,
          });
        }
      }
    }
  }
  return profiles;
}

/**
 * The refined grid crossed with the bass axis, emitted as matched pairs.
 *
 * A bass point is offered only where it is strictly above the profile's own
 * general onset gate: the axis exists to refuse a bass onset the general gate
 * would admit, and a bass gate at or below the general one is either the twin
 * itself or a strictly inert row that would inflate the grid without asking a
 * question.
 */
export function generateListenRoundTwoBassAxisProfiles(): ListenRoundTwoSweepProfile[] {
  const twins = generateListenRoundTwoRefinedProfiles();
  const variants = twins.flatMap((twin) => (
    LISTEN_ROUND_TWO_BASS_ONSET_POINTS
      .filter((bassOnsetThreshold) => bassOnsetThreshold > twin.onsetThreshold)
      .map((bassOnsetThreshold): ListenRoundTwoSweepProfile => ({
        ...twin,
        bassOnsetThreshold,
        id: `${twin.id}-B${stableThresholdId(bassOnsetThreshold)}`,
        distanceFromProduction: profileDistanceFromBaseline({ ...twin, bassOnsetThreshold }),
        matchedTwinProfileId: twin.id,
      }))
  ));
  return [...twins, ...variants];
}

function roundOneGridAsRoundTwoProfiles(): ListenRoundTwoSweepProfile[] {
  return generateListenMatcherSweepProfiles().map((profile) => ({
    ...profile,
    bassOnsetThreshold: null,
    matchedTwinProfileId: null,
  }));
}

/**
 * The staged grid one ablation runs, with the coordinates it spans recorded
 * beside it so an artifact states the grid rather than implying it.
 */
export function listenRoundTwoAblationGrid(
  ablation: ListenRoundTwoAblationId,
): ListenRoundTwoGrid {
  const profiles = ablation === "ablation-1-round-one-grid"
    ? roundOneGridAsRoundTwoProfiles()
    : ablation === "ablation-2-refined-family"
    ? generateListenRoundTwoRefinedProfiles()
    : generateListenRoundTwoBassAxisProfiles();
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) {
    throw new Error(`${ablation} generated a duplicated profile identifier.`);
  }
  // Only the first ablation is the historical grid, and it must be exactly the
  // historical grid: same size, same identifiers, same coordinates, no axis.
  if (ablation === "ablation-1-round-one-grid") {
    const roundOne = generateListenMatcherSweepProfiles();
    const drifted = profiles.length !== roundOne.length ||
      profiles.some((profile, index) => (
        profile.id !== roundOne[index].id ||
        profile.onsetThreshold !== roundOne[index].onsetThreshold ||
        profile.targetNoteThreshold !== roundOne[index].targetNoteThreshold ||
        profile.activeTargetThreshold !== roundOne[index].activeTargetThreshold ||
        profile.extraNoteThreshold !== roundOne[index].extraNoteThreshold ||
        profile.requireFreshBassOnset !== roundOne[index].requireFreshBassOnset ||
        profile.distanceFromProduction !== roundOne[index].distanceFromProduction ||
        profile.bassOnsetThreshold !== null
      ));
    if (drifted || profiles.length !== 1_000) {
      throw new Error("Ablation one is not the immutable round-one 1,000-profile grid.");
    }
  }
  const bassProfiles = profiles.filter(({ bassOnsetThreshold }) => bassOnsetThreshold !== null);
  if (ablation !== "ablation-3-bass-axis" && bassProfiles.length > 0) {
    throw new Error(`${ablation} must not carry the bass axis.`);
  }
  const baselineId = generateListenMatcherSweepProfiles()
    .find((profile) => (
      profile.onsetThreshold === LISTEN_BASELINE_PROFILE.onsetThreshold &&
      profile.targetNoteThreshold === LISTEN_BASELINE_PROFILE.targetNoteThreshold &&
      profile.activeTargetThreshold === LISTEN_BASELINE_PROFILE.activeTargetThreshold &&
      profile.extraNoteThreshold === LISTEN_BASELINE_PROFILE.extraNoteThreshold &&
      profile.requireFreshBassOnset === LISTEN_BASELINE_PROFILE.requireFreshBassOnset
    ))?.id;
  // Every staged grid is scored against the incumbent on the same corpus, and
  // the sweep looks the incumbent up by round one's identifier, so a grid that
  // renamed or dropped it would measure a different comparison than it claims.
  if (baselineId === undefined || !profiles.some(({ id }) => id === baselineId)) {
    throw new Error(`${ablation} does not contain the baseline profile ${baselineId}.`);
  }
  const twinIds = new Set(profiles
    .filter(({ bassOnsetThreshold }) => bassOnsetThreshold === null)
    .map(({ id }) => id));
  for (const profile of bassProfiles) {
    if (profile.matchedTwinProfileId === null || !twinIds.has(profile.matchedTwinProfileId)) {
      throw new Error(`${profile.id} has no matched compatibility-default twin in its own grid.`);
    }
  }
  return {
    ablation,
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    gridVersion: `round-two-v${LISTEN_ROUND_TWO_GENERATOR_VERSION}/${ablation}`,
    gridSize: profiles.length,
    bassAxisPresent: bassProfiles.length > 0,
    onsetThresholds: ascending(profiles.map(({ onsetThreshold }) => onsetThreshold)),
    targetNoteThresholds: ascending(profiles.map(({ targetNoteThreshold }) => targetNoteThreshold)),
    activeTargetThresholds: ascending(profiles.map(({ activeTargetThreshold }) => (
      activeTargetThreshold
    ))),
    extraNoteThresholds: ascending(profiles.map(({ extraNoteThreshold }) => extraNoteThreshold)),
    requireFreshBassOnsetValues: [...new Set(profiles.map(({ requireFreshBassOnset }) => (
      requireFreshBassOnset
    )))].sort((left, right) => Number(left) - Number(right)),
    bassOnsetThresholds: ascending(bassProfiles.map(({ bassOnsetThreshold }) => (
      bassOnsetThreshold as number
    ))),
    matchedPairCount: bassProfiles.length,
    profiles,
  };
}
