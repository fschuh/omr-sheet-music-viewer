# MusicXML viewer plan

Date: 2026-10-12  
Status: In progress; phases 1 and 2 are implemented.

## 1. Objective and scope

Open a MusicXML file directly and view, select, navigate, and play it exactly as a recognized PDF, without running homr. The viewer already consumes MusicXML for playback and fingering, so the new work is concentrated in four places: loading the file, engraving it into pages, a source-neutral note-geometry contract that both PDFs and MusicXML scores feed, and storing per-score data next to (never inside) the original file.

Initial scope:

- Open `.musicxml`, `.xml`, and compressed `.mxl` files from the same open flow as PDFs.
- A new engraving renderer, built from scratch inside its own module folder, that lays the score out into pages and draws them as SVG. MuseScore is the reference for layout behavior and appearance.
- The same score navigation, keyboard shortcuts, note selection, highlighting, note-by-note playback, realtime playback, listen mode, keyboard, and note highway as PDFs.
- Predicted fingerings for MusicXML scores, stored in a per-score data folder.
- Diagnostics and other homr-only UI hidden for MusicXML scores.

Deferred scope:

- Editing the score or writing changes back to the MusicXML file.
- Editing fingerings and other per-score customizations beyond defining their storage.
- Lyrics, chord symbols, figured bass, tablature, percussion notation, and other non-piano notation beyond a placeholder (see section 5.4).
- Reflowing the layout to the window width (a continuous or "web" view).
- Fingerings drawn on the score itself; initially they appear on the keyboard, as for PDFs.

## 2. Current implementation and integration points

Paths in this document are relative to `sheet-music-viewer/`.

| Area | Existing implementation | Implication |
| --- | --- | --- |
| Opening a document | `App.tsx` `handleOpenPdf`, `native.ts` `openPdf`, `lib.rs` `open_pdf` | The open flow is PDF-only and starts a worker job. MusicXML needs a second, worker-free branch. |
| Document state | `LoadedDocument` and `DocumentPage` in `types.ts` | Pages carry a raster `imageUrl`, a page `musicXml`, and a `visualSidecar`. There is no notion of the document's source kind. |
| Page surface | `DocumentViewer.tsx` draws `<img src={page.imageUrl}>` with an SVG overlay in page pixel coordinates (`viewBox 0 0 width height`) | A MusicXML page can replace the image with an SVG in the same coordinate space. |
| Note geometry | `page.visualSidecar` (`VisualSidecar`, version 3), read directly by hit testing and highlighting (`DocumentViewer.tsx`), note-by-note moments (`playback.ts`), realtime targets and systems (`realtime.ts` `buildRealtimeVisualMap`), and note labels (`noteLabels.ts`); the note highway works from playback and realtime output | The sidecar is homr's recognition format: per page about a megabyte of traced outlines, most of it diagnostic. These consumers move to a small source-neutral contract (section 3.4); the sidecar stays PDF-only. |
| What the consumers read | Notehead bounds (derived from fitted ellipses or traced outlines), group bounds, centers, system index, moment and chord IDs, the note-to-notehead link, pitch, grace flag (parsed from homr duration strings), measure, voice | This is the whole content of the new contract. Detected and refined outlines, raw stems, stem components, provenance, repair actions, match confidence, and alignment method are read only by Diagnostics and the note inspector. |
| Note identity | homr numbers notes per page (`homr-note-17`); `musicxml_merge.py` prefixes them with the page (`page-1-homr-note-17`); `playback.ts` and `realtime.ts` add the same prefix when reading a sidecar, counting pages that contain music | The contract carries page-scoped viewer IDs directly, so consumers stop doing page arithmetic. MusicXML notes get structural keys (section 3.5). |
| Coordinate scale | PDF pages are rasterized at 300 DPI (`RASTER_DPI` in `processor.py`); `realtime.ts` pads system bounds by fixed pixel amounts | Rendered pages use 300-DPI page pixels so these constants behave the same. |
| Playback parsing | `parseRealtimeMusicXml` in `realtime.ts` (via `@xmldom/xmldom`) | It was written against homr output. Real-world MusicXML exercises more of it (see section 6). |
| Fingerings | `fingering.ts` reads note `id` attributes and writes predictions into the merged MusicXML copy, replacing existing `<fingering>` elements | Arbitrary MusicXML usually lacks note IDs and often contains printed fingerings, so neither the keying nor the write-back can be reused as is (section 4.3). |
| Native file access | `checked_cache_path` in `lib.rs` limits reads and writes to the app cache | Reading a user-chosen MusicXML file and writing the per-score data folder need new, separately checked commands. |
| Diagnostics | Debug panel, HOMR log, diagnostic visual groups, retry page, cache-directory button in `App.tsx` | All of these describe homr processing and are hidden for MusicXML scores. |

## 3. Architecture

### 3.1 Module boundaries

All MusicXML-viewer code lives in its own folder, `webapp/src/musicxml/`, with a single public entry point, `webapp/src/musicxml/index.ts`. The rest of the application imports only from that entry point. Code inside the module may import the note-geometry contract (`noteGeometry.ts`), the shared document types (`types.ts`), the native bridge (`native.ts`), and the existing fingering predictor; it must not import `App.tsx`, `DocumentViewer.tsx`, the visual sidecar types, or any other PDF-specific code.

The shared consumers (playback, realtime, note labels, hit testing) depend only on `noteGeometry.ts`, never on the visual sidecar.

Inside the module, each stage owns one kind of dependency: only `render/` imports React, only `import/` reads XML (`@xmldom/xmldom`), and only `scoreData/` uses the native bridge. No other package is used.

All of these boundaries are enforced, not just documented: `musicxmlBoundary.test.ts` fails when a file outside `webapp/src/musicxml/` imports a path inside it other than `index.ts`, when a file inside it imports a shared file or package it is not allowed, and when it imports the visual sidecar types; `noteGeometryBoundary.test.ts` fails when a shared consumer depends on the visual sidecar.

On the native side, MusicXML commands live in a new Rust module, `src-tauri/src/musicxml.rs`, registered from `lib.rs`. The Python worker is not involved.

### 3.2 Pipeline

```text
PDF:       worker ──> page image + VisualSidecar ──> sidecarNoteGeometry.ts ──┐
                                                                              │
MusicXML:  user-chosen file                                                   │
             │  native: read, unzip .mxl, hash, ensure score-data folder      │
             ▼                                                                │
           import/    MusicXML text ──> ScoreModel + structural note keys     │
             ▼                                                                │
           layout/    ScoreModel + PageFormat ──> LayoutModel                 │
             │        (pages > systems > staves > measures > elements)        │
             ├────────────────────────┐                                       │
             ▼                        ▼                                       ▼
           render/    page SVG      geometry/  page ──> PageNoteGeometry ──> shared consumers:
                                                                             playback, realtime,
                                                                             note highway, labels,
                                                                             hit testing
```

Each stage is a pure function of its inputs. Only `import/` touches XML; only `render/` touches React or SVG; only `scoreData/` touches the native bridge. Layout is deterministic: the same score and page format always produce the same pages, element positions, and note IDs. This makes every stage testable under `node --test` like the existing tests, and lets layout move into a Web Worker later without changes.

### 3.3 Module layout

Shared files outside the module:

```text
webapp/src/
├── noteGeometry.ts           source-neutral contract (section 3.4)
├── sidecarNoteGeometry.ts    PDF adapter: VisualSidecar page -> PageNoteGeometry
└── documentSource.ts         what the app shows for each document source (section 3.6)
```

The MusicXML module:

```text
webapp/src/musicxml/
├── index.ts               public API: openMusicXmlScore(), MusicXmlPageSurface, types
├── import/
│   ├── parseMusicXml.ts   XML text -> ScoreModel; score-timewise converted to partwise
│   ├── noteKeys.ts        structural note keys (section 3.5)
│   └── importReport.ts    unsupported elements found while importing
├── model/
│   ├── score.ts           ScoreModel types (engraving-oriented, separate from realtime.ts)
│   └── layout.ts          LayoutModel types
├── layout/
│   ├── pageFormat.ts      page size, margins, staff space from <defaults> or defaults
│   ├── measureContent.ts  per-measure segments: clefs, key/time, chords, rests, barlines
│   ├── chords.ts          noteheads, seconds, accidentals, dots, ledger lines
│   ├── stems.ts / beams.ts
│   ├── horizontal.ts      duration-based spacing of segments within a measure
│   ├── systems.ts         breaking measures into systems (honoring encoded breaks)
│   ├── vertical.ts        staff and system distances, skylines for collisions
│   ├── pages.ts           breaking systems into pages
│   └── spanners.ts        ties, slurs, hairpins, pedal, ottava, tuplet brackets
├── render/
│   ├── MusicXmlPageSurface.tsx   one page as SVG, page-pixel viewBox, highlight classes
│   ├── glyphs.ts          SMuFL glyph names, codepoints, and metadata lookups
│   └── text.ts            titles, credits, directions; TextMeasurer interface
├── geometry/
│   └── pageNoteGeometry.ts   LayoutModel page -> PageNoteGeometry
├── document/
│   └── loadedDocument.ts  ScoreModel + layout -> LoadedDocument, viewer IDs
├── scoreData/
│   ├── scoreData.ts       read/write manifest.json, fingerings.json via native.ts
│   └── fingerings.ts      prediction lifecycle, key translation, source precedence
└── fonts/
    ├── Leland.otf                 SMuFL music font (SIL OFL), MuseScore's default
    ├── leland_metadata.json       glyph bounding boxes, anchors, engraving defaults
    └── LICENSE-OFL.txt
```

Tests sit next to the files they test, as elsewhere in `webapp/src`.

### 3.4 Note-geometry contract

`noteGeometry.ts` defines what the shared consumers need to know about the notes on a page, independent of where the page came from, and is the reference for its fields. It holds only what current features read and grows when a feature needs more. Per page it lists:

- Noteheads: ID, system on the page, center, the visible notehead box (labels are placed around it and playback orders moments by it), the hit areas a click selects (with a 3-pixel clearance), the box with the stem (the hit-test fallback and the measure of a system), and chord and moment IDs.
- Notes: page-scoped viewer ID, the notehead that shows the note, pitch, grace flag, and measure.

Notes and noteheads are separate because one PDF notehead can be linked to more than one note (for example, a unison shared by two voices). The contract also provides hit testing and chord-aware selection, so every source selects the same way.

Geometry is derived for the whole document rather than stored on each page: a PDF note's page prefix counts the pages that contain music, which changes while a PDF is still being recognized. `App.tsx` derives it whenever the pages change, and the adapter caches each page's conversion, so unchanged pages keep the same geometry object. PDF pages keep `visualSidecar`, which remains the source for the PDF highlight shapes, Diagnostics, and the note inspector's homr fields. Diagnostic groups reach selection and hit testing only through `pageDiagnosticNoteheads` in `DocumentViewer.tsx`, while Diagnostics shows them.

PDF adapter (`sidecarNoteGeometry.ts`): converts linked, non-diagnostic visual groups and the notes that point at them, applies the page prefix to note IDs, parses the grace flag from homr duration strings, and builds the score facts playback reads (from the merged document, or from each page's own MusicXML until the merge exists). Hit areas come from the traced outlines and the notehead box from the fitted ellipses, as the consumers used them before; the box keeps the exact arithmetic labels used, because labels on one staff line tie on their anchors and equivalent formulas reorder them. A group without a box, which homr does not produce, falls back to its notehead box in every consumer. Moving the consumers onto the contract must not change PDF behavior; section 7 defines the check.

MusicXML geometry (`geometry/pageNoteGeometry.ts`): built from the layout positions and glyph metadata, at a few numbers per notehead.

Highlighting is a page-surface concern, not part of the contract. PDF pages keep drawing highlight shapes from the sidecar over the raster image. MusicXML pages own their drawing: `MusicXmlPageSurface` receives the selected and playing notehead IDs and gives the matching glyph groups (notehead, stem, flag, accidental, dots) a CSS class, so the highlight is exactly what is drawn.

A contract test checks, for every corpus score, that every note in `documentMusicXml` appears exactly once in the note geometry of the page its ID names, that every note links to a notehead on that page, and that all bounds lie inside the page.

### 3.5 Note identity

Two kinds of note identity are kept apart.

**Structural key**, stored in per-score data and independent of layout:

```text
P1-m12-s1-v1-t3_8-E5
│  │   │  │  │    └ pitch as written (E5, Fs5 = F#5, Bb4, Fx5 = F double sharp)
│  │   │  │  └ onset: 3/8 of a whole note after the start of the measure (t0 = downbeat)
│  │   │  └ voice
│  │   └ staff within the part (2 = left-hand staff of a piano)
│  └ measure by position in the part, not the printed number
└ part ID from the file
```

| Note | Key |
| --- | --- |
| Downbeat of measure 1, right hand | `P1-m1-s1-v1-t0-C5` |
| C–E–G chord, beat 2 of 4/4, left hand | `P1-m3-s2-v1-t1_4-C3`, `P1-m3-s2-v1-t1_4-E3`, `P1-m3-s2-v1-t1_4-G3` |
| Second voice on the same staff | `P1-m3-s1-v2-t1_4-A4` |
| Grace note before beat 3 (`g1` = first grace note at that onset) | `P1-m3-s1-v1-t1_2-g1-D5` |
| Same pitch twice at one onset in one voice | `P1-m3-s1-v1-t1_2-E5`, `P1-m3-s1-v1-t1_2-E5-2` |

Rules:

- Measures are counted by position because the MusicXML `number` attribute repeats or is missing in some exports (pickups, `X1` measures).
- Onsets are reduced fractions of a whole note, computed from `divisions`, `backup`, and `forward`.
- Keys use only letters, digits, `-`, and `_`, so every key is also a valid XML `id`; MusicXML declares `id` as an XML ID, which excludes `/`, `:`, and `#`.
- `id` attributes already present in the file are ignored for keying, so every score uses one scheme.

Page size, system breaks, and page breaks never change a key. Edits to the file can: a changed onset or pitch changes that note's key, and an inserted measure shifts the measure index of every later measure. Carrying data across such edits needs a matching step (section 3.8), not a different key.

**Viewer ID**, in memory only and rebuilt after every layout: the page number followed by the structural key, `page-4-P1-m12-s1-v1-t3_8-E5`. It has the same `page-<n>-…` shape as PDF viewer IDs, and converting between the two forms only adds or strips the prefix.

The document carries `documentMusicXml`, an in-memory copy of the source in which every note's `id` is its viewer ID. The original file is never modified. PDFs keep their homr-based IDs.

### 3.6 Application integration

`LoadedDocument` gains a discriminated source:

```ts
source:
  | { kind: "pdf"; cacheStatus: "miss" | "partial" | "complete"; cachePath?: string }
  | { kind: "musicxml"; sourcePath: string; scoreDataPath?: string };
```

The PDF-only `cacheStatus` and `cachePath` moved from `LoadedDocument` into the PDF source. `scoreDataPath` is unset only while the file is being read. The import report (section 4.1) joins the MusicXML source when import reports unsupported elements.

Opening:

- A single "Open score…" dialog replaces the PDF-only one. Its default filter, "All supported scores", shows every supported type (`pdf`, `musicxml`, `xml`, `mxl`), with "PDF" and "MusicXML" filters as alternatives. The extension chooses the flow. `choose_pdf` becomes `choose_score` (and `choosePdf` becomes `chooseScore`), and later formats are added to the same dialog. The existing reset sequence in `handleOpenPdf` (stop playback, listen mode, and realtime; clear selection) moves into a shared function used by both flows.
- PDFs continue through the worker exactly as today; their note geometry comes from the adapter.
- MusicXML calls `openMusicXmlScore(path, jobId)`, which reads the file through the native bridge, imports, lays out, and returns a complete `LoadedDocument` with status `"complete"`. A synthetic job ID keeps the existing stale-request guards working. Fingering prediction then runs through the module's fingering lifecycle (section 4.3).

Page surface: `DocumentPage` gains an optional `surface` field. When it holds a MusicXML page, `DocumentViewer` renders `MusicXmlPageSurface` in place of the `<img>`; MusicXML pages have no sidecar, so the sidecar highlight layer draws nothing on them. Pan, zoom, and hit testing are shared because they work in page pixels on the note geometry. Pages outside the viewport render a sized placeholder, so long scores do not keep hundreds of SVG pages alive.

UI differences by source:

| Element | PDF | MusicXML |
| --- | --- | --- |
| Diagnostics panel, worker logs, debug overlays, diagnostic visual groups | Shown when enabled | Hidden (`diagnosticsAvailable` in `documentSource.ts`) |
| Retry page, page processing status | Shown | Hidden (every page is complete) |
| Folder button | "Open cache folder": the PDF cache folder | "Open score data folder": the score-data folder |
| Open MusicXML | Opens the merged, recognized MusicXML | Opens the original file |
| Navigation, shortcuts, selection, playback, listen mode, keyboard, note highway | Unchanged | Same behavior |
| Note inspector | Includes homr fields (provenance, repairs, confidence) | Shows the structural key; omits homr-only fields |

### 3.7 Native commands

New commands in `src-tauri/src/musicxml.rs`:

| Command | Behavior |
| --- | --- |
| `choose_score()` | The "Open score" dialog (section 3.6). |
| `open_music_xml_score(path)` | Accepts only an existing `.musicxml`, `.xml`, or `.mxl` file. For `.mxl`, reads `META-INF/container.xml` and returns the first root file. Decodes UTF-8 and, with a byte-order mark, UTF-16. Rejects a score whose XML exceeds 64 MB, and XML whose root is not `score-partwise` or `score-timewise`. Returns the XML text, the source SHA-256 and size, and the score-data folder path, creating the folder and updating its `manifest.json`. Remembers the file as opened in this session. |
| `open_score_source(path)` | Opens the original file with the system's default application ("Open MusicXML"). Only files opened in this session are accepted, so the webview cannot open arbitrary files. |
| `open_score_data_directory(folder)` | Opens a score-data folder in the system file manager. The folder must be an existing directory directly inside `<app data>/musicxml-scores/`, named by a lowercase SHA-256. |
| `read_score_data(folder, name)` / `write_score_data(folder, name, contents)` | Added with fingerings (phase 5): read or atomically write a JSON file in a score-data folder, with the same folder check and an allowed set of names. |

`.mxl` reading uses the `zip` crate (deflate only), XML scanning `quick-xml`, and hashing `sha2`. Rust tests cover the format, size, container, path, and opened-file checks; each check has a test that fails when the check is removed.

### 3.8 Per-score data folder

```text
<app data dir>/musicxml-scores/<sha256 of the source file>/
  manifest.json      schema version, source hash and size, format, last-seen path and name,
                     created and last-opened dates
  fingerings.json    predictions and, later, user overrides
  settings.json      added when the first per-score setting exists
```

Compared with the PDF cache:

- It lives in the app data directory (on Linux `~/.local/share/…`), not the cache directory, because per-score customizations are user data and the cache can be cleared at any time.
- It holds no copy of the score. All additions are overlays keyed by structural note keys.
- Like the PDF cache, it is keyed by content hash, so renaming or moving the file keeps its data. Editing the file creates a new folder. That costs nothing while the folder holds only predictions, which are regenerated in seconds. Before user overrides ship, a fallback will find the previous folder by the last-seen path in `manifest.json` and carry overrides across by matching notes on measure content, onset, and pitch.

`fingerings.json`:

```json
{
  "schemaVersion": 1,
  "model": "lumikey-0.3.0-staff-hands-v1",
  "noteKeyScheme": 1,
  "predicted": {
    "P1-m12-s1-v1-t3_8-E5": { "finger": 3, "left": false },
    "P1-m12-s2-v1-t0-C3": { "finger": 5, "left": true }
  },
  "overrides": {}
}
```

Predictions are reused only when `model` and `noteKeyScheme` match; otherwise they are regenerated.

## 4. Data flow details

### 4.1 Import

`parseMusicXml.ts` builds an engraving-oriented `ScoreModel`: part list and staff counts; per measure, the attributes (divisions, key, time, clefs, staff details), directions, barlines, repeats, endings, and print breaks; per staff and voice, a sequence of chords and rests with absolute time positions (resolving `backup` and `forward`), notes with pitch, notated type, dots, tuplet ratios, ties, accidentals, stem direction and beam information when encoded, notations, and printed fingerings. Each note receives its structural key here.

Encoded layout hints (`default-x`, `default-y`, stem and beam directions, `<print>` breaks, `<defaults>` scaling and page layout) are kept in the model. Layout honors breaks and page format by default, matching MuseScore's import default, and computes everything else itself.

Elements outside the supported set are listed in the import report with counts and the first measure where each occurs. The report is written to the developer console and shown in the note inspector for MusicXML scores. Unsupported elements never remove notes from playback.

### 4.2 Layout and rendering

Layout follows MuseScore's approach and naming where practical, so its source can be consulted stage by stage:

1. Units are staff spaces (MuseScore's spatium). Page pixels come from the page format: millimetres from `<scaling>` and `<page-layout>`, else a Letter page and MuseScore 4's default 1.75 mm staff space, converted at 300 DPI. A page size without `<scaling>` is read with the default staff space.
2. Each measure is divided into time-ordered segments (clef, key, time, chord/rest, barline), as in MuseScore's `Segment` list.
3. Chord layout places noteheads (including seconds on the opposite side of the stem), accidentals in non-colliding columns, augmentation dots, ledger lines, and stems, with stem directions from the voice and the staff middle line.
4. Beams are grouped from encoded `<beam>` elements, else from the time signature's beat groups; slope and stem lengths follow MuseScore's beam rules.
5. Horizontal spacing assigns each segment a width from its duration relative to the shortest duration in the system, following MuseScore's horizontal spacing, then stretches measures to justify each system.
6. System and page breaking fill systems and pages, honoring encoded breaks.
7. Vertical spacing uses skylines so staves, dynamics, and spanners do not collide.
8. Spanners (ties, slurs, hairpins, pedal lines, ottavas, tuplet brackets, volta brackets) are laid out last, per system segment, with slurs as cubic Béziers avoiding noteheads.

Glyphs come from the Leland SMuFL font with its metadata JSON, which supplies the bounding boxes and stem anchors that layout needs. Text width comes from an injected `TextMeasurer`: a canvas-based measurer in the app and a deterministic one in tests.

`render/` draws the `LayoutModel` as SVG and does not compute positions. Every glyph that belongs to a notehead (notehead, stem, flag, accidental, dots) is grouped under that notehead's ID so highlighting can address it. The note geometry is computed from the same layout positions and glyph metadata, so hit testing matches what is drawn.

### 4.3 Fingerings

The PDF lifecycle writes predictions into a MusicXML copy. MusicXML scores use an overlay instead:

1. On open, read `fingerings.json`. If `model` and `noteKeyScheme` match, convert the structural keys to viewer IDs and set `predictedFingerings`.
2. Otherwise run the existing predictor on the in-memory `documentMusicXml` (whose notes all have viewer IDs), strip the page prefixes, and write `fingerings.json`.
3. Printed fingerings from the source are engraved as part of the score and are never overwritten. Where a note has a printed fingering, the keyboard shows the printed finger. A user override (later) takes precedence over both.

The prediction call is factored so that both lifecycles share it. The PDF lifecycle itself does not change in this work.

## 5. Notation coverage

Coverage is driven by the corpus in section 7, which is mostly Romantic and Classical piano music.

### 5.1 Required for the first usable version

Staves and grand-staff braces; clefs, including mid-measure changes; key and time signatures and changes; noteheads of all durations, dots, rests (including multi-voice rest offsets and whole-measure rests); accidentals and courtesy accidentals; stems and beams, including cross-staff beams; ledger lines; chords and seconds; multiple voices per staff; tuplets; ties; barlines, repeat signs, and voltas; grace notes; page and system breaks; title and composer credits; measure numbers.

### 5.2 Second stage

Slurs; dynamics and hairpins; articulations (staccato, accent, tenuto, fermata); printed fingerings; pedal markings; ottava lines; tempo and expression text; arpeggios; tremolos; trills and other ornaments.

### 5.3 Later

Lyrics, chord symbols, multi-measure rests, cue notes, multiple parts beyond piano (rendered but not tuned), cross-staff note placement beyond beams, and layout options such as changing page size.

### 5.4 Unsupported elements

An element without layout support is listed in the import report. Where it carries notes, they are still laid out with default positions so playback and selection stay complete.

## 6. Playback adaptation

Playback uses `documentMusicXml` through `parseRealtimeMusicXml`, so most behavior carries over. The corpus will exercise cases homr output rarely contains; each is checked against the source score and fixed in `realtime.ts` and `playback.ts` with a test:

- Multiple voices per staff with `backup` and `forward`.
- Grace notes with real MusicXML `<grace>` elements; the note geometry's `grace` flag replaces the homr duration-string check for MusicXML pages.
- Tuplets via `time-modification`, repeats with voltas, and `sound` tempo changes.
- Scores with more than one part. Hand assignment uses the existing staff/clef rule within a keyboard part; fingering prediction runs only on keyboard parts.

Any change to shared playback code is checked against PDFs as well, so behavior for recognized PDFs does not change unless the change is intended.

## 7. Testing and verification

- Unit tests for each stage, run by `npm test`.
- Note-geometry adapter tests with small sidecar fixtures, including notes sharing a notehead, diagnostic groups (excluded), groups with and without fitted ellipses, and pages without music (page numbering).
- PDF parity check for shared consumer code (`webapp/tools/note-geometry-parity`, `npm run parity:note-geometry`): records, for every recognized PDF page in the given pdf-cache folders, the note-by-note playback timelines (from the merged document and from page MusicXML), realtime targets, selections, pitch labels, hit tests on a grid and around every hit boundary, and playback scroll extents. A recording before and after a change must agree; numbers that differ by at most 1e-6 px are reported separately as rounding. The harness file maps the consumers' current APIs onto the recorded format and is the only part that changes with them. The check is repeated whenever shared consumer code changes.
- Contract tests from section 3.4, run on every corpus score.
- Note-key tests: keys are unchanged by different page formats and break settings; chords, voices, grace notes, and duplicate pitches get distinct keys; every key is a valid XML ID.
- Boundary tests from section 3.1.
- Native tests for every path and format check in section 3.7.

Corpus:

- `../omr-evals/cases/ground-truth/musescore/`: 26 MuseScore-exported `.mxl` files, each with the PDF MuseScore engraved from it (MuseScore 1.1 to 4.2, mostly 3.6). These are the primary visual references; the older PDFs differ in house style, so MuseScore 4 renderings (below) are the reference for current appearance. They include encoded system and page breaks, multiple voices, tuplets, grace notes, slurs, pedal markings, and printed fingerings (for example, 96 in the Nocturne Op. 9 No. 2). Their PDFs, run through homr, also exercise the parity check.
- `../omr-evals/cases/ground-truth/ninsheetmusic/mus/`: MusicXML exported from the source `.mus` files (2 so far, more as the export proceeds), for scores not written in MuseScore.

Visual comparison: a script under `tools/` renders each corpus score with the new renderer and places each page beside the reference PDF page, or beside a rendering from the locally installed MuseScore 4 (`mscore4portable -o page.png score.mxl`). Pages are reviewed by eye; there is no pixel-equality target, because small spacing differences are acceptable while missing or misplaced symbols are not.

## 8. Phases

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 1. Note-geometry contract | `noteGeometry.ts`, PDF adapter, shared consumers switched from the sidecar, consumer boundary test | PDF parity check shows the same behavior on every corpus PDF; all existing tests pass. |
| 2. Skeleton | Module folder, module boundary test, native open command for `.musicxml`/`.xml`/`.mxl`, score-data folder, `source` on `LoadedDocument`, UI gating | A corpus file opens and shows blank pages of the right size; Diagnostics hidden; PDFs unchanged. |
| 3. Notes on staves | Import with structural keys, page format, segments, chords, stems, simple beams, spacing, encoded breaks, SVG rendering with highlight classes, note geometry | All corpus scores render notes and rests on correct staves with correct pitches; contract tests pass; selection and highlighting work. |
| 4. Playback parity | Viewer IDs, document adapter, playback fixes from section 6 | Note-by-note and realtime playback, navigation, shortcuts, keyboard, and note highway behave as for PDFs on every corpus score. |
| 5. Fingerings | Overlay lifecycle, source precedence | Predictions persist across reopenings and survive moving the file; printed fingerings are never replaced. |
| 6. Section 5.1 complete | Remaining required notation | Side-by-side review of every corpus page shows no missing or misplaced required symbols. |
| 7. Section 5.2 | Second-stage notation | Same review for the second-stage symbols. |

Phase 1 changes only shared code and PDF behavior must stay identical, so it can be reviewed and merged on its own. Each phase is a separate reviewable commit series on the `musicxml` branch.

Phase 2 result: all 28 corpus files open (26 `.mxl`, 2 `.musicxml`). Page sizes match the reference PDFs within 2 px (0.2 mm), except one score whose file asks for Letter while its MuseScore 2 PDF is A4; MuseScore 4 also uses Letter. Until phase 3 breaks pages by content, a page holds everything up to the next encoded page break. This gives the reference page count for 24 of the 26 MuseScore scores; two MuseScore 1.3 exports encode a page break before their last measure that their PDFs do not show, and scores without encoded breaks open as one page.

## 9. Risks and open questions

- **Consumer switch.** Phase 1 touches code every PDF depends on. The parity check guards it; any difference it finds is either fixed in the adapter or, if intended, reported and approved as a behavior change.
- **Contract growth.** The note-geometry contract holds only what current features read. A new feature that needs more (for example, staff line positions for fingering placement) extends the contract and both producers.
- **Page-scoped viewer IDs.** Consumers still identify notes by page. Structural keys keep stored data independent of layout, but a later cleanup could give the contract document-level IDs and remove the page coupling for both sources.
- **Layout effort.** Engraving quality is the largest cost. Following MuseScore stage by stage limits the design risk; the corpus review keeps quality measurable.
- **Performance.** The largest corpus file is about 2.2 MB of MusicXML. Layout runs once per open and can move to a Web Worker; rendering is limited to visible pages.
- **Licensing.** The viewer is AGPL-3.0 and MuseScore is GPL-3.0; GPL-3.0 section 13 permits combining the two, so MuseScore code may be ported with attribution. Leland is SIL OFL and ships with its license.
- **Edited source files.** Content-hash keying orphans data when the file changes, and edits can change structural keys. Harmless for predictions; the matching fallback in section 3.8 is required before user overrides ship.
