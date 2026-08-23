/**
 * Corpus-independent release policy for the second matcher discovery round.
 *
 * Round one mixed two different questions.  Its isolated count floors were
 * eligibility gates for challengers, even though the incumbent missed the Tone
 * floors itself.  This policy separates the questions deliberately:
 *
 * - safety is still a required, fail-closed gate;
 * - correctness eligibility is paired non-regression against `baseline-v1` on
 *   the identical corpus;
 * - absolute recognition targets are product debt, reported for the incumbent
 *   and every challenger, rather than challenger-only eligibility floors;
 * - promotion needs a material measured improvement in addition to eligibility.
 *
 * This module owns no corpus census.  A manifest binds these rates to its own
 * frozen census by calling `listenRecognitionTargetCount`; changing the corpus
 * therefore cannot silently turn an old absolute count into a new policy.
 */

import type { ListenTraceRendererKey } from "./listenTraceManifest";

/** Bumped by editing this module whenever any policy rule or boundary changes. */
export const LISTEN_PROFILE_VALIDATION_POLICY_VERSION = 1;

export const LISTEN_PROFILE_VALIDATION_POLICY_RATIONALE =
  "Round one's isolated release floors applied only to challengers. baseline-v1 measured " +
  "100/106 overall and 48/54 on Course Clear under Tone while the challenger floors were " +
  "101/106 and 52/54; the open v2 pair improved those results to 102/106 and 50/54 but was " +
  "still rejected by the challenger-only Course Clear floor. Round two keeps safety " +
  "absolute, makes correctness eligibility paired non-regression, reports the absolute " +
  "targets as product debt, and requires a separate material gain for promotion.";

export const LISTEN_PROFILE_VALIDATION_POLICY_AMENDMENT_RULE =
  "A policy version never changes in place. Change a target, rounding rule, materiality " +
  "boundary, required-gate rule, or eligibility meaning only by editing this module, bumping " +
  "LISTEN_PROFILE_VALIDATION_POLICY_VERSION, and re-running discovery before reading new " +
  "confirmation outcomes. A caller-supplied version is an identity to validate, not a way to " +
  "select old or unregistered semantics.";

export type ListenRecognitionTargetMetric =
  | "isolated-correct-advance-rate"
  | "course-clear-correct-advance-rate";

export interface ListenRecognitionTargetRates {
  isolatedCorrectAdvanceRate: number;
  courseClearCorrectAdvanceRate: number;
}

/**
 * The round-one absolute floors expressed as corpus-independent rates.
 *
 * With the version-1 census and the frozen ceiling rule these reproduce Direct
 * 104/106, Tone 101/106, and Course Clear 52/54 under both renderers.  They no
 * longer decide challenger eligibility; they state the product target and its
 * remaining debt for every profile, including the incumbent.
 */
export const LISTEN_RECOGNITION_TARGET_RATES: Readonly<
  Record<ListenTraceRendererKey, Readonly<ListenRecognitionTargetRates>>
> = Object.freeze({
  direct: Object.freeze({
    isolatedCorrectAdvanceRate: 0.98,
    courseClearCorrectAdvanceRate: 0.95,
  }),
  tone: Object.freeze({
    isolatedCorrectAdvanceRate: 0.95,
    courseClearCorrectAdvanceRate: 0.95,
  }),
});

/** Counts are always the smallest integer that reaches the target rate. */
export const LISTEN_RECOGNITION_TARGET_COUNT_ROUNDING = "ceiling" as const;

/**
 * Predeclared promotion materiality, independent of any corpus census.
 *
 * Rate gains cover recognition, ordered progress, and complete-passage rates.
 * One decoder hop is the smallest expressible latency movement.  A profile may
 * also qualify by removing one unsafe event while passing every absolute safety
 * gate; safety regressions can never be traded for a correctness gain.
 */
export const LISTEN_PROMOTION_MATERIAL_IMPROVEMENT = Object.freeze({
  minimumRateGain: 0.01,
  /** Large enough for binary subtraction noise, far below any measured event-rate step. */
  rateComparisonEpsilon: 1e-12,
  minimumLatencyReductionMs: 32,
  /** Scheduled thirds and frame timestamps can leave sub-nanosecond subtraction noise. */
  latencyComparisonEpsilonMs: 1e-9,
  minimumUnsafeEventReduction: 1,
});

export interface ListenProfileValidationPolicy {
  version: number;
  rationale: string;
  amendmentRule: string;
  targetCountRounding: typeof LISTEN_RECOGNITION_TARGET_COUNT_ROUNDING;
  recognitionTargetRates: typeof LISTEN_RECOGNITION_TARGET_RATES;
  materialImprovement: typeof LISTEN_PROMOTION_MATERIAL_IMPROVEMENT;
  safetyGatesAreAbsolute: true;
  correctnessEligibility: "paired-non-regression";
  absoluteTargetsAre: "product-debt";
  completeRunsFailClosed: true;
}

/** The only policy version this build knows how to evaluate. */
export const LISTEN_PROFILE_VALIDATION_POLICY: Readonly<ListenProfileValidationPolicy> =
  Object.freeze({
    version: LISTEN_PROFILE_VALIDATION_POLICY_VERSION,
    rationale: LISTEN_PROFILE_VALIDATION_POLICY_RATIONALE,
    amendmentRule: LISTEN_PROFILE_VALIDATION_POLICY_AMENDMENT_RULE,
    targetCountRounding: LISTEN_RECOGNITION_TARGET_COUNT_ROUNDING,
    recognitionTargetRates: LISTEN_RECOGNITION_TARGET_RATES,
    materialImprovement: LISTEN_PROMOTION_MATERIAL_IMPROVEMENT,
    safetyGatesAreAbsolute: true,
    correctnessEligibility: "paired-non-regression",
    absoluteTargetsAre: "product-debt",
    completeRunsFailClosed: true,
  });

export type ListenProfileValidationPolicyProblemCode =
  | "unknown-policy-version"
  | "policy-contract-mismatch";

export interface ListenProfileValidationPolicyProblem {
  code: ListenProfileValidationPolicyProblemCode;
  explanation: string;
}

function sameFrozenValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Rejects a relabelled or amended policy object.
 *
 * Unknown versions fail before field comparison, matching the trace manifest's
 * versioning semantics: this build contains one reviewed policy, not a caller-
 * selectable collection of historical implementations.
 */
export function validateListenProfileValidationPolicy(
  policy: ListenProfileValidationPolicy = LISTEN_PROFILE_VALIDATION_POLICY,
): ListenProfileValidationPolicyProblem[] {
  if (policy.version !== LISTEN_PROFILE_VALIDATION_POLICY_VERSION) {
    return [{
      code: "unknown-policy-version",
      explanation: `Policy version ${policy.version} is not the declared version ` +
        `${LISTEN_PROFILE_VALIDATION_POLICY_VERSION}. ` +
        LISTEN_PROFILE_VALIDATION_POLICY_AMENDMENT_RULE,
    }];
  }
  const fields: Array<keyof ListenProfileValidationPolicy> = [
    "rationale",
    "amendmentRule",
    "targetCountRounding",
    "recognitionTargetRates",
    "materialImprovement",
    "safetyGatesAreAbsolute",
    "correctnessEligibility",
    "absoluteTargetsAre",
    "completeRunsFailClosed",
  ];
  const mismatched = fields.filter((field) => (
    !sameFrozenValue(policy[field], LISTEN_PROFILE_VALIDATION_POLICY[field])
  ));
  return mismatched.length === 0
    ? []
    : [{
      code: "policy-contract-mismatch",
      explanation: `Policy version ${policy.version} changes frozen field(s) ` +
        `${mismatched.join(", ")}. ${LISTEN_PROFILE_VALIDATION_POLICY_AMENDMENT_RULE}`,
    }];
}

export function assertValidListenProfileValidationPolicy(
  policy: ListenProfileValidationPolicy = LISTEN_PROFILE_VALIDATION_POLICY,
): void {
  const problems = validateListenProfileValidationPolicy(policy);
  if (problems.length > 0) {
    throw new Error(`Invalid listen profile validation policy: ${problems
      .map(({ code, explanation }) => `${code}: ${explanation}`).join(" ")}`);
  }
}

function assertRate(rate: number, label: string): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`${label} ${rate} is outside [0, 1].`);
  }
}

function assertCensus(census: number): void {
  if (!Number.isSafeInteger(census) || census < 0) {
    throw new Error(`Recognition census ${census} is not a non-negative safe integer.`);
  }
}

/** Binds one frozen rate to a manifest-owned census using the frozen rule. */
export function listenRecognitionTargetCount(targetRate: number, census: number): number {
  assertRate(targetRate, "Recognition target rate");
  assertCensus(census);
  return Math.ceil(targetRate * census);
}

export interface ListenRecognitionTargetAssessment {
  rendererKey: ListenTraceRendererKey;
  metric: ListenRecognitionTargetMetric;
  targetRate: number;
  census: number;
  targetCount: number;
  observedCount: number;
  observedRate: number;
  reached: boolean;
  /** Zero at or above target; otherwise the number of additional advances owed. */
  debtCount: number;
  /** Zero at or above target; otherwise the remaining fractional rate. */
  debtRate: number;
}

/** Reports an absolute target and debt without turning either into eligibility. */
export function assessListenRecognitionTarget(input: {
  rendererKey: ListenTraceRendererKey;
  metric: ListenRecognitionTargetMetric;
  observedCount: number;
  census: number;
}): ListenRecognitionTargetAssessment {
  assertCensus(input.census);
  if (!Number.isSafeInteger(input.observedCount) || input.observedCount < 0 ||
      input.observedCount > input.census) {
    throw new Error(
      `Observed recognition count ${input.observedCount} is outside census ${input.census}.`,
    );
  }
  const rates = LISTEN_RECOGNITION_TARGET_RATES[input.rendererKey];
  const targetRate = input.metric === "isolated-correct-advance-rate"
    ? rates.isolatedCorrectAdvanceRate
    : rates.courseClearCorrectAdvanceRate;
  const targetCount = listenRecognitionTargetCount(targetRate, input.census);
  const observedRate = input.census === 0 ? 0 : input.observedCount / input.census;
  return {
    ...input,
    targetRate,
    targetCount,
    observedRate,
    reached: input.observedCount >= targetCount,
    debtCount: Math.max(0, targetCount - input.observedCount),
    debtRate: Math.max(0, targetRate - observedRate),
  };
}

export interface ListenPairedCorrectnessAssessment {
  rendererKey: ListenTraceRendererKey;
  metric: ListenRecognitionTargetMetric;
  census: number;
  baselineCount: number;
  profileCount: number;
  deltaCount: number;
  passed: boolean;
}

/** Correctness eligibility: no challenger-only floor, only paired non-regression. */
export function assessListenPairedCorrectness(input: Omit<
  ListenPairedCorrectnessAssessment,
  "deltaCount" | "passed"
>): ListenPairedCorrectnessAssessment {
  assertCensus(input.census);
  for (const [label, count] of [
    ["baseline", input.baselineCount],
    ["profile", input.profileCount],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || count > input.census) {
      throw new Error(`${label} correctness count ${count} is outside census ${input.census}.`);
    }
  }
  const deltaCount = input.profileCount - input.baselineCount;
  return { ...input, deltaCount, passed: deltaCount >= 0 };
}

export type ListenMaterialImprovementKind =
  | "rate-gain"
  | "latency-reduction"
  | "unsafe-event-reduction";

export interface ListenMaterialImprovementAssessment {
  id: string;
  kind: ListenMaterialImprovementKind;
  baselineValue: number;
  profileValue: number;
  improvement: number;
  threshold: number;
  material: boolean;
}

/** Assesses one higher-is-better rate under the frozen one-point boundary. */
export function assessListenMaterialRateGain(
  id: string,
  baselineRate: number,
  profileRate: number,
): ListenMaterialImprovementAssessment {
  assertRate(baselineRate, `${id} baseline rate`);
  assertRate(profileRate, `${id} profile rate`);
  const improvement = profileRate - baselineRate;
  return {
    id,
    kind: "rate-gain",
    baselineValue: baselineRate,
    profileValue: profileRate,
    improvement,
    threshold: LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumRateGain,
    material: improvement + LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.rateComparisonEpsilon >=
      LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumRateGain,
  };
}

/** Assesses one lower-is-better latency under the frozen one-hop boundary. */
export function assessListenMaterialLatencyReduction(
  id: string,
  baselineMs: number,
  profileMs: number,
): ListenMaterialImprovementAssessment {
  if (!Number.isFinite(baselineMs) || baselineMs < 0 ||
      !Number.isFinite(profileMs) || profileMs < 0) {
    throw new Error(`${id} latency values must be finite non-negative numbers.`);
  }
  const improvement = baselineMs - profileMs;
  return {
    id,
    kind: "latency-reduction",
    baselineValue: baselineMs,
    profileValue: profileMs,
    improvement,
    threshold: LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumLatencyReductionMs,
    material: improvement + LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.latencyComparisonEpsilonMs >=
      LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumLatencyReductionMs,
  };
}

/** Assesses removal of an unsafe event; adding one is never offset elsewhere. */
export function assessListenMaterialUnsafeEventReduction(
  id: string,
  baselineCount: number,
  profileCount: number,
): ListenMaterialImprovementAssessment {
  for (const count of [baselineCount, profileCount]) assertCensus(count);
  const improvement = baselineCount - profileCount;
  return {
    id,
    kind: "unsafe-event-reduction",
    baselineValue: baselineCount,
    profileValue: profileCount,
    improvement,
    threshold: LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumUnsafeEventReduction,
    material: improvement >= LISTEN_PROMOTION_MATERIAL_IMPROVEMENT.minimumUnsafeEventReduction,
  };
}

export interface ListenRequiredGateObservation {
  code: string;
  applied: boolean;
}

/**
 * Required gates a supposedly complete run failed to apply.
 *
 * Partial diagnostics may leave gates unapplied and can only reject.  Once a
 * run declares the frozen corpus complete, every gate is required and any
 * missing application becomes an explicit blocker rather than disappearing
 * from eligibility through `applied && !passed` filtering.
 */
export function unappliedRequiredListenGateCodes(
  runComplete: boolean,
  gates: readonly ListenRequiredGateObservation[],
): string[] {
  return runComplete ? gates.filter(({ applied }) => !applied).map(({ code }) => code) : [];
}
