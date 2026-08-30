import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  FIXED_LISTEN_MATCHER_POLICY,
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  LISTEN_MATCHER_REGISTRY_VERSION,
} from "../listenMatcherProfiles";
import {
  LISTEN_MATCHER_SELECTION_POLICY,
  LISTEN_MATCHER_SELECTION_POLICY_HASH,
  evaluateListenAblationStop,
  evaluateListenBassAxisPairSupport,
  type ListenRepeatedRecoveryObservation,
} from "../listenMatcherSelectionPolicy";
import {
  LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
  listenRoundTwoAblationEvidenceDigest,
  listenRoundTwoRepeatedGroups,
  listenRoundTwoRepeatedProfileReport,
  listenRoundTwoTerminalOutcome,
  type ListenRoundTwoRepeatedGroup,
  type ListenRoundTwoRepeatedMeasurement,
  type ListenRoundTwoRunResolution,
} from "./listenRoundTwoAblationBenchmark";
import {
  LISTEN_ROUND_TWO_GENERATOR_VERSION,
  type ListenRoundTwoAblationId,
} from "./listenRoundTwoGenerator";
import {
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_KEYS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME,
  LISTEN_ROUND_TWO_ROUND_ID,
  LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST,
  LISTEN_ROUND_TWO_SEARCH_REGISTRY_VERSION,
  assertListenRoundTwoCandidateManifestUnchanged,
  listenRoundTwoCandidateManifest,
  listenRoundTwoCandidateManifestFromRepetitions,
  listenRoundTwoRegistryDigest,
  listenRoundTwoRegistryProblems,
  listenRoundTwoRegistryState,
  reproduceListenRoundTwoAblationEvidence,
} from "./listenRoundTwoCandidateManifest";
import {
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST_HASH,
  LISTEN_TRACE_MANIFEST_VERSION,
} from "./listenTraceManifest";

/* ------------------------------------------------------------------------- *
 * A staged Task 26 artifact, built by the same code that emitted the real one
 *
 * The committed archives are held to these rules by the evidence verifier, which
 * runs against the real files. What cannot be tested against them is the
 * behaviour on evidence they do not contain: an ablation the stop rule accepted,
 * a bass pair that separates from its twin, a narrowed census, a relabelled
 * outcome. Those are built here, so every branch Task 27 can reach has a test
 * that fails when the branch is removed.
 * ------------------------------------------------------------------------- */

const CENSUS = listenRoundTwoRepeatedGroups();
const BASELINE_PROFILE_ID = "baseline-v1";

function observation(
  sourceDistance: number | null,
  attributionDelayMs: number | null,
  falseAdvanceCount = 0,
): ListenRepeatedRecoveryObservation {
  return {
    evaluated: true,
    structurallyValid: true,
    firstCorrectFullChordAttackIncomplete: true,
    carriedRequiredPitchWithoutFreshReOnset: true,
    laterIdenticalAttackRecoveredCorrectTarget: sourceDistance !== null && sourceDistance > 0,
    sourceDistance,
    attributionDelayMs,
    falseAdvanceCount,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
  };
}

function runResolution(observed: ListenRepeatedRecoveryObservation): ListenRoundTwoRunResolution {
  if (observed.sourceDistance === null) return "unrecovered";
  if (observed.sourceDistance === 0) return "recovered-at-source-distance-0";
  if (observed.sourceDistance === 1) return "partial-recovery-at-source-distance-1";
  return "late-recovery-beyond-source-distance-1";
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
    earlyAttributedTargetIndexes: [],
    runResolution: runResolution(observed),
    targets: [],
    attacks: [],
    transitionLowestLimitingUpperVoiceEvidence: null,
  };
}

function measurements(
  profileId: string,
  observe: (group: ListenRoundTwoRepeatedGroup) => ListenRepeatedRecoveryObservation,
): Map<string, ListenRoundTwoRepeatedMeasurement> {
  return new Map(CENSUS.map((group) => [
    group.groupId,
    measurement(group, profileId, observe(group)),
  ]));
}

/** The incumbent: every group recovered late, at source distance 2 and 2,220 ms. */
const lateBaseline = (profileId = BASELINE_PROFILE_ID) =>
  measurements(profileId, () => observation(2, 2_220));

/** A profile that recovers every group on its own attack: material in every stratum. */
const fullyRecovered = (profileId: string) => measurements(profileId, () => observation(0, 228));

/** A profile that changes nothing: no regression, and no material recovery either. */
const unchanged = (profileId: string) => measurements(profileId, () => observation(2, 2_220));

/** A profile that pushes a recovery later than the incumbent's. */
const regressed = (profileId: string) =>
  measurements(profileId, (group) => (
    group.groupId === CENSUS[0].groupId ? observation(3, 3_400) : observation(2, 2_220)
  ));

function gridRow(profileId: string, safe: boolean, worstDomainRegret: number | null) {
  return {
    profileId,
    safe,
    rejectionCodes: safe ? [] : ["regression-run-unsafe"],
    worstDomainRegret,
    worstDomainIndependentRate: 0.5,
    equalDomainIndependentRate: 0.5,
  };
}

function repeatedProfileReport(
  reference: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>,
  candidate: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>,
  profileId: string,
  comparedAgainstProfileId: string,
) {
  return listenRoundTwoRepeatedProfileReport({
    groups: CENSUS,
    reference,
    candidate,
    profileId,
    comparedAgainstProfileId,
  });
}

function ablationRecord(options: {
  ablation: ListenRoundTwoAblationId;
  baseline: Map<string, ListenRoundTwoRepeatedMeasurement>;
  candidates: Array<Map<string, ListenRoundTwoRepeatedMeasurement>>;
  extraGridRows?: Array<ReturnType<typeof gridRow>>;
  matchedPairs?: Array<{
    axis: Map<string, ListenRoundTwoRepeatedMeasurement>;
    twin: Map<string, ListenRoundTwoRepeatedMeasurement>;
    axisSelected: boolean;
    axisSafe: boolean;
    twinSafe: boolean;
    axisWorstDomainRegret: number | null;
    twinWorstDomainRegret: number | null;
  }>;
}) {
  const profileIdOf = (rows: Map<string, ListenRoundTwoRepeatedMeasurement>) =>
    [...rows.values()][0].profileId;
  const selectedProfileIds = options.candidates.map(profileIdOf);
  const repeatedRecovery = options.candidates.map((candidate) => repeatedProfileReport(
    options.baseline,
    candidate,
    profileIdOf(candidate),
    BASELINE_PROFILE_ID,
  ));
  const stop = evaluateListenAblationStop({
    selectedProfileIds,
    repeatedRecoveryByProfile: new Map(repeatedRecovery.map(({ profileId, evaluation }) => [
      profileId,
      evaluation,
    ])),
  });
  const gridRows = [
    ...selectedProfileIds.map((profileId) => gridRow(profileId, true, 0.02)),
    ...(options.extraGridRows ?? []),
  ];
  const matchedPairs = (options.matchedPairs ?? []).map((pair) => {
    const axisProfileId = profileIdOf(pair.axis);
    const twinProfileId = profileIdOf(pair.twin);
    const report = repeatedProfileReport(pair.twin, pair.axis, axisProfileId, twinProfileId);
    const axisRegret = pair.axisWorstDomainRegret ?? 0;
    return {
      axisProfileId,
      twinProfileId,
      bassOnsetThreshold: 0.55,
      onsetThreshold: 0.45,
      axisSelected: pair.axisSelected,
      axisSafe: pair.axisSafe,
      twinSafe: pair.twinSafe,
      axisWorstDomainRegret: pair.axisWorstDomainRegret,
      twinWorstDomainRegret: pair.twinWorstDomainRegret,
      support: evaluateListenBassAxisPairSupport({
        ablationStopSatisfied: stop.satisfied,
        axisProfileSelected: pair.axisSelected,
        axisSafe: pair.axisSafe,
        twinSafe: pair.twinSafe,
        axisWorstDomainRegret: axisRegret,
        twinWorstDomainRegret: pair.twinWorstDomainRegret ?? axisRegret,
        repeatedRecoveryAgainstTwin: report.evaluation,
      }),
      repeatedRecoveryAgainstTwin: report,
      twinRepeatedMeasurements: CENSUS.map(({ groupId }) => pair.twin.get(groupId)),
    };
  });
  for (const pair of options.matchedPairs ?? []) {
    for (const [rows, safe, regret] of [
      [pair.axis, pair.axisSafe, pair.axisWorstDomainRegret] as const,
      [pair.twin, pair.twinSafe, pair.twinWorstDomainRegret] as const,
    ]) {
      const profileId = profileIdOf(rows);
      if (!gridRows.some((row) => row.profileId === profileId)) {
        gridRows.push(gridRow(profileId, safe, regret));
      }
    }
  }
  return {
    ablation: options.ablation,
    ranBecause: "fixture",
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    gridVersion: `round-two-v1/${options.ablation}`,
    gridSize: gridRows.length,
    gridIsFrozenGenerator: true,
    bassAxisPresent: options.ablation === "ablation-3-bass-axis",
    bassOnsetThresholds: [],
    manifest: {
      version: LISTEN_TRACE_MANIFEST_VERSION,
      hash: LISTEN_TRACE_MANIFEST_HASH,
      corpusHash: LISTEN_TRACE_CORPUS_HASH,
    },
    capturedTraceCount: 472,
    confirmationTraceCountRead: 0,
    safeProfileCount: gridRows.filter(({ safe }) => safe).length,
    profilesRejectedBySafety: gridRows.filter(({ safe }) => !safe).length,
    domainRegret: { verdict: "domain-spread-material", gridRows },
    rejectionCounts: [],
    selectedProfileIds,
    selectionJudgement: "discovery-safe-and-search-selected",
    repeatedRecovery,
    baselineRepeatedMeasurements: CENSUS.map(({ groupId }) => options.baseline.get(groupId)),
    stop,
    matchedPairs: matchedPairs.length > 0 ? matchedPairs : undefined,
  };
}

type StagedAblation = ReturnType<typeof ablationRecord>;

/**
 * A staged artifact. `statedOutcome` builds one whose staging the frozen
 * transition rule refuses, which is the only way to test that the refusal fires
 * on a file rather than on a fixture builder.
 */
function evidence(ablations: StagedAblation[], statedOutcome?: string): unknown {
  const { outcome, reason } = statedOutcome === undefined
    ? listenRoundTwoTerminalOutcome(ablations)
    : { outcome: statedOutcome, reason: "stated" };
  const record = {
    name: "listen-round-two-ablation",
    formatVersion: 1,
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    selectionPolicy: {
      version: LISTEN_MATCHER_SELECTION_POLICY.version,
      hash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
      activeTargetRefinementPoints: [],
      targetNoteRefinementPoints: [],
      bassOnsetPoints: [],
    },
    manifest: {
      version: LISTEN_TRACE_MANIFEST_VERSION,
      hash: LISTEN_TRACE_MANIFEST_HASH,
      corpusHash: LISTEN_TRACE_CORPUS_HASH,
    },
    repeatedChordCensus: CENSUS,
    task22LimitingUpperVoiceEvidence: { frozenThreeRunMinimum: 0.09577340414698106 },
    ablations,
    terminalOutcome: outcome,
    terminalOutcomeReason: reason,
    productionThresholdShapeChanged: false,
    productionThresholdShapeExcludesBassAxis: true,
    roundOneGeneratorUntouched: true,
  };
  return [{
    ...record,
    digest: {
      algorithm: "fnv1a-32-canonical-json",
      processLocalFieldsExcluded: LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
      value: listenRoundTwoAblationEvidenceDigest(record),
    },
  }];
}

/** A mutation of an artifact whose digest is recomputed, so the digest never masks it. */
function amended(source: unknown, amend: (record: Record<string, never>) => void): unknown {
  const [record] = structuredClone(source) as [Record<string, never>];
  amend(record);
  const { digest, ...rest } = record as unknown as Record<string, unknown>;
  (digest as Record<string, unknown>).value = listenRoundTwoAblationEvidenceDigest(rest);
  return [record];
}

/** The round as it happened: three ablations, none accepted by the stop rule. */
function zeroBranchEvidence(): unknown {
  return evidence([
    ablationRecord({
      ablation: "ablation-1-round-one-grid",
      baseline: lateBaseline(),
      candidates: [unchanged("round-one-selected")],
    }),
    ablationRecord({
      ablation: "ablation-2-refined-family",
      baseline: lateBaseline(),
      candidates: [unchanged("refined-selected")],
    }),
    ablationRecord({
      ablation: "ablation-3-bass-axis",
      baseline: lateBaseline(),
      candidates: [unchanged("bass-selected-B0p550")],
    }),
  ]);
}

/* ------------------------------------------------------------------------- *
 * The zero branch
 * ------------------------------------------------------------------------- */

test("the zero branch is recomputed from the archived measurements, never read", () => {
  const reproduced = reproduceListenRoundTwoAblationEvidence(zeroBranchEvidence());
  assert.equal(reproduced.terminalOutcome, "bass-axis-unsupported");
  assert.equal(reproduced.branch, "zero");
  assert.equal(reproduced.acceptedAblation, null);
  assert.equal(reproduced.notRunReason, "no-ablation-accepted");
  assert.deepEqual(reproduced.ablations.map(({ stop }) => stop.satisfied), [false, false, false]);
  assert.ok(reproduced.ablations.every(({ stop }) => (
    stop.reasons.includes("selected-set-has-no-material-repeated-recovery")
  )));
});

test("the zero-branch manifest holds no candidate and one stable digest", () => {
  const staged = zeroBranchEvidence();
  const manifest = listenRoundTwoCandidateManifest({ evidence: staged });
  assert.equal(manifest.name, LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME);
  assert.equal(manifest.roundId, LISTEN_ROUND_TWO_ROUND_ID);
  assert.deepEqual([...manifest.candidateProfileIds], []);
  assert.equal(manifest.notRunReason, "no-ablation-accepted");
  assert.equal(manifest.ablationId, null);
  assert.equal(manifest.registryVersion, LISTEN_ROUND_TWO_SEARCH_REGISTRY_VERSION);
  assert.equal(manifest.task26TerminalOutcome, "bass-axis-unsupported");
  // Two emissions of the same evidence are the same record, byte for byte.
  assert.deepEqual(listenRoundTwoCandidateManifest({ evidence: staged }), manifest);
});

test("a frozen manifest cannot be edited in place", () => {
  const manifest = listenRoundTwoCandidateManifest({ evidence: zeroBranchEvidence() });
  assert.throws(() => {
    (manifest as { notRunReason: string }).notRunReason = "no-supported-parameterization";
  });
  assert.throws(() => {
    (manifest.candidateProfileIds as string[]).push("early-open-v2");
  });
  assert.throws(() => {
    (manifest.digest as { value: string }).value = "00000000";
  });
});

test("the two zero-branch forms are different findings with different digests", () => {
  // The bass grid clears the stop rule, and its one selected profile does not
  // separate from its own matched twin: profiles were selected, but every one of
  // them needs the axis this outcome keeps out of the production shape.
  const staged = evidence([
    ablationRecord({
      ablation: "ablation-1-round-one-grid",
      baseline: lateBaseline(),
      candidates: [unchanged("round-one-selected")],
    }),
    ablationRecord({
      ablation: "ablation-2-refined-family",
      baseline: lateBaseline(),
      candidates: [unchanged("refined-selected")],
    }),
    ablationRecord({
      ablation: "ablation-3-bass-axis",
      baseline: lateBaseline(),
      candidates: [fullyRecovered("bass-selected-B0p550")],
      matchedPairs: [{
        axis: fullyRecovered("bass-selected-B0p550"),
        twin: fullyRecovered("bass-selected"),
        axisSelected: true,
        axisSafe: true,
        twinSafe: true,
        axisWorstDomainRegret: 0.02,
        twinWorstDomainRegret: 0.02,
      }],
    }),
  ]);
  const reproduced = reproduceListenRoundTwoAblationEvidence(staged);
  assert.equal(reproduced.terminalOutcome, "bass-axis-unsupported");
  assert.equal(reproduced.acceptedAblation, "ablation-3-bass-axis");
  assert.equal(reproduced.notRunReason, "no-supported-parameterization");
  assert.deepEqual(
    reproduced.ablations.at(-1)?.matchedPairs.map(({ support }) => support.reasons),
    [["axis-does-not-separate-from-twin"]],
  );
  const manifest = listenRoundTwoCandidateManifest({ evidence: staged });
  assert.deepEqual([...manifest.candidateProfileIds], []);
  assert.equal(manifest.notRunReason, "no-supported-parameterization");
  assert.equal(manifest.ablationId, "ablation-3-bass-axis");
  // The reason code is inside the manifest's own digest, so relabelling it
  // downstream cannot leave every digest verifying.
  assert.notEqual(
    manifest.digest.value,
    listenRoundTwoCandidateManifest({ evidence: zeroBranchEvidence() }).digest.value,
  );
});

test("the zero-branch manifest records the searched registry's own identity", () => {
  const manifest = listenRoundTwoCandidateManifest({ evidence: zeroBranchEvidence() });
  assert.equal(manifest.registryDigest, LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST);
  assert.equal(manifest.registryDigest, listenRoundTwoRegistryDigest(SHIPPED_REGISTRY));
  // There is no parameter through which a candidate can be supplied on this
  // branch, so the record cannot name one; the emitter's only input is evidence.
  assert.deepEqual(Object.keys({ evidence: null }), ["evidence"]);
});

/* ------------------------------------------------------------------------- *
 * The nonempty branch, which this round did not reach
 * ------------------------------------------------------------------------- */

/** The branch each terminal outcome reaches, read through the reproduction path. */
function listenRoundTwoCandidateManifestBranchFor(outcome: string): string {
  const staged = outcome === "existing-family-refinement-sufficient"
    ? evidence([
      ablationRecord({
        ablation: "ablation-1-round-one-grid",
        baseline: lateBaseline(),
        candidates: [unchanged("round-one-selected")],
      }),
      ablationRecord({
        ablation: "ablation-2-refined-family",
        baseline: lateBaseline(),
        candidates: [fullyRecovered("refined-selected")],
      }),
    ])
    : evidence([
      ablationRecord({
        ablation: "ablation-1-round-one-grid",
        baseline: lateBaseline(),
        candidates: [unchanged("round-one-selected")],
      }),
      ablationRecord({
        ablation: "ablation-2-refined-family",
        baseline: lateBaseline(),
        candidates: [unchanged("refined-selected")],
      }),
      ablationRecord({
        ablation: "ablation-3-bass-axis",
        baseline: lateBaseline(),
        candidates: [fullyRecovered("bass-selected-B0p550")],
        matchedPairs: [{
          axis: fullyRecovered("bass-selected-B0p550"),
          twin: unchanged("bass-selected"),
          axisSelected: true,
          axisSafe: true,
          twinSafe: false,
          axisWorstDomainRegret: 0.02,
          twinWorstDomainRegret: null,
        }],
      }),
    ]);
  const reproduced = reproduceListenRoundTwoAblationEvidence(staged);
  assert.equal(reproduced.terminalOutcome, outcome);
  return reproduced.branch;
}

function acceptedFirstAblationEvidence(): unknown {
  return evidence([ablationRecord({
    ablation: "ablation-1-round-one-grid",
    baseline: lateBaseline(),
    candidates: [fullyRecovered("early-open-v2")],
  })]);
}

test("an accepted ablation takes the nonempty branch, which this emitter refuses", () => {
  const reproduced = reproduceListenRoundTwoAblationEvidence(acceptedFirstAblationEvidence());
  assert.equal(reproduced.terminalOutcome, "existing-grid-sufficient");
  assert.equal(reproduced.branch, "nonempty");
  assert.equal(reproduced.acceptedAblation, "ablation-1-round-one-grid");
  assert.equal(reproduced.notRunReason, null);
  // The candidates that branch records must come from the search of the accepted
  // ablation and be registered as new v3 identifiers at registry version 3. None
  // of that exists, so no manifest may be frozen on it — a caller-supplied list
  // of already-registered identifiers is exactly what must not become a round's
  // selection, and there is no parameter through which to supply one.
  assert.throws(
    () => listenRoundTwoCandidateManifest({ evidence: acceptedFirstAblationEvidence() }),
    /must run, freeze its own result archive, and register its selections as new v3/,
  );
  for (const outcome of ["existing-family-refinement-sufficient", "bass-axis-supported"]) {
    assert.equal(
      listenRoundTwoCandidateManifestBranchFor(outcome),
      "nonempty",
      `${outcome} must take the nonempty branch`,
    );
  }
});

test("the zero-branch record fills the whole declared schema", () => {
  const zero = listenRoundTwoCandidateManifest({ evidence: zeroBranchEvidence() });
  // Both branches emit this one schema; the zero branch differs in its values,
  // never in which fields it carries, so downstream reads one shape.
  assert.deepEqual(Object.keys(zero), [...LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_KEYS]);
});

/* ------------------------------------------------------------------------- *
 * What the recomputation refuses
 * ------------------------------------------------------------------------- */

test("a stored stop verdict that its measurements do not support is refused", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    const [first] = (record as unknown as { ablations: Array<Record<string, unknown>> }).ablations;
    first.stop = { satisfied: true, runNextAblation: false, reasons: [] };
  });
  assert.throws(() => reproduceListenRoundTwoAblationEvidence(staged), /records stop verdict/);
});

test("a relabelled terminal outcome is refused even with its digest recomputed", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    (record as unknown as { terminalOutcome: string }).terminalOutcome = "bass-axis-supported";
  });
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(staged),
    /records terminal outcome/,
  );
});

test("a repeated-recovery verdict that does not follow from both sides is refused", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    const [first] = (record as unknown as { ablations: Array<Record<string, never>> }).ablations;
    const report = (first as unknown as {
      repeatedRecovery: Array<{ evaluation: { materialRecovery: boolean } }>;
    }).repeatedRecovery[0];
    report.evaluation.materialRecovery = true;
  });
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(staged),
    /does not follow from its own archived measurements/,
  );
});

test("a narrowed repeated-chord census is an amendment, not an application", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    const held = record as unknown as { repeatedChordCensus: unknown[] };
    held.repeatedChordCensus = held.repeatedChordCensus.slice(0, 3);
  });
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(staged),
    /census this commit's fixtures do not produce/,
  );
});

test("an incomplete side of a comparison is refused rather than scored", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    const [first] = (record as unknown as {
      ablations: Array<{ baselineRepeatedMeasurements: unknown[] }>;
    }).ablations;
    first.baselineRepeatedMeasurements.shift();
  });
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(staged),
    /does not archive one measurement per repeated-chord group/,
  );
});

test("a selection path that read a confirmation trace is refused", () => {
  const staged = amended(zeroBranchEvidence(), (record) => {
    const [first] = (record as unknown as {
      ablations: Array<{ confirmationTraceCountRead: number }>;
    }).ablations;
    first.confirmationTraceCountRead = 1;
  });
  assert.throws(() => reproduceListenRoundTwoAblationEvidence(staged), /confirmation traces/);
});

test("a matched-pair support claim its own grid rows deny is refused", () => {
  const staged = evidence([
    ablationRecord({
      ablation: "ablation-1-round-one-grid",
      baseline: lateBaseline(),
      candidates: [unchanged("round-one-selected")],
    }),
    ablationRecord({
      ablation: "ablation-2-refined-family",
      baseline: lateBaseline(),
      candidates: [unchanged("refined-selected")],
    }),
    ablationRecord({
      ablation: "ablation-3-bass-axis",
      baseline: lateBaseline(),
      candidates: [unchanged("bass-selected-B0p550")],
      matchedPairs: [{
        axis: unchanged("bass-selected-B0p550"),
        twin: unchanged("bass-selected"),
        axisSelected: true,
        axisSafe: true,
        twinSafe: false,
        axisWorstDomainRegret: 0.02,
        twinWorstDomainRegret: null,
      }],
    }),
  ]);
  assert.deepEqual(reproduceListenRoundTwoAblationEvidence(staged).notRunReason, "no-ablation-accepted");
  const claimed = amended(staged, (record) => {
    const pair = (record as unknown as {
      ablations: Array<{ matchedPairs?: Array<{ support: { supported: boolean; reasons: string[] } }> }>;
    }).ablations[2].matchedPairs?.[0];
    if (pair === undefined) throw new Error("The fixture lost its matched pair.");
    pair.support.supported = true;
    pair.support.reasons = [];
  });
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(claimed),
    /does not follow from its own pair/,
  );
});

test("an ablation whose predecessor accepted was never authorised", () => {
  const staged = evidence([
    ablationRecord({
      ablation: "ablation-1-round-one-grid",
      baseline: lateBaseline(),
      candidates: [unchanged("round-one-selected")],
    }),
    ablationRecord({
      ablation: "ablation-2-refined-family",
      baseline: lateBaseline(),
      candidates: [fullyRecovered("refined-selected")],
    }),
    ablationRecord({
      ablation: "ablation-3-bass-axis",
      baseline: lateBaseline(),
      candidates: [unchanged("bass-selected-B0p550")],
    }),
  ], "bass-axis-unsupported");
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence(staged),
    /ablation three was not authorised/,
  );
});

test("a regression in one repeated run is not averaged away", () => {
  const staged = evidence([
    ablationRecord({
      ablation: "ablation-1-round-one-grid",
      baseline: lateBaseline(),
      candidates: [regressed("late-mover")],
    }),
    ablationRecord({
      ablation: "ablation-2-refined-family",
      baseline: lateBaseline(),
      candidates: [unchanged("refined-selected")],
    }),
    ablationRecord({
      ablation: "ablation-3-bass-axis",
      baseline: lateBaseline(),
      candidates: [unchanged("bass-selected-B0p550")],
    }),
  ]);
  const reproduced = reproduceListenRoundTwoAblationEvidence(staged);
  // The candidate recovers four of five groups exactly as the incumbent does and
  // pushes the fifth two source distances later; the stop rule reads the run.
  assert.ok(reproduced.ablations[0].stop.reasons.includes("selected-repeated-recovery-regression"));
  assert.equal(reproduced.branch, "zero");
  assert.equal(reproduced.notRunReason, "no-ablation-accepted");
});

test("evidence measured under another policy, manifest, or generator is refused", () => {
  for (const [amend, pattern] of [
    [(record: Record<string, never>) => {
      (record as unknown as { selectionPolicy: { hash: string } }).selectionPolicy.hash = "deadbeef";
    }, /different selection policy/],
    [(record: Record<string, never>) => {
      (record as unknown as { manifest: { hash: string } }).manifest.hash = "deadbeef";
    }, /different trace manifest/],
    [(record: Record<string, never>) => {
      (record as unknown as { generatorVersion: number }).generatorVersion = 2;
    }, /generator version/],
  ] as const) {
    assert.throws(() => reproduceListenRoundTwoAblationEvidence(
      amended(zeroBranchEvidence(), amend),
    ), pattern);
  }
});

test("a Task 26 digest that does not cover its own record is refused", () => {
  const [record] = structuredClone(zeroBranchEvidence()) as [{
    ablations: Array<{ domainRegret: { gridRows: Array<{ worstDomainRegret: number | null }> } }>;
  }];
  record.ablations[0].domainRegret.gridRows[0].worstDomainRegret = 0;
  assert.throws(() => reproduceListenRoundTwoAblationEvidence([record]), /records digest/);
});

test("a file that is not one Task 26 record decides nothing", () => {
  const [record] = zeroBranchEvidence() as [unknown];
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence([record, record]),
    /exactly one record/,
  );
  assert.throws(
    () => reproduceListenRoundTwoAblationEvidence([{ name: "listen-profile-validation" }]),
    /names "listen-profile-validation"/,
  );
});

/* ------------------------------------------------------------------------- *
 * Repetitions, the registry, and immutability
 * ------------------------------------------------------------------------- */

test("one repetition does not freeze a manifest, and two that disagree do not either", () => {
  assert.throws(
    () => listenRoundTwoCandidateManifestFromRepetitions({
      evidenceRepetitions: [zeroBranchEvidence()],
    }),
    /at least two archived Task 26 repetitions/,
  );
  const { manifest } = listenRoundTwoCandidateManifestFromRepetitions({
    evidenceRepetitions: [zeroBranchEvidence(), zeroBranchEvidence()],
  });
  assert.equal(manifest.notRunReason, "no-ablation-accepted");
  const moved = amended(zeroBranchEvidence(), (record) => {
    const [first] = (record as unknown as {
      ablations: Array<{ domainRegret: { gridRows: Array<{ worstDomainRegret: number }> } }>;
    }).ablations;
    first.domainRegret.gridRows[0].worstDomainRegret = 0.5;
  });
  assert.throws(
    () => listenRoundTwoCandidateManifestFromRepetitions({
      evidenceRepetitions: [zeroBranchEvidence(), moved],
    }),
    /different candidate manifest/,
  );
});

const SHIPPED_REGISTRY = {
  version: LISTEN_MATCHER_REGISTRY_VERSION,
  profileIds: LISTEN_MATCHER_PROFILE_IDS,
  profiles: LISTEN_MATCHER_PROFILES,
  defaultProfileId: DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  fixedPolicy: FIXED_LISTEN_MATCHER_POLICY,
};

test("the registry digest is the identity of a whole generation", () => {
  assert.equal(listenRoundTwoRegistryDigest(SHIPPED_REGISTRY), LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST);
  // Every way a registry can stop being the searched one moves the digest, which
  // is what makes "every entry stays byte-identical" a check rather than a claim.
  const movedThreshold = {
    ...SHIPPED_REGISTRY,
    profiles: {
      ...SHIPPED_REGISTRY.profiles,
      "early-open-v2": {
        ...SHIPPED_REGISTRY.profiles["early-open-v2"],
        activeTargetThreshold: 0.21,
      },
    },
  };
  const reordered = {
    ...SHIPPED_REGISTRY,
    profileIds: [...SHIPPED_REGISTRY.profileIds].reverse(),
  };
  const added = {
    ...SHIPPED_REGISTRY,
    profileIds: [...SHIPPED_REGISTRY.profileIds, "late-open-v2b"],
    profiles: {
      ...SHIPPED_REGISTRY.profiles,
      "late-open-v2b": SHIPPED_REGISTRY.profiles["early-open-v2"],
    },
  };
  const removed = {
    ...SHIPPED_REGISTRY,
    profileIds: SHIPPED_REGISTRY.profileIds.filter((id) => id !== "steady-held-v2"),
  };
  const movedPolicy = {
    ...SHIPPED_REGISTRY,
    fixedPolicy: { ...SHIPPED_REGISTRY.fixedPolicy, settleMs: 33 },
  };
  const movedVersion = { ...SHIPPED_REGISTRY, version: 3 };
  for (const [what, registry] of [
    ["a moved threshold", movedThreshold],
    ["a reordered identifier list", reordered],
    ["an added non-v3 entry", added],
    ["a removed entry", removed],
    ["a moved fixed policy", movedPolicy],
    ["a bumped version", movedVersion],
  ] as const) {
    assert.notEqual(
      listenRoundTwoRegistryDigest(registry),
      LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST,
      `${what} must move the registry digest`,
    );
    assert.ok(
      listenRoundTwoRegistryProblems("zero", listenRoundTwoRegistryState(registry, true))
        .some((problem) => problem.includes("byte-identical")),
      `${what} must fail the zero branch`,
    );
  }
  // A registry that names a profile it does not hold cannot be hashed at all.
  assert.throws(
    () => listenRoundTwoRegistryDigest({
      ...SHIPPED_REGISTRY,
      profileIds: [...SHIPPED_REGISTRY.profileIds, "absent-v2"],
    }),
    /has no profile absent-v2/,
  );
});

test("the zero branch refuses a registry that moved under it", () => {
  const clean = listenRoundTwoRegistryState();
  assert.deepEqual(clean, {
    version: LISTEN_MATCHER_REGISTRY_VERSION,
    profileIds: LISTEN_MATCHER_PROFILE_IDS,
    defaultProfileId: DEFAULT_LISTEN_MATCHER_PROFILE_ID,
    productionShapeExcludesBassAxis: true,
    digest: LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST,
  });
  assert.deepEqual(listenRoundTwoRegistryProblems("zero", clean), []);
  assert.deepEqual(listenRoundTwoRegistryProblems("nonempty", clean), []);
  const withV3 = { ...clean, profileIds: [...clean.profileIds, "early-open-v3"] };
  assert.ok(listenRoundTwoRegistryProblems("zero", withV3)[0].includes("no v3 identifier"));
  // A nonempty branch is exactly where a v3 identifier belongs, and where the
  // searched generation's digest is expected to have moved.
  assert.deepEqual(listenRoundTwoRegistryProblems("nonempty", withV3), []);
  assert.ok(listenRoundTwoRegistryProblems("zero", { ...clean, version: 3 })[0]
    .includes("leaves the registry at version 2"));
  for (const branch of ["zero", "nonempty"] as const) {
    assert.ok(listenRoundTwoRegistryProblems(branch, { ...clean, defaultProfileId: "early-open-v2" })
      .some((problem) => problem.includes("keep the default at baseline-v1")));
    assert.ok(listenRoundTwoRegistryProblems(
      branch,
      { ...clean, productionShapeExcludesBassAxis: false },
    ).some((problem) => problem.includes("carries the unsupported bass axis")));
  }
});

test("the frozen manifest may be reproduced and may not be revised", () => {
  const manifest = listenRoundTwoCandidateManifest({ evidence: zeroBranchEvidence() });
  assertListenRoundTwoCandidateManifestUnchanged(
    JSON.parse(JSON.stringify(manifest)),
    manifest,
  );
  const relabelled = JSON.parse(JSON.stringify(manifest));
  relabelled.notRunReason = "no-supported-parameterization";
  assert.throws(
    () => assertListenRoundTwoCandidateManifestUnchanged(relabelled, manifest),
    /immutable/,
  );
  const withCandidate = JSON.parse(JSON.stringify(manifest));
  withCandidate.candidateProfileIds = ["early-open-v2"];
  assert.throws(
    () => assertListenRoundTwoCandidateManifestUnchanged(withCandidate, manifest),
    /immutable/,
  );
});
