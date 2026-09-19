# PDF fingering overlay experiment and implementation plan

Date: 2026-09-13  
Status: Tasks 01–10 implemented and committed; Tasks 11–13 remain. See companion
experiment and integration reports for measured scope and outstanding release checks.

## 1. Objective and scope

Display predicted piano fingerings next to their notes on the original PDF page, independently of keyboard visibility or the currently highlighted keys. Aim for readable, stable annotations that respect the printed notation. Preserve the original page image and the existing keyboard fingering behavior.

Begin with a bounded experiment using existing note associations, staff geometry, and conventional image processing. Do not train an OCR model for placement. Treat recognition of printed fingerings as a separate, optional project after the overlay has demonstrated useful coverage.

The PDF layout is fixed. Some passages cannot accommodate another annotation at a readable size. Suppressing a label is an intentional outcome when its placement would obscure notation or make its note association ambiguous. The experiment must measure both coverage and quality so that hiding difficult cases cannot disguise a poor result.

Initial scope:

- An opt-in score fingering overlay with no dependency on keyboard visibility.
- Per-note labels, plus ordered stacks for supported chords.
- Page-image collision avoidance and placement in staff-relative coordinates.
- Stable positions during playback, selection, pan, and zoom.
- Explicit handling of unavailable predictions, missing geometry, and crowded passages.
- Manual suppression for scores, pages, and regions with existing printed fingerings.
- Preservation of fingering provenance to support later user overrides.

Deferred scope:

- Editing finger values and dragging individual labels, beyond defining compatible storage boundaries.
- Automatic detection, transcription, or removal of printed fingerings.
- Re-engraving the score, changing staff spacing, or exporting an annotated PDF.
- Training or replacing the existing fingering prediction model.
- Full engraving support for finger substitutions, alternative fingerings, complex cross-staff writing, and multiple hands on one visual chord.

## 2. Current implementation and integration points

Paths in this document are relative to `sheet-music-viewer/` unless prefixed with `../homr/`.

| Area | Existing implementation | Implication |
| --- | --- | --- |
| Predictions | `webapp/src/fingering.ts`, `fingeringModel.ts`, `App.tsx` | Predictions already have MusicXML IDs and a hand flag. Reuse their loading lifecycle. |
| Score overlay | `webapp/src/DocumentViewer.tsx` | Existing SVG shares page coordinates with the raster page. Add a dedicated fingering layer. |
| Visual geometry | `webapp/src/types.ts` | Sidecar v3 includes noteheads, stems, physical staff membership, onset IDs, and optional visual chord IDs. |
| Staff geometry producer | `../homr/homr/visual_sidecar/recovery.py`, `serialization.py` | HOMR computes staff lines internally but does not currently export explicit staff curves or spacing in the viewer contract. |
| Pitch labels | `webapp/src/noteLabels.ts` | Reuse suitable bounds helpers. Its notehead-only obstacles and overlap/page-grid fallbacks are unsuitable for score fingering placement. |
| Artifact validation/cache | `worker/sheet_music_worker/processor.py` | Existing validation explicitly requires sidecar version 3. Any schema change needs a compatibility and cache strategy. |
| Document IDs | `worker/sheet_music_worker/musicxml_merge.py` | Merged MusicXML scopes IDs by page. A page-local sidecar ID cannot be blindly used as a document prediction key. |
| Native boundary | `webapp/src/native.ts`, `src-tauri/src/lib.rs` | Reuse the existing artifact and command boundaries for any new persisted data. |
| Preferences | `webapp/src/preferences.ts` | Suitable for a global display preference; document-specific exclusions need document identity. |

The sidecar remains authoritative for note associations. Never infer missing links from horizontal proximity, synthesize noteheads, or reinterpret diagnostic candidates as linked notes in the overlay consumer.

The current prediction writer replaces MusicXML fingering elements in the technical element it uses. Source fingerings and user values must therefore be captured and stored independently before they can participate in an override workflow. Existing generated fingering caches must not be mistaken for source editorial annotations.

## 3. Proposed architecture

```text
Original page image ───────────────> ink obstacle map ──────────┐
                                                              │
HOMR note links + exported staff geometry ──> label requests ───┤
                                                              ├─> layout result ─> SVG
Document prediction IDs ──> effective fingering values ─────────┤
                                                              │
Document/page/region display policy ───────────────────────────┘
```

Separate three concerns:

1. **Values:** what finger belongs to a note, where that value came from, and whether it has been overridden.
2. **Geometry:** where the linked note and physical staff are on the original page, plus which pixels are occupied.
3. **Presentation:** which labels are requested, where they fit, and why others are suppressed.

Proposed modules, subject to adjustment during implementation:

- `webapp/src/scoreFingerings.ts`: page/document ID mapping and label requests.
- `webapp/src/fingeringLayout.ts`: deterministic candidate generation and placement.
- `webapp/src/fingeringObstacles.ts`: obstacle queries and image-coordinate mapping.
- `webapp/src/fingeringAnnotations.ts`: source/provenance and document display policy.
- A dedicated SVG component or layer integrated with `DocumentViewer.tsx`.

Use the original raster for collision detection, before any selection or annotation overlays. Prefer a lightweight browser worker for the first prototype if canvas pixel access and cost are acceptable in the Tauri webview. If that fails the platform/performance check, produce a compact obstacle artifact in the existing Python worker. Decide this at Task 04; do not maintain both implementations initially or introduce OpenCV.js solely for basic binary operations.

## 4. Placement rules

- Start above the upper staff and below the lower staff for conventional piano notation. Physical staff membership determines the anchor; hand information is separate and must not be inferred again from pitch.
- Keep horizontal positions close to their note or chord. Bound any displacement using staff-space units and neighboring onset positions.
- Generate a limited set of vertical lanes with consistent font size and clearance, also in staff-space units.
- Prefer a common or smoothly varying baseline across neighboring onsets. A greedy search for each note's nearest blank pixel is not sufficient.
- Use a thresholded ink map with conservative clearance. Beams, flags, slurs, octave lines, accidentals, articulations, text, and printed fingerings all count as occupied ink without semantic recognition.
- Preserve thin notation when processing noisy scans. Staff-line removal is not needed for an outside-staff placement mask and must not accidentally remove slurs or ledger lines.
- Check entire text/stack bounds and other overlay bounds, not just the label center.
- Keep candidate labels inside their system's permitted region; neighboring systems and page margins impose limits. Do not move a number arbitrarily far into another system's whitespace.
- Use small plain digits with a legible embedded or consistently available font. Avoid opaque patches or large badges in the initial score layer.
- Keep a minimum readable text size. Suppress instead of repeatedly shrinking digits to force them into dense passages.
- Precompute positions for the page's eligible labels. Playback and selection may change emphasis or visibility without relocating labels.

### Chords and ambiguous notation

Use proven visual chord grouping, together with musical onset and hand information, to build a stack. Preserve the vertical order of the corresponding noteheads, including for left-hand chords; do not sort by finger number. Simultaneous notes with independent stems are not automatically one chord stack merely because they share `moment_id`.

Treat each stack as one collision object and retain a digit-to-note mapping for later editing. In the initial implementation, suppress an unsupported or partially unlinked stack rather than silently presenting a misleading complete-looking chord. Document supported and unsupported cases in the evaluation report.

Cross-staff, interleaved voices, unisons, and unusually dense chords must appear in the challenge set. Where associations or lane ownership are unclear, report the reason and suppress the affected labels until an explicit rule is validated.

## 5. Task breakdown

Tasks 01–10 are implemented within the narrowed clean-score experiment; noisy-scan
coverage and target-webview acceptance are not claimed. Tasks 11–13 are pending.
Sizes are relative engineering effort, not delivery commitments: S = small localized work, M = several connected changes, L = substantial algorithm or cross-layer work. OCR work is intentionally unestimated until evaluated separately.

### Task 01 — Establish fixtures and a baseline review procedure

**Size:** M. **Dependencies:** none. **Deliverable:** a small versioned fixture manifest and review checklist.

- Select roughly 12–20 representative pages/passages, including clean sparse notation, dense beamed runs, high ledger notes, slurs/octave lines, chords, tight system spacing, cross-staff passages, and noisy/skewed scans.
- Include both unmarked and already-fingered examples. The two conversation screenshots are useful visual references; obtain matching source artifacts or explicitly identify manually anchored crops before treating them as alignment fixtures.
- Reuse suitable existing local evaluation scores. Record source/licensing and avoid adding bulky duplicates unnecessarily.
- Keep images, MusicXML, visual sidecars, and fixed fingering values matched. Freeze predictions for layout comparisons so model changes do not confound the experiment.
- Reserve some pages as a held-out review set before tuning thresholds.
- Mark representative safe/unsafe placement regions and cases where no sensible space exists. Exact professionally engraved coordinates are not required.

**Acceptance:** every fixture has a documented purpose and consistent coordinate dimensions; a reviewer can distinguish association errors, layout errors, and unavoidable lack of space.

### Task 02 — Define the fingering value boundary and preserve provenance

**Size:** M. **Dependencies:** none. **Deliverable:** a value resolver and documented storage contract.

- Separate generated predictions from imported/source fingerings and future user overrides.
- Preserve raw source fingering text and attributes even when unsupported; the initial renderer may support only single values 1–5.
- Define eventual precedence as explicit user override, then source fingering adopted by the user, then prediction. Raw unconfirmed OCR candidates never enter this chain automatically.
- Capture source annotations before prediction annotation modifies MusicXML. Recognize the existing generated-cache marker during migration; recover from original page artifacts where available and otherwise record unknown provenance.
- Distinguish display suppression from a missing finger value. Suppressing a score label must not remove its keyboard fingering.
- Keep future manual position adjustments separate from finger values and prediction caches.

**Acceptance:** prediction regeneration does not destroy preserved source data; generated cache values are not relabeled as editorial fingerings; existing keyboard output is unchanged for prediction-only documents.

### Task 03 — Export physical staff geometry and define compatibility

**Size:** M. **Dependencies:** Task 01. **Deliverable:** producer and consumer support for optional annotation geometry.

- Extend the HOMR output with physical staff identifiers, five staff-line polylines or sampled curves, horizontal extent, and local spacing in original source-image coordinates.
- Reuse the producer's coordinate transform, including crop and resize handling. Include sufficient extent information to derive system ownership and neighboring-system boundaries.
- Prefer an additive optional field if it fits the project's schema policy. If a new schema version is required, update producer, worker validation, TypeScript types, evaluator, documentation, and compatibility handling together.
- Validate finite coordinates, ordered staff lines, plausible spacing, and referenced staff identities.
- Old sidecars remain usable for normal viewing and keyboard fingerings. If staff geometry is absent, report overlay unavailability and allow targeted regeneration; do not invent note links or silently require all scores to be reprocessed.
- Define the artifact capability/cache key so a cached v3 page without new geometry is not treated as overlay-ready.
- Update the viewer's HOMR dependency/release packaging as needed so the producer change actually ships with the consumer.

**Acceptance:** staff curves align on clean, resized, cropped, and skewed fixture pages; old artifacts load safely; normal sidecar link consistency checks continue to pass.

### Task 04 — Build and validate the page-ink obstacle map

**Size:** M. **Dependencies:** Tasks 01 and 03. **Deliverable:** immutable obstacle queries plus an optional debug visualization.

- Verify original page pixels can be read from the current image URL in the target Tauri webview. Check origin restrictions and page-memory cost before choosing browser-side processing.
- Convert to luminance and test global versus local thresholding on the fixture set. Select the simplest method that retains thin notation on imperfect scans.
- Add a conservative clearance margin. Use binary dilation and/or rectangle occupancy queries with expanded label bounds; calibrate the combined margin rather than accidentally double-counting it.
- Use an integral image or equivalent bounded-cost query structure. If downsampling, preserve foreground conservatively so thin lines cannot disappear.
- Record the transform from mask pixels to page-image coordinates explicitly.
- Keep processing off the playback/interaction path. Release temporary full-resolution pixel buffers and bound cached pages.
- If browser processing is unsuitable, add a versioned mask artifact to the Python worker and existing native artifact transport instead.

**Acceptance:** representative beams, thin slurs, printed digits, and staff lines remain obstacles; non-square scaling is handled explicitly; toggling overlays does not contaminate the mask; processing location and measurements are documented.

### Task 05 — Map predictions to page label requests

**Size:** M. **Dependencies:** Tasks 02 and 03. **Deliverable:** a pure request-building function.

- Centralize conversion between page-local sidecar IDs and document-scoped prediction IDs using the actual MusicXML merge convention.
- Include page identity, linked note ID, onset/chord identity, physical staff, hand, value source, note anchor, and staff spacing in each request.
- Exclude diagnostics and explicitly unlinked notes; distinguish unavailable predictions from unsupported layout cases.
- Handle repeated playback events and ties without creating duplicate printed labels for the same physical note. Preserve the mapping already used by playback where relevant.
- Build chord stacks only when geometry and musical association support them. Retain digit-to-note mapping.

**Acceptance:** repeated local IDs on different pages cannot exchange predictions; every digit has one authoritative printed-note association; diagnostics and unsupported stacks are reported rather than guessed.

### Task 06 — Implement constrained candidate placement

**Size:** L. **Dependencies:** Tasks 04 and 05. **Deliverable:** deterministic placement results with suppression reasons.

- Measure text bounds using the selected font, including full chord stacks, before generating candidates.
- Generate staff-relative candidates near the note's x position, with bounded horizontal shifts, fixed clearance, and bounded vertical lanes.
- Reject page/system boundary violations, printed-ink collisions, other reserved overlay regions, and minimum-size violations.
- Begin with short onset sequences or measure-local groups. Use MusicXML beam groups only when available and trustworthy; do not require visual beam classification for obstacle avoidance.
- Optimize candidate choices across neighboring requests, for example with a small dynamic program for monophonic runs and bounded search for interacting stacks.
- Penalize distance from anchors, excessive baseline changes, and unnecessary suppression. Collision and boundary constraints remain hard constraints rather than weak penalties.
- Include a suppression candidate and a deterministic tie-break order. Avoid page-wide searches and the existing pitch-label fallback that permits notation overlaps.

**Acceptance:** synthetic cases cover beams, a slur crossing a preferred lane, adjacent digit collisions, a tall chord stack, and a passage with no legal space. Identical inputs produce identical positions and reason codes.

### Task 07 — Produce a visual prototype and make the feasibility decision

**Size:** M. **Dependencies:** Tasks 01 and 06. **Deliverable:** review images, metrics, and a short experiment report.

- Render overlays on the fixture pages with the actual intended font and page transform.
- Produce paired views with and without annotations, plus debug views of obstacles, candidate regions, and suppressed requests.
- Review at normal reading size and at the viewer's common zoom levels. Check digit-to-note association, smoothness of rows, chord order, and existing printed marks.
- Report coverage and quality separately for simple, dense, chord, scanned, and unsupported cases. Use the held-out subset after tuning.
- Record performance and peak working memory on a named reference device.
- Decide whether to proceed, narrow supported notation, or improve the placement model. Add semantic recognition only if specific recurring failures demonstrate that geometry and ink are insufficient.

**Acceptance:** the report applies the gates in Section 7 and lists unresolved examples. Viewer integration is justified by demonstrated readable coverage rather than a collision metric alone.

### Task 08 — Integrate the independent score overlay

**Size:** M. **Dependencies:** Task 07 passes. **Deliverable:** an experimental viewer feature.

- Add a score fingering toggle independent of the keyboard and selected/highlighted keys. Default it off during the experiment.
- Pass resolved values and layout results to the SVG layer in `DocumentViewer.tsx`; keep heavy computation outside render callbacks.
- Use the page's coordinate transform so page centering, pan, zoom, and resizing preserve alignment.
- Wait for font readiness before final placement. Cache against image/geometry content, values, font metrics, policy, and layout algorithm version.
- Reuse existing prediction loading/failure status and expose a concise overlay-specific unavailable state for missing geometry or image analysis failure.
- Compute positions for the complete supported page set, then filter visibility if a later active-passage mode is added. Playback changes emphasis only.
- Keep note selection, gestures, and pitch-label inspection usable. Define coexistence with pitch labels so they do not cover fingering digits; suppression is acceptable where the inspection layer needs space.
- Keep static labels non-intercepting for pointer events and expose the effective value/source through the selected-note inspector for accessibility.

**Acceptance:** labels display with the keyboard hidden, work before and during playback, remain aligned at zoom extremes, and do not interfere with selection or scrolling.

### Task 09 — Add manual policy for already-fingered scores

**Size:** M. **Dependencies:** Task 08. **Deliverable:** persistent score/page/region suppression controls.

- Provide a document-level overlay setting and page exclusions. Make clear that existing printed fingerings are not automatically recognized.
- Add a simple region-exclusion interaction if page-level control is too coarse for the fixture examples: draw a rectangle, preview affected labels, remove it, and undo the last change.
- Store exclusions in original page coordinates, associated with document and raster identity. Define whether a rectangle suppresses by note anchor; prefer this stable rule over suppressing only whatever current label happens to intersect it.
- Save document policy outside disposable prediction/recognition caches. Avoid using a session job ID as persistent document identity.
- Invalidate or flag geometric exclusions when the page raster/crop changes; do not silently apply rectangles to a different coordinate system.
- Keep keyboard fingerings available in excluded passages. Hiding the overlay is a presentation choice, not a value override.

**Acceptance:** settings survive reopening the same document, never leak to another PDF, and work on a score with only a few printed fingerings. Deleting an exclusion restores eligible labels.

### Task 10 — Bound processing cost and handle lifecycle failures

**Size:** M. **Dependencies:** Tasks 08 and 09. **Deliverable:** measured, bounded annotation lifecycle.

- Prioritize visible pages and a small look-ahead window. Bound obstacle and layout caches; evict off-screen artifacts without losing persistent policy.
- Cancel or disregard stale results after document switches, page retries, changed values, or geometry regeneration.
- Invalidate only what changed: a color/highlight change must not rebuild image analysis; a region-policy change can reuse the obstacle map.
- Keep worker failures local to annotations. The score, playback, and keyboard remain available.
- Measure UI responsiveness and memory with multi-page and dense-score fixtures; choose cache limits from measurements.

**Acceptance:** no synchronous mask/layout rebuild occurs on playback ticks or pan/zoom; switching documents cannot display stale labels; long documents have bounded annotation memory.

### Task 11 — Validate and document the experimental release

**Size:** M. **Dependencies:** Tasks 08–10. **Deliverable:** verified feature, limitations, and updated usage documentation.

- Add meaningful regression tests for identity mapping, source preservation, mask coordinate transforms, chord ordering, collision suppression, and cache invalidation.
- Extend component coverage for keyboard-hidden display, unavailable/failed states, and selection coexistence.
- Register any new test files in the current explicit `webapp/package.json` test command.
- Run `npm test` and `npm run build` in `webapp/`. Run affected worker pytest checks and HOMR sidecar/evaluator checks when those components change; run native checks if commands/artifact transport changed.
- Repeat the held-out visual review with the integrated SVG renderer and target webview, including touchscreen gestures where supported.
- Document the default-off toggle, manual exclusions, suppression behavior, and unsupported notation. Record measured results and remaining gaps in a companion experiment report.

**Acceptance:** relevant checks pass, visual review meets the agreed gate, and supported behavior and limitations are explicit. Do not enable the feature by default solely because technical tests pass.

### Task 12 — Add user finger-value overrides after the overlay is stable

**Size:** L. **Dependencies:** Tasks 02 and 11. **Deliverable:** persistent user editing shared by score and keyboard.

- Let users select a note or a digit in a stack and choose 1–5, reset to the underlying source/prediction, or hide its score annotation separately.
- Apply explicit user values through the shared resolver so the keyboard and score agree.
- Store edits outside regenerated MusicXML caches with undo support. Bind them to document content and an annotation revision.
- Define reconciliation across OMR regeneration. Preserve exact matching IDs only when their identity remains valid; mark ambiguous edits for review rather than guessing from pitch or nearest x position.
- Permit optional staff-space position adjustments as a separate follow-up within this phase. Validate adjustments against collision rules or clearly mark manual exceptions.
- Treat an override as a local value edit initially. Recomputing surrounding fingering predictions under hard constraints requires separate model capability work.

**Acceptance:** edits survive reopen and prediction refresh, can be reset, and never silently transfer to a different note after recognition changes.

### Task 13 — Evaluate recognition of printed fingerings as a separate extension

**Size:** Research task; estimate after dataset preparation. **Dependencies:** Task 11; Task 12 before adopting recognized values into the editing workflow. **Deliverable:** a measured recommendation, not automatic adoption by default.

- Prepare annotated crops spanning piano digits 1–5, different fonts, stacked chords, sparse markings, and scans. Include negatives such as triplet numbers, measure numbers, octave indications, and unrelated text.
- Evaluate existing OMR symbol recognition, constrained OCR, and any available PDF text positions before considering custom model training. Vector PDF text extraction is only an optional candidate source; many PDFs contain outlines or scanned images.
- Evaluate three problems separately: locating a marking, transcribing it, and associating it with the correct note. A correctly recognized digit with the wrong note is still an error.
- Check piano coverage explicitly when evaluating Audiveris; the documentation referenced below describes guitar-oriented fingering and is not proof of reliable 1–5 piano recognition.
- Propose detected values for user confirmation with source crop, note association, and confidence. Never silently replace user overrides.
- Treat recognition and visual replacement as separate decisions. Even a confirmed value may need the printed region excluded to avoid duplicate instructions.
- Require new evidence before attempting printed-digit erasure or background reconstruction. Overlap with notation and textured paper make replacement a separate image-editing problem.

**Acceptance:** report precision/recall for digit detection and correct note assignment separately, review hard negatives, and define a confirmation workflow. Train a custom model only if measured existing-tool limitations justify the data and maintenance cost.

## 6. Milestones and execution order

| Milestone | Tasks | Outcome |
| --- | --- | --- |
| A. Data foundations | 01–05 | Reproducible fixtures, preserved values, staff geometry, obstacle map, linked requests. |
| B. Feasibility gate | 06–07 | Actual page overlays and a measured decision about supported coverage. |
| C. Usable experiment | 08–11 | Opt-in viewer feature with manual exclusions and verified lifecycle behavior. |
| D. Personalization | 12 | Durable user overrides shared by score and keyboard. |
| E. Optional recognition | 13 | Evidence for or against adopting printed fingerings automatically. |

The critical sequence is staff geometry and obstacle analysis → linked requests → constrained layout → visual review → viewer integration. Tasks 01 and 02 are independent prerequisites; task ordering does not require parallel agents. Finish the bounded placement experiment before committing to OCR or a general engraving system.

## 7. Evaluation and decision gates

Track these denominators explicitly:

- All predicted pitched notes on each page.
- Notes with authoritative usable visual links.
- Notes supported by the current layout rules before user exclusions.
- Notes remaining after explicit score/page/region exclusions.
- Digits successfully displayed, automatically suppressed, or unavailable, with reason counts.

Report end-to-end coverage against all relevant predicted notes as well as placement coverage against supported, non-excluded requests. Do not improve reported coverage by silently removing difficult cases from the denominator. Count individual digits and chord stacks separately where helpful.

Provisional experiment gates, to be confirmed against the baseline fixtures rather than treated as measured results:

| Dimension | Initial target |
| --- | --- |
| Printed-note association | No known incorrect digit-to-note association in the reviewed set. |
| Collisions | No visible overlap with printed notation or other digits in reviewed output. Check actual rendered images as well as the algorithm's own mask. |
| Legibility | A reviewer can read digits and identify their associated notes at normal reading size without relying on debug connectors. |
| Ordinary-page coverage | At least 90% of supported, non-excluded requests placed on clean ordinary pages, with end-to-end coverage also reported. |
| Dense passages | Report separately; prefer clear omissions to tiny, distant, or colliding labels. Decide supported scope from examples, not one aggregate percentage. |
| Stability | Identical positions across repeated loads with identical inputs; no layout changes on playback ticks, selection, pan, or zoom. |
| Performance | As an initial budget, target under 500 ms for visible-page analysis plus layout on the named reference device, off the UI thread; no annotation-induced interaction stall above 50 ms. Revise only with documented measurements. |
| Persistence | Exclusions survive reopening; stale geometry and document identity changes cannot silently redirect annotations. |

If sparse/ordinary pages fail, improve the geometry/placement layer before integration. If only dense or unusual notation fails, narrow support and expose omissions. If printed markings are the dominant issue, improve manual exclusions before adding automatic recognition.

## 8. Existing printed fingering options

| Option | Operation | Plan decision |
| --- | --- | --- |
| Disable overlays | User marks a score/page as already fingered; keyboard remains available. | Initial supported option. Detection is manual. |
| Exclude passages | User identifies regions whose note anchors should not receive overlays. | Initial supported refinement in Task 09. |
| Recognize and adopt values | Detect, transcribe, associate, and confirm source digits. | Later Task 13; does not itself solve visual duplication. |
| Ignore and draw over marks | Generate labels without respecting printed fingerings. | Excluded from the polished default; collisions and contradictory instructions are unacceptable. |
| Display only selected passages or edits | Filter a precomputed stable layout to reduce clutter. | Optional follow-up once base placement is validated. |
| Annotation strip | Show aligned fingerings beside an active system or in a separate panel when no local space exists. | Fallback product experiment if suppression is too frequent; requires a separate association/readability review. |
| Re-engraved MusicXML view | Render a new score whose notation and annotations can be spaced together. | Separate viewer mode, not a coordinate solution for the original PDF. |
| Cover confirmed source digits | Mask or reconstruct the printed background, then draw replacements. | Deferred; only after reliable localization and explicit review of overlap/background risks. |

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| No available whitespace | Bounded placement, minimum text size, explicit suppression, optional passage-only display. |
| Ink-free but musically confusing placement | Staff/system ownership, bounded horizontal shifts, group alignment, visual association review. |
| Noisy scans or faint slurs | Conservative masks, scan fixtures, independent rendered-output review. |
| Incorrect or missing OMR geometry | Honor authoritative links, preserve missing/unsupported states, do not repair recognition in the renderer. |
| Staff/hand mismatch in cross-staff writing | Keep physical staff and hand separate; suppress ambiguous cases until supported. |
| Prediction values disagree with printed markings | Manual exclusions initially; provenance and explicit confirmation for later adoption. |
| Prediction refresh destroys source/user values | Independent annotation storage and resolver with tested migration. |
| Note IDs change after regeneration | Revision binding and explicit reconciliation; no silent nearest-note remapping. |
| New geometry is missing from old cached sidecars | Capability detection, backward compatibility, targeted regeneration. |
| Large page analysis affects playback | Worker processing, visible-page priority, bounded caches, stale-result cancellation. |

## 10. Reference material

These references informed the feasibility discussion. Recheck tool capabilities when starting the relevant implementation or recognition task.

- [HOMR visual-sidecar contract](../../homr/docs/source/visual_sidecar.rst): authoritative links, diagnostic candidates, physical staff identity, and repair responsibilities.
- [OpenCV morphological operations](https://docs.opencv.org/4.13.0/d9/d61/tutorial_py_morphological_ops.html): standard building blocks for an ink mask and clearance. This does not provide a complete fingering layout engine.
- [MuseScore element positioning](https://handbook.musescore.org/formatting/positioning-of-elements): collision avoidance and alignment concepts. A new engraved layout cannot be assumed to align with the original PDF.
- [MusicXML fingering element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/fingering/): source notation, placement attributes, alternatives, and substitutions to preserve even when not initially rendered.
- [Audiveris fingering and plucking](https://audiveris.github.io/audiveris/_pages/guides/specific/fingering_plucking/): a candidate existing recognition capability to evaluate separately for piano.

Completion of this document is the planning deliverable. No overlay implementation, schema change, dependency update, or OCR training is implied to have been completed.
