import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserBasicPitchRecognizer,
  type BasicPitchRecognizerEnvironment,
} from "./basicPitchRecognizer";
import type { RecognizerLifecycle, RecognizerResult } from "./noteRecognizer";

class MockNode {
  disconnected = false;
  connect(): unknown { return undefined; }
  disconnect(): void { this.disconnected = true; }
}

class MockProcessor extends MockNode {
  onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null = null;
  capture(samples: Float32Array): void {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  }
}

class MockWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  messages: Array<Record<string, unknown>> = [];
  initialize: "ready" | "error" | "deferred" = "ready";

  postMessage(message: unknown): void {
    const typed = message as Record<string, unknown>;
    this.messages.push(typed);
    if (typed.type !== "initialize") return;
    if (this.initialize === "ready") queueMicrotask(() => this.emit({ type: "ready" }));
    if (this.initialize === "error") {
      queueMicrotask(() => this.emit({ type: "error", phase: "initialize", message: "model failed" }));
    }
  }

  emit(data: unknown): void { this.onmessage?.({ data }); }
  terminate(): void { this.terminated = true; }
}

function fixture(options: {
  getUserMedia?: BasicPitchRecognizerEnvironment["getUserMedia"];
  workerInitialization?: MockWorker["initialize"];
} = {}) {
  const worker = new MockWorker();
  worker.initialize = options.workerInitialization ?? "ready";
  const processor = new MockProcessor();
  const source = new MockNode();
  const gain = Object.assign(new MockNode(), { gain: { value: 1 } });
  let closed = false;
  let stopped = false;
  let constraints: MediaStreamConstraints | null = null;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  const environment: BasicPitchRecognizerEnvironment = {
    getUserMedia: async (value) => {
      constraints = value;
      return options.getUserMedia ? options.getUserMedia(value) : stream;
    },
    createAudioContext: () => ({
      sampleRate: 22_050,
      destination: {},
      createMediaStreamSource: () => source,
      createScriptProcessor: () => processor,
      createGain: () => gain,
      resume: async () => undefined,
      close: async () => { closed = true; },
    }),
    createWorker: () => worker,
    now: () => 2_000,
    modelUrl: "http://local.test/models/basic-pitch/model.json",
  };
  return {
    environment,
    worker,
    processor,
    source,
    gain,
    stream,
    get closed() { return closed; },
    get stopped() { return stopped; },
    get constraints() { return constraints; },
  };
}

test("starts only after the microphone and local model are ready", async () => {
  const mock = fixture();
  const lifecycle: RecognizerLifecycle[] = [];
  const recognizer = new BrowserBasicPitchRecognizer(mock.environment);
  await recognizer.start(7, {
    onLifecycle: (value) => lifecycle.push(value),
    onResult: () => undefined,
  });

  assert.equal(lifecycle.at(-1)?.state, "listening");
  assert.equal(lifecycle.at(-1)?.microphone, "ready");
  assert.equal(lifecycle.at(-1)?.model, "ready");
  assert.deepEqual(mock.constraints, {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
  assert.equal(mock.worker.messages[0].type, "initialize");
});

test("drops stale queued windows while inference is busy", async () => {
  const mock = fixture();
  const results: RecognizerResult[] = [];
  const recognizer = new BrowserBasicPitchRecognizer(mock.environment);
  await recognizer.start(3, { onLifecycle: () => undefined, onResult: (value) => results.push(value) });

  mock.processor.capture(new Float32Array(4_096));
  mock.processor.capture(new Float32Array(4_096));
  mock.processor.capture(new Float32Array(4_096));
  assert.equal(mock.worker.messages.filter((message) => message.type === "infer").length, 1);
  const first = mock.worker.messages.find((message) => message.type === "infer")!;
  mock.worker.emit({
    type: "result",
    requestId: first.requestId,
    generation: 3,
    capturedAtMs: 2_000,
    processingTimeMs: 35,
    onsets: [],
    activePitches: [],
  });
  assert.equal(results.length, 1);
  assert.equal(mock.worker.messages.filter((message) => message.type === "infer").length, 2);
  assert.ok((mock.worker.messages.at(-1)?.requestId as number) > (first.requestId as number));
});

test("permission denial and model initialization failure clean up resources", async () => {
  const denied = fixture({
    getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); },
  });
  const deniedLifecycle: RecognizerLifecycle[] = [];
  await assert.rejects(
    new BrowserBasicPitchRecognizer(denied.environment).start(1, {
      onLifecycle: (value) => deniedLifecycle.push(value),
      onResult: () => undefined,
    }),
    /Microphone permission was denied/,
  );
  assert.equal(denied.worker.terminated, true);
  assert.equal(deniedLifecycle.at(-1)?.state, "error");

  const failedModel = fixture({ workerInitialization: "error" });
  await assert.rejects(
    new BrowserBasicPitchRecognizer(failedModel.environment).start(1, {
      onLifecycle: () => undefined,
      onResult: () => undefined,
    }),
    /model failed/,
  );
  assert.equal(failedModel.stopped, true);
  assert.equal(failedModel.worker.terminated, true);
});

test("rapid stop during initialization releases a late microphone stream", async () => {
  let resolveStream!: (stream: { getTracks(): Array<{ stop(): void }> }) => void;
  let stopped = false;
  const mock = fixture({
    workerInitialization: "deferred",
    getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; }),
  });
  const recognizer = new BrowserBasicPitchRecognizer(mock.environment);
  const starting = recognizer.start(1, { onLifecycle: () => undefined, onResult: () => undefined });
  recognizer.stop();
  resolveStream({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await starting;
  assert.equal(stopped, true);
  assert.equal(mock.worker.terminated, true);
});

test("pause flushes captured and queued audio and stop closes every resource", async () => {
  const mock = fixture();
  const recognizer = new BrowserBasicPitchRecognizer(mock.environment);
  await recognizer.start(1, { onLifecycle: () => undefined, onResult: () => undefined });
  mock.processor.capture(new Float32Array(4_096));
  mock.processor.capture(new Float32Array(4_096));
  const inferenceCount = mock.worker.messages.filter((message) => message.type === "infer").length;
  recognizer.pause(2);
  mock.processor.capture(new Float32Array(8_192));
  assert.equal(mock.worker.messages.filter((message) => message.type === "infer").length, inferenceCount);
  recognizer.stop();
  await Promise.resolve();
  assert.equal(mock.stopped, true);
  assert.equal(mock.closed, true);
  assert.equal(mock.worker.terminated, true);
  assert.equal(mock.processor.disconnected, true);
  assert.equal(mock.source.disconnected, true);
  assert.equal(mock.gain.disconnected, true);
});
