import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ListenCandidateMetrics } from "./benchmarks/listenTraceManifest";
import {
  LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
  LISTEN_KNOWN_REPEATED_RECOVERY_GROUP_IDS,
  LISTEN_MATCHER_SELECTION_POLICY,
  LISTEN_MATCHER_SELECTION_POLICY_HASH,
  LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
  LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS,
  LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
  assertValidListenMatcherSelectionPolicy,
  evaluateListenAblationStop,
  evaluateListenBassAxisPairSupport,
  evaluateListenDomainRegret,
  evaluateListenRepeatedRecovery,
  listenRepeatedRecoveryReproduces,
  type ListenDomainSelectionCandidate,
  type ListenRepeatedRecoveryGroupComparison,
  type ListenRepeatedRecoveryObservation,
} from "./listenMatcherSelectionPolicy";

function metrics(profileId: string, safe = true, rank = 0): ListenCandidateMetrics {
  return {
    profileId,
    safe,
    worstDomainIndependentRate: 0.9 + rank / 1_000,
    equalDomainIndependentRate: 0.9,
    orderedPrefixRate: 0.9,
    completePassageRate: 0.9,
    lateAdvanceCount: 0,
    lateAdvanceSourceDistance: 0,
    attributionDelayMs: 0,
    p95LatencyMs: 200,
    distanceFromBaseline: 0,
  };
}

function domainCandidate(
  profileId: string,
  first: number,
  second: number,
  options: { safe?: boolean; rank?: number } = {},
): ListenDomainSelectionCandidate {
  const safe = options.safe ?? true;
  return {
    profileId,
    safe,
    metrics: metrics(profileId, safe, options.rank ?? 0),
    domains: [
      { domainKey: "direct/sequence/family-a", traceCount: 2, independentRate: first },
      { domainKey: "tone/dynamics-constant/piano-b", traceCount: 1, independentRate: second },
    ],
  };
}

test("the versioned Task 24 policy is pinned and the active refinement straddles Task 22", () => {
  assert.doesNotThrow(() => assertValidListenMatcherSelectionPolicy(
    LISTEN_MATCHER_SELECTION_POLICY,
  ));
  assert.equal(LISTEN_MATCHER_SELECTION_POLICY_HASH, "840b07ec");
  assert.ok(LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS.some((point) => (
    point < LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM
  )));
  assert.ok(LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS.some((point) => (
    point > LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM && point < 0.2
  )));
  assert.deepEqual(
    LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS.filter((point) => (
      point > 0.275 && point < 0.35
    )),
    [0.3, 0.325],
  );
  assert.throws(
    () => assertValidListenMatcherSelectionPolicy({
      ...LISTEN_MATCHER_SELECTION_POLICY,
      version: 2,
    }),
    /unknown-listen-matcher-selection-policy-version/,
  );
  assert.throws(
    () => assertValidListenMatcherSelectionPolicy({
      ...LISTEN_MATCHER_SELECTION_POLICY,
      domainRegret: {
        ...LISTEN_MATCHER_SELECTION_POLICY.domainRegret,
        decisionBoundary: 0.02,
      },
    }),
    /amended-listen-matcher-selection-policy/,
  );
  assert.strictEqual(
    LISTEN_KNOWN_REPEATED_RECOVERY_GROUP_IDS,
    LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery.knownDiscoveryGroupIds,
  );
  assert.throws(
    () => assertValidListenMatcherSelectionPolicy({
      ...LISTEN_MATCHER_SELECTION_POLICY,
      repeatedRecovery: {
        ...LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery,
        knownDiscoveryGroupIds:
          LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery.knownDiscoveryGroupIds.slice(0, -1),
      },
    }),
    /amended-listen-matcher-selection-policy/,
  );
});

test("leaf-domain oracles exclude unsafe profiles and the one-global boundary is inclusive", () => {
  const candidates = [
    domainCandidate("baseline", 0.8, 0.8),
    domainCandidate("domain-a", 1, 0.8, { rank: 2 }),
    domainCandidate("domain-b", 0.8, 1, { rank: 1 }),
    domainCandidate("compromise", 0.99, 0.99, { rank: 3 }),
    domainCandidate("unsafe-oracle", 1, 1, { safe: false, rank: 10 }),
  ];
  const result = evaluateListenDomainRegret({ candidates, baselineProfileId: "baseline" });
  assert.equal(result.safeProfileCount, 4);
  assert.deepEqual(result.oracles.map(({ profileId }) => profileId), ["domain-a", "domain-b"]);
  assert.equal(result.bestGlobal.profileId, "compromise");
  assert.ok(Math.abs(
    result.bestGlobal.worstDomainRegret - LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
  ) < 1e-12);
  assert.equal(result.verdict, "one-global-profile-suffices");
  assert.deepEqual(result.selectedProfileIds, ["compromise"]);
  assert.equal(result.measurementResolution.singleTraceDomainCount, 1);

  const outside = evaluateListenDomainRegret({
    baselineProfileId: "baseline",
    candidates: candidates.map((candidate) => candidate.profileId === "compromise"
      ? domainCandidate("compromise", 0.989, 0.989, { rank: 3 })
      : candidate),
  });
  assert.equal(outside.verdict, "domain-spread-material");
});

test("one-global regret selects nothing without a material baseline improvement", () => {
  const result = evaluateListenDomainRegret({
    baselineProfileId: "baseline",
    candidates: [
      domainCandidate("baseline", 0.8, 0.8),
      domainCandidate("comparator-tie", 0.8, 0.8, { rank: 10 }),
    ],
  });
  assert.equal(result.verdict, "one-global-profile-suffices");
  assert.equal(result.bestGlobal.profileId, "comparator-tie");
  assert.deepEqual(result.bestGlobalTieProfileIds, ["comparator-tie", "baseline"]);
  assert.deepEqual(result.selectedProfileIds, []);
});

test("the spread rule greedily builds a material complementary envelope", () => {
  const result = evaluateListenDomainRegret({
    baselineProfileId: "baseline",
    candidates: [
      domainCandidate("baseline", 0.8, 0.8),
      domainCandidate("domain-a", 1, 0.8, { rank: 2 }),
      domainCandidate("domain-b", 0.8, 1, { rank: 1 }),
      // This profile changes a leaf by less than the frozen one-point margin.
      domainCandidate("noise", 0.805, 0.805, { rank: 10 }),
    ],
  });
  assert.equal(result.verdict, "domain-spread-material");
  assert.deepEqual(result.selectedProfileIds, ["domain-a", "domain-b"]);
  assert.deepEqual(result.selectedEnvelope.map(({ regret }) => regret), [0, 0]);
});

test("domain regret fails closed on a missing baseline or leaf-domain row", () => {
  assert.throws(
    () => evaluateListenDomainRegret({
      baselineProfileId: "missing",
      candidates: [domainCandidate("baseline", 0.8, 0.8)],
    }),
    /no baseline missing/,
  );
  const incomplete = domainCandidate("incomplete", 0.9, 0.9);
  incomplete.domains.pop();
  assert.throws(
    () => evaluateListenDomainRegret({
      baselineProfileId: "baseline",
      candidates: [domainCandidate("baseline", 0.8, 0.8), incomplete],
    }),
    /does not cover the frozen leaf-domain census/,
  );
});

function observation(overrides: Partial<ListenRepeatedRecoveryObservation> = {}):
ListenRepeatedRecoveryObservation {
  return {
    evaluated: true,
    structurallyValid: true,
    firstCorrectFullChordAttackIncomplete: true,
    carriedRequiredPitchWithoutFreshReOnset: true,
    laterIdenticalAttackRecoveredCorrectTarget: true,
    sourceDistance: 2,
    attributionDelayMs: 2_000,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    ...overrides,
  };
}

function repeatedComparisons(options: {
  candidateDistance?: number | null;
  candidateDelayMs?: number | null;
  baselineDistance?: number | null;
  baselineDelayMs?: number | null;
} = {}): ListenRepeatedRecoveryGroupComparison[] {
  const baselineDistance = options.baselineDistance === undefined ? 2 : options.baselineDistance;
  const baselineDelayMs = options.baselineDelayMs === undefined ? 2_000 : options.baselineDelayMs;
  const candidateDistance = options.candidateDistance === undefined ? 1 : options.candidateDistance;
  const candidateDelayMs = options.candidateDelayMs === undefined ? 1_400 : options.candidateDelayMs;
  return LISTEN_KNOWN_REPEATED_RECOVERY_GROUP_IDS.map((groupId) => ({
    groupId,
    stratum: groupId,
    evidenceRole: "discovery" as const,
    baseline: observation({ sourceDistance: baselineDistance, attributionDelayMs: baselineDelayMs }),
    candidate: observation({
      laterIdenticalAttackRecoveredCorrectTarget: candidateDistance !== 0,
      sourceDistance: candidateDistance,
      attributionDelayMs: candidateDelayMs,
    }),
  }));
}

test("the repeated-recovery predicate names the decoded phenomenon exactly", () => {
  assert.equal(listenRepeatedRecoveryReproduces(observation()), true);
  assert.equal(listenRepeatedRecoveryReproduces(observation({
    carriedRequiredPitchWithoutFreshReOnset: false,
  })), false);
  assert.equal(listenRepeatedRecoveryReproduces(observation({ sourceDistance: 0 })), false);
  assert.equal(listenRepeatedRecoveryReproduces(observation({
    falseAdvanceCount: 1,
  })), false);
});

test("one repeated run cannot average away another run's regression", () => {
  const comparisons = repeatedComparisons();
  comparisons[1] = {
    ...comparisons[1],
    candidate: observation({ sourceDistance: 2, attributionDelayMs: 2_033 }),
  };
  const result = evaluateListenRepeatedRecovery(comparisons);
  assert.equal(result.noRegression, false);
  assert.equal(result.repeatedRecoveryOutcome, "regressed");
});

test("distance one is material partial recovery but never full resolution", () => {
  const result = evaluateListenRepeatedRecovery(repeatedComparisons());
  assert.equal(result.noRegression, true);
  assert.equal(result.materialRecovery, true);
  assert.equal(result.discoveryEvaluationStatus, "complete");
  assert.equal(result.discoveryFullResolution, false);
  assert.equal(result.repeatedRecoveryOutcome, "material-partial-recovery");
  assert.equal(result.confirmationReproductionStatus, "not-run");
});

test("every declared discovery stratum fails closed until it is decoded", () => {
  const incompleteComparisons: ListenRepeatedRecoveryGroupComparison[] = [
    ...repeatedComparisons(),
    {
      groupId: "declared-but-not-decoded",
      stratum: "unmeasured-stratum",
      evidenceRole: "discovery",
      baseline: observation(),
      candidate: observation({
        evaluated: false,
        sourceDistance: null,
        attributionDelayMs: null,
      }),
    },
  ];
  const result = evaluateListenRepeatedRecovery(incompleteComparisons);
  assert.deepEqual(
    result.materialRecoveryByStratum.find(({ stratum }) => stratum === "unmeasured-stratum"),
    {
      stratum: "unmeasured-stratum",
      requiredGroupCount: 1,
      evaluatedGroupCount: 0,
      complete: false,
      material: false,
    },
  );
  assert.equal(result.discoveryEvaluationStatus, "incomplete");
  assert.equal(result.noRegression, true);
  assert.equal(result.materialRecovery, false);
  assert.equal(result.repeatedRecoveryOutcome, "unchanged");
  assert.deepEqual(evaluateListenAblationStop({
    selectedProfileIds: ["selected"],
    repeatedRecoveryByProfile: new Map([["selected", result]]),
  }), {
    satisfied: false,
    runNextAblation: true,
    reasons: ["selected-discovery-stratum-not-decoded"],
  });

  const undecodedConfirmation = evaluateListenRepeatedRecovery([
    ...repeatedComparisons(),
    {
      groupId: "unseen-not-decoded",
      stratum: "unseen",
      evidenceRole: "confirmation",
      baseline: observation(),
      candidate: observation({
        evaluated: false,
        sourceDistance: null,
        attributionDelayMs: null,
      }),
    },
  ]);
  assert.equal(undecodedConfirmation.discoveryEvaluationStatus, "complete");
  assert.equal(undecodedConfirmation.confirmationReproductionStatus, "not-run");
  assert.equal(undecodedConfirmation.repeatedRecoveryOutcome, "material-partial-recovery");
  assert.equal(evaluateListenAblationStop({
    selectedProfileIds: ["selected"],
    repeatedRecoveryByProfile: new Map([["selected", undecodedConfirmation]]),
  }).satisfied, true);

  const measuredRegression = [...incompleteComparisons];
  measuredRegression[0] = {
    ...measuredRegression[0],
    candidate: observation({ sourceDistance: 3, attributionDelayMs: 2_000 }),
  };
  const incompleteWithRegression = evaluateListenRepeatedRecovery(measuredRegression);
  assert.equal(incompleteWithRegression.discoveryEvaluationStatus, "incomplete");
  assert.equal(incompleteWithRegression.noRegression, false);
  assert.equal(incompleteWithRegression.repeatedRecoveryOutcome, "regressed");
  assert.deepEqual(evaluateListenAblationStop({
    selectedProfileIds: ["selected"],
    repeatedRecoveryByProfile: new Map([["selected", incompleteWithRegression]]),
  }).reasons, [
    "selected-discovery-stratum-not-decoded",
    "selected-repeated-recovery-regression",
  ]);
});

test("full-resolution labels require every known and reproducing unseen group", () => {
  const fullDiscovery = repeatedComparisons({ candidateDistance: 0, candidateDelayMs: 200 });
  const discovery = evaluateListenRepeatedRecovery(fullDiscovery);
  assert.equal(discovery.repeatedRecoveryOutcome, "discovery-full-resolution");

  const inconclusive = evaluateListenRepeatedRecovery([
    ...fullDiscovery,
    {
      groupId: "unseen-non-reproducing",
      stratum: "unseen",
      evidenceRole: "confirmation",
      baseline: observation({
        firstCorrectFullChordAttackIncomplete: false,
        sourceDistance: 0,
        attributionDelayMs: 200,
      }),
      candidate: observation({ sourceDistance: 0, attributionDelayMs: 200 }),
    },
  ]);
  assert.equal(inconclusive.confirmationReproductionStatus, "inconclusive-no-reproduction");
  assert.equal(inconclusive.repeatedRecoveryOutcome, "discovery-full-resolution");
  assert.deepEqual(inconclusive.inconclusiveConfirmationGroupIds, ["unseen-non-reproducing"]);

  const reproduced = {
    groupId: "unseen-reproducing",
    stratum: "unseen",
    evidenceRole: "confirmation" as const,
    baseline: observation(),
    candidate: observation({ sourceDistance: 0, attributionDelayMs: 200 }),
  };
  const confirmed = evaluateListenRepeatedRecovery([...fullDiscovery, reproduced]);
  assert.equal(confirmed.confirmationReproductionStatus, "reproduced");
  assert.equal(confirmed.repeatedRecoveryOutcome, "confirmed-full-resolution");

  const secondFailure = {
    ...reproduced,
    groupId: "unseen-reproducing-failure",
    candidate: observation({ sourceDistance: 1, attributionDelayMs: 1_400 }),
  };
  const notConfirmed = evaluateListenRepeatedRecovery([
    ...fullDiscovery,
    reproduced,
    secondFailure,
  ]);
  assert.equal(notConfirmed.confirmationReproductionStatus, "reproduced");
  assert.equal(notConfirmed.confirmedFullResolution, false);
  assert.equal(notConfirmed.repeatedRecoveryOutcome, "discovery-full-resolution");
  assert.throws(
    () => evaluateListenRepeatedRecovery([
      ...fullDiscovery,
      {
        ...reproduced,
        groupId: "malformed-unseen",
        baseline: observation({ structurallyValid: false }),
      },
    ]),
    /malformed repeated-recovery group/,
    "malformed confirmation evidence restarts the round instead of becoming inconclusive",
  );
});

test("the material-recovery boundary controls the next-ablation transition exactly", () => {
  const atBoundary = evaluateListenRepeatedRecovery(repeatedComparisons({
    candidateDistance: 1,
    candidateDelayMs: 2_000 - LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
  }));
  const justBelow = evaluateListenRepeatedRecovery(repeatedComparisons({
    candidateDistance: 1,
    candidateDelayMs: 2_000 - LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS + 0.001,
  }));
  assert.equal(atBoundary.materialRecovery, true);
  assert.equal(justBelow.materialRecovery, false);
  assert.deepEqual(evaluateListenAblationStop({
    selectedProfileIds: ["selected"],
    repeatedRecoveryByProfile: new Map([["selected", atBoundary]]),
  }), {
    satisfied: true,
    runNextAblation: false,
    reasons: [],
  });
  assert.deepEqual(evaluateListenAblationStop({
    selectedProfileIds: ["selected"],
    repeatedRecoveryByProfile: new Map([["selected", justBelow]]),
  }), {
    satisfied: false,
    runNextAblation: true,
    reasons: ["selected-set-has-no-material-repeated-recovery"],
  });
  assert.deepEqual(evaluateListenAblationStop({
    selectedProfileIds: [],
    repeatedRecoveryByProfile: new Map(),
  }).reasons, ["no-search-selected-candidate"]);
});

test("a bass axis is supported only by a passing grid and separation from its twin", () => {
  const repeated = evaluateListenRepeatedRecovery(repeatedComparisons());
  const merelyAlongForRide = evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: true,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: true,
    axisWorstDomainRegret: 0.1,
    twinWorstDomainRegret: 0.1,
    repeatedRecoveryAgainstTwin: evaluateListenRepeatedRecovery(repeatedComparisons({
      baselineDistance: 1,
      baselineDelayMs: 1_400,
      candidateDistance: 1,
      candidateDelayMs: 1_400,
    })),
  });
  assert.equal(merelyAlongForRide.supported, false);
  assert.ok(merelyAlongForRide.reasons.includes("axis-does-not-separate-from-twin"));

  const categorical = evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: true,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: false,
    axisWorstDomainRegret: 0.1,
    twinWorstDomainRegret: 0.1,
    repeatedRecoveryAgainstTwin: repeated,
  });
  assert.equal(categorical.supported, true);

  const incompletePair = evaluateListenRepeatedRecovery([
    ...repeatedComparisons(),
    {
      groupId: "paired-stratum-not-decoded",
      stratum: "paired-unmeasured-stratum",
      evidenceRole: "discovery",
      baseline: observation(),
      candidate: observation({
        evaluated: false,
        sourceDistance: null,
        attributionDelayMs: null,
      }),
    },
  ]);
  const categoricalWithoutCompletePairEvidence = evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: true,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: false,
    axisWorstDomainRegret: 0.1,
    twinWorstDomainRegret: 0.1,
    repeatedRecoveryAgainstTwin: incompletePair,
  });
  assert.equal(categoricalWithoutCompletePairEvidence.supported, false);
  assert.deepEqual(categoricalWithoutCompletePairEvidence.reasons, [
    "repeated-recovery-discovery-incomplete-against-twin",
  ]);
  const regretGainWithoutCompletePairEvidence = evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: true,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: true,
    axisWorstDomainRegret: 0.1,
    twinWorstDomainRegret: 0.2,
    repeatedRecoveryAgainstTwin: incompletePair,
  });
  assert.equal(regretGainWithoutCompletePairEvidence.materialRegretGain, true);
  assert.equal(regretGainWithoutCompletePairEvidence.supported, false);
  assert.deepEqual(regretGainWithoutCompletePairEvidence.reasons, [
    "repeated-recovery-discovery-incomplete-against-twin",
  ]);

  const gridFailed = evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: false,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: false,
    axisWorstDomainRegret: 0.1,
    twinWorstDomainRegret: 0.1,
    repeatedRecoveryAgainstTwin: repeated,
  });
  assert.equal(gridFailed.supported, false);
  assert.ok(gridFailed.reasons.includes("bass-grid-failed-stop-rule"));
});

test("the committed Task 24 archive is a detail-only re-export of Task 08", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const task08 = JSON.parse(readFileSync(join(
    root,
    "benchmark-results/listen-matcher-multidomain-sweep-task08.json",
  ), "utf8"))[0];
  const task24 = JSON.parse(readFileSync(join(
    root,
    "benchmark-results/listen-matcher-domain-archive-task24.json",
  ), "utf8"))[0];
  assert.equal(task24.task24.task08Parity.reproduced, true);
  assert.equal(task24.task24.task08Parity.aggregateCandidateDigest,
    task08.candidateArchive.digest.value);
  assert.equal(task24.task24.candidateCount, task08.candidateArchive.candidateCount);
  assert.equal(task24.task24.candidates.length, 1_000);
  assert.ok(task24.task24.candidates.every((candidate: { leafDomains: unknown[] }) => (
    candidate.leafDomains.length > 0
  )));
  const withoutTask24 = { ...task24 };
  delete withoutTask24.task24;
  const withoutTask08Archive = { ...task08 };
  delete withoutTask08Archive.candidateArchive;
  // Configuration names describe different export commands; every measured
  // aggregate field below them is identical.
  delete withoutTask24.name;
  delete withoutTask08Archive.name;
  assert.deepEqual(withoutTask24, withoutTask08Archive);
  assert.equal(task24.task24.confirmationTraceCountRead, 0);
});
