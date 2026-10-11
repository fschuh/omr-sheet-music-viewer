# Meter reader and tuplet repair plan

Date: 2026-10-09
Status: steps 1 to 6 prototyped and measured in scratch copies (2026-10-10); step 7 (with the
viewer toggles and the carry from step 8) implemented on `false_rest_detector` in homr and the
viewer (2026-10-10); see "Step 7" in section 6. omr-evals is unchanged.

**Where things are (note added 2026-10-10, when this plan moved into the viewer repo).** The
prototypes, scripts and run folders named in sections 4 and 6 (`proto2` to `proto9`,
`ts/ts_reader.py`, `m3_pool_run.py`, `timing.py`, runs such as `ts_ms` or `m9_gt`) lived in a
temporary session scratchpad and were not kept. Those entries record what was measured then, and
are left as written. The shipped code is in homr's `homr/visual_sidecar/` (`time_signatures.py`,
`tuplet_numerals.py`, `tuplet_repairs.py`) and in this repo's worker and web app; the commits are
listed under "Step 7".

## 1. Why

On the classical pieces, the largest duration error by far is a missed tuplet: homr writes the
right note value without its tuplet ratio. On the MuseScore ground-truth set that is 25.4% of
aligned notes, against 0.7% for other wrong durations. Most missed groups are a single beamed
group with no printed numeral, as with six 16ths under one beam in a beat.

A repair can only be trusted if the bar it fixes has a known length. homr does not read that
length from the page:

- The transformer's time-signature token carries only the bottom number (`timeSignature/4`).
- The writer infers the top number from the median bar length of each meter section.
- Missed tuplets make bars too long, so the inferred meter goes wrong too. In the Aeolian Harp
  etude, for example, 4/4 is inferred as 3/2. The gate then checks the repair against the
  wrong length and refuses it.
- homr runs once per page and doesn't carry a meter from one page to the next. A page without
  a printed time signature infers its own.

Upstream doesn't solve this. Model 465 (upstream main at edebb40, measured 2026-10-08) misses
tuplets as often as our model 396 does: 25.3% against 25.4%. Upstream's time-signature token
still carries only the bottom number, and its writer still infers the top one.

## 2. Constraints

- Experiments stay in scratch until approved. The homr branch, the viewer and omr-evals are
  not changed during the prototype.
- homr changes stay merge-friendly. Logic goes in fork-only modules (`homr/visual_sidecar/`)
  with only small hooks in upstream files. Upstream signatures don't change; at most one new
  optional argument.
- Viewer changes happen only on `false_rest_detector` and are committed promptly.
- A note-value repair needs image evidence. Repairs based on duration alone were measured and
  rejected earlier: about half were wrong.
- No staff may get worse than in the current run, compared row by row.
- Every stated rule gets a test that fails without it.

## 3. Baseline (fork, model 396, MuseScore set)

| Measure | Value |
| --- | --- |
| Ground-truth notes found by pitch | 89.9% |
| Exact duration | 73.0% |
| Missed tuplet | 25.4% |
| Extra tuplet | 0.9% |
| Other wrong duration | 0.7% |
| Bars under the wrong meter, joined score | 18.0% |
| Bars under the wrong meter, per page | 28.5% |
| Bars that add up under homr's meter | 69.9% |
| Bars that add up under the true meter | 62.4% |
| First pages that write the true meter | 19 of 26 |

On the videogame set, the joined score's meter is wrong on 0.1% of bars.

## 4. Ground truth and tools

- **MuseScore set**: 26 pieces, 123 pages, PDF plus MXL, so note values and meters are exact.
  Location: `omr-evals/cases/ground-truth/musescore`.
- **Videogame set**: 70 PDF plus MIDI pairs (`omr-evals/cases/ground-truth/ninsheetmusic`).
  The MIDI is a performance export, so it checks onsets (±0.09 quarters) and time signatures,
  never durations.
- **240-page corpus**: `~/Documents/sheet-music` rendered at 300 DPI. It has no ground truth
  and is used only for coverage and review.
- **Scratch tooling** in the session scratchpad:
  - `pool_run.py`: shared-queue runner, 20 workers over both GPUs.
  - `ms_compare_runs.py`: compares runs on the MuseScore set from their MusicXML alone (notes,
    durations, tuplets, meter).
  - `ms_meter.py` and `gt_meter.py`: meter correctness on each set.
  - `ms_tuplets2.py`: missed tuplet groups by beaming.
  - `ms_eval.py`: reader, flags and repairs against exact values.
  - `gtv_notes.py`: repairs against MIDI onsets.
  - `proto2/homr`: copy of homr d24fe6a carrying the value-repair and beam-group prototypes.

## 5. Steps

Each step ends with a measurement and a go/no-go from the user before the next one starts.

### A. Meter reader (homr, scratch copy)

**Step 1. Read the printed time signature.**

- Find it on the staff: after the clef and key at the start of a system, or mid-staff at a
  meter change.
- Read the top and bottom numbers, plus common time (C) and cut time (¢).
- Throw out any read whose bottom number disagrees with homr's token.
- Output is a sidecar block only; the MusicXML doesn't change yet.

*Measure* reads against:

- the MuseScore first pages and meter changes;
- the videogame set's MIDI time signatures;
- read and unread counts on the 240 corpus pages.

*Goal*: no wrong reads (0 wrong in N bounds the error rate below about 3/N), and report how
many pages get a read.

**Step 2. Use the read meter in the writer.**

- A read meter replaces the inferred top number for its section.
- The hook goes through `TimingRepairs.section_nominators()` and `division_and_nominator()`,
  which are fork-only, so no upstream lines should be needed.
- Pages without a printed meter still infer it as today.

*Measure*:

- the MuseScore wrong-meter rate (18.0% joined, 28.5% per page);
- bars that add up;
- no staff worse than in the current run;
- the videogame set no worse than 0.1%.

**Step 3. Carry the meter across pages**, in the scratch runner only.

- Each score's pages run in order. Page N+1 starts from page N's final meter, and a time
  signature printed on the page overrides it.
- *Measure* the same numbers as step 2, focused on pages 2 onward.
- **Decision point**: if most of the gain already comes from step 2, drop this step. That
  avoids a new homr input and the changes to the viewer and omr-evals in step 8.

### B. Tuplet repair from beaming

**Step 4. Measure the beam-group detector.** The prototype is `stem_end` and `beamed_together`
in `proto2`. Compare "these notes share a beam" with the `<beam>` elements in the MuseScore
MXLs, reporting how often it is right and how often it finds the group.

**Step 5. Tuplet gate with the true meter.**

- *Candidates*: beam groups whose total doesn't come to a power-of-two value.
- *Repair only when*:
  - the bar is broken as the writer places it and comes out exact after the repair;
  - no staff gets worse;
  - the bar length is supported by at least 3 bars that need no repair.

*Measure* against MuseScore's exact durations and the videogame MIDI onsets.

*Goal*: no wrong repairs. That's the same bar the gated value repair failed with 1 wrong in 21,
which is why it wasn't shipped.

### C. Printed tuplet numerals

**Step 6. Read printed tuplet numbers ("3") and their brackets**, and repair the bracketed span
through the step 5 gate.

- This is what Lucca bar 12 needs. Its meter (2/4) is already right, and neither the meter
  reader nor the beam reader helps it.
- *Measure* on Lucca and on the MuseScore groups that print their numeral, about 5 to 10% of
  missed groups.

### D. Shipping (each piece only with the user's approval)

**Step 7. Move the proven pieces onto `false_rest_detector` in homr**, with tests, a docs
section and the sidecar block. In the viewer, add a display if useful, plus a cache revision
bump.

**Step 8. Only if step 3 is kept:**

- an optional meter argument in homr;
- the viewer worker (already sequential) passing the meter between pages;
- omr-evals' `parallel.py` scheduling by score instead of by page. Longest score first, rerun a
  whole score when any page of it needs a run, and a failed page passes no meter on.

A plain single-page homr call keeps working unchanged. If page-by-page callers find the extra
argument burdensome, upstream's multi-page `run_homr` loop could carry the meter internally
instead.

The gated value repair stays unshipped. It may later merge into the step 5 gate, since both
use the same bar check.

## 6. Progress

**Step 1 prototype (2026-10-10), scratch `ts/ts_reader.py`, run offline on fork outputs.**

How the reader works:

- It removes staff lines only where the ink run is exactly the line's own thickness. That
  keeps the hairline arcs of C and ¢.
- It groups the remaining fragments into glyphs. It reads number pairs stacked between the
  lines (a pair that touches is split at the middle line), and reads C and ¢ centred on the
  middle line.
- It sends each glyph to OCR on its own; for ¢, the stroke is removed first.

The page is read twice: once removing exactly the line thickness, and once with one pixel of
slack for scans. A read is accepted only when:

1. homr's token in that system has the same bottom number (C is 4, ¢ is 2);
2. the meter is valid;
3. no two reads of it (staves or passes) disagree. A glyph OCR could not read doesn't count.

Results:

| Set | Accepted reads | Wrong | Coverage |
| --- | --- | --- | --- |
| MuseScore | 29 | 0 | every printed signature (26 first pages plus 3 changes) |
| Videogame | 73 | 0 | 70 of 70 first pages |
| 240-page corpus (reviewed by eye) | 87 | 0 | 74 of 76 first pages |

- **Overall:** 189 reads, 0 wrong, so the error rate is below about 1.6%.
- **Scans:** about 6 signatures are still missed (Peters Nocturnes, the op. 66 scan), because
  scanned line thickness varies.
- **Top number:** on the Peters scan the two passes read 6/1 and 6/4, so the signature is
  dropped. A misread top number can't be caught by the token, and none was seen.
- **False tokens:** homr emits time-signature tokens where nothing is printed, mostly `/16` at
  repeat signs: about 15 in the corpus, 9 in the videogame set and 5 in the MuseScore set.
  Each one starts a new meter section in the writer. The reader finds nothing there, so step 2
  could drop them.

**Step 2 prototype (2026-10-10), scratch `proto3`, full homr runs.**

How it works:

- The reader runs in the background while the transformer reads the staffs, as the tempo-mark
  reader does (`visual_sidecar/time_signatures.py`).
- Each time-signature token is tied to the nearest read in its system by its position on the
  page (source pixels), within 6 staff spaces. A token takes the read's top number only when
  the bottom numbers agree.
- In the writer, the read meter replaces the inferred bar length of that token's section,
  through `TimingRepairs.section_nominators()`. No upstream lines change beyond the call that
  starts the reader.
- The sidecar gets a `time_signatures` block: each token's status (`read`, `no_read`,
  `beat_type_differs`) and the reads no token claimed.

Results:

| Measure | Baseline | Step 2 |
| --- | --- | --- |
| MuseScore: bars under the wrong meter, joined score | 18.0% | 3.1% |
| MuseScore: bars under the wrong meter, per page | 28.5% | 23.7% |
| MuseScore: same, pages 2 onward only (76% of bars) | 31.2% | 31.2% |
| MuseScore: first pages writing the true meter | 19 of 26 | 25 of 26 |
| MuseScore: bars that add up under the true meter | 62.4% | 62.4% |
| Videogame: bars under the wrong meter, joined score | 0.1% | 0.1% |

- **Tokens:** MuseScore 29 read, 5 without a read (the Turkish March's false tokens at its key
  changes, and one Mozart page). Videogame 73 read, 9 without. Corpus 85 read, 25 without.
- **First pages:** every MuseScore and videogame first page reads; the corpus misses the two
  known scans (Peters Nocturnes, op. 66).
- **Notes:** changed on only 5 MuseScore pages and 2 corpus pages, none worse against the
  ground truth. Measure rests now fill the true bar (4/4 instead of 6/4). Videogame output is
  byte-identical: homr's inferred meters were already right there.
- **The remaining 3.1%** is mostly the Turkish March, whose unprinted tokens start inferred
  sections (16/16, 4/8, 8/16), and Moonlight 2nd movement, whose ground truth has unprinted
  meter changes.
- **Unclaimed reads:** courtesy signatures at line ends, and two "1/1" reads on the op. 66
  scan. Requiring a token keeps both out.
- **Speed:** the first port cost 4 to 5 s a page. Vectorizing the line removal (identical
  output on 40 pages) made it about 23 times faster.
- **Step 2 alone does nothing for pages 2 onward**, which have no printed meter. That is what
  step 3 is for, and what the tuplet gate needs there.

**Step 3 prototype (2026-10-10), scratch `proto4` and `m3_pool_run.py`.**

How it works:

- The runner takes a whole score per worker, longest first, and runs its pages in order.
- Before each page it sets the meter in force at the end of the previous page, and after the
  page it reads the page's `carried_out` from the sidecar. A failed page passes no meter on.
- The carried meter governs the bars before the page's first time signature. The page restates
  it as an unprinted time signature (`<time print-object="no">`).
- Only a trusted meter is carried: one read on the page, or carried to it.
- Variant "keep" (`UNREAD_TOKENS=keep`): a time-signature token with no read, under a trusted
  meter, keeps that meter and is not written. Without it, such a token starts an inferred
  section and ends the carry.

MuseScore set:

| Bars under the wrong meter | Baseline | Step 2 | Step 2 + keep | Carry | Carry + keep |
| --- | --- | --- | --- | --- | --- |
| Joined score | 18.0% | 3.1% | 3.1% | 3.1% | 0.5% |
| Per page | 28.5% | 23.7% | 23.7% | 6.1% | 2.0% |
| Per page, pages 2 onward | 31.2% | 31.2% | 31.2% | 7.9% | 2.5% |

- **Videogame set:** carry takes pages 2 onward from 3.1% wrong per page to 0.0%. The joined
  score stays at 0.1%, and no note changes on any page, with or without keep.
- **What is left** under carry + keep is ground-truth quirks: Moonlight 2nd movement's
  unprinted meter changes (7 bars), the Cello étude's 11/4 introduction bar (1), and 2
  Nocturne bars.
- **Keep fixes the Turkish March:** its unprinted tokens at key changes no longer start
  sections.
- **Decision point:** step 2 alone leaves pages 2 onward exactly where they were, and step 3
  takes them from 31.2% to 2.5%. By the plan's rule step 3 stays, so step 8 applies when
  shipping.
- **Notes**, against step 2: 24 staff-bars change. 4 are better (17 more notes exact), 19 the
  same, and 1 worse: Nocturne op. 9 no. 2, page 3, bar 9, from 7 exact notes to 1 of 32.
  - That bar is an ornamental run homr reads too long under any meter.
  - With the true 12/8 bar length, the existing bar-placement heuristic in `bar_placement.py`
    picks the other of its two placement rules.
  - This breaks "no staff worse"; the rule choice for bars broken under every rule is an open
    question.

**Step 4 (2026-10-10), scratch `proto4` with `BEAM_PROBE=1`, MuseScore set.**

The probe writes the detector's beam groups into the MusicXML as `<beam>` elements, which are
compared with the ground truth's (`ms_beams.py`). Two chords count as a pair when they follow
each other on a staff and line up with two chords that follow each other in one ground-truth
voice.

| Measure | Value |
| --- | --- |
| Pairs | 22,303 (16,607 beamed in the ground truth) |
| Detector says beamed: right / wrong | 15,581 / 33 (99.8% right) |
| Beamed pairs it finds | 93.8% |
| Tuplet beam groups (1,746): exact / split / missed / merged | 86% / 12% / 1% / 0% |
| Plain beam groups (3,981): exact / split / missed / merged | 89% / 8% / 2% / 0% |

Splits are the main failure, and mostly harmless. Six sextuplet 16ths split 3+3 get the same
durations as 6:4. A 2+4 split gives no candidate. A 1+5 split gives a wrong ratio, which the
bar check must catch.

**Step 3, refinement of keep (2026-10-10), scratch `proto6`.**

On the corpus, keep held 6/8 over the cut-time Agitato section of the Peters scan of op. 9
no. 3. homr's `/2` tokens there are real; the reader just can't read the scanned ¢.

- **Check:** for every token without a read, is there a time-signature-shaped glyph near it?
  - Every such token in the MuseScore and videogame sets has nothing printed near it, so they
    are all false tokens.
  - So do the corpus's Mozart, Für Elise, Tico-Tico, Phoenix Wright and Undertale tokens.
  - The glyphs found are all on scans: Peters pages 1, 5, 9 and 11, and op. 66 page 4.
- **Fix:** keep applies only to a token with nothing printed near it (`no_read`). A token with
  an unread glyph (`unread_glyph`) ends the trusted meter instead, and its section is inferred
  as before.

**Step 5, gate v1 (2026-10-10), scratch `proto5`, MuseScore set: failed the goal.**

- **Applied:** 339 notes, declining 10,848 candidates.
  - 259 right: eighths 159, 16ths 97, 32nds 3.
  - 14 wrong.
  - 12 both wrong: 7:4 groups in the Cello étude's cadenza, whose true ratio is irregular.
  - 54 could not be aligned with the ground truth.
- **Exact durations:** 72.8% to 73.4%. Missed tuplets: 26.1% to 25.4%.
- **Cause of the wrong ones:** a bug carried over from the earlier prototype's gate. Its
  docstring requires each staff a repair touches to be broken before the repair and exact
  after. The code checked whether *any* staff in the bar was broken.
  - In the C major Prelude and Moonlight 3rd movement, a broken upper staff let the gate
    repair a lower staff that already added up.
  - The detector had split a beamed group of 16ths, and the piece of three looked like a
    triplet.

**Step 5, gate v2 (`proto6`):**

1. Every staff a repair touches must be broken before the repair and exact after.
2. A beam alone implies only 3:2-type ratios (3:2, 6:4, 12:8). Other ratios need a printed
   numeral.
3. A group next to a lone short note (an eighth or shorter, in no beam group) is not a
   candidate, since the detector probably split a longer beam.
4. In compound meters, a group that is a whole number of dotted beats is not a candidate;
   neither is a group that fills the whole bar.

Applied offline to the v1 decisions, rules 1 and 2 keep all 259 right repairs and drop 11 of
the 14 wrong ones plus all 12 cadenza ones. Rule 3 targets the remaining 3, a Moonlight bar
where homr added an extra 16th and the split group's "triplet" cancelled it.

**Gate v2 results (carry + keep):**

- **MuseScore:** 295 notes repaired, 245 right, **0 wrong**, 50 unaligned. Exact durations
  72.8% to 73.4%. Missed tuplets 26.1% to 25.4%.
- **Videogame,** judged by MIDI onsets:
  - 136 notes repaired. 16 right, **2 wrong**. 104 can't be decided because the MIDI fits
    both readings, and 14 can't be judged.
  - The wrong pair is in Super Mario World Overworld, page 2, bar 6: a 16th and a dotted
    eighth, with the dot missed by homr. The beam then held three 16ths' worth, and the
    "triplet" happened to make up for the missing dot.
- **Recall is low:** 245 of 10,238 missed-tuplet notes. Declined bars on the MuseScore set:
  - support below 3: 184 bars, 4,425 notes. In all-tuplet pieces almost no bar adds up
    without a repair, so nothing supports the meter.
  - no repaired staff comes out exact: 173 bars, 1,936 notes.
  - a repaired staff already adds up: 142 bars, 847 notes.
  - one staff exact, the other not: 7 bars, 218 notes.

**Gate v3 (`proto7`), the last variant:**

5. A beam group is not a candidate when any of its notes' printed values, as the note-value
   reader sees them, disagrees with the token. This catches the missed dot.
6. Support also counts bars that add up exactly once their own candidates apply
   (`TUPLET_SUPPORT=repaired`). With the meter read from the page, the support rule only has
   to show that the length is consistent.

**Gate v3 results:**

- **MuseScore:** 3,706 notes repaired, **3,365 right, 4 wrong**, 337 unaligned.
  - Exact durations 72.8% to **81.3%**. Missed tuplets 26.1% to **17.5%**.
  - The 4 wrong notes are one beat of the "Wrong Note" étude (page 3, bar 28). homr merged
    two of four beamed 16ths into one chord, and the false triplet cancelled an extra 16th
    elsewhere in the staff.
- **Videogame:** 210 notes repaired, 26 right, **0 wrong**, 165 undecidable by MIDI, 18
  unjudgeable. 193 are in Super Mario World Sub Castle. Bars that add up under the true meter:
  92.4% to 93.2%.
- **Meter's contribution:** gate v2's checks against the *inferred* meter (`inferred_v2`)
  give 174 right repairs on the MuseScore set, against 245 with the read meter. The support
  relaxation in v3 is only defensible with a meter read from the page; that is where most of
  the gain comes from.

**Gate v4 (`proto8`):**

7. A beam-group candidate is declined when a chord's notehead lies more than a staff space
   from the chord's stem. Such a head is a separate note merged into the chord.

   On the MuseScore set v4 changed nothing. The Wrong Note bar is a cross-staff beam: the
   group's second 16th is written on the bass staff, and homr puts it there, so the treble
   staff's beam holds three chords.

**Gate v5 (`proto9`):**

8. Stems under one beam are spaced about evenly: the largest gap must be at most 1.6 times
   the smallest when the group's notes have one value, 2.2 times otherwise. A wider gap holds
   a note the staff lost, such as a cross-staff note.

**Gate v5 results** (all settings: carry, keep where nothing is printed, trusted-meter gate,
numerals, support from repaired bars):

| Measure | Baseline | Gate v3 | Gate v5 |
| --- | --- | --- | --- |
| MuseScore: notes repaired, right / wrong / unaligned | — | 3,365 / 4 / 337 | 2,727 / **0** / 206 |
| MuseScore: exact durations | 72.8% | 81.3% | 79.7% |
| MuseScore: missed tuplets | 26.1% | 17.5% | 19.1% |
| MuseScore: staff-bars better / same / worse | — | 136 / 168 / 1 | 107 / 164 / **0** |
| Videogame: right / wrong / undecidable / unjudgeable | — | 26 / 0 / 165 / 19 | 26 / **0** / 165 / 19 |
| Videogame: bars that add up under the true meter | 92.4% | 93.2% | 93.2% |

- **Error bound:** 0 wrong in 2,753 judged repairs (MuseScore plus videogame) puts the error
  rate below about 0.11%.
- **Cost of rule 8:** it removed the 4 wrong notes and about 640 right ones. The threshold
  was not tuned, because tuning it on this set would only fit the test.
- **Declines by rule on the MuseScore set:** lone short neighbour 1,674 groups, uneven
  spacing 214, printed value disagrees 26.
- **Corpus:** 2,861 beam-group notes and 11 numeral notes repaired, almost all in pieces known
  for unmarked triplets: op. 25 nos. 11, 8, 10, 5 and 2, the Fantaisie-Impromptu,
  Super Mario World Sub Castle, Für Elise. Pages with no trusted meter get no repair (1,330
  candidate notes, mostly the scans).
- **Corpus by eye:** a random 25 of the gate v3 corpus repairs from the études and
  Fantaisie-Impromptu, plus every repair in Für Elise, op. 25 no. 7 and Nausicaä. All look
  right except one run of 32nds in op. 25 no. 7 that can't be judged by eye.

**Step 6 (`proto5` onward), bracketed numerals:**

- A numeral counts only with its bracket. Unbracketed digits were too often rests, flags,
  text or fingering.
- The notes under the bracket take the numeral's ratio, using the note-value reader's printed
  values where it is sure. That lets Lucca bar 12 (a quarter misread as an eighth, under a
  "3") come out right.
- **Videogame:** 4 numeral repairs, all right (Lucca bar 12, the Mario Ground Theme's
  quarter-note triplets). Most bracketed triplets were already right in homr's output (36
  `not_plain`).
- **Corpus:** 11 notes, including Nausicaä's quarter-note triplet (checked by eye).
- **MuseScore:** no effect. Only 7 bracketed groups print there, and the 2 candidates found
  were declined by the gate.

**Final configuration against the baseline (MuseScore set, `ms_compare_runs.py`):**

| Measure | Baseline | Final (`proto9`, gate v5) |
| --- | --- | --- |
| Exact duration | 73.0% | 79.9% |
| Missed tuplet | 25.4% | 18.5% |
| Extra tuplet | 0.9% | 0.9% |
| Other wrong duration | 0.7% | 0.7% |
| Bars under the wrong meter, joined score | 18.0% | 0.5% |
| Bars under the wrong meter, per page | 28.5% | 2.0% |
| Bars that add up under the true meter | 62.4% | 68.1% |
| First pages that write the true meter | 19 of 26 | 25 of 26 |
| Staff-bars against the ground truth: better / same / worse | — | 112 / 173 / 1 |

The one worse staff-bar is the Nocturne bar from step 3. The tuplet gate itself makes no bar
worse.

**Cost per page (2026-10-10, `timing.py`).** Measured the way the viewer worker runs homr: one
process, one page at a time, models loaded once, GPU, default OpenCV threads. 30 pages, 10 from
each set, each run under every configuration in rotated order, one run each. A page takes 23.1 s
(median) with the baseline.

| Added | Median extra time per page | Range over pages |
| --- | --- | --- |
| Meter reader, carry (steps 2 and 3) | +1.0 s (+5%) | +0.2 to +2.3 s |
| Tuplet gate (step 5) | +2.3 s more | |
| Numerals (step 6) | +0.4 s more | |
| All of it | +3.7 s (+16%); mean +3.4 s, 15% of total time | +0.7 to +7.0 s |

- **Background readers.** Both readers run in a background thread during inference, and the main
  thread never waited for them. The meter read takes 6.6 s on its own (median) and the numeral
  read 2.0 s. They still slow the page by about 1.4 s through CPU contention.
- **The gate's 2.2 s runs on the main thread.** 94% of it is `physical_staff_lines_at_x` in
  `recovery.py` (existing sidecar code). `note_values` calls it 770 times on two pages: once for
  every chord's stem end and once for every printed-value read. Each call takes about 240 numpy
  medians. Caching the staff lines per staff should remove most of it. This is not tried yet.
- **CPU only** (`TIMING_CPU=1`, same 30 pages, all 32 cores). A page takes 26.9 s (median) with
  the baseline, 18% slower than on the GPU. The added time is the same in seconds: +1.2 s for
  the meter reader, +3.7 s for all of it (+12%; mean +3.4 s, 13% of total). The repair step is
  2.2 s, as on the GPU. A machine with fewer cores was not measured.

**Step 7 (2026-10-10), on `false_rest_detector`.** The user chose opt-in options in homr and two
viewer toggles, on by default.

- **homr.**
  - Fork-only modules: `time_signatures.py` (reader and token links), `tuplet_numerals.py`, and
    `tuplet_repairs.py` (the gate, rules 1 to 8, final configuration only; no environment
    switches).
  - `note_values.py` gains `stem_end`, `beamed_together` and a per-chord cache of the staff-line
    fit. The `LEFT_BAND_STEP` reader change from the prototype base was left out: it would
    change the sidecar's note-value readings with the options off, and it turned out not to
    matter for the gate.
  - Upstream files only get hooks:
    - `XmlGeneratorArguments(read_time_signatures, repair_tuplets,
      time_signature_from_previous_page)`, all off by default and validated together;
    - `ProcessingResult.time_signature_at_end`;
    - flags `--read-time-signatures` and `--repair-tuplets`;
    - 18 lines in the writer.
  - New behaviour beyond the prototype: repaired groups get tuplet start and stop marks.
  - Tests: 84 new (403 before, 487 now), each rule mutation-checked.
- **Port check against the prototype** (`branch_pool_run.py`, runs `b10on_*` and `b10off_*`):
  - Options on, with carry: the MusicXML equals the prototype's final run (`m9_*`) on every page
    of the MuseScore and videogame sets, apart from the tuplet marks.
  - Options off: byte-identical to the baseline (`ts_*`).
  - MuseScore metrics are the same as the prototype's: 2,727 right, 0 wrong, 206 unaligned;
    staff-bars 112 better / 173 same / 1 worse.
- **Viewer.**
  - Settings, Repairs: "Time signatures from the page" and "Tuplets from beams and brackets",
    both on by default. Tuplets are greyed out and sent off when time signatures are off.
  - Plumbing as for the shared-notehead toggle; the worker's `RepairSettings` rejects tuplets
    without time signatures.
  - The worker passes each page the meter the page before it ended in.
    - A page without music passes the meter on; a failed page passes none on.
    - A cached page is reused only if it was recognized from the meter its predecessor now
      ends in.
    - Retrying a page also re-recognizes the later pages that started from another meter,
      until one did not.
    - No cache revision bump: the manifest's repair settings gain two keys, so old caches are
      recognized again once.
  - End to end with the real homr engine (`viewer_e2e.py`, Aeolian Harp etude, 4 pages):
    - page 1 reads 4/4, pages 2 to 4 start in it and restate it unprinted, and pages 2 to 4
      get tuplet repairs;
    - reopening uses the cache for every page;
    - retrying page 2 recognizes only that page;
    - turning tuplets off recognizes every page again, with no tuplets and the same meters.
- **Cost after the staff-line cache** (`timing_branch.py`, same 30 pages, GPU): +1.5 s a page
  median (+8%; mean +1.65 s, 8% of total). Before the cache it was +3.7 s (16%). The repair
  step itself takes 1.5 s, but most of its line fits are reused when the sidecar reads every
  note's value. CPU-only was not measured again.
- **Commits.** homr: 156b207 (code, tests, sidecar docs) and d924ada (README). Viewer: 8e5bdc6
  (worker and Tauri) and a542dca (web app). Nothing pushed; omr-evals unchanged.

## 7. Open questions

- **The gate's rules were found on the sets they are measured on.** Rules 1 to 8 each answer a
  failure seen in the MuseScore or videogame set. Each is grounded in a real misreading, but
  the "0 wrong" holds for these sets. Only ground truth not yet used would show the true error
  rate.
- **Rule 8's threshold** (even spacing, 1.6 and 2.2) costs about 640 right repairs for 4 wrong
  ones. It was left untuned for the same reason.
- **The Nocturne bar (step 3).** With the true meter, `bar_placement.py` picks the other
  placement rule for a bar that is broken under both. This is the only staff-bar worse than
  the baseline. Options: leave the inferred bar length in charge of that choice when no rule
  makes the bar add up, or accept the regression.
- **Recall.** 19.1% of notes are still missed tuplets. The main remaining blockers are groups
  next to a lone short note (1,674) and staves that still don't add up after repair (about
  1,900 notes). The rest need other value repairs first.
- **Shipping.** Step 3 is kept, so step 8 (an optional meter argument, the viewer passing it,
  omr-evals scheduling by score) is part of shipping.
  - The prototype touches upstream files in two more places than planned: the writer's
    unprinted carried `<time>` and the dropped false tokens.
  - The gate lives in the prototype's `value_repairs.py`. It would move into a fork-only
    module with tests for each rule.
  - Cost: about 3.5 s a page (15%). Most of it is an uncached staff-line lookup in the gate.
    See "Cost per page" in section 6.
  - **Viewer toggles (proposed 2026-10-10, not yet decided).** Two toggles under Settings,
    Repairs, using the same path as "Note timing at shared noteheads". That path runs from
    the web app to Tauri `RepairSettings`, then the worker's `RepairSettings` and cache
    manifest, then homr's `XmlGeneratorArguments`.
    1. *Time signatures from the page:* read the printed meter, carry it across pages, and drop
       time-signature tokens where nothing is printed (steps 2 and 3).
    2. *Tuplets from beams and brackets* (steps 5 and 6). This needs toggle 1.
    - The gate only trusts a meter read on the page or carried in. In the final runs, 2,127 of
      2,933 applied tuplet repairs on the MuseScore set (73%) were on pages that had only a
      carried meter. On the videogame set it was 196 of 210 (93%), and 1,916 of 2,872 (67%) on
      the corpus. Splitting reading from carrying, or numerals from beams, would not be useful
      to a user.
    - In homr, the switches become `XmlGeneratorArguments` fields, and the carried meter goes in
      through the same object, so `process_image` keeps its signature. The meter carried out
      comes back in the sidecar.
    - The viewer worker already processes pages in order, one at a time. Each page would take
      `carried_out` from the previous page's sidecar, cached or not. Two cases still need
      rules: re-recognizing a single page whose meter changes, and passing the meter through
      skipped pages that hold no music.

- **Locating the time signature (answered).** No segmentation mask holds the digits; the
  reader finds them in the ink. A token is tied to a read through the transformer's own
  coordinate for the token, carried to the page.
- **How C and ¢ appear in homr's tokens (answered).** As `timeSignature/4` and
  `timeSignature/2`. The writer still writes them as numbers; writing the symbol (`<time
  symbol="common">`) is a small step-7 item.
- **Pending upstream merge.** Upstream has 62 commits not in the fork, including a writer
  rewritten on ElementTree and new voice positions (`upper2`, `lower2`). This is out of scope
  here, but it will conflict where our writer hooks sit, and the meter hook would land there
  too.
