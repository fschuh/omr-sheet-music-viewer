import assert from "node:assert/strict";
import test from "node:test";
import { summarizeListenBenchmark, type ListenBenchmarkTrial } from "./listenBenchmark";

function trial(update: Partial<ListenBenchmarkTrial> = {}): ListenBenchmarkTrial {
  return {
    source: "bundled",
    targetPitches: [60],
    playedPitches: [60],
    expectedCorrect: true,
    advanced: true,
    onsetToAdvanceMs: 300,
    inferenceMs: 80,
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

