/**
 * Committed regressions for the two omitted-bass advances round one uncovered.
 *
 * `isolated/direct/122` plays `[48, 60, 68]` as `[60, 68]` and
 * `isolated/tone/124` plays `[56, 68, 75]` as `[68, 75]`. Both targets are
 * triads, so a fresh bass onset is required and the sustained-completion path
 * cannot credit the bass; each was nevertheless completed by a decoded onset on
 * a bass pitch that was never sounded. `baseline-v1` refuses both at its 0.60
 * fresh-onset gate and every frozen `v2` candidate advances them, which places
 * the phantom onset's confidence in `[0.50, 0.60)`.
 *
 * A fixture here pins **per profile**: the incumbent's refusal and each
 * candidate's advance are both part of the measured behaviour, and a change that
 * moved either one would be a real change to a diagnosed case.
 *
 * These fixtures are deliberately not part of `LISTEN_SAFETY_REGRESSION_FIXTURES`.
 * That list is folded into the frozen version-1 trace manifest, whose amendment
 * rule requires a new discovery round rather than an in-place edit, and Task 22
 * changes no gate. Task 25 authors the version-2 corpus that admits them.
 */

import {
  LISTEN_MATCHER_PROFILES,
  LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "../listenMatcherProfiles";
import {
  extractListenSafetyRegressionFrames,
  type ListenSafetyRegressionFrame,
} from "./listenSafetyRegression";
import {
  listenIsolatedQualificationRecord,
  type ListenBassTraceIdentity,
  type ListenTargetQualificationPath,
} from "../listenBassQualification";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_RENDERERS,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import type {
  ListenRecognitionFrame,
  ListenRecognitionTrace,
} from "./listenSequenceBenchmark";
import type { ListenTraceRendererKey } from "./listenTraceManifest";
import { LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST } from "./listenOmittedBassFixtures";

/** What one profile is pinned to do with one omitted-bass fixture. */
export interface ListenOmittedBassPinnedOutcome {
  profileId: ListenMatcherProfileId;
  advanced: boolean;
  onsetToAdvanceMs: number | null;
  /** Required pitches admitted although the fixture never sounded them. */
  hallucinatedQualifiedPitches: number[];
  primaryLimitingPath: ListenTargetQualificationPath;
}

/** A cross-rendered measurement of the same fixture, recorded but not required. */
export interface ListenOmittedBassCrossRenderedDiagnostic {
  traceId: string;
  renderer: string;
  recognitionStructureHash: string;
  outcomes: ListenOmittedBassPinnedOutcome[];
}

export interface ListenOmittedBassRegressionFixture {
  id: string;
  label: string;
  origin: {
    renderer: string;
    rendererKey: ListenTraceRendererKey;
    traceId: string;
    /** One-based position in the fixed isolated corpus, matching the manifest. */
    caseIndex: number;
    /**
     * FNV identity of the rendered PCM, taken from the trace's own audio
     * signature. It is unique to the browser process that produced it and is
     * recorded as provenance only; nothing compares it across runs.
     */
    sourcePcmHash: string;
    /** Decoded-structure identity, which does reproduce across runs. */
    sourceRecognitionStructureHash: string;
  };
  targetPitches: number[];
  playedPitches: number[];
  bassMidi: number;
  /**
   * The strongest decoded onset on the never-sounded bass pitch, as measured.
   * This is the value every pinned advance depends on.
   */
  hallucinatedBassOnset: {
    confidence: number;
    noteConfidence: number;
    onsetTimeMs: number;
  } | null;
  conclusion: string;
  pinnedOutcomes: ListenOmittedBassPinnedOutcome[];
  /**
   * The same musical input under the other renderer. Recorded as a diagnostic:
   * a renderer that decodes no phantom onset is information, not a failure to
   * reproduce this fixture.
   */
  crossRendered: ListenOmittedBassCrossRenderedDiagnostic | null;
  sampleRate: number;
  chunkSize: number;
  relevantPitches: number[];
  frames: readonly ListenSafetyRegressionFrame[];
}

/** The profiles every omitted-bass fixture pins, in the frozen column order. */
export const LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS: readonly ListenMatcherProfileId[] =
  Object.freeze([
    "baseline-v1",
    ...LISTEN_MULTIDOMAIN_CANDIDATE_PROFILE_IDS,
  ]);

function rendererKeyFor(renderer: string): ListenTraceRendererKey {
  return renderer === LISTEN_BENCHMARK_RENDERER.version ? "direct" : "tone";
}

/**
 * Rebuilds a replayable trace from a fixture. PCM and model scores are omitted
 * because no matcher path reads them; every value that is read is stored
 * verbatim from the measured run.
 */
export function listenOmittedBassRegressionTrace(
  fixture: ListenOmittedBassRegressionFixture,
): ListenRecognitionTrace {
  const renderer: ListenBenchmarkRendererConfiguration =
    LISTEN_BENCHMARK_RENDERERS.find(({ version }) => version === fixture.origin.renderer) ??
    LISTEN_BENCHMARK_RENDERER;
  return {
    sequenceId: fixture.id,
    intervalMs: 0,
    sampleRate: fixture.sampleRate,
    chunkSize: fixture.chunkSize,
    relevantPitches: [...fixture.relevantPitches],
    renderer,
    audioDiagnostics: { frameCount: 0, durationMs: 0, peak: 0, rms: 0 },
    pcm: new Float32Array(0),
    frames: fixture.frames.map((frame): ListenRecognitionFrame => ({
      capturedAtMs: frame.capturedAtMs,
      onsets: frame.onsets.map((onset) => ({ ...onset })),
      noteEvents: frame.noteEvents.map((event) => ({ ...event })),
      activePitches: frame.activePitches.map((pitch) => ({ ...pitch })),
      confidenceEvidence: frame.confidenceEvidence.map((evidence) => ({ ...evidence })),
      modelScores: [],
      modelStates: [],
      signalActive: frame.signalActive,
      inferenceDurationMs: 0,
    })),
    maximumInferenceMs: 0,
    maximumProcessingBacklogMs: 0,
  };
}

function fixtureIdentity(fixture: ListenOmittedBassRegressionFixture): ListenBassTraceIdentity {
  return {
    traceId: fixture.id,
    suite: "isolated",
    partition: "confirmation",
    rendererKey: fixture.origin.rendererKey,
  };
}

/**
 * Measures one profile's behaviour on one fixture, without consulting what the
 * fixture pins. Used both to build a fixture and to replay it.
 */
export function measureListenOmittedBassOutcome(
  fixture: ListenOmittedBassRegressionFixture,
  profileId: ListenMatcherProfileId,
  trace: ListenRecognitionTrace = listenOmittedBassRegressionTrace(fixture),
): ListenOmittedBassPinnedOutcome {
  const record = listenIsolatedQualificationRecord(
    fixtureIdentity(fixture),
    fixture.targetPitches,
    fixture.playedPitches,
    trace,
    listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]),
    fixture.origin.caseIndex,
  );
  return {
    profileId,
    advanced: record.advanced,
    onsetToAdvanceMs: record.onsetToAdvanceMs,
    hallucinatedQualifiedPitches: record.hallucinatedQualifiedPitches,
    primaryLimitingPath: record.primaryLimitingPath,
  };
}

export interface ListenOmittedBassRegressionOutcome extends ListenOmittedBassPinnedOutcome {
  fixtureId: string;
  pinned: ListenOmittedBassPinnedOutcome;
  deviations: string[];
  satisfied: boolean;
}

export interface ListenOmittedBassRegressionSummary {
  fixtureCount: number;
  outcomes: ListenOmittedBassRegressionOutcome[];
  deviationCount: number;
  /** False as soon as any profile stops doing what it was measured doing. */
  passed: boolean;
}

/**
 * Replays one fixture against every profile it pins and reports each deviation.
 *
 * The incumbent's refusal is checked exactly as strictly as a candidate's
 * advance: a change that quietly made `baseline-v1` advance an omitted-bass
 * fixture is the most dangerous outcome this fixture exists to catch.
 */
export function replayListenOmittedBassRegression(
  fixture: ListenOmittedBassRegressionFixture,
): ListenOmittedBassRegressionOutcome[] {
  const trace = listenOmittedBassRegressionTrace(fixture);
  const pinnedIds = fixture.pinnedOutcomes.map(({ profileId }) => profileId);
  for (const profileId of LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS) {
    if (!pinnedIds.includes(profileId)) {
      throw new Error(`${fixture.id} pins no outcome for ${profileId}.`);
    }
  }
  return fixture.pinnedOutcomes.map((pinned): ListenOmittedBassRegressionOutcome => {
    const measured = measureListenOmittedBassOutcome(fixture, pinned.profileId, trace);
    const deviations: string[] = [];
    if (measured.advanced !== pinned.advanced) {
      deviations.push(
        `${pinned.profileId} ${measured.advanced ? "advanced" : "refused"}, pinned ` +
        `${pinned.advanced ? "advance" : "refusal"}`,
      );
    }
    if (measured.onsetToAdvanceMs !== pinned.onsetToAdvanceMs) {
      deviations.push(
        `${pinned.profileId} advanced at ${measured.onsetToAdvanceMs} ms, pinned ` +
        `${pinned.onsetToAdvanceMs} ms`,
      );
    }
    if (
      measured.hallucinatedQualifiedPitches.join("+") !==
      pinned.hallucinatedQualifiedPitches.join("+")
    ) {
      deviations.push(
        `${pinned.profileId} admitted unsounded pitches ` +
        `[${measured.hallucinatedQualifiedPitches}], pinned ` +
        `[${pinned.hallucinatedQualifiedPitches}]`,
      );
    }
    if (measured.primaryLimitingPath !== pinned.primaryLimitingPath) {
      deviations.push(
        `${pinned.profileId} is limited by ${measured.primaryLimitingPath}, pinned ` +
        `${pinned.primaryLimitingPath}`,
      );
    }
    return {
      ...measured,
      fixtureId: fixture.id,
      pinned,
      deviations,
      satisfied: deviations.length === 0,
    };
  });
}

export function summarizeListenOmittedBassRegressions(
  fixtures: readonly ListenOmittedBassRegressionFixture[] =
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURES,
): ListenOmittedBassRegressionSummary {
  const outcomes = fixtures.flatMap((fixture) => replayListenOmittedBassRegression(fixture));
  return {
    fixtureCount: fixtures.length,
    outcomes,
    deviationCount: outcomes.filter(({ satisfied }) => !satisfied).length,
    passed: outcomes.every(({ satisfied }) => satisfied),
  };
}

/** One committed fixture's verdict on a freshly captured run of its own trial. */
export interface ListenOmittedBassCaseVerification {
  fixtureId: string;
  traceId: string;
  expectedRecognitionStructureHash: string;
  actualRecognitionStructureHash: string;
  differences: string[];
}

/**
 * Re-verifies a freshly captured isolated trial against every committed fixture
 * cut from the same manifest trace.
 *
 * Without this the committed frames would be the only thing ever checked, and a
 * changed model, renderer, or decoder could silently stop producing the phantom
 * onset the fixture was cut from while the fixture itself kept passing. The
 * decoded-structure hash is the identity that reproduces across browser
 * processes, so it is what a rerun must match, together with every pinned
 * per-profile outcome.
 */
export function verifyListenOmittedBassCase(
  traceId: string,
  recognitionStructureHash: string,
  measured: readonly ListenOmittedBassPinnedOutcome[],
  fixtures: readonly ListenOmittedBassRegressionFixture[] =
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURES,
): ListenOmittedBassCaseVerification[] {
  return fixtures
    .filter((fixture) => fixture.origin.traceId === traceId)
    .map((fixture): ListenOmittedBassCaseVerification => {
      const differences: string[] = [];
      if (recognitionStructureHash !== fixture.origin.sourceRecognitionStructureHash) {
        differences.push(
          `decoded structure hash ${recognitionStructureHash}, ` +
          `expected ${fixture.origin.sourceRecognitionStructureHash}`,
        );
      }
      for (const pinned of fixture.pinnedOutcomes) {
        const observed = measured.find(({ profileId }) => profileId === pinned.profileId);
        if (!observed) {
          differences.push(`${pinned.profileId} was not measured on this run`);
          continue;
        }
        if (observed.advanced !== pinned.advanced) {
          differences.push(
            `${pinned.profileId} ${observed.advanced ? "advanced" : "refused"} the rendered ` +
            `trial, pinned ${pinned.advanced ? "advance" : "refusal"}`,
          );
        }
        // The decoded-structure hash deliberately excludes confidence values, so
        // a rerender whose phantom onset moved could advance later and still hash
        // identically. The pinned latency is what catches that, and it is checked
        // here for the same reason the static replay checks it.
        if (observed.onsetToAdvanceMs !== pinned.onsetToAdvanceMs) {
          differences.push(
            `${pinned.profileId} advanced the rendered trial at ${observed.onsetToAdvanceMs} ms, ` +
            `pinned ${pinned.onsetToAdvanceMs} ms`,
          );
        }
        if (
          observed.hallucinatedQualifiedPitches.join("+") !==
          pinned.hallucinatedQualifiedPitches.join("+")
        ) {
          differences.push(
            `${pinned.profileId} admitted unsounded pitches ` +
            `[${observed.hallucinatedQualifiedPitches}], pinned ` +
            `[${pinned.hallucinatedQualifiedPitches}]`,
          );
        }
        if (observed.primaryLimitingPath !== pinned.primaryLimitingPath) {
          differences.push(
            `${pinned.profileId} is limited by ${observed.primaryLimitingPath}, pinned ` +
            `${pinned.primaryLimitingPath}`,
          );
        }
      }
      return {
        fixtureId: fixture.id,
        traceId,
        expectedRecognitionStructureHash: fixture.origin.sourceRecognitionStructureHash,
        actualRecognitionStructureHash: recognitionStructureHash,
        differences,
      };
    });
}

/**
 * Fails the capture when a rerun of a committed trial no longer reproduces it. A
 * genuine model, renderer, or decoder change is expected to trip this; the
 * response is to re-diagnose the case and regenerate its fixture, not to relax
 * the check.
 */
export function assertListenOmittedBassCaseReproduces(
  traceId: string,
  recognitionStructureHash: string,
  measured: readonly ListenOmittedBassPinnedOutcome[],
  fixtures: readonly ListenOmittedBassRegressionFixture[] =
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURES,
): ListenOmittedBassCaseVerification[] {
  const verifications = verifyListenOmittedBassCase(
    traceId,
    recognitionStructureHash,
    measured,
    fixtures,
  );
  const failed = verifications.filter(({ differences }) => differences.length > 0);
  if (failed.length > 0) {
    throw new Error(
      "A committed omitted-bass regression no longer reproduces: " +
      failed
        .map(({ fixtureId, differences }) => `${fixtureId} (${differences.join("; ")})`)
        .join(", "),
    );
  }
  return verifications;
}

/** Identity and conclusion a generated fixture is committed under. */
export interface ListenOmittedBassFixtureIdentity {
  id: string;
  label: string;
  traceId: string;
  renderer: string;
  caseIndex: number;
  sourcePcmHash: string;
  sourceRecognitionStructureHash: string;
  conclusion: string;
}

/**
 * Builds a committed fixture from one measured isolated trial.
 *
 * The pinned outcomes are measured here rather than supplied, so a fixture can
 * never be committed with an expectation that its own frames do not produce.
 */
export function buildListenOmittedBassRegressionFixture(
  identity: ListenOmittedBassFixtureIdentity,
  targetPitches: readonly number[],
  playedPitches: readonly number[],
  trace: ListenRecognitionTrace,
  crossRendered: ListenOmittedBassCrossRenderedDiagnostic | null = null,
): ListenOmittedBassRegressionFixture {
  const target = [...targetPitches].sort((left, right) => left - right);
  const played = [...playedPitches].sort((left, right) => left - right);
  const bassMidi = target[0];
  if (target.length < 3) {
    throw new Error(`${identity.id} is not a triad, so no fresh-bass rule applies to it.`);
  }
  if (played.includes(bassMidi)) {
    throw new Error(`${identity.id} sounded its bass pitch, so it is not an omitted-bass case.`);
  }
  const relevantPitches = [...new Set([...target, ...played])].sort((left, right) => left - right);
  const endMs = trace.frames.length === 0
    ? 0
    : trace.frames[trace.frames.length - 1].capturedAtMs;
  let hallucinatedBassOnset: ListenOmittedBassRegressionFixture["hallucinatedBassOnset"] = null;
  for (const frame of trace.frames) {
    for (const onset of frame.onsets) {
      if (onset.midi !== bassMidi) continue;
      if (hallucinatedBassOnset === null || onset.confidence > hallucinatedBassOnset.confidence) {
        hallucinatedBassOnset = {
          confidence: onset.confidence,
          noteConfidence: onset.noteConfidence,
          onsetTimeMs: onset.onsetTimeMs,
        };
      }
    }
  }
  const fixture: ListenOmittedBassRegressionFixture = {
    id: identity.id,
    label: identity.label,
    origin: {
      renderer: identity.renderer,
      rendererKey: rendererKeyFor(identity.renderer),
      traceId: identity.traceId,
      caseIndex: identity.caseIndex,
      sourcePcmHash: identity.sourcePcmHash,
      sourceRecognitionStructureHash: identity.sourceRecognitionStructureHash,
    },
    targetPitches: target,
    playedPitches: played,
    bassMidi,
    hallucinatedBassOnset,
    conclusion: identity.conclusion,
    pinnedOutcomes: [],
    crossRendered,
    sampleRate: trace.sampleRate,
    chunkSize: trace.chunkSize,
    relevantPitches,
    frames: extractListenSafetyRegressionFrames(trace, 0, endMs, relevantPitches),
  };
  return {
    ...fixture,
    pinnedOutcomes: LISTEN_OMITTED_BASS_PINNED_PROFILE_IDS
      .map((profileId) => measureListenOmittedBassOutcome(fixture, profileId)),
  };
}

/** Committed regressions. Each entry is a diagnosed, previously measured trial. */
export const LISTEN_OMITTED_BASS_REGRESSION_FIXTURES:
  readonly ListenOmittedBassRegressionFixture[] = LISTEN_OMITTED_BASS_REGRESSION_FIXTURE_LIST;
