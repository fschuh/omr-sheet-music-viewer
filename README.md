# OMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
bundled HOMR fork, caches the generated PNG/MusicXML/visual-sidecar artifacts,
merges successfully recognized pages into a document-level MusicXML file, and
overlays recognized note geometry for selection, highlighting, and note-by-note
playback navigation. The merged
file is stored at the PDF cache root using the PDF filename with a `.musicxml`
extension.

## Run the app from source

> **Recommended platform:** Use Windows 10 or Windows 11 for the smoothest
> setup and competition evaluation. macOS and Linux setup guidance is included
> below, but Windows is the primary supported platform.

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

## AI-assisted development disclosure

This project was developed with substantial assistance from
[OpenAI Codex](https://developers.openai.com/codex/) using GPT-5.6. GPT-5.6 was
the model used for reasoning and code generation; Codex was the development
agent that could inspect the repository, edit files, run commands, examine
failures, and execute tests. It was used as an iterative engineering tool, not
as an unsupervised one-shot application generator.

### How Codex and GPT-5.6 were used

- **Architecture and planning:** They helped turn the initial viewer concept
  into a cross-language desktop architecture: a React/TypeScript interface, a
  Rust/Tauri host, and a Python worker around HOMR. This included planning the
  JSON worker protocol, PDF cache layout, per-page processing, MusicXML merging,
  and the boundary between recognition and presentation.
- **Application implementation:** They assisted with writing and revising the
  PDF viewer, pan and zoom behavior, visual note overlays, note selection,
  document-level playback, smart scrolling, the 88-key piano display, piano
  audio, fingering display, configurable keyboard shortcuts, and MIDI input.
- **HOMR integration and fork improvements:** They helped add and refine the
  visual-sidecar data consumed by the viewer, map recognition geometry back to
  the displayed PDF raster, and investigate difficult cases involving chords,
  stems, whole notes, accidentals, repeated notes, tuplets, and cross-staff note
  matching. The developer supplied failing musical examples and judged whether
  the resulting geometry and MusicXML were musically correct.
- **Debugging and performance:** Codex was used to inspect logs and trace
  failures across Python, Rust, and TypeScript. Examples include worker protocol
  output contamination, MIDI startup hangs, PDF rendering slowdowns, audio
  startup latency, cache invalidation, overlay mismatches, and Windows-specific
  Tauri rebuild behavior.
- **Tests and verification:** It assisted in creating regression tests and in
  running the Python worker, TypeScript/React, and Rust test suites after
  changes. Test results and diffs were reviewed before changes were accepted;
  recognition and playback behavior were also checked manually with real sheet
  music.
- **Repository and submission preparation:** Codex helped make the competition
  branch self-contained by importing the modified HOMR fork as a Git subtree,
  wiring the Python environment to the vendored source, creating a reproducible
  lockfile, preserving third-party notices, and writing the setup and
  troubleshooting instructions in this README.

### Typical development loop

1. The developer described a feature, bug, expected musical behavior, or a
   concrete score where the current result was wrong.
2. Codex inspected the relevant source, logs, tests, and repository history and
   used GPT-5.6 to reason about the failure and propose an implementation.
3. Codex applied a scoped patch and ran the relevant automated checks.
4. The developer reviewed the diff and tested the visible or audible behavior
   in the application.
5. Further prompts corrected edge cases until the implementation and regression
   tests matched the intended result, after which the change was committed.

### Human direction and responsibility

The human developer defined the product goals, selected features, supplied
musical and visual failure cases, made architecture and usability decisions,
reviewed proposed changes, tested the application interactively, and decided
which results to keep or revise. Codex output was frequently refined through
follow-up prompts and regression testing. The final design, submitted source,
and competition entry remain the developer's responsibility.

Because the work was iterative—AI suggestions were edited, tested, rejected, or
reworked alongside human changes—the project does not claim a precise
percentage of "AI-generated code." This task-based disclosure is intended to be
more accurate than assigning authorship by line count.

### No OpenAI dependency at runtime

Codex and GPT-5.6 were development tools only. The application contains no
OpenAI API integration, requires no OpenAI account or API key, and does not send
the user's PDFs or recognition results to OpenAI. Optical music recognition is
performed locally by the bundled HOMR fork and ONNX Runtime; playback and
fingering inference also run locally.

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
