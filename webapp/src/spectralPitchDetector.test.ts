import assert from "node:assert/strict";
import test from "node:test";
import { midiToFrequency, SpectralPitchDetector } from "./spectralPitchDetector";

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 16_384;
const detectorOptions = { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE };

function spectrum(pitches: readonly number[], level = 0.7): Float32Array {
  return spectrumAtLevels(pitches.map((midi) => [midi, level] as const));
}

function spectrumAtLevels(pitches: ReadonlyArray<readonly [number, number]>): Float32Array {
  const amplitudes = new Float32Array(FFT_SIZE / 2);
  for (const [midi, level] of pitches) {
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

function overtoneHeavySpectrum(midi: number): Float32Array {
  const amplitudes = new Float32Array(FFT_SIZE / 2);
  const harmonicLevels = [0.2, 0.6, 1, 0.4, 0.3, 0.2];
  for (let harmonic = 1; harmonic <= harmonicLevels.length; harmonic += 1) {
    const exactBin = midiToFrequency(midi) * harmonic * FFT_SIZE / SAMPLE_RATE;
    for (let bin = Math.floor(exactBin) - 1; bin <= Math.ceil(exactBin) + 1; bin += 1) {
      const distance = Math.abs(bin - exactBin);
      amplitudes[bin] += harmonicLevels[harmonic - 1] * Math.max(0, 1 - distance / 1.8);
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
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.process(spectrum([]), 0);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), 16), []);
  detector.process(spectrum([60, 64, 67]), 32);
  assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), 48), [60, 64, 67]);
  for (let frame = 4; frame < 20; frame += 1) {
    assert.deepEqual(detectedPitches(detector, spectrum([60, 64, 67]), frame * 16), []);
  }
});

test("rearms a pitch after its attack flux settles so a repeated note is fresh", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
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
  const detector = new SpectralPitchDetector(detectorOptions);
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
  const detector = new SpectralPitchDetector(detectorOptions);
  const noise = new Float32Array(FFT_SIZE / 2).fill(-95);
  for (let bin = 20; bin < noise.length; bin += 47) noise[bin] = -91;
  detector.process(noise, 0);
  assert.deepEqual(detectedPitches(detector, noise, 16), []);
  detector.process(spectrum([108]), 32);
  detector.process(spectrum([108]), 48);
  assert.deepEqual(detectedPitches(detector, spectrum([108]), 64), [108]);
});

test("keeps an overtone-heavy piano attack anchored to its fundamental", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  const attack = overtoneHeavySpectrum(55);
  detector.process(spectrum([]), 0);
  detector.process(attack, 16);
  detector.process(attack, 32);
  assert.deepEqual(detectedPitches(detector, attack, 48), [55]);
});

test("scores a known uneven three-note target independently", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([48, 60, 67]);
  const chord = spectrumAtLevels([[48, 0.9], [60, 0.28], [67, 0.2]]);
  detector.process(spectrum([]), 0);
  detector.process(chord, 16);
  detector.process(chord, 32);
  const frame = detector.process(chord, 48);
  assert.deepEqual(frame.onsets.map(({ midi }) => midi), [48, 60, 67]);
  assert.equal(frame.activePitches.every(({ confidence }) => confidence >= 0.35), true);
});

test("does not mistake a target's lower octave for the missing upper note", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([48, 60]);
  const lowerOnly = spectrum([48]);
  detector.process(spectrum([]), 0);
  detector.process(lowerOnly, 16);
  detector.process(lowerOnly, 32);
  const frame = detector.process(lowerOnly, 48);
  assert.deepEqual(frame.onsets.map(({ midi }) => midi), [48]);
  assert.deepEqual(frame.activePitches.map(({ midi }) => midi), [48]);
});

test("does not synthesize a missing target from two lower target harmonics", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([48, 60, 67]);
  const missingG = spectrum([48, 60]);
  detector.process(spectrum([]), 0);
  detector.process(missingG, 16);
  detector.process(missingG, 32);
  const frame = detector.process(missingG, 48);
  assert.equal(frame.onsets.some(({ midi }) => midi === 67), false);
  assert.equal(frame.activePitches.some(({ midi }) => midi === 67), false);
});

test("does not infer the bass of G3/G4/E5 from the two upper notes", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([55, 67, 76]);
  const missingBass = spectrum([67, 76]);
  detector.process(spectrum([]), 0);
  detector.process(missingBass, 16);
  detector.process(missingBass, 32);
  const frame = detector.process(missingBass, 48);
  assert.equal(frame.onsets.some(({ midi }) => midi === 55), false);
  assert.equal(frame.activePitches.some(({ midi }) => midi === 55), false);
});

test("retains a quiet bass fundamental beneath loud upper target notes", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([55, 67, 76]);
  const unevenChord = spectrumAtLevels([[55, 0.1], [67, 0.7], [76, 0.7]]);
  detector.process(spectrum([]), 0);
  detector.process(unevenChord, 16);
  detector.process(unevenChord, 32);
  const frame = detector.process(unevenChord, 48);
  assert.equal(frame.onsets.some(({ midi }) => midi === 55), true);
  assert.equal(frame.activePitches.some(({ midi }) => midi === 55), true);
});

test("finds a quiet Ab3 fundamental despite a loud third-harmonic target", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([56, 75]);
  const unevenChord = spectrumAtLevels([[56, 0.1], [75, 0.75]]);
  detector.process(spectrum([]), 0);
  detector.process(unevenChord, 16);
  detector.process(unevenChord, 32);
  const frame = detector.process(unevenChord, 48);
  assert.equal(frame.onsets.some(({ midi }) => midi === 56), true);
  assert.equal(frame.activePitches.some(({ midi }) => midi === 56), true);
});

test("retains a genuinely played extra octave for exact-match rejection", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([60]);
  const wrongChord = spectrum([60, 72]);
  detector.process(spectrum([]), 0);
  detector.process(wrongChord, 16);
  detector.process(wrongChord, 32);
  const frame = detector.process(wrongChord, 48);
  assert.deepEqual(frame.onsets.map(({ midi }) => midi), [60, 72]);
});

test("retains a genuinely played rational-interval extra", () => {
  const detector = new SpectralPitchDetector(detectorOptions);
  detector.setTarget([60, 64]);
  const wrongChord = spectrum([60, 65]);
  detector.process(spectrum([]), 0);
  detector.process(wrongChord, 16);
  detector.process(wrongChord, 32);
  const frame = detector.process(wrongChord, 48);
  assert.equal(frame.onsets.some(({ midi }) => midi === 65), true);
});
