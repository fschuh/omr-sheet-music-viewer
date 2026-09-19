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

The persistent editing envelope (Tasks 09/12) must use a document content digest,
schema version and recognition/annotation revision, outside recognition and
prediction cache directories. It contains separate `sourceFingerings`, `overrides`,
`displayPolicy` and future `positionAdjustments` fields. Overrides and adopted
source values bind to recognition revision; model refresh does not change that
revision. Mismatched revisions require review and do not enter the resolver.
The XML snapshot is recovery data, not the final durable user-edit store.
