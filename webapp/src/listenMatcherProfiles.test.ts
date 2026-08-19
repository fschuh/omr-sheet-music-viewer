import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  FIXED_LISTEN_MATCHER_POLICY,
  findListenMatcherProfile,
  getListenMatcherProfile,
  isListenMatcherProfile,
  isListenMatcherProfileId,
  LISTEN_MATCHER_PROFILE_IDS,
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_REGISTRY_VERSION,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherProfile,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";

test("registers the first-generation profiles and the frozen multi-domain candidates", () => {
  assert.deepEqual(LISTEN_MATCHER_PROFILE_IDS, [
    "baseline-v1",
    "balanced-v1",
    "sensitive-v1",
    "early-open-v2",
    "steady-open-v2",
    "early-held-v2",
    "steady-held-v2",
  ]);
  assert.deepEqual(Object.keys(LISTEN_MATCHER_PROFILES), [...LISTEN_MATCHER_PROFILE_IDS]);
  assert.equal(LISTEN_MATCHER_REGISTRY_VERSION, 2);
  assert.deepEqual(LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS, [
    "early-open-v2",
    "steady-open-v2",
    "early-held-v2",
    "steady-held-v2",
  ]);
  // The candidate list is a subset of the registry and never contains the
  // default, which is compared against the candidates rather than being one.
  assert.ok(LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS.every((id) => (
    LISTEN_MATCHER_PROFILE_IDS.includes(id)
  )));
  assert.ok(!LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS.includes(DEFAULT_LISTEN_MATCHER_PROFILE_ID));
  assert.equal(
    new Set(LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS).size,
    LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS.length,
  );
  assert.ok(Object.isFrozen(LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS));
});

/**
 * The multi-domain search ranked one profile with exactly `sensitive-v1`'s
 * values first. It is registered separately anyway: the two entries were chosen
 * from different corpora under different rules, and a later edit to one
 * generation must not silently move the other.
 */
test("keeps the two generations independent where their values coincide", () => {
  const first = LISTEN_MATCHER_PROFILES["sensitive-v1"];
  const second = LISTEN_MATCHER_PROFILES["early-open-v2"];
  assert.notEqual(first, second);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(
    { ...matcherOptionsForListenMatcherProfile("sensitive-v1") },
    { ...matcherOptionsForListenMatcherProfile("early-open-v2") },
  );
});

test("encodes the planned profile values with a required fresh bass onset", () => {
  assert.deepEqual(LISTEN_MATCHER_PROFILES["baseline-v1"], {
    id: "baseline-v1",
    onsetThreshold: 0.6,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    extraNoteThreshold: 0.97,
    requireFreshBassOnset: true,
  });
  assert.deepEqual(LISTEN_MATCHER_PROFILES["balanced-v1"], {
    id: "balanced-v1",
    onsetThreshold: 0.5,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  });
  assert.deepEqual(LISTEN_MATCHER_PROFILES["sensitive-v1"], {
    id: "sensitive-v1",
    onsetThreshold: 0.45,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.2,
    extraNoteThreshold: 0.99,
    requireFreshBassOnset: true,
  });
});

test("encodes the measured multi-domain candidate values", () => {
  assert.deepEqual(
    LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS.map((id) => LISTEN_MATCHER_PROFILES[id]),
    [
      {
        id: "early-open-v2",
        onsetThreshold: 0.45,
        targetNoteThreshold: 0.5,
        activeTargetThreshold: 0.2,
        extraNoteThreshold: 0.99,
        requireFreshBassOnset: true,
      },
      {
        id: "steady-open-v2",
        onsetThreshold: 0.5,
        targetNoteThreshold: 0.5,
        activeTargetThreshold: 0.2,
        extraNoteThreshold: 0.99,
        requireFreshBassOnset: true,
      },
      {
        id: "early-held-v2",
        onsetThreshold: 0.45,
        targetNoteThreshold: 0.5,
        activeTargetThreshold: 0.275,
        extraNoteThreshold: 0.99,
        requireFreshBassOnset: true,
      },
      {
        id: "steady-held-v2",
        onsetThreshold: 0.5,
        targetNoteThreshold: 0.5,
        activeTargetThreshold: 0.275,
        extraNoteThreshold: 0.99,
        requireFreshBassOnset: true,
      },
    ],
  );
});

test("defaults to the current production profile", () => {
  assert.equal(DEFAULT_LISTEN_MATCHER_PROFILE_ID, "baseline-v1");
});

test("keeps the registry immutable", () => {
  const profile = LISTEN_MATCHER_PROFILES["baseline-v1"];
  assert.ok(Object.isFrozen(LISTEN_MATCHER_PROFILES));
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(FIXED_LISTEN_MATCHER_POLICY));
  assert.throws(() => {
    (profile as { onsetThreshold: number }).onsetThreshold = 0.1;
  });
  assert.equal(LISTEN_MATCHER_PROFILES["baseline-v1"].onsetThreshold, 0.6);
});

test("looks up profiles by identifier and falls back to the default", () => {
  assert.equal(getListenMatcherProfile("sensitive-v1"), LISTEN_MATCHER_PROFILES["sensitive-v1"]);
  assert.equal(findListenMatcherProfile("nope-v9"), undefined);
  assert.equal(findListenMatcherProfile(undefined), undefined);
  assert.equal(getListenMatcherProfile("nope-v9"), LISTEN_MATCHER_PROFILES["baseline-v1"]);
  assert.equal(getListenMatcherProfile(null), LISTEN_MATCHER_PROFILES["baseline-v1"]);
  assert.ok(isListenMatcherProfileId("balanced-v1"));
  assert.ok(!isListenMatcherProfileId("balanced"));
  assert.ok(!isListenMatcherProfileId(0.5));
});

test("rejects profiles whose values are not finite numbers within 0-1", () => {
  const base = LISTEN_MATCHER_PROFILES["baseline-v1"];
  assert.ok(isListenMatcherProfile(base));
  const invalid: unknown[] = [
    null,
    "baseline-v1",
    { ...base, id: "made-up-v1" },
    { ...base, onsetThreshold: 1.2 },
    { ...base, targetNoteThreshold: -0.01 },
    { ...base, activeTargetThreshold: Number.NaN },
    { ...base, extraNoteThreshold: Number.POSITIVE_INFINITY },
    { ...base, extraNoteThreshold: "0.97" },
    { ...base, requireFreshBassOnset: false },
  ];
  for (const value of invalid) {
    assert.ok(!isListenMatcherProfile(value), JSON.stringify(value));
  }
});

test("converts a profile into complete matcher options", () => {
  assert.deepEqual(matcherOptionsForListenMatcherProfile("baseline-v1"), {
    onsetThreshold: 0.6,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    noteThreshold: 0.97,
    requireFreshBassOnset: true,
    preTargetExtraLookbackMs: 30,
    collectionWindowMs: 400,
    settleMs: 32,
    duplicateOnsetMs: 120,
    wrongAttemptResetMs: 180,
    refractoryMs: 180,
    refractoryMode: "noteEvents",
  });
  assert.deepEqual(matcherOptionsForListenMatcherProfile(), {
    ...matcherOptionsForListenMatcherProfile("baseline-v1"),
  });
  assert.deepEqual(matcherOptionsForListenMatcherProfile(LISTEN_MATCHER_PROFILES["sensitive-v1"]), {
    ...matcherOptionsForListenMatcherProfile("baseline-v1"),
    onsetThreshold: 0.45,
    activeTargetThreshold: 0.2,
    noteThreshold: 0.99,
  });
});

test("changes only confidence interpretation between profiles", () => {
  const fixedKeys = Object.keys(FIXED_LISTEN_MATCHER_POLICY) as (
    keyof typeof FIXED_LISTEN_MATCHER_POLICY
  )[];
  for (const id of LISTEN_MATCHER_PROFILE_IDS) {
    const options = matcherOptionsForListenMatcherProfile(id);
    assert.equal(options.requireFreshBassOnset, true);
    for (const key of fixedKeys) {
      assert.equal(options[key], FIXED_LISTEN_MATCHER_POLICY[key], `${id}.${key}`);
    }
  }
});

test("rejects a structurally invalid profile object at conversion time", () => {
  const invalid = {
    ...LISTEN_MATCHER_PROFILES["baseline-v1"],
    onsetThreshold: 2,
  } as unknown as ListenMatcherProfile;
  assert.throws(() => matcherOptionsForListenMatcherProfile(invalid), /Invalid listen matcher profile/);
});

test("conversion refuses an unknown profile identifier instead of silently defaulting", () => {
  // A misspelled candidate must fail the replay rather than quietly become a
  // second measurement of the production default.
  assert.throws(
    () => matcherOptionsForListenMatcherProfile("early-open-v3" as ListenMatcherProfileId),
    /Unknown listen matcher profile identifier/,
  );
  assert.deepEqual(
    matcherOptionsForListenMatcherProfile("early-open-v2"),
    matcherOptionsForListenMatcherProfile(LISTEN_MATCHER_PROFILES["early-open-v2"]),
  );
});
