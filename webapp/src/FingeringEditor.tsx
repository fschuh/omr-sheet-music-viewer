import type { useFingeringEdits } from "./useFingeringEdits";
import type { VisualSidecarNote } from "./types";
import { documentNoteId } from "./scoreIdentity";

export function FingeringEditor({ store, notes, ordinal }: {
  store: ReturnType<typeof useFingeringEdits>; notes: readonly VisualSidecarNote[]; ordinal?: number;
}) {
  return <section className="status-strip" aria-label="Selected note fingerings">
    {store.error ? <p role="alert">{store.error}</p> : null}
    {store.staleCount ? <p role="status">{store.staleCount} saved note edits need review after recognition changed; they are not applied.{" "}
      <button type="button" disabled={!store.available} onClick={store.discardStale}>Discard edits needing review</button></p> : null}
    {notes.map(note => {
      const id = ordinal ? documentNoteId(ordinal, note.musicxml_id) : "";
      const value = store.values?.[id], revision = store.revisions[id], edit = store.edits.values[id];
      const activeOverride = revision && edit?.annotationRevision === revision;
      const hidden = Boolean(revision && store.edits.hidden[id]?.annotationRevision === revision);
      return <div key={note.musicxml_id}>
        <span>{note.pitch ?? "Note"}: {value ? `${value.left ? "L" : "R"}${value.finger} (${value.source})` : "fingering unavailable"}. </span>
        <label>Finger <select aria-label={`Finger for ${id}`} value={activeOverride ? edit.finger : ""}
          disabled={!store.available || !revision || !value}
          onChange={event => store.change(id, { finger: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Use underlying prediction</option>
          {[1, 2, 3, 4, 5].map(finger => <option key={finger} value={finger}>{finger}</option>)}
        </select></label>{" "}
        <button type="button" disabled={!store.available || !revision || !edit}
          onClick={() => store.change(id, { finger: null })}>Reset finger</button>{" "}
        <label><input type="checkbox" checked={hidden} disabled={!store.available || !revision}
          onChange={event => store.change(id, { hidden: event.target.checked })} /> Hide score annotation only</label>
        {edit && !activeOverride ? <span> Saved value {edit.finger} requires explicit review.</span> : null}
        {!revision ? <span> Waiting for a verifiable note identity.</span> : null}
      </div>;
    })}
    <button type="button" disabled={!store.canUndo} onClick={store.undo}>Undo finger edit</button>
    <small> Local edits update score and keyboard; surrounding predictions and exported MusicXML are not recomputed.</small>
  </section>;
}
