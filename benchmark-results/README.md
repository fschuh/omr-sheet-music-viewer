# Frozen listen-matcher benchmark results

Start the cross-origin-isolated benchmark server before running any reproduction
command:

```text
npm --prefix webapp run dev:wasm-benchmark
```

Verify all seven frozen artifacts, their exact file hashes, the Task 08 candidate
archive digest and row count, the Task 24 complete per-domain control and policy,
the Task 10/11 canonical evidence digests, the Task 22 corpus census and pinned
omitted-bass identities, the Task 26 staged ablation record and its recomputed
terminal outcome, forensic schemas, and non-overlapping late-advance counts with:

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

## Task 25 round-two corpus evidence

`listen-round-two-corpus-task25-run1.json` and
`listen-round-two-corpus-task25-run2.json` are independent fresh-browser captures
of exactly the Task 25 evidence that may be decoded before candidate selection:
the 12 members of the four newly authored discovery groups and the two isolated
source traces behind Task 22's committed omitted-bass regressions. The guarded
capture path rejects confirmation and diagnostic descriptors.

- Protocol manifest: version 2, `d1971fa3`
- Musical corpus: `1213016e`
- Prior-evidence ledger: `1f9613bd`
- Captured rows per run: 14
- Confirmation rows decoded per run: 0 / 12
- Run 1 file SHA-256:
  `15b029439b34e006d89db57a0796603ea9169dbe1e4a7cbc3d5728eb6fd96176`
- Run 2 file SHA-256:
  `4e462cc799e570bd34b4d1d83349aa6585b4aca6c82390de5307c9113686bf1c`

The two runs have identical trace order, musical identities,
recognition-structure hashes, frame counts, discrete matcher results, manifest
metadata, and confirmation metadata. PCM hashes are retained only as
process-local render diagnostics and are excluded from the repetition equality;
12 of 14 differ between these browser processes. Confirmation contains four
complete unseen paired groups, including negative cases and two
repeated-identical-chord groups, but only their schema, identities, grouping, and
asset requirements were inspected. Their first decode remains Task 28.

The matched non-PCM results include two baseline-v1 false advances, both on
discovery distinguishable-wrong rows:

- `round-two/r2-repeated-low-triad-direct-splendid-pp/distinguishable-wrong`
- `round-two/r2-paired-high-tetrad-tone-splendid-ff/distinguishable-wrong`

They are frozen as genuine baseline discovery defects, not omitted from the
report and not put under an absolute-zero gate the incumbent fails. All eight
zero-weight discovery negatives join the trace-for-trace baseline-relative safety
comparison; parity passes and any newly unsafe event fails. Task 26's absolute
capture populations are 36 dedicated safety rows plus 41 other regression-only
rows. Undecoded confirmation rows belong to neither population.

Reproduce either archive while the benchmark dev server is running:

```text
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5173/online-amt-benchmark.html \
  listen-round-two-corpus \
  benchmark-results/listen-round-two-corpus-task25-run1.json
```

The pretest bundle `listenRoundTwoCorpusBenchmark.test.ts` reads both committed
archives, removes only `pcmHash`, and requires every remaining row and the zero-
decode confirmation record to match exactly.

## Task 26 staged round-two ablation evidence

`listen-round-two-ablation-task26-run1.json` and
`listen-round-two-ablation-task26-run2.json` are two independent fresh-browser
repetitions of the Task 26 search: the three staged grids, Task 24's frozen
calculation applied to the version-2 discovery results, the per-run
repeated-chord evidence of every selected profile, the matched bass-axis pair
comparisons, and one terminal outcome. They select search candidates; they
confirm nothing, and they changed no production default or threshold shape.

- Protocol manifest: version 2, `d1971fa3`; musical corpus `1213016e`
- Selection policy: version 1, `840b07ec`, applied unamended
- Ablations that ran: 3 of 3, each authorised by its predecessor's recorded stop
  verdict — grids of 1,000, 1,400, and 4,200 profiles
- Captured traces per ablation: 472; confirmation traces read: 0
- Terminal outcome: `bass-axis-unsupported`, in its grid-failed form
- Artifact digest, identical in both runs: `fnv1a-32-canonical-json:8dfe2f1b`
- Run 1 file SHA-256:
  `271b673a9696c449b7c3e91b4298b22a3d83b927a890643f2d62eb2ae20f0fc7`
- Run 2 file SHA-256:
  `0766dd023a72a8859aa0eb415650f0f36ecf2952daad4181a8647b4b6b480707`

The two runs agree on every decision-bearing value: the terminal outcome, all
three stop verdicts, every search-selected set, the domain-spread verdicts, the
safe and rejected counts, every grid row's safety verdict and rejection codes,
the matched-pair support decision, and every repeated-chord run's source
distance, delay, and resolution label. They differ only in raw decoder
confidences — `onsetConfidence`, `targetEvidence`, and the two limiting-evidence
values derived from them — by at most 2.6e-5, which is the documented ONNX
Runtime and `OfflineAudioContext` last-bit behaviour. Those fields are reported
in full and named in the artifact's own `digest.processLocalFieldsExcluded`, so
the digest identifies the decision rather than the noise; the file hashes above
still pin the exact bytes.

Every stop verdict is `selected-set-has-no-material-repeated-recovery`. Task 24's
frozen rule requires a material recovery in every declared discovery stratum, and
the two newly authored round-two repeated-chord groups cannot supply one: their
renders re-onset every chord member, so `baseline-v1` already advances one at
source distance 0 and the other at distance 1, leaving nothing for a candidate to
recover materially. That is not a filter Task 26 applied — the groups stay in the
census, exactly as the hashed policy requires — and it is what carried the round
through all three ablations to the zero branch.

The version-2 corpus rejects 841 of the 1,000 round-one grid profiles, leaving
159 against round one's 279. All four frozen `v2` candidates are now rejected for
`regression-run-unsafe`: the isolated omitted-bass evidence that rejected them in
Task 13 is inside the search corpus. All sixteen version-1 counterfactuals
reproduce their archived round-one safety verdicts, and the 60 surviving
high-onset profiles still hold the active-target gate at 0.275 or above.

Task 24's calculation returns `domain-spread-material` in all three ablations,
against `one-global-profile-suffices` on its own version-1 control. Read it with
the recorded measurement resolution: of 40 leaf domains, 16 hold a single trace,
11 to 15 are invariant across the whole safe grid, and 19 to 23 have a smallest
positive step coarser than the decision boundary.

The refinement did what Task 24 predeclared it for. Ablation two's
`o0p450-t0p5375-a0p075-x0p970-b1` — using both new axes' points, the target-note
refinement at 0.5375 and the active-target point at 0.075 below the historical
floor that straddles Task 22's 0.0958 limiting minimum — is the first measured
profile to reach source distance 0 on `v05` and `v13`, at 228 ms against the
incumbent's 2,220 ms and unrecovered. `dynamics-mixed/tone/salamander` stays
unrecovered under every profile in every ablation.

The bass axis was measured against its own control and not supported. Its grid is
markedly safer — 2,294 of 4,200 profiles pass, and the best global profile is a
bass-axis row whose worst leaf regret is 0.0370 — and the one selected bass
profile, `o0p450-t0p500-a0p075-x0p990-b1-B0p550`, is safe where its
compatibility-default twin is rejected for `regression-run-unsafe`, which is a
categorical safety rescue. It is still unsupported for two frozen reasons
recorded with it: the bass grid failed the stop rule, and against that same twin
the axis regresses `dynamics-mixed/tone/salamander` from recovered at source
distance 0 and 228 ms to unrecovered. The two-sided cost the round was built to
measure is therefore measured: the bass gate buys omitted-bass safety and gives
back a repeated-chord recovery.

Both sides of that comparison are archived — the pair record carries the twin's
own per-run measurements beside the axis's — so the claim can be read from the
file rather than inferred from a derived verdict. The evidence verifier
independently recomputes, under Task 24's frozen boundaries, every
repeated-recovery verdict at group, stratum, and aggregate level, including the
outcome label, the discovery-full-resolution claim, and the confirmation
aggregates; each ablation's stop reasons from those verdicts; and the
matched-pair support, whose inputs it resolves from the ablation's own
`selectedProfileIds` and grid rows rather than from the pair's copies of them, so
a rescue or a regret gain the grid does not show is refused. A stored verdict
that does not follow from its own evidence fails verification rather than only
moving the digest.

Reproduce either archive while the benchmark dev server is running:

```text
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-round-two-ablation \
  benchmark-results/listen-round-two-ablation-task26-run1.json
```

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
