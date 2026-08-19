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
 * sweeps have already read and which is therefore reported as `discovery`.
 *
 * Both parts share one capture rule: each fixture or passage is rendered and
 * recognized once, and every profile replays that one retained decoded trace, so
 * a candidate row can differ from the baseline row only because of the matcher.
 */

import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
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
import {
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  findListenMatcherProfile,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  LISTEN_TRACE_MANIFEST,
  assertValidListenTraceManifest,
  listenTraceManifestHash,
  listenTracesInSuite,
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
  replayListenSequenceTrace,
  summarizeListenSequenceSafety,
  withOnlineAmtBenchmarkSession,
  type ListenRecognitionTrace,
  type ListenSequenceAggregateSummary,
  type ListenSequenceDefinition,
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

function rendererForIsolatedTrace(
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
        renderer: rendererForIsolatedTrace(descriptor),
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
  safety: ListenSequenceSafetySummary;
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

function rendererForSequenceTrace(
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
        renderer: rendererForSequenceTrace(descriptor),
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
