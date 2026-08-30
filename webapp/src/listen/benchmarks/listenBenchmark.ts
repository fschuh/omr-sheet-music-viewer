import {
  ExactChordMatcher,
  defaultChordMatcherOptions,
  type ChordMatcherObserver,
} from "../../chordMatcher";
import { ONLINE_AMT_CHUNK_SIZE } from "../../onlineAmtProtocol";
import { OnlineAmtSession } from "../../onlineAmtSession";
import {
  findListenMatcherProfile,
  isListenMatcherProfileId,
  isListenMatcherThresholds,
  listenMatcherThresholds,
  matcherOptionsForListenMatcherProfile,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "../listenMatcherProfiles";
import {
  LISTEN_BASELINE_PROFILE_ID,
  assertIsolatedListenTrialParity,
  assertRecognitionTraceUnmutated,
  assertRenderedTraceAudioIdentity,
  listenRecognitionTraceHash,
  type IsolatedListenTrialSignature,
} from "./listenBaselineParity";
import { SpectralPitchDetector } from "../../spectralPitchDetector";
import type { RecognizedOnset, RecognizerResult } from "../../noteRecognizer";
import {
  LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  LISTEN_BENCHMARK_RELEASE_MS,
  LISTEN_BENCHMARK_RENDERER,
  type ListenBenchmarkAudioDiagnostics,
  type ListenBenchmarkAudioRenderResult,
  type ListenBenchmarkPianoConfiguration,
  type ListenBenchmarkRendererConfiguration,
  renderBenchmarkAudio,
  signatureForBenchmarkPcm,
} from "./listenBenchmarkAudio";
import {
  COURSE_CLEAR_BENCHMARK_MOMENTS,
  type ScoreBenchmarkMoment,
} from "./listenBenchmarkFixtures";
import {
  captureListenSequenceTrace,
  type ListenRecognitionTrace,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import type { PianoId, PianoLayerId } from "../../pianoRegistry";

export { COURSE_CLEAR_BENCHMARK_MOMENTS, type ScoreBenchmarkMoment };

const FFT_SIZE = 16_384;
const MAX_AFTER_ONSET_MS = 900;

/**
 * Silence before the single attack. Replay reports every latency relative to it,
 * exactly as the live path reports latency relative to the moment the target was
 * shown, so an isolated latency and a production latency mean the same thing.
 */
export const ISOLATED_LISTEN_BENCHMARK_PRE_ROLL_MS = 220;
const PRE_ROLL_MS = ISOLATED_LISTEN_BENCHMARK_PRE_ROLL_MS;
export const ISOLATED_LISTEN_BENCHMARK_DURATION_MS = PRE_ROLL_MS + MAX_AFTER_ONSET_MS;

/**
 * The matcher one set of isolated trials ran under.
 *
 * Every measured summary names it, so a historical result can never be reread as
 * if it had been produced by whichever profile production happens to default to
 * later. The spectral path predates the profile registry and still runs the
 * chord matcher's own defaults, so it names those values rather than borrowing a
 * registry identifier it never used.
 */
export type ListenBenchmarkMatcherId = ListenMatcherProfileId | "chord-matcher-defaults";

export interface ListenBenchmarkMatcherIdentity {
  profileId: ListenBenchmarkMatcherId;
  thresholds: ListenMatcherThresholds;
}

/** The registry entry a run names, with the exact values it was measured at. */
export function listenBenchmarkMatcherIdentity(
  profileId: ListenMatcherProfileId,
): ListenBenchmarkMatcherIdentity {
  const profile = findListenMatcherProfile(profileId);
  if (!profile) {
    throw new Error(`Unknown listen matcher profile identifier: ${String(profileId)}`);
  }
  return Object.freeze({ profileId, thresholds: listenMatcherThresholds(profile) });
}

/**
 * The legacy spectral isolated path's matcher, recorded rather than renamed. Its
 * measured results predate the registry and must not be relabelled as a profile
 * result they were never produced by.
 */
export const SPECTRAL_ISOLATED_MATCHER_IDENTITY: ListenBenchmarkMatcherIdentity = Object.freeze({
  profileId: "chord-matcher-defaults",
  thresholds: Object.freeze({
    onsetThreshold: defaultChordMatcherOptions.onsetThreshold,
    targetNoteThreshold: defaultChordMatcherOptions.targetNoteThreshold,
    activeTargetThreshold: defaultChordMatcherOptions.activeTargetThreshold,
    extraNoteThreshold: defaultChordMatcherOptions.noteThreshold,
    requireFreshBassOnset: defaultChordMatcherOptions.requireFreshBassOnset,
  }),
});

function assertListenBenchmarkMatcherIdentity(
  matcher: ListenBenchmarkMatcherIdentity,
): ListenBenchmarkMatcherIdentity {
  const named = matcher.profileId === "chord-matcher-defaults" ||
    isListenMatcherProfileId(matcher.profileId);
  if (!named || !isListenMatcherThresholds(matcher.thresholds)) {
    throw new Error(`Invalid listen benchmark matcher identity: ${JSON.stringify(matcher)}`);
  }
  return matcher;
}

export interface ListenBenchmarkTrial {
  source: "bundled" | "acoustic" | "digital";
  fixtureGroup?: "general" | "course-clear";
  measure?: number;
  moment?: number;
  mathematicallyAmbiguous?: boolean;
  targetPitches: number[];
  playedPitches: number[];
  expectedCorrect: boolean;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  analysisMs: number;
  renderer?: ListenBenchmarkRendererConfiguration;
  audioDiagnostics?: ListenBenchmarkAudioDiagnostics;
  trace?: ListenRecognitionTrace;
  piano?: ListenBenchmarkPianoConfiguration;
  recognizedOnsets?: Array<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    fundamentalProminenceDb?: number;
    fundamentalRelativeDb?: number;
    independentEvidenceRelativeDb?: number;
    onsetAfterAttackMs: number;
  }>;
}

export interface ListenBenchmarkSummary {
  renderer: ListenBenchmarkRendererConfiguration;
  /** The named matcher every trial in this summary was evaluated under. */
  matcher: ListenBenchmarkMatcherIdentity;
  trials: ListenBenchmarkTrial[];
  correctTrialCount: number;
  successRate: number;
  falseAdvanceCount: number;
  ambiguousAdvanceCount: number;
  p95OnsetToAdvanceMs: number | null;
  courseClear: {
    correctTrialCount: number;
    successRate: number | null;
    passed: boolean;
  };
  acceptance: {
    latency: boolean;
    successRate: boolean;
    courseClearSuccessRate: boolean;
    falseAdvances: boolean;
    passed: boolean;
  };
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

export function summarizeListenBenchmark(
  trials: ListenBenchmarkTrial[],
  matcher: ListenBenchmarkMatcherIdentity = listenBenchmarkMatcherIdentity(
    LISTEN_BASELINE_PROFILE_ID,
  ),
): ListenBenchmarkSummary {
  assertListenBenchmarkMatcherIdentity(matcher);
  const correct = trials.filter((trial) => trial.expectedCorrect);
  const successRate = correct.length === 0
    ? 0
    : correct.filter((trial) => trial.advanced).length / correct.length;
  const falseAdvanceCount = trials.filter((trial) => (
    !trial.expectedCorrect && !trial.mathematicallyAmbiguous && trial.advanced
  )).length;
  const ambiguousAdvanceCount = trials.filter((trial) => (
    !trial.expectedCorrect && trial.mathematicallyAmbiguous && trial.advanced
  )).length;
  const p95OnsetToAdvanceMs = percentile95(
    correct.flatMap((trial) => trial.advanced && trial.onsetToAdvanceMs !== null
      ? [trial.onsetToAdvanceMs]
      : []),
  );
  const courseClearCorrect = correct.filter((trial) => trial.fixtureGroup === "course-clear");
  const courseClearSuccessRate = courseClearCorrect.length === 0
    ? null
    : courseClearCorrect.filter((trial) => trial.advanced).length / courseClearCorrect.length;
  const courseClear = {
    correctTrialCount: courseClearCorrect.length,
    successRate: courseClearSuccessRate,
    passed: courseClearSuccessRate === null || courseClearSuccessRate >= 0.95,
  };
  const acceptance = {
    latency: p95OnsetToAdvanceMs !== null && p95OnsetToAdvanceMs < 400,
    successRate: successRate >= 0.95,
    courseClearSuccessRate: courseClear.passed,
    falseAdvances: falseAdvanceCount === 0,
    passed: false,
  };
  acceptance.passed = acceptance.latency && acceptance.successRate &&
    acceptance.courseClearSuccessRate && acceptance.falseAdvances;
  return {
    renderer: { ...(trials.find(({ renderer }) => renderer)?.renderer ?? LISTEN_BENCHMARK_RENDERER) },
    matcher,
    trials,
    correctTrialCount: correct.length,
    successRate,
    falseAdvanceCount,
    ambiguousAdvanceCount,
    p95OnsetToAdvanceMs,
    courseClear,
    acceptance,
  };
}

/** Represents an isolated fixture as the canonical one-event sequence. */
export function renderIsolatedListenBenchmarkAudio(
  playedPitches: readonly number[],
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
  selection: { piano?: PianoId; layer?: PianoLayerId } = {},
): Promise<ListenBenchmarkAudioRenderResult> {
  return renderBenchmarkAudio({
    attacks: [{
      onsetMs: PRE_ROLL_MS,
      notes: playedPitches,
      holdMs: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
      releaseMs: LISTEN_BENCHMARK_RELEASE_MS,
    }],
    durationMs: ISOLATED_LISTEN_BENCHMARK_DURATION_MS,
    sampleRate: 16_000,
    chunkSize: ONLINE_AMT_CHUNK_SIZE,
    renderer,
    ...selection,
  });
}

function samePitches(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pitch, index) => pitch === right[index]);
}

function isIntegerHarmonic(upperMidi: number, lowerMidi: number): boolean {
  if (upperMidi <= lowerMidi) return false;
  const ratio = 2 ** ((upperMidi - lowerMidi) / 12);
  const harmonic = Math.round(ratio);
  return harmonic >= 2 && harmonic <= 6 && Math.abs(ratio - harmonic) < 0.035;
}

export function isMathematicallyAmbiguousCase(
  targetPitches: readonly number[],
  playedPitches: readonly number[],
): boolean {
  const target = new Set(targetPitches);
  const played = new Set(playedPitches);
  const targetOnly = targetPitches.filter((pitch) => !played.has(pitch));
  const playedOnly = playedPitches.filter((pitch) => !target.has(pitch));
  const differences = targetOnly.length + playedOnly.length;
  return differences > 0 &&
    targetOnly.every((pitch) => playedPitches.some((lower) => isIntegerHarmonic(pitch, lower))) &&
    playedOnly.every((pitch) => targetPitches.some((lower) => isIntegerHarmonic(pitch, lower)));
}

class SpectralBenchmarkClient {
  private readonly audioContext = new AudioContext({ latencyHint: "interactive" });

  /** Named for the record only: this path constructs the chord matcher's defaults. */
  readonly matcher = SPECTRAL_ISOLATED_MATCHER_IDENTITY;

  constructor(private readonly renderer: ListenBenchmarkRendererConfiguration) {}

  async evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation> {
    await this.audioContext.resume();
    const rendered = await renderIsolatedListenBenchmarkAudio(playedPitches, this.renderer);

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -15;
    const silence = this.audioContext.createGain();
    silence.gain.value = 0;
    analyser.connect(silence).connect(this.audioContext.destination);
    const detector = new SpectralPitchDetector({
      sampleRate: this.audioContext.sampleRate,
      fftSize: analyser.fftSize,
    });
    detector.setTarget(targetPitches);
    const matcher = new ExactChordMatcher();
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const source = this.audioContext.createBufferSource();
    const buffer = this.audioContext.createBuffer(1, rendered.pcm.length, 16_000);
    buffer.copyToChannel(new Float32Array(rendered.pcm), 0);
    source.buffer = buffer;
    source.connect(analyser);
    const startsInMs = 10;
    const scheduledAtMs = performance.now() + startsInMs;
    const onsetAtMs = scheduledAtMs + PRE_ROLL_MS;
    matcher.setTarget(targetPitches, generation, scheduledAtMs);
    source.start(this.audioContext.currentTime + startsInMs / 1_000);

    const recognized = new Map<number, RecognizedOnset & {
      fundamentalProminenceDb?: number;
      fundamentalRelativeDb?: number;
      independentEvidenceRelativeDb?: number;
    }>();
    let maximumAnalysisMs = 0;
    try {
      return await new Promise((resolve) => {
        let frame = 0;
        const finish = (advanced: boolean, capturedAtMs: number) => {
          cancelAnimationFrame(frame);
          resolve({
            advanced,
            onsetToAdvanceMs: advanced ? Math.max(0, capturedAtMs - onsetAtMs) : null,
            analysisMs: maximumAnalysisMs,
            renderer: rendered.renderer,
            audioDiagnostics: rendered.diagnostics,
            recognizedOnsets: Array.from(recognized.values())
              .sort((left, right) => left.midi - right.midi)
              .map(({
                midi,
                confidence,
                noteConfidence,
                fundamentalProminenceDb,
                fundamentalRelativeDb,
                independentEvidenceRelativeDb,
                onsetTimeMs,
              }) => ({
                midi,
                confidence,
                noteConfidence,
                fundamentalProminenceDb,
                fundamentalRelativeDb,
                independentEvidenceRelativeDb,
                onsetAfterAttackMs: onsetTimeMs - onsetAtMs,
              })),
          });
        };
        const analyze = () => {
          const startedAt = performance.now();
          analyser.getFloatFrequencyData(spectrum);
          const capturedAtMs = performance.now();
          const detection = detector.process(spectrum, capturedAtMs);
          maximumAnalysisMs = Math.max(maximumAnalysisMs, performance.now() - startedAt);
          for (const onset of detection.onsets) {
            const diagnosticOnset = {
              ...onset,
              fundamentalProminenceDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.fundamentalProminenceDb,
              fundamentalRelativeDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.fundamentalRelativeDb,
              independentEvidenceRelativeDb: detection.activePitches
                .find(({ midi }) => midi === onset.midi)?.independentEvidenceRelativeDb,
            };
            const previous = recognized.get(onset.midi);
            if (!previous || previous.confidence < onset.confidence) {
              recognized.set(onset.midi, diagnosticOnset);
            }
          }
          const result: RecognizerResult = {
            generation,
            onsets: detection.onsets,
            recognizedActivePitches: detection.activePitches,
            targetPitchEvidence: detection.activePitches.filter(
              ({ midi }) => targetPitches.includes(midi),
            ),
            capturedAtMs,
            processingTimeMs: maximumAnalysisMs,
          };
          if (matcher.consume(result).matched) {
            finish(true, capturedAtMs);
            return;
          }
          if (capturedAtMs - onsetAtMs >= MAX_AFTER_ONSET_MS) {
            finish(false, capturedAtMs);
            return;
          }
          frame = requestAnimationFrame(analyze);
        };
        frame = requestAnimationFrame(analyze);
      });
    } finally {
      try { source.stop(); } catch { /* The buffer may already have ended. */ }
      source.disconnect();
      analyser.disconnect();
      silence.disconnect();
    }
  }

  async dispose(): Promise<void> {
    await this.audioContext.close();
  }
}

class OnlineAmtBenchmarkClient {
  private readonly session = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });

  readonly matcher: ListenBenchmarkMatcherIdentity;

  constructor(
    private readonly renderer: ListenBenchmarkRendererConfiguration,
    private readonly profileId: ListenMatcherProfileId,
  ) {
    this.matcher = listenBenchmarkMatcherIdentity(profileId);
  }

  async evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation> {
    return captureIsolatedOnlineAmtBenchmark({
      generation,
      targetPitches,
      playedPitches,
      session: await this.session,
      renderer: this.renderer,
      profileId: this.profileId,
    });
  }

  async dispose(): Promise<void> {
    await (await this.session).dispose();
  }
}

type BundledBenchmarkEvaluation = Pick<
  ListenBenchmarkTrial,
  | "advanced"
  | "onsetToAdvanceMs"
  | "analysisMs"
  | "recognizedOnsets"
  | "renderer"
  | "audioDiagnostics"
  | "trace"
  | "piano"
>;

/**
 * Renders, recognizes, and matcher-replays one isolated fixture.
 *
 * The profile is named explicitly and defaults to the frozen `baseline-v1`
 * entry rather than to whichever profile production currently points at, so a
 * later default change cannot silently redefine what a historical isolated
 * result means. The retained trace is returned with the evaluation, so a
 * candidate matrix can replay the identical decoded recognition without
 * rerendering audio or rerunning inference.
 */
export async function captureIsolatedOnlineAmtBenchmark(options: {
  generation: number;
  targetPitches: readonly number[];
  playedPitches: readonly number[];
  session: SequenceInferenceSession;
  renderer?: ListenBenchmarkRendererConfiguration;
  piano?: PianoId;
  layer?: PianoLayerId;
  profileId?: ListenMatcherProfileId;
}): Promise<BundledBenchmarkEvaluation> {
  const profileId: ListenMatcherProfileId = options.profileId ?? LISTEN_BASELINE_PROFILE_ID;
  const matcher = listenBenchmarkMatcherIdentity(profileId);
  const rendered = await renderIsolatedListenBenchmarkAudio(
    options.playedPitches,
    options.renderer,
    { piano: options.piano, layer: options.layer },
  );
  const relevantPitches = [...new Set([
    ...options.targetPitches,
    ...options.playedPitches,
  ])].sort((left, right) => left - right);
  const label = `isolated ${options.playedPitches.join("+")} on ${rendered.renderer.version} ` +
    `under ${profileId}`;
  const renderedSignature = signatureForBenchmarkPcm(rendered.pcm);
  const trace = await captureListenSequenceTrace({
    sequenceId: "isolated-one-event",
    intervalMs: 0,
    audio: rendered.pcm,
    relevantPitches,
    session: options.session,
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
  });
  assertRenderedTraceAudioIdentity(label, trace, renderedSignature);
  const capturedRecognitionHash = listenRecognitionTraceHash(trace);
  const evaluation = replayIsolatedListenTrace({
    trace,
    targetPitches: options.targetPitches,
    generation: options.generation,
    profile: profileId,
  });
  assertRecognitionTraceUnmutated(`${label} named-profile replay`, trace, capturedRecognitionHash);
  /**
   * Replaying the retained trace a second time from the profile's bare threshold
   * values must reproduce the first result exactly. That proves both that replay
   * is a pure read of captured recognition and that naming a registry entry means
   * the same thing as passing the values it is frozen at.
   */
  const repeatedEvaluation = replayIsolatedListenTrace({
    trace,
    targetPitches: options.targetPitches,
    generation: options.generation,
    profile: matcher.thresholds,
  });
  assertRecognitionTraceUnmutated(`${label} repeat replay`, trace, capturedRecognitionHash);
  assertIsolatedListenTrialParity(label, evaluation, repeatedEvaluation);
  return {
    advanced: evaluation.advanced,
    onsetToAdvanceMs: evaluation.onsetToAdvanceMs,
    recognizedOnsets: [...evaluation.recognizedOnsets],
    analysisMs: trace.maximumInferenceMs,
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
    trace,
    piano: rendered.piano,
  };
}

/**
 * Replays one retained isolated trace through the matcher. Keeping this separate
 * from capture lets a trial be re-evaluated under another profile without
 * rerendering audio or rerunning inference.
 */
export function replayIsolatedListenTrace(options: {
  trace: ListenRecognitionTrace;
  targetPitches: readonly number[];
  generation?: number;
  profile?: ListenMatcherThresholds | ListenMatcherProfileId;
  /**
   * Read-only sink for the matcher's own gate decisions. A diagnosis reads the
   * qualification path from the matcher instead of recomputing it; passing an
   * observer cannot change what the replay produces.
   */
  matcherObserver?: ChordMatcherObserver;
}): IsolatedListenTrialSignature {
  const generation = options.generation ?? 1;
  const matcher = new ExactChordMatcher(
    matcherOptionsForListenMatcherProfile(options.profile),
    options.matcherObserver,
  );
  matcher.setTarget(options.targetPitches, generation, 0);
  const recognized = new Map<number, {
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetAfterAttackMs: number;
  }>();
  let matchedAtMs: number | null = null;
  for (const frame of options.trace.frames) {
    for (const onset of frame.onsets) {
      if (!recognized.has(onset.midi)) {
        recognized.set(onset.midi, {
          midi: onset.midi,
          confidence: onset.confidence,
          noteConfidence: onset.noteConfidence,
          onsetAfterAttackMs: frame.capturedAtMs - PRE_ROLL_MS,
        });
      }
    }
    if (matchedAtMs === null && matcher.consume({
      generation,
      onsets: frame.onsets,
      noteEvents: frame.noteEvents,
      recognizedActivePitches: frame.activePitches,
      targetPitchEvidence: frame.confidenceEvidence,
      capturedAtMs: frame.capturedAtMs,
      processingTimeMs: frame.inferenceDurationMs,
    }).matched) {
      matchedAtMs = frame.capturedAtMs;
    }
  }
  return {
    advanced: matchedAtMs !== null,
    onsetToAdvanceMs: matchedAtMs === null ? null : Math.max(0, matchedAtMs - PRE_ROLL_MS),
    recognizedOnsets: Array.from(recognized.values()),
  };
}

interface BundledBenchmarkClient {
  readonly matcher: ListenBenchmarkMatcherIdentity;
  evaluate(
    generation: number,
    targetPitches: readonly number[],
    playedPitches: readonly number[],
  ): Promise<BundledBenchmarkEvaluation>;
  dispose(): Promise<void>;
}

/**
 * The isolated fixture corpus, in the fixed order the benchmark runs it. The
 * trace manifest names each case by its position here, so cases are appended
 * rather than reordered.
 */
export function bundledListenBenchmarkCases(): Array<{
  target: readonly number[];
  played: readonly number[];
  fixtureGroup?: ListenBenchmarkTrial["fixtureGroup"];
  measure?: number;
  moment?: number;
}> {
  const correct = [
    [48],
    [55],
    [60],
    [64],
    [67],
    [48, 60],
    [52, 60],
    [55, 64],
    [48, 60, 67],
    [60, 64, 67],
    [48, 55, 60, 64],
    [48, 55, 60, 64, 67],
    [40, 52, 59, 64, 67, 72],
  ];
  return [
    ...correct.flatMap((pitches) => Array.from({ length: 4 }, () => ({
      target: pitches,
      played: pitches,
      fixtureGroup: "general" as const,
    }))),
    ...COURSE_CLEAR_BENCHMARK_MOMENTS.flatMap((scoreMoment) => (
      Array.from({ length: 2 }, () => ({
        target: scoreMoment.pitches,
        played: scoreMoment.pitches,
        fixtureGroup: "course-clear" as const,
        measure: scoreMoment.measure,
        moment: scoreMoment.moment,
      }))
    )),
    { target: [60], played: [61] },
    { target: [60], played: [60, 72] },
    { target: [60, 64], played: [60, 65] },
    { target: [60, 64, 67], played: [60, 64, 67, 72] },
    { target: [48, 55, 60], played: [48, 55] },
    { target: [55], played: [55, 67] },
    { target: [55], played: [55, 74] },
    { target: [67], played: [67, 86] },
    { target: [48, 60, 67], played: [48, 60] },
    { target: [48, 60, 67], played: [48, 67] },
    ...COURSE_CLEAR_BENCHMARK_MOMENTS
      .filter((scoreMoment) => scoreMoment.pitches.length >= 3)
      .map((scoreMoment) => ({
        target: scoreMoment.pitches,
        played: scoreMoment.pitches.slice(1),
        fixtureGroup: "course-clear" as const,
        measure: scoreMoment.measure,
        moment: scoreMoment.moment,
      })),
  ];
}

async function runBundledBenchmark(
  client: BundledBenchmarkClient,
  onProgress: (completed: number, total: number) => void = () => undefined,
): Promise<ListenBenchmarkSummary> {
  const matcher = assertListenBenchmarkMatcherIdentity(client.matcher);
  const cases = bundledListenBenchmarkCases();
  const trials: ListenBenchmarkTrial[] = [];
  try {
    for (let index = 0; index < cases.length; index += 1) {
      const benchmarkCase = cases[index];
      const played = [...benchmarkCase.played].sort((left, right) => left - right);
      const target = [...benchmarkCase.target].sort((left, right) => left - right);
      const evaluation = await client.evaluate(index + 1, target, played);
      trials.push({
        source: "bundled",
        fixtureGroup: benchmarkCase.fixtureGroup,
        measure: benchmarkCase.measure,
        moment: benchmarkCase.moment,
        mathematicallyAmbiguous: isMathematicallyAmbiguousCase(target, played),
        targetPitches: target,
        playedPitches: played,
        expectedCorrect: samePitches(target, played),
        ...evaluation,
      });
      onProgress(index + 1, cases.length);
    }
    return summarizeListenBenchmark(trials, matcher);
  } finally {
    await client.dispose();
  }
}

export function runBundledListenBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<ListenBenchmarkSummary> {
  return runBundledBenchmark(new SpectralBenchmarkClient(renderer), onProgress);
}

/**
 * The historical single-profile isolated corpus. Its profile is named rather
 * than inherited: the recorded 104/106 and 100/106 results belong to
 * `baseline-v1`, whatever production later defaults to.
 */
export function runBundledOnlineAmtBenchmark(
  onProgress: (completed: number, total: number) => void = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
  profileId: ListenMatcherProfileId = LISTEN_BASELINE_PROFILE_ID,
): Promise<ListenBenchmarkSummary> {
  return runBundledBenchmark(new OnlineAmtBenchmarkClient(renderer, profileId), onProgress);
}
