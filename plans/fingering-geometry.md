# Annotation geometry compatibility

The producer uses optional `annotation_geometry.version = 1` on sidecar v3.
See HOMR's visual-sidecar contract for sampled lines and physical/system indices.
The worker validates advertised geometry and scales x and y separately when
promoting its private inference raster to the displayed page. The browser checks
the capability before annotation layout. Ordinary v3 viewing and keyboard
fingerings remain supported whatever happens to the optional capability.

## Why geometry can be unavailable, and what helps

Absence has several causes and only one of them is fixed by running the page
again. `webapp/src/annotationStatus.ts` is the single classifier both the
preflight and the placement worker use, so a page cannot be described two
different ways depending on which one spoke.

| State | Meaning | Offer |
| --- | --- | --- |
| `legacy-capability-missing` | Written before the capability existed; the producer never reached a verdict | Regenerate page |
| `producer-rejected` | The producer or the worker examined this detection and refused it | None; the reason, staff and sampled column are shown |
| `malformed-geometry` | Geometry is advertised but this viewer cannot read it: a contract mismatch | None |
| `ink-unavailable` | Geometry is usable; the page ink analysis it also needs is not | Regenerate page |
| `supported` | Both present and readable | — |

Page ink is generated only when geometry is valid, so its absence after a
rejection is expected rather than a second failure: the rejection stays the
explanation, and an ink failure is reported on its own only when the geometry it
depends on is in fact usable. Existing page retry remains the targeted
regeneration mechanism; nothing retries automatically.

## Reason codes and stages

A rejection carries a stable reason code, identical on both sides of the
contract, plus the stage that reached the verdict: `export`,
`producer-validation`, `recovery`, `worker-pre-scale`, `worker-post-scale` or
`viewer-validation`. A later stage never relabels an earlier one. The structured
record is published as `annotation_geometry_rejection`; the concise
`annotation_geometry_error` string is retained unchanged for existing consumers.

Scaling and rounding move every coordinate, so geometry the producer accepted can
still be out of contract on the displayed raster. The worker validates after
scaling as well as before. In both places a failure withdraws only the optional
capability, with its stage-specific reason; ordinary recognition, note links and
the MusicXML are untouched. Stored artifacts are still read strictly, so cache
validation keeps rejecting an artifact that does not satisfy the contract it
advertises.

## Bounded sample removal

The producer repairs a staff by dropping whole sampled columns whose line spacing
is implausible, then running the unchanged strict validator on what is left. It
never interpolates a knot, synthesises a support sample, or alters a retained
coordinate, and it refuses outright when the grid is structurally untrustworthy
or when a removal would move the staff's vertical extent and therefore a system's
placement boundary. Which columns went, and why, is published beside the geometry
as `annotation_geometry_repairs`, so the v1 staff schema is unchanged. Notes that
fall outside a trimmed extent are omitted through the existing `missing-geometry`
path rather than given extrapolated geometry.

`plans/staff-geometry-evidence.md` records the measured distributions the removal
limits were chosen from, the corpus outcomes before and after, and the decision to
defer partial-page support.

## Diagnosing a rejection

`HOMR_ANNOTATION_GEOMETRY_CAPTURE_DIR` makes the producer write the
pre-validation grid, the coordinate transform, its import location, the model
identities and the available inference providers to that directory. It is opt-in
because a full grid is far too large for a message or a log line, and the import
location matters because an editable install reports whatever version its last
build recorded. `tools/staff-geometry-repro.py` and `tools/staff-geometry-corpus.py`
set it for the duration of a run.

## Cache identity

Annotation cache identity must include `physical-staff-curves-v1`, raster identity
and geometry content. Do not use the normal v3 recognition-cache validity bit as
an overlay-ready bit. There is intentionally no blanket recognition-cache bump;
`VISUAL_SIDECAR_CACHE_REVISION` moved from 44 to 45 because the sidecar a page
produces has changed. Existing user caches are never deleted and no score is
regenerated automatically. A deliberate one-time regeneration through the normal
page retry is what adds recovery and diagnostic data to a page recognized earlier.

## Producer pin

Worker dependency and lock pin HOMR commit
`1ff2e7665413de219e9159da4df6cad353caf0ea`. **That commit is not published.**
Installing the worker from GitHub will fail until it is pushed, and pushing
requires separate authorization; no remote push or release is performed here. For
this two-repository development checkout, use
`PYTHONPATH=../homr:worker .venv/bin/python ...` from the viewer repository, or
the editable install already present in `.venv`.

Verify what is actually running rather than the version string: the producer
reports the version its last build recorded, which for an editable install is
stale. `homr.visual_sidecar.annotation_capture` records the import location and
the live inference providers for exactly this reason.

## Validation

237 HOMR sidecar/evaluator/geometry/recovery tests; 35 worker tests; 17 tool
tests; 186 browser unit tests plus the production build; 6 native tests. The
Chromium controls and lifecycle suite, the Chromium fixture layout review at two
widths and the WebKitGTK paired review all pass, with zero dark-pixel overlap
between placed digits and printed ink on every reviewed page. Twenty-one pinned
corpus pages were re-recognized through the real worker path before and after the
repair; see `plans/staff-geometry-evidence.md`.

These validate coordinate transforms, backward compatibility and the repair's
effect on real pages. They do not establish general noisy-scan support, and the
sixteen previously passing pages are regression controls rather than geometric
ground truth.
