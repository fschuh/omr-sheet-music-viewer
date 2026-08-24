import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LISTEN_ACTIVE_TARGET_GATES,
  LISTEN_ATTACK_EVIDENCE_WINDOW_MS,
  listenPitchEvidenceInWindow,
  LISTEN_ARCHIVED_DISCOVERY_VERDICTS,
  LISTEN_BASS_ONSET_GATES,
  LISTEN_COUNTERFACTUAL_PROFILE_IDS,
  LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS,
  LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS,
  isInsideListenHallucinationCorridor,
  listenArchivedDiscoveryVerdict,
  listenAttackEvidenceWindow,
  listenBassConfidenceBand,
  listenBassOnsetCensusByRenderer,
  listenCounterfactualProfiles,
  listenIsolatedBassOnsetObservation,
  listenIsolatedQualificationRecord,
  listenMatchedBassPairs,
  listenMusicalInputPair,
  listenRepeatedChordAttackRecords,
  listenRepeatedChordRecoveries,
  listenSequenceBassOnsetObservations,
  observeListenSequenceQualification,
  summarizeListenBassOnsetDistribution,
  type ListenBassOnsetObservation,
  type ListenBassTraceIdentity,
} from "./listenBassQualification";
import {
  LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID,
  LISTEN_PINNED_OMITTED_BASS_TRACE_IDS,
  LISTEN_REPEATED_CHORD_PITCHES,
  LISTEN_REPEATED_CHORD_TRACE_IDS,
  evaluateListenBassQualification,
  listenBassQualificationProfiles,
  listenBassQualificationTraces,
  listenOmittedBassCaseTraceIds,
} from "./listenBassQualificationBenchmark";
import {
  LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS,
  assertListenOmittedBassCaseReproduces,
  buildListenOmittedBassRegressionFixture,
  listenOmittedBassRegressionTrace,
  replayListenOmittedBassRegression,
  summarizeListenOmittedBassRegressions,
  type ListenOmittedBassRegressionFixture,
} from "./listenOmittedBassRegression";
import { LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST } from "./listenOmittedBassFixtures";
import {
  listenSafetyRegressionSequence,
  listenSafetyRegressionTrace,
} from "./listenSafetyRegression";
import { TONE_SALAMANDER_V05_LATE_ADVANCE } from "./listenSafetyRegressionFixtures";
import {
  LISTEN_MATCHER_PROFILES,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  materializeListenSequence,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceDefinition,
} from "./listenSequenceBenchmark";
import { LISTEN_BENCHMARK_RENDERER } from "./listenBenchmarkAudio";
import { LISTEN_ATTACK_BOUNDARY_EPSILON_MS } from "./listenSequenceBenchmark";
import { ExactChordMatcher, type ChordMatcherDecision } from "./chordMatcher";
import { matcherOptionsForListenMatcherProfile } from "./listenMatcherProfiles";
import { LISTEN_TRACE_MANIFEST } from "./listenTraceManifest";

const V05 = TONE_SALAMANDER_V05_LATE_ADVANCE;
const V05_SEQUENCE = listenSafetyRegressionSequence(V05);
const V05_TRACE = listenSafetyRegressionTrace(V05);
const V05_IDENTITY: ListenBassTraceIdentity = {
  traceId: "dynamics-constant/tone/salamander/v05",
  suite: "dynamics-constant",
  partition: "regression-only",
  rendererKey: "tone",
};

function profile(id: ListenMatcherProfileId) {
  return listenMatcherThresholds(LISTEN_MATCHER_PROFILES[id]);
}

/* --------------------------------------------------------------------- *
 * Bands, corridors, and pair identity
 * --------------------------------------------------------------------- */

test("confidence bands split exactly at the gates under discussion", () => {
  assert.equal(listenBassConfidenceBand(null), "no-onset");
  assert.equal(listenBassConfidenceBand(0), "below-0.45");
  assert.equal(listenBassConfidenceBand(0.4499), "below-0.45");
  assert.equal(listenBassConfidenceBand(0.45), "0.45-0.50");
  assert.equal(listenBassConfidenceBand(0.4999), "0.45-0.50");
  assert.equal(listenBassConfidenceBand(0.5), "0.50-0.60");
  assert.equal(listenBassConfidenceBand(0.5999), "0.50-0.60");
  assert.equal(listenBassConfidenceBand(0.6), "0.60-0.90");
  assert.equal(listenBassConfidenceBand(0.8999), "0.60-0.90");
  assert.equal(listenBassConfidenceBand(0.9), "0.90-1.00");
  assert.equal(listenBassConfidenceBand(1), "0.90-1.00");
  assert.throws(() => listenBassConfidenceBand(1.0001), /outside \[0, 1\]/);
  assert.throws(() => listenBassConfidenceBand(-0.001), /outside \[0, 1\]/);
});

test("the hallucination corridor is closed at 0.50 and open at 0.60", () => {
  assert.equal(isInsideListenHallucinationCorridor(0.4999), false);
  assert.equal(isInsideListenHallucinationCorridor(0.5), true);
  assert.equal(isInsideListenHallucinationCorridor(0.5968), true);
  assert.equal(isInsideListenHallucinationCorridor(0.6), false);
  assert.equal(isInsideListenHallucinationCorridor(null), false);
});

test("a musical-input pair is order-insensitive and keeps both sides", () => {
  assert.equal(listenMusicalInputPair([82, 62, 74], [74, 82]), "62+74+82|74+82");
  assert.equal(
    listenMusicalInputPair([62, 74, 82], [62, 74, 82]),
    listenMusicalInputPair([82, 74, 62], [74, 62, 82]),
  );
  assert.notEqual(
    listenMusicalInputPair([62, 74, 82], [74, 82]),
    listenMusicalInputPair([62, 74, 82], [62, 74, 82]),
  );
});

/* --------------------------------------------------------------------- *
 * Distributions
 * --------------------------------------------------------------------- */

function observation(
  overrides: Partial<ListenBassOnsetObservation> & Pick<ListenBassOnsetObservation, "kind">,
): ListenBassOnsetObservation {
  const targetPitches = overrides.targetPitches ?? [48, 60, 68];
  const playedPitches = overrides.playedPitches ??
    (overrides.kind === "genuine" ? targetPitches : targetPitches.slice(1));
  const onsetConfidence = overrides.onsetConfidence ?? null;
  return {
    traceId: "isolated/direct/001",
    suite: "isolated",
    partition: "confirmation",
    rendererKey: "direct",
    musicalInputPair: listenMusicalInputPair(targetPitches, playedPitches),
    targetPitches,
    playedPitches,
    bassMidi: Math.min(...targetPitches),
    attackIndex: null,
    targetIndex: null,
    windowStartMs: 0,
    windowEndMs: 1_000,
    onsetNoteConfidence: null,
    onsetTimeMs: null,
    targetEvidence: 0,
    ...overrides,
    onsetConfidence,
    band: listenBassConfidenceBand(onsetConfidence),
  };
}

test("a genuine distribution counts pairs by their weakest instance", () => {
  const distribution = summarizeListenBassOnsetDistribution("genuine", [
    observation({ kind: "genuine", traceId: "a", onsetConfidence: 0.99 }),
    observation({ kind: "genuine", traceId: "b", onsetConfidence: 0.55 }),
    observation({
      kind: "genuine",
      traceId: "c",
      targetPitches: [50, 62, 70],
      onsetConfidence: 0.99,
    }),
  ]);
  assert.equal(distribution.pairRepresentative, "weakest");
  assert.equal(distribution.observationCount, 3);
  assert.equal(distribution.uniquePairCount, 2);
  // Raw counting sees two strong attacks; the pair view sees one weak pair, and
  // the 0.60 gate refuses that pair however many times it was rendered.
  assert.equal(distribution.bands.find(({ band }) => band === "0.50-0.60")?.count, 1);
  assert.equal(distribution.pairBands.find(({ band }) => band === "0.50-0.60")?.count, 1);
  assert.equal(distribution.pairBands.find(({ band }) => band === "0.90-1.00")?.count, 1);
  assert.deepEqual(
    distribution.gates.find(({ gate }) => gate === 0.6),
    { gate: 0.6, rawRefusedCount: 1, pairRefusedCount: 1 },
  );
  assert.deepEqual(
    distribution.gates.find(({ gate }) => gate === 0.5),
    { gate: 0.5, rawRefusedCount: 0, pairRefusedCount: 0 },
  );
  assert.deepEqual(distribution.corridor, { rawCount: 1, pairCount: 1 });
});

test("a hallucinated distribution counts pairs by their strongest instance", () => {
  const distribution = summarizeListenBassOnsetDistribution("hallucinated", [
    observation({ kind: "hallucinated", traceId: "a", onsetConfidence: null }),
    observation({ kind: "hallucinated", traceId: "b", onsetConfidence: 0.55 }),
  ]);
  assert.equal(distribution.pairRepresentative, "strongest");
  assert.equal(distribution.uniquePairCount, 1);
  assert.equal(distribution.withoutOnsetCount, 1);
  // A gate has to refuse the strongest phantom onset, so the pair is banded by
  // 0.55 rather than by the rendering that decoded nothing at all.
  assert.equal(distribution.pairBands.find(({ band }) => band === "0.50-0.60")?.count, 1);
  assert.equal(distribution.pairBands.find(({ band }) => band === "no-onset")?.count, 0);
  assert.equal(
    distribution.gates.find(({ gate }) => gate === 0.6)?.pairRefusedCount,
    1,
  );
  assert.equal(
    distribution.gates.find(({ gate }) => gate === 0.5)?.pairRefusedCount,
    0,
  );
});

test("a distribution refuses an observation of the other kind", () => {
  assert.throws(
    () => summarizeListenBassOnsetDistribution("genuine", [
      observation({ kind: "hallucinated" }),
    ]),
    /another kind/,
  );
});

test("a census reports every renderer column beside the combined one", () => {
  const census = listenBassOnsetCensusByRenderer("isolated", [
    observation({ kind: "genuine", traceId: "isolated/direct/001", onsetConfidence: 0.99 }),
    observation({
      kind: "genuine",
      traceId: "isolated/tone/001",
      rendererKey: "tone",
      onsetConfidence: 0.52,
    }),
  ]);
  assert.deepEqual(census.map(({ scope }) => scope), [
    "isolated/direct",
    "isolated/tone",
    "isolated/both",
  ]);
  assert.equal(census[0].genuine.corridor.rawCount, 0);
  assert.equal(census[1].genuine.corridor.rawCount, 1);
  assert.equal(census[2].genuine.observationCount, 2);
});

test("matched pairs need the same target chord played both ways", () => {
  const pairs = listenMatchedBassPairs([
    observation({ kind: "genuine", traceId: "a" }),
    observation({ kind: "hallucinated", traceId: "b" }),
    observation({ kind: "genuine", traceId: "c", targetPitches: [50, 62, 70] }),
  ]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].targetPitches, [48, 60, 68]);
  assert.deepEqual(pairs[0].genuine.map(({ traceId }) => traceId), ["a"]);
  assert.deepEqual(pairs[0].hallucinated.map(({ traceId }) => traceId), ["b"]);
});

/* --------------------------------------------------------------------- *
 * Attack windows and continuous observations
 * --------------------------------------------------------------------- */

test("an attack owns its window only until the next attack begins", () => {
  const sequence = materializeListenSequence(bassProbeDefinition(), 200);
  const first = listenAttackEvidenceWindow(sequence, sequence.attacks[0]);
  assert.equal(first.windowStartMs, sequence.attacks[0].scheduledAtMs);
  // 200 ms of separation is shorter than the attribution window, so the second
  // attack's own onsets can never be credited to the first, and exactly one
  // attack owns the instant the next one begins.
  assert.ok(first.windowEndMs < sequence.attacks[1].scheduledAtMs);
  assert.equal(
    first.windowEndMs,
    sequence.attacks[1].scheduledAtMs - LISTEN_ATTACK_BOUNDARY_EPSILON_MS,
  );
  const last = listenAttackEvidenceWindow(sequence, sequence.attacks[2]);
  // The final attack has no successor, so it keeps the whole attribution window.
  assert.equal(last.windowEndMs, last.windowStartMs + LISTEN_ATTACK_EVIDENCE_WINDOW_MS);
  assert.ok(LISTEN_ATTACK_EVIDENCE_WINDOW_MS > 400);
});

/**
 * One triad played first without its bass and then complete, followed by a
 * two-note target. The three attacks cover a hallucinated bass, a genuine one,
 * and a target the fresh-bass rule does not apply to.
 */
function bassProbeDefinition(): ListenSequenceDefinition {
  return {
    id: "bass-probe",
    family: "probe",
    label: "bass probe",
    targets: [[48, 60, 68], [64, 72]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [{ midi: 60 }, { midi: 68 }], expectedAdvance: false },
      {
        at: 1,
        targetIndex: 0,
        notes: [{ midi: 48 }, { midi: 60 }, { midi: 68 }],
        expectedAdvance: true,
      },
      { at: 2, targetIndex: 1, notes: [{ midi: 64 }, { midi: 72 }], expectedAdvance: true },
    ],
  };
}

function frame(
  capturedAtMs: number,
  onsets: Array<{ midi: number; confidence: number }>,
  evidence: Array<{ midi: number; confidence: number }> = [],
): ListenRecognitionFrame {
  return {
    capturedAtMs,
    onsets: onsets.map(({ midi, confidence }) => ({
      midi,
      confidence,
      noteConfidence: confidence,
      onsetTimeMs: capturedAtMs,
    })),
    noteEvents: onsets.map(({ midi, confidence }) => ({
      midi,
      type: "onset" as const,
      confidence,
      eventTimeMs: capturedAtMs,
    })),
    activePitches: onsets.map(({ midi, confidence }) => ({ midi, confidence })),
    confidenceEvidence: evidence,
    modelScores: [],
    modelStates: [],
    signalActive: true,
    inferenceDurationMs: 0,
  };
}

function trace(frames: ListenRecognitionFrame[]): ListenRecognitionTrace {
  return {
    sequenceId: "probe",
    intervalMs: 0,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [],
    renderer: LISTEN_BENCHMARK_RENDERER,
    audioDiagnostics: { frameCount: frames.length, durationMs: 0, peak: 0, rms: 0 },
    // A fixture records the rendered audio's own identity, so a probe trace has
    // to carry one exactly as a captured trace does.
    audioSignature: {
      sampleRate: 16_000,
      chunkSize: 512,
      frameCount: frames.length,
      pcmByteLength: 0,
      pcmHash: "probe-pcm",
      chunkHashes: [],
    },
    pcm: new Float32Array(0),
    frames,
    maximumInferenceMs: 0,
    maximumProcessingBacklogMs: 0,
  };
}

test("an onset on an attack boundary is credited to exactly one attack", () => {
  // 200 ms of separation is shorter than the attribution window, so the first
  // attack's window is the one the next attack cuts short. At a 1,000 ms spacing
  // the windows never touch and the boundary is not exercised at all.
  const sequence = materializeListenSequence(bassProbeDefinition(), 200);
  const [first, second] = sequence.attacks;
  // A decoded onset landing exactly on the second attack's scheduled time. The
  // 32 ms frame cadence and the attack schedule do coincide in the real corpus,
  // so this is the case that decides whether a window owns its own boundary.
  const boundary = trace([
    frame(second.scheduledAtMs, [{ midi: 48, confidence: 0.77 }]),
  ]);
  const observations = listenSequenceBassOnsetObservations(
    { traceId: "probe", suite: "sequence", partition: "discovery", rendererKey: "direct" },
    sequence,
    boundary,
  );
  const credited = observations.filter(({ onsetConfidence }) => onsetConfidence !== null);
  assert.equal(credited.length, 1, "a boundary onset belongs to one attack, not two");
  assert.equal(credited[0].attackIndex, second.index);
  assert.equal(
    listenPitchEvidenceInWindow(
      boundary.frames,
      48,
      ...Object.values(listenAttackEvidenceWindow(sequence, first)) as [number, number],
    ).onsetConfidence,
    null,
  );
});

test("continuous bass observations separate sounded attacks from phantom ones", () => {
  const sequence = materializeListenSequence(bassProbeDefinition(), 1_000);
  const [first, second, third] = sequence.attacks;
  const observations = listenSequenceBassOnsetObservations(
    { traceId: "probe", suite: "sequence", partition: "discovery", rendererKey: "direct" },
    sequence,
    trace([
      frame(first.scheduledAtMs + 32, [{ midi: 48, confidence: 0.55 }]),
      frame(second.scheduledAtMs + 32, [{ midi: 48, confidence: 0.81 }]),
      frame(third.scheduledAtMs + 32, [{ midi: 64, confidence: 0.99 }]),
    ]),
  );
  // The two-note target has no fresh-bass rule to pay for, so it is not observed.
  assert.deepEqual(observations.map(({ attackIndex }) => attackIndex), [0, 1]);
  assert.equal(observations[0].kind, "hallucinated");
  assert.equal(observations[0].onsetConfidence, 0.55);
  assert.equal(observations[0].band, "0.50-0.60");
  assert.equal(observations[1].kind, "genuine");
  assert.equal(observations[1].onsetConfidence, 0.81);
  assert.equal(observations[0].musicalInputPair, "48+60+68|60+68");
  assert.equal(observations[1].musicalInputPair, "48+60+68|48+60+68");
});

test("an isolated observation reads the whole trace and skips small targets", () => {
  const identity: ListenBassTraceIdentity = {
    traceId: "isolated/direct/122",
    suite: "isolated",
    partition: "confirmation",
    rendererKey: "direct",
  };
  const observed = listenIsolatedBassOnsetObservation(
    identity,
    [48, 60, 68],
    [60, 68],
    trace([frame(220, [{ midi: 60, confidence: 0.99 }]), frame(400, [{ midi: 48, confidence: 0.53 }])]),
  );
  assert.ok(observed);
  assert.equal(observed.kind, "hallucinated");
  assert.equal(observed.onsetConfidence, 0.53);
  assert.equal(listenIsolatedBassOnsetObservation(identity, [64, 72], [72], trace([])), null);
});

/* --------------------------------------------------------------------- *
 * The repeated chord
 * --------------------------------------------------------------------- */

test("attaching an observer changes no matcher decision", () => {
  const options = matcherOptionsForListenMatcherProfile(profile("baseline-v1"));
  const frames = V05_TRACE.frames;
  const consume = (matcher: ExactChordMatcher) => frames.map((entry) => matcher.consume({
    generation: 1,
    onsets: entry.onsets,
    noteEvents: entry.noteEvents,
    recognizedActivePitches: entry.activePitches,
    targetPitchEvidence: entry.confidenceEvidence,
    processingTimeMs: 0,
    capturedAtMs: entry.capturedAtMs,
  }));
  const plain = new ExactChordMatcher(options);
  plain.setTarget([62, 74, 82], 1, 0);
  const decisions: ChordMatcherDecision[] = [];
  const observed = new ExactChordMatcher(options, (decision) => decisions.push(decision));
  observed.setTarget([62, 74, 82], 1, 0);
  assert.deepEqual(consume(observed), consume(plain));
  assert.ok(decisions.length > 0);
  // Every decision names a verdict the matcher took, not a category invented here.
  assert.ok(decisions.some((decision) => decision.kind === "onset"));
  assert.ok(decisions.some((decision) => decision.kind === "target-evidence"));
  assert.ok(decisions.some((decision) => decision.kind === "frame"));
});

test("observing a replay cannot change it", () => {
  for (const id of ["baseline-v1", "early-open-v2", "steady-held-v2"] as ListenMatcherProfileId[]) {
    const observed = observeListenSequenceQualification(V05_SEQUENCE, V05_TRACE, profile(id));
    const plain = replayListenSequenceTrace(
      V05_SEQUENCE,
      V05_TRACE,
      "current-matcher",
      profile(id),
    );
    assert.deepEqual(
      observed.run.events.map((event) => [event.index, event.advanced, event.advancedAtMs]),
      plain.events.map((event) => [event.index, event.advanced, event.advancedAtMs]),
    );
    assert.ok(observed.decisions.length > 0);
  }
});

test("the v05 transition is an upper-voice evidence failure, not a bass defect", () => {
  const records = listenRepeatedChordAttackRecords(
    V05_IDENTITY,
    V05_SEQUENCE,
    V05_TRACE,
    profile("baseline-v1"),
    LISTEN_REPEATED_CHORD_PITCHES,
  );
  assert.deepEqual(records.map(({ role }) => role), [
    "transition",
    "exact-repetition",
    "exact-repetition",
  ]);
  const transition = records[0];
  // The preceding chord is [65, 74, 82]: the bass is new to the score and the
  // two upper voices repeat. Neither is still sounding — a 420 ms hold at a
  // 1,000 ms interval has been released — so a record that claimed every pitch
  // carried would be wrong in both senses.
  assert.deepEqual(transition.previousAttackPitches, [65, 74, 82]);
  assert.deepEqual(
    transition.pitches.map(({ midi, playedByPreviousAttack }) => [midi, playedByPreviousAttack]),
    [[62, false], [74, true], [82, true]],
  );
  assert.deepEqual(transition.pitches.map(({ soundingBeforeAttack }) => soundingBeforeAttack), [
    false,
    false,
    false,
  ]);
  assert.equal(transition.chordIsArmedTarget, true);
  assert.ok(transition.pitches.every(({ isArmedTargetPitch }) => isArmedTargetPitch));
  assert.deepEqual(transition.carriedPitches, []);
  assert.deepEqual(transition.freshPitches, [62, 74, 82]);
  // The bass qualified from its own fresh onset at 0.9954; the D5 produced no
  // onset at all and only 0.1935 of sustained evidence.
  const [bass, d5, upper] = transition.pitches;
  assert.equal(bass.role, "bass");
  assert.equal(bass.qualified, true);
  assert.equal(bass.path, "qualified-by-fresh-onset");
  assert.ok((bass.onsetConfidence ?? 0) > 0.99);
  assert.equal(d5.midi, 74);
  assert.equal(d5.onsetConfidence, null);
  assert.ok(Math.abs(d5.targetEvidence - 0.1935) < 0.0005, `D5 evidence ${d5.targetEvidence}`);
  assert.equal(d5.qualified, false);
  assert.equal(d5.path, "active-target-evidence-rejected");
  assert.equal(d5.limitingEvidenceVerdict, "below-active-gate");
  assert.equal(upper.qualified, true);
  assert.deepEqual(transition.limitingPitches, [74]);
  assert.deepEqual(transition.limitingPaths, ["active-target-evidence-rejected"]);
  assert.equal(transition.lowestLimitingUpperVoiceEvidence, d5.targetEvidence);
  // No active-target gate in the version-1 grid accepts 0.1935.
  assert.deepEqual(d5.activeGatesCleared, []);
  assert.deepEqual(d5.activeGatesRefusing, [...LISTEN_ACTIVE_TARGET_GATES]);
});

test("the v05 second repetition is limited by the bass onset alone", () => {
  const [, second] = listenRepeatedChordAttackRecords(
    V05_IDENTITY,
    V05_SEQUENCE,
    V05_TRACE,
    profile("baseline-v1"),
    LISTEN_REPEATED_CHORD_PITCHES,
  );
  const [bass, d5] = second.pitches;
  assert.ok(
    Math.abs((bass.onsetConfidence ?? 0) - 0.5968) < 0.0005,
    `bass onset ${bass.onsetConfidence}`,
  );
  assert.equal(bass.insideHallucinationCorridor, true);
  assert.deepEqual(bass.onsetGatesCleared, [0.45, 0.5]);
  assert.deepEqual(bass.onsetGatesRefusing, [0.6]);
  assert.equal(bass.qualified, false);
  assert.equal(bass.path, "fresh-onset-rejected");
  assert.equal(bass.limitingOnsetVerdict, "below-onset-gate");
  // By the second repetition the D5 has enough sustained evidence for the
  // incumbent's own 0.35 active gate, so it is no longer what limits the target.
  assert.ok(Math.abs(d5.targetEvidence - 0.4587) < 0.0005, `D5 evidence ${d5.targetEvidence}`);
  assert.equal(d5.qualified, true);
  assert.equal(d5.path, "qualified-by-sustained-evidence");
  assert.deepEqual(second.limitingPitches, [62]);
  assert.deepEqual(second.limitingPaths, ["fresh-onset-rejected"]);
  assert.equal(second.lowestLimitingUpperVoiceEvidence, null);
});

test("a repetition the playhead never armed is reported as such", () => {
  // The matcher stays armed on the first target of the fixture, so asking for a
  // chord that never becomes a target reproduces the stalled-run case: decoded
  // evidence is still measured, and no gate verdict is attributed to it.
  const records = listenRepeatedChordAttackRecords(
    V05_IDENTITY,
    V05_SEQUENCE,
    V05_TRACE,
    profile("baseline-v1"),
    [65, 74, 82],
  );
  assert.equal(records.length, 1);
  const [only] = records;
  assert.equal(only.chordIsArmedTarget, true);
  const elsewhere = listenRepeatedChordAttackRecords(
    V05_IDENTITY,
    V05_SEQUENCE,
    V05_TRACE,
    profile("baseline-v1"),
    LISTEN_REPEATED_CHORD_PITCHES,
  )[2];
  // The third repetition is judged against target 1, which is the same chord.
  assert.equal(elsewhere.chordIsArmedTarget, true);
});

test("the repeated chord costs a full attack of lag under the incumbent", () => {
  const observed = observeListenSequenceQualification(
    V05_SEQUENCE,
    V05_TRACE,
    profile("baseline-v1"),
  );
  const [first] = listenRepeatedChordRecoveries(
    V05_SEQUENCE,
    observed.run,
    observed.advancements,
    LISTEN_REPEATED_CHORD_PITCHES,
  );
  assert.equal(first.advanced, true);
  assert.equal(first.sourceDistance, 2);
  assert.equal(first.attributionDelayMs, 2_220);
  assert.deepEqual(first.classification, ["late-advance"]);
  const candidate = observeListenSequenceQualification(
    V05_SEQUENCE,
    V05_TRACE,
    profile("early-open-v2"),
  );
  const [candidateFirst] = listenRepeatedChordRecoveries(
    V05_SEQUENCE,
    candidate.run,
    candidate.advancements,
    LISTEN_REPEATED_CHORD_PITCHES,
  );
  // Halved, not resolved: no measured profile reaches source distance 0.
  assert.equal(candidateFirst.sourceDistance, 1);
  assert.equal(candidateFirst.attributionDelayMs, 1_228);
  assert.deepEqual(candidateFirst.classification, ["late-advance"]);
});

/* --------------------------------------------------------------------- *
 * The sixteen counterfactuals
 * --------------------------------------------------------------------- */

test("the counterfactual set is exactly the two documented families", () => {
  assert.equal(LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS.length, 4);
  assert.equal(LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS.length, 12);
  assert.equal(LISTEN_COUNTERFACTUAL_PROFILE_IDS.length, 16);
  const profiles = listenCounterfactualProfiles();
  assert.equal(profiles.length, 16);
  for (const entry of profiles) {
    assert.equal(entry.onsetThreshold, 0.6);
    assert.equal(entry.requireFreshBassOnset, true);
  }
  for (const entry of profiles.slice(0, 4)) {
    assert.equal(entry.activeTargetThreshold, 0.2);
    assert.equal(entry.targetNoteThreshold, 0.5);
  }
  for (const entry of profiles.slice(4)) {
    assert.equal(entry.activeTargetThreshold, 0.275);
    assert.notEqual(entry.extraNoteThreshold, 0.99);
  }
  assert.deepEqual(
    [...new Set(profiles.slice(4).map(({ targetNoteThreshold }) => targetNoteThreshold))].sort(),
    [0.35, 0.425, 0.5, 0.575],
  );
  assert.deepEqual(
    [...new Set(profiles.slice(4).map(({ extraNoteThreshold }) => extraNoteThreshold))].sort(),
    [0.9, 0.94, 0.97],
  );
});

test("the round-one verdicts quoted for the counterfactuals match the frozen archive", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const archive = JSON.parse(readFileSync(
    join(root, "benchmark-results", "listen-matcher-multidomain-sweep-task08.json"),
    "utf8",
  )) as Array<{ candidateArchive: { candidates: Array<Record<string, any>> } }>;
  const candidates = archive[0].candidateArchive.candidates;
  assert.equal(LISTEN_ARCHIVED_DISCOVERY_VERDICTS.length, 16);
  for (const quoted of LISTEN_ARCHIVED_DISCOVERY_VERDICTS) {
    const row = candidates.find((entry) => entry.profile.id === quoted.profileId);
    assert.ok(row, `${quoted.profileId} is absent from the Task 08 archive`);
    const verdict = row.safetyVerdict;
    assert.equal(verdict.passed, quoted.passed, quoted.profileId);
    assert.deepEqual(verdict.rejectionCodes, quoted.rejectionCodes, quoted.profileId);
    assert.deepEqual(
      verdict.discoveryRegressions.map((entry: { traceId: string }) => entry.traceId),
      quoted.discoveryRegressionTraceIds,
      quoted.profileId,
    );
    assert.equal(
      verdict.regressionRunLateAdvanceCount,
      quoted.regressionRunLateAdvanceCount,
      quoted.profileId,
    );
    assert.equal(
      verdict.committedRegressionPassed,
      quoted.committedRegressionPassed,
      quoted.profileId,
    );
    assert.equal(
      verdict.committedRegressionDeviationCount,
      quoted.committedRegressionDeviationCount,
      quoted.profileId,
    );
  }
  assert.throws(() => listenArchivedDiscoveryVerdict("baseline-v1"), /No archived round-one/);
});

test("all four open-active counterfactuals were rejected on the same two traces", () => {
  for (const profileId of LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS) {
    const verdict = listenArchivedDiscoveryVerdict(profileId);
    assert.equal(verdict.passed, false, profileId);
    assert.ok(verdict.rejectionCodes.includes("discovery-safety-regression"), profileId);
    for (const traceId of [
      "sequence/tone/course-clear-27/167ms",
      "dynamics-constant/tone/salamander/v14",
    ]) {
      assert.ok(verdict.discoveryRegressionTraceIds.includes(traceId), `${profileId} ${traceId}`);
    }
  }
  // Only the 0.99 extra-note variant additionally lost a committed regression.
  assert.deepEqual(
    LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS
      .filter((id) => !listenArchivedDiscoveryVerdict(id).committedRegressionPassed),
    ["o0p600-t0p500-a0p200-x0p990-b1"],
  );
  for (const profileId of LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS) {
    assert.equal(listenArchivedDiscoveryVerdict(profileId).passed, true, profileId);
  }
});

/* --------------------------------------------------------------------- *
 * Pinned omitted-bass regressions
 * --------------------------------------------------------------------- */

/**
 * One isolated trial that plays a triad without its bass while the decoder
 * hallucinates that bass at 0.55 — inside the corridor, so `baseline-v1` refuses
 * it at 0.60 and every `v2` candidate admits it.
 */
function omittedBassTrace(bassConfidence: number): ListenRecognitionTrace {
  return trace([
    frame(220, []),
    frame(252, [
      { midi: 60, confidence: 0.99 },
      { midi: 68, confidence: 0.99 },
      { midi: 48, confidence: bassConfidence },
    ], [
      { midi: 48, confidence: bassConfidence },
      { midi: 60, confidence: 0.99 },
      { midi: 68, confidence: 0.99 },
    ]),
    frame(284, [], [
      { midi: 48, confidence: bassConfidence },
      { midi: 60, confidence: 0.99 },
      { midi: 68, confidence: 0.99 },
    ]),
  ]);
}

function omittedBassFixture(bassConfidence = 0.55): ListenOmittedBassRegressionFixture {
  return buildListenOmittedBassRegressionFixture(
    {
      id: "probe-omitted-bass",
      label: "probe · omitted bass",
      traceId: "isolated/direct/122",
      renderer: LISTEN_BENCHMARK_RENDERER.version,
      caseIndex: 122,
      sourcePcmHash: "00000000",
      sourceRecognitionStructureHash: "11111111",
      conclusion: "Probe fixture.",
    },
    [48, 60, 68],
    [60, 68],
    omittedBassTrace(bassConfidence),
  );
}

test("an omitted-bass fixture pins the incumbent's refusal and each candidate's advance", () => {
  const fixture = omittedBassFixture();
  assert.equal(fixture.bassMidi, 48);
  assert.ok(fixture.hallucinatedBassOnset);
  assert.equal(fixture.hallucinatedBassOnset?.confidence, 0.55);
  assert.deepEqual(
    fixture.pinnedOutcomes.map(({ profileId }) => profileId),
    [...LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS],
  );
  const [baseline, ...candidates] = fixture.pinnedOutcomes;
  assert.equal(baseline.profileId, "baseline-v1");
  assert.equal(baseline.advanced, false);
  assert.equal(baseline.primaryLimitingPath, "fresh-onset-rejected");
  assert.deepEqual(baseline.hallucinatedQualifiedPitches, []);
  for (const candidate of candidates) {
    assert.equal(candidate.advanced, true, candidate.profileId);
    assert.deepEqual(candidate.hallucinatedQualifiedPitches, [48], candidate.profileId);
  }
  assert.deepEqual(
    replayListenOmittedBassRegression(fixture).map(({ satisfied }) => satisfied),
    [true, true, true, true, true],
  );
});

test("a fixture whose frames stop producing the phantom onset deviates", () => {
  const fixture = omittedBassFixture();
  const weakened: ListenOmittedBassRegressionFixture = {
    ...fixture,
    frames: omittedBassFixture(0.44).frames,
  };
  const outcomes = replayListenOmittedBassRegression(weakened);
  assert.equal(outcomes[0].satisfied, true, "the incumbent still refuses");
  for (const outcome of outcomes.slice(1)) {
    assert.equal(outcome.satisfied, false, outcome.profileId);
    assert.ok(outcome.deviations.some((entry) => entry.includes("refused, pinned advance")));
  }
});

test("a fixture that never lost its bass is refused at build time", () => {
  assert.throws(
    () => buildListenOmittedBassRegressionFixture(
      {
        id: "probe",
        label: "probe",
        traceId: "isolated/direct/001",
        renderer: LISTEN_BENCHMARK_RENDERER.version,
        caseIndex: 1,
        sourcePcmHash: "0",
        sourceRecognitionStructureHash: "0",
        conclusion: "",
      },
      [48, 60, 68],
      [48, 60, 68],
      omittedBassTrace(0.55),
    ),
    /sounded its bass pitch/,
  );
  assert.throws(
    () => buildListenOmittedBassRegressionFixture(
      {
        id: "probe",
        label: "probe",
        traceId: "isolated/direct/001",
        renderer: LISTEN_BENCHMARK_RENDERER.version,
        caseIndex: 1,
        sourcePcmHash: "0",
        sourceRecognitionStructureHash: "0",
        conclusion: "",
      },
      [60, 68],
      [68],
      omittedBassTrace(0.55),
    ),
    /not a triad/,
  );
});

test("a fixture missing a pinned profile is refused at replay time", () => {
  const fixture = omittedBassFixture();
  assert.throws(
    () => replayListenOmittedBassRegression({
      ...fixture,
      pinnedOutcomes: fixture.pinnedOutcomes.filter(({ profileId }) => profileId !== "baseline-v1"),
    }),
    /pins no outcome for baseline-v1/,
  );
});

test("the rebuilt fixture trace carries the frames the matcher reads", () => {
  const fixture = omittedBassFixture();
  const rebuilt = listenOmittedBassRegressionTrace(fixture);
  assert.equal(rebuilt.frames.length, fixture.frames.length);
  assert.equal(rebuilt.pcm.length, 0);
  assert.deepEqual(
    rebuilt.frames.map(({ capturedAtMs }) => capturedAtMs),
    fixture.frames.map(({ capturedAtMs }) => capturedAtMs),
  );
  const record = listenIsolatedQualificationRecord(
    {
      traceId: fixture.id,
      suite: "isolated",
      partition: "confirmation",
      rendererKey: "direct",
    },
    fixture.targetPitches,
    fixture.playedPitches,
    rebuilt,
    profile("baseline-v1"),
    fixture.origin.caseIndex,
  );
  assert.equal(record.advanced, false);
  assert.equal(record.pitches.find(({ midi }) => midi === 48)?.insideHallucinationCorridor, true);
});

test("every committed omitted-bass fixture still reproduces", () => {
  const summary = summarizeListenOmittedBassRegressions();
  assert.equal(summary.fixtureCount, LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST.length);
  assert.equal(summary.deviationCount, 0);
  assert.equal(summary.passed, true);
});

/* --------------------------------------------------------------------- *
 * The corpus and the column order
 * --------------------------------------------------------------------- */

test("a captured trial that no longer reproduces its committed fixture fails the run", () => {
  const fixture = omittedBassFixture();
  assert.throws(
    () => assertListenOmittedBassCaseReproduces(
      fixture.origin.traceId,
      "deadbeef",
      fixture.pinnedOutcomes,
      [fixture],
    ),
    /no longer reproduces/,
  );
  assert.throws(
    () => assertListenOmittedBassCaseReproduces(
      fixture.origin.traceId,
      fixture.origin.sourceRecognitionStructureHash,
      fixture.pinnedOutcomes.map((outcome) => (
        outcome.profileId === "baseline-v1" ? { ...outcome, advanced: true } : outcome
      )),
      [fixture],
    ),
    /baseline-v1 advanced the rendered trial, pinned refusal/,
  );
  // The decoded-structure hash excludes confidence values, so an advance that
  // moved later can reach this check with the hash intact. Only the pinned
  // latency catches it.
  assert.throws(
    () => assertListenOmittedBassCaseReproduces(
      fixture.origin.traceId,
      fixture.origin.sourceRecognitionStructureHash,
      fixture.pinnedOutcomes.map((outcome) => (
        outcome.profileId === "early-open-v2"
          ? { ...outcome, onsetToAdvanceMs: (outcome.onsetToAdvanceMs ?? 0) + 32 }
          : outcome
      )),
      [fixture],
    ),
    /early-open-v2 advanced the rendered trial at \d+ ms, pinned \d+ ms/,
  );
  assert.deepEqual(
    assertListenOmittedBassCaseReproduces(
      fixture.origin.traceId,
      fixture.origin.sourceRecognitionStructureHash,
      fixture.pinnedOutcomes,
      [fixture],
    ).map(({ differences }) => differences),
    [[]],
  );
  // A trial no fixture pins is not verified against another trial's fixture.
  assert.deepEqual(
    assertListenOmittedBassCaseReproduces("isolated/tone/124", "deadbeef", [], [fixture]),
    [],
  );
});

test("the two committed fixtures are the two round-one omitted-bass failures", () => {
  assert.deepEqual(
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST.map(({ origin }) => origin.traceId),
    [...LISTEN_PINNED_OMITTED_BASS_TRACE_IDS],
  );
  for (const fixture of LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST) {
    // Each was measured under the renderer that produced it, and its phantom
    // bass onset lies in the corridor that separates the incumbent from the
    // candidates.
    assert.ok(fixture.hallucinatedBassOnset, fixture.id);
    assert.equal(
      isInsideListenHallucinationCorridor(fixture.hallucinatedBassOnset?.confidence ?? null),
      true,
      fixture.id,
    );
    assert.equal(fixture.playedPitches.includes(fixture.bassMidi), false, fixture.id);
    assert.ok(fixture.targetPitches.length >= 3, fixture.id);
    const [baseline, ...candidates] = fixture.pinnedOutcomes;
    assert.equal(baseline.profileId, "baseline-v1");
    assert.equal(baseline.advanced, false, fixture.id);
    assert.ok(candidates.every(({ advanced }) => advanced), fixture.id);
    assert.ok(
      candidates.every(({ hallucinatedQualifiedPitches }) =>
        hallucinatedQualifiedPitches.includes(fixture.bassMidi)),
      fixture.id,
    );
    // The cross-rendered counterpart is a diagnostic: it is recorded, and it is
    // not required to reproduce the advance.
    assert.ok(fixture.crossRendered, fixture.id);
    assert.notEqual(fixture.crossRendered?.traceId, fixture.origin.traceId);
    assert.equal(
      fixture.crossRendered?.outcomes.every(({ advanced }) => !advanced),
      true,
      fixture.id,
    );
  }
});

test("the captured corpus holds the isolated suite, discovery, and the three runs", () => {
  const traces = listenBassQualificationTraces();
  const ids = new Set(traces.map(({ id }) => id));
  for (const traceId of [
    ...LISTEN_REPEATED_CHORD_TRACE_IDS,
    ...LISTEN_PINNED_OMITTED_BASS_TRACE_IDS,
    ...listenOmittedBassCaseTraceIds(),
  ]) {
    assert.ok(ids.has(traceId), traceId);
  }
  assert.equal(
    traces.filter(({ suite }) => suite === "isolated").length,
    LISTEN_TRACE_MANIFEST.traces.filter(({ suite }) => suite === "isolated").length,
  );
  // Task 25 moves every observed row out of confirmation. Newly authored
  // confirmation pairs are outside this historical Task 22 capture command.
  assert.deepEqual(
    traces
      .filter(({ partition, suite }) => partition === "confirmation" && suite !== "isolated")
      .map(({ id }) => id),
    [],
  );
  assert.equal(traces.some(({ suite }) => suite === "safety-regression"), false);
});

test("the column order is the incumbent, four candidates, and sixteen counterfactuals", () => {
  const profiles = listenBassQualificationProfiles();
  assert.equal(profiles.length, 21);
  assert.equal(profiles[0].profileId, LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID);
  assert.equal(profiles[0].role, "baseline");
  assert.deepEqual(
    profiles.filter(({ role }) => role === "candidate").map(({ profileId }) => profileId),
    ["early-open-v2", "steady-open-v2", "early-held-v2", "steady-held-v2"],
  );
  assert.deepEqual(
    profiles.filter(({ role }) => role === "counterfactual").map(({ profileId }) => profileId),
    [...LISTEN_COUNTERFACTUAL_PROFILE_IDS],
  );
  assert.deepEqual(LISTEN_BASS_ONSET_GATES, [0.45, 0.5, 0.6]);
});

test("a narrowed run reports its corpus as incomplete", async () => {
  const { listenIsolatedValidationCases } = await import("./listenProfileValidationBenchmark");
  const cases = listenIsolatedValidationCases();
  const selected = listenOmittedBassCaseTraceIds();
  const result = await evaluateListenBassQualification({
    capture: async (descriptor) => {
      const validationCase = cases.find((entry) => entry.descriptor.id === descriptor.id);
      assert.ok(validationCase, descriptor.id);
      return {
        descriptor,
        sequence: null,
        validationCase,
        trace: {
          ...omittedBassTrace(0.55),
          renderer: validationCase.renderer,
          frames: [
            frame(220, []),
            frame(252, [
              ...validationCase.playedPitches.map((midi) => ({ midi, confidence: 0.99 })),
              { midi: Math.min(...validationCase.targetPitches), confidence: 0.55 },
            ], validationCase.targetPitches.map((midi) => ({ midi, confidence: 0.99 }))),
            frame(284, [], validationCase.targetPitches.map((midi) => ({
              midi,
              confidence: 0.99,
            }))),
          ],
        },
        recognitionHash: "probe-hash",
        recognitionStructureHash: "probe-structure",
      };
    },
    traceFilter: (descriptor) => selected.includes(descriptor.id),
    // Synthetic frames, so nothing here should be checked against the committed
    // fixtures; the guard that does check them is exercised below.
    omittedBassFixtures: [],
  });
  assert.equal(result.corpus.complete, false);
  assert.ok(result.corpus.missingTraceIds.length > 0);
  assert.equal(result.selectsNothing, true);
  assert.equal(result.profileReports.length, 21);
  assert.equal(result.repeatedChord.runs.length, 0);
  assert.equal(result.repeatedChord.transitionUpperVoiceEvidenceMinimum, null);
  assert.deepEqual(
    result.omittedBassCases.map(({ traceId }) => traceId),
    [...LISTEN_PINNED_OMITTED_BASS_TRACE_IDS],
  );
  assert.equal(result.crossRenderedOmittedBass.length, 2);
  for (const report of result.omittedBassCases) {
    assert.equal(report.fixture.pinnedOutcomes[0].advanced, false);
    assert.ok(report.fixture.pinnedOutcomes.slice(1).every(({ advanced }) => advanced));
    assert.ok(report.fixture.crossRendered);
    assert.notEqual(report.fixture.crossRendered?.traceId, report.traceId);
  }
  // Every candidate advances an omitted-bass fixture the incumbent refuses, in
  // both renderers, and that is stated per trace rather than as a total.
  assert.deepEqual(
    result.profileReports[0].isolated
      .flatMap(({ omittedBassAdvancedTraceIds }) => omittedBassAdvancedTraceIds),
    [],
  );
  for (const report of result.profileReports.filter(({ role }) => role === "candidate")) {
    assert.deepEqual(
      report.isolated
        .flatMap(({ omittedBassAdvancedTraceIds }) => omittedBassAdvancedTraceIds)
        .sort(),
      [...selected].sort(),
      report.profileId,
    );
  }
});
