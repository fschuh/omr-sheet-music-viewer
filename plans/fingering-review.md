# Fingering placement baseline

The manifest pins 12 local pages, their PDFs, page rasters, recognized MusicXML,
v3 sidecars and fixed digit values. Paths are relative to the workspace containing
both repositories and `omr-evals`. Verify with `python3 tools/fingering-fixtures.py`.
Source editions/arrangements have no established redistribution license here;
only hashes, metadata and synthetic test digits are committed. Classical
composition age is not evidence of an edition's license.

The cyclic values are frozen layout test inputs, **not predictions or recommended
fingerings**. All pitched notes remain in the denominator, including unlinked
ones. Future model snapshots must be separately identified and locked.

Held-out pages are fixed before tuning. Do not use them to choose thresholds.
The screenshots mentioned in the proposal were not supplied and are not fixtures.
The current corpus does not establish coverage of noisy/skewed scans, printed
fingerings, octave lines or cross-staff writing. These remain required challenge
fixtures; do not claim Task 01 acceptance or a release gate until they are added
and reviewed. Synthetic algorithm tests cannot substitute for real scan review.

## Review protocol

1. Verify the manifest; record producer revision, layout version, font, device,
   viewport, zoom and prediction/value snapshot with each review.
2. Review original, overlay and debug views at reading size, then 50%, 100%,
   200% zoom. Keep source coordinates in all region notes.
3. Classify each fault as **association** (wrong printed note), **layout**
   (collision, unreadable, distant, jagged baseline), or **no legal space**.
   A missing link is unavailable; it is not successful suppression.
4. Count all pitched values, usable authoritative links, supported notes before
   exclusions, eligible notes after exclusions, placed digits, suppressed digits,
   unavailable digits and chord stacks. Report each reason and each page category.
5. Check digit order against notehead order, especially left-hand stacks. Inspect
   independent stems, ties, repeats and simultaneous voices separately.
6. Review held-out pages only after thresholds are frozen. Record failures and
   narrow support explicitly; never drop failures from the denominator.

## Initial manually reviewed regions

Für Elise page 1, original 2481 × 3508 raster (rectangles are x0,y0,x1,y1):

| Region | Bounds | Baseline observation |
| --- | --- | --- |
| Above first treble run | 450,260,810,285 | Blank candidate corridor; association must still be checked |
| First-system heading | 280,270,580,330 | Unsafe: Poco moto text |
| First-system notes/beams | 280,345,810,450 | Unsafe: printed notation |
| Third-system ledger note | 1030,1340,1100,1450 | Unsafe: ledger lines and high note |
| Fifth-system instructions | 450,2390,860,2470 | Unsafe: tempo text and beam |

These rectangles are review anchors, not production obstacles or ground-truth
engraved positions. No real passage has yet been certified as having no legal
space; that judgment must follow candidate/rendered-output review.
