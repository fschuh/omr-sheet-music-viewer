import type { SidecarNoteValue, VisualSidecar, VisualSidecarNote } from "./types";

/** Visual groups of the notes whose printed value disagrees with the recognized one. */
export function valueMismatchGroupIds(sidecar: VisualSidecar): Set<string> {
  const groupByNote = new Map(
    sidecar.notes.map((note) => [note.musicxml_id, note.visual_group_id]),
  );
  const ids = new Set<string>();
  for (const reading of sidecar.note_value_verification?.notes ?? []) {
    if (reading.status !== "disagrees") continue;
    const groupId = groupByNote.get(reading.musicxml_id);
    if (groupId) ids.add(groupId);
  }
  return ids;
}

/** What the page prints for the given notes, as the inspector shows it. */
export function printedValueSummary(sidecar: VisualSidecar, notes: VisualSidecarNote[]): string {
  const readings = new Map(
    (sidecar.note_value_verification?.notes ?? []).map((reading) => [reading.musicxml_id, reading]),
  );
  const described = notes.flatMap((note) => {
    const reading = readings.get(note.musicxml_id);
    return reading ? [describeReading(reading)] : [];
  });
  return described.length ? [...new Set(described)].join(" / ") : "Not read";
}

function describeReading(reading: SidecarNoteValue): string {
  if (reading.printed === null) return `not read (${reading.reason.split("_").join(" ")})`;
  const value =
    reading.dotted === true
      ? `dotted ${reading.printed}`
      : reading.dotted === null
        ? `${reading.printed}, dot not read`
        : reading.printed;
  return reading.status === "disagrees" ? `${value} (differs)` : value;
}
