import {
  ExactChordMatcher,
  defaultChordMatcherOptions,
} from "./chordMatcher";
import { COURSE_CLEAR_BENCHMARK_MOMENTS } from "./listenBenchmarkFixtures";
import {
  ONLINE_AMT_CHUNK_SIZE,
  ONLINE_AMT_SAMPLE_RATE,
} from "./onlineAmtProtocol";
import {
  OnlineAmtOutputDecoder,
  onlineAmtChordMatcherOptions,
  type DecodedOnlineAmtOutput,
} from "./onlineAmtOutput";
import {
  OnlineAmtSession,
  type OnlineAmtStepResult,
} from "./onlineAmtSession";
import {
  LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  LISTEN_BENCHMARK_RELEASE_MS,
  LISTEN_BENCHMARK_RENDERER,
  type ListenBenchmarkAudioAttack,
  type ListenBenchmarkAudioDiagnostics,
  type ListenBenchmarkAudioRenderResult,
  type ListenBenchmarkRendererConfiguration,
  measureBenchmarkPcm,
  signatureForBenchmarkPcm,
  type ListenBenchmarkAudioSignature,
  renderBenchmarkAudio,
} from "./listenBenchmarkAudio";
import type {
  RecognizedNoteEvent,
  RecognizedOnset,
  RecognizedPitchEvidence,
  RecognizerResult,
} from "./noteRecognizer";

export const LISTEN_SEQUENCE_INTERVALS_MS = [
  1_000,
  500,
  1_000 / 3,
  250,
  167,
  125,
] as const;
export const LISTEN_SEQUENCE_PRE_ROLL_MS = 220;
export const LISTEN_SEQUENCE_TAIL_MS = 900;
export const LISTEN_SEQUENCE_ONSET_BUFFER_MS = 192;
const RECOGNITION_ASSIGNMENT_MS = 450;
const FRAME_MS = ONLINE_AMT_CHUNK_SIZE * 1_000 / ONLINE_AMT_SAMPLE_RATE;
const FIRST_PIANO_MIDI = 21;

export const COURSE_CLEAR_ARTICULATION_INTERVAL_MS = 1_000;
export const LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT = 3;

export type ListenSequenceArticulation =
  | "detached"
  | "normal"
  | "legato"
  | "sustained-shared";

export const LISTEN_SEQUENCE_ARTICULATIONS: readonly ListenSequenceArticulation[] = [
  "detached",
  "normal",
  "legato",
  "sustained-shared",
] as const;

export const LISTEN_ARTICULATION_HOLD_MS = Object.freeze({
  detached: 250,
  normal: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  legato: 900,
});

const matcherOptions = {
  ...defaultChordMatcherOptions,
  ...onlineAmtChordMatcherOptions,
};

export interface ListenSequenceNote {
  midi: number;
  offsetMs?: number;
  /** Absolute hold duration. Takes precedence over durationIntervals. */
  holdMs?: number;
  durationIntervals?: number;
}

export interface ListenSequenceAttackDefinition {
  /** Attack time in multiples of the selected interval. */
  at: number;
  /** Score target expected to be active for this physical attack. */
  targetIndex: number;
  notes: readonly (number | ListenSequenceNote)[];
  /** Preserve whole-chord gain when this attack contains only new chord tones. */
  gainReferenceChordSize?: number;
  /** False for a deliberate wrong/extra-note safety attack. */
  expectedAdvance: boolean;
}

export interface ListenSequenceDefinition {
  id: string;
  family: string;
  label: string;
  targets: readonly (readonly number[])[];
  attacks: readonly ListenSequenceAttackDefinition[];
  articulation?: ListenSequenceArticulation;
}

export interface ScheduledSequenceNote {
  id: string;
  midi: number;
  attackIndex: number;
  attackTimeMs: number;
  releaseTimeMs: number;
}

export interface ScheduledSequenceAttack {
  index: number;
  targetIndex: number;
  scheduledAtMs: number;
  expectedAdvance: boolean;
  playedPitches: number[];
  notes: ScheduledSequenceNote[];
  gainReferenceChordSize?: number;
}

export interface ScheduledSequenceTarget {
  index: number;
  pitches: number[];
  scheduledAttackTimeMs: number;
  playedPitches: number[];
  attackIndex: number;
}

export interface MaterializedListenSequence {
  definition: ListenSequenceDefinition;
  intervalMs: number;
  eventRate: number;
  attacks: ScheduledSequenceAttack[];
  targets: ScheduledSequenceTarget[];
  relevantPitches: number[];
  durationMs: number;
  frameCount: number;
}

export interface ListenRecognitionFrame {
  capturedAtMs: number;
  onsets: RecognizedOnset[];
  noteEvents: RecognizedNoteEvent[];
  activePitches: RecognizedPitchEvidence[];
  confidenceEvidence: RecognizedPitchEvidence[];
  modelScores: number[];
  modelStates: number[];
  signalActive: boolean;
  inferenceDurationMs: number;
}

export type ListenInferenceMode = "stateful" | "event-reset";

export interface ListenTraceResetPoint {
  /** Zero-based 512-sample chunk index immediately before which to reset. */
  frameIndex: number;
  eventIndex: number;
  requestedAtMs: number;
  actualFrameStartMs: number;
  scheduledAttackTimeMs: number;
  actualWarmupMs: number;
}

export interface ListenTraceResetPlan {
  mode: ListenInferenceMode;
  /** Event-reset points exclude the initial passage reset. */
  points: ListenTraceResetPoint[];
}

export interface ListenRecognitionTrace {
  sequenceId: string;
  intervalMs: number;
  sampleRate: number;
  chunkSize: number;
  relevantPitches: number[];
  renderer: ListenBenchmarkRendererConfiguration;
  audioDiagnostics: ListenBenchmarkAudioDiagnostics;
  audioSignature?: ListenBenchmarkAudioSignature;
  resetPlan?: ListenTraceResetPlan;
  pcm: Float32Array;
  frames: ListenRecognitionFrame[];
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
}

export type ListenSequenceFailureReason =
  | "model-no-evidence"
  | "onset-below-threshold"
  | "retrigger-not-detected"
  | "carry-over"
  | "missing-required-bass-onset"
  | "rejected-extra-pitch"
  | "matcher-timeout"
  | "evidence-too-spread-out"
  | "next-attack-before-advance"
  | "blocked-by-prior-stall"
  | "duplicate-or-held-attack"
  | "skipped-target"
  | "stale-generation";

export type RequiredAttackType = "onset" | "reOnset";

export interface ExpectedPitchDiagnostic {
  midi: number;
  attackRequired: boolean;
  requiredAttackType: RequiredAttackType | null;
  rawAttackDetected: boolean;
  rawOnsetProduced: boolean;
  rawOnsetTimeMs: number | null;
  maximumOnsetConfidence: number;
  onsetConfidence: number;
  noteConfidence: number;
  qualifyingOnset: boolean;
  maximumActiveConfidence: number;
  firstRawEvidenceTimeMs: number | null;
  firstThresholdQualifiedEvidenceTimeMs: number | null;
  requiredRawEvidencePresent: boolean;
  thresholdQualified: boolean;
}

export interface ListenSequenceEventDiagnostic {
  index: number;
  scheduledAttackTimeMs: number;
  targetPitches: number[];
  playedPitches: number[];
  expectedPitches: ExpectedPitchDiagnostic[];
  firstRawEvidenceTimeMs: number | null;
  firstThresholdQualifiedEvidenceTimeMs: number | null;
  firstQualifyingPitchEvidenceTimeMs: number | null;
  confidentUnexpectedPitches: number[];
  allRequiredRawEvidencePresent: boolean;
  thresholdQualified: boolean;
  independentlyMatched: boolean;
  independentMatchAtMs: number | null;
  independentMatchLatencyMs: number | null;
  orderedAdvanced: boolean;
  orderedAdvancedAtMs: number | null;
  orderedAdvanceLatencyMs: number | null;
  advanced: boolean;
  advancedAtMs: number | null;
  onsetToAdvanceMs: number | null;
  activeTargetIndexAtAttack: number | null;
  blockedByPriorStall: boolean;
  unexpectedPitches: number[];
  nextAttackBeforeAdvance: boolean;
  missed: boolean;
  duplicate: boolean;
  skipped: boolean;
  falseAdvance: boolean;
  timedOut: boolean;
  rawFailureReasons: ListenSequenceFailureReason[];
  independentFailureReasons: ListenSequenceFailureReason[];
  orderedFailureReasons: ListenSequenceFailureReason[];
  failureReasons: ListenSequenceFailureReason[];
  primaryFailure: ListenSequenceFailureReason | null;
}

export interface ListenSequenceAttackDiagnostic {
  index: number;
  scheduledAtMs: number;
  targetIndex: number;
  playedPitches: number[];
  expectedAdvance: boolean;
  activeTargetIndexAtAttack: number | null;
  advancementTargetIndices: number[];
}

export interface ListenSequenceRunSummary {
  complete: boolean;
  rawCompleteEvidenceCount: number;
  rawCompleteEvidenceRate: number;
  thresholdQualifiedEventCount: number;
  thresholdQualifiedEventRate: number;
  independentMatchCount: number;
  independentMatchRate: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  recognizedButBlockedCount: number;
  cascadeLossCount: number;
  blockedEventPositions: number[];
  firstCausalStallIndex: number | null;
  correctAdvanceCount: number;
  expectedEventCount: number;
  correctAdvanceRate: number;
  orderedPrefixCompleted: number;
  firstStallIndex: number | null;
  missedCount: number;
  duplicateAdvanceCount: number;
  skippedAdvanceCount: number;
  falseAdvanceCount: number;
  p50OnsetToAdvanceMs: number | null;
  p95OnsetToAdvanceMs: number | null;
  p50IndependentMatchLatencyMs: number | null;
  p95IndependentMatchLatencyMs: number | null;
  p50OrderedAdvanceLatencyMs: number | null;
  p95OrderedAdvanceLatencyMs: number | null;
  reasonCounts: Partial<Record<ListenSequenceFailureReason, number>>;
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
  nextAttackBeforeAdvanceCount: number;
}

export interface ListenSequenceRunResult {
  policy: ListenSequenceReplayPolicy;
  sequenceId: string;
  sequenceLabel: string;
  family: string;
  intervalMs: number;
  eventRate: number;
  renderer: ListenBenchmarkRendererConfiguration;
  trace: ListenRecognitionTrace;
  events: ListenSequenceEventDiagnostic[];
  attacks: ListenSequenceAttackDiagnostic[];
  summary: ListenSequenceRunSummary;
}

export type ListenSequenceReplayPolicy = "current-matcher" | "next-onset-buffer";

export interface ListenSequencePolicyComparison {
  currentCorrectAdvanceCount: number;
  bufferedCorrectAdvanceCount: number;
  correctAdvanceImprovement: number;
  currentOrderedPrefixCompleted: number;
  bufferedOrderedPrefixCompleted: number;
  orderedPrefixImprovement: number;
  currentCompletePassageCount: number;
  bufferedCompletePassageCount: number;
  completePassageImprovement: number;
  bufferedFalseAdvanceCount: number;
  bufferedSkippedAdvanceCount: number;
  bufferedDuplicateAdvanceCount: number;
  isolatedBenchmarkUnchanged: true;
  rawAndIndependentMetricsIdentical: boolean;
  accepted: boolean;
}

export interface ExperimentalListenSequenceResult {
  policy: "next-onset-buffer";
  bufferMs: number;
  renderer: ListenBenchmarkRendererConfiguration;
  runs: ListenSequenceRunResult[];
  speedSummaries: ListenSequenceAggregateSummary[];
  familySpeedSummaries: ListenSequenceAggregateSummary[];
  comparison: ListenSequencePolicyComparison;
}

export interface ListenSequenceAggregateSummary {
  intervalMs: number;
  eventRate: number;
  family?: string;
  sequenceCount: number;
  completePassageRate: number;
  rawCompleteEvidenceCount: number;
  rawCompleteEvidenceRate: number;
  thresholdQualifiedEventCount: number;
  thresholdQualifiedEventRate: number;
  independentMatchCount: number;
  independentMatchRate: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  recognizedButBlockedCount: number;
  cascadeLossCount: number;
  blockedEventPositions: Array<{
    sequenceId: string;
    positions: number[];
  }>;
  correctAdvanceCount: number;
  expectedEventCount: number;
  correctAdvanceRate: number;
  orderedPrefixCompleted: number;
  incompleteSequences: string[];
  firstStalls: Array<{
    sequenceId: string;
    position: number;
    primaryFailure: ListenSequenceFailureReason | null;
  }>;
  failureClassifications: Partial<Record<ListenSequenceFailureReason, number>>;
  missedCount: number;
  duplicateAdvanceCount: number;
  skippedAdvanceCount: number;
  falseAdvanceCount: number;
  p50OnsetToAdvanceMs: number | null;
  p95OnsetToAdvanceMs: number | null;
  p50IndependentMatchLatencyMs: number | null;
  p95IndependentMatchLatencyMs: number | null;
  p50OrderedAdvanceLatencyMs: number | null;
  p95OrderedAdvanceLatencyMs: number | null;
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
  nextAttackBeforeAdvanceCount: number;
}

export interface ListenSequenceBaselineObservations {
  sharpestCompletionDrop: {
    fromEventRate: number;
    toEventRate: number;
    completionRateDrop: number;
  } | null;
  dominantFailure: ListenSequenceFailureReason | null;
  nextAttackBeforeAdvanceRate: number;
  repeatedNoteCompletionRate: number | null;
  changingPitchCompletionRate: number | null;
  sharedChordCompletionRate: number | null;
  independentChordCompletionRate: number | null;
}

export interface ListenSequenceBenchmarkResult {
  policy: "current-matcher";
  renderer: ListenBenchmarkRendererConfiguration;
  runs: ListenSequenceRunResult[];
  speedSummaries: ListenSequenceAggregateSummary[];
  familySpeedSummaries: ListenSequenceAggregateSummary[];
  baseline: ListenSequenceBaselineObservations;
  experimental: ExperimentalListenSequenceResult;
}

export interface ListenArticulationSilenceGapDiagnostic {
  startMs: number;
  endMs: number;
  durationMs: number;
  rms: number;
}

export interface ListenArticulationDepartingPitchDiagnostic {
  midi: number;
  activeAtNextAttack: boolean;
  offsetBeforeNextAttack: boolean;
}

export interface ListenArticulationEventDiagnostic {
  index: number;
  expectedFreshAttackCount: number;
  producedFreshAttackCount: number;
  expectedOnsetCount: number;
  producedOnsetCount: number;
  expectedReOnsetCount: number;
  producedReOnsetCount: number;
  repeatedPitches: number[];
  repeatedPitchesInSustain: number[];
  departingPitches: ListenArticulationDepartingPitchDiagnostic[];
  confidentPreviousChordExtraPitches: number[];
  silenceGap: ListenArticulationSilenceGapDiagnostic | null;
  failureClassification: "retrigger-not-detected" | "carry-over" |
    "model-no-evidence" | null;
}

export interface ListenArticulationRunSummary {
  articulation: ListenSequenceArticulation;
  expectedEventCount: number;
  rawEvidenceCount: number;
  rawEvidenceRate: number;
  expectedFreshAttackCount: number;
  producedFreshAttackCount: number;
  freshAttackRate: number;
  expectedOnsetCount: number;
  producedOnsetCount: number;
  expectedReOnsetCount: number;
  producedReOnsetCount: number;
  independentMatchCount: number;
  independentMatchRate: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  completePassage: boolean;
  staleSustainPitchCount: number;
  carryOverEventCount: number;
  departingPitchActiveCount: number;
  departingPitchOffsetBeforeNextAttackCount: number;
  confidentPreviousChordExtraCount: number;
  retriggerNotDetectedFailureCount: number;
  carryOverFailureCount: number;
  modelNoEvidenceFailureCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  detachedSilenceGapCount: number;
  maximumDetachedSilenceGapRms: number | null;
}

export interface ListenArticulationNormalDelta {
  rawEvidenceCount: number;
  rawEvidenceRate: number;
  producedFreshAttackCount: number;
  freshAttackRate: number;
  independentMatchCount: number;
  independentMatchRate: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  staleSustainPitchCount: number;
  carryOverEventCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
}

export interface ListenArticulationRunResult {
  articulation: ListenSequenceArticulation;
  run: ListenSequenceRunResult;
  events: ListenArticulationEventDiagnostic[];
  summary: ListenArticulationRunSummary;
  deltaFromNormal: ListenArticulationNormalDelta;
}

export type ListenArticulationDiagnosticCode =
  | "recognizer-state-release-interference"
  | "matcher-carry-over-handling"
  | "ordered-cascade-playhead"
  | "base-model-recall"
  | "inconclusive-safety-errors"
  | "inconclusive";

export interface ListenArticulationDiagnosticConclusion {
  code: ListenArticulationDiagnosticCode;
  text: string;
  substantialThresholdCount: 3;
  substantialThresholdRate: number;
  detachedIndependentMatchImprovement: number;
  detachedOrderedAdvanceImprovement: number;
  safetyErrorsIntroduced: boolean;
  substantialDetachedImprovement: boolean;
}

export interface ListenArticulationMatrixResult {
  intervalMs: 1_000;
  eventCount: number;
  renderer: ListenBenchmarkRendererConfiguration;
  runs: ListenArticulationRunResult[];
  conclusion: ListenArticulationDiagnosticConclusion;
}

export interface SequenceInferenceSession {
  reset(): void;
  run(audio: Float32Array): Promise<OnlineAmtStepResult>;
}

export interface SequenceOutputDecoder {
  reset(): void;
  decode(
    scores: Float32Array,
    states: Uint8Array,
    signalActive: boolean,
    capturedAtMs: number,
    targetPitches?: readonly number[],
  ): DecodedOnlineAmtOutput;
}

function note(midi: number, update: Omit<ListenSequenceNote, "midi"> = {}): ListenSequenceNote {
  return { midi, ...update };
}

function regularSequence(
  id: string,
  family: string,
  label: string,
  targets: readonly (readonly number[])[],
  notesByTarget: readonly (readonly (number | ListenSequenceNote)[])[] = targets,
): ListenSequenceDefinition {
  return {
    id,
    family,
    label,
    targets,
    attacks: targets.map((_, index) => ({
      at: index,
      targetIndex: index,
      notes: notesByTarget[index],
      expectedAdvance: true,
    })),
  };
}

function sameChord(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  const rightPitches = new Set(right);
  return left.every((midi) => rightPitches.has(midi));
}

function fixedArticulationCourseClearDefinition(
  articulation: "detached" | "normal" | "legato",
): ListenSequenceDefinition {
  const targets = COURSE_CLEAR_BENCHMARK_MOMENTS.map(({ pitches }) => pitches);
  const holdMs = LISTEN_ARTICULATION_HOLD_MS[articulation];
  return {
    id: `course-clear-articulation-${articulation}`,
    family: "course-clear-articulation",
    label: `Course Clear · ${articulation}`,
    articulation,
    targets,
    attacks: targets.map((pitches, index) => ({
      at: index,
      targetIndex: index,
      notes: pitches.map((midi) => note(midi, { holdMs })),
      expectedAdvance: true,
    })),
  };
}

function sustainedSharedCourseClearDefinition(): ListenSequenceDefinition {
  const targets = COURSE_CLEAR_BENCHMARK_MOMENTS.map(({ pitches }) => pitches);
  return {
    id: "course-clear-articulation-sustained-shared",
    family: "course-clear-articulation",
    label: "Course Clear · sustained shared notes",
    articulation: "sustained-shared",
    targets,
    attacks: targets.map((pitches, index) => {
      const previous = targets[index - 1];
      const reattackWholeChord = previous === undefined || sameChord(previous, pitches);
      const attackedPitches = reattackWholeChord
        ? pitches
        : pitches.filter((midi) => !previous.includes(midi));
      return {
        at: index,
        targetIndex: index,
        gainReferenceChordSize: pitches.length,
        notes: attackedPitches.map((midi) => {
          let finalAdjacentIndex = index;
          while (finalAdjacentIndex + 1 < targets.length) {
            const current = targets[finalAdjacentIndex];
            const next = targets[finalAdjacentIndex + 1];
            if (sameChord(current, next) || !next.includes(midi)) break;
            finalAdjacentIndex += 1;
          }
          return note(midi, {
            holdMs: (finalAdjacentIndex - index) * COURSE_CLEAR_ARTICULATION_INTERVAL_MS +
              LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
          });
        }),
        expectedAdvance: true,
      };
    }),
  };
}

/** Four controlled schedules sharing the same Course Clear targets and attack times. */
export function courseClearArticulationDefinitions(): ListenSequenceDefinition[] {
  return [
    fixedArticulationCourseClearDefinition("detached"),
    fixedArticulationCourseClearDefinition("normal"),
    fixedArticulationCourseClearDefinition("legato"),
    sustainedSharedCourseClearDefinition(),
  ];
}

/** Deterministic passages used by every speed in the baseline matrix. */
export function bundledListenSequences(): ListenSequenceDefinition[] {
  const sharedTargets = [
    [48, 60, 64],
    [48, 62, 65],
    [48, 64, 67],
    [48, 65, 69],
  ];
  return [
    regularSequence(
      "ascending-scale",
      "scales",
      "Ascending C-major scale",
      [[60], [62], [64], [65], [67], [69], [71], [72]],
    ),
    regularSequence(
      "descending-scale",
      "scales",
      "Descending C-major scale",
      [[72], [71], [69], [67], [65], [64], [62], [60]],
    ),
    regularSequence(
      "alternating-c4-g4",
      "alternating-pitches",
      "Alternating C4 and G4",
      [[60], [67], [60], [67], [60], [67]],
    ),
    regularSequence(
      "repeated-c4",
      "repeated-notes",
      "Repeated C4",
      [[60], [60], [60], [60], [60], [60]],
    ),
    regularSequence(
      "two-note-progressions",
      "two-note-chords",
      "Two-note chord progression",
      [[60, 64], [62, 65], [64, 67], [65, 69], [67, 71]],
    ),
    regularSequence(
      "independent-triads",
      "three-note-independent",
      "Three-note chords without shared pitches",
      [[48, 60, 64], [50, 62, 65], [52, 64, 67], [53, 65, 69]],
    ),
    regularSequence(
      "shared-sustained-bass",
      "shared-sustain",
      "Triads sharing a sustained bass",
      sharedTargets,
      [
        [note(48, { durationIntervals: 4 }), 60, 64],
        [62, 65],
        [64, 67],
        [65, 69],
      ],
    ),
    regularSequence(
      "weak-53-65-74",
      "known-weak-chord",
      "Known weak chord embedded in a passage",
      [[50, 62, 70], [53, 65, 74], [58, 70, 77], [62, 74, 82]],
    ),
    regularSequence(
      "course-clear-27",
      "course-clear",
      "Complete Course Clear fixture",
      COURSE_CLEAR_BENCHMARK_MOMENTS.map(({ pitches }) => pitches),
    ),
    regularSequence(
      "slightly-rolled-triads",
      "rolled-chords",
      "Slightly rolled triads",
      [[48, 60, 64], [50, 62, 65], [52, 64, 67], [53, 65, 69]],
      [
        [note(48), note(60, { offsetMs: 18 }), note(64, { offsetMs: 36 })],
        [note(50), note(62, { offsetMs: 18 }), note(65, { offsetMs: 36 })],
        [note(52), note(64, { offsetMs: 18 }), note(67, { offsetMs: 36 })],
        [note(53), note(65, { offsetMs: 18 }), note(69, { offsetMs: 36 })],
      ],
    ),
    {
      id: "wrong-note-safety",
      family: "safety",
      label: "Wrong-note rejection and recovery",
      targets: [[60], [64], [67]],
      attacks: [
        { at: 0, targetIndex: 0, notes: [61], expectedAdvance: false },
        { at: 1, targetIndex: 0, notes: [60], expectedAdvance: true },
        { at: 2, targetIndex: 1, notes: [64], expectedAdvance: true },
        { at: 3, targetIndex: 2, notes: [67], expectedAdvance: true },
      ],
    },
    {
      id: "extra-note-safety",
      family: "safety",
      label: "Extra-note rejection and recovery",
      targets: [[60, 64], [62, 65], [64, 67]],
      attacks: [
        { at: 0, targetIndex: 0, notes: [60, 64, 69], expectedAdvance: false },
        { at: 1, targetIndex: 0, notes: [60, 64], expectedAdvance: true },
        { at: 2, targetIndex: 1, notes: [62, 65], expectedAdvance: true },
        { at: 3, targetIndex: 2, notes: [64, 67], expectedAdvance: true },
      ],
    },
  ];
}

function normalizedNote(value: number | ListenSequenceNote): ListenSequenceNote {
  return typeof value === "number" ? { midi: value } : value;
}

function sortedUnique(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function materializeListenSequence(
  definition: ListenSequenceDefinition,
  intervalMs: number,
): MaterializedListenSequence {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Sequence interval must be positive, received ${intervalMs}.`);
  }
  const attacks = definition.attacks.map((attack, attackIndex): ScheduledSequenceAttack => {
    if (!definition.targets[attack.targetIndex]) {
      throw new Error(`${definition.id} attack ${attackIndex} has no score target.`);
    }
    const scheduledAtMs = LISTEN_SEQUENCE_PRE_ROLL_MS + attack.at * intervalMs;
    const normalized = attack.notes.map(normalizedNote);
    const notes = normalized.map((playedNote, noteIndex): ScheduledSequenceNote => {
      const attackTimeMs = scheduledAtMs + (playedNote.offsetMs ?? 0);
      const holdMs = playedNote.holdMs ?? (playedNote.durationIntervals === undefined
        ? LISTEN_BENCHMARK_DEFAULT_HOLD_MS
        : playedNote.durationIntervals * intervalMs);
      return {
        id: `${attackIndex}:${noteIndex}`,
        midi: playedNote.midi,
        attackIndex,
        attackTimeMs,
        releaseTimeMs: attackTimeMs + holdMs,
      };
    });
    return {
      index: attackIndex,
      targetIndex: attack.targetIndex,
      scheduledAtMs,
      expectedAdvance: attack.expectedAdvance,
      playedPitches: sortedUnique(normalized.map(({ midi }) => midi)),
      notes,
      gainReferenceChordSize: attack.gainReferenceChordSize,
    };
  });
  const targets = definition.targets.map((pitches, index): ScheduledSequenceTarget => {
    const expectedAttack = attacks.find((attack) => (
      attack.targetIndex === index && attack.expectedAdvance
    ));
    if (!expectedAttack) {
      throw new Error(`${definition.id} target ${index} has no expected attack.`);
    }
    return {
      index,
      pitches: sortedUnique(pitches),
      scheduledAttackTimeMs: expectedAttack.scheduledAtMs,
      playedPitches: expectedAttack.playedPitches,
      attackIndex: expectedAttack.index,
    };
  });
  const latestAttack = Math.max(
    LISTEN_SEQUENCE_PRE_ROLL_MS,
    ...attacks.flatMap((attack) => attack.notes.map((playedNote) => playedNote.attackTimeMs)),
  );
  const latestEnvelopeEnd = Math.max(
    LISTEN_SEQUENCE_PRE_ROLL_MS,
    ...attacks.flatMap((attack) => attack.notes.map(
      (playedNote) => playedNote.releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS,
    )),
  );
  const durationMs = Math.max(latestAttack + LISTEN_SEQUENCE_TAIL_MS, latestEnvelopeEnd);
  const frameCount = Math.ceil(
    durationMs * ONLINE_AMT_SAMPLE_RATE / 1_000 / ONLINE_AMT_CHUNK_SIZE,
  ) * ONLINE_AMT_CHUNK_SIZE;
  return {
    definition,
    intervalMs,
    eventRate: 1_000 / intervalMs,
    attacks,
    targets,
    relevantPitches: sortedUnique([
      ...definition.targets.flatMap((pitches) => pitches),
      ...attacks.flatMap(({ playedPitches }) => playedPitches),
    ]),
    durationMs: frameCount * 1_000 / ONLINE_AMT_SAMPLE_RATE,
    frameCount,
  };
}

export function benchmarkAudioAttacksForSequence(
  sequence: MaterializedListenSequence,
): ListenBenchmarkAudioAttack[] {
  return sequence.attacks.map((attack) => ({
    onsetMs: attack.scheduledAtMs,
    gainReferenceChordSize: attack.gainReferenceChordSize,
    notes: attack.notes.map((playedNote) => ({
      midi: playedNote.midi,
      offsetMs: playedNote.attackTimeMs - attack.scheduledAtMs,
      holdMs: playedNote.releaseTimeMs - playedNote.attackTimeMs,
    })),
  }));
}

/** Renders a materialized passage through the canonical bundled-piano Web Audio graph. */
export function renderListenSequenceAudio(
  sequence: MaterializedListenSequence,
): Promise<ListenBenchmarkAudioRenderResult> {
  return renderBenchmarkAudio({
    attacks: benchmarkAudioAttacksForSequence(sequence),
    durationMs: sequence.durationMs,
    sampleRate: ONLINE_AMT_SAMPLE_RATE,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
  });
}

function normalizedTraceResetPlan(
  plan: ListenTraceResetPlan | undefined,
  frameCount: number,
): ListenTraceResetPlan {
  const normalized = plan ?? { mode: "stateful", points: [] };
  if (normalized.mode === "stateful" && normalized.points.length > 0) {
    throw new Error("Stateful trace reset plans cannot contain event reset points.");
  }
  const points = normalized.points.map((point) => ({ ...point }));
  let previousFrameIndex = -1;
  let previousEventIndex = 0;
  for (const point of points) {
    if (!Number.isInteger(point.frameIndex) || point.frameIndex <= previousFrameIndex) {
      throw new Error("Trace reset points must use strictly increasing frame indices.");
    }
    if (!Number.isInteger(point.eventIndex) || point.eventIndex <= previousEventIndex) {
      throw new Error("Trace reset points must use strictly increasing event indices after event zero.");
    }
    if (point.frameIndex >= frameCount) {
      throw new Error(`Trace reset frame ${point.frameIndex} is outside the audio.`);
    }
    const actualFrameStartMs = point.frameIndex * FRAME_MS;
    if (Math.abs(actualFrameStartMs - point.actualFrameStartMs) > 1e-9) {
      throw new Error(`Trace reset frame ${point.frameIndex} has an incorrect aligned timestamp.`);
    }
    if (point.actualFrameStartMs < point.requestedAtMs - 1e-9) {
      throw new Error("Trace reset warm-up cannot begin before the requested pre-roll time.");
    }
    if (point.actualFrameStartMs >= point.scheduledAttackTimeMs) {
      throw new Error("Trace reset points must occur before their scheduled attack.");
    }
    if (Math.abs(
      point.actualWarmupMs - (point.scheduledAttackTimeMs - point.actualFrameStartMs),
    ) > 1e-9) {
      throw new Error("Trace reset point warm-up does not match its aligned frame.");
    }
    previousFrameIndex = point.frameIndex;
    previousEventIndex = point.eventIndex;
  }
  return { mode: normalized.mode, points };
}

export async function captureListenSequenceTrace(options: {
  sequenceId: string;
  intervalMs: number;
  audio: Float32Array;
  relevantPitches: readonly number[];
  session: SequenceInferenceSession;
  decoder?: SequenceOutputDecoder;
  renderer?: ListenBenchmarkRendererConfiguration;
  audioDiagnostics?: ListenBenchmarkAudioDiagnostics;
  resetPlan?: ListenTraceResetPlan;
}): Promise<ListenRecognitionTrace> {
  if (options.audio.length % ONLINE_AMT_CHUNK_SIZE !== 0) {
    throw new Error("Continuous sequence audio must contain complete 512-sample chunks.");
  }
  const decoder = options.decoder ?? new OnlineAmtOutputDecoder();
  const frameCount = options.audio.length / ONLINE_AMT_CHUNK_SIZE;
  const resetPlan = normalizedTraceResetPlan(options.resetPlan, frameCount);
  options.session.reset();
  decoder.reset();
  const frames: ListenRecognitionFrame[] = [];
  let maximumInferenceMs = 0;
  let processingBacklogMs = 0;
  let maximumProcessingBacklogMs = 0;
  for (
    let sampleOffset = 0;
    sampleOffset < options.audio.length;
    sampleOffset += ONLINE_AMT_CHUNK_SIZE
  ) {
    const frameIndex = sampleOffset / ONLINE_AMT_CHUNK_SIZE;
    if (resetPlan.points.some((point) => point.frameIndex === frameIndex)) {
      // ONNX recurrent state and decoder transition history are one reset unit.
      options.session.reset();
      decoder.reset();
    }
    const output = await options.session.run(
      options.audio.subarray(sampleOffset, sampleOffset + ONLINE_AMT_CHUNK_SIZE),
    );
    const capturedAtMs = (sampleOffset + ONLINE_AMT_CHUNK_SIZE) * 1_000 /
      ONLINE_AMT_SAMPLE_RATE;
    const decoded = decoder.decode(
      output.scores,
      output.states,
      output.signalActive,
      capturedAtMs,
      options.relevantPitches,
    );
    const evidence = new Map(
      decoded.targetPitchEvidence.map(({ midi, confidence }) => [midi, confidence]),
    );
    maximumInferenceMs = Math.max(maximumInferenceMs, output.inferenceTimeMs);
    processingBacklogMs = Math.max(
      0,
      processingBacklogMs + output.inferenceTimeMs - FRAME_MS,
    );
    maximumProcessingBacklogMs = Math.max(
      maximumProcessingBacklogMs,
      processingBacklogMs,
    );
    frames.push({
      capturedAtMs,
      onsets: decoded.onsets.map((onset) => ({ ...onset })),
      noteEvents: decoded.noteEvents.map((event) => ({ ...event })),
      activePitches: decoded.recognizedActivePitches.map((pitch) => ({ ...pitch })),
      confidenceEvidence: options.relevantPitches.map((midi) => ({
        midi,
        confidence: evidence.get(midi) ?? 0,
      })),
      modelScores: Array.from(output.scores),
      modelStates: Array.from(output.states),
      signalActive: output.signalActive,
      inferenceDurationMs: output.inferenceTimeMs,
    });
  }
  const audioSignature = signatureForBenchmarkPcm(
    options.audio,
    ONLINE_AMT_SAMPLE_RATE,
    ONLINE_AMT_CHUNK_SIZE,
  );
  const audioDiagnostics = {
    ...(options.audioDiagnostics ?? measureBenchmarkPcm(options.audio)),
    audioSignature,
  };
  return {
    sequenceId: options.sequenceId,
    intervalMs: options.intervalMs,
    sampleRate: ONLINE_AMT_SAMPLE_RATE,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
    relevantPitches: [...options.relevantPitches],
    renderer: { ...(options.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    audioDiagnostics,
    audioSignature,
    resetPlan,
    pcm: new Float32Array(options.audio),
    frames,
    maximumInferenceMs,
    maximumProcessingBacklogMs,
  };
}

export interface RecognizedAttackObservation {
  midi: number;
  timeMs: number;
  confidence: number;
  noteConfidence: number;
  type: "onset" | "reOnset";
}

function recognizedAttacks(trace: ListenRecognitionTrace): RecognizedAttackObservation[] {
  const observations: RecognizedAttackObservation[] = [];
  for (const frame of trace.frames) {
    for (const event of frame.noteEvents) {
      if (event.type === "offset") continue;
      const onset = frame.onsets
        .filter(({ midi }) => midi === event.midi)
        .sort((left, right) => right.confidence - left.confidence)[0];
      observations.push({
        midi: event.midi,
        timeMs: event.eventTimeMs,
        confidence: onset?.confidence ?? event.confidence,
        noteConfidence: onset?.noteConfidence ?? 0,
        type: event.type,
      });
    }
  }
  return observations.sort((left, right) => left.timeMs - right.timeMs || left.midi - right.midi);
}

function scheduledAttackTypes(
  scheduledNotes: readonly ScheduledSequenceNote[],
): Map<string, RequiredAttackType> {
  const ordered = [...scheduledNotes].sort((left, right) => (
    left.attackTimeMs - right.attackTimeMs || left.midi - right.midi
  ));
  const previousAttackByPitch = new Map<number, number>();
  const requirements = new Map<string, RequiredAttackType>();
  for (const scheduled of ordered) {
    const previousAttackIndex = previousAttackByPitch.get(scheduled.midi);
    requirements.set(
      scheduled.id,
      previousAttackIndex !== undefined &&
          previousAttackIndex === scheduled.attackIndex - 1
        ? "reOnset"
        : "onset",
    );
    previousAttackByPitch.set(scheduled.midi, scheduled.attackIndex);
  }
  return requirements;
}

function scheduledAttributionEnds(
  scheduledNotes: readonly ScheduledSequenceNote[],
): Map<number, number> {
  const physicalAttacks = [...new Set(scheduledNotes.map(({ attackIndex }) => attackIndex))]
    .sort((left, right) => left - right)
    .map((attackIndex) => ({
      attackIndex,
      startMs: Math.min(
        ...scheduledNotes
          .filter((note) => note.attackIndex === attackIndex)
          .map(({ attackTimeMs }) => attackTimeMs),
      ),
    }));
  return new Map(physicalAttacks.map(({ attackIndex, startMs }, index) => [
    attackIndex,
    Math.min(
      startMs + RECOGNITION_ASSIGNMENT_MS,
      (physicalAttacks[index + 1]?.startMs ?? Infinity) - 0.001,
    ),
  ]));
}

/** Assigns each decoded attack to at most one physical scheduled attack. */
export function assignRecognitionEventsToAttacks(
  scheduledNotes: readonly ScheduledSequenceNote[],
  observations: readonly RecognizedAttackObservation[],
): Map<string, RecognizedAttackObservation> {
  const assignments = new Map<string, RecognizedAttackObservation>();
  const assignedObservations = new Set<RecognizedAttackObservation>();
  const requirements = scheduledAttackTypes(scheduledNotes);
  const attributionEnds = scheduledAttributionEnds(scheduledNotes);
  for (const observation of observations) {
    if (assignedObservations.has(observation)) continue;
    const candidates = scheduledNotes
      .filter((scheduled) => (
        scheduled.midi === observation.midi &&
        !assignments.has(scheduled.id) &&
        requirements.get(scheduled.id) === observation.type &&
        scheduled.attackTimeMs <= observation.timeMs + FRAME_MS &&
        observation.timeMs <= (attributionEnds.get(scheduled.attackIndex) ?? -Infinity)
      ))
      .sort((left, right) => right.attackTimeMs - left.attackTimeMs);
    if (candidates[0]) {
      assignments.set(candidates[0].id, observation);
      assignedObservations.add(observation);
    }
  }
  return assignments;
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * proportion) - 1];
}

function evidenceInWindow(
  trace: ListenRecognitionTrace,
  midi: number,
  startMs: number,
  endMs: number,
): {
  maximum: number;
  firstRawAtMs: number | null;
  firstQualifyingAtMs: number | null;
} {
  let maximum = 0;
  let firstRawAtMs: number | null = null;
  let firstQualifyingAtMs: number | null = null;
  for (const frame of trace.frames) {
    if (frame.capturedAtMs < startMs || frame.capturedAtMs >= endMs) continue;
    const confidence = frame.confidenceEvidence.find((pitch) => pitch.midi === midi)?.confidence ?? 0;
    maximum = Math.max(maximum, confidence);
    if (confidence >= 0.05 && firstRawAtMs === null) {
      firstRawAtMs = frame.capturedAtMs;
    }
    if (confidence >= matcherOptions.activeTargetThreshold && firstQualifyingAtMs === null) {
      firstQualifyingAtMs = frame.capturedAtMs;
    }
  }
  return { maximum, firstRawAtMs, firstQualifyingAtMs };
}

function matcherResult(
  frame: ListenRecognitionFrame,
  generation: number,
  targetPitches: readonly number[],
): RecognizerResult {
  return {
    generation,
    onsets: frame.onsets,
    noteEvents: frame.noteEvents,
    recognizedActivePitches: frame.activePitches,
    targetPitchEvidence: frame.confidenceEvidence.filter(({ midi }) => (
      targetPitches.includes(midi)
    )),
    processingTimeMs: frame.inferenceDurationMs,
    capturedAtMs: frame.capturedAtMs,
  };
}

export interface TraceEventRecognitionDiagnostic {
  expectedPitches: ExpectedPitchDiagnostic[];
  firstRawEvidenceTimeMs: number | null;
  firstThresholdQualifiedEvidenceTimeMs: number | null;
  confidentUnexpectedPitches: number[];
  allRequiredRawEvidencePresent: boolean;
  thresholdQualified: boolean;
  independentlyMatched: boolean;
  independentMatchAtMs: number | null;
  independentMatchLatencyMs: number | null;
  rawFailureReasons: ListenSequenceFailureReason[];
  independentFailureReasons: ListenSequenceFailureReason[];
  independentStaleGeneration: boolean;
}

/**
 * Computes target-correct raw and matcher metrics from an existing trace.
 * This function never renders audio and never invokes the inference session.
 */
export function evaluateTraceRecognitionLayers(
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
): TraceEventRecognitionDiagnostic[] {
  const observations = recognizedAttacks(trace);
  const scheduledNotes = sequence.attacks.flatMap(({ notes }) => notes);
  const assignments = assignRecognitionEventsToAttacks(scheduledNotes, observations);
  const requirements = scheduledAttackTypes(scheduledNotes);

  return sequence.targets.map((target, index) => {
    const expectedAttack = sequence.attacks[target.attackIndex];
    const nextPhysicalAttack = sequence.attacks
      .filter(({ scheduledAtMs }) => scheduledAtMs > expectedAttack.scheduledAtMs)
      .sort((left, right) => left.scheduledAtMs - right.scheduledAtMs)[0];
    const windowStartMs = target.scheduledAttackTimeMs - FRAME_MS;
    const windowEndMs = nextPhysicalAttack?.scheduledAtMs ??
      ((trace.frames.at(-1)?.capturedAtMs ?? sequence.durationMs) + FRAME_MS);
    const windowObservations = observations.filter((observation) => (
      observation.timeMs >= windowStartMs && observation.timeMs < windowEndMs
    ));
    const expectedPitches = target.pitches.map((midi): ExpectedPitchDiagnostic => {
      const scheduledNote = expectedAttack.notes.find((candidate) => candidate.midi === midi);
      const assignment = scheduledNote ? assignments.get(scheduledNote.id) : undefined;
      const requiredAttackType = scheduledNote
        ? requirements.get(scheduledNote.id) ?? "onset"
        : null;
      const active = evidenceInWindow(trace, midi, windowStartMs, windowEndMs);
      const rawPitchAttacks = windowObservations.filter((observation) => (
        observation.midi === midi
      ));
      const maximumOnsetConfidence = Math.max(
        assignment?.confidence ?? 0,
        ...rawPitchAttacks.map(({ confidence }) => confidence),
      );
      const qualifyingOnset = assignment !== undefined &&
        assignment.confidence >= matcherOptions.onsetThreshold &&
        assignment.noteConfidence >= matcherOptions.targetNoteThreshold;
      const firstAttackAtMs = rawPitchAttacks
        .map(({ timeMs }) => timeMs)
        .sort((left, right) => left - right)[0] ?? null;
      const firstRawEvidenceTimeMs = [firstAttackAtMs, active.firstRawAtMs]
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null;
      const firstThresholdQualifiedEvidenceTimeMs = [
        qualifyingOnset ? assignment.timeMs : null,
        active.firstQualifyingAtMs,
      ]
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null;
      const attackRequired = scheduledNote !== undefined;
      return {
        midi,
        attackRequired,
        requiredAttackType,
        rawAttackDetected: assignment !== undefined,
        rawOnsetProduced: assignment !== undefined,
        rawOnsetTimeMs: assignment?.timeMs ?? null,
        maximumOnsetConfidence,
        onsetConfidence: assignment?.confidence ?? 0,
        noteConfidence: assignment?.noteConfidence ?? 0,
        qualifyingOnset,
        maximumActiveConfidence: active.maximum,
        firstRawEvidenceTimeMs,
        firstThresholdQualifiedEvidenceTimeMs,
        requiredRawEvidencePresent: attackRequired
          ? assignment !== undefined
          : active.firstRawAtMs !== null,
        thresholdQualified: attackRequired
          ? qualifyingOnset
          : active.maximum >= matcherOptions.activeTargetThreshold,
      };
    });
    const confidentUnexpectedPitches = sortedUnique(windowObservations
      .filter((observation) => (
        !target.pitches.includes(observation.midi) &&
        observation.confidence >= matcherOptions.onsetThreshold &&
        observation.noteConfidence >= matcherOptions.noteThreshold
      ))
      .map(({ midi }) => midi));

    const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
    matcher.reset(0, 0, false);
    let previousFrame: ListenRecognitionFrame | null = null;
    for (const frame of trace.frames) {
      if (frame.capturedAtMs >= target.scheduledAttackTimeMs) break;
      matcher.consume(matcherResult(frame, 0, []));
      previousFrame = frame;
    }
    matcher.setTarget(target.pitches, 1, target.scheduledAttackTimeMs);
    const carryOverPitches = new Set(
      previousFrame?.activePitches
        .filter(({ confidence }) => confidence >= matcherOptions.activeTargetThreshold)
        .map(({ midi }) => midi) ?? [],
    );
    let independentMatchAtMs: number | null = null;
    let independentStaleGeneration = false;
    const independentExtras = new Set<number>();
    for (const frame of trace.frames) {
      if (frame.capturedAtMs < target.scheduledAttackTimeMs) continue;
      if (frame.capturedAtMs >= windowEndMs) break;
      const update = matcher.consume(matcherResult(frame, 1, target.pitches));
      independentStaleGeneration ||= update.stale;
      for (const midi of update.extraPitches) independentExtras.add(midi);
      if (update.matched) {
        independentMatchAtMs = frame.capturedAtMs;
        break;
      }
    }
    const independentlyMatched = independentMatchAtMs !== null;
    const rawFailureReasons: ListenSequenceFailureReason[] = [];
    for (const pitch of expectedPitches.filter(({ attackRequired }) => attackRequired)) {
      if (pitch.requiredRawEvidencePresent && pitch.thresholdQualified) continue;
      if (
        pitch.requiredAttackType === "reOnset" &&
        !pitch.rawAttackDetected &&
        pitch.maximumActiveConfidence >= matcherOptions.activeTargetThreshold
      ) {
        rawFailureReasons.push("retrigger-not-detected");
      } else if (
        pitch.firstRawEvidenceTimeMs !== null ||
        pitch.maximumOnsetConfidence > 0 ||
        pitch.maximumActiveConfidence >= 0.05
      ) {
        rawFailureReasons.push("onset-below-threshold");
      } else {
        rawFailureReasons.push("model-no-evidence");
      }
    }
    const independentFailureReasons: ListenSequenceFailureReason[] = [];
    if (!independentlyMatched) {
      const missingOnsets = expectedPitches.filter(({ qualifyingOnset }) => !qualifyingOnset);
      if (missingOnsets.some(({ midi }) => carryOverPitches.has(midi))) {
        independentFailureReasons.push("carry-over");
      }
      const bass = Math.min(...target.pitches);
      if (
        target.pitches.length >= 3 &&
        missingOnsets.some((pitch) => (
          pitch.midi === bass &&
          pitch.maximumActiveConfidence >= matcherOptions.activeTargetThreshold
        ))
      ) {
        independentFailureReasons.push("missing-required-bass-onset");
      }
      if (independentExtras.size > 0 || confidentUnexpectedPitches.length > 0) {
        independentFailureReasons.push("rejected-extra-pitch");
      }
      const evidenceTimes = expectedPitches
        .map(({ firstThresholdQualifiedEvidenceTimeMs }) => (
          firstThresholdQualifiedEvidenceTimeMs
        ))
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right);
      if (
        evidenceTimes.length >= 2 &&
        evidenceTimes.at(-1)! - evidenceTimes[0] > matcherOptions.collectionWindowMs
      ) {
        independentFailureReasons.push("evidence-too-spread-out");
      }
      if (independentStaleGeneration) independentFailureReasons.push("stale-generation");
      if (independentFailureReasons.length === 0) {
        independentFailureReasons.push("matcher-timeout");
      }
    }
    return {
      expectedPitches,
      firstRawEvidenceTimeMs: expectedPitches
        .map(({ firstRawEvidenceTimeMs }) => firstRawEvidenceTimeMs)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null,
      firstThresholdQualifiedEvidenceTimeMs: expectedPitches
        .map(({ firstThresholdQualifiedEvidenceTimeMs }) => (
          firstThresholdQualifiedEvidenceTimeMs
        ))
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null,
      confidentUnexpectedPitches,
      allRequiredRawEvidencePresent: expectedPitches.every((pitch) => (
        pitch.requiredRawEvidencePresent
      )),
      thresholdQualified: expectedPitches.every((pitch) => pitch.thresholdQualified),
      independentlyMatched,
      independentMatchAtMs,
      independentMatchLatencyMs: independentMatchAtMs === null
        ? null
        : independentMatchAtMs - target.scheduledAttackTimeMs,
      rawFailureReasons: [...new Set(rawFailureReasons)].sort(),
      independentFailureReasons: [...new Set(independentFailureReasons)].sort(),
      independentStaleGeneration,
    };
  });
}

export interface SequenceFailureInput {
  advanced: boolean;
  duplicate: boolean;
  skipped: boolean;
  falseAdvance: boolean;
  nextAttackBeforeAdvance: boolean;
  unexpectedPitches: readonly number[];
  targetPitches: readonly number[];
  previousTargetPitches: readonly number[];
  expectedPitches: readonly ExpectedPitchDiagnostic[];
  independentlyMatched?: boolean;
  blockedByPriorStall?: boolean;
  staleGeneration?: boolean;
  rawFailureReasons?: readonly ListenSequenceFailureReason[];
  independentFailureReasons?: readonly ListenSequenceFailureReason[];
  orderedFailureReasons?: readonly ListenSequenceFailureReason[];
}

export function classifyListenSequenceFailure(
  input: SequenceFailureInput,
): { reasons: ListenSequenceFailureReason[]; primary: ListenSequenceFailureReason | null } {
  if (
    input.rawFailureReasons !== undefined ||
    input.independentFailureReasons !== undefined ||
    input.orderedFailureReasons !== undefined
  ) {
    const reasons = [...new Set([
      ...(input.rawFailureReasons ?? []),
      ...(input.independentFailureReasons ?? []),
      ...(input.orderedFailureReasons ?? []),
    ])].sort();
    const priority: ListenSequenceFailureReason[] = [
      "blocked-by-prior-stall",
      "duplicate-or-held-attack",
      "skipped-target",
      "stale-generation",
      "rejected-extra-pitch",
      "carry-over",
      "retrigger-not-detected",
      "missing-required-bass-onset",
      "evidence-too-spread-out",
      "onset-below-threshold",
      "model-no-evidence",
      "next-attack-before-advance",
      "matcher-timeout",
    ];
    return {
      reasons,
      primary: priority.find((reason) => reasons.includes(reason)) ?? null,
    };
  }
  const reasons: ListenSequenceFailureReason[] = [];
  if (input.duplicate || input.skipped || input.falseAdvance) {
    reasons.push("duplicate-or-held-attack");
  }
  if (input.skipped) reasons.push("skipped-target");
  if (input.blockedByPriorStall) reasons.push("blocked-by-prior-stall");
  if (input.staleGeneration) reasons.push("stale-generation");
  if (input.nextAttackBeforeAdvance) reasons.push("next-attack-before-advance");
  if (!input.advanced) {
    if (input.unexpectedPitches.length > 0) reasons.push("rejected-extra-pitch");
    const missingQualifying = input.expectedPitches.filter((pitch) => !pitch.qualifyingOnset);
    if (missingQualifying.some((pitch) => (
      input.previousTargetPitches.includes(pitch.midi) &&
      pitch.maximumActiveConfidence >= matcherOptions.activeTargetThreshold
    ))) {
      reasons.push("retrigger-not-detected");
    }
    const bass = Math.min(...input.targetPitches);
    if (
      input.targetPitches.length >= 3 &&
      missingQualifying.some((pitch) => (
        pitch.midi === bass &&
        pitch.maximumActiveConfidence >= matcherOptions.activeTargetThreshold
      ))
    ) {
      reasons.push("missing-required-bass-onset");
    }
    if (missingQualifying.some((pitch) => (
      pitch.rawOnsetProduced || pitch.maximumActiveConfidence >= 0.05
    ))) {
      reasons.push("onset-below-threshold");
    }
    if (missingQualifying.some((pitch) => (
      !pitch.rawOnsetProduced && pitch.maximumActiveConfidence < 0.05
    ))) {
      reasons.push("model-no-evidence");
    }
    if (
      input.expectedPitches.every((pitch) => pitch.qualifyingOnset) ||
      reasons.length === 0
    ) {
      reasons.push("matcher-timeout");
    }
  }
  const priority: ListenSequenceFailureReason[] = [
    "blocked-by-prior-stall",
    "duplicate-or-held-attack",
    "skipped-target",
    "stale-generation",
    "rejected-extra-pitch",
    "carry-over",
    "retrigger-not-detected",
    "missing-required-bass-onset",
    "evidence-too-spread-out",
    "onset-below-threshold",
    "model-no-evidence",
    "next-attack-before-advance",
    "matcher-timeout",
  ];
  return {
    reasons: [...new Set(reasons)].sort(),
    primary: priority.find((reason) => reasons.includes(reason)) ?? null,
  };
}

export function replayListenSequenceTrace(
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
  policy: ListenSequenceReplayPolicy = "current-matcher",
): ListenSequenceRunResult {
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  let targetIndex = 0;
  let generation = 1;
  matcher.setTarget(sequence.targets[0]?.pitches ?? [], generation, 0);
  const advancements: Array<{
    targetIndex: number;
    atMs: number;
    sourceAttackIndex: number | null;
  }> = [];
  const attackTargetAtTime = new Map<number, number | null>();
  const extraPitchesByTarget = new Map<number, Set<number>>();
  const staleGenerationTargets = new Set<number>();
  let observedTargetOnsets = new Set<number>();
  let maximumTargetEvidence = new Map<number, number>();
  let bufferedFrames: ListenRecognitionFrame[] = [];
  let nextAttackIndex = 0;

  const rememberTargetEvidence = (
    frame: ListenRecognitionFrame,
    target: ScheduledSequenceTarget,
  ) => {
    for (const evidence of frame.confidenceEvidence) {
      if (!target.pitches.includes(evidence.midi)) continue;
      maximumTargetEvidence.set(
        evidence.midi,
        Math.max(maximumTargetEvidence.get(evidence.midi) ?? 0, evidence.confidence),
      );
    }
    const attackEvents = new Set(frame.noteEvents
      .filter(({ type }) => type !== "offset")
      .map(({ midi }) => midi));
    for (const onset of frame.onsets) {
      if (
        target.pitches.includes(onset.midi) &&
        attackEvents.has(onset.midi) &&
        onset.confidence >= matcherOptions.onsetThreshold &&
        onset.noteConfidence >= matcherOptions.targetNoteThreshold
      ) {
        observedTargetOnsets.add(onset.midi);
      }
    }
  };

  const targetReadyForFollowingAttack = (target: ScheduledSequenceTarget): boolean => {
    if (observedTargetOnsets.size === 0) return false;
    const bass = Math.min(...target.pitches);
    return target.pitches.every((midi) => (
      observedTargetOnsets.has(midi) ||
      (
        !(target.pitches.length >= 3 && midi === bass) &&
        (maximumTargetEvidence.get(midi) ?? 0) >= matcherOptions.activeTargetThreshold
      )
    ));
  };

  const rememberExtras = (index: number, extrasToAdd: readonly number[]) => {
    if (extrasToAdd.length === 0) return;
    const extras = extraPitchesByTarget.get(index) ?? new Set<number>();
    for (const midi of extrasToAdd) extras.add(midi);
    extraPitchesByTarget.set(index, extras);
  };

  const recordAdvancement = (atMs: number) => {
    const target = sequence.targets[targetIndex];
    if (!target) return;
    const expectedAttack = sequence.attacks[target.attackIndex];
    const expectedIsRecent = atMs >= expectedAttack.scheduledAtMs &&
      atMs - expectedAttack.scheduledAtMs <=
        matcherOptions.collectionWindowMs + matcherOptions.settleMs + FRAME_MS;
    const fallbackAttack = [...sequence.attacks]
      .filter((attack) => attack.scheduledAtMs <= atMs)
      .at(-1);
    const sourceAttack = expectedIsRecent ? expectedAttack : fallbackAttack;
    advancements.push({
      targetIndex,
      atMs,
      sourceAttackIndex: sourceAttack?.index ?? null,
    });
    targetIndex += 1;
    generation += 1;
    matcher.setTarget(
      sequence.targets[targetIndex]?.pitches ?? [],
      generation,
      atMs,
    );
    observedTargetOnsets = new Set<number>();
    maximumTargetEvidence = new Map<number, number>();
  };

  for (const frame of trace.frames) {
    while (
      nextAttackIndex < sequence.attacks.length &&
      sequence.attacks[nextAttackIndex].scheduledAtMs <= frame.capturedAtMs
    ) {
      attackTargetAtTime.set(
        sequence.attacks[nextAttackIndex].index,
        targetIndex < sequence.targets.length ? targetIndex : null,
      );
      nextAttackIndex += 1;
    }
    if (targetIndex >= sequence.targets.length) continue;
    const target = sequence.targets[targetIndex];
    const readyBeforeFrame = targetReadyForFollowingAttack(target);
    const nextTarget = sequence.targets[targetIndex + 1];
    let matcherOnsets = frame.onsets;
    let matcherNoteEvents = frame.noteEvents;
    if (policy === "next-onset-buffer" && readyBeforeFrame && nextTarget) {
      const candidateEvents = frame.noteEvents.filter((event) => (
        event.type !== "offset" &&
        nextTarget.pitches.includes(event.midi) &&
        frame.onsets.some((onset) => (
          onset.midi === event.midi &&
          onset.confidence >= matcherOptions.onsetThreshold &&
          onset.noteConfidence >= matcherOptions.targetNoteThreshold
        ))
      ));
      const candidatePitches = new Set(candidateEvents.map(({ midi }) => midi));
      if (candidatePitches.size > 0) {
        bufferedFrames.push({
          ...frame,
          onsets: frame.onsets.filter(({ midi }) => candidatePitches.has(midi)),
          noteEvents: candidateEvents,
        });
        // Once the current target has complete evidence, a later genuine attack
        // for the immediate next target belongs to that target rather than
        // becoming a wrong-note rejection during the current settle frame.
        matcherOnsets = frame.onsets.filter(({ midi }) => !candidatePitches.has(midi));
        matcherNoteEvents = frame.noteEvents.filter((event) => !candidateEvents.includes(event));
      }
    }
    bufferedFrames = bufferedFrames.filter((buffered) => (
      frame.capturedAtMs - buffered.capturedAtMs <= LISTEN_SEQUENCE_ONSET_BUFFER_MS
    ));
    const matcherFrame = {
      ...frame,
      onsets: matcherOnsets,
      noteEvents: matcherNoteEvents,
    };
    rememberTargetEvidence(matcherFrame, target);
    const targetEvidence = matcherFrame.confidenceEvidence.filter(({ midi }) => (
      target.pitches.includes(midi)
    ));
    const result: RecognizerResult = {
      generation,
      onsets: matcherFrame.onsets,
      noteEvents: matcherFrame.noteEvents,
      noteStates: undefined,
      recognizedActivePitches: matcherFrame.activePitches,
      targetPitchEvidence: targetEvidence,
      processingTimeMs: matcherFrame.inferenceDurationMs,
      capturedAtMs: matcherFrame.capturedAtMs,
    };
    const update = matcher.consume(result);
    if (update.stale) staleGenerationTargets.add(targetIndex);
    rememberExtras(targetIndex, update.extraPitches);
    if (!update.matched) continue;
    recordAdvancement(frame.capturedAtMs);

    // A buffer is scoped to exactly the generation that just ended. Replay it
    // once into the immediate following target, then discard it even if that
    // target also matches so one callback can never cascade through the score.
    const replayFrames = bufferedFrames;
    bufferedFrames = [];
    if (policy !== "next-onset-buffer" || targetIndex >= sequence.targets.length) continue;
    const bufferedTargetIndex = targetIndex;
    for (const buffered of replayFrames) {
      const bufferedTarget = sequence.targets[targetIndex];
      if (!bufferedTarget || targetIndex !== bufferedTargetIndex) break;
      rememberTargetEvidence(buffered, bufferedTarget);
      const bufferedUpdate = matcher.consume({
        generation,
        onsets: buffered.onsets,
        noteEvents: buffered.noteEvents,
        recognizedActivePitches: buffered.activePitches,
        targetPitchEvidence: buffered.confidenceEvidence.filter(({ midi }) => (
          bufferedTarget.pitches.includes(midi)
        )),
        processingTimeMs: buffered.inferenceDurationMs,
        capturedAtMs: buffered.capturedAtMs,
      });
      if (bufferedUpdate.stale) staleGenerationTargets.add(targetIndex);
      rememberExtras(targetIndex, bufferedUpdate.extraPitches);
      if (bufferedUpdate.matched) recordAdvancement(frame.capturedAtMs);
    }
  }
  while (nextAttackIndex < sequence.attacks.length) {
    attackTargetAtTime.set(
      sequence.attacks[nextAttackIndex].index,
      targetIndex < sequence.targets.length ? targetIndex : null,
    );
    nextAttackIndex += 1;
  }

  const recognitionLayers = evaluateTraceRecognitionLayers(sequence, trace);
  const advancementSourceCounts = new Map<number, number>();
  const duplicateAdvancementTargets = new Set<number>();
  for (const advancement of advancements) {
    if (advancement.sourceAttackIndex === null) continue;
    if ((advancementSourceCounts.get(advancement.sourceAttackIndex) ?? 0) > 0) {
      duplicateAdvancementTargets.add(advancement.targetIndex);
    }
    advancementSourceCounts.set(
      advancement.sourceAttackIndex,
      (advancementSourceCounts.get(advancement.sourceAttackIndex) ?? 0) + 1,
    );
  }
  const preliminaryEvents = sequence.targets.map((target, index): ListenSequenceEventDiagnostic => {
    const recognition = recognitionLayers[index];
    const nextTarget = sequence.targets[index + 1];
    const advancement = advancements.find((candidate) => candidate.targetIndex === index);
    const sourceAttack = advancement?.sourceAttackIndex === null ||
        advancement?.sourceAttackIndex === undefined
      ? null
      : sequence.attacks[advancement.sourceAttackIndex];
    const skipped = advancement !== undefined &&
      advancement.atMs + 0.001 < target.scheduledAttackTimeMs;
    const duplicate = duplicateAdvancementTargets.has(index);
    const falseAdvance = advancement !== undefined && (
      skipped || sourceAttack === null ||
      sourceAttack.targetIndex !== index || !sourceAttack.expectedAdvance
    );
    const nextAttackBeforeAdvance = nextTarget !== undefined && (
      advancement === undefined || nextTarget.scheduledAttackTimeMs < advancement.atMs
    );
    const activeTargetIndexAtAttack = attackTargetAtTime.get(target.attackIndex) ?? null;
    const orderedAdvanced = advancement !== undefined &&
      sourceAttack?.index === target.attackIndex &&
      !duplicate &&
      !skipped &&
      !falseAdvance;
    const unexpectedPitches = sortedUnique([
      ...recognition.confidentUnexpectedPitches,
      ...(extraPitchesByTarget.get(index) ?? []),
    ]);
    const orderedFailureReasons: ListenSequenceFailureReason[] = [];
    if (nextAttackBeforeAdvance) orderedFailureReasons.push("next-attack-before-advance");
    if (duplicate) orderedFailureReasons.push("duplicate-or-held-attack");
    if (skipped || (advancement !== undefined && sourceAttack?.index !== target.attackIndex)) {
      orderedFailureReasons.push("skipped-target");
    }
    if (staleGenerationTargets.has(index)) orderedFailureReasons.push("stale-generation");
    return {
      index,
      scheduledAttackTimeMs: target.scheduledAttackTimeMs,
      targetPitches: target.pitches,
      playedPitches: target.playedPitches,
      expectedPitches: recognition.expectedPitches,
      firstRawEvidenceTimeMs: recognition.firstRawEvidenceTimeMs,
      firstThresholdQualifiedEvidenceTimeMs:
        recognition.firstThresholdQualifiedEvidenceTimeMs,
      firstQualifyingPitchEvidenceTimeMs:
        recognition.firstThresholdQualifiedEvidenceTimeMs,
      confidentUnexpectedPitches: recognition.confidentUnexpectedPitches,
      allRequiredRawEvidencePresent: recognition.allRequiredRawEvidencePresent,
      thresholdQualified: recognition.thresholdQualified,
      independentlyMatched: recognition.independentlyMatched,
      independentMatchAtMs: recognition.independentMatchAtMs,
      independentMatchLatencyMs: recognition.independentMatchLatencyMs,
      orderedAdvanced,
      orderedAdvancedAtMs: orderedAdvanced ? advancement.atMs : null,
      orderedAdvanceLatencyMs: orderedAdvanced
        ? advancement.atMs - target.scheduledAttackTimeMs
        : null,
      advanced: advancement !== undefined,
      advancedAtMs: advancement?.atMs ?? null,
      onsetToAdvanceMs: advancement === undefined
        ? null
        : advancement.atMs - target.scheduledAttackTimeMs,
      activeTargetIndexAtAttack,
      blockedByPriorStall: false,
      unexpectedPitches,
      nextAttackBeforeAdvance,
      missed: advancement === undefined,
      duplicate,
      skipped,
      falseAdvance,
      timedOut: !recognition.independentlyMatched,
      rawFailureReasons: recognition.rawFailureReasons,
      independentFailureReasons: recognition.independentFailureReasons,
      orderedFailureReasons: [...new Set(orderedFailureReasons)].sort(),
      failureReasons: [],
      primaryFailure: null,
    };
  });
  const firstStallIndex = preliminaryEvents.findIndex((event) => (
    !event.orderedAdvanced ||
    event.activeTargetIndexAtAttack !== event.index ||
    event.nextAttackBeforeAdvance
  ));
  const events = preliminaryEvents.map((event): ListenSequenceEventDiagnostic => {
    const blockedByPriorStall = firstStallIndex >= 0 &&
      event.index > firstStallIndex &&
      event.independentlyMatched &&
      !event.orderedAdvanced;
    const orderedFailureReasons = blockedByPriorStall
      ? [...event.orderedFailureReasons, "blocked-by-prior-stall" as const]
      : event.orderedFailureReasons;
    const failure = classifyListenSequenceFailure({
      advanced: event.orderedAdvanced,
      duplicate: event.duplicate,
      skipped: event.skipped,
      falseAdvance: event.falseAdvance,
      nextAttackBeforeAdvance: event.nextAttackBeforeAdvance,
      unexpectedPitches: event.unexpectedPitches,
      targetPitches: event.targetPitches,
      previousTargetPitches: sequence.targets[event.index - 1]?.pitches ?? [],
      expectedPitches: event.expectedPitches,
      independentlyMatched: event.independentlyMatched,
      blockedByPriorStall,
      staleGeneration: orderedFailureReasons.includes("stale-generation"),
      rawFailureReasons: event.rawFailureReasons,
      independentFailureReasons: event.independentFailureReasons,
      orderedFailureReasons,
    });
    return {
      ...event,
      blockedByPriorStall,
      orderedFailureReasons: [...new Set(orderedFailureReasons)].sort(),
      failureReasons: failure.reasons,
      primaryFailure: failure.primary,
    };
  });
  const correctEvents = events.filter(({ orderedAdvanced }) => orderedAdvanced);
  const orderedLatencies = correctEvents.flatMap((event) => (
    event.orderedAdvanceLatencyMs === null ? [] : [event.orderedAdvanceLatencyMs]
  ));
  const independentLatencies = events.flatMap((event) => (
    event.independentMatchLatencyMs === null ? [] : [event.independentMatchLatencyMs]
  ));
  const reasonCounts: Partial<Record<ListenSequenceFailureReason, number>> = {};
  for (const event of events) {
    for (const reason of event.failureReasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }
  const rawCompleteEvidenceCount = events.filter((event) => (
    event.allRequiredRawEvidencePresent
  )).length;
  const thresholdQualifiedEventCount = events.filter((event) => event.thresholdQualified).length;
  const independentMatchCount = events.filter((event) => event.independentlyMatched).length;
  const blockedEventPositions = events
    .filter((event) => event.blockedByPriorStall)
    .map(({ index }) => index);
  const summary: ListenSequenceRunSummary = {
    complete: correctEvents.length === events.length &&
      advancements.length === events.length,
    rawCompleteEvidenceCount,
    rawCompleteEvidenceRate: events.length === 0 ? 0 : rawCompleteEvidenceCount / events.length,
    thresholdQualifiedEventCount,
    thresholdQualifiedEventRate: events.length === 0
      ? 0
      : thresholdQualifiedEventCount / events.length,
    independentMatchCount,
    independentMatchRate: events.length === 0 ? 0 : independentMatchCount / events.length,
    orderedAdvanceCount: correctEvents.length,
    orderedAdvanceRate: events.length === 0 ? 0 : correctEvents.length / events.length,
    recognizedButBlockedCount: blockedEventPositions.length,
    cascadeLossCount: blockedEventPositions.length,
    blockedEventPositions,
    firstCausalStallIndex: firstStallIndex < 0 ? null : firstStallIndex,
    correctAdvanceCount: correctEvents.length,
    expectedEventCount: events.length,
    correctAdvanceRate: events.length === 0 ? 0 : correctEvents.length / events.length,
    orderedPrefixCompleted: firstStallIndex < 0 ? events.length : firstStallIndex,
    firstStallIndex: firstStallIndex < 0 ? null : firstStallIndex,
    missedCount: events.filter(({ missed }) => missed).length,
    duplicateAdvanceCount: events.filter(({ duplicate }) => duplicate).length,
    skippedAdvanceCount: events.filter(({ skipped }) => skipped).length,
    falseAdvanceCount: events.filter(({ falseAdvance }) => falseAdvance).length,
    p50OnsetToAdvanceMs: percentile(orderedLatencies, 0.5),
    p95OnsetToAdvanceMs: percentile(orderedLatencies, 0.95),
    p50IndependentMatchLatencyMs: percentile(independentLatencies, 0.5),
    p95IndependentMatchLatencyMs: percentile(independentLatencies, 0.95),
    p50OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.5),
    p95OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.95),
    reasonCounts,
    maximumInferenceMs: trace.maximumInferenceMs,
    maximumProcessingBacklogMs: trace.maximumProcessingBacklogMs,
    nextAttackBeforeAdvanceCount: events.filter(({ nextAttackBeforeAdvance }) => (
      nextAttackBeforeAdvance
    )).length,
  };
  return {
    policy,
    sequenceId: sequence.definition.id,
    sequenceLabel: sequence.definition.label,
    family: sequence.definition.family,
    intervalMs: sequence.intervalMs,
    eventRate: sequence.eventRate,
    renderer: { ...trace.renderer },
    trace,
    events,
    attacks: sequence.attacks.map((attack) => ({
      index: attack.index,
      scheduledAtMs: attack.scheduledAtMs,
      targetIndex: attack.targetIndex,
      playedPitches: attack.playedPitches,
      expectedAdvance: attack.expectedAdvance,
      activeTargetIndexAtAttack: attackTargetAtTime.get(attack.index) ?? null,
      advancementTargetIndices: advancements
        .filter(({ sourceAttackIndex }) => sourceAttackIndex === attack.index)
        .map(({ targetIndex: advancedTarget }) => advancedTarget),
    })),
    summary,
  };
}

function modelStateBeforeAttack(
  trace: ListenRecognitionTrace,
  midi: number,
  attackTimeMs: number,
): number | null {
  const frame = [...trace.frames]
    .reverse()
    .find(({ capturedAtMs }) => capturedAtMs < attackTimeMs);
  if (!frame) return null;
  if (frame.modelStates.length === 88) {
    return frame.modelStates[midi - FIRST_PIANO_MIDI] ?? null;
  }
  const relevantIndex = trace.relevantPitches.indexOf(midi);
  return relevantIndex < 0 ? null : frame.modelStates[relevantIndex] ?? null;
}

function activeBeforeAttack(
  trace: ListenRecognitionTrace,
  midi: number,
  attackTimeMs: number,
): boolean {
  const frame = [...trace.frames]
    .reverse()
    .find(({ capturedAtMs }) => capturedAtMs < attackTimeMs);
  return frame?.activePitches.some((pitch) => (
    pitch.midi === midi && pitch.confidence >= matcherOptions.activeTargetThreshold
  )) ?? false;
}

function pcmRmsInWindow(
  trace: ListenRecognitionTrace,
  startMs: number,
  endMs: number,
): number {
  const startFrame = Math.max(0, Math.ceil(startMs * trace.sampleRate / 1_000));
  const endFrame = Math.min(trace.pcm.length, Math.floor(endMs * trace.sampleRate / 1_000));
  if (endFrame <= startFrame) return 0;
  let sumSquares = 0;
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const value = trace.pcm[frame];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / (endFrame - startFrame));
}

/** Derives articulation-specific state and release diagnostics without rerunning inference. */
export function diagnoseListenArticulationRun(
  articulation: ListenSequenceArticulation,
  sequence: MaterializedListenSequence,
  run: ListenSequenceRunResult,
): { events: ListenArticulationEventDiagnostic[]; summary: ListenArticulationRunSummary } {
  const events = run.events.map((event, index): ListenArticulationEventDiagnostic => {
    const previousTarget = sequence.targets[index - 1];
    const currentTarget = sequence.targets[index];
    const repeatedPitches = previousTarget
      ? currentTarget.pitches.filter((midi) => previousTarget.pitches.includes(midi))
      : [];
    const previousPitches = previousTarget?.pitches ?? [];
    const departingPitches = previousPitches
      .filter((midi) => !currentTarget.pitches.includes(midi))
      .map((midi): ListenArticulationDepartingPitchDiagnostic => ({
        midi,
        activeAtNextAttack: activeBeforeAttack(
          run.trace,
          midi,
          currentTarget.scheduledAttackTimeMs,
        ),
        offsetBeforeNextAttack: run.trace.frames.some((frame) => frame.noteEvents.some(
          (noteEvent) => noteEvent.midi === midi &&
            noteEvent.type === "offset" &&
            noteEvent.eventTimeMs > (previousTarget?.scheduledAttackTimeMs ?? -Infinity) &&
            noteEvent.eventTimeMs < currentTarget.scheduledAttackTimeMs,
        )),
      }));
    const expectedFreshPitches = event.expectedPitches.filter(({ attackRequired }) => (
      attackRequired
    ));
    const nextPhysicalAttack = sequence.attacks
      .filter(({ scheduledAtMs }) => scheduledAtMs > currentTarget.scheduledAttackTimeMs)
      .at(0);
    const freshAttackWindowEndMs = nextPhysicalAttack?.scheduledAtMs ?? Infinity;
    const observedFreshAttacks = new Map<number, "onset" | "reOnset">();
    for (const frame of run.trace.frames) {
      for (const noteEvent of frame.noteEvents) {
        if (
          noteEvent.type === "offset" ||
          noteEvent.eventTimeMs < currentTarget.scheduledAttackTimeMs - FRAME_MS ||
          noteEvent.eventTimeMs >= freshAttackWindowEndMs ||
          !expectedFreshPitches.some(({ midi }) => midi === noteEvent.midi) ||
          observedFreshAttacks.has(noteEvent.midi)
        ) continue;
        observedFreshAttacks.set(noteEvent.midi, noteEvent.type);
      }
    }
    const previousPhysicalAttack = sequence.attacks
      .filter(({ scheduledAtMs }) => scheduledAtMs < currentTarget.scheduledAttackTimeMs)
      .at(-1);
    const previousEnvelopeEndMs = previousPhysicalAttack && previousPhysicalAttack.notes.length > 0
      ? Math.max(...previousPhysicalAttack.notes.map(({ releaseTimeMs }) => (
          releaseTimeMs + LISTEN_BENCHMARK_RELEASE_MS
        )))
      : null;
    const silenceGap = articulation === "detached" && previousEnvelopeEndMs !== null &&
        previousEnvelopeEndMs < currentTarget.scheduledAttackTimeMs
      ? {
          startMs: previousEnvelopeEndMs,
          endMs: currentTarget.scheduledAttackTimeMs,
          durationMs: currentTarget.scheduledAttackTimeMs - previousEnvelopeEndMs,
          rms: pcmRmsInWindow(
            run.trace,
            previousEnvelopeEndMs,
            currentTarget.scheduledAttackTimeMs,
          ),
        }
      : null;
    const allFailureReasons = new Set(event.failureReasons);
    const failureClassification = allFailureReasons.has("retrigger-not-detected")
      ? "retrigger-not-detected" as const
      : allFailureReasons.has("carry-over")
      ? "carry-over" as const
      : allFailureReasons.has("model-no-evidence")
      ? "model-no-evidence" as const
      : null;
    return {
      index,
      expectedFreshAttackCount: expectedFreshPitches.length,
      producedFreshAttackCount: observedFreshAttacks.size,
      expectedOnsetCount: expectedFreshPitches.filter(({ requiredAttackType }) => (
        requiredAttackType === "onset"
      )).length,
      producedOnsetCount: [...observedFreshAttacks.values()].filter((type) => (
        type === "onset"
      )).length,
      expectedReOnsetCount: expectedFreshPitches.filter(({ requiredAttackType }) => (
        requiredAttackType === "reOnset"
      )).length,
      producedReOnsetCount: [...observedFreshAttacks.values()].filter((type) => (
        type === "reOnset"
      )).length,
      repeatedPitches,
      repeatedPitchesInSustain: repeatedPitches.filter((midi) => (
        modelStateBeforeAttack(run.trace, midi, currentTarget.scheduledAttackTimeMs) === 2
      )),
      departingPitches,
      confidentPreviousChordExtraPitches: event.unexpectedPitches.filter((midi) => (
        previousPitches.includes(midi)
      )),
      silenceGap,
      failureClassification,
    };
  });
  const expectedFreshAttackCount = events.reduce(
    (total, event) => total + event.expectedFreshAttackCount,
    0,
  );
  const producedFreshAttackCount = events.reduce(
    (total, event) => total + event.producedFreshAttackCount,
    0,
  );
  const detachedGaps = events.flatMap(({ silenceGap }) => silenceGap ? [silenceGap] : []);
  const failureCount = (reason: ListenSequenceFailureReason) => run.events.filter((event) => (
    event.failureReasons.includes(reason)
  )).length;
  return {
    events,
    summary: {
      articulation,
      expectedEventCount: run.summary.expectedEventCount,
      rawEvidenceCount: run.summary.rawCompleteEvidenceCount,
      rawEvidenceRate: run.summary.rawCompleteEvidenceRate,
      expectedFreshAttackCount,
      producedFreshAttackCount,
      freshAttackRate: expectedFreshAttackCount === 0
        ? 0
        : producedFreshAttackCount / expectedFreshAttackCount,
      expectedOnsetCount: events.reduce(
        (total, event) => total + event.expectedOnsetCount,
        0,
      ),
      producedOnsetCount: events.reduce(
        (total, event) => total + event.producedOnsetCount,
        0,
      ),
      expectedReOnsetCount: events.reduce(
        (total, event) => total + event.expectedReOnsetCount,
        0,
      ),
      producedReOnsetCount: events.reduce(
        (total, event) => total + event.producedReOnsetCount,
        0,
      ),
      independentMatchCount: run.summary.independentMatchCount,
      independentMatchRate: run.summary.independentMatchRate,
      orderedAdvanceCount: run.summary.orderedAdvanceCount,
      orderedAdvanceRate: run.summary.orderedAdvanceRate,
      completePassage: run.summary.complete,
      staleSustainPitchCount: events.reduce(
        (total, event) => total + event.repeatedPitchesInSustain.length,
        0,
      ),
      carryOverEventCount: events.filter((event) => (
        event.departingPitches.some(({ activeAtNextAttack }) => activeAtNextAttack) ||
        event.confidentPreviousChordExtraPitches.length > 0 ||
        event.failureClassification === "carry-over"
      )).length,
      departingPitchActiveCount: events.reduce(
        (total, event) => total + event.departingPitches.filter(({ activeAtNextAttack }) => (
          activeAtNextAttack
        )).length,
        0,
      ),
      departingPitchOffsetBeforeNextAttackCount: events.reduce(
        (total, event) => total + event.departingPitches.filter(({ offsetBeforeNextAttack }) => (
          offsetBeforeNextAttack
        )).length,
        0,
      ),
      confidentPreviousChordExtraCount: events.reduce(
        (total, event) => total + event.confidentPreviousChordExtraPitches.length,
        0,
      ),
      retriggerNotDetectedFailureCount: failureCount("retrigger-not-detected"),
      carryOverFailureCount: failureCount("carry-over"),
      modelNoEvidenceFailureCount: failureCount("model-no-evidence"),
      falseAdvanceCount: run.summary.falseAdvanceCount,
      skippedAdvanceCount: run.summary.skippedAdvanceCount,
      duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
      detachedSilenceGapCount: detachedGaps.length,
      maximumDetachedSilenceGapRms: detachedGaps.length === 0
        ? null
        : Math.max(...detachedGaps.map(({ rms }) => rms)),
    },
  };
}

function articulationDelta(
  summary: ListenArticulationRunSummary,
  normal: ListenArticulationRunSummary,
): ListenArticulationNormalDelta {
  return {
    rawEvidenceCount: summary.rawEvidenceCount - normal.rawEvidenceCount,
    rawEvidenceRate: summary.rawEvidenceRate - normal.rawEvidenceRate,
    producedFreshAttackCount:
      summary.producedFreshAttackCount - normal.producedFreshAttackCount,
    freshAttackRate: summary.freshAttackRate - normal.freshAttackRate,
    independentMatchCount: summary.independentMatchCount - normal.independentMatchCount,
    independentMatchRate: summary.independentMatchRate - normal.independentMatchRate,
    orderedAdvanceCount: summary.orderedAdvanceCount - normal.orderedAdvanceCount,
    orderedAdvanceRate: summary.orderedAdvanceRate - normal.orderedAdvanceRate,
    staleSustainPitchCount: summary.staleSustainPitchCount - normal.staleSustainPitchCount,
    carryOverEventCount: summary.carryOverEventCount - normal.carryOverEventCount,
    falseAdvanceCount: summary.falseAdvanceCount - normal.falseAdvanceCount,
    skippedAdvanceCount: summary.skippedAdvanceCount - normal.skippedAdvanceCount,
    duplicateAdvanceCount: summary.duplicateAdvanceCount - normal.duplicateAdvanceCount,
  };
}

export function interpretListenArticulationMatrix(
  runs: readonly Pick<ListenArticulationRunResult, "articulation" | "summary">[],
): ListenArticulationDiagnosticConclusion {
  const normal = runs.find(({ articulation }) => articulation === "normal")?.summary;
  const detached = runs.find(({ articulation }) => articulation === "detached")?.summary;
  if (!normal || !detached) {
    throw new Error("Articulation interpretation requires normal and detached runs.");
  }
  const independentImprovement = detached.independentMatchCount - normal.independentMatchCount;
  const orderedImprovement = detached.orderedAdvanceCount - normal.orderedAdvanceCount;
  const rawImprovement = detached.rawEvidenceCount - normal.rawEvidenceCount;
  const safetyErrorsIntroduced = detached.falseAdvanceCount > normal.falseAdvanceCount ||
    detached.skippedAdvanceCount > normal.skippedAdvanceCount ||
    detached.duplicateAdvanceCount > normal.duplicateAdvanceCount;
  const substantialDetachedImprovement =
    independentImprovement >= LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT &&
    !safetyErrorsIntroduced;
  let code: ListenArticulationDiagnosticCode = "inconclusive";
  let conclusion = "No articulation profile isolated one dominant failure layer.";
  if (safetyErrorsIntroduced) {
    code = "inconclusive-safety-errors";
    conclusion = "Detached articulation introduced safety errors, so its improvement is not accepted.";
  } else if (
    substantialDetachedImprovement &&
    rawImprovement >= LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT &&
    detached.staleSustainPitchCount < normal.staleSustainPitchCount
  ) {
    code = "recognizer-state-release-interference";
    conclusion = "Detached attacks improved raw recognition and reduced stale sustain; recognizer state or release interference is likely.";
  } else if (
    substantialDetachedImprovement &&
    Math.abs(rawImprovement) < LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT
  ) {
    code = "matcher-carry-over-handling";
    conclusion = "Raw evidence stayed similar while independent matching improved; matcher carry-over handling is likely.";
  } else if (
    Math.abs(independentImprovement) < LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT &&
    orderedImprovement >= LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT
  ) {
    code = "ordered-cascade-playhead";
    conclusion = "Only ordered progress improved substantially; cascade or playhead behavior is the likely layer.";
  } else if (
    independentImprovement < LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT &&
    detached.modelNoEvidenceFailureCount > 0
  ) {
    code = "base-model-recall";
    conclusion = "Detached articulation did not substantially improve independent matching and expected pitches still lacked evidence; base-model recall remains the likely limitation.";
  }
  return {
    code,
    text: conclusion,
    substantialThresholdCount: LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT,
    substantialThresholdRate: LISTEN_ARTICULATION_SUBSTANTIAL_EVENT_COUNT /
      COURSE_CLEAR_BENCHMARK_MOMENTS.length,
    detachedIndependentMatchImprovement: independentImprovement,
    detachedOrderedAdvanceImprovement: orderedImprovement,
    safetyErrorsIntroduced,
    substantialDetachedImprovement,
  };
}

export function summarizeCourseClearArticulationMatrix(
  capturedRuns: readonly {
    articulation: ListenSequenceArticulation;
    sequence: MaterializedListenSequence;
    run: ListenSequenceRunResult;
  }[],
): ListenArticulationMatrixResult {
  const diagnosed = capturedRuns.map(({ articulation, sequence, run }) => ({
    articulation,
    run,
    ...diagnoseListenArticulationRun(articulation, sequence, run),
  }));
  const normal = diagnosed.find(({ articulation }) => articulation === "normal")?.summary;
  if (!normal) throw new Error("Articulation matrix is missing its normal control run.");
  const runs: ListenArticulationRunResult[] = diagnosed.map((entry) => ({
    ...entry,
    deltaFromNormal: articulationDelta(entry.summary, normal),
  }));
  return {
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    eventCount: COURSE_CLEAR_BENCHMARK_MOMENTS.length,
    renderer: { ...(runs[0]?.run.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    runs,
    conclusion: interpretListenArticulationMatrix(runs),
  };
}

function aggregateRuns(
  runs: readonly ListenSequenceRunResult[],
  intervalMs: number,
  family?: string,
): ListenSequenceAggregateSummary {
  const expectedEventCount = runs.reduce(
    (total, run) => total + run.summary.expectedEventCount,
    0,
  );
  const correctAdvanceCount = runs.reduce(
    (total, run) => total + run.summary.correctAdvanceCount,
    0,
  );
  const rawCompleteEvidenceCount = runs.reduce(
    (total, run) => total + run.summary.rawCompleteEvidenceCount,
    0,
  );
  const thresholdQualifiedEventCount = runs.reduce(
    (total, run) => total + run.summary.thresholdQualifiedEventCount,
    0,
  );
  const independentMatchCount = runs.reduce(
    (total, run) => total + run.summary.independentMatchCount,
    0,
  );
  const orderedAdvanceCount = runs.reduce(
    (total, run) => total + run.summary.orderedAdvanceCount,
    0,
  );
  const failureClassifications: Partial<Record<ListenSequenceFailureReason, number>> = {};
  for (const run of runs) {
    for (const event of run.events) {
      for (const reason of event.failureReasons) {
        failureClassifications[reason] = (failureClassifications[reason] ?? 0) + 1;
      }
    }
  }
  const orderedLatencies = runs.flatMap((run) => run.events.flatMap((event) => (
    event.orderedAdvanced && event.orderedAdvanceLatencyMs !== null
      ? [event.orderedAdvanceLatencyMs]
      : []
  )));
  const independentLatencies = runs.flatMap((run) => run.events.flatMap((event) => (
    event.independentMatchLatencyMs !== null ? [event.independentMatchLatencyMs] : []
  )));
  return {
    intervalMs,
    eventRate: 1_000 / intervalMs,
    family,
    sequenceCount: runs.length,
    completePassageRate: runs.length === 0
      ? 0
      : runs.filter(({ summary }) => summary.complete).length / runs.length,
    rawCompleteEvidenceCount,
    rawCompleteEvidenceRate: expectedEventCount === 0
      ? 0
      : rawCompleteEvidenceCount / expectedEventCount,
    thresholdQualifiedEventCount,
    thresholdQualifiedEventRate: expectedEventCount === 0
      ? 0
      : thresholdQualifiedEventCount / expectedEventCount,
    independentMatchCount,
    independentMatchRate: expectedEventCount === 0
      ? 0
      : independentMatchCount / expectedEventCount,
    orderedAdvanceCount,
    orderedAdvanceRate: expectedEventCount === 0
      ? 0
      : orderedAdvanceCount / expectedEventCount,
    recognizedButBlockedCount: runs.reduce(
      (total, run) => total + run.summary.recognizedButBlockedCount,
      0,
    ),
    cascadeLossCount: runs.reduce(
      (total, run) => total + run.summary.cascadeLossCount,
      0,
    ),
    blockedEventPositions: runs
      .filter(({ summary }) => summary.blockedEventPositions.length > 0)
      .map((run) => ({
        sequenceId: run.sequenceId,
        positions: run.summary.blockedEventPositions,
      })),
    correctAdvanceCount,
    expectedEventCount,
    correctAdvanceRate: expectedEventCount === 0 ? 0 : correctAdvanceCount / expectedEventCount,
    orderedPrefixCompleted: runs.reduce(
      (total, run) => total + run.summary.orderedPrefixCompleted,
      0,
    ),
    incompleteSequences: runs
      .filter(({ summary }) => !summary.complete)
      .map(({ sequenceId }) => sequenceId),
    firstStalls: runs.flatMap((run) => run.summary.firstStallIndex === null
      ? []
      : [{
          sequenceId: run.sequenceId,
          position: run.summary.firstStallIndex,
          primaryFailure: run.events[run.summary.firstStallIndex]?.primaryFailure ?? null,
        }]),
    failureClassifications,
    missedCount: runs.reduce((total, run) => total + run.summary.missedCount, 0),
    duplicateAdvanceCount: runs.reduce(
      (total, run) => total + run.summary.duplicateAdvanceCount,
      0,
    ),
    skippedAdvanceCount: runs.reduce(
      (total, run) => total + run.summary.skippedAdvanceCount,
      0,
    ),
    falseAdvanceCount: runs.reduce(
      (total, run) => total + run.summary.falseAdvanceCount,
      0,
    ),
    p50OnsetToAdvanceMs: percentile(orderedLatencies, 0.5),
    p95OnsetToAdvanceMs: percentile(orderedLatencies, 0.95),
    p50IndependentMatchLatencyMs: percentile(independentLatencies, 0.5),
    p95IndependentMatchLatencyMs: percentile(independentLatencies, 0.95),
    p50OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.5),
    p95OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.95),
    maximumInferenceMs: Math.max(0, ...runs.map(({ summary }) => summary.maximumInferenceMs)),
    maximumProcessingBacklogMs: Math.max(
      0,
      ...runs.map(({ summary }) => summary.maximumProcessingBacklogMs),
    ),
    nextAttackBeforeAdvanceCount: runs.reduce(
      (total, run) => total + run.summary.nextAttackBeforeAdvanceCount,
      0,
    ),
  };
}

function familyCompletion(
  summaries: readonly ListenSequenceAggregateSummary[],
  family: string,
): number | null {
  const selected = summaries.filter((summary) => summary.family === family);
  if (selected.length === 0) return null;
  const sequenceCount = selected.reduce((total, summary) => total + summary.sequenceCount, 0);
  if (sequenceCount === 0) return null;
  return selected.reduce(
    (total, summary) => total + summary.completePassageRate * summary.sequenceCount,
    0,
  ) / sequenceCount;
}

export function summarizeListenSequenceBenchmark(
  runs: readonly ListenSequenceRunResult[],
): Omit<ListenSequenceBenchmarkResult, "policy" | "runs" | "experimental"> {
  const intervals = sortedUnique(runs.map(({ intervalMs }) => intervalMs)).sort(
    (left, right) => right - left,
  );
  const speedSummaries = intervals.map((intervalMs) => aggregateRuns(
    runs.filter((run) => run.intervalMs === intervalMs),
    intervalMs,
  ));
  const families = [...new Set(runs.map(({ family }) => family))].sort();
  const familySpeedSummaries = intervals.flatMap((intervalMs) => families.flatMap((family) => {
    const selected = runs.filter((run) => (
      run.intervalMs === intervalMs && run.family === family
    ));
    return selected.length === 0 ? [] : [aggregateRuns(selected, intervalMs, family)];
  }));
  let sharpestCompletionDrop: ListenSequenceBaselineObservations["sharpestCompletionDrop"] = null;
  for (let index = 1; index < speedSummaries.length; index += 1) {
    const previous = speedSummaries[index - 1];
    const current = speedSummaries[index];
    const completionRateDrop = previous.completePassageRate - current.completePassageRate;
    if (
      completionRateDrop > 0 &&
      (sharpestCompletionDrop === null ||
        completionRateDrop > sharpestCompletionDrop.completionRateDrop)
    ) {
      sharpestCompletionDrop = {
        fromEventRate: previous.eventRate,
        toEventRate: current.eventRate,
        completionRateDrop,
      };
    }
  }
  const combinedFailures = new Map<ListenSequenceFailureReason, number>();
  for (const summary of speedSummaries) {
    for (const [reason, count] of Object.entries(summary.failureClassifications)) {
      combinedFailures.set(
        reason as ListenSequenceFailureReason,
        (combinedFailures.get(reason as ListenSequenceFailureReason) ?? 0) + (count ?? 0),
      );
    }
  }
  const dominantFailure = [...combinedFailures.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const expectedTransitions = runs.reduce(
    (total, run) => total + Math.max(0, run.summary.expectedEventCount - 1),
    0,
  );
  return {
    renderer: { ...LISTEN_BENCHMARK_RENDERER },
    speedSummaries,
    familySpeedSummaries,
    baseline: {
      sharpestCompletionDrop,
      dominantFailure,
      nextAttackBeforeAdvanceRate: expectedTransitions === 0
        ? 0
        : runs.reduce(
            (total, run) => total + run.summary.nextAttackBeforeAdvanceCount,
            0,
          ) / expectedTransitions,
      repeatedNoteCompletionRate: familyCompletion(familySpeedSummaries, "repeated-notes"),
      changingPitchCompletionRate: familyCompletion(familySpeedSummaries, "alternating-pitches"),
      sharedChordCompletionRate: familyCompletion(familySpeedSummaries, "shared-sustain"),
      independentChordCompletionRate: familyCompletion(
        familySpeedSummaries,
        "three-note-independent",
      ),
    },
  };
}

export function compareListenSequencePolicies(
  currentRuns: readonly ListenSequenceRunResult[],
  bufferedRuns: readonly ListenSequenceRunResult[],
): ListenSequencePolicyComparison {
  const currentCorrectAdvanceCount = currentRuns.reduce(
    (total, run) => total + run.summary.correctAdvanceCount,
    0,
  );
  const bufferedCorrectAdvanceCount = bufferedRuns.reduce(
    (total, run) => total + run.summary.correctAdvanceCount,
    0,
  );
  const currentOrderedPrefixCompleted = currentRuns.reduce(
    (total, run) => total + run.summary.orderedPrefixCompleted,
    0,
  );
  const bufferedOrderedPrefixCompleted = bufferedRuns.reduce(
    (total, run) => total + run.summary.orderedPrefixCompleted,
    0,
  );
  const currentCompletePassageCount = currentRuns.filter(({ summary }) => summary.complete).length;
  const bufferedCompletePassageCount = bufferedRuns.filter(({ summary }) => summary.complete).length;
  const bufferedFalseAdvanceCount = bufferedRuns.reduce(
    (total, run) => total + run.summary.falseAdvanceCount,
    0,
  );
  const bufferedSkippedAdvanceCount = bufferedRuns.reduce(
    (total, run) => total + run.summary.skippedAdvanceCount,
    0,
  );
  const bufferedDuplicateAdvanceCount = bufferedRuns.reduce(
    (total, run) => total + run.summary.duplicateAdvanceCount,
    0,
  );
  const orderedPrefixImprovement = bufferedOrderedPrefixCompleted -
    currentOrderedPrefixCompleted;
  const completePassageImprovement = bufferedCompletePassageCount -
    currentCompletePassageCount;
  const recognitionSignature = (run: ListenSequenceRunResult) => JSON.stringify(
    run.events.map((event) => ({
      raw: event.allRequiredRawEvidencePresent,
      threshold: event.thresholdQualified,
      independent: event.independentlyMatched,
      independentAt: event.independentMatchAtMs,
      expectedPitches: event.expectedPitches,
      confidentUnexpectedPitches: event.confidentUnexpectedPitches,
      rawReasons: event.rawFailureReasons,
      independentReasons: event.independentFailureReasons,
    })),
  );
  const bufferedByRun = new Map(bufferedRuns.map((run) => [
    `${run.sequenceId}:${run.intervalMs}`,
    run,
  ]));
  const rawAndIndependentMetricsIdentical = currentRuns.length === bufferedRuns.length &&
    currentRuns.every((run) => {
      const buffered = bufferedByRun.get(`${run.sequenceId}:${run.intervalMs}`);
      return buffered !== undefined &&
        recognitionSignature(run) === recognitionSignature(buffered);
    });
  return {
    currentCorrectAdvanceCount,
    bufferedCorrectAdvanceCount,
    correctAdvanceImprovement: bufferedCorrectAdvanceCount - currentCorrectAdvanceCount,
    currentOrderedPrefixCompleted,
    bufferedOrderedPrefixCompleted,
    orderedPrefixImprovement,
    currentCompletePassageCount,
    bufferedCompletePassageCount,
    completePassageImprovement,
    bufferedFalseAdvanceCount,
    bufferedSkippedAdvanceCount,
    bufferedDuplicateAdvanceCount,
    isolatedBenchmarkUnchanged: true,
    rawAndIndependentMetricsIdentical,
    accepted: bufferedCorrectAdvanceCount > currentCorrectAdvanceCount &&
      completePassageImprovement >= 0 &&
      bufferedFalseAdvanceCount === 0 &&
      bufferedSkippedAdvanceCount === 0 &&
      bufferedDuplicateAdvanceCount === 0,
  };
}

export interface CaptureCourseClearArticulationMatrixOptions {
  session: SequenceInferenceSession;
  decoderFactory?: () => SequenceOutputDecoder;
  render?: (
    sequence: MaterializedListenSequence,
  ) => Promise<ListenBenchmarkAudioRenderResult>;
  onProgress?: (completed: number, total: number, label: string) => void;
}

/** Captures four independent PCM/model traces and replays only the current matcher policy. */
export async function captureCourseClearArticulationMatrix(
  options: CaptureCourseClearArticulationMatrixOptions,
): Promise<ListenArticulationMatrixResult> {
  const definitions = courseClearArticulationDefinitions();
  const capturedRuns: Array<{
    articulation: ListenSequenceArticulation;
    sequence: MaterializedListenSequence;
    run: ListenSequenceRunResult;
  }> = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const articulation = definition.articulation;
    if (!articulation) throw new Error(`${definition.id} has no articulation profile.`);
    const sequence = materializeListenSequence(
      definition,
      COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    );
    const rendered = await (options.render ?? renderListenSequenceAudio)(sequence);
    const trace = await captureListenSequenceTrace({
      sequenceId: definition.id,
      intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
      audio: rendered.pcm,
      relevantPitches: sequence.relevantPitches,
      session: options.session,
      decoder: options.decoderFactory?.(),
      renderer: rendered.renderer,
      audioDiagnostics: rendered.diagnostics,
    });
    capturedRuns.push({
      articulation,
      sequence,
      run: replayListenSequenceTrace(sequence, trace, "current-matcher"),
    });
    options.onProgress?.(
      index + 1,
      definitions.length,
      `${definition.label} at ${COURSE_CLEAR_ARTICULATION_INTERVAL_MS} ms`,
    );
  }
  return summarizeCourseClearArticulationMatrix(capturedRuns);
}

export async function runCourseClearArticulationMatrix(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenArticulationMatrixResult> {
  const pendingSession = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });
  let session: OnlineAmtSession | null = null;
  try {
    session = await pendingSession;
    return await captureCourseClearArticulationMatrix({ session, onProgress });
  } finally {
    if (session) await session.dispose();
    else await pendingSession.then((created) => created.dispose()).catch(() => undefined);
  }
}

export async function runBundledListenSequenceBenchmark(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenSequenceBenchmarkResult> {
  const definitions = bundledListenSequences();
  const cases = LISTEN_SEQUENCE_INTERVALS_MS.flatMap((intervalMs) => (
    definitions.map((definition) => ({ definition, intervalMs }))
  ));
  const pendingSession = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });
  let session: OnlineAmtSession | null = null;
  const runs: ListenSequenceRunResult[] = [];
  const experimentalRuns: ListenSequenceRunResult[] = [];
  try {
    session = await pendingSession;
    for (let index = 0; index < cases.length; index += 1) {
      const { definition, intervalMs } = cases[index];
      const sequence = materializeListenSequence(definition, intervalMs);
      const rendered = await renderListenSequenceAudio(sequence);
      const trace = await captureListenSequenceTrace({
        sequenceId: definition.id,
        intervalMs,
        audio: rendered.pcm,
        relevantPitches: sequence.relevantPitches,
        session,
        renderer: rendered.renderer,
        audioDiagnostics: rendered.diagnostics,
      });
      runs.push(replayListenSequenceTrace(sequence, trace, "current-matcher"));
      experimentalRuns.push(replayListenSequenceTrace(sequence, trace, "next-onset-buffer"));
      onProgress(index + 1, cases.length, `${definition.label} at ${intervalMs} ms`);
    }
    const summary = summarizeListenSequenceBenchmark(runs);
    const experimentalSummary = summarizeListenSequenceBenchmark(experimentalRuns);
    return {
      policy: "current-matcher",
      runs,
      ...summary,
      experimental: {
        policy: "next-onset-buffer",
        bufferMs: LISTEN_SEQUENCE_ONSET_BUFFER_MS,
        renderer: { ...LISTEN_BENCHMARK_RENDERER },
        runs: experimentalRuns,
        speedSummaries: experimentalSummary.speedSummaries,
        familySpeedSummaries: experimentalSummary.familySpeedSummaries,
        comparison: compareListenSequencePolicies(runs, experimentalRuns),
      },
    };
  } finally {
    if (session) await session.dispose();
    else await pendingSession.then((created) => created.dispose()).catch(() => undefined);
  }
}
