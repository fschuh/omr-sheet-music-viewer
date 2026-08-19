import assert from "node:assert/strict";
import test from "node:test";
import {
  COURSE_CLEAR_BENCHMARK_MOMENTS,
  SPECTRAL_ISOLATED_MATCHER_IDENTITY,
  isMathematicallyAmbiguousCase,
  listenBenchmarkMatcherIdentity,
  summarizeListenBenchmark,
  type ListenBenchmarkMatcherIdentity,
  type ListenBenchmarkTrial,
} from "./listenBenchmark";
import { LISTEN_BENCHMARK_TONE_RENDERER } from "./listenBenchmarkAudio";
import {
  LISTEN_MATCHER_PROFILES,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";

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

test("every isolated summary names the matcher its trials ran under", () => {
  // The historical online-AMT corpus belongs to baseline-v1 by name, not to
  // whichever profile production happens to default to later.
  const historical = summarizeListenBenchmark([trial()]);
  assert.equal(historical.matcher.profileId, "baseline-v1");
  assert.deepEqual(
    historical.matcher.thresholds,
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );

  const candidate = summarizeListenBenchmark(
    [trial()],
    listenBenchmarkMatcherIdentity("early-open-v2"),
  );
  assert.equal(candidate.matcher.profileId, "early-open-v2");
  assert.equal(candidate.matcher.thresholds.onsetThreshold, 0.45);

  // The spectral path predates the registry and records its own defaults.
  assert.equal(SPECTRAL_ISOLATED_MATCHER_IDENTITY.profileId, "chord-matcher-defaults");
  assert.equal(
    summarizeListenBenchmark([trial()], SPECTRAL_ISOLATED_MATCHER_IDENTITY).matcher.profileId,
    "chord-matcher-defaults",
  );

  assert.throws(
    () => listenBenchmarkMatcherIdentity("balanced-v2" as ListenMatcherProfileId),
    /Unknown listen matcher profile identifier/,
  );
  assert.throws(
    () => summarizeListenBenchmark(
      [trial()],
      { profileId: "made-up", thresholds: listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]) } as unknown as ListenBenchmarkMatcherIdentity,
    ),
    /Invalid listen benchmark matcher identity/,
  );
  assert.throws(
    () => summarizeListenBenchmark(
      [trial()],
      { profileId: "baseline-v1", thresholds: { onsetThreshold: 2 } } as unknown as ListenBenchmarkMatcherIdentity,
    ),
    /Invalid listen benchmark matcher identity/,
  );
});
