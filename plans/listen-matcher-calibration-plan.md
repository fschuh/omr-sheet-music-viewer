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

## Numbered execution tasks

Execute exactly one numbered task per implementation pass. A pass begins by
checking the stated prerequisites and ends after the task's verification and
completion condition are satisfied. Do not start the next task merely because a
safe subset of it is convenient. When a task changes a measured browser result,
record the command, commit, renderer/model identity, result hashes, and concise
summary in the appropriate benchmark report before closing the pass.

Tasks 01-06 are complete. Tasks 18-20 are conditional: execute them only if Task
17 concludes `calibration-justified`. If Task 17 concludes
`fixed-profile-sufficient`, mark Tasks 18-20 skipped with that decision as their
completion evidence. Task 21 is a separate later research branch and is not
required to ship the validated global profile or the approved-profile calibration
selector.

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
- Capture target-independent decoded frames once and replay `baseline-v1` and
  every automated-eligible candidate from Task 13; do not repeat a performance
  per profile.
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

**Complete when:** A single real performance produces reproducible frozen-matrix
matcher results and a complete redacted export suitable for the live release
corpus.

### Task 15 — Execute the acoustic and digital live validation corpus

**Status:** Required; requires a person, instruments, and microphone setups.
**Prerequisites:** Task 14 complete and at least one automated-eligible candidate
from Task 13. If none is eligible, record `no-safe-candidate` and proceed directly
to Task 16 without changing the default.

**Objective:** Test whether automated-eligible candidates remain safe and useful
under real instrument, microphone, room, register, dynamics, chord, articulation,
and tempo variation.

**Work:**

- Freeze a trial manifest before recording. Include at least one acoustic and one
  digital piano, preferably two microphone/room setups.
- Include low/middle/high single notes at soft/medium/loud dynamics; dyads,
  triads, and larger chords; repeated notes/chords; shared bass/upper notes;
  detached/normal/legato transitions; and playable 1000/500/333/250 ms passages.
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

**Status:** Required. **Prerequisites:** Tasks 13 and 15 complete, or Task 13 has
already produced `no-safe-candidate`.

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

### Task 17 — Run the calibration feasibility experiment and make a go/no-go decision

**Status:** Required research decision. **Prerequisites:** Tasks 15-16 complete.

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
