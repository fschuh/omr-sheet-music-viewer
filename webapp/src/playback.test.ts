import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackTimeline,
  effectivePlaybackNoteSounds,
  initialPlaybackState,
  playbackPitchForNote,
  playbackGroupIdsForPage,
  playbackGroupIdsByPageForAnchors,
  runPlaybackCommand,
  seekPlaybackToGroup,
  type PlaybackCommand,
  type PlaybackState,
} from "./playback";
import { parseRealtimeMusicXml } from "./realtime";
import type { DocumentPage, VisualGroup, VisualSidecar, VisualSidecarNote } from "./types";

function group(id: string, staffIndex: number, staveIndex: number, x: number, y: number): VisualGroup {
  return {
    visual_group_id: id,
    staff_index: staffIndex,
    stave_index: staveIndex,
    staff_position: 0,
    center: [x, y],
    bbox: [x - 10, y - 8, x + 10, y + 8],
    notehead_ellipses: [{ center: [x, y], rx: 10, ry: 8, angle: 0 }],
    notehead_contours: [],
    stem_contours: [],
    musicxml_ids: [`note-${id}`],
    visual_status: "fallback",
    provenance: "segmentation",
    moment_id: null,
    chord_id: null,
    repair_actions: [],
  };
}

function page(index: number, groups: VisualGroup[], measures: number[]): DocumentPage {
  const sidecar: VisualSidecar = {
    version: 2,
    source_image_size: [1000, 1400],
    visual_groups: groups,
    notes: groups.map((value, groupIndex) => ({
      musicxml_id: `note-${value.visual_group_id}`,
      part: 1,
      measure: measures[groupIndex],
      staff: value.stave_index + 1,
      voice: 1,
      pitch: "C4",
      duration: "note_4",
      match_confidence: 1,
      visual_group_id: value.visual_group_id,
      alignment_method: "attention",
    })),
    unmatched_musicxml_notes: [],
    unmatched_visual_notes: [],
  };
  return { index, status: "complete", width: 1000, height: 1400, visualSidecar: sidecar };
}

function activeAtFirst(pages: DocumentPage[]): { timeline: ReturnType<typeof buildPlaybackTimeline>; state: PlaybackState } {
  const timeline = buildPlaybackTimeline(pages);
  return { timeline, state: runPlaybackCommand(timeline, initialPlaybackState, "togglePlayback") };
}

function run(
  timeline: ReturnType<typeof buildPlaybackTimeline>,
  state: PlaybackState,
  command: PlaybackCommand,
): PlaybackState {
  return runPlaybackCommand(timeline, state, command);
}

test("prefers the resolved MusicXML accidental over a natural-only sidecar pitch", () => {
  const note: VisualSidecarNote = {
    musicxml_id: "note-flat",
    part: 1,
    measure: 1,
    staff: 1,
    voice: 1,
    pitch: "A3",
    duration: "note_4",
    match_confidence: 1,
    visual_group_id: "flat",
    alignment_method: "attention",
  };

  assert.equal(playbackPitchForNote(note, new Map([["note-flat", "A♭3"]])), "A♭3");
});

test("groups a chord and aligned notes in different clefs into one playhead moment", () => {
  const upper = group("upper", 0, 0, 200, 250);
  const chord = group("chord", 0, 0, 212, 270);
  chord.stem_component_ids = ["stem-1"];
  upper.stem_component_ids = ["stem-1"];
  const lower = group("lower", 0, 1, 204, 420);
  const timeline = buildPlaybackTimeline([page(0, [upper, chord, lower], [1, 1, 1])]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["chord", "lower", "upper"]);
  assert.deepEqual(timeline[0].pitches, ["C4"]);
});

test("groups a displaced chord second before aligning notes across clefs", () => {
  const lowerOffset = group("lower-offset", 0, 1, 2313.59, 592);
  const upperLow = group("upper-low", 0, 0, 2338.16, 395);
  const upperHigh = group("upper-high", 0, 0, 2338.83, 330);
  const lowerMiddle = group("lower-middle", 0, 1, 2338.83, 587);
  const lowerLow = group("lower-low", 0, 1, 2339.16, 614);
  lowerOffset.stem_component_ids = ["lower-stem"];
  lowerMiddle.stem_component_ids = ["lower-stem"];
  lowerLow.stem_component_ids = ["lower-stem"];
  upperLow.stem_component_ids = ["upper-stem"];
  upperHigh.stem_component_ids = ["upper-stem"];

  const scorePage = page(
    0,
    [lowerOffset, upperLow, upperHigh, lowerMiddle, lowerLow],
    [4, 4, 4, 4, 4],
  );
  const pitches = ["Cb4", "Bb4", "Bb5", "Db4", "Ab3"];
  scorePage.visualSidecar?.notes.forEach((note, index) => {
    note.pitch = pitches[index];
  });
  const timeline = buildPlaybackTimeline([scorePage]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, [
    "lower-low",
    "lower-middle",
    "lower-offset",
    "upper-high",
    "upper-low",
  ]);
  assert.deepEqual([...timeline[0].pitches].sort(), [...pitches].sort());
  assert.deepEqual(
    timeline[0].keyboardNotes.map((note) => note.pitch).sort(),
    [...pitches].sort(),
  );
});

test("recovers unmatched cross-clef pitches from the anchored MusicXML event", () => {
  const upperHigh = group("upper-high", 0, 0, 477.7, 1111);
  const upperLow = group("upper-low", 0, 0, 477.5, 1176);
  const lowerHigh = group("lower-high", 0, 1, 477.1, 1298);
  const lowerLow = group("lower-low", 0, 1, 477.5, 1344);
  upperHigh.stem_component_ids = ["upper-stem"];
  upperLow.stem_component_ids = ["upper-stem"];
  lowerHigh.stem_component_ids = ["lower-stem"];
  lowerLow.stem_component_ids = ["lower-stem"];
  lowerHigh.musicxml_ids = [];
  lowerLow.musicxml_ids = [];

  const scorePage = page(
    0,
    [upperHigh, upperLow, lowerHigh, lowerLow],
    [5, 5, 5, 5],
  );
  const sidecar = scorePage.visualSidecar!;
  sidecar.notes[0].pitch = "Cb6";
  sidecar.notes[1].pitch = "Cb5";
  sidecar.notes[2].pitch = "Gb4";
  sidecar.notes[2].staff = 2;
  sidecar.notes[2].voice = 5;
  sidecar.notes[2].visual_group_id = null;
  sidecar.notes[3].pitch = "Bb3";
  sidecar.notes[3].staff = 2;
  sidecar.notes[3].voice = 5;
  sidecar.notes[3].visual_group_id = null;
  sidecar.unmatched_musicxml_notes = ["note-lower-high", "note-lower-low"];
  sidecar.unmatched_visual_notes = ["lower-high", "lower-low"];
  scorePage.musicXml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="5">
          <attributes><divisions>4</divisions></attributes>
          <note id="note-upper-high">
            <pitch><step>C</step><alter>-1</alter><octave>6</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <note id="note-upper-low">
            <chord/><pitch><step>C</step><alter>-1</alter><octave>5</octave></pitch>
            <duration>1</duration><voice>1</voice><staff>1</staff>
          </note>
          <backup><duration>1</duration></backup>
          <note id="note-lower-high">
            <pitch><step>G</step><alter>-1</alter><octave>4</octave></pitch>
            <duration>2</duration><voice>5</voice><staff>2</staff>
          </note>
          <note id="note-lower-low">
            <chord/><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch>
            <duration>2</duration><voice>5</voice><staff>2</staff>
          </note>
        </measure>
      </part>
    </score-partwise>`;

  const timeline = buildPlaybackTimeline([scorePage]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].pitches, ["C♭6", "C♭5", "G♭4", "B♭3"]);
  assert.deepEqual(
    timeline[0].keyboardNotes.map((note) => note.pitch),
    ["C♭6", "C♭5", "G♭4", "B♭3"],
  );
  assert.deepEqual(
    playbackGroupIdsByPageForAnchors(timeline, [
      { pageIndex: 0, visualGroupId: "upper-high" },
      { pageIndex: 0, visualGroupId: "upper-low" },
    ]),
    {
      0: ["upper-high", "upper-low"],
    },
  );
});

test("note-by-note playback ignores grace notes sharing the main note's onset", () => {
  const grace = group("grace", 0, 0, 200, 250);
  const main = group("main", 0, 0, 200, 250);
  const scorePage = page(0, [grace, main], [1, 1]);
  const sidecar = scorePage.visualSidecar!;
  sidecar.notes[0].pitch = "D5";
  sidecar.notes[0].duration = "note_8G";
  sidecar.notes[1].pitch = "C5";
  scorePage.musicXml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1">
          <attributes><divisions>4</divisions></attributes>
          <note id="note-grace">
            <grace/><pitch><step>D</step><octave>5</octave></pitch>
            <voice>1</voice><staff>1</staff>
          </note>
          <note id="note-main">
            <pitch><step>C</step><octave>5</octave></pitch>
            <duration>4</duration><voice>1</voice><staff>1</staff>
          </note>
        </measure>
      </part>
    </score-partwise>`;

  const timeline = buildPlaybackTimeline([scorePage]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["main"]);
  assert.deepEqual(timeline[0].pitches, ["C5"]);
  assert.deepEqual(timeline[0].keyboardNotes, [{ pitch: "C5" }]);
});

test("note-by-note playback skips inferred cross-voice chord tie continuations", () => {
  const startC6 = group("start-c6", 0, 0, 100, 230);
  const startC5 = group("start-c5", 0, 0, 100, 270);
  const stopC6 = group("stop-c6", 0, 0, 200, 230);
  const stopC5 = group("stop-c5", 0, 0, 200, 270);
  const scorePage = page(0, [startC6, startC5, stopC6, stopC5], [1, 1, 1, 1]);
  const sidecar = scorePage.visualSidecar!;
  [startC6, startC5].forEach((candidate) => {
    candidate.visual_status = "canonical";
    candidate.moment_id = "moment-1";
  });
  [stopC6, stopC5].forEach((candidate) => {
    candidate.visual_status = "canonical";
    candidate.moment_id = "moment-2";
  });
  ["C6", "C5", "C6", "C5"].forEach((pitch, index) => {
    sidecar.notes[index].pitch = pitch;
  });
  scorePage.musicXml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>4</divisions></attributes>
        <note id="note-start-c6"><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff><notations><slur type="start" number="1"/></notations></note>
        <note id="note-start-c5"><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff></note>
        <note id="note-stop-c6"><pitch><step>C</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><notations><slur type="stop" number="1"/></notations></note>
        <note id="note-stop-c5"><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      </measure></part>
    </score-partwise>`;

  const timeline = buildPlaybackTimeline([scorePage]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["start-c5", "start-c6"]);
  assert.deepEqual(timeline[0].pitches, ["C6", "C5"]);
});

test("note-by-note playback retains a tied tone beside a fresh chord attack", () => {
  const startG = group("start-g", 0, 0, 100, 230);
  const startCSharp = group("start-c-sharp", 0, 0, 100, 270);
  const stopG = group("stop-g", 0, 0, 200, 230);
  const stopD = group("stop-d", 0, 0, 200, 270);
  const scorePage = page(0, [startG, startCSharp, stopG, stopD], [1, 1, 1, 1]);
  const sidecar = scorePage.visualSidecar!;
  [startG, startCSharp].forEach((candidate) => {
    candidate.visual_status = "canonical";
    candidate.moment_id = "moment-1";
  });
  [stopG, stopD].forEach((candidate) => {
    candidate.visual_status = "canonical";
    candidate.moment_id = "moment-2";
  });
  ["G5", "C#5", "G5", "D5"].forEach((pitch, index) => {
    sidecar.notes[index].pitch = pitch;
  });
  scorePage.musicXml = `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>4</divisions></attributes>
        <note id="note-start-g"><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><notations><slur type="start" number="1"/></notations></note>
        <note id="note-start-c-sharp"><chord/><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
        <note id="note-stop-g"><pitch><step>G</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><notations><slur type="stop" number="1"/></notations></note>
        <note id="note-stop-d"><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      </measure></part>
    </score-partwise>`;

  const timeline = buildPlaybackTimeline([scorePage]);

  assert.equal(timeline.length, 2);
  assert.deepEqual(timeline[1].visualGroupIds, ["stop-d", "stop-g"]);
  assert.deepEqual(timeline[1].pitches, ["G5", "D5"]);
  assert.deepEqual(timeline[1].keyboardNotes, [{ pitch: "G5" }, { pitch: "D5" }]);
});

test("note-by-note playback reuses document tie inference across pages", () => {
  const firstPage = page(0, [group("start", 0, 0, 100, 250)], [1]);
  const secondPage = page(1, [group("stop", 0, 0, 100, 250)], [1]);
  const documentScore = parseRealtimeMusicXml(`<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">
        <measure number="1">
          <attributes><divisions>4</divisions></attributes>
          <note id="page-1-note-start"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><notations><slur type="start" number="1"/></notations></note>
        </measure>
        <measure number="2">
          <note id="page-2-note-stop"><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><notations><slur type="stop" number="1"/></notations></note>
        </measure>
      </part>
    </score-partwise>`);

  const timeline = buildPlaybackTimeline([firstPage, secondPage], {}, documentScore);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].pageIndex, 0);
  assert.deepEqual(timeline[0].visualGroupIds, ["start"]);
});

test("keeps vertically aligned notes on different systems as separate moments", () => {
  const timeline = buildPlaybackTimeline([
    page(0, [group("system-1", 0, 0, 200, 250), group("system-2", 1, 0, 200, 750)], [1, 3]),
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].visualGroupIds[0], "system-1");
  assert.equal(timeline[1].visualGroupIds[0], "system-2");
});

test("canonical playback groups cross-staff notes by moment_id", () => {
  const upper = group("upper", 0, 0, 100, 250);
  const lower = group("lower", 0, 1, 220, 430);
  const following = group("following", 0, 0, 320, 250);
  for (const candidate of [upper, lower, following]) {
    candidate.visual_status = "canonical";
  }
  upper.moment_id = "moment-1";
  lower.moment_id = "moment-1";
  following.moment_id = "moment-2";

  const timeline = buildPlaybackTimeline([
    page(0, [upper, lower, following], [1, 1, 1]),
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].id, "page-0-moment-1");
  assert.deepEqual(timeline[0].visualGroupIds, ["lower", "upper"]);
  assert.deepEqual(timeline[1].visualGroupIds, ["following"]);
});

test("fallback playback keeps consecutive beamed moment_ids separate", () => {
  const upper = group("upper", 0, 0, 500, 250);
  const lowerFirst = group("lower-first", 0, 1, 510, 430);
  const lowerSecond = group("lower-second", 0, 1, 544, 415);
  upper.moment_id = "moment-1";
  lowerFirst.moment_id = "moment-1";
  lowerSecond.moment_id = "moment-2";
  lowerFirst.stem_component_ids = ["connected-beam"];
  lowerSecond.stem_component_ids = ["connected-beam"];

  const timeline = buildPlaybackTimeline([
    page(0, [upper, lowerFirst, lowerSecond], [16, 16, 16]),
  ]);

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].id, "page-0-moment-1");
  assert.deepEqual(timeline[0].visualGroupIds, ["lower-first", "upper"]);
  assert.equal(timeline[1].id, "page-0-moment-2");
  assert.deepEqual(timeline[1].visualGroupIds, ["lower-second"]);
});

test("incomplete canonical staff metadata retains legacy clustering", () => {
  const canonical = group("canonical", 0, 0, 200, 250);
  canonical.visual_status = "canonical";
  canonical.moment_id = "moment-1";
  const fallback = group("fallback", 0, 1, 204, 430);

  const timeline = buildPlaybackTimeline([
    page(0, [canonical, fallback], [1, 1]),
  ]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["canonical", "fallback"]);
  assert.notEqual(timeline[0].id, "page-0-moment-1");
});

test("diagnostic and unlinked groups are absent from playback", () => {
  const linked = group("linked", 0, 0, 200, 250);
  const diagnostic = group("diagnostic", 0, 0, 202, 280);
  diagnostic.visual_status = "diagnostic";
  const unlinked = group("unlinked", 0, 0, 204, 310);
  unlinked.musicxml_ids = [];

  const timeline = buildPlaybackTimeline([
    page(0, [linked, diagnostic, unlinked], [1, 1, 1]),
  ]);

  assert.equal(timeline.length, 1);
  assert.deepEqual(timeline[0].visualGroupIds, ["linked"]);
});

test("attaches page-scoped predicted fingerings to keyboard notes after skipped pages", () => {
  const recognized = page(1, [group("right", 0, 0, 200, 250)], [1]);
  const timeline = buildPlaybackTimeline(
    [
      { index: 0, status: "skipped", width: 1000, height: 1400 },
      recognized,
    ],
    { "page-1-note-right": { finger: 2, left: false } },
  );

  assert.deepEqual(timeline[0].keyboardNotes, [
    { pitch: "C4", finger: 2, left: false },
  ]);
});

test("moves by notes and clamps at the first and last moments", () => {
  const { timeline, state: first } = activeAtFirst([
    page(0, [group("a", 0, 0, 100, 200), group("b", 0, 0, 200, 200)], [1, 1]),
  ]);
  const beforeFirst = run(timeline, first, "backwardNote");
  const second = run(timeline, first, "forwardNote");
  const afterLast = run(timeline, second, "forwardNote");

  assert.equal(beforeFirst.currentMomentId, timeline[0].id);
  assert.equal(second.currentMomentId, timeline[1].id);
  assert.equal(afterLast.currentMomentId, timeline[1].id);
});

test("seeks playback to a mouse-selected group and continues navigation there", () => {
  const upperFirst = group("upper-first", 0, 0, 100, 200);
  const lowerFirst = group("lower-first", 0, 1, 102, 400);
  const upperSecond = group("upper-second", 0, 0, 200, 200);
  const lowerSecond = group("lower-second", 0, 1, 202, 400);
  const { timeline, state: first } = activeAtFirst([
    page(0, [upperFirst, lowerFirst, upperSecond, lowerSecond], [1, 1, 1, 1]),
  ]);

  const selected = seekPlaybackToGroup(timeline, first, {
    pageIndex: 0,
    visualGroupId: "lower-second",
  });
  const previous = run(timeline, selected, "backwardNote");

  assert.equal(selected.currentMomentId, timeline[1].id);
  assert.deepEqual(timeline[1].visualGroupIds, ["lower-second", "upper-second"]);
  assert.equal(previous.currentMomentId, timeline[0].id);
});

test("starts playback at a group selected before entering playback mode", () => {
  const timeline = buildPlaybackTimeline([
    page(
      0,
      [group("first", 0, 0, 100, 200), group("selected", 0, 0, 200, 200)],
      [1, 1],
    ),
  ]);

  const active = runPlaybackCommand(timeline, initialPlaybackState, "togglePlayback", {
    pageIndex: 0,
    visualGroupId: "selected",
  });

  assert.equal(active.active, true);
  assert.equal(active.currentMomentId, timeline[1].id);
});

test("ignores mouse selection outside playback or when the group has no timeline moment", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const active = run(timeline, initialPlaybackState, "togglePlayback");

  assert.equal(
    seekPlaybackToGroup(timeline, initialPlaybackState, { pageIndex: 0, visualGroupId: "a" }),
    initialPlaybackState,
  );
  assert.equal(
    seekPlaybackToGroup(timeline, active, { pageIndex: 0, visualGroupId: "missing" }),
    active,
  );
  assert.equal(seekPlaybackToGroup(timeline, active, null), active);
});

test("moves to the first moment of the next and previous bars", () => {
  const { timeline, state: first } = activeAtFirst([
    page(
      0,
      [group("a", 0, 0, 100, 200), group("b", 0, 0, 200, 200), group("c", 0, 0, 300, 200)],
      [1, 1, 2],
    ),
  ]);
  const second = run(timeline, first, "forwardNote");
  const nextBar = run(timeline, second, "forwardBar");
  const previousBar = run(timeline, nextBar, "backwardBar");

  assert.equal(nextBar.currentMomentId, timeline[2].id);
  assert.equal(previousBar.currentMomentId, timeline[0].id);
});

test("page commands target page beginnings and the document edges", () => {
  const pages = [
    page(0, [group("p1a", 0, 0, 100, 200), group("p1b", 0, 0, 200, 200)], [1, 1]),
    page(1, [group("p2a", 0, 0, 100, 200), group("p2b", 0, 0, 200, 200)], [2, 2]),
  ];
  const { timeline, state: first } = activeAtFirst(pages);
  const pageTwo = run(timeline, first, "forwardPage");
  const pageOne = run(timeline, pageTwo, "backwardPage");
  const last = run(timeline, pageTwo, "forwardPage");
  const firstAgain = run(timeline, pageOne, "backwardPage");

  assert.equal(pageTwo.currentMomentId, timeline[2].id);
  assert.equal(pageOne.currentMomentId, timeline[0].id);
  assert.equal(last.currentMomentId, timeline[3].id);
  assert.equal(firstAgain.currentMomentId, timeline[0].id);
});

test("navigation is inactive outside playback mode and toggle exits cleanly", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  assert.equal(run(timeline, initialPlaybackState, "forwardNote"), initialPlaybackState);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  assert.deepEqual(run(timeline, active, "togglePlayback"), initialPlaybackState);
});

test("note sounds toggle only in playback mode and survive leaving playback", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  assert.equal(run(timeline, initialPlaybackState, "toggleNoteSounds"), initialPlaybackState);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  const muted = run(timeline, active, "toggleNoteSounds");
  assert.equal(muted.noteSoundsEnabled, false);
  const inactive = run(timeline, muted, "togglePlayback");
  assert.equal(inactive.active, false);
  assert.equal(inactive.noteSoundsEnabled, false);
  assert.equal(run(timeline, inactive, "togglePlayback").noteSoundsEnabled, false);
});

test("listen mode forces effective muting without changing the sound preference", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  assert.equal(effectivePlaybackNoteSounds(active), true);
  const listening = run(timeline, active, "toggleListenMode");
  assert.equal(listening.listenModeEnabled, true);
  assert.equal(listening.noteSoundsEnabled, true);
  assert.equal(effectivePlaybackNoteSounds(listening), false);

  const preferenceMuted = run(timeline, listening, "toggleNoteSounds");
  assert.equal(preferenceMuted.noteSoundsEnabled, false);
  const stoppedListening = run(timeline, preferenceMuted, "toggleListenMode");
  assert.equal(stoppedListening.noteSoundsEnabled, false);
  assert.equal(effectivePlaybackNoteSounds(stoppedListening), false);
});

test("audition is a state-free command and exiting playback disables listen mode", () => {
  const timeline = buildPlaybackTimeline([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const active = run(timeline, initialPlaybackState, "togglePlayback");
  assert.equal(run(timeline, active, "playCurrentNotes"), active);
  const listening = run(timeline, active, "toggleListenMode");
  const inactive = run(timeline, listening, "togglePlayback");
  assert.equal(inactive.active, false);
  assert.equal(inactive.listenModeEnabled, false);
});

test("reuses the empty page selection so memoized overlays stay memoized", () => {
  const { timeline } = activeAtFirst([page(0, [group("a", 0, 0, 100, 200)], [1])]);
  const firstEmptySelection = playbackGroupIdsForPage(timeline[0], 1);
  const secondEmptySelection = playbackGroupIdsForPage(timeline[0], 2);
  const inactiveSelection = playbackGroupIdsForPage(null, 0);

  assert.equal(firstEmptySelection, secondEmptySelection);
  assert.equal(secondEmptySelection, inactiveSelection);
  assert.equal(playbackGroupIdsForPage(timeline[0], 0), timeline[0].visualGroupIds);
});
