import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import type { RecognizedOnset, RecognizerResult } from "./noteRecognizer";

function onset(midi: number, onsetTimeMs: number, confidence = 0.9): RecognizedOnset {
  return { midi, onsetTimeMs, confidence, noteConfidence: 0.8 };
}

function result(
  generation: number,
  capturedAtMs: number,
  onsets: RecognizedOnset[] = [],
  activePitches: number[] = onsets.map((value) => value.midi),
): RecognizerResult {
  return {
    generation,
    capturedAtMs,
    onsets,
    activePitches: activePitches.map((midi) => ({ midi, confidence: 0.8 })),
    processingTimeMs: 42,
  };
}

test("matches a fresh single note only after the settle interval", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60], 1, 0);
  assert.equal(matcher.consume(result(1, 1_000, [onset(60, 1_000)])).matched, false);
  assert.equal(matcher.consume(result(1, 1_085, [], [60])).matched, true);
});

test("matches simultaneous and briefly rolled exact chords", () => {
  const simultaneous = new ExactChordMatcher();
  simultaneous.setTarget([60, 64, 67], 1, 0);
  simultaneous.consume(result(1, 1_000, [onset(60, 1_000), onset(64, 1_000), onset(67, 1_000)]));
  assert.equal(simultaneous.consume(result(1, 1_081, [], [60, 64, 67])).matched, true);

  const rolled = new ExactChordMatcher();
  rolled.setTarget([60, 64, 67], 2, 0);
  rolled.consume(result(2, 2_000, [onset(60, 2_000)]));
  rolled.consume(result(2, 2_180, [onset(64, 2_180)]));
  rolled.consume(result(2, 2_340, [onset(67, 2_340)]));
  assert.equal(rolled.consume(result(2, 2_421, [], [60, 64, 67])).matched, true);
});

test("rejects confident extra pitches and resets the wrong attempt after silence", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(1, 1_000, [onset(60, 1_000), onset(64, 1_000), onset(67, 1_000)]));
  const rejected = matcher.consume(result(1, 1_100, [], [60, 64, 67]));
  assert.equal(rejected.matched, false);
  assert.deepEqual(rejected.extraPitches, [67]);
  assert.deepEqual(matcher.consume(result(1, 1_200)).extraPitches, []);

  matcher.consume(result(1, 1_500, [onset(60, 1_500), onset(64, 1_500)]));
  assert.equal(matcher.consume(result(1, 1_581, [], [60, 64])).matched, true);
});

test("ignores low-confidence noise and rejects octave errors", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60], 1, 0);
  matcher.consume(result(1, 1_000, [onset(67, 1_000, 0.49)]));
  matcher.consume(result(1, 1_100, [onset(60, 1_100)]));
  assert.equal(matcher.consume(result(1, 1_181, [], [60])).matched, true);

  const octave = new ExactChordMatcher();
  octave.setTarget([60], 2, 0);
  octave.consume(result(2, 2_000, [onset(72, 2_000)]));
  const update = octave.consume(result(2, 2_100, [], [72]));
  assert.equal(update.matched, false);
  assert.deepEqual(update.extraPitches, [72]);
});

test("uses note confidence to reject onset-like harmonic tails", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60], 1, 0);
  const target = { ...onset(60, 1_000), noteConfidence: 0.4 };
  const harmonic = { ...onset(72, 1_000, 0.8), noteConfidence: 0.25 };
  matcher.consume(result(1, 1_000, [target, harmonic]));
  const update = matcher.consume(result(1, 1_081, [], [60, 72]));
  assert.equal(update.matched, true);
  assert.deepEqual(update.extraPitches, []);
});

test("times out rolled notes beyond the collection window", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(1, 1_000, [onset(60, 1_000)]));
  matcher.consume(result(1, 1_450, [onset(64, 1_450)]));
  assert.equal(matcher.consume(result(1, 1_550, [], [60, 64])).matched, false);
});

test("requires fresh onsets for repeated identical target chords", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(1, 1_000, [onset(60, 1_000), onset(64, 1_000)]));
  assert.equal(matcher.consume(result(1, 1_081, [], [60, 64])).matched, true);
  assert.equal(matcher.consume(result(1, 1_300, [onset(60, 1_300), onset(64, 1_300)])).matched, false);

  matcher.setTarget([60, 64], 2, 1_300);
  assert.equal(matcher.consume(result(2, 1_450, [onset(60, 1_000), onset(64, 1_000)])).matched, false);
  matcher.consume(result(2, 1_600, [onset(60, 1_600), onset(64, 1_600)]));
  assert.equal(matcher.consume(result(2, 1_681, [], [60, 64])).matched, true);
});

test("ignores stale inference after manual navigation and mode generations", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60], 10, 0);
  matcher.setTarget([62], 11, 1_000);
  const stale = matcher.consume(result(10, 2_000, [onset(60, 2_000)]));
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.detectedTargetPitches, []);

  matcher.consume(result(11, 2_100, [onset(62, 2_100)]));
  assert.equal(matcher.consume(result(11, 2_181, [], [62])).matched, true);
});

test("never advances moments without valid pitched targets", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([], 1, 0);
  assert.equal(matcher.consume(result(1, 1_000, [onset(60, 1_000)])).matched, false);
  assert.deepEqual(matcher.consume(result(1, 1_100)).targetPitches, []);
});
