import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import { fraction } from "../model/fraction";
import { attributes, backup, measure, note, part, piano, score } from "../testScores";
import { prepareScore, shortestAt, type PreparedChord } from "./measureContent";

function accidentals(chords: PreparedChord[]): (string | null)[] {
  return chords.flatMap((chord) => chord.accidentals);
}

function chordsOf(xml: string, measureIndex = 0): PreparedChord[] {
  return prepareScore(parseMusicXml(xml)).measures[measureIndex].segments.flatMap((segment) => [
    ...segment.graces,
    ...segment.chords,
  ]);
}

test("accidentals follow the key and earlier notes on the same staff line in the measure", () => {
  const xml = score([part("P1", [
    measure(attributes({ divisions: 1, fifths: 1, time: [4, 4], clefs: ["G"] }) +
      note("F#5", 1) + note("F5", 1) + note("F5", 1) + note("F#5", 1)),
    measure(note("F4", 1) + note("F#4", 1) + note("Bb4", 1) + note("Bb4", 1)),
  ])]);
  assert.deepEqual(accidentals(chordsOf(xml)), [null, "accidentalNatural", null, "accidentalSharp"]);
  // A new measure starts from the key again; other octaves keep their own state.
  assert.deepEqual(accidentals(chordsOf(xml, 1)), ["accidentalNatural", "accidentalSharp", "accidentalFlat", null]);
});

test("a note tied across the barline shows no accidental; the file's own are always printed", () => {
  const xml = score([part("P1", [
    measure(attributes({ divisions: 1, fifths: 0, time: [4, 4], clefs: ["G"] }) +
      note("C5", 3) + note("C#5", 1, { tie: "start" })),
    measure(note("C#5", 1, { tie: "stop" }) + note("C#5", 1) + note("C#5", 1, { accidental: "sharp" }) +
      note("D5", 1, { accidental: "natural" })),
  ])]);
  assert.deepEqual(accidentals(chordsOf(xml)), [null, "accidentalSharp"]);
  // The tie carries the sharp into the measure, so the next C#5 needs none either.
  assert.deepEqual(accidentals(chordsOf(xml, 1)), [null, null, "accidentalSharp", "accidentalNatural"]);
});

test("staves count across parts, and each staff keeps its own clef", () => {
  const prepared = prepareScore(parseMusicXml(score([
    piano([note("C5", 16, { type: "whole" }) + backup(16) + note("C3", 16, { type: "whole", staff: 2 })]),
    part("P2", [measure(attributes({ divisions: 1, clefs: ["C"] }) + note("C4", 4, { type: "whole" }))]),
  ])));
  assert.deepEqual(prepared.partStaves, [[0, 1], [2]]);
  assert.deepEqual(prepared.measures[0].clefs.map((clef) => clef.sign), ["G", "F", "C"]);
});

test("segments align onsets across staves and know how long they last", () => {
  const prepared = prepareScore(parseMusicXml(score([piano([
    note("C5", 8, { type: "half" }) + note("D5", 8, { type: "half" }) + backup(16) +
      note("C3", 2, { type: "eighth", staff: 2 }) + note("D3", 14, { type: "half", dots: 2, staff: 2 }),
  ])])));
  const [measure0] = prepared.measures;
  assert.deepEqual(measure0.segments.map((segment) => [segment.onset, segment.duration]), [
    [fraction(0), fraction(1, 8)],
    [fraction(1, 8), fraction(3, 8)],
    [fraction(1, 2), fraction(1, 2)],
  ]);
  assert.deepEqual(shortestAt(measure0.segments[0]), fraction(1, 8));
  assert.deepEqual(measure0.duration, fraction(1));
});

test("grace notes join the segment they lead to, and clef changes the segment they precede", () => {
  const prepared = prepareScore(parseMusicXml(score([piano([
    note("C5", 4, { type: "quarter" }) + note("E5", 0, { grace: "slash", type: "eighth" }) +
      note("D5", 4, { type: "quarter" }) +
      '<attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>' +
      note("C3", 8, { type: "half" }),
    note("C3", 16, { type: "whole" }),
  ])])));
  const [first, second, third] = prepared.measures[0].segments;
  assert.equal(first.graces.length, 0);
  assert.deepEqual(second.graces.map((chord) => chord.model.notes[0].step), ["E"]);
  assert.deepEqual(third.clefChanges.map((change) => [change.staff, change.clef.sign]), [[0, "F"]]);
  assert.equal(third.chords[0].clef.sign, "F");
  // The measure starts in its old clef; the change lasts into the next measure.
  assert.deepEqual(prepared.measures[0].clefs.map((clef) => clef.sign), ["G", "F"]);
  assert.deepEqual(prepared.measures[1].clefs.map((clef) => clef.sign), ["F", "F"]);
  assert.deepEqual(prepared.measures[1].startClefChanges, []);
});

test("changes at a measure start are printed there: clef, key and time", () => {
  const prepared = prepareScore(parseMusicXml(score([part("P1", [
    measure(attributes({ divisions: 1, fifths: 0, time: [4, 4], clefs: ["G"] }) + note("C5", 4, { type: "whole" })),
    measure(attributes({ fifths: -2, time: [3, 4], clefs: ["F"] }) + note("C3", 3, { type: "half", dots: 1 })),
    measure(attributes({ fifths: -2 }) + note("C3", 3, { type: "half", dots: 1 })),
  ])])));
  const [, second, third] = prepared.measures;
  assert.deepEqual(second.startClefChanges.map((change) => change.clef.sign), ["F"]);
  assert.deepEqual(second.keyChanges, [-2]);
  assert.deepEqual(second.timeChange && [second.timeChange.beats, second.timeChange.beatType], ["3", "4"]);
  // Repeating the key in force prints nothing.
  assert.deepEqual(third.keyChanges, [null]);
  assert.equal(third.timeChange, null);
});

test("a measure is as long as its content, or its time signature when empty", () => {
  const prepared = prepareScore(parseMusicXml(score([part("P1", [
    measure(attributes({ divisions: 1, time: [3, 4], clefs: ["G"] }) + note("C5", 1, { type: "quarter" })),
    measure(""),
  ])])));
  assert.deepEqual(prepared.measures.map((value) => value.duration), [fraction(1, 4), fraction(3, 4)]);
});

test("a staff used by two voices in a measure is shared", () => {
  const chords = chordsOf(score([piano([
    note("E5", 16, { type: "whole", voice: 1 }) + backup(16) + note("C5", 16, { type: "whole", voice: 2 }) +
      backup(16) + note("C3", 16, { type: "whole", staff: 2, voice: 5 }),
  ])]));
  assert.deepEqual(chords.map((chord) => [chord.staff, chord.sharedStaff]), [[0, true], [0, true], [1, false]]);
});
