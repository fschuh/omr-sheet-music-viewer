import assert from "node:assert/strict";
import test from "node:test";
import {
  hitTestNoteheads,
  selectedNoteheadIds,
  type NoteheadGeometry,
  type PageNoteGeometry,
} from "./noteGeometry";

function notehead(
  id: string,
  x: number,
  y: number,
  chordId: string | null = null,
): NoteheadGeometry {
  return {
    id,
    systemIndex: 0,
    center: [x, y],
    noteheadBounds: [x - 10, y - 8, x + 10, y + 8],
    hitAreas: [[x - 10, y - 8, x + 10, y + 8]],
    bounds: [x - 10, y - 60, x + 10, y + 8],
    chordId,
    momentId: null,
  };
}

function page(noteheads: NoteheadGeometry[]): PageNoteGeometry {
  return { pageIndex: 0, noteheads, notes: [] };
}

test("a click selects a notehead up to three pixels outside its hit area", () => {
  const target = notehead("a", 100, 100);
  assert.equal(hitTestNoteheads([target], [113, 100])?.id, "a");
  assert.equal(hitTestNoteheads([target], [100, 111])?.id, "a");
  // Beside the notehead and below its stem, nothing is hit.
  assert.equal(hitTestNoteheads([target], [113.5, 100]), null);
  assert.equal(hitTestNoteheads([target], [100, 111.5]), null);
});

test("a click on the stem falls back to the notehead's bounds", () => {
  const target = notehead("a", 100, 100);
  assert.equal(hitTestNoteheads([target], [105, 50])?.id, "a");
  assert.equal(hitTestNoteheads([target], [111, 50]), null);
});

test("a hit area wins over bounds, and the nearest center breaks ties", () => {
  const stemmed = notehead("stemmed", 100, 160);
  const near = notehead("near", 104, 100);
  const far = notehead("far", 112, 100);
  // The point lies on stemmed's stem and on both noteheads' hit areas.
  assert.equal(hitTestNoteheads([stemmed, far, near], [105, 104])?.id, "near");
});

test("preferred noteheads win where they overlap others", () => {
  const linked = notehead("linked", 100, 100);
  const diagnostic = notehead("diagnostic", 106, 100);
  assert.equal(hitTestNoteheads([linked, diagnostic], [100, 100])?.id, "linked");
  assert.equal(
    hitTestNoteheads([linked, diagnostic], [100, 100], new Set(["diagnostic"]))?.id,
    "diagnostic",
  );
});

test("selecting a chord notehead highlights the whole chord", () => {
  const geometry = page([
    notehead("low", 100, 140, "chord-1"),
    notehead("high", 100, 100, "chord-1"),
    notehead("other", 200, 100),
  ]);
  assert.deepEqual(
    selectedNoteheadIds(geometry, { pageIndex: 0, visualGroupId: "low" }, 0, false),
    new Set(["low", "high"]),
  );
  assert.deepEqual(
    selectedNoteheadIds(geometry, { pageIndex: 0, visualGroupId: "other" }, 0, false),
    new Set(["other"]),
  );
});

test("selection is empty for another page, an unknown notehead, or no selection", () => {
  const geometry = page([notehead("a", 100, 100)]);
  assert.deepEqual(
    selectedNoteheadIds(geometry, { pageIndex: 1, visualGroupId: "a" }, 0, false),
    new Set(),
  );
  assert.deepEqual(
    selectedNoteheadIds(geometry, { pageIndex: 0, visualGroupId: "missing" }, 0, false),
    new Set(),
  );
  assert.deepEqual(selectedNoteheadIds(geometry, null, 0, false), new Set());
  assert.deepEqual(selectedNoteheadIds(undefined, null, 0, true), new Set());
});

test("highlight-all covers the page's noteheads but not standalone ones", () => {
  const geometry = page([notehead("a", 100, 100), notehead("b", 200, 100)]);
  const standalone = [notehead("diagnostic", 300, 100, "chord-x")];
  assert.deepEqual(
    selectedNoteheadIds(geometry, null, 0, true, standalone),
    new Set(["a", "b"]),
  );
  assert.deepEqual(
    selectedNoteheadIds(
      geometry,
      { pageIndex: 0, visualGroupId: "diagnostic" },
      0,
      false,
      standalone,
    ),
    new Set(["diagnostic"]),
  );
});
