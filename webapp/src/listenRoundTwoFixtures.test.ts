import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import {
  LISTEN_ROUND_TWO_FIXTURE_GROUPS,
  LISTEN_ROUND_TWO_FIXTURE_ROLES,
  assertValidListenRoundTwoFixtureGroups,
  findListenRoundTwoFixtureMember,
  validateListenRoundTwoFixtureGroups,
  type ListenRoundTwoFixtureGroup,
  type ListenRoundTwoFixtureMember,
} from "./listenRoundTwoFixtures";

function replaceGroup(
  index: number,
  changes: Partial<ListenRoundTwoFixtureGroup>,
): ListenRoundTwoFixtureGroup[] {
  return LISTEN_ROUND_TWO_FIXTURE_GROUPS.map((group, candidateIndex) => (
    candidateIndex === index ? { ...group, ...changes } : group
  ));
}

function replaceMember(
  group: ListenRoundTwoFixtureGroup,
  index: number,
  changes: Partial<ListenRoundTwoFixtureMember>,
): ListenRoundTwoFixtureMember[] {
  return group.members.map((member, candidateIndex) => (
    candidateIndex === index ? { ...member, ...changes } : member
  ));
}

test("authors eight complete paired groups across both frozen partitions", () => {
  assert.equal(LISTEN_ROUND_TWO_FIXTURE_GROUPS.length, 8);
  assert.deepEqual(validateListenRoundTwoFixtureGroups(), []);
  assert.doesNotThrow(() => assertValidListenRoundTwoFixtureGroups());
  for (const partition of ["discovery", "confirmation"] as const) {
    const groups = LISTEN_ROUND_TWO_FIXTURE_GROUPS.filter((group) => (
      group.partition === partition
    ));
    assert.equal(groups.length, 4);
    assert.equal(groups.filter(({ repeatedIdenticalChord }) => repeatedIdenticalChord).length, 2);
    for (const group of groups) {
      assert.deepEqual(group.members.map(({ role }) => role), LISTEN_ROUND_TWO_FIXTURE_ROLES);
      assert.ok(group.requiredAssetUrls.length > 0, group.id);
      for (const asset of group.requiredAssetUrls) assert.match(asset, /^\/audio\/.+\.ogg$/);
    }
  }
});

test("spans the predeclared acoustic and musical dimensions", () => {
  const values = <K extends keyof (typeof LISTEN_ROUND_TWO_FIXTURE_GROUPS)[number]>(key: K) => (
    new Set(LISTEN_ROUND_TWO_FIXTURE_GROUPS.map((group) => group[key]))
  );
  assert.deepEqual([...values("rendererKey")].sort(), ["direct", "tone"]);
  assert.deepEqual([...values("piano")].sort(), ["salamander", "splendid"]);
  assert.deepEqual([...values("register")].sort(), ["high", "low", "middle"]);
  assert.deepEqual([...values("chordSize")].sort(), [3, 4]);
  assert.deepEqual([...values("articulation")].sort(), [
    "detached",
    "legato",
    "normal",
    "sustained-shared",
  ]);
  assert.ok(values("layer").size >= 6, "dynamic/sample-layer breadth");
});

test("repeated correct cases carry upper voices into a newly attacked bass", () => {
  for (const group of LISTEN_ROUND_TWO_FIXTURE_GROUPS.filter((candidate) => (
    candidate.repeatedIdenticalChord
  ))) {
    const correct = findListenRoundTwoFixtureMember(group.id, "correct")?.member.definition;
    assert.ok(correct, group.id);
    assert.equal(group.repeatedRecoveryDesignStatus, "designed-unverified");
    const repeated = correct.targets.slice(1, 4);
    assert.equal(new Set(repeated.map((target) => JSON.stringify(target))).size, 1);
    const chord = repeated[0];
    const setupPitches = correct.attacks[0].notes.map((entry) => (
      typeof entry === "number" ? entry : entry.midi
    ));
    const firstPitches = correct.attacks[1].notes.map((entry) => (
      typeof entry === "number" ? entry : entry.midi
    ));
    assert.deepEqual(setupPitches, chord.slice(1));
    assert.deepEqual(firstPitches, [chord[0]]);
  }
});

test("confirmation definitions contain no decoded result or expectation", () => {
  const confirmation = LISTEN_ROUND_TWO_FIXTURE_GROUPS.filter(({ partition }) => (
    partition === "confirmation"
  ));
  assert.ok(confirmation.every(({ decodeStatus }) => (
    decodeStatus === "not-decoded-until-task-28"
  )));
  const serialized = JSON.stringify(confirmation);
  assert.doesNotMatch(serialized, /recognitionStructureHash|frames|expectedResult|advancedAt/);
});

test("every discovery and confirmation piano asset exists without rendering a fixture", async () => {
  const urls = new Set(LISTEN_ROUND_TWO_FIXTURE_GROUPS.flatMap(({ requiredAssetUrls }) => (
    requiredAssetUrls
  )));
  for (const assetUrl of urls) {
    const details = await stat(new URL(`../public${assetUrl}`, import.meta.url));
    assert.ok(details.isFile() && details.size > 0, assetUrl);
  }
});

test("every fixture-validator boundary rejects a targeted mutation", () => {
  const repeated = LISTEN_ROUND_TWO_FIXTURE_GROUPS[0];
  const other = LISTEN_ROUND_TWO_FIXTURE_GROUPS[1];
  const confirmation = LISTEN_ROUND_TWO_FIXTURE_GROUPS[4];
  const correct = repeated.members[0];
  const omitted = repeated.members[1];
  const mutations: Array<[string, readonly ListenRoundTwoFixtureGroup[]]> = [
    ["duplicate-group-id", replaceGroup(1, { id: repeated.id })],
    ["paired-role-census", replaceGroup(0, { members: repeated.members.slice(0, 2) })],
    ["duplicate-member-id", replaceGroup(0, {
      members: replaceMember(repeated, 1, { id: correct.id }),
    })],
    ["split-score-material", replaceGroup(0, {
      members: replaceMember(repeated, 1, {
        definition: {
          ...omitted.definition,
          targets: omitted.definition.targets.map((target, index) => (
            index === 0 ? [...target, 127] : target
          )),
        },
      }),
    })],
    ["articulation-mismatch", replaceGroup(0, {
      members: replaceMember(repeated, 1, {
        definition: { ...omitted.definition, articulation: "legato" },
      }),
    })],
    ["missing-required-assets", replaceGroup(0, { requiredAssetUrls: [] })],
    ["decode-status", replaceGroup(4, { decodeStatus: "capture-permitted" })],
    ["repeated-design-status", replaceGroup(0, {
      repeatedRecoveryDesignStatus: "not-applicable",
    })],
    ["repeated-target-shape", replaceGroup(0, {
      members: replaceMember(repeated, 0, {
        definition: {
          ...correct.definition,
          targets: correct.definition.targets.map((target, index) => (
            index === 2 ? [...target, 127] : target
          )),
        },
      }),
    })],
    ["repeated-carry-shape", replaceGroup(0, {
      members: replaceMember(repeated, 0, {
        definition: {
          ...correct.definition,
          attacks: correct.definition.attacks.map((attack, index) => (
            index === 1 ? { ...attack, notes: [127] } : attack
          )),
        },
      }),
    })],
    ["repeated-carry-duration", replaceGroup(0, {
      members: replaceMember(repeated, 0, {
        definition: {
          ...correct.definition,
          attacks: correct.definition.attacks.map((attack, index) => index === 0 ? {
            ...attack,
            notes: attack.notes.map((entry) => ({
              midi: typeof entry === "number" ? entry : entry.midi,
              holdMs: repeated.intervalMs,
            })),
          } : attack),
        },
      }),
    })],
    ["missing-repeated-partition", LISTEN_ROUND_TWO_FIXTURE_GROUPS.map((group) => (
      group.partition === "discovery" && group.repeatedIdenticalChord
        ? { ...group, repeatedIdenticalChord: false }
        : group
    ))],
  ];
  assert.notEqual(other.id, repeated.id);
  assert.equal(confirmation.partition, "confirmation");
  for (const [expectedCode, groups] of mutations) {
    const codes = validateListenRoundTwoFixtureGroups(groups).map(({ code }) => code);
    assert.ok(codes.includes(expectedCode), `${expectedCode}: ${codes.join(", ")}`);
    assert.throws(
      () => assertValidListenRoundTwoFixtureGroups(groups),
      new RegExp(expectedCode),
    );
  }
});
