# OMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
bundled HOMR fork, caches the generated PNG/MusicXML/visual-sidecar artifacts,
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

## Development

The repository contains the application and its modified HOMR fork in
`vendor/homr`. Create the root Python environment and install the worker and
bundled HOMR source from the repository lockfile:

```powershell
$env:UV_CACHE_DIR = "$PWD\.uv-cache"
uv sync --locked
```

On macOS or Linux, the equivalent setup is:

```bash
UV_CACHE_DIR="$PWD/.uv-cache" uv sync --locked
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

On macOS or Linux, run `../.venv/bin/python -m sheet_music_worker` from the
`worker` directory.

## Bundled HOMR fork

`vendor/homr` is a squashed Git subtree of the `fschuh/homr` fork. A fresh clone
therefore contains the exact HOMR source used by the application and does not
need a second repository or Git submodule. See `THIRD_PARTY_NOTICES.md` and
`vendor/homr/LICENSE` for provenance and licensing details.

Maintainers can update the subtree from a local HOMR checkout with:

```bash
git subtree pull --prefix=vendor/homr ../homr main --squash
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
