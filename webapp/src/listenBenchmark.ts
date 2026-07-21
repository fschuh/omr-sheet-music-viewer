import { ExactChordMatcher } from "./chordMatcher";
import { pianoSampleUrls } from "./piano";
import { SpectralPitchDetector } from "./spectralPitchDetector";
import type { RecognizedOnset, RecognizerResult } from "./noteRecognizer";

const FFT_SIZE = 16_384;
const PRE_ROLL_MS = 220;
const MAX_AFTER_ONSET_MS = 900;

export interface ListenBenchmarkTrial {
  source: "bundled" | "acoustic" | "digital";
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
    onsetAfterAttackMs: number;
  }>;
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

    const recognized = new Map<number, RecognizedOnset>();
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
              .map(({ midi, confidence, noteConfidence, onsetTimeMs }) => ({
                midi,
                confidence,
                noteConfidence,
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
            const previous = recognized.get(onset.midi);
            if (!previous || previous.confidence < onset.confidence) recognized.set(onset.midi, onset);
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
    [60, 64, 67],
    [48, 55, 60, 64],
    [48, 55, 60, 64, 67],
    [40, 52, 59, 64, 67, 72],
  ];
  const cases = [
    ...correct.flatMap((pitches) => Array.from({ length: 4 }, () => ({ target: pitches, played: pitches }))),
    { target: [60], played: [61] },
    { target: [60], played: [60, 72] },
    { target: [60, 64], played: [60, 65] },
    { target: [60, 64, 67], played: [60, 64, 67, 72] },
    { target: [48, 55, 60], played: [48, 55] },
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
