import assert from "node:assert/strict";
import test from "node:test";
import { fraction } from "../model/fraction";
import type { ScoreModel } from "../model/score";
import { MusicXmlImportError, parseMusicXml } from "./parseMusicXml";

const partwise = (parts: string, defaults = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${defaults}<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>${parts}</score-partwise>`;

const note = (step: string, octave: number, duration: number, extra = "") =>
  `<note>${extra.includes("<chord/>") ? "<chord/>" : ""}<pitch><step>${step}</step>${
    /<alter>/.test(extra) ? extra.match(/<alter>[^<]*<\/alter>/)![0] : ""
  }<octave>${octave}</octave></pitch><duration>${duration}</duration>${extra.replace(/<chord\/>|<alter>[^<]*<\/alter>/g, "")}</note>`;

function keys(score: ScoreModel): string[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) => measure.chords.flatMap((chord) => chord.notes.map((value) => value.key))),
  );
}

test("scaling, page size, margins and distances come from <defaults>", () => {
  const score = parseMusicXml(partwise("", `<defaults>
    <scaling><millimeters>7.056</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-height>1683.67</page-height><page-width>1190.48</page-width>
      <page-margins type="even"><left-margin>1</left-margin><right-margin>2</right-margin><top-margin>3</top-margin><bottom-margin>4</bottom-margin></page-margins>
      <page-margins type="odd"><left-margin>85</left-margin><right-margin>86</right-margin><top-margin>87</top-margin><bottom-margin>88</bottom-margin></page-margins>
    </page-layout>
    <system-layout><system-margins><left-margin>10</left-margin><right-margin>0</right-margin></system-margins>
      <system-distance>121</system-distance><top-system-distance>70</top-system-distance></system-layout>
    <staff-layout><staff-distance>65</staff-distance></staff-layout>
  </defaults>`));
  assert.deepEqual(score.defaults, {
    scaling: { millimeters: 7.056, tenths: 40 },
    pageSize: { width: 1190.48, height: 1683.67 },
    pageMargins: { left: 85, right: 86, top: 87, bottom: 88 },
    systemLayout: { leftMargin: 10, rightMargin: 0, systemDistance: 121, topSystemDistance: 70 },
    staffDistance: 65,
  });
});

test("missing, partial or invalid defaults are left out", () => {
  const empty = { leftMargin: null, rightMargin: null, systemDistance: null, topSystemDistance: null };
  assert.deepEqual(parseMusicXml(partwise("")).defaults, {
    scaling: null,
    pageSize: null,
    pageMargins: null,
    systemLayout: empty,
    staffDistance: null,
  });
  const score = parseMusicXml(partwise("", `<defaults>
    <scaling><millimeters>0</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-width>1190</page-width><page-margins><left-margin>1</left-margin></page-margins></page-layout>
  </defaults>`));
  assert.equal(score.defaults.scaling, null);
  assert.equal(score.defaults.pageSize, null);
  assert.equal(score.defaults.pageMargins, null);
});

test("a break in any part applies to the measure at that position", () => {
  const score = parseMusicXml(partwise(`
    <part id="P1"><measure number="1"/><measure number="2"/><measure number="3"/></part>
    <part id="P2"><measure number="1"/><measure number="2"><print new-page="yes"/></measure><measure number="3"><print new-system="yes"><system-layout><system-distance>90</system-distance></system-layout></print></measure></part>`));
  assert.deepEqual(score.measures.map((measure) => [measure.newPage, measure.newSystem]), [
    [false, false],
    [true, true],
    [false, true],
  ]);
  assert.equal(score.measures[2].systemLayout.systemDistance, 90);
});

test("timewise scores read like partwise ones", () => {
  const timewise = parseMusicXml(`<score-timewise><part-list/>
    <measure number="1"><part id="P1"><attributes><divisions>1</divisions></attributes>${note("C", 4, 4)}</part></measure>
    <measure number="2"><part id="P1"><print new-page="yes"/>${note("D", 4, 4)}</part></measure>
  </score-timewise>`);
  const partwiseScore = parseMusicXml(partwise(`<part id="P1">
    <measure number="1"><attributes><divisions>1</divisions></attributes>${note("C", 4, 4)}</measure>
    <measure number="2"><print new-page="yes"/>${note("D", 4, 4)}</measure></part>`));
  assert.deepEqual(keys(timewise), ["P1-m1-s1-v1-t0-C4", "P1-m2-s1-v1-t0-D4"]);
  assert.deepEqual(keys(timewise), keys(partwiseScore));
  assert.deepEqual(timewise.measures.map((measure) => measure.newPage), [false, true]);
});

const pianoMeasure = `<part id="P1"><measure number="1">
  <attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time>
    <staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
  ${note("C", 5, 2, "<voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff>")}
  ${note("E", 5, 2, "<chord/><voice>1</voice><type>quarter</type><staff>1</staff>")}
  <note><grace slash="yes"/><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>
  <note><grace/><pitch><step>G</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>
  ${note("A", 4, 1, "<alter>-1</alter><voice>1</voice><type>eighth</type><accidental>flat</accidental><staff>1</staff><beam number=\"1\">begin</beam>")}
  ${note("A", 4, 1, "<chord/><voice>1</voice><type>eighth</type><staff>1</staff>")}
  <forward><duration>2</duration><voice>1</voice><staff>1</staff></forward>
  <backup><duration>6</duration></backup>
  ${note("C", 3, 3, "<voice>5</voice><type>quarter</type><dot/><staff>2</staff><tie type=\"start\"/>")}
  <note><rest><display-step>E</display-step><display-octave>3</display-octave></rest><duration>3</duration><voice>5</voice><type>quarter</type><dot/><staff>2</staff></note>
</measure></part>`;

test("chords, voices, grace notes and repeated pitches get distinct structural keys", () => {
  const score = parseMusicXml(partwise(pianoMeasure));
  assert.deepEqual(keys(score), [
    "P1-m1-s1-v1-t0-C5",
    "P1-m1-s1-v1-t0-E5",
    "P1-m1-s1-v1-t1_4-g1-Fs5",
    "P1-m1-s1-v1-t1_4-g2-G5",
    "P1-m1-s1-v1-t1_4-Ab4",
    "P1-m1-s1-v1-t1_4-A4",
    "P1-m1-s2-v5-t0-C3",
  ]);
});

test("chords carry their onset, duration, notation and encoded hints", () => {
  const [part] = parseMusicXml(partwise(pianoMeasure)).parts;
  assert.equal(part.staffCount, 2);
  const [measure] = part.measures;
  assert.deepEqual(measure.keys, [{ onset: fraction(0), staff: null, fifths: -1 }]);
  assert.deepEqual(measure.times, [{ onset: fraction(0), beats: "3", beatType: "4", symbol: "normal" }]);
  assert.deepEqual(measure.clefs.map((clef) => [clef.staff, clef.sign, clef.line]), [[1, "G", 2], [2, "F", 4]]);
  const [first, grace, , eighth, bass, rest] = measure.chords;
  assert.deepEqual([first.onset, first.duration, first.type, first.stem, first.notes.length], [fraction(0), fraction(1, 4), "quarter", "up", 2]);
  assert.deepEqual([grace.grace, grace.duration, grace.onset], [{ slash: true }, fraction(0), fraction(1, 4)]);
  assert.deepEqual([eighth.beams, eighth.notes[0].accidental, eighth.notes[0].alter], [["begin"], "flat", -1]);
  assert.deepEqual([bass.staff, bass.voice, bass.dots, bass.notes[0].tieStart], [2, "5", 1, true]);
  assert.deepEqual([rest.rest, rest.onset, rest.restPosition, rest.notes], [true, fraction(3, 8), { step: "E", octave: 3 }, []]);
  // The forward reaches the end of the 3/4 measure.
  assert.deepEqual(parseMusicXml(partwise(pianoMeasure)).measures[0].duration, fraction(3, 4));
});

test("note keys do not change with page format or breaks", () => {
  const plain = parseMusicXml(partwise(pianoMeasure));
  const laidOut = parseMusicXml(partwise(
    pianoMeasure.replace('<measure number="1">', '<measure number="1"><print new-page="yes"><system-layout><system-distance>99</system-distance></system-layout></print>'),
    "<defaults><scaling><millimeters>9</millimeters><tenths>40</tenths></scaling></defaults>",
  ));
  assert.deepEqual(keys(laidOut), keys(plain));
});

test("measures are counted by position, not by their printed numbers", () => {
  const score = parseMusicXml(partwise(`<part id="P1">
    <measure number="0" implicit="yes"><attributes><divisions>1</divisions></attributes>${note("C", 4, 1)}</measure>
    <measure number="X1">${note("D", 4, 1)}</measure>
    <measure number="X1">${note("E", 4, 1)}</measure></part>`));
  assert.deepEqual(keys(score), ["P1-m1-s1-v1-t0-C4", "P1-m2-s1-v1-t0-D4", "P1-m3-s1-v1-t0-E4"]);
  assert.deepEqual(score.measures.map((measure) => measure.number), ["0", "X1", "X1"]);
});

test("every key is a valid XML ID, whatever the part and voice IDs contain", () => {
  const score = parseMusicXml(partwise(`<part id="Piano.1:right"><measure number="1">
    <attributes><divisions>1</divisions></attributes>
    ${note("B", 3, 1, "<alter>-2</alter><voice>v 1/2</voice>")}
    ${note("F", 4, 1, "<alter>2</alter><voice>v 1/2</voice>")}
    ${note("C", 4, 1, "<alter>0.5</alter>")}</measure></part>`));
  const values = keys(score);
  assert.deepEqual(values, [
    "Piano_1_right-m1-s1-vv_1_2-t0-Bbb3",
    "Piano_1_right-m1-s1-vv_1_2-t1_4-Fx4",
    "Piano_1_right-m1-s1-v1-t1_2-Ca0_54",
  ]);
  for (const value of values) assert.match(value, /^[A-Za-z_][A-Za-z0-9_-]*$/);
});

test("the same pitch twice at one onset in one voice is numbered", () => {
  const score = parseMusicXml(partwise(`<part id="P1"><measure number="1">
    <attributes><divisions>1</divisions></attributes>
    ${note("E", 5, 1)}${note("E", 5, 1, "<chord/>")}${note("E", 5, 1, "<chord/>")}</measure></part>`));
  assert.deepEqual(keys(score), ["P1-m1-s1-v1-t0-E5", "P1-m1-s1-v1-t0-E5-2", "P1-m1-s1-v1-t0-E5-3"]);
});

test("text that is not a well-formed MusicXML score is rejected", () => {
  assert.throws(() => parseMusicXml("<not-xml"), MusicXmlImportError);
  assert.throws(() => parseMusicXml(""), MusicXmlImportError);
  assert.throws(() => parseMusicXml("<html><body/></html>"), /not a MusicXML score/);
});

test("attributes a file leaves out take their defaults", () => {
  // Parsers return an empty string for a missing attribute; it must not read as staff 0.
  const score = parseMusicXml(`<score-partwise><part-list/><part id="P1"><measure>
    <attributes><divisions>1</divisions><key><fifths>2</fifths></key><clef><sign>F</sign></clef></attributes>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>eighth</type><beam>begin</beam></note>
  </measure></part></score-partwise>`);
  const [measure] = score.parts[0].measures;
  assert.deepEqual([measure.clefs[0].staff, measure.clefs[0].line], [1, 4]);
  assert.equal(measure.keys[0].staff, null);
  assert.deepEqual(measure.chords[0].beams, ["begin"]);
  assert.equal(measure.chords[0].staff, 1);
  assert.equal(score.measures[0].number, "1");
});
