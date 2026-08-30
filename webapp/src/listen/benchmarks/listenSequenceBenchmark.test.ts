import assert from "node:assert/strict";
import test from "node:test";
import type { DecodedOnlineAmtOutput } from "../../onlineAmtOutput";
import type { OnlineAmtStepResult } from "../../onlineAmtSession";
import {
  LISTEN_BENCHMARK_RELEASE_MS,
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_PIANO,
  benchmarkChordGain,
} from "./listenBenchmarkAudio";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  LISTEN_SEQUENCE_INTERVALS_MS,
  assignRecognitionEventsToAttacks,
  benchmarkAudioAttacksForSequence,
  bundledListenSequences,
  captureCourseClearArticulationMatrix,
  captureListenSequenceTrace,
  classifyListenSequenceFailure,
  compareListenSequencePolicies,
  courseClearArticulationDefinitions,
  diagnoseListenArticulationRun,
  evaluateTraceRecognitionLayers,
  productionListenMatcherProfile,
  interpretListenArticulationMatrix,
  materializeListenSequence,
  replayListenSequenceTrace,
  summarizeListenSequenceBenchmark,
  summarizeListenSequenceSafety,
  type ExpectedPitchDiagnostic,
  type ListenArticulationRunSummary,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceDefinition,
  type ListenSequenceBenchmarkResult,
  type ListenSequenceAggregateSummary,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
  type SequenceOutputDecoder,
} from "./listenSequenceBenchmark";

function regularDefinition(
  targets: readonly (readonly number[])[],
  id = "test-sequence",
): ListenSequenceDefinition {
  return {
    id,
    family: "test",
    label: "Test sequence",
    targets,
    attacks: targets.map((pitches, index) => ({
      at: index,
      targetIndex: index,
      notes: pitches,
      expectedAdvance: true,
    })),
  };
}

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

function successfulSingleTargetRun(intervalMs: number) {
  const sequence = materializeListenSequence(regularDefinition([[60]], `single-${intervalMs}`), intervalMs);
  const onsetAt = Math.ceil(sequence.targets[0].scheduledAttackTimeMs / 32) * 32;
  return replayListenSequenceTrace(sequence, trace(sequence, [
    recognitionFrame(sequence.relevantPitches, onsetAt, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, onsetAt + 32, [], [60]),
  ]));
}

function pitchDiagnostic(update: Partial<ExpectedPitchDiagnostic> = {}): ExpectedPitchDiagnostic {
  return {
    midi: 60,
    attackRequired: true,
    requiredAttackType: "onset",
    observedAttackType: null,
    rawAttackDetected: false,
    rawOnsetProduced: false,
    rawOnsetTimeMs: null,
    maximumOnsetConfidence: 0,
    onsetConfidence: 0,
    noteConfidence: 0,
    qualifyingOnset: false,
    maximumActiveConfidence: 0,
    firstRawEvidenceTimeMs: null,
    firstThresholdQualifiedEvidenceTimeMs: null,
    requiredRawEvidencePresent: false,
    thresholdQualified: false,
    ...update,
  };
}

test("threshold-qualified diagnostics use the supplied profile boundary", () => {
  const sequence = materializeListenSequence(regularDefinition([[60]]), 1_000);
  const capturedAt = Math.ceil(sequence.targets[0].scheduledAttackTimeMs / 32) * 32;
  const shared = trace(sequence, [recognitionFrame(
    sequence.relevantPitches,
    capturedAt,
    [{ midi: 60, confidence: 0.6, noteConfidence: 0.5 }],
  )]);
  const low = evaluateTraceRecognitionLayers(sequence, shared, {
    ...productionListenMatcherProfile,
    onsetThreshold: 0.6,
    targetNoteThreshold: 0.5,
  })[0];
  const high = evaluateTraceRecognitionLayers(sequence, shared, {
    ...productionListenMatcherProfile,
    onsetThreshold: 0.600_001,
  })[0];
  assert.equal(low.thresholdQualified, true);
  assert.equal(high.thresholdQualified, false);
});

test("active-target and extra-note thresholds include their exact boundary", () => {
  const chord = materializeListenSequence(regularDefinition([[60, 64]], "active-boundary"), 1_000);
  const at = Math.ceil(chord.targets[0].scheduledAttackTimeMs / 32) * 32;
  const activeFrame = recognitionFrame(chord.relevantPitches, at, [{ midi: 60 }], [60, 64]);
  activeFrame.confidenceEvidence = activeFrame.confidenceEvidence.map((evidence) => ({
    ...evidence,
    confidence: evidence.midi === 64 ? 0.35 : evidence.confidence,
  }));
  const activeTrace = trace(chord, [
    activeFrame,
    { ...activeFrame, capturedAtMs: at + 32, onsets: [], noteEvents: [] },
  ]);
  assert.equal(replayListenSequenceTrace(chord, activeTrace, {
    ...productionListenMatcherProfile,
    activeTargetThreshold: 0.35,
  }).events[0].independentlyMatched, true);
  assert.equal(replayListenSequenceTrace(chord, activeTrace, {
    ...productionListenMatcherProfile,
    activeTargetThreshold: 0.350_001,
  }).events[0].independentlyMatched, false);

  const single = materializeListenSequence(regularDefinition([[60]], "extra-boundary"), 1_000);
  const extraAt = Math.ceil(single.targets[0].scheduledAttackTimeMs / 32) * 32;
  const extraTrace = trace(single, [
    recognitionFrame(single.relevantPitches, extraAt, [
      { midi: 60, confidence: 0.9, noteConfidence: 0.9 },
      { midi: 61, confidence: 0.9, noteConfidence: 0.97 },
    ]),
    recognitionFrame(single.relevantPitches, extraAt + 32, [], [60]),
  ]);
  assert.equal(replayListenSequenceTrace(single, extraTrace, {
    ...productionListenMatcherProfile,
    extraNoteThreshold: 0.97,
  }).events[0].independentlyMatched, false);
  assert.equal(replayListenSequenceTrace(single, extraTrace, {
    ...productionListenMatcherProfile,
    extraNoteThreshold: 0.970_001,
  }).events[0].independentlyMatched, true);
});

test("carried-bass safety does not attribute recovery to the incomplete attack", () => {
  const definition = bundledListenSequences().find(({ id }) => id === "carried-bass-safety")!;
  const sequence = materializeListenSequence(definition, 1_000);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 48 }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [48]),
    recognitionFrame(sequence.relevantPitches, 1_248, [{ midi: 60 }, { midi: 64 }], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 1_280, [], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 1_800, [], []),
    recognitionFrame(sequence.relevantPitches, 2_240, [{ midi: 48 }, { midi: 60 }, { midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 2_272, [], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 3_264, [{ midi: 48 }, { midi: 60 }, { midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 3_296, [], [48, 60, 64]),
  ];
  const run = replayListenSequenceTrace(sequence, trace(sequence, frames));
  assert.deepEqual(run.attacks[1].advancementTargetIndices, []);
  assert.equal(run.summary.falseAdvanceCount, 0);
});

test("disabling fresh bass is rejected when the carried bass completes the chord", () => {
  const definition = bundledListenSequences().find(({ id }) => id === "carried-bass-safety")!;
  const sequence = materializeListenSequence(definition, 1_000);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 48 }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [48]),
    recognitionFrame(sequence.relevantPitches, 1_248, [{ midi: 60 }, { midi: 64 }], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 1_280, [], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 1_800, [], []),
    recognitionFrame(sequence.relevantPitches, 2_240, [{ midi: 48 }, { midi: 60 }, { midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 2_272, [], [48, 60, 64]),
    recognitionFrame(sequence.relevantPitches, 3_264, [{ midi: 48 }, { midi: 60 }, { midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 3_296, [], [48, 60, 64]),
  ];
  const sharedTrace = trace(sequence, frames);
  const required = replayListenSequenceTrace(sequence, sharedTrace, {
    ...productionListenMatcherProfile,
    requireFreshBassOnset: true,
  });
  const relaxed = replayListenSequenceTrace(sequence, sharedTrace, {
    ...productionListenMatcherProfile,
    requireFreshBassOnset: false,
  });
  assert.deepEqual(required.attacks[1].advancementTargetIndices, []);
  assert.deepEqual(relaxed.attacks[1].advancementTargetIndices, [1]);
  assert.equal(summarizeListenSequenceSafety([required]).passed, true);
  assert.equal(summarizeListenSequenceSafety([relaxed]).passed, false);
});

test("safety aggregation covers every configured speed", () => {
  const definition = bundledListenSequences().find(({ id }) => id === "carried-bass-safety")!;
  const runs = LISTEN_SEQUENCE_INTERVALS_MS.map((intervalMs) => {
    const sequence = materializeListenSequence(definition, intervalMs);
    return {
      ...replayListenSequenceTrace(sequence, trace(sequence, [])),
      summary: {
        ...replayListenSequenceTrace(sequence, trace(sequence, [])).summary,
        falseAdvanceCount: 0,
        skippedAdvanceCount: 0,
        duplicateAdvanceCount: 0,
      },
    };
  });
  const safety = summarizeListenSequenceSafety(runs);
  assert.equal(safety.sequenceCount, LISTEN_SEQUENCE_INTERVALS_MS.length);
  assert.deepEqual(
    safety.speeds.map(({ intervalMs }) => intervalMs),
    [...LISTEN_SEQUENCE_INTERVALS_MS],
  );
  assert.equal(safety.passed, true);
});

test("materializes fixed articulation into a chunk-aligned continuous schedule", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [62], [64]]), 100);
  assert.equal(sequence.frameCount % 512, 0);
  for (const attack of sequence.attacks) {
    assert.equal(attack.notes[0].releaseTimeMs - attack.notes[0].attackTimeMs, 420);
  }
});

test("materializes exact Course Clear articulation timing profiles", () => {
  const sequences = new Map(courseClearArticulationDefinitions().map((definition) => [
    definition.articulation,
    materializeListenSequence(definition, COURSE_CLEAR_ARTICULATION_INTERVAL_MS),
  ]));
  const detached = sequences.get("detached")!;
  const normal = sequences.get("normal")!;
  const legato = sequences.get("legato")!;

  for (const [sequence, holdMs, gapMs, overlapMs] of [
    [detached, 250, 400, 0],
    [normal, 420, 230, 0],
    [legato, 900, 0, 250],
  ] as const) {
    const first = sequence.attacks[0].notes[0];
    const nextAttackAt = sequence.attacks[1].scheduledAtMs;
    const envelopeEnd = first.releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS;
    assert.equal(first.releaseTimeMs - first.attackTimeMs, holdMs);
    assert.equal(Math.max(0, nextAttackAt - envelopeEnd), gapMs);
    assert.equal(Math.max(0, envelopeEnd - nextAttackAt), overlapMs);
  }
  const attackTimes = normal.attacks.map(({ scheduledAtMs }) => scheduledAtMs);
  for (const sequence of sequences.values()) {
    assert.deepEqual(sequence.attacks.map(({ scheduledAtMs }) => scheduledAtMs), attackTimes);
    assert.deepEqual(sequence.targets.map(({ pitches }) => pitches), normal.targets.map(({ pitches }) => pitches));
  }
});

test("normal Course Clear scheduling is identical to the existing canonical passage", () => {
  const existing = bundledListenSequences().find(({ id }) => id === "course-clear-27")!;
  const normal = courseClearArticulationDefinitions().find(({ articulation }) => (
    articulation === "normal"
  ))!;
  const existingSequence = materializeListenSequence(existing, 1_000);
  const normalSequence = materializeListenSequence(normal, 1_000);

  assert.deepEqual(
    benchmarkAudioAttacksForSequence(normalSequence),
    benchmarkAudioAttacksForSequence(existingSequence),
  );
  assert.equal(normalSequence.durationMs, existingSequence.durationMs);
});

test("sustained-shared keeps partial common tones in one source and reattacks repeated chords", () => {
  const definition = courseClearArticulationDefinitions().find(({ articulation }) => (
    articulation === "sustained-shared"
  ))!;
  const sequence = materializeListenSequence(definition, 1_000);
  const sharedSourceAttack = sequence.attacks[22];
  const partialAttack = sequence.attacks[23];
  const repeatedAttack = sequence.attacks[24];

  assert.deepEqual(partialAttack.playedPitches, [62]);
  assert.equal(
    sharedSourceAttack.notes.find(({ midi }) => midi === 74)!.releaseTimeMs -
      sharedSourceAttack.scheduledAtMs,
    1_420,
  );
  assert.equal(
    sharedSourceAttack.notes.find(({ midi }) => midi === 82)!.releaseTimeMs -
      sharedSourceAttack.scheduledAtMs,
    1_420,
  );
  assert.deepEqual(repeatedAttack.playedPitches, [62, 74, 82]);
  assert.ok(repeatedAttack.notes.every((playedNote) => (
    playedNote.releaseTimeMs - playedNote.attackTimeMs === 420
  )));
});

test("sustained partial attacks retain normal whole-chord note gain", () => {
  const definitions = courseClearArticulationDefinitions();
  const normal = materializeListenSequence(
    definitions.find(({ articulation }) => articulation === "normal")!,
    1_000,
  );
  const sustained = materializeListenSequence(
    definitions.find(({ articulation }) => articulation === "sustained-shared")!,
    1_000,
  );
  const normalAttack = benchmarkAudioAttacksForSequence(normal)[23];
  const sustainedAttack = benchmarkAudioAttacksForSequence(sustained)[23];

  assert.equal(normalAttack.notes.length, 3);
  assert.equal(sustainedAttack.notes.length, 1);
  assert.equal(sustainedAttack.gainReferenceChordSize, 3);
  assert.equal(
    benchmarkChordGain(normalAttack.notes.length),
    benchmarkChordGain(sustainedAttack.gainReferenceChordSize!),
  );
});

test("fresh-attack diagnostics accept an onset after a detached repeated pitch", () => {
  const definition: ListenSequenceDefinition = {
    id: "detached-repeat",
    family: "test",
    label: "Detached repeat",
    articulation: "detached",
    targets: [[60], [60]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [{ midi: 60, holdMs: 250 }], expectedAdvance: true },
      { at: 1, targetIndex: 1, notes: [{ midi: 60, holdMs: 250 }], expectedAdvance: true },
    ],
  };
  const sequence = materializeListenSequence(definition, 1_000);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60, type: "onset" }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [60]),
    recognitionFrame(sequence.relevantPitches, 1_216, [], []),
    recognitionFrame(sequence.relevantPitches, 1_248, [{ midi: 60, type: "onset" }]),
  ]);
  const run = replayListenSequenceTrace(sequence, sharedTrace);
  const diagnosed = diagnoseListenArticulationRun("detached", sequence, run);

  assert.equal(run.events[1].expectedPitches[0].requiredAttackType, "onset");
  assert.equal(run.events[1].expectedPitches[0].observedAttackType, "onset");
  assert.equal(run.events[1].expectedPitches[0].rawAttackDetected, true);
  assert.equal(diagnosed.events[1].producedFreshAttackCount, 1);
  assert.equal(diagnosed.events[1].producedOnsetCount, 1);
  assert.equal(diagnosed.events[1].producedReOnsetCount, 0);
});

test("records an attack transition mismatch without discarding the physical attack", () => {
  const definition: ListenSequenceDefinition = {
    id: "overlapping-repeat",
    family: "test",
    label: "Overlapping repeat",
    articulation: "legato",
    targets: [[60], [60]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [{ midi: 60, holdMs: 900 }], expectedAdvance: true },
      { at: 1, targetIndex: 1, notes: [{ midi: 60, holdMs: 900 }], expectedAdvance: true },
    ],
  };
  const sequence = materializeListenSequence(definition, 1_000);
  const run = replayListenSequenceTrace(sequence, trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60, type: "onset" }]),
    recognitionFrame(sequence.relevantPitches, 1_248, [{ midi: 60, type: "onset" }]),
  ]));

  assert.equal(run.events[1].expectedPitches[0].requiredAttackType, "reOnset");
  assert.equal(run.events[1].expectedPitches[0].observedAttackType, "onset");
  assert.equal(run.events[1].expectedPitches[0].rawAttackDetected, true);
  assert.equal(run.events[1].expectedPitches[0].requiredRawEvidencePresent, true);
});

test("captures exactly one session and decoder reset per articulation", async () => {
  class FakeSession implements SequenceInferenceSession {
    resetCount = 0;
    reset() { this.resetCount += 1; }
    async run(): Promise<OnlineAmtStepResult> {
      return {
        scores: new Float32Array(88 * 5),
        states: new Uint8Array(88),
        signalActive: false,
        inferenceTimeMs: 1,
      };
    }
  }
  let decoderResetCount = 0;
  const session = new FakeSession();
  const result = await captureCourseClearArticulationMatrix({
    session,
    decoderFactory: () => ({
      reset() { decoderResetCount += 1; },
      decode() {
        return {
          onsets: [],
          recognizedActivePitches: [],
          targetPitchEvidence: [],
          noteStates: [],
          noteEvents: [],
        };
      },
    }),
    async render() {
      return {
        pcm: new Float32Array(512),
        renderer: { ...LISTEN_BENCHMARK_RENDERER },
        piano: { ...LISTEN_BENCHMARK_PIANO, layers: [...LISTEN_BENCHMARK_PIANO.layers] },
        diagnostics: { frameCount: 512, durationMs: 32, peak: 0, rms: 0 },
      };
    },
  });

  assert.equal(session.resetCount, 4);
  assert.equal(decoderResetCount, 4);
  assert.equal(result.runs.length, 4);
  assert.deepEqual(result.runs.find(({ articulation }) => articulation === "normal")!
    .deltaFromNormal, {
    rawEvidenceCount: 0,
    rawEvidenceRate: 0,
    producedFreshAttackCount: 0,
    freshAttackRate: 0,
    independentMatchCount: 0,
    independentMatchRate: 0,
    orderedAdvanceCount: 0,
    orderedAdvanceRate: 0,
    staleSustainPitchCount: 0,
    carryOverEventCount: 0,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
  });
  const detached = result.runs.find(({ articulation }) => articulation === "detached")!;
  assert.equal(detached.summary.detachedSilenceGapCount, 26);
  assert.equal(detached.summary.maximumDetachedSilenceGapRms, 0);
});

function articulationSummary(
  articulation: "normal" | "detached",
  update: Partial<ListenArticulationRunSummary> = {},
): ListenArticulationRunSummary {
  return {
    articulation,
    expectedEventCount: 27,
    rawEvidenceCount: 10,
    rawEvidenceRate: 10 / 27,
    expectedFreshAttackCount: 60,
    producedFreshAttackCount: 40,
    freshAttackRate: 2 / 3,
    expectedOnsetCount: 55,
    producedOnsetCount: 38,
    expectedReOnsetCount: 5,
    producedReOnsetCount: 2,
    independentMatchCount: 10,
    independentMatchRate: 10 / 27,
    orderedAdvanceCount: 10,
    orderedAdvanceRate: 10 / 27,
    completePassage: false,
    staleSustainPitchCount: 5,
    carryOverEventCount: 2,
    departingPitchActiveCount: 2,
    departingPitchOffsetBeforeNextAttackCount: 0,
    confidentPreviousChordExtraCount: 1,
    retriggerNotDetectedFailureCount: 1,
    carryOverFailureCount: 1,
    modelNoEvidenceFailureCount: 0,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    detachedSilenceGapCount: articulation === "detached" ? 26 : 0,
    maximumDetachedSilenceGapRms: articulation === "detached" ? 0 : null,
    ...update,
  };
}

test("interprets articulation improvements at the predefined three-event threshold", () => {
  const conclusion = (
    normalUpdate: Partial<ListenArticulationRunSummary>,
    detachedUpdate: Partial<ListenArticulationRunSummary>,
  ) => interpretListenArticulationMatrix([
    { articulation: "normal", summary: articulationSummary("normal", normalUpdate) },
    { articulation: "detached", summary: articulationSummary("detached", detachedUpdate) },
  ]).code;

  assert.equal(conclusion({}, {
    independentMatchCount: 13,
    rawEvidenceCount: 13,
    staleSustainPitchCount: 2,
  }), "recognizer-state-release-interference");
  assert.equal(conclusion({}, {
    independentMatchCount: 13,
    rawEvidenceCount: 11,
  }), "matcher-carry-over-handling");
  assert.equal(conclusion({ orderedAdvanceCount: 5 }, {
    independentMatchCount: 11,
    orderedAdvanceCount: 8,
  }), "ordered-cascade-playhead");
  assert.equal(conclusion({}, {
    independentMatchCount: 11,
    modelNoEvidenceFailureCount: 2,
  }), "no-detached-benefit");
  assert.equal(conclusion({}, {
    independentMatchCount: 13,
    falseAdvanceCount: 1,
  }), "inconclusive-safety-errors");
});

test("resets inference and decoding once per sequence rather than once per event", async () => {
  class FakeSession implements SequenceInferenceSession {
    resetCount = 0;
    runCount = 0;
    reset() { this.resetCount += 1; }
    async run(): Promise<OnlineAmtStepResult> {
      this.runCount += 1;
      return {
        scores: new Float32Array(88 * 5),
        states: new Uint8Array(88),
        signalActive: false,
        inferenceTimeMs: 2,
      };
    }
  }
  class FakeDecoder implements SequenceOutputDecoder {
    resetCount = 0;
    reset() { this.resetCount += 1; }
    decode(): DecodedOnlineAmtOutput {
      return {
        onsets: [],
        recognizedActivePitches: [],
        targetPitchEvidence: [],
        noteStates: [],
        noteEvents: [],
      };
    }
  }
  const session = new FakeSession();
  const decoder = new FakeDecoder();
  await captureListenSequenceTrace({
    sequenceId: "three-events",
    intervalMs: 125,
    audio: new Float32Array(512 * 4),
    relevantPitches: [60, 62, 64],
    session,
    decoder,
  });
  assert.equal(session.resetCount, 1);
  assert.equal(decoder.resetCount, 1);
  assert.equal(session.runCount, 4);
});

test("replays targets in order and advances generation only after a match", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [64], [67]]), 250);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [60]),
    recognitionFrame(sequence.relevantPitches, 480, [{ midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 512, [], [64]),
    recognitionFrame(sequence.relevantPitches, 736, [{ midi: 67 }]),
    recognitionFrame(sequence.relevantPitches, 768, [], [67]),
  ];
  const result = replayListenSequenceTrace(sequence, trace(sequence, frames));
  assert.equal(result.summary.complete, true);
  assert.deepEqual(result.events.map(({ advancedAtMs }) => advancedAtMs), [256, 512, 768]);
  assert.deepEqual(result.events.map(({ activeTargetIndexAtAttack }) => activeTargetIndexAtAttack), [0, 1, 2]);
});

test("assigns repeated recognized notes to distinct physical attacks", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [60]]), 200);
  const notes = sequence.attacks.flatMap(({ notes: attackNotes }) => attackNotes);
  const assigned = assignRecognitionEventsToAttacks(notes, [
    { midi: 60, timeMs: 224, confidence: 0.9, noteConfidence: 0.9, type: "onset" },
    { midi: 60, timeMs: 448, confidence: 0.9, noteConfidence: 0.9, type: "reOnset" },
  ]);
  assert.equal(assigned.size, 2);
  assert.equal(assigned.get(notes[0].id)?.timeMs, 224);
  assert.equal(assigned.get(notes[1].id)?.timeMs, 448);
});

test("detects when the next physical attack precedes playhead advancement", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [64]]), 125);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 320, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 352, [], [60]),
  ];
  const result = replayListenSequenceTrace(sequence, trace(sequence, frames));
  assert.equal(result.events[0].advancedAtMs, 352);
  assert.equal(result.events[0].nextAttackBeforeAdvance, true);
  assert.equal(result.events[0].primaryFailure, "next-attack-before-advance");
  assert.equal(result.events[1].activeTargetIndexAtAttack, 0);
  assert.equal(result.summary.orderedPrefixCompleted, 0);
});

test("classifies model, threshold, bass, retrigger, timing, extra, and timeout failures", () => {
  const common = {
    advanced: false,
    duplicate: false,
    skipped: false,
    falseAdvance: false,
    nextAttackBeforeAdvance: false,
    unexpectedPitches: [] as number[],
    targetPitches: [60] as number[],
    previousTargetPitches: [] as number[],
    expectedPitches: [pitchDiagnostic()],
  };
  assert.ok(classifyListenSequenceFailure(common).reasons.includes("model-no-evidence"));
  assert.ok(classifyListenSequenceFailure({
    ...common,
    expectedPitches: [pitchDiagnostic({ rawOnsetProduced: true, onsetConfidence: 0.4 })],
  }).reasons.includes("onset-below-threshold"));
  assert.ok(classifyListenSequenceFailure({
    ...common,
    targetPitches: [48, 60, 64],
    expectedPitches: [
      pitchDiagnostic({ midi: 48, maximumActiveConfidence: 0.8 }),
      pitchDiagnostic({ midi: 60 }),
      pitchDiagnostic({ midi: 64 }),
    ],
  }).reasons.includes("missing-required-bass-onset"));
  assert.ok(classifyListenSequenceFailure({
    ...common,
    previousTargetPitches: [60],
    expectedPitches: [pitchDiagnostic({ maximumActiveConfidence: 0.8 })],
  }).reasons.includes("retrigger-not-detected"));
  assert.ok(classifyListenSequenceFailure({
    ...common,
    nextAttackBeforeAdvance: true,
  }).reasons.includes("next-attack-before-advance"));
  assert.equal(classifyListenSequenceFailure({
    ...common,
    unexpectedPitches: [61],
  }).primary, "rejected-extra-pitch");
  assert.equal(classifyListenSequenceFailure({
    ...common,
    expectedPitches: [pitchDiagnostic({
      rawOnsetProduced: true,
      qualifyingOnset: true,
      maximumActiveConfidence: 0.9,
    })],
  }).primary, "matcher-timeout");
});

test("detects a held physical attack that duplicates and skips a later score target", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [60]]), 300);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [60]),
    recognitionFrame(sequence.relevantPitches, 288, [{ midi: 60, type: "reOnset" }]),
    recognitionFrame(sequence.relevantPitches, 320, [], [60]),
  ];
  const result = replayListenSequenceTrace(sequence, trace(sequence, frames));
  assert.equal(result.events[1].skipped, true);
  assert.equal(result.events[1].duplicate, true);
  assert.equal(result.events[1].primaryFailure, "duplicate-or-held-attack");
  assert.equal(result.summary.skippedAdvanceCount, 1);
  assert.equal(result.summary.duplicateAdvanceCount, 1);
  assert.equal(result.summary.complete, false);
});

test("calculates independent summaries for every playing speed", () => {
  const runs = LISTEN_SEQUENCE_INTERVALS_MS.map(successfulSingleTargetRun);
  const summary = summarizeListenSequenceBenchmark(runs);
  assert.deepEqual(
    summary.speedSummaries.map(({ intervalMs }) => intervalMs),
    [...LISTEN_SEQUENCE_INTERVALS_MS],
  );
  assert.ok(summary.speedSummaries.every(({ completePassageRate }) => completePassageRate === 1));
  assert.ok(summary.speedSummaries.every(({ correctAdvanceRate }) => correctAdvanceRate === 1));
});

test("replays a bounded next-target onset buffer over the identical recognition trace", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [64]]), 125);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 352, [{ midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 384, [], [64]),
  ]);
  const current = replayListenSequenceTrace(sequence, sharedTrace, "current-matcher");
  const buffered = replayListenSequenceTrace(sequence, sharedTrace, "next-onset-buffer");
  const comparison = compareListenSequencePolicies([current], [buffered]);
  assert.equal(current.summary.complete, false);
  assert.equal(buffered.summary.complete, true);
  assert.deepEqual(buffered.events.map(({ advancedAtMs }) => advancedAtMs), [352, 384]);
  assert.equal(buffered.trace, current.trace);
  assert.equal(comparison.correctAdvanceImprovement, 1);
  assert.equal(comparison.bufferedFalseAdvanceCount, 0);
  assert.equal(comparison.bufferedSkippedAdvanceCount, 0);
  assert.equal(comparison.bufferedDuplicateAdvanceCount, 0);
  assert.equal(comparison.accepted, true);
});

test("buffers a repeated pitch only when a genuine re-onset event is present", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [60]]), 125);
  const withoutRetrigger = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 352, [], [60]),
    recognitionFrame(sequence.relevantPitches, 384, [], [60]),
  ]);
  const withRetrigger = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 352, [{ midi: 60, type: "reOnset" }]),
    recognitionFrame(sequence.relevantPitches, 384, [], [60]),
  ]);
  assert.equal(
    replayListenSequenceTrace(sequence, withoutRetrigger, "next-onset-buffer").events[1].advanced,
    false,
  );
  const buffered = replayListenSequenceTrace(sequence, withRetrigger, "next-onset-buffer");
  assert.equal(buffered.events[1].advanced, true);
  assert.equal(buffered.summary.duplicateAdvanceCount, 0);
});

test("wrong-note safety attacks cannot advance a later valid target", () => {
  const definition: ListenSequenceDefinition = {
    id: "wrong-note-recovery",
    family: "safety",
    label: "Wrong note recovery",
    targets: [[60], [64]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [61], expectedAdvance: false },
      { at: 1, targetIndex: 0, notes: [60], expectedAdvance: true },
      { at: 2, targetIndex: 1, notes: [64], expectedAdvance: true },
    ],
  };
  const sequence = materializeListenSequence(definition, 250);
  const frames = [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 61 }]),
    recognitionFrame(sequence.relevantPitches, 480, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 512, [], [60]),
    recognitionFrame(sequence.relevantPitches, 736, [{ midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 768, [], [64]),
  ];
  const result = replayListenSequenceTrace(sequence, trace(sequence, frames));
  const buffered = replayListenSequenceTrace(
    sequence,
    trace(sequence, frames),
    "next-onset-buffer",
  );
  assert.deepEqual(result.attacks[0].advancementTargetIndices, []);
  assert.deepEqual(result.events.map(({ advancedAtMs }) => advancedAtMs), [512, 768]);
  assert.equal(result.summary.falseAdvanceCount, 0);
  assert.equal(result.summary.skippedAdvanceCount, 0);
  assert.equal(result.summary.complete, true);
  assert.equal(buffered.summary.falseAdvanceCount, 0);
  assert.equal(buffered.summary.skippedAdvanceCount, 0);
  assert.equal(buffered.summary.duplicateAdvanceCount, 0);
});

test("attributes downstream recognition independently after one early ordered stall", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [64], [67]]), 250);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 480, [{ midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 512, [], [64]),
    recognitionFrame(sequence.relevantPitches, 736, [{ midi: 67 }]),
    recognitionFrame(sequence.relevantPitches, 768, [], [67]),
  ]);

  const result = replayListenSequenceTrace(sequence, sharedTrace);

  assert.equal(result.events[0].independentlyMatched, false);
  assert.deepEqual(result.events.slice(1).map(({ independentlyMatched }) => independentlyMatched), [
    true,
    true,
  ]);
  assert.deepEqual(result.events.slice(1).map(({ orderedAdvanced }) => orderedAdvanced), [
    false,
    false,
  ]);
  assert.deepEqual(result.events.slice(1).map(({ primaryFailure }) => primaryFailure), [
    "blocked-by-prior-stall",
    "blocked-by-prior-stall",
  ]);
  assert.ok(result.events.slice(1).every((event) => (
    !event.failureReasons.includes("model-no-evidence")
  )));
  assert.equal(result.summary.firstCausalStallIndex, 0);
  assert.equal(result.summary.orderedPrefixCompleted, 0);
  assert.equal(result.summary.cascadeLossCount, 2);
  assert.equal(result.summary.recognizedButBlockedCount, 2);
  assert.deepEqual(result.summary.blockedEventPositions, [1, 2]);
});

test("reports raw attack evidence that remains below matcher thresholds", () => {
  const sequence = materializeListenSequence(regularDefinition([[60]]), 1_000);
  const weak = recognitionFrame(
    sequence.relevantPitches,
    224,
    [{ midi: 60, confidence: 0.4, noteConfidence: 0.4 }],
    [60],
  );
  weak.activePitches = [{ midi: 60, confidence: 0.4 }];
  weak.confidenceEvidence = [{ midi: 60, confidence: 0.4 }];
  const result = replayListenSequenceTrace(sequence, trace(sequence, [weak]));
  const event = result.events[0];

  assert.equal(event.allRequiredRawEvidencePresent, true);
  assert.equal(event.thresholdQualified, false);
  assert.equal(event.independentlyMatched, false);
  assert.equal(event.expectedPitches[0].maximumOnsetConfidence, 0.4);
  assert.equal(event.expectedPitches[0].maximumActiveConfidence, 0.4);
  assert.equal(event.expectedPitches[0].firstRawEvidenceTimeMs, 224);
  assert.ok(event.rawFailureReasons.includes("onset-below-threshold"));
});

test("attributes an immediately repeated physical attack despite a transition mismatch", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [60]]), 200);
  const notes = sequence.attacks.flatMap(({ notes: attackNotes }) => attackNotes);
  const assignments = assignRecognitionEventsToAttacks(notes, [
    { midi: 60, timeMs: 224, confidence: 0.9, noteConfidence: 0.9, type: "onset" },
    { midi: 60, timeMs: 448, confidence: 0.9, noteConfidence: 0.9, type: "onset" },
  ]);

  assert.equal(assignments.size, 2);
  assert.equal(assignments.get(notes[1].id)?.type, "onset");
});

test("never assigns one decoded attack to multiple scheduled attacks", () => {
  const sequence = materializeListenSequence({
    id: "doubled-unison",
    family: "test",
    label: "Doubled unison",
    targets: [[60]],
    attacks: [{ at: 0, targetIndex: 0, notes: [60, 60], expectedAdvance: true }],
  }, 125);
  const notes = sequence.attacks.flatMap(({ notes: attackNotes }) => attackNotes);
  const observation = {
    midi: 60,
    timeMs: 224,
    confidence: 0.9,
    noteConfidence: 0.9,
    type: "onset" as const,
  };

  const assignments = assignRecognitionEventsToAttacks(notes, [observation]);

  assert.equal(assignments.size, 1);
  assert.equal([...assignments.values()].filter((value) => value === observation).length, 1);
});

test("independent replay identifies carry-over without manufacturing a repeated attack", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [60]]), 125);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 256, [], [60]),
    recognitionFrame(sequence.relevantPitches, 320, [], [60]),
    recognitionFrame(sequence.relevantPitches, 352, [], [60]),
  ]);

  const layers = evaluateTraceRecognitionLayers(sequence, sharedTrace);

  assert.equal(layers[1].independentlyMatched, false);
  assert.ok(layers[1].rawFailureReasons.includes("retrigger-not-detected"));
  assert.ok(layers[1].independentFailureReasons.includes("carry-over"));
});

test("independent matcher replay reports a confident extra-pitch rejection", () => {
  const definition: ListenSequenceDefinition = {
    id: "extra-diagnostic",
    family: "test",
    label: "Extra diagnostic",
    targets: [[60]],
    attacks: [{
      at: 0,
      targetIndex: 0,
      notes: [60, 61],
      expectedAdvance: true,
    }],
  };
  const sequence = materializeListenSequence(definition, 1_000);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [
      { midi: 60 },
      { midi: 61, confidence: 0.99, noteConfidence: 0.99 },
    ]),
    recognitionFrame(sequence.relevantPitches, 256, [], [60, 61]),
  ]);

  const event = replayListenSequenceTrace(sequence, sharedTrace).events[0];

  assert.equal(event.independentlyMatched, false);
  assert.deepEqual(event.confidentUnexpectedPitches, [61]);
  assert.ok(event.independentFailureReasons.includes("rejected-extra-pitch"));
});

test("independent matcher reports chord evidence outside its collection window", () => {
  const sequence = materializeListenSequence(regularDefinition([[60, 64]]), 1_000);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }], [60]),
    recognitionFrame(sequence.relevantPitches, 672, [{ midi: 64 }], [60, 64]),
    recognitionFrame(sequence.relevantPitches, 704, [], [60, 64]),
  ]);

  const event = replayListenSequenceTrace(sequence, sharedTrace).events[0];

  assert.equal(event.independentlyMatched, false);
  assert.ok(event.independentFailureReasons.includes("evidence-too-spread-out"));
});

test("summaries expose all three recognition layers at every speed", () => {
  const runs = LISTEN_SEQUENCE_INTERVALS_MS.map(successfulSingleTargetRun);
  const summary = summarizeListenSequenceBenchmark(runs);

  for (const speed of summary.speedSummaries) {
    assert.equal(speed.rawCompleteEvidenceRate, 1);
    assert.equal(speed.thresholdQualifiedEventRate, 1);
    assert.equal(speed.independentMatchRate, 1);
    assert.equal(speed.orderedAdvanceRate, 1);
    assert.equal(speed.cascadeLossCount, 0);
    assert.equal(speed.p50IndependentMatchLatencyMs !== null, true);
    assert.equal(speed.p50OrderedAdvanceLatencyMs !== null, true);
  }
});

test("current and buffered policies share raw and independent trace metrics", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [64]]), 125);
  const sharedTrace = trace(sequence, [
    recognitionFrame(sequence.relevantPitches, 224, [{ midi: 60 }]),
    recognitionFrame(sequence.relevantPitches, 352, [{ midi: 64 }]),
    recognitionFrame(sequence.relevantPitches, 384, [], [64]),
  ]);
  const current = replayListenSequenceTrace(sequence, sharedTrace, "current-matcher");
  const buffered = replayListenSequenceTrace(sequence, sharedTrace, "next-onset-buffer");

  assert.deepEqual(
    current.events.map((event) => ({
      raw: event.allRequiredRawEvidencePresent,
      threshold: event.thresholdQualified,
      independent: event.independentlyMatched,
      independentAt: event.independentMatchAtMs,
      expected: event.expectedPitches,
    })),
    buffered.events.map((event) => ({
      raw: event.allRequiredRawEvidencePresent,
      threshold: event.thresholdQualified,
      independent: event.independentlyMatched,
      independentAt: event.independentMatchAtMs,
      expected: event.expectedPitches,
    })),
  );
  assert.equal(
    compareListenSequencePolicies([current], [buffered]).rawAndIndependentMetricsIdentical,
    true,
  );
});

test("independent diagnostics replay the trace without rerunning inference", async () => {
  const sequence = materializeListenSequence(regularDefinition([[60]]), 1_000);
  let inferenceRuns = 0;
  const session: SequenceInferenceSession = {
    reset() {},
    async run() {
      inferenceRuns += 1;
      return {
        scores: new Float32Array(88 * 5),
        states: new Uint8Array(88),
        signalActive: false,
        inferenceTimeMs: 1,
      };
    },
  };
  const audio = new Float32Array(512 * 2);
  const captured = await captureListenSequenceTrace({
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    audio,
    relevantPitches: sequence.relevantPitches,
    session,
  });
  const runsAfterCapture = inferenceRuns;

  evaluateTraceRecognitionLayers(sequence, captured);
  replayListenSequenceTrace(sequence, captured, "current-matcher");
  replayListenSequenceTrace(sequence, captured, "next-onset-buffer");

  assert.equal(inferenceRuns, runsAfterCapture);
});
