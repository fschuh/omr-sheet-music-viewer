import assert from "node:assert/strict";
import test from "node:test";
import {
  pianoChordVelocity,
  pianoSampleUrls,
  PianoSampler,
  pitchToMidi,
  type PianoPlaybackEngine,
} from "./piano";

test("uses the shared playback velocity curve for notes and chords", () => {
  assert.equal(pianoChordVelocity(1), 0.78);
  assert.ok(Math.abs(pianoChordVelocity(3) - 0.9 / Math.sqrt(3)) < 1e-9);
  assert.throws(() => pianoChordVelocity(0), /positive integer/);
});

test("parses natural, sharp, flat, and double-accidental pitches", () => {
  assert.equal(pitchToMidi("C4"), 60);
  assert.equal(pitchToMidi("F#4"), 66);
  assert.equal(pitchToMidi("G♭4"), 66);
  assert.equal(pitchToMidi("A♭3"), 56);
  assert.equal(pitchToMidi("A3b"), 56);
  assert.equal(pitchToMidi("C##4"), 62);
  assert.equal(pitchToMidi("Ebb4"), 62);
  assert.equal(pitchToMidi("B-1"), 11);
  assert.equal(pitchToMidi("rest"), null);
});

test("maps bundled sample roots to their concert pitches", () => {
  const urls = pianoSampleUrls();
  assert.equal(urls[55], "/audio/piano/Mp-G2.ogg");
  assert.equal(urls[56], "/audio/piano/Mp-Gs2.ogg");
  assert.equal(urls[60], "/audio/piano/Mp-C3.ogg");
  assert.equal(urls[106], "/audio/piano/Mp-As6.ogg");
});

test("attacks distinct Tone.js pitches and releases them on navigation", async () => {
  const attacks: Array<{ notes: readonly string[]; velocity: number }> = [];
  const releases: Array<readonly string[]> = [];
  const engine: PianoPlaybackEngine = {
    load: async () => undefined,
    activate: async () => undefined,
    prepare: async () => undefined,
    attack: (notes, velocity) => attacks.push({ notes, velocity }),
    release: (notes) => releases.push(notes),
  };
  const sampler = new PianoSampler(() => engine);

  await sampler.play(["C4", "E4", "A♭3", "C4"]);

  assert.deepEqual(attacks[0].notes, ["C4", "E4", "G#3"]);
  assert.ok(Math.abs(attacks[0].velocity - 0.9 / Math.sqrt(3)) < 1e-9);
  assert.deepEqual(releases, []);

  await sampler.play(["D4"]);
  assert.deepEqual(releases, [["C4", "E4", "G#3"]]);
  assert.deepEqual(attacks[1].notes, ["D4"]);

  sampler.stop();
  assert.deepEqual(releases, [["C4", "E4", "G#3"], ["D4"]]);
});

test("preloads, activates, and reuses the playback engine before the first note", async () => {
  let enginesCreated = 0;
  let loads = 0;
  let activations = 0;
  let preparations = 0;
  const engine: PianoPlaybackEngine = {
    load: async () => { loads += 1; },
    activate: async () => { activations += 1; },
    prepare: async () => { preparations += 1; },
    attack: () => undefined,
    release: () => undefined,
  };
  const sampler = new PianoSampler(() => {
    enginesCreated += 1;
    return engine;
  });

  await sampler.preload();
  await sampler.activate();
  await sampler.prepare();
  await sampler.play(["C4"]);

  assert.equal(enginesCreated, 1);
  assert.equal(loads, 1);
  assert.equal(activations, 1);
  assert.equal(preparations, 1);
});

test("stop cancels a note waiting for asynchronous sampler preparation", async () => {
  let finishPreparation!: () => void;
  const preparation = new Promise<void>((resolve) => {
    finishPreparation = resolve;
  });
  const attacks: Array<readonly string[]> = [];
  const engine: PianoPlaybackEngine = {
    load: async () => undefined,
    activate: async () => undefined,
    prepare: () => preparation,
    attack: (notes) => attacks.push(notes),
    release: () => undefined,
  };
  const sampler = new PianoSampler(() => engine);

  const playing = sampler.play(["C4"]);
  sampler.stop();
  finishPreparation();
  await playing;

  assert.deepEqual(attacks, []);
});

test("audition plays while muted independently, releases, and waits for its guard", async () => {
  const attacks: Array<readonly string[]> = [];
  const releases: Array<readonly string[]> = [];
  const engine: PianoPlaybackEngine = {
    load: async () => undefined,
    activate: async () => undefined,
    prepare: async () => undefined,
    attack: (notes) => attacks.push(notes),
    release: (notes) => releases.push(notes),
  };
  const sampler = new PianoSampler(() => engine);
  await sampler.audition(["C4", "E4"], { holdMs: 0, decayGuardMs: 0 });
  assert.deepEqual(attacks, [["C4", "E4"]]);
  assert.deepEqual(releases, [["C4", "E4"]]);
});
