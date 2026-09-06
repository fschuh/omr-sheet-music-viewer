import type {
  RecognizedPitchEvidence,
  RecognizerLifecycle,
} from "@fschuh/piano-transcription-engine";

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
