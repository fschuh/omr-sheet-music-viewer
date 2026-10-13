import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { note, piano, score } from "../testScores";
import { documentMusicXml } from "./documentMusicXml";
import { importMusicXml } from "./parseMusicXml";

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
}

const source = score([piano([
  note("C5", 16, { type: "whole" }).replace("<note>", '<note id="from-the-file">') +
    note(null, 16, { type: "whole", staff: 2 }).replace("<note>", '<note id="a-rest">'),
  '<print new-page="yes" page-number="7"><system-layout><system-distance>90</system-distance></system-layout></print>' +
    note("D5", 16, { type: "whole" }),
  note("E5", 16, { type: "whole" }),
])]);

test("every note's id becomes its viewer ID and the file's own IDs are dropped", () => {
  const imported = importMusicXml(source);
  const ids = new Map([
    ["P1-m1-s1-v1-t0-C5", "page-1-P1-m1-s1-v1-t0-C5"],
    ["P1-m2-s1-v1-t0-D5", "page-1-P1-m2-s1-v1-t0-D5"],
    ["P1-m3-s1-v1-t0-E5", "page-2-P1-m3-s1-v1-t0-E5"],
  ]);
  const notes = Array.from(parse(documentMusicXml(imported, ids, new Map([[2, 2]]))).getElementsByTagName("note"));
  assert.deepEqual(notes.map((value) => value.getAttribute("id") || null), [
    "page-1-P1-m1-s1-v1-t0-C5",
    null,
    "page-1-P1-m2-s1-v1-t0-D5",
    "page-2-P1-m3-s1-v1-t0-E5",
  ]);
});

test("page breaks are the viewer's pages, and other print layout stays", () => {
  const xml = documentMusicXml(importMusicXml(source), new Map(), new Map([[2, 2]]));
  const prints = Array.from(parse(xml).getElementsByTagName("measure")).map((measure) => {
    const print = Array.from(measure.childNodes).find((node) => node.nodeName === "print") as Element | undefined;
    return print ? [print.getAttribute("new-page") || null, print.getAttribute("page-number") || null, print.getElementsByTagName("system-distance").length] : null;
  });
  assert.deepEqual(prints, [null, [null, null, 1], ["yes", "2", 0]]);
});

test("a timewise score becomes partwise with the same notes", () => {
  const timewise = `<?xml version="1.0"?><!DOCTYPE score-timewise PUBLIC "-//Recordare//DTD MusicXML 4.0 Timewise//EN" "http://www.musicxml.org/dtds/timewise.dtd">
    <score-timewise version="4.0"><part-list><score-part id="P1"><part-name>A</part-name></score-part><score-part id="P2"><part-name>B</part-name></score-part></part-list>
    <measure number="1">
      <part id="P1"><attributes><divisions>1</divisions></attributes>${note("C5", 4, { type: "whole" })}</part>
      <part id="P2"><attributes><divisions>1</divisions></attributes>${note("C3", 4, { type: "whole" })}</part>
    </measure>
    <measure number="2"><part id="P1">${note("D5", 4, { type: "whole" })}</part><part id="P2">${note("D3", 4, { type: "whole" })}</part></measure>
  </score-timewise>`;
  const imported = importMusicXml(timewise);
  const ids = new Map([...imported.noteElements.keys()].map((key) => [key, `page-1-${key}`]));
  const document = parse(documentMusicXml(imported, ids, new Map()));
  const root = document.documentElement;
  assert.equal(root.nodeName, "score-partwise");
  assert.equal(root.getAttribute("version"), "4.0");
  assert.equal(document.doctype, null);
  const parts = Array.from(root.getElementsByTagName("part"));
  assert.deepEqual(parts.map((part) => part.getAttribute("id")), ["P1", "P2"]);
  assert.deepEqual(
    parts.map((part) => Array.from(part.getElementsByTagName("measure")).map((measure) => [
      measure.getAttribute("number"),
      Array.from(measure.getElementsByTagName("note")).map((value) => value.getAttribute("id")),
    ])),
    [
      [["1", ["page-1-P1-m1-s1-v1-t0-C5"]], ["2", ["page-1-P1-m2-s1-v1-t0-D5"]]],
      [["1", ["page-1-P2-m1-s1-v1-t0-C3"]], ["2", ["page-1-P2-m2-s1-v1-t0-D3"]]],
    ],
  );
  assert.equal(root.getElementsByTagName("part-list").length, 1);
});
