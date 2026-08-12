import {
  ExactChordMatcher,
  defaultChordMatcherOptions,
} from "./chordMatcher";
import { COURSE_CLEAR_BENCHMARK_MOMENTS } from "./listenBenchmark";
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
import { pianoSampleUrls } from "./piano";
import type {
  RecognizedNoteEvent,
  RecognizedOnset,
  RecognizedPitchEvidence,
  RecognizerResult,
} from "./noteRecognizer";

export const LISTEN_SEQUENCE_INTERVALS_MS = [500, 250, 167, 125] as const;
export const LISTEN_SEQUENCE_PRE_ROLL_MS = 220;
export const LISTEN_SEQUENCE_TAIL_MS = 900;
export const LISTEN_SEQUENCE_ONSET_BUFFER_MS = 192;
const NOTE_RELEASE_MS = 350;
const DEFAULT_NOTE_LENGTH_RATIO = 0.72;
const RECOGNITION_ASSIGNMENT_MS = 450;
const FRAME_MS = ONLINE_AMT_CHUNK_SIZE * 1_000 / ONLINE_AMT_SAMPLE_RATE;

const matcherOptions = {
  ...defaultChordMatcherOptions,
  ...onlineAmtChordMatcherOptions,
};

export interface ListenSequenceNote {
  midi: number;
  offsetMs?: number;
  durationIntervals?: number;
}

export interface ListenSequenceAttackDefinition {
  /** Attack time in multiples of the selected interval. */
  at: number;
  /** Score target expected to be active for this physical attack. */
  targetIndex: number;
  notes: readonly (number | ListenSequenceNote)[];
  /** False for a deliberate wrong/extra-note safety attack. */
  expectedAdvance: boolean;
}

export interface ListenSequenceDefinition {
  id: string;
  family: string;
  label: string;
  targets: readonly (readonly number[])[];
  attacks: readonly ListenSequenceAttackDefinition[];
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

export interface SequencePianoSample {
  sourceMidi: number;
  sampleRate: number;
  samples: Float32Array;
}

export interface ListenRecognitionFrame {
  capturedAtMs: number;
  onsets: RecognizedOnset[];
  noteEvents: RecognizedNoteEvent[];
  activePitches: RecognizedPitchEvidence[];
  confidenceEvidence: RecognizedPitchEvidence[];
  modelStates: number[];
  signalActive: boolean;
  inferenceDurationMs: number;
}

export interface ListenRecognitionTrace {
  sequenceId: string;
  intervalMs: number;
  sampleRate: number;
  chunkSize: number;
  relevantPitches: number[];
  frames: ListenRecognitionFrame[];
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
}

export type ListenSequenceFailureReason =
  | "model-no-evidence"
  | "onset-below-threshold"
  | "missing-required-bass-onset"
  | "next-attack-before-advance"
  | "rejected-extra-pitch"
  | "retrigger-not-detected"
  | "matcher-timeout"
  | "duplicate-or-held-attack";

export interface ExpectedPitchDiagnostic {
  midi: number;
  rawOnsetProduced: boolean;
  rawOnsetTimeMs: number | null;
  onsetConfidence: number;
  noteConfidence: number;
  qualifyingOnset: boolean;
  maximumActiveConfidence: number;
}

export interface ListenSequenceEventDiagnostic {
  index: number;
  scheduledAttackTimeMs: number;
  targetPitches: number[];
  playedPitches: number[];
  expectedPitches: ExpectedPitchDiagnostic[];
  firstQualifyingPitchEvidenceTimeMs: number | null;
  advanced: boolean;
  advancedAtMs: number | null;
  onsetToAdvanceMs: number | null;
  activeTargetIndexAtAttack: number | null;
  unexpectedPitches: number[];
  nextAttackBeforeAdvance: boolean;
  missed: boolean;
  duplicate: boolean;
  skipped: boolean;
  falseAdvance: boolean;
  timedOut: boolean;
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
  accepted: boolean;
}

export interface ExperimentalListenSequenceResult {
  policy: "next-onset-buffer";
  bufferMs: number;
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
  runs: ListenSequenceRunResult[];
  speedSummaries: ListenSequenceAggregateSummary[];
  familySpeedSummaries: ListenSequenceAggregateSummary[];
  baseline: ListenSequenceBaselineObservations;
  experimental: ExperimentalListenSequenceResult;
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
    const lengthMs = Math.max(90, intervalMs * DEFAULT_NOTE_LENGTH_RATIO);
    const normalized = attack.notes.map(normalizedNote);
    const notes = normalized.map((playedNote, noteIndex): ScheduledSequenceNote => {
      const attackTimeMs = scheduledAtMs + (playedNote.offsetMs ?? 0);
      return {
        id: `${attackIndex}:${noteIndex}`,
        midi: playedNote.midi,
        attackIndex,
        attackTimeMs,
        releaseTimeMs: attackTimeMs + (playedNote.durationIntervals === undefined
          ? lengthMs
          : playedNote.durationIntervals * intervalMs),
      };
    });
    return {
      index: attackIndex,
      targetIndex: attack.targetIndex,
      scheduledAtMs,
      expectedAdvance: attack.expectedAdvance,
      playedPitches: sortedUnique(normalized.map(({ midi }) => midi)),
      notes,
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
  const durationMs = latestAttack + LISTEN_SEQUENCE_TAIL_MS;
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

/** Mixes all scheduled attacks into one continuous 16 kHz PCM buffer. */
export function renderScheduledSequenceAudio(
  sequence: MaterializedListenSequence,
  samplesByPitch: ReadonlyMap<number, SequencePianoSample>,
): Float32Array {
  const rendered = new Float32Array(sequence.frameCount);
  for (const attack of sequence.attacks) {
    const gain = Math.min(0.8, 0.9 / Math.sqrt(Math.max(1, attack.notes.length)));
    for (const playedNote of attack.notes) {
      const sample = samplesByPitch.get(playedNote.midi);
      if (!sample) throw new Error(`No piano sample was prepared for MIDI ${playedNote.midi}.`);
      const playbackRate = 2 ** ((playedNote.midi - sample.sourceMidi) / 12);
      const startFrame = Math.round(
        playedNote.attackTimeMs * ONLINE_AMT_SAMPLE_RATE / 1_000,
      );
      const releaseFrame = Math.round(
        playedNote.releaseTimeMs * ONLINE_AMT_SAMPLE_RATE / 1_000,
      );
      const releaseEndFrame = releaseFrame + Math.round(
        NOTE_RELEASE_MS * ONLINE_AMT_SAMPLE_RATE / 1_000,
      );
      const finalFrame = Math.min(rendered.length, releaseEndFrame);
      for (let outputFrame = startFrame; outputFrame < finalFrame; outputFrame += 1) {
        const elapsedFrames = outputFrame - startFrame;
        const sourcePosition = elapsedFrames * sample.sampleRate * playbackRate /
          ONLINE_AMT_SAMPLE_RATE;
        const sourceIndex = Math.floor(sourcePosition);
        if (sourceIndex >= sample.samples.length) break;
        const fraction = sourcePosition - sourceIndex;
        const sampleValue = sample.samples[sourceIndex] * (1 - fraction) +
          (sample.samples[sourceIndex + 1] ?? sample.samples[sourceIndex]) * fraction;
        const releaseGain = outputFrame < releaseFrame
          ? 1
          : Math.max(0, 1 - (outputFrame - releaseFrame) /
            Math.max(1, releaseEndFrame - releaseFrame));
        rendered[outputFrame] += sampleValue * gain * releaseGain;
      }
    }
  }
  let peak = 0;
  for (const value of rendered) peak = Math.max(peak, Math.abs(value));
  if (peak > 0.98) {
    const scale = 0.98 / peak;
    for (let index = 0; index < rendered.length; index += 1) rendered[index] *= scale;
  }
  return rendered;
}

function nearestSample(midi: number): [number, string] {
  const samples = Object.entries(pianoSampleUrls()).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => (
    Math.abs(candidate[0] - midi) < Math.abs(nearest[0] - midi) ? candidate : nearest
  ));
}

class BundledSequenceAudioRenderer {
  private readonly audioContext = new AudioContext({ sampleRate: ONLINE_AMT_SAMPLE_RATE });
  private readonly decoded = new Map<string, Promise<SequencePianoSample>>();

  private sample(midi: number): Promise<SequencePianoSample> {
    const [sourceMidi, url] = nearestSample(midi);
    let pending = this.decoded.get(url);
    if (!pending) {
      pending = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`Could not load benchmark sample ${url}.`);
        const decoded = await this.audioContext.decodeAudioData(await response.arrayBuffer());
        return {
          sourceMidi,
          sampleRate: decoded.sampleRate,
          samples: new Float32Array(decoded.getChannelData(0)),
        };
      });
      this.decoded.set(url, pending);
    }
    return pending;
  }

  async render(sequence: MaterializedListenSequence): Promise<Float32Array> {
    const samples = new Map<number, SequencePianoSample>();
    await Promise.all(sequence.relevantPitches.map(async (midi) => {
      samples.set(midi, await this.sample(midi));
    }));
    return renderScheduledSequenceAudio(sequence, samples);
  }

  async dispose(): Promise<void> {
    await this.audioContext.close();
  }
}

export async function captureListenSequenceTrace(options: {
  sequenceId: string;
  intervalMs: number;
  audio: Float32Array;
  relevantPitches: readonly number[];
  session: SequenceInferenceSession;
  decoder?: SequenceOutputDecoder;
}): Promise<ListenRecognitionTrace> {
  if (options.audio.length % ONLINE_AMT_CHUNK_SIZE !== 0) {
    throw new Error("Continuous sequence audio must contain complete 512-sample chunks.");
  }
  const decoder = options.decoder ?? new OnlineAmtOutputDecoder();
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
      modelStates: Array.from(output.states),
      signalActive: output.signalActive,
      inferenceDurationMs: output.inferenceTimeMs,
    });
  }
  return {
    sequenceId: options.sequenceId,
    intervalMs: options.intervalMs,
    sampleRate: ONLINE_AMT_SAMPLE_RATE,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
    relevantPitches: [...options.relevantPitches],
    frames,
    maximumInferenceMs,
    maximumProcessingBacklogMs,
  };
}

interface RecognizedAttackObservation {
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

/** Assigns each decoded attack to at most one physical scheduled attack. */
export function assignRecognitionEventsToAttacks(
  scheduledNotes: readonly ScheduledSequenceNote[],
  observations: readonly RecognizedAttackObservation[],
): Map<string, RecognizedAttackObservation> {
  const assignments = new Map<string, RecognizedAttackObservation>();
  for (const observation of observations) {
    const candidates = scheduledNotes
      .filter((scheduled) => (
        scheduled.midi === observation.midi &&
        !assignments.has(scheduled.id) &&
        scheduled.attackTimeMs <= observation.timeMs + FRAME_MS &&
        observation.timeMs - scheduled.attackTimeMs <= RECOGNITION_ASSIGNMENT_MS
      ))
      .sort((left, right) => right.attackTimeMs - left.attackTimeMs);
    if (candidates[0]) assignments.set(candidates[0].id, observation);
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
): { maximum: number; firstQualifyingAtMs: number | null } {
  let maximum = 0;
  let firstQualifyingAtMs: number | null = null;
  for (const frame of trace.frames) {
    if (frame.capturedAtMs < startMs || frame.capturedAtMs > endMs) continue;
    const confidence = frame.confidenceEvidence.find((pitch) => pitch.midi === midi)?.confidence ?? 0;
    maximum = Math.max(maximum, confidence);
    if (confidence >= matcherOptions.activeTargetThreshold && firstQualifyingAtMs === null) {
      firstQualifyingAtMs = frame.capturedAtMs;
    }
  }
  return { maximum, firstQualifyingAtMs };
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
}

export function classifyListenSequenceFailure(
  input: SequenceFailureInput,
): { reasons: ListenSequenceFailureReason[]; primary: ListenSequenceFailureReason | null } {
  const reasons: ListenSequenceFailureReason[] = [];
  if (input.duplicate || input.skipped || input.falseAdvance) {
    reasons.push("duplicate-or-held-attack");
  }
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
    "duplicate-or-held-attack",
    "rejected-extra-pitch",
    "retrigger-not-detected",
    "missing-required-bass-onset",
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

  const scheduledNotes = sequence.attacks.flatMap(({ notes }) => notes);
  const recognitionAssignments = assignRecognitionEventsToAttacks(
    scheduledNotes,
    recognizedAttacks(trace),
  );
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
  const events = sequence.targets.map((target, index): ListenSequenceEventDiagnostic => {
    const expectedAttack = sequence.attacks[target.attackIndex];
    const nextTarget = sequence.targets[index + 1];
    const evidenceEndMs = nextTarget
      ? Math.max(target.scheduledAttackTimeMs + FRAME_MS, nextTarget.scheduledAttackTimeMs - 0.001)
      : trace.frames.at(-1)?.capturedAtMs ?? sequence.durationMs;
    const expectedPitches = target.pitches.map((midi): ExpectedPitchDiagnostic => {
      const scheduledNote = expectedAttack.notes.find((candidate) => candidate.midi === midi);
      const assignment = scheduledNote
        ? recognitionAssignments.get(scheduledNote.id)
        : undefined;
      const evidence = evidenceInWindow(
        trace,
        midi,
        target.scheduledAttackTimeMs - FRAME_MS,
        evidenceEndMs,
      );
      return {
        midi,
        rawOnsetProduced: assignment !== undefined,
        rawOnsetTimeMs: assignment?.timeMs ?? null,
        onsetConfidence: assignment?.confidence ?? 0,
        noteConfidence: assignment?.noteConfidence ?? 0,
        qualifyingOnset: assignment !== undefined &&
          assignment.confidence >= matcherOptions.onsetThreshold &&
          assignment.noteConfidence >= matcherOptions.targetNoteThreshold,
        maximumActiveConfidence: evidence.maximum,
      };
    });
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
    const firstQualifyingPitchEvidenceTimeMs = target.pitches
      .map((midi) => evidenceInWindow(
        trace,
        midi,
        target.scheduledAttackTimeMs - FRAME_MS,
        evidenceEndMs,
      ).firstQualifyingAtMs)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;
    const unexpectedPitches = sortedUnique(extraPitchesByTarget.get(index) ?? []);
    const failure = classifyListenSequenceFailure({
      advanced: advancement !== undefined,
      duplicate,
      skipped,
      falseAdvance,
      nextAttackBeforeAdvance,
      unexpectedPitches,
      targetPitches: target.pitches,
      previousTargetPitches: sequence.targets[index - 1]?.pitches ?? [],
      expectedPitches,
    });
    return {
      index,
      scheduledAttackTimeMs: target.scheduledAttackTimeMs,
      targetPitches: target.pitches,
      playedPitches: target.playedPitches,
      expectedPitches,
      firstQualifyingPitchEvidenceTimeMs,
      advanced: advancement !== undefined,
      advancedAtMs: advancement?.atMs ?? null,
      onsetToAdvanceMs: advancement === undefined
        ? null
        : advancement.atMs - target.scheduledAttackTimeMs,
      activeTargetIndexAtAttack: attackTargetAtTime.get(target.attackIndex) ?? null,
      unexpectedPitches,
      nextAttackBeforeAdvance,
      missed: advancement === undefined,
      duplicate,
      skipped,
      falseAdvance,
      timedOut: advancement === undefined,
      failureReasons: failure.reasons,
      primaryFailure: failure.primary,
    };
  });
  const correctEvents = events.filter((event) => (
    event.advanced && !event.falseAdvance && !event.duplicate && !event.skipped
  ));
  const firstStallIndex = events.findIndex((event) => (
    !correctEvents.includes(event) ||
    event.activeTargetIndexAtAttack !== event.index ||
    event.nextAttackBeforeAdvance
  ));
  const latencies = correctEvents.flatMap((event) => (
    event.onsetToAdvanceMs === null ? [] : [event.onsetToAdvanceMs]
  ));
  const summary: ListenSequenceRunSummary = {
    complete: correctEvents.length === events.length &&
      advancements.length === events.length,
    correctAdvanceCount: correctEvents.length,
    expectedEventCount: events.length,
    correctAdvanceRate: events.length === 0 ? 0 : correctEvents.length / events.length,
    orderedPrefixCompleted: firstStallIndex < 0 ? events.length : firstStallIndex,
    firstStallIndex: firstStallIndex < 0 ? null : firstStallIndex,
    missedCount: events.filter(({ missed }) => missed).length,
    duplicateAdvanceCount: events.filter(({ duplicate }) => duplicate).length,
    skippedAdvanceCount: events.filter(({ skipped }) => skipped).length,
    falseAdvanceCount: events.filter(({ falseAdvance }) => falseAdvance).length,
    p50OnsetToAdvanceMs: percentile(latencies, 0.5),
    p95OnsetToAdvanceMs: percentile(latencies, 0.95),
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
  const failureClassifications: Partial<Record<ListenSequenceFailureReason, number>> = {};
  for (const run of runs) {
    for (const event of run.events) {
      for (const reason of event.failureReasons) {
        failureClassifications[reason] = (failureClassifications[reason] ?? 0) + 1;
      }
    }
  }
  const latencies = runs.flatMap((run) => run.events.flatMap((event) => (
    event.advanced && !event.falseAdvance && event.onsetToAdvanceMs !== null
      ? [event.onsetToAdvanceMs]
      : []
  )));
  return {
    intervalMs,
    eventRate: 1_000 / intervalMs,
    family,
    sequenceCount: runs.length,
    completePassageRate: runs.length === 0
      ? 0
      : runs.filter(({ summary }) => summary.complete).length / runs.length,
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
    p50OnsetToAdvanceMs: percentile(latencies, 0.5),
    p95OnsetToAdvanceMs: percentile(latencies, 0.95),
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
    accepted: bufferedCorrectAdvanceCount > currentCorrectAdvanceCount &&
      completePassageImprovement >= 0 &&
      bufferedFalseAdvanceCount === 0 &&
      bufferedSkippedAdvanceCount === 0 &&
      bufferedDuplicateAdvanceCount === 0,
  };
}

export async function runBundledListenSequenceBenchmark(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenSequenceBenchmarkResult> {
  const definitions = bundledListenSequences();
  const cases = LISTEN_SEQUENCE_INTERVALS_MS.flatMap((intervalMs) => (
    definitions.map((definition) => ({ definition, intervalMs }))
  ));
  const renderer = new BundledSequenceAudioRenderer();
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
      const audio = await renderer.render(sequence);
      const trace = await captureListenSequenceTrace({
        sequenceId: definition.id,
        intervalMs,
        audio,
        relevantPitches: sequence.relevantPitches,
        session,
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
        runs: experimentalRuns,
        speedSummaries: experimentalSummary.speedSummaries,
        familySpeedSummaries: experimentalSummary.familySpeedSummaries,
        comparison: compareListenSequencePolicies(runs, experimentalRuns),
      },
    };
  } finally {
    await renderer.dispose();
    if (session) await session.dispose();
    else await pendingSession.then((created) => created.dispose()).catch(() => undefined);
  }
}
