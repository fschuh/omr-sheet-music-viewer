import assert from "node:assert/strict";
import test from "node:test";

import { LISTEN_MATCHER_PROFILES } from "./listenMatcherProfiles";
import {
  listenConfirmationArchiveFixture,
  listenLiveArchiveFixture,
  listenLivePerformedAttack,
  listenLiveStrongPitch,
} from "./listenRoundTwoCompletedFixtures";
import {
  LISTEN_ROUND_TWO_SELECTION_STEPS,
  listenMatcherProfileDistanceFromBaseline,
  listenRoundTwoAutomatedMeasurements,
  listenRoundTwoLiveMeasurements,
  listenRoundTwoMaterialImprovement,
  listenRoundTwoSelectDefault,
} from "./listenRoundTwoDefaultSelection";

const CANDIDATES = ["early-open-v2", "steady-open-v2"];
const ELIGIBILITY_DIGEST = "1a2b3c4d";

function liveArchive(
  performance: Parameters<typeof listenLiveArchiveFixture>[0]["performance"] = undefined,
) {
  return listenLiveArchiveFixture({
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    profileIds: CANDIDATES,
    performance,
  });
}

function live(
  performance: Parameters<typeof listenLiveArchiveFixture>[0]["performance"] = undefined,
) {
  return listenRoundTwoLiveMeasurements({
    archives: [liveArchive(performance)],
    profileIds: CANDIDATES,
  });
}

/**
 * A decoded onset on a bass pitch nobody played, on one setup only.
 *
 * The default 0.47 sits inside the measured hallucination corridor and between
 * the two candidates' onset gates, so the decoder's report — not the fixture —
 * decides which profile admits it.
 */
function hallucinatedBass(setupId: string, onset = 0.47) {
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

function automated(
  overrides: Partial<Parameters<typeof listenConfirmationArchiveFixture>[0]> = {},
) {
  return listenRoundTwoAutomatedMeasurements({
    archive: listenConfirmationArchiveFixture({ profileIds: CANDIDATES, ...overrides }),
    profileIds: CANDIDATES,
  });
}

/** Both columns measure alike, so nothing the ranking reads separates them. */
const INDISTINGUISHABLE: Record<string, number> = {
  correctAdvanceCount: 1,
  independentMatchCount: 3,
  orderedAdvanceCount: 1,
};

/* ------------------------------------------------------------------------- *
 * Measurements
 * ------------------------------------------------------------------------- */

test("automated measurements are summed from the archive's own outcome rows", () => {
  const measurements = automated();
  const baseline = measurements.find(({ profileId }) => profileId === "baseline-v1")!;
  const candidate = measurements.find(({ profileId }) => profileId === "early-open-v2")!;
  // A leaf is a renderer and an instrument, never a renderer alone.
  assert.deepEqual(
    baseline.renderers.map(({ rendererKey, instrument }) => `${rendererKey}/${instrument}`),
    ["direct/none", "direct/salamander", "tone/none", "tone/salamander"],
  );
  for (const renderer of baseline.renderers) {
    assert.equal(renderer.traceCount, 2);
    assert.equal(renderer.independentMatchCount, 6);
  }
  for (const renderer of candidate.renderers) assert.equal(renderer.independentMatchCount, 8);
  assert.equal(candidate.renderers[0].worstP95OnsetToAdvanceMs, 180);
});

test("a column missing an outcome row is not measured", () => {
  const archive = listenConfirmationArchiveFixture({ profileIds: CANDIDATES });
  archive.outcomes = (archive.outcomes as Array<{ profileId: string }>)
    .filter((row, index) => !(row.profileId === "early-open-v2" && index % 7 === 0));
  assert.throws(
    () => listenRoundTwoAutomatedMeasurements({ archive, profileIds: CANDIDATES }),
    /a column with a missing row is not measured/,
  );
});

test("live measurements stay per setup", () => {
  const measurements = live();
  const candidate = measurements.find(({ profileId }) => profileId === "early-open-v2")!;
  assert.deepEqual(candidate.setups.map(({ sourceFamily }) => sourceFamily),
    ["acoustic", "digital"]);
  for (const setup of candidate.setups) {
    assert.equal(setup.expectedCorrectTrialCount, 3);
    assert.equal(setup.correctAdvanceCount, 3);
    assert.equal(setup.unsafeEventCount, 0);
  }
});

test("distance from the incumbent comes from the registry's own values", () => {
  assert.equal(listenMatcherProfileDistanceFromBaseline("baseline-v1"), 0);
  const early = LISTEN_MATCHER_PROFILES["early-open-v2"];
  const baseline = LISTEN_MATCHER_PROFILES["baseline-v1"];
  assert.equal(
    listenMatcherProfileDistanceFromBaseline("early-open-v2"),
    Math.abs(early.onsetThreshold - baseline.onsetThreshold) +
      Math.abs(early.targetNoteThreshold - baseline.targetNoteThreshold) +
      Math.abs(early.activeTargetThreshold - baseline.activeTargetThreshold) +
      Math.abs(early.extraNoteThreshold - baseline.extraNoteThreshold),
  );
  // `steady-open-v2` moves the onset gate less, so it is the closer profile.
  assert.ok(listenMatcherProfileDistanceFromBaseline("steady-open-v2") <
    listenMatcherProfileDistanceFromBaseline("early-open-v2"));
});

/* ------------------------------------------------------------------------- *
 * The ordered rule
 * ------------------------------------------------------------------------- */

test("the first step that separates two candidates decides, in the frozen order", () => {
  // `early-open-v2` admits a hallucinated bass on the acoustic setup; step 1
  // decides before any recognition gain at step 3 can be weighed.
  const archives = [liveArchive(hallucinatedBass("acoustic-upright-room-a"))];
  const confirmationArchive = listenConfirmationArchiveFixture({
    profileIds: CANDIDATES,
    counters: ({ profileId }): Record<string, number> => (
      profileId === "early-open-v2" ? { independentMatchCount: 9 } : {}
    ),
  });
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: CANDIDATES,
    live: listenRoundTwoLiveMeasurements({ archives, profileIds: CANDIDATES }),
    automated: listenRoundTwoAutomatedMeasurements({
      archive: confirmationArchive,
      profileIds: CANDIDATES,
    }),
    confirmationArchive,
  });
  assert.equal(selection.selectedProfileId, "steady-open-v2");
  const [comparison] = selection.comparisons;
  assert.equal(comparison.winnerProfileId, "steady-open-v2");
  assert.equal(comparison.loserProfileId, "early-open-v2");
  assert.equal(comparison.decidedByStep, "live-safety");
});

test("an ordered gain never conceals a complete-passage loss", () => {
  // The candidate advances more targets on Direct and completes fewer passages
  // there. Summed, it would win; as two measures it holds neither side and the
  // step ties, which is the cascade trade the frozen rule refuses.
  const confirmationArchive = listenConfirmationArchiveFixture({
    profileIds: CANDIDATES,
    counters: ({ profileId, rendererKey }): Record<string, number> => (
      profileId === "early-open-v2" && rendererKey === "direct"
        ? { orderedAdvanceCount: 6, completePassageCount: 0 }
        : {}
    ),
  });
  const automatedRows = listenRoundTwoAutomatedMeasurements({
    archive: confirmationArchive,
    profileIds: CANDIDATES,
  });
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: CANDIDATES,
    live: live(),
    automated: automatedRows,
    confirmationArchive,
  });
  const [comparison] = selection.comparisons;
  assert.notEqual(comparison.decidedByStep, "ordered-and-complete-progress");
});

test("a gain on one instrument does not win a step lost on another", () => {
  // Independent recognition is compared per renderer *and* per instrument: a
  // Salamander gain that costs an isolated-corpus loss under the same renderer
  // leaves the step tied rather than won.
  const confirmationArchive = listenConfirmationArchiveFixture({
    profileIds: CANDIDATES,
    counters: ({ profileId, instrument }): Record<string, number> => {
      if (profileId !== "early-open-v2") return {};
      return instrument === "salamander"
        ? { independentMatchCount: 9 }
        : { independentMatchCount: 1 };
    },
  });
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: CANDIDATES,
    live: live(),
    automated: listenRoundTwoAutomatedMeasurements({
      archive: confirmationArchive,
      profileIds: CANDIDATES,
    }),
    confirmationArchive,
  });
  const [comparison] = selection.comparisons;
  assert.notEqual(comparison.decidedByStep, "automated-independent-recognition");
});

test("a clean corpus leaves the live steps tied rather than won", () => {
  // Neither candidate introduces an unsafe event or loses a correct advance on
  // either instrument, so steps one and two tie by dominance instead of being
  // decided by whichever total happened to be larger.
  const archives = [listenLiveArchiveFixture({
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    profileIds: CANDIDATES,
  })];
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: CANDIDATES,
    live: listenRoundTwoLiveMeasurements({ archives, profileIds: CANDIDATES }),
    automated: automated(),
    confirmationArchive: listenConfirmationArchiveFixture({ profileIds: CANDIDATES }),
  });
  const [comparison] = selection.comparisons;
  assert.notEqual(comparison.decidedByStep, "live-safety");
  // Both columns measure alike automatically, so the last step decides: the
  // profile whose thresholds sit closer to the incumbent.
  assert.equal(comparison.decidedByStep, "distance-from-baseline");
  assert.equal(selection.selectedProfileId, "steady-open-v2");
});

test("candidates that tie at every step are not separated by an invented rule", () => {
  // `sensitive-v1` repeats `early-open-v2`'s values, so even the last step ties.
  const profileIds = ["early-open-v2", "sensitive-v1"];
  const confirmationArchive = listenConfirmationArchiveFixture({ profileIds });
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: profileIds,
    live: listenRoundTwoLiveMeasurements({
      archives: [listenLiveArchiveFixture({
        eligibilityManifestDigest: ELIGIBILITY_DIGEST,
        profileIds,
      })],
      profileIds,
    }),
    automated: listenRoundTwoAutomatedMeasurements({ archive: confirmationArchive, profileIds }),
    confirmationArchive,
  });
  assert.equal(selection.selectedProfileId, "baseline-v1");
  assert.equal(selection.promotedProfileId, null);
  assert.equal(selection.notPromotedReason, "ordered-rule-did-not-separate");
  assert.equal(selection.comparisons[0].decidedByStep, null);
  assert.match(selection.comparisons[0].reason, /tie at every step/);
});

/* ------------------------------------------------------------------------- *
 * Promotion materiality is Task 23's, not this module's
 * ------------------------------------------------------------------------- */

test("materiality is the frozen recipe, over the axes Task 23 authorized", () => {
  const assessments = listenRoundTwoMaterialImprovement({
    profileId: "early-open-v2",
    archive: listenConfirmationArchiveFixture({ profileIds: CANDIDATES }),
  });
  const ids = assessments.map(({ id }) => id);
  // The isolated axes and the cross-domain safety axis are the policy's, named
  // by domain, renderer, and metric rather than rolled into one number.
  assert.ok(ids.includes("isolated/direct/isolated-correct-advance-rate"));
  assert.ok(ids.includes("isolated/tone/course-clear-correct-advance-rate"));
  assert.ok(ids.includes("isolated/direct/p95-onset-to-advance-ms"));
  assert.ok(ids.includes("cross-domain/unsafe-event-count"));
  assert.equal(
    assessments.find(({ id }) => id === "isolated/direct/isolated-correct-advance-rate")!.material,
    true,
  );
});

test("a candidate the frozen recipe finds immaterial is approved but not promoted", () => {
  const confirmationArchive = listenConfirmationArchiveFixture({
    profileIds: CANDIDATES,
    counters: (): Record<string, number> => INDISTINGUISHABLE,
    isolatedCorrectAdvanceCount: () => 90,
  });
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: ["early-open-v2"],
    live: live(),
    automated: listenRoundTwoAutomatedMeasurements({
      archive: confirmationArchive,
      profileIds: CANDIDATES,
    }),
    confirmationArchive,
  });
  assert.equal(selection.promotedProfileId, null);
  assert.equal(selection.notPromotedReason, "no-material-improvement");
  assert.equal(selection.selectedProfileId, "baseline-v1");
  assert.ok(selection.materialImprovement.length > 0);
  assert.ok(selection.materialImprovement.every(({ material }) => !material));
});

test("an archive with no measured domain cannot support a promotion", () => {
  const { isolated: _isolated, ...withoutDomains } =
    listenConfirmationArchiveFixture({ profileIds: CANDIDATES });
  assert.throws(
    () => listenRoundTwoMaterialImprovement({
      profileId: "early-open-v2",
      archive: withoutDomains,
    }),
    /none of the measured domains/,
  );
});

test("the frozen order is the plan's order", () => {
  assert.deepEqual([...LISTEN_ROUND_TWO_SELECTION_STEPS], [
    "live-safety",
    "live-correct-advancement",
    "automated-independent-recognition",
    "ordered-and-complete-progress",
    "latency",
    "distance-from-baseline",
  ]);
});

test("no approved candidate means no ranking and no promotion", () => {
  const selection = listenRoundTwoSelectDefault({
    approvedCandidateProfileIds: [],
    live: live(),
    automated: automated(),
    confirmationArchive: listenConfirmationArchiveFixture({ profileIds: CANDIDATES }),
  });
  assert.equal(selection.selectedProfileId, "baseline-v1");
  assert.equal(selection.notPromotedReason, "no-approved-candidate");
  assert.deepEqual([...selection.comparisons], []);
});
