import type {
  NoteRecognizer,
  NoteRecognizerCallbacks,
  RecognizerLifecycle,
  RecognizerResult,
} from "./noteRecognizer";

const TARGET_SAMPLE_RATE = 22_050;
const WINDOW_SAMPLES = TARGET_SAMPLE_RATE * 2 - 256;
const SUBMIT_INTERVAL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.1);

interface TrackLike {
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): TrackLike[];
}

interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

interface ProcessorLike extends AudioNodeLike {
  onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null;
}

interface GainLike extends AudioNodeLike {
  gain: { value: number };
}

interface AudioContextLike {
  sampleRate: number;
  destination: unknown;
  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
  createScriptProcessor(bufferSize: number, inputChannels: number, outputChannels: number): ProcessorLike;
  createGain(): GainLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

interface WorkerMessageEventLike {
  data: unknown;
}

interface WorkerLike {
  onmessage: ((event: WorkerMessageEventLike) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface BasicPitchRecognizerEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  createAudioContext(): AudioContextLike;
  createWorker(): WorkerLike;
  now(): number;
  modelUrl: string;
}

interface WorkerResultMessage extends RecognizerResult {
  type: "result";
  requestId: number;
}

interface PendingInference {
  requestId: number;
  generation: number;
  samples: Float32Array;
  capturedAtMs: number;
}

function defaultEnvironment(): BasicPitchRecognizerEnvironment {
  const AudioContextConstructor = window.AudioContext;
  return {
    getUserMedia: (constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return Promise.reject(new Error("Microphone capture is not available on this system."));
      }
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    createAudioContext: () => {
      if (!AudioContextConstructor) throw new Error("The Web Audio API is not available on this system.");
      return new AudioContextConstructor({ latencyHint: "interactive" }) as unknown as AudioContextLike;
    },
    createWorker: () => {
      if (typeof Worker === "undefined") throw new Error("Audio inference workers are not available.");
      return new Worker(
        new URL("./basicPitch.worker.ts", import.meta.url),
        { type: "module" },
      ) as unknown as WorkerLike;
    },
    now: () => performance.now(),
    modelUrl: new URL("/models/basic-pitch/model.json", window.location.href).href,
  };
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

class RollingAudioWindow {
  private readonly values = new Float32Array(WINDOW_SAMPLES);
  private writeIndex = 0;

  clear(): void {
    this.values.fill(0);
    this.writeIndex = 0;
  }

  append(samples: Float32Array): void {
    for (const sample of samples) {
      this.values[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.values.length;
    }
  }

  snapshot(): Float32Array {
    const result = new Float32Array(this.values.length);
    const tail = this.values.length - this.writeIndex;
    result.set(this.values.subarray(this.writeIndex), 0);
    result.set(this.values.subarray(0, this.writeIndex), tail);
    return result;
  }
}

/** Streaming linear resampler with continuity across Web Audio callback blocks. */
class MonoResampler {
  private previousSample: number | null = null;
  private nextSourcePosition = 0;

  constructor(
    private readonly inputRate: number,
    private readonly outputRate: number,
  ) {}

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array();
    if (this.previousSample === null) this.previousSample = input[0];
    const source = new Float32Array(input.length + 1);
    source[0] = this.previousSample;
    source.set(input, 1);
    const ratio = this.inputRate / this.outputRate;
    const output: number[] = [];
    let position = this.nextSourcePosition;
    while (position < source.length - 1) {
      const lower = Math.floor(position);
      const fraction = position - lower;
      output.push(source[lower] + (source[lower + 1] - source[lower]) * fraction);
      position += ratio;
    }
    this.nextSourcePosition = position - (source.length - 1);
    this.previousSample = input[input.length - 1];
    return Float32Array.from(output);
  }
}

export class BrowserBasicPitchRecognizer implements NoteRecognizer {
  private readonly environment: BasicPitchRecognizerEnvironment;
  private callbacks: NoteRecognizerCallbacks | null = null;
  private lifecycle: RecognizerLifecycle = {
    state: "stopped",
    microphone: "idle",
    model: "idle",
  };
  private stream: MediaStreamLike | null = null;
  private audioContext: AudioContextLike | null = null;
  private source: AudioNodeLike | null = null;
  private processor: ProcessorLike | null = null;
  private silentGain: GainLike | null = null;
  private worker: WorkerLike | null = null;
  private readonly ring = new RollingAudioWindow();
  private resampler: MonoResampler | null = null;
  private sessionToken = 0;
  private generation = 0;
  private paused = false;
  private workerBusy = false;
  private pending: PendingInference | null = null;
  private nextRequestId = 1;
  private samplesSinceSubmit = 0;
  private cancelInitialization: (() => void) | null = null;

  constructor(environment?: BasicPitchRecognizerEnvironment) {
    this.environment = environment ?? defaultEnvironment();
  }

  private updateLifecycle(update: Partial<RecognizerLifecycle>): void {
    this.lifecycle = { ...this.lifecycle, ...update };
    this.callbacks?.onLifecycle(this.lifecycle);
  }

  async start(generation: number, callbacks: NoteRecognizerCallbacks): Promise<void> {
    this.stop();
    const token = ++this.sessionToken;
    this.callbacks = callbacks;
    this.generation = generation;
    this.paused = false;
    this.lifecycle = { state: "initializing", microphone: "loading", model: "loading" };
    callbacks.onLifecycle(this.lifecycle);

    let resolveModel!: () => void;
    let rejectModel!: (error: unknown) => void;
    const modelReady = new Promise<void>((resolve, reject) => {
      resolveModel = resolve;
      rejectModel = reject;
    });
    let resolveCancellation!: () => void;
    const cancelled = new Promise<null>((resolve) => {
      resolveCancellation = () => resolve(null);
    });
    this.cancelInitialization = resolveCancellation;

    try {
      const worker = this.environment.createWorker();
      this.worker = worker;
      worker.onmessage = (event) => {
        const message = event.data as { type?: string; phase?: string; message?: string };
        if (message.type === "ready") {
          this.updateLifecycle({ model: "ready" });
          resolveModel();
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.message ?? "Basic Pitch inference failed.");
          if (message.phase === "initialize") {
            this.updateLifecycle({ model: "error" });
            rejectModel(error);
          } else {
            this.fail(error);
          }
          return;
        }
        if (message.type === "result") this.handleWorkerResult(event.data as WorkerResultMessage);
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || "The Basic Pitch worker stopped unexpectedly.");
        rejectModel(error);
        this.fail(error);
      };
      worker.postMessage({ type: "initialize", modelUrl: this.environment.modelUrl });

      const microphone = this.environment.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      }).then((stream) => {
        if (token !== this.sessionToken) {
          for (const track of stream.getTracks()) track.stop();
          return stream;
        }
        this.stream = stream;
        this.updateLifecycle({ microphone: "ready" });
        return stream;
      }).catch((error) => {
        this.updateLifecycle({ microphone: "error" });
        throw error;
      });

      const initialized = await Promise.race([
        Promise.all([microphone, modelReady]),
        cancelled,
      ]);
      if (initialized === null || token !== this.sessionToken) return;
      this.cancelInitialization = null;
      const [stream] = initialized;
      const audioContext = this.environment.createAudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      this.audioContext = audioContext;
      this.source = source;
      this.processor = processor;
      this.silentGain = silentGain;
      this.resampler = new MonoResampler(audioContext.sampleRate, TARGET_SAMPLE_RATE);
      processor.onaudioprocess = (event) => this.capture(event.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      await audioContext.resume();
      if (token !== this.sessionToken) {
        this.cleanupResources();
        return;
      }
      this.updateLifecycle({ state: "listening" });
    } catch (error) {
      if (token !== this.sessionToken) return;
      this.cancelInitialization = null;
      const message = messageForError(error);
      this.cleanupResources();
      this.updateLifecycle({ state: "error", error: message });
      throw new Error(message);
    }
  }

  private capture(input: Float32Array): void {
    if (this.paused || this.lifecycle.state !== "listening" || !this.resampler) return;
    const samples = this.resampler.process(input);
    this.ring.append(samples);
    this.samplesSinceSubmit += samples.length;
    if (this.samplesSinceSubmit < SUBMIT_INTERVAL_SAMPLES) return;
    this.samplesSinceSubmit %= SUBMIT_INTERVAL_SAMPLES;
    this.queueInference({
      requestId: this.nextRequestId++,
      generation: this.generation,
      samples: this.ring.snapshot(),
      capturedAtMs: this.environment.now(),
    });
  }

  private queueInference(inference: PendingInference): void {
    if (this.workerBusy) {
      // The newest window supersedes any queued work; audio is never retained beyond this buffer.
      this.pending = inference;
      return;
    }
    const worker = this.worker;
    if (!worker) return;
    this.workerBusy = true;
    worker.postMessage({ type: "infer", ...inference }, [inference.samples.buffer]);
  }

  private handleWorkerResult(message: WorkerResultMessage): void {
    this.workerBusy = false;
    this.callbacks?.onResult({
      generation: message.generation,
      onsets: message.onsets,
      activePitches: message.activePitches,
      processingTimeMs: message.processingTimeMs,
      capturedAtMs: message.capturedAtMs,
    });
    const next = this.pending;
    this.pending = null;
    if (next && !this.paused && this.lifecycle.state === "listening") this.queueInference(next);
  }

  private fail(error: unknown): void {
    const message = messageForError(error);
    this.cleanupResources();
    this.updateLifecycle({ state: "error", error: message });
  }

  setGeneration(generation: number): void {
    this.generation = generation;
    this.pending = null;
  }

  pause(generation: number): void {
    this.generation = generation;
    this.paused = true;
    this.flush();
    if (this.lifecycle.state !== "error" && this.lifecycle.state !== "stopped") {
      this.updateLifecycle({ state: "paused" });
    }
  }

  resume(generation: number): void {
    this.generation = generation;
    this.flush();
    this.paused = false;
    if (this.lifecycle.state !== "error" && this.lifecycle.state !== "stopped") {
      this.updateLifecycle({ state: "listening" });
    }
  }

  flush(): void {
    this.ring.clear();
    this.pending = null;
    this.samplesSinceSubmit = 0;
  }

  stop(): void {
    this.cancelInitialization?.();
    this.cancelInitialization = null;
    this.sessionToken += 1;
    this.cleanupResources();
    this.callbacks = null;
    this.lifecycle = { state: "stopped", microphone: "idle", model: "idle" };
  }

  private cleanupResources(): void {
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.audioContext?.close().catch(() => undefined);
    this.worker?.terminate();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.stream = null;
    this.audioContext = null;
    this.worker = null;
    this.resampler = null;
    this.workerBusy = false;
    this.pending = null;
    this.ring.clear();
    this.samplesSinceSubmit = 0;
  }
}
