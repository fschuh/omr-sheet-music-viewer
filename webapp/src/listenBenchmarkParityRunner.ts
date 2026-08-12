import { runListenBenchmarkParityTests } from "./listenBenchmarkParity.browser";

declare global {
  interface Window {
    listenBenchmarkParityResult?: unknown;
  }
}

void runListenBenchmarkParityTests((stage) => {
  document.querySelector("#status")!.textContent = stage;
}).then((result) => {
  window.listenBenchmarkParityResult = result;
  document.querySelector("#status")!.textContent = "Parity checks complete.";
  document.querySelector("#result")!.textContent = JSON.stringify(result, null, 2);
  document.body.dataset.status = "complete";
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  document.querySelector("#status")!.textContent = "Parity checks failed.";
  document.querySelector("#result")!.textContent = message;
  document.body.dataset.status = "error";
});
