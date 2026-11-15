import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import type { LayoutNote, LayoutPage } from "../model/layout";
import { note, piano, score } from "../testScores";
import { fingeringLabelLayout, labelColumn, labelsNeedRoom, MOVED_GAP } from "./fingeringLabels";
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

// Bars of sixteenth-note chords in the right hand over held left-hand notes, packed several
// to a system as in a real passage; the first opens with a grace note.
function denseScore(): string {
  const chord = (low: string, high: string) =>
    note(low, 1, { type: "16th", staff: 1 }) + note(high, 1, { chord: true, type: "16th", staff: 1 });
  const run = ["E4", "F4", "G4", "A4"].map((low, index) => chord(low, ["G4", "A4", "B4", "C5"][index])).join("").repeat(4);
  const bar = (grace: boolean) =>
    (grace ? note("C5", 0, { grace: true, type: "eighth", staff: 1 }) : "") + run +
    "<backup><duration>16</duration></backup>" +
    note("C3", 16, { type: "whole", staff: 2, voice: 5 });
  return score([piano([bar(true), bar(false), bar(false), bar(false), bar(false), bar(false)])]);
}

function laidOut(fingeringRoom: boolean): LayoutPage {
  const parsed = parseMusicXml(denseScore());
  return layoutScore(parsed, pageFormat(parsed.defaults), { fingeringRoom }).pages[0];
}

test("with room for fingerings, notes of one hand stand a label apart and the page says so", () => {
  const roomy = laidOut(true);
  const plain = laidOut(false);
  assert.equal(roomy.fingeringRoom, true);
  assert.equal(plain.fingeringRoom, undefined);
  // Within the first system, where the passage is packed.
  const centres = (page: LayoutPage, grace: boolean) => [...new Set(page.chords
    .filter((chord) => chord.systemIndex === 0 && chord.notes.some((value) => /-s1-/.test(value.key) && value.grace === grace))
    .map((chord) => chord.notes[0].center[0]))].sort((a, b) => a - b);
  const closest = (xs: number[]) => Math.min(...xs.slice(1).map((x, index) => x - xs[index]));
  const label = (page: LayoutPage) => 1.85 * page.staffSpace;
  assert.ok(closest(centres(roomy, false)) >= label(roomy) - 0.5, "sixteenths a label apart");
  const grace = centres(roomy, true)[0];
  assert.ok(centres(roomy, false)[0] - grace >= label(roomy) - 0.5, "a grace note a label from its note");
});

test("with room for fingerings, a page's labels clear one another", () => {
  const page = laidOut(true);
  const layout = fingeringLabelLayout(page, staffHand);
  for (const a of layout.labels) {
    for (const b of layout.labels) {
      if (a === b) continue;
      const apart = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(apart >= layout.size - 0.5, `${a.key} and ${b.key} overlap`);
    }
  }
});

test("notes moved to the left hand get their labels' room below the part", () => {
  const parsed = parseMusicXml(denseScore());
  // Every right-hand note moved to the left hand: below the part, each chord's two labels
  // stand in a stack of their own, apart from the held bass note's.
  const moved = layoutScore(parsed, pageFormat(parsed.defaults), {
    fingeringRoom: true,
    movedHand: (key) => (/-s1-/.test(key) ? true : undefined),
  }).pages[0];
  assert.ok(moved.systems.length > 1);
  const layout = fingeringLabelLayout(moved, () => true);
  const tallest = Math.max(...layout.stacks.map((stack) => (stack.bottom - stack.top) / moved.staffSpace));
  assert.ok(Math.abs(tallest - (1.7 + 1.85)) < 0.01, "stacks of two labels, a chord's");
  // Placed for those hands, the labels below each system stay clear of the next.
  for (let index = 0; index + 1 < moved.systems.length; index += 1) {
    const below = layout.labels.filter((label) => label.y > moved.systems[index].bottom && label.y < moved.systems[index + 1].top);
    assert.ok(below.length > 0);
    assert.ok(Math.max(...below.map((label) => label.y + layout.size / 2)) < moved.systems[index + 1].top, `system ${index + 1} clear`);
  }
});

test("labels need room only where their hands are not those the layout made room for", () => {
  const parsed = parseMusicXml(denseScore());
  const format = pageFormat(parsed.defaults);
  // The right hand's notes of the first bar moved to the left hand; the next system keeps its
  // right-hand labels above it.
  const firstBarLeft = (key: string) => (/^P1-m1-s1-/.test(key) ? true : undefined);
  const hands = (key: string) => firstBarLeft(key) ?? staffHand(key);
  const staffHands = layoutScore(parsed, format, { fingeringRoom: true }).pages[0];
  assert.ok(staffHands.systems.length > 1);
  assert.equal(labelsNeedRoom(staffHands, staffHand), false, "fits the hands it was laid out for");
  assert.equal(labelsNeedRoom(staffHands, hands), true, "the moved bar's stacks below reach the next system's labels");
  const moved = layoutScore(parsed, format, { fingeringRoom: true, movedHand: firstBarLeft }).pages[0];
  assert.equal(labelsNeedRoom(moved, hands), false, "fits once laid out for those hands");
});

test("notes moved to a hand stand in their own stack, beyond that hand's chord, with room laid out for it", () => {
  const parsed = parseMusicXml(denseScore());
  const format = pageFormat(parsed.defaults);
  // The first bar's right-hand notes moved to the left hand, where its held bass note has a label.
  const firstBarLeft = (key: string) => (/^P1-m1-s1-/.test(key) ? true : undefined);
  const hands = (key: string) => firstBarLeft(key) ?? staffHand(key);
  const moved = (key: string) => firstBarLeft(key) !== undefined;
  const page = layoutScore(parsed, format, { fingeringRoom: true, movedHand: firstBarLeft }).pages[0];
  const layout = fingeringLabelLayout(page, hands, moved);
  const half = layout.size / 2;
  const bass = layout.labels.find((label) => label.key.startsWith("P1-m1-s2-"))!;
  // The moved chord struck with the bass note: its stack is the bass note's moment's.
  const crossed = layout.labels.filter((label) => moved(label.key) && labelColumn(label.stackId) === labelColumn(bass.stackId));
  assert.equal(crossed.length, 2, "the chord struck with the bass note");
  assert.ok(crossed.every((label) => label.stackId !== bass.stackId && label.stackId === crossed[0].stackId), "a stack of their own");
  assert.ok(layout.stacks.some((stack) => stack.id === crossed[0].stackId));
  assert.ok(layout.stacks.every((stack) => stack.id !== bass.stackId), "the bass note alone has no stack");
  const top = Math.min(...crossed.map((label) => label.y - half));
  assert.ok(top - (bass.y + half) >= MOVED_GAP * page.staffSpace - 0.01, "beyond the chord's label, a wider gap out");
  assert.equal(labelsNeedRoom(page, hands, moved), false, "the layout made room for them");
});

test("two voices struck together on a staff stand apart, the higher voice above, not as one chord", () => {
  // The right hand's upper voice C5 over its lower voice A4, struck together, then held.
  const voices = firstPage(score([piano([
    note("C5", 8, { type: "half", staff: 1, voice: 1 }) + note("E5", 8, { type: "half", staff: 1, voice: 1 }) +
      "<backup><duration>16</duration></backup>" +
      note("A4", 16, { type: "whole", staff: 1, voice: 2 }) +
      "<backup><duration>16</duration></backup>" +
      note("A2", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const layout = fingeringLabelLayout(voices, staffHand);
  const label = (pitch: string) => layout.labels.find((value) => value.key === noteOf(voices, pitch).key)!;
  const [upper, lower] = [label("C5"), label("A4")];
  assert.notEqual(upper.stackId, lower.stackId, "a stack each");
  assert.equal(labelColumn(upper.stackId), labelColumn(lower.stackId), "in one column");
  assert.equal(layout.stacks.length, 0, "single notes, no outline");
  assert.ok(lower.y - upper.y >= layout.size + MOVED_GAP * voices.staffSpace - 0.01, "the upper voice above, a wider gap away");
  // Both voices moved to the left hand: still apart, below the left hand's own note, the
  // upper voice nearer the staff.
  const moved = (key: string) => /-s1-/.test(key);
  const crossed = fingeringLabelLayout(voices, () => true, moved);
  const at = (pitch: string) => crossed.labels.find((value) => value.key === noteOf(voices, pitch).key)!;
  assert.notEqual(at("C5").stackId, at("A4").stackId, "a stack each, moved");
  assert.equal(labelColumn(at("C5").stackId), labelColumn(at("A2").stackId));
  assert.ok(at("A2").y < at("C5").y && at("C5").y < at("A4").y, "the bass note's own, then the upper voice, then the lower");
  assert.ok(at("A4").y - at("C5").y >= crossed.size + MOVED_GAP * voices.staffSpace - 0.01);
});

test("a hand's groups at a moment stay together past a mark in their way", () => {
  // Two voices of the right hand under a long tempo mark, as in a waltz's opening.
  const words = '<direction placement="above"><direction-type><words>Allegro molto, sempre legato e dolce</words></direction-type><staff>1</staff></direction>';
  const marked = firstPage(score([piano([
    words +
      note("C5", 8, { type: "half", staff: 1, voice: 1 }) + note("E5", 8, { type: "half", staff: 1, voice: 1 }) +
      "<backup><duration>16</duration></backup>" +
      note("A4", 16, { type: "whole", staff: 1, voice: 2 }) +
      "<backup><duration>16</duration></backup>" +
      note("A2", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  const layout = fingeringLabelLayout(marked, staffHand);
  const label = (pitch: string) => layout.labels.find((value) => value.key === noteOf(marked, pitch).key)!;
  const apart = label("A4").y - label("C5").y;
  assert.ok(Math.abs(apart - (layout.size + MOVED_GAP * marked.staffSpace)) < 0.01, `the voices ${apart} apart, one gap`);
});

test("with room for fingerings, every label stays within its own system", () => {
  // High right-hand chords over a resting left hand, on pages full enough that systems close up:
  // nothing reaches below a system, so only its staff lines keep the next system's labels off it.
  const chord = (notes: string[]) =>
    notes.map((pitch, index) => note(pitch, 2, { chord: index > 0, type: "eighth", staff: 1 })).join("");
  const bar = [
    ...Array.from({ length: 8 }, () => chord(["A5", "C6", "E6"])),
    "<backup><duration>16</duration></backup>",
    note(null, 16, { measureRest: true, staff: 2, voice: 5 }),
  ].join("");
  const parsed = parseMusicXml(score([piano(Array.from({ length: 40 }, () => bar))]));
  const pages = layoutScore(parsed, pageFormat(parsed.defaults), { fingeringRoom: true }).pages;
  for (const page of pages) {
    const layout = fingeringLabelLayout(page, staffHand);
    const half = layout.size / 2;
    for (const label of layout.labels) {
      const system = Number(label.stackId.split("|")[0]);
      const next = page.systems[system + 1];
      const previous = page.systems[system - 1];
      if (label.left && next) assert.ok(label.y + half <= next.top, `${label.key} reaches the next system`);
      if (!label.left && previous) assert.ok(label.y - half >= previous.bottom, `${label.key} reaches the system before`);
    }
  }
});
