import assert from "node:assert/strict";
import test from "node:test";
import {
  COURSE_CLEAR_BENCHMARK_MOMENTS,
  isMathematicallyAmbiguousCase,
  summarizeListenBenchmark,
  type ListenBenchmarkTrial,
} from "./listenBenchmark";
import { LISTEN_BENCHMARK_TONE_RENDERER } from "./listenBenchmarkAudio";

function trial(update: Partial<ListenBenchmarkTrial> = {}): ListenBenchmarkTrial {
  return {
    source: "bundled",
    targetPitches: [60],
    playedPitches: [60],
    expectedCorrect: true,
    advanced: true,
    onsetToAdvanceMs: 300,
    analysisMs: 80,
    ...update,
  };
}

test("benchmark gate preserves the fixed latency, success, and false-advance criteria", () => {
  const passing = summarizeListenBenchmark([
    ...Array.from({ length: 20 }, () => trial()),
    trial({ expectedCorrect: false, advanced: false, onsetToAdvanceMs: null }),
  ]);
  assert.equal(passing.acceptance.passed, true);

  const oneMiss = summarizeListenBenchmark([
    ...Array.from({ length: 19 }, () => trial()),
    trial({ advanced: false, onsetToAdvanceMs: null }),
  ]);
  assert.equal(oneMiss.successRate, 0.95);
  assert.equal(oneMiss.acceptance.successRate, true);
  assert.equal(summarizeListenBenchmark([trial({ onsetToAdvanceMs: 400 })]).acceptance.latency, false);
  assert.equal(summarizeListenBenchmark([trial({ expectedCorrect: false })]).acceptance.falseAdvances, false);
});

test("summary retains the renderer that produced its trials", () => {
  const summary = summarizeListenBenchmark([
    trial({ renderer: { ...LISTEN_BENCHMARK_TONE_RENDERER } }),
  ]);
  assert.equal(summary.renderer.version, "bundled-piano-tone-v2");
});

test("reports exact upper-harmonic ties separately from distinguishable errors", () => {
  assert.equal(isMathematicallyAmbiguousCase([55], [55, 67]), true);
  assert.equal(isMathematicallyAmbiguousCase([48, 60, 67], [48, 60]), true);
  assert.equal(isMathematicallyAmbiguousCase([55, 67, 76], [67, 76]), false);
  assert.equal(isMathematicallyAmbiguousCase([60], [61]), false);

  const summary = summarizeListenBenchmark([
    trial({
      targetPitches: [55],
      playedPitches: [55, 67],
      expectedCorrect: false,
      mathematicallyAmbiguous: true,
    }),
  ]);
  assert.equal(summary.falseAdvanceCount, 0);
  assert.equal(summary.ambiguousAdvanceCount, 1);
  assert.equal(summary.acceptance.falseAdvances, true);
});

test("contains every playback moment and pitch from the Course Clear score", () => {
  assert.equal(COURSE_CLEAR_BENCHMARK_MOMENTS.length, 27);
  assert.deepEqual(
    [...new Set(COURSE_CLEAR_BENCHMARK_MOMENTS.flatMap(({ pitches }) => pitches))].sort((a, b) => a - b),
    [48, 50, 51, 52, 53, 55, 56, 58, 60, 62, 63, 64, 65, 67, 68, 70, 72, 74, 75, 76, 77, 79, 80, 82, 84],
  );
});

test("enforces a separate 95 percent Course Clear success gate", () => {
  const nineteenOfTwenty = summarizeListenBenchmark([
    ...Array.from({ length: 19 }, () => trial({ fixtureGroup: "course-clear" })),
    trial({ fixtureGroup: "course-clear", advanced: false, onsetToAdvanceMs: null }),
  ]);
  assert.equal(nineteenOfTwenty.courseClear.successRate, 0.95);
  assert.equal(nineteenOfTwenty.acceptance.courseClearSuccessRate, true);

  const eighteenOfTwenty = summarizeListenBenchmark([
    ...Array.from({ length: 18 }, () => trial({ fixtureGroup: "course-clear" })),
    ...Array.from({ length: 2 }, () => trial({
      fixtureGroup: "course-clear",
      advanced: false,
      onsetToAdvanceMs: null,
    })),
  ]);
  assert.equal(eighteenOfTwenty.courseClear.successRate, 0.9);
  assert.equal(eighteenOfTwenty.acceptance.courseClearSuccessRate, false);
  assert.equal(eighteenOfTwenty.acceptance.passed, false);
});
