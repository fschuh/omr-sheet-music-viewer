/**
 * Exploratory search over the 1,000-combination matcher threshold grid.
 *
 * The grid is deliberately independent of the production profile registry: the
 * sweep may test any parameter combination, including ones no shipped profile
 * would ever use. Its reference point is the frozen `baseline-v1` registry
 * entry rather than the mutable production-default pointer, so historical
 * discovery-corpus comparisons stay stable when the default changes.
 *
 * Two searches live here. The historical single-renderer sweep replays one
 * already-captured sequence corpus and keeps its measured results reproducible.
 * The multi-domain sweep below it captures the frozen discovery partition of
 * `listenTraceManifest` — both renderers, both pianos, dynamics, articulation —
 * and ranks profiles by that manifest's frozen weighting and metric order.
 */

import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import { bundledListenBenchmarkCases } from "./listenBenchmark";
import type { ListenMatcherThresholds } from "../listenMatcherProfiles";
import {
  LISTEN_BASELINE_PROFILE,
  assertListenSequenceRunParity,
  assertRecognitionTraceUnmutated,
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
} from "./listenBaselineParity";
import {
  aggregateListenSequenceRuns,
  bundledListenSequences,
  captureListenSequenceRun,
  courseClearArticulationDefinitions,
  materializeListenSequence,
  replayListenSequenceTrace,
  withOnlineAmtBenchmarkSession,
  type ListenRecognitionTrace,
  type ListenSequenceAdvancementObservation,
  type ListenSequenceAggregateSummary,
  type ListenSequenceBenchmarkResult,
  type ListenSequenceRunResult,
  type ListenSequenceDefinition,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import { findListenRoundTwoFixtureMember } from "./listenRoundTwoFixtures";
import { captureCourseClearDynamicsRun } from "./listenDynamicsBenchmark";
import {
  replayListenSafetyRegressions,
  summarizeListenSafety,
  type ListenSafetyRegressionSummary,
  type ListenSafetySummary,
} from "./listenSafetyRegression";
import {
  DeterministicHasher,
  LISTEN_CANDIDATE_METRIC_ORDER,
  LISTEN_TRACE_MANIFEST,
  assertValidListenTraceManifest,
  listenCandidateParetoFrontier,
  listenTraceDomainMeans,
  listenTraceCorpusHash,
  listenTraceManifestHash,
  listenTraceWeightsForPartition,
  rankListenCandidates,
  type ListenCandidateMetricKey,
  type ListenCandidateMetrics,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
  type ListenTraceWeight,
} from "./listenTraceManifest";

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
  safety: ListenSafetySummary;
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
    safety: summarizeListenSafety(runs, profile),
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

/* ------------------------------------------------------------------------- *
 * Multi-domain sweep over the frozen discovery partition
 * ------------------------------------------------------------------------- */

/**
 * One captured manifest trace, held only while every grid profile replays it.
 *
 * The corpus is far too large to retain in full, so the multi-domain sweep
 * captures one trace, replays all 1,000 profiles against that exact object, and
 * releases it before rendering the next one. Per-run metrics are what survive,
 * which is also what the manifest's hierarchical weighting consumes.
 */
export interface ListenMultiDomainCapture {
  descriptor: ListenTraceDescriptor;
  sequence: MaterializedListenSequence;
  trace: ListenRecognitionTrace;
  /** Trace hash at capture, re-checked after the profile loop has finished. */
  recognitionHash: string;
  /** Survives a fresh browser process, unlike the raw PCM and trace hashes. */
  recognitionStructureHash: string;
  /** The capture-time production replay, already parity-checked against baseline-v1. */
  baselineRun: ListenSequenceRunResult;
}

export type ListenMultiDomainCaptureFn = (
  descriptor: ListenTraceDescriptor,
) => Promise<ListenMultiDomainCapture>;

/** Everything one profile's replay of one trace contributes to the search. */
export interface ListenMultiDomainRunMetrics {
  traceId: string;
  expectedEventCount: number;
  independentMatchCount: number;
  independentRate: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  orderedPrefixRate: number;
  complete: boolean;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  incompleteCarriedBassAdvances: number;
  lateAdvanceCount: number;
  /** Summed target distance from each late advance's causing attack. */
  lateAdvanceSourceDistanceTotal: number;
  /** Summed delay from each late target's own attack to its advancement. */
  lateAdvanceAttributionDelayTotalMs: number;
  p95OrderedAdvanceLatencyMs: number | null;
}

/** One value reported at every level of the manifest's weighting hierarchy. */
export interface ListenMultiDomainBreakdown {
  overall: number | null;
  renderers: Array<{ key: string; value: number }>;
  suites: Array<{ key: string; value: number }>;
  domains: Array<{ domainKey: string; value: number; traceCount: number }>;
}

/**
 * The compact, auditable contribution of one leaf domain to one grid profile.
 *
 * Task 08 retained this detail only for its frontier. Task 24 needs it for all
 * 1,000 rows so a domain oracle is selected from the complete globally-safe
 * grid rather than from a frontier chosen by the aggregate metric order.
 */
export interface ListenMultiDomainLeafMetrics {
  domainKey: string;
  traceCount: number;
  expectedEventCount: number;
  independentMatchCount: number;
  independentRate: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  orderedPrefixRate: number;
  completePassageCount: number;
  completePassageRate: number;
  lateAdvanceCount: number;
  lateAdvanceSourceDistance: number | null;
  attributionDelayMs: number | null;
  p95LatencyMs: number | null;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
}

export interface ListenMultiDomainSafetyVerdict {
  passed: boolean;
  rejectionReasons: string[];
  /** Dedicated safety families, summed over both renderers and all six speeds. */
  dedicatedFalseAdvanceCount: number;
  dedicatedSkippedAdvanceCount: number;
  dedicatedDuplicateAdvanceCount: number;
  dedicatedIncompleteCarriedBassAdvances: number;
  /** Regression-only measured runs outside the dedicated families, such as `v05`. */
  regressionRunFalseAdvanceCount: number;
  regressionRunSkippedAdvanceCount: number;
  regressionRunDuplicateAdvanceCount: number;
  regressionRunLateAdvanceCount: number;
  /** Discovery traces where this profile is unsafe in a way baseline-v1 is not. */
  discoveryRegressions: Array<{
    traceId: string;
    falseAdvanceDelta: number;
    skippedAdvanceDelta: number;
    duplicateAdvanceDelta: number;
  }>;
  regressions: ListenSafetyRegressionSummary;
}

export interface ListenMultiDomainProfileResult {
  profile: ListenMatcherSweepProfile;
  /** The frozen-order metric vector the manifest's comparator ranks. */
  metrics: ListenCandidateMetrics;
  safety: ListenMultiDomainSafetyVerdict;
  independentRate: ListenMultiDomainBreakdown;
  orderedPrefixRate: ListenMultiDomainBreakdown;
  completePassageRate: ListenMultiDomainBreakdown;
  /** Independent-rate change from baseline-v1 at every level. Cascade-free. */
  independentRateDeltaFromBaseline: ListenMultiDomainBreakdown;
  /** Leaf domains whose independent recognition improves on baseline-v1. */
  improvedDomainCount: number;
  worsenedDomainCount: number;
  /** Retained for every row by the Task 24 detail re-export. */
  leafDomains: ListenMultiDomainLeafMetrics[];
  totals: {
    scoredTraceCount: number;
    expectedEventCount: number;
    independentMatchCount: number;
    orderedAdvanceCount: number;
    orderedPrefixCompleted: number;
    completePassageCount: number;
    lateAdvanceCount: number;
    falseAdvanceCount: number;
    skippedAdvanceCount: number;
    duplicateAdvanceCount: number;
  };
  /** Retained for the baseline and the frontier only; undefined elsewhere. */
  runs?: ListenMultiDomainRunMetrics[];
}

export interface ListenMultiDomainSweepResult {
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    traceCount: number;
    capturedTraceCount: number;
    scoredTraceCount: number;
    /** Absolute safety rows actually captured and applied in this sweep. */
    regressionRunCount: number;
    /** Zero-weight discovery negatives compared trace-for-trace with baseline-v1. */
    baselineRelativeSafetyRunCount: number;
  };
  renderers: ListenBenchmarkRendererConfiguration[];
  baselineProfile: ListenMatcherThresholds;
  gridSize: number;
  profilesEvaluated: number;
  profilesRejectedBySafety: number;
  captures: Array<{
    traceId: string;
    partition: string;
    suite: string;
    domainKey: string;
    renderer: string;
    weight: number;
    recognitionStructureHash: string;
    frameCount: number;
    expectedEventCount: number;
  }>;
  baseline: ListenMultiDomainProfileResult;
  candidates: ListenMultiDomainProfileResult[];
  paretoFrontier: ListenMultiDomainProfileResult[];
  /** The safe Pareto tradeoffs that differ materially from one another. */
  selected: ListenMultiDomainProfileResult[];
  selectionRule: string;
  noSafeImprovement: boolean;
  replayParityVerified: true;
}

/** Traces the multi-domain sweep renders and recognizes, in manifest order. */
export function listenMultiDomainSweepTraces(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor[] {
  return manifest.traces.filter((trace) => (
    (trace.partition === "discovery" || trace.partition === "regression-only") &&
    trace.evidenceRole !== "diagnostic" &&
    // The committed regressions are replayed from their pinned frames by
    // `replayListenSafetyRegressions`; they have no audio to render.
    trace.suite !== "safety-regression"
  ));
}

export interface ListenMultiDomainSafetyPopulations {
  /** Dedicated safety passages, held to an absolute zero-event rule. */
  dedicatedSafetyTraceIds: readonly string[];
  /** Other captured regression-only safety rows, also held to absolute zero. */
  regressionRunTraceIds: readonly string[];
  /** Captured discovery rows compared trace-for-trace against baseline-v1. */
  baselineRelativeTraceIds: readonly string[];
  /** The zero-weight paired negatives inside the baseline-relative population. */
  baselineRelativeSafetyTraceIds: readonly string[];
}

/**
 * Freezes the three applied safety populations before replay. Confirmation is
 * absent by construction, and every declared identifier must be in the capture
 * list so a gate can never silently shrink to the rows that happened to run.
 */
export function listenMultiDomainSafetyPopulations(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
  capturedTraces: readonly ListenTraceDescriptor[] = listenMultiDomainSweepTraces(manifest),
): ListenMultiDomainSafetyPopulations {
  const capturedIds = new Set(capturedTraces.map(({ id }) => id));
  const dedicatedSafetyTraceIds = manifest.traces
    .filter(({ partition, evidenceRole, suite, sequenceFamily }) => (
      partition === "regression-only" &&
      evidenceRole === "safety" &&
      suite === "sequence" &&
      sequenceFamily === "safety"
    ))
    .map(({ id }) => id);
  const dedicated = new Set(dedicatedSafetyTraceIds);
  const regressionRunTraceIds = manifest.traces
    .filter(({ id, partition, evidenceRole, suite }) => (
      partition === "regression-only" &&
      evidenceRole === "safety" &&
      !dedicated.has(id) &&
      suite !== "safety-regression"
    ))
    .map(({ id }) => id);
  const baselineRelativeTraceIds = manifest.traces
    .filter(({ partition, evidenceRole, suite }) => (
      partition === "discovery" &&
      evidenceRole !== "diagnostic" &&
      suite !== "safety-regression"
    ))
    .map(({ id }) => id);
  const baselineRelativeSafetyTraceIds = manifest.traces
    .filter(({ partition, evidenceRole }) => (
      partition === "discovery" && evidenceRole === "safety"
    ))
    .map(({ id }) => id);
  for (const [label, traceIds] of [
    ["dedicated safety", dedicatedSafetyTraceIds],
    ["regression-run safety", regressionRunTraceIds],
    ["baseline-relative discovery", baselineRelativeTraceIds],
  ] as const) {
    const missing = traceIds.filter((id) => !capturedIds.has(id));
    if (missing.length > 0) {
      throw new Error(`${label} population declares uncaptured rows: ${missing.join(", ")}`);
    }
  }
  return {
    dedicatedSafetyTraceIds: Object.freeze(dedicatedSafetyTraceIds),
    regressionRunTraceIds: Object.freeze(regressionRunTraceIds),
    baselineRelativeTraceIds: Object.freeze(baselineRelativeTraceIds),
    baselineRelativeSafetyTraceIds: Object.freeze(baselineRelativeSafetyTraceIds),
  };
}

function isolatedDefinitionForTrace(descriptor: ListenTraceDescriptor): ListenSequenceDefinition {
  const index = Number(descriptor.id.split("/").at(-1)) - 1;
  const benchmarkCase = bundledListenBenchmarkCases()[index];
  if (!benchmarkCase) throw new Error(`${descriptor.id} names no isolated fixture.`);
  const expectedAdvance = descriptor.caseKind === "correct";
  return {
    id: descriptor.sourceId,
    family: benchmarkCase.fixtureGroup ?? "isolated",
    label: descriptor.id,
    targets: [benchmarkCase.target],
    attacks: [{
      at: 0,
      targetIndex: 0,
      notes: benchmarkCase.played,
      expectedAdvance,
      targetStart: expectedAdvance ? undefined : true,
    }],
  };
}

function rendererForListenTrace(
  descriptor: ListenTraceDescriptor,
): ListenBenchmarkRendererConfiguration {
  const renderer = descriptor.rendererKey === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
  if (renderer.version !== descriptor.renderer) {
    throw new Error(
      `${descriptor.id} names renderer ${descriptor.renderer}, but ${descriptor.rendererKey} ` +
      `is ${renderer.version}.`,
    );
  }
  return renderer;
}

/**
 * Renders, recognizes, and baseline-replays one manifest trace on the capture
 * path its own suite already uses, so a sweep row cannot diverge from the suite
 * result it claims to describe.
 */
export async function captureListenMultiDomainTrace(
  descriptor: ListenTraceDescriptor,
  session: SequenceInferenceSession,
): Promise<ListenMultiDomainCapture> {
  // The confirmation partition is held back from every selection path, and that
  // rule is enforced here rather than only by the filter that builds the capture
  // list. A descriptor that reaches this function — from a future caller, a
  // narrowed rerun, or a relabelled manifest row — must fail rather than quietly
  // become search evidence, because a partition read once cannot be unread.
  if (descriptor.partition === "confirmation") {
    throw new Error(
      `${descriptor.id} is a confirmation trace, which the selection path never captures.`,
    );
  }
  const renderer = rendererForListenTrace(descriptor);
  if (descriptor.suite === "isolated") {
    if (descriptor.piano === null || descriptor.layer === null) {
      throw new Error(`${descriptor.id} names no piano layer.`);
    }
    const captured = await captureListenSequenceRun({
      definition: isolatedDefinitionForTrace(descriptor),
      intervalMs: 1_000,
      session,
      renderer,
      piano: descriptor.piano,
      layer: descriptor.layer,
    });
    return {
      descriptor,
      sequence: captured.sequence,
      trace: captured.trace,
      recognitionHash: captured.recognitionHash,
      recognitionStructureHash: listenRecognitionStructureHash(captured.trace),
      baselineRun: captured.run,
    };
  }
  if (descriptor.suite === "round-two-paired") {
    if (descriptor.pairedGroupId === null || descriptor.pairedCaseRole === null ||
        descriptor.intervalMs === null || descriptor.piano === null || descriptor.layer === null) {
      throw new Error(`${descriptor.id} has incomplete paired-fixture metadata.`);
    }
    const authored = findListenRoundTwoFixtureMember(
      descriptor.pairedGroupId,
      descriptor.pairedCaseRole,
    );
    if (!authored || authored.member.definition.id !== descriptor.sourceId) {
      throw new Error(`${descriptor.id} names no authored paired fixture.`);
    }
    const captured = await captureListenSequenceRun({
      definition: authored.member.definition,
      intervalMs: descriptor.intervalMs,
      session,
      renderer,
      piano: descriptor.piano,
      layer: descriptor.layer,
    });
    return {
      descriptor,
      sequence: captured.sequence,
      trace: captured.trace,
      recognitionHash: captured.recognitionHash,
      recognitionStructureHash: listenRecognitionStructureHash(captured.trace),
      baselineRun: captured.run,
    };
  }
  if (descriptor.suite === "sequence" || descriptor.suite === "articulation") {
    const definitions = descriptor.suite === "sequence"
      ? bundledListenSequences()
      : courseClearArticulationDefinitions();
    const definition = definitions.find(({ id }) => id === descriptor.sourceId);
    if (!definition) throw new Error(`${descriptor.id} names the unknown passage ${descriptor.sourceId}.`);
    if (descriptor.intervalMs === null) throw new Error(`${descriptor.id} has no attack interval.`);
    const captured = await captureListenSequenceRun({
      definition,
      intervalMs: descriptor.intervalMs,
      session,
      renderer,
    });
    return {
      descriptor,
      sequence: captured.sequence,
      trace: captured.trace,
      recognitionHash: captured.recognitionHash,
      recognitionStructureHash: listenRecognitionStructureHash(captured.trace),
      baselineRun: captured.run,
    };
  }
  if (descriptor.suite === "dynamics-constant" || descriptor.suite === "dynamics-mixed") {
    if (descriptor.piano === null) throw new Error(`${descriptor.id} names no piano.`);
    const { sequence, run } = await captureCourseClearDynamicsRun(
      { session, renderer },
      descriptor.piano,
      descriptor.suite === "dynamics-constant" ? descriptor.layer : null,
    );
    return {
      descriptor,
      sequence,
      trace: run.recognition.trace,
      recognitionHash: listenRecognitionTraceHash(run.recognition.trace),
      recognitionStructureHash: listenRecognitionStructureHash(run.recognition.trace),
      baselineRun: run.recognition,
    };
  }
  throw new Error(`The multi-domain sweep cannot capture ${descriptor.suite} trace ${descriptor.id}.`);
}

/**
 * The carried-bass rule the reusable sequence safety summary applies: the second
 * physical attack of `carried-bass-safety` plays the upper voices over a still
 * sounding bass, so any target it advances is an incomplete carried-bass advance.
 */
function incompleteCarriedBassAdvances(run: ListenSequenceRunResult): number {
  if (run.sequenceId !== "carried-bass-safety") return 0;
  return run.attacks
    .filter(({ index }) => index === 1)
    .reduce((total, attack) => total + attack.advancementTargetIndices.length, 0);
}

function multiDomainRunMetrics(
  traceId: string,
  sequence: MaterializedListenSequence,
  run: ListenSequenceRunResult,
  observations: readonly ListenSequenceAdvancementObservation[],
): ListenMultiDomainRunMetrics {
  const expectedEventCount = run.summary.expectedEventCount;
  let lateAdvanceSourceDistanceTotal = 0;
  let lateAdvanceAttributionDelayTotalMs = 0;
  for (const event of run.events) {
    if (!event.lateAdvance) continue;
    const observation = observations.find(({ targetIndex }) => targetIndex === event.index);
    if (!observation) continue;
    const sourceAttack = observation.sourceAttackIndex === null
      ? null
      : sequence.attacks[observation.sourceAttackIndex] ?? null;
    if (sourceAttack) {
      lateAdvanceSourceDistanceTotal += Math.abs(sourceAttack.targetIndex - event.index);
    }
    lateAdvanceAttributionDelayTotalMs += observation.atMs - event.scheduledAttackTimeMs;
  }
  return {
    traceId,
    expectedEventCount,
    independentMatchCount: run.summary.independentMatchCount,
    independentRate: run.summary.independentMatchRate,
    orderedAdvanceCount: run.summary.orderedAdvanceCount,
    orderedPrefixCompleted: run.summary.orderedPrefixCompleted,
    orderedPrefixRate: expectedEventCount === 0
      ? 0
      : run.summary.orderedPrefixCompleted / expectedEventCount,
    complete: run.summary.complete,
    falseAdvanceCount: run.summary.falseAdvanceCount,
    skippedAdvanceCount: run.summary.skippedAdvanceCount,
    duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
    incompleteCarriedBassAdvances: incompleteCarriedBassAdvances(run),
    lateAdvanceCount: run.summary.lateAdvanceCount,
    lateAdvanceSourceDistanceTotal,
    lateAdvanceAttributionDelayTotalMs,
    p95OrderedAdvanceLatencyMs: percentile(
      run.events.flatMap((event) => (
        event.orderedAdvanced && event.orderedAdvanceLatencyMs !== null
          ? [event.orderedAdvanceLatencyMs]
          : []
      )),
      0.95,
    ),
  };
}

function meanOf(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function groupedMeans(
  entries: ReadonlyArray<{ key: string; value: number }>,
): Array<{ key: string; value: number }> {
  const keys = [...new Set(entries.map(({ key }) => key))].sort();
  return keys.flatMap((key) => {
    const value = meanOf(entries.filter((entry) => entry.key === key).map((entry) => entry.value));
    return value === null ? [] : [{ key, value }];
  });
}

/**
 * One metric at every level of `renderer -> suite -> domain -> run`.
 *
 * Each level is the unweighted mean of the level below it, which is exactly the
 * manifest's hierarchical equal weighting when every leaf has a value, and
 * degrades the same way `weightedListenTraceMean` does when one does not: the
 * missing leaf is dropped rather than counted as a zero. Ranking reads
 * `overall`, so the number that decides the search is the same number the
 * per-renderer and per-suite tables are built from.
 */
function multiDomainBreakdown(
  weights: readonly ListenTraceWeight[],
  valueForTrace: (traceId: string) => number | null,
): ListenMultiDomainBreakdown {
  const domains = listenTraceDomainMeans(weights, valueForTrace);
  const suites = groupedMeans(domains.map(({ domainKey, value }) => ({
    key: domainKey.split("/").slice(0, 2).join("/"),
    value,
  })));
  const renderers = groupedMeans(suites.map(({ key, value }) => ({
    key: key.split("/")[0],
    value,
  })));
  return {
    overall: meanOf(renderers.map(({ value }) => value)),
    renderers,
    suites,
    domains,
  };
}

function subtractBreakdown(
  candidate: ListenMultiDomainBreakdown,
  baseline: ListenMultiDomainBreakdown,
): ListenMultiDomainBreakdown {
  const difference = (left: number | null, right: number | null) => (
    left === null || right === null ? null : left - right
  );
  const baselineDomains = new Map(baseline.domains.map(({ domainKey, value }) => [domainKey, value]));
  const baselineSuites = new Map(baseline.suites.map(({ key, value }) => [key, value]));
  const baselineRenderers = new Map(baseline.renderers.map(({ key, value }) => [key, value]));
  return {
    overall: difference(candidate.overall, baseline.overall),
    renderers: candidate.renderers.map(({ key, value }) => ({
      key,
      value: value - (baselineRenderers.get(key) ?? 0),
    })),
    suites: candidate.suites.map(({ key, value }) => ({
      key,
      value: value - (baselineSuites.get(key) ?? 0),
    })),
    domains: candidate.domains.map(({ domainKey, value, traceCount }) => ({
      domainKey,
      value: value - (baselineDomains.get(domainKey) ?? 0),
      traceCount,
    })),
  };
}

function worstDomainValue(breakdown: ListenMultiDomainBreakdown): number | null {
  if (breakdown.domains.length === 0) return null;
  return breakdown.domains.reduce((worst, candidate) => (
    candidate.value < worst.value ||
      (candidate.value === worst.value && candidate.domainKey < worst.domainKey)
      ? candidate
      : worst
  )).value;
}

/**
 * Finds newly unsafe events on discovery rows, including zero-weight paired
 * negatives. A candidate must have the same baseline row for every declared
 * identifier; missing comparison evidence is an error, not an empty result.
 */
export function listenBaselineRelativeSafetyRegressions(
  runs: readonly ListenMultiDomainRunMetrics[],
  baselineRuns: readonly ListenMultiDomainRunMetrics[],
  traceIds: ReadonlySet<string>,
): ListenMultiDomainSafetyVerdict["discoveryRegressions"] {
  const candidateByTrace = new Map(runs.map((entry) => [entry.traceId, entry]));
  const baselineByTrace = new Map(baselineRuns.map((entry) => [entry.traceId, entry]));
  const regressions: ListenMultiDomainSafetyVerdict["discoveryRegressions"] = [];
  for (const traceId of traceIds) {
    const entry = candidateByTrace.get(traceId);
    const reference = baselineByTrace.get(traceId);
    if (!entry || !reference) {
      throw new Error(`Baseline-relative safety row ${traceId} is missing from a replay.`);
    }
    const falseAdvanceDelta = entry.falseAdvanceCount - reference.falseAdvanceCount;
    const skippedAdvanceDelta = entry.skippedAdvanceCount - reference.skippedAdvanceCount;
    const duplicateAdvanceDelta = entry.duplicateAdvanceCount - reference.duplicateAdvanceCount;
    if (falseAdvanceDelta > 0 || skippedAdvanceDelta > 0 || duplicateAdvanceDelta > 0) {
      regressions.push({
        traceId,
        falseAdvanceDelta,
        skippedAdvanceDelta,
        duplicateAdvanceDelta,
      });
    }
  }
  return regressions;
}

interface MultiDomainAggregationInput {
  profile: ListenMatcherSweepProfile;
  runs: readonly ListenMultiDomainRunMetrics[];
  scoringWeights: readonly ListenTraceWeight[];
  dedicatedSafetyTraceIds: ReadonlySet<string>;
  regressionRunTraceIds: ReadonlySet<string>;
  baselineRelativeTraceIds: ReadonlySet<string>;
  scoredTraceIds: ReadonlySet<string>;
  baseline: ListenMultiDomainProfileResult | null;
}

export function listenMultiDomainLeafMetrics(
  runs: readonly ListenMultiDomainRunMetrics[],
  scoringWeights: readonly ListenTraceWeight[],
): ListenMultiDomainLeafMetrics[] {
  const byTrace = new Map(runs.map((run) => [run.traceId, run]));
  const scoredWeights = scoringWeights.filter(({ weight }) => weight > 0);
  const domainKeys = [...new Set(scoredWeights.map(({ domainKey }) => domainKey))].sort();
  return domainKeys.map((domainKey): ListenMultiDomainLeafMetrics => {
    const domainRuns = scoredWeights
      .filter((weight) => weight.domainKey === domainKey)
      .flatMap(({ traceId }) => {
        const run = byTrace.get(traceId);
        return run === undefined ? [] : [run];
      });
    if (domainRuns.length === 0) {
      throw new Error(`The scored leaf domain ${domainKey} has no replay rows.`);
    }
    const sum = (field: keyof ListenMultiDomainRunMetrics) => domainRuns.reduce(
      (total, run) => total + Number(run[field]),
      0,
    );
    const lateAdvanceCount = sum("lateAdvanceCount");
    return {
      domainKey,
      traceCount: domainRuns.length,
      expectedEventCount: sum("expectedEventCount"),
      independentMatchCount: sum("independentMatchCount"),
      // Preserve the manifest's run-equal leaf weighting. Event-count ratios
      // remain available from the adjacent exact counts but do not replace it.
      independentRate: meanOf(domainRuns.map(({ independentRate }) => independentRate)) ?? 0,
      orderedAdvanceCount: sum("orderedAdvanceCount"),
      orderedPrefixCompleted: sum("orderedPrefixCompleted"),
      orderedPrefixRate: meanOf(domainRuns.map(({ orderedPrefixRate }) => orderedPrefixRate)) ?? 0,
      completePassageCount: domainRuns.filter(({ complete }) => complete).length,
      completePassageRate: meanOf(domainRuns.map(({ complete }) => complete ? 1 : 0)) ?? 0,
      lateAdvanceCount,
      lateAdvanceSourceDistance: lateAdvanceCount === 0
        ? null
        : sum("lateAdvanceSourceDistanceTotal") / lateAdvanceCount,
      attributionDelayMs: lateAdvanceCount === 0
        ? null
        : sum("lateAdvanceAttributionDelayTotalMs") / lateAdvanceCount,
      p95LatencyMs: meanOf(domainRuns.flatMap(({ p95OrderedAdvanceLatencyMs }) => (
        p95OrderedAdvanceLatencyMs === null ? [] : [p95OrderedAdvanceLatencyMs]
      ))),
      falseAdvanceCount: sum("falseAdvanceCount"),
      skippedAdvanceCount: sum("skippedAdvanceCount"),
      duplicateAdvanceCount: sum("duplicateAdvanceCount"),
    };
  });
}

/**
 * Safety is a hard constraint evaluated over three separate populations, none of
 * which may be traded for a better score.
 *
 * The dedicated families and the regression-only runs must be clean outright.
 * Discovery traces are compared against `baseline-v1` on the same trace instead,
 * whether they score or are zero-weight paired negatives. The discovery corpus
 * contains known baseline false advances, and an absolute rule there would
 * reject the incumbent before ranking or pretend the measured event did not exist.
 */
function multiDomainSafetyVerdict(
  input: MultiDomainAggregationInput,
): ListenMultiDomainSafetyVerdict {
  const { profile, runs, baseline } = input;
  const rejectionReasons: string[] = [];
  const dedicated = runs.filter(({ traceId }) => input.dedicatedSafetyTraceIds.has(traceId));
  const regressionRuns = runs.filter(({ traceId }) => input.regressionRunTraceIds.has(traceId));
  const sum = (
    entries: readonly ListenMultiDomainRunMetrics[],
    field: keyof ListenMultiDomainRunMetrics,
  ) => entries.reduce((total, entry) => total + Number(entry[field]), 0);
  const dedicatedFalseAdvanceCount = sum(dedicated, "falseAdvanceCount");
  const dedicatedSkippedAdvanceCount = sum(dedicated, "skippedAdvanceCount");
  const dedicatedDuplicateAdvanceCount = sum(dedicated, "duplicateAdvanceCount");
  const dedicatedIncompleteCarriedBassAdvances = sum(dedicated, "incompleteCarriedBassAdvances");
  if (!profile.requireFreshBassOnset) {
    rejectionReasons.push("fresh-bass-not-required");
  }
  if (dedicatedFalseAdvanceCount > 0) rejectionReasons.push("dedicated-false-advance");
  if (dedicatedSkippedAdvanceCount > 0) rejectionReasons.push("dedicated-skipped-advance");
  if (dedicatedDuplicateAdvanceCount > 0) rejectionReasons.push("dedicated-duplicate-advance");
  if (dedicatedIncompleteCarriedBassAdvances > 0) {
    rejectionReasons.push("dedicated-incomplete-carried-bass");
  }
  const regressionRunFalseAdvanceCount = sum(regressionRuns, "falseAdvanceCount");
  const regressionRunSkippedAdvanceCount = sum(regressionRuns, "skippedAdvanceCount");
  const regressionRunDuplicateAdvanceCount = sum(regressionRuns, "duplicateAdvanceCount");
  if (
    regressionRunFalseAdvanceCount > 0 ||
    regressionRunSkippedAdvanceCount > 0 ||
    regressionRunDuplicateAdvanceCount > 0
  ) {
    rejectionReasons.push("regression-run-unsafe");
  }
  const discoveryRegressions = baseline === null
    ? []
    : listenBaselineRelativeSafetyRegressions(
        runs,
        baseline.runs ?? [],
        input.baselineRelativeTraceIds,
      );
  if (discoveryRegressions.length > 0) rejectionReasons.push("discovery-safety-regression");
  const regressions = replayListenSafetyRegressions(profile, profile.id);
  if (!regressions.passed) rejectionReasons.push("committed-regression");
  return {
    passed: rejectionReasons.length === 0,
    rejectionReasons,
    dedicatedFalseAdvanceCount,
    dedicatedSkippedAdvanceCount,
    dedicatedDuplicateAdvanceCount,
    dedicatedIncompleteCarriedBassAdvances,
    regressionRunFalseAdvanceCount,
    regressionRunSkippedAdvanceCount,
    regressionRunDuplicateAdvanceCount,
    regressionRunLateAdvanceCount: sum(regressionRuns, "lateAdvanceCount"),
    discoveryRegressions,
    regressions,
  };
}

function aggregateMultiDomainProfile(
  input: MultiDomainAggregationInput,
): ListenMultiDomainProfileResult {
  const byTrace = new Map(input.runs.map((entry) => [entry.traceId, entry]));
  const scored = input.runs.filter(({ traceId }) => input.scoredTraceIds.has(traceId));
  const value = (field: (entry: ListenMultiDomainRunMetrics) => number | null) => (
    (traceId: string) => {
      const entry = byTrace.get(traceId);
      return entry === undefined ? null : field(entry);
    }
  );
  const independentRate = multiDomainBreakdown(
    input.scoringWeights,
    value((entry) => entry.independentRate),
  );
  const orderedPrefixRate = multiDomainBreakdown(
    input.scoringWeights,
    value((entry) => entry.orderedPrefixRate),
  );
  const completePassageRate = multiDomainBreakdown(
    input.scoringWeights,
    value((entry) => entry.complete ? 1 : 0),
  );
  const lateAdvanceBurden = multiDomainBreakdown(
    input.scoringWeights,
    value((entry) => entry.lateAdvanceCount),
  );
  const latency = multiDomainBreakdown(
    input.scoringWeights,
    value((entry) => entry.p95OrderedAdvanceLatencyMs),
  );
  const lateAdvanceCount = scored.reduce((total, entry) => total + entry.lateAdvanceCount, 0);
  const safety = multiDomainSafetyVerdict(input);
  const metrics: ListenCandidateMetrics = {
    profileId: input.profile.id,
    safe: safety.passed,
    worstDomainIndependentRate: worstDomainValue(independentRate),
    equalDomainIndependentRate: independentRate.overall,
    orderedPrefixRate: orderedPrefixRate.overall,
    completePassageRate: completePassageRate.overall,
    lateAdvanceCount: lateAdvanceBurden.overall,
    lateAdvanceSourceDistance: lateAdvanceCount === 0
      ? 0
      : scored.reduce((total, entry) => total + entry.lateAdvanceSourceDistanceTotal, 0) /
        lateAdvanceCount,
    attributionDelayMs: lateAdvanceCount === 0
      ? 0
      : scored.reduce((total, entry) => total + entry.lateAdvanceAttributionDelayTotalMs, 0) /
        lateAdvanceCount,
    p95LatencyMs: latency.overall,
    distanceFromBaseline: input.profile.distanceFromProduction,
  };
  const independentRateDeltaFromBaseline = input.baseline === null
    ? { overall: 0, renderers: [], suites: [], domains: [] }
    : subtractBreakdown(independentRate, input.baseline.independentRate);
  return {
    profile: input.profile,
    metrics,
    safety,
    independentRate,
    orderedPrefixRate,
    completePassageRate,
    independentRateDeltaFromBaseline,
    improvedDomainCount: independentRateDeltaFromBaseline.domains
      .filter(({ value: delta }) => delta > 0).length,
    worsenedDomainCount: independentRateDeltaFromBaseline.domains
      .filter(({ value: delta }) => delta < 0).length,
    leafDomains: listenMultiDomainLeafMetrics(input.runs, input.scoringWeights),
    totals: {
      scoredTraceCount: scored.length,
      expectedEventCount: scored.reduce((total, entry) => total + entry.expectedEventCount, 0),
      independentMatchCount: scored.reduce((total, entry) => total + entry.independentMatchCount, 0),
      orderedAdvanceCount: scored.reduce((total, entry) => total + entry.orderedAdvanceCount, 0),
      orderedPrefixCompleted: scored.reduce(
        (total, entry) => total + entry.orderedPrefixCompleted,
        0,
      ),
      completePassageCount: scored.filter(({ complete }) => complete).length,
      lateAdvanceCount,
      falseAdvanceCount: input.runs.reduce((total, entry) => total + entry.falseAdvanceCount, 0),
      skippedAdvanceCount: input.runs.reduce((total, entry) => total + entry.skippedAdvanceCount, 0),
      duplicateAdvanceCount: input.runs.reduce(
        (total, entry) => total + entry.duplicateAdvanceCount,
        0,
      ),
    },
    runs: [...input.runs],
  };
}

/**
 * How much better one frozen metric has to be before a second candidate is worth
 * shipping alongside the first.
 *
 * The Pareto frontier is a mathematical object: a profile enters it by being
 * better by 1e-9 on one metric. A candidate registry is a product decision, and
 * carrying several profiles that differ by a hundredth of an event costs later
 * validation, live trials, and calibration sessions without offering the player
 * a different tradeoff. These margins are the point at which a difference is
 * worth that cost, and they are declared before the search runs.
 */
export const LISTEN_MULTIDOMAIN_MATERIAL_MARGINS:
  Readonly<Record<ListenCandidateMetricKey, number>> = Object.freeze({
    worstDomainIndependentRate: 0.01,
    equalDomainIndependentRate: 0.005,
    orderedPrefixRate: 0.01,
    completePassageRate: 0.02,
    lateAdvanceCount: 0.05,
    lateAdvanceSourceDistance: 0.25,
    attributionDelayMs: 50,
    p95LatencyMs: 10,
    distanceFromBaseline: 0.05,
  });

/** A candidate set larger than this is a matrix nobody can validate live. */
export const LISTEN_MULTIDOMAIN_MAX_CANDIDATES = 4;

export const LISTEN_MULTIDOMAIN_SELECTION_RULE =
  "Rank the safe Pareto frontier in the manifest's frozen metric order, keep the leader, then " +
  "keep a further frontier profile only when it beats every already-kept candidate on some " +
  "frozen metric by at least its declared material margin, up to " +
  `${LISTEN_MULTIDOMAIN_MAX_CANDIDATES} candidates.`;

function materiallyBetter(
  candidate: ListenCandidateMetrics,
  kept: ListenCandidateMetrics,
): boolean {
  return LISTEN_CANDIDATE_METRIC_ORDER.some(({ key, direction }) => {
    const left = candidate[key];
    const right = kept[key];
    if (left === null || right === null) return false;
    const gain = direction === "higher-is-better" ? left - right : right - left;
    return gain >= LISTEN_MULTIDOMAIN_MATERIAL_MARGINS[key];
  });
}

/** The smallest safe frontier subset whose members offer different tradeoffs. */
export function selectListenMultiDomainCandidates(
  frontier: readonly ListenMultiDomainProfileResult[],
  maximum = LISTEN_MULTIDOMAIN_MAX_CANDIDATES,
): ListenMultiDomainProfileResult[] {
  const ranked = rankListenCandidates(frontier.map(({ metrics }) => metrics));
  const byId = new Map(frontier.map((candidate) => [candidate.profile.id, candidate]));
  const selected: ListenMultiDomainProfileResult[] = [];
  for (const metrics of ranked) {
    if (selected.length >= maximum) break;
    if (!metrics.safe) continue;
    const candidate = byId.get(metrics.profileId);
    if (!candidate) continue;
    if (
      selected.length === 0 ||
      selected.every(({ metrics: kept }) => materiallyBetter(metrics, kept))
    ) {
      selected.push(candidate);
    }
  }
  return selected;
}

/**
 * Captures the frozen discovery and regression-only corpus once and replays all
 * 1,000 grid profiles against every trace.
 *
 * Confirmation traces are never captured here, so no selection decision can read
 * one even accidentally. The capture function is injected so unit tests can
 * drive the identical aggregation, safety, ranking, and selection path over
 * deterministic synthetic traces.
 */
export async function evaluateListenMatcherMultiDomainSweep(options: {
  capture: ListenMultiDomainCaptureFn;
  manifest?: ListenTraceManifest;
  profiles?: readonly ListenMatcherSweepProfile[];
  onProgress?: (completed: number, total: number, label: string) => void;
  yieldEvery?: number;
}): Promise<ListenMultiDomainSweepResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const onProgress = options.onProgress ?? (() => undefined);
  const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 50));
  const profiles = options.profiles ?? generateListenMatcherSweepProfiles();
  // A duplicated profile would be scored twice and could carry a frontier
  // position it did not earn, so the grid is checked rather than assumed.
  if (profiles.length === 0) {
    throw new Error("The multi-domain sweep needs at least the baseline profile.");
  }
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) {
    throw new Error("The multi-domain sweep grid contains a duplicated profile identifier.");
  }
  const descriptors = listenMultiDomainSweepTraces(manifest);
  const scoringWeights = listenTraceWeightsForPartition("discovery", manifest);
  const scoredTraceIds = new Set(scoringWeights
    .filter(({ weight }) => weight > 0)
    .map(({ traceId }) => traceId));
  const safetyPopulations = listenMultiDomainSafetyPopulations(manifest, descriptors);
  const dedicatedSafetyTraceIds = new Set(safetyPopulations.dedicatedSafetyTraceIds);
  const regressionRunTraceIds = new Set(safetyPopulations.regressionRunTraceIds);
  const baselineRelativeTraceIds = new Set(safetyPopulations.baselineRelativeTraceIds);
  const weightByTrace = new Map(scoringWeights.map(({ traceId, weight }) => [traceId, weight]));
  const perProfileRuns = profiles.map((): ListenMultiDomainRunMetrics[] => []);
  const captures: ListenMultiDomainSweepResult["captures"] = [];
  const renderers = new Map<string, ListenBenchmarkRendererConfiguration>();
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    onProgress(index, descriptors.length, `Capturing ${descriptor.id}`);
    const capture = await options.capture(descriptor);
    // The metrics are filed under the requested trace's identity and weight, so
    // a capture that answered with different audio would be scored as this one.
    if (capture.descriptor.id !== descriptor.id) {
      throw new Error(
        `Capturing ${descriptor.id} returned ${capture.descriptor.id}.`,
      );
    }
    if (capture.trace.renderer.version !== descriptor.renderer) {
      throw new Error(
        `${descriptor.id} expects renderer ${descriptor.renderer}, but its capture used ` +
        `${capture.trace.renderer.version}.`,
      );
    }
    renderers.set(capture.trace.renderer.version, { ...capture.trace.renderer });
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      const profile = profiles[profileIndex];
      const observations: ListenSequenceAdvancementObservation[] = [];
      const run = replayListenSequenceTrace(
        capture.sequence,
        capture.trace,
        "current-matcher",
        profile,
        (observation) => observations.push(observation),
      );
      if (profile.id === sweepProfileId(LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE)) {
        // The grid's own baseline entry must reproduce the capture-time
        // production replay event for event, or the corpus changed rather than
        // the profile.
        assertListenSequenceRunParity(descriptor.id, capture.baselineRun, run);
      }
      perProfileRuns[profileIndex].push(
        multiDomainRunMetrics(descriptor.id, capture.sequence, run, observations),
      );
      if ((profileIndex + 1) % yieldEvery === 0) {
        onProgress(
          index,
          descriptors.length,
          `${descriptor.id} · profile ${profileIndex + 1} / ${profiles.length}`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    assertRecognitionTraceUnmutated(
      `${descriptor.id} multi-domain replay`,
      capture.trace,
      capture.recognitionHash,
    );
    captures.push({
      traceId: descriptor.id,
      partition: descriptor.partition,
      suite: descriptor.suite,
      domainKey: `${descriptor.rendererKey}/${descriptor.suite}/${descriptor.domain}`,
      renderer: capture.trace.renderer.version,
      weight: weightByTrace.get(descriptor.id) ?? 0,
      recognitionStructureHash: capture.recognitionStructureHash,
      frameCount: capture.trace.frames.length,
      expectedEventCount: capture.baselineRun.summary.expectedEventCount,
    });
    onProgress(index + 1, descriptors.length, `Replayed ${descriptor.id}`);
  }
  const baselineId = sweepProfileId(LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE);
  const baselineIndex = profiles.findIndex(({ id }) => id === baselineId);
  if (baselineIndex < 0) {
    throw new Error(`The evaluated grid does not contain the baseline profile ${baselineId}.`);
  }
  const shared = {
    scoringWeights,
    scoredTraceIds,
    dedicatedSafetyTraceIds,
    regressionRunTraceIds,
    baselineRelativeTraceIds,
  };
  const baseline = aggregateMultiDomainProfile({
    ...shared,
    profile: profiles[baselineIndex],
    runs: perProfileRuns[baselineIndex],
    baseline: null,
  });
  const candidates = profiles.map((profile, index) => (
    index === baselineIndex ? baseline : aggregateMultiDomainProfile({
      ...shared,
      profile,
      runs: perProfileRuns[index],
      baseline,
    })
  ));
  const frontierMetrics = listenCandidateParetoFrontier(candidates.map(({ metrics }) => metrics));
  const byId = new Map(candidates.map((candidate) => [candidate.profile.id, candidate]));
  const paretoFrontier = frontierMetrics.flatMap(({ profileId }) => {
    const candidate = byId.get(profileId);
    return candidate === undefined ? [] : [candidate];
  });
  const selected = selectListenMultiDomainCandidates(paretoFrontier);
  const retained = new Set([baseline.profile.id, ...paretoFrontier.map(({ profile }) => profile.id)]);
  for (const candidate of candidates) {
    if (!retained.has(candidate.profile.id)) delete candidate.runs;
  }
  return {
    manifest: {
      version: manifest.version,
      hash: listenTraceManifestHash(manifest),
      corpusHash: listenTraceCorpusHash(manifest),
      traceCount: manifest.traces.length,
      capturedTraceCount: descriptors.length,
      scoredTraceCount: scoredTraceIds.size,
      regressionRunCount: dedicatedSafetyTraceIds.size + regressionRunTraceIds.size,
      baselineRelativeSafetyRunCount:
        safetyPopulations.baselineRelativeSafetyTraceIds.length,
    },
    renderers: [...renderers.values()],
    baselineProfile: { ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE },
    gridSize: profiles.length,
    profilesEvaluated: candidates.length,
    profilesRejectedBySafety: candidates.filter(({ safety }) => !safety.passed).length,
    captures,
    baseline,
    candidates,
    paretoFrontier,
    selected,
    selectionRule: LISTEN_MULTIDOMAIN_SELECTION_RULE,
    noSafeImprovement: selected.length === 0 ||
      (selected.length === 1 && selected[0].profile.id === baseline.profile.id),
    replayParityVerified: true,
  };
}

/** Runs the multi-domain sweep in the browser against one inference session. */
export function runListenMatcherMultiDomainSweep(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenMultiDomainSweepResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenMatcherMultiDomainSweep({
    capture: (descriptor) => captureListenMultiDomainTrace(descriptor, session),
    onProgress,
  }));
}

function conciseMultiDomainProfile(candidate: ListenMultiDomainProfileResult, detailed = false) {
  return {
    profile: candidate.profile,
    metrics: candidate.metrics,
    safe: candidate.safety.passed,
    rejectionReasons: candidate.safety.rejectionReasons,
    totals: candidate.totals,
    improvedDomainCount: candidate.improvedDomainCount,
    worsenedDomainCount: candidate.worsenedDomainCount,
    safety: {
      dedicatedFalseAdvanceCount: candidate.safety.dedicatedFalseAdvanceCount,
      dedicatedSkippedAdvanceCount: candidate.safety.dedicatedSkippedAdvanceCount,
      dedicatedDuplicateAdvanceCount: candidate.safety.dedicatedDuplicateAdvanceCount,
      dedicatedIncompleteCarriedBassAdvances:
        candidate.safety.dedicatedIncompleteCarriedBassAdvances,
      regressionRunFalseAdvanceCount: candidate.safety.regressionRunFalseAdvanceCount,
      regressionRunLateAdvanceCount: candidate.safety.regressionRunLateAdvanceCount,
      discoveryRegressions: candidate.safety.discoveryRegressions,
      committedRegressions: {
        deviationCount: candidate.safety.regressions.deviationCount,
        worseThanBaselineCount: candidate.safety.regressions.worseThanBaselineCount,
        passed: candidate.safety.regressions.passed,
        outcomes: candidate.safety.regressions.outcomes.map((outcome) => ({
          fixtureId: outcome.fixtureId,
          advancedAtMs: outcome.advancedAtMs,
          sourceAttackIndex: outcome.sourceAttackIndex,
          falseAdvance: outcome.falseAdvance,
          lateAdvance: outcome.lateAdvance,
          satisfied: outcome.satisfied,
          worseThanBaseline: outcome.worseThanBaseline,
        })),
      },
    },
    ...(detailed ? {
      independentRate: candidate.independentRate,
      orderedPrefixRate: candidate.orderedPrefixRate,
      completePassageRate: candidate.completePassageRate,
      independentRateDeltaFromBaseline: candidate.independentRateDeltaFromBaseline,
    } : {}),
  };
}

/** The exported shape of a multi-domain sweep, small enough to record verbatim. */
export function conciseListenMatcherMultiDomainSweepResult(result: ListenMultiDomainSweepResult) {
  return {
    manifest: result.manifest,
    renderers: result.renderers,
    baselineProfile: result.baselineProfile,
    gridSize: result.gridSize,
    profilesEvaluated: result.profilesEvaluated,
    profilesRejectedBySafety: result.profilesRejectedBySafety,
    selectionRule: result.selectionRule,
    noSafeImprovement: result.noSafeImprovement,
    replayParityVerified: result.replayParityVerified,
    captures: result.captures,
    baseline: conciseMultiDomainProfile(result.baseline, true),
    paretoFrontier: result.paretoFrontier.map((candidate) => (
      conciseMultiDomainProfile(candidate, true)
    )),
    selected: result.selected.map((candidate) => conciseMultiDomainProfile(candidate, true)),
    rejectionCounts: [...result.candidates
      .flatMap(({ safety }) => safety.rejectionReasons)
      .reduce((counts, reason) => counts.set(reason, (counts.get(reason) ?? 0) + 1), new Map<string, number>())]
      .map(([reason, profileCount]) => ({ reason, profileCount }))
      .sort((left, right) => left.reason.localeCompare(right.reason)),
  };
}

export interface ListenMultiDomainCandidateArchiveRecord {
  profile: ListenMatcherSweepProfile;
  metrics: ListenCandidateMetrics;
  safetyVerdict: {
    passed: boolean;
    rejectionCodes: string[];
    dedicatedFalseAdvanceCount: number;
    dedicatedSkippedAdvanceCount: number;
    dedicatedDuplicateAdvanceCount: number;
    dedicatedIncompleteCarriedBassAdvances: number;
    regressionRunFalseAdvanceCount: number;
    regressionRunSkippedAdvanceCount: number;
    regressionRunDuplicateAdvanceCount: number;
    regressionRunLateAdvanceCount: number;
    discoveryRegressions: ListenMultiDomainSafetyVerdict["discoveryRegressions"];
    committedRegressionDeviationCount: number;
    committedRegressionWorseThanBaselineCount: number;
    committedRegressionPassed: boolean;
  };
  totals: ListenMultiDomainProfileResult["totals"];
}

export interface ListenMultiDomainCandidateArchive {
  formatVersion: 1;
  candidateCount: number;
  digest: {
    algorithm: "fnv1a-32-canonical-json";
    value: string;
  };
  candidates: ListenMultiDomainCandidateArchiveRecord[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => (
    `${JSON.stringify(key)}:${canonicalJson(entry)}`
  )).join(",")}}`;
}

/** Digest recipe pinned by the frozen Task 08 candidate archive. */
export function listenMultiDomainCandidateArchiveDigest(
  candidates: readonly ListenMultiDomainCandidateArchiveRecord[],
): string {
  const hasher = new DeterministicHasher();
  // Canonical JSON is already structurally delimited, so preserve the archive's
  // historical digest by omitting the hasher's field-terminator byte.
  hasher.text(canonicalJson({ formatVersion: 1, candidates }), false);
  return hasher.digest;
}

/**
 * All evaluated profiles in stable identifier order. This is the Task 08 full
 * result missing from the original export: every row carries the exact profile,
 * ranking metrics, pass/reject verdict, rejection codes, and safety counters.
 */
export function listenMultiDomainCandidateArchive(
  result: ListenMultiDomainSweepResult,
): ListenMultiDomainCandidateArchive {
  const candidates = [...result.candidates]
    .sort((left, right) => (
      left.profile.id < right.profile.id ? -1 : left.profile.id > right.profile.id ? 1 : 0
    ))
    .map((candidate): ListenMultiDomainCandidateArchiveRecord => ({
      profile: { ...candidate.profile },
      metrics: { ...candidate.metrics },
      safetyVerdict: {
        passed: candidate.safety.passed,
        rejectionCodes: [...candidate.safety.rejectionReasons],
        dedicatedFalseAdvanceCount: candidate.safety.dedicatedFalseAdvanceCount,
        dedicatedSkippedAdvanceCount: candidate.safety.dedicatedSkippedAdvanceCount,
        dedicatedDuplicateAdvanceCount: candidate.safety.dedicatedDuplicateAdvanceCount,
        dedicatedIncompleteCarriedBassAdvances:
          candidate.safety.dedicatedIncompleteCarriedBassAdvances,
        regressionRunFalseAdvanceCount: candidate.safety.regressionRunFalseAdvanceCount,
        regressionRunSkippedAdvanceCount: candidate.safety.regressionRunSkippedAdvanceCount,
        regressionRunDuplicateAdvanceCount: candidate.safety.regressionRunDuplicateAdvanceCount,
        regressionRunLateAdvanceCount: candidate.safety.regressionRunLateAdvanceCount,
        discoveryRegressions: candidate.safety.discoveryRegressions.map((entry) => ({ ...entry })),
        committedRegressionDeviationCount: candidate.safety.regressions.deviationCount,
        committedRegressionWorseThanBaselineCount:
          candidate.safety.regressions.worseThanBaselineCount,
        committedRegressionPassed: candidate.safety.regressions.passed,
      },
      totals: { ...candidate.totals },
    }));
  return {
    formatVersion: 1,
    candidateCount: candidates.length,
    digest: {
      algorithm: "fnv1a-32-canonical-json",
      value: listenMultiDomainCandidateArchiveDigest(candidates),
    },
    candidates,
  };
}

/** Full deterministic browser export; summary mode intentionally uses the concise exporter. */
export function fullListenMatcherMultiDomainSweepResult(result: ListenMultiDomainSweepResult) {
  return {
    ...conciseListenMatcherMultiDomainSweepResult(result),
    candidateArchive: listenMultiDomainCandidateArchive(result),
  };
}
