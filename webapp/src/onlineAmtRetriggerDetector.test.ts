import assert from "node:assert/strict";
import test from "node:test";
import { OnlineAmtOutputDecoder } from "./onlineAmtOutput";
import {
  disabledOnlineAmtRetriggerOptions,
  OnlineAmtScoreRiseRetriggerDetector,
  type OnlineAmtRetriggerOptions,
} from "./onlineAmtRetriggerDetector";

const retriggerOptions: OnlineAmtRetriggerOptions = {
  enabled: true,
  peakThreshold: 0.45,
  riseThreshold: 0.2,
  rearmThreshold: 0.2,
  lookbackFrames: 3,
  refractoryFrames: 2,
};

class ExperimentalRetriggerDecoder {
  private readonly decoder = new OnlineAmtOutputDecoder();
  private readonly detector: OnlineAmtScoreRiseRetriggerDetector;

  constructor(options: Partial<OnlineAmtRetriggerOptions>) {
    this.detector = new OnlineAmtScoreRiseRetriggerDetector(options);
  }

  reset(): void {
    this.decoder.reset();
    this.detector.reset();
  }

  decode(
    scores: Float32Array,
    states: Uint8Array,
    signalActive: boolean,
    capturedAtMs: number,
    targetPitches: readonly number[] = [],
  ) {
    const output = this.decoder.decode(
      scores,
      states,
      signalActive,
      capturedAtMs,
      targetPitches,
    );
    this.detector.apply(output, scores, states, signalActive, capturedAtMs);
    return output;
  }
}

function setPitchScores(
  scores: Float32Array,
  pitchIndex: number,
  values: readonly [number, number, number, number, number],
): void {
  scores.set(values, pitchIndex * 5);
}

function attackTypes(
  decoder: ExperimentalRetriggerDecoder,
  scores: Float32Array,
  states: Uint8Array,
  at: number,
) {
  return decoder.decode(scores, states, true, at).noteEvents
    .filter(({ type }) => type !== "offset")
    .map(({ type }) => type);
}

test("disabled retrigger options preserve the production decoder exactly", () => {
  const production = new OnlineAmtOutputDecoder();
  const disabled = new ExperimentalRetriggerDecoder(disabledOnlineAmtRetriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  const outputs = [];
  for (const [at, state, values, signalActive] of [
    [100, 3, [0.02, 0.03, 0.1, 0.75, 0.1], true],
    [132, 2, [0.03, 0.02, 0.8, 0.1, 0.05], true],
    [164, 2, [0.03, 0.02, 0.4, 0.25, 0.3], true],
    [196, 2, [0.03, 0.02, 0.4, 0.25, 0.3], false],
  ] as const) {
    states[39] = state;
    setPitchScores(scores, 39, values);
    outputs.push([
      production.decode(scores, states, signalActive, at, [60]),
      disabled.decode(scores, states, signalActive, at, [60]),
    ]);
  }
  for (const [left, right] of outputs) assert.deepEqual(right, left);
});

test("flat sustain never creates a synthetic event", () => {
  const decoder = new ExperimentalRetriggerDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.75, 0.15]);
  assert.deepEqual(attackTypes(decoder, scores, states, 100), ["onset"]);
  states[39] = 2;
  setPitchScores(scores, 39, [0.03, 0.02, 0.45, 0.25, 0.25]);
  assert.deepEqual(attackTypes(decoder, scores, states, 132), []);
  for (const at of [164, 196, 228, 260]) {
    assert.deepEqual(attackTypes(decoder, scores, states, at), []);
  }
});

test("a qualifying rise creates one synthetic re-onset and a plateau cannot duplicate it", () => {
  const decoder = new ExperimentalRetriggerDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
  attackTypes(decoder, scores, states, 100);
  states[39] = 2;
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  assert.deepEqual(attackTypes(decoder, scores, states, 132), []);
  setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
  const output = decoder.decode(scores, states, true, 164);
  assert.deepEqual(output.noteEvents.map(({ type }) => type), ["reOnset"]);
  assert.ok(Math.abs(output.onsets[0].confidence - 0.55) < 1e-6);
  assert.ok(Math.abs(output.onsets[0].noteConfidence - 0.95) < 1e-6);
  for (const at of [196, 228, 260]) {
    assert.deepEqual(attackTypes(decoder, scores, states, at), []);
  }
});

test("a second synthetic retrigger requires re-arming", () => {
  const decoder = new ExperimentalRetriggerDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
  attackTypes(decoder, scores, states, 100);
  states[39] = 2;
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  attackTypes(decoder, scores, states, 132);
  setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
  assert.deepEqual(attackTypes(decoder, scores, states, 164), ["reOnset"]);
  setPitchScores(scores, 39, [0.04, 0.03, 0.38, 0.25, 0.3]);
  assert.deepEqual(attackTypes(decoder, scores, states, 196), []);
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  assert.deepEqual(attackTypes(decoder, scores, states, 228), []);
  setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
  assert.deepEqual(attackTypes(decoder, scores, states, 260), ["reOnset"]);
});

test("natural attacks suppress same-frame synthesis", () => {
  const decoder = new ExperimentalRetriggerDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
  assert.deepEqual(attackTypes(decoder, scores, states, 100), ["onset"]);
  states[39] = 2;
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  attackTypes(decoder, scores, states, 132);
  states[39] = 4;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.1, 0.8]);
  assert.deepEqual(attackTypes(decoder, scores, states, 164), ["reOnset"]);
});

test("refractory boundaries are exact", () => {
  const decoder = new ExperimentalRetriggerDecoder({ ...retriggerOptions, refractoryFrames: 3 });
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
  attackTypes(decoder, scores, states, 100);
  states[39] = 2;
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  attackTypes(decoder, scores, states, 132);
  setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
  assert.deepEqual(attackTypes(decoder, scores, states, 164), []);
  assert.deepEqual(attackTypes(decoder, scores, states, 196), ["reOnset"]);
});

test("reset and signal deactivation clear detector history", () => {
  const exercise = (
    clear: (
      decoder: ExperimentalRetriggerDecoder,
      scores: Float32Array,
      states: Uint8Array,
    ) => void,
  ) => {
    const decoder = new ExperimentalRetriggerDecoder(retriggerOptions);
    const scores = new Float32Array(88 * 5);
    const states = new Uint8Array(88);
    states[39] = 3;
    setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
    attackTypes(decoder, scores, states, 100);
    states[39] = 2;
    setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
    attackTypes(decoder, scores, states, 132);
    clear(decoder, scores, states);
    setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
    assert.deepEqual(attackTypes(decoder, scores, states, 196), []);
  };
  exercise((decoder) => decoder.reset());
  exercise((decoder, scores, states) => {
    decoder.decode(scores, states, false, 164);
  });
});

test("synthetic retrigger decisions are independent of target pitches", () => {
  const left = new ExperimentalRetriggerDecoder(retriggerOptions);
  const right = new ExperimentalRetriggerDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  const decodePair = (at: number) => {
    const a = left.decode(scores, states, true, at, [60]);
    const b = right.decode(scores, states, true, at, [72]);
    return [a.noteEvents, b.noteEvents] as const;
  };
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.8, 0.1]);
  decodePair(100);
  states[39] = 2;
  setPitchScores(scores, 39, [0.05, 0.05, 0.8, 0.05, 0.05]);
  decodePair(132);
  setPitchScores(scores, 39, [0.03, 0.02, 0.4, 0.25, 0.3]);
  const [a, b] = decodePair(164);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.map(({ midi, type }) => ({ midi, type })),
    [{ midi: 60, type: "reOnset" }],
  );
});
