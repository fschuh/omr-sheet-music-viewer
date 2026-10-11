# Tuplet gate second pass plan

Date: 2026-10-10
Status: planned. Step 1 starts on the development set; held-out pieces are being collected.

This pass follows `plans/meter-reader-and-tuplet-repair-plan.md`. That plan covers how the gate
works, its rules 1 to 8, and how it was built and measured. Its open questions on rule 8 and
on recall are taken up here.

## 1. Why

The tuplet gate in homr (`homr/visual_sidecar/tuplet_repairs.py`) repairs missed tuplets from
beams and bracketed numerals. On the MuseScore set it made 2,727 right repairs and no wrong
ones, but notes missing their tuplet only fell from 25.4% to 18.5% of aligned notes. Two
things hold recall back.

**Rule 8, even stem spacing.** The widest gap between a beam group's stems may be at most 1.6
times the narrowest (2.2 when its values differ). Measured against the gate without it:

| Change | Notes | Where |
| --- | --- | --- |
| Wrong repairs removed | 4 | one beam group: Op. 25 No. 5, page 3, bar 28 |
| Right repairs lost | 638 | 38 staff-bars in 4 pieces |

Of the 638, 589 notes (35 staff-bars) are in Winterwind, Op. 25 No. 11. The rest are one
staff-bar each in Op. 25 No. 10 (24 notes), the Moonlight sonata (13) and the
Fantaisie-Impromptu (12).

The rule stands in for the failure it was added for: a note the staff lost, such as one
written on the other staff, which leaves a wide gap and makes the group look a note short.
It catches that by spacing alone, so it also catches groups spaced unevenly for ordinary
reasons, probably accidentals in Winterwind's chromatic runs.

**The other blockers.** On the MuseScore set, with the shipped gate:

| What stops the repair | Count |
| --- | --- |
| A lone short note beside the group (rule 3) | 1,674 beam groups |
| Staves that don't add up with the repairs | 2,110 candidate notes |
| Fewer than 3 supporting bars | 1,242 candidate notes |
| Staves that already add up as read | 803 candidate notes |

Not every one of these is a missed tuplet, so they bound what can be gained; they don't
measure it.

## 2. Constraints

- **No mistakes in exchange for recall.** A changed rule may not add a wrong repair on any set,
  and no staff-bar may get worse than with the shipped gate.
- **Develop on the old sets, validate on held-out pieces.** The rules so far were found on the
  sets they are measured on, so the development set can show that a change keeps its known
  cases, but not that it is safe.
  - New pieces go in a separate folder, not yet chosen, which I don't open until the rule is
    frozen.
  - The frozen rule (a homr commit) runs on them once.
  - Fixing what the held-out run finds and running again turns it into another development
    set; a further pass would need new held-out pieces.
- **Evidence from the page.** A rule must follow from something visible on the page, not from
  whether the bar then adds up (see the old plan, section 2).
- **Same shipping rules as the old plan.** homr logic stays in fork-only modules. Commits go to
  `false_rest_detector` in homr and the viewer. The homr options stay opt-in, so omr-evals is
  unchanged.

## 3. Data

| Set | Ground truth | Role in this pass |
| --- | --- | --- |
| MuseScore set: 26 pieces, 123 pages | Exact (PDF and MXL) | Development: keep its 2,727 right repairs and the rule 8 case, and recover the 638 |
| New classical pieces from the user | Exact (PDF and MusicXML from one source) | Held-out validation, run once |
| Videogame set: 70 pieces, 131 pages | MusicXML exported from the source `.mus` files, once the user's exporter is verified | Precision check: many candidate groups there are probably not tuplets |
| 240-page corpus | None | Check every newly repaired bar by eye on the page, including scanned engravings |

The new classical pieces should be ones where these rules decide:
- unmarked beamed triplets and sextuplets with accidentals or chromatic runs;
- notes crossing between the staves.

Suggested: Chopin's Op. 10 études, Ballades and Nocturnes; Schubert's Impromptus Op. 90;
Liszt's *Un sospiro*; Debussy's Arabesque No. 1; Mendelssohn's *Songs Without Words*;
Brahms's Intermezzi.

Aim for several hundred repaired bars across 20 or more pieces. No wrong repair in about 300
independent bars bounds the error rate below about 1%. Notes within one group are not
independent, so bars and pieces are what count.

The videogame set is not fully independent either: its MIDI verdicts shaped the gate
(rule 5, missed dots). With exact durations it still judges every repair, where the MIDI
could judge only 26 of the 210 applied notes.

## 4. Steps

Each step ends with a measurement and the user's go or no-go before the next one starts.

**Step 1. Diagnose rule 8's declines on the development set.**

- For the 38 staff-bars it costs and the one it saves, show each group on the page (contact
  sheets) with its stem gaps.
- Classify what widens each gap: accidentals, a displaced notehead in a chord, a note on the
  other staff, a lost notehead, or something else.

**Step 2. Replace the spacing ratio with direct evidence.**

- *Candidate:* decline a group only when the wide gap holds a notehead that no note of the group
  accounts for. That is a notehead linked to a token on the other staff, or a notehead
  candidate linked to no token.
- *Candidate:* measure gaps between noteheads with the width of printed accidentals taken out.
- Keep a loose ratio only as a backstop, if step 1 shows a case neither candidate covers.
- *Measure* on the development set: still no wrong repairs, the 638 notes recovered, and the
  same staff-bars better, the same and worse.

**Step 3 (optional). Diagnose the other blockers.**

- Do the same as step 1 for the lone-short-neighbour groups and the staves that don't add up.
- Propose evidence-based changes only where the page shows the cause.

**Step 4. Freeze and validate.**

- Freeze the rules as a homr commit.
- Run once on the held-out classical pieces. Report right, wrong and unaligned notes per
  piece, and staff-bars better, the same and worse against the shipped gate.
- When the videogame MusicXML is in, run there too.
- Check every bar the change newly repairs in the corpus by eye.
- *Ship* only with no wrong repair and no staff-bar worse. Otherwise rule 8 stays as it is,
  and the held-out results feed a later pass.

**Step 5. Ship.** Same as the old plan's step 7:
- tests for each rule that fail without it;
- the sidecar docs and the README numbers updated;
- a viewer cache revision bump.

## 5. Progress

Nothing yet.

## 6. Open questions

- **Where the held-out pieces go.** It must be a folder I don't read during development. A
  sibling of `omr-evals/cases/ground-truth/musescore` (e.g. `musescore-holdout`) would work.
- **What counts as one held-out case.** If one piece contributes most repairs, as Winterwind
  does on the development set, the error bound should be stated per piece as well as per bar.
