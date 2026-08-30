import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  LISTEN_MATCHER_PROFILE_IDS,
  resolveEffectiveListenMatcherProfile,
} from "./listenMatcherProfiles";
import {
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE,
} from "./benchmarks/listenRoundTwoCandidateManifest";
import {
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE,
  listenRoundTwoCandidateManifestDigest,
  listenRoundTwoEligibilityManifestDigest,
  type ListenRoundTwoEligibilityManifest,
} from "./benchmarks/listenRoundTwoEligibilityManifest";
import {
  listenRoundTwoAutomatedMeasurements,
  listenRoundTwoLiveMeasurements,
  listenRoundTwoSelectDefault,
} from "./listenRoundTwoDefaultSelection";
import {
  listenConfirmationArchiveFixture,
  listenLiveArchiveFixture,
  listenLivePerformedAttack,
  listenLiveStrongPitch,
} from "./benchmarks/listenRoundTwoCompletedFixtures";
import {
  listenRoundTwoLiveResult,
  type ListenRoundTwoLiveArchive,
} from "./benchmarks/listenRoundTwoLiveEvidence";
import {
  LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE,
  LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE,
  LISTEN_ROUND_TWO_APPROVED_PROFILES_KEYS,
  LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS,
  LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID,
  assertListenRoundTwoApprovedProfilesUnchanged,
  assertOfferableListenMatcherProfileId,
  isApprovedListenMatcherProfileId,
  listenRoundTwoApprovedProfileIds,
  listenRoundTwoApprovedProfilesDigest,
  listenRoundTwoApprovedProfilesProblems,
  listenRoundTwoProductionDecision,
  listenRoundTwoRequiresModelEvidenceRequirement,
  listenRoundTwoRolloutProblems,
  type ListenRoundTwoApprovedProfileList,
} from "./listenRoundTwoProductionDecision";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readArtifact(path: string): unknown {
  return JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), "utf8"));
}

function readBytes(path: string): Buffer {
  return readFileSync(join(REPOSITORY_ROOT, path));
}

const committedCandidateManifest = () => readArtifact(LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE);
const committedEligibility = () => readArtifact(LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE);
const committedEvidence = () =>
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.map((path) => readArtifact(path));
const committedList = () => readArtifact(LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE);

function requirementSha256(): string {
  return createHash("sha256").update(readBytes(LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE))
    .digest("hex");
}

function decide(overrides: Record<string, unknown> = {}) {
  return listenRoundTwoProductionDecision({
    eligibility: committedEligibility(),
    candidateManifest: committedCandidateManifest(),
    evidenceRepetitions: committedEvidence(),
    liveArchives: [],
    modelEvidenceRequirementSha256: requirementSha256(),
    ...overrides,
  });
}

/** A record with its digest recomputed, so the digest never masks the mutation. */
function amended(
  source: unknown,
  amend: (record: Record<string, unknown>) => void,
): Record<string, unknown> {
  const record = structuredClone(source) as Record<string, unknown>;
  amend(record);
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoApprovedProfilesDigest(record),
  };
  return record;
}

function problemsFor(record: unknown, eligibility: unknown = committedEligibility()): string[] {
  return listenRoundTwoApprovedProfilesProblems({
    record,
    eligibility,
    candidateManifest: committedCandidateManifest(),
  });
}

/**
 * A schema-valid completed eligibility manifest.
 *
 * The round took the not-run branch, so no completed manifest exists and none can
 * be derived from the committed evidence. The membership rule, the promoted-default
 * rules, and the repeated-chord copy all have a completed branch that later rounds
 * will take, and each needs a record satisfying the others to be tested one rule at
 * a time.
 */
function completedEligibility(
  entries: Array<Record<string, unknown>>,
): ListenRoundTwoEligibilityManifest {
  const notRun = committedEligibility() as Record<string, unknown>;
  const record: Record<string, unknown> = {
    ...notRun,
    runStatus: "completed",
    entries,
    confirmationPartition: {
      ...(notRun.confirmationPartition as Record<string, unknown>),
      decodedTraceCount: 12,
    },
    confirmationEvidence: {
      runOneArchive: "benchmark-results/listen-profile-validation-task28-run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "benchmark-results/listen-profile-validation-task28-run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
  };
  delete record.reason;
  delete record.digest;
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest(record),
  };
  return record as unknown as ListenRoundTwoEligibilityManifest;
}

/**
 * A live corpus collected against a completed eligibility manifest.
 *
 * The archive is bound to that manifest's recomputed digest, so it is this
 * round's evidence rather than a session pointed at some other confirmation.
 */
function liveArchive(
  eligibility: ListenRoundTwoEligibilityManifest,
  performance: Parameters<typeof listenLiveArchiveFixture>[0]["performance"] = undefined,
  profileIds: readonly string[] = ["early-open-v2", "steady-open-v2"],
): ListenRoundTwoLiveArchive {
  return listenLiveArchiveFixture({
    eligibilityManifestDigest: listenRoundTwoEligibilityManifestDigest(eligibility),
    profileIds,
    performance,
  });
}

/**
 * The recorded omitted-bass mechanism, on one setup.
 *
 * 0.47 sits inside the measured hallucination corridor and between the two
 * candidates' onset gates, so which candidate fails its live gates is decided by
 * what the decoder reported rather than by the fixture.
 */
function hallucinatedBass(setupId = "acoustic-upright-room-a", onset = 0.47) {
  return (shape: { trialClass: string; setupId: string }) => (
    shape.trialClass === "omitted-bass" && shape.setupId === setupId
      ? {
        decoded: [listenLivePerformedAttack(0, [
          { midi: 48, onset, noteConfidence: 0.9, active: 0.9, event: true },
          listenLiveStrongPitch(60),
          listenLiveStrongPitch(67),
        ])],
      }
      : {}
  );
}

function entry(profileId: string, overrides: Record<string, unknown> = {}) {
  return {
    profileId,
    automatedEligible: true,
    rejectionReasons: [],
    repeatedRecoveryOutcome: "material-partial-recovery",
    confirmationReproductionStatus: "reproduced",
    ...overrides,
  };
}

/* ------------------------------------------------------------------------- *
 * The decision the round actually reached
 * ------------------------------------------------------------------------- */

test("the decision is derived by rerunning the chain, not by reading it", () => {
  const { record, reproducedEvidence } = decide();
  assert.equal(record.outcome, "round-two-grid-produced-no-eligible-improvement");
  assert.equal(record.reason, "no-ablation-accepted");
  assert.equal(record.eligibilityRunStatus, "not-run-no-confirmable-candidate");
  assert.equal(record.selectedDefaultProfileId, "baseline-v1");
  assert.deepEqual([...record.approvedProfileIds], ["baseline-v1"]);
  // Every link came back from a rerun of both Task 26 repetitions.
  assert.equal(reproducedEvidence.length, LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.length);
  for (const evidence of reproducedEvidence) {
    assert.equal(evidence.terminalOutcome, "bass-axis-unsupported");
    assert.equal(evidence.notRunReason, "no-ablation-accepted");
    assert.equal(evidence.acceptedAblation, null);
    assert.equal(record.task26EvidenceDigest, evidence.digest);
  }
  assert.deepEqual(decide().record, record);
});

test("the committed artifact is the record this commit's chain re-derives", () => {
  const { record } = decide();
  assert.deepEqual(committedList(), JSON.parse(JSON.stringify(record)));
  assert.equal(
    readBytes(LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE).toString("utf8"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  assert.deepEqual(problemsFor(committedList()), []);
});

test("the frozen list is immutable rather than revisable", () => {
  const { record } = decide();
  assertListenRoundTwoApprovedProfilesUnchanged(committedList(), record);
  assert.throws(
    () => assertListenRoundTwoApprovedProfilesUnchanged(
      amended(record, (draft) => { draft.outcome = "round-two-candidate-set-exhausted"; }),
      record,
    ),
    /immutable/,
  );
});

test("the earlier links are byte-identical after this task ran", () => {
  // Task 29 emits a new artifact and never edits a link it chains to.
  const { record, eligibility, candidateManifest } = decide();
  assert.deepEqual(committedEligibility(), JSON.parse(JSON.stringify(eligibility)));
  assert.deepEqual(committedCandidateManifest(), JSON.parse(JSON.stringify(candidateManifest)));
  assert.equal(record.eligibilityManifestDigest, "20be9d6d");
  assert.equal(record.candidateManifestDigest, "21655efa");
  assert.equal(record.task26EvidenceDigest, "8dfe2f1b");
});

test("the round names what each ablation selected and the rule that refused it", () => {
  const { record } = decide();
  assert.deepEqual(record.ablations.map(({ ablation }) => ablation), [
    "ablation-1-round-one-grid",
    "ablation-2-refined-family",
    "ablation-3-bass-axis",
  ]);
  for (const ablation of record.ablations) {
    // Discovery did select profiles; the stop rule refused every ablation. The
    // conclusion must be able to say both, so neither may be lost here.
    assert.ok(ablation.selectedProfileIds.length > 0);
    assert.equal(ablation.stopSatisfied, false);
    assert.deepEqual(ablation.stopReasons, ["selected-set-has-no-material-repeated-recovery"]);
    assert.equal(ablation.registrable, false);
  }
});

test("the not-run branch spent no confirmation fixture and collected no live corpus", () => {
  const { record } = decide();
  assert.equal(record.liveCorpus.status, "not-collected");
  assert.deepEqual([...record.liveCorpus.results], []);
  assert.deepEqual(record.confirmationPartition, {
    traceCount: 12,
    decodedTraceCount: 0,
    priorLedgerHash: "1f9613bd",
    traceGenerationHash: "d1971fa3",
    traceIdentityHash: "a5695acc",
  });
  // No entry exists, so neither Task 24 label exists to copy, and none is invented.
  assert.deepEqual([...record.repeatedChordResult], []);
});

test("a live corpus on the not-run branch is refused rather than recorded", () => {
  // The not-run branch confirmed nothing, so a session against it played
  // candidates that were never eligible; the archive is refused outright.
  assert.throws(
    () => decide({
      liveArchives: [listenLiveArchiveFixture({
        eligibilityManifestDigest: listenRoundTwoEligibilityManifestDigest(committedEligibility()),
        profileIds: ["early-open-v2"],
      })],
    }),
    /holds no automated-eligible candidate/,
  );
  // And a record that states live results the branch cannot have is refused with
  // the archives absent, rather than passing because nothing could be checked.
  const stated = amended(committedList(), (draft) => {
    draft.liveCorpus = {
      status: "collected",
      archives: [{ path: "benchmark-results/invented.json", sha256: "a".repeat(64), digest: "0badf00d" }],
      results: [{
        profileId: "early-open-v2",
        status: "passed",
        setupCoverage: [{ setupId: "invented", sourceFamily: "acoustic", trialCount: 1 }],
        gates: [],
      }],
    };
  });
  assert.ok(problemsFor(stated)
    .some((problem) => /gate rows produce failed|archives they were derived from/.test(problem)));
});

/* ------------------------------------------------------------------------- *
 * Membership
 * ------------------------------------------------------------------------- */

test("membership is the incumbent plus candidates that passed automated and live gates", () => {
  const eligibility = completedEligibility([
    entry("early-open-v2"),
    entry("steady-open-v2"),
    entry("early-held-v2", {
      automatedEligible: false,
      rejectionReasons: ["safety-isolated-false-advance"],
      repeatedRecoveryOutcome: "unchanged",
    }),
  ]);
  // The decoder reports a bass onset nobody played at 0.52: above
  // `steady-open-v2`'s 0.50 gate and below the incumbent's 0.60, so that
  // candidate advances a trial the incumbent refuses. Which candidate fails is
  // decided by the performance, and the result is rederived from that trial.
  const archives = [liveArchive(eligibility, hallucinatedBass("acoustic-upright-room-a", 0.52))];
  const liveResults = ["early-open-v2", "steady-open-v2"]
    .map((profileId) => listenRoundTwoLiveResult({ profileId, archives }));
  assert.deepEqual(liveResults.map(({ status }) => status), ["failed", "failed"]);
  assert.deepEqual(
    listenRoundTwoApprovedProfileIds({ eligibility, liveResults }),
    ["baseline-v1"],
  );
  // Below both gates, both candidates refuse it and both are approved.
  const clean = ["early-open-v2", "steady-open-v2"].map((profileId) => listenRoundTwoLiveResult({
    profileId,
    archives: [liveArchive(eligibility, hallucinatedBass("acoustic-upright-room-a", 0.4))],
  }));
  assert.deepEqual(clean.map(({ status }) => status), ["passed", "passed"]);
  assert.deepEqual(
    listenRoundTwoApprovedProfileIds({ eligibility, liveResults: clean }),
    ["baseline-v1", "early-open-v2", "steady-open-v2"],
  );
});

test("an automated-eligible candidate whose live gates were skipped is not approved", () => {
  const eligibility = completedEligibility([entry("early-open-v2")]);
  // No live corpus at all, and a corpus that never played this candidate, are the
  // same finding for membership and both differ from a pass.
  assert.deepEqual(
    listenRoundTwoApprovedProfileIds({ eligibility, liveResults: [] }),
    ["baseline-v1"],
  );
  const skipped = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [liveArchive(completedEligibility([entry("steady-open-v2")]), () => ({}),
      ["steady-open-v2"])],
  });
  assert.equal(skipped.status, "not-collected");
  assert.deepEqual(
    listenRoundTwoApprovedProfileIds({ eligibility, liveResults: [skipped] }),
    ["baseline-v1"],
  );
});

test("a live status its own gates do not support cannot approve a profile", () => {
  const eligibility = completedEligibility([entry("early-open-v2")]);
  const measured = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [liveArchive(eligibility, hallucinatedBass())],
  });
  assert.equal(measured.status, "failed");
  // The invented row is the one this whole path exists to refuse: a `passed`
  // status over gate rows that failed, and a bare row carrying no gates at all.
  assert.throws(
    () => listenRoundTwoApprovedProfileIds({
      eligibility,
      liveResults: [{ ...measured, status: "passed" }],
    }),
    /its own gate rows produce failed/,
  );
  assert.throws(
    () => listenRoundTwoApprovedProfileIds({
      eligibility,
      liveResults: [{
        profileId: "early-open-v2",
        status: "passed",
        setupCoverage: [{ setupId: "invented", sourceFamily: "acoustic", trialCount: 1 }],
        gates: [],
      }],
    }),
    /its own gate rows produce failed/,
  );
});

test("registry membership is not approval", () => {
  // Every rejected and historical profile stays in the registry for rollback and
  // replay, so the registry is larger than the approved list by design.
  assert.ok(LISTEN_MATCHER_PROFILE_IDS.length > LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS.length);
  for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
    assert.equal(
      isApprovedListenMatcherProfileId(profileId),
      profileId === LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID,
    );
  }
  assert.throws(() => assertOfferableListenMatcherProfileId("early-open-v2"), /not an approved/);
  assert.throws(() => assertOfferableListenMatcherProfileId("nonexistent-v9"), /not an approved/);
  assert.equal(assertOfferableListenMatcherProfileId("baseline-v1"), "baseline-v1");
});

test("live evidence cannot approve a profile the automated gates did not clear", () => {
  const rejected = completedEligibility([
    entry("early-open-v2", {
      automatedEligible: false,
      rejectionReasons: ["release-isolated-recognition"],
      repeatedRecoveryOutcome: "unchanged",
    }),
  ]);
  const eligible = completedEligibility([entry("early-open-v2")]);
  const passed = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [liveArchive(eligible)],
  });
  assert.throws(
    () => listenRoundTwoApprovedProfileIds({ eligibility: rejected, liveResults: [passed] }),
    /does not mark automated-eligible/,
  );
  assert.throws(
    () => listenRoundTwoApprovedProfileIds({
      eligibility: eligible,
      liveResults: [passed, passed],
    }),
    /twice/,
  );
});

test("the approved list a record states must be the one its own evidence approves", () => {
  const overstated = amended(committedList(), (draft) => {
    draft.approvedProfileIds = ["baseline-v1", "early-open-v2"];
  });
  assert.ok(problemsFor(overstated).some((problem) => /its own evidence approves/.test(problem)));
  const withoutIncumbent = amended(committedList(), (draft) => {
    draft.approvedProfileIds = [];
  });
  assert.ok(problemsFor(withoutIncumbent).some((problem) => /omits baseline-v1/.test(problem)));
});

/* ------------------------------------------------------------------------- *
 * The default, and the rollout it describes
 * ------------------------------------------------------------------------- */

test("the selected default must be a member of the list it heads", () => {
  // There is no option to supply one: the default comes out of the frozen rule,
  // and a record naming a non-member fails validation.
  assert.ok(!Object.hasOwn(decide(), "selectedDefaultProfileId"));
  assert.ok(problemsFor(amended(committedList(), (draft) => {
    draft.selectedDefaultProfileId = "early-open-v2";
  })).some((problem) => /is not a member of the list it heads/.test(problem)));
});

test("a round that approved no candidate must end on the incumbent", () => {
  const promotedWithoutApproval = amended(committedList(), (draft) => {
    draft.outcome = "promoted-candidate";
  });
  assert.ok(problemsFor(promotedWithoutApproval)
    .some((problem) => /promoted candidate and ends on the incumbent/.test(problem)));
});

test("the artifact may not describe a rollout the code did not perform", () => {
  assert.throws(
    () => decide({ productionDefaultProfileId: "balanced-v1" }),
    /production resolves balanced-v1/,
  );
  assert.deepEqual(
    listenRoundTwoRolloutProblems({
      approvedProfileIds: ["baseline-v1"],
      selectedDefaultProfileId: "baseline-v1",
      productionDefaultProfileId: "baseline-v1",
    }),
    [],
  );
  // The offered list is checked against the constant production would read, so a
  // shipped list cannot drift from the evidence that approved it.
  assert.equal(
    listenRoundTwoRolloutProblems({
      approvedProfileIds: ["baseline-v1", "early-open-v2"],
      selectedDefaultProfileId: "baseline-v1",
      productionDefaultProfileId: "baseline-v1",
    }).length,
    1,
  );
  assert.equal(
    listenRoundTwoRolloutProblems({
      approvedProfileIds: ["baseline-v1"],
      selectedDefaultProfileId: "baseline-v1",
      productionDefaultProfileId: "baseline-v1",
      shippedApprovedProfileIds: ["baseline-v1", "early-open-v2"],
    }).length,
    1,
  );
});

test("production runs and reports the identifier this decision retained", () => {
  assert.equal(DEFAULT_LISTEN_MATCHER_PROFILE_ID, "baseline-v1");
  assert.equal(resolveEffectiveListenMatcherProfile().id, "baseline-v1");
  assert.equal(resolveEffectiveListenMatcherProfile(null).id, "baseline-v1");
  assert.ok(LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS.includes(DEFAULT_LISTEN_MATCHER_PROFILE_ID));
});

/* ------------------------------------------------------------------------- *
 * The completed branch: approval and promotion, both rederived
 * ------------------------------------------------------------------------- */

/** The candidate manifest a completed round would have frozen. */
function completedCandidateManifest(profileIds: readonly string[]): Record<string, unknown> {
  const record = structuredClone(committedCandidateManifest()) as Record<string, unknown>;
  record.candidateProfileIds = [...profileIds];
  record.notRunReason = null;
  record.ablationId = "ablation-2-refined-family";
  const { digest: _digest, ...rest } = record;
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoCandidateManifestDigest(rest),
  };
  return record;
}

/**
 * A completed decision, assembled the way the emitter assembles one.
 *
 * The chain this round froze is the not-run branch, so no committed evidence can
 * produce a completed record and the emitter refuses to invent one. The rules
 * that branch carries — live gates rederived from archives, membership from those
 * gates, a default from the frozen ordered rule — are still real rules, so they
 * are exercised against a record of exactly the shape the emitter would write.
 */
function completedDecision(options: {
  candidateProfileIds?: readonly string[];
  performance?: Parameters<typeof listenLiveArchiveFixture>[0]["performance"];
  counters?: Parameters<typeof listenConfirmationArchiveFixture>[0]["counters"];
  isolatedCorrectAdvanceCount?:
    Parameters<typeof listenConfirmationArchiveFixture>[0]["isolatedCorrectAdvanceCount"];
} = {}) {
  const candidateProfileIds = options.candidateProfileIds ?? ["early-open-v2", "steady-open-v2"];
  const eligibility = completedEligibility(candidateProfileIds.map((profileId) => entry(profileId)));
  const candidateManifest = completedCandidateManifest(candidateProfileIds);
  (eligibility as unknown as Record<string, unknown>).candidateManifestDigest =
    (candidateManifest.digest as { value: string }).value;
  (eligibility as unknown as Record<string, unknown>).digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest(eligibility),
  };
  const eligibilityManifestDigest = listenRoundTwoEligibilityManifestDigest(eligibility);
  const liveArchives = [listenLiveArchiveFixture({
    eligibilityManifestDigest,
    profileIds: candidateProfileIds,
    performance: options.performance,
  })];
  const confirmationArchives = [0, 1].map(() => listenConfirmationArchiveFixture({
    profileIds: candidateProfileIds,
    counters: options.counters,
    isolatedCorrectAdvanceCount: options.isolatedCorrectAdvanceCount,
  }));
  const liveResults = candidateProfileIds
    .map((profileId) => listenRoundTwoLiveResult({ profileId, archives: liveArchives }));
  const approvedProfileIds = listenRoundTwoApprovedProfileIds({ eligibility, liveResults });
  const approvedCandidateIds = approvedProfileIds
    .filter((profileId) => profileId !== "baseline-v1");
  const selection = approvedCandidateIds.length === 0 ? undefined : listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: approvedCandidateIds,
    live: listenRoundTwoLiveMeasurements({
      archives: liveArchives,
      profileIds: approvedCandidateIds,
    }),
    automated: listenRoundTwoAutomatedMeasurements({
      archive: confirmationArchives[0],
      profileIds: approvedCandidateIds,
    }),
    confirmationArchive: confirmationArchives[0],
  });
  const record: Record<string, unknown> = {
    name: "listen-round-two-approved-profiles",
    formatVersion: 1,
    roundId: "round-two",
    outcome: selection?.promotedProfileId != null
      ? "promoted-candidate"
      : approvedCandidateIds.length > 0
      ? "approved-without-material-improvement"
      : "round-two-candidate-set-exhausted",
    reason: null,
    selectedDefaultProfileId: selection?.selectedProfileId ?? "baseline-v1",
    incumbentProfileId: "baseline-v1",
    approvedProfileIds,
    eligibilityRunStatus: "completed",
    eligibilityManifestDigest,
    candidateManifestDigest: (candidateManifest.digest as { value: string }).value,
    task26TerminalOutcome: eligibility.task26TerminalOutcome,
    task26EvidenceDigest: eligibility.task26EvidenceDigest,
    liveCorpus: {
      status: "collected",
      archives: liveArchives.map((archive) => ({
        path: `benchmark-results/listen-round-two-live-${archive.digest.value}.json`,
        sha256: "e".repeat(64),
        digest: archive.digest.value,
      })),
      results: liveResults,
    },
    repeatedChordResult: eligibility.entries.map(({
      profileId,
      repeatedRecoveryOutcome,
      confirmationReproductionStatus,
    }) => ({ profileId, repeatedRecoveryOutcome, confirmationReproductionStatus })),
    confirmationPartition: eligibility.confirmationPartition,
    ablations: (committedList() as { ablations: unknown }).ablations,
    ...(selection === undefined ? {} : { selection }),
    modelEvidenceRequirement: {
      path: LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE,
      sha256: requirementSha256(),
    },
  };
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoApprovedProfilesDigest(record),
  };
  const check = (draft: unknown = record) => listenRoundTwoApprovedProfilesProblems({
    record: draft,
    eligibility,
    candidateManifest,
    liveArchives,
    confirmationArchives,
  });
  return { record, eligibility, candidateManifest, liveArchives, confirmationArchives, check };
}

test("a completed round promotes the profile the frozen rule produces", () => {
  const { record, check } = completedDecision({
    // The decoder reports a bass onset nobody played, inside the corridor that
    // only `early-open-v2` admits, so its live gates fail and only
    // `steady-open-v2` remains approvable.
    performance: hallucinatedBass(),
  });
  assert.deepEqual(check(), []);
  assert.equal(record.outcome, "promoted-candidate");
  assert.deepEqual(record.approvedProfileIds, ["baseline-v1", "steady-open-v2"]);
  assert.equal(record.selectedDefaultProfileId, "steady-open-v2");
});

test("a promoted default the ordered rule does not produce is refused", () => {
  const { record, check } = completedDecision();
  assert.deepEqual(check(), []);
  const selected = record.selectedDefaultProfileId;
  const other = (record.approvedProfileIds as string[])
    .find((profileId) => profileId !== selected && profileId !== "baseline-v1");
  assert.ok(other !== undefined && other !== selected);
  const swapped: Record<string, unknown> = { ...record, selectedDefaultProfileId: other };
  swapped.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoApprovedProfilesDigest(swapped),
  };
  assert.ok(check(swapped)
    .some((problem) => /the frozen ordered rule produces/.test(problem)));
});

test("a live result the archives do not produce is refused", () => {
  // The archive records a false advance for `early-open-v2`; the record is edited
  // to report it as clean, which is exactly the self-reported approval the
  // rederivation exists to catch.
  const { record, check } = completedDecision({ performance: hallucinatedBass() });
  const tampered = structuredClone(record) as Record<string, unknown>;
  const liveCorpus = tampered.liveCorpus as { results: Array<Record<string, unknown>> };
  liveCorpus.results[0].status = "passed";
  liveCorpus.results[0].gates = (liveCorpus.results[0].gates as Array<Record<string, unknown>>)
    .map((gate) => ({ ...gate, passed: true, failures: [] }));
  tampered.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoApprovedProfilesDigest(tampered),
  };
  // The rows are recomputed from the archives, so a row edited to pass fails even
  // though it is internally consistent with its own status.
  assert.ok(check(tampered)
    .some((problem) => /not what its own archives produce/.test(problem)));
});

test("a stated live corpus with no archives to check is refused", () => {
  const { record, eligibility, candidateManifest, confirmationArchives } = completedDecision();
  const problems = listenRoundTwoApprovedProfilesProblems({
    record,
    eligibility,
    candidateManifest,
    confirmationArchives,
  });
  assert.ok(problems.some((problem) => /archives they were derived from/.test(problem)));
});

test("a ranking without both confirmation repetitions is refused", () => {
  const { record, eligibility, candidateManifest, liveArchives, confirmationArchives } =
    completedDecision();
  const problems = listenRoundTwoApprovedProfilesProblems({
    record,
    eligibility,
    candidateManifest,
    liveArchives,
    confirmationArchives: confirmationArchives.slice(0, 1),
  });
  assert.ok(problems.some((problem) => /both archived confirmation repetitions/.test(problem)));
});

test("approved candidates that show no material improvement do not move the default", () => {
  const { record, check } = completedDecision({
    counters: (): Record<string, number> => ({
      correctAdvanceCount: 1,
      independentMatchCount: 3,
      orderedAdvanceCount: 1,
    }),
    isolatedCorrectAdvanceCount: () => 90,
  });
  assert.deepEqual(check(), []);
  assert.equal(record.outcome, "approved-without-material-improvement");
  assert.equal(record.selectedDefaultProfileId, "baseline-v1");
  // Approval and promotion are different decisions: calibration may still offer
  // these profiles even though production did not move to one.
  assert.deepEqual(record.approvedProfileIds,
    ["baseline-v1", "early-open-v2", "steady-open-v2"]);
  // The rule did separate them — the closer profile wins the last step — and the
  // winner is then refused promotion for showing no material gain.
  assert.equal(
    (record.selection as { notPromotedReason: string }).notPromotedReason,
    "no-material-improvement",
  );
  assert.equal(
    (record.selection as { comparisons: Array<{ decidedByStep: string }> })
      .comparisons[0].decidedByStep,
    "distance-from-baseline",
  );
});

/* ------------------------------------------------------------------------- *
 * The residual the round still owes
 * ------------------------------------------------------------------------- */

test("a round that resolves nothing carries the decoder/model-evidence requirement", () => {
  const { record } = decide();
  assert.equal(record.modelEvidenceRequirement?.path, LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE);
  assert.equal(record.modelEvidenceRequirement?.sha256, requirementSha256());
  assert.throws(
    () => decide({ modelEvidenceRequirementSha256: undefined }),
    /decoder\/model-evidence requirement/,
  );
  const stripped = structuredClone(committedList()) as Record<string, unknown>;
  delete stripped.modelEvidenceRequirement;
  stripped.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoApprovedProfilesDigest(stripped),
  };
  assert.ok(problemsFor(stripped)
    .some((problem) => /carries no decoder\/model-evidence requirement/.test(problem)));
});

test("the requirement is owed by every branch except a confirmed full resolution", () => {
  const owed = (outcome: string, repeated: Array<Record<string, unknown>>) =>
    listenRoundTwoRequiresModelEvidenceRequirement({
      outcome: outcome as never,
      selectedDefaultProfileId: "early-open-v2",
      repeatedChordResult: repeated as never,
    });
  const label = (repeatedRecoveryOutcome: string, confirmationReproductionStatus: string) => [{
    profileId: "early-open-v2",
    repeatedRecoveryOutcome,
    confirmationReproductionStatus,
  }];
  assert.equal(owed("round-two-grid-produced-no-eligible-improvement", []), true);
  assert.equal(owed("round-two-candidate-set-exhausted", []), true);
  // Shipping a safer threshold is not a resolved missing re-onset.
  assert.equal(owed("promoted-candidate", label("material-partial-recovery", "reproduced")), true);
  assert.equal(
    owed("promoted-candidate", label("discovery-full-resolution", "inconclusive-no-reproduction")),
    true,
  );
  assert.equal(owed("promoted-candidate", label("confirmed-full-resolution", "reproduced")), false);
});

test("the requirement is referenced by the digest of its actual bytes", () => {
  const { record } = decide();
  const digest = record.modelEvidenceRequirement?.sha256;
  assert.match(digest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(digest, createHash("sha256")
    .update(readBytes(LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE)).digest("hex"));
  const text = readBytes(LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE).toString("utf8");
  // Both decoder defects the residual carries, and the acceptance question.
  assert.match(text, /never sounded/);
  assert.match(text, /D5\/74/);
  assert.match(text, /source distance 0/);
  // Task 21 is unreachable this round and must not be named as the next step.
  assert.match(text, /does not name Task 21 as the next step/);
});

/* ------------------------------------------------------------------------- *
 * The bounded conclusion, and the chain it rests on
 * ------------------------------------------------------------------------- */

test("the outcome distinguishes a matrix that never ran from one that rejected everything", () => {
  const { record } = decide();
  assert.equal(record.outcome, "round-two-grid-produced-no-eligible-improvement");
  // A completed matrix that rejected every candidate spent the round's
  // confirmation fixtures and reaches the other bounded conclusion.
  const eligibility = completedEligibility([
    entry("early-open-v2", {
      automatedEligible: false,
      rejectionReasons: ["safety-isolated-false-advance"],
      repeatedRecoveryOutcome: "unchanged",
    }),
  ]);
  assert.deepEqual(listenRoundTwoApprovedProfileIds({ eligibility }), ["baseline-v1"]);
  const relabelled = amended(committedList(), (draft) => {
    draft.outcome = "round-two-candidate-set-exhausted";
  });
  assert.ok(problemsFor(relabelled)
    .some((problem) => /its own evidence produces/.test(problem)));
});

test("each link is recomputed from the record it describes", () => {
  for (const field of ["eligibilityManifestDigest", "candidateManifestDigest"]) {
    const broken = amended(committedList(), (draft) => { draft[field] = "deadbeef"; });
    assert.ok(problemsFor(broken).some((problem) => /hashes to/.test(problem)));
  }
  const wrongOutcome = amended(committedList(), (draft) => {
    draft.task26TerminalOutcome = "bass-axis-supported";
  });
  assert.ok(problemsFor(wrongOutcome)
    .some((problem) => /disagrees about task26TerminalOutcome/.test(problem)));
  const wrongReason = amended(committedList(), (draft) => {
    draft.reason = "no-supported-parameterization";
  });
  assert.ok(problemsFor(wrongReason).some((problem) => /records reason/.test(problem)));
  const wrongStatus = amended(committedList(), (draft) => {
    draft.eligibilityRunStatus = "completed";
  });
  assert.ok(problemsFor(wrongStatus).some((problem) => /records run status/.test(problem)));
  const wrongPartition = amended(committedList(), (draft) => {
    draft.confirmationPartition = {
      ...(draft.confirmationPartition as Record<string, unknown>),
      decodedTraceCount: 12,
    };
  });
  assert.ok(problemsFor(wrongPartition)
    .some((problem) => /not the one the eligibility manifest measured/.test(problem)));
});

test("the chain is refused when an earlier link is not what this commit re-derives", () => {
  const relabelledCandidate = structuredClone(committedCandidateManifest()) as
    Record<string, unknown>;
  relabelledCandidate.notRunReason = "no-supported-parameterization";
  assert.throws(
    () => decide({ candidateManifest: relabelledCandidate }),
    /not the record this commit's Task 26 archives re-derive/,
  );
  const relabelledEligibility = structuredClone(committedEligibility()) as Record<string, unknown>;
  relabelledEligibility.reason = "no-supported-parameterization";
  relabelledEligibility.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest(relabelledEligibility),
  };
  assert.throws(() => decide({ eligibility: relabelledEligibility }), /immutable|differs from it/);
});

test("the record's own schema is exact", () => {
  const list = committedList() as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(list).sort(),
    [...LISTEN_ROUND_TWO_APPROVED_PROFILES_KEYS, "modelEvidenceRequirement"].sort(),
  );
  const extra = amended(list, (draft) => { draft.notes = "promising"; });
  assert.ok(problemsFor(extra).some((problem) => /forbidden field notes/.test(problem)));
  const stated = structuredClone(list) as Record<string, unknown>;
  stated.digest = { algorithm: "fnv1a-32-canonical-json", value: "00000000" };
  assert.ok(problemsFor(stated).some((problem) => /recomputed/.test(problem)));
});

test("the repeated-chord result is copied from the eligibility labels, not restated", () => {
  const record = committedList() as ListenRoundTwoApprovedProfileList;
  assert.deepEqual([...record.repeatedChordResult], []);
  const invented = amended(record, (draft) => {
    draft.repeatedChordResult = [{
      profileId: "early-open-v2",
      repeatedRecoveryOutcome: "confirmed-full-resolution",
      confirmationReproductionStatus: "reproduced",
    }];
  });
  assert.ok(problemsFor(invented)
    .some((problem) => /not a copy of the eligibility manifest's own labels/.test(problem)));
});
