import type {
  RecognizedPitchEvidence,
  RecognizerLifecycle,
  RecognizerResult,
} from "@fschuh/piano-transcription-engine";

/**
 * `result` as if `ignored` had not been played: what the matcher sees when notes the
 * score leaves optional, such as grace notes, must not count as wrong notes.
 */
export function withoutPitches(
  result: RecognizerResult,
  ignored: ReadonlySet<number>,
): RecognizerResult {
  if (ignored.size === 0) return result;
  const kept = <T extends { midi: number }>(items: T[]) => items.filter((item) => !ignored.has(item.midi));
  return {
    ...result,
    onsets: kept(result.onsets),
    recognizedActivePitches: kept(result.recognizedActivePitches),
    targetPitchEvidence: kept(result.targetPitchEvidence),
    ...(result.noteStates ? { noteStates: kept(result.noteStates) } : {}),
    ...(result.noteEvents ? { noteEvents: kept(result.noteEvents) } : {}),
  };
}

/**
 * Viewer presentation model for listen mode. The engine reports recognition
 * results; this is what the score, keyboard, and debug panel render.
 */
export interface ListenModeFeedback {
  lifecycle: RecognizerLifecycle;
  targetPitches: number[];
  detectedTargetPitches: number[];
  extraPitches: number[];
  targetPitchConfidences: Array<{ midi: number; confidence: number }>;
  recognizedActivePitches: RecognizedPitchEvidence[];
  attackPitches: Array<{ midi: number; attackTimeMs: number }>;
  successPitches: Array<{ midi: number; successTimeMs: number }>;
  processingTimeMs: number | null;
}

export const stoppedRecognizerLifecycle: RecognizerLifecycle = {
  state: "stopped",
  inputSource: "microphone",
  input: "idle",
  analysis: "idle",
};
