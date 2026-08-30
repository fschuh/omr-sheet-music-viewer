/**
 * The Task 22 measurement: what a bass-onset gate costs, and why the repeated
 * Course Clear chord is recognized late.
 *
 * One capture per manifest trace serves every profile column, exactly as the
 * candidate matrices do. Nothing here searches, ranks, or selects: the run
 * produces distributions, per-pitch qualification records, and the version-1
 * behaviour of sixteen named counterfactual profiles, and hands them to Task 24.
 *
 * The isolated corpus is `confirmation` evidence. It is read here as a
 * diagnosis, never as a selection input, and every row carries the partition it
 * came from so a later reader can see which is which.
 */

import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
  type ListenMatcherThresholds,
} from "../listenMatcherProfiles";
import {
  LISTEN_ACTIVE_TARGET_GATES,
  LISTEN_BASS_ONSET_GATES,
  LISTEN_COUNTERFACTUAL_PROFILE_IDS,
  listenArchivedDiscoveryVerdict,
  listenBassOnsetCensusByRenderer,
  listenCounterfactualProfiles,
  listenIsolatedBassOnsetObservation,
  listenIsolatedQualificationRecord,
  listenMatchedBassPairObservations,
  listenMatchedBassPairs,
  listenRepeatedChordAttackRecords,
  listenRepeatedChordRecoveries,
  listenSequenceBassOnsetObservations,
  observeListenSequenceQualification,
  type ListenArchivedDiscoveryVerdict,
  type ListenBassOnsetCensus,
  type ListenBassOnsetObservation,
  type ListenBassTraceIdentity,
  type ListenIsolatedQualificationRecord,
  type ListenRepeatedChordAttackRecord,
  type ListenRepeatedChordTargetRecovery,
} from "../listenBassQualification";
import {
  LISTEN_TRACE_MANIFEST,
  assertValidListenTraceManifest,
  listenTraceCorpusHash,
  listenTraceManifestHash,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
  type ListenTraceRendererKey,
} from "./listenTraceManifest";
import {
  captureListenMultiDomainTrace,
  type ListenMultiDomainCapture,
} from "./listenMatcherSweepBenchmark";
import {
  captureListenIsolatedValidationTrace,
  listenIsolatedValidationCases,
  type ListenIsolatedValidationCase,
} from "./listenProfileValidationBenchmark";
import {
  listenSafetyRegressionsIntroduced,
  replayListenSafetyRegressions,
  type ListenSafetyRegressionSummary,
} from "./listenSafetyRegression";
import {
  replayListenSequenceTrace,
  withOnlineAmtBenchmarkSession,
  type ListenRecognitionTrace,
  type ListenSequenceRunResult,
  type MaterializedListenSequence,
  type SequenceInferenceSession,
} from "./listenSequenceBenchmark";
import {
  listenRecognitionStructureHash,
  listenRecognitionTraceHash,
} from "./listenBaselineParity";
import {
  assertListenOmittedBassCaseReproduces,
  buildListenOmittedBassRegressionFixture,
  replayListenOmittedBassRegression,
  LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS,
  LISTEN_OMITTED_BASS_REGRESSION_FIXTURES,
  type ListenOmittedBassRegressionFixture,
  type ListenOmittedBassRegressionOutcome,
} from "./listenOmittedBassRegression";

/** The repeated Course Clear chord this round diagnoses. */
export const LISTEN_REPEATED_CHORD_PITCHES: readonly number[] = Object.freeze([62, 74, 82]);

/**
 * The three Tone plus Salamander runs where the repeated chord recurs. They span
 * three partitions on purpose: the diagnosis has to hold on the regression case
 * it was found in, on a held-back layer, and on a mixed-dynamics run.
 */
export const LISTEN_REPEATED_CHORD_TRACE_IDS: readonly string[] = Object.freeze([
  "dynamics-constant/tone/salamander/v05",
  "dynamics-constant/tone/salamander/v13",
  "dynamics-mixed/tone/salamander",
]);

/** The isolated fixtures pinned as omitted-bass regressions, per renderer. */
export const LISTEN_PINNED_OMITTED_BASS_TRACE_IDS: readonly string[] = Object.freeze([
  "isolated/direct/122",
  "isolated/tone/124",
]);

/** The profile every column is compared against. */
export const LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID: ListenMatcherProfileId = "baseline-v1";

/**
 * Profiles whose complete per-pitch qualification records are exported for the
 * repeated chord and the pinned omitted-bass trials: the incumbent, whose
 * behaviour is what ships, and the four frozen candidates, whose disagreement
 * with it is the measurement. Every other column is reported through its
 * outcomes rather than through a full decision record.
 */
export const LISTEN_REPEATED_CHORD_REPORTED_PROFILE_IDS: readonly ListenMatcherProfileId[] =
  Object.freeze([
    LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID,
    ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  ]);

export interface ListenBassQualificationProfileIdentity {
  profileId: string;
  role: "baseline" | "candidate" | "counterfactual";
  profile: ListenMatcherThresholds;
}

/**
 * The frozen column order: the incumbent, the four frozen `v2` candidates, and
 * the sixteen version-1 counterfactuals. No column is chosen from a result.
 */
export function listenBassQualificationProfiles(): ListenBassQualificationProfileIdentity[] {
  const counterfactuals = listenCounterfactualProfiles();
  const identities: ListenBassQualificationProfileIdentity[] = [
    {
      profileId: LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID,
      role: "baseline",
      profile: listenMatcherThresholds(
        LISTEN_MATCHER_PROFILES[LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID],
      ),
    },
    ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS.map((profileId) => ({
      profileId,
      role: "candidate" as const,
      profile: listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
    })),
    ...counterfactuals.map((profile) => ({
      profileId: profile.id,
      role: "counterfactual" as const,
      profile: listenMatcherThresholds(profile),
    })),
  ];
  const ids = identities.map(({ profileId }) => profileId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("The bass-qualification column order names the same profile twice.");
  }
  if (counterfactuals.length !== LISTEN_COUNTERFACTUAL_PROFILE_IDS.length) {
    throw new Error(
      `Expected ${LISTEN_COUNTERFACTUAL_PROFILE_IDS.length} counterfactual profiles, ` +
      `resolved ${counterfactuals.length}.`,
    );
  }
  return identities;
}

/* ------------------------------------------------------------------------- *
 * Corpus
 * ------------------------------------------------------------------------- */

/**
 * Every trace this measurement captures: the complete isolated corpus, every
 * `discovery` and `regression-only` continuous trace — the dedicated safety
 * families are what makes a profile's safety evidence complete — and the three
 * repeated-chord runs, one of which is held-back confirmation evidence. Naming
 * them by manifest identifier keeps the census honest about which partition each
 * number came from.
 */
export function listenBassQualificationTraces(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor[] {
  const continuousSuites = new Set([
    "sequence",
    "articulation",
    "dynamics-constant",
    "dynamics-mixed",
  ]);
  const selected = manifest.traces.filter((trace) => (
    trace.suite === "isolated" ||
    (
      continuousSuites.has(trace.suite) &&
      (trace.partition === "discovery" || trace.partition === "regression-only")
    ) ||
    LISTEN_REPEATED_CHORD_TRACE_IDS.includes(trace.id)
  ));
  for (const traceId of LISTEN_REPEATED_CHORD_TRACE_IDS) {
    if (!selected.some((trace) => trace.id === traceId)) {
      throw new Error(`The manifest has no repeated-chord run ${traceId}.`);
    }
  }
  for (const traceId of LISTEN_PINNED_OMITTED_BASS_TRACE_IDS) {
    if (!selected.some((trace) => trace.id === traceId)) {
      throw new Error(`The manifest has no omitted-bass fixture ${traceId}.`);
    }
  }
  return selected;
}

/** Named subsets a focused smoke may narrow the corpus to. */
export type ListenBassQualificationScope =
  | "isolated"
  | "continuous"
  | "repeated-chord"
  | "omitted-bass";

export const LISTEN_BASS_QUALIFICATION_SCOPES: readonly ListenBassQualificationScope[] =
  Object.freeze(["isolated", "continuous", "repeated-chord", "omitted-bass"]);

export function isListenBassQualificationScope(
  value: unknown,
): value is ListenBassQualificationScope {
  return typeof value === "string" &&
    (LISTEN_BASS_QUALIFICATION_SCOPES as readonly string[]).includes(value);
}

/**
 * A trace filter for a focused smoke. Narrowing is always reported through
 * `corpus.complete`, so a partial run can never be quoted as the measurement.
 */
export function listenBassQualificationScopeFilter(
  scopes: readonly ListenBassQualificationScope[],
): (descriptor: ListenTraceDescriptor) => boolean {
  if (scopes.length === 0) throw new Error("A focused bass-qualification smoke names no scope.");
  for (const scope of scopes) {
    if (!isListenBassQualificationScope(scope)) {
      throw new Error(`Unknown bass-qualification scope ${String(scope)}.`);
    }
  }
  const caseTraceIds = listenOmittedBassCaseTraceIds();
  return (descriptor) => scopes.some((scope) => (
    scope === "isolated"
      ? descriptor.suite === "isolated"
      : scope === "continuous"
      ? descriptor.suite !== "isolated"
      : scope === "repeated-chord"
      ? LISTEN_REPEATED_CHORD_TRACE_IDS.includes(descriptor.id)
      : caseTraceIds.includes(descriptor.id)
  ));
}

/** One captured trace, held only while every profile column reads it. */
export interface ListenBassQualificationCapture {
  descriptor: ListenTraceDescriptor;
  /** Present for continuous traces; isolated fixtures schedule a single attack. */
  sequence: MaterializedListenSequence | null;
  validationCase: ListenIsolatedValidationCase | null;
  trace: ListenRecognitionTrace;
  /** FNV identity of the decoded frames, re-checked after every column replays. */
  recognitionHash: string;
  recognitionStructureHash: string;
}

/**
 * The rendered audio's own FNV identity, taken from the signature the capture
 * path signs the PCM with before inference. A fixture records it as provenance,
 * so it has to be the PCM's hash and not the decoded trace's.
 */
function capturedPcmHash(capture: ListenBassQualificationCapture): string {
  const signature = capture.trace.audioSignature;
  if (!signature) {
    throw new Error(
      `${capture.descriptor.id} was captured without an audio signature, so no PCM identity ` +
      "can be recorded for a fixture cut from it.",
    );
  }
  return signature.pcmHash;
}

export type ListenBassQualificationCaptureFn = (
  descriptor: ListenTraceDescriptor,
) => Promise<ListenBassQualificationCapture>;

/* ------------------------------------------------------------------------- *
 * Per-profile evidence
 * ------------------------------------------------------------------------- */

/** One continuous trace made unsafe by a profile in a way the incumbent is not. */
export interface ListenBassSafetyRegressionRow {
  traceId: string;
  partition: string;
  targetIndex: number;
  classifications: string[];
}

/**
 * One profile's safety across the captured continuous corpus.
 *
 * Counts are kept per trace and per classification. A corpus total would let a
 * profile that clears one row's false advance while introducing another's look
 * unchanged, which is the regression most worth seeing.
 */
export interface ListenBassContinuousSafety {
  /** Dedicated safety families, which are held to zero absolutely. */
  dedicatedFalseAdvanceCount: number;
  dedicatedSkippedAdvanceCount: number;
  dedicatedDuplicateAdvanceCount: number;
  /** Every scored trace this profile makes unsafe where `baseline-v1` is not. */
  introducedRows: ListenBassSafetyRegressionRow[];
  /** Safety events the incumbent has here and this profile does not. */
  clearedRows: ListenBassSafetyRegressionRow[];
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  lateAdvanceCount: number;
  passed: boolean;
}

/** One profile's isolated behaviour under one renderer. */
export interface ListenBassIsolatedSummary {
  rendererKey: ListenTraceRendererKey;
  trialCount: number;
  correctTrialCount: number;
  correctAdvanceCount: number;
  gainedCorrectTraceIds: string[];
  lostCorrectTraceIds: string[];
  /** Omitted-bass fixtures this profile advances; `baseline-v1` advances none. */
  omittedBassAdvancedTraceIds: string[];
  distinguishableWrongAdvancedTraceIds: string[];
  ambiguousAdvancedCount: number;
}

export interface ListenBassQualificationProfileReport {
  profileId: string;
  role: "baseline" | "candidate" | "counterfactual";
  profile: ListenMatcherThresholds;
  /** Round one's recorded verdict, quoted for the sixteen counterfactuals only. */
  archivedDiscoveryVerdict: ListenArchivedDiscoveryVerdict | null;
  continuousSafety: ListenBassContinuousSafety;
  committedRegressions: ListenSafetyRegressionSummary;
  omittedBassRegressions: ListenOmittedBassRegressionOutcome[];
  isolated: ListenBassIsolatedSummary[];
  repeatedChordRecoveries: Array<{
    traceId: string;
    recoveries: ListenRepeatedChordTargetRecovery[];
  }>;
}

/* ------------------------------------------------------------------------- *
 * Result
 * ------------------------------------------------------------------------- */

export interface ListenBassQualificationTraceRow {
  traceId: string;
  partition: string;
  suite: string;
  rendererKey: ListenTraceRendererKey;
  renderer: string;
  recognitionStructureHash: string;
  frameCount: number;
}

export interface ListenOmittedBassCaseReport {
  traceId: string;
  /** Whether a committed fixture already pins this trial. */
  alreadyCommitted: boolean;
  rendererKey: ListenTraceRendererKey;
  targetPitches: number[];
  playedPitches: number[];
  bassMidi: number;
  recognitionStructureHash: string;
  /** The pinned fixture generated from this trial, ready to commit. */
  fixture: ListenOmittedBassRegressionFixture;
  /** Per-pitch qualification under the incumbent and each frozen candidate. */
  qualification: Array<{
    profileId: ListenMatcherProfileId;
    record: ListenIsolatedQualificationRecord;
  }>;
}

export interface ListenRepeatedChordRunReport {
  traceId: string;
  partition: string;
  rendererKey: ListenTraceRendererKey;
  piano: string | null;
  layer: string | null;
  recognitionStructureHash: string;
  /** Per-pitch records of every physical attack that played the repeated chord. */
  attacks: ListenRepeatedChordAttackRecord[];
  /**
   * The weakest sustained upper-voice evidence limiting the first physical
   * attack of the repeated chord, with zero recorded rather than dropped.
   */
  transitionLowestLimitingUpperVoiceEvidence: number | null;
}

export interface ListenBassQualificationResult {
  name: "listen-bass-qualification";
  /** This task measures; it selects nothing and changes no default. */
  selectsNothing: true;
  manifest: {
    version: number;
    hash: string;
    corpusHash: string;
    traceCount: number;
    capturedTraceCount: number;
  };
  /**
   * Whether every trace this measurement is defined over was captured. A
   * narrowed run reports less, never more: a distribution taken from part of the
   * corpus may not be quoted as the corpus distribution.
   */
  corpus: {
    complete: boolean;
    expectedTraceCount: number;
    missingTraceIds: string[];
  };
  baselineProfileId: ListenMatcherProfileId;
  profiles: ListenBassQualificationProfileIdentity[];
  gates: {
    onset: readonly number[];
    activeTarget: readonly number[];
    hallucinationCorridor: { lowerInclusive: number; upperExclusive: number };
  };
  traces: ListenBassQualificationTraceRow[];
  isolated: {
    /** The matched correct/omitted-bass pairs: the deciding set. */
    matchedPairCensus: ListenBassOnsetCensus[];
    /** Every isolated triad, matched or not, for context. */
    allTriadCensus: ListenBassOnsetCensus[];
    matchedPairs: Array<{
      targetPitches: number[];
      genuineTraceIds: string[];
      hallucinatedTraceIds: string[];
    }>;
    observations: ListenBassOnsetObservation[];
  };
  continuous: {
    census: ListenBassOnsetCensus[];
    censusBySuite: ListenBassOnsetCensus[];
    observations: ListenBassOnsetObservation[];
  };
  omittedBassCases: ListenOmittedBassCaseReport[];
  /** Cross-rendered counterparts, recorded as diagnostics rather than pinned. */
  crossRenderedOmittedBass: ListenOmittedBassCaseReport[];
  repeatedChord: {
    pitches: readonly number[];
    runs: ListenRepeatedChordRunReport[];
    /**
     * The minimum across `v05`, `v13`, and the mixed run of each run's weakest
     * limiting upper-voice evidence on the first attack of the repeated chord.
     * `null` when some run had no limiting upper voice at all, which is a
     * different fact from a zero and is never collapsed into one.
     */
    transitionUpperVoiceEvidenceMinimum: number | null;
    transitionUpperVoiceEvidenceByRun: Array<{ traceId: string; value: number | null }>;
    /**
     * The closest any measured column gets to recognizing the chord on the
     * attack that sounds it, per profile and per run. Source distance 0 is
     * full resolution; nothing in the version-1 grid is expected to reach it,
     * and stating it per run keeps one run's gain from covering another's loss.
     */
    bestSourceDistanceByProfile: Array<{
      profileId: string;
      role: "baseline" | "candidate" | "counterfactual";
      runs: Array<{ traceId: string; bestSourceDistance: number | null }>;
    }>;
    /**
     * Whether any active-target gate in the version-1 grid is low enough to
     * admit the weakest limiting upper voice on the first attack of the
     * repeated chord. When it is not, no scalar active gate can reach source
     * distance 0 on that run, whatever the onset gate does.
     */
    activeGateReachingTransition: {
      lowestMeasuredGate: number;
      byRun: Array<{
        traceId: string;
        limitingUpperVoiceEvidence: number | null;
        lowestGateThatWouldAdmitIt: number | null;
      }>;
      anyMeasuredGateAdmitsEveryRun: boolean;
    };
  };
  profileReports: ListenBassQualificationProfileReport[];
  /** True when every profile column was replayed from one capture per trace. */
  traceReuseVerified: boolean;
}

/* ------------------------------------------------------------------------- *
 * Evaluation
 * ------------------------------------------------------------------------- */

interface ProfileAccumulator {
  identity: ListenBassQualificationProfileIdentity;
  dedicatedFalseAdvanceCount: number;
  dedicatedSkippedAdvanceCount: number;
  dedicatedDuplicateAdvanceCount: number;
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  lateAdvanceCount: number;
  introducedRows: ListenBassSafetyRegressionRow[];
  clearedRows: ListenBassSafetyRegressionRow[];
  isolated: Map<ListenTraceRendererKey, ListenBassIsolatedSummary>;
  repeatedChordRecoveries: Array<{
    traceId: string;
    recoveries: ListenRepeatedChordTargetRecovery[];
  }>;
}

function emptyIsolatedSummary(rendererKey: ListenTraceRendererKey): ListenBassIsolatedSummary {
  return {
    rendererKey,
    trialCount: 0,
    correctTrialCount: 0,
    correctAdvanceCount: 0,
    gainedCorrectTraceIds: [],
    lostCorrectTraceIds: [],
    omittedBassAdvancedTraceIds: [],
    distinguishableWrongAdvancedTraceIds: [],
    ambiguousAdvancedCount: 0,
  };
}

function counterpartTraceId(traceId: string): string {
  const parts = traceId.split("/");
  if (parts.length !== 3 || parts[0] !== "isolated") {
    throw new Error(`${traceId} is not an isolated trace identifier.`);
  }
  return `isolated/${parts[1] === "direct" ? "tone" : "direct"}/${parts[2]}`;
}

/** The isolated trials whose per-pitch qualification this run records in full. */
export function listenOmittedBassCaseTraceIds(): string[] {
  return [
    ...LISTEN_PINNED_OMITTED_BASS_TRACE_IDS,
    ...LISTEN_PINNED_OMITTED_BASS_TRACE_IDS.map(counterpartTraceId),
  ];
}

export async function evaluateListenBassQualification(options: {
  capture: ListenBassQualificationCaptureFn;
  manifest?: ListenTraceManifest;
  /** Narrows the corpus for a focused smoke. A narrowed run reports less, never more. */
  traceFilter?: (descriptor: ListenTraceDescriptor) => boolean;
  /**
   * Committed omitted-bass regressions a captured trial is re-verified against.
   * Defaults to the committed list; a caller passes an explicit list only to
   * measure a trial no fixture pins yet.
   */
  omittedBassFixtures?: readonly ListenOmittedBassRegressionFixture[];
  onProgress?: (completed: number, total: number, label: string) => void;
}): Promise<ListenBassQualificationResult> {
  const manifest = options.manifest ?? LISTEN_TRACE_MANIFEST;
  assertValidListenTraceManifest(manifest);
  const onProgress = options.onProgress ?? (() => undefined);
  const profiles = listenBassQualificationProfiles();
  const baseline = profiles[0];
  const omittedBassFixtures = options.omittedBassFixtures ??
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURES;
  const corpus = listenBassQualificationTraces(manifest);
  const descriptors = corpus.filter((descriptor) => options.traceFilter?.(descriptor) ?? true);
  if (descriptors.length === 0) {
    throw new Error("The bass-qualification corpus selected no traces.");
  }
  const accumulators = new Map<string, ProfileAccumulator>(profiles.map((identity) => [
    identity.profileId,
    {
      identity,
      dedicatedFalseAdvanceCount: 0,
      dedicatedSkippedAdvanceCount: 0,
      dedicatedDuplicateAdvanceCount: 0,
      falseAdvanceCount: 0,
      skippedAdvanceCount: 0,
      duplicateAdvanceCount: 0,
      lateAdvanceCount: 0,
      introducedRows: [],
      clearedRows: [],
      isolated: new Map(),
      repeatedChordRecoveries: [],
    },
  ]));
  const traceRows: ListenBassQualificationTraceRow[] = [];
  const isolatedObservations: ListenBassOnsetObservation[] = [];
  const continuousObservations: ListenBassOnsetObservation[] = [];
  const caseTraceIds = listenOmittedBassCaseTraceIds();
  const caseReports = new Map<string, ListenOmittedBassCaseReport>();
  const repeatedRuns: ListenRepeatedChordRunReport[] = [];
  let traceReuseVerified = true;

  for (const [index, descriptor] of descriptors.entries()) {
    onProgress(index, descriptors.length, `Capturing ${descriptor.id}`);
    const capture = await options.capture(descriptor);
    if (capture.descriptor.id !== descriptor.id) {
      throw new Error(`Capturing ${descriptor.id} returned ${capture.descriptor.id}.`);
    }
    if (capture.trace.renderer.version !== descriptor.renderer) {
      throw new Error(
        `${descriptor.id} expects renderer ${descriptor.renderer}, but its capture used ` +
        `${capture.trace.renderer.version}.`,
      );
    }
    const identity: ListenBassTraceIdentity = {
      traceId: descriptor.id,
      suite: descriptor.suite,
      partition: descriptor.partition,
      rendererKey: descriptor.rendererKey,
    };
    traceRows.push({
      traceId: descriptor.id,
      partition: descriptor.partition,
      suite: descriptor.suite,
      rendererKey: descriptor.rendererKey,
      renderer: capture.trace.renderer.version,
      recognitionStructureHash: capture.recognitionStructureHash,
      frameCount: capture.trace.frames.length,
    });

    if (descriptor.suite === "isolated") {
      const validationCase = capture.validationCase;
      if (!validationCase) {
        throw new Error(`${descriptor.id} was captured without its isolated fixture.`);
      }
      const observation = listenIsolatedBassOnsetObservation(
        identity,
        validationCase.targetPitches,
        validationCase.playedPitches,
        capture.trace,
      );
      if (observation) isolatedObservations.push(observation);
      const baselineAdvanced = listenIsolatedQualificationRecord(
        identity,
        validationCase.targetPitches,
        validationCase.playedPitches,
        capture.trace,
        baseline.profile,
        validationCase.caseIndex,
      ).advanced;
      for (const profileIdentity of profiles) {
        const record = listenIsolatedQualificationRecord(
          identity,
          validationCase.targetPitches,
          validationCase.playedPitches,
          capture.trace,
          profileIdentity.profile,
          validationCase.caseIndex,
        );
        const accumulator = accumulators.get(profileIdentity.profileId);
        if (!accumulator) throw new Error(`No accumulator for ${profileIdentity.profileId}.`);
        const summary = accumulator.isolated.get(descriptor.rendererKey) ??
          emptyIsolatedSummary(descriptor.rendererKey);
        summary.trialCount += 1;
        if (validationCase.expectedCorrect) {
          summary.correctTrialCount += 1;
          if (record.advanced) summary.correctAdvanceCount += 1;
          if (record.advanced && !baselineAdvanced) summary.gainedCorrectTraceIds.push(descriptor.id);
          if (!record.advanced && baselineAdvanced) summary.lostCorrectTraceIds.push(descriptor.id);
        } else if (record.advanced) {
          if (descriptor.caseKind === "omitted-bass") {
            summary.omittedBassAdvancedTraceIds.push(descriptor.id);
          } else if (descriptor.caseKind === "ambiguous-harmonic") {
            summary.ambiguousAdvancedCount += 1;
          } else {
            summary.distinguishableWrongAdvancedTraceIds.push(descriptor.id);
          }
        }
        accumulator.isolated.set(descriptor.rendererKey, summary);
      }
      if (caseTraceIds.includes(descriptor.id)) {
        const qualification = LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS
          .map((profileId) => ({
            profileId,
            record: listenIsolatedQualificationRecord(
              identity,
              validationCase.targetPitches,
              validationCase.playedPitches,
              capture.trace,
              listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
              validationCase.caseIndex,
            ),
          }));
        // A rerun of a committed trial must still produce the case it was cut
        // from. A model, renderer, or decoder change is expected to trip this;
        // the response is to re-diagnose, not to relax the check.
        assertListenOmittedBassCaseReproduces(
          descriptor.id,
          capture.recognitionStructureHash,
          qualification.map(({ profileId, record }) => ({
            profileId,
            advanced: record.advanced,
            onsetToAdvanceMs: record.onsetToAdvanceMs,
            hallucinatedQualifiedPitches: record.hallucinatedQualifiedPitches,
            primaryLimitingPath: record.primaryLimitingPath,
          })),
          omittedBassFixtures,
        );
        caseReports.set(descriptor.id, {
          traceId: descriptor.id,
          alreadyCommitted: omittedBassFixtures
            .some((fixture) => fixture.origin.traceId === descriptor.id),
          rendererKey: descriptor.rendererKey,
          targetPitches: [...validationCase.targetPitches],
          playedPitches: [...validationCase.playedPitches],
          bassMidi: Math.min(...validationCase.targetPitches),
          recognitionStructureHash: capture.recognitionStructureHash,
          fixture: buildListenOmittedBassRegressionFixture(
            {
              id: descriptor.id.replace(/\//g, "-"),
              label: `${descriptor.rendererKey} · isolated ${validationCase.caseIndex} · ` +
                `[${validationCase.targetPitches}] played [${validationCase.playedPitches}]`,
              traceId: descriptor.id,
              renderer: capture.trace.renderer.version,
              caseIndex: validationCase.caseIndex,
              sourcePcmHash: capturedPcmHash(capture),
              sourceRecognitionStructureHash: capture.recognitionStructureHash,
              // A generated fixture carries no explanation. Replace this before
              // committing it: a regression whose reason is undocumented is a
              // fossilized behavior rather than a diagnosed one.
              conclusion: "Undiagnosed: replace this before committing the fixture.",
            },
            validationCase.targetPitches,
            validationCase.playedPitches,
            capture.trace,
          ),
          qualification,
        });
      }
      if (listenRecognitionTraceHash(capture.trace) !== capture.recognitionHash) {
        traceReuseVerified = false;
      }
      onProgress(index + 1, descriptors.length, `Replayed ${descriptor.id}`);
      continue;
    }

    const sequence = capture.sequence;
    if (!sequence) {
      throw new Error(`${descriptor.id} was captured without its materialized passage.`);
    }
    continuousObservations.push(
      ...listenSequenceBassOnsetObservations(identity, sequence, capture.trace),
    );
    const dedicated = descriptor.suite === "sequence" && descriptor.partition === "regression-only";
    const baselineRun = replayListenSequenceTrace(
      sequence,
      capture.trace,
      "current-matcher",
      baseline.profile,
    );
    for (const profileIdentity of profiles) {
      const accumulator = accumulators.get(profileIdentity.profileId);
      if (!accumulator) throw new Error(`No accumulator for ${profileIdentity.profileId}.`);
      const run: ListenSequenceRunResult = profileIdentity.profileId === baseline.profileId
        ? baselineRun
        : replayListenSequenceTrace(
          sequence,
          capture.trace,
          "current-matcher",
          profileIdentity.profile,
        );
      accumulator.falseAdvanceCount += run.summary.falseAdvanceCount;
      accumulator.skippedAdvanceCount += run.summary.skippedAdvanceCount;
      accumulator.duplicateAdvanceCount += run.summary.duplicateAdvanceCount;
      accumulator.lateAdvanceCount += run.summary.lateAdvanceCount;
      if (dedicated) {
        accumulator.dedicatedFalseAdvanceCount += run.summary.falseAdvanceCount;
        accumulator.dedicatedSkippedAdvanceCount += run.summary.skippedAdvanceCount;
        accumulator.dedicatedDuplicateAdvanceCount += run.summary.duplicateAdvanceCount;
      }
      for (const row of listenSafetyRegressionsIntroduced(run, baselineRun)) {
        accumulator.introducedRows.push({
          traceId: descriptor.id,
          partition: descriptor.partition,
          targetIndex: row.targetIndex,
          classifications: row.classifications,
        });
      }
      for (const row of listenSafetyRegressionsIntroduced(baselineRun, run)) {
        accumulator.clearedRows.push({
          traceId: descriptor.id,
          partition: descriptor.partition,
          targetIndex: row.targetIndex,
          classifications: row.classifications,
        });
      }
      if (LISTEN_REPEATED_CHORD_TRACE_IDS.includes(descriptor.id)) {
        const observed = observeListenSequenceQualification(
          sequence,
          capture.trace,
          profileIdentity.profile,
        );
        accumulator.repeatedChordRecoveries.push({
          traceId: descriptor.id,
          recoveries: listenRepeatedChordRecoveries(
            sequence,
            observed.run,
            observed.advancements,
            LISTEN_REPEATED_CHORD_PITCHES,
          ),
        });
      }
    }
    if (LISTEN_REPEATED_CHORD_TRACE_IDS.includes(descriptor.id)) {
      const attacks = LISTEN_REPEATED_CHORD_REPORTED_PROFILE_IDS.flatMap((profileId) =>
        listenRepeatedChordAttackRecords(
          identity,
          sequence,
          capture.trace,
          listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
          LISTEN_REPEATED_CHORD_PITCHES,
        ));
      const transition = attacks.find((attack) => (
        attack.role === "transition" &&
        attack.profile.onsetThreshold === baseline.profile.onsetThreshold &&
        attack.profile.activeTargetThreshold === baseline.profile.activeTargetThreshold
      ));
      repeatedRuns.push({
        traceId: descriptor.id,
        partition: descriptor.partition,
        rendererKey: descriptor.rendererKey,
        piano: descriptor.piano,
        layer: descriptor.layer,
        recognitionStructureHash: capture.recognitionStructureHash,
        attacks,
        transitionLowestLimitingUpperVoiceEvidence:
          transition?.lowestLimitingUpperVoiceEvidence ?? null,
      });
    }
    if (listenRecognitionTraceHash(capture.trace) !== capture.recognitionHash) {
      traceReuseVerified = false;
    }
    onProgress(index + 1, descriptors.length, `Replayed ${descriptor.id}`);
  }

  const matchedObservations = listenMatchedBassPairObservations(isolatedObservations);
  const caseReportList = caseTraceIds
    .flatMap((traceId) => {
      const report = caseReports.get(traceId);
      return report ? [report] : [];
    });
  const pinnedCases = caseReportList
    .filter(({ traceId }) => LISTEN_PINNED_OMITTED_BASS_TRACE_IDS.includes(traceId))
    .map((report): ListenOmittedBassCaseReport => {
      const counterpart = caseReports.get(counterpartTraceId(report.traceId)) ?? null;
      return {
        ...report,
        fixture: {
          ...report.fixture,
          crossRendered: counterpart === null ? null : {
            traceId: counterpart.traceId,
            renderer: counterpart.fixture.origin.renderer,
            recognitionStructureHash: counterpart.recognitionStructureHash,
            outcomes: counterpart.qualification.map(({ profileId, record }) => ({
              profileId,
              advanced: record.advanced,
              onsetToAdvanceMs: record.onsetToAdvanceMs,
              hallucinatedQualifiedPitches: record.hallucinatedQualifiedPitches,
              primaryLimitingPath: record.primaryLimitingPath,
            })),
          },
        },
      };
    });
  const transitionByRun = repeatedRuns.map((run) => ({
    traceId: run.traceId,
    value: run.transitionLowestLimitingUpperVoiceEvidence,
  }));
  return {
    name: "listen-bass-qualification",
    selectsNothing: true,
    manifest: {
      version: manifest.version,
      hash: listenTraceManifestHash(manifest),
      corpusHash: listenTraceCorpusHash(manifest),
      traceCount: manifest.traces.length,
      capturedTraceCount: descriptors.length,
    },
    corpus: {
      complete: descriptors.length === corpus.length,
      expectedTraceCount: corpus.length,
      missingTraceIds: corpus
        .filter((descriptor) => !descriptors.includes(descriptor))
        .map(({ id }) => id),
    },
    baselineProfileId: LISTEN_BASS_QUALIFICATION_BASELINE_PROFILE_ID,
    profiles,
    gates: {
      onset: LISTEN_BASS_ONSET_GATES,
      activeTarget: LISTEN_ACTIVE_TARGET_GATES,
      hallucinationCorridor: {
        lowerInclusive: 0.5,
        upperExclusive: 0.6,
      },
    },
    traces: traceRows,
    isolated: {
      matchedPairCensus: listenBassOnsetCensusByRenderer("isolated/matched", matchedObservations),
      allTriadCensus: listenBassOnsetCensusByRenderer("isolated/all-triads", isolatedObservations),
      matchedPairs: listenMatchedBassPairs(isolatedObservations).map((pair) => ({
        targetPitches: pair.targetPitches,
        genuineTraceIds: pair.genuine.map(({ traceId }) => traceId),
        hallucinatedTraceIds: pair.hallucinated.map(({ traceId }) => traceId),
      })),
      observations: isolatedObservations,
    },
    continuous: {
      census: listenBassOnsetCensusByRenderer("continuous", continuousObservations),
      censusBySuite: [...new Set(continuousObservations.map(({ suite }) => suite))]
        .flatMap((suite) => listenBassOnsetCensusByRenderer(
          `continuous/${suite}`,
          continuousObservations.filter((observation) => observation.suite === suite),
        )),
      observations: continuousObservations,
    },
    omittedBassCases: pinnedCases,
    crossRenderedOmittedBass: caseReportList
      .filter(({ traceId }) => !LISTEN_PINNED_OMITTED_BASS_TRACE_IDS.includes(traceId)),
    repeatedChord: {
      pitches: LISTEN_REPEATED_CHORD_PITCHES,
      runs: repeatedRuns,
      transitionUpperVoiceEvidenceMinimum:
        transitionByRun.length === 0 || transitionByRun.some(({ value }) => value === null)
          ? null
          : Math.min(...transitionByRun.map(({ value }) => value as number)),
      transitionUpperVoiceEvidenceByRun: transitionByRun,
      bestSourceDistanceByProfile: profiles.map((identity) => {
        const accumulator = accumulators.get(identity.profileId);
        if (!accumulator) throw new Error(`No accumulator for ${identity.profileId}.`);
        return {
          profileId: identity.profileId,
          role: identity.role,
          runs: accumulator.repeatedChordRecoveries.map(({ traceId, recoveries }) => {
            const distances = recoveries
              .map(({ sourceDistance }) => sourceDistance)
              .filter((distance): distance is number => distance !== null);
            return {
              traceId,
              bestSourceDistance: distances.length === 0 ? null : Math.min(...distances),
            };
          }),
        };
      }),
      activeGateReachingTransition: {
        lowestMeasuredGate: LISTEN_ACTIVE_TARGET_GATES[0],
        byRun: transitionByRun.map(({ traceId, value }) => ({
          traceId,
          limitingUpperVoiceEvidence: value,
          lowestGateThatWouldAdmitIt: value === null
            ? null
            : LISTEN_ACTIVE_TARGET_GATES.find((gate) => gate <= value) ?? null,
        })),
        anyMeasuredGateAdmitsEveryRun: transitionByRun.length > 0 &&
          transitionByRun.every(({ value }) => (
            value === null || LISTEN_ACTIVE_TARGET_GATES.some((gate) => gate <= value)
          )),
      },
    },
    profileReports: profiles.map((identity): ListenBassQualificationProfileReport => {
      const accumulator = accumulators.get(identity.profileId);
      if (!accumulator) throw new Error(`No accumulator for ${identity.profileId}.`);
      return {
        profileId: identity.profileId,
        role: identity.role,
        profile: identity.profile,
        archivedDiscoveryVerdict: identity.role === "counterfactual"
          ? listenArchivedDiscoveryVerdict(identity.profileId)
          : null,
        continuousSafety: {
          dedicatedFalseAdvanceCount: accumulator.dedicatedFalseAdvanceCount,
          dedicatedSkippedAdvanceCount: accumulator.dedicatedSkippedAdvanceCount,
          dedicatedDuplicateAdvanceCount: accumulator.dedicatedDuplicateAdvanceCount,
          introducedRows: accumulator.introducedRows,
          clearedRows: accumulator.clearedRows,
          falseAdvanceCount: accumulator.falseAdvanceCount,
          skippedAdvanceCount: accumulator.skippedAdvanceCount,
          duplicateAdvanceCount: accumulator.duplicateAdvanceCount,
          lateAdvanceCount: accumulator.lateAdvanceCount,
          passed: accumulator.introducedRows.length === 0 &&
            accumulator.dedicatedFalseAdvanceCount === 0 &&
            accumulator.dedicatedSkippedAdvanceCount === 0 &&
            accumulator.dedicatedDuplicateAdvanceCount === 0,
        },
        committedRegressions: replayListenSafetyRegressions(identity.profile, identity.profileId),
        omittedBassRegressions: omittedBassFixtures
          .flatMap((fixture) => replayListenOmittedBassRegression(fixture))
          .filter((outcome) => outcome.profileId === identity.profileId),
        isolated: [...accumulator.isolated.values()],
        repeatedChordRecoveries: accumulator.repeatedChordRecoveries,
      };
    }),
    traceReuseVerified,
  };
}

/* ------------------------------------------------------------------------- *
 * Browser entry point
 * ------------------------------------------------------------------------- */

/**
 * Renders and recognizes one trace on the capture path its own suite already
 * uses, so a bass-qualification row cannot diverge from the suite result it
 * claims to describe.
 */
export async function captureListenBassQualificationTrace(
  descriptor: ListenTraceDescriptor,
  session: SequenceInferenceSession,
  isolatedCases: readonly ListenIsolatedValidationCase[],
): Promise<ListenBassQualificationCapture> {
  if (descriptor.suite === "isolated") {
    const validationCase = isolatedCases.find((entry) => entry.descriptor.id === descriptor.id);
    if (!validationCase) throw new Error(`${descriptor.id} names no isolated fixture.`);
    const captured = await captureListenIsolatedValidationTrace(validationCase, session);
    return {
      descriptor,
      sequence: null,
      validationCase,
      trace: captured.trace,
      recognitionHash: captured.recognitionHash,
      recognitionStructureHash: captured.recognitionStructureHash,
    };
  }
  const captured: ListenMultiDomainCapture = await captureListenMultiDomainTrace(
    descriptor,
    session,
  );
  return {
    descriptor,
    sequence: captured.sequence,
    validationCase: null,
    trace: captured.trace,
    recognitionHash: captured.recognitionHash,
    recognitionStructureHash: captured.recognitionStructureHash,
  };
}

/** Runs the whole measurement in the browser against one inference session. */
export function runListenBassQualification(
  onProgress: (completed: number, total: number, label: string) => void = () => undefined,
  traceFilter?: (descriptor: ListenTraceDescriptor) => boolean,
): Promise<ListenBassQualificationResult> {
  const isolatedCases = listenIsolatedValidationCases();
  return withOnlineAmtBenchmarkSession((session) => evaluateListenBassQualification({
    capture: (descriptor) => captureListenBassQualificationTrace(
      descriptor,
      session,
      isolatedCases,
    ),
    traceFilter,
    onProgress,
  }));
}

/**
 * The exported shape of one run.
 *
 * The per-observation rows are kept: the distributions this task reports are
 * only auditable if the observations behind them are in the archive. Process
 * local trace hashes are the one thing left out, because no fresh browser
 * process reproduces them and a cross-run comparison must not read them.
 */
export function conciseListenBassQualificationResult(result: ListenBassQualificationResult) {
  return {
    name: result.name,
    selectsNothing: result.selectsNothing,
    manifest: result.manifest,
    corpus: result.corpus,
    baselineProfileId: result.baselineProfileId,
    profiles: result.profiles,
    gates: result.gates,
    traceCount: result.traces.length,
    traces: result.traces,
    isolated: result.isolated,
    continuous: result.continuous,
    omittedBassCases: result.omittedBassCases,
    crossRenderedOmittedBass: result.crossRenderedOmittedBass,
    repeatedChord: result.repeatedChord,
    profileReports: result.profileReports,
    traceReuseVerified: result.traceReuseVerified,
  };
}
