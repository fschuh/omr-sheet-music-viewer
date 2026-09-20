# Staff geometry rejection and regeneration-loop fix

Date: 2026-09-20
Status: proposed; implementation not started.
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
  missing the feature. Their page note counts are 306 and 281.
- Local CPU recognition produced valid page-1 geometry but rejected page 2. The
  captured page-2 failure was one sample in `staff-2-1`, at inference x=331, with
  adjacent gaps approximately 14.00, 21.97, 13.03 and 8.50 pixels. This establishes
  the local failure, not the precise cause of the other machine's page-1 failure.
- Serialization currently discards the entire optional geometry block after one
  validation exception. The browser's preflight ignores the producer error and
  displays the same regeneration instruction for absence and explicit rejection.
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
   system, sample index/x, observed gaps and validation limits. Retain a concise
   legacy `annotation_geometry_error` summary for existing consumers.
3. Provide an opt-in diagnostic export of the **pre-validation** annotation grid,
   coordinate transform, producer revision/import location, model identities and
   inference provider. Keep full grids out of normal UI messages/logs.
4. Reproduce both pages using the worker's actual rendering, resizing, scaling and
   validation path, not only a standalone HOMR call. Use a temporary cache.
5. Capture the other machine's page-1 rejected grid with the diagnostic path if it
   cannot be reproduced locally. Supplied error-only sidecars remain status/UI
   fixtures; do not present them as raw-grid repair fixtures.

Acceptance: the exact local page-2 sample triggers a stable reason code; both
supplied files are classified as rejected rather than legacy-missing. Coordinates
and reasons survive worker scaling. Ordinary sidecar validation still succeeds
when optional annotation capability is unavailable.

Commit this task before starting recovery implementation.

## Task 2 — Accurate status and retry behavior

Replace string-matched action logic with explicit annotation status/retry metadata.

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
  analysis is also absent. Preserve actionable ink failures when geometry is valid.

Files include `useScoreFingerings.ts`, `ScoreFingeringStatus.tsx`, worker error
transport, types and associated tests. Prefer a shared status classifier over
duplicated messages across the preflight and worker.

Acceptance: both supplied sidecars expose their actual rejection and no misleading
automatic regeneration prompt; old cache fixtures retain targeted regeneration.
Repeated manual retry cannot start a loop, erase edits or block normal viewing.

Commit separately; this improvement does not depend on successful geometry repair.

## Task 3 — Conservative isolated-sample recovery in HOMR

Implement recovery on an annotation-only copy of the detected grid, before export.
Do not mutate `Staff.grid`, recognition geometry, note/stem contours or associations.

1. Classify structural failures separately from locally implausible spacing.
   Duplicate/reversed x, non-finite coordinates, inconsistent line counts and
   ambiguous physical/system identity are not candidates for interpolation.
2. Initially consider only a single invalid **interior** sample bounded by valid
   samples on both sides. Do not extrapolate edge samples or bridge long gaps.
3. Interpolate each of the five corresponding lines by x from the two valid
   neighbors. Require bounded horizontal span in local staff spaces, agreement of
   neighboring spacing/slope, and bounded displacement from the detected sample.
4. Select explicit conservative span/agreement/displacement limits using captured
   grids and rendered notation; document and freeze them before challenge testing.
   Do not tune merely until Fillmore passes. A geometric consistency check alone
   is not proof the reconstructed lines follow the printed staff.
5. Recompute spacing/extents and run the unchanged strict validator on the result.
   Record repair provenance, original sample, support samples and reason. Preserve
   an unrepaired diagnostic when any recovery condition fails.
6. Never recursively use repaired samples as support for another repair. Cap total
   repaired samples/fraction per staff; reject repeatedly corrupted staff grids.

Tests: exact captured outlier, smooth skew and curvature, nonuniform transforms,
valid-grid identity, determinism, excessive displacement, conflicting neighbors,
adjacent defects, long missing intervals, edges, NaNs and identity corruption.

Acceptance: known-valid curves are unchanged; accepted recovery passes original
validation and visual alignment checks. Rejected inputs remain rejected. MusicXML,
note IDs, note links and recognition contours are identical before/after recovery.

Commit with synthetic and captured-grid tests before integrating new producer pins.

## Task 4 — Safe partial-page support for unrecoverable systems

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

## Task 5 — End-to-end verification and dependency handoff

1. Pin the tested HOMR commit in the worker dependency and lockfile. Verify the
   installed/imported producer actually contains the new capability. Record source
   revision and runtime provider; editable-package version strings can be stale.
2. Regenerate both Fillmore pages through the real worker into an isolated cache.
   Render original, overlay and geometry-debug views at reading size and multiple
   zooms. Review repairs against printed lines, note ownership and ink collisions.
3. Recheck the original 16 fixtures and all three supplied scan pages, especially
   Peters Nocturnes and Hisaishi, whose optional geometry was previously rejected.
   Include successful pages as controls; report fully supported, repaired, partially
   supported and unavailable cases separately.
4. Run HOMR geometry/sidecar tests, worker tests, web unit/integration tests and
   build, native tests and the browser interaction/layout checks. Confirm no
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
