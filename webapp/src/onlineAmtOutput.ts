import type {
  RecognizedNoteEvent,
  RecognizedNoteState,
  RecognizedOnset,
  RecognizedPitchEvidence,
} from "./noteRecognizer";
import type { ChordMatcherOptions } from "./chordMatcher";

const STATE_COUNT = 5;
const FIRST_PIANO_MIDI = 21;
const STATE_NAMES = [
  "off",
  "offset",
  "sustain",
  "onset",
  "reOnset",
] as const;
const ACTIVE_STATES = new Set([2, 3, 4]);
const ATTACK_STATES = new Set([3, 4]);

/**
 * Benchmark-only score-rise retrigger detector controls. Production callers do
 * not pass these options, so the detector remains disabled by default.
 */
export interface OnlineAmtRetriggerOptions {
  enabled: boolean;
  peakThreshold: number;
  riseThreshold: number;
  rearmThreshold: number;
  lookbackFrames: number;
  refractoryFrames: number;
}

export const disabledOnlineAmtRetriggerOptions: Readonly<OnlineAmtRetriggerOptions> =
  Object.freeze({
    enabled: false,
    peakThreshold: 1,
    riseThreshold: 1,
    rearmThreshold: 0,
    lookbackFrames: 1,
    refractoryFrames: 1,
  });

interface PitchRetriggerState {
  recentAttackProbabilities: number[];
  armed: boolean;
  lastAttackFrame: number | null;
  hasNaturalAttack: boolean;
  previousActive: boolean;
}

export interface DecodedOnlineAmtOutput {
  onsets: RecognizedOnset[];
  recognizedActivePitches: RecognizedPitchEvidence[];
  targetPitchEvidence: RecognizedPitchEvidence[];
  noteStates: RecognizedNoteState[];
  noteEvents: RecognizedNoteEvent[];
}

/**
 * Preliminary digital-fixture profile. These cutoffs preserve very strong true
 * model onsets while rejecting the lower-confidence octave/subharmonic states
 * that the original hard argmax treats as equally certain.
 */
export const onlineAmtChordMatcherOptions: Partial<ChordMatcherOptions> = {
  onsetThreshold: 0.6,
  targetNoteThreshold: 0.5,
  activeTargetThreshold: 0.35,
  noteThreshold: 0.97,
  settleMs: 32,
  refractoryMode: "noteEvents",
};

function normalizedGroupScore(
  scores: Float32Array,
  offset: number,
  states: readonly number[],
): number {
  let total = 0;
  let selected = 0;
  for (let state = 0; state < STATE_COUNT; state += 1) {
    const score = Math.max(0, scores[offset + state] ?? 0);
    total += score;
    if (states.includes(state)) selected += score;
  }
  return total > 0 ? selected / total : 0;
}

/** Normalized onset + reOnset score used by the experimental detector. */
export function onlineAmtAttackProbability(
  scores: Float32Array,
  pitchIndex: number,
): number {
  return normalizedGroupScore(scores, pitchIndex * STATE_COUNT, [3, 4]);
}

/** Normalized sustain + onset + reOnset score used by decoded note evidence. */
export function onlineAmtActiveProbability(
  scores: Float32Array,
  pitchIndex: number,
): number {
  return normalizedGroupScore(scores, pitchIndex * STATE_COUNT, [2, 3, 4]);
}

function normalizedState(state: number | undefined): number {
  return state !== undefined &&
      Number.isInteger(state) &&
      state >= 0 &&
      state < STATE_COUNT
    ? state
    : 0;
}

function transitionEvent(
  previousState: number,
  state: number,
): RecognizedNoteEvent["type"] | null {
  const previousActive = ACTIVE_STATES.has(previousState);
  const active = ACTIVE_STATES.has(state);
  if (previousActive && !active) return "offset";
  // A re-onset is a new physical attack even when it immediately follows the
  // initial onset state. Only identical consecutive attack states are tails of
  // the same decoder event.
  if (state === 4 && previousState !== 4) return "reOnset";
  if (state === 3 && !ATTACK_STATES.has(previousState)) return "onset";
  return null;
}

/**
 * Preserves the original decoder's weighted argmax while exposing how strongly
 * the five states support an onset or an active pitch. ExactChordMatcher can
 * therefore apply different confidence requirements to score targets and
 * unexpected extra notes.
 */
export function decodeOnlineAmtOutput(
  scores: Float32Array,
  states: Uint8Array,
  signalActive: boolean,
  capturedAtMs: number,
  targetPitches: readonly number[] = [],
  previousStates: Uint8Array = new Uint8Array(states.length),
): DecodedOnlineAmtOutput {
  const onsets: RecognizedOnset[] = [];
  const recognizedActivePitches: RecognizedPitchEvidence[] = [];
  const targetPitchEvidence: RecognizedPitchEvidence[] = [];
  const noteStates: RecognizedNoteState[] = [];
  const noteEvents: RecognizedNoteEvent[] = [];
  const targets = new Set(targetPitches);
  for (let pitch = 0; pitch < states.length; pitch += 1) {
    const state = signalActive ? normalizedState(states[pitch]) : 0;
    const previousState = normalizedState(previousStates[pitch]);
    const offset = pitch * STATE_COUNT;
    const midi = pitch + FIRST_PIANO_MIDI;
    const activeConfidence = signalActive
      ? normalizedGroupScore(scores, offset, [2, 3, 4])
      : 0;
    const stateConfidence = signalActive
      ? normalizedGroupScore(scores, offset, [state])
      : 0;
    noteStates.push({
      midi,
      state: STATE_NAMES[state],
      confidence: stateConfidence,
    });
    if (signalActive && ATTACK_STATES.has(state)) {
      onsets.push({
        midi,
        confidence: normalizedGroupScore(scores, offset, [3, 4]),
        noteConfidence: activeConfidence,
        onsetTimeMs: capturedAtMs,
      });
    }
    if (signalActive && ACTIVE_STATES.has(state)) {
      recognizedActivePitches.push({ midi, confidence: activeConfidence });
    }
    if (signalActive && targets.has(midi)) {
      targetPitchEvidence.push({ midi, confidence: activeConfidence });
    }
    const type = transitionEvent(previousState, state);
    if (type !== null) {
      noteEvents.push({
        midi,
        type,
        confidence: type === "offset"
          ? stateConfidence
          : normalizedGroupScore(scores, offset, [state]),
        eventTimeMs: capturedAtMs,
      });
    }
  }
  return {
    onsets,
    recognizedActivePitches,
    targetPitchEvidence,
    noteStates,
    noteEvents,
  };
}

/** Shared benchmark-only state machine used by live decoding and trace replay. */
export class OnlineAmtScoreRiseRetriggerDetector {
  private frameIndex = 0;
  private retriggerStates: Array<PitchRetriggerState | undefined> = [];
  readonly options: OnlineAmtRetriggerOptions;

  constructor(options: Partial<OnlineAmtRetriggerOptions> = {}) {
    this.options = { ...disabledOnlineAmtRetriggerOptions, ...options };
    if (this.options.enabled) {
      const thresholds = [
        this.options.peakThreshold,
        this.options.riseThreshold,
        this.options.rearmThreshold,
      ];
      if (thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error("Online AMT retrigger probability thresholds must be between 0 and 1.");
      }
      if (!Number.isInteger(this.options.lookbackFrames) || this.options.lookbackFrames <= 0) {
        throw new Error("Online AMT retrigger lookbackFrames must be a positive integer.");
      }
      if (!Number.isInteger(this.options.refractoryFrames) ||
          this.options.refractoryFrames <= 0) {
        throw new Error("Online AMT retrigger refractoryFrames must be a positive integer.");
      }
    }
    this.reset(88);
  }

  reset(pitchCount = 88): void {
    this.frameIndex = 0;
    this.retriggerStates = new Array(pitchCount);
  }

  apply(
    output: DecodedOnlineAmtOutput,
    scores: Float32Array,
    states: Uint8Array,
    signalActive: boolean,
    capturedAtMs: number,
  ): void {
    if (!this.options.enabled) return;
    if (!signalActive) {
      this.reset(states.length);
      return;
    }
    if (this.retriggerStates.length !== states.length) this.reset(states.length);
    const naturalAttacks = new Set(output.noteEvents
      .filter(({ type }) => type === "onset" || type === "reOnset")
      .map(({ midi }) => midi - FIRST_PIANO_MIDI));
    let emitted = false;
    for (let pitch = 0; pitch < states.length; pitch += 1) {
      const state = normalizedState(states[pitch]);
      if (!ACTIVE_STATES.has(state)) {
        this.retriggerStates[pitch] = undefined;
        continue;
      }
      const history = this.retriggerStates[pitch] ?? {
        recentAttackProbabilities: [],
        armed: true,
        lastAttackFrame: null,
        hasNaturalAttack: false,
        previousActive: false,
      };
      this.retriggerStates[pitch] = history;
      const attackProbability = onlineAmtAttackProbability(scores, pitch);
      const activeProbability = onlineAmtActiveProbability(scores, pitch);
      const recentMinimum = history.recentAttackProbabilities.length === 0
        ? attackProbability
        : Math.min(...history.recentAttackProbabilities);
      if (naturalAttacks.has(pitch)) {
        history.hasNaturalAttack = true;
        history.armed = false;
        history.lastAttackFrame = this.frameIndex;
      } else {
        if (attackProbability <= this.options.rearmThreshold) history.armed = true;
        const refractoryExpired = history.lastAttackFrame === null ||
          this.frameIndex - history.lastAttackFrame >= this.options.refractoryFrames;
        if (
          state === 2 &&
          history.previousActive &&
          history.hasNaturalAttack &&
          history.armed &&
          attackProbability >= this.options.peakThreshold &&
          attackProbability - recentMinimum >= this.options.riseThreshold &&
          refractoryExpired
        ) {
          const midi = pitch + FIRST_PIANO_MIDI;
          output.onsets.push({
            midi,
            confidence: attackProbability,
            noteConfidence: activeProbability,
            onsetTimeMs: capturedAtMs,
          });
          output.noteEvents.push({
            midi,
            type: "reOnset",
            confidence: attackProbability,
            eventTimeMs: capturedAtMs,
          });
          history.armed = false;
          history.lastAttackFrame = this.frameIndex;
          emitted = true;
        }
      }
      history.recentAttackProbabilities.push(attackProbability);
      if (history.recentAttackProbabilities.length > this.options.lookbackFrames) {
        history.recentAttackProbabilities.shift();
      }
      history.previousActive = true;
    }
    if (emitted) {
      output.onsets.sort((left, right) => left.midi - right.midi);
      output.noteEvents.sort((left, right) => left.midi - right.midi);
    }
    this.frameIndex += 1;
  }
}

/**
 * Tracks decoded model states across streaming frames so transition events are
 * emitted exactly once. Reset this alongside the ONNX recurrent state.
 */
export class OnlineAmtOutputDecoder {
  private previousStates = new Uint8Array(88);
  private readonly retriggerDetector: OnlineAmtScoreRiseRetriggerDetector | null;

  constructor(options: Partial<OnlineAmtRetriggerOptions> = {}) {
    const normalized = { ...disabledOnlineAmtRetriggerOptions, ...options };
    this.retriggerDetector = normalized.enabled
      ? new OnlineAmtScoreRiseRetriggerDetector(normalized)
      : null;
  }

  reset(): void {
    this.previousStates = new Uint8Array(88);
    this.retriggerDetector?.reset(88);
  }

  decode(
    scores: Float32Array,
    states: Uint8Array,
    signalActive: boolean,
    capturedAtMs: number,
    targetPitches: readonly number[] = [],
  ): DecodedOnlineAmtOutput {
    const output = decodeOnlineAmtOutput(
      scores,
      states,
      signalActive,
      capturedAtMs,
      targetPitches,
      this.previousStates,
    );
    this.retriggerDetector?.apply(output, scores, states, signalActive, capturedAtMs);
    this.previousStates = signalActive
      ? new Uint8Array(states)
      : new Uint8Array(states.length);
    return output;
  }
}
