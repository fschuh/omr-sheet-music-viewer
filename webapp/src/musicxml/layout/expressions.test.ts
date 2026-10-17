import assert from "node:assert/strict";
import test from "node:test";
import { ENGRAVING_DEFAULTS, glyphBox, glyphWidth } from "../fonts/smufl";
import { parseMusicXml } from "../import/parseMusicXml";
import type { Drawable, LayoutPage } from "../model/layout";
import { attributes, measure, note, part, piano, score } from "../testScores";
import { pageFormat } from "./pageFormat";
import { layoutScore } from "./pages";

function pages(xml: string): LayoutPage[] {
  const parsed = parseMusicXml(xml);
  return layoutScore(parsed, pageFormat(parsed.defaults)).pages;
}

function items(page: LayoutPage): Drawable[] {
  return [...page.items, ...page.chords.flatMap((chord) => [...chord.items, ...chord.notes.flatMap((value) => value.items)])];
}

type Glyph = Extract<Drawable, { kind: "glyph" }>;
type Text = Extract<Drawable, { kind: "text" }>;
type Line = Extract<Drawable, { kind: "line" }>;

function glyphs(page: LayoutPage, name: string): Glyph[] {
  return items(page).filter((item): item is Glyph => item.kind === "glyph" && item.glyph === name);
}

function texts(page: LayoutPage, text: string): Text[] {
  return items(page).filter((item): item is Text => item.kind === "text" && item.text === text);
}

function paths(page: LayoutPage): string[] {
  return page.items.flatMap((item) => (item.kind === "path" ? [item.d] : []));
}

/** The numbers of a path: start x, start y, then the control points and ends. */
function numbers(d: string): number[] {
  return d.match(/-?\d+(\.\d+)?/g)!.map(Number);
}

/** The distance between a staff's lines, in page pixels. */
function staffSpace(page: LayoutPage): number {
  const lines = page.items
    .filter((item): item is Line => item.kind === "line" && item.y1 === item.y2 && item.x2 - item.x1 > 200)
    .map((line) => line.y1)
    .sort((a, b) => a - b);
  return lines[1] - lines[0];
}

function noteheadY(page: LayoutPage, key: string): number {
  const found = page.chords.flatMap((chord) => chord.notes).find((value) => value.key.endsWith(key));
  assert.ok(found, `no note ${key}`);
  const head = found.items.find((item): item is Glyph => item.kind === "glyph" && item.glyph.startsWith("notehead"));
  return head!.y;
}

const treble = (content: string[], first = "") =>
  score([part("P1", content.map((value, index) =>
    measure((index === 0 ? attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: ["G"] }) + first : "") + value)))]);

const direction = (types: string, placement = "", staff = 1, extra = "") =>
  `<direction${placement ? ` placement="${placement}"` : ""}>${types}<staff>${staff}</staff>${extra}</direction>`;
const directionType = (content: string) => `<direction-type>${content}</direction-type>`;
const notations = (content: string) => `<notations>${content}</notations>`;
const quarters = (pitch: string, count: number, options = {}) =>
  Array.from({ length: count }, () => note(pitch, 4, { type: "quarter", ...options })).join("");

test("directions import with their placement and staff, and hidden ones are left out", () => {
  const parsed = parseMusicXml(treble([
    direction(directionType("<dynamics><m/><f/></dynamics>"), "below") +
      direction(directionType('<wedge type="crescendo" number="2"/>')) +
      direction(directionType('<words font-style="italic" font-weight="bold" font-size="12">dolce</words>'), "above") +
      direction(directionType('<metronome parentheses="yes"><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome>')) +
      direction(directionType('<pedal type="start" line="yes"/>')) +
      direction(directionType('<octave-shift type="down" size="15"/>')) +
      direction(directionType("<segno/>") + directionType('<other-direction smufl="ornamentTrill"/>')) +
      direction(directionType('<words print-object="no">hidden</words>')) +
      quarters("C5", 4),
  ]));
  const [first] = parsed.parts[0].measures;
  assert.deepEqual(first.directions.map((value) => value.placement), ["below", null, "above", null, null, null, null]);
  assert.deepEqual(first.directions.flatMap((value) => value.items), [
    { kind: "dynamics", text: "mf" },
    { kind: "wedge", type: "crescendo", number: "2" },
    { kind: "words", text: "dolce", italic: true, bold: true, size: 12 },
    { kind: "metronome", beatUnit: "quarter", dots: 1, perMinute: "60", parentheses: true },
    { kind: "pedal", type: "start", line: true },
    { kind: "octave-shift", type: "down", size: 15, number: "1" },
    { kind: "symbol", smufl: "segno" },
    { kind: "symbol", smufl: "ornamentTrill" },
  ]);
});

test("a direction the file hides is left out whole", () => {
  const parsed = parseMusicXml(treble([
    `<direction print-object="no">${directionType("<words>rubato</words>")}<staff>1</staff></direction>` + quarters("C5", 4),
  ]));
  assert.deepEqual(parsed.parts[0].measures[0].directions, []);
});

test("chord marks and fingerings import from the notations of every note", () => {
  const parsed = parseMusicXml(treble([
    note("C5", 4, {
      type: "quarter",
      extra: notations(
        '<slur type="start" number="2" placement="below"/>' +
          '<articulations><staccato/><accent placement="above"/></articulations>' +
          '<fermata type="inverted">square</fermata>' +
          '<ornaments><trill-mark/><wavy-line type="start"/></ornaments>' +
          '<ornaments><tremolo type="single">2</tremolo></ornaments>' +
          '<arpeggiate direction="down" number="3"/>' +
          '<technical><fingering placement="below">3</fingering><fingering>1</fingering></technical>',
      ),
    }) +
      note("E5", 4, { chord: true, type: "quarter", extra: notations("<articulations><staccato/><tenuto/></articulations>") }) +
      note("C5", 4, { type: "quarter", extra: `<notations print-object="no"><articulations><staccato/></articulations></notations>` }) +
      note(null, 8, { type: "half" }),
  ]));
  const [chord, hidden] = parsed.parts[0].measures[0].chords;
  assert.deepEqual(chord.slurs, [{ type: "start", number: "2", placement: "below" }]);
  // One of each articulation for the chord, in the order they first appear.
  assert.deepEqual(chord.articulations, [
    { name: "staccato", placement: null },
    { name: "accent", placement: "above" },
    { name: "tenuto", placement: null },
  ]);
  assert.deepEqual(chord.fermata, { inverted: true, shape: "square" });
  assert.deepEqual(chord.ornaments, [{ name: "trill-mark", placement: null }]);
  assert.deepEqual(chord.wavyLines, [{ type: "start", number: "1" }]);
  assert.deepEqual(chord.tremolo, { type: "single", marks: 2 });
  assert.deepEqual(chord.arpeggiate, { direction: "down", number: "3" });
  assert.deepEqual(chord.notes[0].fingerings, [{ text: "3", placement: "below" }, { text: "1", placement: null }]);
  assert.deepEqual(chord.notes[1].fingerings, []);
  assert.deepEqual(hidden.articulations, []);
});

test("notes under an ottava are written an octave down, and still sound where they are", () => {
  const plain = pages(treble([quarters("C6", 4)]))[0];
  const xml = treble([
    direction(directionType('<octave-shift type="down" size="8"/>'), "above") + quarters("C6", 3) +
      direction(directionType('<octave-shift type="stop" size="8"/>')) + note("C6", 4, { type: "quarter" }),
  ]);
  const shifted = pages(xml)[0];
  const [first, , , last] = parseMusicXml(xml).parts[0].measures[0].chords;
  assert.equal(first.notes[0].octave, 6);
  // Seven staff positions lower: 3.5 staff spaces, at 10 pixels to the space or so.
  assert.ok(noteheadY(shifted, "t0-C6") - noteheadY(plain, "t0-C6") > 20);
  assert.equal(noteheadY(shifted, `t${last.onset.n}_${last.onset.d}-C6`), noteheadY(plain, `t${last.onset.n}_${last.onset.d}-C6`));
  assert.equal(glyphs(shifted, "ottavaAlta").length, 1);
  assert.ok(shifted.items.some((item) => item.kind === "line" && item.dash));
});

test("dynamics are drawn with the font's letters, and hairpins open toward louder", () => {
  const [page] = pages(treble([
    direction(directionType("<dynamics><m/><f/></dynamics>"), "below") +
      direction(directionType('<wedge type="crescendo"/>'), "below") + quarters("C5", 3) +
      direction(directionType('<wedge type="stop"/>'), "below") + note("C5", 4, { type: "quarter" }),
  ]));
  const [mezzo] = glyphs(page, "dynamicMezzo");
  const [forte] = glyphs(page, "dynamicForte");
  assert.ok(mezzo && forte && forte.x > mezzo.x);
  const lines = page.items.filter((item): item is Line => item.kind === "line" && item.x1 !== item.x2 && item.y1 !== item.y2);
  assert.equal(lines.length, 2);
  // The two lines meet at the start and spread apart at the end.
  assert.equal(lines[0].x1, lines[1].x1);
  assert.equal(lines[0].y1, lines[1].y1);
  assert.ok(Math.abs(lines[0].y2 - lines[1].y2) > 5);
});

test("a pedal with a line draws Ped. and a bracket; one without, Ped. and a release star", () => {
  const pedalled = (line: string) => pages(treble([
    direction(directionType(`<pedal type="start" line="${line}"/>`), "below") + quarters("C5", 3) +
      direction(directionType(`<pedal type="stop" line="${line}"/>`), "below") + note("C5", 4, { type: "quarter" }),
  ]))[0];
  const withLine = pedalled("yes");
  assert.equal(glyphs(withLine, "keyboardPedalPed").length, 1);
  assert.equal(glyphs(withLine, "keyboardPedalUp").length, 0);
  assert.ok(withLine.items.some((item) => item.kind === "line" && item.y1 === item.y2 && item.x2 - item.x1 > 50));
  const withoutLine = pedalled("no");
  assert.equal(glyphs(withoutLine, "keyboardPedalPed").length, 1);
  assert.equal(glyphs(withoutLine, "keyboardPedalUp").length, 1);
});

test("a pedal pressed again where the last one lifts stays on the same line", () => {
  const [page] = pages(treble([
    direction(directionType('<pedal type="start" line="yes"/>'), "below") + quarters("C5", 2) +
      direction(directionType('<pedal type="stop" line="yes"/>'), "below") +
      direction(directionType('<pedal type="start" line="yes"/>'), "below") + quarters("C5", 2) +
      direction(directionType('<pedal type="stop" line="yes"/>'), "below"),
  ]));
  const signs = glyphs(page, "keyboardPedalPed");
  assert.equal(signs.length, 2);
  assert.equal(signs[0].y, signs[1].y);
});

const slurred = (pitches: string[], stem: "up" | "down", placement = "") =>
  pitches.map((pitch, index) => note(pitch, 4, {
    type: "quarter",
    stem,
    extra: index === 0 ? notations(`<slur type="start"${placement ? ` placement="${placement}"` : ""}/>`)
      : index === pitches.length - 1 ? notations('<slur type="stop"/>') : "",
  })).join("");

test("a slur bows below notes with stems up, above otherwise, and as the file places it", () => {
  const bow = (content: string) => {
    const [d] = paths(pages(treble([content]))[0]);
    const values = numbers(d);
    // Control points lower than the ends (larger y) mean the slur bows downward.
    return values[3] > values[1] ? "below" : "above";
  };
  assert.equal(bow(slurred(["G4", "A4", "B4", "C5"], "up")), "below");
  assert.equal(bow(slurred(["G4", "A4", "B4", "C5"], "down")), "above");
  assert.equal(bow(slurred(["G4", "A4", "B4", "C5"], "up", "above")), "above");
});

test("a slur rises over a high note between its ends", () => {
  const height = (pitches: string[]) => {
    const values = numbers(paths(pages(treble([slurred(pitches, "down")]))[0])[0]);
    return values[1] - Math.min(values[3], values[5]);
  };
  // The middle note reaches far above the line between the ends, so the curve rises.
  assert.ok(height(["C5", "A6", "C5", "C5"]) > height(["C5", "D5", "C5", "C5"]) + 20);
});

test("a slur across a system break is drawn in both systems", () => {
  const xml = treble([slurred(["C5", "D5", "E5", "F5"], "down").replace(/<notations><slur type="stop"\/><\/notations>/, ""),
    slurred(["C5", "D5", "E5", "F5"], "down").replace(/<notations><slur type="start"\/><\/notations>/, "")]);
  const broken = xml.replace(/<\/measure><measure>/, '</measure><measure><print new-system="yes"/>');
  assert.equal(paths(pages(broken)[0]).length, 2);
  assert.equal(paths(pages(xml)[0]).length, 1);
});

test("a stop closes the slur of its own voice when another voice reuses the number", () => {
  // The bass opens its slur after the treble's and before the treble's stop.
  const [page] = pages(score([piano([
    note("C5", 8, { type: "half", staff: 1, voice: 1, extra: notations('<slur type="start"/>') }) +
      note("E5", 8, { type: "half", staff: 1, voice: 1, extra: notations('<slur type="stop"/>') }) +
      "<backup><duration>16</duration></backup>" +
      note(null, 4, { type: "quarter", staff: 2, voice: 5 }) +
      note("C3", 4, { type: "quarter", staff: 2, voice: 5, extra: notations('<slur type="start"/>') }) +
      note(null, 4, { type: "quarter", staff: 2, voice: 5 }) +
      note("E3", 4, { type: "quarter", staff: 2, voice: 5, extra: notations('<slur type="stop"/>') }),
  ])]));
  const slurs = paths(page).map(numbers);
  assert.equal(slurs.length, 2);
  // Neither slur reaches from one staff to the other: both ends are on one side of the gap.
  // The path starts at one end, (x, y) at 0 and 1, and reaches the other at 6 and 7.
  const gap = (noteheadY(page, "C5") + noteheadY(page, "C3")) / 2;
  for (const values of slurs) assert.equal(values[1] < gap, values[7] < gap);
});

test("articulations go opposite the stem, or where the file places them", () => {
  const marked = (stem: "up" | "down", placement = "") => pages(treble([
    note("B4", 4, { type: "quarter", stem, extra: notations(`<articulations><staccato${placement ? ` placement="${placement}"` : ""}/></articulations>`) }) +
      note(null, 12, { type: "half", dots: 1 }),
  ]))[0];
  assert.equal(glyphs(marked("up"), "articStaccatoBelow").length, 1);
  assert.equal(glyphs(marked("down"), "articStaccatoAbove").length, 1);
  assert.equal(glyphs(marked("up", "above"), "articStaccatoAbove").length, 1);
  // Below a stem-up note: lower on the page than the notehead.
  const page = marked("up");
  assert.ok(glyphs(page, "articStaccatoBelow")[0].y > noteheadY(page, "B4"));
});

test("a fermata's shape picks its glyph, and an inverted one goes below", () => {
  const held = (fermata: string) => pages(treble([
    note("C5", 16, { type: "whole", extra: notations(fermata) }),
  ]))[0];
  assert.equal(glyphs(held("<fermata/>"), "fermataAbove").length, 1);
  assert.equal(glyphs(held("<fermata>angled</fermata>"), "fermataShortAbove").length, 1);
  assert.equal(glyphs(held("<fermata>square</fermata>"), "fermataLongAbove").length, 1);
  assert.equal(glyphs(held("<fermata>double-square</fermata>"), "fermataVeryLongAbove").length, 1);
  const inverted = held('<fermata type="inverted"/>');
  assert.equal(glyphs(inverted, "fermataBelow").length, 1);
  assert.ok(glyphs(inverted, "fermataBelow")[0].y > noteheadY(inverted, "C5"));
});

test("printed fingerings stack by note, and a finger change stands in a row", () => {
  const [page] = pages(treble([
    note("C5", 4, { type: "quarter", stem: "down", extra: notations("<technical><fingering>1</fingering></technical>") }) +
      note("E5", 4, { chord: true, type: "quarter", stem: "down", extra: notations("<technical><fingering>3</fingering></technical>") }) +
      note("G5", 4, { type: "quarter", stem: "down", extra: notations("<technical><fingering>4</fingering><fingering>2</fingering></technical>") }) +
      note(null, 8, { type: "half" }),
  ]));
  const [one] = glyphs(page, "fingering1");
  const [three] = glyphs(page, "fingering3");
  // Above the top staff, the higher note's finger furthest up.
  assert.ok(three.y < one.y);
  assert.ok(one.y < noteheadY(page, "E5"));
  const [four] = glyphs(page, "fingering4");
  const [two] = glyphs(page, "fingering2");
  assert.equal(four.y, two.y);
  assert.ok(two.x > four.x);
});

test("fingerings of a lower staff go below it", () => {
  const [page] = pages(score([piano([
    note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5, extra: notations("<technical><fingering>5</fingering></technical>") }),
  ])]));
  assert.ok(glyphs(page, "fingering5")[0].y > noteheadY(page, "C3"));
});

test("an arpeggio sign stands left of its chord, which makes room for it", () => {
  const chord = (arpeggio: string) => pages(treble([
    note("C5", 16, { type: "whole", extra: notations(arpeggio) }) +
      note("G5", 16, { chord: true, type: "whole", extra: notations(arpeggio) }),
  ]))[0];
  const rolled = chord("<arpeggiate/>");
  const plain = chord("");
  const wiggles = glyphs(rolled, "wiggleArpeggiatoUp");
  assert.ok(wiggles.length >= 2);
  assert.equal(glyphs(plain, "wiggleArpeggiatoUp").length, 0);
  const head = (page: LayoutPage) => page.chords[0].notes[0].items.find((item): item is Glyph => item.kind === "glyph")!;
  assert.ok(head(rolled).x > head(plain).x);
  assert.ok(wiggles.every((wiggle) => wiggle.x < head(rolled).x));
  assert.ok(glyphs(chord('<arpeggiate direction="up"/>'), "wiggleArpeggiatoUpArrow").length === 1);
});

test("arpeggios with one number across a part's staves are drawn as one sign", () => {
  const rolled = (second: string) => pages(score([piano([
    note("C5", 16, { type: "whole", staff: 1, extra: notations("<arpeggiate/>") }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5, extra: notations(second) }),
  ])]))[0];
  const joined = glyphs(rolled("<arpeggiate/>"), "wiggleArpeggiatoUp");
  assert.equal(new Set(joined.map((wiggle) => wiggle.x)).size, 1);
  const separate = glyphs(rolled('<arpeggiate number="2"/>'), "wiggleArpeggiatoUp");
  assert.ok(joined.length > separate.length);
});

test("a trill line starting and stopping on one note runs to the next note", () => {
  const [page] = pages(treble([
    note("C5", 8, { type: "half", extra: notations('<ornaments><trill-mark/><wavy-line type="start"/><wavy-line type="stop"/></ornaments>') }) +
      note("C5", 8, { type: "half" }),
  ]));
  const [trill] = glyphs(page, "ornamentTrill");
  const wiggles = glyphs(page, "wiggleTrill");
  assert.ok(trill && wiggles.length >= 2);
  assert.ok(wiggles.every((wiggle) => wiggle.x > trill.x));
  const next = page.chords[1].notes[0].items.find((item): item is Glyph => item.kind === "glyph")!;
  assert.ok(Math.max(...wiggles.map((wiggle) => wiggle.x)) < next.x);
});

test("a single tremolo crosses its stem", () => {
  const [page] = pages(treble([
    note("C5", 16, { type: "half", stem: "down", extra: notations('<ornaments><tremolo type="single">3</tremolo></ornaments>') }) +
      note(null, 8, { type: "half" }),
  ]));
  assert.equal(glyphs(page, "tremolo3").length, 1);
});

test("text above the staff clears printed fingerings", () => {
  const [page] = pages(treble([
    direction(directionType("<words>Allegro</words>"), "above") +
      note("A5", 4, { type: "quarter", stem: "down", extra: notations("<technical><fingering>3</fingering></technical>") }) +
      note(null, 12, { type: "half", dots: 1 }),
  ]));
  const [words] = texts(page, "Allegro");
  const [three] = glyphs(page, "fingering3");
  const box = glyphBox("fingering3");
  // Above the top of the fingering.
  assert.ok(words.y < three.y + box.top * staffSpace(page) * three.scale);
});

const newSystem = (xml: string) => xml.replace(/<\/measure><measure>/, '</measure><measure><print new-system="yes"/>');

/** The top and bottom lines of each staff on a page, top staff first. */
function staffEdges(page: LayoutPage): { top: number; bottom: number }[] {
  const ys = [...new Set(page.items
    .filter((item): item is Line => item.kind === "line" && item.y1 === item.y2 && item.x2 - item.x1 > 200)
    .map((line) => line.y1))].sort((a, b) => a - b);
  return Array.from({ length: ys.length / 5 }, (_, index) => ({ top: ys[index * 5], bottom: ys[index * 5 + 4] }));
}

/** A dynamic's extent from its glyphs' boxes. */
function dynamicExtent(page: LayoutPage, glyph: Glyph): { top: number; bottom: number } {
  const box = glyphBox(glyph.glyph as Parameters<typeof glyphBox>[0]);
  return { top: glyph.y + box.top * staffSpace(page), bottom: glyph.y + box.bottom * staffSpace(page) };
}

/** Words' extent, as layout measures it: three quarters of the size above the baseline, a quarter below. */
function textExtent(text: Text): { top: number; bottom: number } {
  return { top: text.y - 0.75 * text.size, bottom: text.y + 0.25 * text.size };
}

const staffDistance = (tenths: number) => `<defaults><staff-layout><staff-distance>${tenths}</staff-distance></staff-layout></defaults>`;

const conPed = (defaults = "", dynamic = true) => score([piano([
  (dynamic ? direction(directionType("<dynamics><pp/></dynamics>"), "below", 1) : "") +
    direction(directionType("<words>con ped.</words>"), "above", 2) +
    note("G4", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
    note("E3", 16, { type: "whole", staff: 2, voice: 5 }) +
    note("E4", 16, { chord: true, type: "whole", staff: 2, voice: 5 }),
])], defaults);

test("a mark is placed against its own staff, and the staves move apart until the marks between them clear", () => {
  const [page] = pages(conPed());
  const [words] = texts(page, "con ped.");
  const [pp] = glyphs(page, "dynamicPiano");
  const space = staffSpace(page);
  const [upper] = staffEdges(page);
  // At its note, not moved along the staff.
  const head = page.chords.flatMap((chord) => chord.notes).find((value) => value.key.endsWith("E4"))!
    .items.find((item): item is Glyph => item.kind === "glyph")!;
  assert.ok(Math.abs(words.x - head.x) < space);
  // Between the staves, below the pp and above the bass's E4.
  assert.ok(textExtent(words).top > upper.bottom);
  assert.ok(dynamicExtent(page, pp).bottom <= textExtent(words).top + 1e-6);
  assert.ok(textExtent(words).bottom <= noteheadY(page, "E4") - 0.5 * space + 1e-6);
  // Each sits where it would without the other, and the gap is just wide enough for half a
  // space between them.
  const [alone] = pages(conPed("", false));
  const [aloneWords] = texts(alone, "con ped.");
  const [bass] = staffEdges(page).slice(1);
  assert.ok(Math.abs((bass.top - words.y) - (staffEdges(alone)[1].top - aloneWords.y)) < 1e-6);
  const [single] = pages(treble([direction(directionType("<dynamics><pp/></dynamics>"), "below", 1) + note("G4", 16, { type: "whole" })]));
  const ppReach = dynamicExtent(single, glyphs(single, "dynamicPiano")[0]).bottom - staffEdges(single)[0].bottom;
  const wordsReach = staffEdges(alone)[1].top - textExtent(aloneWords).top;
  assert.ok(Math.abs((bass.top - upper.bottom) - (ppReach + 0.5 * space + wordsReach)) < 1e-6);
});

test("a distance between staves the file sets still grows for the marks between them", () => {
  const [page] = pages(conPed(staffDistance(40)));
  const [words] = texts(page, "con ped.");
  const [pp] = glyphs(page, "dynamicPiano");
  assert.ok(dynamicExtent(page, pp).bottom <= textExtent(words).top + 1e-6);
  assert.ok(textExtent(words).bottom <= noteheadY(page, "E4") - 0.5 * staffSpace(page) + 1e-6);
});

test("a dynamic between a grand staff's staves centres in the room the staves leave it", () => {
  const [page] = pages(score([piano([
    direction(directionType("<dynamics><f/></dynamics>"), "below", 1) +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [forte] = glyphs(page, "dynamicForte");
  const [treble, bass] = staffEdges(page);
  const extent = dynamicExtent(page, forte);
  assert.ok(Math.abs((extent.top - treble.bottom) - (bass.top - extent.bottom)) < 0.01 * staffSpace(page));
});

test("a dynamic with another mark of its staff beyond it stays by its staff", () => {
  const ppY = (words: string) => glyphs(pages(score([piano([
    direction(directionType("<dynamics><pp/></dynamics>"), "below", 1) + words +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]))[0], "dynamicPiano")[0].y;
  const alone = ppY("");
  const blocked = ppY(direction(directionType("<words>dolce</words>"), "below", 1));
  assert.ok(blocked < alone - 0.5);
});

test("cresc. and dim. text is italic, goes below unless placed, and centres like a dynamic", () => {
  const [page] = pages(score([piano([
    direction(directionType("<words>cresc.</words>"), "", 1) +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [words] = texts(page, "cresc.");
  assert.equal(words.runs?.[0].italic, true);
  const [treble, bass] = staffEdges(page);
  const extent = textExtent(words);
  assert.ok(Math.abs((extent.top - treble.bottom) - (bass.top - extent.bottom)) < 0.01 * staffSpace(page));
});

test("a hairpin between a grand staff's staves centres like a dynamic", () => {
  const [page] = pages(score([piano([
    direction(directionType('<wedge type="crescendo"/>'), "below", 1) +
      note("C5", 8, { type: "half", staff: 1, stem: "up" }) +
      direction(directionType('<wedge type="stop"/>'), "below", 1) +
      note("C5", 8, { type: "half", staff: 1, stem: "up" }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const wedge = items(page).filter((item): item is Line => item.kind === "line" && item.y1 !== item.y2 && item.x1 !== item.x2);
  assert.equal(wedge.length, 2);
  const middle = wedge.flatMap((line) => [line.y1, line.y2]).reduce((total, y) => total + y, 0) / 4;
  const [treble, bass] = staffEdges(page);
  assert.ok(Math.abs(middle - (treble.bottom + bass.top) / 2) < 0.01 * staffSpace(page));
});

test("italic words placed below are an expression, centred between the staves", () => {
  const [page] = pages(score([piano([
    direction(directionType('<words font-style="italic">dolce</words>'), "below", 1) +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [words] = texts(page, "dolce");
  const [treble, bass] = staffEdges(page);
  const extent = textExtent(words);
  assert.ok(Math.abs((extent.top - treble.bottom) - (bass.top - extent.bottom)) < 0.01 * staffSpace(page));
});

test("marks centred in one gap above one another move together, keeping clear of each other", () => {
  const [page] = pages(score([piano([
    direction(directionType("<dynamics><f/></dynamics>"), "below", 1) +
      direction(directionType("<words>cresc.</words>"), "above", 2) +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [forte] = glyphs(page, "dynamicForte");
  const [words] = texts(page, "cresc.");
  assert.ok(dynamicExtent(page, forte).bottom <= textExtent(words).top + 1e-6);
});

test("marks above the first system keep it clear of the title", () => {
  const [page] = pages(treble([
    ["Allegro", "dolce", "legato", "cantabile", "rubato"].map((text) => direction(directionType(`<words>${text}</words>`), "above")).join("") +
      note("C5", 16, { type: "whole" }),
  ]).replace("<part-list>", "<work><work-title>Sonata</work-title></work><part-list>"));
  const [title] = texts(page, "Sonata");
  const highest = Math.min(...["Allegro", "dolce", "legato", "cantabile", "rubato"].map((text) => textExtent(texts(page, text)[0]).top));
  assert.ok(highest > title.y + 0.25 * title.size);
});

test("systems move apart when marks above one would reach the notes of the one before", () => {
  const [page] = pages(newSystem(treble([
    note("C3", 16, { type: "whole" }),
    direction(directionType("<words>Allegro</words>"), "above") +
      direction(directionType("<words>dolce</words>"), "above") + note("C5", 16, { type: "whole" }),
  ])));
  const [allegro] = texts(page, "Allegro");
  const [dolce] = texts(page, "dolce");
  const highest = Math.min(textExtent(allegro).top, textExtent(dolce).top);
  const space = staffSpace(page);
  assert.ok(highest >= noteheadY(page, "C3") + 0.5 * space + 0.5 * space - 1e-6);
});

test("segno, coda and SMuFL-named symbols are drawn; names the font lacks are not", () => {
  const [page] = pages(treble([
    direction(directionType("<segno/>"), "above") +
      direction(directionType("<coda/>"), "above") +
      direction(directionType('<other-direction smufl="ornamentTrill"/>'), "above") +
      direction(directionType('<other-direction smufl="notAGlyph"/>'), "above") +
      quarters("C5", 4),
  ]));
  assert.equal(glyphs(page, "segno").length, 1);
  assert.equal(glyphs(page, "coda").length, 1);
  assert.equal(glyphs(page, "ornamentTrill").length, 1);
  assert.ok(!items(page).some((item) => item.kind === "glyph" && (item.glyph as string) === "notAGlyph"));
});


test("a hairpin broken by a system stays partly open where it breaks; a diminuendo opens at its start", () => {
  const hairpin = (type: string) => newSystem(treble([
    direction(directionType(`<wedge type="${type}"/>`), "below") + quarters("C5", 4),
    quarters("C5", 2) + direction(directionType('<wedge type="stop"/>'), "below") + quarters("C5", 2),
  ]));
  const openings = (page: LayoutPage) => {
    const lines = page.items.filter((item): item is Line => item.kind === "line" && item.x1 !== item.x2 && item.y1 !== item.y2);
    const pieces: [number, number][] = [];
    for (let index = 0; index < lines.length; index += 2) {
      pieces.push([Math.abs(lines[index].y1 - lines[index + 1].y1), Math.abs(lines[index].y2 - lines[index + 1].y2)]);
    }
    return pieces;
  };
  const [first, second] = openings(pages(hairpin("crescendo"))[0]);
  assert.equal(first[0], 0);
  assert.ok(first[1] > 0 && first[1] < second[1]);
  assert.ok(Math.abs(second[0] - first[1]) < 0.01);
  const [falling] = openings(pages(treble([
    direction(directionType('<wedge type="diminuendo"/>'), "below") + quarters("C5", 3) +
      direction(directionType('<wedge type="stop"/>'), "below") + quarters("C5", 1),
  ]))[0]);
  assert.ok(falling[0] > 0);
  assert.equal(falling[1], 0);
});

test("a pedal change notches the line, and pedals sit below the part's lowest staff", () => {
  const [page] = pages(score([piano([
    direction(directionType('<pedal type="start" line="yes"/>'), "below", 1) +
      note("C5", 8, { type: "half", staff: 1 }) +
      direction(directionType('<pedal type="change" line="yes"/>'), "below", 1) +
      note("C5", 8, { type: "half", staff: 1 }) +
      direction(directionType('<pedal type="stop" line="yes"/>'), "below", 1) +
      "<backup><duration>16</duration></backup>" + note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
    quarters("C5", 4),
  ])]));
  // Up to the notch and down from it.
  const notch = page.items.filter((item) => item.kind === "line" && item.x1 !== item.x2 && item.y1 !== item.y2);
  assert.equal(notch.length, 2);
  assert.ok(glyphs(page, "keyboardPedalPed")[0].y > noteheadY(page, "C3"));
});

test("an ottava below the staff reads 8vb, two octaves 15ma, and only a stopped one has an end hook", () => {
  const shifted = (type: string, size: number, stop: boolean) => pages(treble([
    direction(directionType(`<octave-shift type="${type}" size="${size}"/>`)) + quarters("C4", 2) +
      (stop ? direction(directionType(`<octave-shift type="stop" size="${size}"/>`)) : "") + quarters("C4", 2),
  ]))[0];
  const hooks = (page: LayoutPage) => page.items.filter((item) => item.kind === "line" && item.x1 === item.x2 && !item.dash && item.width < 3).length;
  const below = shifted("up", 8, true);
  assert.equal(glyphs(below, "ottavaBassa").length, 1);
  assert.ok(glyphs(below, "ottavaBassa")[0].y > noteheadY(below, "t0-C4"));
  assert.equal(glyphs(shifted("down", 15, true), "quindicesimaAlta").length, 1);
  assert.equal(hooks(shifted("down", 8, true)) - hooks(shifted("down", 8, false)), 1);
});

test("the items of one direction follow each other along the line", () => {
  const [page] = pages(treble([
    direction(directionType("<words>dolce</words>") + directionType("<words>legato</words>"), "above") + quarters("C5", 4),
  ]));
  const [dolce] = texts(page, "dolce");
  const [legato] = texts(page, "legato");
  assert.equal(dolce.y, legato.y);
  assert.ok(legato.x > dolce.x + 20);
});

test("a metronome mark is a note at text size, and keeps its parentheses", () => {
  const [page] = pages(treble([
    direction(directionType('<metronome parentheses="yes"><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome>'), "above") +
      quarters("C5", 4),
  ]));
  const [beat] = glyphs(page, "metNoteHalfUp");
  assert.ok(beat && beat.scale < 1);
  assert.equal(texts(page, "(").length, 1);
  assert.equal(texts(page, " = 60)").length, 1);
});

test("a mark below the upper staff of a part stays between its staves", () => {
  // Notes of both staves reach into the gap, so only its middle keeps the words off the bass staff.
  const [page] = pages(score([piano([
    direction(directionType("<words>dolce</words>"), "below", 1) +
      note("E3", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C4", 16, { type: "whole", staff: 2, voice: 5 }) +
      note("A3", 16, { chord: true, type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [words] = texts(page, "dolce");
  // A3 sits on the bass staff's top line.
  assert.ok(words.y < noteheadY(page, "A3"));
});

test("a direction between two onsets is placed between their notes", () => {
  const [page] = pages(treble([
    note("C5", 8, { type: "half" }) + "<backup><duration>4</duration></backup>" +
      direction(directionType("<words>here</words>"), "above") + "<forward><duration>4</duration></forward>" +
      note("C5", 8, { type: "half" }),
  ]));
  const [words] = texts(page, "here");
  const heads = page.chords.map((chord) => chord.notes[0].items.find((item): item is Glyph => item.kind === "glyph")!.x);
  assert.ok(words.x > heads[0] + 5 && words.x < heads[1] - 5);
});

test("a mark inside the staff sits in a space, not on a line", () => {
  const [page] = pages(treble([
    note("B4", 4, { type: "quarter", stem: "up", extra: notations("<articulations><staccato/></articulations>") }) +
      note("D5", 4, { type: "quarter", stem: "down" }) + note(null, 8, { type: "half" }),
  ]));
  // One staff space: from the middle line (B4) to the line above it (D5).
  const space = noteheadY(page, "B4") - noteheadY(page, "D5");
  const [dot] = glyphs(page, "articStaccatoBelow");
  const box = glyphBox("articStaccatoBelow");
  const centre = dot.y + ((box.top + box.bottom) / 2) * space * dot.scale;
  const fromMiddle = (centre - noteheadY(page, "B4")) / space;
  assert.ok(Math.abs(fromMiddle - Math.round(fromMiddle) - 0.5) < 0.05 || Math.abs(fromMiddle - Math.round(fromMiddle) + 0.5) < 0.05);
});

test("articulations on one side stack outward, and an ornament can be placed below", () => {
  const [page] = pages(treble([
    note("G5", 4, {
      type: "quarter", stem: "down",
      extra: notations('<articulations><staccato/><accent/></articulations><ornaments><mordent placement="below"/></ornaments>'),
    }) + note(null, 12, { type: "half", dots: 1 }),
  ]));
  const [staccato] = glyphs(page, "articStaccatoAbove");
  const [accent] = glyphs(page, "articAccentAbove");
  assert.ok(accent.y < staccato.y);
  assert.ok(glyphs(page, "ornamentMordent")[0].y > noteheadY(page, "G5"));
});

test("a tie joins two spellings of one sound, and the second shows its accidental", () => {
  const [page] = pages(treble([
    note("Db5", 4, { type: "quarter", tie: "start", extra: notations('<tied type="start"/>') }) +
      note("C#5", 4, { type: "quarter", tie: "stop", extra: notations('<tied type="stop"/>') }) +
      note("D5", 4, { type: "quarter", tie: "start", extra: notations('<tied type="start"/>') }) +
      note("D5", 4, { type: "quarter", tie: "stop", extra: notations('<tied type="stop"/>') }),
  ]));
  assert.equal(paths(page).length, 2);
  const accidentals = page.chords.map((chord) =>
    chord.notes[0].items.filter((item) => item.kind === "glyph" && item.glyph.startsWith("accidental")).map((item) => (item as Glyph).glyph));
  // The flat, the sharp of the new spelling, the natural the flat calls for, and nothing on the tied D.
  assert.deepEqual(accidentals, [["accidentalFlat"], ["accidentalSharp"], ["accidentalNatural"], []]);
});

const triplet = (start: string, stop = false) =>
  `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
  notations(`${start}${stop ? '<tuplet type="stop"/>' : ""}`);
/** Three triplet quarters with their stems up, unbeamed so the tuplet has a bracket, then a half rest. */
const tripletQuarters = (pitches: [string, string, string]) =>
  note(pitches[0], 2, { type: "quarter", stem: "up", extra: triplet('<tuplet type="start"/>') }) +
  note(pitches[1], 3, { type: "quarter", stem: "up", extra: triplet("") }) +
  note(pitches[2], 3, { type: "quarter", stem: "up", extra: triplet("", true) }) +
  note(null, 8, { type: "half" });
/** The tuplet bracket's long lines: as thin as a bracket, neither vertical nor a staff line. */
const bracketLines = (page: LayoutPage) => page.items.filter((item): item is Line =>
  item.kind === "line" && item.width < staffSpace(page) * 0.13 && item.x1 !== item.x2 && item.x2 - item.x1 < 200);

test("a tuplet number is MuseScore's 9 pt italic text, scaled with the staff", () => {
  const [page] = pages(treble([tripletQuarters(["C5", "C5", "C5"])]));
  const [three] = texts(page, "3");
  assert.ok(three.runs!.every((run) => run.italic));
  assert.equal(three.anchor, "middle");
  // 9 pt at a 1.75 mm staff space.
  assert.ok(Math.abs(three.size / staffSpace(page) - (9 / 72) * 25.4 / 1.75) < 1e-3);
});

test("a tuplet's line follows its notes' slope, at most 0.5, clear of every note", () => {
  const [page] = pages(treble([tripletQuarters(["D4", "F4", "A4"])]));
  const space = staffSpace(page);
  const [left, right] = bracketLines(page).sort((a, b) => a.x1 - b.x1);
  const slope = (right.y2 - left.y1) / (right.x2 - left.x1);
  assert.ok(slope < -0.1, "it rises with the notes");
  const [three] = texts(page, "3");
  // The number sits on the line, between its ends.
  assert.ok(three.y < left.y1 + space && three.y > right.y2);
  const [steep] = pages(treble([tripletQuarters(["C4", "G4", "E5"])]));
  const [steepLeft, steepRight] = bracketLines(steep).sort((a, b) => a.x1 - b.x1);
  assert.ok(Math.abs((steepRight.y2 - steepLeft.y1) / (steepRight.x2 - steepLeft.x1) + 0.5) < 1e-6, "no steeper than 0.5");
  // Every stem end keeps its distance from the line: the middle note's too.
  const [middle] = pages(treble([tripletQuarters(["C4", "A5", "C4"])]));
  const [line] = bracketLines(middle);
  const stemTop = Math.min(...middle.chords.flatMap((chord) => chord.items)
    .filter((item): item is Line => item.kind === "line" && item.x1 === item.x2).map((item) => Math.min(item.y1, item.y2)));
  assert.ok(line.y1 <= stemTop - staffSpace(middle) + 1e-6);
});

test("directions keep clear of tuplet numbers", () => {
  const [page] = pages(treble([
    direction(directionType("<metronome><beat-unit>quarter</beat-unit><per-minute>140</per-minute></metronome>"), "above") +
      note("A5", 1, { type: "eighth", beams: ["begin"], extra: triplet('<tuplet type="start" placement="above"/>') }) +
      note("B5", 1, { type: "eighth", beams: ["continue"], extra: triplet("") }) +
      note("C6", 2, { type: "eighth", beams: ["end"], extra: triplet("", true) }) +
      note(null, 12, { type: "half", dots: 1 }),
  ]));
  const [three] = texts(page, "3");
  const [tempo] = texts(page, " = 140");
  const space = staffSpace(page);
  // The tempo's descent stays above the number's top.
  assert.ok(tempo.y + 0.25 * tempo.size < three.y - 0.68 * three.size - 0.2 * space + 1e-6);
});

test("a dynamic between the staves moves toward the gap's middle, but not into a low note", () => {
  const low = pages(score([piano([
    direction(directionType("<dynamics><f/></dynamics>"), "below", 1) +
      note("A3", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]))[0];
  const space = staffSpace(low);
  const [forte] = glyphs(low, "dynamicForte");
  const noteBottom = noteheadY(low, "A3") + 0.5 * space;
  assert.ok(forte.y + glyphBox("dynamicForte").top * space >= noteBottom + 0.5 * space - 1e-6,
    "half a space below the note");
  const high = pages(score([piano([
    direction(directionType("<dynamics><f/></dynamics>"), "below", 1) +
      note("C5", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]))[0];
  const [middle] = glyphs(high, "dynamicForte");
  assert.ok(middle.y < forte.y, "under a note in the staff it stays nearer the staff");
});

test("directions keep clear of slurs where they pass over them", () => {
  const [page] = pages(treble([
    direction(directionType("<words>dolce espressivo</words>"), "above") + slurred(["G5", "B5", "D6", "G5"], "down", "above"),
  ]));
  const [words] = texts(page, "dolce espressivo");
  // The slur's outer curve, sampled where the words are.
  const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = numbers(paths(page)[0]);
  const right = words.x + words.text.length * words.size * 0.45;
  const under = Array.from({ length: 101 }, (_, index) => index / 100).map((t) => {
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2,
    };
  }).filter((point) => point.x >= words.x && point.x <= right);
  assert.ok(under.length > 0, "the words are over the slur");
  assert.ok(words.y + 0.25 * words.size <= Math.min(...under.map((point) => point.y)) + 1e-6);
});

test("a tempo's words and metronome mark share a baseline, and note characters are drawn as notes", () => {
  const [page] = pages(treble([
    direction(directionType("<words>\u2669.=\u2669</words>") + directionType("<metronome><beat-unit>quarter</beat-unit><per-minute>140</per-minute></metronome>"), "above") +
      slurred(["G5", "B5", "D6", "G5"], "down", "above"),
  ]));
  const [label] = texts(page, " = 140");
  const notes = glyphs(page, "metNoteQuarterUp").sort((a, b) => a.x - b.x);
  assert.equal(notes.length, 3, "two from the words, one from the metronome mark");
  assert.deepEqual(texts(page, "="), [texts(page, "=")[0]]);
  const [equals] = texts(page, "=");
  const [dot] = glyphs(page, "metAugmentationDot");
  assert.ok(dot.x > notes[0].x && dot.x < equals.x, "the dot follows its note");
  for (const item of [...notes, equals, dot]) assert.ok(Math.abs(item.y - label.y) < 1e-6, "on one baseline");
  assert.ok(notes[1].x < notes[2].x - glyphBox("metNoteQuarterUp").right * notes[1].scale * staffSpace(page), "side by side");
});

/** The distance from a page's first staff's bottom line to its second staff's top line. */
const firstGap = (page: LayoutPage) => staffEdges(page)[1].top - staffEdges(page)[0].bottom;

test("marks of two staves that are not above one another leave the gap between them as it is", () => {
  const twoBars = (dynamic: boolean) => pages(score([piano([
    (dynamic ? direction(directionType("<dynamics><pp/></dynamics>"), "below", 1) : "") +
      note("G4", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
    note("G4", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      direction(directionType("<words>con ped.</words>"), "above", 2) +
      note("E3", 16, { type: "whole", staff: 2, voice: 5 }) +
      note("E4", 16, { chord: true, type: "whole", staff: 2, voice: 5 }),
  ])]))[0];
  assert.ok(Math.abs(firstGap(twoBars(true)) - firstGap(twoBars(false))) < 1e-6);
});

test("chord marks, slurs and tuplets below a staff count toward the room its gap needs", () => {
  // The bass staff's high notes reach up toward what hangs below the treble staff.
  const gap = (upper: string) => firstGap(pages(score([piano([
    upper + "<backup><duration>16</duration></backup>" +
      note("G4", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]))[0]);
  const plain = gap(quarters("A3", 4, { stem: "up" }));
  const staccato = notations('<articulations><staccato placement="below"/></articulations>');
  const below = '<tuplet type="start" placement="below"/>';
  for (const [kind, upper] of [
    ["chord marks", quarters("A3", 4, { stem: "up", extra: staccato })],
    ["slur", slurred(["A3", "A3", "A3", "A3"], "up")],
    ["tuplet", note("A3", 2, { type: "quarter", stem: "up", extra: triplet(below) }) +
      note("A3", 3, { type: "quarter", stem: "up", extra: triplet("") }) +
      note("A3", 3, { type: "quarter", stem: "up", extra: triplet("", true) }) + note(null, 8, { type: "half" })],
  ]) {
    assert.ok(gap(upper) > plain + 0.1, kind);
  }
});

test("a trill line continued into the next system stays with its staff", () => {
  const gap = (trill: boolean) => firstGap(pages(newSystem(score([piano([
    note("C5", 16, { type: "whole", staff: 1, extra: trill ? notations('<ornaments><trill-mark/><wavy-line type="start"/></ornaments>') : "" }) +
      "<backup><duration>16</duration></backup>" + note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
    note("C5", 16, { type: "whole", staff: 1, extra: trill ? notations('<ornaments><wavy-line type="stop"/></ornaments>') : "" }) +
      "<backup><duration>16</duration></backup>" + note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])])))[0]);
  assert.ok(Math.abs(gap(true) - gap(false)) < 1e-6);
});

test("a slur or tuplet between two staves does not move them apart", () => {
  const slur = (marked: boolean) => firstGap(pages(score([piano([
    note("C5", 16, { type: "whole", staff: 1, extra: marked ? notations('<slur type="start"/>') : "" }) +
      "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5, extra: marked ? notations('<slur type="stop"/>') : "" }),
  ])]))[0]);
  assert.ok(Math.abs(slur(true) - slur(false)) < 1e-6, "slur");
  const tuplet = (marked: boolean) => firstGap(pages(score([piano([
    note("E4", 2, { type: "quarter", stem: "up", extra: marked ? triplet('<tuplet type="start" placement="below"/>') : "" }) +
      note("C3", 3, { type: "quarter", stem: "up", staff: 2, extra: marked ? triplet("") : "" }) +
      note("E4", 3, { type: "quarter", stem: "up", extra: marked ? triplet("", true) : "" }) + note(null, 8, { type: "half" }),
  ])]))[0]);
  assert.ok(Math.abs(tuplet(true) - tuplet(false)) < 1e-6, "tuplet");
});

test("marks of either staff keep clear of a slur between the staves", () => {
  const [page] = pages(score([piano([
    note("C5", 8, { type: "half", staff: 1, stem: "down", extra: notations('<slur type="start" placement="below"/>') }) +
      note(null, 8, { type: "half", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      direction(directionType("<words>con ped.</words>"), "above", 2) +
      note(null, 8, { type: "half", staff: 2, voice: 5 }) +
      note("C3", 8, { type: "half", staff: 2, voice: 5, extra: notations('<slur type="stop"/>') }),
  ])]));
  const [words] = texts(page, "con ped.");
  const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = numbers(paths(page)[0]);
  const right = words.x + words.text.length * words.size * 0.45;
  const extent = textExtent(words);
  const inside = Array.from({ length: 201 }, (_, index) => index / 200).map((t) => {
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2,
    };
  }).filter((point) => point.x >= words.x && point.x <= right && point.y >= extent.top && point.y <= extent.bottom);
  assert.deepEqual(inside, []);
});

/** A hairpin's two lines: neither horizontal nor vertical. */
const hairpinLines = (page: LayoutPage) =>
  items(page).filter((item): item is Line => item.kind === "line" && item.y1 !== item.y2 && item.x1 !== item.x2);
const middleOf = (lines: Line[]) => lines.flatMap((line) => [line.y1, line.y2]).reduce((total, y) => total + y, 0) / (2 * lines.length);
const centreOf = (extent: { top: number; bottom: number }) => (extent.top + extent.bottom) / 2;

const wedge = (type: string) => direction(directionType(`<wedge type="${type}"/>`), "below", 1);
const dynamic = (letter: string, staff = 1) => direction(directionType(`<dynamics><${letter}/></dynamics>`), "below", staff);

test("a hairpin starts and ends half a space from the dynamics at its ends", () => {
  const [page] = pages(treble([
    dynamic("p") + wedge("crescendo") + note("C5", 8, { type: "half" }) + wedge("stop") + dynamic("f") + note("C5", 8, { type: "half" }),
  ]));
  const space = staffSpace(page);
  const [piano_] = glyphs(page, "dynamicPiano");
  const [forte] = glyphs(page, "dynamicForte");
  const lines = hairpinLines(page);
  const left = Math.min(...lines.map((line) => line.x1));
  const right = Math.max(...lines.map((line) => line.x2));
  assert.ok(Math.abs(left - (piano_.x + glyphWidth("dynamicPiano") * space + 0.5 * space)) < 1e-6);
  assert.ok(Math.abs(right - (forte.x - 0.5 * space)) < 1e-6);
});

test("a hairpin ending where the next one starts stays on its line", () => {
  const [page] = pages(treble([
    wedge("crescendo") + note("C5", 8, { type: "half" }) + wedge("stop") + wedge("diminuendo") + note("C5", 8, { type: "half" }),
    wedge("stop") + note("C5", 16, { type: "whole" }),
  ]));
  const lines = hairpinLines(page).sort((a, b) => a.x1 - b.x1);
  assert.equal(lines.length, 4);
  // Where a hairpin on its own would be.
  const [alone] = pages(treble([wedge("crescendo") + note("C5", 8, { type: "half" }) + wedge("stop") + note("C5", 8, { type: "half" })]));
  assert.ok(Math.abs(middleOf(lines.slice(0, 2)) - middleOf(hairpinLines(alone))) < 1e-6);
  assert.ok(Math.abs(middleOf(lines.slice(2)) - middleOf(hairpinLines(alone))) < 1e-6);
});

test("a dynamic above the staff and a hairpin below it are not snapped together", () => {
  const [page] = pages(treble([
    direction(directionType("<dynamics><p/></dynamics>"), "above", 1) + wedge("crescendo") + note("C5", 8, { type: "half" }) +
      wedge("stop") + note("C5", 8, { type: "half" }),
  ]));
  const [staff] = staffEdges(page);
  const [piano_] = glyphs(page, "dynamicPiano");
  assert.ok(dynamicExtent(page, piano_).bottom < staff.top);
  assert.ok(middleOf(hairpinLines(page)) > staff.bottom);
  // Nor does the hairpin make room for the dynamic.
  assert.ok(Math.min(...hairpinLines(page).map((line) => line.x1)) < piano_.x + glyphWidth("dynamicPiano") * staffSpace(page));
});

test("dynamics and the hairpins between them line up with the one furthest from the staff", () => {
  // A low note under the forte pushes it down; the piano and the hairpin follow it.
  const [page] = pages(treble([
    dynamic("p") + wedge("crescendo") + note("C5", 8, { type: "half" }) + wedge("stop") + dynamic("f") + note("A3", 8, { type: "half", stem: "up" }),
  ]));
  const [piano_] = glyphs(page, "dynamicPiano");
  const [forte] = glyphs(page, "dynamicForte");
  const centre = centreOf(dynamicExtent(page, forte));
  assert.ok(Math.abs(centreOf(dynamicExtent(page, piano_)) - centre) < 1e-6);
  assert.ok(Math.abs(middleOf(hairpinLines(page)) - centre) < 1e-6);
});

/** A grand staff with p, a crescendo and f below the treble staff; `bass` sets the bass staff's two halves. */
const chainBetween = (bass: [string, string], extra = "") => pages(score([piano([
  dynamic("p") + wedge("crescendo") + note("C5", 8, { type: "half", staff: 1, stem: "up" }) +
    wedge("stop") + dynamic("f") + extra + note("C5", 8, { type: "half", staff: 1, stem: "up" }) +
    "<backup><duration>16</duration></backup>" +
    note(bass[0], 8, { type: "half", staff: 2, voice: 5, stem: "down" }) +
    note(bass[1], 8, { type: "half", staff: 2, voice: 5, stem: "down" }),
])]))[0];

test("a chain of dynamics and hairpins centres between the staves as one", () => {
  // The bass reaches up under the forte only.
  const page = chainBetween(["C3", "E4"]);
  const [piano_] = glyphs(page, "dynamicPiano");
  const [forte] = glyphs(page, "dynamicForte");
  assert.ok(Math.abs(centreOf(dynamicExtent(page, piano_)) - centreOf(dynamicExtent(page, forte))) < 1e-6);
  assert.ok(Math.abs(middleOf(hairpinLines(page)) - centreOf(dynamicExtent(page, forte))) < 1e-6);
});

test("a chain with a mark of its staff beyond one of its marks stays by its staff", () => {
  const free = chainBetween(["C3", "C3"]);
  const page = chainBetween(["C3", "C3"], direction(directionType("<words>dolce</words>"), "below", 1));
  const [piano_] = glyphs(page, "dynamicPiano");
  const [forte] = glyphs(page, "dynamicForte");
  assert.ok(Math.abs(centreOf(dynamicExtent(page, piano_)) - centreOf(dynamicExtent(page, forte))) < 1e-6);
  assert.ok(piano_.y < glyphs(free, "dynamicPiano")[0].y - 0.5);
});

/** `count` one-bar systems of a treble staff, the file setting `tenths` between them. */
const spacedSystems = (count: number, tenths: number) => pages(treble(Array.from({ length: count }, () => note("C5", 16, { type: "whole" })))
  .replace(/<measure>/g, '<measure><print new-system="yes"/>')
  .replace("<part-list>", `<defaults><system-layout><system-distance>${tenths}</system-distance></system-layout></defaults><part-list>`));
const systemGaps = (page: LayoutPage) => {
  const edges = staffEdges(page);
  return edges.slice(1).map((edge, index) => (edge.top - edges[index].bottom) / staffSpace(page));
};

test("a page keeps the distances the file sets between its systems while they fit", () => {
  const [page] = spacedSystems(2, 200);
  assert.ok(systemGaps(page).every((gap) => Math.abs(gap - 20) < 1e-6));
});

test("a page too small for the file's distances gives every system the same share of what it has beyond the least", () => {
  const result = spacedSystems(10, 400);
  assert.equal(result.length, 1);
  const gaps = systemGaps(result[0]);
  assert.equal(gaps.length, 9);
  assert.ok(gaps.every((gap) => gap >= 8.5 - 1e-6 && gap < 40 && Math.abs(gap - gaps[0]) < 1e-6));
  // The page is filled to its bottom margin.
  const edges = staffEdges(result[0]);
  const format = pageFormat(parseMusicXml(treble([note("C5", 16, { type: "whole" })])).defaults);
  assert.ok(Math.abs(edges[edges.length - 1].bottom - (format.height - format.margins.bottom)) < 1e-6);
});

test("a distance the file sets below MuseScore's least is kept", () => {
  const [page] = spacedSystems(2, 50);
  assert.ok(systemGaps(page).every((gap) => Math.abs(gap - 5) < 1e-6));
});

test("chords beamed across staves count with their notes only, and their marks and slurs with neither staff", () => {
  // The treble notes' stems reach down to a beam below the bass staff, and their slur and
  // accents go there with them, past the words above the bass staff. The file sets the
  // staves' distance, so only what reaches into the gap can widen it.
  const accent = '<articulations><accent placement="below"/></articulations>';
  const [page] = pages(score([piano([
    direction(directionType("<words>con ped. sempre</words>"), "above", 2) +
      note("E2", 2, { type: "eighth", staff: 2, stem: "down", beams: ["begin"] }) +
      note("C5", 2, { type: "eighth", staff: 1, stem: "down", beams: ["continue"], extra: notations(`<slur type="start" placement="below"/>${accent}`) }) +
      note("A4", 2, { type: "eighth", staff: 1, stem: "down", beams: ["continue"], extra: notations(`<slur type="stop"/>${accent}`) }) +
      note("C2", 2, { type: "eighth", staff: 2, stem: "down", beams: ["end"] }) +
      note(null, 8, { type: "half" }),
  ])], staffDistance(65)));
  assert.ok(Math.abs(firstGap(page) / staffSpace(page) - 6.5) < 1e-6);
});

test("a tuplet of chords beamed across staves belongs to neither staff", () => {
  const triplet12 = (start: string, stop = false) =>
    `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
    notations(`${start}${stop ? '<tuplet type="stop"/>' : ""}`);
  const [page] = pages(score([piano([
    direction(directionType("<words>con ped. sempre</words>"), "above", 2) +
      note("E2", 6, { type: "eighth", staff: 2, stem: "down", beams: ["begin"] }) +
      note("C5", 4, { type: "eighth", staff: 1, stem: "down", beams: ["continue"], extra: triplet12('<tuplet type="start" placement="below"/>') }) +
      note("A4", 4, { type: "eighth", staff: 1, stem: "down", beams: ["continue"], extra: triplet12("") }) +
      note("C5", 4, { type: "eighth", staff: 1, stem: "down", beams: ["continue"], extra: triplet12("", true) }) +
      note("C2", 6, { type: "eighth", staff: 2, stem: "down", beams: ["end"] }) +
      note(null, 24, { type: "half" }),
  ], { divisions: 12 })], staffDistance(65)));
  assert.ok(texts(page, "3").length === 1);
  assert.ok(Math.abs(firstGap(page) / staffSpace(page) - 6.5) < 1e-6);
});

test("a dynamic centres between the staves past the stems of chords beamed across them", () => {
  const [page] = pages(score([piano([
    note("E2", 2, { type: "eighth", staff: 2, stem: "down", beams: ["begin"] }) + dynamic("f") +
      note("C5", 2, { type: "eighth", staff: 1, stem: "down", beams: ["continue"] }) +
      note("A4", 2, { type: "eighth", staff: 1, stem: "down", beams: ["continue"] }) +
      note("C2", 2, { type: "eighth", staff: 2, stem: "down", beams: ["end"] }) +
      note(null, 8, { type: "half" }),
  ])]));
  const [forte] = glyphs(page, "dynamicForte");
  const [treble, bass] = staffEdges(page);
  assert.ok(Math.abs(centreOf(dynamicExtent(page, forte)) - (treble.bottom + bass.top) / 2) < 0.01 * staffSpace(page));
});

test("an expression at a dynamic's place follows it on its line", () => {
  const [page] = pages(treble([
    dynamic("p") + direction(directionType('<words font-style="italic">espress.</words>'), "below", 1) +
      note("C5", 8, { type: "half" }) + note("A3", 8, { type: "half", stem: "up" }),
  ]));
  const [piano_] = glyphs(page, "dynamicPiano");
  const [words] = texts(page, "espress.");
  const space = staffSpace(page);
  assert.ok(Math.abs(words.x - (piano_.x + glyphWidth("dynamicPiano") * space + 0.5 * space)) < 1e-6);
  assert.ok(Math.abs(centreOf(textExtent(words)) - centreOf(dynamicExtent(page, piano_))) < 1e-6);
});

test("an expression on the other side of the staff from a dynamic does not follow it", () => {
  const [page] = pages(treble([
    direction(directionType("<dynamics><p/></dynamics>"), "above", 1) +
      direction(directionType('<words font-style="italic">espress.</words>'), "below", 1) + note("C5", 16, { type: "whole" }),
  ]));
  const [piano_] = glyphs(page, "dynamicPiano");
  const [words] = texts(page, "espress.");
  assert.ok(words.x < piano_.x + glyphWidth("dynamicPiano") * staffSpace(page));
});

test("expressions side by side ignore each other, as dynamics and hairpins do", () => {
  const [page] = pages(treble([
    direction(directionType('<words font-style="italic">molto espressivo e legato</words>'), "below", 1) + note("C5", 4, { type: "quarter" }) +
      direction(directionType('<words font-style="italic">dolce</words>'), "below", 1) + note("C5", 12, { type: "half", dots: 1 }),
  ]));
  assert.ok(Math.abs(texts(page, "molto espressivo e legato")[0].y - texts(page, "dolce")[0].y) < 1e-6);
});

test("a page break of the file after a page that ran out of room lets the systems flow on", () => {
  // Eleven of these systems fit on a page. The file breaks the page before the thirteenth,
  // but the twelfth has already moved to a page of its own.
  const broken = (systems: number, breaks: number[]) => {
    let count = 0;
    return pages(treble(Array.from({ length: systems }, () => note("C5", 16, { type: "whole" }))).replace(/<measure>/g, () => {
      count += 1;
      return `<measure><print new-system="yes"${breaks.includes(count) ? ' new-page="yes"' : ""}/>`;
    })).map((page) => staffEdges(page).length);
  };
  assert.deepEqual(broken(15, [13]), [11, 4]);
  // Pages that begin where the file breaks keep its next break.
  assert.deepEqual(broken(6, [3, 5]), [2, 2, 2]);
});

test("distances a measure's print sets are left out, as MuseScore's import leaves them out", () => {
  const plain = pages(score([piano([note("C5", 16, { type: "whole" }), note("C5", 16, { type: "whole" })])]))[0];
  const printed = pages(score([piano([
    note("C5", 16, { type: "whole" }),
    note("C5", 16, { type: "whole" }),
  ].map((content) => '<print new-system="yes"><system-layout><system-distance>400</system-distance>' +
    `<top-system-distance>300</top-system-distance></system-layout><staff-layout number="2"><staff-distance>200</staff-distance></staff-layout></print>` +
    content))]))[0];
  const space = staffSpace(plain);
  // The same staves as the plain score's first system, with the same distance between systems.
  const edges = staffEdges(printed);
  assert.equal(edges.length, 4);
  assert.ok(Math.abs(edges[0].top - staffEdges(plain)[0].top) < 1e-6);
  assert.ok(Math.abs((edges[1].top - edges[0].bottom) / space - 6.5) < 1e-6);
  assert.ok(Math.abs((edges[2].top - edges[1].bottom) / space - 8.5) < 1e-6);
});

/** The beams' filled shapes on a page. */
const beamPolygons = (page: LayoutPage) =>
  items(page).filter((item): item is Extract<Drawable, { kind: "polygon" }> => item.kind === "polygon");

test("stems running to a beam across staves leave the distance between the staves as it is", () => {
  // The beam runs below the bass staff, or above the treble staff, not between them.
  for (const stem of ["down", "up"] as const) {
    const [page] = pages(score([piano([
      note("C4", 2, { type: "eighth", staff: 2, stem, beams: ["begin"] }) +
        note("C4", 2, { type: "eighth", staff: 1, stem, beams: ["continue"] }) +
        note("D4", 2, { type: "eighth", staff: 1, stem, beams: ["continue"] }) +
        note("C4", 2, { type: "eighth", staff: 2, stem, beams: ["end"] }) +
        note(null, 8, { type: "half" }),
    ])]));
    assert.ok(Math.abs(firstGap(page) / staffSpace(page) - 6.5) < 1e-6, stem);
  }
});

test("a beam across staves between them gets room for a kneed stem on either side", () => {
  const [page] = pages(score([piano([
    note("F3", 2, { type: "eighth", staff: 1, stem: "down", beams: ["begin"] }) +
      note("G4", 2, { type: "eighth", staff: 2, stem: "up", beams: ["end"] }) +
      note(null, 4, { type: "quarter" }) + note(null, 8, { type: "half" }),
  ])]));
  const ys = beamPolygons(page).flatMap((polygon) => polygon.points.filter((_, index) => index % 2 === 1));
  assert.ok(ys.length > 0);
  const space = staffSpace(page);
  assert.ok(Math.min(...ys) > noteheadY(page, "F3") + 0.5 * space);
  assert.ok(Math.max(...ys) < noteheadY(page, "G4") - 0.5 * space);
  // Two kneed stems of 2.5 spaces and the beam's thickness, no more.
  assert.ok(Math.abs((noteheadY(page, "G4") - noteheadY(page, "F3")) / space - (5 + ENGRAVING_DEFAULTS.beamThickness)) < 1e-6);
});
