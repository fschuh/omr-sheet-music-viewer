import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONFIRMATION_EVIDENCE,
  ROLE_FAILURE_COUNTERS,
  ROUND_TWO_COMMITTED_REGRESSIONS,
  ROUND_TWO_CONFIRMATION_MATRIX,
  ROUND_TWO_DOMAIN_SUMMARY_COUNTERS,
  roundTwoGateDomainMembership,
  roundTwoUnfrozenGateScopes,
  bassQualificationProblems,
  canonicalJsonDigest,
  compareEvidenceRuns,
  confirmationEvidenceProblems,
  firstEvidenceDifference,
  main,
  rescoreTask13ArchiveUnderRoundTwoPolicy,
  roundTwoAblationProblems,
  roundTwoCandidateManifestProblems,
  capturedCorpusIdentity,
  fnv1a32,
  partitionEvidenceRole,
  readRoundTwoConfirmationArchives,
  roundTwoCaptureIdentityRows,
  rederiveRoundTwoEligibilityEntries,
  rederiveRoundTwoGateVerdicts,
  confirmationArchiveEvidenceProblems,
  roundTwoConfirmationArchiveProblems,
  roundTwoConfirmationMatrixProblems,
  roundTwoEligibilityManifestProblems,
  roundTwoSearchArchiveProblems,
  rerunRoundTwoSelection,
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

const TASK27_ARTIFACT = {
  name: "Task 27 round-two candidate manifest",
  path: "benchmark-results/listen-round-two-candidate-manifest-task27.json",
  roundTwoCandidateManifest: {
    name: "listen-round-two-candidate-manifest",
    formatVersion: 1,
    roundId: "round-two",
    candidateProfileIds: [],
    registryVersion: 2,
    registryDigest: "d1b3f6a3",
    policyVersion: 1,
    policyHash: "840b07ec",
    traceManifestVersion: 2,
    traceManifestHash: "d1971fa3",
    traceManifestCorpusHash: "1213016e",
    generatorVersion: 1,
    ablationId: null,
    task26TerminalOutcome: "bass-axis-unsupported",
    task26EvidenceDigest: "8dfe2f1b",
    notRunReason: "no-ablation-accepted",
    digest: "21655efa",
    evidencePaths: [
      "benchmark-results/listen-round-two-ablation-task26-run1.json",
      "benchmark-results/listen-round-two-ablation-task26-run2.json",
    ],
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
  },
};

async function task27Evidence() {
  return Promise.all(TASK27_ARTIFACT.roundTwoCandidateManifest.evidencePaths.map(async (path) => (
    JSON.parse(await readFile(join(import.meta.dirname, "../..", path), "utf8"))
  )));
}

async function task27Manifest() {
  return JSON.parse(await readFile(
    join(import.meta.dirname, "../..", TASK27_ARTIFACT.path),
    "utf8",
  ));
}

test("the committed zero-branch manifest is re-derived from both Task 26 repetitions", async () => {
  const [manifest, evidence] = await Promise.all([task27Manifest(), task27Evidence()]);
  assert.deepEqual(roundTwoCandidateManifestProblems(TASK27_ARTIFACT, manifest, evidence), []);

  // The branch rests on a rerun: every ablation is rejected by the stop rule
  // recomputed from its own archived measurements, in both repetitions.
  for (const run of evidence) {
    const rerun = rerunRoundTwoSelection(run[0], TASK27_ARTIFACT.roundTwoCandidateManifest);
    assert.deepEqual(rerun.ablations.map(({ stop }) => stop.satisfied), [false, false, false]);
    assert.deepEqual(rerun.ablations.map(({ stop }) => stop.reasons), [
      ["selected-set-has-no-material-repeated-recovery"],
      ["selected-set-has-no-material-repeated-recovery"],
      ["selected-set-has-no-material-repeated-recovery"],
    ]);
    assert.equal(rerun.terminalOutcome, "bass-axis-unsupported");
    assert.equal(rerun.notRunReason, "no-ablation-accepted");
    assert.equal(rerun.ablationId, null);
    assert.equal(rerun.evidenceDigest, "8dfe2f1b");
  }
});

test("a manifest that states a result its own evidence does not rerun to is refused", async () => {
  const [manifest, evidence] = await Promise.all([task27Manifest(), task27Evidence()]);

  // A candidate registered under a zero-branch rerun.
  const registered = structuredClone(manifest);
  registered.candidateProfileIds = ["early-open-v2"];
  const registeredProblems = roundTwoCandidateManifestProblems(
    TASK27_ARTIFACT,
    registered,
    evidence,
  );
  assert.ok(registeredProblems.some((problem) => problem.includes("the candidate list changed")));
  assert.ok(registeredProblems.some((problem) => problem.includes("may register no candidate")));

  // The digest is recomputed from the record, so a field cannot move under it.
  const moved = structuredClone(manifest);
  moved.task26EvidenceDigest = "00000000";
  assert.ok(roundTwoCandidateManifestProblems(TASK27_ARTIFACT, moved, evidence)
    .some((problem) => problem.includes("recomputed digest")));

  // The registry generation the round left untouched is named by digest, so a
  // manifest that claims a different one — or the same one after a threshold
  // moved — is refused.
  const otherRegistry = structuredClone(manifest);
  otherRegistry.registryDigest = "00000000";
  const registryProblems = roundTwoCandidateManifestProblems(
    TASK27_ARTIFACT,
    otherRegistry,
    evidence,
  );
  assert.ok(registryProblems.some((problem) => problem.includes("registry digest")));
  assert.ok(registryProblems.some((problem) => problem.includes("recomputed digest")));

  // An eligibility field would let candidacy be read as a release decision.
  const eligible = structuredClone(manifest);
  eligible.eligible = true;
  assert.ok(roundTwoCandidateManifestProblems(TASK27_ARTIFACT, eligible, evidence)
    .some((problem) => problem.includes("eligibility field")));

  // One repetition is not the round's result.
  assert.ok(roundTwoCandidateManifestProblems(TASK27_ARTIFACT, manifest, evidence.slice(0, 1))
    .some((problem) => problem.includes("expected 2 Task 26 repetitions")));
});

test("relabelling the zero-branch reason is detected against the rerun", async () => {
  const [manifest, evidence] = await Promise.all([task27Manifest(), task27Evidence()]);

  // The reason recorded here is the one the rerun produces. Claiming the other
  // zero-branch form — profiles were selected but need an unsupported
  // parameterization — is a materially different finding and is refused.
  const relabelled = structuredClone(manifest);
  relabelled.notRunReason = "no-supported-parameterization";
  const relabelledProblems = roundTwoCandidateManifestProblems(
    TASK27_ARTIFACT,
    relabelled,
    evidence,
  );
  assert.ok(relabelledProblems.some((problem) => problem.includes("not-run reason")));
  assert.ok(relabelledProblems.some((problem) => problem.includes("reruns to reason")));

  // And the check runs in the other direction too: evidence whose bass grid the
  // stop rule accepts reruns to the other reason, which the committed manifest
  // does not record.
  const accepted = structuredClone(evidence[0]);
  const third = accepted[0].ablations.at(-1);
  for (const report of third.repeatedRecovery) {
    for (const measurement of report.measurements) {
      measurement.observation.sourceDistance = 0;
      measurement.observation.attributionDelayMs = 0;
    }
  }
  const acceptedRerun = rerunRoundTwoSelection(
    accepted[0],
    TASK27_ARTIFACT.roundTwoCandidateManifest,
  );
  assert.equal(acceptedRerun.ablations.at(-1).stop.satisfied, true);
  assert.equal(acceptedRerun.terminalOutcome, "bass-axis-unsupported");
  assert.equal(acceptedRerun.notRunReason, "no-supported-parameterization");
  assert.equal(acceptedRerun.ablationId, "ablation-3-bass-axis");
  assert.ok(roundTwoCandidateManifestProblems(TASK27_ARTIFACT, manifest, [accepted, evidence[1]])
    .some((problem) => problem.includes("has an ablation the rerun stop rule accepted")));
});

const TASK28_ARTIFACT = {
  name: "Task 28 round-two eligibility manifest",
  path: "benchmark-results/listen-round-two-eligibility-manifest-task28.json",
  roundTwoEligibilityManifest: {
    name: "listen-round-two-eligibility-manifest",
    formatVersion: 1,
    roundId: "round-two",
    runStatus: "not-run-no-confirmable-candidate",
    reason: "no-ablation-accepted",
    entryCount: 0,
    candidateManifestDigest: "21655efa",
    task26TerminalOutcome: "bass-axis-unsupported",
    task26EvidenceDigest: "8dfe2f1b",
    digest: "20be9d6d",
    confirmationPartition: {
      traceCount: 12,
      decodedTraceCount: 0,
      priorLedgerHash: "1f9613bd",
      traceGenerationHash: "d1971fa3",
      traceIdentityHash: "a5695acc",
    },
    completeness: {
      registryVersion: 2,
      registryDigest: "d1b3f6a3",
      policyVersion: 1,
      policyHash: "840b07ec",
      traceManifestVersion: 2,
      traceManifestHash: "d1971fa3",
      traceManifestCorpusHash: "1213016e",
      generatorVersion: 1,
    },
    candidateManifestPath: TASK27_ARTIFACT.path,
    evidencePaths: TASK27_ARTIFACT.roundTwoCandidateManifest.evidencePaths,
    repeatedRecoveryBoundaries:
      TASK27_ARTIFACT.roundTwoCandidateManifest.repeatedRecoveryBoundaries,
    domainRegretMaterialBoundary: 0.01,
    knownDiscoveryGroupIds: TASK27_ARTIFACT.roundTwoCandidateManifest.knownDiscoveryGroupIds,
    processLocalDigestFields: TASK27_ARTIFACT.roundTwoCandidateManifest.processLocalDigestFields,
  },
};

async function task28Manifest() {
  return JSON.parse(await readFile(
    join(import.meta.dirname, "../..", TASK28_ARTIFACT.path),
    "utf8",
  ));
}

/**
 * Recomputes the digest of a mutated record.
 *
 * Without this every mutation below would fail on the digest alone, and the rule
 * the mutation is meant to exercise would never be reached.
 */
function withRecomputedDigest(record) {
  const { digest: _digest, ...rest } = record;
  return {
    ...record,
    digest: { algorithm: "fnv1a-32-canonical-json", value: canonicalJsonDigest(rest) },
  };
}

test("the committed not-run manifest is chained to Task 27 and rerun from Task 26", async () => {
  const [eligibility, candidate, evidence] = await Promise.all([
    task28Manifest(),
    task27Manifest(),
    task27Evidence(),
  ]);
  assert.deepEqual(
    roundTwoEligibilityManifestProblems(TASK28_ARTIFACT, eligibility, candidate, evidence),
    [],
  );
  // The chain is re-derived rather than read: both repetitions rerun to the
  // terminal outcome, the evidence digest, and the reason this record carries.
  for (const run of evidence) {
    const rerun = rerunRoundTwoSelection(run[0], TASK28_ARTIFACT.roundTwoEligibilityManifest);
    assert.equal(rerun.terminalOutcome, eligibility.task26TerminalOutcome);
    assert.equal(rerun.evidenceDigest, eligibility.task26EvidenceDigest);
    assert.equal(rerun.notRunReason, eligibility.reason);
  }
});

test("the two eligibility branches may not borrow each other's evidence fields", async () => {
  const [eligibility, candidate, evidence] = await Promise.all([
    task28Manifest(),
    task27Manifest(),
    task27Evidence(),
  ]);
  const problemsFor = (record) =>
    roundTwoEligibilityManifestProblems(TASK28_ARTIFACT, record, candidate, evidence);

  // Archive hashes for a run that never happened are exactly the fabricated
  // evidence the discriminated schema exists to prevent.
  assert.ok(problemsFor(withRecomputedDigest({
    ...eligibility,
    confirmationEvidence: {
      runOneArchive: "run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "0123abcd",
    },
  })).some((problem) => problem.includes("forbidden field confirmationEvidence")));

  // A candidate entry under a branch that confirmed nothing.
  assert.ok(problemsFor(withRecomputedDigest({
    ...eligibility,
    entries: [{
      profileId: "early-open-v2",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "material-partial-recovery",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("may hold no entry")));

  // And a decode claimed for fixtures the round never spent.
  assert.ok(problemsFor(withRecomputedDigest({
    ...eligibility,
    confirmationPartition: { ...eligibility.confirmationPartition, decodedTraceCount: 12 },
  })).some((problem) => problem.includes("decoded 12 confirmation traces")));

  // The census and both identities are pinned in either branch, so a partition
  // that lost rows, was re-pointed at other content, or names another manifest
  // generation fails even when its counts agree with themselves.
  for (const [field, value] of [
    ["traceCount", 0],
    ["traceIdentityHash", "00000000"],
    ["traceGenerationHash", "00000000"],
    ["priorLedgerHash", "00000000"],
  ]) {
    assert.ok(
      problemsFor(withRecomputedDigest({
        ...eligibility,
        confirmationPartition: { ...eligibility.confirmationPartition, [field]: value },
      })).some((problem) => problem.includes(`confirmation partition ${field}`)),
      `${field} is not pinned`,
    );
  }
});

/**
 * The completed branch, staged against its own pins.
 *
 * The round took the not-run branch, so no completed artifact exists. Its rules
 * still have to hold for every later round, and testing them one at a time needs
 * a record that satisfies the others.
 */
const TASK28_COMPLETED_ARTIFACT = {
  ...TASK28_ARTIFACT,
  roundTwoEligibilityManifest: {
    ...TASK28_ARTIFACT.roundTwoEligibilityManifest,
    runStatus: "completed",
    reason: undefined,
    entryCount: 1,
    digest: undefined,
    confirmationPartition: {
      ...TASK28_ARTIFACT.roundTwoEligibilityManifest.confirmationPartition,
      decodedTraceCount: 12,
    },
  },
};

function completedRecord(overrides = {}) {
  const record = {
    name: "listen-round-two-eligibility-manifest",
    formatVersion: 1,
    roundId: "round-two",
    runStatus: "completed",
    candidateManifestDigest: "21655efa",
    task26TerminalOutcome: "bass-axis-unsupported",
    task26EvidenceDigest: "8dfe2f1b",
    entries: [{
      profileId: "early-open-v2",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "material-partial-recovery",
      confirmationReproductionStatus: "reproduced",
    }],
    confirmationPartition: {
      traceCount: 12,
      decodedTraceCount: 12,
      priorLedgerHash: "1f9613bd",
      traceGenerationHash: "d1971fa3",
      traceIdentityHash: "a5695acc",
    },
    confirmationEvidence: {
      runOneArchive: "run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
    ...overrides,
  };
  return withRecomputedDigest(record);
}

/* ------------------------------------------------------------------------- *
 * The completed branch, staged as real archives on disk
 *
 * The round took the not-run branch, so no completed archive exists. Its rules
 * still have to hold for every later round, and they are rules about files: a
 * name is not evidence, and neither is agreement between two files that are both
 * the wrong evidence. So the fixtures below are written to disk and are complete
 * matrices rather than plausible-looking records.
 * ------------------------------------------------------------------------- */

const KNOWN_DISCOVERY_GROUP_IDS = [
  "dynamics-constant/tone/salamander/v05",
  "dynamics-constant/tone/salamander/v13",
  "dynamics-mixed/tone/salamander",
];

function stagedObservation(sourceDistance, attributionDelayMs) {
  return {
    evaluated: true,
    structurallyValid: true,
    firstCorrectFullChordAttackIncomplete: true,
    carriedRequiredPitchWithoutFreshReOnset: true,
    laterIdenticalAttackRecoveredCorrectTarget: sourceDistance > 0,
    sourceDistance,
    attributionDelayMs,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
  };
}

/** The frozen census, measured. Both halves, with the roles and strata it fixes. */
const STAGED_CENSUS = ROUND_TWO_CONFIRMATION_MATRIX.repeatedChordCensus
  .map(({ groupId, stratum, evidenceRole }) => ({ groupId, stratum, evidenceRole }));

function stagedMeasurements(observe) {
  return STAGED_CENSUS.map(({ groupId, stratum }) => ({
    groupId,
    stratum,
    observation: observe(groupId),
  }));
}

const HEX = (seed) => (seed >>> 0).toString(16).padStart(8, "0");

/**
 * The registry generation `d1b3f6a3` describes, restated here.
 *
 * The archive is required to carry the generation it replayed from and to hash
 * to the digest Task 27 froze, so the fixture has to be able to produce a real
 * one; an invented one is what several probes below are.
 */
const FROZEN_REGISTRY_V2 = {
  version: 2,
  defaultProfileId: "baseline-v1",
  fixedPolicy: {
    preTargetExtraLookbackMs: 30,
    collectionWindowMs: 400,
    settleMs: 32,
    duplicateOnsetMs: 120,
    wrongAttemptResetMs: 180,
    refractoryMs: 180,
    refractoryMode: "noteEvents",
  },
  profiles: [
    {
      id: "baseline-v1",
      onsetThreshold: 0.6,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.35,
      extraNoteThreshold: 0.97,
      requireFreshBassOnset: true,
    },
    {
      id: "balanced-v1",
      onsetThreshold: 0.5,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.35,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    {
      id: "sensitive-v1",
      onsetThreshold: 0.45,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.2,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    {
      id: "early-open-v2",
      onsetThreshold: 0.45,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.2,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    {
      id: "steady-open-v2",
      onsetThreshold: 0.5,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.2,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    {
      id: "early-held-v2",
      onsetThreshold: 0.45,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.275,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    {
      id: "steady-held-v2",
      onsetThreshold: 0.5,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.275,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
  ],
};

/**
 * The manifest's own captures, in manifest order.
 *
 * The identity digest is over the real trace identifiers, renderers, partitions,
 * and suites, so this fixture reads them from the committed trace manifest rather
 * than inventing 504 plausible names.
 */
function stagedCaptures() {
  return roundTwoCaptureIdentityRows().map((trace, index) => ({
    ...trace,
    recognitionStructureHash: HEX(0x51000000 + index),
    processLocalPcmHash: HEX(0x9c000000 + index),
    processLocalTraceHash: HEX(0x7a000000 + index),
    baselineOutcomeDigest: HEX(0x0d000000 + index * 8),
  }));
}

/**
 * One outcome row per trace per profile column, baseline included.
 *
 * Each row names the capture's own process-local hashes, because every column
 * replayed one capture; the baseline row reproduces the capture's recorded
 * capture-time replay.
 */
function stagedOutcomes(captures, candidateProfileIds) {
  const columns = [ROUND_TWO_CONFIRMATION_MATRIX.baselineProfileId, ...candidateProfileIds];
  return captures.flatMap((capture, traceIndex) => columns.map((profileId, column) => ({
    traceId: capture.traceId,
    profileId,
    outcomeDigest: column === 0
      ? capture.baselineOutcomeDigest
      : HEX(0x0d000000 + traceIndex * 8 + column),
    capturePcmHash: capture.processLocalPcmHash,
    captureTraceHash: capture.processLocalTraceHash,
    ...stagedTraceCounters(capture, column > 0),
  })));
}

function stagedOutcomeIdentity(outcomes) {
  return fnv1a32(outcomes.map((row) => `${row.traceId}:${row.profileId}:${row.outcomeDigest}`));
}

/**
 * Per-trace outcomes, one row per trace per column, carrying every counter a
 * domain summary is reconciled against.
 */
function stagedTraceCounters(capture, candidate) {
  const isCourseClear = capture.sequenceFamily === "course-clear";
  return {
    correctAdvanceCount: capture.caseKind === "correct" ? 1 : 0,
    courseClearCorrectAdvanceCount: isCourseClear && capture.caseKind === "correct" ? 1 : 0,
    // The candidate recognises one more event and advances one more target on
    // every scored row, which is what a clean corroborated gain looks like.
    independentMatchCount: capture.scoreEligible ? (candidate ? 4 : 3) : 0,
    orderedAdvanceCount: capture.scoreEligible ? (candidate ? 2 : 1) : 0,
    completePassageCount: capture.scoreEligible ? 1 : 0,
    falseAdvanceCount: 0,
    skippedAdvanceCount: 0,
    duplicateAdvanceCount: 0,
    incompleteCarriedBassAdvances: 0,
  };
}

/**
 * One per-domain summary per gate per column, over the domains the frozen corpus
 * defines for that gate.
 *
 * Membership comes from `roundTwoGateDomainMembership`, so the fixture cannot
 * invent a convenient grouping, and every counter is the sum of the outcome rows
 * the domain names, so it cannot state a total its own rows contradict.
 */
function stagedDomainSummaries(captures, candidateProfileIds, outcomes) {
  const columns = [ROUND_TWO_CONFIRMATION_MATRIX.baselineProfileId, ...candidateProfileIds];
  const outcomeByKey = new Map(outcomes.map((row) => [`${row.profileId}|${row.traceId}`, row]));
  return CONFIRMATION_EVIDENCE.gates.flatMap((gate) => {
    const domains = roundTwoGateDomainMembership(gate, captures);
    if (domains === null) return [];
    return domains.flatMap((traceIds, index) => columns.map((profileId) => {
      const summed = Object.fromEntries(ROUND_TWO_DOMAIN_SUMMARY_COUNTERS.map((counter) => [
        counter,
        traceIds.reduce((total, traceId) => (
          total + (outcomeByKey.get(`${profileId}|${traceId}`)?.[counter] ?? 0)
        ), 0),
      ]));
      return {
        profileId,
        gateCode: gate.code,
        domainId: `${gate.code}#${index}`,
        traceIds,
        ...summed,
        p95OnsetToAdvanceMs: 180,
      };
    }));
  });
}

/**
 * Moves a counter on one column's per-trace outcomes and re-sums every summary
 * that names those traces.
 *
 * Summaries are reconciled against the outcome rows they name, so a probe that
 * edited a summary alone would trip the reconciliation check rather than the
 * gate rule it means to exercise. Editing the measurement and re-summing is what
 * a real archive of a worse candidate looks like.
 */
function regressTraces(archive, { profileId, gateCode, counter, value, limit = Infinity }) {
  const run = archive[0];
  const targeted = run.domainSummaries
    .filter((row) => row.gateCode === gateCode && row.profileId === profileId)
    .slice(0, limit);
  const traceIds = new Set(targeted.flatMap(({ traceIds: ids }) => ids));
  for (const row of run.outcomes) {
    if (row.profileId === profileId && traceIds.has(row.traceId)) row[counter] = value;
  }
  const outcomeByKey = new Map(run.outcomes.map((row) => [`${row.profileId}|${row.traceId}`, row]));
  for (const row of run.domainSummaries) {
    if (row.profileId !== profileId) continue;
    row[counter] = row.traceIds.reduce((total, traceId) => (
      total + (outcomeByKey.get(`${profileId}|${traceId}`)?.[counter] ?? 0)
    ), 0);
  }
  run.outcomeIdentityDigest = stagedOutcomeIdentity(run.outcomes);
  return archive;
}

/** The diagnosed cases, neither worsened nor turned unsafe. */
function stagedCommittedRegressions(candidateProfileIds) {
  return candidateProfileIds.flatMap((profileId) => (
    ROUND_TWO_COMMITTED_REGRESSIONS.map(({ fixtureId, expectation }) => ({
      profileId,
      fixtureId,
      expectation,
      worseThanBaseline: false,
      // The diagnosed false advance stays exactly as diagnosed, which the gate
      // permits and an absolute-zero rule would not.
      falseAdvance: expectation === "reported-unsafe-advance",
      skippedAdvanceCount: 0,
      duplicateAdvanceCount: 0,
    }))
  ));
}

/**
 * Every frozen gate, applied and judged, for every candidate column.
 *
 * A gate that did not pass carries the failure that says so, because `passed` is
 * a claim about the failures beside it and the two must agree.
 */
function stagedGates(candidateProfileIds, judge = () => true) {
  return {
    evidenceComplete: true,
    incompleteEvidenceReasons: [],
    reviewedLayerLosses: [],
    gates: CONFIRMATION_EVIDENCE.gates.map((definition) => ({ ...definition })),
    candidates: candidateProfileIds.map((profileId) => {
      const gates = CONFIRMATION_EVIDENCE.gates.map(({ code, role, domain, partitions }) => {
        const passed = judge(profileId, code);
        return {
          code,
          role,
          domain,
          partitions: [...partitions],
          evidenceRole: partitionEvidenceRole([...partitions]),
          applied: true,
          passed,
          failures: passed ? [] : [{
            code,
            domainIds: ["tone/splendid/mf"],
            baselineValue: 0,
            candidateValue: 1,
            explanation: `${code} failed for ${profileId}`,
          }],
        };
      });
      const counters = Object.fromEntries(ROLE_FAILURE_COUNTERS.map(([counter, role]) => [
        counter,
        gates.filter((gate) => gate.role === role)
          .reduce((total, gate) => total + gate.failures.length, 0),
      ]));
      return {
        profileId,
        gates,
        ...counters,
        eligible: gates.every((gate) => gate.passed),
      };
    }),
  };
}

/** A complete round-two confirmation matrix, as an archived repetition shows it. */
function stagedMatrixArchive(candidateManifestDigest, candidateProfileIds, overrides = {}) {
  const matrix = ROUND_TWO_CONFIRMATION_MATRIX;
  const captures = stagedCaptures();
  const outcomes = stagedOutcomes(captures, candidateProfileIds);
  return [{
    name: matrix.name,
    formatVersion: matrix.formatVersion,
    manifest: {
      version: matrix.manifestVersion,
      hash: matrix.manifestHash,
      corpusHash: matrix.manifestCorpusHash,
    },
    registryVersion: matrix.registryVersion,
    selectionPolicy: { version: matrix.policyVersion, hash: matrix.policyHash },
    baselineProfileId: matrix.baselineProfileId,
    candidateProfileIds,
    candidateManifestDigest,
    rendererKeys: [...matrix.rendererKeys],
    registryDigest: TASK28_ARTIFACT.roundTwoEligibilityManifest.completeness.registryDigest,
    generatorVersion: TASK28_ARTIFACT.roundTwoEligibilityManifest.completeness.generatorVersion,
    registry: FROZEN_REGISTRY_V2,
    // Every column replays its registry entry, field for field. A completed
    // round would register its candidates as new identifiers in a new
    // generation; the staged one reuses this generation's, which is what the
    // frozen digest describes.
    profiles: Object.fromEntries(
      [matrix.baselineProfileId, ...candidateProfileIds].map((profileId, index) => {
        const entry = FROZEN_REGISTRY_V2.profiles[index === 0 ? 0 : index + 2];
        const { id: _id, ...thresholds } = entry;
        return [profileId, { ...thresholds }];
      }),
    ),
    capturedTraceCount: captures.length,
    confirmationTraceCountRead: captures
      .filter(({ partition }) => partition === "confirmation").length,
    captures,
    outcomes,
    outcomeIdentityDigest: stagedOutcomeIdentity(outcomes),
    domainSummaries: stagedDomainSummaries(captures, candidateProfileIds, outcomes),
    committedRegressions: stagedCommittedRegressions(candidateProfileIds),
    repeatedChordCensus: STAGED_CENSUS,
    // The incumbent recovers late in every group; the candidate recovers on the
    // real attack, which is a material gain and a full resolution everywhere.
    baselineRepeatedMeasurements: stagedMeasurements(() => stagedObservation(2, 2_220)),
    repeatedRecovery: candidateProfileIds.map((profileId) => ({
      profileId,
      comparedAgainstProfileId: matrix.baselineProfileId,
      measurements: stagedMeasurements(() => stagedObservation(0, 228)),
    })),
    gates: stagedGates(candidateProfileIds),
    ...overrides,
  }];
}

/**
 * Writes two archived repetitions and returns everything the rules need.
 *
 * The two files are byte-identical on purpose: two repetitions of a
 * deterministic matrix may legitimately produce the same bytes, and that must be
 * acceptable evidence.
 */
async function withStagedArchives(run, buildArchive = stagedMatrixArchive) {
  const directory = await mkdtemp(join(tmpdir(), "listen-task28-"));
  const candidateProfileIds = ["early-open-v2"];
  const candidate = withRecomputedDigest({
    ...(await task27Manifest()),
    candidateProfileIds,
    notRunReason: null,
    ablationId: "ablation-2-refined-family",
  });
  const names = [
    "listen-profile-validation-task28-run1.json",
    "listen-profile-validation-task28-run2.json",
  ];
  const body = `${JSON.stringify(
    buildArchive(candidate.digest.value, candidateProfileIds),
    null,
    2,
  )}\n`;
  for (const name of names) await writeFile(join(directory, name), body);
  try {
    const archives = await readRoundTwoConfirmationArchives(names, directory);
    const [one, two] = names.map((name) => archives.get(name));
    return await run({
      directory,
      names,
      archives,
      candidate,
      candidateProfileIds,
      confirmationEvidence: {
        runOneArchive: names[0],
        runOneSha256: one.fileSha256,
        runTwoArchive: names[1],
        runTwoSha256: two.fileSha256,
        comparisonDigest: one.comparisonDigest,
      },
    });
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("a completed run's archives are read, hashed, and compared, not just named", async () => {
  await withStagedArchives(async ({ directory, names, archives, confirmationEvidence }) => {
    const [one, two] = names.map((name) => archives.get(name));
    // The two runs are deterministic and hash alike; that is acceptable evidence.
    assert.equal(one.fileSha256, two.fileSha256);
    assert.notEqual(one.fileIdentity, undefined);
    assert.deepEqual(
      confirmationArchiveEvidenceProblems("label", confirmationEvidence, archives),
      [],
    );

    // A recorded hash that is not the file's own.
    assert.ok(confirmationArchiveEvidenceProblems(
      "label",
      { ...confirmationEvidence, runOneSha256: "a".repeat(64) },
      archives,
    ).some((problem) => problem.includes("runOneArchive hashes to")));

    // A comparison digest neither archive recomputes to.
    assert.ok(confirmationArchiveEvidenceProblems(
      "label",
      { ...confirmationEvidence, comparisonDigest: "b".repeat(64) },
      archives,
    ).some((problem) => problem.includes("recomputes to comparison digest")));

    // Two spellings of one file are one run, even though the strings differ.
    const aliased = [`./${names[0]}`, names[0]];
    const aliasArchives = await readRoundTwoConfirmationArchives(aliased, directory);
    assert.ok(confirmationArchiveEvidenceProblems(
      "label",
      {
        runOneArchive: aliased[0],
        runOneSha256: one.fileSha256,
        runTwoArchive: aliased[1],
        runTwoSha256: one.fileSha256,
        comparisonDigest: one.comparisonDigest,
      },
      aliasArchives,
    ).some((problem) => problem.includes("the same file")));

    // And so is a link beside its target, which no amount of path normalization
    // would collapse: distinctness is filesystem identity, not string identity.
    const linkName = "listen-profile-validation-task28-link.json";
    await symlink(join(directory, names[0]), join(directory, linkName));
    const linkArchives = await readRoundTwoConfirmationArchives([names[0], linkName], directory);
    assert.notEqual(
      linkArchives.get(names[0]).canonicalPath,
      linkArchives.get(linkName).canonicalPath,
    );
    assert.ok(confirmationArchiveEvidenceProblems(
      "label",
      {
        runOneArchive: names[0],
        runOneSha256: one.fileSha256,
        runTwoArchive: linkName,
        runTwoSha256: one.fileSha256,
        comparisonDigest: one.comparisonDigest,
      },
      linkArchives,
    ).some((problem) => problem.includes("the same file")));

    // Two names that are not files at all.
    const missing = await readRoundTwoConfirmationArchives(["a.json", "b.json"], directory);
    const missingProblems = confirmationArchiveEvidenceProblems(
      "label",
      {
        runOneArchive: "a.json",
        runOneSha256: "a".repeat(64),
        runTwoArchive: "b.json",
        runTwoSha256: "b".repeat(64),
        comparisonDigest: "c".repeat(64),
      },
      missing,
    );
    assert.equal(missingProblems.length, 2);
    assert.ok(missingProblems.every((problem) => problem.includes("could not be read")));

    // And a completed record whose archives were never resolved is not evidence.
    assert.deepEqual(
      confirmationArchiveEvidenceProblems("label", confirmationEvidence, null),
      ["label: the named confirmation archives were not read"],
    );
  });
});

test("two agreeing archives are refused unless each is the frozen matrix", async () => {
  const pins = TASK28_ARTIFACT.roundTwoEligibilityManifest;

  // The counterexample: two identical files that are not a confirmation matrix.
  const stub = [{ name: "listen-profile-validation" }];
  const stubProblems = roundTwoConfirmationMatrixProblems(stub, "label", ["early-open-v2"], {
    ...pins,
    candidateManifestDigest: "21655efa",
  });
  assert.ok(stubProblems.length > 5);
  for (const expected of [
    "manifest version",
    "archives no captured traces",
    "candidate manifest digest",
    "declares repeated-chord groups",
    "archives no gate evidence",
  ]) {
    assert.ok(
      stubProblems.some((problem) => problem.includes(expected)),
      `the stub archive passed ${expected}`,
    );
  }

  await withStagedArchives(async ({ archives, names, candidate, candidateProfileIds }) => {
    const expected = { ...pins, candidateManifestDigest: candidate.digest.value };
    const record = archives.get(names[0]).record;
    // Task 13's gate partitions predate manifest version 2, so the release gates
    // read no row and the verifier says so. That is asserted on its own below;
    // every other rule is exercised against a matrix that is otherwise complete.
    const UNFROZEN_SCOPE = "its round-two scope is not frozen";
    const problemsOf = (archive) => roundTwoConfirmationMatrixProblems(
      archive,
      "label",
      candidateProfileIds,
      expected,
    ).filter((problem) => !problem.includes(UNFROZEN_SCOPE));
    assert.deepEqual(problemsOf(record), []);

    // A narrowed run can reject a candidate but never clear one, and the total
    // is recomputed from the captures rather than read.
    const narrowed = structuredClone(record);
    narrowed[0].captures = narrowed[0].captures.slice(0, 48);
    narrowed[0].capturedTraceCount = 48;
    const narrowedProblems =
      problemsOf(narrowed);
    assert.ok(narrowedProblems.some((problem) => problem.includes("captured traces 48")));
    assert.ok(narrowedProblems.some((problem) => problem.includes("expected 212")));

    // A stated total that its own captures contradict.
    const overstated = structuredClone(record);
    overstated[0].capturedTraceCount = 9_999;
    assert.ok(problemsOf(overstated)
      .some((problem) => problem.includes("declared captured traces")));

    // A run that padded the census with duplicates of a cheap stratum.
    const padded = structuredClone(record);
    const isolated = padded[0].captures.find(({ suite }) => suite === "isolated");
    padded[0].captures = padded[0].captures
      .filter(({ partition }) => partition !== "confirmation")
      .concat(Array.from({ length: 12 }, (_unused, index) => ({
        ...isolated,
        traceId: `padding/${index}`,
      })));
    const paddedProblems =
      problemsOf(padded);
    assert.equal(padded[0].captures.length, 504);
    assert.ok(paddedProblems.some((problem) => (
      problem.includes("captured 0 confirmation/round-two-paired traces")
    )));

    // A capture that does not record what it rendered and decoded.
    const unrecorded = structuredClone(record);
    delete unrecorded[0].captures[0].processLocalTraceHash;
    assert.ok(problemsOf(unrecorded)
      .some((problem) => problem.includes("does not record what it rendered")));

    // One trace captured twice is one trace, not two rows of coverage.
    const duplicated = structuredClone(record);
    duplicated[0].captures[1] = { ...duplicated[0].captures[0] };
    assert.ok(problemsOf(duplicated)
      .some((problem) => problem.includes("captured the same trace twice")));

    // A stratum the version-2 census does not contain, at the right total.
    const foreignSuite = structuredClone(record);
    foreignSuite[0].captures[0].suite = "invented-suite";
    assert.ok(
      problemsOf(foreignSuite)
        .some((problem) => problem.includes("which the version-2 census does not contain")),
    );

    // A stated confirmation-read count its own captures contradict.
    const overclaimed = structuredClone(record);
    overclaimed[0].confirmationTraceCountRead = 12_000;
    assert.ok(problemsOf(overclaimed)
      .some((problem) => problem.includes("declared confirmation traces read")));

    // A confirmation group relabelled as discovery escapes the confirmation
    // rules while keeping the census complete, so roles are frozen too.
    const relabelledRole = structuredClone(record);
    const confirmationEntry = relabelledRole[0].repeatedChordCensus
      .find(({ evidenceRole }) => evidenceRole === "confirmation");
    confirmationEntry.evidenceRole = "discovery";
    assert.ok(
      problemsOf(relabelledRole)
        .some((problem) => problem.includes("is declared")),
    );

    // And a group's stratum in the census itself.
    const relabelledStratum = structuredClone(record);
    relabelledStratum[0].repeatedChordCensus[0].stratum = "known-round-one-repeated-chord-other";
    assert.ok(
      problemsOf(relabelledStratum)
        .some((problem) => problem.includes("is declared")),
    );

    // 504 fabricated identifiers in the right buckets are not the corpus.
    const fabricated = structuredClone(record);
    fabricated[0].captures = fabricated[0].captures.map((capture, index) => ({
      ...capture,
      traceId: `fabricated/${index}`,
    }));
    fabricated[0].outcomes = stagedOutcomes(fabricated[0].captures, candidateProfileIds);
    fabricated[0].outcomeIdentityDigest = stagedOutcomeIdentity(fabricated[0].outcomes);
    const fabricatedProblems =
      problemsOf(fabricated);
    assert.ok(fabricatedProblems.some((problem) => (
      problem.includes("captured corpus identity")
    )));
    assert.ok(fabricatedProblems.some((problem) => problem.includes("never captured 504")));

    // The renderer is part of that identity, so a corpus replayed under the
    // wrong renderer fails at the same identifiers.
    const wrongRenderer = structuredClone(record);
    wrongRenderer[0].captures[0].rendererKey = "tone";
    wrongRenderer[0].captures[1].rendererKey = "direct";
    assert.ok(
      problemsOf(wrongRenderer)
        .some((problem) => problem.includes("captured corpus identity")),
    );

    // A placeholder in place of a decoded-structure or process-local hash.
    const placeholder = structuredClone(record);
    placeholder[0].captures[0].processLocalPcmHash = "x";
    assert.ok(problemsOf(placeholder)
      .some((problem) => problem.includes("records a placeholder in place of a hash")));

    // A column that never judged every captured trace.
    const partialColumns = structuredClone(record);
    partialColumns[0].outcomes = partialColumns[0].outcomes.slice(0, 100);
    assert.ok(
      problemsOf(partialColumns)
        .some((problem) => problem.includes("per-profile outcome rows")),
    );

    // The discovery half of the repeated-chord census is frozen too, so a run
    // that declared only the historical known groups is refused.
    const historicalOnly = structuredClone(record);
    const keep = new Set(KNOWN_DISCOVERY_GROUP_IDS);
    historicalOnly[0].repeatedChordCensus = historicalOnly[0].repeatedChordCensus
      .filter(({ groupId }) => keep.has(groupId));
    assert.ok(
      problemsOf(historicalOnly)
        .some((problem) => problem.includes("declares repeated-chord groups")),
    );

    // And a group filed under another stratum moves a completeness verdict.
    const misfiled = structuredClone(record);
    misfiled[0].baselineRepeatedMeasurements[0].stratum = "known-round-one-repeated-chord-other";
    assert.ok(problemsOf(misfiled)
      .some((problem) => problem.includes("files")));

    // A column measured against some other round's candidate set.
    const otherRound = structuredClone(record);
    otherRound[0].candidateManifestDigest = "00000000";
    assert.ok(problemsOf(otherRound)
      .some((problem) => problem.includes("candidate manifest digest")));

    // One side of a comparison missing is not a comparison.
    const halfArchived = structuredClone(record);
    halfArchived[0].baselineRepeatedMeasurements =
      halfArchived[0].baselineRepeatedMeasurements.slice(0, 2);
    assert.ok(
      problemsOf(halfArchived)
        .some((problem) => problem.includes("the baseline column measures")),
    );

    // An outcome row that records a column ran, not what it decided.
    const hollow = structuredClone(record);
    hollow[0].outcomes = hollow[0].outcomes.map(({ traceId, profileId }) => ({
      traceId,
      profileId,
    }));
    assert.ok(problemsOf(hollow)
      .some((problem) => problem.includes("not what it decided")));

    // A moved outcome that the stated identity does not cover.
    const movedOutcome = structuredClone(record);
    movedOutcome[0].outcomes[0].outcomeDigest = "00000000";
    assert.ok(problemsOf(movedOutcome)
      .some((problem) => problem.includes("outcome identity")));

    // An unevaluated repeated-chord row reads as clean and unregressed, and is
    // not a measurement at all.
    const unevaluated = structuredClone(record);
    unevaluated[0].baselineRepeatedMeasurements[0].observation = {};
    const unevaluatedProblems =
      problemsOf(unevaluated);
    assert.ok(unevaluatedProblems.some((problem) => problem.includes("records no evaluated")));
    assert.ok(unevaluatedProblems.some((problem) => problem.includes("was never evaluated")));

    // The same on a candidate column, and a structurally invalid row.
    const invalidCandidate = structuredClone(record);
    invalidCandidate[0].repeatedRecovery[0].measurements[0].observation.structurallyValid = false;
    assert.ok(
      problemsOf(invalidCandidate)
        .some((problem) => problem.includes("is not structurally valid")),
    );

    // A source distance without the delay it must be compared with.
    const halfMeasured = structuredClone(record);
    halfMeasured[0].repeatedRecovery[0].measurements[0].observation.attributionDelayMs = null;
    assert.ok(
      problemsOf(halfMeasured)
        .some((problem) => problem.includes("do not travel together")),
    );

    // An identifier is a label: a run measured under altered thresholds keeps
    // every expected name, so each column's values are bound to the registry
    // entry its identifier names.
    const altered = structuredClone(record);
    altered[0].profiles["baseline-v1"].onsetThreshold = 0.42;
    assert.ok(problemsOf(altered)
      .some((problem) => problem.includes("not the values its registry entry froze")));

    // The reported counterexample: every candidate threshold replaced with 999
    // while the expected registry digest is retained.
    const nonsense = structuredClone(record);
    for (const key of Object.keys(nonsense[0].profiles[candidateProfileIds[0]])) {
      nonsense[0].profiles[candidateProfileIds[0]][key] = 999;
    }
    assert.ok(problemsOf(nonsense)
      .some((problem) => problem.includes("not the values its registry entry froze")));

    // A registry generation the frozen digest does not describe.
    const movedRegistry = structuredClone(record);
    movedRegistry[0].registry.profiles[3].onsetThreshold = 0.42;
    assert.ok(
      problemsOf(movedRegistry)
        .some((problem) => problem.includes("recomputed registry digest")),
    );

    // No generation at all is columns without values.
    const noRegistry = structuredClone(record);
    delete noRegistry[0].registry;
    assert.ok(problemsOf(noRegistry)
      .some((problem) => problem.includes("identifiers without values")));

    // A column replayed from outside the generation it names.
    const foreignColumn = structuredClone(record);
    foreignColumn[0].registry.profiles =
      foreignColumn[0].registry.profiles.filter(({ id }) => id !== candidateProfileIds[0]);
    assert.ok(
      problemsOf(foreignColumn)
        .some((problem) => problem.includes("outside the registry generation it names")),
    );

    // A threshold shape that is not the one the registry froze.
    const reshaped = structuredClone(record);
    reshaped[0].profiles[candidateProfileIds[0]].invented = 1;
    assert.ok(problemsOf(reshaped)
      .some((problem) => problem.includes("was replayed with fields")));

    const unrecordedProfile = structuredClone(record);
    delete unrecordedProfile[0].profiles[candidateProfileIds[0]];
    assert.ok(
      problemsOf(unrecordedProfile)
        .some((problem) => problem.includes("without recording the thresholds it used")),
    );

    const otherRegistry = structuredClone(record);
    otherRegistry[0].registryDigest = "00000000";
    assert.ok(
      problemsOf(otherRegistry)
        .some((problem) => problem.includes("registry digest")),
    );

    // A summary that states a total its own outcome rows contradict. Both
    // directions: a clean summary over a regressed trace, and an invented
    // summary over clean traces.
    const smoothedOver = structuredClone(record);
    const regressedRow = smoothedOver[0].outcomes.find((row) => (
      row.profileId === candidateProfileIds[0] && row.orderedAdvanceCount > 0
    ));
    regressedRow.orderedAdvanceCount = 0;
    smoothedOver[0].outcomeIdentityDigest = stagedOutcomeIdentity(smoothedOver[0].outcomes);
    assert.ok(
      problemsOf(smoothedOver).some((problem) => (
        problem.includes("its own outcome rows sum to")
      )),
      "a per-trace regression was smoothed away by a clean summary",
    );
    const inventedTotal = structuredClone(record);
    inventedTotal[0].domainSummaries.find((row) => (
      row.profileId === candidateProfileIds[0]
    )).orderedAdvanceCount += 5;
    assert.ok(
      problemsOf(inventedTotal).some((problem) => (
        problem.includes("its own outcome rows sum to")
      )),
      "a summary stated a total its own rows do not support",
    );

    // The committed-regression gate holds diagnosed cases to not worsening, not
    // to absolute zero. The known Tone 333 ms false advance may stay exactly as
    // diagnosed, which an absolute rule would reject.
    const committedVerdict = (outcomes) => rederiveRoundTwoGateVerdicts(
      { ...record[0], committedRegressions: outcomes },
      candidateProfileIds[0],
    ).find(({ code }) => code === "safety-committed-regression").failures;
    assert.deepEqual(
      committedVerdict(record[0].committedRegressions),
      [],
      "a diagnosed false advance that did not worsen was rejected",
    );
    assert.deepEqual(
      committedVerdict(record[0].committedRegressions.map((outcome) => (
        outcome.expectation === "reported-unsafe-advance"
          ? { ...outcome, worseThanBaseline: true }
          : outcome
      ))),
      ["tone-course-clear-333-shared-pitch-false-advance:worse-than-baseline"],
    );
    // A pinned late advance is a recovery and may move earlier, but it may never
    // become unsafe.
    assert.deepEqual(
      committedVerdict(record[0].committedRegressions.map((outcome) => (
        outcome.expectation === "late-advance"
          ? { ...outcome, falseAdvance: true }
          : outcome
      ))),
      ["tone-salamander-v05-repeated-chord-late-advance:late-advance-became-unsafe"],
    );
    assert.deepEqual(
      committedVerdict(record[0].committedRegressions.map((outcome) => (
        outcome.expectation === "late-advance"
          ? { ...outcome, duplicateAdvanceCount: 1 }
          : outcome
      ))),
      ["tone-salamander-v05-repeated-chord-late-advance:late-advance-became-unsafe"],
    );

    // The diagnosed cases must be archived at all, and completely.
    const noRegressions = structuredClone(record);
    noRegressions[0].committedRegressions = [];
    assert.ok(problemsOf(noRegressions).some((problem) => (
      problem.includes("archives no committed-regression outcomes")
    )));
    // One invented safe row cannot stand in for both diagnosed fixtures.
    const inventedFixture = structuredClone(record);
    inventedFixture[0].committedRegressions = candidateProfileIds.map((profileId) => ({
      profileId,
      fixtureId: "some-other-fixture",
      expectation: "late-advance",
      worseThanBaseline: false,
      falseAdvance: false,
      skippedAdvanceCount: 0,
      duplicateAdvanceCount: 0,
    }));
    assert.ok(problemsOf(inventedFixture).some((problem) => (
      problem.includes("and the frozen census is")
    )));

    // Nor may one of the two be reported under the other's expectation, which
    // would move a diagnosed false advance under the late-advance rule.
    const swapped = structuredClone(record);
    for (const outcome of swapped[0].committedRegressions) {
      outcome.expectation = outcome.expectation === "late-advance"
        ? "reported-unsafe-advance"
        : "late-advance";
    }
    assert.ok(problemsOf(swapped).some((problem) => problem.includes("and it is diagnosed")));

    // And the same fixture twice is not the census either.
    const duplicatedFixture = structuredClone(record);
    duplicatedFixture[0].committedRegressions = candidateProfileIds.flatMap((profileId) => ([
      { ...duplicatedFixture[0].committedRegressions[0], profileId },
      { ...duplicatedFixture[0].committedRegressions[0], profileId },
    ]));
    assert.ok(problemsOf(duplicatedFixture).some((problem) => (
      problem.includes("and the frozen census is")
    )));

    const malformedRegression = structuredClone(record);
    delete malformedRegression[0].committedRegressions[0].worseThanBaseline;
    assert.ok(problemsOf(malformedRegression).some((problem) => (
      problem.includes("incomplete committed-regression outcome")
    )));

    // A gate verdict is a claim about the archived rows, and both halves of the
    // report can agree and still be false: a candidate that advanced falsely
    // where the incumbent did not has introduced an unsafe event, whatever its
    // gate report says.
    const unsafeIntroduced = structuredClone(record);
    const candidateRow = unsafeIntroduced[0].outcomes
      .find((row) => row.profileId === candidateProfileIds[0]);
    candidateRow.falseAdvanceCount = 1;
    unsafeIntroduced[0].outcomeIdentityDigest =
      stagedOutcomeIdentity(unsafeIntroduced[0].outcomes);
    assert.ok(
      problemsOf(unsafeIntroduced)
        .some((problem) => problem.includes("cleared every safety gate while introducing")),
    );
    // And the eligibility derived from that archive is false regardless of what
    // its gate report claims.
    const [derivedUnsafe] = rederiveRoundTwoEligibilityEntries(
      unsafeIntroduced,
      candidateProfileIds,
      TASK28_ARTIFACT.roundTwoEligibilityManifest,
    );
    assert.equal(derivedUnsafe.automatedEligible, false);

    // The reported exploit: a discovery-sequence ordered-advance count below the
    // incumbent's, with every gate still reported as passed.
    const orderedRegression = regressTraces(structuredClone(record), {
      profileId: candidateProfileIds[0],
      gateCode: "consistency-sequence-ordered-progress",
      counter: "orderedAdvanceCount",
      value: 0,
    });
    assert.ok(
      problemsOf(orderedRegression).some((problem) => (
        problem.includes("consistency-sequence-ordered-progress") &&
          problem.includes("rederive a failure")
      )),
    );
    const [derivedOrdered] = rederiveRoundTwoEligibilityEntries(
      orderedRegression,
      candidateProfileIds,
      TASK28_ARTIFACT.roundTwoEligibilityManifest,
    );
    assert.equal(derivedOrdered.automatedEligible, false);

    // Each of the remaining gate classes is rederived from its own counter, so
    // a regression in any of them is caught with every gate still reported clean.
    // Only the gates that read a manifest-version-2 row can be probed; the
    // release gates read none, which is asserted on its own below.
    for (const [gateCode, counter] of [
      ["consistency-sequence-speed-recognition", "independentMatchCount"],
      ["consistency-dynamics-piano-recognition", "independentMatchCount"],
      ["safety-sequence-introduced-advance", "falseAdvanceCount"],
    ]) {
      const regressed = regressTraces(structuredClone(record), {
        profileId: candidateProfileIds[0],
        gateCode,
        counter,
        value: counter === "falseAdvanceCount" ? 1 : 0,
        limit: 1,
      });
      const verdicts = rederiveRoundTwoGateVerdicts(regressed[0], candidateProfileIds[0]);
      assert.ok(
        verdicts.find(({ code }) => code === gateCode).failures.length > 0,
        `${gateCode} did not rederive a failure from a fall in ${counter}`,
      );
      assert.ok(
        problemsOf(regressed)
          .some((problem) => problem.includes(gateCode) && problem.includes("rederive a failure")),
        `${gateCode} was accepted as passed`,
      );
    }

    // Ordered progress is both halves. A candidate can hold its ordered advances
    // and still complete fewer passages, which the real gate fails.
    const lostPassages = regressTraces(structuredClone(record), {
      profileId: candidateProfileIds[0],
      gateCode: "consistency-sequence-ordered-progress",
      counter: "completePassageCount",
      value: 0,
      limit: 1,
    });
    assert.ok(
      problemsOf(lostPassages)
        .some((problem) => (
          problem.includes("consistency-sequence-ordered-progress") &&
            problem.includes("rederive a failure")
        )),
      "a lost complete passage was accepted because ordered advances held",
    );

    // Family breadth is netted per family and asked only of a candidate that
    // claims a gain. A gain confined to one family fails the breadth minimum.
    const oneFamily = structuredClone(record);
    const breadthRows = oneFamily[0].domainSummaries.filter((row) => (
      row.gateCode === "consistency-sequence-family-breadth" &&
      row.profileId === candidateProfileIds[0]
    ));
    assert.ok(breadthRows.length >= 2);
    for (const row of breadthRows.slice(1)) {
      const baseline = oneFamily[0].domainSummaries.find((entry) => (
        entry.gateCode === row.gateCode && entry.domainId === row.domainId &&
        entry.profileId === "baseline-v1"
      ));
      row.orderedAdvanceCount = baseline.orderedAdvanceCount;
      row.independentMatchCount = baseline.independentMatchCount;
    }
    assert.ok(
      problemsOf(oneFamily)
        .some((problem) => (
          problem.includes("consistency-sequence-family-breadth") &&
            problem.includes("rederive a failure")
        )),
      "a gain confined to one family cleared the breadth minimum",
    );

    // And an ordered gain with no same-family independent corroboration is
    // cascade amplification, which the gate refuses even at full breadth.
    const uncorroborated = structuredClone(record);
    for (const row of uncorroborated[0].domainSummaries) {
      if (row.gateCode !== "consistency-sequence-family-breadth") continue;
      if (row.profileId === candidateProfileIds[0]) {
        const baseline = uncorroborated[0].domainSummaries.find((entry) => (
          entry.gateCode === row.gateCode && entry.domainId === row.domainId &&
          entry.profileId === "baseline-v1"
        ));
        row.independentMatchCount = baseline.independentMatchCount;
      }
    }
    const uncorroboratedVerdict = rederiveRoundTwoGateVerdicts(
      uncorroborated[0],
      candidateProfileIds[0],
    ).find(({ code }) => code === "consistency-sequence-family-breadth");
    assert.ok(
      uncorroboratedVerdict.failures.includes("corroboration:none"),
      "an ordered gain with no same-family independent gain was corroborated",
    );

    // A candidate claiming no gain at all is not asked the breadth question.
    const flat = structuredClone(record);
    for (const row of flat[0].domainSummaries) {
      if (row.gateCode !== "consistency-sequence-family-breadth") continue;
      if (row.profileId === candidateProfileIds[0]) {
        const baseline = flat[0].domainSummaries.find((entry) => (
          entry.gateCode === row.gateCode && entry.domainId === row.domainId &&
          entry.profileId === "baseline-v1"
        ));
        row.orderedAdvanceCount = baseline.orderedAdvanceCount;
        row.independentMatchCount = baseline.independentMatchCount;
      }
    }
    assert.deepEqual(
      rederiveRoundTwoGateVerdicts(flat[0], candidateProfileIds[0])
        .find(({ code }) => code === "consistency-sequence-family-breadth").failures,
      [],
    );

    // The dedicated sequence families hold four counts at zero, and the
    // carried-bass one is as absolute as the other three.
    for (const counter of [
      "falseAdvanceCount",
      "skippedAdvanceCount",
      "duplicateAdvanceCount",
      "incompleteCarriedBassAdvances",
    ]) {
      const unsafe = regressTraces(structuredClone(record), {
        profileId: candidateProfileIds[0],
        gateCode: "safety-sequence-dedicated-families",
        counter,
        value: 1,
        limit: 1,
      });
      assert.ok(
        problemsOf(unsafe)
          .some((problem) => (
            problem.includes("safety-sequence-dedicated-families") &&
              problem.includes("rederive a failure")
          )),
        `${counter} was not an absolute failure in the dedicated families`,
      );
    }

    // Layer loss allows one independent event and fails beyond it.
    // A layer of one trace losing its single independent event is exactly the
    // one-event allowance.
    const oneLayerEvent = regressTraces(structuredClone(record), {
      profileId: candidateProfileIds[0],
      gateCode: "consistency-dynamics-layer-loss",
      counter: "independentMatchCount",
      value: 2,
      limit: 1,
    });
    assert.deepEqual(
      problemsOf(oneLayerEvent),
      [],
      "a single independent-event loss was refused, and the policy allows one",
    );
    const twoLayerEvents = regressTraces(structuredClone(record), {
      profileId: candidateProfileIds[0],
      gateCode: "consistency-dynamics-layer-loss",
      counter: "independentMatchCount",
      value: 1,
      limit: 1,
    });
    assert.ok(
      problemsOf(twoLayerEvents)
        .some((problem) => (
          problem.includes("consistency-dynamics-layer-loss") &&
            problem.includes("rederive a failure")
        )),
      "a two-event layer loss cleared the allowance",
    );

    // The isolated latency gate carries the absolute limit and the null rule,
    // and reads no manifest-version-2 row, so its rules are exercised on the
    // re-derivation directly rather than through an archive that cannot supply
    // it evidence.
    const latencyGate = CONFIRMATION_EVIDENCE.gates
      .find(({ code }) => code === "release-isolated-latency");
    const latencyRun = (candidateP95, baselineP95) => ({
      domainSummaries: [
        {
          profileId: "baseline-v1",
          gateCode: latencyGate.code,
          domainId: "d",
          traceIds: ["t"],
          p95OnsetToAdvanceMs: baselineP95,
        },
        {
          profileId: candidateProfileIds[0],
          gateCode: latencyGate.code,
          domainId: "d",
          traceIds: ["t"],
          p95OnsetToAdvanceMs: candidateP95,
        },
      ],
      outcomes: [],
      captures: [],
    });
    const latencyFailures = (candidateP95, baselineP95) => rederiveRoundTwoGateVerdicts(
      latencyRun(candidateP95, baselineP95),
      candidateProfileIds[0],
    ).find(({ code }) => code === latencyGate.code).failures;
    assert.deepEqual(latencyFailures(180, 180), []);
    assert.deepEqual(latencyFailures(212, 180), [], "the 32 ms tolerance was not applied");
    assert.deepEqual(latencyFailures(null, 180), ["d:absent"]);
    assert.deepEqual(latencyFailures(213, 180), ["d:regression"]);
    // The absolute limit binds even when the incumbent is just as slow, so it is
    // not the regression check under another name.
    assert.deepEqual(latencyFailures(400, 400), ["d:limit"]);

    // The sequence latency gate applies only the tolerance, and only where both
    // percentiles exist: no absolute limit, and an absent percentile is not a
    // failure there.
    const slowSequence = structuredClone(record);
    for (const row of slowSequence[0].domainSummaries) {
      if (row.gateCode === "consistency-sequence-latency") row.p95OnsetToAdvanceMs = 900;
    }
    assert.deepEqual(
      problemsOf(slowSequence),
      [],
      "the isolated 400 ms limit was applied to the sequence latency gate",
    );
    const absentSequence = structuredClone(record);
    for (const row of absentSequence[0].domainSummaries) {
      if (row.gateCode === "consistency-sequence-latency" &&
          row.profileId === candidateProfileIds[0]) {
        row.p95OnsetToAdvanceMs = null;
      }
    }
    assert.deepEqual(
      problemsOf(absentSequence),
      [],
      "an absent sequence p95 was rejected, and only the isolated gate rejects one",
    );
    const slowerSequence = structuredClone(record);
    for (const row of slowerSequence[0].domainSummaries) {
      if (row.gateCode === "consistency-sequence-latency" &&
          row.profileId === candidateProfileIds[0]) {
        row.p95OnsetToAdvanceMs = 180 + 33;
      }
    }
    assert.ok(
      problemsOf(slowerSequence).some((problem) => (
        problem.includes("consistency-sequence-latency") && problem.includes("rederive a failure")
      )),
    );

    // A percentile that is not null and not a finite, non-negative number is not
    // a measurement: a negative duration, an Infinity from an extreme JSON
    // exponent, and a string are all refused.
    for (const value of ["fast", -1, 1e400]) {
      const badP95 = structuredClone(record);
      badP95[0].domainSummaries[0].p95OnsetToAdvanceMs = value;
      assert.ok(
        problemsOf(badP95).some((problem) => problem.includes("not a complete measurement")),
        `a p95 of ${JSON.stringify(value)} was accepted`,
      );
    }

    // Replay integrity is rederived too: a column that replayed its own capture
    // rather than the shared one, and a baseline that did not reproduce its
    // capture-time replay.
    const reReplayed = structuredClone(record);
    reReplayed[0].outcomes[1].capturePcmHash = "00000000";
    assert.ok(
      problemsOf(reReplayed)
        .some((problem) => (
          problem.includes("replay-trace-reuse") && problem.includes("rederive a failure")
        )),
    );
    const brokenParity = structuredClone(record);
    brokenParity[0].outcomes[0].outcomeDigest = "00000000";
    brokenParity[0].outcomeIdentityDigest = stagedOutcomeIdentity(brokenParity[0].outcomes);
    assert.ok(
      problemsOf(brokenParity)
        .some((problem) => (
          problem.includes("replay-baseline-parity") && problem.includes("rederive a failure")
        )),
    );

    // A report that claims a failure its measurements do not produce is refused
    // in the same direction, so the check cannot be satisfied by pessimism.
    const overCautious = structuredClone(record);
    overCautious[0].gates.candidates[0].gates[9].passed = false;
    assert.ok(
      problemsOf(overCautious)
        .some((problem) => problem.includes("rederive a pass")),
    );

    // And the summaries themselves must be complete on both sides.
    const noSummaries = structuredClone(record);
    delete noSummaries[0].domainSummaries;
    assert.ok(problemsOf(noSummaries)
      .some((problem) => problem.includes("cannot be rederived")));

    const unpairedSummary = structuredClone(record);
    unpairedSummary[0].domainSummaries = unpairedSummary[0].domainSummaries
      .filter((row) => row.profileId !== "baseline-v1");
    assert.ok(
      problemsOf(unpairedSummary)
        .some((problem) => problem.includes("summarises no domain for baseline-v1")),
    );

    // A losing domain dropped for one column only: the domain sets must match
    // across columns, so a clean paired row cannot stand in for it.
    const droppedForCandidate = structuredClone(record);
    const victim = droppedForCandidate[0].domainSummaries.find((row) => (
      row.gateCode === "consistency-sequence-speed-recognition" &&
      row.profileId === candidateProfileIds[0]
    ));
    droppedForCandidate[0].domainSummaries = droppedForCandidate[0].domainSummaries
      .filter((row) => row !== victim);
    assert.ok(problemsOf(droppedForCandidate).some((problem) => (
      problem.includes("consistency-sequence-speed-recognition") &&
        problem.includes("the frozen corpus groups it into")
    )));

    // A losing domain dropped for every column: its traces go uncovered, which
    // is what binds the summaries to the captured corpus rather than to a count.
    const droppedEverywhere = structuredClone(record);
    droppedEverywhere[0].domainSummaries = droppedEverywhere[0].domainSummaries
      .filter((row) => !(
        row.gateCode === "consistency-sequence-speed-recognition" && row.domainId === victim.domainId
      ));
    assert.ok(problemsOf(droppedEverywhere).some((problem) => (
      problem.includes("consistency-sequence-speed-recognition") &&
        problem.includes("the frozen corpus groups it into")
    )));

    // The same traces, re-partitioned for one column only: coverage still adds
    // up, but a losing domain has been split into two rows that each look clean.
    const reCut = structuredClone(record);
    const target = reCut[0].domainSummaries.find((row) => (
      row.gateCode === "consistency-sequence-speed-recognition" &&
      row.profileId === candidateProfileIds[0] && row.traceIds.length > 1
    ));
    const half = Math.floor(target.traceIds.length / 2);
    const tail = target.traceIds.slice(half);
    target.traceIds = target.traceIds.slice(0, half);
    reCut[0].domainSummaries.push({
      ...target,
      domainId: `${target.domainId}-split`,
      traceIds: tail,
    });
    assert.ok(
      problemsOf(reCut).some((problem) => (
        problem.includes("consistency-sequence-speed-recognition") &&
          problem.includes("the frozen corpus groups it into")
      )),
      "a column re-partitioned its domains while keeping the same trace coverage",
    );

    // One domain summarised twice, so a clean row can be added beside a losing
    // one without the totals moving.
    const duplicated2 = structuredClone(record);
    duplicated2[0].domainSummaries.push({ ...duplicated2[0].domainSummaries[0] });
    assert.ok(problemsOf(duplicated2)
      .some((problem) => problem.includes("summarises one domain twice")));

    const narrowedSummaries = structuredClone(record);
    narrowedSummaries[0].domainSummaries = narrowedSummaries[0].domainSummaries
      .filter((row) => row.gateCode !== "consistency-sequence-family-breadth");
    assert.ok(
      problemsOf(narrowedSummaries)
        .some((problem) => problem.includes("summarises no domain")),
    );

    const malformedSummary = structuredClone(record);
    delete malformedSummary[0].domainSummaries[0].orderedAdvanceCount;
    assert.ok(
      problemsOf(malformedSummary)
        .some((problem) => problem.includes("not a complete measurement")),
    );

    // Complete evidence has no reason to be incomplete.
    const contradictoryCompleteness = structuredClone(record);
    contradictoryCompleteness[0].gates.incompleteEvidenceReasons = ["layer loss unreviewed"];
    assert.ok(
      problemsOf(contradictoryCompleteness).some((problem) => problem.includes("while naming")),
    );

    // A gate that claims to have passed beside the failures it recorded.
    const contradictory = structuredClone(record);
    contradictory[0].gates.candidates[0].gates[2].failures = [{
      code: contradictory[0].gates.candidates[0].gates[2].code,
      domainIds: ["tone/splendid/mf"],
      baselineValue: 0,
      candidateValue: 1,
      explanation: "a measured loss",
    }];
    const contradictoryProblems =
      problemsOf(contradictory);
    assert.ok(contradictoryProblems.some((problem) => problem.includes("beside 1 failures")));
    assert.ok(contradictoryProblems.some((problem) => problem.includes("safetyFailureCount")));

    // A gate judged on rows it may not read, and one that read fewer than a
    // complete matrix reads.
    const foreignRows = structuredClone(record);
    foreignRows[0].gates.candidates[0].gates[7].partitions = ["discovery"];
    assert.ok(problemsOf(foreignRows)
      .some((problem) => problem.includes("may not read")));

    const narrowedGate = structuredClone(record);
    narrowedGate[0].gates.candidates[0].gates[0].partitions = ["confirmation"];
    assert.ok(
      problemsOf(narrowedGate)
        .some((problem) => problem.includes("a complete matrix reads")),
    );

    // A failure that names nothing it measured.
    const emptyFailure = structuredClone(record);
    const judged = emptyFailure[0].gates.candidates[0].gates[2];
    judged.passed = false;
    judged.failures = [{ code: judged.code, domainIds: [], explanation: "" }];
    emptyFailure[0].gates.candidates[0].safetyFailureCount = 1;
    emptyFailure[0].gates.candidates[0].eligible = false;
    const emptyFailureProblems =
      problemsOf(emptyFailure);
    assert.ok(emptyFailureProblems.some((problem) => problem.includes("names no renderer")));
    assert.ok(emptyFailureProblems.some((problem) => problem.includes("explains nothing")));

    // A candidate that names an eligibility its own gate outcomes contradict.
    const selfNamed = structuredClone(record);
    const contradicted = selfNamed[0].gates.candidates[0];
    contradicted.gates[2].passed = false;
    contradicted.gates[2].failures = [{
      code: contradicted.gates[2].code,
      domainIds: ["tone/splendid/mf"],
      baselineValue: 0,
      candidateValue: 1,
      explanation: "a measured loss",
    }];
    contradicted.safetyFailureCount = 1;
    assert.ok(problemsOf(selfNamed)
      .some((problem) => problem.includes("names an eligibility its own gate outcomes contradict")));

    // Incomplete evidence, and a waiver taken after seeing a measured loss.
    const incomplete = structuredClone(record);
    incomplete[0].gates.evidenceComplete = false;
    assert.ok(problemsOf(incomplete)
      .some((problem) => problem.includes("not marked complete")));

    const waived = structuredClone(record);
    waived[0].gates.reviewedLayerLosses = [{ profileId: "early-open-v2" }];
    assert.ok(problemsOf(waived)
      .some((problem) => problem.includes("reviewed layer loss waivers")));

    // The gate set is frozen whole: one invented gate, applied and passed, is
    // not a gate set, and would otherwise clear a candidate while omitting every
    // real Task 23 gate.
    const invented = structuredClone(record);
    invented[0].gates = {
      gates: [{ code: "safety", role: "safety", domain: "isolated", label: "s", requirement: "r" }],
      candidates: candidateProfileIds.map((profileId) => ({
        profileId,
        gates: [{ code: "safety", role: "safety", domain: "isolated", applied: true, passed: true }],
      })),
    };
    assert.ok(problemsOf(invented)
      .some((problem) => problem.includes("defines gates")));

    // A complete run with a required gate unapplied fails rather than clearing.
    const unapplied = structuredClone(record);
    unapplied[0].gates.candidates[0].gates[3].applied = false;
    assert.ok(problemsOf(unapplied)
      .some((problem) => problem.includes("never applied 1 of")));
  });
});

test("the frozen corpus identity covers every field a domain is grouped on", () => {
  const rows = roundTwoCaptureIdentityRows();
  assert.equal(rows.length, 504);
  // The digest is what makes the copied metadata evidence rather than a comment.
  // Every field a gate groups on is inside it, so a corpus whose speeds, layers,
  // articulations, or evidence roles had drifted cannot keep the pin while
  // silently re-grouping every domain.
  for (const field of [
    "rendererKey",
    "partition",
    "suite",
    "evidenceRole",
    "scoreEligible",
    "sequenceFamily",
    "intervalMs",
    "piano",
    "layer",
    "caseKind",
    "articulation",
  ]) {
    const drifted = rows.map((row, index) => (
      index === 0 ? { ...row, [field]: `${row[field]}-drift` } : row
    ));
    assert.notEqual(
      capturedCorpusIdentity(drifted),
      ROUND_TWO_CONFIRMATION_MATRIX.captureIdentityDigest,
      `${field} is copied but not covered by the corpus identity`,
    );
  }
  // The fields carry real values rather than empty placeholders.
  assert.ok(rows.some(({ articulation }) => articulation.length > 0));
  assert.ok(rows.some(({ intervalMs }) => intervalMs.length > 0));
  assert.ok(rows.some(({ layer }) => layer.length > 0));
  assert.ok(rows.some(({ scoreEligible }) => scoreEligible));
  assert.ok(rows.some(({ scoreEligible }) => !scoreEligible));
});

test("dynamics layer leaves are one per constant layer, mixed run, and articulation", () => {
  const captures = roundTwoCaptureIdentityRows();
  const gate = CONFIRMATION_EVIDENCE.gates
    .find(({ code }) => code === "consistency-dynamics-layer-loss");
  const domains = roundTwoGateDomainMembership(gate, captures);
  // Every leaf is a single row, so one leaf's loss cannot be offset inside a
  // combined domain. Grouping by renderer, piano, and layer alone merged every
  // articulation sharing the default piano and layer with a constant-layer row.
  assert.ok(domains.length > 0);
  assert.deepEqual([...new Set(domains.map((group) => group.length))], [1]);
  const scoped = captures.filter((capture) => (
    gate.partitions.includes(capture.partition) &&
    ["dynamics-constant", "dynamics-mixed", "articulation"].includes(capture.suite) &&
    capture.evidenceRole === "scoring"
  ));
  assert.equal(domains.length, scoped.length);
  assert.ok(scoped.some(({ suite }) => suite === "articulation"));

  // The piano groupings exclude articulation, which has no piano leaf.
  const pianoGate = CONFIRMATION_EVIDENCE.gates
    .find(({ code }) => code === "consistency-dynamics-piano-recognition");
  const pianoTraces = new Set(
    roundTwoGateDomainMembership(pianoGate, captures).flat(),
  );
  assert.ok(scoped
    .filter(({ suite }) => suite === "articulation")
    .every(({ traceId }) => !pianoTraces.has(traceId)));
});

test("the release gates read no manifest-version-2 row, and that is enforced", async () => {
  // Task 13 froze the gate partitions against manifest version 1, where
  // `confirmation` still held the isolated and dynamics corpora. Version 2
  // re-partitioned those into discovery and regression-only and left
  // `confirmation` holding only the twelve authored paired rows, so every
  // release gate — the ones that decide whether a candidate is releasable — has
  // no held-back evidence to read. Choosing new partitions in the verifier would
  // be freezing round-two policy here, so the gap is reported instead, and no
  // completed archive can clear a candidate on those gates.
  const captures = roundTwoCaptureIdentityRows();
  const unscoped = CONFIRMATION_EVIDENCE.gates
    .filter((gate) => roundTwoGateDomainMembership(gate, captures)?.length === 0)
    .map(({ code }) => code);
  assert.deepEqual(unscoped, [
    "safety-isolated-false-advance",
    "release-isolated-recognition",
    "release-isolated-course-clear",
    "release-isolated-latency",
    "release-dynamics-piano-recognition",
    "release-dynamics-layer-loss",
  ]);

  await withStagedArchives(async ({ archives, names, candidate, candidateProfileIds }) => {
    const problems = roundTwoConfirmationMatrixProblems(
      archives.get(names[0]).record,
      "label",
      candidateProfileIds,
      {
        ...TASK28_ARTIFACT.roundTwoEligibilityManifest,
        candidateManifestDigest: candidate.digest.value,
      },
    );
    // Every one of them is named, and nothing else is wrong with this archive.
    for (const code of unscoped) {
      assert.ok(
        problems.some((problem) => (
          problem.includes(code) && problem.includes("its round-two scope is not frozen")
        )),
        `${code} was accepted as scoped`,
      );
    }
    assert.equal(problems.length, unscoped.length);
  });
});

test("completed entries are re-derived from the archives, not read from the manifest", async () => {
  await withStagedArchives(async ({
    archives,
    names,
    candidate,
    candidateProfileIds,
    confirmationEvidence,
  }) => {
    const pins = TASK28_ARTIFACT.roundTwoEligibilityManifest;
    const record = archives.get(names[0]).record;
    const [derived] = rederiveRoundTwoEligibilityEntries(record, candidateProfileIds, pins);
    // The staged matrix resolves every group on the real attack, and its
    // confirmation groups reproduce, so the labels follow from the measurements.
    // Eligibility is nonetheless false: six gates have no frozen round-two
    // scope, and an absent failure from a gate that read no row is not evidence
    // of safety. The derivation must not contradict the rule that no completed
    // run can clear a candidate on an unscoped gate.
    assert.ok(roundTwoUnfrozenGateScopes().length > 0);
    assert.deepEqual(derived, {
      profileId: "early-open-v2",
      automatedEligible: false,
      repeatedRecoveryOutcome: "confirmed-full-resolution",
      confirmationReproductionStatus: "reproduced",
    });

    const artifact = {
      ...TASK28_COMPLETED_ARTIFACT,
      roundTwoEligibilityManifest: {
        ...TASK28_COMPLETED_ARTIFACT.roundTwoEligibilityManifest,
        candidateManifestDigest: candidate.digest.value,
      },
    };
    // The round's real Task 26 archives rerun to the zero branch, so a staged
    // completed chain necessarily disagrees with them and with this artifact's
    // not-run digest pin. Those are the verifier working, not the rules under
    // test, so they are filtered and the completed rules asserted on their own.
    const STAGING_ARTEFACTS = [
      "recomputed digest",
      "digest ",
      "reruns to reason",
      "reruns to ablation",
      // Task 13 froze the gate partitions against manifest version 1. Under
      // version 2 the release gates read no row, which the verifier reports and
      // which no archive can fix; it is asserted directly by its own test.
      "its round-two scope is not frozen",
    ];
    const task26 = await task27Evidence();
    const problemsFor = (entries) => roundTwoEligibilityManifestProblems(
      artifact,
      completedRecord({
        candidateManifestDigest: candidate.digest.value,
        confirmationEvidence,
        entries,
      }),
      candidate,
      task26,
      archives,
    ).filter((problem) => !STAGING_ARTEFACTS.some((noise) => problem.includes(noise)));

    const truthful = {
      ...derived,
      rejectionReasons: derived.automatedEligible ? [] : ["unfrozen-round-two-gate-scope"],
    };
    assert.deepEqual(problemsFor([truthful]), []);

    // A self-reported label the measurements do not produce, whichever label the
    // staged measurements happen to produce.
    const otherOutcome = derived.repeatedRecoveryOutcome === "confirmed-full-resolution"
      ? "material-partial-recovery"
      : "confirmed-full-resolution";
    assert.ok(problemsFor([{
      ...truthful,
      repeatedRecoveryOutcome: otherOutcome,
    }]).some((problem) => problem.includes("re-derives repeatedRecoveryOutcome")));

    // Self-reported eligibility over a candidate the evidence rejects.
    assert.ok(problemsFor([{
      ...truthful,
      confirmationReproductionStatus: "inconclusive-no-reproduction",
    }]).some((problem) => problem.includes("re-derives confirmationReproductionStatus")));

    // And a manifest that claims eligibility the derivation withholds.
    assert.ok(problemsFor([{ ...truthful, automatedEligible: true, rejectionReasons: [] }])
      .some((problem) => problem.includes("re-derives automatedEligible")));
  });
});

test("an incomplete archive is refused through the manifest, not only in isolation", async () => {
  // The counterexample end to end: two identical files that are not a matrix,
  // named by an otherwise well-formed completed manifest. The manifest path must
  // refuse them, or the archive contract would only exist in its own unit test.
  await withStagedArchives(
    async ({ archives, candidate, confirmationEvidence }) => {
      const artifact = {
        ...TASK28_COMPLETED_ARTIFACT,
        roundTwoEligibilityManifest: {
          ...TASK28_COMPLETED_ARTIFACT.roundTwoEligibilityManifest,
          candidateManifestDigest: candidate.digest.value,
        },
      };
      const problems = roundTwoEligibilityManifestProblems(
        artifact,
        completedRecord({
          candidateManifestDigest: candidate.digest.value,
          confirmationEvidence,
          entries: [{
            profileId: "early-open-v2",
            automatedEligible: true,
            rejectionReasons: [],
            repeatedRecoveryOutcome: "confirmed-full-resolution",
            confirmationReproductionStatus: "reproduced",
          }],
        }),
        candidate,
        await task27Evidence(),
        archives,
      );
      // Both archives are reported, and the labels are never re-derived from a
      // record that is not the matrix.
      for (const field of ["runOneArchive", "runTwoArchive"]) {
        assert.ok(
          problems.some((problem) => (
            problem.includes(field) && problem.includes("captured traces")
          )),
          `${field} was accepted as a confirmation matrix`,
        );
      }
    },
    () => [{ name: "listen-profile-validation" }],
  );
});

test("a confirmation run in which nothing reproduced withholds full resolution", async () => {
  await withStagedArchives(
    async ({ archives, names, candidateProfileIds }) => {
      const [derived] = rederiveRoundTwoEligibilityEntries(
        archives.get(names[0]).record,
        candidateProfileIds,
        TASK28_ARTIFACT.roundTwoEligibilityManifest,
      );
      // The confirmation groups were decoded and are structurally valid, but no
      // baseline reproduced the phenomenon, so the round learned nothing from
      // them about resolution and may not claim it did.
      assert.equal(derived.confirmationReproductionStatus, "inconclusive-no-reproduction");
      assert.equal(derived.repeatedRecoveryOutcome, "discovery-full-resolution");
      // False for the unfrozen-scope reason above, not for anything this
      // archive did.
      assert.equal(derived.automatedEligible, false);
    },
    (digest, candidateProfileIds) => {
      const archive = stagedMatrixArchive(digest, candidateProfileIds);
      const confirmationGroupIds = new Set(
        ROUND_TWO_CONFIRMATION_MATRIX.repeatedChordCensus
          .filter(({ evidenceRole }) => evidenceRole === "confirmation")
          .map(({ groupId }) => groupId),
      );
      archive[0].baselineRepeatedMeasurements = archive[0].baselineRepeatedMeasurements
        .map((row) => (confirmationGroupIds.has(row.groupId)
          ? {
            ...row,
            observation: {
              ...row.observation,
              laterIdenticalAttackRecoveredCorrectTarget: false,
              sourceDistance: null,
              attributionDelayMs: null,
            },
          }
          : row));
      return archive;
    },
  );
});

test("a candidate the gates failed cannot be re-derived as eligible", async () => {
  await withStagedArchives(
    async ({ archives, names, candidateProfileIds }) => {
      const record = archives.get(names[0]).record;
      const [derived] = rederiveRoundTwoEligibilityEntries(
        record,
        candidateProfileIds,
        TASK28_ARTIFACT.roundTwoEligibilityManifest,
      );
      // The repeated-chord evidence is unchanged and clean, so the labels still
      // say full resolution; eligibility is not those labels, and one failed
      // gate withdraws it.
      assert.equal(derived.repeatedRecoveryOutcome, "confirmed-full-resolution");
      assert.equal(derived.automatedEligible, false);
    },
    (digest, candidateProfileIds) => {
      // The failure is measured, not merely reported: the candidate's ordered
      // advances fall below the incumbent's on one domain, which is what
      // consistency-sequence-ordered-progress compares.
      const archive = stagedMatrixArchive(digest, candidateProfileIds);
      const regressed = archive[0].domainSummaries.find((row) => (
        row.gateCode === "consistency-sequence-ordered-progress" &&
        row.profileId === candidateProfileIds[0]
      ));
      regressed.orderedAdvanceCount = 0;
      archive[0].gates = stagedGates(
        candidateProfileIds,
        (_profileId, code) => code !== "consistency-sequence-ordered-progress",
      );
      return archive;
    },
  );
});

test("a candidate with no gate record is ineligible rather than unjudged", async () => {
  await withStagedArchives(
    async ({ archives, names, candidateProfileIds }) => {
      const [derived] = rederiveRoundTwoEligibilityEntries(
        archives.get(names[0]).record,
        candidateProfileIds,
        TASK28_ARTIFACT.roundTwoEligibilityManifest,
      );
      // An absent outcome is not a pass.
      assert.equal(derived.automatedEligible, false);
    },
    (digest, candidateProfileIds) => stagedMatrixArchive(digest, candidateProfileIds, {
      gates: { gates: CONFIRMATION_EVIDENCE.gates.map((gate) => ({ ...gate })), candidates: [] },
    }),
  );
});

test("a relabelled or unchained eligibility manifest is refused", async () => {
  const [eligibility, candidate, evidence] = await Promise.all([
    task28Manifest(),
    task27Manifest(),
    task27Evidence(),
  ]);
  const problemsFor = (record, chainTo = candidate) =>
    roundTwoEligibilityManifestProblems(TASK28_ARTIFACT, record, chainTo, evidence);

  // Relabelling one zero-branch form as the other disagrees with Task 27 and
  // with the rerun, even though the record's own digest still verifies.
  const relabelled = withRecomputedDigest({
    ...eligibility,
    reason: "no-supported-parameterization",
  });
  const relabelledProblems = problemsFor(relabelled);
  assert.ok(relabelledProblems.some((problem) => problem.includes("not-run reason")));
  assert.ok(relabelledProblems.some((problem) => (
    problem.includes("the candidate manifest records")
  )));
  assert.ok(relabelledProblems.some((problem) => problem.includes("reruns to reason")));

  // A dangling link: the digest it chains to is not what that record hashes to.
  assert.ok(problemsFor(withRecomputedDigest({
    ...eligibility,
    candidateManifestDigest: "00000000",
  })).some((problem) => problem.includes("chains to candidate manifest")));

  // A field moved under a digest that was not recomputed.
  assert.ok(problemsFor({ ...eligibility, task26EvidenceDigest: "00000000" })
    .some((problem) => problem.includes("recomputed digest")));

  // A candidate manifest that registered profiles does not take this branch.
  const registered = { ...candidate, candidateProfileIds: ["early-open-v2"] };
  assert.ok(problemsFor(eligibility, withRecomputedDigest(registered))
    .some((problem) => problem.includes("registered nothing")));

  // Round-two completeness: a round-one manifest version cannot be quoted here.
  const roundOne = withRecomputedDigest({
    ...candidate,
    traceManifestVersion: 1,
    traceManifestHash: "0ed1e71d",
  });
  const roundOneProblems = problemsFor(eligibility, roundOne);
  assert.ok(roundOneProblems.some((problem) => problem.includes("traceManifestVersion")));
  assert.ok(roundOneProblems.some((problem) => problem.includes("chains to candidate manifest")));
});

test("the stray-archive prohibition belongs to the not-run branch alone", () => {
  const manifestFile = "listen-round-two-eligibility-manifest-task28.json";
  const notRun = "not-run-no-confirmable-candidate";
  assert.deepEqual(
    roundTwoConfirmationArchiveProblems(
      ["README.md", manifestFile, "listen-round-two-candidate-manifest-task27.json"],
      TASK28_ARTIFACT.path,
      notRun,
    ),
    [],
  );
  assert.ok(roundTwoConfirmationArchiveProblems(
    [manifestFile, "listen-profile-validation-task28-run1.json"],
    TASK28_ARTIFACT.path,
    notRun,
  )[0].includes("listen-profile-validation-task28-run1.json"));

  // A completed round is required to produce exactly those archives, so applying
  // the prohibition to it would reject the evidence the branch exists to record.
  assert.deepEqual(
    roundTwoConfirmationArchiveProblems(
      [
        manifestFile,
        "listen-profile-validation-task28-run1.json",
        "listen-profile-validation-task28-run2.json",
      ],
      TASK28_ARTIFACT.path,
      "completed",
    ),
    [],
  );
});

test("the zero branch may not leave a search archive behind", () => {
  const manifestFile = "listen-round-two-candidate-manifest-task27.json";
  assert.deepEqual(
    roundTwoSearchArchiveProblems(
      ["README.md", manifestFile, "listen-round-two-ablation-task26-run1.json"],
      TASK27_ARTIFACT.path,
    ),
    [],
  );
  assert.ok(roundTwoSearchArchiveProblems(
    [manifestFile, "listen-round-two-search-task27-run1.json"],
    TASK27_ARTIFACT.path,
  )[0].includes("listen-round-two-search-task27-run1.json"));
});

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
