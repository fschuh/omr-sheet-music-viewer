import type { RecognizedOnset } from "./noteRecognizer";
import type { ChordMatcherOptions } from "./chordMatcher";

const STATE_COUNT = 5;

export interface DecodedOnlineAmtOutput {
  onsets: RecognizedOnset[];
  activePitches: Array<{ midi: number; confidence: number }>;
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
): DecodedOnlineAmtOutput {
  const onsets: RecognizedOnset[] = [];
  const activePitches: Array<{ midi: number; confidence: number }> = [];
  if (!signalActive) return { onsets, activePitches };
  const targets = new Set(targetPitches);
  for (let pitch = 0; pitch < states.length; pitch += 1) {
    const state = states[pitch];
    const offset = pitch * STATE_COUNT;
    const midi = pitch + 21;
    const activeConfidence = normalizedGroupScore(scores, offset, [2, 3, 4]);
    if (state === 3 || state === 4) {
      onsets.push({
        midi,
        confidence: normalizedGroupScore(scores, offset, [3, 4]),
        noteConfidence: activeConfidence,
        onsetTimeMs: capturedAtMs,
      });
    }
    if (
      state === 2 ||
      state === 3 ||
      state === 4 ||
      targets.has(midi)
    ) {
      activePitches.push({ midi, confidence: activeConfidence });
    }
  }
  return { onsets, activePitches };
}
