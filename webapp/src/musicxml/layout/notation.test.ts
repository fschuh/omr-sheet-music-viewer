import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import type { Drawable, LayoutPage } from "../model/layout";
import { attributes, backup, barline, measure, note, part, piano, score } from "../testScores";
import { avoidRestCollisions, layoutChord, type ChordShape } from "./chords";
import { drawCredits, titleBlock } from "./drawing";
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

test("credits are drawn where the file puts them, with their styles", () => {
  const parsed = parseMusicXml(score([piano([note("C5", 16, { type: "whole" })])],
    `<credit page="1"><credit-words default-x="600" default-y="1600" justify="center" valign="top" font-style="italic" font-size="22">Für Elise</credit-words><credit-words> (Bagatelle)</credit-words><credit-words font-style="normal"> in A Minor</credit-words></credit>
     <credit page="1"><credit-words default-x="1100" default-y="1500" justify="right" valign="bottom">Beethoven
(1770–1827)</credit-words></credit>`));
  const format = pageFormat(parsed.defaults);
  const credits = drawCredits(parsed, 0, format);
  const title = credits[0] as Extract<Drawable, { kind: "text" }>;
  assert.equal(title.text, "Für Elise (Bagatelle) in A Minor");
  assert.equal(title.anchor, "middle");
  // A run without its own style continues the one before it.
  assert.deepEqual(title.runs!.map((run) => [run.text, run.italic ?? false]), [["Für Elise", true], [" (Bagatelle)", true], [" in A Minor", false]]);
  assert.ok(title.runs!.every((run) => run.size === title.runs![0].size), "and its size");
  assert.ok(Math.abs(title.x - 60 * format.staffSpace) < 1e-6);
  const composer = credits.filter((item) => item.kind === "text" && item.anchor === "end");
  assert.deepEqual(composer.map((item) => (item as { text: string }).text), ["Beethoven", "(1770–1827)"]);
  assert.deepEqual(drawCredits(parsed, 1, format), []);
  assert.deepEqual(titleBlock(parsed, format).items, [], "a file with credits gets no title block");
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
