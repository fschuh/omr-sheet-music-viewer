# Printed-fingering recognition: real-scan transfer challenge

2026-09-19, Task 13 follow-up to the [clean pilot](fingering-recognition-report.md).
**Recommendation unchanged: no automatic adoption, no erasure, no custom model
training yet.** The supplied scans now extend the bounded research deliverable to
older engraving fonts, degraded ink, paper texture/warping, sparse markings and
measure-number negatives. This completes the planned initial measured recommendation,
not a claim of production recognition or general scan-overlay support.

## Inputs and annotation

The first pages of all three user-supplied PDFs were rendered and visually reviewed:

| Source | Pages in PDF | Reviewed gold digits | Relevant characteristics |
| --- | ---: | ---: | --- |
| Peters Chopin Nocturnes Op. 9 | 11 | 16 | Older font, above/below-staff digits, broken/thickened ink; source monochrome image is 1200 dpi |
| Chopin Fantaisie-Impromptu Op. 66 | 6 | 11 | Coarse engraving scan, closely spaced digits, staff/beam interference, triplet markings |
| Joe Hisaishi, Fantasia (for Nausica) | 7 | 5 | Visible paper noise, watermark and page warping, sparse digits, boxed measure numbers; includes two digits in `1–5` |

These are three reviewed pages out of 24, not whole-document validation. Fourteen
manually chosen windows are fully annotated for the visible finger digits: seven
positive/mixed windows and seven negative-only windows. All 32 digits stay in the
denominator. The compound `1–5` is transcribed as two glyphs but deliberately has
**no adopted note/value semantics**. It is not treated as two independent confirmed
finger values. The other 30 marks are single-digit examples.

[The manifest](fingering-recognition-scans.json) pins original PDFs, 2550-pixel-wide
OCR rasters, separate 1920-pixel-wide HOMR rasters' MusicXML/sidecar outputs, source
boxes and gold note identities. [Raw results](fingering-recognition-scan-results.json)
record every prediction and all denominators. Original PDFs and application caches
were not modified. Derived pages/crops remain under ignored `testdata/`.

Gold boxes and note targets were visually checked **before the first scan OCR run**;
their coordinates were not fitted to OCR output. Four Impromptu target notes have
no canonical link: two visual groups are diagnostic and two are fallback links.
They remain explicit unavailable targets rather than being repaired or omitted.
The two compound glyphs also have unavailable adoption semantics. Thus 26/32 gold
digits have usable canonical target IDs in this experiment. Missing optional staff
curves do not invalidate those note identities for research, but they do prevent
production overlay placement (see below).

This is a **fixed-setting transfer challenge**, not a randomly sampled or blind
annotation benchmark. It was added after the clean pilot; no OCR models, score
thresholds, digit filter, proximity thresholds, or matching thresholds were tuned
on these scans. Crops still supply favorable search regions. The old association
baseline now receives all canonical physical staves, necessary to test bass/later
systems; its rule remains unchanged: a note must be below the glyph, within six
horizontal and 70 vertical pixels at normalized 1300-pixel page width. No special
below-staff or compound handling was added. This intentional limitation is counted,
not presented as a failure of a fully implemented association system.

## Measured results

RapidOCR 3.7.0, the same cached PP-OCRv4 ONNX models/hashes, CPU, one intra/inter-op
thread, classification off, confidence ≥0.5, and exact single-digit `[1-5]` output
filter. Poppler 26.01.0 renders the OCR inputs at width 2550, preserving aspect ratio.
This downsamples the Peters original and upsamples the Hisaishi embedded scan; it
does not add detail to the latter. It is a controlled input size, not native 1200-dpi
OCR. No denoising, deskewing, staff removal or model training was performed.

As in the clean pilot, one-to-one IoU ≥0.1 measures candidate location, not precise
erasure bounds. A merged text box counts at most once. Digit-value scoring also
requires exact transcription; assignment also requires the exact canonical note
ID. Null gold/prediction IDs can never count as a correct association.

| Stage | Correct / proposed | Recall against all 32 | Precision |
| --- | ---: | ---: | ---: |
| OCR text proposals, location only | 23 / 28 | 71.88% | 82.14% |
| Filtered digit candidates, location and correct value | 21 / 23 | 65.62% | 91.30% |
| OCR + frozen association, correct value and note | 12 / 23 | 37.50% | 52.17% |
| PDF ASCII digit proposals | 0 / 0 | 0% | undefined |
| Transcription with manually supplied glyph crops | 29 / 29 | 90.62% | 100% |
| Association with oracle boxes/values | 15 / 15 | 46.88% | 100% |
| Oracle association rejecting ambiguous columns | 15 / 15 | 46.88% | 100% |

Full-pipeline precision keeps **all** digit proposals, including those with no
assigned note. All 12 actually assigned scan proposals were correct in this small
set; the other 11 proposals abstained. Do not confuse the 52.17% all-proposal
precision with a 47.83% wrong-note rate. The clean pilot already demonstrated four
wrong chord assignments; no absence-of-error guarantee follows from these scans.

| Page | Correct digits / gold | Digit proposals | Correct value+note / gold |
| --- | ---: | ---: | ---: |
| Nocturnes | 14 / 16 | 15 | 8 / 16 |
| Impromptu | 2 / 11 | 2 | 1 / 11 |
| Hisaishi | 5 / 5 | 6 | 3 / 5 |

Per-page figures include each page's hard-negative windows. Hisaishi's 5/5 digit
result includes the two compound glyphs; it is **not** five supported adoptions.
The 17 oracle association omissions are eleven below-staff digits, four missing
canonical links and two compound glyphs. Among 26 canonical targets, the frozen
oracle association covers 15/26; end-to-end value+note coverage is 12/26. Neither
restricted denominator replaces the all-32 headline.

### Failure review

- **Dense OCR grouping:** Impromptu's three adjacent upper digits became `423`;
  three lower digits became `321`. The fixed single-digit filter rejects these
  strings rather than inventing individual positions. The upper merged box may
  match one glyph in location-only scoring, never three. Future per-character
  boxes are an experiment to test, not assumed correct associations.
- **Notation touching glyph crops:** manually supplied crops read 29/32 correctly
  above threshold. A Nocturne `5` became `5.` near pedal ink; an Impromptu `4`
  intersecting a staff line became `f`; another `5` scored 0.45424 and was rejected.
  Oracle crops provide locations, not artificial removal of nearby notation.
- **Hard negatives:** boxed Hisaishi measure number `4` was accepted at 0.99977;
  Nocturnes page number `3` at 0.99392. A boxed `1` was missed. Tuplet `11` was read
  as a multi-character string and rejected. The Hisaishi bracketed triplet yielded
  `3一`, also rejected. The Impromptu tuplet 3s, octave indication, Nocturne time
  signature and paper-texture window yielded no accepted digit. These selective
  successes do not establish semantic classification or safe confidence thresholds.
- **PDF text is not ground truth:** both Chopin pages have no extractable page
  text. Hisaishi does contain a partial, inaccurate text layer, including prose and
  musical instructions, but no ASCII finger candidate in the evaluation windows.
  A scanned PDF may have a text layer without useful finger identities.

## Existing OMR and overlay capability checks

The current feature-branch HOMR producer (`a750ab029cd035474f6e4a2f82b4815f3d8d0c54`)
completed all three first pages. It emitted zero MusicXML `fingering` elements on
each, so existing source-fingering recovery is 0/32 with undefined precision, not a
claim about an implemented HOMR fingering classifier. The source PDFs' printed
finger values were never replaced by predictions in this experiment.

| Page | Sidecar note records | Optional staff-curve capability |
| --- | ---: | --- |
| Nocturnes | 378 | Unavailable: `Unordered lines or implausible staff spacing` |
| Impromptu | 461 | Exported |
| Hisaishi | 192 | Unavailable: `Unordered lines or implausible staff spacing` |

The existing optional-geometry guard preserves ordinary recognition while
withholding overlay placement on the two failing pages. It was not loosened to
improve a coverage number. Impromptu's exported curves alone are not visual
certification of an overlay; no scan overlay render is claimed here. Real scan
placement/legibility, packaged Tauri interaction, hardware touch/GPU and other OS
webviews remain separate acceptance work. These scans close the **missing research
input** gap, not all platform or scan-layout release gates.

## Decision and remaining work

Keep the [explicit confirmation workflow](fingering-recognition-report.md#proposed-confirmation-workflow--not-implemented-in-this-research-task):
show source crop, candidate note and uncertainty; preserve provenance/revision;
never replace a user override silently; keep exclusion and value adoption separate.
The compound form must remain unadoptable until its semantics and representation
are explicit. Existing editing/exclusion controls remain the supported workflow.

The combined clean+scan research set covers 47 printed glyphs, but pooling its
selected windows into a purported population accuracy would be misleading. This
evidence supports a no-go for automatic adoption. Before custom training, compare
existing per-character OCR localization and context-aware tuplet/measure rejection,
then validate chord order, below-staff association and compound forms independently.
Audiveris was capability-reviewed in the clean report but remains unbenchmarked
locally; no piano accuracy is inferred from its documented guitar workflow.

Future tuning must treat these now-inspected scans as development data and reserve
new pages/editions for evaluation. Larger balanced, whole-page gold sets, adjudicated
note identities, more fonts and scan conditions are needed before production claims.
No new model, automatic adoption, note-link repair, erasure or PDF rewrite was added.

## Reproduction and verification

```sh
# Verify existing local inputs, or add --recognize to create missing OMR artifacts.
.venv/bin/python tools/fingering-scan-prepare.py
.venv/bin/python tools/fingering-recognition-pilot.py --manifest plans/fingering-recognition-scans.json --artifact-dir testdata/fingering-scans/review --pdf-root /home/fschuh/Documents/sheet-music/Scans --output /tmp/fingering-scan-repeat.json
.venv/bin/python -m unittest discover -s tools -p 'test_fingering*.py' -v
```

The preparation tool verifies PDF hashes, renders only absent derived images, and
never overwrites existing OMR artifacts. Changed producer/raster hashes stop the
run for manual annotation review. It uses the existing local CPU preparation path,
not the user's application cache. Review all crop PNGs and the glyph atlas under
`testdata/fingering-scans/review/`; these were visually inspected before scoring.

Thirteen scoring tests cover both result artifacts, unavailable-target denominators,
all-staff canonical filtering and below-staff abstention, in addition to the clean
pilot's matching/value/association tests. Four preparation tests check preservation
of existing, mismatched and partial artifacts and explicit recognition opt-in.
Both the scan run and the original clean
run are repeated and compared exactly except elapsed seconds; model/input hashes
remain recorded. Green connectors in the marked context crops show verified gold
targets; orange connectors show manually identified printed targets whose OMR
associations are unavailable, never fabricated IDs. These were visually rechecked.
This research-only extension changes no viewer behavior.

Final checks passed: all 17 research/preparation tests, full web tests and production
build, 27 worker tests, 135 HOMR geometry/sidecar tests plus six subtests, six native
tests, and the original 16 matched fixture checks. The three scan PDFs and derived
inputs were hash-verified again. Existing chunk-size and Python dependency/deprecation
warnings remain; no dependency upgrade or new device/browser coverage is implied.
