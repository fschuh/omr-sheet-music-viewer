import assert from "node:assert/strict";
import test from "node:test";
import { LISTEN_BENCHMARK_RENDERER } from "./listenBenchmarkAudio";
import { OnlineAmtOutputDecoder } from "./onlineAmtOutput";
import {
  applyListenRetriggerAcceptanceGates,
  auditListenRetriggerOpportunities,
  evaluateListenRetriggerDecoderCandidate,
  generateListenRetriggerCandidates,
  rankListenRetriggerCandidates,
  redecodeListenRecognitionTrace,
  type ListenRetriggerCandidateOptions,
  type ListenRetriggerCandidateResult,
  type ListenRetriggerCorpusEntry,
  type ListenRetriggerDecoderMetrics,
  type ListenRetriggerMatcherMetrics,
  type ListenRetriggerMatcherProfileEvaluation,
} from "./listenRetriggerBenchmark";
import {
  materializeListenSequence,
  productionListenMatcherProfile,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceDefinition,
} from "./listenSequenceBenchmark";

const candidateOptions: ListenRetriggerCandidateOptions = {
  id: "p0p450-r0p200-a0p200-l3-f2",
  enabled: true,
  peakThreshold: 0.45,
  riseThreshold: 0.2,
  rearmThreshold: 0.2,
  lookbackFrames: 3,
  refractoryFrames: 2,
};

type FrameKind = "silent" | "onset" | "weak-onset" | "low-sustain" | "high-sustain";

function scoresFor(kind: FrameKind): [number, number, number, number, number] {
  switch (kind) {
    case "onset": return [0.02, 0.03, 0.10, 0.70, 0.15];
    case "weak-onset": return [0.05, 0.05, 0.35, 0.30, 0.25];
    case "low-sustain": return [0.05, 0.05, 0.80, 0.05, 0.05];
    case "high-sustain": return [0.03, 0.02, 0.40, 0.25, 0.30];
    case "silent": return [1, 0, 0, 0, 0];
  }
}

function stateFor(kind: FrameKind): number {
  if (kind === "onset" || kind === "weak-onset") return 3;
  if (kind === "low-sustain" || kind === "high-sustain") return 2;
  return 0;
}

function definition(id = "retrigger-test"): ListenSequenceDefinition {
  return {
    id,
    family: "repeated-notes",
    label: "Retrigger test",
    targets: [[60], [60]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [60], expectedAdvance: true },
      { at: 1, targetIndex: 1, notes: [60], expectedAdvance: true },
    ],
  };
}

function makeTrace(
  sequenceId: string,
  intervalMs: number,
  kinds: readonly FrameKind[],
  resetFrame: number | null = null,
): ListenRecognitionTrace {
  const decoder = new OnlineAmtOutputDecoder();
  const frames: ListenRecognitionFrame[] = [];
  for (let index = 0; index < kinds.length; index += 1) {
    if (resetFrame === index) decoder.reset();
    const scores = new Float32Array(88 * 5);
    const states = new Uint8Array(88);
    scores.set(scoresFor(kinds[index]), 39 * 5);
    states[39] = stateFor(kinds[index]);
    const capturedAtMs = 192 + index * 32;
    const decoded = decoder.decode(scores, states, kinds[index] !== "silent", capturedAtMs, [60]);
    frames.push({
      capturedAtMs,
      onsets: decoded.onsets,
      noteEvents: decoded.noteEvents,
      activePitches: decoded.recognizedActivePitches,
      confidenceEvidence: [{
        midi: 60,
        confidence: decoded.targetPitchEvidence.find(({ midi }) => midi === 60)?.confidence ?? 0,
      }],
      modelScores: Array.from(scores),
      modelStates: Array.from(states),
      signalActive: kinds[index] !== "silent",
      inferenceDurationMs: 4,
    });
  }
  return {
    sequenceId,
    intervalMs,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [60],
    renderer: { ...LISTEN_BENCHMARK_RENDERER },
    audioDiagnostics: {
      frameCount: kinds.length,
      durationMs: kinds.length * 32,
      peak: 0.5,
      rms: 0.1,
    },
    resetPlan: resetFrame === null ? { mode: "stateful", points: [] } : {
      mode: "event-reset",
      points: [{
        frameIndex: resetFrame,
        eventIndex: 1,
        requestedAtMs: 0,
        actualFrameStartMs: resetFrame * 32,
        scheduledAttackTimeMs: 316,
        actualWarmupMs: 316 - resetFrame * 32,
      }],
    },
    pcm: new Float32Array(kinds.length * 512),
    frames,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
  };
}

function entryFor(
  kinds: readonly FrameKind[],
  update: { resetFrame?: number | null; secondAt?: number; id?: string } = {},
): ListenRetriggerCorpusEntry {
  const source = definition(update.id);
  if (update.secondAt !== undefined) {
    source.attacks = [source.attacks[0], { ...source.attacks[1], at: update.secondAt }];
  }
  const sequence = materializeListenSequence(source, 96);
  const trace = makeTrace(source.id, 96, kinds, update.resetFrame ?? null);
  return {
    key: `test:${source.id}`,
    source: "continuous-sequence",
    articulation: null,
    sequence,
    trace,
    baselineRun: replayListenSequenceTrace(sequence, trace),
  };
}

const hiddenKinds: FrameKind[] = [
  "silent",
  "onset",
  "low-sustain",
  "low-sustain",
  "high-sustain",
  "low-sustain",
  "low-sustain",
];

function decoderMetrics(update: Partial<ListenRetriggerDecoderMetrics> = {}): ListenRetriggerDecoderMetrics {
  return {
    missingPhysicalAttacksInProduction: 1,
    recoveredMissingPhysicalAttacks: 1,
    recoveryRate: 1,
    syntheticEventCount: 1,
    assignedSyntheticEventCount: 1,
    unassignedSyntheticEventCount: 0,
    duplicateNaturalEventCount: 0,
    heldNoteSyntheticEventCount: 0,
    releaseTailSyntheticEventCount: 0,
    legatoNonsharedSyntheticEventCount: 0,
    incompleteCarriedBassSyntheticEventCount: 0,
    naturalEventStreamDifferenceCount: 0,
    p50SyntheticLatencyMs: 4,
    p95SyntheticLatencyMs: 4,
    recoveriesByFamily: { "repeated-notes": 1 },
    recoveriesBySpeed: { "500": 1 },
    recoveriesByArticulation: {},
    syntheticEvents: [],
    ...update,
  };
}

function matcherMetrics(update: Partial<ListenRetriggerMatcherMetrics> = {}): ListenRetriggerMatcherMetrics {
  return {
    rawPhysicalAttackEvidence: 2,
    independentMatchCount: 2,
    orderedAdvanceCount: 2,
    orderedPrefixCompleted: 2,
    completePassageCount: 1,
    retriggerNotDetectedCount: 0,
    missingRequiredBassOnsetCount: 0,
    carryOverCount: 0,
    recognizedButBlockedCount: 0,
    cascadeLossCount: 0,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    incompleteCarriedBassAdvances: 0,
    p50IndependentMatchLatencyMs: 4,
    p95IndependentMatchLatencyMs: 4,
    p50OrderedAdvanceLatencyMs: 4,
    p95OrderedAdvanceLatencyMs: 4,
    independentAt1000Ms: 2,
    speedSummaries: [],
    articulationSummaries: [],
    safetyPassed: true,
    ...update,
  };
}

function profileEvaluation(
  label: "production" | "threshold-recommendation",
  passed = true,
): ListenRetriggerMatcherProfileEvaluation {
  const baseline = matcherMetrics({
    independentMatchCount: 1,
    orderedAdvanceCount: 1,
    orderedPrefixCompleted: 1,
    retriggerNotDetectedCount: 1,
    independentAt1000Ms: 1,
  });
  const candidate = matcherMetrics();
  return {
    label,
    profile: { ...productionListenMatcherProfile },
    baseline,
    candidate,
    independentMatchDelta: 1,
    orderedAdvanceDelta: 1,
    orderedPrefixDelta: 1,
    completePassageDelta: 0,
    targetedFailureReduction: 1,
    passed,
    rejectionReasons: passed ? [] : ["matcher-safety"],
  };
}

test("disabled trace re-decoding has exact production parity", () => {
  const entry = entryFor(hiddenKinds);
  const replay = redecodeListenRecognitionTrace(entry.trace);
  assert.equal(replay.productionParity, true);
  assert.deepEqual(replay.trace.frames, entry.trace.frames);
  assert.equal(replay.trace.pcm, entry.trace.pcm);
});

test("trace re-decoding honors reset plans and clears detector history", () => {
  const stateful = entryFor(hiddenKinds);
  assert.equal(redecodeListenRecognitionTrace(stateful.trace, candidateOptions).syntheticEvents.length, 1);
  const reset = entryFor(hiddenKinds, { resetFrame: 4 });
  assert.equal(redecodeListenRecognitionTrace(reset.trace, candidateOptions).syntheticEvents.length, 0);
});

test("corrected attribution accepts onset when acoustic overlap expects reOnset", () => {
  const entry = entryFor(["silent", "onset", "low-sustain", "low-sustain", "onset"]);
  const second = auditListenRetriggerOpportunities([entry]).opportunities.find(({ attackIndex }) => (
    attackIndex === 1
  ));
  assert.equal(second?.expectedTransitionType, "reOnset");
  assert.equal(second?.observedTransitionType, "onset");
  assert.notEqual(second?.classification, "hidden-rise-under-sustain");
});

test("audit classifies a missing sustain-state rise as hidden", () => {
  const audit = auditListenRetriggerOpportunities([entryFor(hiddenKinds)]);
  assert.equal(audit.hiddenRiseCount, 1);
  assert.equal(audit.conclusion, "hidden-score-rise-found");
});

test("audit distinguishes below-threshold events from matcher-blocked events", () => {
  const below = entryFor(["silent", "onset", "low-sustain", "low-sustain", "weak-onset"]);
  const belowSecond = auditListenRetriggerOpportunities([below]).opportunities.find(({ attackIndex }) => (
    attackIndex === 1
  ));
  assert.equal(belowSecond?.classification, "decoder-event-below-matcher-threshold");

  const blocked = entryFor(["silent", "onset", "low-sustain", "low-sustain", "onset"]);
  blocked.baselineRun.events[1].independentlyMatched = false;
  blocked.baselineRun.events[1].orderedAdvanced = false;
  blocked.baselineRun.events[1].primaryFailure = "carry-over";
  const blockedSecond = auditListenRetriggerOpportunities([blocked]).opportunities.find(({ attackIndex }) => (
    attackIndex === 1
  ));
  assert.equal(blockedSecond?.classification, "decoder-event-blocked-by-matcher");
});

test("synthetic attacks receive one-to-one physical attribution", () => {
  const result = evaluateListenRetriggerDecoderCandidate([entryFor(hiddenKinds)], candidateOptions);
  assert.equal(result.metrics.recoveredMissingPhysicalAttacks, 1);
  assert.equal(result.metrics.assignedSyntheticEventCount, 1);
  assert.equal(result.metrics.unassignedSyntheticEventCount, 0);
  assert.equal(result.metrics.syntheticEvents[0].assignedAttackIndex, 1);
});

test("unassigned held-note synthetic events are decoder false positives", () => {
  const result = evaluateListenRetriggerDecoderCandidate([entryFor([
    ...hiddenKinds,
    "high-sustain",
  ])], candidateOptions);
  const falseEvents = result.metrics.syntheticEvents.filter(({ unassigned }) => unassigned);
  assert.equal(falseEvents.length, 1);
  assert.equal(falseEvents[0].duringHeldNote, true);
});

test("the candidate grid is complete, stable, unique, and structurally valid", () => {
  const grid = generateListenRetriggerCandidates();
  assert.equal(grid.length, 432);
  assert.equal(new Set(grid.map(({ id }) => id)).size, 432);
  assert.ok(grid.some(({ id }) => id === "p0p450-r0p200-a0p200-l5-f3"));
  assert.ok(grid.every(({ rearmThreshold, peakThreshold }) => rearmThreshold < peakThreshold));
});

test("held-note output fails decoder acceptance", () => {
  const result = applyListenRetriggerAcceptanceGates(
    candidateOptions,
    decoderMetrics({ heldNoteSyntheticEventCount: 1, unassignedSyntheticEventCount: 1 }),
    [profileEvaluation("production"), profileEvaluation("threshold-recommendation")],
  );
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes("held-note-synthetic-event"));
});

test("an incomplete carried-bass synthetic event and advance are rejected", () => {
  const carriedProfile = profileEvaluation("production");
  carriedProfile.passed = false;
  carriedProfile.rejectionReasons = ["incomplete-carried-bass-advance"];
  const result = applyListenRetriggerAcceptanceGates(
    candidateOptions,
    decoderMetrics({ incompleteCarriedBassSyntheticEventCount: 1 }),
    [carriedProfile, profileEvaluation("threshold-recommendation")],
  );
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes("incomplete-carried-bass-synthetic-event"));
  assert.ok(result.rejectionReasons.includes("production:incomplete-carried-bass-advance"));
});

test("candidate ranking prioritizes recovery then independent matches and stable thresholds", () => {
  const make = (
    id: string,
    recovered: number,
    independentDelta: number,
    peakThreshold: number,
  ): ListenRetriggerCandidateResult => {
    const profile = profileEvaluation("production");
    profile.independentMatchDelta = independentDelta;
    return {
      options: { ...candidateOptions, id, peakThreshold },
      decoder: decoderMetrics({ recoveredMissingPhysicalAttacks: recovered }),
      matcherProfiles: [profile],
      rejectedByDecoderSafety: false,
      rejectedByMatcherSafety: false,
      eligible: true,
      rejectionReasons: [],
    };
  };
  const ranked = rankListenRetriggerCandidates([
    make("b", 1, 2, 0.55),
    make("c", 2, 0, 0.65),
    make("a", 1, 2, 0.65),
  ]);
  assert.deepEqual(ranked.map(({ options }) => options.id), ["c", "a", "b"]);
});

test("a candidate must pass both matcher profiles", () => {
  const result = applyListenRetriggerAcceptanceGates(
    candidateOptions,
    decoderMetrics(),
    [profileEvaluation("production"), profileEvaluation("threshold-recommendation", false)],
  );
  assert.equal(result.eligible, false);
  assert.equal(result.rejectedByMatcherSafety, true);
});

test("the audit takes the no-hidden-score-rise exit", () => {
  const audit = auditListenRetriggerOpportunities([entryFor([
    "silent", "onset", "low-sustain", "low-sustain", "low-sustain",
  ])]);
  assert.equal(audit.hiddenRiseCount, 0);
  assert.equal(audit.conclusion, "no-hidden-score-rise");
});

test("the no-safe-separation exit prevents candidate eligibility", () => {
  const result = applyListenRetriggerAcceptanceGates(
    candidateOptions,
    decoderMetrics(),
    [profileEvaluation("production"), profileEvaluation("threshold-recommendation")],
    "no-safe-separation",
  );
  assert.equal(result.eligible, false);
  assert.ok(result.rejectionReasons.includes("no-safe-separation"));
});
