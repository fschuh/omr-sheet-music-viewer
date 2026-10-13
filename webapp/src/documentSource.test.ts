import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnosticsAvailable,
  documentFolder,
  documentNoteGeometry,
  documentNoteScoreFacts,
} from "./documentSource";
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
      index: 0, firstMeasure: 0, width: 100, height: 100, staffSpace: 10, items: [],
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

test("a MusicXML score plays from its document MusicXML, every played note on its page", async () => {
  const { musicXmlScoreDocument } = await import("./musicxml");
  const { parseRealtimeMusicXml, buildRealtimeVisualMap } = await import("./realtime");
  const { buildPlaybackTimeline } = await import("./playback");
  const note = (step: string, octave: number, extra = "") =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>2</duration>${extra}<voice>1</voice><type>half</type></note>`;
  const musicXml = `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      ${note("C", 5, '<tie type="start"/>')}${note("C", 5, '<tie type="stop"/>')}</measure>
    <measure>${note("E", 5)}${note("G", 5)}</measure></part></score-partwise>`;
  const document = musicXmlScoreDocument("musicxml-1", {
    path: "/a.musicxml", name: "a.musicxml", musicXml, sourceSha256: "", sourceByteLength: 0, scoreDataPath: "/d",
  });
  const geometry = documentNoteGeometry("musicxml", document.pages);
  const score = parseRealtimeMusicXml(document.documentMusicXml!);
  const visual = buildRealtimeVisualMap(geometry);
  const played = score.measures.flatMap((measure) => measure.notes.map((value) => value.musicXmlId));
  assert.deepEqual(played, geometry.flatMap((page) => page.notes.map((value) => value.id)));
  for (const id of played) assert.ok(visual.has(id), id);
  // The tie's second note sounds nothing of its own.
  const timeline = buildPlaybackTimeline(geometry, documentNoteScoreFacts("musicxml", document.pages, score));
  assert.deepEqual(timeline.map((moment) => moment.pitches), [["C5"], ["E5"], ["G5"]]);
});

test("realtime page numbers are the viewer's pages, not the file's", async () => {
  const { musicXmlScoreDocument } = await import("./musicxml");
  const { parseRealtimeMusicXml } = await import("./realtime");
  const whole = (step: string) =>
    `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>`;
  // The file asks for a page break before measure 3 and calls that page 9.
  const musicXml = `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
    <measure><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>${whole("C")}</measure>
    <measure>${whole("D")}</measure>
    <measure><print new-page="yes" page-number="9"/>${whole("E")}</measure></part></score-partwise>`;
  const document = musicXmlScoreDocument("musicxml-1", {
    path: "/a.musicxml", name: "a.musicxml", musicXml, sourceSha256: "", sourceByteLength: 0, scoreDataPath: "/d",
  });
  assert.equal(document.pages.length, 2);
  const score = parseRealtimeMusicXml(document.documentMusicXml!);
  assert.deepEqual(score.measures.map((measure) => measure.pageNumber), [1, 1, 2]);
});
