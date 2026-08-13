# online_amt runtime benchmark

Measured on July 26, 2026 on the development Windows machine. Browser results
use Chrome 150 with ten logical processors reported by
`navigator.hardwareConcurrency`. Each inference consumes 512 samples at 16 kHz,
so the runtime must stay below the 32 ms input cadence.

The native comparison used 180 frames with 20 warm-up frames. Browser
configurations used 60 frames with 12 warm-up frames. These figures measure one
model step and tensor handoff, not microphone capture or chord-settling latency.

| Runtime/configuration | p50 | p95 | p99 | Result |
| --- | ---: | ---: | ---: | --- |
| PyTorch 2.13 CPU, 1 thread | 13.33 ms | 18.25 ms | 23.38 ms | Keeps pace |
| Native ONNX Runtime CPU | 3.90 ms | 18.88 ms | 33.46 ms | Faster median, noisy tail |
| Browser WASM, 1 thread, optimized | 13.79 ms | 14.92 ms | 15.55 ms | Keeps pace |
| Browser WASM, 2 threads, optimized | 8.24 ms | 9.94 ms | 13.03 ms | Keeps pace; isolation required |
| Browser WASM, 4 threads, optimized | 5.73 ms | 8.22 ms | 40.41 ms | Tail exceeded cadence |
| Browser WASM, 8 threads, optimized | 5.10 ms | 15.24 ms | 26.19 ms | Keeps pace; higher tail |
| Browser WASM, 1 thread, optimization disabled | 20.69 ms | 22.59 ms | 23.29 ms | Keeps pace |
| Browser WASM, 1 thread, basic optimization | 13.56 ms | 14.84 ms | 14.88 ms | Keeps pace |
| Browser WASM, 1 thread, extended optimization | 13.81 ms | 15.23 ms | 15.50 ms | Keeps pace |
| Browser WASM, 1 thread, no CPU arena | 14.05 ms | 16.07 ms | 16.75 ms | Keeps pace |
| Browser WASM, 1 thread, no memory pattern | 14.12 ms | 15.00 ms | 23.59 ms | Keeps pace |
| Browser WASM, 4 threads, parallel execution | 6.32 ms | 12.52 ms | 18.13 ms | Keeps pace; isolation required |

A separate production-like run without cross-origin isolation measured the
selected one-thread configuration at 12.90 ms p50, 13.90 ms p95, and 14.60 ms
p99. Local model fetch plus WASM session creation took 1.40 seconds. This is the
configuration used by the app because it is stable, comfortably faster than
the input cadence, and does not require special webview response headers.

Parity:

- The exported PyTorch step produced exactly the same decoded states, silence
  gate, and silence counter as the original `OnlineTranscriber` for all 180
  reference frames.
- Native ONNX Runtime differed from PyTorch by at most `3.04e-5` in a weighted
  state score, with zero decoded-state or signal-gate mismatches.
- Browser WASM differed from native ONNX Runtime by at most `3.44e-5`, with zero
  decoded-state or signal-gate mismatches in every tested configuration.

## Listening benchmark history

Entries are kept newest first so renderer and recognition changes remain
comparable over time.

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
- unique isolated one-event controls, each with the existing 220 ms pre-roll.

Reset points are aligned to the first frame beginning at or after scheduled attack minus
220 ms. The first normal-articulation reset begins at 1024 ms for the 1220 ms attack,
providing 196 ms of clean warm-up after the preceding 990 ms release-tail end. Every
trace records the reset plan, renderer diagnostics, PCM hash, and per-chunk hashes so
browser automation can verify that only the recurrent reset schedule differs.

Verification results:

- `npm run build`: passed.
- `npm test`: 195 / 195 tests passed, including the new reset-plan, paired-input,
  reset-order, classification, and conclusion tests.
- Production listen mode and matcher behavior remain unchanged; this comparison is
  exposed only through the benchmark page button and the `listen-inference-reset` /
  `listen-inference-reset-summary` automation modes.

Measured browser run (August 13, 2026, `listen-inference-reset-summary`):

| Control | Independent match | Ordered advance | Safety (false / skip / duplicate) | Latency p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Isolated | 26 / 27 (96.3%) | 26 / 27 (96.3%) | 0 / 0 / 0 | — |
| Stateful continuous | 26 / 27 (96.3%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |
| Event-reset continuous | 25 / 27 (92.6%) | 20 / 27 (74.1%) | 0 / 0 / 0 | 188 / 204 ms |

The reset comparison recovered 0 events and lost 0 events; it recovered 2 raw
pitch qualifications and lost 0, while raw complete evidence stayed at 23 / 27
and fresh attacks stayed at 67 / 67. Independent matching changed by -1 event,
ordered advancement did not change, and no safety errors increased. The computed
conclusion is `matcher-playhead-cascade`: independent recognition was essentially
unchanged while ordered advancement remained behind it. The result’s run-local PCM
signature was `7e01bcd1` over 434,176 samples and 848 identical 512-sample chunks
between the two continuous passes.

The page exposes the complete captured conclusion as
`window.listenInferenceResetBenchmarkResult.conclusion` and retains the raw-model,
decoder-event, per-pitch, reset-plan, safety, latency, and isolated-control details
for subsequent runs.

### Course Clear articulation matrix — August 12, 2026

Four independent continuous traces used the same 27 Course Clear targets and
1000 ms attack timestamps. The renderer, online-AMT session configuration, and
current matcher policy were fixed; only hold scheduling changed. The onset
buffer experiment was not included.

| Articulation | Raw evidence | Fresh attacks | Independent match | Ordered advance | Complete | Stale sustain | Carry-over events | False / skip / duplicate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Detached, 250 ms hold | 23 / 27 (85.2%) | 65 / 69 (94.2%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Normal, 420 ms hold | 23 / 27 (85.2%) | 67 / 69 (97.1%) | 26 / 27 (96.3%) | 20 / 27 (74.1%) | No | 0 | 1 | 0 / 0 / 0 |
| Legato, 900 ms hold | 19 / 27 (70.4%) | 68 / 69 (98.6%) | 24 / 27 (88.9%) | 3 / 27 (11.1%) | No | 8 | 24 | 0 / 0 / 0 |
| Sustained shared notes | 24 / 27 (88.9%) | 66 / 67 (98.5%) | 25 / 27 (92.6%) | 20 / 27 (74.1%) | No | 2 | 2 | 0 / 0 / 0 |

The a-priori substantial-improvement threshold was three additional
independent matches (3 / 27, 11.1 percentage points) without added safety
errors. Detached produced one fewer independent match than normal, identical
raw evidence, two fewer fresh attacks, no stale sustains in either profile, and
no change in ordered advancement. All 26 detached inter-attack gaps were
exactly 400 ms with measured RMS 0. The computed conclusion is
`base-model-recall`: detached release isolation did not help, and expected
pitches still had missing model evidence. Legato strongly increased carry-over
and reduced ordered progress, while sustained shared notes added one
raw-evidence event but lost one independent match.

Browser renderer checks passed before the matrix: normal and the existing
Course Clear render differed by at most one Float32 ULP (`1.19e-7`), detached
gaps were silent, legato release tails overlapped the next attack, and the
sustained-shared new-note gain differed from the equivalent normal-chord
contribution by at most `7.45e-8`.

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

Commands:

```powershell
& '..\..\online_amt\.venv\Scripts\python.exe' `
  tools\online_amt\validate_streaming_onnx.py `
  --source-root '..\..\online_amt' `
  --checkpoint '..\..\online_amt\model-180000.pt' `
  --onnx 'webapp\public\models\online_amt_streaming.onnx' `
  --frames 180 `
  --browser-fixture-dir 'webapp\public\models\online_amt_fixture'

npm --prefix webapp run dev:wasm-benchmark

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5174/online-amt-benchmark.html

node tools\online_amt\run_browser_benchmarks.mjs `
  http://127.0.0.1:5173/ listen-accuracy

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
  http://127.0.0.1:5173/ listen-threshold-sweep
```
