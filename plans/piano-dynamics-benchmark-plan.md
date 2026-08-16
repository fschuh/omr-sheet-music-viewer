# Piano dynamics and benchmark plan

## Goals

- Support Splendid Grand Piano and Salamander Grand Piano through the same Tone.js playback path used by the app and offline benchmarks.
- Preserve `mp` as the app default whenever MusicXML dynamics are absent.
- Keep the existing canonical Splendid `mp` benchmark unchanged.
- Add deterministic Course Clear coverage for every recorded velocity layer and for velocity changes within one continuous passage.
- Avoid committing Salamander's approximately 76 MiB of generated browser assets.

## Repository and asset layout

The root `package.json` remains a dependency-free launcher for `tauri`, `tauri:dev`, `tauri:build`, and `web:build`. All JavaScript dependencies and asset-preparation hooks belong to `webapp/package.json`. The empty root `package-lock.json` can be removed separately if desired.

Use the following public layout:

```text
webapp/public/audio/
├── SOURCES.md
├── splendid-grand-piano/
│   ├── pp-*.ogg
│   ├── mp-*.ogg
│   ├── mf-*.ogg
│   └── ff-*.ogg
└── salamander-grand-piano/       # generated and gitignored
    ├── v01/*.ogg
    ├── v02/*.ogg
    └── ...
        v16/*.ogg
```

The existing Splendid files are already tracked. Moving them from `audio/piano` is a Git rename and does not duplicate their binary blobs.

Add an idempotent script under `webapp/tools/` that:

1. Reads the 16 locked `@audio-samples/piano-velocityN` packages from `webapp/node_modules`.
2. Copies their audio into `public/audio/salamander-grand-piano/v01` through `v16`.
3. Replaces `#` with `s` in browser-facing filenames.
4. Validates package versions, expected roots, file counts, and non-empty files.
5. Writes a marker describing the prepared package versions and skips unchanged assets on later runs.

Run preparation automatically from `predev`, `prebuild`, and the WASM benchmark server lifecycle. Consequently, `npm run tauri:dev`, `npm run tauri:build`, ordinary Vite development, and browser benchmarks require no manual preparation command.

## Shared piano definitions

Create a registry containing:

- Piano ID and display name.
- Ordered velocity layers and stable layer IDs.
- Sample-root URL maps and concert-pitch corrections.
- Source and license metadata.
- Default musical dynamic and its concrete layer.
- Layers included in the dynamics benchmark.

Splendid exposes `pp`, `mp`, `mf`, and `ff`. Salamander exposes `v01` through `v16`. Missing score dynamics remain semantically `mp`; Splendid selects `mp`, while Salamander uses an explicitly configured and documented `mp` equivalent.

## Tone playback changes

Tone's velocity argument changes gain and does not select recorded velocity layers. Add routing above Tone that selects the appropriate layer sampler before triggering an attack.

Keep these concepts separate:

- Musical strike velocity or explicit layer: selects the recorded acoustic layer.
- Chord mix gain: reduces summed level for larger chords.

All loaded layer samplers share the current compressor and limiter. Track the sampler used for each active note so release is sent to the layer that performed the attack. Load only the selected piano and the layers required for current playback.

## App settings

Add a persisted `Playback piano` selector to the Settings screen with:

- Splendid Grand Piano
- Salamander Grand Piano

Splendid remains the initial piano. Changing the selection stops current playback, disposes the old engine, creates the selected engine, and reports loading errors through the existing playback error path. No piano selector is added to the score viewer controls.

## Benchmark renderer configuration

Represent piano selection separately from renderer identity:

```text
renderer: legacy | tone
piano: splendid | salamander
layer: pp | mp | mf | ff | v01 ... v16
dynamicProfile: constant | crescendo-decrescendo
```

Both renderers consume the same selected sample-root map. The canonical renderer constants and existing Splendid `mp` results remain unchanged. Every new result records renderer, piano, layer or profile, sample-library version, peak, RMS, and PCM signature.

## Asset and routing smoke checks

Before a full inference run, verify:

- Generated URLs and representative files from every layer load and decode.
- Rendered PCM is finite and non-silent.
- Selected layers produce distinct PCM signatures.
- Result metadata identifies the requested piano and layer.
- Chord size changes mix gain but never the selected layer.
- Splendid `mp` still produces the canonical benchmark configuration.

## Course Clear dynamics benchmark

Use the existing normal-articulation Course Clear passage: 27 physical attacks at a 1000 ms interval, with unchanged targets, timing, hold, and release behavior.

Run constant-layer passes for:

- Splendid: `pp`, `mp`, `mf`, `ff`.
- Salamander: `v01` through `v16`.
- Renderers: legacy and Tone.

This produces 40 runs. Report each layer separately, then summarize each piano before calculating an equally weighted cross-piano aggregate. Include ordered advances, independent matches, complete-passage status, misses, false/skipped/duplicate advances, latency, peak, RMS, and the worst-performing layer.

## Mixed-dynamics Course Clear benchmark

Add one continuous crescendo-decrescendo run per piano and renderer. Assign one velocity layer to every physical attack, using the same layer for all notes in a simultaneous chord.

- Splendid progresses through its four layers and back down.
- Salamander progresses through all 16 layers and back down.
- Recognition state is not reset between attacks.
- Pitch, timing, articulation, targets, and matcher configuration remain unchanged.

This produces four additional runs and tests whether preceding loud or quiet events affect subsequent recognition.

## Browser runner and reporting

- Add separate manual controls for constant-layer and mixed-dynamics Course Clear suites.
- Add dedicated automatic-run query parameters rather than applying a layer override to every existing benchmark.
- Add paired legacy/Tone configurations to the browser runner.
- Export concise JSON with per-run and aggregate results.
- Record the methodology and measured results in a dedicated dynamics benchmark Markdown report linked from the benchmark index.

## Verification order

1. Registry, preference, routing, and summary unit tests.
2. Production TypeScript/Vite build.
3. Canonical Splendid `mp` regression check.
4. Browser smoke for Splendid `mp` and Salamander `v01`/`v16` under both renderers.
5. One mixed-dynamics browser smoke.
6. Full 40-run constant-layer suite and four mixed-dynamics runs.
7. Review safety failures and worst layers before documenting results.

## Acceptance criteria

- `npm run tauri:dev` and benchmark startup prepare missing Salamander assets automatically.
- Salamander audio files are absent from Git status and source history.
- The app exposes piano choice only in Settings and persists it.
- Missing MusicXML dynamics use `mp` semantics.
- Chord size cannot change the acoustic velocity layer.
- Existing canonical Splendid `mp` benchmark behavior does not regress.
- All 20 recorded layers complete Course Clear under both renderers and are reported individually.
- The mixed-dynamics suite runs as one uninterrupted trace per piano and renderer.
- Wrong, skipped, duplicate, and carried-bass safety changes are reported explicitly rather than hidden by aggregate accuracy.
