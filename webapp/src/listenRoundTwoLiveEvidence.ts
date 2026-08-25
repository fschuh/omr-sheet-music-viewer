/**
 * Task 15's live corpus as evidence, and the live gates rederived from it.
 *
 * A live archive holds the performance, not a verdict about it. Each trial
 * carries the authored score it was played against — target pitches, the
 * deliberately played notes of every attack, score position, chord size, register,
 * dynamic, articulation, tempo, ambiguity, and the safety reason a negative trial
 * exists for — and the target-independent decoded recognition trace the harness
 * captured once. Every profile column is then *replayed* over that one trace
 * here, and an archived outcome that the replay does not reproduce is refused.
 * That is what makes the digest mean something: it authenticates the performance
 * evidence, and the outcomes are recomputed from it rather than believed.
 *
 * A live gate outcome is a measurement, not a status somebody typed. The decision
 * task therefore never accepts `{profileId, status: "passed"}` from a caller:
 * every candidate's live result is recomputed here from the archived acoustic and
 * digital trials, per setup, per trial, and per counter, and a candidate with no
 * archive covering it is `not-collected` rather than unjudged.
 *
 * The archive is bound to the round it belongs to. It carries the digest of the
 * eligibility manifest whose candidates it replayed, so a corpus collected against
 * a different confirmation — or against profiles the automated matrix never
 * cleared — cannot be quoted as this round's live evidence.
 *
 * Nothing is aggregated across setups. The release decision must report acoustic
 * and digital results separately, because a large digital-piano gain cannot hide
 * an acoustic-piano safety failure, so safety and correctness are decided per
 * trial and reported per setup, and every failure names the setup, the trial, the
 * counter, and both measured values.
 */

import {
  LISTEN_REPEATED_DELAY_NO_REGRESSION_MS,
  LISTEN_REPEATED_SOURCE_DISTANCE_NO_REGRESSION,
} from "./listenMatcherSelectionPolicy";
import {
  LISTEN_MATCHER_PROFILES,
  isListenMatcherProfileId,
  listenMatcherThresholds,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import { listenRepeatedChordRecoveries, observeListenSequenceQualification }
  from "./listenBassQualification";
import { listenRoundTwoAttributedRecoverySpan } from "./listenRoundTwoAblationBenchmark";
import {
  materializeListenSequence,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceDefinition,
} from "./listenSequenceBenchmark";
import type {
  ListenBenchmarkAudioDiagnostics,
  ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import { DeterministicHasher } from "./listenTraceManifest";
import type { ListenRoundTwoEligibilityManifest } from "./listenRoundTwoEligibilityManifest";

export const LISTEN_ROUND_TWO_LIVE_ARCHIVE_NAME = "listen-round-two-live-corpus" as const;

/** The incumbent column every live trial must carry beside the candidates. */
export const LISTEN_LIVE_BASELINE_PROFILE_ID = "baseline-v1" as const;

/**
 * The instrument sources Task 15 distinguishes, and the two families the corpus
 * must both cover.
 *
 * The family, not the source, is what "at least one acoustic piano and one
 * digital piano" means: two digital setups differing only in whether they were
 * recorded through speakers or a line output are not an acoustic setup.
 */
export const LISTEN_LIVE_SOURCE_KINDS = Object.freeze([
  "acoustic-piano",
  "digital-piano-speakers",
  "digital-line-output",
] as const);

export type ListenLiveSourceKind = typeof LISTEN_LIVE_SOURCE_KINDS[number];
export type ListenLiveSourceFamily = "acoustic" | "digital";

export const LISTEN_LIVE_SOURCE_FAMILIES:
  Readonly<Record<ListenLiveSourceKind, ListenLiveSourceFamily>> = Object.freeze({
    "acoustic-piano": "acoustic",
    "digital-piano-speakers": "digital",
    "digital-line-output": "digital",
  });

export const LISTEN_LIVE_REQUIRED_SOURCE_FAMILIES:
  readonly ListenLiveSourceFamily[] = Object.freeze(["acoustic", "digital"]);

/**
 * The trial classes every setup has to contain, taken from Task 15's corpus.
 *
 * They are required per setup rather than per corpus: a wrong-note trial played
 * only on the digital piano says nothing about whether the candidate refuses a
 * wrong note on the acoustic one, which is exactly the substitution the
 * source-separated reporting rule exists to prevent.
 */
export const LISTEN_LIVE_REQUIRED_TRIAL_CLASSES = Object.freeze([
  "single-note",
  "chord",
  "repeated-chord",
  "wrong-note",
  "wrong-chord-member",
  "added-note",
  "omitted-bass",
  "silence-noise",
] as const);

export type ListenLiveTrialClass = typeof LISTEN_LIVE_REQUIRED_TRIAL_CLASSES[number];

/**
 * The classes on which any advance is a failure at any rate.
 *
 * These are the live counterparts of the dedicated automated safety fixtures:
 * the performance deliberately does not contain the target, so an advance is
 * never a recognition win to be traded against one elsewhere.
 */
export const LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES: readonly ListenLiveTrialClass[] = Object.freeze([
  "wrong-note",
  "wrong-chord-member",
  "added-note",
  "omitted-bass",
  "silence-noise",
]);

/** The four counters compared per trial. None may be netted against another. */
export const LISTEN_LIVE_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvanceCount",
] as const);

export type ListenLiveUnsafeCounter = typeof LISTEN_LIVE_UNSAFE_COUNTERS[number];

/**
 * One decoder hop, the same step the automated latency gate allows.
 *
 * A live latency comparison is per trial rather than per percentile, because a
 * live corpus is far too small for a percentile to mean anything.
 */
export const LISTEN_LIVE_LATENCY_REGRESSION_TOLERANCE_MS = 32;

export const LISTEN_LIVE_GATE_CODES = Object.freeze([
  "live-coverage",
  "live-safety",
  "live-correctness",
  "live-repeated-recovery",
  "live-latency",
] as const);

export type ListenLiveGateCode = typeof LISTEN_LIVE_GATE_CODES[number];

/** What one profile column decided on one captured performance. */
export interface ListenLiveTrialOutcome {
  profileId: string;
  advanced: boolean;
  /** True only when the trial's expected content advanced the playhead. */
  correctAdvance: boolean;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  incompleteCarriedBassAdvanceCount: number;
  /** Null when the column did not advance, so there is no onset-to-advance span. */
  latencyMs: number | null;
  /**
   * Task 24's repeated-chord vocabulary, required on `repeated-chord` trials and
   * forbidden elsewhere. Both fields are present or absent together, because a
   * distance without its delay is half a measurement.
   */
  repeatedRecovery: { sourceDistance: number | null; attributionDelayMs: number | null } | null;
}

/** The register bands, dynamics, and articulations Task 15's corpus spans. */
export const LISTEN_LIVE_REGISTER_BANDS = Object.freeze(["low", "middle", "high"] as const);
export const LISTEN_LIVE_DYNAMICS = Object.freeze(["soft", "medium", "loud"] as const);
export const LISTEN_LIVE_ARTICULATIONS =
  Object.freeze(["detached", "normal", "legato"] as const);
export const LISTEN_LIVE_AMBIGUITY_CLASSES =
  Object.freeze(["distinguishable", "mathematically-ambiguous"] as const);

/**
 * The metadata Task 15 requires beside the performance.
 *
 * None of it is a verdict; all of it is what the trial *was*. The target and
 * played pitches live in the authored sequence rather than being restated here,
 * because restating them would create a second, unchecked copy of the score.
 */
export interface ListenLiveTrialMusicalContext {
  /** The score index the trial's first target sits at. */
  scorePosition: number;
  chordSize: number;
  registerBand: typeof LISTEN_LIVE_REGISTER_BANDS[number];
  dynamic: typeof LISTEN_LIVE_DYNAMICS[number];
  articulation: typeof LISTEN_LIVE_ARTICULATIONS[number];
  /** The played interval, null for a trial with no tempo (a single attack). */
  tempoIntervalMs: number | null;
  ambiguity: typeof LISTEN_LIVE_AMBIGUITY_CLASSES[number];
  /** Required on the negative classes, forbidden elsewhere. */
  safetyReason: string | null;
  /** Required on `repeated-chord`, forbidden elsewhere. */
  repeatedChordPitches: readonly number[] | null;
}

/**
 * The decoded recognition trace, captured once and replayed by every column.
 *
 * There is one per trial rather than one per column, which is the harness rule
 * made structural: a player is never asked to repeat a passage per profile, and a
 * per-column trace would let two columns be compared over two performances.
 * `pcm` is deliberately absent — the export carries decoded events and
 * confidences only, and the application's promise is that microphone audio is
 * neither saved nor transmitted.
 */
export interface ListenLiveDecodedTrace {
  sampleRate: number;
  chunkSize: number;
  relevantPitches: readonly number[];
  renderer: ListenBenchmarkRendererConfiguration;
  audioDiagnostics: ListenBenchmarkAudioDiagnostics;
  maximumInferenceMs: number;
  frames: readonly ListenRecognitionFrame[];
}

export interface ListenLiveTrial {
  trialId: string;
  sessionId: string;
  trialClass: ListenLiveTrialClass;
  /**
   * Whether the performance contains the target the playhead is waiting for.
   *
   * It is not free: it must agree with the trial class, so a positive trial
   * cannot be relabelled negative to slip past the correctness gate, and a
   * negative one cannot be relabelled positive to excuse an advance.
   */
  expectedCorrect: boolean;
  musical: ListenLiveTrialMusicalContext;
  /** The played interval the score was materialized at. */
  intervalMs: number;
  /** The authored score: targets, and the notes each attack actually played. */
  sequence: ListenSequenceDefinition;
  decodedTrace: ListenLiveDecodedTrace;
  outcomes: readonly ListenLiveTrialOutcome[];
}

export interface ListenLiveSetup {
  setupId: string;
  source: ListenLiveSourceKind;
  instrumentLabel: string;
  microphoneLabel: string;
  roomLabel: string;
  trials: readonly ListenLiveTrial[];
}

/**
 * One archived live session, redacted to decoded outcomes and metadata.
 *
 * `profileIds` is the column list the session replayed, and it is checked against
 * the eligibility manifest rather than trusted: a corpus that replayed a profile
 * the automated matrix rejected has measured something, but not something that
 * can approve it.
 */
export interface ListenRoundTwoLiveArchive {
  name: typeof LISTEN_ROUND_TWO_LIVE_ARCHIVE_NAME;
  formatVersion: 1;
  roundId: "round-two";
  eligibilityManifestDigest: string;
  baselineProfileId: typeof LISTEN_LIVE_BASELINE_PROFILE_ID;
  profileIds: readonly string[];
  setups: readonly ListenLiveSetup[];
  digest: { algorithm: "fnv1a-32-canonical-json"; value: string };
}

export const LISTEN_LIVE_ARCHIVE_KEYS: readonly string[] = Object.freeze([
  "name",
  "formatVersion",
  "roundId",
  "eligibilityManifestDigest",
  "baselineProfileId",
  "profileIds",
  "setups",
  "digest",
]);

export const LISTEN_LIVE_SETUP_KEYS: readonly string[] = Object.freeze([
  "setupId",
  "source",
  "instrumentLabel",
  "microphoneLabel",
  "roomLabel",
  "trials",
]);

export const LISTEN_LIVE_TRIAL_KEYS: readonly string[] = Object.freeze([
  "trialId",
  "sessionId",
  "trialClass",
  "expectedCorrect",
  "musical",
  "intervalMs",
  "sequence",
  "decodedTrace",
  "outcomes",
]);

export const LISTEN_LIVE_MUSICAL_KEYS: readonly string[] = Object.freeze([
  "scorePosition",
  "chordSize",
  "registerBand",
  "dynamic",
  "articulation",
  "tempoIntervalMs",
  "ambiguity",
  "safetyReason",
  "repeatedChordPitches",
]);

export const LISTEN_LIVE_TRACE_KEYS: readonly string[] = Object.freeze([
  "sampleRate",
  "chunkSize",
  "relevantPitches",
  "renderer",
  "audioDiagnostics",
  "maximumInferenceMs",
  "frames",
]);

export const LISTEN_LIVE_OUTCOME_KEYS: readonly string[] = Object.freeze([
  "profileId",
  "advanced",
  "correctAdvance",
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvanceCount",
  "latencyMs",
  "repeatedRecovery",
]);

/* ------------------------------------------------------------------------- *
 * Replay: the outcomes are reproduced from the performance, never believed
 * ------------------------------------------------------------------------- */

/**
 * Replays one archived trial through one profile's thresholds.
 *
 * This is the same matcher path every automated domain replays through —
 * `observeListenSequenceQualification` over a materialized score and a decoded
 * trace — so a live trial is evidence of the same kind as an automated one, and
 * Task 15's requirement that matcher summaries be reproducible from each export
 * is satisfied by construction rather than by assertion.
 *
 * `pcm` is reconstructed as empty because replay reads frames only. That is what
 * makes a redacted export replayable: the decoded evidence is sufficient, and the
 * audio never has to leave the machine that heard it.
 */
export function listenRoundTwoLiveTrialReplay(
  trial: ListenLiveTrial,
  thresholds: ListenMatcherThresholds,
): Omit<ListenLiveTrialOutcome, "profileId"> {
  const sequence = materializeListenSequence(trial.sequence, trial.intervalMs);
  const trace: ListenRecognitionTrace = {
    sequenceId: sequence.definition.id,
    intervalMs: trial.intervalMs,
    sampleRate: trial.decodedTrace.sampleRate,
    chunkSize: trial.decodedTrace.chunkSize,
    relevantPitches: [...trial.decodedTrace.relevantPitches],
    renderer: trial.decodedTrace.renderer,
    audioDiagnostics: trial.decodedTrace.audioDiagnostics,
    pcm: new Float32Array(0),
    frames: [...trial.decodedTrace.frames],
    maximumInferenceMs: trial.decodedTrace.maximumInferenceMs,
    maximumProcessingBacklogMs: 0,
  };
  const { run, advancements } = observeListenSequenceQualification(sequence, trace, thresholds);
  // An advance credited to an attack that did not sound the target's bass, on a
  // target of three or more pitches, is the live form of the incomplete
  // carried-bass advance the authored safety fixture measures.
  const incompleteCarriedBassAdvanceCount = advancements.filter((advancement) => {
    const target = sequence.targets[advancement.targetIndex];
    const attack = advancement.sourceAttackIndex === null
      ? undefined
      : sequence.attacks[advancement.sourceAttackIndex];
    if (target === undefined || attack === undefined || target.pitches.length < 3) return false;
    return !attack.playedPitches.includes(Math.min(...target.pitches));
  }).length;
  const repeatedChordPitches = trial.musical.repeatedChordPitches;
  let repeatedRecovery: ListenLiveTrialOutcome["repeatedRecovery"] = null;
  if (repeatedChordPitches !== null) {
    const recoveries = listenRepeatedChordRecoveries(
      sequence,
      run,
      advancements,
      [...repeatedChordPitches],
    );
    const { worst } = listenRoundTwoAttributedRecoverySpan(recoveries);
    repeatedRecovery = {
      sourceDistance: worst?.sourceDistance ?? null,
      attributionDelayMs: worst?.attributionDelayMs ?? null,
    };
  }
  return {
    advanced: advancements.length > 0,
    correctAdvance: run.summary.correctAdvanceCount > 0,
    falseAdvanceCount: run.summary.falseAdvanceCount,
    skippedAdvanceCount: run.summary.skippedAdvanceCount,
    duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
    incompleteCarriedBassAdvanceCount,
    latencyMs: advancements.length > 0 ? run.summary.p50OnsetToAdvanceMs : null,
    repeatedRecovery,
  };
}

/**
 * Every archived outcome that the replay does not reproduce.
 *
 * A live archive is only evidence while its outcomes follow from its performance.
 * Comparing field by field, rather than by a digest over the outcomes, is what
 * lets the failure say which measurement was overstated.
 */
export function listenRoundTwoLiveReplayProblems(trial: ListenLiveTrial, where: string): string[] {
  const problems: string[] = [];
  for (const outcome of trial.outcomes) {
    if (!isListenMatcherProfileId(outcome.profileId)) {
      problems.push(`${where} replays ${outcome.profileId}, which is not a registry identifier.`);
      continue;
    }
    let replayed: Omit<ListenLiveTrialOutcome, "profileId">;
    try {
      replayed = listenRoundTwoLiveTrialReplay(
        trial,
        listenMatcherThresholds(LISTEN_MATCHER_PROFILES[outcome.profileId]),
      );
    } catch (error) {
      problems.push(
        `${where} cannot be replayed for ${outcome.profileId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const field of [
      "advanced",
      "correctAdvance",
      ...LISTEN_LIVE_UNSAFE_COUNTERS,
      "latencyMs",
    ] as const) {
      if (outcome[field] !== replayed[field]) {
        problems.push(
          `${where} records ${outcome.profileId} ${field} ${JSON.stringify(outcome[field])}, and ` +
            `replaying the archived trace produces ${JSON.stringify(replayed[field])}.`,
        );
      }
    }
    const stated = outcome.repeatedRecovery;
    const produced = replayed.repeatedRecovery;
    if (JSON.stringify(stated ?? null) !== JSON.stringify(produced ?? null)) {
      problems.push(
        `${where} records ${outcome.profileId} repeated recovery ` +
          `${JSON.stringify(stated)}, and replaying the archived trace produces ` +
          `${JSON.stringify(produced)}.`,
      );
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * Hashing and schema
 * ------------------------------------------------------------------------- */

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

/** The digest of a live archive, over every field except the digest. */
export function listenRoundTwoLiveArchiveDigest(record: unknown): string {
  const { digest: _digest, ...rest } = (record ?? {}) as Record<string, unknown>;
  const hasher = new DeterministicHasher();
  hasher.text(canonicalJson(rest), false);
  return hasher.digest;
}

const DIGEST_PATTERN = /^[0-9a-f]{8}$/;

function keyProblems(
  record: Record<string, unknown>,
  expected: readonly string[],
  where: string,
): string[] {
  const problems: string[] = [];
  for (const key of expected) {
    if (!Object.hasOwn(record, key)) problems.push(`${where} is missing ${key}.`);
  }
  for (const key of Object.keys(record)) {
    if (!expected.includes(key)) problems.push(`${where} carries forbidden field ${key}.`);
  }
  return problems;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function outcomeProblems(
  outcome: unknown,
  where: string,
  trialClass: ListenLiveTrialClass,
): string[] {
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) {
    return [`${where} is not a record.`];
  }
  const row = outcome as Record<string, unknown>;
  const problems = keyProblems(row, LISTEN_LIVE_OUTCOME_KEYS, where);
  if (typeof row.profileId !== "string" || row.profileId.length === 0) {
    problems.push(`${where} names no profile.`);
  }
  for (const field of ["advanced", "correctAdvance"] as const) {
    if (typeof row[field] !== "boolean") problems.push(`${where} has no ${field}.`);
  }
  for (const counter of LISTEN_LIVE_UNSAFE_COUNTERS) {
    if (!isCount(row[counter])) problems.push(`${where}'s ${counter} is not a count.`);
  }
  if (row.latencyMs !== null &&
      (typeof row.latencyMs !== "number" || !Number.isFinite(row.latencyMs) || row.latencyMs < 0)) {
    problems.push(`${where}'s latencyMs is neither null nor a duration.`);
  }
  // A latency with no advance is a row that cannot be replayed back to the trace
  // clock it claims to come from. The converse is not a fault: a false advance,
  // or one attributed to a later repetition, has no onset-to-advance span of its
  // own, and the replay reports null for exactly those.
  if (row.advanced === false && row.latencyMs !== null) {
    problems.push(`${where} did not advance and recorded a latency.`);
  }
  if (row.correctAdvance === true && row.advanced !== true) {
    problems.push(`${where} records a correct advance without advancing.`);
  }
  // Every unsafe counter counts an advance that should not have happened, so a
  // row that reports one while claiming the playhead never moved is describing
  // two different trials. Without this, a baseline row could carry a false
  // advance and still read as a clean refusal.
  for (const counter of LISTEN_LIVE_UNSAFE_COUNTERS) {
    if (isCount(row[counter]) && (row[counter] as number) > 0 && row.advanced !== true) {
      problems.push(`${where} reports ${counter} without advancing.`);
    }
  }
  const repeated = row.repeatedRecovery as
    { sourceDistance?: unknown; attributionDelayMs?: unknown } | null | undefined;
  if (trialClass === "repeated-chord") {
    if (typeof repeated !== "object" || repeated === null) {
      problems.push(`${where} is a repeated-chord trial with no repeated-recovery measurement.`);
    } else {
      const distance = repeated.sourceDistance;
      const delay = repeated.attributionDelayMs;
      if ((distance === null) !== (delay === null)) {
        problems.push(`${where} records source distance and attribution delay separately.`);
      }
      if (distance !== null && !isCount(distance)) {
        problems.push(`${where}'s source distance is not a count.`);
      }
      if (delay !== null &&
          (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0)) {
        problems.push(`${where}'s attribution delay is not a duration.`);
      }
    }
  } else if (repeated !== null) {
    problems.push(`${where} carries a repeated-recovery measurement on a ${trialClass} trial.`);
  }
  return problems;
}

function musicalContextProblems(
  value: unknown,
  where: string,
  trialClass: ListenLiveTrialClass,
): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${where} records no musical context.`];
  }
  const musical = value as Record<string, unknown>;
  const problems = keyProblems(musical, LISTEN_LIVE_MUSICAL_KEYS, `${where}'s musical context`);
  if (!Number.isInteger(musical.scorePosition) || (musical.scorePosition as number) < 0) {
    problems.push(`${where} records no score position.`);
  }
  if (!Number.isInteger(musical.chordSize) || (musical.chordSize as number) < 1) {
    problems.push(`${where} records no chord size.`);
  }
  for (const [field, vocabulary] of [
    ["registerBand", LISTEN_LIVE_REGISTER_BANDS],
    ["dynamic", LISTEN_LIVE_DYNAMICS],
    ["articulation", LISTEN_LIVE_ARTICULATIONS],
    ["ambiguity", LISTEN_LIVE_AMBIGUITY_CLASSES],
  ] as const) {
    if (!(vocabulary as readonly string[]).includes(musical[field] as string)) {
      problems.push(`${where} records ${field} ${JSON.stringify(musical[field])}.`);
    }
  }
  if (musical.tempoIntervalMs !== null &&
      (!Number.isFinite(musical.tempoIntervalMs) || (musical.tempoIntervalMs as number) <= 0)) {
    problems.push(`${where} records a tempo that is neither null nor an interval.`);
  }
  const negative = LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES.includes(trialClass);
  // A negative trial exists for a stated reason; a positive one has none to give.
  if (negative && (typeof musical.safetyReason !== "string" || musical.safetyReason.length === 0)) {
    problems.push(`${where} is a ${trialClass} trial and names no safety reason.`);
  }
  if (!negative && musical.safetyReason !== null) {
    problems.push(`${where} is a ${trialClass} trial and names a safety reason.`);
  }
  const repeated = musical.repeatedChordPitches;
  if (trialClass === "repeated-chord") {
    if (!Array.isArray(repeated) || repeated.length < 2 ||
        repeated.some((pitch) => !Number.isInteger(pitch))) {
      problems.push(`${where} is a repeated-chord trial and names no repeated chord.`);
    }
  } else if (repeated !== null) {
    problems.push(`${where} names a repeated chord on a ${trialClass} trial.`);
  }
  return problems;
}

function decodedTraceProblems(value: unknown, where: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${where} carries no decoded recognition trace.`];
  }
  const trace = value as Record<string, unknown>;
  const problems = keyProblems(trace, LISTEN_LIVE_TRACE_KEYS, `${where}'s decoded trace`);
  // The export carries decoded events and confidences only. A trace that smuggled
  // audio back in would break the promise the harness is built on.
  if (Object.hasOwn(trace, "pcm")) {
    problems.push(`${where} exports audio, which a redacted live export never carries.`);
  }
  if (!Array.isArray(trace.frames) || trace.frames.length === 0) {
    problems.push(`${where} carries a decoded trace with no frames.`);
  }
  if (!Array.isArray(trace.relevantPitches) || trace.relevantPitches.length === 0) {
    problems.push(`${where} carries a decoded trace naming no pitches.`);
  }
  for (const field of ["sampleRate", "chunkSize"] as const) {
    if (!Number.isFinite(trace[field]) || (trace[field] as number) <= 0) {
      problems.push(`${where}'s decoded trace records no ${field}.`);
    }
  }
  return problems;
}

/**
 * Everything that must be true of one archived live session.
 *
 * The binding checks come first: an archive that does not name this round's
 * eligibility manifest, or that replayed a column the automated matrix never
 * cleared, is refused before any of its measurements are read.
 */
export function listenRoundTwoLiveArchiveProblems(options: {
  archive: unknown;
  eligibilityManifestDigest: string;
  automatedEligibleProfileIds: readonly string[];
}): string[] {
  const { archive } = options;
  if (typeof archive !== "object" || archive === null || Array.isArray(archive)) {
    return ["A live archive is one record, not a list."];
  }
  const record = archive as Record<string, unknown>;
  const problems = keyProblems(record, LISTEN_LIVE_ARCHIVE_KEYS, "The live archive");
  if (record.name !== LISTEN_ROUND_TWO_LIVE_ARCHIVE_NAME) {
    problems.push(`The live archive names ${JSON.stringify(record.name)}.`);
  }
  if (record.formatVersion !== 1) {
    problems.push(`The live archive is at format version ${record.formatVersion}.`);
  }
  if (record.roundId !== "round-two") {
    problems.push(`The live archive belongs to round ${JSON.stringify(record.roundId)}.`);
  }
  if (record.eligibilityManifestDigest !== options.eligibilityManifestDigest) {
    problems.push(
      `The live archive was collected against eligibility manifest ` +
        `${JSON.stringify(record.eligibilityManifestDigest)}, and this decision concludes ` +
        `${options.eligibilityManifestDigest}.`,
    );
  }
  if (record.baselineProfileId !== LISTEN_LIVE_BASELINE_PROFILE_ID) {
    problems.push(
      `The live archive replays incumbent ${JSON.stringify(record.baselineProfileId)}.`,
    );
  }
  const profileIds = Array.isArray(record.profileIds) ? record.profileIds as string[] : null;
  if (profileIds === null) {
    problems.push("The live archive lists no profile columns.");
  } else {
    for (const profileId of profileIds) {
      if (profileId === LISTEN_LIVE_BASELINE_PROFILE_ID) continue;
      if (!options.automatedEligibleProfileIds.includes(profileId)) {
        problems.push(
          `The live archive replayed ${profileId}, which the eligibility manifest does not mark ` +
            "automated-eligible; live evidence cannot approve a profile the automated gates " +
            "rejected or never measured.",
        );
      }
    }
    if (!profileIds.includes(LISTEN_LIVE_BASELINE_PROFILE_ID)) {
      problems.push(
        `The live archive omits the ${LISTEN_LIVE_BASELINE_PROFILE_ID} column every comparison ` +
          "is made against.",
      );
    }
  }
  const digest = record.digest as { algorithm?: unknown; value?: unknown } | undefined;
  const recomputed = listenRoundTwoLiveArchiveDigest(record);
  if (digest?.algorithm !== "fnv1a-32-canonical-json") {
    problems.push(`The live archive's digest algorithm is ${digest?.algorithm}.`);
  }
  if (typeof digest?.value !== "string" || !DIGEST_PATTERN.test(digest.value)) {
    problems.push("The live archive's digest is not a digest.");
  } else if (digest.value !== recomputed) {
    problems.push(
      `The live archive records digest ${JSON.stringify(digest.value)}, recomputed ${recomputed}.`,
    );
  }

  const setups = Array.isArray(record.setups) ? record.setups : null;
  if (setups === null) {
    problems.push("The live archive holds no setup.");
    return problems;
  }
  if (setups.length === 0) problems.push("The live archive holds no setup.");
  const setupIds = new Set<string>();
  const trialIds = new Set<string>();
  for (const [index, setup] of setups.entries()) {
    const where = `Live setup ${index}`;
    if (typeof setup !== "object" || setup === null || Array.isArray(setup)) {
      problems.push(`${where} is not a record.`);
      continue;
    }
    const row = setup as Record<string, unknown>;
    problems.push(...keyProblems(row, LISTEN_LIVE_SETUP_KEYS, where));
    for (const field of ["setupId", "instrumentLabel", "microphoneLabel", "roomLabel"] as const) {
      if (typeof row[field] !== "string" || (row[field] as string).length === 0) {
        problems.push(`${where} records no ${field}.`);
      }
    }
    if (typeof row.setupId === "string") {
      if (setupIds.has(row.setupId)) problems.push(`${where} repeats setup ${row.setupId}.`);
      setupIds.add(row.setupId);
    }
    if (!(LISTEN_LIVE_SOURCE_KINDS as readonly string[]).includes(row.source as string)) {
      problems.push(`${where} records source ${JSON.stringify(row.source)}.`);
    }
    const trials = Array.isArray(row.trials) ? row.trials : null;
    if (trials === null) {
      problems.push(`${where} holds no trial.`);
      continue;
    }
    for (const [trialIndex, trial] of trials.entries()) {
      const trialWhere = `${where} trial ${trialIndex}`;
      if (typeof trial !== "object" || trial === null || Array.isArray(trial)) {
        problems.push(`${trialWhere} is not a record.`);
        continue;
      }
      const trialRow = trial as Record<string, unknown>;
      problems.push(...keyProblems(trialRow, LISTEN_LIVE_TRIAL_KEYS, trialWhere));
      for (const field of ["trialId", "sessionId"] as const) {
        if (typeof trialRow[field] !== "string" || (trialRow[field] as string).length === 0) {
          problems.push(`${trialWhere} records no ${field}.`);
        }
      }
      if (typeof trialRow.trialId === "string") {
        // Trials are the unit every comparison is made over, so a repeated
        // identifier would let one performance stand in for two.
        if (trialIds.has(trialRow.trialId)) {
          problems.push(`${trialWhere} repeats trial ${trialRow.trialId}.`);
        }
        trialIds.add(trialRow.trialId);
      }
      const trialClass = trialRow.trialClass as ListenLiveTrialClass;
      if (!(LISTEN_LIVE_REQUIRED_TRIAL_CLASSES as readonly string[]).includes(trialClass)) {
        problems.push(`${trialWhere} records class ${JSON.stringify(trialClass)}.`);
        continue;
      }
      const expectedForClass = !LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES.includes(trialClass);
      if (typeof trialRow.expectedCorrect !== "boolean") {
        problems.push(`${trialWhere} does not say whether it should advance.`);
      } else if (trialRow.expectedCorrect !== expectedForClass) {
        // The flag is checked in both directions. A negative trial relabelled
        // positive would excuse an advance the class forbids, and a positive one
        // relabelled negative would drop the trial out of the correctness gate
        // entirely while still counting as coverage.
        problems.push(
          `${trialWhere} is a ${trialClass} trial and records expectedCorrect ` +
            `${trialRow.expectedCorrect}; the class requires ${expectedForClass}.`,
        );
      }
      problems.push(...musicalContextProblems(trialRow.musical, trialWhere, trialClass));
      problems.push(...decodedTraceProblems(trialRow.decodedTrace, trialWhere));
      if (!Number.isFinite(trialRow.intervalMs) || (trialRow.intervalMs as number) <= 0) {
        problems.push(`${trialWhere} records no played interval.`);
      }
      const sequence = trialRow.sequence as ListenSequenceDefinition | undefined;
      if (typeof sequence !== "object" || sequence === null ||
          !Array.isArray(sequence.targets) || sequence.targets.length === 0 ||
          !Array.isArray(sequence.attacks) || sequence.attacks.length === 0) {
        problems.push(
          `${trialWhere} carries no authored score, so its target and played pitches are not ` +
            "recorded and the matcher cannot be replayed over it.",
        );
      }
      const outcomes = Array.isArray(trialRow.outcomes) ? trialRow.outcomes : null;
      if (outcomes === null) {
        problems.push(`${trialWhere} holds no outcome.`);
        continue;
      }
      const seen = new Set<string>();
      for (const [outcomeIndex, outcome] of outcomes.entries()) {
        problems.push(...outcomeProblems(
          outcome,
          `${trialWhere} outcome ${outcomeIndex}`,
          trialClass,
        ));
        const profileId = (outcome as { profileId?: unknown })?.profileId;
        if (typeof profileId === "string") {
          if (seen.has(profileId)) {
            problems.push(`${trialWhere} reports ${profileId} twice.`);
          }
          seen.add(profileId);
        }
      }
      // Every declared column must be present on every trial: one captured
      // performance is replayed through all of them, so a missing column is a
      // measurement that was not made rather than a trial that did not apply.
      for (const profileId of profileIds ?? []) {
        if (!seen.has(profileId)) {
          problems.push(`${trialWhere} has no outcome for ${profileId}.`);
        }
      }
      // A negative trial the incumbent itself fails is archived rather than
      // refused. It is a live incumbent safety failure — exactly the thing a
      // candidate might remove — and prohibiting it would make the one live
      // improvement that matters most impossible to record. The candidate is
      // still held to the absolute rule for its own column.
      problems.push(...listenRoundTwoLiveReplayProblems(
        trialRow as unknown as ListenLiveTrial,
        trialWhere,
      ));
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * The gates, rederived
 * ------------------------------------------------------------------------- */

export interface ListenLiveGateFailure {
  gate: ListenLiveGateCode;
  setupId: string;
  sourceFamily: ListenLiveSourceFamily | null;
  trialId: string | null;
  measure: string;
  baselineValue: number | string | null;
  profileValue: number | string | null;
  explanation: string;
}

export interface ListenLiveGateOutcome {
  gate: ListenLiveGateCode;
  passed: boolean;
  failures: readonly ListenLiveGateFailure[];
}

export type ListenRoundTwoLiveGateStatus = "passed" | "failed" | "not-collected";

export interface ListenRoundTwoLiveResult {
  profileId: string;
  status: ListenRoundTwoLiveGateStatus;
  /** Per-setup trial counts, so no source is hidden behind a corpus total. */
  setupCoverage: ReadonlyArray<{
    setupId: string;
    sourceFamily: ListenLiveSourceFamily;
    trialCount: number;
  }>;
  gates: readonly ListenLiveGateOutcome[];
}

interface LiveTrialContext {
  setup: ListenLiveSetup;
  trial: ListenLiveTrial;
  baseline: ListenLiveTrialOutcome;
  candidate: ListenLiveTrialOutcome | undefined;
}

function liveTrials(archives: readonly ListenRoundTwoLiveArchive[], profileId: string) {
  const contexts: LiveTrialContext[] = [];
  for (const archive of archives) {
    for (const setup of archive.setups) {
      for (const trial of setup.trials) {
        const baseline = trial.outcomes
          .find((outcome) => outcome.profileId === LISTEN_LIVE_BASELINE_PROFILE_ID);
        if (baseline === undefined) continue;
        contexts.push({
          setup,
          trial,
          baseline,
          candidate: trial.outcomes.find((outcome) => outcome.profileId === profileId),
        });
      }
    }
  }
  return contexts;
}

function failure(
  gate: ListenLiveGateCode,
  context: LiveTrialContext | null,
  measure: string,
  baselineValue: number | string | null,
  profileValue: number | string | null,
  explanation: string,
  setupId = context?.setup.setupId ?? "",
): ListenLiveGateFailure {
  return {
    gate,
    setupId,
    sourceFamily: context === null
      ? null
      : LISTEN_LIVE_SOURCE_FAMILIES[context.setup.source],
    trialId: context?.trial.trialId ?? null,
    measure,
    baselineValue,
    profileValue,
    explanation,
  };
}

/**
 * Rederives one candidate's live gates from the archived trials.
 *
 * Every comparison is per trial and per counter. A corpus total would let a
 * candidate pay for an acoustic false advance with a digital recognition gain,
 * which is the one trade the live corpus exists to refuse.
 */
export function listenRoundTwoLiveResult(options: {
  profileId: string;
  archives: readonly ListenRoundTwoLiveArchive[];
}): ListenRoundTwoLiveResult {
  const { profileId } = options;
  const contexts = liveTrials(options.archives, profileId);
  const measured = contexts.filter(({ candidate }) => candidate !== undefined);
  const setupCoverage = [...new Map(measured.map(({ setup }) => [setup.setupId, setup])).values()]
    .map((setup) => ({
      setupId: setup.setupId,
      sourceFamily: LISTEN_LIVE_SOURCE_FAMILIES[setup.source],
      trialCount: measured.filter(({ setup: owner }) => owner.setupId === setup.setupId).length,
    }));

  const coverage: ListenLiveGateFailure[] = [];
  // A candidate no archive replayed is not judged here; it is not collected.
  if (measured.length === 0) {
    return {
      profileId,
      status: "not-collected",
      setupCoverage: [],
      gates: LISTEN_LIVE_GATE_CODES.map((gate) => ({ gate, passed: false, failures: [] })),
    };
  }
  for (const family of LISTEN_LIVE_REQUIRED_SOURCE_FAMILIES) {
    if (!setupCoverage.some((setup) => setup.sourceFamily === family)) {
      coverage.push(failure(
        "live-coverage",
        null,
        `${family}-setup-count`,
        1,
        0,
        `The live corpus holds no ${family} setup, and the release decision must report ` +
          "acoustic and digital results separately.",
      ));
    }
  }
  const setups = [...new Map(measured.map(({ setup }) => [setup.setupId, setup])).values()];
  for (const setup of setups) {
    const classes = new Set(measured
      .filter(({ setup: owner }) => owner.setupId === setup.setupId)
      .map(({ trial }) => trial.trialClass));
    for (const trialClass of LISTEN_LIVE_REQUIRED_TRIAL_CLASSES) {
      if (!classes.has(trialClass)) {
        coverage.push(failure(
          "live-coverage",
          null,
          `${trialClass}-trial-count`,
          1,
          0,
          `Setup ${setup.setupId} holds no ${trialClass} trial for ${profileId}.`,
          setup.setupId,
        ));
      }
    }
  }
  // A trial the incumbent was measured on and the candidate was not is a hole in
  // the comparison, not a trial that did not apply to it.
  for (const context of contexts) {
    if (context.candidate === undefined) {
      coverage.push(failure(
        "live-coverage",
        context,
        "candidate-outcome",
        "measured",
        "absent",
        `${profileId} has no outcome on trial ${context.trial.trialId}.`,
      ));
    }
  }

  const failures = measured.flatMap((context) => listenRoundTwoLiveTrialFailures({
    profileId,
    setup: context.setup,
    trial: context.trial,
    baseline: context.baseline,
    candidate: context.candidate!,
  }));
  const gates: ListenLiveGateOutcome[] = LISTEN_LIVE_GATE_CODES.map((gate) => {
    const gateFailures = gate === "live-coverage"
      ? coverage
      : failures.filter((entry) => entry.gate === gate);
    return { gate, passed: gateFailures.length === 0, failures: gateFailures };
  });
  return {
    profileId,
    status: gates.every(({ passed }) => passed) ? "passed" : "failed",
    setupCoverage,
    gates,
  };
}

/**
 * The four measured gates, decided on one trial against the incumbent's row.
 *
 * Every comparison lives here rather than inside the loop above, so the rules are
 * one function stated over a pair of rows: at this level no aggregate exists even
 * in principle, and a rule can be exercised on its own.
 */
export function listenRoundTwoLiveTrialFailures(options: {
  profileId: string;
  setup: Pick<ListenLiveSetup, "setupId" | "source">;
  trial: Pick<ListenLiveTrial, "trialId" | "trialClass">;
  baseline: ListenLiveTrialOutcome;
  candidate: ListenLiveTrialOutcome;
}): ListenLiveGateFailure[] {
  const { profileId, baseline, candidate, trial } = options;
  const context = {
    setup: options.setup as ListenLiveSetup,
    trial: options.trial as ListenLiveTrial,
    baseline,
    candidate,
  };
  const failures: ListenLiveGateFailure[] = [];
  for (const counter of LISTEN_LIVE_UNSAFE_COUNTERS) {
    if (candidate[counter] > baseline[counter]) {
      failures.push(failure(
        "live-safety",
        context,
        counter,
        baseline[counter],
        candidate[counter],
        `${profileId} introduced ${candidate[counter] - baseline[counter]} ${counter} on ` +
          `trial ${trial.trialId}.`,
      ));
    }
  }
  const positive = !LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES.includes(trial.trialClass);
  if (!positive && candidate.advanced) {
    // Absolute, at any rate: the performance does not contain the target. This
    // holds whatever the incumbent did, so an incumbent that also advances is
    // archived as the live safety failure it is rather than excusing the
    // candidate.
    failures.push(failure(
      "live-safety",
      context,
      "advanced",
      baseline.advanced ? "advanced" : "refused",
      "advanced",
      `${profileId} advanced on ${trial.trialClass} trial ${trial.trialId}, where the ` +
        "performance does not contain the target.",
    ));
  }
  if (positive && baseline.correctAdvance && !candidate.correctAdvance) {
    failures.push(failure(
      "live-correctness",
      context,
      "correctAdvance",
      1,
      0,
      `${profileId} lost the correct advance the incumbent made on trial ${trial.trialId}.`,
    ));
  }
  const baselineDistance = baseline.repeatedRecovery?.sourceDistance ?? null;
  if (trial.trialClass === "repeated-chord" && baselineDistance !== null) {
    const baselineRecovery = { ...baseline.repeatedRecovery!, sourceDistance: baselineDistance };
    const candidateRecovery = candidate.repeatedRecovery;
    if (candidateRecovery?.sourceDistance == null) {
      failures.push(failure(
        "live-repeated-recovery",
        context,
        "sourceDistance",
        baselineRecovery.sourceDistance,
        null,
        `${profileId} never recovered the repeated chord the incumbent recovered on trial ` +
          `${trial.trialId}.`,
      ));
    } else {
      const distanceDelta = candidateRecovery.sourceDistance - baselineRecovery.sourceDistance;
      const delayDelta = (candidateRecovery.attributionDelayMs ?? 0) -
        (baselineRecovery.attributionDelayMs ?? 0);
      if (distanceDelta > LISTEN_REPEATED_SOURCE_DISTANCE_NO_REGRESSION) {
        failures.push(failure(
          "live-repeated-recovery",
          context,
          "sourceDistance",
          baselineRecovery.sourceDistance,
          candidateRecovery.sourceDistance,
          `${profileId} recovered the repeated chord ${distanceDelta} attacks later on trial ` +
            `${trial.trialId}.`,
        ));
      }
      if (delayDelta > LISTEN_REPEATED_DELAY_NO_REGRESSION_MS) {
        failures.push(failure(
          "live-repeated-recovery",
          context,
          "attributionDelayMs",
          baselineRecovery.attributionDelayMs,
          candidateRecovery.attributionDelayMs,
          `${profileId} attributed the repeated chord ${delayDelta} ms later on trial ` +
            `${trial.trialId}.`,
        ));
      }
    }
  }
  if (positive && baseline.latencyMs !== null && candidate.latencyMs !== null &&
      candidate.latencyMs - baseline.latencyMs > LISTEN_LIVE_LATENCY_REGRESSION_TOLERANCE_MS) {
    failures.push(failure(
      "live-latency",
      context,
      "latencyMs",
      baseline.latencyMs,
      candidate.latencyMs,
      `${profileId} advanced ${candidate.latencyMs - baseline.latencyMs} ms later than the ` +
        `incumbent on trial ${trial.trialId}, beyond the ` +
        `${LISTEN_LIVE_LATENCY_REGRESSION_TOLERANCE_MS} ms tolerance.`,
    ));
  }
  return failures;
}

/**
 * Rederives every automated-eligible candidate's live result.
 *
 * The candidate list comes from the eligibility manifest, never from the live
 * archives: a corpus cannot add a column and thereby add a candidate, and a
 * candidate the corpus skipped is reported `not-collected` rather than omitted.
 */
export function listenRoundTwoLiveResults(options: {
  eligibility: ListenRoundTwoEligibilityManifest;
  /** Recomputed by the caller from the manifest's own fields, never read off it. */
  eligibilityManifestDigest: string;
  archives: readonly unknown[];
}): { results: ListenRoundTwoLiveResult[]; problems: string[] } {
  const entries = options.eligibility.runStatus === "completed" ? options.eligibility.entries : [];
  const automatedEligibleProfileIds = entries
    .filter(({ automatedEligible }) => automatedEligible)
    .map(({ profileId }) => profileId);
  const { eligibilityManifestDigest } = options;
  const problems: string[] = [];
  // A live corpus for a round that confirmed nothing is evidence of a session
  // that could not have been run against this chain.
  if (options.archives.length > 0 && automatedEligibleProfileIds.length === 0) {
    problems.push(
      "A live corpus was archived for a round whose eligibility manifest holds no " +
        "automated-eligible candidate.",
    );
  }
  for (const archive of options.archives) {
    problems.push(...listenRoundTwoLiveArchiveProblems({
      archive,
      eligibilityManifestDigest,
      automatedEligibleProfileIds,
    }));
  }
  if (problems.length > 0) return { results: [], problems };
  const archives = options.archives as ListenRoundTwoLiveArchive[];
  return {
    results: automatedEligibleProfileIds
      .map((profileId) => listenRoundTwoLiveResult({ profileId, archives })),
    problems,
  };
}
