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

---

# Corpus verification after bounded sample removal

Date: 2026-09-20
Scope: Task 4 of `plans/staff-geometry-recovery-plan.md`, with the Task 5 gate decision.

The same twenty-one pinned pages were re-recognized through the same worker path,
with the repair active, into a separate isolated cache. Both runs were then
compared artifact by artifact.

| Command | |
| --- | --- |
| Second run | `python tools/staff-geometry-corpus.py --output testdata/staff-geometry/corpus-recovered` |
| Comparison | `python tools/staff-geometry-compare.py testdata/staff-geometry/corpus testdata/staff-geometry/corpus-recovered --output testdata/staff-geometry/repair-comparison.json` |
| Review packets | `python tools/staff-geometry-review.py testdata/staff-geometry/corpus-recovered <ids>` |
| Rendering | `node tools/fingering-render.mjs --split staff-geometry --width 1300` (and `--width 2000`) |

## Outcome

| Transition | Pages |
| --- | --- |
| supported → supported, byte-identical | 16 |
| rejected → repaired | 5 |
| still unavailable | 0 |

| Repaired page | Staff | Columns removed | Kind |
| --- | --- | --- | --- |
| fillmore-1 | `staff-2-0`, `staff-2-1` | 1 and 2 of 234 | interior |
| fillmore-2 | `staff-2-1` | 1 of 212 | interior |
| chrono-trigger-fanfare-1-luccas-theme-1 | `staff-1-0` | 6 of 260 | interior |
| super-mario-bros-ground-theme-1 | `staff-0-1` | 3 of 215 | interior |
| impromptu-scan | `staff-1-0`, `staff-1-1` | 1 each of 219 | interior |

The sixteen previously supported pages are **regression controls, not ground
truth**: what their unchanged bytes establish is that the repair did not touch a
page it had no business touching, and nothing more about whether their geometry is
geometrically correct.

## What the repair left alone

Checked mechanically for every page, by `tools/staff-geometry-compare.py`:

- The page MusicXML is byte-identical in both runs.
- Note ids, and every note-to-visual-group link with its alignment method, are
  identical.
- A digest over the whole sidecar with the annotation fields removed — notes,
  visual groups, notehead and stem contours, raw stem contours, preprocessing,
  producer — is identical.
- The only fields that differ anywhere are `annotation_geometry`, its error,
  rejection and repairs, and `ink_obstacles`, which is generated only when
  geometry is valid.

Every staff extent on every repaired page is unchanged to within 0.0005 pixels,
which is the worker's own three-decimal rounding when it promotes geometry onto the
display raster. No system placement boundary moved, and no note lost coverage:
`missing-geometry` appears in no omission list on any rendered page.

## Note coverage on the repaired pages

Denominators are preserved; these are the placement outcomes, with the frozen
cyclic values that measure layout rather than fingering-model quality.

| Page | Pitched | Supported | Placed | Omission reasons |
| --- | --- | --- | --- | --- |
| fillmore-1 | 306 | 266 | 219 | independent voices 33, tie continuation 7, system boundary 47 |
| fillmore-2 | 281 | 245 | 245 | independent voices 26, tie continuation 10 |
| impromptu-scan | 458 | 401 | 319 | missing link 49, printed ink 69, system boundary 13, other 8 |
| chrono-trigger-fanfare-1-luccas-theme-1 | 188 | 177 | 171 | tie continuation 11, printed ink 6 |
| super-mario-bros-ground-theme-1 | 208 | 208 | 199 | system boundary 9 |

Every remaining omission is one of the ordinary, pre-existing reasons. None is a
geometry reason.

## Visual review

Review packets were rendered at 1300 px and 2000 px wide in headless Chromium, in
original, overlay and geometry-debug views, and the repaired regions were
inspected against the printed staff at three times magnification. On both Fillmore
pages the detected lines run along the printed lines through and around the removed
column, with the sample-level wobble the accepted corpus already shows and no
drift; the fingering digits sit under and over their own notes and clear of the
printed ink.

## The two supplied sidecars, classified

Run against the real files rather than a stand-in, through the shipped classifier:

```
0001  producer-rejected  action=none  "Staff geometry was rejected; fingerings are unavailable for this page"
0002  producer-rejected  action=none  detail: "Unordered lines or implausible staff spacing"
```

Neither offers regeneration. They were written by a producer that recorded only
the legacy error string, so the reason code degrades to `validation-failed` and
the legacy summary becomes the detail — which is the right behaviour for an
artifact from before structured reasons existed, and still clearly separated from
an artifact written before the capability existed at all.

Retry itself is unchanged by this work and still reachable from the normal page
controls. Saved finger values live in browser storage keyed by the PDF cache
digest, independent of the session job id, and the retry path resets only
in-memory document state, so repeated retries cannot erase them; the existing
durable-edit tests and the Chromium controls suite continue to cover that.

## Task 5 gate: defer

The gate asks for at least one genuinely unrecoverable system after bounded
removal, plus evidence that isolating it would preserve useful neighbours.

**There are none.** All five rejected pages recover completely, every repair is a
short interior run, no staff is left unavailable, and no recovery in this corpus
was declined for any reason. There is therefore nothing to isolate, and designing a
second annotation contract around hypothetical failures is exactly what the plan
forbids.

**Decision: skip Task 5 and proceed to Task 6.** Should a future page prove
unrecoverable, this evidence is what a partial-support design would have to start
from, and the boundary-validation work the plan describes would be a prerequisite
to shipping it rather than a reason to invent replacement geometry.

---

# A recovery declined by the vertical-extent rule

Date: 2026-10-01
Scope: a page that bounded removal does not recover, and what that means for the
Task 5 gate. Investigation only: no producer or viewer code was changed.
Repositories: `homr` at `1ff2e76` and `sheet-music-viewer` at `4c1b688`, both on
`piano_fingering_overlay` with clean working trees.

Runtime of record: Windows 11, `homr` imported from
`C:\Users\freds\Dev\MachineLearning\music\omr-sheet-music-viewer\homr\homr`
through `homr/.venv` (Python 3.13.5, onnxruntime 1.24.1 with CUDA available),
transformer `pytorch_model_396-f6feedb4`, segmentation `segnet_308-3296ccd4`,
pypdfium2 5.12.0. Scripts and outputs live outside the repository, in
`C:\Users\freds\Dev\MachineLearning\music\experiments\staff-extent-recovery\`.

## The page

*Chrono Cross — The Scars of Time*, page 4 (PDF sha256 `ceac609b…db729d32`).
Pages 1–3 carry fingerings; page 4 carries none. The merged document has
fingerings for measures 51–59 and the page's note ids are consistent, so the
absence is entirely the annotation gate: the published sidecar has no
`annotation_geometry` and no `ink_obstacles`, and the viewer classifies it
`producer-rejected`.

| | |
| --- | --- |
| Rejection | `implausible-staff-spacing` at `producer-validation` |
| Staff | `staff-1-0` (system 1, treble), sample 24, x≈491.4 |
| Gaps at that sample | 32.5, 19.7, 25.8, 10.0 against a unit of 22.0 |
| Recovery | declined, `recovery-changes-vertical-extent` |
| Extent top before / after removal | 803.33 → 808.08 px |

The cause is printed, not detected: in measure 54 a dotted-half chord is tied
across the bar to a chord at its end, and the two tie arcs run nearly parallel to
the outer staff lines. Seven columns of the 231 on that staff are out of
contract, and the captured pre-validation grid shows which line each one lost:

| Sample | x | Line 1 y | Gaps |
| --- | --- | --- | --- |
| 24 | 491.4 | 810.1 | 32.4, 19.7, 25.8, 10.0 |
| 31–34 | 584.4–624.2 | 807.1 → 804.3 | 35–38, 20, 19, 19 |
| 35 | 637.5 | **803.3** | 38.7, 20.1, 23.8, 10.0 |
| 36 | 650.8 | 811.0 | 31.0, 20.2, 23.1, 10.6 |

Line 1 climbs from 807 to 803 across samples 31–35, following the upper tie as it
rises, while on the rest of the staff the top line sits at 808.1–809.0. In
samples 24, 35 and 36 line 4 is also pulled down onto the lower tie, closing the
last gap to ten pixels. The staff's topmost point is therefore sample 35, which
is itself one of the implausible columns.

Every other recovery check passed. `recover_staff` reaches the extent rule only
after budgets, run length, span, neighbour agreement, slope and chord deviation
are all satisfied, and with the rule disabled the final re-validation that
follows it passes too. The extent rule is the sole reason this page has no
fingerings.

## What disabling the rule does on this page

The same page was re-recognized through `HomrEngine.process_image` and promoted
as the worker does, twice: unchanged, and with only the vertical-extent
comparison in `recover_staff` replaced by `False` (`launcher.py` patches it in
memory; nothing in `homr` was edited).

| | Unchanged | Extent rule disabled |
| --- | --- | --- |
| Outcome | rejected, same reason, staff and sample as the cached page | geometry valid, ink generated |
| Repair | — | `staff-1-0`, 7 interior columns removed |
| Page MusicXML | | byte-identical to the unchanged run |

The unchanged run reproduces the cached rejection, and its MusicXML matches the
cached page when id attributes are excluded from the comparison, so the cached result is not stale.

Placement was then run through the viewer's own code (`annotationStatus`,
`buildFingeringRequests`, `layoutFingerings`) in Node, against the merged
document's fingerings (`place.ts`). Font metrics are fixed Arial proportions
rather than canvas measurements, so label boxes are approximate:

| Sidecar | Status | Supported digits | Placed | Suppressed |
| --- | --- | --- | --- | --- |
| page 3, cached (control) | supported | 144 | 133 | printed ink 6 |
| page 4, cached | producer-rejected | — | 0 | — |
| page 4, extent rule disabled | supported | 113 | 79 | system boundary 10, printed ink 8 |

The rendered overlay shows digits on all three systems, including the repaired
staff (the m.54 chord and its sixteenths). Every remaining omission and
suppression is an ordinary, pre-existing reason; none is a geometry reason.

What the rule was guarding against moved by a small amount here. System 1's top
extent shrinks by 4.74 px, about 0.22 staff spaces. The boundary `systemRegion`
derives between systems 0 and 1 is the midpoint of the gap, so it moves down by
2.37 px, about 0.11 spaces, giving system 0 that much more room. Because the
removed extreme was itself pulled up by the tie, the shrunken extent is the one
that follows the printed staff. That is a reading of this one staff, not a
property of the rule.

## The corpus never exercises this rule

The two earlier sections already establish it: no defective run in the 21-page
corpus holds a staff's topmost or bottommost point, and after recovery every
staff extent is unchanged to within rounding. A corpus comparison with the rule
disabled can therefore show that removing it does not disturb those pages, but it
cannot show that removing it is safe, because no page in it reaches the rule.

A two-mode corpus run was started anyway, with the Scars of Time pages added
(`run_corpus.py`, `compare_runs.py`). It did not complete: the run was stopped by
the host for low system memory while idle, after 14 of the 25 baseline pages and
before any page ran with the rule disabled. The completed baseline pages match
this file's earlier record — twelve supported unrepaired, chrono-trigger and
super-mario supported after repair — and none was declined by the extent rule.
**No comparison between the two modes exists, and no conclusion is drawn from
the partial run.**

## Possible fixes, none applied

Three were identified. Only the first touches core recognition.

1. **Make line tracking resist parallel ties — core `homr`.** The implausible
   samples come from `homr/staff_detection.py`, which builds `Staff.grid`; the
   sidecar's `export_staff_geometry` only copies that grid. Rejecting a sample
   whose spacing departs from the staff's regular spacing, and following the
   line's own slope rather than a curve diverging from it, would fix the cause.
   Because `Staff.grid` also feeds recognition, this needs the omr-evals pitch
   benchmarks as well as this corpus.
2. **Relax the vertical-extent rule — annotation layer only.** This lives in
   `homr/visual_sidecar/annotation_recovery.py` and works on the exported copy,
   so recognition cannot change, as the run above confirms. Two forms:
   - remove the rule, which is what was tested above;
   - narrower and untested: allow the extent to move only when the removed
     extreme sample is itself one of the implausible columns, as sample 35 is
     here. A detection pulled off the line by printed ink would then stop
     setting the placement boundary, while the rule would still prevent removing
     a plausible extreme.

   Either way, the module's limits are documented as frozen before any challenge
   test, so a change needs a principled basis and pages that actually reach the
   rule, not just this page passing.
3. **Per-staff or per-system rejection — annotation layer and viewer.** This is
   Task 5: a separately versioned contract carrying unavailable systems and
   validated placement boundaries, with the viewer accepting partial geometry.
   Systems 0 and 2 of this page are clean and would keep their fingerings even
   without option 1 or 2.

## Bearing on the Task 5 gate

The gate was deferred because nothing in the corpus was unrecoverable after
bounded removal. This page is the first observed case of that: one staff whose
recovery is declined, on a page whose other two systems are clean. It is one page
and one cause, and it is recoverable by option 2 as well as by isolation, so it
does not by itself show that partial support is the right answer. It is the
first input the gate asked for.

## What is still not established

- Whether disabling or narrowing the extent rule is safe on pages that reach it.
  That needs pages where printed ink pulls an outer line, for example long ties or
  slurs running along the staff, and the two-mode corpus run completed on them.
- Whether any boundary movement the rule would permit can push a label into a
  neighbouring system's ink. Here the move is 0.11 spaces; no distribution exists.
- The placement figures for page 4 use approximate font metrics and were not
  rendered in the application or in Chromium.
