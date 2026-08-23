# online_amt listening benchmark

[Back to the benchmark index](BENCHMARK.md).

## Benchmark history

Entries are kept newest first so renderer and recognition changes remain
comparable over time.

### Complete per-domain selection control — August 23, 2026

Task 24 reran the exact Task 08 manifest-v1 discovery/regression sweep and changed
only the retained detail: every one of the 1,000 immutable grid rows now carries
all 29 leaf-domain results. This is the complete-grid input a per-domain oracle
requires; the old archive's aggregate-only non-frontier rows could not answer the
question, and restricting the calculation to the aggregate frontier would have
made that frontier determine which domain champions were allowed to exist.

```bash
node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-matcher-domain-archive \
  benchmark-results/listen-matcher-domain-archive-task24.json
```

Measured August 23, 2026 with manifest version 1, hash `0ed1e71d`, corpus hash
`10ae2e0b`, both bundled renderers, and the unchanged model. Before it writes the
detail archive, the exporter requires exact Task 08 reproduction: candidate
digest `53ee8a67`, 721 safety rejections, the 30-row Pareto frontier, and the four
selected identifiers. All reproduced. The archive reads the 139 `discovery` and
37 renderable `regression-only` traces and zero `confirmation` traces. Its policy
hash is `840b07ec`, internal archive digest is `1aab7393`, and file SHA-256 is
`adf66cb52f7f6c62c99d722f0d4b04ecb89a41ba66770d38542e995385798a43`.

#### Version-1 control result

The domain oracle population is the 279 profiles that are globally safe over the
complete regression corpus. Each leaf oracle maximizes independent recognition;
a global profile's regret is that oracle rate minus its rate, and the verdict uses
the worst leaf. The inclusive decision boundary was frozen at one percentage
point before this detail result was inspected.

`o0p450-t0p500-a0p200-x0p990-b1` is an oracle in all 29 version-1 leaf domains.
Its worst and mean regret are both zero, so the control verdict is
`one-global-profile-suffices`. The comparator chooses it as the representative of
a three-profile complete-vector tie with
`o0p450-t0p425-a0p200-x0p990-b1` and
`o0p450-t0p350-a0p200-x0p990-b1`; each leaf separately has 12 to 279 tied
oracles.

The one-point boundary is a decision threshold, not a claim of one-point
measurement resolution. Seven leaves contain one scoring trace, eight are
invariant over all safe profiles, and 19 of the 21 varying leaves have a smallest
observed non-zero rate step larger than the boundary (the observed steps span
`0.006172839506172645` to `0.16666666666666666`). The archive carries this census
so Task 26 reports the same limitation when it reapplies the rule. This does not
select a production profile: it is
observed discovery evidence on a corpus with no isolated scoring domain. Task 25
adds isolated correct recognition as a co-equal domain, and Task 26 must rerun
this exact calculation there to obtain the round's decision. Renderer, piano, and
dynamic bands are acoustic-path proxies; this result is not a measured
calibration benefit.

#### Frozen round-two selection and stop rule

Selection policy version 1 uses the same one-point boundary for material
complementarity and permits at most four new candidates. In the spread case it
starts with `baseline-v1`'s per-domain envelope and greedily chooses the safe
profile that minimizes worst then mean residual regret; every addition must lift
at least one leaf-domain independent rate by a full point. The whole-ablation
stop rule is satisfied only by a non-empty search-selected set with no
incomplete discovery stratum, no measured repeated-chord regression in any
selected profile, and material repeated recovery in at least one selected
profile. A bass axis is judged separately against its
coordinate-identical compatibility-default twin and cannot earn support merely by
appearing in a grid that passes. Its paired discovery evidence must itself be
complete; otherwise support fails with
`repeated-recovery-discovery-incomplete-against-twin`, even when the axis has a
categorical safety rescue or material regret gain.

Repeated recovery is paired per musical-input group. Source distance has zero
regression allowance; attribution delay has one 32 ms decoder-hop allowance. A
recovered-to-recovered partial gain is material only at one full attack of source
distance and 500 ms of attribution delay; unrecovered-to-recovered is categorical.
Every discovery stratum needs a material recovery, while every individual group
must avoid regression. The declared discovery census includes undecoded groups,
so an unmeasured group makes its stratum incomplete and forces the stop rule to
continue with `selected-discovery-stratum-not-decoded`. Completeness is reported
as `discoveryEvaluationStatus`; missing discovery evidence does not set
`noRegression` false or downgrade `repeatedRecoveryOutcome`. Undecoded
confirmation groups remain `not-run` and do not poison measured discovery
performance. Distance 1 is always partial. Distance 0 across `v05`,
`v13`, mixed, and every reproducing discovery group earns only
`discovery-full-resolution`. `confirmed-full-resolution` additionally needs at
least one unseen confirmation group to reproduce the predeclared decoder predicate
and every reproducing group to pass. A structurally valid non-reproducing unseen
group is retained as `inconclusive-no-reproduction`; it is not swapped.
A discovery full-resolution label may coexist with incomplete discovery when the
undecoded extra group's baseline does not reproduce the phenomenon, but the
incomplete status still prevents the ablation from stopping.

Task 22's exact three-run upper-voice minimum, `0.09577340414698106`, predeclares
active-target refinement points `0.075`, `0.100`, and `0.125` below the historical
0.20 floor, plus `0.300` and `0.325` between 0.275 and 0.350. The below-0.20
region is not assumed safe; it remains a Task 26 diagnostic whose results cannot
change these rules.

### Bass-onset and repeated-chord qualification — corrective rerun August 23, 2026

The corrective rerun of the second round's first measurement, originally
completed August 22, 2026. It answers two questions that a single confidence
axis has to answer at the same time: what a fresh-onset gate held at 0.60 on the
bass costs in refused genuine attacks, and why the repeated Course Clear chord
`[62, 74, 82]` is never recognized on the attack that sounds it. No threshold,
policy, gate, or default changed, and nothing here selects a profile.

```bash
LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-bass-qualification-task22.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html listen-bass-qualification
```

Remeasured August 23, 2026 on this development machine at commit `a9b6173` plus
this change, with Chrome 151.0.7922.173 on Linux, `bundled-piano-web-audio-v1` and
`bundled-piano-tone-v2`, the unchanged `online_amt_streaming.onnx` model, and
manifest version 1, hash `0ed1e71d`, corpus hash `10ae2e0b`. 445 traces were
captured once each and replayed through twenty-one profile columns: the complete
268-trace isolated corpus, all 139 `discovery` continuous traces, all 37
`regression-only` continuous traces, and the held-back `v13` layer. Trace reuse
and the corpus census are verified in the archive.

Evidence is attributed to attacks by the repository's existing single-owner rule:
a window runs from an attack's own scheduled time to the earlier of the
attribution deadline and one epsilon before the next attack, so no instant is
counted twice. This matters in practice — 248 of the measured windows are cut
short by their successor, and the 32 ms frame cadence coincides with an attack
schedule at 2,720 ms, 6,720 ms, and 10,720 ms. On this corpus the rule moves one
value: the sustained bass evidence of `sequence/direct/course-clear-27/125ms`
attack 19 falls from 0.0048 to 0.0016 once the frame at 2,720 ms is credited only
to attack 20. No band, gate count, qualification path, recovery distance, or
decoded-structure hash changes with it.

#### What a 0.60 bass gate costs on isolated fixtures

Eighteen Course Clear triads appear in the isolated corpus both played complete
and played without their lowest note. Those matched pairs hold the genuine and
the hallucinated evidence for the identical chord, and they separate cleanly:

| Renderer | Genuine attacks | Weakest genuine bass onset | Genuine in `[0.50, 0.60)` | Refused by 0.60 |
| --- | ---: | ---: | ---: | ---: |
| Direct | 42 raw / 18 pairs | 0.7161 | 0 | 0 raw, 0 pairs |
| Tone | 42 raw / 18 pairs | 0.9926 | 0 | 0 raw, 0 pairs |

| Renderer | Hallucinated attacks | No bass onset at all | In `[0.50, 0.60)` | Refused by 0.60 | Refused by 0.50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct | 18 raw / 16 pairs | 17 | 1 | 18 raw, 16 pairs | 17 raw, 15 pairs |
| Tone | 18 raw / 16 pairs | 17 | 1 | 18 raw, 16 pairs | 17 raw, 15 pairs |

On this corpus a bass gate at 0.60 costs nothing in either renderer and refuses
every hallucinated onset, including the two that a 0.50 gate admits. Both
distributions are reported twice, by raw trace count and by unique musical-input
pair; a pair is banded by the instance a gate has to survive — the weakest
genuine attack and the strongest hallucinated onset — so one strong rendering
cannot hide the rendering that fails. Extending the population from the matched
pairs to all 24 isolated triad chords moves nothing: the weakest genuine bass
onset is 0.6811 under Direct and 0.9860 under Tone.

#### The same measurement outside the isolated suite

The continuous corpus is where the two sides overlap, and it overlaps in both
directions. 774 genuine triad attacks were measured across 93 traces:

| Renderer | Genuine attacks | No bass onset | In `[0.50, 0.60)` | Weakest onset | Refused by 0.60 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct | 378 raw / 21 pairs | 26 | 9 raw, 7 pairs | 0.5093 | 35 raw, 18 pairs |
| Tone | 396 raw / 20 pairs | 35 | 6 raw, 4 pairs | 0.5182 | 41 raw, 19 pairs |

Every suite contributes: 7 corridor attacks in the sequence corpus, 6 in the
constant-layer dynamics matrix, 1 in the articulation matrix, and 1 in the mixed
run, with weakest onsets of 0.5093, 0.5344, 0.5396, and 0.5217 respectively. All
61 attacks that produced no bass onset at all are in the sequence corpus, at its
faster speeds. The `v05` attack 24 onset of 0.5968 that Task 05 recorded is
therefore not an isolated prior: it is one of fifteen genuine bass attacks inside
the corridor, spread over both renderers and all four continuous suites.

The other direction is worse for a scalar gate. The four continuous attacks that
do not sound the bass and still decode one are the dedicated `carried-bass-safety`
and `shared-sustained-bass` families, where the bass is *still sounding* from the
previous attack while the upper voices are re-struck:

| Trace | Attack | Target | Played | Bass onset |
| --- | ---: | --- | --- | ---: |
| `sequence/direct/carried-bass-safety/125ms` | 1 | `[48, 60, 64]` | `[60, 64]` | 0.6415 |
| `sequence/tone/carried-bass-safety/125ms` | 1 | `[48, 60, 64]` | `[60, 64]` | 0.9999 |
| `sequence/direct/shared-sustained-bass/125ms` | 1 | `[48, 62, 65]` | `[62, 65]` | 0.9997 |
| `sequence/tone/shared-sustained-bass/125ms` | 1 | `[48, 62, 65]` | `[62, 65]` | 0.9995 |

Three of the four are above 0.999, so no confidence gate the version-1 grid can
express refuses them; the fixed fresh-bass and carry-over rules are what refuse
them today, and they already do — `baseline-v1` records zero dedicated safety
events. So on continuous evidence a bass-specific confidence axis buys nothing
against the dedicated safety families, while a gate at 0.60 refuses genuine
attacks that reach as low as 0.5093 under Direct and 0.5182 under Tone.

#### The two omitted-bass fixtures, pinned

Both round-one failures reproduce from rendered audio under the renderer that
produced them, and both are now committed regressions in
`webapp/src/listenOmittedBassFixtures.ts`:

| Fixture | Score moment | Target | Played | Phantom bass onset | Structure hash |
| --- | --- | --- | --- | ---: | --- |
| `isolated/direct/122` | Measure 2, moment 4 | `[48, 60, 68]` | `[60, 68]` | 0.5267 on C3 | `56d57ace` |
| `isolated/tone/124` | Measure 2, moment 6 | `[56, 68, 75]` | `[68, 75]` | 0.5094 on G#3 | `c80411e6` |

Each fixture pins **per profile**: `baseline-v1`'s refusal and each `v2`
candidate's advance, together with the pitch each candidate admitted without it
having been sounded and the qualification path that produced the outcome. The
incumbent's refusal is checked exactly as strictly as a candidate's advance,
because a change that quietly made `baseline-v1` advance one of these is the most
dangerous outcome the fixture exists to catch. A rerun of the command
re-verifies both against rendered audio and aborts on any difference.

The mechanism is confirmed as the ordinary fresh-onset path: in both cases the
bass qualifies through a decoded onset in `[0.50, 0.60)` under every candidate,
never through sustained evidence, which the fresh-bass rule refuses for a triad.

The cross-rendered counterparts are recorded as diagnostics and are not required
to reproduce anything. Neither decodes a bass onset at all: `isolated/tone/122`
(`1946c88f`) and `isolated/direct/124` (`10b385b9`) are refused by every profile
through `bass-requires-fresh-onset`, with sustained bass evidence of 0.3003 and
0.4253. The hallucination is a property of one renderer's signal path on one
chord, not of the musical input.

#### Why the repeated chord is late, per pitch and per repetition

Every physical attack of `[62, 74, 82]` was recorded under `baseline-v1` and each
frozen candidate, with the decoded onset confidence, sustained target evidence,
active membership, and matcher qualification path of all three pitches. The
qualification paths are emitted by the matcher itself through a read-only
observer, so no rejection is reported that the matcher did not make; every
observed replay is checked against an unobserved one before it is read.

`v05` under `baseline-v1`, the only one of the three runs whose playhead is armed
on this chord when it sounds:

| Attack | Role | 62 (bass) | 74 (D5) | 82 | Limiting path |
| ---: | --- | --- | --- | --- | --- |
| 23 | transition | onset 0.9954 — accepted | **no onset**, evidence 0.1935 | onset 0.9936 — accepted | active-target evidence rejected |
| 24 | exact repetition | onset 0.5968 — below 0.60 | no onset, evidence 0.4587 — accepted | onset 0.8661 — accepted | fresh onset rejected |
| 25 | exact repetition | onset 0.9999 — accepted | onset 0.8152 — accepted | onset 0.9980 — accepted | advanced |

The two sides of the case are therefore two different pitches on two different
repetitions. On the first attack the bass is not the problem at all: it produces
a 0.9954 onset and qualifies. What blocks the target is D5, which the decoder
never re-onsets and whose sustained evidence reaches only 0.1935 — below every
active-target gate in the version-1 grid. On the second repetition D5 has
recovered to 0.4587 and qualifies through sustained evidence, and it is the bass
that blocks, at 0.5968, inside the corridor and below the incumbent's 0.60.

The plan's shorthand that "74 and 82 carry" needs one correction. Both are
repeated from the preceding chord `[65, 74, 82]`, so neither is new to the score,
but with a 420 ms hold at a 1,000 ms interval neither is still sounding when the
attack arrives: the decoded active set is empty immediately before it. The record
reports both facts separately — `playedByPreviousAttack` and
`soundingBeforeAttack` — and a test pins them, so this cannot regress to the
claim that every pitch carried.

`v13` and the mixed run reproduce the identical decoded signature — bass and 82
onset above 0.99 on the first attack while D5 produces no onset and only 0.1627
and 0.0958 of evidence — but under `baseline-v1` neither run's playhead has
reached the repeated region at all. It is armed on target 8 in `v13` and target 4
in the mixed run, so all three repetitions are recorded as `target-not-armed`,
and the chord never advances under the incumbent in either run.

#### The three-run minimum, and what no active gate can do

| Run | Partition | Limiting upper-voice evidence on the first attack |
| --- | --- | ---: |
| `dynamics-constant/tone/salamander/v05` | `regression-only` | 0.1935 |
| `dynamics-constant/tone/salamander/v13` | `confirmation` | 0.1627 |
| `dynamics-mixed/tone/salamander` | `discovery` | 0.0958 |

The minimum across the three runs is **0.0958**, not `v05`'s 0.1935, and Task 24
freezes any below-0.20 diagnostic point against that value. The lowest
active-target gate the version-1 grid measures is 0.20, so no gate in it admits
the limiting upper voice on any of the three runs: a scalar active-target gate
cannot reach source distance 0 here, whatever the onset gate does.

#### What it costs today, and what each counterfactual changes

| Profile | `v05` | `v13` | mixed |
| --- | --- | --- | --- |
| `baseline-v1` | distance 2, 2,220 ms | never advances | never advances |
| all four `v2` candidates | distance 1, 1,228 ms | distance 1, 1,228 ms | distance 1, 1,228 ms |
| all sixteen counterfactuals | distance 2, 2,220 ms | never advances | never advances |

Each candidate additionally recovers the second repetition of the chord, again at
distance 1 and at 1,220 ms, in all three runs. `baseline-v1` never advances that
second repetition anywhere, and neither does any counterfactual: every one of the
sixteen recovers exactly what the incumbent recovers, `v05` target 23 at distance
2 and 2,220 ms, and nothing else.

A full attack of playhead lag on a repeated chord is the shipped behaviour, not a
candidate regression, and on two of the three runs the incumbent never recovers
the chord at all. No measured profile reaches source distance 0 anywhere. The
recovery the candidates produce comes from the lower fresh-onset gate: every one
of the sixteen counterfactuals holds onset at 0.60 and none of them improves any
run, which is what a 0.5968 bass onset predicts.

The sixteen counterfactuals were replayed over the whole captured corpus, and
their complete safety and regression evidence is in the archive. The four
high-onset, open-active profiles reproduce their round-one rejection per trace
and per classification:

| Profile | Introduced safety events | Committed regressions |
| --- | --- | --- |
| `o0p600-t0p500-a0p200-x0p900-b1` | `sequence/tone/course-clear-27/167ms` target 10, `dynamics-constant/tone/salamander/v14` target 8 | pass |
| `o0p600-t0p500-a0p200-x0p940-b1` | the same two | pass |
| `o0p600-t0p500-a0p200-x0p970-b1` | the same two | pass |
| `o0p600-t0p500-a0p200-x0p990-b1` | the same two plus `course-clear-27/333ms` targets 9 and 10 | **loses one** |

This corrects one sentence in the plan: all four open-active profiles carry the
`course-clear-27/167ms` and `salamander/v14` false advances, not the `x0p970`
variant alone, and the `x0p990` variant adds two more on `course-clear-27/333ms`
as well as the committed-regression loss. The measured rows match the Task 08
archive's per-trace deltas exactly, with target indices the archive did not hold.

The twelve held-active profiles introduce no safety event anywhere and keep every
committed regression, and they buy nothing. None of them advances an omitted-bass
fixture, none changes any repeated-chord distance, and on isolated recognition
they are at best identical to `baseline-v1` (the three `x0p970` columns) and
otherwise worse: the `x0p900` and `x0p940` columns lose two Direct fixtures each
and gain none in either renderer. An active gate of 0.275 therefore does **not**
preserve the recovery that 0.20 produced — the two fixtures the `open` candidates
recover in each renderer are recovered by no held-active profile.

#### Relationship to the other diagnosed cases

These are three separate cases and a fix for one is not evidence for either
other. In the Tone 333 ms case a later chord genuinely sounded the shared pitch
the stalled target was waiting for. In the omitted-bass fixtures the bass was
never played and the decoder invented it. In the repeated-chord case the pitches
are all genuinely re-struck and the decoder fails to re-onset one of them. They
share only the broad policy of completing a target without a fresh attack on
every target pitch.

Score-rise retrigger detection remains a standing non-goal and is not proposed
here: it is the prior attempt at this exact problem, and its best measured
candidate created 22 false or duplicate events to recover two attacks. The
attribution this round records is that the decoder emitted no D5/74 onset on the
first attack of the repeated chord in all three runs, and none on the second
repetition in `v05`. If neither confidence qualification through the existing
gates nor a measured bass-specific axis reaches source distance 0 safely, that
missing re-onset is a Task 29 decoder or model input rather than permission for
another threshold grid.

### Production profile decision — August 22, 2026

The one auditable global-default decision the frozen evidence was collected for.

**Result: `no-safe-candidate`. `DEFAULT_LISTEN_MATCHER_PROFILE_ID` stays
`baseline-v1`.** No threshold, candidate value, gate, fixture, or manifest
assignment changed; this entry and the re-verification below are the whole of the
decision.

#### How the selection rule was applied

The rule is gates first, ranking second: only eligible profiles are ranked, and
they are ranked on live safety, live correctness, automated independent
recognition, ordered and complete behavior, latency, and finally distance from
`baseline-v1`. The August 21 frozen confirmation left the eligibility set empty,
so the ranking steps never ran and there was nothing to break a tie between.

The live corpus was not collected. Its own rule makes it conditional on at least
one automated-eligible candidate, because a live session exists to test a profile
that could otherwise ship; with none eligible, playing the corpus would produce
per-instrument numbers for four profiles already rejected on held-back automated
evidence and could not make any of them shippable. The live outcome is therefore
recorded as `no-safe-candidate` rather than as live evidence, and the default is
unchanged.

Nothing here re-reads the confirmation numbers for a new threshold. Choosing
values in response to the measurements that rejected these four would be
post-result retuning of the search that produced them; a different default needs
a new discovery round whose search accounts for isolated omitted-bass evidence.

#### Blockers a future candidate has to clear

| Gate | What blocked it |
| --- | --- |
| `safety-isolated-false-advance` | All four candidates advance one omitted-bass fixture per renderer — `isolated/direct/122` and `isolated/tone/124` — that `baseline-v1` refuses. A dedicated safety fixture that advances fails at any rate. |
| `release-isolated-course-clear` | All four miss the fixed 52/54 Tone Course Clear floor: 50/54 for the `open` pair, 48/54 for the `held` pair. |
| `release-isolated-recognition` | `early-held-v2` and `steady-held-v2` reach only 100/106 under Tone against the fixed 101/106 floor. |

The shared 0.99 unexpected-note gate does not compensate for the more permissive
onset and active-target gates on a target whose bass is simply absent, which is
the single mechanism behind the safety failure in both renderers.

#### Known limitations of the retained default

Retaining `baseline-v1` keeps its measured weaknesses, and they are the reason
this decision is worth revisiting with a new generation rather than closed:

- The Task 06 Tone 333 ms false advance belongs to `baseline-v1`, on
  `sequence/tone/course-clear-27/333ms`: a stalled single-note target completed
  by a later chord's shared pitch. It is the only false advance the sequence and
  dynamics domains record under any profile, and every rejected candidate clears
  it.
- Under Tone the default reaches 100/106 isolated correct advancement and 48/54
  on Course Clear — 94.3%, below the 95% acceptance gate the release floors are
  derived from. Direct meets its floors at 104/106 and 52/54.
- `baseline-v1` is the least sensitive profile measured. It carries 8 sequence
  late advances under Direct where the `early` pair carries none, holds Tone
  held-back ordered dynamics advancement at 146/432 against as much as 280/432,
  and recovers the `v05` repeated chord two attacks late instead of one.

These are recognition losses, not safety losses: the default advances no
dedicated safety fixture in any domain.

#### Rollback and rollforward

The default is one exported constant, `DEFAULT_LISTEN_MATCHER_PROFILE_ID` in
`webapp/src/listenMatcherProfiles.ts`. Every profile ever released stays in the
registry as an immutable entry, so changing the default forward or back is that
one edit and needs no reconstruction of threshold values from this history.
Production, replay, and every benchmark read the profile through
`matcherOptionsForListenMatcherProfile`, so that constant is the only place the
shipped behavior is chosen.

#### Re-verification of the shipped default

Measured on the development Windows machine at commit `65da882` — the commit the
August 21 confirmation code landed at — with Chrome 152.0.7977.55 on Windows 11
(10.0.26200), Node v22.12.0, and the unchanged `online_amt_streaming.onnx`
(SHA-256 `a77be8262d3742ce4d9e7d29146d8b17f5755650a7d2aee952bf5bf5ed190ac4`,
re-hashed locally). The commit carrying this entry changes documentation and one
registry comment only; no measured code, value, gate, or fixture differs between
them.

| Check | Result |
| --- | --- |
| Unit suite | 472 tests, 472 pass, plus the two-test dynamics pretest |
| Production build | passes |
| Canonical paired isolated smoke | both renderers `matched-recorded-baseline`, advanced at 196 ms, structure hashes `83fbd243` and `5c164339` |
| Complete sequence validation | 156 traces, both renderers, six speeds; trace reuse and baseline parity verified; all ten profile rows reproduce the August 19 tables exactly |
| Dynamics and articulation matrix | 52 traces, both renderers; trace reuse and baseline parity verified; all corpus, confirmation, equal-piano, and `v05` gate rows reproduce the August 19 tables exactly |
| Committed regressions under the default | replayed from rendered audio and in the unit suite; `baseline-v1` satisfies both pinned cases |

`baseline-v1` reproduced its recorded sequence row under Direct — 291 independent
and 283 ordered of 456, 199 prefix, 33/60 complete, 8 late, 58 carry-over blocked,
192 / 214.67 ms — and under Tone — 292 / 310, 219 prefix, 38/60 complete, 0 late,
62 carry-over, 200 / 228 ms — with all four dedicated safety counters at zero at
every speed under both renderers. The dynamics matrix reproduced Direct 639 / 702
independent and 224 ordered, Tone 609 / 675 and 239, the untouched `confirmation`
rows at 391 / 432 and 77 under Direct and 392 / 432 and 146 under Tone, and the
Direct equal-piano constant-layer aggregate at 90.86% / 45.49% / 12.50%.

Both committed regressions reproduce from rendered audio in this environment.
`listen-dynamics-case-tone salamander v05` reports 25/27 independent, 23/27
ordered, 0/0/0 safety, decoded-structure hash `b043076d`, and `baseline-v1`
satisfying the pinned late advance of target 23 at 25,440 ms from the attack two
positions later. `listen-sequence-case-tone course-clear-27 333.33` reports 23/27
independent, 8/27 ordered, 1/0/0 safety, decoded-structure hash `ab28401f`, and
`baseline-v1` satisfying the pinned false advance at 4,768 ms. In both runs the
more sensitive profiles deviate from the pinned outcomes — recovering `v05` a
repetition earlier, and no longer classifying the 333 ms advance as false — and
each deviation is reported as one, never as a pass.

This machine is a different browser build and operating system from the Linux
host that recorded the frozen archives, which is where the Task 04 identity rule
earns its keep: every decoded-structure hash and every discrete musical outcome
reproduced, while the rendered audio diagnostics did not agree to their last bits
— Tone `v05` renders `peak` 0.3653072416782379 here against the archived
0.36530718207359314. The Task 10 and Task 11 whole-file evidence digests include
those diagnostics and so are not expected to match across platforms;
`node tools/online_amt/verify_listen_benchmark_evidence.mjs` still verifies all
three frozen archives against their recorded file hashes and digests.

Ordinary listen mode uses and reports the retained identifier: the application
builds its matcher from `resolveEffectiveListenMatcherProfile`, which without a
debug override resolves to `DEFAULT_LISTEN_MATCHER_PROFILE_ID`, and the
Diagnostics panel prints the effective profile, appending `(debug override)`
whenever the session picker has replaced it.

### Frozen automated confirmation — August 21, 2026

The complete `listen-profile-validation` matrix run twice in fresh browser
processes and compared with itself. This is the confirmatory automated evidence
the production decision rests on. It changes no candidate value, no fixture, no
gate, and no production default: `baseline-v1` remains the default, and this run
is the reason it does.

**Result: `no-safe-candidate`.** All four frozen `v2` candidates are rejected.
Both repetitions reached that decision independently and their archives are
canonically identical.

#### Frozen preflight record

Frozen before the first repetition. Both runs, the unit suite, and the production
build used this one clean commit and this one environment; nothing in source,
model, renderer, fixture, gate, or browser changed between them.

| Item | Value |
| --- | --- |
| Commit | `456dea2`, worktree clean at measurement |
| Operating system | Ubuntu 26.04 LTS, Linux 7.0.0-29-generic x86_64 |
| Node | v24.13.0 |
| Chrome | `/usr/bin/google-chrome`, 151.0.7922.169 |
| Model | `webapp/public/models/online_amt_streaming.onnx`, SHA-256 `a77be8262d3742ce4d9e7d29146d8b17f5755650a7d2aee952bf5bf5ed190ac4` |
| Renderers | `bundled-piano-web-audio-v1` (Direct), `bundled-piano-tone-v2` (Tone) |
| Manifest | version 1, protocol `0ed1e71d`, musical corpus `10ae2e0b` |
| Registry | version 2; `baseline-v1` plus `early-open-v2`, `steady-open-v2`, `early-held-v2`, `steady-held-v2` |
| Gates | the eighteen frozen gates, each applied to every candidate |
| Unit suite | 464 tests, 464 pass, 0 fail |
| Production build | passes |
| Expected historical baseline | isolated Direct 104/106 and 52/54, Tone 100/106 and 48/54 |

The model hash is recorded rather than the filename alone, because a replaced
model of the same name would reproduce every identifier in this table while
measuring something else.

#### Commands and archives

```bash
npm --prefix webapp run dev:wasm-benchmark

LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-profile-validation-task13-run1.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-profile-validation

LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-profile-validation-task13-run2.json \
  node tools/online_amt/run_browser_benchmarks.mjs \
  http://127.0.0.1:5174/online-amt-benchmark.html \
  listen-profile-validation

node tools/online_amt/verify_listen_benchmark_evidence.mjs --compare \
  benchmark-results/listen-profile-validation-task13-run1.json \
  benchmark-results/listen-profile-validation-task13-run2.json
```

The archive path is passed through the environment because the positional
arguments after the corpus filter are read as corpus speeds and dynamics suites;
a path placed there would have narrowed the matrix into a focused smoke. Each
repetition takes about ten minutes.

| Artifact | SHA-256 |
| --- | --- |
| `listen-profile-validation-task13-run1.json` | `3ac11d4abe8231d3c3c61abf4e597d2651dd952ad905ee9b9033eef31b5d38d3` |
| `listen-profile-validation-task13-run2.json` | `28a170b856df67b50842aefb243791c67b1dfa9dedbde3fdc036c607401daf79` |

The two files differ byte for byte and are nevertheless the same evidence. Their
shared canonical comparison digest is
`8acc59b1b863ef89fb9fe6b1a0d365730c841df1b3c513c3541f9d20336c65e2`, computed with
only `maximumInferenceMs`, `peak`, `rms`, `processLocalPcmHash`, and
`processLocalTraceHash` excluded.

#### Cross-process parity

| Domain | Captured | Partitions | Identity | Outcome digest | Outcome rows |
| --- | ---: | --- | --- | --- | ---: |
| Isolated | 268 | `confirmation` | `bff20df8` | `be407330` | 1,340 |
| Sequence | 156 | `discovery`, `regression-only` | `e9f09643` | `2cfc6561` | 780 |
| Dynamics | 52 | `confirmation`, `discovery`, `regression-only` | `bfe48fdc` | `b57ea970` | 260 |

Trace reuse and baseline parity are verified in every domain, and every captured
trace carries one outcome row per profile column — 2,380 rows over 476 traces.
The isolated corpus reproduces the identity and outcome digests the August 19
gate entry recorded for the same complete 268-trace corpus, `bff20df8` and
`be407330`, measured then under a narrowed smoke of the other two domains.

The Task 04 property holds and is visible in the archives: 311 of the 476
captured traces recorded a different `processLocalPcmHash` and
`processLocalTraceHash` in the second process, while every decoded-structure
identity and every discrete musical outcome matched. Chrome's offline rendering
and ONNX Runtime do not reproduce their last bits in a fresh process; what this
task depends on is that the decoded structure and the matcher's discrete outcomes
do, and they did.

#### Verdicts

Every candidate was judged by all eighteen gates. The rejections are isolated
`confirmation` evidence — the partition Task 07 held back — and they are the same
in both repetitions.

| Candidate | Verdict | Failed gates |
| --- | --- | --- |
| `early-open-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-course-clear` |
| `steady-open-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-course-clear` |
| `early-held-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-recognition`, `release-isolated-course-clear` |
| `steady-held-v2` | rejected | `safety-isolated-false-advance`, `release-isolated-recognition`, `release-isolated-course-clear` |

The safety failure is one omitted-bass fixture per renderer — `isolated/direct/122`
and `isolated/tone/124` — which every candidate advances and `baseline-v1` does
not. The dedicated wrong-note fixtures still never advance under any profile
(0/2 in both renderers), so the loss is confined to the omitted-bass family, at
1 of 18 fixtures per renderer. One fixture is enough: a dedicated safety fixture
that advances is a failure at any rate, and the gate reports it per row rather
than as a corpus rate. Ambiguous harmonic advances rise from 4 to 5 of 8 under
Direct and stay at 5 of 8 under Tone; they are reported separately, as the gate
requires, and never stand in for a dedicated fixture.

No candidate is automated-eligible, so the eligibility set is empty and the
recommendation is `no-safe-candidate`. `baseline-v1` remains the production
default, and the live-input work in Task 14 and Task 15 has no automated-eligible
profile to carry forward.

#### Isolated corpus — confirmation evidence

The release gates read these rows and only these rows. Direct's floor is 104/106
overall and 52/54 Course Clear; Tone's is 101/106 and 52/54.

| Renderer | Profile | Correct | Course Clear | Wrong | Omitted bass | Ambiguous | p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct | `baseline-v1` | 104 / 106 | 52 / 54 | 0 / 2 | 0 / 18 | 4 / 8 | 196 ms |
| Direct | `early-open-v2` | 106 / 106 | 54 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 196 ms |
| Direct | `steady-open-v2` | 106 / 106 | 54 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 196 ms |
| Direct | `early-held-v2` | 104 / 106 | 52 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 196 ms |
| Direct | `steady-held-v2` | 104 / 106 | 52 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 196 ms |
| Tone | `baseline-v1` | 100 / 106 | 48 / 54 | 0 / 2 | 0 / 18 | 5 / 8 | 228 ms |
| Tone | `early-open-v2` | 102 / 106 | 50 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 228 ms |
| Tone | `steady-open-v2` | 102 / 106 | 50 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 228 ms |
| Tone | `early-held-v2` | 100 / 106 | 48 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 228 ms |
| Tone | `steady-held-v2` | 100 / 106 | 48 / 54 | 0 / 2 | 1 / 18 | 5 / 8 | 228 ms |

`baseline-v1` reproduces the recorded Task 09 matrix exactly, which is the
baseline parity this task's verification required. The open pair improves Direct
to a clean sweep and gains two Tone fixtures, but Tone's 50/54 Course Clear is
still below its 52/54 floor; the held pair gains nothing on either renderer and
misses the Tone recognition floor at 100/106 as well. Latency is unchanged by
profile in both renderers and well inside the 400 ms limit — no candidate was
rejected for latency.

#### Continuous sequences — discovery-consistency evidence

The whole sequence corpus is `discovery` and `regression-only`. Nothing below can
be quoted as generalization; it is here because a candidate that regressed these
rows would be rejected, and none did.

| Renderer | Profile | Independent | Ordered | Complete | Late | False / skipped / duplicate | p95 ordered |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct | `baseline-v1` | 291 / 456 | 283 | 33 / 60 | 8 | 0 / 0 / 0 | 214.7 ms |
| Direct | `early-open-v2` | 308 / 456 | 365 | 43 / 60 | 0 | 0 / 0 / 0 | 209.3 ms |
| Direct | `steady-open-v2` | 306 / 456 | 357 | 41 / 60 | 5 | 0 / 0 / 0 | 212.0 ms |
| Direct | `early-held-v2` | 307 / 456 | 362 | 42 / 60 | 0 | 0 / 0 / 0 | 209.3 ms |
| Direct | `steady-held-v2` | 305 / 456 | 354 | 40 / 60 | 5 | 0 / 0 / 0 | 212.0 ms |
| Tone | `baseline-v1` | 292 / 456 | 310 | 38 / 60 | 0 | 1 / 0 / 0 | 228.0 ms |
| Tone | `early-open-v2` | 297 / 456 | 315 | 39 / 60 | 0 | 0 / 0 / 0 | 228.0 ms |
| Tone | `steady-open-v2` | 297 / 456 | 315 | 39 / 60 | 0 | 0 / 0 / 0 | 228.0 ms |
| Tone | `early-held-v2` | 294 / 456 | 314 | 38 / 60 | 0 | 0 / 0 / 0 | 228.0 ms |
| Tone | `steady-held-v2` | 294 / 456 | 314 | 38 / 60 | 0 | 0 / 0 / 0 | 228.0 ms |

Independent recognition, per speed, as `independent / ordered`:

| Renderer | Profile | 1000 ms | 500 ms | 333 ms | 250 ms | 167 ms | 125 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct | `baseline-v1` | 67 / 57 | 68 / 64 | 66 / 34 | 67 / 44 | 9 / 39 | 14 / 45 |
| Direct | `early-open-v2` | 69 / 61 | 71 / 71 | 73 / 73 | 71 / 63 | 9 / 47 | 15 / 50 |
| Direct | `steady-open-v2` | 69 / 61 | 71 / 71 | 71 / 65 | 71 / 63 | 9 / 47 | 15 / 50 |
| Direct | `early-held-v2` | 69 / 61 | 71 / 71 | 72 / 70 | 71 / 63 | 9 / 47 | 15 / 50 |
| Direct | `steady-held-v2` | 69 / 61 | 71 / 71 | 70 / 62 | 71 / 63 | 9 / 47 | 15 / 50 |
| Tone | `baseline-v1` | 66 / 54 | 69 / 61 | 67 / 50 | 66 / 54 | 10 / 46 | 14 / 45 |
| Tone | `early-open-v2` | 67 / 54 | 71 / 62 | 68 / 55 | 67 / 54 | 10 / 45 | 14 / 45 |
| Tone | `steady-open-v2` | 67 / 54 | 71 / 62 | 68 / 55 | 67 / 54 | 10 / 45 | 14 / 45 |
| Tone | `early-held-v2` | 66 / 54 | 69 / 61 | 68 / 55 | 67 / 54 | 10 / 45 | 14 / 45 |
| Tone | `steady-held-v2` | 66 / 54 | 69 / 61 | 68 / 55 | 67 / 54 | 10 / 45 | 14 / 45 |

Independent recognition never falls at any speed under either renderer, which is
what `consistency-sequence-speed-recognition` requires. Ordered advances do slip
by one at Tone 167 ms, from 46 to 45, under all four candidates;
`consistency-sequence-ordered-progress` reads the per-renderer aggregate, where
Tone still rises from 310 to 315, so the gate passes and the slip is recorded
here rather than hidden by it.

By family, the Direct gains span more than one family. Under `early-open-v2`,
`course-clear` rises from 65 to 102 ordered advances, `alternating` from 29 to 36,
`repeated-note` from 29 to 36, `three-note-chord` from 0 to 22, and
`shared-sustained` from 0 to 6, with independent recognition rising alongside in
each, while `scales`, `rolled-chord`, and `two-note-chord` are unchanged; the
other three candidates move the same families by slightly smaller amounts. Under
Tone the movement is smaller: `course-clear` 62 to 66 ordered under all four
candidates, `known-weak` recognition 9 to 11 and `rolled-chord` 16/22 to 17/23
under the open pair, everything else level. Each candidate lost ordered advances
on exactly one passage, `sequence/tone/course-clear-27/167ms`, which the archive
lists as a regressed passage even though the per-renderer consistency gates still
pass on the aggregate.

#### Dynamics and articulation — mixed corpus, partly held back

Whole-corpus rows are `mixed` by construction and confirm nothing. The held-back
`confirmation` rows are the ones `release-dynamics-piano-recognition` and
`release-dynamics-layer-loss` read, and both gates passed for every candidate.

| Renderer | Profile | Confirmation independent | Ordered | Splendid | Salamander |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct | `baseline-v1` | 391 / 432 | 77 | 27 / 27 | 340 / 378 |
| Direct | `early-open-v2` | 407 / 432 | 116 | 27 / 27 | 354 / 378 |
| Direct | `steady-open-v2` | 407 / 432 | 116 | 27 / 27 | 354 / 378 |
| Direct | `early-held-v2` | 403 / 432 | 116 | 27 / 27 | 350 / 378 |
| Direct | `steady-held-v2` | 403 / 432 | 116 | 27 / 27 | 350 / 378 |
| Tone | `baseline-v1` | 392 / 432 | 146 | 50 / 54 | 297 / 324 |
| Tone | `early-open-v2` | 413 / 432 | 280 | 52 / 54 | 313 / 324 |
| Tone | `steady-open-v2` | 413 / 432 | 280 | 52 / 54 | 313 / 324 |
| Tone | `early-held-v2` | 409 / 432 | 247 | 50 / 54 | 311 / 324 |
| Tone | `steady-held-v2` | 409 / 432 | 247 | 50 / 54 | 311 / 324 |

No individual layer, mixed run, or articulation lost a single independent event
under any candidate: the archive's layer-loss list is empty for all four, and no
waiver was declared. The mixed-dynamics suite is level or better everywhere —
Direct 51/54 to 52/54 independent with ordered unchanged at 23, Tone 49/54 to
50-51/54 — 51 under the open pair, 50 under the held pair — with ordered 17 to 36.
Articulation moves in one place that matters: Direct
`legato`, a held-back `confirmation` row, goes from 24 recognized and 3 ordered
under `baseline-v1` to 26 and 20 under every candidate. The largest single
mixed-run movement, Tone `salamander` from 4 ordered to 23, is a `discovery` row
and is reported as such. Detached, normal, and sustained-shared rows are level or
better by at most two events: Tone `detached` gains two, from 23 to 25, under
every candidate, and the rest gain one or none.

#### Committed regressions, safety, and late advances

Both diagnosed cases behave as their diagnoses said they would, and
`safety-committed-regression` passed for every candidate.

- Tone plus Salamander `v05` stays a late recovery, never an unsafe advance:
  zero false, skipped, and duplicate advances under all five profiles, and 23
  ordered advances in every column. `baseline-v1` records one late advance,
  recovering target 23 at 25,440 ms from an attack two positions later; all four
  candidates record two, the first at 24,448 ms from the immediately following
  attack — an earlier recovery at a shorter source-to-target distance. That is a
  deviation from the pinned baseline advancement, reported as a deviation, and it
  is not gated as safety.
- The Task 06 Tone 333 ms false advance is the only false advance the sequence
  and dynamics domains recorded at all, and it belongs to `baseline-v1`, on
  `sequence/tone/course-clear-27/333ms`. Every candidate clears it: that trace is
  listed under `clearedUnsafeTraceIds` for all four, with no unsafe trace
  introduced or worsened anywhere in either sequence or dynamics.
- Dedicated sequence safety families hold at zero for every profile at every
  speed under both renderers, including incomplete carried-bass advances, and
  fresh bass remains required.
- Late-advance counts are reported beside safety and never as safety. Under
  Direct, `baseline-v1` carries 8 sequence late advances and the `early` pair
  carries none; the `steady` pair carries 5. In dynamics, each candidate carries
  6 late advances against the baseline's 1. All six are the same repeated
  `[62, 74, 82]` chord recovered one attack late on three Tone Salamander runs —
  `v05`, `v13`, and the mixed run — each at source distance 1 and about 1.22 s of
  attribution delay, against the baseline's single record at distance 2 and
  2.22 s.

#### What this settles

The multi-domain candidates are better at hearing a correct passage and worse at
refusing an incomplete one. Every candidate raises independent recognition in the
sequence and dynamics domains and never lowers it in the isolated corpus, clears
the one baseline false advance, and turns Tone's held-back ordered advancement
from 146 to as much as 280 — and every candidate also advances an omitted-bass
fixture that `baseline-v1` refuses, in both renderers.
The 0.99 extra-note gate they share does not compensate for the more permissive
onset and active-target gates on a target whose bass is simply missing.

That is a discovery result about the frozen search, not a tuning opportunity: no
threshold may be adjusted in response to these numbers without restarting
discovery. `baseline-v1` remains the production default with no change to the
registry, and the next round of profiles, if there is one, has to be selected
against isolated omitted-bass evidence rather than against sequence and dynamics
advancement alone.

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
`bundled-piano-tone-v2`. Manifest version 1, protocol hash `0ed1e71d`, musical
corpus hash `10ae2e0b`; the complete 268-trace isolated corpus with the sequence
corpus narrowed to 333.33 ms and the dynamics corpus narrowed to the articulation
suite, so the run is deliberately incomplete evidence.

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

#### Outcome-identity reproducibility

The per-trace, per-profile outcome identities did not exist at `10a32a7`, so the
values below are separate evidence measured later, at commit `1b8feef`, which
adds them, Chrome 151.0.7922.169 on Linux, model
`online_amt_streaming.onnx`. The smoke, corpora, renderers, and manifest are the
same as above, and the identity digests were reproduced unchanged, which is what
makes the two measurements comparable at all.

| Domain | Outcome rows | Outcome digest | Identity digest |
| --- | ---: | --- | --- |
| Isolated | 1,340 | `be407330` | `bff20df8` |
| Sequence | 130 | `81d4265d` | `f67b8d57` |
| Dynamics | 40 | `94f46bb3` | `0902e4cf` |

An outcome digest folds the per-trace, per-profile rows the way the identity
digest folds the captured traces: one row for each captured trace under each of
the five profile columns, each carrying a digest of every discrete outcome that
column produced on that trace, per-pitch evidence included.

Two repetitions of this smoke in fresh browser processes reproduced every value
above, all 1,510 outcome rows included, and their two archives are canonically
identical. That is the property the frozen confirmation depends on: the decoded
structure and every discrete matcher outcome are reproducible across processes
even though the raw PCM and confidence hashes are not.

The frozen automated confirmation does not compare against these digests at all.
It runs the complete matrix twice and compares its two repetitions with each
other, which is the only comparison in which both sides captured the same traces.
Archive each repetition separately, then make that comparison reproducible with:

```text
node tools/online_amt/verify_listen_benchmark_evidence.mjs \
  --compare benchmark-results/<first-run>.json benchmark-results/<second-run>.json
```

The comparison ignores only host-dependent `maximumInferenceMs`, floating-point
audio diagnostics `peak` and `rms`, and the two process-local hashes described
below. It compares every corpus identity, musical outcome, summary, gate code,
failure identity, and recommendation input.

Every captured trace carries `processLocalPcmHash`, the FNV-1a hash of the PCM it
was rendered from, and `processLocalTraceHash`, the FNV-1a hash of the complete
decoded trace including confidences and raw scores. Both are required to be
present and well formed: a run that recorded neither could not show what it
rendered and decoded, and a placeholder repeating across two runs would read as a
diagnostic that agreed. The PCM signature is recomputed from the waveform the
trace retained and compared whole, chunk hash for chunk hash, so a waveform
substituted after capture — including one of exactly the same length — is refused
rather than archived under the hash of audio the trace no longer holds. Neither is compared between processes, because Task 04
measured that Chrome's offline audio rendering and ONNX Runtime do not reproduce
their last bits in a fresh process. They are also left out of each domain's
`identityDigest`, so the single value a repetition is compared on first is the
decoded-structure identity alone.

Before comparing the two files to each other it holds each of them to the frozen
matrix: exactly one `listen-profile-validation` result, `evidenceComplete`,
registry version 2, `baseline-v1` plus the four frozen `v2` candidates at their
frozen threshold values, all eighteen gates with their stated requirements, all
three domains under both renderers, 268 isolated, 156 sequence, and 52 dynamics
traces named for their suite and renderer, manifest version 1 / `0ed1e71d` /
`10ae2e0b`, trace reuse and baseline parity verified per domain, both
process-local hashes recorded on every captured trace, and each domain
spanning exactly the partitions its frozen corpus spans. Outcome coverage is read
rather than counted: every captured trace must carry one row per profile column,
in the frozen column order and under the renderer and partition it was captured
in — both checked against the frozen values rather than against the trace's own
claim about itself — and both aggregate digests are recomputed from their own
rows. The decision is required beside the identities: the three measured
matrices, and for each candidate all eighteen gates applied — an unapplied gate
contributes no pass, so a report that applied none of them would clear a
candidate it never judged. Each outcome must satisfy the report's own algebra,
`passed === (applied && failures.length === 0)`, which requires the verdict to
follow from the recorded failures and not that the gate passed; each must read
exactly the rows a complete matrix reads for it, so safety cannot be gated on the
held-back rows alone; every failure must name its rows, its
baseline and candidate values as scalars or null, and a reason; the four per-role
counters are recomputed from those failures; and eligibility, the eligibility
set, and the recommendation must all follow from the outcomes. No waiver may be declared, and a run cannot call
itself complete while still listing reasons it was not. Two archives of this narrowed smoke are refused by that contract rather
than accepted as confirmation, which is the point: they agree with each other
perfectly.

Musical outcomes are compared row by row through the per-trace, per-profile
outcome identities each domain carries — one row per captured trace and profile
column, digesting every discrete outcome that column produced on that trace —
down to each expected pitch's attack type, evidence times, and qualification —
with one digest over the whole list beside the corpus identity digest. An
advancement that moved to another moment, a failure that changed classification,
an advance credited to a different physical attack, or a chord that qualified on
different notes is therefore a mismatch even when every aggregate count holds,
and it is reported against the trace and profile it happened under. Model
confidences stay out, because they are not bit-stable across browser processes.

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

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-bass-qualification

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html listen-bass-qualification repeated-chord
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
| `release` | `confirmation` rows only | Paired non-regression from `baseline-v1` on isolated recognition and Course Clear, p95 under 400 ms with no material paired regression, held-back renderer/piano recognition preserved, and no held-back leaf row losing more than one independent event. The old absolute recognition floors are product targets reported separately as debt. |
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

`listen-matcher-domain-archive` runs that same immutable multi-domain capture and
replay, then uses the separate Task 24 exporter. It retains every grid profile's
29 leaf-domain rows, applies selection policy version 1 to produce the version-1
control verdict, and refuses to export unless the Task 08 aggregate archive is
reproduced exactly. Pass the output path as its final argument; when a path is
present stdout remains the compact aggregate summary instead of printing the
large detail archive.

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

### Round-two validation policy — August 23, 2026

Task 23 freezes validation policy version 1 in
`webapp/src/listenProfileValidationPolicy.ts`. This is a versioned policy change,
not a correction to the Task 13 evidence. The two Task 13 JSON files and their
historical gate definitions remain byte-for-byte unchanged and continue to verify
under the round-one contract they actually ran.

The policy has four independent parts:

- Safety gates remain mandatory and fail closed. A complete run with any required
  gate unapplied rejects every affected profile; filtering only
  `applied && !passed` can no longer turn missing coverage into eligibility.
- Correctness eligibility is paired non-regression against `baseline-v1` on the
  identical frozen corpus. The incumbent traverses the same gate implementation
  and reports a reference row; it is not exempt from a rule it supplies the
  baseline for.
- The former isolated count floors are frozen as rates: 98% Direct overall, 95%
  Tone overall, and 95% Course Clear for both renderers. A manifest binds each rate
  to its census by ceiling. These are product targets, not eligibility gates, and
  every profile reports its distance from them.
- Eligibility alone cannot promote a profile. Promotion requires at least one
  predeclared material improvement: a one-percentage-point rate gain, one 32 ms
  decoder-hop latency reduction, or removal of one unsafe event, while still
  passing every safety and correctness gate. A profile at parity everywhere stays
  eligible for comparison but is not promotable. Rate and latency comparisons
  admit only frozen `1e-12` rate and `1e-9` ms representation epsilons, so the
  same count-derived one-point gain cannot fall on opposite sides of the boundary
  because of binary subtraction.

The Task 13 archive contract explicitly expects no `policyVersion` field because
those files predate this policy; a policy-versioned file is rejected instead of
being relabelled as historical evidence. Re-scoring both frozen Task 13 archives
through the committed archive reader gives the same adjacent result without
rendering audio or running inference. The re-score applies the complete policy
materiality set — isolated rates and latency, sequence rates and latency, dynamics
suite rates, and unsafe-event reduction. The
incumbent's Tone product debt is one overall correct advance (100/106 versus the
derived target 101) and four Course Clear advances (48/54 versus 52). All four
`v2` candidates meet paired isolated correctness and the materiality boundary.
The open pair's old `release-isolated-course-clear` rejection disappears, and the
held pair's old `release-isolated-recognition` and
`release-isolated-course-clear` rejections disappear. All four remain ineligible
for exactly one surviving reason: `safety-isolated-false-advance`, covering
`isolated/direct/122` and `isolated/tone/124`. Thus Task 23 changes no production
decision, threshold, registry entry, or default; it removes only the asymmetric
correctness rejections before the round-two corpus is built.

Unlike the isolated matrix, this corpus is **not** uniformly held out: manifest
version 1 assigned three constant layers per piano and renderer, one mixed run
per renderer, and five of the eight articulations to `discovery`. Every reported
group therefore carries the partitions it spans and an `evidenceRole` of
`discovery`, `confirmation`, or `mixed`, and only a `confirmation` group may be
quoted by a release gate. The historical single-profile `listen-dynamics-constant`
and `listen-dynamics-mixed` commands are unchanged; their results now record
`baseline-v1` by name rather than following whichever profile production
defaults to.

`listen-bass-qualification` is the Task 22 measurement. It captures the complete
isolated corpus, every `discovery` and `regression-only` continuous trace, and the
three Tone plus Salamander runs where the repeated Course Clear chord recurs — one
capture per manifest trace — and replays twenty-one profile columns against each
one: `baseline-v1`, the four frozen `v2` candidates, and the sixteen version-1
counterfactual grid profiles the second round names. It reports the decoded bass
onset confidence of every triad attack, separated into genuinely sounded and
hallucinated, per renderer and both by raw trace count and by unique musical
input; the per-pitch qualification record of every repetition of `[62, 74, 82]`,
read from the matcher's own gate decisions; and every counterfactual's safety and
regression evidence beside the round-one verdict the Task 08 archive recorded for
it. It selects nothing, ranks nothing, and changes no threshold, gate, or default.
The optional trailing argument narrows the corpus to `isolated`, `continuous`,
`repeated-chord`, or `omitted-bass` for a focused smoke; a narrowed run records
itself as `corpus.complete: false` and may not be quoted as the measurement. Every
captured omitted-bass trial that a committed fixture pins is re-verified against
it, so a rerun that no longer produces the phantom bass onset aborts the command.

`listen-dynamics-case` renders one constant-layer run instead of the 40-run
matrix and prints the complete forensics of every advancement counted against a
safety gate, a ready-to-commit regression fixture for each one, and the replay of
every already committed regression against all three named profiles. Name the
piano and layer as the last two arguments.

See the [piano dynamics benchmark](PIANO_DYNAMICS_BENCHMARK.md) for the
velocity-layer methodology, asset smoke checks, and measured 40-run matrix.
