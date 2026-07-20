import assert from "node:assert/strict";
import test from "node:test";
import { nearestPianoSample, PianoSampler, pitchToMidi } from "./piano";

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

test("chooses nearby roots for repitched notes", () => {
  assert.deepEqual(nearestPianoSample(55), { file: "Mp-G2", midi: 55 });
  assert.deepEqual(nearestPianoSample(56), { file: "Mp-Gs2", midi: 56 });
  assert.deepEqual(nearestPianoSample(60), { file: "Mp-C3", midi: 60 });
  assert.deepEqual(nearestPianoSample(61), { file: "Mp-C3", midi: 60 });
  assert.deepEqual(nearestPianoSample(108), { file: "Mp-As6", midi: 106 });
});

test("starts every distinct chord pitch together on independent voices", async () => {
  const starts: number[] = [];
  const stops: number[] = [];
  const rates: number[] = [];
  const releaseEnds: number[] = [];
  const context = {
    state: "running",
    currentTime: 4,
    destination: {},
    resume: async () => undefined,
    decodeAudioData: async () => ({}),
    createBufferSource: () => ({
      buffer: null,
      playbackRate: { setValueAtTime: (value: number) => rates.push(value) },
      connect() { return this; },
      start: (when: number) => starts.push(when),
      stop: (when: number) => stops.push(when),
      onended: null,
    }),
    createGain: () => ({
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: (value: number, when: number) => {
          if (value === 0) releaseEnds.push(when);
        },
        cancelScheduledValues: () => undefined,
      },
      connect() { return this; },
    }),
  } as unknown as AudioContext;
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  let fetchReceiver: unknown = "not called";
  globalThis.fetch = (async function (this: unknown, input: string | URL | Request) {
    fetchReceiver = this;
    fetchedUrls.push(String(input));
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  }) as unknown as typeof fetch;
  const sampler = new PianoSampler(() => context);

  try {
    await sampler.play(["C4", "E4", "A♭3", "C4"]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchReceiver, undefined);
  assert.ok(fetchedUrls.includes("/audio/piano/Mp-Gs2.ogg"));
  assert.equal(starts.length, 3);
  assert.deepEqual(starts, [4.008, 4.008, 4.008]);
  assert.equal(rates.length, 3);

  sampler.stop();
  assert.equal(releaseEnds.length, 3);
  assert.ok(releaseEnds.every((when) => Math.abs(when - 4.35) < 1e-9));
  assert.equal(stops.length, 3);
  assert.ok(stops.every((when) => Math.abs(when - 4.37) < 1e-9));
});
