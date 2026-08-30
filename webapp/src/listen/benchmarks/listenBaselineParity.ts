/**
 * Baseline parity for the listening benchmarks.
 *
 * Later profile comparisons are only meaningful if the harness itself is fixed.
 * These helpers assert that replaying a retained trace with the explicitly named
 * baseline profile reproduces the captured result event for event, and that the
 * canonical isolated smoke still matches constants recorded before the matcher
 * profile registry existed.
 *
 * The module imports only types from the benchmark modules, so benchmarks can
 * call it without creating an import cycle.
 *
 * Within one run everything is compared exactly, including raw scores and the
 * rendered waveform. Across runs only discrete quantities can be frozen: repeated
 * renders of the same chord in one browser process produce different waveform
 * bits, and inference over them produces different confidences, while the decoded
 * structure stays identical.
 */

import {
  LISTEN_MATCHER_PROFILES,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "../listenMatcherProfiles";
import type { ListenBenchmarkAudioSignature } from "./listenBenchmarkAudio";
import type {
  ListenRecognitionTrace,
  ListenSequenceRunResult,
} from "./listenSequenceBenchmark";

/**
 * The profile every historical replay must name. Baselines follow this frozen
 * registry entry rather than the production-default pointer, so a later default
 * change cannot silently redefine what a historical result means.
 */
export const LISTEN_BASELINE_PROFILE_ID: ListenMatcherProfileId = "baseline-v1";

export const LISTEN_BASELINE_PROFILE: ListenMatcherThresholds =
  listenMatcherThresholds(LISTEN_MATCHER_PROFILES[LISTEN_BASELINE_PROFILE_ID]);

/** Baseline profile identity recorded alongside a measured benchmark result. */
export interface ListenBaselineProfileMetadata {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
}

export function listenBaselineProfileMetadata(): ListenBaselineProfileMetadata {
  return { profileId: LISTEN_BASELINE_PROFILE_ID, profile: LISTEN_BASELINE_PROFILE };
}

const float32Scratch = new Float32Array(1);
const float32Bits = new Int32Array(float32Scratch.buffer);

/**
 * Orders Float32 values by their bit pattern so adjacency can be counted. Two
 * values one apart on this scale are neighbouring representable Float32 numbers.
 */
function float32Ordinal(value: number): number {
  float32Scratch[0] = value;
  const bits = float32Bits[0];
  return bits >= 0 ? bits : 0x8000_0000 - bits;
}

/**
 * True when the two values are the same Float32 or immediate neighbours. This
 * is the only tolerance in this module, and it exists solely because renderer
 * amplitude sums may land one representable step apart between audio paths.
 * Recognition values are always compared exactly.
 */
export function withinOneFloat32Ulp(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return Object.is(actual, expected);
  return Math.abs(float32Ordinal(actual) - float32Ordinal(expected)) <= 1;
}

/**
 * Reports the first differing path between two parity subjects. Returning the
 * path rather than a boolean keeps a failed regression debuggable.
 */
export function firstStructuralDifference(
  expected: unknown,
  actual: unknown,
  path = "",
): string | null {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual) return path || "(root)";
  if (typeof expected === "number" && typeof actual === "number") {
    return Object.is(expected, actual) ? null : path || "(root)";
  }
  if (expected === null || actual === null) return path || "(root)";
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path || "(root)";
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstStructuralDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (typeof expected === "object" && typeof actual === "object") {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const difference = firstStructuralDifference(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  return path || "(root)";
}

/**
 * FNV-1a over the decoded recognition stream. Every value that the model,
 * decoder, and capture loop produce is folded in through its exact IEEE bits,
 * so a single changed score, state, event, or timestamp changes the hash.
 * Wall-clock inference durations are excluded because they are not
 * reproducible; the recognition content they accompany is.
 */
class RecognitionHasher {
  private hash = 0x811c_9dc5;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  byte(value: number): void {
    this.hash = Math.imul(this.hash ^ (value & 0xff), 0x0100_0193) >>> 0;
  }

  number(value: number): void {
    this.scratch.setFloat64(0, value);
    for (let index = 0; index < 8; index += 1) this.byte(this.scratch.getUint8(index));
  }

  boolean(value: boolean): void {
    this.byte(value ? 1 : 0);
  }

  text(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.byte(code & 0xff);
      this.byte(code >>> 8);
    }
    this.byte(0);
  }

  numbers(values: readonly number[]): void {
    this.number(values.length);
    for (const value of values) this.number(value);
  }

  get digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, "0");
  }
}

/**
 * Identity of the decoder's discrete output: per-frame argmax states, the silence
 * gate, and every decoded onset, note event, active pitch, and evidence pitch
 * with its frame timestamp. Continuous confidences and raw scores are excluded,
 * so this hash survives the platform's audio and inference noise while still
 * changing whenever decoding actually decides something different.
 */
export function listenRecognitionStructureHash(trace: ListenRecognitionTrace): string {
  const hasher = new RecognitionHasher();
  hasher.text(trace.sequenceId);
  hasher.number(trace.sampleRate);
  hasher.number(trace.chunkSize);
  hasher.numbers(trace.relevantPitches);
  hasher.number(trace.frames.length);
  for (const frame of trace.frames) {
    hasher.number(frame.capturedAtMs);
    hasher.boolean(frame.signalActive);
    hasher.numbers(frame.modelStates);
    hasher.number(frame.onsets.length);
    for (const onset of frame.onsets) {
      hasher.number(onset.midi);
      hasher.number(onset.onsetTimeMs);
    }
    hasher.number(frame.noteEvents.length);
    for (const event of frame.noteEvents) {
      hasher.number(event.midi);
      hasher.text(event.type);
      hasher.number(event.eventTimeMs);
    }
    hasher.numbers(frame.activePitches.map(({ midi }) => midi));
    hasher.numbers(frame.confidenceEvidence.map(({ midi }) => midi));
  }
  return hasher.digest;
}

/**
 * Exact identity of everything the model and decoder produced, raw scores and
 * confidences included. Two traces of the same audio in one run must agree on
 * this; it is not stable across runs, because neither Chrome's offline audio
 * rendering nor ONNX Runtime reproduces the last few bits.
 */
export function listenRecognitionTraceHash(trace: ListenRecognitionTrace): string {
  const hasher = new RecognitionHasher();
  hasher.text(trace.sequenceId);
  hasher.number(trace.sampleRate);
  hasher.number(trace.chunkSize);
  hasher.numbers(trace.relevantPitches);
  hasher.number(trace.frames.length);
  for (const frame of trace.frames) {
    hasher.number(frame.capturedAtMs);
    hasher.boolean(frame.signalActive);
    hasher.numbers(frame.modelStates);
    hasher.numbers(frame.modelScores);
    hasher.number(frame.onsets.length);
    for (const onset of frame.onsets) {
      hasher.number(onset.midi);
      hasher.number(onset.confidence);
      hasher.number(onset.noteConfidence);
      hasher.number(onset.onsetTimeMs);
    }
    hasher.number(frame.noteEvents.length);
    for (const event of frame.noteEvents) {
      hasher.number(event.midi);
      hasher.text(event.type);
      hasher.number(event.confidence);
      hasher.number(event.eventTimeMs);
    }
    hasher.number(frame.activePitches.length);
    for (const pitch of frame.activePitches) {
      hasher.number(pitch.midi);
      hasher.number(pitch.confidence);
    }
    hasher.number(frame.confidenceEvidence.length);
    for (const evidence of frame.confidenceEvidence) {
      hasher.number(evidence.midi);
      hasher.number(evidence.confidence);
    }
  }
  return hasher.digest;
}

/**
 * Everything a continuous run must reproduce: per-event classifications,
 * advancement timestamps and latencies, physical attack attribution, and the
 * summary counters that carry the safety gates.
 */
export function listenSequenceRunSignature(run: ListenSequenceRunResult): {
  sequenceId: string;
  intervalMs: number;
  policy: string;
  events: ListenSequenceRunResult["events"];
  attacks: ListenSequenceRunResult["attacks"];
  summary: ListenSequenceRunResult["summary"];
} {
  return {
    sequenceId: run.sequenceId,
    intervalMs: run.intervalMs,
    policy: run.policy,
    events: run.events,
    attacks: run.attacks,
    summary: run.summary,
  };
}

/** Rendered-audio and recognition identity of a retained trace. */
export interface ListenTraceSignature {
  sequenceId: string;
  frameCount: number;
  pcmLength: number;
  recognitionHash: string;
  audioSignature: ListenBenchmarkAudioSignature | null;
}

export function listenTraceSignature(trace: ListenRecognitionTrace): ListenTraceSignature {
  return {
    sequenceId: trace.sequenceId,
    frameCount: trace.frames.length,
    pcmLength: trace.pcm.length,
    recognitionHash: listenRecognitionTraceHash(trace),
    audioSignature: trace.audioSignature ?? null,
  };
}

/** PCM and recognition identity recorded alongside a measured run. */
export interface ListenTraceIdentity {
  pcmHash: string;
  recognitionHash: string;
  frameCount: number;
}

export function listenTraceIdentity(trace: ListenRecognitionTrace): ListenTraceIdentity {
  return {
    pcmHash: trace.audioSignature?.pcmHash ?? "unsigned",
    recognitionHash: listenRecognitionTraceHash(trace),
    frameCount: trace.frames.length,
  };
}

/**
 * Requires that the audio a trace recognized is exactly the audio that was
 * rendered for it, chunk hash for chunk hash. This runs in every capture path so
 * a waveform that changes between rendering and recognition cannot reach a
 * measured result.
 */
export function assertRenderedTraceAudioIdentity(
  label: string,
  trace: ListenRecognitionTrace,
  renderedSignature: ListenBenchmarkAudioSignature,
): void {
  const difference = firstStructuralDifference(renderedSignature, trace.audioSignature ?? null);
  if (difference !== null) {
    throw new Error(`Rendered and recognized PCM differ for ${label} at ${difference}.`);
  }
}

/**
 * Requires that a baseline replay reproduced a captured continuous run exactly.
 * A failure means the harness changed, so any candidate comparison built on it
 * would be measuring the wrong thing.
 */
export function assertListenSequenceRunParity(
  label: string,
  captured: ListenSequenceRunResult,
  replayed: ListenSequenceRunResult,
): void {
  const difference = firstStructuralDifference(
    listenSequenceRunSignature(captured),
    listenSequenceRunSignature(replayed),
  );
  if (difference !== null) {
    throw new Error(
      `${LISTEN_BASELINE_PROFILE_ID} replay parity failed for ${label} at ${difference}.`,
    );
  }
}

/** Requires that two retained traces describe identical audio and recognition. */
export function assertListenTraceParity(
  label: string,
  captured: ListenRecognitionTrace,
  compared: ListenRecognitionTrace,
): void {
  const difference = firstStructuralDifference(
    listenTraceSignature(captured),
    listenTraceSignature(compared),
  );
  if (difference !== null) {
    throw new Error(`Recognition trace parity failed for ${label} at ${difference}.`);
  }
}

/**
 * Requires that replaying a retained trace left it untouched. Replay must be a
 * pure read of captured recognition; a matcher or diagnostic that wrote back
 * into the trace would make every later profile comparison depend on the order
 * the profiles were replayed in. The hash is only ever compared with itself
 * inside one capture, never across captures.
 */
export function assertRecognitionTraceUnmutated(
  label: string,
  trace: ListenRecognitionTrace,
  capturedHash: string,
): void {
  const currentHash = listenRecognitionTraceHash(trace);
  if (currentHash !== capturedHash) {
    throw new Error(
      `Replay mutated the recognition trace for ${label} (${capturedHash} became ${currentHash}).`,
    );
  }
}

/** The isolated single-trial fields a baseline replay must reproduce. */
export interface IsolatedListenTrialSignature {
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  recognizedOnsets: ReadonlyArray<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetAfterAttackMs: number;
  }>;
}

export function assertIsolatedListenTrialParity(
  label: string,
  captured: IsolatedListenTrialSignature,
  replayed: IsolatedListenTrialSignature,
): void {
  const signature = ({ advanced, onsetToAdvanceMs, recognizedOnsets }: IsolatedListenTrialSignature) => ({
    advanced,
    onsetToAdvanceMs,
    recognizedOnsets: recognizedOnsets.map(({ midi, confidence, noteConfidence, onsetAfterAttackMs }) => ({
      midi,
      confidence,
      noteConfidence,
      onsetAfterAttackMs,
    })),
  });
  const difference = firstStructuralDifference(signature(captured), signature(replayed));
  if (difference !== null) {
    throw new Error(
      `${LISTEN_BASELINE_PROFILE_ID} isolated replay parity failed for ${label} at ${difference}.`,
    );
  }
}

/**
 * Values measured for the canonical Splendid `mp` C-major smoke before the
 * profile registry and sweep extraction existed. They are written out here so a
 * refactor that changes both sides of a self-comparison still fails.
 */
export interface CanonicalIsolatedSmokeBaseline {
  rendererVersion: string;
  piano: "splendid";
  layer: "mp";
  targetPitches: readonly number[];
  advanced: true;
  onsetToAdvanceMs: number;
  pcmFrameCount: number;
  pcmDurationMs: number;
  /**
   * FNV-1a over the decoder's discrete output. Chrome's offline audio rendering
   * and ONNX Runtime both vary in their last bits between runs, so the raw
   * waveform and score hashes cannot be frozen; this structural hash can, and it
   * fails on any change to decoded states, events, or their timing.
   */
  recognitionStructureHash: string;
  peak: number;
  rms: number;
  traceFrameCount: number;
  recognizedOnsets: ReadonlyArray<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetAfterAttackMs: number;
  }>;
}

export const CANONICAL_ISOLATED_SMOKE_BASELINES: Readonly<
  Record<"bundled-piano-web-audio-v1" | "bundled-piano-tone-v2", CanonicalIsolatedSmokeBaseline>
> = Object.freeze({
  "bundled-piano-web-audio-v1": Object.freeze({
    rendererVersion: "bundled-piano-web-audio-v1",
    piano: "splendid",
    layer: "mp",
    targetPitches: Object.freeze([60, 64, 67]),
    advanced: true,
    onsetToAdvanceMs: 196,
    pcmFrameCount: 17_920,
    pcmDurationMs: 1_120,
    recognitionStructureHash: "83fbd243",
    peak: 0.6031675934791565,
    rms: 0.10090749459121913,
    traceFrameCount: 35,
    recognizedOnsets: Object.freeze([
      { midi: 60, confidence: 0.9997449083128223, noteConfidence: 0.9997782808792826, onsetAfterAttackMs: 164 },
      { midi: 64, confidence: 0.9991270894238188, noteConfidence: 0.9991913887351841, onsetAfterAttackMs: 164 },
      { midi: 67, confidence: 0.9978696248658396, noteConfidence: 0.9978744470587045, onsetAfterAttackMs: 164 },
    ]),
  }),
  "bundled-piano-tone-v2": Object.freeze({
    rendererVersion: "bundled-piano-tone-v2",
    piano: "splendid",
    layer: "mp",
    targetPitches: Object.freeze([60, 64, 67]),
    advanced: true,
    onsetToAdvanceMs: 196,
    pcmFrameCount: 17_920,
    pcmDurationMs: 1_120,
    recognitionStructureHash: "5c164339",
    peak: 0.4324992597103119,
    rms: 0.07803548413864943,
    traceFrameCount: 35,
    recognizedOnsets: Object.freeze([
      { midi: 60, confidence: 0.9995549325874468, noteConfidence: 0.9995587041843035, onsetAfterAttackMs: 164 },
      { midi: 64, confidence: 0.9989724809322692, noteConfidence: 0.9989826120717014, onsetAfterAttackMs: 164 },
      { midi: 67, confidence: 0.9973087086937016, noteConfidence: 0.9973115853929135, onsetAfterAttackMs: 164 },
    ]),
  }),
});

/** The measured smoke shape this module compares against its frozen constants. */
export interface CanonicalIsolatedSmokeResult {
  rendererVersion: string;
  piano: string;
  layer: string;
  targetPitches: readonly number[];
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  pcmFrameCount: number;
  pcmDurationMs: number;
  recognitionStructureHash: string;
  peak: number;
  rms: number;
  traceFrameCount: number;
  recognizedOnsets: ReadonlyArray<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetAfterAttackMs: number;
  }>;
}

/**
 * Compares one canonical smoke against its recorded constants. Sample counts,
 * advancement, onset timing, recognized pitches, and the decoded structure hash
 * must match exactly. Continuous values — renderer amplitudes and model
 * confidences — may land at most one representable Float32 step away, because
 * neither Chrome's offline rendering nor ONNX Runtime reproduces its last bits
 * between runs. The measured spread is a small fraction of one such step.
 */
export function canonicalIsolatedSmokeDifferences(
  result: CanonicalIsolatedSmokeResult,
): string[] {
  const baseline = CANONICAL_ISOLATED_SMOKE_BASELINES[
    result.rendererVersion as keyof typeof CANONICAL_ISOLATED_SMOKE_BASELINES
  ];
  if (!baseline) return [`unknown renderer ${result.rendererVersion}`];
  const differences: string[] = [];
  const exact = (field: string, expected: unknown, actual: unknown) => {
    if (!Object.is(expected, actual)) differences.push(`${field}: expected ${expected}, received ${actual}`);
  };
  /**
   * Continuous audio and model values. Every discrete quantity — decoded
   * structure, counts, advancement, and onset timing — is compared exactly.
   */
  const adjacentFloat32 = (field: string, expected: number, actual: number) => {
    if (!withinOneFloat32Ulp(actual, expected)) {
      differences.push(`${field}: expected ${expected}, received ${actual}`);
    }
  };
  exact("piano", baseline.piano, result.piano);
  exact("layer", baseline.layer, result.layer);
  exact("targetPitches", baseline.targetPitches.join(","), [...result.targetPitches].join(","));
  exact("advanced", baseline.advanced, result.advanced);
  exact("onsetToAdvanceMs", baseline.onsetToAdvanceMs, result.onsetToAdvanceMs);
  exact("pcmFrameCount", baseline.pcmFrameCount, result.pcmFrameCount);
  exact("pcmDurationMs", baseline.pcmDurationMs, result.pcmDurationMs);
  exact("traceFrameCount", baseline.traceFrameCount, result.traceFrameCount);
  exact(
    "recognitionStructureHash",
    baseline.recognitionStructureHash,
    result.recognitionStructureHash,
  );
  adjacentFloat32("peak", baseline.peak, result.peak);
  adjacentFloat32("rms", baseline.rms, result.rms);
  exact("recognizedOnsetCount", baseline.recognizedOnsets.length, result.recognizedOnsets.length);
  for (const [index, expected] of baseline.recognizedOnsets.entries()) {
    const actual = result.recognizedOnsets[index];
    if (!actual) continue;
    exact(`recognizedOnsets[${index}].midi`, expected.midi, actual.midi);
    exact(
      `recognizedOnsets[${index}].onsetAfterAttackMs`,
      expected.onsetAfterAttackMs,
      actual.onsetAfterAttackMs,
    );
    adjacentFloat32(`recognizedOnsets[${index}].confidence`, expected.confidence, actual.confidence);
    adjacentFloat32(
      `recognizedOnsets[${index}].noteConfidence`,
      expected.noteConfidence,
      actual.noteConfidence,
    );
  }
  return differences;
}

export function assertCanonicalIsolatedSmokeBaseline(result: CanonicalIsolatedSmokeResult): void {
  const differences = canonicalIsolatedSmokeDifferences(result);
  if (differences.length > 0) {
    throw new Error(
      `Canonical ${result.rendererVersion} smoke differs from its recorded baseline: ` +
      differences.join("; "),
    );
  }
}
