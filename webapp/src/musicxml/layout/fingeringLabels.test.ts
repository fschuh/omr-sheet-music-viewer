import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import type { LayoutNote, LayoutPage } from "../model/layout";
import { note, piano, score } from "../testScores";
import { fingeringLabelLayout } from "./fingeringLabels";
import { pageFormat } from "./pageFormat";
import { layoutScore } from "./pages";

function firstPage(xml: string): LayoutPage {
  const parsed = parseMusicXml(xml);
  return layoutScore(parsed, pageFormat(parsed.defaults)).pages[0];
}

function noteOf(page: LayoutPage, pitch: string): LayoutNote {
  const found = page.chords.flatMap((chord) => chord.notes).find((value) => value.pitch === pitch);
  assert.ok(found, `no note ${pitch}`);
  return found;
}

const fingering = (digit: number) => `<notations><technical><fingering>${digit}</fingering></technical></notations>`;

// A right-hand triad over a left-hand fifth, struck together, then a single note in each hand.
const page = firstPage(score([piano([
  note("E4", 8, { type: "half", staff: 1 }) +
    note("A4", 8, { chord: true, type: "half", staff: 1 }) +
    note("C5", 8, { chord: true, type: "half", staff: 1, extra: fingering(5) }) +
    note("E5", 8, { type: "half", staff: 1 }) +
    "<backup><duration>16</duration></backup>" +
    note("A2", 8, { type: "half", staff: 2, voice: 5 }) +
    note("E3", 8, { chord: true, type: "half", staff: 2, voice: 5 }) +
    note("A3", 8, { type: "half", staff: 2, voice: 5 }),
])]));
const staffHand = (key: string) => /-s2-/.test(key);

test("the system knows where each part's staves are", () => {
  const [system] = page.systems;
  assert.equal(system.parts.length, 1);
  assert.equal(system.parts[0].top, system.top);
  assert.equal(system.parts[0].bottom, system.bottom);
  assert.ok(page.chords.every((chord) => chord.part === 0));
});

test("right-hand labels stand above the part and left-hand ones below it, top note on top", () => {
  const layout = fingeringLabelLayout(page, staffHand);
  const [system] = page.systems;
  const label = (pitch: string) => layout.labels.find((value) => value.key === noteOf(page, pitch).key)!;
  for (const pitch of ["E4", "A4", "C5", "E5"]) {
    assert.equal(label(pitch).left, false);
    assert.ok(label(pitch).y + layout.size / 2 < Math.min(system.top, noteOf(page, pitch).headBounds[1]), `${pitch} above`);
  }
  for (const pitch of ["A2", "E3", "A3"]) {
    assert.equal(label(pitch).left, true);
    assert.ok(label(pitch).y - layout.size / 2 > system.bottom, `${pitch} below`);
  }
  // A chord's labels share an x and stack with the top note on top, in one stack per hand.
  assert.ok(label("C5").y < label("A4").y && label("A4").y < label("E4").y);
  assert.equal(label("C5").x, label("E4").x);
  assert.ok(label("E3").y < label("A2").y);
  assert.deepEqual(layout.stacks.map((stack) => stack.left).sort(), [false, true]);
  const rightStack = layout.stacks.find((stack) => !stack.left)!;
  assert.ok(rightStack.top <= label("C5").y - layout.size / 2 && rightStack.bottom >= label("E4").y + layout.size / 2);
});

test("a note moved to the other hand takes its label to that hand's side", () => {
  const moved = noteOf(page, "A3").key;
  const layout = fingeringLabelLayout(page, (key) => (key === moved ? false : staffHand(key)));
  const label = layout.labels.find((value) => value.key === moved)!;
  assert.equal(label.left, false);
  assert.ok(label.y < page.systems[0].top);
});

test("notes without a hand get no label", () => {
  const layout = fingeringLabelLayout(page, (key) => (/-s1-/.test(key) ? false : undefined));
  assert.equal(layout.labels.length, 4);
  assert.ok(layout.labels.every((value) => !value.left));
});

test("a printed fingering's place is recorded on its note", () => {
  const printed = noteOf(page, "C5").printedFingering;
  assert.ok(printed, "the printed finger has a box");
  const [left, top, right, bottom] = printed;
  assert.ok(left < right && top < bottom);
  assert.ok(bottom < noteOf(page, "C5").headBounds[1], "above the note it fingers");
  assert.equal(noteOf(page, "A4").printedFingering, undefined);
});
