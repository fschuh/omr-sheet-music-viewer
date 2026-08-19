import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
} from "./listenBenchmarkAudio";
import {
  ISOLATED_LISTEN_BENCHMARK_PRE_ROLL_MS,
  bundledListenBenchmarkCases,
  listenBenchmarkMatcherIdentity,
  replayIsolatedListenTrace,
  summarizeListenBenchmark,
} from "./listenBenchmark";
import {
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
} from "./listenBaselineParity";
import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  listenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  LISTEN_TRACE_MANIFEST,
  listenTracesInSuite,
  type ListenTracePartition,
} from "./listenTraceManifest";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  materializeListenSequence,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceArticulation,
  type ListenSequenceRunResult,
  type ListenSequenceRunSummary,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import { pianoDefinition, type PianoId, type PianoLayerId } from "./pianoRegistry";
import {
  conciseListenDynamicsProfileValidationResult,
  conciseListenIsolatedProfileValidationResult,
  conciseListenSequenceProfileValidationResult,
  evaluateListenDynamicsProfileValidation,
  evaluateListenIsolatedProfileValidation,
  evaluateListenSequenceProfileValidation,
  listenDynamicsValidationCases,
  listenIsolatedValidationCases,
  listenSequenceValidationCases,
  listenValidationEvidenceRole,
  replayListenIsolatedProfileMatrix,
  replayListenSequenceProfileMatrix,
  resolveListenValidationProfileIds,
  listenValidationProfileIdentities,
  summarizeListenDynamicsProfileValidation,
  summarizeListenIsolatedProfileValidation,
  summarizeListenSequenceProfileValidation,
  type ListenDynamicsValidationCapture,
  type ListenDynamicsValidationCase,
  type ListenDynamicsValidationCaseResult,
  type ListenDynamicsValidationSuite,
  type ListenIsolatedValidationCapture,
  type ListenIsolatedValidationCase,
  type ListenSequenceValidationCapture,
  type ListenSequenceValidationCase,
} from "./listenProfileValidationBenchmark";

const PRE_ROLL_MS = ISOLATED_LISTEN_BENCHMARK_PRE_ROLL_MS;

function recognitionFrame(
  capturedAtMs: number,
  attacks: ReadonlyArray<{ midi: number; confidence: number; noteConfidence?: number }>,
  activePitches: ReadonlyArray<{ midi: number; confidence: number }> = attacks
    .map(({ midi, confidence }) => ({ midi, confidence })),
): ListenRecognitionFrame {
  return {
    capturedAtMs,
    onsets: attacks.map(({ midi, confidence, noteConfidence }) => ({
      midi,
      confidence,
      noteConfidence: noteConfidence ?? confidence,
      onsetTimeMs: capturedAtMs,
    })),
    noteEvents: attacks.map(({ midi, confidence }) => ({
      midi,
      type: "onset" as const,
      confidence,
      eventTimeMs: capturedAtMs,
    })),
    activePitches: [...activePitches],
    confidenceEvidence: [...activePitches],
    modelScores: [],
    modelStates: activePitches.map(() => 3),
    signalActive: activePitches.length > 0,
    inferenceDurationMs: 4,
  };
}

/**
 * One decoded isolated trace whose only onset sits between `baseline-v1`'s 0.60
 * fresh-onset gate and the candidates' 0.45/0.50 gates, so the profile columns
 * are forced to disagree.
 */
function softAttackTrace(
  pitches: readonly number[],
  confidence: number,
  renderer = LISTEN_BENCHMARK_RENDERER,
): ListenRecognitionTrace {
  const held = pitches.map((midi) => ({ midi, confidence: 0.9 }));
  return {
    sequenceId: "isolated-one-event",
    intervalMs: 0,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [...pitches],
    renderer: { ...renderer },
    audioDiagnostics: { frameCount: 512, durationMs: 32, peak: 0.5, rms: 0.1 },
    pcm: new Float32Array(512),
    frames: [
      recognitionFrame(PRE_ROLL_MS - 32, []),
      recognitionFrame(PRE_ROLL_MS + 32, pitches.map((midi) => ({ midi, confidence }))),
      recognitionFrame(PRE_ROLL_MS + 64, [], held),
      recognitionFrame(PRE_ROLL_MS + 96, [], held),
    ],
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
  };
}

function capture(
  validationCase: ListenIsolatedValidationCase,
  trace: ListenRecognitionTrace,
): ListenIsolatedValidationCapture {
  return {
    validationCase,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineTrial: replayIsolatedListenTrace({
      trace,
      targetPitches: validationCase.targetPitches,
      generation: validationCase.caseIndex,
      profile: "baseline-v1",
    }),
  };
}

test("the validated profile matrix is the baseline followed by the frozen candidates", () => {
  assert.deepEqual(
    resolveListenValidationProfileIds(),
    ["baseline-v1", ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
  );
  assert.throws(
    () => resolveListenValidationProfileIds(["not-a-profile" as ListenMatcherProfileId]),
    /unknown profile identifier/,
  );
  assert.throws(
    () => resolveListenValidationProfileIds(["early-open-v2", "early-open-v2"]),
    /duplicated candidate profile/,
  );
  assert.throws(
    () => resolveListenValidationProfileIds(["baseline-v1", "early-open-v2"]),
    /comparison baseline/,
  );
  assert.throws(() => resolveListenValidationProfileIds([]), /at least one frozen candidate/);
  // The column count follows the frozen manifest instead of a fixed candidate count.
  assert.equal(resolveListenValidationProfileIds(["steady-held-v2"]).length, 2);
});

test("isolated validation cases join the manifest to the fixture corpus", () => {
  const cases = listenIsolatedValidationCases();
  const isolatedTraces = listenTracesInSuite("isolated", LISTEN_TRACE_MANIFEST);
  assert.equal(cases.length, isolatedTraces.length);
  assert.equal(cases.length, bundledListenBenchmarkCases().length * 2);
  assert.ok(cases.every(({ descriptor }) => descriptor.partition === "confirmation"));
  const direct = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]);
  assert.equal(direct.length, bundledListenBenchmarkCases().length);
  assert.ok(direct.every(({ renderer }) => renderer.version === LISTEN_BENCHMARK_RENDERER.version));
  assert.equal(direct.filter(({ expectedCorrect }) => expectedCorrect).length, 106);
  assert.equal(
    direct.filter(({ fixtureGroup, expectedCorrect }) => (
      fixtureGroup === "course-clear" && expectedCorrect
    )).length,
    54,
  );
  const tone = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["tone"]);
  assert.ok(tone.every(({ renderer }) => renderer.version === LISTEN_BENCHMARK_TONE_RENDERER.version));
  // Every case kind the release gates report separately must be present.
  assert.deepEqual(
    [...new Set(direct.map(({ descriptor }) => descriptor.caseKind))].sort(),
    ["ambiguous-harmonic", "correct", "distinguishable-wrong", "omitted-bass"],
  );
  assert.throws(() => listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, []), /at least one renderer/);
  assert.throws(
    () => listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct", "direct"]),
    /duplicated renderer key/,
  );
});

test("every profile column replays the identical retained trace", async () => {
  const cases = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]).slice(0, 3);
  const manifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces,
  };
  const traces = new Map<string, ListenRecognitionTrace>();
  const captureCounts = new Map<string, number>();
  const result = await evaluateListenIsolatedProfileValidation({
    manifest,
    rendererKeys: ["direct"],
    capture: async (validationCase) => {
      captureCounts.set(
        validationCase.descriptor.id,
        (captureCounts.get(validationCase.descriptor.id) ?? 0) + 1,
      );
      const trace = softAttackTrace(validationCase.playedPitches, 0.55);
      traces.set(validationCase.descriptor.id, trace);
      return capture(validationCase, trace);
    },
  });
  const direct = result.renderers[0];
  assert.equal(result.renderers.length, 1);
  assert.equal(result.traceReuseVerified, true);
  assert.equal(result.baselineParityVerified, true);
  assert.equal(result.manifest.hash, "0ed1e71d");
  // One capture per fixture, five profile columns replayed from it.
  assert.equal(direct.caseCount, listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]).length);
  assert.ok([...captureCounts.values()].every((count) => count === 1));
  assert.equal(direct.profiles.length, 5);
  for (const caseResult of direct.cases) {
    const trace = traces.get(caseResult.traceId);
    assert.ok(trace);
    assert.equal(caseResult.recognitionStructureHash, listenRecognitionStructureHash(trace));
    assert.equal(caseResult.frameCount, trace.frames.length);
    assert.equal(caseResult.profiles.length, 5);
    assert.deepEqual(
      caseResult.profiles.map(({ profileId }) => profileId),
      ["baseline-v1", ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
    );
    // Replay must leave the retained recognition untouched for the next column.
    assert.equal(listenRecognitionTraceHash(trace), capture(cases[0], trace).recognitionHash);
  }
  // A 0.55 onset is below baseline-v1's 0.60 gate and above every candidate's.
  const correct = direct.cases.filter(({ expectedCorrect }) => expectedCorrect);
  assert.ok(correct.length > 0);
  assert.ok(correct.every((caseResult) => caseResult.profiles[0].advanced === false));
  assert.ok(correct.every((caseResult) => caseResult.profiles.slice(1)
    .every(({ advanced }) => advanced === true)));
  const candidate = direct.profiles[1];
  assert.equal(direct.profiles[0].deltaFromBaseline, null);
  assert.equal(candidate.deltaFromBaseline?.correctAdvanceCount, correct.length);
  assert.equal(candidate.deltaFromBaseline?.distinguishableFalseAdvanceCount, 0);
  assert.equal(candidate.deltaFromBaseline?.lostCorrectTraceIds.length, 0);
  assert.equal(candidate.deltaFromBaseline?.gainedCorrectTraceIds.length, correct.length);
  const concise = conciseListenIsolatedProfileValidationResult(result);
  assert.equal(concise.renderers[0].traceIdentities.length, direct.caseCount);
  assert.equal(concise.renderers[0].profiles[0].profileId, "baseline-v1");
});

test("a capture that answers with another fixture or renderer is refused", async () => {
  const directCases = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]);
  await assert.rejects(
    () => evaluateListenIsolatedProfileValidation({
      rendererKeys: ["direct"],
      capture: async (validationCase) => capture(
        { ...validationCase, descriptor: directCases[1].descriptor },
        softAttackTrace([60], 0.99),
      ),
    }),
    /returned isolated\/direct\/002/,
  );
  await assert.rejects(
    () => evaluateListenIsolatedProfileValidation({
      rendererKeys: ["direct"],
      capture: async (validationCase) => capture(
        validationCase,
        softAttackTrace([60], 0.99, LISTEN_BENCHMARK_TONE_RENDERER),
      ),
    }),
    /expects renderer bundled-piano-web-audio-v1/,
  );
});

test("matrix replay matches the ordinary matcher path's generation and timestamps", () => {
  const trace = softAttackTrace([60], 0.99);
  const targetPitches = [60];
  const generation = 17;
  const replayed = replayIsolatedListenTrace({ trace, targetPitches, generation, profile: "baseline-v1" });
  // The ordinary path: one matcher built from the same converted options, the
  // target set before the attack on the trace's own clock, and every decoded
  // frame consumed in order under one generation.
  const matcher = new ExactChordMatcher(matcherOptionsForListenMatcherProfile("baseline-v1"));
  matcher.setTarget(targetPitches, generation, 0);
  let matchedAtMs: number | null = null;
  for (const frame of trace.frames) {
    if (matchedAtMs !== null) break;
    if (matcher.consume({
      generation,
      onsets: frame.onsets,
      noteEvents: frame.noteEvents,
      recognizedActivePitches: frame.activePitches,
      targetPitchEvidence: frame.confidenceEvidence,
      capturedAtMs: frame.capturedAtMs,
      processingTimeMs: frame.inferenceDurationMs,
    }).matched) {
      matchedAtMs = frame.capturedAtMs;
    }
  }
  assert.equal(replayed.advanced, matchedAtMs !== null);
  assert.equal(replayed.onsetToAdvanceMs, matchedAtMs === null ? null : matchedAtMs - PRE_ROLL_MS);
  // The chord matcher settles for one input frame before it advances.
  assert.equal(replayed.onsetToAdvanceMs, 64);
  // Latency is measured from the attack, not from the start of the pre-roll.
  assert.ok(trace.frames.some(({ capturedAtMs }) => capturedAtMs < PRE_ROLL_MS));
  // A stale generation is ignored exactly as it is in the live path.
  const staleMatcher = new ExactChordMatcher(matcherOptionsForListenMatcherProfile("baseline-v1"));
  staleMatcher.setTarget(targetPitches, generation, 0);
  const stale = staleMatcher.consume({
    generation: generation + 1,
    onsets: trace.frames[1].onsets,
    noteEvents: trace.frames[1].noteEvents,
    recognizedActivePitches: trace.frames[1].activePitches,
    targetPitchEvidence: trace.frames[1].confidenceEvidence,
    capturedAtMs: trace.frames[1].capturedAtMs,
    processingTimeMs: 4,
  });
  assert.equal(stale.matched, false);
  assert.equal(stale.stale, true);
  // Every isolated fixture replays under its own generation, as the historical
  // single-profile corpus does, so no two fixtures share matcher state.
  const cases = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]);
  assert.deepEqual(cases.slice(0, 3).map(({ caseIndex }) => caseIndex), [1, 2, 3]);
});

test("a profile matrix rejects an unusable column order", () => {
  const validationCase = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"])[0];
  const captured = capture(validationCase, softAttackTrace(validationCase.playedPitches, 0.99));
  assert.throws(
    () => replayListenIsolatedProfileMatrix(captured, []),
    /at least the baseline profile/,
  );
  assert.throws(
    () => replayListenIsolatedProfileMatrix(
      captured,
      listenValidationProfileIdentities(["early-open-v2", "steady-open-v2"]),
    ),
    /must start from baseline-v1/,
  );
  assert.throws(
    () => replayListenIsolatedProfileMatrix(
      captured,
      listenValidationProfileIdentities(["baseline-v1", "early-open-v2", "early-open-v2"]),
    ),
    /same profile twice/,
  );
  assert.throws(
    () => listenValidationProfileIdentities(["nope" as ListenMatcherProfileId]),
    /unknown profile identifier/,
  );
});

test("renderer summaries reproduce the historical isolated gate per profile", () => {
  const validationCases = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]).slice(0, 4);
  const profiles = listenValidationProfileIdentities(resolveListenValidationProfileIds());
  const cases = validationCases.map((validationCase) => replayListenIsolatedProfileMatrix(
    capture(validationCase, softAttackTrace(validationCase.playedPitches, 0.99)),
    profiles,
  ));
  const renderer = summarizeListenIsolatedProfileValidation(
    "direct",
    LISTEN_BENCHMARK_RENDERER,
    cases,
    profiles,
  );
  for (const profile of renderer.profiles) {
    assert.equal(profile.summary.matcher.profileId, profile.profileId);
    assert.deepEqual(profile.summary.matcher.thresholds, profile.profile);
    assert.equal(profile.summary.correctTrialCount, 4);
    assert.equal(profile.correctAdvanceCount, 4);
    assert.equal(profile.summary.successRate, 1);
    assert.equal(profile.summary.falseAdvanceCount, 0);
    assert.equal(profile.summary.renderer.version, LISTEN_BENCHMARK_RENDERER.version);
    assert.deepEqual(
      profile.byCaseKind.map(({ caseKind, trialCount }) => [caseKind, trialCount]),
      [["correct", 4], ["distinguishable-wrong", 0], ["ambiguous-harmonic", 0], ["omitted-bass", 0]],
    );
  }
  // The column function is the historical summary, not a second calculation.
  assert.deepEqual(
    renderer.profiles[0].summary.acceptance,
    summarizeListenBenchmark(
      renderer.profiles[0].summary.trials,
      listenBenchmarkMatcherIdentity("baseline-v1"),
    ).acceptance,
  );
});

/**
 * One decoded passage trace whose every scheduled attack is recognized at a
 * confidence between `baseline-v1`'s 0.60 fresh-onset gate and the candidates'
 * 0.45/0.50 gates, so the profile columns are forced to disagree on a corpus
 * passage rather than on a hand-built one.
 */
function sequenceTrace(
  sequence: MaterializedListenSequence,
  confidence: number,
  renderer = LISTEN_BENCHMARK_RENDERER,
): ListenRecognitionTrace {
  const frames: ListenRecognitionFrame[] = [];
  for (const attack of sequence.attacks) {
    const attackAtMs = Math.ceil(attack.scheduledAtMs / 32) * 32;
    const held = attack.playedPitches.map((midi) => ({ midi, confidence: 0.9 }));
    frames.push({
      ...recognitionFrame(
        attackAtMs,
        attack.playedPitches.map((midi) => ({ midi, confidence, noteConfidence: 0.9 })),
        held,
      ),
      confidenceEvidence: sequence.relevantPitches.map((midi) => ({
        midi,
        confidence: attack.playedPitches.includes(midi) ? 0.9 : 0,
      })),
    });
    frames.push({
      ...recognitionFrame(attackAtMs + 32, [], held),
      confidenceEvidence: sequence.relevantPitches.map((midi) => ({
        midi,
        confidence: attack.playedPitches.includes(midi) ? 0.9 : 0,
      })),
    });
  }
  return {
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [...sequence.relevantPitches],
    renderer: { ...renderer },
    audioDiagnostics: { frameCount: 512, durationMs: 32, peak: 0.5, rms: 0.1 },
    pcm: new Float32Array(512),
    frames,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
  };
}

const BASELINE_THRESHOLDS = listenValidationProfileIdentities(["baseline-v1"])[0].profile;

function sequenceCapture(
  validationCase: ListenSequenceValidationCase,
  confidence = 0.55,
  renderer = LISTEN_BENCHMARK_RENDERER,
): ListenSequenceValidationCapture {
  const sequence = materializeListenSequence(
    validationCase.definition,
    validationCase.intervalMs,
  );
  const trace = sequenceTrace(sequence, confidence, renderer);
  return {
    validationCase,
    sequence,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineRun: replayListenSequenceTrace(sequence, trace, "current-matcher", BASELINE_THRESHOLDS),
  };
}

test("sequence validation cases join the manifest to the passage corpus", () => {
  const cases = listenSequenceValidationCases();
  const sequenceTraces = listenTracesInSuite("sequence", LISTEN_TRACE_MANIFEST);
  assert.equal(cases.length, sequenceTraces.length);
  assert.equal(cases.length, bundledListenSequences().length * LISTEN_SEQUENCE_INTERVALS_MS.length * 2);
  // Both single-renderer sweeps read this corpus, so nothing here is held out.
  assert.deepEqual(
    [...new Set(cases.map(({ descriptor }) => descriptor.partition))].sort(),
    ["discovery", "regression-only"],
  );
  // The dedicated safety families gate every profile and score none of them.
  assert.ok(cases.filter(({ family }) => family === "safety").length > 0);
  assert.ok(cases.every(({ family, scoreEligible }) => scoreEligible === (family !== "safety")));
  const direct = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]);
  assert.equal(direct.length, cases.length / 2);
  assert.ok(direct.every(({ renderer }) => renderer.version === LISTEN_BENCHMARK_RENDERER.version));
  const tone = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["tone"]);
  assert.ok(tone.every(({ renderer }) => renderer.version === LISTEN_BENCHMARK_TONE_RENDERER.version));
  // A focused smoke narrows the six corpus speeds without dropping a family.
  const oneSpeed = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000]);
  assert.equal(oneSpeed.length, bundledListenSequences().length);
  assert.ok(oneSpeed.every(({ intervalMs }) => intervalMs === 1_000));
  assert.deepEqual(
    [...new Set(oneSpeed.map(({ family }) => family))].sort(),
    [...new Set(direct.map(({ family }) => family))].sort(),
  );
  assert.throws(() => listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, []), /at least one renderer/);
  assert.throws(
    () => listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct", "direct"]),
    /duplicated renderer key/,
  );
  assert.throws(
    () => listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], []),
    /at least one attack interval/,
  );
  assert.throws(
    () => listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000, 1_000]),
    /duplicated attack interval/,
  );
  assert.throws(
    () => listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [333]),
    /unknown attack interval 333 ms/,
  );
});

test("every sequence profile column replays the identical retained trace", async () => {
  const captureCounts = new Map<string, number>();
  const traces = new Map<string, ListenRecognitionTrace>();
  const result = await evaluateListenSequenceProfileValidation({
    rendererKeys: ["direct"],
    intervalsMs: [1_000],
    capture: async (validationCase) => {
      captureCounts.set(
        validationCase.descriptor.id,
        (captureCounts.get(validationCase.descriptor.id) ?? 0) + 1,
      );
      const captured = sequenceCapture(validationCase);
      traces.set(validationCase.descriptor.id, captured.trace);
      return captured;
    },
  });
  const direct = result.renderers[0];
  assert.equal(result.renderers.length, 1);
  assert.equal(result.evidenceRole, "discovery");
  assert.equal(result.traceReuseVerified, true);
  assert.equal(result.baselineParityVerified, true);
  assert.equal(result.manifest.capturedTraceCount, bundledListenSequences().length);
  assert.ok([...captureCounts.values()].every((count) => count === 1));
  assert.equal(direct.caseCount, bundledListenSequences().length);
  assert.equal(direct.scoredCaseCount + direct.safetyCaseCount, direct.caseCount);
  assert.ok(direct.safetyCaseCount > 0);
  assert.deepEqual(direct.intervalsMs, [1_000]);
  for (const caseResult of direct.cases) {
    const trace = traces.get(caseResult.traceId);
    assert.ok(trace);
    assert.equal(caseResult.recognitionStructureHash, listenRecognitionStructureHash(trace));
    assert.equal(caseResult.frameCount, trace.frames.length);
    assert.deepEqual(
      caseResult.profiles.map(({ profileId }) => profileId),
      ["baseline-v1", ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
    );
    // Every column read one trace object: the case row carries a single identity.
    assert.equal(caseResult.pcmLength, trace.pcm.length);
    // Replay left the retained recognition untouched, so replaying the column
    // order again after the matrix reproduces it exactly.
    const repeated = replayListenSequenceProfileMatrix(
      sequenceCapture(
        listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000])
          .find(({ descriptor }) => descriptor.id === caseResult.traceId)!,
      ),
      listenValidationProfileIdentities(resolveListenValidationProfileIds()),
    );
    assert.equal(repeated.recognitionStructureHash, caseResult.recognitionStructureHash);
    assert.deepEqual(
      repeated.profiles.map(({ run }) => run.summary.orderedAdvanceCount),
      caseResult.profiles.map(({ run }) => run.summary.orderedAdvanceCount),
    );
  }
  // A 0.55 onset is below baseline-v1's 0.60 gate and above every candidate's.
  const baseline = direct.profiles[0];
  assert.equal(baseline.deltaFromBaseline, null);
  assert.equal(baseline.totals.orderedAdvanceCount, 0);
  assert.equal(baseline.totals.completePassageCount, 0);
  for (const candidate of direct.profiles.slice(1)) {
    assert.ok(candidate.totals.orderedAdvanceCount > 0);
    assert.equal(
      candidate.deltaFromBaseline?.orderedAdvanceCount,
      candidate.totals.orderedAdvanceCount,
    );
    assert.equal(
      candidate.deltaFromBaseline?.completePassageCount,
      candidate.totals.completePassageCount,
    );
    assert.deepEqual(candidate.deltaFromBaseline?.regressedOrderedAdvanceTraceIds, []);
    assert.deepEqual(candidate.deltaFromBaseline?.lostCompletePassageTraceIds, []);
    // The safety families gate the column instead of scoring it.
    assert.ok(candidate.totals.sequenceCount < direct.caseCount);
  }
  const concise = conciseListenSequenceProfileValidationResult(result);
  assert.equal(concise.evidenceRole, "discovery");
  assert.equal(concise.renderers[0].traceIdentities.length, direct.caseCount);
  assert.equal(concise.renderers[0].profiles[0].profileId, "baseline-v1");
});

test("sequence aggregation is per speed and per family, and safety never scores", () => {
  const profiles = listenValidationProfileIdentities(resolveListenValidationProfileIds());
  const cases = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000, 500])
    .map((validationCase) => replayListenSequenceProfileMatrix(
      sequenceCapture(validationCase, 0.99),
      profiles,
    ));
  const renderer = summarizeListenSequenceProfileValidation(
    "direct",
    LISTEN_BENCHMARK_RENDERER,
    cases,
    profiles,
  );
  assert.deepEqual(renderer.intervalsMs, [1_000, 500]);
  const scored = cases.filter(({ scoreEligible }) => scoreEligible);
  for (const profile of renderer.profiles) {
    assert.equal(profile.totals.sequenceCount, scored.length);
    // Every grouping partitions the same scored rows, so the parts sum to the whole.
    assert.equal(
      profile.bySpeed.reduce((total, { totals }) => total + totals.sequenceCount, 0),
      profile.totals.sequenceCount,
    );
    assert.equal(
      profile.byFamily.reduce((total, { totals }) => total + totals.sequenceCount, 0),
      profile.totals.sequenceCount,
    );
    assert.equal(
      profile.bySpeed.reduce((total, { totals }) => total + totals.orderedAdvanceCount, 0),
      profile.totals.orderedAdvanceCount,
    );
    assert.equal(
      profile.byFamily.reduce((total, { totals }) => total + totals.expectedEventCount, 0),
      profile.totals.expectedEventCount,
    );
    assert.ok(!profile.byFamily.some(({ family }) => family === "safety"));
    // The gate rows are reported on their own and never folded into the score.
    assert.equal(
      profile.regressionTotals.sequenceCount,
      cases.length - scored.length,
    );
    assert.equal(profile.totals.sequenceCount + profile.regressionTotals.sequenceCount, cases.length);
    assert.ok(!profile.speedSummaries.some((summary) => summary.sequenceCount === 0));
    assert.equal(profile.safety.sequenceCount, cases.length - scored.length);
    // The historical per-speed diagnostics agree with the totals they describe.
    const speedSummary = profile.speedSummaries[0];
    const speedTotals = profile.bySpeed[0].totals;
    assert.equal(speedSummary.independentMatchCount, speedTotals.independentMatchCount);
    assert.equal(speedSummary.orderedAdvanceCount, speedTotals.orderedAdvanceCount);
    assert.equal(speedSummary.orderedPrefixCompleted, speedTotals.orderedPrefixCompleted);
    assert.equal(
      speedSummary.completePassageRate * speedSummary.sequenceCount,
      speedTotals.completePassageCount,
    );
  }
  // Identical columns produce a zero delta rather than a missing one.
  const candidate = renderer.profiles[1];
  assert.notEqual(candidate.deltaFromBaseline, null);
  assert.equal(candidate.deltaFromBaseline?.bySpeed.length, 2);
  assert.equal(
    candidate.deltaFromBaseline?.byFamily.length,
    renderer.profiles[0].byFamily.length,
  );
  const delta = candidate.deltaFromBaseline;
  assert.ok(delta);
  assert.equal(
    delta.orderedAdvanceCount,
    candidate.totals.orderedAdvanceCount - renderer.profiles[0].totals.orderedAdvanceCount,
  );
  assert.equal(
    delta.bySpeed[0].orderedAdvanceCount,
    candidate.bySpeed[0].totals.orderedAdvanceCount -
      renderer.profiles[0].bySpeed[0].totals.orderedAdvanceCount,
  );
  assert.equal(
    delta.safety.falseAdvanceCount,
    candidate.safety.falseAdvanceCount - renderer.profiles[0].safety.falseAdvanceCount,
  );
});

test("a sequence profile matrix rejects an unusable column order", () => {
  const validationCase = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000])[0];
  const captured = sequenceCapture(validationCase, 0.99);
  assert.throws(
    () => replayListenSequenceProfileMatrix(captured, []),
    /at least the baseline profile/,
  );
  assert.throws(
    () => replayListenSequenceProfileMatrix(
      captured,
      listenValidationProfileIdentities(["early-open-v2", "steady-open-v2"]),
    ),
    /must start from baseline-v1/,
  );
  assert.throws(
    () => replayListenSequenceProfileMatrix(
      captured,
      listenValidationProfileIdentities(["baseline-v1", "early-held-v2", "early-held-v2"]),
    ),
    /same profile twice/,
  );
  // The column list follows the frozen manifest, not a fixed candidate count.
  assert.equal(
    replayListenSequenceProfileMatrix(
      captured,
      listenValidationProfileIdentities(resolveListenValidationProfileIds(["steady-held-v2"])),
    ).profiles.length,
    2,
  );
  assert.throws(
    () => summarizeListenSequenceProfileValidation(
      "tone",
      LISTEN_BENCHMARK_TONE_RENDERER,
      [replayListenSequenceProfileMatrix(
        captured,
        listenValidationProfileIdentities(resolveListenValidationProfileIds()),
      )],
      listenValidationProfileIdentities(resolveListenValidationProfileIds()),
    ),
    /is not a tone trace/,
  );
});

test("a sequence capture that answers with another passage, renderer, or speed is refused", async () => {
  const directCases = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], [1_000]);
  await assert.rejects(
    () => evaluateListenSequenceProfileValidation({
      rendererKeys: ["direct"],
      intervalsMs: [1_000],
      capture: async () => sequenceCapture(directCases[1], 0.99),
    }),
    /returned sequence\/direct\/descending-scale\/1000ms/,
  );
  await assert.rejects(
    () => evaluateListenSequenceProfileValidation({
      rendererKeys: ["direct"],
      intervalsMs: [1_000],
      capture: async (validationCase) => sequenceCapture(
        validationCase,
        0.99,
        LISTEN_BENCHMARK_TONE_RENDERER,
      ),
    }),
    /expects renderer bundled-piano-web-audio-v1/,
  );
  await assert.rejects(
    () => evaluateListenSequenceProfileValidation({
      rendererKeys: ["direct"],
      intervalsMs: [1_000],
      capture: async (validationCase) => {
        const captured = sequenceCapture(validationCase, 0.99);
        return { ...captured, trace: { ...captured.trace, intervalMs: 500 } };
      },
    }),
    /but its capture recognized .* at 500 ms/,
  );
});

/* ------------------------------------------------------------------------- *
 * Dynamics and articulation candidate matrix
 * ------------------------------------------------------------------------- */

function dynamicsCapture(
  validationCase: ListenDynamicsValidationCase,
  confidence: (validationCase: ListenDynamicsValidationCase) => number = () => 0.55,
  renderer = validationCase.renderer,
): ListenDynamicsValidationCapture {
  const sequence = materializeListenSequence(
    validationCase.definition,
    validationCase.intervalMs,
  );
  const trace = sequenceTrace(sequence, confidence(validationCase), renderer);
  return {
    validationCase,
    sequence,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineRun: replayListenSequenceTrace(sequence, trace, "current-matcher", BASELINE_THRESHOLDS),
    captured: {
      piano: validationCase.piano,
      layer: validationCase.layer,
      dynamicProfile: validationCase.dynamicProfile,
    },
  };
}

test("dynamics validation cases join the manifest to the dynamics and articulation corpora", () => {
  const cases = listenDynamicsValidationCases();
  const constant = listenTracesInSuite("dynamics-constant", LISTEN_TRACE_MANIFEST);
  const mixed = listenTracesInSuite("dynamics-mixed", LISTEN_TRACE_MANIFEST);
  const articulation = listenTracesInSuite("articulation", LISTEN_TRACE_MANIFEST);
  assert.equal(cases.length, constant.length + mixed.length + articulation.length);
  // Four Splendid layers, sixteen Salamander layers, two mixed runs, and four
  // articulations, under both renderers.
  assert.equal(constant.length, 40);
  assert.equal(mixed.length, 4);
  assert.equal(articulation.length, 8);
  // These suites are exactly what the manifest split, so both partitions are here
  // and the diagnosed Tone Salamander v05 row gates instead of scoring.
  assert.deepEqual(
    [...new Set(cases.map(({ descriptor }) => descriptor.partition))].sort(),
    ["confirmation", "discovery", "regression-only"],
  );
  assert.deepEqual(
    cases.filter(({ scoreEligible }) => !scoreEligible).map(({ descriptor }) => descriptor.id),
    ["dynamics-constant/tone/salamander/v05"],
  );
  assert.ok(cases.every(({ definition }) => definition.family === "course-clear-articulation"));
  assert.ok(cases.every(({ intervalMs }) => intervalMs === COURSE_CLEAR_ARTICULATION_INTERVAL_MS));
  // A constant layer names its velocity layer; a mixed run plays all of them.
  assert.ok(cases.every(({ suite, layer, dynamicProfile }) => (
    suite === "dynamics-mixed"
      ? layer === null && dynamicProfile === "crescendo-decrescendo"
      : layer !== null && dynamicProfile === "constant"
  )));
  assert.ok(cases.every(({ suite, articulation: value, definition }) => (
    suite === "articulation" ? value === definition.articulation : value === "normal"
  )));
  const direct = listenDynamicsValidationCases(LISTEN_TRACE_MANIFEST, ["direct"]);
  assert.equal(direct.length, cases.length / 2);
  assert.ok(direct.every(({ renderer }) => renderer.version === LISTEN_BENCHMARK_RENDERER.version));
  // A focused smoke narrows the suites; the diagnosed row travels with its own.
  const layers = listenDynamicsValidationCases(
    LISTEN_TRACE_MANIFEST,
    ["direct", "tone"],
    ["dynamics-constant"],
  );
  assert.equal(layers.length, constant.length);
  assert.ok(layers.every(({ suite }) => suite === "dynamics-constant"));
  assert.equal(
    listenDynamicsValidationCases(LISTEN_TRACE_MANIFEST, ["tone"], ["articulation"]).length,
    articulation.length / 2,
  );
  assert.throws(() => listenDynamicsValidationCases(LISTEN_TRACE_MANIFEST, []), /at least one renderer/);
  assert.throws(
    () => listenDynamicsValidationCases(LISTEN_TRACE_MANIFEST, ["direct", "direct"]),
    /duplicated renderer key/,
  );
  assert.throws(
    () => listenDynamicsValidationCases(LISTEN_TRACE_MANIFEST, ["direct"], []),
    /at least one suite/,
  );
  assert.throws(
    () => listenDynamicsValidationCases(
      LISTEN_TRACE_MANIFEST,
      ["direct"],
      ["articulation", "articulation"],
    ),
    /duplicated suite/,
  );
  assert.throws(
    () => listenDynamicsValidationCases(
      LISTEN_TRACE_MANIFEST,
      ["direct"],
      ["sequence" as ListenDynamicsValidationSuite],
    ),
    /unknown suite sequence/,
  );
});

test("every dynamics profile column replays the identical retained trace", async () => {
  const captureCounts = new Map<string, number>();
  const traces = new Map<string, ListenRecognitionTrace>();
  const result = await evaluateListenDynamicsProfileValidation({
    capture: async (validationCase) => {
      captureCounts.set(
        validationCase.descriptor.id,
        (captureCounts.get(validationCase.descriptor.id) ?? 0) + 1,
      );
      const captured = dynamicsCapture(validationCase);
      traces.set(validationCase.descriptor.id, captured.trace);
      return captured;
    },
  });
  assert.equal(result.renderers.length, 2);
  assert.equal(result.traceReuseVerified, true);
  assert.equal(result.baselineParityVerified, true);
  // The manifest splits these suites across both partitions, so the run as a
  // whole is mixed evidence and can never be quoted as confirmation.
  assert.equal(result.evidenceRole, "mixed");
  assert.deepEqual(result.partitions.slice().sort(), ["confirmation", "discovery", "regression-only"]);
  assert.equal(result.manifest.capturedTraceCount, 52);
  assert.ok([...captureCounts.values()].every((count) => count === 1));
  // Candidate metadata is the frozen registry manifest, values included.
  assert.deepEqual([...result.candidateProfileIds], [...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS]);
  assert.deepEqual(
    result.profiles.map(({ profileId }) => profileId),
    ["baseline-v1", ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
  );
  for (const identity of result.profiles) {
    assert.deepEqual(
      identity.profile,
      listenMatcherThresholds(LISTEN_MATCHER_PROFILES[identity.profileId]),
    );
  }
  const tone = result.renderers.find(({ rendererKey }) => rendererKey === "tone");
  assert.ok(tone);
  assert.equal(tone.caseCount, 26);
  assert.equal(tone.regressionCaseCount, 1);
  assert.equal(tone.scoredCaseCount, 25);
  assert.deepEqual(tone.suites, ["dynamics-constant", "dynamics-mixed", "articulation"]);
  assert.deepEqual(tone.pianos, ["splendid", "salamander"]);
  for (const caseResult of tone.cases) {
    const trace = traces.get(caseResult.traceId);
    assert.ok(trace);
    assert.equal(caseResult.recognitionStructureHash, listenRecognitionStructureHash(trace));
    assert.equal(caseResult.frameCount, trace.frames.length);
    assert.equal(caseResult.pcmLength, trace.pcm.length);
    assert.deepEqual(
      caseResult.profiles.map(({ profileId }) => profileId),
      ["baseline-v1", ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
    );
  }
  // A 0.55 onset is below baseline-v1's 0.60 gate and above every candidate's.
  const baseline = tone.profiles[0];
  const corpus = (profile: typeof baseline) => {
    const group = profile.groups.find(({ kind }) => kind === "corpus");
    assert.ok(group);
    return group;
  };
  assert.equal(baseline.deltaFromBaseline, null);
  assert.equal(corpus(baseline).deltaFromBaseline, null);
  assert.equal(corpus(baseline).totals.orderedAdvanceCount, 0);
  assert.equal(corpus(baseline).evidenceRole, "mixed");
  assert.equal(corpus(baseline).traceIds.length, tone.scoredCaseCount);
  for (const candidate of tone.profiles.slice(1)) {
    assert.ok(corpus(candidate).totals.orderedAdvanceCount > 0);
    assert.equal(
      corpus(candidate).deltaFromBaseline?.orderedAdvanceCount,
      corpus(candidate).totals.orderedAdvanceCount,
    );
    assert.deepEqual(corpus(candidate).deltaFromBaseline?.regressedOrderedAdvanceTraceIds, []);
    // The diagnosed row gates the column and is absent from every scored group.
    assert.ok(!corpus(candidate).traceIds.includes("dynamics-constant/tone/salamander/v05"));
    assert.equal(candidate.regressionTotals.sequenceCount, 1);
  }
  // Each partition is reported on its own, so a gate can quote confirmation alone.
  const partitionGroups = baseline.groups.filter(({ kind }) => kind === "partition");
  assert.deepEqual(
    partitionGroups.map(({ evidenceRole }) => evidenceRole),
    ["confirmation", "discovery"],
  );
  assert.equal(
    partitionGroups.reduce((total, { totals }) => total + totals.sequenceCount, 0),
    tone.scoredCaseCount,
  );
  // Every leaf level exists: one group per layer, mixed run, and articulation.
  assert.equal(baseline.groups.filter(({ kind }) => kind === "layer").length, 19);
  assert.equal(baseline.groups.filter(({ kind }) => kind === "mixed-run").length, 2);
  assert.equal(baseline.groups.filter(({ kind }) => kind === "articulation").length, 4);
  assert.ok(baseline.groups
    .filter(({ kind }) => kind === "layer" || kind === "articulation" || kind === "mixed-run")
    .every(({ partitions }) => partitions.length === 1));
  // The diagnosed row is reported apart from every score, with its own semantics.
  assert.equal(tone.regressionCases.length, 1);
  assert.equal(tone.regressionCases[0].traceId, "dynamics-constant/tone/salamander/v05");
  assert.equal(tone.regressionCases[0].layer, "v05");
  assert.equal(tone.regressionCases[0].profiles.length, 5);
  // Both committed regressions are replayed under every column, and the
  // late-advance case is not counted as a safety failure.
  for (const profile of tone.profiles) {
    assert.deepEqual(
      profile.safety.regressions.outcomes.map(({ fixtureId }) => fixtureId).sort(),
      [
        "tone-course-clear-333-shared-pitch-false-advance",
        "tone-salamander-v05-repeated-chord-late-advance",
      ],
    );
    assert.deepEqual(
      [...new Set(profile.safety.regressions.outcomes.map(({ expectation }) => expectation))].sort(),
      ["late-advance", "reported-unsafe-advance"],
    );
    assert.equal(profile.safety.passed, true);
  }
  const concise = conciseListenDynamicsProfileValidationResult(result);
  assert.equal(concise.evidenceRole, "mixed");
  assert.equal(concise.renderers[1].traceIdentities.length, tone.caseCount);
  assert.equal(concise.renderers[1].profiles[0].profileId, "baseline-v1");
  assert.equal(concise.renderers[1].regressionCases.length, 1);
});

test("a dynamics capture that answers with another run, renderer, or instrument is refused", async () => {
  const directCases = listenDynamicsValidationCases(
    LISTEN_TRACE_MANIFEST,
    ["direct"],
    ["dynamics-constant"],
  );
  await assert.rejects(
    () => evaluateListenDynamicsProfileValidation({
      rendererKeys: ["direct"],
      suites: ["dynamics-constant"],
      capture: async () => dynamicsCapture(directCases[1]),
    }),
    /returned dynamics-constant\/direct\/splendid\//,
  );
  await assert.rejects(
    () => evaluateListenDynamicsProfileValidation({
      rendererKeys: ["direct"],
      suites: ["dynamics-constant"],
      capture: async (validationCase) => dynamicsCapture(
        validationCase,
        () => 0.99,
        LISTEN_BENCHMARK_TONE_RENDERER,
      ),
    }),
    /expects renderer bundled-piano-web-audio-v1/,
  );
  await assert.rejects(
    () => evaluateListenDynamicsProfileValidation({
      rendererKeys: ["direct"],
      suites: ["dynamics-constant"],
      capture: async (validationCase) => {
        const captured = dynamicsCapture(validationCase);
        return { ...captured, captured: { ...captured.captured, layer: "v01" as PianoLayerId } };
      },
    }),
    /but its capture rendered/,
  );
});

const DYNAMICS_COLUMN = listenValidationProfileIdentities(resolveListenValidationProfileIds());

function fabricatedSummary(update: Partial<ListenSequenceRunSummary>): ListenSequenceRunSummary {
  const expectedEventCount = update.expectedEventCount ?? 27;
  const independentMatchCount = update.independentMatchCount ?? 0;
  const orderedAdvanceCount = update.orderedAdvanceCount ?? 0;
  return {
    complete: orderedAdvanceCount === expectedEventCount,
    rawCompleteEvidenceCount: 0, rawCompleteEvidenceRate: 0,
    thresholdQualifiedEventCount: 0, thresholdQualifiedEventRate: 0,
    independentMatchCount, independentMatchRate: independentMatchCount / expectedEventCount,
    orderedAdvanceCount, orderedAdvanceRate: orderedAdvanceCount / expectedEventCount,
    recognizedButBlockedCount: 0, cascadeLossCount: 0, blockedEventPositions: [],
    firstCausalStallIndex: null, correctAdvanceCount: orderedAdvanceCount,
    expectedEventCount, correctAdvanceRate: orderedAdvanceCount / expectedEventCount,
    orderedPrefixCompleted: orderedAdvanceCount, firstStallIndex: null,
    missedCount: expectedEventCount - independentMatchCount, duplicateAdvanceCount: 0,
    skippedAdvanceCount: 0, falseAdvanceCount: 0, lateAdvanceCount: 0,
    p50OnsetToAdvanceMs: null, p95OnsetToAdvanceMs: null,
    p50IndependentMatchLatencyMs: null, p95IndependentMatchLatencyMs: null,
    p50OrderedAdvanceLatencyMs: null, p95OrderedAdvanceLatencyMs: null,
    reasonCounts: {}, maximumInferenceMs: 0, maximumProcessingBacklogMs: 0,
    nextAttackBeforeAdvanceCount: 0,
    ...update,
  };
}

/**
 * One measured row, built directly rather than replayed.
 *
 * The aggregation rules have to be provable on outcomes the synthetic traces
 * cannot produce — every frozen candidate is strictly more permissive than
 * `baseline-v1`, so a candidate losing advances on one velocity layer has to be
 * stated rather than recognized into existence.
 */
function fabricatedDynamicsCase(options: {
  traceId: string;
  partition: ListenTracePartition;
  suite: ListenDynamicsValidationSuite;
  piano: PianoId;
  layer?: PianoLayerId | null;
  articulation?: ListenSequenceArticulation | null;
  scoreEligible?: boolean;
  counts: (profileId: ListenMatcherProfileId) => Partial<ListenSequenceRunSummary>;
}): ListenDynamicsValidationCaseResult {
  const layer = options.layer ?? null;
  return {
    traceId: options.traceId,
    partition: options.partition,
    scoreEligible: options.scoreEligible ?? options.partition !== "regression-only",
    suite: options.suite,
    sequenceId: "course-clear-articulation-normal",
    sequenceLabel: "Course Clear · normal",
    piano: options.piano,
    pianoName: options.piano === "splendid" ? "Splendid Grand Piano" : "Salamander Grand Piano",
    layer,
    dynamicBand: layer === null ? null : "medium",
    dynamicProfile: options.suite === "dynamics-mixed" ? "crescendo-decrescendo" : "constant",
    articulation: options.articulation ?? "normal",
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    rendererKey: "direct",
    renderer: LISTEN_BENCHMARK_RENDERER.version,
    recognitionStructureHash: options.traceId,
    frameCount: 54,
    pcmLength: 512,
    peak: 0.4,
    rms: 0.1,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
    profiles: DYNAMICS_COLUMN.map(({ profileId, profile }) => ({
      profileId,
      profile,
      run: {
        events: [],
        summary: fabricatedSummary(options.counts(profileId)),
      } as unknown as ListenSequenceRunResult,
    })),
  };
}

test("equal-piano aggregation gives four Splendid layers the weight of sixteen Salamander ones", () => {
  const cases = [
    ...pianoDefinition("splendid").benchmarkLayers.map((layer) => fabricatedDynamicsCase({
      traceId: `dynamics-constant/direct/splendid/${layer}`,
      partition: layer === "mp" ? "discovery" : "confirmation",
      suite: "dynamics-constant",
      piano: "splendid",
      layer,
      counts: () => (layer === "pp"
        ? { independentMatchCount: 27, orderedAdvanceCount: 20 }
        : { independentMatchCount: 27, orderedAdvanceCount: 27 }),
    })),
    ...pianoDefinition("salamander").benchmarkLayers.map((layer) => fabricatedDynamicsCase({
      traceId: `dynamics-constant/direct/salamander/${layer}`,
      partition: layer === "v03" ? "discovery" : "confirmation",
      suite: "dynamics-constant",
      piano: "salamander",
      layer,
      counts: () => ({
        independentMatchCount: layer === "v01" ? 0 : 9,
        orderedAdvanceCount: layer === "v01" ? 0 : 3,
      }),
    })),
  ];
  const renderer = summarizeListenDynamicsProfileValidation(
    "direct",
    LISTEN_BENCHMARK_RENDERER,
    cases,
    DYNAMICS_COLUMN,
  );
  const baseline = renderer.profiles[0];
  // Summing the runs would let Salamander's sixteen layers decide the corpus.
  const corpus = baseline.groups.find(({ kind }) => kind === "corpus");
  assert.ok(corpus);
  assert.equal(corpus.totals.sequenceCount, 20);
  assert.ok(Math.abs(corpus.totals.independentMatchRate - (4 * 27 + 15 * 9) / (20 * 27)) < 1e-12);
  assert.ok(corpus.totals.independentMatchRate < 0.5);
  // Weighting the two instruments equally does not. The aggregate is per suite,
  // so it stays comparable with the constant-layer matrix's own cross-piano row.
  assert.equal(baseline.equalPiano.length, 1);
  const constantLayer = baseline.equalPiano[0];
  assert.equal(constantLayer.suite, "dynamics-constant");
  assert.equal(constantLayer.pianoCount, 2);
  const splendid = constantLayer.pianos.find(({ piano }) => piano === "splendid");
  const salamander = constantLayer.pianos.find(({ piano }) => piano === "salamander");
  assert.ok(splendid && salamander);
  assert.equal(splendid.independentMatchRate, 1);
  assert.ok(Math.abs(salamander.independentMatchRate - (15 * 9) / (16 * 27)) < 1e-12);
  assert.ok(Math.abs(
    (constantLayer.independentMatchRate ?? 0) -
      (splendid.independentMatchRate + salamander.independentMatchRate) / 2,
  ) < 1e-12);
  assert.equal(constantLayer.completePassageRate, (0.75 + 0) / 2);
  assert.equal(constantLayer.worstPiano, "salamander");
  // Each instrument names the layer that performed worst on it.
  assert.equal(salamander.worstLayer, "v01");
  assert.equal(salamander.worstLayerOrderedAdvanceRate, 0);
  assert.equal(splendid.worstLayer, "pp");
  // Per-piano rows still say which partitions they mix; neither is confirmation.
  assert.equal(splendid.evidenceRole, "mixed");
  assert.equal(constantLayer.evidenceRole, "mixed");
  // Identical columns produce a zero delta rather than a missing one.
  const candidate = renderer.profiles[1];
  assert.equal(candidate.deltaFromBaseline?.equalPiano[0].suite, "dynamics-constant");
  assert.equal(candidate.deltaFromBaseline?.equalPiano[0].independentMatchRate, 0);
  assert.equal(candidate.deltaFromBaseline?.safety.falseAdvanceCount, 0);
});

test("no dynamics aggregate can hide a layer, articulation, or piano regression", () => {
  const regressed = "dynamics-constant/direct/salamander/v05";
  const cases = [
    fabricatedDynamicsCase({
      traceId: "dynamics-constant/direct/splendid/mp",
      partition: "discovery",
      suite: "dynamics-constant",
      piano: "splendid",
      layer: "mp",
      counts: (profileId) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 20 }
        : { independentMatchCount: 27, orderedAdvanceCount: 27 }),
    }),
    fabricatedDynamicsCase({
      traceId: regressed,
      partition: "confirmation",
      suite: "dynamics-constant",
      piano: "salamander",
      layer: "v05",
      counts: (profileId) => (profileId === "baseline-v1"
        ? { independentMatchCount: 27, orderedAdvanceCount: 27 }
        : { independentMatchCount: 24, orderedAdvanceCount: 21 }),
    }),
    fabricatedDynamicsCase({
      traceId: "articulation/direct/legato",
      partition: "confirmation",
      suite: "articulation",
      piano: "splendid",
      layer: "mp",
      articulation: "legato",
      counts: () => ({ independentMatchCount: 27, orderedAdvanceCount: 27 }),
    }),
  ];
  const renderer = summarizeListenDynamicsProfileValidation(
    "direct",
    LISTEN_BENCHMARK_RENDERER,
    cases,
    DYNAMICS_COLUMN,
  );
  const candidate = renderer.profiles[1];
  const group = (key: string) => {
    const found = candidate.groups.find((entry) => entry.key === key);
    assert.ok(found, `missing group ${key}`);
    return found;
  };
  // The corpus improves overall: seven gained advances against six lost.
  assert.equal(group("corpus").deltaFromBaseline?.orderedAdvanceCount, 1);
  // It still names the regressed row rather than netting it out.
  assert.deepEqual(
    group("corpus").deltaFromBaseline?.regressedOrderedAdvanceTraceIds,
    [regressed],
  );
  assert.deepEqual(group("corpus").deltaFromBaseline?.lostCompletePassageTraceIds, [regressed]);
  assert.deepEqual(
    group("corpus").deltaFromBaseline?.gainedCompletePassageTraceIds,
    ["dynamics-constant/direct/splendid/mp"],
  );
  // The leaf layer group states the loss on its own.
  assert.equal(group(`layer/salamander/v05`).deltaFromBaseline?.orderedAdvanceCount, -6);
  assert.equal(group(`layer/salamander/v05`).evidenceRole, "confirmation");
  assert.deepEqual(group(`layer/salamander/v05`).partitions, ["confirmation"]);
  // So do the piano level and the piano's confirmation-only slice.
  assert.equal(group("piano/salamander").deltaFromBaseline?.orderedAdvanceCount, -6);
  assert.equal(group("piano/salamander/confirmation").deltaFromBaseline?.orderedAdvanceCount, -6);
  assert.equal(group("partition/confirmation").deltaFromBaseline?.orderedAdvanceCount, -6);
  assert.equal(group("partition/discovery").deltaFromBaseline?.orderedAdvanceCount, 7);
  // Articulation rows are leaves too, and an unchanged one reads as unchanged.
  assert.equal(group("articulation/legato").deltaFromBaseline?.orderedAdvanceCount, 0);
  assert.equal(group("articulation/legato").evidenceRole, "confirmation");
  // The equal-piano mean nets the two instruments out — which is exactly why the
  // per-piano rows are listed beside it: Salamander's drop is visible there.
  assert.equal(candidate.deltaFromBaseline?.equalPiano.length, 1);
  assert.ok((candidate.deltaFromBaseline?.equalPiano[0].orderedAdvanceRate ?? 0) > 0);
  const candidateSalamander = candidate.equalPiano[0].pianos
    .find(({ piano }) => piano === "salamander");
  const baselineSalamander = renderer.profiles[0].equalPiano[0].pianos
    .find(({ piano }) => piano === "salamander");
  assert.ok(candidateSalamander && baselineSalamander);
  assert.ok(candidateSalamander.orderedAdvanceRate < baselineSalamander.orderedAdvanceRate);
  assert.equal(candidateSalamander.worstLayer, "v05");
  // A summary must still start from the baseline column and describe its renderer.
  assert.throws(
    () => summarizeListenDynamicsProfileValidation(
      "direct",
      LISTEN_BENCHMARK_RENDERER,
      cases,
      listenValidationProfileIdentities(["early-open-v2", "steady-open-v2"]),
    ),
    /must start from baseline-v1/,
  );
  assert.throws(
    () => summarizeListenDynamicsProfileValidation(
      "tone",
      LISTEN_BENCHMARK_TONE_RENDERER,
      cases,
      DYNAMICS_COLUMN,
    ),
    /is not a tone trace/,
  );
  assert.throws(
    () => listenValidationEvidenceRole(["confirmation", "regression-only"]),
    /can never carry an evidence role/,
  );
});
