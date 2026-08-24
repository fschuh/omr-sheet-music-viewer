import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONFIRMATION_EVIDENCE,
  bassQualificationProblems,
  compareEvidenceRuns,
  confirmationEvidenceProblems,
  firstEvidenceDifference,
  main,
  rescoreTask13ArchiveUnderRoundTwoPolicy,
  roundTwoAblationProblems,
  task24DomainArchiveProblems,
} from "./verify_listen_benchmark_evidence.mjs";

const COLUMN = [
  CONFIRMATION_EVIDENCE.baselineProfileId,
  ...CONFIRMATION_EVIDENCE.candidateProfileIds,
];

const TASK24_ARTIFACT = {
  name: "Task 24 per-domain control archive",
  task24DomainArchive: {
    name: "listen-matcher-domain-archive",
    formatVersion: 1,
    policyVersion: 1,
    policyHash: "840b07ec",
    manifestVersion: 1,
    manifestHash: "0ed1e71d",
    manifestCorpusHash: "10ae2e0b",
    candidateCount: 1_000,
    safeProfileCount: 279,
    leafDomainCount: 29,
    task08CandidateDigest: "53ee8a67",
    task24Digest: "1aab7393",
    verdict: "one-global-profile-suffices",
    bestGlobalProfileId: "o0p450-t0p500-a0p200-x0p990-b1",
    bestGlobalTieProfileIds: [
      "o0p450-t0p500-a0p200-x0p990-b1",
      "o0p450-t0p425-a0p200-x0p990-b1",
      "o0p450-t0p350-a0p200-x0p990-b1",
    ],
    selectedProfileIds: ["o0p450-t0p500-a0p200-x0p990-b1"],
    singleTraceDomainCount: 7,
    invariantDomainCount: 8,
    boundaryFinerThanSmallestPositiveStepDomainCount: 19,
    task08RejectedCount: 721,
    task08FrontierCount: 30,
    task08SelectedProfileIds: [
      "o0p450-t0p500-a0p200-x0p990-b1",
      "o0p500-t0p500-a0p200-x0p990-b1",
      "o0p450-t0p500-a0p275-x0p990-b1",
      "o0p500-t0p500-a0p275-x0p990-b1",
    ],
  },
};

test("the Task 24 verifier accepts the complete archive and rejects a changed control", async () => {
  const archive = JSON.parse(await readFile(join(
    import.meta.dirname,
    "../../benchmark-results/listen-matcher-domain-archive-task24.json",
  ), "utf8"));
  assert.deepEqual(task24DomainArchiveProblems(TASK24_ARTIFACT, archive), []);
  const changed = structuredClone(archive);
  changed[0].task24.version1Control.bestGlobal.profileId = "post-result-retune";
  assert.ok(task24DomainArchiveProblems(TASK24_ARTIFACT, changed)
    .some((problem) => problem.includes("best global profile")));
  const selfDeclaredDigest = structuredClone(archive);
  selfDeclaredDigest[0].task24.candidates[0].leafDomains[0].independentRate += 0.001;
  assert.ok(task24DomainArchiveProblems(TASK24_ARTIFACT, selfDeclaredDigest)
    .some((problem) => problem.includes("recomputed Task 24 digest")));
});

const TASK26_ARTIFACT = {
  name: "Task 26 staged round-two ablations",
  roundTwoAblation: {
    generatorVersion: 1,
    policyVersion: 1,
    policyHash: "840b07ec",
    manifestVersion: 2,
    manifestHash: "d1971fa3",
    manifestCorpusHash: "1213016e",
    capturedTraceCount: 472,
    terminalOutcome: "bass-axis-unsupported",
    digest: "8dfe2f1b",
    activeTargetRefinementPoints: [0.075, 0.1, 0.125, 0.3, 0.325],
    targetNoteRefinementPoints: [0.4625, 0.5375],
    bassOnsetPoints: [0.55, 0.6, 0.7],
    task22LimitingMinimum: 0.09577340414698106,
    repeatedRecoveryBoundaries: {
      sourceDistanceNoRegression: 0,
      attributionDelayNoRegressionMs: 32,
      sourceDistanceMaterialGain: 1,
      attributionDelayMaterialGainMs: 500,
    },
    domainRegretMaterialBoundary: 0.01,
    knownDiscoveryGroupIds: [
      "dynamics-constant/tone/salamander/v05",
      "dynamics-constant/tone/salamander/v13",
      "dynamics-mixed/tone/salamander",
    ],
    processLocalDigestFields: [
      "lowestLimitingUpperVoiceEvidence",
      "onsetConfidence",
      "targetEvidence",
      "task22LimitingUpperVoiceEvidence",
      "transitionLowestLimitingUpperVoiceEvidence",
    ],
    repeatedChordGroupIds: [
      "dynamics-constant/tone/salamander/v05",
      "dynamics-constant/tone/salamander/v13",
      "dynamics-mixed/tone/salamander",
      "round-two/r2-repeated-low-triad-direct-splendid-pp/correct",
      "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/correct",
    ],
    ablations: [
      {
        id: "ablation-1-round-one-grid",
        gridSize: 1_000,
        bassAxisPresent: false,
        safeProfileCount: 159,
        verdict: "domain-spread-material",
        stopSatisfied: false,
        stopReasons: ["selected-set-has-no-material-repeated-recovery"],
        selectedProfileIds: [
          "o0p550-t0p500-a0p350-x0p990-b1",
          "o0p450-t0p575-a0p275-x0p970-b1",
          "o0p550-t0p500-a0p200-x0p970-b1",
        ],
      },
      {
        id: "ablation-2-refined-family",
        gridSize: 1_400,
        bassAxisPresent: false,
        safeProfileCount: 452,
        verdict: "domain-spread-material",
        stopSatisfied: false,
        stopReasons: ["selected-set-has-no-material-repeated-recovery"],
        selectedProfileIds: [
          "o0p450-t0p5375-a0p300-x0p990-b1",
          "o0p450-t0p5375-a0p075-x0p970-b1",
        ],
      },
      {
        id: "ablation-3-bass-axis",
        gridSize: 4_200,
        bassAxisPresent: true,
        safeProfileCount: 2_294,
        verdict: "domain-spread-material",
        stopSatisfied: false,
        stopReasons: ["selected-set-has-no-material-repeated-recovery"],
        selectedProfileIds: [
          "o0p450-t0p500-a0p075-x0p990-b1-B0p550",
          "o0p450-t0p5375-a0p075-x0p970-b1",
        ],
      },
    ],
  },
};

test("the Task 26 verifier accepts the staged record and rejects an unearned outcome", async () => {
  const archive = JSON.parse(await readFile(join(
    import.meta.dirname,
    "../../benchmark-results/listen-round-two-ablation-task26-run1.json",
  ), "utf8"));
  assert.deepEqual(roundTwoAblationProblems(TASK26_ARTIFACT, archive), []);

  // The outcome must follow from the recorded stop verdicts rather than being
  // stated by the file: an ablation whose predecessor satisfied the stop rule
  // was never authorised to run.
  const unauthorised = structuredClone(archive);
  unauthorised[0].ablations[0].stop = { satisfied: true, runNextAblation: false, reasons: [] };
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, unauthorised)
    .some((problem) => problem.includes("recomputed terminal outcome")));
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, unauthorised)
    .some((problem) => problem.includes("did not authorise the ablation recorded after it")));

  // A stop verdict that does not follow from its own reasons is rejected even
  // when the outcome it produces is the pinned one.
  const inconsistent = structuredClone(archive);
  inconsistent[0].ablations[0].stop.reasons = [];
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, inconsistent)
    .some((problem) => problem.includes("does not follow from its reasons")));

  // The digest is recomputed from the record rather than read from it.
  const retuned = structuredClone(archive);
  retuned[0].ablations[0].domainRegret.gridRows[0].worstDomainRegret = 0;
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, retuned)
    .some((problem) => problem.includes("recomputed digest")));

  // Widening what the digest ignores is itself a change to the recipe.
  const widened = structuredClone(archive);
  widened[0].digest.processLocalFieldsExcluded = ["selectedProfileIds"];
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, widened)
    .some((problem) => problem.includes("excluded fields changed")));

  // A selected profile whose repeated-chord evidence is missing cannot pass.
  const missingRecovery = structuredClone(archive);
  missingRecovery[0].ablations[0].repeatedRecovery.pop();
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, missingRecovery)
    .some((problem) => problem.includes("does not report every selected profile")));

  // Reading confirmation evidence would show up as a reproduction status.
  const readConfirmation = structuredClone(archive);
  readConfirmation[0].ablations[0].repeatedRecovery[0].evaluation
    .confirmationReproductionStatus = "reproduced";
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, readConfirmation)
    .some((problem) => problem.includes("reads confirmation evidence")));

  // The repeated-recovery verdicts are recomputed from both sides' archived
  // measurements: a run that moved a full attack later than the incumbent is a
  // regression however the file describes itself.
  const movedRun = structuredClone(archive);
  const measurement = movedRun[0].ablations[0].repeatedRecovery[0].measurements
    .find(({ observation }) => observation.sourceDistance !== null);
  measurement.observation.sourceDistance += 2;
  measurement.observation.attributionDelayMs += 2_000;
  const movedProblems = roundTwoAblationProblems(TASK26_ARTIFACT, movedRun);
  assert.ok(movedProblems.some((problem) => problem.includes("records noRegression=true")));
  assert.ok(movedProblems.some((problem) => (
    problem.includes("per-group verdicts do not follow from their own measurements")
  )));
  // …and the stop rule the record states is recomputed from those verdicts.
  assert.ok(movedProblems.some((problem) => problem.includes("do not follow from its own")));

  // The matched-pair support is recomputed too, from the twin's own archived
  // measurements rather than from the stored boolean.
  const claimedSupport = structuredClone(archive);
  const pair = claimedSupport[0].ablations.at(-1).matchedPairs[0];
  pair.support = {
    ...pair.support,
    supported: true,
    reasons: [],
  };
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, claimedSupport)
    .some((problem) => problem.includes("does not follow from its own pair")));

  // A pair that archives only the axis side cannot be recomputed at all.
  const halfPair = structuredClone(archive);
  delete halfPair[0].ablations.at(-1).matchedPairs[0].twinRepeatedMeasurements;
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, halfPair)
    .some((problem) => problem.includes("archives no complete twin comparison")));

  // A missing incumbent row would read as an unrecovered baseline and turn any
  // candidate recovery into a categorical material gain, so it is refused.
  const halfBaseline = structuredClone(archive);
  halfBaseline[0].ablations[0].baselineRepeatedMeasurements.shift();
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, halfBaseline)
    .some((problem) => problem.includes("archives no complete incumbent comparison")));

  // The pair's axis side is held to the same census as its twin side.
  const halfAxis = structuredClone(archive);
  halfAxis[0].ablations.at(-1).matchedPairs[0].repeatedRecoveryAgainstTwin.measurements.pop();
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, halfAxis)
    .some((problem) => problem.includes("archives no complete axis comparison")));

  // Every Task 24 aggregate is recomputed, not only the three the stop rule
  // reads: a relabelled outcome or resolution claim is refused.
  const relabelled = structuredClone(archive);
  relabelled[0].ablations[0].repeatedRecovery[0].evaluation.repeatedRecoveryOutcome =
    "discovery-full-resolution";
  relabelled[0].ablations[0].repeatedRecovery[0].evaluation.discoveryFullResolution = true;
  const relabelledProblems = roundTwoAblationProblems(TASK26_ARTIFACT, relabelled);
  assert.ok(relabelledProblems.some((problem) => (
    problem.includes("records repeatedRecoveryOutcome=")
  )));
  assert.ok(relabelledProblems.some((problem) => (
    problem.includes("records discoveryFullResolution=")
  )));

  // Confirmation aggregates are derived from the declared evidence roles, so a
  // record that claims a reproducing confirmation group is refused twice over.
  const claimedConfirmation = structuredClone(archive);
  const claimedEvaluation = claimedConfirmation[0].ablations[0].repeatedRecovery[0].evaluation;
  claimedEvaluation.reproducingConfirmationGroupIds = ["dynamics-mixed/tone/salamander"];
  claimedEvaluation.groups[0].evidenceRole = "confirmation";
  const confirmationProblems = roundTwoAblationProblems(TASK26_ARTIFACT, claimedConfirmation);
  assert.ok(confirmationProblems.some((problem) => (
    problem.includes("reproducingConfirmationGroupIds that its own evidence does not support")
  )));
  assert.ok(confirmationProblems.some((problem) => problem.includes("declares evidence roles")));

  // Pair support inputs are resolved from the grid the pair came from, so a
  // safety rescue the grid does not show is refused.
  const claimedRescue = structuredClone(archive);
  const rescuePair = claimedRescue[0].ablations.at(-1).matchedPairs[0];
  rescuePair.twinSafe = true;
  rescuePair.support = { ...rescuePair.support, categoricalSafetyRescue: false };
  const rescueProblems = roundTwoAblationProblems(TASK26_ARTIFACT, claimedRescue);
  assert.ok(rescueProblems.some((problem) => problem.includes("records twinSafe=true")));
  assert.ok(rescueProblems.some((problem) => problem.includes("does not follow from its own pair")));

  // The numeric regret gain is compared too, not only the booleans it feeds.
  const movedGain = structuredClone(archive);
  movedGain[0].ablations.at(-1).matchedPairs[0].support.worstDomainRegretGain = 0.005;
  assert.ok(roundTwoAblationProblems(TASK26_ARTIFACT, movedGain)
    .some((problem) => problem.includes("does not follow from its own pair")));
});

/** The frozen corpus sizes, so a fixture is the shape a real repetition has. */
const DOMAIN_TRACE_COUNTS = Object.fromEntries(CONFIRMATION_EVIDENCE.domains
  .map(({ domain, capturedTraceCount }) => [domain, capturedTraceCount]));

function digest(text) {
  let hash = 0x811c9dc5;
  for (const character of text) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The archive's own digest recipes, which the verifier recomputes. */
function identityDigest(parts) {
  return digest(parts.join(" "));
}

/** The archive's own aggregate recipes, so a fixture stays internally consistent. */
function fixtureOutcomeDigest(rows) {
  return identityDigest(rows.map((row) => `${row.traceId}:${row.profileId}:${row.outcomeDigest}`));
}

function fixtureIdentityDigest(traceIdentities) {
  return identityDigest(traceIdentities.map((identity) => (
    `${identity.traceId}:${identity.recognitionStructureHash}:${identity.frameCount}`
  )));
}

function domainIdentity(expected) {
  const { domain, capturedTraceCount, suites, partitions, evidenceRole } = expected;
  const traceIdentities = [];
  const outcomeIdentities = [];
  for (let index = 0; index < capturedTraceCount; index += 1) {
    // Renderers, suites, and partitions all cycle, so every frozen value the
    // domain is allowed to contain appears at least once in the fixture.
    const rendererKey = CONFIRMATION_EVIDENCE.rendererKeys[index % 2];
    const partition = partitions[index % partitions.length];
    const suite = suites[index % suites.length];
    const traceId = `${suite}/${rendererKey}/${String(index).padStart(3, "0")}`;
    traceIdentities.push({
      traceId,
      partition,
      rendererKey,
      recognitionStructureHash: digest(`structure ${traceId}`),
      frameCount: 40 + index,
      // Recorded per trace and excluded from the comparison, exactly as a
      // measured repetition carries them.
      processLocalPcmHash: digest(`pcm ${traceId}`),
      processLocalTraceHash: digest(`raw ${traceId}`),
    });
    for (const profileId of COLUMN) {
      outcomeIdentities.push({
        traceId,
        rendererKey,
        partition,
        profileId,
        outcomeDigest: digest(`outcome ${traceId} ${profileId}`),
      });
    }
  }
  return {
    domain,
    present: true,
    manifestVersion: CONFIRMATION_EVIDENCE.manifestVersion,
    manifestHash: CONFIRMATION_EVIDENCE.manifestHash,
    manifestCorpusHash: CONFIRMATION_EVIDENCE.manifestCorpusHash,
    capturedTraceCount,
    rendererKeys: [...CONFIRMATION_EVIDENCE.rendererKeys],
    partitions: [...partitions],
    evidenceRole,
    traceReuseVerified: true,
    baselineParityVerified: true,
    traceIdentities,
    identityDigest: fixtureIdentityDigest(traceIdentities),
    outcomeIdentities,
    outcomeDigest: fixtureOutcomeDigest(outcomeIdentities),
  };
}

/** The rows a complete matrix reads for this gate, and the role they carry. */
function gateScope(gate) {
  const partitions = [...gate.partitions];
  const evidenceRole = partitions.includes("regression-only")
    ? null
    : partitions.length === 1
    ? (partitions[0] === "discovery" ? "discovery" : "confirmation")
    : "mixed";
  return { partitions, evidenceRole };
}

/** One candidate's complete verdict: every gate applied, every gate passed. */
function candidateReport(profileId) {
  return {
    profileId,
    profile: { ...CONFIRMATION_EVIDENCE.profiles[profileId] },
    gates: CONFIRMATION_EVIDENCE.gates.map(({ partitions: _partitions, ...gate }) => ({
      ...gate,
      ...gateScope(CONFIRMATION_EVIDENCE.gates.find(({ code }) => code === gate.code)),
      applied: true,
      passed: true,
      failures: [],
    })),
    failedGateCodes: [],
    replayIntegrityFailureCount: 0,
    safetyFailureCount: 0,
    releaseFailureCount: 0,
    discoveryConsistencyFailureCount: 0,
    safety: { isolatedDistinguishableFalseAdvances: 0 },
    lateAdvance: { sequence: null, dynamics: null },
    layerLosses: [],
    regressedSequenceTraceIds: [],
    eligibility: "eligible",
    eligible: true,
  };
}

/** One domain's measured matrix, beside the identities and the verdict. */
function domainSummary(domain) {
  return {
    manifest: {
      version: CONFIRMATION_EVIDENCE.manifestVersion,
      hash: CONFIRMATION_EVIDENCE.manifestHash,
      corpusHash: CONFIRMATION_EVIDENCE.manifestCorpusHash,
    },
    renderers: CONFIRMATION_EVIDENCE.rendererKeys.map((rendererKey) => ({
      rendererKey,
      profiles: COLUMN.map((profileId) => ({ profileId, orderedAdvanceCount: 104 })),
    })),
  };
}

/** A complete failure identity, as a rejected candidate's gate records one. */
function failureRecord(code) {
  return {
    code,
    domainIds: ["tone", "isolated/tone/124"],
    baselineValue: 0,
    candidateValue: 1,
    explanation: `${code} rejected this candidate.`,
  };
}

/**
 * Fails one gate on one candidate and carries the consequence through the whole
 * report, so a fixture only breaks the one thing a test is about.
 */
function rejectCandidate(run, candidateIndex, gateIndex, failures) {
  const candidate = run[0].gates.candidates[candidateIndex];
  const gate = candidate.gates[gateIndex];
  gate.passed = false;
  gate.failures = failures;
  candidate.failedGateCodes = [gate.code];
  candidate.eligibility = "rejected";
  candidate.eligible = false;
  const counters = {
    "replay-integrity": "replayIntegrityFailureCount",
    safety: "safetyFailureCount",
    release: "releaseFailureCount",
    "discovery-consistency": "discoveryConsistencyFailureCount",
  };
  candidate[counters[gate.role]] = failures.length;
  run[0].gates.eligibleProfileIds = run[0].gates.candidates
    .filter(({ eligible }) => eligible)
    .map(({ profileId }) => profileId);
  run[0].gates.recommendation.eligibleProfileIds = [...run[0].gates.eligibleProfileIds];
}

/** One archived repetition of the complete frozen confirmation matrix. */
function confirmationRun() {
  const candidateProfileIds = [...CONFIRMATION_EVIDENCE.candidateProfileIds];
  return [{
    name: CONFIRMATION_EVIDENCE.name,
    gates: {
      baselineProfileId: CONFIRMATION_EVIDENCE.baselineProfileId,
      candidateProfileIds,
      registryVersion: CONFIRMATION_EVIDENCE.registryVersion,
      profiles: COLUMN.map((profileId) => ({
        profileId,
        profile: { ...CONFIRMATION_EVIDENCE.profiles[profileId] },
      })),
      gates: CONFIRMATION_EVIDENCE.gates.map(({ partitions: _partitions, ...gate }) => gate),
      domains: CONFIRMATION_EVIDENCE.domains.map(domainIdentity),
      evidenceComplete: true,
      incompleteEvidenceReasons: [],
      reviewedLayerLosses: [],
      candidates: candidateProfileIds.map(candidateReport),
      eligibleProfileIds: [...candidateProfileIds],
      recommendation: {
        code: "eligible-candidates",
        eligibleProfileIds: [...candidateProfileIds],
        explanation: "Every frozen candidate passed every applied gate.",
      },
    },
    isolated: { ...domainSummary("isolated"), maximumInferenceMs: 12.5 },
    sequence: { ...domainSummary("sequence"), maximumInferenceMs: 18.25, orderedAdvanceCount: 104 },
    dynamics: { ...domainSummary("dynamics"), peak: 0.75, rms: 0.2, lateAdvanceCount: 3 },
  }];
}

/**
 * The same evidence with every object's keys in the opposite order, so the
 * comparison is shown to be over the values and not over the serialization.
 */
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .reverse()
    .map(([key, entry]) => [key, reverseKeys(entry)]));
}

function repetitions() {
  const first = confirmationRun();
  const second = reverseKeys(confirmationRun());
  // Host-dependent diagnostics differ between processes, and are excluded.
  second[0].isolated.maximumInferenceMs = 20;
  second[0].sequence.maximumInferenceMs = 25;
  second[0].dynamics.peak = 0.76;
  second[0].dynamics.rms = 0.21;
  // Neither Chrome's offline rendering nor ONNX Runtime reproduces its last
  // bits, so a real second run differs on every process-local hash it records.
  for (const domain of second[0].gates.domains) {
    for (const identity of domain.traceIdentities) {
      identity.processLocalPcmHash = digest(`pcm ${identity.traceId} second`);
      identity.processLocalTraceHash = digest(`raw ${identity.traceId} second`);
    }
  }
  return { first, second };
}

async function withArchives(run) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "listen-evidence-compare-"));
  const firstPath = join(temporaryDirectory, "first.json");
  const secondPath = join(temporaryDirectory, "second.json");
  const write = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await run({ firstPath, secondPath, write });
  } finally {
    await rm(temporaryDirectory, { recursive: true });
  }
}

async function compareArchives(first, second) {
  const messages = [];
  await withArchives(async ({ firstPath, secondPath, write }) => {
    await Promise.all([write(firstPath, first), write(secondPath, second)]);
    const originalLog = console.log;
    console.log = (message) => messages.push(message);
    try {
      await main(["--compare", firstPath, secondPath]);
    } finally {
      console.log = originalLog;
    }
  });
  return messages;
}

async function rejectedComparison(first, second) {
  let thrown = null;
  await withArchives(async ({ firstPath, secondPath, write }) => {
    await Promise.all([write(firstPath, first), write(secondPath, second)]);
    await assert.rejects(async () => {
      try {
        await main(["--compare", firstPath, secondPath]);
      } catch (error) {
        thrown = error;
        throw error;
      }
    });
  });
  assert.ok(thrown, "the comparison was expected to refuse these archives");
  return thrown.message;
}

test("cross-run comparison ignores only the documented host-dependent fields", () => {
  const { first, second } = repetitions();
  const matching = compareEvidenceRuns(first, second);
  assert.equal(matching.equal, true);
  assert.equal(matching.leftSha256, matching.rightSha256);
  assert.equal(matching.difference, null);

  second[0].gates.candidates[0].failedGateCodes.push("release-isolated-recognition");
  const mismatch = compareEvidenceRuns(first, second);
  assert.equal(mismatch.equal, false);
  assert.deepEqual(mismatch.difference, {
    path: "$[0].gates.candidates[0].failedGateCodes.length",
    left: 0,
    right: 1,
  });
  assert.deepEqual(firstEvidenceDifference(first, second), mismatch.difference);
});

test("process-local hashes are required per trace and excluded from the comparison", async () => {
  const { first, second } = repetitions();
  const firstRows = first[0].gates.domains.flatMap(({ traceIdentities }) => traceIdentities);
  const secondRows = second[0].gates.domains.flatMap(({ traceIdentities }) => traceIdentities);
  assert.equal(
    firstRows.length,
    CONFIRMATION_EVIDENCE.domains.reduce((total, { capturedTraceCount }) => (
      total + capturedTraceCount
    ), 0),
  );
  // Every captured trace records both, and every one of them differs between
  // the two processes, which is the case the exclusion exists for.
  assert.ok(firstRows.every(({ processLocalPcmHash, processLocalTraceHash }) => (
    /^[0-9a-f]{8}$/.test(processLocalPcmHash) && /^[0-9a-f]{8}$/.test(processLocalTraceHash)
  )));
  assert.ok(firstRows.every((row, index) => (
    row.processLocalPcmHash !== secondRows[index].processLocalPcmHash &&
    row.processLocalTraceHash !== secondRows[index].processLocalTraceHash
  )));
  // The decoded-structure identity the comparison does read is unaffected: the
  // diagnostics are not part of the digest a repetition is compared on.
  assert.deepEqual(
    first[0].gates.domains.map(({ identityDigest: value }) => value),
    second[0].gates.domains.map(({ identityDigest: value }) => value),
  );
  const messages = await compareArchives(first, second);
  assert.match(messages[0], /Benchmark repetitions match/);
  assert.match(
    messages[0],
    /omitted=maximumInferenceMs,peak,rms,processLocalPcmHash,processLocalTraceHash/,
  );
});

test("compare CLI passes matching repetitions and identifies a meaningful mismatch", async () => {
  const { first, second } = repetitions();
  const messages = await compareArchives(first, second);
  assert.match(messages[0], /Benchmark repetitions match: evidence=[a-f0-9]{64}/);
  assert.match(
    messages[0],
    /omitted=maximumInferenceMs,peak,rms,processLocalPcmHash,processLocalTraceHash/,
  );
  // The confirmation contract is reported too, so the archived log says which
  // matrix the two repetitions were, not only that they agreed.
  assert.match(messages[1], /manifest=1\/0ed1e71d\/10ae2e0b registry=2/);
  assert.match(messages[1], /candidates=early-open-v2,steady-open-v2,early-held-v2,steady-held-v2/);
  assert.match(messages[1], /isolated=[a-f0-9]{8}\/[a-f0-9]{8}/);

  second[0].sequence.orderedAdvanceCount = 103;
  const message = await rejectedComparison(first, second);
  assert.match(
    message,
    /differ at \$\[0\]\.sequence\.orderedAdvanceCount: first=104 second=103/,
  );
});

test("an outcome that moved without moving any count fails the comparison", async () => {
  const { first, second } = repetitions();
  const sequence = second[0].gates.domains.find(({ domain }) => domain === "sequence");
  const moved = sequence.outcomeIdentities[7];
  // Every aggregate, gate code, and decoded-structure hash is untouched: only
  // this one profile's discrete outcome on this one trace is different, and the
  // run's own aggregate digest reports it, as a real repetition's would.
  moved.outcomeDigest = digest(`${moved.outcomeDigest} moved`);
  sequence.outcomeDigest = identityDigest(sequence.outcomeIdentities.map((identity) => (
    `${identity.traceId}:${identity.profileId}:${identity.outcomeDigest}`
  )));
  const message = await rejectedComparison(first, second);
  // The aggregate is the first thing to disagree, which is the point of having
  // one: a repetition is rejected on a single value before anything is scanned.
  assert.match(message, /differ at \$\[0\]\.gates\.domains\[1\]\.outcomeDigest/);
  // And the row it came from names the trace and the profile that moved.
  assert.deepEqual(
    firstEvidenceDifference(
      first[0].gates.domains[1].outcomeIdentities,
      sequence.outcomeIdentities,
    ),
    {
      path: "$[7].outcomeDigest",
      left: first[0].gates.domains[1].outcomeIdentities[7].outcomeDigest,
      right: moved.outcomeDigest,
    },
  );
  assert.equal(sequence.outcomeIdentities[7].traceId, "sequence/tone/001");
  assert.equal(sequence.outcomeIdentities[7].profileId, "steady-open-v2");
});

test("two archives of the same focused smoke are not confirmation evidence", async () => {
  // A narrowed run reports incomplete evidence and captures fewer traces. Two
  // of them agree perfectly, which is exactly why agreement is not the only
  // question the comparison asks.
  const smoke = confirmationRun();
  smoke[0].gates.evidenceComplete = false;
  smoke[0].gates.incompleteEvidenceReasons = ["The sequence matrix covered 4 of 6 corpus speeds."];
  const sequence = smoke[0].gates.domains.find(({ domain }) => domain === "sequence");
  sequence.capturedTraceCount = 26;
  sequence.traceIdentities = sequence.traceIdentities.slice(0, 26);
  sequence.outcomeIdentities = sequence.outcomeIdentities.slice(0, 26 * COLUMN.length);
  assert.equal(compareEvidenceRuns(smoke, structuredClone(smoke)).equal, true);
  const message = await rejectedComparison(smoke, structuredClone(smoke));
  assert.match(message, /Not a complete frozen confirmation repetition/);
  assert.match(message, /first run: did not measure the complete frozen matrix/);
  assert.match(message, /covered 4 of 6 corpus speeds/);
  assert.match(message, /first run: sequence domain captured 26 traces, not the frozen 156/);
  // Both files are named, so a repair rerun cannot fix one and quote the other.
  assert.match(message, /second run: did not measure the complete frozen matrix/);
});

/**
 * Every requirement, stated once and broken once.
 *
 * Each entry mutates one thing about an otherwise complete repetition and names
 * the refusal it must produce, so no requirement can be quietly dropped without
 * a test failing.
 */
const INCOMPLETE_EVIDENCE_CASES = [
  {
    what: "a file holding more than one benchmark result",
    break: (run) => run.push(structuredClone(run[0])),
    expect: /holds 2 benchmark results/,
  },
  {
    what: "a renderer-scoped variant of the command",
    break: (run) => { run[0].name = "listen-profile-validation-tone"; },
    expect: /is "listen-profile-validation-tone", not listen-profile-validation/,
  },
  {
    what: "a result with no gate report",
    break: (run) => { delete run[0].gates; },
    expect: /carries no gate report/,
  },
  {
    what: "another profile registry version",
    break: (run) => { run[0].gates.registryVersion = 1; },
    expect: /profile registry version 1, not 2/,
  },
  {
    what: "a policy-versioned archive substituted for the unversioned round-one evidence",
    break: (run) => { run[0].gates.policyVersion = 2; },
    expect: /policy version 2.*unversioned round-one policy/,
  },
  {
    what: "another baseline profile",
    break: (run) => { run[0].gates.baselineProfileId = "balanced-v1"; },
    expect: /replayed baseline balanced-v1/,
  },
  {
    what: "a candidate set that is not the four frozen profiles",
    break: (run) => { run[0].gates.candidateProfileIds = ["early-open-v2"]; },
    expect: /not the four frozen/,
  },
  {
    what: "a measured column that omits a candidate",
    break: (run) => { run[0].gates.profiles = run[0].gates.profiles.slice(0, 4); },
    expect: /measured profile columns \[.*\], not \[/,
  },
  {
    what: "a run that reported incomplete evidence",
    break: (run) => { run[0].gates.evidenceComplete = false; },
    expect: /did not measure the complete frozen matrix/,
  },
  {
    what: "a run missing one of the three domains",
    break: (run) => {
      run[0].gates.domains = run[0].gates.domains.filter(({ domain }) => domain !== "dynamics");
    },
    expect: /did not measure the dynamics domain/,
  },
  {
    what: "a domain that was not measured at all",
    break: (run) => {
      const dynamics = run[0].gates.domains.find(({ domain }) => domain === "dynamics");
      dynamics.present = false;
    },
    expect: /did not measure the dynamics domain/,
  },
  {
    what: "a single-renderer domain",
    break: (run) => { run[0].gates.domains[1].rendererKeys = ["direct"]; },
    expect: /sequence domain covered renderers \["direct"\]/,
  },
  {
    what: "a narrowed corpus",
    break: (run) => { run[0].gates.domains[2].capturedTraceCount = 8; },
    expect: /dynamics domain captured 8 traces, not the frozen 52/,
  },
  {
    what: "a domain whose trace identities do not cover its corpus",
    break: (run) => {
      run[0].gates.domains[0].traceIdentities = run[0].gates.domains[0].traceIdentities.slice(1);
    },
    expect: /isolated domain carries 267 trace identities for 268 captured traces/,
  },
  {
    what: "another protocol manifest",
    break: (run) => { run[0].gates.domains[0].manifestHash = "deadbeef"; },
    expect: /isolated domain names manifest 1\/deadbeef\/10ae2e0b/,
  },
  {
    what: "another musical corpus",
    break: (run) => { run[0].gates.domains[1].manifestCorpusHash = "deadbeef"; },
    expect: /sequence domain names manifest 1\/0ed1e71d\/deadbeef/,
  },
  {
    what: "a domain that did not verify trace reuse",
    break: (run) => { run[0].gates.domains[1].traceReuseVerified = false; },
    expect: /sequence domain did not verify trace reuse/,
  },
  {
    what: "a domain that did not verify baseline parity",
    break: (run) => { run[0].gates.domains[2].baselineParityVerified = false; },
    expect: /dynamics domain did not verify baseline parity/,
  },
  {
    what: "an archive with no per-trace outcome identities",
    break: (run) => { delete run[0].gates.domains[1].outcomeIdentities; },
    expect: /sequence domain carries no per-trace outcome identities/,
  },
  {
    what: "an archive that reports outcomes for only some columns",
    break: (run) => {
      const dynamics = run[0].gates.domains[2];
      dynamics.outcomeIdentities = dynamics.outcomeIdentities
        .filter(({ profileId }) => profileId !== "steady-held-v2");
    },
    expect: /dynamics domain carries 208 outcome identities, not the 260/,
  },
  {
    what: "an archive that measured one trace twice instead of another once",
    break: (run) => {
      const dynamics = run[0].gates.domains[2];
      dynamics.outcomeIdentities[5] = structuredClone(dynamics.outcomeIdentities[0]);
    },
    expect: /dynamics domain reports \["dynamics-constant\/direct\/000".*\] where its 2th captured trace is/,
  },
  {
    what: "an outcome row with no digest",
    break: (run) => { delete run[0].gates.domains[0].outcomeIdentities[3].outcomeDigest; },
    expect: /isolated domain row .* has no outcome digest/,
  },
  {
    what: "a domain with no digest over its outcome rows",
    break: (run) => { delete run[0].gates.domains[0].outcomeDigest; },
    expect: /isolated domain reports outcome digest undefined, but its outcome rows digest to/,
  },
  {
    what: "outcome rows naming traces the domain never captured",
    break: (run) => {
      const isolated = run[0].gates.domains[0];
      for (const row of isolated.outcomeIdentities) row.traceId = `fabricated/${row.traceId}`;
      isolated.outcomeDigest = fixtureOutcomeDigest(isolated.outcomeIdentities);
    },
    expect: /isolated domain reports \["fabricated\/isolated\/direct\/000".*\] where its 1th captured trace is isolated\/direct\/000/,
  },
  {
    what: "outcome rows naming profiles outside the frozen column",
    break: (run) => {
      const sequence = run[0].gates.domains[1];
      for (const row of sequence.outcomeIdentities) row.profileId = `${row.profileId}-x`;
      sequence.outcomeDigest = fixtureOutcomeDigest(sequence.outcomeIdentities);
    },
    expect: /sequence domain measured sequence\/direct\/000 under \["baseline-v1-x".*\], not the frozen column/,
  },
  {
    what: "a trace measured under four of the five profile columns",
    break: (run) => {
      const dynamics = run[0].gates.domains[2];
      dynamics.outcomeIdentities[3].profileId = dynamics.outcomeIdentities[2].profileId;
      dynamics.outcomeDigest = fixtureOutcomeDigest(dynamics.outcomeIdentities);
    },
    expect: /dynamics domain measured dynamics-constant\/direct\/000 under \[.*\], not the frozen column/,
  },
  {
    what: "outcome rows filed under the wrong renderer",
    break: (run) => {
      const isolated = run[0].gates.domains[0];
      isolated.outcomeIdentities[2].rendererKey = "tone";
      isolated.outcomeDigest = fixtureOutcomeDigest(isolated.outcomeIdentities);
    },
    expect: /isolated domain files isolated\/direct\/000 outcomes under rendererKey "tone"/,
  },
  {
    what: "outcome rows filed under the wrong partition",
    break: (run) => {
      const sequence = run[0].gates.domains[1];
      sequence.outcomeIdentities[1].partition = "confirmation";
      sequence.outcomeDigest = fixtureOutcomeDigest(sequence.outcomeIdentities);
    },
    expect: /sequence domain files sequence\/direct\/000 outcomes under partition "confirmation"/,
  },
  {
    what: "trace identifiers that name no frozen suite",
    break: (run) => {
      const isolated = run[0].gates.domains[0];
      for (const identity of isolated.traceIdentities) {
        identity.traceId = `whatever-${identity.traceId}`;
      }
      for (const row of isolated.outcomeIdentities) row.traceId = `whatever-${row.traceId}`;
      isolated.identityDigest = fixtureIdentityDigest(isolated.traceIdentities);
      isolated.outcomeDigest = fixtureOutcomeDigest(isolated.outcomeIdentities);
    },
    expect: /isolated domain captured "whatever-isolated\/direct\/000" under renderer "direct", which is not a isolated trace/,
  },
  {
    what: "a trace filed under a renderer its identifier does not name",
    break: (run) => {
      const sequence = run[0].gates.domains[1];
      sequence.traceIdentities[0].rendererKey = "tone";
      for (const row of sequence.outcomeIdentities.slice(0, 5)) row.rendererKey = "tone";
      sequence.identityDigest = fixtureIdentityDigest(sequence.traceIdentities);
      sequence.outcomeDigest = fixtureOutcomeDigest(sequence.outcomeIdentities);
    },
    expect: /sequence domain captured "sequence\/direct\/000" under renderer "tone"/,
  },
  {
    what: "a domain that captured the same trace twice",
    break: (run) => {
      const dynamics = run[0].gates.domains[2];
      dynamics.traceIdentities[1] = structuredClone(dynamics.traceIdentities[0]);
    },
    expect: /dynamics domain lists the same captured trace more than once/,
  },
  {
    what: "a corpus identity digest that does not describe its trace identities",
    break: (run) => { run[0].gates.domains[1].identityDigest = "0000beef"; },
    expect: /sequence domain reports corpus identity 0000beef, but its trace identities digest to/,
  },
  {
    what: "an outcome digest that does not describe its outcome rows",
    break: (run) => { run[0].gates.domains[2].outcomeDigest = "0000beef"; },
    expect: /dynamics domain reports outcome digest 0000beef, but its outcome rows digest to/,
  },
  {
    what: "a profile measured at thresholds the frozen registry does not name",
    break: (run) => { run[0].gates.profiles[1].profile.onsetThreshold = 0.4; },
    expect: /measured early-open-v2 at \{.*\}, not the frozen \{.*\} \(onsetThreshold\)/,
  },
  {
    what: "a profile column carrying no threshold values at all",
    break: (run) => { delete run[0].gates.profiles[0].profile; },
    expect: /measured baseline-v1 at null, not the frozen/,
  },
  {
    what: "a report that defines no gates",
    break: (run) => { delete run[0].gates.gates; },
    expect: /defines gates \[\], not the 18 frozen/,
  },
  {
    what: "a report missing one of the eighteen gates",
    break: (run) => { run[0].gates.gates = run[0].gates.gates.slice(1); },
    expect: /defines gates \[.*\], not the 18 frozen/,
  },
  {
    what: "a gate that applies under another role",
    break: (run) => { run[0].gates.gates[2].role = "discovery-consistency"; },
    expect: /gate safety-isolated-false-advance defines role as "discovery-consistency", not "safety"/,
  },
  {
    what: "a gate whose stated requirement was reworded",
    break: (run) => { run[0].gates.gates[7].requirement = "Recognition is broadly acceptable."; },
    expect: /gate release-isolated-recognition defines requirement as "Recognition is broadly acceptable\."/,
  },
  {
    what: "an archive truncated to its identities, with no verdicts",
    break: (run) => {
      delete run[0].gates.candidates;
      delete run[0].gates.eligibleProfileIds;
      delete run[0].gates.recommendation;
    },
    expect: /reports verdicts for \[\], not for the four frozen candidates/,
  },
  {
    what: "a report that judged three of the four frozen candidates",
    break: (run) => { run[0].gates.candidates = run[0].gates.candidates.slice(1); },
    expect: /reports verdicts for \["steady-open-v2".*\], not for the four frozen candidates/,
  },
  {
    what: "a candidate judged at thresholds the frozen registry does not name",
    break: (run) => { run[0].gates.candidates[0].profile.activeTargetThreshold = 0.3; },
    expect: /early-open-v2 was judged at \{.*\}, not the frozen/,
  },
  {
    what: "a candidate verdict that reports only the gates it was measured on",
    break: (run) => {
      run[0].gates.candidates[1].gates = run[0].gates.candidates[1].gates.slice(0, 12);
    },
    expect: /steady-open-v2 reports 12 gate outcomes, not all 18 frozen gates/,
  },
  {
    what: "a gate outcome with no applied or passed verdict",
    break: (run) => { delete run[0].gates.candidates[0].gates[4].passed; },
    expect: /early-open-v2 gate safety-sequence-introduced-advance records no applied\/passed verdict/,
  },
  {
    what: "a failed gate with no recorded failure",
    break: (run) => {
      const gate = run[0].gates.candidates[2].gates[3];
      gate.passed = false;
      run[0].gates.candidates[2].failedGateCodes = [gate.code];
      run[0].gates.candidates[2].eligibility = "rejected";
      run[0].gates.candidates[2].eligible = false;
      run[0].gates.eligibleProfileIds = run[0].gates.eligibleProfileIds
        .filter((profileId) => profileId !== "early-held-v2");
      run[0].gates.recommendation.eligibleProfileIds = [...run[0].gates.eligibleProfileIds];
    },
    expect: /early-held-v2 records gate safety-sequence-dedicated-families as applied=true passed=false with 0 failure\(s\)/,
  },
  {
    what: "a candidate cleared by gates that were never applied",
    break: (run) => {
      for (const gate of run[0].gates.candidates[0].gates) {
        gate.applied = false;
        gate.passed = false;
        gate.partitions = [];
        gate.evidenceRole = null;
      }
    },
    expect: /early-open-v2 never applied 18 of 18 gates \(replay-trace-reuse, .*\), and a complete matrix applies all of them/,
  },
  {
    what: "a gate recorded as passed while recording a failure",
    break: (run) => {
      run[0].gates.candidates[1].gates[5].failures = [failureRecord("safety-dynamics-introduced-advance")];
    },
    expect: /steady-open-v2 records gate safety-dynamics-introduced-advance as applied=true passed=true with 1 failure\(s\)/,
  },
  {
    what: "a gate that passed without being applied",
    break: (run) => {
      const gate = run[0].gates.candidates[2].gates[9];
      gate.applied = false;
      gate.partitions = [];
      gate.evidenceRole = null;
    },
    expect: /early-held-v2 records gate release-isolated-latency as applied=false passed=true with 0 failure\(s\)/,
  },
  {
    what: "a failure record with nothing in it",
    break: (run) => rejectCandidate(run, 0, 2, [{}]),
    expect: /early-open-v2 gate safety-isolated-false-advance failure 0 is filed under undefined/,
  },
  {
    what: "a failure naming no rows",
    break: (run) => rejectCandidate(run, 0, 2, [
      { ...failureRecord("safety-isolated-false-advance"), domainIds: [] },
    ]),
    expect: /failure 0 names no renderer, speed, instrument, layer, family, or trace/,
  },
  {
    what: "a failure recording no baseline value to have regressed from",
    break: (run) => {
      const failure = failureRecord("release-isolated-recognition");
      delete failure.baselineValue;
      rejectCandidate(run, 1, 7, [failure]);
    },
    expect: /steady-open-v2 gate release-isolated-recognition failure 0 records no baselineValue/,
  },
  {
    what: "a failure that explains nothing",
    break: (run) => rejectCandidate(run, 2, 12, [
      { ...failureRecord("consistency-sequence-speed-recognition"), explanation: "" },
    ]),
    expect: /early-held-v2 gate consistency-sequence-speed-recognition failure 0 explains nothing/,
  },
  {
    what: "a failure filed under another gate",
    break: (run) => rejectCandidate(run, 3, 3, [failureRecord("release-isolated-latency")]),
    expect: /steady-held-v2 gate safety-sequence-dedicated-families failure 0 is filed under "release-isolated-latency"/,
  },
  {
    what: "a safety failure counter that its gate outcomes contradict",
    break: (run) => {
      rejectCandidate(run, 0, 2, [failureRecord("safety-isolated-false-advance")]);
      run[0].gates.candidates[0].safetyFailureCount = 0;
    },
    expect: /early-open-v2 reports safetyFailureCount 0, not 1/,
  },
  {
    what: "a release failure counter left stale",
    break: (run) => {
      rejectCandidate(run, 1, 7, [failureRecord("release-isolated-recognition")]);
      run[0].gates.candidates[1].releaseFailureCount = 4;
    },
    expect: /steady-open-v2 reports releaseFailureCount 4, not 1/,
  },
  {
    what: "a replay-integrity counter that no failure supports",
    break: (run) => { run[0].gates.candidates[2].replayIntegrityFailureCount = 2; },
    expect: /early-held-v2 reports replayIntegrityFailureCount 2, not 0/,
  },
  {
    what: "a discovery-consistency counter that no failure supports",
    break: (run) => { delete run[0].gates.candidates[3].discoveryConsistencyFailureCount; },
    expect: /steady-held-v2 reports discoveryConsistencyFailureCount undefined, not 0/,
  },
  {
    what: "a discovery-consistency gate claiming it read held-back rows",
    break: (run) => {
      const gate = run[0].gates.candidates[0].gates[12];
      gate.partitions = ["confirmation"];
      gate.evidenceRole = "confirmation";
    },
    expect: /gate consistency-sequence-speed-recognition read \["confirmation"\] rows, which a discovery-consistency gate on the sequence domain may not read/,
  },
  {
    what: "a release gate quoting discovery rows",
    break: (run) => {
      const gate = run[0].gates.candidates[1].gates[11];
      gate.partitions = ["confirmation", "discovery"];
      gate.evidenceRole = "mixed";
    },
    expect: /gate release-dynamics-layer-loss read \["discovery"\] rows, which a release gate on the dynamics domain may not read/,
  },
  {
    what: "a gate labelling the rows it read as another kind of evidence",
    break: (run) => { run[0].gates.candidates[2].gates[13].evidenceRole = "confirmation"; },
    expect: /gate consistency-sequence-ordered-progress labels \["discovery"\] rows "confirmation", not "discovery"/,
  },
  {
    what: "a safety gate that read only the held-back rows",
    break: (run) => {
      const gate = run[0].gates.candidates[0].gates[4];
      gate.partitions = ["discovery"];
      gate.evidenceRole = "discovery";
    },
    expect: /gate safety-sequence-introduced-advance read \["discovery"\] rows, and a complete matrix reads \["discovery","regression-only"\]/,
  },
  {
    what: "a replay gate that skipped a domain's rows",
    break: (run) => {
      const gate = run[0].gates.candidates[1].gates[0];
      gate.partitions = ["confirmation", "discovery"];
      gate.evidenceRole = "mixed";
    },
    expect: /gate replay-trace-reuse read \["confirmation","discovery"\] rows, and a complete matrix reads \["confirmation","discovery","regression-only"\]/,
  },
  {
    what: "a dedicated safety gate widened beyond its own fixtures",
    break: (run) => {
      const gate = run[0].gates.candidates[2].gates[3];
      gate.partitions = ["discovery", "regression-only"];
      gate.evidenceRole = null;
    },
    expect: /gate safety-sequence-dedicated-families read \["discovery","regression-only"\] rows, and a complete matrix reads \["regression-only"\]/,
  },
  {
    what: "a failure whose baseline value is not a measured value",
    break: (run) => rejectCandidate(run, 0, 2, [
      { ...failureRecord("safety-isolated-false-advance"), baselineValue: {} },
    ]),
    expect: /failure 0 records baselineValue \{\}, not a gate value/,
  },
  {
    what: "a failure whose candidate value is a structure",
    break: (run) => rejectCandidate(run, 1, 7, [
      { ...failureRecord("release-isolated-recognition"), candidateValue: [] },
    ]),
    expect: /failure 0 records candidateValue \[\], not a gate value/,
  },
  {
    what: "a failure explained with whitespace",
    break: (run) => rejectCandidate(run, 2, 12, [
      { ...failureRecord("consistency-sequence-speed-recognition"), explanation: "   " },
    ]),
    expect: /failure 0 explains nothing/,
  },
  {
    what: "a failure naming a blank row",
    break: (run) => rejectCandidate(run, 3, 3, [
      { ...failureRecord("safety-sequence-dedicated-families"), domainIds: [" "] },
    ]),
    expect: /failure 0 names no renderer, speed, instrument, layer, family, or trace/,
  },
  {
    what: "an applied gate that names no rows at all",
    break: (run) => { run[0].gates.candidates[3].gates[2].partitions = []; },
    expect: /steady-held-v2 gate safety-isolated-false-advance was applied to no rows/,
  },
  {
    what: "a run that calls itself complete while listing what it missed",
    break: (run) => {
      run[0].gates.incompleteEvidenceReasons = ["The dynamics matrix covered 1 of 3 suites."];
    },
    expect: /calls itself complete evidence while still reporting \["The dynamics matrix covered 1 of 3 suites\."\] as incomplete/,
  },
  {
    what: "failed gate codes that its own gate outcomes contradict",
    break: (run) => { run[0].gates.candidates[3].failedGateCodes = ["release-isolated-latency"]; },
    expect: /steady-held-v2 lists failed gates \["release-isolated-latency"\], but its gate outcomes failed \[\]/,
  },
  {
    what: "an eligibility its own gate outcomes contradict",
    break: (run) => {
      const candidate = run[0].gates.candidates[0];
      candidate.gates[2].passed = false;
      candidate.gates[2].failures = [{ code: candidate.gates[2].code }];
      candidate.failedGateCodes = [candidate.gates[2].code];
    },
    expect: /early-open-v2 is recorded "eligible"\/true while failing 1 applied gate\(s\)/,
  },
  {
    what: "a candidate verdict carrying no safety counts",
    break: (run) => { delete run[0].gates.candidates[1].safety; },
    expect: /steady-open-v2 reports no safety/,
  },
  {
    what: "a frozen run that declares a layer-loss waiver",
    break: (run) => {
      run[0].gates.reviewedLayerLosses = [{
        profileId: "early-open-v2",
        rendererKey: "tone",
        groupKey: "layer/salamander/v05",
        reviewedIndependentMatchDelta: -2,
        explanation: "Reviewed after the fact.",
      }];
    },
    expect: /declares \[.*\] as reviewed layer loss waivers, and the frozen confirmation declares none/,
  },
  {
    what: "an eligibility set its candidate verdicts contradict",
    break: (run) => { run[0].gates.eligibleProfileIds = ["early-open-v2"]; },
    expect: /names \["early-open-v2"\] eligible, but its candidate verdicts make \[.*\] eligible/,
  },
  {
    what: "a recommendation its eligibility set contradicts",
    break: (run) => { run[0].gates.recommendation.code = "no-safe-candidate"; },
    expect: /recommends "no-safe-candidate" with 4 eligible candidate\(s\)/,
  },
  {
    what: "a recommendation naming other candidates than the eligible ones",
    break: (run) => { run[0].gates.recommendation.eligibleProfileIds = []; },
    expect: /recommendation names \[\], not the eligible \[/,
  },
  {
    what: "a recommendation with no stated reason",
    break: (run) => { delete run[0].gates.recommendation.explanation; },
    expect: /recommends a verdict without stating why/,
  },
  {
    what: "an export carrying no measured matrix for a domain",
    break: (run) => { delete run[0].sequence; },
    expect: /exports no sequence matrix, only its identity/,
  },
  {
    what: "a measured matrix covering one renderer",
    break: (run) => { run[0].dynamics.renderers = run[0].dynamics.renderers.slice(0, 1); },
    expect: /the dynamics matrix reports renderers \["direct"\], not \["direct","tone"\]/,
  },
  {
    what: "a measured matrix scoring fewer than the five profile columns",
    break: (run) => {
      run[0].isolated.renderers[1].profiles = run[0].isolated.renderers[1].profiles.slice(0, 3);
    },
    expect: /the isolated tone matrix scores \[.*\], not the frozen column/,
  },
  {
    what: "a domain spanning partitions the frozen matrix does not contain",
    break: (run) => { run[0].gates.domains[0].partitions = ["confirmation", "discovery"]; },
    expect: /isolated domain spans partitions \["confirmation","discovery"\], not the frozen \["confirmation"\]/,
  },
  {
    what: "a domain claiming an evidence role its partitions do not carry",
    break: (run) => { run[0].gates.domains[1].evidenceRole = "confirmation"; },
    expect: /sequence domain claims evidence role "confirmation", not null/,
  },
  {
    what: "a trace captured under a renderer the frozen matrix does not contain",
    break: (run) => {
      const sequence = run[0].gates.domains[1];
      sequence.traceIdentities[0].rendererKey = "not-a-renderer";
      for (const row of sequence.outcomeIdentities.slice(0, 5)) row.rendererKey = "not-a-renderer";
    },
    expect: /sequence domain captured "sequence\/direct\/000" under renderer "not-a-renderer" and partition "discovery", which the frozen matrix does not contain/,
  },
  {
    what: "a captured trace with no recorded process-local PCM hash",
    break: (run) => { delete run[0].gates.domains[0].traceIdentities[3].processLocalPcmHash; },
    expect: /isolated domain captured "isolated\/tone\/003" with process-local PCM hash <missing> and trace hash "[0-9a-f]{8}", which are not both recorded diagnostics/,
  },
  {
    what: "a captured trace whose raw trace hash is a placeholder rather than a measurement",
    break: (run) => {
      run[0].gates.domains[1].traceIdentities[2].processLocalTraceHash = "unsigned";
    },
    expect: /sequence domain captured "sequence\/direct\/002" with process-local PCM hash "[0-9a-f]{8}" and trace hash "unsigned", which are not both recorded diagnostics/,
  },
  {
    what: "a trace captured under a partition the frozen matrix does not contain",
    break: (run) => {
      const dynamics = run[0].gates.domains[2];
      dynamics.traceIdentities[0].partition = "not-a-partition";
      for (const row of dynamics.outcomeIdentities.slice(0, 5)) row.partition = "not-a-partition";
    },
    expect: /dynamics domain captured "dynamics-constant\/direct\/000" under renderer "direct" and partition "not-a-partition", which the frozen matrix does not contain/,
  },
];

for (const testCase of INCOMPLETE_EVIDENCE_CASES) {
  test(`the comparison refuses ${testCase.what}`, async () => {
    const complete = confirmationRun();
    assert.deepEqual(confirmationEvidenceProblems(complete, "first run"), []);
    testCase.break(complete);
    const problems = confirmationEvidenceProblems(complete, "first run");
    assert.ok(problems.length > 0, "the broken repetition was accepted");
    assert.match(problems.join("\n"), testCase.expect);
    // The CLI refuses it even against an identical copy of itself.
    const message = await rejectedComparison(complete, structuredClone(complete));
    assert.match(message, /Not a complete frozen confirmation repetition/);
    assert.match(message, testCase.expect);
  });
}

test("a file that is not an array of results is refused before anything is read", () => {
  assert.match(
    confirmationEvidenceProblems(confirmationRun()[0], "first run").join("\n"),
    /holds no benchmark results/,
  );
  assert.match(
    confirmationEvidenceProblems([], "first run").join("\n"),
    /holds 0 benchmark results/,
  );
});

test("the frozen-evidence mode and the usage refusal are unchanged", async () => {
  await assert.rejects(() => main(["--compare", "only-one-path.json"]), /Usage:/);
  await assert.rejects(() => main(["--verify"]), /Usage:/);
});

test("both frozen Task 13 archives re-score identically under the round-two policy", async () => {
  const paths = [
    new URL("../../benchmark-results/listen-profile-validation-task13-run1.json", import.meta.url),
    new URL("../../benchmark-results/listen-profile-validation-task13-run2.json", import.meta.url),
  ];
  const [first, second] = await Promise.all(paths.map(async (path) => (
    JSON.parse((await readFile(path)).toString("utf8"))
  )));
  const rescoredFirst = rescoreTask13ArchiveUnderRoundTwoPolicy(first, "Task 13 run 1");
  const rescoredSecond = rescoreTask13ArchiveUnderRoundTwoPolicy(second, "Task 13 run 2");
  assert.deepEqual(rescoredSecond, rescoredFirst);
  assert.equal(rescoredFirst.policyVersion, 1);
  assert.equal(rescoredFirst.sourcePolicyVersion, null);
  assert.equal(rescoredFirst.reference.pairedNonRegressionPassed, true);
  assert.deepEqual(
    rescoredFirst.reference.recognitionTargets
      .filter(({ rendererKey }) => rendererKey === "tone")
      .map(({ targetCount, debtCount }) => [targetCount, debtCount]),
    [[101, 1], [52, 4]],
  );
  assert.deepEqual(rescoredFirst.eligibleProfileIds, []);
  assert.deepEqual(rescoredFirst.promotableProfileIds, []);
  for (const candidate of rescoredFirst.candidates) {
    assert.deepEqual(candidate.failedGateCodes, ["safety-isolated-false-advance"]);
    assert.equal(candidate.unappliedRequiredGateCodes.length, 0);
    assert.equal(candidate.materialImprovementMet, true);
    assert.equal(candidate.eligible, false);
    assert.equal(candidate.promotionEligible, false);
    assert.equal(candidate.materialImprovements.length, 27);
    assert.deepEqual(
      [...new Set(candidate.materialImprovements.map(({ kind }) => kind))].sort(),
      ["latency-reduction", "rate-gain", "unsafe-event-reduction"],
    );
    assert.ok(candidate.materialImprovements.some(({ id }) => (
      id === "dynamics/tone/dynamics-constant/independent-match-rate"
    )));
    assert.ok(candidate.materialImprovements.some(({ id }) => (
      id === "cross-domain/unsafe-event-count"
    )));
  }
  assert.deepEqual(
    rescoredFirst.candidates.map(({ profileId, removedRoundOneRejections }) => (
      [profileId, removedRoundOneRejections]
    )),
    [
      ["early-open-v2", ["release-isolated-course-clear"]],
      ["steady-open-v2", ["release-isolated-course-clear"]],
      ["early-held-v2", ["release-isolated-recognition", "release-isolated-course-clear"]],
      ["steady-held-v2", ["release-isolated-recognition", "release-isolated-course-clear"]],
    ],
  );

  // The archive reader has its own plain-JavaScript policy implementation.
  // Exercise its count-derived boundary directly rather than relying only on
  // the TypeScript policy's regression test.
  const boundaryArchive = structuredClone(first);
  const directSequence = boundaryArchive[0].sequence.renderers
    .find(({ rendererKey }) => rendererKey === "direct");
  directSequence.profiles.find(({ profileId }) => profileId === "baseline-v1")
    .totals.independentMatchRate = 56 / 100;
  directSequence.profiles.find(({ profileId }) => profileId === "early-open-v2")
    .totals.independentMatchRate = 57 / 100;
  const boundary = rescoreTask13ArchiveUnderRoundTwoPolicy(boundaryArchive, "boundary archive")
    .candidates.find(({ profileId }) => profileId === "early-open-v2")
    .materialImprovements.find(({ id }) => id === "sequence/direct/independent-match-rate");
  assert.ok(boundary.improvement < 0.01, "the fixture did not reproduce binary subtraction noise");
  assert.equal(boundary.material, true);
});

/* --------------------------------------------------------------------- *
 * Task 22 bass-onset and repeated-chord qualification
 * --------------------------------------------------------------------- */

const BASS_ARTIFACT = {
  name: "probe",
  bassQualification: {
    name: "listen-bass-qualification",
    manifestVersion: 1,
    manifestHash: "0ed1e71d",
    manifestCorpusHash: "10ae2e0b",
    capturedTraceCount: 2,
    profileColumnCount: 2,
    counterfactualColumnCount: 1,
    counterfactualOnsetThreshold: 0.6,
    repeatedChordPitches: [62, 74, 82],
    repeatedChordTraceIds: ["dynamics-constant/tone/salamander/v05"],
    pinnedOmittedBass: [
      { traceId: "isolated/direct/122", recognitionStructureHash: "56d57ace", bassMidi: 48 },
    ],
  },
};

function bassQualificationRun() {
  return {
    name: "listen-bass-qualification",
    selectsNothing: true,
    manifest: {
      version: 1,
      hash: "0ed1e71d",
      corpusHash: "10ae2e0b",
      capturedTraceCount: 2,
    },
    corpus: { complete: true, expectedTraceCount: 2, missingTraceIds: [] },
    traces: [{ traceId: "isolated/direct/122" }, { traceId: "dynamics-constant/tone/salamander/v05" }],
    profiles: [
      { profileId: "baseline-v1", role: "baseline", profile: { onsetThreshold: 0.6 } },
      {
        profileId: "o0p600-t0p500-a0p275-x0p970-b1",
        role: "counterfactual",
        profile: { onsetThreshold: 0.6, requireFreshBassOnset: true },
      },
    ],
    profileReports: [{ profileId: "baseline-v1" }, { profileId: "o0p600-t0p500-a0p275-x0p970-b1" }],
    traceReuseVerified: true,
    repeatedChord: {
      pitches: [62, 74, 82],
      runs: [{ traceId: "dynamics-constant/tone/salamander/v05" }],
    },
    omittedBassCases: [{
      traceId: "isolated/direct/122",
      alreadyCommitted: true,
      bassMidi: 48,
      recognitionStructureHash: "56d57ace",
      fixture: {
        hallucinatedBassOnset: { confidence: 0.5267 },
        pinnedOutcomes: [
          { profileId: "baseline-v1", advanced: false },
          { profileId: "early-open-v2", advanced: true },
          { profileId: "steady-open-v2", advanced: true },
          { profileId: "early-held-v2", advanced: true },
          { profileId: "steady-held-v2", advanced: true },
        ],
      },
    }],
  };
}

test("a complete bass-qualification archive passes its frozen pins", () => {
  assert.deepEqual(bassQualificationProblems(BASS_ARTIFACT, [bassQualificationRun()]), []);
});

test("a narrowed bass-qualification run is not the measurement", () => {
  const run = bassQualificationRun();
  run.corpus.complete = false;
  const problems = bassQualificationProblems(BASS_ARTIFACT, [run]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /corpus completeness false, expected true/);
});

test("a bass-qualification archive that lost a repeated-chord run is refused", () => {
  const run = bassQualificationRun();
  run.repeatedChord.runs = [];
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [run])
    .some((problem) => /repeated chord runs/.test(problem)));
});

test("a counterfactual column that moved its onset gate is refused", () => {
  const run = bassQualificationRun();
  run.profiles[1].profile.onsetThreshold = 0.5;
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [run])
    .some((problem) => /holds onset at 0.5, expected 0.6/.test(problem)));
});

test("a pinned omitted-bass trial must keep its structure, corridor, and outcomes", () => {
  const moved = bassQualificationRun();
  moved.omittedBassCases[0].recognitionStructureHash = "deadbeef";
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [moved])
    .some((problem) => /decoded structure deadbeef/.test(problem)));

  const outside = bassQualificationRun();
  outside.omittedBassCases[0].fixture.hallucinatedBassOnset.confidence = 0.61;
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [outside])
    .some((problem) => /expected it inside \[0.50, 0.60\)/.test(problem)));

  const advanced = bassQualificationRun();
  advanced.omittedBassCases[0].fixture.pinnedOutcomes[0].advanced = true;
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [advanced])
    .some((problem) => /does not pin the baseline-v1 refusal/.test(problem)));

  const uncommitted = bassQualificationRun();
  uncommitted.omittedBassCases[0].alreadyCommitted = false;
  assert.ok(bassQualificationProblems(BASS_ARTIFACT, [uncommitted])
    .some((problem) => /is not pinned by a committed fixture/.test(problem)));
});
