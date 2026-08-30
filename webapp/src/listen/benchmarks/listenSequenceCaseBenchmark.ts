/**
 * Reproduction of one continuous-sequence run in isolation.
 *
 * The sequence corpus renders 13 passages at six speeds under two renderers. A
 * safety event in one of those 78 runs cannot be investigated by rerunning all
 * of them, so this module renders exactly one passage, replays it under
 * `baseline-v1`, and prints the complete forensic record of every advancement
 * the run counted against a safety gate.
 *
 * It is the sequence counterpart of the constant-layer dynamics case, and it
 * exists as its own module because capture needs both the sequence benchmark and
 * the safety-regression forensics, which the sequence benchmark cannot import.
 */

import {
  LISTEN_BENCHMARK_PIANO,
  LISTEN_BENCHMARK_RENDERER,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import {
  LISTEN_BASELINE_PROFILE,
  listenBaselineProfileMetadata,
  listenRecognitionStructureHash,
  listenTraceIdentity,
  type ListenBaselineProfileMetadata,
  type ListenTraceIdentity,
} from "./listenBaselineParity";
import {
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  captureListenSequenceRun,
  courseClearArticulationDefinitions,
  withOnlineAmtBenchmarkSession,
  type ListenSequenceDefinition,
  type ListenSequenceRunResult,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import {
  assertFocusedCaseMatchesRegressions,
  buildListenSafetyRegressionFixture,
  diagnoseListenSequenceSafety,
  summarizeListenSafetyRegressions,
  type ListenAdvanceForensics,
  type ListenFocusedCaseVerification,
  type ListenSafetyRegressionFixture,
  type ListenSafetyRegressionSummary,
} from "./listenSafetyRegression";

/** Largest difference that still identifies a requested interval as a corpus speed. */
const INTERVAL_TOLERANCE_MS = 0.5;

/**
 * The sequence corpus renders one fixed piano and velocity layer. A committed
 * fixture records both, so a later run of a different piano is not mistaken for
 * a failed reproduction of this one.
 */
const SEQUENCE_CASE_PIANO = LISTEN_BENCHMARK_PIANO.id;
const SEQUENCE_CASE_LAYER = LISTEN_BENCHMARK_PIANO.layer ?? "none";

/** Every passage a focused case can reproduce, corpus and articulation alike. */
export function listenSequenceCaseDefinitions(): ListenSequenceDefinition[] {
  return [...bundledListenSequences(), ...courseClearArticulationDefinitions()];
}

export function listenSequenceCaseDefinition(sequenceId: string): ListenSequenceDefinition {
  const definitions = listenSequenceCaseDefinitions();
  const definition = definitions.find(({ id }) => id === sequenceId);
  if (!definition) {
    throw new Error(
      `Unknown sequence ${sequenceId}. Available: ${definitions.map(({ id }) => id).join(", ")}.`,
    );
  }
  return definition;
}

/**
 * Resolves a requested speed to the exact corpus interval. `1000 / 3` cannot be
 * typed on a command line, and rendering at 333 ms instead would silently
 * produce a different passage from the one being reproduced.
 */
export function listenSequenceCaseInterval(requestedMs: number): number {
  if (!Number.isFinite(requestedMs)) {
    throw new Error(`Sequence interval ${requestedMs} is not a finite number of milliseconds.`);
  }
  const interval = LISTEN_SEQUENCE_INTERVALS_MS.find((candidate) => (
    Math.abs(candidate - requestedMs) <= INTERVAL_TOLERANCE_MS
  ));
  if (interval === undefined) {
    throw new Error(
      `Interval ${requestedMs} ms is not a corpus speed. ` +
      `Available: ${LISTEN_SEQUENCE_INTERVALS_MS.map((value) => value.toFixed(2)).join(", ")}.`,
    );
  }
  return interval;
}

/**
 * One sequence run plus forensics for every advancement it counted as unsafe.
 * Mirrors the constant-layer dynamics case so both investigations produce the
 * same evidence in the same shape.
 */
export interface ListenSequenceCaseResult {
  suite: "focused-sequence-case";
  baseline: ListenBaselineProfileMetadata;
  renderer: ListenBenchmarkRendererConfiguration;
  sequenceId: string;
  family: string;
  label: string;
  intervalMs: number;
  piano: string;
  layer: string;
  run: ListenSequenceRunResult;
  traceIdentity: ListenTraceIdentity;
  /**
   * Structural identity of the decoded stream. The FNV PCM hash inside the trace
   * identity is only an identity within one browser process; this hash does
   * survive across processes.
   */
  recognitionStructureHash: string;
  forensics: ListenAdvanceForensics[];
  /** Ready-to-commit regressions, one per advancement counted against a gate. */
  fixtures: ListenSafetyRegressionFixture[];
  /** Already-committed regressions, replayed against all three named profiles. */
  regressions: ListenSafetyRegressionSummary;
  /**
   * Committed fixtures cut from this exact renderer and passage, re-verified
   * against this capture. Empty when the run is not a committed case.
   */
  verifications: ListenFocusedCaseVerification[];
}

export interface CaptureListenSequenceCaseOptions {
  session: SequenceInferenceSession;
  sequenceId: string;
  intervalMs: number;
  renderer?: ListenBenchmarkRendererConfiguration;
  onProgress?: (completed: number, total: number, label: string) => void;
}

export async function captureListenSequenceCase(
  options: CaptureListenSequenceCaseOptions,
): Promise<ListenSequenceCaseResult> {
  const definition = listenSequenceCaseDefinition(options.sequenceId);
  const intervalMs = listenSequenceCaseInterval(options.intervalMs);
  const renderer = options.renderer ?? LISTEN_BENCHMARK_RENDERER;
  const captured = await captureListenSequenceRun({
    definition,
    intervalMs,
    session: options.session,
    renderer,
  });
  const { forensics } = diagnoseListenSequenceSafety(
    captured.sequence,
    captured.trace,
    LISTEN_BASELINE_PROFILE,
  );
  const recognitionStructureHash = listenRecognitionStructureHash(captured.trace);
  const roundedIntervalMs = Math.round(intervalMs);
  const fixtures = forensics.map((forensic, index) => buildListenSafetyRegressionFixture(
    captured.sequence,
    captured.trace,
    forensic,
    {
      id: `${renderer.version}-${definition.id}-${roundedIntervalMs}ms` +
        `-target-${forensic.targetIndex}`,
      label: `${definition.label} at ${roundedIntervalMs} ms · target ${forensic.targetIndex}`,
      renderer: renderer.version,
      piano: SEQUENCE_CASE_PIANO,
      layer: SEQUENCE_CASE_LAYER,
      sourcePcmHash: captured.trace.audioSignature?.pcmHash ?? "unsigned",
      sourceRecognitionStructureHash: recognitionStructureHash,
      expectation: forensic.classification.includes("late-advance")
        ? "late-advance"
        : "reported-unsafe-advance",
      // A generated fixture carries no explanation. Replace this before
      // committing it: a regression whose reason is undocumented is a
      // fossilized behavior, not a diagnosed one.
      conclusion: `Undiagnosed: case ${index + 1} of ${forensics.length} from this run.`,
    },
  ));
  // Re-verifying here rather than in the caller means the browser command that
  // documents this case fails when the case stops reproducing, instead of
  // succeeding on frozen frames that no longer describe anything real.
  const verifications = assertFocusedCaseMatchesRegressions({
    renderer: renderer.version,
    piano: SEQUENCE_CASE_PIANO,
    layer: SEQUENCE_CASE_LAYER,
    sequenceId: definition.id,
    intervalMs,
    recognitionStructureHash,
    forensics,
  });
  options.onProgress?.(1, 1, `${definition.label} at ${roundedIntervalMs} ms`);
  return {
    suite: "focused-sequence-case",
    baseline: listenBaselineProfileMetadata(),
    renderer: { ...renderer },
    sequenceId: definition.id,
    family: definition.family,
    label: definition.label,
    intervalMs,
    piano: SEQUENCE_CASE_PIANO,
    layer: SEQUENCE_CASE_LAYER,
    run: captured.run,
    traceIdentity: listenTraceIdentity(captured.trace),
    recognitionStructureHash,
    forensics,
    fixtures,
    regressions: summarizeListenSafetyRegressions(),
    verifications,
  };
}

export function runListenSequenceCase(
  sequenceId: string,
  intervalMs: number,
  onProgress: CaptureListenSequenceCaseOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<ListenSequenceCaseResult> {
  return withOnlineAmtBenchmarkSession((session) => captureListenSequenceCase({
    session,
    sequenceId,
    intervalMs,
    renderer,
    onProgress,
  }));
}

/**
 * The exported record of a focused case: identity, the run's own summary, and
 * every forensic detail, without the decoded frames of the runs that are not
 * under investigation.
 */
export function conciseListenSequenceCaseResult(result: ListenSequenceCaseResult) {
  return {
    suite: result.suite,
    baseline: result.baseline,
    renderer: result.renderer,
    piano: result.piano,
    layer: result.layer,
    sequenceId: result.sequenceId,
    family: result.family,
    label: result.label,
    intervalMs: result.intervalMs,
    traceIdentity: result.traceIdentity,
    recognitionStructureHash: result.recognitionStructureHash,
    audioDiagnostics: {
      frameCount: result.run.trace.audioDiagnostics.frameCount,
      durationMs: result.run.trace.audioDiagnostics.durationMs,
      peak: result.run.trace.audioDiagnostics.peak,
      rms: result.run.trace.audioDiagnostics.rms,
    },
    summary: result.run.summary,
    forensics: result.forensics,
    fixtures: result.fixtures,
    regressions: result.regressions,
    verifications: result.verifications,
  };
}
