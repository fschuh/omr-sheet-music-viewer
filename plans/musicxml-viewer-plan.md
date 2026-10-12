# MusicXML viewer plan

Date: 2026-10-12  
Status: Proposed; implementation has not started.

## 1. Objective and scope

Open a MusicXML file directly and view, select, navigate, and play it exactly as a recognized PDF, without running homr. The viewer already consumes MusicXML for playback and fingering, so the new work is concentrated in three places: loading the file, engraving it into pages, and storing per-score data next to (never inside) the original file.

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
| Page surface | `DocumentViewer.tsx` draws `<img src={page.imageUrl}>` with an SVG overlay in page pixel coordinates (`viewBox 0 0 width height`) | A MusicXML page can replace the image with an SVG in the same coordinate space and keep the overlay untouched. |
| Note geometry | `page.visualSidecar` (`VisualSidecar`, version 3) | Selection, highlighting, note-by-note moments (`playback.ts`), realtime targets and systems (`realtime.ts` `buildRealtimeVisualMap`), note labels, and the note highway all read it. It is the contract the renderer must satisfy. |
| Note identity | `musicxml_merge.py` rewrites every ID to `page-<n>-<id>`; `playback.ts` and `realtime.ts` look notes up with that prefix, where `n` counts pages that contain music | The renderer must produce the same page-scoped IDs, derived from where each note lands after layout. |
| Coordinate scale | PDF pages are rasterized at 300 DPI (`RASTER_DPI` in `processor.py`); `realtime.ts` pads system bounds by fixed pixel amounts | Rendered pages should use 300-DPI page pixels so these constants behave the same. |
| Sidecar value formats | `isGraceNote` in `playback.ts` reads homr duration strings (`note_16`, grace marked with `G`) | The geometry builder must write homr-compatible `duration` and `pitch` strings. |
| Playback parsing | `parseRealtimeMusicXml` in `realtime.ts` (via `@xmldom/xmldom`) | It was written against homr output. Real-world MusicXML exercises more of it (see section 6). |
| Fingerings | `fingering.ts` reads note `id` attributes and writes predictions into the merged MusicXML copy, replacing existing `<fingering>` elements | Arbitrary MusicXML usually lacks note IDs and often contains printed fingerings, so neither the keying nor the write-back can be reused as is (section 4.3). |
| Native file access | `checked_cache_path` in `lib.rs` limits reads and writes to the app cache | Reading a user-chosen MusicXML file and writing the per-score data folder need new, separately checked commands. |
| Diagnostics | Debug panel, HOMR log, diagnostic visual groups, retry page, cache-directory button in `App.tsx` | All of these describe homr processing and are hidden for MusicXML scores. |

## 3. Architecture

### 3.1 Module boundary

All MusicXML-viewer code lives in its own folder, `webapp/src/musicxml/`, with a single public entry point, `webapp/src/musicxml/index.ts`. The rest of the application imports only from that entry point. Code inside the module may import the shared viewer contract (`types.ts`), the native bridge (`native.ts`), and the existing fingering predictor; it must not import `App.tsx`, `DocumentViewer.tsx`, or any PDF-specific code.

The boundary is enforced, not just documented: a test fails when a file outside `webapp/src/musicxml/` imports a path inside it other than `index.ts`, and when a file inside it imports one of the forbidden application modules.

On the native side, MusicXML commands live in a new Rust module, `src-tauri/src/musicxml.rs`, registered from `lib.rs`. The Python worker is not involved.

### 3.2 Pipeline

```text
user-chosen file
   │  native: read, unzip .mxl, hash, ensure score-data folder
   ▼
import/      MusicXML text ──> ScoreModel (parts, staves, measures, voices, events)
   │                           + stable note keys
   ▼
layout/      ScoreModel + PageFormat ──> LayoutModel (pages > systems > staves > measures
   │                                     > positioned elements, in staff spaces)
   ├──────────────────────────────┐
   ▼                              ▼
render/      LayoutModel page ──> SVG   geometry/   LayoutModel page ──> VisualSidecar
   │                              │                 + page-scoped note IDs
   └──────────────┬───────────────┘
                  ▼
document/    LoadedDocument for the existing viewer, playback, and fingering code
```

Each stage is a pure function of its inputs. Only `import/` touches XML; only `render/` touches React or SVG; only `scoreData/` touches the native bridge. Layout is deterministic: the same score and page format always produce the same pages, element positions, and note IDs. This makes every stage testable under `node --test` like the existing tests, and lets layout move into a Web Worker later without changes.

### 3.3 Module layout

```text
webapp/src/musicxml/
├── index.ts               public API: openMusicXmlScore(), MusicXmlPageSurface, types
├── import/
│   ├── parseMusicXml.ts   XML text -> ScoreModel; score-timewise converted to partwise
│   ├── noteKeys.ts        stable, layout-independent note keys
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
│   ├── MusicXmlPageSurface.tsx   one page as SVG, page-pixel viewBox
│   ├── glyphs.ts          SMuFL glyph names, codepoints, and metadata lookups
│   └── text.ts            titles, credits, directions; TextMeasurer interface
├── geometry/
│   └── visualSidecar.ts   LayoutModel page -> VisualSidecar + page-scoped IDs
├── document/
│   └── loadedDocument.ts  ScoreModel + layout -> LoadedDocument and DocumentPage[]
├── scoreData/
│   ├── scoreData.ts       read/write manifest.json, fingerings.json via native.ts
│   └── fingerings.ts      prediction lifecycle, key translation, source precedence
└── fonts/
    ├── Leland.otf                 SMuFL music font (SIL OFL), MuseScore's default
    ├── leland_metadata.json       glyph bounding boxes, anchors, engraving defaults
    └── LICENSE-OFL.txt
```

Tests sit next to the files they test, as elsewhere in `webapp/src`.

### 3.4 Viewer contract

The renderer feeds the existing viewer by producing exactly what the PDF pipeline produces, so playback, selection, navigation, shortcuts, labels, and the note highway keep working without changes to their code.

For each rendered page, the `DocumentPage` carries:

- `width` and `height` in 300-DPI page pixels (a Letter page is 2550 × 3300).
- `visualSidecar` (version 3, `source_image_size` = page size):
  - One `notes` entry per rendered note: page-local `musicxml_id`, part, measure, staff, voice, homr-format `pitch` and `duration` strings, `match_confidence` 1, `alignment_method` `"structural"`, and its `visual_group_id`.
  - One `visual_groups` entry per notehead: exact notehead outline as `notehead_contours`, stem outline as `stem_contours`, `center`, `bbox`, `staff_group_index` = system index on the page, `staff_index`, `staff_position`, `chord_id` and `moment_id` from the score's time position, `visual_status` `"canonical"`, and a new provenance value `"engraved"`.
- `musicXml` is left unset; `noteByNoteScoreData` already prefers the document score when one exists.

The document carries `documentMusicXml`: an in-memory copy of the source in which every note has an `id` of the form `page-<n>-<local id>`, matching the page the note was laid out on. The original file is never modified.

Two kinds of note identity are kept apart:

- The stable note key (`noteKeys.ts`) is independent of layout: the note's own `id` when present and unique, otherwise part ID, measure index, staff, voice, and position within the voice. Per-score data is stored by stable key.
- The page-scoped viewer ID depends on layout and is what the existing code expects. The document adapter owns the two-way mapping, so a future change in page format or system breaking never invalidates stored data.

A contract test checks, for every corpus score, that each note in `documentMusicXml` has exactly one sidecar note and one linked visual group on the page its ID names, and that every visual group's outline lies inside its page.

### 3.5 Application integration

`LoadedDocument` gains a discriminated source:

```ts
source:
  | { kind: "pdf"; cachePath?: string }
  | { kind: "musicxml"; sourcePath: string; scoreDataPath: string; importReport: ImportReport };
```

Opening:

- One "Open score…" dialog with filters for PDF and MusicXML (`pdf`, `musicxml`, `xml`, `mxl`). The extension chooses the flow. The existing reset sequence in `handleOpenPdf` (stop playback, listen mode, and realtime; clear selection) moves into a shared function used by both flows.
- PDFs continue through the worker exactly as today.
- MusicXML calls `openMusicXmlScore(path)`, which reads the file through the native bridge, imports, lays out, and returns a complete `LoadedDocument` with status `"complete"`. A synthetic job ID keeps the existing stale-request guards working. Fingering prediction then runs through the module's fingering lifecycle (section 4.3).

Page surface: `DocumentPage` gains an optional `surface` field. When it holds a MusicXML page, `DocumentViewer` renders `MusicXmlPageSurface` in place of the `<img>`. The SVG overlay, pan, zoom, and hit testing are unchanged because they already work in page pixels. Pages outside the viewport render a sized placeholder, so long scores do not keep hundreds of SVG pages alive.

UI differences by source:

| Element | PDF | MusicXML |
| --- | --- | --- |
| Diagnostics panel, HOMR log, diagnostic visual groups | Shown when enabled | Hidden |
| Retry page, page processing status | Shown | Hidden (every page is complete) |
| Open cache directory | Opens the PDF cache folder | Opens the score-data folder |
| Open MusicXML | Opens the merged, recognized MusicXML | Opens the original file |
| Navigation, shortcuts, selection, playback, listen mode, keyboard, note highway | Unchanged | Same behavior |
| Note inspector | Includes homr fields (provenance, repairs, confidence) | Omits homr-only fields |

### 3.6 Native commands

New commands in `src-tauri/src/musicxml.rs`:

| Command | Behavior |
| --- | --- |
| `open_music_xml_score(path)` | Accepts only an existing `.musicxml`, `.xml`, or `.mxl` file. For `.mxl`, reads `META-INF/container.xml` and returns the first root file. Returns the XML text, the source SHA-256 and size, and the score-data folder path, creating the folder and updating its `manifest.json`. |
| `read_score_data(folder, name)` / `write_score_data(folder, name, contents)` | Read or atomically write a JSON file in a score-data folder. The folder must resolve inside `<app data>/musicxml-scores/` and the name must be one of an allowed set. |
| `open_score_data_directory(folder)` | Opens the folder in the system file manager, with the same check. |

`.mxl` reading uses the `zip` crate and hashing uses `sha2`. A root `.xml` file that is not `score-partwise` or `score-timewise` is rejected with a clear message. Rust tests cover the path checks and the container parsing; each check has a test that fails when the check is removed.

### 3.7 Per-score data folder

```text
<app data dir>/musicxml-scores/<sha256 of the source file>/
  manifest.json      schema version, source hash and size, format, last-seen path and name,
                     created and last-opened dates
  fingerings.json    predictions and, later, user overrides
  settings.json      added when the first per-score setting exists
```

Compared with the PDF cache:

- It lives in the app data directory (on Linux `~/.local/share/…`), not the cache directory, because per-score customizations are user data and the cache can be cleared at any time.
- It holds no copy of the score. All additions are overlays keyed by stable note keys.
- Like the PDF cache, it is keyed by content hash, so renaming or moving the file keeps its data. Editing the file creates a new folder. That costs nothing while the folder holds only predictions, which are regenerated in seconds. Before user overrides ship, a fallback will match the last-seen path recorded in `manifest.json` and carry overrides across by stable note key.

`fingerings.json`:

```json
{
  "schemaVersion": 1,
  "model": "lumikey-0.3.0-staff-hands-v1",
  "noteKeyScheme": 1,
  "predicted": { "P1/m12/s1/v1/n3": { "finger": 3, "left": false } },
  "overrides": {}
}
```

Predictions are reused only when `model` and `noteKeyScheme` match; otherwise they are regenerated.

## 4. Data flow details

### 4.1 Import

`parseMusicXml.ts` builds an engraving-oriented `ScoreModel`: part list and staff counts; per measure, the attributes (divisions, key, time, clefs, staff details), directions, barlines, repeats, endings, and print breaks; per staff and voice, a sequence of chords and rests with absolute time positions (resolving `backup` and `forward`), notes with pitch, notated type, dots, tuplet ratios, ties, accidentals, stem direction and beam information when encoded, notations, and printed fingerings.

Encoded layout hints (`default-x`, `default-y`, stem and beam directions, `<print>` breaks, `<defaults>` scaling and page layout) are kept in the model. Layout honors breaks and page format by default, matching MuseScore's import default, and computes everything else itself.

Elements outside the supported set are listed in the import report with counts and the first measure where each occurs. The report is written to the developer console and shown in the note inspector for MusicXML scores. Unsupported elements never remove notes from playback.

### 4.2 Layout and rendering

Layout follows MuseScore's approach and naming where practical, so its source can be consulted stage by stage:

1. Units are staff spaces (MuseScore's spatium). Page pixels come from the page format: millimetres from `<scaling>` and `<page-layout>`, else Letter or A4 with MuseScore 4's default 1.75 mm staff space, converted at 300 DPI.
2. Each measure is divided into time-ordered segments (clef, key, time, chord/rest, barline), as in MuseScore's `Segment` list.
3. Chord layout places noteheads (including seconds on the opposite side of the stem), accidentals in non-colliding columns, augmentation dots, ledger lines, and stems, with stem directions from the voice and the staff middle line.
4. Beams are grouped from encoded `<beam>` elements, else from the time signature's beat groups; slope and stem lengths follow MuseScore's beam rules.
5. Horizontal spacing assigns each segment a width from its duration relative to the shortest duration in the system, following MuseScore's horizontal spacing, then stretches measures to justify each system.
6. System and page breaking fill systems and pages, honoring encoded breaks.
7. Vertical spacing uses skylines so staves, dynamics, and spanners do not collide.
8. Spanners (ties, slurs, hairpins, pedal lines, ottavas, tuplet brackets, volta brackets) are laid out last, per system segment, with slurs as cubic Béziers avoiding noteheads.

Glyphs come from the Leland SMuFL font with its metadata JSON, which supplies the bounding boxes and stem anchors that layout needs. Text width comes from an injected `TextMeasurer`: a canvas-based measurer in the app and a deterministic one in tests.

`render/` draws the `LayoutModel` as SVG and does not compute positions. Notehead and stem outlines for the sidecar come from the same glyph metadata and layout positions, so highlights align exactly with what is drawn.

### 4.3 Fingerings

The PDF lifecycle writes predictions into a MusicXML copy. MusicXML scores use an overlay instead:

1. On open, read `fingerings.json`. If `model` and `noteKeyScheme` match, translate predictions from stable keys to page-scoped IDs and set `predictedFingerings`.
2. Otherwise run the existing predictor on the in-memory `documentMusicXml` (whose notes all have IDs), translate the result to stable keys, and write `fingerings.json`.
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
- Grace notes with real MusicXML `<grace>` elements; the sidecar duration string marks them as homr does.
- Tuplets via `time-modification`, repeats with voltas, and `sound` tempo changes.
- Scores with more than one part. Hand assignment uses the existing staff/clef rule within a keyboard part; fingering prediction runs only on keyboard parts.

Any change to shared playback code is checked against PDFs as well, so behavior for recognized PDFs does not change unless the change is intended.

## 7. Testing and verification

- Unit tests for each stage, run by `npm test`.
- Contract tests from section 3.4, run on every corpus score.
- Module-boundary test from section 3.1.
- Native tests for every path and format check in section 3.6.

Corpus:

- `../omr-evals/cases/ground-truth/musescore/`: 26 MuseScore-exported `.mxl` files, each with the PDF MuseScore engraved from it (MuseScore 1.1 to 4.2, mostly 3.6). These are the primary visual references; the older PDFs differ in house style, so MuseScore 4 renderings (below) are the reference for current appearance. They include encoded system and page breaks, multiple voices, tuplets, grace notes, slurs, pedal markings, and printed fingerings (for example, 96 in the Nocturne Op. 9 No. 2).
- `../omr-evals/cases/ground-truth/ninsheetmusic/mus/`: MusicXML exported from the source `.mus` files (2 so far, more as the export proceeds), for scores not written in MuseScore.

Visual comparison: a script under `tools/` renders each corpus score with the new renderer and places each page beside the reference PDF page, or beside a rendering from the locally installed MuseScore 4 (`mscore4portable -o page.png score.mxl`). Pages are reviewed by eye; there is no pixel-equality target, because small spacing differences are acceptable while missing or misplaced symbols are not.

## 8. Phases

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 1. Skeleton | Module folder, boundary test, native open command for `.musicxml`/`.xml`/`.mxl`, score-data folder, `source` on `LoadedDocument`, UI gating | A corpus file opens and shows blank pages of the right size; Diagnostics hidden; PDFs unchanged. |
| 2. Notes on staves | Import, page format, segments, chords, stems, simple beams, spacing, encoded breaks, SVG rendering, sidecar builder | All corpus scores render notes and rests on correct staves with correct pitches; contract tests pass; selection and highlighting work. |
| 3. Playback parity | Page-scoped IDs, document adapter, playback fixes from section 6 | Note-by-note and realtime playback, navigation, shortcuts, keyboard, and note highway behave as for PDFs on every corpus score. |
| 4. Fingerings | Overlay lifecycle, source precedence | Predictions persist across reopenings and survive moving the file; printed fingerings are never replaced. |
| 5. Section 5.1 complete | Remaining required notation | Side-by-side review of every corpus page shows no missing or misplaced required symbols. |
| 6. Section 5.2 | Second-stage notation | Same review for the second-stage symbols. |

Each phase is a separate reviewable commit series on the `musicxml` branch.

## 9. Risks and open questions

- **Page-scoped IDs.** The existing code identifies notes by page. The adapter hides this behind stable keys, but a later cleanup could give the viewer contract a document-level ID and remove the page coupling for both sources.
- **Layout effort.** Engraving quality is the largest cost. Following MuseScore stage by stage limits the design risk; the corpus review keeps quality measurable.
- **Performance.** The largest corpus file is about 2.2 MB of MusicXML. Layout runs once per open and can move to a Web Worker; rendering is limited to visible pages.
- **Licensing.** The viewer is AGPL-3.0 and MuseScore is GPL-3.0; GPL-3.0 section 13 permits combining the two, so MuseScore code may be ported with attribution. Leland is SIL OFL and ships with its license.
- **Edited source files.** Content-hash keying orphans data when the file changes. Harmless for predictions; the path fallback in section 3.7 is required before user overrides ship.
- **Open decision:** whether a single "Open score…" dialog (proposed) or separate "Open PDF…" and "Open MusicXML…" entries suit the UI better.
