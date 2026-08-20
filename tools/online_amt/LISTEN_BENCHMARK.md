# online_amt listening benchmark

[Back to the benchmark index](BENCHMARK.md).

## Benchmark history

Entries are kept newest first so renderer and recognition changes remain
comparable over time.

### Unified production-candidate gate — August 19, 2026

The isolated, continuous-sequence, dynamics, and articulation matrices, measured
in one pass and turned into one deterministic eligibility decision. This entry
records the gate itself, not the confirmatory run: the frozen automated
confirmation is a separate repeated execution, and nothing here changes a
candidate value, a manifest assignment, or the production default, which remains
`baseline-v1`.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-profile-validation

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-profile-validation-summary
```

The optional trailing arguments name corpus speeds and dynamics suites for a
focused smoke. A narrowed run can reject a candidate but never clear one: the
release floors are absolute counts against the frozen corpora, so the gate
reports `incomplete-evidence` with the reasons rather than a verdict.

Eighteen gates are reported for every candidate, applied or not, so a narrowed
command cannot look complete by omitting the gates it skipped. Safety gates read
every partition, release gates read only held-back `confirmation` rows, and the
sequence and discovery-side dynamics gates are labeled `discovery-consistency`:
they still reject a regression, but no discovery number can be quoted as
generalization. Late-advance counts, source-to-target distance, and attribution
delay are reported per domain beside safety and never as safety.

#### Construction smoke

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-profile-validation-summary 333.33 articulation
```

Measured at commit `10a32a7`, Chrome 151.0.7922.169 on Linux, model
`online_amt_streaming.onnx`, renderers `bundled-piano-web-audio-v1` and
`bundled-piano-tone-v2`. Manifest version 1, hash `0ed1e71d`; the complete
268-trace isolated corpus with the sequence corpus narrowed to 333.33 ms and the
dynamics corpus narrowed to the articulation suite, so the run is deliberately
incomplete evidence.

| Domain | Captured | Renderers | Partitions | Identity |
| --- | ---: | --- | --- | --- |
| Isolated | 268 | Direct, Tone | `confirmation` | `bff20df8` |
| Sequence | 26 | Direct, Tone | `discovery`, `regression-only` | `f67b8d57` |
| Dynamics | 8 | Direct, Tone | `confirmation`, `discovery` | `0902e4cf` |

Trace reuse and baseline parity are confirmed for all three. An identity digest
folds every captured trace's decoded-structure hash into one value, so a
repetition of the same corpus can be compared against it before being compared
row by row — and it is only comparable with a run that captured the same traces.

That scope differs by domain here, because this smoke narrowed two of the three
corpora. The isolated digest covers the complete 268-trace corpus, so a full run
captures the same traces and should reproduce `bff20df8`. The sequence and
dynamics digests do not: this run captured 26 of the corpus's 156 sequence traces
and 8 of its 52 dynamics traces, so a complete run necessarily produces different
values, and `f67b8d57` and `0902e4cf` are references for repeating this same
narrowed smoke rather than baselines for anything wider.

The frozen automated confirmation does not compare against these digests at all.
It runs the complete matrix twice and compares its two repetitions with each
other, which is the only comparison in which both sides captured the same traces.

The `baseline-v1` columns reproduce the recorded Task 09 isolated matrix exactly
— 104/106 and 52/54 under Direct, 100/106 and 48/54 under Tone — and the gate
rejects all four candidates on the confirmation rows, with the reasons the
isolated matrix already documented:

| Candidate | Verdict | Failed gates |
| --- | --- | --- |
| `early-open-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-course-clear` |
| `steady-open-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-course-clear` |
| `early-held-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-recognition`, `release-isolated-course-clear` |
| `steady-held-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-recognition`, `release-isolated-course-clear` |

The safety failure is the omitted-bass advance the isolated matrix reported:
`isolated/direct/122` under Direct and `isolated/tone/124` under Tone, one
fixture each, under all four candidates. The committed regressions pass for every
candidate — the `v05` recovery deviates from the pinned advancement without
becoming unsafe, which is reported as a deviation and not gated — and the
sequence and dynamics rows contributed no safety event in this smoke.

Whether these rejections stand is the confirmation run's result, not this one's:
the smoke narrowed two corpora and therefore reports `incomplete-evidence`
overall. What it establishes is that one command evaluates the frozen candidates
across all automated domains and returns eligibility with exact reasons, without
searching a parameter or touching the production default.

### Dynamics and articulation candidate matrix — August 19, 2026

The frozen candidates measured across the domains the original Direct-only
sequence sweep never saw: 20 constant velocity layers, 2 mixed
crescendo-decrescendo runs, and 4 articulations under each renderer. Every run is
rendered and recognized once, and `baseline-v1` plus the four frozen candidates
replay that one retained decoded trace.

This corpus is **partly** held out, which is the thing to keep straight when
reading the numbers below. Manifest version 1 assigned three constant layers per
piano and renderer, one mixed run per renderer, and five of the eight
articulations to `discovery`; everything else stayed untouched. Every reported
group therefore carries the partitions it spans and an `evidenceRole` of
`discovery`, `confirmation`, or `mixed`, and only a `confirmation` group may be
quoted by a release gate. The whole-corpus rows are `mixed` by construction and
confirm nothing on their own.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-profile-validation

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-profile-validation articulation
```

The optional trailing argument names one or more suites — `dynamics-constant`,
`dynamics-mixed`, `articulation` — for a focused smoke.

Measured at Chrome 151.0.7922.169 on Linux, model `online_amt_streaming.onnx`,
renderers `bundled-piano-web-audio-v1` and `bundled-piano-tone-v2`. Manifest
version 1, hash `0ed1e71d`; 52 traces captured, one capture per run and five
profile columns replayed from each. Registry version 2, candidates
`early-open-v2`, `steady-open-v2`, `early-held-v2`, `steady-held-v2`. A paired
run takes about six minutes.

#### Baseline parity against the recorded dynamics matrix

Direct scores all 20 constant layers; Tone scores 19, because the diagnosed
Tone + Salamander `v05` run is `regression-only` and gates instead of scoring.
Adding the gate column back reproduces the recorded August 16/17 constant-layer
matrix exactly:

| Renderer | Scored | Gate row | Sum | Recorded |
| --- | ---: | ---: | ---: | ---: |
| Direct independent | 488 / 540 | — | 488 / 540 | 99 + 389 |
| Direct ordered | 138 / 540 | — | 138 / 540 | 85 + 53 |
| Tone independent | 467 / 513 | 25 / 27 | 492 / 540 | 93 + 399 |
| Tone ordered | 163 / 513 | 23 / 27 | 186 / 540 | 55 + 131 |

Complete passages agree the same way (Direct 1 + 0 = 1 / 20, Tone 1 + 0 = 1 / 20),
as does the single recorded late advance, which is the `v05` gate row. The Direct
equal-piano aggregate reproduces the recorded cross-piano row to the digit —
90.86% independent, 45.49% ordered, 12.50% complete against the recorded 90.9%,
45.5%, 12.5%. Tone's equal-piano ordered rate is 38.80% rather than the recorded
40.6% for exactly one reason: `v05`'s 23 ordered advances are a gate row here and
are not allowed to raise a score.

The mixed suite reproduces its own recorded matrix the same way: 20 / 27 and
3 / 27 ordered under Direct, 13 / 27 and 4 / 27 under Tone, and equal-piano rates
of 94.44% / 42.59% and 90.74% / 31.48% against the recorded 94.4% / 42.6% and
90.7% / 31.5%.

Equal-piano aggregates are computed per suite, never blended across suites, so
each stays comparable with the matrix that recorded it. Every baseline column
also reproduces its own capture-time replay event for event.

The historical single-profile commands were re-run against the same code:
`listen-dynamics-mixed` reproduces 94.4% / 42.6% and 90.7% / 31.5% with 0 / 0 / 0
safety, and `listen-dynamics-case-tone salamander v05` still reports 25 / 27
independent, 23 / 27 ordered, the pinned `baseline-v1` advance at 25,440 ms, and
decoded-structure hash `b043076d`. Their results now name `baseline-v1` instead
of following whichever profile production defaults to.

#### Direct `bundled-piano-web-audio-v1`

Whole scored corpus — 26 runs, `mixed` evidence:

| Profile | Independent | Ordered | Complete | Late | p95 ordered | Ordered delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline-v1` | 639 / 702 (91.0%) | 224 / 702 (31.9%) | 1 / 26 | 0 | 212 ms | baseline |
| `early-open-v2` | 662 / 702 (94.3%) | 265 / 702 (37.7%) | 2 / 26 | 0 | 212 ms | +41 |
| `steady-open-v2` | 662 / 702 (94.3%) | 265 / 702 (37.7%) | 2 / 26 | 0 | 212 ms | +41 |
| `early-held-v2` | 658 / 702 (93.7%) | 265 / 702 (37.7%) | 2 / 26 | 0 | 212 ms | +41 |
| `steady-held-v2` | 658 / 702 (93.7%) | 265 / 702 (37.7%) | 2 / 26 | 0 | 212 ms | +41 |

Untouched `confirmation` rows only — 16 runs:

| Profile | Independent | Ordered | Complete | Ordered delta |
| --- | ---: | ---: | ---: | ---: |
| `baseline-v1` | 391 / 432 (90.5%) | 77 / 432 (17.8%) | 1 / 16 | baseline |
| `early-open-v2` | 407 / 432 (94.2%) | 116 / 432 (26.9%) | 2 / 16 | +39 |
| `steady-open-v2` | 407 / 432 (94.2%) | 116 / 432 (26.9%) | 2 / 16 | +39 |
| `early-held-v2` | 403 / 432 (93.3%) | 116 / 432 (26.9%) | 2 / 16 | +39 |
| `steady-held-v2` | 403 / 432 (93.3%) | 116 / 432 (26.9%) | 2 / 16 | +39 |

#### Tone `bundled-piano-tone-v2`

Whole scored corpus — 25 runs plus the `v05` gate row, `mixed` evidence:

| Profile | Independent | Ordered | Complete | Late | p95 ordered | Ordered delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline-v1` | 609 / 675 (90.2%) | 239 / 675 (35.4%) | 1 / 25 | 0 | 220 ms | baseline |
| `early-open-v2` | 641 / 675 (95.0%) | 439 / 675 (65.0%) | 8 / 25 | 4 | 228 ms | +200 |
| `steady-open-v2` | 641 / 675 (95.0%) | 439 / 675 (65.0%) | 8 / 25 | 4 | 228 ms | +200 |
| `early-held-v2` | 632 / 675 (93.6%) | 373 / 675 (55.3%) | 5 / 25 | 4 | 228 ms | +134 |
| `steady-held-v2` | 632 / 675 (93.6%) | 373 / 675 (55.3%) | 5 / 25 | 4 | 228 ms | +134 |

Untouched `confirmation` rows only — 16 runs:

| Profile | Independent | Ordered | Complete | Ordered delta |
| --- | ---: | ---: | ---: | ---: |
| `baseline-v1` | 392 / 432 (90.7%) | 146 / 432 (33.8%) | 1 / 16 | baseline |
| `early-open-v2` | 413 / 432 (95.6%) | 280 / 432 (64.8%) | 6 / 16 | +134 |
| `steady-open-v2` | 413 / 432 (95.6%) | 280 / 432 (64.8%) | 6 / 16 | +134 |
| `early-held-v2` | 409 / 432 (94.7%) | 247 / 432 (57.2%) | 4 / 16 | +101 |
| `steady-held-v2` | 409 / 432 (94.7%) | 247 / 432 (57.2%) | 4 / 16 | +101 |

#### Every leaf that moved

Aggregates are reported beside the leaf rows they average, so a single velocity
layer cannot disappear into one. Ordered advances out of 27, in column order
`baseline-v1`, `early-open-v2`, `steady-open-v2`, `early-held-v2`,
`steady-held-v2`:

| Leaf | Evidence | Ordered advances |
| --- | --- | --- |
| Direct `layer/splendid/ff` | discovery | 18 / 20 / 20 / 20 / 20 |
| Direct `layer/salamander/v13` | confirmation | 5 / 27 / 27 / 27 / 27 |
| Direct `articulation/legato` | confirmation | 3 / 20 / 20 / 20 / 20 |
| Tone `layer/splendid/mf` | confirmation | 19 / 27 / 27 / 19 / 19 |
| Tone `layer/splendid/ff` | discovery | 3 / 13 / 13 / 3 / 3 |
| Tone `layer/salamander/v01` | confirmation | 4 / 20 / 20 / 20 / 20 |
| Tone `layer/salamander/v03` | discovery | 13 / 27 / 27 / 27 / 27 |
| Tone `layer/salamander/v04` | confirmation | 13 / 27 / 27 / 27 / 27 |
| Tone `layer/salamander/v08` | confirmation | 3 / 27 / 27 / 3 / 3 |
| Tone `layer/salamander/v10` | confirmation | 13 / 24 / 24 / 23 / 23 |
| Tone `layer/salamander/v13` | confirmation | 8 / 23 / 23 / 23 / 23 |
| Tone `layer/salamander/v14` | discovery | 4 / 27 / 27 / 4 / 4 |
| Tone `layer/salamander/v15` | confirmation | 3 / 27 / 27 / 27 / 27 |
| Tone `layer/salamander/v16` | confirmation | 5 / 27 / 27 / 27 / 27 |
| Tone `mixed/salamander` | discovery | 4 / 23 / 23 / 23 / 23 |

Three of Direct's 26 leaves and twelve of Tone's 25 move; every other leaf is
identical under all five profiles. **No leaf, piano, partition, suite, or
renderer row regresses anywhere**: `regressedOrderedAdvanceTraceIds` and
`lostCompletePassageTraceIds` are empty for every candidate in every group.

The `open`/`held` split is what separates the candidates, and it is only visible
per layer. Four Tone leaves — `splendid/mf`, `splendid/ff`, `salamander/v08`, and
`salamander/v14` — recover only under the 0.20 active-target gate; the two `held`
candidates leave them exactly where `baseline-v1` had them. The fresh-onset gate
(0.45 versus 0.50) separates nothing in this corpus: `early` and `steady` are
identical in every row measured here.

#### Safety and the two diagnosed cases

Every profile reports 0 / 0 / 0 false, skipped, and duplicate advances under both
renderers, `introducedUnsafeTraceIds` is empty for all four candidates, and no
committed regression is worse than its baseline replay
(`worseThanBaselineCount: 0`). Safety is evaluated over every partition,
including the gate rows; scores are not.

Late advances are reported beside safety and never as safety. Under Tone the
candidates add four late advances to the scored corpus, each one the playhead
catching a chord the player did play one moment earlier than `baseline-v1` did.
The `dynamics-constant/tone/salamander/v05` gate row reproduces the diagnosed
Task 05 behavior exactly: `baseline-v1` advances target 23 at 25,440 ms, and all
four candidates advance it at 24,448 ms from the earlier repetition and then also
take target 24 at 25,440 ms — two late advances instead of one, no false, skipped
or duplicate advance, and identical ordered progress of 23 / 27.

Both committed regressions are replayed under every column. Each candidate shows
two `deviating` outcomes and zero `worse` ones: the `v05` fixture recovers a
repetition earlier than pinned, and the Task 06 Tone 333 ms fixture is no longer
classified as a false advance at all. Deviating from a pinned recovery is
reported; only becoming less safe rejects.

#### Repeatability

The full matrix was run twice in fresh browser processes. All 52
decoded-structure hashes, every recognition, advancement, group total, delta,
equal-piano rate, and safety value are identical, and the two console summaries
are byte-identical. The only differing values are the rendered `peak` and `rms`
diagnostics and the wall-clock `maximumInferenceMs` maxima — Chrome's
`OfflineAudioContext` does not reproduce its last bits between processes, which
is why identity is pinned to the decoded structure.

Each suite was also run on its own. `dynamics-constant`, `dynamics-mixed`, and
`articulation` reproduce all 195, 20, and 40 of the corresponding leaf rows of
the full run, hashes included, with only the wall-clock maxima differing.

Nothing here changes a candidate value, a manifest assignment, or the production
default, which remains `baseline-v1`.

### Continuous-sequence candidate matrix — August 19, 2026

The frozen candidates measured across the whole continuous-sequence corpus: 13
passages × 6 speeds × 2 renderers, each rendered and recognized once, with
`baseline-v1` and the four frozen candidates replaying that one retained decoded
trace. Unlike the isolated matrix, this evidence **confirms nothing**. Both
single-renderer sweeps have already read the sequence corpus, so the manifest
labels it `discovery` and the result reports `evidenceRole: "discovery"`. It is
measured because a release decision still needs complete per-profile playing
diagnostics — ordered advancement, prefix progress, complete passages, failure
reasons, carry-over, latency, backlog, and the dedicated safety families — at the
speeds and in the families production actually runs.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-profile-validation

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-profile-validation 1000
```

The optional trailing argument names one or more corpus speeds for a focused
smoke. Families are deliberately not filterable: dropping one would drop the
safety gates that qualify every profile row.

Measured at Chrome 151.0.7922.169 on Linux, model `online_amt_streaming.onnx`,
renderers `bundled-piano-web-audio-v1` and `bundled-piano-tone-v2`. Manifest
version 1, hash `0ed1e71d`; 156 sequence traces captured, one capture per passage
and five profile columns replayed from each. Registry version 2, candidates
`early-open-v2`, `steady-open-v2`, `early-held-v2`, `steady-held-v2`. A paired
run takes about 140 seconds.

#### Scoring and gating are separate

The 10 musical families score; the 3 dedicated safety passages gate. The split
follows the manifest's `scoreEligible` flag, not a family name spelled in the
validation module, and the gate rows are reported in their own
`regressionTotals` column that is never added into a score. Adding the two
columns reproduces the recorded whole-corpus row exactly, which is how the
baseline column is checked against the August 15 paired renderer baseline:

| Renderer | Scored ordered | Gate ordered | Whole corpus | Recorded August 15 |
| --- | ---: | ---: | ---: | ---: |
| Direct, 1000 ms | 57 / 76 | 9 / 9 | 66 / 85 | 66 / 85 |
| Tone, 1000 ms | 54 / 76 | 9 / 9 | 63 / 85 | 63 / 85 |

Complete passages agree the same way — Direct 5 + 3 = 8 / 13 and Tone 6 + 3 =
9 / 13 — as do the 220 ms and 228 ms P95 ordered latencies.

#### Direct `bundled-piano-web-audio-v1`

| Profile | Independent | Ordered | Prefix | Complete | Late | Carry-over | Ordered p50 / p95 | Safety |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline-v1` | 291 / 456 | 283 / 456 | 199 | 33 / 60 | 8 | 58 | 192 / 214.67 ms | 0 / 0 / 0 / 0 |
| `early-open-v2` | 308 / 456 | 365 / 456 | 268 | 43 / 60 | 0 | 51 | 190.67 / 209.33 ms | 0 / 0 / 0 / 0 |
| `steady-open-v2` | 306 / 456 | 357 / 456 | 260 | 41 / 60 | 5 | 53 | 192 / 212 ms | 0 / 0 / 0 / 0 |
| `early-held-v2` | 307 / 456 | 362 / 456 | 265 | 42 / 60 | 0 | 51 | 190.67 / 209.33 ms | 0 / 0 / 0 / 0 |
| `steady-held-v2` | 305 / 456 | 354 / 456 | 257 | 40 / 60 | 5 | 53 | 192 / 212 ms | 0 / 0 / 0 / 0 |

Safety is the dedicated families' false / skipped / duplicate / incomplete
carried-bass counters. `baseline-v1` reproduces the August 13 Direct sweep
production baseline exactly — 291 / 283 / 199 / 33 and 214.67 ms — and
`early-open-v2`, whose values are those of the sweep recommendation
`o0p450-t0p500-a0p200-x0p990-b1`, reproduces its 308 / 365 / 268 / 43 and
209.33 ms. That is expected rather than new information: this corpus is what
selected those values.

#### Tone `bundled-piano-tone-v2`

| Profile | Independent | Ordered | Prefix | Complete | Late | Carry-over | Ordered p50 / p95 | Safety |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline-v1` | 292 / 456 | 310 / 456 | 219 | 38 / 60 | 0 | 62 | 200 / 228 ms | 0 / 0 / 0 / 0 |
| `early-open-v2` | 297 / 456 | 315 / 456 | 225 | 39 / 60 | 0 | 62 | 200 / 228 ms | 0 / 0 / 0 / 0 |
| `steady-open-v2` | 297 / 456 | 315 / 456 | 225 | 39 / 60 | 0 | 62 | 200 / 228 ms | 0 / 0 / 0 / 0 |
| `early-held-v2` | 294 / 456 | 314 / 456 | 224 | 38 / 60 | 0 | 62 | 200 / 228 ms | 0 / 0 / 0 / 0 |
| `steady-held-v2` | 294 / 456 | 314 / 456 | 224 | 38 / 60 | 0 | 62 | 200 / 228 ms | 0 / 0 / 0 / 0 |

The candidates separate sharply under Direct and barely under Tone. Every
candidate keeps all four dedicated safety counters at zero under both renderers,
and none loses a complete passage.

#### Where the Direct gain comes from

`early-open-v2` deltas from `baseline-v1`, per speed and per family:

| Interval | Independent | Ordered | Prefix | Complete | Late | Carry-over | Ordered p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | +2 | +4 | +4 | 0 | 0 | 0 | −8 ms |
| 500 ms | +3 | +7 | +7 | +1 | −2 | −1 | 0 ms |
| 333⅓ ms | +7 | +39 | +39 | +5 | −5 | −3 | −13.33 ms |
| 250 ms | +4 | +19 | +19 | +1 | 0 | 0 | 0 ms |
| 167 ms | 0 | +8 | 0 | +2 | −1 | −2 | −7 ms |
| 125 ms | +1 | +5 | 0 | +1 | 0 | −1 | 0 ms |

| Family | Independent | Ordered | Complete | Late |
| --- | ---: | ---: | ---: | ---: |
| `course-clear` | +2 | +37 | +1 | 0 |
| `three-note-independent` | +6 | +22 | +4 | 0 |
| `alternating-pitches` | +1 | +7 | +2 | −3 |
| `repeated-notes` | +2 | +7 | +2 | −5 |
| `shared-sustain` | +4 | +6 | 0 | 0 |
| `known-weak-chord` | +2 | +3 | +1 | 0 |
| `rolled-chords`, `scales`, `two-note-chords` | 0 | 0 | 0 | 0 |

The gain is concentrated in the cascade the dynamics work already identified:
ordered advancement improves far more than independent recognition, because
recovering one stalled target unblocks the targets behind it. Eight of
`baseline-v1`'s Direct late advances become on-time advances, which is why its
late count falls to zero while no advance is lost.

#### The two rows that got worse

Nothing regressed on Direct: `regressedOrderedAdvanceTraceIds` and
`lostCompletePassageTraceIds` are empty for all four candidates. Under Tone, all
four candidates lose one ordered advance on `sequence/tone/course-clear-27/167ms`
without losing the passage's completion, the single ordered regression in 156
passages.

The only unsafe advance anywhere in the scored corpus belongs to `baseline-v1`:
the diagnosed Tone 333 ms false advance on `sequence/tone/course-clear-27`, event
index 8, which every candidate clears. The dedicated safety families report
0 / 0 / 0 / 0 for every profile under both renderers.

#### Repeatability

The full matrix was run twice in fresh browser processes. Every recognition,
advancement, classification, latency, backlog, safety counter, and all 156
decoded-structure hashes are identical; the only differing values are the
wall-clock `maximumInferenceMs` maxima, which are measured durations rather than
decoded results. The `listen-sequence-profile-validation-tone` command reproduces
the paired run's Tone rows exactly, and a focused single-speed smoke reproduces
the corresponding rows of the full run.

The August 20 attribution repair is frozen in
`benchmark-results/listen-sequence-profile-validation-task10.json`: its 18
late-advance records include target timing, causing attack and pitches, distance,
and delay. `benchmark-results/README.md` pins both the exact file SHA-256 and the
cross-run canonical evidence digest.

Nothing here changes a candidate value, a manifest assignment, or the production
default, which remains `baseline-v1`.

### Isolated candidate-matrix confirmation — August 19, 2026

The first frozen-candidate result measured on evidence the multi-domain search
was never allowed to read. The complete isolated corpus — 134 fixtures per
renderer, all of it `confirmation` in manifest version 1 — is rendered and
recognized once per fixture, and `baseline-v1` plus the four frozen candidates
then replay that one retained decoded trace. No threshold was selected from
these numbers, and none was changed after seeing them.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-isolated-profile-validation
```

Measured at commit `fffae2f`, Chrome 151.0.7922.169 on Linux, model
`online_amt_streaming.onnx`, renderers `bundled-piano-web-audio-v1` and
`bundled-piano-tone-v2`. Manifest version 1, hash `0ed1e71d`; 268 isolated
traces captured, one capture per fixture and five profile columns replayed from
each. Registry version 2, candidates `early-open-v2`, `steady-open-v2`,
`early-held-v2`, `steady-held-v2`.

#### Baseline parity

`baseline-v1` reproduces the recorded August 15 paired renderer baseline exactly:
104/106 overall and 52/54 on Course Clear under Direct, 100/106 and 48/54 under
Tone, zero distinguishable false advances, 4 and 5 ambiguous advances, and 196 ms
and 228 ms p95 onset-to-advance latency. Every fixture's baseline column also
reproduces its own capture-time replay event for event, so the harness is fixed
and the candidate columns differ only by the matcher.

#### Direct `bundled-piano-web-audio-v1`

| Profile | Correct | Course Clear | Distinguishable false | Ambiguous | p95 | Fixed gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline-v1` | 104 / 106 (98.1%) | 52 / 54 (96.3%) | 0 | 4 | 196 ms | Pass |
| `early-open-v2` | 106 / 106 (100%) | 54 / 54 (100%) | 1 | 5 | 196 ms | Fail |
| `steady-open-v2` | 106 / 106 (100%) | 54 / 54 (100%) | 1 | 5 | 196 ms | Fail |
| `early-held-v2` | 104 / 106 (98.1%) | 52 / 54 (96.3%) | 1 | 5 | 196 ms | Fail |
| `steady-held-v2` | 104 / 106 (98.1%) | 52 / 54 (96.3%) | 1 | 5 | 196 ms | Fail |

#### Tone `bundled-piano-tone-v2`

| Profile | Correct | Course Clear | Distinguishable false | Ambiguous | p95 | Fixed gate |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `baseline-v1` | 100 / 106 (94.3%) | 48 / 54 (88.9%) | 0 | 5 | 228 ms | Fail |
| `early-open-v2` | 102 / 106 (96.2%) | 50 / 54 (92.6%) | 1 | 5 | 228 ms | Fail |
| `steady-open-v2` | 102 / 106 (96.2%) | 50 / 54 (92.6%) | 1 | 5 | 228 ms | Fail |
| `early-held-v2` | 100 / 106 (94.3%) | 48 / 54 (88.9%) | 1 | 5 | 228 ms | Fail |
| `steady-held-v2` | 100 / 106 (94.3%) | 48 / 54 (88.9%) | 1 | 5 | 228 ms | Fail |

`baseline-v1` fails the fixed isolated gate under Tone for the already recorded
reason — 94.3% is below the 95% overall requirement — not because of anything
this matrix changed. The candidate `Fail` rows are all caused by the false
advance below; latency and Course Clear are unaffected.

#### What each candidate changed

Every profile column comes from the same trace, so each difference is a matcher
decision on identical recognition. No candidate lost a correct advance anywhere.

| Renderer | Profile | Gained correct | New distinguishable false |
| --- | --- | --- | --- |
| Direct | `early-open-v2`, `steady-open-v2` | `isolated/direct/093`, `isolated/direct/094` | `isolated/direct/122` |
| Direct | `early-held-v2`, `steady-held-v2` | none | `isolated/direct/122` |
| Tone | `early-open-v2`, `steady-open-v2` | `isolated/tone/093`, `isolated/tone/094` | `isolated/tone/124` |
| Tone | `early-held-v2`, `steady-held-v2` | none | `isolated/tone/124` |

The two recovered fixtures are both repetitions of Course Clear measure 3,
moment 5, the chord `[53, 65, 74]` whose 65 has been documented as a weak upper
note since the August 15 paired baseline. It is recovered by the two `open`
candidates and not by the two `held` candidates, so the recovery comes from the
0.20 active-target gate rather than from the lower fresh-onset gate: the missing
pitch is present as sustained evidence between 0.20 and 0.275, never as its own
onset.

#### The one new false advance

All four candidates advance one omitted-bass fixture that `baseline-v1` refuses,
and it is a different fixture under each renderer:

| Fixture | Score moment | Target | Played | Advancing profiles |
| --- | --- | --- | --- | --- |
| `isolated/direct/122` | Measure 2, moment 4 | `[48, 60, 68]` | `[60, 68]` | all four candidates |
| `isolated/tone/124` | Measure 2, moment 6 | `[56, 68, 75]` | `[68, 75]` | all four candidates |

These are genuine distinguishable false advances, not harmonic ambiguity: the
bass was never played, and the summary already classifies an octave-related
omission as `ambiguous-harmonic` before it can reach this count. Every
production-eligible profile requires a fresh bass onset, and for a three-note
target the matcher refuses to complete the lowest pitch from sustained evidence,
so the advance can only have come from a decoded onset on a bass pitch that was
never sounded. Both `steady` candidates advance at a 0.50 fresh-onset gate while
`baseline-v1` refuses at 0.60, which places that phantom onset's confidence in
`[0.50, 0.60)`.

This is exactly the trade the multi-domain search could not see: the isolated
omitted-bass fixtures are confirmation data, so no rejection rule was fitted to
them. Whether it disqualifies a candidate is Task 12's gate decision, taken with
the sequence, dynamics, and articulation evidence beside it; nothing here
changes a candidate value or the production default, which remains
`baseline-v1`.

#### Repeatability

The matrix was run twice in fresh browser processes on the final code. Both
exported results are byte-identical, including all 268 decoded-structure hashes,
every frame count, every advancement, and every p95 latency, so the documented
Float32 tolerance was not needed. The single-renderer
`listen-isolated-profile-validation-tone` command reproduces the paired run's
Tone rows exactly. A paired run takes about 80 seconds.

### Multi-domain matcher sweep and frozen candidate registry — August 19, 2026

The first threshold search that spans every domain now known to matter. It
captures the frozen `discovery` and `regression-only` partitions of
`webapp/src/listenTraceManifest.ts` — 176 traces across both renderers, all 13
sequence families at all six speeds, one constant layer per piano, renderer and
loudness band, one mixed-dynamics run per renderer, and one trace of every
articulation category — and replays all 1,000 grid profiles against each
captured trace. The 300 `confirmation` traces are never captured by this
command, so no selection decision can read one.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-matcher-multidomain-sweep
```

Measured at commit `da418d6`, model `online_amt_streaming.onnx`, renderers
`bundled-piano-web-audio-v1` and `bundled-piano-tone-v2`. Manifest version 1,
hash `0ed1e71d`; 176 traces captured, 139 scored, 37 gating runs plus the 2
committed regressions. Grid size 1,000, unchanged.

The August 20 evidence repair separately pins the musical corpus as `10ae2e0b`
and freezes the rerun's complete 1,000-row export at
`benchmark-results/listen-matcher-multidomain-sweep-task08.json`. Its canonical
candidate digest is `fnv1a-32-canonical-json:53ee8a67`; every row includes the
profile, metric vector, safety verdict, and rejection codes. The discovery-only
rerun reproduced every count and selected ID below without reading confirmation
data.

#### What the search rejected

721 of the 1,000 profiles are rejected; 279 are safe. Safety is a hard
constraint over three separate populations and a profile may fail several:

| Rejection | Profiles | Meaning |
| --- | ---: | --- |
| `dedicated-false-advance` | 680 | a false advance in a dedicated safety passage |
| `fresh-bass-not-required` | 500 | the whole `b0` half of the grid, refused structurally |
| `dedicated-skipped-advance` | 500 | a skipped advance in a dedicated safety passage |
| `dedicated-incomplete-carried-bass` | 500 | the carried-bass attack advanced its triad |
| `discovery-safety-regression` | 436 | more false, skipped, or duplicate advances than `baseline-v1` on a scored trace |
| `committed-regression` | 76 | less safe than `baseline-v1` on the Task 06 shared-pitch case |

Scored traces are compared against `baseline-v1` on the same trace rather than
required to be clean outright, because the corpus contains one already-diagnosed
baseline false advance — `course-clear-27` at 333 ms under Tone. An absolute
rule there would either reject `baseline-v1` itself or have to pretend that
event does not exist. The dedicated families and the regression-only runs are
required to be clean outright, and the `v05` source run's late advance is
reported without gating.

#### The safe Pareto frontier and the selected set

30 profiles reach the safe Pareto frontier. The frozen selection rule — declared
in `listenMatcherSweepBenchmark.ts` before the search ran — keeps the ranked
leader and then a further frontier profile only when it beats every already-kept
candidate on some frozen metric by at least that metric's declared material
margin, up to four candidates. It selected four:

| Profile | Sweep ID | Worst domain | Equal domain | Ordered prefix | Complete | Late | p95 | Distance |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `baseline-v1` | `o0p600-t0p500-a0p350-x0p970-b1` | 0.0% | 83.81% | 48.61% | 13.66% | 8 | 211.7 ms | 0 |
| `early-open-v2` | `o0p450-t0p500-a0p200-x0p990-b1` | 16.7% | 86.91% | 63.24% | 20.37% | 2 | 212.6 ms | 0.320 |
| `steady-open-v2` | `o0p500-t0p500-a0p200-x0p990-b1` | 16.7% | 86.83% | 62.94% | 19.91% | 7 | 212.6 ms | 0.270 |
| `early-held-v2` | `o0p450-t0p500-a0p275-x0p990-b1` | 16.7% | 86.19% | 60.47% | 17.82% | 2 | 212.2 ms | 0.245 |
| `steady-held-v2` | `o0p500-t0p500-a0p275-x0p990-b1` | 16.7% | 86.11% | 60.16% | 17.36% | 7 | 212.2 ms | 0.195 |

Every rate above is the manifest's hierarchical equal-weighted mean, so sixteen
Salamander layers weigh what four Splendid layers weigh and the 120-trace
sequence suite weighs what the 2-trace mixed suite weighs. In raw counts over
the 139 scored traces, the leader moves independent recognition from 1,048 to
1,088 of 1,425 events, ordered advances from 833 to 988, ordered prefix from 658
to 801, complete passages from 71 to 84, late advances from 8 down to 2, and
false advances from 1 to 0.

`baseline-v1`'s worst domain is 0.0%: `direct/sequence/shared-sustain` recognizes
nothing at any of its six speeds. That is the passage whose bass is held across
four intervals, and the fresh-bass rule refuses to advance a target whose bass
never re-attacks. The number is a property of a deliberately adversarial passage
under a fixed safety rule, not a decoding failure, and it is exactly why the
frozen metric order takes the worst domain first: no candidate is allowed to buy
an aggregate gain by writing that domain off.

Why each candidate entered, using the metric that made it material against every
already-kept candidate:

| Profile | Entered on |
| --- | --- |
| `early-open-v2` | leader in the frozen metric order |
| `steady-open-v2` | 409 ms less attribution delay on its late advances |
| `early-held-v2` | 0.075 closer to `baseline-v1` than the leader; late advances land one target nearer their own attack than `steady-open-v2`'s |
| `steady-held-v2` | closest to `baseline-v1` of the four, 0.075–0.125 nearer than the two ranked above it |

The last two entered on the diagnostic metrics, not on recognition: they are
worse than the leader on every rate metric and exist as the conservative end of
the frontier, a smaller change to ship if the live trials favour caution. All
four differ from `baseline-v1` in the same directions — a lower fresh-onset gate
(0.45 or 0.50 against 0.60), a lower active-target gate (0.20 or 0.275 against
0.35), and a *higher* unexpected-note gate (0.99 against 0.97).

That last direction is the one place the candidates are more permissive about
what may pass: a 0.98-confidence unexpected note no longer counts as confidently
played, so it no longer blocks. The dedicated extra-note family stays at zero
false, skipped, and duplicate advances for all four at every speed under both
renderers, and the shared-pitch regression's 0.983 extra is covered explicitly by
the Task 06 case, whose 76 unsafe profiles this search rejects.

#### Per-domain effect of the leading candidate

`early-open-v2` improves 16 of the 21 scored leaf domains and worsens none.

| Suite | `baseline-v1` | `early-open-v2` | Change |
| --- | ---: | ---: | ---: |
| Direct sequence | 58.3% | 64.9% | +6.62 pp |
| Direct articulation | 93.8% | 93.8% | none |
| Direct constant layers | 90.1% | 94.4% | +4.32 pp |
| Direct mixed dynamics | 96.3% | 96.3% | none |
| Tone sequence | 61.5% | 63.1% | +1.53 pp |
| Tone articulation | 88.9% | 92.6% | +3.70 pp |
| Tone constant layers | 88.9% | 93.8% | +4.94 pp |
| Tone mixed dynamics | 92.6% | 96.3% | +3.70 pp |

The gain is present under both renderers, in three of the four suites, and in
nine separate sequence families rather than in one cascade: the largest per-family
moves are `direct/sequence/three-note-independent` at +25.0 pp,
`direct/sequence/shared-sustain` at +16.7 pp, both renderers'
`known-weak-chord` at +8.3 pp, and `tone/dynamics-constant/splendid` at +6.2 pp.

#### Both diagnosed cases under the new candidates

All four candidates recover the `v05` repeated chord on its second repetition at
24,448 ms instead of baseline's third at 25,440 ms — an earlier recovery of
correct content, reported as a deviation from the pinned advancement and not as
a safety event. All four also clear the Task 06 shared-pitch case outright: the
target's own 0.531 onset passes their gates, the stall never starts, and the
false advance at 4,768 ms is replaced by an ordered advance at 3,072 ms. That is
where the leader's single scored false advance disappears.

#### Repetition and unchanged historical results

The sweep was run three times in fresh browser processes: twice while measuring,
and once more after the entry-point guards were added, on the code this entry
describes. All three exported results are byte-identical — same manifest hash,
same 176 decoded-structure hashes, same metrics for all 1,000 profiles, same
rejection codes, same 30-profile frontier, and the same four selected
candidates. The Task 04 Float32 tolerance was not needed. The
`listen-matcher-multidomain-sweep-summary` mode was run once and reports the
same selection in an 83 KB export.

| Suite | Result | Change |
| --- | --- | --- |
| Multi-domain sweep, ×3 | 721 rejected, 30 on the frontier, 4 selected | new |
| Direct threshold sweep | 700 rejected, frontier 14, `o0p450-t0p500-a0p200-x0p990-b1` | none |
| Tone threshold sweep | 538 rejected, frontier 3, `o0p500-t0p500-a0p200-x0p970-b1` | none |
| Committed regressions | 2 fixtures × 7 named profiles, 12 reported deviations, none less safe than baseline | +4 profiles replayed |
| Unit suite | 313 main-suite tests, plus 2 in the dynamics pretest | +8 |
| Production build | passes | none |

The registry is now version 2. `baseline-v1`, `balanced-v1`, and `sensitive-v1`
are untouched, and `DEFAULT_LISTEN_MATCHER_PROFILE_ID` remains `baseline-v1`:
this entry selects candidates, it does not change production. `early-open-v2`
repeats `sensitive-v1`'s values exactly and is still registered separately,
because the two were chosen from different corpora under different rules and a
later edit to one generation must not silently move the other.

```bash
npm --prefix webapp test
npm --prefix webapp run build

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-matcher-multidomain-sweep

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-sequence-case-tone course-clear-27 333.33
```

### Frozen discovery and confirmation partition — August 19, 2026

Before the next threshold search runs, `webapp/src/listenTraceManifest.ts` names
every automated listening trace the repository can produce and assigns it, once,
to `discovery`, `confirmation`, or `regression-only`. It also freezes the domain
weighting and the candidate metric order, so no partition, weight, or tie-break
can be chosen after results are visible.

Nothing was re-measured for this entry: no renderer, model, decoder, matcher, or
benchmark result changed. The manifest is a protocol, not a run.

| Partition | Traces | Contents |
| --- | ---: | --- |
| `discovery` | 139 | 120 sequence runs (10 scoring families × 6 speeds × 2 renderers), 5 articulation runs, 12 constant-layer runs, 2 mixed-dynamics runs |
| `confirmation` | 300 | the complete 134-case isolated corpus under both renderers, 27 held-back constant layers, 3 held-back articulations, 2 held-back mixed runs |
| `regression-only` | 39 | the 3 dedicated safety passages at 6 speeds under both renderers, the Tone Salamander `v05` source run, and the 2 committed regressions |

Manifest version 1, hash `0ed1e71d`, 478 traces in total.

Both single-renderer sweeps have been observed, so the entire sequence corpus is
discovery and none of it may be described as held out. Dynamics and articulation
were split before searching, not after: discovery takes one constant layer per
piano, renderer, and loudness band — Splendid `pp`/`mp`/`ff`, Salamander
`v03`/`v09`/`v14` — plus one mixed run per renderer and one articulation of each
category, and everything else stays untouched. Splendid `mp` is discovery
because the articulation matrix's `normal` row renders exactly that passage on
exactly that instrument; the manifest records a content key for each trace and
rejects any manifest that puts the same rendered content in two partitions, so
this near-duplicate cannot be quietly reserved as confirmation. Salamander `v05`
under Tone is `regression-only` rather than confirmation because the committed
late-advance fixture was minimized from it; the same layer under Direct remains
confirmation evidence.

Weights are hierarchical and equal at every level — renderer, then suite, then
piano/articulation/sequence family, then run — so 16 Salamander layers weigh
exactly as much as four Splendid layers and the 268-trace isolated suite weighs
no more than the 8-trace articulation suite. `regression-only` traces carry
weight zero: they gate every profile and score none.

The frozen ranking order after the hard safety gate is worst-domain independent
recognition, equal-domain average independent recognition, ordered prefix,
complete passages, late-advance count, source-to-target distance, attribution
delay, P95 latency, and finally distance from `baseline-v1`, with the profile ID
as the last tie-break. Independent recognition precedes ordered results so one
early recovery cannot win by cascade amplification alone. Safety is carried by
the comparator *and* by the dominance helper: an unsafe candidate never
dominates anything and a safe one always dominates it, so a caller that skips
the frontier's eligibility filter still cannot be told an unsafe profile is
better.

Metric values are quantized to a 1e-9 grid before they are compared, rather than
compared with a pairwise tolerance. A tolerance is not transitive — three values
a little under one tolerance apart give `a == b`, `b == c`, and `a < c`, and the
ranking would then depend on the order the candidates arrived in — while a grid
makes equality an equivalence relation and keeps replay noise far below the step
comparing equal.

The hash folds the version, every assignment, every derived weight, and the
metric order, and `LISTEN_TRACE_MANIFEST_HASH` pins it. Validation enforces that
pin together with the exact per-partition, per-suite census, so dropping one
isolated case, promoting the `v05` run into the scoring corpus, or renaming a
weighting domain is rejected even though each leaves every structural coverage
rule satisfied. The declared version is the only known version: a manifest that
labels itself anything else fails as `unknown-manifest-version` rather than
slipping past the pin, because relabelling an object is not the new-round
process. That process is a reviewed edit to this module — bump
`LISTEN_TRACE_MANIFEST_VERSION`, restate the census, re-pin the hash — followed
by a rerun discovery pass.

| Suite | Result | Change |
| --- | --- | --- |
| Unit suite | 305 main-suite tests, plus 2 in the dynamics pretest | +25 |
| Production build | passes | none |
| Browser benchmarks | not rerun; no measured value depends on this change | none |

```bash
npm --prefix webapp test
npm --prefix webapp run build
```

### Tone Course Clear 333 ms false-advance diagnosis — August 19, 2026

The one advancement the sequence corpus reported as false outside the dedicated
safety families was reproduced in isolation, explained, and committed as a
permanent regression. Unlike the `v05` case, it is a genuine matcher false
advance and its classification is unchanged: a stalled single-note target was
completed by a later chord's shared pitch, from an attack that played a
different chord.

Measured on this development machine at commit `2701153` plus this change, with
Chrome 151.0.7922.137, `bundled-piano-tone-v2` and `bundled-piano-web-audio-v1`,
the unchanged `online_amt_streaming.onnx` model (71,955,821 bytes, SHA-256
`a77be8262d3742ce…`), and the frozen `baseline-v1` profile.

#### Reproducing one run instead of seventy-eight

`listen-sequence-case` renders exactly one bundled passage at one corpus speed
and prints the complete forensic record of every advancement that run counted
against a safety gate — the sequence counterpart of `listen-dynamics-case`. It
resolves a typed interval to the exact corpus value, so `333.33` renders the
same `1000 / 3` passage the corpus renders rather than a slightly different one.

Three consecutive browser processes reproduced the case identically:

| Quantity | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Recognition structure hash | `ab28401f` | `ab28401f` | `ab28401f` |
| PCM hash | `a4bdc702` | `b35d1ef8` | `2533072c` |
| Independent / ordered | 23 / 8 of 27 | 23 / 8 of 27 | 23 / 8 of 27 |
| Safety false / skipped / duplicate / late | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 |
| Advancement | target 8 at 4,768 ms | target 8 at 4,768 ms | target 8 at 4,768 ms |

As with `v05`, the FNV PCM hash is an identity within one browser process only;
the decoded structure, recognition, and the advancement itself reproduce exactly,
so the regression is pinned to the decoded-structure hash `ab28401f`.

The same passage under `bundled-piano-web-audio-v1` reproduces its corpus result
— 26 independent, 4 ordered, 0/0/0, no late advance, structure hash `b9ff48f2` —
so this case, like `v05`, belongs to the Tone signal path rather than to the
passage.

#### What actually happened

Course Clear target 8 is measure 2 moment 1, the single note `[56]`, played at
2,886.67 ms. The matcher advanced it 1,881 ms later, at 4,768 ms, from the
physical attack of target 13.

| Field | Value |
| --- | --- |
| Target | 8, `[56]`, scheduled 2,886.67 ms |
| Advanced | 4,768 ms, generation 9, trace frame 148 |
| Attribution delay | 1,881 ms against a 464 ms window |
| Source attack | 13, scheduled 4,553.33 ms, played `[56, 68, 75]` |
| Pitches accepted | `[56]`, no rejected extras |
| Carried into the target | `[60, 67, 76]` |

The decoded evidence explains every step:

| Frame | Attack | Fresh onsets | Effect on target 8 |
| --- | --- | --- | --- |
| 3,040 ms | 8, `[56]` | 56 @ 0.531 | Below the 0.60 onset gate; the target stays armed |
| 3,392 ms | 9, `[51, 60]` | 51 @ 1.000, 60 @ 1.000 | Confidently unexpected; refused |
| 3,712 ms | 10, `[56, 63]` | 56 @ 0.975, 63 @ 0.983 | 63 is above the 0.97 extra-note gate; refused |
| 4,064 ms | 11, `[48, 60, 68]` | 48, 60, 68 ≥ 0.994 | No 56; refused |
| 4,384 ms | 12, `[51, 63, 72]` | 51, 63, 72 ≥ 0.972 | No 56; refused |
| 4,736 ms | 13, `[56, 68, 75]` | 56 @ 0.995 only | Nothing unexpected is fresh; advanced at 4,768 ms |

The target's own attack produced an onset of 0.531 — active confidence for 56
reached 0.9999, but the onset never qualified — so `baseline-v1`'s 0.60 gate left
a one-note target armed across five following attacks. The extra-note gate then
did its job on every attack that could otherwise have completed it, including
`[56, 63]`, whose 63 arrived at 0.983. It could not do its job on
`[56, 68, 75]`: 68 was already sounding from attack 11 and so was carry-over
rather than fresh evidence, and 75 — the weak upper note this Tone fixture is
already documented to miss in isolated trials — produced no onset at all. That
left 56 as the only fresh pitch in the frame, which is exactly what the
single-note target was waiting for.

The attribution is correct: attack 13's audio did cause the advancement, and the
1,881 ms delay is far outside the 464 ms window, so the replay credits the chord
that was actually sounding. The classification is also correct and is preserved.
This is not a late advance: `late-advance` requires an attack that played exactly
the advanced target's chord, and `[56, 68, 75]` is not `[56]`. The matcher
accepted a subset of a different chord, and the two pitches that would have
identified it as a different chord were invisible to the gate.

The playhead moved forward while the player was five moments ahead of it, so this
advance leaves the playhead behind rather than ahead. That is what keeps it out
of the `skipped` family, not what makes it safe. A target completed by unrelated
later content is the failure the exact-chord policy exists to prevent, and it is
counted as a false advance in every profile comparison.

#### The committed regression

`listenSafetyRegressionFixtures.ts` stores the case as 79 decoded frames from
2,432 ms to 4,928 ms — moment 7 through the advancement — with no PCM and no
model scores. Attack indices are preserved, so every stored timestamp is the
measured one. Replaying the fixture reproduces the advancement at 4,768 ms from
the local source attack 6, with carry-in `[60, 67, 76]` and accepted pitch
`[56]`.

The fixture pins the advancement itself, not merely its category, and a focused
rerun re-verifies the live run against it: same decoded-structure hash, same
advancement time, same causing attack, same classification. A mismatch aborts the
browser command. Fixture matching now includes the speed the case was measured
at, so the same passage rendered at another interval is correctly treated as a
different run rather than a failed reproduction.

The three registered profiles do not agree on this case, and the disagreement is
the whole point of pinning it:

| Profile | Advanced | From | Classification | False / skipped / duplicate | Ordered advances |
| --- | --- | --- | --- | --- | ---: |
| `baseline-v1` | 4,768 ms | attack 13, `[56, 68, 75]` | false advance | 1 / 0 / 0 | 1 of 7 |
| `balanced-v1` | 3,072 ms | attack 8, `[56]` | ordered advance | 0 / 0 / 0 | 6 of 7 |
| `sensitive-v1` | 3,072 ms | attack 8, `[56]` | ordered advance | 0 / 0 / 0 | 6 of 7 |

Both first-generation candidates accept the 0.531 onset that baseline rejects, so
the stall never begins, the false advance never happens, and the passage advances
in order instead. Like the `v05` result, this is a preview of the Task 08
comparison rather than a result of it.

#### Every grid profile assessed against the case

All 1,000 exploratory profiles were replayed against the fixture. The case
separates the grid into four measured regions:

| Profiles | Advanced | Safety | Why |
| ---: | --- | --- | --- |
| 570 | 4,768 ms from attack 13 | 1 false | Reproduce the pinned advance: 0.531 is below their onset or target-note gate, and their extra-note gate ≤ 0.97 refuses the 0.983 extra in `[56, 63]` |
| 240 | 3,072 ms from attack 8 | 0 false, ordered | Onset ≤ 0.50 and target-note ≤ 0.50, both below 0.531, so the stall never starts |
| 114 | 3,744 ms from attack 10 | 1 false | A 0.99 extra-note gate no longer treats the 0.983 extra as unexpected, so the earlier `[56, 63]` falsely completes the target instead |
| 76 | 3,744 ms from attack 10 | **3 false** | The same 0.99 extra-note gate with an active-target gate of 0.20 or 0.275 cascades into three false advances |

Only the last region is less safe than the profile the case was measured with, so
the regression rejects those 76 profiles and reports the remaining 354 deviations
without penalising them — including the 240 that are strictly better here.
`worseThanBaselineCount` was added to the regression summary because a corpus
that pins a genuine false advance no longer has a raw total of zero; the raw
totals stay visible, but only that count gates.

The comparison behind it is per target, not per total. Once a fixture pins a real
false advance, a candidate that fixes the pinned target and breaks a different
one has the same total as baseline, and comparing sums would report it as
unchanged. Each replay is therefore compared target by target against the
reference run: losing a baseline safety event is allowed, and so is the pinned
event reappearing where it was measured, but any target that becomes unsafe when
it was not is listed in `newlyUnsafeTargets` and rejects the profile.

The 76 rejected profiles are a real result rather than bookkeeping: a relaxed
extra-note gate combined with a permissive active-target gate is exactly the
region a recognition-driven search is drawn to, and this case is where it becomes
unsafe.

#### Sweep rejection counts

Adding a regression that rejects profiles changes both exploratory sweeps, and
the change is fully accounted for. The same 76 profiles are flagged under both
renderers, because fixture replay depends only on the profile; they differ only
in how many were already rejected by the sequence safety families.

| Sweep | Rejected before | Already rejected | Newly rejected | Rejected now | Frontier | Recommendation |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Direct, 1,000 profiles | 680 | 56 of 76 | 20 | 700 | 15 → 14 | `o0p450-t0p500-a0p200-x0p990-b1`, unchanged |
| Tone, 1,000 profiles | 500 | 38 of 76 | 38 | 538 | 3 → 3 | `o0p500-t0p500-a0p200-x0p970-b1`, unchanged |

Neither recommendation is in the rejected region: both have an onset gate at or
below 0.50 and a target-note gate at 0.50, so the target never stalls for them
and their extra-note gates never face the shared pitch. One profile left the
Direct frontier because it is among the 20 the regression newly rejects; the
Tone frontier is unchanged. Both renderers still report `replayParityVerified`,
and `baseline-v1` reproduces both committed advancements with zero deviations in
both sweeps.

#### Re-measured results

| Suite | Result | Change |
| --- | --- | --- |
| Sequence corpus, Direct | 0/0/0 with 8 late advances; per-speed completion, ordered advances, and P95 as recorded | none |
| Sequence corpus, Tone | 1 false advance at 333 ms in `course-clear-27`, now diagnosed and pinned | none |
| Dedicated safety families, both renderers | 0/0/0 at every speed | none |
| Committed regressions | 2 fixtures × 3 named profiles, 4 reported deviations, none less safe than baseline | `v05` alone became `v05` plus this case |
| Unit suite | 280 main-suite tests, plus 2 in the dynamics pretest | +9 |

Commands:

```bash
npm --prefix webapp test
npm --prefix webapp run build

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-sequence-case-tone course-clear-27 333.33

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-sequence-case-legacy course-clear-27 333.33

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence

node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep
```

`CHROME_PATH` selects the browser on machines where the Windows development
install is not the one running the benchmark; measured results remain comparable
only within one browser build.

### Tone plus Salamander `v05` safety diagnosis — August 17, 2026

The single deterministic false advancement in the August 16 constant-layer
dynamics matrix was reproduced in isolation, explained, reclassified, and
committed as a permanent regression. It was not a matcher failure. The matcher
accepted only pitches the player had played, rejected nothing, skipped no target,
advanced no target twice, and left the playhead behind the player rather than
ahead of them. The count came from the benchmark's advance classification, not
from the matcher.

Measured on the development Windows machine at commit `26da7a5` with
`bundled-piano-tone-v2` and `bundled-piano-web-audio-v1`, the unchanged
`online_amt_streaming.onnx` model (71,955,821 bytes, SHA-256 `a77be8262d3742ce…`),
and the frozen `baseline-v1` profile.

#### Reproducing one run instead of forty

`listen-dynamics-case` renders exactly one constant-layer Course Clear run and
prints the complete forensic record of every advancement that run counted against
a safety gate: target index, generation, advancement time and trace frame, source
attack, attribution delay, accepted pitches, rejected extras, carried-over
pitches, and the surrounding decoded frames.

Three consecutive browser processes reproduced the case identically:

| Quantity | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Recognition structure hash | `b043076d` | `b043076d` | `b043076d` |
| Peak | 0.3653072416782379 | 0.3653072416782379 | 0.3653072416782379 |
| RMS | 0.04367413884457393 | 0.04367413882791928 | 0.04367413884435765 |
| PCM hash | `89271f60` | `c3315734` | `2f7395ec` |
| Independent / ordered | 25 / 23 of 27 | 25 / 23 of 27 | 25 / 23 of 27 |
| P95 independent / ordered | 228 / 228 ms | 228 / 228 ms | 228 / 228 ms |
| Advancement | target 23 at 25,440 ms | target 23 at 25,440 ms | target 23 at 25,440 ms |

The August 16 matrix recorded this run's PCM as `aadb4ce2`. The FNV PCM hash is an
identity within one browser process, not across processes: Chrome's
`OfflineAudioContext` does not reproduce its last bits, the same limitation the
August 17 parity entry measured. Peak, frame count, decoded structure,
recognition, latency, and the advancement itself all reproduce exactly, so the
regression is pinned to the decoded-structure hash `b043076d`.

#### What actually happened

Course Clear repeats measure 3 moment 8 three times: targets 23, 24, and 25 are
all `[62, 74, 82]`, played at 23,220, 24,220, and 25,220 ms. Target 23 was armed
at 22,432 ms while D5 and A#5 were still sounding from moment 7, so the matcher
required a fresh decoder attack for each of the three pitches.

| Attack | D4 (62) | D5 (74) | A#5 (82) | Result |
| --- | --- | --- | --- | --- |
| 23 at 23,220 ms | onset 0.9954 | no attack, max active 0.1935 | onset 0.9936 | incomplete |
| 24 at 24,220 ms | onset 0.5968, below the 0.60 gate | no attack, max active 0.4587 | onset 0.8661 | incomplete |
| 25 at 25,220 ms | onset 0.9999 | onset 0.8152 | onset 0.9980 | matched at 25,440 ms |

The decoder produced no re-onset for the held D5 across the first two repetitions,
the same retrigger limitation the August 14 score-rise experiment measured and
could not fix safely. The attempt therefore completed only on the third
repetition.

| Field | Value |
| --- | --- |
| Target | 23, `[62, 74, 82]`, scheduled 23,220 ms |
| Advanced | 25,440 ms, generation 24, trace frame 794 |
| Attribution delay | 2,220 ms against a 464 ms window |
| Source attack | 25, scheduled 25,220 ms, played `[62, 74, 82]` |
| Pitches accepted | `[62, 74, 82]`, no rejected extras |
| Carried into the target | `[65, 70, 74, 82]` |

The same focused run under `bundled-piano-web-audio-v1` reproduced its August 16
Direct result exactly — 23 independent, 3 ordered, 0/0/0, and no late advance —
so the case belongs to the Tone signal path, not to the passage.

The attribution itself is correct: attack 25's audio did cause the advancement.
The classification was not. `falseAdvance` fired only because the causing attack
belonged to a later target, which is unavoidable whenever a score repeats one
chord and recognition lands on a later repetition.

#### The corrected rule

An advancement caused by an attack other than the target's own is now a
`late-advance` when that attack played exactly the advanced target's chord and
was not a deliberate wrong-note safety attack. Everything else stays unsafe:

- An advance before the target's own scheduled attack is still `skipped`.
- An advance from a deliberate wrong or extra-note attack is still false.
- An advance from an attack that played any other chord is still false.
- A second advance from one physical attack is still `duplicate`.

A late advance can only leave the playhead behind the player, never ahead, which
is the property the safety gate exists to protect. It is never counted as an
ordered advance, and `lateAdvanceCount` is reported at run, per-speed, aggregate,
dynamics, and safety-summary level so a profile cannot trade recognition for lag
unnoticed.

#### The committed regression

`listenSafetyRegressionFixtures.ts` stores the case as 110 decoded frames from
22,112 ms to 25,600 ms — moment 7 through the advancement — with no PCM and no
model scores. Attack indices are preserved, so every stored timestamp is the
measured one. Replaying the fixture reproduces the advancement at 25,440 ms from
source attack 25, with carry-in `[65, 70, 74, 82]` and accepted pitches
`[62, 74, 82]`.

A fresh capture taken after the fixture was generated matched every stored frame
time, onset, note event, active pitch, and evidence pitch, with confidences
differing by at most 2.2e-05 — far below any threshold in the three named
profiles.

The committed frames are not the only thing checked. A focused rerun of a case a
fixture was cut from re-verifies that run against the fixture: same decoded
structure hash, same advancement time, same causing attack, same classification.
A mismatch aborts the browser command, so a changed model, renderer, or decoder
cannot silently stop producing the event while the frozen frames keep passing.
The correct response to that failure is to re-diagnose the case and regenerate
its fixture, not to relax the check.

The fixture pins the advancement itself, not merely its category: the exact
advancement time and the attack the replay credits it to. A repeated chord offers
several attacks that could each legitimately complete the same target, so "still a
late advance" would not be a meaningful pin — and the three registered profiles do
not in fact agree on which repetition recovers it:

| Profile | Advanced | From | Classification | False / skipped / duplicate | Pinned advance |
| --- | --- | --- | --- | --- | --- |
| `baseline-v1` | 25,440 ms | third repetition | late advance | 0 / 0 / 0 | reproduced |
| `balanced-v1` | 24,448 ms | second repetition | late advance | 0 / 0 / 0 | deviates |
| `sensitive-v1` | 24,448 ms | second repetition | late advance | 0 / 0 / 0 | deviates |

Both more sensitive profiles complete the chord one repetition earlier, because
D4's 0.5968 onset on the second repetition clears their 0.50 and 0.45 onset gates
but not baseline's 0.60. That is a recognition gain on a case baseline stalls on,
and neither profile becomes unsafe on it. It is a preview of the Task 06-08
comparisons rather than a result of them, and it is visible only because the
advancement is pinned.

The sweep and retrigger benchmarks now summarize safety through
`summarizeListenSafety`, which replays the committed regressions with the same
profile as the runs it is summarizing, so no candidate can report a clean safety
summary while regressing this domain. Deviating from the pinned advance is
reported and never gates: only a result less safe than the fixture's own
`baseline-v1` replay rejects a candidate.

#### Re-measured results

| Suite | Result | Change |
| --- | --- | --- |
| Constant-layer dynamics, Direct | 45.5% ordered, 90.9% independent, 0/0/0, 0 late | none |
| Constant-layer dynamics, Tone | 40.6% ordered, 89.2% independent, 0/0/0, 1 late | safety 1/0/0 became 0/0/0 with one late advance |
| Sequence corpus, both renderers | Per-speed completion, ordered advances, and P95 identical to August 17 | none |
| Dedicated safety families, both renderers | 0/0/0 at every speed | none |
| Next-onset buffer experiment | Direct −5 correct advances and −1 complete passage; Tone unchanged; still rejected | none |
| 1,000-profile sweep, Direct | 680 rejected, 15-profile frontier, `o0p450-t0p500-a0p200-x0p990-b1` | none |
| 1,000-profile sweep, Tone | 500 rejected, same 3-profile frontier and `o0p500-t0p500-a0p200-x0p970-b1` | 575 rejected became 500 |

The Tone sweep's rejection count is the one number the corrected rule moved, and
it moves for a fully accounted reason. Exactly 75 of the 1,000 Tone candidates
have late advances and are otherwise clean — zero false, skipped, duplicate, and
incomplete-carried-bass advances — so they are no longer rejected, and 575 minus
75 is 500. All 75 occur at 333 ms in `carried-bass-safety`, whose targets 1 and 2
are the same `[48, 60, 64]` triad played twice, and all 75 still require a fresh
bass onset. The incomplete-carried-bass counter that suite exists for is unchanged
and still gates. Under Direct, 90 candidates also show late advances but every one
of them fails another safety counter as well, so its rejection count stays at 680,
which is an independent check that the rule did not simply relax the gate. No
candidate under either renderer was rejected by the committed regression, and
both renderers still report `replayParityVerified` against the frozen
`baseline-v1` entry.

The pinned advancement is doing visible work in the sweep. 592 of the 1,000
candidates deviate from it and 408 reproduce it exactly, identically under both
renderers because the fixture replay depends only on the profile. Every one of
the 592 deviates the same way — 24,448 ms from the second repetition instead of
25,440 ms from the third — and not one of the 1,000 turns the case into anything
other than a late advance. 156 deviating candidates remain eligible under Direct
and 84 under Tone; 78 overlap, leaving 162 distinct candidates eligible under at
least one renderer. That is the point of separating the pin from the gate:
recovering a diagnosed case sooner is reported, not punished.

Every per-layer cell of the 40-run constant matrix reproduced its August 16
independent, ordered, missed, P95, peak, and RMS values. The only changed cell is
Tone plus Salamander `v05`, and it changed because of the classification rather
than because of recognition. The corrected rule is strictly subtractive — the new
condition is the old one plus `and not a late advance` — so it can remove a false
advance but never create one. The Tone per-speed summary still reports one false
advance at 333 ms outside the dedicated safety families; that case is therefore
not introduced here and remains separate and undiagnosed.

Commands:

```powershell
npm --prefix webapp test
npm --prefix webapp run build

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-case-tone salamander v05

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-case-legacy salamander v05

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-constant

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep
```

### Matcher profile registry refactor parity — August 17, 2026

This entry records a refactor verification, not a new measured baseline. The
matcher profile registry (`listenMatcherProfiles.ts`), the extracted 1,000-profile
sweep (`listenMatcherSweepBenchmark.ts`), and the migration of production and
benchmark consumers onto one profile type and one option conversion were checked
against the measured sections below. No recognition, safety, latency, PCM, or
export value changed.

Measured on the development Windows machine at commit `1ec55a1` with the
`bundled-piano-web-audio-v1` and `bundled-piano-tone-v2` renderers and the
unchanged `online_amt_streaming.onnx` model (71,955,821 bytes,
SHA-256 `a77be8262d3742ce…`). Production still resolves `baseline-v1`, whose
converted options equal the former `onlineAmtChordMatcherOptions` field for
field: onset 0.60, target-note 0.50, active-target 0.35, extra-note 0.97, fresh
bass required, 32 ms settle, and `noteEvents` refractory counting.

Baseline parity is now asserted by the harness itself rather than by inspection.
Every captured continuous run, articulation run, dynamics run, and isolated trial
is replayed with the explicitly named `baseline-v1` profile and compared event for
event. Every capture path also signs the rendered waveform before inference runs
and requires the trace's audio signature to match that snapshot chunk hash for
chunk hash, and re-hashes the retained trace immediately after each individual
replay — current, baseline, and buffered alike — so a mutation is attributed to
the replay that caused it and cannot be masked by a later replay restoring the
value. A mismatch aborts the benchmark with the differing field path. The
canonical Splendid `mp` smoke is additionally compared against constants recorded
before the refactor, so shared-code drift cannot update both sides of a
self-comparison.

What can be frozen across runs is bounded by the platform. Rendering the same
isolated C-major chord three times in one browser process produced three
different waveform hashes (`4981972c`, `678237b9`, `1cdd544c`) with an identical
peak and RMS differing by 3e-10, and inference over those waveforms produced
first-onset confidences spanning 0.9997449028 to 0.9997449116. Chrome's
`OfflineAudioContext` and ONNX Runtime therefore do not reproduce their last bits,
so a fixed waveform or raw-score hash would fail roughly two runs in three. The
decoded structure does reproduce: a hash over per-frame argmax states, the silence
gate, and every decoded onset, note event, active pitch, and evidence pitch with
its timestamp was identical across five captures in each of three browser
processes.

The canonical comparison therefore requires exact equality for sample counts,
advancement, onset timing, recognized pitches, and the decoded structure hash
(`83fbd243` Direct, `5c164339` Tone), and allows continuous values — renderer
amplitudes and model confidences — to differ by at most one representable Float32
step. That step is 5.96e-8 near unit confidence and 7.45e-9 near the measured RMS,
between 20× and 25× the observed run-to-run spread. Within a single run no
tolerance applies: rendered-versus-recognized PCM, replayed runs, and full
recognition hashes are compared exactly.

| Regression | Result | Compared against |
| --- | --- | --- |
| Paired isolated smoke | `matched-recorded-baseline`, both renderers, three consecutive browser processes | Paired renderer baseline, August 15 |
| Sequence corpus, 13 families × 6 speeds | Identical per-speed completion, ordered advances, and P95 latency | Paired renderer baseline, August 15 |
| Course Clear articulation matrix | `no-detached-benefit`, identical four-profile table | Corrected articulation matrix, August 13 |
| Dynamics smoke, Splendid and Salamander | Unchanged advancement and PCM identities | Paired renderer baseline, August 15 |
| 1,000-profile threshold sweep | 680 rejected, 15-profile frontier, `o0p450-t0p500-a0p200-x0p990-b1` | Threshold replay sweep, August 13 |

The canonical isolated smoke reproduced its recorded identities exactly:

| Renderer | Advanced | Onset to advance | Peak | RMS | Trace frames |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct v1 | Yes | 196 ms | 0.603168 | 0.100907 | 35 |
| Tone v2 | Yes | 196 ms | 0.432499 | 0.078035 | 35 |

The continuous corpus reproduced both renderers row for row, with all
safety-family false, skipped, and duplicate advances at zero and the next-onset
buffer experiment still rejected (Direct −5 correct advances and −1 complete
passage; Tone unchanged):

| Interval | Complete passages, Direct / Tone | Ordered advances, Direct / Tone | P95 ordered latency, Direct / Tone |
| --- | ---: | ---: | ---: |
| 1000 ms | 8 / 13 · 9 / 13 | 66 / 85 · 63 / 85 | 220 ms · 228 ms |
| 500 ms | 9 / 13 · 9 / 13 | 73 / 85 · 70 / 85 | 208 ms · 224 ms |
| 333.33 ms | 7 / 13 · 9 / 13 | 43 / 85 · 56 / 85 | 228 ms · 228 ms |
| 250 ms | 9 / 13 · 10 / 13 | 53 / 85 · 63 / 85 | 214 ms · 234 ms |
| 167 ms | 7 / 13 · 8 / 13 | 45 / 85 · 52 / 85 | 221 ms · 228 ms |
| 125 ms | 9 / 13 · 8 / 13 | 51 / 85 · 51 / 85 | 231 ms · 234 ms |

The sweep reproduced its discovery result under both renderers. Direct kept the
production baseline at 291 independent matches, 283 ordered advances, 199 prefix
completions, 33 complete passages, and 214.67 ms P95, and recommended
`o0p450-t0p500-a0p200-x0p990-b1` at 308 / 365 / 268 / 43 and 209.33 ms with all
four dedicated safety counters at zero. Tone rejected 575 profiles and kept its
three-profile frontier led by `o0p500-t0p500-a0p200-x0p970-b1`. Both runs report
`replayParityVerified`, which now means the frozen `baseline-v1` entry rather than
a mutable production pointer.

Commands, run on a clean local Vite server:

```powershell
npm --prefix webapp test
npm --prefix webapp run build

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep
```

### Paired renderer baseline — August 15, 2026

Measured with Chrome 152.0.7977.42 on the 10-logical-processor development
Windows machine at commit `d95922c`. The matcher, model, fixtures, schedules,
sample rate, and chunk size were identical between renderers. The paired smoke
test passed before the complete isolated corpus (106 correct trials plus safety
cases) and complete 13-family × 6-speed continuous corpus were each run twice;
both repetitions produced the same recognition summaries and failure identities.

The preflight rendered and recognized one C-major triad through the complete
browser pipeline before the full runs began:

| Renderer | Advanced | Onset-to-advance | PCM peak | PCM RMS | Trace frames |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct v1 | Yes | 196 ms | 0.603168 | 0.100907 | 35 |
| Tone v2 | Yes | 196 ms | 0.432499 | 0.078035 | 35 |

Isolated accuracy:

| Metric | Direct v1 | Tone v2 | Tone delta |
| --- | ---: | ---: | ---: |
| Correct trials advanced | 104 / 106 (98.1%) | 100 / 106 (94.3%) | −4 (−3.8 pp) |
| Course Clear correct trials advanced | 52 / 54 (96.3%) | 48 / 54 (88.9%) | −4 (−7.4 pp) |
| Distinguishable wrong-note false advances | 0 | 0 | 0 |
| Mathematically ambiguous advances | 4 | 5 | +1 |
| P95 onset-to-advance latency | 196 ms | 228 ms | +32 ms |
| Fixed acceptance gate | Pass | Fail | — |

Every miss was deterministic and occurred twice because each Course Clear
fixture is repeated twice:

| Course Clear target | Missing onset | Direct misses | Tone misses |
| --- | ---: | ---: | ---: |
| Measure 2, moment 6: `[56, 68, 75]` | 75 | 0 | 2 |
| Measure 3, moment 4: `[50, 62, 70]` | 70 | 0 | 2 |
| Measure 3, moment 5: `[53, 65, 74]` | 65 | 2 | 2 |

The Tone path therefore exposes two additional weak upper-note cases and does
not pass the existing 95% overall or Course Clear acceptance thresholds. Its
lower C-major preflight peak/RMS is consistent with a materially different
processed signal level, but this one fixture does not by itself prove that level
is the cause of the additional misses.

Continuous production-policy results aggregate 78 passages and 510 expected
events:

| Metric | Direct v1 | Tone v2 | Tone delta |
| --- | ---: | ---: | ---: |
| Complete passages | 49 / 78 (62.8%) | 53 / 78 (67.9%) | +4 (+5.1 pp) |
| Raw complete evidence | 418 / 510 (82.0%) | 377 / 510 (73.9%) | −41 (−8.0 pp) |
| Independent matches | 330 / 510 (64.7%) | 329 / 510 (64.5%) | −1 (−0.2 pp) |
| Ordered advances | 331 / 510 (64.9%) | 355 / 510 (69.6%) | +24 (+4.7 pp) |
| All-sequence false advances | 8 | 1 | −7 |
| Safety-family false / skipped / duplicate | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

The per-speed comparison keeps passage completion, ordered advancement, and
latency adjacent:

| Interval | Complete passages, Direct / Tone | Ordered advances, Direct / Tone | P95 ordered latency, Direct / Tone |
| --- | ---: | ---: | ---: |
| 1000 ms | 8 / 13 · 9 / 13 | 66 / 85 · 63 / 85 | 220 ms · 228 ms |
| 500 ms | 9 / 13 · 9 / 13 | 73 / 85 · 70 / 85 | 208 ms · 224 ms |
| 333.33 ms | 7 / 13 · 9 / 13 | 43 / 85 · 56 / 85 | 228 ms · 228 ms |
| 250 ms | 9 / 13 · 10 / 13 | 53 / 85 · 63 / 85 | 214 ms · 234 ms |
| 167 ms | 7 / 13 · 8 / 13 | 45 / 85 · 52 / 85 | 221 ms · 228 ms |
| 125 ms | 9 / 13 · 8 / 13 | 51 / 85 · 51 / 85 | 231 ms · 234 ms |

Tone improves aggregate ordered progression and reduces cascading false
advances, particularly at 3–6 events/second, despite producing less raw complete
evidence and worse isolated chord accuracy. The next-onset-buffer experiment
remains rejected under both renderers: Direct lost five correct advances and one
complete passage while retaining eight false advances; Tone gained nothing and
retained one false advance.

These results must remain side by side rather than being combined into one score.
Direct v1 preserves the historical deterministic regression, while Tone v2 is a
separate app-graph robustness gate that the current preliminary matcher does not
yet pass. Neither result replaces acoustic-piano, microphone, room-noise, varied
velocity, or digital-piano trials.

### Paired legacy and app-playback renderers — August 15, 2026

The listening automation now runs each recognition benchmark twice and keeps the
results as adjacent configurations:

- `*-legacy` uses the unchanged `bundled-piano-web-audio-v1` renderer: direct
  sample mixing, its historical chord-gain curve, and a linear 350 ms release.
- `*-tone` uses `bundled-piano-tone-v2`. It shares the app's Tone.js sampler
  construction, velocity curve, exponential release, sampler volume, compressor,
  and limiter rather than duplicating those settings in benchmark code.

Both paths use the same bundled sample recordings, schedules, chunk alignment,
model, matcher, and acceptance criteria. Renderer identity is included in full and
summary JSON exports, so a result from one path cannot be mistaken for the other.
The historical renderer remains the default when the benchmark API is called
without an explicit renderer; `benchmark-renderer=tone` selects the app-playback
path on the benchmark page.

`listen-parity` intentionally remains legacy-only. Its sample-linearity and
additivity checks describe the direct mixer and are not valid after the app graph's
compressor and limiter. All recognition modes (`listen-accuracy`, sequence,
articulation, inference-reset, threshold, and retrigger) run the paired
configurations automatically. This entry records the harness change only; it does
not replace either renderer's measured baseline with unrecorded results.

### Score-rise retrigger replay — August 14, 2026

This benchmark-only experiment added an isolated score-rise detector beside the
trace-replay harness and replayed retained raw model scores/states. The production
`OnlineAmtOutputDecoder` contains no retrigger options or detector integration, and
`onlineAmtWorker.ts` remains unchanged. The experimental detector receives only
current/past model output, signal state, and decoder history; scheduled attacks and
score pitches are used only after decoding for evaluation.

The measured corpus contained 82 stateful traces: all 13 continuous sequence
families at six speeds (78 traces) plus detached, normal, legato, and
sustained-shared Course Clear articulation traces. Disabled replay reproduced every
captured onset, note event, active-confidence value, and timestamp exactly before
the sweep. The full automation export records `pcmHash`, byte length, frame count,
and reset mode for every trace. Articulation PCM identities from the full diagnostic
run were:

| Articulation | PCM hash | Bytes | Frames |
| --- | --- | ---: | ---: |
| Detached | `73a9e085` | 1,736,704 | 848 |
| Normal | `c7bc8914` | 1,736,704 | 848 |
| Legato | `c753ad3e` | 1,759,232 | 859 |
| Sustained shared | `2962fe17` | 1,736,704 | 848 |

The opportunity audit evaluated 1,318 scheduled pitch attacks. Expected transition
type came from acoustic-envelope overlap, while either observed `onset` or
`reOnset` counted as a physical attack.

| Audit classification | Pitch attacks |
| --- | ---: |
| Hidden rise under sustain | 2 |
| No event and no useful rise | 165 |
| Decoder event below matcher threshold | 40 |
| Decoder event blocked by matcher/carry-over/playhead state | 533 |
| Already recognized | 578 |

Both hidden opportunities were Course Clear attack 20, MIDI 65:

| Trace | Scheduled attack | Expected / observed | Peak attack probability | Local minimum | Maximum rise | Active confidence | Existing failure |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Continuous, 250 ms | 5,220 ms | `reOnset` / none | 0.35676 | 0.00000018 | 0.35676 | 0.99476 | `carry-over` |
| Legato articulation, 1000 ms | 20,220 ms | `onset` / none | 0.44633 | 0.00000008 | 0.44633 | 0.99979 | `carry-over` |

The fixed grid evaluated all 432 requested combinations. Exact synthetic-stream
memoization reduced downstream matcher replay to five unique event streams without
changing per-candidate decoding or physical/safety attribution. All 432 candidates
failed decoder safety; 351 also failed at least one matcher gate. No candidate was
eligible.

The highest-ranked diagnostic profile was
`p0p350-r0p300-a0p300-l3-f4` (peak 0.35, rise 0.30, re-arm 0.30,
3-frame lookback, 4-frame refractory). It recovered both hidden attacks at 156 ms
and 164 ms latency, respectively. Recoveries were confined to Course Clear (one at
250 ms and one in 1000 ms legato); repeated notes, repeated chords, shared bass,
and other shared-pitch families gained no missing physical attacks.

The same candidate emitted 24 synthetic events: 2 recoveries, 5 duplicates of
natural attacks, and 17 unassigned decoder false positives. The duplicate events
were:

| Trace | MIDI | Time | Attack probability | Assigned attack | Latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Carried-bass safety, 500 ms | 64 | 1,856 ms | 0.38536 | 3 | 136 ms |
| Carried-bass safety, 333⅓ ms | 60 | 1,024 ms | 0.39545 | 2 | 137.33 ms |
| Independent triads, 167 ms | 64 | 608 ms | 0.35265 | 2 | 54 ms |
| Course Clear, 167 ms | 60 | 2,048 ms | 0.49997 | 11 | -9 ms |
| Legato articulation | 76 | 7,360 ms | 0.49045 | 7 | 140 ms |

Every unassigned synthetic decoder event is listed below. Eight occurred during a
held-note window, eight during a release tail, and one was outside either envelope
category. These counts overlap neither the five duplicates nor the two recoveries.

| Trace | MIDI | Time | Attack probability | Safety classification |
| --- | ---: | ---: | ---: | --- |
| Weak chord, 333⅓ ms | 70 | 736 ms | 0.38858 | Release tail |
| Course Clear, 333⅓ ms | 75 | 5,056 ms | 0.45162 | Release tail |
| Course Clear, 333⅓ ms | 72 | 5,376 ms | 0.38991 | Release tail |
| Course Clear, 250 ms | 75 | 3,872 ms | 0.41414 | Held note |
| Rolled triads, 250 ms | 48 | 640 ms | 0.37886 | Held note |
| Course Clear, 167 ms | 52 | 704 ms | 0.47213 | Held note |
| Course Clear, 167 ms | 52 | 1,376 ms | 0.43618 | Release tail |
| Course Clear, 167 ms | 55 | 1,568 ms | 0.36049 | Release tail |
| Course Clear, 167 ms | 53 | 4,064 ms | 0.53490 | Release tail |
| Course Clear, 167 ms | 70 | 4,544 ms | 0.46838 | Unassigned, outside held/tail windows |
| Rolled triads, 167 ms | 62 | 736 ms | 0.44128 | Held note |
| Alternating C4/G4, 125 ms | 67 | 736 ms | 0.42250 | Held note |
| Course Clear, 125 ms | 63 | 1,856 ms | 0.37804 | Held note |
| Course Clear, 125 ms | 68 | 1,984 ms | 0.45648 | Held note |
| Rolled triads, 125 ms | 48 | 512 ms | 0.35446 | Held note |
| Legato articulation | 76 | 6,368 ms | 0.47694 | Release tail |
| Legato articulation | 68 | 14,368 ms | 0.38075 | Release tail |

No synthetic event occurred in the explicit legato-nonshared transition windows or
on the incomplete carried-bass pitch, and the incomplete carried-bass attack never
advanced. However, the held, release-tail, duplicate, and unassigned-event gates are
independently fatal.

Matcher replay for the diagnostic candidate nevertheless passed the matcher-only
gates under both requested profiles:

| Matcher profile | Independent | Ordered | Prefix | Complete | Retrigger failures | Bass-onset failures | Carry-over | Safety false / skip / duplicate / incomplete bass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Production baseline | 391 | 346 | 262 | 33 | 35 | 40 | 60 | 0 / 0 / 0 / 0 |
| Production + diagnostic decoder | 393 | 346 | 262 | 33 | 34 | 40 | 60 | 0 / 0 / 0 / 0 |
| Threshold recommendation baseline | 410 | 445 | 348 | 43 | 35 | 31 | 53 | 0 / 0 / 0 / 0 |
| Threshold recommendation + diagnostic decoder | 412 | 457 | 362 | 45 | 34 | 31 | 52 | 0 / 0 / 0 / 0 |

Production independent recognition at 1000 ms changed from 167 to 168; the
threshold recommendation changed from 171 to 172. Independent latency remained
188 ms p50 / 208 ms p95 under both profiles. Production ordered latency remained
189 ms p50 / 214.67 ms p95; recommended-profile ordered latency remained
190.67 ms p50 / 209.33 ms p95. Natural event streams and timestamps were unchanged.

Conclusion: `no-safe-separation`. Usable hidden score rises do exist, and one removes
a targeted `retrigger-not-detected` failure under both matcher profiles, but every
grid configuration that recovers a missing attack also manufactures decoder events.
The best diagnostic candidate creates 22 false/duplicate events to recover 2 attacks.
Production retrigger detection therefore remains disabled; matcher/carry-over work is
the safer next direction.

Verification on the clean local Vite server:

- Full unit suite passed: 227/227 tests.
- Production build passed.
- Full and concise `listen-retrigger-sweep` browser exports completed with identical
  audit counts, candidate ID, recovery count, safety counts, and conclusion.
- Existing sequence, 1,000-profile threshold, corrected articulation, and corrected
  reset browser regressions completed. Threshold replay reproduced
  `o0p450-t0p500-a0p200-x0p990-b1`; articulation reproduced `no-detached-benefit`;
  reset reproduced `matcher-playhead-cascade`; all established safety controls stayed
  at zero.

### Threshold replay sweep — August 13, 2026

The browser retained one stateful continuous trace for each of 13 sequence
families at all six configured speeds, including wrong-note, extra-note, and
carried-bass safety cases. The sweep varied five matcher properties:
`onsetThreshold`, `targetNoteThreshold`, `activeTargetThreshold`,
`extraNoteThreshold`, and `requireFreshBassOnset`; all timing and inference
settings remained fixed. Production-profile replay reproduced the captured
per-event and aggregate results exactly before the inference-free sweep ran.
The bounded grid evaluated all 1,000 profiles in about 150 seconds; 680 were
rejected by the safety gates.

| Profile | Independent | Ordered | Prefix total | Complete passages | Ordered p95 | Safety (false / skip / duplicate / carried bass) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production `o0p600-t0p500-a0p350-x0p970-b1` | 291 | 283 | 199 | 33 | 214.67 ms | 0 / 0 / 0 / 0 |
| Recommended `o0p450-t0p500-a0p200-x0p990-b1` | 308 | 365 | 268 | 43 | 209.33 ms | 0 / 0 / 0 / 0 |

Explicit matcher settings:

| Setting | Production | Recommended |
| --- | ---: | ---: |
| `onsetThreshold` | 0.60 | 0.45 |
| `targetNoteThreshold` | 0.50 | 0.50 |
| `activeTargetThreshold` | 0.35 | 0.20 |
| `extraNoteThreshold` | 0.97 | 0.99 |
| `requireFreshBassOnset` | `true` | `true` |

Recommended-profile deltas from production by speed:

| Interval | Independent | Ordered | Prefix | Complete passages | Ordered p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | +2 | +4 | +4 | 0 | -8 ms |
| 500 ms | +3 | +7 | +7 | +1 | 0 ms |
| 333⅓ ms | +7 | +39 | +39 | +5 | -13.33 ms |
| 250 ms | +4 | +19 | +19 | +1 | 0 ms |
| 167 ms | 0 | +8 | 0 | +2 | -7 ms |
| 125 ms | +1 | +5 | 0 | +1 | 0 ms |

The eligible Pareto frontier contains 15 profiles. All retain
`targetNoteThreshold=0.50` and `requireFreshBassOnset=true`; profile IDs encode
onset, target, active-target, extra-note, and fresh-bass values respectively.

| Frontier profile | Independent | Ordered | Prefix total | Complete | Ordered p95 | Distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `o0p450-t0p500-a0p200-x0p990-b1` | 308 | 365 | 268 | 43 | 209.33 ms | 0.320 |
| `o0p450-t0p500-a0p275-x0p990-b1` | 307 | 362 | 265 | 42 | 209.33 ms | 0.245 |
| `o0p450-t0p500-a0p350-x0p990-b1` | 306 | 348 | 251 | 42 | 212 ms | 0.170 |
| `o0p500-t0p500-a0p275-x0p990-b1` | 305 | 354 | 257 | 40 | 212 ms | 0.195 |
| `o0p500-t0p500-a0p350-x0p990-b1` | 304 | 340 | 243 | 40 | 212 ms | 0.120 |
| `o0p550-t0p500-a0p275-x0p990-b1` | 302 | 345 | 252 | 36 | 212 ms | 0.145 |
| `o0p550-t0p500-a0p350-x0p990-b1` | 301 | 331 | 238 | 36 | 214 ms | 0.070 |
| `o0p450-t0p500-a0p200-x0p900-b1` | 300 | 333 | 250 | 38 | 209.33 ms | 0.370 |
| `o0p450-t0p500-a0p275-x0p900-b1` | 299 | 330 | 247 | 37 | 209.33 ms | 0.295 |
| `o0p600-t0p500-a0p350-x0p990-b1` | 299 | 308 | 215 | 35 | 214 ms | 0.020 |
| `o0p450-t0p500-a0p350-x0p900-b1` | 298 | 316 | 233 | 37 | 209.33 ms | 0.220 |
| `o0p500-t0p500-a0p275-x0p900-b1` | 297 | 322 | 239 | 35 | 209.33 ms | 0.245 |
| `o0p500-t0p500-a0p350-x0p900-b1` | 296 | 308 | 225 | 35 | 209.33 ms | 0.170 |
| `o0p550-t0p500-a0p275-x0p900-b1` | 294 | 316 | 236 | 33 | 209.33 ms | 0.195 |
| `o0p550-t0p500-a0p350-x0p900-b1` | 293 | 302 | 222 | 33 | 209.33 ms | 0.120 |

The recommendation is measurement-only. Production remains at onset 0.60,
target-note 0.50, active-target 0.35, extra-note 0.97, with fresh bass required.

### Stateful vs event-reset inference diagnostic — August 12, 2026

Implemented as a separate diagnostic benchmark in
`webapp/src/listenInferenceResetBenchmark.ts`. It renders the canonical normal-articulation
Course Clear passage exactly once (27 events, 1000 ms interval, 420 ms hold, 350 ms
release), then sends the same PCM object and 512-sample frame boundaries through:

- stateful continuous inference, with one initial session/decoder reset;
- event-reset continuous inference, with paired session/decoder resets before events 1–26;
- frame-phase-matched isolated one-event controls, reused only when both chord and
  position within the 512-sample frame match.

Reset points are aligned to the first frame beginning at or after scheduled attack minus
220 ms. The first normal-articulation reset begins at 1024 ms for the 1220 ms attack,
providing 196 ms of clean warm-up after the preceding 990 ms release-tail end. Every
trace records the reset plan, renderer diagnostics, PCM hash, and per-chunk hashes so
browser automation can verify that only the recurrent reset schedule differs.
Isolated controls use the reset point as local frame zero, so each attack has the same
4, 12, 20, or 28 ms offset within its attack frame as the corresponding continuous event.
Raw-model comparisons include scores, decoded states, and the model silence gate.

Verification results:

- `npm run build`: passed.
- `npm test`: 205 / 205 tests passed, including reset-plan, paired-input,
  reset-order, classification, and conclusion tests.
- Production listen mode and matcher behavior remain unchanged; this comparison is
  exposed only through the benchmark page button and the `listen-inference-reset` /
  `listen-inference-reset-summary` automation modes.

Measured browser run (August 13, 2026, `listen-inference-reset-summary`):

| Control | Independent match | Ordered advance | Safety (false / skip / duplicate) | Latency p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Isolated | 25 / 27 (92.6%) | 25 / 27 (92.6%) | 0 / 0 / 0 | — |
| Stateful continuous | 26 / 27 (96.3%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |
| Event-reset continuous | 25 / 27 (92.6%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |

The reset comparison recovered 0 events and lost 0 events; it recovered 2 raw
pitch qualifications and lost 0, while raw complete evidence stayed at 25 / 27
and fresh attacks stayed at 67 / 67. Independent matching changed by -1 event,
ordered advancement did not change, and no safety errors increased. The computed
conclusion is `matcher-playhead-cascade`: independent recognition was essentially
unchanged while ordered advancement remained behind it. Phase-matched isolated and
event-reset inference both produced 25 / 27 independent matches. The result’s run-local
PCM signature was `4747ade6` over 434,176 samples and 848 identical 512-sample chunks
between the two continuous passes.

The page exposes the complete captured conclusion as
`window.listenInferenceResetBenchmarkResult.conclusion` and retains the raw-model,
decoder-event, per-pitch, reset-plan, safety, latency, and isolated-control details
for subsequent runs.

### Course Clear articulation matrix — corrected August 13, 2026

Four independent continuous traces used the same 27 Course Clear targets and
1000 ms attack timestamps. The renderer, online-AMT session configuration, and
current matcher policy were fixed; only articulation scheduling changed. The onset
buffer experiment was not included.

| Articulation | Raw evidence | Fresh attacks | Independent match | Ordered advance | Complete | Stale sustain | Carry-over events | False / skip / duplicate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Detached, 250 ms hold | 23 / 27 (85.2%) | 65 / 69 (94.2%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Normal, 420 ms hold | 25 / 27 (92.6%) | 67 / 69 (97.1%) | 26 / 27 (96.3%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Legato, 900 ms hold | 26 / 27 (96.3%) | 68 / 69 (98.6%) | 24 / 27 (88.9%) | 3 / 27 (11.1%) | No | 8 | 24 | 0 / 0 / 0 |
| Sustained shared notes | 26 / 27 (96.3%) | 66 / 67 (98.5%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 2 | 2 | 0 / 0 / 0 |

The a-priori substantial-improvement threshold was three additional
independent matches (3 / 27, 11.1 percentage points) without added safety
errors. Detached produced one fewer independent match than normal, two fewer
raw-evidence events, two fewer fresh attacks, no stale sustains in either profile,
and no change in ordered advancement. All 26 detached inter-attack gaps were
exactly 400 ms with measured RMS 0. Detached release isolation therefore did
not help, so stale sustain/release state is not the main Course Clear limitation
at 1000 ms. The articulation matrix does not by itself identify the remaining
cause; the later reset diagnostic attributes the independent-versus-ordered gap
to matcher/playhead cascade. Legato produced one more raw-evidence event than
normal but strongly increased carry-over and reduced ordered progress, while
sustained shared notes also added one raw-evidence event but lost one independent
match.

This corrected rerun determines the expected transition from acoustic envelope
overlap and accepts either an `onset` or `reOnset` decoder transition as evidence
of a physical attack, while retaining the expected and observed types separately.
Older raw-evidence baselines below retain the strict transition-matching semantics
used when they were recorded.

Browser renderer checks passed before the matrix: normal and the existing
Course Clear render differed by at most one Float32 ULP (`1.19e-7`), detached
gaps were silent, legato release tails overlapped the next attack, and the
sustained-shared new-note gain differed from the equivalent normal-chord
contribution by at most `5.96e-8`.

### Canonical renderer baseline — August 12, 2026

- Renderer: `bundled-piano-web-audio-v1`, 16 kHz mono, 512-sample chunks,
  420 ms default hold, 350 ms release, and no passage normalization.
- 104 / 106 correct bundled-sample trials advanced (98.1%).
- 52 / 54 correct score-derived “Course Clear” trials advanced (96.3%).
- Zero distinguishable wrong-note false advances; four mathematically
  ambiguous harmonic cases advanced and are reported separately.
- P95 rendered-onset-to-playhead-advance latency: 196 ms.
- Both misses were repetitions of `[53, 65, 74]`, where the model emitted no
  evidence for MIDI 65. Matcher calibration cannot recover a pitch absent from
  the model output without weakening exact-chord behavior.

Isolated/continuous rendering parity in Chrome (August 12, 2026):

- Isolated and one-event continuous PCM are sample-for-sample identical.
- The online-AMT scores, states, signal-active state, decoded evidence/events,
  matcher result, and advancement latency match frame-for-frame.
- Adding a later loud event leaves every preceding sample unchanged.
- Rolled, repeated, sustained, and chunk-alignment checks pass. Comparisons
  between different-length OfflineAudioContext graphs allow at most `1e-6`;
  observed differences were zero or one Float32 ULP.

Trace-level 12-passage baseline (August 12, 2026):

| Interval | Complete passages | Raw evidence | Independent match | Succeeded / total | Ordered advance | Blocked | Ordered p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | 7 / 12 (58.3%) | 69 / 82 (84.1%) | 73 / 82 (89.0%) | 63 / 82 | 76.8% | 10 | 212 ms |
| 500 ms | 8 / 12 (66.7%) | 63 / 82 (76.8%) | 74 / 82 (90.2%) | 70 / 82 | 85.4% | 4 | 204 ms |
| 333⅓ ms | 6 / 12 (50.0%) | 57 / 82 (69.5%) | 72 / 82 (87.8%) | 40 / 82 | 48.8% | 32 | 220 ms |
| 250 ms | 8 / 12 (66.7%) | 48 / 82 (58.5%) | 73 / 82 (89.0%) | 50 / 82 | 61.0% | 23 | 208 ms |
| 167 ms | 6 / 12 (50.0%) | 37 / 82 (45.1%) | 11 / 82 (13.4%) | 42 / 82 | 51.2% | 5 | 214 ms |
| 125 ms | 8 / 12 (66.7%) | 6 / 82 (7.3%) | 16 / 82 (19.5%) | 48 / 82 | 58.5% | 4 | 228 ms |

The dominant failure is `next-attack-before-advance`; the sharpest completion
drop is from 2 to 3 events/second. Raw and independent metrics are identical for
the current and buffered policies because both replay the same captured traces.
The buffered policy is not accepted: it produced five fewer correct advances,
one fewer complete passage, and eight aggregate false advances. The deliberate
wrong-note and extra-note safety families themselves had zero false, skipped,
or duplicate advances under both policies at every speed.

### Pre-canonical renderer baseline — August 12, 2026

This is the previous committed baseline from `2da08d8`. It predates the shared
canonical renderer and records only Course Clear at the 1000 ms interval for
the continuous benchmark.

- 104 / 106 correct bundled-sample trials advanced (98.1%).
- 52 / 54 correct score-derived “Course Clear” trials advanced (96.3%).
- Zero distinguishable wrong-note false advances; four mathematically
  ambiguous harmonic cases advanced and were reported separately.
- P95 rendered-onset-to-playhead-advance latency: 260 ms.
- Both misses were repetitions of `[53, 65, 74]`, where the model emitted no
  evidence for MIDI 65. Matcher calibration could not recover a pitch absent
  from the model output without weakening exact-chord behavior.

| Interval | Raw complete evidence | Threshold-qualified | Independent match | Succeeded / total | Ordered advance | Recognized but blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 ms | 20 / 27 (74.1%) | 19 / 27 (70.4%) | 24 / 27 (88.9%) | 12 / 27 | 44.4% | 12 |

The first causal stall was zero-based event index 12: measure 2, moment 5,
target `[51, 63, 72]`. MIDI 51 and 72 produced fresh, high-confidence onsets,
but MIDI 63 produced only active-note evidence and no fresh onset. Independent
replay therefore classified the event as `carry-over`; ordered playback never
advanced before the following attack. Twelve later events matched independently
but remained blocked behind this target. The raw and independent metrics were
identical for the current and buffered policies, confirming that both policies
replayed the same model trace. No model threshold or production matcher behavior
was changed for this diagnostic baseline.

These are deterministic digital fixtures rendered from the app's bundled piano
samples. They demonstrate runtime equivalence and provide a regression gate;
they are not a substitute for acoustic-piano, microphone, room-noise, and
digital-piano input trials. Keep the current preliminary matcher profile unless
those trials show a systematic error.

## Running the benchmarks

Except for `listen-parity`, each listening command below runs the legacy renderer
first and the Tone renderer second, emitting adjacent `*-legacy` and `*-tone`
entries. Start the benchmark development server first, then run any desired mode
from another terminal.

```powershell
npm --prefix webapp run dev:wasm-benchmark

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-smoke

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-accuracy

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-parity

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-articulation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-inference-reset

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-inference-reset-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-threshold-sweep

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-matcher-multidomain-sweep

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-matcher-multidomain-sweep-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-profile-validation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-profile-validation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-profile-validation 333.33 articulation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-isolated-profile-validation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-isolated-profile-validation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-isolated-profile-validation-tone

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-profile-validation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-profile-validation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-sequence-profile-validation-tone

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-retrigger-sweep

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-retrigger-sweep-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-constant

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-mixed

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-profile-validation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-profile-validation-summary

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-profile-validation articulation

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-dynamics-case-tone salamander v05
```

`listen-profile-validation` is the unified production-candidate gate. It runs
the isolated, continuous-sequence, dynamics, and articulation matrices in one
pass over one inference session and then applies every automated acceptance gate
to the frozen candidates, producing one deterministic eligibility decision. It
performs no parameter search, ranks nothing, and never changes the production
default; the three per-domain commands above are unchanged and remain the place
a diagnosis reads per-fixture detail.

Each gate carries a stable code, a role, and the partitions it read:

| Role | Reads | Meaning |
| --- | --- | --- |
| `replay-integrity` | every measured domain | One capture per run served every profile column, and each `baseline-v1` row reproduced its capture-time replay. |
| `safety` | every partition | A false, skipped, duplicate, or incomplete-carried-bass advance rejects a candidate wherever it was measured, including on the rows the search itself read. The dedicated safety families are held to zero absolutely; every other row — ordinary passages, velocity layers, mixed runs, articulations — is compared with `baseline-v1` on the identical trace and may not get worse. |
| `release` | `confirmation` rows only | The held-out floors: Direct at least 104/106, Tone at least 101/106, both at least 52/54, p95 under 400 ms, held-back renderer/piano recognition preserved, no held-back leaf row losing more than one independent event. |
| `discovery-consistency` | `discovery` rows | Per-speed independent recognition, per-renderer ordered and complete-passage progress, family breadth, and continuous latency. These still reject a regression, but the label keeps a discovery number from being read as held-out confirmation. |

Family breadth is stated on net per-family deltas summed across both renderers,
so a family that gains under Direct and loses the same ground under Tone counts
as improving nowhere. The rule applies to whichever improvement the candidate
actually claims, ordered or independent, and the cascade test is settled in the
same place as the claim: at least one family whose ordered advances rose must
also have recognized more events independently. Independent recognition is
measured per event without regard to whether the playhead reached it, so it
cannot be manufactured by an earlier recovery unblocking later targets — and an
independent gain in some *other* family would prove nothing about the family
whose ordered count moved.

That comparison is made one trace at a time and one classification at a time,
because a corpus total hides the two regressions that matter most: a profile that
clears one row's false advance while introducing another's, and a profile that
adds an event to a row the baseline already advanced unsafely. Where both replays
kept their events, the target indices are compared as well, so an unsafe advance
that moved to another target is not read as the same failure staying put.

Every failed gate reports its code, the affected domain identifiers, the
baseline value, the candidate value, and an explanation. Late-advance counts,
source-to-target distance, and attribution delay are reported beside safety and
never as safety: the diagnosed `v05` case advances music the player did play, one
repetition behind, so rejecting an earlier correct recovery would reject an
improvement. Every leaf dynamics loss is listed whether or not it failed a gate,
and a loss larger than the one-event allowance can be excused only by an explicit
reviewed waiver. A waiver names the candidate it was reviewed for, the renderer
and row, the loss that was reviewed, and the reasoning; it applies to that one
candidate on that one row, and only while the measured loss stays within the
reviewed one. Every field is checked against the measured matrix, so a stale or
mistyped waiver fails the run loudly rather than quietly ceasing to excuse the
row it was written for. The frozen confirmation run declares none, because a
waiver is a decision taken after seeing a measured loss and so cannot precede
the run that produces it.

Eligibility additionally requires complete evidence: all three domains, both
renderers, all six corpus speeds, and all three dynamics suites. A focused smoke
— the optional trailing arguments name speeds and suites, as above — may
therefore reject a candidate but can never clear one, and reports
`incomplete-evidence` with the reasons instead of a verdict. The two committed
regressions are replayed against every candidate independently of which traces
were captured, so even a narrowed run cannot report a clean safety verdict while
regressing a diagnosed case.

The `-summary` variant folds each domain's per-trace identities into one digest
and keeps the profile values, domain identities, safety counts, and gate reasons.
The unabridged export keeps every decoded-structure hash, which is what a second
repetition in a fresh browser process is compared against.

`listen-isolated-profile-validation` replays `baseline-v1` and the frozen
multi-domain candidates over the complete isolated `confirmation` corpus. Like
the multi-domain sweep it captures both renderers in one process, because its
acceptance is stated per renderer against one manifest; append `-legacy` or
`-tone` to restrict it to one. Each fixture is rendered and recognized once and
every profile replays that same retained trace, so it neither reruns inference
per profile nor searches new values. The historical single-profile
`listen-accuracy` command is unchanged; its summary now records `baseline-v1` by
name rather than following whichever profile production defaults to.

`listen-matcher-multidomain-sweep` is the only listening command that is not a
renderer pair. It captures the frozen `discovery` and `regression-only`
partitions of `webapp/src/listenTraceManifest.ts` under both renderers in one
process and replays all 1,000 grid profiles against each captured trace, because
its worst-domain metric is taken across renderers. It never captures a
`confirmation` trace. The single-renderer `listen-threshold-sweep` command and
its measured Direct and Tone results remain unchanged as historical discovery
evidence.

`listen-dynamics-profile-validation` replays `baseline-v1` and the frozen
multi-domain candidates over the dynamics and articulation corpora: 20 constant
velocity layers, 2 mixed crescendo-decrescendo runs, and 4 articulations under
each renderer. Like the other validation commands it captures both renderers in
one process; append `-legacy` or `-tone` to restrict it to one. The optional
trailing argument names one or more suites — `dynamics-constant`,
`dynamics-mixed`, `articulation` — for a focused smoke. Narrowing the suites is
safe here because the two committed regressions are replayed against every
profile column independently of which rows were captured, so a suite-limited run
still cannot report a clean safety verdict while regressing a diagnosed case.

The August 20 attribution repair is frozen in
`benchmark-results/listen-dynamics-profile-validation-task11.json`: its 34
serialized late-advance instances represent 25 non-overlapping profile-level records;
the regression-case view repeats 9 already present in the profile view. Every record
includes target timing, causing attack and pitches, distance, and delay.
`benchmark-results/README.md` pins both the exact file SHA-256 and the cross-run
canonical evidence digest.

Unlike the isolated matrix, this corpus is **not** uniformly held out: manifest
version 1 assigned three constant layers per piano and renderer, one mixed run
per renderer, and five of the eight articulations to `discovery`. Every reported
group therefore carries the partitions it spans and an `evidenceRole` of
`discovery`, `confirmation`, or `mixed`, and only a `confirmation` group may be
quoted by a release gate. The historical single-profile `listen-dynamics-constant`
and `listen-dynamics-mixed` commands are unchanged; their results now record
`baseline-v1` by name rather than following whichever profile production
defaults to.

`listen-dynamics-case` renders one constant-layer run instead of the 40-run
matrix and prints the complete forensics of every advancement counted against a
safety gate, a ready-to-commit regression fixture for each one, and the replay of
every already committed regression against all three named profiles. Name the
piano and layer as the last two arguments.

See the [piano dynamics benchmark](PIANO_DYNAMICS_BENCHMARK.md) for the
velocity-layer methodology, asset smoke checks, and measured 40-run matrix.
