import assert from "node:assert/strict";
import test from "node:test";
import {
  clampLoopRegion,
  draggedLoopRegion,
  loopAroundMeasure,
  loopBoundaryPlacement,
  loopDimSpans,
  loopLabel,
  loopMeasureCount,
  loopNoteByNoteState,
  loopRegionAfterCommand,
  loopRouteOffset,
  loopSegments,
  loopSystems,
  moveLoopHandleTo,
  routeEndBarline,
  routeStartBarline,
  routeStructuralPosition,
  type LoopRegion,
  type LoopSystem,
} from "./loop";
import type { PageNoteGeometry } from "./noteGeometry";
import { initialPlaybackState, runPlaybackCommand, type PlaybackMoment, type PlaybackState } from "./playback";
import {
  expandPerformanceRoute,
  parseRealtimeMusicXml,
  RealtimeController,
  realtimePlayheadAt,
  type VisualNoteTarget,
} from "./realtime";

/** Two systems of three measures on page 0, one of two measures on page 1. */
function geometry(): PageNoteGeometry[] {
  return [
    {
      pageIndex: 1,
      noteheads: [],
      notes: [],
      measureOffset: 6,
      systems: [{ index: 0, top: 100, bottom: 300, firstMeasure: 6, barlines: [50, 400, 800] }],
    },
    {
      pageIndex: 0,
      noteheads: [],
      notes: [],
      measureOffset: 0,
      systems: [
        { index: 0, top: 100, bottom: 300, firstMeasure: 0, barlines: [50, 300, 550, 800] },
        { index: 1, top: 500, bottom: 700, firstMeasure: 3, barlines: [50, 300, 550, 800] },
      ],
    },
  ];
}

const systems = loopSystems(geometry());

test("systems are ordered by measure across pages, and count the document's measures", () => {
  assert.deepEqual(systems.map((system) => [system.pageIndex, system.systemIndex, system.firstMeasure]), [
    [0, 0, 0],
    [0, 1, 3],
    [1, 0, 6],
  ]);
  assert.equal(loopMeasureCount(systems), 8);
});

test("a new loop is the playhead's measure, and every loop stays inside the score", () => {
  assert.deepEqual(loopAroundMeasure(4, 8), { startMeasure: 4, endMeasure: 5 });
  assert.deepEqual(loopAroundMeasure(9, 8), { startMeasure: 7, endMeasure: 8 });
  assert.deepEqual(clampLoopRegion({ startMeasure: 5, endMeasure: 5 }, 8), { startMeasure: 5, endMeasure: 6 });
  assert.deepEqual(clampLoopRegion({ startMeasure: -2, endMeasure: 20 }, 8), { startMeasure: 0, endMeasure: 8 });
  assert.equal(clampLoopRegion({ startMeasure: 0, endMeasure: 1 }, 0), null);
});

test("labels count bars from 1, inclusive", () => {
  assert.equal(loopLabel({ startMeasure: 2, endMeasure: 3 }), "Bar 3");
  assert.equal(loopLabel({ startMeasure: 2, endMeasure: 4 }), "Bars 3–4");
});

test("a barline between systems starts a loop on the next system and ends one on the previous", () => {
  const start = loopBoundaryPlacement(systems, 3, "start");
  const end = loopBoundaryPlacement(systems, 3, "end");
  assert.deepEqual([start?.system.systemIndex, start?.x], [1, 50]);
  assert.deepEqual([end?.system.systemIndex, end?.x], [0, 800]);
  // Across pages too: measure 6 begins page 1.
  assert.deepEqual(loopBoundaryPlacement(systems, 6, "start")?.system.pageIndex, 1);
  assert.deepEqual(loopBoundaryPlacement(systems, 6, "end")?.system.pageIndex, 0);
});

test("a loop over several systems has a segment on each, with handles only at its true ends", () => {
  const segments = loopSegments(systems, { startMeasure: 1, endMeasure: 7 });
  assert.deepEqual(
    segments.map((segment) => [segment.system.pageIndex, segment.system.systemIndex, segment.left, segment.right, segment.startsHere, segment.endsHere]),
    [
      [0, 0, 300, 800, true, false],
      [0, 1, 50, 800, false, false],
      [1, 0, 50, 400, false, true],
    ],
  );
  const [first] = loopSegments(systems, { startMeasure: 3, endMeasure: 6 });
  assert.deepEqual([first.system.systemIndex, first.left, first.right, first.startsHere, first.endsHere], [1, 50, 800, true, true]);
});

test("the bars outside the loop are dimmed on every system", () => {
  const region = { startMeasure: 1, endMeasure: 2 };
  assert.deepEqual(loopDimSpans(systems[0], region), [[50, 300], [550, 800]]);
  assert.deepEqual(loopDimSpans(systems[1], region), [[50, 800]]);
  assert.deepEqual(loopDimSpans(systems[0], { startMeasure: 0, endMeasure: 3 }), []);
});

// Staves 200 pixels tall, 400 apart; a handle reaching 64 above them and 24 below.
const screen = systems.map((system: LoopSystem, index) => ({
  top: 100 + index * 400,
  bottom: 300 + index * 400,
  firstMeasure: system.firstMeasure,
  barlines: system.barlines,
}));
const reach = { above: 64, below: 24 };

test("a dragged handle snaps to the nearest barline of the system the pointer is level with", () => {
  const region: LoopRegion = { startMeasure: 1, endMeasure: 2 };
  // Along the line: the end handle jumps barline to barline.
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 700, 210, 8, reach), { startMeasure: 1, endMeasure: 3 });
  // Down one line: every remaining bar of the first line, then the next line up to the pointer.
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 320, 590, 8, reach), { startMeasure: 1, endMeasure: 4 });
  // Down two lines, onto the next page.
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 790, 1010, 8, reach), { startMeasure: 1, endMeasure: 8 });
  // The start handle dragged down stays a measure before the end.
  assert.deepEqual(draggedLoopRegion(region, "start", screen, 800, 600, 8, reach), { startMeasure: 1, endMeasure: 2 });
  assert.deepEqual(
    draggedLoopRegion({ startMeasure: 1, endMeasure: 7 }, "start", screen, 790, 600, 8, reach),
    { startMeasure: 6, endMeasure: 7 },
  );
  // The end handle dragged left of the start stops one measure after it.
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 40, 210, 8, reach), { startMeasure: 1, endMeasure: 2 });
  // An unchanged region is the same object, so nothing re-renders.
  assert.equal(draggedLoopRegion(region, "start", screen, 290, 200, 8, reach), region);
});

test("a dragged handle leaves its system only once the pointer is past the whole handle", () => {
  // The end handle on the second system, whose handle spans 436 to 724.
  const region: LoopRegion = { startMeasure: 1, endMeasure: 4 };
  // Over the grip above the staff, nearer the first system's centre than its own, it stays.
  assert.equal(draggedLoopRegion(region, "end", screen, 320, 440, 8, reach), region);
  assert.equal(draggedLoopRegion(region, "end", screen, 320, 390, 8, reach), region);
  // Past the middle of the gap between the two handles' spans, it moves up.
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 320, 370, 8, reach), { startMeasure: 1, endMeasure: 2 });
  // Below its foot, the same: it moves down past the middle of the gap.
  assert.equal(draggedLoopRegion(region, "end", screen, 320, 770, 8, reach), region);
  assert.deepEqual(draggedLoopRegion(region, "end", screen, 790, 790, 8, reach), { startMeasure: 1, endMeasure: 8 });
});

test("arrow keys move a focused handle one barline, never past the other handle or the score", () => {
  const region = { startMeasure: 2, endMeasure: 3 };
  assert.deepEqual(moveLoopHandleTo(region, "start", 1, 8), { startMeasure: 1, endMeasure: 3 });
  assert.equal(moveLoopHandleTo(region, "start", 3, 8), region);
  assert.equal(moveLoopHandleTo(region, "end", 2, 8), region);
  assert.deepEqual(moveLoopHandleTo(region, "end", 4, 8), { startMeasure: 2, endMeasure: 4 });
  assert.deepEqual(moveLoopHandleTo({ startMeasure: 0, endMeasure: 8 }, "end", 9, 8), { startMeasure: 0, endMeasure: 8 });
  assert.deepEqual(moveLoopHandleTo({ startMeasure: 0, endMeasure: 8 }, "start", -1, 8), { startMeasure: 0, endMeasure: 8 });
});

function moment(id: string, measureIndex: number): PlaybackMoment {
  return {
    id,
    pageIndex: 0,
    staffGroupIndex: 0,
    measure: measureIndex + 1,
    measureIndex,
    barKey: `page-0-measure-${measureIndex + 1}`,
    visualGroupIds: [id],
    pitches: ["C4"],
    dynamic: "mp",
    keyboardNotes: [{ pitch: "C4" }],
    center: [0, 0],
  };
}

const timeline = [moment("a", 0), moment("b", 1), moment("c", 1), moment("d", 2), moment("e", 3)];
const loop: LoopRegion = { startMeasure: 1, endMeasure: 3 };
const at = (id: string): PlaybackState => ({ ...initialPlaybackState, active: true, currentMomentId: id });

function step(state: PlaybackState, command: Parameters<typeof runPlaybackCommand>[2]) {
  return loopNoteByNoteState(timeline, state, runPlaybackCommand(timeline, state, command), command, loop);
}

test("note-by-note wraps from the loop's last note to its first, starting the next pass", () => {
  assert.deepEqual(step(at("c"), "forwardNote"), { state: at("d"), nextPass: false });
  assert.deepEqual(step(at("d"), "forwardNote"), { state: at("b"), nextPass: true });
  assert.deepEqual(step(at("d"), "forwardBar"), { state: at("b"), nextPass: true });
  assert.deepEqual(step(at("d"), "forwardPage"), { state: at("b"), nextPass: true });
});

test("note-by-note never leaves the loop backwards, and starts inside it", () => {
  assert.deepEqual(step(at("b"), "backwardNote"), { state: at("b"), nextPass: false });
  assert.deepEqual(step(at("d"), "backwardBar"), { state: at("b"), nextPass: false });
  const started = loopNoteByNoteState(timeline, initialPlaybackState, at("a"), "togglePlayback", loop);
  assert.deepEqual(started, { state: at("b"), nextPass: false });
  // A seek outside the loop lands on its start, without counting a pass.
  assert.deepEqual(loopNoteByNoteState(timeline, at("c"), at("e"), null, loop), { state: at("b"), nextPass: false });
});

test("rewind returns note-by-note to the first moment, or the loop's first while looping", () => {
  assert.deepEqual(runPlaybackCommand(timeline, at("d"), "rewind"), at("a"));
  assert.deepEqual(step(at("d"), "rewind"), { state: at("b"), nextPass: false });
  assert.equal(runPlaybackCommand(timeline, initialPlaybackState, "rewind"), initialPlaybackState);
});

test("without a loop, or once stopped, note-by-note moves as before", () => {
  const next = runPlaybackCommand(timeline, at("d"), "forwardNote");
  assert.equal(loopNoteByNoteState(timeline, at("d"), next, "forwardNote", null).state, next);
  const stopped = runPlaybackCommand(timeline, at("c"), "stopPlayback");
  assert.equal(loopNoteByNoteState(timeline, at("c"), stopped, "stopPlayback", loop).state, stopped);
  // A loop with no notes of the timeline in it does not hold playback anywhere.
  const empty = { startMeasure: 7, endMeasure: 8 };
  assert.equal(loopNoteByNoteState(timeline, at("d"), next, "forwardNote", empty).state, next);
});

function score(measures: string): string {
  return `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">${measures}</part>
    </score-partwise>`;
}

function quarters(prefix: string, steps: string[]): string {
  return steps
    .map((step, index) => `<note id="${prefix}${index}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>`)
    .join("");
}

/** Four 2/4 measures at 60 BPM: each measure lasts two seconds. */
const parsed = parseRealtimeMusicXml(score(`
  <measure number="1"><attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
    <direction><sound tempo="60"/></direction>${quarters("a", ["C", "D"])}</measure>
  <measure number="2">${quarters("b", ["E", "F"])}</measure>
  <measure number="3">${quarters("c", ["G", "A"])}</measure>
  <measure number="4">${quarters("d", ["B", "C"])}</measure>
`));

test("a loop's route plays from its start up to its end barline, once", () => {
  const route = expandPerformanceRoute(parsed, { startMeasureIndex: 1, endMeasureIndex: 3 });
  assert.deepEqual(route.occurrences.map((occurrence) => occurrence.measureNumber), ["2", "3"]);
  assert.deepEqual(route.notes.map((note) => note.pitch), ["E4", "F4", "G4", "A4"]);
  assert.equal(route.totalQuarters, 4);
  // Positions in the loop map into its route; positions outside it do not.
  assert.equal(loopRouteOffset(route, { measureIndex: 2, onset: 1 }), 3);
  assert.equal(loopRouteOffset(route, { measureIndex: 3, onset: 0 }), null);
  assert.deepEqual(routeStructuralPosition(route, 3), { measureIndex: 2, onset: 1 });
  assert.deepEqual(routeStructuralPosition(route, -1.5), { measureIndex: 1, onset: 0 }, "a lead-in is at the start");
});

test("a loop's route follows repeats inside it, and stops where navigation leaves it", () => {
  const repeated = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes>
      <barline location="left"><repeat direction="forward"/></barline>${quarters("a", ["C"])}</measure>
    <measure number="2">${quarters("b", ["D"])}<barline location="right"><repeat direction="backward"/></barline></measure>
    <measure number="3">${quarters("c", ["E"])}</measure>
  `));
  // A repeat that begins before the loop repeats from the loop's start, so it stays in the loop.
  const route = expandPerformanceRoute(repeated, { startMeasureIndex: 1, endMeasureIndex: 3 });
  assert.deepEqual(route.occurrences.map((occurrence) => occurrence.measureNumber), ["2", "2", "3"]);
  const endings = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes>
      <barline location="left"><repeat direction="forward"/></barline>${quarters("a", ["C"])}</measure>
    <measure number="2">${quarters("b", ["D"])}</measure>
    <measure number="3"><barline location="left"><ending number="1" type="start"/></barline>${quarters("c", ["E"])}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
    <measure number="4"><barline location="left"><ending number="2" type="start"/></barline>${quarters("d", ["F"])}</measure>
  `));
  // A loop ending on the first ending plays its bars once; the loop itself repeats them.
  assert.deepEqual(
    expandPerformanceRoute(endings, { startMeasureIndex: 1, endMeasureIndex: 3 }).occurrences
      .map((occurrence) => occurrence.measureNumber),
    ["2", "3"],
  );
  // One that goes on into the second ending takes the repeat to reach it.
  assert.deepEqual(
    expandPerformanceRoute(endings, { startMeasureIndex: 1, endMeasureIndex: 4 }).occurrences
      .map((occurrence) => occurrence.measureNumber),
    ["2", "3", "2", "4"],
  );
  const dacapo = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes>${quarters("a", ["C"])}</measure>
    <measure number="2">${quarters("b", ["D"])}<sound dacapo="yes"/></measure>
    <measure number="3">${quarters("c", ["E"])}</measure>
  `));
  // The D.C. jumps back before the loop, so the loop's route ends where it is taken.
  const jumped = expandPerformanceRoute(dacapo, { startMeasureIndex: 1, endMeasureIndex: 3 });
  assert.deepEqual(jumped.occurrences.map((occurrence) => occurrence.measureNumber), ["2"]);
});

test("a looping controller starts its route over at the end, without losing time", () => {
  const route = expandPerformanceRoute(parsed, { startMeasureIndex: 1, endMeasureIndex: 3 });
  let now = 0;
  let tick: (() => void) | null = null;
  const attacks: string[][] = [];
  let loops = 0;
  let completed = false;
  const offsets: number[] = [];
  const controller = new RealtimeController(
    { attack: (pitches) => attacks.push([...pitches]), release: () => undefined, stop: () => undefined },
    {
      onFrame: (frame) => offsets.push(frame.offset),
      onComplete: () => { completed = true; },
      onLoop: () => { loops += 1; },
    },
    {
      now: () => now,
      setInterval: (callback) => { tick = callback; return 1; },
      clearInterval: () => { tick = null; },
    },
  );
  controller.setLooping(true);
  // Starting inside the loop, on measure 3's second beat.
  controller.play(route, 3);
  assert.deepEqual(attacks, [["A4"]]);
  now = 1.25;
  (tick as (() => void) | null)?.();
  assert.equal(loops, 1);
  assert.equal(completed, false);
  assert.ok(Math.abs(offsets.at(-1)! - 0.25) < 1e-9, "the quarter second past the end carries into the next pass");
  assert.deepEqual(attacks, [["A4"], ["E4"]]);
  now = 5.5;
  (tick as (() => void) | null)?.();
  assert.equal(loops, 2);
  assert.ok(Math.abs(offsets.at(-1)! - 0.5) < 1e-9);

  controller.setLooping(false);
  now = 9.5;
  (tick as (() => void) | null)?.();
  assert.equal(completed, true);
});

test("a loop's playhead runs on to the loop's end barline after its last note, not to the end of the line", () => {
  // Measures 2 and 3 stand on page 0's first system, between barlines 300, 550 and 800.
  const xs: Record<string, number> = { b0: 350, b1: 450, c0: 600, c1: 700 };
  const visualMap = new Map(Object.entries(xs).map(([id, x]): [string, VisualNoteTarget] => [id, {
    musicXmlId: id,
    pageIndex: 0,
    visualGroupId: id,
    staffGroupIndex: 0,
    x,
    y: 200,
    systemRight: 1000,
    systemTop: 100,
    systemBottom: 300,
  }]));
  const route = expandPerformanceRoute(parsed, { startMeasureIndex: 1, endMeasureIndex: 3, visualMap });
  const end = routeEndBarline(systems, route);
  assert.deepEqual(end, { pageIndex: 0, staffGroupIndex: 0, x: 800 });
  // Halfway through the last note: halfway from it to the end barline.
  assert.equal(realtimePlayheadAt(route, 3.5, [], end)?.x, 750);
  // Without it, the playhead would head for the end of the line.
  assert.equal(realtimePlayheadAt(route, 3.5, [])?.x, 850);
  // Between notes it still follows the notes.
  assert.equal(realtimePlayheadAt(route, 1.5, [], end)?.x, 525);
  // A one-measure loop ends on the barline inside the system.
  const short = expandPerformanceRoute(parsed, { startMeasureIndex: 1, endMeasureIndex: 2, visualMap });
  assert.equal(realtimePlayheadAt(short, 1.5, [], routeEndBarline(systems, short))?.x, 500);

  // Through a two-quarter count-in the playhead moves from the barline before the first
  // note to the note, arriving as it plays.
  const start = routeStartBarline(systems, route);
  assert.deepEqual(start, { pageIndex: 0, staffGroupIndex: 0, x: 300 });
  assert.equal(realtimePlayheadAt(route, -2, [], end, start, -2)?.x, 300, "waiting on the barline");
  assert.equal(realtimePlayheadAt(route, -1, [], end, start, -2)?.x, 325);
  assert.equal(realtimePlayheadAt(route, 0, [], end, start, -2)?.x, 350);
  assert.equal(realtimePlayheadAt(route, 0.5, [], end, start, -2)?.x, 400, "then it follows the notes");
  const fromNote = expandPerformanceRoute(parsed, { startMeasureIndex: 1, startOffset: 1, visualMap });
  assert.equal(routeStartBarline(systems, fromNote), null, "a route begun inside a measure has none");
});

test("loop shortcuts move one end a barline, keeping a bar between the ends and inside the score", () => {
  const region = { startMeasure: 2, endMeasure: 4 };
  assert.deepEqual(loopRegionAfterCommand(region, "loopEndLater", 8), { startMeasure: 2, endMeasure: 5 });
  assert.deepEqual(loopRegionAfterCommand(region, "loopEndEarlier", 8), { startMeasure: 2, endMeasure: 3 });
  assert.deepEqual(loopRegionAfterCommand(region, "loopStartEarlier", 8), { startMeasure: 1, endMeasure: 4 });
  assert.deepEqual(loopRegionAfterCommand(region, "loopStartLater", 8), { startMeasure: 3, endMeasure: 4 });
  // A one-bar loop cannot shrink, and the ends stop at the score's first and last barlines.
  const bar = { startMeasure: 0, endMeasure: 1 };
  assert.equal(loopRegionAfterCommand(bar, "loopEndEarlier", 8), bar);
  assert.equal(loopRegionAfterCommand(bar, "loopStartLater", 8), bar);
  assert.equal(loopRegionAfterCommand(bar, "loopStartEarlier", 8), bar);
  const last = { startMeasure: 7, endMeasure: 8 };
  assert.equal(loopRegionAfterCommand(last, "loopEndLater", 8), last);
});
