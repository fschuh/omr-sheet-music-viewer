import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
} from "./listenBenchmarkAudio";
import {
  bundledListenSequences,
  courseClearArticulationDefinitions,
  materializeListenSequence,
  replayListenSequenceTrace,
  summarizeListenSequenceBenchmark,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceAggregateSummary,
  type ListenSequenceBenchmarkResult,
  type ListenSequenceDefinition,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import {
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
} from "./listenBaselineParity";
import {
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST_HASH,
  listenTraceWeightsForPartition,
  listenTracesInPartition,
  type ListenCandidateMetrics,
  type ListenTraceDescriptor,
} from "./listenTraceManifest";
import {
  LISTEN_SAFETY_REGRESSION_FIXTURES,
  replayListenSafetyRegressions,
} from "./listenSafetyRegression";
import {
  TONE_COURSE_CLEAR_333_SHARED_PITCH_FALSE_ADVANCE,
  TONE_SALAMANDER_V05_LATE_ADVANCE,
} from "./listenSafetyRegressionFixtures";
import {
  LISTEN_MULTIDOMAIN_MAX_CANDIDATES,
  LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
  conciseListenMatcherMultiDomainSweepResult,
  evaluateListenMatcherMultiDomainSweep,
  fullListenMatcherMultiDomainSweepResult,
  generateListenMatcherSweepProfiles,
  listenMultiDomainCandidateArchive,
  listenMultiDomainCandidateArchiveDigest,
  listenMultiDomainLeafMetrics,
  listenMultiDomainSweepTraces,
  listenThresholdSweepParetoFrontier,
  rankListenThresholdSweepCandidates,
  runListenThresholdSweep,
  selectListenMultiDomainCandidates,
  type ListenMultiDomainCandidateArchive,
  type ListenMultiDomainCapture,
  type ListenMultiDomainProfileResult,
  type ListenThresholdSweepProfileResult,
} from "./listenMatcherSweepBenchmark";

const TASK_08_CANDIDATE_ARCHIVE_DIGEST = "53ee8a67";

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

/* ------------------------------------------------------------------------- *
 * Multi-domain sweep
 * ------------------------------------------------------------------------- */

function multiDomainDefinition(descriptor: ListenTraceDescriptor): ListenSequenceDefinition {
  if (descriptor.suite === "sequence") {
    const definition = bundledListenSequences().find(({ id }) => id === descriptor.sourceId);
    if (!definition) throw new Error(`No bundled passage ${descriptor.sourceId}.`);
    return definition;
  }
  const articulations = courseClearArticulationDefinitions();
  const definition = descriptor.suite === "articulation"
    ? articulations.find(({ id }) => id === descriptor.sourceId)
    : articulations.find(({ articulation }) => articulation === "normal");
  if (!definition) throw new Error(`No articulation passage for ${descriptor.id}.`);
  return definition;
}

/**
 * A frame whose every pitch carries the same confidence in the onset, the note
 * event, the active set, and the evidence vector.
 *
 * The shared helper above fixes the evidence at 0.9, which is below three of the
 * four extra-note gates: a deliberately played wrong note would then be
 * invisible to most profiles and the safety families would report failures the
 * decoder never produces. A confidently played note is confident everywhere.
 */
function confidentFrame(
  relevantPitches: readonly number[],
  capturedAtMs: number,
  attacked: ReadonlyArray<{ midi: number; confidence: number }>,
  sounding: ReadonlyArray<{ midi: number; confidence: number }> = attacked,
): ListenRecognitionFrame {
  return {
    capturedAtMs,
    onsets: attacked.map(({ midi, confidence }) => ({
      midi,
      confidence,
      noteConfidence: confidence,
      onsetTimeMs: capturedAtMs,
    })),
    noteEvents: attacked.map(({ midi, confidence }) => ({
      midi,
      type: "onset",
      confidence,
      eventTimeMs: capturedAtMs,
    })),
    activePitches: sounding.map(({ midi, confidence }) => ({ midi, confidence })),
    confidenceEvidence: relevantPitches.map((midi) => ({
      midi,
      confidence: sounding.find((pitch) => pitch.midi === midi)?.confidence ?? 0,
    })),
    modelScores: [],
    modelStates: relevantPitches.map((midi) => (
      sounding.some((pitch) => pitch.midi === midi) ? 3 : 0
    )),
    signalActive: sounding.length > 0,
    inferenceDurationMs: 4,
  };
}

/** Confidence a genuinely played note decodes with, above every extra-note gate. */
const CONFIDENTLY_PLAYED = 0.995;

/** One decoded pitch: how confidently it was attacked, and how confidently it sounds. */
interface SyntheticDecodedPitch {
  midi: number;
  confidence: number;
  activeConfidence?: number;
}

type SyntheticAttack = MaterializedListenSequence["attacks"][number];

/**
 * A deterministic stand-in for one rendered, recognized manifest trace: every
 * physical attack decodes exactly as it was played, confidently.
 *
 * `decode` may replace what one attack decodes as, and `echo` may add decoded
 * attacks the player never made, so a safety gate has something to catch.
 */
function syntheticMultiDomainCapture(
  descriptor: ListenTraceDescriptor,
  overrides: {
    decode?: (
      descriptor: ListenTraceDescriptor,
      attack: SyntheticAttack,
    ) => SyntheticDecodedPitch[] | undefined;
    echo?: (
      descriptor: ListenTraceDescriptor,
      attack: SyntheticAttack,
    ) => Array<{ afterMs: number; pitches: SyntheticDecodedPitch[] }>;
  } = {},
): ListenMultiDomainCapture {
  const sequence = materializeListenSequence(
    multiDomainDefinition(descriptor),
    descriptor.intervalMs ?? 1_000,
  );
  // A pitch may decode with a weaker sustained presence than its attack, which
  // is what separates the onset gates from the active-target gate.
  const decodedFrames = (atMs: number, pitches: SyntheticDecodedPitch[]) => {
    const sounding = pitches.map(({ midi, confidence, activeConfidence }) => ({
      midi,
      confidence: activeConfidence ?? confidence,
    }));
    return [
      confidentFrame(sequence.relevantPitches, atMs, pitches, sounding),
      confidentFrame(sequence.relevantPitches, atMs + 32, [], sounding),
    ];
  };
  const byTime = new Map<number, ListenRecognitionFrame>();
  for (const attack of sequence.attacks) {
    const at = Math.ceil(attack.scheduledAtMs / 32) * 32;
    const pitches: SyntheticDecodedPitch[] = overrides.decode?.(descriptor, attack) ??
      attack.playedPitches.map((midi) => ({ midi, confidence: CONFIDENTLY_PLAYED }));
    const echoes = (overrides.echo?.(descriptor, attack) ?? []).flatMap((echo) => (
      decodedFrames(Math.ceil((attack.scheduledAtMs + echo.afterMs) / 32) * 32, echo.pitches)
    ));
    // A physical attack always wins the frame it lands on: an echo that would
    // overwrite one is dropped rather than silently replacing played evidence.
    for (const frame of echoes) byTime.set(frame.capturedAtMs, frame);
    for (const frame of decodedFrames(at, pitches)) byTime.set(frame.capturedAtMs, frame);
  }
  const frames = [...byTime.values()].sort((left, right) => left.capturedAtMs - right.capturedAtMs);
  const captured: ListenRecognitionTrace = {
    ...trace(sequence, frames),
    renderer: {
      ...(descriptor.rendererKey === "tone"
        ? LISTEN_BENCHMARK_TONE_RENDERER
        : LISTEN_BENCHMARK_RENDERER),
    },
  };
  const baselineRun = replayListenSequenceTrace(
    sequence,
    captured,
    "current-matcher",
    LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE,
  );
  return {
    descriptor,
    sequence,
    trace: captured,
    recognitionHash: listenRecognitionTraceHash(captured),
    recognitionStructureHash: listenRecognitionStructureHash(captured),
    baselineRun,
  };
}

/** A small, stable slice of the grid, always including the frozen baseline. */
function multiDomainProfileSubset() {
  const ids = new Set([
    "o0p600-t0p500-a0p350-x0p970-b1",
    "o0p550-t0p500-a0p350-x0p970-b1",
    "o0p500-t0p500-a0p350-x0p990-b1",
    "o0p450-t0p500-a0p200-x0p990-b1",
    "o0p650-t0p650-a0p500-x0p900-b1",
    "o0p600-t0p500-a0p350-x0p970-b0",
  ]);
  const profiles = generateListenMatcherSweepProfiles().filter(({ id }) => ids.has(id));
  assert.equal(profiles.length, ids.size);
  return profiles;
}

test("the multi-domain sweep captures discovery and regression traces, never confirmation", () => {
  const traces = listenMultiDomainSweepTraces();
  const partitions = new Set(traces.map(({ partition }) => partition));
  assert.deepEqual([...partitions].sort(), ["discovery", "regression-only"]);
  assert.equal(traces.filter(({ suite }) => suite === "safety-regression").length, 0);
  assert.equal(
    traces.length,
    listenTracesInPartition("discovery").length +
      listenTracesInPartition("regression-only").length -
      LISTEN_SAFETY_REGRESSION_FIXTURES.length,
  );
  assert.equal(traces.length, 176);
  assert.equal(new Set(traces.map(({ id }) => id)).size, traces.length);
});

test("the multi-domain sweep scores the manifest's frozen weighting and never reads confirmation", async () => {
  const requested: string[] = [];
  const result = await evaluateListenMatcherMultiDomainSweep({
    profiles: multiDomainProfileSubset(),
    capture: async (descriptor) => {
      assert.notEqual(descriptor.partition, "confirmation");
      requested.push(descriptor.id);
      return syntheticMultiDomainCapture(descriptor);
    },
  });
  assert.deepEqual(requested, listenMultiDomainSweepTraces().map(({ id }) => id));
  assert.equal(result.manifest.hash, LISTEN_TRACE_MANIFEST_HASH);
  assert.equal(result.manifest.corpusHash, LISTEN_TRACE_CORPUS_HASH);
  assert.equal(result.manifest.capturedTraceCount, 176);
  assert.equal(result.manifest.scoredTraceCount, 139);
  assert.equal(result.manifest.regressionRunCount, 37);
  assert.equal(result.captures.length, 176);
  assert.equal(result.replayParityVerified, true);

  // Scored traces carry the manifest weight; the regression corpus scores nothing.
  const scored = result.captures.filter(({ partition }) => partition === "discovery");
  assert.equal(scored.length, 139);
  assert.ok(scored.every(({ weight }) => weight > 0));
  assert.ok(result.captures
    .filter(({ partition }) => partition === "regression-only")
    .every(({ weight }) => weight === 0));
  assert.ok(Math.abs(scored.reduce((total, { weight }) => total + weight, 0) - 1) < 1e-9);

  // Perfect decoding of every attack leaves no profile with a safety event and
  // makes the equal-domain metrics agree with the per-renderer breakdown.
  assert.equal(result.profilesRejectedBySafety, 1);
  assert.deepEqual(
    result.candidates.filter(({ safety }) => !safety.passed)
      .map(({ profile, safety }) => [profile.id, safety.rejectionReasons]),
    [["o0p600-t0p500-a0p350-x0p970-b0", ["fresh-bass-not-required"]]],
  );
  assert.equal(result.baseline.independentRate.renderers.length, 2);
  assert.deepEqual(
    result.baseline.independentRate.suites.map(({ key }) => key).sort(),
    [
      "direct/articulation", "direct/dynamics-constant", "direct/dynamics-mixed",
      "direct/sequence",
      "tone/articulation", "tone/dynamics-constant", "tone/dynamics-mixed", "tone/sequence",
    ],
  );
  assert.equal(
    result.baseline.metrics.equalDomainIndependentRate,
    (result.baseline.independentRate.renderers[0].value +
      result.baseline.independentRate.renderers[1].value) / 2,
  );
  assert.ok((result.baseline.metrics.worstDomainIndependentRate ?? 1) <=
    (result.baseline.metrics.equalDomainIndependentRate ?? 0));
  assert.equal(result.baseline.metrics.distanceFromBaseline, 0);
  assert.equal(result.baseline.independentRateDeltaFromBaseline.overall, 0);
  assert.ok(result.candidates.every(({ leafDomains }) => leafDomains.length > 0));
  assert.deepEqual(
    result.baseline.leafDomains.map(({ domainKey, independentRate }) => ({
      domainKey,
      independentRate,
    })),
    result.baseline.independentRate.domains
      .map(({ domainKey, value }) => ({ domainKey, independentRate: value }))
      .sort((left, right) => left.domainKey.localeCompare(right.domainKey)),
  );
  const discoveryWeights = listenTraceWeightsForPartition("discovery");
  const diagnosticTrace = discoveryWeights.find(({ weight }) => weight > 0)!;
  const weightsWithOneDiagnostic = discoveryWeights.map((entry) => (
    entry.traceId === diagnosticTrace.traceId ? { ...entry, weight: 0 } : entry
  ));
  const filteredLeaf = listenMultiDomainLeafMetrics(
    result.baseline.runs!,
    weightsWithOneDiagnostic,
  ).find(({ domainKey }) => domainKey === diagnosticTrace.domainKey)!;
  assert.equal(filteredLeaf.traceCount, discoveryWeights.filter((entry) => (
    entry.domainKey === diagnosticTrace.domainKey &&
    entry.weight > 0 &&
    entry.traceId !== diagnosticTrace.traceId
  )).length, "zero-weight diagnostic rows do not enter Task 24 leaf rates");

  // Per-run metrics survive only where a report needs them.
  assert.equal(result.baseline.runs?.length, 176);
  const retained = new Set([
    result.baseline.profile.id,
    ...result.paretoFrontier.map(({ profile }) => profile.id),
  ]);
  assert.ok(result.candidates
    .filter(({ profile }) => !retained.has(profile.id))
    .every(({ runs }) => runs === undefined));
  assert.ok(result.paretoFrontier.every(({ safety }) => safety.passed));
  assert.ok(result.selected.length <= LISTEN_MULTIDOMAIN_MAX_CANDIDATES);
  assert.ok(result.selected.every((candidate) => result.paretoFrontier.includes(candidate)));

  const archive = listenMultiDomainCandidateArchive(result);
  assert.equal(archive.candidateCount, result.profilesEvaluated);
  assert.equal(archive.candidates.length, result.candidates.length);
  assert.deepEqual(
    archive.candidates.map(({ profile }) => profile.id),
    [...archive.candidates.map(({ profile }) => profile.id)].sort(),
  );
  for (const record of archive.candidates) {
    assert.equal(record.metrics.profileId, record.profile.id);
    assert.equal(record.safetyVerdict.passed, record.metrics.safe);
    assert.ok(Array.isArray(record.safetyVerdict.rejectionCodes));
  }
  assert.deepEqual(
    listenMultiDomainCandidateArchive({
      ...result,
      candidates: [...result.candidates].reverse(),
    }),
    archive,
    "candidate input order must not change the archive",
  );
  const metricChanged = {
    ...result,
    candidates: result.candidates.map((candidate, index) => index === 0 ? {
      ...candidate,
      metrics: {
        ...candidate.metrics,
        equalDomainIndependentRate: (candidate.metrics.equalDomainIndependentRate ?? 0) + 0.01,
      },
    } : candidate),
  };
  assert.notEqual(
    listenMultiDomainCandidateArchive(metricChanged).digest.value,
    archive.digest.value,
  );
  assert.equal(
    fullListenMatcherMultiDomainSweepResult(result).candidateArchive.digest.value,
    archive.digest.value,
  );
  assert.equal(
    "candidateArchive" in conciseListenMatcherMultiDomainSweepResult(result),
    false,
  );
});

test("the frozen Task 08 artifact pins the production candidate digest recipe", async () => {
  const artifact = JSON.parse(await readFile(
    new URL(
      "../../benchmark-results/listen-matcher-multidomain-sweep-task08.json",
      import.meta.url,
    ),
    "utf8",
  )) as Array<{ candidateArchive: ListenMultiDomainCandidateArchive }>;
  assert.equal(artifact.length, 1);
  const archive = artifact[0].candidateArchive;
  assert.equal(archive.candidateCount, 1_000);
  assert.equal(archive.candidates.length, 1_000);
  assert.equal(archive.digest.algorithm, "fnv1a-32-canonical-json");
  assert.equal(archive.digest.value, TASK_08_CANDIDATE_ARCHIVE_DIGEST);
  assert.equal(
    listenMultiDomainCandidateArchiveDigest(archive.candidates),
    TASK_08_CANDIDATE_ARCHIVE_DIGEST,
  );
});

test("the multi-domain sweep rejects a profile that is unsafe on a dedicated safety family", async () => {
  const result = await evaluateListenMatcherMultiDomainSweep({
    profiles: multiDomainProfileSubset(),
    capture: async (descriptor) => syntheticMultiDomainCapture(descriptor, {
      // The deliberate wrong note of `wrong-note-safety` decodes as the target
      // instead, so every profile advances from an attack that played something
      // else.
      decode: (trace, attack) => (
        trace.sourceId === "wrong-note-safety" && attack.index === 0
          ? [{ midi: 60, confidence: CONFIDENTLY_PLAYED }]
          : undefined
      ),
    }),
  });
  assert.equal(result.profilesRejectedBySafety, result.gridSize);
  assert.ok(result.candidates.every(({ safety }) => (
    safety.rejectionReasons.includes("dedicated-false-advance") &&
    safety.dedicatedFalseAdvanceCount > 0
  )));
  assert.deepEqual(result.paretoFrontier, []);
  assert.deepEqual(result.selected, []);
  assert.equal(result.noSafeImprovement, true);
});

test("the multi-domain sweep rejects a profile that adds a safety event to a scored trace", async () => {
  const result = await evaluateListenMatcherMultiDomainSweep({
    profiles: multiDomainProfileSubset(),
    // A repeated C4 decodes one extra time between the first two attacks, softly
    // enough that baseline-v1's onset gate refuses it. A profile whose gates sit
    // below that confidence treats the echo as a played attack and moves the
    // playhead onto a moment the player has not reached.
    capture: async (descriptor) => syntheticMultiDomainCapture(descriptor, {
      echo: (trace, attack) => (
        trace.sourceId === "repeated-c4" && attack.index === 0
          ? [{ afterMs: 224, pitches: [{ midi: 60, confidence: 0.55 }] }]
          : []
      ),
    }),
  });
  assert.equal(result.baseline.safety.passed, true);
  assert.deepEqual(result.baseline.safety.discoveryRegressions, []);
  const rejected = result.candidates.filter(({ safety }) => (
    safety.rejectionReasons.includes("discovery-safety-regression")
  ));
  assert.ok(rejected.length > 0);
  assert.ok(rejected.every(({ profile }) => (
    profile.onsetThreshold <= 0.55 && profile.targetNoteThreshold <= 0.55
  )));
  assert.ok(rejected.every(({ safety }) => safety.discoveryRegressions.every((regression) => (
    regression.traceId.includes("repeated-c4") &&
    regression.falseAdvanceDelta + regression.skippedAdvanceDelta +
      regression.duplicateAdvanceDelta > 0
  ))));
  assert.ok(result.paretoFrontier.every(({ profile }) => (
    !rejected.some((entry) => entry.profile.id === profile.id)
  )));
});

function multiDomainCandidate(
  id: string,
  metrics: Partial<ListenCandidateMetrics>,
): ListenMultiDomainProfileResult {
  return {
    profile: { ...LISTEN_SWEEP_DISCOVERY_BASELINE_PROFILE, id, distanceFromProduction: 0 },
    metrics: {
      profileId: id,
      safe: true,
      worstDomainIndependentRate: 0.9,
      equalDomainIndependentRate: 0.9,
      orderedPrefixRate: 0.9,
      completePassageRate: 0.9,
      lateAdvanceCount: 0,
      lateAdvanceSourceDistance: 0,
      attributionDelayMs: 0,
      p95LatencyMs: 200,
      distanceFromBaseline: 0,
      ...metrics,
    },
  } as ListenMultiDomainProfileResult;
}

test("candidate selection keeps only materially different safe tradeoffs", () => {
  const leader = multiDomainCandidate("leader", {
    worstDomainIndependentRate: 0.95,
    distanceFromBaseline: 0.2,
  });
  // Better by a ten-thousandth of an event: on the frontier, not worth shipping.
  const nearlyIdentical = multiDomainCandidate("nearly-identical", {
    worstDomainIndependentRate: 0.9401,
    equalDomainIndependentRate: 0.9001,
    distanceFromBaseline: 0.2,
  });
  const closerToBaseline = multiDomainCandidate("closer-to-baseline", {
    worstDomainIndependentRate: 0.94,
    distanceFromBaseline: 0.1,
  });
  const faster = multiDomainCandidate("faster", {
    worstDomainIndependentRate: 0.94,
    p95LatencyMs: 150,
    distanceFromBaseline: 0.2,
  });
  const unsafe = multiDomainCandidate("unsafe", {
    safe: false,
    worstDomainIndependentRate: 0.99,
    distanceFromBaseline: 0,
  });
  assert.deepEqual(
    selectListenMultiDomainCandidates([
      nearlyIdentical, faster, unsafe, leader, closerToBaseline,
    ]).map(({ profile }) => profile.id),
    ["leader", "faster", "closer-to-baseline"],
  );
  assert.deepEqual(
    selectListenMultiDomainCandidates([leader, closerToBaseline, faster], 2)
      .map(({ profile }) => profile.id),
    ["leader", "faster"],
  );
  assert.deepEqual(selectListenMultiDomainCandidates([]), []);
});

test("the multi-domain sweep refuses a grid or a capture it cannot score", async () => {
  const profiles = multiDomainProfileSubset();
  const capture = async (descriptor: ListenTraceDescriptor) => (
    syntheticMultiDomainCapture(descriptor)
  );
  await assert.rejects(
    () => evaluateListenMatcherMultiDomainSweep({ profiles: [], capture }),
    /needs at least the baseline profile/,
  );
  await assert.rejects(
    () => evaluateListenMatcherMultiDomainSweep({
      profiles: [...profiles, profiles[0]],
      capture,
    }),
    /duplicated profile identifier/,
  );
  await assert.rejects(
    () => evaluateListenMatcherMultiDomainSweep({
      profiles: profiles.filter(({ id }) => id !== "o0p600-t0p500-a0p350-x0p970-b1"),
      capture,
    }),
    /does not contain the baseline profile/,
  );
  // A capture that answers with different audio would be filed under the
  // requested trace's identity and weight.
  const first = listenMultiDomainSweepTraces()[0];
  const other = listenMultiDomainSweepTraces().find(({ id }) => id !== first.id)!;
  await assert.rejects(
    () => evaluateListenMatcherMultiDomainSweep({
      profiles,
      capture: async () => syntheticMultiDomainCapture(other),
    }),
    new RegExp(`Capturing ${first.id.replace(/\//g, "\\/")} returned ${other.id.replace(/\//g, "\\/")}`),
  );
  // The renderer union makes this unreachable from typed code, so the cast is
  // the point: the runtime guard is what protects the browser console and any
  // JavaScript caller from filing one renderer's audio under the other's row.
  await assert.rejects(
    () => evaluateListenMatcherMultiDomainSweep({
      profiles,
      capture: async (descriptor) => {
        const capture = syntheticMultiDomainCapture(descriptor);
        return {
          ...capture,
          trace: {
            ...capture.trace,
            renderer: {
              ...capture.trace.renderer,
              version: "made-up-renderer",
            } as unknown as ListenRecognitionTrace["renderer"],
          },
        };
      },
    }),
    /its capture used made-up-renderer/,
  );
});
