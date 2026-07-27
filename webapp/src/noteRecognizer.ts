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

export interface RecognizedPitchEvidence {
  midi: number;
  /** Recognizer-specific confidence that the pitch is sounding. */
  confidence: number;
}

export type RecognizedNoteStateName =
  | "off"
  | "offset"
  | "sustain"
  | "onset"
  | "reOnset";

export interface RecognizedNoteState extends RecognizedPitchEvidence {
  state: RecognizedNoteStateName;
}

export type RecognizedNoteEventType = "onset" | "reOnset" | "offset";

export interface RecognizedNoteEvent {
  midi: number;
  type: RecognizedNoteEventType;
  /** Confidence in the state transition that produced this event. */
  confidence: number;
  /** Monotonic capture-clock time, not wall-clock time. */
  eventTimeMs: number;
}

export interface RecognizerResult {
  generation: number;
  onsets: RecognizedOnset[];
  /** Current recognizer state only; this must not contain score-injected pitches. */
  recognizedActivePitches: RecognizedPitchEvidence[];
  /** Score-target evidence, including sub-argmax evidence when available. */
  targetPitchEvidence: RecognizedPitchEvidence[];
  /** Optional richer state snapshot supplied by state-aware recognizers. */
  noteStates?: RecognizedNoteState[];
  /** Optional state-transition events supplied by state-aware recognizers. */
  noteEvents?: RecognizedNoteEvent[];
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
