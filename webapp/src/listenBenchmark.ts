import { defaultChordMatcherOptions } from "./chordMatcher";
import { pianoSampleUrls } from "./piano";
import type { RecognizerResult } from "./noteRecognizer";

const SAMPLE_RATE = 22_050;
const WINDOW_SAMPLES = SAMPLE_RATE * 2 - 256;
const WINDOW_DURATION_MS = (WINDOW_SAMPLES / SAMPLE_RATE) * 1_000;
const FIXTURE_ONSET_BEFORE_END_MS = 180;

export interface ListenBenchmarkTrial {
  source: "bundled" | "acoustic" | "digital";
  targetPitches: number[];
  playedPitches: number[];
  expectedCorrect: boolean;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  inferenceMs: number;
  recognizedOnsets?: Array<{ midi: number; confidence: number; noteConfidence: number }>;
}

export interface ListenBenchmarkSummary {
  trials: ListenBenchmarkTrial[];
  correctTrialCount: number;
  successRate: number;
  falseAdvanceCount: number;
  p95OnsetToAdvanceMs: number | null;
  acceptance: {
    latency: boolean;
    successRate: boolean;
    falseAdvances: boolean;
    passed: boolean;
  };
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

export function summarizeListenBenchmark(trials: ListenBenchmarkTrial[]): ListenBenchmarkSummary {
  const correct = trials.filter((trial) => trial.expectedCorrect);
  const successRate = correct.length === 0
    ? 0
    : correct.filter((trial) => trial.advanced).length / correct.length;
  const falseAdvanceCount = trials.filter((trial) => !trial.expectedCorrect && trial.advanced).length;
  const p95OnsetToAdvanceMs = percentile95(
    correct.flatMap((trial) => trial.advanced && trial.onsetToAdvanceMs !== null
      ? [trial.onsetToAdvanceMs]
      : []),
  );
  const acceptance = {
    latency: p95OnsetToAdvanceMs !== null && p95OnsetToAdvanceMs < 400,
    successRate: successRate >= 0.95,
    falseAdvances: falseAdvanceCount === 0,
    passed: false,
  };
  acceptance.passed = acceptance.latency && acceptance.successRate && acceptance.falseAdvances;
  return {
    trials,
    correctTrialCount: correct.length,
    successRate,
    falseAdvanceCount,
    p95OnsetToAdvanceMs,
    acceptance,
  };
}

class BenchmarkWorkerClient {
  private readonly worker = new Worker(
    new URL("./basicPitch.worker.ts", import.meta.url),
    { type: "module" },
  );
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (result: RecognizerResult) => void; reject: (error: Error) => void }
  >();
  private readonly ready: Promise<void>;

  constructor() {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.worker.onmessage = (event) => {
      const message = event.data as { type?: string; requestId?: number; message?: string };
      if (message.type === "ready") {
        resolveReady();
        return;
      }
      if (message.type === "error") {
        const error = new Error(message.message ?? "Basic Pitch benchmark failed.");
        if (message.requestId === undefined) rejectReady(error);
        else {
          this.pending.get(message.requestId)?.reject(error);
          this.pending.delete(message.requestId);
        }
        return;
      }
      if (message.type === "result" && message.requestId !== undefined) {
        this.pending.get(message.requestId)?.resolve(event.data as RecognizerResult);
        this.pending.delete(message.requestId);
      }
    };
    this.worker.onerror = (event) => rejectReady(new Error(event.message));
    this.worker.postMessage({
      type: "initialize",
      modelUrl: new URL("/models/basic-pitch/model.json", window.location.href).href,
    });
  }

  async evaluate(samples: Float32Array): Promise<RecognizerResult> {
    await this.ready;
    const requestId = this.nextRequestId++;
    const capturedAtMs = performance.now();
    const promise = new Promise<RecognizerResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
    this.worker.postMessage(
      { type: "infer", requestId, generation: requestId, samples, capturedAtMs },
      [samples.buffer],
    );
    return promise;
  }

  dispose(): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error("Benchmark stopped."));
    this.pending.clear();
  }
}

function nearestSample(midi: number): [number, string] {
  const samples = Object.entries(pianoSampleUrls()).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => (
    Math.abs(candidate[0] - midi) < Math.abs(nearest[0] - midi) ? candidate : nearest
  ));
}

async function renderBundledPianoFixture(
  audioContext: AudioContext,
  pitches: readonly number[],
): Promise<Float32Array> {
  const decoded = new Map<string, AudioBuffer>();
  for (const midi of pitches) {
    const [, url] = nearestSample(midi);
    if (!decoded.has(url)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load benchmark sample ${url}.`);
      decoded.set(url, await audioContext.decodeAudioData(await response.arrayBuffer()));
    }
  }
  const offline = new OfflineAudioContext(1, WINDOW_SAMPLES, SAMPLE_RATE);
  const onsetSeconds = (WINDOW_DURATION_MS - FIXTURE_ONSET_BEFORE_END_MS) / 1_000;
  for (const midi of pitches) {
    const [sampleMidi, url] = nearestSample(midi);
    const source = offline.createBufferSource();
    source.buffer = decoded.get(url)!;
    source.playbackRate.value = 2 ** ((midi - sampleMidi) / 12);
    const gain = offline.createGain();
    gain.gain.value = Math.min(0.8, 0.9 / Math.sqrt(pitches.length));
    source.connect(gain).connect(offline.destination);
    source.start(onsetSeconds);
  }
  return (await offline.startRendering()).getChannelData(0).slice();
}

function exactDetectedPitches(result: RecognizerResult, targetPitches: readonly number[]): number[] {
  const target = new Set(targetPitches);
  return Array.from(new Set(
    result.onsets
      .filter((onset) => onset.confidence >= defaultChordMatcherOptions.onsetThreshold)
      .filter((onset) => onset.noteConfidence >= (
        target.has(onset.midi)
          ? defaultChordMatcherOptions.targetNoteThreshold
          : defaultChordMatcherOptions.noteThreshold
      ))
      .map((onset) => onset.midi),
  )).sort((left, right) => left - right);
}

function samePitches(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pitch, index) => pitch === right[index]);
}

export async function runBundledListenBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
  const correct = [
    [60],
    [48, 60],
    [60, 64, 67],
    [48, 55, 60, 64],
    [48, 55, 60, 64, 67],
    [40, 52, 59, 64, 67, 72],
  ];
  const cases = [
    ...correct.flatMap((pitches) => Array.from({ length: 4 }, () => ({ target: pitches, played: pitches }))),
    { target: [60], played: [61] },
    { target: [60, 64], played: [60, 65] },
    { target: [60, 64, 67], played: [60, 64, 67, 72] },
    { target: [48, 55, 60], played: [48, 55] },
  ];
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const client = new BenchmarkWorkerClient();
  const trials: ListenBenchmarkTrial[] = [];
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const benchmarkCase = cases[index];
      const played = [...benchmarkCase.played].sort((left, right) => left - right);
      const target = [...benchmarkCase.target].sort((left, right) => left - right);
      const result = await client.evaluate(
        await renderBundledPianoFixture(audioContext, played),
      );
      const detected = exactDetectedPitches(result, target);
      const advanced = samePitches(target, detected);
      const expectedCorrect = samePitches(target, played);
      trials.push({
        source: "bundled",
        targetPitches: target,
        playedPitches: played,
        expectedCorrect,
        advanced,
        // The rendered onset-to-window-end interval includes capture/model look-ahead.
        onsetToAdvanceMs: advanced
          ? FIXTURE_ONSET_BEFORE_END_MS + defaultChordMatcherOptions.settleMs + result.processingTimeMs
          : null,
        inferenceMs: result.processingTimeMs,
        recognizedOnsets: result.onsets.map(({ midi, confidence, noteConfidence }) => ({
          midi,
          confidence,
          noteConfidence,
        })),
      });
      onProgress(index + 1, cases.length);
    }
    return summarizeListenBenchmark(trials);
  } finally {
    client.dispose();
    await audioContext.close();
  }
}
