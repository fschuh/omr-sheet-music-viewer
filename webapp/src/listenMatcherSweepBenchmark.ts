/**
 * Exploratory search over the 1,000-combination matcher threshold grid.
 *
 * The grid is deliberately independent of the production profile registry: the
 * sweep may test any parameter combination, including ones no shipped profile
 * would ever use. Its reference point is the frozen `baseline-v1` registry
 * entry rather than the mutable production-default pointer, so historical
 * discovery-corpus comparisons stay stable when the default changes.
 */

import type { ListenBenchmarkRendererConfiguration } from "./listenBenchmarkAudio";
import type { ListenMatcherThresholds } from "./listenMatcherProfiles";
import {
  LISTEN_BASELINE_PROFILE,
  assertListenSequenceRunParity,
} from "./listenBaselineParity";
import {
  aggregateListenSequenceRuns,
  bundledListenSequences,
  materializeListenSequence,
  replayListenSequenceTrace,
  summarizeListenSequenceSafety,
  type ListenSequenceAggregateSummary,
  type ListenSequenceBenchmarkResult,
  type ListenSequenceRunResult,
  type ListenSequenceSafetySummary,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";

/** The frozen reference profile for discovery parity, distance, and deltas. */
export const LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE: ListenMatcherThresholds =
  LISTEN_BASELINE_PROFILE;

function sortedUnique(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * proportion) - 1];
}

function profileDistanceFromBaseline(profile: ListenMatcherThresholds): number {
  return Math.abs(profile.onsetThreshold - LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.onsetThreshold) +
    Math.abs(profile.targetNoteThreshold - LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.targetNoteThreshold) +
    Math.abs(profile.activeTargetThreshold - LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.activeTargetThreshold) +
    Math.abs(profile.extraNoteThreshold - LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.extraNoteThreshold) +
    (profile.requireFreshBassOnset === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.requireFreshBassOnset ? 0 : 1);
}

export interface ListenMatcherSweepProfile extends ListenMatcherThresholds {
  id: string;
  /** Threshold distance from the frozen discovery baseline. */
  distanceFromProduction: number;
}

export const LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS = [0.45, 0.50, 0.55, 0.60, 0.65] as const;
export const LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS = [0.35, 0.425, 0.50, 0.575, 0.65] as const;
export const LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS = [0.20, 0.275, 0.35, 0.425, 0.50] as const;
export const LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS = [0.90, 0.94, 0.97, 0.99] as const;
export const LISTEN_MATCHER_SWEEP_FRESH_BASS = [true, false] as const;

function stableThresholdId(value: number): string {
  return value.toFixed(3).replace(".", "p");
}

/** Stable historical sweep identifier. Existing reports depend on this format. */
function sweepProfileId(profile: ListenMatcherThresholds): string {
  return `o${stableThresholdId(profile.onsetThreshold)}-t${stableThresholdId(profile.targetNoteThreshold)}-a${stableThresholdId(profile.activeTargetThreshold)}-x${stableThresholdId(profile.extraNoteThreshold)}-b${profile.requireFreshBassOnset ? "1" : "0"}`;
}

export function generateListenMatcherSweepProfiles(): ListenMatcherSweepProfile[] {
  const profiles: ListenMatcherSweepProfile[] = [];
  for (const onsetThreshold of LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS) {
    for (const targetNoteThreshold of LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS) {
      for (const activeTargetThreshold of LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS) {
        for (const extraNoteThreshold of LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS) {
          for (const requireFreshBassOnset of LISTEN_MATCHER_SWEEP_FRESH_BASS) {
            const profile = {
              onsetThreshold,
              targetNoteThreshold,
              activeTargetThreshold,
              extraNoteThreshold,
              requireFreshBassOnset,
            };
            profiles.push({
              ...profile,
              id: sweepProfileId(profile),
              distanceFromProduction: profileDistanceFromBaseline(profile),
            });
          }
        }
      }
    }
  }
  return profiles;
}

export interface ListenThresholdSweepProfileResult {
  profile: ListenMatcherSweepProfile;
  eligible: boolean;
  rejectedBySafety: boolean;
  safety: ListenSequenceSafetySummary;
  independentMatchCount: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  completePassageCount: number;
  p95OrderedAdvanceLatencyMs: number | null;
  speedSummaries: ListenSequenceAggregateSummary[];
  familySpeedSummaries: ListenSequenceAggregateSummary[];
  nonSafetyDeltasFromProduction: Array<{
    intervalMs: number;
    independentMatchDelta: number;
    orderedAdvanceDelta: number;
    orderedPrefixDelta: number;
    completePassageDelta: number;
    p95OrderedAdvanceLatencyDeltaMs: number | null;
  }>;
  detailedRuns?: ListenSequenceRunResult[];
}

export interface ListenThresholdSweepResult {
  renderer: ListenBenchmarkRendererConfiguration;
  productionProfile: ListenMatcherThresholds;
  gridSize: number;
  profilesEvaluated: number;
  profilesRejectedBySafety: number;
  productionBaseline: ListenThresholdSweepProfileResult;
  candidates: ListenThresholdSweepProfileResult[];
  paretoFrontier: ListenThresholdSweepProfileResult[];
  recommendation: ListenThresholdSweepProfileResult;
  noSafeImprovement: boolean;
  replayParityVerified: true;
}

function sequenceForRun(run: ListenSequenceRunResult): MaterializedListenSequence {
  const definition = bundledListenSequences().find(({ id }) => id === run.sequenceId);
  if (!definition) throw new Error(`Cannot reconstruct benchmark sequence ${run.sequenceId}.`);
  return materializeListenSequence(definition, run.intervalMs);
}

function assertDiscoveryBaselineReplayParity(
  result: ListenSequenceBenchmarkResult,
): void {
  for (const originalRun of result.runs) {
    const sequence = sequenceForRun(originalRun);
    const replayed = replayListenSequenceTrace(
      sequence,
      originalRun.trace,
      originalRun.policy,
      LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
    );
    assertListenSequenceRunParity(
      `${originalRun.sequenceId} at ${originalRun.intervalMs} ms`,
      originalRun,
      replayed,
    );
  }
}

function thresholdProfileResult(
  result: ListenSequenceBenchmarkResult,
  profile: ListenMatcherSweepProfile,
  runs: readonly ListenSequenceRunResult[],
  production: ListenThresholdSweepProfileResult | null,
): ListenThresholdSweepProfileResult {
  const nonSafetyRuns = runs.filter(({ family }) => family !== "safety");
  const intervals = sortedUnique(nonSafetyRuns.map(({ intervalMs }) => intervalMs))
    .sort((left, right) => right - left);
  const speedSummaries = intervals.map((intervalMs) => aggregateListenSequenceRuns(
    nonSafetyRuns.filter((run) => run.intervalMs === intervalMs),
    intervalMs,
  ));
  const families = [...new Set(nonSafetyRuns.map(({ family }) => family))].sort();
  const familySpeedSummaries = intervals.flatMap((intervalMs) => families.flatMap((family) => {
    const selected = nonSafetyRuns.filter((run) => (
      run.intervalMs === intervalMs && run.family === family
    ));
    return selected.length === 0 ? [] : [aggregateListenSequenceRuns(selected, intervalMs, family)];
  }));
  const independentMatchCount = nonSafetyRuns.reduce(
    (total, run) => total + run.summary.independentMatchCount,
    0,
  );
  const orderedAdvanceCount = nonSafetyRuns.reduce(
    (total, run) => total + run.summary.orderedAdvanceCount,
    0,
  );
  const orderedPrefixCompleted = nonSafetyRuns.reduce(
    (total, run) => total + run.summary.orderedPrefixCompleted,
    0,
  );
  const completePassageCount = nonSafetyRuns.filter(({ summary }) => summary.complete).length;
  const orderedLatencies = nonSafetyRuns.flatMap((run) => run.events.flatMap((event) => (
    event.orderedAdvanced && event.orderedAdvanceLatencyMs !== null
      ? [event.orderedAdvanceLatencyMs]
      : []
  )));
  const profileResult: ListenThresholdSweepProfileResult = {
    profile,
    eligible: false,
    rejectedBySafety: false,
    safety: summarizeListenSequenceSafety(runs),
    independentMatchCount,
    orderedAdvanceCount,
    orderedPrefixCompleted,
    completePassageCount,
    p95OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.95),
    speedSummaries,
    familySpeedSummaries,
    nonSafetyDeltasFromProduction: production === null ? [] : speedSummaries.map((summary) => {
      const baseline = production.speedSummaries.find(({ intervalMs }) => (
        intervalMs === summary.intervalMs
      ));
      const baselinePrefix = baseline?.orderedPrefixCompleted ?? 0;
      const baselineComplete = baseline === undefined
        ? 0
        : baseline.completePassageRate * baseline.sequenceCount;
      const candidateComplete = summary.completePassageRate * summary.sequenceCount;
      return {
        intervalMs: summary.intervalMs,
        independentMatchDelta: summary.independentMatchCount - (baseline?.independentMatchCount ?? 0),
        orderedAdvanceDelta: summary.orderedAdvanceCount - (baseline?.orderedAdvanceCount ?? 0),
        orderedPrefixDelta: summary.orderedPrefixCompleted - baselinePrefix,
        completePassageDelta: candidateComplete - baselineComplete,
        p95OrderedAdvanceLatencyDeltaMs: summary.p95OrderedAdvanceLatencyMs === null ||
            baseline?.p95OrderedAdvanceLatencyMs === null || baseline === undefined
          ? null
          : summary.p95OrderedAdvanceLatencyMs - baseline.p95OrderedAdvanceLatencyMs,
      };
    }),
  };
  return profileResult;
}

function fastIndependentMatchCount(result: ListenThresholdSweepProfileResult): number {
  return result.speedSummaries
    .filter(({ intervalMs }) => (
      intervalMs === 500 || intervalMs === 1_000 / 3 || intervalMs === 250
    ))
    .reduce((total, summary) => total + summary.independentMatchCount, 0);
}

function thresholdProfileComparator(
  left: ListenThresholdSweepProfileResult,
  right: ListenThresholdSweepProfileResult,
): number {
  const leftFast = fastIndependentMatchCount(left);
  const rightFast = fastIndependentMatchCount(right);
  const leftLatency = left.p95OrderedAdvanceLatencyMs ?? Infinity;
  const rightLatency = right.p95OrderedAdvanceLatencyMs ?? Infinity;
  return right.independentMatchCount - left.independentMatchCount ||
    rightFast - leftFast ||
    right.orderedAdvanceCount - left.orderedAdvanceCount ||
    leftLatency - rightLatency ||
    left.profile.distanceFromProduction - right.profile.distanceFromProduction ||
    Number(right.profile.requireFreshBassOnset) - Number(left.profile.requireFreshBassOnset) ||
    left.profile.id.localeCompare(right.profile.id);
}

export function rankListenThresholdSweepCandidates(
  candidates: readonly ListenThresholdSweepProfileResult[],
): ListenThresholdSweepProfileResult[] {
  return [...candidates].sort(thresholdProfileComparator);
}

export function listenThresholdSweepParetoFrontier(
  candidates: readonly ListenThresholdSweepProfileResult[],
): ListenThresholdSweepProfileResult[] {
  const dominates = (left: ListenThresholdSweepProfileResult, right: ListenThresholdSweepProfileResult) => {
    const leftLatency = left.p95OrderedAdvanceLatencyMs ?? Infinity;
    const rightLatency = right.p95OrderedAdvanceLatencyMs ?? Infinity;
    const leftFast = fastIndependentMatchCount(left);
    const rightFast = fastIndependentMatchCount(right);
    const atLeastAsGood = left.independentMatchCount >= right.independentMatchCount &&
      leftFast >= rightFast &&
      left.orderedAdvanceCount >= right.orderedAdvanceCount &&
      leftLatency <= rightLatency &&
      left.profile.distanceFromProduction <= right.profile.distanceFromProduction;
    const strictlyBetter = left.independentMatchCount > right.independentMatchCount ||
      leftFast > rightFast ||
      left.orderedAdvanceCount > right.orderedAdvanceCount ||
      leftLatency < rightLatency ||
      left.profile.distanceFromProduction < right.profile.distanceFromProduction;
    return atLeastAsGood && strictlyBetter;
  };
  return candidates
    .filter((candidate) => !candidates.some((other) => other !== candidate && dominates(other, candidate)))
    .sort(thresholdProfileComparator);
}

/** Replays the retained stateful corpus against all 1,000 matcher profiles. */
export async function runListenThresholdSweep(
  result: ListenSequenceBenchmarkResult,
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  batchSize = 8,
): Promise<ListenThresholdSweepResult> {
  if (result.policy !== "current-matcher") {
    throw new Error("Threshold sweep requires the current matcher policy corpus.");
  }
  if (result.runs.some((run) => (run.trace.resetPlan?.mode ?? "stateful") !== "stateful")) {
    throw new Error("Threshold sweep accepts only stateful continuous traces.");
  }
  assertDiscoveryBaselineReplayParity(result);
  const replayCorpus = result.runs.map((run) => ({ run, sequence: sequenceForRun(run) }));
  const profiles = generateListenMatcherSweepProfiles();
  const baselineId = sweepProfileId(LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE);
  const productionProfile = profiles.find(({ id }) => id === baselineId) ?? {
    ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
    id: "production",
    distanceFromProduction: 0,
  };
  const productionRuns = replayCorpus.map(({ run, sequence }) => replayListenSequenceTrace(
    sequence,
    run.trace,
    run.policy,
    LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
  ));
  const productionBaseline = thresholdProfileResult(
    result,
    productionProfile,
    productionRuns,
    null,
  );
  productionBaseline.rejectedBySafety = !productionBaseline.safety.passed;
  const evaluations: ListenThresholdSweepProfileResult[] = [];
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const profileRuns = replayCorpus.map(({ run, sequence }) => replayListenSequenceTrace(
      sequence,
      run.trace,
      run.policy,
      profile,
    ));
    const evaluation = thresholdProfileResult(result, profile, profileRuns, productionBaseline);
    evaluation.rejectedBySafety = !evaluation.safety.passed;
    const independentImprovement = evaluation.independentMatchCount >
      productionBaseline.independentMatchCount;
    const independentAt1000 = evaluation.nonSafetyDeltasFromProduction
      .find(({ intervalMs }) => intervalMs === 1_000)?.independentMatchDelta ?? -Infinity;
    const aggregateOrderedImprovement = evaluation.orderedAdvanceCount >=
      productionBaseline.orderedAdvanceCount;
    evaluation.eligible = evaluation.safety.passed &&
      independentImprovement &&
      independentAt1000 >= 0 &&
      aggregateOrderedImprovement;
    evaluations.push(evaluation);
    if ((index + 1) % safeBatchSize === 0 || index + 1 === profiles.length) {
      onProgress(index + 1, profiles.length, `Profile ${index + 1} / ${profiles.length}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  const eligible = rankListenThresholdSweepCandidates(
    evaluations.filter(({ eligible }) => eligible),
  );
  const ranked = eligible.length > 0 ? eligible : [productionBaseline];
  const recommendation = ranked[0];
  const detailedProfiles = [productionBaseline, ...eligible.slice(0, 7)];
  const detailedById = new Map(detailedProfiles.map((candidate) => [candidate.profile.id, candidate]));
  for (const candidate of detailedProfiles) {
    const sourceRuns = candidate.profile.id === productionProfile.id
      ? productionRuns
      : replayCorpus.map(({ run, sequence }) => replayListenSequenceTrace(
        sequence,
        run.trace,
        run.policy,
        candidate.profile,
      ));
    candidate.detailedRuns = sourceRuns;
  }
  const paretoFrontierCandidates = eligible.length === 0
    ? [productionBaseline]
    : listenThresholdSweepParetoFrontier(eligible);
  const paretoFrontier = paretoFrontierCandidates.map((candidate) => (
    detailedById.get(candidate.profile.id) ?? candidate
  ));
  return {
    renderer: { ...result.renderer },
    productionProfile: { ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE },
    gridSize: profiles.length,
    profilesEvaluated: evaluations.length,
    profilesRejectedBySafety: evaluations.filter(({ rejectedBySafety }) => rejectedBySafety).length,
    productionBaseline,
    candidates: evaluations,
    paretoFrontier,
    recommendation,
    noSafeImprovement: eligible.length === 0,
    replayParityVerified: true,
  };
}
