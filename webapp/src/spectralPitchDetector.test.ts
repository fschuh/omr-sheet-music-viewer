import assert from "node:assert/strict";
import test from "node:test";
import { midiToFrequency, SpectralPitchDetector } from "./spectralPitchDetector";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 16_384;

function spectrum(pitches: readonly number[], level = 0.7): Float32Array {
  const amplitudes = new Float32Array(FFT_SIZE / 2);
  for (const midi of pitches) {
    const fundamental = midiToFrequency(midi);
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      const exactBin = fundamental * harmonic * FFT_SIZE / SAMPLE_RATE;
      if (exactBin >= amplitudes.length - 2) break;
      const harmonicLevel = level / harmonic;
      for (let bin = Math.floor(exactBin) - 1; bin <= Math.ceil(exactBin) + 1; bin += 1) {
        const distance = Math.abs(bin - exactBin);
        const shape = Math.max(0, 1 - distance / 1.8);
        amplitudes[bin] += harmonicLevel * shape;
      }
    }
  }
  return Float32Array.from(amplitudes, (amplitude) => (
    amplitude > 0 ? 20 * Math.log10(amplitude) : -110
  ));
}

function detectedPitches(detector: SpectralPitchDetector, values: Float32Array, nowMs: number): number[] {
  return detector.process(values, nowMs).onsets.map((onset) => onset.midi);
}

test("emits simultaneous polyphonic attacks and ignores their sustained tails", () => {
  const detector = new SpectralPitchDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  detector.process(spectrum([]), 0);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), 16), []);
  detector.process(spectrum([60, 64, 67]), 32);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), 48), [60, 64, 67]);
  for (let frame = 4; frame < 20; frame += 1) {
    assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), frame * 16), []);
  }
});

test("rearms a pitch after its attack flux settles so a repeated note is fresh", () => {
  const detector = new SpectralPitchDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  detector.process(spectrum([]), 0);
  detector.process(spectrum([60]), 16);
  detector.process(spectrum([60]), 32);
  assert.deepEqual(detectedPitches(detector, spectrum([60]), 48), [60]);
  for (let frame = 2; frame < 16; frame += 1) detector.process(spectrum([60]), frame * 16);
  detector.process(spectrum([]), 300);
  detector.process(spectrum([]), 316);
  detector.process(spectrum([]), 332);
  detector.process(spectrum([60]), 348);
  detector.process(spectrum([60]), 364);
  assert.deepEqual(detectedPitches(detector, spectrum([60]), 380), [60]);
});

test("detects a newly rolled chord tone while earlier notes continue sounding", () => {
  const detector = new SpectralPitchDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  detector.process(spectrum([]), 0);
  detector.process(spectrum([60]), 16);
  detector.process(spectrum([60]), 32);
  assert.deepEqual(detectedPitches(detector, spectrum([60]), 48), [60]);
  for (let frame = 4; frame < 8; frame += 1) detector.process(spectrum([60]), frame * 16);
  detector.process(spectrum([60, 64]), 128);
  detector.process(spectrum([60, 64]), 144);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64]), 160), [64]);
  detector.process(spectrum([60, 64, 67]), 240);
  detector.process(spectrum([60, 64, 67]), 256);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), 272), [67]);
});

test("rejects low-level noise and covers the top of the 88-key range", () => {
  const detector = new SpectralPitchDetector({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE });
  const noise = new Float32Array(FFT_SIZE / 2).fill(-95);
  for (let bin = 20; bin < noise.length; bin += 47) noise[bin] = -91;
  detector.process(noise, 0);
  assert.deepEqual(detectedPitches(detector, noise, 16), []);
  detector.process(spectrum([108]), 32);
  detector.process(spectrum([108]), 48);
  assert.deepEqual(detectedPitches(detector, spectrum([108]), 64), [108]);
});
