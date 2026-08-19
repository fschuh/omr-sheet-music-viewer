import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTEN_SAFETY_REGRESSION_FIXTURES,
  assertFocusedCaseMatchesRegressions,
  diagnoseListenSequenceSafety,
  listenSafetyRegressionSequence,
  listenSafetyRegressionTrace,
  listenSafetyRegressionsIntroduced,
  replayListenSafetyRegressions,
  summarizeListenSafetyRegressions,
  verifyFocusedCaseAgainstRegressions,
  type ListenAdvanceForensics,
  type ListenAdvanceSafetyClassification,
  type ListenSafetyRegressionFixture,
} from "./listenSafetyRegression";
import {
  TONE_COURSE_CLEAR_333_SHARED_PITCH_FALSE_ADVANCE,
  TONE_SALAMANDER_V05_LATE_ADVANCE,
} from "./listenSafetyRegressionFixtures";
import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  materializeListenSequence,
  replayListenSequenceTrace,
  type ListenSequenceDefinition,
  type ListenSequenceRunResult,
} from "./listenSequenceBenchmark";
import { listenRecognitionTraceHash } from "./listenBaselineParity";

const V05 = TONE_SALAMANDER_V05_LATE_ADVANCE;
const SHARED_PITCH = TONE_COURSE_CLEAR_333_SHARED_PITCH_FALSE_ADVANCE;

function replay(fixture: ListenSafetyRegressionFixture, profileId: ListenMatcherProfileId) {
  return replayListenSequenceTrace(
    listenSafetyRegressionSequence(fixture),
    listenSafetyRegressionTrace(fixture),
    "current-matcher",
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
  );
}

test("the v05 fixture keeps the measured schedule and decoded frames", () => {
  assert.equal(V05.origin.renderer, "bundled-piano-tone-v2");
  assert.equal(V05.origin.piano, "salamander");
  assert.equal(V05.origin.layer, "v05");
  assert.equal(V05.origin.sourceSequenceId, "course-clear-articulation-normal");
  assert.equal(V05.origin.sourceTargetIndex, 23);
  // Course Clear repeats measure 3 moments 8-10, preceded by moment 7.
  assert.deepEqual(V05.definition.targets, [
    [65, 74, 82], [62, 74, 82], [62, 74, 82], [62, 74, 82],
  ]);
  assert.deepEqual(V05.definition.attacks.map(({ at }) => at), [22, 23, 24, 25]);
  const sequence = listenSafetyRegressionSequence(V05);
  assert.deepEqual(
    sequence.attacks.map(({ scheduledAtMs }) => scheduledAtMs),
    [22_220, 23_220, 24_220, 25_220],
  );
  // No PCM, no model scores: the fixture is decoder output only.
  const trace = listenSafetyRegressionTrace(V05);
  assert.equal(trace.pcm.length, 0);
  assert.ok(trace.frames.every(({ modelScores }) => modelScores.length === 0));
  assert.equal(trace.frames.length, V05.frames.length);
  assert.equal(trace.frames[0].capturedAtMs, 22_112);
  assert.equal(trace.frames.at(-1)?.capturedAtMs, 25_600);
});

test("the v05 fixture reproduces the measured advancement under baseline-v1", () => {
  const { run, forensics } = diagnoseListenSequenceSafety(
    listenSafetyRegressionSequence(V05),
    listenSafetyRegressionTrace(V05),
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );
  const event = run.events[V05.targetIndex];
  assert.equal(event.advanced, true);
  assert.equal(event.advancedAtMs, 25_440);
  assert.equal(event.orderedAdvanced, false);
  assert.equal(event.lateAdvance, true);
  assert.equal(event.falseAdvance, false);
  assert.equal(event.skipped, false);
  assert.equal(event.duplicate, false);
  assert.equal(event.primaryFailure, "late-advance");
  // The fixture pins the exact advancement, not merely its category.
  assert.deepEqual(V05.pinnedAdvance, { advancedAtMs: 25_440, sourceAttackIndex: 3 });
  assert.equal(V05.origin.sourceAdvancedAtMs, 25_440);
  assert.equal(V05.origin.sourceAttackIndex, 25);
  assert.equal(run.summary.lateAdvanceCount, 1);
  assert.equal(run.summary.falseAdvanceCount, 0);
  assert.equal(run.summary.skippedAdvanceCount, 0);
  assert.equal(run.summary.duplicateAdvanceCount, 0);

  assert.equal(forensics.length, 1);
  const [forensic] = forensics;
  assert.deepEqual(forensic.classification, ["late-advance"]);
  assert.equal(forensic.targetIndex, V05.targetIndex);
  assert.equal(forensic.advancedAtMs, 25_440);
  // The advance was credited to the third repetition, 2220 ms after this
  // target's own attack and far outside the attribution window.
  assert.equal(forensic.attributionDelayMs, 2_220);
  assert.ok(forensic.attributionDelayMs > forensic.attributionWindowMs);
  assert.equal(forensic.sourceAttackIndex, 3);
  assert.deepEqual(forensic.sourceAttackPlayedPitches, [62, 74, 82]);
  // The matcher accepted exactly the target's own pitches, with nothing extra,
  // which is what makes this a lag rather than a wrong advance.
  assert.deepEqual(forensic.detectedTargetPitches, [62, 74, 82]);
  assert.deepEqual(forensic.extraPitches, []);
  assert.equal(forensic.playedPitchesMatchTarget, true);
  // D5 and A#5 were still sounding from the preceding moment when this target
  // was armed, so the decoder had to produce fresh attacks for them.
  assert.deepEqual(forensic.carryOverPitchesAtTargetStart, [65, 70, 74, 82]);
});

test("replaying the v05 fixture leaves the committed frames untouched", () => {
  const trace = listenSafetyRegressionTrace(V05);
  const before = listenRecognitionTraceHash(trace);
  for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
    replayListenSequenceTrace(
      listenSafetyRegressionSequence(V05),
      trace,
      "current-matcher",
      listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
    );
  }
  assert.equal(listenRecognitionTraceHash(trace), before);
});

test("every named profile is replayed against every committed regression", () => {
  const summary = summarizeListenSafetyRegressions();
  assert.equal(summary.fixtureCount, LISTEN_SAFETY_REGRESSION_FIXTURES.length);
  assert.ok(summary.fixtureCount > 0);
  assert.equal(
    summary.outcomes.length,
    LISTEN_SAFETY_REGRESSION_FIXTURES.length * LISTEN_MATCHER_PROFILE_IDS.length,
  );
  for (const fixture of LISTEN_SAFETY_REGRESSION_FIXTURES) {
    for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
      const outcome = summary.outcomes.find((candidate) => (
        candidate.fixtureId === fixture.id && candidate.profileId === profileId
      ));
      assert.ok(outcome, `${fixture.id} was not replayed with ${profileId}`);
      // Deviating from the pinned advancement is reported; only becoming less
      // safe than the profile the case was measured with is a failure.
      assert.equal(outcome.worseThanBaseline, false, `${fixture.id} under ${profileId}`);
      assert.deepEqual(outcome.newlyUnsafeTargets, [], `${fixture.id} under ${profileId}`);
    }
  }
  // The fixture was cut from a baseline-v1 run, so baseline-v1 must still land on it.
  for (const outcome of summary.outcomes.filter(({ profileId }) => profileId === "baseline-v1")) {
    assert.deepEqual(outcome.deviations, [], outcome.fixtureId);
    assert.equal(outcome.satisfied, true);
  }
  // One committed fixture pins a genuine false advance, so the raw total is
  // nonzero by design. Only `worseThanBaselineCount` says a profile regressed.
  assert.equal(summary.falseAdvanceCount, 1);
  assert.equal(summary.skippedAdvanceCount, 0);
  assert.equal(summary.duplicateAdvanceCount, 0);
  assert.equal(summary.worseThanBaselineCount, 0);
  assert.equal(summary.passed, true);
});

/**
 * Measured behavior of every registered profile on the diagnosed case. Each one
 * whose onset gate sits below 0.5968 completes the chord on the second
 * repetition rather than the third, because D4's onset there clears their gate
 * but not baseline's 0.60. That is a recognition gain, not a safety change, and
 * it is exactly the kind of movement the pinned advancement exists to show.
 */
test("the named profiles recover the v05 case at different repetitions", () => {
  const earlier = { advancedAtMs: 24_448, sourceAttackIndex: 2, deviates: true } as const;
  const expected: Readonly<Record<ListenMatcherProfileId, {
    advancedAtMs: number;
    sourceAttackIndex: number;
    deviates: boolean;
  }>> = {
    "baseline-v1": { advancedAtMs: 25_440, sourceAttackIndex: 3, deviates: false },
    "balanced-v1": earlier,
    "sensitive-v1": earlier,
    "early-open-v2": earlier,
    "steady-open-v2": earlier,
    "early-held-v2": earlier,
    "steady-held-v2": earlier,
  };
  const summary = summarizeListenSafetyRegressions([V05]);
  assert.equal(summary.deviationCount, LISTEN_MATCHER_PROFILE_IDS.length - 1);
  assert.equal(summary.passed, true);
  for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
    const outcome = summary.outcomes.find((candidate) => candidate.profileId === profileId);
    assert.ok(outcome);
    assert.equal(outcome.advancedAtMs, expected[profileId].advancedAtMs, profileId);
    assert.equal(outcome.sourceAttackIndex, expected[profileId].sourceAttackIndex, profileId);
    assert.equal(outcome.satisfied, !expected[profileId].deviates, profileId);
    // Every profile stays a late advance on correct content, and stays safe.
    assert.equal(outcome.lateAdvance, true, profileId);
    assert.equal(outcome.falseAdvance, false, profileId);
    assert.equal(outcome.orderedAdvanced, false, profileId);
    assert.equal(outcome.falseAdvanceCount, 0, profileId);
    assert.equal(outcome.skippedAdvanceCount, 0, profileId);
    assert.equal(outcome.duplicateAdvanceCount, 0, profileId);
  }
});

test("no profile advances the v05 target before it was played", () => {
  for (const profileId of LISTEN_MATCHER_PROFILE_IDS) {
    const run = replay(V05, profileId);
    const event = run.events[V05.targetIndex];
    assert.equal(event.advanced, true, profileId);
    assert.ok(
      (event.advancedAtMs ?? 0) >= event.scheduledAttackTimeMs,
      `${profileId} advanced target ${V05.targetIndex} before it was played`,
    );
  }
});

test("the shared-pitch fixture keeps the measured schedule and decoded frames", () => {
  assert.equal(SHARED_PITCH.origin.renderer, "bundled-piano-tone-v2");
  assert.equal(SHARED_PITCH.origin.piano, "splendid");
  assert.equal(SHARED_PITCH.origin.layer, "mp");
  assert.equal(SHARED_PITCH.origin.sourceSequenceId, "course-clear-27");
  assert.equal(SHARED_PITCH.origin.sourceTargetIndex, 8);
  // Course Clear moments 8-14: the moment before the stalled single note,
  // through the chord whose shared 56 completed it.
  assert.deepEqual(SHARED_PITCH.definition.targets, [
    [60, 67, 76], [56], [51, 60], [56, 63], [48, 60, 68], [51, 63, 72], [56, 68, 75],
  ]);
  assert.deepEqual(SHARED_PITCH.definition.attacks.map(({ at }) => at), [7, 8, 9, 10, 11, 12, 13]);
  const trace = listenSafetyRegressionTrace(SHARED_PITCH);
  assert.equal(trace.pcm.length, 0);
  assert.ok(trace.frames.every(({ modelScores }) => modelScores.length === 0));
  assert.equal(trace.frames.length, SHARED_PITCH.frames.length);
  assert.equal(trace.frames[0].capturedAtMs, 2_432);
  assert.equal(trace.frames.at(-1)?.capturedAtMs, 4_928);
});

test("the shared-pitch fixture reproduces the measured false advance under baseline-v1", () => {
  const { run, forensics } = diagnoseListenSequenceSafety(
    listenSafetyRegressionSequence(SHARED_PITCH),
    listenSafetyRegressionTrace(SHARED_PITCH),
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );
  const event = run.events[SHARED_PITCH.targetIndex];
  assert.equal(event.advanced, true);
  assert.equal(event.advancedAtMs, 4_768);
  assert.equal(event.orderedAdvanced, false);
  assert.equal(event.falseAdvance, true);
  assert.equal(event.lateAdvance, false);
  assert.equal(event.skipped, false);
  assert.equal(event.duplicate, false);
  assert.deepEqual(SHARED_PITCH.pinnedAdvance, { advancedAtMs: 4_768, sourceAttackIndex: 6 });
  assert.equal(SHARED_PITCH.origin.sourceAdvancedAtMs, 4_768);
  assert.equal(SHARED_PITCH.origin.sourceAttackIndex, 13);
  assert.equal(run.summary.falseAdvanceCount, 1);
  assert.equal(run.summary.lateAdvanceCount, 0);
  assert.equal(run.summary.skippedAdvanceCount, 0);
  assert.equal(run.summary.duplicateAdvanceCount, 0);

  assert.equal(forensics.length, 1);
  const [forensic] = forensics;
  assert.deepEqual(forensic.classification, ["false-advance"]);
  assert.equal(forensic.targetIndex, SHARED_PITCH.targetIndex);
  assert.equal(forensic.advancedAtMs, 4_768);
  // 1881 ms after this target's own attack, far outside the attribution window,
  // so the advance is credited to the chord that was actually sounding.
  assert.equal(Math.round(forensic.attributionDelayMs), 1_881);
  assert.ok(forensic.attributionDelayMs > forensic.attributionWindowMs);
  assert.equal(forensic.sourceAttackIndex, 6);
  assert.deepEqual(forensic.soundingAttackIndices, [6]);
  // The causing attack played a different chord, which is what separates this
  // from a late advance: only its shared pitch reached the matcher.
  assert.deepEqual(forensic.sourceAttackPlayedPitches, [56, 68, 75]);
  assert.deepEqual(forensic.detectedTargetPitches, [56]);
  assert.deepEqual(forensic.extraPitches, []);
  assert.deepEqual(forensic.carryOverPitchesAtTargetStart, [60, 67, 76]);
});

/**
 * The decoded evidence behind the diagnosis. The target's own attack produced an
 * onset below `baseline-v1`'s gate; the first later chord containing 56 also
 * contained a confidently unexpected 63 and was refused; the chord that did
 * advance it contributed no second fresh onset at all, because 68 was already
 * sounding and 75 — the weak upper note of this Tone fixture — never onset.
 */
test("the shared-pitch fixture stores the evidence its diagnosis rests on", () => {
  const onsetAt = (capturedAtMs: number) => SHARED_PITCH.frames
    .find((frame) => frame.capturedAtMs === capturedAtMs)
    ?.onsets.map(({ midi, confidence }) => [midi, Number(confidence.toFixed(3))]);
  assert.deepEqual(onsetAt(3_040), [[56, 0.531]]);
  assert.deepEqual(onsetAt(3_712), [[56, 0.975], [63, 0.983]]);
  assert.deepEqual(onsetAt(4_736), [[56, 0.995]]);
  const advancingFrame = SHARED_PITCH.frames.find(({ capturedAtMs }) => capturedAtMs === 4_736);
  assert.ok(advancingFrame);
  // 68 is active without a fresh onset, so the extra-note gate never sees it.
  assert.ok(advancingFrame.activePitches.some(({ midi }) => midi === 68));
  assert.ok(!advancingFrame.onsets.some(({ midi }) => midi === 68));
  assert.ok(!advancingFrame.activePitches.some(({ midi }) => midi === 75));
});

/**
 * Every candidate profile — both first-generation ones and all four frozen
 * multi-domain ones — accepts the 0.531 onset the target's own attack produced,
 * so the stall that led to the false advance never starts and the passage
 * advances in order instead. This is why the multi-domain search reports the
 * diagnosed Tone false advance as removed rather than moved, and it is visible
 * only because the advancement is pinned.
 */
test("the more sensitive profiles never enter the shared-pitch stall", () => {
  const summary = summarizeListenSafetyRegressions([SHARED_PITCH]);
  assert.equal(summary.worseThanBaselineCount, 0);
  assert.equal(summary.passed, true);
  assert.equal(summary.deviationCount, LISTEN_MATCHER_PROFILE_IDS.length - 1);
  const outcomeFor = (profileId: ListenMatcherProfileId) => {
    const outcome = summary.outcomes.find((candidate) => candidate.profileId === profileId);
    assert.ok(outcome, profileId);
    return outcome;
  };
  const baseline = outcomeFor("baseline-v1");
  assert.equal(baseline.advancedAtMs, 4_768);
  assert.equal(baseline.sourceAttackIndex, 6);
  assert.equal(baseline.falseAdvance, true);
  assert.equal(baseline.satisfied, true);
  const candidates = LISTEN_MATCHER_PROFILE_IDS.filter((id) => id !== "baseline-v1");
  for (const profileId of candidates) {
    const outcome = outcomeFor(profileId);
    assert.equal(outcome.advancedAtMs, 3_072, profileId);
    assert.equal(outcome.sourceAttackIndex, 1, profileId);
    assert.equal(outcome.orderedAdvanced, true, profileId);
    assert.equal(outcome.falseAdvance, false, profileId);
    assert.equal(outcome.falseAdvanceCount, 0, profileId);
    assert.equal(outcome.satisfied, false, profileId);
    assert.equal(outcome.worseThanBaseline, false, profileId);
  }
  // Six ordered advances instead of one, from the same decoded frames.
  for (const profileId of candidates) {
    assert.equal(replay(SHARED_PITCH, profileId).summary.orderedAdvanceCount, 6, profileId);
  }
  assert.equal(replay(SHARED_PITCH, "baseline-v1").summary.orderedAdvanceCount, 1);
});

/**
 * A safety failure that moves is still a safety failure. Comparing totals would
 * let a profile that fixes the pinned target and breaks a different one look
 * unchanged, because one false advance replaces another, so the comparison is
 * per target.
 */
test("a safety event relocated to another target is still rejected", () => {
  // Only the fields the comparison reads; a full replay cannot produce equal
  // totals at different targets from any committed fixture, which is precisely
  // why the case needs stating directly.
  const run = (
    classified: Partial<Record<number, ListenAdvanceSafetyClassification[]>>,
  ) => ({
    events: [0, 1, 2].map((index) => ({
      index,
      falseAdvance: classified[index]?.includes("false-advance") ?? false,
      skipped: classified[index]?.includes("skipped-advance") ?? false,
      duplicate: classified[index]?.includes("duplicate-advance") ?? false,
      lateAdvance: classified[index]?.includes("late-advance") ?? false,
    })),
  } as ListenSequenceRunResult);

  const baseline = run({ 1: ["false-advance"] });
  // Identical totals, different target.
  assert.deepEqual(
    listenSafetyRegressionsIntroduced(run({ 2: ["false-advance"] }), baseline),
    [{ targetIndex: 2, classifications: ["false-advance"] }],
  );
  // Same target, a kind of failure baseline did not have there.
  assert.deepEqual(
    listenSafetyRegressionsIntroduced(
      run({ 1: ["false-advance", "duplicate-advance"] }),
      baseline,
    ),
    [{ targetIndex: 1, classifications: ["duplicate-advance"] }],
  );
  // Reproducing the baseline event, and losing it entirely, both stay allowed.
  assert.deepEqual(listenSafetyRegressionsIntroduced(baseline, baseline), []);
  assert.deepEqual(listenSafetyRegressionsIntroduced(run({}), baseline), []);
  // A late advance is a lag diagnostic, not a safety event, so it never counts.
  assert.deepEqual(listenSafetyRegressionsIntroduced(run({ 0: ["late-advance"] }), run({})), []);
});

/**
 * The late-advance classification exists only for an attack that played exactly
 * the advanced target's chord. An advance whose causing attack played something
 * else must still be a false advance, or the safety gate would be meaningless.
 */
test("an advance caused by an attack that played a different chord stays false", () => {
  const definition: ListenSequenceDefinition = {
    id: "wrong-chord-advance",
    family: "safety-regression-test",
    label: "Advance caused by a different chord",
    targets: [[60, 64, 67], [62, 65, 69]],
    attacks: [
      { at: 0, targetIndex: 0, notes: [60, 64, 67], expectedAdvance: true },
      { at: 1, targetIndex: 1, notes: [62, 65, 69], expectedAdvance: true },
    ],
  };
  const sequence = materializeListenSequence(definition, 1_000);
  // Target 0's own chord arrives only after the second attack has been played,
  // so the advance is caused by an attack that played a different chord.
  const onsetAtMs = sequence.attacks[1].scheduledAtMs + 160;
  const pitches = [60, 64, 67];
  const frames = [0, 32, 64, 96].map((offset) => ({
    capturedAtMs: onsetAtMs + offset,
    signalActive: true,
    onsets: offset === 0 ? pitches.map((midi) => ({
      midi,
      confidence: 0.99,
      noteConfidence: 0.99,
      onsetTimeMs: onsetAtMs,
    })) : [],
    noteEvents: offset === 0 ? pitches.map((midi) => ({
      midi,
      type: "onset" as const,
      confidence: 0.99,
      eventTimeMs: onsetAtMs,
    })) : [],
    activePitches: pitches.map((midi) => ({ midi, confidence: 0.99 })),
    confidenceEvidence: pitches.map((midi) => ({ midi, confidence: 0.99 })),
  }));
  const fixture: ListenSafetyRegressionFixture = {
    ...V05,
    id: definition.id,
    label: definition.label,
    definition,
    targetIndex: 0,
    expectation: "reported-unsafe-advance",
    relevantPitches: [60, 62, 64, 65, 67, 69],
    frames,
  };
  const run = replayListenSequenceTrace(
    sequence,
    listenSafetyRegressionTrace(fixture),
    "current-matcher",
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );
  assert.equal(run.events[0].advanced, true);
  assert.equal(run.events[0].falseAdvance, true);
  assert.equal(run.events[0].lateAdvance, false);
  assert.equal(run.summary.falseAdvanceCount, 1);
  assert.equal(run.summary.lateAdvanceCount, 0);
});

/**
 * A repeated chord gives several attacks that could each legitimately complete
 * the same target, so "still a late advance" is not a strong enough pin. Moving
 * the advancement to an earlier repetition must be reported as a deviation even
 * though nothing about it is unsafe.
 */
test("an earlier but still late advance is reported as a deviation", () => {
  const chord = [60, 64, 67];
  const definition: ListenSequenceDefinition = {
    id: "repeated-chord-earlier-advance",
    family: "safety-regression-test",
    label: "Same chord recognized one repetition earlier",
    targets: [chord, chord, chord],
    attacks: [0, 1, 2].map((at) => ({
      at,
      targetIndex: at,
      notes: chord,
      expectedAdvance: true,
    })),
  };
  const sequence = materializeListenSequence(definition, 1_000);
  // Evidence arrives only on the second attack, so target 0 advances from it.
  const onsetAtMs = sequence.attacks[1].scheduledAtMs + 160;
  const frames = [0, 32, 64, 96].map((offset) => ({
    capturedAtMs: onsetAtMs + offset,
    signalActive: true,
    onsets: offset === 0
      ? chord.map((midi) => ({
          midi,
          confidence: 0.99,
          noteConfidence: 0.99,
          onsetTimeMs: onsetAtMs,
        }))
      : [],
    noteEvents: offset === 0
      ? chord.map((midi) => ({
          midi,
          type: "onset" as const,
          confidence: 0.99,
          eventTimeMs: onsetAtMs,
        }))
      : [],
    activePitches: chord.map((midi) => ({ midi, confidence: 0.99 })),
    confidenceEvidence: chord.map((midi) => ({ midi, confidence: 0.99 })),
  }));
  const base: ListenSafetyRegressionFixture = {
    ...V05,
    id: definition.id,
    label: definition.label,
    definition,
    targetIndex: 0,
    expectation: "late-advance",
    relevantPitches: chord,
    frames,
  };

  const asObserved = replayListenSafetyRegressions(
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
    "baseline-v1",
    [{ ...base, pinnedAdvance: { advancedAtMs: onsetAtMs + 32, sourceAttackIndex: 1 } }],
  );
  assert.equal(asObserved.outcomes[0].advanced, true);
  assert.equal(asObserved.outcomes[0].lateAdvance, true);
  assert.equal(asObserved.outcomes[0].sourceAttackIndex, 1);
  assert.equal(asObserved.outcomes[0].advancedAtMs, onsetAtMs + 32);
  assert.deepEqual(asObserved.outcomes[0].deviations, []);
  assert.equal(asObserved.outcomes[0].satisfied, true);

  // Same run, but pinned to the third repetition the way the v05 case is.
  const pinnedLater = replayListenSafetyRegressions(
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
    "baseline-v1",
    [{ ...base, pinnedAdvance: { advancedAtMs: onsetAtMs + 1_032, sourceAttackIndex: 2 } }],
  );
  const outcome = pinnedLater.outcomes[0];
  assert.equal(outcome.lateAdvance, true, "still a late advance");
  assert.equal(outcome.falseAdvance, false, "and still not unsafe");
  assert.equal(outcome.worseThanBaseline, false);
  assert.equal(outcome.satisfied, false, "but no longer the pinned advancement");
  assert.equal(outcome.deviations.length, 2);
  assert.ok(outcome.deviations.some((reason) => reason.includes("advanced at")));
  assert.ok(outcome.deviations.some((reason) => reason.includes("credited to attack")));
  assert.equal(pinnedLater.deviationCount, 1);
  assert.equal(pinnedLater.passed, true, "a deviation is not by itself a safety failure");
});

function v05Identity(update: Partial<ListenAdvanceForensics> = {}) {
  const { forensics } = diagnoseListenSequenceSafety(
    listenSafetyRegressionSequence(V05),
    listenSafetyRegressionTrace(V05),
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES["baseline-v1"]),
  );
  // The fixture replays on fixture-local indices; the committed origin records
  // the original run's numbering, so restate the forensic record in those terms.
  return {
    renderer: V05.origin.renderer,
    piano: V05.origin.piano,
    layer: V05.origin.layer,
    sequenceId: V05.origin.sourceSequenceId,
    intervalMs: V05.origin.sourceIntervalMs,
    recognitionStructureHash: V05.origin.sourceRecognitionStructureHash,
    forensics: [{
      ...forensics[0],
      targetIndex: V05.origin.sourceTargetIndex,
      sourceAttackIndex: V05.origin.sourceAttackIndex,
      ...update,
    }],
  };
}

test("a focused rerun of a committed case must still reproduce it", () => {
  const verifications = assertFocusedCaseMatchesRegressions(v05Identity());
  assert.equal(verifications.length, 1);
  assert.equal(verifications[0].fixtureId, V05.id);
  assert.deepEqual(verifications[0].differences, []);

  // A run of a different layer is simply not this case, and is not checked.
  assert.deepEqual(
    verifyFocusedCaseAgainstRegressions({ ...v05Identity(), layer: "v06" }),
    [],
  );
  // Neither is the same passage rendered at a different speed.
  assert.deepEqual(
    verifyFocusedCaseAgainstRegressions({ ...v05Identity(), intervalMs: 500 }),
    [],
  );
});

test("a focused rerun fails when the case stops reproducing", () => {
  const changedDecoding = { ...v05Identity(), recognitionStructureHash: "deadbeef" };
  assert.equal(verifyFocusedCaseAgainstRegressions(changedDecoding)[0].differences.length, 1);
  assert.throws(
    () => assertFocusedCaseMatchesRegressions(changedDecoding),
    /decoded structure hash deadbeef/,
  );

  const noEvent = { ...v05Identity(), forensics: [] };
  assert.throws(
    () => assertFocusedCaseMatchesRegressions(noEvent),
    /no advancement was counted against a safety gate at target 23/,
  );

  assert.throws(
    () => assertFocusedCaseMatchesRegressions(v05Identity({ advancedAtMs: 24_440 })),
    /advanced at 24440 ms, expected 25440 ms/,
  );

  assert.throws(
    () => assertFocusedCaseMatchesRegressions(v05Identity({ sourceAttackIndex: 24 })),
    /credited to attack 24, expected 25/,
  );

  assert.throws(
    () => assertFocusedCaseMatchesRegressions(v05Identity({ classification: ["false-advance"] })),
    /is now false-advance, expected late-advance/,
  );
});
