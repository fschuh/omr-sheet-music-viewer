import {
  predictFingerings,
  type Models,
} from "@lumikey/piano-fingering-model";
import { env, InferenceSession } from "onnxruntime-web/wasm";
import type { IndexedFingeringNote } from "./fingering";

const LEFT_MODEL_URL = new URL(
  "../node_modules/@lumikey/piano-fingering-model/models/fingering_transformer_left.onnx",
  import.meta.url,
).href;
const RIGHT_MODEL_URL = new URL(
  "../node_modules/@lumikey/piano-fingering-model/models/fingering_transformer_right.onnx",
  import.meta.url,
).href;
const ONNX_WASM_URL = new URL(
  "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  import.meta.url,
).href;
const FINGERING_TIMEOUT_MS = 30_000;

env.wasm.wasmPaths = { wasm: ONNX_WASM_URL };
// Fingering performs one very small inference per score note. Pthread setup and
// synchronization cost more than they save here, and some desktop webviews can
// stall while starting ONNX Runtime's shared worker pool.
env.wasm.numThreads = 1;
env.wasm.proxy = false;
env.wasm.initTimeout = 15_000;

let modelPromise: Promise<Models> | null = null;

async function withTimeout<T>(
  operation: Promise<T>,
  description: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${description} timed out after 30 seconds`)),
          FINGERING_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function loadModels(): Promise<Models> {
  const sessionOptions: InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const left = await InferenceSession.create(LEFT_MODEL_URL, sessionOptions);
  const right = await InferenceSession.create(RIGHT_MODEL_URL, sessionOptions);
  return { left, right };
}

function models(): Promise<Models> {
  if (!modelPromise) {
    modelPromise = loadModels().catch((error: unknown) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

export async function predictPianoFingerings(
  notes: IndexedFingeringNote[],
): Promise<IndexedFingeringNote[]> {
  if (notes.length === 0) return [];
  const loadedModels = await withTimeout(models(), "Piano fingering model loading");
  const result = await withTimeout(
    predictFingerings(notes, loadedModels),
    "Piano fingering prediction",
  );
  // The package copies every input note with object spread, so our stable source index is retained.
  return result as IndexedFingeringNote[];
}
