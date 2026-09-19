# PDF fingering experiment — feasibility review

Decision: proceed with a default-off experiment for clean, conventionally arranged
piano pages with validated geometry. Do not claim support for noisy scans,
ambiguous simultaneous voices, unisons, cross-staff associations, partial chords
or automatic handling of existing printed fingerings. Marked passages need the
manual display policy before normal use. This is a desktop Chromium feasibility
decision, not completion of the target Tauri/touchscreen release checks.

## Reproduction and evidence

The 16 matched baseline fixtures and one unavailable Chopin reference are pinned
in `fingering-fixtures.json`. The prototype regenerates matched MusicXML/sidecars
into ignored `testdata/fingering-prototype/<fixture-id>/`; it never modifies the
source PDF or user caches. Each packet has frozen synthetic cyclic 1–5 values
computed from its regenerated MusicXML. These exercise placement and hand
assignment, not the quality of model fingering recommendations. Packet hashes
are in `fingering-experiment-results.json`.

From the viewer root:

```sh
PYTHONPATH=../homr:worker .venv/bin/python tools/fingering-prototype-data.py --split all
webapp/node_modules/.bin/esbuild webapp/tools/fingering-prototype.ts --bundle --format=iife --outfile=testdata/fingering-prototype/prototype.js
webapp/node_modules/.bin/esbuild webapp/src/fingeringWorker.ts --bundle --format=iife --outfile=testdata/fingering-prototype/worker.js
node tools/fingering-render.mjs --split all
.venv/bin/python tools/fingering-review-metrics.py
```

Each case contains original, annotated and debug PNGs at a 1300px reading width.
The debug view includes pooled ink, staff curves, label bounds and suppressed
anchors. Browser rendering waits for fonts, the annotation worker and image
decode. Repeated independent loads must return identical source-coordinate
bounds. Half-width Bach and double-width Chopin checks also returned identical
bounds. At half-width the small digits require zoom for comfortable reading;
the renderer never shrinks them further to fit a crowded passage.

## Coverage (no manual exclusions)

| Set with usable geometry | Pitched notes | Fixed predictions | Usable links | Supported digits | Placed digits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development, 7 pages | 2056 | 2053 | 2056 | 1979 | 1943 |
| Held-out, 7 pages | 2230 | 2224 | 2223 | 1949 | 1904 |
| Total, 14 pages | 4286 | 4277 | 4279 | 3928 | 3847 |

Placement coverage is 97.94% of supported digits; end-to-end coverage on the
14 available pages is 89.95% of fixed predictions. Two additional baseline
pages (Chrono Trigger fanfare and Mario ground theme, 188 and 208 baseline pitched
values) are wholly unavailable because detected staff curves fail spacing
validation. They are not included in the 14-page success denominator: including
their baseline values gives 82.32% coverage against 4673 available-or-baseline
values. This mixed-generation figure is labeled explicitly, not presented as an
exact prediction count. Chopin No. 6 failed before usable associations could be
written and has no measured prediction denominator at all.

Ordinary Bach/Mozart pages place 100% of their supported requests except the dense
Mozart Rondo (92.76%). Beethoven pages place 95.02% and 96.66%. Marked Chopin pages
place 94.22–99.16% of supported requests, but their end-to-end coverage ranges
from 61.62% to 98.89%; unsupported simultaneous voices account for much of that
gap. Per-page reason counts, chord stack counts and both denominators are retained
in the machine-readable report.

## Visual findings and changes

The first Bach review revealed digits slipping into white gaps beneath beams.
Although collision-free, the rows were visually uneven. Layout v2 establishes
a measure baseline outside its complete linked notehead/stem envelope before
searching lanes. A regression test locks this behavior.

Held-out Chopin exposed another ambiguity: independent simultaneous stems could
look like a chord stack when individual labels occupied different lanes at one
x position. Support was narrowed to suppress those physical onsets unless one
proven visual chord owns them. No placement thresholds were retuned, but this
support change used held-out evidence: the final held-out figures are regression
validation after that scope correction, not an untouched blind evaluation.

Reviewed views show readable ordinary-page digits, clear horizontal note
association and top-to-bottom chord order. No known incorrect displayed
digit-to-note association was found in the inspected examples. The original vs
annotated browser PNG comparison found **zero blue-label pixels on original dark
notation pixels on all 14 pages**, independently of the layout's obstacle map.
This pixel check supplements visual inspection; it does not prove musical
association or measure recognition accuracy.

Printed black digits remain present in the Chopin images. The blue overlay can
offer contradictory instructions beside them even without ink overlap. Geometry
does not solve that problem: use score/page/region exclusion, with raw source
values preserved independently. No OCR or erasure is justified by this review.

## Performance and remaining checks

Reference device: AMD Ryzen 9 5950X, Linux x86_64, local headless Google Chrome.
Python mask production took 116–188 ms on development pages; the real browser
worker took 46.5–93.8 ms for integral construction, request building and layout.
Actual per-page integral buffers were 8.0–10.9 MiB. Python peak process RSS was
126 MiB including decoding/runtime. These component measurements support the
initial 500 ms budget on this device. They do not measure the integrated app's
peak memory or guarantee no UI stall; those checks belong to Task 10.

Checks passed: full webapp suite/build, 135 HOMR sidecar/evaluator tests (plus
6 subtests), worker mask/transport tests, deterministic repeated browser loads,
and independent rendered-pixel overlap checks. Optional invalid geometry now
disables only annotation capability rather than invalidating normal score output.

Still required for release: integrated keyboard-hidden/selection/gesture checks,
durable policy verification, cache/stale-result lifecycle tests, target Tauri
webview and touchscreen review, and a truly independent held-out sample after the
voice-support correction. No noisy-scan claim is supported by this corpus.
