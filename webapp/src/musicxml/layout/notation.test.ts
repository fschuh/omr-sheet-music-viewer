import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import type { Drawable, LayoutPage } from "../model/layout";
import { attributes, backup, barline, measure, note, part, piano, score } from "../testScores";
import { avoidRestCollisions, layoutChord, type ChordShape } from "./chords";
import { pageCredits, titleBlock } from "./credits";
import { prepareScore, type PreparedChord } from "./measureContent";
import { pageFormat } from "./pageFormat";
import { layoutScore } from "./pages";
import { keyCancellation } from "./staffPosition";

function pages(xml: string): LayoutPage[] {
  const parsed = parseMusicXml(xml);
  return layoutScore(parsed, pageFormat(parsed.defaults)).pages;
}

function items(page: LayoutPage): Drawable[] {
  return [...page.items, ...page.chords.flatMap((chord) => [...chord.items, ...chord.notes.flatMap((value) => value.items)])];
}

function glyphs(page: LayoutPage, name: string): Drawable[] {
  return items(page).filter((item) => item.kind === "glyph" && item.glyph === name);
}

const treble = (content: string[], first = "") =>
  score([part("P1", content.map((value, index) =>
    measure((index === 0 ? attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: ["G"] }) + first : "") + value)))]);

test("a tie joins two notes, bowing away from their stems", () => {
  const [page] = pages(treble([
    note("G4", 8, { type: "half", stem: "up", tie: "start", extra: "<notations><tied type=\"start\"/></notations>" }) +
      note("G4", 8, { type: "half", stem: "up", tie: "stop" }),
  ]));
  const ties = page.items.filter((item) => item.kind === "path");
  assert.equal(ties.length, 1);
  const values = (ties[0] as { d: string }).d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // Below the noteheads: the control points sit lower (larger y) than the ends.
  assert.ok(values[3] > values[1]);
});

test("a tie across a system break is drawn in both systems", () => {
  const bars = Array.from({ length: 2 }, (_, index) =>
    note("C5", 16, { type: "whole", tie: index === 0 ? "start" : "stop" }));
  const [page] = pages(treble([bars[0], bars[1]]).replace("<measure><note", '<measure><note').replace(/<measure>(?=<note><pitch><step>C<\/step><octave>5<\/octave><\/pitch><duration>16<\/duration><tie type="stop")/, '<measure><print new-system="yes"/>'));
  const ties = page.items.filter((item) => item.kind === "path");
  assert.equal(ties.length, 2);
});

const triplet = (start: string, stop = false) =>
  `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` +
  `<notations>${start}${stop ? '<tuplet type="stop"/>' : ""}</notations>`;

test("a tuplet shows its number, and a bracket when its notes are not beamed together", () => {
  const beamed = pages(treble([
    note("C5", 1, { type: "eighth", beams: ["begin"], extra: triplet('<tuplet type="start"/>') }) +
      note("D5", 1, { type: "eighth", beams: ["continue"], extra: triplet("") }) +
      note("E5", 2, { type: "eighth", beams: ["end"], extra: triplet("", true) }) +
      note(null, 12, { type: "half", dots: 1 }),
  ]))[0];
  assert.equal(glyphs(beamed, "tuplet3").length, 1);
  const lines = (page: LayoutPage) => page.items.filter((item) => item.kind === "line" && item.width < page.staffSpace * 0.15 && item.y1 !== item.y2).length;
  const unbeamed = pages(treble([
    note("C5", 2, { type: "quarter", extra: triplet('<tuplet type="start"/>') }) +
      note("D5", 3, { type: "quarter", extra: triplet("") }) +
      note("E5", 3, { type: "quarter", extra: triplet("", true) }) +
      note(null, 8, { type: "half" }),
  ]))[0];
  assert.equal(glyphs(unbeamed, "tuplet3").length, 1);
  assert.ok(lines(unbeamed) > lines(beamed), "the bracket's hooks are drawn");
  const hidden = pages(treble([
    note("C5", 1, { type: "eighth", beams: ["begin"], extra: triplet('<tuplet type="start" bracket="no" show-number="none"/>') }) +
      note("D5", 1, { type: "eighth", beams: ["continue"], extra: triplet("") }) +
      note("E5", 2, { type: "eighth", beams: ["end"], extra: triplet("", true) }) +
      note(null, 12, { type: "half", dots: 1 }),
  ]))[0];
  assert.equal(glyphs(hidden, "tuplet3").length, 0);
});

test("repeat signs draw their dots on every staff, and voltas their text", () => {
  const [page] = pages(score([piano([
    barline("left", '<repeat direction="forward"/>') + note("C5", 16, { type: "whole" }),
    barline("left", '<ending number="1" type="start">1.</ending>') + note("D5", 16, { type: "whole" }) +
      barline("right", '<bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/>'),
    barline("left", '<ending number="2" type="start"/>') + note("E5", 16, { type: "whole" }) +
      barline("right", '<ending number="2" type="discontinue"/>'),
  ])]));
  // A start repeat and an end repeat, each with dots on both staves.
  assert.equal(glyphs(page, "repeatDots").length, 4);
  const texts = page.items.filter((item) => item.kind === "text").map((item) => (item as { text: string }).text);
  assert.ok(texts.includes("1.") && texts.includes("2."));
});

test("an ending the file leaves open stops at the next start-repeat", () => {
  const [page] = pages(treble([
    barline("left", '<ending number="2" type="start"/>') + note("C5", 16, { type: "whole" }),
    note("D5", 16, { type: "whole" }),
    barline("left", '<repeat direction="forward"/>') + note("E5", 16, { type: "whole" }),
    note("F5", 16, { type: "whole" }) + barline("right", '<repeat direction="backward"/>'),
  ]));
  const voltaY = (page.items.find((item) => item.kind === "text" && item.text === "2.") as { y: number }).y;
  const repeatX = (glyphs(page, "repeatDots")[0] as { x: number }).x;
  // The volta's line sits one text size above the text's baseline.
  const lineY = voltaY - 1.6 * page.staffSpace;
  const voltaLines = page.items.filter((item) =>
    item.kind === "line" && item.y1 === item.y2 && Math.abs(item.y1 - lineY) < 1e-6);
  assert.ok(voltaLines.length > 0);
  for (const line of voltaLines) assert.ok((line as { x2: number }).x2 < repeatX, "the volta ends before the start-repeat");
});

type Text = Extract<Drawable, { kind: "text" }>;
const texts = (values: Drawable[]) => values.filter((item): item is Text => item.kind === "text");
const textOf = (values: Drawable[], text: string) => texts(values).find((item) => item.text === text)!;
/** The top staff line of the page's first system. */
const firstStaffTop = (page: LayoutPage) =>
  Math.min(...page.items.flatMap((item) => (item.kind === "line" && item.y1 === item.y2 ? [item.y1] : [])));
/** A one-measure score whose first measure asks for `top` tenths above its system. */
const withCredits = (credits: string, top = "") =>
  score([part("P1", [measure(
    attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: ["G"] }) + note("C5", 16, { type: "whole" }),
    top ? `<print><system-layout><top-system-distance>${top}</top-system-distance></system-layout></print>` : "",
  )])], credits);

// A Finale-style header: the file's positions overlap the first system MuseScore would draw.
const FINALE_CREDITS = `
  <credit page="1"><credit-type>title</credit-type><credit-words default-x="617" default-y="1497" font-size="24" justify="center" valign="top">"Battle 1"</credit-words></credit>
  <credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="617" default-y="1427" font-size="14" justify="center" valign="top">Final Fantasy IV</credit-words></credit>
  <credit page="1"><credit-type>composer</credit-type><credit-type>arranger</credit-type><credit-words default-x="1134" default-y="1377" font-size="12" justify="right" valign="top">Composition by Nobuo Uematsu
Arrangement by Yug Guy</credit-words></credit>
  <credit page="1"><credit-type>rights</credit-type><credit-words default-x="617" default-y="100" font-size="10" justify="center" valign="bottom">Square © 1991
http://www.NinSheetMusic.org/</credit-words></credit>
  <credit page="1"><credit-type>page number</credit-type><credit-words default-x="1134" default-y="1550">1</credit-words></credit>
  <credit page="2"><credit-type>title</credit-type><credit-words default-x="617" default-y="1550">Battle 1 (continued)</credit-words></credit>`;

test("the first page's top credits make a title frame: title and subtitle centred, the composer below on the right", () => {
  const xml = withCredits(FINALE_CREDITS);
  const parsed = parseMusicXml(xml);
  const format = pageFormat(parsed.defaults);
  const block = titleBlock(parsed, format);
  assert.deepEqual(texts(block.items).map((item) => item.text),
    ['"Battle 1"', "Final Fantasy IV", "Composition by Nobuo Uematsu", "Arrangement by Yug Guy"]);
  const [title, subtitle, composer, arranger] = texts(block.items);
  const centre = (format.margins.left + format.width - format.margins.right) / 2;
  for (const item of [title, subtitle]) {
    assert.equal(item.anchor, "middle");
    assert.ok(Math.abs(item.x - centre) < 1e-6);
  }
  for (const item of [composer, arranger]) {
    assert.equal(item.anchor, "end");
    assert.ok(Math.abs(item.x - (format.width - format.margins.right)) < 1e-6, "inside the right margin");
  }
  assert.ok(Math.abs(title.y - 0.8 * title.size - format.margins.top) < 1e-6, "the frame starts at the top margin");
  assert.ok(title.y + title.size * 0.2 <= subtitle.y - subtitle.size * 0.8 + 1e-6, "the subtitle is under the title");
  assert.ok(subtitle.y + subtitle.size * 0.2 <= composer.y - composer.size * 0.8 + 1e-6, "the composer is under the subtitle");
  assert.ok(arranger.y > composer.y);
  assert.ok(Math.abs(title.size - 24 * (300 / 72)) < 1e-6, "with the file's sizes");

  const page = pages(xml)[0];
  assert.ok(firstStaffTop(page) >= format.margins.top + block.height + 7 * format.staffSpace - 1e-6,
    "the first system starts 7 spaces below the frame");
  const drawn = texts(page.items).map((item) => item.text);
  assert.ok(!drawn.includes("1"), "page numbers are left out");
  assert.deepEqual(pageCredits(parsed, 1, format), [], "so are later pages' credits");
});

test("the first system clears the title frame even when the file asks for less room", () => {
  const parsed = parseMusicXml(withCredits(FINALE_CREDITS, "20"));
  const format = pageFormat(parsed.defaults);
  const block = titleBlock(parsed, format);
  const top = firstStaffTop(pages(withCredits(FINALE_CREDITS, "20"))[0]);
  assert.ok(top >= format.margins.top + block.height + 7 * format.staffSpace - 1e-6);
  // Without a frame, the file's distance stands.
  const plain = firstStaffTop(pages(withCredits("", "20"))[0]);
  assert.ok(Math.abs(plain - (format.margins.top + 2 * format.staffSpace)) < 1e-6);
  // And a larger one is kept under a frame.
  const roomy = firstStaffTop(pages(withCredits(FINALE_CREDITS, "800"))[0]);
  assert.ok(Math.abs(roomy - (format.margins.top + 80 * format.staffSpace)) < 1e-6);
});

test("the rights go to the foot of the first page, other low credits stay where the file puts them", () => {
  const parsed = parseMusicXml(withCredits(`${FINALE_CREDITS}
    <credit page="1"><credit-words default-x="100" default-y="300" justify="left">Duration: 2'30"</credit-words></credit>
    <credit page="1"><credit-words default-x="617" default-y="1300" justify="center">Arr. © 2020 someone</credit-words></credit>
    <credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="617" default-y="1400" justify="center">Theme © tribute</credit-words></credit>`));
  const format = pageFormat(parsed.defaults);
  const credits = pageCredits(parsed, 0, format);
  const rights = [textOf(credits, "Square © 1991"), textOf(credits, "http://www.NinSheetMusic.org/")];
  for (const line of rights) {
    assert.equal(line.anchor, "middle");
    assert.ok(line.y > format.height - format.margins.bottom && line.y < format.height, "in the bottom margin");
  }
  assert.ok(Math.abs(rights[0].size - 10 * (300 / 72)) < 1e-6);
  // A credit without a type whose text holds © is rights too, even in the top half.
  assert.ok(Math.abs(textOf(credits, "Arr. © 2020 someone").size - 9 * (300 / 72)) < 1e-6, "at MuseScore's copyright size");
  const frame = texts(titleBlock(parsed, format).items).map((item) => item.text);
  assert.ok(!frame.includes("Arr. © 2020 someone"));
  // A credit typed as something else keeps its type.
  assert.ok(frame.includes("Theme © tribute"));
  assert.ok(!frame.includes("Duration: 2'30\""), "a low credit stays out of the title frame");
  const duration = textOf(credits, "Duration: 2'30\"");
  assert.equal(duration.anchor, "start");
  assert.ok(Math.abs(duration.x - 10 * format.staffSpace) < 1e-6);
  assert.ok(Math.abs(duration.y - (format.height - 30 * format.staffSpace)) < 1e-6);
});

test("untyped header credits are told apart by column and size, and take their role's size", () => {
  // In no particular order in the file.
  const parsed = parseMusicXml(withCredits(`
    <credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="600" default-y="1450">From the game</credit-words></credit>
    <credit page="1"><credit-words default-x="1100" default-y="1560" justify="right">Koji Kondo</credit-words></credit>
    <credit page="1"><credit-words default-x="100" default-y="1500" justify="left">Words by Nobody</credit-words></credit>
    <credit page="1"><credit-words default-x="600" default-y="1550">Super Mario Bros.</credit-words></credit>
    <credit page="1"><credit-words default-x="600" default-y="1520" font-size="20" font-style="italic">Underground</credit-words><credit-words> Theme</credit-words><credit-words font-style="normal"> (Remix)</credit-words></credit>`));
  const format = pageFormat(parsed.defaults);
  const items = titleBlock(parsed, format).items;
  const composer = textOf(items, "Koji Kondo");
  const lyricist = textOf(items, "Words by Nobody");
  const smaller = textOf(items, "Super Mario Bros.");
  const typed = textOf(items, "From the game");
  // The right column is the composer, at the frame's foot under the centred credits even
  // though the file puts it highest.
  assert.equal(composer.anchor, "end");
  assert.ok(composer.y > typed.y);
  // The left column is the lyricist, at the frame's top.
  assert.equal(lyricist.anchor, "start");
  assert.ok(Math.abs(lyricist.x - format.margins.left) < 1e-6);
  assert.ok(lyricist.y < smaller.y);
  // Centred credits stack from the top of the page down; a run without a style continues the one before it.
  const title = textOf(items, "Underground Theme (Remix)");
  assert.ok(smaller.y < title.y && title.y < typed.y);
  assert.deepEqual(title.runs!.map((run) => [run.text, run.italic ?? false, run.size]),
    [["Underground", true, 20 * (300 / 72)], [" Theme", true, 20 * (300 / 72)], [" (Remix)", false, 20 * (300 / 72)]]);
  // Without a size, a credit takes MuseScore's size for its role: a centred one with a larger
  // one beside it is a subtitle, the largest a title.
  assert.ok(Math.abs(smaller.size - 14 * (300 / 72)) < 1e-6);
  assert.ok(Math.abs(typed.size - 14 * (300 / 72)) < 1e-6);
  const lone = parseMusicXml(withCredits('<credit page="1"><credit-words default-x="600" default-y="1550">Theme</credit-words></credit>'));
  assert.ok(Math.abs(texts(titleBlock(lone, format).items)[0].size - 22 * (300 / 72)) < 1e-6);
  assert.ok(Math.abs(composer.size - 10 * (300 / 72)) < 1e-6);
});

test("a file without credits gets its title and composer, and room for them", () => {
  const withTitle = score([piano([note("C5", 16, { type: "whole" })])])
    .replace("<part-list>", '<work><work-title>"Sub Castle"</work-title></work><identification><creator type="composer">Koji Kondo</creator></identification><part-list>');
  const parsed = parseMusicXml(withTitle);
  const block = titleBlock(parsed, pageFormat(parsed.defaults));
  assert.deepEqual(block.items.map((item) => (item as { text: string }).text), ["Sub Castle", "Koji Kondo"]);
  const lowered = pages(withTitle)[0].chords[0].notes[0].center[1];
  const plain = pages(score([piano([note("C5", 16, { type: "whole" })])]))[0].chords[0].notes[0].center[1];
  assert.ok(Math.abs(lowered - plain - block.height) < 1, "the first system moves down by the title block");
});

test("a rest of a voice sharing its staff moves clear of the other voice's notes", () => {
  const prepared = prepareScore(parseMusicXml(treble([
    note("A5", 4, { type: "quarter", voice: 1 }) + note(null, 4, { type: "quarter", voice: 1 }) + note("C5", 8, { type: "half", voice: 1 }) +
      backup(16) + note("F4", 4, { type: "quarter", voice: 2 }) + note("G5", 4, { type: "quarter", voice: 2 }) + note("C4", 8, { type: "half", voice: 2 }),
  ])));
  const [, second] = prepared.measures[0].segments;
  const shapes = new Map<PreparedChord, ChordShape>(second.chords.map((chord) => [chord, layoutChord(chord, chord.model.voice === "1", false, prepared.measures[0].duration)]));
  const rest = second.chords.find((chord) => chord.model.rest)!;
  const before = shapes.get(rest)!.rest!.y;
  avoidRestCollisions(second.chords, shapes);
  const after = shapes.get(rest)!.rest!;
  // G5 sits at -0.5; the upper voice's rest moves above it, whole spaces at a time.
  assert.ok(after.y < before && Number.isInteger(after.y - before));
  assert.ok(shapes.get(rest)!.bottom <= -0.5 - 0.5 - 0.25 + 1e-9);
});

test("a key change cancels the old key's accidentals the new one drops", () => {
  const trebleClef = { sign: "G" as const, line: 2, octaveChange: 0 };
  assert.deepEqual(keyCancellation(trebleClef, 3, 1).map((value) => value.position), [3, -1]);
  assert.deepEqual(keyCancellation(trebleClef, 2, -1).map((value) => value.glyph), ["accidentalNatural", "accidentalNatural"]);
  assert.deepEqual(keyCancellation(trebleClef, 1, 3), []);
  const [page] = pages(treble([
    note("D5", 16, { type: "whole" }),
    attributes({ fifths: 0 }) + note("D5", 16, { type: "whole" }),
  ], "").replace("<fifths>0</fifths></key><time>", "<fifths>2</fifths></key><time>"));
  assert.equal(glyphs(page, "accidentalNatural").length, 2);
});

test("a courtesy accidental is drawn in parentheses", () => {
  const [page] = pages(treble([
    note("C5", 16, { type: "whole", accidental: "natural" }).replace("<accidental>", '<accidental parentheses="yes">'),
  ]));
  assert.equal(glyphs(page, "accidentalParensLeft").length, 1);
  assert.equal(glyphs(page, "accidentalParensRight").length, 1);
  const [left, natural, right] = ["accidentalParensLeft", "accidentalNatural", "accidentalParensRight"]
    .map((name) => (glyphs(page, name)[0] as { x: number }).x);
  assert.ok(left < natural && natural < right);
});

test("a system announces the next system's key and time change at its end", () => {
  const [page] = pages(treble([
    note("D5", 16, { type: "whole" }),
    '<print new-system="yes"/>' + '<attributes><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
      note("D5", 12, { type: "half", dots: 1 }),
  ]).replace("<fifths>0</fifths></key><time><beats>4</beats>", "<fifths>2</fifths></key><time><beats>4</beats>"));
  // Two naturals cancel D major after the first system's last barline, then 3/4 follows.
  const naturals = glyphs(page, "accidentalNatural") as { x: number; y: number }[];
  assert.equal(naturals.length, 2);
  const firstSystemNaturals = naturals.filter((value) => value.y < page.chords[1].notes[0].center[1] - page.staffSpace * 4);
  assert.equal(firstSystemNaturals.length, 2);
  assert.equal(glyphs(page, "timeSig3").length, 2, "the courtesy 3/4 and the new system's 3/4");
});
