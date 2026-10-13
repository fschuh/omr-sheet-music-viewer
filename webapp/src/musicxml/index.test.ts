import assert from "node:assert/strict";
import test from "node:test";
import { isMusicXmlPath, musicXmlScoreDocument } from "./index";
import { pageFormat } from "./layout/pageFormat";

test("MusicXML files are recognized by extension", () => {
  for (const path of ["/a/score.musicxml", "/a/score.XML", "C:\\scores\\score.mxl"]) {
    assert.equal(isMusicXmlPath(path), true, path);
  }
  for (const path of ["/a/score.pdf", "/a/score.mxl.pdf", "/a/musicxml"]) {
    assert.equal(isMusicXmlPath(path), false, path);
  }
});

test("a score file opens as a complete document of engraved pages", () => {
  const document = musicXmlScoreDocument("musicxml-1", {
    path: "/scores/etude.mxl",
    name: "etude.mxl",
    musicXml: `<score-partwise><defaults>
      <scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>
      <page-layout><page-height>1600</page-height><page-width>1200</page-width></page-layout>
    </defaults><part-list/><part id="P1">
      <measure number="1"/><measure number="2"><print new-page="yes"/></measure>
    </part></score-partwise>`,
    sourceSha256: "abc",
    sourceByteLength: 10,
    scoreDataPath: "/data/musicxml-scores/abc",
  });
  const { width, height } = pageFormat({
    scaling: { millimeters: 7, tenths: 40 },
    pageSize: { width: 1200, height: 1600 },
  });
  assert.deepEqual(document, {
    jobId: "musicxml-1",
    name: "etude.mxl",
    pageCount: 2,
    source: {
      kind: "musicxml",
      sourcePath: "/scores/etude.mxl",
      scoreDataPath: "/data/musicxml-scores/abc",
    },
    status: "complete",
    pages: [0, 1].map((index) => ({
      index,
      status: "complete",
      width,
      height,
      surface: { index, width, height },
    })),
  });
});
