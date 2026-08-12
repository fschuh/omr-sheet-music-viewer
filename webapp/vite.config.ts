import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  // Keep the desktop app on its original single-thread WASM path. Isolation is
  // only needed by the explicit multi-thread online_amt benchmark server.
  const isolationHeaders = mode === "wasm-benchmark"
    ? {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      }
    : undefined;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      headers: isolationHeaders,
    },
    preview: {
      headers: isolationHeaders,
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          onlineAmtBenchmark: resolve(__dirname, "online-amt-benchmark.html"),
          listenBenchmarkParity: resolve(__dirname, "listen-benchmark-parity.html"),
        },
      },
    },
  };
});
