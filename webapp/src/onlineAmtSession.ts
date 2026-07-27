import {
  env,
  InferenceSession,
  Tensor,
  type InferenceSession as InferenceSessionType,
} from "onnxruntime-web/wasm";
import {
  ONLINE_AMT_CHUNK_SIZE,
  ONLINE_AMT_SAMPLE_RATE,
} from "./onlineAmtProtocol";

const WASM_URL = new URL(
  "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  import.meta.url,
).href;

const STATE_INPUTS = [
  "audio_buffer",
  "mel_buffer",
  "cnn_cache_1",
  "cnn_cache_2",
  "lstm_h",
  "lstm_c",
  "previous_output",
  "silence_count",
] as const;

const STATE_OUTPUTS = [
  "audio_buffer_out",
  "mel_buffer_out",
  "cnn_cache_1_out",
  "cnn_cache_2_out",
  "lstm_h_out",
  "lstm_c_out",
  "previous_output_out",
  "silence_count_out",
] as const;

export type WasmGraphOptimizationLevel =
  NonNullable<InferenceSessionType.SessionOptions["graphOptimizationLevel"]>;

export interface OnlineAmtSessionOptions {
  modelUrl: string;
  numThreads?: number;
  graphOptimizationLevel?: WasmGraphOptimizationLevel;
  enableCpuMemArena?: boolean;
  enableMemPattern?: boolean;
  executionMode?: "sequential" | "parallel";
}

export interface OnlineAmtStepResult {
  scores: Float32Array<ArrayBuffer>;
  states: Uint8Array<ArrayBuffer>;
  signalActive: boolean;
  inferenceTimeMs: number;
}

type StateMap = Record<(typeof STATE_INPUTS)[number], Tensor>;

function zeroState(): StateMap {
  return {
    audio_buffer: new Tensor("float32", new Float32Array(5_120), [1, 5_120]),
    mel_buffer: new Tensor("float32", new Float32Array(229 * 7), [1, 229, 7]),
    cnn_cache_1: new Tensor(
      "float32",
      new Float32Array(64 * 5 * 229),
      [1, 64, 5, 229],
    ),
    cnn_cache_2: new Tensor(
      "float32",
      new Float32Array(64 * 3 * 114),
      [1, 64, 3, 114],
    ),
    lstm_h: new Tensor("float32", new Float32Array(2 * 512), [2, 1, 512]),
    lstm_c: new Tensor("float32", new Float32Array(2 * 512), [2, 1, 512]),
    previous_output: new Tensor("int64", new BigInt64Array(88), [1, 1, 88]),
    silence_count: new Tensor("int64", new BigInt64Array(1), [1]),
  };
}

function disposeState(state: StateMap): void {
  for (const tensor of Object.values(state)) tensor.dispose();
}

export class OnlineAmtSession {
  private readonly session: InferenceSession;
  private state: StateMap = zeroState();
  private resetPending = true;

  private constructor(session: InferenceSession) {
    this.session = session;
  }

  static async create(options: OnlineAmtSessionOptions): Promise<OnlineAmtSession> {
    env.wasm.wasmPaths = { wasm: WASM_URL };
    env.wasm.numThreads = options.numThreads ?? 1;
    env.wasm.proxy = false;
    const session = await InferenceSession.create(options.modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: options.graphOptimizationLevel ?? "all",
      enableCpuMemArena: options.enableCpuMemArena ?? true,
      enableMemPattern: options.enableMemPattern ?? true,
      executionMode: options.executionMode ?? "sequential",
    });
    return new OnlineAmtSession(session);
  }

  reset(): void {
    this.resetPending = true;
  }

  async run(audio: Float32Array): Promise<OnlineAmtStepResult> {
    if (audio.length !== ONLINE_AMT_CHUNK_SIZE) {
      throw new Error(
        `online_amt requires ${ONLINE_AMT_CHUNK_SIZE} samples, received ${audio.length}`,
      );
    }
    const audioTensor = new Tensor(
      "float32",
      new Float32Array(audio),
      [1, ONLINE_AMT_CHUNK_SIZE],
    );
    const resetTensor = new Tensor(
      "bool",
      Uint8Array.of(this.resetPending ? 1 : 0),
      [1],
    );
    const feeds: InferenceSessionType.FeedsType = {
      audio_chunk: audioTensor,
      reset: resetTensor,
      ...this.state,
    };
    const previousState = this.state;
    const startedAt = performance.now();
    let output: InferenceSessionType.ReturnType;
    try {
      output = await this.session.run(feeds);
    } finally {
      audioTensor.dispose();
      resetTensor.dispose();
    }
    const inferenceTimeMs = performance.now() - startedAt;

    const nextState = {} as StateMap;
    for (let index = 0; index < STATE_INPUTS.length; index += 1) {
      const tensor = output[STATE_OUTPUTS[index]];
      if (!(tensor instanceof Tensor)) {
        throw new Error(`online_amt did not return ${STATE_OUTPUTS[index]}`);
      }
      nextState[STATE_INPUTS[index]] = tensor;
    }
    this.state = nextState;
    this.resetPending = false;
    disposeState(previousState);

    const scoreTensor = output.scores;
    const activeTensor = output.signal_active;
    if (!(scoreTensor instanceof Tensor) || !(activeTensor instanceof Tensor)) {
      throw new Error("online_amt returned incomplete recognition output");
    }
    const scoreData = scoreTensor.data;
    const activeData = activeTensor.data;
    if (!(scoreData instanceof Float32Array) || !(activeData instanceof Uint8Array)) {
      throw new Error("online_amt returned unexpected output tensor types");
    }
    const scores = new Float32Array(scoreData);
    const previousData = this.state.previous_output.data;
    if (!(previousData instanceof BigInt64Array)) {
      throw new Error("online_amt returned an unexpected recurrent state type");
    }
    const states = new Uint8Array(previousData.length);
    for (let index = 0; index < previousData.length; index += 1) {
      states[index] = Number(previousData[index]);
    }
    const signalActive = activeData[0] !== 0;
    scoreTensor.dispose();
    activeTensor.dispose();
    return { scores, states, signalActive, inferenceTimeMs };
  }

  async dispose(): Promise<void> {
    disposeState(this.state);
    await this.session.release();
  }
}
