/**
 * The frozen discovery/confirmation protocol for matcher-profile selection.
 *
 * Every automated listening trace the repository can produce is named here once
 * and assigned to exactly one partition:
 *
 * - `discovery` may tune thresholds. It is either already-observed evidence
 *   (the Direct and Tone sequence sweeps) or a stratified subset chosen before
 *   any multi-domain search ran.
 * - `confirmation` is untouched. No selection path may read its outcomes.
 * - `regression-only` gates every profile and contributes no positive score:
 *   the dedicated safety families and the two committed regressions.
 *
 * The manifest also freezes how domains are weighted and how safe candidates are
 * ranked, so no partition, weight, metric, or tie-break can be chosen after
 * results are visible. `listenTraceManifestHash` folds the assignments, the
 * derived weights, and the metric order into one digest, and
 * `LISTEN_TRACE_MANIFEST_HASH` pins it: any of those changes breaks the pin and
 * starts a new discovery/confirmation version rather than amending this one.
 *
 * This module owns the protocol only. It runs no benchmark, replays no trace,
 * and never imports the sweep. The rejected retrigger and inference-reset
 * corpora are deliberately absent: they select no thresholds.
 */

import { bundledListenBenchmarkCases, isMathematicallyAmbiguousCase } from "./listenBenchmark";
import {
  LISTEN_BENCHMARK_PIANO,
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
} from "./listenBenchmarkAudio";
import { LISTEN_SAFETY_REGRESSION_FIXTURES } from "./listenSafetyRegression";
import {
  COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  courseClearArticulationDefinitions,
  type ListenSequenceArticulation,
} from "./listenSequenceBenchmark";
import { PIANO_IDS, pianoDefinition, type PianoId, type PianoLayerId } from "./pianoRegistry";

/** Bumped whenever any assignment, weight, metric, or tie-break rule changes. */
export const LISTEN_TRACE_MANIFEST_VERSION = 1;

export type ListenTracePartition = "discovery" | "confirmation" | "regression-only";

export type ListenTraceSuite =
  | "isolated"
  | "sequence"
  | "articulation"
  | "dynamics-constant"
  | "dynamics-mixed"
  | "safety-regression";

/** Short renderer key used in trace identifiers. */
export type ListenTraceRendererKey = "direct" | "tone";

/** Coarse loudness region a velocity layer belongs to. */
export type ListenDynamicBand = "quiet" | "medium" | "loud";

/** How an isolated fixture differs from its score target. */
export type ListenIsolatedCaseKind =
  | "correct"
  | "distinguishable-wrong"
  | "ambiguous-harmonic"
  | "omitted-bass";

export const LISTEN_TRACE_PARTITIONS: readonly ListenTracePartition[] = Object.freeze([
  "discovery",
  "confirmation",
  "regression-only",
] as const);

export const LISTEN_TRACE_SUITES: readonly ListenTraceSuite[] = Object.freeze([
  "isolated",
  "sequence",
  "articulation",
  "dynamics-constant",
  "dynamics-mixed",
  "safety-regression",
] as const);

export const LISTEN_ISOLATED_CASE_KINDS: readonly ListenIsolatedCaseKind[] = Object.freeze([
  "correct",
  "distinguishable-wrong",
  "ambiguous-harmonic",
  "omitted-bass",
] as const);

export const LISTEN_DYNAMIC_BANDS: readonly ListenDynamicBand[] = Object.freeze([
  "quiet",
  "medium",
  "loud",
] as const);

/** One named trace and everything the partition rules depend on. */
export interface ListenTraceDescriptor {
  id: string;
  partition: ListenTracePartition;
  suite: ListenTraceSuite;
  renderer: string;
  rendererKey: ListenTraceRendererKey;
  /**
   * The equal-weight leaf group inside a suite: a sequence family, a piano, an
   * articulation, or an isolated case kind.
   */
  domain: string;
  /** Passage or isolated-case identity the trace renders. */
  sourceId: string;
  sequenceFamily: string | null;
  articulation: ListenSequenceArticulation | null;
  piano: PianoId | null;
  layer: PianoLayerId | null;
  dynamicBand: ListenDynamicBand | null;
  dynamicProfile: "constant" | "crescendo-decrescendo" | null;
  /** Speed in milliseconds between attacks, or null for isolated single attacks. */
  intervalMs: number | null;
  caseKind: ListenIsolatedCaseKind | null;
  /** Pinned decoded-structure identity of a committed regression, else null. */
  fixtureVersion: string | null;
  /** The measured run a committed regression was minimized from. */
  derivedFromTraceId: string | null;
  /**
   * Rendered content identity. Two suites can schedule the same passage on the
   * same instrument at the same speed; such traces must share one partition, or
   * a confirmation row would be a re-measurement of a discovery row.
   */
  contentKey: string;
  /** False for `regression-only` traces: they gate profiles but add no score. */
  scoreEligible: boolean;
}

export interface ListenTraceManifest {
  version: number;
  rationale: string;
  amendmentRule: string;
  traces: readonly ListenTraceDescriptor[];
}

export const LISTEN_TRACE_MANIFEST_RATIONALE =
  "The Direct and Tone sequence sweeps have been observed, so the whole sequence corpus is " +
  "discovery. Dynamics and articulation are split before searching: one constant layer per " +
  "piano, renderer, and loudness band plus one mixed run per renderer enter discovery, and " +
  "every unselected layer, the held-back mixed runs, the held-back articulations, and the " +
  "complete isolated corpus stay untouched for confirmation. The dedicated safety families " +
  "and the two committed regressions gate every profile without scoring one.";

export const LISTEN_TRACE_MANIFEST_AMENDMENT_RULE =
  "A trace never moves between partitions, and the weights, metric order, and tie-breaks " +
  "never change inside a version. Any such change starts a new discovery and validation " +
  "round, which is an edit to this module rather than a relabelled manifest object: bump " +
  "LISTEN_TRACE_MANIFEST_VERSION, restate LISTEN_TRACE_MANIFEST_CENSUS, re-pin " +
  "LISTEN_TRACE_MANIFEST_HASH, and rerun discovery before reading any confirmation outcome.";

/**
 * Constant layers that may tune thresholds: one per loudness band for each
 * piano. Splendid `mp` is discovery because the articulation matrix and the
 * sequence corpus already render that instrument, so holding it back would
 * reserve content the search has effectively seen. Salamander `v05` is excluded
 * because its Tone run is the source of a committed regression.
 */
const DISCOVERY_CONSTANT_LAYERS: Readonly<Record<PianoId, readonly PianoLayerId[]>> = Object.freeze({
  splendid: Object.freeze(["pp", "mp", "ff"] as PianoLayerId[]),
  salamander: Object.freeze(["v03", "v09", "v14"] as PianoLayerId[]),
});

/**
 * Articulation traces that may tune thresholds. Every category appears once, and
 * each renderer keeps held-back categories for confirmation. Both `normal` runs
 * are discovery because they render the same passage as the Splendid `mp`
 * constant-layer runs.
 */
const DISCOVERY_ARTICULATIONS: Readonly<
  Record<ListenTraceRendererKey, readonly ListenSequenceArticulation[]>
> = Object.freeze({
  direct: Object.freeze(["detached", "normal", "sustained-shared"] as ListenSequenceArticulation[]),
  tone: Object.freeze(["normal", "legato"] as ListenSequenceArticulation[]),
});

/** One mixed-dynamics run per renderer tunes; the other piano stays untouched. */
const DISCOVERY_MIXED_PIANO: Readonly<Record<ListenTraceRendererKey, PianoId>> = Object.freeze({
  direct: "splendid",
  tone: "salamander",
});

const RENDERERS: readonly { key: ListenTraceRendererKey; version: string }[] = Object.freeze([
  Object.freeze({ key: "direct" as const, version: LISTEN_BENCHMARK_RENDERER.version }),
  Object.freeze({ key: "tone" as const, version: LISTEN_BENCHMARK_TONE_RENDERER.version }),
]);

/** Speeds and intervals are matched with the corpus tolerance, not by equality. */
const INTERVAL_TOLERANCE_MS = 0.5;

const DEFAULT_BENCHMARK_PIANO: PianoId = LISTEN_BENCHMARK_PIANO.id;
const DEFAULT_BENCHMARK_LAYER = LISTEN_BENCHMARK_PIANO.layer as PianoLayerId;

function speedLabel(intervalMs: number): string {
  return `${Math.round(intervalMs)}ms`;
}

/** Quiet, medium, and loud regions of each sampled piano's velocity range. */
export function listenDynamicBand(piano: PianoId, layer: PianoLayerId): ListenDynamicBand {
  if (piano === "splendid") {
    if (layer === "pp") return "quiet";
    if (layer === "ff") return "loud";
    return "medium";
  }
  const velocity = Number(layer.slice(1));
  if (!Number.isFinite(velocity)) {
    throw new Error(`Salamander layer ${layer} has no velocity index.`);
  }
  if (velocity <= 5) return "quiet";
  return velocity <= 11 ? "medium" : "loud";
}

function contentKey(parts: {
  rendererKey: ListenTraceRendererKey;
  sourceId: string;
  intervalMs: number | null;
  piano: PianoId | null;
  layer: PianoLayerId | null;
  dynamicProfile: "constant" | "crescendo-decrescendo" | null;
}): string {
  return [
    parts.rendererKey,
    parts.sourceId,
    parts.intervalMs === null ? "single" : speedLabel(parts.intervalMs),
    parts.piano ?? "none",
    parts.layer ?? "none",
    parts.dynamicProfile ?? "none",
  ].join("/");
}

function descriptor(
  values: Omit<ListenTraceDescriptor, "scoreEligible" | "contentKey"> & { contentKey?: string },
): ListenTraceDescriptor {
  return Object.freeze({
    ...values,
    contentKey: values.contentKey ?? contentKey({
      rendererKey: values.rendererKey,
      sourceId: values.sourceId,
      intervalMs: values.intervalMs,
      piano: values.piano,
      layer: values.layer,
      dynamicProfile: values.dynamicProfile,
    }),
    scoreEligible: values.partition !== "regression-only",
  });
}

function samePitches(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((pitch, index) => pitch === right[index]);
}

/**
 * How an isolated fixture differs from its target. Harmonic ambiguity is decided
 * first, exactly as the isolated summary decides it, so an octave omission is
 * never reported as a distinguishable failure.
 */
export function listenIsolatedCaseKind(
  targetPitches: readonly number[],
  playedPitches: readonly number[],
): ListenIsolatedCaseKind {
  const target = [...targetPitches].sort((left, right) => left - right);
  const played = [...playedPitches].sort((left, right) => left - right);
  if (samePitches(target, played)) return "correct";
  if (isMathematicallyAmbiguousCase(target, played)) return "ambiguous-harmonic";
  const missing = target.filter((pitch) => !played.includes(pitch));
  const added = played.filter((pitch) => !target.includes(pitch));
  if (added.length === 0 && missing.length > 0 && missing.includes(target[0])) {
    return "omitted-bass";
  }
  return "distinguishable-wrong";
}

function sequenceTraces(): ListenTraceDescriptor[] {
  const definitions = bundledListenSequences();
  return RENDERERS.flatMap(({ key, version }) => definitions.flatMap((definition) => (
    LISTEN_SEQUENCE_INTERVALS_MS.map((intervalMs) => descriptor({
      id: `sequence/${key}/${definition.id}/${speedLabel(intervalMs)}`,
      // Both single-renderer sweeps have been run and reported, so no sequence
      // trace can be described as held out. The dedicated safety passages gate
      // instead of scoring.
      partition: definition.family === "safety" ? "regression-only" : "discovery",
      suite: "sequence",
      renderer: version,
      rendererKey: key,
      domain: definition.family,
      sourceId: definition.id,
      sequenceFamily: definition.family,
      articulation: definition.articulation ?? null,
      piano: DEFAULT_BENCHMARK_PIANO,
      layer: DEFAULT_BENCHMARK_LAYER,
      dynamicBand: listenDynamicBand(DEFAULT_BENCHMARK_PIANO, DEFAULT_BENCHMARK_LAYER),
      dynamicProfile: "constant",
      intervalMs,
      caseKind: null,
      fixtureVersion: null,
      derivedFromTraceId: null,
    }))
  )));
}

function articulationTraces(): ListenTraceDescriptor[] {
  const definitions = courseClearArticulationDefinitions();
  return RENDERERS.flatMap(({ key, version }) => definitions.map((definition) => {
    const articulation = definition.articulation;
    if (!articulation) throw new Error(`${definition.id} has no articulation profile.`);
    return descriptor({
      id: `articulation/${key}/${articulation}`,
      partition: DISCOVERY_ARTICULATIONS[key].includes(articulation)
        ? "discovery"
        : "confirmation",
      suite: "articulation",
      renderer: version,
      rendererKey: key,
      domain: articulation,
      sourceId: definition.id,
      sequenceFamily: definition.family,
      articulation,
      piano: DEFAULT_BENCHMARK_PIANO,
      layer: DEFAULT_BENCHMARK_LAYER,
      dynamicBand: listenDynamicBand(DEFAULT_BENCHMARK_PIANO, DEFAULT_BENCHMARK_LAYER),
      dynamicProfile: "constant",
      intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
      caseKind: null,
      fixtureVersion: null,
      derivedFromTraceId: null,
    });
  }));
}

/** The passage every dynamics run renders, and the articulation matrix's `normal` row. */
const DYNAMICS_SOURCE_ID = "course-clear-articulation-normal";

function regressionSourceContentKeys(): Set<string> {
  return new Set(LISTEN_SAFETY_REGRESSION_FIXTURES.map(({ origin }) => contentKey({
    rendererKey: origin.renderer === LISTEN_BENCHMARK_TONE_RENDERER.version ? "tone" : "direct",
    sourceId: origin.sourceSequenceId,
    intervalMs: origin.sourceIntervalMs,
    piano: origin.piano as PianoId,
    layer: origin.layer as PianoLayerId,
    dynamicProfile: "constant",
  })));
}

function constantDynamicsTraces(): ListenTraceDescriptor[] {
  const regressionSources = regressionSourceContentKeys();
  return RENDERERS.flatMap(({ key, version }) => PIANO_IDS.flatMap((piano) => (
    pianoDefinition(piano).benchmarkLayers.map((layer) => {
      const key1 = contentKey({
        rendererKey: key,
        sourceId: DYNAMICS_SOURCE_ID,
        intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
        piano,
        layer,
        dynamicProfile: "constant",
      });
      const partition: ListenTracePartition = regressionSources.has(key1)
        ? "regression-only"
        : DISCOVERY_CONSTANT_LAYERS[piano].includes(layer)
          ? "discovery"
          : "confirmation";
      return descriptor({
        id: `dynamics-constant/${key}/${piano}/${layer}`,
        partition,
        suite: "dynamics-constant",
        renderer: version,
        rendererKey: key,
        domain: piano,
        sourceId: DYNAMICS_SOURCE_ID,
        sequenceFamily: "course-clear-articulation",
        articulation: "normal",
        piano,
        layer,
        dynamicBand: listenDynamicBand(piano, layer),
        dynamicProfile: "constant",
        intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
        caseKind: null,
        fixtureVersion: null,
        derivedFromTraceId: null,
        contentKey: key1,
      });
    })
  )));
}

function mixedDynamicsTraces(): ListenTraceDescriptor[] {
  return RENDERERS.flatMap(({ key, version }) => PIANO_IDS.map((piano) => descriptor({
    id: `dynamics-mixed/${key}/${piano}`,
    partition: DISCOVERY_MIXED_PIANO[key] === piano ? "discovery" : "confirmation",
    suite: "dynamics-mixed",
    renderer: version,
    rendererKey: key,
    domain: piano,
    sourceId: DYNAMICS_SOURCE_ID,
    sequenceFamily: "course-clear-articulation",
    articulation: "normal",
    piano,
    layer: null,
    dynamicBand: null,
    dynamicProfile: "crescendo-decrescendo",
    intervalMs: COURSE_CLEAR_ARTICULATION_INTERVAL_MS,
    caseKind: null,
    fixtureVersion: null,
    derivedFromTraceId: null,
  })));
}

function isolatedTraces(): ListenTraceDescriptor[] {
  const cases = bundledListenBenchmarkCases();
  return RENDERERS.flatMap(({ key, version }) => cases.map((benchmarkCase, index) => {
    const caseKind = listenIsolatedCaseKind(benchmarkCase.target, benchmarkCase.played);
    const sourceId = `isolated-case-${String(index + 1).padStart(3, "0")}`;
    return descriptor({
      // The complete isolated corpus is untouched confirmation evidence: no
      // threshold may be chosen from the numbers the release gates quote.
      id: `isolated/${key}/${String(index + 1).padStart(3, "0")}`,
      partition: "confirmation",
      suite: "isolated",
      renderer: version,
      rendererKey: key,
      domain: caseKind,
      sourceId,
      sequenceFamily: benchmarkCase.fixtureGroup ?? "general",
      articulation: null,
      piano: DEFAULT_BENCHMARK_PIANO,
      layer: DEFAULT_BENCHMARK_LAYER,
      dynamicBand: listenDynamicBand(DEFAULT_BENCHMARK_PIANO, DEFAULT_BENCHMARK_LAYER),
      dynamicProfile: "constant",
      intervalMs: null,
      caseKind,
      fixtureVersion: null,
      derivedFromTraceId: null,
    });
  }));
}

function regressionFixtureTraces(traces: readonly ListenTraceDescriptor[]): ListenTraceDescriptor[] {
  return LISTEN_SAFETY_REGRESSION_FIXTURES.map((fixture) => {
    const rendererKey: ListenTraceRendererKey =
      fixture.origin.renderer === LISTEN_BENCHMARK_TONE_RENDERER.version ? "tone" : "direct";
    const source = traces.find((trace) => (
      trace.rendererKey === rendererKey &&
      trace.sourceId === fixture.origin.sourceSequenceId &&
      trace.piano === fixture.origin.piano &&
      trace.layer === fixture.origin.layer &&
      trace.intervalMs !== null &&
      Math.abs(trace.intervalMs - fixture.origin.sourceIntervalMs) <= INTERVAL_TOLERANCE_MS
    ));
    return descriptor({
      id: `regression/${fixture.id}`,
      partition: "regression-only",
      suite: "safety-regression",
      renderer: fixture.origin.renderer,
      rendererKey,
      domain: "safety-regression",
      sourceId: fixture.id,
      sequenceFamily: fixture.definition.family,
      articulation: null,
      piano: fixture.origin.piano as PianoId,
      layer: fixture.origin.layer as PianoLayerId,
      dynamicBand: null,
      dynamicProfile: null,
      intervalMs: fixture.intervalMs,
      caseKind: null,
      fixtureVersion: fixture.origin.sourceRecognitionStructureHash,
      derivedFromTraceId: source?.id ?? null,
      contentKey: `regression/${fixture.id}`,
    });
  });
}

/** Builds the manifest deterministically from the corpora the benchmarks define. */
export function buildListenTraceManifest(): ListenTraceManifest {
  const measured = [
    ...sequenceTraces(),
    ...articulationTraces(),
    ...constantDynamicsTraces(),
    ...mixedDynamicsTraces(),
    ...isolatedTraces(),
  ];
  return Object.freeze({
    version: LISTEN_TRACE_MANIFEST_VERSION,
    rationale: LISTEN_TRACE_MANIFEST_RATIONALE,
    amendmentRule: LISTEN_TRACE_MANIFEST_AMENDMENT_RULE,
    traces: Object.freeze([...measured, ...regressionFixtureTraces(measured)]),
  });
}

/** The frozen protocol. Task 08 onwards reads this and never rebuilds it. */
export const LISTEN_TRACE_MANIFEST: ListenTraceManifest = buildListenTraceManifest();

export function listenTracesInPartition(
  partition: ListenTracePartition,
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor[] {
  return manifest.traces.filter((trace) => trace.partition === partition);
}

export function listenTracesInSuite(
  suite: ListenTraceSuite,
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor[] {
  return manifest.traces.filter((trace) => trace.suite === suite);
}

export function findListenTrace(
  id: string,
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceDescriptor | undefined {
  return manifest.traces.find((trace) => trace.id === id);
}

/* ------------------------------------------------------------------------- *
 * Hierarchical equal weighting: renderer -> suite -> domain -> run
 * ------------------------------------------------------------------------- */

export interface ListenTraceWeight {
  traceId: string;
  rendererKey: ListenTraceRendererKey;
  suite: ListenTraceSuite;
  domain: string;
  /** `renderer/suite/domain`, the level worst-domain metrics are taken over. */
  domainKey: string;
  weight: number;
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/**
 * Equal weight per renderer, then per suite inside a renderer, then per domain
 * inside a suite, then per run inside a domain. Sixteen Salamander layers
 * therefore weigh exactly as much as four Splendid layers, and a suite with more
 * traces gains no extra weight. Traces that are not score-eligible receive zero
 * and are excluded from every level's count.
 */
export function computeListenTraceWeights(
  traces: readonly ListenTraceDescriptor[],
): ListenTraceWeight[] {
  const scored = traces.filter(({ scoreEligible }) => scoreEligible);
  const renderers = unique(scored.map(({ rendererKey }) => rendererKey));
  return traces.map((trace) => {
    const base: Omit<ListenTraceWeight, "weight"> = {
      traceId: trace.id,
      rendererKey: trace.rendererKey,
      suite: trace.suite,
      domain: trace.domain,
      domainKey: `${trace.rendererKey}/${trace.suite}/${trace.domain}`,
    };
    if (!trace.scoreEligible) return { ...base, weight: 0 };
    const rendererTraces = scored.filter((other) => other.rendererKey === trace.rendererKey);
    const suites = unique(rendererTraces.map(({ suite }) => suite));
    const suiteTraces = rendererTraces.filter((other) => other.suite === trace.suite);
    const domains = unique(suiteTraces.map(({ domain }) => domain));
    const domainTraces = suiteTraces.filter((other) => other.domain === trace.domain);
    return {
      ...base,
      weight: 1 / renderers.length / suites.length / domains.length / domainTraces.length,
    };
  });
}

export function listenTraceWeightsForPartition(
  partition: ListenTracePartition,
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceWeight[] {
  return computeListenTraceWeights(listenTracesInPartition(partition, manifest));
}

/** Mean of one per-trace value inside each `renderer/suite/domain` leaf. */
export function listenTraceDomainMeans(
  weights: readonly ListenTraceWeight[],
  valueForTrace: (traceId: string) => number | null,
): Array<{ domainKey: string; value: number; traceCount: number }> {
  const means: Array<{ domainKey: string; value: number; traceCount: number }> = [];
  for (const domainKey of unique(weights.filter(({ weight }) => weight > 0)
    .map(({ domainKey }) => domainKey))) {
    const values = weights
      .filter((entry) => entry.domainKey === domainKey && entry.weight > 0)
      .flatMap((entry) => {
        const value = valueForTrace(entry.traceId);
        return value === null || !Number.isFinite(value) ? [] : [value];
      });
    if (values.length === 0) continue;
    means.push({
      domainKey,
      value: values.reduce((total, value) => total + value, 0) / values.length,
      traceCount: values.length,
    });
  }
  return means;
}

/**
 * Hierarchically weighted mean. Traces without a value are dropped and the
 * remaining weights are renormalized, so a missing run never counts as a zero.
 */
export function weightedListenTraceMean(
  weights: readonly ListenTraceWeight[],
  valueForTrace: (traceId: string) => number | null,
): number | null {
  let weightTotal = 0;
  let valueTotal = 0;
  for (const entry of weights) {
    if (entry.weight <= 0) continue;
    const value = valueForTrace(entry.traceId);
    if (value === null || !Number.isFinite(value)) continue;
    weightTotal += entry.weight;
    valueTotal += entry.weight * value;
  }
  return weightTotal === 0 ? null : valueTotal / weightTotal;
}

/** Worst equal-weighted domain, the first ranking metric after hard safety. */
export function worstListenTraceDomain(
  weights: readonly ListenTraceWeight[],
  valueForTrace: (traceId: string) => number | null,
): { domainKey: string; value: number; traceCount: number } | null {
  const means = listenTraceDomainMeans(weights, valueForTrace);
  if (means.length === 0) return null;
  return means.reduce((worst, candidate) => (
    candidate.value < worst.value ||
      (candidate.value === worst.value && candidate.domainKey < worst.domainKey)
      ? candidate
      : worst
  ));
}

/* ------------------------------------------------------------------------- *
 * Frozen candidate metric order
 * ------------------------------------------------------------------------- */

export type ListenCandidateMetricKey =
  | "worstDomainIndependentRate"
  | "equalDomainIndependentRate"
  | "orderedPrefixRate"
  | "completePassageRate"
  | "lateAdvanceCount"
  | "lateAdvanceSourceDistance"
  | "attributionDelayMs"
  | "p95LatencyMs"
  | "distanceFromBaseline";

export interface ListenCandidateMetricDefinition {
  key: ListenCandidateMetricKey;
  direction: "higher-is-better" | "lower-is-better";
  label: string;
}

/**
 * The frozen ranking order. Independent recognition precedes ordered results so
 * one early recovery cannot win through cascade amplification alone, and the
 * late-advance burden is a performance term after them rather than a safety
 * term: safety is a hard gate, never a weighted score.
 */
export const LISTEN_CANDIDATE_METRIC_ORDER: readonly ListenCandidateMetricDefinition[] =
  Object.freeze([
    Object.freeze({
      key: "worstDomainIndependentRate" as const,
      direction: "higher-is-better" as const,
      label: "Worst-domain independent recognition",
    }),
    Object.freeze({
      key: "equalDomainIndependentRate" as const,
      direction: "higher-is-better" as const,
      label: "Equal-domain average independent recognition",
    }),
    Object.freeze({
      key: "orderedPrefixRate" as const,
      direction: "higher-is-better" as const,
      label: "Ordered prefix completion",
    }),
    Object.freeze({
      key: "completePassageRate" as const,
      direction: "higher-is-better" as const,
      label: "Complete passages",
    }),
    Object.freeze({
      key: "lateAdvanceCount" as const,
      direction: "lower-is-better" as const,
      label: "Late advances",
    }),
    Object.freeze({
      key: "lateAdvanceSourceDistance" as const,
      direction: "lower-is-better" as const,
      label: "Late-advance source-to-target distance",
    }),
    Object.freeze({
      key: "attributionDelayMs" as const,
      direction: "lower-is-better" as const,
      label: "Attribution delay",
    }),
    Object.freeze({
      key: "p95LatencyMs" as const,
      direction: "lower-is-better" as const,
      label: "P95 onset-to-advance latency",
    }),
    Object.freeze({
      key: "distanceFromBaseline" as const,
      direction: "lower-is-better" as const,
      label: "Threshold distance from baseline-v1",
    }),
  ]);

/** One candidate's frozen-order metrics. `safe` is a gate, not a rank key. */
export type ListenCandidateMetrics =
  & { profileId: string; safe: boolean }
  & Record<ListenCandidateMetricKey, number | null>;

/**
 * Grid every metric value is snapped to before it is compared.
 *
 * A pairwise "closer than this is equal" tolerance is not transitive: three
 * values a little under one tolerance apart give `a == b`, `b == c`, and
 * `a < c`, so the sort result would depend on the input order. Quantizing each
 * value to a fixed grid instead makes equality an equivalence relation, so the
 * comparator is a genuine total order while replay noise far below the grid step
 * still compares equal.
 */
export const LISTEN_CANDIDATE_METRIC_QUANTUM = 1e-9;

/**
 * The grid cell a metric value falls in. Missing values become the worst cell
 * for their direction, so an unmeasured latency never sorts as the fastest.
 */
export function canonicalListenMetricValue(
  value: number | null,
  direction: ListenCandidateMetricDefinition["direction"],
): number {
  if (value === null || Number.isNaN(value)) {
    return direction === "higher-is-better"
      ? Number.NEGATIVE_INFINITY
      : Number.POSITIVE_INFINITY;
  }
  if (!Number.isFinite(value)) return value;
  return Math.round(value / LISTEN_CANDIDATE_METRIC_QUANTUM);
}

function compareMetric(
  left: ListenCandidateMetrics,
  right: ListenCandidateMetrics,
  definition: ListenCandidateMetricDefinition,
): number {
  const leftValue = canonicalListenMetricValue(left[definition.key], definition.direction);
  const rightValue = canonicalListenMetricValue(right[definition.key], definition.direction);
  if (leftValue === rightValue) return 0;
  return definition.direction === "higher-is-better"
    ? Math.sign(rightValue - leftValue)
    : Math.sign(leftValue - rightValue);
}

/**
 * Total order over candidates: safety first, then the frozen metric order, then
 * the profile ID. Two candidates can only tie if they are the same profile.
 */
export function compareListenCandidates(
  left: ListenCandidateMetrics,
  right: ListenCandidateMetrics,
): number {
  if (left.safe !== right.safe) return left.safe ? -1 : 1;
  for (const definition of LISTEN_CANDIDATE_METRIC_ORDER) {
    const comparison = compareMetric(left, right, definition);
    if (comparison !== 0) return comparison < 0 ? -1 : 1;
  }
  return left.profileId.localeCompare(right.profileId);
}

/** Safety is a hard constraint: only these candidates may be ranked or selected. */
export function eligibleListenCandidates(
  candidates: readonly ListenCandidateMetrics[],
): ListenCandidateMetrics[] {
  return candidates.filter(({ safe }) => safe);
}

export function rankListenCandidates(
  candidates: readonly ListenCandidateMetrics[],
): ListenCandidateMetrics[] {
  return [...candidates].sort(compareListenCandidates);
}

/**
 * True when `left` is at least as good on every frozen metric and better on one.
 *
 * Safety dominates every metric, so an unsafe candidate never dominates anything
 * however good its numbers are, and a safe candidate always dominates an unsafe
 * one. Callers therefore cannot obtain a "better" verdict for an unsafe profile
 * by skipping the frontier's eligibility filter.
 */
export function listenCandidateDominates(
  left: ListenCandidateMetrics,
  right: ListenCandidateMetrics,
): boolean {
  if (!left.safe) return false;
  if (!right.safe) return true;
  let strictlyBetter = false;
  for (const definition of LISTEN_CANDIDATE_METRIC_ORDER) {
    const comparison = compareMetric(left, right, definition);
    if (comparison > 0) return false;
    if (comparison < 0) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** The safe Pareto frontier, in ranked order. Unsafe candidates never enter it. */
export function listenCandidateParetoFrontier(
  candidates: readonly ListenCandidateMetrics[],
): ListenCandidateMetrics[] {
  const eligible = eligibleListenCandidates(candidates);
  return rankListenCandidates(eligible.filter((candidate) => (
    !eligible.some((other) => (
      other.profileId !== candidate.profileId && listenCandidateDominates(other, candidate)
    ))
  )));
}

/* ------------------------------------------------------------------------- *
 * Manifest identity
 * ------------------------------------------------------------------------- */

class ManifestHasher {
  private hash = 0x811c_9dc5;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  private byte(value: number): void {
    this.hash = Math.imul(this.hash ^ (value & 0xff), 0x0100_0193) >>> 0;
  }

  text(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.byte(code & 0xff);
      this.byte(code >>> 8);
    }
    this.byte(0);
  }

  number(value: number): void {
    this.scratch.setFloat64(0, value);
    for (let index = 0; index < 8; index += 1) this.byte(this.scratch.getUint8(index));
  }

  get digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, "0");
  }
}

/**
 * FNV-1a over the version, every trace assignment, every derived weight, and the
 * metric order. Prose is excluded, so a clarified comment does not invalidate a
 * measured round, but any re-partitioning, reweighting, or metric change does.
 */
export function listenTraceManifestHash(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): string {
  const hasher = new ManifestHasher();
  hasher.number(manifest.version);
  hasher.number(manifest.traces.length);
  const weights = new Map(
    LISTEN_TRACE_PARTITIONS.flatMap((partition) => (
      computeListenTraceWeights(listenTracesInPartition(partition, manifest))
        .map((entry): [string, number] => [entry.traceId, entry.weight])
    )),
  );
  for (const trace of manifest.traces) {
    hasher.text(trace.id);
    hasher.text(trace.partition);
    hasher.text(trace.suite);
    hasher.text(trace.renderer);
    hasher.text(trace.domain);
    hasher.text(trace.sourceId);
    hasher.text(trace.sequenceFamily ?? "");
    hasher.text(trace.articulation ?? "");
    hasher.text(trace.piano ?? "");
    hasher.text(trace.layer ?? "");
    hasher.text(trace.dynamicBand ?? "");
    hasher.text(trace.dynamicProfile ?? "");
    hasher.number(trace.intervalMs ?? -1);
    hasher.text(trace.caseKind ?? "");
    hasher.text(trace.fixtureVersion ?? "");
    hasher.text(trace.derivedFromTraceId ?? "");
    hasher.text(trace.contentKey);
    hasher.number(trace.scoreEligible ? 1 : 0);
    hasher.number(weights.get(trace.id) ?? 0);
  }
  for (const definition of LISTEN_CANDIDATE_METRIC_ORDER) {
    hasher.text(definition.key);
    hasher.text(definition.direction);
  }
  return hasher.digest;
}

/**
 * The pinned identity of version 1. Changing a partition, a weight, or the
 * metric order breaks this pin on purpose: see LISTEN_TRACE_MANIFEST_AMENDMENT_RULE.
 */
export const LISTEN_TRACE_MANIFEST_HASH = "0ed1e71d";

/* ------------------------------------------------------------------------- *
 * Census
 * ------------------------------------------------------------------------- */

export interface ListenTraceCensusEntry {
  partition: ListenTracePartition;
  suite: ListenTraceSuite;
  traceCount: number;
}

/** Traces per partition and suite, in partition then suite order. */
export function listenTraceCensus(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceCensusEntry[] {
  return LISTEN_TRACE_PARTITIONS.flatMap((partition) => (
    LISTEN_TRACE_SUITES.flatMap((suite) => {
      const traceCount = manifest.traces
        .filter((trace) => trace.partition === partition && trace.suite === suite).length;
      return traceCount === 0 ? [] : [{ partition, suite, traceCount }];
    })
  ));
}

/** The exact version-1 census. A manifest that does not match it is rejected. */
export const LISTEN_TRACE_MANIFEST_CENSUS: readonly ListenTraceCensusEntry[] = Object.freeze([
  Object.freeze({ partition: "discovery" as const, suite: "sequence" as const, traceCount: 120 }),
  Object.freeze({ partition: "discovery" as const, suite: "articulation" as const, traceCount: 5 }),
  Object.freeze({
    partition: "discovery" as const,
    suite: "dynamics-constant" as const,
    traceCount: 12,
  }),
  Object.freeze({
    partition: "discovery" as const,
    suite: "dynamics-mixed" as const,
    traceCount: 2,
  }),
  Object.freeze({
    partition: "confirmation" as const,
    suite: "isolated" as const,
    traceCount: 268,
  }),
  Object.freeze({
    partition: "confirmation" as const,
    suite: "articulation" as const,
    traceCount: 3,
  }),
  Object.freeze({
    partition: "confirmation" as const,
    suite: "dynamics-constant" as const,
    traceCount: 27,
  }),
  Object.freeze({
    partition: "confirmation" as const,
    suite: "dynamics-mixed" as const,
    traceCount: 2,
  }),
  Object.freeze({
    partition: "regression-only" as const,
    suite: "sequence" as const,
    traceCount: 36,
  }),
  Object.freeze({
    partition: "regression-only" as const,
    suite: "dynamics-constant" as const,
    traceCount: 1,
  }),
  Object.freeze({
    partition: "regression-only" as const,
    suite: "safety-regression" as const,
    traceCount: 2,
  }),
]);

export const LISTEN_TRACE_MANIFEST_TRACE_COUNT = 478;

function censusKey(entry: ListenTraceCensusEntry): string {
  return `${entry.partition}/${entry.suite}`;
}

/* ------------------------------------------------------------------------- *
 * Validation
 * ------------------------------------------------------------------------- */

export interface ListenTraceManifestProblem {
  code: string;
  message: string;
  traceIds: string[];
}

function problem(code: string, message: string, traceIds: string[] = []): ListenTraceManifestProblem {
  return { code, message, traceIds };
}

/**
 * Rejects an incomplete, overlapping, leaking, or amended manifest. Selection
 * may only run against a manifest this returns no problems for.
 *
 * Only the version this module declares is a known version, and it must match
 * its pinned census and hash exactly. A manifest that declares any other version
 * is rejected outright: starting a new round means editing this module — bumping
 * LISTEN_TRACE_MANIFEST_VERSION, restating LISTEN_TRACE_MANIFEST_CENSUS, and
 * re-pinning LISTEN_TRACE_MANIFEST_HASH — not relabelling a manifest object. So
 * no trace can be added, removed, re-partitioned, or reweighted without a
 * reviewed change to the frozen constants.
 */
export function validateListenTraceManifest(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenTraceManifestProblem[] {
  const problems: ListenTraceManifestProblem[] = [];
  if (manifest.version !== LISTEN_TRACE_MANIFEST_VERSION) {
    problems.push(problem(
      "unknown-manifest-version",
      `Version ${manifest.version} is not the declared version ` +
        `${LISTEN_TRACE_MANIFEST_VERSION}, so it has no pinned census or hash. ` +
        LISTEN_TRACE_MANIFEST_AMENDMENT_RULE,
    ));
  } else {
    if (manifest.traces.length !== LISTEN_TRACE_MANIFEST_TRACE_COUNT) {
      problems.push(problem(
        "manifest-trace-count",
        `Version ${manifest.version} has ${manifest.traces.length} traces, not ` +
          `${LISTEN_TRACE_MANIFEST_TRACE_COUNT}.`,
      ));
    }
    const measured = new Map(listenTraceCensus(manifest)
      .map((entry): [string, number] => [censusKey(entry), entry.traceCount]));
    for (const entry of LISTEN_TRACE_MANIFEST_CENSUS) {
      const traceCount = measured.get(censusKey(entry)) ?? 0;
      measured.delete(censusKey(entry));
      if (traceCount !== entry.traceCount) {
        problems.push(problem(
          "manifest-census",
          `${censusKey(entry)} holds ${traceCount} traces, not ${entry.traceCount}.`,
        ));
      }
    }
    for (const [key, traceCount] of measured) {
      problems.push(problem(
        "manifest-census",
        `${key} holds ${traceCount} traces but is not part of the frozen census.`,
      ));
    }
    const hash = listenTraceManifestHash(manifest);
    if (hash !== LISTEN_TRACE_MANIFEST_HASH) {
      problems.push(problem(
        "manifest-hash",
        `Version ${manifest.version} hashes to ${hash}, not the pinned ` +
          `${LISTEN_TRACE_MANIFEST_HASH}. ${LISTEN_TRACE_MANIFEST_AMENDMENT_RULE}`,
      ));
    }
  }
  const byId = new Map<string, ListenTraceDescriptor[]>();
  for (const trace of manifest.traces) {
    byId.set(trace.id, [...(byId.get(trace.id) ?? []), trace]);
  }
  const duplicates = [...byId.entries()].filter(([, traces]) => traces.length > 1);
  if (duplicates.length > 0) {
    problems.push(problem(
      "duplicate-trace-id",
      "Every trace must be assigned exactly once.",
      duplicates.map(([id]) => id),
    ));
  }
  for (const trace of manifest.traces) {
    if (!LISTEN_TRACE_PARTITIONS.includes(trace.partition)) {
      problems.push(problem("unknown-partition", `${trace.id} has partition ${trace.partition}.`, [trace.id]));
    }
    if (!LISTEN_TRACE_SUITES.includes(trace.suite)) {
      problems.push(problem("unknown-suite", `${trace.id} has suite ${trace.suite}.`, [trace.id]));
    }
    if (trace.scoreEligible !== (trace.partition !== "regression-only")) {
      problems.push(problem(
        "score-weight-mismatch",
        `${trace.id} is ${trace.partition} but ${trace.scoreEligible ? "scores" : "does not score"}.`,
        [trace.id],
      ));
    }
  }

  const contentPartitions = new Map<string, Set<ListenTracePartition>>();
  for (const trace of manifest.traces) {
    const partitions = contentPartitions.get(trace.contentKey) ?? new Set<ListenTracePartition>();
    partitions.add(trace.partition);
    contentPartitions.set(trace.contentKey, partitions);
  }
  for (const [key, partitions] of contentPartitions) {
    if (partitions.size > 1) {
      problems.push(problem(
        "split-content-key",
        `${key} is rendered by traces in ${[...partitions].sort().join(" and ")}.`,
        manifest.traces.filter((trace) => trace.contentKey === key).map(({ id }) => id),
      ));
    }
  }

  const discovery = manifest.traces.filter(({ partition }) => partition === "discovery");
  const confirmation = manifest.traces.filter(({ partition }) => partition === "confirmation");
  const regression = manifest.traces.filter(({ partition }) => partition === "regression-only");

  for (const { key } of RENDERERS) {
    const rendererDiscovery = discovery.filter((trace) => trace.rendererKey === key);
    if (rendererDiscovery.length === 0) {
      problems.push(problem("missing-discovery-renderer", `Discovery has no ${key} trace.`));
      continue;
    }
    const sequences = rendererDiscovery.filter(({ suite }) => suite === "sequence");
    for (const intervalMs of LISTEN_SEQUENCE_INTERVALS_MS) {
      if (!sequences.some((trace) => trace.intervalMs === intervalMs)) {
        problems.push(problem(
          "missing-discovery-speed",
          `Discovery has no ${key} sequence trace at ${speedLabel(intervalMs)}.`,
        ));
      }
    }
    const scoringFamilies = new Set(bundledListenSequences()
      .filter(({ family }) => family !== "safety")
      .map(({ family }) => family));
    for (const family of scoringFamilies) {
      if (!sequences.some((trace) => trace.sequenceFamily === family)) {
        problems.push(problem(
          "missing-discovery-sequence-family",
          `Discovery has no ${key} trace for sequence family ${family}.`,
        ));
      }
    }
    const constant = rendererDiscovery.filter(({ suite }) => suite === "dynamics-constant");
    for (const piano of PIANO_IDS) {
      for (const band of LISTEN_DYNAMIC_BANDS) {
        if (!constant.some((trace) => trace.piano === piano && trace.dynamicBand === band)) {
          problems.push(problem(
            "missing-discovery-dynamic-band",
            `Discovery has no ${key} ${piano} constant layer in the ${band} band.`,
          ));
        }
      }
    }
    if (!rendererDiscovery.some(({ suite }) => suite === "dynamics-mixed")) {
      problems.push(problem(
        "missing-discovery-mixed",
        `Discovery has no ${key} mixed-dynamics trace.`,
      ));
    }
  }
  for (const definition of courseClearArticulationDefinitions()) {
    if (!discovery.some((trace) => (
      trace.suite === "articulation" && trace.articulation === definition.articulation
    ))) {
      problems.push(problem(
        "missing-discovery-articulation",
        `Discovery has no ${definition.articulation} articulation trace.`,
      ));
    }
  }

  const isolated = manifest.traces.filter(({ suite }) => suite === "isolated");
  const heldBackIsolated = isolated.filter(({ partition }) => partition !== "confirmation");
  if (heldBackIsolated.length > 0) {
    problems.push(problem(
      "isolated-not-confirmation",
      "The complete isolated corpus must stay untouched confirmation evidence.",
      heldBackIsolated.map(({ id }) => id),
    ));
  }
  for (const caseKind of LISTEN_ISOLATED_CASE_KINDS) {
    if (!confirmation.some((trace) => trace.caseKind === caseKind)) {
      problems.push(problem(
        "missing-confirmation-case-kind",
        `Confirmation has no isolated ${caseKind} case.`,
      ));
    }
  }
  for (const { key } of RENDERERS) {
    for (const piano of PIANO_IDS) {
      if (!confirmation.some((trace) => (
        trace.suite === "dynamics-constant" && trace.rendererKey === key && trace.piano === piano
      ))) {
        problems.push(problem(
          "missing-confirmation-layer",
          `Confirmation has no held-back ${key} ${piano} constant layer.`,
        ));
      }
    }
  }
  if (!confirmation.some(({ suite }) => suite === "articulation")) {
    problems.push(problem(
      "missing-confirmation-articulation",
      "Confirmation has no held-back articulation trace.",
    ));
  }
  if (!confirmation.some(({ suite }) => suite === "dynamics-mixed")) {
    problems.push(problem(
      "missing-confirmation-mixed",
      "Confirmation has no held-back mixed-dynamics trace.",
    ));
  }

  for (const definition of bundledListenSequences().filter(({ family }) => family === "safety")) {
    if (!regression.some((trace) => trace.sourceId === definition.id)) {
      problems.push(problem(
        "missing-regression-safety-family",
        `The dedicated safety passage ${definition.id} is not regression-only.`,
      ));
    }
  }
  for (const fixture of LISTEN_SAFETY_REGRESSION_FIXTURES) {
    const trace = regression.find((candidate) => candidate.sourceId === fixture.id);
    if (!trace) {
      problems.push(problem(
        "missing-regression-fixture",
        `The committed regression ${fixture.id} is not in the manifest.`,
      ));
      continue;
    }
    if (trace.fixtureVersion !== fixture.origin.sourceRecognitionStructureHash) {
      problems.push(problem(
        "regression-fixture-version",
        `${trace.id} does not pin the committed decoded-structure identity.`,
        [trace.id],
      ));
    }
    if (trace.derivedFromTraceId === null) {
      problems.push(problem(
        "unknown-regression-source",
        `${trace.id} names no measured source run.`,
        [trace.id],
      ));
      continue;
    }
    const source = manifest.traces.find(({ id }) => id === trace.derivedFromTraceId);
    if (!source) {
      problems.push(problem(
        "unknown-regression-source",
        `${trace.id} names the unknown source run ${trace.derivedFromTraceId}.`,
        [trace.id],
      ));
    } else if (source.partition === "confirmation") {
      problems.push(problem(
        "confirmation-source-of-regression",
        `${source.id} is confirmation evidence but was minimized into ${trace.id}.`,
        [source.id, trace.id],
      ));
    }
  }

  for (const entry of computeListenTraceWeights(manifest.traces)) {
    const trace = manifest.traces.find(({ id }) => id === entry.traceId);
    if (trace?.partition === "regression-only" && entry.weight !== 0) {
      problems.push(problem(
        "scored-regression-trace",
        `${entry.traceId} is regression-only but carries weight ${entry.weight}.`,
        [entry.traceId],
      ));
    }
  }

  return problems;
}

export function assertValidListenTraceManifest(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): void {
  const problems = validateListenTraceManifest(manifest);
  if (problems.length > 0) {
    throw new Error(
      `The listen trace manifest is invalid: ${problems
        .map(({ code, message }) => `${code}: ${message}`)
        .join(" ")}`,
    );
  }
}

/** Concise partition census for benchmark reports. */
export function summarizeListenTraceManifest(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): {
  version: number;
  hash: string;
  traceCount: number;
  partitions: Array<{ partition: ListenTracePartition; traceCount: number; suites: Array<{ suite: ListenTraceSuite; traceCount: number }> }>;
  valid: boolean;
} {
  return {
    version: manifest.version,
    hash: listenTraceManifestHash(manifest),
    traceCount: manifest.traces.length,
    partitions: LISTEN_TRACE_PARTITIONS.map((partition) => {
      const traces = listenTracesInPartition(partition, manifest);
      return {
        partition,
        traceCount: traces.length,
        suites: LISTEN_TRACE_SUITES
          .map((suite) => ({
            suite,
            traceCount: traces.filter((trace) => trace.suite === suite).length,
          }))
          .filter(({ traceCount }) => traceCount > 0),
      };
    }),
    valid: validateListenTraceManifest(manifest).length === 0,
  };
}
