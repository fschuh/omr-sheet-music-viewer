# Piano transcription engine repository extraction plan

> **Status:** Required before Round 3 begins.
>
> **Engine repository:**
> [`fschuh/piano-transcription-engine`](https://github.com/fschuh/piano-transcription-engine).
>
> **Private recording repository:** `piano-transcription-evals`.
>
> **Decision date:** September 2, 2026.

## Decision summary

Move the production listen engine, its canonical online-AMT model, and reusable
active evaluation code into `piano-transcription-engine`. The sheet-music viewer
will consume the engine as an installable package pinned to an exact Git commit.
The package will not be published to npm.

Keep copyrighted and otherwise private real recordings and their annotations
out of the engine repository. The gold and silver MP3/MIDI corpus will live in a
dedicated private `piano-transcription-evals` repository. That repository will
invoke the engine's evaluation API at a pinned engine commit; it will not
contain a second decoder, matcher, or scoring implementation.

Do not create an evaluation-only repository that reaches back into private
sheet-music-viewer source. The evaluator must run the same decoder, matcher, and
profile implementation that production runs. Keeping those implementations in
the viewer would force the evaluation repository to duplicate code, import a
sibling checkout, or depend on the whole application.

Keep one repository and one installable package for engine code rather than
creating separate core and browser packages. The private recording repository is
a data/evaluation consumer required by licensing, not a second engine package.
Internal folders and package export paths may separate production and evaluation
code without adding implementation copies.

Use this dependency direction:

```text
piano-transcription-evals (private recordings)
                 │
                 v
piano-transcription-engine/evals ──> production engine API
                                             ↑
sheet-music-viewer ──────────────────────────┘
```

Production engine modules must never import an evaluation fixture, benchmark
manifest, selection report, or evidence type.

## Why this extraction is warranted

Listen mode is now a substantial subsystem rather than a small viewer feature.
The current listen-related runtime, benchmarks, evidence validators, fixtures,
and tests total tens of thousands of lines. The browser inference, output
decoder, matcher, and production profile core are comparatively small and have
few genuine dependencies on sheet rendering or React.

The current layout also contains dependency inversions:

- Benchmarks import the browser session, output decoder, matcher, and profiles.
- Some policy and production-decision modules import benchmark types.
- The webapp test command builds nearly every historical listen benchmark as
  part of an ordinary viewer test run.
- The canonical 72 MiB ONNX model, model-export tools, runtime implementation,
  benchmark runner, evidence verifier, and reports are spread across several
  viewer directories.
- The new real-recording corpus currently lives in
  `../piano-transcription-evals/recordings`, but that directory is not yet a Git
  repository and cannot be placed in the engine repository because the gold
  recording is copyrighted.

The extraction should make piano-transcription-engine changes visible in the
viewer as an intentional dependency update rather than dozens of
benchmark-specific viewer commits.

## Goals

- Give the online-AMT runtime, output decoder, exact-chord matcher, matcher
  profiles, model asset, and evaluations one clear owner.
- Ensure production and evaluation execute the same implementation rather than
  parallel copies of its rules.
- Keep the sheet-music viewer responsible for score navigation, UI, settings,
  persistence, permissions, and integration only.
- Install the engine directly from Git and pin the viewer to an exact commit.
- Preserve current production behavior, including `baseline-v1` as the default.
- Put the verified five-take gold and seventeen-recording silver corpus under
  version control in a dedicated private repository before Round 3.
- Retain useful functional safety and parity tests without carrying the Round 2
  adversarial artifact machinery into Round 3.
- Make clean clones of the engine, viewer, and private eval repositories build
  or validate without requiring a developer-specific sibling path.

## Non-goals

- Do not change the online-AMT model, state weighting, silence gate, decoder,
  matcher semantics, thresholds, registry membership, or production default as
  part of the extraction.
- Do not begin the Round 3 search or inspect Round 3 recognition outcomes during
  this work.
- Do not retrain or fine-tune the online-AMT model.
- Do not publish a package to npm or operate a private package registry.
- Do not use a Git submodule for the normal viewer dependency.
- Do not commit, copy, package, or publish the real MP3/MIDI corpus, exact
  copyrighted score annotations, or recording-derived traces in
  `piano-transcription-engine` or `sheet-music-viewer`.
- Do not rewrite any repository's existing Git history.
- Do not port every Round 1/2 manifest validator, digest chain, completed-branch
  simulator, or mutation test into the active evaluation suite.
- Do not add artifact defenses against a developer consistently falsifying
  recordings, summaries, and generated outputs. Round 3 is for measuring
  recognition and score-following functionality.
- Do not introduce Git LFS during the initial extraction unless the selected Git
  host refuses the existing individual files. The current largest file is below
  GitHub's individual-file limit. Reconsider storage only if the corpus grows
  materially.
- Do not redesign listen-mode UI, settings, or calibration UX.

## Target repository layout

Use three sibling repositories during development:

```text
music/
├── sheet-music-viewer/
├── piano-transcription-engine/
└── piano-transcription-evals/       # private recording corpus
```

Use one root package in `piano-transcription-engine` so an npm Git dependency can
install the repository without workspace-subdirectory conventions:

```text
piano-transcription-engine/
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── core/
│   │   ├── recognitionTypes.ts
│   │   ├── onlineAmtOutput.ts
│   │   ├── chordMatcher.ts
│   │   └── listenMatcherProfiles.ts
│   ├── runtime/
│   │   ├── onlineAmtProtocol.ts
│   │   └── onlineAmtSession.ts
│   ├── browser/
│   │   └── browserOnlineAmtRecognizer.ts
│   └── index.ts
├── assets/
│   ├── models/online_amt_streaming.onnx
│   └── worklets/online-amt-capture.js
├── evals/
│   ├── synthetic/
│   ├── fixtures/
│   ├── results/
│   └── reports/
├── tools/
│   └── online_amt/
└── legacy/
    └── rounds-1-2/
```

The private data repository keeps the current recording layout and pins the
engine code used to evaluate it:

```text
piano-transcription-evals/
├── package.json                    # private; evaluation commands only
├── package-lock.json               # pins piano-transcription-engine
├── recordings/
│   ├── gold/
│   │   └── mario-course-clear/
│   │       ├── metadata.yaml
│   │       └── *.mp3 / *.mid
│   └── silver/
│       └── *.mp3 / *.mid
├── results/
├── reports/
└── README.md
```

The exact filenames may improve during extraction, but the ownership and
dependency direction may not change.

## Ownership boundary

### Move to `piano-transcription-engine`

- Recognition result, onset, state, event, and lifecycle contracts needed by a
  recognizer implementation.
- `OnlineAmtSession` and the 512-sample/16 kHz protocol constants.
- Target-independent online-AMT score/state decoding.
- `ExactChordMatcher` and its diagnostic observer contract.
- Production matcher profile types, registry, default, validation, and conversion
  to matcher options.
- The browser recognizer after its asset URLs and worker construction become
  injected configuration rather than viewer-relative constants.
- The canonical ONNX model and worklet source.
- Model export, validation, and runtime benchmark tools.
- Active synthetic fixtures, functional safety cases, offline/browser parity
  checks, recording inventory/scoring code, and future Round 3 evaluation
  algorithms.
- Only synthetic or otherwise clearly redistributable test material. Replace or
  privatize a fixture if its musical or audio source cannot be redistributed.
- Listen benchmark reports and concise historical outcome summaries.

### Keep in private `piano-transcription-evals`

- Gold and silver MP3/MIDI recordings.
- Recording-specific `metadata.yaml` files, exact score annotations, and
  annotation corrections.
- Any decoded trace or per-event export derived from a private recording.
- Private per-recording results and reports.
- A minimal private package configuration that pins and invokes
  `piano-transcription-engine` without implementing recognition or scoring.

### Keep in `sheet-music-viewer`

- `App.tsx` listen-mode orchestration and score/playhead navigation.
- React settings, debug UI, feedback rendering, and persistence.
- `ListenModeFeedback` if it remains a presentation model rather than an engine
  contract.
- `MidiNoteRecognizer`, while it remains a viewer input adapter.
- A thin Vite worker entry that translates worker messages to
  `OnlineAmtSession` and `OnlineAmtOutputDecoder` calls.
- Browser permission messages and any application-specific error presentation.
- A small set of viewer integration tests.

### Archive rather than keep active

- Round 1/2 candidate, eligibility, and production-decision artifact machinery.
- Hash-chain and mutation tests whose purpose was defending generated evidence
  against consistent manual tampering.
- Staged completed-branch fixtures for a branch that never ran.
- The large evidence verifier once its final artifacts and outcome summary have
  been copied to the historical area.

The sheet-music-viewer Git history remains the authoritative source for the full
old implementation. The new repository needs a source commit reference and the
final reports/artifacts, not a second maintained copy of every historical guard.

## Public package boundary

The installable package should be named
`@fschuh/piano-transcription-engine`. It may remain `private: true`; that
prevents accidental publication but does not prevent local or Git installation.

Keep the public API deliberately small:

```ts
export {
  OnlineAmtSession,
  OnlineAmtOutputDecoder,
  ExactChordMatcher,
  BrowserOnlineAmtRecognizer,
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  LISTEN_MATCHER_PROFILES,
  matcherOptionsForListenMatcherProfile,
};

export type {
  OnlineAmtSessionOptions,
  OnlineAmtStepResult,
  RecognizerResult,
  RecognizedOnset,
  RecognizedNoteEvent,
  RecognizedNoteState,
  NoteRecognizer,
  ListenMatcherProfile,
  ListenMatcherProfileId,
  ListenMatcherThresholds,
  ChordMatcherOptions,
};
```

Evaluation-only types, round manifests, candidate rankings, corpus rows, and
report schemas must not be exported from the production entry point. If evals
need shared helpers, expose a clearly separate internal entry such as
`@fschuh/piano-transcription-engine/eval`, which the viewer never imports.

Remove the compatibility export that makes the output decoder import the default
matcher profile. Score/state decoding must not know which matcher profile
production selected.

## Browser and asset boundary

The current browser recognizer assumes viewer-relative asset paths and directly
constructs a Vite-discovered TypeScript worker. Replace those assumptions with
constructor configuration:

```ts
interface BrowserOnlineAmtRecognizerOptions {
  modelUrl: string;
  workletUrl: string;
  createWorker: () => Worker;
}
```

Initially keep the approximately 90-line worker message entry in the viewer so
Vite continues to bundle it normally. Its inference and decoding imports must
come from `@fschuh/piano-transcription-engine`. This avoids making worker
bundling and ONNX Runtime WASM resolution part of the first package extraction.

The canonical model and worklet belong to `piano-transcription-engine`. Add an
idempotent viewer script that copies the installed dependency's assets into
generated `webapp/public` locations before development and production builds.
Generated copies must be ignored by the viewer repository. The app passes the
resulting URLs into the browser recognizer.

This asset preparation is an operational check, not an evidence chain. It should
verify that required files exist and are non-empty, report the installed engine
version, and copy changed bytes. It does not need manifests that defend against
an adversarial repository editor.

## Git dependency and development workflow

After the existing engine repository contains the extracted package and passes
its own tests, pin the viewer to an exact commit:

```json
{
  "dependencies": {
    "@fschuh/piano-transcription-engine":
      "git+ssh://git@github.com/fschuh/piano-transcription-engine.git#<full-commit-sha>"
  }
}
```

Commit the resulting `package-lock.json`. A human-readable tag may point to the
same commit, but the application dependency must not follow a moving branch.

For simultaneous local work, use `npm link` or a temporary uncommitted `file:`
dependency to a sibling checkout. Before merging a viewer dependency update,
restore the Git specification and verify a clean install without the sibling
override.

The intended commit flow after extraction is:

1. Implement and verify engine/evaluation work in
   `piano-transcription-engine`.
2. Commit and push it.
3. Update the one pinned Git revision in the viewer.
4. Run the viewer's integration tests and build.
5. Commit the dependency update and any required UI adaptation in the viewer.

## Private recording corpus repository

Initialize the existing `piano-transcription-evals` directory as its own private
Git repository. Keep the recordings in place; do not move them through the
public engine or viewer repositories.

Give the private repository a minimal `private: true` package that pins the exact
`piano-transcription-engine` commit used for evaluation. Its commands should call
the engine's evaluation entry point with `./recordings` as an explicit input
path. The lockfile is sufficient provenance; no artifact hash chain is needed.

Preserve the established metadata rules:

- A directory with `metadata.yaml` is one instrument/microphone setup containing
  one or more takes.
- Each top-level silver MP3/MIDI pair without metadata is its own unknown source
  setup.
- Gold and silver are reported separately.

The inventory implementation belongs to `piano-transcription-engine`; the
private repository exposes a script that runs it against its local recordings
and private annotations. It should currently report:

- Five gold MP3/MIDI pairs in `mario-course-clear`.
- Seventeen unique silver MP3/MIDI pairs.
- No unpaired MP3 or MIDI files.
- No exact duplicate MP3 or MIDI files.
- Every Course Clear MIDI has 69 note attacks in 27 moments and exactly matches
  the frozen Course Clear score pitches.
- Every MIDI note-on span lies within its paired audio file.

Do not build a cryptographic corpus manifest. File pairing, parseability,
annotation consistency, the pinned engine dependency, and the generated
evaluation report are sufficient for this single-developer project. Derived
aggregate results may be copied to the engine repository only after confirming
that they contain no copyrighted audio or private source material; private
per-recording exports remain in `piano-transcription-evals` by default.

## Historical evidence policy

Round 2 completed honestly on its no-candidate branch and remains useful project
history. Preserve:

- Final result JSON files.
- The listening benchmark report and benchmark index.
- The matcher calibration plan and its recorded task outcomes.
- A short provenance note naming the last sheet-music-viewer commit containing
  the full verifier and historical benchmark implementation.

Do not require the new repository's ordinary test suite to rebuild all old
artifact chains. Reusable functional fixtures may move into the active suite;
artifact-integrity machinery belongs under `legacy/rounds-1-2` or remains
available through sheet-music-viewer history.

## Implementation tasks

### Task 01 — Freeze the extraction boundary and baseline behavior

**Status:** Completed September 2, 2026. The source boundary, production values,
fixture audit, ownership inventory, parity fixture, and verification results are
recorded in
[`piano-transcription-engine-task-01-baseline.md`](piano-transcription-engine-task-01-baseline.md).

- Record the current sheet-music-viewer commit and engine-relevant file
  inventory.
- Classify each listen file as production core, browser/application adapter,
  reusable functional evaluation, or historical evidence.
- Record the current default profile, all profile values, fixed matcher policy,
  model file, ONNX Runtime version, worklet, and canonical parity fixture.
- Audit every fixture proposed for the public engine repository. Keep only
  original, public-domain, licensed, or non-musical numeric test material there;
  route copyrighted recordings, score sequences, MIDI, and derived traces to
  the private eval repository.
- Run the existing unit suite, production build, and the smallest browser parity
  smoke needed to establish the pre-extraction baseline.
- Confirm that extraction work will not decode any preserved Round 2 confirmation
  fixture or run a Round 3 experiment.

Acceptance:

- Every moved file has one target owner.
- The baseline output needed for post-extraction parity is stored as a normal
  test fixture, not as a new evidence chain.
- No production value changes.

### Task 02 — Prepare the installable `piano-transcription-engine` repository

**Status:** Completed September 5, 2026. The existing engine repository now has
one private root TypeScript package with separate production, browser, and eval
exports; a Git-install `prepare` build; the canonical model and worklet assets;
package/corpus boundary guards; locked runtime/tooling dependencies; and runtime,
license, data-boundary, and browser-assumption documentation. A clean temporary
copy passed `npm ci`, `npm test`, `npm run build`, and `npm pack --dry-run`.

- Use the existing
  [`fschuh/piano-transcription-engine`](https://github.com/fschuh/piano-transcription-engine)
  repository and add one root TypeScript package.
- Add `build`, `test`, `typecheck`, and `eval:inventory` commands.
- Define production and evaluation export paths.
- Configure `files` so an installed package contains built runtime code, type
  declarations, the model, and the worklet, but not evaluation reports. Real
  recordings must not exist anywhere in this repository.
- Add a `prepare` build suitable for npm installation from Git.
- Document the model source/license, runtime dependencies, and supported browser
  assumptions.

Acceptance:

- `npm ci`, `npm test`, and `npm run build` pass in a clean
  piano-transcription-engine clone.
- `npm pack --dry-run` contains the runtime and required assets but excludes
  reports and every private recording/annotation artifact.
- No sheet-music-viewer source is imported.

### Task 03 — Extract the platform-neutral recognition and matching core

**Status:** Completed September 5, 2026. The engine package now owns the
platform-neutral recognition contracts, online-AMT protocol constants and
output decoder, exact-chord matcher and diagnostics, and immutable matcher
profile registry. Application feedback state remains viewer-owned, the decoder
has no default-profile compatibility dependency, all 51 migrated focused tests
pass in the engine repository, and the canonical Task 01 fixture retains SHA-256
`566453d6d14949768a5d1506580f0709cb39ac61c1147819c203c2429039df15`.

- Move recognition event/result contracts required by the engine.
- Move `onlineAmtProtocol`, target-independent output decoding,
  `ExactChordMatcher`, matcher diagnostics, and matcher profiles.
- Move their focused unit tests.
- Remove the output decoder's compatibility dependency on the default profile.
- Split application feedback types from engine result types where necessary.
- Keep every existing threshold, timing option, profile ID, and default unchanged.

Acceptance:

- Core modules have no DOM, React, viewer, benchmark, filesystem, or report
  imports.
- Decoder, matcher, and profile tests pass in the new repository.
- The canonical decoder/matcher fixture matches Task 01 exactly.

### Task 04 — Extract the online-AMT session, model, and model tools

**Status:** Completed September 5, 2026. `OnlineAmtSession`, its runtime options,
tensor/state validation, canonical synthetic runtime fixture, model export step,
and native validation tool now live in the engine repository. The canonical
model remains a single engine asset and its temporary viewer copy is retained
for the Task 09 cutover. Standalone one-thread WASM replay processed all 180
ordered fixture frames (5.76 seconds of audio) in 1.40 seconds, with zero state
or signal-active mismatches and maximum absolute score error `3.4332e-5`.

- Move `OnlineAmtSession`, its ONNX tensor/state validation, and runtime options.
- Move the canonical ONNX model exactly once.
- Move the Python export/validation scripts and concise runtime documentation.
- Make ONNX Runtime a dependency of the engine package rather than an accidental
  viewer implementation detail.
- Preserve recurrent-state ordering, 16 kHz input, 512-sample chunks, silence
  behavior, and output tensor interpretation.

Acceptance:

- The session produces the Task 01 scores, states, and signal-active result on
  the canonical fixture.
- Sequential offline inference can run faster than wall-clock time while feeding
  unchanged audio frames in order.
- The viewer model is not removed until Task 09 completes the local package
  cutover.

### Task 05 — Extract the browser recognizer behind injected adapters

**Status:** Completed September 5, 2026. The browser export now owns
`BrowserOnlineAmtRecognizer` behind injected model URL, worklet URL, and worker
creation. The adapter retains the frozen mono/16 kHz capture constraints,
one-thread session configuration, chunk transport, lifecycle, reset, and cleanup
behavior without knowing `document.baseURI`, Vite paths, or viewer source. Four
fake-browser tests cover successful start, target and generation changes, pause,
resume, flush/reset, initialization and runtime failures, pending-start
cancellation, and stop. The existing browser/offline harness also passed all 15
parity checks. The thin worker remains viewer-owned; its package-import cutover
is intentionally part of Task 09, when the viewer installs the dependency.

- Move `BrowserOnlineAmtRecognizer` into the browser export.
- Inject model URL, worklet URL, and worker creation.
- Keep microphone constraints and processing semantics unchanged: mono input,
  16 kHz, and browser noise suppression, echo cancellation, and automatic gain
  control disabled.
- Retain the thin Vite worker entry in the viewer, importing session and decoder
  behavior from the package.
- Add browser-recognizer lifecycle tests using injected fakes rather than a real
  microphone.

Acceptance:

- The viewer can construct the packaged recognizer without the package knowing
  `document.baseURI` layout or viewer source paths.
- Start, pause, resume, reset, target change, failure, and stop behavior remains
  covered.
- Browser inference parity still matches the offline session on the canonical
  fixture.

### Task 06 — Move the active functional evaluation foundation

**Status:** Completed September 5, 2026. The engine's evaluation entry point now
owns a public-safe functional replayer and eight original numeric traces covering
isolated recognition, continuous sequencing, dynamics, repeated chords,
omitted-bass and false-advance safety, and skipped and duplicate advances. Under
`baseline-v1` all eight cases pass, all twelve expected score moments advance
exactly once, and no case records a false, skipped, duplicate, or late advance.
The repeated-chord trace uses three consecutive identical moments so its shape
matches the private corpus's repeated chord and the matcher must re-arm twice in
a row; a companion case proves the third moment stays unadvanced when its attack
is removed. Twelve matcher mutations were measured against two- and
three-moment variants of that trace and none distinguished them, so the third
repeat buys structural fidelity and one more re-arm cycle rather than additional
mutation-detection power.
Regressions are reported per case and per classification rather than from a suite
total or a pass/fail boolean, and four deliberately degraded matcher
configurations were each verified to fail the case they endanger. The viewer's
chained per-file test command is replaced by build-then-discover globs, and
`test/eval-boundary.test.mjs` enforces the eval/production/application import
boundaries; the shared specifier scanner now also sees bare side-effect imports,
which the previous core guard and package verifier silently allowed. The browser
and offline parity harness deliberately remains viewer-owned until the Task 09
cutover switches its imports to the installed package.

- Port only benchmark components that directly measure recognition, decoding,
  matching, latency, or safety.
- Preserve representative isolated, continuous sequence, dynamics, repeated
  chord, omitted-bass, false-advance, skipped-advance, and duplicate-advance
  fixtures.
- Replace any copyrighted musical fixture with an original or clearly
  redistributable equivalent unless it remains solely in the private eval
  repository.
- Make every active eval import only the public engine/eval entry points.
- Replace the viewer's giant chained test command with ordinary discovery-based
  test scripts in the engine repository.
- Do not port frozen-candidate artifact emitters merely because they existed.

Acceptance:

- Active functional tests demonstrate the same baseline behavior as before the
  move.
- A deliberately worse matcher profile still causes the relevant safety or
  correctness tests to fail.
- No active functional test depends on `App.tsx`, React, the sheet viewer, or a
  historical JSON digest.

### Task 07 — Initialize and validate private `piano-transcription-evals`

**Status:** Completed September 5, 2026. `piano-transcription-evals` is a
private Git repository holding the five gold takes with their
`mario-course-clear/metadata.yaml` and the seventeen loose silver pairs under
their original filenames. The engine now owns a Standard MIDI File reader, an
MP3 frame-header reader, and the corpus inventory, exposed as the
`piano-transcription-eval` binary; the private repository supplies its own
`./recordings` path and its own annotation file as data, so no score sequence,
recording, or annotation entered the engine. `npm run eval:inventory` reports 5
gold pairs in 1 setup and 17 silver pairs in 17 unknown-source setups, with no
unpaired files, no byte-identical duplicates, every note attack inside its
paired audio, and all five takes matching the private annotation's 69 attacks in
27 moments. Sample rate, channel count, duration, and bitrate are read from
frame headers without modifying any source file; all 22 files agreed with
ffprobe on sample rate and channel count, with duration differing by at most
70.5 ms from encoder delay. Score moments group on the gap between attacks at a
default 80 ms, chosen because every tolerance from 33 ms to 161 ms yields the
gold takes' 27 moments. The engine dependency is still the local
`file:../piano-transcription-engine` development override; Task 10 replaces it
with the pinned commit SHA and regenerates the lockfile.

- Initialize the existing `piano-transcription-evals` directory as a private Git
  repository without moving its recordings through either public repository.
- Preserve the five gold and seventeen silver recording pairs,
  `mario-course-clear/metadata.yaml`, and all filenames.
- Add a minimal private `package.json` and lockfile that pin the tested
  `piano-transcription-engine` commit.
- Implement MIDI parsing and the inventory command in the engine; expose a
  private-repo script that runs it against `./recordings`.
- Keep Course Clear score pitches and timing annotations in a private fixture or
  in the corrected MIDIs themselves. The engine receives them as data when Round
  3 begins and must not embed the copyrighted sequence.
- Record MP3 sample rate, channel count, duration, and bitrate as descriptive
  metadata without normalizing or modifying the source audio.

Acceptance:

- `npm run eval:inventory` reports 5 gold and 17 silver pairs with no errors.
- All five Course Clear annotations exactly match 69 notes and 27 score moments.
- The corpus is committed only in the private repository and is no longer an
  unversioned directory.
- Neither the engine nor viewer Git status contains an MP3/MIDI corpus copy.

### Task 08 — Archive Round 1/2 outcomes without porting their complexity

**Status:** Completed September 6, 2026. The engine's `legacy/rounds-1-2`
contains final decision report excerpts, the measured plan outcome, verbatim
Task 27/28/29 manifests, and labelled decision-only extracts of both Task 13
repetitions. Provenance records every original artifact's hash and immutable path
at viewer commit `89afafcdd7fd06db0626feba6a0665ab1c3bf798`; score-bearing
measurement details remain source-only under the redistribution boundary.
Historical emitters, benchmark/policy tests, and the evidence verifier no longer
run from viewer `npm test`. An original spurious-bass-onset fixture preserves the
Round 1 safety mechanism through the public eval API: baseline refuses it while
all four frozen v2 profiles advance. Production values remain unchanged.

- Copy final reports, final artifacts, and the plan outcome summary into
  `legacy/rounds-1-2`.
- Add a provenance note pointing to the final sheet-music-viewer commit with the
  complete old code and verifier.
- Identify any old fixture that remains functionally useful and move that fixture
  into the active suite without its artifact-chain wrapper.
- Mark all historical emitters and verifiers as non-active; do not run them from
  `npm test`.

Acceptance:

- A reader can understand the Round 1/2 conclusion and find the original full
  implementation.
- The new active suite has no requirement to simulate the unexecuted Round 2
  completed branch.
- The current production default remains explained and reproducible.

### Task 09 — Integrate the package into the viewer using a local dependency

**Status:** Completed September 6, 2026. `webapp` depends on
`@fschuh/piano-transcription-engine` through the `file:../../piano-transcription-engine`
development override, and every viewer import of the recognition types, session,
decoder, matcher, profile registry, and browser recognizer now resolves to the
package's `.` and `/browser` entry points; nothing imports `/eval`. The viewer
keeps `MidiNoteRecognizer`, `ListenModeFeedback`, `stoppedRecognizerLifecycle`,
the worker message entry, settings, and score navigation, and it now owns the two
pieces the package deliberately does not: `listenRecognizer.ts` supplies the
asset URLs, the Vite worker factory, and the microphone permission and device
wording, while `onlineAmtWasm.ts` resolves ONNX Runtime's WASM binary from the
viewer's own dependency copy rather than from the engine's node_modules layout.
Wording is delivered through a new optional `describeError` hook on the engine's
browser recognizer. `prepare:listen-assets` copies the canonical model, its MIT
notice, and the worklet out of the installed package into the ignored
`webapp/public/generated-listen-assets/`, and `predev`, `predev:wasm-benchmark`,
and `prebuild` run it; the three tracked viewer copies are gone. The engine-owned
`chordMatcher`, `onlineAmtOutput`, `onlineAmtProtocol`, `onlineAmtSession`,
`onlineAmtRecognizer`, and `listenMatcherProfiles` modules, their tests, and the
Task 01 core fixture were deleted from the viewer. Viewer tests pass 151/151,
`tsc -b` and the production build succeed, and the canonical browser smoke
reproduced the frozen baseline for both renderers: advanced at 196 ms, 17,920 PCM
frames, 35 trace frames, structure hashes `83fbd243` and `5c164339`, and
`matched-recorded-baseline`.

- Temporarily install the sibling package through `npm link` or an uncommitted
  `file:` override.
- Change viewer imports for engine types, session, decoder, matcher, recognizer,
  and profiles to the package's public entry points.
- Keep `MidiNoteRecognizer`, UI feedback, worker message transport, settings, and
  score navigation in the viewer.
- Add `prepare:listen-assets` and run it from `predev` and `prebuild` alongside
  piano asset preparation.
- Convert tracked viewer copies of the model/worklet into generated copies only
  after the packaged asset path works.

Acceptance:

- The viewer runs listen mode using package code with no duplicate engine
  implementation in its source tree.
- Production build and viewer integration tests pass.
- Listen-mode behavior and default profile are unchanged.

### Task 10 — Establish and pin the Git dependency

- Push a tested extraction commit to the existing
  `https://github.com/fschuh/piano-transcription-engine` remote.
- Optionally tag that commit for readability.
- Replace the local development override with a Git dependency containing the
  full commit SHA.
- Regenerate and commit the viewer lockfile.
- Test installation from a clean temporary clone without access to the sibling
  checkout.
- Pin the private eval repository to the same tested engine commit and commit its
  lockfile.

Acceptance:

- `npm ci` fetches, prepares, and installs the exact engine commit.
- `npm run build` succeeds from a clean sheet-music-viewer clone.
- `npm ci` and `npm run eval:inventory` succeed from a clean private eval clone
  with access to its recordings.
- The lockfile and diagnostic/about output identify the installed engine version
  or commit.
- No dependency follows `main` or another moving branch.

### Task 11 — Remove viewer-owned benchmark and engine duplicates

- Remove extracted core/runtime files from the viewer.
- Remove the benchmark page, benchmark-only route, benchmark HTML entry, old
  emitters, and evidence verifier from the viewer's active build and test scripts.
- Remove historical benchmark modules after their required reports and provenance
  have been archived.
- Retain this plan and the completed matcher-calibration plan as historical
  documentation, with a note pointing to the new repository.
- Check that unrelated viewer tests and build scripts no longer compile listen
  evaluation code.

Acceptance:

- Searching viewer production source finds package imports, not copied engine
  implementations.
- Ordinary viewer tests do not build or run the old benchmark matrix.
- The viewer repository contains no canonical model duplicate and no recording
  corpus.
- Git diff review shows deletions and import adaptations, not behavioral rewrites.

### Task 12 — Verify the cutover and declare Round 3 ready

Run, in order:

1. Clean `piano-transcription-engine` install, typecheck, unit tests, and build.
2. Clean private `piano-transcription-evals` install and recording inventory
   check.
3. Canonical offline session and decoder/matcher parity fixture.
4. Browser/offline parity smoke.
5. Clean sheet-music-viewer install from the pinned Git dependency.
6. Viewer unit tests and production build.
7. Manual listen-mode smoke covering start, target changes, advancement, pause,
   resume, stop, and microphone denial.
8. Dependency-boundary search proving the viewer does not import eval modules and
   engine production modules do not import eval modules.

Write a concise extraction report in the engine and viewer repositories, plus a
private corpus README entry, naming:

- The piano-transcription-engine commit.
- The viewer commit that adopted it.
- The production model and default profile.
- What historical machinery was archived instead of ported.
- The commands that must pass before later engine upgrades are adopted.

Acceptance:

- All three repositories work independently from clean clones, subject to
  private-repository access for the recording corpus.
- Production output matches the pre-extraction baseline.
- The viewer consumes one exact Git dependency and has only thin integration
  code.
- The private eval repository owns the verified real corpus; the engine
  repository owns all recognition, scoring, inventory, and functional safety
  implementations.
- No Round 3 result was observed during extraction.
- Round 3 planning may begin only after these conditions are met.

## Overall exit criteria

The extraction is complete when all of the following are true:

- `piano-transcription-engine` is a standalone, tested Git repository with one
  installable private package.
- The sheet-music viewer and private eval repository are pinned to the same full
  piano-transcription-engine commit SHA and build from clean clones.
- Runtime decoding, matching, profiles, model, and active evaluations have one
  owner and no duplicated implementation.
- The viewer retains UI, score navigation, settings, persistence, and thin
  browser/worker integration only.
- The gold/silver corpus is versioned only in private
  `piano-transcription-evals` and passes its simple inventory checks.
- Round 1/2 outcomes remain discoverable without burdening the active test suite
  with adversarial artifact verification.
- `baseline-v1` remains the production default and its observed behavior is
  unchanged.
- The repository boundary is ready for the simplified raw-model-first Round 3
  evaluation.
