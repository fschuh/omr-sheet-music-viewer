import type { DecodedOnlineAmtOutput } from "./onlineAmtOutput";

const STATE_COUNT = 5;
const FIRST_PIANO_MIDI = 21;
const ACTIVE_STATES = new Set([2, 3, 4]);

/** Benchmark-only online-AMT score-rise retrigger detector controls. */
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

export function onlineAmtAttackProbability(
  scores: Float32Array,
  pitchIndex: number,
): number {
  return normalizedGroupScore(scores, pitchIndex * STATE_COUNT, [3, 4]);
}

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

/** Experimental state machine used only by retained-trace benchmark replay. */
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
