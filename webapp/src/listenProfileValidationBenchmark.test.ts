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
  LISTEN_MATCHER_REGISTRY_VERSION,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  listenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  CONFIRMATION_EVIDENCE,
  GATE_SCOPE_BY_DOMAIN,
  GATE_SCOPE_BY_ROLE,
} from "../../tools/online_amt/verify_listen_benchmark_evidence.mjs";
import {
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST,
  LISTEN_TRACE_MANIFEST_HASH,
  listenTracesInSuite,
  type ListenIsolatedCaseKind,
  type ListenTracePartition,
  type ListenTraceRendererKey,
  type ListenTraceSuite,
} from "./listenTraceManifest";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  materializeListenSequence,
  replayListenSequenceTrace,
  type ExpectedPitchDiagnostic,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceArticulation,
  type ListenSequenceAttackDiagnostic,
  type ListenSequenceEventDiagnostic,
  type ListenSequenceRunResult,
  type ListenSequenceRunSummary,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import { pianoDefinition, type PianoId, type PianoLayerId } from "./pianoRegistry";
import {
  LISTEN_DYNAMICS_VALIDATION_SUITES,
  LISTEN_ISOLATED_RELEASE_GATE,
  LISTEN_LAYER_INDEPENDENT_LOSS_ALLOWANCE,
  LISTEN_LATENCY_REGRESSION_TOLERANCE_MS,
  LISTEN_PROFILE_GATES,
  LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
  conciseListenDynamicsProfileValidationResult,
  conciseListenIsolatedProfileValidationResult,
  conciseListenSequenceProfileValidationResult,
  evaluateListenDynamicsProfileValidation,
  evaluateListenIsolatedProfileValidation,
  evaluateListenProfileValidationGates,
  evaluateListenSequenceProfileValidation,
  listenDynamicsValidationCases,
  listenIsolatedOutcomeSignature,
  listenIsolatedValidationCases,
  listenCommittedRegressionFailures,
  listenLateAdvanceDiagnostics,
  listenLateAdvanceForensics,
  listenNewUnsafeAdvances,
  listenProfileGateDefinition,
  listenProfileLayerLossKey,
  listenProfileOutcomeDigest,
  listenSequenceOutcomeSignature,
  listenSequenceValidationCases,
  listenUnsafeAdvanceIdentities,
  listenValidationEvidenceRole,
  listenValidationTraceSafety,
  replayListenIsolatedProfileMatrix,
  replayListenSequenceProfileMatrix,
  resolveListenValidationProfileIds,
  listenValidationProfileIdentities,
  summarizeListenDynamicsProfileValidation,
  summarizeListenIsolatedProfileValidation,
  summarizeListenSequenceProfileValidation,
  type ListenDynamicsProfileValidationResult,
  type ListenDynamicsRendererValidation,
  type ListenDynamicsValidationCapture,
  type ListenDynamicsValidationCase,
  type ListenDynamicsValidationCaseResult,
  type ListenDynamicsValidationSuite,
  type ListenIsolatedProfileValidationResult,
  type ListenIsolatedRendererValidation,
  type ListenIsolatedValidationCapture,
  type ListenIsolatedValidationCase,
  type ListenIsolatedValidationCaseResult,
  type ListenProfileGateCode,
  type ListenProfileValidationGateReport,
  type ListenReviewedLayerLoss,
  type ListenSequenceProfileValidationResult,
  type ListenSequenceRendererValidation,
  type ListenSequenceValidationCapture,
  type ListenSequenceValidationCase,
  type ListenSequenceValidationCaseResult,
  type ListenValidationProfileIdentity,
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
  for (const profile of direct.profiles) {
    assert.equal(
      profile.lateAdvances.length,
      profile.totals.lateAdvanceCount + profile.regressionTotals.lateAdvanceCount,
    );
  }
  assert.deepEqual(
    concise.renderers[0].profiles.map(({ lateAdvances }) => lateAdvances),
    direct.profiles.map(({ lateAdvances }) => lateAdvances),
  );
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
  for (const profile of tone.regressionCases[0].profiles) {
    assert.equal(profile.lateAdvances.length, profile.lateAdvanceCount);
    for (const forensic of profile.lateAdvances) {
      assert.equal(forensic.traceId, tone.regressionCases[0].traceId);
      assert.ok(Number.isInteger(forensic.sourceAttackIndex));
      assert.ok(forensic.sourceAttackPitches.length > 0);
      assert.ok(forensic.sourceToTargetDistance > 0);
      assert.ok(forensic.attributionDelayMs > 0);
    }
  }
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
  assert.deepEqual(
    concise.renderers[1].regressionCases[0].profiles.map(({ lateAdvances }) => lateAdvances),
    tone.regressionCases[0].profiles.map(({ lateAdvances }) => lateAdvances),
  );
  for (const profile of tone.profiles) {
    assert.equal(profile.lateAdvances.length, profile.safety.lateAdvanceCount);
  }
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

/** A complete event diagnostic, so an outcome signature reads real fields. */
function outcomeEvent(
  update: Partial<ListenSequenceEventDiagnostic> = {},
): ListenSequenceEventDiagnostic {
  return {
    index: 0,
    scheduledAttackTimeMs: 1000,
    targetPitches: [60, 64, 67],
    playedPitches: [60, 64, 67],
    expectedPitches: [],
    firstRawEvidenceTimeMs: 1032,
    firstThresholdQualifiedEvidenceTimeMs: 1064,
    firstQualifyingPitchEvidenceTimeMs: 1064,
    confidentUnexpectedPitches: [],
    allRequiredRawEvidencePresent: true,
    thresholdQualified: true,
    independentlyMatched: true,
    independentMatchAtMs: 1096,
    independentMatchLatencyMs: 96,
    orderedAdvanced: true,
    orderedAdvancedAtMs: 1096,
    orderedAdvanceLatencyMs: 96,
    advanced: true,
    advancedAtMs: 1096,
    onsetToAdvanceMs: 96,
    activeTargetIndexAtAttack: 0,
    blockedByPriorStall: false,
    unexpectedPitches: [],
    nextAttackBeforeAdvance: false,
    missed: false,
    duplicate: false,
    skipped: false,
    falseAdvance: false,
    lateAdvance: false,
    timedOut: false,
    rawFailureReasons: [],
    independentFailureReasons: [],
    orderedFailureReasons: [],
    failureReasons: [],
    primaryFailure: null,
    ...update,
  };
}

/** A complete expected-pitch diagnostic, the leaf of one target's outcome. */
function outcomePitch(update: Partial<ExpectedPitchDiagnostic> = {}): ExpectedPitchDiagnostic {
  return {
    midi: 60,
    attackRequired: true,
    requiredAttackType: "onset",
    observedAttackType: "onset",
    rawAttackDetected: true,
    rawOnsetProduced: true,
    rawOnsetTimeMs: 1032,
    maximumOnsetConfidence: 0.82,
    onsetConfidence: 0.81,
    noteConfidence: 0.79,
    qualifyingOnset: true,
    maximumActiveConfidence: 0.9,
    firstRawEvidenceTimeMs: 1032,
    firstThresholdQualifiedEvidenceTimeMs: 1064,
    requiredRawEvidencePresent: true,
    thresholdQualified: true,
    ...update,
  };
}

/** A complete attack diagnostic, which carries the advancement's attribution. */
function outcomeAttack(
  update: Partial<ListenSequenceAttackDiagnostic> = {},
): ListenSequenceAttackDiagnostic {
  return {
    index: 0,
    scheduledAtMs: 1000,
    targetIndex: 0,
    playedPitches: [60, 64, 67],
    expectedAdvance: true,
    activeTargetIndexAtAttack: 0,
    advancementTargetIndices: [0],
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
  rendererKey?: ListenTraceRendererKey;
  column?: readonly ListenValidationProfileIdentity[];
  events?: (profileId: ListenMatcherProfileId) => ListenSequenceEventDiagnostic[];
  attacks?: (profileId: ListenMatcherProfileId) => ListenSequenceAttackDiagnostic[];
  counts: (profileId: ListenMatcherProfileId) => Partial<ListenSequenceRunSummary>;
}): ListenDynamicsValidationCaseResult {
  const layer = options.layer ?? null;
  const rendererKey = options.rendererKey ?? "direct";
  const column = options.column ?? DYNAMICS_COLUMN;
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
    rendererKey,
    renderer: rendererKey === "tone"
      ? LISTEN_BENCHMARK_TONE_RENDERER.version
      : LISTEN_BENCHMARK_RENDERER.version,
    recognitionStructureHash: options.traceId,
    frameCount: 54,
    pcmLength: 512,
    peak: 0.4,
    rms: 0.1,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
    profiles: column.map(({ profileId, profile }) => ({
      profileId,
      profile,
      run: {
        events: options.events?.(profileId) ?? [],
        attacks: options.attacks?.(profileId) ?? [],
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

/* ------------------------------------------------------------------------- *
 * The unified production-candidate gate
 * ------------------------------------------------------------------------- */

/**
 * The gate is proved on stated results rather than on replayed audio.
 *
 * Every frozen candidate is strictly more permissive than `baseline-v1`, so the
 * synthetic traces cannot produce a candidate that loses recognition, regresses
 * a speed, or drops a velocity layer — and those are exactly the boundaries a
 * gate has to be shown to reject. The three domain matrices are therefore built
 * from stated per-profile rows and summarized by the real aggregation
 * functions, so only the measurement is synthetic, not the arithmetic.
 */

const GATE_CANDIDATE_PROFILE_ID: ListenMatcherProfileId = "early-open-v2";
const GATE_COLUMN = listenValidationProfileIdentities(
  resolveListenValidationProfileIds([GATE_CANDIDATE_PROFILE_ID]),
);
const GATE_MANIFEST = Object.freeze({
  version: 1,
  hash: "gate-test",
  corpusHash: "gate-corpus-test",
});

/** A two-candidate matrix, for proving that a per-candidate rule is per candidate. */
const TWO_CANDIDATE_COLUMN = listenValidationProfileIdentities(
  resolveListenValidationProfileIds(["early-open-v2", "steady-open-v2"]),
);

interface GateIsolatedRow {
  correctAdvances: number;
  courseClearAdvances: number;
  falseAdvances?: number;
  ambiguousAdvances?: number;
  onsetToAdvanceMs?: number;
}

function gateIsolatedCase(options: {
  traceId: string;
  caseIndex: number;
  rendererKey: ListenTraceRendererKey;
  partition: ListenTracePartition;
  caseKind: ListenIsolatedCaseKind;
  fixtureGroup: "general" | "course-clear";
  expectedCorrect: boolean;
  mathematicallyAmbiguous: boolean;
  column: readonly ListenValidationProfileIdentity[];
  outcome: (profileId: ListenMatcherProfileId) => { advanced: boolean; onsetToAdvanceMs: number | null };
}): ListenIsolatedValidationCaseResult {
  return {
    traceId: options.traceId,
    partition: options.partition,
    caseIndex: options.caseIndex,
    caseKind: options.caseKind,
    fixtureGroup: options.fixtureGroup,
    measure: 1,
    moment: options.caseIndex,
    targetPitches: [60, 64, 67],
    playedPitches: options.expectedCorrect ? [60, 64, 67] : [64, 67],
    expectedCorrect: options.expectedCorrect,
    mathematicallyAmbiguous: options.mathematicallyAmbiguous,
    rendererKey: options.rendererKey,
    renderer: options.rendererKey === "tone"
      ? LISTEN_BENCHMARK_TONE_RENDERER.version
      : LISTEN_BENCHMARK_RENDERER.version,
    recognitionStructureHash: options.traceId,
    frameCount: 4,
    pcmLength: 512,
    maximumInferenceMs: 4,
    profiles: options.column.map(({ profileId, profile }) => ({
      profileId,
      profile,
      ...options.outcome(profileId),
    })),
  };
}

/**
 * One renderer's isolated matrix, sized as the frozen corpus unless a test is
 * proving what a differently sized corpus does to the absolute floors.
 */
function gateIsolatedRenderer(
  rendererKey: ListenTraceRendererKey,
  rows: Partial<Record<ListenMatcherProfileId, GateIsolatedRow>>,
  options: {
    correctTrialCount?: number;
    courseClearCorrectTrialCount?: number;
    wrongTrialCount?: number;
    ambiguousTrialCount?: number;
    partition?: ListenTracePartition;
    column?: readonly ListenValidationProfileIdentity[];
  } = {},
): ListenIsolatedRendererValidation {
  const column = options.column ?? GATE_COLUMN;
  const correctTrialCount = options.correctTrialCount ?? 106;
  const courseClearCorrectTrialCount = options.courseClearCorrectTrialCount ?? 54;
  const wrongTrialCount = options.wrongTrialCount ?? 4;
  const ambiguousTrialCount = options.ambiguousTrialCount ?? 2;
  const partition = options.partition ?? "confirmation";
  const renderer = rendererKey === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
  const rowFor = (profileId: ListenMatcherProfileId): GateIsolatedRow => {
    const row = rows[profileId];
    if (!row) throw new Error(`The isolated ${rendererKey} matrix has no row for ${profileId}.`);
    return row;
  };
  const cases: ListenIsolatedValidationCaseResult[] = [];
  for (let index = 0; index < correctTrialCount; index += 1) {
    const courseClear = index < courseClearCorrectTrialCount;
    cases.push(gateIsolatedCase({
      traceId: `isolated/${rendererKey}/${String(index).padStart(3, "0")}`,
      caseIndex: index,
      rendererKey,
      partition,
      caseKind: "correct",
      fixtureGroup: courseClear ? "course-clear" : "general",
      expectedCorrect: true,
      mathematicallyAmbiguous: false,
      column,
      outcome: (profileId) => {
        const row = rowFor(profileId);
        const advanced = courseClear
          ? index < row.courseClearAdvances
          : index - courseClearCorrectTrialCount < row.correctAdvances - row.courseClearAdvances;
        return { advanced, onsetToAdvanceMs: advanced ? row.onsetToAdvanceMs ?? 196 : null };
      },
    }));
  }
  for (let index = 0; index < wrongTrialCount; index += 1) {
    cases.push(gateIsolatedCase({
      traceId: `isolated/${rendererKey}/omitted-bass-${index}`,
      caseIndex: correctTrialCount + index,
      rendererKey,
      partition,
      caseKind: "omitted-bass",
      fixtureGroup: "course-clear",
      expectedCorrect: false,
      mathematicallyAmbiguous: false,
      column,
      outcome: (profileId) => ({
        advanced: index < (rowFor(profileId).falseAdvances ?? 0),
        onsetToAdvanceMs: null,
      }),
    }));
  }
  for (let index = 0; index < ambiguousTrialCount; index += 1) {
    cases.push(gateIsolatedCase({
      traceId: `isolated/${rendererKey}/ambiguous-${index}`,
      caseIndex: correctTrialCount + wrongTrialCount + index,
      rendererKey,
      partition,
      caseKind: "ambiguous-harmonic",
      fixtureGroup: "general",
      expectedCorrect: false,
      mathematicallyAmbiguous: true,
      column,
      outcome: (profileId) => ({
        advanced: index < (rowFor(profileId).ambiguousAdvances ?? 0),
        onsetToAdvanceMs: null,
      }),
    }));
  }
  return summarizeListenIsolatedProfileValidation(rendererKey, renderer, cases, column);
}

function gateIsolatedResult(
  renderers: ListenIsolatedRendererValidation[],
  overrides: Partial<ListenIsolatedProfileValidationResult> = {},
): ListenIsolatedProfileValidationResult {
  const capturedTraceCount = renderers.reduce((total, { caseCount }) => total + caseCount, 0);
  return {
    manifest: {
      ...GATE_MANIFEST,
      traceCount: capturedTraceCount,
      isolatedTraceCount: capturedTraceCount,
      capturedTraceCount,
    },
    partitions: [...new Set(renderers.flatMap((renderer) => renderer.cases
      .map(({ partition }) => partition)))],
    baselineProfileId: "baseline-v1",
    candidateProfileIds: [GATE_CANDIDATE_PROFILE_ID],
    profiles: GATE_COLUMN,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
    ...overrides,
  };
}

function gateSequenceCase(options: {
  traceId: string;
  rendererKey: ListenTraceRendererKey;
  partition: ListenTracePartition;
  family: string;
  intervalMs: number;
  sequenceId?: string;
  scoreEligible?: boolean;
  attacks?: (profileId: ListenMatcherProfileId) => ListenSequenceAttackDiagnostic[];
  events?: (profileId: ListenMatcherProfileId) => ListenSequenceEventDiagnostic[];
  column: readonly ListenValidationProfileIdentity[];
  counts: (profileId: ListenMatcherProfileId) => Partial<ListenSequenceRunSummary>;
}): ListenSequenceValidationCaseResult {
  const sequenceId = options.sequenceId ?? `${options.family}-passage`;
  return {
    traceId: options.traceId,
    partition: options.partition,
    scoreEligible: options.scoreEligible ?? options.partition !== "regression-only",
    sequenceId,
    sequenceLabel: sequenceId,
    family: options.family,
    intervalMs: options.intervalMs,
    eventRate: 1000 / options.intervalMs,
    rendererKey: options.rendererKey,
    renderer: options.rendererKey === "tone"
      ? LISTEN_BENCHMARK_TONE_RENDERER.version
      : LISTEN_BENCHMARK_RENDERER.version,
    recognitionStructureHash: options.traceId,
    frameCount: 54,
    pcmLength: 512,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
    profiles: options.column.map(({ profileId, profile }) => ({
      profileId,
      profile,
      run: {
        sequenceId,
        family: options.family,
        intervalMs: options.intervalMs,
        events: options.events?.(profileId) ?? [],
        attacks: options.attacks?.(profileId) ?? [],
        summary: fabricatedSummary(options.counts(profileId)),
      } as unknown as ListenSequenceRunResult,
    })),
  };
}

/** The scored families the synthetic sequence corpus spans. */
const GATE_SEQUENCE_FAMILIES = ["course-clear", "repeated-chord"] as const;

function gateSequenceRenderer(
  rendererKey: ListenTraceRendererKey,
  counts: (input: {
    profileId: ListenMatcherProfileId;
    family: string;
    intervalMs: number;
  }) => Partial<ListenSequenceRunSummary>,
  options: {
    intervalsMs?: readonly number[];
    safety?: (input: {
      profileId: ListenMatcherProfileId;
      intervalMs: number;
    }) => Partial<ListenSequenceRunSummary>;
    carriedBassAttacks?: (input: {
      profileId: ListenMatcherProfileId;
      intervalMs: number;
    }) => ListenSequenceAttackDiagnostic[];
    column?: readonly ListenValidationProfileIdentity[];
    events?: (input: {
      profileId: ListenMatcherProfileId;
      family: string;
      intervalMs: number;
    }) => ListenSequenceEventDiagnostic[];
    attacks?: (input: {
      profileId: ListenMatcherProfileId;
      family: string;
      intervalMs: number;
    }) => ListenSequenceAttackDiagnostic[];
  } = {},
): ListenSequenceRendererValidation {
  const intervalsMs = options.intervalsMs ?? LISTEN_SEQUENCE_INTERVALS_MS;
  const column = options.column ?? GATE_COLUMN;
  const renderer = rendererKey === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
  const cases: ListenSequenceValidationCaseResult[] = [];
  for (const intervalMs of intervalsMs) {
    for (const family of GATE_SEQUENCE_FAMILIES) {
      cases.push(gateSequenceCase({
        traceId: `sequence/${rendererKey}/${family}/${intervalMs.toFixed(0)}`,
        rendererKey,
        partition: "discovery",
        family,
        intervalMs,
        column,
        events: (profileId) => options.events?.({ profileId, family, intervalMs }) ?? [],
        attacks: (profileId) => options.attacks?.({ profileId, family, intervalMs }) ?? [],
        counts: (profileId) => counts({ profileId, family, intervalMs }),
      }));
    }
    cases.push(gateSequenceCase({
      traceId: `sequence/${rendererKey}/carried-bass-safety/${intervalMs.toFixed(0)}`,
      rendererKey,
      partition: "regression-only",
      family: "safety",
      intervalMs,
      sequenceId: "carried-bass-safety",
      column,
      attacks: (profileId) => options.carriedBassAttacks?.({ profileId, intervalMs }) ?? [],
      counts: (profileId) => options.safety?.({ profileId, intervalMs }) ?? {},
    }));
  }
  return summarizeListenSequenceProfileValidation(rendererKey, renderer, cases, column);
}

function gateSequenceResult(
  renderers: ListenSequenceRendererValidation[],
  overrides: Partial<ListenSequenceProfileValidationResult> = {},
): ListenSequenceProfileValidationResult {
  const capturedTraceCount = renderers.reduce((total, { caseCount }) => total + caseCount, 0);
  return {
    manifest: {
      ...GATE_MANIFEST,
      traceCount: capturedTraceCount,
      sequenceTraceCount: capturedTraceCount,
      capturedTraceCount,
    },
    evidenceRole: "discovery",
    partitions: [...new Set(renderers.flatMap((renderer) => renderer.cases
      .map(({ partition }) => partition)))],
    baselineProfileId: "baseline-v1",
    candidateProfileIds: [GATE_CANDIDATE_PROFILE_ID],
    profiles: GATE_COLUMN,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
    ...overrides,
  };
}

/**
 * One renderer's dynamics matrix: one tuned and one held-back layer per piano,
 * a held-back mixed run per piano, and one articulation of each partition.
 */
function gateDynamicsRenderer(
  rendererKey: ListenTraceRendererKey,
  counts: (input: {
    profileId: ListenMatcherProfileId;
    key: string;
    partition: ListenTracePartition;
  }) => Partial<ListenSequenceRunSummary>,
  options: {
    column?: readonly ListenValidationProfileIdentity[];
    events?: (input: {
      profileId: ListenMatcherProfileId;
      key: string;
    }) => ListenSequenceEventDiagnostic[];
    attacks?: (input: {
      profileId: ListenMatcherProfileId;
      key: string;
    }) => ListenSequenceAttackDiagnostic[];
  } = {},
): ListenDynamicsRendererValidation {
  const column = options.column ?? GATE_COLUMN;
  const renderer = rendererKey === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
  const rows: Array<{
    key: string;
    partition: ListenTracePartition;
    suite: ListenDynamicsValidationSuite;
    piano: PianoId;
    layer?: PianoLayerId | null;
    articulation?: ListenSequenceArticulation;
  }> = [
    { key: "layer/splendid/mp", partition: "discovery", suite: "dynamics-constant", piano: "splendid", layer: "mp" },
    { key: "layer/splendid/pp", partition: "confirmation", suite: "dynamics-constant", piano: "splendid", layer: "pp" },
    { key: "layer/salamander/v03", partition: "discovery", suite: "dynamics-constant", piano: "salamander", layer: "v03" },
    { key: "layer/salamander/v05", partition: "confirmation", suite: "dynamics-constant", piano: "salamander", layer: "v05" },
    { key: "mixed/splendid", partition: "confirmation", suite: "dynamics-mixed", piano: "splendid", layer: null },
    { key: "mixed/salamander", partition: "confirmation", suite: "dynamics-mixed", piano: "salamander", layer: null },
    { key: "articulation/normal", partition: "discovery", suite: "articulation", piano: "splendid", articulation: "normal" },
    { key: "articulation/legato", partition: "confirmation", suite: "articulation", piano: "splendid", articulation: "legato" },
  ];
  const cases = rows.map((row) => fabricatedDynamicsCase({
    traceId: `${row.suite}/${rendererKey}/${row.key}`,
    partition: row.partition,
    suite: row.suite,
    piano: row.piano,
    layer: row.layer === undefined ? "mp" : row.layer,
    articulation: row.articulation ?? "normal",
    rendererKey,
    column,
    events: (profileId) => options.events?.({ profileId, key: row.key }) ?? [],
    attacks: (profileId) => options.attacks?.({ profileId, key: row.key }) ?? [],
    counts: (profileId) => counts({ profileId, key: row.key, partition: row.partition }),
  }));
  return summarizeListenDynamicsProfileValidation(rendererKey, renderer, cases, column);
}

function gateDynamicsResult(
  renderers: ListenDynamicsRendererValidation[],
  overrides: Partial<ListenDynamicsProfileValidationResult> = {},
): ListenDynamicsProfileValidationResult {
  const capturedTraceCount = renderers.reduce((total, { caseCount }) => total + caseCount, 0);
  return {
    manifest: {
      ...GATE_MANIFEST,
      traceCount: capturedTraceCount,
      dynamicsConstantTraceCount: capturedTraceCount,
      dynamicsMixedTraceCount: 0,
      articulationTraceCount: 0,
      capturedTraceCount,
    },
    evidenceRole: "mixed",
    partitions: [...new Set(renderers.flatMap((renderer) => renderer.cases
      .map(({ partition }) => partition)))],
    suites: [...LISTEN_DYNAMICS_VALIDATION_SUITES],
    baselineProfileId: "baseline-v1",
    candidateProfileIds: [GATE_CANDIDATE_PROFILE_ID],
    profiles: GATE_COLUMN,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
    ...overrides,
  };
}

/** Isolated rows that clear every fixed floor with room on both renderers. */
const CLEAN_ISOLATED_ROWS: Partial<Record<ListenMatcherProfileId, GateIsolatedRow>> = {
  "baseline-v1": { correctAdvances: 104, courseClearAdvances: 52 },
  [GATE_CANDIDATE_PROFILE_ID]: { correctAdvances: 106, courseClearAdvances: 54 },
};

const TWO_CANDIDATE_ISOLATED_ROWS: Partial<Record<ListenMatcherProfileId, GateIsolatedRow>> = {
  ...CLEAN_ISOLATED_ROWS,
  "steady-open-v2": { correctAdvances: 106, courseClearAdvances: 54 },
};

/** A candidate that recognizes more at every speed, in both scored families. */
function cleanSequenceCounts({ profileId }: { profileId: ListenMatcherProfileId }) {
  return profileId === "baseline-v1"
    ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
    : { independentMatchCount: 22, orderedAdvanceCount: 20 };
}

/** A candidate that loses nothing on any layer, mixed run, or articulation. */
function cleanDynamicsCounts({ profileId }: { profileId: ListenMatcherProfileId }) {
  return profileId === "baseline-v1"
    ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
    : { independentMatchCount: 26, orderedAdvanceCount: 24 };
}

function cleanGateInput() {
  return {
    isolated: gateIsolatedResult([
      gateIsolatedRenderer("direct", CLEAN_ISOLATED_ROWS),
      gateIsolatedRenderer("tone", CLEAN_ISOLATED_ROWS),
    ]),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", cleanSequenceCounts),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", cleanDynamicsCounts),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  };
}

function gateOutcome(
  report: ListenProfileValidationGateReport,
  code: ListenProfileGateCode,
  profileId: ListenMatcherProfileId = GATE_CANDIDATE_PROFILE_ID,
) {
  const candidate = report.candidates.find((entry) => entry.profileId === profileId);
  assert.ok(candidate, `no gate report for ${profileId}`);
  const outcome = candidate.gates.find((gate) => gate.code === code);
  assert.ok(outcome, `no ${code} outcome for ${profileId}`);
  return outcome;
}

test("the frozen gate list is reported in full, with a role and a requirement each", () => {
  const codes = LISTEN_PROFILE_GATES.map(({ code }) => code);
  assert.equal(new Set(codes).size, codes.length);
  for (const definition of LISTEN_PROFILE_GATES) {
    assert.equal(listenProfileGateDefinition(definition.code), definition);
    assert.ok(definition.requirement.length > 0, definition.code);
  }
  assert.throws(
    () => listenProfileGateDefinition("not-a-gate" as ListenProfileGateCode),
    /Unknown profile gate code/,
  );
  // Every gate appears on every candidate, applied or not, so a narrowed run
  // cannot look complete by reporting only the gates it managed to evaluate.
  const report = evaluateListenProfileValidationGates(cleanGateInput());
  for (const candidate of report.candidates) {
    assert.deepEqual(candidate.gates.map(({ code }) => code), codes);
  }
});

test("a clean complete matrix makes the candidate eligible without selecting anything", () => {
  const report = evaluateListenProfileValidationGates(cleanGateInput());
  assert.equal(report.evidenceComplete, true);
  assert.deepEqual(report.incompleteEvidenceReasons, []);
  assert.deepEqual(report.eligibleProfileIds, [GATE_CANDIDATE_PROFILE_ID]);
  assert.equal(report.recommendation.code, "eligible-candidates");
  assert.equal(report.baselineProfileId, "baseline-v1");
  // The report carries the threshold values every row was measured under.
  assert.deepEqual(
    report.profiles.map(({ profileId }) => profileId),
    ["baseline-v1", GATE_CANDIDATE_PROFILE_ID],
  );
  assert.ok(report.profiles[1].profile.onsetThreshold > 0);
  assert.equal(report.profiles[1].profile.requireFreshBassOnset, true);
  const candidate = report.candidates[0];
  assert.equal(candidate.eligibility, "eligible");
  assert.deepEqual(candidate.failedGateCodes, []);
  assert.equal(candidate.safetyFailureCount, 0);
  for (const gate of candidate.gates) {
    assert.equal(gate.applied, true, gate.code);
    assert.equal(gate.passed, true, gate.code);
  }
  // Each gate says which partitions it read, and release gates read only the
  // held-back ones while the sequence corpus stays labeled discovery.
  assert.deepEqual(gateOutcome(report, "release-isolated-recognition").partitions, ["confirmation"]);
  assert.equal(gateOutcome(report, "release-isolated-recognition").evidenceRole, "confirmation");
  assert.deepEqual(gateOutcome(report, "release-dynamics-layer-loss").partitions, ["confirmation"]);
  assert.equal(
    gateOutcome(report, "consistency-sequence-speed-recognition").evidenceRole,
    "discovery",
  );
  assert.deepEqual(gateOutcome(report, "consistency-dynamics-layer-loss").partitions, ["discovery"]);
  // A gate that reads gating rows borrows no scored role at all.
  assert.equal(gateOutcome(report, "safety-committed-regression").evidenceRole, null);
  assert.deepEqual(gateOutcome(report, "safety-sequence-dedicated-families").partitions, [
    "regression-only",
  ]);
  // Every measured domain is identified well enough to be repeated and compared.
  const domains = new Map(report.domains.map((domain) => [domain.domain, domain]));
  assert.equal(domains.get("isolated")?.traceIdentities.length, 224);
  assert.deepEqual(domains.get("sequence")?.rendererKeys, ["direct", "tone"]);
  assert.equal(domains.get("dynamics")?.manifestHash, GATE_MANIFEST.hash);
  assert.equal(domains.get("dynamics")?.manifestCorpusHash, GATE_MANIFEST.corpusHash);
  for (const domain of report.domains) {
    assert.equal(domain.present, true, domain.domain);
    assert.equal(domain.identityDigest.length, 8, domain.domain);
  }
});

test("each fixed isolated floor rejects exactly one advance below itself", () => {
  const at = (rendererKey: ListenTraceRendererKey, row: GateIsolatedRow) => {
    const clean = cleanGateInput();
    return evaluateListenProfileValidationGates({
      ...clean,
      isolated: gateIsolatedResult([
        gateIsolatedRenderer("direct", {
          ...CLEAN_ISOLATED_ROWS,
          ...(rendererKey === "direct" ? { [GATE_CANDIDATE_PROFILE_ID]: row } : {}),
        }),
        gateIsolatedRenderer("tone", {
          ...CLEAN_ISOLATED_ROWS,
          ...(rendererKey === "tone" ? { [GATE_CANDIDATE_PROFILE_ID]: row } : {}),
        }),
      ]),
    });
  };
  assert.equal(LISTEN_ISOLATED_RELEASE_GATE.direct.minimumCorrectAdvances, 104);
  assert.equal(LISTEN_ISOLATED_RELEASE_GATE.tone.minimumCorrectAdvances, 101);
  // Direct holds at 104 and fails at 103.
  assert.equal(
    gateOutcome(at("direct", { correctAdvances: 104, courseClearAdvances: 54 }), "release-isolated-recognition").passed,
    true,
  );
  const lowDirect = gateOutcome(
    at("direct", { correctAdvances: 103, courseClearAdvances: 54 }),
    "release-isolated-recognition",
  );
  assert.equal(lowDirect.passed, false);
  assert.equal(lowDirect.failures[0].baselineValue, 104);
  assert.equal(lowDirect.failures[0].candidateValue, 103);
  assert.equal(lowDirect.failures[0].code, "release-isolated-recognition");
  assert.ok(lowDirect.failures[0].domainIds.includes("direct"));
  assert.match(lowDirect.failures[0].explanation, /below the fixed floor of 104/);
  // Tone holds at its own 101 and fails at 100, so one renderer's floor is
  // never applied to the other.
  assert.equal(
    gateOutcome(at("tone", { correctAdvances: 101, courseClearAdvances: 54 }), "release-isolated-recognition").passed,
    true,
  );
  assert.equal(
    gateOutcome(at("tone", { correctAdvances: 100, courseClearAdvances: 54 }), "release-isolated-recognition").passed,
    false,
  );
  // Course Clear holds at 52 and fails at 51 under both renderers.
  assert.equal(
    gateOutcome(at("direct", { correctAdvances: 106, courseClearAdvances: 52 }), "release-isolated-course-clear").passed,
    true,
  );
  assert.equal(
    gateOutcome(at("tone", { correctAdvances: 106, courseClearAdvances: 51 }), "release-isolated-course-clear").passed,
    false,
  );
});

test("the isolated latency gate holds at its ceiling and at one decoder hop of drift", () => {
  const at = (candidateMs: number, baselineMs = 196) => {
    const clean = cleanGateInput();
    const rows: Partial<Record<ListenMatcherProfileId, GateIsolatedRow>> = {
      "baseline-v1": { correctAdvances: 104, courseClearAdvances: 52, onsetToAdvanceMs: baselineMs },
      [GATE_CANDIDATE_PROFILE_ID]: {
        correctAdvances: 106,
        courseClearAdvances: 54,
        onsetToAdvanceMs: candidateMs,
      },
    };
    return gateOutcome(
      evaluateListenProfileValidationGates({
        ...clean,
        isolated: gateIsolatedResult([
          gateIsolatedRenderer("direct", rows),
          gateIsolatedRenderer("tone", rows),
        ]),
      }),
      "release-isolated-latency",
    );
  };
  assert.equal(LISTEN_LATENCY_REGRESSION_TOLERANCE_MS, 32);
  // A percentile that moved by less than one decoder hop has not moved.
  assert.equal(at(196 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS).passed, true);
  const drifted = at(196 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS + 1);
  assert.equal(drifted.passed, false);
  assert.match(drifted.failures[0].explanation, /decoder hop/);
  // The absolute ceiling is checked separately from the drift.
  assert.equal(at(399, 399).passed, true);
  const overCeiling = at(400, 400);
  assert.equal(overCeiling.passed, false);
  assert.match(overCeiling.failures[0].explanation, /400 ms limit/);
});

test("a distinguishable false advance rejects a candidate and names the fixtures", () => {
  const rows: Partial<Record<ListenMatcherProfileId, GateIsolatedRow>> = {
    "baseline-v1": { correctAdvances: 104, courseClearAdvances: 52, ambiguousAdvances: 2 },
    [GATE_CANDIDATE_PROFILE_ID]: {
      correctAdvances: 106,
      courseClearAdvances: 54,
      falseAdvances: 1,
      ambiguousAdvances: 2,
    },
  };
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    isolated: gateIsolatedResult([
      gateIsolatedRenderer("direct", rows),
      gateIsolatedRenderer("tone", CLEAN_ISOLATED_ROWS),
    ]),
  });
  const outcome = gateOutcome(report, "safety-isolated-false-advance");
  assert.equal(outcome.role, "safety");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, ["direct", "isolated/direct/omitted-bass-0"]);
  assert.equal(outcome.failures[0].baselineValue, 0);
  assert.equal(outcome.failures[0].candidateValue, 1);
  const candidate = report.candidates[0];
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.eligibility, "rejected");
  assert.equal(candidate.safetyFailureCount, 1);
  assert.equal(candidate.safety.isolatedDistinguishableFalseAdvances, 1);
  // Ambiguous advances are counted apart and never hide or excuse the above.
  assert.equal(candidate.safety.isolatedAmbiguousAdvances, 2);
  assert.equal(report.recommendation.code, "no-safe-candidate");
  assert.deepEqual(report.eligibleProfileIds, []);
  assert.match(report.recommendation.explanation, /baseline-v1 remains the production default/);
});

test("the dedicated safety families gate at every speed, including the carried bass", () => {
  const fastest = LISTEN_SEQUENCE_INTERVALS_MS[LISTEN_SEQUENCE_INTERVALS_MS.length - 1];
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", cleanSequenceCounts, {
        safety: ({ profileId, intervalMs }) => (
          profileId === "baseline-v1" || intervalMs !== fastest
            ? {}
            : { falseAdvanceCount: 1 }
        ),
      }),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
  });
  const outcome = gateOutcome(report, "safety-sequence-dedicated-families");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures.length, 1);
  assert.deepEqual(outcome.failures[0].domainIds, [`direct@${fastest.toFixed(2)}ms`]);
  assert.equal(outcome.failures[0].baselineValue, 0);
  assert.equal(outcome.failures[0].candidateValue, 1);
  assert.match(outcome.failures[0].explanation, /1 false/);
  assert.equal(report.candidates[0].safety.sequenceFalseAdvances, 1);
  // A fresh bass stays required: completing a target over a still sounding bass
  // is an incomplete carried-bass advance and rejects the candidate too.
  const carried = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", cleanSequenceCounts, {
        carriedBassAttacks: ({ profileId }) => (profileId === "baseline-v1" ? [] : [{
          index: 1,
          scheduledAtMs: 1000,
          targetIndex: 1,
          playedPitches: [64, 67],
          expectedAdvance: false,
          activeTargetIndexAtAttack: 1,
          advancementTargetIndices: [1],
        }]),
      }),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
  });
  const carriedOutcome = gateOutcome(carried, "safety-sequence-dedicated-families");
  assert.equal(carriedOutcome.passed, false);
  assert.equal(carriedOutcome.failures.length, LISTEN_SEQUENCE_INTERVALS_MS.length);
  assert.match(carriedOutcome.failures[0].explanation, /incomplete-carried-bass/);
  assert.equal(
    carried.candidates[0].safety.sequenceIncompleteCarriedBassAdvances,
    LISTEN_SEQUENCE_INTERVALS_MS.length,
  );
});

test("sequence non-regression rejects a lost speed and is labeled discovery consistency", () => {
  const slowest = LISTEN_SEQUENCE_INTERVALS_MS[0];
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId, intervalMs }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
          : intervalMs === slowest
          ? { independentMatchCount: 19, orderedAdvanceCount: 20 }
          : { independentMatchCount: 22, orderedAdvanceCount: 20 }
      )),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
  });
  const outcome = gateOutcome(report, "consistency-sequence-speed-recognition");
  assert.equal(outcome.role, "discovery-consistency");
  assert.equal(outcome.evidenceRole, "discovery");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, [`direct@${slowest.toFixed(2)}ms`]);
  // Two scored families lost one event each at that speed.
  assert.equal(outcome.failures[0].baselineValue, 40);
  assert.equal(outcome.failures[0].candidateValue, 38);
  // It still rejects: a labeled gate is not an optional one.
  assert.equal(report.candidates[0].eligible, false);
  assert.equal(report.candidates[0].discoveryConsistencyFailureCount, 1);
  assert.equal(report.candidates[0].releaseFailureCount, 0);
});

test("ordered advancement and complete passages hold under each renderer separately", () => {
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      // Direct gains a great deal.
      gateSequenceRenderer("direct", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 26, orderedAdvanceCount: 26 })),
      // Tone loses one ordered advance, which the Direct gain must not hide.
      gateSequenceRenderer("tone", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 22, orderedAdvanceCount: 17 })),
    ]),
  });
  const outcome = gateOutcome(report, "consistency-sequence-ordered-progress");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures.length, 1);
  assert.ok(outcome.failures[0].domainIds.includes("tone"));
  assert.match(outcome.failures[0].explanation, /under each renderer separately/);
  // The regressed passages stay individually named whatever the aggregate said.
  assert.equal(report.candidates[0].regressedSequenceTraceIds.length, 12);
});

test("an improvement must span more than one family and not be cascade amplification", () => {
  const oneFamily = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId, family }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : family === "course-clear"
        ? { independentMatchCount: 22, orderedAdvanceCount: 20 }
        : { independentMatchCount: 20, orderedAdvanceCount: 18 })),
      gateSequenceRenderer("tone", ({ profileId, family }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : family === "course-clear"
        ? { independentMatchCount: 22, orderedAdvanceCount: 20 }
        : { independentMatchCount: 20, orderedAdvanceCount: 18 })),
    ]),
  });
  const narrow = gateOutcome(oneFamily, "consistency-sequence-family-breadth");
  assert.equal(narrow.passed, false);
  assert.equal(narrow.failures[0].baselineValue, 2);
  assert.equal(narrow.failures[0].candidateValue, 1);
  assert.deepEqual(narrow.failures[0].domainIds, ["course-clear"]);
  // Ordered gains in both families with no additional independent recognition
  // anywhere is cascade amplification, which the same gate refuses.
  const cascade = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 20, orderedAdvanceCount: 20 })),
      gateSequenceRenderer("tone", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 20, orderedAdvanceCount: 20 })),
    ]),
  });
  const amplified = gateOutcome(cascade, "consistency-sequence-family-breadth");
  assert.equal(amplified.passed, false);
  assert.match(amplified.failures[0].explanation, /cascade amplification/);
  // A candidate that gains nothing claims nothing, so the gate is not tripped.
  const flat = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", () => ({ independentMatchCount: 20, orderedAdvanceCount: 18 })),
      gateSequenceRenderer("tone", () => ({ independentMatchCount: 20, orderedAdvanceCount: 18 })),
    ]),
  });
  assert.equal(gateOutcome(flat, "consistency-sequence-family-breadth").passed, true);
});

test("a held-back layer loss gates above its allowance and stays visible below it", () => {
  const withLoss = (loss: number, key = "layer/salamander/v05") => evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, key: groupKey }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
          : groupKey === key
          ? { independentMatchCount: 24 - loss, orderedAdvanceCount: 22 - loss }
          : { independentMatchCount: 26, orderedAdvanceCount: 24 }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  });
  assert.equal(LISTEN_LAYER_INDEPENDENT_LOSS_ALLOWANCE, 1);
  // One lost event is allowed, and is still reported as a loss.
  const allowed = withLoss(1);
  assert.equal(gateOutcome(allowed, "release-dynamics-layer-loss").passed, true);
  assert.deepEqual(
    allowed.candidates[0].layerLosses.map(({ groupKey }) => groupKey),
    ["layer/salamander/v05"],
  );
  assert.equal(allowed.candidates[0].layerLosses[0].independentMatchDelta, -1);
  assert.equal(allowed.candidates[0].layerLosses[0].evidenceRole, "confirmation");
  assert.equal(allowed.candidates[0].layerLosses[0].reviewed, false);
  // Two lose the row its gate.
  const rejected = withLoss(2);
  const outcome = gateOutcome(rejected, "release-dynamics-layer-loss");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.role, "release");
  assert.ok(outcome.failures[0].domainIds.includes("layer/salamander/v05"));
  assert.equal(outcome.failures[0].baselineValue, 24);
  assert.equal(outcome.failures[0].candidateValue, 22);
  // A discovery layer is measured by the labeled gate instead, never by the
  // release one, so tuning data cannot be quoted as generalization.
  const discovery = withLoss(2, "layer/salamander/v03");
  assert.equal(gateOutcome(discovery, "release-dynamics-layer-loss").passed, true);
  assert.equal(gateOutcome(discovery, "consistency-dynamics-layer-loss").passed, false);
  assert.equal(
    gateOutcome(discovery, "consistency-dynamics-layer-loss").failures[0].code,
    "consistency-dynamics-layer-loss",
  );
});

test("a reviewed explanation excuses one candidate's named loss, and nothing else", () => {
  const input = (candidateIndependent = 20) => ({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, key }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
          : key === "layer/salamander/v05"
          ? { independentMatchCount: candidateIndependent, orderedAdvanceCount: 18 }
          : { independentMatchCount: 26, orderedAdvanceCount: 24 }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  });
  const waiver = (overrides: Partial<ListenReviewedLayerLoss> = {}): ListenReviewedLayerLoss => ({
    profileId: GATE_CANDIDATE_PROFILE_ID,
    rendererKey: "direct",
    groupKey: "layer/salamander/v05",
    reviewedIndependentMatchDelta: -4,
    explanation: "The v05 layer is the quietest Salamander recording and its four lost events " +
      "are all upper voices already covered by the mp layer.",
    ...overrides,
  });
  assert.equal(listenProfileLayerLossKey("direct", "layer/x"), "direct:layer/x");
  const reviewed = evaluateListenProfileValidationGates({
    ...input(),
    reviewedLayerLosses: [waiver()],
  });
  assert.equal(gateOutcome(reviewed, "release-dynamics-layer-loss").passed, true);
  assert.equal(reviewed.candidates[0].layerLosses[0].reviewed, true);
  assert.equal(reviewed.reviewedLayerLosses.length, 1);
  assert.match(reviewed.reviewedLayerLosses[0].explanation, /quietest Salamander recording/);
  // The waiver covers the loss that was reviewed. A larger loss on the same row
  // is a loss nobody has looked at, whatever was written about the smaller one.
  const larger = evaluateListenProfileValidationGates({
    ...input(18),
    reviewedLayerLosses: [waiver()],
  });
  const exceeded = gateOutcome(larger, "release-dynamics-layer-loss");
  assert.equal(exceeded.passed, false);
  assert.match(exceeded.failures[0].explanation, /covers a loss of -4, which this loss exceeds/);
  // A loss smaller than the reviewed one stays covered.
  assert.equal(
    gateOutcome(
      evaluateListenProfileValidationGates({
        ...input(22),
        reviewedLayerLosses: [waiver()],
      }),
      "release-dynamics-layer-loss",
    ).passed,
    true,
  );
  // The waiver is for one candidate. Reviewing early-open-v2's loss says nothing
  // about any other profile's loss on the same row.
  const otherCandidate = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, key }) => (
        profileId === "baseline-v1" || key !== "layer/salamander/v05"
          ? cleanDynamicsCounts({ profileId })
          : { independentMatchCount: 20, orderedAdvanceCount: 18 }
      ), { column: TWO_CANDIDATE_COLUMN }),
      gateDynamicsRenderer("tone", cleanDynamicsCounts, { column: TWO_CANDIDATE_COLUMN }),
    ], { candidateProfileIds: ["early-open-v2", "steady-open-v2"] }),
    isolated: gateIsolatedResult([
      gateIsolatedRenderer("direct", TWO_CANDIDATE_ISOLATED_ROWS, { column: TWO_CANDIDATE_COLUMN }),
      gateIsolatedRenderer("tone", TWO_CANDIDATE_ISOLATED_ROWS, { column: TWO_CANDIDATE_COLUMN }),
    ], { candidateProfileIds: ["early-open-v2", "steady-open-v2"] }),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", cleanSequenceCounts, { column: TWO_CANDIDATE_COLUMN }),
      gateSequenceRenderer("tone", cleanSequenceCounts, { column: TWO_CANDIDATE_COLUMN }),
    ], { candidateProfileIds: ["early-open-v2", "steady-open-v2"] }),
    reviewedLayerLosses: [waiver()],
  });
  const waived = otherCandidate.candidates
    .find(({ profileId }) => profileId === "early-open-v2");
  const unwaived = otherCandidate.candidates
    .find(({ profileId }) => profileId === "steady-open-v2");
  assert.ok(waived && unwaived);
  assert.ok(!waived.failedGateCodes.includes("release-dynamics-layer-loss"));
  assert.ok(unwaived.failedGateCodes.includes("release-dynamics-layer-loss"));
  // Every field is checked against the measured matrix, so a stale waiver fails
  // loudly rather than quietly ceasing to excuse the row it was written for.
  const refuses = (overrides: Partial<ListenReviewedLayerLoss>, pattern: RegExp) => assert.throws(
    () => evaluateListenProfileValidationGates({
      ...input(),
      reviewedLayerLosses: [waiver(overrides)],
    }),
    pattern,
  );
  refuses({ groupKey: "layer/salamander/v5" }, /names no leaf row/);
  refuses({ profileId: "baseline-v1" }, /is not a candidate in this matrix/);
  refuses({ profileId: "balanced-v1" }, /is not a candidate in this matrix/);
  refuses({ explanation: "   " }, /carries no explanation/);
  refuses({ reviewedIndependentMatchDelta: 4 }, /must record a negative one/);
  // The excuse is per renderer: the same layer under Tone is a different row.
  const wrongRenderer = evaluateListenProfileValidationGates({
    ...input(),
    reviewedLayerLosses: [waiver({ rendererKey: "tone" })],
  });
  assert.equal(gateOutcome(wrongRenderer, "release-dynamics-layer-loss").passed, false);
  assert.throws(
    () => evaluateListenProfileValidationGates({
      ...input(),
      reviewedLayerLosses: [waiver(), waiver()],
    }),
    /listed twice/,
  );
  assert.throws(
    () => evaluateListenProfileValidationGates({
      isolated: cleanGateInput().isolated,
      reviewedLayerLosses: [waiver()],
    }),
    /no dynamics matrix was measured/,
  );
});

test("a renderer and piano aggregate is gated on the partition it belongs to", () => {
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, partition }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
          : partition === "confirmation"
          ? { independentMatchCount: 23, orderedAdvanceCount: 22 }
          : { independentMatchCount: 26, orderedAdvanceCount: 24 }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  });
  const outcome = gateOutcome(report, "release-dynamics-piano-recognition");
  assert.equal(outcome.passed, false);
  assert.deepEqual(
    outcome.failures.map(({ domainIds }) => domainIds).sort(),
    [["direct", "piano/salamander/confirmation"], ["direct", "piano/splendid/confirmation"]],
  );
  assert.equal(gateOutcome(report, "consistency-dynamics-piano-recognition").passed, true);
});

test("a new unsafe dynamics advance rejects the candidate on any partition", () => {
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, key }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
          : key === "articulation/normal"
          ? { independentMatchCount: 26, orderedAdvanceCount: 24, falseAdvanceCount: 1 }
          : { independentMatchCount: 26, orderedAdvanceCount: 24 }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  });
  const outcome = gateOutcome(report, "safety-dynamics-introduced-advance");
  assert.equal(outcome.role, "safety");
  assert.equal(outcome.passed, false);
  // Discovery is a partition, not an exemption: safety applies to every row.
  assert.ok(outcome.partitions.includes("discovery"));
  assert.deepEqual(
    report.candidates[0].safety.dynamicsIntroducedUnsafeTraceIds,
    ["articulation/direct/articulation/normal"],
  );
  assert.equal(report.recommendation.code, "no-safe-candidate");
});

test("late advances are reported with distance and delay, and never gate", () => {
  const lateEvent = (
    index: number,
    scheduledAttackTimeMs: number,
    advancedAtMs: number,
    targetPitches: number[],
  ) => ({
    index,
    scheduledAttackTimeMs,
    lateAdvance: true,
    advancedAtMs,
    targetPitches,
  } as unknown as ListenSequenceEventDiagnostic);
  const entries = [{
    traceId: "sequence/direct/late-forensics/500ms",
    run: {
      sequenceId: "late-forensics",
      events: [lateEvent(1, 1000, 1330, [60]), lateEvent(4, 2000, 2660, [64, 67])],
      attacks: [
        { index: 2, targetIndex: 2, playedPitches: [60], advancementTargetIndices: [1] },
        { index: 7, targetIndex: 7, playedPitches: [64, 67], advancementTargetIndices: [4] },
      ],
    } as unknown as ListenSequenceRunResult,
  }];
  const diagnostics = listenLateAdvanceDiagnostics(entries);
  assert.equal(diagnostics.lateAdvanceCount, 2);
  assert.deepEqual(diagnostics.records[0], {
    traceId: "sequence/direct/late-forensics/500ms",
    targetIndex: 1,
    targetPitches: [60],
    targetScheduledAttackTimeMs: 1000,
    advanceTimeMs: 1330,
    sourceAttackIndex: 2,
    sourceAttackPitches: [60],
    sourceToTargetDistance: 1,
    attributionDelayMs: 330,
  });
  assert.equal(diagnostics.meanSourceDistance, 2);
  assert.equal(diagnostics.maximumSourceDistance, 3);
  assert.equal(diagnostics.meanAttributionDelayMs, 495);
  assert.equal(diagnostics.maximumAttributionDelayMs, 660);
  assert.equal(listenLateAdvanceDiagnostics([]).lateAdvanceCount, 0);
  assert.deepEqual(listenLateAdvanceDiagnostics([]).records, []);
  assert.equal(listenLateAdvanceDiagnostics([]).meanSourceDistance, null);
  // A candidate that advances correct content one repetition behind is a lag,
  // not a safety failure, so it stays eligible with the lag on the record.
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 22, orderedAdvanceCount: 20, lateAdvanceCount: 3 })),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
  });
  assert.equal(report.candidates[0].eligible, true);
  assert.equal(gateOutcome(report, "safety-sequence-dedicated-families").passed, true);
});

test("late-advance exports refuse incomplete source attribution", () => {
  const lateEvent = {
    index: 1,
    scheduledAttackTimeMs: 1000,
    lateAdvance: true,
    advancedAtMs: 1330,
    targetPitches: [60],
  } as unknown as ListenSequenceEventDiagnostic;
  const missingSource = {
    events: [lateEvent],
    attacks: [],
  } as unknown as ListenSequenceRunResult;
  assert.throws(
    () => listenLateAdvanceForensics("sequence/direct/missing-source/500ms", missingSource),
    /without complete source attribution/,
  );

  const missingAdvanceTime = {
    events: [{ ...lateEvent, advancedAtMs: null }],
    attacks: [{
      index: 2,
      targetIndex: 2,
      playedPitches: [60],
      advancementTargetIndices: [1],
    }],
  } as unknown as ListenSequenceRunResult;
  assert.throws(
    () => listenLateAdvanceForensics(
      "sequence/direct/missing-advance-time/500ms",
      missingAdvanceTime,
    ),
    /without complete source attribution/,
  );
});

test("the committed regressions gate every candidate without replaying any audio", () => {
  const report = evaluateListenProfileValidationGates(cleanGateInput());
  const outcome = gateOutcome(report, "safety-committed-regression");
  assert.equal(outcome.applied, true);
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.partitions, ["regression-only"]);
  assert.equal(report.candidates[0].safety.regressionWorseThanBaselineCount, 0);
  // The v05 case is recovered a repetition earlier by every frozen candidate,
  // which deviates from the pinned advancement without being unsafe. Rejecting
  // it would reject an improvement, so the deviation is reported, not gated.
  assert.ok(report.candidates[0].safety.regressionDeviationCount > 0);
});

test("replay integrity is a gate, not an assumption", () => {
  const clean = cleanGateInput();
  const reused = evaluateListenProfileValidationGates({
    ...clean,
    sequence: gateSequenceResult(clean.sequence.renderers, { traceReuseVerified: false }),
  });
  const reuseOutcome = gateOutcome(reused, "replay-trace-reuse");
  assert.equal(reuseOutcome.passed, false);
  assert.deepEqual(reuseOutcome.failures[0].domainIds, ["sequence"]);
  assert.equal(reuseOutcome.failures[0].baselineValue, true);
  assert.equal(reuseOutcome.failures[0].candidateValue, false);
  const drifted = evaluateListenProfileValidationGates({
    ...clean,
    dynamics: gateDynamicsResult(clean.dynamics.renderers, { baselineParityVerified: false }),
  });
  const parityOutcome = gateOutcome(drifted, "replay-baseline-parity");
  assert.equal(parityOutcome.passed, false);
  assert.match(parityOutcome.failures[0].explanation, /the harness moved/);
  assert.equal(drifted.candidates[0].replayIntegrityFailureCount, 1);
  assert.equal(drifted.candidates[0].eligible, false);
});

test("a partial run may reject a candidate but may never clear one", () => {
  const clean = cleanGateInput();
  const report = evaluateListenProfileValidationGates({ isolated: clean.isolated });
  assert.equal(report.evidenceComplete, false);
  assert.equal(report.recommendation.code, "incomplete-evidence");
  assert.deepEqual(report.eligibleProfileIds, []);
  assert.equal(report.candidates[0].eligibility, "incomplete-evidence");
  assert.match(report.incompleteEvidenceReasons.join(" "), /continuous-sequence matrix was not measured/);
  assert.match(report.incompleteEvidenceReasons.join(" "), /dynamics and articulation matrix was not measured/);
  // Gates the run could not apply never report a pass.
  assert.equal(gateOutcome(report, "consistency-sequence-speed-recognition").applied, false);
  assert.equal(gateOutcome(report, "consistency-sequence-speed-recognition").passed, false);
  assert.equal(gateOutcome(report, "release-isolated-recognition").passed, true);
  // A one-renderer isolated run cannot clear the per-renderer floors either,
  // and a corpus of another size leaves the absolute floors unapplied.
  const single = evaluateListenProfileValidationGates({
    ...clean,
    isolated: gateIsolatedResult([gateIsolatedRenderer("direct", CLEAN_ISOLATED_ROWS)]),
  });
  assert.equal(single.evidenceComplete, false);
  assert.match(single.incompleteEvidenceReasons.join(" "), /covered one renderer/);
  const smallCorpus = evaluateListenProfileValidationGates({
    ...clean,
    isolated: gateIsolatedResult([
      gateIsolatedRenderer("direct", {
        "baseline-v1": { correctAdvances: 8, courseClearAdvances: 4 },
        [GATE_CANDIDATE_PROFILE_ID]: { correctAdvances: 8, courseClearAdvances: 4 },
      }, { correctTrialCount: 8, courseClearCorrectTrialCount: 4 }),
      gateIsolatedRenderer("tone", CLEAN_ISOLATED_ROWS),
    ]),
  });
  // 8 of 8 is far below the floor of 104, and the floor is not rescaled to the
  // corpus it was handed: the smaller renderer is left unscored, not passed.
  assert.equal(gateOutcome(smallCorpus, "release-isolated-recognition").passed, true);
  assert.match(smallCorpus.incompleteEvidenceReasons.join(" "), /not the 106 the fixed floor/);
  // A confirmation gate may not read a row from another partition at all, so a
  // misfiled renderer that would have failed the floor is skipped, not scored.
  const misfiled = evaluateListenProfileValidationGates({
    ...clean,
    isolated: gateIsolatedResult([
      gateIsolatedRenderer("direct", {
        "baseline-v1": { correctAdvances: 104, courseClearAdvances: 52 },
        [GATE_CANDIDATE_PROFILE_ID]: { correctAdvances: 50, courseClearAdvances: 20 },
      }, { partition: "discovery" }),
      gateIsolatedRenderer("tone", CLEAN_ISOLATED_ROWS),
    ]),
  });
  assert.equal(gateOutcome(misfiled, "release-isolated-recognition").passed, true);
  assert.deepEqual(gateOutcome(misfiled, "release-isolated-recognition").partitions, ["confirmation"]);
  assert.match(misfiled.incompleteEvidenceReasons.join(" "), /outside the confirmation partition/);
});

test("domains that did not measure one frozen matrix are refused rather than gated", () => {
  const clean = cleanGateInput();
  assert.throws(
    () => evaluateListenProfileValidationGates({}),
    /at least one measured validation domain/,
  );
  assert.throws(
    () => evaluateListenProfileValidationGates({
      ...clean,
      dynamics: gateDynamicsResult(clean.dynamics.renderers, {
        manifest: { ...clean.dynamics.manifest, hash: "another" },
      }),
    }),
    /while the isolated matrix used/,
  );
  assert.throws(
    () => evaluateListenProfileValidationGates({
      ...clean,
      dynamics: gateDynamicsResult(clean.dynamics.renderers, {
        manifest: { ...clean.dynamics.manifest, corpusHash: "another-corpus" },
      }),
    }),
    /another-corpus.*while the isolated matrix used/,
  );
  assert.throws(
    () => evaluateListenProfileValidationGates({
      ...clean,
      sequence: gateSequenceResult(clean.sequence.renderers, {
        candidateProfileIds: ["steady-open-v2"],
      }),
    }),
    /while the isolated matrix measured/,
  );
  assert.throws(
    () => evaluateListenProfileValidationGates({
      ...clean,
      sequence: gateSequenceResult(clean.sequence.renderers, {
        baselineProfileId: "balanced-v1",
      }),
    }),
    /compares against balanced-v1/,
  );
});

test("safety comparison sees a moved failure and a changed classification", () => {
  const run = (
    summary: Partial<ListenSequenceRunSummary>,
    events: ListenSequenceEventDiagnostic[] = [],
  ) => ({ events, summary: fabricatedSummary(summary) } as unknown as ListenSequenceRunResult);
  const unsafeEvent = (
    index: number,
    classification: "false-advance" | "skipped" | "duplicate",
  ) => ({
    index,
    falseAdvance: classification === "false-advance",
    skipped: classification === "skipped",
    duplicate: classification === "duplicate",
  } as unknown as ListenSequenceEventDiagnostic);
  // A run that keeps its total while turning a skip into a false advance has not
  // stayed as safe, so the classifications are compared one at a time.
  assert.deepEqual(
    listenNewUnsafeAdvances(run({ falseAdvanceCount: 1 }), run({ skippedAdvanceCount: 1 })),
    ["false advances rose from 0 to 1"],
  );
  // Same count and classification at another target is still a new failure.
  assert.deepEqual(
    listenNewUnsafeAdvances(
      run({ falseAdvanceCount: 1 }, [unsafeEvent(7, "false-advance")]),
      run({ falseAdvanceCount: 1 }, [unsafeEvent(3, "false-advance")]),
    ),
    ["target 7 is a new false-advance"],
  );
  // An unchanged row reads as unchanged rather than as a regression.
  assert.deepEqual(
    listenNewUnsafeAdvances(
      run({ falseAdvanceCount: 1 }, [unsafeEvent(3, "false-advance")]),
      run({ falseAdvanceCount: 1 }, [unsafeEvent(3, "false-advance")]),
    ),
    [],
  );
  assert.deepEqual(
    listenUnsafeAdvanceIdentities(run({}, [unsafeEvent(3, "duplicate")])),
    [{ targetIndex: 3, classification: "duplicate" }],
  );
  // Clearing a baseline failure is a gain, and is reported as one.
  const cleared = listenValidationTraceSafety([{
    traceId: "row",
    candidate: run({}),
    baseline: run({ falseAdvanceCount: 1 }, [unsafeEvent(3, "false-advance")]),
  }]);
  assert.deepEqual(cleared.clearedUnsafeTraceIds, ["row"]);
  assert.deepEqual(cleared.worsenedUnsafeTraceIds, []);
  assert.equal(cleared.passed, true);
  // Rows are compared one at a time: clearing one failure never pays for another.
  const traded = listenValidationTraceSafety([
    {
      traceId: "cleared-row",
      candidate: run({}),
      baseline: run({ falseAdvanceCount: 1 }),
    },
    {
      traceId: "introduced-row",
      candidate: run({ falseAdvanceCount: 1 }),
      baseline: run({}),
    },
  ]);
  assert.deepEqual(traded.clearedUnsafeTraceIds, ["cleared-row"]);
  assert.deepEqual(traded.introducedUnsafeTraceIds, ["introduced-row"]);
  assert.equal(traded.passed, false);
});

test("a false advance in an ordinary scored passage rejects the candidate", () => {
  const fastest = LISTEN_SEQUENCE_INTERVALS_MS[LISTEN_SEQUENCE_INTERVALS_MS.length - 1];
  const traceId = `sequence/direct/course-clear/${fastest.toFixed(0)}`;
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId, family, intervalMs }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
          : family === "course-clear" && intervalMs === fastest
          ? { independentMatchCount: 22, orderedAdvanceCount: 20, falseAdvanceCount: 1 }
          : { independentMatchCount: 22, orderedAdvanceCount: 20 }
      )),
      gateSequenceRenderer("tone", cleanSequenceCounts),
    ]),
  });
  // The passage belongs to no dedicated safety family, so the family-scoped
  // summary reports nothing at all. Safety cannot depend on that summary alone.
  assert.equal(gateOutcome(report, "safety-sequence-dedicated-families").passed, true);
  const outcome = gateOutcome(report, "safety-sequence-introduced-advance");
  assert.equal(outcome.role, "safety");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, ["direct", traceId]);
  assert.equal(outcome.failures[0].baselineValue, 0);
  assert.equal(outcome.failures[0].candidateValue, 1);
  assert.match(outcome.failures[0].explanation, /false advances rose from 0 to 1/);
  // Safety applies to every partition, and these rows are discovery rows.
  assert.ok(outcome.partitions.includes("discovery"));
  const candidate = report.candidates[0];
  assert.deepEqual(candidate.safety.sequenceIntroducedUnsafeTraceIds, [traceId]);
  // The reported total counts every row too. Sourcing it from the family-scoped
  // summary would export a corpus with no false advance in it while the gate
  // was rejecting the candidate for exactly one.
  assert.equal(candidate.safety.sequenceFalseAdvances, 1);
  assert.equal(candidate.safety.sequenceSkippedAdvances, 0);
  assert.equal(candidate.safety.sequenceDuplicateAdvances, 0);
  assert.equal(candidate.safety.sequenceIncompleteCarriedBassAdvances, 0);
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.safetyFailureCount, 1);
  assert.equal(report.recommendation.code, "no-safe-candidate");
});

test("an already unsafe run still gates when a candidate makes it worse", () => {
  const traceId = "dynamics-constant/direct/layer/salamander/v05";
  const dynamicsWith = (candidateCounts: Partial<ListenSequenceRunSummary>) =>
    gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, key }) => (
        key !== "layer/salamander/v05"
          ? cleanDynamicsCounts({ profileId })
          : profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22, falseAdvanceCount: 1 }
          : { independentMatchCount: 26, orderedAdvanceCount: 24, ...candidateCounts }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]);
  const worseBy = (candidateCounts: Partial<ListenSequenceRunSummary>) =>
    evaluateListenProfileValidationGates({
      ...cleanGateInput(),
      dynamics: dynamicsWith(candidateCounts),
    });
  const worse = worseBy({ falseAdvanceCount: 2 });
  const candidate = worse.candidates[0];
  // The row was unsafe under both profiles, so asking only whether it is unsafe
  // reports no change. It is the count that moved, and the gate must see it.
  assert.deepEqual(candidate.safety.dynamicsIntroducedUnsafeTraceIds, []);
  assert.deepEqual(candidate.safety.dynamicsWorsenedUnsafeTraceIds, [traceId]);
  const outcome = gateOutcome(worse, "safety-dynamics-introduced-advance");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, ["direct", traceId]);
  assert.equal(outcome.failures[0].baselineValue, 1);
  assert.equal(outcome.failures[0].candidateValue, 2);
  assert.match(outcome.failures[0].explanation, /false advances rose from 1 to 2/);
  assert.equal(candidate.eligible, false);
  // Adding a different classification at the same total is a regression too.
  const traded = worseBy({ falseAdvanceCount: 1, skippedAdvanceCount: 1 });
  assert.deepEqual(traded.candidates[0].safety.dynamicsWorsenedUnsafeTraceIds, [traceId]);
  assert.match(
    gateOutcome(traded, "safety-dynamics-introduced-advance").failures[0].explanation,
    /skipped advances rose from 0 to 1/,
  );
  // Reproducing the baseline's unsafe advance unchanged is not a regression, and
  // the summarizer's own verdict says so rather than leaving it to the gate.
  const unchangedDynamics = dynamicsWith({ falseAdvanceCount: 1 });
  assert.equal(
    gateOutcome(
      evaluateListenProfileValidationGates({
        ...cleanGateInput(),
        dynamics: unchangedDynamics,
      }),
      "safety-dynamics-introduced-advance",
    ).passed,
    true,
  );
  const direct = unchangedDynamics.renderers
    .find(({ rendererKey }) => rendererKey === "direct");
  const summary = direct?.profiles
    .find((profile) => profile.profileId === GATE_CANDIDATE_PROFILE_ID);
  assert.equal(summary?.safety.passed, true);
  assert.deepEqual(summary?.safety.worsenedUnsafeTraceIds, []);
  // The worsened run's own summary rejects it without being asked by the gate.
  const worsenedSummary = dynamicsWith({ falseAdvanceCount: 2 }).renderers
    .find(({ rendererKey }) => rendererKey === "direct")?.profiles
    .find((profile) => profile.profileId === GATE_CANDIDATE_PROFILE_ID);
  assert.equal(worsenedSummary?.safety.passed, false);
  assert.deepEqual(worsenedSummary?.safety.worsenedUnsafeTraceIds, [traceId]);
});

test("family breadth nets each family across renderers before counting it", () => {
  const netted = (
    direct: (input: { profileId: ListenMatcherProfileId; family: string }) =>
      Partial<ListenSequenceRunSummary>,
    tone: (input: { profileId: ListenMatcherProfileId; family: string }) =>
      Partial<ListenSequenceRunSummary>,
  ) => evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", direct),
      gateSequenceRenderer("tone", tone),
    ]),
  });
  const flat = { independentMatchCount: 20, orderedAdvanceCount: 18 };
  // `repeated-chord` gains 2 per speed under Direct and loses 2 per speed under
  // Tone. It has improved nowhere, so it cannot help satisfy the two-family
  // minimum, and only `course-clear` is left improving.
  const cancelled = netted(
    ({ profileId, family }) => (profileId === "baseline-v1"
      ? flat
      : family === "course-clear"
      ? { independentMatchCount: 22, orderedAdvanceCount: 20 }
      : { independentMatchCount: 22, orderedAdvanceCount: 20 }),
    ({ profileId, family }) => (profileId === "baseline-v1"
      ? flat
      : family === "course-clear"
      ? { independentMatchCount: 22, orderedAdvanceCount: 20 }
      : { independentMatchCount: 18, orderedAdvanceCount: 16 }),
  );
  const outcome = gateOutcome(cancelled, "consistency-sequence-family-breadth");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, ["course-clear"]);
  assert.equal(outcome.failures[0].candidateValue, 1);
  assert.match(outcome.failures[0].explanation, /netted across both renderers/);
  // The same shape with the loss removed nets two improved families and passes.
  assert.equal(
    gateOutcome(
      netted(
        ({ profileId }) => (profileId === "baseline-v1"
          ? flat
          : { independentMatchCount: 22, orderedAdvanceCount: 20 }),
        ({ profileId }) => (profileId === "baseline-v1"
          ? flat
          : { independentMatchCount: 22, orderedAdvanceCount: 20 }),
      ),
      "consistency-sequence-family-breadth",
    ).passed,
    true,
  );
});

test("a narrow independent-only gain is held to the breadth rule too", () => {
  const oneFamily = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId, family }) => (
        profileId !== "baseline-v1" && family === "course-clear"
          ? { independentMatchCount: 21, orderedAdvanceCount: 18 }
          : { independentMatchCount: 20, orderedAdvanceCount: 18 }
      )),
      gateSequenceRenderer("tone", () => ({
        independentMatchCount: 20,
        orderedAdvanceCount: 18,
      })),
    ]),
  });
  // Ordered progress is flat, so the old rule never ran at all. The claim is an
  // independent-recognition gain, and it is confined to one family.
  const outcome = gateOutcome(oneFamily, "consistency-sequence-family-breadth");
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.failures[0].domainIds, ["course-clear"]);
  assert.equal(outcome.failures.length, 1);
  // The cascade half of the gate stays silent: nothing claimed ordered progress.
  assert.ok(outcome.failures.every(({ explanation }) => !/cascade/.test(explanation)));
});

test("cascade amplification is disproved in the family that claimed the gain", () => {
  // Both families gain ordered advances. `repeated-chord` also recognizes more
  // events independently, but `course-clear` — where the ordered gain is — does
  // not, and an independent gain somewhere else proves nothing about it.
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", ({ profileId, family }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
          : family === "course-clear"
          ? { independentMatchCount: 20, orderedAdvanceCount: 20 }
          : { independentMatchCount: 22, orderedAdvanceCount: 18 }
      )),
      gateSequenceRenderer("tone", ({ profileId }) => (profileId === "baseline-v1"
        ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
        : { independentMatchCount: 20, orderedAdvanceCount: 18 })),
    ]),
  });
  const outcome = gateOutcome(report, "consistency-sequence-family-breadth");
  assert.equal(outcome.passed, false);
  const cascade = outcome.failures.find(({ explanation }) => /cascade/.test(explanation));
  assert.ok(cascade);
  assert.deepEqual(cascade.domainIds, ["course-clear"]);
  assert.match(cascade.explanation, /also\s+recognized more events independently/);
  // Moving the independent gain into the family that gained ordered advances is
  // what the gate is asking for, and it passes.
  assert.equal(
    gateOutcome(
      evaluateListenProfileValidationGates({
        ...cleanGateInput(),
        sequence: gateSequenceResult([
          gateSequenceRenderer("direct", ({ profileId, family }) => (
            profileId === "baseline-v1"
              ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
              : family === "course-clear"
              ? { independentMatchCount: 22, orderedAdvanceCount: 20 }
              : { independentMatchCount: 22, orderedAdvanceCount: 18 }
          )),
          gateSequenceRenderer("tone", ({ profileId }) => (profileId === "baseline-v1"
            ? { independentMatchCount: 20, orderedAdvanceCount: 18 }
            : { independentMatchCount: 20, orderedAdvanceCount: 18 })),
        ]),
      }),
      "consistency-sequence-family-breadth",
    ).passed,
    true,
  );
});

test("a lost complete passage rejects a candidate whose ordered advances held", () => {
  const slowest = LISTEN_SEQUENCE_INTERVALS_MS[0];
  const complete = 27;
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    sequence: gateSequenceResult([
      gateSequenceRenderer("direct", cleanSequenceCounts),
      // Tone keeps every ordered advance it had — it gains one elsewhere — but
      // the passage that used to complete no longer does.
      gateSequenceRenderer("tone", ({ profileId, family, intervalMs }) => {
        if (profileId === "baseline-v1") {
          return family === "course-clear" && intervalMs === slowest
            ? { independentMatchCount: complete, orderedAdvanceCount: complete }
            : { independentMatchCount: 20, orderedAdvanceCount: 18 };
        }
        return family === "course-clear" && intervalMs === slowest
          ? { independentMatchCount: complete, orderedAdvanceCount: complete - 1 }
          : { independentMatchCount: 22, orderedAdvanceCount: 20 };
      }),
    ]),
  });
  const outcome = gateOutcome(report, "consistency-sequence-ordered-progress");
  assert.equal(outcome.passed, false);
  const lost = outcome.failures
    .find(({ explanation }) => /fewer\s+passage/.test(explanation));
  assert.ok(lost, "the complete-passage branch reported nothing");
  assert.equal(lost.baselineValue, 1);
  assert.equal(lost.candidateValue, 0);
  assert.deepEqual(
    lost.domainIds,
    ["tone", `sequence/tone/course-clear/${slowest.toFixed(0)}`],
  );
  assert.equal(report.candidates[0].eligible, false);
});

test("continuous latency holds at one decoder hop and rejects beyond it", () => {
  const advanceAt = (latencyMs: number) => [outcomeEvent({
    orderedAdvanceLatencyMs: latencyMs,
    independentMatchLatencyMs: latencyMs,
  })];
  const at = (candidateMs: number, baselineMs = 180) => gateOutcome(
    evaluateListenProfileValidationGates({
      ...cleanGateInput(),
      sequence: gateSequenceResult([
        gateSequenceRenderer("direct", cleanSequenceCounts, {
          events: ({ profileId }) => advanceAt(
            profileId === "baseline-v1" ? baselineMs : candidateMs,
          ),
        }),
        gateSequenceRenderer("tone", cleanSequenceCounts),
      ]),
    }),
    "consistency-sequence-latency",
  );
  assert.equal(at(180 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS).passed, true);
  const regressed = at(180 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS + 1);
  assert.equal(regressed.passed, false);
  assert.equal(regressed.role, "discovery-consistency");
  assert.deepEqual(regressed.failures[0].domainIds, ["direct"]);
  assert.equal(regressed.failures[0].baselineValue, 180);
  assert.equal(regressed.failures[0].candidateValue, 213);
  assert.match(regressed.failures[0].explanation, /p95 ordered-advance latency/);
  // A candidate that is faster than the baseline is never rejected for it.
  assert.equal(at(120).passed, true);
});

test("a discovery renderer and piano regression is gated by the labeled rule", () => {
  const report = evaluateListenProfileValidationGates({
    ...cleanGateInput(),
    dynamics: gateDynamicsResult([
      gateDynamicsRenderer("direct", ({ profileId, partition }) => (
        profileId === "baseline-v1"
          ? { independentMatchCount: 24, orderedAdvanceCount: 22 }
          : partition === "discovery"
          ? { independentMatchCount: 23, orderedAdvanceCount: 22 }
          : { independentMatchCount: 26, orderedAdvanceCount: 24 }
      )),
      gateDynamicsRenderer("tone", cleanDynamicsCounts),
    ]),
  });
  const outcome = gateOutcome(report, "consistency-dynamics-piano-recognition");
  assert.equal(outcome.passed, false);
  assert.equal(outcome.role, "discovery-consistency");
  assert.deepEqual(outcome.partitions, ["discovery"]);
  assert.deepEqual(
    outcome.failures.map(({ domainIds }) => domainIds).sort(),
    [["direct", "piano/salamander/discovery"], ["direct", "piano/splendid/discovery"]],
  );
  assert.equal(outcome.failures[0].baselineValue, 24);
  assert.equal(outcome.failures[0].candidateValue, 23);
  // The held-back rule is untouched: a discovery loss is never quoted as one.
  assert.equal(gateOutcome(report, "release-dynamics-piano-recognition").passed, true);
  assert.equal(report.candidates[0].releaseFailureCount, 0);
  assert.equal(report.candidates[0].discoveryConsistencyFailureCount, 2);
});

test("the committed-regression gate rejects a worsened case and a lost recovery", () => {
  const outcome = (overrides: Record<string, unknown>) => ({
    fixtureId: "tone-salamander-v05-repeated-chord-late-advance",
    profileId: GATE_CANDIDATE_PROFILE_ID,
    targetIndex: 8,
    expectation: "late-advance",
    advanced: true,
    orderedAdvanced: false,
    advancedAtMs: 24_448,
    sourceAttackIndex: 2,
    falseAdvance: false,
    lateAdvance: true,
    deviations: [],
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    satisfied: true,
    newlyUnsafeTargets: [],
    worseThanBaseline: false,
    ...overrides,
  });
  const summary = (outcomes: unknown[]) => ({
    fixtureCount: outcomes.length,
    outcomes,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    deviationCount: 0,
    worseThanBaselineCount: 0,
    passed: true,
  } as unknown as Parameters<typeof listenCommittedRegressionFailures>[0]);
  // A replay that reproduces its pinned behavior contributes nothing.
  assert.deepEqual(
    listenCommittedRegressionFailures(
      summary([outcome({})]),
      GATE_CANDIDATE_PROFILE_ID,
      "baseline-v1",
    ),
    [],
  );
  // A diagnosed case that got worse is rejected, and the targets are named,
  // because a failure that merely moved is still a failure.
  const worsened = listenCommittedRegressionFailures(
    summary([outcome({
      worseThanBaseline: true,
      newlyUnsafeTargets: [{ targetIndex: 11, classifications: ["false-advance"] }],
    })]),
    GATE_CANDIDATE_PROFILE_ID,
    "baseline-v1",
  );
  assert.equal(worsened.length, 1);
  assert.deepEqual(worsened[0].domainIds, [
    "tone-salamander-v05-repeated-chord-late-advance",
    "tone-salamander-v05-repeated-chord-late-advance#11",
  ]);
  assert.equal(worsened[0].baselineValue, 0);
  assert.equal(worsened[0].candidateValue, 1);
  assert.match(worsened[0].explanation, /may\s+not worsen/);
  // A pinned late-advance recovery that turned into a false advance is rejected
  // even where the replay comparison did not flag it.
  const lostRecovery = listenCommittedRegressionFailures(
    summary([outcome({ falseAdvance: true, falseAdvanceCount: 1, lateAdvance: false })]),
    GATE_CANDIDATE_PROFILE_ID,
    "baseline-v1",
  );
  assert.equal(lostRecovery.length, 1);
  assert.match(lostRecovery[0].explanation, /pinned as a late-advance recovery/);
  assert.equal(lostRecovery[0].candidateValue, 1);
  // A fixture pinned as a genuine false advance reproduces it by design, so
  // reproducing it is not a rejection.
  assert.deepEqual(
    listenCommittedRegressionFailures(
      summary([outcome({
        fixtureId: "tone-course-clear-333-shared-pitch-false-advance",
        expectation: "reported-unsafe-advance",
        falseAdvance: true,
        falseAdvanceCount: 1,
        lateAdvance: false,
      })]),
      GATE_CANDIDATE_PROFILE_ID,
      "baseline-v1",
    ),
    [],
  );
});

/* ------------------------------------------------------------------------- *
 * Per-trace, per-profile discrete outcomes
 * ------------------------------------------------------------------------- */

function domainIdentityFor(
  report: ListenProfileValidationGateReport,
  domain: "isolated" | "sequence" | "dynamics",
) {
  const identity = report.domains.find((entry) => entry.domain === domain);
  assert.ok(identity, `no ${domain} identity`);
  return identity;
}

test("every captured trace reports one discrete outcome per profile column", () => {
  const report = evaluateListenProfileValidationGates(cleanGateInput());
  // The registry the values were read from is recorded with the measurement,
  // because the same identifiers name different thresholds in another version.
  assert.equal(report.registryVersion, LISTEN_MATCHER_REGISTRY_VERSION);
  for (const domain of report.domains) {
    assert.equal(domain.present, true);
    // One row per trace per column: an archive missing them can only be compared
    // aggregate by aggregate, never outcome by outcome.
    assert.equal(
      domain.outcomeIdentities.length,
      domain.capturedTraceCount * report.profiles.length,
    );
    const rowKeys = new Set(domain.outcomeIdentities
      .map(({ traceId, profileId }) => `${traceId} ${profileId}`));
    assert.equal(rowKeys.size, domain.outcomeIdentities.length);
    assert.deepEqual(
      [...new Set(domain.outcomeIdentities.map(({ traceId }) => traceId))].sort(),
      [...new Set(domain.traceIdentities.map(({ traceId }) => traceId))].sort(),
    );
    for (const row of domain.outcomeIdentities) {
      assert.match(row.outcomeDigest, /^[0-9a-f]{8}$/, `${row.traceId} ${row.profileId}`);
    }
    assert.match(domain.outcomeDigest, /^[0-9a-f]{8}$/);
  }
  // An unmeasured domain still reports its row, empty rather than absent.
  const isolatedOnly = evaluateListenProfileValidationGates({
    isolated: cleanGateInput().isolated,
  });
  assert.deepEqual(domainIdentityFor(isolatedOnly, "sequence").outcomeIdentities, []);
});

test("an outcome that moves without moving a count changes only its own row", () => {
  // The candidate advances the same target, scored identically, either from the
  // attack that played it or from the next one, one decoder hop later.
  const movedOutcome = (moved: boolean) => ({
    events: ({ profileId }: { profileId: ListenMatcherProfileId }) => [outcomeEvent({
      advancedAtMs: profileId === "baseline-v1" || !moved ? 1096 : 1128,
    })],
    attacks: ({ profileId }: { profileId: ListenMatcherProfileId }) => [
      outcomeAttack(),
      outcomeAttack({
        index: 1,
        scheduledAtMs: 1240,
        targetIndex: 1,
        advancementTargetIndices: profileId === "baseline-v1" || !moved ? [1] : [0, 1],
      }),
    ],
  });
  const input = (moved: boolean) => {
    const clean = cleanGateInput();
    return {
      isolated: clean.isolated,
      sequence: gateSequenceResult([
        gateSequenceRenderer("direct", cleanSequenceCounts, movedOutcome(moved)),
        gateSequenceRenderer("tone", cleanSequenceCounts),
      ]),
      dynamics: gateDynamicsResult([
        gateDynamicsRenderer("direct", cleanDynamicsCounts, movedOutcome(moved)),
        gateDynamicsRenderer("tone", cleanDynamicsCounts),
      ]),
    };
  };
  const stable = evaluateListenProfileValidationGates(input(false));
  const moved = evaluateListenProfileValidationGates(input(true));

  // Nothing an aggregate reports has changed: the same counts, the same deltas,
  // the same eligibility, and the same decoded traces under both runs.
  assert.deepEqual(moved.candidates, stable.candidates);
  assert.deepEqual(moved.eligibleProfileIds, stable.eligibleProfileIds);
  assert.deepEqual(moved.recommendation, stable.recommendation);
  for (const domain of ["isolated", "sequence", "dynamics"] as const) {
    assert.equal(
      domainIdentityFor(moved, domain).identityDigest,
      domainIdentityFor(stable, domain).identityDigest,
      domain,
    );
  }
  // The outcome did change, so the outcome evidence says so, in both domains
  // that measured it and for the candidate column alone.
  for (const domain of ["sequence", "dynamics"] as const) {
    assert.notEqual(
      domainIdentityFor(moved, domain).outcomeDigest,
      domainIdentityFor(stable, domain).outcomeDigest,
      domain,
    );
    const before = domainIdentityFor(stable, domain).outcomeIdentities;
    const after = domainIdentityFor(moved, domain).outcomeIdentities;
    const changed = after.filter((row, index) => row.outcomeDigest !== before[index].outcomeDigest);
    assert.ok(changed.length > 0, domain);
    assert.deepEqual(
      [...new Set(changed.map(({ profileId }) => profileId))],
      [GATE_CANDIDATE_PROFILE_ID],
    );
    assert.deepEqual([...new Set(changed.map(({ rendererKey }) => rendererKey))], ["direct"]);
  }
  // The isolated domain measured neither change, and reports none.
  assert.equal(
    domainIdentityFor(moved, "isolated").outcomeDigest,
    domainIdentityFor(stable, "isolated").outcomeDigest,
  );
});

test("outcome signatures separate every discrete field a replay can move", () => {
  const run = (
    events: ListenSequenceEventDiagnostic[],
    attacks: ListenSequenceAttackDiagnostic[] = [outcomeAttack()],
  ) => ({ events, attacks } as unknown as ListenSequenceRunResult);
  const signature = listenSequenceOutcomeSignature(run([outcomeEvent()]));
  const differs = (update: Partial<ListenSequenceEventDiagnostic>) => (
    listenSequenceOutcomeSignature(run([outcomeEvent(update)])) !== signature
  );
  // Each of these is a different musical outcome at identical counts elsewhere.
  assert.ok(differs({ advancedAtMs: 1128 }), "advance time");
  assert.ok(differs({ orderedAdvancedAtMs: 1128 }), "ordered advance time");
  assert.ok(differs({ independentMatchAtMs: 1128 }), "independent match time");
  assert.ok(differs({ firstRawEvidenceTimeMs: null }), "first raw evidence");
  assert.ok(differs({ firstThresholdQualifiedEvidenceTimeMs: null }), "first qualified evidence");
  assert.ok(differs({ firstQualifyingPitchEvidenceTimeMs: null }), "first qualifying pitch");
  assert.ok(differs({ lateAdvance: true }), "late advance");
  assert.ok(differs({ falseAdvance: true }), "false advance");
  assert.ok(differs({ skipped: true }), "skipped");
  assert.ok(differs({ duplicate: true }), "duplicate");
  assert.ok(differs({ missed: true }), "missed");
  assert.ok(differs({ timedOut: true }), "timed out");
  assert.ok(differs({ blockedByPriorStall: true }), "blocked by prior stall");
  assert.ok(differs({ nextAttackBeforeAdvance: true }), "next attack before advance");
  assert.ok(differs({ independentlyMatched: false }), "independent match");
  assert.ok(differs({ orderedAdvanced: false }), "ordered advance");
  assert.ok(differs({ advanced: false }), "advance");
  assert.ok(differs({ thresholdQualified: false }), "threshold qualified");
  assert.ok(differs({ allRequiredRawEvidencePresent: false }), "raw evidence present");
  assert.ok(differs({ activeTargetIndexAtAttack: 1 }), "armed target");
  assert.ok(differs({ unexpectedPitches: [61] }), "unexpected pitches");
  assert.ok(differs({ confidentUnexpectedPitches: [61] }), "confident unexpected pitches");
  assert.ok(differs({ primaryFailure: "carry-over" }), "primary failure");
  assert.ok(differs({ failureReasons: ["carry-over"] }), "failure reasons");
  assert.ok(differs({ rawFailureReasons: ["carry-over"] }), "raw failure reasons");
  assert.ok(differs({ independentFailureReasons: ["carry-over"] }), "independent failure reasons");
  assert.ok(differs({ orderedFailureReasons: ["carry-over"] }), "ordered failure reasons");
  assert.ok(differs({ index: 1 }), "target index");
  // A null never reads as a zero, and attribution is part of the outcome.
  assert.notEqual(
    listenSequenceOutcomeSignature(run([outcomeEvent({ advancedAtMs: null })])),
    listenSequenceOutcomeSignature(run([outcomeEvent({ advancedAtMs: 0 })])),
  );
  assert.notEqual(
    listenSequenceOutcomeSignature(
      run([outcomeEvent()], [outcomeAttack({ advancementTargetIndices: [0, 1] })]),
    ),
    signature,
  );
  assert.notEqual(
    listenSequenceOutcomeSignature(
      run([outcomeEvent()], [outcomeAttack({ activeTargetIndexAtAttack: null })]),
    ),
    signature,
  );
  // The isolated domain's outcome is its advancement and the moment it happened.
  const isolated = (advanced: boolean, onsetToAdvanceMs: number | null) => (
    listenIsolatedOutcomeSignature({
      profileId: "baseline-v1",
      profile: listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
      advanced,
      onsetToAdvanceMs,
    })
  );
  assert.notEqual(isolated(true, 196), isolated(true, 232));
  assert.notEqual(isolated(true, null), isolated(false, null));
  assert.equal(isolated(true, 196), isolated(true, 196));
  assert.notEqual(
    listenProfileOutcomeDigest(isolated(true, 196)),
    listenProfileOutcomeDigest(isolated(true, 232)),
  );
});

test("per-pitch outcomes are read, and per-pitch confidences are not", () => {
  const run = (events: ListenSequenceEventDiagnostic[]) => (
    { events, attacks: [outcomeAttack()] } as unknown as ListenSequenceRunResult
  );
  const withPitch = (update: Partial<ExpectedPitchDiagnostic>) => listenSequenceOutcomeSignature(
    run([outcomeEvent({ expectedPitches: [outcomePitch(update)] })]),
  );
  const base = withPitch({});
  const differs = (update: Partial<ExpectedPitchDiagnostic>) => withPitch(update) !== base;
  // A target can reach the same verdict from a different set of pitches, and
  // every one of these moves without moving an event-level field or a count.
  assert.ok(differs({ midi: 64 }), "pitch");
  assert.ok(differs({ attackRequired: false }), "attack required");
  assert.ok(differs({ requiredAttackType: "reOnset" }), "required attack type");
  assert.ok(differs({ requiredAttackType: null }), "no required attack type");
  assert.ok(differs({ observedAttackType: "reOnset" }), "observed attack type");
  assert.ok(differs({ observedAttackType: null }), "no observed attack type");
  assert.ok(differs({ rawAttackDetected: false }), "raw attack detected");
  assert.ok(differs({ rawOnsetProduced: false }), "raw onset produced");
  assert.ok(differs({ rawOnsetTimeMs: 1040 }), "raw onset time");
  assert.ok(differs({ rawOnsetTimeMs: null }), "no raw onset time");
  assert.ok(differs({ qualifyingOnset: false }), "qualifying onset");
  assert.ok(differs({ firstRawEvidenceTimeMs: 1040 }), "first raw evidence time");
  assert.ok(differs({ firstThresholdQualifiedEvidenceTimeMs: 1040 }), "first qualified time");
  assert.ok(differs({ requiredRawEvidencePresent: false }), "required raw evidence present");
  assert.ok(differs({ thresholdQualified: false }), "threshold qualified");
  // A pitch that dropped out of the target is a different outcome as well.
  assert.notEqual(
    listenSequenceOutcomeSignature(run([outcomeEvent({ expectedPitches: [] })])),
    base,
  );
  assert.notEqual(
    listenSequenceOutcomeSignature(run([outcomeEvent({
      expectedPitches: [outcomePitch({}), outcomePitch({ midi: 64 })],
    })])),
    base,
  );
  // Confidences stay out: neither Chrome's offline rendering nor ONNX Runtime
  // reproduces them bit for bit, so reading them would make two honest
  // repetitions disagree over numbers no decision is taken on.
  assert.ok(!differs({ onsetConfidence: 0.71 }), "onset confidence");
  assert.ok(!differs({ noteConfidence: 0.71 }), "note confidence");
  assert.ok(!differs({ maximumOnsetConfidence: 0.71 }), "maximum onset confidence");
  assert.ok(!differs({ maximumActiveConfidence: 0.71 }), "maximum active confidence");
});

/**
 * The evidence verifier restates the frozen matrix in plain JavaScript, because
 * it has to judge an archive without importing the build that produced it. That
 * copy is only trustworthy while it agrees with the definitions the benchmark
 * actually applies, so this test is what keeps the two in step: a threshold, a
 * gate, a corpus size, or a manifest hash that moves here fails until the
 * verifier's contract is updated to match, deliberately.
 */
test("the evidence verifier's frozen contract matches the code it describes", () => {
  assert.equal(CONFIRMATION_EVIDENCE.registryVersion, LISTEN_MATCHER_REGISTRY_VERSION);
  assert.equal(
    CONFIRMATION_EVIDENCE.baselineProfileId,
    LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
  );
  assert.deepEqual(
    CONFIRMATION_EVIDENCE.candidateProfileIds,
    [...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS],
  );
  assert.equal(CONFIRMATION_EVIDENCE.manifestVersion, LISTEN_TRACE_MANIFEST.version);
  assert.equal(CONFIRMATION_EVIDENCE.manifestHash, LISTEN_TRACE_MANIFEST_HASH);
  assert.equal(CONFIRMATION_EVIDENCE.manifestCorpusHash, LISTEN_TRACE_CORPUS_HASH);

  // The thresholds, not only the identifiers: the verifier exists to catch an
  // archive whose profile values are not the ones this task froze.
  const column = [
    LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
    ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  ];
  assert.deepEqual(Object.keys(CONFIRMATION_EVIDENCE.profiles), column);
  for (const profileId of column) {
    assert.deepEqual(
      CONFIRMATION_EVIDENCE.profiles[profileId],
      listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
      profileId,
    );
  }

  // The eighteen gates, with their stated requirements, are the standard both
  // archived repetitions were judged against.
  assert.deepEqual(
    CONFIRMATION_EVIDENCE.gates.map(({ partitions: _partitions, ...gate }) => gate),
    LISTEN_PROFILE_GATES.map((gate) => ({
      code: gate.code,
      role: gate.role,
      domain: gate.domain,
      label: gate.label,
      requirement: gate.requirement,
    })),
  );

  // The corpus sizes come from the frozen manifest rather than from a memory of
  // it, so a manifest that grew a trace fails here before it reaches a run.
  const dynamicsSuites = ["dynamics-constant", "dynamics-mixed", "articulation"] as const;
  const capturedTraceCounts = {
    isolated: listenTracesInSuite("isolated").length,
    sequence: listenTracesInSuite("sequence").length,
    dynamics: dynamicsSuites
      .reduce((total, suite) => total + listenTracesInSuite(suite).length, 0),
  };
  assert.deepEqual(
    CONFIRMATION_EVIDENCE.domains.map(({ domain, capturedTraceCount }) => (
      [domain, capturedTraceCount]
    )),
    [
      ["isolated", capturedTraceCounts.isolated],
      ["sequence", capturedTraceCounts.sequence],
      ["dynamics", capturedTraceCounts.dynamics],
    ],
  );
  assert.deepEqual(
    CONFIRMATION_EVIDENCE.domains.map(({ suites }) => suites),
    [["isolated"], ["sequence"], [...dynamicsSuites]],
  );
  // The partitions each domain spans, and the evidence role that makes, are
  // derived from the manifest here so the verifier can refuse a trace attributed
  // to a partition or renderer the frozen matrix does not contain.
  for (const expected of CONFIRMATION_EVIDENCE.domains) {
    const partitions = [...new Set(expected.suites
      .flatMap((suite) => listenTracesInSuite(suite as ListenTraceSuite))
      .map(({ partition }) => partition))].sort();
    assert.deepEqual(expected.partitions, partitions, expected.domain);
    // A gating row carries no scored role at all, which the report writes as null.
    const evidenceRole = partitions.includes("regression-only")
      ? null
      : listenValidationEvidenceRole(partitions);
    assert.equal(expected.evidenceRole, evidenceRole, expected.domain);
  }
  assert.deepEqual(CONFIRMATION_EVIDENCE.rendererKeys, ["direct", "tone"]);

  // The verifier also restates which rows a gate of each role and domain may
  // have read, so it can refuse an outcome that quotes discovery rows as a
  // release result. That rule is checked against gates the benchmark actually
  // evaluated rather than against a description of them.
  const report = evaluateListenProfileValidationGates(cleanGateInput());
  for (const candidate of report.candidates) {
    for (const gate of candidate.gates) {
      const allowed = GATE_SCOPE_BY_ROLE[gate.role]
        .filter((partition) => GATE_SCOPE_BY_DOMAIN[gate.domain].includes(partition));
      for (const partition of gate.partitions) {
        assert.ok(allowed.includes(partition), `${gate.code} read ${partition} rows`);
      }
      assert.equal(gate.applied, gate.partitions.length > 0, gate.code);
      assert.equal(gate.passed, gate.applied && gate.failures.length === 0, gate.code);
    }
  }
  assert.deepEqual(
    Object.keys(GATE_SCOPE_BY_ROLE).sort(),
    [...new Set(LISTEN_PROFILE_GATES.map(({ role }) => role))].sort(),
  );
  assert.deepEqual(
    Object.keys(GATE_SCOPE_BY_DOMAIN).sort(),
    [...new Set(LISTEN_PROFILE_GATES.map(({ domain }) => domain))].sort(),
  );
  // The unified command's rows are named `<suite>/<renderer>/…`, which is what
  // lets the verifier check that a domain captured the corpus it claims to have.
  for (const suite of ["isolated", "sequence", ...dynamicsSuites] as const) {
    for (const descriptor of listenTracesInSuite(suite)) {
      assert.ok(
        descriptor.id.startsWith(`${suite}/${descriptor.rendererKey}/`),
        `${descriptor.id} does not name its suite and renderer`,
      );
    }
  }
});

/**
 * The gate report a complete, clean matrix produces, without rendering a note.
 *
 * Which rows each gate reads is decided by the corpus and the gate code, not by
 * what the audio turned out to sound like, so the frozen coverage can be
 * established here: every case of the real manifest is fabricated as a clean
 * outcome, and the real aggregation and gate functions do the rest. That makes
 * the verifier's required-coverage pins checkable in the unit suite instead of
 * resting on a reading of the gate implementation.
 */
function completeCorpusGateReport(): ListenProfileValidationGateReport {
  const rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"];
  const column = GATE_COLUMN;
  const rendererFor = (rendererKey: ListenTraceRendererKey) => rendererKey === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
  const cleanCounts = fabricatedSummary({ independentMatchCount: 20, orderedAdvanceCount: 18 });

  const isolatedCases = listenIsolatedValidationCases(LISTEN_TRACE_MANIFEST, rendererKeys);
  const isolatedRenderers = rendererKeys.map((rendererKey) => {
    const cases: ListenIsolatedValidationCaseResult[] = isolatedCases
      .filter(({ descriptor }) => descriptor.rendererKey === rendererKey)
      .map((validationCase) => ({
        traceId: validationCase.descriptor.id,
        partition: validationCase.descriptor.partition,
        caseIndex: validationCase.caseIndex,
        caseKind: validationCase.descriptor.caseKind ?? "correct",
        fixtureGroup: validationCase.fixtureGroup,
        measure: validationCase.measure,
        moment: validationCase.moment,
        targetPitches: validationCase.targetPitches,
        playedPitches: validationCase.playedPitches,
        expectedCorrect: validationCase.expectedCorrect,
        mathematicallyAmbiguous: validationCase.mathematicallyAmbiguous,
        rendererKey,
        renderer: validationCase.renderer.version,
        recognitionStructureHash: validationCase.descriptor.id,
        frameCount: 4,
        pcmLength: 512,
        maximumInferenceMs: 4,
        // Clean: every correct fixture advances and nothing else does.
        profiles: column.map(({ profileId, profile }) => ({
          profileId,
          profile,
          advanced: validationCase.expectedCorrect,
          onsetToAdvanceMs: validationCase.expectedCorrect ? 196 : null,
        })),
      }));
    return summarizeListenIsolatedProfileValidation(
      rendererKey,
      rendererFor(rendererKey),
      cases,
      column,
    );
  });

  const sequenceCases = listenSequenceValidationCases(LISTEN_TRACE_MANIFEST, rendererKeys);
  const sequenceRenderers = sequenceCases.length === 0 ? [] : rendererKeys.map((rendererKey) => {
    const cases: ListenSequenceValidationCaseResult[] = sequenceCases
      .filter(({ descriptor }) => descriptor.rendererKey === rendererKey)
      .map((validationCase) => ({
        traceId: validationCase.descriptor.id,
        partition: validationCase.descriptor.partition,
        scoreEligible: validationCase.scoreEligible,
        sequenceId: validationCase.definition.id,
        sequenceLabel: validationCase.definition.label,
        family: validationCase.family,
        intervalMs: validationCase.intervalMs,
        eventRate: 1000 / validationCase.intervalMs,
        rendererKey,
        renderer: validationCase.renderer.version,
        recognitionStructureHash: validationCase.descriptor.id,
        frameCount: 54,
        pcmLength: 512,
        maximumInferenceMs: 4,
        maximumProcessingBacklogMs: 0,
        profiles: column.map(({ profileId, profile }) => ({
          profileId,
          profile,
          run: {
            sequenceId: validationCase.definition.id,
            family: validationCase.family,
            intervalMs: validationCase.intervalMs,
            events: [],
            attacks: [],
            summary: cleanCounts,
          } as unknown as ListenSequenceRunResult,
        })),
      }));
    return summarizeListenSequenceProfileValidation(
      rendererKey,
      rendererFor(rendererKey),
      cases,
      column,
    );
  });

  const dynamicsCases = listenDynamicsValidationCases(
    LISTEN_TRACE_MANIFEST,
    rendererKeys,
    LISTEN_DYNAMICS_VALIDATION_SUITES,
  );
  const dynamicsRenderers = rendererKeys.map((rendererKey) => {
    const cases: ListenDynamicsValidationCaseResult[] = dynamicsCases
      .filter(({ descriptor }) => descriptor.rendererKey === rendererKey)
      .map((validationCase) => ({
        traceId: validationCase.descriptor.id,
        partition: validationCase.descriptor.partition,
        scoreEligible: validationCase.scoreEligible,
        suite: validationCase.suite,
        sequenceId: validationCase.definition.id,
        sequenceLabel: validationCase.definition.label,
        piano: validationCase.piano,
        pianoName: validationCase.pianoName,
        layer: validationCase.layer,
        dynamicBand: validationCase.dynamicBand,
        dynamicProfile: validationCase.dynamicProfile,
        articulation: validationCase.articulation,
        intervalMs: validationCase.intervalMs,
        rendererKey,
        renderer: validationCase.renderer.version,
        recognitionStructureHash: validationCase.descriptor.id,
        frameCount: 54,
        pcmLength: 512,
        peak: 0.4,
        rms: 0.1,
        maximumInferenceMs: 4,
        maximumProcessingBacklogMs: 0,
        profiles: column.map(({ profileId, profile }) => ({
          profileId,
          profile,
          run: {
            sequenceId: validationCase.definition.id,
            family: validationCase.definition.family,
            intervalMs: validationCase.intervalMs,
            events: [],
            attacks: [],
            summary: cleanCounts,
          } as unknown as ListenSequenceRunResult,
        })),
      }));
    return summarizeListenDynamicsProfileValidation(
      rendererKey,
      rendererFor(rendererKey),
      cases,
      column,
    );
  });

  return evaluateListenProfileValidationGates({
    isolated: gateIsolatedResult(isolatedRenderers),
    sequence: gateSequenceResult(sequenceRenderers),
    dynamics: gateDynamicsResult(dynamicsRenderers),
  });
}

test("the verifier's required gate coverage is the coverage a complete matrix has", () => {
  const report = completeCorpusGateReport();
  // The fabricated matrix is the complete frozen corpus, so the release floors
  // apply and every gate is reached.
  assert.equal(report.evidenceComplete, true, report.incompleteEvidenceReasons.join(" "));
  const candidate = report.candidates[0];
  assert.deepEqual(candidate.failedGateCodes, []);
  for (const gate of candidate.gates) {
    assert.equal(gate.applied, true, `${gate.code} was not applied`);
  }
  // Coverage is pinned per gate, not merely bounded: a complete archive that
  // gated safety on the confirmation rows alone must be refused, and a subset
  // rule would accept it.
  assert.deepEqual(
    candidate.gates.map(({ code, partitions }) => [code, partitions]),
    CONFIRMATION_EVIDENCE.gates.map(({ code, partitions }) => [code, partitions]),
  );
  for (const gate of candidate.gates) {
    const allowed = GATE_SCOPE_BY_ROLE[gate.role]
      .filter((partition) => GATE_SCOPE_BY_DOMAIN[gate.domain].includes(partition));
    for (const partition of gate.partitions) {
      assert.ok(allowed.includes(partition), `${gate.code} read ${partition} rows`);
    }
  }
  // The three domains carry the partitions the verifier pins for them too.
  assert.deepEqual(
    report.domains.map(({ domain, partitions, evidenceRole }) => (
      [domain, partitions, evidenceRole]
    )),
    CONFIRMATION_EVIDENCE.domains.map(({ domain, partitions, evidenceRole }) => (
      [domain, partitions, evidenceRole]
    )),
  );
});
