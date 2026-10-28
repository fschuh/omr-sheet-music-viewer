import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KeyboardRecognitionTracker,
  KEYBOARD_STALE_SUSTAIN_MS,
} from "./keyboardRecognition";
import type { RecognizerResult } from "@fschuh/piano-transcription-engine";
import { formatKeyboardPitch, PIANO_KEYS, PianoKeyboard } from "./PianoKeyboard";
import { DEFAULT_KEYBOARD_VIEW_SETTINGS } from "./keyboardView";

const NAMES_AND_FINGERS = {
  octaveLabels: false,
  fingerNumbers: true,
  noteNames: true,
  upcomingEffect: "growing-tint",
} as const;

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

test("draws black keys as wide as the black-key width asks", () => {
  const blackKeyWidth = (markup: string) => Number(
    /data-piano-key="C♯4"[^>]*style="left:[\d.]+%;width:([\d.]+)%"/.exec(markup)?.[1],
  );
  // C♯ is a fifth of C to E, three of the 52 white keys.
  const real = blackKeyWidth(renderToStaticMarkup(<PianoKeyboard notes={[]} />));
  assert.ok(Math.abs(real - (3 / 5 / 52) * 100) < 1e-9);
  const wide = blackKeyWidth(renderToStaticMarkup(<PianoKeyboard notes={[]} blackKeyWidth={1.5} />));
  assert.ok(Math.abs(wide - 1.5 * real) < 1e-9);
});

test("gives every key an approach overlay only under the note highway, with an effect on", () => {
  const attached = renderToStaticMarkup(<PianoKeyboard notes={[]} highwayAttached />);
  assert.equal(attached.match(/class="piano-key-approach"/g)?.length, 88);
  assert.match(attached, /piano-keyboard-overlay highway-attached upcoming-growing-tint/);
  const plain = renderToStaticMarkup(<PianoKeyboard notes={[]} />);
  assert.doesNotMatch(plain, /piano-key-approach|highway-attached|upcoming-/);
  const off = renderToStaticMarkup(
    <PianoKeyboard notes={[]} highwayAttached display={{ ...NAMES_AND_FINGERS, upcomingEffect: "off" }} />,
  );
  assert.doesNotMatch(off, /piano-key-approach|upcoming-/);
  for (const effect of ["top-edge", "tint", "filling-meter"] as const) {
    const markup = renderToStaticMarkup(
      <PianoKeyboard notes={[]} highwayAttached display={{ ...NAMES_AND_FINGERS, upcomingEffect: effect }} />,
    );
    assert.match(markup, new RegExp(`highway-attached upcoming-${effect}"`));
  }
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
    ]} display={NAMES_AND_FINGERS} />,
  );

  assert.equal(markup.match(/data-piano-key=/g)?.length, 88);
  assert.equal(markup.match(/data-active="true"/g)?.length, 3);
  assert.match(markup, /data-midi="60" data-active="true" data-hand="right"/);
  assert.match(markup, /data-midi="64" data-active="true" data-hand="right"/);
  assert.match(markup, /data-midi="56" data-active="true" data-hand="left"/);
  assert.match(markup, />C4<\/span>/);
  assert.match(markup, />E4<\/span>/);
  assert.match(markup, />A♭3<\/span>/);
  assert.match(markup, /data-hand="right" data-finger="1"/);
  assert.match(markup, /data-hand="right" data-finger="3"/);
  assert.match(markup, /data-hand="left" data-finger="2"/);
  assert.match(markup, /C4, right hand finger 1/);
});

test("marks the finger with a numbered circle in its hand's colour, and only when asked", () => {
  const notes = [{ pitch: "E4", finger: 3, left: false }];
  const markup = renderToStaticMarkup(<PianoKeyboard notes={notes} />);
  assert.match(markup, /class="piano-key-finger" data-hand="right" data-finger="3">3<\/span>/);
  assert.doesNotMatch(markup, /<svg|hand-part/, "no hand drawing any more");
  assert.doesNotMatch(markup, /piano-key-note-name/, "note names are off by default");

  const plain = renderToStaticMarkup(
    <PianoKeyboard notes={notes} display={{ ...NAMES_AND_FINGERS, fingerNumbers: false, noteNames: false }} />,
  );
  assert.doesNotMatch(plain, /class="piano-key-label[ "]|piano-key-finger/, "nothing to mark, so no marker");
  assert.match(plain, /data-midi="64" data-active="true"/, "the key is still lit");

  const unfingered = renderToStaticMarkup(<PianoKeyboard notes={[{ pitch: "E4" }]} />);
  assert.doesNotMatch(unfingered, /class="piano-key-label[ "]/, "no fingering known, no circle");
});

test("names every C on its key unless a marker covers it", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard notes={[{ pitch: "C4", finger: 1, left: false }]} />,
  );
  assert.equal(markup.match(/class="piano-key-octave"/g)?.length, 7, "C1 to C8 but the marked C4");
  assert.match(markup, /data-midi="24"[^>]*>(?:<span[^>]*><\/span>)*<span class="piano-key-octave">C1<\/span>/);
  assert.doesNotMatch(markup, /piano-key-octave">C4</);
  const off = renderToStaticMarkup(
    <PianoKeyboard notes={[]} display={{ ...NAMES_AND_FINGERS, octaveLabels: false }} />,
  );
  assert.doesNotMatch(off, /piano-key-octave/);
});

test("shows only the keys of its range, laid out across the full width", () => {
  // B3 to D5: B3 C4 D4 E4 F4 G4 A4 B4 C5 D5, ten white keys.
  const markup = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "C♯4", finger: 2, left: false }]}
      range={{ low: 59, high: 74 }}
      display={DEFAULT_KEYBOARD_VIEW_SETTINGS}
    />,
  );
  assert.equal(markup.match(/data-piano-key=/g)?.length, 16);
  assert.match(markup, /--white-keys:10/);
  assert.match(markup, /16 keys · B3–D5/);
  assert.match(markup, /aria-label="16-key piano keyboard/);
  // C♯4 is the second fifth of C4 to E4: from 1.6 to 2.2 white keys in.
  assert.match(markup, /data-piano-key="C♯4"[^>]*style="left:16(?:\.0+[0-9]*)?%;width:(?:6|5\.99+[0-9]*)%"/);
  assert.match(markup, /class="piano-key-label piano-key-label-black" style="left:(?:19|18\.99+[0-9]*)%"/);
});

test("draws every label in one layer above the keys, not inside them", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard
      notes={[{ pitch: "F♯3", finger: 4, left: true }, { pitch: "C6", finger: 5, left: false }]}
      recognizedPitches={[54]}
      display={NAMES_AND_FINGERS}
    />,
  );

  // A label nested in a key would be trapped in that key's stacking context,
  // which is what let neighbouring black keys paint over the marker.
  assert.equal(markup.match(/class="piano-key-label[ "]/g)?.length, 2);
  assert.doesNotMatch(markup, /class="piano-key piano-key-[a-z]+[^>]*>(?:(?!<\/div>).)*piano-key-label/s);

  // F♯3 is midi 54, the second seventh of F3 to B3, centred 19 6/7 white keys in;
  // C6 is midi 84, the 38th white key, so its marker centres half a key further on.
  assert.match(
    markup,
    /class="piano-key-label piano-key-label-black" style="left:38\.186[0-9]*%" data-midi="54" data-pressed="true"/,
  );
  assert.match(markup, /class="piano-key-label" style="left:72\.115[0-9]*%" data-midi="84"/);
});

test("stacks one marker per distinct fingering on a shared key", () => {
  const markup = renderToStaticMarkup(
    <PianoKeyboard notes={[
      { pitch: "C4", finger: 5, left: true },
      { pitch: "C4", finger: 3, left: false },
      { pitch: "C4", finger: 5, left: true },
    ]} />,
  );

  assert.equal(markup.match(/class="piano-key-finger"/g)?.length, 2);
  assert.match(markup, /data-hand="left" data-finger="5"/);
  assert.match(markup, /data-hand="right" data-finger="3"/);
  assert.match(markup, /C4, left hand finger 5 or right hand finger 3/);
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
    /class="piano-key piano-key-white active user-active user-correct" data-piano-key="C4" data-midi="60" data-active="true" data-hand="right" data-recognized="true" data-result="correct" data-attack="125"/,
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

test("keeps a held MIDI key shown past the online-AMT sustain limit", () => {
  const tracker = new KeyboardRecognitionTracker(null);
  tracker.consume(recognizerResult(100, [48], [{
    midi: 48,
    type: "onset",
    confidence: 1,
    eventTimeMs: 100,
  }]));

  const melody = tracker.consume(recognizerResult(
    100 + KEYBOARD_STALE_SUSTAIN_MS,
    [48, 64],
    [{
      midi: 64,
      type: "onset",
      confidence: 1,
      eventTimeMs: 100 + KEYBOARD_STALE_SUSTAIN_MS,
    }],
  ));
  assert.deepEqual(melody.activePitches.map(({ midi }) => midi), [48, 64]);
  assert.deepEqual(melody.attacks.map(({ midi }) => midi), [48, 64]);

  const released = tracker.consume(recognizerResult(
    200 + KEYBOARD_STALE_SUSTAIN_MS,
    [64],
    [{
      midi: 48,
      type: "offset",
      confidence: 1,
      eventTimeMs: 200 + KEYBOARD_STALE_SUSTAIN_MS,
    }],
  ));
  assert.deepEqual(released.activePitches.map(({ midi }) => midi), [64]);
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
