import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KEYBOARD_VIEW_SETTINGS,
  FULL_KEYBOARD_RANGE,
  handColors,
  keyboardRangeForNotes,
  keyboardRangeForSetting,
  normalizeKeyboardViewSettings,
  pianoKeyName,
  shadeColor,
  whiteKeyCount,
} from "./keyboardView";

function names({ low, high }: { low: number; high: number }): string {
  return `${pianoKeyName(low)}–${pianoKeyName(high)}`;
}

test("a range spans the notes with a white key to spare at each end", () => {
  // D4 to A4 is five white keys; one more each side gives C4 to B4.
  assert.equal(names(keyboardRangeForNotes([62, 64, 69], 7)), "C4–B4");
  // A black key at the edge brings in the white key beyond its neighbour.
  assert.equal(names(keyboardRangeForNotes([61, 70], 7)), "B3–C5");
});

test("a narrow range is widened a white key at a time, above first", () => {
  const range = keyboardRangeForNotes([64], 10);
  assert.equal(whiteKeyCount(range), 10);
  // D4 E4 F4, then G4, C4, A4, B3, B4, A3, C5.
  assert.equal(names(range), "A3–C5");
});

test("a range never leaves the piano, and grows the other way at its ends", () => {
  assert.equal(names(keyboardRangeForNotes([21, 23], 7)), "A0–G1");
  assert.equal(names(keyboardRangeForNotes([108], 7)), "D7–C8");
  assert.deepEqual(keyboardRangeForNotes([30, 90], 52), FULL_KEYBOARD_RANGE);
  assert.deepEqual(keyboardRangeForNotes([], 7), FULL_KEYBOARD_RANGE, "no notes: every key");
  assert.deepEqual(keyboardRangeForNotes([10, 120], 7), FULL_KEYBOARD_RANGE, "none on the piano");
});

test("the practised hand's range leaves the other hand out", () => {
  const notes = [
    { pitch: "C5", left: false },
    { pitch: "G5", left: false },
    { pitch: "C2", left: true },
    { pitch: "E4" },
  ];
  assert.deepEqual(keyboardRangeForSetting("full", 7, notes, "right"), FULL_KEYBOARD_RANGE);
  assert.equal(names(keyboardRangeForSetting("song", 7, notes, "right")), "B1–A5");
  // A note of an unknown hand belongs to either.
  assert.equal(names(keyboardRangeForSetting("practiced-hand", 7, notes, "right")), "D4–A5");
  assert.equal(names(keyboardRangeForSetting("practiced-hand", 7, notes, "left")), "B1–F4");
  assert.equal(names(keyboardRangeForSetting("practiced-hand", 7, notes, "both")), "B1–A5");
});

test("stored settings fill in, field by field, whatever is missing or wrong", () => {
  assert.deepEqual(normalizeKeyboardViewSettings(null), DEFAULT_KEYBOARD_VIEW_SETTINGS);
  assert.deepEqual(normalizeKeyboardViewSettings("garbage"), DEFAULT_KEYBOARD_VIEW_SETTINGS);
  const settings = normalizeKeyboardViewSettings({
    range: "song",
    minimumWhiteKeys: 400,
    tilt: -5,
    upcomingEffect: "sparkles",
    upcomingLead: 0.3,
    rightHandColor: "#3B82F6",
    leftHandColor: "orange",
    keyboard3d: "yes",
    noteStyle: "flat",
  });
  assert.equal(settings.range, "song");
  assert.equal(settings.minimumWhiteKeys, 52);
  assert.equal(settings.tilt, 0);
  assert.equal(settings.upcomingEffect, DEFAULT_KEYBOARD_VIEW_SETTINGS.upcomingEffect);
  assert.equal(settings.upcomingLead, DEFAULT_KEYBOARD_VIEW_SETTINGS.upcomingLead);
  assert.equal(settings.rightHandColor, "#3b82f6");
  assert.equal(settings.leftHandColor, DEFAULT_KEYBOARD_VIEW_SETTINGS.leftHandColor);
  assert.equal(settings.keyboard3d, false);
  assert.equal(settings.noteStyle, "flat");
});

test("each hand's black-key shade is a darker version of its colour", () => {
  assert.equal(shadeColor("#ffffff", 0.5), "#808080");
  const colors = handColors({ rightHandColor: "#2fbfa5", leftHandColor: "#f28c38" });
  assert.equal(colors.right.base, "#2fbfa5");
  assert.equal(colors.right.dark, shadeColor("#2fbfa5", 0.58));
  assert.equal(colors.left.dark, shadeColor("#f28c38", 0.6));
});
