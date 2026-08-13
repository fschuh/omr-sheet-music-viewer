import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const root = createRoot(document.getElementById("root") as HTMLElement);
const query = new URLSearchParams(window.location.search);
if (
  query.has("listen-benchmark") ||
  query.has("listen-sequence") ||
  query.has("listen-articulation")
) {
  void import("./ListenBenchmarkPage").then(({ ListenBenchmarkPage }) => {
    root.render(<StrictMode><ListenBenchmarkPage /></StrictMode>);
  });
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
