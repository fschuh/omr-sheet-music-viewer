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

/** homr's staff positions: 1 on the bottom line, 9 on the top line, half a space apart. */
function staffGroup(id: string, system: number, staff: number, position: number, x: number): VisualGroup {
  const bottomLine = 1000 * system + 300 + staff * 200;
  return group(id, x, bottomLine - (position - 1) * 10, {
    staff_group_index: system,
    staff_index: staff,
    staff_position: position,
  });
}

function measureXml(count: number): string {
  return `<score-partwise><part id="P1">${"<measure></measure>".repeat(count)}</part></score-partwise>`;
}

test("a PDF page's systems are fitted to its noteheads, with barlines between its measures", () => {
  const groups = [
    staffGroup("a", 0, 0, 5, 100),
    staffGroup("b", 0, 1, 3, 200),
    staffGroup("c", 0, 0, 9, 400),
    staffGroup("d", 1, 0, 1, 120),
    staffGroup("e", 1, 1, 7, 500),
  ];
  const measures = { a: 1, b: 1, c: 2, d: 3, e: 5 } as Record<string, number>;
  const data = sidecar(groups, groups.map((value) => note(`n-${value.visual_group_id}`, value.visual_group_id, {
    measure: measures[value.visual_group_id],
  })));
  const [first, second] = pdfNoteGeometry([
    recognizedPage(0, sidecar([], []), measureXml(4)),
    recognizedPage(1, data, measureXml(5)),
  ]);
  assert.deepEqual([first.pageIndex, first.measureOffset, first.systems], [0, 0, []]);
  assert.equal(second.measureOffset, 4);
  const [top, bottom] = second.systems;
  // The first staff's top line and the second staff's bottom line.
  assert.deepEqual([top.top, top.bottom], [220, 500]);
  assert.deepEqual([bottom.top, bottom.bottom], [1220, 1500]);
  // Measures 1-2 on the first system, 3-5 on the second, after the page before's four.
  assert.equal(top.firstMeasure, 4);
  assert.equal(bottom.firstMeasure, 6);
  assert.equal(top.barlines.length, 3);
  assert.equal(bottom.barlines.length, 4);
  // Halfway between measure 1's last notehead and measure 2's first.
  assert.equal(top.barlines[1], (210 + 390) / 2);
  // Measure 4 has no notes: the gap between measures 3 and 5 is shared out.
  assert.deepEqual(bottom.barlines.slice(1, 3), [130 + (490 - 130) / 3, 130 + (2 * (490 - 130)) / 3]);
  assert.ok(top.barlines[0] < 90 && top.barlines[2] > 410, "the system reaches past its outer notes");
});

test("rests place their measures and give their staff's lines", () => {
  const groups = [staffGroup("a", 0, 0, 5, 100)];
  const data: VisualSidecar = {
    ...sidecar(groups, [note("n-a", "a", { measure: 1 })]),
    rest_verification: {
      version: 1,
      rests: [{
        rest_id: "r",
        part: 1,
        measure: 2,
        musicxml_staff_number: 1,
        voice: 1,
        duration: "rest_1",
        status: "supported",
        reason: "",
        staff_group_index: 0,
        staff_index: 0,
        center: [600, 260],
        staff_lines: [218, 238, 258, 278, 298],
        unit_size: 20,
      }],
    },
  };
  const [system] = pdfNoteGeometry([recognizedPage(0, data, measureXml(2))])[0].systems;
  assert.deepEqual([system.top, system.bottom], [218, 298]);
  assert.equal(system.barlines.length, 3);
  assert.equal(system.barlines[1], (110 + 588) / 2);
});

test("playback moments know their measure's place in the document", async () => {
  const { buildPlaybackTimeline } = await import("./playback");
  const groups = [staffGroup("a", 0, 0, 5, 100), staffGroup("c", 0, 0, 9, 400)];
  const data = sidecar(groups, [note("n-a", "a", { measure: 1 }), note("n-c", "c", { measure: 2 })]);
  const timeline = buildPlaybackTimeline(pdfNoteGeometry([
    recognizedPage(0, sidecar([], []), measureXml(3)),
    recognizedPage(1, data, measureXml(2)),
  ]));
  assert.deepEqual(timeline.map((moment) => [moment.measure, moment.measureIndex]), [[1, 3], [2, 4]]);
});
