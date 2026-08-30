/**
 * Authored musical inputs for matcher-calibration discovery round two.
 *
 * These fixtures are definitions, not measurements. In particular, a
 * confirmation definition has no decoded frames, recognition hash, or expected
 * matcher outcome. Its only pre-search claims are its score/performance shape,
 * acoustic configuration, and partition assignment.
 */

import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
} from "./listenBenchmarkAudio";
import {
  LISTEN_ARTICULATION_HOLD_MS,
  type ListenSequenceArticulation,
  type ListenSequenceAttackDefinition,
  type ListenSequenceDefinition,
  type ListenSequenceNote,
} from "./listenSequenceBenchmark";
import {
  isPianoLayerFor,
  pianoSampleUrlsForLayer,
  type PianoId,
  type PianoLayerId,
} from "../../pianoRegistry";

export type ListenRoundTwoFixturePartition = "discovery" | "confirmation";
export type ListenRoundTwoFixtureRole =
  | "correct"
  | "omitted-bass"
  | "distinguishable-wrong";
export type ListenRoundTwoRegister = "low" | "middle" | "high";
export type ListenRoundTwoRendererKey = "direct" | "tone";

export const LISTEN_ROUND_TWO_FIXTURE_ROLES: readonly ListenRoundTwoFixtureRole[] =
  Object.freeze(["correct", "omitted-bass", "distinguishable-wrong"] as const);

export interface ListenRoundTwoFixtureMember {
  id: string;
  role: ListenRoundTwoFixtureRole;
  definition: ListenSequenceDefinition;
}

export interface ListenRoundTwoFixtureGroup {
  id: string;
  label: string;
  partition: ListenRoundTwoFixturePartition;
  rendererKey: ListenRoundTwoRendererKey;
  renderer: string;
  piano: PianoId;
  layer: PianoLayerId;
  register: ListenRoundTwoRegister;
  chordSize: 3 | 4;
  articulation: ListenSequenceArticulation;
  intervalMs: number;
  repeatedIdenticalChord: boolean;
  /** Task 24's predicate is not asserted until the decoded baseline is available. */
  repeatedRecoveryDesignStatus: "not-applicable" | "designed-unverified";
  /** Confirmation stays undecoded until Task 28. */
  decodeStatus: "capture-permitted" | "not-decoded-until-task-28";
  requiredAssetUrls: readonly string[];
  members: readonly ListenRoundTwoFixtureMember[];
}

interface GroupSpec {
  id: string;
  label: string;
  partition: ListenRoundTwoFixturePartition;
  rendererKey: ListenRoundTwoRendererKey;
  piano: PianoId;
  layer: PianoLayerId;
  register: ListenRoundTwoRegister;
  articulation: ListenSequenceArticulation;
  intervalMs: number;
  focusChord: readonly number[];
  setupChord: readonly number[];
  resolutionChord: readonly number[];
  wrongPitch: number;
  repeatedIdenticalChord: boolean;
}

function note(midi: number, options: Omit<ListenSequenceNote, "midi"> = {}): ListenSequenceNote {
  return Object.freeze({ midi, ...options });
}

function fixedHoldMs(articulation: ListenSequenceArticulation): number {
  if (articulation === "sustained-shared") return 1_200;
  return LISTEN_ARTICULATION_HOLD_MS[articulation];
}

function frozenAttack(attack: ListenSequenceAttackDefinition): ListenSequenceAttackDefinition {
  return Object.freeze({
    ...attack,
    notes: Object.freeze(attack.notes.map((entry) => (
      typeof entry === "number" ? entry : Object.freeze({ ...entry })
    ))),
  });
}

function frozenDefinition(definition: ListenSequenceDefinition): ListenSequenceDefinition {
  return Object.freeze({
    ...definition,
    targets: Object.freeze(definition.targets.map((target) => Object.freeze([...target]))),
    attacks: Object.freeze(definition.attacks.map(frozenAttack)),
  });
}

function setupAttack(spec: GroupSpec): ListenSequenceAttackDefinition {
  const minimumCarryMs = spec.intervalMs + 96;
  const holdMs = Math.max(fixedHoldMs(spec.articulation), minimumCarryMs);
  return {
    at: 0,
    targetIndex: 0,
    notes: spec.setupChord.map((midi) => note(midi, { holdMs })),
    expectedAdvance: true,
  };
}

function ordinaryDefinition(
  spec: GroupSpec,
  role: ListenRoundTwoFixtureRole,
): ListenSequenceDefinition {
  const target = [...spec.focusChord];
  const upper = target.slice(1);
  const focusNotes = role === "correct"
    ? target
    : role === "omitted-bass"
      ? upper
      : [...target, spec.wrongPitch];
  const attacks: ListenSequenceAttackDefinition[] = [
    setupAttack(spec),
    {
      at: 1,
      targetIndex: 1,
      notes: focusNotes,
      expectedAdvance: role === "correct",
      targetStart: role === "correct" ? undefined : true,
    },
  ];
  if (role !== "correct") {
    attacks.push({
      at: 2,
      targetIndex: 1,
      notes: target,
      expectedAdvance: true,
    });
  }
  attacks.push({
    at: role === "correct" ? 2 : 3,
    targetIndex: 2,
    notes: spec.resolutionChord,
    expectedAdvance: true,
  });
  return frozenDefinition({
    id: `${spec.id}-${role}`,
    family: "round-two-paired",
    label: `${spec.label} · ${role}`,
    articulation: spec.articulation,
    targets: [spec.setupChord, spec.focusChord, spec.resolutionChord],
    attacks,
  });
}

function repeatedDefinition(
  spec: GroupSpec,
  role: ListenRoundTwoFixtureRole,
): ListenSequenceDefinition {
  const target = [...spec.focusChord];
  const bass = target[0];
  const upper = target.slice(1);
  const focusNotes = role === "correct"
    // The upper voices are already sounding. Only the newly introduced bass is
    // attacked on the first full-chord score target.
    ? [note(bass, { holdMs: fixedHoldMs(spec.articulation) })]
    : role === "omitted-bass"
      ? upper
      : [bass, spec.wrongPitch];
  const attacks: ListenSequenceAttackDefinition[] = [
    setupAttack(spec),
    {
      at: 1,
      targetIndex: 1,
      notes: focusNotes,
      gainReferenceChordSize: target.length,
      expectedAdvance: role === "correct",
      targetStart: role === "correct" ? undefined : true,
    },
  ];
  let at = 2;
  if (role !== "correct") {
    attacks.push({
      at,
      targetIndex: 1,
      notes: target,
      expectedAdvance: true,
    });
    at += 1;
  }
  // Three score occurrences of the identical chord expose recovery from the
  // source attack itself and from one or two later repetitions.
  attacks.push(
    { at, targetIndex: 2, notes: target, expectedAdvance: true },
    { at: at + 1, targetIndex: 3, notes: target, expectedAdvance: true },
    { at: at + 2, targetIndex: 4, notes: spec.resolutionChord, expectedAdvance: true },
  );
  return frozenDefinition({
    id: `${spec.id}-${role}`,
    family: "round-two-repeated-identical",
    label: `${spec.label} · ${role}`,
    articulation: spec.articulation,
    targets: [
      spec.setupChord,
      spec.focusChord,
      spec.focusChord,
      spec.focusChord,
      spec.resolutionChord,
    ],
    attacks,
  });
}

function rendererVersion(key: ListenRoundTwoRendererKey): string {
  return key === "tone" ? LISTEN_BENCHMARK_TONE_RENDERER.version : LISTEN_BENCHMARK_RENDERER.version;
}

function requiredAssets(spec: GroupSpec, members: readonly ListenRoundTwoFixtureMember[]): string[] {
  const samples = pianoSampleUrlsForLayer(spec.piano, spec.layer);
  const roots = Object.entries(samples).map(([midi, url]) => ({ midi: Number(midi), url }));
  const pitches = [...new Set(members.flatMap(({ definition }) => (
    definition.attacks.flatMap(({ notes }) => notes.map((entry) => (
      typeof entry === "number" ? entry : entry.midi
    )))
  )))];
  return [...new Set(pitches.map((midi) => roots.reduce((nearest, candidate) => (
    Math.abs(candidate.midi - midi) < Math.abs(nearest.midi - midi) ? candidate : nearest
  )).url))].sort();
}

function group(spec: GroupSpec): ListenRoundTwoFixtureGroup {
  if (spec.focusChord.length !== 3 && spec.focusChord.length !== 4) {
    throw new Error(`${spec.id} must use a triad or tetrad.`);
  }
  if (!isPianoLayerFor(spec.piano, spec.layer)) {
    throw new Error(`${spec.id} assigns ${spec.layer} to ${spec.piano}.`);
  }
  const build = spec.repeatedIdenticalChord ? repeatedDefinition : ordinaryDefinition;
  const members = Object.freeze(LISTEN_ROUND_TWO_FIXTURE_ROLES.map((role) => Object.freeze({
    id: `${spec.id}/${role}`,
    role,
    definition: build(spec, role),
  })));
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    partition: spec.partition,
    rendererKey: spec.rendererKey,
    renderer: rendererVersion(spec.rendererKey),
    piano: spec.piano,
    layer: spec.layer,
    register: spec.register,
    chordSize: spec.focusChord.length as 3 | 4,
    articulation: spec.articulation,
    intervalMs: spec.intervalMs,
    repeatedIdenticalChord: spec.repeatedIdenticalChord,
    repeatedRecoveryDesignStatus: spec.repeatedIdenticalChord
      ? "designed-unverified"
      : "not-applicable",
    decodeStatus: spec.partition === "confirmation"
      ? "not-decoded-until-task-28"
      : "capture-permitted",
    requiredAssetUrls: Object.freeze(requiredAssets(spec, members)),
    members,
  });
}

/**
 * Eight author-time groups. Four are discovery and four are unseen
 * confirmation; each partition contains two general pairs and two explicit
 * repeated-identical-chord pairs.
 */
export const LISTEN_ROUND_TWO_FIXTURE_GROUPS: readonly ListenRoundTwoFixtureGroup[] = Object.freeze([
  group({
    id: "r2-repeated-low-triad-direct-splendid-pp",
    label: "Low carried upper voices into repeated triad",
    partition: "discovery",
    rendererKey: "direct",
    piano: "splendid",
    layer: "pp",
    register: "low",
    articulation: "detached",
    intervalMs: 167,
    setupChord: [55, 59],
    focusChord: [40, 55, 59],
    resolutionChord: [43, 55, 60],
    wrongPitch: 66,
    repeatedIdenticalChord: true,
  }),
  group({
    id: "r2-repeated-mid-tetrad-tone-salamander-v13",
    label: "Middle carried upper voices into repeated tetrad",
    partition: "discovery",
    rendererKey: "tone",
    piano: "salamander",
    layer: "v13",
    register: "middle",
    articulation: "sustained-shared",
    intervalMs: 500,
    setupChord: [67, 71, 76],
    focusChord: [55, 67, 71, 76],
    resolutionChord: [57, 69, 72, 77],
    wrongPitch: 61,
    repeatedIdenticalChord: true,
  }),
  group({
    id: "r2-paired-mid-triad-direct-salamander-v10",
    label: "Middle normal triad pair",
    partition: "discovery",
    rendererKey: "direct",
    piano: "salamander",
    layer: "v10",
    register: "middle",
    articulation: "normal",
    intervalMs: 500,
    setupChord: [52, 64, 71],
    focusChord: [53, 65, 72],
    resolutionChord: [55, 67, 74],
    wrongPitch: 61,
    repeatedIdenticalChord: false,
  }),
  group({
    id: "r2-paired-high-tetrad-tone-splendid-ff",
    label: "High legato tetrad pair",
    partition: "discovery",
    rendererKey: "tone",
    piano: "splendid",
    layer: "ff",
    register: "high",
    articulation: "legato",
    intervalMs: 500,
    setupChord: [64, 76, 80],
    focusChord: [65, 77, 81, 84],
    resolutionChord: [67, 79, 83, 86],
    wrongPitch: 73,
    repeatedIdenticalChord: false,
  }),
  group({
    id: "r2-repeated-high-triad-tone-splendid-mf",
    label: "High carried upper voices into repeated triad",
    partition: "confirmation",
    rendererKey: "tone",
    piano: "splendid",
    layer: "mf",
    register: "high",
    articulation: "normal",
    intervalMs: 333,
    setupChord: [79, 83],
    focusChord: [67, 79, 83],
    resolutionChord: [69, 81, 84],
    wrongPitch: 74,
    repeatedIdenticalChord: true,
  }),
  group({
    id: "r2-repeated-mid-tetrad-direct-salamander-v03",
    label: "Middle carried upper voices into repeated tetrad",
    partition: "confirmation",
    rendererKey: "direct",
    piano: "salamander",
    layer: "v03",
    register: "middle",
    articulation: "legato",
    intervalMs: 500,
    setupChord: [62, 65, 69],
    focusChord: [50, 62, 65, 69],
    resolutionChord: [52, 64, 67, 71],
    wrongPitch: 58,
    repeatedIdenticalChord: true,
  }),
  group({
    id: "r2-paired-low-tetrad-tone-salamander-v05",
    label: "Low detached tetrad pair",
    partition: "confirmation",
    rendererKey: "tone",
    piano: "salamander",
    layer: "v05",
    register: "low",
    articulation: "detached",
    intervalMs: 333,
    setupChord: [41, 53, 57, 60],
    focusChord: [42, 54, 58, 61],
    resolutionChord: [45, 57, 60, 64],
    wrongPitch: 49,
    repeatedIdenticalChord: false,
  }),
  group({
    id: "r2-paired-high-triad-direct-splendid-mp",
    label: "High sustained-shared triad pair",
    partition: "confirmation",
    rendererKey: "direct",
    piano: "splendid",
    layer: "mp",
    register: "high",
    articulation: "sustained-shared",
    intervalMs: 500,
    setupChord: [63, 75, 79],
    focusChord: [64, 76, 80],
    resolutionChord: [66, 78, 81],
    wrongPitch: 71,
    repeatedIdenticalChord: false,
  }),
]);

export function findListenRoundTwoFixtureMember(
  groupId: string,
  role: ListenRoundTwoFixtureRole,
): { group: ListenRoundTwoFixtureGroup; member: ListenRoundTwoFixtureMember } | undefined {
  const group = LISTEN_ROUND_TWO_FIXTURE_GROUPS.find(({ id }) => id === groupId);
  const member = group?.members.find((candidate) => candidate.role === role);
  return group && member ? { group, member } : undefined;
}

export interface ListenRoundTwoFixtureProblem {
  code: string;
  groupId: string;
  message: string;
}

/** Structural checks that intentionally render and decode nothing. */
export function validateListenRoundTwoFixtureGroups(
  groups: readonly ListenRoundTwoFixtureGroup[] = LISTEN_ROUND_TWO_FIXTURE_GROUPS,
): ListenRoundTwoFixtureProblem[] {
  const problems: ListenRoundTwoFixtureProblem[] = [];
  const add = (code: string, groupId: string, message: string) => {
    problems.push({ code, groupId, message });
  };
  const groupIds = new Set<string>();
  const memberIds = new Set<string>();
  for (const fixtureGroup of groups) {
    if (groupIds.has(fixtureGroup.id)) {
      add("duplicate-group-id", fixtureGroup.id, "The paired group ID is duplicated.");
    }
    groupIds.add(fixtureGroup.id);
    const roles = fixtureGroup.members.map(({ role }) => role).sort();
    if (roles.join("|") !== [...LISTEN_ROUND_TWO_FIXTURE_ROLES].sort().join("|")) {
      add("paired-role-census", fixtureGroup.id, "The group must contain exactly three roles.");
    }
    const targetIdentity = JSON.stringify(fixtureGroup.members[0]?.definition.targets ?? []);
    for (const member of fixtureGroup.members) {
      if (memberIds.has(member.id)) {
        add("duplicate-member-id", fixtureGroup.id, `${member.id} is duplicated.`);
      }
      memberIds.add(member.id);
      if (JSON.stringify(member.definition.targets) !== targetIdentity) {
        add("split-score-material", fixtureGroup.id, `${member.id} changes the paired score.`);
      }
      if (member.definition.articulation !== fixtureGroup.articulation) {
        add("articulation-mismatch", fixtureGroup.id, `${member.id} changes articulation.`);
      }
    }
    if (fixtureGroup.requiredAssetUrls.length === 0 || fixtureGroup.requiredAssetUrls.some((url) => (
      !url.startsWith("/audio/") || !url.endsWith(".ogg")
    ))) {
      add("missing-required-assets", fixtureGroup.id, "The fixture has no complete piano asset list.");
    }
    const expectedDecodeStatus = fixtureGroup.partition === "confirmation"
      ? "not-decoded-until-task-28"
      : "capture-permitted";
    if (fixtureGroup.decodeStatus !== expectedDecodeStatus) {
      add("decode-status", fixtureGroup.id, `Expected ${expectedDecodeStatus}.`);
    }
    if (fixtureGroup.repeatedIdenticalChord) {
      if (fixtureGroup.repeatedRecoveryDesignStatus !== "designed-unverified") {
        add("repeated-design-status", fixtureGroup.id, "Repeated recovery must remain unverified.");
      }
      const correct = fixtureGroup.members.find(({ role }) => role === "correct")?.definition;
      const repeatedTargets = correct?.targets.slice(1, 4) ?? [];
      if (repeatedTargets.length !== 3 || repeatedTargets.some((target) => (
        JSON.stringify(target) !== JSON.stringify(repeatedTargets[0])
      ))) {
        add("repeated-target-shape", fixtureGroup.id, "The correct case needs three identical targets.");
      }
      const setup = correct?.attacks[0];
      const firstChord = correct?.attacks[1];
      const focus = correct?.targets[1] ?? [];
      const bass = focus[0];
      const upper = focus.slice(1);
      const setupPitches = setup?.notes.map((entry) => (
        typeof entry === "number" ? entry : entry.midi
      )) ?? [];
      const focusPitches = firstChord?.notes.map((entry) => (
        typeof entry === "number" ? entry : entry.midi
      )) ?? [];
      if (JSON.stringify(setupPitches) !== JSON.stringify(upper) ||
          focusPitches.length !== 1 || focusPitches[0] !== bass) {
        add(
          "repeated-carry-shape",
          fixtureGroup.id,
          "The upper voices must carry while only the new bass attacks the first full chord.",
        );
      }
      const carriedLongEnough = setup?.notes.every((entry) => (
        typeof entry !== "number" && (entry.holdMs ?? 0) > fixtureGroup.intervalMs
      ));
      if (!carriedLongEnough) {
        add("repeated-carry-duration", fixtureGroup.id, "The authored upper voices do not carry.");
      }
    }
  }
  for (const partition of ["discovery", "confirmation"] as const) {
    const partitionGroups = groups.filter((fixtureGroup) => fixtureGroup.partition === partition);
    if (!partitionGroups.some(({ repeatedIdenticalChord }) => repeatedIdenticalChord)) {
      add("missing-repeated-partition", partition, `${partition} needs a repeated paired group.`);
    }
  }
  return problems;
}

export function assertValidListenRoundTwoFixtureGroups(
  groups: readonly ListenRoundTwoFixtureGroup[] = LISTEN_ROUND_TWO_FIXTURE_GROUPS,
): void {
  const problems = validateListenRoundTwoFixtureGroups(groups);
  if (problems.length > 0) {
    throw new Error(`Invalid round-two fixtures: ${problems
      .map(({ code, groupId }) => `${code}:${groupId}`).join(", ")}`);
  }
}
