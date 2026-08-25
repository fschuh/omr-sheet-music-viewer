/**
 * Synthetic evidence for the completed round-two branch, which this round did not
 * take.
 *
 * Round two accepted no ablation, so the committed chain exercises only the
 * not-run branch: there is no eligibility manifest with entries, no confirmation
 * archive, and no live corpus anywhere in the repository. The completed branch is
 * nonetheless the one a later round will take, and its rules — live gates
 * rederived from replayed performances, membership from those gates, a default
 * chosen by the frozen ordered rule and the frozen materiality — are only real if
 * they can be exercised.
 *
 * The live trials here are performances, not verdicts: each carries an authored
 * score and a decoded trace, and its outcomes are produced by replaying the
 * matcher over them, exactly as the archive requires. A test that wants a
 * candidate to fail therefore changes what the decoder reported, not what the
 * outcome says — which is the point of the archive format.
 *
 * These builders are test evidence and are never imported by production code or
 * by an emitter; the emitters read committed files.
 */

import {
  LISTEN_MATCHER_PROFILES,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  LISTEN_LIVE_BASELINE_PROFILE_ID,
  LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES,
  LISTEN_LIVE_REQUIRED_TRIAL_CLASSES,
  LISTEN_ROUND_TWO_LIVE_ARCHIVE_NAME,
  listenRoundTwoLiveArchiveDigest,
  listenRoundTwoLiveTrialReplay,
  type ListenLiveDecodedTrace,
  type ListenLiveSourceKind,
  type ListenLiveTrial,
  type ListenLiveTrialClass,
  type ListenRoundTwoLiveArchive,
} from "./listenRoundTwoLiveEvidence";
import type { ListenRecognitionFrame, ListenSequenceDefinition } from "./listenSequenceBenchmark";

const FRAME_MS = 32;
const INTERVAL_MS = 1_000;
/** The pre-roll `materializeListenSequence` schedules every attack after. */
const PRE_ROLL_MS = 500;

interface DecodedPitch {
  midi: number;
  onset?: number;
  noteConfidence?: number;
  active: number;
  event?: boolean;
}

interface PerformedAttack {
  atMs: number;
  holdMs: number;
  decoded: DecodedPitch[];
}

function strong(midi: number): DecodedPitch {
  return { midi, onset: 0.99, noteConfidence: 0.99, active: 0.95, event: true };
}

/** Continuous 32 ms frames, the cadence the decoder actually reports at. */
function performedFrames(
  relevantPitches: readonly number[],
  attacks: readonly PerformedAttack[],
): ListenRecognitionFrame[] {
  const snapped = attacks.map((attack) => ({
    ...attack,
    atMs: Math.ceil(attack.atMs / FRAME_MS) * FRAME_MS,
  }));
  const last = snapped[snapped.length - 1];
  const frames: ListenRecognitionFrame[] = [];
  for (let capturedAtMs = 0; capturedAtMs <= last.atMs + last.holdMs; capturedAtMs += FRAME_MS) {
    const sounding = new Map<number, number>();
    for (const attack of snapped) {
      if (capturedAtMs < attack.atMs || capturedAtMs >= attack.atMs + attack.holdMs) continue;
      for (const decoded of attack.decoded) sounding.set(decoded.midi, decoded.active);
    }
    const attacked = snapped.find((attack) => attack.atMs === capturedAtMs)?.decoded ?? [];
    frames.push({
      capturedAtMs,
      onsets: attacked.filter(({ onset }) => onset !== undefined).map((decoded) => ({
        midi: decoded.midi,
        confidence: decoded.onset!,
        noteConfidence: decoded.noteConfidence ?? decoded.onset!,
        onsetTimeMs: capturedAtMs,
      })),
      noteEvents: attacked.filter(({ event }) => event).map((decoded) => ({
        midi: decoded.midi,
        type: "onset" as const,
        confidence: decoded.onset ?? decoded.active,
        eventTimeMs: capturedAtMs,
      })),
      activePitches: [...sounding].map(([midi, confidence]) => ({ midi, confidence })),
      confidenceEvidence: relevantPitches.map((midi) => ({
        midi,
        confidence: sounding.get(midi) ?? 0,
      })),
      modelScores: [],
      modelStates: relevantPitches.map((midi) => sounding.has(midi) ? 3 : 0),
      signalActive: sounding.size > 0,
      inferenceDurationMs: 4,
    });
  }
  return frames;
}

function decodedTrace(
  relevantPitches: readonly number[],
  attacks: readonly PerformedAttack[],
): ListenLiveDecodedTrace {
  return {
    sampleRate: 16_000,
    chunkSize: 512,
    relevantPitches: [...relevantPitches],
    renderer: {
      key: "live",
      label: "Live acoustic capture",
      kind: "direct",
    } as unknown as ListenLiveDecodedTrace["renderer"],
    audioDiagnostics: { frameCount: 512, durationMs: 32, peak: 0.4, rms: 0.1 } as unknown as
      ListenLiveDecodedTrace["audioDiagnostics"],
    maximumInferenceMs: 4,
    frames: performedFrames(relevantPitches, attacks),
  };
}

/** The chord each positive trial class is played on. */
const TRIAL_CHORDS: Readonly<Record<ListenLiveTrialClass, readonly number[]>> = Object.freeze({
  "single-note": [64],
  chord: [55, 59, 62],
  "repeated-chord": [62, 74, 82],
  "wrong-note": [60],
  "wrong-chord-member": [55, 59, 62],
  "added-note": [55, 59, 62],
  "omitted-bass": [48, 60, 67],
  "silence-noise": [67],
});

export interface ListenLiveTrialShape {
  trialClass: ListenLiveTrialClass;
  setupId: string;
}

/**
 * What the decoder reported for one trial, before any profile reads it.
 *
 * A test bends the performance — an onset that was never sounded, a re-onset the
 * decoder withheld — and every profile column then replays over the change. There
 * is no way to bend one column's outcome without bending the evidence.
 */
export type ListenLivePerformanceOverride = (
  shape: ListenLiveTrialShape,
) => Partial<{ decoded: PerformedAttack[]; }>;

function performance(shape: ListenLiveTrialShape): {
  sequence: ListenSequenceDefinition;
  attacks: PerformedAttack[];
  chord: readonly number[];
} {
  const chord = TRIAL_CHORDS[shape.trialClass];
  const at = (index: number) => PRE_ROLL_MS + index * INTERVAL_MS;
  const notesOf = (pitches: readonly number[]) => pitches.map((midi) => ({ midi }));
  switch (shape.trialClass) {
    case "repeated-chord": {
      // The `v05` shape: a first attack the decoder does not fully re-onset, then
      // an identical repetition it does.
      const [bass, ...upper] = chord;
      return {
        chord,
        sequence: {
          id: `${shape.setupId}/repeated-chord`,
          family: "repeated",
          label: "Repeated chord",
          targets: [[...chord], [...chord]],
          attacks: [
            { at: 0, targetIndex: 0, notes: notesOf(chord), expectedAdvance: true },
            { at: 1, targetIndex: 1, notes: notesOf(chord), expectedAdvance: true },
          ],
        },
        attacks: [
          {
            atMs: at(0),
            holdMs: 900,
            // The carried upper voices sit at 0.25: above the open candidates'
            // 0.20 active gate and below the incumbent's 0.35, which is the
            // measured shape of the `v05` case rather than an invented one.
            decoded: [strong(bass), ...upper.map((midi) => ({ midi, active: 0.25 }))],
          },
          { atMs: at(1), holdMs: 900, decoded: chord.map(strong) },
        ],
      };
    }
    case "omitted-bass": {
      const [bass, ...played] = chord;
      return {
        chord,
        sequence: {
          id: `${shape.setupId}/omitted-bass`,
          family: "safety",
          label: "Omitted bass",
          targets: [[...chord]],
          attacks: [
            { at: 0, targetIndex: 0, notes: notesOf(played), expectedAdvance: false, targetStart: true },
          ],
        },
        // The bass was never played, and the decoder does not hallucinate it here.
        attacks: [{ atMs: at(0), holdMs: 900, decoded: played.map(strong) }],
      };
    }
    case "wrong-note":
    case "wrong-chord-member":
    case "added-note":
    case "silence-noise": {
      const target = shape.trialClass === "added-note" ? chord : chord;
      const played = shape.trialClass === "wrong-note"
        ? [target[0] + 1]
        : shape.trialClass === "wrong-chord-member"
        ? [target[0], target[1] + 1, target[2]]
        : shape.trialClass === "added-note"
        // A semitone above the top note: deliberately not an octave or a fifth of
        // any target pitch, which the recognizer would fold back as a harmonic.
        ? [...target, target[target.length - 1] + 1]
        : [];
      return {
        chord: target,
        sequence: {
          id: `${shape.setupId}/${shape.trialClass}`,
          family: "safety",
          label: shape.trialClass,
          targets: [[...target]],
          attacks: [
            {
              at: 0,
              targetIndex: 0,
              notes: notesOf(played.length === 0 ? [target[0]] : played),
              expectedAdvance: false,
              targetStart: true,
            },
          ],
        },
        attacks: [{
          atMs: at(0),
          holdMs: 900,
          // The deliberately wrong pitch is decoded above every unexpected-note
          // gate, so no profile may treat it as noise.
          decoded: played.map((midi) => (
            target.includes(midi) ? strong(midi) : { ...strong(midi), active: 0.995 }
          )),
        }],
      };
    }
    default: {
      return {
        chord,
        sequence: {
          id: `${shape.setupId}/${shape.trialClass}`,
          family: "correct",
          label: shape.trialClass,
          targets: [[...chord]],
          attacks: [
            { at: 0, targetIndex: 0, notes: notesOf(chord), expectedAdvance: true },
          ],
        },
        attacks: [{ atMs: at(0), holdMs: 900, decoded: chord.map(strong) }],
      };
    }
  }
}

function registerBandOf(chord: readonly number[]): "low" | "middle" | "high" {
  const lowest = Math.min(...chord);
  return lowest < 52 ? "low" : lowest < 72 ? "middle" : "high";
}

function liveTrial(
  shape: ListenLiveTrialShape,
  profileIds: readonly string[],
  override: ListenLivePerformanceOverride | undefined,
): ListenLiveTrial {
  const built = performance(shape);
  const attacks = override?.(shape)?.decoded ?? built.attacks;
  const negative = LISTEN_LIVE_NEGATIVE_TRIAL_CLASSES.includes(shape.trialClass);
  const relevantPitches = [...new Set([
    ...built.chord,
    ...attacks.flatMap(({ decoded }) => decoded.map(({ midi }) => midi)),
  ])].sort((left, right) => left - right);
  const trial: ListenLiveTrial = {
    trialId: `${shape.setupId}/${shape.trialClass}`,
    sessionId: shape.setupId,
    trialClass: shape.trialClass,
    expectedCorrect: !negative,
    musical: {
      scorePosition: 0,
      chordSize: built.chord.length,
      registerBand: registerBandOf(built.chord),
      dynamic: "medium",
      articulation: "normal",
      tempoIntervalMs: INTERVAL_MS,
      ambiguity: "distinguishable",
      safetyReason: negative
        ? `The performance omits or replaces a required pitch of ${built.chord.join("/")}.`
        : null,
      repeatedChordPitches: shape.trialClass === "repeated-chord" ? [...built.chord] : null,
    },
    intervalMs: INTERVAL_MS,
    sequence: built.sequence,
    decodedTrace: decodedTrace(relevantPitches, attacks),
    outcomes: [],
  };
  // The outcomes are the replay's, never the fixture's opinion.
  return {
    ...trial,
    outcomes: [LISTEN_LIVE_BASELINE_PROFILE_ID, ...profileIds].map((profileId) => ({
      profileId,
      ...listenRoundTwoLiveTrialReplay(
        trial,
        listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId as ListenMatcherProfileId]),
      ),
    })),
  };
}

export interface ListenLiveArchiveFixtureOptions {
  eligibilityManifestDigest: string;
  profileIds: readonly string[];
  setups?: ReadonlyArray<{ setupId: string; source: ListenLiveSourceKind }>;
  trialClasses?: readonly ListenLiveTrialClass[];
  /** Bends what the decoder reported, which every column then replays over. */
  performance?: ListenLivePerformanceOverride;
}

/** One archived live session covering both source families and every trial class. */
export function listenLiveArchiveFixture(
  options: ListenLiveArchiveFixtureOptions,
): ListenRoundTwoLiveArchive {
  const setups = options.setups ?? [
    { setupId: "acoustic-upright-room-a", source: "acoustic-piano" as const },
    { setupId: "digital-stage-line", source: "digital-line-output" as const },
  ];
  const trialClasses = options.trialClasses ?? LISTEN_LIVE_REQUIRED_TRIAL_CLASSES;
  const record = {
    name: LISTEN_ROUND_TWO_LIVE_ARCHIVE_NAME,
    formatVersion: 1 as const,
    roundId: "round-two" as const,
    eligibilityManifestDigest: options.eligibilityManifestDigest,
    baselineProfileId: LISTEN_LIVE_BASELINE_PROFILE_ID,
    profileIds: [LISTEN_LIVE_BASELINE_PROFILE_ID, ...options.profileIds],
    setups: setups.map((setup) => ({
      setupId: setup.setupId,
      source: setup.source,
      instrumentLabel: `${setup.setupId} instrument`,
      microphoneLabel: "cardioid at 1 m",
      roomLabel: "ordinary",
      trials: trialClasses.map((trialClass) => liveTrial(
        { trialClass, setupId: setup.setupId },
        options.profileIds,
        options.performance,
      )),
    })),
  };
  return {
    ...record,
    digest: {
      algorithm: "fnv1a-32-canonical-json" as const,
      value: listenRoundTwoLiveArchiveDigest(record),
    },
  };
}

/** A decoded attack, exposed so a test can state what the decoder reported. */
export function listenLivePerformedAttack(
  atIntervalIndex: number,
  decoded: DecodedPitch[],
  holdMs = 900,
): PerformedAttack {
  return { atMs: PRE_ROLL_MS + atIntervalIndex * INTERVAL_MS, holdMs, decoded };
}

export { strong as listenLiveStrongPitch };

export interface ListenConfirmationCounterShape {
  profileId: string;
  rendererKey: string;
  instrument: string;
  traceId: string;
  isBaseline: boolean;
}

export interface ListenConfirmationArchiveFixtureOptions {
  profileIds: readonly string[];
  tracesPerLeaf?: number;
  /** Per-column, per-trace counter overrides, applied over the uneventful defaults. */
  counters?: (shape: ListenConfirmationCounterShape) => Record<string, number>;
  /** Per-column, per-renderer domain latency, in milliseconds. */
  p95OnsetToAdvanceMs?: (profileId: string, rendererKey: string) => number;
  /** Per-column isolated correct-advance counts, the Task 23 materiality axis. */
  isolatedCorrectAdvanceCount?: (profileId: string, rendererKey: string) => number;
}

const CONFIRMATION_LEAVES = Object.freeze([
  { rendererKey: "direct", instrument: "none" },
  { rendererKey: "direct", instrument: "salamander" },
  { rendererKey: "tone", instrument: "none" },
  { rendererKey: "tone", instrument: "salamander" },
]);

/**
 * One archived confirmation repetition, carrying what the ranking and the frozen
 * materiality both read.
 *
 * The ranking reads per-trace outcome rows and per-domain percentiles; Task 23's
 * materiality reads the measured `isolated` domain summaries. Both are built here
 * so a promotion can be earned or refused for the reasons the policy names.
 */
export function listenConfirmationArchiveFixture(
  options: ListenConfirmationArchiveFixtureOptions,
): Record<string, unknown> {
  const perLeaf = options.tracesPerLeaf ?? 2;
  const columns = [LISTEN_LIVE_BASELINE_PROFILE_ID, ...options.profileIds];
  const captures = CONFIRMATION_LEAVES.flatMap((leaf) => (
    Array.from({ length: perLeaf }, (_unused, index) => ({
      traceId: `${leaf.rendererKey}/${leaf.instrument}/trace-${index}`,
      rendererKey: leaf.rendererKey,
      piano: leaf.instrument === "none" ? null : leaf.instrument,
      partition: "discovery",
      suite: leaf.instrument === "none" ? "isolated" : "dynamics-constant",
    }))
  ));
  const outcomes = captures.flatMap((capture, index) => columns.map((profileId) => {
    const isBaseline = profileId === LISTEN_LIVE_BASELINE_PROFILE_ID;
    return {
      traceId: capture.traceId,
      profileId,
      correctAdvanceCount: isBaseline && index % perLeaf === 0 ? 0 : 1,
      courseClearCorrectAdvanceCount: 0,
      independentMatchCount: isBaseline ? 3 : 4,
      orderedAdvanceCount: isBaseline ? 1 : 2,
      completePassageCount: 1,
      falseAdvanceCount: 0,
      skippedAdvanceCount: 0,
      duplicateAdvanceCount: 0,
      incompleteCarriedBassAdvances: 0,
      ...(options.counters?.({
        profileId,
        rendererKey: capture.rendererKey,
        instrument: capture.piano ?? "none",
        traceId: capture.traceId,
        isBaseline,
      }) ?? {}),
    };
  }));
  const domainSummaries = CONFIRMATION_LEAVES.flatMap((leaf) => columns.map((profileId) => ({
    profileId,
    gateCode: "release-isolated-latency",
    domainId: `release-isolated-latency#${leaf.rendererKey}/${leaf.instrument}`,
    traceIds: captures
      .filter((capture) => capture.rendererKey === leaf.rendererKey &&
        (capture.piano ?? "none") === leaf.instrument)
      .map(({ traceId }) => traceId),
    p95OnsetToAdvanceMs: options.p95OnsetToAdvanceMs?.(profileId, leaf.rendererKey) ?? 180,
  })));
  // The measured isolated domain, in the shape Task 23's frozen materiality reads.
  const isolated = {
    renderers: ["direct", "tone"].map((rendererKey) => ({
      rendererKey,
      correctTrialCount: 100,
      profiles: columns.map((profileId) => ({
        profileId,
        correctAdvanceCount: options.isolatedCorrectAdvanceCount?.(profileId, rendererKey) ??
          (profileId === LISTEN_LIVE_BASELINE_PROFILE_ID ? 90 : 95),
        courseClearAdvanceCount: 50,
        courseClearCorrectTrialCount: 54,
        summary: { p95OnsetToAdvanceMs: 180, falseAdvanceCount: 0 },
      })),
    })),
  };
  return { name: "listen-profile-validation", captures, outcomes, domainSummaries, isolated };
}
