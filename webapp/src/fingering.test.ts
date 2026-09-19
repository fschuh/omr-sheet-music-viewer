import assert from "node:assert/strict";
import test from "node:test";
import { captureSourceFingerings, migrateSourceFingerings, recoverSourceFingerings, resolveFingering } from "./fingeringAnnotations";
import { DOMParser as XmldomParser, XMLSerializer as XmldomSerializer } from "@xmldom/xmldom";
import {
  addPredictedFingeringsToMusicXml,
  cachedFingeringsFromMusicXml,
  type IndexedFingeringNote,
} from "./fingering";

Object.assign(globalThis, {
  DOMParser: XmldomParser,
  XMLSerializer: XmldomSerializer,
});

test("preserves raw source attributes through repeated prediction regeneration", async () => {
  const xml = `<score-partwise><part-list/><part id="P1"><measure number="1">
    <note id="n"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
    <notations><technical><fingering substitution="yes" placement="above"> 1-2 </fingering>
    <fingering alternate="yes">3</fingering></technical></notations></note></measure></part></score-partwise>`;
  const first = await addPredictedFingeringsToMusicXml(xml, async notes => notes.map(n => ({ ...n, finger: 4 })));
  const second = await addPredictedFingeringsToMusicXml(first.musicXml, async notes => notes.map(n => ({ ...n, finger: 5 })));
  assert.deepEqual(first.sourceFingerings, second.sourceFingerings);
  assert.deepEqual(first.sourceFingerings.notes[0].markings, [
    { text: " 1-2 ", attributes: { substitution: "yes", placement: "above" } },
    { text: "3", attributes: { alternate: "yes" } },
  ]);
  assert.equal(second.fingeringsByMusicXmlId.n.finger, 5);
  assert.deepEqual(cachedFingeringsFromMusicXml(second.musicXml)?.sourceFingerings, first.sourceFingerings);
});

test("legacy generated caches stay unknown unless exact original provenance is available", () => {
  const xml = `<score-partwise><identification><miscellaneous><miscellaneous-field name="homr-piano-fingering-cache">old-version</miscellaneous-field></miscellaneous></identification><part><measure><note id="page-2-n"><notations><technical><fingering>4</fingering></technical></notations></note></measure></part></score-partwise>`;
  const snapshot = captureSourceFingerings(new DOMParser().parseFromString(xml, "application/xml"));
  assert.equal(snapshot.notes[0].provenance, "unknown-generated-cache");
  assert.deepEqual(recoverSourceFingerings(snapshot, new Map()), snapshot);
  const original = { musicXmlId: "n", noteIndex: 0, provenance: "source" as const, markings: [] };
  assert.deepEqual(recoverSourceFingerings(snapshot, new Map([["page-1-n", original]])), snapshot);
  assert.equal(recoverSourceFingerings(snapshot, new Map([["page-2-n", original]])).notes[0].markings.length, 0);
});

test("resolver enforces confirmation, precedence and recognition revision", () => {
  const prediction = { finger: 2, left: true };
  const source = { finger: 3, left: true, confirmed: false, annotationRevision: "r1" };
  assert.equal(resolveFingering(prediction, undefined, "r1", source)?.source, "prediction");
  assert.equal(resolveFingering(prediction, undefined, "r1", { ...source, confirmed: true })?.finger, 3);
  assert.equal(resolveFingering(prediction, { finger: 5, annotationRevision: "r1" }, "r1", { ...source, confirmed: true })?.finger, 5);
  assert.equal(resolveFingering(prediction, { finger: 5, annotationRevision: "old" }, "r1")?.finger, 2);
  assert.equal(resolveFingering(prediction, { finger: 9, annotationRevision: "r1" }, "r1")?.finger, 2);
  assert.equal(resolveFingering(undefined, { finger: 1, annotationRevision: "r1" }, "r1"), undefined);
});

test("migration recovers exact page IDs including originals without markings", () => {
  const page = `<score-partwise><part><measure><note id="n"/></measure></part></score-partwise>`;
  const cached = `<score-partwise><identification><miscellaneous><miscellaneous-field name="homr-piano-fingering-cache">legacy</miscellaneous-field></miscellaneous></identification><part><measure><note id="page-2-n"><notations><technical><fingering>4</fingering></technical></notations></note></measure></part></score-partwise>`;
  const migrated = migrateSourceFingerings(cached, [undefined, page]);
  const captured = captureSourceFingerings(new DOMParser().parseFromString(migrated, "application/xml"));
  assert.equal(captured.notes[0].provenance, "source");
  assert.deepEqual(captured.notes[0].markings, []);
  assert.equal(migrateSourceFingerings(migrated, []), migrated);
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

test("loads complete versioned fingerings from MusicXML without inference", async () => {
  assert.equal(cachedFingeringsFromMusicXml(SCORE), null);

  const predicted = await addPredictedFingeringsToMusicXml(SCORE, async (notes) =>
    notes.map((note) => ({ ...note, finger: note.left ? 4 : 2 })),
  );
  const cached = cachedFingeringsFromMusicXml(predicted.musicXml);

  assert.ok(cached);
  assert.equal(cached.musicXml, predicted.musicXml);
  assert.equal(cached.noteCount, predicted.noteCount);
  assert.deepEqual(cached.fingeringsByMusicXmlId, predicted.fingeringsByMusicXmlId);

  const incomplete = predicted.musicXml.replace(/<fingering>[^<]+<\/fingering>/, "");
  assert.equal(cachedFingeringsFromMusicXml(incomplete), null);
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
