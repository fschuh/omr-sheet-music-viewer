import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
} from "./listenBenchmarkAudio";
import {
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
} from "./listenBaselineParity";
import {
  materializeListenSequence,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceDefinition,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import { replayListenSafetyRegressions } from "./listenSafetyRegression";
import {
  DeterministicHasher,
  LISTEN_TRACE_MANIFEST,
  type ListenTraceDescriptor,
} from "./listenTraceManifest";
import type { ListenMultiDomainCapture } from "./listenMatcherSweepBenchmark";
import {
  LISTEN_BASELINE_PROFILE,
  LISTEN_BASELINE_PROFILE_ID,
} from "./listenBaselineParity";
import {
  listenExperimentalBassOnsetThreshold,
  listenExperimentalThresholds,
  matcherOptionsForListenExperimentalProfile,
  type ListenExperimentalBassOnsetThresholds,
} from "./listenExperimentalBassOnset";
import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  listenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
  LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
  LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
  LISTEN_REPEATED_DELAY_NO_REGRESSION_MS,
  LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS,
  evaluateListenAblationStop,
  evaluateListenBassAxisPairSupport,
  listenRepeatedRecoveryReproduces,
  type ListenAblationStopResult,
  type ListenRepeatedRecoveryEvaluation,
  type ListenRepeatedRecoveryObservation,
} from "./listenMatcherSelectionPolicy";
import {
  LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS,
  LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS,
  generateListenMatcherSweepProfiles,
} from "./listenMatcherSweepBenchmark";
import {
  LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM,
  LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM,
  evaluateListenRoundTwoAblations,
  LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
  listenProductionThresholdShapeExcludesBassAxis,
  listenRoundTwoAttributedRecoverySpan,
  listenRoundTwoRepeatedGroups,
  listenRoundTwoRepeatedMeasurement,
  listenRoundTwoRepeatedProfileReport,
  listenRoundTwoTerminalOutcome,
  type ListenRoundTwoAblationResult,
  type ListenRoundTwoAblationTransition,
  type ListenRoundTwoRepeatedGroup,
  type ListenRoundTwoRepeatedMeasurement,
} from "./listenRoundTwoAblationBenchmark";
import {
  LISTEN_ROUND_TWO_BASS_ONSET_POINTS,
  LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS,
  generateListenRoundTwoBassAxisProfiles,
  generateListenRoundTwoRefinedProfiles,
  listenRoundTwoAblationGrid,
  type ListenRoundTwoAblationId,
  type ListenRoundTwoSweepProfile,
} from "./listenRoundTwoGenerator";

/* ------------------------------------------------------------------------- *
 * The staged grids
 * ------------------------------------------------------------------------- */

test("ablation one is the immutable round-one grid and nothing else", () => {
  const roundOne = generateListenMatcherSweepProfiles();
  const grid = listenRoundTwoAblationGrid("ablation-1-round-one-grid");
  assert.equal(grid.gridSize, 1_000);
  assert.equal(roundOne.length, 1_000);
  assert.equal(grid.bassAxisPresent, false);
  assert.equal(grid.matchedPairCount, 0);
  assert.deepEqual(grid.profiles.map(({ id }) => id), roundOne.map(({ id }) => id));
  assert.ok(grid.profiles.every((profile, index) => (
    profile.onsetThreshold === roundOne[index].onsetThreshold &&
    profile.targetNoteThreshold === roundOne[index].targetNoteThreshold &&
    profile.activeTargetThreshold === roundOne[index].activeTargetThreshold &&
    profile.extraNoteThreshold === roundOne[index].extraNoteThreshold &&
    profile.requireFreshBassOnset === roundOne[index].requireFreshBassOnset &&
    profile.distanceFromProduction === roundOne[index].distanceFromProduction &&
    profile.bassOnsetThreshold === null
  )));
  // Only the first ablation's grid is 1,000 rows.
  assert.notEqual(listenRoundTwoAblationGrid("ablation-2-refined-family").gridSize, 1_000);
});

test("the refined family adds only the frozen refinement points and keeps fresh bass", () => {
  const grid = listenRoundTwoAblationGrid("ablation-2-refined-family");
  assert.equal(grid.bassAxisPresent, false);
  assert.equal(grid.matchedPairCount, 0);
  assert.deepEqual(grid.requireFreshBassOnsetValues, [true]);
  assert.deepEqual(grid.onsetThresholds, [...LISTEN_MATCHER_SWEEP_ONSET_THRESHOLDS]);
  assert.deepEqual(grid.extraNoteThresholds, [...LISTEN_MATCHER_SWEEP_EXTRA_THRESHOLDS]);
  assert.deepEqual(
    grid.targetNoteThresholds,
    [...LISTEN_MATCHER_SWEEP_TARGET_THRESHOLDS, ...LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS]
      .sort((left, right) => left - right),
  );
  // The active-target points are Task 24's, quoted rather than re-chosen here.
  assert.deepEqual(
    grid.activeTargetThresholds,
    [...LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS, ...LISTEN_ROUND_TWO_ACTIVE_TARGET_REFINEMENT_POINTS]
      .sort((left, right) => left - right),
  );
  assert.equal(
    grid.gridSize,
    grid.onsetThresholds.length * grid.targetNoteThresholds.length *
      grid.activeTargetThresholds.length * grid.extraNoteThresholds.length,
  );
  assert.equal(grid.gridSize, 1_400);

  // Every fresh-bass row of round one survives under its own identifier, so a
  // refinement result can be read against the round-one row it refines.
  const refined = new Set(grid.profiles.map(({ id }) => id));
  const roundOneFreshBass = generateListenMatcherSweepProfiles()
    .filter(({ requireFreshBassOnset }) => requireFreshBassOnset);
  assert.equal(roundOneFreshBass.length, 500);
  assert.deepEqual(roundOneFreshBass.filter(({ id }) => !refined.has(id)), []);
});

test("the bass grid is the identical refined grid crossed with its own axis", () => {
  const refined = generateListenRoundTwoRefinedProfiles();
  const grid = listenRoundTwoAblationGrid("ablation-3-bass-axis");
  const twins = grid.profiles.filter(({ bassOnsetThreshold }) => bassOnsetThreshold === null);
  const axis = grid.profiles.filter(({ bassOnsetThreshold }) => bassOnsetThreshold !== null);
  assert.equal(grid.bassAxisPresent, true);
  assert.deepEqual(twins.map(({ id }) => id), refined.map(({ id }) => id));
  assert.deepEqual(grid.bassOnsetThresholds, [...LISTEN_ROUND_TWO_BASS_ONSET_POINTS]);
  assert.equal(grid.matchedPairCount, axis.length);
  assert.equal(grid.gridSize, twins.length + axis.length);

  const twinById = new Map(twins.map((profile) => [profile.id, profile]));
  for (const profile of axis) {
    const twin = twinById.get(profile.matchedTwinProfileId ?? "");
    assert.ok(twin, `${profile.id} has no matched twin`);
    // Identical in every other coordinate: that is what makes it a control.
    assert.deepEqual(
      { ...profile, id: "", bassOnsetThreshold: null, distanceFromProduction: 0,
        matchedTwinProfileId: null },
      { ...twin, id: "", bassOnsetThreshold: null, distanceFromProduction: 0,
        matchedTwinProfileId: null },
    );
    // The axis exists to refuse a bass onset the general gate would admit.
    assert.ok((profile.bassOnsetThreshold ?? 0) > profile.onsetThreshold);
    assert.notEqual(profile.distanceFromProduction, twin.distanceFromProduction);
  }
  assert.equal(
    axis.length,
    refined.filter(({ onsetThreshold }) => (
      LISTEN_ROUND_TWO_BASS_ONSET_POINTS.some((point) => point > onsetThreshold)
    )).reduce((total, { onsetThreshold }) => (
      total + LISTEN_ROUND_TWO_BASS_ONSET_POINTS.filter((point) => point > onsetThreshold).length
    ), 0),
  );
});

test("every staged grid carries the incumbent and unique identifiers", () => {
  const baselineId = generateListenMatcherSweepProfiles().find((profile) => (
    profile.distanceFromProduction === 0
  ))?.id;
  assert.equal(baselineId, "o0p600-t0p500-a0p350-x0p970-b1");
  for (const ablation of [
    "ablation-1-round-one-grid",
    "ablation-2-refined-family",
    "ablation-3-bass-axis",
  ] as const) {
    const grid = listenRoundTwoAblationGrid(ablation);
    assert.equal(new Set(grid.profiles.map(({ id }) => id)).size, grid.gridSize);
    assert.ok(grid.profiles.some(({ id }) => id === baselineId), `${ablation} lost the incumbent`);
    assert.equal(grid.gridVersion, `round-two-v1/${ablation}`);
  }
  // A refinement point names its own value rather than a rounded one.
  assert.ok(generateListenRoundTwoRefinedProfiles().some(({ id }) => id.includes("t0p4625")));
  assert.ok(generateListenRoundTwoBassAxisProfiles().some(({ id }) => id.endsWith("-B0p700")));
});

/* ------------------------------------------------------------------------- *
 * The axis stays out of the production shape
 * ------------------------------------------------------------------------- */

test("the production threshold shape does not carry the bass axis", () => {
  assert.equal(listenProductionThresholdShapeExcludesBassAxis(), true);
  for (const id of LISTEN_MATCHER_PROFILE_IDS) {
    assert.ok(!("bassOnsetThreshold" in LISTEN_MATCHER_PROFILES[id]));
    assert.ok(!("bassOnsetThreshold" in matcherOptionsForListenMatcherProfile(id)));
    assert.ok(!("bassOnsetThreshold" in listenMatcherThresholds(LISTEN_MATCHER_PROFILES[id])));
  }
  // The guard is a recomputation, not a constant: a registry that gained the
  // axis fails it.
  assert.equal(
    listenProductionThresholdShapeExcludesBassAxis({
      ...LISTEN_MATCHER_PROFILES,
      [LISTEN_BASELINE_PROFILE_ID]: {
        ...LISTEN_MATCHER_PROFILES[LISTEN_BASELINE_PROFILE_ID],
        bassOnsetThreshold: 0.6,
      } as ListenMatcherThresholds,
    }),
    false,
  );
});

test("the experimental conversion is inert without a declared bass gate", () => {
  for (const id of LISTEN_MATCHER_PROFILE_IDS) {
    assert.deepEqual(
      matcherOptionsForListenExperimentalProfile(id),
      matcherOptionsForListenMatcherProfile(id),
    );
    assert.equal(listenExperimentalBassOnsetThreshold(LISTEN_MATCHER_PROFILES[id]), null);
  }
  const declared = { ...LISTEN_BASELINE_PROFILE, bassOnsetThreshold: 0.7 };
  assert.equal(listenExperimentalBassOnsetThreshold(declared), 0.7);
  assert.equal(matcherOptionsForListenExperimentalProfile(declared).bassOnsetThreshold, 0.7);
  // A null declaration is the compatibility default and emits no option at all.
  assert.deepEqual(
    matcherOptionsForListenExperimentalProfile({
      ...LISTEN_BASELINE_PROFILE,
      bassOnsetThreshold: null,
    }),
    matcherOptionsForListenMatcherProfile(LISTEN_BASELINE_PROFILE),
  );
  // The production projection drops the axis, which is why replay paths must
  // normalize through the experimental one instead.
  assert.ok(!("bassOnsetThreshold" in listenMatcherThresholds(declared)));
  assert.equal(listenExperimentalThresholds(declared).bassOnsetThreshold, 0.7);

  // A profile that believes it is running the axis is never measured without it.
  for (const invalid of [1.5, -0.1, Number.NaN, "0.6"] as unknown[]) {
    assert.throws(
      () => matcherOptionsForListenExperimentalProfile({
        ...LISTEN_BASELINE_PROFILE,
        bassOnsetThreshold: invalid as number,
      }),
      /Invalid experimental bass onset threshold/,
    );
  }
  assert.throws(
    () => new ExactChordMatcher({ ...LISTEN_BASELINE_PROFILE, bassOnsetThreshold: 2 }),
    /Invalid bass onset threshold/,
  );
});

/* ------------------------------------------------------------------------- *
 * The repeated-chord census
 * ------------------------------------------------------------------------- */

test("the repeated-chord census names the known runs and every authored discovery group", () => {
  const groups = listenRoundTwoRepeatedGroups();
  assert.deepEqual(groups.map(({ groupId }) => groupId), [
    "dynamics-constant/tone/salamander/v05",
    "dynamics-constant/tone/salamander/v13",
    "dynamics-mixed/tone/salamander",
    "round-two/r2-repeated-low-triad-direct-splendid-pp/correct",
    "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/correct",
  ]);
  assert.deepEqual(
    groups.filter(({ origin }) => origin === "known-round-one")
      .map(({ chordPitches }) => chordPitches),
    [[62, 74, 82], [62, 74, 82], [62, 74, 82]],
  );
  assert.deepEqual(
    groups.filter(({ origin }) => origin === "round-two-authored")
      .map(({ chordPitches }) => chordPitches),
    [[40, 55, 59], [55, 67, 71, 76]],
  );
  assert.deepEqual(
    [...new Set(groups.map(({ stratum }) => stratum))],
    [LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM, LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM],
  );
});

/* ------------------------------------------------------------------------- *
 * Constructed repeated-recovery observations
 * ------------------------------------------------------------------------- */

const BASELINE_DELAY_MS = 2_220;

function observation(
  overrides: Partial<ListenRepeatedRecoveryObservation> = {},
): ListenRepeatedRecoveryObservation {
  return {
    evaluated: true,
    structurallyValid: true,
    firstCorrectFullChordAttackIncomplete: true,
    carriedRequiredPitchWithoutFreshReOnset: true,
    laterIdenticalAttackRecoveredCorrectTarget: true,
    sourceDistance: 2,
    attributionDelayMs: BASELINE_DELAY_MS,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    ...overrides,
  };
}

function measurement(
  group: ListenRoundTwoRepeatedGroup,
  profileId: string,
  observed: ListenRepeatedRecoveryObservation,
): ListenRoundTwoRepeatedMeasurement {
  return {
    groupId: group.groupId,
    traceId: group.traceId,
    origin: group.origin,
    stratum: group.stratum,
    chordPitches: [...group.chordPitches],
    profileId,
    observation: observed,
    bestSourceDistance: observed.sourceDistance,
    worstSourceDistance: observed.sourceDistance,
    runResolution: observed.sourceDistance === null
      ? "unrecovered"
      : observed.sourceDistance === 0
      ? "recovered-at-source-distance-0"
      : observed.sourceDistance === 1
      ? "partial-recovery-at-source-distance-1"
      : "late-recovery-beyond-source-distance-1",
    earlyAttributedTargetIndexes: [],
    targets: [],
    attacks: [],
    transitionLowestLimitingUpperVoiceEvidence: null,
  };
}

/**
 * The census with one observation per group, keyed the way the report expects.
 *
 * `known` and `authored` are given separately, because the whole question a
 * stratum answers is whether the two sets of groups are treated alike.
 */
function measurements(
  profileId: string,
  known: (group: ListenRoundTwoRepeatedGroup, index: number) => ListenRepeatedRecoveryObservation,
  authored: (
    group: ListenRoundTwoRepeatedGroup,
    index: number,
  ) => ListenRepeatedRecoveryObservation,
): Map<string, ListenRoundTwoRepeatedMeasurement> {
  const groups = listenRoundTwoRepeatedGroups();
  let knownIndex = 0;
  let authoredIndex = 0;
  return new Map(groups.map((group) => [
    group.groupId,
    measurement(
      group,
      profileId,
      group.origin === "known-round-one"
        ? known(group, knownIndex++)
        : authored(group, authoredIndex++),
    ),
  ]));
}

/** The incumbent late on every declared group, so one stratum can be varied alone. */
function incumbentMeasurements(): Map<string, ListenRoundTwoRepeatedMeasurement> {
  return measurements(LISTEN_BASELINE_PROFILE_ID, () => observation(), () => observation());
}

function report(
  candidate: Map<string, ListenRoundTwoRepeatedMeasurement>,
  reference: Map<string, ListenRoundTwoRepeatedMeasurement> = incumbentMeasurements(),
  profileId = "candidate",
) {
  return listenRoundTwoRepeatedProfileReport({
    groups: listenRoundTwoRepeatedGroups(),
    reference,
    candidate,
    profileId,
    comparedAgainstProfileId: LISTEN_BASELINE_PROFILE_ID,
  });
}

/** A group the reference profile already recovers on the attack that sounds it. */
function alreadyRecovered(): ListenRepeatedRecoveryObservation {
  return observation({
    firstCorrectFullChordAttackIncomplete: false,
    laterIdenticalAttackRecoveredCorrectTarget: false,
    sourceDistance: 0,
    attributionDelayMs: 0,
  });
}

/**
 * A materially recovered group, used for the stratum a test is holding fixed.
 *
 * Task 24's frozen rule requires material recovery in every declared discovery
 * stratum, so a test that varies one stratum has to satisfy the other or it
 * measures the aggregation rather than the boundary it is about.
 */
function materiallyRecovered(): ListenRepeatedRecoveryObservation {
  return observation({ sourceDistance: 0, attributionDelayMs: 0 });
}

function stopFor(evaluation: ListenRepeatedRecoveryEvaluation, profileId = "candidate") {
  return evaluateListenAblationStop({
    selectedProfileIds: [profileId],
    repeatedRecoveryByProfile: new Map([[profileId, evaluation]]),
  });
}

test("every declared discovery stratum is handed to the frozen rule, reproducing or not", () => {
  const authored = listenRoundTwoRepeatedGroups()
    .filter(({ origin }) => origin === "round-two-authored")
    .map(({ groupId }) => groupId);

  // Task 24 froze the `inconclusive-for-repeated-recovery` outcome for
  // confirmation groups only. A discovery group whose reference run already
  // recovers on its own attack therefore stays in the stratum census, no
  // candidate can improve it, and the stop rule fails closed and authorises the
  // next ablation — which is exactly the transition this round turns on.
  const alreadyRecoveredReference = measurements(
    LISTEN_BASELINE_PROFILE_ID,
    () => observation(),
    () => alreadyRecovered(),
  );
  const candidate = report(
    measurements(
      "candidate",
      () => observation({ sourceDistance: 1, attributionDelayMs: 1_220 }),
      () => alreadyRecovered(),
    ),
    alreadyRecoveredReference,
  );
  assert.deepEqual(candidate.declaredStrata, [
    LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM,
    LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM,
  ].sort());
  assert.deepEqual(candidate.nonReproducingGroupIds, authored);
  assert.equal(candidate.measurements.length, 5);
  assert.deepEqual(
    candidate.evaluation.materialRecoveryByStratum.map(({ stratum, material }) => (
      [stratum, material]
    )),
    [
      [LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM, true],
      [LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM, false],
    ],
  );
  assert.equal(candidate.evaluation.noRegression, true);
  assert.equal(candidate.evaluation.materialRecovery, false);
  assert.deepEqual(
    stopFor(candidate.evaluation).reasons,
    ["selected-set-has-no-material-repeated-recovery"],
  );
  assert.equal(stopFor(candidate.evaluation).runNextAblation, true);

  // The same candidate satisfies the rule only when every declared stratum has a
  // material recovery in it.
  const bothStrata = report(measurements(
    "candidate",
    () => observation({ sourceDistance: 1, attributionDelayMs: 1_220 }),
    () => materiallyRecovered(),
  ));
  assert.equal(bothStrata.evaluation.materialRecovery, true);
  assert.equal(stopFor(bothStrata.evaluation).satisfied, true);
  assert.equal(bothStrata.evaluation.repeatedRecoveryOutcome, "material-partial-recovery");
  assert.equal(bothStrata.evaluation.confirmationReproductionStatus, "not-run");
  assert.equal(bothStrata.evaluation.confirmedFullResolution, false);
});

test("the material-recovery boundary decides the ablation transition exactly", () => {
  const atBoundary = report(measurements(
    "candidate",
    () => observation({
      sourceDistance: 1,
      attributionDelayMs: BASELINE_DELAY_MS - LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
    }),
    () => materiallyRecovered(),
  ));
  assert.equal(atBoundary.evaluation.materialRecovery, true);
  assert.equal(stopFor(atBoundary.evaluation).satisfied, true);
  assert.deepEqual(
    listenRoundTwoTerminalOutcome([
      { ablation: "ablation-1-round-one-grid", stop: stopFor(atBoundary.evaluation) },
    ]).outcome,
    "existing-grid-sufficient",
  );

  const justUnder = report(measurements(
    "candidate",
    () => observation({
      sourceDistance: 1,
      attributionDelayMs: BASELINE_DELAY_MS - LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS + 0.5,
    }),
    () => materiallyRecovered(),
  ));
  assert.equal(justUnder.evaluation.materialRecovery, false);
  assert.deepEqual(
    stopFor(justUnder.evaluation).reasons,
    ["selected-set-has-no-material-repeated-recovery"],
  );
  assert.equal(stopFor(justUnder.evaluation).runNextAblation, true);

  // A delay gain without a full attack of distance gain is not material either.
  const delayOnly = report(measurements(
    "candidate",
    () => observation({ sourceDistance: 2, attributionDelayMs: 100 }),
    () => materiallyRecovered(),
  ));
  assert.equal(delayOnly.evaluation.materialRecovery, false);
  assert.equal(delayOnly.evaluation.repeatedRecoveryOutcome, "unchanged");
});

test("a regression in one repeated run cannot be averaged away by another", () => {
  const mixed = report(measurements(
    "candidate",
    (_group, index) => index === 0
      // Categorically material: unrecovered to recovered on its own attack.
      ? observation({ sourceDistance: 0, attributionDelayMs: 0 })
      // A full attack later than the incumbent on another run.
      : observation({ sourceDistance: 3, attributionDelayMs: BASELINE_DELAY_MS + 1_000 }),
    () => materiallyRecovered(),
  ));
  // The mean distance across the known runs improves, and it changes nothing.
  assert.equal(mixed.evaluation.materialRecovery, true);
  assert.equal(mixed.evaluation.noRegression, false);
  assert.equal(mixed.evaluation.repeatedRecoveryOutcome, "regressed");
  assert.deepEqual(stopFor(mixed.evaluation).reasons, ["selected-repeated-recovery-regression"]);
  assert.deepEqual(
    mixed.evaluation.groups.filter(({ noRegression }) => !noRegression).map(({ groupId }) => (
      groupId
    )),
    ["dynamics-constant/tone/salamander/v13", "dynamics-mixed/tone/salamander"],
  );
});

test("one decoder hop of delay is tolerated and one millisecond more is a regression", () => {
  const tolerated = report(measurements(
    "candidate",
    () => observation({
      attributionDelayMs: BASELINE_DELAY_MS + LISTEN_REPEATED_DELAY_NO_REGRESSION_MS,
    }),
    () => materiallyRecovered(),
  ));
  assert.equal(tolerated.evaluation.noRegression, true);
  const regressed = report(measurements(
    "candidate",
    () => observation({
      attributionDelayMs: BASELINE_DELAY_MS + LISTEN_REPEATED_DELAY_NO_REGRESSION_MS + 1,
    }),
    () => materiallyRecovered(),
  ));
  assert.equal(regressed.evaluation.noRegression, false);
});

test("an undecoded declared group fails the stop rule closed", () => {
  const undecoded = report(measurements(
    "candidate",
    (_group, index) => index === 0
      ? observation({
        evaluated: false,
        structurallyValid: false,
        sourceDistance: null,
        attributionDelayMs: null,
      })
      : observation({ sourceDistance: 0, attributionDelayMs: 0 }),
    () => materiallyRecovered(),
  ));
  assert.equal(undecoded.evaluation.discoveryEvaluationStatus, "incomplete");
  assert.equal(undecoded.evaluation.noRegression, true);
  assert.deepEqual(
    stopFor(undecoded.evaluation).reasons,
    ["selected-discovery-stratum-not-decoded"],
  );
  // The group is retained in the census rather than disappearing from it, and so
  // is every other declared group.
  assert.equal(undecoded.evaluation.groups.length, 5);
});

test("an empty selected set stops nothing and authorises the next ablation", () => {
  const stop = evaluateListenAblationStop({
    selectedProfileIds: [],
    repeatedRecoveryByProfile: new Map(),
  });
  assert.deepEqual(stop.reasons, ["no-search-selected-candidate"]);
  assert.equal(stop.runNextAblation, true);
});

/* ------------------------------------------------------------------------- *
 * Terminal outcome transitions
 * ------------------------------------------------------------------------- */

const SATISFIED: ListenAblationStopResult = {
  satisfied: true,
  runNextAblation: false,
  reasons: [],
};
const FAILED: ListenAblationStopResult = {
  satisfied: false,
  runNextAblation: true,
  reasons: ["selected-set-has-no-material-repeated-recovery"],
};

function transition(
  ablation: ListenRoundTwoAblationTransition["ablation"],
  stop: ListenRoundTwoAblationTransition["stop"],
  matchedPairs?: ListenRoundTwoAblationTransition["matchedPairs"],
): ListenRoundTwoAblationTransition {
  return { ablation, stop, matchedPairs };
}

/**
 * The pair comparison with the axis behaving exactly like its twin on every
 * repeated run, so each test states which single criterion it is exercising.
 */
function unchangedAgainstTwin(): ListenRepeatedRecoveryEvaluation {
  const twin = measurements("twin", () => observation(), () => observation());
  const axis = measurements("axis", () => observation(), () => observation());
  return report(axis, twin, "axis").evaluation;
}

function support(overrides: Partial<Parameters<typeof evaluateListenBassAxisPairSupport>[0]> = {}) {
  return evaluateListenBassAxisPairSupport({
    ablationStopSatisfied: true,
    axisProfileSelected: true,
    axisSafe: true,
    twinSafe: false,
    axisWorstDomainRegret: 0.02,
    twinWorstDomainRegret: 0.02,
    repeatedRecoveryAgainstTwin: unchangedAgainstTwin(),
    ...overrides,
  });
}

test("each terminal outcome is reached only by its own frozen transition", () => {
  assert.equal(
    listenRoundTwoTerminalOutcome([transition("ablation-1-round-one-grid", SATISFIED)]).outcome,
    "existing-grid-sufficient",
  );
  assert.equal(
    listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
      transition("ablation-2-refined-family", SATISFIED),
    ]).outcome,
    "existing-family-refinement-sufficient",
  );
  assert.equal(
    listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
      transition("ablation-2-refined-family", FAILED),
      transition("ablation-3-bass-axis", SATISFIED, [{ support: support() }]),
    ]).outcome,
    "bass-axis-supported",
  );
  // A passing bass grid whose selected profiles do not separate from their own
  // twins is unsupported, and says so as the zero branch it routes to.
  const ridingAlong = listenRoundTwoTerminalOutcome([
    transition("ablation-1-round-one-grid", FAILED),
    transition("ablation-2-refined-family", FAILED),
    transition("ablation-3-bass-axis", SATISFIED, [{
      support: support({ axisSafe: true, twinSafe: true, twinWorstDomainRegret: 0.02 }),
    }]),
  ]);
  assert.equal(ridingAlong.outcome, "bass-axis-unsupported");
  assert.match(ridingAlong.reason, /no selected bass profile separated/);
  const gridFailed = listenRoundTwoTerminalOutcome([
    transition("ablation-1-round-one-grid", FAILED),
    transition("ablation-2-refined-family", FAILED),
    transition("ablation-3-bass-axis", FAILED, []),
  ]);
  assert.equal(gridFailed.outcome, "bass-axis-unsupported");
  assert.match(gridFailed.reason, /failed the stop rule/);
});

test("no ablation may be recorded that its predecessor did not authorise", () => {
  assert.throws(
    () => listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", SATISFIED),
      transition("ablation-2-refined-family", FAILED),
    ]),
    /no further ablation was authorised/,
  );
  assert.throws(
    () => listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
      transition("ablation-2-refined-family", SATISFIED),
      transition("ablation-3-bass-axis", FAILED),
    ]),
    /ablation three was not authorised/,
  );
  assert.throws(
    () => listenRoundTwoTerminalOutcome([transition("ablation-2-refined-family", FAILED)]),
    /recorded no first ablation/,
  );
  assert.throws(
    () => listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
    ]),
    /ablation two did not run/,
  );
  assert.throws(
    () => listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
      transition("ablation-1-round-one-grid", FAILED),
    ]),
    /same ablation twice/,
  );
});

test("a bass axis cannot be supported by an aggregate that hides one run's regression", () => {
  const hidden = report(
    measurements(
      "axis",
      (_group, index) => index === 0
        ? observation({ sourceDistance: 0, attributionDelayMs: 0 })
        : observation({ sourceDistance: 3, attributionDelayMs: BASELINE_DELAY_MS + 2_000 }),
      () => materiallyRecovered(),
    ),
    measurements("twin", () => observation(), () => observation()),
    "axis",
  );
  assert.equal(hidden.evaluation.materialRecovery, true);
  const result = support({ repeatedRecoveryAgainstTwin: hidden.evaluation });
  assert.equal(result.supported, false);
  assert.deepEqual(result.reasons, ["repeated-recovery-regression-against-twin"]);
  assert.equal(
    listenRoundTwoTerminalOutcome([
      transition("ablation-1-round-one-grid", FAILED),
      transition("ablation-2-refined-family", FAILED),
      transition("ablation-3-bass-axis", SATISFIED, [{ support: result }]),
    ]).outcome,
    "bass-axis-unsupported",
  );

  // Nor by a separation claimed while the pair's discovery evidence is incomplete.
  const incomplete = report(
    measurements(
      "axis",
      (_group, index) => index === 0
        ? observation({
          evaluated: false,
          structurallyValid: false,
          sourceDistance: null,
          attributionDelayMs: null,
        })
        : observation({ sourceDistance: 0, attributionDelayMs: 0 }),
      () => materiallyRecovered(),
    ),
    measurements("twin", () => observation(), () => observation()),
    "axis",
  );
  const rescued = support({ repeatedRecoveryAgainstTwin: incomplete.evaluation });
  assert.equal(rescued.categoricalSafetyRescue, true);
  assert.equal(rescued.supported, false);
  assert.deepEqual(rescued.reasons, ["repeated-recovery-discovery-incomplete-against-twin"]);
});

test("pair support separates a categorical safety rescue from a material regret gain", () => {
  assert.equal(support().categoricalSafetyRescue, true);
  assert.equal(support().supported, true);
  const regretGain = support({
    twinSafe: true,
    axisWorstDomainRegret: 0.02,
    twinWorstDomainRegret: 0.02 + LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY,
  });
  assert.equal(regretGain.categoricalSafetyRescue, false);
  assert.equal(regretGain.materialRegretGain, true);
  assert.equal(regretGain.supported, true);
  const belowBoundary = support({
    twinSafe: true,
    axisWorstDomainRegret: 0.02,
    twinWorstDomainRegret: 0.02 + LISTEN_DOMAIN_REGRET_MATERIAL_BOUNDARY - 0.0001,
  });
  assert.equal(belowBoundary.materialRegretGain, false);
  assert.deepEqual(belowBoundary.reasons, ["axis-does-not-separate-from-twin"]);
  // A grid that failed its own stop rule cannot support the axis at all.
  assert.deepEqual(
    support({ ablationStopSatisfied: false }).reasons,
    ["bass-grid-failed-stop-rule"],
  );
});

/* ------------------------------------------------------------------------- *
 * Measured repeated recovery, replayed from a constructed capture
 * ------------------------------------------------------------------------- */

const PROBE_CHORD = [62, 74, 82];
const PROBE_UPPER = PROBE_CHORD.slice(1);

/** The chord the trace under measurement actually repeats. */
function probeChordFor(traceId: string): number[] {
  return listenRoundTwoRepeatedGroups().find(({ traceId: id }) => id === traceId)
    ?.chordPitches ?? PROBE_CHORD;
}

interface ProbeDecoded {
  midi: number;
  onset?: number;
  noteConfidence?: number;
  active: number;
  event?: boolean;
}

interface ProbeAttack {
  atMs: number;
  holdMs: number;
  decoded: ProbeDecoded[];
}

function probeDefinition(chord: readonly number[]): ListenSequenceDefinition {
  const upper = chord.slice(1);
  const resolution = chord.map((midi) => midi + 3);
  return {
    id: "round-two-probe-repeated",
    family: "round-two-repeated-identical",
    label: "round-two probe",
    targets: [upper, [...chord], [...chord], [...chord], resolution],
    attacks: [
      {
        at: 0,
        targetIndex: 0,
        notes: upper.map((midi) => ({ midi, holdMs: 6_000 })),
        expectedAdvance: true,
      },
      // The transition: every pitch of the chord sounds, and the bass is the
      // only one the decoder gives a fresh onset.
      {
        at: 1,
        targetIndex: 1,
        notes: chord.map((midi) => ({ midi, holdMs: 900 })),
        expectedAdvance: true,
      },
      {
        at: 2,
        targetIndex: 2,
        notes: chord.map((midi) => ({ midi, holdMs: 900 })),
        expectedAdvance: true,
      },
      {
        at: 3,
        targetIndex: 3,
        notes: chord.map((midi) => ({ midi, holdMs: 900 })),
        expectedAdvance: true,
      },
      { at: 4, targetIndex: 4, notes: resolution, expectedAdvance: true },
    ],
  };
}

/**
 * Continuous 32 ms frames, which is the cadence the decoder actually reports at.
 *
 * A trace with frames only where an attack lands never expires a collection
 * window, so the matcher would never start the fresh attempt a later repetition
 * depends on, and the fixture would measure a timing artefact of the fixture.
 */
function probeFrames(
  sequence: MaterializedListenSequence,
  attacks: readonly ProbeAttack[],
): ListenRecognitionFrame[] {
  const snapped = attacks.map((attack) => ({
    ...attack,
    atMs: Math.ceil(attack.atMs / 32) * 32,
  }));
  const last = snapped[snapped.length - 1];
  const frames: ListenRecognitionFrame[] = [];
  for (let capturedAtMs = 0; capturedAtMs <= last.atMs + last.holdMs; capturedAtMs += 32) {
    const sounding = new Map<number, number>();
    for (const attack of snapped) {
      if (capturedAtMs < attack.atMs || capturedAtMs >= attack.atMs + attack.holdMs) continue;
      for (const decoded of attack.decoded) sounding.set(decoded.midi, decoded.active);
    }
    const attacked = snapped.find((attack) => attack.atMs === capturedAtMs)?.decoded ?? [];
    frames.push({
      capturedAtMs,
      onsets: attacked.filter(({ onset }) => onset !== undefined).map((decoded) => ({
        midi: decoded.midi,
        confidence: decoded.onset!,
        noteConfidence: decoded.noteConfidence ?? decoded.onset!,
        onsetTimeMs: capturedAtMs,
      })),
      noteEvents: attacked.filter(({ event }) => event).map((decoded) => ({
        midi: decoded.midi,
        type: "onset" as const,
        confidence: decoded.onset ?? decoded.active,
        eventTimeMs: capturedAtMs,
      })),
      activePitches: [...sounding].map(([midi, confidence]) => ({ midi, confidence })),
      confidenceEvidence: sequence.relevantPitches.map((midi) => ({
        midi,
        confidence: sounding.get(midi) ?? 0,
      })),
      modelScores: [],
      modelStates: sequence.relevantPitches.map((midi) => sounding.has(midi) ? 3 : 0),
      signalActive: sounding.size > 0,
      inferenceDurationMs: 4,
    });
  }
  return frames;
}

function probeStrong(midi: number): ProbeDecoded {
  return { midi, onset: 0.99, noteConfidence: 0.99, active: 0.95, event: true };
}

/**
 * The `v05` mechanism as a constructed capture: a newly introduced bass with a
 * strong onset under carried upper voices the decoder does not re-onset, then a
 * repetition whose bass onset lands inside the recorded hallucination corridor
 * at 0.55 while its upper voices carry 0.46 of sustained evidence.
 */
function probeCapture(
  descriptor: ListenTraceDescriptor,
  options: { freshTransitionUpperVoices?: boolean } = {},
): ListenMultiDomainCapture {
  const chord = probeChordFor(descriptor.id);
  const [bass, ...upper] = chord;
  const definition = probeDefinition(chord);
  const sequence = materializeListenSequence(definition, 1_000);
  const at = (index: number) => sequence.attacks[index].scheduledAtMs;
  const attacks: ProbeAttack[] = [
    { atMs: at(0), holdMs: 6_000, decoded: upper.map(probeStrong) },
    {
      atMs: at(1),
      holdMs: 900,
      // Either the decoder gives the carried upper voices no onset at all, which
      // is what all three known runs show, or it re-onsets every chord member,
      // which is what the authored round-two renders show.
      decoded: options.freshTransitionUpperVoices
        ? chord.map(probeStrong)
        : [probeStrong(bass), ...upper.map((midi) => ({ midi, active: 0.19 }))],
    },
    {
      atMs: at(2),
      holdMs: 900,
      decoded: [
        { midi: bass, onset: 0.55, noteConfidence: 0.9, active: 0.9, event: true },
        ...upper.map((midi) => ({
          midi,
          onset: 0.3,
          noteConfidence: 0.9,
          active: 0.46,
          event: true,
        })),
      ],
    },
    { atMs: at(3), holdMs: 900, decoded: chord.map(probeStrong) },
    {
      atMs: at(4),
      holdMs: 900,
      decoded: definition.targets[4].map(probeStrong),
    },
  ];
  const trace: ListenRecognitionTrace = {
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: sequence.relevantPitches,
    renderer: descriptor.rendererKey === "tone"
      ? { ...LISTEN_BENCHMARK_TONE_RENDERER }
      : { ...LISTEN_BENCHMARK_RENDERER },
    audioDiagnostics: { frameCount: 512, durationMs: 32, peak: 0.5, rms: 0.1 },
    pcm: new Float32Array(512),
    frames: probeFrames(sequence, attacks),
    maximumInferenceMs: 4,
    maximumProcessingBacklogMs: 0,
  };
  const baselineRun = replayListenSequenceTrace(
    sequence,
    trace,
    "current-matcher",
    LISTEN_BASELINE_PROFILE,
  );
  return {
    descriptor,
    sequence,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineRun,
  };
}

const PROBE_GROUP: ListenRoundTwoRepeatedGroup = {
  groupId: "dynamics-constant/tone/salamander/v05",
  traceId: "dynamics-constant/tone/salamander/v05",
  origin: "known-round-one",
  stratum: LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM,
  chordPitches: PROBE_CHORD,
};

function probeDescriptor(traceId = PROBE_GROUP.traceId): ListenTraceDescriptor {
  const descriptor = LISTEN_TRACE_MANIFEST.traces.find(({ id }) => id === traceId);
  if (!descriptor) throw new Error(`The manifest has no ${traceId}.`);
  return descriptor;
}

function probeMeasurement(
  profile: ListenExperimentalBassOnsetThresholds,
  profileId = "probe",
  options: { freshTransitionUpperVoices?: boolean } = {},
) {
  return listenRoundTwoRepeatedMeasurement({
    group: PROBE_GROUP,
    capture: probeCapture(probeDescriptor(), options),
    profileId,
    profile,
  });
}

const PROBE_CANDIDATE: ListenExperimentalBassOnsetThresholds = {
  ...LISTEN_BASELINE_PROFILE,
  onsetThreshold: 0.45,
  activeTargetThreshold: 0.275,
  extraNoteThreshold: 0.99,
};

test("a measured repeated group reproduces the phenomenon and reports its own paths", () => {
  const incumbent = probeMeasurement(LISTEN_BASELINE_PROFILE, LISTEN_BASELINE_PROFILE_ID);
  assert.equal(incumbent.observation.structurallyValid, true);
  assert.equal(incumbent.observation.firstCorrectFullChordAttackIncomplete, true);
  assert.equal(incumbent.observation.carriedRequiredPitchWithoutFreshReOnset, true);
  assert.equal(incumbent.observation.laterIdenticalAttackRecoveredCorrectTarget, true);
  assert.equal(incumbent.observation.sourceDistance, 2);
  assert.equal(Math.round(incumbent.observation.attributionDelayMs ?? 0), 2_044);
  assert.equal(incumbent.observation.falseAdvanceCount, 0);
  assert.equal(incumbent.observation.skippedAdvanceCount, 0);
  assert.equal(incumbent.observation.duplicateAdvanceCount, 0);
  assert.equal(listenRepeatedRecoveryReproduces(incumbent.observation), true);
  assert.equal(incumbent.runResolution, "late-recovery-beyond-source-distance-1");

  // The transition attack's own qualification paths, not an aggregate of them.
  const transition = incumbent.attacks.find(({ role }) => role === "transition");
  assert.ok(transition);
  assert.equal(transition.advanced, false);
  assert.deepEqual(transition.limitingPitches, PROBE_UPPER);
  assert.equal(transition.lowestLimitingUpperVoiceEvidence, 0.19);
  assert.equal(incumbent.transitionLowestLimitingUpperVoiceEvidence, 0.19);
  assert.equal(
    transition.pitches.find(({ midi }) => midi === 62)?.path,
    "qualified-by-fresh-onset",
  );
  assert.ok(transition.pitches.filter(({ role }) => role === "upper")
    .every(({ soundingBeforeAttack, onsetConfidence }) => (
      soundingBeforeAttack && onsetConfidence === null
    )));
});

test("a run whose decoder re-onsets every chord member does not reproduce the phenomenon", () => {
  // The predicate reads the decoder's silence, not the score's carry: on `v05`,
  // `v13`, and the mixed run the limiting pitch has no decoded onset at all,
  // while a render whose every chord member re-onsets carries nothing to recover
  // and is reported inconclusive instead of failing.
  const reOnset = probeMeasurement(
    LISTEN_BASELINE_PROFILE,
    LISTEN_BASELINE_PROFILE_ID,
    { freshTransitionUpperVoices: true },
  );
  assert.equal(reOnset.observation.carriedRequiredPitchWithoutFreshReOnset, false);
  assert.equal(listenRepeatedRecoveryReproduces(reOnset.observation), false);
  assert.equal(reOnset.observation.structurallyValid, true);
  const carried = probeMeasurement(LISTEN_BASELINE_PROFILE, LISTEN_BASELINE_PROFILE_ID);
  assert.equal(carried.observation.carriedRequiredPitchWithoutFreshReOnset, true);
  assert.equal(listenRepeatedRecoveryReproduces(carried.observation), true);
});

test("a candidate's measured recovery is material against the incumbent's own run", () => {
  const incumbent = probeMeasurement(LISTEN_BASELINE_PROFILE, LISTEN_BASELINE_PROFILE_ID);
  const candidate = probeMeasurement(PROBE_CANDIDATE, "candidate");
  assert.equal(candidate.observation.sourceDistance, 1);
  assert.equal(candidate.runResolution, "partial-recovery-at-source-distance-1");
  assert.equal(candidate.bestSourceDistance, 1);
  assert.equal(candidate.worstSourceDistance, 1);
  assert.ok(
    (incumbent.observation.attributionDelayMs ?? 0) -
      (candidate.observation.attributionDelayMs ?? 0) >= LISTEN_REPEATED_DELAY_MATERIAL_GAIN_MS,
  );
  // The upper voices are admitted by sustained evidence, the bass by its own
  // onset: the two-sided mechanism the round is about.
  const repetition = candidate.attacks.find(({ role }) => role === "exact-repetition");
  assert.ok(repetition);
  assert.equal(repetition.advanced, true);
  assert.deepEqual(
    repetition.pitches.map(({ midi, path }) => [midi, path]),
    [
      [62, "qualified-by-fresh-onset"],
      [74, "qualified-by-sustained-evidence"],
      [82, "qualified-by-sustained-evidence"],
    ],
  );
});

test("the experimental bass gate moves a measured recovery and its default does not", () => {
  const twin = probeMeasurement(PROBE_CANDIDATE, "twin");
  const compatibilityDefault = probeMeasurement(
    { ...PROBE_CANDIDATE, bassOnsetThreshold: PROBE_CANDIDATE.onsetThreshold },
    "twin",
  );
  // The compatibility default reproduces the twin exactly, which is what lets
  // one conversion serve both generations.
  assert.deepEqual(compatibilityDefault, twin);

  // 0.55 is the decoded bass onset of the repetition: the gate admits it and the
  // recovery is the twin's, while 0.60 refuses it and the recovery is lost.
  const admits = probeMeasurement({ ...PROBE_CANDIDATE, bassOnsetThreshold: 0.55 }, "axis");
  assert.equal(admits.observation.sourceDistance, 1);
  const refuses = probeMeasurement({ ...PROBE_CANDIDATE, bassOnsetThreshold: 0.6 }, "axis");
  assert.equal(refuses.observation.sourceDistance, 2);
  assert.equal(
    refuses.attacks.find(({ role }) => role === "exact-repetition")?.primaryLimitingPath,
    "fresh-onset-rejected",
  );
  // The axis is bass-specific: the upper voices are judged by the general gate.
  const upperUnchanged = probeMeasurement({ ...PROBE_CANDIDATE, bassOnsetThreshold: 1 }, "axis");
  assert.deepEqual(
    upperUnchanged.attacks.find(({ role }) => role === "transition")?.pitches
      .filter(({ role }) => role === "upper").map(({ path }) => path),
    ["other-fixed-policy", "other-fixed-policy"],
  );
});

test("the worst attributed repetition decides and the best is reported beside it", () => {
  const rows = (distances: Array<number | null>) => distances.map((sourceDistance, index) => ({
    targetIndex: index,
    targetPitches: PROBE_CHORD,
    scheduledAttackTimeMs: index * 1_000,
    advanced: sourceDistance !== null,
    advancedAtMs: sourceDistance === null ? null : index * 1_000 + sourceDistance * 1_000,
    sourceAttackIndex: sourceDistance === null ? null : index + sourceDistance,
    sourceAttackTargetIndex: sourceDistance === null ? null : index + sourceDistance,
    sourceDistance,
    attributionDelayMs: sourceDistance === null ? null : sourceDistance * 1_000,
    classification: [],
  }));
  const span = listenRoundTwoAttributedRecoverySpan(rows([0, 2, null]));
  assert.equal(span.bestSourceDistance, 0);
  assert.equal(span.worst?.sourceDistance, 2);
  // Distance and delay come from the same row.
  assert.equal(span.worst?.attributionDelayMs, 2_000);
  assert.equal(span.worst?.targetIndex, 1);
  assert.deepEqual(span.earlyAttributedTargetIndexes, []);
  const none = listenRoundTwoAttributedRecoverySpan(rows([null, null]));
  assert.equal(none.worst, null);
  assert.equal(none.bestSourceDistance, null);

  // A target advanced from an attack belonging to an earlier target was advanced
  // early, not recovered: counting it as distance -1 would read the run's own
  // false advance as the best recovery in the group.
  const early = listenRoundTwoAttributedRecoverySpan(rows([-1, 2]));
  assert.deepEqual(early.earlyAttributedTargetIndexes, [0]);
  assert.equal(early.bestSourceDistance, 2);
  assert.equal(early.worst?.sourceDistance, 2);
  const onlyEarly = listenRoundTwoAttributedRecoverySpan(rows([-2]));
  assert.equal(onlyEarly.worst, null);
  assert.equal(onlyEarly.bestSourceDistance, null);
  assert.deepEqual(onlyEarly.earlyAttributedTargetIndexes, [0]);
});

test("the committed safety regressions are replayed with the axis they declare", () => {
  const profile = { ...LISTEN_BASELINE_PROFILE, onsetThreshold: 0.45, extraNoteThreshold: 0.99 };
  const twin = replayListenSafetyRegressions(profile, "twin");
  const axis = replayListenSafetyRegressions({ ...profile, bassOnsetThreshold: 1 }, "axis");
  // The committed fixtures are replayed through the experimental conversion, so
  // a gate that refuses every bass onset cannot leave their measured
  // advancements identical to the compatibility-default twin's. Normalizing
  // through the production projection instead would silently measure the twin.
  assert.notDeepEqual(
    axis.outcomes.map(({ advancedAtMs, falseAdvanceCount }) => [advancedAtMs, falseAdvanceCount]),
    twin.outcomes.map(({ advancedAtMs, falseAdvanceCount }) => [advancedAtMs, falseAdvanceCount]),
  );
});

/* ------------------------------------------------------------------------- *
 * Staging the ablations end to end
 * ------------------------------------------------------------------------- */

function canonicalJson(value: unknown, omitted: ReadonlySet<string>): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry, omitted)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, entry]) => !omitted.has(key) && entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => (
    `${JSON.stringify(key)}:${canonicalJson(entry, omitted)}`
  )).join(",")}}`;
}

/** Recomputed here rather than trusting the artifact's own digest field. */
function recomputedDigest(
  result: ListenRoundTwoAblationResult,
  omitted: readonly string[] = LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
): string {
  const { digest: _digest, ...rest } = result;
  const hasher = new DeterministicHasher();
  hasher.text(canonicalJson(rest, new Set(omitted)), false);
  return hasher.digest;
}

function stagedProfile(
  overrides: Partial<ListenRoundTwoSweepProfile> & { id: string },
): ListenRoundTwoSweepProfile {
  return {
    ...LISTEN_BASELINE_PROFILE,
    distanceFromProduction: 0,
    bassOnsetThreshold: null,
    matchedTwinProfileId: null,
    ...overrides,
  };
}

const STAGED_BASELINE = stagedProfile({ id: "o0p600-t0p500-a0p350-x0p970-b1" });
const STAGED_CANDIDATE = stagedProfile({
  id: "o0p450-t0p500-a0p275-x0p990-b1",
  ...PROBE_CANDIDATE,
  distanceFromProduction: 0.245,
});

async function stageAblations(
  gridForAblation: (ablation: ListenRoundTwoAblationId) => ListenRoundTwoSweepProfile[],
  requested: string[] = [],
): Promise<ListenRoundTwoAblationResult> {
  return evaluateListenRoundTwoAblations({
    gridForAblation,
    capture: async (descriptor) => {
      assert.notEqual(descriptor.partition, "confirmation");
      requested.push(descriptor.id);
      return probeCapture(descriptor);
    },
  });
}

test("ablation one alone is recorded when it satisfies the frozen stop rule", async () => {
  const requested: string[] = [];
  const result = await stageAblations(() => [STAGED_BASELINE, STAGED_CANDIDATE], requested);
  assert.equal(result.name, "listen-round-two-ablation");
  assert.equal(result.terminalOutcome, "existing-grid-sufficient");
  assert.deepEqual(result.ablations.map(({ ablation }) => ablation), ["ablation-1-round-one-grid"]);
  assert.equal(result.productionThresholdShapeChanged, false);
  assert.equal(result.productionThresholdShapeExcludesBassAxis, true);
  assert.equal(result.roundOneGeneratorUntouched, true);
  assert.equal(result.digest.value, recomputedDigest(result));
  assert.equal(result.manifest.version, LISTEN_TRACE_MANIFEST.version);

  const [first] = result.ablations;
  assert.equal(first.stop.satisfied, true);
  assert.deepEqual(first.stop.reasons, []);
  assert.deepEqual(first.selectedProfileIds, [STAGED_CANDIDATE.id]);
  assert.equal(first.selectionJudgement, "discovery-safe-and-search-selected");
  assert.equal(first.confirmationTraceCountRead, 0);
  assert.equal(first.capturedTraceCount, 472);
  assert.equal(requested.length, 472);
  // An injected grid is never the measurement, and says so.
  assert.equal(first.gridIsFrozenGenerator, false);
  assert.equal(first.gridSize, 2);
  assert.equal(first.gridVersion, "round-two-v1/ablation-1-round-one-grid");
  assert.equal(first.bassAxisPresent, false);
  assert.equal(first.domainRegret.gridRows.length, 2);
  assert.ok(first.domainRegret.gridRows.every(({ safe }) => safe));

  // Ablation one's own record carries the round's global-versus-spread verdict,
  // the high-onset survivors, and round one's counterfactual rows beside them.
  assert.ok(["one-global-profile-suffices", "domain-spread-material"]
    .includes(first.domainRegret.verdict));
  assert.ok(first.highOnsetSurvivors?.every(({ onsetThreshold, safe }) => (
    onsetThreshold === 0.6 && safe
  )));
  assert.ok((first.roundOneCounterfactuals ?? []).every(({ archivedRoundOneRejectionCodes }) => (
    Array.isArray(archivedRoundOneRejectionCodes)
  )));

  // Every reported repeated group keeps its own per-run row.
  const [report] = first.repeatedRecovery;
  assert.equal(report.profileId, STAGED_CANDIDATE.id);
  assert.equal(report.comparedAgainstProfileId, LISTEN_BASELINE_PROFILE_ID);
  assert.equal(report.measurements.length, 5);
  assert.ok(report.measurements.every(({ runResolution }) => (
    runResolution === "partial-recovery-at-source-distance-1"
  )));
  assert.ok(first.baselineRepeatedMeasurements.every(({ runResolution }) => (
    runResolution === "late-recovery-beyond-source-distance-1"
  )));
  assert.equal(report.evaluation.repeatedRecoveryOutcome, "material-partial-recovery");
  assert.equal(report.evaluation.discoveryFullResolution, false);
  assert.equal(report.evaluation.confirmedFullResolution, false);
  // Both strata are declared here, so both had to contain a material recovery
  // before the stop rule could be satisfied.
  assert.deepEqual(
    report.declaredStrata,
    [LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM, LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM].sort(),
  );
  assert.deepEqual(report.nonReproducingGroupIds, []);
  assert.ok(report.evaluation.materialRecoveryByStratum.every(({ complete, material }) => (
    complete && material
  )));

  // Ablation one's grid floor cannot reach source distance 0 through the
  // existing scalar family, and the record says so rather than leaving it open.
  assert.equal(first.sourceDistanceZeroRoute.straddlesTask22Minimum, false);
  assert.match(first.sourceDistanceZeroRoute.statement, /untested by this ablation/);
  assert.equal(
    result.task22LimitingUpperVoiceEvidence.frozenThreeRunMinimum,
    LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
  );
  assert.equal(result.task22LimitingUpperVoiceEvidence.measuredByRun.length, 5);
  assert.equal(result.repeatedChordCensus.length, 5);
});

test("the digest identifies the decision, not the decoder's last bits", async () => {
  const result = await stageAblations(() => [STAGED_BASELINE, STAGED_CANDIDATE]);
  assert.deepEqual(
    result.digest.processLocalFieldsExcluded,
    LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
  );
  assert.equal(result.digest.value, recomputedDigest(result));

  // Two fresh browser processes differ on raw decoder confidences by about 1e-5
  // while agreeing on every verdict, so the digest must not move with them.
  const jittered = structuredClone(result) as ListenRoundTwoAblationResult;
  jittered.ablations[0].repeatedRecovery[0].measurements[0].attacks[0].pitches[0]
    .onsetConfidence = 0.123456;
  jittered.ablations[0].baselineRepeatedMeasurements[0]
    .transitionLowestLimitingUpperVoiceEvidence = 0.9;
  jittered.task22LimitingUpperVoiceEvidence.measuredMinimum = 0.5;
  assert.equal(recomputedDigest(jittered), result.digest.value);

  // Anything the round decided still moves it.
  const retuned = structuredClone(result) as ListenRoundTwoAblationResult;
  retuned.ablations[0].selectedProfileIds = [];
  assert.notEqual(recomputedDigest(retuned), result.digest.value);
  const resolved = structuredClone(result) as ListenRoundTwoAblationResult;
  resolved.ablations[0].repeatedRecovery[0].measurements[0].worstSourceDistance = 0;
  assert.notEqual(recomputedDigest(resolved), result.digest.value);
  // Excluding a field from the digest is itself part of the recipe.
  assert.notEqual(recomputedDigest(result, []), result.digest.value);
});

test("a failed stop rule authorises the next ablation, and the axis must earn its keep", async () => {
  const axisAtDecodedOnset = stagedProfile({
    ...STAGED_CANDIDATE,
    id: `${STAGED_CANDIDATE.id}-B0p550`,
    bassOnsetThreshold: 0.55,
    matchedTwinProfileId: STAGED_CANDIDATE.id,
    distanceFromProduction: 0.345,
  });
  const axisAboveIt = stagedProfile({
    ...STAGED_CANDIDATE,
    id: `${STAGED_CANDIDATE.id}-B0p600`,
    bassOnsetThreshold: 0.6,
    matchedTwinProfileId: STAGED_CANDIDATE.id,
    distanceFromProduction: 0.395,
  });
  const result = await stageAblations((ablation) => (
    ablation === "ablation-3-bass-axis"
      ? [STAGED_BASELINE, STAGED_CANDIDATE, axisAtDecodedOnset, axisAboveIt]
      // A grid holding the incumbent alone can select nothing, which is one of
      // the two reachable reasons the frozen stop rule covers.
      : [STAGED_BASELINE]
  ));
  assert.deepEqual(result.ablations.map(({ ablation }) => ablation), [
    "ablation-1-round-one-grid",
    "ablation-2-refined-family",
    "ablation-3-bass-axis",
  ]);
  assert.deepEqual(
    result.ablations.map(({ stop }) => stop.reasons),
    [["no-search-selected-candidate"], ["no-search-selected-candidate"], []],
  );
  assert.match(result.ablations[1].ranBecause, /Authorised by ablation-1-round-one-grid/);
  assert.match(result.ablations[2].ranBecause, /Authorised by ablation-2-refined-family/);
  assert.equal(result.terminalOutcome, "bass-axis-unsupported");
  assert.match(result.terminalOutcomeReason, /no selected bass profile separated/);
  assert.equal(result.productionThresholdShapeChanged, false);
  assert.equal(result.digest.value, recomputedDigest(result));

  const third = result.ablations[2];
  assert.equal(third.bassAxisPresent, true);
  assert.deepEqual(third.bassOnsetThresholds, [0.55, 0.6]);
  assert.equal(third.stop.satisfied, true);
  // The twin outranks both bass variants, so nothing the axis added was
  // selected and no pair comparison can be claimed for it.
  assert.deepEqual(third.selectedProfileIds, [STAGED_CANDIDATE.id]);
  assert.deepEqual(third.matchedPairs, []);
});

test("a selected bass profile is compared against its own twin, not the incumbent", async () => {
  const axis = stagedProfile({
    ...STAGED_CANDIDATE,
    id: `${STAGED_CANDIDATE.id}-B0p550`,
    bassOnsetThreshold: 0.55,
    matchedTwinProfileId: STAGED_CANDIDATE.id,
    // Ranked ahead of its twin here so the pair comparison is exercised at all.
    distanceFromProduction: STAGED_CANDIDATE.distanceFromProduction - 0.01,
  });
  const result = await stageAblations((ablation) => (
    ablation === "ablation-3-bass-axis"
      ? [STAGED_BASELINE, STAGED_CANDIDATE, axis]
      : [STAGED_BASELINE]
  ));
  const [pair] = result.ablations[2].matchedPairs ?? [];
  assert.ok(pair);
  assert.equal(pair.axisProfileId, axis.id);
  assert.equal(pair.twinProfileId, STAGED_CANDIDATE.id);
  assert.equal(pair.bassOnsetThreshold, 0.55);
  assert.equal(pair.axisSafe, true);
  assert.equal(pair.twinSafe, true);
  assert.equal(pair.repeatedRecoveryAgainstTwin.comparedAgainstProfileId, STAGED_CANDIDATE.id);
  // Both sides of the comparison are archived, so which run moved can be read
  // from the record rather than inferred from the verdict.
  assert.deepEqual(
    pair.twinRepeatedMeasurements.map(({ groupId, profileId }) => [groupId, profileId]),
    listenRoundTwoRepeatedGroups().map(({ groupId }) => [groupId, STAGED_CANDIDATE.id]),
  );
  assert.deepEqual(
    pair.repeatedRecoveryAgainstTwin.measurements.map(({ groupId, profileId }) => (
      [groupId, profileId]
    )),
    listenRoundTwoRepeatedGroups().map(({ groupId }) => [groupId, axis.id]),
  );
  // A bass gate at the decoded onset reproduces its twin exactly, so it neither
  // rescues it nor beats it, and the axis is not supported by riding along.
  assert.equal(pair.repeatedRecoveryAgainstTwin.evaluation.repeatedRecoveryOutcome, "unchanged");
  assert.equal(pair.support.supported, false);
  assert.deepEqual(pair.support.reasons, ["axis-does-not-separate-from-twin"]);
  assert.equal(result.terminalOutcome, "bass-axis-unsupported");
});
