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
  type ListenSequenceRunResult,
  type ListenSequenceRunSummary,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import { OnlineAmtSession } from "./onlineAmtSession";
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
  renderer: ListenBenchmarkRendererConfiguration;
  runs: CourseClearDynamicsRunResult[];
  pianos: CourseClearPianoDynamicsSummary[];
  /** Mean of the per-piano rates, so Splendid and Salamander have equal weight. */
  crossPiano: CourseClearDynamicsSummary;
}

export interface CourseClearMixedDynamicsSuiteResult {
  suite: "crescendo-decrescendo";
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
  if (trace.audioSignature?.pcmHash !== pcmSignature.pcmHash) {
    throw new Error("Rendered and recognized PCM signatures differ.");
  }
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
    recognition: replayListenSequenceTrace(sequence, trace, "current-matcher"),
  };
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
    renderer: { ...(options.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    runs,
    crossPiano: equalPianoAggregate(pianos, runs),
  };
}

async function withOnlineAmtSession<T>(
  run: (session: OnlineAmtSession) => Promise<T>,
): Promise<T> {
  const pending = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });
  let session: OnlineAmtSession | null = null;
  try {
    session = await pending;
    return await run(session);
  } finally {
    if (session) await session.dispose();
    else await pending.then((created) => created.dispose()).catch(() => undefined);
  }
}

export function runCourseClearConstantLayerDynamics(
  onProgress: CaptureCourseClearDynamicsOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<CourseClearDynamicsSuiteResult> {
  return withOnlineAmtSession((session) => captureCourseClearConstantLayerDynamics({
    session,
    renderer,
    onProgress,
  }));
}

export function runCourseClearMixedDynamics(
  onProgress: CaptureCourseClearDynamicsOptions["onProgress"] = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<CourseClearMixedDynamicsSuiteResult> {
  return withOnlineAmtSession((session) => captureCourseClearMixedDynamics({
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
      carriedBassMatcherConfigurationChanged: false,
    },
  };
}

// Retain an explicit type dependency so changes to the source summary are
// caught here rather than silently dropping a safety metric.
const _summaryCoverage: keyof ListenSequenceRunSummary = "falseAdvanceCount";
void _summaryCoverage;
