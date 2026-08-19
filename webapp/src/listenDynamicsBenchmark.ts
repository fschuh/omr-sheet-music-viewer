import {
  LISTEN_BENCHMARK_RENDERER,
  renderBenchmarkAudio,
  signatureForBenchmarkPcm,
  type ListenBenchmarkAudioRenderResult,
  type ListenBenchmarkAudioSignature,
  type ListenBenchmarkDynamicProfile,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  benchmarkAudioAttacksForSequence,
  captureListenSequenceTrace,
  courseClearArticulationDefinitions,
  materializeListenSequence,
  replayListenSequenceTrace,
  withOnlineAmtBenchmarkSession,
  type ListenSequenceRunResult,
  type ListenSequenceRunSummary,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import {
  LISTEN_BASELINE_PROFILE,
  assertListenSequenceRunParity,
  assertRecognitionTraceUnmutated,
  assertRenderedTraceAudioIdentity,
  listenBaselineProfileMetadata,
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
  listenTraceIdentity,
  type ListenBaselineProfileMetadata,
  type ListenTraceIdentity,
} from "./listenBaselineParity";
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
import {
  PIANO_IDS,
  crescendoDecrescendoLayers,
  pianoDefinition,
  type PianoId,
  type PianoLayerId,
} from "./pianoRegistry";

export const COURSE_CLEAR_DYNAMICS_INTERVAL_MS = COURSE_CLEAR_ARTICULATION_INTERVAL_MS;

export interface CourseClearDynamicsRunResult {
  renderer: ListenBenchmarkRendererConfiguration;
  piano: PianoId;
  pianoName: string;
  layer: PianoLayerId | null;
  dynamicProfile: ListenBenchmarkDynamicProfile;
  attackLayers: PianoLayerId[];
  sampleLibraryVersion: string;
  peak: number;
  rms: number;
  pcmSignature: ListenBenchmarkAudioSignature;
  traceIdentity: ListenTraceIdentity;
  recognition: ListenSequenceRunResult;
}

export interface CourseClearDynamicsSummary {
  runCount: number;
  physicalAttackCount: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  independentMatchCount: number;
  independentMatchRate: number;
  completePassageCount: number;
  completePassageRate: number;
  missedCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  /** Correct-content advances credited to a later repetition of the same chord. */
  lateAdvanceCount: number;
  p95IndependentMatchLatencyMs: number | null;
  p95OrderedAdvanceLatencyMs: number | null;
  peak: number;
  rms: number;
  worstPerformingLayer: PianoLayerId | null;
}

export interface CourseClearPianoDynamicsSummary extends CourseClearDynamicsSummary {
  piano: PianoId;
  pianoName: string;
}

export interface CourseClearDynamicsSuiteResult {
  suite: "constant-layer";
  baseline: ListenBaselineProfileMetadata;
  renderer: ListenBenchmarkRendererConfiguration;
  runs: CourseClearDynamicsRunResult[];
  pianos: CourseClearPianoDynamicsSummary[];
  /** Mean of the per-piano rates, so Splendid and Salamander have equal weight. */
  crossPiano: CourseClearDynamicsSummary;
}

export interface CourseClearMixedDynamicsSuiteResult {
  suite: "crescendo-decrescendo";
  baseline: ListenBaselineProfileMetadata;
  renderer: ListenBenchmarkRendererConfiguration;
  runs: CourseClearDynamicsRunResult[];
  crossPiano: CourseClearDynamicsSummary;
}

export interface CaptureCourseClearDynamicsOptions {
  session: SequenceInferenceSession;
  renderer?: ListenBenchmarkRendererConfiguration;
  render?: (
    sequence: MaterializedListenSequence,
    piano: PianoId,
    attackLayers: readonly PianoLayerId[],
    profile: ListenBenchmarkDynamicProfile,
  ) => Promise<ListenBenchmarkAudioRenderResult>;
  onProgress?: (completed: number, total: number, label: string) => void;
}

function courseClearSequence(): MaterializedListenSequence {
  const normal = courseClearArticulationDefinitions().find(
    ({ articulation }) => articulation === "normal",
  );
  if (!normal) throw new Error("The canonical normal Course Clear passage is unavailable.");
  return materializeListenSequence(normal, COURSE_CLEAR_DYNAMICS_INTERVAL_MS);
}

export function courseClearConstantLayerCases(): Array<{
  piano: PianoId;
  layer: PianoLayerId;
}> {
  return PIANO_IDS.flatMap((piano) => (
    pianoDefinition(piano).benchmarkLayers.map((layer) => ({ piano, layer }))
  ));
}

export function courseClearMixedLayerAssignments(
  piano: PianoId,
  attackCount = 27,
): PianoLayerId[] {
  return crescendoDecrescendoLayers(piano, attackCount);
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function latencyValues(
  runs: readonly CourseClearDynamicsRunResult[],
  field: "independentMatchLatencyMs" | "orderedAdvanceLatencyMs",
): number[] {
  return runs.flatMap(({ recognition }) => recognition.events.flatMap((event) => (
    event[field] === null ? [] : [event[field]]
  )));
}

function worstLayer(runs: readonly CourseClearDynamicsRunResult[]): PianoLayerId | null {
  const constant = runs.filter((run) => run.layer !== null);
  if (constant.length === 0) return null;
  return [...constant].sort((left, right) => (
    left.recognition.summary.orderedAdvanceRate - right.recognition.summary.orderedAdvanceRate ||
    left.recognition.summary.independentMatchRate - right.recognition.summary.independentMatchRate ||
    right.recognition.summary.missedCount - left.recognition.summary.missedCount ||
    left.layer!.localeCompare(right.layer!)
  ))[0].layer;
}

export function summarizeCourseClearDynamicsRuns(
  runs: readonly CourseClearDynamicsRunResult[],
): CourseClearDynamicsSummary {
  const physicalAttackCount = runs.reduce(
    (total, run) => total + run.recognition.summary.expectedEventCount,
    0,
  );
  const orderedAdvanceCount = runs.reduce(
    (total, run) => total + run.recognition.summary.orderedAdvanceCount,
    0,
  );
  const independentMatchCount = runs.reduce(
    (total, run) => total + run.recognition.summary.independentMatchCount,
    0,
  );
  return {
    runCount: runs.length,
    physicalAttackCount,
    orderedAdvanceCount,
    orderedAdvanceRate: physicalAttackCount === 0 ? 0 : orderedAdvanceCount / physicalAttackCount,
    independentMatchCount,
    independentMatchRate: physicalAttackCount === 0 ? 0 : independentMatchCount / physicalAttackCount,
    completePassageCount: runs.filter(({ recognition }) => recognition.summary.complete).length,
    completePassageRate: runs.length === 0
      ? 0
      : runs.filter(({ recognition }) => recognition.summary.complete).length / runs.length,
    missedCount: runs.reduce((total, run) => total + run.recognition.summary.missedCount, 0),
    falseAdvanceCount: runs.reduce(
      (total, run) => total + run.recognition.summary.falseAdvanceCount,
      0,
    ),
    skippedAdvanceCount: runs.reduce(
      (total, run) => total + run.recognition.summary.skippedAdvanceCount,
      0,
    ),
    duplicateAdvanceCount: runs.reduce(
      (total, run) => total + run.recognition.summary.duplicateAdvanceCount,
      0,
    ),
    lateAdvanceCount: runs.reduce(
      (total, run) => total + run.recognition.summary.lateAdvanceCount,
      0,
    ),
    p95IndependentMatchLatencyMs: percentile(latencyValues(runs, "independentMatchLatencyMs"), 0.95),
    p95OrderedAdvanceLatencyMs: percentile(latencyValues(runs, "orderedAdvanceLatencyMs"), 0.95),
    peak: Math.max(0, ...runs.map(({ peak }) => peak)),
    rms: runs.length === 0 ? 0 : runs.reduce((total, run) => total + run.rms, 0) / runs.length,
    worstPerformingLayer: worstLayer(runs),
  };
}

function equalPianoAggregate(
  pianoSummaries: readonly CourseClearPianoDynamicsSummary[],
  runs: readonly CourseClearDynamicsRunResult[],
): CourseClearDynamicsSummary {
  const totals = summarizeCourseClearDynamicsRuns(runs);
  if (pianoSummaries.length === 0) return totals;
  return {
    ...totals,
    orderedAdvanceRate: pianoSummaries.reduce(
      (total, summary) => total + summary.orderedAdvanceRate,
      0,
    ) / pianoSummaries.length,
    independentMatchRate: pianoSummaries.reduce(
      (total, summary) => total + summary.independentMatchRate,
      0,
    ) / pianoSummaries.length,
    completePassageRate: pianoSummaries.reduce(
      (total, summary) => total + summary.completePassageRate,
      0,
    ) / pianoSummaries.length,
  };
}

function validateRenderedAudio(
  rendered: ListenBenchmarkAudioRenderResult,
  piano: PianoId,
  attackLayers: readonly PianoLayerId[],
): ListenBenchmarkAudioSignature {
  if (rendered.pcm.length === 0 || rendered.pcm.some((value) => !Number.isFinite(value))) {
    throw new Error(`${piano} rendered non-finite or empty Course Clear PCM.`);
  }
  if (rendered.diagnostics.peak <= 0 || rendered.diagnostics.rms <= 0) {
    throw new Error(`${piano} rendered silent Course Clear PCM.`);
  }
  if (rendered.piano.id !== piano) {
    throw new Error(`Requested ${piano}, received ${rendered.piano.id} metadata.`);
  }
  const requestedLayers = [...new Set(attackLayers)];
  if (
    requestedLayers.length !== rendered.piano.layers.length ||
    requestedLayers.some((layer) => !rendered.piano.layers.includes(layer))
  ) {
    throw new Error(`${piano} result metadata did not identify all requested layers.`);
  }
  return signatureForBenchmarkPcm(rendered.pcm);
}

async function defaultRender(
  sequence: MaterializedListenSequence,
  piano: PianoId,
  attackLayers: readonly PianoLayerId[],
  profile: ListenBenchmarkDynamicProfile,
  renderer: ListenBenchmarkRendererConfiguration,
): Promise<ListenBenchmarkAudioRenderResult> {
  if (attackLayers.length !== sequence.attacks.length) {
    throw new Error("Every Course Clear physical attack must have exactly one acoustic layer.");
  }
  return renderBenchmarkAudio({
    attacks: benchmarkAudioAttacksForSequence(sequence).map((attack, index) => ({
      ...attack,
      layer: attackLayers[index],
    })),
    durationMs: sequence.durationMs,
    renderer,
    piano,
    layer: profile === "constant" ? attackLayers[0] : undefined,
    dynamicProfile: profile,
  });
}

async function captureRun(
  options: CaptureCourseClearDynamicsOptions,
  sequence: MaterializedListenSequence,
  piano: PianoId,
  attackLayers: PianoLayerId[],
  profile: ListenBenchmarkDynamicProfile,
): Promise<CourseClearDynamicsRunResult> {
  const renderer = options.renderer ?? LISTEN_BENCHMARK_RENDERER;
  const rendered = await (options.render
    ? options.render(sequence, piano, attackLayers, profile)
    : defaultRender(sequence, piano, attackLayers, profile, renderer));
  const pcmSignature = validateRenderedAudio(rendered, piano, attackLayers);
  const trace = await captureListenSequenceTrace({
    sequenceId: `${sequence.definition.id}-${piano}-${profile}`,
    intervalMs: sequence.intervalMs,
    audio: rendered.pcm,
    relevantPitches: sequence.relevantPitches,
    session: options.session,
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
  });
  const label = `${sequence.definition.id} ${piano} ${profile}`;
  assertRenderedTraceAudioIdentity(label, trace, pcmSignature);
  const capturedRecognitionHash = listenRecognitionTraceHash(trace);
  const recognition = replayListenSequenceTrace(sequence, trace, "current-matcher");
  assertRecognitionTraceUnmutated(`${label} current-matcher replay`, trace, capturedRecognitionHash);
  const baselineRecognition = replayListenSequenceTrace(
    sequence,
    trace,
    "current-matcher",
    LISTEN_BASELINE_PROFILE,
  );
  assertRecognitionTraceUnmutated(`${label} baseline replay`, trace, capturedRecognitionHash);
  assertListenSequenceRunParity(label, recognition, baselineRecognition);
  return {
    renderer: { ...rendered.renderer },
    piano,
    pianoName: pianoDefinition(piano).displayName,
    layer: profile === "constant" ? attackLayers[0] : null,
    dynamicProfile: profile,
    attackLayers: [...attackLayers],
    sampleLibraryVersion: pianoDefinition(piano).source.version,
    peak: rendered.diagnostics.peak,
    rms: rendered.diagnostics.rms,
    pcmSignature,
    traceIdentity: listenTraceIdentity(trace),
    recognition,
  };
}

/**
 * One constant-layer run plus forensics for every advancement it counted as
 * unsafe. Used to reproduce a single diagnosed case without rendering the other
 * 39 runs of the constant-layer matrix.
 */
export interface CourseClearDynamicsCaseResult {
  suite: "focused-case";
  baseline: ListenBaselineProfileMetadata;
  renderer: ListenBenchmarkRendererConfiguration;
  piano: PianoId;
  layer: PianoLayerId;
  run: CourseClearDynamicsRunResult;
  /**
   * Structural identity of the decoded stream. The FNV PCM hash is only an
   * identity within one browser process, because Chrome's offline rendering does
   * not reproduce its last bits; this hash does survive across runs.
   */
  recognitionStructureHash: string;
  forensics: ListenAdvanceForensics[];
  /** Ready-to-commit regressions, one per advancement counted against a gate. */
  fixtures: ListenSafetyRegressionFixture[];
  /** Already-committed regressions, replayed against all three named profiles. */
  regressions: ListenSafetyRegressionSummary;
  /**
   * Committed fixtures cut from this exact renderer, piano, layer, and passage,
   * re-verified against this capture. Empty when the run is not a committed case.
   */
  verifications: ListenFocusedCaseVerification[];
}

export async function captureCourseClearDynamicsCase(
  options: CaptureCourseClearDynamicsOptions,
  piano: PianoId,
  layer: PianoLayerId,
): Promise<CourseClearDynamicsCaseResult> {
  const sequence = courseClearSequence();
  const run = await captureRun(
    options,
    sequence,
    piano,
    Array.from({ length: sequence.attacks.length }, () => layer),
    "constant",
  );
  const { forensics } = diagnoseListenSequenceSafety(
    sequence,
    run.recognition.trace,
    LISTEN_BASELINE_PROFILE,
  );
  const recognitionStructureHash = listenRecognitionStructureHash(run.recognition.trace);
  const fixtures = forensics.map((forensic, index) => buildListenSafetyRegressionFixture(
    sequence,
    run.recognition.trace,
    forensic,
    {
      id: `${run.renderer.version}-${piano}-${layer}-target-${forensic.targetIndex}`,
      label: `${pianoDefinition(piano).displayName} ${layer} · target ${forensic.targetIndex}`,
      renderer: run.renderer.version,
      piano,
      layer,
      sourcePcmHash: run.pcmSignature.pcmHash,
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
    renderer: run.renderer.version,
    piano,
    layer,
    sequenceId: sequence.definition.id,
    intervalMs: sequence.intervalMs,
    recognitionStructureHash,
    forensics,
  });
  options.onProgress?.(1, 1, `${pianoDefinition(piano).displayName} ${layer}`);
  return {
    suite: "focused-case",
    baseline: listenBaselineProfileMetadata(),
    renderer: { ...(options.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    piano,
    layer,
    run,
    recognitionStructureHash,
    forensics,
    fixtures,
    regressions: summarizeListenSafetyRegressions(),
    verifications,
  };
}

export function runCourseClearDynamicsCase(
  piano: PianoId,
  layer: PianoLayerId,
  onProgress: CaptureCourseClearDynamicsOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<CourseClearDynamicsCaseResult> {
  return withOnlineAmtBenchmarkSession((session) => captureCourseClearDynamicsCase(
    { session, renderer, onProgress },
    piano,
    layer,
  ));
}

export async function captureCourseClearConstantLayerDynamics(
  options: CaptureCourseClearDynamicsOptions,
): Promise<CourseClearDynamicsSuiteResult> {
  const sequence = courseClearSequence();
  const cases = courseClearConstantLayerCases();
  const runs: CourseClearDynamicsRunResult[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const selected = cases[index];
    runs.push(await captureRun(
      options,
      sequence,
      selected.piano,
      Array.from({ length: sequence.attacks.length }, () => selected.layer),
      "constant",
    ));
    options.onProgress?.(
      index + 1,
      cases.length,
      `${pianoDefinition(selected.piano).displayName} ${selected.layer}`,
    );
  }
  for (const piano of PIANO_IDS) {
    const selected = runs.filter((run) => run.piano === piano);
    if (new Set(selected.map(({ pcmSignature }) => pcmSignature.pcmHash)).size !== selected.length) {
      throw new Error(`${piano} velocity layers did not produce distinct PCM signatures.`);
    }
  }
  const pianos = PIANO_IDS.map((piano): CourseClearPianoDynamicsSummary => ({
    piano,
    pianoName: pianoDefinition(piano).displayName,
    ...summarizeCourseClearDynamicsRuns(runs.filter((run) => run.piano === piano)),
  }));
  return {
    suite: "constant-layer",
    baseline: listenBaselineProfileMetadata(),
    renderer: { ...(options.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    runs,
    pianos,
    crossPiano: equalPianoAggregate(pianos, runs),
  };
}

export async function captureCourseClearMixedDynamics(
  options: CaptureCourseClearDynamicsOptions,
): Promise<CourseClearMixedDynamicsSuiteResult> {
  const sequence = courseClearSequence();
  const runs: CourseClearDynamicsRunResult[] = [];
  for (let index = 0; index < PIANO_IDS.length; index += 1) {
    const piano = PIANO_IDS[index];
    runs.push(await captureRun(
      options,
      sequence,
      piano,
      courseClearMixedLayerAssignments(piano, sequence.attacks.length),
      "crescendo-decrescendo",
    ));
    options.onProgress?.(
      index + 1,
      PIANO_IDS.length,
      `${pianoDefinition(piano).displayName} crescendo-decrescendo`,
    );
  }
  const pianos = runs.map((run): CourseClearPianoDynamicsSummary => ({
    piano: run.piano,
    pianoName: run.pianoName,
    ...summarizeCourseClearDynamicsRuns([run]),
  }));
  return {
    suite: "crescendo-decrescendo",
    baseline: listenBaselineProfileMetadata(),
    renderer: { ...(options.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    runs,
    crossPiano: equalPianoAggregate(pianos, runs),
  };
}

export function runCourseClearConstantLayerDynamics(
  onProgress: CaptureCourseClearDynamicsOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<CourseClearDynamicsSuiteResult> {
  return withOnlineAmtBenchmarkSession((session) => captureCourseClearConstantLayerDynamics({
    session,
    renderer,
    onProgress,
  }));
}

export function runCourseClearMixedDynamics(
  onProgress: CaptureCourseClearDynamicsOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<CourseClearMixedDynamicsSuiteResult> {
  return withOnlineAmtBenchmarkSession((session) => captureCourseClearMixedDynamics({
    session,
    renderer,
    onProgress,
  }));
}

export function conciseCourseClearDynamicsResult(
  result: CourseClearDynamicsSuiteResult | CourseClearMixedDynamicsSuiteResult,
): unknown {
  return {
    suite: result.suite,
    renderer: result.renderer,
    runs: result.runs.map((run) => ({
      renderer: run.renderer,
      piano: run.piano,
      pianoName: run.pianoName,
      layer: run.layer,
      dynamicProfile: run.dynamicProfile,
      ...(run.dynamicProfile === "crescendo-decrescendo"
        ? { attackLayers: run.attackLayers }
        : {}),
      sampleLibraryVersion: run.sampleLibraryVersion,
      peak: run.peak,
      rms: run.rms,
      pcmSignature: {
        sampleRate: run.pcmSignature.sampleRate,
        frameCount: run.pcmSignature.frameCount,
        pcmByteLength: run.pcmSignature.pcmByteLength,
        chunkSize: run.pcmSignature.chunkSize,
        pcmHash: run.pcmSignature.pcmHash,
      },
      summary: {
        complete: run.recognition.summary.complete,
        independentMatchCount: run.recognition.summary.independentMatchCount,
        independentMatchRate: run.recognition.summary.independentMatchRate,
        orderedAdvanceCount: run.recognition.summary.orderedAdvanceCount,
        orderedAdvanceRate: run.recognition.summary.orderedAdvanceRate,
        missedCount: run.recognition.summary.missedCount,
        falseAdvanceCount: run.recognition.summary.falseAdvanceCount,
        skippedAdvanceCount: run.recognition.summary.skippedAdvanceCount,
        duplicateAdvanceCount: run.recognition.summary.duplicateAdvanceCount,
        lateAdvanceCount: run.recognition.summary.lateAdvanceCount,
        firstStallIndex: run.recognition.summary.firstStallIndex,
        p95IndependentMatchLatencyMs:
          run.recognition.summary.p95IndependentMatchLatencyMs,
        p95OrderedAdvanceLatencyMs: run.recognition.summary.p95OrderedAdvanceLatencyMs,
      },
    })),
    ...(result.suite === "constant-layer" ? { pianos: result.pianos } : {}),
    crossPiano: result.crossPiano,
    safety: {
      falseAdvanceCount: result.crossPiano.falseAdvanceCount,
      skippedAdvanceCount: result.crossPiano.skippedAdvanceCount,
      duplicateAdvanceCount: result.crossPiano.duplicateAdvanceCount,
      lateAdvanceCount: result.crossPiano.lateAdvanceCount,
      carriedBassMatcherConfigurationChanged: false,
    },
  };
}

/**
 * Machine-readable focused-case export. It carries the run identity the report
 * cites plus the complete forensic record of each unsafe advancement.
 */
export function conciseCourseClearDynamicsCaseResult(
  result: CourseClearDynamicsCaseResult,
): unknown {
  return {
    suite: result.suite,
    baseline: result.baseline,
    renderer: result.renderer,
    piano: result.piano,
    layer: result.layer,
    sampleLibraryVersion: result.run.sampleLibraryVersion,
    peak: result.run.peak,
    rms: result.run.rms,
    pcmSignature: {
      sampleRate: result.run.pcmSignature.sampleRate,
      frameCount: result.run.pcmSignature.frameCount,
      pcmByteLength: result.run.pcmSignature.pcmByteLength,
      chunkSize: result.run.pcmSignature.chunkSize,
      pcmHash: result.run.pcmSignature.pcmHash,
    },
    traceIdentity: result.run.traceIdentity,
    recognitionStructureHash: result.recognitionStructureHash,
    summary: result.run.recognition.summary,
    events: result.run.recognition.events,
    attacks: result.run.recognition.attacks,
    forensics: result.forensics,
    fixtures: result.fixtures,
    regressions: result.regressions,
    verifications: result.verifications,
  };
}

// Retain an explicit type dependency so changes to the source summary are
// caught here rather than silently dropping a safety metric.
const _summaryCoverage: keyof ListenSequenceRunSummary = "falseAdvanceCount";
void _summaryCoverage;
