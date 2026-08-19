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
  LISTEN_SAFETY_REGRESSION_FIXTURES,
  replayListenSafetyRegressions,
} from "./listenSafetyRegression";
import {
  TONE_COURSE_CLEAR_333_SHARED_PITCH_FALSE_ADVANCE,
  TONE_SALAMANDER_V05_LATE_ADVANCE,
} from "./listenSafetyRegressionFixtures";
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

/**
 * Every exploratory profile is assessed against every diagnosed case, because a
 * committed regression only protects the search if the search actually replays
 * it. The distribution below is measured, not asserted for its own sake: it says
 * which parameter regions each diagnosed failure separates.
 */
test("every grid profile is assessed against every committed regression", () => {
  const profiles = generateListenMatcherSweepProfiles();
  const outcomes = profiles.map((profile) => ({
    profile,
    byFixture: new Map(LISTEN_SAFETY_REGRESSION_FIXTURES.map((fixture) => [
      fixture.id,
      replayListenSafetyRegressions(profile, profile.id, [fixture]).outcomes[0],
    ])),
  }));
  assert.equal(outcomes.length, 1_000);
  assert.ok(outcomes.every(({ byFixture }) => (
    byFixture.size === LISTEN_SAFETY_REGRESSION_FIXTURES.length
  )));

  // The v05 case is a late advance for every profile in the grid. 592 recover
  // the correct chord one repetition earlier than baseline, which deviates from
  // the pinned advancement without being unsafe.
  const v05 = outcomes.map(({ byFixture }) => byFixture.get(TONE_SALAMANDER_V05_LATE_ADVANCE.id)!);
  assert.ok(v05.every((outcome) => outcome.lateAdvance && !outcome.falseAdvance));
  assert.equal(v05.filter(({ advancedAtMs }) => advancedAtMs === 24_448).length, 592);
  assert.equal(v05.filter(({ advancedAtMs }) => advancedAtMs === 25_440).length, 408);
  assert.equal(v05.filter(({ worseThanBaseline }) => worseThanBaseline).length, 0);

  // The shared-pitch case separates the grid into four measured regions.
  const shared = outcomes.map(({ profile, byFixture }) => ({
    profile,
    outcome: byFixture.get(TONE_COURSE_CLEAR_333_SHARED_PITCH_FALSE_ADVANCE.id)!,
  }));
  const region = (advancedAtMs: number, falseAdvanceCount: number) => shared.filter((entry) => (
    entry.outcome.advancedAtMs === advancedAtMs &&
    entry.outcome.falseAdvanceCount === falseAdvanceCount
  ));
  // Reproduce the pinned advance: the target's own 0.531 onset is below either
  // their onset or their target-note gate, and their extra-note gate refuses the
  // 0.983 extra in [56, 63].
  const pinned = region(4_768, 1);
  assert.equal(pinned.length, 570);
  assert.ok(pinned.every(({ outcome }) => outcome.satisfied && outcome.falseAdvance));
  // Never stall: both gates sit below 0.531, so the target advances in order
  // from its own attack and the false advance never happens.
  const ordered = region(3_072, 0);
  assert.equal(ordered.length, 240);
  assert.ok(ordered.every(({ profile }) => (
    profile.onsetThreshold <= 0.5 && profile.targetNoteThreshold <= 0.5
  )));
  assert.ok(ordered.every(({ outcome }) => outcome.orderedAdvanced && !outcome.falseAdvance));
  // A 0.99 extra-note gate no longer treats the 0.983 extra as unexpected, so
  // the same target is falsely advanced by the earlier [56, 63] instead.
  const earlier = region(3_744, 1);
  assert.equal(earlier.length, 114);
  assert.ok(earlier.every(({ profile }) => profile.extraNoteThreshold === 0.99));
  // The same relaxed extra-note gate combined with a permissive active-target
  // gate cascades into three false advances, which is strictly less safe than
  // baseline and is the only region this regression rejects.
  const cascading = region(3_744, 3);
  assert.equal(cascading.length, 76);
  assert.ok(cascading.every(({ profile }) => (
    profile.extraNoteThreshold === 0.99 && profile.activeTargetThreshold <= 0.275
  )));
  assert.ok(cascading.every(({ outcome }) => outcome.worseThanBaseline));
  assert.equal(pinned.length + ordered.length + earlier.length + cascading.length, 1_000);
  assert.equal(
    shared.filter(({ outcome }) => outcome.worseThanBaseline).length,
    cascading.length,
  );
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
      lateAdvanceCount: 0,
      incompleteCarriedBassAdvances: 0,
      regressions: {
        fixtureCount: 0,
        outcomes: [],
        falseAdvanceCount: 0,
        skippedAdvanceCount: 0,
        duplicateAdvanceCount: 0,
        deviationCount: 0,
        worseThanBaselineCount: 0,
        passed: true,
      },
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
