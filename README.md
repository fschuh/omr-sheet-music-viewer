# HOMR Sheet Music Viewer

This first desktop iteration opens a PDF, rasterizes it page by page, runs the
local HOMR checkout, caches the generated PNG/MusicXML/visual-sidecar artifacts,
merges successfully recognized pages into a document-level MusicXML file, and
overlays recognized note geometry for selection and highlighting. The merged
file is stored at the PDF cache root using the PDF filename with a `.musicxml`
extension.

After the merged file is ready, **Open MusicXML** delegates it to the operating
system. The configured default application opens it, or the system can prompt
for an application when no association exists.

Playback and inking are intentionally not part of this iteration.

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
