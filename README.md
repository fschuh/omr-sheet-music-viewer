# OMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
local HOMR checkout, caches the generated PNG/MusicXML/visual-sidecar artifacts,
merges successfully recognized pages into a document-level MusicXML file, and
overlays recognized note geometry for selection, highlighting, and note-by-note
playback navigation. The merged
file is stored at the PDF cache root using the PDF filename with a `.musicxml`
extension.

The cached page image remains a 300-DPI raster for viewing. Recognition uses a
separate temporary image scaled to HOMR's native 1,920-pixel width with HAMMING
resampling; visual-sidecar geometry is mapped back onto the 300-DPI display image.

After the document-level MusicXML is generated, the app runs the bundled piano
fingering models locally for both hands and adds each prediction as a MusicXML
`<fingering>` technical notation. This first hand-assignment pass treats bass-clef
notes as left hand and treble-clef notes as right hand. During playback, the
keyboard shows the predicted hand and finger above each active note name (for
example, `L5` or `R1`).

After the merged file is ready, **Open MusicXML** delegates it to the operating
system. The configured default application opens it, or the system can prompt
for an application when no association exists.

Playback commands can be triggered from the viewer toolbar, customizable
keyboard shortcuts, or optional MIDI messages. Open **Settings** to reassign a
shortcut: select a keyboard cell and press a key combination, or select a MIDI
cell and send the desired message. Press `Esc` to cancel either capture.
Recognized notes and chords play with polyphonic piano audio while note sounds
are enabled. Use the speaker button or the default `M` shortcut to mute or
unmute them. Tone.js provides sample scheduling, release envelopes, compression,
and peak limiting. **Settings** chooses between two sampled pianos: Splendid Grand
Piano, the default, whose four velocity layers are committed to the repository, and
Salamander Grand Piano, whose sixteen layers are generated into `webapp/public/audio/`
before `npm run dev` or `npm run build` and are not tracked. Provenance, licensing and
the layer mapping for both are recorded in `webapp/public/audio/SOURCES.md`.

The app listens to every standard MIDI input exposed by the operating system.
MIDI assignments are device- and channel-independent, and
the Settings page can rescan inputs after a bridge or device is connected. 
On Windows, BLE MIDI hardware requires a bridge that exposes it as a
standard MIDI port. 
MIDI discovery runs after the viewer opens; if the system MIDI service does not
respond, the viewer remains usable and reports that MIDI controls are disabled
for the session.
Holding an assigned MIDI Note or nonzero Control Change repeats navigation until
the corresponding Note Off or zero-value Control Change arrives. Playback-mode
toggle messages and message types without a release signal remain one-shot.
On Windows, the repeat delay and rate follow the system keyboard settings; other
platforms use a 400 ms delay and 75 ms interval.

Listen mode is opt-in during note-by-note playback. **Settings** selects either
the system-default microphone (the default) or MIDI keyboard input, and remembers
the choice. The microphone path runs the local `online_amt` recognizer: an
AudioWorklet captures 512-sample mono chunks at 16 kHz and a dedicated worker runs
the stateful model through ONNX Runtime Web's single-threaded WASM backend. The
72 MB model is loaded only when microphone listen mode is started. Audio is
analyzed in memory and is never saved or transmitted. MIDI listen mode accepts
Note On/Off messages from every connected input. While it is active, note messages
are reserved for playing the score; Control Change and other MIDI shortcut types
continue to work. Note-message shortcuts work normally outside MIDI listen mode.
An exact fresh note or chord advances the playhead; extra notes prevent advancement.
The original Web Audio FFT and harmonic-sieve implementation remains in the
source tree and in the benchmark page for future experiments, but it is not the
application default.
Normal playhead sounds are suppressed while listening without changing the saved
speaker preference. The audition button or default `P` shortcut explicitly plays
the current chord, including while muted; matching pauses through the sample decay.

Advancement thresholds come from one named matcher profile in the versioned
registry in `webapp/src/listen/listenMatcherProfiles.ts`. Timing, target ordering, and
advancement semantics are identical for every profile, so a profile only
reinterprets model confidence. The shipped default is `baseline-v1`. The frozen
automated confirmation of August 21, 2026 replayed four candidate profiles over
476 recorded traces under both benchmark renderers, repeated the whole matrix in
a second browser process, and rejected all four: each advances an omitted-bass
safety fixture that `baseline-v1` refuses, and none holds the held-out Tone
recognition floors. The decision is `no-safe-candidate`, so the default is
unchanged and no live-instrument corpus was collected for a candidate. Every
historical profile stays in the registry, so changing or rolling back the default
is one edit to `DEFAULT_LISTEN_MATCHER_PROFILE_ID`. The second round's first
measurement, completed August 22, 2026 and correctively remeasured August 23, 2026,
recorded what a bass-onset gate costs on both sides: it is free on the isolated
fixtures and refuses genuine attacks as low as 0.5093 on continuous passages,
while the repeated Course Clear chord is limited on its first attack by an upper
voice the decoder never re-onsets rather than by the bass. Both omitted-bass
failures are now committed regressions. The second round closed on August 25, 2026
with `round-two-grid-produced-no-eligible-improvement`: its three staged grids each
selected profiles that the frozen stop rule then refused for having no material
repeated-chord recovery, so no candidate was registered or confirmed, the default
is unchanged again, and the round's confirmation fixtures stay unspent for a later
round. Its approved-profile list — the only profiles any later calibration may
offer — is exactly `baseline-v1`; registry membership is not approval, because the
registry keeps rejected profiles for rollback and replay. The unresolved decoder
evidence is carried by
`plans/listen-decoder-model-evidence-requirement.md`. With the
debug panel enabled, Settings offers a session-only profile override for hearing a
profile on real input, and the Diagnostics panel names the profile listen mode is
running.

The adapted PitchPlease spectral implementation and its historical benchmark
remain in `webapp/src/vendor/pitchplease/`. The `online_amt` export procedure,
runtime parity checks, WASM configuration matrix, and latest listening benchmark
are recorded in `tools/online_amt/`. To run the instrumented browser benchmark,
start the web development server and open
`http://localhost:5173/?listen-benchmark=1`. It defaults to `online_amt`, while
the spectral implementation has its own comparison button. The benchmark renders
isolated notes and one-to-six-note chords from the bundled piano samples, reports
analysis and onset-to-advance latency, and keeps the acceptance gate fixed at p95
below 400 ms, 95% correct advancement, and zero distinguishable wrong-note false
advances. Automated listening runs keep the historical direct sample mixer and an
app-equivalent Tone.js sampler/compressor/limiter renderer as separately labelled,
side-by-side configurations. The same page records manual acoustic- and
digital-piano trials; those real-input trials are still required before changing
the `online_amt` matcher profile, and no candidate has yet earned them.

## Development

Only the development workflow is described here. The packaged build
(`npm run tauri:build`) has not been exercised yet.

### Prerequisites

- Node and npm, developed against Node 24
- A Rust toolchain, for the Tauri shell
- Python 3.11 or newer, below 3.16
- Poetry 2.x, installed outside the project environment — `pipx install poetry` or
  `uv tool install poetry`

The Python environment must live at the repository root as `.venv`. The Tauri
shell spawns `<repo root>/.venv/bin/python` (`Scripts\python.exe` on Windows) and
runs `python -m sheet_music_worker` with `worker/` as the working directory, so
the location is not configurable — see `src-tauri/src/lib.rs`. A missing
environment surfaces in the app as *"Viewer Python environment not found"*.

### Python environment

Create the environment at the repository root, then install the worker into it with
Poetry. Poetry resolves from `worker/poetry.lock`, so this pins the exact HOMR commit
rather than whatever `main` currently points at:

```bash
python3 -m venv .venv
cd worker
VIRTUAL_ENV=../.venv POETRY_VIRTUALENVS_CREATE=false poetry install --extras cpu
```

Poetry normally provisions its own environment; the two variables point it at the
repository-root `.venv` that the Tauri shell requires instead. On Windows use
`py -m venv .venv` and set `VIRTUAL_ENV` to `..\.venv`.

The commands below use the POSIX layout, `.venv/bin/<command>`. On Windows the
equivalent is `.venv\Scripts\<command>.exe` — `.venv/bin/homr` is
`.venv\Scripts\homr.exe`, and likewise for `pip` and `python`.

`--extras cpu` chooses the inference engine. HOMR exposes `cpu` and `cuda` as mutually
exclusive extras and installs neither by default, because both engines ship the same native
libraries under the same names and an environment holding both runs whichever wheel was
written last. Naming no extra leaves a worker with no ONNX Runtime at all, so one of the two
is always required — see GPU acceleration below for the CUDA path.

pip can install the worker without Poetry, but it ignores the lock and resolves fresh:

```bash
.venv/bin/pip install "./worker[cpu]"
```

### Recognition models

HOMR downloads roughly 151 MB of ONNX checkpoints on first use, into the installed
`homr` package inside `.venv`. They are downloaded again whenever that package is
reinstalled. Fetch them up front so the first recognition does not stall:

```bash
.venv/bin/homr --init --gpu no
```

### GPU acceleration

Inference runs on the CPU by default. HOMR picks an execution provider from what ONNX
Runtime reports at startup, so enabling a GPU means installing the GPU runtime — there
is no flag or setting in the viewer.

**NVIDIA / CUDA.** Choose the `cuda` extra in place of `cpu`. It brings `onnxruntime-gpu`
together with the CUDA and cuDNN wheels it needs:

```bash
cd worker
VIRTUAL_ENV=../.venv POETRY_VIRTUALENVS_CREATE=false poetry sync --extras cuda
```

`sync` rather than `install`, because `poetry install` only adds: run against an environment
that already has the `cpu` extra, it would leave `onnxruntime` in place beside
`onnxruntime-gpu`, and the provider you get back is then decided by whichever of the two
wrote the shared libraries last rather than by the extra you asked for. `poetry sync`
removes the engine you did not ask for. Installing into a fresh environment, either command
works, as does pip:

```bash
.venv/bin/pip install "./worker[cuda]"
```

No system CUDA or cuDNN installation is required — the extra brings them as wheels, and
HOMR calls `onnxruntime.preload_dlls()` before building a session so they are found.
Verified on an RTX 3090 with driver 580, where a freshly provisioned environment runs a
convolution on `CUDAExecutionProvider` with no other setup.

**Apple Silicon.** The `cpu` extra's `onnxruntime` wheel already ships the CoreML provider,
so nothing beyond it is needed — and nothing else is possible, since `onnxruntime-gpu`
publishes no macOS wheels. Only the segmentation stage moves to the GPU and Neural
Engine; the transformer decoder stays on the CPU, because the CoreML provider cannot
run its dynamic KV-cache dimension. `HOMR_COREML_*` environment variables tune the
provider — see `homr/onnx_providers.py`.

The **Worker logs** panel reports the choice on every start, as
`Inference providers: transformer=..., segmentation=...`.

GPU inference uses fp16 model variants rather than the fp32 ones, so switching
downloads a second set of checkpoints, roughly 143 MB alongside the 151 MB CPU set.
Both are kept, so switching back does not download again.

### Running

```bash
npm --prefix webapp install
npm run tauri:dev
```

That starts Vite on port 5173 and launches the desktop shell against it.

The worker protocol can be exercised on its own, which is the quickest way to
confirm the Python side is wired up. It reads newline-delimited requests on stdin
and exits on end of input:

```bash
cd worker
../.venv/bin/python -X faulthandler -m sheet_music_worker
```

The worker and viewer require HOMR visual sidecar v3. The sidecar is authoritative:
the viewer does not override pitches from MusicXML, infer missing links or chords
from geometry, or manufacture playback notes. Existing cached v2 pages are
invalidated and regenerated by the worker.

## Worker diagnostics

Use **Worker logs** in the application toolbar to follow PDF hashing,
rasterization, model initialization, segmentation, OCR, and staff parsing in
real time. The same output is appended to:

```text
%LOCALAPPDATA%\com.homr.sheetmusicviewer\logs\worker.log
```

If the Python process exits unexpectedly, the active job is marked failed and
the log drawer opens automatically instead of leaving the viewer indefinitely
in a processing state.
