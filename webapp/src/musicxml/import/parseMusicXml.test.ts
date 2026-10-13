import assert from "node:assert/strict";
import test from "node:test";
import { MusicXmlImportError, parseMusicXml } from "./parseMusicXml";

const partwise = (body: string, defaults = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${defaults}<part-list/>${body}</score-partwise>`;

test("scaling and page size come from <defaults>", () => {
  const score = parseMusicXml(partwise("", `<defaults>
    <scaling><millimeters>7.056</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-height>1683.67</page-height><page-width>1190.48</page-width></page-layout>
  </defaults>`));
  assert.deepEqual(score.defaults, {
    scaling: { millimeters: 7.056, tenths: 40 },
    pageSize: { width: 1190.48, height: 1683.67 },
  });
});

test("missing, partial or invalid defaults are left out", () => {
  assert.deepEqual(parseMusicXml(partwise("")).defaults, { scaling: null, pageSize: null });
  const score = parseMusicXml(partwise("", `<defaults>
    <scaling><millimeters>0</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-width>1190</page-width></page-layout>
  </defaults>`));
  assert.deepEqual(score.defaults, { scaling: null, pageSize: null });
});

test("a page break in any part marks the measure at that position", () => {
  const score = parseMusicXml(partwise(`
    <part id="P1"><measure number="1"/><measure number="2"/><measure number="3"/></part>
    <part id="P2"><measure number="1"/><measure number="2"><print new-page="yes"/></measure><measure number="3"><print new-system="yes"/></measure></part>`));
  assert.deepEqual(score.measures.map((measure) => measure.newPage), [false, true, false]);
});

test("timewise scores list their measures the same way", () => {
  const score = parseMusicXml(`<score-timewise><part-list/>
    <measure number="1"><part id="P1"/></measure>
    <measure number="2"><part id="P1"><print new-page="yes"/></part></measure>
  </score-timewise>`);
  assert.deepEqual(score.measures.map((measure) => measure.newPage), [false, true]);
});

test("text that is not a well-formed MusicXML score is rejected", () => {
  assert.throws(() => parseMusicXml("<not-xml"), MusicXmlImportError);
  assert.throws(() => parseMusicXml(""), MusicXmlImportError);
  assert.throws(() => parseMusicXml("<html><body/></html>"), /not a MusicXML score/);
});
