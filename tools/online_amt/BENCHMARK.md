# online_amt benchmarks

This page is the entry point for the runtime and listening benchmark reports.
Measured details and historical results live in the focused documents so that
the current conclusions remain easy to find.

| Area | Current conclusion | Detailed report |
| --- | --- | --- |
| Runtime | Production's single-threaded optimized browser WASM configuration keeps pace with the 32 ms input cadence and preserves model-output parity. | [Runtime benchmark](RUNTIME_BENCHMARK.md) |
| Listening | The deterministic corpus remains a regression gate, while acoustic-piano and other live-input trials are still required before production matcher changes. | [Listening benchmark](LISTEN_BENCHMARK.md) |

## Listening renderers

Listening recognition results keep the renderers together as paired rows or
columns rather than separating them into renderer-specific reports.

| Result label | Renderer | Purpose |
| --- | --- | --- |
| `*-legacy` | `bundled-piano-web-audio-v1` | Preserves the historical direct sample mixer and its existing baselines. |
| `*-tone` | `bundled-piano-tone-v2` | Reuses the app's Tone.js sampler, velocity curve, exponential release, compressor, and limiter. |

Except for the legacy-only renderer linearity check, listening automation runs
both configurations consecutively and includes renderer identity in each result.
Existing numerical history predates the paired run and therefore remains labelled
as the direct-renderer baseline until new paired measurements are recorded.

## Reports

- [Runtime performance and parity](RUNTIME_BENCHMARK.md)
- [Listening accuracy, sequence, articulation, reset, threshold, and retrigger history](LISTEN_BENCHMARK.md)
- [ONNX export and validation workflow](README.md)
