import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

// The engine is one pinned Git dependency, so the app reports which revision it
// was built against. The pin lives in this package's own dependency
// specification; the version comes from the package npm actually installed.
function listenEngineIdentity(): { label: string; detail: string } {
  const spec: string = require("./package.json")
    .dependencies["@fschuh/piano-transcription-engine"];
  const { name, version } = require("@fschuh/piano-transcription-engine/package.json");
  const revision = spec.includes("#") ? spec.slice(spec.lastIndexOf("#") + 1) : spec;
  const shortRevision = /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;
  return {
    label: `${version} · ${shortRevision}`,
    detail: `${name}@${version} (${revision})`,
  };
}

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
    define: {
      __LISTEN_ENGINE__: JSON.stringify(listenEngineIdentity()),
    },
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
