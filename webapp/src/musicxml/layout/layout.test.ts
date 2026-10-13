import assert from "node:assert/strict";
import test from "node:test";
import { pageNoteGeometry } from "../geometry/pageNoteGeometry";
import { parseMusicXml } from "../import/parseMusicXml";
import type { Drawable, LayoutModel } from "../model/layout";
import type { ScoreDefaults } from "../model/score";
import { backup, note, piano, score } from "../testScores";
import { pageFormat } from "./pageFormat";
import { layoutScore } from "./pages";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

const NO_LAYOUT: ScoreDefaults = {
  scaling: null,
  pageSize: null,
  pageMargins: null,
  systemLayout: { leftMargin: null, rightMargin: null, systemDistance: null, topSystemDistance: null },
  staffDistance: null,
};

test("an encoded page format becomes page pixels at 300 per inch", () => {
  // MuseScore's A4: 7.056 mm per 40 tenths, 1683.67 x 1190.48 tenths = 297.0 x 210.0 mm.
  const format = pageFormat({
    ...NO_LAYOUT,
    scaling: { millimeters: 7.056, tenths: 40 },
    pageSize: { width: 1190.48, height: 1683.67 },
    pageMargins: { left: 85, right: 85, top: 85, bottom: 170 },
  });
  const pixelsPerTenth = 7.056 / 40 / 25.4 * 300;
  close(format.width, 1190.48 * pixelsPerTenth);
  close(format.height, 1683.67 * pixelsPerTenth);
  close(format.staffSpace, 10 * pixelsPerTenth);
  close(format.margins.left, 85 * pixelsPerTenth);
  close(format.margins.bottom, 170 * pixelsPerTenth);
});

test("a score without a page format gets MuseScore's Letter page, staff space and margins", () => {
  const format = pageFormat(NO_LAYOUT);
  close(format.width, 2550);
  close(format.height, 3300);
  close(format.staffSpace, 1.75 / 25.4 * 300);
  close(format.margins.top, 15 / 25.4 * 300);
  // A page size without scaling is read with the default staff space.
  close(pageFormat({ ...NO_LAYOUT, pageSize: { width: 1000, height: 2000 } }).width, 175 / 25.4 * 300);
});

/** A piano piece: a C major scale in eighths over whole notes, `count` measures. */
function pianoPiece(count: number, breaks: Record<number, string> = {}): string {
  const scale = ["C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6"]
    .map((pitch, index) => note(pitch, 2, { type: "eighth", beams: [index % 4 === 0 ? "begin" : index % 4 === 3 ? "end" : "continue"] }))
    .join("");
  const bar = scale + backup(16) + note("C3", 16, { type: "whole", staff: 2, voice: 5 }) +
    note("G3", 16, { type: "whole", staff: 2, voice: 5, chord: true });
  return score([piano(Array.from({ length: count }, (_, index) => (breaks[index] ?? "") + bar))]);
}

function layout(xml: string): LayoutModel {
  const parsed = parseMusicXml(xml);
  return layoutScore(parsed, pageFormat(parsed.defaults));
}

function itemBounds(item: Drawable): [number, number, number, number] {
  switch (item.kind) {
    case "glyph":
    case "text":
      return [item.x, item.y, item.x, item.y];
    case "line":
      return [Math.min(item.x1, item.x2), Math.min(item.y1, item.y2), Math.max(item.x1, item.x2), Math.max(item.y1, item.y2)];
    case "polygon": {
      const xs = item.points.filter((_, index) => index % 2 === 0);
      const ys = item.points.filter((_, index) => index % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
}

test("every note is laid out once, on a page, with everything inside the page", () => {
  const xml = pianoPiece(80);
  const parsed = parseMusicXml(xml);
  const keys = parsed.parts[0].measures.flatMap((value) => value.chords.flatMap((chord) => chord.notes.map((item) => item.key)));
  const result = layout(xml);
  assert.ok(result.pages.length > 1, "eighty measures need more than one page");
  const laidOut = result.pages.flatMap((page) => page.chords.flatMap((chord) => chord.notes.map((item) => item.key)));
  assert.deepEqual([...laidOut].sort(), [...keys].sort());
  for (const page of result.pages) {
    const drawn = [...page.items, ...page.chords.flatMap((chord) => [...chord.items, ...chord.notes.flatMap((item) => item.items)])];
    for (const item of drawn) {
      const [left, top, right, bottom] = itemBounds(item);
      assert.ok(left >= 0 && top >= 0 && right <= page.width && bottom <= page.height, `page ${page.index + 1}: ${item.kind} outside`);
    }
  }
});

test("chords struck together in a system share a moment, and systems count down each page", () => {
  const [page] = layout(pianoPiece(2)).pages;
  const firstOnset = page.chords.filter((chord) => chord.momentId === "m1-t0");
  assert.deepEqual(firstOnset.map((chord) => chord.notes.map((item) => item.key)), [
    ["P1-m1-s1-v1-t0-C5"],
    ["P1-m1-s2-v5-t0-C3", "P1-m1-s2-v5-t0-G3"],
  ]);
  assert.equal(new Set(page.chords.map((chord) => chord.momentId)).size, 2 * 8);
  assert.deepEqual([...new Set(page.chords.map((chord) => chord.systemIndex))], [0]);
});

test("encoded breaks start new systems and pages", () => {
  const result = layout(pianoPiece(6, { 2: '<print new-system="yes"/>', 4: '<print new-page="yes"/>' }));
  assert.equal(result.pages.length, 2);
  const systemsOf = (pageIndex: number) => {
    const bySystem = new Map<number, Set<number>>();
    for (const chord of result.pages[pageIndex].chords) {
      for (const item of chord.notes) bySystem.set(chord.systemIndex, (bySystem.get(chord.systemIndex) ?? new Set()).add(item.measure));
    }
    return [...bySystem.values()].map((measures) => [...measures]);
  };
  assert.deepEqual(systemsOf(0), [[1, 2], [3, 4]]);
  assert.deepEqual(systemsOf(1), [[5, 6]]);
});

test("page geometry has one notehead per note, keyed by note key, scoped to its page", () => {
  const result = layout(pianoPiece(40));
  const second = result.pages[1];
  const geometry = pageNoteGeometry(second);
  assert.equal(geometry.pageIndex, 1);
  assert.equal(geometry.noteheads.length, geometry.notes.length);
  for (const [index, item] of geometry.notes.entries()) {
    assert.equal(item.id, `page-2-${item.noteheadId}`);
    assert.equal(geometry.noteheads[index].id, item.noteheadId);
  }
  const chord = geometry.noteheads.filter((notehead) => notehead.chordId === geometry.noteheads.find((value) => value.id.endsWith("-C3"))!.chordId);
  assert.deepEqual(chord.map((notehead) => notehead.id.split("-").pop()), ["C3", "G3"]);
  const first = geometry.notes.find((item) => item.pitch === "C5")!;
  assert.deepEqual([first.grace, typeof first.measure], [false, "number"]);
  for (const notehead of geometry.noteheads) {
    const [left, top, right, bottom] = notehead.noteheadBounds;
    assert.ok(notehead.center[0] > left && notehead.center[0] < right && notehead.center[1] > top && notehead.center[1] < bottom);
    assert.deepEqual(notehead.hitAreas, [notehead.noteheadBounds]);
    assert.ok(notehead.bounds[1] <= top && notehead.bounds[3] >= bottom, "bounds include the notehead");
  }
  assert.equal(pageNoteGeometry(second), geometry, "geometry is reused for the same page");
});

test("an unprinted note keeps its geometry but draws nothing", () => {
  const xml = score([piano([note("C5", 16, { type: "whole" }).replace("<note>", '<note print-object="no">')])]);
  const [page] = layout(xml).pages;
  const [chord] = page.chords;
  assert.equal(chord.notes.length, 1);
  assert.deepEqual(chord.notes[0].items, []);
});
