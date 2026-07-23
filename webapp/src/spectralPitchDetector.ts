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
  harmonicCount: number;
  localConfidence: number;
  targeted: boolean;
}

const defaultOptions: Omit<SpectralPitchDetectorOptions, "sampleRate" | "fftSize"> = {
  midiMin: 21,
  midiMax: 108,
  maxFundamentals: 10,
  numHarmonics: 6,
  minPeakMarginDb: 16,
  minRelativeScore: 0.5,
  harmonicSuppressionRatio: 0.78,
  attackThreshold: 0.5,
  attackReleaseThreshold: 0.16,
  attackReleaseFrames: 3,
  slowAttackAlpha: 0.08,
  slowReleaseAlpha: 0.35,
};

const STABILITY_FRAMES = 3;
const MIN_REPORTED_CONFIDENCE = 0.12;
const RESIDUAL_HARMONICS = 12;

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
  private targetPitches = new Set<number>();

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

  setTarget(targetPitches: readonly number[]): void {
    this.targetPitches = new Set(
      targetPitches.filter((pitch) => (
        Number.isInteger(pitch) &&
        pitch >= this.options.midiMin &&
        pitch <= this.options.midiMax
      )),
    );
    this.reset();
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
      const weightedScore = score * Math.sqrt(harmonicCount);
      const value: FundamentalCandidate = {
        midi,
        frequency: midiToFrequency(midi),
        // PitchPlease promotes candidates supported by several harmonics,
        // rather than allowing one loud overtone to win on amplitude alone.
        score: weightedScore,
        attackRatio: currentEnergy > 0 ? positiveEnergy / currentEnergy : 0,
        harmonicCount,
        localConfidence: clamp(
          (20 * Math.log10(Math.max(Number.EPSILON, weightedScore)) - peakThresholdDb) / 24,
        ),
        targeted: this.targetPitches.has(midi),
      };
      const existing = candidates.get(midi);
      if (!existing || value.score > existing.score) candidates.set(midi, value);
    }
    // Expected notes are evaluated at their known frequencies, independently
    // of whichever note happens to be loudest in the frame. This is a bounded
    // hypothesis test for the score chord, not a relaxation of extra-note
    // detection: unknown pitches still use the open-set relative threshold.
    for (const midi of this.targetPitches) {
      const expectedBin = midiToFrequency(midi) / hzPerBin;
      if (expectedBin < firstBin || expectedBin > lastBin) continue;
      const fundamentalPeak = closestPeak(
        strongestPeaks,
        expectedBin,
        Math.max(1.25, expectedBin * 0.012),
      );
      const baseBin = fundamentalPeak?.bin ?? expectedBin;
      let score = 0;
      let currentEnergy = 0;
      let positiveEnergy = 0;
      let harmonicCount = 0;
      for (let harmonic = 1; harmonic <= this.options.numHarmonics; harmonic += 1) {
        const harmonicBin = baseBin * harmonic;
        if (harmonicBin > lastBin) break;
        const match = closestPeak(
          strongestPeaks,
          harmonicBin,
          Math.max(1.25, harmonicBin * 0.012),
        );
        if (!match) continue;
        const weight = 1 / harmonic;
        score += match.amplitude * weight;
        currentEnergy += match.amplitude * weight;
        const slow = this.slowSpectrum[Math.round(match.bin)] ?? 0;
        positiveEnergy += Math.max(0, match.amplitude - slow) * weight;
        harmonicCount += 1;
      }
      if (harmonicCount < 2) continue;
      const weightedScore = score * Math.sqrt(harmonicCount);
      const targeted: FundamentalCandidate = {
        midi,
        frequency: midiToFrequency(midi),
        score: weightedScore,
        attackRatio: currentEnergy > 0 ? positiveEnergy / currentEnergy : 0,
        harmonicCount,
        localConfidence: clamp(
          (20 * Math.log10(Math.max(Number.EPSILON, weightedScore)) - peakThresholdDb) / 24,
        ),
        targeted: true,
      };
      const existing = candidates.get(midi);
      if (!existing || targeted.score > existing.score) candidates.set(midi, targeted);
      else {
        existing.targeted = true;
        existing.localConfidence = Math.max(existing.localConfidence, targeted.localConfidence);
      }
    }

    let maximumScore = 0;
    for (const candidate of candidates.values()) maximumScore = Math.max(maximumScore, candidate.score);

    // Harmonic aliases need special treatment because an upper candidate may
    // be supported entirely by a lower note's partials (an octave is 2/1, a
    // fifth-shaped alias is 3/2, and so on). Estimate the lower note's local
    // harmonic envelope from adjacent partials and retain only unexplained
    // energy. A lower note by itself therefore cannot become a target or an
    // extra merely through its overtones.
    const aliasResidualConfidence = (candidate: FundamentalCandidate): number => {
      let confidence = 1;
      for (const lower of candidates.values()) {
        if (
          lower.midi >= candidate.midi ||
          !lower.targeted ||
          lower.score < maximumScore * 0.12
        ) {
          continue;
        }
        const frequencyRatio = candidate.frequency / lower.frequency;
        let lowerStep = 0;
        let candidateStep = 0;
        for (let possibleCandidateStep = 1; possibleCandidateStep <= this.options.numHarmonics; possibleCandidateStep += 1) {
          const possibleLowerStep = Math.round(frequencyRatio * possibleCandidateStep);
          if (
            possibleLowerStep <= possibleCandidateStep ||
            possibleLowerStep > this.options.numHarmonics ||
            Math.abs(frequencyRatio - possibleLowerStep / possibleCandidateStep) >= 0.035
          ) continue;
          lowerStep = possibleLowerStep;
          candidateStep = possibleCandidateStep;
          break;
        }
        if (lowerStep === 0) continue;
        // Rational overlap can explain a target hypothesis, but it is not
        // sufficient grounds to discard a genuinely played non-target pitch
        // such as the F in a C/F wrong chord. Only integer-harmonic extras are
        // eligible for alias suppression.
        if (!candidate.targeted && candidateStep > 1) continue;
        if (
          candidate.targeted &&
          candidateStep === 1 &&
          lowerStep >= 3 &&
          candidate.score < lower.score * 0.5
        ) {
          confidence = 0;
          continue;
        }

        let totalEnergy = 0;
        let residualEnergy = 0;
        let comparisons = 0;
        for (let multiple = 1; ; multiple += 1) {
          const candidateHarmonic = candidateStep * multiple;
          const lowerHarmonic = lowerStep * multiple;
          if (candidateHarmonic > this.options.numHarmonics) break;
          if (lowerHarmonic + 1 > RESIDUAL_HARMONICS) break;
          const currentBin = candidate.frequency * candidateHarmonic / hzPerBin;
          if (currentBin > lastBin) break;
          const tolerance = Math.max(1.25, currentBin * 0.012);
          const current = closestPeak(strongestPeaks, currentBin, tolerance);
          const overlapsAnotherTarget = (frequency: number): boolean => Array.from(this.targetPitches)
            .some((targetMidi) => {
              if (targetMidi === lower.midi) return false;
              const ratio = frequency / midiToFrequency(targetMidi);
              const harmonic = Math.round(ratio);
              return harmonic >= 1 &&
                harmonic <= RESIDUAL_HARMONICS &&
                Math.abs(ratio - harmonic) < 0.035;
            });
          const cleanNeighbor = (direction: -1 | 1): { peak: Peak; harmonic: number } | null => {
            for (
              let harmonic = lowerHarmonic + direction;
              harmonic >= 1 && harmonic <= RESIDUAL_HARMONICS;
              harmonic += direction
            ) {
              const frequency = lower.frequency * harmonic;
              if (overlapsAnotherTarget(frequency)) continue;
              const bin = frequency / hzPerBin;
              const peak = closestPeak(
                strongestPeaks,
                bin,
                Math.max(1.25, bin * 0.012),
              );
              if (peak) return { peak, harmonic };
            }
            return null;
          };
          const previous = cleanNeighbor(-1);
          const next = cleanNeighbor(1);
          if (!current || (!previous && !next)) continue;
          const weight = 1 / candidateHarmonic;
          const predictions: number[] = [];
          if (previous) {
            predictions.push(previous.peak.amplitude * previous.harmonic / lowerHarmonic);
          }
          if (next) predictions.push(next.peak.amplitude * next.harmonic / lowerHarmonic);
          const predictedLowerEnergy = predictions.length === 2
            ? Math.sqrt(predictions[0] * predictions[1])
            : predictions[0];
          totalEnergy += current.amplitude * weight;
          residualEnergy += Math.max(0, current.amplitude - predictedLowerEnergy) * weight;
          comparisons += 1;
        }
        if (comparisons === 0 || totalEnergy <= 0) continue;
        const residualRatio = residualEnergy / totalEnergy;
        // Piano third harmonics are often strong enough to look like an
        // independent note. Require substantially more excess energy for a
        // 3/1-or-higher alias, while keeping octave and rational-interval
        // thresholds low enough to retain genuinely played extra notes.
        const residualStart = candidateStep === 1 && lowerStep >= 3
          ? 0.22
          : lowerStep === 2 && candidateStep === 1
            ? 0.18
            : 0.12;
        const residualSpan = candidateStep === 1 && lowerStep >= 3 ? 0.45 : 0.38;
        confidence = Math.min(
          confidence,
          clamp((residualRatio - residualStart) / residualSpan),
        );
      }
      return confidence;
    };

    const accepted: Fundamental[] = [];
    const orderedCandidates = Array.from(candidates.values()).sort((left, right) => right.score - left.score);
    for (const candidate of orderedCandidates) {
      const relativeScore = maximumScore > 0 ? candidate.score / maximumScore : 0;
      if (!candidate.targeted && relativeScore < this.options.minRelativeScore) continue;
      const explainedBySelected = accepted.some((selected) => {
        const ratio = candidate.frequency / selected.frequency;
        const harmonic = Math.round(ratio);
        return harmonic >= 2 &&
          harmonic <= this.options.numHarmonics &&
          Math.abs(ratio - harmonic) < 0.035 &&
          candidate.score < selected.score * this.options.harmonicSuppressionRatio;
      });
      if (explainedBySelected && !candidate.targeted) continue;
      const residualConfidence = aliasResidualConfidence(candidate);
      const confidence = candidate.targeted
        ? candidate.localConfidence * residualConfidence
        : clamp(relativeScore) * residualConfidence;
      if (confidence < MIN_REPORTED_CONFIDENCE) continue;
      accepted.push({
        midi: candidate.midi,
        frequency: candidate.frequency,
        score: candidate.score,
        attackRatio: candidate.attackRatio,
        // Preserve score separation here. Saturating most candidates made
        // weak resonances indistinguishable from independently played notes.
        confidence,
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
