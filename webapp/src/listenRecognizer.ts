import { BrowserOnlineAmtRecognizer } from "@fschuh/piano-transcription-engine/browser";
import type { BrowserOnlineAmtRecognizerOptions } from "@fschuh/piano-transcription-engine/browser";

// The engine owns the canonical model and worklet; prepare:listen-assets copies
// them here from the installed package before dev and production builds.
const MODEL_PATH = "generated-listen-assets/online_amt_streaming.onnx";
const WORKLET_PATH = "generated-listen-assets/online-amt-capture.js";

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * Application wording for capture failures. The engine reports the underlying
 * error; browser permission and device phrasing belongs to the viewer.
 */
export function describeListenRecognizerError(error: unknown): string | undefined {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No default microphone was found.";
    }
  }
  return undefined;
}

export function browserOnlineAmtRecognizerOptions(): BrowserOnlineAmtRecognizerOptions {
  return {
    modelUrl: assetUrl(MODEL_PATH),
    workletUrl: assetUrl(WORKLET_PATH),
    // Vite discovers and bundles this worker entry from the viewer source tree.
    createWorker: () => new Worker(new URL("./onlineAmtWorker.ts", import.meta.url), {
      type: "module",
      name: "online-amt-inference",
    }),
    describeError: describeListenRecognizerError,
  };
}

export function createBrowserOnlineAmtRecognizer(): BrowserOnlineAmtRecognizer {
  return new BrowserOnlineAmtRecognizer(browserOnlineAmtRecognizerOptions());
}
