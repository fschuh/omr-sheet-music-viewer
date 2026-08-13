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
```
