import assert from "node:assert/strict";
import test from "node:test";
import { parseRealtimeMusicXml } from "./realtime";
import {
  diagnosticNoteheads,
  pdfNoteGeometry,
  pdfNoteScoreFacts,
  sidecarNoteGeometry,
} from "./sidecarNoteGeometry";
import type { DocumentPage, VisualGroup, VisualSidecar, VisualSidecarNote } from "./types";

function group(id: string, x: number, y: number, overrides: Partial<VisualGroup> = {}): VisualGroup {
  return {
    visual_group_id: id,
    staff_group_index: 0,
    staff_index: 0,
    staff_position: 0,
    center: [x, y],
    bbox: [x - 10, y - 50, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [[[x - 9, y - 7], [x + 9, y - 7], [x + 9, y + 7], [x - 9, y + 7]]],
    stem_contours: [],
    musicxml_id: `note-${id}`,
    visual_status: "canonical",
    provenance: "segmentation",
    moment_id: `moment-${id}`,
    chord_id: null,
    repair_actions: [],
    ...overrides,
  };
}

function note(id: string, groupId: string | null, overrides: Partial<VisualSidecarNote> = {}): VisualSidecarNote {
  return {
    musicxml_id: id,
    part: 1,
    measure: 3,
    musicxml_staff_number: 1,
    voice: 1,
    pitch: "C4",
    duration: "note_4",
    match_confidence: 1,
    visual_group_id: groupId,
    alignment_method: "structural",
    ...overrides,
  };
}

function sidecar(groups: VisualGroup[], notes: VisualSidecarNote[]): VisualSidecar {
  return { version: 3, source_image_size: [1000, 1400], visual_groups: groups, notes };
}

function recognizedPage(index: number, data: VisualSidecar, musicXml?: string): DocumentPage {
  return { index, status: "complete", width: 1000, height: 1400, visualSidecar: data, musicXml };
}

test("only linked visual groups and their notes become note geometry", () => {
  const data = sidecar(
    [
      group("linked", 100, 100),
      group("diagnostic", 200, 100, { visual_status: "diagnostic", musicxml_id: null }),
      group("unlinked", 300, 100, { musicxml_id: null }),
    ],
    [
      note("note-linked", "linked"),
      note("note-diagnostic", "diagnostic"),
      note("note-unlinked", "unlinked"),
      note("note-without-group", null),
    ],
  );
  const geometry = sidecarNoteGeometry(data, 0, "page-1-");
  assert.deepEqual(geometry.noteheads.map((notehead) => notehead.id), ["linked"]);
  assert.deepEqual(geometry.notes.map((value) => value.id), ["page-1-note-linked"]);
  assert.deepEqual(diagnosticNoteheads(data).map((notehead) => notehead.id), ["diagnostic"]);
});

test("notes carry pitch, measure, the grace flag and their notehead", () => {
  const data = sidecar(
    [group("a", 100, 100), group("b", 200, 100)],
    [
      note("n1", "a", { pitch: "F#5", measure: 7 }),
      note("n2", "b", { duration: "note_8G" }),
    ],
  );
  assert.deepEqual(sidecarNoteGeometry(data, 2, "page-3-").notes, [
    { id: "page-3-n1", noteheadId: "a", pitch: "F#5", grace: false, measure: 7 },
    { id: "page-3-n2", noteheadId: "b", pitch: "C4", grace: true, measure: 3 },
  ]);
});

test("notehead boxes come from the rotated ellipse, hit areas from the traced outline", () => {
  const data = sidecar(
    [group("a", 100, 100, { notehead_ellipses: [{ center: [100, 100], rx: 10, ry: 6, angle: 90 }] })],
    [note("n1", "a")],
  );
  const [notehead] = sidecarNoteGeometry(data, 0, "").noteheads;
  const [left, top, right, bottom] = notehead.noteheadBounds;
  assert.ok(Math.abs(left - 94) < 1e-9 && Math.abs(right - 106) < 1e-9);
  assert.ok(Math.abs(top - 90) < 1e-9 && Math.abs(bottom - 110) < 1e-9);
  assert.deepEqual(notehead.hitAreas, [[91, 93, 109, 107]]);
  assert.deepEqual(notehead.bounds, [90, 50, 110, 108]);
});

test("a group without an ellipse or a box falls back to its outline", () => {
  const data = sidecar(
    [group("a", 100, 100, { notehead_ellipses: [], bbox: [] })],
    [note("n1", "a")],
  );
  const [notehead] = sidecarNoteGeometry(data, 0, "").noteheads;
  assert.deepEqual(notehead.noteheadBounds, [91, 93, 109, 107]);
  assert.deepEqual(notehead.bounds, [91, 93, 109, 107]);
});

test("note IDs are scoped by music page, skipping pages without music", () => {
  const pages: DocumentPage[] = [
    recognizedPage(0, sidecar([group("a", 100, 100)], [note("n1", "a")])),
    { index: 1, status: "skipped", width: 1000, height: 1400 },
    recognizedPage(2, sidecar([group("a", 100, 100)], [note("n1", "a")])),
  ];
  const geometry = pdfNoteGeometry(pages);
  assert.deepEqual(geometry.map((page) => page.pageIndex), [0, 2]);
  assert.deepEqual(geometry.map((page) => page.notes[0].id), ["page-1-n1", "page-2-n1"]);
});

test("geometry is reused while a page's sidecar and scope stay the same", () => {
  const data = sidecar([group("a", 100, 100)], [note("n1", "a")]);
  assert.equal(sidecarNoteGeometry(data, 0, "page-1-"), sidecarNoteGeometry(data, 0, "page-1-"));
  assert.notEqual(sidecarNoteGeometry(data, 0, "page-1-"), sidecarNoteGeometry(data, 0, "page-2-"));
});

const tiedPageMusicXml = `<score-partwise><part id="P1"><measure number="1">
  <attributes><divisions>1</divisions></attributes>
  <note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><notations><tied type="start"/></notations></note>
  <note id="n2"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><notations><tied type="stop"/></notations></note>
</measure></part></score-partwise>`;

test("page score facts are scoped like the merged document", () => {
  const pages = [
    { index: 0, status: "skipped" as const, width: 1000, height: 1400 },
    recognizedPage(1, sidecar([group("a", 100, 100)], [note("n1", "a")]), tiedPageMusicXml),
  ];
  const facts = pdfNoteScoreFacts(pages, null);
  assert.deepEqual([...facts.suppressedNoteIds], ["page-1-n2"]);
  assert.equal(facts.startsAttackByNoteId.get("page-1-n1"), true);
});

test("the merged document's facts replace the pages' own", () => {
  const pages = [recognizedPage(0, sidecar([group("a", 100, 100)], [note("n1", "a")]), tiedPageMusicXml)];
  const documentScore = parseRealtimeMusicXml(
    tiedPageMusicXml.replaceAll('id="n', 'id="page-1-n'),
  );
  assert.deepEqual([...pdfNoteScoreFacts(pages, documentScore).suppressedNoteIds], ["page-1-n2"]);
});

test("a page whose MusicXML does not parse contributes no facts", () => {
  const pages = [recognizedPage(0, sidecar([group("a", 100, 100)], [note("n1", "a")]), "<not-xml")];
  const facts = pdfNoteScoreFacts(pages, null);
  assert.equal(facts.suppressedNoteIds.size, 0);
  assert.equal(facts.startsAttackByNoteId.size, 0);
});
