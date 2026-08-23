import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTEN_PROFILE_VALIDATION_POLICY,
  LISTEN_PROFILE_VALIDATION_POLICY_VERSION,
  LISTEN_PROMOTION_MATERIAL_IMPROVEMENT,
  LISTEN_RECOGNITION_TARGET_COUNT_ROUNDING,
  LISTEN_RECOGNITION_TARGET_RATES,
  assessListenMaterialLatencyReduction,
  assessListenMaterialRateGain,
  assessListenPairedCorrectness,
  assessListenRecognitionTarget,
  listenRecognitionTargetCount,
  unappliedRequiredListenGateCodes,
  validateListenProfileValidationPolicy,
  type ListenProfileValidationPolicy,
} from "./listenProfileValidationPolicy";

test("freezes one immutable round-two policy version", () => {
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY_VERSION, 1);
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY.version, 1);
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY.correctnessEligibility, "paired-non-regression");
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY.absoluteTargetsAre, "product-debt");
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY.safetyGatesAreAbsolute, true);
  assert.equal(LISTEN_PROFILE_VALIDATION_POLICY.completeRunsFailClosed, true);
  assert.equal(Object.isFrozen(LISTEN_PROFILE_VALIDATION_POLICY), true);
  assert.equal(Object.isFrozen(LISTEN_RECOGNITION_TARGET_RATES), true);
  assert.equal(Object.isFrozen(LISTEN_PROMOTION_MATERIAL_IMPROVEMENT), true);
  assert.deepEqual(validateListenProfileValidationPolicy(), []);
});

test("rejects an unknown or amended policy version", () => {
  assert.deepEqual(
    validateListenProfileValidationPolicy({
      ...LISTEN_PROFILE_VALIDATION_POLICY,
      version: LISTEN_PROFILE_VALIDATION_POLICY_VERSION + 1,
    }).map(({ code }) => code),
    ["unknown-policy-version"],
  );
  assert.deepEqual(
    validateListenProfileValidationPolicy({
      ...LISTEN_PROFILE_VALIDATION_POLICY,
      materialImprovement: {
        ...LISTEN_PROMOTION_MATERIAL_IMPROVEMENT,
        minimumRateGain: 0.005,
      },
    } as unknown as ListenProfileValidationPolicy).map(({ code }) => code),
    ["policy-contract-mismatch"],
  );
});

test("derives counts by ceiling and reproduces the round-one absolute targets", () => {
  assert.equal(LISTEN_RECOGNITION_TARGET_COUNT_ROUNDING, "ceiling");
  assert.equal(listenRecognitionTargetCount(0.98, 106), 104);
  assert.equal(listenRecognitionTargetCount(0.95, 106), 101);
  assert.equal(listenRecognitionTargetCount(0.95, 54), 52);
  assert.equal(listenRecognitionTargetCount(0.95, 0), 0);
  assert.throws(() => listenRecognitionTargetCount(1.01, 106), /outside \[0, 1\]/);
  assert.throws(() => listenRecognitionTargetCount(0.95, 10.5), /safe integer/);
});

test("reports the incumbent's target debt without making it correctness eligibility", () => {
  const overall = assessListenRecognitionTarget({
    rendererKey: "tone",
    metric: "isolated-correct-advance-rate",
    observedCount: 100,
    census: 106,
  });
  const courseClear = assessListenRecognitionTarget({
    rendererKey: "tone",
    metric: "course-clear-correct-advance-rate",
    observedCount: 48,
    census: 54,
  });
  assert.deepEqual(
    [overall.targetCount, overall.debtCount, courseClear.targetCount, courseClear.debtCount],
    [101, 1, 52, 4],
  );
  assert.equal(overall.reached, false);
  assert.equal(courseClear.reached, false);

  // Self-comparison is eligible even while the product debt remains visible.
  const paired = assessListenPairedCorrectness({
    rendererKey: "tone",
    metric: "isolated-correct-advance-rate",
    census: 106,
    baselineCount: 100,
    profileCount: 100,
  });
  assert.equal(paired.passed, true);
  assert.equal(paired.deltaCount, 0);
});

test("freezes a one-point or one-hop material improvement boundary", () => {
  assert.equal(LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumRateGain, 0.01);
  assert.equal(LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.rateComparisonEpsilon, 1e-12);
  assert.equal(LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumLatencyReductionMs, 32);
  assert.equal(LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.latencyComparisonEpsilonMs, 1e-9);
  // These rates are derived exactly as benchmark rates are: integer counts
  // divided by a census. Binary subtraction puts the same 1/100 gain on
  // opposite sides of 0.01 without the frozen representation epsilon.
  assert.equal(assessListenMaterialRateGain("rate", 56 / 100, 57 / 100).material, true);
  assert.equal(assessListenMaterialRateGain("rate", 55 / 100, 56 / 100).material, true);
  assert.equal(assessListenMaterialRateGain("rate", 56 / 100, 56.999999 / 100).material, false);
  assert.equal(assessListenMaterialLatencyReduction("latency", 228, 196.001).material, false);
  assert.equal(assessListenMaterialLatencyReduction("latency", 228, 196).material, true);
  assert.equal(
    assessListenMaterialLatencyReduction("latency", 1_000 / 3, 1_000 / 3 - 32).material,
    true,
  );
});

test("a complete run fails closed on every unapplied required gate", () => {
  const gates = [
    { code: "safety", applied: true },
    { code: "correctness", applied: false },
  ];
  assert.deepEqual(unappliedRequiredListenGateCodes(false, gates), []);
  assert.deepEqual(unappliedRequiredListenGateCodes(true, gates), ["correctness"]);
});
