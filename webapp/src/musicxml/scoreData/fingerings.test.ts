import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { FINGERING_MODEL, type IndexedFingeringNote } from "../../fingering";
import {
  constraintSignature,
  fingeringsFile,
  FINGERINGS_FILE,
  loadScoreFingerings,
  NOTE_KEY_SCHEME,
  noteKeyOf,
  refitScoreFingerings,
  resolveFingerings,
  saveScoreOverrides,
  storedPredictions,
  withOverride,
} from "./fingerings";
import { OVERRIDES_FILE, parseOverrides } from "./overrides";
import type { ScoreDataStore } from "./scoreData";

Object.assign(globalThis, { DOMParser, XMLSerializer });

const note = (id: string, step: string, staff: number, extra = "") =>
  `<note id="${id}"><pitch><step>${step}</step><octave>${staff === 1 ? 5 : 3}</octave></pitch><duration>4</duration><voice>1</voice><staff>${staff}</staff>${extra}</note>`;

const C5 = "P1-m1-s1-v1-t0-C5";
const D5 = "P1-m1-s1-v1-t1_4-D5";
const C3 = "P1-m1-s2-v5-t0-C3";

/** A document MusicXML: viewer IDs on every note. */
function documentMusicXml(page = 1): string {
  return `<score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">
    <measure><attributes><divisions>4</divisions><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      ${note(`page-${page}-${C5}`, "C", 1)}
      ${note(`page-${page}-${D5}`, "D", 1, "<notations><technical><fingering>4</fingering></technical></notations>")}
      <backup><duration>8</duration></backup>
      ${note(`page-${page}-${C3}`, "C", 2)}
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

/** Left-hand notes get 5 and right-hand ones 2, unless their finger is fixed. */
function predictor(left = 5, right = 2) {
  const calls: IndexedFingeringNote[][] = [];
  const predict = async (notes: IndexedFingeringNote[]) => {
    calls.push(notes);
    return notes.map((value) => ({ ...value, finger: value.finger ?? (value.left ? left : right) }));
  };
  return { calls, predict };
}

test("a first opening predicts around the printed fingers and stores predictions by note key", async () => {
  const { files, store } = memoryStore();
  const { calls, predict } = predictor();
  let predicting = 0;
  const result = await loadScoreFingerings(documentMusicXml(), store, predict, () => { predicting += 1; });
  assert.equal(calls.length, 1);
  assert.equal(predicting, 1);
  assert.equal(result.fromStore, false);
  assert.equal(calls[0].find((value) => value.note === 74)?.finger, 4, "the printed finger is fixed for the model");
  assert.deepEqual(result.printed, { [`page-1-${D5}`]: { finger: 4, left: false } });
  assert.deepEqual(resolveFingerings(result, result.overrides), {
    [`page-1-${C5}`]: { finger: 2, left: false, source: "predicted", staffLeft: false, handMoved: false, baseFinger: 2, basePrinted: false },
    [`page-1-${D5}`]: { finger: 4, left: false, source: "printed", staffLeft: false, handMoved: false, baseFinger: 4, basePrinted: true },
    [`page-1-${C3}`]: { finger: 5, left: true, source: "predicted", staffLeft: true, handMoved: false, baseFinger: 5, basePrinted: false },
  });
  const stored = JSON.parse(files[FINGERINGS_FILE]);
  assert.deepEqual(Object.keys(stored.predicted).sort(), [C5, D5, C3]);
  assert.deepEqual(
    [stored.schemaVersion, stored.model, stored.noteKeyScheme, stored.constraints],
    [2, FINGERING_MODEL, NOTE_KEY_SCHEME, result.fittedConstraints],
  );
  assert.equal(stored.overrides, undefined, "overrides live in a file of their own");
  assert.equal(result.fittedConstraints, constraintSignature(result.printed, {}));
});

test("a later opening reuses the stored predictions, wherever the notes now sit", async () => {
  const { files, store } = memoryStore();
  await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  const { calls, predict } = predictor();
  let predicting = 0;
  // The same score laid out differently: its notes are now on page 3.
  const result = await loadScoreFingerings(documentMusicXml(3), store, predict, () => { predicting += 1; });
  assert.deepEqual([calls.length, predicting, result.fromStore], [0, 0, true]);
  assert.deepEqual(result.predicted[`page-3-${C3}`], { finger: 5, left: true });
  assert.ok(files[FINGERINGS_FILE]);
});

test("stored predictions from another model, schema or key scheme, or unreadable ones, are predicted again", () => {
  const current = fingeringsFile({ [C5]: { finger: 1, left: false } }, "abc");
  assert.deepEqual(storedPredictions(current), { predicted: { [C5]: { finger: 1, left: false } }, constraints: "abc" });
  const changed = (patch: object) => JSON.stringify({ ...JSON.parse(current), ...patch });
  assert.equal(storedPredictions(changed({ model: "older-model" })), null);
  assert.equal(storedPredictions(changed({ noteKeyScheme: 2 })), null);
  assert.equal(storedPredictions(changed({ schemaVersion: 1 })), null);
  assert.equal(storedPredictions(changed({ constraints: undefined })), null);
  assert.equal(storedPredictions(changed({ predicted: { a: { finger: 6, left: false } } })), null);
  assert.equal(storedPredictions("{not json"), null);
  assert.equal(storedPredictions(null), null);
});

test("predictions that cannot be stored still serve this session", async () => {
  const { store } = memoryStore({}, true);
  const result = await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  assert.equal(Object.keys(result.predicted).length, 3);
});

test("overrides are read from their own file and win over printed and predicted fingers", async () => {
  const { store } = memoryStore();
  await saveScoreOverrides(store, { [D5]: { finger: 1 }, [C3]: { left: false } });
  const result = await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  assert.equal(result.overridesError, null);
  const resolved = resolveFingerings(result, result.overrides);
  assert.deepEqual([resolved[`page-1-${D5}`].finger, resolved[`page-1-${D5}`].source], [1, "yours"]);
  assert.deepEqual(
    [resolved[`page-1-${C3}`].left, resolved[`page-1-${C3}`].handMoved, resolved[`page-1-${C3}`].source],
    [false, true, "predicted"],
  );
});

test("unreadable overrides are reported and never treated as none", async () => {
  const { files, store } = memoryStore({ [OVERRIDES_FILE]: "{broken" });
  const result = await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  assert.match(result.overridesError ?? "", /not valid JSON/);
  assert.deepEqual(result.overrides, {});
  assert.equal(files[OVERRIDES_FILE], "{broken");
  assert.throws(() => parseOverrides(JSON.stringify({ schemaVersion: 1, noteKeyScheme: 1, overrides: { a: { finger: 7 } } }), 1));
  assert.throws(() => parseOverrides(JSON.stringify({ schemaVersion: 1, noteKeyScheme: 1, overrides: { a: {} } }), 1));
  assert.deepEqual(parseOverrides(null, 1), {});
});

test("a re-fit predicts around the overrides on each note's chosen hand and keeps the earlier prediction of fixed notes", async () => {
  const { files, store } = memoryStore();
  const loaded = await loadScoreFingerings(documentMusicXml(), store, predictor().predict);
  const overrides = { [C5]: { finger: 3 }, [C3]: { left: false } };
  assert.notEqual(constraintSignature(loaded.printed, overrides), loaded.fittedConstraints);
  const { calls, predict } = predictor(5, 1);
  const refit = await refitScoreFingerings(documentMusicXml(), store, predict, loaded, overrides);
  const sent = calls[0];
  assert.deepEqual(sent.map((value) => [value.note, value.finger, value.left]), [
    [72, 3, false],
    [74, 4, false],
    [48, undefined, false],
  ]);
  assert.deepEqual(refit.predicted[`page-1-${C5}`], { finger: 2, left: false }, "the model's earlier choice for a fixed note");
  assert.deepEqual(refit.predicted[`page-1-${C3}`], { finger: 1, left: true }, "predicted on the right hand; the staff's hand is kept");
  assert.equal(refit.fittedConstraints, constraintSignature(loaded.printed, overrides));
  assert.equal(storedPredictions(files[FINGERINGS_FILE])?.constraints, refit.fittedConstraints);
});

test("an override that repeats the printed finger or the staff's hand is no override", async () => {
  const loaded = await loadScoreFingerings(documentMusicXml(), memoryStore().store, predictor().predict);
  const effective = resolveFingerings(loaded, {});
  const printedId = `page-1-${D5}`;
  const predictedId = `page-1-${C5}`;
  assert.deepEqual(withOverride({}, printedId, { finger: 4 }, effective[printedId]), {});
  assert.deepEqual(withOverride({}, predictedId, { finger: 2 }, effective[predictedId]), { [C5]: { finger: 2 } }, "a finger chosen to match the model is kept, so a re-fit keeps it");
  assert.deepEqual(withOverride({}, predictedId, { left: false }, effective[predictedId]), {});
  const moved = withOverride({}, predictedId, { left: true }, effective[predictedId]);
  assert.deepEqual(moved, { [C5]: { left: true } });
  assert.deepEqual(withOverride(moved, predictedId, { finger: 1 }, effective[predictedId]), { [C5]: { left: true, finger: 1 } });
  assert.deepEqual(withOverride(moved, predictedId, null, effective[predictedId]), {});
});

test("note keys are viewer IDs without their page", () => {
  assert.equal(noteKeyOf("page-12-P1-m3-s1-v1-t1_4-E5"), "P1-m3-s1-v1-t1_4-E5");
  assert.equal(noteKeyOf("P1-m3-s1-v1-t1_4-E5"), "P1-m3-s1-v1-t1_4-E5");
});
