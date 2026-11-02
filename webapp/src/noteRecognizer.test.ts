import assert from "node:assert/strict";
import test from "node:test";
import type { RecognizerResult } from "@fschuh/piano-transcription-engine";
import { withoutPitches } from "./noteRecognizer";

test("ignored pitches vanish from every part of a recognizer result", () => {
  const result: RecognizerResult = {
    generation: 3,
    onsets: [
      { midi: 60, confidence: 0.9, noteConfidence: 0.9, onsetTimeMs: 10 },
      { midi: 62, confidence: 0.9, noteConfidence: 0.9, onsetTimeMs: 11 },
    ],
    recognizedActivePitches: [{ midi: 60, confidence: 0.8 }, { midi: 62, confidence: 0.8 }],
    targetPitchEvidence: [{ midi: 60, confidence: 0.8 }],
    noteStates: [{ midi: 62, confidence: 0.8, state: "onset" }],
    noteEvents: [{ midi: 62, type: "onset", confidence: 0.8, eventTimeMs: 11 }],
    processingTimeMs: 2,
    capturedAtMs: 12,
  };
  assert.equal(withoutPitches(result, new Set()), result);
  const filtered = withoutPitches(result, new Set([62]));
  assert.deepEqual(filtered.onsets.map((onset) => onset.midi), [60]);
  assert.deepEqual(filtered.recognizedActivePitches.map((pitch) => pitch.midi), [60]);
  assert.deepEqual(filtered.targetPitchEvidence.map((pitch) => pitch.midi), [60]);
  assert.deepEqual(filtered.noteStates, []);
  assert.deepEqual(filtered.noteEvents, []);
  assert.equal(filtered.generation, 3);
  assert.equal(filtered.capturedAtMs, 12);
});
