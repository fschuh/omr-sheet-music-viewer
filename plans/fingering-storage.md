# Fingering value boundary v1

`fingeringAnnotations.ts` resolves explicit user values, then explicitly confirmed
source values, then predictions. Unsupported source strings and all attributes
are retained verbatim. OCR candidates are not accepted as resolver input until
confirmed. A separate presentation policy owns score/page/region exclusions;
exclusions never remove keyboard values. Position adjustments are a separate map.

Before the prediction writer replaces fingering elements, it snapshots source
data into `homr-source-fingerings-v1`, separate from the model's cache marker and
generated technical elements. Prediction results expose this snapshot for durable
annotation storage. Repeated prediction writes retain the original snapshot.
Malformed snapshots fail closed instead of overwriting the only source copy.
ID-less notes retain a capture index for provenance, never for identity matching.

Legacy generated XML with any `homr-piano-fingering-cache` marker has unknown
provenance. Its digits are never relabeled as source fingerings. Exact-ID recovery
can use original page artifacts through `recoverSourceFingerings`; no pitch or
nearest-position matching is allowed. A missing original remains unknown.

The implemented durable store uses separate local-storage keys under the PDF
SHA256 identity: `homr.fingering-policy.v1.<digest>` for score/page/region policy,
and `homr.fingering-edits.v1.<digest>` for `values`, per-note `hidden`, and sparse
raw `sources` snapshots keyed by recognition revision. Both are outside cache
directories. There is no manual-position map yet; it must remain separate.

Recognition revisions are SHA256 digests of original page MusicXML, PDF page and
merge ordinal, raster identity/dimensions, authoritative note links and physical
anchors/onset/chord identities. Predicted/generated document XML is not an input.
Prediction refresh preserves matching edits. Changed recognition data rejects
old values and per-note hiding; the UI reports them for explicit review or
discard (undoable). No pitch, proximity, or note-index reconciliation is attempted.
This intentionally prefers conservative review over silent transfer.

Sparse source snapshots retain exact-ID-associated nonempty raw markings and
unknown-provenance entries without adopting them. The complete XML snapshot,
including ID-less source entries, remains recovery data; capture indices never
become editable note identity. Source snapshots are not removed by value undo,
reset, or stale-edit discard. No recognized printed value is auto-adopted.

Invalid stores are not overwritten. Quota/permission failures are surfaced while
session edits remain usable. Undo retains 20 changes per session, not across app
restart. Deleting the app profile removes these local stores; cache deletion
does not. Edits currently do not rewrite exports or constrain model reruns.
