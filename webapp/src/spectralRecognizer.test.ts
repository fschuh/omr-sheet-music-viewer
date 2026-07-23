import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserSpectralRecognizer,
  type SpectralRecognizerEnvironment,
} from "./spectralRecognizer";
import type { RecognizerLifecycle, RecognizerResult } from "./noteRecognizer";

class MockNode {
  disconnected = false;
  connect(): unknown { return undefined; }
  disconnect(): void { this.disconnected = true; }
}

class MockAnalyser extends MockNode {
  fftSize = 2_048;
  smoothingTimeConstant = 1;
  minDecibels = -100;
  maxDecibels = -15;
  get frequencyBinCount(): number { return this.fftSize / 2; }
  getFloatFrequencyData(target: Float32Array): void { target.fill(-100); }
}

class MockDetector {
  resetCount = 0;
  processCount = 0;
  targets: number[] = [];
  process(_spectrum: Float32Array, capturedAtMs: number) {
    this.processCount += 1;
    return {
      onsets: [{ midi: 60, confidence: 0.9, noteConfidence: 0.8, onsetTimeMs: capturedAtMs }],
      activePitches: [{ midi: 60, confidence: 0.8 }],
    };
  }
  setTarget(targetPitches: readonly number[]): void { this.targets = [...targetPitches]; }
  reset(): void { this.resetCount += 1; }
}

function fixture(options: {
  getUserMedia?: SpectralRecognizerEnvironment["getUserMedia"];
  audioContextError?: Error;
} = {}) {
  const analyser = new MockAnalyser();
  const detector = new MockDetector();
  const source = new MockNode();
  const silentGain = Object.assign(new MockNode(), { gain: { value: 1 } });
  let closed = false;
  let stopped = false;
  let constraints: MediaStreamConstraints | null = null;
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const cancelledFrames: number[] = [];
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  const environment: SpectralRecognizerEnvironment = {
    getUserMedia: async (value) => {
      constraints = value;
      return options.getUserMedia ? options.getUserMedia(value) : stream;
    },
    createAudioContext: () => {
      if (options.audioContextError) throw options.audioContextError;
      return {
        sampleRate: 48_000,
        destination: {},
        createMediaStreamSource: () => source,
        createAnalyser: () => analyser,
        createGain: () => silentGain,
        resume: async () => undefined,
        close: async () => { closed = true; },
      };
    },
    createDetector: () => detector,
    requestFrame: (callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      cancelledFrames.push(handle);
      frames.delete(handle);
    },
    now: () => 2_000,
  };
  return {
    environment,
    analyser,
    detector,
    source,
    silentGain,
    stream,
    frames,
    cancelledFrames,
    runFrame() {
      const [handle, callback] = frames.entries().next().value as [number, FrameRequestCallback];
      frames.delete(handle);
      callback(2_000);
    },
    get closed() { return closed; },
    get stopped() { return stopped; },
    get constraints() { return constraints; },
  };
}

test("starts only after the microphone and spectrum analyzer are ready", async () => {
  const mock = fixture();
  const lifecycle: RecognizerLifecycle[] = [];
  const recognizer = new BrowserSpectralRecognizer(mock.environment);
  await recognizer.start(7, {
    onLifecycle: (value) => lifecycle.push(value),
    onResult: () => undefined,
  });

  assert.equal(lifecycle.at(-1)?.state, "listening");
  assert.equal(lifecycle.at(-1)?.microphone, "ready");
  assert.equal(lifecycle.at(-1)?.analysis, "ready");
  assert.equal(mock.analyser.fftSize, 16_384);
  assert.equal(mock.analyser.smoothingTimeConstant, 0);
  assert.equal(mock.silentGain.gain.value, 0);
  assert.deepEqual(mock.constraints, {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
});

test("reports each animation-frame result with the current playhead generation", async () => {
  const mock = fixture();
  const results: RecognizerResult[] = [];
  const recognizer = new BrowserSpectralRecognizer(mock.environment);
  recognizer.setTarget([48, 60, 67]);
  await recognizer.start(3, { onLifecycle: () => undefined, onResult: (value) => results.push(value) });
  assert.deepEqual(mock.detector.targets, [48, 60, 67]);
  mock.runFrame();
  assert.equal(results[0].generation, 3);
  assert.deepEqual(results[0].onsets.map((onset) => onset.midi), [60]);

  recognizer.setGeneration(4);
  mock.runFrame();
  assert.equal(results[1].generation, 4);
  assert.equal(mock.detector.resetCount, 1);

  recognizer.setTarget([62]);
  assert.deepEqual(mock.detector.targets, [62]);
});

test("permission denial and analyzer initialization failure clean up resources", async () => {
  const denied = fixture({
    getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); },
  });
  const deniedLifecycle: RecognizerLifecycle[] = [];
  await assert.rejects(
    new BrowserSpectralRecognizer(denied.environment).start(1, {
      onLifecycle: (value) => deniedLifecycle.push(value),
      onResult: () => undefined,
    }),
    /Microphone permission was denied/,
  );
  assert.equal(deniedLifecycle.at(-1)?.state, "error");

  const failedAnalysis = fixture({ audioContextError: new Error("analyzer failed") });
  await assert.rejects(
    new BrowserSpectralRecognizer(failedAnalysis.environment).start(1, {
      onLifecycle: () => undefined,
      onResult: () => undefined,
    }),
    /analyzer failed/,
  );
  assert.equal(failedAnalysis.stopped, true);
});

test("rapid stop during initialization releases a late microphone stream", async () => {
  let resolveStream!: (stream: { getTracks(): Array<{ stop(): void }> }) => void;
  let stopped = false;
  const mock = fixture({
    getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; }),
  });
  const recognizer = new BrowserSpectralRecognizer(mock.environment);
  const starting = recognizer.start(1, { onLifecycle: () => undefined, onResult: () => undefined });
  recognizer.stop();
  resolveStream({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await starting;
  assert.equal(stopped, true);
});

test("pause flushes analysis and stop closes every resource", async () => {
  const mock = fixture();
  const recognizer = new BrowserSpectralRecognizer(mock.environment);
  await recognizer.start(1, { onLifecycle: () => undefined, onResult: () => undefined });
  const scheduled = mock.frames.size;
  recognizer.pause(2);
  assert.equal(mock.frames.size, 0);
  assert.equal(mock.cancelledFrames.length, scheduled);
  assert.equal(mock.detector.resetCount, 1);
  recognizer.resume(3);
  assert.equal(mock.frames.size, 1);
  recognizer.stop();
  await Promise.resolve();
  assert.equal(mock.stopped, true);
  assert.equal(mock.closed, true);
  assert.equal(mock.source.disconnected, true);
  assert.equal(mock.analyser.disconnected, true);
  assert.equal(mock.silentGain.disconnected, true);
});
