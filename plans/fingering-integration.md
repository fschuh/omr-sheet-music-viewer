# Viewer integration verification

Task 08 (2026-09-19): the independent, persisted global score toggle defaults off.
The page-coordinate SVG uses the same `ScoreFingeringLayer` as the visual review.
Its static digits do not intercept pointer events. Inspection rectangles hide an
intersecting stack temporarily, never alter its layout. Selected-note text exposes
the prediction value independently of the debug panel and keyboard.

Font readiness precedes canvas measurement and worker placement. Worker errors and
15-second timeouts remain annotation-only. Changing the input generation immediately
hides old results and terminates its worker. Detailed cache bounds and visible-page
priority are Task 10; this first integration processes complete pages sequentially.

Validation: `npm test`, `npm run build` pass. Component regressions cover default-off
fallback, unavailable local storage, non-intercepting rendering without a keyboard,
ordered chord digits, inspection suppression and unchanged positions. Production
Vite output includes the separate fingering worker. All 14 usable fixture pages were
rendered three times with the production SVG component: 3,847 digits, stable bounds,
zero blue pixels overlapping original dark notation. Chopin 25/9 was visually
rechecked. Values remain synthetic fixed layout fixtures, not model-quality claims.

Full application interaction, target Tauri webview and touchscreen checks remain
Task 11 acceptance work; Chromium component rendering is not evidence for those.
`WebKitWebDriver` is not installed on this reference host.

## Task 09 — manual exclusions

The disclosure below the global toggle offers PDF-wide hiding, page hiding,
rectangle drawing, individual removal and a 20-change session undo history.
Rectangle previews mark the affected note anchors. Finish drawing restores the
page's ordinary pointer handling. A partially excluded chord is hidden as a whole.
Exclusions filter a precomputed layout without shifting neighboring labels or
altering keyboard values. A changed raster disables only its old rectangles and
shows a review warning; page/PDF hiding remains meaningful across regeneration.

Policies are stored in webview local storage under `homr.fingering-policy.v1.<PDF
SHA256>`, outside recognition/prediction caches. The validated SHA comes from the
worker cache directory identity, never the session job ID. Invalid stored data is
not overwritten and disables annotations pending recovery; write failures are
reported while session changes remain usable. Local storage is app-profile-local,
not a cloud backup. Removing the app profile also removes these preferences.

Validation: full web tests/build pass, including content identity isolation,
serialization, malformed data, stale raster rejection, anchor-based chord hiding,
restoration and unchanged values/positions. The headless Chromium integration test
uses the real `DocumentViewer`, drawing layer, policy hook and controls on Chopin
25/9: PDF disable/undo, pointer drawing (175 → 174 stacks), PDF switching, reload
persistence and removal/restoration pass. Its final screenshot was inspected.

Reproduce after preparing the Task 07 fixtures:

```sh
webapp/node_modules/.bin/esbuild webapp/tools/fingering-controls-review.tsx --bundle --format=esm --minify '--define:process.env.NODE_ENV="production"' --outfile=testdata/fingering-prototype/controls.js
node tools/fingering-render.mjs --controls
```

The browser test uses an isolated temporary profile with test-only PDF identities;
it does not modify the user's saved app policies.

## Task 10 — bounded lifecycle and measured responsiveness

An IntersectionObserver prioritizes up to three visible pages, with one following
page when capacity allows. The scheduler retains at most three layouts and one
in-flight request; the worker retains at most two ink integrals. Eviction never
touches saved policy. Long scores keep their existing viewer artifacts; these
limits apply to additional annotation processing, not the viewer's total document
memory. Each integral is bounded by a 2049×2049 Uint32 buffer (16.02 MiB); making a
new mask can transiently allocate a third before LRU eviction. Local fixtures use
8.04–10.91 MiB per integral. The repeated-page benchmark reuses one raster/mask.

Unchanged page results survive policy, selection, and viewport updates. Task keys
include the algorithm version, measured font, merge ordinal, per-page musical
structure and effective values, plus immutable sidecar identity. New geometry,
page retries, value changes and document switches reject obsolete results before
rendering; active obsolete work is terminated. Only per-page musical records and
placement-relevant sidecar fields cross the worker boundary. Full curve validation
and all ink/layout processing run in the worker. Startup failure, worker errors
and 15-second timeouts affect annotations only.

Initial profiling found 82–90 ms Chromium `Layerize` tasks when annotations shared
the inspection SVG. Removing debug geometry halved message copying but did not
solve that rendering cost. Annotation SVGs now have their own compositor layer,
with the same source-coordinate viewBox and inspection reservation rules. Only
the bounded set of placed pages gets this layer. CSS page containment experiments
were slower and were not retained.

Reference: Ryzen 9 5950X, Linux, isolated headless Chromium, production React build,
1300×1800 viewport, 20 synthetic repeated Chopin 25/9 pages; not 20 independently
recognized pages or a target-webview/touch-device benchmark. Ten 2500-pixel scrolls
at 250 ms intervals exercised pages 0–17. Two final runs had zero main-thread
long tasks (≥50 ms), as did the overlay-off comparison. The final run retained
pages 15–17, one worker, and three layouts; per-message copying was 4.8–6.9 ms.
Chromium's approximate/quantized main-thread JS heap was 50.4 MB, excluding worker
and compositor memory; this is not a whole-process peak-memory claim. The earlier
Task 07 worker timings cover actual distinct fixture pages.

Validation: full web tests/build pass. Scheduler tests cover a 100-page queue,
bounded eviction, cache reuse, changed values/geometry, stale replies, disposal,
startup failure and timeout. Packet tests prove requests are unchanged after
debug-only fields are omitted. The browser suite now exercises the production
hook/scheduler, asserts policy edits create no worker requests, verifies actual
scroll-driven page priority and eviction, and fails on observed scrolling long
tasks. Optional CPU and rendering traces are written under `/tmp`.

## Task 11 — experimental release verification

Usage and limitations are documented in the README. Missing-capability statuses
now offer an explicit targeted **Regenerate page N** button, including for old
pages whose ordinary recognition succeeded. No automatic cache deletion occurs.

Checks passed on 2026-09-19:

- `npm test` and `npm run build`, including explicit registration of the focused
  fingering tests and component unavailable/error states.
- Worker pytest: 27 passed; HOMR geometry/sidecar pytest: 135 passed plus six
  subtests (five existing dependency/deprecation warnings).
- `cargo test --offline --manifest-path src-tauri/Cargo.toml`: six native tests
  passed; fixture lock verification: 16 matched pages passed.
- Production Chromium interaction: keyboard-absent display, selection, exclusion
  drawing/removal/undo/persistence, identity isolation, zoom stability and an
  emulated two-finger pinch. Neither selection nor zoom/pinch rebuilt placement.
- Installed Linux target engine WebKitGTK 2.52.6: the actual viewer hook, worker
  and separate SVG rendered Chopin 25/9 (175 stacks / 310 digits), with its
  screenshot visually inspected. The isolated GTK Broadway backend required an
  explicit 96 DPI; its invalid default DPI initially produced a blank snapshot,
  which was rejected rather than counted as verification.

All seven usable held-out fixtures were rendered as original/annotated pairs with
the shared production SVG component in WebKitGTK. Repeated bounds were identical;
independent blue-label/original-dark-pixel overlap was zero on every page:

| Held-out page | Placed digits | Supported digits | Worker ms |
| --- | ---: | ---: | ---: |
| Bach invention 13, p2 | 270 | 270 | 93 |
| Bach prelude C, p3 | 149 | 149 | 64 |
| Für Elise, p2 | 318 | 329 | 87 |
| Chopin 25/12, p1 | 236 | 238 | 84 |
| Chopin 25/7, p1 | 250 | 256 | 74 |
| Mozart Allegro, p2 | 348 | 348 | 115 |
| Mozart Rondo, p1 | 332 | 359 | 80 |

Total 1,903/1,949 supported digits (97.64%); 1,903/2,224 predicted digits
(85.57%) on these available pages. WebKit places one fewer Rondo digit than
Chromium because engine-specific measured text bounds differ; this is why font
metrics belong in the layout key. Bach prelude, Mozart Rondo, Chopin 25/7 and
25/12 plus the integrated 25/9 viewer were visually reviewed in WebKit. As before,
the frozen cyclic values measure layout, not fingering-model quality.

Reproduce the engine check with a private `broadwayd` display:

```sh
broadwayd --address=127.0.0.1 --port=8097 :17
GDK_BACKEND=broadway BROADWAY_DISPLAY=:17 WEBKIT_DISABLE_COMPOSITING_MODE=1 /usr/bin/python3 tools/fingering-webkit-review.py
# Add --fixture <prepared-id> --view original/annotated for paired page review.
.venv/bin/python tools/fingering-webkit-metrics.py
```

This is sufficient to continue the default-off clean-score experiment, not an
unqualified cross-platform release claim. The actual packaged Tauri shell on a
physical touchscreen, hardware GPU compositing, other OS webviews, and genuine
noisy/skewed scans remain manual/platform acceptance gaps. No new HOMR dependency
commit has been pushed; publish the pinned producer commit before distributing
a GitHub-based worker installation. Printed-mark adoption/erasure remains absent.
