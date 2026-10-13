// Checks MusicXML scores the way the viewer opens them:
//
// - the note-geometry contract (section 3.4 of plans/musicxml-viewer-plan.md): every note
//   of the score appears exactly once in the note geometry of one page, links to a notehead
//   on that page, and every bound lies inside the page;
// - playback (section 6): the document MusicXML parses for realtime playback, its notes are
//   exactly the pitched notes on the pages, each with a visual target and in a measure on
//   the same page; note-by-note playback
//   attacks every note that starts a sound once, in score order; and the realtime route,
//   with its repeats, expands.
//
//   npm run musicxml:check -- <score.mxl|.musicxml|.xml>...
//
// Prints one line per score and exits non-zero when any score breaks the contract.
import { basename } from "node:path";
import { documentNoteScoreFacts } from "../../src/documentSource";
import { musicXmlNoteGeometry, musicXmlScoreDocument } from "../../src/musicxml";
import { parseMusicXml } from "../../src/musicxml/import/parseMusicXml";
import type { Bounds, PageNoteGeometry } from "../../src/noteGeometry";
import { buildPlaybackTimeline } from "../../src/playback";
import {
  buildRealtimeVisualMap,
  expandPerformanceRoute,
  parseRealtimeMusicXml,
  scoreNoteStartsAttack,
} from "../../src/realtime";
import { readScoreFile } from "./scoreFiles";

function inside(bounds: Bounds, width: number, height: number): boolean {
  return bounds[0] >= 0 && bounds[1] >= 0 && bounds[2] <= width && bounds[3] <= height;
}

function checkScore(path: string): string[] {
  const musicXml = readScoreFile(path);
  const score = parseMusicXml(musicXml);
  const expected = score.parts.flatMap((part) =>
    part.measures.flatMap((measure) => measure.chords.flatMap((chord) => chord.notes.map((note) => note.key))),
  );
  const started = performance.now();
  const document = musicXmlScoreDocument("check", {
    path, name: basename(path), musicXml, sourceSha256: "", sourceByteLength: 0, scoreDataPath: "",
  });
  const milliseconds = performance.now() - started;
  const geometry = musicXmlNoteGeometry(document.pages);
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const page of geometry) {
    const surface = document.pages[page.pageIndex];
    const noteheads = new Map(page.noteheads.map((notehead) => [notehead.id, notehead]));
    for (const note of page.notes) {
      const key = note.id.replace(/^page-\d+-/, "");
      if (!note.id.startsWith(`page-${page.pageIndex + 1}-`)) problems.push(`${note.id} is not scoped to page ${page.pageIndex + 1}`);
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (!noteheads.has(note.noteheadId)) problems.push(`${note.id} links to a missing notehead`);
    }
    for (const notehead of page.noteheads) {
      for (const bounds of [notehead.noteheadBounds, notehead.bounds, ...notehead.hitAreas]) {
        if (!inside(bounds, surface.width, surface.height)) {
          problems.push(`${notehead.id} on page ${page.pageIndex + 1} reaches outside the page`);
          break;
        }
      }
    }
  }
  for (const key of expected) {
    const count = seen.get(key) ?? 0;
    if (count !== 1) problems.push(`${key} appears ${count} times`);
  }
  if (seen.size !== expected.length) problems.push(`${seen.size} notes in the geometry, ${expected.length} in the score`);
  const routeNotes = checkPlayback(document.documentMusicXml ?? "", geometry, problems);
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${basename(path)}: ${document.pages.length} pages, ` +
      `${expected.length} notes, ${routeNotes} played, ${milliseconds.toFixed(0)} ms` +
      `${problems.length ? `, ${problems.length} problems` : ""}`,
  );
  for (const problem of problems.slice(0, 5)) console.log(`       ${problem}`);
  return problems;
}

/** Checks playback on the document MusicXML; returns how many notes the realtime route plays. */
function checkPlayback(documentMusicXml: string, geometry: PageNoteGeometry[], problems: string[]): number {
  const score = parseRealtimeMusicXml(documentMusicXml);
  const scoreNotes = score.measures.flatMap((measure) => measure.notes);
  const visualMap = buildRealtimeVisualMap(geometry);
  const pitched = new Set(geometry.flatMap((page) => page.notes.filter((note) => note.pitch !== null).map((note) => note.id)));
  const played = new Set(scoreNotes.map((note) => note.musicXmlId));
  for (const id of played) if (!visualMap.has(id)) problems.push(`realtime note ${id} has no visual target`);
  // Page navigation moves by the realtime score's page numbers, which must be the viewer's pages.
  for (const measure of score.measures) {
    for (const note of measure.notes) {
      const page = Number(/^page-(\d+)-/.exec(note.musicXmlId)?.[1]);
      if (page !== measure.pageNumber) problems.push(`${note.musicXmlId} is on page ${page}, its measure on page ${measure.pageNumber}`);
    }
  }
  for (const id of pitched) if (!played.has(id)) problems.push(`${id} is on the page but not in the realtime score`);

  // Note-by-note playback: every notehead whose note starts a sound is attacked once, in score order.
  const facts = documentNoteScoreFacts("musicxml", [], score);
  const timeline = buildPlaybackTimeline(geometry, facts);
  const noteheadOf = new Map(geometry.flatMap((page) => page.notes.map((note) => [note.id, `${page.pageIndex}:${note.noteheadId}`] as const)));
  const attacks = new Map<string, number>();
  for (const moment of timeline) {
    for (const note of moment.notes ?? []) {
      if (note.startsAttack) attacks.set(`${moment.pageIndex}:${note.visualGroupId}`, (attacks.get(`${moment.pageIndex}:${note.visualGroupId}`) ?? 0) + 1);
    }
  }
  const scoreTime = new Map<string, number>();
  for (const measure of score.measures) {
    for (const note of measure.notes) {
      const notehead = noteheadOf.get(note.musicXmlId);
      if (!notehead) continue;
      if (scoreNoteStartsAttack(note) && attacks.get(notehead) !== 1) {
        problems.push(`${note.musicXmlId} is attacked ${attacks.get(notehead) ?? 0} times note by note`);
      }
      scoreTime.set(notehead, measure.index * 1e4 + note.onset);
    }
  }
  let previous = -Infinity;
  for (const moment of timeline) {
    const time = Math.min(...moment.visualGroupIds.map((id) => scoreTime.get(`${moment.pageIndex}:${id}`) ?? Infinity));
    if (time < previous) problems.push(`moment ${moment.id} plays before the moment ahead of it`);
    previous = Math.max(previous, time);
  }

  const route = expandPerformanceRoute(score, { visualMap });
  for (const note of route.notes) {
    if (!note.visual) problems.push(`route note ${note.musicXmlId} has no visual target`);
  }
  return route.notes.length;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: check <score>...");
  process.exit(2);
}
let failed = 0;
for (const path of paths) {
  try {
    if (checkScore(path).length) failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${basename(path)}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}
console.log(failed ? `${failed} of ${paths.length} score(s) break the contract` : `all ${paths.length} score(s) keep the contract`);
process.exit(failed ? 1 : 0);
