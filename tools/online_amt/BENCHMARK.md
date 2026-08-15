# online_amt benchmarks

This page is the entry point for the runtime and listening benchmark reports.
Measured details and historical results live in the focused documents so that
the current conclusions remain easy to find.

| Area | Current conclusion | Detailed report |
| --- | --- | --- |
| Runtime | Production's single-threaded optimized browser WASM configuration keeps pace with the 32 ms input cadence and preserves model-output parity. | [Runtime benchmark](RUNTIME_BENCHMARK.md) |
| Listening | Direct v1 passes isolated acceptance at 98.1%; Tone v2 falls to 94.3% but improves aggregate continuous ordered advances from 331 to 355. Both retain zero false/skipped/duplicate advances in the dedicated safety families. | [Listening benchmark](LISTEN_BENCHMARK.md) |

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

## Reports

- [Runtime performance and parity](RUNTIME_BENCHMARK.md)
- [Listening accuracy, sequence, articulation, reset, threshold, and retrigger history](LISTEN_BENCHMARK.md)
- [ONNX export and validation workflow](README.md)
