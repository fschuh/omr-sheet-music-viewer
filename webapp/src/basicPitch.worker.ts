/// <reference lib="webworker" />

import { BasicPitch } from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";
import type { RecognizedOnset } from "./noteRecognizer";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const SAMPLE_RATE = 22_050;
const FFT_HOP = 256;
const WINDOW_SAMPLES = SAMPLE_RATE * 2 - FFT_HOP;
const MIDI_OFFSET = 21;
const RECENT_ONSET_MS = 360;
const MIN_REPORTED_ONSET = 0.1;
const ACTIVE_NOTE_THRESHOLD = 0.3;

interface InitializeMessage {
  type: "initialize";
  modelUrl: string;
}

interface InferMessage {
  type: "infer";
  requestId: number;
  generation: number;
  samples: Float32Array;
  capturedAtMs: number;
}

type IncomingMessage = InitializeMessage | InferMessage;

let basicPitch: BasicPitch | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localMaximum(values: number[][], frame: number, pitch: number): boolean {
  const value = values[frame][pitch];
  const previous = frame > 0 ? values[frame - 1][pitch] : -1;
  const next = frame + 1 < values.length ? values[frame + 1][pitch] : -1;
  return value >= previous && value > next;
}

function extractOnsets(
  onsets: number[][],
  notes: number[][],
  capturedAtMs: number,
): RecognizedOnset[] {
  const frameDurationMs = (FFT_HOP / SAMPLE_RATE) * 1_000;
  const recentFrames = Math.ceil(RECENT_ONSET_MS / frameDurationMs);
  const firstFrame = Math.max(0, onsets.length - recentFrames);
  const result: RecognizedOnset[] = [];
  for (let pitch = 0; pitch < 88; pitch += 1) {
    let bestFrame = -1;
    let confidence = MIN_REPORTED_ONSET;
    for (let frame = firstFrame; frame < onsets.length; frame += 1) {
      const candidate = onsets[frame][pitch];
      if (candidate >= confidence && localMaximum(onsets, frame, pitch)) {
        confidence = candidate;
        bestFrame = frame;
      }
    }
    if (bestFrame < 0) continue;
    result.push({
      midi: pitch + MIDI_OFFSET,
      confidence,
      noteConfidence: notes[bestFrame]?.[pitch] ?? 0,
      onsetTimeMs: capturedAtMs - (onsets.length - bestFrame - 0.5) * frameDurationMs,
    });
  }
  return result.sort((left, right) => left.onsetTimeMs - right.onsetTimeMs || left.midi - right.midi);
}

function extractActivePitches(notes: number[][]): Array<{ midi: number; confidence: number }> {
  const firstFrame = Math.max(0, notes.length - 8);
  const result: Array<{ midi: number; confidence: number }> = [];
  for (let pitch = 0; pitch < 88; pitch += 1) {
    let confidence = 0;
    for (let frame = firstFrame; frame < notes.length; frame += 1) {
      confidence = Math.max(confidence, notes[frame][pitch]);
    }
    if (confidence >= ACTIVE_NOTE_THRESHOLD) result.push({ midi: pitch + MIDI_OFFSET, confidence });
  }
  return result;
}

async function initialize(modelUrl: string): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
  const model = new BasicPitch(modelUrl);
  await model.model;
  basicPitch = model;
  workerScope.postMessage({ type: "ready", backend: "cpu" });
}

async function infer(message: InferMessage): Promise<void> {
  if (!basicPitch) throw new Error("Basic Pitch has not been initialized.");
  if (message.samples.length !== WINDOW_SAMPLES) {
    throw new Error(`Basic Pitch expected ${WINDOW_SAMPLES} samples, received ${message.samples.length}.`);
  }
  const startedAt = performance.now();
  const input = tf.tensor3d(message.samples, [1, WINDOW_SAMPLES, 1]);
  let noteTensor: tf.Tensor3D | null = null;
  let onsetTensor: tf.Tensor3D | null = null;
  try {
    const model = await basicPitch.model;
    [noteTensor, onsetTensor] = model.execute(input, [
      "Identity_1",
      "Identity_2",
    ]) as tf.Tensor3D[];
    const notes = (await noteTensor.array())[0];
    const onsets = (await onsetTensor.array())[0];
    workerScope.postMessage({
      type: "result",
      requestId: message.requestId,
      generation: message.generation,
      capturedAtMs: message.capturedAtMs,
      processingTimeMs: performance.now() - startedAt,
      onsets: extractOnsets(onsets, notes, message.capturedAtMs),
      activePitches: extractActivePitches(notes),
    });
  } finally {
    input.dispose();
    noteTensor?.dispose();
    onsetTensor?.dispose();
  }
}

workerScope.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === "initialize") {
    void initialize(message.modelUrl).catch((error) => {
      workerScope.postMessage({ type: "error", phase: "initialize", message: errorMessage(error) });
    });
    return;
  }
  void infer(message).catch((error) => {
    workerScope.postMessage({
      type: "error",
      phase: "inference",
      requestId: message.requestId,
      message: errorMessage(error),
    });
  });
};
