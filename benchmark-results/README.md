# Frozen listen-matcher benchmark results

Start the cross-origin-isolated benchmark server before running any reproduction
command:

```text
npm --prefix webapp run dev:wasm-benchmark
```

Verify all five frozen artifacts, their exact file hashes, the Task 08 candidate
archive digest and row count, the Task 24 complete per-domain control and policy,
the Task 10/11 canonical evidence digests, the Task 22 corpus census and pinned
omitted-bass identities, forensic schemas, and non-overlapping late-advance counts
with:

```text
node tools/online_amt/verify_listen_benchmark_evidence.mjs
```

Compare two fresh-browser repetitions of a complete Task 13 confirmation run with:

```text
node tools/online_amt/verify_listen_benchmark_evidence.mjs \
  --compare benchmark-results/<first-run>.json benchmark-results/<second-run>.json
```

This mode canonicalizes both files, reports the first meaningful mismatch, and
exits nonzero when they differ. It excludes only `maximumInferenceMs`, `peak`, and
`rms`; decoded-structure identities, discrete outcomes, summaries, gate codes,
failure identities, and recommendation inputs must match exactly.

Agreement is not the only question it asks. Each file must first be one complete
repetition of the frozen matrix, because two runs of the wrong matrix agree just
as perfectly as two runs of the right one — two archives of the same focused
smoke would otherwise have passed. Both files are therefore refused unless each
holds exactly one `listen-profile-validation` result whose gate report is
`evidenceComplete`, measured under registry version 2 at the frozen threshold
values of `baseline-v1` and the four frozen `v2` candidates, judged by all
eighteen frozen gates with their stated requirements, covering all three domains
under both renderers with 268 isolated, 156 sequence, and 52 dynamics traces
named for the suite and renderer they were captured from, from manifest version
1, protocol hash `0ed1e71d`, musical corpus hash `10ae2e0b`, with trace reuse and
baseline parity verified in every domain, each domain spanning exactly the
partitions its frozen corpus spans and no trace attributed to a renderer or
partition outside them. Coverage is read rather than counted: each captured trace
must carry one outcome row per profile column, in the frozen column order, under
the renderer and partition the trace was captured in, and both aggregate digests
are recomputed from the rows they claim to describe.

The decision is required too, not only the identities. Each file must carry the
three measured matrices, scored per renderer for all five profile columns, and a
complete verdict for each of the four candidates: all eighteen gates applied,
each with `passed === (applied && failures.length === 0)` — the report's own
algebra, which requires the verdict to follow from the failures rather than
requiring the gate to pass — and each reading exactly the rows a complete
matrix reads for it, labelled with the evidence role those rows carry, so a
report cannot claim it applied every gate while having gated safety on the
held-back rows alone. Every recorded failure must name the rows it is about, the baseline
and candidate values, and a reason; the four per-role failure counters are
recomputed from those failures, and failed gate codes, eligibility, the
eligibility set, and the recommendation must all follow from the outcomes. The
waiver list must be empty, and a run that calls itself complete may not also list
reasons it was incomplete. A file
truncated to its identity metadata compares equal to another truncated the same
way, and would be silent about exactly the evidence the release decision rests
on.

Discrete outcomes are compared through the archive's per-trace, per-profile
outcome identities: one row per captured trace and profile column, each carrying
a digest of every discrete outcome that column produced on that trace, down to
each expected pitch's attack type, evidence times, and qualification. A moved
advancement, a changed failure classification, an advance credited to another
attack, or a chord that qualified on different notes therefore fails the
comparison even when every aggregate count is unchanged, and the mismatch names
the trace and the profile it happened under. Model confidences stay out of the
digest: they are not bit-stable across browser processes, which is why the
decoded-structure hash excludes them too.

## Task 08 discovery/regression sweep

`listen-matcher-multidomain-sweep-task08.json` is the full Task 08 discovery/regression
sweep rerun from August 20, 2026. It contains all 1,000 candidate profiles in stable
profile-ID order. Every candidate record includes its frozen metric vector, complete
safety verdict, rejection codes, and aggregate counts.

- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- Candidate archive: `fnv1a-32-canonical-json:53ee8a67`
- Candidate rows: 1,000
- File SHA-256: `fa09a935ee36b14786659933152bed65498b7433007f888104f79357b7050aeb`

Reproduce the full archive while the benchmark dev server is running:

```text
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-matcher-multidomain-sweep \
  benchmark-results/listen-matcher-multidomain-sweep-task08.json
```

This command captures only `discovery` and `regression-only` traces. It does not read or
consume Task 13 confirmation evidence. With an archive path, stdout remains the compact
summary instead of repeating the 3.4 MB candidate list. Without a path, the non-summary
command emits the full result on stdout; use `listen-matcher-multidomain-sweep-summary`
when only the compact result is wanted.

## Task 24 complete per-domain control archive

`listen-matcher-domain-archive-task24.json` is the August 23, 2026 detail-only
re-export of the exact Task 08 discovery/regression search. It replays the same
manifest-v1 corpus through the same immutable 1,000-profile grid, but retains the
complete leaf-domain row for every profile instead of only the baseline and
frontier. Its constructor fails unless every Task 08 aggregate reproduces first:
721 safety rejections, the 30-profile frontier, all four selected identifiers,
and candidate digest `53ee8a67`. It captures no confirmation trace.

- Selection policy: version 1, `840b07ec`
- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- Globally safe profiles: 279 / 1,000
- Leaf domains: 29
- Task 24 archive digest: `fnv1a-32-canonical-json:1aab7393`
- File SHA-256: `adf66cb52f7f6c62c99d722f0d4b04ecb89a41ba66770d38542e995385798a43`

The predeclared one-percentage-point worst-domain regret boundary produces the
version-1 control verdict `one-global-profile-suffices`.
`o0p450-t0p500-a0p200-x0p990-b1` is an oracle in all 29 leaf domains and therefore
has zero worst-domain regret. It is the frozen comparator's representative of a
three-profile complete-vector tie with the otherwise identical `t0p425` and
`t0p350` profiles; each leaf's recorded oracle tie set contains between 12 and
279 safe profiles.

The archive records the metric's observed resolution beside the boundary. Seven
of 29 leaves contain one scoring trace, eight leaves are invariant over all 279
safe profiles, and in 19 of the 21 varying leaves the one-point boundary is below
the smallest observed non-zero rate step. In those leaves the practical test is
zero regret versus any observable regret, not one-point measurement precision.
This is discovery evidence on the version-1 corpus, not round-two eligibility and
not calibration evidence.
The frozen repeated-recovery policy reports an incomplete discovery census
separately from matcher performance: it blocks the ablation with
`selected-discovery-stratum-not-decoded` without labelling an unevaluated group as
a regression. Undecoded confirmation groups remain `not-run`.
Matched bass-axis support independently requires complete discovery evidence for
its twin comparison; whole-ablation status cannot substitute for that pair-level
census.
Task 26 must rerun the identical calculation after manifest version 2 adds
isolated correct recognition as a co-equal scoring domain.

Reproduce the archive while the benchmark server is running:

```text
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-matcher-domain-archive \
  benchmark-results/listen-matcher-domain-archive-task24.json
```

With an output path the runner writes the complete archive and keeps stdout to
the Task 08 aggregate summary.

## Task 10 sequence-validation evidence

`listen-sequence-profile-validation-task10.json` is the complete August 20, 2026 rerun
of the 156-trace, paired-renderer sequence matrix. It retains every profile row and all
18 late-advance forensic records; each record names the unambiguous manifest trace,
target and advance timing, causing physical attack and pitches, source-to-target
distance, and attribution delay.

- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- Captured traces: 156
- Late-advance forensic records: 18
- Evidence digest: `sha256-canonical-json-without-maximumInferenceMs:ed9a336516a26fa2daf6a67314138a47a47beafdc7c20ce86fbe90d5ff11acd0`
- Archived file SHA-256: `e969060b9011d86f1eb7cbb551077fbff69d03a8b01d4b548f499eaba51c927e`

Two fresh-browser runs produced the same evidence digest. The excluded
`maximumInferenceMs` field measures host wall-clock scheduling and differed between
runs; every musical result, trace identity, safety value, and forensic record matched.
The committed verifier defines and checks the canonical byte format, including its
trailing newline.

Reproduce the archive while the benchmark dev server is running:

```text
LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-sequence-profile-validation-task10.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-sequence-profile-validation
```

## Task 11 dynamics/articulation-validation evidence

`listen-dynamics-profile-validation-task11.json` is the complete August 20, 2026
rerun of the 52-trace, paired-renderer dynamics and articulation matrix. It includes
all constant-layer, mixed-dynamics, and articulation rows plus 25 non-overlapping
profile-level late-advance forensic records, including the committed Tone Salamander
`v05` regression. Its regression-case view repeats 9 of those records, for 34
serialized instances in total.

- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- Captured traces: 52
- Late-advance forensic records: 25 non-overlapping profile-level records; 34 serialized instances
- Evidence digest: `sha256-canonical-json-without-maximumInferenceMs-peak-rms:8b5039ac0fe0d5396cd02ee626800c075f3dffa101abd6579827d289570a0bc6`
- Archived file SHA-256: `1028cd52275c1c91838c8b920ef2d90324ff180b38a88096dba6408970890042`

Two fresh-browser runs produced the same evidence digest. The excluded fields are
host-timing (`maximumInferenceMs`) and floating-point audio-render diagnostics (`peak`
and `rms`); every musical result, trace identity, safety value, and forensic record
matched. This validation rerun preserves the manifest's existing discovery,
confirmation, and regression-only labels and performs no candidate selection. The
committed verifier defines and checks the canonical byte format, including its
trailing newline.

Reproduce the archive while the benchmark dev server is running:

```text
LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-dynamics-profile-validation-task11.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-dynamics-profile-validation
```

## Task 22 bass-onset and repeated-chord qualification evidence

`listen-bass-qualification-task22.json` is the round-two measurement of what a
bass-onset gate costs on both sides. Task 22 completed August 22, 2026; this
corrected artifact was remeasured August 23, 2026 at commit `a9b6173` plus that
change, with Chrome 151.0.7922.173 on Ubuntu 26.04, Node v24.13.0, and the
unchanged `online_amt_streaming.onnx` model. It captured 445 traces once each —
the complete 268-trace isolated corpus, 139 `discovery` continuous traces, 37
`regression-only` continuous traces, and the held-back `v13` layer — and replayed
`baseline-v1`, the four frozen `v2` candidates, and sixteen version-1
counterfactual grid profiles against every one of them.

- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- File SHA-256:
  `3b7085969a15242ff06b6a9fc58de72882626609c1e816a3dc7d7cb6c318279e`

The archive keeps every per-attack observation behind its distributions, because
a distribution is only auditable if the observations under it are present: 156
isolated triad observations, 822 continuous ones, the per-pitch qualification
record of every repetition of `[62, 74, 82]` in the three Tone plus Salamander
runs, and each counterfactual's safety rows stated per trace and per
classification. It selects nothing and changes no threshold, gate, or default;
`corpus.complete` records whether the run covered the whole corpus, so a focused
smoke can never be quoted as the measurement.

Reproduce it while the benchmark dev server is running:

```text
LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-bass-qualification-task22.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-bass-qualification
```

A fresh repetition reproduces every decoded-structure hash, distribution, and
qualification record; it will not reproduce the file hash, because process-local
PCM identities and host timings differ per browser process by design.

## Task 13 frozen automated confirmation evidence

`listen-profile-validation-task13-run1.json` and
`listen-profile-validation-task13-run2.json` are the two repetitions of the
complete frozen confirmation matrix, measured August 21, 2026 at commit `456dea2`
with a clean worktree, Chrome 151.0.7922.169 on Ubuntu 26.04, Node v24.13.0, and
model `online_amt_streaming.onnx`
(SHA-256 `a77be8262d3742ce4d9e7d29146d8b17f5755650a7d2aee952bf5bf5ed190ac4`). Each
run captured all 476 traces — 268 isolated, 156 sequence, 52 dynamics — under both
renderers and replayed `baseline-v1` plus the four frozen `v2` candidates against
every one of them, for 2,380 per-trace outcome rows.

- Protocol manifest: version 1, `0ed1e71d`
- Musical corpus: `10ae2e0b`
- Registry version: 2
- Identity / outcome digests: isolated `bff20df8` / `be407330`, sequence
  `e9f09643` / `2cfc6561`, dynamics `bfe48fdc` / `b57ea970`
- Run 1 file SHA-256: `3ac11d4abe8231d3c3c61abf4e597d2651dd952ad905ee9b9033eef31b5d38d3`
- Run 2 file SHA-256: `28a170b856df67b50842aefb243791c67b1dfa9dedbde3fdc036c607401daf79`
- Canonical comparison digest, shared by both:
  `sha256-canonical-json-without-maximumInferenceMs-peak-rms-processLocalPcmHash-processLocalTraceHash:8acc59b1b863ef89fb9fe6b1a0d365730c841df1b3c513c3541f9d20336c65e2`

The two files differ byte for byte and carry the same evidence: 311 of the 476
traces recorded different process-local PCM and raw-trace hashes in the second
browser process, while every decoded-structure identity, every discrete matcher
outcome, every summary, gate code, failure identity, and recommendation input
matched. Both runs decided `no-safe-candidate`, rejecting all four candidates on
held-back isolated `confirmation` rows: every candidate advances one omitted-bass
fixture per renderer (`isolated/direct/122`, `isolated/tone/124`), and none reaches
the 52/54 Tone Course Clear floor. The production default is unchanged.

Compare the two archives with:

```text
node tools/online_amt/verify_listen_benchmark_evidence.mjs --compare \
  benchmark-results/listen-profile-validation-task13-run1.json \
  benchmark-results/listen-profile-validation-task13-run2.json
```

Reproduce either archive while the benchmark dev server is running. The output
path must be passed through the environment: the positional arguments after the
corpus filter are read as corpus speeds and dynamics suites, so a path placed
there narrows the matrix into a focused smoke.

```text
LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-profile-validation-task13-run1.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-profile-validation
```

A fresh repetition reproduces the identity and outcome digests above and compares
equal to both archives; it will not reproduce their file hashes, because the
excluded host-timing, audio-diagnostic, and process-local fields differ per
process by design.

## Task 23 round-two policy re-score

Task 23 does not create or amend a measurement archive. The function
`rescoreTask13ArchiveUnderRoundTwoPolicy` in the committed evidence verifier reads
each immutable Task 13 file, first verifies it as a complete round-one repetition,
and then emits an adjacent policy-version-1 decision from the archived summaries.
Tests run that re-score over both files and require byte-identical decisions.
Because Task 13 predates the versioned policy, its frozen contract requires the
`policyVersion` field to be absent; a later policy-versioned archive is refused
rather than silently treated as Task 13 evidence.

The former corpus-specific floors are represented by frozen rates and ceiling:
98% Direct overall, 95% Tone overall, and 95% Course Clear under either renderer.
They still derive the version-1 targets 104/106, 101/106, and 52/54, but they now
report product debt rather than challenger eligibility. `baseline-v1` is evaluated
too: its Tone debt is 1 overall correct advance and 4 Course Clear advances.
Materiality is recomputed over the same complete axis set as the live evaluator:
isolated rates and latency, sequence rates and latency, dynamics equal-piano suite
rates, and cross-domain unsafe-event reduction. Frozen representation epsilons
make an exact count-derived one-percentage-point or 32 ms gain land on its stated
boundary regardless of binary subtraction direction.

The re-score removes these round-one rejection codes:

| Candidate | Removed as asymmetric correctness floors | Rejections that survive |
| --- | --- | --- |
| `early-open-v2` | `release-isolated-course-clear` | `safety-isolated-false-advance` |
| `steady-open-v2` | `release-isolated-course-clear` | `safety-isolated-false-advance` |
| `early-held-v2` | `release-isolated-recognition`, `release-isolated-course-clear` | `safety-isolated-false-advance` |
| `steady-held-v2` | `release-isolated-recognition`, `release-isolated-course-clear` | `safety-isolated-false-advance` |

All four candidates are materially better somewhere in the archived correctness
metrics, and all four remain ineligible because every one still advances both
distinguishable omitted-bass regressions. The re-score therefore changes neither
the Task 13 evidence nor the production decision; it records exactly which old
rejections Task 23 supersedes before manifest version 2 binds the rates to its new
census.
