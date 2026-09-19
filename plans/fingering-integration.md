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
webapp/node_modules/.bin/esbuild webapp/tools/fingering-controls-review.tsx --bundle --format=iife --outfile=testdata/fingering-prototype/controls.js
node tools/fingering-render.mjs --controls
```

The browser test uses an isolated temporary profile with test-only PDF identities;
it does not modify the user's saved app policies.
