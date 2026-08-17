import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTEN_BENCHMARK_RENDERER,
  signatureForBenchmarkPcm,
} from "./listenBenchmarkAudio";
import { LISTEN_MATCHER_PROFILES, listenMatcherThresholds } from "./listenMatcherProfiles";
import {
  bundledListenSequences,
  materializeListenSequence,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import {
  CANONICAL_ISOLATED_SMOKE_BASELINES,
  LISTEN_BASELINE_PROFILE,
  LISTEN_BASELINE_PROFILE_ID,
  assertCanonicalIsolatedSmokeBaseline,
  assertIsolatedListenTrialParity,
  assertListenSequenceRunParity,
  assertListenTraceParity,
  assertRecognitionTraceUnmutated,
  assertRenderedTraceAudioIdentity,
  canonicalIsolatedSmokeDifferences,
  firstStructuralDifference,
  listenBaselineProfileMetadata,
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
  listenTraceIdentity,
  withinOneFloat32Ulp,
  type CanonicalIsolatedSmokeResult,
} from "./listenBaselineParity";

function recognitionFrame(
  relevantPitches: readonly number[],
  capturedAtMs: number,
  attacks: readonly number[] = [],
): ListenRecognitionFrame {
  return {
    capturedAtMs,
    onsets: attacks.map((midi) => ({
      midi,
      confidence: 0.95,
      noteConfidence: 0.9,
      onsetTimeMs: capturedAtMs,
    })),
    noteEvents: attacks.map((midi) => ({
      midi,
      type: "onset" as const,
      confidence: 0.95,
      eventTimeMs: capturedAtMs,
    })),
    activePitches: attacks.map((midi) => ({ midi, confidence: 0.9 })),
    confidenceEvidence: relevantPitches.map((midi) => ({
      midi,
      confidence: attacks.includes(midi) ? 0.9 : 0,
    })),
    modelScores: [],
    modelStates: relevantPitches.map((midi) => (attacks.includes(midi) ? 3 : 0)),
    signalActive: attacks.length > 0,
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
    audioDiagnostics: { frameCount: 512, durationMs: 32, peak: 0, rms: 0 },
    pcm: new Float32Array(512),
    frames,
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
  };
}

function capturedRun() {
  const sequence = materializeListenSequence(bundledListenSequences()[0], 1_000);
  const frames = sequence.targets.flatMap((target) => {
    const at = Math.ceil(target.scheduledAttackTimeMs / 32) * 32;
    return [
      recognitionFrame(sequence.relevantPitches, at, target.pitches),
      recognitionFrame(sequence.relevantPitches, at + 32),
    ];
  });
  return { sequence, capturedTrace: trace(sequence, frames) };
}

const float32 = new Float32Array(1);
const float32AsInt = new Int32Array(float32.buffer);

/** The next representable Float32 above a positive value. */
function adjacentFloat32(value: number): number {
  float32[0] = value;
  float32AsInt[0] += float32[0] >= 0 ? 1 : -1;
  return float32[0];
}

function canonicalResult(
  rendererVersion: keyof typeof CANONICAL_ISOLATED_SMOKE_BASELINES,
): CanonicalIsolatedSmokeResult {
  const baseline = CANONICAL_ISOLATED_SMOKE_BASELINES[rendererVersion];
  return {
    rendererVersion,
    piano: baseline.piano,
    layer: baseline.layer,
    targetPitches: [...baseline.targetPitches],
    advanced: baseline.advanced,
    onsetToAdvanceMs: baseline.onsetToAdvanceMs,
    pcmFrameCount: baseline.pcmFrameCount,
    pcmDurationMs: baseline.pcmDurationMs,
    recognitionStructureHash: baseline.recognitionStructureHash,
    peak: baseline.peak,
    rms: baseline.rms,
    traceFrameCount: baseline.traceFrameCount,
    recognizedOnsets: baseline.recognizedOnsets.map((onset) => ({ ...onset })),
  };
}

test("names the frozen baseline profile rather than the production pointer", () => {
  assert.equal(LISTEN_BASELINE_PROFILE_ID, "baseline-v1");
  assert.deepEqual(
    LISTEN_BASELINE_PROFILE,
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );
  assert.deepEqual(listenBaselineProfileMetadata(), {
    profileId: "baseline-v1",
    profile: LISTEN_BASELINE_PROFILE,
  });
});

test("reports the path of the first structural difference", () => {
  assert.equal(firstStructuralDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), null);
  assert.equal(firstStructuralDifference({ a: 1 }, { a: 2 }), "a");
  assert.equal(firstStructuralDifference({ a: [1, 2] }, { a: [1, 3] }), "a[1]");
  assert.equal(firstStructuralDifference({ a: [1] }, { a: [1, 2] }), "a.length");
  assert.equal(firstStructuralDifference({ a: { b: null } }, { a: { b: 0 } }), "a.b");
  assert.equal(firstStructuralDifference({ a: 1 }, { a: 1, b: 2 }), "b");
});

test("accepts a baseline replay that reproduces the captured run", () => {
  const { sequence, capturedTrace } = capturedRun();
  const captured = replayListenSequenceTrace(sequence, capturedTrace, "current-matcher");
  const replayed = replayListenSequenceTrace(
    sequence,
    capturedTrace,
    "current-matcher",
    LISTEN_BASELINE_PROFILE,
  );
  assert.doesNotThrow(() => assertListenSequenceRunParity("captured", captured, replayed));
});

test("rejects a replay whose events, latency, or safety counters moved", () => {
  const { sequence, capturedTrace } = capturedRun();
  const captured = replayListenSequenceTrace(sequence, capturedTrace, "current-matcher");
  const shiftedEvent = {
    ...captured,
    events: captured.events.map((event, index) => (
      index === 0 ? { ...event, orderedAdvanced: !event.orderedAdvanced } : event
    )),
  };
  assert.throws(
    () => assertListenSequenceRunParity("captured", captured, shiftedEvent),
    /baseline-v1 replay parity failed for captured at events\[0\]\.orderedAdvanced/,
  );
  const shiftedSafety = {
    ...captured,
    summary: { ...captured.summary, falseAdvanceCount: captured.summary.falseAdvanceCount + 1 },
  };
  assert.throws(
    () => assertListenSequenceRunParity("captured", captured, shiftedSafety),
    /summary\.falseAdvanceCount/,
  );
  const shiftedAttacks = { ...captured, attacks: captured.attacks.slice(1) };
  assert.throws(() => assertListenSequenceRunParity("captured", captured, shiftedAttacks), /attacks/);
});

test("compares retained trace audio and recognition identity", () => {
  const { sequence, capturedTrace } = capturedRun();
  assert.doesNotThrow(() => assertListenTraceParity("trace", capturedTrace, capturedTrace));
  const shortened = { ...capturedTrace, frames: capturedTrace.frames.slice(1) };
  assert.throws(
    () => assertListenTraceParity("trace", capturedTrace, shortened),
    /frameCount/,
  );
  const otherSequence = materializeListenSequence(bundledListenSequences()[1], 1_000);
  assert.throws(
    () => assertListenTraceParity("trace", capturedTrace, trace(otherSequence, [])),
    /Recognition trace parity failed/,
  );
  assert.equal(sequence.intervalMs, 1_000);
});

test("compares isolated trials event for event", () => {
  const captured = {
    advanced: true,
    onsetToAdvanceMs: 196,
    recognizedOnsets: [
      { midi: 60, confidence: 0.99, noteConfidence: 0.98, onsetAfterAttackMs: 164 },
    ],
  };
  assert.doesNotThrow(() => assertIsolatedListenTrialParity("smoke", captured, captured));
  assert.throws(
    () => assertIsolatedListenTrialParity("smoke", captured, {
      ...captured,
      onsetToAdvanceMs: 197,
    }),
    /isolated replay parity failed for smoke at onsetToAdvanceMs/,
  );
  assert.throws(
    () => assertIsolatedListenTrialParity("smoke", captured, {
      ...captured,
      recognizedOnsets: [{ ...captured.recognizedOnsets[0], confidence: 0.5 }],
    }),
    /recognizedOnsets\[0\]\.confidence/,
  );
});

test("holds the canonical Direct and Tone smoke constants", () => {
  const direct = CANONICAL_ISOLATED_SMOKE_BASELINES["bundled-piano-web-audio-v1"];
  const tone = CANONICAL_ISOLATED_SMOKE_BASELINES["bundled-piano-tone-v2"];
  for (const baseline of [direct, tone]) {
    assert.equal(baseline.advanced, true);
    assert.equal(baseline.onsetToAdvanceMs, 196);
    assert.equal(baseline.traceFrameCount, 35);
    assert.equal(baseline.pcmFrameCount, 17_920);
    assert.equal(baseline.pcmDurationMs, 1_120);
    assert.deepEqual(baseline.recognizedOnsets.map(({ midi }) => midi), [60, 64, 67]);
    assert.deepEqual(
      baseline.recognizedOnsets.map(({ onsetAfterAttackMs }) => onsetAfterAttackMs),
      [164, 164, 164],
    );
  }
  assert.ok(Math.abs(direct.peak - 0.603168) < 1e-6);
  assert.ok(Math.abs(direct.rms - 0.100907) < 1e-6);
  assert.ok(Math.abs(tone.peak - 0.432499) < 1e-6);
  assert.ok(Math.abs(tone.rms - 0.078035) < 1e-6);
});

test("accepts a canonical smoke within one Float32 ULP and rejects real drift", () => {
  for (const rendererVersion of ["bundled-piano-web-audio-v1", "bundled-piano-tone-v2"] as const) {
    const result = canonicalResult(rendererVersion);
    assert.deepEqual(canonicalIsolatedSmokeDifferences(result), []);
    assert.doesNotThrow(() => assertCanonicalIsolatedSmokeBaseline(result));
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({
        ...result,
        peak: adjacentFloat32(result.peak),
      }),
      [],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({
        ...result,
        peak: adjacentFloat32(adjacentFloat32(result.peak)),
      }).map((difference) => difference.split(":")[0]),
      ["peak"],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({ ...result, recognitionStructureHash: "deadbeef" })
        .map((difference) => difference.split(":")[0]),
      ["recognitionStructureHash"],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({
        ...result,
        recognizedOnsets: result.recognizedOnsets.map((onset, index) => (
          index === 0 ? { ...onset, confidence: adjacentFloat32(onset.confidence) } : onset
        )),
      }),
      [],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({
        ...result,
        recognizedOnsets: result.recognizedOnsets.map((onset, index) => (
          index === 0 ? { ...onset, confidence: onset.confidence - 1e-4 } : onset
        )),
      }).map((difference) => difference.split(":")[0]),
      ["recognizedOnsets[0].confidence"],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({ ...result, peak: result.peak + 1e-4 })
        .map((difference) => difference.split(":")[0]),
      ["peak"],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({ ...result, onsetToAdvanceMs: 228 })
        .map((difference) => difference.split(":")[0]),
      ["onsetToAdvanceMs"],
    );
    assert.deepEqual(
      canonicalIsolatedSmokeDifferences({ ...result, traceFrameCount: 34 })
        .map((difference) => difference.split(":")[0]),
      ["traceFrameCount"],
    );
  }
});

test("rejects a smoke from an unrecorded renderer", () => {
  assert.throws(
    () => assertCanonicalIsolatedSmokeBaseline({
      ...canonicalResult("bundled-piano-web-audio-v1"),
      rendererVersion: "bundled-piano-web-audio-v9",
    }),
    /unknown renderer bundled-piano-web-audio-v9/,
  );
});

test("counts genuine Float32 adjacency rather than a relative epsilon", () => {
  for (const value of [0.1, 0.6031675934791565, 0.9997449083128223, 1]) {
    const rounded = Math.fround(value);
    assert.ok(withinOneFloat32Ulp(rounded, rounded));
    assert.ok(withinOneFloat32Ulp(adjacentFloat32(rounded), rounded));
    assert.ok(!withinOneFloat32Ulp(adjacentFloat32(adjacentFloat32(rounded)), rounded));
    // The previous relative rule accepted roughly sixteen steps near 0.1.
    assert.ok(!withinOneFloat32Ulp(rounded + 1.1920928955078125e-7, rounded) || rounded >= 1);
  }
  assert.ok(!withinOneFloat32Ulp(Number.NaN, 0.5));
  assert.ok(withinOneFloat32Ulp(Number.NaN, Number.NaN));
});

test("hashes every decoded value a trace produced", () => {
  const { capturedTrace } = capturedRun();
  const baseline = listenRecognitionTraceHash(capturedTrace);
  assert.match(baseline, /^[0-9a-f]{8}$/);
  assert.equal(listenRecognitionTraceHash(capturedTrace), baseline);

  const mutate = (change: (frames: ListenRecognitionFrame[]) => ListenRecognitionFrame[]) => (
    listenRecognitionTraceHash({ ...capturedTrace, frames: change([...capturedTrace.frames]) })
  );
  const withFirstFrame = (update: Partial<ListenRecognitionFrame>) => mutate((frames) => {
    frames[0] = { ...frames[0], ...update };
    return frames;
  });

  assert.notEqual(withFirstFrame({ modelStates: [9, ...capturedTrace.frames[0].modelStates.slice(1)] }), baseline);
  assert.notEqual(withFirstFrame({ modelScores: [0.5] }), baseline);
  assert.notEqual(withFirstFrame({ signalActive: !capturedTrace.frames[0].signalActive }), baseline);
  assert.notEqual(withFirstFrame({ capturedAtMs: capturedTrace.frames[0].capturedAtMs + 1 }), baseline);
  assert.notEqual(
    withFirstFrame({
      confidenceEvidence: capturedTrace.frames[0].confidenceEvidence.map((evidence, index) => (
        index === 0 ? { ...evidence, confidence: adjacentFloat32(evidence.confidence) } : evidence
      )),
    }),
    baseline,
  );
  const attackFrame = capturedTrace.frames.findIndex(({ onsets }) => onsets.length > 0);
  assert.ok(attackFrame >= 0);
  assert.notEqual(
    mutate((frames) => {
      frames[attackFrame] = {
        ...frames[attackFrame],
        onsets: frames[attackFrame].onsets.map((onset) => ({
          ...onset,
          confidence: adjacentFloat32(onset.confidence),
        })),
      };
      return frames;
    }),
    baseline,
  );
  assert.notEqual(
    mutate((frames) => {
      frames[attackFrame] = {
        ...frames[attackFrame],
        noteEvents: frames[attackFrame].noteEvents.map((event) => ({ ...event, type: "reOnset" as const })),
      };
      return frames;
    }),
    baseline,
  );
  assert.notEqual(mutate((frames) => frames.slice(1)), baseline);
});

test("ignores wall-clock inference timing so the hash stays reproducible", () => {
  const { capturedTrace } = capturedRun();
  const slower = {
    ...capturedTrace,
    maximumInferenceMs: capturedTrace.maximumInferenceMs + 12,
    frames: capturedTrace.frames.map((frame) => ({
      ...frame,
      inferenceDurationMs: frame.inferenceDurationMs + 7,
    })),
  };
  assert.equal(listenRecognitionTraceHash(slower), listenRecognitionTraceHash(capturedTrace));
});

test("records the PCM and recognition identity of a captured trace", () => {
  const { capturedTrace } = capturedRun();
  const signed = {
    ...capturedTrace,
    audioSignature: signatureForBenchmarkPcm(capturedTrace.pcm),
  };
  assert.deepEqual(listenTraceIdentity(signed), {
    pcmHash: signed.audioSignature.pcmHash,
    recognitionHash: listenRecognitionTraceHash(signed),
    frameCount: signed.frames.length,
  });
  assert.equal(listenTraceIdentity(capturedTrace).pcmHash, "unsigned");
});

test("requires the recognized audio to be exactly the rendered audio", () => {
  const { capturedTrace } = capturedRun();
  const rendered = signatureForBenchmarkPcm(capturedTrace.pcm);
  const signed = { ...capturedTrace, audioSignature: rendered };
  assert.doesNotThrow(() => assertRenderedTraceAudioIdentity("smoke", signed, rendered));

  const shifted = new Float32Array(capturedTrace.pcm);
  shifted[17] = adjacentFloat32(0.25);
  assert.throws(
    () => assertRenderedTraceAudioIdentity("smoke", signed, signatureForBenchmarkPcm(shifted)),
    /Rendered and recognized PCM differ for smoke at (pcmHash|chunkHashes)/,
  );
  assert.throws(
    () => assertRenderedTraceAudioIdentity("smoke", capturedTrace, rendered),
    /Rendered and recognized PCM differ/,
  );
});

test("carries a recognition hash in the compared trace signature", () => {
  const { capturedTrace } = capturedRun();
  const rescored = {
    ...capturedTrace,
    frames: capturedTrace.frames.map((frame, index) => (
      index === 0 ? { ...frame, modelScores: [0.125] } : frame
    )),
  };
  assert.throws(
    () => assertListenTraceParity("trace", capturedTrace, rescored),
    /Recognition trace parity failed for trace at recognitionHash/,
  );
});

test("keeps the structural hash free of the values the platform cannot reproduce", () => {
  const { capturedTrace } = capturedRun();
  const baseline = listenRecognitionStructureHash(capturedTrace);
  const jittered = {
    ...capturedTrace,
    frames: capturedTrace.frames.map((frame) => ({
      ...frame,
      inferenceDurationMs: frame.inferenceDurationMs + 3,
      modelScores: frame.modelScores.map((score) => score + 1e-9),
      onsets: frame.onsets.map((onset) => ({
        ...onset,
        confidence: adjacentFloat32(onset.confidence),
        noteConfidence: adjacentFloat32(onset.noteConfidence),
      })),
      activePitches: frame.activePitches.map((pitch) => ({
        ...pitch,
        confidence: adjacentFloat32(pitch.confidence),
      })),
      confidenceEvidence: frame.confidenceEvidence.map((evidence) => ({
        ...evidence,
        confidence: adjacentFloat32(evidence.confidence),
      })),
    })),
  };
  assert.equal(listenRecognitionStructureHash(jittered), baseline);
  assert.notEqual(listenRecognitionTraceHash(jittered), listenRecognitionTraceHash(capturedTrace));

  const attackFrame = capturedTrace.frames.findIndex(({ onsets }) => onsets.length > 0);
  const decided = (update: Partial<ListenRecognitionFrame>) => listenRecognitionStructureHash({
    ...capturedTrace,
    frames: capturedTrace.frames.map((frame, index) => (
      index === attackFrame ? { ...frame, ...update } : frame
    )),
  });
  assert.notEqual(decided({ modelStates: capturedTrace.frames[attackFrame].modelStates.map(() => 2) }), baseline);
  assert.notEqual(decided({ onsets: [] }), baseline);
  assert.notEqual(
    decided({
      noteEvents: capturedTrace.frames[attackFrame].noteEvents.map((event) => ({
        ...event,
        type: "reOnset" as const,
      })),
    }),
    baseline,
  );
  assert.notEqual(
    decided({ activePitches: capturedTrace.frames[attackFrame].activePitches.slice(1) }),
    baseline,
  );
  assert.notEqual(decided({ signalActive: !capturedTrace.frames[attackFrame].signalActive }), baseline);
});

test("checks trace immutability after each replay rather than only at the end", () => {
  const { sequence, capturedTrace } = capturedRun();
  const capturedHash = listenRecognitionTraceHash(capturedTrace);

  // Each replay is materialized and checked before the next one runs, so a
  // mutation is attributed to the replay that caused it.
  replayListenSequenceTrace(sequence, capturedTrace, "current-matcher");
  assert.doesNotThrow(
    () => assertRecognitionTraceUnmutated("current-matcher replay", capturedTrace, capturedHash),
  );
  replayListenSequenceTrace(sequence, capturedTrace, "current-matcher", LISTEN_BASELINE_PROFILE);
  assert.doesNotThrow(
    () => assertRecognitionTraceUnmutated("baseline replay", capturedTrace, capturedHash),
  );
  replayListenSequenceTrace(sequence, capturedTrace, "next-onset-buffer");
  assert.doesNotThrow(
    () => assertRecognitionTraceUnmutated("buffered replay", capturedTrace, capturedHash),
  );
});

test("catches a mutation that a later replay would restore", () => {
  const { capturedTrace } = capturedRun();
  const capturedHash = listenRecognitionTraceHash(capturedTrace);
  const attackFrame = capturedTrace.frames.findIndex(({ onsets }) => onsets.length > 0);
  const original = capturedTrace.frames[attackFrame].onsets[0].confidence;

  // A replay that dirties the trace is caught at its own checkpoint.
  capturedTrace.frames[attackFrame].onsets[0].confidence = adjacentFloat32(original);
  assert.throws(
    () => assertRecognitionTraceUnmutated("current-matcher replay", capturedTrace, capturedHash),
    /Replay mutated the recognition trace for current-matcher replay \([0-9a-f]{8} became [0-9a-f]{8}\)/,
  );

  // Restoring the value later would have hidden it from a single final check.
  capturedTrace.frames[attackFrame].onsets[0].confidence = original;
  assert.equal(listenRecognitionTraceHash(capturedTrace), capturedHash);
});
