import assert from "node:assert/strict";
import test from "node:test";

import {
  listenLiveArchiveFixture,
  listenLivePerformedAttack,
  listenLiveStrongPitch,
} from "./listenRoundTwoCompletedFixtures";
import {
  LISTEN_LIVE_GATE_CODES,
  LISTEN_LIVE_REQUIRED_TRIAL_CLASSES,
  listenRoundTwoLiveArchiveDigest,
  listenRoundTwoLiveArchiveProblems,
  listenRoundTwoLiveResult,
  listenRoundTwoLiveResults,
  listenRoundTwoLiveTrialFailures,
  listenRoundTwoLiveTrialReplay,
  type ListenLiveTrialOutcome,
  type ListenRoundTwoLiveArchive,
} from "./listenRoundTwoLiveEvidence";
import { LISTEN_MATCHER_PROFILES, listenMatcherThresholds } from "./listenMatcherProfiles";
import type { ListenRoundTwoEligibilityManifest } from "./listenRoundTwoEligibilityManifest";

const ELIGIBILITY_DIGEST = "1a2b3c4d";
const CANDIDATES = ["early-open-v2", "steady-open-v2"];

function archive(
  overrides: Partial<Parameters<typeof listenLiveArchiveFixture>[0]> = {},
): ListenRoundTwoLiveArchive {
  return listenLiveArchiveFixture({
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    profileIds: CANDIDATES,
    ...overrides,
  });
}

/**
 * The recorded omitted-bass mechanism: the decoder reports an onset on a bass
 * pitch nobody played, at 0.55 — inside the measured hallucination corridor, above
 * every candidate's onset gate and below the incumbent's.
 */
function hallucinatedBass(setupId?: string) {
  return (shape: { trialClass: string; setupId: string }) => {
    if (shape.trialClass !== "omitted-bass") return {};
    if (setupId !== undefined && shape.setupId !== setupId) return {};
    return {
      decoded: [listenLivePerformedAttack(0, [
        { midi: 48, onset: 0.55, noteConfidence: 0.9, active: 0.9, event: true },
        listenLiveStrongPitch(60),
        listenLiveStrongPitch(67),
      ])],
    };
  };
}

function completedEligibility(
  entries: Array<Record<string, unknown>>,
): ListenRoundTwoEligibilityManifest {
  return {
    runStatus: "completed",
    entries,
    digest: { algorithm: "fnv1a-32-canonical-json", value: ELIGIBILITY_DIGEST },
  } as unknown as ListenRoundTwoEligibilityManifest;
}

function amended(
  source: ListenRoundTwoLiveArchive,
  amend: (record: Record<string, unknown>) => void,
): ListenRoundTwoLiveArchive {
  const record = structuredClone(source) as unknown as Record<string, unknown>;
  amend(record);
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoLiveArchiveDigest(record),
  };
  return record as unknown as ListenRoundTwoLiveArchive;
}

function problemsFor(record: unknown, automatedEligibleProfileIds = CANDIDATES): string[] {
  return listenRoundTwoLiveArchiveProblems({
    archive: record,
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    automatedEligibleProfileIds,
  });
}

function trialOf(record: ListenRoundTwoLiveArchive, trialClass: string, setupIndex = 0) {
  const trial = record.setups[setupIndex].trials.find((row) => row.trialClass === trialClass);
  if (trial === undefined) throw new Error(`no ${trialClass} trial`);
  return trial;
}

/* ------------------------------------------------------------------------- *
 * The archive is a performance, and its outcomes are replayed from it
 * ------------------------------------------------------------------------- */

test("a live archive carries the score and the decoded trace it was measured from", () => {
  const record = archive();
  assert.deepEqual(problemsFor(record), []);
  const trial = trialOf(record, "chord");
  // The authored score: target pitches and the notes each attack played.
  assert.deepEqual(trial.sequence.targets, [[55, 59, 62]]);
  assert.deepEqual(
    trial.sequence.attacks[0].notes.map((note) => typeof note === "number" ? note : note.midi),
    [55, 59, 62],
  );
  assert.equal(trial.musical.chordSize, 3);
  assert.equal(trial.musical.registerBand, "middle");
  assert.ok(trial.decodedTrace.frames.length > 0);
  // One trace per trial, replayed by every column, and no audio in the export.
  assert.equal(trial.outcomes.length, CANDIDATES.length + 1);
  assert.ok(!Object.hasOwn(trial.decodedTrace, "pcm"));
});

test("every archived outcome is reproduced by replaying the trace", () => {
  const record = archive();
  for (const setup of record.setups) {
    for (const trial of setup.trials) {
      for (const outcome of trial.outcomes) {
        const replayed = listenRoundTwoLiveTrialReplay(
          trial,
          listenMatcherThresholds(LISTEN_MATCHER_PROFILES[
            outcome.profileId as keyof typeof LISTEN_MATCHER_PROFILES
          ]),
        );
        const { profileId: _profileId, ...stated } = outcome;
        assert.deepEqual(stated, replayed, `${trial.trialId} ${outcome.profileId}`);
      }
    }
  }
});

test("an outcome the archived performance does not produce is refused", () => {
  // The decision is not the archive's to state: an overstated row fails against
  // the trace it claims to come from.
  const overstated = amended(archive(), (record) => {
    const setups = record.setups as Array<Record<string, unknown>>;
    const trials = setups[0].trials as Array<Record<string, unknown>>;
    const trial = trials.find((row) => row.trialClass === "omitted-bass")!;
    const outcomes = trial.outcomes as Array<Record<string, unknown>>;
    outcomes[1].advanced = true;
    outcomes[1].correctAdvance = true;
    outcomes[1].latencyMs = 180;
  });
  const problems = problemsFor(overstated);
  assert.ok(problems.some((problem) => (
    /records early-open-v2 advanced true, and replaying the archived trace produces false/
      .test(problem)
  )));
});

test("a hallucinated bass onset is measured, not asserted", () => {
  // Nothing in the archive says the candidate advanced: the decoder reports an
  // onset on a pitch nobody played, and the replay shows which profiles admit it.
  const record = archive({ performance: hallucinatedBass() });
  assert.deepEqual(problemsFor(record), []);
  const trial = trialOf(record, "omitted-bass");
  const by = (profileId: string) => trial.outcomes.find((row) => row.profileId === profileId)!;
  assert.equal(by("baseline-v1").advanced, false);
  assert.equal(by("early-open-v2").advanced, true);
  assert.equal(by("early-open-v2").falseAdvanceCount, 1);
});

/* ------------------------------------------------------------------------- *
 * Labels cannot substitute for evidence
 * ------------------------------------------------------------------------- */

test("expectedCorrect must agree with the trial class in both directions", () => {
  const relabelled = amended(archive(), (record) => {
    for (const setup of record.setups as Array<Record<string, unknown>>) {
      for (const trial of setup.trials as Array<Record<string, unknown>>) {
        trial.expectedCorrect = false;
      }
    }
  });
  const problems = problemsFor(relabelled);
  // Every positive trial is caught; relabelling them cannot empty the gate.
  assert.equal(
    problems.filter((problem) => /records expectedCorrect false/.test(problem)).length,
    6,
  );
  const excused = amended(archive(), (record) => {
    const setups = record.setups as Array<Record<string, unknown>>;
    const trials = setups[0].trials as Array<Record<string, unknown>>;
    trials.find((row) => row.trialClass === "wrong-note")!.expectedCorrect = true;
  });
  assert.ok(problemsFor(excused)
    .some((problem) => /records expectedCorrect true/.test(problem)));
});

test("a correctness gate cannot be emptied by relabelling positive trials", () => {
  // The gate reads the class, so even a record that slipped past validation with
  // a wrong flag is still compared on its positive trials.
  const baseline: ListenLiveTrialOutcome = {
    profileId: "baseline-v1",
    advanced: true,
    correctAdvance: true,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    incompleteCarriedBassAdvanceCount: 0,
    latencyMs: 200,
    repeatedRecovery: null,
  };
  const failures = listenRoundTwoLiveTrialFailures({
    profileId: "early-open-v2",
    setup: { setupId: "acoustic", source: "acoustic-piano" },
    trial: { trialId: "acoustic/chord", trialClass: "chord" },
    baseline,
    candidate: { ...baseline, profileId: "early-open-v2", correctAdvance: false },
  });
  assert.deepEqual(failures.map(({ gate, measure }) => [gate, measure]),
    [["live-correctness", "correctAdvance"]]);
});

test("an unsafe counter without an advance is not a coherent row", () => {
  const incoherent = amended(archive(), (record) => {
    const setups = record.setups as Array<Record<string, unknown>>;
    const trials = setups[0].trials as Array<Record<string, unknown>>;
    const trial = trials.find((row) => row.trialClass === "wrong-note")!;
    (trial.outcomes as Array<Record<string, unknown>>)[0].falseAdvanceCount = 1;
  });
  assert.ok(problemsFor(incoherent)
    .some((problem) => /reports falseAdvanceCount without advancing/.test(problem)));
});

test("a live incumbent safety failure is archivable evidence", () => {
  // The incumbent advances a wrong-note trial the candidates refuse. Prohibiting
  // this would make the one live improvement that matters most unrecordable.
  const record = archive({
    performance: ({ trialClass }) => trialClass !== "wrong-note" ? {} : {
      decoded: [listenLivePerformedAttack(0, [
        listenLiveStrongPitch(60),
        { midi: 61, onset: 0.5, noteConfidence: 0.9, active: 0.9, event: true },
      ])],
    },
  });
  assert.deepEqual(problemsFor(record), []);
  const trial = trialOf(record, "wrong-note");
  assert.equal(trial.outcomes.find((row) => row.profileId === "baseline-v1")!.advanced, true);
  // The candidate is still held to the absolute rule for its own column.
  const failures = listenRoundTwoLiveTrialFailures({
    profileId: "early-open-v2",
    setup: { setupId: record.setups[0].setupId, source: record.setups[0].source },
    trial,
    baseline: trial.outcomes[0],
    candidate: { ...trial.outcomes[1], advanced: true },
  });
  assert.ok(failures.some(({ gate, measure }) => gate === "live-safety" && measure === "advanced"));
});

/* ------------------------------------------------------------------------- *
 * Binding, coverage, and the gates
 * ------------------------------------------------------------------------- */

test("an archive collected against another round is not this round's evidence", () => {
  assert.ok(problemsFor(amended(archive(), (record) => {
    record.eligibilityManifestDigest = "99999999";
  })).some((problem) => /this decision concludes/.test(problem)));
});

test("a corpus cannot add a candidate the automated matrix never cleared", () => {
  assert.ok(problemsFor(archive(), ["early-open-v2"])
    .some((problem) => /does not mark automated-eligible/.test(problem)));
});

test("one acoustic safety failure is not paid for by a digital gain", () => {
  const result = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [archive({ performance: hallucinatedBass("acoustic-upright-room-a") })],
  });
  assert.equal(result.status, "failed");
  const safety = result.gates.find(({ gate }) => gate === "live-safety")!;
  assert.equal(safety.passed, false);
  assert.ok(safety.failures.some((failure) => (
    failure.setupId === "acoustic-upright-room-a" &&
      failure.sourceFamily === "acoustic" &&
      failure.trialId === "acoustic-upright-room-a/omitted-bass" &&
      failure.measure === "falseAdvanceCount" &&
      failure.baselineValue === 0 && failure.profileValue === 1
  )));
  assert.ok(safety.failures.some(({ measure }) => measure === "advanced"));
});

test("a clean candidate passes every live gate over both source families", () => {
  const result = listenRoundTwoLiveResult({ profileId: "early-open-v2", archives: [archive()] });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.gates.map(({ gate }) => gate), [...LISTEN_LIVE_GATE_CODES]);
  assert.deepEqual(result.setupCoverage.map(({ sourceFamily }) => sourceFamily).sort(),
    ["acoustic", "digital"]);
});

test("the repeated-chord gate applies Task 24's frozen boundaries", () => {
  const record = archive();
  const trial = trialOf(record, "repeated-chord");
  const baseline = trial.outcomes.find((row) => row.profileId === "baseline-v1")!;
  const candidate = trial.outcomes.find((row) => row.profileId === "early-open-v2")!;
  // The recovery itself is measured from the performance, not stated.
  assert.equal(baseline.repeatedRecovery?.sourceDistance, 1);
  assert.equal(candidate.repeatedRecovery?.sourceDistance, 0);
  const setup = { setupId: record.setups[0].setupId, source: record.setups[0].source };
  assert.deepEqual(
    listenRoundTwoLiveTrialFailures({ profileId: "early-open-v2", setup, trial, baseline, candidate }),
    [],
  );
  const later = listenRoundTwoLiveTrialFailures({
    profileId: "early-open-v2",
    setup,
    trial,
    baseline,
    candidate: { ...candidate, repeatedRecovery: { sourceDistance: 2, attributionDelayMs: 2_000 } },
  });
  assert.ok(later.some(({ gate, measure }) => (
    gate === "live-repeated-recovery" && measure === "sourceDistance"
  )));
});

test("the latency gate allows one decoder hop and no more", () => {
  const record = archive();
  const trial = trialOf(record, "single-note");
  const baseline = trial.outcomes[0];
  const setup = { setupId: record.setups[0].setupId, source: record.setups[0].source };
  const at = (latencyMs: number) => listenRoundTwoLiveTrialFailures({
    profileId: "early-open-v2",
    setup,
    trial,
    baseline,
    candidate: { ...trial.outcomes[1], latencyMs },
  });
  assert.deepEqual(at((baseline.latencyMs ?? 0) + 32), []);
  assert.ok(at((baseline.latencyMs ?? 0) + 33)
    .some(({ gate }) => gate === "live-latency"));
});

test("coverage is required per setup, and a missing class fails closed", () => {
  const acousticOnly = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [archive({
      setups: [{ setupId: "acoustic-upright-room-a", source: "acoustic-piano" }],
    })],
  });
  assert.equal(acousticOnly.status, "failed");
  assert.ok(acousticOnly.gates.find(({ gate }) => gate === "live-coverage")!.failures
    .some(({ measure }) => measure === "digital-setup-count"));

  const withoutOmittedBass = listenRoundTwoLiveResult({
    profileId: "early-open-v2",
    archives: [archive({
      trialClasses: LISTEN_LIVE_REQUIRED_TRIAL_CLASSES
        .filter((trialClass) => trialClass !== "omitted-bass"),
    })],
  });
  assert.ok(withoutOmittedBass.gates.find(({ gate }) => gate === "live-coverage")!.failures
    .some(({ measure }) => measure === "omitted-bass-trial-count"));
});

test("a candidate no session replayed is not-collected rather than passed", () => {
  const result = listenRoundTwoLiveResult({ profileId: "early-held-v2", archives: [archive()] });
  assert.equal(result.status, "not-collected");
  assert.deepEqual([...result.setupCoverage], []);
});

test("every automated-eligible candidate gets a row, derived from the manifest", () => {
  const { results, problems } = listenRoundTwoLiveResults({
    eligibility: completedEligibility([
      ...CANDIDATES.map((profileId) => ({ profileId, automatedEligible: true })),
      { profileId: "early-held-v2", automatedEligible: true },
    ]),
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    archives: [archive()],
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(results.map(({ profileId, status }) => [profileId, status]), [
    ["early-open-v2", "passed"],
    ["steady-open-v2", "passed"],
    ["early-held-v2", "not-collected"],
  ]);
});

test("a live corpus for a round that confirmed nothing is refused", () => {
  const { problems } = listenRoundTwoLiveResults({
    eligibility: {
      runStatus: "not-run-no-confirmable-candidate",
      entries: [],
      digest: { algorithm: "fnv1a-32-canonical-json", value: ELIGIBILITY_DIGEST },
    } as unknown as ListenRoundTwoEligibilityManifest,
    eligibilityManifestDigest: ELIGIBILITY_DIGEST,
    archives: [archive()],
  });
  assert.ok(problems.some((problem) => /holds no automated-eligible candidate/.test(problem)));
});
