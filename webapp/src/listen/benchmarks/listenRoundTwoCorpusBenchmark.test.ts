import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { listenRecognitionStructureHash } from "./listenBaselineParity";
import {
  listenMultiDomainSafetyPopulations,
  type ListenMultiDomainCapture,
} from "./listenMatcherSweepBenchmark";
import {
  evaluateListenRoundTwoCorpusCapture,
  listenRoundTwoCorpusCaptureDescriptors,
  type ListenRoundTwoCorpusCaptureResult,
} from "./listenRoundTwoCorpusBenchmark";
import {
  LISTEN_TRACE_MANIFEST,
  listenTracesInPartition,
  type ListenTraceDescriptor,
} from "./listenTraceManifest";

function mockCapture(descriptor: ListenTraceDescriptor): ListenMultiDomainCapture {
  const trace = {
    sequenceId: descriptor.id,
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [],
    renderer: { version: descriptor.renderer },
    audioSignature: { pcmHash: `pcm-${descriptor.id}` },
    audioDiagnostics: {},
    frames: [],
  };
  return {
    descriptor,
    sequence: {},
    trace,
    recognitionHash: `trace-${descriptor.id}`,
    recognitionStructureHash: listenRecognitionStructureHash(trace as never),
    baselineRun: {
      summary: {
        expectedEventCount: descriptor.caseKind === "correct" ? 1 : 0,
        independentMatchCount: 0,
        orderedAdvanceCount: 0,
        falseAdvanceCount: 0,
        skippedAdvanceCount: 0,
        duplicateAdvanceCount: 0,
      },
    },
  } as unknown as ListenMultiDomainCapture;
}

test("captures only new discovery pairs and Task 22 rendered source traces", () => {
  const descriptors = listenRoundTwoCorpusCaptureDescriptors();
  assert.equal(descriptors.length, 14);
  assert.equal(descriptors.filter(({ suite }) => suite === "round-two-paired").length, 12);
  assert.deepEqual(
    descriptors.filter(({ suite }) => suite === "isolated").map(({ id }) => id).sort(),
    ["isolated/direct/122", "isolated/tone/124"],
  );
  assert.ok(descriptors.every(({ partition }) => partition !== "confirmation"));
  assert.ok(descriptors.every(({ evidenceRole }) => evidenceRole !== "diagnostic"));
});

test("the Task 25 capture path never reads a confirmation definition", async () => {
  const captured: string[] = [];
  const result = await evaluateListenRoundTwoCorpusCapture({
    capture: async (descriptor) => {
      captured.push(descriptor.id);
      return mockCapture(descriptor);
    },
  });
  const confirmationIds = new Set(listenTracesInPartition("confirmation").map(({ id }) => id));
  assert.ok(captured.every((id) => !confirmationIds.has(id)));
  assert.equal(result.capturedTraceCount, 14);
  assert.equal(result.confirmation.traceCount, 12);
  assert.equal(result.confirmation.decodedTraceCount, 0);
  assert.equal(result.confirmation.status, "not-decoded-until-task-28");
  assert.deepEqual(new Set(result.confirmation.traceIds), confirmationIds);
});

test("capture rejects a callback that substitutes confirmation evidence", async () => {
  const confirmation = LISTEN_TRACE_MANIFEST.traces.find(({ partition }) => (
    partition === "confirmation"
  ));
  assert.ok(confirmation);
  await assert.rejects(
    evaluateListenRoundTwoCorpusCapture({
      capture: async () => mockCapture(confirmation),
    }),
    /returned/,
  );
});

test("the two fresh-browser archives freeze identical decoded structure without confirmation", async () => {
  const readArchive = async (name: string) => JSON.parse(await readFile(
    new URL(`../../benchmark-results/${name}`, import.meta.url),
    "utf8",
  )) as Array<{ name: string } & ListenRoundTwoCorpusCaptureResult>;
  const [firstArchive, secondArchive] = await Promise.all([
    readArchive("listen-round-two-corpus-task25-run1.json"),
    readArchive("listen-round-two-corpus-task25-run2.json"),
  ]);
  assert.equal(firstArchive.length, 1);
  assert.equal(secondArchive.length, 1);
  const first = firstArchive[0];
  const second = secondArchive[0];
  assert.equal(first.name, "listen-round-two-corpus");
  assert.equal(second.name, first.name);
  assert.equal(first.capturedTraceCount, 14);
  assert.equal(second.capturedTraceCount, first.capturedTraceCount);
  assert.deepEqual(second.manifest, first.manifest);
  assert.deepEqual(second.confirmation, first.confirmation);
  assert.equal(first.confirmation.decodedTraceCount, 0);
  assert.equal(second.confirmation.decodedTraceCount, 0);
  const stableRows = (result: ListenRoundTwoCorpusCaptureResult) => result.rows.map((row) => {
    const { pcmHash: _processLocalPcmHash, ...stable } = row;
    return stable;
  });
  assert.deepEqual(stableRows(second), stableRows(first));
  assert.ok(first.rows.every(({ recognitionStructureHash }) => recognitionStructureHash.length > 0));
  assert.ok(second.rows.every(({ recognitionStructureHash }) => recognitionStructureHash.length > 0));
  const baselineFalseAdvances = first.rows.filter(({ falseAdvanceCount }) => (
    falseAdvanceCount > 0
  )).map(({ traceId, falseAdvanceCount }) => ({ traceId, falseAdvanceCount }));
  assert.deepEqual(baselineFalseAdvances, [
    {
      traceId: "round-two/r2-repeated-low-triad-direct-splendid-pp/distinguishable-wrong",
      falseAdvanceCount: 1,
    },
    {
      traceId: "round-two/r2-paired-high-tetrad-tone-splendid-ff/distinguishable-wrong",
      falseAdvanceCount: 1,
    },
  ]);
  const populations = listenMultiDomainSafetyPopulations();
  const baselineRelative = new Set(populations.baselineRelativeSafetyTraceIds);
  const absolute = new Set([
    ...populations.dedicatedSafetyTraceIds,
    ...populations.regressionRunTraceIds,
  ]);
  assert.ok(baselineFalseAdvances.every(({ traceId }) => baselineRelative.has(traceId)));
  assert.ok(baselineFalseAdvances.every(({ traceId }) => !absolute.has(traceId)));
});
