import assert from "node:assert/strict";
import test from "node:test";
import { ExactChordMatcher } from "./chordMatcher";
import { matcherOptionsForListenMatcherProfile } from "./listenMatcherProfiles";
import {
  isMidiNoteMessage,
  MidiNoteRecognizer,
  type MidiNoteRecognizerEnvironment,
} from "./midiNoteRecognizer";
import type { RecognizerResult } from "./noteRecognizer";

class FakeEnvironment implements MidiNoteRecognizerEnvironment {
  nowMs = 0;
  private nextHandle = 1;
  private callbacks = new Map<number, () => void>();

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void): ReturnType<typeof setTimeout> {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.callbacks.delete(handle as unknown as number);
  }

  runTimers(): void {
    const callbacks = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

test("recognizes Note On and both forms of Note Off, but not control messages", () => {
  assert.equal(isMidiNoteMessage([0x90, 60, 100]), true);
  assert.equal(isMidiNoteMessage([0x80, 60, 64]), true);
  assert.equal(isMidiNoteMessage([0x9f, 60, 0]), true);
  assert.equal(isMidiNoteMessage([0xb0, 64, 127]), false);
  assert.equal(isMidiNoteMessage([0x90, 60]), false);
});

test("feeds an exact MIDI chord through the shared listen matcher after settling", async () => {
  const environment = new FakeEnvironment();
  environment.nowMs = 200;
  const recognizer = new MidiNoteRecognizer(environment);
  const matcher = new ExactChordMatcher(matcherOptionsForListenMatcherProfile());
  const results: RecognizerResult[] = [];
  const matches: boolean[] = [];
  matcher.setTarget([60, 64], 7, environment.nowMs);
  recognizer.setTarget([60, 64]);
  await recognizer.start(7, {
    onLifecycle: () => undefined,
    onResult: (result) => {
      results.push(result);
      matches.push(matcher.consume(result).matched);
    },
  });

  recognizer.handleMidiMessage([0x90, 60, 100], "Keyboard");
  environment.nowMs = 207;
  // Velocity is expression, not recognition confidence: pianissimo still matches.
  recognizer.handleMidiMessage([0x91, 64, 1], "Keyboard");

  assert.deepEqual(results.at(-1)?.recognizedActivePitches, [
    { midi: 60, confidence: 1 },
    { midi: 64, confidence: 1 },
  ]);
  assert.equal(matches.includes(true), false);

  environment.nowMs = 247;
  environment.runTimers();
  assert.equal(matches.at(-1), true);
});

test("tracks the same pitch independently across ports and channels", async () => {
  const environment = new FakeEnvironment();
  const recognizer = new MidiNoteRecognizer(environment);
  const results: RecognizerResult[] = [];
  await recognizer.start(1, {
    onLifecycle: () => undefined,
    onResult: (result) => results.push(result),
  });

  recognizer.handleMidiMessage([0x90, 60, 100], "First");
  recognizer.handleMidiMessage([0x91, 60, 100], "Second");
  recognizer.handleMidiMessage([0x80, 60, 0], "First");
  assert.deepEqual(results.at(-1)?.recognizedActivePitches, [{ midi: 60, confidence: 1 }]);
  assert.deepEqual(results.at(-1)?.noteEvents, []);

  recognizer.handleMidiMessage([0x81, 60, 0], "Second");
  assert.deepEqual(results.at(-1)?.recognizedActivePitches, []);
  assert.equal(results.at(-1)?.noteEvents?.[0]?.type, "offset");
});
