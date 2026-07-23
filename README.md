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

Listen mode is opt-in during note-by-note playback. Use the microphone button or
the default `L` shortcut to request the system-default microphone and start the
local spectral analyzer. A Web Audio FFT and harmonic sieve detect polyphonic MIDI
pitches while per-note positive spectral flux distinguishes fresh attacks from
sustained tails. Audio is analyzed in memory and is never saved or transmitted.
An exact fresh note or chord advances the playhead; confident extra notes prevent advancement.
Normal playhead sounds are suppressed while listening without changing the saved
speaker preference. The audition button or default `P` shortcut explicitly plays
the current chord, including while muted; matching pauses through the sample decay.

The adapted PitchPlease algorithm, MIT license provenance, and latest deterministic
benchmark result are recorded in `webapp/src/vendor/pitchplease/`. To run the instrumented browser
benchmark, start the web development server and open
`http://localhost:5173/?listen-benchmark=1`. It renders isolated notes and
one-to-six-note chords from the bundled piano samples, reports analysis and
onset-to-advance latency, and keeps the acceptance gate fixed at p95 below 400 ms,
95% correct advancement, and zero wrong-note false advances. The same page records
manual acoustic- and digital-piano trials; a target desktop run is still required
before treating the gate as passed.

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
