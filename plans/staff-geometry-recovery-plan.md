# Staff geometry rejection and regeneration-loop fix

Date: 2026-09-20
Status: implemented, except Task 5, which its own evidence gate defers.
Outcome and measurements: `plans/staff-geometry-evidence.md`; contract and
limitations: `plans/fingering-geometry.md`.
Repositories: `homr` and `sheet-music-viewer`, both on `piano_fingering_overlay`.

## Outcome

Recover trustworthy annotation geometry when a small, isolated detection defect
occurs. Where recovery is unsafe, preserve usable systems without guessing note
identities or drawing into an unavailable system. Explain the real failure instead
of repeatedly instructing the user to regenerate an already regenerated page.

Keep ordinary recognition, playback, keyboard fingerings, saved overrides and
source PDFs unchanged. Do not loosen the existing spacing checks globally, replace
the detected staff with ideal straight lines, or modify authoritative note links.

## Confirmed evidence and uncertainties

- Both supplied Fillmore sidecars in `/home/fschuh/dev/tmp/visual-sidecars` contain
  `annotation_geometry_error: "Unordered lines or implausible staff spacing"` and
  omit `annotation_geometry`. These are explicit rejections, not merely old caches
  missing the feature. Their page note counts are 306 and 281; both report producer
  `0.7.0.post55+380468e` and source size `[2550, 3301]`. They are post-scale artifacts
  carrying an existing producer rejection: scaling did not cause these particular
  failures, though it is a separate unvalidated failure path.
- Local CPU recognition produced valid page-1 geometry but rejected page 2. The
  captured page-2 failure was one sample in `staff-2-1`, at inference x=331, with
  adjacent gaps approximately 14.00, 21.97, 13.03 and 8.50 pixels. This establishes
  the local failure, not the precise cause of the other machine's page-1 failure.
- Placement reads only the outer lines and derived spacing; inner lines currently
  supply validation evidence. The captured sample's inner deviations are much
  larger than its small gap-threshold exceedance. Agreement with an ideal grid
  anchored to the same outer lines does not independently prove those outer lines
  are correct. Measure both properties before changing what gates placement.
- Inserting an exactly interpolated knot is equivalent to deleting it for
  `staffAt`'s piecewise-linear evaluation, apart from rounding. Deletion still
  interpolates across the resulting gap; it does not eliminate the need to verify
  that interpolation is trustworthy. Extent changes also affect layout boundaries.
- Serialization currently discards the entire optional geometry block after one
  validation exception. The browser's preflight ignores the producer error and
  displays the same regeneration instruction for absence and explicit rejection.
- The worker validates v1 before scaling, but not after scaling/rounding. Malformed
  present geometry can then fail the browser validator, which returns only
  `undefined`; the layout worker reports “Invalid staff geometry; regenerate this
  page.” This differs from the preflight's missing-geometry message, but produces
  the same misleading retry advice.
- Ink analysis runs only when `annotation_geometry` is truthy. Its absence after
  producer rejection is therefore expected, not an independent ink failure.
- The rejected samples are not preserved in the supplied sidecars. Producer
  version labels/model names alone cannot reconstruct the other machine's raw
  grid or establish which runtime difference caused page 1 to diverge.
- Current Python and browser validators require every visual group to reference
  an exported staff. Current lane ownership and system boundaries are inferred
  from the exported staff list. Simply omitting an invalid staff is unsafe.

## Task 1 — Reproducible failure fixtures and diagnostics

Capture the failure before attempting a repair.

1. Pin hashes for the source PDF, both supplied sidecars, and local reproduction
   inputs. Keep user PDFs and app caches read-only; store derived artifacts in
   ignored testdata. Commit compact numeric fixtures, not the source PDF.
2. Add structured annotation diagnostics identifying reason code, physical staff,
   system, sample index/x, observed gaps, validation limits and failure stage
   (export, producer validation, worker pre/post-scale or browser validation).
   Diagnose exporter's currently silent empty returns: insufficient samples,
   non-multiple-of-five line counts and ragged grids. Preserve the originating
   reason rather than replacing it with a missing-membership symptom. Retain a
   concise legacy `annotation_geometry_error` summary for existing consumers.
   Reject unexpected duplicate `add_staff_geometry` group registration instead
   of silently overwriting the earlier export; first check intended call sites.
3. Provide an opt-in diagnostic export of the **pre-validation** annotation grid,
   coordinate transform, producer revision/import location, model identities and
   inference provider. Keep full grids out of normal UI messages/logs.
4. Reproduce both pages using the worker's actual rendering, resizing, scaling and
   validation path, not only a standalone HOMR call. Use a temporary cache.
5. Capture the other machine's page-1 rejected grid with the diagnostic path if it
   cannot be reproduced locally. Supplied error-only sidecars remain status/UI
   fixtures; do not present them as raw-grid repair fixtures.
6. Across the original 16 fixtures and three scan pages, measure distributions of
   inner-line deviation from the outer-line-derived grid in staff spaces, gap
   ratios, outer-envelope continuity and spacing/slope changes. Include accepted
   as well as rejected staffs and visually inspect representative tails. Passing
   the current ratio check is not ground truth for geometric correctness.
7. Record a decision on whether inner-line agreement should gate placement or be
   diagnostic evidence. Keep v1's existing advertised contract strict for this
   fix unless a separately justified compatibility change is approved. If it
   remains a gate, document its role as evidence for five-line staff identity,
   not as a field directly used by layout. Do not conflate a future envelope-only
   capability with globally loosening spacing tolerances.

Acceptance: the exact local page-2 sample triggers a stable reason code; both
supplied files are classified as rejected rather than legacy-missing. Coordinates
and reasons survive worker scaling. Ordinary sidecar validation still succeeds
when optional annotation capability is unavailable.

Commit this task before starting recovery implementation.

## Task 2 — Post-scale validation, accurate status and retry behavior

Replace string-matched action logic with explicit annotation status/retry metadata.

- Re-run annotation validation after worker scaling/rounding, before ink analysis
  and publication. On failure, preserve a stage-specific diagnostic and disable
  only optional annotations; do not fail ordinary recognition or publish malformed
  geometry. Preserve earlier producer/export failures without relabeling them.
- Give browser validation a structured result with reason codes, not only
  `undefined`. Keep a compatibility wrapper if useful for existing callers, but
  ensure status classification and worker responses receive the actual cause.
  Cover v1 now, independently of any later v2 work.
- Distinguish legacy capability missing, producer rejection, malformed advertised
  geometry, missing/failed ink analysis, supported geometry and partial support.
- For producer rejection, display a useful message such as: “Staff geometry was
  rejected; fingerings are unavailable for this system/page.” Offer diagnostic
  details without suggesting that unchanged regeneration will fix it.
- Keep deliberate page retry available through normal page controls. Offer
  “Regenerate to add geometry” for genuinely old artifacts; never auto-retry.
- Distinguish producer rejection from client/worker contract incompatibility. Do
  not label a malformed geometry payload as an ordinary missing capability.
- Ensure rejection remains the primary explanation when geometry-dependent ink
  analysis is also absent: ink generation is conditional on valid geometry.
  Preserve actionable ink failures when geometry is valid.

Files include the Python promotion/scaling path, `staffGeometry.ts`,
`useScoreFingerings.ts`, `ScoreFingeringStatus.tsx`, worker error transport, types
and associated tests. Replace the status substring check in `ScoreFingeringStatus`
with explicit actions. Prefer a shared status classifier over
duplicated messages across the preflight and worker.

Acceptance: both supplied sidecars expose their actual rejection and no misleading
automatic regeneration prompt; old cache fixtures retain targeted regeneration.
Repeated manual retry cannot start a loop, erase edits or block normal viewing.
Test scale-induced duplicate x values, bounds violations, spacing/extent disagreement
and rounding boundaries, including valid nonuniform scaling. Assert distinct
producer, post-scale and browser rejection codes and preserved ordinary artifacts.

Commit separately; this improvement does not depend on successful geometry repair.

## Task 3 — Bounded removal of rejected samples in HOMR

Implement recovery on an annotation-only copy of the detected grid, before export.
Do not mutate `Staff.grid`, recognition geometry, note/stem contours or associations.

1. Classify structural failures separately from locally implausible spacing.
   Duplicate/reversed x, non-finite coordinates, inconsistent line counts and
   ambiguous physical/system identity are not eligible for this recovery.
2. Drop rejected sample columns consistently from all five lines and spacing;
   retain at least two valid original samples. For an interior run of one or more
   adjacent defects, bound the total surviving-neighbor span in local staff spaces.
   Require neighboring spacing/slope agreement and bounded deviation of the removed
   samples from the chord. Do not bridge long gaps or repeatedly corrupted grids.
3. Permit bounded edge trimming without extrapolation. Shrink the x extent to the
   surviving samples; notes outside it remain omitted through `staffAt` returning
   undefined and the existing `missing-geometry` path. Bound removed fraction and
   edge span, and verify effects on full-stack eligibility and layout boundaries.
4. Select explicit conservative span/agreement/displacement limits using captured
   grids and rendered notation; document and freeze them before challenge testing.
   Do not tune merely until Fillmore passes. A geometric consistency check alone
   is not proof the consumer's wider interpolation follows the printed staff.
5. Recompute spacing/extents and run the unchanged strict validator on the result.
   Keep compact provenance: dropped x values and reasons; raw values remain in the
   opt-in diagnostic capture. Preserve a rejection when any recovery condition
   fails. No interpolated knots or synthetic support samples are created.
6. Preserve retained samples exactly. Test functional equivalence of removal and
   interpolated-knot insertion over the retained domain, separately from extent
   and placement-boundary changes. Removing an extreme sample must not silently
   enlarge neighboring systems' placement space; preserve conservative validated
   boundaries or reject that recovery if the current contract cannot express them.

Tests: exact captured outlier, smooth skew and curvature, nonuniform transforms,
valid-grid identity, determinism, excessive displacement, conflicting neighbors,
bounded adjacent defects, long missing intervals, safe/unsafe edge trimming,
fewer than two survivors, lost edge-note coverage, extent/boundary effects, NaNs
and identity corruption.

Acceptance: known-valid curves are unchanged; accepted recovery passes original
validation and visual alignment checks. Rejected inputs remain rejected. MusicXML,
note IDs, note links and recognition contours are identical before/after recovery.

Commit with synthetic and captured-grid tests before integrating new producer pins.

## Task 4 — Corpus verification and evidence gate

Apply Tasks 1–3 to both Fillmore pages, the original 16 fixtures and all three scan
pages using the real worker path. Classify full support, bounded sample removal,
trimmed note coverage and remaining rejection. Record before/after geometry and
visual alignment, including accepted staffs with large inner-line residuals.

Treat previously passing pages as regression controls, not ground truth. Preserve
all note denominators and explicitly record the other machine's page-1 outcome
as unverified until its raw grid or a repeat run is available.

Proceed to Task 5 only if this corpus demonstrates at least one genuinely
unrecoverable system after bounded removal and there is evidence that safe
isolation would preserve useful neighboring systems. Otherwise skip v2 and go
directly to Task 6. Do not assume both Fillmore pages will recover, and do not
design a new contract solely around hypothetical failures.

Acceptance: measured recovery/omission report and explicit proceed/defer decision.
Commit the evidence before beginning any conditional contract change.

## Task 5 — Conditional safe partial-page support

Prerequisite: Task 4's evidence gate passes. This is not required for the initial
status/post-scale-validation/sample-removal fix.

Do not achieve partial support by weakening v1's completeness invariant.

- Introduce a separately versioned optional annotation contract (v2) with explicit
  complete physical-staff/system membership, valid curves, unavailable systems,
  reason codes, repair provenance and validated placement boundaries.
- Keep v1 parsing unchanged and strict. Old readers must treat v2 as unsupported,
  never consume a partial staff list as complete v1 geometry. Sidecar v3 ordinary
  note recognition remains backward compatible.
- Quarantine the entire affected system initially, rather than silently dropping
  one staff and changing the remaining staff's above/below lane ownership.
- Preserve obstacle masks and independently validated system envelopes/boundaries
  for unavailable systems. Neighboring supported systems must not gain placement
  space through those systems. Never derive larger regions solely by removing
  unavailable staffs from `systemRegion`.
- If trustworthy boundaries cannot be established, suppress affected neighboring
  regions as well; retain page-wide unavailability when safe isolation is impossible.
  The boundary-validation design and fixtures are a prerequisite to shipping partial
  support, not a reason to invent replacement geometry.
- Require every visual-group staff reference to be either supported or explicitly
  unavailable. Missing, duplicate or inconsistent membership remains an error.
- Scale all new geometric fields correctly in the Python worker; validate v2 in
  Python and TypeScript. Pass explicit lane ownership and system bounds into layout.
- Include capability/version, coverage and repair data in annotation task identity
  and worker packets. Stale layouts must disappear when geometry/support changes.
- Display partial coverage and omissions by reason, including with an otherwise
  successful layout. Count unavailable notes in the original denominators.

Tests: missing upper/lower staff, three-staff systems, bad middle system, invalid
boundary, cross-system candidate rejection, all systems unavailable, mixed v1/v2
caches, rounding under x/y scaling, unchanged layout for fully valid input, and
cache invalidation when only diagnostics/coverage change.

Acceptance: healthy systems remain usable only with proven boundaries; no bass staff
switches to an upper lane, and no label migrates into an unavailable system. If this
gate fails, ship Tasks 2–3 with truthful page-level unavailability and explicitly
defer partial support rather than bypassing safety checks.

Commit the producer contract first, then its tested viewer integration. Do not
leave an intermediate dependency pin referring to an uncommitted producer revision.

## Task 6 — End-to-end verification and dependency handoff

1. Pin the tested HOMR commit in the worker dependency and lockfile. Verify the
   installed/imported producer actually contains the new capability. Record source
   revision and runtime provider; editable-package version strings can be stale.
2. Regenerate both Fillmore pages through the real worker into an isolated cache.
   Render original, overlay and geometry-debug views at reading size and multiple
   zooms. Review repairs against printed lines, note ownership and ink collisions.
3. Recheck the original 16 fixtures and all three supplied scan pages, especially
   Peters Nocturnes and Hisaishi, whose optional geometry was previously rejected.
   Use successful pages as regression controls, not geometric ground truth; include
   Task 1's residual-distribution review. Report fully supported, sample-trimmed,
   partially supported (if implemented) and unavailable cases separately.
4. Run HOMR geometry/sidecar tests, worker tests, web unit/integration tests and
   build and native tests. Name and run the existing `DocumentViewer.test.tsx`,
   Chromium controls/lifecycle suite (`node tools/fingering-render.mjs --controls`,
   including `tools/fingering-controls-check.mjs`), Chromium fixture layout review,
   and WebKitGTK runs (`tools/fingering-webkit-review.py` and
   `tools/fingering-webkit-metrics.py`) established in `da3e24c` and documented in
   `plans/fingering-integration.md`. Confirm no
   regressions in keyboard values, overrides, exclusions, playback or cache bounds.
5. Repeat the actual failing-machine run, or run its captured raw-grid fixtures
   and clearly leave device confirmation outstanding. Never claim page-1 parity
   from the supplied error-only files or from a passing local CPU run.
6. Update capability/storage/usage docs. Do not delete existing user caches or
   automatically regenerate all scores. Explain when a one-time deliberate
   regeneration with the new producer can add recovery/partial-support data.

Acceptance: both Fillmore pages have an evidence-backed outcome; no misleading
retry loop remains; known-valid pages retain safe layouts; unrepairable cases have
explicit, scoped omissions. Source PDFs and saved user edits are unchanged.

Commit each completed task after its tests. Remain on `piano_fingering_overlay` in
both repos. Publishing dependency commits, pushing branches and releasing packages
require separate authorization; record any unpublished-pin distribution limitation.

## Non-goals

No model retraining, printed-fingering OCR changes, relaxed note association,
global spacing-tolerance increase, guessed staff reconstruction, automatic cache
deletion, PDF modification or broad staff-detection rewrite in this fix.
