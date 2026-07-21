import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const root = createRoot(document.getElementById("root") as HTMLElement);
if (new URLSearchParams(window.location.search).has("listen-benchmark")) {
  void import("./ListenBenchmarkPage").then(({ ListenBenchmarkPage }) => {
    root.render(<StrictMode><ListenBenchmarkPage /></StrictMode>);
  });
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
