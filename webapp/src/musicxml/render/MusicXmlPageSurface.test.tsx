import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayoutPage } from "../model/layout";
import { MusicXmlPageSurface } from "./MusicXmlPageSurface";

const page: LayoutPage = {
  index: 0,
  firstMeasure: 0,
  width: 1000,
  height: 1400,
  staffSpace: 20,
  items: [
    { kind: "line", x1: 100, y1: 200, x2: 900, y2: 200, width: 2 },
    { kind: "glyph", glyph: "gClef", x: 110, y: 260, scale: 1 },
    { kind: "glyph", glyph: "brace", x: 80, y: 400, scale: 1, scaleY: 2.5 },
    { kind: "text", text: "5", x: 100, y: 160, size: 32, anchor: "start" },
  ],
  chords: [
    {
      id: "P1-m1-s1-v1-t0",
      systemIndex: 0,
      momentId: "m1-t0",
      stemBounds: [200, 150, 230, 240],
      items: [{ kind: "line", x1: 228, y1: 230, x2: 228, y2: 160, width: 2 }],
      notes: [
        {
          key: "P1-m1-s1-v1-t0-C5",
          pitch: "C5",
          grace: false,
          measure: 1,
          center: [213, 230],
          headBounds: [200, 220, 226, 240],
          items: [{ kind: "glyph", glyph: "noteheadBlack", x: 200, y: 230, scale: 1 }],
        },
        {
          key: "P1-m1-s1-v1-t0-E5",
          pitch: "E5",
          grace: false,
          measure: 1,
          center: [213, 210],
          headBounds: [200, 200, 226, 220],
          items: [
            { kind: "glyph", glyph: "noteheadBlack", x: 200, y: 210, scale: 1 },
            { kind: "glyph", glyph: "accidentalSharp", x: 180, y: 210, scale: 1 },
          ],
        },
      ],
    },
  ],
};

test("a page draws its items in page pixels, glyphs at four staff spaces per em", () => {
  const markup = renderToStaticMarkup(<MusicXmlPageSurface page={page} />);
  assert.match(markup, /^<svg class="musicxml-page" viewBox="0 0 1000 1400"/);
  assert.match(markup, /@font-face\{font-family:"Leland";src:url\("[^"]*Leland\.otf"\)/);
  assert.match(markup, /<line x1="100" y1="200" x2="900" y2="200" stroke-width="2"><\/line>/);
  assert.match(markup, /<text class="mx-glyph" x="110" y="260" font-size="80"><\/text>/);
  assert.match(markup, /transform="translate\(80 400\) scale\(1 2.5\)"/);
  assert.match(markup, /<text class="mx-text" x="100" y="160" font-size="32" text-anchor="start">5<\/text>/);
});

test("notes group what is drawn for them under their key, inside their chord", () => {
  const markup = renderToStaticMarkup(<MusicXmlPageSurface page={page} />);
  assert.match(markup, /<g class="mx-chord" data-chord="P1-m1-s1-v1-t0"><line/);
  assert.match(markup, /<g class="mx-note" data-notehead="P1-m1-s1-v1-t0-E5"><text[^>]*><\/text><text[^>]*><\/text><\/g>/);
});

test("highlighted notes and their chord take the selection or playback colour", () => {
  const selected = renderToStaticMarkup(
    <MusicXmlPageSurface page={page} highlighted={new Set(["P1-m1-s1-v1-t0-E5"])} />,
  );
  assert.match(selected, /class="mx-chord mx-selected"/);
  assert.match(selected, /class="mx-note mx-selected" data-notehead="P1-m1-s1-v1-t0-E5"/);
  assert.match(selected, /class="mx-note" data-notehead="P1-m1-s1-v1-t0-C5"/);
  const playing = renderToStaticMarkup(
    <MusicXmlPageSurface page={page} highlighted={new Set(["P1-m1-s1-v1-t0-C5"])} highlightKind="playback" />,
  );
  assert.match(playing, /class="mx-note mx-playback" data-notehead="P1-m1-s1-v1-t0-C5"/);
  assert.doesNotMatch(renderToStaticMarkup(<MusicXmlPageSurface page={page} />), /class="[^"]*mx-(selected|playback)/);
});
