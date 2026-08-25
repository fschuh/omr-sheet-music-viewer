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
and peak limiting. The bundled medium-dynamics samples come from AKAI's public-domain
[Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano)
library; provenance is recorded beside the assets in
`webapp/public/audio/piano/SOURCE.md`.

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
registry in `webapp/src/listenMatcherProfiles.ts`. Timing, target ordering, and
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

The repository expects the existing root `.venv` and editable sibling HOMR
installation. Install the worker's remaining dependencies into that environment:

```powershell
$env:UV_CACHE_DIR = "$PWD\.uv-cache"
uv pip install pypdfium2 --python .venv\Scripts\python.exe
```

Then install the frontend dependencies and start the desktop app from the
repository root:

```powershell
npm --prefix webapp install
npm run tauri:dev
```

The worker and viewer require HOMR visual sidecar v3. The sidecar is authoritative:
the viewer does not override pitches from MusicXML, infer missing links or chords
from geometry, or manufacture playback notes. Existing cached v2 pages are
invalidated and regenerated by the worker.

The Python worker protocol can be smoke-tested independently:

```powershell
Set-Location worker
..\.venv\Scripts\python.exe -m sheet_music_worker
```

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
