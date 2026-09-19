import { useState } from "react";
import type { useFingeringPolicy } from "./useFingeringPolicy";
import type { DocumentPage } from "./types";

export function FingeringPolicyControls({ store, pages, editingPage, onEdit }: {
  store: ReturnType<typeof useFingeringPolicy>; pages: DocumentPage[];
  editingPage: number | null; onEdit: (index: number | null) => void;
}) {
  const [selected, setSelected] = useState(pages[0]?.index ?? 0);
  const page = pages.find(page => page.index === selected);
  const policy = store.policy.pages[selected] ?? { disabled: false, regions: [] };
  const raster = page?.visualSidecar?.ink_obstacles?.raster_sha256;
  const changePage = (next: typeof policy) => store.change({ ...store.policy, pages: { ...store.policy.pages, [selected]: next } });
  return <details className="status-strip"><summary>Printed-fingering exclusions</summary>
    <p>Printed fingerings are not detected automatically. Exclusions hide score labels, never keyboard values.
      Draw around noteheads, not around the printed finger numbers. Any excluded chord member hides the whole stack.</p>
    {!store.available ? <p role="alert">Exclusions unavailable: {store.error || "waiting for the PDF content identity"}.</p> : null}
    {store.available && store.error ? <p role="alert">{store.error}</p> : null}
    <fieldset disabled={!store.available}>
      <label><input type="checkbox" checked={store.policy.disabled}
        onChange={event => store.change({ ...store.policy, disabled: event.target.checked })} /> Hide score fingerings for this PDF</label>{" "}
      <label>Page <select value={selected} onChange={event => { setSelected(Number(event.target.value)); onEdit(null); }}>
        {pages.map(page => <option key={page.index} value={page.index}>{page.index + 1}</option>)}
      </select></label>{" "}
      <label><input type="checkbox" checked={policy.disabled}
        onChange={event => changePage({ ...policy, disabled: event.target.checked })} /> Hide this page</label>{" "}
      <button type="button" disabled={!raster || policy.regions.length >= 1000} aria-pressed={editingPage === selected}
        onClick={() => onEdit(editingPage === selected ? null : selected)}>{editingPage === selected ? "Finish drawing" : "Draw exclusion on this page"}</button>{" "}
      <button type="button" disabled={!store.canUndo} onClick={store.undo}>Undo exclusion change</button>
      {editingPage !== null ? <p>Drag a rectangle on page {editingPage + 1}. Finish drawing to restore note selection and gestures there.</p> : null}
      {policy.regions.map((region, index) => <p key={region.id}>Region {index + 1}
        {region.rasterId !== raster ? " — inactive: page image changed; redraw after review" : ""}{" "}
        <button type="button" onClick={() => changePage({ ...policy, regions: policy.regions.filter(r => r.id !== region.id) })}>Remove region {index + 1}</button>
      </p>)}
    </fieldset>
  </details>;
}
