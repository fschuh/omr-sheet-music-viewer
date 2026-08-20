# Frozen listen-matcher benchmark results

Start the cross-origin-isolated benchmark server before running any reproduction
command:

```text
npm --prefix webapp run dev:wasm-benchmark
```

Verify all three frozen artifacts, their exact file hashes, the Task 08 candidate
archive digest and row count, the Task 10/11 canonical evidence digests, forensic
schemas, and non-overlapping late-advance counts with:

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
