import assert from "node:assert/strict";
import test from "node:test";
import { HeldChordMatcher } from "./heldChordMatcher";
import { MidiNoteRecognizer } from "./midiNoteRecognizer";

const Bb2 = 46, C5 = 72, Cs5 = 73, G5 = 79;

/** A MIDI recognizer on a fake clock feeding a HeldChordMatcher; returns match times. */
function keyboard(target: number[]) {
  let now = 0;
  let timer: { at: number; fn: () => void } | null = null;
  const recognizer = new MidiNoteRecognizer({
    now: () => now,
    setTimeout: (fn, delayMs) => {
      timer = { at: now + delayMs, fn };
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => { timer = null; },
  });
  const matcher = new HeldChordMatcher(32);
  const matches: number[] = [];
  void recognizer.start(1, {
    onLifecycle: () => undefined,
    onResult: (result) => {
      if (matcher.consume(result)) matches.push(now);
    },
  });
  const advance = (to: number) => {
    while (timer && timer.at <= to) {
      const due: { at: number; fn: () => void } = timer;
      timer = null;
      now = due.at;
      due.fn();
    }
    now = to;
  };
  return {
    matches,
    setTarget: (pitches: number[]) => matcher.setTarget(pitches),
    key: (atMs: number, type: "on" | "off", midi: number) => {
      advance(atMs);
      recognizer.handleMidiMessage([type === "on" ? 0x90 : 0x80, midi, 64]);
    },
    settle: () => advance(now + 1000),
    start: () => matcher.setTarget(target),
  };
}

test("a chord gathered a hand at a time counts once the last key settles", () => {
  const piano = keyboard([Bb2, Cs5, G5]);
  piano.start();
  piano.key(0, "on", Bb2);
  piano.key(900, "on", Cs5);
  piano.key(905, "on", G5);
  piano.settle();
  assert.deepEqual(piano.matches, [945]);
});

test("a stray key spoils the chord only while it is held", () => {
  const piano = keyboard([Bb2, Cs5, G5]);
  piano.start();
  piano.key(0, "on", Bb2);
  piano.key(5, "on", C5);
  piano.key(10, "on", Cs5);
  piano.key(15, "on", G5);
  piano.key(200, "on", Bb2 + 12);
  piano.key(210, "off", Bb2 + 12);
  assert.deepEqual(piano.matches, []);
  piano.key(300, "off", C5);
  assert.deepEqual(piano.matches, [300]);
});

test("keys down before the target is set must be pressed again, and it matches once", () => {
  const piano = keyboard([Cs5, G5]);
  piano.key(0, "on", G5);
  piano.start();
  piano.key(100, "on", Cs5);
  piano.settle();
  assert.deepEqual(piano.matches, []);
  piano.key(1200, "off", G5);
  piano.key(1300, "on", G5);
  piano.settle();
  piano.key(2400, "off", G5);
  piano.key(2500, "on", G5);
  piano.settle();
  assert.deepEqual(piano.matches, [1340]);
});

test("a chord's first notes are not taken for it before the rest can arrive", () => {
  const piano = keyboard([Cs5]);
  piano.start();
  piano.key(0, "on", Cs5);
  piano.key(20, "on", G5);
  piano.settle();
  assert.deepEqual(piano.matches, []);
});
