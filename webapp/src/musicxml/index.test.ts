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
