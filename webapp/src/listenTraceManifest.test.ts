import assert from "node:assert/strict";
import test from "node:test";
import { bundledListenBenchmarkCases } from "./listenBenchmark";
import { LISTEN_SAFETY_REGRESSION_FIXTURES } from "./listenSafetyRegression";
import { LISTEN_OMITTED_BASS_REGRESSION_FIXTURES } from "./listenOmittedBassRegression";
import {
  LISTEN_ROUND_TWO_FIXTURE_GROUPS,
  LISTEN_ROUND_TWO_FIXTURE_ROLES,
} from "./listenRoundTwoFixtures";
import {
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  courseClearArticulationDefinitions,
} from "./listenSequenceBenchmark";
import { PIANO_IDS, pianoDefinition } from "./pianoRegistry";
import {
  LISTEN_CANDIDATE_METRIC_ORDER,
  LISTEN_DYNAMIC_BANDS,
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST_CENSUS,
  LISTEN_TRACE_MANIFEST_EXPECTED_RANKING_EFFECT,
  LISTEN_TRACE_MANIFEST_RECOGNITION_TARGET_COUNTS,
  LISTEN_TRACE_MANIFEST_TRACE_COUNT,
  canonicalListenMetricValue,
  listenTraceCensus,
  LISTEN_TRACE_MANIFEST,
  LISTEN_TRACE_MANIFEST_HASH,
  LISTEN_TRACE_MANIFEST_VERSION,
  LISTEN_TRACE_PARTITIONS,
  LISTEN_PRIOR_TRACE_LEDGER,
  LISTEN_PRIOR_TRACE_LEDGER_HASH,
  assertValidListenTraceManifest,
  buildListenTraceManifest,
  buildListenTraceManifestVersionOneControl,
  compareListenCandidates,
  computeListenTraceWeights,
  eligibleListenCandidates,
  findListenTrace,
  listenCandidateDominates,
  listenCandidateParetoFrontier,
  listenDynamicBand,
  listenIsolatedCaseKind,
  listenTraceDomainMeans,
  listenTraceCorpusHash,
  listenTraceManifestHash,
  listenPriorTraceLedgerHash,
  listenTraceMusicalInputHash,
  listenTraceWeightsForPartition,
  listenTracesInPartition,
  listenTracesInSuite,
  rankListenCandidates,
  summarizeListenTraceManifest,
  validateListenTraceManifest,
  weightedListenTraceMean,
  worstListenTraceDomain,
  type ListenCandidateMetrics,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
} from "./listenTraceManifest";

const WEIGHT_TOLERANCE = 1e-9;

function mutatedManifest(
  mutate: (trace: ListenTraceDescriptor) => ListenTraceDescriptor,
): ListenTraceManifest {
  return {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.map((trace) => mutate({ ...trace })),
  };
}

function candidate(
  profileId: string,
  overrides: Partial<ListenCandidateMetrics> = {},
): ListenCandidateMetrics {
  return {
    profileId,
    safe: true,
    worstDomainIndependentRate: 0.9,
    equalDomainIndependentRate: 0.9,
    orderedPrefixRate: 0.5,
    completePassageRate: 0.4,
    lateAdvanceCount: 1,
    lateAdvanceSourceDistance: 1,
    attributionDelayMs: 100,
    p95LatencyMs: 300,
    distanceFromBaseline: 0.1,
    ...overrides,
  };
}

test("assigns every automated trace exactly once", () => {
  const { traces } = LISTEN_TRACE_MANIFEST;
  const sequenceCount = bundledListenSequences().length * LISTEN_SEQUENCE_INTERVALS_MS.length * 2;
  const constantCount = PIANO_IDS
    .reduce((total, piano) => total + pianoDefinition(piano).benchmarkLayers.length, 0) * 2;
  const expected = sequenceCount +
    courseClearArticulationDefinitions().length * 2 +
    constantCount +
    PIANO_IDS.length * 2 +
    bundledListenBenchmarkCases().length * 2 +
    LISTEN_SAFETY_REGRESSION_FIXTURES.length +
    LISTEN_OMITTED_BASS_REGRESSION_FIXTURES.length +
    LISTEN_ROUND_TWO_FIXTURE_GROUPS.length * LISTEN_ROUND_TWO_FIXTURE_ROLES.length;
  assert.equal(traces.length, expected);
  assert.equal(traces.length, 504);
  assert.equal(new Set(traces.map(({ id }) => id)).size, traces.length);
  for (const trace of traces) {
    assert.ok(LISTEN_TRACE_PARTITIONS.includes(trace.partition), trace.id);
  }
  assert.equal(
    LISTEN_TRACE_PARTITIONS
      .reduce((total, partition) => total + listenTracesInPartition(partition).length, 0),
    traces.length,
  );
});

test("freezes the measured partition census", () => {
  assert.deepEqual(
    LISTEN_TRACE_PARTITIONS.map((partition) => [
      partition,
      listenTracesInPartition(partition).length,
    ]),
    [["discovery", 395], ["confirmation", 12], ["regression-only", 97]],
  );
  assert.equal(LISTEN_TRACE_MANIFEST_VERSION, 2);
  assert.ok(Object.isFrozen(LISTEN_TRACE_MANIFEST));
  assert.ok(Object.isFrozen(LISTEN_TRACE_MANIFEST.traces[0]));
});

test("accepts the frozen manifest and reports no problems", () => {
  assert.deepEqual(validateListenTraceManifest(), []);
  assert.doesNotThrow(() => assertValidListenTraceManifest());
  assert.equal(summarizeListenTraceManifest().valid, true);
  assert.deepEqual(buildListenTraceManifest().traces, LISTEN_TRACE_MANIFEST.traces);
});

test("classifies both swept sequence corpora as discovery and the safety families as gates", () => {
  const sequences = listenTracesInSuite("sequence");
  const safetyFamilies = new Set(bundledListenSequences()
    .filter(({ family }) => family === "safety")
    .map(({ id }) => id));
  for (const trace of sequences) {
    assert.equal(
      trace.partition,
      safetyFamilies.has(trace.sourceId) ? "regression-only" : "discovery",
      trace.id,
    );
  }
  for (const rendererKey of ["direct", "tone"] as const) {
    for (const intervalMs of LISTEN_SEQUENCE_INTERVALS_MS) {
      assert.ok(
        sequences.some((trace) => (
          trace.rendererKey === rendererKey &&
          trace.intervalMs === intervalMs &&
          trace.partition === "discovery"
        )),
        `${rendererKey} at ${intervalMs} ms`,
      );
    }
  }
});

test("covers every discovery domain the plan requires", () => {
  const discovery = listenTracesInPartition("discovery");
  for (const rendererKey of ["direct", "tone"] as const) {
    const rendered = discovery.filter((trace) => trace.rendererKey === rendererKey);
    for (const piano of PIANO_IDS) {
      for (const band of LISTEN_DYNAMIC_BANDS) {
        assert.ok(
          rendered.some((trace) => (
            trace.suite === "dynamics-constant" &&
            trace.piano === piano &&
            trace.dynamicBand === band
          )),
          `${rendererKey} ${piano} ${band}`,
        );
      }
    }
    assert.ok(rendered.some(({ suite }) => suite === "dynamics-mixed"), rendererKey);
  }
  for (const definition of courseClearArticulationDefinitions()) {
    assert.ok(
      discovery.some((trace) => trace.articulation === definition.articulation &&
        trace.suite === "articulation"),
      `${definition.articulation}`,
    );
  }
});

test("reserves only newly authored paired evidence for confirmation", () => {
  const confirmation = listenTracesInPartition("confirmation");
  const isolated = listenTracesInSuite("isolated");
  assert.equal(isolated.length, bundledListenBenchmarkCases().length * 2);
  assert.equal(isolated.filter(({ partition }) => partition === "discovery").length, 212);
  assert.equal(isolated.filter(({ partition }) => partition === "regression-only").length, 56);
  assert.ok(confirmation.every(({ suite }) => suite === "round-two-paired"));
  assert.ok(confirmation.every(({ decodeStatus, fixtureVersion }) => (
    decodeStatus === "not-decoded-until-task-28" && fixtureVersion === null
  )));
  for (const role of LISTEN_ROUND_TWO_FIXTURE_ROLES) {
    assert.ok(confirmation.some(({ pairedCaseRole }) => pairedCaseRole === role), role);
  }
  assert.ok(confirmation.some(({ repeatedRecoveryDesignStatus }) => (
    repeatedRecoveryDesignStatus === "designed-unverified"
  )));
});

test("counts the isolated corpus by case kind", () => {
  const kinds = new Map<string, number>();
  for (const trace of listenTracesInSuite("isolated").filter((t) => t.rendererKey === "direct")) {
    kinds.set(trace.caseKind ?? "none", (kinds.get(trace.caseKind ?? "none") ?? 0) + 1);
  }
  assert.deepEqual([...kinds.entries()].sort(), [
    ["ambiguous-harmonic", 8],
    ["correct", 106],
    ["distinguishable-wrong", 2],
    ["omitted-bass", 18],
  ]);
  assert.equal(listenIsolatedCaseKind([60], [60]), "correct");
  assert.equal(listenIsolatedCaseKind([60], [61]), "distinguishable-wrong");
  assert.equal(listenIsolatedCaseKind([60], [60, 72]), "ambiguous-harmonic");
  assert.equal(listenIsolatedCaseKind([52, 64, 72], [64, 72]), "omitted-bass");
});

test("routes the observed isolated census to scoring, safety, and diagnostic roles", () => {
  const isolated = listenTracesInSuite("isolated");
  const count = (caseKind: string, evidenceRole: string) => isolated.filter((trace) => (
    trace.caseKind === caseKind && trace.evidenceRole === evidenceRole
  )).length;
  assert.equal(count("correct", "scoring"), 212);
  assert.equal(count("omitted-bass", "safety"), 36);
  assert.equal(count("distinguishable-wrong", "safety"), 4);
  assert.equal(count("ambiguous-harmonic", "diagnostic"), 16);
  assert.ok(isolated.filter(({ evidenceRole }) => evidenceRole === "diagnostic")
    .every(({ scoreEligible }) => !scoreEligible));
});

test("binds Task 23 target rates to the finalized version-2 census", () => {
  assert.deepEqual(LISTEN_TRACE_MANIFEST_RECOGNITION_TARGET_COUNTS, [
    {
      rendererKey: "direct",
      metric: "isolated-correct-advance-rate",
      targetRate: 0.98,
      census: 106,
      targetCount: 104,
    },
    {
      rendererKey: "direct",
      metric: "course-clear-correct-advance-rate",
      targetRate: 0.95,
      census: 54,
      targetCount: 52,
    },
    {
      rendererKey: "tone",
      metric: "isolated-correct-advance-rate",
      targetRate: 0.95,
      census: 106,
      targetCount: 101,
    },
    {
      rendererKey: "tone",
      metric: "course-clear-correct-advance-rate",
      targetRate: 0.95,
      census: 54,
      targetCount: 52,
    },
  ]);
});

test("predeclares the concentrated weight of the sixth round-two suite", () => {
  const weights = listenTraceWeightsForPartition("discovery");
  const byId = new Map(weights.map((entry) => [entry.traceId, entry.weight]));
  const pairedCorrect = LISTEN_TRACE_MANIFEST.traces.filter(({ partition, suite, pairedCaseRole }) => (
    partition === "discovery" && suite === "round-two-paired" && pairedCaseRole === "correct"
  ));
  const isolatedCorrect = LISTEN_TRACE_MANIFEST.traces.filter(({ partition, suite }) => (
    partition === "discovery" && suite === "isolated"
  ));
  assert.equal(pairedCorrect.length, 4);
  assert.equal(isolatedCorrect.length, 212);
  assert.ok(pairedCorrect.every(({ id }) => (
    Math.abs((byId.get(id) ?? 0) - 1 / 24) < 1e-15
  )));
  assert.ok(isolatedCorrect.every(({ id }) => (
    Math.abs((byId.get(id) ?? 0) - 1 / 1_272) < 1e-15
  )));
  assert.ok(Math.abs((byId.get(pairedCorrect[0].id) ?? 0) /
    (byId.get(isolatedCorrect[0].id) ?? 1) - 53) < 1e-12);
  assert.match(LISTEN_TRACE_MANIFEST_EXPECTED_RANKING_EFFECT, /sixth co-equal suite/);
  assert.match(LISTEN_TRACE_MANIFEST_EXPECTED_RANKING_EFFECT, /53 times heavier/);
});

test("keeps every authored pair intact and non-scoring on its negative members", () => {
  for (const authored of LISTEN_ROUND_TWO_FIXTURE_GROUPS) {
    const traces = LISTEN_TRACE_MANIFEST.traces.filter(({ pairedGroupId }) => (
      pairedGroupId === authored.id
    ));
    assert.equal(traces.length, 3, authored.id);
    assert.deepEqual(traces.map(({ pairedCaseRole }) => pairedCaseRole).sort(), [
      "correct",
      "distinguishable-wrong",
      "omitted-bass",
    ]);
    assert.equal(new Set(traces.map(({ partition }) => partition)).size, 1);
    assert.equal(new Set(traces.map(({ pairedGroupHash }) => pairedGroupHash)).size, 1);
    assert.equal(traces.filter(({ scoreEligible }) => scoreEligible).length, 1);
  }
  for (const partition of ["discovery", "confirmation"] as const) {
    assert.ok(LISTEN_ROUND_TWO_FIXTURE_GROUPS.some((group) => (
      group.partition === partition && group.repeatedIdenticalChord
    )));
  }
});

test("pins prior evidence and rejects it from version-2 confirmation", () => {
  assert.equal(LISTEN_PRIOR_TRACE_LEDGER.length, 478);
  assert.equal(listenPriorTraceLedgerHash(), LISTEN_PRIOR_TRACE_LEDGER_HASH);
  const oldInput = LISTEN_PRIOR_TRACE_LEDGER[0];
  const leaked = mutatedManifest((trace) => (
    trace.partition === "confirmation" && trace.id === listenTracesInPartition("confirmation")[0].id
      ? { ...trace, musicalInputHash: oldInput.musicalInputHash }
      : trace
  ));
  assert.ok(validateListenTraceManifest(leaked)
    .some(({ code }) => code === "confirmation-seen-in-prior-round"));
  const relabelledContent = mutatedManifest((trace) => (
    trace.partition === "confirmation" && trace.id === listenTracesInPartition("confirmation")[0].id
      ? { ...trace, contentKey: oldInput.contentIdentity }
      : trace
  ));
  assert.ok(validateListenTraceManifest(relabelledContent)
    .some(({ code }) => code === "confirmation-seen-in-prior-round"));

  const versionOneAsVersionTwo: ListenTraceManifest = {
    ...buildListenTraceManifestVersionOneControl(),
    version: 2,
  };
  const codes = validateListenTraceManifest(versionOneAsVersionTwo).map(({ code }) => code);
  assert.ok(codes.includes("manifest-census"), codes.join(","));
  assert.ok(codes.includes("confirmation-not-authored-in-v2"), codes.join(","));
});

test("rejects splitting an authored pair across discovery and confirmation", () => {
  const groupId = LISTEN_ROUND_TWO_FIXTURE_GROUPS[0].id;
  const split = mutatedManifest((trace) => (
    trace.pairedGroupId === groupId && trace.pairedCaseRole === "omitted-bass"
      ? { ...trace, partition: "confirmation" }
      : trace
  ));
  assert.ok(validateListenTraceManifest(split).some(({ code }) => code === "split-paired-group"));
});

test("keeps discovery and confirmation from sharing rendered content", () => {
  const partitionsByContent = new Map<string, Set<string>>();
  for (const trace of LISTEN_TRACE_MANIFEST.traces) {
    const partitions = partitionsByContent.get(trace.contentKey) ?? new Set<string>();
    partitions.add(trace.partition);
    partitionsByContent.set(trace.contentKey, partitions);
  }
  for (const [contentKey, partitions] of partitionsByContent) {
    assert.equal(partitions.size, 1, contentKey);
  }
  // The articulation matrix's `normal` row renders the same passage as the
  // Splendid `mp` constant-layer run, so both are discovery.
  assert.equal(
    findListenTrace("articulation/direct/normal")?.contentKey,
    findListenTrace("dynamics-constant/direct/splendid/mp")?.contentKey,
  );
  assert.equal(findListenTrace("articulation/direct/normal")?.partition, "discovery");
});

test("rejects a manifest that moves one trace into the other partition", () => {
  const leaked = mutatedManifest((trace) => (
    trace.id === "dynamics-constant/direct/splendid/mp"
      ? { ...trace, partition: "confirmation" }
      : trace
  ));
  const codes = validateListenTraceManifest(leaked).map(({ code }) => code);
  assert.ok(codes.includes("split-content-key"), codes.join(","));
  assert.throws(() => assertValidListenTraceManifest(leaked), /invalid/);
});

test("rejects the amendments that keep every structural rule satisfied", () => {
  const withoutOneIsolatedCase: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.filter(({ id }) => id !== "isolated/direct/001"),
  };
  const promotedRegression = mutatedManifest((trace) => (
    trace.id === "dynamics-constant/tone/salamander/v05"
      ? { ...trace, partition: "discovery", scoreEligible: true }
      : trace
  ));
  const reweighted = mutatedManifest((trace) => (
    trace.id === "sequence/direct/course-clear-27/500ms"
      ? { ...trace, domain: "course-clear-direct" }
      : trace
  ));
  for (const [label, amended] of [
    ["dropped isolated case", withoutOneIsolatedCase],
    ["promoted regression run", promotedRegression],
    ["reweighted domain", reweighted],
  ] as const) {
    const codes = validateListenTraceManifest(amended).map(({ code }) => code);
    assert.ok(codes.includes("manifest-hash"), `${label}: ${codes.join(",")}`);
    assert.throws(() => assertValidListenTraceManifest(amended), /invalid/, label);
  }
  assert.ok(validateListenTraceManifest(withoutOneIsolatedCase)
    .some(({ code }) => code === "manifest-trace-count"));
  assert.ok(validateListenTraceManifest(promotedRegression)
    .some(({ code }) => code === "manifest-census"));
  // Relabelling to an unknown version is not the new-round process.
  for (const amended of [withoutOneIsolatedCase, promotedRegression, reweighted]) {
    const relabelled: ListenTraceManifest = { ...amended, version: 3 };
    assert.ok(validateListenTraceManifest(relabelled)
      .some(({ code }) => code === "unknown-manifest-version"));
    assert.throws(() => assertValidListenTraceManifest(relabelled), /unknown-manifest-version/);
  }
  assert.deepEqual(
    validateListenTraceManifest({ ...LISTEN_TRACE_MANIFEST, version: 3 })
      .map(({ code }) => code),
    ["unknown-manifest-version"],
  );
});

test("pins the exact census", () => {
  assert.deepEqual(listenTraceCensus(), [...LISTEN_TRACE_MANIFEST_CENSUS]);
  assert.equal(
    LISTEN_TRACE_MANIFEST_CENSUS.reduce((total, { traceCount }) => total + traceCount, 0),
    LISTEN_TRACE_MANIFEST_TRACE_COUNT,
  );
  assert.equal(LISTEN_TRACE_MANIFEST.traces.length, LISTEN_TRACE_MANIFEST_TRACE_COUNT);
});

test("rejects a manifest that duplicates or drops a trace", () => {
  const duplicated: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: [...LISTEN_TRACE_MANIFEST.traces, LISTEN_TRACE_MANIFEST.traces[0]],
  };
  assert.ok(validateListenTraceManifest(duplicated)
    .some(({ code }) => code === "duplicate-trace-id"));
  const withoutIsolated: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.filter(({ caseKind }) => caseKind !== "omitted-bass"),
  };
  assert.ok(validateListenTraceManifest(withoutIsolated)
    .some(({ code }) => code === "manifest-census"));
  const withoutTone: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.filter((trace) => (
      !(trace.rendererKey === "tone" && trace.partition === "discovery")
    )),
  };
  assert.ok(validateListenTraceManifest(withoutTone)
    .some(({ code }) => code === "missing-discovery-renderer"));
});

test("gates on safety families and all four committed regressions without scoring them", () => {
  const regression = listenTracesInPartition("regression-only");
  for (const definition of bundledListenSequences().filter(({ family }) => family === "safety")) {
    assert.equal(
      regression.filter(({ sourceId }) => sourceId === definition.id).length,
      LISTEN_SEQUENCE_INTERVALS_MS.length * 2,
      definition.id,
    );
  }
  for (const fixture of LISTEN_SAFETY_REGRESSION_FIXTURES) {
    const trace = regression.find(({ sourceId }) => sourceId === fixture.id);
    assert.ok(trace, fixture.id);
    assert.equal(trace.fixtureVersion, fixture.origin.sourceRecognitionStructureHash);
    const source = findListenTrace(trace.derivedFromTraceId ?? "");
    assert.ok(source, `${fixture.id} source`);
    assert.notEqual(source.partition, "confirmation");
  }
  for (const fixture of LISTEN_OMITTED_BASS_REGRESSION_FIXTURES) {
    const trace = regression.find(({ sourceId }) => sourceId === fixture.id);
    assert.ok(trace, fixture.id);
    assert.equal(trace.fixtureVersion, fixture.origin.sourceRecognitionStructureHash);
    assert.equal(trace.derivedFromTraceId, fixture.origin.traceId);
    assert.equal(trace.scoreEligible, false);
  }
  assert.equal(
    findListenTrace("regression/tone-salamander-v05-repeated-chord-late-advance")
      ?.derivedFromTraceId,
    "dynamics-constant/tone/salamander/v05",
  );
  assert.equal(
    findListenTrace("regression/tone-course-clear-333-shared-pitch-false-advance")
      ?.derivedFromTraceId,
    "sequence/tone/course-clear-27/333ms",
  );
  for (const entry of computeListenTraceWeights(LISTEN_TRACE_MANIFEST.traces)) {
    if (!findListenTrace(entry.traceId)?.scoreEligible) {
      assert.equal(entry.weight, 0, entry.traceId);
    }
  }
});

test("rejects a regression minimized from confirmation evidence", () => {
  const leaked = mutatedManifest((trace) => (
    trace.id === "dynamics-constant/tone/salamander/v05"
      ? { ...trace, partition: "confirmation", scoreEligible: true }
      : trace
  ));
  const codes = validateListenTraceManifest(leaked).map(({ code }) => code);
  assert.ok(codes.includes("confirmation-source-of-regression"), codes.join(","));
});

test("weights renderer, suite, domain, and run equally", () => {
  for (const partition of ["discovery", "confirmation"] as const) {
    const weights = listenTraceWeightsForPartition(partition);
    const total = weights.reduce((sum, { weight }) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < WEIGHT_TOLERANCE, `${partition} ${total}`);
    for (const rendererKey of ["direct", "tone"] as const) {
      const rendered = weights.filter((entry) => entry.rendererKey === rendererKey);
      const rendererTotal = rendered.reduce((sum, { weight }) => sum + weight, 0);
      assert.ok(Math.abs(rendererTotal - 0.5) < WEIGHT_TOLERANCE, `${partition} ${rendererKey}`);
      const suites = [...new Set(rendered.map(({ suite }) => suite))];
      for (const suite of suites) {
        const suiteTotal = rendered
          .filter((entry) => entry.suite === suite)
          .reduce((sum, { weight }) => sum + weight, 0);
        assert.ok(
          Math.abs(suiteTotal - 0.5 / suites.length) < WEIGHT_TOLERANCE,
          `${partition} ${rendererKey} ${suite} ${suiteTotal}`,
        );
      }
    }
  }
});

test("keeps 16 Salamander layers from outweighing four Splendid layers", () => {
  const constant = listenTracesInSuite("dynamics-constant")
    .filter((trace) => trace.rendererKey === "direct");
  assert.equal(constant.length, 20);
  const weights = computeListenTraceWeights(constant);
  const pianoWeight = (piano: string) => weights
    .filter((entry) => findListenTrace(entry.traceId)?.piano === piano)
    .reduce((sum, { weight }) => sum + weight, 0);
  assert.ok(Math.abs(pianoWeight("splendid") - pianoWeight("salamander")) < WEIGHT_TOLERANCE);
  // A suite with more runs gains no extra top-level weight either.
  const isolatedAndArticulation = [
    ...listenTracesInSuite("isolated").filter((trace) => trace.rendererKey === "direct"),
    ...listenTracesInSuite("articulation").filter((trace) => trace.rendererKey === "direct"),
  ];
  const mixedWeights = computeListenTraceWeights(isolatedAndArticulation);
  const suiteWeight = (suite: string) => mixedWeights
    .filter((entry) => entry.suite === suite)
    .reduce((sum, { weight }) => sum + weight, 0);
  assert.ok(Math.abs(suiteWeight("isolated") - suiteWeight("articulation")) < WEIGHT_TOLERANCE);
});

test("averages by domain rather than by run count", () => {
  const weights = listenTraceWeightsForPartition("discovery")
    .filter((entry) => entry.suite === "dynamics-constant" && entry.rendererKey === "direct");
  const value = (traceId: string) => (traceId.includes("salamander") ? 0 : 1);
  const means = listenTraceDomainMeans(weights, value);
  assert.deepEqual(means.map(({ domainKey, value: mean }) => [domainKey, mean]).sort(), [
    ["direct/dynamics-constant/salamander", 0],
    ["direct/dynamics-constant/splendid", 1],
  ]);
  // One Splendid layer against 13 Salamander layers still averages to 0.5.
  const mean = weightedListenTraceMean(weights, value);
  assert.ok(mean !== null && Math.abs(mean - 0.5) < WEIGHT_TOLERANCE, `${mean}`);
  assert.deepEqual(worstListenTraceDomain(weights, value), {
    domainKey: "direct/dynamics-constant/salamander",
    value: 0,
    traceCount: 16,
  });
  assert.equal(weightedListenTraceMean(weights, () => null), null);
});

test("pins the manifest, its weights, and the metric order to one hash", () => {
  assert.equal(listenTraceManifestHash(), LISTEN_TRACE_MANIFEST_HASH);
  assert.equal(listenTraceManifestHash(buildListenTraceManifest()), LISTEN_TRACE_MANIFEST_HASH);
  const repartitioned = mutatedManifest((trace) => (
    trace.id === "dynamics-constant/direct/salamander/v09"
      ? { ...trace, partition: "confirmation" }
      : trace
  ));
  assert.notEqual(listenTraceManifestHash(repartitioned), LISTEN_TRACE_MANIFEST_HASH);
  const reweighted: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.filter((trace) => (
      trace.id !== "dynamics-constant/direct/salamander/v14"
    )),
  };
  assert.notEqual(listenTraceManifestHash(reweighted), LISTEN_TRACE_MANIFEST_HASH);
  const renamed = mutatedManifest((trace) => (
    trace.id === "sequence/tone/course-clear-27/333ms"
      ? { ...trace, domain: "course-clear-tone" }
      : trace
  ));
  assert.notEqual(listenTraceManifestHash(renamed), LISTEN_TRACE_MANIFEST_HASH);
});

test("pins pitches, attack timing, holds, and same-family corpus ordering", () => {
  const input = {
    targets: [[60], [62]],
    attacks: [
      {
        targetIndex: 0,
        scheduledAtMs: 220,
        expectedAdvance: true,
        targetStart: null,
        gainReferenceChordSize: null,
        notes: [{ midi: 60, attackTimeMs: 220, holdMs: 700 }],
      },
      {
        targetIndex: 1,
        scheduledAtMs: 720,
        expectedAdvance: true,
        targetStart: null,
        gainReferenceChordSize: null,
        notes: [{ midi: 62, attackTimeMs: 738, holdMs: 650 }],
      },
    ],
    attackLayers: ["mp", "ff"],
    durationMs: 1_700,
    releaseMs: 120,
  } as const;
  const digest = listenTraceMusicalInputHash(input);
  assert.notEqual(listenTraceMusicalInputHash({
    ...input,
    targets: [[60], [63]],
  }), digest, "target pitch");
  assert.notEqual(listenTraceMusicalInputHash({
    ...input,
    attacks: [input.attacks[0], {
      ...input.attacks[1],
      notes: [{ ...input.attacks[1].notes[0], midi: 63 }],
    }],
  }), digest, "performed pitch");
  assert.notEqual(listenTraceMusicalInputHash({
    ...input,
    attacks: [input.attacks[0], {
      ...input.attacks[1],
      scheduledAtMs: 721,
      notes: [{ ...input.attacks[1].notes[0], attackTimeMs: 739 }],
    }],
  }), digest, "attack timing");
  assert.notEqual(listenTraceMusicalInputHash({
    ...input,
    attacks: [input.attacks[0], {
      ...input.attacks[1],
      notes: [{ ...input.attacks[1].notes[0], holdMs: 651 }],
    }],
  }), digest, "hold duration");

  assert.equal(listenTraceCorpusHash(), LISTEN_TRACE_CORPUS_HASH);
  assert.equal(summarizeListenTraceManifest().corpusHash, LISTEN_TRACE_CORPUS_HASH);
  const pitchChanged = mutatedManifest((trace) => (
    trace.id === "sequence/direct/ascending-scale/500ms"
      ? { ...trace, musicalInputHash: digest }
      : trace
  ));
  assert.notEqual(listenTraceCorpusHash(pitchChanged), LISTEN_TRACE_CORPUS_HASH);
  assert.ok(validateListenTraceManifest(pitchChanged).some(({ code }) => code === "corpus-hash"));

  const ascendingId = "sequence/direct/ascending-scale/1000ms";
  const descendingId = "sequence/direct/descending-scale/1000ms";
  const ascendingHash = findListenTrace(ascendingId)?.musicalInputHash;
  const descendingHash = findListenTrace(descendingId)?.musicalInputHash;
  assert.ok(ascendingHash && descendingHash && ascendingHash !== descendingHash);
  const sameFamilyReordered = mutatedManifest((trace) => (
    trace.id === ascendingId
      ? { ...trace, musicalInputHash: descendingHash! }
      : trace.id === descendingId
        ? { ...trace, musicalInputHash: ascendingHash! }
        : trace
  ));
  assert.notEqual(listenTraceCorpusHash(sameFamilyReordered), LISTEN_TRACE_CORPUS_HASH);

  const reorderedTraces = [...LISTEN_TRACE_MANIFEST.traces];
  const ascendingIndex = reorderedTraces.findIndex(({ id }) => id === ascendingId);
  const descendingIndex = reorderedTraces.findIndex(({ id }) => id === descendingId);
  assert.ok(ascendingIndex >= 0 && descendingIndex >= 0);
  [reorderedTraces[ascendingIndex], reorderedTraces[descendingIndex]] =
    [reorderedTraces[descendingIndex], reorderedTraces[ascendingIndex]];
  assert.notEqual(
    listenTraceCorpusHash({ ...LISTEN_TRACE_MANIFEST, traces: reorderedTraces }),
    LISTEN_TRACE_CORPUS_HASH,
    "same-family trace order",
  );
});

test("freezes the candidate metric order", () => {
  assert.deepEqual(LISTEN_CANDIDATE_METRIC_ORDER.map(({ key }) => key), [
    "worstDomainIndependentRate",
    "equalDomainIndependentRate",
    "orderedPrefixRate",
    "completePassageRate",
    "lateAdvanceCount",
    "lateAdvanceSourceDistance",
    "attributionDelayMs",
    "p95LatencyMs",
    "distanceFromBaseline",
  ]);
  assert.deepEqual(LISTEN_CANDIDATE_METRIC_ORDER.map(({ direction }) => direction), [
    "higher-is-better",
    "higher-is-better",
    "higher-is-better",
    "higher-is-better",
    "lower-is-better",
    "lower-is-better",
    "lower-is-better",
    "lower-is-better",
    "lower-is-better",
  ]);
  assert.ok(Object.isFrozen(LISTEN_CANDIDATE_METRIC_ORDER));
});

test("treats safety as a hard constraint rather than a ranking term", () => {
  const unsafeButBetter = candidate("unsafe", {
    safe: false,
    worstDomainIndependentRate: 1,
    equalDomainIndependentRate: 1,
    orderedPrefixRate: 1,
    completePassageRate: 1,
    lateAdvanceCount: 0,
    p95LatencyMs: 1,
    distanceFromBaseline: 0,
  });
  const safe = candidate("safe", { worstDomainIndependentRate: 0.1 });
  assert.deepEqual(
    rankListenCandidates([unsafeButBetter, safe]).map(({ profileId }) => profileId),
    ["safe", "unsafe"],
  );
  assert.deepEqual(
    eligibleListenCandidates([unsafeButBetter, safe]).map(({ profileId }) => profileId),
    ["safe"],
  );
  assert.deepEqual(
    listenCandidateParetoFrontier([unsafeButBetter, safe]).map(({ profileId }) => profileId),
    ["safe"],
  );
  // The dominance helper carries the gate itself, so a direct caller that skips
  // the frontier's eligibility filter cannot be told the unsafe profile is better.
  assert.equal(listenCandidateDominates(unsafeButBetter, safe), false);
  assert.equal(listenCandidateDominates(safe, unsafeButBetter), true);
  assert.equal(listenCandidateDominates(unsafeButBetter, { ...unsafeButBetter, profileId: "u2" }), false);
});

test("ranks independent recognition ahead of ordered cascade gains", () => {
  const cascade = candidate("cascade", {
    worstDomainIndependentRate: 0.80,
    equalDomainIndependentRate: 0.90,
    orderedPrefixRate: 0.95,
    completePassageRate: 0.95,
  });
  const recognition = candidate("recognition", {
    worstDomainIndependentRate: 0.81,
    equalDomainIndependentRate: 0.89,
    orderedPrefixRate: 0.10,
    completePassageRate: 0.10,
  });
  assert.deepEqual(
    rankListenCandidates([cascade, recognition]).map(({ profileId }) => profileId),
    ["recognition", "cascade"],
  );
  const equalWorst = candidate("equal-worst", {
    worstDomainIndependentRate: 0.81,
    equalDomainIndependentRate: 0.95,
    orderedPrefixRate: 0,
  });
  assert.deepEqual(
    rankListenCandidates([recognition, equalWorst]).map(({ profileId }) => profileId),
    ["equal-worst", "recognition"],
  );
});

test("breaks remaining ties by baseline distance and then by identifier", () => {
  const near = candidate("near", { distanceFromBaseline: 0.05 });
  const far = candidate("far", { distanceFromBaseline: 0.40 });
  assert.deepEqual(
    rankListenCandidates([far, near]).map(({ profileId }) => profileId),
    ["near", "far"],
  );
  const first = candidate("aaa-v2");
  const second = candidate("zzz-v2");
  assert.deepEqual(
    rankListenCandidates([second, first]).map(({ profileId }) => profileId),
    ["aaa-v2", "zzz-v2"],
  );
  assert.equal(compareListenCandidates(first, { ...first }), 0);
  // Replay noise far below the grid step is one value, not an ordering.
  assert.equal(
    compareListenCandidates(first, candidate("aaa-v2", {
      worstDomainIndependentRate: 0.9 + 1e-12,
    })),
    0,
  );
  assert.equal(
    canonicalListenMetricValue(0.9, "higher-is-better"),
    canonicalListenMetricValue(0.9 + 1e-12, "higher-is-better"),
  );
  // A missing latency measurement sorts last rather than best.
  assert.deepEqual(
    rankListenCandidates([
      candidate("unknown-latency", { p95LatencyMs: null }),
      candidate("measured", { p95LatencyMs: 390 }),
    ]).map(({ profileId }) => profileId),
    ["measured", "unknown-latency"],
  );
});

test("orders candidates transitively whatever order they arrive in", () => {
  // Values a fraction of the grid step apart: a pairwise tolerance would report
  // a == b, b == c, and a < c, and the sort result would follow the input order.
  const chain = [
    candidate("a", { worstDomainIndependentRate: 0.9 }),
    candidate("b", { worstDomainIndependentRate: 0.9 + 0.6e-9 }),
    candidate("c", { worstDomainIndependentRate: 0.9 + 1.2e-9 }),
  ];
  for (const left of chain) {
    for (const middle of chain) {
      for (const right of chain) {
        const leftMiddle = compareListenCandidates(left, middle);
        const middleRight = compareListenCandidates(middle, right);
        const leftRight = compareListenCandidates(left, right);
        if (leftMiddle === 0 && middleRight === 0) {
          assert.equal(leftRight, 0, `${left.profileId}${middle.profileId}${right.profileId}`);
        }
        if (leftMiddle < 0 && middleRight <= 0) {
          assert.ok(leftRight < 0, `${left.profileId}${middle.profileId}${right.profileId}`);
        }
        const reversed = compareListenCandidates(middle, left);
        assert.ok(
          (leftMiddle === 0 && reversed === 0) ||
            (leftMiddle < 0 && reversed > 0) ||
            (leftMiddle > 0 && reversed < 0),
          `${left.profileId} vs ${middle.profileId}`,
        );
      }
    }
  }
  const permutations = [
    [chain[0], chain[1], chain[2]],
    [chain[1], chain[2], chain[0]],
    [chain[2], chain[1], chain[0]],
    [chain[1], chain[0], chain[2]],
    [chain[2], chain[0], chain[1]],
    [chain[0], chain[2], chain[1]],
  ];
  const rankings = permutations.map((order) => (
    rankListenCandidates(order).map(({ profileId }) => profileId).join(",")
  ));
  assert.equal(new Set(rankings).size, 1, rankings.join(" | "));
});

test("computes a deterministic safe Pareto frontier", () => {
  const dominated = candidate("dominated", {
    worstDomainIndependentRate: 0.80,
    equalDomainIndependentRate: 0.80,
    p95LatencyMs: 350,
  });
  const dominant = candidate("dominant", {
    worstDomainIndependentRate: 0.85,
    equalDomainIndependentRate: 0.85,
    p95LatencyMs: 300,
  });
  const tradeoff = candidate("tradeoff", {
    worstDomainIndependentRate: 0.84,
    equalDomainIndependentRate: 0.92,
    p95LatencyMs: 380,
  });
  assert.ok(listenCandidateDominates(dominant, dominated));
  assert.ok(!listenCandidateDominates(tradeoff, dominant));
  assert.ok(!listenCandidateDominates(dominant, tradeoff));
  assert.ok(!listenCandidateDominates(dominant, { ...dominant, profileId: "copy" }));
  const frontier = listenCandidateParetoFrontier([tradeoff, dominated, dominant]);
  assert.deepEqual(frontier.map(({ profileId }) => profileId), ["dominant", "tradeoff"]);
  assert.deepEqual(
    listenCandidateParetoFrontier([dominant, tradeoff, dominated])
      .map(({ profileId }) => profileId),
    frontier.map(({ profileId }) => profileId),
  );
});

test("bands velocity layers by loudness", () => {
  assert.equal(listenDynamicBand("splendid", "pp"), "quiet");
  assert.equal(listenDynamicBand("splendid", "mf"), "medium");
  assert.equal(listenDynamicBand("splendid", "ff"), "loud");
  assert.equal(listenDynamicBand("salamander", "v01"), "quiet");
  assert.equal(listenDynamicBand("salamander", "v05"), "quiet");
  assert.equal(listenDynamicBand("salamander", "v09"), "medium");
  assert.equal(listenDynamicBand("salamander", "v16"), "loud");
});
