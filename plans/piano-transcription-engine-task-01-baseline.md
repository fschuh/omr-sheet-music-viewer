# Piano transcription engine extraction baseline

> **Task:** Piano transcription engine repository extraction, Task 01  
> **Frozen:** September 2, 2026  
> **Source repository:** `sheet-music-viewer`  
> **Source commit:** `89afafcdd7fd06db0626feba6a0665ab1c3bf798`  
> **Source commit date:** September 1, 2026  
> **Source commit subject:** `Renamed Tauri app from homr_sheet_music_viewer to omr_sheet_music_viewer`

This is the pre-extraction ownership and behavior record. The source files still
matched the commit above when the baseline commands were run; the extraction
plan itself was the only pre-existing untracked file. Task 01 adds documentation
and one public-safe test fixture, but deliberately changes no production value.

## Extraction rules

The category and owner columns below are binding for Tasks 02-11:

- **Production core (`P`)** moves to `piano-transcription-engine` production
  source, tests, runtime assets, or model tools.
- **Browser/application adapter (`A`)** remains in `sheet-music-viewer` unless
  the row explicitly says that the obsolete benchmark surface is removed.
- **Reusable functional evaluation (`E`)** moves to the engine's separate eval
  entry point or active eval suite only after private musical content is removed.
- **Historical evidence (`H`)** is not active code. Public-safe summaries and
  artifacts may move to `legacy/rounds-1-2`; exact copyrighted score material and
  traces derived from it go to private `piano-transcription-evals`.

A row marked **split** must not be copied intact. The named pieces are first
separated into files with one owner each. All other files that move have exactly
one target owner.

## Frozen production behavior

### Profiles and default

The registry version is `2`; the production and rollback default is
`baseline-v1`.

| Profile ID | Onset | Target note | Active target | Unexpected note | Fresh bass |
| --- | ---: | ---: | ---: | ---: | --- |
| `baseline-v1` | 0.60 | 0.50 | 0.350 | 0.97 | required |
| `balanced-v1` | 0.50 | 0.50 | 0.350 | 0.99 | required |
| `sensitive-v1` | 0.45 | 0.50 | 0.200 | 0.99 | required |
| `early-open-v2` | 0.45 | 0.50 | 0.200 | 0.99 | required |
| `steady-open-v2` | 0.50 | 0.50 | 0.200 | 0.99 | required |
| `early-held-v2` | 0.45 | 0.50 | 0.275 | 0.99 | required |
| `steady-held-v2` | 0.50 | 0.50 | 0.275 | 0.99 | required |

The fixed matcher policy is common to every profile:

| Setting | Value |
| --- | ---: |
| `preTargetExtraLookbackMs` | 30 |
| `collectionWindowMs` | 400 |
| `settleMs` | 32 |
| `duplicateOnsetMs` | 120 |
| `wrongAttemptResetMs` | 180 |
| `refractoryMs` | 180 |
| `refractoryMode` | `noteEvents` |

`defaultChordMatcherOptions` remains a separate generic default. Listen mode
uses `matcherOptionsForListenMatcherProfile("baseline-v1")`, which additionally
maps the profile's unexpected-note threshold to `noteThreshold`. The temporary
`onlineAmtChordMatcherOptions` compatibility export has the same values and is
scheduled for removal in Task 03.

### Protocol, model, runtime, and worklet

| Item | Frozen value |
| --- | --- |
| Model | `webapp/public/models/online_amt_streaming.onnx` |
| Model size | 71,955,821 bytes |
| Model SHA-256 | `a77be8262d3742ce4d9e7d29146d8b17f5755650a7d2aee952bf5bf5ed190ac4` |
| Upstream source | `jdasam/online_amt` revision `f353035175cc3436ebdc411530a9e73c966d2077` |
| Upstream checkpoint SHA-256 | `54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0` |
| Model/source license | MIT; notice SHA-256 `ac167cd16f08e99d235791c4c4e67ae34eac9d7c4e4e72850d41736b199ef2ea` |
| ONNX Runtime dependency | `onnxruntime-web` 1.27.0, exact in `package.json` and lockfile |
| Input | mono float32, 16,000 Hz, 512 samples (32 ms) per step |
| Recurrent state order | `audio_buffer`, `mel_buffer`, `cnn_cache_1`, `cnn_cache_2`, `lstm_h`, `lstm_c`, `previous_output`, `silence_count` |
| Production session | one WASM thread, graph optimization `all`, CPU arena and memory pattern enabled, sequential execution |
| Capture worklet | `webapp/public/worklets/online-amt-capture.js`, 1,534 bytes |
| Worklet SHA-256 | `4bc9ac4eb33b6ab50bb1d1ab60c14802dddf5f55be42774c4e543bde361ed060` |

The worklet averages input channels, emits consecutive 512-sample chunks, and
discards partial chunks on pause, resume, or flush. Browser capture requests one
channel and disables echo cancellation, noise suppression, and automatic gain
control. None of these values may change during extraction.

### Canonical parity fixtures

Two complementary baselines are retained:

1. `webapp/src/listen/fixtures/engineCoreBaseline.fixture.json` is the normal,
   public-safe Task 01 fixture for Task 03. It contains original sparse numeric
   score/state input, two frames at 1,000 and 1,032 ms, expected decoder output,
   and the `baseline-v1` matcher updates. It has no captured or copyrighted
   audio, score, MIDI, or recording-derived value. Its Task 01 SHA-256 is
   `566453d6d14949768a5d1506580f0709cb39ac61c1147819c203c2429039df15`.
2. `webapp/src/listen/benchmarks/listenBaselineParity.ts` retains the browser
   end-to-end Splendid `mp` C-major smoke. This chord is generic test material
   rendered from the public-domain Splendid sample library.

The stable browser expectations are:

| Renderer | Target | Advanced | Onset to advance | PCM frames | Trace frames | Structure hash | Peak | RMS |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
| `bundled-piano-web-audio-v1` | `[60,64,67]` | yes | 196 ms | 17,920 | 35 | `83fbd243` | 0.6031675934791565 | 0.10090749459121913 |
| `bundled-piano-tone-v2` | `[60,64,67]` | yes | 196 ms | 17,920 | 35 | `5c164339` | 0.4324992597103119 | 0.07803548413864943 |

Counts, pitches, state/event structure, and timing are exact. Audio amplitudes
and model confidences keep the existing one-Float32-ULP cross-process allowance;
raw PCM and full recognition hashes remain diagnostic because their last bits
are not stable across fresh browser processes.

The separate 180-frame runtime fixture in
`webapp/public/models/online_amt_fixture/` is also public-safe. Its audio is
generated by `fixture_audio()` as silence plus a synthesized, exponentially
decaying 440 Hz harmonic signal; it is non-musical numeric data, not a recording.

| Runtime fixture file | Size | SHA-256 |
| --- | ---: | --- |
| `audio.f32` | 368,640 | `33c32d4cb06fa3eef9c1fa81d84213a33227120cc94cec8c274e575e315fa33c` |
| `metadata.json` | 72 | `b3c048309207d9936cdffce6aa3d1974e61087f4906918923e95f3f1651c7bf6` |
| `scores.f32` | 316,800 | `b1a148b928e632f3871f59f76390a251fd78f7a20fe4711e5a816615f6922006` |
| `signal-active.u8` | 180 | `59278ecd80902c8e0f8efaf1aa8f4bb09aed7d3dfbc14309e17528466cbdd1d2` |
| `states.u8` | 15,840 | `507c9d05c9e2b2c0b58de23d9721ee27511549beacae59b5089da3742d5a4617` |

## Engine and application ownership inventory

### Production modules, assets, and direct tests

| Current path | Category | Target owner and disposition |
| --- | --- | --- |
| `webapp/src/chordMatcher.ts` | P | Engine `src/core/chordMatcher.ts`. |
| `webapp/src/chordMatcher.test.ts` | E | Engine focused core tests. |
| `webapp/src/noteRecognizer.ts` | P/A, split | Recognition result/event/state, recognizer, callbacks, and lifecycle contracts to engine; `ListenModeFeedback` and app presentation defaults stay viewer-owned. |
| `webapp/src/onlineAmtOutput.ts` | P | Engine `src/core/onlineAmtOutput.ts`; remove its default-profile compatibility dependency in Task 03. |
| `webapp/src/onlineAmtOutput.test.ts` | E | Engine focused decoder/matcher tests, including the Task 01 fixture. |
| `webapp/src/listen/listenMatcherProfiles.ts` | P | Engine `src/core/listenMatcherProfiles.ts`; keep every value above unchanged. |
| `webapp/src/listen/listenMatcherProfiles.test.ts` | E | Engine focused profile tests. |
| `webapp/src/onlineAmtProtocol.ts` | P | Engine `src/runtime/onlineAmtProtocol.ts`. |
| `webapp/src/onlineAmtSession.ts` | P | Engine `src/runtime/onlineAmtSession.ts`. |
| `webapp/src/onlineAmtRecognizer.ts` | P/A, split | Browser recognizer to engine after injecting model URL, worklet URL, and worker factory; viewer-specific error presentation stays in viewer if not a generic recognizer error. |
| `webapp/public/models/online_amt_streaming.onnx` | P | Engine canonical model asset; viewer copy remains until Task 09. |
| `webapp/public/models/online_amt.LICENSE.txt` | P | Engine model notice. |
| `webapp/public/worklets/online-amt-capture.js` | P | Engine worklet asset; viewer copy remains until Task 09. |
| `tools/online_amt/export_streaming_onnx.py` | P | Engine model tool. |
| `tools/online_amt/streaming_step.py` | P | Engine model tool. |
| `tools/online_amt/validate_streaming_onnx.py` | P/E | Engine model validation tool; its generated runtime fixture remains active eval data. |

### Viewer-owned integration and adapters

| Current path | Category | Target owner and disposition |
| --- | --- | --- |
| `webapp/src/App.tsx` | A | Viewer listen orchestration, matching-to-playhead bridge, state, and feedback. |
| `webapp/src/SettingsPage.tsx`, `webapp/src/SettingsPage.test.tsx` | A | Viewer debug/profile UI and tests. |
| `webapp/src/preferences.ts` | A | Viewer input-source and UI persistence. |
| `webapp/src/midiNoteRecognizer.ts`, `webapp/src/midiNoteRecognizer.test.ts` | A | Viewer MIDI input adapter and tests. |
| `webapp/src/keyboardRecognition.ts` | A | Viewer keyboard visualization state. |
| `webapp/src/PianoKeyboard.tsx`, `webapp/src/PianoKeyboard.test.tsx` | A | Viewer feedback rendering and integration tests. |
| `webapp/src/DocumentViewer.tsx`, `webapp/src/DocumentViewer.test.tsx` | A | Viewer score/playhead presentation and integration tests. |
| `webapp/src/playback.ts`, `webapp/src/playback.test.ts` | A | Viewer navigation/playback state. |
| `webapp/src/shortcuts.ts`, `webapp/src/shortcuts.test.ts` | A | Viewer listen command/key binding integration. |
| `webapp/src/onlineAmtWorker.ts` | A | Thin Vite worker entry; imports session and decoder from engine after cutover. |
| `webapp/src/piano.ts`, `webapp/src/pianoRegistry.ts`, `webapp/src/piano.test.ts` | A | Viewer piano playback. Eval-specific renderer configuration must be extracted without making the engine import viewer code. |
| `webapp/src/spectralPitchDetector.ts`, `webapp/src/spectralPitchDetector.test.ts` | A/H | Viewer-retained experimental/fallback detector; not part of the online-AMT engine public API. |
| `webapp/src/spectralRecognizer.ts`, `webapp/src/spectralRecognizer.test.ts` | A/H | Viewer-retained experimental browser adapter; not moved to the engine. |
| `webapp/index.html` | A | Viewer production entry. |
| `webapp/online-amt-benchmark.html` | E | Temporary viewer benchmark entry; remove in Task 11 after engine eval replacement exists. |
| `webapp/listen-benchmark-parity.html` | E | Temporary browser parity entry; replace with engine-owned eval runner, then remove in Task 11. |

### Reusable functional evaluation modules

These modules move to the engine eval area only in public-safe form.

| Current path | Category | Target owner and disposition |
| --- | --- | --- |
| `webapp/src/listen/benchmarks/listenBaselineParity.ts` | E | Engine parity helpers and public-safe canonical smoke. |
| `webapp/src/listen/benchmarks/listenBaselineParity.test.ts` | E | Engine parity tests. |
| `webapp/src/listen/benchmarks/listenBenchmarkAudio.ts` | E | Engine synthetic/sample renderer; retain source/license metadata. |
| `webapp/src/listen/benchmarks/listenBenchmark.ts` | E/H, split | Generic isolated capture/replay to engine eval; remove Course Clear corpus and legacy spectral comparison from the active copy. |
| `webapp/src/listen/benchmarks/listenBenchmark.test.ts` | E/H, split | Keep generic functional cases; private/archive tests for removed copyrighted/history paths. |
| `webapp/src/listen/benchmarks/listenBenchmarkParity.browser.ts` | E | Engine browser/offline parity; current C4/chord inputs are generic. |
| `webapp/src/listen/benchmarks/listenBenchmarkParityRunner.ts` | E | Engine parity runner. |
| `webapp/src/listen/benchmarks/listenDynamicsBenchmark.ts` | E/H, split | Retain generic dynamics algorithms with an original replacement passage; current Course Clear cases stay private. |
| `webapp/src/listen/benchmarks/listenDynamicsBenchmark.test.ts` | E/H, split | Retain generic dynamics assertions after fixture replacement. |
| `webapp/src/listen/benchmarks/listenInferenceResetBenchmark.ts` | E | Engine lifecycle/reset safety eval. |
| `webapp/src/listen/benchmarks/listenInferenceResetBenchmark.test.ts` | E | Engine reset tests. |
| `webapp/src/listen/benchmarks/listenOmittedBassRegression.ts` | E/H, split | Generic matcher replay/diagnosis may move; remove the import of the private Course Clear-derived fixtures. |
| `webapp/src/listen/benchmarks/listenSafetyRegression.ts` | E/H, split | Generic false/skipped/duplicate/late diagnosis may move; private fixtures do not. |
| `webapp/src/listen/benchmarks/listenSafetyRegression.test.ts` | E/H, split | Retain public-safe functional cases after private fixture separation. |
| `webapp/src/listen/benchmarks/listenSequenceBenchmark.ts` | E/H, split | Generic sequence materialization/capture/replay to engine; replace all Course Clear definitions. |
| `webapp/src/listen/benchmarks/listenSequenceBenchmark.test.ts` | E/H, split | Retain generic sequence assertions after replacement. |
| `webapp/src/listen/benchmarks/listenSequenceCaseBenchmark.ts` | E/H, split | Generic focused-case runner to engine; remove Course Clear defaults and fixture generation. |
| `webapp/src/listen/benchmarks/listenSequenceCaseBenchmark.test.ts` | E | Engine eval tests after fixture replacement. |
| `webapp/src/onlineAmtBenchmark.ts` | E | Engine runtime parity/latency harness. |
| `webapp/public/models/online_amt_fixture/*` | E | Engine synthetic runtime fixture; all five files are approved for the public repository. |
| `tools/online_amt/run_browser_benchmarks.mjs` | E/H, split | Keep active smoke/parity/runtime modes in engine tooling; archive Round 1/2 evidence emitters and commands. |
| `webapp/src/listen/benchmarks/ListenBenchmarkPage.tsx` | A/H | Do not move. Replace active functions with engine commands, then delete this viewer-only benchmark UI in Task 11. |

These three historical fixture files have private data ownership and therefore
must not enter the engine repository, including its legacy area:

| Current path | Category | Target owner and disposition |
| --- | --- | --- |
| `webapp/src/listen/benchmarks/listenBenchmarkFixtures.ts` | H | Private evals; exact Course Clear score-pitch sequence. |
| `webapp/src/listen/benchmarks/listenOmittedBassFixtures.ts` | H | Private evals; decoded traces derived from Course Clear. |
| `webapp/src/listen/benchmarks/listenSafetyRegressionFixtures.ts` | H | Private evals; decoded traces and definitions derived from Course Clear. |

### Historical policy, search, and evidence modules

Every row below is historical evidence (`H`) targeted to
`piano-transcription-engine/legacy/rounds-1-2`, except where the fixture audit
routes its data privately. None belongs to a production export or ordinary test
command.

| Current path(s) | Historical role |
| --- | --- |
| `webapp/src/onlineAmtRetriggerDetector.ts`, `webapp/src/onlineAmtRetriggerDetector.test.ts` | Rejected score-rise retrigger experiment. |
| `webapp/src/listen/listenBassQualification.ts`, `webapp/src/listen/listenBassQualification.test.ts` | Round 2 bass/repeated-chord diagnostic policy. |
| `webapp/src/listen/listenExperimentalBassOnset.ts` | Round 2 experimental axis. |
| `webapp/src/listen/listenMatcherSelectionPolicy.ts`, `webapp/src/listen/listenMatcherSelectionPolicy.test.ts` | Historical search selection policy. |
| `webapp/src/listen/listenProfileValidationPolicy.ts`, `webapp/src/listen/listenProfileValidationPolicy.test.ts` | Historical release gates. |
| `webapp/src/listen/listenRoundTwoDefaultSelection.ts`, `webapp/src/listen/listenRoundTwoDefaultSelection.test.ts` | Historical default decision input. |
| `webapp/src/listen/listenRoundTwoProductionDecision.ts`, `webapp/src/listen/listenRoundTwoProductionDecision.test.ts`, `webapp/src/listen/listenRoundTwoProductionDecisionCli.ts` | Historical production decision and emitter. |
| `webapp/src/listen/benchmarks/listenBassQualificationBenchmark.ts` | Round 2 qualification measurement. |
| `webapp/src/listen/benchmarks/listenMatcherSweepBenchmark.ts`, `webapp/src/listen/benchmarks/listenMatcherSweepBenchmark.test.ts` | Exhaustive profile search/ranking. |
| `webapp/src/listen/benchmarks/listenProfileValidationBenchmark.ts`, `webapp/src/listen/benchmarks/listenProfileValidationBenchmark.test.ts` | Frozen validation matrices and evidence. |
| `webapp/src/listen/benchmarks/listenRetriggerBenchmark.ts`, `webapp/src/listen/benchmarks/listenRetriggerBenchmark.test.ts` | Rejected retrigger experiment benchmark. |
| `webapp/src/listen/benchmarks/listenRoundTwoAblationBenchmark.ts`, `webapp/src/listen/benchmarks/listenRoundTwoAblationBenchmark.test.ts` | Round 2 ablation search and terminal outcome. |
| `webapp/src/listen/benchmarks/listenRoundTwoCandidateManifest.ts`, `webapp/src/listen/benchmarks/listenRoundTwoCandidateManifest.test.ts`, `webapp/src/listen/benchmarks/listenRoundTwoCandidateManifestCli.ts` | Candidate artifact and emitter. |
| `webapp/src/listen/benchmarks/listenRoundTwoCompletedFixtures.ts` | Staged artifact-chain fixtures; archive only. |
| `webapp/src/listen/benchmarks/listenRoundTwoCorpusBenchmark.ts`, `webapp/src/listen/benchmarks/listenRoundTwoCorpusBenchmark.test.ts` | Round 2 corpus capture/evidence. |
| `webapp/src/listen/benchmarks/listenRoundTwoEligibilityManifest.ts`, `webapp/src/listen/benchmarks/listenRoundTwoEligibilityManifest.test.ts`, `webapp/src/listen/benchmarks/listenRoundTwoEligibilityManifestCli.ts` | Eligibility artifact and emitter. |
| `webapp/src/listen/benchmarks/listenRoundTwoFixtures.ts`, `webapp/src/listen/benchmarks/listenRoundTwoFixtures.test.ts` | Original authored Round 2 definitions and partition guards; public-safe but historical. Reuse only by copying selected definitions under new active IDs without confirmation semantics. |
| `webapp/src/listen/benchmarks/listenRoundTwoGenerator.ts` | Round 2 artifact generator. |
| `webapp/src/listen/benchmarks/listenRoundTwoLiveEvidence.ts`, `webapp/src/listen/benchmarks/listenRoundTwoLiveEvidence.test.ts` | Live evidence schema/gates. |
| `webapp/src/listen/benchmarks/listenTraceManifest.ts`, `webapp/src/listen/benchmarks/listenTraceManifest.test.ts` | Round 1/2 partition, digest, and corpus machinery. |
| `tools/online_amt/verify_listen_benchmark_evidence.mjs`, `tools/online_amt/verify_listen_benchmark_evidence.d.mts`, `tools/online_amt/verify_listen_benchmark_evidence.test.mjs` | Historical evidence verifier and mutation tests. |

Documentation ownership is likewise explicit:

| Current path | Target owner |
| --- | --- |
| `tools/online_amt/README.md`, `tools/online_amt/RUNTIME_BENCHMARK.md` | Engine runtime/model documentation. |
| `tools/online_amt/BENCHMARK.md`, `tools/online_amt/LISTEN_BENCHMARK.md`, `tools/online_amt/PIANO_DYNAMICS_BENCHMARK.md` | Engine legacy reports after the copyright review below; active docs receive only concise functional instructions. |
| `plans/listen-matcher-calibration-plan.md`, `plans/listen-decoder-model-evidence-requirement.md` | Engine legacy planning/outcome history. |
| `plans/piano-dynamics-benchmark-plan.md` | Viewer history; copy a public-safe concise benchmark summary to engine legacy, not the whole viewer plan. |

## Fixture and result copyright audit

| Material | Provenance | Public engine decision |
| --- | --- | --- |
| `engineCoreBaseline.fixture.json` | Original sparse numeric states/scores authored for Task 01. | **Keep active.** |
| `online_amt_fixture/*` | Deterministic synthesized 440 Hz harmonic signal and derived model tensors. | **Keep active.** |
| Canonical C-major smoke and generic scales/chords/safety cases | Generic or project-authored inputs; rendered with public-domain Splendid or CC BY 3.0 Salamander samples. | **Keep active** with existing source and attribution notices. |
| Splendid sample library | Public domain; source recorded in `webapp/public/audio/SOURCES.md`. | Eligible for public tests, though the viewer's full playback library does not become an engine runtime asset. |
| Salamander sample packages | Alexander Holm, CC BY 3.0; package version 1.0.5 and attribution recorded in `SOURCES.md`. | Eligible for public tests if attribution/license accompanies any redistributed subset. |
| `listenRoundTwoFixtures.ts` musical definitions | Original project-authored triad/tetrad test patterns. | Copyright-safe, but archive the Round 2 file. Task 06 may reuse selected patterns only after removing candidate/confirmation semantics. |
| `listenBenchmarkFixtures.ts` | Exact 27-moment pitch extraction from *Super Mario Bros. – Course Clear*. | **Private only.** Route to `piano-transcription-evals`; do not put in engine or viewer after cutover. |
| `listenOmittedBassFixtures.ts` | Decoded traces derived from Course Clear moments. | **Private only.** |
| `listenSafetyRegressionFixtures.ts` | Decoded traces and target definitions derived from Course Clear. | **Private only.** |
| Course Clear branches inside `listenBenchmark.ts`, `listenSequenceBenchmark.ts`, `listenDynamicsBenchmark.ts`, and focused-case code/tests | Exact sequence or derived test behavior. | **Split:** private copy for recording evaluation; public active suite gets an original replacement passage. |
| Real gold/silver MP3, MIDI, annotations, or their decoded traces | Private `piano-transcription-evals` corpus. | **Never copy, package, inspect, or decode in extraction.** |

The existing benchmark JSON files divide as follows:

- Public-safe aggregate/history candidates: `listen-matcher-domain-archive-task24.json`,
  `listen-matcher-multidomain-sweep-task08.json`,
  `listen-round-two-approved-profiles-task29.json`,
  `listen-round-two-candidate-manifest-task27.json`,
  `listen-round-two-corpus-task25-run1.json`,
  `listen-round-two-corpus-task25-run2.json`, and
  `listen-round-two-eligibility-manifest-task28.json`. Copy only to engine
  legacy, never to the active test package.
- Private because they contain per-event pitch/trace material derived in part
  from Course Clear: `listen-bass-qualification-task22.json`,
  `listen-dynamics-profile-validation-task11.json`,
  `listen-profile-validation-task13-run1.json`,
  `listen-profile-validation-task13-run2.json`,
  `listen-round-two-ablation-task26-run1.json`,
  `listen-round-two-ablation-task26-run2.json`, and
  `listen-sequence-profile-validation-task10.json`.
- `benchmark-results/README.md` and the historical Markdown reports may move as
  concise history only after confirming they do not reproduce the complete
  copyrighted pitch sequence. References to a title, aggregate counts, isolated
  chord examples, and opaque trace identifiers do not authorize copying exact
  score annotations.

## Baseline verification

The commands below were run from the clean source boundary on September 2,
2026, before extraction code was moved:

| Check | Command | Result |
| --- | --- | --- |
| Existing unit suite | `npm test` in `webapp` | Passed: pretest 3/3 entrypoints; main test 36/36 entrypoints. |
| Production build | `npm run build` in `webapp` | Passed: TypeScript and Vite 7.3.6 production build, 1,108 modules transformed. |
| Smallest end-to-end browser baseline | `node tools/online_amt/run_browser_benchmarks.mjs http://127.0.0.1:5174/online-amt-benchmark.html listen-smoke` | Passed for Direct and Tone; both matched their recorded baselines, advanced at 196 ms, emitted 35 trace frames, and reproduced structure hashes `83fbd243` and `5c164339`. |
| New public core fixture | Bundled `onlineAmtOutput.test.ts` | Passed; both decoder frames and both matcher updates match the JSON exactly. |

The baseline run did **not** use `listen-round-two-corpus`,
`listen-round-two-ablation`, any profile-validation/confirmation command, or an
eval recording path. `npm test` only exercised deterministic Node-side policy,
schema, fixture, and archived-artifact checks; it performed no browser rendering
or ONNX inference. The browser command imported only the isolated C-major smoke
path. Therefore Task 01 decoded neither a preserved Round 2 confirmation fixture
nor any Round 3 recording/experiment.

## Task 01 acceptance

- Every whole-file move above has one target owner; mixed files are explicitly
  blocked from whole-file copying and name their split.
- Post-extraction core parity has a normal public-safe JSON test fixture, not an
  evidence chain.
- The default, all profile thresholds, fixed policy, protocol, model, worklet,
  and browser smoke outputs are frozen above.
- The existing unit suite, production build, canonical browser smoke, and new
  core fixture pass.
- No production value changed, and no Round 2 confirmation or Round 3 outcome
  was decoded.
