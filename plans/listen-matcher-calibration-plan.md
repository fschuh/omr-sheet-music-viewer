# Listen matcher profiles and instrument calibration plan

## Decision summary

The next production improvement should come from a validated matcher profile, not
from more runtime tuning, recurrent-state resets, onset buffering, or score-rise
retrigger detection. Tasks 01-05 established the shared registry, separated the
exploratory sweep, migrated consumers, proved baseline parity, and corrected the
Tone plus Salamander `v05` classification. They also changed the interpretation
of the original candidates: `balanced-v1` and `sensitive-v1` were selected from a
Direct-only sequence sweep before the Tone renderer and dynamics benchmarks
existed. They are useful immutable historical references, but they are not a
complete search over the domains now known to matter.

Do not merely add the Tone sweep winner as a fourth hand-picked candidate.
Instead, diagnose the one remaining Tone false advancement, freeze a
representative multi-domain discovery/validation split, and rerun the full
1,000-profile search over discovery data that spans renderer, piano, dynamics,
speed, sequence family, and articulation. Select a small safe Pareto set from
that search, give newly selected profiles new versioned IDs, then validate that
frozen set on untouched automated and live data before changing production.

Instrument calibration is a separate layer above the matcher profile. Production
must always have a safe, validated default profile. Initial calibration should
select from a small registry of globally validated profiles; it must not generate
arbitrary thresholds from a short user session. The matcher state machine and its
safety semantics remain fixed regardless of calibration.

Use the following processing boundary:

```text
microphone audio
    -> optional input/noise normalization
    -> target-independent online-AMT inference and decoding
    -> optional instrument calibration or approved-profile selection
    -> fixed exact-chord matcher policy
    -> playhead advancement
```

The first release can improve the global default without shipping user
calibration. Calibration should ship only if a split-sample live experiment shows
that an instrument-selected profile generalizes better than the global default
without weakening any safety gate.

## Goals

- Replace the current Direct-only threshold recommendation with a production-ready
  profile decision backed by weighted multi-domain discovery, untouched automated
  confirmation, and live-input validation.
- Keep one safe global default for uncalibrated users, changed devices, invalid
  calibration records, and rollback.
- Preserve the versioned `baseline-v1`, `balanced-v1`, and `sensitive-v1`
  profiles as immutable first-generation references, then add a separately
  versioned safe Pareto candidate set derived from all discovery domains.
- Evaluate every candidate against identical recognition traces; matcher changes
  must never require different inference input or hidden fixture changes.
- Determine whether instrument-specific selection has enough repeatable value to
  justify a calibration feature.
- If calibration is justified, store only a selected approved profile and summary
  metadata. Do not save or transmit microphone audio.
- Preserve exact-chord safety: deliberate wrong notes, extra notes, omitted bass,
  stale carries, skipped targets, and duplicate advances must remain visible and
  gated.

## Non-goals

- Do not re-enable score-rise retrigger detection. Its best measured candidate
  created 22 false or duplicate events to recover two attacks.
- Do not reset recurrent inference before score events; the paired diagnostic
  recovered no ordered events.
- Do not revive the next-onset buffer; it lost correct advances and added false
  advances.
- Do not add raw sensitivity sliders or expose the five matcher thresholds in
  Settings.
- Do not let a correct-only calibration session weaken unexpected-note handling.
- Do not train or fine-tune the online-AMT model in this work. Pitches for which
  the model emits no evidence remain a later model/input-processing problem.
- Do not add per-pitch calibration from a small user sample. It is too easy to
  overfit and too difficult to safety-test.
- Do not conflate the score's playback-piano selection with the microphone
  instrument calibration. They describe different audio paths.

## Existing evidence and constraints

The registry now lives in `webapp/src/listenMatcherProfiles.ts`, and production
and benchmark consumers share its conversion to `ExactChordMatcher` options.
The first-generation profiles are:

| Profile | Onset | Target note | Active target | Unexpected note | Fresh bass |
| --- | ---: | ---: | ---: | ---: | --- |
| Current production | 0.60 | 0.50 | 0.35 | 0.97 | Required |
| Balanced candidate | 0.50 | 0.50 | 0.35 | 0.99 | Required |
| Sensitive candidate | 0.45 | 0.50 | 0.20 | 0.99 | Required |

The balanced candidate corresponds to
`o0p500-t0p500-a0p350-x0p990-b1`. On the original sweep it improved independent
matches from 291 to 304, ordered advances from 283 to 340, and complete passages
from 33 to 40 while preserving all four dedicated safety counters at zero.

The sensitive candidate corresponds to
`o0p450-t0p500-a0p200-x0p990-b1`. It improved independent matches to 308, ordered
advances to 365, and complete passages to 43, also with all four dedicated safety
counters at zero. It is the measured winner but has the largest distance from the
current profile.

These numbers are Direct sequence discovery results, not multi-domain evidence.
The later Tone and dynamics work adds the following constraints:

- Direct isolated recognition passes at 104/106; Tone reaches only 100/106 and
  fails the fixed 95% gate.
- Dynamics independent recognition remains near 90%, while ordered advancement
  falls to approximately 41-46%, confirming substantial matcher/playhead cascade.
- The full Tone sequence sweep has now been run. It rejects 500 profiles, retains
  a three-profile frontier, and is led by
  `o0p500-t0p500-a0p200-x0p970-b1`. Its different optimum confirms that renderer
  choice affects threshold selection. Because this result has been observed,
  Tone sequence data is discovery data rather than held-out confirmation.
- Tone plus Salamander `v05` is not a false or unsafe advance. All profiles
  advance the correct repeated chord `[62, 74, 82]`; `baseline-v1` advances
  target 23 at 25,440 ms from the third repetition, while `balanced-v1` and
  `sensitive-v1` advance it at 24,448 ms from the second repetition. The pinned
  regression has zero false, skipped, and duplicate advances. Its
  `lateAdvanceCount` measures playhead lag and must be reported separately from
  safety.
- The one Tone false advancement at 333 ms outside the dedicated safety families
  is diagnosed and pinned. It is a genuine matcher false advance: a single-note
  target that stalled on its own below-gate onset was completed by a later
  chord's shared pitch. It rejects 76 of the 1,000 grid profiles, all of which
  combine a 0.99 extra-note gate with a permissive active-target gate.
- Recognition changes non-monotonically across velocity layers. Calibration
  cannot be reduced to one microphone-gain adjustment.
- Browser inference already stays comfortably below the 32 ms input cadence, so
  matcher validation has priority over more runtime benchmarking.

## Matcher profile ownership

`webapp/src/listenMatcherProfiles.ts` is the production-neutral owner of the
`ListenMatcherProfile` type, immutable named profiles, registry version, default
pointer, validation, and conversion. Benchmark code must not own or duplicate
that contract.

The module should define:

```ts
type ListenMatcherProfileId =
  | "baseline-v1"
  | "balanced-v1"
  | "sensitive-v1";

interface ListenMatcherProfile {
  id: ListenMatcherProfileId;
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: true;
}
```

This snippet describes the implemented first-generation registry. Task 08 may
extend the ID union with newly measured candidates, but it must do so by adding
new IDs rather than changing these entries.

These three IDs and values are now historical contracts and must not be edited in
place. Any profile selected by the multi-domain search receives a new ID and a
new registry version, even if it resembles an existing entry. The eventual
candidate count is determined by the safe Pareto frontier, not fixed in advance.
Keep the registry immutable and validate every numeric value as a finite number
in the range 0-1. `requireFreshBassOnset` remains structurally true for every
production-eligible profile; arbitrary benchmark sweep profiles may still test
false without becoming registry entries.

`DEFAULT_LISTEN_MATCHER_PROFILE_ID` remains `baseline-v1` until the frozen
automated and live gates pass. Changing the default is then one reviewed
production decision rather than an unrelated edit to five constants.

Keep the timing and state-machine properties in the fixed matcher policy:

- `preTargetExtraLookbackMs`
- `collectionWindowMs`
- `settleMs`
- `duplicateOnsetMs`
- `wrongAttemptResetMs`
- `refractoryMs`
- `refractoryMode`

Candidate profiles change confidence interpretation only. Calibration must not
change timing, target ordering, carry-over semantics, or advancement behavior.

Provide a single conversion function from `ListenMatcherProfile` to
`ChordMatcherOptions`. `onlineAmtOutput.ts`, `App.tsx`, isolated benchmarks,
sequence replay, dynamics replay, articulation replay, and calibration replay
must all use this function.

## Effective profile resolution

Resolve the profile through one production function with this priority:

1. An explicit benchmark/test override, available only through benchmark APIs.
2. A compatible locally stored calibration selection, when calibration is
   eventually enabled.
3. `DEFAULT_LISTEN_MATCHER_PROFILE_ID`.

Do not accept a URL parameter or arbitrary JSON threshold object in the ordinary
application route. An unknown profile ID, malformed record, model-version
mismatch, or registry-version mismatch must fall back to the default.

`App.tsx` currently constructs one matcher with
`useRef(new ExactChordMatcher(...))`. Resolve the effective profile before
constructing that matcher. A later calibration change must stop listen mode,
discard the old matcher, create a new matcher with the resolved profile, and then
allow listening to restart. Never mutate matcher thresholds during an active
attempt.

Expose the effective profile ID in local diagnostic/benchmark output, not in the
normal score UI. This makes bug reports reproducible without presenting technical
threshold controls to users.

## Deterministic profile replay

All candidate comparisons must reuse the same captured recognition trace. The
online-AMT model and decoder remain target-independent; profile selection happens
only in matcher replay.

Before adding the production-candidate matrix, extract the exhaustive parameter
search from `listenSequenceBenchmark.ts` into
`webapp/src/listenMatcherSweepBenchmark.ts`. The sequence module should own
sequence definitions, materialization, trace capture, profile-aware replay, event
diagnostics, aggregate summaries, and reusable sequence-safety evaluation. The
new sweep module should own the five parameter grids, generation of all 1,000
combinations, sweep result types, discovery-baseline parity, eligibility, ranking,
Pareto-frontier calculation, and `runListenThresholdSweep`.

Move the sweep-specific tests from `listenSequenceBenchmark.test.ts` into a new
`listenMatcherSweepBenchmark.test.ts` and add it to the package test command. This
includes grid generation, sweep eligibility, ranking, Pareto-frontier, parity, and
complete-sweep tests. Keep reusable safety summarization outside the sweep module
because retrigger and production-candidate validation also consume it; rename
`summarizeListenThresholdSafety` to `summarizeListenSequenceSafety` or place it in
a small shared `listenBenchmarkSafety.ts` module. The extraction must preserve the
existing browser command, `window.listenThresholdSweepResult` contract, concise
export, and measured results exactly.

Maintain an acyclic dependency direction:

```text
listenMatcherProfiles
        -> listenSequenceBenchmark
                -> listenMatcherSweepBenchmark
                -> listenProfileValidationBenchmark
```

Refactor the benchmark entry points as follows:

- `listenBenchmark.ts`: accept a profile for isolated matcher evaluation and
  retain enough decoded trace data to replay the same trial without rerendering or
  rerunning inference.
- `listenSequenceBenchmark.ts`: import the shared profile type and named profiles
  needed for explicit replay, and expose the reusable trace/replay boundary needed
  by the sweep and production-candidate validation modules. It should no longer
  own the exhaustive grid or its ranking logic.
- `listenMatcherSweepBenchmark.ts`: continue generating the 1,000 exploratory
  combinations independently; the production registry does not limit which
  parameter combinations the sweep can test. Use the frozen `baseline-v1` profile
  as the reference for discovery-corpus parity and deltas, while the
  production-default ID remains a separate pointer to whichever named profile the
  app currently uses.
- `listenProfileValidationBenchmark.ts`: evaluate the frozen candidate registry
  produced by the multi-domain discovery pass. It must not generate grid profiles
  or change candidate values after any confirmation result is observed.
- `listenDynamicsBenchmark.ts`: replace the hardcoded
  `replayListenSequenceTrace(..., "current-matcher")` result with a profile matrix
  or retain the trace once and produce an adjacent result for each requested
  profile.
- Articulation and inference-reset reports: add profile metadata. Replay the
  frozen candidate set where matcher output is relevant; do not rerun the rejected
  inference-reset experiment once trace parity is established.
- `ListenBenchmarkPage.tsx` and the browser automation runner: add a dedicated
  production-candidate validation command. Do not silently apply a profile query
  parameter to unrelated historical baselines.

Every result must include:

- Profile ID and the complete threshold values.
- Model and renderer identity.
- PCM/trace identity where applicable.
- Independent, ordered, prefix, complete-passage, and latency metrics.
- False, skipped, duplicate, incomplete-bass, carry-over, and wrong/extra-note
  safety diagnostics.
- Late-advance count, source-to-target distance, causing attack, and attribution
  delay. A late advance is never an ordered advance, but is not a safety failure
  unless the causing content is wrong, skipped, or duplicated.
- Per-speed, per-family, per-piano, and per-layer breakdowns rather than only a
  combined score.

Before comparing candidates, replay `baseline-v1` and require parity with the
stored/current production result. Within one capture/replay process, require exact
PCM, trace, event, and summary identity. Across fresh browser processes,
`OfflineAudioContext` PCM last bits and raw FNV PCM hashes are not stable; require
exact sample/frame counts, discrete events, decoded-structure hashes, and summary
outcomes, while allowing continuous renderer/model values to differ by at most
one representable Float32 ULP. A parity failure blocks comparison because it
means the harness, not the profile, changed.

## Completed Tone plus Salamander `v05` diagnosis

Task 05 established that the reported `v05` event is a late recovery of correct
pitch content, not a false advancement. Target 23 is the repeated exact chord
`[62, 74, 82]`. `baseline-v1` advances at 25,440 ms from its third repetition;
`balanced-v1` and `sensitive-v1` advance at 24,448 ms from its second repetition.
Every replay keeps false, skipped, and duplicate counts at zero.

The minimized decoded trace and decoded-structure hash are permanent regressions.
Keep `lateAdvanceCount` visible at run, per-speed, aggregate, and candidate levels.
Earlier recovery of the same correct repetition may be a performance improvement;
it must not be rejected merely because it differs from the baseline attribution.
Any future change to which played attack caused the advance still requires an
explicit reviewed explanation.

Task 06 separately diagnosed the one Tone false advance at 333 ms. It is not
explained by the `v05` correction and is not the same mechanism: `course-clear-27`
target 8, the single note `[56]`, stalled on a 0.531 onset below `baseline-v1`'s
gate and was then completed at 4,768 ms by the shared 56 of `[56, 68, 75]`, whose
other two pitches were invisible to the extra-note gate. It is a genuine false
advance, its classification is unchanged, and it is a permanent regression.

## Multi-domain discovery and validation partition

The original Direct and completed Tone sequence sweeps are discovery evidence.
Do not describe Tone sequence data as held out. Dynamics and articulation contain
many traces, so freeze a stratified discovery subset before searching and reserve
the remainder for confirmation. Discovery must cover every known variable, but
it must not consume every trace.

The discovery corpus must include:

1. Direct and Tone sequence traces covering all 13 sequence families and six
   speeds, including the already observed sweep results.
2. Both Splendid and Salamander under Direct and Tone, with stratified quiet,
   medium, and loud constant layers rather than every layer.
3. Representative mixed-dynamics and detached, normal, legato, and
   sustained-shared articulation traces.
4. The diagnosed `v05` late-advance regression, the remaining Tone 333 ms false
   regression after Task 06, and all carried-bass, wrong-note, extra-note, skip,
   duplicate, and stale-carry safety families.

Freeze untouched confirmation data before the search. At minimum reserve the
complete isolated correct/wrong/ambiguous/omitted-bass corpus, held-back velocity
layers for both pianos and renderers, held-back articulation/mixed-dynamics cases,
and every later live acoustic/digital trial. A trace cannot move from confirmation
to discovery after its candidate result is observed; changing the split starts a
new discovery and validation round.

Do not weight raw runs equally. Sixteen Salamander layers must not swamp four
Splendid layers, and cascade-heavy sequence families must not swamp isolated or
safety evidence. Compute hierarchical equal weights in this order:

```text
renderer -> suite -> piano/articulation/sequence family -> run
```

Safety is a hard constraint, not a weighted score. Among safe profiles rank, in
order, worst-domain independent recognition, equal-domain average independent
recognition, ordered prefix/complete-passage behavior, late-advance burden and
attribution delay, latency, and distance from `baseline-v1`. Independent
recognition precedes ordered advancement so one early recovery cannot win only by
cascade amplification. Freeze a small Pareto set; do not predetermine whether it
contains two, three, or four candidates.

## Frozen automated candidate validation matrix

After multi-domain discovery adds new versioned candidate IDs to the registry,
freeze that registry version, fixtures, metrics, and gates. Replay `baseline-v1`
and every frozen candidate against the untouched confirmation corpus. The old
`balanced-v1` and `sensitive-v1` rows may remain for historical comparison, but
they need not remain release candidates unless the new discovery independently
retains them.

## Automated acceptance gates

A candidate is production-eligible only if all gates pass independently. Do not
trade a safety regression for a higher aggregate recognition rate.

### Replay integrity

- Baseline replay is event-for-event identical to current production output.
- Within each captured run, all compared profiles use the identical PCM and
  decoded trace object, frame count, renderer, model, target schedule, and decoder
  output.
- Across fresh browser processes, two complete repetitions have identical
  decoded-structure hashes, discrete events, summaries, gate codes, and failure
  identities. Raw PCM/FNV hashes may differ because browser rendering is not
  bit-stable; continuous values may differ by at most one Float32 ULP.

### Safety

- Dedicated distinguishable-wrong, extra-note, skipped, duplicate, and
  incomplete-carried-bass counts remain zero at every speed under both renderers.
- No candidate adds a false, skipped, or duplicate advance to any dynamics or
  articulation run relative to baseline.
- The diagnosed `v05` case keeps zero false/skipped/duplicate advances and remains
  reported as a late-advance/recovery case.
- The diagnosed Tone 333 ms false case from Task 06 does not worsen.
- Fresh bass remains required.
- Ambiguous harmonic cases remain separately reported and never used to hide a
  distinguishable false advance.

### Isolated correctness

- Direct remains at least 104/106 overall and 52/54 on Course Clear.
- Tone reaches the existing fixed 95% acceptance gate: at least 101/106 overall
  and 52/54 on Course Clear.
- P95 onset-to-advance latency remains below 400 ms for each renderer and does not
  materially regress from its paired baseline.

### Continuous and dynamics robustness

- Independent recognition does not decrease at any speed under either renderer.
- Ordered advances and complete passages improve or remain equal under each
  renderer separately; a Direct gain cannot hide a Tone regression.
- Each renderer/piano aggregate in the dynamics matrix preserves or improves
  independent recognition.
- No individual layer loses more than one independent event without an explicit,
  reviewed explanation. All layer-level losses remain visible.
- Improvement is present in more than one sequence family and is not solely a
  cascade amplification following one recovered early event.
- Late-advance counts, source-to-target distance, and attribution delay are
  reviewed per domain. They are performance diagnostics, not automatic safety
  failures; earlier recovery of the correct repeated chord can be beneficial.
- Latency distributions and processing backlog remain within existing limits.

## Candidate selection rule

Apply the gates first. Rank only eligible profiles.

Use this decision order for the frozen safe Pareto candidates:

1. Fewer live distinguishable false advances and safety failures.
2. Higher held-out live correct advancement.
3. Higher automated independent recognition across renderers and instruments.
4. Higher ordered prefix and complete-passage results.
5. Lower latency.
6. Smaller distance from the current production profile.

When candidates are effectively tied, prefer the smaller distance from
`baseline-v1`. Do not prefer an existing historical ID merely because it already
exists, and do not select a profile solely for a larger ordered-cascade gain.

Record both the selected profile and rejected candidate with the exact reason.
Do not simply copy the sweep's top-ranked ID into production.

## Live-input validation harness

The current manual form records an acoustic/digital label, correctness, whether
the viewer advanced, and manually entered timing, but it stores empty target and
played pitch arrays. Replace it with a structured developer validation harness.

For each trial record:

- Trial and session ID.
- Acoustic piano, digital piano through speakers, or digital line/output source.
- User-entered instrument label; do not require a manufacturer or serial number.
- Microphone setup label, distance category, and quiet/ordinary/noisy room label.
- Target pitches, deliberately played pitches, score position, chord size,
  register band, dynamic, articulation, and tempo.
- The target-independent decoded recognition trace needed for matcher replay.
- Results for `baseline-v1` and every profile in the frozen candidate matrix.
- Expected correctness, mathematical ambiguity classification, and safety reason.
- Advancement and latency metrics calculated from trace clocks rather than typed
  manually when possible.

Keep the data in memory until explicitly exported. Exports must contain decoded
events/confidences and metadata only, never raw audio buffers. Preserve the
application's existing promise that microphone audio is neither saved nor
transmitted.

### Developer live corpus

Before changing the global default, run a predeclared corpus with at least one
acoustic piano and one digital piano, preferably under two microphone/room
conditions:

- Single notes spanning low, middle, and high registers at soft, medium, and loud
  dynamics.
- Dyads, triads, and four-or-more-note chords across registers and dynamics.
- Repeated notes, repeated chords, shared bass, shared upper notes, detached,
  normal, and legato transitions.
- Correct passages at 1000, 500, 333, and 250 ms intervals where playable.
- Deliberately wrong single notes, an incorrect chord member, an added note, and
  an omitted bass.
- A short silence/noise segment before each setup.

Use one captured performance per trial and replay every frozen candidate against it.
Do not ask the player to repeat the same passage separately for each profile.

The release decision must report source/setup results separately. A large digital
piano gain cannot hide an acoustic-piano safety failure.

## Calibration feasibility experiment

Calibration is justified only if it predicts a better safe profile on unseen
trials. Use the live corpus to simulate calibration before building user-facing
Settings UI.

For each instrument/setup session:

1. Split trials in advance into a calibration block and a confirmation block.
   Balance both blocks across register, dynamics, chord size, transitions, and
   negative cases.
2. On the calibration block, eliminate any profile with a distinguishable false,
   skipped, duplicate, or incomplete-bass advance.
3. Among remaining profiles, select by correct independent/advancement rate, then
   latency, then smaller distance from the global default.
4. Evaluate that selection on the untouched confirmation block.
5. Compare it with the global default and with the per-session oracle profile.

Report:

- How often each profile is selected.
- Whether the same instrument/setup selects the same profile on repeated sessions.
- Confirmation-set gain over the global default.
- Confirmation-set safety differences.
- Oracle regret: the difference between the selected/default profile and the best
  safe profile for that session.
- Whether gains correlate with dynamics, register, room, or input source.

Ship user calibration only when selection is repeatable and confirmation-set
performance improves materially without any safety loss. If one global profile is
at or near the safe oracle across sessions, keep the fixed profile and avoid the
extra product complexity.

## Initial user calibration design

If the feasibility experiment passes, implement calibration as approved-profile
selection rather than free threshold fitting.

The wizard should contain:

1. A short silence/noise-floor observation.
2. Guided low, middle, and high single notes at ordinary and soft dynamics.
3. A small set of representative chords.
4. Repeated/shared-note transitions.
5. Explicit wrong, extra-note, and omitted-bass confirmation trials.
6. A confirmation block not used to select the profile.

The wizard may choose only from the registry version approved by the automated
and live release decision, including the global default. If no approved candidate
beats the default on confirmation data, if a negative case advances, or if too
few trials are completed, save the default or no calibration.

Use user-facing language such as `Standard`, `Adjusted for this setup`, and
`Recalibration recommended`; do not label profiles `aggressive` or show raw
thresholds.

## Calibration record and persistence

Add a versioned local record, for example under
`homr.listen-calibration.v1`:

```ts
interface ListenCalibrationRecordV1 {
  schemaVersion: 1;
  modelId: string;
  profileRegistryVersion: string;
  selectedProfileId: ListenMatcherProfileId;
  createdAt: string;
  sourceKind: "acoustic" | "digital" | "unknown";
  setupLabel?: string;
  calibrationCorrect: number;
  calibrationTotal: number;
  confirmationCorrect: number;
  confirmationTotal: number;
  negativeSafetyFailures: number;
}
```

Do not store raw audio, raw browser device IDs, manufacturer information, or the
full calibration trace in ordinary preferences. Developer exports are explicit
one-time actions and remain separate from the saved production record.

For the first version, treat calibration as applying to the system-default input
and let the user name the setup. Provide `Recalibrate` and `Reset calibration`.
If reliable local device selection is added later, bind records to a local-only
device key and exclude that key from exports.

Invalidate or ignore a record when the model ID, profile registry version, or
schema is incompatible. A missing or invalid record always resolves to the global
default without blocking listen mode.

## Settings and lifecycle behavior

If calibration ships, add one `Listen calibration` section to Settings showing:

- Not calibrated / calibrated status.
- Optional setup label and calibration date.
- `Calibrate` or `Recalibrate` action.
- `Reset calibration` action.
- A concise privacy note that calibration audio is processed locally and not
  retained.

Changing or resetting calibration while listen mode is active must stop listening
before replacing the matcher. Do not put profile selection in the score-viewer
toolbar, and do not add a general sensitivity dropdown as a shortcut around the
wizard's safety cases.

## Later confidence-normalization phase

Profile selection is the initial calibration mechanism. Consider a more
principled confidence-normalization layer only if live results show a stable
instrument-dependent domain shift that the approved candidate matrix cannot cover.

A later phase may evaluate:

- Bounded input gain based on a silence/noise and played-note calibration.
- Monotone normalization of onset confidence and active-target confidence.
- Broad register-band correction when supported by enough trials.
- A separately calibrated unexpected-note score using explicit negative data.

The normalized evidence should feed one fixed matcher policy. Transformations must
be monotone, bounded, versioned, and replayable. They must not synthesize missing
onsets, reinterpret score targets, disable fresh bass, or make an unexpected note
less detectable without negative confirmation trials.

Do not begin this phase until approved-profile selection has been measured. The
non-monotonic layer results imply that simple gain normalization may not be enough,
but they do not yet prove that a learned confidence map is necessary.

## Unit and integration tests

Add tests for:

- Exact profile IDs, values, immutability, validation, and registry versioning.
- Conversion from a profile to complete `ChordMatcherOptions`.
- Default, calibrated, incompatible, corrupt, and benchmark-override profile
  resolution.
- Calibration persistence, migration/fallback, reset, and export redaction.
- Matcher reconstruction when calibration changes.
- Baseline replay parity for isolated, sequence, dynamics, and articulation data.
- Adjacent candidate-matrix results using one identical trace.
- The minimized `v05` regression.
- The minimized Tone 333 ms false-advance regression from Task 06.
- Discovery/confirmation partition immutability, hierarchical weighting, safety
  filtering, Pareto selection, and new candidate registry versioning.
- Candidate safety summaries and per-domain acceptance gates.
- Calibration-block selection and untouched confirmation-block evaluation.
- Correct-only calibration being rejected when no negative safety trials exist.
- Settings rendering and calibration lifecycle behavior if the UI phase ships.

Keep tests deterministic. Unit tests may use compact decoded frames. Browser tests
must assert within-run trace identity before comparing profiles and use
decoded-structure/discrete identity plus the documented Float32 tolerance across
fresh processes rather than requiring cross-process raw PCM hash equality.

## Browser automation and reports

Add explicit automation modes rather than changing historical commands in place:

```text
listen-matcher-multidomain-sweep
listen-matcher-multidomain-sweep-summary
listen-profile-validation
listen-profile-validation-summary
listen-live-calibration-export       # manual capture, explicit export only
```

The profile-validation summary should contain:

- Baseline parity status.
- Candidate eligibility per gate.
- Direct/Tone isolated results.
- Sequence totals and per-speed deltas.
- Dynamics results by renderer, piano, layer, and mixed profile.
- Articulation results.
- Complete safety counts including the `v05` late recovery and the diagnosed Tone
  333 ms false regression.
- The selected global profile or `no-safe-candidate`.

Update `tools/online_amt/LISTEN_BENCHMARK.md` with the measured decision and link
to a focused calibration report if the feasibility study proceeds. Update the
benchmark index and README only after the production default changes or
calibration becomes user-visible. Preserve the older baselines and label their
profile explicitly rather than rewriting them.

## Second discovery round

Task 13 rejected all four `v2` candidates and Task 16 recorded
`no-safe-candidate`. Read the three rejecting gates separately, because only one
of them is a regression against the incumbent:

| Gate | `baseline-v1` | Candidates | Kind |
| --- | ---: | ---: | --- |
| `safety-isolated-false-advance` | refuses `isolated/direct/122`, `isolated/tone/124` | all four advance both | Real regression |
| `release-isolated-course-clear` | Tone 48/54 | open pair 50/54, held pair 48/54, floor 52/54 | Absolute floor the incumbent also misses |
| `release-isolated-recognition` | Tone 100/106 | held pair 100/106, floor 101/106 | Absolute floor the incumbent also misses |

`LISTEN_ISOLATED_RELEASE_GATE` applies its floors to candidates only, so
`baseline-v1` is grandfathered past a bar it does not meet, and
`early-open-v2` and `steady-open-v2` were rejected under Tone while measuring
strictly better than the shipped default on both isolated metrics. Those floors
are not unreachable — the open pair moved Course Clear from 48 to 50 of the 52
required — but as written they block shipping any safe improvement for as long as
the incumbent sits below the same target. Replacing them is a versioned policy
change, not a correction, and it must be frozen before the next search captures
anything; making it afterwards would be the post-result retuning Task 13 forbids.

The one genuine regression already has a recorded mechanism. Task 09 measured
both fixtures: `isolated/direct/122` is `[48, 60, 68]` played as `[60, 68]`, and
`isolated/tone/124` is `[56, 68, 75]` played as `[68, 75]`. Both targets are
triads whose lowest note was omitted, so `target.size >= 3` holds and fresh bass
is required, which excludes the sustained-evidence completion path by
construction. Each was completed instead by a decoded onset on a bass pitch that
was never sounded, whose confidence the `steady` and `baseline` split places in
`[0.50, 0.60)` — exactly the gap between the candidates' onset gates at 0.45 and
0.50 and the incumbent's at 0.60. That is why all four advance and `baseline-v1`
refuses.

This is not the Task 06 mechanism. There a later chord genuinely sounded the
shared pitch; here the pitch was never played at all. The two share a policy — a
target pitch qualifying on evidence that is not a fresh attack of that pitch in
that chord — and nothing else, so a fix for one is not evidence for the other.

The gain and the cost enter through different gates, but they are not cleanly
separable. Task 09 attributed the Course Clear recovery to the 0.20 active-target
gate rather than to the fresh-onset gate, while the omitted-bass false advance
comes from the onset gate dropping into the `[0.50, 0.60)` hallucination corridor.
That suggests holding the onset gate at the incumbent's 0.60 while opening the
active gate to 0.20, and the Task 08 archive rules it out: all four grid profiles
at onset 0.60, target 0.50, active 0.20 and fresh bass required were rejected in
round one for `discovery-safety-regression`, and the `x0p990` variant for a
committed regression as well. The `x0p970` variant adds a false advance on
`sequence/tone/course-clear-27/167ms` and on `dynamics-constant/tone/salamander/v14`.
Those rejections have nothing to do with isolated evidence; they were already
visible in round one's own discovery corpus.

The safe high-onset region is real but narrower than that. Of the 279 profiles
that passed round-one safety, 60 hold the onset gate at 0.60, and their active
gates are 0.275 or higher — twelve at 0.275, none at 0.20. So the first thing to
run is still the unchanged grid, but the question it answers is whether the
version-2 corpus and the new policy expose any safe existing-grid candidate at
all, not whether one particular combination wins. A bass-specific onset gate
remains the fallback if no existing-grid profile both stays safe and recovers
enough, and Task 22 measures its cost before Task 26 decides.

That cost has a second side the round must not overlook. The repeated chord
`[62, 74, 82]` is recovered late on three Tone Salamander runs — `v05`, `v13`, and
the mixed run — and no measured profile recognises it on the attack that sounds
it: `baseline-v1` recovers at source distance 2 and 2.22 s of attribution delay,
and all four candidates at distance 1 and 1.22 s. A full attack of playhead lag on
a repeated chord is therefore the shipped behaviour, not a candidate regression,
and the candidates halved it with a confidence-only change, which places at least
part of the cause inside what a profile may alter rather than in the fixed timing
policy. Repetitions here are about 992 ms apart, far outside `refractoryMs` at 180
and `duplicateOnsetMs` at 120, so refractory suppression does not explain it.

The minimized `v05` evidence does not support treating this as one bass-onset
failure. On the first `[62, 74, 82]` attack, bass 62 is newly introduced and has a
strong onset, while carried upper D5/74 has no fresh onset and only about 0.1935
target evidence, just below the lowest measured active-target gate at 0.20. On the
second repetition all three pitches carry; bass 62 has an onset around 0.5968,
just below the incumbent's 0.60 gate, while D5/74 has about 0.4587 target evidence.
The candidates can therefore recover at source distance 1 through a lower general
onset gate plus active upper-voice completion, but no measured profile reaches
distance 0. Task 22 must reproduce these qualification paths on `v05`, `v13`, and
the mixed run rather than infer one mechanism from aggregate attribution.

The omitted-bass defect and the second-repetition recovery may pull a bass gate in
opposite directions: the hallucinated bass onset sits in `[0.50, 0.60)`, while a
real re-struck bass can sit there too. The prior is already adverse: attack 24's
genuine 0.5968 bass onset is inside the recorded hallucination corridor and is
refused by a bass gate at 0.60. Task 22 still measures the full distributions, but
it starts from one observed overlap rather than from a presumption that a clean
threshold exists. A bass-specific onset gate is justified only if the larger
sample establishes useful separation and its matched control cannot provide the
same recovery.

The upper-voice path has a similarly adverse prior. Reaching attack 23 through the
existing scalar family requires an active-target gate below the recorded 0.1935
D5/74 evidence, and round one's safety results make exclusion of such a permissive
region the expected outcome to test, not a conclusion to assume. The recorded
cause is the decoder's failure to emit a D5 re-onset across the first two
repetitions — the same retrigger limitation the August 14 score-rise experiment
could not correct safely. If scalar qualification cannot reach distance 0 safely,
Task 29 routes that residual model-evidence defect to the required decoder/model
plan instead of re-litigating it as another threshold round. Score-rise retrigger
detection remains a non-goal, having produced 22 false or duplicate events to
recover two attacks.

An onset decoded on a pitch that was never sounded is also, in the end, a
model-evidence defect surfacing as a threshold problem. That matters for where
the residual work goes if round two does not produce a shippable profile.

The round-one selection rule also needs a decision rather than a repeat. Task
07's frozen metric order ranks worst-domain and equal-domain average recognition
first, which is a compromise-seeking rule built to find one global winner, and it
returned four near neighbours of that winner: onset in {0.45, 0.50} crossed with
the active gate in {0.20, 0.275}, with `targetNoteThreshold` pinned at 0.50 and
the extra-note gate at 0.99 in every one. That is a two-by-two corner of one
region, and the Tone-only sweep's own optimum sat outside it on the extra-note
axis at 0.97. If the value of a second round is one better global default, keep
the compromise rule. If the value is a set of approved profiles for per-source
selection, the rule must instead select for spread across the safe frontier.
Decide which from measured per-domain oracle regret, not from preference.

One more constraint governs the whole round: round one consumed its own held-out
evidence. Every version-1 isolated trace was captured and evaluated in Task 13
across all five profile columns, so no unobserved isolated row exists, and a
round-two confirmation partition cannot be carved out of the existing corpus.
Once a trace has been measured it is discovery evidence permanently. Round two
therefore has to author new fixtures, and the newly authored confirmation share
must include negative cases rather than correct playing alone, because false
advances are what reject candidates and a correct-only partition cannot see them.

Calibration does not change any of this. The wizard sits downstream of the
approval gate, not around it: it may choose only from profiles the automated and
live release decision approved, and its own selection rule discards any profile
that advances a negative trial. The approved list holds `baseline-v1` alone, and
a wizard choosing among one profile is a no-op. Note that the registry is not
that list — it retains every historical and rejected profile, so membership in it
is not approval, and Task 29 emits the approved list as a separate artifact.
Per-source selection is the right instrument for the two Tone release floors,
which are domain-shift shaped, but it cannot rescue a profile rejected for a
safety regression, and it cannot produce the first approved alternative. Round
two is therefore a prerequisite of Task 17, not a substitute for it.

## Numbered execution tasks

Execute exactly one numbered task per implementation pass. A pass begins by
checking the stated prerequisites and ends after the task's verification and
completion condition are satisfied. Do not start the next task merely because a
safe subset of it is convenient. When a task changes a measured browser result,
record the command, commit, renderer/model identity, result hashes, and concise
summary in the appropriate benchmark report before closing the pass.

Task numbers are permanent identifiers. They are cited throughout
`tools/online_amt/LISTEN_BENCHMARK.md`, `benchmark-results/README.md`, and the
benchmark sources, so a later task is never renumbered to express ordering.
Execution order comes from the stated prerequisites instead, which is why the
second-round tasks are numbered after Task 21 but run before it.

Tasks 01-13 and 16 are complete and closed the first discovery round with
`no-safe-candidate`. Tasks 22-29 are the second round described above, and they
run next: Tasks 22-24 diagnose and scope it, Task 25 builds its corpus, Task 26
decides how much new parameter the evidence justifies, Task 27 searches, and
Tasks 28-29 confirm and decide. The corpus precedes the axis deliberately, because
Task 26's first ablation is the existing grid measured against Task 25's corpus.
Tasks 27-29 form an immutable artifact chain — candidate manifest, then eligibility
manifest referencing its digest, then approved-profile list referencing that one's
— so no task edits an artifact an earlier task froze. Task 14 is still required and
may be built in parallel with Tasks 22-27, since the harness reads whichever
eligibility manifest a confirmation task last froze rather than any one round's
candidate list. Task 15 stays deferred with its `no-safe-candidate` record until
Task 28 produces an eligible candidate, at which point Task 29 requires it.

Task 17 additionally requires Task 29's approved-profile list to hold more than
`baseline-v1`. Calibration selects among approved profiles and cannot approve one,
so with a single entry the wizard has nothing to choose between. Tasks 18-20 are
conditional: execute them only if Task 17 concludes `calibration-justified`. If
Task 17 concludes `fixed-profile-sufficient`, mark Tasks 18-20 skipped with that
decision as their completion evidence. Task 21 remains a separate later research
branch and is reachable only through Task 17; if round two produces no approved
alternative, Task 21's own prerequisite cannot be met, and Task 29 instead emits a
written requirement for a new decoder and model-evidence plan. That requirement is
also emitted if an approved profile provides only partial repeated-chord recovery
or lacks reproducing confirmation evidence. It is this plan's output, not another
task inside it, because model work is an explicit non-goal here.

### Task 01 — Create the production-neutral matcher profile registry

**Status:** Completed August 17, 2026. **Prerequisites:** None.

**Objective:** Establish one non-benchmark owner for matcher profile types, named
profiles, the production-default pointer, validation, and conversion to complete
`ChordMatcherOptions`, while leaving production behavior unchanged.

**Work:**

- Create `webapp/src/listenMatcherProfiles.ts`.
- Define stable IDs `baseline-v1`, `balanced-v1`, and `sensitive-v1` and the shared
  profile interface containing onset, target-note, active-target, unexpected-note,
  and fresh-bass fields.
- Encode the exact values from the profile table in this plan. All three profiles
  must keep `requireFreshBassOnset: true`.
- Add an immutable registry, finite/range validation, lookup by ID, and one
  conversion function that combines a profile with the fixed matcher timing and
  state-machine options.
- Add `DEFAULT_LISTEN_MATCHER_PROFILE_ID` and set it to `baseline-v1`.
- Do not import benchmark code into this module and do not change the existing
  production consumer yet.
- Add `listenMatcherProfiles.test.ts` and include it in the package test command.

**Verification:** Run the new unit tests, the existing chord-matcher tests, and a
TypeScript build. Assert that converting `baseline-v1` produces onset `0.60`,
target-note `0.50`, active-target `0.35`, unexpected-note `0.97`, fresh bass true,
and the unchanged fixed timing/state-machine values.

**Complete when:** The registry is the authoritative representation of the three
named profiles, its default points to `baseline-v1`, all tests/build pass, and no
production or benchmark result has changed.

**Completion evidence:** Commit `3530a82` created the immutable registry,
validation, default pointer, conversion, and tests. `baseline-v1` remained the
default and its converted options preserve the former production values.

### Task 02 — Extract the exhaustive sweep into its own benchmark module

**Status:** Completed August 17, 2026. **Prerequisites:** Task 01 complete.

**Objective:** Separate exploratory parameter search from reusable sequence
capture/replay and from frozen production-candidate validation without changing
the existing 1,000-profile sweep.

**Work:**

- Create `webapp/src/listenMatcherSweepBenchmark.ts`.
- Move the five threshold grids, stable sweep-ID generation, all 1,000 profile
  combinations, sweep-specific result types, discovery-baseline parity check,
  eligibility logic, ranking, Pareto-frontier calculation, and
  `runListenThresholdSweep` into it.
- Use the frozen registry entry `baseline-v1` for discovery-corpus parity,
  distance, and deltas. Do not use the mutable production-default pointer for
  historical sweep comparison.
- Keep sequence definitions, materialization, trace capture, profile-aware replay,
  event diagnostics, and aggregate sequence summaries in
  `listenSequenceBenchmark.ts`.
- Keep reusable safety summarization outside the sweep module because the
  retrigger and candidate-validation benchmarks also need it. Rename
  `summarizeListenThresholdSafety` to `summarizeListenSequenceSafety`, or move it
  to `listenBenchmarkSafety.ts`, and update all consumers.
- Move grid, eligibility, ranking, Pareto, replay-parity, and full-sweep tests into
  `listenMatcherSweepBenchmark.test.ts`; leave sequence/replay tests in
  `listenSequenceBenchmark.test.ts`.
- Update `ListenBenchmarkPage.tsx` imports and the package test command.
- Preserve the existing automatic query, browser runner mode,
  `window.listenThresholdSweepResult`, concise export shape, progress semantics,
  and historical profile IDs.

**Verification:** Run both sequence and sweep unit tests, the complete unit suite,
the production build, and one browser threshold-sweep regression. Compare the
baseline signature, grid size `1000`, rejected count, recommendation ID, Pareto
IDs, and concise JSON with the pre-extraction result.

**Complete when:** `listenSequenceBenchmark.ts` contains no exhaustive-grid or
sweep-ranking logic, the new module owns the search, tests are split by
responsibility, and every measured/exported sweep result is identical.

**Completion evidence:** Commit `7afe957` extracted the exhaustive grid and sweep
ranking to `listenMatcherSweepBenchmark.ts`, split the tests, retained the browser
contract, and reproduced the existing Direct sweep result.

### Task 03 — Migrate production and benchmark consumers to the registry

**Status:** Completed August 17, 2026. **Prerequisites:** Tasks 01-02 complete.

**Objective:** Make production, trace replay, and all benchmarks consume the same
profile representation while keeping `baseline-v1` active everywhere that
previously meant current production.

**Work:**

- Replace the threshold object in `onlineAmtOutput.ts` with registry conversion or
  a compatibility export derived from `baseline-v1`.
- Update `App.tsx` to construct `ExactChordMatcher` from the resolved default
  profile. Do not add calibration persistence or UI in this task.
- Update isolated, sequence, dynamics, articulation, reset, retrigger, and sweep
  code to import the shared profile type and explicit named profile needed by each
  operation.
- Require explicit `baseline-v1` in historical parity checks. Use the
  production-default pointer only for current-production behavior.
- Include the effective profile ID and complete values in new diagnostic objects
  where it can be added without changing historical concise contracts.
- Remove duplicate profile interfaces and matcher-option conversion functions
  after all consumers compile.

**Verification:** Run the full unit suite and production build. Start listen mode
in a local smoke test and confirm the effective options equal the former
`onlineAmtChordMatcherOptions`. Run canonical Direct and Tone isolated smokes and
confirm their decoded structure, discrete recognition, and latency identities are
unchanged under the Task 04 Float32/process-local PCM rules.

**Complete when:** There is one profile type and conversion path, production still
uses `baseline-v1`, historical operations explicitly identify their reference
profile, and no behavior or measured baseline changes.

**Completion evidence:** Commit `4db8cf7` migrated production and benchmark
consumers to the shared registry while preserving `baseline-v1` behavior.

### Task 04 — Establish exact baseline replay and build parity

**Status:** Completed August 17, 2026. **Prerequisites:** Task 03 complete.

**Objective:** Create the invariant that later candidate results differ only
because of profile values, not because Tasks 01-03 changed rendering, inference,
decoding, replay, or reporting.

**Work:**

- Add event-for-event baseline parity assertions for isolated trials and
  continuous sequence traces.
- Add baseline profile metadata and parity assertions to dynamics and articulation
  trace replay.
- Compare events, attacks, classifications, advancement timestamps, safety
  counters, latency values, decoded-structure identity, within-capture PCM/trace
  identity, and summary fields.
- Retain explicit expected constants for the canonical Splendid `mp` Direct/Tone
  smoke so shared-code drift cannot update both sides of a self-comparison.
- Record a post-refactor parity entry in the listening benchmark report; do not
  replace historical measured sections.

**Verification:** Run the full unit suite, production build, canonical paired
isolated smoke, sequence regression, dynamics smoke, articulation regression, and
the extracted 1,000-profile sweep. Within one capture/replay comparison is exact.
Across fresh browser processes, require identical discrete events,
decoded-structure hashes, and outcomes while permitting continuous values to
differ by at most one Float32 ULP; raw PCM hashes are diagnostic, not a
cross-process gate.

**Complete when:** All baseline parity assertions pass and the report records that
the registry/extraction refactor produced no recognition, safety, latency,
within-capture PCM, decoded-structure, or export changes.

**Completion evidence:** Commit `1ec55a1` added baseline parity coverage and
commit `b476432` pinned the recorded reference identity. The work proved exact
within-capture replay and established decoded-structure/discrete identity plus a
one-Float32-ULP continuous tolerance for fresh browser processes, whose raw PCM
last bits and FNV hashes can vary.

### Task 05 — Diagnose and preserve the Tone plus Salamander `v05` case

**Status:** Completed August 17, 2026. **Prerequisites:** Task 04 complete.

**Objective:** Determine whether the reported deterministic `v05` advancement is
a real matcher failure or an attribution error, then make the result a permanent
regression before comparing more sensitive profiles.

**Work:**

- Reproduce only the Tone plus Salamander `v05` constant-layer run with
  `baseline-v1`, verify its decoded-structure/discrete identity against the
  measured dynamics report, and record its process-local PCM hash diagnostically.
- Identify the target index, source attack, generation, advancement time, target
  and played pitches, note events, active evidence, carry-over state, and relevant
  confidence values.
- Audit attribution windows separately from matcher behavior. Do not loosen a
  classification rule merely to remove the count.
- If it is a matcher failure, minimize the necessary decoded frames into a compact
  trace fixture. If it is attribution-only, create a minimal attribution fixture
  and document why the matcher result was correct.
- Add the minimized case to reusable sequence safety and replay all three named
  profiles against it.
- Update the dynamics/listening report with the classification and regression
  identity.

**Verification:** The focused browser run reproduces the original case, the
minimal fixture reproduces the same classification, all relevant unit tests pass,
and the safety summary exposes the case for every named profile.

**Complete when:** The event is explained, minimized, regression-tested, and can
no longer be omitted from candidate performance reporting.

**Completion evidence:** Commit `26da7a5` diagnosed the case and added the compact
regression; commit `7e88e38` documented it. It is a late advance of the correct
repeated `[62, 74, 82]` target, not a false advance. `baseline-v1` recovers on the
third repetition at 25,440 ms; `balanced-v1` and `sensitive-v1` recover on the
second at 24,448 ms. All keep false/skipped/duplicate counts at zero.

### Task 06 — Diagnose the remaining Tone 333 ms false advancement

**Status:** Completed August 19, 2026. **Prerequisites:** Task 05 complete.

**Objective:** Explain and pin the one Tone sequence false advance at 333 ms that
remains outside the dedicated safety families, so the next threshold search
cannot optimize around an unknown safety event.

**Inputs:** Use the exact measured Tone sequence corpus, `baseline-v1`, the
current attribution implementation, and the benchmark commit/hash recorded in
`tools/online_amt/LISTEN_BENCHMARK.md`. Do not reuse the `v05` explanation unless
the forensic evidence independently proves the same mechanism.

**Work:**

- Reproduce the focused run and identify its renderer, sequence family, speed,
  target index, causing attack, advancement timestamp, source-to-target distance,
  target and played pitches, generation, note/onset/active evidence, carry-over,
  and confidence values.
- Determine whether the event is a genuine matcher false advance, a skipped or
  duplicate advance mislabeled as false, a late advance of correct content, or an
  attribution defect. Preserve the original classification until the evidence
  justifies a change.
- Minimize the necessary decoded frames and target schedule into a deterministic
  regression fixture. Pin the decoded-structure identity and discrete outcome;
  do not require cross-process raw PCM hash equality.
- Replay `baseline-v1`, `balanced-v1`, `sensitive-v1`, and all 1,000 grid profiles
  against the fixture. Record which safety counter and source attribution each
  profile produces.
- Add the regression to reusable safety summarization and update the listening
  report. If the event exposes an attribution bug, correct the rule in this task,
  rerun every affected historical suite, and document all changed counts.

**Verification:** Run the focused browser case twice in fresh processes, the
minimal fixture tests, sequence/sweep tests, full unit suite, and production
build. Require stable decoded-structure/discrete identity and no unexplained
change in historical safety, ordered, or independent metrics.

**Complete when:** The event has a documented classification and causal attack,
the minimized fixture reproduces it, every grid profile is assessed against it,
and no future safe-candidate claim can omit it.

**Completion evidence:** The event is `course-clear-27` target 8, the single note
`[56]`, at 333.33 ms under `bundled-piano-tone-v2`. It is a genuine matcher false
advance and its classification is unchanged. The target's own attack produced an
onset of 0.531, below `baseline-v1`'s 0.60 gate, so a one-note target stayed
armed across five following attacks. The extra-note gate refused every attack
that offered pitch 56 alongside a confident fresh extra, including `[56, 63]`
whose 63 arrived at 0.983. It could not refuse `[56, 68, 75]`, where 68 was
carry-over from the previous chord and 75 produced no onset at all, leaving 56 as
the only fresh evidence; the target advanced at 4,768 ms, 1,881 ms late, from an
attack that played a different chord. Attribution is correct and no rule changed.

`listen-sequence-case` was added as the sequence counterpart of
`listen-dynamics-case`, and the case is committed as
`tone-course-clear-333-shared-pitch-false-advance`: 79 decoded frames covering
targets 7-13, pinned to decoded-structure hash `ab28401f` and to the exact
advancement and causing attack. Fixture matching now includes the speed a case
was measured at. All 1,000 grid profiles were replayed against it: 570 reproduce
the pinned advance, 240 never stall and advance in order, 114 falsely advance the
same target one chord earlier under a 0.99 extra-note gate, and 76 cascade into
three false advances and are rejected as less safe than baseline. Both
first-generation candidates fall in the 240 region. The Direct sweep moves from
680 to 700 rejections and its frontier from 15 to 14; the Tone sweep moves from
500 to 538 rejections with an unchanged frontier; both recommendations are
unchanged. `tools/online_amt/LISTEN_BENCHMARK.md` records the full diagnosis.

### Task 07 — Freeze the multi-domain discovery and confirmation protocol

**Status:** Completed August 19, 2026. **Prerequisites:** Task 06 complete.

**Objective:** Predeclare exactly which existing traces may tune thresholds, which
remain untouched for confirmation, how domains are weighted, and how safe Pareto
candidates are selected.

**Inputs:** Inventory all Direct/Tone sequence traces, isolated corpora, Splendid
and Salamander constant layers, mixed-dynamics runs, articulation traces,
dedicated safety families, the `v05` late fixture, and the Task 06 regression.

**Work:**

- Add a versioned machine-readable manifest, owned by the benchmark layer, that
  assigns every automated trace ID to `discovery`, `confirmation`, or
  `regression-only`. Record renderer, suite, piano, layer/dynamic, articulation,
  sequence family, speed, and fixture version.
- Classify all previously swept Direct and Tone sequence traces as discovery.
  Choose a stratified discovery subset of constant dynamics covering both
  renderers, both pianos, and quiet/medium/loud regions. Include representative
  mixed-dynamics and every articulation category.
- Reserve untouched confirmation traces: the complete isolated correct/wrong/
  ambiguous/omitted-bass corpus, unselected constant layers under each
  renderer/piano, held-back mixed/articulation traces, and all future live trials.
- Put all dedicated safety traces, `v05`, and the Task 06 fixture in
  `regression-only`. They gate every profile but add no positive score.
- Encode hierarchical equal weights
  `renderer -> suite -> piano/articulation/sequence family -> run`. Assert that
  16 Salamander layers do not outweigh four Splendid layers and that a suite with
  more traces receives no extra top-level weight.
- Freeze metric order: hard safety; worst-domain independent recognition;
  equal-domain average independent recognition; ordered prefix and complete
  passages; late-advance count/source distance/attribution delay; latency; then
  distance from `baseline-v1`. Define deterministic ties and Pareto dominance.
- Record the manifest hash, rationale, and the rule that any post-result split,
  weighting, metric, or gate change starts a new discovery/confirmation version.

**Verification:** Add tests for complete one-time trace assignment, required
domain coverage, no discovery/confirmation overlap, hierarchical weight sums,
regression-only zero score weight, deterministic ranking, and manifest hashing.
Run the full unit suite and production build.

**Complete when:** The repository can reject an incomplete, overlapping, or
reweighted manifest, and candidate selection can run without making any new
partition or metric choice after results are visible.

**Completion evidence:** `webapp/src/listenTraceManifest.ts` assigns all 478
automated traces once each: 139 `discovery`, 300 `confirmation`, and 39
`regression-only`, at manifest version 1 and hash `0ed1e71d`. The whole sequence
corpus is discovery because both single-renderer sweeps were observed; discovery
adds one constant layer per piano, renderer, and loudness band (Splendid
`pp`/`mp`/`ff`, Salamander `v03`/`v09`/`v14`), one mixed run per renderer, and
one trace of every articulation category. Confirmation keeps the complete
isolated corpus under both renderers, 27 unselected constant layers, three
held-back articulations, and two held-back mixed runs. The dedicated safety
passages, the Tone Salamander `v05` source run, and both committed regressions
are `regression-only` with weight zero.

Each descriptor records a content key, so the manifest rejects any split that
puts the same rendered passage/instrument/speed in two partitions — which is why
Splendid `mp` is discovery: the articulation matrix's `normal` row renders it.
A committed regression names the run it was minimized from, and a regression
minimized from confirmation evidence is rejected. Weights are hierarchical and
equal across renderer, suite, piano/articulation/family, and run, so 16
Salamander layers equal four Splendid layers and the 268-trace isolated suite
equals the 8-trace articulation suite.

Validation enforces the pinned hash and the exact per-partition, per-suite
census, so an amendment that leaves every structural coverage rule satisfied —
dropping one isolated case, promoting the `v05` run into the scoring corpus,
renaming a weighting domain — is still rejected. Relabelling the version does not
escape those checks: any version other than the one this module declares fails as
`unknown-manifest-version`, so a new round is a reviewed edit to the module's
constants (bumped version, restated census, re-pinned hash) rather than a field
change on a manifest object. The frozen metric order, Pareto dominance, and the profile-ID
tie-break live beside the manifest. Metric values are quantized to a 1e-9 grid
instead of compared with a pairwise tolerance, because a tolerance is
intransitive and would make the ranking depend on candidate input order; safety
is enforced inside the dominance helper as well as the comparator, so an unsafe
candidate never dominates and a safe one always dominates it even when a caller
skips the eligibility filter.

`listenTraceManifest.test.ts` adds 25 tests to the package command, including the
three amendments above, comparator transitivity under all permutations, and
safety-aware dominance; the suite is 305 main-suite tests plus the dynamics
pretest, and the production build passes. No measured browser result changed.

### Task 08 — Recompute and freeze the multi-domain candidate registry

**Status:** Completed August 19, 2026. **Prerequisites:** Task 07 complete.

**Objective:** Search all 1,000 matcher profiles across the frozen discovery
corpus, select a small safe multi-domain Pareto set, and add new immutable
candidate IDs without changing the production default.

**Inputs:** Use only Task 07 `discovery` traces for positive metrics and every
`regression-only` trace for hard safety. Do not read confirmation outcomes while
selecting profiles.

**Work:**

- Extend `listenMatcherSweepBenchmark.ts` to replay every grid profile over the
  manifest and compute per-run, per-leaf-domain, per-suite, per-renderer, and
  overall weighted metrics.
- Reject a profile for any distinguishable false, skipped, duplicate,
  incomplete-carried-bass, wrong/extra-note, or fresh-bass regression. Report
  `v05` late deviations without rejecting unless safety is worse than its pinned
  baseline. Apply the diagnosed Task 06 outcome exactly as its fixture requires.
- Rank eligible profiles by the Task 07 metric order, with independent
  recognition ahead of ordered results. Emit worst-domain values, equal-domain
  averages, cascade-independent deltas, late burden, latency, and baseline
  distance for every frontier profile.
- Select the smallest useful set representing materially different safe Pareto
  tradeoffs. Do not force a predetermined candidate count and do not append only
  the Tone winner. Keep `baseline-v1` in every later comparison.
- Add selected profiles under new immutable versioned IDs and increment the
  registry version. Preserve `balanced-v1` and `sensitive-v1` unchanged as
  first-generation historical entries. Keep
  `DEFAULT_LISTEN_MATCHER_PROFILE_ID = "baseline-v1"`.
- Add dedicated `listen-matcher-multidomain-sweep` and summary browser-runner
  modes. Preserve the original Direct/Tone single-renderer sweep commands and
  results as historical discovery evidence.
- Freeze the resulting candidate-ID list, registry version, manifest hash, sweep
  commit, full result, and concise report before any confirmation replay.

**Verification:** Run manifest/ranking tests, both original single-renderer sweep
regressions, the new weighted multi-domain sweep twice, full unit tests, and the
production build. Require identical frontier IDs, metrics, rejection codes, and
candidate IDs across repetitions; use the Task 04 cross-process identity rules.

**Complete when:** A reproducible safe Pareto candidate set derived from all known
discovery variables exists under new registry IDs, historical IDs are unchanged,
the default is still baseline, and the confirmation data remains unread by the
selection path.

**Completion evidence:** Commit `da418d6`. `listenMatcherSweepBenchmark.ts` now owns a second
search beside the historical single-renderer sweep. `listen-matcher-multidomain-sweep`
captures the 176 `discovery` and `regression-only` traces of manifest version 1
(hash `0ed1e71d`) across both renderers in one process and replays all 1,000 grid
profiles against each captured trace, holding one trace at a time and keeping
per-run metrics. It never captures a `confirmation` trace, and a unit test
asserts that by failing the capture function if it is ever asked for one.

721 profiles are rejected: 680 for a false advance in a dedicated safety family,
500 for not requiring a fresh bass, 500 for a skipped advance, 500 for advancing
the carried-bass triad, 436 for adding a false, skipped, or duplicate advance to
a scored trace that `baseline-v1` handles safely, and 76 for the Task 06
shared-pitch case. Scored traces are gated relative to `baseline-v1` on the same
trace rather than absolutely, because the corpus contains one diagnosed baseline
false advance and an absolute rule would have to reject `baseline-v1` itself.

30 profiles reach the safe Pareto frontier. The materiality rule frozen in code
before the run selected four, registered as `early-open-v2`
(`o0p450-t0p500-a0p200-x0p990-b1`), `steady-open-v2`
(`o0p500-t0p500-a0p200-x0p990-b1`), `early-held-v2`
(`o0p450-t0p500-a0p275-x0p990-b1`), and `steady-held-v2`
(`o0p500-t0p500-a0p275-x0p990-b1`). The leader moves equal-weighted independent
recognition from 83.81% to 86.91%, ordered prefix from 48.61% to 63.24%,
complete passages from 13.66% to 20.37%, late advances from 8 to 2 and the one
scored false advance to 0; it improves 16 of 21 leaf domains and worsens none.
The last two candidates entered on distance from `baseline-v1` and attribution
delay rather than on recognition, and are the conservative end of the frontier.
`early-open-v2` repeats `sensitive-v1`'s values and still received its own
identifier, as this plan requires.

Registry version 2 adds the four candidates and
`LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS` as the frozen Task 08 ID manifest.
`baseline-v1`, `balanced-v1`, and `sensitive-v1` are unchanged and
`DEFAULT_LISTEN_MATCHER_PROFILE_ID` remains `baseline-v1`. The sweep was run
three times in fresh browser processes — twice while measuring and once more on
the final code — and all three exported results are byte-identical, including
all 176 decoded-structure hashes and every continuous metric, so the Float32
tolerance was not needed. Both historical single-renderer sweeps
reproduce their recorded results exactly (Direct 700 rejected, frontier 14,
`o0p450-t0p500-a0p200-x0p990-b1`; Tone 538 rejected, frontier 3,
`o0p500-t0p500-a0p200-x0p970-b1`), and the focused Tone 333 ms case still pins
decoded-structure hash `ab28401f` and baseline's false advance at 4,768 ms while
now replaying seven named profiles instead of three. The unit suite is 313
main-suite tests plus the dynamics pretest, and the production build passes.
`tools/online_amt/LISTEN_BENCHMARK.md` records the full result.

**August 20 evidence repair:** The discovery/regression sweep was rerun without reading
confirmation data after adding the separately pinned musical-corpus identity
`10ae2e0b`. It reproduced 721 rejected profiles, the same 30-profile safe Pareto
frontier, and the same four selected profile IDs. The full 1,000-row result is frozen at
`benchmark-results/listen-matcher-multidomain-sweep-task08.json`; every row includes its
profile, metrics, safety verdict, and rejection codes. Its canonical candidate digest is
`fnv1a-32-canonical-json:53ee8a67`, and the archived file SHA-256 is
`fa09a935ee36b14786659933152bed65498b7433007f888104f79357b7050aeb`.

### Task 09 — Add isolated candidate-matrix replay

**Status:** Completed August 19, 2026. **Prerequisites:** Task 08 complete.

**Objective:** Compare `baseline-v1` and the frozen Task 08 candidates on exactly
the same untouched isolated correct and wrong-note evidence under both renderers,
without feeding results back into threshold selection.

**Work:**

- Change `listenBenchmark.ts` so an isolated trial retains a compact decoded trace
  and can replay a supplied named profile without rerendering or rerunning
  inference.
- Add an adjacent candidate-matrix result for every correct, Course Clear,
  distinguishable-wrong, ambiguous-harmonic, and omitted-bass case.
- Preserve historical single-profile APIs by making their profile explicit rather
  than silently changing them.
- Report profile ID/values, overall and Course Clear advancement, distinguishable
  false advances, ambiguous advances, and p95 latency separately for Direct and
  Tone.
- Add tests proving one trace is reused and generation/timestamp behavior matches
  the ordinary matcher path.

**Verification:** Run isolated profile validation twice under Direct and Tone.
Baseline must reproduce 104/106 and 52/54 for Direct and 100/106 and 48/54 for
Tone. Within each run every profile must share the same trace/PCM object; fresh
processes follow the Task 04 decoded-structure and Float32 identity rules.

**Complete when:** The full frozen candidate matrix has deterministic adjacent
isolated results under both renderers, the data remains tagged `confirmation`,
and no candidate value or discovery choice has changed from those results.

**Completion evidence:** Commit `fffae2f`. `listenProfileValidationBenchmark.ts` now
owns the isolated portion of frozen-candidate validation. It joins the manifest's
268 isolated `confirmation` descriptors to the fixture corpus they name, captures
each fixture once through the historical isolated capture path, and replays that
one retained trace through `baseline-v1` and the four frozen candidates. It
imports neither the sweep nor grid generation, and its candidate column is
`LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS` unless a caller passes a list that is
validated for unknown identifiers, duplicates, and the baseline appearing as a
candidate.

`listenBenchmark.ts` now names the profile of every isolated result instead of
following the production default pointer: `captureIsolatedOnlineAmtBenchmark` and
`runBundledOnlineAmtBenchmark` take an explicit profile that defaults to
`baseline-v1`, `replayIsolatedListenTrace` accepts a registry identifier as well
as bare thresholds, and every `ListenBenchmarkSummary` carries the matcher
identity it was measured under. The legacy spectral path records the chord
matcher's own defaults rather than borrowing a registry identifier it never ran.
`matcherOptionsForListenMatcherProfile` now rejects an unknown identifier instead
of silently converting the default, so a misspelled candidate fails the replay.

Measured with `listen-isolated-profile-validation` at Chrome 151.0.7922.169 on
Linux. `baseline-v1` reproduces the recorded paired baseline exactly — Direct
104/106 and 52/54, Tone 100/106 and 48/54, zero distinguishable false advances,
196 ms and 228 ms p95 — and every fixture's baseline column reproduces its own
capture-time replay. No candidate loses a correct advance. `early-open-v2` and
`steady-open-v2` recover both repetitions of Course Clear measure 3 moment 5
(`[53, 65, 74]`) under both renderers, which the two `held` candidates do not, so
the recovery comes from the 0.20 active-target gate rather than the fresh-onset
gate. All four candidates add exactly one distinguishable false advance: the
omitted-bass fixture `isolated/direct/122` (`[48, 60, 68]` played as `[60, 68]`)
under Direct and `isolated/tone/124` (`[56, 68, 75]` played as `[68, 75]`) under
Tone, each completed by a decoded onset on a bass pitch that was never sounded,
whose confidence the `steady`/`baseline` split places in `[0.50, 0.60)`. Whether
that disqualifies a candidate is Task 12's gate decision; nothing here changed a
candidate value, and the default remains `baseline-v1`.

Two complete runs in fresh browser processes produced byte-identical exports,
including all 268 decoded-structure hashes and every continuous value, so the
Float32 tolerance was not needed. Seven new unit tests cover the frozen column
order and its rejections, the manifest/fixture join, one capture serving every
profile column, refusal of a capture that answers with another fixture or
renderer, per-case-kind and baseline-delta aggregation, and replay matching the
ordinary matcher path's generation and timestamp behavior. The unit suite is 322
main-suite tests plus the dynamics pretest, and the production build passes.
`tools/online_amt/LISTEN_BENCHMARK.md` records the measured matrix.

### Task 10 — Add continuous-sequence candidate-matrix replay

**Status:** Completed August 19, 2026. **Prerequisites:** Tasks 08-09 complete.

**Objective:** Expose complete per-profile sequence diagnostics for the frozen
candidates while honestly retaining the previously swept sequence corpus as
discovery evidence.

**Work:**

- Create the sequence portion of
  `webapp/src/listenProfileValidationBenchmark.ts`.
- Capture each of the 13 families at all six intervals once per renderer, then
  replay the same trace through `baseline-v1` and the frozen Task 08 candidates.
- Preserve independent, ordered, prefix, complete-passage, failure-reason,
  carry-over, latency, backlog, and all safety diagnostics.
- Report deltas from explicit `baseline-v1` per renderer, speed, and family.
- Assert that the candidate list equals the frozen Task 08 ID manifest, contains
  no unknown or duplicate ID, and is independent of candidate count. Do not call
  grid generation or sweep ranking from this module.
- Add tests for trace reuse, per-domain aggregation, baseline delta calculation,
  and rejection of unknown/duplicate candidates.

**Verification:** Run a focused Direct and Tone sequence-validation smoke plus the
unit suite. Confirm all profiles share each run's trace hash and the baseline row
matches Task 04 exactly.

**Complete when:** The full sequence corpus produces deterministic adjacent
candidate-matrix results, every row is labeled as discovery evidence, and the
validation module neither imports the sweep nor searches new values.

**Completion evidence:** Commit `1b4bc36`. `listenProfileValidationBenchmark.ts`
now owns the sequence portion beside the isolated one. It joins the manifest's 156 sequence
descriptors to the passages they name, captures each once through the historical
`captureListenSequenceRun` path, and replays that one retained trace through
`baseline-v1` and the four frozen candidates. It refuses a sequence descriptor
marked `confirmation`, a passage whose family disagrees with its descriptor, and
a capture that answers with another passage, renderer, or speed. Scoring follows
the manifest's `scoreEligible` flag rather than a family name, so the three
dedicated safety passages gate every column through `summarizeListenSequenceSafety`
and are reported in a separate `regressionTotals` column that is never added into
a score. Speeds are filterable for a focused smoke and validated against the
frozen speed list; families are not filterable, because dropping one would drop a
safety gate. The module imports neither the sweep nor grid generation.

Every result carries `evidenceRole: "discovery"` and each row its manifest
partition: both single-renderer sweeps have read this corpus, so no gate may
quote it as confirmation. Reported per profile are totals, per-speed and
per-family totals, the historical `aggregateListenSequenceRuns` speed and
family-speed diagnostics, the reusable safety summary, and deltas from an
explicit `baseline-v1` per renderer, speed, and family, including named gained
and lost complete passages and named ordered-advance regressions.

Measured with `listen-sequence-profile-validation` at Chrome 151.0.7922.169 on
Linux; a paired 156-passage run takes about 140 seconds. `baseline-v1`
reproduces the recorded baselines exactly: adding the gate column to the scored
column gives the August 15 whole-corpus rows (Direct 66/85 ordered and 8/13
complete at 1000 ms, Tone 63/85 and 9/13, 220 ms and 228 ms p95), and the Direct
totals reproduce the August 13 sweep production baseline at 291 / 283 / 199 / 33
and 214.67 ms. `early-open-v2`, whose values are the sweep recommendation's,
reproduces its 308 / 365 / 268 / 43 and 209.33 ms. All four candidates keep every
dedicated safety counter at zero under both renderers and lose no complete
passage; the only ordered regression in 156 passages is one advance on
`sequence/tone/course-clear-27/167ms`, and the only unsafe advance in the scored
corpus is `baseline-v1`'s already diagnosed Tone 333 ms false advance, which
every candidate clears.

Two complete runs in fresh browser processes agree on every recognition,
advancement, classification, latency, backlog, safety counter, and all 156
decoded-structure hashes; only the wall-clock `maximumInferenceMs` maxima differ.
Five new unit tests cover the manifest/passage join and its rejections, one
capture serving every profile column, per-speed and per-family aggregation with
the gate rows excluded from every score, baseline delta arithmetic, and refusal
of an unusable column order or a mismatched capture. The unit suite is 327
main-suite tests plus the dynamics pretest, and the production build passes.
`tools/online_amt/LISTEN_BENCHMARK.md` records the measured matrix.

**August 20 evidence repair:** The complete paired-renderer matrix was rerun twice in
fresh browser processes after late-advance attribution was added. The 156-trace export
is frozen at `benchmark-results/listen-sequence-profile-validation-task10.json` with
18 forensic records naming the manifest trace, target, advance time, causing attack
and pitches, source-to-target distance, and attribution delay. Its archived file
SHA-256 is `e969060b9011d86f1eb7cbb551077fbff69d03a8b01d4b548f499eaba51c927e`;
after excluding only the host-dependent `maximumInferenceMs` field, both runs have
canonical evidence SHA-256
`ed9a336516a26fa2daf6a67314138a47a47beafdc7c20ce86fbe90d5ff11acd0`.

### Task 11 — Add dynamics and articulation candidate-matrix replay

**Status:** Completed August 19, 2026. **Prerequisites:** Task 10 complete.

**Objective:** Extend frozen-candidate validation to the later domains that were
not used to select the original sweep winner.

**Work:**

- Update `listenDynamicsBenchmark.ts` so each constant-layer and mixed-dynamics
  trace is captured once and replayed under `baseline-v1` and every frozen
  candidate.
- Cover four Splendid layers, 16 Salamander layers, both renderers, and all four
  mixed-dynamics runs.
- Extend articulation validation to detached, normal, legato, and
  sustained-shared traces without rerunning inference for each profile.
- Include per-renderer, per-piano, per-layer, mixed-profile, and articulation
  summaries plus baseline deltas.
- Preserve Task 07 discovery/confirmation labels in all results. No aggregate may
  combine the two partitions into a confirmatory metric.
- Integrate the Task 05 `v05` late regression and Task 06 false-advance regression
  into focused and aggregate diagnostics with their distinct semantics.
- Add unit tests for equal-piano aggregation, trace reuse, layer-level regression
  visibility, and candidate metadata.

**Verification:** Run dynamics smoke under both renderers, one complete mixed
suite, articulation regression, full unit tests, and the production build. Every
within-run profile comparison shares the captured trace, and each manifest ID is
present exactly once.

**Complete when:** All dynamics/articulation domains produce deterministic
candidate-matrix results, held-back cases remain identifiable as confirmation,
and no aggregate can hide a renderer, piano, layer, or articulation regression.

**Completion evidence:** Commit `f73a477`. `listenProfileValidationBenchmark.ts` now owns the
dynamics and articulation portion beside the isolated and sequence ones. It joins
the manifest's 52 `dynamics-constant`, `dynamics-mixed`, and `articulation`
descriptors to the passage and instrument they render, captures each once through
the suites' own capture paths — `captureCourseClearDynamicsRun` for the velocity
layers and mixed runs, `captureListenSequenceRun` for the articulations — and
replays that one retained trace through `baseline-v1` and the four frozen
candidates. It refuses a descriptor whose piano, layer, dynamic profile, or
articulation disagrees with the passage, and a capture that answers with another
run, renderer, passage, speed, or instrument.

`listenDynamicsBenchmark.ts` now names the profile of every dynamics run instead
of following the production default pointer: `CaptureCourseClearDynamicsOptions`
takes an explicit `profileId` defaulting to `baseline-v1`, each run result
carries that identifier and its thresholds, and the historical check that the
production default still equals the baseline entry is kept as its own assertion.

Because manifest version 1 split these suites deliberately, no aggregate is
allowed to read as confirmation on its own. Every reported group — whole corpus,
partition, suite, piano, piano-and-partition, and one leaf per velocity layer,
mixed run, and articulation — carries the partitions it spans and an
`evidenceRole` of `discovery`, `confirmation`, or `mixed`, and
`listenValidationEvidenceRole` refuses to give a `regression-only` row a role at
all. Equal-piano aggregates are computed per suite so each stays comparable with
the matrix that recorded it, and every piano lists its worst constant layer.
Safety spans every partition — unsafe advances relative to `baseline-v1` on the
identical trace, plus both committed regressions replayed under the same profile
— while scores never include a gate row, and late advances are reported beside
safety rather than as safety.

Measured with `listen-dynamics-profile-validation` at Chrome 151.0.7922.169 on
Linux; a paired 52-run matrix takes about six minutes. `baseline-v1` reproduces
the recorded August 16/17 constant-layer matrix exactly once the Tone `v05` gate
row is added back (Direct 488/540 independent and 138/540 ordered; Tone
467+25 = 492/540 and 163+23 = 186/540, one complete passage and one late advance
each), and the Direct equal-piano row reproduces the recorded cross-piano
aggregate to the digit at 90.86% / 45.49% / 12.50%. On the untouched
`confirmation` rows the candidates move Direct independent recognition from 90.5%
to 94.2% and ordered advancement from 17.8% to 26.9%, and Tone from 90.7% to
95.6% and 33.8% to 64.8%. No leaf, piano, partition, suite, or renderer row
regresses under any candidate; three of Direct's 26 leaves and twelve of Tone's
25 move, and four Tone leaves recover only under the 0.20 active-target gate,
which is the only measured difference between the `open` and `held` candidates
here. Every profile reports 0/0/0 false, skipped, and duplicate advances under
both renderers with no introduced unsafe row and no committed regression worse
than its baseline replay; the `v05` gate row reproduces its diagnosed behavior,
with `baseline-v1` advancing target 23 at 25,440 ms and every candidate advancing
it at 24,448 ms.

The historical single-profile commands were re-run against the same code:
`listen-dynamics-mixed` reproduces its recorded 94.4% / 42.6% and 90.7% / 31.5%
with zero safety events, and `listen-dynamics-case-tone salamander v05` still
reports 25/27 independent, 23/27 ordered, the pinned `baseline-v1` advance at
25,440 ms, and decoded-structure hash `b043076d`.

Two complete runs in fresh browser processes agree on all 52 decoded-structure
hashes and every recognition, advancement, group total, delta, equal-piano rate,
and safety value, with byte-identical console summaries; only the rendered
peak/RMS diagnostics and the wall-clock `maximumInferenceMs` maxima differ. Each
suite run on its own reproduces the corresponding 195, 20, and 40 leaf rows of
the full run. Five new unit tests cover the manifest join and its rejections, one
capture serving every profile column with frozen candidate metadata, refusal of a
capture that answers with another run, renderer, or instrument, equal-piano
aggregation weighting four Splendid layers like sixteen Salamander ones, and the
leaf visibility of a layer regression that a corpus aggregate nets out. The unit
suite is 332 main-suite tests plus the dynamics pretest, and the production build
passes. `tools/online_amt/LISTEN_BENCHMARK.md` records the measured matrix.

**August 20 evidence repair:** The complete paired-renderer matrix was rerun twice in
fresh browser processes after late-advance attribution was added. The 52-trace export
is frozen at `benchmark-results/listen-dynamics-profile-validation-task11.json` with
25 non-overlapping profile-level forensic records, including the Tone Salamander
`v05` regression. The regression-case view repeats 9 of those records, producing 34
serialized instances without adding evidence. Its
archived file SHA-256 is
`1028cd52275c1c91838c8b920ef2d90324ff180b38a88096dba6408970890042`;
after excluding only host-dependent `maximumInferenceMs` and floating-point audio
diagnostics `peak` and `rms`, both runs have canonical evidence SHA-256
`8b5039ac0fe0d5396cd02ee626800c075f3dffa101abd6579827d289570a0bc6`.
The rerun preserves the existing discovery, confirmation, and regression-only labels
and performs no profile selection.

### Task 12 — Build the unified production-candidate gate and automation

**Status:** Completed August 19, 2026. **Prerequisites:** Tasks 09-11 complete.

**Objective:** Combine isolated, sequence, dynamics, articulation, and known
safety results into one deterministic eligibility decision without selecting new
parameter values.

**Work:**

- Complete `listenProfileValidationBenchmark.ts` with result types and gate
  evaluation for the frozen Task 08 candidate matrix.
- Implement all gates in the Automated acceptance gates section: replay integrity,
  zero dedicated safety failures, no new dynamics/articulation safety event,
  Direct at least 104/106 and 52/54, Tone at least 101/106 and 52/54, p95 below
  400 ms, per-speed independent non-regression, per-renderer ordered/complete
  non-regression, per-renderer/piano dynamics non-regression, and visible
  layer-level losses. Apply safety gates across every partition. Label sequence
  and other discovery non-regression gates as discovery-consistency evidence;
  apply isolated and held-back dynamics/articulation release gates only to Task 07
  confirmation data so the report cannot present tuning data as generalization.
- Gate false/skipped/duplicate/incomplete-bass regressions as safety failures.
  Report `lateAdvanceCount`, source distance, and attribution delay separately;
  do not reject an earlier correct recovery such as `v05` solely for deviating
  from baseline.
- Make each failed gate return a stable code, affected domain IDs, baseline value,
  candidate value, and explanatory text.
- Add `listen-profile-validation` and
  `listen-profile-validation-summary` browser-runner modes while preserving all
  historical commands.
- Add unit tests for every pass/fail boundary and for `no-safe-candidate`.

**Verification:** Run synthetic gate unit tests, the complete unit suite,
production build, and one end-to-end summary smoke. Verify the summary includes
profile values, all domain identities, safety counts, and gate reasons.

**Complete when:** One command evaluates the frozen candidates against all
automated domains and returns eligibility without performing a parameter search or
mutating the production default.

**August 20 handoff amendment:** Task 13 requires the process-local PCM and raw
trace hashes to be recorded diagnostically, and the unified export carried only
decoded-structure hashes and outcome digests, so the requirement had no field to
name. Each captured trace now carries `processLocalPcmHash`, the FNV-1a hash of
the PCM it was rendered from, and `processLocalTraceHash`, the FNV-1a hash of the
complete decoded trace including confidences and raw scores. Both are required to
be present and well formed — every replay matrix recomputes the audio signature
from the retained waveform and refuses a trace that cannot supply it or no longer
matches it, and the verifier refuses an archive whose captured traces do not carry
them — and both are excluded from cross-process equality and from each
domain's `identityDigest`, because Task 04 measured that neither survives a fresh
browser process. This amendment changes no candidate value, gate, corpus, or
threshold, and landed at commit `85bf432`, before any Task 13 measurement, so
both repetitions run on one commit. Six new tests cover it: that each matrix records the hashes of
the trace it read, that a trace which cannot supply them is refused by all three,
that the corpus identity digest is unmoved by them, that the verifier refuses an
archive whose captured trace records no PCM hash, that it refuses one whose raw
trace hash is a placeholder rather than a measurement, and that two repetitions
differing on every process-local hash still compare equal. The unit suite is 464
tests including the evidence verifier's, plus the dynamics pretest, and the
production build passes.

### Task 13 — Execute the frozen automated confirmation

**Status:** Completed August 21, 2026. **Prerequisites:** Task 12 complete.

**Objective:** Produce the confirmatory automated evidence used in the production
decision.

**Work:**

- Record and freeze the preflight record before the first run. A repetition is
  only evidence if a reader can tell what it measured, so the record names the
  measured commit and that its worktree was clean; the Chrome executable and its
  exact version, the operating system, and the Node version; the model path and
  its SHA-256, not merely its filename; the profile registry version, the
  candidate values, the renderer identifiers, the manifest and corpus hashes, the
  eighteen gates, the exact commands below, and the expected historical baseline.
  Both runs, the unit suite, and the production build use that one clean commit
  and that one environment. Any change to source, model, renderer, fixture, gate,
  or browser version restarts both repetitions rather than amending one.
- Run the complete `listen-profile-validation` matrix twice on a clean local
  benchmark server, started from `webapp` with `npm run dev:wasm-benchmark`.
  The archive path is passed through the environment, because for this command
  the positional arguments after the corpus filter are read as corpus speeds and
  dynamics suites (`tools/online_amt/run_browser_benchmarks.mjs`), and a path
  placed there would narrow the matrix into a focused smoke instead:

  ```bash
  LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-profile-validation-task13-run1.json \
    node tools/online_amt/run_browser_benchmarks.mjs \
    http://127.0.0.1:5174/online-amt-benchmark.html \
    listen-profile-validation

  LISTEN_BENCHMARK_OUTPUT_PATH=benchmark-results/listen-profile-validation-task13-run2.json \
    node tools/online_amt/run_browser_benchmarks.mjs \
    http://127.0.0.1:5174/online-amt-benchmark.html \
    listen-profile-validation
  ```

  Record the SHA-256 of both archived files, and the canonical comparison digest
  the `--compare` command below reports, once the runs are complete.
- Compare decoded-structure identities, discrete outcomes, summaries, gate codes,
  failure identities, and recommendation inputs. Every captured trace carries its
  process-local `processLocalPcmHash` and `processLocalTraceHash` as required
  diagnostics; both are excluded from cross-process equality, and neither enters
  the domain `identityDigest` a repetition is compared on first.
  Compare the two archives with
  `node tools/online_amt/verify_listen_benchmark_evidence.mjs --compare <first-run.json>
  <second-run.json>`; this canonical comparison excludes only host-dependent
  `maximumInferenceMs`, floating-point audio diagnostics `peak` and `rms`, and
  those two process-local hashes.
  That command refuses either file unless it is one complete `listen-profile-validation`
  run of the frozen matrix — `evidenceComplete`, registry version 2, `baseline-v1`
  plus the four frozen candidates at their frozen threshold values, all eighteen
  gates with their stated requirements, all three domains under both renderers,
  268/156/52 traces, manifest 1 / `0ed1e71d` / `10ae2e0b`, one outcome row per
  captured trace per profile column, and the decision itself — the three measured
  matrices, each candidate's eighteen gates all applied, each satisfying
  `passed === (applied && failures.length === 0)` and reading exactly the rows a
  complete matrix reads for it, every failure naming its rows, its scalar baseline
  and candidate values, and its reason, the per-role failure counters recomputed
  from them, no layer-loss waiver, and an eligibility set and recommendation that
  follow — so two repetitions of a narrowed smoke, of a
  differently configured matrix, of an export truncated to its identities, or of a
  report whose verdicts do not follow from its own gate outcomes can never be quoted
  as this task's evidence.
  Discrete outcomes are compared through the archive's per-trace, per-profile
  outcome digests, which read each expected pitch's attack type, evidence times,
  and qualification as well as the target-level result, so an advancement that
  moved, changed classification, was credited to another attack, or qualified on
  different notes is a mismatch even when every aggregate count holds.
- Do not alter candidate values, fixtures, attribution, or gates after viewing the
  first run. Any such change invalidates both repetitions and restarts this task.
- Record Direct/Tone, speed/family, piano/layer, mixed-dynamics, articulation,
  `v05`, the Task 06 false regression, latency, late-advance, and safety results in
  the listening report. Clearly label discovery versus confirmation evidence.
- Mark each candidate automated-eligible or rejected with exact gate reasons. Do
  not change the production default in this task.

**Verification:** Both repetitions satisfy Task 04 cross-process parity, baseline
parity passes, the full unit suite/build pass on the measured commit, and the
report contains enough metadata to reproduce the run: the frozen preflight record,
the archived SHA-256 of each run, and the canonical comparison digest they share.

**Complete when:** The frozen automated confirmation matrix is repeated,
documented, and yields a stable eligibility set without any post-result retuning.

**August 21 execution record:** The preflight record was frozen before the first
repetition and is reproduced in `tools/online_amt/LISTEN_BENCHMARK.md`. Both
repetitions, the 464-test unit suite, and the production build ran at commit
`456dea2` with a clean worktree, Chrome 151.0.7922.169 on Ubuntu 26.04, Node
v24.13.0, and model `online_amt_streaming.onnx`
(SHA-256 `a77be8262d3742ce4d9e7d29146d8b17f5755650a7d2aee952bf5bf5ed190ac4`).
Nothing was changed after the first run was viewed.

The two archives are `benchmark-results/listen-profile-validation-task13-run1.json`
(SHA-256 `3ac11d4a…5d38d3`) and `-run2.json` (SHA-256 `28a170b8…01daf79`); their
shared canonical comparison digest is `8acc59b1…336c65e2`. The verifier accepted
both as complete frozen repetitions and reported them equal. Cross-process parity
holds in the Task 04 sense: 311 of the 476 captured traces recorded different
process-local PCM and raw-trace hashes in the second process, while every
decoded-structure identity (`bff20df8`, `e9f09643`, `bfe48fdc`), every outcome
digest (`be407330`, `2cfc6561`, `b57ea970`), and all 2,380 discrete outcome rows
matched. Baseline parity passed in every domain, and `baseline-v1` reproduced the
recorded isolated matrix exactly: Direct 104/106 and 52/54, Tone 100/106 and
48/54.

The eligibility set is empty and the recommendation is `no-safe-candidate`. All
four candidates are rejected on held-back isolated `confirmation` rows:
`safety-isolated-false-advance` for every one of them, because each advances one
omitted-bass fixture per renderer (`isolated/direct/122`, `isolated/tone/124`)
that `baseline-v1` refuses, plus `release-isolated-course-clear` for all four
(Tone 50/54 for the open pair, 48/54 for the held pair, against a 52/54 floor)
and `release-isolated-recognition` for `early-held-v2` and `steady-held-v2`
(Tone 100/106 against a 101/106 floor). No candidate failed a replay-integrity,
sequence, dynamics, latency, or discovery-consistency gate; every candidate
cleared the Task 06 Tone false advance and left the `v05` case a late recovery
with zero unsafe advances. `DEFAULT_LISTEN_MATCHER_PROFILE_ID` was not changed,
and the registry was not touched.

Task 16 therefore has no automated-eligible profile to roll out from this
generation. Selecting different thresholds in response to these numbers would be
post-result retuning; a further candidate set requires a new discovery round
whose search accounts for isolated omitted-bass evidence.

### Task 14 — Build the structured developer live-input harness

**Status:** Required. **Prerequisites:** Task 13 complete.

**Objective:** Replace the under-specified manual counter with a privacy-preserving
trace capture and candidate-matrix replay tool suitable for acoustic and digital
validation.

**Work:**

- Replace or extend the manual section in `ListenBenchmarkPage.tsx` with session
  and trial metadata defined in the Live-input validation harness section.
- Capture target pitches, deliberately played pitches, expected correctness,
  ambiguity, source/setup labels, register, chord size, dynamic, articulation,
  tempo, room/noise label, and trace-clock latency.
- Capture target-independent decoded frames once and replay `baseline-v1` beside
  every automated-eligible candidate; do not repeat a performance per profile.
  Take the profile columns from a frozen eligibility-manifest artifact — the
  confirmation task's output, which references its candidate manifest's digest and
  marks each candidate automated-eligible or rejected — rather than naming a
  particular round's candidates here. The harness must be generic across rounds,
  so it reads whichever eligibility manifest the confirmation task most recently
  froze, and it must not read or write the candidate manifest.
- Keep data in memory until an explicit export. Export decoded events/confidences
  and entered metadata only; exclude raw audio buffers, raw device IDs, and
  manufacturer/serial identity.
- Add an explicit `listen-live-calibration-export` mode or export action that does
  not run automatically.
- Add unit tests for schema validation, trace reuse, profile results, redaction,
  reset/clear behavior, and malformed trial rejection.

**Verification:** Complete one microphone smoke with silence, one correct note,
and one deliberate wrong note. Inspect the exported JSON and prove it contains no
PCM/audio buffer or raw device identifier. Run unit tests and build.

No eligibility manifest exists yet — the first is emitted by Task 28 — so this task
builds and verifies against a fixture chain of all three artifacts. A two-artifact
fixture will not do, because every candidate manifest requires a
`task26EvidenceDigest` and that link would dangle:

1. A schema-valid Task 26 ablation artifact recording terminal outcome
   `bass-axis-unsupported` reached by the stop rule accepting no ablation, which is
   the simplest coherent root.
2. An empty candidate manifest carrying that artifact's digest as
   `task26EvidenceDigest`, the same `task26TerminalOutcome`, and `notRunReason` of
   `no-ablation-accepted`.
3. An eligibility manifest under `runStatus: "not-run-no-confirmable-candidate"`
   repeating that reason and referencing the candidate manifest's digest.

That is a real artifact shape rather than a synthetic one: it is exactly what Tasks
26 through 28 emit when the round has nothing it can both register and confirm. The
fixture tests must verify that both digest links resolve and that the three
artifacts agree semantically — one terminal outcome, one reason, no candidate
entries, no confirmation-evidence fields — so a fixture satisfying each schema in
isolation while disagreeing across the chain fails here rather than in Task 28.

No artifact in the chain may carry `baseline-v1`, because the harness adds the
baseline column itself while an eligibility manifest describes candidates only;
putting the baseline in the manifest would define a second, conflicting schema. The
fixture still exercises the schemas, the `runStatus` branch, the full digest chain,
and a one-column smoke. That work may run in parallel with Tasks 22-27.

**Complete when:** A single real performance produces reproducible frozen-matrix
matcher results and a complete redacted export suitable for the live release
corpus.

Completion is conditional on what the confirmation task produces. If Task 28
records no automated-eligible candidate, the fixture smoke completes this task,
because no live corpus will be collected from it. If Task 28 records one or more,
this task stays open until the smoke has been repeated against that frozen
eligibility manifest with its real profile columns, and that repeat is a
prerequisite of Task 15 rather than a step inside it.

### Task 15 — Execute the acoustic and digital live validation corpus

**Status:** Recorded `no-safe-candidate` on August 22, 2026 and not executed for
this generation of candidates; required again as soon as a discovery round
produces an automated-eligible profile. Requires a person, instruments, and
microphone setups.
**Prerequisites:** Task 14 complete and at least one automated-eligible candidate
on the current round's frozen eligibility manifest. Round one recorded
`no-safe-candidate` against Task 13 and proceeded to Task 16; the same rule now
applies to Task 28 and Task 29. This task is not bound to any one round's
candidates — it replays whichever eligibility manifest the most recent confirmation
task froze.

**Objective:** Test whether automated-eligible candidates remain safe and useful
under real instrument, microphone, room, register, dynamics, chord, articulation,
and tempo variation.

**Work:**

- Freeze a trial manifest before recording. Include at least one acoustic and one
  digital piano, preferably two microphone/room setups.
- Include low/middle/high single notes at soft/medium/loud dynamics; dyads,
  triads, and larger chords; repeated notes/chords; shared bass/upper notes;
  detached/normal/legato transitions; and playable 1000/500/333/250 ms passages.
- Include in every setup a repeated-identical-chord trial that enters with carried
  upper voices and a new bass, then repeats the full chord, plus its omitted-bass
  and distinguishable-wrong counterparts. Report source distance and attribution
  delay under Task 24's frozen vocabulary in addition to the ordinary live gates.
- Include deliberate wrong single notes, wrong chord members, added notes, omitted
  bass, and a short silence/noise segment for every setup.
- Capture each performance once and replay all eligible named profiles plus
  `baseline-v1`.
- Keep source/setup results separate. Report correct advancement, independent and
  ordered behavior, latency, false/skipped/duplicate/incomplete-bass safety, and
  failure classifications.
- Export and archive only the redacted decoded trace/metadata files approved in
  Task 14. Document environmental limitations and incomplete trials.

**Verification:** Validate every export against the schema, reproduce matcher
summaries from each export, and independently review every safety event or
ambiguity. Confirm no source/setup is hidden by an aggregate.

**Complete when:** Both acoustic and digital results are reproducible and
documented, each candidate has explicit live gate outcomes, and the evidence is
ready for the selection rule.

### Task 16 — Select and roll out the global production profile

**Status:** Completed August 22, 2026. **Prerequisites:** Tasks 13 and 15
complete, or Task 13 has already produced `no-safe-candidate`; Task 13 produced
`no-safe-candidate` on August 21.

**Objective:** Make one auditable global-default decision and establish a rollback
baseline.

**Work:**

- Apply the Candidate selection rule in this plan: live safety, live correctness,
  automated independent recognition, ordered/complete behavior, latency, then
  distance from baseline.
- For an effective tie, prefer the smaller distance from `baseline-v1`; do not
  prefer a historical ID merely because it predates the multi-domain candidates,
  and do not select any profile solely for cascade-amplified ordered gains.
- If no profile passes every required automated and live gate, record
  `no-safe-candidate`, leave `DEFAULT_LISTEN_MATCHER_PROFILE_ID` at `baseline-v1`,
  document blockers, and finish this task without a threshold change.
- Otherwise change only `DEFAULT_LISTEN_MATCHER_PROFILE_ID` to the selected named
  profile. Keep `baseline-v1` available for rollback and historical replay.
- Update local diagnostics, README, benchmark index, and listening report with the
  selected ID, exact evidence, known limitations, and rollback instruction.
- Do not add calibration persistence or UI in this task.

**Verification:** Run full unit tests, production build, canonical paired isolated
smoke, complete sequence validation, dynamics smoke, and selected-profile safety
regressions. Confirm ordinary listen mode reports and uses the selected ID.

**Complete when:** Production either uses one fully validated named default or
explicitly retains baseline with `no-safe-candidate`; the decision is documented,
and rollback requires changing only the default ID.

**August 22 decision record:** The decision is `no-safe-candidate` and
`DEFAULT_LISTEN_MATCHER_PROFILE_ID` remains `baseline-v1`. The registry, every
profile value, every gate, and every fixture are untouched; the pass changed
documentation and one registry comment only.

The Candidate selection rule was applied in its stated order and stopped at its
first step. Task 13 left the eligibility set empty, so no profile reached the
ranking, and no tie-break on distance from `baseline-v1` was needed. The Task 15
live corpus was not collected: its own prerequisite makes it conditional on an
automated-eligible candidate, and live sessions for four profiles already
rejected on held-back isolated evidence could not have made any of them
shippable. The live outcome is recorded as `no-safe-candidate` rather than as
live evidence.

The blockers are recorded per gate: `safety-isolated-false-advance` for all four
candidates on `isolated/direct/122` and `isolated/tone/124`,
`release-isolated-course-clear` for all four against the fixed 52/54 Tone floor,
and `release-isolated-recognition` for `early-held-v2` and `steady-held-v2`
against the fixed 101/106 Tone floor. The known limitations of the retained
default are recorded beside them: it keeps the Task 06 Tone 333 ms false advance
that every candidate cleared, sits at 94.3% isolated correct advancement under
Tone, and is the least sensitive profile measured.

Verification ran on the development Windows machine at commit `65da882` with
Chrome 152.0.7977.55 on Windows 11 (10.0.26200), Node v22.12.0, and the unchanged
model (SHA-256 `a77be8262d…d190ac4`, re-hashed locally). The 472-test unit suite,
its two-test dynamics pretest, and the production build pass. The canonical paired isolated smoke matched its
recorded baseline under both renderers. The complete 156-trace sequence
validation and the 52-trace dynamics and articulation matrix verified trace reuse
and baseline parity and reproduced every recorded August 19 row for all five
profile columns under both renderers, with the dedicated safety counters at zero
everywhere. Both committed regressions reproduce from rendered audio —
decoded-structure hashes `b043076d` and `ab28401f` — with `baseline-v1`
satisfying each pinned outcome. Every decoded-structure hash and discrete outcome
reproduced on a different browser build and operating system from the frozen
archives, while the rendered `peak`/`rms` diagnostics differed in their last bits,
which is the Task 04 identity rule behaving as specified. Ordinary listen mode
resolves and reports `baseline-v1`: the application builds its matcher from
`resolveEffectiveListenMatcherProfile`, and the Diagnostics panel prints the
effective identifier. `tools/online_amt/LISTEN_BENCHMARK.md` records the decision,
its evidence, and the rollback instruction; the README and benchmark index name
the shipped identifier.

### Task 17 — Run the calibration feasibility experiment and make a go/no-go decision

**Status:** Required research decision. **Prerequisites:** Tasks 15 and 29
complete, and Task 29's versioned approved-profile list holds at least one entry
besides `baseline-v1`. Registry membership does not satisfy this: the registry
retains every historical and rejected profile, so only the approved list counts.
Task 24 scopes this experiment but does not satisfy its prerequisite either —
renderer and piano are proxies for an acoustic path rather than instruments, and
its archive is discovery evidence.

**Objective:** Determine whether selecting an approved profile per instrument/setup
generalizes better than the global default on untouched live trials.

**Work:**

- Freeze balanced calibration and confirmation partitions for every live session;
  each partition must cover register, dynamics, chord size, transitions, and
  negative cases.
- On calibration partitions, eliminate profiles with any distinguishable false,
  skipped, duplicate, or incomplete-bass advance, then choose by correct
  advancement, latency, and distance from the global default.
- Evaluate the chosen profile on the untouched confirmation partition. Do not
  change the selection algorithm after seeing confirmation results.
- Report selection frequency, repeat-session stability, confirmation gain over
  the global default, safety, oracle regret, and correlations with source, room,
  dynamics, and register.
- Produce exactly one conclusion: `calibration-justified` when repeatable held-out
  benefit exists without safety loss, or `fixed-profile-sufficient` otherwise.
- Document the result in a focused calibration report linked from the benchmark
  index. Do not build user-facing calibration in this task.

**Verification:** Recompute all selections and confirmation summaries from the
redacted live exports using a deterministic unit/CLI path. Confirm calibration and
confirmation partitions never overlap.

**Complete when:** The repository contains a reproducible go/no-go conclusion. A
`fixed-profile-sufficient` result explicitly closes Tasks 18-20 as skipped; a
`calibration-justified` result authorizes them.

### Task 18 — Implement compatible calibration persistence and profile resolution

**Status:** Conditional on Task 17 returning `calibration-justified`.
**Prerequisites:** Task 17 complete with that exact conclusion.

**Objective:** Persist only an approved profile selection and safely resolve it at
startup without changing matcher structure or storing sensitive audio/device data.

**Work:**

- Add the versioned `ListenCalibrationRecordV1` described in this plan under
  `homr.listen-calibration.v1`.
- Store schema/model/registry versions, selected named profile ID, date,
  source/setup label, calibration/confirmation counts, and safety-failure count.
- Do not store audio, PCM, full traces, raw browser device IDs, manufacturer data,
  serial identity, or arbitrary threshold objects.
- Implement resolution priority: explicit benchmark/test override, compatible
  calibration selection, then global production default.
- Treat malformed, unknown-profile, stale-model, stale-registry, and incompatible
  schema records as absent and fall back without blocking listen mode.
- Add read/write/reset/redaction tests plus resolver tests for every fallback.
- Do not add the wizard or Settings controls yet; tests may create records through
  the storage API.

**Verification:** Run storage/resolver unit tests, full suite, and build. Manually
inject each invalid record class and verify listen mode uses the global default.
Inspect local storage and diagnostic exports for prohibited fields.

**Complete when:** Compatible records select only registered profiles, every bad
record falls back safely, no sensitive data is persisted, and the feature remains
inaccessible to ordinary users pending Task 19.

### Task 19 — Build the approved-profile calibration wizard and Settings lifecycle

**Status:** Conditional on Tasks 17-18. **Prerequisites:** Task 18 complete.

**Objective:** Expose the measured approved-profile selector as a guided,
privacy-preserving workflow without exposing raw thresholds or sensitivity
sliders.

**Work:**

- Add a `Listen calibration` Settings section with status, optional setup label,
  date, Calibrate/Recalibrate, Reset, and the local-processing privacy note.
- Implement the wizard sequence: silence/noise observation; guided low/middle/high
  notes at ordinary and soft dynamics; representative chords; repeated/shared
  transitions; explicit wrong/extra/omitted-bass trials; and an untouched
  confirmation block.
- Reuse the exact selection algorithm and gates validated in Task 17. The wizard
  may save only a registered profile and must save no calibration when trials are
  incomplete, a negative case advances, or confirmation does not beat the global
  default.
- Use user-facing language such as Standard, Adjusted for this setup, and
  Recalibration recommended. Do not show profile IDs as sensitivity advice or
  expose numeric thresholds.
- Stop active listen mode before applying/resetting calibration, reconstruct the
  matcher, and require an explicit restart. Never mutate an active attempt.
- Add component, lifecycle, failure, reset, accessibility, privacy, and selection
  parity tests.

**Verification:** Run full unit/component tests and build. Complete successful,
failed-negative, incomplete, reset, stale-record, and active-listen manual flows.
Confirm the stored record and effective diagnostic profile match expectations.

**Complete when:** Users can safely calibrate, recalibrate, and reset; the product
workflow exactly reproduces the validated selector; and every failure returns to
the global default.

### Task 20 — Confirm the shipped calibration workflow on live instruments

**Status:** Conditional on Tasks 17-19. **Prerequisites:** Task 19 complete.

**Objective:** Verify that the actual Settings wizard and production matcher
reproduce the offline calibration benefit rather than only passing simulated
tests.

**Work:**

- Repeat at least one acoustic and one digital setup used in Task 15 through the
  real wizard.
- Record the selected profile, wizard calibration/confirmation results, and a
  separate post-wizard held-out passage containing correct and negative cases.
- Compare production behavior with replay from the exported decoded trace and
  with the global default.
- Exercise reset and recalibration after changing the input setup; verify fallback
  and matcher reconstruction.
- Update the calibration report and README with measured workflow results and
  limitations. Do not claim universal instrument adaptation beyond tested setups.

**Verification:** Production advancement, replay, saved record, and effective
profile agree for every trial; no live safety regression occurs; full tests/build
remain green.

**Complete when:** The user-visible workflow has reproducible acoustic and digital
confirmation, privacy/fallback behavior is verified, and calibration documentation
matches the shipped implementation.

### Task 21 — Evaluate confidence normalization only as a separate later branch

**Status:** Optional future research. **Prerequisites:** Task 17 complete and a
documented residual instrument-dependent domain shift that approved-profile
selection cannot safely address.

**Objective:** Determine whether bounded input/evidence normalization improves
held-out live recognition beyond profile selection without changing matcher
safety semantics.

**Work:**

- Define a new discovery/confirmation split; do not reuse Task 17 confirmation
  data for fitting.
- Evaluate bounded input gain, monotone onset-confidence normalization, monotone
  active-target normalization, and only well-supported broad register bands.
- Calibrate unexpected-note evidence only with explicit negative examples.
- Keep exact-chord structure, fresh bass, timing, ordering, and registered matcher
  thresholds fixed.
- Version every transformation and make it serializable/replayable. Do not
  synthesize missing onsets or introduce per-pitch maps from a small sample.
- Apply the same automated and live safety gates as the global profile decision.

**Verification:** Compare fixed-profile, approved-profile selection, and
normalization on untouched confirmation data with trace identity and safety
parity. Repeat any claimed gain across at least one acoustic and one digital
setup.

**Complete when:** The experiment concludes either `normalization-justified` with
repeatable held-out benefit and no safety loss, or `normalization-not-justified`
with no production change. Implementation/rollout of a justified transformation
requires a new plan rather than silently extending Tasks 18-20.

### Task 22 — Map omitted-bass and repeated-chord qualification evidence

**Status:** Completed August 22, 2026; corrected evidence rerun August 23, 2026.
**Prerequisites:** Task 16 complete.

**Measured outcome:** `benchmark-results/listen-bass-qualification-task22.json`,
445 traces captured once each and replayed through twenty-one profile columns;
the full record is the August 23 corrective-rerun entry in
`tools/online_amt/LISTEN_BENCHMARK.md`.
Three results this task hands to Tasks 23, 24, and 26, and three corrections to
the text above:

- The two omitted-bass failures are pinned per profile in
  `webapp/src/listenOmittedBassFixtures.ts`. The phantom bass onsets measure
  0.5267 on `isolated/direct/122` and 0.5094 on `isolated/tone/124`, both inside
  the predicted `[0.50, 0.60)` corridor and both admitted through the ordinary
  fresh-onset path. Their cross-rendered counterparts decode no bass onset at all.
- A 0.60 bass gate is free on the isolated matched pairs — no genuine bass attack
  falls below 0.7161 under Direct or 0.9926 under Tone — and not free anywhere
  else. On the continuous corpus 15 genuine bass attacks lie inside the corridor
  and 61 produce no bass onset at all, with weakest onsets of 0.5093 under Direct
  and 0.5182 under Tone, while the four continuous attacks that do not sound the
  bass and still decode one reach 0.9999. The two sides do not separate on a
  single scalar outside the isolated suite.
- The repeated-chord case is not a bass defect on the attack that matters. On the
  first attack of `[62, 74, 82]` in all three runs the bass and the top voice both
  produce onsets above 0.99 and D5/74 produces none at all, with sustained
  evidence of 0.1935, 0.1627, and 0.0958. The three-run minimum is **0.0958**, so
  no active-target gate in the version-1 grid can reach source distance 0 on any
  of them. `baseline-v1` recovers the chord only in `v05`, at source distance 2
  and 2,220 ms; in `v13` and the mixed run its playhead never arms the chord at
  all. All four candidates reach distance 1 and 1,228 ms in every run, and none of
  the sixteen counterfactuals — every one of which holds onset at 0.60 — improves
  any run.
- Correction: all four high-onset, open-active profiles carry the
  `sequence/tone/course-clear-27/167ms` and `dynamics-constant/tone/salamander/v14`
  false advances, not the `x0p970` variant alone; the `x0p990` variant adds two
  more on `course-clear-27/333ms` and loses a committed regression.
- Correction: an active gate of 0.275 preserves nothing that 0.20 produced. No
  held-active counterfactual recovers a fixture, three are identical to
  `baseline-v1` on isolated recognition, and the other nine lose two Direct
  fixtures each.
- Correction: on the first attack of the repeated chord the upper voices are
  repeated from the preceding chord but are **not** still sounding — a 420 ms hold
  at a 1,000 ms interval has been released, and the decoded active set is empty
  immediately before the attack. The records report the two facts separately.

**Objective:** Turn Task 09's omitted-bass observation into pinned regressions, and
extend Task 05's completed late-recovery classification by separating the onset and
active-target qualification paths that limit `[62, 74, 82]` before Task 24 freezes
the round-two rule and Task 26 chooses a parameterization.

The cost has two sides, but this task does not assume they share one mechanism or
one separable confidence band. It measures hallucinated and genuinely sounded bass
onsets, upper-voice target evidence, and the exact matcher qualification path for
each failed and successful repetition. That distinction decides whether the
existing five-axis family, a bass-specific onset axis, or neither can address the
late recovery without reopening the omitted-bass false advance.

**Work:**

- Start from what is already known rather than re-opening it. Task 09 recorded
  that `isolated/direct/122` is `[48, 60, 68]` played as `[60, 68]` and that
  `isolated/tone/124` is `[56, 68, 75]` played as `[68, 75]`. Both targets are
  triads whose lowest note was omitted, so `target.size >= 3` holds, fresh bass is
  required, and the sustained-evidence completion path cannot have credited the
  bass. Each was completed by a decoded onset on a bass pitch that was never
  sounded, with confidence in `[0.50, 0.60)`. The mechanism is the ordinary onset
  path admitting a hallucinated onset; it is not the sustained-completion path,
  and that alternative needs no further investigation.
- Pin each original failure as a deterministic regression under the renderer that
  produced it. `isolated/direct/122` failed under Direct and `isolated/tone/124`
  under Tone. Record each fixture's cross-rendered counterpart as a diagnostic
  rather than requiring it to reproduce the same outcome.
- Measure the deciding cost. Across every matched correct and omitted-bass pair in
  the isolated corpus, under both renderers, report the distribution of decoded
  onset confidence on the bass pitch, separately for genuinely sounded attacks and
  for hallucinated ones. State how many real bass attacks fall inside
  `[0.50, 0.60)` and would therefore be refused by any gate holding the bass at
  0.60. Treat the genuine 0.5968 D4/62 onset on `v05` attack 24 as the recorded
  overlap prior, not as proof that the larger distributions are inseparable.
- Report every distribution twice: by raw trace count and by unique musical-input
  pair. A fixture rendered at several speeds or layers is not several independent
  observations, and the second view is the one the decision reads.
- Report the same distributions over the sequence, dynamics, and articulation
  discovery traces, so the cost of a high bass gate is known outside the isolated
  suite.
- Measure the repeated `[62, 74, 82]` target that no measured profile recognises on
  the attack that sounds it. For all three Tone Salamander runs where it recurs —
  `v05`, `v13`, and the mixed run — report every pitch's decoded onset confidence,
  target-pitch evidence, active membership, and matcher qualification path at every
  repetition, including repetitions that did not advance. State where onset values
  sit relative to the incumbent's 0.60 gate, the candidates' 0.45 and 0.50 gates,
  and the `[0.50, 0.60)` hallucination corridor, and where upper-voice evidence sits
  relative to every measured active-target gate.
- Separate the transition into the repeated region from repetitions within it. On
  the first problematic `v05` attack, bass 62 is new while upper 74 and 82 carry
  from the preceding target; on later identical repetitions all three pitches
  carry. Reproduce or correct the recorded first-attack D5/74 evidence near 0.1935,
  the second-repetition bass onset near 0.5968, and the D5/74 evidence near 0.4587.
  Do not describe the case as a bass-onset defect unless the per-pitch
  qualification record establishes that conclusion.
- For the first physical attack of the repeated target, report each run's lowest
  limiting upper-voice target evidence and the minimum across `v05`, `v13`, and
  mixed. Include zero rather than dropping it: zero means no scalar active-target
  gate can recover that run. Task 24 freezes any below-0.20 diagnostic points
  against this three-run minimum, not against `v05`'s 0.1935 alone.
- Classify the limiting path for every run and repetition: fresh onset rejected,
  active-target evidence rejected, unexpected-note rejection, or some other fixed
  matcher policy. Report whether a hypothetical lower active-target gate could
  reach source distance 0, whether a lower general or bass onset gate can only reach
  distance 1, and which safety regressions each counterfactual would expose. These
  are diagnostic counterfactuals, not candidates or policy changes.
- Record what this costs today rather than only what a change would cost. Task 13
  measured `baseline-v1` recovering the chord at source distance 2 and 2.22 s of
  attribution delay, and all four candidates at distance 1 and 1.22 s. No profile
  reaches distance 0, so a full attack of playhead lag on a repeated chord is the
  current shipped behaviour, not a candidate regression.
- Treat this as a late-advance performance measurement, not a safety case. The
  `v05` classification from Task 05 is unchanged: correct content recovered late,
  zero false, skipped, and duplicate advances. This task does not reopen that
  classification; it diagnoses the distinct evidence paths that produce the lag
  and supplies a performance objective for the round-two selection rule.
- Do not propose retrigger detection as the remedy. Re-enabling score-rise
  retrigger detection is a standing non-goal, and it is the prior attempt at this
  exact problem: its best measured candidate created 22 false or duplicate events
  to recover two attacks. Record the existing attribution that the decoder emitted
  no D5/74 re-onset on the first two repetitions. Confidence qualification through
  the existing gates and a measured bass-specific axis remain bounded experiments;
  if neither reaches source distance 0 safely, that missing re-onset is a Task 29
  decoder/model-plan input rather than permission for another threshold grid.
- Measure existing-grid counterfactuals rather than a control that does not exist
  yet, and name every coordinate. Replay the four high-onset, open-active profiles
  `o0p600-t0p500-a0p200-x0p900-b1`, `o0p600-t0p500-a0p200-x0p940-b1`,
  `o0p600-t0p500-a0p200-x0p970-b1`, and `o0p600-t0p500-a0p200-x0p990-b1`. Replay
  beside them the twelve profiles that hold onset at 0.60 and active at 0.275 with
  fresh bass required and that passed round-one safety: target in
  {0.350, 0.425, 0.500, 0.575} crossed with extra-note in {0.90, 0.94, 0.97}. The
  0.99 extra-note column is absent from that set because none of it survived.
  Report each profile's complete safety and regression evidence, not only the
  Course Clear recovery and the two omitted-bass fixtures.
- Do not assume the high-onset, open-active corner is available. The Task 08
  archive already rejected all four of those open-active profiles for
  `discovery-safety-regression`, the `x0p990` variant for a committed regression as
  well, with the `x0p970` variant adding a false advance on
  `sequence/tone/course-clear-27/167ms` and on
  `dynamics-constant/tone/salamander/v14`. Of the 279 profiles that passed
  round-one safety, 60 hold onset at 0.60 and none of those opens the active gate
  past 0.275. Record whether an active gate of 0.275 preserves the recovery that
  0.20 produced.
- Measure all of this on version-1 evidence, which is what exists when this task
  runs. Whether the version-2 corpus and the Task 23 policy change any of it is
  Task 26's first ablation, not this task's question.
- Report the relationship to Task 06 without merging the cases. There a later chord
  genuinely sounded the shared pitch; in the omitted-bass fixtures the bass was
  never played; in the repeated-chord case an upper voice may be carried while the
  bass mechanism changes between the first and later repetitions. They share only
  the broad policy of target qualification without a fresh attack on every target
  pitch, so a fix for one is not evidence for either other case.
- Change no threshold, no policy, no gate, and no default in this task.

**Verification:** Each pinned regression reproduces from rendered audio under the
renderer it was recorded on, with a stable decoded-structure hash, `baseline-v1`
satisfying its pinned refusal and each `v2` candidate its pinned advance. The
confidence distributions, per-pitch qualification records, and sixteen
counterfactual replays recompute deterministically from the captured traces. A
test distinguishes the first transition into `[62, 74, 82]` from its later exact
repetitions, so it cannot regress to the false claim that every pitch carried on
the first attack. The full unit suite and the production build pass.

**Complete when:** Both omitted-bass failures are pinned, the hallucinated-onset
mechanism is recorded, the cost of a 0.60 bass gate and the version-1 behaviour of
all sixteen named counterfactual profiles are measured, and every `v05`, `v13`,
and mixed repeated-chord attempt names its limiting onset or active-target
qualification path, and the three-run minimum limiting upper-voice evidence is
recorded without discarding a zero. Task 24 can then predeclare what constitutes no
regression, material recovery, and full resolution without assuming that a bass
axis solves an upper-voice evidence failure.

### Task 23 — Freeze the round-two safety and correctness policy

**Status:** Completed August 23, 2026, and frozen before Task 25 captures any
discovery trace and before any Task 26 ablation. It cannot precede all round-two
measurement, because Task 22 measures distributions and Task 24 replays observed
discovery evidence.
**Prerequisites:** Task 22 complete.

**Objective:** Replace isolated release floors that apply only to challengers, and
that the incumbent does not meet, with a versioned policy that protects safety and
still permits a safe incremental improvement to ship.

**Work:**

- Record the round-one observation as this task's reason. `LISTEN_ISOLATED_RELEASE_GATE`
  states Tone floors of 101/106 overall and 52/54 on Course Clear and applies them
  to candidates only. `baseline-v1` measures 100/106 and 48/54, so it is
  grandfathered past a bar it does not meet, and `early-open-v2` and
  `steady-open-v2` were rejected while measuring strictly better than the shipped
  default on both. The floors are not unreachable — the open pair moved Course
  Clear from 48 to 50 of the 52 required — but as written they block shipping any
  safe improvement for as long as the incumbent sits below the same target.
- Freeze a four-part policy. Safety gates stay absolute. Correctness eligibility is
  paired non-regression against `baseline-v1` on the identical frozen corpus. The
  absolute recognition targets remain, reported as product debt with the
  incumbent's own distance from each stated beside it. Production promotion
  additionally requires a predeclared material improvement somewhere, so parity
  with baseline everywhere is not a reason to change the default.
- Freeze what does not depend on the corpus: the target rates, the rounding rule
  for deriving a count from a rate and a census, the material-improvement
  thresholds, and the fail-closed semantics. Do not freeze corpus-specific counts
  here. The manifest version-2 census does not exist until Task 25, which binds the
  derived counts to the finalized census before capturing any discovery trace.
- Make the gates fail closed at the run, not only at the archive. Today
  `LISTEN_ISOLATED_RELEASE_GATE` is applied only when `renderer.correctTrialCount`
  equals the count its floor is stated against, `passed` is
  `applied && failures.length === 0`, and the eligibility filter reads
  `applied && !passed` — which ignores an unapplied gate entirely, so a changed
  census silently removes the constraint. Require instead that a validation run
  declaring itself complete throws, or marks every candidate ineligible, when any
  required gate is unapplied. The Task 13 archive verifier stays as a second line
  of defence; it must not be the only one.
- Call this a versioned policy change rather than a correction, and version it
  exactly as the trace manifest is versioned, so a later change is a reviewed edit
  to a module constant rather than a field on a passed object.

**Verification:** Add tests for the versioned policy, for the incumbent being
evaluated by every gate it is the reference for, for rejection of an unknown policy
version, and for a complete run with a required gate unapplied failing rather than
yielding an eligible candidate. Re-score the two frozen Task 13 archives under the
policy without re-measuring them, and record which round-one rejections survive.

**Complete when:** Every gate states what it is measured against, the incumbent is
held to the same rules as its challengers, promotion requires a predeclared
material gain, an unapplied required gate cannot pass, and every corpus-independent
value is frozen for Task 25 to bind.

**Completion evidence:** `webapp/src/listenProfileValidationPolicy.ts` freezes
policy version 1 under the same edit-and-bump semantics as the trace manifest.
The round-one isolated floors are now corpus-independent rates — 98% Direct
overall, 95% Tone overall, and 95% Course Clear for either renderer — with
ceiling as the only count-derivation rule. No version-2 count is stated here;
Task 25 must bind those rates to its finalized census. Absolute target outcomes
are reported as product debt for every column, including `baseline-v1`, while
isolated eligibility uses paired non-regression on the identical corpus.

Promotion is separate from eligibility and requires at least one frozen material
gain: one percentage point on a recognition, ordered-advance, or complete-passage
rate; one 32 ms decoder-hop latency reduction; or removal of one unsafe event,
without failing any safety or correctness gate. The unified report now includes a
reference row produced by running `baseline-v1` through the same gate code, every
profile's target debt and materiality evidence, and separate eligible and
promotable ID lists. Parity everywhere can be eligible but never promotable.
Frozen `1e-12` rate and `1e-9` ms representation epsilons make exact count-derived
boundary gains deterministic without admitting a distinguishably smaller gain.

Required-gate coverage is fail-closed. A complete result with an unapplied gate
records that code as blocking and makes the profile ineligible; partial runs still
remain `incomplete-evidence` and can only reject. An unknown policy version and an
in-place amendment of a known version are both rejected.

The committed evidence verifier requires the immutable Task 13 archives to omit a
policy stamp, as the unversioned round-one files actually do, and rejects a
policy-versioned substitute. It re-scores both archives without rendering or
inference and produces identical policy-version-1 results using the same isolated,
sequence, dynamics, latency, and safety-reduction materiality axes as the live
evaluator. The
incumbent's Tone debt is 1 overall advance (100/106 against 101) and 4 Course Clear
advances (48/54 against 52). The open pair loses only its old
`release-isolated-course-clear` rejection; the held pair loses both
`release-isolated-recognition` and `release-isolated-course-clear`. All four remain
ineligible on the one genuine surviving rejection,
`safety-isolated-false-advance`, covering `isolated/direct/122` and
`isolated/tone/124`. No threshold, registry entry, matcher policy, production
default, or frozen archive changed. Dedicated policy tests, validator integration
tests, archive re-score tests, the full unit suite, and the production build pass.

### Task 24 — Regenerate a per-domain archive and freeze the complete selection rule

**Status:** Completed August 23, 2026. **Prerequisites:** Task 22 complete and the
Task 08 corpus reproducible. Independent of Task 23 and may run beside it.

**Objective:** Freeze every rule the later tasks apply — the regret calculation,
its decision boundary, and the complete selection and ablation stop rules — and
compute the version-1 control result they will be re-run against on the version-2
corpus. This task does not decide whether the round needs one global profile or a
complementary set; Task 26 does, using this task's frozen calculation. It does
freeze how repeated-chord recovery participates in that decision.

**Work:**

- Do not attempt the analysis from the existing archive.
  `benchmark-results/listen-matcher-multidomain-sweep-task08.json` stores each of
  its 1,000 rows as a profile, a flat `ListenCandidateMetrics` record, a safety
  verdict, and totals; only the frontier and selected rows carry richer breakdowns.
  A per-domain oracle over the full grid is not reconstructible from it.
- Replay the exact frozen Task 08 discovery corpus at manifest version 1 and emit a
  new versioned archive carrying per-leaf-domain results for every profile.
  Changing nothing but the recorded level of detail keeps this a re-export of
  already observed discovery evidence rather than a new search.
- Restricting the analysis to the archived frontier is not an acceptable
  substitute. That frontier was selected by the very metric order under question,
  so regret measured across it cannot surface a domain champion the
  compromise-seeking rule discarded, which is the whole spread question.
- Choose each domain's oracle only from profiles that are globally safe across the
  complete regression corpus. A domain champion that is unsafe elsewhere is not a
  candidate for anything.
- Predeclare the decision boundary numerically before looking at the result, in the
  units the frozen metric order already uses.
- Treat this task's own verdict as a version-1 control, not the round's answer.
  Task 25 promotes 212 isolated correct traces into scoring as a new co-equal
  domain, and a domain that did not exist here can move the oracle-regret outcome.
  Record `one-global-profile-suffices` or `domain-spread-material` for the version-1
  corpus, and hand the frozen calculation to Task 26, which applies it unchanged to
  the version-2 discovery results for the verdict Task 27 acts on. Freezing the
  calculation here and running it there is what keeps the rule pre-registered while
  still deciding on the corpus the round actually searches.
- Freeze the complete selection rule in this task. Task 26's ablations and Task
  27's search both act on it, so it must state the global-safety requirement, the
  complementarity objective for the spread case, the maximum candidate count, the
  materiality boundary a selected profile must clear, and the exact stop rule that
  ends Task 26's ablation sequence. A rule written after an ablation's results are
  visible is post-result retuning.
- Freeze the repeated-chord performance rule as part of that selection rule, using
  Task 22's recorded fields rather than an aggregate `lateAdvanceCount`. Evaluate
  `v05`, `v13`, and the mixed run separately so improvement in one cannot offset a
  regression in another. Predeclare a numeric no-regression boundary for source
  distance and attribution delay, a numeric material-recovery boundary, and the
  exact aggregation used by the ablation stop rule. Define the full-resolution
  criterion narrowly as source distance 0 with zero false, skipped, or duplicate
  advances on `v05`, `v13`, mixed, every discovery group that reproduces the
  phenomenon, and at least one confirmation group that independently reproduces
  it. Define reproduction before Task 25 authors the fixtures: under `baseline-v1`,
  the first correct full-chord attack remains incomplete with at least one carried
  required pitch receiving no fresh re-onset, and a later identical attack recovers
  the correct target without a false, skipped, or duplicate advance. Every decoded
  confirmation group meeting that predicate must pass; one passing group cannot
  hide another reproducing group's failure. Task 26 may report
  `discovery-full-resolution` only; Task 28 may promote that label to
  `confirmed-full-resolution` only after at least one unseen group reproduces and
  passes. Distance 2 to distance 1 is a material partial recovery only if it clears
  the frozen boundary, and must never be reported as a complete fix.
- Predeclare the non-reproducing confirmation outcome. A structurally valid unseen
  group whose baseline reaches source distance 0, or whose evidence fails the
  reproduction predicate for another reason, remains useful correctness and safety
  evidence but is `inconclusive-for-repeated-recovery`; it neither supports nor
  refutes `confirmed-full-resolution`. Do not replace it after decoding, and do not
  restart the round solely because the decoder did not reproduce the phenomenon.
  If no confirmation group reproduces it, the confirmation run may still decide
  candidate eligibility, but `confirmed-full-resolution` is unavailable this round.
  Freeze two orthogonal result fields so consumers do not collapse performance and
  evidence availability: `repeatedRecoveryOutcome` is `unchanged`, `regressed`,
  `material-partial-recovery`, `discovery-full-resolution`, or
  `confirmed-full-resolution`; `confirmationReproductionStatus` is `reproduced`,
  `inconclusive-no-reproduction`, or `not-run`.
- Freeze how the same rule maps onto the newly authored repeated-chord groups that
  Task 25 will place in discovery and confirmation. The baseline comparison is
  paired within each musical-input group, and every group reports source distance,
  attribution delay, and safety independently before any summary is calculated.
  State whether material recovery is required in every stratum or by a predeclared
  worst-stratum statistic; do not choose that aggregation after seeing the new
  fixtures.
- Freeze the exact active-target refinement points for Task 26 before its first
  ablation. Use Task 22's minimum limiting upper-voice evidence across `v05`, `v13`,
  and mixed, not the single `v05` value near 0.1935. If that minimum is nonzero and
  the existing five-axis family is meant to test source distance 0, its diagnostic
  grid must straddle the minimum below the existing 0.20 floor as well as refining
  the region between 0.275 and 0.35. If the minimum is zero, record that no scalar
  active gate can reach all three. If safety evidence justifies excluding the
  below-0.20 region, record the exclusion here, pre-register that exclusion as the
  expected outcome given round one's safety evidence, and state in advance that
  round two cannot claim to have tested full resolution through the existing scalar
  family.
- Freeze the bass-support criterion with it, because Task 26 cannot invent one once
  it has seen a bass result, and keep its two levels distinct. The stop rule is
  evaluated over a whole ablation; the bass-support comparison is evaluated over
  matched profile pairs, where a pair is one bass-axis profile and the profile
  identical to it in every other coordinate with the bass threshold at its
  compatibility default. State how pairs are formed and which metric the comparison
  reads. A bass grid that passes the stop rule is supported only when at least one
  selected bass profile either rescues its twin categorically on safety or beats it
  by at least the frozen materiality boundary; an axis that merely rides along
  inside a passing grid is not supported.
- Treat the regret result as discovery evidence. It scopes the round, it confirms
  nothing, and it may never be quoted as a calibration benefit. Renderer, piano, and
  dynamic band are proxies for an acoustic path and not instruments, so
  `domain-spread-material` is evidence that per-source selection is worth testing,
  never that it works.

**Verification:** The regenerated archive reproduces every recorded Task 08
aggregate exactly, including the 721 rejections, the 30-profile frontier, and the
four selected identifiers, so the added detail is provably the same search. The
regret computation and the selection rule are deterministic and unit-tested,
including the empty one-global selection when no non-baseline profile clears the
material-improvement rule and the stop rule against constructed ablation results.
Constructed
repeated-chord cases prove that a regression in one run cannot be averaged away,
that distance 1 receives neither full-resolution label, and that the next ablation
runs or stops exactly at the frozen material-recovery boundary. Constructed
confirmation cases prove that a non-reproducing group is inconclusive, that it is
not swapped, and that zero reproducing confirmation groups cannot yield
`confirmed-full-resolution`. Assert that no `confirmation` trace is read.
The hashed policy owns the three known repeated-recovery identifiers, and every
exported regret, repeated-recovery, ablation-stop, and bass-pair decision entry
validates that policy before producing an outcome. A declared but undecoded
discovery group remains in the stratum census and fails the stop rule closed with
an explicit incomplete-evidence reason, without becoming a regression outcome.
Constructed mixed cases prove that a real measured regression still produces both
the regression and incomplete-evidence reasons, and that an incomplete matched
twin comparison cannot support a bass axis through safety rescue or regret gain.
Leaf-domain detail excludes zero-weight rows exactly as the frozen scoring path
does. The evidence verifier independently recomputes both the policy hash and the
Task 24 canonical digest rather than trusting either serialized digest field.

**Complete when:** Every rule Tasks 26 and 27 apply is frozen and tested before any
Task 26 version-2 result is visible, and the version-1 control result is recorded as
a control rather than as the round's objective. The repeated-chord rule,
aggregation, resolution vocabulary, and active-target refinement points or their
explicit exclusion are all frozen before Task 26 sees a version-2 result.

**Completion evidence:** `listenMatcherSelectionPolicy.ts` freezes selection
policy version 1 at hash `840b07ec`. The hashed rule includes the known `v05`,
`v13`, and mixed repeated-recovery census, and every Task 26 decision path rejects
an amended policy before applying it. Per-leaf-domain regret reads independent
recognition from all globally safe grid rows, uses a one-percentage-point inclusive
one-global boundary, starts complementary spread selection from the baseline
envelope, requires each selected addition to improve a leaf by the same material
margin, and caps the new candidate set at four. The whole-ablation stop rule
requires a non-empty search-selected set, a complete discovery-stratum census, no
measured repeated-chord regression in any selected profile, and material repeated
recovery in at least one selected profile.
Matched bass-axis support is separate and requires a categorical safety rescue, a
one-point worst-regret gain, or material repeated recovery against the identical
compatibility-default twin, plus complete discovery evidence for that pair. An
incomplete twin comparison is unsupported even when another separation criterion
passes.

Repeated recovery is reported per musical-input group and never averaged across a
regression. Source distance may increase by zero, attribution delay by at most one
32 ms decoder hop, and material partial recovery requires both one full attack of
source-distance gain and 500 ms of delay gain; unrecovered-to-recovered is
categorically material. Every declared discovery stratum must be completely
decoded and contain a material recovery; an unevaluated group is retained and
fails closed rather than disappearing from the census. It sets
`discoveryEvaluationStatus` to `incomplete` and the stop reason to
`selected-discovery-stratum-not-decoded`, while leaving `noRegression` and
`repeatedRecoveryOutcome` to describe evaluated performance only. An undecoded
confirmation group remains `not-run` and does not poison discovery performance.
Distance 0 on all three known runs and every reproducing discovery group is only
`discovery-full-resolution`; `confirmed-full-resolution` additionally requires at
least one unseen reproducing confirmation group and every such group to pass. A
valid non-reproducing confirmation group remains
`inconclusive-no-reproduction`. The result keeps performance, discovery
completeness, and confirmation reproduction in three orthogonal fields.
A full-resolution performance label may coexist with incomplete discovery when an
undecoded extra group's baseline does not reproduce the phenomenon; completeness
still blocks the stop rule and any matched-pair bass-support claim.

Task 22's exact three-run limiting evidence minimum, `0.09577340414698106`, freezes
new active-target points `0.075`, `0.100`, and `0.125` below the old 0.20 floor,
plus `0.300` and `0.325` between the old 0.275 and 0.350 points. The below-0.20
region is not excluded; Task 26 must measure its safety before claiming source
distance 0 through the scalar family.

`benchmark-results/listen-matcher-domain-archive-task24.json` replays all 1,000
profiles across the exact manifest-v1 discovery/regression corpus and records all
29 leaf-domain rows for every profile. Before export it reproduces the Task 08
candidate digest `53ee8a67`, 721 rejections, 30-row frontier, and four selected
identifiers, while reading zero confirmation traces. The archive is pinned at
internal digest `1aab7393` and SHA-256
`adf66cb52f7f6c62c99d722f0d4b04ecb89a41ba66770d38542e995385798a43`.
Among 279 globally safe rows, `o0p450-t0p500-a0p200-x0p990-b1` is an oracle in
all 29 version-1 leaf domains, giving zero worst regret and the control verdict
`one-global-profile-suffices`. It represents a three-profile complete leaf-vector
tie with the `t0p425` and `t0p350` variants. Seven leaves have one scoring trace,
eight are invariant across all safe profiles, and in 19 of the 21 varying leaves
the one-point decision boundary is below the smallest observed non-zero step; the
archive records this resolution census rather than implying one-point precision.
This is explicitly a version-1 discovery control;
Task 26 reruns the unchanged calculation on manifest version 2 for the round's
actual global-versus-spread verdict. Policy, regret, archive-parity,
repeated-recovery, confirmation-vocabulary, stop-rule, bass-pair, full unit, and
production-build checks pass.

### Task 25 — Build the round-two corpus and freeze trace manifest version 2

**Status:** Completed August 23, 2026. **Prerequisites:** Tasks 22-24 complete.

**Objective:** Author genuinely unseen confirmation evidence, because none
survives, and repartition the observed corpus so the next search is gated by the
evidence that rejected the last one.

**Work:**

- Accept the constraint first. Every version-1 isolated trace was captured and
  evaluated in Task 13 across all five profile columns, so no unobserved isolated
  row exists anywhere in the corpus. A round-two confirmation partition cannot be
  carved out of existing material; it has to be authored.
- Repartition what is already observed, and give every case kind a destination.
  The isolated correct fixtures become `discovery`. The omitted-bass and
  distinguishable-wrong fixtures become `regression-only`. The ambiguous-harmonic
  fixtures cannot remain `confirmation` either, and they must not score: assign
  them an explicit non-scoring diagnostic role, reported beside safety and never
  used to hide or offset a distinguishable false advance.
- State the scoring census accurately. Task 13 recorded 106 correct, 18
  omitted-bass, 8 ambiguous-harmonic, and 2 distinguishable-wrong rows per
  renderer, so across both renderers the 268 observed isolated traces are 212
  correct, 36 omitted-bass, 16 ambiguous-harmonic, and 4 distinguishable-wrong.
  The 212 correct rows enter scoring, the 40 omitted-bass and distinguishable-wrong
  rows become regression-only, and the 16 ambiguous-harmonic rows become
  diagnostic. Assert this census in the manifest tests rather than restating it in
  prose alone.
- Predeclare the effect of that promotion rather than letting it arrive as a side
  effect. The hierarchical weights give every suite equal top-level weight, so 212
  isolated correct traces enter scoring as a co-equal domain where round one had no
  isolated evidence in discovery at all. Record what that is expected to do to the
  ranking before the search runs.
- Bind the Task 23 rates to this census. Derive each corpus-specific count from the
  frozen rate and rounding rule against the finalized version-2 census, and freeze
  the derived counts here, before any discovery trace is captured.
- Author new paired fixtures spanning piano, dynamic, register, chord size, and
  articulation. Each group pairs a correct rendition with its omitted-bass and
  distinguishable-wrong counterparts, so a false advance and a lost correct advance
  are measured on the same material.
- Make repeated-identical-chord groups an explicit required subset rather than
  assuming the general variation happens to cover them. Author new musical inputs,
  not transpositions or rerenders of `v05`: each correct case enters a chord whose
  upper voices carry while its bass is newly introduced, then repeats that exact
  chord enough times to measure source distance 0, 1, and 2. Pair it with
  omitted-bass and distinguishable-wrong performances of the same score material.
  Vary piano, renderer, dynamic, register, chord size, and articulation across the
  subset so a `v05`-specific threshold cannot masquerade as general recovery.
- Put at least one complete repeated-chord paired group in discovery and at least
  one in confirmation, chosen at authoring time. Keep each group wholly inside one
  partition under the existing paired-group rule. The confirmation group remains
  structurally inspectable but undecoded until Task 28, exactly like every other
  newly authored confirmation fixture.
- Do not claim that an undecoded confirmation group reproduces the late-recovery
  phenomenon. Task 25 can validate only that its score and performance pattern are
  designed to exercise Task 24's predicate; whether the decoder actually omits the
  carried-pitch re-onset is first knowable in Task 28. Record that uncertainty in
  the manifest rather than attaching an expected result to the fixture.
- Assign each paired group wholly to one partition. Splitting a group's members
  between discovery and confirmation puts near-duplicate material on both sides of
  the split and leaks the confirmation answer into the search.
- Split the new groups between `discovery` and `confirmation` at authoring time.
  The confirmation share must include unseen negative cases and not only correct
  ones: false advances are what reject candidates, and a correct-only confirmation
  partition cannot detect them.
- Do not decode the confirmation fixtures in this task. Validate them on schema,
  musical-input identity, partition assignment, paired-group integrity, and the
  presence of every required asset. Discovery and regression-only fixtures may be
  rendered, decoded, and hashed here; confirmation fixtures are first decoded in
  Task 28. Capturing decoded frames for a confirmation fixture before Task 26 has
  chosen a parameterization would let the search be shaped by the material meant to
  judge it.
- Accept the cost of that rule explicitly: a confirmation fixture that renders
  badly is discovered only in Task 28, and the correct response is to restart the
  round rather than to swap the fixture, because swapping it after seeing a result
  reintroduces exactly the fitting this rule prevents. Validate everything that can
  be validated without decoding, now. Distinguish a malformed or failed render from
  a valid render that simply does not reproduce the decoder defect: the former
  restarts the round, while the latter remains frozen and is reported
  `inconclusive-for-repeated-recovery` under Task 24 rather than replaced.
- Add the Task 22 regressions as `regression-only`.
- Enforce the unseen property mechanically. A self-declared first-observed-round
  field is not a guarantee, because an old trace can simply be relabelled. Build an
  immutable ledger from the prior manifests and archives, keyed on both content
  identity and musical-input hash, and validate every version-2 confirmation row
  against it so any trace a prior round captured is rejected regardless of what it
  declares about itself.
- Bump `listenTraceManifest` to version 2 with a restated census and a re-pinned
  hash, as the module's own rule requires. Restate the hierarchical weights
  unchanged: the partition changed, the weighting rule did not.

**Verification:** Re-run the manifest tests against the version-2 census — complete
one-time assignment, no discovery/confirmation overlap, required domain coverage,
zero score weight for `regression-only` and for the ambiguous diagnostic role,
negative cases present in the confirmation partition, paired groups intact within a
single partition, repeated-chord paired groups present in both discovery and
confirmation, the pinned hash, rejection of the version-1 census presented under
the version-2 label, and rejection by ledger of a confirmation row that any prior
round captured however it is labelled. Discovery and regression-only fixtures
render reproducibly with stable decoded-structure hashes; confirmation fixtures
pass structural validation with no decode recorded, and a test asserts that no
capture path reads one.

**Complete when:** Round two has a confirmation partition no round has measured or
decoded, including negative cases and a new repeated-chord paired group; discovery
has a separately authored repeated-chord group for search; the observed corpus
gates or diagnoses rather than scores the evidence that rejected round one; and
every derived count is bound to the frozen census. The plan to exercise repeated
recovery is structurally validated without claiming that an unseen decode will
reproduce it.

**Completion evidence:** Manifest version 2 is pinned at protocol hash `d1971fa3`,
musical-corpus hash `1213016e`, and prior-evidence-ledger hash `1f9613bd`. Its 504
rows comprise 395 discovery, 12 confirmation, and 97 regression-only rows. The
observed isolated census is asserted as 212 scoring correct, 40 safety negative,
and 16 non-scoring diagnostic rows. The unchanged hierarchical weighting gives
387 discovery rows positive weight; every safety, diagnostic, and regression-only
row has zero weight. Task 23's frozen rates now derive 104/106 and 52/54 Direct
targets and 101/106 and 52/54 Tone targets from the finalized census, and the live
assessment path consumes those frozen counts only when the measured census matches;
a focused run emits no misleading full-corpus debt row. `round-two-paired` is a
sixth co-equal suite per renderer: each of its
four scoring discovery rows weighs 1/24 overall, while each isolated-correct row
weighs 1/1272, a deliberate 53× concentration recorded before Task 26 ranks.

Eight new three-member paired groups span both pianos and renderers, low through
high registers, triads and tetrads, eight dynamic layers, and four articulation
patterns. Four groups are discovery and four are confirmation; each partition has
two repeated-identical-chord groups. Every group keeps correct, omitted-bass, and
distinguishable-wrong members together. Repeated groups structurally introduce a
fresh bass under carried upper voices and contain three identical targets, but
remain labelled `designed-unverified` rather than claiming decoder reproduction.
All 12 confirmation rows are pinned `not-decoded-until-task-28`, have required
assets, and collide with neither content identity nor musical-input identity in
the immutable 478-row version-1 ledger. The two Task 22 omitted-bass fixtures are
also admitted as regression-only evidence.

Two independent real-browser captures are archived as
`listen-round-two-corpus-task25-run1.json` and
`listen-round-two-corpus-task25-run2.json`. Each captured exactly the 12 permitted
discovery pair rows plus the two Task 22 rendered source rows and recorded zero of
12 confirmation rows decoded. All recognition-structure hashes and non-PCM result
fields match between runs; process-local PCM identities remain diagnostic-only.
Both archives also record one baseline-v1 false advance on each of two discovery
distinguishable-wrong rows. Those stable baseline defects are recorded explicitly
and routed like the known Course Clear discovery defect: the eight zero-weight
discovery negatives are paired non-regression against baseline-v1, so parity is
safe and a worsened event rejects. Absolute zero remains the rule for the 36
dedicated and 41 other captured regression-only rows. No confirmation identifier
is declared in an applied Task 26 safety population; population construction
throws if any declared row was not captured.
Manifest, fixture, guarded-capture, archive-repetition, full unit, and production
build checks pass.

### Task 26 — Stage the round-two grid and decide whether a bass-onset axis is required

**Status:** Completed August 24, 2026, recording `bass-axis-unsupported`.
**Prerequisites:** Tasks 22, 24, and 25 complete.

**Objective:** Establish how much of round one's failure the existing grid fixes on
its own, and add a bass-specific control only if the evidence demands it.

**Work:**

- Run the ablations in order, applying the Task 24 stop rule, and record each
  before starting the next. Changing the corpus, the gates, the bass axis, the
  active grid, the target grid, and the selection rule at once makes attribution
  impossible.
- Judge each ablation as discovery-safe and search-selected, never as eligible.
  Production eligibility does not exist until Task 28 has measured the confirmation
  partition, and using the word here would invite a search result to be read as a
  release result.
- Ablation one is the unchanged round-one 1,000-profile grid against the version-2
  corpus and the Task 23 policy. Its question is whether the new corpus and policy
  expose any safe existing-grid candidate, not whether one anticipated combination
  wins. The high-onset, open-active corner is not available: all four profiles at
  onset 0.60, target 0.50, active 0.20 with fresh bass required were rejected in
  round one for `discovery-safety-regression`, and of the 279 profiles that passed
  round-one safety the 60 holding onset at 0.60 all keep the active gate at 0.275
  or higher. Report how the surviving high-onset profiles score, beside Task 22's
  counterfactual replays.
- Apply the Task 24 calculation to this ablation's version-2 discovery results to
  obtain the round's actual global-versus-spread verdict. Task 24's own result is
  a version-1 control: Task 25 promotes 212 isolated correct traces into scoring
  as a new co-equal domain, which can move the oracle-regret outcome. The
  calculation, boundary, safety restriction, candidate limit, and stop rule were
  all frozen in Task 24 and are not revisited here; only the corpus they run on
  changes, and no confirmation evidence is read.
- Report ablation one's effect on repeated-chord recovery beside its safety result,
  using Task 22's per-pitch qualification fields and Task 24's frozen rule rather
  than `lateAdvanceCount` alone. Report `v05`, `v13`, and mixed separately, followed
  by each new discovery repeated-chord group. A profile that refuses a hallucinated
  bass onset by raising the gate may push a real recovery back to source distance
  2; a profile that opens active-target qualification may recover the first attack
  while introducing a different safety regression. A candidate that buys one side
  by giving back the other has moved the cost rather than removed it. Label distance
  1 as partial recovery; label distance 0 across every decoded discovery group as
  `discovery-full-resolution`, never as confirmed resolution, exactly as Task 24
  froze those terms.
- Ablation two refines the existing five-axis family and adds no new axis. Run it
  only when the Task 24 stop rule authorises it. That frozen rule must cover both
  reachable reasons: ablation one produced no search-selected candidate, or its
  selected set failed the repeated-chord no-regression or material-recovery
  condition. Task 26 does not choose between those reasons after seeing the result.
  Round one's four candidates are a two-by-two corner, onset in {0.45, 0.50} by
  active gate in {0.20, 0.275}, with `targetNoteThreshold` pinned at 0.50. Refine
  the points between 0.275 and 0.35 and test whether the target threshold is
  genuinely inert or merely too coarsely gridded. Also use the exact predeclared
  active-target points below 0.20 that Task 24 froze to test the first-attempt
  upper-voice limit, unless Task 24 recorded their safety-based exclusion or the
  three-run minimum was zero. Under exclusion, record source-distance-zero recovery
  through the existing scalar family as untested; under a zero minimum, record it as
  unreachable by an active-target scalar rather than manufacturing a threshold.
- Ablation three crosses that same refined grid with the bass-onset axis, and runs
  only when the stop rule says ablation two did not satisfy it either. Refinement
  precedes the new axis deliberately: an axis that is only ever tested against the
  unrefined grid cannot be distinguished from grid resolution the existing family
  already had.
- Judge the axis on the two-sided problem it exists to solve without presuming the
  result. If Task 22 shows a threshold region that separates hallucinated from real
  bass onsets, a bass-specific gate may protect omitted-bass safety while the
  general gate preserves repeated recovery. If those distributions overlap, a
  static bass threshold may be incapable of doing both. If upper-voice active
  evidence is limiting, the bass axis cannot by itself reach source distance 0.
  Report each matched pair's effect on omitted-bass fixtures, every known repeated
  run, and the new discovery repeated-chord groups together; an axis that fixes one
  while giving back the other has not earned the parameter.
- Emit ablation three as matched bass and no-bass variants over the identical
  refined grid, so the axis is judged against its own control rather than against
  ablation two's separate result.
- Keep the two levels of judgement distinct, as Task 24 froze them. The stop rule
  is evaluated over a whole ablation and decides only whether to run the next one.
  The bass-support comparison is evaluated over matched profile pairs — one
  bass-axis profile against the profile identical to it in every other coordinate
  with the bass threshold at its compatibility default. Ablation three runs only
  after the refined no-bass grid has already failed the stop rule at grid level, so
  the grid-level control is known to fail before it starts; the pair-level
  comparison is what protects against an axis that contributes nothing.
- Record exactly one terminal outcome, reached by these transitions. Ablation one
  satisfies the stop rule, so stop at `existing-grid-sufficient`: run no further
  ablation, do not change `ListenMatcherThresholds`, and leave the threshold shape
  exactly as round one left it. Otherwise run ablation two; if it satisfies the
  rule, stop at `existing-family-refinement-sufficient`, which adopts the refined
  grid and still adds no axis. Otherwise run ablation three. It ends at
  `bass-axis-supported` when the bass grid clears the stop rule and at least one
  selected bass profile either rescues its matched twin categorically on safety or
  beats it by at least the frozen materiality boundary, while satisfying the frozen
  repeated-chord no-regression rule. A repeated-chord benefit counts toward support
  only when it clears Task 24's material-recovery boundary against that profile's
  own matched twin. It ends at
  `bass-axis-unsupported` in every other case: the bass grid fails the stop rule,
  or it passes while no selected bass profile separates from its own twin.
- Note what `bass-axis-unsupported` does and does not settle, because it routes to
  the zero branch in both of its forms. Where the bass grid failed the stop rule,
  nothing was selected. Where the bass grid passed but no selected profile separated
  from its matched twin, profiles were selected — but every one of them needs the
  axis this outcome prohibits from the production shape, and their no-bass
  counterparts are the refined grid that already failed at ablation two. Either way
  the round has nothing it can both register and confirm, so Task 27 emits an empty
  candidate manifest, Task 28 does not run its confirmation matrix, and Task 29
  records `round-two-grid-produced-no-eligible-improvement`. Reaching ablation three
  establishes only that the existing family was insufficient; it never by itself
  establishes that the axis helps.
- Keep the axis out of the production threshold shape until it is supported. An
  experimental implementation may exist to run ablation three — behind the
  round-two generator, exercised by the sweep only — but `ListenMatcherThresholds`
  and `matcherOptionsForListenMatcherProfile` gain the axis only under
  `bass-axis-supported`. Under every other outcome the experiment is recorded with
  its measurements and the production shape is left unchanged.
- When the axis does enter the production shape, give it a compatibility default so
  every existing profile's bass onset threshold defaults to that profile's own
  general onset threshold. That reproduces each profile's behaviour identically and
  lets both generations share one conversion.
- Freeze one digest-bearing ablation artifact covering every ablation that ran: its
  grid version and size, its stop-rule inputs and verdict, the profiles it selected,
  Task 22's three-run minimum limiting evidence, the per-run repeated-chord source
  distances, delays, qualification paths, and resolution labels, the matched-pair
  comparisons where ablation three ran, and the terminal outcome.
  Task 27 references this digest as `task26EvidenceDigest` in both branches, and
  under `no-supported-parameterization` it is where the passing bass grid's selected
  profiles live — so this artifact, not a placeholder search archive, is what keeps
  that measurement available to a later round.
- Under every outcome, keep the round-one generator immutable and versioned, and
  add a separate round-two generator rather than extending it. A shared generator
  that gains an axis or a grid point changes the historical grid size, rejection
  census, frontier, and recommendation, all of which the historical sweep
  regressions must continue to reproduce exactly. Record each ablation's grid size;
  only the first is 1,000.

**Verification:** Every registry profile reproduces its recorded Task 08 and Task
13 rows, with identical decoded-structure hashes and identical discrete outcomes,
under whichever threshold shape the recorded outcome selects. Both historical
single-renderer sweeps and the round-one multi-domain sweep reproduce their
recorded results against the immutable round-one generator. Tests prove the
repeated-chord no-regression and material-recovery boundaries control ablation
transitions exactly, and that a bass-axis profile cannot be supported by an
aggregate that hides a regression in one repeated run. The full suite and the
production build pass.

**Complete when:** The outcome is recorded as `existing-grid-sufficient`,
`existing-family-refinement-sufficient`, `bass-axis-supported`, or
`bass-axis-unsupported`, with the stop rule's inputs shown at every transition and
no ablation run that its predecessor's outcome did not authorise; the round's
global-versus-spread verdict has been computed on version-2 discovery results with
Task 24's frozen calculation; the contributions of the corpus change, the grid
refinement, and any new axis are separately measured against matched controls; the
known and newly authored discovery repeated-chord groups have per-run resolution
labels under the frozen rule; any untested route to source distance 0 is stated;
the production threshold shape has changed only under `bass-axis-supported`; the
round-one generator is untouched; each ablation's grid is versioned and frozen; and
one digest-bearing ablation artifact records every ablation that ran, its stop-rule
verdicts, its selected profiles, and the terminal outcome, for Task 27 to reference.

**Completion evidence:** The terminal outcome is `bass-axis-unsupported`, in the
form where the bass grid failed the stop rule, so nothing was selected that the
round can both register and confirm. All three ablations ran, each authorised only
by the recorded stop verdict of the one before, against manifest version 2
(`d1971fa3`, corpus `1213016e`) under selection policy version 1 (`840b07ec`)
applied unamended. Each captured 472 traces and read no confirmation trace.

| Ablation | Grid | Safe | Verdict | Selected | Stop |
| --- | ---: | ---: | --- | ---: | --- |
| `ablation-1-round-one-grid` | 1,000 | 159 | `domain-spread-material` | 3 | `selected-set-has-no-material-repeated-recovery` |
| `ablation-2-refined-family` | 1,400 | 452 | `domain-spread-material` | 2 | `selected-set-has-no-material-repeated-recovery` |
| `ablation-3-bass-axis` | 4,200 | 2,294 | `domain-spread-material` | 2 | `selected-set-has-no-material-repeated-recovery` |

Every stop verdict has the same cause, and it is the frozen rule rather than a
measurement of the candidates. Task 24 requires a material recovery in every
declared discovery stratum, and the two newly authored round-two repeated-chord
groups cannot supply one: their renders re-onset every chord member, so
`baseline-v1` already advances `r2-repeated-low-triad-direct-splendid-pp` at
source distance 0 and `r2-repeated-mid-tetrad-tone-salamander-v13` at distance 1.
Both groups stay in the stratum census — the policy is hashed, and Task 26 does
not narrow what it declares — so the rule fails closed at every stage. Task 25
recorded those fixtures as `designed-unverified`; this is the first measurement
of what they reproduce, and the same risk now applies to the confirmation groups
Task 28 decodes.

The version-2 corpus rejects 841 of the round-one grid's 1,000 profiles against
721 in round one. All four frozen `v2` candidates are rejected for
`regression-run-unsafe`: the isolated omitted-bass evidence that rejected them in
Task 13 now gates the search itself. All sixteen version-1 counterfactuals
reproduce their archived round-one verdicts, and all 60 surviving profiles that
hold the fresh-onset gate at 0.60 keep the active-target gate at 0.275 or above.

Task 24's calculation returns `domain-spread-material` in all three ablations
where its own version-1 control returned `one-global-profile-suffices`; the best
single profile's worst leaf-domain regret is 0.0741, 0.1250, and 0.0370 against
the frozen 0.01 boundary. The recorded resolution qualifies it: of 40 leaf
domains, 16 hold one trace, 11 to 15 are invariant across the whole safe grid,
and 19 to 23 have a smallest positive step coarser than the boundary. It is
discovery evidence about where per-source selection might help, not a calibration
benefit.

The contributions are separately attributed. The corpus change alone (ablation
one) leaves `v05` recovered at distance 1 and 1,228 ms against the incumbent's 2
and 2,220 ms, `v13` at distance 1 for one selected profile, and the mixed run
unrecovered. The grid refinement alone (ablation two) produces the first measured
profile to reach source distance 0 on both `v05` and `v13`, at 228 ms:
`o0p450-t0p5375-a0p075-x0p970-b1`, which uses the target-note refinement at
0.5375 together with the active-target point at 0.075 that Task 24 froze below
the historical 0.20 floor to straddle Task 22's 0.0958 limiting minimum. The
route to source distance 0 through the existing scalar family is therefore no
longer untested: it was tested and reached on two of the three known runs.
`dynamics-mixed/tone/salamander` stays unrecovered under every profile of every
ablation, so `discovery-full-resolution` is never reached and the residual defect
there remains a decoder-evidence question for Task 29 to route.

The bass axis was judged against its own matched control, not against ablation
two. Its grid is markedly safer — 2,294 of 4,200 pass, and the best global
profile is a bass-axis row at 0.0370 worst regret — and the single selected bass
profile `o0p450-t0p500-a0p075-x0p990-b1-B0p550` is safe where its
compatibility-default twin `o0p450-t0p500-a0p075-x0p990-b1` is rejected for
`regression-run-unsafe`, which the frozen criterion records as a categorical
safety rescue. It is unsupported for the two reasons stored with the pair:
`bass-grid-failed-stop-rule`, and `repeated-recovery-regression-against-twin`,
because against that same twin the axis turns `dynamics-mixed/tone/salamander`
from recovered at source distance 0 and 228 ms into unrecovered; both sides of
that comparison are archived with the pair, so it is readable from the record
rather than inferred from the verdict. The two-sided cost this round existed to measure
is measured on one pair of profiles: the bass gate buys omitted-bass safety and
gives back a repeated-chord recovery. The axis therefore stays out of
`ListenMatcherThresholds` and `matcherOptionsForListenMatcherProfile`; the
artifact records a runtime check, not an assertion, that no registry profile,
projection, or production conversion carries it, and the round-one generator is
untouched with ablation one refusing to run unless its grid is that generator's
1,000 rows coordinate for coordinate.

Two independent fresh-browser repetitions are archived as
`listen-round-two-ablation-task26-run1.json` and
`listen-round-two-ablation-task26-run2.json`. They agree on every decision-bearing
value and differ only in raw decoder confidences by at most 2.6e-5, so both carry
the digest `fnv1a-32-canonical-json:8dfe2f1b`, which excludes those process-local
fields by name; Task 27 references that digest as `task26EvidenceDigest` and
takes the zero branch with reason `no-ablation-accepted`, which records that no
ablation was accepted by the stop rule rather than that discovery selected
nothing — all three ablations did select profiles, and this artifact names them.
The evidence verifier recomputes the digest, checks that each recorded ablation
was authorised by its predecessor, re-derives every repeated-recovery verdict —
group, stratum, aggregate, outcome label, resolution claim, and confirmation
aggregates — together with each stop reason and each matched-pair support
decision from the archived per-run measurements under Task 24's frozen
boundaries, resolving the pair's selection, safety, and regret inputs from the
ablation's own grid rows rather than from the pair's copies of them, and
re-derives the terminal outcome from the recorded stop verdicts rather than
reading it. The historical single-renderer sweeps reproduce their
recorded results exactly on this code — Direct 700 rejected, frontier 14,
`o0p450-t0p500-a0p200-x0p990-b1`; Tone 538 rejected, frontier 3,
`o0p500-t0p500-a0p200-x0p970-b1` — and every frozen Task 08, 10, 11, 22, and 24
artifact still verifies. Unit, verifier, and production build checks pass.

### Task 27 — Run the round-two search and freeze the candidate manifest

**Status:** Completed August 24, 2026, on the zero branch with reason
`no-ablation-accepted`. **Prerequisites:** Tasks 22-26 complete.

**Objective:** Search the ablation the evidence selected, over manifest version 2,
and freeze a candidate set under new immutable identifiers — or, when the evidence
produced no confirmable candidate, freeze that as the round's result.

**Work — branch selection:**

- Branch on Task 26's terminal outcome before doing anything else, not on whether
  some ablation passed the stop rule. `existing-grid-sufficient`,
  `existing-family-refinement-sufficient`, and `bass-axis-supported` take the
  nonempty branch. `bass-axis-unsupported` takes the zero branch in both of its
  forms — including the form where the bass grid passed the stop rule and selected
  profiles, because every one of those profiles needs an axis this outcome keeps out
  of the production shape, and their no-bass counterparts are the refined grid that
  already failed at ablation two. A passing ablation is not by itself a registrable
  candidate set.
- Record the zero branch's reason code with it, because the two forms are not the
  same finding: `no-ablation-accepted` when the stop rule accepted nothing, and
  `no-supported-parameterization` when it accepted a grid whose only selected
  profiles depend on an unsupported parameterization. Task 29 reads this code and
  must not describe the second as discovery having selected nothing.
- Do not lower the stop rule, and do not register a bass-axis profile under a
  compatibility default in order to reach the nonempty branch. A round with nothing
  it can both register and confirm is a result, and Task 29 is written to record it.
- Both branches keep the Task 08 rule that a `confirmation` trace is never
  captured, and that a unit test fails the capture function if one is ever
  requested.
- Both branches keep `DEFAULT_LISTEN_MATCHER_PROFILE_ID` at `baseline-v1`.

**Work — zero branch only:**

- Search nothing. Emit a candidate manifest with zero entries, add no `v3`
  identifiers, leave the registry at version 2 and byte-identical, and record the
  Task 26 outcome and the reason code that produced this branch.
- Under `no-supported-parameterization`, leave what the passing bass grid selected
  in Task 26's frozen ablation artifact and reference that artifact's digest as
  `task26EvidenceDigest`. Those profiles are the evidence that the axis was tried
  and did not separate, and a later round should not have to rediscover them — but
  they belong to the ablation that measured them, not to a candidate manifest that
  by definition has no entries. Write no placeholder Task 27 search archive to hold
  them.
- Emit no result archive. There is no search to archive, and a placeholder archive
  would later read as a search that found nothing rather than one that never ran.

**Work — nonempty branch only:**

- Search the earliest Task 26 ablation the stop rule accepted. Adopting a later,
  larger grid when an earlier one already suffices adds parameters the evidence did
  not ask for.
- Apply the selection rule exactly as Task 24 froze it, against the
  global-versus-spread verdict Task 26 computed on version-2 discovery results.
  Nothing about the objective, the complementarity measure, the candidate count, or
  the materiality boundary is decided in this task.
- Report the rejection census beside round one's, and state which axis each new
  rejection is attributable to.
- Add the selected profiles under new `v3` identifiers at registry version 3. Every
  `v1` and `v2` entry stays byte-identical, including the four rejected candidates,
  which remain replayable comparison columns.
- Freeze the full result archive, its canonical candidate digest, its file SHA-256,
  the generator version, the grid size, the manifest hash, and the commit before any
  confirmation replay.

**Work — both branches:**

- Emit the frozen candidate manifest as the first link of an immutable artifact
  chain: candidate identifiers, registry version, policy version, trace-manifest
  version, generator version, ablation identifier, round identifier,
  `task26TerminalOutcome`, `task26EvidenceDigest`, `notRunReason` — null on the
  nonempty branch — and its own digest over all of them. It records candidacy only.
  It carries no eligibility field, and no later task writes to it; Task 28 emits a
  separate artifact that references this digest. The zero branch emits the same
  shape with an empty candidate list, so every downstream consumer reads one schema.
- Put the terminal outcome and the not-run reason inside this manifest's digest
  rather than introducing them downstream. A reason that first appears in Task 28's
  artifact could be relabelled from `no-supported-parameterization` to
  `no-ablation-accepted` — a materially different finding — with every digest still
  verifying. Anchoring both here, over the Task 26 evidence digest they were derived
  from, makes that relabelling detectable.

**Verification — nonempty branch:** Run the search twice in fresh browser processes
and require identical frontier identifiers, metrics, rejection codes, and selected
candidate identifiers under the Task 04 identity rules. The historical sweeps still
reproduce. A test asserts the candidate manifest is immutable once written. Full
suite and build pass.

**Verification — zero branch:** Reproduce Task 26's terminal outcome rather than
asserting it, so the branch rests on a rerun rather than on a recorded conclusion:
under `no-ablation-accepted` reproduce the stop rule rejecting every ablation, and
under `no-supported-parameterization` reproduce both the grid passing the stop rule
and no selected profile separating from its matched twin. Assert that the candidate
manifest holds zero entries and a stable digest across two emissions, that
`LISTEN_MATCHER_REGISTRY_VERSION` is still 2 and every registry entry
byte-identical, that no `v3` identifier exists, that no result archive was written,
and that no confirmation trace was read. Full suite and build pass.

**Complete when:** Either a reproducible round-two candidate set exists under new
identifiers with a frozen, digest-bearing candidate manifest; or the zero branch is
recorded with an empty digest-bearing manifest, an untouched registry, and no
search archive. In both branches earlier generations are unchanged, the default is
still baseline, and the confirmation partition remains unread by the selection
path.

**Completion evidence:** Task 26's terminal outcome is `bass-axis-unsupported`,
so this task took the zero branch and searched nothing. The frozen manifest is
`benchmark-results/listen-round-two-candidate-manifest-task27.json`: zero
candidates, `notRunReason` `no-ablation-accepted`, `ablationId` null,
`task26TerminalOutcome` `bass-axis-unsupported`, `task26EvidenceDigest`
`8dfe2f1b`, registry version 2 at generation digest `d1b3f6a3`, policy version 1
`840b07ec`, trace manifest version 2 `d1971fa3` over musical corpus `1213016e`,
generator version 1, its own digest `fnv1a-32-canonical-json:21655efa`, and file
SHA-256 `4016355ba98cdd4962f7196dbb7f75f8c1fc49bb3be9ef3f1ea66f1f0b701a9e`. Both the
terminal outcome and the reason code are inside that digest, over the Task 26
evidence digest they were derived from, so relabelling
`no-ablation-accepted` as `no-supported-parameterization` downstream cannot leave
every digest verifying. The record carries no eligibility field.

The branch rests on a rerun rather than on Task 26's recorded conclusion.
`reproduceListenRoundTwoAblationEvidence` rebuilds the repeated-chord census from
the fixtures, refuses an artifact whose census, policy hash, manifest hash, or
generator version differs from this commit's, recomputes each ablation's
repeated-recovery evaluation from both sides of its archived measurements,
reapplies Task 24's frozen stop rule to those evaluations, recomputes each
matched-pair support decision from the ablation's own grid rows, derives the
terminal outcome from the recomputed verdicts, and recomputes the Task 26 evidence
digest — throwing wherever the artifact's stored conclusion disagrees. Both
committed repetitions rerun to the same three rejections
(`selected-set-has-no-material-repeated-recovery` at every stage), the same
outcome, the same evidence digest, and therefore the same manifest; the emitter
requires at least two repetitions and refuses a manifest only one of them
supports. Emitting twice reproduces the file byte for byte, and re-emission over
an existing file is checked for equality rather than allowed to revise it.

The registry is untouched, and that is enforced by identity rather than by proxy.
The manifest records `registryDigest` `d1b3f6a3`, taken over the registry version,
the default identifier, the fixed timing policy every profile shares, and each
identifier in registry order with its complete threshold set; a moved `v1` or `v2`
threshold, a reordered identifier list, an added entry, or a removed one all move
it and fail emission, as do a bumped `LISTEN_MATCHER_REGISTRY_VERSION`, any `v3`
identifier, a moved `DEFAULT_LISTEN_MATCHER_PROFILE_ID`, and a production
threshold shape that has gained the experimental bass axis. No result archive was
written; the verifier fails if any Task 27 file other than the manifest appears in
`benchmark-results`.

The nonempty branch is refused outright rather than half-implemented. Its
candidates must come from the search of the accepted ablation and be registered as
new `v3` identifiers at registry version 3, frozen against that search's own
result archive, and none of that exists because the evidence did not take that
branch. The emitter therefore accepts no candidate list at all: taking one would
let already-registered identifiers — round one's rejected `v2` candidates among
them — be recorded as this round's selection with nothing having selected them.
The manifest schema still declares the fields that branch fills, so a later round
emits one shape. The confirmation partition stayed unread: every ablation
records zero confirmation traces read, every recomputed evaluation reports
`confirmationReproductionStatus` `not-run`, and `captureListenMultiDomainTrace`
now throws on a `confirmation` descriptor, with a unit test that fails when that
guard is removed.

Verification: `node tools/online_amt/verify_listen_benchmark_evidence.mjs` passes
over all eight artifacts, independently rerunning the stop rule over both Task 26
archives and re-deriving the manifest's outcome, reason, ablation, and evidence
digest from that rerun. 23 unit tests cover the manifest module — both zero-branch
forms, the declared schema, the nonempty branch's refusal, every way a registry can
stop being the searched generation, the immutability rule, and each recomputation
refusal — and four verifier tests cover the committed files. The full suite and the
production build pass.

### Task 28 — Execute the round-two frozen automated confirmation

**Status:** Required. **Prerequisites:** Task 27 complete.

**Objective:** Produce the confirmatory automated evidence for the round-two
candidates, on the version-2 confirmation partition, under the Task 23 policy, and
emit the eligibility manifest the live and decision tasks consume.

**Work:**

- Take the not-run branch first when Task 27's candidate manifest is empty. Do not
  decode the confirmation fixtures, do not run the matrix, and do not touch the
  corpus in any way. Emit the eligibility manifest under
  `runStatus: "not-run-no-confirmable-candidate"`, carrying Task 27's reason code
  and referencing the empty candidate manifest's digest, so the artifact chain stays
  intact and Tasks 14, 15, and 29 read one schema in every branch. Assert that the
  reason carried here matches `notRunReason` in the candidate manifest exactly, and
  that `task26TerminalOutcome` and `task26EvidenceDigest` resolve; a mismatch is a
  broken chain, not a detail to reconcile. This branch is the point of the whole
  ordering: the version-2 confirmation fixtures are the round's only genuinely
  unseen evidence, they can be spent exactly once, and spending them on a round that
  produced no registrable candidate — whether discovery selected nothing, or
  selected only profiles that depend on an unsupported axis — would burn them for
  nothing. They
  stay unobserved and remain valid confirmation evidence for a later round.
- Otherwise resolve the chain before decoding anything, so the Task 26 evidence root
  is mandatory in this branch too and not only in the not-run one. Assert that
  `task26EvidenceDigest` resolves to the frozen ablation artifact, that
  `task26TerminalOutcome` matches the outcome that artifact records, that
  `notRunReason` is null, and that the candidate set came from the accepted ablation
  that artifact names. A candidate manifest whose candidates do not trace back to an
  accepted ablation is not confirmable evidence regardless of how well formed it is.
- Then decode the confirmation fixtures, for the first time. Task 25 deliberately
  left them undecoded, so this run is their first inference pass; a fixture that
  fails to render or decode restarts the round rather than being replaced.
  Everything below describes this branch.
- Follow Task 13 exactly: freeze the preflight record before the first run, naming
  the measured commit and its clean worktree, the browser and its version, the
  operating system, the Node version, the model path and its SHA-256, the registry
  version, the candidate manifest and its digest, the policy version, the
  trace-manifest version and hash, the generator version, the exact commands, and
  the expected baseline.
- Run the complete validation matrix twice, archive both runs, record both SHA-256
  values and the canonical comparison digest, and compare them with the evidence
  verifier.
- Update the verifier's completeness requirements to the round-two registry version,
  manifest version, candidate manifest digest, policy version, and trace census, so
  neither a round-one archive nor a narrowed smoke can be quoted as this task's
  evidence. Include the Task 23 rule that a complete run with a required gate
  unapplied fails rather than yielding an eligible candidate.
- Report results on the newly authored confirmation fixtures separately from results
  on the repartitioned observed corpus. A result on genuinely unseen material must
  never be aggregated with a result on material the search could see.
- Within that unseen report, give every repeated-chord paired group its own baseline
  and candidate source distance, attribution delay, false/skipped/duplicate counts,
  and per-pitch qualification path. Apply Task 24's reproduction predicate to the
  baseline column before interpreting candidate recovery, without re-estimating any
  boundary. A group that reproduces the phenomenon participates in the frozen
  no-regression and resolution rules; a structurally valid group that does not is
  marked `inconclusive-for-repeated-recovery`, remains correctness and safety
  evidence, and is neither swapped nor treated as a reason to restart. Failure of a
  reproducing group's confirmation no-regression condition makes a candidate
  ineligible. Material partial recovery is labelled as such, and
  `confirmed-full-resolution` is emitted only if every reproducing known,
  discovery, and confirmation group passes and at least one confirmation group
  reproduced the phenomenon. Keep the correct, omitted-bass, and
  distinguishable-wrong members adjacent so a recovery cannot be reported without
  its matched safety cost.
- Report round-one and round-two gate outcomes side by side, including whether the
  policy change altered any verdict, and label discovery against confirmation
  evidence.
- Emit a new eligibility manifest rather than editing Task 27's artifact, and give
  its schema an explicit `runStatus` discriminator so the two branches cannot be
  confused with each other. Under `runStatus: "completed"` the candidate entries and
  the confirmation-evidence fields — both archive hashes and the canonical
  comparison digest — are required. Under
  `runStatus: "not-run-no-confirmable-candidate"` the entry list must be empty and
  those evidence fields are forbidden, while the candidate-manifest digest stays
  required, as does a `reason` of `no-ablation-accepted` or
  `no-supported-parameterization` carried through from Task 27. Keeping the status
  binary and the distinction in `reason` means every consumer branches once on
  `runStatus`; only Task 29's recorded conclusion reads the reason. One
  undifferentiated schema would instead force the not-run branch to invent
  placeholder archive hashes for a run that never happened, which is exactly the
  fabricated evidence this chain exists to prevent. Both forms reference the
  candidate manifest's digest and bear their own; Tasks 14, 15, and 29 consume this
  artifact and must branch on `runStatus` rather than on an empty list.
- Require every completed candidate entry to carry Task 24's
  `repeatedRecoveryOutcome` and `confirmationReproductionStatus`, derived from the
  per-group records and covered by the eligibility-manifest digest. The not-run
  form carries no candidate entry and therefore no invented recovery result.
- Do not alter candidate values, fixtures, attribution, or gates after viewing the
  first run, and do not change the production default in this task.

**Verification:** Both repetitions satisfy the Task 04 identity rule, baseline
parity passes in every domain, the full suite and the production build pass on the
measured commit, and the report carries the preflight record, both archive hashes,
and the shared comparison digest. The newly authored repeated-chord confirmation
groups were decoded exactly once, their individual rule outcomes reproduce in both
runs, and no stratum is hidden by the summary. A zero-reproduction confirmation
result withholds `confirmed-full-resolution`, preserves every fixture, and does not
restart the round. Both digest links resolve —
eligibility manifest to candidate manifest, candidate manifest to the Task 26
ablation artifact — and the terminal outcome, the null `notRunReason`, and the
originating ablation agree across all three. A test asserts the Task 27 candidate
manifest is byte-identical after this task ran.

Under the not-run branch, verify instead that no confirmation trace was decoded:
the version-2 confirmation fixtures carry no recorded decoded-structure hash, the
manifest's first-observed ledger is unchanged, and the empty eligibility manifest
chains to the empty candidate manifest's digest. The full suite and the production
build still pass.

**Complete when:** Either the round-two matrix is repeated, documented, and yields
a stable eligibility set with no post-result retuning, with the unseen-fixture
results and repeated-chord resolution labels reported on their own; or the not-run
branch is recorded with the confirmation partition provably untouched. In both
branches an eligibility manifest is frozen and chained to the candidate manifest.

### Task 29 — Make the round-two production decision

**Status:** Required. **Prerequisites:** Task 28 complete, and Tasks 14-15 complete
if the eligibility manifest holds any automated-eligible candidate.

**Objective:** Make one auditable global-default decision, and produce the
approved-profile list that any later calibration depends on.

**Work:**

- If the eligibility manifest holds an eligible candidate, Task 15 is no longer
  deferred: collect the live acoustic and digital corpus with the Task 14 harness
  against that manifest, then apply the Candidate selection rule in its stated
  order, with the Task 23 material-improvement requirement for promotion.
- Change only `DEFAULT_LISTEN_MATCHER_PROFILE_ID`, keeping every earlier profile in
  the registry for rollback and historical replay, and update the diagnostics,
  README, benchmark index, and listening report with the selected identifier, its
  evidence, its known limitations, and the rollback instruction.
- Emit the versioned approved-profile list as the third link of the artifact chain,
  referencing the eligibility manifest's digest. Define its membership exactly:
  `baseline-v1`, plus every candidate that passed all automated gates and all
  required live gates. It is not the set containing only the chosen default, and it
  is not the registry — the registry retains every historical and rejected profile,
  so membership there is not approval. A profile that passed automated gates but
  failed or skipped its live gates is not a member. The selected default must be a
  member. Only members may be offered by any later calibration path.
- If no candidate passes, record the bounded conclusion and nothing wider, choosing
  it by `runStatus` and, in the not-run branch, describing it by `reason`. A
  confirmation matrix that ran and rejected every candidate is
  `round-two-candidate-set-exhausted`. A `not-run-no-confirmable-candidate` state is
  `round-two-grid-produced-no-eligible-improvement` under either reason, but the two
  are not described alike: `no-ablation-accepted` means no ablation was accepted by
  the stop rule, which is not the same as discovery having selected no profiles —
  an ablation that failed the stop rule may still have search-selected profiles,
  and Task 26's record names them. `no-supported-parameterization` means an
  ablation was accepted and did select profiles, none of which could be both
  registered and confirmed, because each depended on an axis the ablation did not
  support. Do not write either up as though nothing was found: report what each
  ablation selected, which rule refused it, and why it was not registrable.
  In both not-run reasons, say explicitly that the version-2 confirmation fixtures
  remain unobserved and stay available to a later round. Task 28 confirms the frozen
  candidate set, not every safe profile in the searched grid, so concluding that the
  scalar-threshold family is exhausted would require confirming every globally safe
  non-dominated profile needed to support that statement, which no branch does.
- Route the model-evidence residual to a written new-plan requirement rather than
  to an existing task. Under a second no-candidate result, Task 21 is unreachable
  because it requires Task 17 and Task 17 requires an approved alternative; do not
  name it as the next step. Emit the same requirement alongside a promoted profile
  whenever the round ends at material partial recovery or cannot award
  `confirmed-full-resolution`, because shipping a safer threshold does not resolve
  the recorded missing re-onset. The evidence statement must include both decoder
  defects Task 22 carries: onset evidence on a bass pitch that was never sounded,
  and no D5/74 re-onset across the first two physically repeated chords. The latter
  is the same retrigger limitation the August 14 score-rise experiment could not
  correct safely, not an unclassified threshold symptom. The acceptance question
  is whether decoder/model evidence can expose the first real repeated attack for a
  still-ringing required pitch while refusing an unsounded bass, reaching source
  distance 0 without adding false, skipped, or duplicate advances on the paired
  corpus. Model work remains a non-goal here, so produce the requirement as this
  task's output and do not append it as a task in this plan.
- Record what the round changed regardless of its verdict. Round one's candidates
  cleared the Task 06 false advance the shipped default still carries, improved 16
  of 21 leaf domains, and cut late advances from 8 to 2; a round that only tightens
  gates and recovers none of that has not advanced the product. State the repeated-
  chord result by copying both frozen eligibility fields:
  `repeatedRecoveryOutcome` and `confirmationReproductionStatus`. Do not describe
  source distance 1, `discovery-full-resolution`, or
  `inconclusive-no-reproduction` as fixing `v05`, and carry any remaining
  distance-zero limitation into the selected profile's documented known limitations
  or the bounded no-candidate conclusion.
- Do not add calibration persistence or user-facing calibration in this task.

**Verification — when the eligibility manifest is `completed`:** Full unit suite,
production build, canonical paired isolated smoke, complete sequence validation,
dynamics and articulation matrix, and the safety regressions for whichever profile
production ends on. This branch covers both a promoted candidate and a `completed`
run that rejected every candidate, exactly as Task 16 verified the retained
`baseline-v1` in round one; the confirmation corpus has already been spent either
way, so the matrices cost nothing they were preserving. Confirm that ordinary
listen mode resolves and reports that identifier — the selected profile, or
`baseline-v1` where none was promoted — and that the approved-profile list contains
exactly the profiles the evidence approved under the membership rule above, chained
to the eligibility manifest's digest.

**Verification — when the eligibility manifest is
`not-run-no-confirmable-candidate`:** Run the full unit suite and the production
build only. Confirm that `DEFAULT_LISTEN_MATCHER_PROFILE_ID` is still `baseline-v1`,
that the approved-profile list is exactly `[baseline-v1]`, that all three digest
links resolve — approved list to eligibility manifest, eligibility manifest to the
empty candidate manifest, candidate manifest to the Task 26 ablation artifact — and
that the terminal outcome and the reason agree at every step of that chain. The
third link matters most under `no-supported-parameterization`, because the Task 26
artifact is where the passing bass grid's measurements live, and a conclusion that
cites them while its link to them dangles is not auditable. Confirm also that no
live corpus was collected, and that the version-2
confirmation partition is untouched: its first-observed ledger unchanged and no
decoded-structure hash recorded for any confirmation fixture. Do not run the
isolated, sequence, or dynamics matrices in this branch. There is no selected
profile for them to validate, and running them over a corpus this round
deliberately preserved would spend the evidence the not-run branch exists to keep.

**Complete when:** Production either runs one fully validated named default or
retains baseline with a conclusion bounded to what this round measured, an
approved-profile list exists with defined membership, the residual work is carried
either by a reachable task or by a written new-plan requirement, and rollback still
requires changing only the default identifier.

## Production rollout and rollback

The selected global profile must be one registry constant and one default ID.
Retain `baseline-v1` in the registry for at least one release so a regression can
be reproduced and the default can be rolled back without reconstructing values
from benchmark history.

For the first release with a changed default:

- Include the effective profile ID in local diagnostics.
- Keep audio local and add no automatic telemetry.
- Ask testers to export explicit, redacted benchmark diagnostics for missed or
  false advancements.
- Classify every report as model-evidence absence, threshold rejection,
  carry-over/retrigger, extra-note rejection, or matcher/playhead cascade before
  changing values again.

Do not silently retune the profile between releases. Any value change creates a
new profile ID and repeats the frozen discovery/confirmation and live safety
validation.

## Completion criteria

The global matcher-profile phase is complete when:

- Production and every benchmark consume the same versioned profile registry.
- `baseline-v1` replay exactly reproduces the previous production baseline.
- The `v05` late recovery and the Tone 333 ms false advancement are diagnosed and
  covered by deterministic regressions with their distinct semantics.
- Round two evaluates the `v05` mechanism through per-pitch onset and active-target
  qualification, a preregistered repeated-chord recovery rule, and newly authored
  discovery/confirmation paired groups. Any promoted profile states whether it
  achieved only material partial recovery, lacked a reproducing confirmation group,
  or reached `confirmed-full-resolution`; every unresolved missing re-onset is
  carried into Task 29's decoder/model-plan requirement.
- The multi-domain discovery/confirmation manifest, hierarchical weights, and
  safe Pareto selection are frozen and reproducible.
- Newly selected candidates have immutable versioned IDs; the first-generation
  `balanced-v1` and `sensitive-v1` values remain unchanged historical references.
- The frozen candidate matrix has two full repetitions satisfying the Task 04
  identity rule and reports discovery versus confirmation domains separately.
- The selected candidate passes every automated and live safety gate.
- At least one acoustic and one digital setup have held-out live results.
- The selected default and rejected alternatives are documented with exact
  evidence.
- Production build and the full unit/browser regression suite pass.
- Rollback requires changing only the default profile ID.

A round that ends without an eligible candidate does not satisfy these criteria;
it closes that round only, and its conclusion must be bounded to what that round
measured. A confirmation pass evaluates the frozen candidate set, not every safe
profile in the searched grid, so `round-two-candidate-set-exhausted` and
`round-two-grid-produced-no-eligible-improvement` are admissible while a claim
that the scalar-threshold family as a whole is exhausted is not, unless every
globally safe non-dominated profile needed to support it has been confirmed. The
retained default's own known limitations are documented beside whichever
conclusion is recorded, and the residual work is carried either by a task whose
prerequisites can actually be met or by a written requirement for a new plan.

The calibration phase is complete only when:

- Split-sample experiments show repeatable confirmation-set benefit over the
  global default with no safety loss.
- The wizard selects only globally approved profiles and includes negative trials.
- Invalid, missing, stale, or failed calibrations fall back safely.
- Saved preferences contain no audio or raw device identity.
- Reset/recalibration and matcher lifecycle behavior are tested.
- User-facing documentation accurately describes local processing and fallback.

If the split-sample experiment does not demonstrate stable benefit, explicitly
close the calibration phase as `fixed-profile-sufficient` and ship only the
validated global default.
