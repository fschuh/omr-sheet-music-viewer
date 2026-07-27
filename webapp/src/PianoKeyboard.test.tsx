import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KeyboardRecognitionTracker,
  KEYBOARD_STALE_SUSTAIN_MS,
} from "./keyboardRecognition";
import type { RecognizerResult } from "./noteRecognizer";
import { formatKeyboardPitch, PIANO_KEYS, PianoKeyboard } from "./PianoKeyboard";

function recognizerResult(
  capturedAtMs: number,
  activePitches: number[],
  noteEvents: NonNullable<RecognizerResult["noteEvents"]>,
): RecognizerResult {
  return {
    generation: 1,
    onsets: [],
    recognizedActivePitches: activePitches.map((midi) => ({
      midi,
      confidence: 0.99,
    })),
    targetPitchEvidence: [],
    noteStates: [],
    noteEvents,
    processingTimeMs: 10,
    capturedAtMs,
  };
}

test("builds the complete 88-key piano range", () => {
  assert.equal(PIANO_KEYS.length, 88);
  assert.equal(PIANO_KEYS.filter((key) => !key.black).length, 52);
  assert.equal(PIANO_KEYS.filter((key) => key.black).length, 36);
  assert.equal(PIANO_KEYS[0].name, "A0");
  assert.equal(PIANO_KEYS.at(-1)?.name, "C8");
});

test("highlights every distinct in-range playhead pitch and labels its key", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard notes={[
      { pitch: "C4", finger: 1, left: false },
      { pitch: "E4", finger: 3, left: false },
      { pitch: "A♭3", finger: 2, left: true },
      { pitch: "C4", finger: 1, left: false },
      { pitch: "C9" },
      { pitch: "rest" },
    ]} />,
  );

  assert.equal(markup.match(/data-piano-key=/g)?.length, 88);
  assert.equal(markup.match(/data-active="true"/g)?.length, 3);
  assert.match(markup, /data-midi="60" data-active="true"/);
  assert.match(markup, /data-midi="64" data-active="true"/);
  assert.match(markup, /data-midi="56" data-active="true"/);
  assert.match(markup, />C4<\/span>/);
  assert.match(markup, />E4<\/span>/);
  assert.match(markup, />A♭3<\/span>/);
  assert.match(markup, />R1<\/span>/);
  assert.match(markup, />R3<\/span>/);
  assert.match(markup, />L2<\/span>/);
  assert.match(markup, /C4, right hand finger 1/);
});

test("formats stored accidental spellings like the staff note labels", () => {
  assert.equal(formatKeyboardPitch("f#4"), "F♯4");
  assert.equal(formatKeyboardPitch("A3b"), "A♭3");
});

test("distinguishes correct partial-chord notes from wrong pressed notes", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard
      notes={[
        { pitch: "C4" },
        { pitch: "E4" },
        { pitch: "G4" },
      ]}
      recognizedPitches={[60, 61, 64]}
      attackPitches={[
        { midi: 60, attackTimeMs: 125 },
        { midi: 61, attackTimeMs: 130 },
      ]}
    />,
  );

  assert.match(
    markup,
    /class="piano-key piano-key-white active user-active user-correct" data-piano-key="C4" data-midi="60" data-active="true" data-recognized="true" data-result="correct" data-attack="125"/,
  );
  assert.match(
    markup,
    /class="piano-key piano-key-black user-active user-wrong"[^>]*data-piano-key="C♯4" data-midi="61" data-recognized="true" data-result="wrong" data-attack="130"/,
  );
  assert.match(
    markup,
    /class="piano-key piano-key-white active" data-piano-key="G4" data-midi="67" data-active="true"/,
  );
  assert.equal(markup.match(/class="piano-key-attack"/g)?.length, 2);
});

test("uses the attack timestamp as a fresh animation identity for repeated notes", () => {
  const firstAttack = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "C4" }]}
      recognizedPitches={[60]}
      attackPitches={[{ midi: 60, attackTimeMs: 125 }]}
    />,
  );
  const repeatedAttack = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "C4" }]}
      recognizedPitches={[60]}
      attackPitches={[{ midi: 60, attackTimeMs: 250 }]}
    />,
  );

  assert.match(firstAttack, /data-attack-time-ms="125"/);
  assert.match(repeatedAttack, /data-attack-time-ms="250"/);
});

test("flashes a completed chord without reclassifying it against the next target", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "D4" }]}
      recognizedPitches={[]}
      attackPitches={[]}
      successPitches={[{ midi: 60, successTimeMs: 500 }]}
    />,
  );

  assert.match(
    markup,
    /class="piano-key piano-key-white" data-piano-key="C4" data-midi="60" data-success="500"/,
  );
  assert.match(markup, /class="piano-key-success" data-success-time-ms="500"/);
  assert.match(
    markup,
    /class="piano-key piano-key-white active" data-piano-key="D4" data-midi="62" data-active="true"/,
  );
  assert.doesNotMatch(markup, /data-piano-key="C4"[^>]*data-result="wrong"/);
});

test("removes the pressed state and attack feedback after an offset", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "C4" }]}
      recognizedPitches={[]}
      attackPitches={[]}
    />,
  );

  assert.doesNotMatch(markup, /user-correct|user-wrong|data-recognized|piano-key-attack/);
  assert.match(
    markup,
    /class="piano-key piano-key-white active" data-piano-key="C4" data-midi="60" data-active="true"/,
  );
});

test("hides carry-over notes until an offset or fresh re-onset", () => {
  const tracker = new KeyboardRecognitionTracker();
  tracker.consume(recognizerResult(100, [60], [{
    midi: 60,
    type: "onset",
    confidence: 0.99,
    eventTimeMs: 100,
  }]));

  assert.deepEqual(tracker.suppressVisibleUntilRelease(), [60]);
  const carried = tracker.consume(recognizerResult(132, [60], []));
  assert.deepEqual(carried.activePitches, []);
  assert.deepEqual(carried.attacks, []);

  const repeated = tracker.consume(recognizerResult(164, [60], [{
    midi: 60,
    type: "reOnset",
    confidence: 0.99,
    eventTimeMs: 164,
  }]));
  assert.deepEqual(repeated.activePitches.map(({ midi }) => midi), [60]);
  assert.deepEqual(repeated.attacks, [{ midi: 60, attackTimeMs: 164 }]);

  tracker.suppressVisibleUntilRelease();
  tracker.consume(recognizerResult(196, [], [{
    midi: 60,
    type: "offset",
    confidence: 0.99,
    eventTimeMs: 196,
  }]));
  const afterRelease = tracker.consume(recognizerResult(228, [60], [{
    midi: 60,
    type: "onset",
    confidence: 0.99,
    eventTimeMs: 228,
  }]));
  assert.deepEqual(afterRelease.activePitches.map(({ midi }) => midi), [60]);
});

test("suppresses a latched online-AMT sustain until release or a fresh attack", () => {
  const tracker = new KeyboardRecognitionTracker();
  const onset = tracker.consume(recognizerResult(100, [60], [{
    midi: 60,
    type: "onset",
    confidence: 0.99,
    eventTimeMs: 100,
  }]));
  assert.deepEqual(onset.activePitches.map(({ midi }) => midi), [60]);
  assert.deepEqual(onset.attacks, [{ midi: 60, attackTimeMs: 100 }]);

  const stale = tracker.consume(recognizerResult(
    100 + KEYBOARD_STALE_SUSTAIN_MS,
    [60],
    [],
  ));
  assert.deepEqual(stale.activePitches, []);
  assert.deepEqual(stale.attacks, []);

  const stillSuppressed = tracker.consume(recognizerResult(
    200 + KEYBOARD_STALE_SUSTAIN_MS,
    [60],
    [],
  ));
  assert.deepEqual(stillSuppressed.activePitches, []);

  const repeated = tracker.consume(recognizerResult(
    300 + KEYBOARD_STALE_SUSTAIN_MS,
    [60],
    [{
      midi: 60,
      type: "reOnset",
      confidence: 0.99,
      eventTimeMs: 300 + KEYBOARD_STALE_SUSTAIN_MS,
    }],
  ));
  assert.deepEqual(repeated.activePitches.map(({ midi }) => midi), [60]);
  assert.deepEqual(repeated.attacks, [{
    midi: 60,
    attackTimeMs: 300 + KEYBOARD_STALE_SUSTAIN_MS,
  }]);

  const released = tracker.consume(recognizerResult(
    332 + KEYBOARD_STALE_SUSTAIN_MS,
    [],
    [{
      midi: 60,
      type: "offset",
      confidence: 0.99,
      eventTimeMs: 332 + KEYBOARD_STALE_SUSTAIN_MS,
    }],
  ));
  assert.deepEqual(released.activePitches, []);
  assert.deepEqual(released.attacks, []);
});

test("does not time-limit the spectral detector's refreshed active snapshots", () => {
  const tracker = new KeyboardRecognitionTracker();
  const result = (onsets: RecognizerResult["onsets"]): RecognizerResult => ({
    generation: 1,
    onsets,
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }],
    targetPitchEvidence: [],
    processingTimeMs: 10,
    capturedAtMs: 100 + KEYBOARD_STALE_SUSTAIN_MS,
  });

  const onset = {
    midi: 60,
    confidence: 0.8,
    noteConfidence: 0.8,
    onsetTimeMs: 100,
  };
  const snapshot = tracker.consume(result([onset]));
  assert.deepEqual(snapshot.activePitches, [{ midi: 60, confidence: 0.8 }]);
  assert.deepEqual(snapshot.attacks, [{ midi: 60, attackTimeMs: 100 }]);

  tracker.suppressVisibleUntilRelease();
  assert.deepEqual(tracker.consume(result([])).activePitches, []);
  assert.deepEqual(
    tracker.consume(result([{ ...onset, onsetTimeMs: 200 }])).activePitches,
    [{ midi: 60, confidence: 0.8 }],
  );
});
