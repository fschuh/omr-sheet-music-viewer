import assert from "node:assert/strict";
import test from "node:test";
import { glyphBox } from "../fonts/smufl";
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

test("text that would be pushed into a staff moves along its line instead", () => {
  const [page] = pages(score([piano([
    direction(directionType("<dynamics><p/></dynamics>"), "below", 1) +
      direction(directionType("<words>con ped.</words>"), "above", 2) +
      note("C4", 16, { type: "whole", staff: 1 }) + "<backup><duration>16</duration></backup>" +
      note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const [words] = texts(page, "con ped.");
  const [piano_] = glyphs(page, "dynamicPiano");
  assert.ok(words.x > piano_.x);
  // Between the staves: below the treble staff's bottom line.
  assert.ok(words.y > noteheadY(page, "C4") - 5);
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

const newSystem = (xml: string) => xml.replace(/<\/measure><measure>/, '</measure><measure><print new-system="yes"/>');

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
