import type { RecognizedOnset } from "./noteRecognizer";

const C0_HZ = 8.1757989156;
const LOG2 = Math.log(2);

export interface SpectralPitchDetectorOptions {
  sampleRate: number;
  fftSize: number;
  midiMin: number;
  midiMax: number;
  maxFundamentals: number;
  numHarmonics: number;
  minPeakMarginDb: number;
  minRelativeScore: number;
  harmonicSuppressionRatio: number;
  attackThreshold: number;
  attackReleaseThreshold: number;
  attackReleaseFrames: number;
  slowAttackAlpha: number;
  slowReleaseAlpha: number;
}

export interface SpectralPitchFrame {
  onsets: RecognizedOnset[];
  activePitches: Array<{ midi: number; confidence: number }>;
}

interface Peak {
  bin: number;
  midi: number;
  amplitude: number;
}

interface Fundamental {
  midi: number;
  frequency: number;
  score: number;
  attackRatio: number;
  confidence: number;
}

interface FundamentalCandidate extends Omit<Fundamental, "confidence"> {
  fundamentalAmplitude: number;
  harmonicCount: number;
}

const defaultOptions: Omit<SpectralPitchDetectorOptions, "sampleRate" | "fftSize"> = {
  midiMin: 21,
  midiMax: 108,
  maxFundamentals: 10,
  numHarmonics: 6,
  minPeakMarginDb: 16,
  minRelativeScore: 0.18,
  harmonicSuppressionRatio: 0.78,
  attackThreshold: 0.5,
  attackReleaseThreshold: 0.16,
  attackReleaseFrames: 3,
  slowAttackAlpha: 0.08,
  slowReleaseAlpha: 0.35,
};

const STABILITY_FRAMES = 3;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function midiToFrequency(midi: number): number {
  return C0_HZ * 2 ** (midi / 12);
}

function frequencyToMidi(frequency: number): number {
  return frequency > 0 ? 12 * Math.log(frequency / C0_HZ) / LOG2 : -1;
}

function decibelsToAmplitude(decibels: number): number {
  return Number.isFinite(decibels) ? 10 ** (decibels / 20) : 0;
}

function estimateNoiseFloorDb(
  spectrumDb: Float32Array,
  firstBin: number,
  lastBin: number,
): number {
  const values: number[] = [];
  const stride = Math.max(1, Math.floor((lastBin - firstBin + 1) / 160));
  for (let bin = firstBin; bin <= lastBin; bin += stride) {
    const value = spectrumDb[bin];
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return -100;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length * 0.55)];
}

function closestPeak(peaksByBin: readonly Peak[], expectedBin: number, toleranceBins: number): Peak | null {
  let low = 0;
  let high = peaksByBin.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (peaksByBin[middle].bin < expectedBin) low = middle + 1;
    else high = middle;
  }
  let closest: Peak | null = null;
  for (const index of [low - 1, low, low + 1]) {
    const candidate = peaksByBin[index];
    if (!candidate || Math.abs(candidate.bin - expectedBin) > toleranceBins) continue;
    if (!closest || Math.abs(candidate.bin - expectedBin) < Math.abs(closest.bin - expectedBin)) {
      closest = candidate;
    }
  }
  return closest;
}

/**
 * Lightweight polyphonic spectrum analysis adapted from PitchPlease's peak and
 * harmonic-sieve design. The additional slow spectral envelope produces fresh
 * per-pitch attacks instead of treating a sustained spectrum as a new note.
 */
export class SpectralPitchDetector {
  readonly options: SpectralPitchDetectorOptions;
  private slowSpectrum: Float32Array | null = null;
  private primed = false;
  private readonly latchedPitches = new Set<number>();
  private readonly releasedAttackFrames = new Map<number, number>();
  private readonly presentFrames = new Map<number, number>();
  private readonly pendingAttacks = new Map<number, RecognizedOnset>();

  constructor(options: Pick<SpectralPitchDetectorOptions, "sampleRate" | "fftSize"> & Partial<SpectralPitchDetectorOptions>) {
    this.options = { ...defaultOptions, ...options };
  }

  reset(): void {
    this.slowSpectrum = null;
    this.primed = false;
    this.latchedPitches.clear();
    this.releasedAttackFrames.clear();
    this.presentFrames.clear();
    this.pendingAttacks.clear();
  }

  process(spectrumDb: Float32Array, capturedAtMs: number): SpectralPitchFrame {
    const { sampleRate, fftSize } = this.options;
    const hzPerBin = sampleRate / fftSize;
    const firstBin = Math.max(1, Math.floor(midiToFrequency(this.options.midiMin - 1) / hzPerBin));
    const analysisLimitHz = Math.min(sampleRate / 2, midiToFrequency(this.options.midiMax) * 2.1);
    const lastBin = Math.min(spectrumDb.length - 2, Math.ceil(analysisLimitHz / hzPerBin));
    const amplitudes = new Float32Array(lastBin + 2);
    for (let bin = firstBin - 1; bin <= lastBin + 1; bin += 1) {
      amplitudes[bin] = decibelsToAmplitude(spectrumDb[bin]);
    }

    if (!this.slowSpectrum || this.slowSpectrum.length !== amplitudes.length) {
      this.slowSpectrum = new Float32Array(amplitudes.length);
    }

    let maximumDb = -Infinity;
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      maximumDb = Math.max(maximumDb, spectrumDb[bin]);
    }
    const noiseFloorDb = estimateNoiseFloorDb(spectrumDb, firstBin, lastBin);
    const peakThresholdDb = Math.max(-90, noiseFloorDb + this.options.minPeakMarginDb, maximumDb - 55);
    const peaks: Peak[] = [];
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      const previous = spectrumDb[bin - 1];
      const current = spectrumDb[bin];
      const next = spectrumDb[bin + 1];
      if (!Number.isFinite(current) || current <= peakThresholdDb || current <= previous || current < next) continue;
      const denominator = previous - 2 * current + next;
      const offset = Math.abs(denominator) > 0.0001
        ? clamp(0.5 * (previous - next) / denominator, -0.5, 0.5)
        : 0;
      const refinedBin = bin + offset;
      peaks.push({
        bin: refinedBin,
        midi: frequencyToMidi(refinedBin * hzPerBin),
        amplitude: amplitudes[bin],
      });
    }

    // A hard cap keeps pathological/noisy inputs bounded without biasing the
    // result toward low frequencies.
    const strongestPeaks = peaks
      .sort((left, right) => right.amplitude - left.amplitude)
      .slice(0, 192)
      .sort((left, right) => left.bin - right.bin);
    const candidates = new Map<number, FundamentalCandidate>();
    for (const peak of strongestPeaks) {
      const midi = Math.round(peak.midi);
      const pitchTolerance = midi < 48 ? 0.72 : 0.42;
      if (
        midi < this.options.midiMin ||
        midi > this.options.midiMax ||
        Math.abs(peak.midi - midi) > pitchTolerance
      ) continue;

      let score = peak.amplitude;
      let currentEnergy = peak.amplitude;
      let positiveEnergy = Math.max(0, peak.amplitude - this.slowSpectrum[Math.round(peak.bin)]);
      let harmonicCount = 1;
      for (let harmonic = 2; harmonic <= this.options.numHarmonics; harmonic += 1) {
        const expectedBin = peak.bin * harmonic;
        if (expectedBin > lastBin) break;
        const toleranceBins = Math.max(1.25, expectedBin * 0.012);
        const match = closestPeak(strongestPeaks, expectedBin, toleranceBins);
        if (!match) continue;
        const weight = 1 / harmonic;
        score += match.amplitude * weight;
        currentEnergy += match.amplitude * weight;
        const slow = this.slowSpectrum[Math.round(match.bin)] ?? 0;
        positiveEnergy += Math.max(0, match.amplitude - slow) * weight;
        harmonicCount += 1;
      }
      if (harmonicCount < 2) continue;
      const value = {
        midi,
        frequency: midiToFrequency(midi),
        score,
        attackRatio: currentEnergy > 0 ? positiveEnergy / currentEnergy : 0,
        fundamentalAmplitude: peak.amplitude,
        harmonicCount,
      };
      const existing = candidates.get(midi);
      if (!existing || value.score > existing.score) candidates.set(midi, value);
    }

    let maximumScore = 0;
    for (const candidate of candidates.values()) maximumScore = Math.max(maximumScore, candidate.score);
    const accepted: Fundamental[] = [];
    const orderedCandidates = Array.from(candidates.values()).sort((left, right) => left.midi - right.midi);
    for (const candidate of orderedCandidates) {
      const relativeScore = maximumScore > 0 ? candidate.score / maximumScore : 0;
      if (relativeScore < this.options.minRelativeScore) continue;
      // A low-frequency peak followed by a much stronger real note can look
      // like a subharmonic fundamental. Require meaningful energy at the
      // candidate itself instead of allowing its harmonics to dominate.
      if (candidate.fundamentalAmplitude / Math.max(candidate.score, Number.EPSILON) < 0.1) continue;
      const subharmonicOfHigher = orderedCandidates.some((higher) => {
        if (higher.midi <= candidate.midi || higher.score <= candidate.score) return false;
        const ratio = higher.frequency / candidate.frequency;
        const harmonic = Math.round(ratio);
        return harmonic >= 2 &&
          harmonic <= this.options.numHarmonics &&
          Math.abs(ratio - harmonic) < 0.035 &&
          candidate.score < higher.score * 0.8 &&
          candidate.fundamentalAmplitude < higher.fundamentalAmplitude * 0.45;
      });
      if (subharmonicOfHigher) continue;
      const explainedByLower = accepted.some((lower) => {
        const ratio = candidate.frequency / lower.frequency;
        const harmonic = Math.round(ratio);
        return harmonic >= 2 &&
          harmonic <= this.options.numHarmonics &&
          Math.abs(ratio - harmonic) < 0.035 &&
          candidate.score < lower.score * this.options.harmonicSuppressionRatio;
      });
      if (explainedByLower) continue;
      accepted.push({
        midi: candidate.midi,
        frequency: candidate.frequency,
        score: candidate.score,
        attackRatio: candidate.attackRatio,
        confidence: clamp(relativeScore * 1.65),
      });
    }

    const fundamentals = accepted
      .sort((left, right) => right.score - left.score)
      .slice(0, this.options.maxFundamentals)
      .sort((left, right) => left.midi - right.midi);
    const activePitches = fundamentals.map(({ midi, confidence }) => ({ midi, confidence }));
    const currentPitches = new Set(fundamentals.map(({ midi }) => midi));
    const onsets: RecognizedOnset[] = [];

    for (const fundamental of fundamentals) {
      this.presentFrames.set(fundamental.midi, (this.presentFrames.get(fundamental.midi) ?? 0) + 1);
      const attackConfidence = clamp(
        (fundamental.attackRatio - this.options.attackReleaseThreshold) /
          Math.max(0.001, 1 - this.options.attackReleaseThreshold),
      );
      if (this.latchedPitches.has(fundamental.midi)) {
        if (attackConfidence <= this.options.attackReleaseThreshold) {
          const releasedFrames = (this.releasedAttackFrames.get(fundamental.midi) ?? 0) + 1;
          this.releasedAttackFrames.set(fundamental.midi, releasedFrames);
          if (releasedFrames >= this.options.attackReleaseFrames) {
            this.latchedPitches.delete(fundamental.midi);
            this.releasedAttackFrames.delete(fundamental.midi);
          }
        } else {
          this.releasedAttackFrames.delete(fundamental.midi);
        }
      }
      if (
        this.primed &&
        !this.latchedPitches.has(fundamental.midi) &&
        attackConfidence >= this.options.attackThreshold
      ) {
        const pending = this.pendingAttacks.get(fundamental.midi);
        if (!pending || pending.confidence < attackConfidence) this.pendingAttacks.set(fundamental.midi, {
          midi: fundamental.midi,
          confidence: attackConfidence,
          noteConfidence: fundamental.confidence,
          onsetTimeMs: capturedAtMs,
        });
      }
      if (
        !this.latchedPitches.has(fundamental.midi) &&
        (this.presentFrames.get(fundamental.midi) ?? 0) >= STABILITY_FRAMES &&
        this.pendingAttacks.has(fundamental.midi)
      ) {
        onsets.push(this.pendingAttacks.get(fundamental.midi)!);
        this.pendingAttacks.delete(fundamental.midi);
        this.latchedPitches.add(fundamental.midi);
        this.releasedAttackFrames.delete(fundamental.midi);
      }
    }

    for (const midi of this.presentFrames.keys()) {
      if (currentPitches.has(midi)) continue;
      this.presentFrames.delete(midi);
      this.pendingAttacks.delete(midi);
    }

    for (const midi of this.latchedPitches) {
      if (currentPitches.has(midi)) continue;
      const releasedFrames = (this.releasedAttackFrames.get(midi) ?? 0) + 1;
      this.releasedAttackFrames.set(midi, releasedFrames);
      if (releasedFrames >= this.options.attackReleaseFrames) {
        this.latchedPitches.delete(midi);
        this.releasedAttackFrames.delete(midi);
      }
    }

    for (let bin = firstBin - 1; bin <= lastBin + 1; bin += 1) {
      const current = amplitudes[bin];
      const slow = this.slowSpectrum[bin];
      const alpha = current > slow ? this.options.slowAttackAlpha : this.options.slowReleaseAlpha;
      this.slowSpectrum[bin] = slow + (current - slow) * alpha;
    }
    this.primed = true;
    return { onsets, activePitches };
  }
}
