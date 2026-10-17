import assert from "node:assert/strict";
import test from "node:test";
import { isMusicXmlPath, musicXmlNoteGeometry, musicXmlScoreDocument } from "./index";
import { pageFormat } from "./layout/pageFormat";
import { parseMusicXml } from "./import/parseMusicXml";
import { note, piano, score } from "./testScores";

test("MusicXML files are recognized by extension", () => {
  for (const path of ["/a/score.musicxml", "/a/score.XML", "C:\\scores\\score.mxl"]) {
    assert.equal(isMusicXmlPath(path), true, path);
  }
  for (const path of ["/a/score.pdf", "/a/score.mxl.pdf", "/a/musicxml"]) {
    assert.equal(isMusicXmlPath(path), false, path);
  }
});

const musicXml = score(
  [piano([
    note("C5", 16, { type: "whole" }),
    '<print new-page="yes"/>' + note("D5", 16, { type: "whole" }),
  ])],
  `<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-height>1600</page-height><page-width>1200</page-width></page-layout></defaults>`,
);

const file = {
  path: "/scores/etude.mxl",
  name: "etude.mxl",
  musicXml,
  sourceSha256: "abc",
  sourceByteLength: 10,
  scoreDataPath: "/data/musicxml-scores/abc",
};

test("a score file opens as a complete document of engraved pages", () => {
  const document = musicXmlScoreDocument("musicxml-1", file);
  const { width, height } = pageFormat(parseMusicXml(musicXml).defaults);
  const { documentMusicXml, ...rest } = document;
  assert.ok(documentMusicXml?.includes('id="page-2-P1-m2-s1-v1-t0-D5"'));
  assert.deepEqual(
    { ...rest, pages: document.pages.map(({ surface, ...page }) => ({ ...page, surface: surface?.index })) },
    {
      jobId: "musicxml-1",
      name: "etude.mxl",
      pageCount: 2,
      source: { kind: "musicxml", sourcePath: "/scores/etude.mxl", scoreDataPath: "/data/musicxml-scores/abc" },
      fingeringStatus: "pending",
      status: "complete",
      pages: [0, 1].map((index) => ({ index, status: "complete", width, height, surface: index })),
    },
  );
});

test("the document's note geometry holds each page's notes under page-scoped viewer IDs", () => {
  const geometry = musicXmlNoteGeometry(musicXmlScoreDocument("musicxml-1", file).pages);
  assert.deepEqual(geometry.map((page) => [page.pageIndex, page.notes.map((value) => value.id)]), [
    [0, ["page-1-P1-m1-s1-v1-t0-C5"]],
    [1, ["page-2-P1-m2-s1-v1-t0-D5"]],
  ]);
  assert.deepEqual(musicXmlNoteGeometry([{ index: 0, status: "complete", width: 1, height: 1 }]), []);
});

test("each engraved system records its staves and barlines, numbering measures through the score", () => {
  const breaks: Record<number, string> = { 4: '<print new-system="yes"/>', 8: '<print new-page="yes"/>' };
  const measures = Array.from({ length: 12 }, (_, index) =>
    (breaks[index] ?? "") + note(index % 2 ? "E5" : "C5", 16, { type: "whole" }));
  const document = musicXmlScoreDocument("musicxml-2", { ...file, musicXml: score([piano(measures)]) });
  const pages = musicXmlNoteGeometry(document.pages);
  const systems = pages.flatMap((page) => page.systems.map((system) => ({ page, system })));
  assert.deepEqual(systems.map(({ page, system }) => [page.pageIndex, system.firstMeasure]), [[0, 0], [0, 4], [1, 8]]);
  let expectedFirst = 0;
  for (const { page, system } of systems) {
    assert.equal(page.measureOffset, 0);
    assert.equal(system.firstMeasure, expectedFirst);
    expectedFirst += system.barlines.length - 1;
    const surface = document.pages[page.pageIndex].surface!;
    const lines = surface.items.flatMap((item) => (item.kind === "line" ? [item] : []));
    assert.ok(lines.some((line) => line.y1 === system.top && line.y2 === system.top), "top is the first staff's top line");
    assert.ok(
      lines.some((line) => line.y1 === system.bottom && line.y2 === system.bottom),
      "bottom is the last staff's bottom line",
    );
    // Every barline between two measures is where one is drawn across the staves.
    for (const x of system.barlines.slice(1, -1)) {
      assert.ok(
        lines.some((line) => line.x1 === line.x2 && Math.abs(line.x1 - x) < 1 && line.y1 <= system.top && line.y2 >= system.bottom),
        `a barline is drawn at ${x}`,
      );
    }
    for (let index = 1; index < system.barlines.length; index += 1) {
      assert.ok(system.barlines[index] > system.barlines[index - 1]);
    }
  }
  assert.equal(expectedFirst, 12);
  // The notes of each system lie between its barlines, in their own measures.
  for (const page of pages) {
    for (const value of page.notes) {
      const head = page.noteheads.find((candidate) => candidate.id === value.noteheadId)!;
      const system = page.systems.find((candidate) => candidate.index === head.systemIndex)!;
      const local = page.measureOffset + value.measure - 1 - system.firstMeasure;
      assert.ok(head.center[0] > system.barlines[local] && head.center[0] < system.barlines[local + 1]);
    }
  }
});
