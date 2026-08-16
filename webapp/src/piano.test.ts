import assert from "node:assert/strict";
import test from "node:test";
import {
  pianoChordVelocity,
  pianoSampleUrls,
  PianoSampler,
  pitchToMidi,
  type PianoPlaybackEngine,
} from "./piano";
import {
  crescendoDecrescendoLayers,
  pianoDefinition,
  pianoLayerForDynamic,
  pianoSampleUrlsForLayer,
} from "./pianoRegistry";

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
  assert.equal(urls[55], "/audio/splendid-grand-piano/mp-G2.ogg");
  assert.equal(urls[56], "/audio/splendid-grand-piano/mp-Gs2.ogg");
  assert.equal(urls[60], "/audio/splendid-grand-piano/mp-C3.ogg");
  assert.equal(urls[106], "/audio/splendid-grand-piano/mp-As6.ogg");
});

test("defines every recorded layer and keeps missing dynamics semantically mp", () => {
  assert.deepEqual(pianoDefinition("splendid").benchmarkLayers, ["pp", "mp", "mf", "ff"]);
  assert.equal(pianoDefinition("salamander").benchmarkLayers.length, 16);
  assert.equal(pianoLayerForDynamic("splendid", "mp"), "mp");
  assert.equal(pianoLayerForDynamic("salamander", "mp"), "v07");
  assert.equal(
    pianoSampleUrlsForLayer("salamander", "v16")[60],
    "/audio/salamander-grand-piano/v16/C4v16.ogg",
  );
  const profile = crescendoDecrescendoLayers("splendid", 27);
  assert.equal(profile.length, 27);
  assert.equal(profile[0], "pp");
  assert.equal(profile[13], "ff");
  assert.equal(profile.at(-1), "pp");
  const salamanderProfile = crescendoDecrescendoLayers("salamander", 27);
  assert.deepEqual(salamanderProfile.slice(0, 16), pianoDefinition("salamander").benchmarkLayers);
  assert.equal(salamanderProfile[15], "v16");
  assert.equal(salamanderProfile.at(-1), "v01");
  assert.ok(salamanderProfile.slice(16).every((layer, index, descending) => (
    index === 0 || layer <= descending[index - 1]
  )));
});

test("attacks distinct Tone.js pitches and releases them on navigation", async () => {
  const attacks: Array<{ notes: readonly string[]; velocity: number; layer: string }> = [];
  const releases: Array<readonly string[]> = [];
  const engine: PianoPlaybackEngine = {
    load: async () => undefined,
    activate: async () => undefined,
    prepare: async () => undefined,
    attack: (notes, velocity, layer) => attacks.push({ notes, velocity, layer }),
    release: (notes) => releases.push(notes),
    dispose: () => undefined,
  };
  const sampler = new PianoSampler(() => engine);

  await sampler.play(["C4", "E4", "A♭3", "C4"]);

  assert.deepEqual(attacks[0].notes, ["C4", "E4", "G#3"]);
  assert.ok(Math.abs(attacks[0].velocity - 0.9 / Math.sqrt(3)) < 1e-9);
  assert.equal(attacks[0].layer, "mp");
  assert.deepEqual(releases, []);

  await sampler.play(["D4"]);
  assert.deepEqual(releases, [["C4", "E4", "G#3"]]);
  assert.deepEqual(attacks[1].notes, ["D4"]);

  sampler.stop();
  assert.deepEqual(releases, [["C4", "E4", "G#3"], ["D4"]]);
});

test("keeps acoustic layer selection independent from chord-size mix gain", async () => {
  const attacks: Array<{ velocity: number; layer: string }> = [];
  const loadedLayers: Array<readonly string[] | undefined> = [];
  const engine: PianoPlaybackEngine = {
    load: async (layers) => { loadedLayers.push(layers); },
    activate: async () => undefined,
    prepare: async () => undefined,
    attack: (_notes, velocity, layer) => attacks.push({ velocity, layer }),
    release: () => undefined,
    dispose: () => undefined,
  };
  const sampler = new PianoSampler(() => engine);

  await sampler.play(["C4"], "pp");
  await sampler.play(["C4", "E4", "G4"], "pp");

  assert.deepEqual(attacks.map(({ layer }) => layer), ["pp", "pp"]);
  assert.notEqual(attacks[0].velocity, attacks[1].velocity);
  assert.deepEqual(loadedLayers, [["pp"], ["pp"]]);
});

test("reports a non-default layer loading failure to the caller", async () => {
  const engine: PianoPlaybackEngine = {
    load: async (layers) => {
      if (layers?.includes("ff")) throw new Error("missing ff samples");
    },
    activate: async () => undefined,
    prepare: async () => undefined,
    attack: () => undefined,
    release: () => undefined,
    dispose: () => undefined,
  };
  const sampler = new PianoSampler(() => engine);

  await assert.rejects(() => sampler.play(["C4"], "ff"), /missing ff samples/);
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
    dispose: () => undefined,
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
    dispose: () => undefined,
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
    dispose: () => undefined,
  };
  const sampler = new PianoSampler(() => engine);
  await sampler.audition(["C4", "E4"], { holdMs: 0, decayGuardMs: 0 });
  assert.deepEqual(attacks, [["C4", "E4"]]);
  assert.deepEqual(releases, [["C4", "E4"]]);
});
