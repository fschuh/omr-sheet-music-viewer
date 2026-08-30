import { LISTEN_BENCHMARK_RELEASE_MS } from "./listenBenchmarkAudio";
import { OnlineAmtOutputDecoder } from "../../onlineAmtOutput";
import {
  disabledOnlineAmtRetriggerOptions,
  OnlineAmtScoreRiseRetriggerDetector,
  onlineAmtActiveProbability,
  onlineAmtAttackProbability,
  type OnlineAmtRetriggerOptions,
} from "../../onlineAmtRetriggerDetector";
import {
  assignRecognitionEventsToAttacks,
  bundledListenSequences,
  courseClearArticulationDefinitions,
  LISTEN_ATTACK_BOUNDARY_EPSILON_MS,
  materializeListenSequence,
  productionListenMatcherProfile,
  replayListenSequenceTrace,
  type ListenArticulationMatrixResult,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceArticulation,
  type ListenSequenceBenchmarkResult,
  type ListenSequenceFailureReason,
  type ListenSequenceRunResult,
  type MaterializedListenSequence,
  type RecognizedAttackObservation,
  type RequiredAttackType,
  type ScheduledSequenceAttack,
  type ScheduledSequenceNote,
} from "./listenSequenceBenchmark";
import { summarizeListenSafety } from "./listenSafetyRegression";
import type { ListenThresholdSweepResult } from "./listenMatcherSweepBenchmark";
import {
  LISTEN_MATCHER_PROFILES,
  listenMatcherThresholds,
  type ListenMatcherThresholds,
} from "../listenMatcherProfiles";

const FIRST_PIANO_MIDI = 21;
const STATE_COUNT = 5;
const FRAME_MS = 32;
const ASSIGNMENT_MS = 450;
const ACTIVE_STATES = new Set([2, 3, 4]);
const retainedScores = new WeakMap<ListenRecognitionFrame, Float32Array>();
const retainedStates = new WeakMap<ListenRecognitionFrame, Uint8Array>();

export const LISTEN_RETRIGGER_PEAK_THRESHOLDS = [0.35, 0.45, 0.55, 0.65] as const;
export const LISTEN_RETRIGGER_RISE_THRESHOLDS = [0.10, 0.20, 0.30, 0.40] as const;
export const LISTEN_RETRIGGER_REARM_THRESHOLDS = [0.10, 0.20, 0.30] as const;
export const LISTEN_RETRIGGER_LOOKBACK_FRAMES = [3, 5, 8] as const;
export const LISTEN_RETRIGGER_REFRACTORY_FRAMES = [2, 3, 4] as const;

/**
 * Newest safe threshold-sweep recommendation recorded in LISTEN_BENCHMARK.md.
 * It is the registry's sensitive candidate, named explicitly so this historical
 * reference cannot follow a later change to the production default.
 */
export const thresholdSweepRecommendedListenMatcherProfile: Readonly<ListenMatcherThresholds> =
  listenMatcherThresholds(LISTEN_MATCHER_PROFILES["sensitive-v1"]);

export interface ListenRetriggerCandidateOptions extends OnlineAmtRetriggerOptions {
  id: string;
}

export interface SyntheticScoreRiseEvent {
  frameIndex: number;
  midi: number;
  capturedAtMs: number;
  attackProbability: number;
  activeProbability: number;
  hardState: "sustain";
}

export interface RedecodedListenRecognitionTrace {
  trace: ListenRecognitionTrace;
  syntheticEvents: SyntheticScoreRiseEvent[];
  productionParity: boolean;
}

export interface ListenRetriggerCorpusEntry {
  key: string;
  source: "continuous-sequence" | "course-clear-articulation";
  articulation: ListenSequenceArticulation | null;
  sequence: MaterializedListenSequence;
  trace: ListenRecognitionTrace;
  baselineRun: ListenSequenceRunResult;
}

export type ListenRetriggerOpportunityClassification =
  | "hidden-rise-under-sustain"
  | "no-attack-score-rise"
  | "decoder-event-below-matcher-threshold"
  | "decoder-event-blocked-by-matcher"
  | "already-recognized";

export interface ListenRetriggerAuditFrame {
  frameIndex: number;
  capturedAtMs: number;
  hardState: number;
  attackProbability: number;
  activeProbability: number;
}

export interface ListenRetriggerOpportunity {
  corpusKey: string;
  sequenceId: string;
  family: string;
  intervalMs: number;
  articulation: ListenSequenceArticulation | null;
  attackIndex: number;
  scheduledNoteId: string;
  midi: number;
  scheduledAttackTimeMs: number;
  expectedTransitionType: RequiredAttackType;
  observedTransitionType: RequiredAttackType | null;
  naturalAttackAssigned: boolean;
  maximumAttackProbability: number;
  preAttackLocalMinimum: number;
  maximumProbabilityRise: number;
  maximumOneFrameSlope: number;
  maximumActiveConfidence: number;
  hardStatesAroundAttack: ListenRetriggerAuditFrame[];
  matcherFailureClassification: ListenSequenceFailureReason | null;
  classification: ListenRetriggerOpportunityClassification;
}

export type ListenRetriggerAuditConclusionCode =
  | "hidden-score-rise-found"
  | "no-hidden-score-rise"
  | "no-safe-separation";

export interface ListenRetriggerOpportunityAudit {
  conclusion: ListenRetriggerAuditConclusionCode;
  opportunities: ListenRetriggerOpportunity[];
  classificationCounts: Record<ListenRetriggerOpportunityClassification, number>;
  hiddenRiseCount: number;
}

export interface SyntheticEventAssignment extends SyntheticScoreRiseEvent {
  corpusKey: string;
  sequenceId: string;
  family: string;
  intervalMs: number;
  articulation: ListenSequenceArticulation | null;
  assignedScheduledNoteId: string | null;
  assignedAttackIndex: number | null;
  assignedExpectedAdvance: boolean;
  recoveredMissingPhysicalAttack: boolean;
  duplicateNaturalAttack: boolean;
  unassigned: boolean;
  duringHeldNote: boolean;
  duringReleaseTail: boolean;
  duringLegatoNonsharedTransition: boolean;
  duringIncompleteCarriedBassAttack: boolean;
  latencyMs: number | null;
  recoveryFamilies: string[];
}

export interface ListenRetriggerDecoderMetrics {
  missingPhysicalAttacksInProduction: number;
  recoveredMissingPhysicalAttacks: number;
  recoveryRate: number;
  syntheticEventCount: number;
  assignedSyntheticEventCount: number;
  unassignedSyntheticEventCount: number;
  duplicateNaturalEventCount: number;
  heldNoteSyntheticEventCount: number;
  releaseTailSyntheticEventCount: number;
  legatoNonsharedSyntheticEventCount: number;
  incompleteCarriedBassSyntheticEventCount: number;
  naturalEventStreamDifferenceCount: number;
  p50SyntheticLatencyMs: number | null;
  p95SyntheticLatencyMs: number | null;
  recoveriesByFamily: Record<string, number>;
  recoveriesBySpeed: Record<string, number>;
  recoveriesByArticulation: Partial<Record<ListenSequenceArticulation, number>>;
  syntheticEvents: SyntheticEventAssignment[];
}

export interface ListenRetriggerMatcherMetrics {
  rawPhysicalAttackEvidence: number;
  independentMatchCount: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  completePassageCount: number;
  retriggerNotDetectedCount: number;
  missingRequiredBassOnsetCount: number;
  carryOverCount: number;
  recognizedButBlockedCount: number;
  cascadeLossCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  incompleteCarriedBassAdvances: number;
  p50IndependentMatchLatencyMs: number | null;
  p95IndependentMatchLatencyMs: number | null;
  p50OrderedAdvanceLatencyMs: number | null;
  p95OrderedAdvanceLatencyMs: number | null;
  independentAt1000Ms: number;
  speedSummaries: ListenRetriggerGroupMetrics[];
  articulationSummaries: ListenRetriggerGroupMetrics[];
  safetyPassed: boolean;
}

export interface ListenRetriggerGroupMetrics {
  label: string;
  expectedEventCount: number;
  independentMatchCount: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  completePassageCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
}

export interface ListenRetriggerMatcherProfileEvaluation {
  label: "production" | "threshold-recommendation";
  profile: ListenMatcherThresholds;
  baseline: ListenRetriggerMatcherMetrics;
  candidate: ListenRetriggerMatcherMetrics;
  independentMatchDelta: number;
  orderedAdvanceDelta: number;
  orderedPrefixDelta: number;
  completePassageDelta: number;
  targetedFailureReduction: number;
  passed: boolean;
  rejectionReasons: string[];
}

export interface ListenRetriggerCandidateResult {
  options: ListenRetriggerCandidateOptions;
  decoder: ListenRetriggerDecoderMetrics;
  matcherProfiles: ListenRetriggerMatcherProfileEvaluation[];
  rejectedByDecoderSafety: boolean;
  rejectedByMatcherSafety: boolean;
  eligible: boolean;
  rejectionReasons: string[];
}

export interface ListenRetriggerTraceIdentity {
  corpusKey: string;
  source: ListenRetriggerCorpusEntry["source"];
  sequenceId: string;
  intervalMs: number;
  articulation: ListenSequenceArticulation | null;
  pcmHash: string | null;
  pcmByteLength: number;
  frameCount: number;
  resetMode: string;
}

export interface ListenRetriggerSweepResult {
  renderer: ListenSequenceBenchmarkResult["renderer"];
  benchmarkOnly: true;
  productionEnabled: false;
  replayParityVerified: true;
  traceIdentities: ListenRetriggerTraceIdentity[];
  audit: ListenRetriggerOpportunityAudit;
  gridSize: number;
  candidatesEvaluated: number;
  uniqueSyntheticStreamsEvaluated: number;
  candidatesRejectedByDecoderSafety: number;
  candidatesRejectedByMatcherSafety: number;
  matcherProfiles: Array<{
    label: "production" | "threshold-recommendation";
    profile: ListenMatcherThresholds;
    baseline: ListenRetriggerMatcherMetrics;
  }>;
  candidates: ListenRetriggerCandidateResult[];
  eligibleCandidates: ListenRetriggerCandidateResult[];
  recommendation: ListenRetriggerCandidateResult | null;
  diagnosticCandidate: ListenRetriggerCandidateResult | null;
  conclusion: {
    code: "safe-benchmark-candidate" | "no-hidden-score-rise" |
      "no-safe-separation" | "no-candidate-passed-all-gates";
    text: string;
  };
}

function stableProbability(value: number): string {
  return value.toFixed(3).replace(".", "p");
}

/** Generates the fixed 432-profile grid and rejects invalid relationships. */
export function generateListenRetriggerCandidates(): ListenRetriggerCandidateOptions[] {
  const candidates: ListenRetriggerCandidateOptions[] = [];
  for (const peakThreshold of LISTEN_RETRIGGER_PEAK_THRESHOLDS) {
    for (const riseThreshold of LISTEN_RETRIGGER_RISE_THRESHOLDS) {
      for (const rearmThreshold of LISTEN_RETRIGGER_REARM_THRESHOLDS) {
        if (rearmThreshold >= peakThreshold) continue;
        for (const lookbackFrames of LISTEN_RETRIGGER_LOOKBACK_FRAMES) {
          for (const refractoryFrames of LISTEN_RETRIGGER_REFRACTORY_FRAMES) {
            candidates.push({
              id: `p${stableProbability(peakThreshold)}-r${stableProbability(riseThreshold)}-a${stableProbability(rearmThreshold)}-l${lookbackFrames}-f${refractoryFrames}`,
              enabled: true,
              peakThreshold,
              riseThreshold,
              rearmThreshold,
              lookbackFrames,
              refractoryFrames,
            });
          }
        }
      }
    }
  }
  return candidates;
}

function decodedFrameSignature(frame: ListenRecognitionFrame): string {
  return JSON.stringify({
    onsets: frame.onsets,
    noteEvents: frame.noteEvents,
    activePitches: frame.activePitches,
    confidenceEvidence: frame.confidenceEvidence,
  });
}

/** Re-decodes retained raw scores/states and never touches PCM or inference. */
export function redecodeListenRecognitionTrace(
  trace: ListenRecognitionTrace,
  decoderOptions: Partial<OnlineAmtRetriggerOptions> = disabledOnlineAmtRetriggerOptions,
): RedecodedListenRecognitionTrace {
  const normalizedOptions = { ...disabledOnlineAmtRetriggerOptions, ...decoderOptions };
  const decoder = normalizedOptions.enabled ? null : new OnlineAmtOutputDecoder();
  const retriggerDetector = normalizedOptions.enabled
    ? new OnlineAmtScoreRiseRetriggerDetector(normalizedOptions)
    : null;
  decoder?.reset();
  retriggerDetector?.reset(88);
  const resetFrames = new Set(trace.resetPlan?.points.map(({ frameIndex }) => frameIndex) ?? []);
  const syntheticEvents: SyntheticScoreRiseEvent[] = [];
  let productionParity = true;
  const frames = trace.frames.map((frame, frameIndex): ListenRecognitionFrame => {
    if (resetFrames.has(frameIndex)) {
      decoder?.reset();
      retriggerDetector?.reset(88);
    }
    let scores = retainedScores.get(frame);
    if (!scores) {
      scores = new Float32Array(frame.modelScores);
      retainedScores.set(frame, scores);
    }
    let states = retainedStates.get(frame);
    if (!states) {
      states = new Uint8Array(frame.modelStates);
      retainedStates.set(frame, states);
    }
    const decoded = decoder
      ? decoder.decode(
        scores,
        states,
        frame.signalActive,
        frame.capturedAtMs,
        trace.relevantPitches,
      )
      : {
          onsets: frame.onsets.map((onset) => ({ ...onset })),
          noteEvents: frame.noteEvents.map((event) => ({ ...event })),
          recognizedActivePitches: frame.activePitches,
          targetPitchEvidence: frame.confidenceEvidence,
          noteStates: [],
        };
    retriggerDetector?.apply(decoded, scores, states, frame.signalActive, frame.capturedAtMs);
    const replacement: ListenRecognitionFrame = decoder ? (() => {
      const evidence = new Map(
        decoded.targetPitchEvidence.map(({ midi, confidence }) => [midi, confidence]),
      );
      return {
        ...frame,
        onsets: decoded.onsets.map((onset) => ({ ...onset })),
        noteEvents: decoded.noteEvents.map((event) => ({ ...event })),
        activePitches: decoded.recognizedActivePitches.map((pitch) => ({ ...pitch })),
        confidenceEvidence: trace.relevantPitches.map((midi) => ({
          midi,
          confidence: evidence.get(midi) ?? 0,
        })),
      };
    })() : {
      ...frame,
      onsets: decoded.onsets,
      noteEvents: decoded.noteEvents,
    };
    productionParity &&= decodedFrameSignature(frame) === decodedFrameSignature(replacement);
    for (const event of replacement.noteEvents) {
      const pitchIndex = event.midi - FIRST_PIANO_MIDI;
      if (event.type !== "reOnset" || frame.modelStates[pitchIndex] !== 2) continue;
      syntheticEvents.push({
        frameIndex,
        midi: event.midi,
        capturedAtMs: event.eventTimeMs,
        attackProbability: onlineAmtAttackProbability(scores, pitchIndex),
        activeProbability: onlineAmtActiveProbability(scores, pitchIndex),
        hardState: "sustain",
      });
    }
    return replacement;
  });
  return {
    trace: { ...trace, frames },
    syntheticEvents,
    productionParity,
  };
}

function sequenceForRun(run: ListenSequenceRunResult): MaterializedListenSequence {
  const definition = [...bundledListenSequences(), ...courseClearArticulationDefinitions()]
    .find(({ id }) => id === run.sequenceId);
  if (!definition) throw new Error(`Cannot reconstruct retrigger sequence ${run.sequenceId}.`);
  return materializeListenSequence(definition, run.intervalMs);
}

/** Combines the six-speed sequence corpus with all corrected articulation traces. */
export function buildListenRetriggerCorpus(
  sequenceResult: ListenSequenceBenchmarkResult,
  articulationResult: ListenArticulationMatrixResult,
): ListenRetriggerCorpusEntry[] {
  const sequenceEntries = sequenceResult.runs.map((run): ListenRetriggerCorpusEntry => ({
    key: `sequence:${run.sequenceId}:${run.intervalMs}`,
    source: "continuous-sequence",
    articulation: null,
    sequence: sequenceForRun(run),
    trace: run.trace,
    baselineRun: run,
  }));
  const articulationEntries = articulationResult.runs.map((profile): ListenRetriggerCorpusEntry => ({
    key: `articulation:${profile.articulation}:${profile.run.sequenceId}`,
    source: "course-clear-articulation",
    articulation: profile.articulation,
    sequence: sequenceForRun(profile.run),
    trace: profile.run.trace,
    baselineRun: profile.run,
  }));
  return [...sequenceEntries, ...articulationEntries];
}

function attackObservations(trace: ListenRecognitionTrace): RecognizedAttackObservation[] {
  return trace.frames.flatMap((frame) => frame.noteEvents.flatMap((event) => {
    if (event.type === "offset") return [];
    const onset = frame.onsets.find(({ midi }) => midi === event.midi);
    return [{
      midi: event.midi,
      timeMs: event.eventTimeMs,
      confidence: onset?.confidence ?? event.confidence,
      noteConfidence: onset?.noteConfidence ?? 0,
      type: event.type,
    } satisfies RecognizedAttackObservation];
  })).sort((left, right) => left.timeMs - right.timeMs || left.midi - right.midi);
}

function expectedTransitionType(
  note: ScheduledSequenceNote,
  scheduledNotes: readonly ScheduledSequenceNote[],
): RequiredAttackType {
  const previous = scheduledNotes
    .filter((candidate) => candidate.midi === note.midi && candidate.attackTimeMs < note.attackTimeMs)
    .sort((left, right) => right.attackTimeMs - left.attackTimeMs)[0];
  return previous && previous.releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS > note.attackTimeMs
    ? "reOnset"
    : "onset";
}

function frameEvidence(frame: ListenRecognitionFrame, midi: number): ListenRetriggerAuditFrame {
  const pitchIndex = midi - FIRST_PIANO_MIDI;
  const scores = new Float32Array(frame.modelScores);
  return {
    frameIndex: 0,
    capturedAtMs: frame.capturedAtMs,
    hardState: frame.modelStates[pitchIndex] ?? 0,
    attackProbability: frame.modelScores.length >= (pitchIndex + 1) * STATE_COUNT
      ? onlineAmtAttackProbability(scores, pitchIndex)
      : 0,
    activeProbability: frame.modelScores.length >= (pitchIndex + 1) * STATE_COUNT
      ? onlineAmtActiveProbability(scores, pitchIndex)
      : 0,
  };
}

function attributionEnd(sequence: MaterializedListenSequence, attack: ScheduledSequenceAttack): number {
  const next = sequence.attacks
    .filter(({ scheduledAtMs }) => scheduledAtMs > attack.scheduledAtMs)
    .sort((left, right) => left.scheduledAtMs - right.scheduledAtMs)[0];
  return Math.min(
    attack.scheduledAtMs + ASSIGNMENT_MS,
    (next?.scheduledAtMs ?? Infinity) - LISTEN_ATTACK_BOUNDARY_EPSILON_MS,
  );
}

function hiddenSustainRise(
  frames: readonly ListenRecognitionFrame[],
  midi: number,
  startIndex: number,
  endIndex: number,
  previousNaturalFrameIndex: number | null,
): boolean {
  if (previousNaturalFrameIndex === null) return false;
  for (let index = startIndex; index < endIndex; index += 1) {
    const current = frameEvidence(frames[index], midi);
    const previousState = frames[index - 1]?.modelStates[midi - FIRST_PIANO_MIDI] ?? 0;
    const recent = frames.slice(Math.max(0, index - 8), index)
      .map((frame) => frameEvidence(frame, midi).attackProbability);
    const localMinimum = recent.length === 0 ? current.attackProbability : Math.min(...recent);
    if (
      current.hardState === 2 &&
      ACTIVE_STATES.has(previousState) &&
      index - previousNaturalFrameIndex >= 2 &&
      current.attackProbability >= LISTEN_RETRIGGER_PEAK_THRESHOLDS[0] &&
      current.attackProbability - localMinimum >= LISTEN_RETRIGGER_RISE_THRESHOLDS[0] &&
      localMinimum <= LISTEN_RETRIGGER_REARM_THRESHOLDS.at(-1)!
    ) return true;
  }
  return false;
}

/** Audits every scheduled physical pitch attack before any candidate is accepted. */
export function auditListenRetriggerOpportunities(
  entries: readonly ListenRetriggerCorpusEntry[],
): ListenRetriggerOpportunityAudit {
  const opportunities: ListenRetriggerOpportunity[] = [];
  for (const entry of entries) {
    const scheduledNotes = entry.sequence.attacks.flatMap(({ notes }) => notes);
    const observations = attackObservations(entry.trace);
    const assignments = assignRecognitionEventsToAttacks(scheduledNotes, observations);
    for (const note of scheduledNotes) {
      const attack = entry.sequence.attacks[note.attackIndex];
      const assignment = assignments.get(note.id);
      const startIndex = Math.max(0, entry.trace.frames.findIndex(({ capturedAtMs }) => (
        capturedAtMs >= note.attackTimeMs - FRAME_MS
      )));
      let endIndex = entry.trace.frames.findIndex(({ capturedAtMs }) => (
        capturedAtMs > attributionEnd(entry.sequence, attack)
      ));
      if (endIndex < 0) endIndex = entry.trace.frames.length;
      const aroundStart = Math.max(0, startIndex - 8);
      const aroundEnd = Math.min(entry.trace.frames.length, endIndex + 1);
      const hardStatesAroundAttack = entry.trace.frames.slice(aroundStart, aroundEnd)
        .map((frame, offset) => ({
          ...frameEvidence(frame, note.midi),
          frameIndex: aroundStart + offset,
        }));
      const before = hardStatesAroundAttack.filter(({ capturedAtMs }) => (
        capturedAtMs < note.attackTimeMs
      )).slice(-8);
      const inWindow = hardStatesAroundAttack.filter(({ capturedAtMs }) => (
        capturedAtMs >= note.attackTimeMs - FRAME_MS &&
        capturedAtMs <= attributionEnd(entry.sequence, attack)
      ));
      let maximumProbabilityRise = 0;
      let maximumOneFrameSlope = 0;
      for (let index = 0; index < inWindow.length; index += 1) {
        const globalIndex = inWindow[index].frameIndex;
        const recent = entry.trace.frames.slice(Math.max(0, globalIndex - 8), globalIndex)
          .map((frame) => frameEvidence(frame, note.midi).attackProbability);
        const localMinimum = recent.length === 0
          ? inWindow[index].attackProbability
          : Math.min(...recent);
        maximumProbabilityRise = Math.max(
          maximumProbabilityRise,
          inWindow[index].attackProbability - localMinimum,
        );
        const previous = entry.trace.frames[globalIndex - 1];
        maximumOneFrameSlope = Math.max(
          maximumOneFrameSlope,
          inWindow[index].attackProbability -
            (previous ? frameEvidence(previous, note.midi).attackProbability : 0),
        );
      }
      const previousNatural = observations
        .filter((observation) => observation.midi === note.midi && observation.timeMs < note.attackTimeMs)
        .sort((left, right) => right.timeMs - left.timeMs)[0];
      const previousNaturalFrameIndex = previousNatural
        ? entry.trace.frames.findIndex(({ capturedAtMs }) => capturedAtMs === previousNatural.timeMs)
        : null;
      const hiddenRise = assignment === undefined && hiddenSustainRise(
        entry.trace.frames,
        note.midi,
        startIndex,
        endIndex,
        previousNaturalFrameIndex !== null && previousNaturalFrameIndex >= 0
          ? previousNaturalFrameIndex
          : null,
      );
      const targetEvent = entry.baselineRun.events[attack.targetIndex];
      const pitchDiagnostic = targetEvent?.expectedPitches.find(({ midi }) => midi === note.midi);
      let classification: ListenRetriggerOpportunityClassification;
      if (!assignment) {
        classification = hiddenRise ? "hidden-rise-under-sustain" : "no-attack-score-rise";
      } else if (pitchDiagnostic && !pitchDiagnostic.thresholdQualified) {
        classification = "decoder-event-below-matcher-threshold";
      } else if (targetEvent && (!targetEvent.independentlyMatched || !targetEvent.orderedAdvanced)) {
        classification = "decoder-event-blocked-by-matcher";
      } else {
        classification = "already-recognized";
      }
      opportunities.push({
        corpusKey: entry.key,
        sequenceId: entry.sequence.definition.id,
        family: entry.sequence.definition.family,
        intervalMs: entry.sequence.intervalMs,
        articulation: entry.articulation,
        attackIndex: note.attackIndex,
        scheduledNoteId: note.id,
        midi: note.midi,
        scheduledAttackTimeMs: note.attackTimeMs,
        expectedTransitionType: expectedTransitionType(note, scheduledNotes),
        observedTransitionType: assignment?.type ?? null,
        naturalAttackAssigned: assignment !== undefined,
        maximumAttackProbability: Math.max(0, ...inWindow.map(({ attackProbability }) => attackProbability)),
        preAttackLocalMinimum: before.length === 0
          ? 0
          : Math.min(...before.map(({ attackProbability }) => attackProbability)),
        maximumProbabilityRise,
        maximumOneFrameSlope,
        maximumActiveConfidence: Math.max(0, ...inWindow.map(({ activeProbability }) => activeProbability)),
        hardStatesAroundAttack,
        matcherFailureClassification: targetEvent?.primaryFailure ?? null,
        classification,
      });
    }
  }
  const classifications: ListenRetriggerOpportunityClassification[] = [
    "hidden-rise-under-sustain",
    "no-attack-score-rise",
    "decoder-event-below-matcher-threshold",
    "decoder-event-blocked-by-matcher",
    "already-recognized",
  ];
  const classificationCounts = Object.fromEntries(classifications.map((classification) => [
    classification,
    opportunities.filter((opportunity) => opportunity.classification === classification).length,
  ])) as Record<ListenRetriggerOpportunityClassification, number>;
  const hiddenRiseCount = classificationCounts["hidden-rise-under-sustain"];
  return {
    conclusion: hiddenRiseCount === 0 ? "no-hidden-score-rise" : "hidden-score-rise-found",
    opportunities,
    classificationCounts,
    hiddenRiseCount,
  };
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * proportion) - 1];
}

function scheduledNoteForSynthetic(
  assignments: Map<string, RecognizedAttackObservation>,
  observations: readonly RecognizedAttackObservation[],
  event: SyntheticScoreRiseEvent,
  scheduledNotes: readonly ScheduledSequenceNote[],
): ScheduledSequenceNote | null {
  const observation = observations.find((candidate) => (
    candidate.midi === event.midi && candidate.timeMs === event.capturedAtMs &&
    candidate.type === "reOnset"
  ));
  if (!observation) return null;
  const assignedId = [...assignments].find(([, assigned]) => assigned === observation)?.[0];
  return scheduledNotes.find(({ id }) => id === assignedId) ?? null;
}

function physicalWindowContains(
  sequence: MaterializedListenSequence,
  note: ScheduledSequenceNote,
  timeMs: number,
): boolean {
  const attack = sequence.attacks[note.attackIndex];
  return timeMs >= note.attackTimeMs - FRAME_MS && timeMs <= attributionEnd(sequence, attack);
}

function recoveryFamilies(
  entry: ListenRetriggerCorpusEntry,
  note: ScheduledSequenceNote,
): string[] {
  const attack = entry.sequence.attacks[note.attackIndex];
  const previousAttack = entry.sequence.attacks[note.attackIndex - 1];
  const target = entry.sequence.targets[attack.targetIndex]?.pitches ?? [];
  const previousTarget = previousAttack
    ? entry.sequence.targets[previousAttack.targetIndex]?.pitches ?? []
    : [];
  const labels = new Set<string>();
  if (entry.sequence.definition.family === "repeated-notes") labels.add("repeated-notes");
  if (previousTarget.length === target.length && target.every((midi) => previousTarget.includes(midi))) {
    labels.add(target.length > 1 ? "repeated-chords" : "repeated-notes");
  }
  if (previousTarget.includes(note.midi)) {
    labels.add(note.midi === Math.min(...target) ? "shared-bass" : "shared-pitches");
  }
  if (entry.articulation === "legato") labels.add("legato");
  if (entry.sequence.definition.family.includes("course-clear")) labels.add("course-clear");
  return [...labels].sort();
}

function naturalStreamSignature(
  trace: ListenRecognitionTrace,
  synthetic: readonly SyntheticScoreRiseEvent[] = [],
): string {
  const keys = new Set(synthetic.map(({ midi, capturedAtMs }) => `${midi}:${capturedAtMs}`));
  return JSON.stringify(trace.frames.map((frame) => ({
    onsets: frame.onsets.filter(({ midi, onsetTimeMs }) => !keys.has(`${midi}:${onsetTimeMs}`)),
    noteEvents: frame.noteEvents.filter(({ midi, eventTimeMs, type }) => (
      type === "offset" || !keys.has(`${midi}:${eventTimeMs}`)
    )),
    activePitches: frame.activePitches,
    confidenceEvidence: frame.confidenceEvidence,
  })));
}

interface DecoderEvaluation {
  metrics: ListenRetriggerDecoderMetrics;
  traces: ListenRecognitionTrace[];
}

/** Evaluates synthetic output against physical attacks before invoking the matcher. */
export function evaluateListenRetriggerDecoderCandidate(
  entries: readonly ListenRetriggerCorpusEntry[],
  options: ListenRetriggerCandidateOptions,
): DecoderEvaluation {
  const syntheticEvents: SyntheticEventAssignment[] = [];
  const traces: ListenRecognitionTrace[] = [];
  let missingPhysicalAttacksInProduction = 0;
  let naturalEventStreamDifferenceCount = 0;
  for (const entry of entries) {
    const scheduledNotes = entry.sequence.attacks.flatMap(({ notes }) => notes);
    const baselineObservations = attackObservations(entry.trace);
    const baselineAssignments = assignRecognitionEventsToAttacks(scheduledNotes, baselineObservations);
    missingPhysicalAttacksInProduction += scheduledNotes.filter((note) => (
      entry.sequence.attacks[note.attackIndex].expectedAdvance && !baselineAssignments.has(note.id)
    )).length;
    const decoded = redecodeListenRecognitionTrace(entry.trace, options);
    traces.push(decoded.trace);
    if (naturalStreamSignature(entry.trace) !==
        naturalStreamSignature(decoded.trace, decoded.syntheticEvents)) {
      naturalEventStreamDifferenceCount += 1;
    }
    const observations = attackObservations(decoded.trace);
    const assignments = assignRecognitionEventsToAttacks(scheduledNotes, observations);
    for (const event of decoded.syntheticEvents) {
      const assignedNote = scheduledNoteForSynthetic(assignments, observations, event, scheduledNotes);
      const assignedAttack = assignedNote ? entry.sequence.attacks[assignedNote.attackIndex] : null;
      const duplicateNaturalAttack = assignedNote
        ? baselineAssignments.has(assignedNote.id)
        : scheduledNotes.some((note) => (
          baselineAssignments.has(note.id) && note.midi === event.midi &&
          physicalWindowContains(entry.sequence, note, event.capturedAtMs)
        ));
      const envelopeNotes = scheduledNotes.filter((note) => (
        note.midi === event.midi && note.attackTimeMs < event.capturedAtMs
      ));
      const duringHeldNote = !assignedNote && envelopeNotes.some((note) => (
        event.capturedAtMs <= note.releaseTimeMs
      ));
      const duringReleaseTail = !assignedNote && envelopeNotes.some((note) => (
        event.capturedAtMs > note.releaseTimeMs &&
        event.capturedAtMs <= note.releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS
      ));
      const nearbyAttack = entry.sequence.attacks.find((attack) => (
        Math.abs(attack.scheduledAtMs - event.capturedAtMs) <= FRAME_MS
      ));
      const duringLegatoNonsharedTransition = entry.articulation === "legato" &&
        !assignedNote && nearbyAttack !== undefined &&
        !nearbyAttack.notes.some(({ midi }) => midi === event.midi);
      const carriedBassAttack = entry.sequence.definition.id === "carried-bass-safety"
        ? entry.sequence.attacks[1]
        : undefined;
      const carriedBassEnd = entry.sequence.definition.id === "carried-bass-safety"
        ? entry.sequence.attacks[2]?.scheduledAtMs ?? Infinity
        : -Infinity;
      const duringIncompleteCarriedBassAttack = carriedBassAttack !== undefined &&
        event.midi === 48 && event.capturedAtMs >= carriedBassAttack.scheduledAtMs - FRAME_MS &&
        event.capturedAtMs < carriedBassEnd;
      const recoveredMissingPhysicalAttack = assignedNote !== null &&
        assignedAttack?.expectedAdvance === true && !baselineAssignments.has(assignedNote.id);
      syntheticEvents.push({
        ...event,
        corpusKey: entry.key,
        sequenceId: entry.sequence.definition.id,
        family: entry.sequence.definition.family,
        intervalMs: entry.sequence.intervalMs,
        articulation: entry.articulation,
        assignedScheduledNoteId: assignedNote?.id ?? null,
        assignedAttackIndex: assignedNote?.attackIndex ?? null,
        assignedExpectedAdvance: assignedAttack?.expectedAdvance ?? false,
        recoveredMissingPhysicalAttack,
        duplicateNaturalAttack,
        unassigned: assignedNote === null,
        duringHeldNote,
        duringReleaseTail,
        duringLegatoNonsharedTransition,
        duringIncompleteCarriedBassAttack,
        latencyMs: assignedNote ? event.capturedAtMs - assignedNote.attackTimeMs : null,
        recoveryFamilies: assignedNote ? recoveryFamilies(entry, assignedNote) : [],
      });
    }
  }
  const recovered = syntheticEvents.filter(({ recoveredMissingPhysicalAttack }) => (
    recoveredMissingPhysicalAttack
  ));
  const latencies = recovered.flatMap(({ latencyMs }) => latencyMs === null ? [] : [latencyMs]);
  const countBy = (values: readonly string[]) => Object.fromEntries(
    [...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]),
  );
  const familyValues = recovered.flatMap(({ recoveryFamilies: families }) => families);
  const speedValues = recovered.map(({ intervalMs }) => String(intervalMs));
  const articulationValues = recovered.flatMap(({ articulation }) => articulation ? [articulation] : []);
  return {
    traces,
    metrics: {
      missingPhysicalAttacksInProduction,
      recoveredMissingPhysicalAttacks: recovered.length,
      recoveryRate: missingPhysicalAttacksInProduction === 0
        ? 0
        : recovered.length / missingPhysicalAttacksInProduction,
      syntheticEventCount: syntheticEvents.length,
      assignedSyntheticEventCount: syntheticEvents.filter(({ unassigned }) => !unassigned).length,
      unassignedSyntheticEventCount: syntheticEvents.filter(({ unassigned }) => unassigned).length,
      duplicateNaturalEventCount: syntheticEvents.filter(({ duplicateNaturalAttack }) => duplicateNaturalAttack).length,
      heldNoteSyntheticEventCount: syntheticEvents.filter(({ duringHeldNote }) => duringHeldNote).length,
      releaseTailSyntheticEventCount: syntheticEvents.filter(({ duringReleaseTail }) => duringReleaseTail).length,
      legatoNonsharedSyntheticEventCount: syntheticEvents.filter(({ duringLegatoNonsharedTransition }) => (
        duringLegatoNonsharedTransition
      )).length,
      incompleteCarriedBassSyntheticEventCount: syntheticEvents.filter(({ duringIncompleteCarriedBassAttack }) => (
        duringIncompleteCarriedBassAttack
      )).length,
      naturalEventStreamDifferenceCount,
      p50SyntheticLatencyMs: percentile(latencies, 0.5),
      p95SyntheticLatencyMs: percentile(latencies, 0.95),
      recoveriesByFamily: countBy(familyValues),
      recoveriesBySpeed: countBy(speedValues),
      recoveriesByArticulation: countBy(articulationValues) as Partial<
        Record<ListenSequenceArticulation, number>
      >,
      syntheticEvents,
    },
  };
}

function groupMetrics(label: string, runs: readonly ListenSequenceRunResult[]): ListenRetriggerGroupMetrics {
  return {
    label,
    expectedEventCount: runs.reduce((total, run) => total + run.summary.expectedEventCount, 0),
    independentMatchCount: runs.reduce((total, run) => total + run.summary.independentMatchCount, 0),
    orderedAdvanceCount: runs.reduce((total, run) => total + run.summary.orderedAdvanceCount, 0),
    orderedPrefixCompleted: runs.reduce((total, run) => total + run.summary.orderedPrefixCompleted, 0),
    completePassageCount: runs.filter(({ summary }) => summary.complete).length,
    falseAdvanceCount: runs.reduce((total, run) => total + run.summary.falseAdvanceCount, 0),
    skippedAdvanceCount: runs.reduce((total, run) => total + run.summary.skippedAdvanceCount, 0),
    duplicateAdvanceCount: runs.reduce((total, run) => total + run.summary.duplicateAdvanceCount, 0),
  };
}

function matcherMetrics(
  entries: readonly ListenRetriggerCorpusEntry[],
  traces: readonly ListenRecognitionTrace[],
  profile: ListenMatcherThresholds,
): ListenRetriggerMatcherMetrics {
  const runs = entries.map((entry, index) => replayListenSequenceTrace(
    entry.sequence,
    traces[index],
    "current-matcher",
    profile,
  ));
  const nonSafetyRuns = runs.filter(({ family }) => family !== "safety");
  const safety = summarizeListenSafety(runs, profile);
  const reasons = (reason: ListenSequenceFailureReason) => nonSafetyRuns.reduce(
    (total, run) => total + run.events.filter((event) => event.failureReasons.includes(reason)).length,
    0,
  );
  const independentLatencies = nonSafetyRuns.flatMap((run) => run.events.flatMap((event) => (
    event.independentMatchLatencyMs === null ? [] : [event.independentMatchLatencyMs]
  )));
  const orderedLatencies = nonSafetyRuns.flatMap((run) => run.events.flatMap((event) => (
    event.orderedAdvanceLatencyMs === null ? [] : [event.orderedAdvanceLatencyMs]
  )));
  const sequenceRuns = runs.filter((_, index) => entries[index].source === "continuous-sequence");
  const articulationRuns = runs.filter((_, index) => entries[index].source === "course-clear-articulation");
  const intervals = [...new Set(sequenceRuns.map(({ intervalMs }) => intervalMs))]
    .sort((left, right) => right - left);
  return {
    rawPhysicalAttackEvidence: nonSafetyRuns.reduce((total, run) => total + run.events.reduce(
      (eventTotal, event) => eventTotal + event.expectedPitches.filter((pitch) => (
        pitch.attackRequired && pitch.rawAttackDetected
      )).length,
      0,
    ), 0),
    independentMatchCount: nonSafetyRuns.reduce((total, run) => total + run.summary.independentMatchCount, 0),
    orderedAdvanceCount: nonSafetyRuns.reduce((total, run) => total + run.summary.orderedAdvanceCount, 0),
    orderedPrefixCompleted: nonSafetyRuns.reduce((total, run) => total + run.summary.orderedPrefixCompleted, 0),
    completePassageCount: nonSafetyRuns.filter(({ summary }) => summary.complete).length,
    retriggerNotDetectedCount: reasons("retrigger-not-detected"),
    missingRequiredBassOnsetCount: reasons("missing-required-bass-onset"),
    carryOverCount: reasons("carry-over"),
    recognizedButBlockedCount: nonSafetyRuns.reduce((total, run) => total + run.summary.recognizedButBlockedCount, 0),
    cascadeLossCount: nonSafetyRuns.reduce((total, run) => total + run.summary.cascadeLossCount, 0),
    falseAdvanceCount: safety.falseAdvanceCount,
    skippedAdvanceCount: safety.skippedAdvanceCount,
    duplicateAdvanceCount: safety.duplicateAdvanceCount,
    incompleteCarriedBassAdvances: safety.incompleteCarriedBassAdvances,
    p50IndependentMatchLatencyMs: percentile(independentLatencies, 0.5),
    p95IndependentMatchLatencyMs: percentile(independentLatencies, 0.95),
    p50OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.5),
    p95OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.95),
    independentAt1000Ms: nonSafetyRuns
      .filter(({ intervalMs }) => intervalMs === 1_000)
      .reduce((total, run) => total + run.summary.independentMatchCount, 0),
    speedSummaries: intervals.map((intervalMs) => groupMetrics(
      `${intervalMs} ms`,
      sequenceRuns.filter((run) => run.intervalMs === intervalMs),
    )),
    articulationSummaries: articulationRuns.map((run, index) => groupMetrics(
      entries.filter(({ source }) => source === "course-clear-articulation")[index]?.articulation ??
        run.sequenceId,
      [run],
    )),
    safetyPassed: safety.passed,
  };
}

function profileEvaluation(
  label: ListenRetriggerMatcherProfileEvaluation["label"],
  profile: ListenMatcherThresholds,
  baseline: ListenRetriggerMatcherMetrics,
  candidate: ListenRetriggerMatcherMetrics,
): ListenRetriggerMatcherProfileEvaluation {
  const targetedFailureReduction =
    baseline.retriggerNotDetectedCount + baseline.missingRequiredBassOnsetCount -
    candidate.retriggerNotDetectedCount - candidate.missingRequiredBassOnsetCount;
  const rejectionReasons: string[] = [];
  if (!candidate.safetyPassed) rejectionReasons.push("matcher-safety");
  if (candidate.incompleteCarriedBassAdvances > 0) rejectionReasons.push("incomplete-carried-bass-advance");
  if (candidate.independentAt1000Ms < baseline.independentAt1000Ms) rejectionReasons.push("independent-1000ms-regression");
  if (candidate.independentMatchCount < baseline.independentMatchCount) rejectionReasons.push("aggregate-independent-regression");
  if (candidate.orderedAdvanceCount < baseline.orderedAdvanceCount) rejectionReasons.push("aggregate-ordered-regression");
  if (targetedFailureReduction < 1) rejectionReasons.push("no-targeted-failure-removed");
  return {
    label,
    profile: { ...profile },
    baseline,
    candidate,
    independentMatchDelta: candidate.independentMatchCount - baseline.independentMatchCount,
    orderedAdvanceDelta: candidate.orderedAdvanceCount - baseline.orderedAdvanceCount,
    orderedPrefixDelta: candidate.orderedPrefixCompleted - baseline.orderedPrefixCompleted,
    completePassageDelta: candidate.completePassageCount - baseline.completePassageCount,
    targetedFailureReduction,
    passed: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

/** Applies decoder and both matcher-profile gates without forcing a winner. */
export function applyListenRetriggerAcceptanceGates(
  options: ListenRetriggerCandidateOptions,
  decoder: ListenRetriggerDecoderMetrics,
  matcherProfiles: ListenRetriggerMatcherProfileEvaluation[],
  auditConclusion: ListenRetriggerAuditConclusionCode = "hidden-score-rise-found",
): ListenRetriggerCandidateResult {
  const rejectionReasons: string[] = [];
  if (auditConclusion !== "hidden-score-rise-found") rejectionReasons.push(auditConclusion);
  if (decoder.recoveredMissingPhysicalAttacks < 1) rejectionReasons.push("no-missing-physical-attack-recovered");
  if (decoder.heldNoteSyntheticEventCount > 0) rejectionReasons.push("held-note-synthetic-event");
  if (decoder.releaseTailSyntheticEventCount > 0) rejectionReasons.push("release-tail-synthetic-event");
  if (decoder.legatoNonsharedSyntheticEventCount > 0) rejectionReasons.push("legato-nonshared-synthetic-event");
  if (decoder.duplicateNaturalEventCount > 0) rejectionReasons.push("duplicate-natural-event");
  if (decoder.unassignedSyntheticEventCount > 0) rejectionReasons.push("unassigned-synthetic-event");
  if (decoder.incompleteCarriedBassSyntheticEventCount > 0) rejectionReasons.push("incomplete-carried-bass-synthetic-event");
  if (decoder.naturalEventStreamDifferenceCount > 0) rejectionReasons.push("natural-event-stream-changed");
  const rejectedByDecoderSafety = rejectionReasons.length > 0;
  for (const evaluation of matcherProfiles) {
    for (const reason of evaluation.rejectionReasons) {
      rejectionReasons.push(`${evaluation.label}:${reason}`);
    }
  }
  const rejectedByMatcherSafety = matcherProfiles.some(({ passed }) => !passed);
  return {
    options,
    decoder,
    matcherProfiles,
    rejectedByDecoderSafety,
    rejectedByMatcherSafety,
    eligible: !rejectedByDecoderSafety && !rejectedByMatcherSafety,
    rejectionReasons: [...new Set(rejectionReasons)].sort(),
  };
}

function fastRecoveryCount(candidate: ListenRetriggerCandidateResult): number {
  return ["500", String(1_000 / 3), "250"].reduce(
    (total, interval) => total + (candidate.decoder.recoveriesBySpeed[interval] ?? 0),
    0,
  );
}

/** Ranks only after every strict acceptance gate has been evaluated. */
export function rankListenRetriggerCandidates(
  candidates: readonly ListenRetriggerCandidateResult[],
): ListenRetriggerCandidateResult[] {
  return [...candidates].sort((left, right) => (
    right.decoder.recoveredMissingPhysicalAttacks - left.decoder.recoveredMissingPhysicalAttacks ||
    right.matcherProfiles.reduce((total, profile) => total + profile.independentMatchDelta, 0) -
      left.matcherProfiles.reduce((total, profile) => total + profile.independentMatchDelta, 0) ||
    fastRecoveryCount(right) - fastRecoveryCount(left) ||
    right.matcherProfiles.reduce((total, profile) => total + profile.orderedAdvanceDelta, 0) -
      left.matcherProfiles.reduce((total, profile) => total + profile.orderedAdvanceDelta, 0) ||
    left.decoder.syntheticEventCount - right.decoder.syntheticEventCount ||
    right.options.peakThreshold - left.options.peakThreshold ||
    right.options.riseThreshold - left.options.riseThreshold ||
    right.options.rearmThreshold - left.options.rearmThreshold ||
    right.options.refractoryFrames - left.options.refractoryFrames ||
    left.options.id.localeCompare(right.options.id)
  ));
}

function traceIdentity(entry: ListenRetriggerCorpusEntry): ListenRetriggerTraceIdentity {
  return {
    corpusKey: entry.key,
    source: entry.source,
    sequenceId: entry.sequence.definition.id,
    intervalMs: entry.sequence.intervalMs,
    articulation: entry.articulation,
    pcmHash: entry.trace.audioSignature?.pcmHash ??
      entry.trace.audioDiagnostics.audioSignature?.pcmHash ?? null,
    pcmByteLength: entry.trace.pcm.byteLength,
    frameCount: entry.trace.frames.length,
    resetMode: entry.trace.resetPlan?.mode ?? "stateful",
  };
}

/** Full inference-free opportunity audit, 432-profile sweep, and two-profile matcher replay. */
export async function runListenRetriggerSweep(
  sequenceResult: ListenSequenceBenchmarkResult,
  articulationResult: ListenArticulationMatrixResult,
  thresholdRecommendation: ListenThresholdSweepResult | ListenMatcherThresholds,
  onProgress: (complete: number, total: number, label: string) => void = () => undefined,
  batchSize = 4,
): Promise<ListenRetriggerSweepResult> {
  const entries = buildListenRetriggerCorpus(sequenceResult, articulationResult);
  if (entries.some(({ trace }) => (trace.resetPlan?.mode ?? "stateful") !== "stateful")) {
    throw new Error("Retrigger candidate selection accepts only stateful traces.");
  }
  for (const entry of entries) {
    if (!redecodeListenRecognitionTrace(entry.trace).productionParity) {
      throw new Error(`Disabled decoder replay parity failed for ${entry.key}.`);
    }
  }
  const audit = auditListenRetriggerOpportunities(entries);
  const recommendedProfile = "recommendation" in thresholdRecommendation
    ? thresholdRecommendation.recommendation.profile
    : thresholdRecommendation;
  const profiles = [
    {
      label: "production" as const,
      profile: { ...productionListenMatcherProfile },
    },
    {
      label: "threshold-recommendation" as const,
      profile: { ...recommendedProfile },
    },
  ];
  const baselines = profiles.map(({ label, profile }) => ({
    label,
    profile,
    baseline: matcherMetrics(entries, entries.map(({ trace }) => trace), profile),
  }));
  const optionsGrid = generateListenRetriggerCandidates();
  const candidates: ListenRetriggerCandidateResult[] = [];
  const matcherEvaluationsBySyntheticStream = new Map<
    string,
    ListenRetriggerMatcherProfileEvaluation[]
  >();
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  for (let index = 0; index < optionsGrid.length; index += 1) {
    const options = optionsGrid[index];
    const decoded = evaluateListenRetriggerDecoderCandidate(entries, options);
    const syntheticStreamKey = JSON.stringify(decoded.metrics.syntheticEvents.map((event) => [
      event.corpusKey,
      event.frameIndex,
      event.midi,
      event.capturedAtMs,
    ]));
    let evaluations = matcherEvaluationsBySyntheticStream.get(syntheticStreamKey);
    if (!evaluations) {
      evaluations = baselines.map(({ label, profile, baseline }) => profileEvaluation(
        label,
        profile,
        baseline,
        matcherMetrics(entries, decoded.traces, profile),
      ));
      matcherEvaluationsBySyntheticStream.set(syntheticStreamKey, evaluations);
    }
    candidates.push(applyListenRetriggerAcceptanceGates(
      options,
      decoded.metrics,
      evaluations,
      audit.conclusion,
    ));
    if ((index + 1) % safeBatchSize === 0 || index + 1 === optionsGrid.length) {
      onProgress(index + 1, optionsGrid.length, `Candidate ${index + 1} / ${optionsGrid.length}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  const decoderSafeSeparation = candidates.some((candidate) => (
    candidate.decoder.recoveredMissingPhysicalAttacks > 0 &&
    candidate.decoder.heldNoteSyntheticEventCount === 0 &&
    candidate.decoder.releaseTailSyntheticEventCount === 0 &&
    candidate.decoder.legatoNonsharedSyntheticEventCount === 0 &&
    candidate.decoder.duplicateNaturalEventCount === 0 &&
    candidate.decoder.unassignedSyntheticEventCount === 0 &&
    candidate.decoder.incompleteCarriedBassSyntheticEventCount === 0 &&
    candidate.decoder.naturalEventStreamDifferenceCount === 0
  ));
  if (audit.hiddenRiseCount > 0 && !decoderSafeSeparation) {
    audit.conclusion = "no-safe-separation";
    for (const candidate of candidates) {
      candidate.eligible = false;
      candidate.rejectedByDecoderSafety = true;
      candidate.rejectionReasons = [...new Set([
        ...candidate.rejectionReasons,
        "no-safe-separation",
      ])].sort();
    }
  }
  const eligibleCandidates = rankListenRetriggerCandidates(
    candidates.filter(({ eligible }) => eligible),
  );
  const diagnosticCandidate = rankListenRetriggerCandidates(candidates)[0] ?? null;
  const recommendation = eligibleCandidates[0] ?? null;
  const conclusion = recommendation
    ? {
        code: "safe-benchmark-candidate" as const,
        text: `Benchmark-only candidate ${recommendation.options.id} passed every decoder and matcher gate.`,
      }
    : audit.conclusion === "no-hidden-score-rise"
    ? {
        code: "no-hidden-score-rise" as const,
        text: "No genuinely missing physical attack exposed a usable score rise under sustain.",
      }
    : audit.conclusion === "no-safe-separation"
    ? {
        code: "no-safe-separation" as const,
        text: "Hidden score rises existed, but no grid candidate separated them from decoder safety negatives.",
      }
    : {
        code: "no-candidate-passed-all-gates" as const,
        text: "Hidden score rises existed, but every candidate failed at least one decoder or matcher gate.",
      };
  return {
    renderer: { ...sequenceResult.renderer },
    benchmarkOnly: true,
    productionEnabled: false,
    replayParityVerified: true,
    traceIdentities: entries.map(traceIdentity),
    audit,
    gridSize: optionsGrid.length,
    candidatesEvaluated: candidates.length,
    uniqueSyntheticStreamsEvaluated: matcherEvaluationsBySyntheticStream.size,
    candidatesRejectedByDecoderSafety: candidates.filter(({ rejectedByDecoderSafety }) => (
      rejectedByDecoderSafety
    )).length,
    candidatesRejectedByMatcherSafety: candidates.filter(({ rejectedByMatcherSafety }) => (
      rejectedByMatcherSafety
    )).length,
    matcherProfiles: baselines,
    candidates,
    eligibleCandidates,
    recommendation,
    diagnosticCandidate,
    conclusion,
  };
}
