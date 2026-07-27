export type RecognizerRunState =
  | "stopped"
  | "initializing"
  | "listening"
  | "paused"
  | "error";

export type RecognizerResourceState = "idle" | "loading" | "ready" | "error";

export interface RecognizerLifecycle {
  state: RecognizerRunState;
  microphone: RecognizerResourceState;
  analysis: RecognizerResourceState;
  error?: string;
}

export interface RecognizedOnset {
  midi: number;
  /** Recognizer-specific onset confidence normalized to the range 0–1. */
  confidence: number;
  /** Recognizer-specific confidence that the pitch itself is present. */
  noteConfidence: number;
  /** Monotonic capture-clock time, not wall-clock time. */
  onsetTimeMs: number;
}

export interface RecognizerResult {
  generation: number;
  onsets: RecognizedOnset[];
  activePitches: Array<{ midi: number; confidence: number }>;
  processingTimeMs: number;
  capturedAtMs: number;
}

export interface NoteRecognizerCallbacks {
  onLifecycle: (lifecycle: RecognizerLifecycle) => void;
  onResult: (result: RecognizerResult) => void;
}

/**
 * Replaceable boundary between microphone analysis and score matching.
 * Implementations must never persist or transmit captured audio.
 */
export interface NoteRecognizer {
  start(generation: number, callbacks: NoteRecognizerCallbacks): Promise<void>;
  /** Supplies the score pitches so implementations can evaluate expected notes independently. */
  setTarget(targetPitches: readonly number[]): void;
  setGeneration(generation: number): void;
  pause(generation: number): void;
  resume(generation: number): void;
  flush(): void;
  stop(): void;
}

export interface ListenModeFeedback {
  lifecycle: RecognizerLifecycle;
  targetPitches: number[];
  detectedTargetPitches: number[];
  extraPitches: number[];
  targetPitchConfidences: Array<{ midi: number; confidence: number }>;
  processingTimeMs: number | null;
}

export const stoppedRecognizerLifecycle: RecognizerLifecycle = {
  state: "stopped",
  microphone: "idle",
  analysis: "idle",
};
