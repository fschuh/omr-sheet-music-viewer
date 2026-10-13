import assert from "node:assert/strict";
import test from "node:test";
import type { ScoreModel } from "../model/score";
import { pageFormat } from "./pageFormat";
import { layoutPages } from "./pages";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test("an encoded page format becomes page pixels at 300 per inch", () => {
  // MuseScore's A4: 7.056 mm per 40 tenths, 1683.67 x 1190.48 tenths = 297.0 x 210.0 mm.
  const format = pageFormat({
    scaling: { millimeters: 7.056, tenths: 40 },
    pageSize: { width: 1190.48, height: 1683.67 },
  });
  close(format.width, (1190.48 * 7.056) / 40 / 25.4 * 300);
  close(format.height, (1683.67 * 7.056) / 40 / 25.4 * 300);
  close(format.staffSpace, 1.764 / 25.4 * 300);
});

test("a score without a page format gets a Letter page and a 1.75 mm staff space", () => {
  const format = pageFormat({ scaling: null, pageSize: null });
  close(format.width, 2550);
  close(format.height, 3300);
  close(format.staffSpace, 1.75 / 25.4 * 300);
  // A page size without scaling is read with the default staff space.
  close(pageFormat({ scaling: null, pageSize: { width: 1000, height: 2000 } }).width, 175 / 25.4 * 300);
});

function score(newPages: boolean[]): ScoreModel {
  return {
    defaults: { scaling: null, pageSize: null },
    measures: newPages.map((newPage) => ({ newPage })),
  };
}

test("encoded page breaks start new pages", () => {
  const format = { width: 100, height: 200, staffSpace: 10 };
  assert.deepEqual(layoutPages(score([false, false, true, false, true]), format).pages, [
    { index: 0, width: 100, height: 200 },
    { index: 1, width: 100, height: 200 },
    { index: 2, width: 100, height: 200 },
  ]);
  assert.equal(layoutPages(score([true, false]), format).pages.length, 1);
  assert.equal(layoutPages(score([]), format).pages.length, 1);
});
