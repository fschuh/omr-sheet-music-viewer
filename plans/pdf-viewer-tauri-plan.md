# HOMR PDF Sheet-Music Viewer Plan

## 1. Product and architecture decisions

Build the viewer as a Tauri 2 desktop application using the existing React/Vite frontend.

Initial release:

- Windows-first desktop application.
- PDF input only; remove individual-image loading.
- Local processing with homr—no uploads or server dependency.
- Process every PDF page and cache its raster image, MusicXML, and visual sidecar.
- Retain the existing note selection, highlighting, raw-shape debugging, and note inspector.
- Support mouse and touchscreen pan/zoom confined to the document surface.
- No inking initially.
- Playback is a second-phase feature built on the same cached data.
- Keep `homr` and `sheet-music-viewer` as separate repositories.

Later targets:

- macOS can use the same Tauri application and packaged Python worker.
- iOS can reuse much of the React UI, but will require remote inference or a native homr port because it cannot launch the Python sidecar.
- Inking remains a later optional capability.

## 2. Repository and dependency structure

Keep the current repositories independent:

```text
music/
├── homr/
└── sheet-music-viewer/
```

Organize the viewer repository as:

```text
sheet-music-viewer/
├── webapp/                   # Existing React/Vite frontend
├── src-tauri/                # Native shell and worker supervisor
└── worker/
    ├── pyproject.toml
    ├── poetry.lock
    ├── sheet_music_worker/
    └── tests/
```

The viewer-owned worker handles:

- PDF rasterization.
- PDF fingerprinting and cache management.
- Page orchestration and progress reporting.
- Calling homr through a small public Python API.
- Producing playback timelines later.

Declare homr as a pinned Git dependency in `worker/pyproject.toml`:

```toml
homr = {
  git = "https://github.com/fschuh/homr.git",
  rev = "<full-commit-sha>"
}
```

Commit the dependency lockfile. Never depend on a moving branch such as `main`.

For local development, override the installed dependency with the sibling checkout:

```powershell
poetry install
poetry run pip install --editable ..\..\homr
```

The editable override is local only; release and CI builds use the locked commit. Do not copy the `homr` package and do not use a Git submodule.

## 3. Public homr API

Add a small, stable programmatic interface to the homr repository:

```python
@dataclass(frozen=True)
class InferenceResult:
    musicxml_path: Path
    visual_sidecar_path: Path
    source_width: int
    source_height: int
    homr_version: str
    model_versions: dict[str, str]


class HomrEngine:
    def __init__(
        self,
        model_directory: Path,
        *,
        gpu_mode: GpuSupport = GpuSupport.AUTO,
    ) -> None: ...

    def process_image(
        self,
        image_path: Path,
        output_directory: Path,
        *,
        output_stem: str,
        visual_sidecar: bool = True,
    ) -> InferenceResult: ...
```

Implementation requirements:

- Preserve the existing `homr` CLI by making it call this API.
- Allow outputs to be written to an explicit directory instead of beside the source image.
- Make model storage configurable rather than writing beside installed Python modules.
- Reuse segmentation and transformer ONNX sessions across pages.
- Report homr, model, and visual-sidecar schema versions.
- Continue emitting diagnostic logs to stderr.
- Disable teaser/debug-image generation unless explicitly requested.
- Ensure tokenizer JSON files are included as package resources.
- Add tests confirming the CLI produces equivalent outputs through the new API.

This interface should be kept small enough to propose upstream.

## 4. Tauri and worker boundary

Tauri owns the privileged boundary. The React renderer must not receive general shell or filesystem access.

Expose a narrow frontend API:

```ts
interface NativeViewerApi {
  choosePdf(): Promise<string | null>;
  openPdf(path: string): Promise<string>;
  cancelJob(jobId: string): Promise<void>;
  retryPage(jobId: string, pageIndex: number): Promise<void>;
  subscribeToJobEvents(
    callback: (event: WorkerEvent) => void,
  ): Promise<Unsubscribe>;
}
```

Rust responsibilities:

- Show the native PDF file dialog.
- Resolve the application cache and model directories.
- Start and monitor one long-lived worker.
- Forward validated commands to the worker.
- Parse structured worker events.
- Forward progress events to React.
- Capture worker stderr as logs.
- Cancel or terminate a failed worker.
- Restart it after a crash.
- Permit only one active PDF-processing job.

Use newline-delimited JSON over stdin/stdout:

```json
{"protocol":1,"id":"request-1","method":"process_pdf","params":{"pdfPath":"...","cacheRoot":"...","modelRoot":"..."}}
```

Worker events:

```json
{"type":"hello","protocol":1,"homrVersion":"..."}
{"type":"job_started","jobId":"...","pageCount":12,"cacheStatus":"partial"}
{"type":"page_started","jobId":"...","pageIndex":0}
{"type":"page_completed","jobId":"...","pageIndex":0,"artifacts":{...}}
{"type":"page_failed","jobId":"...","pageIndex":1,"error":{...}}
{"type":"job_completed","jobId":"...","status":"complete"}
```

Protocol rules:

- stdout contains protocol messages only.
- stderr contains human-readable logs.
- Include a protocol-version handshake.
- Reject incompatible worker versions.
- Cancellation is cooperative between pages; force cancellation may terminate and restart the worker.
- Page failures do not stop processing later pages.

## 5. Development and packaging

Configure Tauri development to load Vite:

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../webapp/dist"
  }
}
```

Development workflow:

```powershell
npm run tauri dev
```

Behavior:

- React and CSS changes use Vite HMR without restarting Tauri.
- Rust changes trigger an incremental rebuild and application restart.
- Python changes require restarting only the worker.
- Provide a development command for restarting the worker without closing the application.

Release workflow:

- Package the Python worker, interpreter, homr, OpenCV, ONNX Runtime, and dependencies with PyInstaller.
- Prefer a one-folder worker build for dependable native-library loading and faster startup.
- Bundle that directory with the Tauri application and register the executable as a sidecar.
- Build the worker separately for each operating system and architecture.
- Pin and record the homr commit in the application’s About/diagnostic information.

For v1, download model files on first use into the Tauri application-data directory and show explicit initialization progress. Validate downloads using known SHA-256 hashes. Do not write models inside the installed application bundle.

## 6. PDF processing and cache

Use `pypdfium2` in the Python worker to rasterize PDFs.

Rasterization defaults:

- 300 DPI.
- Preserve the PDF page’s effective rotation.
- White background.
- PNG output.
- Render and process pages sequentially to limit memory use.
- Use the exact cached PNG for both homr inference and viewer display, guaranteeing coordinate alignment.

Cache location:

```text
<Tauri app data>/
├── models/
└── pdf-cache/
    └── <pdf-sha256>/
        ├── manifest.json
        └── pages/
            ├── 0001.png
            ├── 0001.musicxml
            ├── 0001.homr.visual.json
            ├── 0002.png
            ├── 0002.musicxml
            └── 0002.homr.visual.json
```

Manifest content:

```json
{
  "schemaVersion": 1,
  "pdfSha256": "...",
  "pdfByteLength": 123456,
  "pageCount": 2,
  "homrVersion": "...",
  "homrCommit": "...",
  "modelVersions": {},
  "visualSidecarCacheRevision": 1,
  "rasterizer": {
    "name": "pypdfium2",
    "version": "...",
    "dpi": 300,
    "background": "white"
  },
  "pages": [
    {
      "index": 0,
      "status": "complete",
      "width": 2550,
      "height": 3300,
      "image": "pages/0001.png",
      "musicxml": "pages/0001.musicxml",
      "visualSidecar": "pages/0001.homr.visual.json",
      "checksums": {}
    }
  ]
}
```

Cache behavior:

1. Hash the PDF contents; filenames and source paths are not cache identities.
2. Load and validate the manifest.
3. Invalidate the cache if the PDF, raster settings, homr version, model versions, or sidecar schema changes.
4. Reuse complete valid pages from a partial cache.
5. Reprocess missing, corrupt, or failed pages only.
6. Validate artifact existence, nonzero size, JSON/XML readability, and recorded checksums.
7. Write artifacts to temporary files and atomically rename them on success.
8. Preserve partial results if processing is cancelled or the application crashes.
9. A second open of the same unchanged PDF must not invoke homr.
10. A changed PDF at the same path creates a new hash-based cache entry.

Do not implement automatic cache eviction in v1. Add cache-size reporting and cleanup controls later.

## 7. Core PDF viewer UI

Replace `SheetViewer` with a multi-page `DocumentViewer`.

Layout:

```text
Application toolbar — fixed
├── Open PDF
├── Document name
├── Cache/inference status
├── Progress and Cancel
└── Zoom/Fit controls

Workspace
├── Document stage — pan/zoom surface
│   ├── Page 1 image + SVG overlay
│   ├── Page 2 image + SVG overlay
│   └── ...
└── Inspector — fixed
```

Viewer behavior:

- Display pages vertically with stable gaps and placeholders.
- Show a page as soon as its cached or inferred artifacts are available.
- Lazy-load offscreen page images and overlays while preserving page dimensions.
- Use a shared document transform for the page stack.
- Keep the toolbar and inspector outside the transformed surface.
- Use `touch-action: none` only on the document stage.
- Support cursor-centered wheel zoom.
- Support two-finger pinch zoom around the gesture midpoint.
- Support one-pointer pan and click-versus-drag tolerance.
- Provide Reset, Fit Width, and Fit Page actions.
- Prevent browser-level pinch zoom from affecting the whole UI.
- Maintain overlay coordinates in each page image’s native pixel coordinate space.

State identifiers must be page-scoped:

```ts
interface VisualGroupRef {
  pageIndex: number;
  visualGroupId: string;
}
```

Preserve current controls:

- Highlight all notes.
- Original notehead contours.
- Detected notehead contours.
- Refined notehead contours.
- Raw stem contours.
- Selected visual-group ID.
- Linked MusicXML IDs.
- Pitch, duration, measure, staff, and voice.
- Match confidence and unmatched-note counts.
- MusicXML and sidecar sizes/counts.

Behavioral details:

- Clicking a note highlights its complete chord/stem group as today.
- Selection and debug settings persist while navigating pages.
- Opening another document clears selection and resets the viewport.
- Failed pages show an error placeholder with Retry.
- A partial document remains usable while other pages are processing.

## 8. Playback phase

Implement playback only after the PDF inference/cache viewer is stable.

Generate a cached document-level `playback.json` from the per-page MusicXML and visual sidecars.

Timeline representation:

```json
{
  "schemaVersion": 1,
  "defaultTempo": 120,
  "events": [
    {
      "startQuarters": 0,
      "durationQuarters": 0.25,
      "midiPitches": [67, 71],
      "pageIndex": 0,
      "systemId": "page-0-system-0",
      "musicXmlIds": ["homr-note-1", "homr-note-2"],
      "visualGroupIds": ["vnote-42", "vnote-43"],
      "x": 384.2
    }
  ]
}
```

Timeline builder:

- Parse the controlled MusicXML subset generated by homr.
- Support divisions, durations, chords, voices, staves, backups, forwards, rests, tuplets, pitches, accidentals, and basic ties.
- Scope MusicXML IDs by page.
- Concatenate page timelines in PDF order.
- Store time in quarter-note units so BPM can change dynamically.
- Use a default 120 BPM when no explicit tempo is present.
- Initially play measures linearly and ignore repeat expansion.
- Do not add Verovio initially; revisit it if full MusicXML playback semantics become necessary.

Audio:

- Use Web Audio with a compact, permissively licensed piano sample set.
- Repitch nearby samples for intermediate notes.
- Schedule audio slightly ahead using `AudioContext.currentTime`.
- Treat the audio clock—not React timers—as the playback source of truth.
- Require a user gesture before starting audio.
- Later consider `spessasynth_lib` if General MIDI/SoundFont support is needed.

Playback UI:

- Play/Pause.
- Stop.
- BPM control.
- Seek position.
- Current page/system indication.
- Active-note highlighting distinct from clicked-note selection.

Playhead support requires visual-sidecar schema v2:

```json
{
  "systems": [
    {
      "systemId": "system-0",
      "readingOrder": 0,
      "bbox": [180, 290, 1620, 620],
      "barlines": [180, 530, 920, 1280, 1620]
    }
  ]
}
```

Each visual group should reference a `systemId`.

Playhead behavior:

- Cluster simultaneous notes into visual columns.
- Interpolate the vertical playhead between time/X anchors.
- Span the system bounding box vertically.
- Use barlines to improve positioning across rests.
- Move to the next system when its first event begins.
- Scroll the new system into view only at system/page transitions.
- Play unmatched MusicXML notes without visual highlighting.
- Continue visual movement through sparse passages using surrounding anchors.

## 9. Inking and native platform features

Inking is explicitly excluded from the initial release.

Preserve future compatibility by:

- Keeping all interaction coordinates in page-image space.
- Using Pointer Events rather than mouse-only events.
- Separating note/debug overlays from any future annotation layer.
- Reserving an independent per-page annotation overlay.

If inking is added later:

1. Start with cross-platform Pointer Events, pressure data, coalesced samples, and a mature stroke-rendering library.
2. Feature-detect the Web Ink API on Windows for lower-latency wet ink.
3. Validate on real Surface and Apple Pencil hardware.
4. Add native Windows Ink or PencilKit plugins only if the web implementation is demonstrably inadequate.

Do not switch to Electron for inking; Electron does not make native Windows `InkCanvas` integration materially easier and cannot target iOS.

## 10. Platform roadmap

### Windows v1

- Tauri/WebView2.
- Bundled Python worker.
- CPU and supported GPU inference through homr’s existing provider selection.
- Native file dialog.
- Local cache and first-run model download.
- Touchscreen viewer validation on actual Windows hardware.

### macOS desktop

After Windows stabilization:

- Build the worker for Apple Silicon and Intel if required.
- Use the same Python protocol and cache format.
- Store models/cache in the macOS application-data directory.
- Test WKWebView gesture behavior.
- Sign and notarize the application and all bundled native libraries.
- Exercise homr’s CoreML options separately from the UI.

### iOS/iPadOS

Not part of the desktop v1:

- Reuse the React viewer and backend interface where practical.
- Store imported PDFs and caches inside the application sandbox.
- Replace the local Python worker with either:
  - remote homr inference, or
  - a future native ONNX/Core ML port.
- Use PencilKit only if native inking becomes a core requirement.

## 11. Testing strategy

### Homr repository

- Public API produces the same MusicXML as the CLI.
- Visual-sidecar output remains coordinate-correct.
- Model-directory override works in read-only installation scenarios.
- Segmentation and transformer sessions are reused.
- CPU/GPU provider selection remains correct.
- Package builds include tokenizers and required resources.

### Worker unit tests

- Deterministic PDF fingerprinting.
- PDF rotation and raster dimensions.
- Manifest creation and parsing.
- Complete cache hit.
- Partial cache resume.
- Homr/model/raster-setting invalidation.
- Missing or corrupt artifact recovery.
- Atomic output writes.
- Worker handshake and protocol errors.
- Cooperative cancellation.
- Per-page failure with later-page continuation.
- Worker restart after failure.

Mock `HomrEngine` in worker tests so routine tests do not load models.

### React tests

- Page-scoped note IDs.
- Sidecar-to-overlay mapping.
- Selection and chord highlighting.
- Debug-layer toggles.
- Page progress and error states.
- Multi-page transform mathematics.
- Cursor-centered zoom.
- Pinch midpoint preservation.
- Click-versus-drag handling.
- Cache-hit versus processing states.

### Integration tests

Use checked-in small fixtures:

- One-page PDF.
- Three-page PDF.
- Rotated page.
- Mixed page sizes.
- PDF with one deliberately failed page.
- PDF with known chords and multiple staves.
- Corrupt cache manifest.

Acceptance scenarios:

1. Opening an uncached PDF processes every page and progressively displays results.
2. Opening the same PDF again loads entirely from cache without inference.
3. Changing PDF contents at the same path creates a new cache.
4. Cancelling preserves completed pages and resumes later.
5. Clicking notes on any page shows correct MusicXML metadata.
6. Pinch zoom changes only the document, not application chrome.
7. Debug overlays align at every supported zoom level.
8. A failed page can be retried without reprocessing successful pages.
9. Worker crashes do not crash the Tauri UI.
10. Closing the app terminates the worker.

Playback tests later add:

- Chords and simultaneous voices.
- Backups/forwards.
- Rests and ties.
- Cross-page concatenation.
- Highlight synchronization.
- Playhead system transitions.
- Audio/UI clock drift tolerance.

## 12. Delivery order

1. Add and test the public `HomrEngine` API.
2. Add configurable model/output directories and session reuse.
3. Create the viewer-owned Python worker and NDJSON protocol.
4. Implement PDF rasterization, manifests, and resumable caching.
5. Scaffold Tauri and the Rust worker supervisor.
6. Replace manual file selection with the native PDF workflow.
7. Refactor the single-page component into `DocumentViewer`.
8. Restore all existing note/debug controls across multiple pages.
9. Add touch-focused document zoom and page virtualization.
10. Package the Windows worker and validate a clean installation.
11. Add CI, fixtures, cache integration tests, and license notices.
12. Stabilize the core Windows release.
13. Implement playback timeline, piano audio, highlighting, and playhead.
14. Add macOS packaging and validation.
15. Evaluate iOS inference and inking as separate future projects.

## 13. Explicit assumptions

- The first release targets Windows.
- PDFs are processed locally and sequentially.
- Internet access is available for first-run model download.
- Cached PNGs—not live PDF vectors—are the initial display source.
- Per-page MusicXML remains the canonical inference output.
- No combined multi-page MusicXML is required initially.
- No inking, handwriting recognition, or native InkToolbar is included initially.
- Playback follows linear page order initially and does not expand repeats.
- The repositories remain separately versioned.
- The viewer pins an exact homr commit and never silently tracks upstream.
- Distribution will comply with homr’s AGPL licensing and include required notices/source availability.
