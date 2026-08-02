import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRealtimeVisualMap,
  expandPerformanceRoute,
  parseRealtimeMusicXml,
  RealtimeController,
  scoreOffsetAfterSeconds,
  scoreOffsetToSeconds,
  seekStructuralPosition,
  type PerformanceRoute,
  type RealtimeAudioSink,
  type RealtimeClock,
} from "./realtime";
import type { DocumentPage, VisualSidecar } from "./types";

function score(measures: string, extraPart = ""): string {
  return `<?xml version="1.0"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1">${measures}</part>${extraPart}
    </score-partwise>`;
}

function quarter(id: string, pitch = "C", octave = 4, extra = ""): string {
  return `<note id="${id}"><pitch><step>${pitch}</step><octave>${octave}</octave></pitch>${extra}<duration>4</duration><voice>1</voice><type>quarter</type></note>`;
}

test("parses polyphonic cursors, chords, pages, tempo, and ties from partwise MusicXML", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <print new-page="yes" page-number="1"/>
      <attributes><divisions>4</divisions></attributes>
      <direction><sound tempo="90"/></direction>
      ${quarter("page-1-c")}
      <note id="page-1-e"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
      <backup><duration>4</duration></backup>
      <note id="page-1-g"><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice></note>
    </measure>
    <measure number="2">
      <print new-page="yes" page-number="2"/>
      ${quarter("page-2-a", "A", 4, '<tie type="start"/>')}
    </measure>
    <measure number="3">
      ${quarter("page-2-a-tied", "A", 4, '<tie type="stop"/>')}
      <direction><offset>4</offset><sound tempo="120"/></direction>
    </measure>
  `));

  assert.equal(parsed.measures[0].duration, 2);
  assert.deepEqual(parsed.measures[0].notes.map((note) => [note.pitch, note.onset]), [
    ["C4", 0], ["E4", 0], ["G3", 0],
  ]);
  assert.deepEqual(parsed.measures[0].events[0].pitches, ["C4", "E4", "G3"]);
  assert.equal(parsed.measures[0].tempos[0].bpm, 90);
  assert.equal(parsed.measures[1].pageNumber, 2);

  const route = expandPerformanceRoute(parsed);
  const tied = route.notes.find((note) => note.musicXmlId === "page-2-a");
  assert.equal(tied?.release, 4);
  assert.equal(route.notes.some((note) => note.musicXmlId === "page-2-a-tied"), false);
  assert.deepEqual(route.tempoSegments.map((tempo) => tempo.bpm), [90, 120]);
});

test("sustains contiguous same-pitch slur endpoints as a realtime tie", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${quarter("slur-start", "C", 4, '<notations><slur type="start" number="1"/></notations>')}
    </measure>
    <measure number="2">
      ${quarter("slur-stop", "C", 4, '<notations><slur type="stop" number="1"/></notations>')}
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.equal(route.notes.length, 1);
  assert.equal(route.notes[0].musicXmlId, "slur-start");
  assert.equal(route.notes[0].release, 2);
});

test("sustains adjacent treble slur endpoints despite an interleaved bass voice", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      ${quarter("treble-start", "E", 5, '<notations><slur type="start" number="1"/></notations><staff>1</staff>')}
      ${quarter("interleaved-bass", "E", 2, '<voice>5</voice><staff>2</staff>')}
      ${quarter("treble-stop", "E", 5, '<notations><slur type="stop" number="1"/></notations><staff>1</staff>')}
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.equal(route.notes.some((note) => note.musicXmlId === "treble-stop"), false);
  assert.equal(route.notes.find((note) => note.musicXmlId === "treble-start")?.release, 3);
});

test("extends an inferred slur tie to every repeated chord tone", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${quarter("start-c", "C", 5, '<notations><slur type="start" number="1"/></notations>')}
      <note id="start-e"><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note id="start-g"><chord/><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
      ${quarter("stop-c", "C", 5, '<notations><slur type="stop" number="1"/></notations>')}
      <note id="stop-e"><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
      <note id="stop-g"><chord/><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.deepEqual(
    route.notes.map((note) => note.musicXmlId),
    ["start-c", "start-e", "start-g"],
  );
  assert.deepEqual(route.notes.map((note) => note.release), [2, 2, 2]);
});

test("sustains a matching slurred chord tone while attacking a changed tone", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${quarter("start-g", "G", 5, '<notations><slur type="start" number="1"/></notations>')}
      <note id="start-c-sharp"><chord/><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
      ${quarter("stop-g", "G", 5, '<notations><slur type="stop" number="1"/></notations>')}
      <note id="stop-d"><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.deepEqual(
    route.notes.map((note) => note.musicXmlId),
    ["start-c-sharp", "start-g", "stop-d"],
  );
  assert.equal(route.notes.find((note) => note.musicXmlId === "start-g")?.release, 2);
  assert.equal(route.notes.find((note) => note.musicXmlId === "start-c-sharp")?.release, 1);
  assert.equal(route.notes.find((note) => note.musicXmlId === "stop-d")?.onset, 1);
});

test("sustains a repeated chord when HOMR changes voice at the slur stop", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions><staves>2</staves></attributes>
      <note id="start-c6"><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff><notations><slur type="start" number="1"/></notations></note>
      <note id="start-c5"><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff></note>
      <backup><duration>1</duration></backup>
      <note id="bass"><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><staff>2</staff></note>
      <note id="stop-c6"><pitch><step>C</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><notations><slur type="stop" number="1"/></notations></note>
      <note id="stop-c5"><chord/><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.equal(route.notes.some((note) => note.musicXmlId === "stop-c6"), false);
  assert.equal(route.notes.some((note) => note.musicXmlId === "stop-c5"), false);
  assert.equal(route.notes.find((note) => note.musicXmlId === "start-c6")?.release, 0.75);
  assert.equal(route.notes.find((note) => note.musicXmlId === "start-c5")?.release, 0.75);
});

test("preserves genuine slurs with a different or intervening pitch", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${quarter("phrase-c-start", "C", 4, '<notations><slur type="start" number="1"/></notations>')}
      ${quarter("phrase-d", "D")}
      ${quarter("phrase-c-stop", "C", 4, '<notations><slur type="stop" number="1"/></notations>')}
      ${quarter("different-e", "E", 4, '<notations><slur type="start" number="1"/></notations>')}
      ${quarter("different-f", "F", 4, '<notations><slur type="stop" number="1"/></notations>')}
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);

  assert.deepEqual(
    route.notes.map((note) => note.musicXmlId),
    ["phrase-c-start", "phrase-d", "phrase-c-stop", "different-e", "different-f"],
  );
});

test("expands measured chord tremolos and unmeasured rolls into repeated attacks", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note id="c">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations>
      </note>
      <note id="e">
        <chord/><pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
      </note>
      <note id="g">
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><ornaments><tremolo type="unmeasured">0</tremolo></ornaments></notations>
      </note>
    </measure>
  `));

  assert.deepEqual(parsed.measures[0].notes[0].tremolo, {
    type: "single",
    marks: 2,
    beamCount: 0,
  });
  const route = expandPerformanceRoute(parsed);
  assert.deepEqual(
    route.notes.filter((note) => note.pitch === "C4").map((note) => note.onset),
    [0, 0.25, 0.5, 0.75],
  );
  assert.deepEqual(
    route.notes.filter((note) => note.pitch === "E4").map((note) => note.onset),
    [0, 0.25, 0.5, 0.75],
  );
  assert.deepEqual(
    route.notes.filter((note) => note.pitch === "G4").map((note) => note.onset),
    [1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875],
  );
  assert.equal(route.playheadNotes?.length, 3);
});

test("alternates double-note tremolos using marks and attached beams", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note id="low-a">
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>4</duration><voice>1</voice><type>half</type>
        <time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>
        <beam number="1">begin</beam>
        <notations><ornaments><tremolo type="start">2</tremolo></ornaments></notations>
      </note>
      <note id="high-a">
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>half</type>
        <time-modification><actual-notes>2</actual-notes><normal-notes>1</normal-notes></time-modification>
        <beam number="1">end</beam>
        <notations><ornaments><tremolo type="stop">2</tremolo></ornaments></notations>
      </note>
    </measure>
  `));

  const route = expandPerformanceRoute(parsed);
  assert.equal(parsed.measures[0].notes[0].tremolo?.beamCount, 1);
  assert.equal(route.notes.length, 16);
  assert.deepEqual(
    route.notes.slice(0, 6).map((note) => [note.pitch, note.onset, note.release]),
    [
      ["A3", 0, 0.125],
      ["A4", 0.125, 0.25],
      ["A3", 0.25, 0.375],
      ["A4", 0.375, 0.5],
      ["A3", 0.5, 0.625],
      ["A4", 0.625, 0.75],
    ],
  );
  assert.deepEqual(
    route.playheadNotes?.map((note) => [note.pitch, note.onset]),
    [["A3", 0], ["A4", 1]],
  );
});

test("plays bare trill marks with a diatonic upper auxiliary", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
      </attributes>
      <note id="trill-f">
        <pitch><step>F</step><octave>5</octave></pitch>
        <duration>2</duration><voice>1</voice><type>eighth</type>
        <notations><ornaments><trill-mark/></ornaments></notations>
      </note>
    </measure>
  `));

  assert.deepEqual(parsed.measures[0].notes[0].trill, {
    auxiliaryPitch: "G5",
    lowerPitch: "E5",
    startNote: "main",
    beats: null,
    accelerate: false,
  });
  const route = expandPerformanceRoute(parsed);
  assert.deepEqual(
    route.notes.map((note) => [note.pitch, note.onset, note.release]),
    [
      ["F5", 0, 0.125],
      ["G5", 0.125, 0.25],
      ["F5", 0.25, 0.375],
      ["G5", 0.375, 0.5],
    ],
  );
  assert.equal(route.playheadNotes?.length, 1);
});

test("uses persistent key signatures and ornament accidentals for trills", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>-1</fifths></key>
      </attributes>
      ${quarter("lead-in", "C")}
    </measure>
    <measure number="2">
      <note id="trill-a-flat-key">
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><ornaments><trill-mark beats="4" start-note="upper"/></ornaments></notations>
      </note>
      <note id="trill-a-natural">
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><ornaments><trill-mark beats="4"/><accidental-mark>natural</accidental-mark></ornaments></notations>
      </note>
    </measure>
  `));

  assert.equal(parsed.measures[1].notes[0].trill?.auxiliaryPitch, "B♭4");
  assert.equal(parsed.measures[1].notes[1].trill?.auxiliaryPitch, "B4");
  const route = expandPerformanceRoute(parsed);
  assert.deepEqual(
    route.notes
      .filter((note) => note.musicXmlId === "trill-a-flat-key")
      .map((note) => note.pitch),
    ["B♭4", "A4", "B♭4", "A4"],
  );
  assert.deepEqual(
    route.notes
      .filter((note) => note.musicXmlId === "trill-a-natural")
      .map((note) => note.pitch),
    ["A4", "B4", "A4", "B4"],
  );
});

test("maps merged page-scoped MusicXML IDs back to page sidecars", () => {
  const pages: DocumentPage[] = [0, 1].map((index) => {
    const sidecar: VisualSidecar = {
      version: 2,
      source_image_size: [1000, 1400],
      notes: [{
        musicxml_id: `n${index + 1}`,
        part: 1,
        measure: index + 1,
        staff: 1,
        voice: 1,
        pitch: "C4",
        duration: "note_4",
        match_confidence: 1,
        visual_group_id: `g${index + 1}`,
        alignment_method: "structural",
      }],
      visual_groups: [{
        visual_group_id: `g${index + 1}`,
        staff_index: 0,
        stave_index: 0,
        staff_position: 0,
        center: [100 + index * 20, 300],
        bbox: [90, 290, 110, 310],
        notehead_contours: [],
        stem_contours: [],
        musicxml_ids: [`n${index + 1}`],
        visual_status: "canonical",
        provenance: "segmentation",
        moment_id: `moment-${index + 1}`,
        chord_id: null,
        repair_actions: [],
      }],
      unmatched_musicxml_notes: [],
      unmatched_visual_notes: [],
    };
    return {
      index,
      status: "complete",
      width: 1000,
      height: 1400,
      musicXml: "<score-partwise/>",
      visualSidecar: sidecar,
    };
  });
  const map = buildRealtimeVisualMap(pages);
  assert.equal(map.get("page-1-n1")?.visualGroupId, "g1");
  assert.equal(map.get("page-2-n2")?.pageIndex, 1);
});

test("combines pitched notes and tempo information from every part", () => {
  const parsed = parseRealtimeMusicXml(score(
    `<measure number="1"><attributes><divisions>4</divisions></attributes>${quarter("p1", "C")}</measure>`,
    `<part id="P2"><measure number="1"><attributes><divisions>8</divisions></attributes><direction><sound tempo="72"/></direction><note id="p2"><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice></note></measure></part>`,
  ));
  assert.deepEqual(parsed.measures[0].notes.map((note) => note.pitch), ["C4", "E3"]);
  assert.equal(parsed.measures[0].tempos[0].bpm, 72);
});

test("expands repeat counts and first/second endings", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes><barline location="left"><repeat direction="forward"/></barline>${quarter("m1")}</measure>
    <measure number="2"><barline location="left"><ending number="1" type="start"/></barline>${quarter("m2")}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward" times="2"/></barline></measure>
    <measure number="3"><barline location="left"><ending number="2" type="start"/></barline>${quarter("m3")}<barline location="right"><ending number="2" type="stop"/></barline></measure>
  `));

  const route = expandPerformanceRoute(parsed);
  assert.deepEqual(route.occurrences.map((occurrence) => occurrence.measureNumber), ["1", "2", "1", "3"]);
  assert.deepEqual(route.occurrences.map((occurrence) => occurrence.pass), [1, 1, 2, 2]);
  assert.deepEqual(
    expandPerformanceRoute(parsed, { startMeasureIndex: 2 }).occurrences.map((occurrence) => occurrence.measureNumber),
    ["3"],
  );
});

test("handles nested, sequential, implied, and after-jump repeats", () => {
  const nested = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes><barline><repeat direction="forward"/></barline>${quarter("a")}</measure>
    <measure number="2"><barline><repeat direction="forward"/></barline>${quarter("b")}</measure>
    <measure number="3">${quarter("c")}<barline><repeat direction="backward"/></barline></measure>
    <measure number="4">${quarter("d")}<barline><repeat direction="backward"/></barline></measure>
    <measure number="5"><sound forward-repeat="yes"/>${quarter("e")}</measure>
    <measure number="6">${quarter("f")}<barline><repeat direction="backward"/></barline></measure>
  `));
  assert.deepEqual(
    expandPerformanceRoute(nested).occurrences.map((item) => item.measureNumber),
    ["1", "2", "3", "2", "3", "4", "1", "2", "3", "2", "3", "4", "5", "6", "5", "6"],
  );

  const afterJump = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes><barline><repeat direction="forward"/></barline>${quarter("a")}</measure>
    <measure number="2">${quarter("b")}<barline><repeat direction="backward" after-jump="yes"/></barline></measure>
    <measure number="3">${quarter("c")}<sound dacapo="yes"/></measure>
  `));
  assert.deepEqual(
    expandPerformanceRoute(afterJump).occurrences.map((item) => item.measureNumber),
    ["1", "2", "1", "2", "3", "1", "2", "1", "2", "3"],
  );
});

test("follows D.C. al Fine and D.S. al Coda using named sound tokens", () => {
  const dc = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes>${quarter("a")}</measure>
    <measure number="2">${quarter("b")}<sound dacapo="yes"/></measure>
    <measure number="3">${quarter("fine")}<sound fine="yes"/></measure>
  `));
  assert.deepEqual(
    expandPerformanceRoute(dc).occurrences.map((occurrence) => occurrence.measureNumber),
    ["1", "2", "1", "2", "3"],
  );

  const ds = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes><sound segno="main"/>${quarter("a")}</measure>
    <measure number="2">${quarter("b")}<sound tocoda="tail"/></measure>
    <measure number="3">${quarter("c")}<sound dalsegno="main"/></measure>
    <measure number="4"><sound coda="tail"/>${quarter("d")}</measure>
  `));
  assert.deepEqual(
    expandPerformanceRoute(ds).occurrences.map((occurrence) => occurrence.measureNumber),
    ["1", "2", "3", "1", "2", "4"],
  );
});

test("starts structurally after skipped repeats and reports malformed loops", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1"><attributes><divisions>4</divisions></attributes><barline><repeat direction="forward"/></barline>${quarter("a")}</measure>
    <measure number="2">${quarter("b")}<barline><repeat direction="backward" times="100"/></barline></measure>
    <measure number="3">${quarter("c")}</measure>
  `));
  assert.deepEqual(
    expandPerformanceRoute(parsed, { startMeasureIndex: 2 }).occurrences.map((item) => item.measureNumber),
    ["3"],
  );
  assert.throws(
    () => expandPerformanceRoute(parsed, { maxMeasureVisits: 3 }),
    /visited more than 3 times.*repeat and D\.C\.\/D\.S\./,
  );
});

test("seeks notes, bars, and pages in structural score order", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1"><print new-page="yes" page-number="1"/><attributes><divisions>4</divisions></attributes>${quarter("a")}${quarter("b", "D")}</measure>
    <measure number="2">${quarter("c", "E")}</measure>
    <measure number="3"><print new-page="yes" page-number="2"/>${quarter("d", "F")}</measure>
  `));
  assert.deepEqual(seekStructuralPosition(parsed, { measureIndex: 0, onset: 0 }, "forwardNote"), {
    measureIndex: 0, onset: 1,
  });
  assert.deepEqual(seekStructuralPosition(parsed, { measureIndex: 0, onset: 1 }, "forwardBar"), {
    measureIndex: 1, onset: 0,
  });
  assert.deepEqual(seekStructuralPosition(parsed, { measureIndex: 1, onset: 0 }, "forwardPage"), {
    measureIndex: 2, onset: 0,
  });
  assert.deepEqual(seekStructuralPosition(parsed, { measureIndex: 2, onset: 0 }, "backwardPage"), {
    measureIndex: 0, onset: 0,
  });
});

test("converts score offsets through tempo changes and a live multiplier", () => {
  const route: PerformanceRoute = {
    occurrences: [],
    notes: [],
    events: [],
    tempoSegments: [{ offset: 0, bpm: 60 }, { offset: 2, bpm: 120 }],
    totalQuarters: 4,
  };
  assert.equal(scoreOffsetToSeconds(route, 4), 3);
  assert.equal(scoreOffsetToSeconds(route, 4, 2), 1.5);
  assert.ok(Math.abs(scoreOffsetAfterSeconds(route, 0, 2.5) - 3) < 1e-9);
});

test("controller releases and retriggers repeated tremolo pitches", () => {
  const parsed = parseRealtimeMusicXml(score(`
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <direction><sound tempo="60"/></direction>
      <note id="roll">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type>
        <notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations>
      </note>
    </measure>
  `));
  const route = expandPerformanceRoute(parsed);
  let now = 0;
  let tick: (() => void) | null = null;
  const attacks: string[][] = [];
  const releases: string[][] = [];
  const controller = new RealtimeController(
    {
      attack: (pitches) => attacks.push([...pitches]),
      release: (pitches) => releases.push([...pitches]),
      stop: () => undefined,
    },
    { onFrame: () => undefined, onComplete: () => undefined },
    {
      now: () => now,
      setInterval: (callback) => { tick = callback; return 1; },
      clearInterval: () => { tick = null; },
    },
  );

  controller.play(route);
  assert.deepEqual(attacks, [["C4"]]);
  now = 0.26;
  (tick as (() => void) | null)?.();
  assert.deepEqual(releases, [["C4"]]);
  assert.deepEqual(attacks, [["C4"], ["C4"]]);
});

test("controller pauses, resumes, changes tempo in place, and cancels sounding audio", () => {
  let now = 0;
  let tick: (() => void) | null = null;
  const attacks: string[][] = [];
  const releases: string[][] = [];
  let stops = 0;
  let completions = 0;
  const clock: RealtimeClock = {
    now: () => now,
    setInterval: (callback) => { tick = callback; return 1; },
    clearInterval: () => { tick = null; },
  };
  const sink: RealtimeAudioSink = {
    attack: (pitches) => attacks.push([...pitches]),
    release: (pitches) => releases.push([...pitches]),
    stop: () => { stops += 1; },
  };
  const route: PerformanceRoute = {
    occurrences: [],
    notes: [
      { id: "c", musicXmlId: "c", pitch: "C4", onset: 0, release: 1, visual: null },
      { id: "d", musicXmlId: "d", pitch: "D4", onset: 1, release: 2, visual: null },
    ],
    events: [],
    tempoSegments: [{ offset: 0, bpm: 60 }],
    totalQuarters: 2,
  };
  const controller = new RealtimeController(
    sink,
    { onFrame: () => undefined, onComplete: () => { completions += 1; } },
    clock,
  );

  controller.play(route);
  assert.deepEqual(attacks, [["C4"]]);
  now = 0.5;
  (tick as (() => void) | null)?.();
  controller.pause();
  const pausedAt = controller.getOffset();
  now = 10;
  assert.equal(controller.getOffset(), pausedAt);
  controller.setTempoMultiplier(2);
  controller.resume();
  now = 10.3;
  (tick as (() => void) | null)?.();
  assert.ok(controller.getOffset() > 1);
  assert.deepEqual(attacks.at(-1), ["D4"]);
  controller.stop();
  assert.ok(stops >= 2);
  assert.equal(completions, 0);
  assert.equal(tick, null);
  assert.ok(releases.length >= 1);

  now = 20;
  controller.play(route);
  now = 23;
  (tick as (() => void) | null)?.();
  assert.equal(completions, 1);
  assert.equal(tick, null);
});
