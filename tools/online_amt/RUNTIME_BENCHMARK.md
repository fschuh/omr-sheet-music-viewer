# online_amt runtime benchmark

[Back to the benchmark index](BENCHMARK.md).

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

## Parity

- The exported PyTorch step produced exactly the same decoded states, silence
  gate, and silence counter as the original `OnlineTranscriber` for all 180
  reference frames.
- Native ONNX Runtime differed from PyTorch by at most `3.04e-5` in a weighted
  state score, with zero decoded-state or signal-gate mismatches.
- Browser WASM differed from native ONNX Runtime by at most `3.44e-5`, with zero
  decoded-state or signal-gate mismatches in every tested configuration.

## Running the benchmark

From the repository root:

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
```
