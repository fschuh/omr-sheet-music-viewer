/**
 * Round-two evidence for the two costs a bass-onset gate has to pay at once.
 *
 * Task 09 recorded that `isolated/direct/122` and `isolated/tone/124` are triads
 * whose lowest note was never played and which the `v2` candidates advance
 * anyway. Task 05 recorded that the repeated Course Clear chord `[62, 74, 82]`
 * is recognized a full attack late under every measured profile. This module
 * measures both sides from captured traces, without changing a threshold, a
 * policy, a gate, or a default:
 *
 * - the decoded onset confidence on the bass pitch of every triad, separated
 *   into genuinely sounded attacks and hallucinated ones, so the cost of holding
 *   the bass at 0.60 is a measured distribution rather than one anecdote;
 * - the per-pitch qualification path of every repetition of `[62, 74, 82]`,
 *   read from the matcher's own gate decisions rather than recomputed beside it.
 *
 * Everything here is a pure read of already captured recognition. The module
 * renders nothing, runs no inference, and never selects a value.
 */

import {
  type ChordMatcherDecision,
  type ChordMatcherEvidenceVerdict,
  type ChordMatcherOnsetVerdict,
} from "../chordMatcher";
import {
  FIXED_LISTEN_MATCHER_POLICY,
  LISTEN_MATCHER_PROFILES,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS,
  generateListenMatcherSweepProfiles,
  type ListenMatcherSweepProfile,
} from "./benchmarks/listenMatcherSweepBenchmark";
import {
  ONLINE_AMT_CHUNK_SIZE,
  ONLINE_AMT_SAMPLE_RATE,
} from "../onlineAmtProtocol";
import { replayIsolatedListenTrace } from "./benchmarks/listenBenchmark";
import {
  LISTEN_ATTACK_BOUNDARY_EPSILON_MS,
  replayListenSequenceTrace,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceMatcherDecisionContext,
  type ListenSequenceRunResult,
  type MaterializedListenSequence,
  type ScheduledSequenceAttack,
} from "./benchmarks/listenSequenceBenchmark";
import type {
  ListenTracePartition,
  ListenTraceRendererKey,
  ListenTraceSuite,
} from "./benchmarks/listenTraceManifest";

/* ------------------------------------------------------------------------- *
 * Gate reference points
 * ------------------------------------------------------------------------- */

/** The incumbent `baseline-v1` fresh-onset gate every distribution is read against. */
export const LISTEN_INCUMBENT_ONSET_GATE = LISTEN_MATCHER_PROFILES["baseline-v1"].onsetThreshold;

/** The two frozen `v2` candidate fresh-onset gates, lowest first. */
export const LISTEN_CANDIDATE_ONSET_GATES: readonly number[] = Object.freeze([0.45, 0.5]);

/**
 * The band the two omitted-bass advances live in: both `steady` candidates
 * admit the phantom bass onset at 0.50 while `baseline-v1` refuses it at 0.60,
 * so the confidence that produced them lies here.
 */
export const LISTEN_HALLUCINATION_CORRIDOR = Object.freeze({
  lowerInclusive: 0.5,
  upperExclusive: 0.6,
});

/** Every fresh-onset gate a distribution is scored against, ascending. */
export const LISTEN_BASS_ONSET_GATES: readonly number[] = Object.freeze([
  ...LISTEN_CANDIDATE_ONSET_GATES,
  LISTEN_INCUMBENT_ONSET_GATE,
]);

/** Every active-target gate the version-1 grid measured, ascending. */
export const LISTEN_ACTIVE_TARGET_GATES: readonly number[] = Object.freeze(
  [...LISTEN_MATCHER_SWEEP_ACTIVE_THRESHOLDS].sort((left, right) => left - right),
);

/**
 * The window one physical attack owns, derived from the fixed policy exactly as
 * the replay attribution rule derives it. An onset later than this belongs to a
 * following attack, and a window is additionally cut short by the next attack so
 * two attacks can never claim the same decoded onset.
 */
export const LISTEN_ATTACK_EVIDENCE_WINDOW_MS = FIXED_LISTEN_MATCHER_POLICY.collectionWindowMs +
  FIXED_LISTEN_MATCHER_POLICY.settleMs +
  ONLINE_AMT_CHUNK_SIZE * 1_000 / ONLINE_AMT_SAMPLE_RATE;

/* ------------------------------------------------------------------------- *
 * Confidence bands
 * ------------------------------------------------------------------------- */

export type ListenBassConfidenceBandId =
  | "no-onset"
  | "below-0.45"
  | "0.45-0.50"
  | "0.50-0.60"
  | "0.60-0.90"
  | "0.90-1.00";

export interface ListenBassConfidenceBand {
  id: ListenBassConfidenceBandId;
  lowerInclusive: number | null;
  upperExclusive: number | null;
}

/**
 * Bands chosen from the gates under discussion rather than from the data: the
 * two candidate fresh-onset gates, the incumbent's, and the corridor between
 * them. A band boundary picked after seeing a distribution would be a decision
 * disguised as a report.
 */
export const LISTEN_BASS_CONFIDENCE_BANDS: readonly ListenBassConfidenceBand[] = Object.freeze([
  Object.freeze({ id: "no-onset" as const, lowerInclusive: null, upperExclusive: null }),
  Object.freeze({ id: "below-0.45" as const, lowerInclusive: 0, upperExclusive: 0.45 }),
  Object.freeze({ id: "0.45-0.50" as const, lowerInclusive: 0.45, upperExclusive: 0.5 }),
  Object.freeze({ id: "0.50-0.60" as const, lowerInclusive: 0.5, upperExclusive: 0.6 }),
  Object.freeze({ id: "0.60-0.90" as const, lowerInclusive: 0.6, upperExclusive: 0.9 }),
  Object.freeze({ id: "0.90-1.00" as const, lowerInclusive: 0.9, upperExclusive: null }),
]);

export function listenBassConfidenceBand(confidence: number | null): ListenBassConfidenceBandId {
  if (confidence === null) return "no-onset";
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`A decoded onset confidence of ${confidence} is outside [0, 1].`);
  }
  if (confidence < 0.45) return "below-0.45";
  if (confidence < 0.5) return "0.45-0.50";
  if (confidence < 0.6) return "0.50-0.60";
  if (confidence < 0.9) return "0.60-0.90";
  return "0.90-1.00";
}

export function isInsideListenHallucinationCorridor(confidence: number | null): boolean {
  return confidence !== null &&
    confidence >= LISTEN_HALLUCINATION_CORRIDOR.lowerInclusive &&
    confidence < LISTEN_HALLUCINATION_CORRIDOR.upperExclusive;
}

/* ------------------------------------------------------------------------- *
 * Bass onset observations
 * ------------------------------------------------------------------------- */

/** Whether the bass pitch of the target was physically sounded by the attack. */
export type ListenBassOnsetKind = "genuine" | "hallucinated";

/**
 * One triad attack's bass evidence.
 *
 * `musicalInputPair` is the deduplication key of the second reported view: the
 * ordered score target and the ordered played pitches. One fixture rendered at
 * several speeds, layers, or renderers is the same musical input, and counting
 * it repeatedly would inflate a distribution the decision reads.
 */
export interface ListenBassOnsetObservation {
  traceId: string;
  suite: ListenTraceSuite;
  partition: ListenTracePartition;
  rendererKey: ListenTraceRendererKey;
  musicalInputPair: string;
  targetPitches: number[];
  playedPitches: number[];
  bassMidi: number;
  kind: ListenBassOnsetKind;
  attackIndex: number | null;
  targetIndex: number | null;
  windowStartMs: number;
  windowEndMs: number;
  /** Strongest decoded onset on the bass pitch inside the window, or null. */
  onsetConfidence: number | null;
  onsetNoteConfidence: number | null;
  onsetTimeMs: number | null;
  /** Strongest sustained evidence on the bass pitch inside the window. */
  targetEvidence: number;
  band: ListenBassConfidenceBandId;
}

export function listenMusicalInputPair(
  targetPitches: readonly number[],
  playedPitches: readonly number[],
): string {
  const ordered = (pitches: readonly number[]) =>
    [...pitches].sort((left, right) => left - right).join("+");
  return `${ordered(targetPitches)}|${ordered(playedPitches)}`;
}

interface BassEvidenceWindow {
  onsetConfidence: number | null;
  onsetNoteConfidence: number | null;
  onsetTimeMs: number | null;
  targetEvidence: number;
}

/**
 * The strongest onset and sustained evidence for one pitch inside one window.
 *
 * Onsets are matched on the decoder's own `onsetTimeMs` rather than on the frame
 * that reported them, because that is the value every matcher gate reads.
 */
export function listenPitchEvidenceInWindow(
  frames: readonly ListenRecognitionFrame[],
  midi: number,
  windowStartMs: number,
  windowEndMs: number,
): BassEvidenceWindow {
  let onsetConfidence: number | null = null;
  let onsetNoteConfidence: number | null = null;
  let onsetTimeMs: number | null = null;
  let targetEvidence = 0;
  for (const frame of frames) {
    for (const onset of frame.onsets) {
      if (onset.midi !== midi) continue;
      if (onset.onsetTimeMs < windowStartMs || onset.onsetTimeMs > windowEndMs) continue;
      if (onsetConfidence === null || onset.confidence > onsetConfidence) {
        onsetConfidence = onset.confidence;
        onsetNoteConfidence = onset.noteConfidence;
        onsetTimeMs = onset.onsetTimeMs;
      }
    }
    if (frame.capturedAtMs < windowStartMs || frame.capturedAtMs > windowEndMs) continue;
    for (const evidence of frame.confidenceEvidence) {
      if (evidence.midi !== midi) continue;
      targetEvidence = Math.max(targetEvidence, evidence.confidence);
    }
  }
  return { onsetConfidence, onsetNoteConfidence, onsetTimeMs, targetEvidence };
}

/**
 * The window one attack owns: its own schedule, cut short by the next attack.
 *
 * Both ends are inclusive, and the cut is taken one epsilon short of the next
 * attack exactly as `scheduledAttributionEnds` takes it, so no instant belongs to
 * two attacks. Decoded times land on the 32 ms frame cadence and attack times
 * generally do not, but they do coincide — attack 20 of a 125 ms passage falls
 * exactly on a frame boundary — and evidence counted twice there would inflate
 * whichever distribution read it.
 */
export function listenAttackEvidenceWindow(
  sequence: MaterializedListenSequence,
  attack: ScheduledSequenceAttack,
): { windowStartMs: number; windowEndMs: number } {
  const next = sequence.attacks.find(({ index }) => index === attack.index + 1);
  const windowEndMs = Math.min(
    attack.scheduledAtMs + LISTEN_ATTACK_EVIDENCE_WINDOW_MS,
    next === undefined
      ? Number.POSITIVE_INFINITY
      : next.scheduledAtMs - LISTEN_ATTACK_BOUNDARY_EPSILON_MS,
  );
  return { windowStartMs: attack.scheduledAtMs, windowEndMs };
}

/** Descriptor fields every observation carries, so a distribution can be scoped. */
export interface ListenBassTraceIdentity {
  traceId: string;
  suite: ListenTraceSuite;
  partition: ListenTracePartition;
  rendererKey: ListenTraceRendererKey;
}

/**
 * Bass evidence for every triad attack of one continuous run.
 *
 * Only targets of three or more pitches are observed, because the fresh-bass
 * rule and any bass-specific gate apply to exactly those: for a two-note target
 * the matcher never refuses the lowest pitch's sustained evidence.
 */
export function listenSequenceBassOnsetObservations(
  identity: ListenBassTraceIdentity,
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
): ListenBassOnsetObservation[] {
  return sequence.attacks.flatMap((attack): ListenBassOnsetObservation[] => {
    const target = sequence.targets[attack.targetIndex];
    if (!target || target.pitches.length < 3) return [];
    const bassMidi = Math.min(...target.pitches);
    const playedPitches = [...attack.playedPitches].sort((left, right) => left - right);
    const { windowStartMs, windowEndMs } = listenAttackEvidenceWindow(sequence, attack);
    const evidence = listenPitchEvidenceInWindow(
      trace.frames,
      bassMidi,
      windowStartMs,
      windowEndMs,
    );
    return [{
      ...identity,
      musicalInputPair: listenMusicalInputPair(target.pitches, playedPitches),
      targetPitches: [...target.pitches].sort((left, right) => left - right),
      playedPitches,
      bassMidi,
      kind: playedPitches.includes(bassMidi) ? "genuine" : "hallucinated",
      attackIndex: attack.index,
      targetIndex: attack.targetIndex,
      windowStartMs,
      windowEndMs,
      onsetConfidence: evidence.onsetConfidence,
      onsetNoteConfidence: evidence.onsetNoteConfidence,
      onsetTimeMs: evidence.onsetTimeMs,
      targetEvidence: evidence.targetEvidence,
      band: listenBassConfidenceBand(evidence.onsetConfidence),
    }];
  });
}

/**
 * Bass evidence for one isolated fixture.
 *
 * An isolated trace holds a single attack and the matcher consumes every frame
 * of it, so the window is the whole trace rather than an attributed slice.
 */
export function listenIsolatedBassOnsetObservation(
  identity: ListenBassTraceIdentity,
  targetPitches: readonly number[],
  playedPitches: readonly number[],
  trace: ListenRecognitionTrace,
): ListenBassOnsetObservation | null {
  if (targetPitches.length < 3) return null;
  const target = [...targetPitches].sort((left, right) => left - right);
  const played = [...playedPitches].sort((left, right) => left - right);
  const bassMidi = target[0];
  const windowEndMs = trace.frames.length === 0
    ? 0
    : trace.frames[trace.frames.length - 1].capturedAtMs;
  const evidence = listenPitchEvidenceInWindow(trace.frames, bassMidi, 0, windowEndMs);
  return {
    ...identity,
    musicalInputPair: listenMusicalInputPair(target, played),
    targetPitches: target,
    playedPitches: played,
    bassMidi,
    kind: played.includes(bassMidi) ? "genuine" : "hallucinated",
    attackIndex: null,
    targetIndex: null,
    windowStartMs: 0,
    windowEndMs,
    onsetConfidence: evidence.onsetConfidence,
    onsetNoteConfidence: evidence.onsetNoteConfidence,
    onsetTimeMs: evidence.onsetTimeMs,
    targetEvidence: evidence.targetEvidence,
    band: listenBassConfidenceBand(evidence.onsetConfidence),
  };
}

/* ------------------------------------------------------------------------- *
 * Distributions
 * ------------------------------------------------------------------------- */

export interface ListenBassBandCount {
  band: ListenBassConfidenceBandId;
  count: number;
}

export interface ListenBassGateCount {
  gate: number;
  /** Observations this gate refuses: an absent or weaker bass onset. */
  rawRefusedCount: number;
  /** Unique musical-input pairs this gate refuses, banded as below. */
  pairRefusedCount: number;
}

/**
 * One kind of bass evidence, reported twice.
 *
 * `bands` counts decoded attacks. `pairBands` counts unique musical inputs, and
 * bands each pair by the instance a gate decision has to survive: the weakest
 * genuine attack it must still accept, and the strongest hallucinated onset it
 * must still refuse. Reporting a pair by its mean would let one strong rendering
 * hide the rendering that actually fails.
 */
export interface ListenBassOnsetDistribution {
  kind: ListenBassOnsetKind;
  pairRepresentative: "weakest" | "strongest";
  observationCount: number;
  uniquePairCount: number;
  withoutOnsetCount: number;
  minimumConfidence: number | null;
  maximumConfidence: number | null;
  bands: ListenBassBandCount[];
  pairBands: ListenBassBandCount[];
  gates: ListenBassGateCount[];
  corridor: {
    /** Attacks whose bass onset lies in `[0.50, 0.60)`. */
    rawCount: number;
    /** Unique pairs with at least one attack in that corridor. */
    pairCount: number;
  };
}

function bandCounts(values: readonly (number | null)[]): ListenBassBandCount[] {
  return LISTEN_BASS_CONFIDENCE_BANDS.map(({ id }) => ({
    band: id,
    count: values.filter((value) => listenBassConfidenceBand(value) === id).length,
  }));
}

function representativeConfidence(
  confidences: readonly (number | null)[],
  representative: "weakest" | "strongest",
): number | null {
  if (representative === "weakest") {
    return confidences.includes(null)
      ? null
      : Math.min(...confidences.map((value) => value as number));
  }
  const present = confidences.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

export function summarizeListenBassOnsetDistribution(
  kind: ListenBassOnsetKind,
  observations: readonly ListenBassOnsetObservation[],
): ListenBassOnsetDistribution {
  if (observations.some((observation) => observation.kind !== kind)) {
    throw new Error(`A ${kind} distribution received an observation of another kind.`);
  }
  const representative = kind === "genuine" ? "weakest" : "strongest";
  const confidences = observations.map(({ onsetConfidence }) => onsetConfidence);
  const present = confidences.filter((value): value is number => value !== null);
  const pairs = new Map<string, (number | null)[]>();
  for (const observation of observations) {
    const existing = pairs.get(observation.musicalInputPair) ?? [];
    existing.push(observation.onsetConfidence);
    pairs.set(observation.musicalInputPair, existing);
  }
  const pairConfidences = [...pairs.values()]
    .map((values) => representativeConfidence(values, representative));
  const refuses = (confidence: number | null, gate: number) =>
    confidence === null || confidence < gate;
  return {
    kind,
    pairRepresentative: representative,
    observationCount: observations.length,
    uniquePairCount: pairs.size,
    withoutOnsetCount: confidences.filter((value) => value === null).length,
    minimumConfidence: present.length === 0 ? null : Math.min(...present),
    maximumConfidence: present.length === 0 ? null : Math.max(...present),
    bands: bandCounts(confidences),
    pairBands: bandCounts(pairConfidences),
    gates: LISTEN_BASS_ONSET_GATES.map((gate) => ({
      gate,
      rawRefusedCount: confidences.filter((value) => refuses(value, gate)).length,
      pairRefusedCount: pairConfidences.filter((value) => refuses(value, gate)).length,
    })),
    corridor: {
      rawCount: confidences.filter(isInsideListenHallucinationCorridor).length,
      pairCount: [...pairs.values()]
        .filter((values) => values.some(isInsideListenHallucinationCorridor)).length,
    },
  };
}

/** One reported scope: a renderer, a suite group, and both evidence kinds. */
export interface ListenBassOnsetCensus {
  scope: string;
  rendererKey: ListenTraceRendererKey | "both";
  traceCount: number;
  genuine: ListenBassOnsetDistribution;
  hallucinated: ListenBassOnsetDistribution;
}

export function listenBassOnsetCensus(
  scope: string,
  rendererKey: ListenTraceRendererKey | "both",
  observations: readonly ListenBassOnsetObservation[],
): ListenBassOnsetCensus {
  return {
    scope,
    rendererKey,
    traceCount: new Set(observations.map(({ traceId }) => traceId)).size,
    genuine: summarizeListenBassOnsetDistribution(
      "genuine",
      observations.filter(({ kind }) => kind === "genuine"),
    ),
    hallucinated: summarizeListenBassOnsetDistribution(
      "hallucinated",
      observations.filter(({ kind }) => kind === "hallucinated"),
    ),
  };
}

/**
 * Splits observations into the census rows a report quotes: each renderer alone
 * and both together. A claim about "the isolated corpus" has to hold for every
 * renderer column it covers, so the per-renderer rows are always present.
 */
export function listenBassOnsetCensusByRenderer(
  scope: string,
  observations: readonly ListenBassOnsetObservation[],
): ListenBassOnsetCensus[] {
  const renderers: ListenTraceRendererKey[] = ["direct", "tone"];
  return [
    ...renderers.map((rendererKey) => listenBassOnsetCensus(
      `${scope}/${rendererKey}`,
      rendererKey,
      observations.filter((observation) => observation.rendererKey === rendererKey),
    )),
    listenBassOnsetCensus(`${scope}/both`, "both", observations),
  ];
}

/**
 * Isolated fixtures whose target chord appears both played complete and played
 * without its bass. These matched pairs are the deciding set: they hold the
 * genuine and the hallucinated evidence for the identical chord.
 */
export interface ListenMatchedBassPair {
  targetPitches: number[];
  genuine: ListenBassOnsetObservation[];
  hallucinated: ListenBassOnsetObservation[];
}

export function listenMatchedBassPairs(
  observations: readonly ListenBassOnsetObservation[],
): ListenMatchedBassPair[] {
  const byTarget = new Map<string, ListenBassOnsetObservation[]>();
  for (const observation of observations) {
    const key = observation.targetPitches.join("+");
    byTarget.set(key, [...(byTarget.get(key) ?? []), observation]);
  }
  return [...byTarget.entries()]
    .map(([, entries]) => ({
      targetPitches: entries[0].targetPitches,
      genuine: entries.filter(({ kind }) => kind === "genuine"),
      hallucinated: entries.filter(({ kind }) => kind === "hallucinated"),
    }))
    .filter(({ genuine, hallucinated }) => genuine.length > 0 && hallucinated.length > 0)
    .sort((left, right) => left.targetPitches[0] - right.targetPitches[0] ||
      left.targetPitches[1] - right.targetPitches[1]);
}

export function listenMatchedBassPairObservations(
  observations: readonly ListenBassOnsetObservation[],
): ListenBassOnsetObservation[] {
  const matched = new Set(
    listenMatchedBassPairs(observations).map(({ targetPitches }) => targetPitches.join("+")),
  );
  return observations.filter((observation) => matched.has(observation.targetPitches.join("+")));
}

/* ------------------------------------------------------------------------- *
 * Observed matcher qualification
 * ------------------------------------------------------------------------- */

export interface ListenObservedMatcherDecision {
  decision: ChordMatcherDecision;
  context: ListenSequenceMatcherDecisionContext;
}

/**
 * A compact identity of everything a replay decided, used to prove that
 * observing a replay changes nothing about it.
 */
function listenRunDecisionSignature(run: ListenSequenceRunResult): string {
  return run.events
    .map((event) => [
      event.index,
      event.advanced ? 1 : 0,
      event.advancedAtMs ?? "null",
      event.orderedAdvanced ? 1 : 0,
      event.falseAdvance ? 1 : 0,
      event.skipped ? 1 : 0,
      event.duplicate ? 1 : 0,
      event.lateAdvance ? 1 : 0,
    ].join(":"))
    .join("|");
}

/**
 * Replays one captured run while recording every matcher gate decision.
 *
 * The same trace is replayed a second time without an observer and the two
 * outcomes are compared, so a diagnosis can never quote decisions from a replay
 * that behaved differently from the measured one.
 */
export function observeListenSequenceQualification(
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
  profile: ListenMatcherThresholds,
): {
  run: ListenSequenceRunResult;
  advancements: ListenSequenceAdvancementRecord[];
  decisions: ListenObservedMatcherDecision[];
} {
  const decisions: ListenObservedMatcherDecision[] = [];
  const advancements: ListenSequenceAdvancementRecord[] = [];
  const run = replayListenSequenceTrace(
    sequence,
    trace,
    "current-matcher",
    profile,
    (observation) => advancements.push({
      targetIndex: observation.targetIndex,
      atMs: observation.atMs,
      sourceAttackIndex: observation.sourceAttackIndex,
      detectedTargetPitches: [...observation.detectedTargetPitches],
      extraPitches: [...observation.extraPitches],
      carryOverPitchesAtTargetStart: [...observation.carryOverPitchesAtTargetStart],
    }),
    (decision, context) => decisions.push({ decision, context }),
  );
  const unobserved = replayListenSequenceTrace(sequence, trace, "current-matcher", profile);
  if (listenRunDecisionSignature(run) !== listenRunDecisionSignature(unobserved)) {
    throw new Error(
      `Observing ${sequence.definition.id} changed its replay, so its recorded ` +
      "qualification paths do not describe the measured run.",
    );
  }
  return { run, advancements, decisions };
}

/** The advancement facts a repetition record needs, copied out of the replay. */
export interface ListenSequenceAdvancementRecord {
  targetIndex: number;
  atMs: number;
  sourceAttackIndex: number | null;
  detectedTargetPitches: number[];
  extraPitches: number[];
  carryOverPitchesAtTargetStart: number[];
}

/**
 * Refusal verdicts in the order a diagnosis reports them. Confidence gates come
 * first because they are the only refusals a threshold change can move; a
 * structural refusal is reported as itself rather than folded into one.
 */
const ONSET_VERDICT_PRIORITY: readonly ChordMatcherOnsetVerdict[] = Object.freeze([
  "below-onset-gate",
  "below-note-gate",
  "duplicate-onset",
  "before-refractory",
  "overtone-alias",
  "carried-over",
  "outside-attack-window",
  "outside-collection-window",
  "unanchored-extra",
  "unexpected-note",
  "accepted",
]);

const EVIDENCE_VERDICT_PRIORITY: readonly ChordMatcherEvidenceVerdict[] = Object.freeze([
  "below-active-gate",
  "bass-requires-fresh-onset",
  "carried-over",
  "attempt-not-anchored",
  "outside-collection-window",
  "before-refractory",
  "already-accumulated",
  "not-a-target",
  "accepted",
]);

/** How one required pitch was admitted, or the gate that kept it out. */
export type ListenPitchQualificationPath =
  | "qualified-by-fresh-onset"
  | "qualified-by-sustained-evidence"
  | "fresh-onset-rejected"
  | "active-target-evidence-rejected"
  | "bass-requires-fresh-onset"
  | "no-decoded-evidence"
  | "other-fixed-policy";

/**
 * The four limiting paths this round distinguishes at target level, plus the
 * advanced case. `other-fixed-policy` covers every refusal that is neither a
 * confidence gate nor an unexpected note — the fresh-bass rule, carry-over, the
 * collection window, and the refractory period.
 */
export type ListenTargetQualificationPath =
  | "advanced"
  | "fresh-onset-rejected"
  | "active-target-evidence-rejected"
  | "unexpected-note-rejection"
  | "target-not-armed"
  | "other-fixed-policy";

export interface ListenVerdictCount<TVerdict extends string> {
  verdict: TVerdict;
  count: number;
}

/** One required pitch, and the gate that admitted or refused it. */
export interface ListenPitchQualificationRecord {
  midi: number;
  role: "bass" | "upper";
  onsetConfidence: number | null;
  onsetNoteConfidence: number | null;
  onsetTimeMs: number | null;
  /** Strongest sustained target-pitch evidence inside the attack's window. */
  targetEvidence: number;
  activeMembership: boolean;
  activeConfidence: number | null;
  onsetVerdicts: ListenVerdictCount<ChordMatcherOnsetVerdict>[];
  evidenceVerdicts: ListenVerdictCount<ChordMatcherEvidenceVerdict>[];
  limitingOnsetVerdict: ChordMatcherOnsetVerdict | null;
  limitingEvidenceVerdict: ChordMatcherEvidenceVerdict | null;
  qualified: boolean;
  path: ListenPitchQualificationPath;
  /** Fresh-onset gates this pitch's strongest onset clears. */
  onsetGatesCleared: number[];
  onsetGatesRefusing: number[];
  insideHallucinationCorridor: boolean;
  /** Active-target gates this pitch's strongest sustained evidence clears. */
  activeGatesCleared: number[];
  activeGatesRefusing: number[];
}

export interface ListenRepeatedChordPitchRecord extends ListenPitchQualificationRecord {
  /** True when the pitch was already sounding when this attack began. */
  soundingBeforeAttack: boolean;
  /** True when the immediately preceding physical attack also played it. */
  playedByPreviousAttack: boolean;
  /**
   * True when the matcher was armed on a target containing this pitch. When it
   * is false no gate ever judged the pitch, and its decoded evidence is reported
   * without a qualification verdict to attach it to.
   */
  isArmedTargetPitch: boolean;
}

export interface ListenRepeatedChordAttackRecord {
  traceId: string;
  suite: ListenTraceSuite;
  partition: ListenTracePartition;
  rendererKey: ListenTraceRendererKey;
  profile: ListenMatcherThresholds;
  attackIndex: number;
  attackTargetIndex: number;
  scheduledAtMs: number;
  playedPitches: number[];
  /** The target the matcher was armed on while this attack sounded. */
  armedTargetIndex: number | null;
  armedTargetPitches: number[];
  /**
   * True when the matcher was armed on this exact chord while the attack
   * sounded. When it is false the run had already stalled elsewhere, so the
   * repetition says nothing about how this chord's own gates behave.
   */
  chordIsArmedTarget: boolean;
  /**
   * `transition` is the first attack of the repeated region, where the bass is
   * new and the upper voices carry; `exact-repetition` is an attack whose
   * predecessor played the identical chord.
   */
  role: "transition" | "exact-repetition";
  previousAttackPitches: number[];
  carriedPitches: number[];
  freshPitches: number[];
  advanced: boolean;
  advancedTargetIndex: number | null;
  advancedAtMs: number | null;
  sourceDistance: number | null;
  attributionDelayMs: number | null;
  pitches: ListenRepeatedChordPitchRecord[];
  /** Every path that kept a required pitch out, never only the first one. */
  limitingPaths: ListenTargetQualificationPath[];
  /** The highest-priority entry of `limitingPaths`; not a claim it is the only one. */
  primaryLimitingPath: ListenTargetQualificationPath;
  limitingPitches: number[];
  /**
   * The weakest sustained evidence among the chord's own upper voices that
   * failed to qualify, with an absent decoder evidence recorded as zero rather
   * than dropped. Null only when every upper voice qualified. A run whose
   * playhead never armed this chord reports the evidence its upper voices
   * actually produced, because that is the value any active-target gate would
   * have had to work with.
   */
  lowestLimitingUpperVoiceEvidence: number | null;
}

const TARGET_PATH_PRIORITY: readonly ListenTargetQualificationPath[] = Object.freeze([
  // A chord the matcher was not armed on could not be refused by any gate, so
  // that fact outranks every gate-level explanation of the same repetition.
  "target-not-armed",
  "unexpected-note-rejection",
  "fresh-onset-rejected",
  "active-target-evidence-rejected",
  "other-fixed-policy",
  "advanced",
]);

function verdictCounts<TVerdict extends string>(
  verdicts: readonly TVerdict[],
  priority: readonly TVerdict[],
): ListenVerdictCount<TVerdict>[] {
  return priority
    .map((verdict) => ({ verdict, count: verdicts.filter((entry) => entry === verdict).length }))
    .filter(({ count }) => count > 0);
}

function limitingVerdict<TVerdict extends string>(
  verdicts: readonly TVerdict[],
  priority: readonly TVerdict[],
  accepted: TVerdict,
): TVerdict | null {
  const refusals = verdicts.filter((verdict) => verdict !== accepted);
  return priority.find((verdict) => refusals.includes(verdict)) ?? null;
}

function pitchPath(
  qualifiedByOnset: boolean,
  qualifiedByEvidence: boolean,
  onsetVerdict: ChordMatcherOnsetVerdict | null,
  evidenceVerdict: ChordMatcherEvidenceVerdict | null,
): ListenPitchQualificationPath {
  if (qualifiedByOnset) return "qualified-by-fresh-onset";
  if (qualifiedByEvidence) return "qualified-by-sustained-evidence";
  if (onsetVerdict === "below-onset-gate" || onsetVerdict === "below-note-gate") {
    return "fresh-onset-rejected";
  }
  if (evidenceVerdict === "below-active-gate") return "active-target-evidence-rejected";
  if (evidenceVerdict === "bass-requires-fresh-onset") return "bass-requires-fresh-onset";
  if (onsetVerdict === null && evidenceVerdict === null) return "no-decoded-evidence";
  return "other-fixed-policy";
}

function targetPathForPitch(path: ListenPitchQualificationPath): ListenTargetQualificationPath {
  if (path === "fresh-onset-rejected") return "fresh-onset-rejected";
  if (path === "active-target-evidence-rejected") return "active-target-evidence-rejected";
  return "other-fixed-policy";
}

function frameAtOrBefore(
  frames: readonly ListenRecognitionFrame[],
  atMs: number,
): ListenRecognitionFrame | null {
  let found: ListenRecognitionFrame | null = null;
  for (const frame of frames) {
    if (frame.capturedAtMs > atMs) break;
    found = frame;
  }
  return found;
}

/**
 * One pitch's evidence and verdicts inside one window, read from the decoder
 * output and from the matcher's own decisions rather than recomputed from the
 * threshold values.
 */
export function listenPitchQualificationRecord(options: {
  midi: number;
  isBass: boolean;
  frames: readonly ListenRecognitionFrame[];
  /** Matcher decisions already restricted to the window under investigation. */
  decisions: readonly ChordMatcherDecision[];
  windowStartMs: number;
  windowEndMs: number;
}): ListenPitchQualificationRecord {
  const { midi, frames, windowStartMs, windowEndMs } = options;
  const onsetVerdicts = options.decisions
    .filter((decision) => decision.kind === "onset" && decision.midi === midi)
    .map((decision) => (decision as { verdict: ChordMatcherOnsetVerdict }).verdict);
  const evidenceVerdicts = options.decisions
    .filter((decision) => decision.kind === "target-evidence" && decision.midi === midi)
    .map((decision) => (decision as { verdict: ChordMatcherEvidenceVerdict }).verdict);
  const evidence = listenPitchEvidenceInWindow(frames, midi, windowStartMs, windowEndMs);
  const qualifiedByOnset = onsetVerdicts.includes("accepted");
  const qualifiedByEvidence = evidenceVerdicts.includes("accepted");
  const onsetVerdict = limitingVerdict(onsetVerdicts, ONSET_VERDICT_PRIORITY, "accepted");
  const evidenceVerdict = limitingVerdict(evidenceVerdicts, EVIDENCE_VERDICT_PRIORITY, "accepted");
  const activeConfidence = (frameAtOrBefore(frames, windowEndMs)?.activePitches ?? [])
    .find((entry) => entry.midi === midi)?.confidence ?? null;
  return {
    midi,
    role: options.isBass ? "bass" : "upper",
    onsetConfidence: evidence.onsetConfidence,
    onsetNoteConfidence: evidence.onsetNoteConfidence,
    onsetTimeMs: evidence.onsetTimeMs,
    targetEvidence: evidence.targetEvidence,
    activeMembership: activeConfidence !== null,
    activeConfidence,
    onsetVerdicts: verdictCounts(onsetVerdicts, ONSET_VERDICT_PRIORITY),
    evidenceVerdicts: verdictCounts(evidenceVerdicts, EVIDENCE_VERDICT_PRIORITY),
    limitingOnsetVerdict: onsetVerdict,
    limitingEvidenceVerdict: evidenceVerdict,
    qualified: qualifiedByOnset || qualifiedByEvidence,
    path: pitchPath(qualifiedByOnset, qualifiedByEvidence, onsetVerdict, evidenceVerdict),
    onsetGatesCleared: LISTEN_BASS_ONSET_GATES
      .filter((gate) => (evidence.onsetConfidence ?? -1) >= gate),
    onsetGatesRefusing: LISTEN_BASS_ONSET_GATES
      .filter((gate) => (evidence.onsetConfidence ?? -1) < gate),
    insideHallucinationCorridor: isInsideListenHallucinationCorridor(evidence.onsetConfidence),
    activeGatesCleared: LISTEN_ACTIVE_TARGET_GATES
      .filter((gate) => evidence.targetEvidence >= gate),
    activeGatesRefusing: LISTEN_ACTIVE_TARGET_GATES
      .filter((gate) => evidence.targetEvidence < gate),
  };
}

/**
 * The per-pitch qualification record of every physical attack that plays one
 * exact chord, under one profile.
 *
 * Attacks rather than targets are the unit: while the matcher stalls on a
 * repeated chord it stays armed on the first of them, so the second and third
 * repetitions are attacks that produced evidence for a target they did not
 * belong to. Reporting by target would hide exactly those repetitions.
 */
export function listenRepeatedChordAttackRecords(
  identity: ListenBassTraceIdentity,
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
  profile: ListenMatcherThresholds,
  chordPitches: readonly number[],
): ListenRepeatedChordAttackRecord[] {
  const chord = [...chordPitches].sort((left, right) => left - right);
  const chordKey = chord.join("+");
  const { advancements, decisions } = observeListenSequenceQualification(sequence, trace, profile);
  return sequence.attacks
    .filter((attack) => [...attack.playedPitches].sort((left, right) => left - right)
      .join("+") === chordKey)
    .map((attack): ListenRepeatedChordAttackRecord => {
      const { windowStartMs, windowEndMs } = listenAttackEvidenceWindow(sequence, attack);
      const inWindow = decisions.filter(({ decision }) => (
        decision.kind === "onset"
          ? decision.onsetTimeMs >= windowStartMs && decision.onsetTimeMs <= windowEndMs
          : decision.capturedAtMs >= windowStartMs && decision.capturedAtMs <= windowEndMs
      ));
      const armedTargetIndex = inWindow[0]?.context.targetIndex ?? null;
      const armedTarget = armedTargetIndex === null
        ? null
        : sequence.targets[armedTargetIndex] ?? null;
      const armedTargetPitches = [...(armedTarget?.pitches ?? chord)]
        .sort((left, right) => left - right);
      const previousAttack = sequence.attacks
        .find(({ index }) => index === attack.index - 1) ?? null;
      const previousAttackPitches = [...(previousAttack?.playedPitches ?? [])]
        .sort((left, right) => left - right);
      const frameBefore = frameAtOrBefore(trace.frames, windowStartMs);
      const soundingBefore = new Map(
        (frameBefore?.activePitches ?? []).map(({ midi, confidence }) => [midi, confidence]),
      );
      const advancement = advancements
        .find(({ atMs }) => atMs >= windowStartMs && atMs <= windowEndMs) ?? null;
      const advancedTarget = advancement === null
        ? null
        : sequence.targets[advancement.targetIndex] ?? null;
      const bass = chord[0];
      const chordIsArmedTarget = armedTargetPitches.join("+") === chordKey;
      // The chord's own pitches are the unit, not the armed target's: while a
      // run is stalled elsewhere the repetition still sounds, and its decoded
      // evidence is exactly what a later decision needs to see.
      const pitches = chord.map((midi): ListenRepeatedChordPitchRecord => ({
        ...listenPitchQualificationRecord({
          midi,
          isBass: midi === bass && chord.length >= 3,
          frames: trace.frames,
          decisions: inWindow.map(({ decision }) => decision),
          windowStartMs,
          windowEndMs,
        }),
        soundingBeforeAttack: soundingBefore.has(midi),
        playedByPreviousAttack: previousAttackPitches.includes(midi),
        isArmedTargetPitch: armedTargetPitches.includes(midi),
      }));
      const unexpectedNote = inWindow.some(({ decision }) => (
        decision.kind === "onset" && decision.verdict === "unexpected-note"
      ));
      const limitingPitches = pitches.filter(({ qualified }) => !qualified);
      const limitingPaths = [...new Set<ListenTargetQualificationPath>([
        ...(chordIsArmedTarget ? [] : ["target-not-armed" as const]),
        ...(unexpectedNote && chordIsArmedTarget ? ["unexpected-note-rejection" as const] : []),
        ...(chordIsArmedTarget
          ? limitingPitches.map(({ path }) => targetPathForPitch(path))
          : []),
      ])].sort((left, right) =>
        TARGET_PATH_PRIORITY.indexOf(left) - TARGET_PATH_PRIORITY.indexOf(right));
      const limitingUpperEvidence = limitingPitches
        .filter(({ role }) => role === "upper")
        .map(({ targetEvidence }) => targetEvidence);
      const advancedFromThisWindow = advancement !== null;
      return {
        ...identity,
        profile,
        attackIndex: attack.index,
        attackTargetIndex: attack.targetIndex,
        scheduledAtMs: attack.scheduledAtMs,
        playedPitches: [...attack.playedPitches].sort((left, right) => left - right),
        armedTargetIndex,
        armedTargetPitches,
        chordIsArmedTarget,
        role: previousAttackPitches.join("+") === chordKey ? "exact-repetition" : "transition",
        previousAttackPitches,
        carriedPitches: chord.filter((midi) => soundingBefore.has(midi)),
        freshPitches: chord.filter((midi) => !soundingBefore.has(midi)),
        advanced: advancedFromThisWindow,
        advancedTargetIndex: advancement?.targetIndex ?? null,
        advancedAtMs: advancement?.atMs ?? null,
        sourceDistance: advancement === null
          ? null
          : attack.targetIndex - advancement.targetIndex,
        attributionDelayMs: advancement === null || advancedTarget === null
          ? null
          : advancement.atMs - advancedTarget.scheduledAttackTimeMs,
        pitches,
        limitingPaths: advancedFromThisWindow && limitingPaths.length === 0
          ? ["advanced"]
          : limitingPaths,
        primaryLimitingPath: advancedFromThisWindow && limitingPaths.length === 0
          ? "advanced"
          : limitingPaths[0] ?? "other-fixed-policy",
        limitingPitches: limitingPitches.map(({ midi }) => midi),
        lowestLimitingUpperVoiceEvidence: limitingUpperEvidence.length === 0
          ? null
          : Math.min(...limitingUpperEvidence),
      };
    });
}

/* ------------------------------------------------------------------------- *
 * What the repeated chord costs today
 * ------------------------------------------------------------------------- */

/** One repeated-chord target's outcome under one profile. */
export interface ListenRepeatedChordTargetRecovery {
  targetIndex: number;
  targetPitches: number[];
  scheduledAttackTimeMs: number;
  advanced: boolean;
  advancedAtMs: number | null;
  sourceAttackIndex: number | null;
  sourceAttackTargetIndex: number | null;
  /** Targets between the recovering attack and the target it completed. */
  sourceDistance: number | null;
  /** Delay from the target's own physical attack to its advancement. */
  attributionDelayMs: number | null;
  classification: ListenRepeatedChordClassification[];
}

export type ListenRepeatedChordClassification =
  | "false-advance"
  | "skipped-advance"
  | "duplicate-advance"
  | "late-advance";

/**
 * Every target whose chord is the repeated one, with the distance and delay its
 * recovery actually cost. This is the shipped behaviour of the incumbent, not a
 * candidate regression: no measured profile reaches source distance 0.
 */
export function listenRepeatedChordRecoveries(
  sequence: MaterializedListenSequence,
  run: ListenSequenceRunResult,
  advancements: readonly ListenSequenceAdvancementRecord[],
  chordPitches: readonly number[],
): ListenRepeatedChordTargetRecovery[] {
  const chordKey = [...chordPitches].sort((left, right) => left - right).join("+");
  return sequence.targets
    .filter((target) => [...target.pitches].sort((left, right) => left - right)
      .join("+") === chordKey)
    .map((target): ListenRepeatedChordTargetRecovery => {
      const event = run.events[target.index];
      const advancement = advancements
        .find(({ targetIndex }) => targetIndex === target.index) ?? null;
      const sourceAttack = advancement?.sourceAttackIndex === null ||
          advancement?.sourceAttackIndex === undefined
        ? null
        : sequence.attacks[advancement.sourceAttackIndex] ?? null;
      const classification: ListenRepeatedChordClassification[] = [];
      if (event?.falseAdvance) classification.push("false-advance");
      if (event?.skipped) classification.push("skipped-advance");
      if (event?.duplicate) classification.push("duplicate-advance");
      if (event?.lateAdvance) classification.push("late-advance");
      return {
        targetIndex: target.index,
        targetPitches: [...target.pitches].sort((left, right) => left - right),
        scheduledAttackTimeMs: target.scheduledAttackTimeMs,
        advanced: event?.advanced ?? false,
        advancedAtMs: event?.advancedAtMs ?? null,
        sourceAttackIndex: advancement?.sourceAttackIndex ?? null,
        sourceAttackTargetIndex: sourceAttack?.targetIndex ?? null,
        sourceDistance: sourceAttack === null
          ? null
          : sourceAttack.targetIndex - target.index,
        attributionDelayMs: advancement === null
          ? null
          : advancement.atMs - target.scheduledAttackTimeMs,
        classification,
      };
    });
}

/* ------------------------------------------------------------------------- *
 * The sixteen version-1 counterfactual profiles
 * ------------------------------------------------------------------------- */

/**
 * The high-onset, open-active corner: onset 0.60, target 0.50, active 0.20,
 * fresh bass required, one profile per extra-note value in the grid. The Task 08
 * archive rejected all four, so these are diagnostics rather than candidates.
 */
export const LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS: readonly string[] = Object.freeze([
  "o0p600-t0p500-a0p200-x0p900-b1",
  "o0p600-t0p500-a0p200-x0p940-b1",
  "o0p600-t0p500-a0p200-x0p970-b1",
  "o0p600-t0p500-a0p200-x0p990-b1",
]);

/**
 * The twelve profiles that hold onset at 0.60 and active at 0.275 with fresh
 * bass required and that passed round-one safety. The 0.99 extra-note column is
 * absent because none of it survived.
 */
export const LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS: readonly string[] = Object.freeze([
  "o0p600-t0p350-a0p275-x0p900-b1",
  "o0p600-t0p350-a0p275-x0p940-b1",
  "o0p600-t0p350-a0p275-x0p970-b1",
  "o0p600-t0p425-a0p275-x0p900-b1",
  "o0p600-t0p425-a0p275-x0p940-b1",
  "o0p600-t0p425-a0p275-x0p970-b1",
  "o0p600-t0p500-a0p275-x0p900-b1",
  "o0p600-t0p500-a0p275-x0p940-b1",
  "o0p600-t0p500-a0p275-x0p970-b1",
  "o0p600-t0p575-a0p275-x0p900-b1",
  "o0p600-t0p575-a0p275-x0p940-b1",
  "o0p600-t0p575-a0p275-x0p970-b1",
]);

export const LISTEN_COUNTERFACTUAL_PROFILE_IDS: readonly string[] = Object.freeze([
  ...LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS,
  ...LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS,
]);

/**
 * The sixteen counterfactual profiles, resolved from the frozen version-1 grid.
 *
 * Every coordinate is checked against the grid rather than reconstructed from
 * its identifier, so a renamed or regenerated grid fails here instead of
 * quietly measuring a different profile than the one the report names.
 */
export function listenCounterfactualProfiles(): ListenMatcherSweepProfile[] {
  const grid = new Map(generateListenMatcherSweepProfiles().map((profile) => [profile.id, profile]));
  if (new Set(LISTEN_COUNTERFACTUAL_PROFILE_IDS).size !== LISTEN_COUNTERFACTUAL_PROFILE_IDS.length) {
    throw new Error("The counterfactual profile list names the same profile twice.");
  }
  return LISTEN_COUNTERFACTUAL_PROFILE_IDS.map((id) => {
    const profile = grid.get(id);
    if (!profile) throw new Error(`The version-1 grid has no profile ${id}.`);
    if (profile.onsetThreshold !== LISTEN_INCUMBENT_ONSET_GATE) {
      throw new Error(`${id} does not hold the fresh-onset gate at ${LISTEN_INCUMBENT_ONSET_GATE}.`);
    }
    if (!profile.requireFreshBassOnset) {
      throw new Error(`${id} does not require a fresh bass onset.`);
    }
    const open = LISTEN_OPEN_ACTIVE_COUNTERFACTUAL_IDS.includes(id);
    if (open && profile.activeTargetThreshold !== 0.2) {
      throw new Error(`${id} is listed as open-active but holds the active gate at ` +
        `${profile.activeTargetThreshold}.`);
    }
    if (!open && profile.activeTargetThreshold !== 0.275) {
      throw new Error(`${id} is listed as held-active but holds the active gate at ` +
        `${profile.activeTargetThreshold}.`);
    }
    if (!open && profile.extraNoteThreshold === 0.99) {
      throw new Error(`${id} names the 0.99 extra-note column, none of which passed round one.`);
    }
    return profile;
  });
}

/**
 * What the frozen Task 08 archive already decided about each counterfactual, on
 * the version-1 discovery corpus.
 *
 * These values are quoted, not re-derived: the archive is the measured record of
 * round one, and `listenBassQualification.test.ts` checks every field of every
 * row against `benchmark-results/listen-matcher-multidomain-sweep-task08.json`
 * so a stale quotation fails rather than misinforming a later decision.
 */
export interface ListenArchivedDiscoveryVerdict {
  profileId: string;
  passed: boolean;
  rejectionCodes: string[];
  /** Scored discovery traces made unsafe in a way `baseline-v1` is not. */
  discoveryRegressionTraceIds: string[];
  regressionRunLateAdvanceCount: number;
  committedRegressionPassed: boolean;
  committedRegressionDeviationCount: number;
}

export const LISTEN_ARCHIVED_DISCOVERY_VERDICTS:
  readonly ListenArchivedDiscoveryVerdict[] = Object.freeze([
    Object.freeze({
      profileId: "o0p600-t0p500-a0p200-x0p900-b1",
      passed: false,
      rejectionCodes: ["discovery-safety-regression"],
      discoveryRegressionTraceIds: [
        "sequence/tone/course-clear-27/167ms",
        "dynamics-constant/tone/salamander/v14",
      ],
      regressionRunLateAdvanceCount: 1,
      committedRegressionPassed: true,
      committedRegressionDeviationCount: 0,
    }),
    Object.freeze({
      profileId: "o0p600-t0p500-a0p200-x0p940-b1",
      passed: false,
      rejectionCodes: ["discovery-safety-regression"],
      discoveryRegressionTraceIds: [
        "sequence/tone/course-clear-27/167ms",
        "dynamics-constant/tone/salamander/v14",
      ],
      regressionRunLateAdvanceCount: 1,
      committedRegressionPassed: true,
      committedRegressionDeviationCount: 0,
    }),
    Object.freeze({
      profileId: "o0p600-t0p500-a0p200-x0p970-b1",
      passed: false,
      rejectionCodes: ["discovery-safety-regression"],
      discoveryRegressionTraceIds: [
        "sequence/tone/course-clear-27/167ms",
        "dynamics-constant/tone/salamander/v14",
      ],
      regressionRunLateAdvanceCount: 1,
      committedRegressionPassed: true,
      committedRegressionDeviationCount: 0,
    }),
    Object.freeze({
      profileId: "o0p600-t0p500-a0p200-x0p990-b1",
      passed: false,
      rejectionCodes: ["discovery-safety-regression", "committed-regression"],
      discoveryRegressionTraceIds: [
        "sequence/tone/course-clear-27/333ms",
        "sequence/tone/course-clear-27/167ms",
        "dynamics-constant/tone/salamander/v14",
      ],
      regressionRunLateAdvanceCount: 1,
      committedRegressionPassed: false,
      committedRegressionDeviationCount: 1,
    }),
    ...LISTEN_HELD_ACTIVE_COUNTERFACTUAL_IDS.map((profileId) => Object.freeze({
      profileId,
      passed: true,
      rejectionCodes: [] as string[],
      discoveryRegressionTraceIds: [] as string[],
      regressionRunLateAdvanceCount: 1,
      committedRegressionPassed: true,
      committedRegressionDeviationCount: 0,
    })),
  ]);

export function listenArchivedDiscoveryVerdict(profileId: string): ListenArchivedDiscoveryVerdict {
  const verdict = LISTEN_ARCHIVED_DISCOVERY_VERDICTS
    .find((entry) => entry.profileId === profileId);
  if (!verdict) throw new Error(`No archived round-one verdict was quoted for ${profileId}.`);
  return verdict;
}

/* ------------------------------------------------------------------------- *
 * Isolated fixtures
 * ------------------------------------------------------------------------- */

/** One isolated fixture's per-pitch qualification under one profile. */
export interface ListenIsolatedQualificationRecord {
  traceId: string;
  suite: ListenTraceSuite;
  partition: ListenTracePartition;
  rendererKey: ListenTraceRendererKey;
  profile: ListenMatcherThresholds;
  targetPitches: number[];
  playedPitches: number[];
  bassMidi: number;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  pitches: ListenPitchQualificationRecord[];
  /**
   * Required pitches the matcher admitted although the fixture never sounded
   * them. A non-empty list on an advanced fixture is a hallucinated completion.
   */
  hallucinatedQualifiedPitches: number[];
  limitingPaths: ListenTargetQualificationPath[];
  primaryLimitingPath: ListenTargetQualificationPath;
  limitingPitches: number[];
}

/**
 * Replays one isolated fixture under one profile and records why each required
 * pitch was admitted or refused.
 *
 * The replay runs twice, once observed and once not, and both must reach the
 * same verdict: the qualification paths reported here describe the measured
 * trial rather than an instrumented variant of it.
 */
export function listenIsolatedQualificationRecord(
  identity: ListenBassTraceIdentity,
  targetPitches: readonly number[],
  playedPitches: readonly number[],
  trace: ListenRecognitionTrace,
  profile: ListenMatcherThresholds,
  generation: number,
): ListenIsolatedQualificationRecord {
  const target = [...targetPitches].sort((left, right) => left - right);
  const played = [...playedPitches].sort((left, right) => left - right);
  const decisions: ChordMatcherDecision[] = [];
  const observed = replayIsolatedListenTrace({
    trace,
    targetPitches: target,
    generation,
    profile,
    matcherObserver: (decision) => decisions.push(decision),
  });
  const unobserved = replayIsolatedListenTrace({
    trace,
    targetPitches: target,
    generation,
    profile,
  });
  if (
    observed.advanced !== unobserved.advanced ||
    observed.onsetToAdvanceMs !== unobserved.onsetToAdvanceMs
  ) {
    throw new Error(
      `Observing ${identity.traceId} changed its replay, so its recorded qualification ` +
      "paths do not describe the measured trial.",
    );
  }
  const windowEndMs = trace.frames.length === 0
    ? 0
    : trace.frames[trace.frames.length - 1].capturedAtMs;
  const bassMidi = target[0];
  const pitches = target.map((midi) => listenPitchQualificationRecord({
    midi,
    isBass: midi === bassMidi && target.length >= 3,
    frames: trace.frames,
    decisions,
    windowStartMs: 0,
    windowEndMs,
  }));
  const unexpectedNote = decisions.some((decision) => (
    decision.kind === "onset" && decision.verdict === "unexpected-note"
  ));
  const limitingPitches = pitches.filter(({ qualified }) => !qualified);
  const limitingPaths = [...new Set<ListenTargetQualificationPath>([
    ...(unexpectedNote ? ["unexpected-note-rejection" as const] : []),
    ...limitingPitches.map(({ path }) => targetPathForPitch(path)),
  ])].sort((left, right) =>
    TARGET_PATH_PRIORITY.indexOf(left) - TARGET_PATH_PRIORITY.indexOf(right));
  return {
    ...identity,
    profile,
    targetPitches: target,
    playedPitches: played,
    bassMidi,
    advanced: observed.advanced,
    onsetToAdvanceMs: observed.onsetToAdvanceMs,
    pitches,
    hallucinatedQualifiedPitches: pitches
      .filter(({ midi, qualified }) => qualified && !played.includes(midi))
      .map(({ midi }) => midi),
    limitingPaths: observed.advanced && limitingPaths.length === 0 ? ["advanced"] : limitingPaths,
    primaryLimitingPath: observed.advanced && limitingPaths.length === 0
      ? "advanced"
      : limitingPaths[0] ?? "other-fixed-policy",
    limitingPitches: limitingPitches.map(({ midi }) => midi),
  };
}
