/**
 * Task 24: the pre-registered round-two domain-spread and ablation policy.
 *
 * This module deliberately consumes a completed discovery sweep but never
 * captures audio or inference. The same pure calculation is used for the
 * manifest-v1 control archive and, unchanged, by the manifest-v2 ablations.
 */

import {
  conciseListenMatcherMultiDomainSweepResult,
  listenMultiDomainCandidateArchive,
  type ListenMatcherSweepProfile,
  type ListenMultiDomainCandidateArchiveRecord,
  type ListenMultiDomainLeafMetrics,
  type ListenMultiDomainSweepResult,
} from "./listenMatcherSweepBenchmark";
import {
  DeterministicHasher,
  rankListenCandidates,
  type ListenCandidateMetrics,
} from "./listenTraceManifest";

const REPRESENTATION_EPSILON = 1e-12;

/** One percentage point in the independent-rate units used by Task 08. */
export const LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY = 0.01;

/** Baseline-to-candidate source distance may not increase at all. */
export const LISTEN_REPEATED_SOURCE_DISTANCE_NO_REGRESSION = 0;

/** One decoder hop of timing representation tolerance; never an extra attack. */
export const LISTEN_REPEATED_DELAY_NO_REGRESSION_MS = 32;

/** A full physical attack of source-distance recovery is material. */
export const LISTEN_REPEATED_SOURCE_DISTANCE_MATERIAL_GAIN = 1;

/** A half-second attribution-delay reduction must accompany a distance gain. */
export const LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS = 500;

/** Task 22's measured minimum across v05, v13, and mixed, without rounding. */
export const LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM =
  0.09577340414698106;

/**
 * Points added by Task 26's refinement ablation.
 *
 * 0.075 and 0.100 straddle Task 22's 0.095773... minimum; 0.125 checks
 * whether any safe room exists below the historical 0.20 floor; 0.300 and
 * 0.325 refine the gap between the historical 0.275 and 0.350 points.
 */
export const LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS:
  readonly number[] = Object.freeze([0.075, 0.1, 0.125, 0.3, 0.325]);

/** A live-calibration matrix larger than this is not supportable. */
export const LISTEN_ROUND_TWO_MAX_CANDIDATES = 4;

export const LISTEN_MATCHER_SELECTION_POLICY = Object.freeze({
  version: 1 as const,
  domainRegret: Object.freeze({
    metric: "independentRate" as const,
    oraclePopulation: "globally-safe-complete-grid" as const,
    globalStatistic: "minimum-worst-leaf-domain-regret" as const,
    decisionBoundary: LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
    boundaryRule: "one-global-profile-suffices-when-less-than-or-equal" as const,
    spreadObjective: "greedy-minimax-envelope-from-baseline" as const,
    candidateMateriality: "one-leaf-domain-envelope-gain" as const,
    maximumCandidateCount: LISTEN_ROUND_TWO_MAX_CANDIDATES,
  }),
  repeatedRecovery: Object.freeze({
    knownDiscoveryGroupIds: Object.freeze([
      "dynamics-constant/tone/salamander/v05",
      "dynamics-constant/tone/salamander/v13",
      "dynamics-mixed/tone/salamander",
    ]),
    sourceDistanceNoRegression: LISTEN_REPEATED_SOURCE_DISTANCE_NO_REGRESSION,
    attributionDelayNoRegressionMs: LISTEN_REPEATED_DELAY_NO_REGRESSION_MS,
    sourceDistanceMaterialGain: LISTEN_REPEATED_SOURCE_DISTANCE_MATERIAL_GAIN,
    attributionDelayMaterialGainMs: LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
    materialAggregation: "every-discovery-stratum" as const,
    incompleteDiscoveryHandling: "stop-without-performance-downgrade" as const,
    fullResolutionSourceDistance: 0 as const,
    confirmationReproductionRequired: true as const,
  }),
  activeTargetRefinement: Object.freeze({
    task22Minimum: LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
    points: LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS,
    belowHistoricalFloorExcluded: false as const,
  }),
  bassSupport: Object.freeze({
    pairIdentity: "all-other-coordinates-identical" as const,
    compatibilityDefault: "bass-onset-threshold-equals-general-onset-threshold" as const,
    comparedMetric: "worst-leaf-domain-regret" as const,
    materialBoundary: LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
    incompleteRepeatedRecoveryHandling: "unsupported" as const,
  }),
});

/** Compatibility name for Task 26 generators; the authority is inside the hashed policy. */
export const LISTEN_KNOWN_REPEATED_RECOVERY_GROUP_IDS: readonly string[] =
  LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery.knownDiscoveryGroupIds;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => (
    `${JSON.stringify(key)}:${canonicalJson(entry)}`
  )).join(",")}}`;
}

function canonicalDigest(value: unknown): string {
  const hasher = new DeterministicHasher();
  hasher.text(canonicalJson(value), false);
  return hasher.digest;
}

/** Pinned after the complete rule above was frozen, not computed as its own authority. */
export const LISTEN_MATCHER_SELECTION_POLICY_HASH = "840b07ec";

export function assertValidListenMatcherSelectionPolicy(policy: unknown): void {
  const version = (policy as { version?: unknown } | null)?.version;
  if (version !== LISTEN_MATCHER_SELECTION_POLICY.version) {
    throw new Error(`unknown-listen-matcher-selection-policy-version:${String(version)}`);
  }
  const actualHash = canonicalDigest(policy);
  if (actualHash !== LISTEN_MATCHER_SELECTION_POLICY_HASH) {
    throw new Error(
      `amended-listen-matcher-selection-policy:${actualHash}:` +
      `expected-${LISTEN_MATCHER_SELECTION_POLICY_HASH}`,
    );
  }
}

function currentListenMatcherSelectionPolicy(): typeof LISTEN_MATCHER_SELECTION_POLICY {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  return LISTEN_MATCHER_SELECTION_POLICY;
}

export interface ListenDomainSelectionCandidate {
  profileId: string;
  safe: boolean;
  metrics: ListenCandidateMetrics;
  domains: Array<{ domainKey: string; traceCount: number; independentRate: number }>;
}

export interface ListenDomainRegretCandidateResult {
  profileId: string;
  worstDomainRegret: number;
  meanDomainRegret: number;
  materiallyImprovedDomainCountFromBaseline: number;
  regrets: Array<{
    domainKey: string;
    oracleProfileId: string;
    oracleIndependentRate: number;
    candidateIndependentRate: number;
    regret: number;
  }>;
}

export interface ListenDomainRegretControlResult {
  policyVersion: 1;
  policyHash: string;
  baselineProfileId: string;
  safeProfileCount: number;
  domainCount: number;
  decisionBoundary: number;
  verdict: "one-global-profile-suffices" | "domain-spread-material";
  oracles: Array<{
    domainKey: string;
    profileId: string;
    tiedProfileIds: string[];
    independentRate: number;
  }>;
  candidates: ListenDomainRegretCandidateResult[];
  bestGlobal: ListenDomainRegretCandidateResult;
  /** Profiles with the same complete leaf-rate vector as the comparator's representative. */
  bestGlobalTieProfileIds: string[];
  /** New profiles only. baseline-v1 remains the incumbent control. */
  selectedProfileIds: string[];
  selectedEnvelope: Array<{
    domainKey: string;
    independentRate: number;
    regret: number;
  }>;
  maximumCandidateCount: number;
  materialBoundary: number;
  measurementResolution: {
    singleTraceDomainCount: number;
    invariantDomainCount: number;
    boundaryFinerThanSmallestPositiveStepDomainCount: number;
    domains: Array<{
      domainKey: string;
      traceCount: number;
      distinctSafeRateCount: number;
      smallestPositiveSafeRateStep: number | null;
      boundaryFinerThanSmallestPositiveStep: boolean;
    }>;
  };
}

function compareNumbers(left: number, right: number): number {
  return Math.abs(left - right) <= REPRESENTATION_EPSILON ? 0 : left - right;
}

function domainCandidateRank(candidates: readonly ListenDomainSelectionCandidate[]): Map<string, number> {
  return new Map(rankListenCandidates(candidates.map(({ metrics }) => metrics))
    .map(({ profileId }, index) => [profileId, index]));
}

function assertComparableDomainCandidates(
  candidates: readonly ListenDomainSelectionCandidate[],
  baselineProfileId: string,
): string[] {
  if (candidates.length === 0) throw new Error("Domain regret needs at least one grid profile.");
  if (new Set(candidates.map(({ profileId }) => profileId)).size !== candidates.length) {
    throw new Error("Domain regret received a duplicated profile identifier.");
  }
  const baseline = candidates.find(({ profileId }) => profileId === baselineProfileId);
  if (!baseline) throw new Error(`Domain regret has no baseline ${baselineProfileId}.`);
  if (!baseline.safe) throw new Error(`Domain regret baseline ${baselineProfileId} is not globally safe.`);
  const domainKeys = baseline.domains.map(({ domainKey }) => domainKey).sort();
  if (domainKeys.length === 0 || new Set(domainKeys).size !== domainKeys.length) {
    throw new Error("Domain regret needs a non-empty unique leaf-domain census.");
  }
  for (const candidate of candidates) {
    if (candidate.metrics.profileId !== candidate.profileId || candidate.metrics.safe !== candidate.safe) {
      throw new Error(`${candidate.profileId} has inconsistent global safety or metric identity.`);
    }
    const keys = candidate.domains.map(({ domainKey }) => domainKey).sort();
    if (keys.join("\n") !== domainKeys.join("\n")) {
      throw new Error(`${candidate.profileId} does not cover the frozen leaf-domain census.`);
    }
    for (const { domainKey, traceCount, independentRate } of candidate.domains) {
      const baselineTraceCount = baseline.domains.find((domain) => (
        domain.domainKey === domainKey
      ))?.traceCount;
      if (!Number.isInteger(traceCount) || traceCount <= 0 || traceCount !== baselineTraceCount) {
        throw new Error(`${candidate.profileId} has an inconsistent trace count at ${domainKey}.`);
      }
      if (!Number.isFinite(independentRate) || independentRate < 0 || independentRate > 1) {
        throw new Error(`${candidate.profileId} has an invalid domain independent rate.`);
      }
    }
  }
  return domainKeys;
}

function envelopeSummary(
  domainKeys: readonly string[],
  oracles: ReadonlyMap<string, { profileId: string; independentRate: number }>,
  envelope: ReadonlyMap<string, number>,
): { worst: number; mean: number; rows: ListenDomainRegretControlResult["selectedEnvelope"] } {
  const rows = domainKeys.map((domainKey) => {
    const oracle = oracles.get(domainKey);
    const independentRate = envelope.get(domainKey);
    if (!oracle || independentRate === undefined) {
      throw new Error(`The selection envelope is incomplete at ${domainKey}.`);
    }
    return {
      domainKey,
      independentRate,
      regret: Math.max(0, oracle.independentRate - independentRate),
    };
  });
  return {
    worst: Math.max(...rows.map(({ regret }) => regret)),
    mean: rows.reduce((total, { regret }) => total + regret, 0) / rows.length,
    rows,
  };
}

/**
 * Complete-grid, globally-safe leaf-domain regret.
 *
 * Oracles maximize independent recognition inside each leaf. The one-profile
 * verdict minimizes worst regret, then mean regret, then uses Task 08's frozen
 * aggregate comparator. In the spread case baseline-v1 is the initial envelope
 * and each added profile must lift at least one leaf by one percentage point.
 */
export function evaluateListenDomainRegret(options: {
  candidates: readonly ListenDomainSelectionCandidate[];
  baselineProfileId: string;
}): ListenDomainRegretControlResult {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  const { candidates, baselineProfileId } = options;
  const domainKeys = assertComparableDomainCandidates(candidates, baselineProfileId);
  const safe = candidates.filter(({ safe }) => safe);
  const rank = domainCandidateRank(safe);
  const rateMaps = new Map(candidates.map((candidate) => [
    candidate.profileId,
    new Map(candidate.domains.map(({ domainKey, independentRate }) => [domainKey, independentRate])),
  ]));
  const oracles = new Map(domainKeys.map((domainKey) => {
    const ranked = [...safe].sort((left, right) => {
      const leftRate = rateMaps.get(left.profileId)?.get(domainKey) ?? -Infinity;
      const rightRate = rateMaps.get(right.profileId)?.get(domainKey) ?? -Infinity;
      return compareNumbers(rightRate, leftRate) ||
        (rank.get(left.profileId) ?? Infinity) - (rank.get(right.profileId) ?? Infinity) ||
        left.profileId.localeCompare(right.profileId);
    });
    const oracle = ranked[0];
    if (!oracle) throw new Error(`No globally safe oracle exists for ${domainKey}.`);
    const independentRate = rateMaps.get(oracle.profileId)?.get(domainKey) ?? 0;
    return [domainKey, {
      profileId: oracle.profileId,
      tiedProfileIds: ranked.filter((candidate) => compareNumbers(
        rateMaps.get(candidate.profileId)?.get(domainKey) ?? -Infinity,
        independentRate,
      ) === 0).map(({ profileId }) => profileId),
      independentRate,
    }] as const;
  }));
  const baselineRates = rateMaps.get(baselineProfileId);
  if (!baselineRates) throw new Error(`Domain regret has no rates for ${baselineProfileId}.`);
  const evaluated = safe.map((candidate): ListenDomainRegretCandidateResult => {
    const rates = rateMaps.get(candidate.profileId);
    if (!rates) throw new Error(`Domain regret has no rates for ${candidate.profileId}.`);
    const regrets = domainKeys.map((domainKey) => {
      const oracle = oracles.get(domainKey)!;
      const candidateIndependentRate = rates.get(domainKey)!;
      return {
        domainKey,
        oracleProfileId: oracle.profileId,
        oracleIndependentRate: oracle.independentRate,
        candidateIndependentRate,
        regret: Math.max(0, oracle.independentRate - candidateIndependentRate),
      };
    });
    return {
      profileId: candidate.profileId,
      worstDomainRegret: Math.max(...regrets.map(({ regret }) => regret)),
      meanDomainRegret: regrets.reduce((total, { regret }) => total + regret, 0) / regrets.length,
      materiallyImprovedDomainCountFromBaseline: domainKeys.filter((domainKey) => (
        (rates.get(domainKey)! - baselineRates.get(domainKey)!) + REPRESENTATION_EPSILON >=
          LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY
      )).length,
      regrets,
    };
  });
  evaluated.sort((left, right) => (
    compareNumbers(left.worstDomainRegret, right.worstDomainRegret) ||
    compareNumbers(left.meanDomainRegret, right.meanDomainRegret) ||
    (rank.get(left.profileId) ?? Infinity) - (rank.get(right.profileId) ?? Infinity) ||
    left.profileId.localeCompare(right.profileId)
  ));
  const bestGlobal = evaluated[0];
  if (!bestGlobal) throw new Error("Domain regret found no globally safe profile.");
  const bestGlobalTieProfileIds = evaluated.filter((candidate) => (
    candidate.regrets.every((regret, index) => compareNumbers(
      regret.candidateIndependentRate,
      bestGlobal.regrets[index]?.candidateIndependentRate ?? -Infinity,
    ) === 0)
  )).map(({ profileId }) => profileId);
  const verdict = bestGlobal.worstDomainRegret <=
      LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY + REPRESENTATION_EPSILON
    ? "one-global-profile-suffices" as const
    : "domain-spread-material" as const;
  const selectedProfileIds: string[] = [];
  let envelope = new Map(baselineRates);
  if (verdict === "one-global-profile-suffices") {
    if (
      bestGlobal.profileId !== baselineProfileId &&
      bestGlobal.materiallyImprovedDomainCountFromBaseline > 0
    ) {
      selectedProfileIds.push(bestGlobal.profileId);
      envelope = new Map(rateMaps.get(bestGlobal.profileId)!);
    }
  } else {
    while (selectedProfileIds.length < LISTEN_ROUND_TWO_MAX_CANDIDATES) {
      const choices = safe.flatMap((candidate) => {
        if (candidate.profileId === baselineProfileId || selectedProfileIds.includes(candidate.profileId)) {
          return [];
        }
        const rates = rateMaps.get(candidate.profileId)!;
        const materiallyComplements = domainKeys.some((domainKey) => (
          (rates.get(domainKey)! - envelope.get(domainKey)!) + REPRESENTATION_EPSILON >=
            LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY
        ));
        if (!materiallyComplements) return [];
        const nextEnvelope = new Map(domainKeys.map((domainKey) => [
          domainKey,
          Math.max(envelope.get(domainKey)!, rates.get(domainKey)!),
        ]));
        const summary = envelopeSummary(domainKeys, oracles, nextEnvelope);
        return [{ candidate, nextEnvelope, summary }];
      }).sort((left, right) => (
        compareNumbers(left.summary.worst, right.summary.worst) ||
        compareNumbers(left.summary.mean, right.summary.mean) ||
        (rank.get(left.candidate.profileId) ?? Infinity) -
          (rank.get(right.candidate.profileId) ?? Infinity) ||
        left.candidate.profileId.localeCompare(right.candidate.profileId)
      ));
      const choice = choices[0];
      if (!choice) break;
      selectedProfileIds.push(choice.candidate.profileId);
      envelope = choice.nextEnvelope;
    }
  }
  const selectedEnvelope = envelopeSummary(domainKeys, oracles, envelope).rows;
  const baselineCandidate = candidates.find(({ profileId }) => profileId === baselineProfileId)!;
  const baselineDomainByKey = new Map(baselineCandidate.domains.map((domain) => (
    [domain.domainKey, domain]
  )));
  const resolutionDomains = domainKeys.map((domainKey) => {
    const distinctRates = [...safe.map((candidate) => (
      rateMaps.get(candidate.profileId)?.get(domainKey) ?? 0
    ))].sort((left, right) => left - right).filter((rate, index, rates) => (
      index === 0 || compareNumbers(rate, rates[index - 1]!) !== 0
    ));
    const positiveSteps = distinctRates.slice(1).map((rate, index) => (
      rate - distinctRates[index]!
    )).filter((step) => step > REPRESENTATION_EPSILON);
    const smallestPositiveSafeRateStep = positiveSteps.length === 0
      ? null
      : Math.min(...positiveSteps);
    return {
      domainKey,
      traceCount: baselineDomainByKey.get(domainKey)!.traceCount,
      distinctSafeRateCount: distinctRates.length,
      smallestPositiveSafeRateStep,
      boundaryFinerThanSmallestPositiveStep: smallestPositiveSafeRateStep !== null &&
        LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY + REPRESENTATION_EPSILON <
          smallestPositiveSafeRateStep,
    };
  });
  return {
    policyVersion: 1,
    policyHash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
    baselineProfileId,
    safeProfileCount: safe.length,
    domainCount: domainKeys.length,
    decisionBoundary: LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
    verdict,
    oracles: domainKeys.map((domainKey) => ({ domainKey, ...oracles.get(domainKey)! })),
    candidates: evaluated,
    bestGlobal,
    bestGlobalTieProfileIds,
    selectedProfileIds,
    selectedEnvelope,
    maximumCandidateCount: LISTEN_ROUND_TWO_MAX_CANDIDATES,
    materialBoundary: LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
    measurementResolution: {
      singleTraceDomainCount: resolutionDomains.filter(({ traceCount }) => traceCount === 1).length,
      invariantDomainCount: resolutionDomains.filter(({ distinctSafeRateCount }) => (
        distinctSafeRateCount === 1
      )).length,
      boundaryFinerThanSmallestPositiveStepDomainCount: resolutionDomains.filter((domain) => (
        domain.boundaryFinerThanSmallestPositiveStep
      )).length,
      domains: resolutionDomains,
    },
  };
}

export interface ListenRepeatedRecoveryObservation {
  evaluated: boolean;
  structurallyValid: boolean;
  firstCorrectFullChordAttackIncomplete: boolean;
  carriedRequiredPitchWithoutFreshReOnset: boolean;
  laterIdenticalAttackRecoveredCorrectTarget: boolean;
  sourceDistance: number | null;
  attributionDelayMs: number | null;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
}

export interface ListenRepeatedRecoveryGroupComparison {
  groupId: string;
  stratum: string;
  evidenceRole: "discovery" | "confirmation";
  baseline: ListenRepeatedRecoveryObservation;
  candidate: ListenRepeatedRecoveryObservation;
}

export type ListenRepeatedRecoveryOutcome =
  | "unchanged"
  | "regressed"
  | "material-partial-recovery"
  | "discovery-full-resolution"
  | "confirmed-full-resolution";

export type ListenConfirmationReproductionStatus =
  | "reproduced"
  | "inconclusive-no-reproduction"
  | "not-run";

export type ListenDiscoveryEvaluationStatus = "complete" | "incomplete";

/**
 * The two label vocabularies, enumerated so an artifact schema can validate
 * against them.
 *
 * Each is built from a `Record` keyed by its own union, so adding a label to the
 * type without adding it here fails to compile. A hand-written list would drift
 * silently, and a downstream schema validating against a stale list would accept
 * a label the policy no longer produces or reject one it does.
 */
const REPEATED_RECOVERY_OUTCOME_MEMBERS:
  Readonly<Record<ListenRepeatedRecoveryOutcome, true>> = Object.freeze({
    "unchanged": true,
    "regressed": true,
    "material-partial-recovery": true,
    "discovery-full-resolution": true,
    "confirmed-full-resolution": true,
  });

export const LISTEN_REPEATED_RECOVERY_OUTCOMES: readonly ListenRepeatedRecoveryOutcome[] =
  Object.freeze(
    Object.keys(REPEATED_RECOVERY_OUTCOME_MEMBERS) as ListenRepeatedRecoveryOutcome[],
  );

const CONFIRMATION_REPRODUCTION_STATUS_MEMBERS:
  Readonly<Record<ListenConfirmationReproductionStatus, true>> = Object.freeze({
    "reproduced": true,
    "inconclusive-no-reproduction": true,
    "not-run": true,
  });

export const LISTEN_CONFIRMATION_REPRODUCTION_STATUSES:
  readonly ListenConfirmationReproductionStatus[] = Object.freeze(
    Object.keys(CONFIRMATION_REPRODUCTION_STATUS_MEMBERS) as
      ListenConfirmationReproductionStatus[],
  );

export interface ListenRepeatedRecoveryEvaluation {
  repeatedRecoveryOutcome: ListenRepeatedRecoveryOutcome;
  confirmationReproductionStatus: ListenConfirmationReproductionStatus;
  discoveryEvaluationStatus: ListenDiscoveryEvaluationStatus;
  noRegression: boolean;
  materialRecovery: boolean;
  materialRecoveryByStratum: Array<{
    stratum: string;
    requiredGroupCount: number;
    evaluatedGroupCount: number;
    complete: boolean;
    material: boolean;
  }>;
  discoveryFullResolution: boolean;
  confirmedFullResolution: boolean;
  reproducingConfirmationGroupIds: string[];
  inconclusiveConfirmationGroupIds: string[];
  groups: Array<{
    groupId: string;
    stratum: string;
    evidenceRole: "discovery" | "confirmation";
    evaluated: boolean;
    baselineReproduces: boolean;
    noRegression: boolean;
    materialRecovery: boolean;
    fullResolution: boolean;
  }>;
}

function unsafeCount(observation: ListenRepeatedRecoveryObservation): number {
  return observation.falseAdvanceCount + observation.skippedAdvanceCount +
    observation.duplicateAdvanceCount;
}

function assertValidRepeatedObservation(observation: ListenRepeatedRecoveryObservation): void {
  for (const value of [
    observation.falseAdvanceCount,
    observation.skippedAdvanceCount,
    observation.duplicateAdvanceCount,
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("A repeated-recovery safety count is invalid.");
    }
  }
  if (observation.sourceDistance !== null &&
      (!Number.isInteger(observation.sourceDistance) || observation.sourceDistance < 0)) {
    throw new Error("A repeated-recovery source distance is invalid.");
  }
  if (observation.attributionDelayMs !== null &&
      (!Number.isFinite(observation.attributionDelayMs) || observation.attributionDelayMs < 0)) {
    throw new Error("A repeated-recovery attribution delay is invalid.");
  }
  if ((observation.sourceDistance === null) !== (observation.attributionDelayMs === null)) {
    throw new Error("Repeated recovery must record source distance and delay together.");
  }
}

/** Task 24's pre-authored reproduction predicate, applied only after decoding. */
export function listenRepeatedRecoveryReproduces(
  observation: ListenRepeatedRecoveryObservation,
): boolean {
  currentListenMatcherSelectionPolicy();
  return repeatedRecoveryReproduces(observation);
}

function repeatedRecoveryReproduces(
  observation: ListenRepeatedRecoveryObservation,
): boolean {
  assertValidRepeatedObservation(observation);
  return observation.evaluated && observation.structurallyValid &&
    observation.firstCorrectFullChordAttackIncomplete &&
    observation.carriedRequiredPitchWithoutFreshReOnset &&
    observation.laterIdenticalAttackRecoveredCorrectTarget &&
    observation.sourceDistance !== null && observation.sourceDistance > 0 &&
    unsafeCount(observation) === 0;
}

function compareRepeatedGroup(
  comparison: ListenRepeatedRecoveryGroupComparison,
  policy: typeof LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery,
) {
  const { baseline, candidate } = comparison;
  assertValidRepeatedObservation(baseline);
  assertValidRepeatedObservation(candidate);
  if (
    (baseline.evaluated && !baseline.structurallyValid) ||
    (candidate.evaluated && !candidate.structurallyValid)
  ) {
    throw new Error(`${comparison.groupId} is a malformed repeated-recovery group.`);
  }
  const candidateSafe = candidate.evaluated && unsafeCount(candidate) === 0;
  let noRegression = candidateSafe;
  if (baseline.sourceDistance !== null) {
    noRegression = noRegression && candidate.sourceDistance !== null &&
      candidate.sourceDistance - baseline.sourceDistance <=
        policy.sourceDistanceNoRegression &&
      candidate.attributionDelayMs! - baseline.attributionDelayMs! <=
        policy.attributionDelayNoRegressionMs + REPRESENTATION_EPSILON;
  }
  const materialRecovery = candidateSafe && candidate.sourceDistance !== null && (
    baseline.sourceDistance === null || (
      baseline.sourceDistance - candidate.sourceDistance >=
        policy.sourceDistanceMaterialGain &&
      baseline.attributionDelayMs! - candidate.attributionDelayMs! + REPRESENTATION_EPSILON >=
        policy.attributionDelayMaterialGainMs
    )
  );
  return {
    groupId: comparison.groupId,
    stratum: comparison.stratum,
    evidenceRole: comparison.evidenceRole,
    evaluated: candidate.evaluated,
    baselineReproduces: repeatedRecoveryReproduces(baseline),
    noRegression,
    materialRecovery,
    fullResolution: candidateSafe && candidate.sourceDistance === 0,
  };
}

/**
 * Per-group repeated-chord evaluation. No average is taken: every evaluated
 * group first passes no-regression, and every discovery stratum must be complete
 * and contain a material recovery.
 */
export function evaluateListenRepeatedRecovery(
  comparisons: readonly ListenRepeatedRecoveryGroupComparison[],
): ListenRepeatedRecoveryEvaluation {
  const policy = currentListenMatcherSelectionPolicy().repeatedRecovery;
  if (comparisons.length === 0) throw new Error("Repeated recovery has no groups to evaluate.");
  if (new Set(comparisons.map(({ groupId }) => groupId)).size !== comparisons.length) {
    throw new Error("Repeated recovery received a duplicated group identifier.");
  }
  const groups = comparisons.map((comparison) => compareRepeatedGroup(comparison, policy));
  const discovery = groups.filter(({ evidenceRole }) => evidenceRole === "discovery");
  const confirmation = groups.filter(({ evidenceRole, evaluated }) => (
    evidenceRole === "confirmation" && evaluated
  ));
  const strata = [...new Set(discovery.map(({ stratum }) => stratum))].sort();
  const materialRecoveryByStratum = strata.map((stratum) => {
    const stratumGroups = discovery.filter((group) => group.stratum === stratum);
    const evaluatedGroupCount = stratumGroups.filter(({ evaluated }) => evaluated).length;
    const complete = evaluatedGroupCount === stratumGroups.length;
    return {
      stratum,
      requiredGroupCount: stratumGroups.length,
      evaluatedGroupCount,
      complete,
      material: complete && stratumGroups.some(({ materialRecovery }) => materialRecovery),
    };
  });
  const discoveryEvaluationStatus: ListenDiscoveryEvaluationStatus =
    materialRecoveryByStratum.length > 0 &&
      materialRecoveryByStratum.every(({ complete }) => complete)
      ? "complete"
      : "incomplete";
  const noRegression = discovery.filter(({ evaluated }) => evaluated)
    .every((group) => group.noRegression) &&
    confirmation.every((group) => group.noRegression);
  const materialRecovery = discovery.length > 0 &&
    materialRecoveryByStratum.length > 0 &&
    materialRecoveryByStratum.every(({ material }) => material);
  const discoveryById = new Map(discovery.map((group) => [group.groupId, group]));
  const knownGroupsPresent = policy.knownDiscoveryGroupIds.every((id) => (
    discoveryById.has(id)
  ));
  const discoveryGroupsRequiredForResolution = discovery.filter((group) => (
    policy.knownDiscoveryGroupIds.includes(group.groupId) || group.baselineReproduces
  ));
  const discoveryFullResolution = knownGroupsPresent &&
    discoveryGroupsRequiredForResolution.length >= policy.knownDiscoveryGroupIds.length &&
    discoveryGroupsRequiredForResolution.every(({ fullResolution }) => fullResolution);
  const reproducingConfirmation = confirmation.filter(({ baselineReproduces }) => baselineReproduces);
  const inconclusiveConfirmation = confirmation.filter(({ baselineReproduces }) => !baselineReproduces);
  const confirmationRun = comparisons.some(({ evidenceRole, candidate }) => (
    evidenceRole === "confirmation" && candidate.evaluated
  ));
  const confirmationReproductionStatus: ListenConfirmationReproductionStatus = !confirmationRun
    ? "not-run"
    : reproducingConfirmation.length === 0
    ? "inconclusive-no-reproduction"
    : "reproduced";
  const confirmedFullResolution = discoveryFullResolution &&
    reproducingConfirmation.length > 0 &&
    reproducingConfirmation.every(({ fullResolution }) => fullResolution);
  let repeatedRecoveryOutcome: ListenRepeatedRecoveryOutcome = "unchanged";
  if (!noRegression) repeatedRecoveryOutcome = "regressed";
  else if (confirmedFullResolution) repeatedRecoveryOutcome = "confirmed-full-resolution";
  else if (discoveryFullResolution) repeatedRecoveryOutcome = "discovery-full-resolution";
  else if (materialRecovery) repeatedRecoveryOutcome = "material-partial-recovery";
  return {
    repeatedRecoveryOutcome,
    confirmationReproductionStatus,
    discoveryEvaluationStatus,
    noRegression,
    materialRecovery,
    materialRecoveryByStratum,
    discoveryFullResolution,
    confirmedFullResolution,
    reproducingConfirmationGroupIds: reproducingConfirmation.map(({ groupId }) => groupId).sort(),
    inconclusiveConfirmationGroupIds: inconclusiveConfirmation.map(({ groupId }) => groupId).sort(),
    groups,
  };
}

export interface ListenAblationStopResult {
  satisfied: boolean;
  runNextAblation: boolean;
  reasons: Array<
    "no-search-selected-candidate" |
    "selected-discovery-stratum-not-decoded" |
    "selected-repeated-recovery-regression" |
    "selected-set-has-no-material-repeated-recovery"
  >;
}

/** The whole-ablation stop rule Task 26 applies after each staged grid. */
export function evaluateListenAblationStop(options: {
  selectedProfileIds: readonly string[];
  repeatedRecoveryByProfile: ReadonlyMap<string, ListenRepeatedRecoveryEvaluation>;
}): ListenAblationStopResult {
  currentListenMatcherSelectionPolicy();
  const reasons: ListenAblationStopResult["reasons"] = [];
  if (options.selectedProfileIds.length === 0) reasons.push("no-search-selected-candidate");
  const evaluations = options.selectedProfileIds.flatMap((profileId) => {
    const evaluation = options.repeatedRecoveryByProfile.get(profileId);
    if (!evaluation) throw new Error(`The stop rule has no repeated-recovery row for ${profileId}.`);
    return [evaluation];
  });
  const hasIncompleteDiscovery = evaluations.some(({ discoveryEvaluationStatus }) => (
    discoveryEvaluationStatus === "incomplete"
  ));
  if (hasIncompleteDiscovery) reasons.push("selected-discovery-stratum-not-decoded");
  if (evaluations.some(({ noRegression }) => !noRegression)) {
    reasons.push("selected-repeated-recovery-regression");
  }
  if (!hasIncompleteDiscovery && evaluations.length > 0 &&
      evaluations.every(({ materialRecovery }) => !materialRecovery)) {
    reasons.push("selected-set-has-no-material-repeated-recovery");
  }
  return {
    satisfied: reasons.length === 0,
    runNextAblation: reasons.length > 0,
    reasons,
  };
}

export interface ListenBassAxisPairSupportResult {
  supported: boolean;
  categoricalSafetyRescue: boolean;
  worstDomainRegretGain: number;
  materialRegretGain: boolean;
  materialRepeatedRecoveryGain: boolean;
  reasons: string[];
}

/** Pair-level support; a passing grid alone never earns a new bass axis. */
export function evaluateListenBassAxisPairSupport(options: {
  ablationStopSatisfied: boolean;
  axisProfileSelected: boolean;
  axisSafe: boolean;
  twinSafe: boolean;
  axisWorstDomainRegret: number;
  twinWorstDomainRegret: number;
  repeatedRecoveryAgainstTwin: ListenRepeatedRecoveryEvaluation;
}): ListenBassAxisPairSupportResult {
  const policy = currentListenMatcherSelectionPolicy();
  const categoricalSafetyRescue = options.axisSafe && !options.twinSafe;
  const worstDomainRegretGain = options.twinWorstDomainRegret - options.axisWorstDomainRegret;
  const materialRegretGain = worstDomainRegretGain + REPRESENTATION_EPSILON >=
    policy.bassSupport.materialBoundary;
  const materialRepeatedRecoveryGain = options.repeatedRecoveryAgainstTwin.noRegression &&
    options.repeatedRecoveryAgainstTwin.materialRecovery;
  const reasons: string[] = [];
  if (!options.ablationStopSatisfied) reasons.push("bass-grid-failed-stop-rule");
  if (!options.axisProfileSelected) reasons.push("axis-profile-not-selected");
  if (!options.axisSafe) reasons.push("axis-profile-unsafe");
  if (options.repeatedRecoveryAgainstTwin.discoveryEvaluationStatus === "incomplete") {
    reasons.push("repeated-recovery-discovery-incomplete-against-twin");
  }
  if (!options.repeatedRecoveryAgainstTwin.noRegression) {
    reasons.push("repeated-recovery-regression-against-twin");
  }
  if (!categoricalSafetyRescue && !materialRegretGain && !materialRepeatedRecoveryGain) {
    reasons.push("axis-does-not-separate-from-twin");
  }
  return {
    supported: reasons.length === 0,
    categoricalSafetyRescue,
    worstDomainRegretGain,
    materialRegretGain,
    materialRepeatedRecoveryGain,
    reasons,
  };
}

const TASK08_PINS = Object.freeze({
  manifestVersion: 1,
  manifestHash: "0ed1e71d",
  corpusHash: "10ae2e0b",
  gridSize: 1_000,
  profilesRejectedBySafety: 721,
  paretoFrontierCount: 30,
  selectedProfileIds: Object.freeze([
    "o0p450-t0p500-a0p200-x0p990-b1",
    "o0p500-t0p500-a0p200-x0p990-b1",
    "o0p450-t0p500-a0p275-x0p990-b1",
    "o0p500-t0p500-a0p275-x0p990-b1",
  ]),
  candidateDigest: "53ee8a67",
});

export interface ListenTask24DomainArchiveCandidate extends ListenMultiDomainCandidateArchiveRecord {
  leafDomains: ListenMultiDomainLeafMetrics[];
}

export interface ListenTask24DomainArchive {
  name: "listen-matcher-domain-archive";
  selectsNothing: true;
  formatVersion: 1;
  selectionPolicy: {
    version: 1;
    hash: string;
    rule: typeof LISTEN_MATCHER_SELECTION_POLICY;
  };
  manifest: ListenMultiDomainSweepResult["manifest"];
  sourcePartitions: ["discovery", "regression-only"];
  confirmationTraceCountRead: 0;
  task08Parity: {
    aggregateCandidateDigest: string;
    candidateCount: number;
    profilesRejectedBySafety: number;
    paretoFrontierCount: number;
    selectedProfileIds: string[];
    reproduced: true;
  };
  version1Control: ListenDomainRegretControlResult;
  candidateCount: number;
  digest: { algorithm: "fnv1a-32-canonical-json"; value: string };
  candidates: ListenTask24DomainArchiveCandidate[];
}

function assertTask08Parity(result: ListenMultiDomainSweepResult): void {
  const aggregate = listenMultiDomainCandidateArchive(result);
  const selectedProfileIds = result.selected.map(({ profile }) => profile.id);
  const failures = [
    result.manifest.version === TASK08_PINS.manifestVersion ? null : "manifest-version",
    result.manifest.hash === TASK08_PINS.manifestHash ? null : "manifest-hash",
    result.manifest.corpusHash === TASK08_PINS.corpusHash ? null : "corpus-hash",
    result.gridSize === TASK08_PINS.gridSize ? null : "grid-size",
    result.profilesRejectedBySafety === TASK08_PINS.profilesRejectedBySafety
      ? null : "rejection-count",
    result.paretoFrontier.length === TASK08_PINS.paretoFrontierCount ? null : "frontier-count",
    selectedProfileIds.join("\n") === TASK08_PINS.selectedProfileIds.join("\n")
      ? null : "selected-profile-ids",
    aggregate.digest.value === TASK08_PINS.candidateDigest ? null : "candidate-digest",
  ].filter((failure): failure is string => failure !== null);
  if (failures.length > 0) {
    throw new Error(`Task 24 does not reproduce Task 08: ${failures.join(",")}.`);
  }
  if (result.captures.some(({ partition }) => partition === "confirmation")) {
    throw new Error("Task 24 read a confirmation trace.");
  }
}

/** The separate detail archive; the historical Task 08 exporter stays unchanged. */
export function listenTask24DomainArchive(
  result: ListenMultiDomainSweepResult,
): ListenTask24DomainArchive {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  assertTask08Parity(result);
  const aggregate = listenMultiDomainCandidateArchive(result);
  const byId = new Map(result.candidates.map((candidate) => [candidate.profile.id, candidate]));
  const candidates = aggregate.candidates.map((candidate): ListenTask24DomainArchiveCandidate => {
    const source = byId.get(candidate.profile.id);
    if (!source) throw new Error(`Task 24 lost profile ${candidate.profile.id}.`);
    return {
      ...candidate,
      leafDomains: source.leafDomains.map((domain) => ({ ...domain })),
    };
  });
  const version1Control = evaluateListenDomainRegret({
    baselineProfileId: result.baseline.profile.id,
    candidates: candidates.map((candidate) => ({
      profileId: candidate.profile.id,
      safe: candidate.safetyVerdict.passed,
      metrics: candidate.metrics,
      domains: candidate.leafDomains.map(({ domainKey, traceCount, independentRate }) => ({
        domainKey,
        traceCount,
        independentRate,
      })),
    })),
  });
  const digestInput = {
    formatVersion: 1,
    selectionPolicyVersion: LISTEN_MATCHER_SELECTION_POLICY.version,
    selectionPolicyHash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
    manifest: result.manifest,
    task08CandidateDigest: aggregate.digest.value,
    version1Control,
    candidates,
  };
  return {
    name: "listen-matcher-domain-archive",
    selectsNothing: true,
    formatVersion: 1,
    selectionPolicy: {
      version: 1,
      hash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
      rule: LISTEN_MATCHER_SELECTION_POLICY,
    },
    manifest: result.manifest,
    sourcePartitions: ["discovery", "regression-only"],
    confirmationTraceCountRead: 0,
    task08Parity: {
      aggregateCandidateDigest: aggregate.digest.value,
      candidateCount: aggregate.candidateCount,
      profilesRejectedBySafety: result.profilesRejectedBySafety,
      paretoFrontierCount: result.paretoFrontier.length,
      selectedProfileIds: result.selected.map(({ profile }) => profile.id),
      reproduced: true,
    },
    version1Control,
    candidateCount: candidates.length,
    digest: {
      algorithm: "fnv1a-32-canonical-json",
      value: canonicalDigest(digestInput),
    },
    candidates,
  };
}

/** Browser-runner shape: old aggregate fields beside the new detail archive. */
export function fullListenTask24DomainArchiveResult(result: ListenMultiDomainSweepResult) {
  return {
    ...conciseListenMatcherMultiDomainSweepResult(result),
    task24: listenTask24DomainArchive(result),
  };
}

/** Utility for constructed tests and future round-two generators. */
export function listenDomainCandidateFromLeafMetrics(options: {
  profile: ListenMatcherSweepProfile;
  safe: boolean;
  metrics: ListenCandidateMetrics;
  leafDomains: readonly ListenMultiDomainLeafMetrics[];
}): ListenDomainSelectionCandidate {
  return {
    profileId: options.profile.id,
    safe: options.safe,
    metrics: options.metrics,
    domains: options.leafDomains.map(({ domainKey, traceCount, independentRate }) => ({
      domainKey,
      traceCount,
      independentRate,
    })),
  };
}
