# Frozen listen-matcher benchmark results

Start the cross-origin-isolated benchmark server before running any reproduction
command:

```text
npm --prefix webapp run dev:wasm-benchmark
```

Verify all nine frozen artifacts, their exact file hashes, the Task 08 candidate
archive digest and row count, the Task 24 complete per-domain control and policy,
the Task 10/11 canonical evidence digests, the Task 22 corpus census and pinned
omitted-bass identities, the Task 26 staged ablation record and its recomputed
terminal outcome, the Task 27 candidate manifest re-derived by rerunning that stop
rule over both Task 26 repetitions, the Task 28 eligibility manifest chained to
that record and to the same rerun, forensic schemas, and non-overlapping
late-advance counts with:

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

## Task 27 round-two candidate manifest

`listen-round-two-candidate-manifest-task27.json` is the first link of the
round-two artifact chain and the round's only Task 27 file. Task 26 ended at
`bass-axis-unsupported` in its grid-failed form, so Task 27 took the zero branch:
nothing was searched, no `v3` identifier was added, the registry stayed at version
2 byte-identical, `DEFAULT_LISTEN_MATCHER_PROFILE_ID` stayed at `baseline-v1`, and
no result archive was written. A placeholder search archive would later read as a
search that found nothing rather than one that never ran.

- Candidates: none; `notRunReason` is `no-ablation-accepted`
- Referenced Task 26 evidence: `bass-axis-unsupported` at digest
  `fnv1a-32-canonical-json:8dfe2f1b`
- Registry version 2 at generation digest `d1b3f6a3`, selection policy version 1
  `840b07ec`, trace manifest version 2 `d1971fa3`, musical corpus `1213016e`,
  generator version 1
- Manifest digest: `fnv1a-32-canonical-json:21655efa`
- File SHA-256:
  `4016355ba98cdd4962f7196dbb7f75f8c1fc49bb3be9ef3f1ea66f1f0b701a9e`

`registryDigest` is what makes "every registry entry stays byte-identical"
enforceable. It covers the registry version, the default identifier, the fixed
timing policy every profile shares, and each identifier in registry order with its
complete threshold set, so a moved `v1` or `v2` threshold, a reordered list, or an
added entry all move it — none of which a version number or a `v3` suffix check
would catch. Emission refuses unless it is still `d1b3f6a3`.

The reason code is part of the record rather than something a later task supplies.
The zero branch has two forms that are not the same finding: `no-ablation-accepted`
means the stop rule accepted no ablation, and `no-supported-parameterization` means
it accepted a grid whose only selected profiles need a parameterization the round
left unsupported. Both the reason and the terminal outcome sit inside this
manifest's own digest, over the Task 26 evidence digest they were derived from, so
relabelling one as the other downstream cannot leave every digest verifying.

Nothing here is read as a conclusion. The manifest is re-derived by rerunning
Task 24's frozen stop rule over both archived Task 26 repetitions: each ablation's
verdict is recomputed from both sides of its archived repeated-chord measurements,
each matched pair's support from the ablation's own grid rows, and the terminal
outcome from those recomputed verdicts. Both repetitions rerun to the same three
rejections, the same outcome, the same evidence digest, and therefore the same
manifest; a manifest only one repetition supports is not the round's result. The
verifier additionally refuses an eligibility field on this record — Task 28 emits
a separate artifact that references this digest — and refuses any other Task 27
file in this directory.

The emitter freezes the zero branch only. Had Task 26 accepted an ablation, the
manifest for that branch would have to be frozen against the search's own result
archive, with its selections registered as new `v3` identifiers at registry
version 3; none of that exists, so the emitter refuses that branch outright rather
than accepting a caller-supplied list of already-registered identifiers as this
round's selection.

Reproduce the manifest from the committed archives; a second emission must
reproduce it byte for byte rather than revise it:

```text
npm --prefix webapp run emit:round-two-candidate-manifest
```

## Task 28 round-two eligibility manifest

`listen-round-two-eligibility-manifest-task28.json` is the second link of the
round-two artifact chain and the round's only Task 28 file. Task 27 froze an empty
candidate manifest, so the round has nothing it can both register and confirm and
Task 28 took its not-run branch: the confirmation matrix did not run, the
version-2 confirmation fixtures were not decoded, and the corpus was not touched.

- Run status: `not-run-no-confirmable-candidate`; `reason` is
  `no-ablation-accepted`, carried through from Task 27
- Candidate entries: none, and no confirmation-evidence field
- Confirmation partition: 12 traces, 0 decoded, fixture identity `a5695acc`,
  generation `d1971fa3`, first-observed ledger `1f9613bd`
- Chained to candidate manifest `fnv1a-32-canonical-json:21655efa`, which chains to
  Task 26 evidence `bass-axis-unsupported` at `fnv1a-32-canonical-json:8dfe2f1b`
- Manifest digest: `fnv1a-32-canonical-json:20be9d6d`
- File SHA-256:
  `3c0ac0571d04ec8a453558fec9fd1ab6ae84c8377ffcfb55e499cf221219e7ce`

The version-2 confirmation fixtures are the round's only genuinely unseen
evidence and can be spent exactly once. Spending them on a round that produced no
registrable candidate would burn them for nothing, so they stay unobserved and
remain valid confirmation evidence for a later round. That claim is measured
rather than stated: `confirmationPartition` is recomputed from the trace manifest,
counting a confirmation row as decoded once it stops carrying
`not-decoded-until-task-28` or gains a pinned decoded-structure identity.

Identity is checked at two scales, because the count is neither of them.
`traceIdentityHash` covers every confirmation row — decoded or not, so the pin
holds in both branches — over what makes a row that evidence rather than a name:
its identifier, its rendered-content key, its musical input, and its authored
pair. A fixture decoded elsewhere and renamed into the partition moves it, and so
does one re-pointed at different rendered content while keeping its name.
`traceGenerationHash` covers the whole generation those rows live in, and the
corpus hash and the manifest's own validation rules are checked alongside it,
because a row can keep its identity while the corpus it is drawn from moves
underneath it. That generation hash holds the confirmation partition's decode
state at its authored value: `listenTraceManifestHash` folds `decodeStatus` and
`fixtureVersion` in, so pinning it raw would move the moment the fixtures were
decoded and describe a corpus no completed round could produce. Whether they were
decoded is a separate question, measured by `decodedTraceCount` and constrained
per branch. No confirmation archive was written either, because a placeholder
would later read as a matrix that rejected everything rather than one that never
ran — a prohibition that belongs to this branch alone, since a completed round is
required to produce exactly those two archives.

The schema is discriminated by `runStatus`, and the two branches carry disjoint
fields. Under `completed` the candidate entries and the confirmation evidence —
two named archived repetitions with their SHA-256 values and the canonical
comparison digest — are required, and `reason` is forbidden. Under
`not-run-no-confirmable-candidate` the entry list must be empty, the evidence
fields are forbidden outright rather than nulled, and `reason` is required.

The repetition is proven against the files, because a name is not evidence. The
verifier resolves both recorded names, reads and hashes them, requires the
recorded SHA-256 to be each file's own, requires them to be two different files by
filesystem identity — `realpath` plus device and inode, so `run1.json` and
`./run1.json`, or a symlink beside its target, are one run rather than two — and
requires both archives to recompute to the recorded canonical comparison digest
under the Task 04 omissions. Their bytes are not required to differ: two runs of a
deterministic matrix may legitimately hash alike, and demanding otherwise would
refuse the cleanest possible evidence.

Agreement between two files is not evidence either, since two archives of the same
narrowed smoke agree perfectly and a smoke can reject a candidate but never clear
one. Each archive is therefore held to the round-two confirmation matrix in its own
right, and none of what it says about its own coverage is taken as coverage.

Coverage is recomputed from the archived captures against the version-2 census
partition by partition and suite by suite — 212/120/8/39/4/12 discovery, 12
confirmation, 56/36/1/4 regression-only — because a total is not coverage: 504
rows of anything sum to 504. Per-suite counts are not identity either: the exact
captured corpus is frozen as a list of 504 trace identifiers with their renderers,
partitions, and suites, hashed to `baa79d30`, so 504 fabricated identifiers in the
right buckets fail and the missing traces are named rather than only a moved
digest reported. Every capture must record its trace, renderer, and its
decoded-structure and process-local hashes as real digests rather than
placeholders; no trace may be captured twice; no suite outside the census may
appear; and the totals the archive states must agree with what it archived.

Every column — the baseline and each candidate — must carry an outcome row for
every captured trace, and each row must record what that column decided: its own
outcome digest and the ordered, false, skipped, and duplicate advance counts. A
row of `{traceId, profileId}` says a column ran, not what it found. The archive's
stated outcome identity is recomputed from those rows under the Task 13
`traceId:profileId:outcomeDigest` recipe.

An identifier is a label, so the columns are bound to values by an identity
chained from Task 27. The archive records the whole registry generation it
replayed from — version, default, shared fixed policy, and every profile's
complete threshold set in registry order — and that generation must hash to the
`registryDigest` the candidate manifest froze under Task 27's own recipe. Each
column's replayed thresholds must then be that generation's entry for its
identifier, in shape as well as value, and the incumbent's entry must be the
frozen `baseline-v1` values. A run measured under altered thresholds keeps every
expected name and every expected digest field, and now fails on the values.

Every archived repeated-chord observation must be a measurement: evaluated,
structurally valid, carrying all five qualification flags and non-negative safety
counters, with source distance and attribution delay present or absent together.
The comparison reads an absent flag as false and an absent count as zero, so a row
of `{}` would otherwise read as clean and unregressed and clear a candidate.

The repeated-chord census is frozen whole, both halves: the three known
round-one groups, Task 25's two newly authored discovery groups, and the two
authored confirmation groups, each with its role and stratum, and every
measurement filed under the stratum the census fixes. Pinning only the
confirmation half would let a run declare whichever discovery groups suited it and
still reach a resolution verdict over a census the policy never froze.

The gate set is frozen by identity, not by count: the archive must define the same
18 gates Task 13 froze, and every candidate must report an outcome for all of them
under each gate's own role and domain, with every gate applied — one invented gate
marked applied would otherwise clear a candidate while omitting every real Task 23
gate. Task 13's own scope and failure checks apply unchanged: each gate names the
rows it read, a complete matrix reads exactly the rows that gate is scoped to,
each failure names what it measured with a baseline and candidate value and an
explanation, `passed` must agree with the failures recorded beside it, the
per-role failure counters are recomputed from the outcomes, the evidence must be
marked complete with no incompleteness reason named beside that claim, and no
layer-loss waiver may be declared — a waiver is a decision taken after seeing a
measured loss, which cannot precede the run.

A gate verdict is a claim about the archived rows, and both halves of a report can
agree with each other and still be false, so every one of the eighteen verdicts is
rederived from the archive's own measurements and compared to what it reported —
in both directions, so the check cannot be satisfied by pessimism either. This is
possible without freezing a second copy of any threshold because the validation
policy decides eligibility by paired non-regression: the absolute recognition
rates are recorded as product debt rather than as eligibility.

Each re-derivation restates that gate's own rule rather than a convenient
approximation of it. Ordered progress fails on a lost complete passage as well as
a lost ordered advance. Family breadth is netted per family across renderers,
asked only of a candidate that claims a gain, and requires both more than one
improved family and a family whose ordered gain is corroborated by an independent
gain *in that same family*. The dedicated sequence families hold four counts at
zero at every domain, incomplete carried-bass advances included. Layer loss allows
one independent event and fails beyond it. The isolated latency gate rejects an
absent percentile and applies the 400 ms limit and the 32 ms tolerance; the
sequence latency gate applies only the tolerance, and only where both percentiles
exist. The committed-regression gate holds each diagnosed case to not worsening
rather than to absolute zero — the known Tone 333 ms false advance may stay
exactly as diagnosed — while a pinned late advance may move earlier but may never
become unsafe. Its census is frozen too: exactly
`tone-salamander-v05-repeated-chord-late-advance` as `late-advance` and
`tone-course-clear-333-shared-pitch-false-advance` as `reported-unsafe-advance`,
once each, so one invented safe row cannot stand in for both diagnosed cases.

Coverage is derived from the frozen corpus, not from the archive. Each gate's
domains are the distinct combinations of the manifest fields that gate groups on —
renderer, speed, family, piano, layer, articulation — over the rows its
partitions, suites, and evidence role select, and the archive's grouping is
compared as a partition of trace identifiers rather than by label. The dynamics
layer gates take one leaf per constant layer, per mixed run, and per articulation,
so one leaf's loss cannot be offset inside a combined domain; the piano groupings
exclude articulation, which has no piano leaf of its own. The frozen 504-row
corpus carries those grouping fields, and the identity digest covers all of them,
so a copy whose speeds, layers, articulations, or evidence roles had drifted
cannot keep the pin while silently re-grouping every domain. A losing speed, layer, or family therefore
cannot be dropped, dropped for one column, re-cut into two clean-looking rows, or
duplicated away. Every counter a summary states is then reconciled against the
outcome rows it names, so a per-trace regression cannot be smoothed away by a
clean summary and an invented summary cannot outvote clean per-trace records.
Percentiles must be null or a finite, non-negative number.

**One round-two policy gap is enforced rather than papered over.** Task 13 froze
the gate partitions against manifest version 1, where `confirmation` still held
the isolated and dynamics corpora. Version 2 re-partitioned those into discovery
and regression-only and left `confirmation` holding only the twelve authored
paired rows, so `safety-isolated-false-advance` and all five `release-*` gates
read no version-2 row at all. The verifier reports each of them by name, and the eligibility derivation
itself fails closed while any remain: a gate that read no row produces no failure,
and that is the one case where an absent failure is not evidence of safety, so the
derivation must not contradict the rule rather than quietly agree with a report. Choosing new partitions here would be
freezing round-two policy inside a verifier, which is the one thing this chain
exists to prevent: a round-two gate scope has to be frozen as policy before any
confirmation matrix can be judged complete.

Introduced unsafe advances are additionally recomputed per trace and per counter
from the outcome rows, beside the per-domain comparison, because a domain or
corpus total can absorb a regression on one trace behind an improvement on
another. Eligibility is derived from the rederived verdicts and never from the
reported ones — trusting `passed` would make the re-derivation decorative — so an
archive whose gate report clears a candidate its own measurements condemn derives
ineligible.

Each candidate's Task 24 labels and its eligibility are then **re-derived** from
the archived measurements and from every gate's own pass verdict — never from a
list of failures the archive supplies — and compared to what the manifest
recorded, so a label the evidence does not produce fails verification rather than
reaching Task 29 as a self-report. A candidate with no gate record is ineligible
rather than unjudged. The 12-trace census and both identity hashes are pinned
in either branch, so a completed run cannot satisfy
`decodedTraceCount === traceCount` with an empty partition. Every completed entry
carries Task 24's `repeatedRecoveryOutcome` and `confirmationReproductionStatus`,
and the labels are gates as well as descriptions: a candidate recorded as
`regressed` cannot also be automated-eligible, and `confirmed-full-resolution` is
refused unless a confirmation group reproduced the phenomenon.

One undifferentiated schema would instead force this branch to invent placeholder
archive hashes for a run that never happened, which is exactly the fabricated
evidence the chain exists to prevent. Every consumer —
Tasks 14, 15, and 29 — branches once on `runStatus` and never on whether the entry
list happens to be empty: a completed matrix that rejected every candidate still
has entries, and reading emptiness as "not run" would erase the difference between
a round that spent its single-use fixtures and one that did not. Only Task 29's
recorded conclusion reads the reason, which is why the two zero-branch findings
are distinguished there rather than by a third status.

Nothing here is read as a conclusion. The verifier re-derives the whole chain:
Task 24's frozen stop rule is rerun over both archived Task 26 repetitions, the
candidate manifest's digest is recomputed from its own fields, and this record's
from its own, so an eligibility manifest that merely states the round's result
fails. The reason, the terminal outcome, the evidence digest, and the originating
ablation must agree across all three artifacts; a chain whose links each verify in
isolation while disagreeing with one another is refused. Completeness is pinned to
the round's own generation — registry version 2 at `d1b3f6a3`, trace manifest
version 2 at `d1971fa3`, musical corpus `1213016e`, policy version 1 `840b07ec`,
generator version 1 — so neither a round-one archive nor a narrowed smoke can be
quoted as this task's evidence.

Task 27's candidate manifest is untouched by this task, and a test holds its
committed bytes against the record Task 27's own emitter reproduces.

Reproduce the manifest from the committed chain; a second emission must reproduce
it byte for byte rather than revise it:

```text
npm --prefix webapp run emit:round-two-eligibility-manifest
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
