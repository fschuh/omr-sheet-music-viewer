import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const root = createRoot(document.getElementById("root") as HTMLElement);
const query = new URLSearchParams(window.location.search);
if (
  query.has("listen-benchmark") ||
  query.has("listen-sequence") ||
  query.has("listen-sequence-case") ||
  query.has("listen-threshold-sweep") ||
  query.has("listen-matcher-multidomain-sweep") ||
  query.has("listen-round-two-corpus") ||
  query.has("listen-round-two-ablation") ||
  query.has("listen-profile-validation") ||
  query.has("listen-isolated-profile-validation") ||
  query.has("listen-sequence-profile-validation") ||
  query.has("listen-dynamics-profile-validation") ||
  query.has("listen-retrigger-sweep") ||
  query.has("listen-articulation") ||
  query.has("listen-inference-reset") ||
  query.has("listen-dynamics-constant") ||
  query.has("listen-dynamics-mixed") ||
  query.has("listen-dynamics-case") ||
  query.has("listen-bass-qualification")
) {
  void import("./listen/benchmarks/ListenBenchmarkPage").then(({ ListenBenchmarkPage }) => {
    root.render(<StrictMode><ListenBenchmarkPage /></StrictMode>);
  });
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
