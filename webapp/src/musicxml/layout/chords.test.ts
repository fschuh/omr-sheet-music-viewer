import assert from "node:assert/strict";
import test from "node:test";
import { glyphWidth } from "../fonts/smufl";
import { parseMusicXml } from "../import/parseMusicXml";
import { fraction } from "../model/fraction";
import { attributes, backup, measure, note, part, score, type NoteOptions } from "../testScores";
import { layoutChord, noteType, SMALL_SCALE, stackSharedAccidentals, stemLength } from "./chords";
import { prepareScore, type PreparedChord } from "./measureContent";

/** The prepared chords of a one-measure treble score, in time order. */
function chords(content: string, clef = "G"): PreparedChord[] {
  const prepared = prepareScore(parseMusicXml(score([part("P1", [
    measure(attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: [clef] }) + content),
  ])])));
  return prepared.measures[0].segments.flatMap((segment) => [...segment.graces, ...segment.chords]);
}

function chord(pitches: string[], options: NoteOptions = { type: "quarter" }): PreparedChord {
  return chords(pitches.map((pitch, index) => note(pitch, 4, { ...options, chord: index > 0 })).join(""))[0];
}

const WHOLE = fraction(1);

test("a note a second from a normally placed one goes to the other side of the stem", () => {
  const up = layoutChord(chord(["C5", "D5"]), true, false, WHOLE);
  assert.equal(up.notes[0].x, 0);
  assert.ok(up.notes[1].x > 1, "D5 moves right of an up stem");
  const down = layoutChord(chord(["C5", "D5"]), false, false, WHOLE);
  assert.equal(down.notes[1].x, 0);
  assert.ok(down.notes[0].x < -1, "C5 moves left of a down stem");
  // A cluster alternates sides; a third apart both stay.
  const cluster = layoutChord(chord(["C5", "D5", "E5"]), true, false, WHOLE);
  assert.deepEqual(cluster.notes.map((value) => value.x > 0), [false, true, false]);
  const third = layoutChord(chord(["C5", "E5"]), true, false, WHOLE);
  assert.deepEqual(third.notes.map((value) => value.x), [0, 0]);
});

test("accidentals stack in columns only where they would overlap", () => {
  const close = layoutChord(chord(["E#5", "G#5"]), true, false, WHOLE);
  const [lower, upper] = close.notes.map((value) => value.accidental!.x);
  assert.notEqual(lower, upper);
  assert.ok(Math.max(lower, upper) + glyphWidth("accidentalSharp") <= 0, "both sit left of the noteheads");
  const octave = layoutChord(chord(["C#4", "C#5"]), true, false, WHOLE);
  assert.equal(octave.notes[0].accidental!.x, octave.notes[1].accidental!.x);
  assert.ok(close.left > octave.left, "a second column widens the chord to the left");
});

test("voices at the same moment stack their accidentals together", () => {
  const [upper, lower] = chords(
    note("C#5", 4, { type: "quarter", voice: 1 }) + backup(4) + note("A#4", 8, { type: "half", voice: 2 }),
  );
  const shapes = new Map([[upper, layoutChord(upper, true, false, WHOLE)], [lower, layoutChord(lower, false, false, WHOLE)]]);
  const alone = shapes.get(lower)!.left;
  stackSharedAccidentals([upper, lower], shapes);
  const [above, below] = [upper, lower].map((chord) => shapes.get(chord)!.notes[0].accidental!.x);
  assert.ok(Math.abs(above - below) >= glyphWidth("accidentalSharp"), "the sharps a third apart take separate columns");
  assert.ok(Math.max(above, below) + glyphWidth("accidentalSharp") <= 0, "both sit left of the noteheads");
  assert.ok(shapes.get(lower)!.left > alone, "the voice in the second column reaches further left");
});

test("dots sit in the space beside the note, above a line note unless a lower voice", () => {
  const onLine = layoutChord(chord(["E4"], { type: "quarter", dots: 1 }), true, false, WHOLE);
  assert.deepEqual(onLine.dots.map((dot) => [dot.y, dot.note]), [[3.5, 0]]);
  const inSpace = layoutChord(chord(["F4"], { type: "quarter", dots: 2 }), true, false, WHOLE);
  assert.deepEqual(inSpace.dots.map((dot) => dot.y), [3.5, 3.5]);
  assert.ok(inSpace.dots[1].x > inSpace.dots[0].x);
  const [, lower] = chords(
    note("C5", 6, { type: "quarter", dots: 1, voice: 1 }) + backup(6) +
      note("E4", 6, { type: "quarter", dots: 1, voice: 2 }),
  );
  assert.deepEqual(layoutChord(lower, false, false, WHOLE).dots.map((dot) => dot.y), [4.5]);
});

test("ledger lines cover the noteheads beyond the staff", () => {
  const high = layoutChord(chord(["C6"]), false, false, WHOLE);
  assert.deepEqual(high.ledgers.map((ledger) => ledger.y), [-1, -2]);
  const low = layoutChord(chord(["C4"]), true, false, WHOLE);
  assert.deepEqual(low.ledgers.map((ledger) => ledger.y), [5]);
  assert.ok(low.ledgers[0].x1 < 0 && low.ledgers[0].x2 > glyphWidth("noteheadBlack"));
  assert.deepEqual(layoutChord(chord(["G4"]), true, false, WHOLE).ledgers, []);
});

test("stems run 3.5 spaces past the far note and reach the middle line", () => {
  const up = layoutChord(chord(["G4", "B4"]), true, false, WHOLE);
  assert.ok(up.stem!.up && up.stem!.x > 1);
  assert.ok(Math.abs(up.stem!.yEnd - (2 - 3.5)) < 1e-9);
  const down = layoutChord(chord(["D5"]), false, false, WHOLE);
  assert.ok(!down.stem!.up && down.stem!.x < 0.2);
  // D5 sits at 1; its stem ends 3.5 below it.
  assert.equal(down.stem!.yEnd, 4.5);
  // A note far below the staff still gets a stem up to the middle line.
  const low = layoutChord(chord(["E3"]), true, false, WHOLE);
  assert.equal(low.stem!.yEnd, 2);
  // Notes with three or more flags get longer stems.
  assert.equal(stemLength("16th"), 3.5);
  assert.ok(stemLength("32nd") > 3.5);
});

test("unbeamed short notes get flags; beamed ones and longer notes do not", () => {
  assert.equal(layoutChord(chord(["G4"], { type: "eighth" }), true, false, WHOLE).flag, "flag8thUp");
  assert.equal(layoutChord(chord(["G4"], { type: "16th" }), false, false, WHOLE).flag, "flag16thDown");
  assert.equal(layoutChord(chord(["G4"], { type: "eighth" }), true, true, WHOLE).flag, null);
  assert.equal(layoutChord(chord(["G4"], { type: "half" }), true, false, WHOLE).flag, null);
  assert.equal(layoutChord(chord(["G4"], { type: "whole" }), true, false, WHOLE).stem, null);
});

test("rests sit on the middle line, a whole rest hangs from the fourth line", () => {
  const [quarter, whole] = chords(note(null, 4, { type: "quarter" }) + note(null, 12, { type: "whole" }));
  assert.deepEqual(layoutChord(quarter, true, false, WHOLE).rest, { glyph: "restQuarter", x: 0, y: 2 });
  assert.deepEqual(layoutChord(whole, true, false, WHOLE).rest, { glyph: "restWhole", x: 0, y: 1 });
  // Rests of voices sharing a staff move toward their side; an encoded place wins.
  const [upper] = chords(note(null, 4, { type: "quarter", voice: 1 }) + backup(4) + note("C5", 4, { type: "quarter", voice: 2 }));
  assert.equal(layoutChord(upper, true, false, WHOLE).rest!.y, 1);
  const [, lower] = chords(note("C5", 4, { type: "quarter", voice: 1 }) + backup(4) + note(null, 4, { type: "quarter", voice: 2 }));
  assert.equal(layoutChord(lower, false, false, WHOLE).rest!.y, 3);
  const [placed] = chords(note(null, 4, { type: "quarter", restAt: "E4" }));
  assert.equal(layoutChord(placed, true, false, WHOLE).rest!.y, 4);
});

test("grace notes are drawn small, and a missing type comes from the duration", () => {
  const [grace] = chords(note("D5", 0, { grace: true, type: "eighth" }) + note("C5", 4, { type: "quarter" }));
  assert.equal(layoutChord(grace, true, false, WHOLE).scale, SMALL_SCALE);
  assert.equal(noteType(null, fraction(3, 8)), "quarter");
  assert.equal(noteType(null, fraction(1, 16)), "16th");
  assert.equal(noteType("half", fraction(1, 16)), "half");
});
