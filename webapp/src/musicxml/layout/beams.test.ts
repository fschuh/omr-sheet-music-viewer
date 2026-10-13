import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import { attributes, backup, measure, note, part, score, type NoteOptions } from "../testScores";
import { beamGroups, layoutBeam, stemDirections, type PlacedChord } from "./beams";
import { layoutChord } from "./chords";
import { prepareScore, type PreparedMeasure } from "./measureContent";

function prepared(content: string): PreparedMeasure {
  return prepareScore(parseMusicXml(score([part("P1", [
    measure(attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: ["G"] }) + content),
  ])]))).measures[0];
}

/** Eighth notes beamed in groups: "|" ends a group. */
function eighths(pitches: string, options: NoteOptions = {}): string {
  const groups = pitches.split("|").map((group) => group.trim().split(/\s+/));
  return groups.map((group) => group.map((pitch, index) => note(pitch, 2, {
    type: "eighth",
    beams: [index === 0 ? "begin" : index === group.length - 1 ? "end" : "continue"],
    ...options,
  })).join("")).join("");
}

function placed(measure: PreparedMeasure): PlacedChord[][] {
  const groups = beamGroups(measure);
  const directions = stemDirections(measure, groups);
  return groups.map((group) => group.map((chord, index) => ({
    chord,
    shape: layoutChord(chord, directions.get(chord)!, true, measure.duration),
    x: index * 3,
    staffTop: 10,
  })));
}

test("beams join chords from begin to end, per voice, and grace notes among themselves", () => {
  const measure = prepared(
    eighths("C5 D5 | E5 F5 G5") + note("A5", 6, { type: "quarter", dots: 1 }) + backup(16) +
      eighths("C4 D4 E4 F4", { voice: 2 }) + note("C4", 8, { type: "half", voice: 2 }),
  );
  assert.deepEqual(
    beamGroups(measure).map((group) => group.map((chord) => chord.model.notes[0].step + chord.model.voice)),
    [["C1", "D1"], ["E1", "F1", "G1"], ["C2", "D2", "E2", "F2"]],
  );
});

test("a beam group points its stems away from its furthest note; encoded stems win", () => {
  const low = prepared(eighths("C4 E4 G4 C5"));
  const lowGroup = beamGroups(low)[0];
  assert.deepEqual([...stemDirections(low, beamGroups(low)).values()].slice(0, 4), lowGroup.map(() => true));
  const high = prepared(eighths("A4 C6"));
  assert.deepEqual([...stemDirections(high, beamGroups(high)).values()], [false, false]);
  const encoded = prepared(eighths("A4 C6", { stem: "up" }));
  assert.deepEqual([...stemDirections(encoded, beamGroups(encoded)).values()], [true, true]);
});

test("voices sharing a staff keep their stems on their own side", () => {
  const measure = prepared(note("C4", 16, { type: "whole" }) +
    backup(16) + note("C6", 4, { type: "quarter", voice: 2 }) + note(null, 12, { type: "half", dots: 1, voice: 2 }));
  const directions = stemDirections(measure, beamGroups(measure));
  const lowerVoice = [...directions].find(([chord]) => chord.model.voice === "2" && chord.model.notes.length);
  assert.equal(lowerVoice?.[1], false);
});

test("a beam slants with its outer notes by at most one space and stays flat over a peak", () => {
  const rising = placed(prepared(eighths("C5 D5 E5 F5")))[0];
  layoutBeam(rising);
  const ends = rising.map((chord) => chord.staffTop + chord.shape.stem!.yEnd);
  assert.ok(ends[3] < ends[0], "rises with the notes");
  assert.ok(ends[0] - ends[3] <= 1 + 1e-9);
  const steep = placed(prepared(eighths("C4 C6")))[0];
  layoutBeam(steep);
  const steepEnds = steep.map((chord) => chord.staffTop + chord.shape.stem!.yEnd);
  assert.ok(Math.abs(steepEnds[0] - steepEnds[1]) <= 1 + 1e-9);
  const peak = placed(prepared(eighths("G4 D5 G4")))[0];
  layoutBeam(peak);
  const peakEnds = peak.map((chord) => chord.shape.stem!.yEnd);
  assert.ok(Math.abs(peakEnds[0] - peakEnds[2]) < 1e-9, "flat when an inner note reaches further");
});

test("every beamed stem keeps its minimum length and ends on the beam line", () => {
  for (const pitches of ["C5 D5 E5 F5", "G4 D5 G4", "C4 G4 C4", "E5 C5 A4 F4"]) {
    const group = placed(prepared(eighths(pitches)))[0];
    const drawing = layoutBeam(group);
    for (const chord of group) {
      const stem = chord.shape.stem!;
      const nearest = stem.up
        ? Math.min(...chord.shape.notes.map((value) => value.y))
        : Math.max(...chord.shape.notes.map((value) => value.y));
      assert.ok(Math.abs(stem.yEnd - nearest) >= 3.25 - 1e-9, `${pitches}: stem too short`);
    }
    const [main] = drawing.segments;
    const first = group[0];
    assert.ok(Math.abs(main.y1 - (first.staffTop + first.shape.stem!.yEnd)) < 0.1, `${pitches}: beam meets the stem`);
  }
});

test("secondary beams and hooks follow their encoded levels", () => {
  const measure = prepared(
    note("C5", 3, { type: "eighth", dots: 1, beams: ["begin"] }) +
      note("C5", 1, { type: "16th", beams: ["end", "backward hook"] }) +
      note("C5", 1, { type: "16th", beams: ["begin", "begin"] }) +
      note("C5", 1, { type: "16th", beams: ["continue", "end"] }) +
      note("C5", 2, { type: "eighth", beams: ["end"] }),
  );
  const [first, second] = placed(measure);
  const hooked = layoutBeam(first);
  assert.equal(hooked.segments.length, 2);
  assert.ok(hooked.segments[1].x2 - hooked.segments[1].x1 < 2, "a hook is short");
  const run = layoutBeam(second);
  assert.equal(run.segments.length, 2);
  // The 16th beam spans the first two chords only, one beam step toward the notes.
  assert.ok(run.segments[1].x2 < second[2].x + 1);
});
