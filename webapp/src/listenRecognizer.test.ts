import assert from "node:assert/strict";
import test from "node:test";
import {
  browserOnlineAmtRecognizerOptions,
  describeListenRecognizerError,
} from "./listenRecognizer";

function withBaseUri<T>(baseURI: string, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    value: { baseURI },
    configurable: true,
    writable: true,
  });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete (globalThis as { document?: unknown }).document;
  }
}

test("points the engine at the assets prepared from the installed package", () => {
  const options = withBaseUri("https://viewer.test/app/", browserOnlineAmtRecognizerOptions);
  assert.equal(
    options.modelUrl,
    "https://viewer.test/app/generated-listen-assets/online_amt_streaming.onnx",
  );
  assert.equal(
    options.workletUrl,
    "https://viewer.test/app/generated-listen-assets/online-amt-capture.js",
  );
});

test("keeps microphone permission and device wording in the viewer", () => {
  const options = withBaseUri("https://viewer.test/app/", browserOnlineAmtRecognizerOptions);
  assert.equal(options.describeError, describeListenRecognizerError);
  for (const name of ["NotAllowedError", "SecurityError"]) {
    assert.equal(
      describeListenRecognizerError(new DOMException("denied", name)),
      "Microphone permission was denied.",
    );
  }
  for (const name of ["NotFoundError", "DevicesNotFoundError"]) {
    assert.equal(
      describeListenRecognizerError(new DOMException("missing", name)),
      "No default microphone was found.",
    );
  }
});

test("leaves an unrecognized failure to the engine's own message", () => {
  assert.equal(describeListenRecognizerError(new Error("model load failed")), undefined);
  assert.equal(describeListenRecognizerError(new DOMException("busy", "AbortError")), undefined);
});
