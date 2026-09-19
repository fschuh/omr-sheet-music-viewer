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
