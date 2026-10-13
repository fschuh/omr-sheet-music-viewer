import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { FINGERING_MODEL, type IndexedFingeringNote } from "../../fingering";
import { fingeringsFile, FINGERINGS_FILE, loadScoreFingerings, NOTE_KEY_SCHEME, noteKeyOf, storedPredictions } from "./fingerings";
import type { ScoreDataStore } from "./scoreData";

Object.assign(globalThis, { DOMParser, XMLSerializer });

const note = (id: string, step: string, staff: number, extra = "") =>
  `<note id="${id}"><pitch><step>${step}</step><octave>${staff === 1 ? 5 : 3}</octave></pitch><duration>4</duration><voice>1</voice><staff>${staff}</staff>${extra}</note>`;

/** A document MusicXML: viewer IDs on every note. */
function documentMusicXml(page = 1): string {
  return `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
    <measure><attributes><divisions>4</divisions><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${note(`page-${page}-P1-m1-s1-v1-t0-C5`, "C", 1)}
      ${note(`page-${page}-P1-m1-s1-v1-t1_4-D5`, "D", 1, "<notations><technical><fingering>4</fingering></technical></notations>")}
      <backup><duration>8</duration></backup>
      ${note(`page-${page}-P1-m1-s2-v5-t0-C3`, "C", 2)}
    </measure></part></score-partwise>`;
}

function memoryStore(initial: Record<string, string> = {}, failWrites = false) {
  const files = { ...initial };
  const store: ScoreDataStore = {
    read: async (name) => files[name] ?? null,
    write: async (name, contents) => {
      if (failWrites) throw new Error("read-only");
      files[name] = contents;
    },
  };
  return { files, store };
}

function predictor() {
  const calls: IndexedFingeringNote[][] = [];
  const predict = async (notes: IndexedFingeringNote[]) => {
    calls.push(notes);
    return notes.map((value) => ({ ...value, finger: value.left ? 5 : 2 }));
  };
  return { calls, predict };
}

test("a first opening predicts, stores predictions by note key, and printed fingers win", async () => {
  const { files, store } = memoryStore();
  const { calls, predict } = predictor();
  let predicting = 0;
  const result = await loadScoreFingerings(documentMusicXml(), store, predict, () => { predicting += 1; });
  assert.equal(calls.length, 1);
  assert.equal(predicting, 1);
  assert.equal(result.fromStore, false);
  assert.deepEqual(result.fingeringsByMusicXmlId, {
    "page-1-P1-m1-s1-v1-t0-C5": { finger: 2, left: false },
    "page-1-P1-m1-s1-v1-t1_4-D5": { finger: 4, left: false },
    "page-1-P1-m1-s2-v5-t0-C3": { finger: 5, left: true },
  });
  const stored = JSON.parse(files[FINGERINGS_FILE]);
  assert.deepEqual(Object.keys(stored.predicted).sort(), [
    "P1-m1-s1-v1-t0-C5", "P1-m1-s1-v1-t1_4-D5", "P1-m1-s2-v5-t0-C3",
  ]);
  assert.equal(stored.predicted["P1-m1-s1-v1-t1_4-D5"].finger, 2, "the prediction is stored; the printed finger is not");
  assert.deepEqual([stored.schemaVersion, stored.model, stored.noteKeyScheme, stored.overrides], [1, FINGERING_MODEL, NOTE_KEY_SCHEME, {}]);
});

test("a later opening reuses the stored predictions, wherever the notes now sit", async () => {
  const { files, store } = memoryStore();
  await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  const { calls, predict } = predictor();
  let predicting = 0;
  // The same score laid out differently: its notes are now on page 3.
  const result = await loadScoreFingerings(documentMusicXml(3), store, predict, () => { predicting += 1; });
  assert.deepEqual([calls.length, predicting, result.fromStore], [0, 0, true]);
  assert.deepEqual(result.fingeringsByMusicXmlId["page-3-P1-m1-s2-v5-t0-C3"], { finger: 5, left: true });
  assert.equal(result.noteCount, 3);
  assert.ok(files[FINGERINGS_FILE]);
});

test("stored predictions from another model or key scheme, or unreadable ones, are predicted again", () => {
  const current = fingeringsFile({ "P1-m1-s1-v1-t0-C5": { finger: 1, left: false } });
  assert.deepEqual(storedPredictions(current), { "P1-m1-s1-v1-t0-C5": { finger: 1, left: false } });
  const changed = (patch: object) => JSON.stringify({ ...JSON.parse(current), ...patch });
  assert.equal(storedPredictions(changed({ model: "older-model" })), null);
  assert.equal(storedPredictions(changed({ noteKeyScheme: 2 })), null);
  assert.equal(storedPredictions(changed({ schemaVersion: 2 })), null);
  assert.equal(storedPredictions(changed({ predicted: { a: { finger: 6, left: false } } })), null);
  assert.equal(storedPredictions("{not json"), null);
  assert.equal(storedPredictions(null), null);
});

test("predictions that cannot be stored still serve this session", async () => {
  const { store } = memoryStore({}, true);
  const result = await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  assert.equal(result.noteCount, 3);
});

test("note keys are viewer IDs without their page", () => {
  assert.equal(noteKeyOf("page-12-P1-m3-s1-v1-t1_4-E5"), "P1-m3-s1-v1-t1_4-E5");
  assert.equal(noteKeyOf("P1-m3-s1-v1-t1_4-E5"), "P1-m3-s1-v1-t1_4-E5");
});
