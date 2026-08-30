import type {
  RecognizedNoteEvent,
  RecognizedNoteState,
  RecognizedOnset,
  RecognizedPitchEvidence,
} from "./noteRecognizer";
import type { ChordMatcherOptions } from "./chordMatcher";
import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  matcherOptionsForListenMatcherProfile,
} from "./listen/listenMatcherProfiles";

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

export interface DecodedOnlineAmtOutput {
  onsets: RecognizedOnset[];
  recognizedActivePitches: RecognizedPitchEvidence[];
  targetPitchEvidence: RecognizedPitchEvidence[];
  noteStates: RecognizedNoteState[];
  noteEvents: RecognizedNoteEvent[];
}

/**
 * Compatibility export for callers that still expect one online-AMT matcher
 * option object. The values come from the production-default registry profile,
 * so `listenMatcherProfiles.ts` remains the only place thresholds are defined.
 */
export const onlineAmtChordMatcherOptions: ChordMatcherOptions =
  matcherOptionsForListenMatcherProfile(DEFAULT_LISTEN_MATCHER_PROFILE_ID);

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

/**
 * Tracks decoded model states across streaming frames so transition events are
 * emitted exactly once. Reset this alongside the ONNX recurrent state.
 */
export class OnlineAmtOutputDecoder {
  private previousStates = new Uint8Array(88);

  reset(): void {
    this.previousStates = new Uint8Array(88);
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
    this.previousStates = signalActive
      ? new Uint8Array(states)
      : new Uint8Array(states.length);
    return output;
  }
}
