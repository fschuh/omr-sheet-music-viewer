import {
  OnlineAmtSession,
  type WasmGraphOptimizationLevel,
} from "./onlineAmtSession";

interface FixtureMetadata {
  frames: number;
  chunkSize: number;
  pitches: number;
  states: number;
}

interface LatencySummary {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

declare global {
  interface Window {
    onlineAmtBenchmarkResult?: unknown;
  }
}

function booleanParameter(
  parameters: URLSearchParams,
  name: string,
  fallback: boolean,
): boolean {
  const value = parameters.get(name);
  if (value === null) return fallback;
  return value !== "0" && value !== "false";
}

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(
    ordered.length - 1,
    Math.ceil(ordered.length * fraction) - 1,
  ));
  return ordered[index];
}

function summarize(values: readonly number[]): LatencySummary {
  return {
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
  };
}

async function fetchArrayBuffer(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function run(): Promise<void> {
  const parameters = new URLSearchParams(location.search);
  const threads = Number(parameters.get("threads") ?? "1");
  const graphOptimizationLevel = (
    parameters.get("graph") ?? "all"
  ) as WasmGraphOptimizationLevel;
  const enableCpuMemArena = booleanParameter(parameters, "arena", true);
  const enableMemPattern = booleanParameter(parameters, "pattern", true);
  const executionMode = parameters.get("mode") === "parallel"
    ? "parallel"
    : "sequential";
  const requestedFrames = Number(parameters.get("frames") ?? "0");
  if (!Number.isInteger(threads) || threads < 1) {
    throw new Error("threads must be a positive integer");
  }

  const fixtureRoot = "/models/online_amt_fixture";
  const [metadataResponse, audioBuffer, scoreBuffer, activeBuffer, stateBuffer] =
    await Promise.all([
      fetch(`${fixtureRoot}/metadata.json`),
      fetchArrayBuffer(`${fixtureRoot}/audio.f32`),
      fetchArrayBuffer(`${fixtureRoot}/scores.f32`),
      fetchArrayBuffer(`${fixtureRoot}/signal-active.u8`),
      fetchArrayBuffer(`${fixtureRoot}/states.u8`),
    ]);
  if (!metadataResponse.ok) {
    throw new Error(`metadata: HTTP ${metadataResponse.status}`);
  }
  const metadata = await metadataResponse.json() as FixtureMetadata;
  const benchmarkFrames = Number.isInteger(requestedFrames) && requestedFrames > 0
    ? Math.min(requestedFrames, metadata.frames)
    : metadata.frames;
  const audio = new Float32Array(audioBuffer);
  const expectedScores = new Float32Array(scoreBuffer);
  const expectedActive = new Uint8Array(activeBuffer);
  const expectedStates = new Uint8Array(stateBuffer);

  const loadStartedAt = performance.now();
  const session = await OnlineAmtSession.create({
    modelUrl: "/models/online_amt_streaming.onnx",
    numThreads: threads,
    graphOptimizationLevel,
    enableCpuMemArena,
    enableMemPattern,
    executionMode,
  });
  const loadTimeMs = performance.now() - loadStartedAt;

  const inferenceDurations: number[] = [];
  const wallDurations: number[] = [];
  let maxAbsoluteScoreError = 0;
  let stateMismatches = 0;
  let signalActiveMismatches = 0;
  for (let frame = 0; frame < benchmarkFrames; frame += 1) {
    if (frame % 5 === 0) {
      document.querySelector("#status")!.textContent =
        `Running frame ${frame + 1} of ${benchmarkFrames}…`;
    }
    const chunkStart = frame * metadata.chunkSize;
    const chunk = audio.slice(chunkStart, chunkStart + metadata.chunkSize);
    const wallStartedAt = performance.now();
    const output = await session.run(chunk);
    wallDurations.push(performance.now() - wallStartedAt);
    inferenceDurations.push(output.inferenceTimeMs);

    const scoreStart = frame * metadata.pitches * metadata.states;
    for (let index = 0; index < output.scores.length; index += 1) {
      maxAbsoluteScoreError = Math.max(
        maxAbsoluteScoreError,
        Math.abs(output.scores[index] - expectedScores[scoreStart + index]),
      );
    }
    const stateStart = frame * metadata.pitches;
    for (let pitch = 0; pitch < metadata.pitches; pitch += 1) {
      if (output.states[pitch] !== expectedStates[stateStart + pitch]) {
        stateMismatches += 1;
      }
    }
    if (output.signalActive !== (expectedActive[frame] !== 0)) {
      signalActiveMismatches += 1;
    }
  }
  await session.dispose();

  const warmupFrames = Math.min(20, Math.floor(benchmarkFrames / 5));
  const result = {
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated,
    },
    configuration: {
      threads,
      graphOptimizationLevel,
      enableCpuMemArena,
      enableMemPattern,
      executionMode,
    },
    fixtureFrames: benchmarkFrames,
    loadTimeMs,
    parity: {
      maxAbsoluteScoreError,
      stateMismatches,
      signalActiveMismatches,
    },
    inference: summarize(inferenceDurations.slice(warmupFrames)),
    wall: summarize(wallDurations.slice(warmupFrames)),
    keepsUpWith32MsCadence: percentile(
      wallDurations.slice(warmupFrames),
      0.99,
    ) < 32,
  };
  window.onlineAmtBenchmarkResult = result;
  document.querySelector("#result")!.textContent = JSON.stringify(result, null, 2);
  document.querySelector("#status")!.textContent = "Benchmark complete.";
  document.body.dataset.status = "complete";
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  document.querySelector("#status")!.textContent = "Benchmark failed.";
  document.querySelector("#result")!.textContent = message;
  document.body.dataset.status = "error";
});
