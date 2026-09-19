# Page ink v1

Processing lives in the existing Python worker. Target Tauri canvas pixel access
could not be verified in this environment; native app control is unavailable.
The fallback avoids cross-origin asset readback entirely. No canvas or OpenCV.js
implementation is maintained. The optional `ink_obstacles` artifact is embedded
in the visual sidecar and travels through the existing native JSON transport.

The artifact binds to the original display raster SHA-256. It stores a base64
MSB-first bitset, source and mask dimensions, explicit independent x/y pixel-cell
sizes, threshold and version. Every original pixel with luminance <=220 is ink.
Transparency is composited on white. Integer-cell OR pooling preserves all thin
foreground, including partial edge cells; no interpolating resize, staff removal,
erosion or overlay pixels are involved. Downsampling itself is conservative.

Global thresholding is the initial clean-engraving method. No local-threshold
claim is made for uneven-paper/noisy scans; comparison and validation on genuine
scans remain open. The 220 threshold preserves the faint 200/210-luminance thin
slur/staff tests. This is a supported-scope decision, not scan-validation evidence.

The browser creates a private integral buffer in the annotation worker and queries
whole bounds with one explicit clearance expansion. The artifact contains no
dilation margin, so clearance is not counted twice. Invalid/truncated artifacts
fail locally. Python analysis failure is recorded without failing recognition.

`fingering-mask-measurements.json` records the initial development-fixture run on
an AMD Ryzen 9 5950X (Linux): 116–188 ms per page, 343–465 KiB serialized masks,
8.0–10.9 MiB integral buffers, 126 MiB peak Python process RSS including runtime
and sequential image decoding. This measures mask production only, not layout,
webview responsiveness or total app memory. Full-resolution buffers are local
to one call and are released before the next page. Lifecycle cache limits and
browser-worker failure tests are Tasks 08/10.

Checks: 27 worker tests, geometry/obstacle browser unit tests and production
build. Tests cover one-pixel notation, printed digits, transparent backgrounds,
non-square cells, edge cells, full-box collisions, clearance and malformed data.
