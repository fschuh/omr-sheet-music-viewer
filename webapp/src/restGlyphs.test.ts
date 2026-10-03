import assert from "node:assert/strict";
import test from "node:test";
import { restGlyph, restGlyphKind } from "./restGlyphs";

const lines = [100, 120, 140, 160, 180];

test("reads each token as the rest it is printed as", () => {
  assert.equal(restGlyphKind("rest_1"), "whole");
  assert.equal(restGlyphKind("rest_0"), "whole");
  assert.equal(restGlyphKind("rest_2."), "half");
  assert.equal(restGlyphKind("rest_4"), "quarter");
  assert.equal(restGlyphKind("rest_6"), "quarter");
  assert.equal(restGlyphKind("rest_12"), "eighth");
  assert.equal(restGlyphKind("rest_16"), "sixteenth");
  assert.equal(restGlyphKind("note_16"), "sixteenth");
  assert.equal(restGlyphKind("rest_32"), "thirty-second");
});

test("a whole rest hangs from the second line and a half rest sits on the middle line", () => {
  const whole = restGlyph({ duration: "rest_1", center: [300, 140], staff_lines: lines, unit_size: 20 });
  const half = restGlyph({ duration: "rest_2", center: [300, 140], staff_lines: lines, unit_size: 20 });
  assert.equal(whole?.fills, "M 288 120 H 312 V 130 H 288 Z");
  assert.equal(half?.fills, "M 288 130 H 312 V 140 H 288 Z");
});

test("shorter rests are drawn around the middle line at the rest's x", () => {
  const quarter = restGlyph({ duration: "rest_4", center: [300, 999], staff_lines: lines, unit_size: 20 });
  assert.equal(quarter?.strokes.startsWith("M 297 110"), true);
  const sixteenth = restGlyph({ duration: "rest_16", center: [300, 140], staff_lines: lines, unit_size: 20 });
  assert.equal(sixteenth?.kind, "sixteenth");
  assert.equal((sixteenth?.fills.match(/M /g) ?? []).length, 2);
});

test("a record without placement geometry draws nothing", () => {
  assert.equal(restGlyph({ duration: "rest_8", center: null, staff_lines: lines, unit_size: 20 }), null);
  assert.equal(restGlyph({ duration: "rest_8", center: [1, 1], staff_lines: [], unit_size: 20 }), null);
  assert.equal(restGlyph({ duration: "rest_8", center: [1, 1], staff_lines: lines, unit_size: null }), null);
});
