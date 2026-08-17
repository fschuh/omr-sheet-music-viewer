/**
 * Forensics and permanent regressions for unsafe listen-mode advancements.
 *
 * A safety counter is only useful if the event behind it can be explained,
 * reproduced without the original audio, and replayed against every candidate
 * profile. This module turns one measured advancement into a compact decoded
 * trace fixture, so a known failure domain can never be silently omitted from a
 * later "zero safety events" claim.
 *
 * It depends only on the sequence benchmark's replay boundary and on the profile
 * registry, never on rendering or inference.
 */

import {
  FIXED_LISTEN_MATCHER_POLICY,
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  listenMatcherThresholds,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  ONLINE_AMT_CHUNK_SIZE,
  ONLINE_AMT_SAMPLE_RATE,
} from "./onlineAmtProtocol";
import {
  LISTEN_SEQUENCE_PRE_ROLL_MS,
  materializeListenSequence,
  replayListenSequenceTrace,
  summarizeListenSequenceSafety,
  type ListenRecognitionFrame,
  type ListenRecognitionTrace,
  type ListenSequenceAdvancementObservation,
  type ListenSequenceDefinition,
  type ListenSequenceRunResult,
  type ListenSequenceSafetySummary,
  type MaterializedListenSequence,
} from "./listenSequenceBenchmark";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_RENDERERS,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import { LISTEN_SAFETY_REGRESSION_FIXTURE_LIST } from "./listenSafetyRegressionFixtures";

/** Why a run counted an advancement against its safety gates. */
export type ListenAdvanceSafetyClassification =
  | "false-advance"
  | "skipped-advance"
  | "duplicate-advance"
  | "late-advance";

/**
 * The replay attribution rule's tolerance, derived from the fixed matcher policy
 * exactly as the replay derives it: an advancement later than
 * `collectionWindowMs + settleMs` plus one decoder frame after its own physical
 * attack is credited to the most recent earlier attack instead. Reported so an
 * investigation states the rule it is auditing; widening it would hide safety
 * events rather than fix them.
 */
export const LISTEN_ATTRIBUTION_WINDOW_MS = FIXED_LISTEN_MATCHER_POLICY.collectionWindowMs +
  FIXED_LISTEN_MATCHER_POLICY.settleMs +
  ONLINE_AMT_CHUNK_SIZE * 1_000 / ONLINE_AMT_SAMPLE_RATE;

/** Frames retained around an advancement so its decision context stays visible. */
export const LISTEN_FORENSIC_WINDOW_MS = 1_200;

/** One decoded frame, reduced to what a matcher decision can depend on. */
export interface ListenAdvanceFrameForensics {
  frameIndex: number;
  capturedAtMs: number;
  signalActive: boolean;
  onsets: Array<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetTimeMs: number;
  }>;
  noteEvents: Array<{
    midi: number;
    type: string;
    confidence: number;
    eventTimeMs: number;
  }>;
  activePitches: Array<{ midi: number; confidence: number }>;
  confidenceEvidence: Array<{ midi: number; confidence: number }>;
}

/**
 * Everything needed to decide whether an advancement was a matcher failure or a
 * benchmark attribution error, without rerunning rendering or inference.
 */
export interface ListenAdvanceForensics {
  sequenceId: string;
  intervalMs: number;
  profile: ListenMatcherThresholds;
  classification: ListenAdvanceSafetyClassification[];
  targetIndex: number;
  generation: number;
  targetPitches: number[];
  playedPitches: number[];
  scheduledAttackTimeMs: number;
  advancedAtMs: number;
  advanceFrameIndex: number;
  /** Delay from this target's own physical attack to the advancement. */
  attributionDelayMs: number;
  /** Longest delay the attribution rule still credits to the target's own attack. */
  attributionWindowMs: number;
  sourceAttackIndex: number | null;
  sourceAttackTargetIndex: number | null;
  sourceAttackScheduledAtMs: number | null;
  sourceAttackPlayedPitches: number[];
  sourceAttackExpectedAdvance: boolean | null;
  /** The pitches the matcher actually accepted as fresh evidence. */
  detectedTargetPitches: number[];
  extraPitches: number[];
  carryOverPitchesAtTargetStart: number[];
  carryOverPitchesForNextTarget: number[];
  /**
   * True when the matcher completed the advanced target from its own pitches
   * with no rejected extras. A false advancement with this set true was driven
   * by correct pitch content and is an attribution question; one with it false
   * accepted something the score did not contain.
   */
  playedPitchesMatchTarget: boolean;
  /**
   * Physical attacks whose sounding notes overlap the advancement instant, in
   * schedule order. An advancement is only genuinely wrong if no overlapping
   * attack legitimately produces the advanced target.
   */
  soundingAttackIndices: number[];
  frames: ListenAdvanceFrameForensics[];
}

export interface ListenSequenceSafetyDiagnosis {
  run: ListenSequenceRunResult;
  observations: ListenSequenceAdvancementObservation[];
  forensics: ListenAdvanceForensics[];
}

function frameForensics(
  frame: ListenRecognitionFrame,
  frameIndex: number,
): ListenAdvanceFrameForensics {
  return {
    frameIndex,
    capturedAtMs: frame.capturedAtMs,
    signalActive: frame.signalActive,
    onsets: frame.onsets.map(({ midi, confidence, noteConfidence, onsetTimeMs }) => ({
      midi,
      confidence,
      noteConfidence,
      onsetTimeMs,
    })),
    noteEvents: frame.noteEvents.map(({ midi, type, confidence, eventTimeMs }) => ({
      midi,
      type,
      confidence,
      eventTimeMs,
    })),
    activePitches: frame.activePitches.map(({ midi, confidence }) => ({ midi, confidence })),
    confidenceEvidence: frame.confidenceEvidence.map(({ midi, confidence }) => ({
      midi,
      confidence,
    })),
  };
}

function soundingAttackIndices(
  sequence: MaterializedListenSequence,
  atMs: number,
): number[] {
  return sequence.attacks
    .filter((attack) => attack.notes.some((scheduled) => (
      scheduled.attackTimeMs <= atMs && atMs <= scheduled.releaseTimeMs
    )))
    .map(({ index }) => index);
}

/**
 * Replays a captured trace and explains every advancement the run counted as
 * unsafe. The replay is the production one; the observer only reads state, so
 * the returned run is identical to an unobserved replay of the same trace.
 */
export function diagnoseListenSequenceSafety(
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
  profile: ListenMatcherThresholds,
  windowMs = LISTEN_FORENSIC_WINDOW_MS,
): ListenSequenceSafetyDiagnosis {
  const observations: ListenSequenceAdvancementObservation[] = [];
  const run = replayListenSequenceTrace(
    sequence,
    trace,
    "current-matcher",
    profile,
    (observation) => observations.push(observation),
  );
  const forensics = run.events.flatMap((event): ListenAdvanceForensics[] => {
    const classification: ListenAdvanceSafetyClassification[] = [];
    if (event.falseAdvance) classification.push("false-advance");
    if (event.skipped) classification.push("skipped-advance");
    if (event.duplicate) classification.push("duplicate-advance");
    if (event.lateAdvance) classification.push("late-advance");
    if (classification.length === 0) return [];
    const observation = observations.find(({ targetIndex }) => targetIndex === event.index);
    if (!observation) return [];
    const sourceAttack = observation.sourceAttackIndex === null
      ? null
      : sequence.attacks[observation.sourceAttackIndex] ?? null;
    const frames = trace.frames.flatMap((frame, frameIndex) => (
      Math.abs(frame.capturedAtMs - observation.atMs) <= windowMs
        ? [frameForensics(frame, frameIndex)]
        : []
    ));
    const target = sequence.targets[event.index];
    return [{
      sequenceId: run.sequenceId,
      intervalMs: run.intervalMs,
      profile: listenMatcherThresholds(profile),
      classification,
      targetIndex: event.index,
      generation: observation.generation,
      targetPitches: [...event.targetPitches],
      playedPitches: [...event.playedPitches],
      scheduledAttackTimeMs: event.scheduledAttackTimeMs,
      advancedAtMs: observation.atMs,
      advanceFrameIndex: observation.frameIndex,
      attributionDelayMs: observation.atMs - event.scheduledAttackTimeMs,
      attributionWindowMs: LISTEN_ATTRIBUTION_WINDOW_MS,
      sourceAttackIndex: observation.sourceAttackIndex,
      sourceAttackTargetIndex: sourceAttack?.targetIndex ?? null,
      sourceAttackScheduledAtMs: sourceAttack?.scheduledAtMs ?? null,
      sourceAttackPlayedPitches: sourceAttack ? [...sourceAttack.playedPitches] : [],
      sourceAttackExpectedAdvance: sourceAttack?.expectedAdvance ?? null,
      detectedTargetPitches: [...observation.detectedTargetPitches],
      extraPitches: [...observation.extraPitches],
      carryOverPitchesAtTargetStart: [...observation.carryOverPitchesAtTargetStart],
      carryOverPitchesForNextTarget: [...observation.carryOverPitchesForNextTarget],
      playedPitchesMatchTarget: observation.extraPitches.length === 0 &&
        (target?.pitches ?? []).every((midi) => observation.detectedTargetPitches.includes(midi)),
      soundingAttackIndices: soundingAttackIndices(sequence, observation.atMs),
      frames,
    }];
  });
  return { run, observations, forensics };
}

/** One decoded frame of a fixture, stored without PCM or model scores. */
export interface ListenSafetyRegressionFrame {
  capturedAtMs: number;
  signalActive: boolean;
  onsets: Array<{
    midi: number;
    confidence: number;
    noteConfidence: number;
    onsetTimeMs: number;
  }>;
  noteEvents: Array<{
    midi: number;
    type: "onset" | "reOnset" | "offset";
    confidence: number;
    eventTimeMs: number;
  }>;
  activePitches: Array<{ midi: number; confidence: number }>;
  confidenceEvidence: Array<{ midi: number; confidence: number }>;
}

/** What a fixture pins for the target under investigation. */
export type ListenSafetyRegressionExpectation =
  | "no-advance"
  | "ordered-advance"
  | "late-advance"
  | "reported-unsafe-advance";

/** Decoder frames kept before the attack that establishes the carried-over state. */
export const LISTEN_FIXTURE_LEAD_MS = 128;

/** Decoder frames kept after the advancement under investigation. */
export const LISTEN_FIXTURE_TAIL_MS = 160;

/** A committed, audio-free reproduction of one measured safety event. */
export interface ListenSafetyRegressionFixture {
  id: string;
  label: string;
  /** Where the original event was measured. */
  origin: {
    renderer: string;
    piano: string;
    layer: string;
    sourceSequenceId: string;
    /** FNV PCM identity of the originating run; unique to that browser process. */
    sourcePcmHash: string;
    /** Decoded-structure identity, which does reproduce across runs. */
    sourceRecognitionStructureHash: string;
    sourceTargetIndex: number;
    /** Advancement time in the original run, used to re-verify a focused rerun. */
    sourceAdvancedAtMs: number;
    /** Causing attack in the original run's own attack numbering. */
    sourceAttackIndex: number | null;
  };
  classification: ListenAdvanceSafetyClassification[];
  /** Index of the fixture target the pinned expectation applies to. */
  targetIndex: number;
  expectation: ListenSafetyRegressionExpectation;
  /**
   * The exact advancement this fixture pins, in fixture-local indices, or null
   * when the expectation is that nothing advances. Pinning the category alone
   * would let a profile advance the target from a different repetition and still
   * report the fixture reproduced, which is the deviation most worth seeing.
   */
  pinnedAdvance: { advancedAtMs: number; sourceAttackIndex: number | null } | null;
  /** One-line statement of why the measured behavior is what it is. */
  conclusion: string;
  definition: ListenSequenceDefinition;
  intervalMs: number;
  sampleRate: number;
  chunkSize: number;
  relevantPitches: number[];
  frames: readonly ListenSafetyRegressionFrame[];
}

/**
 * Reduces a captured trace to the decoded frames a fixture needs, dropping PCM,
 * model scores, and evidence for pitches the fixture's targets never mention.
 * Onsets, note events, and active pitches are kept verbatim, because those are
 * the decoder outputs the matcher and the classification actually consume.
 */
export function extractListenSafetyRegressionFrames(
  trace: ListenRecognitionTrace,
  startMs: number,
  endMs: number,
  relevantPitches: readonly number[],
): ListenSafetyRegressionFrame[] {
  const relevant = new Set(relevantPitches);
  return trace.frames
    .filter((frame) => frame.capturedAtMs >= startMs && frame.capturedAtMs <= endMs)
    .map((frame): ListenSafetyRegressionFrame => ({
      capturedAtMs: frame.capturedAtMs,
      signalActive: frame.signalActive,
      onsets: frame.onsets.map(({ midi, confidence, noteConfidence, onsetTimeMs }) => ({
        midi,
        confidence,
        noteConfidence,
        onsetTimeMs,
      })),
      noteEvents: frame.noteEvents.map(({ midi, type, confidence, eventTimeMs }) => ({
        midi,
        type,
        confidence,
        eventTimeMs,
      })),
      activePitches: frame.activePitches.map(({ midi, confidence }) => ({ midi, confidence })),
      confidenceEvidence: frame.confidenceEvidence
        .filter(({ midi }) => relevant.has(midi))
        .map(({ midi, confidence }) => ({ midi, confidence })),
    }));
}

/** Identity and conclusion a generated fixture is committed under. */
export interface ListenSafetyRegressionFixtureIdentity {
  id: string;
  label: string;
  renderer: string;
  piano: string;
  layer: string;
  sourcePcmHash: string;
  sourceRecognitionStructureHash: string;
  expectation: ListenSafetyRegressionExpectation;
  conclusion: string;
}

/**
 * Builds a committed fixture from one diagnosed advancement.
 *
 * The fixture keeps the original absolute schedule: attacks retain their `at`
 * index, so every decoded timestamp is stored exactly as measured and no
 * re-timing arithmetic can silently shift the case. It spans the target before
 * the diagnosed one — which establishes the carried-over pitches — through the
 * target whose attack produced the advancement.
 */
export function buildListenSafetyRegressionFixture(
  sequence: MaterializedListenSequence,
  trace: ListenRecognitionTrace,
  forensics: ListenAdvanceForensics,
  identity: ListenSafetyRegressionFixtureIdentity,
): ListenSafetyRegressionFixture {
  const firstTargetIndex = Math.max(0, forensics.targetIndex - 1);
  const lastTargetIndex = Math.max(
    forensics.targetIndex,
    forensics.sourceAttackTargetIndex ?? forensics.targetIndex,
  );
  const targets = sequence.targets
    .slice(firstTargetIndex, lastTargetIndex + 1)
    .map(({ pitches }) => [...pitches]);
  const includedAttacks = sequence.attacks.filter((attack) => (
    attack.targetIndex >= firstTargetIndex && attack.targetIndex <= lastTargetIndex
  ));
  const localSourceAttackIndex = forensics.sourceAttackIndex === null
    ? null
    : includedAttacks.findIndex(({ index }) => index === forensics.sourceAttackIndex);
  if (localSourceAttackIndex === -1) {
    throw new Error(
      `The attack that caused target ${forensics.targetIndex} falls outside the fixture window.`,
    );
  }
  const attacks = includedAttacks
    .map((attack) => ({
      at: Math.round((attack.scheduledAtMs - LISTEN_SEQUENCE_PRE_ROLL_MS) / sequence.intervalMs),
      targetIndex: attack.targetIndex - firstTargetIndex,
      notes: attack.notes.map((scheduled) => ({
        midi: scheduled.midi,
        offsetMs: scheduled.attackTimeMs - attack.scheduledAtMs,
        holdMs: scheduled.releaseTimeMs - scheduled.attackTimeMs,
      })),
      expectedAdvance: attack.expectedAdvance,
      ...(attack.targetStart === undefined ? {} : { targetStart: attack.targetStart }),
    }));
  const definition: ListenSequenceDefinition = {
    id: identity.id,
    family: "safety-regression",
    label: identity.label,
    targets,
    attacks,
  };
  const relevantPitches = [...new Set(targets.flat())].sort((left, right) => left - right);
  const startMs = sequence.targets[firstTargetIndex].scheduledAttackTimeMs - LISTEN_FIXTURE_LEAD_MS;
  const endMs = forensics.advancedAtMs + LISTEN_FIXTURE_TAIL_MS;
  return {
    id: identity.id,
    label: identity.label,
    origin: {
      renderer: identity.renderer,
      piano: identity.piano,
      layer: identity.layer,
      sourceSequenceId: sequence.definition.id,
      sourcePcmHash: identity.sourcePcmHash,
      sourceRecognitionStructureHash: identity.sourceRecognitionStructureHash,
      sourceTargetIndex: forensics.targetIndex,
      sourceAdvancedAtMs: forensics.advancedAtMs,
      sourceAttackIndex: forensics.sourceAttackIndex,
    },
    classification: [...forensics.classification],
    targetIndex: forensics.targetIndex - firstTargetIndex,
    expectation: identity.expectation,
    pinnedAdvance: identity.expectation === "no-advance"
      ? null
      : { advancedAtMs: forensics.advancedAtMs, sourceAttackIndex: localSourceAttackIndex },
    conclusion: identity.conclusion,
    definition,
    intervalMs: sequence.intervalMs,
    sampleRate: trace.sampleRate,
    chunkSize: trace.chunkSize,
    relevantPitches,
    frames: extractListenSafetyRegressionFrames(trace, startMs, endMs, relevantPitches),
  };
}

/**
 * Rebuilds a replayable trace from a fixture. PCM and model scores are omitted
 * because no matcher or classification path reads them; every value that is
 * read is stored verbatim from the measured run.
 */
export function listenSafetyRegressionTrace(
  fixture: ListenSafetyRegressionFixture,
): ListenRecognitionTrace {
  // Metadata only: replay never reads the renderer, but a fixture should still
  // say which audio path produced the frames it stores.
  const renderer: ListenBenchmarkRendererConfiguration =
    LISTEN_BENCHMARK_RENDERERS.find(({ version }) => version === fixture.origin.renderer) ??
    LISTEN_BENCHMARK_RENDERER;
  return {
    sequenceId: fixture.id,
    intervalMs: fixture.intervalMs,
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

export function listenSafetyRegressionSequence(
  fixture: ListenSafetyRegressionFixture,
): MaterializedListenSequence {
  return materializeListenSequence(fixture.definition, fixture.intervalMs);
}

/** One profile's replay of one committed regression fixture. */
export interface ListenSafetyRegressionOutcome {
  fixtureId: string;
  /** A registry identifier, or `candidate` for an exploratory sweep profile. */
  profileId: string;
  targetIndex: number;
  expectation: ListenSafetyRegressionExpectation;
  advanced: boolean;
  orderedAdvanced: boolean;
  advancedAtMs: number | null;
  /** The attack this replay credited the advancement to, in fixture indices. */
  sourceAttackIndex: number | null;
  falseAdvance: boolean;
  lateAdvance: boolean;
  /** Every way this replay differed from the pinned advancement. */
  deviations: string[];
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  /**
   * True when this profile reproduces the fixture's pinned behavior. This is a
   * regression check for the named profiles, not an eligibility gate: an
   * exploratory profile that recognizes the case earlier deviates without being
   * unsafe, so only `worseThanBaseline` may reject a candidate.
   */
  satisfied: boolean;
  /** True when this profile is less safe here than the profile it was measured with. */
  worseThanBaseline: boolean;
}

export interface ListenSafetyRegressionSummary {
  fixtureCount: number;
  outcomes: ListenSafetyRegressionOutcome[];
  falseAdvanceCount: number;
  skippedAdvanceCount: number;
  duplicateAdvanceCount: number;
  /** Replays that no longer reproduce their pinned behavior. Reported, not gating. */
  deviationCount: number;
  /** False as soon as any profile makes a diagnosed case less safe than baseline. */
  passed: boolean;
}

function replayFixture(
  fixture: ListenSafetyRegressionFixture,
  profile: ListenMatcherThresholds,
): { run: ListenSequenceRunResult; observations: ListenSequenceAdvancementObservation[] } {
  const observations: ListenSequenceAdvancementObservation[] = [];
  const run = replayListenSequenceTrace(
    listenSafetyRegressionSequence(fixture),
    listenSafetyRegressionTrace(fixture),
    "current-matcher",
    listenMatcherThresholds(profile),
    (observation) => observations.push(observation),
  );
  return { run, observations };
}

/**
 * Categories the expectation requires. Kept separate from the pinned timing so a
 * failure says whether the behavior changed kind or only moved.
 */
function expectationDeviations(
  fixture: ListenSafetyRegressionFixture,
  event: ListenSequenceRunResult["events"][number] | undefined,
): string[] {
  const advanced = event?.advanced ?? false;
  const deviations: string[] = [];
  if (fixture.expectation === "no-advance") {
    if (advanced) deviations.push("advanced, expected no advance");
    return deviations;
  }
  if (!advanced) {
    deviations.push(`did not advance, expected ${fixture.expectation}`);
    return deviations;
  }
  if (fixture.expectation === "ordered-advance" && !event?.orderedAdvanced) {
    deviations.push("advanced, but not from this target's own attack");
  }
  if (fixture.expectation === "late-advance") {
    if (!event?.lateAdvance) deviations.push("advance is no longer classified late");
    if (event?.falseAdvance) deviations.push("advance is now classified false");
    if (event?.skipped) deviations.push("advance is now classified skipped");
    if (event?.duplicate) deviations.push("advance is now classified duplicate");
  }
  if (fixture.expectation === "reported-unsafe-advance" && !event?.falseAdvance) {
    deviations.push("advance is no longer classified false");
  }
  return deviations;
}

function outcomeFor(
  fixture: ListenSafetyRegressionFixture,
  profileId: string,
  profile: ListenMatcherThresholds,
  baseline: ListenSequenceRunResult,
): ListenSafetyRegressionOutcome {
  const { run, observations } = replayFixture(fixture, profile);
  const event = run.events[fixture.targetIndex];
  const observation = observations.find(({ targetIndex }) => targetIndex === fixture.targetIndex);
  const advancedAtMs = event?.advancedAtMs ?? null;
  const sourceAttackIndex = observation?.sourceAttackIndex ?? null;
  const deviations = expectationDeviations(fixture, event);
  // A late advance that moved to a different repetition of the same chord is
  // still a late advance, so only the pinned timing can catch it.
  const pinned = fixture.pinnedAdvance;
  if (pinned) {
    if (advancedAtMs !== pinned.advancedAtMs) {
      deviations.push(`advanced at ${advancedAtMs} ms, pinned ${pinned.advancedAtMs} ms`);
    }
    if (sourceAttackIndex !== pinned.sourceAttackIndex) {
      deviations.push(
        `advance credited to attack ${sourceAttackIndex}, pinned ${pinned.sourceAttackIndex}`,
      );
    }
  } else if (advancedAtMs !== null) {
    deviations.push(`advanced at ${advancedAtMs} ms, pinned no advance`);
  }
  return {
    fixtureId: fixture.id,
    profileId,
    targetIndex: fixture.targetIndex,
    expectation: fixture.expectation,
    advanced: event?.advanced ?? false,
    orderedAdvanced: event?.orderedAdvanced ?? false,
    advancedAtMs,
    sourceAttackIndex,
    falseAdvance: event?.falseAdvance ?? false,
    lateAdvance: event?.lateAdvance ?? false,
    deviations,
    falseAdvanceCount: run.summary.falseAdvanceCount,
    skippedAdvanceCount: run.summary.skippedAdvanceCount,
    duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
    satisfied: deviations.length === 0,
    worseThanBaseline: run.summary.falseAdvanceCount > baseline.summary.falseAdvanceCount ||
      run.summary.skippedAdvanceCount > baseline.summary.skippedAdvanceCount ||
      run.summary.duplicateAdvanceCount > baseline.summary.duplicateAdvanceCount,
  };
}

/**
 * Replays every committed regression against one profile. This is the gate that
 * keeps a diagnosed domain visible: no profile can report a clean safety summary
 * while quietly regressing a case that was already understood. Each fixture is
 * compared against its own `baseline-v1` replay, so the reference is the frozen
 * registry entry rather than whichever profile is being tested.
 */
export function replayListenSafetyRegressions(
  profile: ListenMatcherThresholds,
  profileId = "candidate",
  fixtures: readonly ListenSafetyRegressionFixture[] = LISTEN_SAFETY_REGRESSION_FIXTURES,
): ListenSafetyRegressionSummary {
  return summarizeOutcomes(fixtures, fixtures.map((fixture) => outcomeFor(
    fixture,
    profileId,
    profile,
    replayFixture(fixture, LISTEN_MATCHER_PROFILES["baseline-v1"]).run,
  )));
}

/** Replays every committed regression against all three named profiles. */
export function summarizeListenSafetyRegressions(
  fixtures: readonly ListenSafetyRegressionFixture[] = LISTEN_SAFETY_REGRESSION_FIXTURES,
): ListenSafetyRegressionSummary {
  return summarizeOutcomes(fixtures, fixtures.flatMap((fixture) => {
    const baseline = replayFixture(fixture, LISTEN_MATCHER_PROFILES["baseline-v1"]).run;
    return LISTEN_MATCHER_PROFILE_IDS.map((profileId) => outcomeFor(
      fixture,
      profileId,
      LISTEN_MATCHER_PROFILES[profileId],
      baseline,
    ));
  }));
}

function summarizeOutcomes(
  fixtures: readonly ListenSafetyRegressionFixture[],
  outcomes: readonly ListenSafetyRegressionOutcome[],
): ListenSafetyRegressionSummary {
  return {
    fixtureCount: fixtures.length,
    outcomes: [...outcomes],
    falseAdvanceCount: outcomes.reduce((total, outcome) => total + outcome.falseAdvanceCount, 0),
    skippedAdvanceCount: outcomes.reduce((total, outcome) => total + outcome.skippedAdvanceCount, 0),
    duplicateAdvanceCount: outcomes.reduce(
      (total, outcome) => total + outcome.duplicateAdvanceCount,
      0,
    ),
    deviationCount: outcomes.filter(({ satisfied }) => !satisfied).length,
    passed: outcomes.every(({ worseThanBaseline }) => !worseThanBaseline),
  };
}

/**
 * The complete safety verdict for one profile: the reusable continuous-sequence
 * safety families plus every committed regression replayed with that same
 * profile. Benchmarks summarize safety through this function so a diagnosed
 * failure domain cannot be dropped from a "zero safety events" claim.
 */
export interface ListenSafetySummary extends ListenSequenceSafetySummary {
  regressions: ListenSafetyRegressionSummary;
}

export function summarizeListenSafety(
  runs: readonly ListenSequenceRunResult[],
  profile: ListenMatcherThresholds,
  profileId = "candidate",
): ListenSafetySummary {
  const sequences = summarizeListenSequenceSafety(runs);
  const regressions = replayListenSafetyRegressions(profile, profileId);
  return {
    ...sequences,
    regressions,
    passed: sequences.passed && regressions.passed,
  };
}

/** Identity of a freshly captured run, matched against a committed fixture. */
export interface ListenFocusedCaseIdentity {
  renderer: string;
  piano: string;
  layer: string;
  sequenceId: string;
  recognitionStructureHash: string;
  forensics: readonly ListenAdvanceForensics[];
}

/** One committed fixture's verdict on a freshly captured run of its own case. */
export interface ListenFocusedCaseVerification {
  fixtureId: string;
  sourceTargetIndex: number;
  expectedRecognitionStructureHash: string;
  actualRecognitionStructureHash: string;
  differences: string[];
}

/**
 * Re-verifies a freshly captured run against every committed fixture generated
 * from the same renderer, piano, layer, and passage.
 *
 * Without this the committed frames would be the only thing ever checked, and a
 * changed model, renderer, or decoder could silently stop producing the event
 * the fixture was cut from while the fixture itself kept passing. The
 * decoded-structure hash is the identity that reproduces across browser
 * processes, so it is what the rerun must match, together with the forensic
 * identity of the advancement itself.
 */
export function verifyFocusedCaseAgainstRegressions(
  identity: ListenFocusedCaseIdentity,
  fixtures: readonly ListenSafetyRegressionFixture[] = LISTEN_SAFETY_REGRESSION_FIXTURES,
): ListenFocusedCaseVerification[] {
  return fixtures
    .filter(({ origin }) => (
      origin.renderer === identity.renderer &&
      origin.piano === identity.piano &&
      origin.layer === identity.layer &&
      origin.sourceSequenceId === identity.sequenceId
    ))
    .map((fixture): ListenFocusedCaseVerification => {
      const differences: string[] = [];
      if (identity.recognitionStructureHash !== fixture.origin.sourceRecognitionStructureHash) {
        differences.push(
          `decoded structure hash ${identity.recognitionStructureHash}, ` +
          `expected ${fixture.origin.sourceRecognitionStructureHash}`,
        );
      }
      const observed = identity.forensics.find(
        ({ targetIndex }) => targetIndex === fixture.origin.sourceTargetIndex,
      );
      if (!observed) {
        differences.push(
          `no advancement was counted against a safety gate at target ` +
          `${fixture.origin.sourceTargetIndex}`,
        );
      } else {
        const expectedClassification = [...fixture.classification].sort().join("+");
        const actualClassification = [...observed.classification].sort().join("+");
        if (actualClassification !== expectedClassification) {
          differences.push(
            `target ${observed.targetIndex} is now ${actualClassification}, ` +
            `expected ${expectedClassification}`,
          );
        }
        if (observed.advancedAtMs !== fixture.origin.sourceAdvancedAtMs) {
          differences.push(
            `target ${observed.targetIndex} advanced at ${observed.advancedAtMs} ms, ` +
            `expected ${fixture.origin.sourceAdvancedAtMs} ms`,
          );
        }
        if (observed.sourceAttackIndex !== fixture.origin.sourceAttackIndex) {
          differences.push(
            `target ${observed.targetIndex} was credited to attack ` +
            `${observed.sourceAttackIndex}, expected ${fixture.origin.sourceAttackIndex}`,
          );
        }
      }
      return {
        fixtureId: fixture.id,
        sourceTargetIndex: fixture.origin.sourceTargetIndex,
        expectedRecognitionStructureHash: fixture.origin.sourceRecognitionStructureHash,
        actualRecognitionStructureHash: identity.recognitionStructureHash,
        differences,
      };
    });
}

/**
 * Fails the capture when a rerun of a committed case no longer reproduces it. A
 * genuine model, renderer, or decoder change is expected to trip this; the
 * response is to re-diagnose the case and regenerate its fixture, not to relax
 * the check.
 */
export function assertFocusedCaseMatchesRegressions(
  identity: ListenFocusedCaseIdentity,
  fixtures: readonly ListenSafetyRegressionFixture[] = LISTEN_SAFETY_REGRESSION_FIXTURES,
): ListenFocusedCaseVerification[] {
  const verifications = verifyFocusedCaseAgainstRegressions(identity, fixtures);
  const failed = verifications.filter(({ differences }) => differences.length > 0);
  if (failed.length > 0) {
    throw new Error(
      "A committed safety regression no longer reproduces: " +
      failed
        .map(({ fixtureId, differences }) => `${fixtureId} (${differences.join("; ")})`)
        .join(", "),
    );
  }
  return verifications;
}

/** Committed regressions. Each entry is a diagnosed, previously measured event. */
export const LISTEN_SAFETY_REGRESSION_FIXTURES: readonly ListenSafetyRegressionFixture[] =
  LISTEN_SAFETY_REGRESSION_FIXTURE_LIST;
