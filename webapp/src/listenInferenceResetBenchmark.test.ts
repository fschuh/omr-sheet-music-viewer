import assert from "node:assert/strict";
import test from "node:test";
import type { OnlineAmtStepResult } from "./onlineAmtSession";
import {
  LISTEN_BENCHMARK_RENDERER,
} from "./listenBenchmarkAudio";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  courseClearArticulationDefinitions,
  materializeListenSequence,
  type ListenSequenceDefinition,
  type SequenceInferenceSession,
  type SequenceOutputDecoder,
} from "./listenSequenceBenchmark";
import {
  buildListenInferenceResetPlan,
  captureListenInferenceResetBenchmark,
  classifyListenInferenceResetOutcome,
  interpretListenInferenceResetSummary,
  type ListenInferenceResetSummary,
} from "./listenInferenceResetBenchmark";

function emptyOutput(): OnlineAmtStepResult {
  return {
    scores: new Float32Array(88 * 5),
    states: new Uint8Array(88),
    signalActive: false,
    inferenceTimeMs: 1,
  };
}

function regularDefinition(targets: readonly (readonly number[])[]): ListenSequenceDefinition {
  return {
    id: "fractional-reset-test",
    family: "test",
    label: "Fractional reset test",
    targets,
    attacks: targets.map((notes, index) => ({
      at: index,
      targetIndex: index,
      notes,
      expectedAdvance: true,
    })),
  };
}

test("builds aligned event-reset points after a clean 220 ms warm-up", () => {
  const normal = courseClearArticulationDefinitions().find(({ articulation }) => (
    articulation === "normal"
  ))!;
  const sequence = materializeListenSequence(normal, COURSE_CLEAR_ARTICULATION_INTERVAL_MS);
  const plan = buildListenInferenceResetPlan(sequence, "event-reset");

  assert.equal(plan.points.length, 26);
  assert.equal(plan.points[0].eventIndex, 1);
  assert.equal(plan.points[0].requestedAtMs, 1_000);
  assert.equal(plan.points[0].actualFrameStartMs, 1_024);
  assert.equal(plan.points[0].actualWarmupMs, 196);
  assert.ok(plan.points.every((point) => point.actualFrameStartMs >= point.requestedAtMs));
  assert.ok(plan.points.every((point) => point.actualFrameStartMs >= 990));
  assert.ok(plan.points.every((point) => point.eventIndex > 0));
  assert.deepEqual(buildListenInferenceResetPlan(sequence, "stateful"), {
    mode: "stateful",
    points: [],
  });
});

test("fractional frame alignment is deterministic", () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [62]]), 333.3333333333333);
  const first = buildListenInferenceResetPlan(sequence, "event-reset").points[0];
  const second = buildListenInferenceResetPlan(sequence, "event-reset").points[0];
  assert.deepEqual(first, second);
  assert.equal(first.frameIndex, 11);
  assert.equal(first.actualFrameStartMs, 352);
  assert.equal(first.actualWarmupMs, 201.33333333333326);
});

test("renders the continuous passage once and sends identical chunks to both passes", async () => {
  const normal = courseClearArticulationDefinitions().find(({ articulation }) => (
    articulation === "normal"
  ))!;
  const sequence = materializeListenSequence(normal, COURSE_CLEAR_ARTICULATION_INTERVAL_MS);
  const continuousFrameCount = sequence.frameCount / 512;
  const uniqueChordCount = new Set(sequence.targets.map(({ pitches }) => pitches.join(","))).size;
  const renderedIds: string[] = [];
  const chunks: Float32Array[] = [];
  const resetLog: string[] = [];
  const runBoundaries: number[] = [];
  class FakeSession implements SequenceInferenceSession {
    resetCount = 0;
    reset(): void {
      this.resetCount += 1;
      resetLog.push("session");
      runBoundaries.push(chunks.length);
    }
    async run(audio: Float32Array): Promise<OnlineAmtStepResult> {
      chunks.push(new Float32Array(audio));
      return emptyOutput();
    }
  }
  class FakeDecoder implements SequenceOutputDecoder {
    reset(): void { resetLog.push("decoder"); }
    decode() {
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
  const result = await captureListenInferenceResetBenchmark({
    session,
    decoderFactory: () => new FakeDecoder(),
    render: async (value) => {
      renderedIds.push(value.definition.id);
      return {
        pcm: new Float32Array(value.frameCount),
        renderer: { ...LISTEN_BENCHMARK_RENDERER },
        diagnostics: { frameCount: value.frameCount, durationMs: value.durationMs, peak: 0, rms: 0 },
      };
    },
  });

  assert.equal(renderedIds.filter((id) => id === normal.id).length, 1);
  assert.equal(renderedIds.length, uniqueChordCount + 1);
  assert.equal(session.resetCount, 1 + 1 + 26 + uniqueChordCount);
  assert.equal(result.stateful.trace.resetPlan?.mode, "stateful");
  assert.equal(result.eventReset.trace.resetPlan?.mode, "event-reset");
  assert.equal(result.eventReset.trace.resetPlan?.points[0].eventIndex, 1);
  assert.equal(result.eventReset.trace.resetPlan?.points.at(-1)?.eventIndex, 26);
  assert.equal(result.audioSignature, result.stateful.trace.audioSignature);
  assert.deepEqual(
    chunks.slice(0, continuousFrameCount),
    chunks.slice(continuousFrameCount, continuousFrameCount * 2),
  );
  assert.ok(resetLog.every((entry, index) => index === 0 || entry !== resetLog[index - 1]));
  assert.ok(runBoundaries.includes(continuousFrameCount));
});

test("does not reset event zero twice and resets session and decoder together", async () => {
  const sequence = materializeListenSequence(regularDefinition([[60], [62], [64]]), 1_000);
  const log: string[] = [];
  const session: SequenceInferenceSession = {
    reset() { log.push("session"); },
    async run() { return emptyOutput(); },
  };
  const decoder: SequenceOutputDecoder = {
    reset() { log.push("decoder"); },
    decode() {
      return { onsets: [], recognizedActivePitches: [], targetPitchEvidence: [], noteStates: [], noteEvents: [] };
    },
  };
  const points = buildListenInferenceResetPlan(sequence, "event-reset").points;
  const { captureListenSequenceTrace } = await import("./listenSequenceBenchmark");
  await captureListenSequenceTrace({
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    audio: new Float32Array(sequence.frameCount),
    relevantPitches: sequence.relevantPitches,
    session,
    decoder,
    resetPlan: { mode: "event-reset", points },
  });
  assert.equal(log.filter((entry) => entry === "session").length, 3);
  assert.equal(log.filter((entry) => entry === "decoder").length, 3);
  assert.deepEqual(log.slice(0, 2), ["session", "decoder"]);
  assert.ok(log.every((entry, index) => index === 0 || entry !== log[index - 1]));
  assert.equal(points.some(({ eventIndex }) => eventIndex === 0), false);
});

test("classifies reset recovery, loss, isolated-only failure, and ordered-only failure", () => {
  const flags = (update: Partial<Parameters<typeof classifyListenInferenceResetOutcome>[0]> = {}) => ({
    isolatedPass: true,
    statefulPass: true,
    eventResetPass: true,
    statefulIndependentMatch: true,
    eventResetIndependentMatch: true,
    statefulOrderedAdvance: true,
    eventResetOrderedAdvance: true,
    ...update,
  });
  assert.equal(classifyListenInferenceResetOutcome(flags()), "passed-all");
  assert.equal(classifyListenInferenceResetOutcome(flags({ statefulPass: false })), "recovered-by-event-reset");
  assert.equal(classifyListenInferenceResetOutcome(flags({ eventResetPass: false })), "lost-after-event-reset");
  assert.equal(classifyListenInferenceResetOutcome(flags({ statefulPass: false, eventResetPass: false })), "continuous-failure-isolated-pass");
  assert.equal(classifyListenInferenceResetOutcome(flags({ isolatedPass: false, statefulPass: false, eventResetPass: false })), "failed-all-modes");
  assert.equal(classifyListenInferenceResetOutcome(flags({ statefulOrderedAdvance: false })), "ordered-only-failure");
});

test("interprets raw-model and decoder-only reset conclusions separately", () => {
  const base = {
    recoveredEventCount: 3,
    lostEventCount: 0,
    rawModelImprovementCount: 3,
    decoderOnlyImprovementCount: 0,
    safetyErrorsIncreased: false,
  } as ListenInferenceResetSummary;
  assert.equal(interpretListenInferenceResetSummary(base).code, "neural-recurrent-state");
  assert.equal(interpretListenInferenceResetSummary({
    ...base,
    rawModelImprovementCount: 0,
    decoderOnlyImprovementCount: 3,
  }).code, "decoder-transition-history");
  assert.equal(interpretListenInferenceResetSummary({
    ...base,
    recoveredEventCount: 0,
    rawModelImprovementCount: 0,
    decoderOnlyImprovementCount: 0,
    independentMatchDelta: -1,
    orderedAdvanceDelta: 0,
    independentMatchCounts: { stateful: 26, eventReset: 25 },
    orderedAdvanceCounts: { stateful: 20, eventReset: 20 },
  }).code, "matcher-playhead-cascade");
});
