# HOMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
local HOMR checkout, caches the generated PNG/MusicXML/visual-sidecar artifacts,
merges successfully recognized pages into a document-level MusicXML file, and
overlays recognized note geometry for selection, highlighting, and note-by-note
playback navigation. The merged
file is stored at the PDF cache root using the PDF filename with a `.musicxml`
extension.

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

On Windows, the app listens to every standard MIDI input exposed by the system.
BLE MIDI hardware therefore needs a bridge that exposes it as a Windows MIDI
port. MIDI assignments are device- and channel-independent, and the Settings
page can rescan inputs after a bridge or device is connected.
Holding an assigned MIDI Note or nonzero Control Change repeats navigation until
the corresponding Note Off or zero-value Control Change arrives. Playback-mode
toggle messages and message types without a release signal remain one-shot.
On Windows, the repeat delay and rate follow the system keyboard settings; other
platforms use a 400 ms delay and 75 ms interval.

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
