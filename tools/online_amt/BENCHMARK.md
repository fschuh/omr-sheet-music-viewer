# online_amt benchmarks

> Historical reference — September 6, 2026. Round 1/2 emitters, verifiers, and
> artifact-chain tests are non-active. Commands recorded below apply to viewer
> commit `89afafcdd7fd06db0626feba6a0665ab1c3bf798`. Final outcomes and source
> links are in
> [fschuh/piano-transcription-engine](https://github.com/fschuh/piano-transcription-engine)
> at `legacy/rounds-1-2/README.md`.
>
> Superseded September 6, 2026: the benchmark page, browser driver, emitters,
> evidence verifier, and every module named below were removed from this
> repository when the engine took ownership of listen evaluation. Nothing here
> is reproducible against the current tree; check out viewer commit
> `89afafcdd7fd06db0626feba6a0665ab1c3bf798` to run any of it. Dated entries
> below are preserved unchanged.

This page is the entry point for the runtime and listening benchmark reports.
Measured details and historical results live in the focused documents so that
the current conclusions remain easy to find.

| Area | Current conclusion | Detailed report |
| --- | --- | --- |
| Runtime | Production's single-threaded optimized browser WASM configuration keeps pace with the 32 ms input cadence and preserves model-output parity. | [Runtime benchmark](RUNTIME_BENCHMARK.md) |
| Listening | Production runs `baseline-v1`; the August 21 confirmation rejected all four round-one candidates. Task 24's complete-grid, 29-domain version-1 control says one global profile suffices on discovery data, but Task 26 must rerun the frozen rule after isolated correct recognition enters version-2 scoring. No threshold or default changed. | [Listening benchmark](LISTEN_BENCHMARK.md) |
| Piano dynamics | All 20 recorded layers render distinctly under both renderers. Constant-layer recognition is 90.9% independent for legacy and 89.2% for Tone on the equal-piano aggregate, with zero false, skipped, and duplicate advances after the Tone Salamander `v05` event was diagnosed as a late advance on correct pitch content. | [Piano dynamics benchmark](PIANO_DYNAMICS_BENCHMARK.md) |

## Listening renderers

Listening recognition results keep the renderers together as paired rows or
columns rather than separating them into renderer-specific reports.

| Result label | Renderer | Purpose |
| --- | --- | --- |
| `*-legacy` | `bundled-piano-web-audio-v1` | Preserves the historical direct sample mixer and its existing baselines. |
| `*-tone` | `bundled-piano-tone-v2` | Reuses the app's Tone.js sampler, velocity curve, exponential release, compressor, and limiter. |

Except for the legacy-only renderer linearity check, listening automation runs
both configurations consecutively and includes renderer identity in each result.
The August 15 paired baseline records both renderers against the same isolated
and continuous corpora. These deterministic results remain a regression gate;
acoustic-piano and other live-input trials are still required before production
matcher changes.

## Production matcher profile

Listen mode advances on the thresholds of one named profile from the versioned
registry in `webapp/src/listen/listenMatcherProfiles.ts`. The production default is
`DEFAULT_LISTEN_MATCHER_PROFILE_ID`, currently `baseline-v1`, and the
[August 22 production profile decision](LISTEN_BENCHMARK.md#production-profile-decision--august-22-2026)
is the entry that records why. Changing or rolling back the default is one edit
to that constant: every historical profile stays in the registry so a released
value can be reproduced and reverted without reconstructing it from this history.

## Reports

- [Runtime performance and parity](RUNTIME_BENCHMARK.md)
- [Listening accuracy, sequence, articulation, reset, threshold, and retrigger history](LISTEN_BENCHMARK.md)
- [Piano velocity-layer and mixed-dynamics results](PIANO_DYNAMICS_BENCHMARK.md)
- [ONNX export and validation workflow](README.md)
