# Staff geometry rejection: measured evidence and the decision it supports

Date: 2026-09-20
Scope: Task 1 of `plans/staff-geometry-recovery-plan.md`.
Repositories: `homr` and `sheet-music-viewer`, both on `piano_fingering_overlay`.

Everything below was produced by re-recognizing pinned inputs through the worker's
own rendering, resizing, scaling and validation path, not through a standalone
HOMR call. Source PDFs and the application's own cache were read and never
written. Derived artifacts live under the ignored `testdata/staff-geometry`
directory; the numeric fixture committed for tests is a twenty-one column window,
not a score.

## What was measured, and how to repeat it

| Step | Command |
| --- | --- |
| Pinned inputs | `plans/staff-geometry-corpus.json` (21 entries, every PDF hash verified) |
| Re-recognition | `python tools/staff-geometry-corpus.py` |
| One page on its own | `python tools/staff-geometry-repro.py <pdf> --output <dir> --page <n> --fresh` |
| Residual distributions | `python tools/staff-geometry-residuals.py testdata/staff-geometry/corpus --output testdata/staff-geometry/residuals.json` |

`tools/staff-geometry-repro.py` sets `HOMR_ANNOTATION_GEOMETRY_CAPTURE_DIR` for
the duration of the run, so every page — accepted or rejected — leaves its
pre-validation grid, coordinate transform, producer import location, model
identities and available inference providers behind. Without that capture a
rejected page keeps only a reason string, and the grid that caused it is gone.

Runtime of record: `homr` imported from
`/home/fschuh/dev/music/omr-sheet-music-viewer/homr/homr`, reporting version
`0.0.0.post473+e2eb29e`, transformer `pytorch_model_396-f6feedb4`, segmentation
`segnet_308-3296ccd4`, with CUDA available. The reported version string comes
from the last build of an editable install and does not identify the source; the
import location and the model identities do.

## Outcome per page

Twenty-one pages: sixteen supported, five rejected. Every rejection is
`implausible-staff-spacing` at `producer-validation`.

| Page | Role | Outcome | Staff, sample |
| --- | --- | --- | --- |
| fillmore-1 | reported failure | rejected | `staff-2-0`, sample 54, x≈585.7 |
| fillmore-2 | reported failure | rejected | `staff-2-1`, sample 33, x≈439.6 |
| chrono-trigger-fanfare-1-luccas-theme-1 | fixture | rejected | `staff-1-0`, sample 219 |
| super-mario-bros-ground-theme-1 | fixture | rejected | `staff-0-1`, sample 134 |
| impromptu-scan | scan | rejected | `staff-1-0`, sample 159 |
| the other sixteen | fixture / scan | supported | — |

Three findings deserve to be stated plainly, because each contradicts something
the plan recorded as provisional:

- **Both Fillmore pages reproduce locally.** The plan recorded page 1 as passing
  on this machine and page 2 as failing. With the worker's current configuration
  both pages are rejected here, with the same reason code, the same producer note
  counts (306 and 281) and the same source size as the two supplied sidecars.
  The page-2 defect is the same one the plan captured: its prediction-space x of
  331 is this run's source-space x of 439.6 under the recorded 0.7528 resize.
- **The supplied sidecars remain status fixtures only.** They carry the rejection
  and no grid, so they can exercise the viewer's classification and nothing else.
  The other machine's page-1 raw grid is still unavailable; what has changed is
  that page 1 now has a *local* reproduction, so the repair no longer depends on
  obtaining it. Device confirmation for that machine stays outstanding.
- **Two of the original sixteen fixtures and one of the three scans are also
  rejected.** This was not a Fillmore-specific fault. Conversely, Peters
  Nocturnes and Hisaishi, which the plan listed as previously rejected, are both
  supported by the current producer.

## How large is the defect that costs a page its annotations

Across the 21 captured pages there are **50,116 sampled columns**. Exactly
**fifteen** of them are out of contract. Those fifteen columns cost five pages of
twenty-one every fingering they could have carried.

They form eight runs, all interior — not one is at a staff edge:

| Page, staff | Run | Span between survivors | Neighbour spacing disagreement | Worst outer-line distance from the chord |
| --- | --- | --- | --- | --- |
| chrono-trigger `staff-1-0` | 6 columns | 1.78 spaces | 0.090 | 0.266 spaces |
| fillmore-1 `staff-2-0` | 1 column | 0.69 | 0.000 | 0.272 |
| fillmore-1 `staff-2-1` | 1 + 1 columns | 0.69 each | 0.000 | 0.274 |
| fillmore-2 `staff-2-1` | 1 column | 0.70 | 0.004 | 0.077 |
| impromptu-scan `staff-1-0` | 1 column | 0.62 | 0.000 | 0.162 |
| impromptu-scan `staff-1-1` | 1 column | 0.62 | 0.000 | 0.161 |
| super-mario `staff-0-1` | 3 columns | 2.94 | 0.041 | 0.143 |

No run holds its staff's topmost or bottommost point, so removing any of them
would leave the staff's vertical extent, and therefore the system placement
boundary derived from it, exactly where it is.

## Distributions over the accepted corpus

Measured over the 38,334 sampled columns of the sixteen accepted pages. Every
quantity is in local staff spaces, so it means the same thing on a 1200 dpi scan
and a 300 dpi render.

| Quantity | p50 | p90 | p99 | p99.9 | max |
| --- | --- | --- | --- | --- | --- |
| Worst inner-line deviation from the outer-anchored ideal grid | 0.051 | 0.165 | 0.299 | 0.419 | **0.495** |
| Largest adjacent gap ratio (the validator's own test) | 1.044 | 1.145 | 1.290 | 1.380 | **1.469** |
| Outer top-line step between neighbours | 0.007 | 0.103 | 0.271 | 0.374 | 0.533 |
| Local spacing step between neighbours | 0.004 | 0.038 | 0.087 | 0.127 | 0.166 |
| Leave-one-out interpolation error, top line | 0.000 | 0.100 | 0.257 | 0.360 | 0.460 |
| Leave-one-out interpolation error, bottom line | 0.000 | 0.103 | 0.254 | 0.356 | 0.554 |
| Span between a sample's two neighbours | 0.889 | 1.451 | 1.591 | 1.670 | 3.904 |
| Chord departure from the neighbouring slope | 0.001 | 0.331 | 1.450 | 2.967 | 8.343 |

The "leave-one-out interpolation error" is the quantity that matters for a
removal: it is how far a sample sits from where the consumer's piecewise-linear
evaluation would place it if that sample were gone. Measuring it on staffs the
validator already accepts is what gives a removal bound an empirical basis rather
than a plausible-sounding number.

Two things follow directly. Accepted geometry routinely carries inner-line
deviations up to half a staff space, so **passing the current ratio check is not
evidence of geometric correctness**. And the rejected pages exceed the ratio
limit by at most 8.7 per cent (largest observed ratio 1.631 against a limit of
1.5), while accepted pages reach 1.469 — the accepted and rejected populations
are not separated by any margin worth the whole-page penalty.

## Decision: inner-line agreement stays diagnostic, and v1 stays strict

Placement reads the outer lines and the derived spacing. The inner lines are
evidence that what was detected is a five-line staff at all, and they are used
for nothing else downstream. Recorded decision:

- **Inner-line agreement does not gate placement.** It has no measured relation
  to the accuracy of the outer envelope placement depends on, and a corpus-wide
  deviation reaching 0.495 spaces on accepted pages shows it would be a poor gate
  in either direction.
- **The existing v1 spacing check keeps its advertised strictness, unchanged.**
  It stays a five-line-staff identity test. No tolerance is widened here, for
  this corpus or any other. Recovery in Task 3 works by removing the columns that
  fail it, and then running the unchanged validator on what is left.
- **A future envelope-only capability is a separate question.** Nothing in this
  measurement argues for globally loosening spacing tolerances, and the two must
  not be conflated.

## Diagnostics this task added

Reason codes are stable strings, identical on both sides of the contract, and
carry the stage that reached the verdict: `export`, `producer-validation`,
`recovery`, `worker-pre-scale`, `worker-post-scale` or `viewer-validation`.

The exporter used to return an empty list for three distinct structural defects —
fewer than two grid samples, a line count that is not a multiple of five, and a
ragged grid — which made them indistinguishable from a staff that simply has no
geometry. Each now produces a diagnostic. A staff whose export failed leaves its
visual groups pointing at geometry that was never written, so validation would
otherwise report the missing-membership symptom; the originating export reason is
preserved instead. Registering the same staff group twice is refused rather than
silently overwriting the earlier export. The published `annotation_geometry_error`
string is unchanged, so existing consumers keep reading what they always read.

## What is still not established

- The other machine's page-1 raw grid. It cannot be reconstructed from producer
  version labels, model names or the supplied error-only sidecars, and no claim
  of parity with that machine rests on the local reproduction recorded here.
- Edge trimming has no observed case anywhere in this corpus. Every defect found
  is interior. Any bound on edge trimming rests on the neighbour-span
  distribution alone.
- A page that passed is a regression control, not ground truth. Nothing here
  establishes that the sixteen accepted pages are geometrically correct, only
  that they satisfy the contract they advertise.
