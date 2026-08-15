import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import {
  decodeOnlineAmtOutput,
  disabledOnlineAmtRetriggerOptions,
  OnlineAmtOutputDecoder,
  onlineAmtChordMatcherOptions,
  type OnlineAmtRetriggerOptions,
} from "./onlineAmtOutput";

const retriggerOptions: OnlineAmtRetriggerOptions = {
  enabled: true,
  peakThreshold: 0.45,
  riseThreshold: 0.2,
  rearmThreshold: 0.2,
  lookbackFrames: 3,
  refractoryFrames: 2,
};

function setPitchScores(
  scores: Float32Array,
  pitchIndex: number,
  values: readonly [number, number, number, number, number],
): void {
  scores.set(values, pitchIndex * 5);
}

function attackTypes(decoder: OnlineAmtOutputDecoder, scores: Float32Array, states: Uint8Array, at: number) {
  return decoder.decode(scores, states, true, at).noteEvents
    .filter(({ type }) => type !== "offset")
    .map(({ type }) => type);
}

test("decodes weighted onset and active-state confidence without changing argmax states", () => {
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.05, 0.05, 0.1, 0.7, 0.1], 39 * 5);
  states[39] = 3;

  const output = decodeOnlineAmtOutput(scores, states, true, 123);

  assert.equal(output.onsets.length, 1);
  assert.equal(output.onsets[0].midi, 60);
  assert.ok(Math.abs(output.onsets[0].confidence - 0.8) < 1e-6);
  assert.ok(Math.abs(output.onsets[0].noteConfidence - 0.9) < 1e-6);
  assert.deepEqual(output.recognizedActivePitches.map(({ midi }) => midi), [60]);
  assert.deepEqual(output.targetPitchEvidence, []);
  assert.deepEqual(output.noteStates[39], {
    midi: 60,
    state: "onset",
    confidence: output.noteStates[39].confidence,
  });
  assert.ok(Math.abs(output.noteStates[39].confidence - 0.7) < 1e-6);
  assert.deepEqual(output.noteEvents.map(({ midi, type }) => ({ midi, type })), [
    { midi: 60, type: "onset" },
  ]);
});

test("reports no events while the model silence gate is inactive", () => {
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  assert.deepEqual(
    decodeOnlineAmtOutput(scores, states, false, 123),
    {
      onsets: [],
      recognizedActivePitches: [],
      targetPitchEvidence: [],
      noteStates: Array.from({ length: 88 }, (_, pitch) => ({
        midi: pitch + 21,
        state: "off",
        confidence: 0,
      })),
      noteEvents: [],
    },
  );
});

test("exposes probability evidence for score targets even before active argmax", () => {
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.2, 0.1, 0.3, 0.25, 0.15], 39 * 5);
  states[39] = 0;

  const output = decodeOnlineAmtOutput(scores, states, true, 123, [60]);

  assert.equal(output.onsets.length, 0);
  assert.equal(output.recognizedActivePitches.length, 0);
  assert.equal(output.targetPitchEvidence.length, 1);
  assert.equal(output.targetPitchEvidence[0].midi, 60);
  assert.ok(Math.abs(output.targetPitchEvidence[0].confidence - 0.7) < 1e-6);
});

test("emits each online_amt state transition once and distinguishes re-onsets", () => {
  const decoder = new OnlineAmtOutputDecoder();
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.05, 0.1, 0.2, 0.4, 0.25], 39 * 5);

  states[39] = 3;
  assert.deepEqual(
    decoder.decode(scores, states, true, 100).noteEvents.map(({ type }) => type),
    ["onset"],
  );
  assert.deepEqual(decoder.decode(scores, states, true, 132).noteEvents, []);

  states[39] = 2;
  assert.deepEqual(decoder.decode(scores, states, true, 164).noteEvents, []);
  states[39] = 4;
  assert.deepEqual(
    decoder.decode(scores, states, true, 196).noteEvents.map(({ type }) => type),
    ["reOnset"],
  );
  assert.deepEqual(decoder.decode(scores, states, true, 228).noteEvents, []);

  states[39] = 1;
  assert.deepEqual(
    decoder.decode(scores, states, true, 260).noteEvents.map(({ type }) => type),
    ["offset"],
  );
  states[39] = 0;
  assert.deepEqual(decoder.decode(scores, states, true, 292).noteEvents, []);
});

test("emits a fast onset-to-re-onset transition without requiring sustain or release", () => {
  const decoder = new OnlineAmtOutputDecoder();
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.02, 0.02, 0.06, 0.65, 0.25], 39 * 5);

  states[39] = 3;
  assert.deepEqual(
    decoder.decode(scores, states, true, 100).noteEvents.map(({ type }) => type),
    ["onset"],
  );
  states[39] = 4;
  assert.deepEqual(
    decoder.decode(scores, states, true, 132).noteEvents.map(({ type }) => type),
    ["reOnset"],
  );
  assert.deepEqual(decoder.decode(scores, states, true, 164).noteEvents, []);

  states[39] = 3;
  assert.deepEqual(decoder.decode(scores, states, true, 196).noteEvents, []);
});

test("matcher advances consecutive repeated notes from onset-to-re-onset", () => {
  const decoder = new OnlineAmtOutputDecoder();
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  const consume = (generation: number, capturedAtMs: number) => matcher.consume({
    generation,
    ...decoder.decode(scores, states, true, capturedAtMs, [60]),
    processingTimeMs: 10,
    capturedAtMs,
  });

  matcher.setTarget([60], 1, 0);
  scores.set([0.01, 0.01, 0.01, 0.7, 0.27], 39 * 5);
  states[39] = 3;
  consume(1, 100);
  assert.equal(consume(1, 132).matched, true);

  matcher.setTarget([60], 2, 132);
  scores.set([0.01, 0.01, 0.01, 0.2, 0.77], 39 * 5);
  states[39] = 4;
  assert.equal(consume(2, 164).matched, false);

  scores.set([0.02, 0.02, 0.9, 0.03, 0.03], 39 * 5);
  states[39] = 2;
  assert.equal(consume(2, 196).matched, true);
});

test("resets transition history alongside the streaming model", () => {
  const decoder = new OnlineAmtOutputDecoder();
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.05, 0.05, 0.1, 0.7, 0.1], 39 * 5);
  states[39] = 3;

  decoder.decode(scores, states, true, 100);
  assert.deepEqual(decoder.decode(scores, states, true, 132).noteEvents, []);
  decoder.reset();
  assert.deepEqual(
    decoder.decode(scores, states, true, 164).noteEvents.map(({ type }) => type),
    ["onset"],
  );
});

test("disabled retrigger options preserve the production decoder exactly", () => {
  const production = new OnlineAmtOutputDecoder();
  const disabled = new OnlineAmtOutputDecoder(disabledOnlineAmtRetriggerOptions);
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
  const decoder = new OnlineAmtOutputDecoder(retriggerOptions);
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  setPitchScores(scores, 39, [0.02, 0.02, 0.06, 0.75, 0.15]);
  assert.deepEqual(attackTypes(decoder, scores, states, 100), ["onset"]);
  states[39] = 2;
  setPitchScores(scores, 39, [0.03, 0.02, 0.45, 0.25, 0.25]);
  assert.deepEqual(attackTypes(decoder, scores, states, 132), []);
  for (const at of [164, 196, 228, 260]) {
    setPitchScores(scores, 39, [0.03, 0.02, 0.45, 0.25, 0.25]);
    assert.deepEqual(attackTypes(decoder, scores, states, at), []);
  }
});

test("a qualifying sustain-state rise creates one synthetic re-onset and a plateau cannot duplicate it", () => {
  const decoder = new OnlineAmtOutputDecoder(retriggerOptions);
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
  const decoder = new OnlineAmtOutputDecoder(retriggerOptions);
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
  const decoder = new OnlineAmtOutputDecoder(retriggerOptions);
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
  const decoder = new OnlineAmtOutputDecoder({ ...retriggerOptions, refractoryFrames: 3 });
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
  const exercise = (clear: (decoder: OnlineAmtOutputDecoder, scores: Float32Array, states: Uint8Array) => void) => {
    const decoder = new OnlineAmtOutputDecoder(retriggerOptions);
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
  const left = new OnlineAmtOutputDecoder(retriggerOptions);
  const right = new OnlineAmtOutputDecoder(retriggerOptions);
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
  assert.deepEqual(a.map(({ midi, type }) => ({ midi, type })), [{ midi: 60, type: "reOnset" }]);
});

test("silence-gate closure clears active states and emits one offset", () => {
  const decoder = new OnlineAmtOutputDecoder();
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.05, 0.05, 0.8, 0.05, 0.05], 39 * 5);
  states[39] = 2;

  const active = decoder.decode(scores, states, true, 100);
  assert.deepEqual(active.recognizedActivePitches.map(({ midi }) => midi), [60]);

  const inactive = decoder.decode(scores, states, false, 132);
  assert.deepEqual(inactive.recognizedActivePitches, []);
  assert.equal(inactive.noteStates[39].state, "off");
  assert.deepEqual(inactive.noteEvents.map(({ midi, type }) => ({ midi, type })), [
    { midi: 60, type: "offset" },
  ]);
  assert.deepEqual(decoder.decode(scores, states, false, 164).noteEvents, []);
});

test("online_amt matcher profile ignores a weak extra while matching a confident target", () => {
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  matcher.setTarget([60], 1, 0);
  matcher.consume({
    generation: 1,
    onsets: [
      { midi: 60, confidence: 0.8, noteConfidence: 0.8, onsetTimeMs: 200 },
      { midi: 61, confidence: 0.8, noteConfidence: 0.95, onsetTimeMs: 200 },
    ],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    processingTimeMs: 10,
    capturedAtMs: 200,
  });
  const settled = matcher.consume({
    generation: 1,
    onsets: [],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    processingTimeMs: 10,
    capturedAtMs: 300,
  });
  assert.equal(settled.matched, true);
  assert.deepEqual(settled.extraPitches, []);
});

test("online_amt matcher profile settles after one 32 ms audio frame", () => {
  assert.equal(onlineAmtChordMatcherOptions.refractoryMode, "noteEvents");
  assert.equal(onlineAmtChordMatcherOptions.settleMs, 32);

  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  matcher.setTarget([60], 1, 0);
  matcher.consume({
    generation: 1,
    onsets: [
      { midi: 60, confidence: 0.8, noteConfidence: 0.8, onsetTimeMs: 100 },
    ],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteEvents: [
      { midi: 60, type: "onset", confidence: 0.8, eventTimeMs: 100 },
    ],
    processingTimeMs: 10,
    capturedAtMs: 100,
  });
  assert.equal(matcher.consume({
    generation: 1,
    onsets: [],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteEvents: [],
    processingTimeMs: 10,
    capturedAtMs: 131,
  }).matched, false);
  assert.equal(matcher.consume({
    generation: 1,
    onsets: [],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteEvents: [],
    processingTimeMs: 10,
    capturedAtMs: 132,
  }).matched, true);
});

test("online_amt matcher still catches an extra note in the settle frame", () => {
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  matcher.setTarget([60], 1, 0);
  matcher.consume({
    generation: 1,
    onsets: [
      { midi: 60, confidence: 0.8, noteConfidence: 0.8, onsetTimeMs: 100 },
    ],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteEvents: [
      { midi: 60, type: "onset", confidence: 0.8, eventTimeMs: 100 },
    ],
    processingTimeMs: 10,
    capturedAtMs: 100,
  });
  const update = matcher.consume({
    generation: 1,
    onsets: [
      { midi: 61, confidence: 0.99, noteConfidence: 0.99, onsetTimeMs: 132 },
    ],
    recognizedActivePitches: [
      { midi: 60, confidence: 0.8 },
      { midi: 61, confidence: 0.99 },
    ],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteEvents: [
      { midi: 61, type: "onset", confidence: 0.99, eventTimeMs: 132 },
    ],
    processingTimeMs: 10,
    capturedAtMs: 132,
  });
  assert.equal(update.matched, false);
  assert.deepEqual(update.extraPitches, [61]);
});

test("sub-threshold target evidence cannot start a matching attempt", () => {
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  matcher.setTarget([60], 1, 0);
  const update = matcher.consume({
    generation: 1,
    onsets: [
      { midi: 60, confidence: 0.53, noteConfidence: 0.8, onsetTimeMs: 200 },
    ],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    processingTimeMs: 10,
    capturedAtMs: 300,
  });
  assert.equal(update.matched, false);
  assert.deepEqual(update.detectedTargetPitches, []);
});
