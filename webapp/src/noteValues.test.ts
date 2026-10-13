import assert from "node:assert/strict";
import test from "node:test";
import { printedValueSummary, valueMismatchGroupIds } from "./noteValues";
import type { SidecarNoteValue, VisualSidecar, VisualSidecarNote } from "./types";

function note(musicxmlId: string, visualGroupId: string | null): VisualSidecarNote {
  return {
    musicxml_id: musicxmlId,
    part: 1,
    measure: 1,
    musicxml_staff_number: 1,
    voice: 1,
    pitch: "C5",
    duration: "note_16",
    match_confidence: 0.9,
    visual_group_id: visualGroupId,
    alignment_method: "structural",
  };
}

function reading(musicxmlId: string, changes: Partial<SidecarNoteValue> = {}): SidecarNoteValue {
  return {
    musicxml_id: musicxmlId,
    printed: "eighth",
    dotted: false,
    status: "disagrees",
    reason: "1_bands",
    ...changes,
  };
}

function sidecarWith(notes: VisualSidecarNote[], readings: SidecarNoteValue[]): VisualSidecar {
  return {
    version: 3,
    source_image_size: [100, 100],
    notes,
    visual_groups: [],
    note_value_verification: { version: 1, notes: readings },
  };
}

test("only notes whose printed value disagrees are marked", () => {
  const sidecar = sidecarWith(
    [note("homr-note-1", "vnote-1"), note("homr-note-2", "vnote-2"), note("homr-note-3", null)],
    [
      reading("homr-note-1"),
      reading("homr-note-2", { printed: "16th", status: "agrees", reason: "2_bands" }),
      reading("homr-note-3"),
    ],
  );
  assert.deepEqual([...valueMismatchGroupIds(sidecar)], ["vnote-1"]);
  assert.deepEqual([...valueMismatchGroupIds({ ...sidecar, note_value_verification: undefined })], []);
});

test("the inspector names what the page prints", () => {
  const notes = [note("homr-note-1", "vnote-1"), note("homr-note-2", "vnote-1")];
  const sidecar = sidecarWith(notes, [
    reading("homr-note-1", { dotted: true }),
    reading("homr-note-2", { dotted: true }),
  ]);
  assert.equal(printedValueSummary(sidecar, notes), "dotted eighth (differs)");
  const unread = sidecarWith(notes, [
    reading("homr-note-1", { printed: null, dotted: null, status: "unknown", reason: "stem_unclear" }),
  ]);
  assert.equal(printedValueSummary(unread, notes), "not read (stem unclear)");
  const agreed = sidecarWith(notes, [reading("homr-note-1", { dotted: null, status: "agrees" })]);
  assert.equal(printedValueSummary(agreed, notes), "eighth, dot not read");
  assert.equal(printedValueSummary(sidecarWith(notes, []), notes), "Not read");
});
