// The viewer resolves ONNX Runtime's WASM binary from its own dependency copy so
// the engine package never depends on how npm placed its node_modules. Vite
// rewrites this into an emitted asset in development and in production builds.
export const ONLINE_AMT_WASM_URL = new URL(
  "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  import.meta.url,
).href;
