/**
 * Task 26: the staged round-two ablations and their single frozen artifact.
 *
 * Three grids are run in a fixed order — the unchanged round-one grid, the
 * refined five-axis family, then that same refined family crossed with the
 * experimental bass-onset axis — and each one runs only when Task 24's frozen
 * stop rule authorises it from the recorded result of the one before. Changing
 * the corpus, the gates, the grid, and the axis at once would make attribution
 * impossible, so nothing here decides which ablation to run from anything but
 * the recorded verdict of its predecessor.
 *
 * Every judgement this module makes is discovery-safe and search-selected.
 * Production eligibility does not exist until Task 28 has measured the
 * confirmation partition, and no confirmation trace is read here: the sweep it
 * drives captures only the discovery and regression-only partitions.
 */

import {
  LISTEN_REPEATED_CHORD_PITCHES,
  LISTEN_REPEATED_CHORD_TRACE_IDS,
} from "./listenBassQualificationBenchmark";
import {
  LISTEN_ARCHIVED_DISCOVERY_VERDICTS,
  listenRepeatedChordAttackRecords,
  listenRepeatedChordRecoveries,
  observeListenSequenceQualification,
  type ListenRepeatedChordAttackRecord,
  type ListenRepeatedChordTargetRecovery,
} from "./listenBassQualification";
import {
  LISTEN_BASELINE_PROFILE_ID,
} from "./listenBaselineParity";
import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  listenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import type { ListenExperimentalBassOnsetThresholds } from "./listenExperimentalBassOnset";
import {
  LISTEN_MATCHER_SELECTION_POLICY,
  LISTEN_MATCHER_SELECTION_POLICY_HASH,
  LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
  assertValidListenMatcherSelectionPolicy,
  evaluateListenAblationStop,
  evaluateListenBassAxisPairSupport,
  evaluateListenDomainRegret,
  evaluateListenRepeatedRecovery,
  listenDomainCandidateFromLeafMetrics,
  listenRepeatedRecoveryReproduces,
  type ListenAblationStopResult,
  type ListenBassAxisPairSupportResult,
  type ListenDomainRegretControlResult,
  type ListenRepeatedRecoveryEvaluation,
  type ListenRepeatedRecoveryGroupComparison,
  type ListenRepeatedRecoveryObservation,
} from "./listenMatcherSelectionPolicy";
import {
  captureListenMultiDomainTrace,
  evaluateListenMatcherMultiDomainSweep,
  type ListenMultiDomainCapture,
  type ListenMultiDomainCaptureFn,
  type ListenMultiDomainProfileResult,
  type ListenMultiDomainSweepResult,
} from "./listenMatcherSweepBenchmark";
import {
  LISTEN_ROUND_TWO_ABLATION_IDS,
  LISTEN_ROUND_TWO_BASS_ONSET_POINTS,
  LISTEN_ROUND_TWO_GENERATOR_VERSION,
  LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS,
  listenRoundTwoAblationGrid,
  type ListenRoundTwoAblationId,
  type ListenRoundTwoSweepProfile,
} from "./listenRoundTwoGenerator";
import { LISTEN_ROUND_TWO_FIXTURE_GROUPS } from "./listenRoundTwoFixtures";
import { withOnlineAmtBenchmarkSession } from "./listenSequenceBenchmark";
import {
  DeterministicHasher,
  LISTEN_TRACE_MANIFEST,
  assertValidListenTraceManifest,
  type ListenTraceManifest,
} from "./listenTraceManifest";

/* ------------------------------------------------------------------------- *
 * Terminal outcomes and the repeated-chord census
 * ------------------------------------------------------------------------- */

/** The four outcomes Task 26 may record, exactly one of which is reached. */
export type ListenRoundTwoTerminalOutcome =
  | "existing-grid-sufficient"
  | "existing-family-refinement-sufficient"
  | "bass-axis-supported"
  | "bass-axis-unsupported";

/**
 * The per-run resolution vocabulary, kept separate from the group-set labels
 * Task 24 froze. `discovery-full-resolution` is a property of every decoded
 * discovery group together and is therefore never claimed by one run here.
 */
export type ListenRoundTwoRunResolution =
  | "unrecovered"
  | "recovered-at-source-distance-0"
  | "partial-recovery-at-source-distance-1"
  | "late-recovery-beyond-source-distance-1"
  | "recovered-without-attribution";

export type ListenRoundTwoRepeatedOrigin = "known-round-one" | "round-two-authored";

export const LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM = "known-round-one-repeated-chord";
export const LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM = "round-two-authored-repeated-chord";

/** One repeated-identical-chord group, named by the trace that carries it. */
export interface ListenRoundTwoRepeatedGroup {
  groupId: string;
  traceId: string;
  origin: ListenRoundTwoRepeatedOrigin;
  stratum: string;
  chordPitches: number[];
}

function repeatedChordOf(targets: readonly (readonly number[])[]): number[] {
  const counts = new Map<string, { pitches: number[]; count: number }>();
  for (const target of targets) {
    const pitches = [...target].sort((left, right) => left - right);
    const key = pitches.join("+");
    const entry = counts.get(key) ?? { pitches, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  const repeated = [...counts.values()]
    .filter(({ count }) => count >= 2)
    .sort((left, right) => right.count - left.count);
  if (repeated.length !== 1) {
    throw new Error("A repeated-identical-chord fixture must repeat exactly one chord.");
  }
  return repeated[0].pitches;
}

/**
 * The discovery repeated-chord census, in report order: the three known
 * round-one runs first, then every newly authored discovery group.
 *
 * The authored entries are read from the Task 25 fixtures rather than listed
 * here, so a fixture that is renamed, repartitioned, or stops repeating its
 * chord fails to build this census instead of quietly leaving a group
 * unmeasured.
 */
export function listenRoundTwoRepeatedGroups(): ListenRoundTwoRepeatedGroup[] {
  const known = LISTEN_REPEATED_CHORD_TRACE_IDS.map((traceId): ListenRoundTwoRepeatedGroup => ({
    groupId: traceId,
    traceId,
    origin: "known-round-one",
    stratum: LISTEN_ROUND_TWO_KNOWN_REPEATED_STRATUM,
    chordPitches: [...LISTEN_REPEATED_CHORD_PITCHES],
  }));
  const authored = LISTEN_ROUND_TWO_FIXTURE_GROUPS
    .filter((group) => group.repeatedIdenticalChord && group.partition === "discovery")
    .map((group): ListenRoundTwoRepeatedGroup => {
      const correct = group.members.find(({ role }) => role === "correct");
      if (!correct) throw new Error(`${group.id} has no correct member.`);
      return {
        groupId: `round-two/${group.id}/correct`,
        traceId: `round-two/${group.id}/correct`,
        origin: "round-two-authored",
        stratum: LISTEN_ROUND_TWO_AUTHORED_REPEATED_STRATUM,
        chordPitches: repeatedChordOf(correct.definition.targets),
      };
    });
  const groups = [...known, ...authored];
  if (new Set(groups.map(({ groupId }) => groupId)).size !== groups.length) {
    throw new Error("The repeated-chord census names the same group twice.");
  }
  for (const knownId of LISTEN_MATCHER_SELECTION_POLICY.repeatedRecovery.knownDiscoveryGroupIds) {
    if (!groups.some(({ groupId }) => groupId === knownId)) {
      throw new Error(`The repeated-chord census omits the frozen known group ${knownId}.`);
    }
  }
  if (authored.length === 0) {
    throw new Error("Task 25 placed no repeated-identical-chord group in discovery.");
  }
  return groups;
}

/* ------------------------------------------------------------------------- *
 * One group's measurement under one profile
 * ------------------------------------------------------------------------- */

/** The decoded qualification detail one repeated-chord attack contributes. */
export interface ListenRoundTwoRepeatedAttackDetail {
  attackIndex: number;
  role: ListenRepeatedChordAttackRecord["role"];
  chordIsArmedTarget: boolean;
  advanced: boolean;
  advancedTargetIndex: number | null;
  sourceDistance: number | null;
  attributionDelayMs: number | null;
  primaryLimitingPath: ListenRepeatedChordAttackRecord["primaryLimitingPath"];
  limitingPaths: ListenRepeatedChordAttackRecord["limitingPaths"];
  limitingPitches: number[];
  lowestLimitingUpperVoiceEvidence: number | null;
  pitches: Array<{
    midi: number;
    role: "bass" | "upper";
    path: ListenRepeatedChordAttackRecord["pitches"][number]["path"];
    qualified: boolean;
    soundingBeforeAttack: boolean;
    onsetConfidence: number | null;
    targetEvidence: number;
  }>;
}

export interface ListenRoundTwoRepeatedMeasurement {
  groupId: string;
  traceId: string;
  origin: ListenRoundTwoRepeatedOrigin;
  stratum: string;
  chordPitches: number[];
  profileId: string;
  observation: ListenRepeatedRecoveryObservation;
  /** Task 22 reported the best recovery; the decision reads the worst. */
  bestSourceDistance: number | null;
  worstSourceDistance: number | null;
  /** Repeated targets this profile advanced early rather than recovered late. */
  earlyAttributedTargetIndexes: number[];
  runResolution: ListenRoundTwoRunResolution;
  targets: Array<{
    targetIndex: number;
    advanced: boolean;
    sourceDistance: number | null;
    attributionDelayMs: number | null;
    classification: ListenRepeatedChordTargetRecovery["classification"];
  }>;
  attacks: ListenRoundTwoRepeatedAttackDetail[];
  /** The weakest upper-voice evidence that limited the transition attack. */
  transitionLowestLimitingUpperVoiceEvidence: number | null;
}

function attackDetail(record: ListenRepeatedChordAttackRecord): ListenRoundTwoRepeatedAttackDetail {
  return {
    attackIndex: record.attackIndex,
    role: record.role,
    chordIsArmedTarget: record.chordIsArmedTarget,
    advanced: record.advanced,
    advancedTargetIndex: record.advancedTargetIndex,
    sourceDistance: record.sourceDistance,
    attributionDelayMs: record.attributionDelayMs,
    primaryLimitingPath: record.primaryLimitingPath,
    limitingPaths: [...record.limitingPaths],
    limitingPitches: [...record.limitingPitches],
    lowestLimitingUpperVoiceEvidence: record.lowestLimitingUpperVoiceEvidence,
    pitches: record.pitches.map((pitch) => ({
      midi: pitch.midi,
      role: pitch.role,
      path: pitch.path,
      qualified: pitch.qualified,
      soundingBeforeAttack: pitch.soundingBeforeAttack,
      onsetConfidence: pitch.onsetConfidence,
      targetEvidence: pitch.targetEvidence,
    })),
  };
}

function runResolution(
  observation: ListenRepeatedRecoveryObservation,
  advancedWithoutAttribution: boolean,
): ListenRoundTwoRunResolution {
  if (observation.sourceDistance === null) {
    return advancedWithoutAttribution ? "recovered-without-attribution" : "unrecovered";
  }
  if (observation.sourceDistance === 0) return "recovered-at-source-distance-0";
  if (observation.sourceDistance === 1) return "partial-recovery-at-source-distance-1";
  return "late-recovery-beyond-source-distance-1";
}

/**
 * The worst and the best attributed recovery among one group's repetitions.
 *
 * The worst row is the decision input, and its distance and delay are taken from
 * that one row so a distance can never be reported beside another repetition's
 * delay. Reading the best instead — which is what Task 22 quoted, and what is
 * reported beside it — would let a profile that recovers one repetition on its
 * own attack and leaves another two targets late be recorded as a resolution.
 */
export function listenRoundTwoAttributedRecoverySpan(
  recoveries: readonly ListenRepeatedChordTargetRecovery[],
): {
  worst: ListenRepeatedChordTargetRecovery | null;
  bestSourceDistance: number | null;
  earlyAttributedTargetIndexes: number[];
} {
  // A target advanced by an attack that belongs to an earlier target, or before
  // its own attack sounded, was not recovered late — it was advanced early. That
  // is what the run's own false-advance counter rejects, and counting it as a
  // recovery of distance -1 would read a safety failure as an improvement.
  const early = recoveries.filter((recovery) => (
    recovery.advanced &&
    ((recovery.sourceDistance !== null && recovery.sourceDistance < 0) ||
      (recovery.attributionDelayMs !== null && recovery.attributionDelayMs < 0))
  ));
  const attributed = recoveries.filter((recovery) => (
    recovery.advanced &&
    recovery.sourceDistance !== null && recovery.sourceDistance >= 0 &&
    recovery.attributionDelayMs !== null && recovery.attributionDelayMs >= 0
  ));
  return {
    worst: attributed.reduce<ListenRepeatedChordTargetRecovery | null>((chosen, recovery) => (
      chosen === null ||
        recovery.sourceDistance! > chosen.sourceDistance! ||
        (recovery.sourceDistance === chosen.sourceDistance &&
          recovery.attributionDelayMs! > chosen.attributionDelayMs!)
        ? recovery
        : chosen
    ), null),
    bestSourceDistance: attributed.length === 0
      ? null
      : Math.min(...attributed.map(({ sourceDistance }) => sourceDistance as number)),
    earlyAttributedTargetIndexes: early.map(({ targetIndex }) => targetIndex),
  };
}

/**
 * One repeated-chord group, measured under one profile from its own captured
 * trace.
 *
 * The recorded source distance and attribution delay are the worst decoded
 * repetition of the group, taken from one row so the pair stays consistent, and
 * the best is reported beside it because Task 22 quoted that. Reading the best
 * as the decision input would let a profile that recovers one repetition on its
 * own attack and another two targets late be recorded as a full resolution.
 */
export function listenRoundTwoRepeatedMeasurement(options: {
  group: ListenRoundTwoRepeatedGroup;
  capture: ListenMultiDomainCapture;
  profileId: string;
  profile: ListenExperimentalBassOnsetThresholds;
}): ListenRoundTwoRepeatedMeasurement {
  const { group, capture, profileId, profile } = options;
  const { descriptor, sequence, trace } = capture;
  if (descriptor.id !== group.traceId) {
    throw new Error(`${group.groupId} was measured from ${descriptor.id}.`);
  }
  const { run, advancements } = observeListenSequenceQualification(sequence, trace, profile);
  const recoveries = listenRepeatedChordRecoveries(
    sequence,
    run,
    advancements,
    group.chordPitches,
  );
  const attacks = listenRepeatedChordAttackRecords(
    {
      traceId: descriptor.id,
      suite: descriptor.suite,
      partition: descriptor.partition,
      rendererKey: descriptor.rendererKey,
    },
    sequence,
    trace,
    profile,
    group.chordPitches,
  );
  const transition = attacks.find(({ role }) => role === "transition") ?? null;
  const repeatedTargetIndexes = new Set(recoveries.map(({ targetIndex }) => targetIndex));
  const {
    worst,
    bestSourceDistance,
    earlyAttributedTargetIndexes,
  } = listenRoundTwoAttributedRecoverySpan(recoveries);
  const observation: ListenRepeatedRecoveryObservation = {
    evaluated: true,
    structurallyValid: recoveries.length >= 2 && transition !== null && attacks.length >= 2,
    firstCorrectFullChordAttackIncomplete: transition === null ||
      !(transition.advanced && transition.advancedTargetIndex === transition.attackTargetIndex),
    // Measured on `v05`, `v13`, and the mixed run: the limiting pitch is a
    // required chord member the decoder gives no onset at all, leaving sustained
    // evidence as its only route. The decoder's active set does not always still
    // hold that pitch when the attack begins, so reading the score's carry
    // instead of the decoder's silence would miss all three known runs.
    carriedRequiredPitchWithoutFreshReOnset: transition !== null &&
      transition.pitches.some((pitch) => (
        pitch.onsetConfidence === null && pitch.path !== "qualified-by-fresh-onset"
      )),
    laterIdenticalAttackRecoveredCorrectTarget: attacks.some((attack) => (
      attack.role === "exact-repetition" && attack.advanced &&
      attack.advancedTargetIndex !== null && repeatedTargetIndexes.has(attack.advancedTargetIndex)
    )),
    sourceDistance: worst?.sourceDistance ?? null,
    attributionDelayMs: worst?.attributionDelayMs ?? null,
    falseAdvanceCount: run.summary.falseAdvanceCount,
    skippedAdvanceCount: run.summary.skippedAdvanceCount,
    duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
  };
  return {
    groupId: group.groupId,
    traceId: group.traceId,
    origin: group.origin,
    stratum: group.stratum,
    chordPitches: [...group.chordPitches],
    profileId,
    observation,
    bestSourceDistance,
    worstSourceDistance: observation.sourceDistance,
    earlyAttributedTargetIndexes,
    runResolution: runResolution(
      observation,
      recoveries.some(({ advanced, sourceDistance }) => advanced && sourceDistance === null) ||
        earlyAttributedTargetIndexes.length > 0,
    ),
    targets: recoveries.map((recovery) => ({
      targetIndex: recovery.targetIndex,
      advanced: recovery.advanced,
      sourceDistance: recovery.sourceDistance,
      attributionDelayMs: recovery.attributionDelayMs,
      classification: [...recovery.classification],
    })),
    attacks: attacks.map(attackDetail),
    transitionLowestLimitingUpperVoiceEvidence:
      transition?.lowestLimitingUpperVoiceEvidence ?? null,
  };
}

/* ------------------------------------------------------------------------- *
 * The per-profile repeated-recovery comparison
 * ------------------------------------------------------------------------- */

export interface ListenRoundTwoRepeatedProfileReport {
  profileId: string;
  comparedAgainstProfileId: string;
  evaluation: ListenRepeatedRecoveryEvaluation;
  measurements: ListenRoundTwoRepeatedMeasurement[];
  /**
   * Groups whose reference run does not reproduce Task 24's predicate. Reported,
   * never used to narrow the declared stratum census.
   */
  nonReproducingGroupIds: string[];
  declaredStrata: string[];
}

/**
 * Every repeated-chord group in the census, declared as discovery evidence.
 *
 * Task 24's hashed policy requires material recovery in every declared discovery
 * stratum and its evaluator applies that rule to every group handed to it, so
 * Task 26 hands it all of them. It froze an `inconclusive-for-repeated-recovery`
 * outcome for *confirmation* groups whose reference run does not reproduce the
 * phenomenon; extending that to discovery groups here would be a decision-bearing
 * rule invented after the corpus was captured, and it would change which
 * ablations run. Whether the reference run reproduces the predicate is reported
 * per group instead — Task 24's own `baselineReproduces` field carries it — and
 * it filters nothing.
 */
function declaredRepeatedComparisons(
  groups: readonly ListenRoundTwoRepeatedGroup[],
  reference: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>,
  candidate: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>,
): {
  comparisons: ListenRepeatedRecoveryGroupComparison[];
  nonReproducingGroupIds: string[];
} {
  const comparisons: ListenRepeatedRecoveryGroupComparison[] = [];
  const nonReproducingGroupIds: string[] = [];
  for (const group of groups) {
    const baseline = reference.get(group.groupId);
    const measured = candidate.get(group.groupId);
    if (!baseline || !measured) {
      throw new Error(`${group.groupId} has no measurement for both sides of its comparison.`);
    }
    if (!listenRepeatedRecoveryReproduces(baseline.observation)) {
      nonReproducingGroupIds.push(group.groupId);
    }
    comparisons.push({
      groupId: group.groupId,
      stratum: group.stratum,
      evidenceRole: "discovery",
      baseline: baseline.observation,
      candidate: measured.observation,
    });
  }
  return { comparisons, nonReproducingGroupIds };
}

/**
 * One profile's repeated-chord comparison against a reference profile — the
 * incumbent for a grid-level judgement, or the matched twin for a bass pair.
 */
export function listenRoundTwoRepeatedProfileReport(options: {
  groups: readonly ListenRoundTwoRepeatedGroup[];
  reference: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>;
  candidate: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>;
  profileId: string;
  comparedAgainstProfileId: string;
}): ListenRoundTwoRepeatedProfileReport {
  const { comparisons, nonReproducingGroupIds } = declaredRepeatedComparisons(
    options.groups,
    options.reference,
    options.candidate,
  );
  return {
    profileId: options.profileId,
    comparedAgainstProfileId: options.comparedAgainstProfileId,
    evaluation: evaluateListenRepeatedRecovery(comparisons),
    measurements: options.groups.flatMap((group) => {
      const measurement = options.candidate.get(group.groupId);
      return measurement === undefined ? [] : [measurement];
    }),
    nonReproducingGroupIds,
    declaredStrata: [...new Set(comparisons.map(({ stratum }) => stratum))].sort(),
  };
}

/* ------------------------------------------------------------------------- *
 * One ablation
 * ------------------------------------------------------------------------- */

export interface ListenRoundTwoHighOnsetRow {
  profileId: string;
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  safe: boolean;
  rejectionReasons: string[];
  worstDomainIndependentRate: number | null;
  equalDomainIndependentRate: number | null;
  worstDomainRegret: number | null;
}

export interface ListenRoundTwoCounterfactualRow extends ListenRoundTwoHighOnsetRow {
  archivedRoundOnePassed: boolean;
  archivedRoundOneRejectionCodes: string[];
  agreesWithRoundOneSafety: boolean;
}

/**
 * The decision-bearing part of Task 24's calculation, plus one compact row per
 * grid profile.
 *
 * The complete per-candidate regret detail is 30 leaf rows per profile, which
 * for the bass grid is a six-figure row count that no reader and no verifier
 * benefits from. Every row of the grid is still present with its safety verdict
 * and its worst-domain regret, so a claim about the grid can be recomputed from
 * this record; the full leaf detail is reproducible by rerunning the staged
 * grid, which is versioned and frozen.
 */
export interface ListenRoundTwoGridRow {
  profileId: string;
  safe: boolean;
  rejectionCodes: string[];
  worstDomainRegret: number | null;
  worstDomainIndependentRate: number | null;
  equalDomainIndependentRate: number | null;
}

export interface ListenRoundTwoDomainRegretRecord {
  policyVersion: number;
  policyHash: string;
  baselineProfileId: string;
  safeProfileCount: number;
  domainCount: number;
  decisionBoundary: number;
  materialBoundary: number;
  maximumCandidateCount: number;
  verdict: ListenDomainRegretControlResult["verdict"];
  oracles: ListenDomainRegretControlResult["oracles"];
  bestGlobal: ListenDomainRegretControlResult["bestGlobal"];
  bestGlobalTieProfileIds: string[];
  selectedProfileIds: string[];
  selectedEnvelope: ListenDomainRegretControlResult["selectedEnvelope"];
  measurementResolution: ListenDomainRegretControlResult["measurementResolution"];
  /** Complete regret detail for the baseline, the comparator, and the selected set. */
  decisionRows: ListenDomainRegretControlResult["candidates"];
  gridRows: ListenRoundTwoGridRow[];
}

export interface ListenRoundTwoAblationRecord {
  ablation: ListenRoundTwoAblationId;
  ranBecause: string;
  generatorVersion: number;
  gridVersion: string;
  gridSize: number;
  /** False when a narrowed grid was injected; such a record is not the measurement. */
  gridIsFrozenGenerator: boolean;
  bassAxisPresent: boolean;
  bassOnsetThresholds: number[];
  manifest: ListenMultiDomainSweepResult["manifest"];
  capturedTraceCount: number;
  confirmationTraceCountRead: 0;
  safeProfileCount: number;
  profilesRejectedBySafety: number;
  domainRegret: ListenRoundTwoDomainRegretRecord;
  rejectionCounts: Array<{ reason: string; profileCount: number }>;
  selectedProfileIds: string[];
  /** Never eligibility: the confirmation partition has not been measured. */
  selectionJudgement: "discovery-safe-and-search-selected";
  repeatedRecovery: ListenRoundTwoRepeatedProfileReport[];
  baselineRepeatedMeasurements: ListenRoundTwoRepeatedMeasurement[];
  stop: ListenAblationStopResult;
  sourceDistanceZeroRoute: {
    activeTargetGridFloor: number;
    task22LimitingMinimum: number;
    straddlesTask22Minimum: boolean;
    statement: string;
  };
  highOnsetSurvivors?: ListenRoundTwoHighOnsetRow[];
  roundOneCounterfactuals?: ListenRoundTwoCounterfactualRow[];
  matchedPairs?: ListenRoundTwoBassPairRecord[];
}

export interface ListenRoundTwoBassPairRecord {
  axisProfileId: string;
  twinProfileId: string;
  bassOnsetThreshold: number;
  onsetThreshold: number;
  axisSelected: boolean;
  axisSafe: boolean;
  twinSafe: boolean;
  axisWorstDomainRegret: number | null;
  twinWorstDomainRegret: number | null;
  support: ListenBassAxisPairSupportResult;
  repeatedRecoveryAgainstTwin: ListenRoundTwoRepeatedProfileReport;
  /**
   * The twin's own per-run measurements, archived beside the axis's.
   *
   * The pair comparison is the whole point of the axis, and a reader — or a
   * verifier recomputing it — cannot reconstruct which run moved from the
   * derived verdict alone. The grid-level reports need no equivalent field
   * because their reference is the incumbent, archived once per ablation as
   * `baselineRepeatedMeasurements`.
   */
  twinRepeatedMeasurements: ListenRoundTwoRepeatedMeasurement[];
}

/* ------------------------------------------------------------------------- *
 * The frozen artifact
 * ------------------------------------------------------------------------- */

export interface ListenRoundTwoAblationResult {
  name: "listen-round-two-ablation";
  formatVersion: 1;
  generatorVersion: number;
  selectionPolicy: {
    version: number;
    hash: string;
    activeTargetRefinementPoints: number[];
    targetNoteRefinementPoints: number[];
    bassOnsetPoints: number[];
  };
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
  };
  repeatedChordCensus: ListenRoundTwoRepeatedGroup[];
  task22LimitingUpperVoiceEvidence: {
    frozenThreeRunMinimum: number;
    measuredByRun: Array<{ traceId: string; value: number | null }>;
    measuredMinimum: number | null;
  };
  ablations: ListenRoundTwoAblationRecord[];
  terminalOutcome: ListenRoundTwoTerminalOutcome;
  terminalOutcomeReason: string;
  productionThresholdShapeChanged: boolean;
  productionThresholdShapeExcludesBassAxis: boolean;
  roundOneGeneratorUntouched: boolean;
  digest: {
    algorithm: "fnv1a-32-canonical-json";
    /** Reported in full, excluded from the digest: see the constant's comment. */
    processLocalFieldsExcluded: readonly string[];
    value: string;
  };
}

/**
 * Raw decoder confidences, which two fresh browser processes do not reproduce to
 * their last bits.
 *
 * They are reported because a repeated-chord diagnosis is unreadable without
 * them, and they are excluded from the digest because the digest identifies the
 * decision this round made. Two repetitions of this command differ on these
 * fields by about 1e-5 and agree on every safety verdict, every selected
 * profile, every source distance, every delay, and every stop verdict; a digest
 * that moved with the noise would say the opposite.
 */
export const LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS: readonly string[] = Object.freeze([
  "lowestLimitingUpperVoiceEvidence",
  "onsetConfidence",
  "targetEvidence",
  "task22LimitingUpperVoiceEvidence",
  "transitionLowestLimitingUpperVoiceEvidence",
]);

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

function canonicalDigest(value: unknown): string {
  const hasher = new DeterministicHasher();
  hasher.text(
    canonicalJson(value, new Set(LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS)),
    false,
  );
  return hasher.digest;
}

/**
 * Proves, rather than asserts in prose, that the production threshold shape has
 * not gained the experimental axis.
 *
 * `ListenMatcherThresholds` is a compile-time type, so the runtime check is the
 * one that matters: no registry profile may carry the field, the production
 * projection may not emit it, and the single production conversion may not put
 * it into matcher options.
 */
export function listenProductionThresholdShapeExcludesBassAxis(
  profiles: Readonly<Record<string, ListenMatcherThresholds>> = LISTEN_MATCHER_PROFILES,
): boolean {
  return LISTEN_MATCHER_PROFILE_IDS.every((id) => {
    const profile = profiles[id];
    if (profile === undefined) throw new Error(`The registry has no profile ${id}.`);
    return !Object.prototype.hasOwnProperty.call(profile, "bassOnsetThreshold") &&
      !Object.prototype.hasOwnProperty.call(
        listenMatcherThresholds(profile),
        "bassOnsetThreshold",
      ) &&
      !Object.prototype.hasOwnProperty.call(
        matcherOptionsForListenMatcherProfile(id),
        "bassOnsetThreshold",
      );
  });
}

/* ------------------------------------------------------------------------- *
 * Staging
 * ------------------------------------------------------------------------- */

function profileById(
  grid: readonly ListenRoundTwoSweepProfile[],
): Map<string, ListenRoundTwoSweepProfile> {
  return new Map(grid.map((profile) => [profile.id, profile]));
}

function regretByProfile(
  regret: ListenDomainRegretControlResult,
): Map<string, number> {
  return new Map(regret.candidates.map(({ profileId, worstDomainRegret }) => (
    [profileId, worstDomainRegret]
  )));
}

function highOnsetRow(
  candidate: ListenMultiDomainProfileResult,
  regret: ReadonlyMap<string, number>,
): ListenRoundTwoHighOnsetRow {
  return {
    profileId: candidate.profile.id,
    onsetThreshold: candidate.profile.onsetThreshold,
    targetNoteThreshold: candidate.profile.targetNoteThreshold,
    activeTargetThreshold: candidate.profile.activeTargetThreshold,
    extraNoteThreshold: candidate.profile.extraNoteThreshold,
    safe: candidate.safety.passed,
    rejectionReasons: [...candidate.safety.rejectionReasons],
    worstDomainIndependentRate: candidate.metrics.worstDomainIndependentRate,
    equalDomainIndependentRate: candidate.metrics.equalDomainIndependentRate,
    worstDomainRegret: regret.get(candidate.profile.id) ?? null,
  };
}

async function measureRepeatedGroups(options: {
  groups: readonly ListenRoundTwoRepeatedGroup[];
  captures: ReadonlyMap<string, ListenMultiDomainCapture>;
  profileId: string;
  profile: ListenExperimentalBassOnsetThresholds;
}): Promise<Map<string, ListenRoundTwoRepeatedMeasurement>> {
  const measurements = new Map<string, ListenRoundTwoRepeatedMeasurement>();
  for (const group of options.groups) {
    const capture = options.captures.get(group.traceId);
    if (!capture) {
      throw new Error(`${group.groupId} was never captured, so its recovery cannot be measured.`);
    }
    measurements.set(group.groupId, listenRoundTwoRepeatedMeasurement({
      group,
      capture,
      profileId: options.profileId,
      profile: options.profile,
    }));
    // The repeated-chord replays are the only place a long trace is replayed
    // twice per profile, so the loop yields rather than blocking the page.
    await Promise.resolve();
  }
  return measurements;
}

function compactDomainRegret(
  regret: ListenDomainRegretControlResult,
  sweep: ListenMultiDomainSweepResult,
): ListenRoundTwoDomainRegretRecord {
  const regretById = new Map(regret.candidates.map((candidate) => (
    [candidate.profileId, candidate]
  )));
  const decisionIds = new Set([
    regret.baselineProfileId,
    regret.bestGlobal.profileId,
    ...regret.selectedProfileIds,
  ]);
  return {
    policyVersion: regret.policyVersion,
    policyHash: regret.policyHash,
    baselineProfileId: regret.baselineProfileId,
    safeProfileCount: regret.safeProfileCount,
    domainCount: regret.domainCount,
    decisionBoundary: regret.decisionBoundary,
    materialBoundary: regret.materialBoundary,
    maximumCandidateCount: regret.maximumCandidateCount,
    verdict: regret.verdict,
    oracles: regret.oracles,
    bestGlobal: regret.bestGlobal,
    bestGlobalTieProfileIds: [...regret.bestGlobalTieProfileIds],
    selectedProfileIds: [...regret.selectedProfileIds],
    selectedEnvelope: regret.selectedEnvelope,
    measurementResolution: regret.measurementResolution,
    decisionRows: regret.candidates.filter(({ profileId }) => decisionIds.has(profileId)),
    gridRows: sweep.candidates.map((candidate): ListenRoundTwoGridRow => ({
      profileId: candidate.profile.id,
      safe: candidate.safety.passed,
      rejectionCodes: [...candidate.safety.rejectionReasons],
      worstDomainRegret: regretById.get(candidate.profile.id)?.worstDomainRegret ?? null,
      worstDomainIndependentRate: candidate.metrics.worstDomainIndependentRate,
      equalDomainIndependentRate: candidate.metrics.equalDomainIndependentRate,
    })),
  };
}

export interface ListenRoundTwoAblationOptions {
  capture: ListenMultiDomainCaptureFn;
  manifest?: ListenTraceManifest;
  onProgress?: (completed: number, total: number, label: string) => void;
  /**
   * Test seam only. The default is the frozen generator, and a record built from
   * anything else marks itself `gridIsFrozenGenerator: false`.
   */
  gridForAblation?: (ablation: ListenRoundTwoAblationId) => ListenRoundTwoSweepProfile[];
}

async function runAblation(options: ListenRoundTwoAblationOptions & {
  ablation: ListenRoundTwoAblationId;
  ranBecause: string;
  groups: readonly ListenRoundTwoRepeatedGroup[];
}): Promise<{
  record: ListenRoundTwoAblationRecord;
  baselineMeasurements: Map<string, ListenRoundTwoRepeatedMeasurement>;
}> {
  const frozen = listenRoundTwoAblationGrid(options.ablation);
  const profiles = options.gridForAblation?.(options.ablation) ?? frozen.profiles;
  const gridIsFrozenGenerator = profiles.length === frozen.profiles.length &&
    profiles.every((profile, index) => profile.id === frozen.profiles[index].id);
  const captures = new Map<string, ListenMultiDomainCapture>();
  const retainedTraceIds = new Set(options.groups.map(({ traceId }) => traceId));
  const sweep = await evaluateListenMatcherMultiDomainSweep({
    manifest: options.manifest,
    profiles,
    onProgress: (completed, total, label) => options.onProgress?.(
      completed,
      total,
      `${options.ablation} · ${label}`,
    ),
    capture: async (descriptor) => {
      const capture = await options.capture(descriptor);
      // Only the repeated-chord traces are held past their replay; the corpus
      // is far too large to retain, which is why the sweep releases the rest.
      if (retainedTraceIds.has(descriptor.id)) captures.set(descriptor.id, capture);
      return capture;
    },
  });
  const missing = [...retainedTraceIds].filter((traceId) => !captures.has(traceId));
  if (missing.length > 0) {
    throw new Error(`The repeated-chord census names uncaptured traces: ${missing.join(", ")}`);
  }
  const domainRegret = evaluateListenDomainRegret({
    baselineProfileId: sweep.baseline.profile.id,
    candidates: sweep.candidates.map((candidate) => listenDomainCandidateFromLeafMetrics({
      profile: candidate.profile,
      safe: candidate.safety.passed,
      metrics: candidate.metrics,
      leafDomains: candidate.leafDomains,
    })),
  });
  const byId = profileById(profiles);
  const baselineProfile = byId.get(sweep.baseline.profile.id);
  if (!baselineProfile) throw new Error("The staged grid lost its baseline profile.");
  const baselineMeasurements = await measureRepeatedGroups({
    groups: options.groups,
    captures,
    profileId: LISTEN_BASELINE_PROFILE_ID,
    profile: baselineProfile,
  });
  const repeatedRecovery: ListenRoundTwoRepeatedProfileReport[] = [];
  const repeatedRecoveryByProfile = new Map<string, ListenRepeatedRecoveryEvaluation>();
  for (const profileId of domainRegret.selectedProfileIds) {
    const profile = byId.get(profileId);
    if (!profile) throw new Error(`The staged grid lost selected profile ${profileId}.`);
    const measurements = await measureRepeatedGroups({
      groups: options.groups,
      captures,
      profileId,
      profile,
    });
    const report = listenRoundTwoRepeatedProfileReport({
      groups: options.groups,
      reference: baselineMeasurements,
      candidate: measurements,
      profileId,
      comparedAgainstProfileId: LISTEN_BASELINE_PROFILE_ID,
    });
    repeatedRecovery.push(report);
    repeatedRecoveryByProfile.set(profileId, report.evaluation);
  }
  const stop = evaluateListenAblationStop({
    selectedProfileIds: domainRegret.selectedProfileIds,
    repeatedRecoveryByProfile,
  });
  const regret = regretByProfile(domainRegret);
  const activeTargetGridFloor = Math.min(...profiles.map(({ activeTargetThreshold }) => (
    activeTargetThreshold
  )));
  const straddlesTask22Minimum = activeTargetGridFloor <
    LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM;
  const record: ListenRoundTwoAblationRecord = {
    ablation: options.ablation,
    ranBecause: options.ranBecause,
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    gridVersion: frozen.gridVersion,
    gridSize: profiles.length,
    gridIsFrozenGenerator,
    bassAxisPresent: profiles.some(({ bassOnsetThreshold }) => bassOnsetThreshold !== null),
    bassOnsetThresholds: [...new Set(profiles.flatMap(({ bassOnsetThreshold }) => (
      bassOnsetThreshold === null ? [] : [bassOnsetThreshold]
    )))].sort((left, right) => left - right),
    manifest: sweep.manifest,
    capturedTraceCount: sweep.captures.length,
    confirmationTraceCountRead: 0,
    safeProfileCount: domainRegret.safeProfileCount,
    profilesRejectedBySafety: sweep.profilesRejectedBySafety,
    domainRegret: compactDomainRegret(domainRegret, sweep),
    rejectionCounts: [...sweep.candidates
      .flatMap(({ safety }) => safety.rejectionReasons)
      .reduce(
        (counts, reason) => counts.set(reason, (counts.get(reason) ?? 0) + 1),
        new Map<string, number>(),
      )]
      .map(([reason, profileCount]) => ({ reason, profileCount }))
      .sort((left, right) => left.reason.localeCompare(right.reason)),
    selectedProfileIds: [...domainRegret.selectedProfileIds],
    selectionJudgement: "discovery-safe-and-search-selected",
    repeatedRecovery,
    baselineRepeatedMeasurements: options.groups.flatMap((group) => {
      const measurement = baselineMeasurements.get(group.groupId);
      return measurement === undefined ? [] : [measurement];
    }),
    stop,
    sourceDistanceZeroRoute: {
      activeTargetGridFloor,
      task22LimitingMinimum: LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
      straddlesTask22Minimum,
      statement: straddlesTask22Minimum
        ? "This grid's active-target floor is below Task 22's three-run limiting minimum, so " +
          "source distance 0 through the existing scalar family is tested here."
        : "This grid's active-target floor is above Task 22's three-run limiting minimum, so " +
          "source distance 0 through the existing scalar family is untested by this ablation.",
    },
  };
  if (options.ablation === "ablation-1-round-one-grid") {
    const archived = new Map(LISTEN_ARCHIVED_DISCOVERY_VERDICTS.map((verdict) => (
      [verdict.profileId, verdict]
    )));
    record.highOnsetSurvivors = sweep.candidates
      .filter((candidate) => (
        candidate.safety.passed &&
        candidate.profile.onsetThreshold === LISTEN_MATCHER_PROFILES["baseline-v1"].onsetThreshold
      ))
      .map((candidate) => highOnsetRow(candidate, regret));
    record.roundOneCounterfactuals = sweep.candidates
      .filter((candidate) => archived.has(candidate.profile.id))
      .map((candidate): ListenRoundTwoCounterfactualRow => {
        const verdict = archived.get(candidate.profile.id)!;
        return {
          ...highOnsetRow(candidate, regret),
          archivedRoundOnePassed: verdict.passed,
          archivedRoundOneRejectionCodes: [...verdict.rejectionCodes],
          agreesWithRoundOneSafety: verdict.passed === candidate.safety.passed,
        };
      });
  }
  if (options.ablation === "ablation-3-bass-axis") {
    record.matchedPairs = await bassPairRecords({
      sweep,
      domainRegret,
      profiles,
      groups: options.groups,
      captures,
      stopSatisfied: stop.satisfied,
    });
  }
  return { record, baselineMeasurements };
}

async function bassPairRecords(options: {
  sweep: ListenMultiDomainSweepResult;
  domainRegret: ListenDomainRegretControlResult;
  profiles: readonly ListenRoundTwoSweepProfile[];
  groups: readonly ListenRoundTwoRepeatedGroup[];
  captures: ReadonlyMap<string, ListenMultiDomainCapture>;
  stopSatisfied: boolean;
}): Promise<ListenRoundTwoBassPairRecord[]> {
  const byId = profileById(options.profiles);
  const safety = new Map(options.sweep.candidates.map((candidate) => (
    [candidate.profile.id, candidate.safety.passed]
  )));
  const regret = regretByProfile(options.domainRegret);
  const selected = new Set(options.domainRegret.selectedProfileIds);
  const records: ListenRoundTwoBassPairRecord[] = [];
  for (const profileId of options.domainRegret.selectedProfileIds) {
    const axis = byId.get(profileId);
    if (!axis || axis.bassOnsetThreshold === null || axis.matchedTwinProfileId === null) continue;
    const twin = byId.get(axis.matchedTwinProfileId);
    if (!twin) throw new Error(`${axis.id} names a twin its own grid does not contain.`);
    const twinMeasurements = await measureRepeatedGroups({
      groups: options.groups,
      captures: options.captures,
      profileId: twin.id,
      profile: twin,
    });
    const axisMeasurements = await measureRepeatedGroups({
      groups: options.groups,
      captures: options.captures,
      profileId: axis.id,
      profile: axis,
    });
    const report = listenRoundTwoRepeatedProfileReport({
      groups: options.groups,
      reference: twinMeasurements,
      candidate: axisMeasurements,
      profileId: axis.id,
      comparedAgainstProfileId: twin.id,
    });
    const axisSafe = safety.get(axis.id) ?? false;
    const twinSafe = safety.get(twin.id) ?? false;
    const axisWorstDomainRegret = regret.get(axis.id) ?? null;
    const twinWorstDomainRegret = regret.get(twin.id) ?? null;
    records.push({
      axisProfileId: axis.id,
      twinProfileId: twin.id,
      bassOnsetThreshold: axis.bassOnsetThreshold,
      onsetThreshold: axis.onsetThreshold,
      axisSelected: selected.has(axis.id),
      axisSafe,
      twinSafe,
      axisWorstDomainRegret,
      twinWorstDomainRegret,
      support: evaluateListenBassAxisPairSupport({
        ablationStopSatisfied: options.stopSatisfied,
        axisProfileSelected: selected.has(axis.id),
        axisSafe,
        twinSafe,
        axisWorstDomainRegret: axisWorstDomainRegret ?? 0,
        // An unsafe twin has no comparable regret row, so the pair may claim no
        // regret gain from it; the categorical safety rescue is what carries
        // that case, and it is evaluated separately.
        twinWorstDomainRegret: twinWorstDomainRegret ?? axisWorstDomainRegret ?? 0,
        repeatedRecoveryAgainstTwin: report.evaluation,
      }),
      repeatedRecoveryAgainstTwin: report,
      twinRepeatedMeasurements: options.groups.flatMap((group) => {
        const measurement = twinMeasurements.get(group.groupId);
        return measurement === undefined ? [] : [measurement];
      }),
    });
  }
  return records;
}

/** The staged facts one terminal outcome is decided from, and nothing else. */
export interface ListenRoundTwoAblationTransition {
  ablation: ListenRoundTwoAblationId;
  stop: ListenAblationStopResult;
  matchedPairs?: readonly { support: ListenBassAxisPairSupportResult }[];
}

/**
 * The single terminal outcome, reached only by the frozen transitions.
 *
 * An ablation whose predecessor satisfied the stop rule was never authorised, so
 * finding its record here is an error rather than extra evidence; a missing
 * successor after a failed stop rule is equally an error, because the outcome
 * would then be read off an ablation that never ran.
 */
export function listenRoundTwoTerminalOutcome(
  records: readonly ListenRoundTwoAblationTransition[],
): { outcome: ListenRoundTwoTerminalOutcome; reason: string } {
  const first = records.find(({ ablation }) => ablation === "ablation-1-round-one-grid");
  const second = records.find(({ ablation }) => ablation === "ablation-2-refined-family");
  const third = records.find(({ ablation }) => ablation === "ablation-3-bass-axis");
  if (!first) throw new Error("Task 26 recorded no first ablation.");
  if (records.length !== new Set(records.map(({ ablation }) => ablation)).size) {
    throw new Error("Task 26 recorded the same ablation twice.");
  }
  if (first.stop.satisfied && (second || third)) {
    throw new Error("Ablation one satisfied the stop rule, so no further ablation was authorised.");
  }
  if (second?.stop.satisfied && third) {
    throw new Error("Ablation two satisfied the stop rule, so ablation three was not authorised.");
  }
  if (first.stop.satisfied) {
    return {
      outcome: "existing-grid-sufficient",
      reason: "Ablation one satisfied the frozen stop rule on the version-2 corpus.",
    };
  }
  if (!second) throw new Error("Ablation one failed the stop rule but ablation two did not run.");
  if (second.stop.satisfied) {
    return {
      outcome: "existing-family-refinement-sufficient",
      reason: "The refined existing five-axis family satisfied the frozen stop rule; " +
        "no new axis was required.",
    };
  }
  if (!third) throw new Error("Ablation two failed the stop rule but ablation three did not run.");
  const supported = (third.matchedPairs ?? []).filter(({ support }) => support.supported);
  if (third.stop.satisfied && supported.length > 0) {
    return {
      outcome: "bass-axis-supported",
      reason: `The bass grid cleared the stop rule and ${supported.length} selected bass ` +
        "profile(s) separated from their own matched compatibility-default twin.",
    };
  }
  return {
    outcome: "bass-axis-unsupported",
    reason: third.stop.satisfied
      ? "The bass grid cleared the stop rule, but no selected bass profile separated from its " +
        "own matched twin, so every selected profile needs an axis this outcome prohibits."
      : `The bass grid failed the stop rule (${third.stop.reasons.join(", ")}), so nothing was ` +
        "selected that could be registered and confirmed.",
  };
}

/**
 * Runs the staged ablations in order and freezes one digest-bearing record of
 * every ablation that ran.
 *
 * Ablation two runs only when ablation one's recorded stop verdict authorises
 * it, and ablation three only when ablation two's does. Task 26 does not choose
 * between the two reachable reasons after seeing a result: the frozen rule
 * covers both, and the reason it reports is copied from the stop result.
 */
export async function evaluateListenRoundTwoAblations(
  options: ListenRoundTwoAblationOptions,
): Promise<ListenRoundTwoAblationResult> {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const groups = listenRoundTwoRepeatedGroups();
  const records: ListenRoundTwoAblationRecord[] = [];
  let baselineMeasurements = new Map<string, ListenRoundTwoRepeatedMeasurement>();
  let ranBecause = "Task 26 always runs ablation one: the unchanged round-one grid against the " +
    "version-2 corpus and the Task 23 policy.";
  for (const ablation of LISTEN_ROUND_TWO_ABLATION_IDS) {
    const staged = await runAblation({ ...options, manifest, ablation, ranBecause, groups });
    records.push(staged.record);
    if (ablation === "ablation-1-round-one-grid") {
      baselineMeasurements = staged.baselineMeasurements;
    }
    if (!staged.record.stop.runNextAblation) break;
    ranBecause = `Authorised by ${ablation}: the frozen stop rule reported ` +
      `${staged.record.stop.reasons.join(", ")}.`;
  }
  const { outcome, reason: terminalReason } = listenRoundTwoTerminalOutcome(records);
  const excludesAxis = listenProductionThresholdShapeExcludesBassAxis();
  if (outcome !== "bass-axis-supported" && !excludesAxis) {
    throw new Error(
      "The production threshold shape carries the bass axis under an outcome that prohibits it.",
    );
  }
  const measuredByRun = groups.map((group) => ({
    traceId: group.traceId,
    value: baselineMeasurements.get(group.groupId)
      ?.transitionLowestLimitingUpperVoiceEvidence ?? null,
  }));
  const measuredValues = measuredByRun.flatMap(({ value }) => value === null ? [] : [value]);
  const artifact = {
    name: "listen-round-two-ablation" as const,
    formatVersion: 1 as const,
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    selectionPolicy: {
      version: LISTEN_MATCHER_SELECTION_POLICY.version,
      hash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
      activeTargetRefinementPoints: [
        ...LISTEN_MATCHER_SELECTION_POLICY.activeTargetRefinement.points,
      ],
      targetNoteRefinementPoints: [...LISTEN_ROUND_TWO_TARGET_REFINEMENT_POINTS],
      bassOnsetPoints: [...LISTEN_ROUND_TWO_BASS_ONSET_POINTS],
    },
    manifest: {
      version: records[0].manifest.version,
      hash: records[0].manifest.hash,
      corpusHash: records[0].manifest.corpusHash,
    },
    repeatedChordCensus: groups,
    task22LimitingUpperVoiceEvidence: {
      frozenThreeRunMinimum: LISTEN_TASK22_LIMITING_UPPER_VOICE_EVIDENCE_MINIMUM,
      measuredByRun,
      measuredMinimum: measuredValues.length === 0 ? null : Math.min(...measuredValues),
    },
    ablations: records,
    terminalOutcome: outcome,
    terminalOutcomeReason: terminalReason,
    // Derived from the runtime check, never asserted: under an outcome that
    // prohibits the axis the guard above has already thrown, and under
    // `bass-axis-supported` this reports whether the production edit the outcome
    // authorises has actually been made yet.
    productionThresholdShapeChanged: !excludesAxis,
    productionThresholdShapeExcludesBassAxis: excludesAxis,
    // `listenRoundTwoAblationGrid` throws unless ablation one is exactly the
    // immutable 1,000-row round-one grid, coordinate for coordinate, so reaching
    // this line with that grid staged is the check rather than the claim.
    roundOneGeneratorUntouched:
      listenRoundTwoAblationGrid("ablation-1-round-one-grid").gridSize === 1_000,
  };
  return {
    ...artifact,
    digest: {
      algorithm: "fnv1a-32-canonical-json",
      processLocalFieldsExcluded: LISTEN_ROUND_TWO_PROCESS_LOCAL_DIGEST_FIELDS,
      value: canonicalDigest(artifact),
    },
  };
}

/** Runs the staged ablations in the browser against one inference session. */
export function runListenRoundTwoAblations(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenRoundTwoAblationResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenRoundTwoAblations({
    capture: (descriptor) => captureListenMultiDomainTrace(descriptor, session),
    onProgress,
  }));
}
