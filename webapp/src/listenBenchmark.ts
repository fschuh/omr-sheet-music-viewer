import { ExactChordMatcher } from "./chordMatcher";
import { ONLINE_AMT_CHUNK_SIZE } from "./onlineAmtProtocol";
import { OnlineAmtSession } from "./onlineAmtSession";
import {
  onlineAmtChordMatcherOptions,
} from "./onlineAmtOutput";
import { SpectralPitchDetector } from "./spectralPitchDetector";
import type { RecognizedOnset, RecognizerResult } from "./noteRecognizer";
import {
  LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  LISTEN_BENCHMARK_RELEASE_MS,
  LISTEN_BENCHMARK_RENDERER,
  type ListenBenchmarkAudioDiagnostics,
  type ListenBenchmarkAudioRenderResult,
  type ListenBenchmarkRendererConfiguration,
  renderBenchmarkAudio,
} from "./listenBenchmarkAudio";
import {
  COURSE_CLEAR_BENCHMARK_MOMENTS,
  type ScoreBenchmarkMoment,
} from "./listenBenchmarkFixtures";
import {
  captureListenSequenceTrace,
  type ListenRecognitionTrace,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";

export { COURSE_CLEAR_BENCHMARK_MOMENTS, type ScoreBenchmarkMoment };

const FFT_SIZE = 16_384;
const PRE_ROLL_MS = 220;
const MAX_AFTER_ONSET_MS = 900;
export const ISOLATED_LISTEN_BENCHMARK_DURATION_MS = PRE_ROLL_MS + MAX_AFTER_ONSET_MS;

export interface ListenBenchmarkTrial {
  source: "bundled" | "acoustic" | "digital";
  fixtureGroup?: "general" | "course-clear";
  measure?: number;
  moment?: number;
  mathematicallyAmbiguous?: boolean;
  targetPitches: number[];
  playedPitches: number[];
  expectedCorrect: boolean;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  analysisMs: number;
  renderer?: ListenBenchmarkRendererConfiguration;
  audioDiagnostics?: ListenBenchmarkAudioDiagnostics;
  trace?: ListenRecognitionTrace;
  recognizedOnsets?: Array<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    fundamentalProminenceDb?: number;
    fundamentalRelativeDb?: number;
    independentEvidenceRelativeDb?: number;
    onsetAfterAttackMs: number;
  }>;
}

export interface ListenBenchmarkSummary {
  renderer: ListenBenchmarkRendererConfiguration;
  trials: ListenBenchmarkTrial[];
  correctTrialCount: number;
  successRate: number;
  falseAdvanceCount: number;
  ambiguousAdvanceCount: number;
  p95OnsetToAdvanceMs: number | null;
  courseClear: {
    correctTrialCount: number;
    successRate: number | null;
    passed: boolean;
  };
  acceptance: {
    latency: boolean;
    successRate: boolean;
    courseClearSuccessRate: boolean;
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
  const falseAdvanceCount = trials.filter((trial) => (
    !trial.expectedCorrect && !trial.mathematicallyAmbiguous && trial.advanced
  )).length;
  const ambiguousAdvanceCount = trials.filter((trial) => (
    !trial.expectedCorrect && trial.mathematicallyAmbiguous && trial.advanced
  )).length;
  const p95OnsetToAdvanceMs = percentile95(
    correct.flatMap((trial) => trial.advanced && trial.onsetToAdvanceMs !== null
      ? [trial.onsetToAdvanceMs]
      : []),
  );
  const courseClearCorrect = correct.filter((trial) => trial.fixtureGroup === "course-clear");
  const courseClearSuccessRate = courseClearCorrect.length === 0
    ? null
    : courseClearCorrect.filter((trial) => trial.advanced).length / courseClearCorrect.length;
  const courseClear = {
    correctTrialCount: courseClearCorrect.length,
    successRate: courseClearSuccessRate,
    passed: courseClearSuccessRate === null || courseClearSuccessRate >= 0.95,
  };
  const acceptance = {
    latency: p95OnsetToAdvanceMs !== null && p95OnsetToAdvanceMs < 400,
    successRate: successRate >= 0.95,
    courseClearSuccessRate: courseClear.passed,
    falseAdvances: falseAdvanceCount === 0,
    passed: false,
  };
  acceptance.passed = acceptance.latency && acceptance.successRate &&
    acceptance.courseClearSuccessRate && acceptance.falseAdvances;
  return {
    renderer: { ...LISTEN_BENCHMARK_RENDERER },
    trials,
    correctTrialCount: correct.length,
    successRate,
    falseAdvanceCount,
    ambiguousAdvanceCount,
    p95OnsetToAdvanceMs,
    courseClear,
    acceptance,
  };
}

/** Represents an isolated fixture as the canonical one-event sequence. */
export function renderIsolatedListenBenchmarkAudio(
  playedPitches: readonly number[],
): Promise<ListenBenchmarkAudioRenderResult> {
  return renderBenchmarkAudio({
    attacks: [{
      onsetMs: PRE_ROLL_MS,
      notes: playedPitches,
      holdMs: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
      releaseMs: LISTEN_BENCHMARK_RELEASE_MS,
    }],
    durationMs: ISOLATED_LISTEN_BENCHMARK_DURATION_MS,
    sampleRate: 16_000,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
  });
}

function samePitches(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pitch, index) => pitch === right[index]);
}

function isIntegerHarmonic(upperMidi: number, lowerMidi: number): boolean {
  if (upperMidi <= lowerMidi) return false;
  const ratio = 2 ** ((upperMidi - lowerMidi) / 12);
  const harmonic = Math.round(ratio);
  return harmonic >= 2 && harmonic <= 6 && Math.abs(ratio - harmonic) < 0.035;
}

export function isMathematicallyAmbiguousCase(
  targetPitches: readonly number[],
  playedPitches: readonly number[],
): boolean {
  const target = new Set(targetPitches);
  const played = new Set(playedPitches);
  const targetOnly = targetPitches.filter((pitch) => !played.has(pitch));
  const playedOnly = playedPitches.filter((pitch) => !target.has(pitch));
  const differences = targetOnly.length + playedOnly.length;
  return differences > 0 &&
    targetOnly.every((pitch) => playedPitches.some((lower) => isIntegerHarmonic(pitch, lower))) &&
    playedOnly.every((pitch) => targetPitches.some((lower) => isIntegerHarmonic(pitch, lower)));
}

class SpectralBenchmarkClient {
  private readonly audioContext = new AudioContext({ latencyHint: "interactive" });

  async evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation> {
    await this.audioContext.resume();
    const rendered = await renderIsolatedListenBenchmarkAudio(playedPitches);

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -15;
    const silence = this.audioContext.createGain();
    silence.gain.value = 0;
    analyser.connect(silence).connect(this.audioContext.destination);
    const detector = new SpectralPitchDetector({
      sampleRate: this.audioContext.sampleRate,
      fftSize: analyser.fftSize,
    });
    detector.setTarget(targetPitches);
    const matcher = new ExactChordMatcher();
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const source = this.audioContext.createBufferSource();
    const buffer = this.audioContext.createBuffer(1, rendered.pcm.length, 16_000);
    buffer.copyToChannel(new Float32Array(rendered.pcm), 0);
    source.buffer = buffer;
    source.connect(analyser);
    const startsInMs = 10;
    const scheduledAtMs = performance.now() + startsInMs;
    const onsetAtMs = scheduledAtMs + PRE_ROLL_MS;
    matcher.setTarget(targetPitches, generation, scheduledAtMs);
    source.start(this.audioContext.currentTime + startsInMs / 1_000);

    const recognized = new Map<number, RecognizedOnset & {
      fundamentalProminenceDb?: number;
      fundamentalRelativeDb?: number;
      independentEvidenceRelativeDb?: number;
    }>();
    let maximumAnalysisMs = 0;
    try {
      return await new Promise((resolve) => {
        let frame = 0;
        const finish = (advanced: boolean, capturedAtMs: number) => {
          cancelAnimationFrame(frame);
          resolve({
            advanced,
            onsetToAdvanceMs: advanced ? Math.max(0, capturedAtMs - onsetAtMs) : null,
            analysisMs: maximumAnalysisMs,
            renderer: rendered.renderer,
            audioDiagnostics: rendered.diagnostics,
            recognizedOnsets: Array.from(recognized.values())
              .sort((left, right) => left.midi - right.midi)
              .map(({
                midi,
                confidence,
                noteConfidence,
                fundamentalProminenceDb,
                fundamentalRelativeDb,
                independentEvidenceRelativeDb,
                onsetTimeMs,
              }) => ({
                midi,
                confidence,
                noteConfidence,
                fundamentalProminenceDb,
                fundamentalRelativeDb,
                independentEvidenceRelativeDb,
                onsetAfterAttackMs: onsetTimeMs - onsetAtMs,
              })),
          });
        };
        const analyze = () => {
          const startedAt = performance.now();
          analyser.getFloatFrequencyData(spectrum);
          const capturedAtMs = performance.now();
          const detection = detector.process(spectrum, capturedAtMs);
          maximumAnalysisMs = Math.max(maximumAnalysisMs, performance.now() - startedAt);
          for (const onset of detection.onsets) {
            const diagnosticOnset = {
              ...onset,
              fundamentalProminenceDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.fundamentalProminenceDb,
              fundamentalRelativeDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.fundamentalRelativeDb,
              independentEvidenceRelativeDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.independentEvidenceRelativeDb,
            };
            const previous = recognized.get(onset.midi);
            if (!previous || previous.confidence < onset.confidence) {
              recognized.set(onset.midi, diagnosticOnset);
            }
          }
          const result: RecognizerResult = {
            generation,
            onsets: detection.onsets,
            recognizedActivePitches: detection.activePitches,
            targetPitchEvidence: detection.activePitches.filter(
              ({ midi }) => targetPitches.includes(midi),
            ),
            capturedAtMs,
            processingTimeMs: maximumAnalysisMs,
          };
          if (matcher.consume(result).matched) {
            finish(true, capturedAtMs);
            return;
          }
          if (capturedAtMs - onsetAtMs >= MAX_AFTER_ONSET_MS) {
            finish(false, capturedAtMs);
            return;
          }
          frame = requestAnimationFrame(analyze);
        };
        frame = requestAnimationFrame(analyze);
      });
    } finally {
      try { source.stop(); } catch { /* The buffer may already have ended. */ }
      source.disconnect();
      analyser.disconnect();
      silence.disconnect();
    }
  }

  async dispose(): Promise<void> {
    await this.audioContext.close();
  }
}

class OnlineAmtBenchmarkClient {
  private readonly session = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });

  async evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation> {
    return captureIsolatedOnlineAmtBenchmark({
      generation,
      targetPitches,
      playedPitches,
      session: await this.session,
    });
  }

  async dispose(): Promise<void> {
    await (await this.session).dispose();
  }
}

type BundledBenchmarkEvaluation = Pick<
  ListenBenchmarkTrial,
  | "advanced"
  | "onsetToAdvanceMs"
  | "analysisMs"
  | "recognizedOnsets"
  | "renderer"
  | "audioDiagnostics"
  | "trace"
>;

export async function captureIsolatedOnlineAmtBenchmark(options: {
  generation: number;
  targetPitches: readonly number[];
  playedPitches: readonly number[];
  session: SequenceInferenceSession;
}): Promise<BundledBenchmarkEvaluation> {
  const rendered = await renderIsolatedListenBenchmarkAudio(options.playedPitches);
  const relevantPitches = [...new Set([
    ...options.targetPitches,
    ...options.playedPitches,
  ])].sort((left, right) => left - right);
  const trace = await captureListenSequenceTrace({
    sequenceId: "isolated-one-event",
    intervalMs: 0,
    audio: rendered.pcm,
    relevantPitches,
    session: options.session,
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
  });
  const matcher = new ExactChordMatcher(onlineAmtChordMatcherOptions);
  matcher.setTarget(options.targetPitches, options.generation, 0);
  const recognized = new Map<number, {
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetAfterAttackMs: number;
  }>();
  let matchedAtMs: number | null = null;
  for (const frame of trace.frames) {
    for (const onset of frame.onsets) {
      if (!recognized.has(onset.midi)) {
        recognized.set(onset.midi, {
          midi: onset.midi,
          confidence: onset.confidence,
          noteConfidence: onset.noteConfidence,
          onsetAfterAttackMs: frame.capturedAtMs - PRE_ROLL_MS,
        });
      }
    }
    if (matchedAtMs === null && matcher.consume({
      generation: options.generation,
      onsets: frame.onsets,
      noteEvents: frame.noteEvents,
      recognizedActivePitches: frame.activePitches,
      targetPitchEvidence: frame.confidenceEvidence,
      capturedAtMs: frame.capturedAtMs,
      processingTimeMs: frame.inferenceDurationMs,
    }).matched) {
      matchedAtMs = frame.capturedAtMs;
    }
  }
  return {
    advanced: matchedAtMs !== null,
    onsetToAdvanceMs: matchedAtMs === null ? null : Math.max(0, matchedAtMs - PRE_ROLL_MS),
    analysisMs: trace.maximumInferenceMs,
    recognizedOnsets: Array.from(recognized.values()),
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
    trace,
  };
}

interface BundledBenchmarkClient {
  evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation>;
  dispose(): Promise<void>;
}

function bundledCases(): Array<{
  target: readonly number[];
  played: readonly number[];
  fixtureGroup?: ListenBenchmarkTrial["fixtureGroup"];
  measure?: number;
  moment?: number;
}> {
  const correct = [
    [48],
    [55],
    [60],
    [64],
    [67],
    [48, 60],
    [52, 60],
    [55, 64],
    [48, 60, 67],
    [60, 64, 67],
    [48, 55, 60, 64],
    [48, 55, 60, 64, 67],
    [40, 52, 59, 64, 67, 72],
  ];
  return [
    ...correct.flatMap((pitches) => Array.from({ length: 4 }, () => ({
      target: pitches,
      played: pitches,
      fixtureGroup: "general" as const,
    }))),
    ...COURSE_CLEAR_BENCHMARK_MOMENTS.flatMap((scoreMoment) => (
      Array.from({ length: 2 }, () => ({
        target: scoreMoment.pitches,
        played: scoreMoment.pitches,
        fixtureGroup: "course-clear" as const,
        measure: scoreMoment.measure,
        moment: scoreMoment.moment,
      }))
    )),
    { target: [60], played: [61] },
    { target: [60], played: [60, 72] },
    { target: [60, 64], played: [60, 65] },
    { target: [60, 64, 67], played: [60, 64, 67, 72] },
    { target: [48, 55, 60], played: [48, 55] },
    { target: [55], played: [55, 67] },
    { target: [55], played: [55, 74] },
    { target: [67], played: [67, 86] },
    { target: [48, 60, 67], played: [48, 60] },
    { target: [48, 60, 67], played: [48, 67] },
    ...COURSE_CLEAR_BENCHMARK_MOMENTS
      .filter((scoreMoment) => scoreMoment.pitches.length >= 3)
      .map((scoreMoment) => ({
        target: scoreMoment.pitches,
        played: scoreMoment.pitches.slice(1),
        fixtureGroup: "course-clear" as const,
        measure: scoreMoment.measure,
        moment: scoreMoment.moment,
      })),
  ];
}

async function runBundledBenchmark(
  client: BundledBenchmarkClient,
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
  const cases = bundledCases();
  const trials: ListenBenchmarkTrial[] = [];
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const benchmarkCase = cases[index];
      const played = [...benchmarkCase.played].sort((left, right) => left - right);
      const target = [...benchmarkCase.target].sort((left, right) => left - right);
      const evaluation = await client.evaluate(index + 1, target, played);
      trials.push({
        source: "bundled",
        fixtureGroup: benchmarkCase.fixtureGroup,
        measure: benchmarkCase.measure,
        moment: benchmarkCase.moment,
        mathematicallyAmbiguous: isMathematicallyAmbiguousCase(target, played),
        targetPitches: target,
        playedPitches: played,
        expectedCorrect: samePitches(target, played),
        ...evaluation,
      });
      onProgress(index + 1, cases.length);
    }
    return summarizeListenBenchmark(trials);
  } finally {
    await client.dispose();
  }
}

export function runBundledListenBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
  return runBundledBenchmark(new SpectralBenchmarkClient(), onProgress);
}

export function runBundledOnlineAmtBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
  return runBundledBenchmark(new OnlineAmtBenchmarkClient(), onProgress);
}
