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

env.wasm.wasmPaths = { wasm: ONNX_WASM_URL };

let modelPromise: Promise<Models> | null = null;

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
  const result = await predictFingerings(notes, await models());
  // The package copies every input note with object spread, so our stable source index is retained.
  return result as IndexedFingeringNote[];
}
