import { ExactChordMatcher } from "./chordMatcher";
import { pianoSampleUrls } from "./piano";
import { SpectralPitchDetector } from "./spectralPitchDetector";
import type { RecognizedOnset, RecognizerResult } from "./noteRecognizer";

const FFT_SIZE = 16_384;
const PRE_ROLL_MS = 220;
const MAX_AFTER_ONSET_MS = 900;

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

export interface ScoreBenchmarkMoment {
  measure: number;
  moment: number;
  pitches: readonly number[];
}

/**
 * Every pitched playback moment extracted from "Super Mario Bros - Course Clear"
 * in pdf-cache/13b74407b0870ee53fd027779fab7caf531663830cc6fa9528c733f8c59d99c0.
 * The fixture is kept in the repository so the benchmark does not depend on a
 * developer's cache directory.
 */
export const COURSE_CLEAR_BENCHMARK_MOMENTS: readonly ScoreBenchmarkMoment[] = [
  { measure: 1, moment: 1, pitches: [55] },
  { measure: 1, moment: 2, pitches: [52, 60] },
  { measure: 1, moment: 3, pitches: [55, 64] },
  { measure: 1, moment: 4, pitches: [48, 60, 67] },
  { measure: 1, moment: 5, pitches: [52, 64, 72] },
  { measure: 1, moment: 6, pitches: [55, 67, 76] },
  { measure: 1, moment: 7, pitches: [64, 72, 79] },
  { measure: 1, moment: 8, pitches: [60, 67, 76] },
  { measure: 2, moment: 1, pitches: [56] },
  { measure: 2, moment: 2, pitches: [51, 60] },
  { measure: 2, moment: 3, pitches: [56, 63] },
  { measure: 2, moment: 4, pitches: [48, 60, 68] },
  { measure: 2, moment: 5, pitches: [51, 63, 72] },
  { measure: 2, moment: 6, pitches: [56, 68, 75] },
  { measure: 2, moment: 7, pitches: [63, 72, 80] },
  { measure: 2, moment: 8, pitches: [60, 68, 75] },
  { measure: 3, moment: 1, pitches: [58] },
  { measure: 3, moment: 2, pitches: [53, 62] },
  { measure: 3, moment: 3, pitches: [58, 65] },
  { measure: 3, moment: 4, pitches: [50, 62, 70] },
  { measure: 3, moment: 5, pitches: [53, 65, 74] },
  { measure: 3, moment: 6, pitches: [58, 70, 77] },
  { measure: 3, moment: 7, pitches: [65, 74, 82] },
  { measure: 3, moment: 8, pitches: [62, 74, 82] },
  { measure: 3, moment: 9, pitches: [62, 74, 82] },
  { measure: 3, moment: 10, pitches: [62, 74, 82] },
  { measure: 4, moment: 1, pitches: [60, 76, 84] },
];

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

function nearestSample(midi: number): [number, string] {
  const samples = Object.entries(pianoSampleUrls()).map(
    ([pitch, url]): [number, string] => [Number(pitch), url],
  );
  return samples.reduce((nearest, candidate) => (
    Math.abs(candidate[0] - midi) < Math.abs(nearest[0] - midi) ? candidate : nearest
  ));
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
  private readonly decoded = new Map<string, AudioBuffer>();

  private async sample(url: string): Promise<AudioBuffer> {
    const cached = this.decoded.get(url);
    if (cached) return cached;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load benchmark sample ${url}.`);
    const decoded = await this.audioContext.decodeAudioData(await response.arrayBuffer());
    this.decoded.set(url, decoded);
    return decoded;
  }

  async evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<Pick<ListenBenchmarkTrial, "advanced" | "onsetToAdvanceMs" | "analysisMs" | "recognizedOnsets">> {
    await this.audioContext.resume();
    const prepared = await Promise.all(playedPitches.map(async (midi) => {
      const [sampleMidi, url] = nearestSample(midi);
      return { midi, sampleMidi, buffer: await this.sample(url) };
    }));

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
    const sources: AudioBufferSourceNode[] = [];
    const onsetContextTime = this.audioContext.currentTime + PRE_ROLL_MS / 1_000;
    const scheduledAtMs = performance.now();
    const onsetAtMs = scheduledAtMs + PRE_ROLL_MS;
    matcher.setTarget(targetPitches, generation, scheduledAtMs);

    for (const { midi, sampleMidi, buffer } of prepared) {
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 2 ** ((midi - sampleMidi) / 12);
      const gain = this.audioContext.createGain();
      gain.gain.value = Math.min(0.8, 0.9 / Math.sqrt(playedPitches.length));
      source.connect(gain).connect(analyser);
      source.start(onsetContextTime);
      sources.push(source);
    }

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
            ...detection,
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
      for (const source of sources) {
        try { source.stop(); } catch { /* The sample may already have ended. */ }
        source.disconnect();
      }
      analyser.disconnect();
      silence.disconnect();
    }
  }

  async dispose(): Promise<void> {
    await this.audioContext.close();
  }
}

export async function runBundledListenBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
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
  const cases: Array<{
    target: readonly number[];
    played: readonly number[];
    fixtureGroup?: ListenBenchmarkTrial["fixtureGroup"];
    measure?: number;
    moment?: number;
  }> = [
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
  const client = new SpectralBenchmarkClient();
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
