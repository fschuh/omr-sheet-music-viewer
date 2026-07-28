import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import type {
  RecognizedNoteEventType,
  RecognizedOnset,
  RecognizerResult,
} from "./noteRecognizer";

function onset(midi: number, onsetTimeMs: number, confidence = 0.9): RecognizedOnset {
  return { midi, onsetTimeMs, confidence, noteConfidence: 0.8 };
}

function result(
  generation: number,
  capturedAtMs: number,
  onsets: RecognizedOnset[] = [],
  activePitches: number[] = onsets.map((value) => value.midi),
  targetEvidencePitches: number[] = activePitches,
): RecognizerResult {
  return {
    generation,
    capturedAtMs,
    onsets,
    recognizedActivePitches: activePitches.map((midi) => ({ midi, confidence: 0.8 })),
    targetPitchEvidence: targetEvidencePitches.map((midi) => ({ midi, confidence: 0.8 })),
    processingTimeMs: 42,
  };
}

function eventResult(
  generation: number,
  capturedAtMs: number,
  onsets: RecognizedOnset[] = [],
  events: Array<{ midi: number; type: RecognizedNoteEventType }> = [],
  activePitches: number[] = onsets.map((value) => value.midi),
  targetEvidencePitches: number[] = activePitches,
): RecognizerResult {
  return {
    ...result(
      generation,
      capturedAtMs,
      onsets,
      activePitches,
      targetEvidencePitches,
    ),
    noteEvents: events.map(({ midi, type }) => ({
      midi,
      type,
      confidence: 0.9,
      eventTimeMs: capturedAtMs,
    })),
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

test("uses stable target evidence after one fresh chord attack", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64, 67], 1, 0);
  matcher.consume(result(1, 1_000, [onset(60, 1_000)], [60], [60, 64, 67]));
  const collected = matcher.consume(result(1, 1_050, [], [60], [60, 64, 67]));
  assert.deepEqual(collected.detectedTargetPitches, [60, 64, 67]);
  assert.equal(matcher.consume(result(1, 1_135, [], [60], [60, 64, 67])).matched, true);
});

test("requires a fresh bass onset for a three-note chord", () => {
  const matcher = new ExactChordMatcher({ refractoryMs: 0 });
  matcher.setTarget([55, 67, 76], 1, 0);
  matcher.consume(result(1, 100, [onset(67, 100), onset(76, 100)]));
  const activeOnlyBass = matcher.consume(result(1, 200, [], [55, 67, 76]));
  assert.equal(activeOnlyBass.matched, false);
  assert.deepEqual(activeOnlyBass.detectedTargetPitches, [67, 76]);

  matcher.consume(result(1, 220, [onset(55, 220)], [55, 67, 76]));
  assert.equal(matcher.consume(result(1, 301, [], [55, 67, 76])).matched, true);
});

test("stable pitches cannot start an attempt without a fresh onset", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([48, 60, 67], 1, 0);
  assert.equal(matcher.consume(result(1, 1_000, [], [48, 60, 67])).matched, false);
  assert.deepEqual(
    matcher.consume(result(1, 1_200, [], [48, 60, 67])).detectedTargetPitches,
    [],
  );
});

test("low-confidence active evidence cannot complete a chord", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(1, 1_000, [onset(60, 1_000)], [60]));
  const weak: RecognizerResult = {
    ...result(1, 1_050, [], [60]),
    targetPitchEvidence: [
      { midi: 60, confidence: 0.8 },
      { midi: 64, confidence: 0.34 },
    ],
  };
  assert.equal(matcher.consume(weak).matched, false);
  assert.deepEqual(matcher.consume(result(1, 1_135, [], [60])).detectedTargetPitches, [60]);
});

test("rejects confident extra pitches and resets the wrong attempt after the retry interval", () => {
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

test("sustained pitches do not keep a rejected onset alive", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(
    1,
    1_000,
    [onset(60, 1_000), onset(64, 1_000), onset(67, 1_000)],
  ));

  const sustained: RecognizerResult = {
    ...result(1, 1_200),
    recognizedActivePitches: [
      { midi: 60, confidence: 0.9 },
      { midi: 64, confidence: 0.9 },
      { midi: 67, confidence: 0.9 },
    ],
    targetPitchEvidence: [
      { midi: 60, confidence: 0.9 },
      { midi: 64, confidence: 0.9 },
    ],
  };
  const cleared = matcher.consume(sustained);
  assert.deepEqual(cleared.detectedTargetPitches, []);
  assert.deepEqual(cleared.extraPitches, []);

  matcher.consume(result(1, 1_500, [onset(60, 1_500), onset(64, 1_500)]));
  assert.equal(matcher.consume(result(1, 1_581, [], [60, 64])).matched, true);
});

test("a later correct onset starts clean without an intervening silence frame", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60, 64], 1, 0);
  matcher.consume(result(
    1,
    1_000,
    [onset(60, 1_000), onset(64, 1_000), onset(67, 1_000)],
  ));

  matcher.consume({
    ...result(1, 1_250, [onset(60, 1_250), onset(64, 1_250)]),
    recognizedActivePitches: [
      { midi: 60, confidence: 0.9 },
      { midi: 64, confidence: 0.9 },
      { midi: 67, confidence: 0.9 },
    ],
  });
  const settled = matcher.consume({
    ...result(1, 1_331, [], [60, 64]),
    recognizedActivePitches: [
      { midi: 60, confidence: 0.9 },
      { midi: 64, confidence: 0.9 },
      { midi: 67, confidence: 0.9 },
    ],
  });
  assert.equal(settled.matched, true);
  assert.deepEqual(settled.extraPitches, []);
});

test("ignores low-confidence noise and cannot anchor on an upper-harmonic tie", () => {
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
  assert.deepEqual(update.extraPitches, []);
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

test("anchors on targets, scopes distinguishable extras to one onset, and prefers harmonic targets", () => {
  const transient = new ExactChordMatcher();
  transient.setTarget([60], 1, 0);
  transient.consume(result(1, 900, [onset(72, 900)]));
  transient.consume(result(1, 1_000, [onset(60, 1_000)]));
  assert.equal(transient.consume(result(1, 1_081, [], [60])).matched, true);

  const simultaneousExtra = new ExactChordMatcher();
  simultaneousExtra.setTarget([60], 2, 0);
  simultaneousExtra.consume(result(2, 1_980, [onset(72, 1_980)]));
  simultaneousExtra.consume(result(2, 2_000, [onset(60, 2_000)]));
  const update = simultaneousExtra.consume(result(2, 2_081, [], [60, 72]));
  assert.equal(update.matched, true);
  assert.deepEqual(update.extraPitches, []);

  const sameOnsetExtra = new ExactChordMatcher();
  sameOnsetExtra.setTarget([60], 3, 0);
  sameOnsetExtra.consume(result(3, 2_980, [onset(67, 2_980)]));
  sameOnsetExtra.consume(result(3, 3_000, [onset(60, 3_000)]));
  assert.equal(sameOnsetExtra.consume(result(3, 3_081, [], [60, 67])).matched, false);

  const previousOnsetExtra = new ExactChordMatcher();
  previousOnsetExtra.setTarget([60], 4, 0);
  previousOnsetExtra.consume(result(4, 3_900, [onset(67, 3_900)]));
  previousOnsetExtra.consume(result(4, 4_000, [onset(60, 4_000)]));
  assert.equal(previousOnsetExtra.consume(result(4, 4_081, [], [60, 67])).matched, true);
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

test("note-event refractory accepts a different next note immediately", () => {
  const matcher = new ExactChordMatcher({
    refractoryMode: "noteEvents",
    settleMs: 32,
  });
  matcher.setTarget([60], 1, 0);
  matcher.consume(eventResult(
    1,
    100,
    [onset(60, 100)],
    [{ midi: 60, type: "onset" }],
  ));
  assert.equal(matcher.consume(eventResult(1, 132, [], [], [60])).matched, true);

  matcher.setTarget([62], 2, 132);
  matcher.consume(eventResult(
    2,
    150,
    [onset(62, 150)],
    [{ midi: 62, type: "onset" }],
    [60, 62],
  ));
  assert.equal(matcher.consume(eventResult(2, 181, [], [], [60, 62])).matched, false);
  assert.equal(matcher.consume(eventResult(2, 182, [], [], [60, 62])).matched, true);
});

test("note-event refractory cannot reuse a held attack after advancing", () => {
  const matcher = new ExactChordMatcher({
    refractoryMode: "noteEvents",
    settleMs: 32,
  });
  matcher.setTarget([60], 1, 0);
  matcher.consume(eventResult(
    1,
    100,
    [onset(60, 100)],
    [{ midi: 60, type: "onset" }],
  ));
  assert.equal(matcher.consume(eventResult(1, 132, [], [], [60])).matched, true);

  matcher.setTarget([60], 2, 132);
  const held = matcher.consume(eventResult(
    2,
    160,
    [onset(60, 160)],
    [],
    [60],
  ));
  assert.equal(held.matched, false);
  assert.deepEqual(held.detectedTargetPitches, []);
  assert.equal(matcher.consume(eventResult(
    2,
    320,
    [onset(60, 320)],
    [],
    [60],
  )).matched, false);

  matcher.consume(eventResult(
    2,
    340,
    [],
    [{ midi: 60, type: "offset" }],
    [],
  ));
  matcher.consume(eventResult(
    2,
    350,
    [onset(60, 350)],
    [{ midi: 60, type: "onset" }],
    [60],
  ));
  assert.equal(matcher.consume(eventResult(2, 382, [], [], [60])).matched, true);
});

test("note-event refractory accepts a re-onset without waiting for an offset", () => {
  const matcher = new ExactChordMatcher({
    refractoryMode: "noteEvents",
    settleMs: 32,
  });
  matcher.setTarget([60], 1, 0);
  matcher.consume(eventResult(
    1,
    100,
    [onset(60, 100)],
    [{ midi: 60, type: "onset" }],
  ));
  assert.equal(matcher.consume(eventResult(1, 132, [], [], [60])).matched, true);

  matcher.setTarget([60], 2, 132);
  matcher.consume(eventResult(
    2,
    150,
    [onset(60, 150)],
    [{ midi: 60, type: "reOnset" }],
    [60],
  ));
  assert.equal(matcher.consume(eventResult(2, 182, [], [], [60])).matched, true);
});

test("time-based recognizers retain the refractory interval", () => {
  const matcher = new ExactChordMatcher();
  matcher.setTarget([60], 1, 1_000);
  assert.equal(
    matcher.consume(result(1, 1_100, [onset(60, 1_100)])).matched,
    false,
  );
  assert.deepEqual(
    matcher.consume(result(1, 1_181, [], [60])).detectedTargetPitches,
    [],
  );

  matcher.consume(result(1, 1_200, [onset(60, 1_200)]));
  assert.equal(matcher.consume(result(1, 1_281, [], [60])).matched, true);
});

test("ignores stale analysis after manual navigation and mode generations", () => {
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
