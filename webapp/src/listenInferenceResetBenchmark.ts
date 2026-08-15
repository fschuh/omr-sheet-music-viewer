import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  LISTEN_SEQUENCE_PRE_ROLL_MS,
  captureListenSequenceTrace,
  courseClearArticulationDefinitions,
  diagnoseListenArticulationRun,
  materializeListenSequence,
  renderListenSequenceAudio,
  replayListenSequenceTrace,
  type ExpectedPitchDiagnostic,
  type ListenRecognitionTrace,
  type ListenSequenceEventDiagnostic,
  type ListenSequenceRunResult,
  type ListenTraceResetPlan,
  type ListenTraceResetPoint,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
  type SequenceOutputDecoder,
  type ListenInferenceMode,
} from "./listenSequenceBenchmark";
import { OnlineAmtSession } from "./onlineAmtSession";
import {
  LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  LISTEN_BENCHMARK_RELEASE_MS,
  LISTEN_BENCHMARK_RENDERER,
  type ListenBenchmarkAudioDiagnostics,
  type ListenBenchmarkAudioRenderResult,
  type ListenBenchmarkAudioSignature,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import { ONLINE_AMT_CHUNK_SIZE, ONLINE_AMT_SAMPLE_RATE } from "./onlineAmtProtocol";

export const LISTEN_INFERENCE_RESET_WARMUP_MS = 220;
export const LISTEN_INFERENCE_RESET_SUBSTANTIAL_EVENT_COUNT = 3;

export interface ListenInferenceResetModeEventObservation {
  event: ListenSequenceEventDiagnostic;
  freshAttackCount: number;
  producedOnsetCount: number;
  producedReOnsetCount: number;
  modelStateAtAttack: number[];
  maximumModelState: number[];
  rawOutputHash: string;
  decoderOutputHash: string;
}

export interface ListenIsolatedEventResult {
  key: string;
  targetPitches: number[];
  scoreEventIndices: number[];
  sequence: MaterializedListenSequence;
  run: ListenSequenceRunResult;
}

export interface ListenInferenceResetPitchComparison {
  midi: number;
  isolated: ExpectedPitchDiagnostic;
  stateful: ExpectedPitchDiagnostic;
  eventReset: ExpectedPitchDiagnostic;
  maximumOnsetConfidenceDelta: number;
  maximumActiveConfidenceDelta: number;
  statefulModelStateAtAttack: number;
  eventResetModelStateAtAttack: number;
  modelStateDelta: number;
}

export type ListenInferenceResetEventClassification =
  | "passed-all"
  | "recovered-by-event-reset"
  | "lost-after-event-reset"
  | "continuous-failure-isolated-pass"
  | "continuous-pass-isolated-failure"
  | "stateful-only-isolated-failure"
  | "event-reset-only-isolated-failure"
  | "failed-all-modes"
  | "ordered-only-failure";

export interface ListenInferenceResetOutcomeFlags {
  isolatedPass: boolean;
  statefulPass: boolean;
  eventResetPass: boolean;
  statefulIndependentMatch: boolean;
  eventResetIndependentMatch: boolean;
  statefulOrderedAdvance: boolean;
  eventResetOrderedAdvance: boolean;
}

export interface ListenInferenceResetEventComparison {
  index: number;
  scheduledAttackTimeMs: number;
  targetPitches: number[];
  isolated: ListenInferenceResetModeEventObservation;
  stateful: ListenInferenceResetModeEventObservation;
  eventReset: ListenInferenceResetModeEventObservation;
  pitches: ListenInferenceResetPitchComparison[];
  classification: ListenInferenceResetEventClassification;
  isolatedPass: boolean;
  statefulPass: boolean;
  eventResetPass: boolean;
  rawEvidenceDelta: number;
  freshAttackDelta: number;
  independentMatchDelta: number;
  orderedAdvanceDelta: number;
  rawModelOutputChangedAfterReset: boolean;
  rawModelImprovedAfterReset: boolean;
  decoderEventsChangedAfterReset: boolean;
  decoderOnlyImprovement: boolean;
  statefulSustainBecameResetOnset: boolean;
  independentLatencyDeltaMs: number | null;
  orderedLatencyDeltaMs: number | null;
}

export interface ListenInferenceResetSafetyCounts {
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  total: number;
}

export interface ListenInferenceResetLatencyDeltas {
  p50IndependentMatchMs: number | null;
  p95IndependentMatchMs: number | null;
  p50OrderedAdvanceMs: number | null;
  p95OrderedAdvanceMs: number | null;
}

export interface ListenInferenceResetSummary {
  recoveredEventCount: number;
  lostEventCount: number;
  recoveredPitchCount: number;
  lostPitchCount: number;
  rawEvidenceDelta: number;
  freshAttackDelta: number;
  independentMatchDelta: number;
  orderedAdvanceDelta: number;
  rawEvidenceCounts: { stateful: number; eventReset: number };
  freshAttackCounts: { stateful: number; eventReset: number };
  independentMatchCounts: { stateful: number; eventReset: number };
  orderedAdvanceCounts: { stateful: number; eventReset: number };
  sustainToOnsetCount: number;
  rawModelImprovementCount: number;
  decoderOnlyImprovementCount: number;
  isolatedSuccessCount: number;
  statefulFailuresIsolatedRecognizedCount: number;
  eventResetFailuresIsolatedRecognizedCount: number;
  bothContinuousFailuresIsolatedPassCount: number;
  failedAllModeCount: number;
  statefulSafety: ListenInferenceResetSafetyCounts;
  eventResetSafety: ListenInferenceResetSafetyCounts;
  safetyDelta: number;
  safetyErrorsIncreased: boolean;
  latencyDeltas: ListenInferenceResetLatencyDeltas;
}

export type ListenInferenceResetConclusionCode =
  | "neural-recurrent-state"
  | "decoder-transition-history"
  | "recurrent-model-or-decoder-state"
  | "continuous-acoustic-context"
  | "base-model-recall"
  | "matcher-playhead-cascade"
  | "recurrent-context-beneficial"
  | "inconclusive-unsafe-reset"
  | "no-substantial-reset-effect";

export interface ListenInferenceResetConclusion {
  code: ListenInferenceResetConclusionCode;
  text: string;
  substantialThresholdCount: 3;
  recoveredEventCount: number;
  lostEventCount: number;
  safetyErrorsIncreased: boolean;
  rawModelStatesImproved: boolean;
  decoderTransitionHistoryImplicated: boolean;
}

export interface ListenInferenceResetBenchmarkResult {
  sequenceId: string;
  intervalMs: 1_000;
  renderer: ListenBenchmarkRendererConfiguration;
  audioDiagnostics: ListenBenchmarkAudioDiagnostics;
  audioSignature: ListenBenchmarkAudioSignature;
  resetPlan: ListenTraceResetPlan;
  stateful: ListenSequenceRunResult;
  eventReset: ListenSequenceRunResult;
  isolatedEvents: ListenIsolatedEventResult[];
  events: ListenInferenceResetEventComparison[];
  summary: ListenInferenceResetSummary;
  conclusion: ListenInferenceResetConclusion;
}

export interface CaptureListenInferenceResetBenchmarkOptions {
  session: SequenceInferenceSession;
  decoderFactory?: () => SequenceOutputDecoder;
  render?: (sequence: MaterializedListenSequence) => Promise<ListenBenchmarkAudioRenderResult>;
  onProgress?: (stage: string) => void;
}

function sortedPitches(pitches: readonly number[]): number[] {
  return [...new Set(pitches)].sort((left, right) => left - right);
}

function eventKey(pitches: readonly number[]): string {
  return sortedPitches(pitches).join(",");
}

function frameIndexAtOrAfter(timeMs: number): number {
  return Math.ceil(timeMs * ONLINE_AMT_SAMPLE_RATE / 1_000 / ONLINE_AMT_CHUNK_SIZE);
}

/** Builds the deterministic reset schedule without touching audio or inference. */
export function buildListenInferenceResetPlan(
  sequence: MaterializedListenSequence,
  mode: ListenInferenceMode,
): ListenTraceResetPlan {
  if (mode === "stateful") return { mode, points: [] };
  const points: ListenTraceResetPoint[] = [];
  for (let eventIndex = 1; eventIndex < sequence.targets.length; eventIndex += 1) {
    const scheduledAttackTimeMs = sequence.targets[eventIndex].scheduledAttackTimeMs;
    const requestedAtMs = scheduledAttackTimeMs - LISTEN_INFERENCE_RESET_WARMUP_MS;
    const frameIndex = frameIndexAtOrAfter(requestedAtMs);
    const actualFrameStartMs = frameIndex * ONLINE_AMT_CHUNK_SIZE * 1_000 /
      ONLINE_AMT_SAMPLE_RATE;
    points.push({
      frameIndex,
      eventIndex,
      requestedAtMs,
      actualFrameStartMs,
      scheduledAttackTimeMs,
      actualWarmupMs: scheduledAttackTimeMs - actualFrameStartMs,
    });
  }
  return { mode, points };
}

function oneEventDefinition(
  pitches: readonly number[],
  key: string,
  localAttackTimeMs: number,
) {
  return {
    id: `course-clear-isolated-${key || "empty"}`,
    family: "course-clear-isolated",
    label: `Course Clear isolated ${key}`,
    targets: [sortedPitches(pitches)],
    attacks: [{
      // Preserve the continuous event's position inside its 512-sample chunk.
      // The initial zero state then sees the same number of complete silent
      // frames and the same partial attack frame as the event-reset pass.
      at: (localAttackTimeMs - LISTEN_SEQUENCE_PRE_ROLL_MS) /
        COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
      targetIndex: 0,
      notes: sortedPitches(pitches),
      expectedAdvance: true,
    }],
  };
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hashNumbers(values: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const bytes = new Uint8Array(new Float64Array([value]).buffer);
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function traceWindow(
  trace: ListenRecognitionTrace,
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): ListenRecognitionTrace["frames"] {
  const start = scheduledAttackTimeMs - 32;
  const end = nextAttackTimeMs ?? Infinity;
  return trace.frames.filter(({ capturedAtMs }) => capturedAtMs >= start && capturedAtMs < end);
}

function modelStateValues(
  trace: ListenRecognitionTrace,
  pitches: readonly number[],
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): { atAttack: number[]; maximum: number[] } {
  const frames = traceWindow(trace, scheduledAttackTimeMs, nextAttackTimeMs);
  return {
    atAttack: pitches.map((midi) => {
      const frame = frames.find(({ capturedAtMs }) => capturedAtMs >= scheduledAttackTimeMs);
      return frame?.modelStates[midi - 21] ?? 0;
    }),
    maximum: pitches.map((midi) => Math.max(
      0,
      ...frames.map((frame) => frame.modelStates[midi - 21] ?? 0),
    )),
  };
}

function rawOutputHash(
  trace: ListenRecognitionTrace,
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): string {
  return hashNumbers(traceWindow(trace, scheduledAttackTimeMs, nextAttackTimeMs).flatMap((frame) => [
    ...frame.modelScores,
    ...frame.modelStates,
    Number(frame.signalActive),
  ]));
}

function decoderOutputHash(
  trace: ListenRecognitionTrace,
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): string {
  return hashNumbers(traceWindow(trace, scheduledAttackTimeMs, nextAttackTimeMs).flatMap((frame) => [
    ...frame.onsets.flatMap(({ midi, confidence, noteConfidence }) => [midi, confidence, noteConfidence]),
    ...frame.noteEvents.flatMap(({ midi, confidence }) => [midi, confidence]),
  ]));
}

function changedFrameOutput(
  left: ListenRecognitionTrace,
  right: ListenRecognitionTrace,
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): boolean {
  const leftFrames = traceWindow(left, scheduledAttackTimeMs, nextAttackTimeMs);
  const rightFrames = traceWindow(right, scheduledAttackTimeMs, nextAttackTimeMs);
  if (leftFrames.length !== rightFrames.length) return true;
  return leftFrames.some((frame, index) => (
    !sameNumberArray(frame.modelScores, rightFrames[index].modelScores) ||
    !sameNumberArray(frame.modelStates, rightFrames[index].modelStates) ||
    frame.signalActive !== rightFrames[index].signalActive
  ));
}

function changedDecoderOutput(
  left: ListenRecognitionTrace,
  right: ListenRecognitionTrace,
  scheduledAttackTimeMs: number,
  nextAttackTimeMs: number | null,
): boolean {
  const leftFrames = traceWindow(left, scheduledAttackTimeMs, nextAttackTimeMs);
  const rightFrames = traceWindow(right, scheduledAttackTimeMs, nextAttackTimeMs);
  return JSON.stringify(leftFrames.map(({ onsets, noteEvents }) => ({ onsets, noteEvents }))) !==
    JSON.stringify(rightFrames.map(({ onsets, noteEvents }) => ({ onsets, noteEvents })));
}

function observation(
  run: ListenSequenceRunResult,
  articulation: ReturnType<typeof diagnoseListenArticulationRun>,
  eventIndex: number,
  sequence: MaterializedListenSequence,
): ListenInferenceResetModeEventObservation {
  const event = run.events[eventIndex];
  const nextAttackTimeMs = sequence.targets[eventIndex + 1]?.scheduledAttackTimeMs ?? null;
  const state = modelStateValues(
    run.trace,
    event.targetPitches,
    event.scheduledAttackTimeMs,
    nextAttackTimeMs,
  );
  return {
    event,
    freshAttackCount: articulation.events[eventIndex].producedFreshAttackCount,
    producedOnsetCount: articulation.events[eventIndex].producedOnsetCount,
    producedReOnsetCount: articulation.events[eventIndex].producedReOnsetCount,
    modelStateAtAttack: state.atAttack,
    maximumModelState: state.maximum,
    rawOutputHash: rawOutputHash(run.trace, event.scheduledAttackTimeMs, nextAttackTimeMs),
    decoderOutputHash: decoderOutputHash(run.trace, event.scheduledAttackTimeMs, nextAttackTimeMs),
  };
}

function continuousPass(event: ListenSequenceEventDiagnostic): boolean {
  return event.independentlyMatched && event.orderedAdvanced;
}

export function classifyListenInferenceResetOutcome(
  flags: ListenInferenceResetOutcomeFlags,
): ListenInferenceResetEventClassification {
  const {
    isolatedPass,
    statefulPass,
    eventResetPass,
    statefulIndependentMatch,
    eventResetIndependentMatch,
    statefulOrderedAdvance,
    eventResetOrderedAdvance,
  } = flags;
  if (statefulIndependentMatch && eventResetIndependentMatch &&
      (!statefulOrderedAdvance || !eventResetOrderedAdvance)) {
    return "ordered-only-failure";
  }
  if (isolatedPass && statefulPass && eventResetPass) return "passed-all";
  if (!isolatedPass && statefulPass && eventResetPass) {
    return "continuous-pass-isolated-failure";
  }
  if (!statefulPass && eventResetPass && isolatedPass) return "recovered-by-event-reset";
  if (!statefulPass && eventResetPass && !isolatedPass) {
    return "event-reset-only-isolated-failure";
  }
  if (statefulPass && !eventResetPass && isolatedPass) return "lost-after-event-reset";
  if (statefulPass && !eventResetPass && !isolatedPass) {
    return "stateful-only-isolated-failure";
  }
  if (!statefulPass && !eventResetPass && isolatedPass) {
    return "continuous-failure-isolated-pass";
  }
  return "failed-all-modes";
}

function isolatedWarmupForEvent(
  sequence: MaterializedListenSequence,
  resetPlan: ListenTraceResetPlan,
  eventIndex: number,
): number {
  if (eventIndex === 0) {
    // Both continuous modes perform their one initial reset at frame zero.
    return sequence.targets[0].scheduledAttackTimeMs;
  }
  const point = resetPlan.points.find((candidate) => candidate.eventIndex === eventIndex);
  if (!point) throw new Error(`Event-reset plan has no point for event ${eventIndex}.`);
  return point.actualWarmupMs;
}

function classifyEvent(
  isolated: ListenInferenceResetModeEventObservation,
  stateful: ListenInferenceResetModeEventObservation,
  eventReset: ListenInferenceResetModeEventObservation,
): ListenInferenceResetEventClassification {
  return classifyListenInferenceResetOutcome({
    isolatedPass: continuousPass(isolated.event),
    statefulPass: continuousPass(stateful.event),
    eventResetPass: continuousPass(eventReset.event),
    statefulIndependentMatch: stateful.event.independentlyMatched,
    eventResetIndependentMatch: eventReset.event.independentlyMatched,
    statefulOrderedAdvance: stateful.event.orderedAdvanced,
    eventResetOrderedAdvance: eventReset.event.orderedAdvanced,
  });
}

function latencyDelta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : right - left;
}

function safetyCounts(run: ListenSequenceRunResult): ListenInferenceResetSafetyCounts {
  const { falseAdvanceCount, skippedAdvanceCount, duplicateAdvanceCount } = run.summary;
  return {
    falseAdvanceCount,
    skippedAdvanceCount,
    duplicateAdvanceCount,
    total: falseAdvanceCount + skippedAdvanceCount + duplicateAdvanceCount,
  };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentileValue) - 1)];
}

function compareLatency(
  stateful: ListenSequenceRunResult,
  eventReset: ListenSequenceRunResult,
): ListenInferenceResetLatencyDeltas {
  const delta = (field: "independentMatchLatencyMs" | "orderedAdvanceLatencyMs", percentileValue: number) => {
    const left = stateful.events
      .map((event) => event[field])
      .filter((value): value is number => value !== null);
    const right = eventReset.events
      .map((event) => event[field])
      .filter((value): value is number => value !== null);
    return latencyDelta(percentile(left, percentileValue), percentile(right, percentileValue));
  };
  return {
    p50IndependentMatchMs: delta("independentMatchLatencyMs", 0.5),
    p95IndependentMatchMs: delta("independentMatchLatencyMs", 0.95),
    p50OrderedAdvanceMs: delta("orderedAdvanceLatencyMs", 0.5),
    p95OrderedAdvanceMs: delta("orderedAdvanceLatencyMs", 0.95),
  };
}

function summarize(
  events: ListenInferenceResetEventComparison[],
  stateful: ListenSequenceRunResult,
  eventReset: ListenSequenceRunResult,
): ListenInferenceResetSummary {
  const statefulArticulation = diagnoseListenArticulationRun(
    "normal",
    materializeListenSequence(courseClearArticulationDefinitions().find(({ articulation }) => (
      articulation === "normal"
    ))!, COURSE_CLEAR_ARTICULATION_INTERVAL_MS),
    stateful,
  );
  const eventResetArticulation = diagnoseListenArticulationRun(
    "normal",
    materializeListenSequence(courseClearArticulationDefinitions().find(({ articulation }) => (
      articulation === "normal"
    ))!, COURSE_CLEAR_ARTICULATION_INTERVAL_MS),
    eventReset,
  );
  const recovered = events.filter(({ classification }) => classification === "recovered-by-event-reset");
  const lost = events.filter(({ classification }) => classification === "lost-after-event-reset");
  const recoveredPitchCount = events.reduce((total, comparison) => total + comparison.pitches.filter((pitch) => (
    !pitch.stateful.thresholdQualified && pitch.eventReset.thresholdQualified &&
    pitch.isolated.thresholdQualified
  )).length, 0);
  const lostPitchCount = events.reduce((total, comparison) => total + comparison.pitches.filter((pitch) => (
    pitch.stateful.thresholdQualified && !pitch.eventReset.thresholdQualified
  )).length, 0);
  const statefulSafety = safetyCounts(stateful);
  const eventResetSafety = safetyCounts(eventReset);
  return {
    recoveredEventCount: recovered.length,
    lostEventCount: lost.length,
    recoveredPitchCount,
    lostPitchCount,
    rawEvidenceDelta: eventReset.summary.rawCompleteEvidenceCount - stateful.summary.rawCompleteEvidenceCount,
    freshAttackDelta: eventResetArticulation.summary.producedFreshAttackCount -
      statefulArticulation.summary.producedFreshAttackCount,
    independentMatchDelta: eventReset.summary.independentMatchCount - stateful.summary.independentMatchCount,
    orderedAdvanceDelta: eventReset.summary.orderedAdvanceCount - stateful.summary.orderedAdvanceCount,
    rawEvidenceCounts: {
      stateful: stateful.summary.rawCompleteEvidenceCount,
      eventReset: eventReset.summary.rawCompleteEvidenceCount,
    },
    freshAttackCounts: {
      stateful: statefulArticulation.summary.producedFreshAttackCount,
      eventReset: eventResetArticulation.summary.producedFreshAttackCount,
    },
    independentMatchCounts: {
      stateful: stateful.summary.independentMatchCount,
      eventReset: eventReset.summary.independentMatchCount,
    },
    orderedAdvanceCounts: {
      stateful: stateful.summary.orderedAdvanceCount,
      eventReset: eventReset.summary.orderedAdvanceCount,
    },
    sustainToOnsetCount: events.filter(({ statefulSustainBecameResetOnset }) => (
      statefulSustainBecameResetOnset
    )).length,
    rawModelImprovementCount: events.filter(({ rawModelImprovedAfterReset }) => (
      rawModelImprovedAfterReset
    )).length,
    decoderOnlyImprovementCount: events.filter(({ decoderOnlyImprovement }) => (
      decoderOnlyImprovement
    )).length,
    isolatedSuccessCount: events.filter(({ isolatedPass }) => isolatedPass).length,
    statefulFailuresIsolatedRecognizedCount: events.filter(({ isolatedPass, statefulPass }) => (
      isolatedPass && !statefulPass
    )).length,
    eventResetFailuresIsolatedRecognizedCount: events.filter(({ isolatedPass, eventResetPass }) => (
      isolatedPass && !eventResetPass
    )).length,
    bothContinuousFailuresIsolatedPassCount: events.filter(({ isolatedPass, stateful, eventReset }) => (
      isolatedPass && !stateful.event.independentlyMatched && !eventReset.event.independentlyMatched
    )).length,
    failedAllModeCount: events.filter(({ classification }) => classification === "failed-all-modes").length,
    statefulSafety,
    eventResetSafety,
    safetyDelta: eventResetSafety.total - statefulSafety.total,
    safetyErrorsIncreased: eventResetSafety.total > statefulSafety.total,
    latencyDeltas: compareLatency(stateful, eventReset),
  };
}

export function interpretListenInferenceResetSummary(
  summary: ListenInferenceResetSummary,
): ListenInferenceResetConclusion {
  const threshold = LISTEN_INFERENCE_RESET_SUBSTANTIAL_EVENT_COUNT;
  const rawModelStatesImproved = summary.rawModelImprovementCount >= threshold;
  const decoderTransitionHistoryImplicated = summary.decoderOnlyImprovementCount >= threshold;
  let code: ListenInferenceResetConclusionCode;
  let text: string;
  if (summary.safetyErrorsIncreased) {
    code = "inconclusive-unsafe-reset";
    text = "Event-reset inference increased safety errors; the reset comparison is inconclusive/unsafe.";
  } else if (rawModelStatesImproved) {
    code = "neural-recurrent-state";
    text = "Reset improved raw model output on at least three events; neural recurrent state is implicated.";
  } else if (decoderTransitionHistoryImplicated) {
    code = "decoder-transition-history";
    text = "Raw model output stayed equivalent while decoder events improved on at least three events; decoder transition history is implicated.";
  } else if (summary.recoveredEventCount >= threshold) {
    code = "recurrent-model-or-decoder-state";
    text = "Event reset recovered at least three isolated successes; recurrent model or decoder state is carrying errors.";
  } else if (summary.bothContinuousFailuresIsolatedPassCount >= threshold) {
    code = "continuous-acoustic-context";
    text = "Both continuous modes failed where isolated inference succeeded on at least three events; continuous acoustic context or rendering interaction is implicated.";
  } else if (eventsFailedAll(summary) >= threshold) {
    code = "base-model-recall";
    text = "All three modes failed on at least three events; base-model recall is implicated.";
  } else if (Math.abs(summary.independentMatchDelta) <= 1 &&
             summary.orderedAdvanceCounts.stateful < summary.independentMatchCounts.stateful &&
             summary.orderedAdvanceCounts.eventReset < summary.independentMatchCounts.eventReset) {
    code = "matcher-playhead-cascade";
    text = "Independent results were unchanged while ordered advancement remained poor; matcher/playhead cascade is implicated.";
  } else if (summary.lostEventCount >= threshold) {
    code = "recurrent-context-beneficial";
    text = "Reset lost at least three events; recurrent context is beneficial for this passage.";
  } else {
    code = "no-substantial-reset-effect";
    text = "The reset comparison did not meet the predefined substantial threshold.";
  }
  return {
    code,
    text,
    substantialThresholdCount: threshold,
    recoveredEventCount: summary.recoveredEventCount,
    lostEventCount: summary.lostEventCount,
    safetyErrorsIncreased: summary.safetyErrorsIncreased,
    rawModelStatesImproved,
    decoderTransitionHistoryImplicated,
  };
}

function eventsFailedAll(summary: ListenInferenceResetSummary): number {
  return summary.failedAllModeCount;
}

function compareEvents(
  sequence: MaterializedListenSequence,
  isolatedEvents: ListenIsolatedEventResult[],
  stateful: ListenSequenceRunResult,
  eventReset: ListenSequenceRunResult,
): ListenInferenceResetEventComparison[] {
  const isolatedByIndex = new Map<number, ListenIsolatedEventResult>();
  for (const isolated of isolatedEvents) {
    for (const index of isolated.scoreEventIndices) isolatedByIndex.set(index, isolated);
  }
  const statefulArticulation = diagnoseListenArticulationRun("normal", sequence, stateful);
  const eventResetArticulation = diagnoseListenArticulationRun("normal", sequence, eventReset);
  return sequence.targets.map((target, index) => {
    const isolatedRun = isolatedByIndex.get(index)!.run;
    const isolatedSequence = isolatedByIndex.get(index)!.sequence;
    const isolatedArticulation = diagnoseListenArticulationRun("normal", isolatedSequence, isolatedRun);
    const isolatedObservation = observation(isolatedRun, isolatedArticulation, 0, isolatedSequence);
    const statefulObservation = observation(stateful, statefulArticulation, index, sequence);
    const eventResetObservation = observation(eventReset, eventResetArticulation, index, sequence);
    const pitches = target.pitches.map((midi) => {
      const isolatedPitch = isolatedObservation.event.expectedPitches.find((pitch) => pitch.midi === midi)!;
      const statefulPitch = statefulObservation.event.expectedPitches.find((pitch) => pitch.midi === midi)!;
      const eventResetPitch = eventResetObservation.event.expectedPitches.find((pitch) => pitch.midi === midi)!;
      const statefulState = statefulObservation.modelStateAtAttack[target.pitches.indexOf(midi)] ?? 0;
      const eventResetState = eventResetObservation.modelStateAtAttack[target.pitches.indexOf(midi)] ?? 0;
      return {
        midi,
        isolated: isolatedPitch,
        stateful: statefulPitch,
        eventReset: eventResetPitch,
        maximumOnsetConfidenceDelta: eventResetPitch.maximumOnsetConfidence -
          statefulPitch.maximumOnsetConfidence,
        maximumActiveConfidenceDelta: eventResetPitch.maximumActiveConfidence -
          statefulPitch.maximumActiveConfidence,
        statefulModelStateAtAttack: statefulState,
        eventResetModelStateAtAttack: eventResetState,
        modelStateDelta: eventResetState - statefulState,
      };
    });
    const statefulSustain = statefulArticulation.events[index].repeatedPitchesInSustain;
    const nextAttackTimeMs = sequence.targets[index + 1]?.scheduledAttackTimeMs ?? null;
    const resetOnsetPitches = traceWindow(
      eventReset.trace,
      target.scheduledAttackTimeMs,
      nextAttackTimeMs,
    ).flatMap(({ noteEvents }) => noteEvents
      .filter(({ type }) => type === "onset")
      .map(({ midi }) => midi));
    const rawModelOutputChangedAfterReset = changedFrameOutput(
      stateful.trace,
      eventReset.trace,
      target.scheduledAttackTimeMs,
      nextAttackTimeMs,
    );
    const decoderEventsChangedAfterReset = changedDecoderOutput(
      stateful.trace,
      eventReset.trace,
      target.scheduledAttackTimeMs,
      nextAttackTimeMs,
    );
    const rawEvidenceDelta = Number(eventResetObservation.event.allRequiredRawEvidencePresent) -
      Number(statefulObservation.event.allRequiredRawEvidencePresent);
    const freshAttackDelta = eventResetObservation.freshAttackCount - statefulObservation.freshAttackCount;
    const independentMatchDelta = Number(eventResetObservation.event.independentlyMatched) -
      Number(statefulObservation.event.independentlyMatched);
    const orderedAdvanceDelta = Number(eventResetObservation.event.orderedAdvanced) -
      Number(statefulObservation.event.orderedAdvanced);
    // Treat a raw-model improvement as a recovery of required evidence or
    // qualification on an event that the stateful pass did not recover. Mere
    // floating-point score movement during a reset is recorded in `pitches`,
    // but is not enough to implicate the neural state in the conclusion.
    const rawModelImprovedAfterReset = !statefulObservation.event.allRequiredRawEvidencePresent &&
      eventResetObservation.event.allRequiredRawEvidencePresent || pitches.some((pitch) => (
        !pitch.stateful.thresholdQualified && pitch.eventReset.thresholdQualified
      ));
    const decoderOnlyImprovement = !rawModelOutputChangedAfterReset &&
      (independentMatchDelta > 0 || orderedAdvanceDelta > 0);
    return {
      index,
      scheduledAttackTimeMs: target.scheduledAttackTimeMs,
      targetPitches: [...target.pitches],
      isolated: isolatedObservation,
      stateful: statefulObservation,
      eventReset: eventResetObservation,
      pitches,
      classification: classifyEvent(isolatedObservation, statefulObservation, eventResetObservation),
      isolatedPass: continuousPass(isolatedObservation.event),
      statefulPass: continuousPass(statefulObservation.event),
      eventResetPass: continuousPass(eventResetObservation.event),
      rawEvidenceDelta,
      freshAttackDelta,
      independentMatchDelta,
      orderedAdvanceDelta,
      rawModelOutputChangedAfterReset,
      rawModelImprovedAfterReset,
      decoderEventsChangedAfterReset,
      decoderOnlyImprovement,
      statefulSustainBecameResetOnset: statefulSustain.some((midi) => resetOnsetPitches.includes(midi)),
      independentLatencyDeltaMs: latencyDelta(
        statefulObservation.event.independentMatchLatencyMs,
        eventResetObservation.event.independentMatchLatencyMs,
      ),
      orderedLatencyDeltaMs: latencyDelta(
        statefulObservation.event.orderedAdvanceLatencyMs,
        eventResetObservation.event.orderedAdvanceLatencyMs,
      ),
    };
  });
}

function sameSignature(
  left: ListenBenchmarkAudioSignature,
  right: ListenBenchmarkAudioSignature,
): boolean {
  return left.sampleRate === right.sampleRate &&
    left.chunkSize === right.chunkSize &&
    left.frameCount === right.frameCount &&
    left.pcmByteLength === right.pcmByteLength &&
    left.pcmHash === right.pcmHash &&
    left.chunkHashes.length === right.chunkHashes.length &&
    left.chunkHashes.every((hash, index) => hash === right.chunkHashes[index]);
}

function emptySignatureFrom(trace: ListenRecognitionTrace): ListenBenchmarkAudioSignature {
  if (!trace.audioSignature) throw new Error("Listen trace did not record an audio signature.");
  return trace.audioSignature;
}

export async function captureListenInferenceResetBenchmark(
  options: CaptureListenInferenceResetBenchmarkOptions,
): Promise<ListenInferenceResetBenchmarkResult> {
  const definition = courseClearArticulationDefinitions().find(({ articulation }) => (
    articulation === "normal"
  ));
  if (!definition) throw new Error("The normal Course Clear articulation definition is missing.");
  const sequence = materializeListenSequence(definition, COURSE_CLEAR_ARTICULATION_INTERVAL_MS);
  const render = options.render ?? renderListenSequenceAudio;
  options.onProgress?.("Rendering canonical normal-articulation Course Clear once…");
  const rendered = await render(sequence);
  const resetPlan = buildListenInferenceResetPlan(sequence, "event-reset");
  options.onProgress?.("Capturing stateful continuous inference…");
  const statefulTrace = await captureListenSequenceTrace({
    sequenceId: definition.id,
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    audio: rendered.pcm,
    relevantPitches: sequence.relevantPitches,
    session: options.session,
    decoder: options.decoderFactory?.(),
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
    resetPlan: { mode: "stateful", points: [] },
  });
  options.onProgress?.("Capturing event-reset continuous inference…");
  const eventResetTrace = await captureListenSequenceTrace({
    sequenceId: definition.id,
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    audio: rendered.pcm,
    relevantPitches: sequence.relevantPitches,
    session: options.session,
    decoder: options.decoderFactory?.(),
    renderer: rendered.renderer,
    audioDiagnostics: rendered.diagnostics,
    resetPlan,
  });
  const statefulSignature = emptySignatureFrom(statefulTrace);
  const eventResetSignature = emptySignatureFrom(eventResetTrace);
  if (!sameSignature(statefulSignature, eventResetSignature)) {
    throw new Error("Stateful and event-reset inference did not receive byte-identical PCM chunks.");
  }
  if (JSON.stringify(statefulTrace.frames.map(({ capturedAtMs }) => capturedAtMs)) !==
      JSON.stringify(eventResetTrace.frames.map(({ capturedAtMs }) => capturedAtMs))) {
    throw new Error("Stateful and event-reset capture timestamps differ.");
  }
  if (JSON.stringify(statefulTrace.renderer) !== JSON.stringify(eventResetTrace.renderer) ||
      JSON.stringify(statefulTrace.audioDiagnostics) !==
        JSON.stringify(eventResetTrace.audioDiagnostics)) {
    throw new Error("Stateful and event-reset renderer diagnostics differ.");
  }
  const stateful = replayListenSequenceTrace(
    sequence,
    statefulTrace,
    "current-matcher",
  );
  const eventReset = replayListenSequenceTrace(
    sequence,
    eventResetTrace,
    "current-matcher",
  );

  options.onProgress?.("Capturing frame-phase-matched isolated Course Clear controls…");
  const isolatedByKey = new Map<string, ListenIsolatedEventResult>();
  for (let index = 0; index < sequence.targets.length; index += 1) {
    const targetPitches = sortedPitches(sequence.targets[index].pitches);
    const isolatedWarmupMs = isolatedWarmupForEvent(sequence, resetPlan, index);
    const key = `${eventKey(targetPitches)}@${isolatedWarmupMs}ms`;
    const existing = isolatedByKey.get(key);
    if (existing) {
      existing.scoreEventIndices.push(index);
      continue;
    }
    const isolatedSequence = materializeListenSequence(
      oneEventDefinition(targetPitches, key, isolatedWarmupMs),
      COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    );
    const isolatedRendered = await render(isolatedSequence);
    const isolatedTrace = await captureListenSequenceTrace({
      sequenceId: isolatedSequence.definition.id,
      intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
      audio: isolatedRendered.pcm,
      relevantPitches: isolatedSequence.relevantPitches,
      session: options.session,
      decoder: options.decoderFactory?.(),
      renderer: isolatedRendered.renderer,
      audioDiagnostics: isolatedRendered.diagnostics,
      resetPlan: { mode: "stateful", points: [] },
    });
    const isolatedRun = replayListenSequenceTrace(isolatedSequence, isolatedTrace, "current-matcher");
    isolatedByKey.set(key, {
      key,
      targetPitches,
      scoreEventIndices: [index],
      sequence: isolatedSequence,
      run: isolatedRun,
    });
  }
  const isolatedEvents = [...isolatedByKey.values()];
  const events = compareEvents(sequence, isolatedEvents, stateful, eventReset);
  const summary = summarize(events, stateful, eventReset);
  return {
    sequenceId: definition.id,
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    renderer: { ...rendered.renderer },
    audioDiagnostics: { ...statefulTrace.audioDiagnostics },
    audioSignature: statefulSignature,
    resetPlan,
    stateful,
    eventReset,
    isolatedEvents,
    events,
    summary,
    conclusion: interpretListenInferenceResetSummary(summary),
  };
}

export async function runListenInferenceResetBenchmark(
  onProgress: (stage: string) => void = () => undefined,
  renderer: ListenBenchmarkRendererConfiguration = LISTEN_BENCHMARK_RENDERER,
): Promise<ListenInferenceResetBenchmarkResult> {
  const pendingSession = OnlineAmtSession.create({
    modelUrl: new URL("models/online_amt_streaming.onnx", document.baseURI).href,
    numThreads: 1,
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true,
    executionMode: "sequential",
  });
  let session: OnlineAmtSession | null = null;
  try {
    session = await pendingSession;
    return await captureListenInferenceResetBenchmark({
      session,
      onProgress,
      render: (sequence) => renderListenSequenceAudio(sequence, renderer),
    });
  } finally {
    if (session) await session.dispose();
    else await pendingSession.then((created) => created.dispose()).catch(() => undefined);
  }
}

// Keep the canonical constants visible in serialized benchmark results and make
// an accidental renderer change fail the diagnostic setup immediately.
export const LISTEN_INFERENCE_RESET_RENDER_CONFIGURATION = {
  ...LISTEN_BENCHMARK_RENDERER,
  defaultHoldMs: LISTEN_BENCHMARK_DEFAULT_HOLD_MS,
  releaseMs: LISTEN_BENCHMARK_RELEASE_MS,
};
