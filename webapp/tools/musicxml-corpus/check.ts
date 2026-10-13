// Checks the note-geometry contract (section 3.4 of plans/musicxml-viewer-plan.md) on
// MusicXML scores: every note of the score appears exactly once in the note geometry of
// one page, links to a notehead on that page, and every bound lies inside the page.
//
//   npm run musicxml:check -- <score.mxl|.musicxml|.xml>...
//
// Prints one line per score and exits non-zero when any score breaks the contract.
import { basename } from "node:path";
import { musicXmlNoteGeometry, musicXmlScoreDocument } from "../../src/musicxml";
import { parseMusicXml } from "../../src/musicxml/import/parseMusicXml";
import type { Bounds } from "../../src/noteGeometry";
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
  console.log(
    `${problems.length ? "FAIL" : "ok  "} ${basename(path)}: ${document.pages.length} pages, ` +
      `${expected.length} notes, ${milliseconds.toFixed(0)} ms${problems.length ? `, ${problems.length} problems` : ""}`,
  );
  for (const problem of problems.slice(0, 5)) console.log(`       ${problem}`);
  return problems;
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
