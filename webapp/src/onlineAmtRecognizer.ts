import type {
  NoteRecognizer,
  NoteRecognizerCallbacks,
  RecognizerLifecycle,
  RecognizerResult,
} from "./noteRecognizer";
import { ONLINE_AMT_SAMPLE_RATE } from "./onlineAmtProtocol";

const MODEL_PATH = "models/online_amt_streaming.onnx";
const WORKLET_PATH = "worklets/online-amt-capture.js";

// This remains an explicit code choice. BrowserSpectralRecognizer is retained
// alongside this implementation for future experiments and fallback work.
export const ONLINE_AMT_WASM_THREADS = 1;

type WorkerResponse =
  | { type: "initialized"; loadTimeMs: number }
  | ({ type: "result" } & RecognizerResult)
  | { type: "error"; message: string };

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

function messageForError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No default microphone was found.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export class BrowserOnlineAmtRecognizer implements NoteRecognizer {
  private callbacks: NoteRecognizerCallbacks | null = null;
  private lifecycle: RecognizerLifecycle = {
    state: "stopped",
    microphone: "idle",
    analysis: "idle",
  };
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private generation = 0;
  private targetPitches: number[] = [];
  private sessionToken = 0;
  private paused = false;

  private updateLifecycle(update: Partial<RecognizerLifecycle>): void {
    this.lifecycle = { ...this.lifecycle, ...update };
    this.callbacks?.onLifecycle(this.lifecycle);
  }

  async start(generation: number, callbacks: NoteRecognizerCallbacks): Promise<void> {
    this.stop();
    const token = ++this.sessionToken;
    let pendingStream: Promise<MediaStream> | null = null;
    this.callbacks = callbacks;
    this.generation = generation;
    this.paused = false;
    this.lifecycle = {
      state: "initializing",
      microphone: "loading",
      analysis: "loading",
    };
    callbacks.onLifecycle(this.lifecycle);

    try {
      const worker = new Worker(new URL("./onlineAmtWorker.ts", import.meta.url), {
        type: "module",
        name: "online-amt-inference",
      });
      this.worker = worker;
      const modelReady = new Promise<void>((resolve, reject) => {
        let initialized = false;
        const fail = (message: string) => {
          if (!initialized) {
            reject(new Error(message));
            return;
          }
          if (token !== this.sessionToken) return;
          this.sessionToken += 1;
          this.cleanupResources();
          this.updateLifecycle({
            state: "error",
            microphone: "idle",
            analysis: "error",
            error: message,
          });
        };
        worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
          if (token !== this.sessionToken) return;
          if (data.type === "initialized") {
            initialized = true;
            this.updateLifecycle({ analysis: "ready" });
            resolve();
          } else if (data.type === "result") {
            this.callbacks?.onResult(data);
          } else if (data.type === "error") {
            fail(data.message);
          }
        };
        worker.onerror = (event) => fail(event.message);
      });
      worker.postMessage({
        type: "initialize",
        modelUrl: assetUrl(MODEL_PATH),
        numThreads: ONLINE_AMT_WASM_THREADS,
        graphOptimizationLevel: "all",
        enableCpuMemArena: true,
        enableMemPattern: true,
        executionMode: "sequential",
      });

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not available on this system.");
      }
      pendingStream = navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const [stream] = await Promise.all([pendingStream, modelReady]);
      pendingStream = null;
      if (token !== this.sessionToken) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.updateLifecycle({ microphone: "ready" });

      const audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: ONLINE_AMT_SAMPLE_RATE,
      });
      if (audioContext.sampleRate !== ONLINE_AMT_SAMPLE_RATE) {
        throw new Error(
          `The audio device could not provide ${ONLINE_AMT_SAMPLE_RATE} Hz input.`,
        );
      }
      await audioContext.audioWorklet.addModule(assetUrl(WORKLET_PATH));
      const source = audioContext.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(audioContext, "online-amt-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
      });
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      const clockOffsetMs = performance.now() - audioContext.currentTime * 1_000;
      captureNode.port.onmessage = ({ data }: MessageEvent<{
        type: "audio";
        audio: ArrayBuffer;
        audioTimeMs: number;
      }>) => {
        if (
          data.type !== "audio" ||
          this.paused ||
          token !== this.sessionToken ||
          !this.worker
        ) return;
        this.worker.postMessage(
          {
            type: "audio",
            audio: data.audio,
            generation: this.generation,
            capturedAtMs: clockOffsetMs + data.audioTimeMs,
            targetPitches: this.targetPitches,
          },
          [data.audio],
        );
      };
      source.connect(captureNode);
      captureNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      this.audioContext = audioContext;
      this.source = source;
      this.captureNode = captureNode;
      this.silentGain = silentGain;
      await audioContext.resume();
      if (token !== this.sessionToken) return;
      this.updateLifecycle({ state: "listening" });
    } catch (error) {
      void pendingStream?.then((stream) => {
        for (const track of stream.getTracks()) track.stop();
      }).catch(() => undefined);
      if (token !== this.sessionToken) return;
      const message = messageForError(error);
      this.cleanupResources();
      this.updateLifecycle({
        state: "error",
        microphone: this.lifecycle.microphone === "ready" ? "ready" : "error",
        analysis: this.lifecycle.analysis === "ready" ? "ready" : "error",
        error: message,
      });
      throw new Error(message);
    }
  }

  setTarget(targetPitches: readonly number[]): void {
    // The network remains target-independent. Target pitches are used only to
    // expose sub-argmax active evidence to ExactChordMatcher.
    this.targetPitches = Array.from(
      new Set(targetPitches.filter((pitch) => Number.isInteger(pitch))),
    ).sort((left, right) => left - right);
  }

  setGeneration(generation: number): void {
    this.generation = generation;
  }

  pause(generation: number): void {
    this.generation = generation;
    this.paused = true;
    this.captureNode?.port.postMessage({ type: "pause" });
    this.worker?.postMessage({ type: "reset" });
    if (this.lifecycle.state !== "error" && this.lifecycle.state !== "stopped") {
      this.updateLifecycle({ state: "paused" });
    }
  }

  resume(generation: number): void {
    this.generation = generation;
    this.worker?.postMessage({ type: "reset" });
    this.captureNode?.port.postMessage({ type: "resume" });
    this.paused = false;
    if (this.lifecycle.state !== "error" && this.lifecycle.state !== "stopped") {
      this.updateLifecycle({ state: "listening" });
    }
  }

  flush(): void {
    this.worker?.postMessage({ type: "reset" });
    this.captureNode?.port.postMessage({ type: "flush" });
  }

  stop(): void {
    this.sessionToken += 1;
    this.cleanupResources();
    this.callbacks = null;
    this.lifecycle = { state: "stopped", microphone: "idle", analysis: "idle" };
  }

  private cleanupResources(): void {
    this.captureNode?.port.postMessage({ type: "pause" });
    this.source?.disconnect();
    this.captureNode?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.audioContext?.close().catch(() => undefined);
    this.worker?.postMessage({ type: "stop" });
    this.worker?.terminate();
    this.source = null;
    this.captureNode = null;
    this.silentGain = null;
    this.stream = null;
    this.audioContext = null;
    this.worker = null;
  }
}
