import assert from "node:assert/strict";
import test from "node:test";
import { LISTEN_BENCHMARK_RENDERER } from "./listenBenchmarkAudio";
import {
  bundledListenSequences,
  materializeListenSequence,
  replayListenSequenceTrace,
  summarizeListenSequenceBenchmark,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceAggregateSummary,
  type ListenSequenceBenchmarkResult,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import {
  LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
  generateListenMatcherSweepProfiles,
  listenThresholdSweepParetoFrontier,
  rankListenThresholdSweepCandidates,
  runListenThresholdSweep,
  type ListenThresholdSweepProfileResult,
} from "./listenMatcherSweepBenchmark";

function recognitionFrame(
  relevantPitches: readonly number[],
  capturedAtMs: number,
  attacks: ReadonlyArray<{
    midi: number;
    type?: "onset" | "reOnset";
    confidence?: number;
    noteConfidence?: number;
  }> = [],
  activePitches: readonly number[] = attacks.map(({ midi }) => midi),
): ListenRecognitionFrame {
  return {
    capturedAtMs,
    onsets: attacks.map(({ midi }) => ({
      midi,
      confidence: attacks.find((attack) => attack.midi === midi)?.confidence ?? 0.95,
      noteConfidence: attacks.find((attack) => attack.midi === midi)?.noteConfidence ?? 0.9,
      onsetTimeMs: capturedAtMs,
    })),
    noteEvents: attacks.map(({ midi, type }) => ({
      midi,
      type: type ?? "onset",
      confidence: attacks.find((attack) => attack.midi === midi)?.confidence ?? 0.95,
      eventTimeMs: capturedAtMs,
    })),
    activePitches: activePitches.map((midi) => ({ midi, confidence: 0.9 })),
    confidenceEvidence: relevantPitches.map((midi) => ({
      midi,
      confidence: activePitches.includes(midi) ? 0.9 : 0,
    })),
    modelScores: [],
    modelStates: relevantPitches.map((midi) => activePitches.includes(midi) ? 3 : 0),
    signalActive: activePitches.length > 0,
    inferenceDurationMs: 4,
  };
}

function trace(
  sequence: MaterializedListenSequence,
  frames: ListenRecognitionFrame[],
): ListenRecognitionTrace {
  return {
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: sequence.relevantPitches,
    renderer: { ...LISTEN_BENCHMARK_RENDERER },
    audioDiagnostics: {
      frameCount: 512,
      durationMs: 32,
      peak: 0,
      rms: 0,
    },
    pcm: new Float32Array(512),
    frames,
    maximumInferenceMs: Math.max(0, ...frames.map(({ inferenceDurationMs }) => inferenceDurationMs)),
    maximumProcessingBacklogMs: 0,
  };
}

test("threshold sweep generates the complete stable 1,000-profile grid", () => {
  const profiles = generateListenMatcherSweepProfiles();
  assert.equal(profiles.length, 1_000);
  assert.equal(new Set(profiles.map(({ id }) => id)).size, 1_000);
  const production = profiles.find(({ onsetThreshold, targetNoteThreshold, activeTargetThreshold,
    extraNoteThreshold, requireFreshBassOnset }) => (
    onsetThreshold === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.onsetThreshold &&
    targetNoteThreshold === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.targetNoteThreshold &&
    activeTargetThreshold === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.activeTargetThreshold &&
    extraNoteThreshold === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.extraNoteThreshold &&
    requireFreshBassOnset === LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE.requireFreshBassOnset
  ));
  assert.ok(production);
  assert.equal(production.distanceFromProduction, 0);
});

function sweepCandidate(
  id: string,
  requireFreshBassOnset: boolean,
  independentMatchCount: number,
  fastIndependentCount: number,
  orderedAdvanceCount: number,
  latency: number,
  distanceFromProduction: number,
): ListenThresholdSweepProfileResult {
  const speed = (intervalMs: number, count: number) => ({
    intervalMs,
    independentMatchCount: count,
  } as ListenSequenceAggregateSummary);
  return {
    profile: {
      ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
      id,
      requireFreshBassOnset,
      distanceFromProduction,
    },
    eligible: true,
    rejectedBySafety: false,
    safety: {
      sequenceCount: 0,
      speeds: [],
      falseAdvanceCount: 0,
      skippedAdvanceCount: 0,
      duplicateAdvanceCount: 0,
      incompleteCarriedBassAdvances: 0,
      passed: true,
    },
    independentMatchCount,
    orderedAdvanceCount,
    orderedPrefixCompleted: 0,
    completePassageCount: 0,
    p95OrderedAdvanceLatencyMs: latency,
    speedSummaries: [speed(500, fastIndependentCount), speed(1_000, 0)],
    familySpeedSummaries: [],
    nonSafetyDeltasFromProduction: [],
  };
}

test("threshold ranking and Pareto tie-breaking are deterministic", () => {
  const relaxed = sweepCandidate("b-relaxed", false, 10, 5, 8, 200, 1);
  const fresh = sweepCandidate("a-fresh", true, 10, 5, 8, 200, 1);
  const higherRecall = sweepCandidate("z-recall", false, 11, 4, 7, 220, 2);
  assert.deepEqual(
    rankListenThresholdSweepCandidates([relaxed, higherRecall, fresh])
      .map(({ profile }) => profile.id),
    ["z-recall", "a-fresh", "b-relaxed"],
  );
  assert.deepEqual(
    listenThresholdSweepParetoFrontier([relaxed, fresh]).map(({ profile }) => profile.id),
    ["a-fresh", "b-relaxed"],
  );
});

test("threshold sweep replays a retained trace without an inference session", async () => {
  const definition = bundledListenSequences()[0];
  const sequence = materializeListenSequence(definition, 1_000);
  const frames = sequence.targets.flatMap((target) => {
    const at = Math.ceil(target.scheduledAttackTimeMs / 32) * 32;
    return [
      recognitionFrame(sequence.relevantPitches, at, target.pitches.map((midi) => ({ midi }))),
      recognitionFrame(sequence.relevantPitches, at + 32, [], target.pitches),
    ];
  });
  const original = replayListenSequenceTrace(
    sequence,
    trace(sequence, frames),
    "current-matcher",
    LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
  );
  const summary = summarizeListenSequenceBenchmark([original]);
  const benchmark: ListenSequenceBenchmarkResult = {
    policy: "current-matcher",
    matcherProfile: { ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE },
    runs: [original],
    ...summary,
    experimental: {
      policy: "next-onset-buffer",
      bufferMs: 192,
      renderer: { ...LISTEN_BENCHMARK_RENDERER },
      runs: [],
      speedSummaries: [],
      familySpeedSummaries: [],
      comparison: {
        currentCorrectAdvanceCount: 0,
        bufferedCorrectAdvanceCount: 0,
        correctAdvanceImprovement: 0,
        currentOrderedPrefixCompleted: 0,
        bufferedOrderedPrefixCompleted: 0,
        orderedPrefixImprovement: 0,
        currentCompletePassageCount: 0,
        bufferedCompletePassageCount: 0,
        completePassageImprovement: 0,
        bufferedFalseAdvanceCount: 0,
        bufferedSkippedAdvanceCount: 0,
        bufferedDuplicateAdvanceCount: 0,
        isolatedBenchmarkUnchanged: true,
        rawAndIndependentMetricsIdentical: true,
        accepted: false,
      },
    },
  };
  let progressCalls = 0;
  const result = await runListenThresholdSweep(benchmark, () => { progressCalls += 1; }, 128);
  assert.equal(result.gridSize, 1_000);
  assert.equal(result.profilesEvaluated, 1_000);
  assert.equal(result.replayParityVerified, true);
  assert.ok(progressCalls > 0);
  assert.equal(result.noSafeImprovement, true);
  assert.deepEqual(result.recommendation.profile, result.productionBaseline.profile);
});
