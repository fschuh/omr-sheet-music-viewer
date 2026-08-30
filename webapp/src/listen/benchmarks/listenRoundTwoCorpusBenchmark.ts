/** Task 25's guarded capture of newly admitted discovery/regression evidence. */

import {
  listenRecognitionStructureHash,
} from "./listenBaselineParity";
import { LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST } from "./listenOmittedBassFixtures";
import {
  captureListenMultiDomainTrace,
  type ListenMultiDomainCapture,
} from "./listenMatcherSweepBenchmark";
import { withOnlineAmtBenchmarkSession } from "./listenSequenceBenchmark";
import {
  LISTEN_PRIOR_TRACE_LEDGER_HASH,
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST,
  LISTEN_TRACE_MANIFEST_HASH,
  LISTEN_TRACE_MANIFEST_VERSION,
  assertValidListenTraceManifest,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
} from "./listenTraceManifest";

export interface ListenRoundTwoCorpusCaptureRow {
  traceId: string;
  partition: "discovery" | "regression-only";
  evidenceRole: "scoring" | "safety";
  suite: string;
  musicalInputHash: string;
  renderer: string;
  piano: string | null;
  layer: string | null;
  /** Process-local diagnostic only; never a cross-process gate. */
  pcmHash: string;
  recognitionStructureHash: string;
  frameCount: number;
  expectedEventCount: number;
  independentMatchCount: number;
  orderedAdvanceCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
}

export interface ListenRoundTwoCorpusCaptureResult {
  formatVersion: 1;
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    priorLedgerHash: string;
  };
  capturedTraceCount: number;
  rows: ListenRoundTwoCorpusCaptureRow[];
  confirmation: {
    traceCount: number;
    decodedTraceCount: 0;
    status: "not-decoded-until-task-28";
    traceIds: string[];
  };
}

/**
 * Only evidence Task 25 itself needs to capture: the twelve new discovery pair
 * members and the two rendered source rows of Task 22's committed regressions.
 */
export function listenRoundTwoCorpusCaptureDescriptors(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor[] {
  const omittedBassSources = new Set(
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST.map(({ origin }) => origin.traceId),
  );
  return manifest.traces.filter((trace) => (
    (trace.suite === "round-two-paired" && trace.partition === "discovery") ||
    omittedBassSources.has(trace.id)
  ));
}

function assertCapturePermitted(descriptor: ListenTraceDescriptor): void {
  if (descriptor.partition === "confirmation" ||
      descriptor.decodeStatus === "not-decoded-until-task-28") {
    throw new Error(`confirmation-capture-forbidden:${descriptor.id}`);
  }
  if (descriptor.evidenceRole === "diagnostic") {
    throw new Error(`diagnostic-capture-not-required:${descriptor.id}`);
  }
}

function captureRow(capture: ListenMultiDomainCapture): ListenRoundTwoCorpusCaptureRow {
  const { descriptor, trace, baselineRun } = capture;
  assertCapturePermitted(descriptor);
  if (descriptor.partition !== "discovery" && descriptor.partition !== "regression-only") {
    throw new Error(`${descriptor.id} is not Task 25 capture evidence.`);
  }
  if (descriptor.evidenceRole !== "scoring" && descriptor.evidenceRole !== "safety") {
    throw new Error(`${descriptor.id} is not scoring or safety evidence.`);
  }
  const pcmHash = trace.audioSignature?.pcmHash ?? trace.audioDiagnostics.audioSignature?.pcmHash;
  if (!pcmHash) throw new Error(`${descriptor.id} has no rendered PCM signature.`);
  const structureHash = listenRecognitionStructureHash(trace);
  if (structureHash !== capture.recognitionStructureHash) {
    throw new Error(`${descriptor.id} changed decoded structure after capture.`);
  }
  return {
    traceId: descriptor.id,
    partition: descriptor.partition,
    evidenceRole: descriptor.evidenceRole,
    suite: descriptor.suite,
    musicalInputHash: descriptor.musicalInputHash,
    renderer: trace.renderer.version,
    piano: descriptor.piano,
    layer: descriptor.layer,
    pcmHash,
    recognitionStructureHash: structureHash,
    frameCount: trace.frames.length,
    expectedEventCount: baselineRun.summary.expectedEventCount,
    independentMatchCount: baselineRun.summary.independentMatchCount,
    orderedAdvanceCount: baselineRun.summary.orderedAdvanceCount,
    falseAdvanceCount: baselineRun.summary.falseAdvanceCount,
    skippedAdvanceCount: baselineRun.summary.skippedAdvanceCount,
    duplicateAdvanceCount: baselineRun.summary.duplicateAdvanceCount,
  };
}

export async function evaluateListenRoundTwoCorpusCapture(options: {
  capture: (descriptor: ListenTraceDescriptor) => Promise<ListenMultiDomainCapture>;
  manifest?: ListenTraceManifest;
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenRoundTwoCorpusCaptureResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const descriptors = listenRoundTwoCorpusCaptureDescriptors(manifest);
  const confirmation = manifest.traces.filter(({ partition }) => partition === "confirmation");
  const rows: ListenRoundTwoCorpusCaptureRow[] = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    assertCapturePermitted(descriptor);
    options.onProgress?.(index, descriptors.length, descriptor.id);
    const capture = await options.capture(descriptor);
    if (capture.descriptor.id !== descriptor.id) {
      throw new Error(`Capturing ${descriptor.id} returned ${capture.descriptor.id}.`);
    }
    rows.push(captureRow(capture));
    options.onProgress?.(index + 1, descriptors.length, descriptor.id);
  }
  return {
    formatVersion: 1,
    manifest: {
      version: LISTEN_TRACE_MANIFEST_VERSION,
      hash: LISTEN_TRACE_MANIFEST_HASH,
      corpusHash: LISTEN_TRACE_CORPUS_HASH,
      priorLedgerHash: LISTEN_PRIOR_TRACE_LEDGER_HASH,
    },
    capturedTraceCount: rows.length,
    rows,
    confirmation: {
      traceCount: confirmation.length,
      decodedTraceCount: 0,
      status: "not-decoded-until-task-28",
      traceIds: confirmation.map(({ id }) => id),
    },
  };
}

export function runListenRoundTwoCorpusCapture(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
): Promise<ListenRoundTwoCorpusCaptureResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenRoundTwoCorpusCapture({
    capture: (descriptor) => captureListenMultiDomainTrace(descriptor, session),
    onProgress,
  }));
}
