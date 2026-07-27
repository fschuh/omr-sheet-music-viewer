/// <reference lib="webworker" />

import { OnlineAmtSession, type OnlineAmtSessionOptions } from "./onlineAmtSession";
import { OnlineAmtOutputDecoder } from "./onlineAmtOutput";

interface InitializeMessage extends OnlineAmtSessionOptions {
  type: "initialize";
}

interface AudioMessage {
  type: "audio";
  audio: ArrayBuffer;
  generation: number;
  capturedAtMs: number;
  targetPitches: number[];
}

interface ResetMessage {
  type: "reset";
}

interface StopMessage {
  type: "stop";
}

type WorkerRequest = InitializeMessage | AudioMessage | ResetMessage | StopMessage;

let session: OnlineAmtSession | null = null;
let decoder = new OnlineAmtOutputDecoder();
let operation = Promise.resolve();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function processAudio(message: AudioMessage): Promise<void> {
  if (!session) throw new Error("online_amt is not initialized");
  const result = await session.run(new Float32Array(message.audio));
  const decoded = decoder.decode(
    result.scores,
    result.states,
    result.signalActive,
    message.capturedAtMs,
    message.targetPitches,
  );
  self.postMessage({
    type: "result",
    generation: message.generation,
    ...decoded,
    processingTimeMs: result.inferenceTimeMs,
    capturedAtMs: message.capturedAtMs,
  });
}

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "initialize") {
    operation = operation.then(async () => {
      const startedAt = performance.now();
      session = await OnlineAmtSession.create(data);
      decoder.reset();
      self.postMessage({
        type: "initialized",
        loadTimeMs: performance.now() - startedAt,
      });
    }).catch((error: unknown) => {
      self.postMessage({ type: "error", message: errorMessage(error) });
    });
    return;
  }
  if (data.type === "audio") {
    operation = operation.then(() => processAudio(data)).catch((error: unknown) => {
      self.postMessage({ type: "error", message: errorMessage(error) });
    });
    return;
  }
  if (data.type === "reset") {
    operation = operation.then(() => {
      session?.reset();
      decoder.reset();
    }).catch((error: unknown) => {
      self.postMessage({ type: "error", message: errorMessage(error) });
    });
    return;
  }
  if (data.type === "stop") {
    operation = operation.then(async () => {
      await session?.dispose();
      session = null;
      self.close();
    });
  }
};
