import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import {
  decodeOnlineAmtOutput,
  OnlineAmtOutputDecoder,
  onlineAmtChordMatcherOptions,
} from "./onlineAmtOutput";

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
