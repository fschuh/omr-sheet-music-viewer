# Listen matcher profiles and instrument calibration plan

## Decision summary

The next production improvement should come from a validated matcher profile, not
from more runtime tuning, recurrent-state resets, onset buffering, or score-rise
retrigger detection. The existing threshold sweep identified two credible
candidates, but the winning profile was selected on the same direct-renderer
corpus used to measure it. Before changing the production default, replay the
candidates against the newer Tone, dynamics, articulation, isolated-wrong-note,
and live-input data as a held-out validation set.

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

- Replace the current measurement-only threshold recommendation with a
  production-ready profile decision backed by held-out automated and live-input
  validation.
- Keep one safe global default for uncalibrated users, changed devices, invalid
  calibration records, and rollback.
- Define a small versioned registry containing the current, balanced, and
  sensitive matcher profiles so production and benchmarks cannot drift.
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

The production matcher options currently live in `webapp/src/onlineAmtOutput.ts`
and are passed to `ExactChordMatcher` by `webapp/src/App.tsx`:

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

These numbers are selection-set results, not held-out evidence. The later paired
renderer and dynamics runs used only the production profile. They therefore form
the most useful existing validation domains:

- Direct isolated recognition passes at 104/106; Tone reaches only 100/106 and
  fails the fixed 95% gate.
- Dynamics independent recognition remains near 90%, while ordered advancement
  falls to approximately 41-46%, confirming substantial matcher/playhead cascade.
- Tone plus Salamander `v05` produces one deterministic false advancement under
  the current profile. This must be understood and preserved as a regression case
  before a more sensitive profile is selected.
- Recognition changes non-monotonically across velocity layers. Calibration
  cannot be reduced to one microphone-gain adjustment.
- Browser inference already stays comfortably below the 32 ms input cadence, so
  matcher validation has priority over more runtime benchmarking.

## Matcher profile ownership

Create a production-neutral module such as
`webapp/src/listenMatcherProfiles.ts`. Move the `ListenMatcherProfile` type and
the named production candidates there so benchmark code no longer owns the
profile contract.

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

The exact names may change, but they must be stable, versioned identifiers rather
than UI labels. Keep the registry immutable and validate every numeric value as a
finite number in the range 0-1. `requireFreshBassOnset` remains structurally true
for every production-eligible profile; arbitrary benchmark sweep profiles may
still test false without becoming registry entries.

Add one explicit `DEFAULT_LISTEN_MATCHER_PROFILE_ID`. It remains `baseline-v1`
until the held-out and live gates pass. Changing the default is then one reviewed
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
- `listenProfileValidationBenchmark.ts`: evaluate only the three preselected
  candidates on the held-out Tone, dynamics, and live-input data. Running another
  1,000-way search and selecting a new winner on that data would turn the
  validation set into another tuning set rather than providing independent
  confirmation.
- `listenDynamicsBenchmark.ts`: replace the hardcoded
  `replayListenSequenceTrace(..., "current-matcher")` result with a profile matrix
  or retain the trace once and produce an adjacent result for each requested
  profile.
- Articulation and inference-reset reports: add profile metadata. Replay the
  three candidates where matcher output is relevant; do not rerun the rejected
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
- Per-speed, per-family, per-piano, and per-layer breakdowns rather than only a
  combined score.

Before comparing candidates, replay `baseline-v1` and require exact parity with
the stored/current production result for every event and summary field. A parity
failure blocks the comparison because it means the harness, not the profile,
changed.

## Tone plus Salamander `v05` safety investigation

Treat the current deterministic false advancement as the first implementation
task, not as an aggregate footnote.

1. Rerun the exact Tone plus Salamander `v05` constant-layer trace and identify
   the target index, source attack, advancement timestamp, generation, relevant
   onsets, active evidence, note events, carry-over set, and confidence values.
2. Decide whether it is a genuine matcher false advancement or a benchmark
   attribution error. Do not change classification windows merely to make the
   counter disappear.
3. If it is a matcher error, minimize the relevant recognition frames into a
   compact deterministic regression fixture. If it is attribution-only, add a
   regression for the corrected attribution rule and retain the original trace
   explanation in the report.
4. Replay all three registered profiles against the minimized case.
5. Add the case to the production-candidate safety summary so future sweeps cannot
   report zero safety while omitting this known domain.

The full piano PCM does not need to become a new committed fixture if a compact
decoded recognition trace reproduces the behavior exactly.

## Held-out automated validation matrix

Freeze the candidates, fixtures, metrics, and gates before running this matrix.
Do not change candidate values after seeing a subset of the results; a changed
candidate starts a new validation round.

Run `baseline-v1`, `balanced-v1`, and `sensitive-v1` against:

1. The complete isolated correct, distinguishable-wrong, ambiguous, omitted-bass,
   and Course Clear fixture corpus under Direct and Tone.
2. All 13 continuous sequence families at all six speeds under Direct and Tone.
3. The four Splendid and 16 Salamander constant layers under Direct and Tone.
4. The four mixed-dynamics runs.
5. Detached, normal, legato, and sustained-shared articulation traces.
6. The known `v05` safety regression.
7. Existing carried-bass, wrong-note, extra-note, skip, duplicate, and stale
   carry-over safety families.

The newer Tone and dynamics domains are held out relative to the August 13
threshold selection. Keep them out of any new parameter search until the
production-candidate decision is complete.

## Automated acceptance gates

A candidate is production-eligible only if all gates pass independently. Do not
trade a safety regression for a higher aggregate recognition rate.

### Replay integrity

- Baseline replay is event-for-event identical to current production output.
- All compared profiles use identical trace/PCM hashes, frame counts, renderer,
  model, target schedule, and decoder output.
- Two complete repetitions produce identical summaries and failure identities.

### Safety

- Dedicated distinguishable-wrong, extra-note, skipped, duplicate, and
  incomplete-carried-bass counts remain zero at every speed under both renderers.
- No candidate adds a false, skipped, or duplicate advance to any dynamics or
  articulation run relative to baseline.
- The diagnosed `v05` case does not worsen.
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
- Latency distributions and processing backlog remain within existing limits.

## Candidate selection rule

Apply the gates first. Rank only eligible profiles.

Use this decision order:

1. Fewer live distinguishable false advances and safety failures.
2. Higher held-out live correct advancement.
3. Higher automated independent recognition across renderers and instruments.
4. Higher ordered prefix and complete-passage results.
5. Lower latency.
6. Smaller distance from the current production profile.

Prefer `balanced-v1` when its held-out result is effectively tied with
`sensitive-v1`. The sensitive profile should become the default only when its
additional independent/live improvement is repeatable across domains and not
merely a larger ordered-cascade gain.

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
- Results for every registered profile.
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

Use one captured performance per trial and replay every candidate against it.
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

The wizard may choose `baseline-v1`, `balanced-v1`, or `sensitive-v1`. If no
candidate beats the default on confirmation data, if a negative case advances, or
if too few trials are completed, save the default or no calibration.

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
instrument-dependent domain shift that the three approved profiles cannot cover.

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
- Adjacent profile results using one identical trace.
- The minimized `v05` regression.
- Candidate safety summaries and per-domain acceptance gates.
- Calibration-block selection and untouched confirmation-block evaluation.
- Correct-only calibration being rejected when no negative safety trials exist.
- Settings rendering and calibration lifecycle behavior if the UI phase ships.

Keep tests deterministic. Unit tests may use compact decoded frames; browser tests
must assert PCM/trace hashes before comparing profile results.

## Browser automation and reports

Add explicit automation modes rather than changing historical commands in place:

```text
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
- Complete safety counts including `v05`.
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

Tasks 15-17 are conditional. Execute them only if Task 14 concludes
`calibration-justified`. If Task 14 concludes `fixed-profile-sufficient`, mark
Tasks 15-17 skipped with that decision as their completion evidence. Task 18 is a
separate later research branch and is not required to ship the validated global
profile or the approved-profile calibration selector.

### Task 01 — Create the production-neutral matcher profile registry

**Status:** Required. **Prerequisites:** None.

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

### Task 02 — Extract the exhaustive sweep into its own benchmark module

**Status:** Required. **Prerequisites:** Task 01 complete.

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

### Task 03 — Migrate production and benchmark consumers to the registry

**Status:** Required. **Prerequisites:** Tasks 01-02 complete.

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
confirm their PCM, recognition, and latency identities are unchanged.

**Complete when:** There is one profile type and conversion path, production still
uses `baseline-v1`, historical operations explicitly identify their reference
profile, and no behavior or measured baseline changes.

### Task 04 — Establish exact baseline replay and build parity

**Status:** Required. **Prerequisites:** Task 03 complete.

**Objective:** Create the invariant that later candidate results differ only
because of profile values, not because Tasks 01-03 changed rendering, inference,
decoding, replay, or reporting.

**Work:**

- Add event-for-event baseline parity assertions for isolated trials and
  continuous sequence traces.
- Add baseline profile metadata and parity assertions to dynamics and articulation
  trace replay.
- Compare events, attacks, classifications, advancement timestamps, safety
  counters, latency values, trace/PCM hashes, and summary fields.
- Retain explicit expected constants for the canonical Splendid `mp` Direct/Tone
  smoke so shared-code drift cannot update both sides of a self-comparison.
- Record a post-refactor parity entry in the listening benchmark report; do not
  replace historical measured sections.

**Verification:** Run the full unit suite, production build, canonical paired
isolated smoke, sequence regression, dynamics smoke, articulation regression, and
the extracted 1,000-profile sweep. Every baseline comparison must be exact except
where the existing renderer tolerance explicitly permits one Float32 ULP.

**Complete when:** All baseline parity assertions pass and the report records that
the registry/extraction refactor produced no recognition, safety, latency, PCM, or
export changes.

### Task 05 — Diagnose and preserve the Tone plus Salamander `v05` safety case

**Status:** Required. **Prerequisites:** Task 04 complete.

**Objective:** Determine whether the deterministic `v05` false advancement is a
real matcher failure or an attribution error, then make it a permanent safety
regression before comparing more sensitive profiles.

**Work:**

- Reproduce only the Tone plus Salamander `v05` constant-layer run with
  `baseline-v1` and verify its PCM/trace hash against the measured dynamics report.
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
no longer be omitted from a zero-safety claim.

### Task 06 — Add isolated A/B/C profile replay

**Status:** Required. **Prerequisites:** Task 05 complete.

**Objective:** Compare `baseline-v1`, `balanced-v1`, and `sensitive-v1` on exactly
the same isolated correct and wrong-note evidence under both renderers.

**Work:**

- Change `listenBenchmark.ts` so an isolated trial retains a compact decoded trace
  and can replay a supplied named profile without rerendering or rerunning
  inference.
- Add an adjacent three-profile result for every correct, Course Clear,
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
Tone. Trace/PCM identities must match across profiles.

**Complete when:** All three profiles have deterministic adjacent isolated results
under both renderers, and no candidate has been selected or tuned from those
results yet.

### Task 07 — Add continuous-sequence A/B/C profile replay

**Status:** Required. **Prerequisites:** Tasks 05-06 complete.

**Objective:** Validate the frozen candidates across all sequence families and
speeds without rerunning the 1,000-profile search on held-out data.

**Work:**

- Create the sequence portion of
  `webapp/src/listenProfileValidationBenchmark.ts`.
- Capture each of the 13 families at all six intervals once per renderer, then
  replay the same trace through the three named profiles.
- Preserve independent, ordered, prefix, complete-passage, failure-reason,
  carry-over, latency, backlog, and all safety diagnostics.
- Report deltas from explicit `baseline-v1` per renderer, speed, and family.
- Assert that the candidate list comes only from the registry and contains exactly
  the three frozen IDs. Do not call grid generation or sweep ranking from this
  module.
- Add tests for trace reuse, per-domain aggregation, baseline delta calculation,
  and rejection of unknown/duplicate candidates.

**Verification:** Run a focused Direct and Tone sequence-validation smoke plus the
unit suite. Confirm all profiles share each run's trace hash and the baseline row
matches Task 04 exactly.

**Complete when:** The full sequence corpus can produce deterministic adjacent
A/B/C results without importing the sweep module or searching new parameter
values.

### Task 08 — Add dynamics and articulation A/B/C profile replay

**Status:** Required. **Prerequisites:** Task 07 complete.

**Objective:** Extend frozen-candidate validation to the later domains that were
not used to select the original sweep winner.

**Work:**

- Update `listenDynamicsBenchmark.ts` so each constant-layer and mixed-dynamics
  trace is captured once and replayed under all three named profiles.
- Cover four Splendid layers, 16 Salamander layers, both renderers, and all four
  mixed-dynamics runs.
- Extend articulation validation to detached, normal, legato, and
  sustained-shared traces without rerunning inference for each profile.
- Include per-renderer, per-piano, per-layer, mixed-profile, and articulation
  summaries plus baseline deltas.
- Integrate the Task 05 `v05` regression and ensure it appears in both focused and
  aggregate safety output.
- Add unit tests for equal-piano aggregation, trace reuse, layer-level regression
  visibility, and candidate metadata.

**Verification:** Run dynamics smoke under both renderers, one complete mixed
suite, articulation regression, full unit tests, and the production build. Every
profile comparison must share PCM and trace identities.

**Complete when:** All held-out dynamics/articulation domains produce deterministic
A/B/C results and no aggregate can hide a renderer, piano, layer, or articulation
regression.

### Task 09 — Build the unified production-candidate gate and automation

**Status:** Required. **Prerequisites:** Tasks 06-08 complete.

**Objective:** Combine isolated, sequence, dynamics, articulation, and known
safety results into one deterministic eligibility decision without selecting new
parameter values.

**Work:**

- Complete `listenProfileValidationBenchmark.ts` with result types and gate
  evaluation for the three named profiles.
- Implement all gates in the Automated acceptance gates section: replay integrity,
  zero dedicated safety failures, no new dynamics/articulation safety event,
  Direct at least 104/106 and 52/54, Tone at least 101/106 and 52/54, p95 below
  400 ms, per-speed independent non-regression, per-renderer ordered/complete
  non-regression, per-renderer/piano dynamics non-regression, and visible
  layer-level losses.
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

### Task 10 — Freeze and execute the held-out automated validation

**Status:** Required. **Prerequisites:** Task 09 complete.

**Objective:** Produce the confirmatory automated evidence used in the production
decision.

**Work:**

- Record the commit, model ID, profile registry version, candidate values,
  renderers, fixtures, gates, and expected historical baseline before running.
- Run the complete `listen-profile-validation` matrix twice on a clean local
  benchmark server.
- Compare repetition hashes, summaries, gate codes, failure identities, and
  recommendation inputs.
- Do not alter candidate values, fixtures, attribution, or gates after viewing the
  first run. Any such change invalidates both repetitions and restarts this task.
- Record Direct/Tone, speed/family, piano/layer, mixed-dynamics, articulation,
  `v05`, latency, and safety results in the listening report.
- Mark each candidate automated-eligible or rejected with exact gate reasons. Do
  not change the production default in this task.

**Verification:** Both repetitions are identical, baseline parity passes, the full
unit suite/build pass on the measured commit, and the report contains enough
metadata to reproduce the run.

**Complete when:** The held-out automated matrix is frozen, repeated, documented,
and yields a stable eligibility set without any post-result retuning.

### Task 11 — Build the structured developer live-input harness

**Status:** Required. **Prerequisites:** Task 10 complete.

**Objective:** Replace the under-specified manual counter with a privacy-preserving
trace capture and A/B/C replay tool suitable for acoustic and digital validation.

**Work:**

- Replace or extend the manual section in `ListenBenchmarkPage.tsx` with session
  and trial metadata defined in the Live-input validation harness section.
- Capture target pitches, deliberately played pitches, expected correctness,
  ambiguity, source/setup labels, register, chord size, dynamic, articulation,
  tempo, room/noise label, and trace-clock latency.
- Capture target-independent decoded frames once and replay the three named
  profiles; do not repeat a performance per profile.
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

**Complete when:** A single real performance produces reproducible A/B/C matcher
results and a complete redacted export suitable for the live release corpus.

### Task 12 — Execute the acoustic and digital live validation corpus

**Status:** Required; requires a person, instruments, and microphone setups.
**Prerequisites:** Task 11 complete and at least one automated-eligible candidate
from Task 10. If none is eligible, record `no-safe-candidate` and skip directly to
Task 13 without changing the default.

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
  Task 11. Document environmental limitations and incomplete trials.

**Verification:** Validate every export against the schema, reproduce matcher
summaries from each export, and independently review every safety event or
ambiguity. Confirm no source/setup is hidden by an aggregate.

**Complete when:** Both acoustic and digital results are reproducible and
documented, each candidate has explicit live gate outcomes, and the evidence is
ready for the selection rule.

### Task 13 — Select and roll out the global production profile

**Status:** Required. **Prerequisites:** Tasks 10 and 12 complete, or Task 10 has
already produced `no-safe-candidate`.

**Objective:** Make one auditable global-default decision and establish a rollback
baseline.

**Work:**

- Apply the Candidate selection rule in this plan: live safety, live correctness,
  automated independent recognition, ordered/complete behavior, latency, then
  distance from baseline.
- Prefer `balanced-v1` when effectively tied with `sensitive-v1`; do not select the
  sensitive profile solely for cascade-amplified ordered gains.
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

### Task 14 — Run the calibration feasibility experiment and make a go/no-go decision

**Status:** Required research decision. **Prerequisites:** Tasks 12-13 complete.

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
`fixed-profile-sufficient` result explicitly closes Tasks 15-17 as skipped; a
`calibration-justified` result authorizes them.

### Task 15 — Implement compatible calibration persistence and profile resolution

**Status:** Conditional on Task 14 returning `calibration-justified`.
**Prerequisites:** Task 14 complete with that exact conclusion.

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
inaccessible to ordinary users pending Task 16.

### Task 16 — Build the approved-profile calibration wizard and Settings lifecycle

**Status:** Conditional on Tasks 14-15. **Prerequisites:** Task 15 complete.

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
- Reuse the exact selection algorithm and gates validated in Task 14. The wizard
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

### Task 17 — Confirm the shipped calibration workflow on live instruments

**Status:** Conditional on Tasks 14-16. **Prerequisites:** Task 16 complete.

**Objective:** Verify that the actual Settings wizard and production matcher
reproduce the offline calibration benefit rather than only passing simulated
tests.

**Work:**

- Repeat at least one acoustic and one digital setup used in Task 12 through the
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

### Task 18 — Evaluate confidence normalization only as a separate later branch

**Status:** Optional future research. **Prerequisites:** Task 14 complete and a
documented residual instrument-dependent domain shift that approved-profile
selection cannot safely address.

**Objective:** Determine whether bounded input/evidence normalization improves
held-out live recognition beyond profile selection without changing matcher
safety semantics.

**Work:**

- Define a new discovery/confirmation split; do not reuse Task 14 confirmation
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
requires a new plan rather than silently extending Tasks 15-17.

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
new profile ID and repeats the held-out safety validation.

## Completion criteria

The global matcher-profile phase is complete when:

- Production and every benchmark consume the same versioned profile registry.
- `baseline-v1` replay exactly reproduces the previous production baseline.
- The `v05` event is diagnosed and covered by a deterministic regression.
- The A/B/C matrix has two identical full repetitions and reports all domains
  separately.
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
