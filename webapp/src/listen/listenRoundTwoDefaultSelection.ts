/**
 * The Candidate selection rule, applied to archived measurements.
 *
 * The plan's rule is an ordered one — fewer live safety failures, then higher
 * held-out live correct advancement, then higher automated independent
 * recognition, then ordered prefix and complete passages, then lower latency, and
 * finally smaller distance from `baseline-v1` — and it exists so a default is
 * chosen by evidence rather than named. This module therefore takes no supplied
 * winner: every input is recomputed from the frozen confirmation archive and the
 * Task 15 live archives, and the selected identifier is the one the rule produces.
 *
 * Two properties matter more than the ordering itself.
 *
 * Each step compares by dominance across setups and renderers rather than by a
 * total. A candidate wins a step only when it is at least as good everywhere and
 * better somewhere, so a large digital-piano gain cannot pay for an acoustic-piano
 * loss and a Tone gain cannot pay for a Direct one. When neither candidate
 * dominates, the step is a tie and the rule moves on.
 *
 * The rule may decline to select. If no candidate beats every other under the
 * ordered comparison, or if the winner shows no material improvement over the
 * incumbent under the frozen promotion boundaries, nothing is promoted: an
 * unresolvable tie is a finding, not a licence to pick one.
 */

import {
  LISTEN_MATCHER_PROFILES,
  isListenMatcherProfileId,
  listenMatcherThresholds,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import type { ListenMaterialImprovementAssessment } from "./listenProfileValidationPolicy";
import {
  listenPromotionMaterialImprovements,
  type ListenProfileValidationDomainResults,
} from "./benchmarks/listenProfileValidationBenchmark";
import {
  LISTEN_LIVE_BASELINE_PROFILE_ID,
  LISTEN_LIVE_SOURCE_FAMILIES,
  LISTEN_LIVE_UNSAFE_COUNTERS,
  type ListenRoundTwoLiveArchive,
} from "./benchmarks/listenRoundTwoLiveEvidence";

/** The ordered decision steps, in the order the plan freezes them. */
export const LISTEN_ROUND_TWO_SELECTION_STEPS = Object.freeze([
  "live-safety",
  "live-correct-advancement",
  "automated-independent-recognition",
  "ordered-and-complete-progress",
  "latency",
  "distance-from-baseline",
] as const);

export type ListenRoundTwoSelectionStep = typeof LISTEN_ROUND_TWO_SELECTION_STEPS[number];

/** The renderer columns every automated measurement is kept separate by. */
export const LISTEN_ROUND_TWO_RENDERER_KEYS: readonly string[] = Object.freeze(["direct", "tone"]);

/** The archive counters that are unsafe events, summed only within one trace. */
const ARCHIVE_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvances",
] as const);

/**
 * One measured leaf of the automated evidence.
 *
 * The leaf is a renderer *and* an instrument, because the plan ranks independent
 * recognition "across renderers and instruments": a Direct total that averages a
 * Splendid gain over a Salamander loss has already hidden the comparison the step
 * is for. Traces with no instrument of their own — the isolated and sequence
 * corpora — carry the `none` instrument, so they are still a leaf rather than
 * being folded into a piano's.
 */
export interface ListenRoundTwoRendererMeasurement {
  rendererKey: string;
  instrument: string;
  traceCount: number;
  correctAdvanceCount: number;
  independentMatchCount: number;
  orderedAdvanceCount: number;
  completePassageCount: number;
  unsafeEventCount: number;
  /** The worst domain percentile, never a mean: one slow domain must stay visible. */
  worstP95OnsetToAdvanceMs: number | null;
}

export interface ListenRoundTwoAutomatedMeasurement {
  profileId: string;
  renderers: readonly ListenRoundTwoRendererMeasurement[];
}

export interface ListenRoundTwoLiveSetupMeasurement {
  setupId: string;
  sourceFamily: "acoustic" | "digital";
  expectedCorrectTrialCount: number;
  correctAdvanceCount: number;
  unsafeEventCount: number;
}

export interface ListenRoundTwoLiveMeasurement {
  profileId: string;
  setups: readonly ListenRoundTwoLiveSetupMeasurement[];
}

/* ------------------------------------------------------------------------- *
 * Measurements, rederived from the archives
 * ------------------------------------------------------------------------- */

function archiveRecord(archive: unknown): Record<string, unknown> {
  const record = Array.isArray(archive) ? archive[0] : archive;
  if (typeof record !== "object" || record === null) {
    throw new Error("A confirmation archive is one record.");
  }
  return record as Record<string, unknown>;
}

/**
 * Rederives every column's automated measurements from one confirmation archive.
 *
 * The rows are the archive's own per-trace outcomes, grouped by the renderer its
 * captures record, so nothing here reads a summary the archive states about
 * itself except the per-domain latency percentile, which has no per-trace form —
 * and that is taken as the worst domain rather than an average.
 */
export function listenRoundTwoAutomatedMeasurements(options: {
  archive: unknown;
  profileIds: readonly string[];
}): ListenRoundTwoAutomatedMeasurement[] {
  const record = archiveRecord(options.archive);
  const captures = Array.isArray(record.captures) ? record.captures : [];
  const outcomes = Array.isArray(record.outcomes) ? record.outcomes : [];
  const summaries = Array.isArray(record.domainSummaries) ? record.domainSummaries : [];
  if (captures.length === 0) throw new Error("The confirmation archive captured no trace.");
  const leafByTrace = new Map<string, { rendererKey: string; instrument: string }>();
  for (const capture of captures as Array<Record<string, unknown>>) {
    if (typeof capture.traceId !== "string" || typeof capture.rendererKey !== "string") {
      throw new Error("A confirmation capture names no trace or no renderer.");
    }
    leafByTrace.set(capture.traceId, {
      rendererKey: capture.rendererKey,
      instrument: typeof capture.piano === "string" && capture.piano.length > 0
        ? capture.piano
        : LISTEN_ROUND_TWO_NO_INSTRUMENT,
    });
  }
  const leaves = [...new Set([...leafByTrace.values()]
    .map(({ rendererKey, instrument }) => `${rendererKey}|${instrument}`))].sort();
  const columns = [LISTEN_LIVE_BASELINE_PROFILE_ID, ...options.profileIds];
  return columns.map((profileId) => {
    const rows = (outcomes as Array<Record<string, unknown>>)
      .filter((row) => row.profileId === profileId);
    if (rows.length !== captures.length) {
      throw new Error(
        `The confirmation archive holds ${rows.length} outcome rows for ${profileId} and ` +
          `${captures.length} captures; a column with a missing row is not measured.`,
      );
    }
    const renderers = leaves.map((leaf) => {
      const [rendererKey, instrument] = leaf.split("|");
      const leafRows = rows.filter((row) => {
        const owner = leafByTrace.get(String(row.traceId));
        return owner?.rendererKey === rendererKey && owner.instrument === instrument;
      });
      const sum = (field: string) => leafRows.reduce((total, row) => {
        const value = row[field];
        if (!Number.isInteger(value) || (value as number) < 0) {
          throw new Error(`${profileId} records ${field} ${String(value)} on ${row.traceId}.`);
        }
        return total + (value as number);
      }, 0);
      const domainPercentiles = (summaries as Array<Record<string, unknown>>)
        .filter((summary) => summary.profileId === profileId && Array.isArray(summary.traceIds) &&
          (summary.traceIds as string[]).some((traceId) => {
            const owner = leafByTrace.get(traceId);
            return owner?.rendererKey === rendererKey && owner.instrument === instrument;
          }))
        .map((summary) => summary.p95OnsetToAdvanceMs)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return {
        rendererKey,
        instrument,
        traceCount: leafRows.length,
        correctAdvanceCount: sum("correctAdvanceCount"),
        independentMatchCount: sum("independentMatchCount"),
        orderedAdvanceCount: sum("orderedAdvanceCount"),
        completePassageCount: sum("completePassageCount"),
        unsafeEventCount: ARCHIVE_UNSAFE_COUNTERS
          .reduce((total, counter) => total + sum(counter), 0),
        worstP95OnsetToAdvanceMs: domainPercentiles.length === 0
          ? null
          : Math.max(...domainPercentiles),
      };
    });
    return { profileId, renderers };
  });
}

/** The leaf label for a corpus whose traces name no instrument of their own. */
export const LISTEN_ROUND_TWO_NO_INSTRUMENT = "none";

/** Rederives every column's live measurements, kept per setup. */
export function listenRoundTwoLiveMeasurements(options: {
  archives: readonly ListenRoundTwoLiveArchive[];
  profileIds: readonly string[];
}): ListenRoundTwoLiveMeasurement[] {
  const columns = [LISTEN_LIVE_BASELINE_PROFILE_ID, ...options.profileIds];
  const setups = options.archives.flatMap((archive) => archive.setups);
  return columns.map((profileId) => ({
    profileId,
    setups: setups.map((setup) => {
      const measured = setup.trials
        .map((trial) => ({
          trial,
          outcome: trial.outcomes.find((row) => row.profileId === profileId),
        }))
        .filter((row): row is { trial: typeof row.trial; outcome: NonNullable<typeof row.outcome> } => (
          row.outcome !== undefined
        ));
      return {
        setupId: setup.setupId,
        sourceFamily: LISTEN_LIVE_SOURCE_FAMILIES[setup.source],
        expectedCorrectTrialCount: measured
          .filter(({ trial }) => trial.expectedCorrect).length,
        correctAdvanceCount: measured
          .filter(({ trial, outcome }) => trial.expectedCorrect && outcome.correctAdvance).length,
        unsafeEventCount: measured.reduce((total, { outcome }) => (
          total + LISTEN_LIVE_UNSAFE_COUNTERS.reduce((sum, counter) => sum + outcome[counter], 0)
        ), 0),
      };
    }),
  }));
}

/**
 * Distance from the shipped incumbent, over the four confidence gates.
 *
 * The tiebreak the plan names last is "smaller distance from `baseline-v1`", and
 * it is computed from the registry's own values so it cannot be argued about: a
 * profile that merely already exists is not thereby closer.
 */
export function listenMatcherProfileDistanceFromBaseline(profileId: string): number {
  if (!isListenMatcherProfileId(profileId)) {
    throw new Error(`${profileId} is not a registry identifier.`);
  }
  const baseline = listenMatcherThresholds(
    LISTEN_MATCHER_PROFILES[LISTEN_LIVE_BASELINE_PROFILE_ID as ListenMatcherProfileId],
  );
  const profile = listenMatcherThresholds(LISTEN_MATCHER_PROFILES[profileId]);
  return (["onsetThreshold", "targetNoteThreshold", "activeTargetThreshold", "extraNoteThreshold"] as const)
    .reduce((total, key) => total + Math.abs(profile[key] - baseline[key]), 0);
}

/* ------------------------------------------------------------------------- *
 * The ordered rule
 * ------------------------------------------------------------------------- */

/** A leaf is a renderer and an instrument, never one of them alone. */
function leafKey(renderer: ListenRoundTwoRendererMeasurement): string {
  return `${renderer.rendererKey}/${renderer.instrument}`;
}

/** One step's per-key values for one candidate, higher or lower being better. */
interface StepValues {
  step: ListenRoundTwoSelectionStep;
  better: "higher" | "lower";
  /** Keyed by setup or renderer, never collapsed into a total. */
  values: ReadonlyMap<string, number | null>;
}

function dominance(left: StepValues, right: StepValues): -1 | 0 | 1 {
  const keys = [...left.values.keys()].sort();
  const rightKeys = [...right.values.keys()].sort();
  if (keys.length !== rightKeys.length || keys.some((key, index) => key !== rightKeys[index])) {
    throw new Error("Two candidates were measured over different setups or renderers.");
  }
  let leftBetterSomewhere = false;
  let rightBetterSomewhere = false;
  for (const key of keys) {
    const a = left.values.get(key) ?? null;
    const b = right.values.get(key) ?? null;
    // A missing measurement never wins a step: it is not evidence of quality.
    if (a === null || b === null) {
      if (a === null && b !== null) rightBetterSomewhere = true;
      if (b === null && a !== null) leftBetterSomewhere = true;
      continue;
    }
    if (a === b) continue;
    const leftWins = left.better === "higher" ? a > b : a < b;
    if (leftWins) leftBetterSomewhere = true;
    else rightBetterSomewhere = true;
  }
  if (leftBetterSomewhere && !rightBetterSomewhere) return -1;
  if (rightBetterSomewhere && !leftBetterSomewhere) return 1;
  return 0;
}

function stepValues(
  step: ListenRoundTwoSelectionStep,
  profileId: string,
  live: ListenRoundTwoLiveMeasurement,
  automated: ListenRoundTwoAutomatedMeasurement,
): StepValues {
  switch (step) {
    case "live-safety":
      return {
        step,
        better: "lower",
        values: new Map(live.setups.map((setup) => [setup.setupId, setup.unsafeEventCount])),
      };
    case "live-correct-advancement":
      return {
        step,
        better: "higher",
        values: new Map(live.setups.map((setup) => [setup.setupId, setup.correctAdvanceCount])),
      };
    case "automated-independent-recognition":
      return {
        step,
        better: "higher",
        values: new Map(automated.renderers
          .map((renderer) => [leafKey(renderer), renderer.independentMatchCount])),
      };
    case "ordered-and-complete-progress":
      // Two measures, two keys. Summing them lets an ordered gain conceal a
      // complete-passage loss, which is the cascade trade the frozen rule exists
      // to refuse, so a candidate wins this step only by holding both.
      return {
        step,
        better: "higher",
        values: new Map(automated.renderers.flatMap((renderer) => [
          [`${leafKey(renderer)}:ordered`, renderer.orderedAdvanceCount] as const,
          [`${leafKey(renderer)}:complete`, renderer.completePassageCount] as const,
        ])),
      };
    case "latency":
      return {
        step,
        better: "lower",
        values: new Map(automated.renderers
          .map((renderer) => [leafKey(renderer), renderer.worstP95OnsetToAdvanceMs])),
      };
    case "distance-from-baseline":
      return {
        step,
        better: "lower",
        values: new Map([["registry", listenMatcherProfileDistanceFromBaseline(profileId)]]),
      };
  }
}

export interface ListenRoundTwoPairComparison {
  winnerProfileId: string;
  loserProfileId: string;
  /** Null exactly when every step tied, which the rule refuses to resolve. */
  decidedByStep: ListenRoundTwoSelectionStep | null;
  reason: string;
}

export interface ListenRoundTwoSelection {
  selectedProfileId: ListenMatcherProfileId;
  /** Null when the incumbent was retained, which is not a promotion. */
  promotedProfileId: string | null;
  comparisons: readonly ListenRoundTwoPairComparison[];
  materialImprovement: readonly ListenMaterialImprovementAssessment[];
  /** Why the round did not promote, when it did not. */
  notPromotedReason:
    | "no-approved-candidate"
    | "ordered-rule-did-not-separate"
    | "no-material-improvement"
    | null;
}

function measurementFor<T extends { profileId: string }>(
  rows: readonly T[],
  profileId: string,
  what: string,
): T {
  const row = rows.find((entry) => entry.profileId === profileId);
  if (row === undefined) throw new Error(`${what} holds no measurement for ${profileId}.`);
  return row;
}

/**
 * The frozen Task 23 promotion materiality, applied to the archived run.
 *
 * The recipe is not restated here. `listenPromotionMaterialImprovements` is the
 * same function the confirmation matrix uses, so the axes a promotion may be
 * earned on are exactly the ones Task 23 authorized — isolated rates and latency,
 * sequence independent, ordered, and complete-passage rates and latency, the
 * dynamics equal-piano suites, and cross-domain unsafe-event reduction — and an
 * ordered or complete-passage gain can earn a promotion instead of being averaged
 * into a single correctness number. Inventing an aggregate here would be amending
 * the policy at decision time.
 */
export function listenRoundTwoMaterialImprovement(options: {
  profileId: string;
  archive: unknown;
}): ListenMaterialImprovementAssessment[] {
  if (!isListenMatcherProfileId(options.profileId)) {
    throw new Error(`${options.profileId} is not a registry identifier.`);
  }
  const record = archiveRecord(options.archive) as Record<string, unknown> &
    ListenProfileValidationDomainResults;
  if (record.isolated == null && record.sequence == null && record.dynamics == null) {
    throw new Error(
      "The confirmation archive carries none of the measured domains Task 23's materiality is " +
        "assessed over, so no promotion axis can be recomputed from it.",
    );
  }
  return listenPromotionMaterialImprovements({
    profileId: options.profileId,
    baselineProfileId: LISTEN_LIVE_BASELINE_PROFILE_ID,
    results: {
      isolated: record.isolated ?? null,
      sequence: record.sequence ?? null,
      dynamics: record.dynamics ?? null,
    },
  });
}

/**
 * Applies the ordered rule to the approved candidates and names the default.
 *
 * A winner must beat every other approved candidate pairwise. Dominance is a
 * partial order, so that is not guaranteed: when no candidate beats all others,
 * or when two are indistinguishable at every step including distance, the rule
 * has not selected and the incumbent is retained with the reason recorded. That
 * is the honest outcome — the alternative is inventing a tiebreak the frozen rule
 * does not have.
 */
export function listenRoundTwoSelectDefault(options: {
  approvedCandidateProfileIds: readonly string[];
  live: readonly ListenRoundTwoLiveMeasurement[];
  automated: readonly ListenRoundTwoAutomatedMeasurement[];
  /** The archived confirmation repetition Task 23's materiality is assessed over. */
  confirmationArchive: unknown;
}): ListenRoundTwoSelection {
  const candidates = [...options.approvedCandidateProfileIds];
  const comparisons: ListenRoundTwoPairComparison[] = [];
  if (candidates.length === 0) {
    return {
      selectedProfileId: LISTEN_LIVE_BASELINE_PROFILE_ID as ListenMatcherProfileId,
      promotedProfileId: null,
      comparisons,
      materialImprovement: [],
      notPromotedReason: "no-approved-candidate",
    };
  }
  const wins = new Map<string, number>(candidates.map((profileId) => [profileId, 0]));
  for (const [index, left] of candidates.entries()) {
    for (const right of candidates.slice(index + 1)) {
      let decided: ListenRoundTwoSelectionStep | null = null;
      let order: -1 | 0 | 1 = 0;
      for (const step of LISTEN_ROUND_TWO_SELECTION_STEPS) {
        order = dominance(
          stepValues(step, left, measurementFor(options.live, left, "The live corpus"),
            measurementFor(options.automated, left, "The confirmation archive")),
          stepValues(step, right, measurementFor(options.live, right, "The live corpus"),
            measurementFor(options.automated, right, "The confirmation archive")),
        );
        if (order !== 0) {
          decided = step;
          break;
        }
      }
      const winner = order === -1 ? left : order === 1 ? right : null;
      if (winner !== null) wins.set(winner, (wins.get(winner) ?? 0) + 1);
      comparisons.push({
        winnerProfileId: winner ?? "",
        loserProfileId: winner === null ? "" : winner === left ? right : left,
        decidedByStep: decided,
        reason: winner === null
          ? `${left} and ${right} tie at every step of the frozen order, including distance ` +
            "from the incumbent."
          : `${winner} beats ${winner === left ? right : left} at ${decided}, the first step of ` +
            "the frozen order that separates them.",
      });
    }
  }
  const required = candidates.length - 1;
  const outright = candidates.filter((profileId) => wins.get(profileId) === required);
  if (outright.length !== 1) {
    return {
      selectedProfileId: LISTEN_LIVE_BASELINE_PROFILE_ID as ListenMatcherProfileId,
      promotedProfileId: null,
      comparisons,
      materialImprovement: [],
      notPromotedReason: "ordered-rule-did-not-separate",
    };
  }
  const [winner] = outright;
  const materialImprovement = listenRoundTwoMaterialImprovement({
    profileId: winner,
    archive: options.confirmationArchive,
  });
  if (!materialImprovement.some(({ material }) => material)) {
    return {
      selectedProfileId: LISTEN_LIVE_BASELINE_PROFILE_ID as ListenMatcherProfileId,
      promotedProfileId: null,
      comparisons,
      materialImprovement,
      notPromotedReason: "no-material-improvement",
    };
  }
  if (!isListenMatcherProfileId(winner)) {
    throw new Error(`${winner} is not a registry identifier.`);
  }
  return {
    selectedProfileId: winner,
    promotedProfileId: winner,
    comparisons,
    materialImprovement,
    notPromotedReason: null,
  };
}
