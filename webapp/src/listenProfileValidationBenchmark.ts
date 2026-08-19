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
  type ListenRecognitionTrace,
  type ListenSequenceArticulation,
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
  /** Rows whose baseline unsafe advance this profile no longer produces. */
  clearedUnsafeTraceIds: string[];
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
    /** Each late advance with the moment the playhead actually moved. */
    lateAdvances: Array<{
      targetIndex: number;
      scheduledAttackTimeMs: number;
      advancedAtMs: number | null;
    }>;
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
  const runs = cases.map((result) => dynamicsRunFor(result, profileId));
  const total = (select: (run: ListenSequenceRunResult) => number) => runs
    .reduce((sum, run) => sum + select(run), 0);
  const introducedUnsafeTraceIds = cases
    .filter((result) => unsafeRun(dynamicsRunFor(result, profileId)) &&
      !unsafeRun(dynamicsRunFor(result, baselineId)))
    .map(({ traceId }) => traceId).sort();
  const clearedUnsafeTraceIds = cases
    .filter((result) => !unsafeRun(dynamicsRunFor(result, profileId)) &&
      unsafeRun(dynamicsRunFor(result, baselineId)))
    .map(({ traceId }) => traceId).sort();
  const regressions = replayListenSafetyRegressions(profile, profileId);
  return {
    runCount: runs.length,
    falseAdvanceCount: total((run) => run.summary.falseAdvanceCount),
    skippedAdvanceCount: total((run) => run.summary.skippedAdvanceCount),
    duplicateAdvanceCount: total((run) => run.summary.duplicateAdvanceCount),
    lateAdvanceCount: total((run) => run.summary.lateAdvanceCount),
    introducedUnsafeTraceIds,
    clearedUnsafeTraceIds,
    regressions,
    passed: introducedUnsafeTraceIds.length === 0 && regressions.passed,
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
      lateAdvances: run.events
        .filter((event) => event.lateAdvance)
        .map((event) => ({
          targetIndex: event.index,
          scheduledAttackTimeMs: event.scheduledAttackTimeMs,
          advancedAtMs: event.advancedAtMs,
        })),
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
          clearedUnsafeTraceIds: profile.safety.clearedUnsafeTraceIds,
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
