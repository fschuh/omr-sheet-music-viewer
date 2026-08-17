import assert from "node:assert/strict";
import test from "node:test";
import {
  courseClearConstantLayerCases,
  courseClearMixedLayerAssignments,
  summarizeCourseClearDynamicsRuns,
  type CourseClearDynamicsRunResult,
} from "./listenDynamicsBenchmark";
import { LISTEN_BENCHMARK_RENDERER } from "./listenBenchmarkAudio";
import type { ListenSequenceRunResult, ListenSequenceRunSummary } from "./listenSequenceBenchmark";

function summary(update: Partial<ListenSequenceRunSummary>): ListenSequenceRunSummary {
  return {
    complete: false, rawCompleteEvidenceCount: 0, rawCompleteEvidenceRate: 0,
    thresholdQualifiedEventCount: 0, thresholdQualifiedEventRate: 0,
    independentMatchCount: 0, independentMatchRate: 0, orderedAdvanceCount: 0,
    orderedAdvanceRate: 0, recognizedButBlockedCount: 0, cascadeLossCount: 0,
    blockedEventPositions: [], firstCausalStallIndex: null, correctAdvanceCount: 0,
    expectedEventCount: 27, correctAdvanceRate: 0, orderedPrefixCompleted: 0,
    firstStallIndex: 0, missedCount: 27, duplicateAdvanceCount: 0,
    skippedAdvanceCount: 0, falseAdvanceCount: 0, lateAdvanceCount: 0,
    p50OnsetToAdvanceMs: null,
    p95OnsetToAdvanceMs: null, p50IndependentMatchLatencyMs: null,
    p95IndependentMatchLatencyMs: null, p50OrderedAdvanceLatencyMs: null,
    p95OrderedAdvanceLatencyMs: null, reasonCounts: {}, maximumInferenceMs: 0,
    maximumProcessingBacklogMs: 0, nextAttackBeforeAdvanceCount: 0,
    ...update,
  };
}

function run(layer: "pp" | "mp", update: Partial<ListenSequenceRunSummary>): CourseClearDynamicsRunResult {
  return {
    renderer: { ...LISTEN_BENCHMARK_RENDERER }, piano: "splendid",
    pianoName: "Splendid Grand Piano", layer, dynamicProfile: "constant",
    attackLayers: Array.from({ length: 27 }, () => layer), sampleLibraryVersion: "test",
    peak: layer === "pp" ? 0.2 : 0.4, rms: layer === "pp" ? 0.05 : 0.1,
    pcmSignature: {
      sampleRate: 16_000, chunkSize: 512, frameCount: 512, pcmByteLength: 2_048,
      pcmHash: layer, chunkHashes: [layer],
    },
    traceIdentity: { pcmHash: layer, recognitionHash: layer, frameCount: 1 },
    recognition: { events: [], summary: summary(update) } as unknown as ListenSequenceRunResult,
  };
}

test("creates 20 constant-layer cases and complete 27-attack mixed profiles", () => {
  const cases = courseClearConstantLayerCases();
  assert.equal(cases.length, 20);
  assert.equal(cases.filter(({ piano }) => piano === "splendid").length, 4);
  assert.equal(cases.filter(({ piano }) => piano === "salamander").length, 16);
  const splendid = courseClearMixedLayerAssignments("splendid");
  assert.equal(splendid.length, 27);
  assert.equal(splendid[0], "pp");
  assert.equal(splendid[13], "ff");
  assert.equal(splendid.at(-1), "pp");

  const salamander = courseClearMixedLayerAssignments("salamander");
  assert.equal(salamander.length, 27);
  assert.deepEqual(
    salamander.slice(0, 16),
    cases.filter(({ piano }) => piano === "salamander").map(({ layer }) => layer),
  );
  assert.equal(salamander[15], "v16");
  assert.equal(salamander.at(-1), "v01");
});

test("summarizes safety, completion, levels, and the worst layer explicitly", () => {
  const result = summarizeCourseClearDynamicsRuns([
    run("pp", {
      orderedAdvanceCount: 20, orderedAdvanceRate: 20 / 27,
      independentMatchCount: 22, independentMatchRate: 22 / 27,
      missedCount: 7, falseAdvanceCount: 1,
    }),
    run("mp", {
      complete: true, orderedAdvanceCount: 27, orderedAdvanceRate: 1,
      independentMatchCount: 27, independentMatchRate: 1, missedCount: 0,
      firstStallIndex: null,
    }),
  ]);
  assert.equal(result.physicalAttackCount, 54);
  assert.equal(result.orderedAdvanceCount, 47);
  assert.equal(result.independentMatchCount, 49);
  assert.equal(result.completePassageCount, 1);
  assert.equal(result.falseAdvanceCount, 1);
  assert.equal(result.worstPerformingLayer, "pp");
  assert.equal(result.peak, 0.4);
  assert.ok(Math.abs(result.rms - 0.075) < 1e-12);
});
