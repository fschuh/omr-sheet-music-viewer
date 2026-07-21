import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser as XmldomParser, XMLSerializer as XmldomSerializer } from "@xmldom/xmldom";
import {
  addPredictedFingeringsToMusicXml,
  type IndexedFingeringNote,
} from "./fingering";

Object.assign(globalThis, {
  DOMParser: XmldomParser,
  XMLSerializer: XmldomSerializer,
});

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano RH</part-name></score-part>
    <score-part id="P2"><part-name>Piano LH</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><sound tempo="60"/></direction>
      <note id="page-1-rh-c"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note id="page-1-rh-e"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
      <note><rest/><duration>12</duration></note>
    </measure>
    <measure number="2">
      <direction><sound tempo="120"/></direction>
      <note id="page-1-rh-d"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note id="page-1-lh-c"><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note id="page-1-lh-g"><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

test("extracts timed notes, assigns single-staff hands by clef, and inserts MusicXML fingerings", async () => {
  let received: IndexedFingeringNote[] = [];
  const result = await addPredictedFingeringsToMusicXml(SCORE, async (notes) => {
    received = notes;
    return [...notes].reverse().map((note) => ({
      ...note,
      finger: note.left ? 5 : 1,
    }));
  });

  assert.deepEqual(
    received.map(({ left, note, time, duration }) => ({ left, note, time, duration })),
    [
      { left: false, note: 60, time: 0, duration: 1000 },
      { left: false, note: 64, time: 0, duration: 1000 },
      { left: false, note: 62, time: 4000, duration: 500 },
      { left: true, note: 48, time: 0, duration: 4000 },
      { left: true, note: 43, time: 4000, duration: 500 },
    ],
  );
  assert.equal(result.noteCount, 5);
  assert.deepEqual(result.fingeringsByMusicXmlId["page-1-rh-c"], { finger: 1, left: false });
  assert.deepEqual(result.fingeringsByMusicXmlId["page-1-lh-c"], { finger: 5, left: true });

  const document = new XmldomParser().parseFromString(result.musicXml, "application/xml");
  const notes = Array.from(document.getElementsByTagName("note"));
  const fingerForId = new Map(
    notes.map((note) => [
      note.getAttribute("id"),
      Array.from(note.getElementsByTagName("fingering"))[0]?.textContent,
    ]),
  );
  assert.equal(fingerForId.get("page-1-rh-e"), "1");
  assert.equal(fingerForId.get("page-1-lh-g"), "5");
});

test("assigns staff 2 to the left hand even when its clef is treble", async () => {
  const score = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves>
      <clef number="1"><sign>G</sign></clef><clef number="2"><sign>G</sign></clef></attributes>
      <note id="upper"><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note>
      <backup><duration>1</duration></backup>
      <note id="lower"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><staff>2</staff></note>
    </measure></part></score-partwise>`;
  let received: IndexedFingeringNote[] = [];
  const result = await addPredictedFingeringsToMusicXml(score, async (notes) => {
    received = notes;
    return notes.map((note) => ({ ...note, finger: note.left ? 5 : 1 }));
  });

  assert.deepEqual(received.map(({ note, left }) => ({ note, left })), [
    { note: 72, left: false },
    { note: 60, left: true },
  ]);
  assert.deepEqual(result.fingeringsByMusicXmlId.upper, { finger: 1, left: false });
  assert.deepEqual(result.fingeringsByMusicXmlId.lower, { finger: 5, left: true });
});

test("honors backup and forward when voices share a measure", async () => {
  const score = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>2</divisions><clef><sign>G</sign></clef></attributes>
      <note id="first"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <forward><duration>2</duration></forward><backup><duration>4</duration></backup>
      <note id="second"><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration></note>
    </measure></part></score-partwise>`;
  let received: IndexedFingeringNote[] = [];
  await addPredictedFingeringsToMusicXml(score, async (notes) => {
    received = notes;
    return notes.map((note) => ({ ...note, finger: 2 }));
  });

  assert.deepEqual(received.map((note) => [note.note, note.time, note.duration]), [
    [60, 0, 500],
    [55, 0, 1000],
  ]);
});

test("converts metronome beat units to quarter-note tempo", async () => {
  const score = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign></clef></attributes>
      <direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>
      <note id="note"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure></part></score-partwise>`;
  let duration = 0;
  await addPredictedFingeringsToMusicXml(score, async (notes) => {
    duration = notes[0].duration;
    return notes.map((note) => ({ ...note, finger: 1 }));
  });

  assert.equal(duration, 500);
});
