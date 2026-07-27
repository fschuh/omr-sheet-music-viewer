import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import {
  decodeOnlineAmtOutput,
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
  assert.deepEqual(output.activePitches.map(({ midi }) => midi), [60]);
});

test("reports no events while the model silence gate is inactive", () => {
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  states[39] = 3;
  assert.deepEqual(
    decodeOnlineAmtOutput(scores, states, false, 123),
    { onsets: [], activePitches: [] },
  );
});

test("exposes probability evidence for score targets even before active argmax", () => {
  const scores = new Float32Array(88 * 5);
  const states = new Uint8Array(88);
  scores.set([0.2, 0.1, 0.3, 0.25, 0.15], 39 * 5);
  states[39] = 0;

  const output = decodeOnlineAmtOutput(scores, states, true, 123, [60]);

  assert.equal(output.onsets.length, 0);
  assert.equal(output.activePitches.length, 1);
  assert.equal(output.activePitches[0].midi, 60);
  assert.ok(Math.abs(output.activePitches[0].confidence - 0.7) < 1e-6);
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
    activePitches: [{ midi: 60, confidence: 0.8 }],
    processingTimeMs: 10,
    capturedAtMs: 200,
  });
  const settled = matcher.consume({
    generation: 1,
    onsets: [],
    activePitches: [{ midi: 60, confidence: 0.8 }],
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
    activePitches: [{ midi: 60, confidence: 0.8 }],
    processingTimeMs: 10,
    capturedAtMs: 300,
  });
  assert.equal(update.matched, false);
  assert.deepEqual(update.detectedTargetPitches, []);
});
