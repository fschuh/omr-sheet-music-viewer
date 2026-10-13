import assert from "node:assert/strict";
import test from "node:test";
import { parseMusicXml } from "../import/parseMusicXml";
import { attributes, measure, note, part, score } from "../testScores";
import { beamGroups, stemDirections } from "./beams";
import { layoutChord, type ChordShape } from "./chords";
import {
  justify,
  measureSpacing,
  NATURAL_SPACING,
  springWidth,
  systemWidth,
  TIGHTEST_SPACING,
  type MeasureSpacing,
} from "./horizontal";
import { prepareScore, type PreparedChord } from "./measureContent";
import { breakSystems } from "./systems";

/** Spacing for a treble score, one string of notes per measure (divisions 4). */
function spacings(measures: string[]): MeasureSpacing[] {
  const prepared = prepareScore(parseMusicXml(score([part("P1", measures.map((content, index) =>
    measure((index === 0 ? attributes({ divisions: 4, fifths: 0, time: [4, 4], clefs: ["G"] }) : "") + content),
  ))])));
  const shapes = new Map<PreparedChord, ChordShape>();
  for (const value of prepared.measures) {
    const groups = beamGroups(value);
    const directions = stemDirections(value, groups);
    for (const segment of value.segments) {
      for (const chord of [...segment.graces, ...segment.chords]) {
        shapes.set(chord, layoutChord(chord, directions.get(chord) ?? true, false, value.duration));
      }
    }
  }
  return prepared.measures.map((value) => measureSpacing(prepared, value, shapes));
}

const quarters = note("C5", 4, { type: "quarter" }).repeat(4);
const eighths = note("C5", 2, { type: "eighth" }).repeat(8);
const halves = note("C5", 8, { type: "half" }).repeat(2);

test("natural spacing grows by half for every doubling of duration, from 3.5 spaces a quarter", () => {
  const [quarter] = spacings([quarters]);
  const [eighth] = spacings([eighths]);
  const [half] = spacings([halves]);
  assert.ok(Math.abs(springWidth(quarter.springs[0], NATURAL_SPACING) - 3.5) < 1e-9);
  assert.ok(Math.abs(springWidth(eighth.springs[0], NATURAL_SPACING) - 3.5 / 1.5) < 1e-9);
  assert.ok(Math.abs(springWidth(half.springs[0], NATURAL_SPACING) - 3.5 * 1.5) < 1e-9);
});

test("springs never get narrower than the symbols they separate, with padding", () => {
  const [accidentals] = spacings([note("C5", 1, { type: "16th" }) + note("C#5", 1, { type: "16th" }) + note("C5", 14, { type: "half", dots: 2 })]);
  const [plain] = spacings([note("C5", 1, { type: "16th" }) + note("C5", 1, { type: "16th" }) + note("C5", 14, { type: "half", dots: 2 })]);
  assert.ok(accidentals.springs[0].hard > plain.springs[0].hard, "an accidental widens the gap before it");
  assert.ok(springWidth(plain.springs[0], { force: 0, squeeze: 1 }) >= plain.springs[0].hard + plain.springs[0].padding);
});

test("justification fills a width exactly, by stretching or by squeezing padding", () => {
  const measures = spacings([eighths, quarters, halves]);
  const natural = systemWidth(measures, NATURAL_SPACING);
  for (const width of [natural * 1.3, natural, natural * 0.9]) {
    const spacing = justify(measures, width);
    assert.ok(Math.abs(systemWidth(measures, spacing) - width) < 1e-6, `width ${width}`);
    assert.equal(spacing.squeeze, 1);
  }
  const tight = systemWidth(measures, { force: 0, squeeze: 1 });
  const squeezed = justify(measures, tight - 1);
  assert.ok(squeezed.squeeze < 1 && squeezed.force === 0);
  assert.ok(Math.abs(systemWidth(measures, squeezed) - (tight - 1)) < 1e-6);
  // Narrower than even the tightest spacing: the tightest spacing it is.
  assert.deepEqual(justify(measures, systemWidth(measures, TIGHTEST_SPACING) - 1), TIGHTEST_SPACING);
});

test("encoded system breaks are kept, and a system breaks early only when it cannot fit", () => {
  const measures = spacings([quarters, quarters, quarters, quarters]);
  const one = systemWidth(measures.slice(0, 1), NATURAL_SPACING);
  const plans = breakSystems(measures, [true, false, true, false], () => one * 10);
  assert.deepEqual(plans.map((plan) => plan.measures), [[0, 1], [2, 3]]);
  // Systems that cannot fit even squeezed are split.
  const tightest = Math.min(
    systemWidth(measures.slice(0, 2), TIGHTEST_SPACING),
    systemWidth(measures.slice(2, 4), TIGHTEST_SPACING),
  );
  const split = breakSystems(measures, [true, false, true, false], () => tightest - 1);
  assert.deepEqual(split.map((plan) => plan.measures), [[0], [1], [2], [3]]);
});

test("without encoded breaks, measures fill each system and every system is justified", () => {
  const measures = spacings(Array.from({ length: 12 }, () => quarters));
  const width = systemWidth(measures.slice(0, 4), NATURAL_SPACING) + 1;
  const plans = breakSystems(measures, measures.map(() => false), () => width);
  assert.ok(plans.length >= 3);
  assert.deepEqual(plans.flatMap((plan) => plan.measures), measures.map((_, index) => index));
  for (const plan of plans) {
    const system = plan.measures.map((index) => measures[index]);
    assert.ok(Math.abs(systemWidth(system, plan.spacing) - width) < 1e-6);
  }
});

test("a nearly empty last system keeps its natural spacing", () => {
  const measures = spacings([quarters, quarters]);
  const width = systemWidth(measures.slice(0, 1), NATURAL_SPACING) * 4;
  const plans = breakSystems(measures, [true, false], () => width);
  assert.deepEqual(plans.map((plan) => plan.measures), [[0, 1]]);
  assert.deepEqual(plans[0].spacing, justify(measures, width));
  const lonely = breakSystems(measures, [true, true], () => width);
  assert.deepEqual(lonely[1].spacing, NATURAL_SPACING);
});
