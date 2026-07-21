import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatKeyboardPitch, PIANO_KEYS, PianoKeyboard } from "./PianoKeyboard";

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
