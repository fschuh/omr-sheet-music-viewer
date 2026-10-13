import assert from "node:assert/strict";
import test from "node:test";
import { clefGlyph, keyAlterations, keySignature, staffPosition, type Clef } from "./staffPosition";

const treble: Clef = { sign: "G", line: 2, octaveChange: 0 };
const bass: Clef = { sign: "F", line: 4, octaveChange: 0 };
const alto: Clef = { sign: "C", line: 3, octaveChange: 0 };
const tenor: Clef = { sign: "C", line: 4, octaveChange: 0 };

test("pitches sit on the staff their clef implies", () => {
  assert.equal(staffPosition(treble, "F", 5), 0);
  assert.equal(staffPosition(treble, "G", 4), 6);
  assert.equal(staffPosition(treble, "E", 4), 8);
  assert.equal(staffPosition(treble, "C", 4), 10);
  assert.equal(staffPosition(bass, "A", 3), 0);
  assert.equal(staffPosition(bass, "G", 2), 8);
  assert.equal(staffPosition(bass, "C", 4), -2);
  assert.equal(staffPosition(alto, "C", 4), 4);
  assert.equal(staffPosition(tenor, "C", 4), 2);
  // A treble clef with an 8 below reads an octave lower.
  assert.equal(staffPosition({ ...treble, octaveChange: -1 }, "G", 3), 6);
});

test("clefs draw at their line, octave clefs and changes with their own glyphs", () => {
  assert.deepEqual(clefGlyph(treble, false), { glyph: "gClef", y: 3 });
  assert.deepEqual(clefGlyph(bass, false), { glyph: "fClef", y: 1 });
  assert.deepEqual(clefGlyph(alto, false), { glyph: "cClef", y: 2 });
  assert.deepEqual(clefGlyph({ ...treble, octaveChange: -1 }, false), { glyph: "gClef8vb", y: 3 });
  assert.deepEqual(clefGlyph(bass, true), { glyph: "fClefChange", y: 1 });
  assert.equal(clefGlyph({ sign: "none", line: 3, octaveChange: 0 }, false), null);
});

test("key signatures alter their steps and sit at the standard places for each clef", () => {
  assert.deepEqual([...keyAlterations(-3)], [["B", -1], ["E", -1], ["A", -1]]);
  assert.deepEqual([...keyAlterations(2)], [["F", 1], ["C", 1]]);
  assert.deepEqual(keySignature(treble, 3).map((entry) => entry.position), [0, 3, -1]);
  assert.deepEqual(keySignature(treble, -2).map((entry) => entry.position), [4, 1]);
  assert.deepEqual(keySignature(bass, 3).map((entry) => entry.position), [2, 5, 1]);
  assert.deepEqual(keySignature(bass, -2).map((entry) => entry.position), [6, 3]);
  assert.deepEqual(keySignature(alto, 1).map((entry) => entry.position), [1]);
  assert.deepEqual(keySignature(treble, -1).map((entry) => entry.glyph), ["accidentalFlat"]);
});
