# OMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
bundled HOMR fork, caches the generated PNG/MusicXML/visual-sidecar artifacts,
merges successfully recognized pages into a document-level MusicXML file, and
overlays recognized note geometry for selection, highlighting, and note-by-note
playback navigation. The merged
file is stored at the PDF cache root using the PDF filename with a `.musicxml`
extension.

## Run the app from source

### 1. Install the prerequisites

Install these once before cloning the repository:

- [Git](https://git-scm.com/downloads).
- [Node.js](https://nodejs.org/) 22.12 or newer, including `npm`.
- [uv](https://docs.astral.sh/uv/getting-started/installation/), which creates
  the Python environment and installs Python when needed.
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
  operating system, including Rust. On Windows, select **Desktop development
  with C++** in the Microsoft C++ Build Tools installer. On macOS, install the
  Xcode command-line tools. On Linux, install the WebKit and system packages
  listed for your distribution.

Open a new terminal after installing them and check that every command works:

```text
git --version
node --version
npm --version
uv --version
rustc --version
cargo --version
```

The app supports Python 3.11 through 3.15. You do not need to install Python or
create a virtual environment manually; `uv` handles both.

### 2. Clone and start the competition branch

Run these commands in PowerShell, Terminal, or a Linux shell:

```text
git clone --branch competition-monorepo --single-branch https://github.com/fschuh/sheet-music-viewer.git
cd sheet-music-viewer
uv sync --locked
npm --prefix webapp ci
npm run tauri:dev
```

The first launch compiles the Rust application, so it can take several minutes.
The application window opens automatically when compilation finishes. Keep the
terminal open while using the app; press `Ctrl+C` there to stop it.

For later launches, open a terminal in the repository and run only:

```text
npm run tauri:dev
```

### 3. Open sheet music

1. Select **Open PDF** in the application window.
2. Choose a PDF containing printed sheet music.
3. Wait while the pages are rasterized and recognized. The first PDF triggers a
   one-time download of the HOMR recognition models and therefore requires an
   internet connection. Later runs reuse the downloaded models and cached PDF
   results.
4. Select recognized notes, use the playback controls, or open the generated
   MusicXML file from the toolbar.

If recognition fails, open **Worker logs** in the toolbar to see the active
step and error message.

### Common setup problems

- **`cargo` or `rustc` is not found:** restart the terminal after installing
  Rust. On Windows, confirm that the default Rust toolchain is MSVC.
- **A Windows linker or `link.exe` error appears:** install the Microsoft C++
  Build Tools workload named **Desktop development with C++**.
- **A Linux WebKit, GTK, or linker package is missing:** install the packages
  for your distribution from the Tauri prerequisites linked above.
- **The viewer reports that its Python environment is missing:** run
  `uv sync --locked` from the repository root, not from `worker`.
- **The first recognition cannot download models:** check the internet
  connection, then reopen the PDF. The **Worker logs** panel shows the download
  status.

## How it works

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

## Development checks

After completing the setup above, run the automated checks from the repository
root with:

```text
uv run pytest worker/tests
npm --prefix webapp test
cargo test --manifest-path src-tauri/Cargo.toml
```

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
