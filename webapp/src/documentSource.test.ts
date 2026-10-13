import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticsAvailable, documentFolder } from "./documentSource";
import type { DocumentSource, LoadedDocument } from "./types";

function loaded(source: DocumentSource): LoadedDocument {
  return { jobId: "job", name: "score", pageCount: 0, source, status: "complete", pages: [] };
}

const pdf = loaded({ kind: "pdf", cacheStatus: "complete", cachePath: "/cache/pdf-cache/abc" });
const musicXml = loaded({
  kind: "musicxml",
  sourcePath: "/scores/nocturne.mxl",
  scoreDataPath: "/data/musicxml-scores/abc",
});

test("diagnostics are offered for PDFs only", () => {
  assert.equal(diagnosticsAvailable(pdf), true);
  assert.equal(diagnosticsAvailable(null), true);
  assert.equal(diagnosticsAvailable(musicXml), false);
});

test("the folder button opens the PDF cache or the score data folder", () => {
  assert.deepEqual(documentFolder(pdf), {
    kind: "pdf-cache",
    path: "/cache/pdf-cache/abc",
    label: "Open cache folder",
    title: "/cache/pdf-cache/abc",
  });
  assert.deepEqual(documentFolder(musicXml), {
    kind: "score-data",
    path: "/data/musicxml-scores/abc",
    label: "Open score data folder",
    title: "/data/musicxml-scores/abc",
  });
  assert.equal(documentFolder(loaded({ kind: "pdf", cacheStatus: "miss" })).path, undefined);
  assert.equal(
    documentFolder(loaded({ kind: "musicxml", sourcePath: "/scores/a.musicxml" })).path,
    undefined,
  );
});
