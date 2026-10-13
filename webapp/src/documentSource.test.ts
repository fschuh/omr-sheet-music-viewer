import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticsAvailable, documentFolder, documentNoteGeometry } from "./documentSource";
import type { DocumentPage, DocumentSource, LoadedDocument } from "./types";

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

test("note geometry comes from engraved pages for MusicXML and from the sidecar for PDFs", () => {
  const engraved: DocumentPage = {
    index: 0,
    status: "complete",
    width: 100,
    height: 100,
    surface: {
      index: 0, width: 100, height: 100, staffSpace: 10, items: [],
      chords: [{
        id: "P1-m1-s1-v1-t0", systemIndex: 0, momentId: "m1-t0", items: [], stemBounds: null,
        notes: [{ key: "P1-m1-s1-v1-t0-C5", pitch: "C5", grace: false, measure: 1, center: [5, 5], headBounds: [0, 0, 10, 10], items: [] }],
      }],
    },
  };
  assert.deepEqual(
    documentNoteGeometry("musicxml", [engraved]).map((page) => page.notes.map((value) => value.id)),
    [["page-1-P1-m1-s1-v1-t0-C5"]],
  );
  // A PDF reads only recognized pages, so an engraved surface contributes nothing there.
  assert.deepEqual(documentNoteGeometry("pdf", [engraved]), []);
  assert.deepEqual(documentNoteGeometry(undefined, []), []);
});
