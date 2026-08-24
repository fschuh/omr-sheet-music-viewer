/**
 * Frozen-candidate validation of the named matcher profiles.
 *
 * The multi-domain search in `listenMatcherSweepBenchmark.ts` chose the
 * candidate profiles from the `discovery` partition of `listenTraceManifest.ts`.
 * This module never searches: it replays `baseline-v1` and exactly the frozen
 * candidate identifiers, and it reports each suite under the partition the
 * manifest assigned it, so a release decision can tell which numbers confirm a
 * candidate and which only describe it. It therefore neither imports the sweep
 * nor generates grid profiles.
 *
 * The first part covers the isolated suite — the complete correct, Course
 * Clear, distinguishable-wrong, ambiguous-harmonic, and omitted-bass corpus
 * under both renderers, which the manifest holds entirely in `confirmation`.
 * The second covers the continuous-sequence corpus, which both single-renderer
 * sweeps have already read and which is therefore reported as `discovery`. The
 * third covers the dynamics and articulation corpora, which the manifest splits:
 * one constant layer per piano, renderer, and loudness band, one mixed run per
 * renderer, and a few articulations tuned thresholds, while every other layer,
 * mixed run, and articulation stayed untouched. Those rows are therefore labeled
 * individually, and no aggregate that spans both partitions is ever presented as
 * confirmation.
 *
 * All three parts share one capture rule: each fixture, passage, or dynamics run
 * is rendered and recognized once, and every profile replays that one retained
 * decoded trace, so a candidate row can differ from the baseline row only
 * because of the matcher.
 */

import {
  LISTEN_BENCHMARK_PIANO,
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
  signatureForBenchmarkPcm,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import {
  LISTEN_BASELINE_PROFILE_ID,
  assertIsolatedListenTrialParity,
  assertListenSequenceRunParity,
  assertRecognitionTraceUnmutated,
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
  type IsolatedListenTrialSignature,
} from "./listenBaselineParity";
import {
  bundledListenBenchmarkCases,
  captureIsolatedOnlineAmtBenchmark,
  isMathematicallyAmbiguousCase,
  listenBenchmarkMatcherIdentity,
  replayIsolatedListenTrace,
  summarizeListenBenchmark,
  type ListenBenchmarkSummary,
  type ListenBenchmarkTrial,
} from "./listenBenchmark";
import { captureCourseClearDynamicsRun } from "./listenDynamicsBenchmark";
import {
  replayListenSafetyRegressions,
  type ListenSafetyRegressionSummary,
} from "./listenSafetyRegression";
import {
  PIANO_IDS,
  pianoDefinition,
  type PianoId,
  type PianoLayerId,
} from "./pianoRegistry";
import {
  LISTEN_MATCHER_REGISTRY_VERSION,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  findListenMatcherProfile,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  LISTEN_PROFILE_VALIDATION_POLICY,
  assertValidListenProfileValidationPolicy,
  assessListenMaterialLatencyReduction,
  assessListenMaterialRateGain,
  assessListenMaterialUnsafeEventReduction,
  assessListenPairedCorrectness,
  assessListenRecognitionTarget,
  unappliedRequiredListenGateCodes,
  type ListenMaterialImprovementAssessment,
  type ListenPairedCorrectnessAssessment,
  type ListenRecognitionTargetAssessment,
} from "./listenProfileValidationPolicy";
import {
  LISTEN_TRACE_MANIFEST,
  LISTEN_TRACE_MANIFEST_RECOGNITION_TARGET_COUNTS,
  assertValidListenTraceManifest,
  listenTraceCorpusHash,
  listenTraceManifestHash,
  listenTracesInSuite,
  type ListenDynamicBand,
  type ListenIsolatedCaseKind,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
  type ListenTracePartition,
  type ListenTraceRendererKey,
} from "./listenTraceManifest";
import {
  LISTEN_SEQUENCE_INTERVALS_MS,
  aggregateListenSequenceRuns,
  bundledListenSequences,
  captureListenSequenceRun,
  courseClearArticulationDefinitions,
  replayListenSequenceTrace,
  summarizeListenSequenceSafety,
  withOnlineAmtBenchmarkSession,
  type ExpectedPitchDiagnostic,
  type ListenRecognitionTrace,
  type ListenSequenceArticulation,
  type ListenSequenceAggregateSummary,
  type ListenSequenceAttackDiagnostic,
  type ListenSequenceDefinition,
  type ListenSequenceEventDiagnostic,
  type ListenSequenceFailureReason,
  type ListenSequenceRunResult,
  type ListenSequenceSafetySummary,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";

/** The reference row every candidate is compared against. */
export const LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID: ListenMatcherProfileId =
  LISTEN_BASELINE_PROFILE_ID;

/**
 * The process-local audio and trace hashes one measured row carries.
 *
 * Task 04 established that neither `OfflineAudioContext` PCM nor the raw
 * recognition hash reproduces bit for bit in a fresh browser process, so the
 * cross-process comparison is stated over decoded structure and discrete
 * outcomes instead. That left the unified export with no record of the raw
 * identities at all, and a Task 13 repetition is required to record them: within
 * one run they prove every profile column read one identical waveform and one
 * unmutated trace, and between runs a mismatch here beside matching structure is
 * the ordinary platform noise rather than a result. They are therefore required
 * to be present and well formed, and are excluded by name from the canonical
 * cross-process comparison.
 */
export interface ListenProfileProcessLocalHashes {
  /** FNV-1a over the rendered PCM bytes, from the capture-time signature. */
  processLocalPcmHash: string;
  /** FNV-1a over the complete decoded trace, confidences and raw scores included. */
  processLocalTraceHash: string;
}

const LISTEN_PROFILE_HASH_PATTERN = /^[0-9a-f]{8}$/;

/**
 * Reads one trace's process-local hashes, refusing a trace that cannot supply
 * them.
 *
 * The refusal is here rather than in a comment because an unsigned or
 * re-pointed trace would otherwise reach the archive carrying a placeholder,
 * and a placeholder that repeats across two runs looks exactly like a
 * diagnostic that agreed. The signature is recomputed from the retained PCM and
 * compared whole, hash for hash, so a trace whose waveform was replaced after it
 * was signed is refused instead of exported under the old hash — including a
 * replacement of exactly the same length, which no shape comparison would catch.
 */
export function listenProfileProcessLocalHashes(
  traceId: string,
  trace: ListenRecognitionTrace,
  recognitionHash: string,
): ListenProfileProcessLocalHashes {
  const signature = trace.audioSignature;
  if (!signature) {
    throw new Error(
      `${traceId} was captured without an audio signature, so its process-local PCM hash ` +
        `cannot be recorded.`,
    );
  }
  if (!LISTEN_PROFILE_HASH_PATTERN.test(signature.pcmHash)) {
    throw new Error(
      `${traceId} carries malformed PCM hash ${JSON.stringify(signature.pcmHash)}.`,
    );
  }
  if (!LISTEN_PROFILE_HASH_PATTERN.test(recognitionHash)) {
    throw new Error(
      `${traceId} carries malformed recognition hash ${JSON.stringify(recognitionHash)}.`,
    );
  }
  // The signature is recomputed rather than sanity-checked against the retained
  // PCM's shape. A length comparison passes for any waveform of the same length,
  // which would export the capture-time hash of audio the trace no longer holds
  // — precisely the substitution this guard exists to catch.
  const measured = signatureForBenchmarkPcm(trace.pcm, trace.sampleRate, trace.chunkSize);
  if (
    measured.pcmHash !== signature.pcmHash ||
    measured.sampleRate !== signature.sampleRate ||
    measured.chunkSize !== signature.chunkSize ||
    measured.frameCount !== signature.frameCount ||
    measured.pcmByteLength !== signature.pcmByteLength ||
    measured.chunkHashes.length !== signature.chunkHashes.length ||
    measured.chunkHashes.some((hash, index) => hash !== signature.chunkHashes[index])
  ) {
    throw new Error(
      `${traceId} retained PCM signing as ${measured.pcmHash} over ${measured.frameCount} ` +
        `samples but carries the signature ${signature.pcmHash} over ${signature.frameCount}, ` +
        `so its recorded PCM hash does not describe the trace being exported.`,
    );
  }
  return { processLocalPcmHash: signature.pcmHash, processLocalTraceHash: recognitionHash };
}

/**
 * Resolves the profile column order: the baseline first, then the frozen
 * candidate manifest in its ranked order.
 *
 * The candidate list is validated rather than trusted. An unknown identifier
 * would otherwise be silently measured as some other profile, a duplicate would
 * report the same profile twice as if two candidates agreed, and the baseline
 * appearing among the candidates would compare a row against itself.
 */
export function resolveListenValidationProfileIds(
  candidateProfileIds: readonly ListenMatcherProfileId[] = LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
): readonly ListenMatcherProfileId[] {
  if (candidateProfileIds.length === 0) {
    throw new Error("Profile validation needs at least one frozen candidate profile.");
  }
  for (const id of candidateProfileIds) {
    if (!findListenMatcherProfile(id)) {
      throw new Error(`Profile validation received the unknown profile identifier ${String(id)}.`);
    }
    if (id === LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID) {
      throw new Error(
        `${LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID} is the comparison baseline and cannot ` +
        "also be listed as a candidate.",
      );
    }
  }
  if (new Set(candidateProfileIds).size !== candidateProfileIds.length) {
    throw new Error("Profile validation received a duplicated candidate profile identifier.");
  }
  return Object.freeze([
    LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
    ...candidateProfileIds,
  ]);
}

/** Profile identity carried by every validation row. */
export interface ListenValidationProfileIdentity {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
}

export function listenValidationProfileIdentities(
  profileIds: readonly ListenMatcherProfileId[],
): ListenValidationProfileIdentity[] {
  return profileIds.map((profileId) => {
    const profile = findListenMatcherProfile(profileId);
    if (!profile) {
      throw new Error(`Profile validation received the unknown profile identifier ${String(profileId)}.`);
    }
    return { profileId, profile: listenMatcherThresholds(profile) };
  });
}

/**
 * One unsafe advancement, identified rather than counted.
 *
 * A profile that stops advancing one wrong target and starts advancing another
 * has not become safer, so the comparison below needs the target a failure
 * happened at and not only how many there were.
 */
export interface ListenUnsafeAdvanceIdentity {
  targetIndex: number;
  classification: "false-advance" | "skipped" | "duplicate";
}

export function listenUnsafeAdvanceIdentities(
  run: ListenSequenceRunResult,
): ListenUnsafeAdvanceIdentity[] {
  const identities: ListenUnsafeAdvanceIdentity[] = [];
  for (const event of run.events) {
    if (event.falseAdvance) {
      identities.push({ targetIndex: event.index, classification: "false-advance" });
    }
    if (event.skipped) identities.push({ targetIndex: event.index, classification: "skipped" });
    if (event.duplicate) identities.push({ targetIndex: event.index, classification: "duplicate" });
  }
  return identities;
}

/**
 * Every way one profile's replay of one trace is less safe than the baseline's.
 *
 * Two comparisons are made because either alone lets a real regression through.
 * Counts are compared per classification rather than in total, so a run that
 * turns a skipped advance into a false one is worse even though its total did
 * not move. Target indices are compared as well, so an unsafe advance that moved
 * to another target is not read as the same failure staying put.
 *
 * The rule is relative to the baseline rather than absolute because parts of
 * this corpus are diagnosed cases whose baseline replay reproduces a genuine
 * unsafe advance by design; the requirement there is that a candidate does not
 * worsen them. The dedicated safety families are held to zero separately.
 */
export function listenNewUnsafeAdvances(
  candidate: ListenSequenceRunResult,
  baseline: ListenSequenceRunResult,
): string[] {
  const reasons: string[] = [];
  const classifications = [
    ["false", (run: ListenSequenceRunResult) => run.summary.falseAdvanceCount],
    ["skipped", (run: ListenSequenceRunResult) => run.summary.skippedAdvanceCount],
    ["duplicate", (run: ListenSequenceRunResult) => run.summary.duplicateAdvanceCount],
  ] as const;
  for (const [label, count] of classifications) {
    const candidateCount = count(candidate);
    const baselineCount = count(baseline);
    if (candidateCount > baselineCount) {
      reasons.push(`${label} advances rose from ${baselineCount} to ${candidateCount}`);
    }
  }
  const baselineIdentities = new Set(listenUnsafeAdvanceIdentities(baseline)
    .map(({ classification, targetIndex }) => `${classification}@${targetIndex}`));
  for (const { classification, targetIndex } of listenUnsafeAdvanceIdentities(candidate)) {
    if (baselineIdentities.has(`${classification}@${targetIndex}`)) continue;
    reasons.push(`target ${targetIndex} is a new ${classification}`);
  }
  return reasons;
}

/** One profile column's safety, compared with the baseline column trace by trace. */
export interface ListenValidationTraceSafety {
  runCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  /** Reported beside safety, never as safety. */
  lateAdvanceCount: number;
  /** Rows unsafe under this profile that the baseline handled safely. */
  introducedUnsafeTraceIds: string[];
  /**
   * Rows the baseline already advanced unsafely that this profile made worse.
   * Kept apart from `introducedUnsafeTraceIds` because a row cannot become
   * unsafe twice, and an aggregate that only asks whether a row is unsafe would
   * report both states as unchanged.
   */
  worsenedUnsafeTraceIds: string[];
  /** Rows whose baseline unsafe advance this profile no longer produces. */
  clearedUnsafeTraceIds: string[];
  /** Why each named row is worse, so the verdict never has to be taken on trust. */
  reasons: Array<{ traceId: string; reasons: string[] }>;
  passed: boolean;
}

/**
 * Compares one profile column against the baseline column, one trace at a time.
 *
 * Every row is compared on its own. Summing a corpus first would let a profile
 * that cleared one trace's false advance and introduced another's report no
 * change at all.
 */
export function listenValidationTraceSafety(
  rows: ReadonlyArray<{
    traceId: string;
    candidate: ListenSequenceRunResult;
    baseline: ListenSequenceRunResult;
  }>,
): ListenValidationTraceSafety {
  const introducedUnsafeTraceIds: string[] = [];
  const worsenedUnsafeTraceIds: string[] = [];
  const clearedUnsafeTraceIds: string[] = [];
  const reasons: Array<{ traceId: string; reasons: string[] }> = [];
  for (const { traceId, candidate, baseline } of rows) {
    const candidateUnsafe = unsafeRun(candidate);
    const baselineUnsafe = unsafeRun(baseline);
    if (!candidateUnsafe && baselineUnsafe) clearedUnsafeTraceIds.push(traceId);
    const rowReasons = listenNewUnsafeAdvances(candidate, baseline);
    if (rowReasons.length === 0) continue;
    reasons.push({ traceId, reasons: rowReasons });
    if (baselineUnsafe) worsenedUnsafeTraceIds.push(traceId);
    else introducedUnsafeTraceIds.push(traceId);
  }
  const total = (select: (run: ListenSequenceRunResult) => number) => rows
    .reduce((sum, { candidate }) => sum + select(candidate), 0);
  return {
    runCount: rows.length,
    falseAdvanceCount: total((run) => run.summary.falseAdvanceCount),
    skippedAdvanceCount: total((run) => run.summary.skippedAdvanceCount),
    duplicateAdvanceCount: total((run) => run.summary.duplicateAdvanceCount),
    lateAdvanceCount: total((run) => run.summary.lateAdvanceCount),
    introducedUnsafeTraceIds: introducedUnsafeTraceIds.sort(),
    worsenedUnsafeTraceIds: worsenedUnsafeTraceIds.sort(),
    clearedUnsafeTraceIds: clearedUnsafeTraceIds.sort(),
    reasons,
    passed: introducedUnsafeTraceIds.length === 0 && worsenedUnsafeTraceIds.length === 0,
  };
}

/** One manifest isolated trace, joined to the fixture it renders. */
export interface ListenIsolatedValidationCase {
  descriptor: ListenTraceDescriptor;
  /** One-based position in the fixed isolated corpus, matching the manifest name. */
  caseIndex: number;
  renderer: ListenBenchmarkRendererConfiguration;
  targetPitches: number[];
  playedPitches: number[];
  expectedCorrect: boolean;
  mathematicallyAmbiguous: boolean;
  fixtureGroup: "general" | "course-clear";
  measure: number | null;
  moment: number | null;
}

/** One rendered, recognized isolated fixture, retained for the profile matrix. */
export interface ListenIsolatedValidationCapture {
  validationCase: ListenIsolatedValidationCase;
  trace: ListenRecognitionTrace;
  /** Exact trace hash at capture, re-checked after every profile has replayed it. */
  recognitionHash: string;
  /** Survives a fresh browser process, unlike the raw PCM and trace hashes. */
  recognitionStructureHash: string;
  /** The capture-time baseline replay this matrix's baseline row must reproduce. */
  baselineTrial: IsolatedListenTrialSignature;
}

export type ListenIsolatedValidationCaptureFn = (
  validationCase: ListenIsolatedValidationCase,
) => Promise<ListenIsolatedValidationCapture>;

/** One profile's outcome on one isolated fixture. */
export interface ListenIsolatedProfileOutcome {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
}

export interface ListenIsolatedValidationCaseResult {
  traceId: string;
  partition: ListenTracePartition;
  caseIndex: number;
  caseKind: ListenIsolatedCaseKind;
  fixtureGroup: "general" | "course-clear";
  measure: number | null;
  moment: number | null;
  targetPitches: number[];
  playedPitches: number[];
  expectedCorrect: boolean;
  mathematicallyAmbiguous: boolean;
  rendererKey: ListenTraceRendererKey;
  renderer: string;
  recognitionStructureHash: string;
  frameCount: number;
  pcmLength: number;
  /**
   * Recorded so the archive holds the raw identities, and excluded by name from
   * the cross-process comparison, which no fresh browser process reproduces.
   */
  processLocalPcmHash: string;
  processLocalTraceHash: string;
  maximumInferenceMs: number;
  /** Every profile's outcome, in the frozen column order, from this one trace. */
  profiles: ListenIsolatedProfileOutcome[];
}

/** Advancement counts for one case kind, which is the manifest's leaf domain. */
export interface ListenIsolatedCaseKindSummary {
  caseKind: ListenIsolatedCaseKind;
  trialCount: number;
  advancedCount: number;
}

export interface ListenIsolatedProfileDelta {
  correctAdvanceCount: number;
  courseClearAdvanceCount: number;
  distinguishableFalseAdvanceCount: number;
  ambiguousAdvanceCount: number;
  p95OnsetToAdvanceMs: number | null;
  /** Fixtures whose advancement differs from the baseline, named individually. */
  gainedCorrectTraceIds: string[];
  lostCorrectTraceIds: string[];
  gainedFalseTraceIds: string[];
  clearedFalseTraceIds: string[];
}

export interface ListenIsolatedProfileValidationSummary {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  /** The historical isolated summary, computed by the production gate function. */
  summary: ListenBenchmarkSummary;
  correctAdvanceCount: number;
  courseClearCorrectTrialCount: number;
  courseClearAdvanceCount: number;
  byCaseKind: ListenIsolatedCaseKindSummary[];
  /** Null for the baseline row itself. */
  deltaFromBaseline: ListenIsolatedProfileDelta | null;
}

export interface ListenIsolatedRendererValidation {
  rendererKey: ListenTraceRendererKey;
  renderer: ListenBenchmarkRendererConfiguration;
  caseCount: number;
  correctTrialCount: number;
  cases: ListenIsolatedValidationCaseResult[];
  profiles: ListenIsolatedProfileValidationSummary[];
}

export interface ListenIsolatedProfileValidationResult {
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    traceCount: number;
    isolatedTraceCount: number;
    capturedTraceCount: number;
  };
  /** The isolated suite is confirmation evidence in its entirety. */
  partitions: ListenTracePartition[];
  baselineProfileId: ListenMatcherProfileId;
  candidateProfileIds: readonly ListenMatcherProfileId[];
  profiles: ListenValidationProfileIdentity[];
  renderers: ListenIsolatedRendererValidation[];
  /** True when every profile column was replayed from one capture per fixture. */
  traceReuseVerified: boolean;
  /** True when every baseline row reproduced its capture-time replay exactly. */
  baselineParityVerified: boolean;
}

const RENDERER_BY_KEY: Readonly<Record<ListenTraceRendererKey, ListenBenchmarkRendererConfiguration>> =
  Object.freeze({
    direct: LISTEN_BENCHMARK_RENDERER,
    tone: LISTEN_BENCHMARK_TONE_RENDERER,
  });

/**
 * The renderer a manifest trace names, checked rather than assumed: a descriptor
 * that named a renderer this build does not provide would otherwise be measured
 * under whichever renderer its key happens to resolve to.
 */
function rendererForManifestTrace(
  descriptor: ListenTraceDescriptor,
): ListenBenchmarkRendererConfiguration {
  const renderer = RENDERER_BY_KEY[descriptor.rendererKey];
  if (!renderer || renderer.version !== descriptor.renderer) {
    throw new Error(
      `${descriptor.id} names renderer ${descriptor.renderer}, which no benchmark renderer provides.`,
    );
  }
  return renderer;
}

const ISOLATED_SOURCE_PREFIX = "isolated-case-";

/**
 * Joins the manifest's isolated descriptors to the fixture corpus they name.
 *
 * The manifest identifies a fixture by its position in
 * `bundledListenBenchmarkCases()`, so the join is checked rather than assumed: a
 * reordered corpus would otherwise silently validate different pitches than the
 * partition rules were frozen over.
 */
export function listenIsolatedValidationCases(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
): ListenIsolatedValidationCase[] {
  if (rendererKeys.length === 0) {
    throw new Error("Isolated profile validation needs at least one renderer.");
  }
  if (new Set(rendererKeys).size !== rendererKeys.length) {
    throw new Error("Isolated profile validation received a duplicated renderer key.");
  }
  for (const key of rendererKeys) {
    if (!RENDERER_BY_KEY[key]) {
      throw new Error(`Isolated profile validation received the unknown renderer key ${String(key)}.`);
    }
  }
  const cases = bundledListenBenchmarkCases();
  const selected = new Set(rendererKeys);
  return listenTracesInSuite("isolated", manifest)
    .filter((descriptor) => selected.has(descriptor.rendererKey))
    .map((descriptor) => {
      if (!descriptor.sourceId.startsWith(ISOLATED_SOURCE_PREFIX)) {
        throw new Error(`${descriptor.id} does not name an isolated fixture.`);
      }
      const caseIndex = Number(descriptor.sourceId.slice(ISOLATED_SOURCE_PREFIX.length));
      const benchmarkCase = cases[caseIndex - 1];
      if (!Number.isInteger(caseIndex) || !benchmarkCase) {
        throw new Error(`${descriptor.id} names the unknown isolated fixture ${descriptor.sourceId}.`);
      }
      const targetPitches = [...benchmarkCase.target].sort((left, right) => left - right);
      const playedPitches = [...benchmarkCase.played].sort((left, right) => left - right);
      return {
        descriptor,
        caseIndex,
        renderer: rendererForManifestTrace(descriptor),
        targetPitches,
        playedPitches,
        expectedCorrect: targetPitches.length === playedPitches.length &&
          targetPitches.every((pitch, index) => pitch === playedPitches[index]),
        mathematicallyAmbiguous: isMathematicallyAmbiguousCase(targetPitches, playedPitches),
        fixtureGroup: benchmarkCase.fixtureGroup ?? "general",
        measure: benchmarkCase.measure ?? null,
        moment: benchmarkCase.moment ?? null,
      };
    });
}

/**
 * Renders and recognizes one isolated fixture on the capture path the historical
 * isolated benchmark already uses, so a validation row cannot diverge from the
 * suite result it claims to describe.
 */
export async function captureListenIsolatedValidationTrace(
  validationCase: ListenIsolatedValidationCase,
  session: SequenceInferenceSession,
): Promise<ListenIsolatedValidationCapture> {
  const captured = await captureIsolatedOnlineAmtBenchmark({
    generation: validationCase.caseIndex,
    targetPitches: validationCase.targetPitches,
    playedPitches: validationCase.playedPitches,
    session,
    renderer: validationCase.renderer,
    profileId: LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
  });
  const trace = captured.trace;
  if (!trace) {
    throw new Error(`${validationCase.descriptor.id} was captured without a retained trace.`);
  }
  return {
    validationCase,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineTrial: {
      advanced: captured.advanced,
      onsetToAdvanceMs: captured.onsetToAdvanceMs,
      recognizedOnsets: captured.recognizedOnsets ?? [],
    },
  };
}

/**
 * Replays one retained isolated trace through every profile column.
 *
 * The trace object is read, never rebuilt, so the only thing that can differ
 * between columns is the matcher. The capture-time hash is re-checked afterwards
 * because a replay that wrote back into the trace would make each column depend
 * on the order the profiles happened to run in.
 */
export function replayListenIsolatedProfileMatrix(
  capture: ListenIsolatedValidationCapture,
  profiles: readonly ListenValidationProfileIdentity[],
): ListenIsolatedValidationCaseResult {
  if (profiles.length === 0) {
    throw new Error("An isolated profile matrix needs at least the baseline profile.");
  }
  if (new Set(profiles.map(({ profileId }) => profileId)).size !== profiles.length) {
    throw new Error("An isolated profile matrix cannot replay the same profile twice.");
  }
  if (profiles[0].profileId !== LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID) {
    throw new Error(
      `An isolated profile matrix must start from ${LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID}.`,
    );
  }
  const { validationCase, trace } = capture;
  const descriptor = validationCase.descriptor;
  if (descriptor.caseKind === null) {
    throw new Error(`${descriptor.id} has no isolated case kind.`);
  }
  const outcomes = profiles.map(({ profileId, profile }): ListenIsolatedProfileOutcome => {
    const replayed = replayIsolatedListenTrace({
      trace,
      targetPitches: validationCase.targetPitches,
      generation: validationCase.caseIndex,
      profile: profileId,
    });
    return {
      profileId,
      profile,
      advanced: replayed.advanced,
      onsetToAdvanceMs: replayed.onsetToAdvanceMs,
    };
  });
  assertRecognitionTraceUnmutated(
    `${descriptor.id} candidate-matrix replay`,
    trace,
    capture.recognitionHash,
  );
  return {
    traceId: descriptor.id,
    partition: descriptor.partition,
    caseIndex: validationCase.caseIndex,
    caseKind: descriptor.caseKind,
    fixtureGroup: validationCase.fixtureGroup,
    measure: validationCase.measure,
    moment: validationCase.moment,
    targetPitches: [...validationCase.targetPitches],
    playedPitches: [...validationCase.playedPitches],
    expectedCorrect: validationCase.expectedCorrect,
    mathematicallyAmbiguous: validationCase.mathematicallyAmbiguous,
    rendererKey: descriptor.rendererKey,
    renderer: trace.renderer.version,
    recognitionStructureHash: capture.recognitionStructureHash,
    frameCount: trace.frames.length,
    pcmLength: trace.pcm.length,
    ...listenProfileProcessLocalHashes(descriptor.id, trace, capture.recognitionHash),
    maximumInferenceMs: trace.maximumInferenceMs,
    profiles: outcomes,
  };
}

function outcomeFor(
  result: ListenIsolatedValidationCaseResult,
  profileId: ListenMatcherProfileId,
): ListenIsolatedProfileOutcome {
  const outcome = result.profiles.find((entry) => entry.profileId === profileId);
  if (!outcome) throw new Error(`${result.traceId} has no ${profileId} row.`);
  return outcome;
}

function trialsForProfile(
  cases: readonly ListenIsolatedValidationCaseResult[],
  profileId: ListenMatcherProfileId,
  renderer: ListenBenchmarkRendererConfiguration,
): ListenBenchmarkTrial[] {
  return cases.map((result): ListenBenchmarkTrial => {
    const outcome = outcomeFor(result, profileId);
    return {
      source: "bundled",
      fixtureGroup: result.fixtureGroup,
      ...(result.measure === null ? {} : { measure: result.measure }),
      ...(result.moment === null ? {} : { moment: result.moment }),
      mathematicallyAmbiguous: result.mathematicallyAmbiguous,
      targetPitches: [...result.targetPitches],
      playedPitches: [...result.playedPitches],
      expectedCorrect: result.expectedCorrect,
      advanced: outcome.advanced,
      onsetToAdvanceMs: outcome.onsetToAdvanceMs,
      analysisMs: result.maximumInferenceMs,
      renderer: { ...renderer },
    };
  });
}

function caseKindSummaries(
  cases: readonly ListenIsolatedValidationCaseResult[],
  profileId: ListenMatcherProfileId,
): ListenIsolatedCaseKindSummary[] {
  const kinds: ListenIsolatedCaseKind[] = [
    "correct",
    "distinguishable-wrong",
    "ambiguous-harmonic",
    "omitted-bass",
  ];
  return kinds.map((caseKind) => {
    const matching = cases.filter((result) => result.caseKind === caseKind);
    return {
      caseKind,
      trialCount: matching.length,
      advancedCount: matching.filter((result) => outcomeFor(result, profileId).advanced).length,
    };
  });
}

/**
 * Summarizes one renderer's isolated matrix.
 *
 * Every column is scored by `summarizeListenBenchmark`, the same function the
 * historical isolated command reports, so the baseline column of this matrix is
 * directly comparable with the recorded 104/106 and 100/106 results instead of
 * being a second, subtly different calculation of them.
 */
export function summarizeListenIsolatedProfileValidation(
  rendererKey: ListenTraceRendererKey,
  renderer: ListenBenchmarkRendererConfiguration,
  cases: readonly ListenIsolatedValidationCaseResult[],
  profiles: readonly ListenValidationProfileIdentity[],
): ListenIsolatedRendererValidation {
  const baselineId = LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID;
  if (profiles.length === 0 || profiles[0].profileId !== baselineId) {
    throw new Error(`An isolated validation summary must start from ${baselineId}.`);
  }
  const correctCases = cases.filter(({ expectedCorrect }) => expectedCorrect);
  const courseClearCorrect = correctCases
    .filter(({ fixtureGroup }) => fixtureGroup === "course-clear");
  const distinguishableCases = cases.filter((result) => (
    !result.expectedCorrect && !result.mathematicallyAmbiguous
  ));
  const advancedIds = (
    subset: readonly ListenIsolatedValidationCaseResult[],
    profileId: ListenMatcherProfileId,
  ) => new Set(subset
    .filter((result) => outcomeFor(result, profileId).advanced)
    .map(({ traceId }) => traceId));
  const columnFor = (identity: ListenValidationProfileIdentity) => {
    const summary = summarizeListenBenchmark(
      trialsForProfile(cases, identity.profileId, renderer),
      listenBenchmarkMatcherIdentity(identity.profileId),
    );
    return {
      identity,
      summary,
      correctAdvances: advancedIds(correctCases, identity.profileId),
      distinguishableAdvances: advancedIds(distinguishableCases, identity.profileId),
      courseClearAdvanceCount: courseClearCorrect
        .filter((result) => outcomeFor(result, identity.profileId).advanced).length,
    };
  };
  const columns = profiles.map(columnFor);
  const baseline = columns[0];
  const summaries = columns.map((column): ListenIsolatedProfileValidationSummary => ({
    profileId: column.identity.profileId,
    profile: column.identity.profile,
    summary: column.summary,
    correctAdvanceCount: column.correctAdvances.size,
    courseClearCorrectTrialCount: courseClearCorrect.length,
    courseClearAdvanceCount: column.courseClearAdvanceCount,
    byCaseKind: caseKindSummaries(cases, column.identity.profileId),
    deltaFromBaseline: column === baseline ? null : {
      correctAdvanceCount: column.correctAdvances.size - baseline.correctAdvances.size,
      courseClearAdvanceCount: column.courseClearAdvanceCount - baseline.courseClearAdvanceCount,
      distinguishableFalseAdvanceCount:
        column.distinguishableAdvances.size - baseline.distinguishableAdvances.size,
      ambiguousAdvanceCount:
        column.summary.ambiguousAdvanceCount - baseline.summary.ambiguousAdvanceCount,
      p95OnsetToAdvanceMs: column.summary.p95OnsetToAdvanceMs === null ||
        baseline.summary.p95OnsetToAdvanceMs === null
        ? null
        : column.summary.p95OnsetToAdvanceMs - baseline.summary.p95OnsetToAdvanceMs,
      gainedCorrectTraceIds: [...column.correctAdvances]
        .filter((id) => !baseline.correctAdvances.has(id)).sort(),
      lostCorrectTraceIds: [...baseline.correctAdvances]
        .filter((id) => !column.correctAdvances.has(id)).sort(),
      gainedFalseTraceIds: [...column.distinguishableAdvances]
        .filter((id) => !baseline.distinguishableAdvances.has(id)).sort(),
      clearedFalseTraceIds: [...baseline.distinguishableAdvances]
        .filter((id) => !column.distinguishableAdvances.has(id)).sort(),
    },
  }));
  return {
    rendererKey,
    renderer: { ...renderer },
    caseCount: cases.length,
    correctTrialCount: correctCases.length,
    cases: [...cases],
    profiles: summaries,
  };
}

/**
 * Captures the isolated confirmation corpus once and replays the frozen
 * candidate matrix against every retained trace.
 *
 * The capture function is injected so unit tests drive the identical join,
 * matrix, aggregation, and parity path over deterministic synthetic traces, and
 * so a test can prove that one capture serves every profile column.
 */
export async function evaluateListenIsolatedProfileValidation(options: {
  capture: ListenIsolatedValidationCaptureFn;
  manifest?: ListenTraceManifest;
  candidateProfileIds?: readonly ListenMatcherProfileId[];
  rendererKeys?: readonly ListenTraceRendererKey[];
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenIsolatedProfileValidationResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const onProgress = options.onProgress ?? (() => undefined);
  const profileIds = resolveListenValidationProfileIds(options.candidateProfileIds);
  const profiles = listenValidationProfileIdentities(profileIds);
  const rendererKeys = options.rendererKeys ?? ["direct", "tone"];
  const validationCases = listenIsolatedValidationCases(manifest, rendererKeys);
  if (validationCases.length === 0) {
    throw new Error("The manifest contains no isolated traces to validate.");
  }
  const resultsByRenderer = new Map<ListenTraceRendererKey, ListenIsolatedValidationCaseResult[]>();
  for (let index = 0; index < validationCases.length; index += 1) {
    const validationCase = validationCases[index];
    const descriptor = validationCase.descriptor;
    onProgress(index, validationCases.length, `Capturing ${descriptor.id}`);
    const capture = await options.capture(validationCase);
    // The row is filed under the requested fixture's identity, so a capture that
    // answered with different audio would be reported as this fixture.
    if (capture.validationCase.descriptor.id !== descriptor.id) {
      throw new Error(`Capturing ${descriptor.id} returned ${capture.validationCase.descriptor.id}.`);
    }
    if (capture.trace.renderer.version !== descriptor.renderer) {
      throw new Error(
        `${descriptor.id} expects renderer ${descriptor.renderer}, but its capture used ` +
        `${capture.trace.renderer.version}.`,
      );
    }
    const caseResult = replayListenIsolatedProfileMatrix(capture, profiles);
    // The baseline column must reproduce the capture-time replay exactly. A
    // difference there means the harness changed, so no candidate comparison
    // built on this trace would be measuring the profile.
    assertIsolatedListenTrialParity(descriptor.id, capture.baselineTrial, {
      advanced: outcomeFor(caseResult, LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID).advanced,
      onsetToAdvanceMs: outcomeFor(
        caseResult,
        LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
      ).onsetToAdvanceMs,
      recognizedOnsets: capture.baselineTrial.recognizedOnsets,
    });
    const existing = resultsByRenderer.get(descriptor.rendererKey);
    if (existing) existing.push(caseResult);
    else resultsByRenderer.set(descriptor.rendererKey, [caseResult]);
    onProgress(index + 1, validationCases.length, `Replayed ${descriptor.id}`);
  }
  const renderers = rendererKeys
    .filter((key) => resultsByRenderer.has(key))
    .map((key) => summarizeListenIsolatedProfileValidation(
      key,
      RENDERER_BY_KEY[key],
      resultsByRenderer.get(key) ?? [],
      profiles,
    ));
  return {
    manifest: {
      version: manifest.version,
      hash: listenTraceManifestHash(manifest),
      corpusHash: listenTraceCorpusHash(manifest),
      traceCount: manifest.traces.length,
      isolatedTraceCount: listenTracesInSuite("isolated", manifest).length,
      capturedTraceCount: validationCases.length,
    },
    partitions: [...new Set(validationCases.map(({ descriptor }) => descriptor.partition))],
    baselineProfileId: LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
    candidateProfileIds: Object.freeze(profileIds.slice(1)),
    profiles,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
  };
}

/** Runs the isolated candidate matrix in the browser against one inference session. */
export function runListenIsolatedProfileValidation(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
): Promise<ListenIsolatedProfileValidationResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenIsolatedProfileValidation({
    capture: (validationCase) => captureListenIsolatedValidationTrace(validationCase, session),
    rendererKeys,
    onProgress,
  }));
}

/**
 * The exported shape of an isolated validation run, small enough to record
 * verbatim. Every fixture keeps its decoded-structure hash, because that is what
 * two fresh browser processes must agree on; individual fixture rows are kept
 * only where a profile disagrees with the baseline or a gate is at stake.
 */
export function conciseListenIsolatedProfileValidationResult(
  result: ListenIsolatedProfileValidationResult,
) {
  return {
    manifest: result.manifest,
    partitions: result.partitions,
    baselineProfileId: result.baselineProfileId,
    candidateProfileIds: result.candidateProfileIds,
    profiles: result.profiles,
    traceReuseVerified: result.traceReuseVerified,
    baselineParityVerified: result.baselineParityVerified,
    renderers: result.renderers.map((renderer) => ({
      rendererKey: renderer.rendererKey,
      renderer: renderer.renderer,
      caseCount: renderer.caseCount,
      correctTrialCount: renderer.correctTrialCount,
      traceIdentities: renderer.cases.map((result) => ({
        traceId: result.traceId,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        pcmLength: result.pcmLength,
      })),
      profiles: renderer.profiles.map((profile) => ({
        profileId: profile.profileId,
        profile: profile.profile,
        correctTrialCount: profile.summary.correctTrialCount,
        correctAdvanceCount: profile.correctAdvanceCount,
        successRate: profile.summary.successRate,
        courseClearCorrectTrialCount: profile.courseClearCorrectTrialCount,
        courseClearAdvanceCount: profile.courseClearAdvanceCount,
        courseClearSuccessRate: profile.summary.courseClear.successRate,
        distinguishableFalseAdvanceCount: profile.summary.falseAdvanceCount,
        ambiguousAdvanceCount: profile.summary.ambiguousAdvanceCount,
        p95OnsetToAdvanceMs: profile.summary.p95OnsetToAdvanceMs,
        acceptance: profile.summary.acceptance,
        byCaseKind: profile.byCaseKind,
        deltaFromBaseline: profile.deltaFromBaseline,
      })),
      missedCorrectCases: renderer.cases
        .filter((result) => result.expectedCorrect &&
          result.profiles.some((profile) => !profile.advanced))
        .map((result) => ({
          traceId: result.traceId,
          fixtureGroup: result.fixtureGroup,
          measure: result.measure,
          moment: result.moment,
          targetPitches: result.targetPitches,
          advancedProfileIds: result.profiles
            .filter(({ advanced }) => advanced)
            .map(({ profileId }) => profileId),
        })),
      advancedIncorrectCases: renderer.cases
        .filter((result) => !result.expectedCorrect &&
          result.profiles.some((profile) => profile.advanced))
        .map((result) => ({
          traceId: result.traceId,
          caseKind: result.caseKind,
          targetPitches: result.targetPitches,
          playedPitches: result.playedPitches,
          mathematicallyAmbiguous: result.mathematicallyAmbiguous,
          advancedProfileIds: result.profiles
            .filter(({ advanced }) => advanced)
            .map(({ profileId }) => profileId),
        })),
    })),
  };
}

/**
 * The continuous-sequence portion of frozen-candidate validation.
 *
 * The sequence corpus is honestly labeled `discovery`: both the Direct and the
 * Tone sweeps have been run and reported over it, so nothing here is held-out
 * confirmation and no gate may quote it as such. It is measured anyway because
 * a release decision needs complete per-profile playing diagnostics — ordered
 * advancement, prefix progress, complete passages, failure reasons, carry-over,
 * latency, backlog, and the dedicated safety families — for exactly the frozen
 * candidates, at the same speeds and families the production playhead runs at.
 *
 * The capture rule is the isolated suite's rule: each passage is rendered and
 * recognized once, and every profile column replays that one retained trace.
 */

/** One manifest sequence trace, joined to the passage it renders. */
export interface ListenSequenceValidationCase {
  descriptor: ListenTraceDescriptor;
  definition: ListenSequenceDefinition;
  intervalMs: number;
  family: string;
  renderer: ListenBenchmarkRendererConfiguration;
  /** False for the dedicated safety families: they gate profiles, never score them. */
  scoreEligible: boolean;
}

/** One rendered, recognized passage, retained for the profile matrix. */
export interface ListenSequenceValidationCapture {
  validationCase: ListenSequenceValidationCase;
  sequence: MaterializedListenSequence;
  trace: ListenRecognitionTrace;
  /** Exact trace hash at capture, re-checked after every profile has replayed it. */
  recognitionHash: string;
  /** Survives a fresh browser process, unlike the raw PCM and trace hashes. */
  recognitionStructureHash: string;
  /** The capture-time baseline replay this matrix's baseline row must reproduce. */
  baselineRun: ListenSequenceRunResult;
}

export type ListenSequenceValidationCaptureFn = (
  validationCase: ListenSequenceValidationCase,
) => Promise<ListenSequenceValidationCapture>;

/** One profile's complete replayed run over one retained passage trace. */
export interface ListenSequenceProfileRun {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  run: ListenSequenceRunResult;
}

/** Complete attribution for one correct-content advance caused by a later attack. */
export interface ListenLateAdvanceForensicRecord {
  traceId: string;
  targetIndex: number;
  targetPitches: number[];
  targetScheduledAttackTimeMs: number;
  advanceTimeMs: number;
  sourceAttackIndex: number;
  sourceAttackPitches: number[];
  sourceToTargetDistance: number;
  attributionDelayMs: number;
}

/**
 * Resolves every late event to the physical attack that caused it. A result is
 * refused if replay classified a late advance without retaining its source or
 * advancement time, because exporting an unattributed count would recreate the
 * incomplete Task 10/11 evidence this matrix is meant to replace.
 */
export function listenLateAdvanceForensics(
  traceId: string,
  run: ListenSequenceRunResult,
): ListenLateAdvanceForensicRecord[] {
  return run.events.flatMap((event): ListenLateAdvanceForensicRecord[] => {
    if (!event.lateAdvance) return [];
    const source = run.attacks.find((attack) => (
      attack.advancementTargetIndices.includes(event.index)
    ));
    if (!source || event.advancedAtMs === null) {
      throw new Error(
        `${traceId} target ${event.index} is a late advance without complete source attribution.`,
      );
    }
    return [{
      traceId,
      targetIndex: event.index,
      targetPitches: [...event.targetPitches],
      targetScheduledAttackTimeMs: event.scheduledAttackTimeMs,
      advanceTimeMs: event.advancedAtMs,
      sourceAttackIndex: source.index,
      sourceAttackPitches: [...source.playedPitches],
      sourceToTargetDistance: Math.abs(source.targetIndex - event.index),
      attributionDelayMs: event.advancedAtMs - event.scheduledAttackTimeMs,
    }];
  });
}

export interface ListenSequenceValidationCaseResult {
  traceId: string;
  partition: ListenTracePartition;
  scoreEligible: boolean;
  sequenceId: string;
  sequenceLabel: string;
  family: string;
  intervalMs: number;
  eventRate: number;
  rendererKey: ListenTraceRendererKey;
  renderer: string;
  recognitionStructureHash: string;
  frameCount: number;
  pcmLength: number;
  /**
   * Recorded so the archive holds the raw identities, and excluded by name from
   * the cross-process comparison, which no fresh browser process reproduces.
   */
  processLocalPcmHash: string;
  processLocalTraceHash: string;
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
  /** Every profile's run, in the frozen column order, from this one trace. */
  profiles: ListenSequenceProfileRun[];
}

/**
 * Scoring metrics for one set of replayed runs.
 *
 * `aggregateListenSequenceRuns` already reports these per speed, but a speed
 * aggregate cannot be recombined into a corpus latency percentile, so the totals
 * are computed once over the runs themselves and every reported grouping —
 * corpus, speed, family — uses this same function.
 */
export interface ListenSequenceValidationTotals {
  sequenceCount: number;
  expectedEventCount: number;
  independentMatchCount: number;
  independentMatchRate: number;
  orderedAdvanceCount: number;
  orderedAdvanceRate: number;
  orderedPrefixCompleted: number;
  completePassageCount: number;
  completePassageRate: number;
  recognizedButBlockedCount: number;
  cascadeLossCount: number;
  /** Events whose classified failure includes a still-sounding previous chord. */
  carryOverBlockedEventCount: number;
  failureClassifications: Partial<Record<ListenSequenceFailureReason, number>>;
  missedCount: number;
  lateAdvanceCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  p50IndependentMatchLatencyMs: number | null;
  p95IndependentMatchLatencyMs: number | null;
  p50OrderedAdvanceLatencyMs: number | null;
  p95OrderedAdvanceLatencyMs: number | null;
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
  nextAttackBeforeAdvanceCount: number;
}

/** The metrics a candidate is compared against `baseline-v1` on. */
export interface ListenSequenceMetricDelta {
  independentMatchCount: number;
  orderedAdvanceCount: number;
  orderedPrefixCompleted: number;
  completePassageCount: number;
  lateAdvanceCount: number;
  carryOverBlockedEventCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  p95OrderedAdvanceLatencyMs: number | null;
}

export interface ListenSequenceProfileDelta extends ListenSequenceMetricDelta {
  bySpeed: Array<{ intervalMs: number } & ListenSequenceMetricDelta>;
  byFamily: Array<{ family: string } & ListenSequenceMetricDelta>;
  /** The dedicated safety families, which gate rather than score. */
  safety: {
    falseAdvanceCount: number;
    skippedAdvanceCount: number;
    duplicateAdvanceCount: number;
    lateAdvanceCount: number;
    incompleteCarriedBassAdvances: number;
  };
  /** Passages whose completion differs from the baseline, named individually. */
  gainedCompletePassageTraceIds: string[];
  lostCompletePassageTraceIds: string[];
  /** Passages that lost ordered advances, even where the passage was incomplete either way. */
  regressedOrderedAdvanceTraceIds: string[];
}

export interface ListenSequenceProfileValidationSummary {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  /** Scored rows only. The safety families are summarized separately below. */
  totals: ListenSequenceValidationTotals;
  /**
   * The `regression-only` rows on their own. They are reported so the baseline
   * column can be checked against the recorded whole-corpus row, and they are
   * never added into `totals`: a dedicated safety passage gates a profile and
   * must never be able to raise its score.
   */
  regressionTotals: ListenSequenceValidationTotals;
  bySpeed: Array<{ intervalMs: number; totals: ListenSequenceValidationTotals }>;
  byFamily: Array<{ family: string; totals: ListenSequenceValidationTotals }>;
  /** The historical per-speed and per-family diagnostics, unchanged in shape. */
  speedSummaries: ListenSequenceAggregateSummary[];
  familySpeedSummaries: ListenSequenceAggregateSummary[];
  /**
   * The dedicated safety families, which are held to zero absolutely.
   *
   * They are the corpus built to provoke a wrong advance, so they are the only
   * rows whose safety can be stated without a comparison. They also cover only
   * the passages whose family is `safety`, which is why `traceSafety` below
   * compares every other row against the baseline instead.
   */
  safety: ListenSequenceSafetySummary;
  /**
   * Every row of this corpus, safety family or not, compared with the baseline
   * column on the identical trace. An ordinary passage can advance a wrong
   * target too, and the family-scoped summary above would never see it.
   */
  traceSafety: ListenValidationTraceSafety;
  /** Every late advance, with its causing physical attack and attribution delay. */
  lateAdvances: ListenLateAdvanceForensicRecord[];
  /** Null for the baseline row itself. */
  deltaFromBaseline: ListenSequenceProfileDelta | null;
}

export interface ListenSequenceRendererValidation {
  rendererKey: ListenTraceRendererKey;
  renderer: ListenBenchmarkRendererConfiguration;
  caseCount: number;
  scoredCaseCount: number;
  safetyCaseCount: number;
  intervalsMs: number[];
  families: string[];
  cases: ListenSequenceValidationCaseResult[];
  profiles: ListenSequenceProfileValidationSummary[];
}

export interface ListenSequenceProfileValidationResult {
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    traceCount: number;
    sequenceTraceCount: number;
    capturedTraceCount: number;
  };
  /**
   * Always `discovery`: the sequence corpus selected thresholds in both
   * single-renderer sweeps, so these rows describe candidates rather than
   * confirming them.
   */
  evidenceRole: "discovery";
  partitions: ListenTracePartition[];
  baselineProfileId: ListenMatcherProfileId;
  candidateProfileIds: readonly ListenMatcherProfileId[];
  profiles: ListenValidationProfileIdentity[];
  renderers: ListenSequenceRendererValidation[];
  /** True when every profile column was replayed from one capture per passage. */
  traceReuseVerified: boolean;
  /** True when every baseline row reproduced its capture-time replay exactly. */
  baselineParityVerified: boolean;
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * proportion) - 1];
}

/**
 * Joins the manifest's sequence descriptors to the passages they render.
 *
 * `intervalsMs` narrows the corpus to a focused smoke; it is validated against
 * the frozen speed list so a mistyped speed fails loudly instead of quietly
 * measuring nothing. Families are deliberately not filterable: dropping one
 * would silently drop the safety gates that every profile row is qualified by.
 */
export function listenSequenceValidationCases(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
  intervalsMs?: readonly number[],
): ListenSequenceValidationCase[] {
  if (rendererKeys.length === 0) {
    throw new Error("Sequence profile validation needs at least one renderer.");
  }
  if (new Set(rendererKeys).size !== rendererKeys.length) {
    throw new Error("Sequence profile validation received a duplicated renderer key.");
  }
  for (const key of rendererKeys) {
    if (!RENDERER_BY_KEY[key]) {
      throw new Error(`Sequence profile validation received the unknown renderer key ${String(key)}.`);
    }
  }
  if (intervalsMs) {
    if (intervalsMs.length === 0) {
      throw new Error("Sequence profile validation needs at least one attack interval.");
    }
    if (new Set(intervalsMs).size !== intervalsMs.length) {
      throw new Error("Sequence profile validation received a duplicated attack interval.");
    }
    for (const intervalMs of intervalsMs) {
      if (!LISTEN_SEQUENCE_INTERVALS_MS.includes(intervalMs)) {
        throw new Error(
          `Sequence profile validation received the unknown attack interval ${intervalMs} ms.`,
        );
      }
    }
  }
  const definitions = bundledListenSequences();
  const selectedRenderers = new Set(rendererKeys);
  const selectedIntervals = intervalsMs ? new Set(intervalsMs) : null;
  return listenTracesInSuite("sequence", manifest)
    .filter((descriptor) => selectedRenderers.has(descriptor.rendererKey))
    .filter((descriptor) => (
      selectedIntervals === null || selectedIntervals.has(descriptor.intervalMs ?? NaN)
    ))
    .map((descriptor) => {
      const definition = definitions.find(({ id }) => id === descriptor.sourceId);
      if (!definition) {
        throw new Error(`${descriptor.id} names the unknown passage ${descriptor.sourceId}.`);
      }
      if (descriptor.intervalMs === null) {
        throw new Error(`${descriptor.id} has no attack interval.`);
      }
      // The whole sequence corpus was swept under both renderers, so a
      // confirmation row here would mean the frozen partition changed meaning.
      if (descriptor.partition === "confirmation") {
        throw new Error(`${descriptor.id} is sequence evidence and cannot be held-out confirmation.`);
      }
      if (definition.family !== descriptor.sequenceFamily) {
        throw new Error(
          `${descriptor.id} claims family ${String(descriptor.sequenceFamily)}, but ` +
          `${definition.id} is ${definition.family}.`,
        );
      }
      return {
        descriptor,
        definition,
        intervalMs: descriptor.intervalMs,
        family: definition.family,
        renderer: rendererForManifestTrace(descriptor),
        scoreEligible: descriptor.scoreEligible,
      };
    });
}

/**
 * Renders and recognizes one passage on the capture path the historical
 * sequence benchmark already uses, so a validation row cannot diverge from the
 * suite result it claims to describe.
 */
export async function captureListenSequenceValidationTrace(
  validationCase: ListenSequenceValidationCase,
  session: SequenceInferenceSession,
): Promise<ListenSequenceValidationCapture> {
  const captured = await captureListenSequenceRun({
    definition: validationCase.definition,
    intervalMs: validationCase.intervalMs,
    session,
    renderer: validationCase.renderer,
  });
  return {
    validationCase,
    sequence: captured.sequence,
    trace: captured.trace,
    recognitionHash: captured.recognitionHash,
    recognitionStructureHash: listenRecognitionStructureHash(captured.trace),
    baselineRun: captured.run,
  };
}

/**
 * Replays one retained passage trace through every profile column.
 *
 * The trace object is read, never rebuilt, so the only thing that can differ
 * between columns is the matcher. The capture-time hash is re-checked afterwards
 * because a replay that wrote back into the trace would make each column depend
 * on the order the profiles happened to run in.
 */
export function replayListenSequenceProfileMatrix(
  capture: ListenSequenceValidationCapture,
  profiles: readonly ListenValidationProfileIdentity[],
): ListenSequenceValidationCaseResult {
  if (profiles.length === 0) {
    throw new Error("A sequence profile matrix needs at least the baseline profile.");
  }
  if (new Set(profiles.map(({ profileId }) => profileId)).size !== profiles.length) {
    throw new Error("A sequence profile matrix cannot replay the same profile twice.");
  }
  if (profiles[0].profileId !== LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID) {
    throw new Error(
      `A sequence profile matrix must start from ${LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID}.`,
    );
  }
  const { validationCase, sequence, trace } = capture;
  const descriptor = validationCase.descriptor;
  const runs = profiles.map(({ profileId, profile }): ListenSequenceProfileRun => ({
    profileId,
    profile,
    run: replayListenSequenceTrace(sequence, trace, "current-matcher", profile),
  }));
  assertRecognitionTraceUnmutated(
    `${descriptor.id} candidate-matrix replay`,
    trace,
    capture.recognitionHash,
  );
  return {
    traceId: descriptor.id,
    partition: descriptor.partition,
    scoreEligible: validationCase.scoreEligible,
    sequenceId: validationCase.definition.id,
    sequenceLabel: validationCase.definition.label,
    family: validationCase.family,
    intervalMs: validationCase.intervalMs,
    eventRate: 1_000 / validationCase.intervalMs,
    rendererKey: descriptor.rendererKey,
    renderer: trace.renderer.version,
    recognitionStructureHash: capture.recognitionStructureHash,
    frameCount: trace.frames.length,
    pcmLength: trace.pcm.length,
    ...listenProfileProcessLocalHashes(descriptor.id, trace, capture.recognitionHash),
    maximumInferenceMs: trace.maximumInferenceMs,
    maximumProcessingBacklogMs: trace.maximumProcessingBacklogMs,
    profiles: runs,
  };
}

function sequenceRunFor(
  result: ListenSequenceValidationCaseResult,
  profileId: ListenMatcherProfileId,
): ListenSequenceRunResult {
  const entry = result.profiles.find((profile) => profile.profileId === profileId);
  if (!entry) throw new Error(`${result.traceId} has no ${profileId} row.`);
  return entry.run;
}

/** Sums one profile's replayed runs into the metrics every grouping reports. */
export function listenSequenceValidationTotals(
  runs: readonly ListenSequenceRunResult[],
): ListenSequenceValidationTotals {
  const total = (select: (run: ListenSequenceRunResult) => number) => runs
    .reduce((sum, run) => sum + select(run), 0);
  const expectedEventCount = total((run) => run.summary.expectedEventCount);
  const rate = (count: number) => (expectedEventCount === 0 ? 0 : count / expectedEventCount);
  const failureClassifications: Partial<Record<ListenSequenceFailureReason, number>> = {};
  for (const run of runs) {
    for (const event of run.events) {
      for (const reason of event.failureReasons) {
        failureClassifications[reason] = (failureClassifications[reason] ?? 0) + 1;
      }
    }
  }
  const orderedLatencies = runs.flatMap((run) => run.events.flatMap((event) => (
    event.orderedAdvanced && event.orderedAdvanceLatencyMs !== null
      ? [event.orderedAdvanceLatencyMs]
      : []
  )));
  const independentLatencies = runs.flatMap((run) => run.events.flatMap((event) => (
    event.independentMatchLatencyMs !== null ? [event.independentMatchLatencyMs] : []
  )));
  const independentMatchCount = total((run) => run.summary.independentMatchCount);
  const orderedAdvanceCount = total((run) => run.summary.orderedAdvanceCount);
  const completePassageCount = runs.filter(({ summary }) => summary.complete).length;
  return {
    sequenceCount: runs.length,
    expectedEventCount,
    independentMatchCount,
    independentMatchRate: rate(independentMatchCount),
    orderedAdvanceCount,
    orderedAdvanceRate: rate(orderedAdvanceCount),
    orderedPrefixCompleted: total((run) => run.summary.orderedPrefixCompleted),
    completePassageCount,
    completePassageRate: runs.length === 0 ? 0 : completePassageCount / runs.length,
    recognizedButBlockedCount: total((run) => run.summary.recognizedButBlockedCount),
    cascadeLossCount: total((run) => run.summary.cascadeLossCount),
    carryOverBlockedEventCount: failureClassifications["carry-over"] ?? 0,
    failureClassifications,
    missedCount: total((run) => run.summary.missedCount),
    lateAdvanceCount: total((run) => run.summary.lateAdvanceCount),
    falseAdvanceCount: total((run) => run.summary.falseAdvanceCount),
    skippedAdvanceCount: total((run) => run.summary.skippedAdvanceCount),
    duplicateAdvanceCount: total((run) => run.summary.duplicateAdvanceCount),
    p50IndependentMatchLatencyMs: percentile(independentLatencies, 0.5),
    p95IndependentMatchLatencyMs: percentile(independentLatencies, 0.95),
    p50OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.5),
    p95OrderedAdvanceLatencyMs: percentile(orderedLatencies, 0.95),
    maximumInferenceMs: Math.max(0, ...runs.map(({ summary }) => summary.maximumInferenceMs)),
    maximumProcessingBacklogMs: Math.max(
      0,
      ...runs.map(({ summary }) => summary.maximumProcessingBacklogMs),
    ),
    nextAttackBeforeAdvanceCount: total((run) => run.summary.nextAttackBeforeAdvanceCount),
  };
}

function sequenceMetricDelta(
  candidate: ListenSequenceValidationTotals,
  baseline: ListenSequenceValidationTotals,
): ListenSequenceMetricDelta {
  return {
    independentMatchCount: candidate.independentMatchCount - baseline.independentMatchCount,
    orderedAdvanceCount: candidate.orderedAdvanceCount - baseline.orderedAdvanceCount,
    orderedPrefixCompleted: candidate.orderedPrefixCompleted - baseline.orderedPrefixCompleted,
    completePassageCount: candidate.completePassageCount - baseline.completePassageCount,
    lateAdvanceCount: candidate.lateAdvanceCount - baseline.lateAdvanceCount,
    carryOverBlockedEventCount:
      candidate.carryOverBlockedEventCount - baseline.carryOverBlockedEventCount,
    falseAdvanceCount: candidate.falseAdvanceCount - baseline.falseAdvanceCount,
    skippedAdvanceCount: candidate.skippedAdvanceCount - baseline.skippedAdvanceCount,
    duplicateAdvanceCount: candidate.duplicateAdvanceCount - baseline.duplicateAdvanceCount,
    p95OrderedAdvanceLatencyMs: candidate.p95OrderedAdvanceLatencyMs === null ||
      baseline.p95OrderedAdvanceLatencyMs === null
      ? null
      : candidate.p95OrderedAdvanceLatencyMs - baseline.p95OrderedAdvanceLatencyMs,
  };
}

/**
 * Summarizes one renderer's sequence matrix.
 *
 * Scoring uses the manifest's `scoreEligible` flag rather than a family name
 * spelled here, so the dedicated safety passages gate every column through
 * `summarizeListenSequenceSafety` and contribute nothing to any positive metric.
 */
export function summarizeListenSequenceProfileValidation(
  rendererKey: ListenTraceRendererKey,
  renderer: ListenBenchmarkRendererConfiguration,
  cases: readonly ListenSequenceValidationCaseResult[],
  profiles: readonly ListenValidationProfileIdentity[],
): ListenSequenceRendererValidation {
  const baselineId = LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID;
  if (profiles.length === 0 || profiles[0].profileId !== baselineId) {
    throw new Error(`A sequence validation summary must start from ${baselineId}.`);
  }
  for (const result of cases) {
    if (result.rendererKey !== rendererKey) {
      throw new Error(`${result.traceId} is not a ${rendererKey} trace.`);
    }
  }
  const scored = cases.filter(({ scoreEligible }) => scoreEligible);
  const intervalsMs = [...new Set(scored.map(({ intervalMs }) => intervalMs))]
    .sort((left, right) => right - left);
  const families = [...new Set(scored.map(({ family }) => family))].sort();
  const columnFor = (identity: ListenValidationProfileIdentity) => {
    const runsFor = (selected: readonly ListenSequenceValidationCaseResult[]) => selected
      .map((result) => sequenceRunFor(result, identity.profileId));
    const scoredRuns = runsFor(scored);
    return {
      identity,
      totals: listenSequenceValidationTotals(scoredRuns),
      regressionTotals: listenSequenceValidationTotals(
        runsFor(cases.filter(({ scoreEligible }) => !scoreEligible)),
      ),
      bySpeed: intervalsMs.map((intervalMs) => ({
        intervalMs,
        totals: listenSequenceValidationTotals(
          runsFor(scored.filter((result) => result.intervalMs === intervalMs)),
        ),
      })),
      byFamily: families.map((family) => ({
        family,
        totals: listenSequenceValidationTotals(
          runsFor(scored.filter((result) => result.family === family)),
        ),
      })),
      speedSummaries: intervalsMs.map((intervalMs) => aggregateListenSequenceRuns(
        runsFor(scored.filter((result) => result.intervalMs === intervalMs)),
        intervalMs,
      )),
      familySpeedSummaries: intervalsMs.flatMap((intervalMs) => families.flatMap((family) => {
        const selected = scored.filter((result) => (
          result.intervalMs === intervalMs && result.family === family
        ));
        return selected.length === 0
          ? []
          : [aggregateListenSequenceRuns(runsFor(selected), intervalMs, family)];
      })),
      safety: summarizeListenSequenceSafety(runsFor(cases)),
      lateAdvances: cases.flatMap((result) => listenLateAdvanceForensics(
        result.traceId,
        sequenceRunFor(result, identity.profileId),
      )),
      completedTraceIds: new Set(scored
        .filter((result) => sequenceRunFor(result, identity.profileId).summary.complete)
        .map(({ traceId }) => traceId)),
      orderedAdvancesByTraceId: new Map(scored.map((result) => [
        result.traceId,
        sequenceRunFor(result, identity.profileId).summary.orderedAdvanceCount,
      ])),
    };
  };
  const columns = profiles.map(columnFor);
  const baseline = columns[0];
  const summaries = columns.map((column): ListenSequenceProfileValidationSummary => ({
    profileId: column.identity.profileId,
    profile: column.identity.profile,
    totals: column.totals,
    regressionTotals: column.regressionTotals,
    bySpeed: column.bySpeed,
    byFamily: column.byFamily,
    speedSummaries: column.speedSummaries,
    familySpeedSummaries: column.familySpeedSummaries,
    safety: column.safety,
    traceSafety: listenValidationTraceSafety(cases.map((result) => ({
      traceId: result.traceId,
      candidate: sequenceRunFor(result, column.identity.profileId),
      baseline: sequenceRunFor(result, baselineId),
    }))),
    lateAdvances: column.lateAdvances,
    deltaFromBaseline: column === baseline ? null : {
      ...sequenceMetricDelta(column.totals, baseline.totals),
      bySpeed: column.bySpeed.map(({ intervalMs, totals }, index) => ({
        intervalMs,
        ...sequenceMetricDelta(totals, baseline.bySpeed[index].totals),
      })),
      byFamily: column.byFamily.map(({ family, totals }, index) => ({
        family,
        ...sequenceMetricDelta(totals, baseline.byFamily[index].totals),
      })),
      safety: {
        falseAdvanceCount: column.safety.falseAdvanceCount - baseline.safety.falseAdvanceCount,
        skippedAdvanceCount: column.safety.skippedAdvanceCount - baseline.safety.skippedAdvanceCount,
        duplicateAdvanceCount:
          column.safety.duplicateAdvanceCount - baseline.safety.duplicateAdvanceCount,
        lateAdvanceCount: column.safety.lateAdvanceCount - baseline.safety.lateAdvanceCount,
        incompleteCarriedBassAdvances:
          column.safety.incompleteCarriedBassAdvances - baseline.safety.incompleteCarriedBassAdvances,
      },
      gainedCompletePassageTraceIds: [...column.completedTraceIds]
        .filter((id) => !baseline.completedTraceIds.has(id)).sort(),
      lostCompletePassageTraceIds: [...baseline.completedTraceIds]
        .filter((id) => !column.completedTraceIds.has(id)).sort(),
      regressedOrderedAdvanceTraceIds: [...column.orderedAdvancesByTraceId]
        .filter(([id, count]) => count < (baseline.orderedAdvancesByTraceId.get(id) ?? 0))
        .map(([id]) => id).sort(),
    },
  }));
  return {
    rendererKey,
    renderer: { ...renderer },
    caseCount: cases.length,
    scoredCaseCount: scored.length,
    safetyCaseCount: cases.length - scored.length,
    intervalsMs,
    families,
    cases: [...cases],
    profiles: summaries,
  };
}

/**
 * Captures the sequence corpus once and replays the frozen candidate matrix
 * against every retained trace.
 *
 * The capture function is injected so unit tests drive the identical join,
 * matrix, aggregation, and parity path over deterministic synthetic traces, and
 * so a test can prove that one capture serves every profile column.
 */
export async function evaluateListenSequenceProfileValidation(options: {
  capture: ListenSequenceValidationCaptureFn;
  manifest?: ListenTraceManifest;
  candidateProfileIds?: readonly ListenMatcherProfileId[];
  rendererKeys?: readonly ListenTraceRendererKey[];
  intervalsMs?: readonly number[];
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenSequenceProfileValidationResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const onProgress = options.onProgress ?? (() => undefined);
  const profileIds = resolveListenValidationProfileIds(options.candidateProfileIds);
  const profiles = listenValidationProfileIdentities(profileIds);
  const rendererKeys = options.rendererKeys ?? ["direct", "tone"];
  const validationCases = listenSequenceValidationCases(
    manifest,
    rendererKeys,
    options.intervalsMs,
  );
  if (validationCases.length === 0) {
    throw new Error("The manifest contains no sequence traces to validate.");
  }
  const resultsByRenderer = new Map<ListenTraceRendererKey, ListenSequenceValidationCaseResult[]>();
  for (let index = 0; index < validationCases.length; index += 1) {
    const validationCase = validationCases[index];
    const descriptor = validationCase.descriptor;
    const label = `${validationCase.definition.label} at ${validationCase.intervalMs} ms`;
    onProgress(index, validationCases.length, `Capturing ${descriptor.id}`);
    const capture = await options.capture(validationCase);
    // The row is filed under the requested passage's identity, so a capture that
    // answered with different audio would be reported as this passage.
    if (capture.validationCase.descriptor.id !== descriptor.id) {
      throw new Error(`Capturing ${descriptor.id} returned ${capture.validationCase.descriptor.id}.`);
    }
    if (capture.trace.renderer.version !== descriptor.renderer) {
      throw new Error(
        `${descriptor.id} expects renderer ${descriptor.renderer}, but its capture used ` +
        `${capture.trace.renderer.version}.`,
      );
    }
    if (
      capture.trace.sequenceId !== validationCase.definition.id ||
      capture.trace.intervalMs !== validationCase.intervalMs
    ) {
      throw new Error(
        `${descriptor.id} expects ${validationCase.definition.id} at ${validationCase.intervalMs} ` +
        `ms, but its capture recognized ${capture.trace.sequenceId} at ${capture.trace.intervalMs} ms.`,
      );
    }
    const caseResult = replayListenSequenceProfileMatrix(capture, profiles);
    // The baseline column must reproduce the capture-time replay exactly. A
    // difference there means the harness changed, so no candidate comparison
    // built on this trace would be measuring the profile.
    assertListenSequenceRunParity(
      label,
      capture.baselineRun,
      sequenceRunFor(caseResult, LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID),
    );
    const existing = resultsByRenderer.get(descriptor.rendererKey);
    if (existing) existing.push(caseResult);
    else resultsByRenderer.set(descriptor.rendererKey, [caseResult]);
    onProgress(index + 1, validationCases.length, `Replayed ${descriptor.id}`);
  }
  const renderers = rendererKeys
    .filter((key) => resultsByRenderer.has(key))
    .map((key) => summarizeListenSequenceProfileValidation(
      key,
      RENDERER_BY_KEY[key],
      resultsByRenderer.get(key) ?? [],
      profiles,
    ));
  return {
    manifest: {
      version: manifest.version,
      hash: listenTraceManifestHash(manifest),
      corpusHash: listenTraceCorpusHash(manifest),
      traceCount: manifest.traces.length,
      sequenceTraceCount: listenTracesInSuite("sequence", manifest).length,
      capturedTraceCount: validationCases.length,
    },
    evidenceRole: "discovery",
    partitions: [...new Set(validationCases.map(({ descriptor }) => descriptor.partition))],
    baselineProfileId: LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
    candidateProfileIds: Object.freeze(profileIds.slice(1)),
    profiles,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
  };
}

/** Runs the sequence candidate matrix in the browser against one inference session. */
export function runListenSequenceProfileValidation(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
  intervalsMs?: readonly number[],
): Promise<ListenSequenceProfileValidationResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenSequenceProfileValidation({
    capture: (validationCase) => captureListenSequenceValidationTrace(validationCase, session),
    rendererKeys,
    intervalsMs,
    onProgress,
  }));
}

/**
 * The exported shape of a sequence validation run. Every passage keeps its
 * decoded-structure hash, because that is what two fresh browser processes must
 * agree on; individual passage rows are kept where a profile disagrees with the
 * baseline, so a regression can be named rather than only counted.
 */
export function conciseListenSequenceProfileValidationResult(
  result: ListenSequenceProfileValidationResult,
) {
  const baselineId = result.baselineProfileId;
  return {
    manifest: result.manifest,
    evidenceRole: result.evidenceRole,
    partitions: result.partitions,
    baselineProfileId: baselineId,
    candidateProfileIds: result.candidateProfileIds,
    profiles: result.profiles,
    traceReuseVerified: result.traceReuseVerified,
    baselineParityVerified: result.baselineParityVerified,
    renderers: result.renderers.map((renderer) => ({
      rendererKey: renderer.rendererKey,
      renderer: renderer.renderer,
      caseCount: renderer.caseCount,
      scoredCaseCount: renderer.scoredCaseCount,
      safetyCaseCount: renderer.safetyCaseCount,
      intervalsMs: renderer.intervalsMs,
      families: renderer.families,
      traceIdentities: renderer.cases.map((result) => ({
        traceId: result.traceId,
        partition: result.partition,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        pcmLength: result.pcmLength,
      })),
      profiles: renderer.profiles.map((profile) => ({
        profileId: profile.profileId,
        profile: profile.profile,
        totals: profile.totals,
        regressionTotals: profile.regressionTotals,
        bySpeed: profile.bySpeed,
        byFamily: profile.byFamily,
        speedSummaries: profile.speedSummaries,
        familySpeedSummaries: profile.familySpeedSummaries,
        safety: profile.safety,
        traceSafety: profile.traceSafety,
        lateAdvances: profile.lateAdvances,
        deltaFromBaseline: profile.deltaFromBaseline,
      })),
      incompletePassages: renderer.cases
        .filter((result) => result.scoreEligible && result.profiles
          .some(({ run }) => !run.summary.complete))
        .map((result) => ({
          traceId: result.traceId,
          family: result.family,
          intervalMs: result.intervalMs,
          profiles: result.profiles.map(({ profileId, run }) => ({
            profileId,
            complete: run.summary.complete,
            orderedAdvanceCount: run.summary.orderedAdvanceCount,
            firstStallIndex: run.summary.firstStallIndex,
            primaryFailure: run.summary.firstStallIndex === null
              ? null
              : run.events[run.summary.firstStallIndex]?.primaryFailure ?? null,
          })),
        })),
      unsafeAdvances: renderer.cases
        .filter((result) => result.profiles.some(({ run }) => (
          run.summary.falseAdvanceCount > 0 ||
          run.summary.skippedAdvanceCount > 0 ||
          run.summary.duplicateAdvanceCount > 0
        )))
        .map((result) => ({
          traceId: result.traceId,
          partition: result.partition,
          family: result.family,
          intervalMs: result.intervalMs,
          profiles: result.profiles
            .filter(({ run }) => (
              run.summary.falseAdvanceCount > 0 ||
              run.summary.skippedAdvanceCount > 0 ||
              run.summary.duplicateAdvanceCount > 0
            ))
            .map(({ profileId, run }) => ({
              profileId,
              falseAdvanceCount: run.summary.falseAdvanceCount,
              skippedAdvanceCount: run.summary.skippedAdvanceCount,
              duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
              eventIndices: run.events
                .filter((event) => event.falseAdvance || event.skipped || event.duplicate)
                .map(({ index }) => index),
            })),
        })),
    })),
  };
}

/**
 * The dynamics and articulation portion of frozen-candidate validation.
 *
 * These are the domains the original Direct-only sequence sweep never saw, and
 * the manifest deliberately split them: three constant layers per piano and
 * renderer, one mixed run per renderer, and five of the eight articulation runs
 * tuned the multi-domain search, while every other layer, the other mixed runs,
 * and the held-back articulations stayed untouched. A row is therefore reported
 * under its own partition, and every aggregate carries the partitions it spans:
 * an aggregate that mixes them is labeled `mixed` and can never be quoted as
 * confirmation.
 *
 * The capture rule is the one both earlier parts use: each layer, mixed run, and
 * articulation is rendered and recognized once through the suite's own capture
 * path, and every profile column replays that single retained decoded trace.
 */

/** The three suites this part covers. Each is filterable for a focused smoke. */
export type ListenDynamicsValidationSuite =
  | "dynamics-constant"
  | "dynamics-mixed"
  | "articulation";

export const LISTEN_DYNAMICS_VALIDATION_SUITES: readonly ListenDynamicsValidationSuite[] =
  Object.freeze(["dynamics-constant", "dynamics-mixed", "articulation"] as const);

/**
 * What a set of rows may be used for. `confirmation` is the only role a release
 * gate may quote; `mixed` exists so an aggregate that spans both partitions is
 * visibly not confirmation rather than quietly presented as if it were.
 */
export type ListenValidationEvidenceRole = "discovery" | "confirmation" | "mixed";

/**
 * The evidence role of a set of scored rows. `regression-only` rows gate rather
 * than score, so they never appear in a scored group and are rejected here.
 */
export function listenValidationEvidenceRole(
  partitions: readonly ListenTracePartition[],
): ListenValidationEvidenceRole {
  const distinct = [...new Set(partitions)];
  if (distinct.includes("regression-only")) {
    throw new Error("A regression-only trace gates a profile and can never carry an evidence role.");
  }
  if (distinct.length === 1 && distinct[0] === "discovery") return "discovery";
  if (distinct.length === 1 && distinct[0] === "confirmation") return "confirmation";
  return "mixed";
}

/** One manifest dynamics or articulation trace, joined to what it renders. */
export interface ListenDynamicsValidationCase {
  descriptor: ListenTraceDescriptor;
  suite: ListenDynamicsValidationSuite;
  definition: ListenSequenceDefinition;
  intervalMs: number;
  renderer: ListenBenchmarkRendererConfiguration;
  piano: PianoId;
  pianoName: string;
  /** Null for a mixed-dynamics run, which plays every layer of its piano. */
  layer: PianoLayerId | null;
  dynamicBand: ListenDynamicBand | null;
  dynamicProfile: "constant" | "crescendo-decrescendo";
  articulation: ListenSequenceArticulation | null;
  /** False for the diagnosed regression rows: they gate profiles, never score them. */
  scoreEligible: boolean;
}

/** One rendered, recognized dynamics or articulation run, kept for the matrix. */
export interface ListenDynamicsValidationCapture {
  validationCase: ListenDynamicsValidationCase;
  sequence: MaterializedListenSequence;
  trace: ListenRecognitionTrace;
  /** Exact trace hash at capture, re-checked after every profile has replayed it. */
  recognitionHash: string;
  /** Survives a fresh browser process, unlike the raw PCM and trace hashes. */
  recognitionStructureHash: string;
  /** The capture-time baseline replay this matrix's baseline row must reproduce. */
  baselineRun: ListenSequenceRunResult;
  /**
   * The instrument the capture actually rendered. Checked against the descriptor,
   * so a run captured on the wrong piano or velocity layer cannot be filed as a
   * layer it never played.
   */
  captured: {
    piano: PianoId;
    layer: PianoLayerId | null;
    dynamicProfile: "constant" | "crescendo-decrescendo";
  };
}

export type ListenDynamicsValidationCaptureFn = (
  validationCase: ListenDynamicsValidationCase,
) => Promise<ListenDynamicsValidationCapture>;

export interface ListenDynamicsValidationCaseResult {
  traceId: string;
  partition: ListenTracePartition;
  scoreEligible: boolean;
  suite: ListenDynamicsValidationSuite;
  sequenceId: string;
  sequenceLabel: string;
  piano: PianoId;
  pianoName: string;
  layer: PianoLayerId | null;
  dynamicBand: ListenDynamicBand | null;
  dynamicProfile: "constant" | "crescendo-decrescendo";
  articulation: ListenSequenceArticulation | null;
  intervalMs: number;
  rendererKey: ListenTraceRendererKey;
  renderer: string;
  recognitionStructureHash: string;
  frameCount: number;
  pcmLength: number;
  /**
   * Recorded so the archive holds the raw identities, and excluded by name from
   * the cross-process comparison, which no fresh browser process reproduces.
   */
  processLocalPcmHash: string;
  processLocalTraceHash: string;
  peak: number;
  rms: number;
  maximumInferenceMs: number;
  maximumProcessingBacklogMs: number;
  /** Every profile's run, in the frozen column order, from this one trace. */
  profiles: ListenSequenceProfileRun[];
}

/** The levels a dynamics or articulation regression must stay visible at. */
export type ListenDynamicsGroupKind =
  | "corpus"
  | "partition"
  | "suite"
  | "piano"
  | "piano-partition"
  | "layer"
  | "mixed-run"
  | "articulation";

export interface ListenDynamicsGroupDelta extends ListenSequenceMetricDelta {
  /** Rows whose completion or ordered progress differs, named individually. */
  gainedCompletePassageTraceIds: string[];
  lostCompletePassageTraceIds: string[];
  regressedOrderedAdvanceTraceIds: string[];
}

/**
 * One reported set of rows for one profile.
 *
 * Every group states the partitions it covers and the role that makes it, so a
 * per-piano row that spans a tuned layer and an untouched one is `mixed` rather
 * than confirmation, while a single layer or articulation stays a clean leaf of
 * exactly one partition.
 */
export interface ListenDynamicsValidationGroup {
  kind: ListenDynamicsGroupKind;
  /** Stable identity, unique inside one renderer's group list. */
  key: string;
  label: string;
  suite: ListenDynamicsValidationSuite | null;
  piano: PianoId | null;
  pianoName: string | null;
  layer: PianoLayerId | null;
  dynamicBand: ListenDynamicBand | null;
  articulation: ListenSequenceArticulation | null;
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole;
  traceIds: string[];
  totals: ListenSequenceValidationTotals;
  /** Null for the baseline row itself. */
  deltaFromBaseline: ListenDynamicsGroupDelta | null;
}

/** One piano's rates, and the constant layer that performed worst on it. */
export interface ListenDynamicsPianoRates {
  piano: PianoId;
  pianoName: string;
  runCount: number;
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole;
  independentMatchRate: number;
  orderedAdvanceRate: number;
  completePassageRate: number;
  worstLayer: PianoLayerId | null;
  worstLayerOrderedAdvanceRate: number | null;
}

/**
 * Mean of the per-piano rates for one dynamics suite, so Salamander's sixteen
 * velocity layers weigh exactly as much as Splendid's four instead of deciding
 * the aggregate on their own.
 *
 * It is computed per suite rather than over both together, because the
 * constant-layer and mixed-dynamics matrices each already record a cross-piano
 * aggregate of their own; blending them would produce a number that resembles
 * those records without being comparable with either.
 */
export interface ListenDynamicsEqualPianoSummary {
  suite: ListenDynamicsValidationSuite;
  pianoCount: number;
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole | null;
  independentMatchRate: number | null;
  orderedAdvanceRate: number | null;
  completePassageRate: number | null;
  pianos: ListenDynamicsPianoRates[];
  worstPiano: PianoId | null;
}

/**
 * Safety for one profile across every partition of this corpus.
 *
 * The dynamics and articulation corpora contain no dedicated safety family, so
 * safety here is measured two ways: unsafe advances introduced relative to
 * `baseline-v1` on the identical trace, and the committed regressions replayed
 * under the same profile. Late advances are counted separately and never fold
 * into the verdict: the `v05` case is a playhead lag on music the player did
 * play, not a false advance.
 */
export interface ListenDynamicsSafetySummary {
  runCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  /** Reported beside safety, never as safety. */
  lateAdvanceCount: number;
  /** Rows unsafe under this profile that `baseline-v1` handled safely. */
  introducedUnsafeTraceIds: string[];
  /**
   * Rows `baseline-v1` already advanced unsafely that this profile made worse,
   * by adding an event, changing its classification, or moving it to another
   * target. Asking only whether a row is unsafe would report every one of those
   * as no change at all, because the row was unsafe either way.
   */
  worsenedUnsafeTraceIds: string[];
  /** Rows whose baseline unsafe advance this profile no longer produces. */
  clearedUnsafeTraceIds: string[];
  /** Why each named row is worse, so the verdict never has to be taken on trust. */
  unsafeReasons: Array<{ traceId: string; reasons: string[] }>;
  /** The committed Task 05 and Task 06 regressions, replayed under this profile. */
  regressions: ListenSafetyRegressionSummary;
  passed: boolean;
}

export interface ListenDynamicsProfileDelta {
  equalPiano: Array<{
    suite: ListenDynamicsValidationSuite;
    independentMatchRate: number | null;
    orderedAdvanceRate: number | null;
    completePassageRate: number | null;
  }>;
  safety: {
    falseAdvanceCount: number;
    skippedAdvanceCount: number;
    duplicateAdvanceCount: number;
    lateAdvanceCount: number;
    regressionWorseThanBaselineCount: number;
  };
}

export interface ListenDynamicsProfileValidationSummary {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  /**
   * Every reported grouping, from the whole scored corpus down to one velocity
   * layer, each labeled with the partitions it spans. The leaf groups are what
   * keep a single layer, mixed run, or articulation from disappearing into an
   * average.
   */
  groups: ListenDynamicsValidationGroup[];
  /** One entry per dynamics suite present, never one blended over both. */
  equalPiano: ListenDynamicsEqualPianoSummary[];
  /**
   * The `regression-only` rows on their own. They are never added into a scored
   * group: a diagnosed case gates a profile and must not be able to raise its
   * score.
   */
  regressionTotals: ListenSequenceValidationTotals;
  safety: ListenDynamicsSafetySummary;
  /** Every late advance across this profile column, fully attributed. */
  lateAdvances: ListenLateAdvanceForensicRecord[];
  /** Null for the baseline row itself. Group deltas live on each group. */
  deltaFromBaseline: ListenDynamicsProfileDelta | null;
}

/**
 * One diagnosed row reported on its own, with the semantics its fixture pins.
 *
 * The Tone plus Salamander `v05` run is a late advance: every profile advances
 * the correct repeated chord, and the candidates advance it one repetition
 * earlier than `baseline-v1`. The Task 06 case is a genuine false advance. They
 * are listed together because both are regression rows, and kept apart by
 * `expectation` because rejecting the first would reject an improvement.
 */
export interface ListenDynamicsRegressionCaseReport {
  traceId: string;
  partition: ListenTracePartition;
  suite: ListenDynamicsValidationSuite;
  piano: PianoId;
  layer: PianoLayerId | null;
  articulation: ListenSequenceArticulation | null;
  profiles: Array<{
    profileId: ListenMatcherProfileId;
    complete: boolean;
    orderedAdvanceCount: number;
    lateAdvanceCount: number;
    falseAdvanceCount: number;
    skippedAdvanceCount: number;
    duplicateAdvanceCount: number;
    /** Each late advance with the physical attack that caused it. */
    lateAdvances: ListenLateAdvanceForensicRecord[];
    unsafeAdvances: Array<{
      targetIndex: number;
      falseAdvance: boolean;
      skipped: boolean;
      duplicate: boolean;
      advancedAtMs: number | null;
    }>;
  }>;
}

export interface ListenDynamicsRendererValidation {
  rendererKey: ListenTraceRendererKey;
  renderer: ListenBenchmarkRendererConfiguration;
  caseCount: number;
  scoredCaseCount: number;
  regressionCaseCount: number;
  suites: ListenDynamicsValidationSuite[];
  pianos: PianoId[];
  partitions: ListenTracePartition[];
  cases: ListenDynamicsValidationCaseResult[];
  profiles: ListenDynamicsProfileValidationSummary[];
  /** The diagnosed rows, reported apart from every score. */
  regressionCases: ListenDynamicsRegressionCaseReport[];
}

export interface ListenDynamicsProfileValidationResult {
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    traceCount: number;
    dynamicsConstantTraceCount: number;
    dynamicsMixedTraceCount: number;
    articulationTraceCount: number;
    capturedTraceCount: number;
  };
  /**
   * `mixed` whenever the run spans both partitions, which the default corpus
   * does. It is never a single value that a gate could mistake for a
   * confirmation-wide verdict; the per-group roles are the usable labels.
   */
  evidenceRole: ListenValidationEvidenceRole;
  partitions: ListenTracePartition[];
  suites: ListenDynamicsValidationSuite[];
  baselineProfileId: ListenMatcherProfileId;
  candidateProfileIds: readonly ListenMatcherProfileId[];
  profiles: ListenValidationProfileIdentity[];
  renderers: ListenDynamicsRendererValidation[];
  /** True when every profile column was replayed from one capture per run. */
  traceReuseVerified: boolean;
  /** True when every baseline row reproduced its capture-time replay exactly. */
  baselineParityVerified: boolean;
}

/** The suites an equal-piano aggregate is defined for: both pianos play them. */
const DYNAMICS_EQUAL_PIANO_SUITES = ["dynamics-constant", "dynamics-mixed"] as const;

const DYNAMICS_SUITE_BY_NAME: Readonly<Record<ListenDynamicsValidationSuite, true>> = Object.freeze({
  "dynamics-constant": true,
  "dynamics-mixed": true,
  articulation: true,
});

/**
 * Joins the manifest's dynamics and articulation descriptors to the passage and
 * instrument they render.
 *
 * `suites` narrows the corpus to a focused smoke and is validated against the
 * frozen suite list. Narrowing is safe here in a way narrowing the sequence
 * families was not: the diagnosed cases gate every profile through the committed
 * regression replay as well as through the rows themselves, so a suite-limited
 * run still cannot report a clean safety verdict while regressing one.
 */
export function listenDynamicsValidationCases(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
  suites: readonly ListenDynamicsValidationSuite[] = LISTEN_DYNAMICS_VALIDATION_SUITES,
): ListenDynamicsValidationCase[] {
  if (rendererKeys.length === 0) {
    throw new Error("Dynamics profile validation needs at least one renderer.");
  }
  if (new Set(rendererKeys).size !== rendererKeys.length) {
    throw new Error("Dynamics profile validation received a duplicated renderer key.");
  }
  for (const key of rendererKeys) {
    if (!RENDERER_BY_KEY[key]) {
      throw new Error(`Dynamics profile validation received the unknown renderer key ${String(key)}.`);
    }
  }
  if (suites.length === 0) {
    throw new Error("Dynamics profile validation needs at least one suite.");
  }
  if (new Set(suites).size !== suites.length) {
    throw new Error("Dynamics profile validation received a duplicated suite.");
  }
  for (const suite of suites) {
    if (!DYNAMICS_SUITE_BY_NAME[suite]) {
      throw new Error(`Dynamics profile validation received the unknown suite ${String(suite)}.`);
    }
  }
  const definitions = courseClearArticulationDefinitions();
  const selectedRenderers = new Set(rendererKeys);
  const selected = LISTEN_DYNAMICS_VALIDATION_SUITES.filter((suite) => suites.includes(suite));
  return selected.flatMap((suite) => listenTracesInSuite(suite, manifest)
    .filter((descriptor) => selectedRenderers.has(descriptor.rendererKey))
    .map((descriptor): ListenDynamicsValidationCase => {
      const definition = definitions.find(({ id }) => id === descriptor.sourceId);
      if (!definition) {
        throw new Error(`${descriptor.id} names the unknown passage ${descriptor.sourceId}.`);
      }
      if (descriptor.intervalMs === null) {
        throw new Error(`${descriptor.id} has no attack interval.`);
      }
      if (definition.articulation !== descriptor.articulation) {
        throw new Error(
          `${descriptor.id} claims articulation ${String(descriptor.articulation)}, but ` +
          `${definition.id} is ${String(definition.articulation)}.`,
        );
      }
      if (descriptor.piano === null) {
        throw new Error(`${descriptor.id} names no piano.`);
      }
      const dynamicProfile = descriptor.dynamicProfile;
      if (dynamicProfile === null) {
        throw new Error(`${descriptor.id} names no dynamic profile.`);
      }
      if ((descriptor.layer === null) !== (dynamicProfile === "crescendo-decrescendo")) {
        throw new Error(
          `${descriptor.id} is a ${dynamicProfile} run and cannot name layer ` +
          `${String(descriptor.layer)}.`,
        );
      }
      // Articulation renders on the fixed benchmark instrument rather than on a
      // requested one, so the join checks that the manifest still describes it.
      if (
        suite === "articulation" &&
        (descriptor.piano !== LISTEN_BENCHMARK_PIANO.id || descriptor.layer !== LISTEN_BENCHMARK_PIANO.layer)
      ) {
        throw new Error(
          `${descriptor.id} claims ${descriptor.piano}/${String(descriptor.layer)}, but the ` +
          `articulation matrix renders ${LISTEN_BENCHMARK_PIANO.id}/${LISTEN_BENCHMARK_PIANO.layer}.`,
        );
      }
      return {
        descriptor,
        suite,
        definition,
        intervalMs: descriptor.intervalMs,
        renderer: rendererForManifestTrace(descriptor),
        piano: descriptor.piano,
        pianoName: pianoDefinition(descriptor.piano).displayName,
        layer: descriptor.layer,
        dynamicBand: descriptor.dynamicBand,
        dynamicProfile,
        articulation: descriptor.articulation,
        scoreEligible: descriptor.scoreEligible,
      };
    }));
}

/**
 * Renders and recognizes one dynamics or articulation run on the capture path
 * its own suite already uses, so a validation row cannot diverge from the suite
 * result it claims to describe.
 */
export async function captureListenDynamicsValidationTrace(
  validationCase: ListenDynamicsValidationCase,
  session: SequenceInferenceSession,
): Promise<ListenDynamicsValidationCapture> {
  if (validationCase.suite === "articulation") {
    const captured = await captureListenSequenceRun({
      definition: validationCase.definition,
      intervalMs: validationCase.intervalMs,
      session,
      renderer: validationCase.renderer,
    });
    return {
      validationCase,
      sequence: captured.sequence,
      trace: captured.trace,
      recognitionHash: captured.recognitionHash,
      recognitionStructureHash: listenRecognitionStructureHash(captured.trace),
      baselineRun: captured.run,
      captured: {
        piano: LISTEN_BENCHMARK_PIANO.id,
        layer: LISTEN_BENCHMARK_PIANO.layer as PianoLayerId,
        dynamicProfile: "constant",
      },
    };
  }
  const { sequence, run } = await captureCourseClearDynamicsRun(
    { session, renderer: validationCase.renderer },
    validationCase.piano,
    validationCase.layer,
  );
  if (run.profileId !== LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID) {
    throw new Error(
      `${validationCase.descriptor.id} was captured under ${run.profileId}, so its baseline ` +
      `column would not be ${LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID}.`,
    );
  }
  const trace = run.recognition.trace;
  return {
    validationCase,
    sequence,
    trace,
    recognitionHash: listenRecognitionTraceHash(trace),
    recognitionStructureHash: listenRecognitionStructureHash(trace),
    baselineRun: run.recognition,
    captured: {
      piano: run.piano,
      layer: run.layer,
      dynamicProfile: run.dynamicProfile,
    },
  };
}

/**
 * Replays one retained dynamics or articulation trace through every profile
 * column.
 *
 * The trace object is read, never rebuilt, so the only thing that can differ
 * between columns is the matcher. The capture-time hash is re-checked afterwards
 * because a replay that wrote back into the trace would make each column depend
 * on the order the profiles happened to run in.
 */
export function replayListenDynamicsProfileMatrix(
  capture: ListenDynamicsValidationCapture,
  profiles: readonly ListenValidationProfileIdentity[],
): ListenDynamicsValidationCaseResult {
  if (profiles.length === 0) {
    throw new Error("A dynamics profile matrix needs at least the baseline profile.");
  }
  if (new Set(profiles.map(({ profileId }) => profileId)).size !== profiles.length) {
    throw new Error("A dynamics profile matrix cannot replay the same profile twice.");
  }
  if (profiles[0].profileId !== LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID) {
    throw new Error(
      `A dynamics profile matrix must start from ${LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID}.`,
    );
  }
  const { validationCase, sequence, trace } = capture;
  const descriptor = validationCase.descriptor;
  const runs = profiles.map(({ profileId, profile }): ListenSequenceProfileRun => ({
    profileId,
    profile,
    run: replayListenSequenceTrace(sequence, trace, "current-matcher", profile),
  }));
  assertRecognitionTraceUnmutated(
    `${descriptor.id} candidate-matrix replay`,
    trace,
    capture.recognitionHash,
  );
  return {
    traceId: descriptor.id,
    partition: descriptor.partition,
    scoreEligible: validationCase.scoreEligible,
    suite: validationCase.suite,
    sequenceId: validationCase.definition.id,
    sequenceLabel: validationCase.definition.label,
    piano: validationCase.piano,
    pianoName: validationCase.pianoName,
    layer: validationCase.layer,
    dynamicBand: validationCase.dynamicBand,
    dynamicProfile: validationCase.dynamicProfile,
    articulation: validationCase.articulation,
    intervalMs: validationCase.intervalMs,
    rendererKey: descriptor.rendererKey,
    renderer: trace.renderer.version,
    recognitionStructureHash: capture.recognitionStructureHash,
    frameCount: trace.frames.length,
    pcmLength: trace.pcm.length,
    ...listenProfileProcessLocalHashes(descriptor.id, trace, capture.recognitionHash),
    peak: trace.audioDiagnostics.peak,
    rms: trace.audioDiagnostics.rms,
    maximumInferenceMs: trace.maximumInferenceMs,
    maximumProcessingBacklogMs: trace.maximumProcessingBacklogMs,
    profiles: runs,
  };
}

function dynamicsRunFor(
  result: ListenDynamicsValidationCaseResult,
  profileId: ListenMatcherProfileId,
): ListenSequenceRunResult {
  const entry = result.profiles.find((profile) => profile.profileId === profileId);
  if (!entry) throw new Error(`${result.traceId} has no ${profileId} row.`);
  return entry.run;
}

function unsafeRun(run: ListenSequenceRunResult): boolean {
  return run.summary.falseAdvanceCount > 0 ||
    run.summary.skippedAdvanceCount > 0 ||
    run.summary.duplicateAdvanceCount > 0;
}

/** One grouping of scored rows, before any profile has been applied to it. */
export interface ListenDynamicsGroupDefinition {
  kind: ListenDynamicsGroupKind;
  key: string;
  label: string;
  suite: ListenDynamicsValidationSuite | null;
  piano: PianoId | null;
  layer: PianoLayerId | null;
  dynamicBand: ListenDynamicBand | null;
  articulation: ListenSequenceArticulation | null;
  cases: ListenDynamicsValidationCaseResult[];
}

/**
 * The groupings one renderer reports, from the whole scored corpus down to a
 * single velocity layer, mixed run, or articulation.
 *
 * The leaf levels are the point: an average over twenty layers can hide one
 * layer losing every advance, so each layer, each mixed run, and each
 * articulation is also reported on its own, where it is a clean single-partition
 * row.
 */
export function listenDynamicsValidationGroupDefinitions(
  cases: readonly ListenDynamicsValidationCaseResult[],
): ListenDynamicsGroupDefinition[] {
  const scored = cases.filter(({ scoreEligible }) => scoreEligible);
  const of = (predicate: (result: ListenDynamicsValidationCaseResult) => boolean) =>
    scored.filter(predicate);
  const partitions = [...new Set(scored.map(({ partition }) => partition))].sort();
  const suites = LISTEN_DYNAMICS_VALIDATION_SUITES
    .filter((suite) => scored.some((result) => result.suite === suite));
  const pianos = PIANO_IDS
    .filter((piano) => scored.some((result) => result.piano === piano && result.suite !== "articulation"));
  const definitions: ListenDynamicsGroupDefinition[] = [];
  const push = (
    kind: ListenDynamicsGroupKind,
    key: string,
    label: string,
    selected: ListenDynamicsValidationCaseResult[],
    dimensions: Partial<Omit<ListenDynamicsGroupDefinition, "kind" | "key" | "label" | "cases">> = {},
  ) => {
    if (selected.length === 0) return;
    definitions.push({
      kind,
      key,
      label,
      suite: dimensions.suite ?? null,
      piano: dimensions.piano ?? null,
      layer: dimensions.layer ?? null,
      dynamicBand: dimensions.dynamicBand ?? null,
      articulation: dimensions.articulation ?? null,
      cases: selected,
    });
  };
  push("corpus", "corpus", "All scored dynamics and articulation runs", [...scored]);
  for (const partition of partitions) {
    push("partition", `partition/${partition}`, `Partition ${partition}`, of(
      (result) => result.partition === partition,
    ));
  }
  for (const suite of suites) {
    push("suite", `suite/${suite}`, `Suite ${suite}`, of((result) => result.suite === suite), { suite });
  }
  for (const piano of pianos) {
    const name = pianoDefinition(piano).displayName;
    push("piano", `piano/${piano}`, name, of(
      (result) => result.piano === piano && result.suite !== "articulation",
    ), { piano });
    for (const partition of partitions) {
      push("piano-partition", `piano/${piano}/${partition}`, `${name} · ${partition}`, of(
        (result) => result.piano === piano &&
          result.suite !== "articulation" &&
          result.partition === partition,
      ), { piano });
    }
  }
  for (const result of scored.filter(({ suite }) => suite === "dynamics-constant")) {
    push("layer", `layer/${result.piano}/${result.layer}`, `${result.pianoName} ${result.layer}`, [result], {
      suite: "dynamics-constant",
      piano: result.piano,
      layer: result.layer,
      dynamicBand: result.dynamicBand,
    });
  }
  for (const result of scored.filter(({ suite }) => suite === "dynamics-mixed")) {
    push("mixed-run", `mixed/${result.piano}`, `${result.pianoName} crescendo-decrescendo`, [result], {
      suite: "dynamics-mixed",
      piano: result.piano,
    });
  }
  for (const result of scored.filter(({ suite }) => suite === "articulation")) {
    push("articulation", `articulation/${result.articulation}`, `Articulation ${result.articulation}`, [result], {
      suite: "articulation",
      articulation: result.articulation,
    });
  }
  return definitions;
}

/** One profile's view of one grouping, with the identities a delta names. */
interface DynamicsGroupColumn {
  definition: ListenDynamicsGroupDefinition;
  totals: ListenSequenceValidationTotals;
  completedTraceIds: Set<string>;
  orderedAdvancesByTraceId: Map<string, number>;
}

function dynamicsGroupColumn(
  definition: ListenDynamicsGroupDefinition,
  profileId: ListenMatcherProfileId,
): DynamicsGroupColumn {
  const runs = definition.cases.map((result) => dynamicsRunFor(result, profileId));
  return {
    definition,
    totals: listenSequenceValidationTotals(runs),
    completedTraceIds: new Set(definition.cases
      .filter((result) => dynamicsRunFor(result, profileId).summary.complete)
      .map(({ traceId }) => traceId)),
    orderedAdvancesByTraceId: new Map(definition.cases.map((result) => [
      result.traceId,
      dynamicsRunFor(result, profileId).summary.orderedAdvanceCount,
    ])),
  };
}

function dynamicsGroup(
  column: DynamicsGroupColumn,
  baseline: DynamicsGroupColumn | null,
): ListenDynamicsValidationGroup {
  const { definition } = column;
  const partitions = [...new Set(definition.cases.map(({ partition }) => partition))].sort();
  return {
    kind: definition.kind,
    key: definition.key,
    label: definition.label,
    suite: definition.suite,
    piano: definition.piano,
    pianoName: definition.piano === null ? null : pianoDefinition(definition.piano).displayName,
    layer: definition.layer,
    dynamicBand: definition.dynamicBand,
    articulation: definition.articulation,
    partitions,
    evidenceRole: listenValidationEvidenceRole(partitions),
    traceIds: definition.cases.map(({ traceId }) => traceId),
    totals: column.totals,
    deltaFromBaseline: baseline === null ? null : {
      ...sequenceMetricDelta(column.totals, baseline.totals),
      gainedCompletePassageTraceIds: [...column.completedTraceIds]
        .filter((id) => !baseline.completedTraceIds.has(id)).sort(),
      lostCompletePassageTraceIds: [...baseline.completedTraceIds]
        .filter((id) => !column.completedTraceIds.has(id)).sort(),
      regressedOrderedAdvanceTraceIds: [...column.orderedAdvancesByTraceId]
        .filter(([id, count]) => count < (baseline.orderedAdvancesByTraceId.get(id) ?? 0))
        .map(([id]) => id).sort(),
    },
  };
}

/**
 * Equal weight per piano over the scored dynamics rows.
 *
 * Salamander contributes sixteen constant layers and Splendid four, so summing
 * the runs would let one instrument decide the aggregate. The per-piano rates
 * are listed beside the mean, and each piano names its worst constant layer, so
 * an instrument or a layer that collapsed stays visible in the summary itself.
 */
export function listenDynamicsEqualPianoSummary(
  cases: readonly ListenDynamicsValidationCaseResult[],
  profileId: ListenMatcherProfileId,
  suite: Exclude<ListenDynamicsValidationSuite, "articulation">,
): ListenDynamicsEqualPianoSummary {
  const dynamics = cases.filter((result) => result.scoreEligible && result.suite === suite);
  const pianos = PIANO_IDS
    .filter((piano) => dynamics.some((result) => result.piano === piano))
    .map((piano): ListenDynamicsPianoRates => {
      const selected = dynamics.filter((result) => result.piano === piano);
      const totals = listenSequenceValidationTotals(
        selected.map((result) => dynamicsRunFor(result, profileId)),
      );
      const layers = selected
        .filter(({ suite }) => suite === "dynamics-constant")
        .map((result) => ({
          layer: result.layer,
          summary: dynamicsRunFor(result, profileId).summary,
        }))
        .sort((left, right) => (
          left.summary.orderedAdvanceRate - right.summary.orderedAdvanceRate ||
          left.summary.independentMatchRate - right.summary.independentMatchRate ||
          String(left.layer).localeCompare(String(right.layer))
        ));
      const partitions = [...new Set(selected.map(({ partition }) => partition))].sort();
      return {
        piano,
        pianoName: pianoDefinition(piano).displayName,
        runCount: selected.length,
        partitions,
        evidenceRole: listenValidationEvidenceRole(partitions),
        independentMatchRate: totals.independentMatchRate,
        orderedAdvanceRate: totals.orderedAdvanceRate,
        completePassageRate: totals.completePassageRate,
        worstLayer: layers[0]?.layer ?? null,
        worstLayerOrderedAdvanceRate: layers[0]?.summary.orderedAdvanceRate ?? null,
      };
    });
  const mean = (select: (rates: ListenDynamicsPianoRates) => number) => (pianos.length === 0
    ? null
    : pianos.reduce((total, rates) => total + select(rates), 0) / pianos.length);
  const partitions = [...new Set(dynamics.map(({ partition }) => partition))].sort();
  return {
    suite,
    pianoCount: pianos.length,
    partitions,
    evidenceRole: pianos.length === 0 ? null : listenValidationEvidenceRole(partitions),
    independentMatchRate: mean(({ independentMatchRate }) => independentMatchRate),
    orderedAdvanceRate: mean(({ orderedAdvanceRate }) => orderedAdvanceRate),
    completePassageRate: mean(({ completePassageRate }) => completePassageRate),
    pianos,
    worstPiano: [...pianos].sort((left, right) => (
      left.orderedAdvanceRate - right.orderedAdvanceRate ||
      left.independentMatchRate - right.independentMatchRate ||
      left.piano.localeCompare(right.piano)
    ))[0]?.piano ?? null,
  };
}

/**
 * Safety for one profile across every partition of this corpus.
 *
 * There is no dedicated safety family here, so an unsafe advance is judged
 * against `baseline-v1` on the identical trace — the rule the multi-domain
 * search used, and the only workable one on a corpus that contains a diagnosed
 * baseline event of its own. The committed regressions are replayed with the
 * same profile so a diagnosed case cannot be dropped from the verdict.
 */
export function listenDynamicsSafetySummary(
  cases: readonly ListenDynamicsValidationCaseResult[],
  profileId: ListenMatcherProfileId,
  profile: ListenMatcherThresholds,
): ListenDynamicsSafetySummary {
  const baselineId = LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID;
  const traceSafety = listenValidationTraceSafety(cases.map((result) => ({
    traceId: result.traceId,
    candidate: dynamicsRunFor(result, profileId),
    baseline: dynamicsRunFor(result, baselineId),
  })));
  const regressions = replayListenSafetyRegressions(profile, profileId);
  return {
    runCount: traceSafety.runCount,
    falseAdvanceCount: traceSafety.falseAdvanceCount,
    skippedAdvanceCount: traceSafety.skippedAdvanceCount,
    duplicateAdvanceCount: traceSafety.duplicateAdvanceCount,
    lateAdvanceCount: traceSafety.lateAdvanceCount,
    introducedUnsafeTraceIds: traceSafety.introducedUnsafeTraceIds,
    worsenedUnsafeTraceIds: traceSafety.worsenedUnsafeTraceIds,
    clearedUnsafeTraceIds: traceSafety.clearedUnsafeTraceIds,
    unsafeReasons: traceSafety.reasons,
    regressions,
    passed: traceSafety.passed && regressions.passed,
  };
}

function dynamicsRegressionCaseReport(
  result: ListenDynamicsValidationCaseResult,
): ListenDynamicsRegressionCaseReport {
  return {
    traceId: result.traceId,
    partition: result.partition,
    suite: result.suite,
    piano: result.piano,
    layer: result.layer,
    articulation: result.articulation,
    profiles: result.profiles.map(({ profileId, run }) => ({
      profileId,
      complete: run.summary.complete,
      orderedAdvanceCount: run.summary.orderedAdvanceCount,
      lateAdvanceCount: run.summary.lateAdvanceCount,
      falseAdvanceCount: run.summary.falseAdvanceCount,
      skippedAdvanceCount: run.summary.skippedAdvanceCount,
      duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
      lateAdvances: listenLateAdvanceForensics(result.traceId, run),
      unsafeAdvances: run.events
        .filter((event) => event.falseAdvance || event.skipped || event.duplicate)
        .map((event) => ({
          targetIndex: event.index,
          falseAdvance: event.falseAdvance,
          skipped: event.skipped,
          duplicate: event.duplicate,
          advancedAtMs: event.advancedAtMs,
        })),
    })),
  };
}

/**
 * Summarizes one renderer's dynamics and articulation matrix.
 *
 * Scoring follows the manifest's `scoreEligible` flag rather than a name spelled
 * here, so the diagnosed rows gate every column and contribute to no positive
 * metric, and every reported group carries the partitions it spans.
 */
export function summarizeListenDynamicsProfileValidation(
  rendererKey: ListenTraceRendererKey,
  renderer: ListenBenchmarkRendererConfiguration,
  cases: readonly ListenDynamicsValidationCaseResult[],
  profiles: readonly ListenValidationProfileIdentity[],
): ListenDynamicsRendererValidation {
  const baselineId = LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID;
  if (profiles.length === 0 || profiles[0].profileId !== baselineId) {
    throw new Error(`A dynamics validation summary must start from ${baselineId}.`);
  }
  for (const result of cases) {
    if (result.rendererKey !== rendererKey) {
      throw new Error(`${result.traceId} is not a ${rendererKey} trace.`);
    }
  }
  const scored = cases.filter(({ scoreEligible }) => scoreEligible);
  const regressionCases = cases.filter(({ scoreEligible }) => !scoreEligible);
  const definitions = listenDynamicsValidationGroupDefinitions(cases);
  const columns = profiles.map((identity) => ({
    identity,
    groups: definitions.map((definition) => dynamicsGroupColumn(definition, identity.profileId)),
    equalPiano: DYNAMICS_EQUAL_PIANO_SUITES
      .filter((suite) => cases.some((result) => result.scoreEligible && result.suite === suite))
      .map((suite) => listenDynamicsEqualPianoSummary(cases, identity.profileId, suite)),
    regressionTotals: listenSequenceValidationTotals(
      regressionCases.map((result) => dynamicsRunFor(result, identity.profileId)),
    ),
    safety: listenDynamicsSafetySummary(cases, identity.profileId, identity.profile),
    lateAdvances: cases.flatMap((result) => listenLateAdvanceForensics(
      result.traceId,
      dynamicsRunFor(result, identity.profileId),
    )),
  }));
  const baseline = columns[0];
  const summaries = columns.map((column): ListenDynamicsProfileValidationSummary => ({
    profileId: column.identity.profileId,
    profile: column.identity.profile,
    groups: column.groups.map((group, index) => dynamicsGroup(
      group,
      column === baseline ? null : baseline.groups[index],
    )),
    equalPiano: column.equalPiano,
    regressionTotals: column.regressionTotals,
    safety: column.safety,
    lateAdvances: column.lateAdvances,
    deltaFromBaseline: column === baseline ? null : {
      equalPiano: column.equalPiano.map((equal, index) => ({
        suite: equal.suite,
        independentMatchRate: rateDelta(
          equal.independentMatchRate,
          baseline.equalPiano[index].independentMatchRate,
        ),
        orderedAdvanceRate: rateDelta(
          equal.orderedAdvanceRate,
          baseline.equalPiano[index].orderedAdvanceRate,
        ),
        completePassageRate: rateDelta(
          equal.completePassageRate,
          baseline.equalPiano[index].completePassageRate,
        ),
      })),
      safety: {
        falseAdvanceCount: column.safety.falseAdvanceCount - baseline.safety.falseAdvanceCount,
        skippedAdvanceCount: column.safety.skippedAdvanceCount - baseline.safety.skippedAdvanceCount,
        duplicateAdvanceCount:
          column.safety.duplicateAdvanceCount - baseline.safety.duplicateAdvanceCount,
        lateAdvanceCount: column.safety.lateAdvanceCount - baseline.safety.lateAdvanceCount,
        regressionWorseThanBaselineCount: column.safety.regressions.worseThanBaselineCount -
          baseline.safety.regressions.worseThanBaselineCount,
      },
    },
  }));
  return {
    rendererKey,
    renderer: { ...renderer },
    caseCount: cases.length,
    scoredCaseCount: scored.length,
    regressionCaseCount: regressionCases.length,
    suites: LISTEN_DYNAMICS_VALIDATION_SUITES.filter((suite) => (
      cases.some((result) => result.suite === suite)
    )),
    pianos: PIANO_IDS.filter((piano) => cases.some((result) => result.piano === piano)),
    partitions: [...new Set(cases.map(({ partition }) => partition))].sort(),
    cases: [...cases],
    profiles: summaries,
    regressionCases: regressionCases.map(dynamicsRegressionCaseReport),
  };
}

function rateDelta(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null ? null : candidate - baseline;
}

/**
 * Captures the dynamics and articulation corpora once and replays the frozen
 * candidate matrix against every retained trace.
 *
 * The capture function is injected so unit tests drive the identical join,
 * matrix, aggregation, and parity path over deterministic synthetic traces, and
 * so a test can prove that one capture serves every profile column.
 */
export async function evaluateListenDynamicsProfileValidation(options: {
  capture: ListenDynamicsValidationCaptureFn;
  manifest?: ListenTraceManifest;
  candidateProfileIds?: readonly ListenMatcherProfileId[];
  rendererKeys?: readonly ListenTraceRendererKey[];
  suites?: readonly ListenDynamicsValidationSuite[];
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenDynamicsProfileValidationResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const onProgress = options.onProgress ?? (() => undefined);
  const profileIds = resolveListenValidationProfileIds(options.candidateProfileIds);
  const profiles = listenValidationProfileIdentities(profileIds);
  const rendererKeys = options.rendererKeys ?? ["direct", "tone"];
  const suites = options.suites ?? LISTEN_DYNAMICS_VALIDATION_SUITES;
  const validationCases = listenDynamicsValidationCases(manifest, rendererKeys, suites);
  if (validationCases.length === 0) {
    throw new Error("The manifest contains no dynamics or articulation traces to validate.");
  }
  const resultsByRenderer = new Map<ListenTraceRendererKey, ListenDynamicsValidationCaseResult[]>();
  for (let index = 0; index < validationCases.length; index += 1) {
    const validationCase = validationCases[index];
    const descriptor = validationCase.descriptor;
    const label = `${validationCase.pianoName} ${validationCase.layer ?? validationCase.dynamicProfile}`;
    onProgress(index, validationCases.length, `Capturing ${descriptor.id}`);
    const capture = await options.capture(validationCase);
    // The row is filed under the requested run's identity, so a capture that
    // answered with different audio would be reported as this run.
    if (capture.validationCase.descriptor.id !== descriptor.id) {
      throw new Error(`Capturing ${descriptor.id} returned ${capture.validationCase.descriptor.id}.`);
    }
    if (capture.trace.renderer.version !== descriptor.renderer) {
      throw new Error(
        `${descriptor.id} expects renderer ${descriptor.renderer}, but its capture used ` +
        `${capture.trace.renderer.version}.`,
      );
    }
    if (
      capture.sequence.definition.id !== validationCase.definition.id ||
      capture.trace.intervalMs !== validationCase.intervalMs
    ) {
      throw new Error(
        `${descriptor.id} expects ${validationCase.definition.id} at ${validationCase.intervalMs} ` +
        `ms, but its capture recognized ${capture.sequence.definition.id} at ` +
        `${capture.trace.intervalMs} ms.`,
      );
    }
    if (
      capture.captured.piano !== validationCase.piano ||
      capture.captured.layer !== validationCase.layer ||
      capture.captured.dynamicProfile !== validationCase.dynamicProfile
    ) {
      throw new Error(
        `${descriptor.id} expects ${validationCase.piano}/${String(validationCase.layer)} as a ` +
        `${validationCase.dynamicProfile} run, but its capture rendered ` +
        `${capture.captured.piano}/${String(capture.captured.layer)} as a ` +
        `${capture.captured.dynamicProfile} run.`,
      );
    }
    const caseResult = replayListenDynamicsProfileMatrix(capture, profiles);
    // The baseline column must reproduce the capture-time replay exactly. A
    // difference there means the harness changed, so no candidate comparison
    // built on this trace would be measuring the profile.
    assertListenSequenceRunParity(
      label,
      capture.baselineRun,
      dynamicsRunFor(caseResult, LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID),
    );
    const existing = resultsByRenderer.get(descriptor.rendererKey);
    if (existing) existing.push(caseResult);
    else resultsByRenderer.set(descriptor.rendererKey, [caseResult]);
    onProgress(index + 1, validationCases.length, `Replayed ${descriptor.id}`);
  }
  const renderers = rendererKeys
    .filter((key) => resultsByRenderer.has(key))
    .map((key) => summarizeListenDynamicsProfileValidation(
      key,
      RENDERER_BY_KEY[key],
      resultsByRenderer.get(key) ?? [],
      profiles,
    ));
  const scoredPartitions = [...new Set(validationCases
    .filter(({ scoreEligible }) => scoreEligible)
    .map(({ descriptor }) => descriptor.partition))];
  return {
    manifest: {
      version: manifest.version,
      hash: listenTraceManifestHash(manifest),
      corpusHash: listenTraceCorpusHash(manifest),
      traceCount: manifest.traces.length,
      dynamicsConstantTraceCount: listenTracesInSuite("dynamics-constant", manifest).length,
      dynamicsMixedTraceCount: listenTracesInSuite("dynamics-mixed", manifest).length,
      articulationTraceCount: listenTracesInSuite("articulation", manifest).length,
      capturedTraceCount: validationCases.length,
    },
    evidenceRole: listenValidationEvidenceRole(scoredPartitions),
    partitions: [...new Set(validationCases.map(({ descriptor }) => descriptor.partition))],
    suites: LISTEN_DYNAMICS_VALIDATION_SUITES.filter((suite) => suites.includes(suite)),
    baselineProfileId: LISTEN_PROFILE_VALIDATION_BASELINE_PROFILE_ID,
    candidateProfileIds: Object.freeze(profileIds.slice(1)),
    profiles,
    renderers,
    traceReuseVerified: true,
    baselineParityVerified: true,
  };
}

/** Runs the dynamics candidate matrix in the browser against one inference session. */
export function runListenDynamicsProfileValidation(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
  suites: readonly ListenDynamicsValidationSuite[] = LISTEN_DYNAMICS_VALIDATION_SUITES,
): Promise<ListenDynamicsProfileValidationResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenDynamicsProfileValidation({
    capture: (validationCase) => captureListenDynamicsValidationTrace(validationCase, session),
    rendererKeys,
    suites,
    onProgress,
  }));
}

/**
 * The exported shape of a dynamics and articulation validation run. Every run
 * keeps its decoded-structure hash, because that is what two fresh browser
 * processes must agree on, and every group keeps the partitions it spans, so no
 * number in the export can be quoted as confirmation without saying so.
 */
export function conciseListenDynamicsProfileValidationResult(
  result: ListenDynamicsProfileValidationResult,
) {
  return {
    manifest: result.manifest,
    evidenceRole: result.evidenceRole,
    partitions: result.partitions,
    suites: result.suites,
    baselineProfileId: result.baselineProfileId,
    candidateProfileIds: result.candidateProfileIds,
    profiles: result.profiles,
    traceReuseVerified: result.traceReuseVerified,
    baselineParityVerified: result.baselineParityVerified,
    renderers: result.renderers.map((renderer) => ({
      rendererKey: renderer.rendererKey,
      renderer: renderer.renderer,
      caseCount: renderer.caseCount,
      scoredCaseCount: renderer.scoredCaseCount,
      regressionCaseCount: renderer.regressionCaseCount,
      suites: renderer.suites,
      pianos: renderer.pianos,
      partitions: renderer.partitions,
      traceIdentities: renderer.cases.map((result) => ({
        traceId: result.traceId,
        partition: result.partition,
        piano: result.piano,
        layer: result.layer,
        articulation: result.articulation,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        pcmLength: result.pcmLength,
        peak: result.peak,
        rms: result.rms,
      })),
      profiles: renderer.profiles.map((profile) => ({
        profileId: profile.profileId,
        profile: profile.profile,
        groups: profile.groups,
        equalPiano: profile.equalPiano,
        regressionTotals: profile.regressionTotals,
        safety: {
          runCount: profile.safety.runCount,
          falseAdvanceCount: profile.safety.falseAdvanceCount,
          skippedAdvanceCount: profile.safety.skippedAdvanceCount,
          duplicateAdvanceCount: profile.safety.duplicateAdvanceCount,
          lateAdvanceCount: profile.safety.lateAdvanceCount,
          introducedUnsafeTraceIds: profile.safety.introducedUnsafeTraceIds,
          worsenedUnsafeTraceIds: profile.safety.worsenedUnsafeTraceIds,
          clearedUnsafeTraceIds: profile.safety.clearedUnsafeTraceIds,
          unsafeReasons: profile.safety.unsafeReasons,
          passed: profile.safety.passed,
          regressions: {
            fixtureCount: profile.safety.regressions.fixtureCount,
            deviationCount: profile.safety.regressions.deviationCount,
            worseThanBaselineCount: profile.safety.regressions.worseThanBaselineCount,
            passed: profile.safety.regressions.passed,
            outcomes: profile.safety.regressions.outcomes.map((outcome) => ({
              fixtureId: outcome.fixtureId,
              expectation: outcome.expectation,
              targetIndex: outcome.targetIndex,
              advanced: outcome.advanced,
              advancedAtMs: outcome.advancedAtMs,
              falseAdvance: outcome.falseAdvance,
              lateAdvance: outcome.lateAdvance,
              deviations: outcome.deviations,
              newlyUnsafeTargets: outcome.newlyUnsafeTargets,
              worseThanBaseline: outcome.worseThanBaseline,
            })),
          },
        },
        lateAdvances: profile.lateAdvances,
        deltaFromBaseline: profile.deltaFromBaseline,
      })),
      regressionCases: renderer.regressionCases,
      incompleteRuns: renderer.cases
        .filter((result) => result.scoreEligible && result.profiles
          .some(({ run }) => !run.summary.complete))
        .map((result) => ({
          traceId: result.traceId,
          partition: result.partition,
          piano: result.piano,
          layer: result.layer,
          articulation: result.articulation,
          profiles: result.profiles.map(({ profileId, run }) => ({
            profileId,
            complete: run.summary.complete,
            orderedAdvanceCount: run.summary.orderedAdvanceCount,
            independentMatchCount: run.summary.independentMatchCount,
            firstStallIndex: run.summary.firstStallIndex,
            primaryFailure: run.summary.firstStallIndex === null
              ? null
              : run.events[run.summary.firstStallIndex]?.primaryFailure ?? null,
          })),
        })),
      unsafeAdvances: renderer.cases
        .filter((result) => result.profiles.some(({ run }) => (
          run.summary.falseAdvanceCount > 0 ||
          run.summary.skippedAdvanceCount > 0 ||
          run.summary.duplicateAdvanceCount > 0
        )))
        .map((result) => ({
          traceId: result.traceId,
          partition: result.partition,
          piano: result.piano,
          layer: result.layer,
          profiles: result.profiles
            .filter(({ run }) => (
              run.summary.falseAdvanceCount > 0 ||
              run.summary.skippedAdvanceCount > 0 ||
              run.summary.duplicateAdvanceCount > 0
            ))
            .map(({ profileId, run }) => ({
              profileId,
              falseAdvanceCount: run.summary.falseAdvanceCount,
              skippedAdvanceCount: run.summary.skippedAdvanceCount,
              duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
              eventIndices: run.events
                .filter((event) => event.falseAdvance || event.skipped || event.duplicate)
                .map(({ index }) => index),
            })),
        })),
    })),
  };
}

/* ------------------------------------------------------------------------- *
 * The unified production-candidate gate
 * ------------------------------------------------------------------------- */

/**
 * The fourth part turns the three measured matrices into one eligibility
 * decision. It selects nothing and searches nothing: it applies the frozen
 * acceptance gates to the frozen candidates and, for every gate that failed,
 * reports a stable code, the domains involved, the baseline value, the
 * candidate value, and why the comparison failed.
 *
 * Three rules keep that decision honest, and they are why a gate carries a role
 * rather than only a verdict:
 *
 * - Safety gates apply across every partition. A false, skipped, duplicate, or
 *   incomplete-carried-bass advance is a rejection wherever it was measured,
 *   including on the discovery rows the search itself read.
 * - Release gates read `confirmation` rows only, so data a threshold was tuned
 *   on can never be quoted as evidence that the threshold generalizes.
 * - Everything else is `discovery-consistency`. It still rejects a regression —
 *   a candidate that loses recognition at 250 ms has lost it — but the label
 *   keeps a discovery number from being presented as held-out confirmation.
 *
 * Late advances are reported beside safety and never as safety: the diagnosed
 * `v05` case advances music the player did play, one repetition behind, and
 * rejecting an earlier correct recovery merely for deviating from `baseline-v1`
 * would reject an improvement.
 */

export type ListenProfileGateRole =
  | "replay-integrity"
  | "safety"
  | "release"
  | "discovery-consistency";

export type ListenProfileGateDomain =
  | "isolated"
  | "sequence"
  | "dynamics"
  | "regression"
  | "cross-domain";

/** The stable identity a failed gate is reported and tracked under. */
export type ListenProfileGateCode =
  | "replay-trace-reuse"
  | "replay-baseline-parity"
  | "safety-isolated-false-advance"
  | "safety-sequence-dedicated-families"
  | "safety-sequence-introduced-advance"
  | "safety-dynamics-introduced-advance"
  | "safety-committed-regression"
  | "release-isolated-recognition"
  | "release-isolated-course-clear"
  | "release-isolated-latency"
  | "release-dynamics-piano-recognition"
  | "release-dynamics-layer-loss"
  | "consistency-sequence-speed-recognition"
  | "consistency-sequence-ordered-progress"
  | "consistency-sequence-family-breadth"
  | "consistency-sequence-latency"
  | "consistency-dynamics-piano-recognition"
  | "consistency-dynamics-layer-loss";

export interface ListenProfileGateDefinition {
  code: ListenProfileGateCode;
  role: ListenProfileGateRole;
  domain: ListenProfileGateDomain;
  label: string;
  /** The rule as the automated acceptance gates state it. */
  requirement: string;
}

/**
 * Every gate, in report order. The list is frozen and always reported in full,
 * including the gates a partial run could not apply, so a narrowed command can
 * never look like a complete pass by omitting the gates it skipped.
 */
export const LISTEN_PROFILE_GATES: readonly ListenProfileGateDefinition[] = Object.freeze([
  Object.freeze({
    code: "replay-trace-reuse" as const,
    role: "replay-integrity" as const,
    domain: "cross-domain" as const,
    label: "One capture per run, replayed by every profile",
    requirement: "Within each captured run, all compared profiles use the identical PCM, " +
      "decoded trace, frame count, renderer, model, and target schedule.",
  }),
  Object.freeze({
    code: "replay-baseline-parity" as const,
    role: "replay-integrity" as const,
    domain: "cross-domain" as const,
    label: "Baseline replay is event-for-event identical",
    requirement: "Every baseline-v1 row reproduces its capture-time replay exactly.",
  }),
  Object.freeze({
    code: "safety-isolated-false-advance" as const,
    role: "safety" as const,
    domain: "isolated" as const,
    label: "No distinguishable false advance on the isolated corpus",
    requirement: "Dedicated distinguishable-wrong, extra-note, and omitted-bass fixtures never " +
      "advance. Ambiguous harmonic cases are reported separately and never hide one.",
  }),
  Object.freeze({
    code: "safety-sequence-dedicated-families" as const,
    role: "safety" as const,
    domain: "sequence" as const,
    label: "Dedicated safety families stay at zero at every speed",
    requirement: "False, skipped, duplicate, and incomplete-carried-bass counts remain zero at " +
      "every speed under both renderers. Fresh bass remains required.",
  }),
  Object.freeze({
    code: "safety-sequence-introduced-advance" as const,
    role: "safety" as const,
    domain: "sequence" as const,
    label: "No new unsafe advance in an ordinary passage",
    requirement: "No candidate adds a false, skipped, or duplicate advance to any sequence row " +
      "relative to baseline-v1 on the identical trace, including the scored passages that " +
      "belong to no dedicated safety family.",
  }),
  Object.freeze({
    code: "safety-dynamics-introduced-advance" as const,
    role: "safety" as const,
    domain: "dynamics" as const,
    label: "No new unsafe advance in a dynamics or articulation run",
    requirement: "No candidate adds a false, skipped, or duplicate advance to any dynamics or " +
      "articulation run relative to baseline-v1 on the identical trace.",
  }),
  Object.freeze({
    code: "safety-committed-regression" as const,
    role: "safety" as const,
    domain: "regression" as const,
    label: "The diagnosed regressions do not worsen",
    requirement: "The Tone plus Salamander v05 case keeps zero false, skipped, and duplicate " +
      "advances and stays a late-advance recovery; the Tone 333 ms false case does not worsen.",
  }),
  Object.freeze({
    code: "release-isolated-recognition" as const,
    role: "release" as const,
    domain: "isolated" as const,
    label: "Isolated correct advancement does not regress from baseline-v1",
    requirement: "On each renderer, the profile advances at least as many correct fixtures as " +
      "baseline-v1 on the identical frozen corpus. Absolute targets are reported separately as " +
      "product debt and do not grandfather the incumbent past a challenger-only floor.",
  }),
  Object.freeze({
    code: "release-isolated-course-clear" as const,
    role: "release" as const,
    domain: "isolated" as const,
    label: "Course Clear advancement does not regress from baseline-v1",
    requirement: "On each renderer, the profile advances at least as many correct Course Clear " +
      "fixtures as baseline-v1 on the identical frozen corpus. The 95% product target and the " +
      "incumbent's distance from it are reported without deciding eligibility.",
  }),
  Object.freeze({
    code: "release-isolated-latency" as const,
    role: "release" as const,
    domain: "isolated" as const,
    label: "P95 onset-to-advance latency stays inside its limit",
    requirement: "P95 remains below 400 ms for each renderer and does not materially regress " +
      "from its paired baseline.",
  }),
  Object.freeze({
    code: "release-dynamics-piano-recognition" as const,
    role: "release" as const,
    domain: "dynamics" as const,
    label: "Held-back renderer and piano recognition is preserved",
    requirement: "Each renderer and piano aggregate over confirmation rows preserves or improves " +
      "independent recognition.",
  }),
  Object.freeze({
    code: "release-dynamics-layer-loss" as const,
    role: "release" as const,
    domain: "dynamics" as const,
    label: "No held-back layer loses more than one independent event",
    requirement: "No individual confirmation layer, mixed run, or articulation loses more than " +
      "one independent event without an explicit reviewed explanation.",
  }),
  Object.freeze({
    code: "consistency-sequence-speed-recognition" as const,
    role: "discovery-consistency" as const,
    domain: "sequence" as const,
    label: "Independent recognition does not fall at any speed",
    requirement: "Independent recognition does not decrease at any speed under either renderer.",
  }),
  Object.freeze({
    code: "consistency-sequence-ordered-progress" as const,
    role: "discovery-consistency" as const,
    domain: "sequence" as const,
    label: "Ordered advances and complete passages hold per renderer",
    requirement: "Ordered advances and complete passages improve or remain equal under each " +
      "renderer separately; a Direct gain cannot hide a Tone regression.",
  }),
  Object.freeze({
    code: "consistency-sequence-family-breadth" as const,
    role: "discovery-consistency" as const,
    domain: "sequence" as const,
    label: "An improvement spans more than one sequence family",
    requirement: "Improvement, netted per family across both renderers, is present in more than " +
      "one sequence family, and at least one family whose ordered advances rose also recognized " +
      "more events independently, so the gain is not cascade amplification following one " +
      "recovered early event.",
  }),
  Object.freeze({
    code: "consistency-sequence-latency" as const,
    role: "discovery-consistency" as const,
    domain: "sequence" as const,
    label: "Continuous latency stays within existing limits",
    requirement: "The p95 ordered-advance latency does not materially regress from its paired " +
      "baseline under either renderer.",
  }),
  Object.freeze({
    code: "consistency-dynamics-piano-recognition" as const,
    role: "discovery-consistency" as const,
    domain: "dynamics" as const,
    label: "Discovery renderer and piano recognition is preserved",
    requirement: "Each renderer and piano aggregate over discovery rows preserves or improves " +
      "independent recognition.",
  }),
  Object.freeze({
    code: "consistency-dynamics-layer-loss" as const,
    role: "discovery-consistency" as const,
    domain: "dynamics" as const,
    label: "No discovery layer loses more than one independent event",
    requirement: "No individual discovery layer, mixed run, or articulation loses more than one " +
      "independent event without an explicit reviewed explanation.",
  }),
]);

const GATE_BY_CODE: ReadonlyMap<ListenProfileGateCode, ListenProfileGateDefinition> = new Map(
  LISTEN_PROFILE_GATES.map((definition) => [definition.code, definition]),
);

export function listenProfileGateDefinition(
  code: ListenProfileGateCode,
): ListenProfileGateDefinition {
  const definition = GATE_BY_CODE.get(code);
  if (!definition) throw new Error(`Unknown profile gate code ${String(code)}.`);
  return definition;
}

/**
 * The historical round-one isolated floors.
 *
 * The minimum counts remain only for verifying and re-scoring the frozen Task 13
 * archive. The two trial counts also remain the manifest-version-1 completeness
 * census used below; Task 25 replaces that census when it freezes manifest
 * version 2. None of these counts is a round-two eligibility threshold: paired
 * eligibility and rate-based product-debt targets live in
 * `listenProfileValidationPolicy.ts`.
 */
export const LISTEN_ISOLATED_RELEASE_GATE: Readonly<Record<ListenTraceRendererKey, Readonly<{
  correctTrialCount: number;
  minimumCorrectAdvances: number;
  courseClearCorrectTrialCount: number;
  minimumCourseClearAdvances: number;
}>>> = Object.freeze({
  direct: Object.freeze({
    correctTrialCount: 106,
    minimumCorrectAdvances: 104,
    courseClearCorrectTrialCount: 54,
    minimumCourseClearAdvances: 52,
  }),
  tone: Object.freeze({
    correctTrialCount: 106,
    minimumCorrectAdvances: 101,
    courseClearCorrectTrialCount: 54,
    minimumCourseClearAdvances: 52,
  }),
});

/** The fixed isolated latency ceiling, unchanged from the production gate. */
export const LISTEN_ISOLATED_LATENCY_LIMIT_MS = 400;

/**
 * What "materially regress" means for a latency percentile.
 *
 * One decoder hop is 512 samples at 16 kHz, so an advancement can only be
 * observed on a 32 ms grid. A p95 that moves by less than one hop has not moved
 * in anything the decoder can express; a p95 that moves by more has.
 */
export const LISTEN_LATENCY_REGRESSION_TOLERANCE_MS = 32;

/** Independent events one leaf row may lose before it needs a reviewed explanation. */
export const LISTEN_LAYER_INDEPENDENT_LOSS_ALLOWANCE = 1;

/** Sequence families an improvement must span before it counts as an improvement. */
export const LISTEN_FAMILY_BREADTH_MINIMUM = 2;

export type ListenProfileGateValue = number | string | boolean | null;

/** One reason one gate rejected one candidate. */
export interface ListenProfileGateFailure {
  code: ListenProfileGateCode;
  /** Renderers, speeds, pianos, layers, families, or trace IDs the failure is about. */
  domainIds: string[];
  baselineValue: ListenProfileGateValue;
  candidateValue: ListenProfileGateValue;
  explanation: string;
}

export interface ListenProfileGateOutcome {
  code: ListenProfileGateCode;
  role: ListenProfileGateRole;
  domain: ListenProfileGateDomain;
  label: string;
  requirement: string;
  /**
   * The partitions the rows behind this outcome came from, and the role that
   * makes. `evidenceRole` is null when the gate reads gating rows, which carry
   * no scored role at all.
   */
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole | null;
  /** False when this run did not measure the domain the gate needs. */
  applied: boolean;
  passed: boolean;
  failures: ListenProfileGateFailure[];
}

/**
 * Late-advance burden for one set of runs.
 *
 * Source distance is how many targets back the attack that actually moved the
 * playhead sits; attribution delay is how long after its own scheduled attack
 * the target finally advanced. Both are performance diagnostics reported beside
 * safety, never folded into it.
 */
export interface ListenLateAdvanceDiagnostics {
  lateAdvanceCount: number;
  records: ListenLateAdvanceForensicRecord[];
  meanSourceDistance: number | null;
  maximumSourceDistance: number | null;
  meanAttributionDelayMs: number | null;
  maximumAttributionDelayMs: number | null;
}

/** One leaf dynamics row that lost ground, reported whether or not it failed a gate. */
export interface ListenProfileLayerLoss {
  rendererKey: ListenTraceRendererKey;
  groupKey: string;
  label: string;
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole | null;
  independentMatchDelta: number;
  orderedAdvanceDelta: number;
  traceIds: string[];
  /** True when this loss was named as an explicit reviewed explanation. */
  reviewed: boolean;
}

/** Every safety count one candidate produced, across every partition. */
export interface ListenProfileCandidateSafetyCounts {
  isolatedDistinguishableFalseAdvances: number;
  /** Reported beside safety, never as safety. */
  isolatedAmbiguousAdvances: number;
  /** Every sequence row, not only the dedicated safety families. */
  sequenceFalseAdvances: number;
  sequenceSkippedAdvances: number;
  sequenceDuplicateAdvances: number;
  /** Defined against the carried-bass fixture, so scoped to that passage. */
  sequenceIncompleteCarriedBassAdvances: number;
  /** Sequence rows made unsafe relative to the baseline on the identical trace. */
  sequenceIntroducedUnsafeTraceIds: string[];
  sequenceWorsenedUnsafeTraceIds: string[];
  dynamicsIntroducedUnsafeTraceIds: string[];
  dynamicsWorsenedUnsafeTraceIds: string[];
  dynamicsClearedUnsafeTraceIds: string[];
  regressionWorseThanBaselineCount: number;
  /** Replays that no longer reproduce their pinned behavior. Reported, not gating. */
  regressionDeviationCount: number;
}

export type ListenProfileEligibility = "eligible" | "rejected" | "incomplete-evidence";

/** The round-two correctness and promotion decision beside the gate outcomes. */
export interface ListenProfilePolicyAssessment {
  /** Paired count comparisons that decide correctness eligibility. */
  pairedCorrectness: ListenPairedCorrectnessAssessment[];
  /** Absolute product targets and remaining debt; these never reject a profile. */
  recognitionTargets: ListenRecognitionTargetAssessment[];
  /** Every measured materiality axis, whether or not it reached its boundary. */
  materialImprovements: ListenMaterialImprovementAssessment[];
  materialImprovementMet: boolean;
  /** Required gates a run claiming completeness failed to apply. */
  unappliedRequiredGateCodes: ListenProfileGateCode[];
  /** Eligibility plus a predeclared material gain; the production default is still separate. */
  promotionEligible: boolean;
}

export interface ListenProfileCandidateGateReport {
  profileId: ListenMatcherProfileId;
  profile: ListenMatcherThresholds;
  gates: ListenProfileGateOutcome[];
  failedGateCodes: ListenProfileGateCode[];
  replayIntegrityFailureCount: number;
  safetyFailureCount: number;
  releaseFailureCount: number;
  discoveryConsistencyFailureCount: number;
  safety: ListenProfileCandidateSafetyCounts;
  /** Per domain, so a lag in one corpus is never averaged into another. */
  lateAdvance: {
    sequence: ListenLateAdvanceDiagnostics | null;
    dynamics: ListenLateAdvanceDiagnostics | null;
  };
  /** Every leaf dynamics loss, so no layer-level loss can vanish into an average. */
  layerLosses: ListenProfileLayerLoss[];
  /** Sequence passages that lost ordered advances, listed even when the gate passed. */
  regressedSequenceTraceIds: string[];
  policy: ListenProfilePolicyAssessment;
  eligibility: ListenProfileEligibility;
  eligible: boolean;
}

/** What one measured domain contributed, and the identity it must be reproduced under. */
/**
 * One profile column's complete discrete outcome on one captured trace.
 *
 * The unified export reports aggregates, safety identities, and gate results;
 * it deliberately leaves the per-fixture dumps to the three domain commands.
 * That left the confirmation comparison unable to see an outcome that moved
 * without moving a count — a target that advanced from a different attack, a
 * failure that changed classification, a passage that reached the same score by
 * a different route. Each row below closes that gap by carrying a digest of
 * every discrete outcome one profile produced on one trace, so two repetitions
 * are compared outcome by outcome and a mismatch names the trace and the
 * profile it happened under.
 */
export interface ListenProfileOutcomeIdentity {
  traceId: string;
  rendererKey: ListenTraceRendererKey;
  partition: ListenTracePartition;
  profileId: ListenMatcherProfileId;
  /**
   * FNV-1a over this profile's discrete outcome on this trace. The digest is
   * over the outcome alone, so two rows that produced the same outcome carry
   * the same value and the trace and profile they belong to stay beside it.
   */
  outcomeDigest: string;
}

export interface ListenProfileValidationDomainIdentity {
  domain: "isolated" | "sequence" | "dynamics";
  present: boolean;
  manifestVersion: number | null;
  manifestHash: string | null;
  manifestCorpusHash: string | null;
  capturedTraceCount: number;
  rendererKeys: ListenTraceRendererKey[];
  partitions: ListenTracePartition[];
  evidenceRole: ListenValidationEvidenceRole | null;
  traceReuseVerified: boolean;
  baselineParityVerified: boolean;
  /**
   * Every captured trace with the decoded-structure hash two fresh browser
   * processes must agree on, plus one digest over the whole list so a repetition
   * can be compared with a single value before being compared row by row.
   */
  traceIdentities: Array<{
    traceId: string;
    partition: ListenTracePartition;
    rendererKey: ListenTraceRendererKey;
    recognitionStructureHash: string;
    frameCount: number;
    /**
     * The raw PCM and trace hashes this process measured. They are required to
     * be present, so the archive records what was actually rendered and decoded,
     * and they are deliberately left out of `identityDigest` and out of the
     * canonical cross-process comparison, because Task 04 measured that neither
     * survives a fresh browser process.
     */
    processLocalPcmHash: string;
    processLocalTraceHash: string;
  }>;
  identityDigest: string;
  /**
   * Every captured trace crossed with every profile column, so the archive
   * literally contains each measured discrete outcome rather than only the
   * aggregates and failures computed from them. A complete run therefore holds
   * `capturedTraceCount` times the profile-column count rows.
   */
  outcomeIdentities: ListenProfileOutcomeIdentity[];
  /**
   * One digest over the whole outcome list, so a repetition can be compared
   * with a single value before being compared row by row. It is only
   * comparable with a run that measured the same traces under the same columns.
   */
  outcomeDigest: string;
}

export type ListenProfileGateRecommendationCode =
  | "eligible-candidates"
  | "no-safe-candidate"
  | "incomplete-evidence";

export interface ListenProfileValidationGateReport {
  /** The reviewed policy contract this run was evaluated under. */
  policyVersion: number;
  baselineProfileId: ListenMatcherProfileId;
  candidateProfileIds: readonly ListenMatcherProfileId[];
  /**
   * The profile registry these values came from. A stored calibration record or
   * an archived evidence file from another registry version describes different
   * profiles under the same identifiers, so the version is recorded with the
   * measurement rather than inferred from it afterwards.
   */
  registryVersion: number;
  /** The exact threshold values every row was measured under. */
  profiles: ListenValidationProfileIdentity[];
  gates: readonly ListenProfileGateDefinition[];
  domains: ListenProfileValidationDomainIdentity[];
  /**
   * True only when all three domains were measured, under both renderers, over
   * the complete frozen corpora. Eligibility requires it: a focused smoke may
   * reject a candidate but may never clear one.
   */
  evidenceComplete: boolean;
  incompleteEvidenceReasons: string[];
  /** Leaf losses the caller declared explicitly reviewed, echoed for the record. */
  reviewedLayerLosses: ListenReviewedLayerLoss[];
  /** The incumbent is judged by the same gate and product-debt machinery as challengers. */
  reference: ListenProfileCandidateGateReport;
  candidates: ListenProfileCandidateGateReport[];
  eligibleProfileIds: ListenMatcherProfileId[];
  promotableProfileIds: ListenMatcherProfileId[];
  recommendation: {
    code: ListenProfileGateRecommendationCode;
    eligibleProfileIds: ListenMatcherProfileId[];
    /** Eligible profiles that also clear the frozen material-improvement boundary. */
    promotableProfileIds: ListenMatcherProfileId[];
    explanation: string;
  };
}

/** FNV-1a over the joined identity text, so a repetition compares one value first. */
function identityDigest(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of parts.join(" ")) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The per-target outcome flags a second repetition has to reproduce.
 *
 * Every entry is a discrete classification the matcher reached, never a
 * confidence it reached it from: neither Chrome's offline rendering nor ONNX
 * Runtime is bit-stable across processes, which is why
 * `listenRecognitionStructureHash` excludes model confidences as well. Times
 * are frame timestamps and differences of them, so they are exactly as
 * reproducible as the decoded structure the two repetitions already agree on.
 */
const SEQUENCE_EVENT_OUTCOME_FLAGS: ReadonlyArray<
  readonly [string, (event: ListenSequenceEventDiagnostic) => boolean]
> = Object.freeze([
  ["R", (event) => event.allRequiredRawEvidencePresent],
  ["Q", (event) => event.thresholdQualified],
  ["M", (event) => event.independentlyMatched],
  ["O", (event) => event.orderedAdvanced],
  ["A", (event) => event.advanced],
  ["L", (event) => event.lateAdvance],
  ["F", (event) => event.falseAdvance],
  ["S", (event) => event.skipped],
  ["D", (event) => event.duplicate],
  ["X", (event) => event.missed],
  ["T", (event) => event.timedOut],
  ["B", (event) => event.blockedByPriorStall],
  ["N", (event) => event.nextAttackBeforeAdvance],
] satisfies ReadonlyArray<
  readonly [string, (event: ListenSequenceEventDiagnostic) => boolean]
>);

/**
 * The per-pitch outcome flags, which decide the event-level ones above.
 *
 * A target can reach the same verdict from a different set of pitches: one note
 * whose attack was detected where another's was carried, or a chord that
 * qualified on different members. Those are different musical outcomes that the
 * event-level reductions and every aggregate count report identically, so the
 * digest reads each expected pitch rather than only the conclusion drawn from
 * them. Confidences stay out for the same reason they stay out above.
 */
const EXPECTED_PITCH_OUTCOME_FLAGS: ReadonlyArray<
  readonly [string, (pitch: ExpectedPitchDiagnostic) => boolean]
> = Object.freeze([
  ["A", (pitch) => pitch.attackRequired],
  ["D", (pitch) => pitch.rawAttackDetected],
  ["P", (pitch) => pitch.rawOnsetProduced],
  ["Q", (pitch) => pitch.qualifyingOnset],
  ["R", (pitch) => pitch.requiredRawEvidencePresent],
  ["T", (pitch) => pitch.thresholdQualified],
] satisfies ReadonlyArray<readonly [string, (pitch: ExpectedPitchDiagnostic) => boolean]>);

/** A nullable outcome number, written so a null can never read as a zero. */
function outcomeField(value: number | null): string {
  return value === null ? "" : String(value);
}

/** One expected pitch's discrete outcome, in a fixed field order. */
function expectedPitchOutcomeToken(pitch: ExpectedPitchDiagnostic): string {
  return [
    pitch.midi,
    EXPECTED_PITCH_OUTCOME_FLAGS
      .filter(([, read]) => read(pitch))
      .map(([letter]) => letter)
      .join(""),
    pitch.requiredAttackType ?? "",
    pitch.observedAttackType ?? "",
    outcomeField(pitch.rawOnsetTimeMs),
    outcomeField(pitch.firstRawEvidenceTimeMs),
    outcomeField(pitch.firstThresholdQualifiedEvidenceTimeMs),
  ].join(":");
}

/** One target's complete discrete outcome, in a fixed field order. */
function sequenceEventOutcomeToken(event: ListenSequenceEventDiagnostic): string {
  return [
    event.index,
    SEQUENCE_EVENT_OUTCOME_FLAGS
      .filter(([, read]) => read(event))
      .map(([letter]) => letter)
      .join(""),
    outcomeField(event.firstRawEvidenceTimeMs),
    outcomeField(event.firstThresholdQualifiedEvidenceTimeMs),
    outcomeField(event.firstQualifyingPitchEvidenceTimeMs),
    outcomeField(event.independentMatchAtMs),
    outcomeField(event.orderedAdvancedAtMs),
    outcomeField(event.advancedAtMs),
    outcomeField(event.activeTargetIndexAtAttack),
    event.confidentUnexpectedPitches.join(","),
    event.unexpectedPitches.join(","),
    event.primaryFailure ?? "",
    event.rawFailureReasons.join(","),
    event.independentFailureReasons.join(","),
    event.orderedFailureReasons.join(","),
    event.failureReasons.join(","),
    event.expectedPitches.map(expectedPitchOutcomeToken).join("+"),
  ].join("|");
}

/**
 * The attribution half of a run's outcome: which physical attack the replay
 * credited each advancement to, and which target was armed when it arrived. A
 * passage that reaches the same score from different attacks has a different
 * outcome, and without these the digest could not tell the two apart.
 */
function sequenceAttackOutcomeToken(attack: ListenSequenceAttackDiagnostic): string {
  return [
    attack.index,
    outcomeField(attack.activeTargetIndexAtAttack),
    attack.advancementTargetIndices.join(","),
  ].join("|");
}

/** Every discrete outcome one profile produced on one passage or dynamics run. */
export function listenSequenceOutcomeSignature(run: ListenSequenceRunResult): string {
  return `${run.events.map(sequenceEventOutcomeToken).join(";")}` +
    `//${run.attacks.map(sequenceAttackOutcomeToken).join(";")}`;
}

/** Every discrete outcome one profile produced on one isolated fixture. */
export function listenIsolatedOutcomeSignature(outcome: ListenIsolatedProfileOutcome): string {
  return `${outcome.advanced ? "A" : ""}|${outcomeField(outcome.onsetToAdvanceMs)}`;
}

/** The digest one outcome identity row carries. Exported so a test can restate it. */
export function listenProfileOutcomeDigest(signature: string): string {
  return identityDigest([signature]);
}

/**
 * Late-advance burden, source distance, and attribution delay for a set of runs.
 *
 * The source attack is the physical attack the replay credited the advancement
 * to; for a late advance that is a later repetition of the same chord than the
 * target's own attack, so the distance says how far behind the playhead ran.
 */
export function listenLateAdvanceDiagnostics(
  entries: readonly { traceId: string; run: ListenSequenceRunResult }[],
): ListenLateAdvanceDiagnostics {
  const records = entries.flatMap(({ traceId, run }) => (
    listenLateAdvanceForensics(traceId, run)
  ));
  const distances = records.map(({ sourceToTargetDistance }) => sourceToTargetDistance);
  const delays = records.map(({ attributionDelayMs }) => attributionDelayMs);
  const mean = (values: readonly number[]) => values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
  return {
    lateAdvanceCount: records.length,
    records,
    meanSourceDistance: mean(distances),
    maximumSourceDistance: distances.length === 0 ? null : Math.max(...distances),
    meanAttributionDelayMs: mean(delays),
    maximumAttributionDelayMs: delays.length === 0 ? null : Math.max(...delays),
  };
}

/** One gate's accumulating state while a single candidate is evaluated. */
interface ListenProfileGateEntry {
  applied: boolean;
  partitions: Set<ListenTracePartition>;
  failures: ListenProfileGateFailure[];
}

/**
 * Collects one candidate's gate results.
 *
 * A gate must be applied before it can pass: an unapplied gate reports
 * `applied: false` and never contributes a pass, so a run that skipped a domain
 * cannot be read as having cleared that domain's gates.
 */
class ListenProfileGateBook {
  private readonly entries: Map<ListenProfileGateCode, ListenProfileGateEntry> = new Map(
    LISTEN_PROFILE_GATES.map(({ code }) => [
      code,
      { applied: false, partitions: new Set<ListenTracePartition>(), failures: [] },
    ]),
  );

  apply(code: ListenProfileGateCode, partitions: readonly ListenTracePartition[]): void {
    const entry = this.entry(code);
    entry.applied = true;
    for (const partition of partitions) entry.partitions.add(partition);
  }

  fail(code: ListenProfileGateCode, failure: Omit<ListenProfileGateFailure, "code">): void {
    const entry = this.entry(code);
    if (!entry.applied) {
      throw new Error(`Gate ${code} reported a failure before it was applied to any rows.`);
    }
    entry.failures.push({ code, ...failure });
  }

  outcomes(): ListenProfileGateOutcome[] {
    return LISTEN_PROFILE_GATES.map((definition): ListenProfileGateOutcome => {
      const entry = this.entry(definition.code);
      const partitions = [...entry.partitions].sort();
      return {
        code: definition.code,
        role: definition.role,
        domain: definition.domain,
        label: definition.label,
        requirement: definition.requirement,
        partitions,
        evidenceRole: gateEvidenceRole(partitions),
        applied: entry.applied,
        passed: entry.applied && entry.failures.length === 0,
        failures: entry.failures,
      };
    });
  }

  private entry(code: ListenProfileGateCode): ListenProfileGateEntry {
    const entry = this.entries.get(code);
    if (!entry) throw new Error(`Unknown profile gate code ${String(code)}.`);
    return entry;
  }
}

/**
 * The evidence role of the rows a gate read. Gating rows carry no scored role,
 * so a gate that reads them reports null rather than borrowing one.
 */
function gateEvidenceRole(
  partitions: readonly ListenTracePartition[],
): ListenValidationEvidenceRole | null {
  if (partitions.length === 0 || partitions.includes("regression-only")) return null;
  return listenValidationEvidenceRole(partitions);
}

function isolatedSummaryFor(
  renderer: ListenIsolatedRendererValidation,
  profileId: ListenMatcherProfileId,
): ListenIsolatedProfileValidationSummary {
  const summary = renderer.profiles.find((profile) => profile.profileId === profileId);
  if (!summary) throw new Error(`The isolated ${renderer.rendererKey} matrix has no ${profileId} row.`);
  return summary;
}

function sequenceSummaryFor(
  renderer: ListenSequenceRendererValidation,
  profileId: ListenMatcherProfileId,
): ListenSequenceProfileValidationSummary {
  const summary = renderer.profiles.find((profile) => profile.profileId === profileId);
  if (!summary) throw new Error(`The sequence ${renderer.rendererKey} matrix has no ${profileId} row.`);
  return summary;
}

function dynamicsSummaryFor(
  renderer: ListenDynamicsRendererValidation,
  profileId: ListenMatcherProfileId,
): ListenDynamicsProfileValidationSummary {
  const summary = renderer.profiles.find((profile) => profile.profileId === profileId);
  if (!summary) throw new Error(`The dynamics ${renderer.rendererKey} matrix has no ${profileId} row.`);
  return summary;
}

/** A zero delta lets the incumbent travel through the same gate code as its challengers. */
function sequenceDeltaAgainstBaseline(
  profile: ListenSequenceProfileValidationSummary,
  baseline: ListenSequenceProfileValidationSummary,
): ListenSequenceProfileDelta {
  return profile.deltaFromBaseline ?? {
    ...sequenceMetricDelta(profile.totals, baseline.totals),
    bySpeed: profile.bySpeed.map(({ intervalMs, totals }, index) => ({
      intervalMs,
      ...sequenceMetricDelta(totals, baseline.bySpeed[index].totals),
    })),
    byFamily: profile.byFamily.map(({ family, totals }, index) => ({
      family,
      ...sequenceMetricDelta(totals, baseline.byFamily[index].totals),
    })),
    safety: {
      falseAdvanceCount: profile.safety.falseAdvanceCount - baseline.safety.falseAdvanceCount,
      skippedAdvanceCount: profile.safety.skippedAdvanceCount - baseline.safety.skippedAdvanceCount,
      duplicateAdvanceCount:
        profile.safety.duplicateAdvanceCount - baseline.safety.duplicateAdvanceCount,
      lateAdvanceCount: profile.safety.lateAdvanceCount - baseline.safety.lateAdvanceCount,
      incompleteCarriedBassAdvances:
        profile.safety.incompleteCarriedBassAdvances - baseline.safety.incompleteCarriedBassAdvances,
    },
    gainedCompletePassageTraceIds: [],
    lostCompletePassageTraceIds: [],
    regressedOrderedAdvanceTraceIds: [],
  };
}

/** The baseline group's paired comparison is zero, not an absent correctness judgment. */
function dynamicsGroupDeltaAgainstBaseline(
  group: ListenDynamicsValidationGroup,
  baseline: ListenDynamicsValidationGroup,
): ListenDynamicsGroupDelta {
  return group.deltaFromBaseline ?? {
    ...sequenceMetricDelta(group.totals, baseline.totals),
    gainedCompletePassageTraceIds: [],
    lostCompletePassageTraceIds: [],
    regressedOrderedAdvanceTraceIds: [],
  };
}

function listenProfileUnsafeEventCount(
  profileId: ListenMatcherProfileId,
  results: ListenProfileValidationDomainResults,
): number {
  const isolated = results.isolated?.renderers.reduce((total, renderer) => (
    total + isolatedSummaryFor(renderer, profileId).summary.falseAdvanceCount
  ), 0) ?? 0;
  const sequence = results.sequence?.renderers.reduce((total, renderer) => {
    const profile = sequenceSummaryFor(renderer, profileId);
    return total + profile.totals.falseAdvanceCount + profile.totals.skippedAdvanceCount +
      profile.totals.duplicateAdvanceCount + profile.regressionTotals.falseAdvanceCount +
      profile.regressionTotals.skippedAdvanceCount + profile.regressionTotals.duplicateAdvanceCount;
  }, 0) ?? 0;
  const dynamics = results.dynamics?.renderers.reduce((total, renderer) => {
    const profile = dynamicsSummaryFor(renderer, profileId);
    return total + profile.safety.falseAdvanceCount + profile.safety.skippedAdvanceCount +
      profile.safety.duplicateAdvanceCount;
  }, 0) ?? 0;
  return isolated + sequence + dynamics;
}

/**
 * Applies all corpus-independent round-two policy calculations to one profile.
 * The manifest owns the censuses in the supplied results; this code owns only
 * rate comparisons and the frozen materiality boundaries.
 */
function listenProfilePolicyAssessment(
  profileId: ListenMatcherProfileId,
  baselineProfileId: ListenMatcherProfileId,
  results: ListenProfileValidationDomainResults,
  gates: readonly ListenProfileGateOutcome[],
  evidenceComplete: boolean,
): Omit<ListenProfilePolicyAssessment, "promotionEligible"> {
  const pairedCorrectness: ListenPairedCorrectnessAssessment[] = [];
  const recognitionTargets: ListenRecognitionTargetAssessment[] = [];
  const materialImprovements: ListenMaterialImprovementAssessment[] = [];

  for (const renderer of results.isolated?.renderers ?? []) {
    const profile = isolatedSummaryFor(renderer, profileId);
    const baseline = isolatedSummaryFor(renderer, baselineProfileId);
    const definitions = [
      {
        metric: "isolated-correct-advance-rate" as const,
        census: renderer.correctTrialCount,
        profileCount: profile.correctAdvanceCount,
        baselineCount: baseline.correctAdvanceCount,
      },
      {
        metric: "course-clear-correct-advance-rate" as const,
        census: baseline.courseClearCorrectTrialCount,
        profileCount: profile.courseClearAdvanceCount,
        baselineCount: baseline.courseClearAdvanceCount,
      },
    ];
    for (const definition of definitions) {
      pairedCorrectness.push(assessListenPairedCorrectness({
        rendererKey: renderer.rendererKey,
        ...definition,
      }));
      const frozenTarget = LISTEN_TRACE_MANIFEST_RECOGNITION_TARGET_COUNTS.find((target) => (
        target.rendererKey === renderer.rendererKey && target.metric === definition.metric
      ));
      if (!frozenTarget) {
        throw new Error(
          `Manifest v2 has no frozen ${renderer.rendererKey}/${definition.metric} target.`,
        );
      }
      // A focused run still participates in paired correctness, but it cannot
      // state full-corpus product debt. Only the measured frozen census may be
      // assessed against the manifest-owned absolute target.
      if (definition.census === frozenTarget.census) {
        const targetAssessment = assessListenRecognitionTarget({
          rendererKey: renderer.rendererKey,
          metric: definition.metric,
          census: definition.census,
          observedCount: definition.profileCount,
        });
        const reached = definition.profileCount >= frozenTarget.targetCount;
        recognitionTargets.push({
          ...targetAssessment,
          targetRate: frozenTarget.targetRate,
          census: frozenTarget.census,
          targetCount: frozenTarget.targetCount,
          reached,
          debtCount: Math.max(0, frozenTarget.targetCount - definition.profileCount),
          debtRate: Math.max(0, frozenTarget.targetRate - targetAssessment.observedRate),
        });
      }
      const baselineRate = definition.census === 0
        ? 0
        : definition.baselineCount / definition.census;
      const profileRate = definition.census === 0
        ? 0
        : definition.profileCount / definition.census;
      materialImprovements.push(assessListenMaterialRateGain(
        `isolated/${renderer.rendererKey}/${definition.metric}`,
        baselineRate,
        profileRate,
      ));
    }
    if (profile.summary.p95OnsetToAdvanceMs !== null &&
        baseline.summary.p95OnsetToAdvanceMs !== null) {
      materialImprovements.push(assessListenMaterialLatencyReduction(
        `isolated/${renderer.rendererKey}/p95-onset-to-advance-ms`,
        baseline.summary.p95OnsetToAdvanceMs,
        profile.summary.p95OnsetToAdvanceMs,
      ));
    }
  }

  for (const renderer of results.sequence?.renderers ?? []) {
    const profile = sequenceSummaryFor(renderer, profileId);
    const baseline = sequenceSummaryFor(renderer, baselineProfileId);
    for (const [metric, baselineRate, profileRate] of [
      ["independent-match-rate", baseline.totals.independentMatchRate,
        profile.totals.independentMatchRate],
      ["ordered-advance-rate", baseline.totals.orderedAdvanceRate,
        profile.totals.orderedAdvanceRate],
      ["complete-passage-rate", baseline.totals.completePassageRate,
        profile.totals.completePassageRate],
    ] as const) {
      materialImprovements.push(assessListenMaterialRateGain(
        `sequence/${renderer.rendererKey}/${metric}`,
        baselineRate,
        profileRate,
      ));
    }
    if (profile.totals.p95OrderedAdvanceLatencyMs !== null &&
        baseline.totals.p95OrderedAdvanceLatencyMs !== null) {
      materialImprovements.push(assessListenMaterialLatencyReduction(
        `sequence/${renderer.rendererKey}/p95-ordered-advance-ms`,
        baseline.totals.p95OrderedAdvanceLatencyMs,
        profile.totals.p95OrderedAdvanceLatencyMs,
      ));
    }
  }

  for (const renderer of results.dynamics?.renderers ?? []) {
    const profile = dynamicsSummaryFor(renderer, profileId);
    const baseline = dynamicsSummaryFor(renderer, baselineProfileId);
    for (const profileSuite of profile.equalPiano) {
      const baselineSuite = baseline.equalPiano.find(({ suite }) => suite === profileSuite.suite);
      if (!baselineSuite) continue;
      for (const [metric, baselineRate, profileRate] of [
        ["independent-match-rate", baselineSuite.independentMatchRate,
          profileSuite.independentMatchRate],
        ["ordered-advance-rate", baselineSuite.orderedAdvanceRate,
          profileSuite.orderedAdvanceRate],
        ["complete-passage-rate", baselineSuite.completePassageRate,
          profileSuite.completePassageRate],
      ] as const) {
        if (baselineRate === null || profileRate === null) continue;
        materialImprovements.push(assessListenMaterialRateGain(
          `dynamics/${renderer.rendererKey}/${profileSuite.suite}/${metric}`,
          baselineRate,
          profileRate,
        ));
      }
    }
  }

  materialImprovements.push(assessListenMaterialUnsafeEventReduction(
    "cross-domain/unsafe-event-count",
    listenProfileUnsafeEventCount(baselineProfileId, results),
    listenProfileUnsafeEventCount(profileId, results),
  ));
  const unapplied = unappliedRequiredListenGateCodes(evidenceComplete, gates)
    .map((code) => code as ListenProfileGateCode);
  return {
    pairedCorrectness,
    recognitionTargets,
    materialImprovements,
    materialImprovementMet: materialImprovements.some(({ material }) => material),
    unappliedRequiredGateCodes: unapplied,
  };
}

const DYNAMICS_LEAF_GROUP_KINDS: readonly ListenDynamicsGroupKind[] =
  Object.freeze(["layer", "mixed-run", "articulation"] as const);

/** The reviewed-loss key a leaf group is named by: renderer first, then group. */
export function listenProfileLayerLossKey(
  rendererKey: ListenTraceRendererKey,
  groupKey: string,
): string {
  return `${rendererKey}:${groupKey}`;
}

/**
 * One reviewed exception to the leaf-row loss allowance.
 *
 * The plan permits a row to lose more than the allowance only with an explicit
 * reviewed explanation, which means the waiver has to carry three things a bare
 * row name cannot. It names the candidate, because a loss reviewed for one
 * profile says nothing about another profile's loss on the same row. It records
 * the loss that was actually reviewed, because a waiver written against a
 * two-event loss must not excuse a five-event one. And it carries the
 * explanation itself, because "reviewed" with no reasoning recorded is
 * indistinguishable from "suppressed".
 */
export interface ListenReviewedLayerLoss {
  profileId: ListenMatcherProfileId;
  rendererKey: ListenTraceRendererKey;
  /** The leaf group key, as the dynamics matrix reports it. */
  groupKey: string;
  /**
   * The independent-recognition delta that was reviewed, as a negative number.
   * The waiver applies while the measured loss is no worse than this.
   */
  reviewedIndependentMatchDelta: number;
  /** Why this row's larger loss was accepted. */
  explanation: string;
}

/** The measured domains a gate report is built from. */
export interface ListenProfileValidationDomainResults {
  isolated?: ListenIsolatedProfileValidationResult | null;
  sequence?: ListenSequenceProfileValidationResult | null;
  dynamics?: ListenDynamicsProfileValidationResult | null;
}

function domainIdentity(
  domain: "isolated" | "sequence" | "dynamics",
  input: {
    partitions: ListenTracePartition[];
    rendererKeys: ListenTraceRendererKey[];
    manifest: { version: number; hash: string; corpusHash: string; capturedTraceCount: number };
    traceReuseVerified: boolean;
    baselineParityVerified: boolean;
    traceIdentities: ListenProfileValidationDomainIdentity["traceIdentities"];
    outcomeIdentities: ListenProfileOutcomeIdentity[];
  } | null,
): ListenProfileValidationDomainIdentity {
  if (input === null) {
    return {
      domain,
      present: false,
      manifestVersion: null,
      manifestHash: null,
      manifestCorpusHash: null,
      capturedTraceCount: 0,
      rendererKeys: [],
      partitions: [],
      evidenceRole: null,
      traceReuseVerified: false,
      baselineParityVerified: false,
      traceIdentities: [],
      identityDigest: identityDigest([]),
      outcomeIdentities: [],
      outcomeDigest: identityDigest([]),
    };
  }
  return {
    domain,
    present: true,
    manifestVersion: input.manifest.version,
    manifestHash: input.manifest.hash,
    manifestCorpusHash: input.manifest.corpusHash,
    capturedTraceCount: input.manifest.capturedTraceCount,
    rendererKeys: input.rendererKeys,
    partitions: input.partitions,
    evidenceRole: gateEvidenceRole(input.partitions),
    traceReuseVerified: input.traceReuseVerified,
    baselineParityVerified: input.baselineParityVerified,
    traceIdentities: input.traceIdentities,
    identityDigest: identityDigest(input.traceIdentities.map((identity) => (
      `${identity.traceId}:${identity.recognitionStructureHash}:${identity.frameCount}`
    ))),
    outcomeIdentities: input.outcomeIdentities,
    outcomeDigest: identityDigest(input.outcomeIdentities.map((identity) => (
      `${identity.traceId}:${identity.profileId}:${identity.outcomeDigest}`
    ))),
  };
}

function listenProfileValidationDomainIdentities(
  results: ListenProfileValidationDomainResults,
): ListenProfileValidationDomainIdentity[] {
  const { isolated, sequence, dynamics } = results;
  return [
    domainIdentity("isolated", !isolated ? null : {
      partitions: [...new Set(isolated.renderers.flatMap((renderer) => renderer.cases
        .map(({ partition }) => partition)))].sort(),
      rendererKeys: isolated.renderers.map(({ rendererKey }) => rendererKey),
      manifest: isolated.manifest,
      traceReuseVerified: isolated.traceReuseVerified,
      baselineParityVerified: isolated.baselineParityVerified,
      traceIdentities: isolated.renderers.flatMap((renderer) => renderer.cases.map((result) => ({
        traceId: result.traceId,
        partition: result.partition,
        rendererKey: renderer.rendererKey,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        processLocalPcmHash: result.processLocalPcmHash,
        processLocalTraceHash: result.processLocalTraceHash,
      }))),
      outcomeIdentities: isolated.renderers.flatMap((renderer) => renderer.cases
        .flatMap((result) => result.profiles.map((outcome) => ({
          traceId: result.traceId,
          rendererKey: renderer.rendererKey,
          partition: result.partition,
          profileId: outcome.profileId,
          outcomeDigest: listenProfileOutcomeDigest(listenIsolatedOutcomeSignature(outcome)),
        })))),
    }),
    domainIdentity("sequence", !sequence ? null : {
      partitions: [...new Set(sequence.renderers.flatMap((renderer) => renderer.cases
        .map(({ partition }) => partition)))].sort(),
      rendererKeys: sequence.renderers.map(({ rendererKey }) => rendererKey),
      manifest: sequence.manifest,
      traceReuseVerified: sequence.traceReuseVerified,
      baselineParityVerified: sequence.baselineParityVerified,
      traceIdentities: sequence.renderers.flatMap((renderer) => renderer.cases.map((result) => ({
        traceId: result.traceId,
        partition: result.partition,
        rendererKey: renderer.rendererKey,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        processLocalPcmHash: result.processLocalPcmHash,
        processLocalTraceHash: result.processLocalTraceHash,
      }))),
      outcomeIdentities: sequence.renderers.flatMap((renderer) => renderer.cases
        .flatMap((result) => result.profiles.map(({ profileId, run }) => ({
          traceId: result.traceId,
          rendererKey: renderer.rendererKey,
          partition: result.partition,
          profileId,
          outcomeDigest: listenProfileOutcomeDigest(listenSequenceOutcomeSignature(run)),
        })))),
    }),
    domainIdentity("dynamics", !dynamics ? null : {
      partitions: [...new Set(dynamics.renderers.flatMap((renderer) => renderer.cases
        .map(({ partition }) => partition)))].sort(),
      rendererKeys: dynamics.renderers.map(({ rendererKey }) => rendererKey),
      manifest: dynamics.manifest,
      traceReuseVerified: dynamics.traceReuseVerified,
      baselineParityVerified: dynamics.baselineParityVerified,
      traceIdentities: dynamics.renderers.flatMap((renderer) => renderer.cases.map((result) => ({
        traceId: result.traceId,
        partition: result.partition,
        rendererKey: renderer.rendererKey,
        recognitionStructureHash: result.recognitionStructureHash,
        frameCount: result.frameCount,
        processLocalPcmHash: result.processLocalPcmHash,
        processLocalTraceHash: result.processLocalTraceHash,
      }))),
      outcomeIdentities: dynamics.renderers.flatMap((renderer) => renderer.cases
        .flatMap((result) => result.profiles.map(({ profileId, run }) => ({
          traceId: result.traceId,
          rendererKey: renderer.rendererKey,
          partition: result.partition,
          profileId,
          outcomeDigest: listenProfileOutcomeDigest(listenSequenceOutcomeSignature(run)),
        })))),
    }),
  ];
}

/**
 * Why a run may reject a candidate but may never clear one.
 *
 * Completeness is checked against the frozen corpora rather than against what
 * the run happened to capture. These are version-1 corpus census checks, not
 * release thresholds: Task 25 replaces them with counts derived from manifest
 * version 2 while binding the policy's rates to that finalized census.
 */
function incompleteEvidenceReasons(results: ListenProfileValidationDomainResults): string[] {
  const { isolated, sequence, dynamics } = results;
  const reasons: string[] = [];
  const bothRenderers = (keys: readonly ListenTraceRendererKey[]) =>
    keys.includes("direct") && keys.includes("tone");
  if (!isolated) reasons.push("The isolated paired-correctness matrix was not measured.");
  else {
    if (!bothRenderers(isolated.renderers.map(({ rendererKey }) => rendererKey))) {
      reasons.push("The isolated matrix covered one renderer, and its floors are stated per renderer.");
    }
    for (const renderer of isolated.renderers) {
      const gate = LISTEN_ISOLATED_RELEASE_GATE[renderer.rendererKey];
      if (renderer.correctTrialCount !== gate.correctTrialCount) {
        reasons.push(
          `The isolated ${renderer.rendererKey} corpus holds ${renderer.correctTrialCount} correct ` +
          `fixtures, not the ${gate.correctTrialCount} the fixed floor is stated against.`,
        );
      }
      if (renderer.cases.some((row) => (
        row.expectedCorrect
          ? row.partition !== "discovery"
          : row.partition !== "regression-only"
      ))) {
        reasons.push(
          `The isolated ${renderer.rendererKey} corpus does not route correct rows to scored ` +
          "discovery and negative rows to non-scoring regression evidence.",
        );
      }
    }
  }
  if (!sequence) reasons.push("The continuous-sequence matrix was not measured.");
  else {
    if (!bothRenderers(sequence.renderers.map(({ rendererKey }) => rendererKey))) {
      reasons.push("The sequence matrix covered one renderer, and its gates are stated per renderer.");
    }
    for (const renderer of sequence.renderers) {
      if (renderer.intervalsMs.length !== LISTEN_SEQUENCE_INTERVALS_MS.length) {
        reasons.push(
          `The sequence ${renderer.rendererKey} matrix covered ${renderer.intervalsMs.length} of ` +
          `${LISTEN_SEQUENCE_INTERVALS_MS.length} corpus speeds.`,
        );
      }
    }
  }
  if (!dynamics) reasons.push("The dynamics and articulation matrix was not measured.");
  else {
    if (!bothRenderers(dynamics.renderers.map(({ rendererKey }) => rendererKey))) {
      reasons.push("The dynamics matrix covered one renderer, and its gates are stated per renderer.");
    }
    if (dynamics.suites.length !== LISTEN_DYNAMICS_VALIDATION_SUITES.length) {
      reasons.push(
        `The dynamics matrix covered ${dynamics.suites.length} of ` +
        `${LISTEN_DYNAMICS_VALIDATION_SUITES.length} suites.`,
      );
    }
  }
  return reasons;
}

/**
 * Checks that the measured domains describe one run of one frozen matrix.
 *
 * Gating an isolated matrix from one manifest against a dynamics matrix from
 * another would compare rows that never shared a corpus, and gating two runs
 * with different candidate columns would silently drop a candidate, so both are
 * refused here rather than produced as a report.
 */
function assertComparableDomains(results: ListenProfileValidationDomainResults): void {
  const present: Array<{
    domain: string;
    baselineProfileId: ListenMatcherProfileId;
    candidateProfileIds: readonly ListenMatcherProfileId[];
    manifest: { version: number; hash: string; corpusHash: string };
  }> = [];
  if (results.isolated) present.push({ domain: "isolated", ...results.isolated });
  if (results.sequence) present.push({ domain: "sequence", ...results.sequence });
  if (results.dynamics) present.push({ domain: "dynamics", ...results.dynamics });
  if (present.length === 0) {
    throw new Error("A gate report needs at least one measured validation domain.");
  }
  const [first, ...rest] = present;
  for (const other of rest) {
    if (other.baselineProfileId !== first.baselineProfileId) {
      throw new Error(
        `The ${other.domain} matrix compares against ${other.baselineProfileId} while the ` +
        `${first.domain} matrix compares against ${first.baselineProfileId}.`,
      );
    }
    if (
      other.candidateProfileIds.length !== first.candidateProfileIds.length ||
      other.candidateProfileIds.some((id, index) => id !== first.candidateProfileIds[index])
    ) {
      throw new Error(
        `The ${other.domain} matrix measured candidates ${other.candidateProfileIds.join(", ")} ` +
        `while the ${first.domain} matrix measured ${first.candidateProfileIds.join(", ")}.`,
      );
    }
    if (
      other.manifest.version !== first.manifest.version ||
      other.manifest.hash !== first.manifest.hash ||
      other.manifest.corpusHash !== first.manifest.corpusHash
    ) {
      throw new Error(
        `The ${other.domain} matrix used manifest ${other.manifest.version}/` +
        `${other.manifest.hash}/${other.manifest.corpusHash} while the ${first.domain} matrix ` +
        `used ${first.manifest.version}/${first.manifest.hash}/${first.manifest.corpusHash}.`,
      );
    }
  }
}

/**
 * Validates the reviewed-loss exceptions.
 *
 * A reviewed key excuses a leaf row from the layer-loss gate, so a mistyped key
 * would quietly stop excusing the row it was written for. Every key must name a
 * leaf group that the dynamics matrix actually reported.
 */
function resolveReviewedLayerLosses(
  reviewed: readonly ListenReviewedLayerLoss[],
  candidateProfileIds: readonly ListenMatcherProfileId[],
  dynamics: ListenDynamicsProfileValidationResult | null | undefined,
): Map<string, ListenReviewedLayerLoss> {
  const byKey = new Map<string, ListenReviewedLayerLoss>();
  if (reviewed.length === 0) return byKey;
  if (!dynamics) {
    throw new Error("Reviewed layer losses were declared, but no dynamics matrix was measured.");
  }
  const known = new Set(dynamics.renderers.flatMap((renderer) => renderer.profiles[0].groups
    .filter(({ kind }) => DYNAMICS_LEAF_GROUP_KINDS.includes(kind))
    .map(({ key }) => listenProfileLayerLossKey(renderer.rendererKey, key))));
  for (const entry of reviewed) {
    const rowKey = listenProfileLayerLossKey(entry.rendererKey, entry.groupKey);
    const key = `${entry.profileId}/${rowKey}`;
    if (byKey.has(key)) {
      throw new Error(`Reviewed layer loss ${key} was listed twice.`);
    }
    // A waiver for the baseline column or for a profile this run never measured
    // is a waiver that can never be checked against anything.
    if (!candidateProfileIds.includes(entry.profileId)) {
      throw new Error(
        `Reviewed layer loss ${key} names ${entry.profileId}, which is not a candidate in this ` +
        `matrix (${candidateProfileIds.join(", ")}).`,
      );
    }
    if (!known.has(rowKey)) {
      throw new Error(`Reviewed layer loss ${key} names no leaf row in this dynamics matrix.`);
    }
    if (!(entry.reviewedIndependentMatchDelta < 0)) {
      throw new Error(
        `Reviewed layer loss ${key} records a delta of ${entry.reviewedIndependentMatchDelta}, ` +
        "but a waiver exists to excuse a loss and must record a negative one.",
      );
    }
    if (entry.explanation.trim().length === 0) {
      throw new Error(`Reviewed layer loss ${key} carries no explanation.`);
    }
    byKey.set(key, entry);
  }
  return byKey;
}

/**
 * The committed regressions' contribution to the safety gate.
 *
 * Split out from the gate so both rejection branches can be exercised against
 * stated outcomes. Every registry profile currently passes these fixtures, so a
 * test driving the real replay could only ever prove the passing case, and the
 * branches that matter are the ones that reject.
 */
export function listenCommittedRegressionFailures(
  regressions: ListenSafetyRegressionSummary,
  profileId: ListenMatcherProfileId,
  baselineProfileId: ListenMatcherProfileId,
): Array<Omit<ListenProfileGateFailure, "code">> {
  const failures: Array<Omit<ListenProfileGateFailure, "code">> = [];
  for (const outcome of regressions.outcomes) {
    if (outcome.worseThanBaseline) {
      failures.push({
        domainIds: [outcome.fixtureId, ...outcome.newlyUnsafeTargets
          .map(({ targetIndex }) => `${outcome.fixtureId}#${targetIndex}`)],
        baselineValue: 0,
        candidateValue: outcome.newlyUnsafeTargets.length,
        explanation: `${profileId} made ${outcome.newlyUnsafeTargets.length} target(s) of ` +
          `${outcome.fixtureId} unsafe that ${baselineProfileId} did not. A diagnosed case may ` +
          "not worsen, and a failure that merely moves to another target is still a failure.",
      });
      continue;
    }
    // A pinned late advance is a recovery, not a safety event. It may move
    // earlier without being rejected, but it may never become unsafe.
    if (outcome.expectation !== "late-advance") continue;
    const unsafe = outcome.falseAdvance ||
      outcome.skippedAdvanceCount > 0 ||
      outcome.duplicateAdvanceCount > 0;
    if (!unsafe) continue;
    failures.push({
      domainIds: [outcome.fixtureId, `${outcome.fixtureId}#${outcome.targetIndex}`],
      baselineValue: 0,
      candidateValue: outcome.falseAdvanceCount + outcome.skippedAdvanceCount +
        outcome.duplicateAdvanceCount,
      explanation: `${outcome.fixtureId} is pinned as a late-advance recovery, but ${profileId} ` +
        "turned it into a false, skipped, or duplicate advance.",
    });
  }
  return failures;
}

function evaluateCandidateGates(
  identity: ListenValidationProfileIdentity,
  baselineProfileId: ListenMatcherProfileId,
  results: ListenProfileValidationDomainResults,
  reviewedLayerLosses: ReadonlyMap<string, ListenReviewedLayerLoss>,
  evidenceComplete: boolean,
): ListenProfileCandidateGateReport {
  const { isolated, sequence, dynamics } = results;
  const { profileId, profile } = identity;
  const book = new ListenProfileGateBook();
  const layerLosses: ListenProfileLayerLoss[] = [];
  const regressedSequenceTraceIds = new Set<string>();
  const safety: ListenProfileCandidateSafetyCounts = {
    isolatedDistinguishableFalseAdvances: 0,
    isolatedAmbiguousAdvances: 0,
    sequenceFalseAdvances: 0,
    sequenceSkippedAdvances: 0,
    sequenceDuplicateAdvances: 0,
    sequenceIncompleteCarriedBassAdvances: 0,
    sequenceIntroducedUnsafeTraceIds: [],
    sequenceWorsenedUnsafeTraceIds: [],
    dynamicsIntroducedUnsafeTraceIds: [],
    dynamicsWorsenedUnsafeTraceIds: [],
    dynamicsClearedUnsafeTraceIds: [],
    regressionWorseThanBaselineCount: 0,
    regressionDeviationCount: 0,
  };

  /* Replay integrity. Every measured domain must have replayed one capture per
   * run through every column, and reproduced its own baseline row exactly. */
  const identities = listenProfileValidationDomainIdentities(results);
  const measured = identities.filter(({ present }) => present);
  const replayPartitions = [...new Set(measured.flatMap(({ partitions }) => partitions))].sort();
  book.apply("replay-trace-reuse", replayPartitions);
  book.apply("replay-baseline-parity", replayPartitions);
  const reusedFailures = measured.filter(({ traceReuseVerified }) => !traceReuseVerified);
  if (reusedFailures.length > 0) {
    book.fail("replay-trace-reuse", {
      domainIds: reusedFailures.map(({ domain }) => domain),
      baselineValue: true,
      candidateValue: false,
      explanation: `The ${reusedFailures.map(({ domain }) => domain).join(" and ")} matrix did not ` +
        "confirm that every profile column replayed one retained capture, so a difference between " +
        "columns cannot be attributed to the matcher.",
    });
  }
  const parityFailures = measured.filter(({ baselineParityVerified }) => !baselineParityVerified);
  if (parityFailures.length > 0) {
    book.fail("replay-baseline-parity", {
      domainIds: parityFailures.map(({ domain }) => domain),
      baselineValue: true,
      candidateValue: false,
      explanation: `The ${parityFailures.map(({ domain }) => domain).join(" and ")} matrix did not ` +
        `reproduce its capture-time ${baselineProfileId} replay, so the harness moved and no ` +
        "candidate comparison built on it measures the profile.",
    });
  }

  /* The observed isolated corpus, paired against baseline-v1. */
  if (isolated) {
    for (const renderer of isolated.renderers) {
      const key = renderer.rendererKey;
      const candidate = isolatedSummaryFor(renderer, profileId);
      const baseline = isolatedSummaryFor(renderer, baselineProfileId);
      const partitions = [...new Set(renderer.cases.map(({ partition }) => partition))];
      const releasePartitions = [...new Set(renderer.cases
        .filter(({ expectedCorrect }) => expectedCorrect)
        .map(({ partition }) => partition))];
      safety.isolatedDistinguishableFalseAdvances += candidate.summary.falseAdvanceCount;
      safety.isolatedAmbiguousAdvances += candidate.summary.ambiguousAdvanceCount;

      book.apply("safety-isolated-false-advance", partitions);
      if (candidate.summary.falseAdvanceCount > 0) {
        // The ambiguous cases are excluded by construction: an octave-related
        // omission is classified ambiguous before it can reach this count, so
        // every fixture named here is one the matcher could have distinguished.
        const traceIds = renderer.cases
          .filter((result) => !result.expectedCorrect &&
            !result.mathematicallyAmbiguous &&
            outcomeFor(result, profileId).advanced)
          .map(({ traceId }) => traceId);
        book.fail("safety-isolated-false-advance", {
          domainIds: [key, ...traceIds],
          baselineValue: baseline.summary.falseAdvanceCount,
          candidateValue: candidate.summary.falseAdvanceCount,
          explanation: `${profileId} advanced ${candidate.summary.falseAdvanceCount} ` +
            `distinguishable-wrong ${key} fixture(s) (${traceIds.join(", ")}). A dedicated ` +
            "wrong-note, extra-note, or omitted-bass fixture must never advance.",
        });
      }

      // Round two uses paired correctness on the identical frozen corpus. The
      // absolute target is assessed separately below as product debt for both
      // this profile and the incumbent; it is not a challenger-only floor.
      const releasable = releasePartitions.length > 0;
      if (releasable) {
        book.apply("release-isolated-recognition", releasePartitions);
        if (candidate.correctAdvanceCount < baseline.correctAdvanceCount) {
          book.fail("release-isolated-recognition", {
            domainIds: [key, ...(candidate.deltaFromBaseline?.lostCorrectTraceIds ?? [])],
            baselineValue: baseline.correctAdvanceCount,
            candidateValue: candidate.correctAdvanceCount,
            explanation: `${profileId} advanced ${candidate.correctAdvanceCount} of ` +
              `${renderer.correctTrialCount} correct ${key} fixtures, below ${baselineProfileId}'s ` +
              `paired ${baseline.correctAdvanceCount} on the identical frozen corpus.`,
          });
        }
      }
      if (
        releasable &&
        candidate.courseClearCorrectTrialCount === baseline.courseClearCorrectTrialCount
      ) {
        book.apply("release-isolated-course-clear", releasePartitions);
        if (candidate.courseClearAdvanceCount < baseline.courseClearAdvanceCount) {
          book.fail("release-isolated-course-clear", {
            domainIds: [key],
            baselineValue: baseline.courseClearAdvanceCount,
            candidateValue: candidate.courseClearAdvanceCount,
            explanation: `${profileId} advanced ${candidate.courseClearAdvanceCount} of ` +
              `${candidate.courseClearCorrectTrialCount} correct Course Clear ${key} fixtures, ` +
              `below ${baselineProfileId}'s paired ${baseline.courseClearAdvanceCount} on the ` +
              "identical frozen corpus.",
          });
        }
      }
      if (releasable) {
        book.apply("release-isolated-latency", releasePartitions);
        const candidateP95 = candidate.summary.p95OnsetToAdvanceMs;
        const baselineP95 = baseline.summary.p95OnsetToAdvanceMs;
        if (candidateP95 === null) {
          book.fail("release-isolated-latency", {
            domainIds: [key],
            baselineValue: baselineP95,
            candidateValue: null,
            explanation: `${profileId} advanced no correct ${key} fixture, so it has no ` +
              "onset-to-advance percentile to compare against the 400 ms limit.",
          });
        } else if (candidateP95 >= LISTEN_ISOLATED_LATENCY_LIMIT_MS) {
          book.fail("release-isolated-latency", {
            domainIds: [key],
            baselineValue: baselineP95,
            candidateValue: candidateP95,
            explanation: `${profileId} reached a ${key} p95 onset-to-advance latency of ` +
              `${candidateP95} ms, at or above the ${LISTEN_ISOLATED_LATENCY_LIMIT_MS} ms limit.`,
          });
        } else if (
          baselineP95 !== null &&
          candidateP95 > baselineP95 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS
        ) {
          book.fail("release-isolated-latency", {
            domainIds: [key],
            baselineValue: baselineP95,
            candidateValue: candidateP95,
            explanation: `${profileId} raised the ${key} p95 onset-to-advance latency from ` +
              `${baselineP95} ms to ${candidateP95} ms, more than the ` +
              `${LISTEN_LATENCY_REGRESSION_TOLERANCE_MS} ms decoder hop that separates a moved ` +
              "percentile from an unmoved one.",
          });
        }
      }
    }
  }

  /* The continuous-sequence corpus, which the sweeps have already read. */
  let sequenceLateAdvance: ListenLateAdvanceDiagnostics | null = null;
  if (sequence) {
    const orderedNetByFamily = new Map<string, number>();
    const independentNetByFamily = new Map<string, number>();
    let orderedNetTotal = 0;
    let independentNetTotal = 0;
    const sequenceRuns: Array<{ traceId: string; run: ListenSequenceRunResult }> = [];
    for (const renderer of sequence.renderers) {
      const key = renderer.rendererKey;
      const candidate = sequenceSummaryFor(renderer, profileId);
      const baseline = sequenceSummaryFor(renderer, baselineProfileId);
      const delta = sequenceDeltaAgainstBaseline(candidate, baseline);
      sequenceRuns.push(...renderer.cases.map((result) => ({
        traceId: result.traceId,
        run: sequenceRunFor(result, profileId),
      })));
      // Counted over every row rather than over the dedicated families, so a
      // wrong advance in an ordinary passage — or a diagnosed one the candidate
      // reproduces unchanged — is never reported as a corpus without one.
      safety.sequenceFalseAdvances += candidate.traceSafety.falseAdvanceCount;
      safety.sequenceSkippedAdvances += candidate.traceSafety.skippedAdvanceCount;
      safety.sequenceDuplicateAdvances += candidate.traceSafety.duplicateAdvanceCount;
      // The carried-bass rule is defined against its own fixture, so this one
      // total stays with the summary that knows which passage that is.
      safety.sequenceIncompleteCarriedBassAdvances += candidate.safety.incompleteCarriedBassAdvances;
      for (const traceId of delta.regressedOrderedAdvanceTraceIds) {
        regressedSequenceTraceIds.add(traceId);
      }

      // The dedicated safety families gate rather than score, and they gate at
      // every speed: a profile that is safe on average is not safe.
      const partitions = [...new Set(renderer.cases.map(({ partition }) => partition))];
      const safetyPartitions = [...new Set(renderer.cases
        .filter(({ scoreEligible }) => !scoreEligible)
        .map(({ partition }) => partition))];
      book.apply("safety-sequence-dedicated-families", safetyPartitions);
      for (const speed of candidate.safety.speeds) {
        const classified: Array<[string, number]> = [
          ["false", speed.falseAdvanceCount],
          ["skipped", speed.skippedAdvanceCount],
          ["duplicate", speed.duplicateAdvanceCount],
          ["incomplete-carried-bass", speed.incompleteCarriedBassAdvances],
        ];
        const unsafe = classified.filter(([, count]) => count > 0);
        if (unsafe.length === 0) continue;
        const baselineSpeed = baseline.safety.speeds
          .find(({ intervalMs }) => intervalMs === speed.intervalMs);
        const total = unsafe.reduce((sum, [, count]) => sum + count, 0);
        book.fail("safety-sequence-dedicated-families", {
          domainIds: [`${key}@${speed.intervalMs.toFixed(2)}ms`],
          baselineValue: baselineSpeed === undefined
            ? null
            : baselineSpeed.falseAdvanceCount + baselineSpeed.skippedAdvanceCount +
              baselineSpeed.duplicateAdvanceCount + baselineSpeed.incompleteCarriedBassAdvances,
          candidateValue: total,
          explanation: `${profileId} produced ${unsafe.map(([label, count]) => `${count} ${label}`)
            .join(", ")} advance(s) in the dedicated ${key} safety families at ` +
            `${speed.intervalMs.toFixed(2)} ms. These counts must be zero at every speed.`,
        });
      }

      // Every row, not only the dedicated families: an ordinary passage can
      // advance a wrong target too, and the family-scoped summary never sees it.
      safety.sequenceIntroducedUnsafeTraceIds.push(
        ...candidate.traceSafety.introducedUnsafeTraceIds,
      );
      safety.sequenceWorsenedUnsafeTraceIds.push(...candidate.traceSafety.worsenedUnsafeTraceIds);
      book.apply("safety-sequence-introduced-advance", partitions);
      const unsafeTotal = (run: ListenSequenceRunResult) => run.summary.falseAdvanceCount +
        run.summary.skippedAdvanceCount + run.summary.duplicateAdvanceCount;
      for (const { traceId, reasons } of candidate.traceSafety.reasons) {
        const row = renderer.cases.find((result) => result.traceId === traceId);
        book.fail("safety-sequence-introduced-advance", {
          domainIds: [key, traceId],
          baselineValue: row ? unsafeTotal(sequenceRunFor(row, baselineProfileId)) : null,
          candidateValue: row ? unsafeTotal(sequenceRunFor(row, profileId)) : null,
          explanation: `${profileId} is less safe than ${baselineProfileId} on the identical ` +
            `${key} trace ${traceId}: ${reasons.join("; ")}.`,
        });
      }

      const scoredPartitions = [...new Set(renderer.cases
        .filter(({ scoreEligible }) => scoreEligible)
        .map(({ partition }) => partition))];
      book.apply("consistency-sequence-speed-recognition", scoredPartitions);
      for (const speed of delta.bySpeed) {
        if (speed.independentMatchCount >= 0) continue;
        const candidateSpeed = candidate.bySpeed
          .find(({ intervalMs }) => intervalMs === speed.intervalMs);
        const baselineSpeed = baseline.bySpeed
          .find(({ intervalMs }) => intervalMs === speed.intervalMs);
        book.fail("consistency-sequence-speed-recognition", {
          domainIds: [`${key}@${speed.intervalMs.toFixed(2)}ms`],
          baselineValue: baselineSpeed?.totals.independentMatchCount ?? null,
          candidateValue: candidateSpeed?.totals.independentMatchCount ?? null,
          explanation: `${profileId} lost ${Math.abs(speed.independentMatchCount)} independent ` +
            `recognition event(s) at ${speed.intervalMs.toFixed(2)} ms under ${key}. Independent ` +
            "recognition may not decrease at any speed.",
        });
      }

      book.apply("consistency-sequence-ordered-progress", scoredPartitions);
      if (delta.orderedAdvanceCount < 0) {
        book.fail("consistency-sequence-ordered-progress", {
          domainIds: [key, ...delta.regressedOrderedAdvanceTraceIds],
          baselineValue: baseline.totals.orderedAdvanceCount,
          candidateValue: candidate.totals.orderedAdvanceCount,
          explanation: `${profileId} lost ${Math.abs(delta.orderedAdvanceCount)} ordered advance(s) ` +
            `under ${key}. Ordered advancement must hold under each renderer separately, so a gain ` +
            "elsewhere cannot offset it.",
        });
      }
      if (delta.completePassageCount < 0) {
        book.fail("consistency-sequence-ordered-progress", {
          domainIds: [key, ...delta.lostCompletePassageTraceIds],
          baselineValue: baseline.totals.completePassageCount,
          candidateValue: candidate.totals.completePassageCount,
          explanation: `${profileId} completed ${Math.abs(delta.completePassageCount)} fewer ` +
            `passage(s) under ${key} (${delta.lostCompletePassageTraceIds.join(", ")}).`,
        });
      }

      book.apply("consistency-sequence-latency", scoredPartitions);
      const candidateP95 = candidate.totals.p95OrderedAdvanceLatencyMs;
      const baselineP95 = baseline.totals.p95OrderedAdvanceLatencyMs;
      if (
        candidateP95 !== null &&
        baselineP95 !== null &&
        candidateP95 > baselineP95 + LISTEN_LATENCY_REGRESSION_TOLERANCE_MS
      ) {
        book.fail("consistency-sequence-latency", {
          domainIds: [key],
          baselineValue: baselineP95,
          candidateValue: candidateP95,
          explanation: `${profileId} raised the ${key} p95 ordered-advance latency from ` +
            `${baselineP95} ms to ${candidateP95} ms, more than one ` +
            `${LISTEN_LATENCY_REGRESSION_TOLERANCE_MS} ms decoder hop.`,
        });
      }

      // Signed, so a family that gains under one renderer and loses the same
      // ground under the other nets out instead of counting as an improvement.
      orderedNetTotal += delta.orderedAdvanceCount;
      independentNetTotal += delta.independentMatchCount;
      for (const family of delta.byFamily) {
        orderedNetByFamily.set(
          family.family,
          (orderedNetByFamily.get(family.family) ?? 0) + family.orderedAdvanceCount,
        );
        independentNetByFamily.set(
          family.family,
          (independentNetByFamily.get(family.family) ?? 0) + family.independentMatchCount,
        );
      }
    }
    sequenceLateAdvance = listenLateAdvanceDiagnostics(sequenceRuns);

    /*
     * A claimed improvement must be broad, and it must be recognition rather
     * than propagation. Both tests read net per-family deltas summed across
     * renderers, because a family that gains under Direct and loses the same
     * ground under Tone has not improved anywhere.
     *
     * An improved family is one whose net ordered advances or net independent
     * recognition rose. The claim being tested is whichever of those the
     * candidate actually makes, so a candidate whose ordered progress is flat
     * but which recognizes more events is still held to the breadth rule.
     *
     * Cascade amplification is disproved by evidence in the same place as the
     * claim: at least one family whose ordered advances rose must also have
     * recognized more events independently. Independent recognition is measured
     * per event without regard to whether the playhead had reached it, so it
     * cannot be produced by an earlier recovery unblocking later targets. An
     * independent gain in some other family would not disprove anything about
     * the family whose ordered count moved, which is why the two sets are
     * intersected rather than merely both being non-empty.
     */
    const scoredPartitions = [...new Set(sequence.renderers.flatMap((renderer) => renderer.cases
      .filter(({ scoreEligible }) => scoreEligible)
      .map(({ partition }) => partition)))];
    book.apply("consistency-sequence-family-breadth", scoredPartitions);
    const orderedImprovedFamilies = [...orderedNetByFamily]
      .filter(([, net]) => net > 0).map(([family]) => family).sort();
    const independentImprovedFamilies = new Set([...independentNetByFamily]
      .filter(([, net]) => net > 0).map(([family]) => family));
    const improvedFamilies = [...new Set([
      ...orderedImprovedFamilies,
      ...independentImprovedFamilies,
    ])].sort();
    if (orderedNetTotal > 0 || independentNetTotal > 0) {
      if (improvedFamilies.length < LISTEN_FAMILY_BREADTH_MINIMUM) {
        book.fail("consistency-sequence-family-breadth", {
          domainIds: improvedFamilies,
          baselineValue: LISTEN_FAMILY_BREADTH_MINIMUM,
          candidateValue: improvedFamilies.length,
          explanation: `${profileId} improved on ${improvedFamilies.length} sequence family ` +
            `(${improvedFamilies.join(", ") || "none"}) once each family is netted across both ` +
            `renderers. An improvement must be present in more than one family.`,
        });
      }
      const corroborated = orderedImprovedFamilies
        .filter((family) => independentImprovedFamilies.has(family));
      if (orderedNetTotal > 0 && corroborated.length === 0) {
        book.fail("consistency-sequence-family-breadth", {
          domainIds: orderedImprovedFamilies,
          baselineValue: 1,
          candidateValue: 0,
          explanation: `${profileId} gained ${orderedNetTotal} ordered advance(s), but no family ` +
            `whose ordered advances rose (${orderedImprovedFamilies.join(", ") || "none"}) also ` +
            "recognized more events independently. The gain is therefore cascade amplification " +
            "following an earlier recovery rather than better recognition.",
        });
      }
    }
  }

  /* The dynamics and articulation corpora, which the manifest splits. */
  let dynamicsLateAdvance: ListenLateAdvanceDiagnostics | null = null;
  if (dynamics) {
    const dynamicsRuns: Array<{ traceId: string; run: ListenSequenceRunResult }> = [];
    for (const renderer of dynamics.renderers) {
      const key = renderer.rendererKey;
      const candidate = dynamicsSummaryFor(renderer, profileId);
      const baseline = dynamicsSummaryFor(renderer, baselineProfileId);
      dynamicsRuns.push(...renderer.cases.map((result) => ({
        traceId: result.traceId,
        run: dynamicsRunFor(result, profileId),
      })));
      safety.dynamicsIntroducedUnsafeTraceIds.push(...candidate.safety.introducedUnsafeTraceIds);
      safety.dynamicsWorsenedUnsafeTraceIds.push(...candidate.safety.worsenedUnsafeTraceIds);
      safety.dynamicsClearedUnsafeTraceIds.push(...candidate.safety.clearedUnsafeTraceIds);

      const partitions = [...new Set(renderer.cases.map(({ partition }) => partition))];
      book.apply("safety-dynamics-introduced-advance", partitions);
      // Every worsened row is named, including one the baseline already advanced
      // unsafely: a row that was unsafe before cannot become unsafe again, so
      // asking only whether it is unsafe would report an added event as no change.
      for (const { traceId, reasons } of candidate.safety.unsafeReasons) {
        const row = renderer.cases.find((result) => result.traceId === traceId);
        const unsafeTotal = (run: ListenSequenceRunResult) => run.summary.falseAdvanceCount +
          run.summary.skippedAdvanceCount + run.summary.duplicateAdvanceCount;
        book.fail("safety-dynamics-introduced-advance", {
          domainIds: [key, traceId],
          baselineValue: row ? unsafeTotal(dynamicsRunFor(row, baselineProfileId)) : null,
          candidateValue: row ? unsafeTotal(dynamicsRunFor(row, profileId)) : null,
          explanation: `${profileId} is less safe than ${baselineProfileId} on the identical ` +
            `${key} run ${traceId}: ${reasons.join("; ")}.`,
        });
      }

      for (const group of candidate.groups) {
        const baselineGroup = baseline.groups.find((entry) => entry.key === group.key);
        if (!baselineGroup) {
          throw new Error(`The dynamics ${key} baseline has no ${group.key} group.`);
        }
        const delta = dynamicsGroupDeltaAgainstBaseline(group, baselineGroup);
        // A group that spans both partitions is quoted by neither gate: the leaf
        // rows below it are single-partition and carry the same evidence.
        const code = group.evidenceRole === "confirmation"
          ? "release"
          : group.evidenceRole === "discovery"
          ? "consistency"
          : null;
        if (code === null) continue;
        if (group.kind === "piano-partition") {
          const gateCode = `${code}-dynamics-piano-recognition` as ListenProfileGateCode;
          book.apply(gateCode, group.partitions);
          if (delta.independentMatchCount < 0) {
            book.fail(gateCode, {
              domainIds: [key, group.key],
              baselineValue: baselineGroup?.totals.independentMatchCount ?? null,
              candidateValue: group.totals.independentMatchCount,
              explanation: `${profileId} lost ${Math.abs(delta.independentMatchCount)} independent ` +
                `recognition event(s) on ${group.label} under ${key}. Each renderer and piano ` +
                "aggregate must preserve or improve independent recognition.",
            });
          }
          continue;
        }
        if (!DYNAMICS_LEAF_GROUP_KINDS.includes(group.kind)) continue;
        const lossKey = listenProfileLayerLossKey(key, group.key);
        // A waiver excuses this candidate on this row, and only while the loss
        // stays within the one that was reviewed. A larger loss is a loss nobody
        // has looked at, whatever was written about the smaller one.
        const waiver = reviewedLayerLosses.get(`${profileId}/${lossKey}`);
        const reviewed = waiver !== undefined &&
          delta.independentMatchCount >= waiver.reviewedIndependentMatchDelta;
        if (delta.independentMatchCount < 0 || delta.orderedAdvanceCount < 0) {
          // Recorded whether or not it fails: an average must never be the only
          // place a single layer's loss appears.
          layerLosses.push({
            rendererKey: key,
            groupKey: group.key,
            label: group.label,
            partitions: group.partitions,
            evidenceRole: group.evidenceRole,
            independentMatchDelta: delta.independentMatchCount,
            orderedAdvanceDelta: delta.orderedAdvanceCount,
            traceIds: group.traceIds,
            reviewed,
          });
        }
        const gateCode = `${code}-dynamics-layer-loss` as ListenProfileGateCode;
        book.apply(gateCode, group.partitions);
        if (
          delta.independentMatchCount < -LISTEN_LAYER_INDEPENDENT_LOSS_ALLOWANCE &&
          !reviewed
        ) {
          book.fail(gateCode, {
            domainIds: [key, group.key, ...group.traceIds],
            baselineValue: baselineGroup?.totals.independentMatchCount ?? null,
            candidateValue: group.totals.independentMatchCount,
            explanation: `${profileId} lost ${Math.abs(delta.independentMatchCount)} independent ` +
              `recognition event(s) on ${group.label} under ${key}, more than the ` +
              `${LISTEN_LAYER_INDEPENDENT_LOSS_ALLOWANCE} a single row may lose without an ` +
              "explicit reviewed explanation" +
              (waiver
                ? `. The reviewed explanation for ${lossKey} covers a loss of ` +
                  `${waiver.reviewedIndependentMatchDelta}, which this loss exceeds.`
                : ` naming ${profileId} and ${lossKey}.`),
          });
        }
      }
    }
    dynamicsLateAdvance = listenLateAdvanceDiagnostics(dynamicsRuns);
  }

  /* The committed regressions, which are audio-free and always replayable. */
  const regressions = replayListenSafetyRegressions(profile, profileId);
  safety.regressionWorseThanBaselineCount = regressions.worseThanBaselineCount;
  safety.regressionDeviationCount = regressions.deviationCount;
  book.apply("safety-committed-regression", ["regression-only"]);
  for (const failure of listenCommittedRegressionFailures(
    regressions,
    profileId,
    baselineProfileId,
  )) {
    book.fail("safety-committed-regression", failure);
  }

  const gates = book.outcomes();
  const failed = gates.filter((gate) => gate.applied && !gate.passed);
  const policy = listenProfilePolicyAssessment(
    profileId,
    baselineProfileId,
    results,
    gates,
    evidenceComplete,
  );
  const pairedFailures = policy.pairedCorrectness.filter(({ passed }) => !passed);
  const blockingGateCodes = [...new Set([
    ...failed.map(({ code }) => code),
    ...policy.unappliedRequiredGateCodes,
  ])];
  const failuresIn = (role: ListenProfileGateRole) => failed
    .filter((gate) => gate.role === role)
    .reduce((total, gate) => total + gate.failures.length, 0);
  const eligibility: ListenProfileEligibility = failed.length > 0 ||
      pairedFailures.length > 0 || policy.unappliedRequiredGateCodes.length > 0
    ? "rejected"
    : evidenceComplete
    ? "eligible"
    : "incomplete-evidence";
  const eligible = eligibility === "eligible";
  return {
    profileId,
    profile,
    gates,
    failedGateCodes: blockingGateCodes,
    replayIntegrityFailureCount: failuresIn("replay-integrity"),
    safetyFailureCount: failuresIn("safety"),
    releaseFailureCount: failuresIn("release"),
    discoveryConsistencyFailureCount: failuresIn("discovery-consistency"),
    safety,
    lateAdvance: { sequence: sequenceLateAdvance, dynamics: dynamicsLateAdvance },
    layerLosses,
    regressedSequenceTraceIds: [...regressedSequenceTraceIds].sort(),
    policy: {
      ...policy,
      promotionEligible: eligible && policy.materialImprovementMet,
    },
    eligibility,
    eligible,
  };
}

/**
 * The one deterministic eligibility decision over the frozen candidate matrix.
 *
 * It reads measured results only. It selects no parameter value, ranks nothing,
 * and never touches the production default: its entire output is which frozen
 * candidates remain eligible and, for the rest, exactly which gate rejected them
 * on which rows.
 */
export function evaluateListenProfileValidationGates(
  input: ListenProfileValidationDomainResults & {
    /** Must equal the one policy implementation this build declares. */
    policyVersion?: number;
    /**
     * Leaf rows whose larger-than-allowed loss has an explicit reviewed
     * explanation. Each entry names the candidate it was reviewed for, the row,
     * the loss reviewed, and the reasoning. Every field is validated against the
     * measured matrix, so a stale or mistyped waiver fails loudly rather than
     * silently ceasing to excuse the row it was written for.
     *
     * The frozen confirmation run declares none: a waiver is a decision taken
     * after seeing a measured loss, which by definition cannot precede the run.
     */
    reviewedLayerLosses?: readonly ListenReviewedLayerLoss[];
  },
): ListenProfileValidationGateReport {
  assertValidListenProfileValidationPolicy(input.policyVersion === undefined
    ? LISTEN_PROFILE_VALIDATION_POLICY
    : { ...LISTEN_PROFILE_VALIDATION_POLICY, version: input.policyVersion });
  assertComparableDomains(input);
  const measuredReference = input.isolated ?? input.sequence ?? input.dynamics;
  if (!measuredReference) {
    throw new Error("A gate report needs at least one measured validation domain.");
  }
  const baselineProfileId = measuredReference.baselineProfileId;
  const candidateProfileIds = measuredReference.candidateProfileIds;
  const profiles = listenValidationProfileIdentities([baselineProfileId, ...candidateProfileIds]);
  const reviewedLayerLosses = resolveReviewedLayerLosses(
    input.reviewedLayerLosses ?? [],
    candidateProfileIds,
    input.dynamics,
  );
  const reasons = incompleteEvidenceReasons(input);
  const evidenceComplete = reasons.length === 0;
  const assessedProfiles = profiles.map((identity) => evaluateCandidateGates(
    identity,
    baselineProfileId,
    input,
    reviewedLayerLosses,
    evidenceComplete,
  ));
  const reference = assessedProfiles.find(({ profileId }) => profileId === baselineProfileId);
  if (!reference) throw new Error(`The policy report has no ${baselineProfileId} reference row.`);
  const candidates = assessedProfiles.filter(({ profileId }) => profileId !== baselineProfileId);
  const eligibleProfileIds = candidates
    .filter(({ eligible }) => eligible)
    .map(({ profileId }) => profileId);
  const promotableProfileIds = candidates
    .filter(({ policy }) => policy.promotionEligible)
    .map(({ profileId }) => profileId);
  const code: ListenProfileGateRecommendationCode = eligibleProfileIds.length > 0
    ? "eligible-candidates"
    : evidenceComplete
    ? "no-safe-candidate"
    : "incomplete-evidence";
  return {
    policyVersion: LISTEN_PROFILE_VALIDATION_POLICY.version,
    baselineProfileId,
    candidateProfileIds,
    registryVersion: LISTEN_MATCHER_REGISTRY_VERSION,
    profiles,
    gates: LISTEN_PROFILE_GATES,
    domains: listenProfileValidationDomainIdentities(input),
    evidenceComplete,
    incompleteEvidenceReasons: reasons,
    reviewedLayerLosses: [...reviewedLayerLosses.values()],
    reference,
    candidates,
    eligibleProfileIds,
    promotableProfileIds,
    recommendation: {
      code,
      eligibleProfileIds,
      promotableProfileIds,
      explanation: code === "eligible-candidates"
        ? promotableProfileIds.length > 0
          ? `${eligibleProfileIds.join(", ")} passed every required gate over the complete frozen ` +
            `matrix; ${promotableProfileIds.join(", ")} also met the versioned material-improvement ` +
            `boundary and may be considered for promotion. Selection remains a separate decision, ` +
            `and ${baselineProfileId} remains the production default until it is taken.`
          : `${eligibleProfileIds.join(", ")} passed every required gate over the complete frozen ` +
            `matrix, but none met the versioned material-improvement boundary. Parity is not a ` +
            `reason to change the default, so ${baselineProfileId} remains in production.`
        : code === "no-safe-candidate"
        ? `No frozen candidate passed every gate, so ${baselineProfileId} remains the production ` +
          "default. Each candidate's failed gate codes name the rows that rejected it."
        : "This run did not measure the complete frozen matrix, so it can reject a candidate but " +
          `cannot clear one: ${reasons.join(" ")}`,
    },
  };
}

/** Everything one unified validation command measured, and what it decided. */
export interface ListenProfileValidationResult {
  isolated: ListenIsolatedProfileValidationResult;
  sequence: ListenSequenceProfileValidationResult;
  dynamics: ListenDynamicsProfileValidationResult;
  gates: ListenProfileValidationGateReport;
}

/**
 * Measures all three domains against the frozen candidates and gates them once.
 *
 * The three matrices keep their own capture, parity, and identity rules; this
 * function only runs them in one pass and hands the results to the gate. It
 * therefore cannot reach a verdict the three separate commands would not, which
 * is the point: the unified command is the decision, not a fourth measurement.
 */
export async function evaluateListenProfileValidation(options: {
  captureIsolated: ListenIsolatedValidationCaptureFn;
  captureSequence: ListenSequenceValidationCaptureFn;
  captureDynamics: ListenDynamicsValidationCaptureFn;
  manifest?: ListenTraceManifest;
  candidateProfileIds?: readonly ListenMatcherProfileId[];
  rendererKeys?: readonly ListenTraceRendererKey[];
  intervalsMs?: readonly number[];
  suites?: readonly ListenDynamicsValidationSuite[];
  reviewedLayerLosses?: readonly ListenReviewedLayerLoss[];
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenProfileValidationResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const rendererKeys = options.rendererKeys ?? ["direct", "tone"];
  const suites = options.suites ?? LISTEN_DYNAMICS_VALIDATION_SUITES;
  const onProgress = options.onProgress ?? (() => undefined);
  // The corpora are joined before anything is captured, so the command reports
  // one honest total instead of restarting its progress three times.
  const isolatedCount = listenIsolatedValidationCases(manifest, rendererKeys).length;
  const sequenceCount = listenSequenceValidationCases(
    manifest,
    rendererKeys,
    options.intervalsMs,
  ).length;
  const dynamicsCount = listenDynamicsValidationCases(manifest, rendererKeys, suites).length;
  const total = isolatedCount + sequenceCount + dynamicsCount;
  const phase = (offset: number) => (completed: number, _total: number, label: string) =>
    onProgress(offset + completed, total, label);
  const isolated = await evaluateListenIsolatedProfileValidation({
    capture: options.captureIsolated,
    manifest,
    candidateProfileIds: options.candidateProfileIds,
    rendererKeys,
    onProgress: phase(0),
  });
  const sequence = await evaluateListenSequenceProfileValidation({
    capture: options.captureSequence,
    manifest,
    candidateProfileIds: options.candidateProfileIds,
    rendererKeys,
    intervalsMs: options.intervalsMs,
    onProgress: phase(isolatedCount),
  });
  const dynamics = await evaluateListenDynamicsProfileValidation({
    capture: options.captureDynamics,
    manifest,
    candidateProfileIds: options.candidateProfileIds,
    rendererKeys,
    suites,
    onProgress: phase(isolatedCount + sequenceCount),
  });
  return {
    isolated,
    sequence,
    dynamics,
    gates: evaluateListenProfileValidationGates({
      isolated,
      sequence,
      dynamics,
      reviewedLayerLosses: options.reviewedLayerLosses,
    }),
  };
}

/**
 * Runs the complete production-candidate matrix in the browser.
 *
 * All three corpora share one inference session, so the model is loaded once and
 * every trace in the run is decoded by the same one.
 */
export function runListenProfileValidation(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  rendererKeys: readonly ListenTraceRendererKey[] = ["direct", "tone"],
  intervalsMs?: readonly number[],
  suites: readonly ListenDynamicsValidationSuite[] = LISTEN_DYNAMICS_VALIDATION_SUITES,
): Promise<ListenProfileValidationResult> {
  return withOnlineAmtBenchmarkSession((session) => evaluateListenProfileValidation({
    captureIsolated: (validationCase) =>
      captureListenIsolatedValidationTrace(validationCase, session),
    captureSequence: (validationCase) =>
      captureListenSequenceValidationTrace(validationCase, session),
    captureDynamics: (validationCase) =>
      captureListenDynamicsValidationTrace(validationCase, session),
    rendererKeys,
    intervalsMs,
    suites,
    onProgress,
  }));
}

/**
 * The exported shape of a unified validation run.
 *
 * The gate report is exported whole, because it carries the domain identities,
 * the profile values, the safety counts, and every gate reason a release
 * decision has to quote. Beside it each domain contributes its per-profile
 * scores; the per-fixture dumps stay in the three domain commands, which is
 * where a diagnosis reads them.
 */
export function conciseListenProfileValidationResult(result: ListenProfileValidationResult) {
  return {
    gates: result.gates,
    isolated: {
      manifest: result.isolated.manifest,
      partitions: result.isolated.partitions,
      renderers: result.isolated.renderers.map((renderer) => ({
        rendererKey: renderer.rendererKey,
        renderer: renderer.renderer,
        caseCount: renderer.caseCount,
        correctTrialCount: renderer.correctTrialCount,
        profiles: renderer.profiles.map((profile) => ({
          profileId: profile.profileId,
          correctAdvanceCount: profile.correctAdvanceCount,
          courseClearCorrectTrialCount: profile.courseClearCorrectTrialCount,
          courseClearAdvanceCount: profile.courseClearAdvanceCount,
          distinguishableFalseAdvanceCount: profile.summary.falseAdvanceCount,
          ambiguousAdvanceCount: profile.summary.ambiguousAdvanceCount,
          p95OnsetToAdvanceMs: profile.summary.p95OnsetToAdvanceMs,
          acceptance: profile.summary.acceptance,
          byCaseKind: profile.byCaseKind,
          deltaFromBaseline: profile.deltaFromBaseline,
        })),
      })),
    },
    sequence: {
      manifest: result.sequence.manifest,
      evidenceRole: result.sequence.evidenceRole,
      partitions: result.sequence.partitions,
      renderers: result.sequence.renderers.map((renderer) => ({
        rendererKey: renderer.rendererKey,
        renderer: renderer.renderer,
        scoredCaseCount: renderer.scoredCaseCount,
        safetyCaseCount: renderer.safetyCaseCount,
        intervalsMs: renderer.intervalsMs,
        families: renderer.families,
        profiles: renderer.profiles.map((profile) => ({
          profileId: profile.profileId,
          totals: profile.totals,
          regressionTotals: profile.regressionTotals,
          bySpeed: profile.bySpeed,
          byFamily: profile.byFamily,
          safety: profile.safety,
          traceSafety: profile.traceSafety,
          lateAdvances: profile.lateAdvances,
          deltaFromBaseline: profile.deltaFromBaseline,
        })),
      })),
    },
    dynamics: {
      manifest: result.dynamics.manifest,
      evidenceRole: result.dynamics.evidenceRole,
      partitions: result.dynamics.partitions,
      suites: result.dynamics.suites,
      renderers: result.dynamics.renderers.map((renderer) => ({
        rendererKey: renderer.rendererKey,
        renderer: renderer.renderer,
        scoredCaseCount: renderer.scoredCaseCount,
        regressionCaseCount: renderer.regressionCaseCount,
        pianos: renderer.pianos,
        profiles: renderer.profiles.map((profile) => ({
          profileId: profile.profileId,
          groups: profile.groups,
          equalPiano: profile.equalPiano,
          regressionTotals: profile.regressionTotals,
          safety: {
            runCount: profile.safety.runCount,
            falseAdvanceCount: profile.safety.falseAdvanceCount,
            skippedAdvanceCount: profile.safety.skippedAdvanceCount,
            duplicateAdvanceCount: profile.safety.duplicateAdvanceCount,
            lateAdvanceCount: profile.safety.lateAdvanceCount,
            introducedUnsafeTraceIds: profile.safety.introducedUnsafeTraceIds,
            worsenedUnsafeTraceIds: profile.safety.worsenedUnsafeTraceIds,
            clearedUnsafeTraceIds: profile.safety.clearedUnsafeTraceIds,
            unsafeReasons: profile.safety.unsafeReasons,
            passed: profile.safety.passed,
          },
          lateAdvances: profile.lateAdvances,
          deltaFromBaseline: profile.deltaFromBaseline,
        })),
        regressionCases: renderer.regressionCases,
      })),
    },
  };
}
