import type {
  NoteRecognizer,
  NoteRecognizerCallbacks,
  RecognizerLifecycle,
} from "./noteRecognizer";
import { SpectralPitchDetector } from "./spectralPitchDetector";

const FFT_SIZE = 16_384;

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

interface AnalyserLike extends AudioNodeLike {
  fftSize: number;
  smoothingTimeConstant: number;
  minDecibels: number;
  maxDecibels: number;
  readonly frequencyBinCount: number;
  getFloatFrequencyData(target: Float32Array<ArrayBuffer>): void;
}

interface GainLike extends AudioNodeLike {
  gain: { value: number };
}

interface AudioContextLike {
  sampleRate: number;
  destination: unknown;
  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
  createAnalyser(): AnalyserLike;
  createGain(): GainLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

interface DetectorLike {
  process(spectrumDb: Float32Array, capturedAtMs: number): {
    onsets: Array<{ midi: number; confidence: number; noteConfidence: number; onsetTimeMs: number }>;
    activePitches: Array<{ midi: number; confidence: number }>;
  };
  reset(): void;
}

export interface SpectralRecognizerEnvironment {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  createAudioContext(): AudioContextLike;
  createDetector(sampleRate: number, fftSize: number): DetectorLike;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  now(): number;
}

function defaultEnvironment(): SpectralRecognizerEnvironment {
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
    createDetector: (sampleRate, fftSize) => new SpectralPitchDetector({ sampleRate, fftSize }),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
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

export class BrowserSpectralRecognizer implements NoteRecognizer {
  private readonly environment: SpectralRecognizerEnvironment;
  private callbacks: NoteRecognizerCallbacks | null = null;
  private lifecycle: RecognizerLifecycle = {
    state: "stopped",
    microphone: "idle",
    analysis: "idle",
  };
  private stream: MediaStreamLike | null = null;
  private audioContext: AudioContextLike | null = null;
  private source: AudioNodeLike | null = null;
  private analyser: AnalyserLike | null = null;
  private silentGain: GainLike | null = null;
  private detector: DetectorLike | null = null;
  private spectrum: Float32Array<ArrayBuffer> | null = null;
  private animationFrame: number | null = null;
  private sessionToken = 0;
  private generation = 0;
  private paused = false;

  constructor(environment?: SpectralRecognizerEnvironment) {
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
    this.lifecycle = { state: "initializing", microphone: "loading", analysis: "loading" };
    callbacks.onLifecycle(this.lifecycle);

    try {
      const stream = await this.environment.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (token !== this.sessionToken) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.updateLifecycle({ microphone: "ready" });

      const audioContext = this.environment.createAudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const silentGain = audioContext.createGain();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -15;
      silentGain.gain.value = 0;
      this.audioContext = audioContext;
      this.source = source;
      this.analyser = analyser;
      this.silentGain = silentGain;
      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);
      this.detector = this.environment.createDetector(audioContext.sampleRate, analyser.fftSize);
      this.spectrum = new Float32Array(analyser.frequencyBinCount);
      this.updateLifecycle({ analysis: "ready" });
      await audioContext.resume();
      if (token !== this.sessionToken) {
        this.cleanupResources();
        return;
      }
      this.updateLifecycle({ state: "listening" });
      this.scheduleFrame();
    } catch (error) {
      if (token !== this.sessionToken) return;
      const message = messageForError(error);
      this.cleanupResources();
      this.updateLifecycle({ state: "error", error: message });
      throw new Error(message);
    }
  }

  private scheduleFrame(): void {
    if (
      this.animationFrame !== null ||
      this.paused ||
      this.lifecycle.state !== "listening"
    ) return;
    this.animationFrame = this.environment.requestFrame(() => {
      this.animationFrame = null;
      this.analyzeFrame();
      this.scheduleFrame();
    });
  }

  private analyzeFrame(): void {
    const analyser = this.analyser;
    const detector = this.detector;
    const spectrum = this.spectrum;
    if (!analyser || !detector || !spectrum || this.paused) return;
    try {
      const startedAt = this.environment.now();
      analyser.getFloatFrequencyData(spectrum);
      const capturedAtMs = this.environment.now();
      const frame = detector.process(spectrum, capturedAtMs);
      this.callbacks?.onResult({
        generation: this.generation,
        onsets: frame.onsets,
        activePitches: frame.activePitches,
        processingTimeMs: this.environment.now() - startedAt,
        capturedAtMs,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const message = messageForError(error);
    this.cleanupResources();
    this.updateLifecycle({ state: "error", error: message });
  }

  setGeneration(generation: number): void {
    this.generation = generation;
    this.detector?.reset();
  }

  pause(generation: number): void {
    this.generation = generation;
    this.paused = true;
    this.flush();
    if (this.animationFrame !== null) this.environment.cancelFrame(this.animationFrame);
    this.animationFrame = null;
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
      this.scheduleFrame();
    }
  }

  flush(): void {
    this.detector?.reset();
    this.spectrum?.fill(-Infinity);
  }

  stop(): void {
    this.sessionToken += 1;
    this.cleanupResources();
    this.callbacks = null;
    this.lifecycle = { state: "stopped", microphone: "idle", analysis: "idle" };
  }

  private cleanupResources(): void {
    if (this.animationFrame !== null) this.environment.cancelFrame(this.animationFrame);
    this.animationFrame = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.audioContext?.close().catch(() => undefined);
    this.detector?.reset();
    this.source = null;
    this.analyser = null;
    this.silentGain = null;
    this.stream = null;
    this.audioContext = null;
    this.detector = null;
    this.spectrum = null;
  }
}
