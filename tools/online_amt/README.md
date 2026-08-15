# online_amt ONNX export

The viewer keeps `online_amt`'s PyTorch implementation as the reference and
ships a fixed-shape ONNX graph for listening-mode inference.

From the viewer repository root:

```powershell
$python = "..\..\online_amt\.venv\Scripts\python.exe"
& $python tools\online_amt\export_streaming_onnx.py `
  --source-root ..\..\online_amt `
  --checkpoint ..\..\online_amt\model-180000.pt `
  --output webapp\public\models\online_amt_streaming.onnx

& $python tools\online_amt\validate_streaming_onnx.py `
  --source-root ..\..\online_amt `
  --checkpoint ..\..\online_amt\model-180000.pt `
  --onnx webapp\public\models\online_amt_streaming.onnx `
  --browser-fixture-dir webapp\public\models\online_amt_fixture
```

The graph consumes one 512-sample, 16 kHz mono chunk and returns the five
weighted state scores for all 88 piano keys plus every updated streaming state.
Passing `reset=true` selects initial mel/CNN/LSTM state embedded in the graph.

The browser runtime uses the same 512-sample cadence in an AudioWorklet and
passes chunks to a dedicated inference worker. See the [benchmark index](BENCHMARK.md)
and [runtime benchmark](RUNTIME_BENCHMARK.md) for the PyTorch, native ONNX Runtime,
and browser WASM parity and latency results.

The exported graph and the adapted streaming code are derived from
`jdasam/online_amt`, which is distributed under the MIT license. The required
copyright and license notice is shipped next to the model in
`webapp/public/models/online_amt.LICENSE.txt`.
