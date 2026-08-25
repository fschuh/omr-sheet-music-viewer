import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const EVIDENCE_ARTIFACTS = [
  {
    name: "Task 08 discovery/regression sweep",
    path: "benchmark-results/listen-matcher-multidomain-sweep-task08.json",
    fileSha256: "fa09a935ee36b14786659933152bed65498b7433007f888104f79357b7050aeb",
    candidateArchiveDigest: "53ee8a67",
    candidateCount: 1_000,
  },
  {
    name: "Task 24 per-domain control archive",
    path: "benchmark-results/listen-matcher-domain-archive-task24.json",
    fileSha256: "adf66cb52f7f6c62c99d722f0d4b04ecb89a41ba66770d38542e995385798a43",
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
  },
  {
    name: "Task 10 sequence validation",
    path: "benchmark-results/listen-sequence-profile-validation-task10.json",
    fileSha256: "e969060b9011d86f1eb7cbb551077fbff69d03a8b01d4b548f499eaba51c927e",
    evidenceSha256: "ed9a336516a26fa2daf6a67314138a47a47beafdc7c20ce86fbe90d5ff11acd0",
    omittedFields: new Set(["maximumInferenceMs"]),
    serializedLateAdvanceCount: 18,
    profileLateAdvanceCount: 18,
  },
  {
    name: "Task 11 dynamics/articulation validation",
    path: "benchmark-results/listen-dynamics-profile-validation-task11.json",
    fileSha256: "1028cd52275c1c91838c8b920ef2d90324ff180b38a88096dba6408970890042",
    evidenceSha256: "8b5039ac0fe0d5396cd02ee626800c075f3dffa101abd6579827d289570a0bc6",
    omittedFields: new Set(["maximumInferenceMs", "peak", "rms"]),
    serializedLateAdvanceCount: 34,
    profileLateAdvanceCount: 25,
  },
  {
    name: "Task 26 staged round-two ablations (run 1)",
    path: "benchmark-results/listen-round-two-ablation-task26-run1.json",
    fileSha256: "271b673a9696c449b7c3e91b4298b22a3d83b927a890643f2d62eb2ae20f0fc7",
    /**
     * What makes this file the staged search rather than one grid run in
     * isolation. Every ablation it contains must be the frozen generator's own
     * grid, must have been authorised by the recorded verdict of the ablation
     * before it, and must report per-run repeated-chord evidence for every
     * profile it selected; the terminal outcome is recomputed from those
     * verdicts rather than read from the file.
     */
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
      /** Task 24's frozen comparison boundaries, restated so they can be applied here. */
      repeatedRecoveryBoundaries: {
        sourceDistanceNoRegression: 0,
        attributionDelayNoRegressionMs: 32,
        sourceDistanceMaterialGain: 1,
        attributionDelayMaterialGainMs: 500,
      },
      domainRegretMaterialBoundary: 0.01,
      /** The three groups the hashed policy names; full resolution is read against them. */
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
  },
  {
    name: "Task 26 staged round-two ablations (run 2)",
    path: "benchmark-results/listen-round-two-ablation-task26-run2.json",
    fileSha256: "0766dd023a72a8859aa0eb415650f0f36ecf2952daad4181a8647b4b6b480707",
    /**
     * What makes this file the staged search rather than one grid run in
     * isolation. Every ablation it contains must be the frozen generator's own
     * grid, must have been authorised by the recorded verdict of the ablation
     * before it, and must report per-run repeated-chord evidence for every
     * profile it selected; the terminal outcome is recomputed from those
     * verdicts rather than read from the file.
     */
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
      /** Task 24's frozen comparison boundaries, restated so they can be applied here. */
      repeatedRecoveryBoundaries: {
        sourceDistanceNoRegression: 0,
        attributionDelayNoRegressionMs: 32,
        sourceDistanceMaterialGain: 1,
        attributionDelayMaterialGainMs: 500,
      },
      domainRegretMaterialBoundary: 0.01,
      /** The three groups the hashed policy names; full resolution is read against them. */
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
  },
  {
    name: "Task 27 round-two candidate manifest",
    path: "benchmark-results/listen-round-two-candidate-manifest-task27.json",
    fileSha256: "4016355ba98cdd4962f7196dbb7f75f8c1fc49bb3be9ef3f1ea66f1f0b701a9e",
    /**
     * The first link of the round-two artifact chain, and the only Task 27 file.
     *
     * Every field below is pinned, but the record is not accepted because it
     * matches them: the branch it took, the reason code it carries, the ablation
     * it names, and the Task 26 digest it references are all re-derived from the
     * committed Task 26 archives by rerunning the frozen stop rule over their
     * archived measurements, so a manifest that merely states the round's result
     * fails here.
     */
    roundTwoCandidateManifest: {
      name: "listen-round-two-candidate-manifest",
      formatVersion: 1,
      roundId: "round-two",
      candidateProfileIds: [],
      registryVersion: 2,
      /**
       * The identity of the registry generation the search measured against.
       *
       * The zero branch registers nothing, so this must be the whole generation's
       * digest — version, default, shared fixed policy, and every profile's
       * thresholds in registry order — and not the version number, which a moved
       * `v1` threshold or an added non-`v3` entry would leave untouched.
       */
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
      /** Both archived repetitions must independently re-derive this manifest. */
      evidencePaths: [
        "benchmark-results/listen-round-two-ablation-task26-run1.json",
        "benchmark-results/listen-round-two-ablation-task26-run2.json",
      ],
      /** Task 24's frozen boundaries, restated so the stop rule can be rerun here. */
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
  },
  {
    name: "Task 28 round-two eligibility manifest",
    path: "benchmark-results/listen-round-two-eligibility-manifest-task28.json",
    fileSha256: "3c0ac0571d04ec8a453558fec9fd1ab6ae84c8377ffcfb55e499cf221219e7ce",
    /**
     * The second link of the round-two artifact chain.
     *
     * The round took the not-run branch, so this file records that the
     * confirmation matrix never ran and the version-2 confirmation fixtures were
     * never decoded. Every value below is pinned, and none of them is accepted
     * because it matches: the branch, the reason, the terminal outcome, and the
     * candidate-manifest digest are all re-derived from the committed Task 26
     * archives and the Task 27 record, so an eligibility manifest that merely
     * states the round's result fails here.
     *
     * The completeness pins are the round's own — registry version 2, manifest
     * version 2 at `d1971fa3`, the version-2 trace census, policy version 1, and
     * the Task 27 digest — so neither a round-one archive nor a narrowed smoke
     * can be quoted as this task's evidence.
     */
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
      /**
       * The corpus this branch's central claim is measured against.
       *
       * `traceCount` is pinned as well as compared to `decodedTraceCount`,
       * because `decodedTraceCount === traceCount` is satisfied by an empty
       * partition too, and a completed run over no fixtures is not a
       * confirmation. `traceIdentityHash` covers every confirmation row's
       * identifier, rendered-content key, musical input, and authored pair, so
       * rows renamed or re-pointed at other content fail at the same count.
       * `traceGenerationHash` covers the whole generation those rows live in,
       * with the confirmation partition's decode state normalized out, so one pin
       * describes both branches: decoding the fixtures is what the completed
       * branch does, and folding that into the generation's identity would make
       * the pin unsatisfiable by any real completed run.
       */
      confirmationPartition: {
        traceCount: 12,
        decodedTraceCount: 0,
        priorLedgerHash: "1f9613bd",
        traceGenerationHash: "d1971fa3",
        traceIdentityHash: "a5695acc",
      },
      /** Round-two completeness. A round-one artifact fails every one of these. */
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
      candidateManifestPath:
        "benchmark-results/listen-round-two-candidate-manifest-task27.json",
      /** Both repetitions must independently rerun to the chain this references. */
      evidencePaths: [
        "benchmark-results/listen-round-two-ablation-task26-run1.json",
        "benchmark-results/listen-round-two-ablation-task26-run2.json",
      ],
      /** Task 24's frozen boundaries, restated so the stop rule can be rerun here. */
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
  },
  {
    name: "Task 29 round-two approved-profile list",
    path: "benchmark-results/listen-round-two-approved-profiles-task29.json",
    fileSha256: "c71624cefb4db1f5ac7b0981ca4e62f3756dbd999d279ff6718c7ae7bc346873",
    /**
     * The third and last link of the round-two artifact chain.
     *
     * The round approved no candidate, so the list is exactly the measured
     * incumbent and the default is unchanged. These are the pins this repository
     * ships; the checks that read them recompute the membership, the bounded
     * outcome, the ablation record, and every digest link from the artifacts
     * themselves, because a decision that only agrees with itself is not
     * auditable.
     */
    roundTwoApprovedProfiles: {
      name: "listen-round-two-approved-profiles",
      formatVersion: 1,
      roundId: "round-two",
      outcome: "round-two-grid-produced-no-eligible-improvement",
      reason: "no-ablation-accepted",
      selectedDefaultProfileId: "baseline-v1",
      eligibilityRunStatus: "not-run-no-confirmable-candidate",
      eligibilityManifestDigest: "20be9d6d",
      candidateManifestDigest: "21655efa",
      task26TerminalOutcome: "bass-axis-unsupported",
      task26EvidenceDigest: "8dfe2f1b",
      digest: "dbf777ba",
      /** The residual is carried by this file, referenced by its content digest. */
      modelEvidenceRequirementPath: "plans/listen-decoder-model-evidence-requirement.md",
      eligibilityManifestPath:
        "benchmark-results/listen-round-two-eligibility-manifest-task28.json",
      candidateManifestPath:
        "benchmark-results/listen-round-two-candidate-manifest-task27.json",
      /** Both repetitions must independently rerun to the chain this concludes. */
      evidencePaths: [
        "benchmark-results/listen-round-two-ablation-task26-run1.json",
        "benchmark-results/listen-round-two-ablation-task26-run2.json",
      ],
      /** Task 24's frozen boundaries, restated so the stop rule can be rerun here. */
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
  },
  {
    name: "Task 22 bass-onset and repeated-chord qualification",
    path: "benchmark-results/listen-bass-qualification-task22.json",
    fileSha256: "3b7085969a15242ff06b6a9fc58de72882626609c1e816a3dc7d7cb6c318279e",
    /**
     * What makes this file the measurement rather than a focused smoke of it.
     * A narrowed run reports fewer traces and marks its corpus incomplete, and
     * both are checked here, because a partial distribution quoted as the corpus
     * distribution is the failure this artifact is most exposed to.
     */
    bassQualification: {
      name: "listen-bass-qualification",
      manifestVersion: 1,
      manifestHash: "0ed1e71d",
      manifestCorpusHash: "10ae2e0b",
      capturedTraceCount: 445,
      profileColumnCount: 21,
      counterfactualColumnCount: 16,
      /** Every counterfactual holds the fresh-onset gate at the incumbent's value. */
      counterfactualOnsetThreshold: 0.6,
      repeatedChordPitches: [62, 74, 82],
      repeatedChordTraceIds: [
        "dynamics-constant/tone/salamander/v05",
        "dynamics-constant/tone/salamander/v13",
        "dynamics-mixed/tone/salamander",
      ],
      pinnedOmittedBass: [
        {
          traceId: "isolated/direct/122",
          recognitionStructureHash: "56d57ace",
          bassMidi: 48,
        },
        {
          traceId: "isolated/tone/124",
          recognitionStructureHash: "c80411e6",
          bassMidi: 56,
        },
      ],
    },
  },
];

/**
 * The frozen Task 13 confirmation matrix, as an archived repetition must show it.
 *
 * The comparison below is only meaningful between two complete runs of this one
 * matrix. Without this contract the mode compared any two JSON files, so two
 * archives of the same focused smoke — which narrows corpora and can therefore
 * reject a candidate but never clear one — would have matched and been quoted as
 * the confirmation evidence. Every value here is fixed before the first run, so
 * a file that fails it is the wrong file rather than a new result.
 */
export const CONFIRMATION_EVIDENCE = {
  /** The unified command's own name. The renderer-scoped and summary variants
   * measure less than the frozen matrix and are refused by name. */
  name: "listen-profile-validation",
  manifestVersion: 1,
  manifestHash: "0ed1e71d",
  manifestCorpusHash: "10ae2e0b",
  registryVersion: 2,
  /** Task 13 predates Task 23 and is required to carry no policy-version field. */
  policyVersion: null,
  baselineProfileId: "baseline-v1",
  candidateProfileIds: ["early-open-v2", "steady-open-v2", "early-held-v2", "steady-held-v2"],
  rendererKeys: ["direct", "tone"],
  /**
   * Each domain's corpus size and the suites its trace identifiers name. A
   * manifest trace is `<suite>/<renderer>/...`, so the identifiers say which
   * corpus was captured and under which renderer, and are checked rather than
   * accepted as whatever the archive happened to write.
   */
  domains: [
    {
      domain: "isolated",
      capturedTraceCount: 268,
      suites: ["isolated"],
      partitions: ["confirmation"],
      evidenceRole: "confirmation",
    },
    {
      domain: "sequence",
      capturedTraceCount: 156,
      suites: ["sequence"],
      partitions: ["discovery", "regression-only"],
      evidenceRole: null,
    },
    {
      domain: "dynamics",
      capturedTraceCount: 52,
      suites: ["dynamics-constant", "dynamics-mixed", "articulation"],
      partitions: ["confirmation", "discovery", "regression-only"],
      evidenceRole: null,
    },
  ],
  /**
   * The registry-2 threshold values every column was measured under. The
   * identifiers alone are not the evidence: a profile whose values moved would
   * report the same name over different measurements, which is exactly what the
   * registry version exists to prevent and therefore has to be checked beside it.
   */
  profiles: {
    "baseline-v1": {
      onsetThreshold: 0.6,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.35,
      extraNoteThreshold: 0.97,
      requireFreshBassOnset: true,
    },
    "early-open-v2": {
      onsetThreshold: 0.45,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.2,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    "steady-open-v2": {
      onsetThreshold: 0.5,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.2,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    "early-held-v2": {
      onsetThreshold: 0.45,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.275,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
    "steady-held-v2": {
      onsetThreshold: 0.5,
      targetNoteThreshold: 0.5,
      activeTargetThreshold: 0.275,
      extraNoteThreshold: 0.99,
      requireFreshBassOnset: true,
    },
  },
  /**
   * The eighteen frozen gates, exactly as the archived report must define them,
   * each with the rows a complete matrix reads for it.
   *
   * The gate list is the standard both repetitions were judged against, so it is
   * part of the evidence rather than context around it: a report that dropped a
   * gate would show every candidate clearing every gate it still had, and one
   * whose requirement was quietly reworded would be judged against a different
   * rule than the one this task froze. `listenProfileValidationBenchmark.test.ts`
   * holds this copy to the definitions the benchmark actually applies.
   */
  gates: [
  {
    code: "replay-trace-reuse",
    partitions: ["confirmation", "discovery", "regression-only"],
    role: "replay-integrity",
    domain: "cross-domain",
    label: "One capture per run, replayed by every profile",
    requirement: "Within each captured run, all compared profiles use the identical PCM, " +
      "decoded trace, frame count, renderer, model, and target schedule.",
  },
  {
    code: "replay-baseline-parity",
    partitions: ["confirmation", "discovery", "regression-only"],
    role: "replay-integrity",
    domain: "cross-domain",
    label: "Baseline replay is event-for-event identical",
    requirement: "Every baseline-v1 row reproduces its capture-time replay exactly.",
  },
  {
    code: "safety-isolated-false-advance",
    partitions: ["confirmation"],
    role: "safety",
    domain: "isolated",
    label: "No distinguishable false advance on the isolated corpus",
    requirement: "Dedicated distinguishable-wrong, extra-note, and omitted-bass fixtures never " +
      "advance. Ambiguous harmonic cases are reported separately and never hide " +
      "one.",
  },
  {
    code: "safety-sequence-dedicated-families",
    partitions: ["regression-only"],
    role: "safety",
    domain: "sequence",
    label: "Dedicated safety families stay at zero at every speed",
    requirement: "False, skipped, duplicate, and incomplete-carried-bass counts remain zero at " +
      "every speed under both renderers. Fresh bass remains required.",
  },
  {
    code: "safety-sequence-introduced-advance",
    partitions: ["discovery", "regression-only"],
    role: "safety",
    domain: "sequence",
    label: "No new unsafe advance in an ordinary passage",
    requirement: "No candidate adds a false, skipped, or duplicate advance to any sequence row " +
      "relative to baseline-v1 on the identical trace, including the scored " +
      "passages that belong to no dedicated safety family.",
  },
  {
    code: "safety-dynamics-introduced-advance",
    partitions: ["confirmation", "discovery", "regression-only"],
    role: "safety",
    domain: "dynamics",
    label: "No new unsafe advance in a dynamics or articulation run",
    requirement: "No candidate adds a false, skipped, or duplicate advance to any dynamics or " +
      "articulation run relative to baseline-v1 on the identical trace.",
  },
  {
    code: "safety-committed-regression",
    partitions: ["regression-only"],
    role: "safety",
    domain: "regression",
    label: "The diagnosed regressions do not worsen",
    requirement: "The Tone plus Salamander v05 case keeps zero false, skipped, and duplicate " +
      "advances and stays a late-advance recovery; the Tone 333 ms false case does " +
      "not worsen.",
  },
  {
    code: "release-isolated-recognition",
    partitions: ["confirmation"],
    role: "release",
    domain: "isolated",
    label: "Isolated correct advancement holds its fixed floor",
    requirement: "Direct remains at least 104/106 overall; Tone reaches at least 101/106.",
  },
  {
    code: "release-isolated-course-clear",
    partitions: ["confirmation"],
    role: "release",
    domain: "isolated",
    label: "Course Clear advancement holds its fixed floor",
    requirement: "Both renderers remain at least 52/54 on the Course Clear fixtures.",
  },
  {
    code: "release-isolated-latency",
    partitions: ["confirmation"],
    role: "release",
    domain: "isolated",
    label: "P95 onset-to-advance latency stays inside its limit",
    requirement: "P95 remains below 400 ms for each renderer and does not materially regress " +
      "from its paired baseline.",
  },
  {
    code: "release-dynamics-piano-recognition",
    partitions: ["confirmation"],
    role: "release",
    domain: "dynamics",
    label: "Held-back renderer and piano recognition is preserved",
    requirement: "Each renderer and piano aggregate over confirmation rows preserves or " +
      "improves independent recognition.",
  },
  {
    code: "release-dynamics-layer-loss",
    partitions: ["confirmation"],
    role: "release",
    domain: "dynamics",
    label: "No held-back layer loses more than one independent event",
    requirement: "No individual confirmation layer, mixed run, or articulation loses more than " +
      "one independent event without an explicit reviewed explanation.",
  },
  {
    code: "consistency-sequence-speed-recognition",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "sequence",
    label: "Independent recognition does not fall at any speed",
    requirement: "Independent recognition does not decrease at any speed under either " +
      "renderer.",
  },
  {
    code: "consistency-sequence-ordered-progress",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "sequence",
    label: "Ordered advances and complete passages hold per renderer",
    requirement: "Ordered advances and complete passages improve or remain equal under each " +
      "renderer separately; a Direct gain cannot hide a Tone regression.",
  },
  {
    code: "consistency-sequence-family-breadth",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "sequence",
    label: "An improvement spans more than one sequence family",
    requirement: "Improvement, netted per family across both renderers, is present in more " +
      "than one sequence family, and at least one family whose ordered advances " +
      "rose also recognized more events independently, so the gain is not cascade " +
      "amplification following one recovered early event.",
  },
  {
    code: "consistency-sequence-latency",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "sequence",
    label: "Continuous latency stays within existing limits",
    requirement: "The p95 ordered-advance latency does not materially regress from its paired " +
      "baseline under either renderer.",
  },
  {
    code: "consistency-dynamics-piano-recognition",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "dynamics",
    label: "Discovery renderer and piano recognition is preserved",
    requirement: "Each renderer and piano aggregate over discovery rows preserves or improves " +
      "independent recognition.",
  },
  {
    code: "consistency-dynamics-layer-loss",
    partitions: ["discovery"],
    role: "discovery-consistency",
    domain: "dynamics",
    label: "No discovery layer loses more than one independent event",
    requirement: "No individual discovery layer, mixed run, or articulation loses more than " +
      "one independent event without an explicit reviewed explanation.",
  },
  ],
};

/**
 * Task 23's corpus-independent policy, restated in the archive reader.
 *
 * The browser implementation owns the live decision. This copy exists so the
 * two immutable Task 13 JSON files can be re-scored without rebuilding or
 * re-running the browser code that produced them. A webapp unit test keeps the
 * version, rates, rounding rule, and material boundaries equal to the policy
 * module.
 */
export const ROUND_TWO_POLICY_EVIDENCE = Object.freeze({
  version: 1,
  targetCountRounding: "ceiling",
  recognitionTargetRates: Object.freeze({
    direct: Object.freeze({ isolatedCorrectAdvanceRate: 0.98, courseClearCorrectAdvanceRate: 0.95 }),
    tone: Object.freeze({ isolatedCorrectAdvanceRate: 0.95, courseClearCorrectAdvanceRate: 0.95 }),
  }),
  materialImprovement: Object.freeze({
    minimumRateGain: 0.01,
    rateComparisonEpsilon: 1e-12,
    minimumLatencyReductionMs: 32,
    latencyComparisonEpsilonMs: 1e-9,
    minimumUnsafeEventReduction: 1,
  }),
  safetyGatesAreAbsolute: true,
  correctnessEligibility: "paired-non-regression",
  absoluteTargetsAre: "product-debt",
  completeRunsFailClosed: true,
});

function roundTwoTargetAssessment(rendererKey, metric, observedCount, census) {
  const rates = ROUND_TWO_POLICY_EVIDENCE.recognitionTargetRates[rendererKey];
  const targetRate = metric === "isolated-correct-advance-rate"
    ? rates.isolatedCorrectAdvanceRate
    : rates.courseClearCorrectAdvanceRate;
  const targetCount = Math.ceil(targetRate * census);
  const observedRate = census === 0 ? 0 : observedCount / census;
  return {
    rendererKey,
    metric,
    targetRate,
    census,
    targetCount,
    observedCount,
    observedRate,
    reached: observedCount >= targetCount,
    debtCount: Math.max(0, targetCount - observedCount),
    debtRate: Math.max(0, targetRate - observedRate),
  };
}

function roundTwoMaterialRate(id, baselineRate, profileRate) {
  const improvement = profileRate - baselineRate;
  return {
    id,
    kind: "rate-gain",
    baselineValue: baselineRate,
    profileValue: profileRate,
    improvement,
    threshold: ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumRateGain,
    material: improvement + ROUND_TWO_POLICY_EVIDENCE.materialImprovement.rateComparisonEpsilon >=
      ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumRateGain,
  };
}

function roundTwoMaterialLatency(id, baselineMs, profileMs) {
  const improvement = baselineMs - profileMs;
  return {
    id,
    kind: "latency-reduction",
    baselineValue: baselineMs,
    profileValue: profileMs,
    improvement,
    threshold: ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumLatencyReductionMs,
    material: improvement +
      ROUND_TWO_POLICY_EVIDENCE.materialImprovement.latencyComparisonEpsilonMs >=
      ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumLatencyReductionMs,
  };
}

function roundTwoMaterialUnsafeEvents(id, baselineCount, profileCount) {
  const improvement = baselineCount - profileCount;
  return {
    id,
    kind: "unsafe-event-reduction",
    baselineValue: baselineCount,
    profileValue: profileCount,
    improvement,
    threshold: ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumUnsafeEventReduction,
    material: improvement >=
      ROUND_TWO_POLICY_EVIDENCE.materialImprovement.minimumUnsafeEventReduction,
  };
}

function roundTwoUnsafeEventCount(run, profileId) {
  const find = (renderer) => renderer.profiles
    .find((profile) => profile.profileId === profileId);
  const isolated = run.isolated.renderers.reduce((total, renderer) => (
    total + find(renderer).distinguishableFalseAdvanceCount
  ), 0);
  const sequence = run.sequence.renderers.reduce((total, renderer) => {
    const profile = find(renderer);
    return total + profile.totals.falseAdvanceCount + profile.totals.skippedAdvanceCount +
      profile.totals.duplicateAdvanceCount + profile.regressionTotals.falseAdvanceCount +
      profile.regressionTotals.skippedAdvanceCount + profile.regressionTotals.duplicateAdvanceCount;
  }, 0);
  const dynamics = run.dynamics.renderers.reduce((total, renderer) => {
    const profile = find(renderer);
    return total + profile.safety.falseAdvanceCount + profile.safety.skippedAdvanceCount +
      profile.safety.duplicateAdvanceCount;
  }, 0);
  return isolated + sequence + dynamics;
}

/**
 * Re-scores one complete Task 13 archive under Task 23 without re-measurement.
 *
 * The old report remains unchanged and verifiable under the rule it actually
 * ran. This adjacent result removes only the two challenger-only absolute floor
 * failures, recomputes paired isolated correctness from the archived profile
 * rows, reports the old targets as product debt for every column, and keeps
 * every safety/replay/consistency rejection exactly as recorded.
 */
export function rescoreTask13ArchiveUnderRoundTwoPolicy(result, label = "Task 13 archive") {
  const problems = confirmationEvidenceProblems(result, label);
  if (problems.length > 0) {
    throw new Error(`Cannot re-score an incomplete Task 13 archive:\n  ${problems.join("\n  ")}`);
  }
  const run = result[0];
  const isolatedByRenderer = new Map(run.isolated.renderers
    .map((renderer) => [renderer.rendererKey, renderer]));
  const sequenceByRenderer = new Map(run.sequence.renderers
    .map((renderer) => [renderer.rendererKey, renderer]));
  const dynamicsByRenderer = new Map(run.dynamics.renderers
    .map((renderer) => [renderer.rendererKey, renderer]));
  const profileSummary = (renderer, profileId) => {
    const profile = renderer.profiles.find((entry) => entry.profileId === profileId);
    if (!profile) throw new Error(`${label}: ${renderer.rendererKey} has no ${profileId} row.`);
    return profile;
  };
  const referenceTargets = [];
  for (const rendererKey of CONFIRMATION_EVIDENCE.rendererKeys) {
    const renderer = isolatedByRenderer.get(rendererKey);
    const baseline = profileSummary(renderer, run.gates.baselineProfileId);
    referenceTargets.push(
      roundTwoTargetAssessment(
        rendererKey,
        "isolated-correct-advance-rate",
        baseline.correctAdvanceCount,
        renderer.correctTrialCount,
      ),
      roundTwoTargetAssessment(
        rendererKey,
        "course-clear-correct-advance-rate",
        baseline.courseClearAdvanceCount,
        baseline.courseClearCorrectTrialCount,
      ),
    );
  }

  const candidates = run.gates.candidates.map((oldCandidate) => {
    const pairedCorrectness = [];
    const recognitionTargets = [];
    const materialImprovements = [];
    const pairedFailures = [];
    for (const rendererKey of CONFIRMATION_EVIDENCE.rendererKeys) {
      const renderer = isolatedByRenderer.get(rendererKey);
      const baseline = profileSummary(renderer, run.gates.baselineProfileId);
      const profile = profileSummary(renderer, oldCandidate.profileId);
      for (const definition of [
        {
          metric: "isolated-correct-advance-rate",
          census: renderer.correctTrialCount,
          baselineCount: baseline.correctAdvanceCount,
          profileCount: profile.correctAdvanceCount,
        },
        {
          metric: "course-clear-correct-advance-rate",
          census: baseline.courseClearCorrectTrialCount,
          baselineCount: baseline.courseClearAdvanceCount,
          profileCount: profile.courseClearAdvanceCount,
        },
      ]) {
        const deltaCount = definition.profileCount - definition.baselineCount;
        const paired = { rendererKey, ...definition, deltaCount, passed: deltaCount >= 0 };
        pairedCorrectness.push(paired);
        if (!paired.passed) pairedFailures.push(definition.metric);
        recognitionTargets.push(roundTwoTargetAssessment(
          rendererKey,
          definition.metric,
          definition.profileCount,
          definition.census,
        ));
        materialImprovements.push(roundTwoMaterialRate(
          `isolated/${rendererKey}/${definition.metric}`,
          definition.census === 0 ? 0 : definition.baselineCount / definition.census,
          definition.census === 0 ? 0 : definition.profileCount / definition.census,
        ));
      }
      if (baseline.p95OnsetToAdvanceMs !== null && profile.p95OnsetToAdvanceMs !== null) {
        materialImprovements.push(roundTwoMaterialLatency(
          `isolated/${rendererKey}/p95-onset-to-advance-ms`,
          baseline.p95OnsetToAdvanceMs,
          profile.p95OnsetToAdvanceMs,
        ));
      }
    }
    for (const rendererKey of CONFIRMATION_EVIDENCE.rendererKeys) {
      const renderer = sequenceByRenderer.get(rendererKey);
      const baseline = profileSummary(renderer, run.gates.baselineProfileId);
      const profile = profileSummary(renderer, oldCandidate.profileId);
      for (const [metric, field] of [
        ["independent-match-rate", "independentMatchRate"],
        ["ordered-advance-rate", "orderedAdvanceRate"],
        ["complete-passage-rate", "completePassageRate"],
      ]) {
        materialImprovements.push(roundTwoMaterialRate(
          `sequence/${rendererKey}/${metric}`,
          baseline.totals[field],
          profile.totals[field],
        ));
      }
      if (baseline.totals.p95OrderedAdvanceLatencyMs !== null &&
          profile.totals.p95OrderedAdvanceLatencyMs !== null) {
        materialImprovements.push(roundTwoMaterialLatency(
          `sequence/${rendererKey}/p95-ordered-advance-ms`,
          baseline.totals.p95OrderedAdvanceLatencyMs,
          profile.totals.p95OrderedAdvanceLatencyMs,
        ));
      }
    }
    for (const rendererKey of CONFIRMATION_EVIDENCE.rendererKeys) {
      const renderer = dynamicsByRenderer.get(rendererKey);
      const baseline = profileSummary(renderer, run.gates.baselineProfileId);
      const profile = profileSummary(renderer, oldCandidate.profileId);
      for (const profileSuite of profile.equalPiano) {
        const baselineSuite = baseline.equalPiano
          .find(({ suite }) => suite === profileSuite.suite);
        for (const [metric, field] of [
          ["independent-match-rate", "independentMatchRate"],
          ["ordered-advance-rate", "orderedAdvanceRate"],
          ["complete-passage-rate", "completePassageRate"],
        ]) {
          if (baselineSuite[field] === null || profileSuite[field] === null) continue;
          materialImprovements.push(roundTwoMaterialRate(
            `dynamics/${rendererKey}/${profileSuite.suite}/${metric}`,
            baselineSuite[field],
            profileSuite[field],
          ));
        }
      }
    }
    materialImprovements.push(roundTwoMaterialUnsafeEvents(
      "cross-domain/unsafe-event-count",
      roundTwoUnsafeEventCount(run, run.gates.baselineProfileId),
      roundTwoUnsafeEventCount(run, oldCandidate.profileId),
    ));
    const supersededFloorCodes = new Set([
      "release-isolated-recognition",
      "release-isolated-course-clear",
    ]);
    const survivingRoundOneRejections = oldCandidate.failedGateCodes
      .filter((code) => !supersededFloorCodes.has(code));
    if (pairedCorrectness.some(({ metric, passed }) => (
      metric === "isolated-correct-advance-rate" && !passed
    ))) {
      survivingRoundOneRejections.push("release-isolated-recognition");
    }
    if (pairedCorrectness.some(({ metric, passed }) => (
      metric === "course-clear-correct-advance-rate" && !passed
    ))) {
      survivingRoundOneRejections.push("release-isolated-course-clear");
    }
    const unappliedRequiredGateCodes = oldCandidate.gates
      .filter(({ applied }) => run.gates.evidenceComplete && !applied)
      .map(({ code }) => code);
    const failedGateCodes = [...new Set([
      ...survivingRoundOneRejections,
      ...unappliedRequiredGateCodes,
    ])];
    const eligible = failedGateCodes.length === 0 && pairedFailures.length === 0;
    const materialImprovementMet = materialImprovements.some(({ material }) => material);
    return {
      profileId: oldCandidate.profileId,
      oldFailedGateCodes: oldCandidate.failedGateCodes,
      failedGateCodes,
      removedRoundOneRejections: oldCandidate.failedGateCodes
        .filter((code) => supersededFloorCodes.has(code) && !failedGateCodes.includes(code)),
      pairedCorrectness,
      recognitionTargets,
      materialImprovements,
      materialImprovementMet,
      unappliedRequiredGateCodes,
      eligible,
      promotionEligible: eligible && materialImprovementMet,
    };
  });
  return {
    policyVersion: ROUND_TWO_POLICY_EVIDENCE.version,
    sourcePolicyVersion: CONFIRMATION_EVIDENCE.policyVersion,
    sourceManifestVersion: run.gates.domains[0].manifestVersion,
    sourceRegistryVersion: run.gates.registryVersion,
    baselineProfileId: run.gates.baselineProfileId,
    reference: {
      profileId: run.gates.baselineProfileId,
      pairedNonRegressionPassed: true,
      recognitionTargets: referenceTargets,
      materialImprovementMet: false,
      promotionEligible: false,
    },
    candidates,
    eligibleProfileIds: candidates.filter(({ eligible }) => eligible).map(({ profileId }) => profileId),
    promotableProfileIds: candidates
      .filter(({ promotionEligible }) => promotionEligible).map(({ profileId }) => profileId),
  };
}

const DIGEST_PATTERN = /^[0-9a-f]{8}$/;

/**
 * FNV-1a over the joined identity text.
 *
 * This restates `identityDigest` in `listenProfileValidationBenchmark.ts`, and
 * deliberately so: an archive's own digests are worth nothing if the only thing
 * that ever recomputes them is the code that wrote them. The two recipes are
 * `traceId:recognitionStructureHash:frameCount` for a corpus identity and
 * `traceId:profileId:outcomeDigest` for an outcome identity, each joined by a
 * single space. If the benchmark ever changes either one, this fails loudly on
 * the next run instead of accepting a digest nothing checks.
 */
export function fnv1a32(parts) {
  let hash = 0x811c9dc5;
  for (const character of parts.join(" ")) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const REQUIRED_FORENSIC_FIELDS = [
  "traceId",
  "targetIndex",
  "targetPitches",
  "targetScheduledAttackTimeMs",
  "advanceTimeMs",
  "sourceAttackIndex",
  "sourceAttackPitches",
  "sourceToTargetDistance",
  "attributionDelayMs",
];

/**
 * Fields that are diagnostic rather than cross-process confirmation evidence.
 *
 * `maximumInferenceMs` is a wall-clock maximum and `peak`/`rms` are measured off
 * floating-point audio. The two process-local hashes are excluded for the reason
 * Task 04 established: neither Chrome's offline audio rendering nor ONNX Runtime
 * reproduces its last bits in a fresh process, so the raw PCM and raw trace
 * hashes legitimately differ between two repetitions of the same matrix. They
 * are still required to be present on every captured trace, so the archive
 * records what this process actually rendered and decoded.
 */
const CROSS_RUN_OMITTED_FIELDS = new Set([
  "maximumInferenceMs",
  "peak",
  "rms",
  "processLocalPcmHash",
  "processLocalTraceHash",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable compact JSON with recursively sorted keys and selected fields omitted. */
export function canonicalJson(value, omittedFields = new Set()) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry, omittedFields)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .filter(([key, entry]) => !omittedFields.has(key) && entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => (
    `${JSON.stringify(key)}:${canonicalJson(entry, omittedFields)}`
  )).join(",")}}`;
}

/** Independent restatement of DeterministicHasher.text(canonicalJson(value), false). */
export function canonicalJsonDigest(value, omittedFields = new Set()) {
  let hash = 0x811c9dc5;
  const text = canonicalJson(value, omittedFields);
  const byte = (value) => {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193) >>> 0;
  };
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    byte(code & 0xff);
    byte(code >>> 8);
  }
  return hash.toString(16).padStart(8, "0");
}

function objectKeys(value, omittedFields) {
  return Object.keys(value)
    .filter((key) => !omittedFields.has(key) && value[key] !== undefined)
    .sort();
}

function childPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** Finds the first meaningful difference after applying the cross-run exclusions. */
export function firstEvidenceDifference(
  left,
  right,
  omittedFields = CROSS_RUN_OMITTED_FIELDS,
  path = "$",
) {
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (!leftObject || !rightObject) {
    return canonicalJson(left, omittedFields) === canonicalJson(right, omittedFields)
      ? null
      : { path, left, right };
  }
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray !== rightArray) return { path, left, right };
  if (leftArray) {
    if (left.length !== right.length) {
      return { path: `${path}.length`, left: left.length, right: right.length };
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstEvidenceDifference(
        left[index],
        right[index],
        omittedFields,
        `${path}[${index}]`,
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  const leftKeys = objectKeys(left, omittedFields);
  const rightKeys = objectKeys(right, omittedFields);
  const leftKeySet = new Set(leftKeys);
  const rightKeySet = new Set(rightKeys);
  for (const key of [...new Set([...leftKeys, ...rightKeys])].sort()) {
    if (leftKeySet.has(key) !== rightKeySet.has(key)) {
      return {
        path: childPath(path, key),
        left: Object.hasOwn(left, key) ? left[key] : undefined,
        right: Object.hasOwn(right, key) ? right[key] : undefined,
      };
    }
  }
  for (const key of leftKeys) {
    const difference = firstEvidenceDifference(
      left[key],
      right[key],
      omittedFields,
      childPath(path, key),
    );
    if (difference !== null) return difference;
  }
  return null;
}

/** Compares two repetitions and returns their canonical digests and first mismatch. */
export function compareEvidenceRuns(left, right, omittedFields = CROSS_RUN_OMITTED_FIELDS) {
  // The newline is part of the canonical byte format used for all evidence pins.
  const leftBytes = `${canonicalJson(left, omittedFields)}\n`;
  const rightBytes = `${canonicalJson(right, omittedFields)}\n`;
  const leftSha256 = sha256(leftBytes);
  const rightSha256 = sha256(rightBytes);
  return {
    equal: leftSha256 === rightSha256,
    leftSha256,
    rightSha256,
    difference: leftSha256 === rightSha256
      ? null
      : firstEvidenceDifference(left, right, omittedFields),
  };
}

function collectLateAdvances(value, records = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectLateAdvances(entry, records);
    return records;
  }
  if (value === null || typeof value !== "object") return records;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "lateAdvances" && Array.isArray(entry)) records.push(...entry);
    collectLateAdvances(entry, records);
  }
  return records;
}

function collectProfileLateAdvances(result) {
  const benchmarkResults = Array.isArray(result) ? result : [result];
  return benchmarkResults.flatMap((benchmarkResult) => (
    (benchmarkResult.renderers ?? []).flatMap((renderer) => (
      (renderer.profiles ?? []).flatMap((profile) => profile.lateAdvances ?? [])
    ))
  ));
}

/**
 * Everything that makes the Task 22 archive the measurement itself.
 *
 * The distributions in it are only meaningful over the whole corpus, and its two
 * pinned omitted-bass trials are only evidence while they still name the decoded
 * structures they were cut from, so both are checked rather than assumed.
 */
export function bassQualificationProblems(artifact, result) {
  const expected = artifact.bassQualification;
  const problems = [];
  const results = Array.isArray(result) ? result : [result];
  if (results.length !== 1) {
    return [`${artifact.name}: expected one result, found ${results.length}`];
  }
  const [run] = results;
  const check = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${artifact.name}: ${label} ${actual}, expected ${wanted}`);
  };
  check("name", run.name, expected.name);
  check("selectsNothing", run.selectsNothing, true);
  check("corpus completeness", run.corpus?.complete, true);
  check("manifest version", run.manifest?.version, expected.manifestVersion);
  check("manifest hash", run.manifest?.hash, expected.manifestHash);
  check("corpus hash", run.manifest?.corpusHash, expected.manifestCorpusHash);
  check("captured trace count", run.manifest?.capturedTraceCount, expected.capturedTraceCount);
  check("captured trace rows", run.traces?.length, expected.capturedTraceCount);
  check("profile column count", run.profiles?.length, expected.profileColumnCount);
  check("profile report count", run.profileReports?.length, expected.profileColumnCount);
  check("trace reuse", run.traceReuseVerified, true);
  check(
    "repeated chord pitches",
    (run.repeatedChord?.pitches ?? []).join("+"),
    expected.repeatedChordPitches.join("+"),
  );
  check(
    "repeated chord runs",
    (run.repeatedChord?.runs ?? []).map(({ traceId }) => traceId).sort().join(","),
    [...expected.repeatedChordTraceIds].sort().join(","),
  );
  const counterfactuals = (run.profiles ?? []).filter(({ role }) => role === "counterfactual");
  check("counterfactual columns", counterfactuals.length, expected.counterfactualColumnCount);
  for (const column of counterfactuals) {
    if (column.profile?.onsetThreshold !== expected.counterfactualOnsetThreshold) {
      problems.push(
        `${artifact.name}: counterfactual ${column.profileId} holds onset at ` +
          `${column.profile?.onsetThreshold}, expected ${expected.counterfactualOnsetThreshold}`,
      );
    }
    if (column.profile?.requireFreshBassOnset !== true) {
      problems.push(`${artifact.name}: counterfactual ${column.profileId} does not require a fresh bass onset`);
    }
  }
  const cases = run.omittedBassCases ?? [];
  check(
    "pinned omitted-bass trials",
    cases.map(({ traceId }) => traceId).join(","),
    expected.pinnedOmittedBass.map(({ traceId }) => traceId).join(","),
  );
  for (const pinned of expected.pinnedOmittedBass) {
    const measured = cases.find(({ traceId }) => traceId === pinned.traceId);
    if (!measured) continue;
    check(
      `${pinned.traceId} decoded structure`,
      measured.recognitionStructureHash,
      pinned.recognitionStructureHash,
    );
    check(`${pinned.traceId} bass pitch`, measured.bassMidi, pinned.bassMidi);
    if (measured.alreadyCommitted !== true) {
      problems.push(`${artifact.name}: ${pinned.traceId} is not pinned by a committed fixture`);
    }
    const onset = measured.fixture?.hallucinatedBassOnset?.confidence;
    if (!(typeof onset === "number" && onset >= 0.5 && onset < 0.6)) {
      problems.push(
        `${artifact.name}: ${pinned.traceId} phantom bass onset ${onset}, expected it inside ` +
          "[0.50, 0.60)",
      );
    }
    const [baseline, ...candidates] = measured.fixture?.pinnedOutcomes ?? [];
    if (baseline?.profileId !== "baseline-v1" || baseline.advanced !== false) {
      problems.push(`${artifact.name}: ${pinned.traceId} does not pin the baseline-v1 refusal`);
    }
    if (candidates.length !== 4 || !candidates.every(({ advanced }) => advanced === true)) {
      problems.push(`${artifact.name}: ${pinned.traceId} does not pin all four candidate advances`);
    }
  }
  return problems;
}

/** Everything that makes the Task 24 file the complete-grid, detail-only control. */
export function task24DomainArchiveProblems(artifact, result) {
  const expected = artifact.task24DomainArchive;
  if (expected === undefined) return [];
  const problems = [];
  const [run] = Array.isArray(result) ? result : [];
  const archive = run?.task24;
  const check = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${artifact.name}: ${label} ${actual}, expected ${wanted}`);
  };
  if (!Array.isArray(result) || result.length !== 1 || archive === undefined) {
    return [`${artifact.name}: expected exactly one Task 24 archive`];
  }
  check("command", run.name, expected.name);
  check("format version", archive.formatVersion, expected.formatVersion);
  check("policy version", archive.selectionPolicy?.version, expected.policyVersion);
  check("policy hash", archive.selectionPolicy?.hash, expected.policyHash);
  check(
    "recomputed policy hash",
    canonicalJsonDigest(archive.selectionPolicy?.rule),
    expected.policyHash,
  );
  check("manifest version", archive.manifest?.version, expected.manifestVersion);
  check("manifest hash", archive.manifest?.hash, expected.manifestHash);
  check("corpus hash", archive.manifest?.corpusHash, expected.manifestCorpusHash);
  check("candidate count", archive.candidateCount, expected.candidateCount);
  check("serialized candidate rows", archive.candidates?.length, expected.candidateCount);
  check("safe profile count", archive.version1Control?.safeProfileCount, expected.safeProfileCount);
  check("leaf-domain count", archive.version1Control?.domainCount, expected.leafDomainCount);
  check(
    "Task 08 candidate digest",
    archive.task08Parity?.aggregateCandidateDigest,
    expected.task08CandidateDigest,
  );
  check("Task 24 digest", archive.digest?.value, expected.task24Digest);
  check("recomputed Task 24 digest", canonicalJsonDigest({
    formatVersion: archive.formatVersion,
    selectionPolicyVersion: archive.selectionPolicy?.version,
    selectionPolicyHash: archive.selectionPolicy?.hash,
    manifest: archive.manifest,
    task08CandidateDigest: archive.task08Parity?.aggregateCandidateDigest,
    version1Control: archive.version1Control,
    candidates: archive.candidates,
  }), expected.task24Digest);
  check("version-1 control verdict", archive.version1Control?.verdict, expected.verdict);
  check(
    "best global profile",
    archive.version1Control?.bestGlobal?.profileId,
    expected.bestGlobalProfileId,
  );
  check("best global worst regret", archive.version1Control?.bestGlobal?.worstDomainRegret, 0);
  check("best global mean regret", archive.version1Control?.bestGlobal?.meanDomainRegret, 0);
  check(
    "single-trace domain count",
    archive.version1Control?.measurementResolution?.singleTraceDomainCount,
    expected.singleTraceDomainCount,
  );
  check(
    "invariant domain count",
    archive.version1Control?.measurementResolution?.invariantDomainCount,
    expected.invariantDomainCount,
  );
  check(
    "boundary-finer-than-step domain count",
    archive.version1Control?.measurementResolution
      ?.boundaryFinerThanSmallestPositiveStepDomainCount,
    expected.boundaryFinerThanSmallestPositiveStepDomainCount,
  );
  check("confirmation traces read", archive.confirmationTraceCountRead, 0);
  if (archive.selectsNothing !== true) problems.push(`${artifact.name}: archive selects a profile`);
  if (archive.task08Parity?.reproduced !== true) {
    problems.push(`${artifact.name}: Task 08 aggregate parity is not verified`);
  }
  if (!sameList(archive.sourcePartitions, ["discovery", "regression-only"])) {
    problems.push(`${artifact.name}: source partitions are not discovery/regression-only`);
  }
  if ((run.captures ?? []).some(({ partition }) => partition === "confirmation")) {
    problems.push(`${artifact.name}: top-level aggregate captured confirmation evidence`);
  }
  if (!sameList(archive.version1Control?.selectedProfileIds, expected.selectedProfileIds)) {
    problems.push(`${artifact.name}: version-1 selected control profile changed`);
  }
  check(
    "Task 08 rejection count",
    archive.task08Parity?.profilesRejectedBySafety,
    expected.task08RejectedCount,
  );
  check(
    "Task 08 frontier count",
    archive.task08Parity?.paretoFrontierCount,
    expected.task08FrontierCount,
  );
  if (!sameList(
    archive.task08Parity?.selectedProfileIds,
    expected.task08SelectedProfileIds,
  )) {
    problems.push(`${artifact.name}: Task 08 selected identifiers changed`);
  }
  if (archive.digest?.algorithm !== "fnv1a-32-canonical-json") {
    problems.push(`${artifact.name}: unexpected Task 24 digest algorithm`);
  }
  const candidates = Array.isArray(archive.candidates) ? archive.candidates : [];
  const profileIds = candidates.map((candidate) => candidate.profile?.id);
  if (new Set(profileIds).size !== expected.candidateCount) {
    problems.push(`${artifact.name}: candidate profile identifiers are not complete and unique`);
  }
  const incomplete = candidates.find((candidate) => (
    candidate.metrics?.profileId !== candidate.profile?.id ||
    !Array.isArray(candidate.leafDomains) ||
    candidate.leafDomains.length !== expected.leafDomainCount ||
    new Set(candidate.leafDomains.map(({ domainKey }) => domainKey)).size !==
      expected.leafDomainCount
  ));
  if (incomplete) {
    problems.push(`${artifact.name}: ${incomplete.profile?.id} has incomplete leaf-domain detail`);
  }
  const oracles = archive.version1Control?.oracles ?? [];
  if (oracles.length !== expected.leafDomainCount || oracles.some((oracle) => (
    !Array.isArray(oracle.tiedProfileIds) ||
    !oracle.tiedProfileIds.includes(oracle.profileId) ||
    !expected.bestGlobalTieProfileIds.every((profileId) => oracle.tiedProfileIds.includes(profileId))
  ))) {
    problems.push(`${artifact.name}: the version-1 leaf oracle tie sets do not reproduce the control`);
  }
  if (!sameList(
    archive.version1Control?.bestGlobalTieProfileIds,
    expected.bestGlobalTieProfileIds,
  )) {
    problems.push(`${artifact.name}: the best-global tie set changed`);
  }
  return problems;
}

/**
 * Task 24's repeated-recovery comparison, restated here in the verifier's own
 * terms and recomputed from both sides' archived measurements.
 *
 * The artifact stores the evaluation the search made; this reproduces it from
 * the per-run source distances, delays, and safety counts, so a record whose
 * verdict does not follow from its own measurements fails verification. The
 * boundaries are the frozen policy's and are pinned by the caller.
 */
function recomputeRepeatedRecovery(reference, candidate, boundaries, knownGroupIds) {
  return aggregateRepeatedRecovery(
    recomputeRepeatedRecoveryGroups(reference, candidate, boundaries),
    knownGroupIds,
    new Map(),
  );
}

/** The per-group half of the comparison, shared by Task 26 and Task 28. */
function recomputeRepeatedRecoveryGroups(reference, candidate, boundaries) {
  const referenceById = new Map((reference ?? []).map((row) => [row.groupId, row]));
  const unsafeCount = (observation) => (
    (observation?.falseAdvanceCount ?? 0) + (observation?.skippedAdvanceCount ?? 0) +
      (observation?.duplicateAdvanceCount ?? 0)
  );
  const reproduces = (observation) => Boolean(
    observation?.evaluated && observation?.structurallyValid &&
      observation?.firstCorrectFullChordAttackIncomplete &&
      observation?.carriedRequiredPitchWithoutFreshReOnset &&
      observation?.laterIdenticalAttackRecoveredCorrectTarget &&
      observation?.sourceDistance !== null && observation?.sourceDistance > 0 &&
      unsafeCount(observation) === 0,
  );
  const groups = (candidate ?? []).map((row) => {
    const base = referenceById.get(row.groupId)?.observation;
    const measured = row.observation;
    const candidateSafe = Boolean(measured?.evaluated) && unsafeCount(measured) === 0;
    let noRegression = candidateSafe;
    if (base?.sourceDistance !== null && base?.sourceDistance !== undefined) {
      noRegression = noRegression && measured?.sourceDistance !== null &&
        measured.sourceDistance - base.sourceDistance <=
          boundaries.sourceDistanceNoRegression &&
        measured.attributionDelayMs - base.attributionDelayMs <=
          boundaries.attributionDelayNoRegressionMs + 1e-12;
    }
    const materialRecovery = candidateSafe && measured?.sourceDistance !== null && (
      base?.sourceDistance === null || base?.sourceDistance === undefined || (
        base.sourceDistance - measured.sourceDistance >= boundaries.sourceDistanceMaterialGain &&
        base.attributionDelayMs - measured.attributionDelayMs + 1e-12 >=
          boundaries.attributionDelayMaterialGainMs
      )
    );
    return {
      groupId: row.groupId,
      stratum: row.stratum,
      evaluated: Boolean(measured?.evaluated),
      baselineReproduces: reproduces(base),
      noRegression,
      materialRecovery,
      fullResolution: candidateSafe && measured?.sourceDistance === 0,
    };
  });
  return groups;
}

/**
 * The frozen aggregation over recomputed per-group rows.
 *
 * `evidenceRoleByGroupId` names the confirmation groups. Task 26 declares none,
 * so its call passes an empty map and the aggregation reduces to exactly what it
 * recorded: no reproducing confirmation group, status `not-run`, and no
 * confirmed full resolution. Task 28's completed branch passes the real roles,
 * and the same code then applies the confirmation rules rather than a second
 * implementation of them.
 */
function aggregateRepeatedRecovery(allGroups, knownGroupIds, evidenceRoleByGroupId) {
  const roleOf = (groupId) => evidenceRoleByGroupId.get(groupId) ?? "discovery";
  const groups = allGroups.filter(({ groupId }) => roleOf(groupId) === "discovery");
  const confirmation = allGroups.filter(({ groupId, evaluated }) => (
    roleOf(groupId) === "confirmation" && evaluated
  ));
  const strata = [...new Set(groups.map(({ stratum }) => stratum))].sort();
  const materialRecoveryByStratum = strata.map((stratum) => {
    const rows = groups.filter((group) => group.stratum === stratum);
    const evaluatedGroupCount = rows.filter(({ evaluated }) => evaluated).length;
    const complete = evaluatedGroupCount === rows.length;
    return {
      stratum,
      requiredGroupCount: rows.length,
      evaluatedGroupCount,
      complete,
      material: complete && rows.some(({ materialRecovery }) => materialRecovery),
    };
  });
  const byGroupId = new Map(groups.map((group) => [group.groupId, group]));
  const requiredForResolution = groups.filter((group) => (
    knownGroupIds.includes(group.groupId) || group.baselineReproduces
  ));
  const noRegression = groups.filter(({ evaluated }) => evaluated)
    .every(({ noRegression: clean }) => clean) &&
    confirmation.every(({ noRegression: clean }) => clean);
  const materialRecovery = groups.length > 0 && materialRecoveryByStratum.length > 0 &&
    materialRecoveryByStratum.every(({ material }) => material);
  const discoveryFullResolution = knownGroupIds.every((id) => byGroupId.has(id)) &&
    requiredForResolution.length >= knownGroupIds.length &&
    requiredForResolution.every(({ fullResolution }) => fullResolution);
  const reproducingConfirmation = confirmation.filter(({ baselineReproduces }) => (
    baselineReproduces
  ));
  const inconclusiveConfirmation = confirmation.filter(({ baselineReproduces }) => (
    !baselineReproduces
  ));
  const confirmationReproductionStatus = confirmation.length === 0
    ? "not-run"
    : reproducingConfirmation.length === 0
    ? "inconclusive-no-reproduction"
    : "reproduced";
  // `confirmed-full-resolution` needs a confirmation group that actually
  // reproduced the phenomenon, not merely a confirmation run that happened.
  const confirmedFullResolution = discoveryFullResolution &&
    reproducingConfirmation.length > 0 &&
    reproducingConfirmation.every(({ fullResolution }) => fullResolution);
  return {
    groups: allGroups,
    materialRecoveryByStratum,
    discoveryEvaluationStatus: materialRecoveryByStratum.length > 0 &&
      materialRecoveryByStratum.every(({ complete }) => complete) ? "complete" : "incomplete",
    noRegression,
    materialRecovery,
    discoveryFullResolution,
    confirmedFullResolution,
    confirmationReproductionStatus,
    reproducingConfirmationGroupIds: reproducingConfirmation
      .map(({ groupId }) => groupId).sort(),
    inconclusiveConfirmationGroupIds: inconclusiveConfirmation
      .map(({ groupId }) => groupId).sort(),
    repeatedRecoveryOutcome: !noRegression
      ? "regressed"
      : confirmedFullResolution
      ? "confirmed-full-resolution"
      : discoveryFullResolution
      ? "discovery-full-resolution"
      : materialRecovery
      ? "material-partial-recovery"
      : "unchanged",
  };
}

/** Task 24's whole-ablation stop rule, recomputed from the recomputed evaluations. */
function recomputeStopReasons(selectedProfileIds, evaluations) {
  const reasons = [];
  if (selectedProfileIds.length === 0) reasons.push("no-search-selected-candidate");
  const incomplete = evaluations.some(({ discoveryEvaluationStatus }) => (
    discoveryEvaluationStatus === "incomplete"
  ));
  if (incomplete) reasons.push("selected-discovery-stratum-not-decoded");
  if (evaluations.some(({ noRegression }) => !noRegression)) {
    reasons.push("selected-repeated-recovery-regression");
  }
  if (!incomplete && evaluations.length > 0 &&
      evaluations.every(({ materialRecovery }) => !materialRecovery)) {
    reasons.push("selected-set-has-no-material-repeated-recovery");
  }
  return reasons;
}

/**
 * Task 24's matched-pair support rule, recomputed from the ablation's own grid.
 *
 * The pair record repeats the axis's and twin's selection, safety, and regret;
 * `inputs` is those same facts resolved from `selectedProfileIds` and the grid
 * rows instead, so a pair that is internally consistent but disagrees with the
 * grid it came from fails here rather than only moving the digest.
 */
function recomputePairSupport(inputs, stopSatisfied, evaluation, materialBoundary) {
  const reasons = [];
  const categoricalSafetyRescue = Boolean(inputs.axisSafe) && !inputs.twinSafe;
  const axisRegret = inputs.axisWorstDomainRegret ?? 0;
  const worstDomainRegretGain = (inputs.twinWorstDomainRegret ?? axisRegret) - axisRegret;
  const materialRegretGain = worstDomainRegretGain + 1e-12 >= materialBoundary;
  const materialRepeatedRecoveryGain = evaluation.noRegression && evaluation.materialRecovery;
  if (!stopSatisfied) reasons.push("bass-grid-failed-stop-rule");
  if (!inputs.axisSelected) reasons.push("axis-profile-not-selected");
  if (!inputs.axisSafe) reasons.push("axis-profile-unsafe");
  if (evaluation.discoveryEvaluationStatus === "incomplete") {
    reasons.push("repeated-recovery-discovery-incomplete-against-twin");
  }
  if (!evaluation.noRegression) reasons.push("repeated-recovery-regression-against-twin");
  if (!categoricalSafetyRescue && !materialRegretGain && !materialRepeatedRecoveryGain) {
    reasons.push("axis-does-not-separate-from-twin");
  }
  return {
    supported: reasons.length === 0,
    categoricalSafetyRescue,
    worstDomainRegretGain,
    materialRegretGain,
    materialRepeatedRecoveryGain,
    reasons,
  };
}

/**
 * The frozen transition rule, recomputed here rather than read from the file.
 *
 * The artifact states one terminal outcome; this derives it again from the
 * recorded stop verdicts and matched-pair support, so a file whose outcome does
 * not follow from its own evidence fails verification.
 */
function recomputedRoundTwoOutcome(ablations) {
  const find = (ablation) => ablations.find((record) => record.ablation === ablation);
  const first = find("ablation-1-round-one-grid");
  const second = find("ablation-2-refined-family");
  const third = find("ablation-3-bass-axis");
  if (!first) return "no-first-ablation";
  if (first.stop?.satisfied) {
    return second || third ? "unauthorised-ablation" : "existing-grid-sufficient";
  }
  if (!second) return "missing-second-ablation";
  if (second.stop?.satisfied) {
    return third ? "unauthorised-ablation" : "existing-family-refinement-sufficient";
  }
  if (!third) return "missing-third-ablation";
  const supported = (third.matchedPairs ?? []).filter(({ support }) => support?.supported === true);
  return third.stop?.satisfied && supported.length > 0
    ? "bass-axis-supported"
    : "bass-axis-unsupported";
}

/** Where a recorded repeated-recovery evaluation departs from the recomputed one. */
function repeatedRecoveryDisagreements(label, recorded, recomputed) {
  const problems = [];
  const roles = [...new Set((recorded?.groups ?? []).map(({ evidenceRole }) => evidenceRole))];
  if (roles.length !== 1 || roles[0] !== "discovery") {
    problems.push(`${label} declares evidence roles ${JSON.stringify(roles)}, expected discovery`);
  }
  for (const field of [
    "noRegression",
    "materialRecovery",
    "discoveryEvaluationStatus",
    "repeatedRecoveryOutcome",
    "discoveryFullResolution",
    "confirmedFullResolution",
    "confirmationReproductionStatus",
  ]) {
    if (recorded?.[field] !== recomputed[field]) {
      problems.push(
        `${label} records ${field}=${JSON.stringify(recorded?.[field])}, recomputed ` +
          `${JSON.stringify(recomputed[field])}`,
      );
    }
  }
  for (const field of [
    "reproducingConfirmationGroupIds",
    "inconclusiveConfirmationGroupIds",
  ]) {
    if (!sameList(recorded?.[field], recomputed[field])) {
      problems.push(`${label} records ${field} that its own evidence does not support`);
    }
  }
  const recordedGroups = (recorded?.groups ?? []).map((group) => (
    `${group.groupId}:${group.noRegression}:${group.materialRecovery}:${group.fullResolution}:` +
      `${group.baselineReproduces}`
  ));
  const recomputedGroups = recomputed.groups.map((group) => (
    `${group.groupId}:${group.noRegression}:${group.materialRecovery}:${group.fullResolution}:` +
      `${group.baselineReproduces}`
  ));
  if (!sameList(recordedGroups, recomputedGroups)) {
    problems.push(`${label} per-group verdicts do not follow from their own measurements`);
  }
  const recordedStrata = (recorded?.materialRecoveryByStratum ?? []).map((row) => (
    `${row.stratum}:${row.requiredGroupCount}:${row.evaluatedGroupCount}:${row.complete}:` +
      `${row.material}`
  ));
  const recomputedStrata = recomputed.materialRecoveryByStratum.map((row) => (
    `${row.stratum}:${row.requiredGroupCount}:${row.evaluatedGroupCount}:${row.complete}:` +
      `${row.material}`
  ));
  if (!sameList(recordedStrata, recomputedStrata)) {
    problems.push(`${label} stratum census does not follow from its own measurements`);
  }
  return problems;
}

/** Everything that makes the Task 26 file the staged ablation record. */
export function roundTwoAblationProblems(artifact, result) {
  const expected = artifact.roundTwoAblation;
  if (expected === undefined) return [];
  const problems = [];
  const [run] = Array.isArray(result) ? result : [];
  if (!Array.isArray(result) || result.length !== 1 || run === undefined) {
    return [`${artifact.name}: expected exactly one Task 26 ablation record`];
  }
  const check = (label, actual, wanted) => {
    if (actual !== wanted) problems.push(`${artifact.name}: ${label} ${actual}, expected ${wanted}`);
  };
  check("command", run.name, "listen-round-two-ablation");
  check("format version", run.formatVersion, 1);
  check("generator version", run.generatorVersion, expected.generatorVersion);
  check("policy version", run.selectionPolicy?.version, expected.policyVersion);
  check("policy hash", run.selectionPolicy?.hash, expected.policyHash);
  check("manifest version", run.manifest?.version, expected.manifestVersion);
  check("manifest hash", run.manifest?.hash, expected.manifestHash);
  check("corpus hash", run.manifest?.corpusHash, expected.manifestCorpusHash);
  check("terminal outcome", run.terminalOutcome, expected.terminalOutcome);
  check("production shape changed", run.productionThresholdShapeChanged, false);
  check("production shape excludes the axis", run.productionThresholdShapeExcludesBassAxis, true);
  check("round-one generator untouched", run.roundOneGeneratorUntouched, true);
  check("digest algorithm", run.digest?.algorithm, "fnv1a-32-canonical-json");
  check("digest", run.digest?.value, expected.digest);
  // The recipe is read from the record and checked against the frozen list, so
  // a file cannot quietly widen what its own digest ignores.
  if (!sameList(run.digest?.processLocalFieldsExcluded, expected.processLocalDigestFields)) {
    problems.push(`${artifact.name}: the digest's excluded fields changed`);
  }
  const { digest: _digest, ...digestInput } = run;
  check(
    "recomputed digest",
    canonicalJsonDigest(digestInput, new Set(expected.processLocalDigestFields)),
    expected.digest,
  );
  if (!sameList(
    run.selectionPolicy?.activeTargetRefinementPoints,
    expected.activeTargetRefinementPoints,
  )) {
    problems.push(`${artifact.name}: the frozen active-target refinement points changed`);
  }
  if (!sameList(run.selectionPolicy?.targetNoteRefinementPoints, expected.targetNoteRefinementPoints)) {
    problems.push(`${artifact.name}: the target-note refinement points changed`);
  }
  if (!sameList(run.selectionPolicy?.bassOnsetPoints, expected.bassOnsetPoints)) {
    problems.push(`${artifact.name}: the bass-onset points changed`);
  }
  if (!sameList(
    (run.repeatedChordCensus ?? []).map(({ groupId }) => groupId),
    expected.repeatedChordGroupIds,
  )) {
    problems.push(`${artifact.name}: the repeated-chord census changed`);
  }
  check(
    "Task 22 limiting minimum",
    run.task22LimitingUpperVoiceEvidence?.frozenThreeRunMinimum,
    expected.task22LimitingMinimum,
  );
  // The outcome must follow from the recorded evidence, not merely be stated.
  check("recomputed terminal outcome", recomputedRoundTwoOutcome(run.ablations ?? []),
    expected.terminalOutcome);
  const ablations = Array.isArray(run.ablations) ? run.ablations : [];
  if (!sameList(ablations.map(({ ablation }) => ablation), expected.ablations.map(({ id }) => id))) {
    problems.push(`${artifact.name}: the staged ablations changed`);
    return problems;
  }
  ablations.forEach((record, index) => {
    const wanted = expected.ablations[index];
    const label = `${wanted.id}`;
    check(`${label} grid size`, record.gridSize, wanted.gridSize);
    check(`${label} frozen generator`, record.gridIsFrozenGenerator, true);
    check(`${label} grid version`, record.gridVersion, `round-two-v1/${wanted.id}`);
    check(`${label} bass axis present`, record.bassAxisPresent, wanted.bassAxisPresent);
    check(`${label} captured traces`, record.capturedTraceCount, expected.capturedTraceCount);
    check(`${label} confirmation traces read`, record.confirmationTraceCountRead, 0);
    check(`${label} safe profiles`, record.safeProfileCount, wanted.safeProfileCount);
    check(`${label} regret verdict`, record.domainRegret?.verdict, wanted.verdict);
    check(`${label} stop satisfied`, record.stop?.satisfied, wanted.stopSatisfied);
    check(`${label} grid rows`, record.domainRegret?.gridRows?.length, wanted.gridSize);
    if (!sameList(record.selectedProfileIds, wanted.selectedProfileIds)) {
      problems.push(`${artifact.name}: ${label} selected profiles changed`);
    }
    if (!sameList(record.stop?.reasons, wanted.stopReasons)) {
      problems.push(`${artifact.name}: ${label} stop reasons changed`);
    }
    // A verdict has to follow from its own reasons, in both directions.
    if (record.stop?.satisfied !== ((record.stop?.reasons ?? []).length === 0) ||
        record.stop?.runNextAblation === record.stop?.satisfied) {
      problems.push(`${artifact.name}: ${label} stop verdict does not follow from its reasons`);
    }
    if (record.selectionJudgement !== "discovery-safe-and-search-selected") {
      problems.push(`${artifact.name}: ${label} claims a judgement it cannot have made`);
    }
    const ids = (record.domainRegret?.gridRows ?? []).map(({ profileId }) => profileId);
    if (new Set(ids).size !== ids.length) {
      problems.push(`${artifact.name}: ${label} grid rows are not unique`);
    }
    // Every selected profile carries its own per-run repeated-chord evidence.
    const reported = (record.repeatedRecovery ?? []).map(({ profileId }) => profileId);
    if (!sameList(reported, record.selectedProfileIds ?? [])) {
      problems.push(`${artifact.name}: ${label} does not report every selected profile's recovery`);
    }
    // Both sides of every comparison are archived, so the verdict the record
    // states is recomputed from the measurements rather than trusted. The
    // incumbent's side is archived once per ablation and must cover the census,
    // or a missing reference row would read as an unrecovered baseline and turn
    // any candidate recovery into a categorical material gain.
    if (!sameList(
      (record.baselineRepeatedMeasurements ?? []).map(({ groupId }) => groupId),
      expected.repeatedChordGroupIds,
    )) {
      problems.push(`${artifact.name}: ${label} archives no complete incumbent comparison`);
    }
    const recomputed = new Map();
    for (const report of record.repeatedRecovery ?? []) {
      const measured = (report.measurements ?? []).map(({ groupId }) => groupId);
      if (!sameList(measured, expected.repeatedChordGroupIds)) {
        problems.push(
          `${artifact.name}: ${label} ${report.profileId} does not report every repeated group`,
        );
      }
      if (report.evaluation?.confirmationReproductionStatus !== "not-run" ||
          report.evaluation?.confirmedFullResolution !== false) {
        problems.push(
          `${artifact.name}: ${label} ${report.profileId} reads confirmation evidence`,
        );
      }
      const evaluation = recomputeRepeatedRecovery(
        record.baselineRepeatedMeasurements,
        report.measurements,
        expected.repeatedRecoveryBoundaries,
        expected.knownDiscoveryGroupIds,
      );
      recomputed.set(report.profileId, evaluation);
      problems.push(...repeatedRecoveryDisagreements(
        `${artifact.name}: ${label} ${report.profileId}`,
        report.evaluation,
        evaluation,
      ));
    }
    const recomputedReasons = recomputeStopReasons(
      record.selectedProfileIds ?? [],
      (record.selectedProfileIds ?? []).map((profileId) => recomputed.get(profileId) ?? {
        discoveryEvaluationStatus: "incomplete",
        noRegression: false,
        materialRecovery: false,
      }),
    );
    if (!sameList(record.stop?.reasons, recomputedReasons)) {
      problems.push(
        `${artifact.name}: ${label} stop reasons ${JSON.stringify(record.stop?.reasons)} do not ` +
          `follow from its own measurements ${JSON.stringify(recomputedReasons)}`,
      );
    }
    const gridRowById = new Map((record.domainRegret?.gridRows ?? []).map((row) => (
      [row.profileId, row]
    )));
    for (const pair of record.matchedPairs ?? []) {
      const pairLabel = `${artifact.name}: ${label} ${pair.axisProfileId}`;
      const sides = [
        ["twin comparison", pair.twinRepeatedMeasurements],
        ["axis comparison", pair.repeatedRecoveryAgainstTwin?.measurements],
      ];
      const incomplete = sides.filter(([, rows]) => !sameList(
        (rows ?? []).map(({ groupId }) => groupId),
        expected.repeatedChordGroupIds,
      ));
      if (incomplete.length > 0) {
        for (const [side] of incomplete) {
          problems.push(`${pairLabel} archives no complete ${side}`);
        }
        continue;
      }
      const evaluation = recomputeRepeatedRecovery(
        pair.twinRepeatedMeasurements,
        pair.repeatedRecoveryAgainstTwin?.measurements,
        expected.repeatedRecoveryBoundaries,
        expected.knownDiscoveryGroupIds,
      );
      problems.push(...repeatedRecoveryDisagreements(
        `${pairLabel} against ${pair.twinProfileId}`,
        pair.repeatedRecoveryAgainstTwin?.evaluation,
        evaluation,
      ));
      const axisRow = gridRowById.get(pair.axisProfileId);
      const twinRow = gridRowById.get(pair.twinProfileId);
      if (axisRow === undefined || twinRow === undefined) {
        problems.push(`${pairLabel} names a profile its own grid does not contain`);
        continue;
      }
      // The pair's own copies of these facts are checked against the grid they
      // came from, so a rescue or a regret gain cannot be asserted by the pair
      // record against the safety verdict the search actually recorded.
      const inputs = {
        axisSelected: (record.selectedProfileIds ?? []).includes(pair.axisProfileId),
        axisSafe: axisRow.safe,
        twinSafe: twinRow.safe,
        axisWorstDomainRegret: axisRow.worstDomainRegret,
        twinWorstDomainRegret: twinRow.worstDomainRegret,
      };
      for (const [field, recorded] of [
        ["axisSelected", pair.axisSelected],
        ["axisSafe", pair.axisSafe],
        ["twinSafe", pair.twinSafe],
        ["axisWorstDomainRegret", pair.axisWorstDomainRegret],
        ["twinWorstDomainRegret", pair.twinWorstDomainRegret],
      ]) {
        if (recorded !== inputs[field]) {
          problems.push(
            `${pairLabel} records ${field}=${JSON.stringify(recorded)}, but its grid rows say ` +
              `${JSON.stringify(inputs[field])}`,
          );
        }
      }
      const support = recomputePairSupport(
        inputs,
        record.stop?.satisfied === true,
        evaluation,
        expected.domainRegretMaterialBoundary,
      );
      const gainDifference = Math.abs(
        (pair.support?.worstDomainRegretGain ?? Number.NaN) - support.worstDomainRegretGain,
      );
      if (support.supported !== pair.support?.supported ||
          support.categoricalSafetyRescue !== pair.support?.categoricalSafetyRescue ||
          support.materialRegretGain !== pair.support?.materialRegretGain ||
          support.materialRepeatedRecoveryGain !== pair.support?.materialRepeatedRecoveryGain ||
          !(gainDifference <= 1e-12) ||
          !sameList(pair.support?.reasons, support.reasons)) {
        problems.push(
          `${pairLabel} support ${JSON.stringify(pair.support)} does not follow from its own ` +
            `pair ${JSON.stringify(support)}`,
        );
      }
    }
    if (index + 1 < ablations.length && record.stop?.runNextAblation !== true) {
      problems.push(`${artifact.name}: ${label} did not authorise the ablation recorded after it`);
    }
  });
  return problems;
}

/**
 * Reruns the frozen stop rule over one Task 26 archive and derives the round's
 * branch from the result.
 *
 * Nothing recorded in the archive is read as a conclusion: each ablation's stop
 * verdict is recomputed from both sides of its archived repeated-chord
 * measurements, each matched pair's support from the ablation's own grid rows,
 * and the terminal outcome from those recomputed verdicts. Task 27's zero branch
 * rests on this rerun.
 */
export function rerunRoundTwoSelection(record, pins) {
  const ablations = (record?.ablations ?? []).map((ablation) => {
    const evaluations = (ablation.selectedProfileIds ?? []).map((profileId) => {
      const report = (ablation.repeatedRecovery ?? []).find((row) => row.profileId === profileId);
      return recomputeRepeatedRecovery(
        ablation.baselineRepeatedMeasurements,
        report?.measurements,
        pins.repeatedRecoveryBoundaries,
        pins.knownDiscoveryGroupIds,
      );
    });
    const reasons = recomputeStopReasons(ablation.selectedProfileIds ?? [], evaluations);
    const stop = { satisfied: reasons.length === 0, reasons };
    const gridRowById = new Map((ablation.domainRegret?.gridRows ?? []).map((row) => (
      [row.profileId, row]
    )));
    const matchedPairs = (ablation.matchedPairs ?? []).map((pair) => {
      const axisRow = gridRowById.get(pair.axisProfileId);
      const twinRow = gridRowById.get(pair.twinProfileId);
      const support = recomputePairSupport(
        {
          axisSelected: (ablation.selectedProfileIds ?? []).includes(pair.axisProfileId),
          axisSafe: axisRow?.safe,
          twinSafe: twinRow?.safe,
          axisWorstDomainRegret: axisRow?.worstDomainRegret,
          twinWorstDomainRegret: twinRow?.worstDomainRegret,
        },
        stop.satisfied,
        recomputeRepeatedRecovery(
          pair.twinRepeatedMeasurements,
          pair.repeatedRecoveryAgainstTwin?.measurements,
          pins.repeatedRecoveryBoundaries,
          pins.knownDiscoveryGroupIds,
        ),
        pins.domainRegretMaterialBoundary,
      );
      return { support };
    });
    return {
      ablation: ablation.ablation,
      selectedProfileIds: [...(ablation.selectedProfileIds ?? [])],
      stop,
      matchedPairs,
    };
  });
  const terminalOutcome = recomputedRoundTwoOutcome(ablations);
  const accepted = ablations.find(({ stop }) => stop.satisfied) ?? null;
  // The two zero-branch forms are different findings: nothing was accepted, or a
  // grid was accepted whose selected profiles all need an unsupported
  // parameterization. A nonempty branch has no reason code at all.
  const zeroBranch = terminalOutcome === "bass-axis-unsupported";
  return {
    ablations,
    terminalOutcome,
    evidenceDigest: canonicalJsonDigest(
      Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => key !== "digest")),
      new Set(pins.processLocalDigestFields),
    ),
    ablationId: accepted?.ablation ?? null,
    notRunReason: !zeroBranch
      ? null
      : accepted === null
      ? "no-ablation-accepted"
      : "no-supported-parameterization",
    candidatesAllowed: !zeroBranch,
  };
}

/**
 * Everything that makes the Task 27 file the frozen candidate manifest.
 *
 * `evidenceRuns` are the parsed Task 26 repetitions the manifest was derived
 * from. Each is rerun independently, because a manifest that only one repetition
 * supports is not the round's result.
 */
export function roundTwoCandidateManifestProblems(artifact, result, evidenceRuns) {
  const expected = artifact.roundTwoCandidateManifest;
  if (expected === undefined) return [];
  const problems = [];
  if (Array.isArray(result) || typeof result !== "object" || result === null) {
    return [`${artifact.name}: the candidate manifest is one record, not a list`];
  }
  const check = (label, actual, wanted) => {
    if (actual !== wanted) {
      problems.push(
        `${artifact.name}: ${label} ${printable(actual)}, expected ${printable(wanted)}`,
      );
    }
  };
  check("command", result.name, expected.name);
  check("format version", result.formatVersion, expected.formatVersion);
  check("round", result.roundId, expected.roundId);
  check("registry version", result.registryVersion, expected.registryVersion);
  check("registry digest", result.registryDigest, expected.registryDigest);
  check("policy version", result.policyVersion, expected.policyVersion);
  check("policy hash", result.policyHash, expected.policyHash);
  check("manifest version", result.traceManifestVersion, expected.traceManifestVersion);
  check("manifest hash", result.traceManifestHash, expected.traceManifestHash);
  check("corpus hash", result.traceManifestCorpusHash, expected.traceManifestCorpusHash);
  check("generator version", result.generatorVersion, expected.generatorVersion);
  check("ablation", result.ablationId, expected.ablationId);
  check("terminal outcome", result.task26TerminalOutcome, expected.task26TerminalOutcome);
  check("Task 26 evidence digest", result.task26EvidenceDigest, expected.task26EvidenceDigest);
  check("not-run reason", result.notRunReason, expected.notRunReason);
  check("digest algorithm", result.digest?.algorithm, "fnv1a-32-canonical-json");
  check("digest", result.digest?.value, expected.digest);
  if (!sameList(result.candidateProfileIds, expected.candidateProfileIds)) {
    problems.push(`${artifact.name}: the candidate list changed`);
  }
  // The manifest carries candidacy only; an eligibility field here would let a
  // search result be read as a release result before Task 28 has measured one.
  for (const forbidden of ["eligible", "eligibility", "eligibleProfileIds", "confirmation"]) {
    if (Object.hasOwn(result, forbidden)) {
      problems.push(`${artifact.name}: the manifest carries an eligibility field ${forbidden}`);
    }
  }
  const { digest: _digest, ...digestInput } = result;
  check("recomputed digest", canonicalJsonDigest(digestInput), expected.digest);
  if (!Array.isArray(evidenceRuns) || evidenceRuns.length !== expected.evidencePaths.length) {
    problems.push(
      `${artifact.name}: expected ${expected.evidencePaths.length} Task 26 repetitions`,
    );
    return problems;
  }
  evidenceRuns.forEach((run, index) => {
    const label = `${artifact.name}: ${expected.evidencePaths[index]}`;
    const [record] = Array.isArray(run) ? run : [];
    if (record === undefined) {
      problems.push(`${label} is not one Task 26 record`);
      return;
    }
    const rerun = rerunRoundTwoSelection(record, expected);
    if (rerun.evidenceDigest !== result.task26EvidenceDigest) {
      problems.push(
        `${label} recomputes to digest ${rerun.evidenceDigest}, and the manifest references ` +
          `${printable(result.task26EvidenceDigest)}`,
      );
    }
    if (rerun.terminalOutcome !== result.task26TerminalOutcome) {
      problems.push(
        `${label} reruns to terminal outcome ${rerun.terminalOutcome}, and the manifest records ` +
          `${printable(result.task26TerminalOutcome)}`,
      );
    }
    if (rerun.notRunReason !== result.notRunReason) {
      problems.push(
        `${label} reruns to reason ${printable(rerun.notRunReason)}, and the manifest records ` +
          `${printable(result.notRunReason)}`,
      );
    }
    if (rerun.ablationId !== result.ablationId) {
      problems.push(
        `${label} reruns to ablation ${printable(rerun.ablationId)}, and the manifest names ` +
          `${printable(result.ablationId)}`,
      );
    }
    if (!rerun.candidatesAllowed && (result.candidateProfileIds ?? []).length > 0) {
      problems.push(`${label} took the zero branch, so the manifest may register no candidate`);
    }
    // Under `no-ablation-accepted` the rerun must show the stop rule rejecting
    // every ablation, which is the finding the manifest reports.
    if (result.notRunReason === "no-ablation-accepted" &&
        rerun.ablations.some(({ stop }) => stop.satisfied)) {
      problems.push(`${label} has an ablation the rerun stop rule accepted`);
    }
  });
  return problems;
}

/* ------------------------------------------------------------------------- *
 * Task 28: the eligibility manifest
 * ------------------------------------------------------------------------- */

/** The exact key set of each branch. "Forbidden" is enforced as an unknown key. */
const ELIGIBILITY_COMMON_KEYS = [
  "name",
  "formatVersion",
  "roundId",
  "runStatus",
  "candidateManifestDigest",
  "task26TerminalOutcome",
  "task26EvidenceDigest",
  "entries",
  "confirmationPartition",
  "digest",
];

export const ELIGIBILITY_MANIFEST_KEYS = {
  completed: [...ELIGIBILITY_COMMON_KEYS, "confirmationEvidence"],
  "not-run-no-confirmable-candidate": [...ELIGIBILITY_COMMON_KEYS, "reason"],
};

const ELIGIBILITY_ENTRY_KEYS = [
  "profileId",
  "automatedEligible",
  "rejectionReasons",
  "repeatedRecoveryOutcome",
  "confirmationReproductionStatus",
];

const REPEATED_RECOVERY_OUTCOMES = [
  "unchanged",
  "regressed",
  "material-partial-recovery",
  "discovery-full-resolution",
  "confirmed-full-resolution",
];

const CONFIRMATION_REPRODUCTION_STATUSES = [
  "reproduced",
  "inconclusive-no-reproduction",
  "not-run",
];

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resolves the archive names a completed manifest records into read files.
 *
 * Returns a map keyed by the recorded name, each entry carrying the canonical
 * path the name resolved to, the file's actual SHA-256, and the canonical
 * comparison digest recomputed from its contents under the Task 04 omissions. A
 * name that resolves to nothing is recorded as unreadable rather than skipped.
 */
export async function readRoundTwoConfirmationArchives(names, root = REPOSITORY_ROOT) {
  const archives = new Map();
  for (const name of names) {
    if (typeof name !== "string" || name.length === 0) continue;
    const canonicalPath = resolve(root, name);
    try {
      const bytes = await readFile(canonicalPath);
      const parsed = JSON.parse(bytes.toString("utf8"));
      // Lexical normalization settles `.` and `..` and nothing else: a symlink
      // and a hard link to one archive are two different strings and two
      // different absolute paths. Filesystem identity is what "two files" means,
      // so it is read from the filesystem.
      const realPath = await realpath(canonicalPath);
      const stats = await stat(realPath);
      archives.set(name, {
        canonicalPath,
        realPath,
        fileIdentity: `${stats.dev}:${stats.ino}`,
        fileSha256: sha256(bytes),
        comparisonDigest: sha256(`${canonicalJson(parsed, CROSS_RUN_OMITTED_FIELDS)}\n`),
        record: parsed,
      });
    } catch (error) {
      archives.set(name, { canonicalPath, unreadable: error.message });
    }
  }
  return archives;
}

/**
 * What makes two recorded names two archived repetitions.
 *
 * A name is not evidence. Two strings that merely differ can be two spellings of
 * one file — `run1.json` and `./run1.json`, or a symlink beside its target — or
 * two files that do not exist, so each name is resolved, read, and hashed: the
 * recorded SHA-256 must be the file's own, the two names must resolve to
 * different files by filesystem identity rather than by differing as strings,
 * and both archives must recompute to the recorded canonical comparison digest.
 * Requiring their bytes to differ would be the wrong test in the other
 * direction, since two runs of a deterministic matrix may legitimately hash
 * alike.
 */
export function confirmationArchiveEvidenceProblems(label, evidence, archives) {
  const problems = [];
  const names = [evidence.runOneArchive, evidence.runTwoArchive];
  if (archives === null) {
    return [`${label}: the named confirmation archives were not read`];
  }
  const resolved = [];
  for (const [index, name] of names.entries()) {
    const field = index === 0 ? "runOneArchive" : "runTwoArchive";
    const archive = archives.get(name);
    if (archive === undefined || archive.unreadable !== undefined) {
      problems.push(
        `${label}: ${field} ${printable(name)} could not be read` +
          `${archive?.unreadable === undefined ? "" : ` (${archive.unreadable})`}`,
      );
      continue;
    }
    resolved.push({ field, name, archive });
    const recorded = index === 0 ? evidence.runOneSha256 : evidence.runTwoSha256;
    if (archive.fileSha256 !== recorded) {
      problems.push(
        `${label}: ${field} hashes to ${archive.fileSha256}, and the manifest records ` +
          `${printable(recorded)}`,
      );
    }
    if (archive.comparisonDigest !== evidence.comparisonDigest) {
      problems.push(
        `${label}: ${field} recomputes to comparison digest ${archive.comparisonDigest}, and ` +
          `the manifest records ${printable(evidence.comparisonDigest)}`,
      );
    }
  }
  if (resolved.length === 2 &&
      resolved[0].archive.fileIdentity === resolved[1].archive.fileIdentity) {
    problems.push(
      `${label}: both confirmation repetitions are the same file ` +
        `(${resolved[0].archive.realPath}), so one run was quoted twice`,
    );
  }
  return problems;
}

/**
 * The round-two confirmation matrix, as an archived repetition must show it.
 *
 * This is the Task 13 contract restated for round two, and it exists for the
 * same reason: without it the archive comparison establishes only that two files
 * agree, and two agreeing files can both be a narrowed smoke. A smoke can reject
 * a candidate but never clear one, so an eligibility manifest whose labels rest
 * on one would be self-reported. Every value is fixed before the first run.
 */
export const ROUND_TWO_CONFIRMATION_MATRIX = Object.freeze({
  /** The unified command's own name; the narrowed variants are refused by it. */
  name: "listen-profile-validation",
  formatVersion: 1,
  manifestVersion: 2,
  manifestHash: "d1971fa3",
  manifestCorpusHash: "1213016e",
  registryVersion: 2,
  policyVersion: 1,
  policyHash: "840b07ec",
  baselineProfileId: "baseline-v1",
  rendererKeys: ["direct", "tone"],
  /**
   * The version-2 census, per partition and suite.
   *
   * A total is not coverage: 504 rows of anything sums to 504. The matrix is
   * recomputed from the archived captures against this breakdown, so a run that
   * replaced held-back strata with duplicates of a cheap one fails even though
   * its total is right.
   */
  census: Object.freeze([
    Object.freeze({ partition: "discovery", suite: "isolated", traceCount: 212 }),
    Object.freeze({ partition: "discovery", suite: "sequence", traceCount: 120 }),
    Object.freeze({ partition: "discovery", suite: "articulation", traceCount: 8 }),
    Object.freeze({ partition: "discovery", suite: "dynamics-constant", traceCount: 39 }),
    Object.freeze({ partition: "discovery", suite: "dynamics-mixed", traceCount: 4 }),
    Object.freeze({ partition: "discovery", suite: "round-two-paired", traceCount: 12 }),
    Object.freeze({ partition: "confirmation", suite: "round-two-paired", traceCount: 12 }),
    Object.freeze({ partition: "regression-only", suite: "isolated", traceCount: 56 }),
    Object.freeze({ partition: "regression-only", suite: "sequence", traceCount: 36 }),
    Object.freeze({ partition: "regression-only", suite: "dynamics-constant", traceCount: 1 }),
    Object.freeze({ partition: "regression-only", suite: "safety-regression", traceCount: 4 }),
  ]),
  capturedTraceCount: 504,
  confirmationTraceCountRead: 12,
  /** Every capture must record what it actually rendered and decoded. */
  captureFields: Object.freeze([
    "traceId",
    "rendererKey",
    "partition",
    "suite",
    "recognitionStructureHash",
    "processLocalPcmHash",
    "processLocalTraceHash",
  ]),
  /**
   * The identity of the captured corpus, not merely its shape.
   *
   * Counting rows per suite says how many of each kind were captured; it does
   * not say that they were *these* traces. This digest is FNV-1a over the trace
   * count and then every manifest trace's identifier, renderer, partition, and
   * suite in manifest order, so 504 fabricated identifiers in the right buckets
   * fail even though every count agrees.
   */
  captureIdentityDigest: "36d9d45c",
  /** The frozen incumbent column, by value rather than by name. */
  baselineThresholds: Object.freeze({
    onsetThreshold: 0.6,
    targetNoteThreshold: 0.5,
    activeTargetThreshold: 0.35,
    extraNoteThreshold: 0.97,
    requireFreshBassOnset: true,
  }),
  /** Counters every archived outcome row must actually carry. */
  outcomeCounters: Object.freeze([
    "orderedAdvanceCount",
    "falseAdvanceCount",
    "skippedAdvanceCount",
    "duplicateAdvanceCount",
  ]),
  /** The boolean qualifications a decoded repeated-chord observation records. */
  observationFlags: Object.freeze([
    "evaluated",
    "structurallyValid",
    "firstCorrectFullChordAttackIncomplete",
    "carriedRequiredPitchWithoutFreshReOnset",
    "laterIdenticalAttackRecoveredCorrectTarget",
  ]),
  /**
   * The complete round-two repeated-chord census, both halves.
   *
   * Pinning only the confirmation half would let a run declare whichever
   * discovery groups suited it — omitting Task 25's newly authored ones — and
   * still reach a resolution verdict over a census the policy never froze.
   */
  repeatedChordCensus: Object.freeze([
    Object.freeze({
      groupId: "dynamics-constant/tone/salamander/v05",
      stratum: "known-round-one-repeated-chord",
      evidenceRole: "discovery",
    }),
    Object.freeze({
      groupId: "dynamics-constant/tone/salamander/v13",
      stratum: "known-round-one-repeated-chord",
      evidenceRole: "discovery",
    }),
    Object.freeze({
      groupId: "dynamics-mixed/tone/salamander",
      stratum: "known-round-one-repeated-chord",
      evidenceRole: "discovery",
    }),
    Object.freeze({
      groupId: "round-two/r2-repeated-low-triad-direct-splendid-pp/correct",
      stratum: "round-two-authored-repeated-chord",
      evidenceRole: "discovery",
    }),
    Object.freeze({
      groupId: "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/correct",
      stratum: "round-two-authored-repeated-chord",
      evidenceRole: "discovery",
    }),
    Object.freeze({
      groupId: "round-two/r2-repeated-high-triad-tone-splendid-mf/correct",
      stratum: "round-two-confirmation-repeated-chord",
      evidenceRole: "confirmation",
    }),
    Object.freeze({
      groupId: "round-two/r2-repeated-mid-tetrad-direct-salamander-v03/correct",
      stratum: "round-two-confirmation-repeated-chord",
      evidenceRole: "confirmation",
    }),
  ]),
});

/** The frozen census as a lookup, for checks that need one group at a time. */
const ROUND_TWO_REPEATED_CENSUS_BY_ID = new Map(
  ROUND_TWO_CONFIRMATION_MATRIX.repeatedChordCensus.map((group) => [group.groupId, group]),
);

/**
 * The exact captured corpus, in manifest order: identifier, renderer, partition,
 * suite.
 *
 * A per-suite count says how many of each kind were captured; it does not say
 * that they were these traces. Pinning the list rather than only its digest also
 * lets the frozen corpus be named when an archive misses one, and the digest
 * below is recomputed from this list at load so the two cannot drift apart.
 */
export const ROUND_TWO_CAPTURE_IDENTITIES = Object.freeze([
  "sequence/direct/ascending-scale/1000ms|direct|discovery|sequence|scoring|1|scales|1000|splendid|mp||",
  "sequence/direct/ascending-scale/500ms|direct|discovery|sequence|scoring|1|scales|500|splendid|mp||",
  "sequence/direct/ascending-scale/333ms|direct|discovery|sequence|scoring|1|scales|333.3333333333333|splendid|mp||",
  "sequence/direct/ascending-scale/250ms|direct|discovery|sequence|scoring|1|scales|250|splendid|mp||",
  "sequence/direct/ascending-scale/167ms|direct|discovery|sequence|scoring|1|scales|167|splendid|mp||",
  "sequence/direct/ascending-scale/125ms|direct|discovery|sequence|scoring|1|scales|125|splendid|mp||",
  "sequence/direct/descending-scale/1000ms|direct|discovery|sequence|scoring|1|scales|1000|splendid|mp||",
  "sequence/direct/descending-scale/500ms|direct|discovery|sequence|scoring|1|scales|500|splendid|mp||",
  "sequence/direct/descending-scale/333ms|direct|discovery|sequence|scoring|1|scales|333.3333333333333|splendid|mp||",
  "sequence/direct/descending-scale/250ms|direct|discovery|sequence|scoring|1|scales|250|splendid|mp||",
  "sequence/direct/descending-scale/167ms|direct|discovery|sequence|scoring|1|scales|167|splendid|mp||",
  "sequence/direct/descending-scale/125ms|direct|discovery|sequence|scoring|1|scales|125|splendid|mp||",
  "sequence/direct/alternating-c4-g4/1000ms|direct|discovery|sequence|scoring|1|alternating-pitches|1000|splendid|mp||",
  "sequence/direct/alternating-c4-g4/500ms|direct|discovery|sequence|scoring|1|alternating-pitches|500|splendid|mp||",
  "sequence/direct/alternating-c4-g4/333ms|direct|discovery|sequence|scoring|1|alternating-pitches|333.3333333333333|splendid|mp||",
  "sequence/direct/alternating-c4-g4/250ms|direct|discovery|sequence|scoring|1|alternating-pitches|250|splendid|mp||",
  "sequence/direct/alternating-c4-g4/167ms|direct|discovery|sequence|scoring|1|alternating-pitches|167|splendid|mp||",
  "sequence/direct/alternating-c4-g4/125ms|direct|discovery|sequence|scoring|1|alternating-pitches|125|splendid|mp||",
  "sequence/direct/repeated-c4/1000ms|direct|discovery|sequence|scoring|1|repeated-notes|1000|splendid|mp||",
  "sequence/direct/repeated-c4/500ms|direct|discovery|sequence|scoring|1|repeated-notes|500|splendid|mp||",
  "sequence/direct/repeated-c4/333ms|direct|discovery|sequence|scoring|1|repeated-notes|333.3333333333333|splendid|mp||",
  "sequence/direct/repeated-c4/250ms|direct|discovery|sequence|scoring|1|repeated-notes|250|splendid|mp||",
  "sequence/direct/repeated-c4/167ms|direct|discovery|sequence|scoring|1|repeated-notes|167|splendid|mp||",
  "sequence/direct/repeated-c4/125ms|direct|discovery|sequence|scoring|1|repeated-notes|125|splendid|mp||",
  "sequence/direct/two-note-progressions/1000ms|direct|discovery|sequence|scoring|1|two-note-chords|1000|splendid|mp||",
  "sequence/direct/two-note-progressions/500ms|direct|discovery|sequence|scoring|1|two-note-chords|500|splendid|mp||",
  "sequence/direct/two-note-progressions/333ms|direct|discovery|sequence|scoring|1|two-note-chords|333.3333333333333|splendid|mp||",
  "sequence/direct/two-note-progressions/250ms|direct|discovery|sequence|scoring|1|two-note-chords|250|splendid|mp||",
  "sequence/direct/two-note-progressions/167ms|direct|discovery|sequence|scoring|1|two-note-chords|167|splendid|mp||",
  "sequence/direct/two-note-progressions/125ms|direct|discovery|sequence|scoring|1|two-note-chords|125|splendid|mp||",
  "sequence/direct/independent-triads/1000ms|direct|discovery|sequence|scoring|1|three-note-independent|1000|splendid|mp||",
  "sequence/direct/independent-triads/500ms|direct|discovery|sequence|scoring|1|three-note-independent|500|splendid|mp||",
  "sequence/direct/independent-triads/333ms|direct|discovery|sequence|scoring|1|three-note-independent|333.3333333333333|splendid|mp||",
  "sequence/direct/independent-triads/250ms|direct|discovery|sequence|scoring|1|three-note-independent|250|splendid|mp||",
  "sequence/direct/independent-triads/167ms|direct|discovery|sequence|scoring|1|three-note-independent|167|splendid|mp||",
  "sequence/direct/independent-triads/125ms|direct|discovery|sequence|scoring|1|three-note-independent|125|splendid|mp||",
  "sequence/direct/shared-sustained-bass/1000ms|direct|discovery|sequence|scoring|1|shared-sustain|1000|splendid|mp||",
  "sequence/direct/shared-sustained-bass/500ms|direct|discovery|sequence|scoring|1|shared-sustain|500|splendid|mp||",
  "sequence/direct/shared-sustained-bass/333ms|direct|discovery|sequence|scoring|1|shared-sustain|333.3333333333333|splendid|mp||",
  "sequence/direct/shared-sustained-bass/250ms|direct|discovery|sequence|scoring|1|shared-sustain|250|splendid|mp||",
  "sequence/direct/shared-sustained-bass/167ms|direct|discovery|sequence|scoring|1|shared-sustain|167|splendid|mp||",
  "sequence/direct/shared-sustained-bass/125ms|direct|discovery|sequence|scoring|1|shared-sustain|125|splendid|mp||",
  "sequence/direct/weak-53-65-74/1000ms|direct|discovery|sequence|scoring|1|known-weak-chord|1000|splendid|mp||",
  "sequence/direct/weak-53-65-74/500ms|direct|discovery|sequence|scoring|1|known-weak-chord|500|splendid|mp||",
  "sequence/direct/weak-53-65-74/333ms|direct|discovery|sequence|scoring|1|known-weak-chord|333.3333333333333|splendid|mp||",
  "sequence/direct/weak-53-65-74/250ms|direct|discovery|sequence|scoring|1|known-weak-chord|250|splendid|mp||",
  "sequence/direct/weak-53-65-74/167ms|direct|discovery|sequence|scoring|1|known-weak-chord|167|splendid|mp||",
  "sequence/direct/weak-53-65-74/125ms|direct|discovery|sequence|scoring|1|known-weak-chord|125|splendid|mp||",
  "sequence/direct/course-clear-27/1000ms|direct|discovery|sequence|scoring|1|course-clear|1000|splendid|mp||",
  "sequence/direct/course-clear-27/500ms|direct|discovery|sequence|scoring|1|course-clear|500|splendid|mp||",
  "sequence/direct/course-clear-27/333ms|direct|discovery|sequence|scoring|1|course-clear|333.3333333333333|splendid|mp||",
  "sequence/direct/course-clear-27/250ms|direct|discovery|sequence|scoring|1|course-clear|250|splendid|mp||",
  "sequence/direct/course-clear-27/167ms|direct|discovery|sequence|scoring|1|course-clear|167|splendid|mp||",
  "sequence/direct/course-clear-27/125ms|direct|discovery|sequence|scoring|1|course-clear|125|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/1000ms|direct|discovery|sequence|scoring|1|rolled-chords|1000|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/500ms|direct|discovery|sequence|scoring|1|rolled-chords|500|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/333ms|direct|discovery|sequence|scoring|1|rolled-chords|333.3333333333333|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/250ms|direct|discovery|sequence|scoring|1|rolled-chords|250|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/167ms|direct|discovery|sequence|scoring|1|rolled-chords|167|splendid|mp||",
  "sequence/direct/slightly-rolled-triads/125ms|direct|discovery|sequence|scoring|1|rolled-chords|125|splendid|mp||",
  "sequence/direct/wrong-note-safety/1000ms|direct|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/direct/wrong-note-safety/500ms|direct|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/direct/wrong-note-safety/333ms|direct|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/direct/wrong-note-safety/250ms|direct|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/direct/wrong-note-safety/167ms|direct|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/direct/wrong-note-safety/125ms|direct|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "sequence/direct/extra-note-safety/1000ms|direct|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/direct/extra-note-safety/500ms|direct|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/direct/extra-note-safety/333ms|direct|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/direct/extra-note-safety/250ms|direct|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/direct/extra-note-safety/167ms|direct|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/direct/extra-note-safety/125ms|direct|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "sequence/direct/carried-bass-safety/1000ms|direct|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/direct/carried-bass-safety/500ms|direct|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/direct/carried-bass-safety/333ms|direct|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/direct/carried-bass-safety/250ms|direct|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/direct/carried-bass-safety/167ms|direct|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/direct/carried-bass-safety/125ms|direct|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "sequence/tone/ascending-scale/1000ms|tone|discovery|sequence|scoring|1|scales|1000|splendid|mp||",
  "sequence/tone/ascending-scale/500ms|tone|discovery|sequence|scoring|1|scales|500|splendid|mp||",
  "sequence/tone/ascending-scale/333ms|tone|discovery|sequence|scoring|1|scales|333.3333333333333|splendid|mp||",
  "sequence/tone/ascending-scale/250ms|tone|discovery|sequence|scoring|1|scales|250|splendid|mp||",
  "sequence/tone/ascending-scale/167ms|tone|discovery|sequence|scoring|1|scales|167|splendid|mp||",
  "sequence/tone/ascending-scale/125ms|tone|discovery|sequence|scoring|1|scales|125|splendid|mp||",
  "sequence/tone/descending-scale/1000ms|tone|discovery|sequence|scoring|1|scales|1000|splendid|mp||",
  "sequence/tone/descending-scale/500ms|tone|discovery|sequence|scoring|1|scales|500|splendid|mp||",
  "sequence/tone/descending-scale/333ms|tone|discovery|sequence|scoring|1|scales|333.3333333333333|splendid|mp||",
  "sequence/tone/descending-scale/250ms|tone|discovery|sequence|scoring|1|scales|250|splendid|mp||",
  "sequence/tone/descending-scale/167ms|tone|discovery|sequence|scoring|1|scales|167|splendid|mp||",
  "sequence/tone/descending-scale/125ms|tone|discovery|sequence|scoring|1|scales|125|splendid|mp||",
  "sequence/tone/alternating-c4-g4/1000ms|tone|discovery|sequence|scoring|1|alternating-pitches|1000|splendid|mp||",
  "sequence/tone/alternating-c4-g4/500ms|tone|discovery|sequence|scoring|1|alternating-pitches|500|splendid|mp||",
  "sequence/tone/alternating-c4-g4/333ms|tone|discovery|sequence|scoring|1|alternating-pitches|333.3333333333333|splendid|mp||",
  "sequence/tone/alternating-c4-g4/250ms|tone|discovery|sequence|scoring|1|alternating-pitches|250|splendid|mp||",
  "sequence/tone/alternating-c4-g4/167ms|tone|discovery|sequence|scoring|1|alternating-pitches|167|splendid|mp||",
  "sequence/tone/alternating-c4-g4/125ms|tone|discovery|sequence|scoring|1|alternating-pitches|125|splendid|mp||",
  "sequence/tone/repeated-c4/1000ms|tone|discovery|sequence|scoring|1|repeated-notes|1000|splendid|mp||",
  "sequence/tone/repeated-c4/500ms|tone|discovery|sequence|scoring|1|repeated-notes|500|splendid|mp||",
  "sequence/tone/repeated-c4/333ms|tone|discovery|sequence|scoring|1|repeated-notes|333.3333333333333|splendid|mp||",
  "sequence/tone/repeated-c4/250ms|tone|discovery|sequence|scoring|1|repeated-notes|250|splendid|mp||",
  "sequence/tone/repeated-c4/167ms|tone|discovery|sequence|scoring|1|repeated-notes|167|splendid|mp||",
  "sequence/tone/repeated-c4/125ms|tone|discovery|sequence|scoring|1|repeated-notes|125|splendid|mp||",
  "sequence/tone/two-note-progressions/1000ms|tone|discovery|sequence|scoring|1|two-note-chords|1000|splendid|mp||",
  "sequence/tone/two-note-progressions/500ms|tone|discovery|sequence|scoring|1|two-note-chords|500|splendid|mp||",
  "sequence/tone/two-note-progressions/333ms|tone|discovery|sequence|scoring|1|two-note-chords|333.3333333333333|splendid|mp||",
  "sequence/tone/two-note-progressions/250ms|tone|discovery|sequence|scoring|1|two-note-chords|250|splendid|mp||",
  "sequence/tone/two-note-progressions/167ms|tone|discovery|sequence|scoring|1|two-note-chords|167|splendid|mp||",
  "sequence/tone/two-note-progressions/125ms|tone|discovery|sequence|scoring|1|two-note-chords|125|splendid|mp||",
  "sequence/tone/independent-triads/1000ms|tone|discovery|sequence|scoring|1|three-note-independent|1000|splendid|mp||",
  "sequence/tone/independent-triads/500ms|tone|discovery|sequence|scoring|1|three-note-independent|500|splendid|mp||",
  "sequence/tone/independent-triads/333ms|tone|discovery|sequence|scoring|1|three-note-independent|333.3333333333333|splendid|mp||",
  "sequence/tone/independent-triads/250ms|tone|discovery|sequence|scoring|1|three-note-independent|250|splendid|mp||",
  "sequence/tone/independent-triads/167ms|tone|discovery|sequence|scoring|1|three-note-independent|167|splendid|mp||",
  "sequence/tone/independent-triads/125ms|tone|discovery|sequence|scoring|1|three-note-independent|125|splendid|mp||",
  "sequence/tone/shared-sustained-bass/1000ms|tone|discovery|sequence|scoring|1|shared-sustain|1000|splendid|mp||",
  "sequence/tone/shared-sustained-bass/500ms|tone|discovery|sequence|scoring|1|shared-sustain|500|splendid|mp||",
  "sequence/tone/shared-sustained-bass/333ms|tone|discovery|sequence|scoring|1|shared-sustain|333.3333333333333|splendid|mp||",
  "sequence/tone/shared-sustained-bass/250ms|tone|discovery|sequence|scoring|1|shared-sustain|250|splendid|mp||",
  "sequence/tone/shared-sustained-bass/167ms|tone|discovery|sequence|scoring|1|shared-sustain|167|splendid|mp||",
  "sequence/tone/shared-sustained-bass/125ms|tone|discovery|sequence|scoring|1|shared-sustain|125|splendid|mp||",
  "sequence/tone/weak-53-65-74/1000ms|tone|discovery|sequence|scoring|1|known-weak-chord|1000|splendid|mp||",
  "sequence/tone/weak-53-65-74/500ms|tone|discovery|sequence|scoring|1|known-weak-chord|500|splendid|mp||",
  "sequence/tone/weak-53-65-74/333ms|tone|discovery|sequence|scoring|1|known-weak-chord|333.3333333333333|splendid|mp||",
  "sequence/tone/weak-53-65-74/250ms|tone|discovery|sequence|scoring|1|known-weak-chord|250|splendid|mp||",
  "sequence/tone/weak-53-65-74/167ms|tone|discovery|sequence|scoring|1|known-weak-chord|167|splendid|mp||",
  "sequence/tone/weak-53-65-74/125ms|tone|discovery|sequence|scoring|1|known-weak-chord|125|splendid|mp||",
  "sequence/tone/course-clear-27/1000ms|tone|discovery|sequence|scoring|1|course-clear|1000|splendid|mp||",
  "sequence/tone/course-clear-27/500ms|tone|discovery|sequence|scoring|1|course-clear|500|splendid|mp||",
  "sequence/tone/course-clear-27/333ms|tone|discovery|sequence|scoring|1|course-clear|333.3333333333333|splendid|mp||",
  "sequence/tone/course-clear-27/250ms|tone|discovery|sequence|scoring|1|course-clear|250|splendid|mp||",
  "sequence/tone/course-clear-27/167ms|tone|discovery|sequence|scoring|1|course-clear|167|splendid|mp||",
  "sequence/tone/course-clear-27/125ms|tone|discovery|sequence|scoring|1|course-clear|125|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/1000ms|tone|discovery|sequence|scoring|1|rolled-chords|1000|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/500ms|tone|discovery|sequence|scoring|1|rolled-chords|500|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/333ms|tone|discovery|sequence|scoring|1|rolled-chords|333.3333333333333|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/250ms|tone|discovery|sequence|scoring|1|rolled-chords|250|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/167ms|tone|discovery|sequence|scoring|1|rolled-chords|167|splendid|mp||",
  "sequence/tone/slightly-rolled-triads/125ms|tone|discovery|sequence|scoring|1|rolled-chords|125|splendid|mp||",
  "sequence/tone/wrong-note-safety/1000ms|tone|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/tone/wrong-note-safety/500ms|tone|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/tone/wrong-note-safety/333ms|tone|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/tone/wrong-note-safety/250ms|tone|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/tone/wrong-note-safety/167ms|tone|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/tone/wrong-note-safety/125ms|tone|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "sequence/tone/extra-note-safety/1000ms|tone|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/tone/extra-note-safety/500ms|tone|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/tone/extra-note-safety/333ms|tone|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/tone/extra-note-safety/250ms|tone|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/tone/extra-note-safety/167ms|tone|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/tone/extra-note-safety/125ms|tone|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "sequence/tone/carried-bass-safety/1000ms|tone|regression-only|sequence|safety|0|safety|1000|splendid|mp||",
  "sequence/tone/carried-bass-safety/500ms|tone|regression-only|sequence|safety|0|safety|500|splendid|mp||",
  "sequence/tone/carried-bass-safety/333ms|tone|regression-only|sequence|safety|0|safety|333.3333333333333|splendid|mp||",
  "sequence/tone/carried-bass-safety/250ms|tone|regression-only|sequence|safety|0|safety|250|splendid|mp||",
  "sequence/tone/carried-bass-safety/167ms|tone|regression-only|sequence|safety|0|safety|167|splendid|mp||",
  "sequence/tone/carried-bass-safety/125ms|tone|regression-only|sequence|safety|0|safety|125|splendid|mp||",
  "articulation/direct/detached|direct|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||detached",
  "articulation/direct/normal|direct|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||normal",
  "articulation/direct/legato|direct|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||legato",
  "articulation/direct/sustained-shared|direct|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||sustained-shared",
  "articulation/tone/detached|tone|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||detached",
  "articulation/tone/normal|tone|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||normal",
  "articulation/tone/legato|tone|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||legato",
  "articulation/tone/sustained-shared|tone|discovery|articulation|scoring|1|course-clear-articulation|1000|splendid|mp||sustained-shared",
  "dynamics-constant/direct/splendid/pp|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|pp||normal",
  "dynamics-constant/direct/splendid/mp|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|mp||normal",
  "dynamics-constant/direct/splendid/mf|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|mf||normal",
  "dynamics-constant/direct/splendid/ff|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|ff||normal",
  "dynamics-constant/direct/salamander/v01|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v01||normal",
  "dynamics-constant/direct/salamander/v02|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v02||normal",
  "dynamics-constant/direct/salamander/v03|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v03||normal",
  "dynamics-constant/direct/salamander/v04|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v04||normal",
  "dynamics-constant/direct/salamander/v05|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v05||normal",
  "dynamics-constant/direct/salamander/v06|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v06||normal",
  "dynamics-constant/direct/salamander/v07|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v07||normal",
  "dynamics-constant/direct/salamander/v08|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v08||normal",
  "dynamics-constant/direct/salamander/v09|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v09||normal",
  "dynamics-constant/direct/salamander/v10|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v10||normal",
  "dynamics-constant/direct/salamander/v11|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v11||normal",
  "dynamics-constant/direct/salamander/v12|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v12||normal",
  "dynamics-constant/direct/salamander/v13|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v13||normal",
  "dynamics-constant/direct/salamander/v14|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v14||normal",
  "dynamics-constant/direct/salamander/v15|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v15||normal",
  "dynamics-constant/direct/salamander/v16|direct|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v16||normal",
  "dynamics-constant/tone/splendid/pp|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|pp||normal",
  "dynamics-constant/tone/splendid/mp|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|mp||normal",
  "dynamics-constant/tone/splendid/mf|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|mf||normal",
  "dynamics-constant/tone/splendid/ff|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|splendid|ff||normal",
  "dynamics-constant/tone/salamander/v01|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v01||normal",
  "dynamics-constant/tone/salamander/v02|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v02||normal",
  "dynamics-constant/tone/salamander/v03|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v03||normal",
  "dynamics-constant/tone/salamander/v04|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v04||normal",
  "dynamics-constant/tone/salamander/v05|tone|regression-only|dynamics-constant|safety|0|course-clear-articulation|1000|salamander|v05||normal",
  "dynamics-constant/tone/salamander/v06|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v06||normal",
  "dynamics-constant/tone/salamander/v07|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v07||normal",
  "dynamics-constant/tone/salamander/v08|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v08||normal",
  "dynamics-constant/tone/salamander/v09|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v09||normal",
  "dynamics-constant/tone/salamander/v10|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v10||normal",
  "dynamics-constant/tone/salamander/v11|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v11||normal",
  "dynamics-constant/tone/salamander/v12|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v12||normal",
  "dynamics-constant/tone/salamander/v13|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v13||normal",
  "dynamics-constant/tone/salamander/v14|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v14||normal",
  "dynamics-constant/tone/salamander/v15|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v15||normal",
  "dynamics-constant/tone/salamander/v16|tone|discovery|dynamics-constant|scoring|1|course-clear-articulation|1000|salamander|v16||normal",
  "dynamics-mixed/direct/splendid|direct|discovery|dynamics-mixed|scoring|1|course-clear-articulation|1000|splendid|||normal",
  "dynamics-mixed/direct/salamander|direct|discovery|dynamics-mixed|scoring|1|course-clear-articulation|1000|salamander|||normal",
  "dynamics-mixed/tone/splendid|tone|discovery|dynamics-mixed|scoring|1|course-clear-articulation|1000|splendid|||normal",
  "dynamics-mixed/tone/salamander|tone|discovery|dynamics-mixed|scoring|1|course-clear-articulation|1000|salamander|||normal",
  "isolated/direct/001|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/002|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/003|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/004|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/005|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/006|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/007|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/008|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/009|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/010|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/011|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/012|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/013|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/014|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/015|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/016|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/017|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/018|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/019|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/020|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/021|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/022|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/023|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/024|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/025|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/026|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/027|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/028|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/029|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/030|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/031|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/032|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/033|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/034|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/035|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/036|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/037|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/038|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/039|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/040|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/041|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/042|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/043|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/044|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/045|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/046|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/047|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/048|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/049|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/050|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/051|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/052|direct|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/direct/053|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/054|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/055|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/056|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/057|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/058|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/059|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/060|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/061|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/062|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/063|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/064|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/065|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/066|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/067|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/068|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/069|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/070|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/071|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/072|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/073|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/074|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/075|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/076|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/077|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/078|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/079|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/080|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/081|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/082|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/083|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/084|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/085|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/086|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/087|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/088|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/089|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/090|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/091|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/092|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/093|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/094|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/095|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/096|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/097|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/098|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/099|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/100|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/101|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/102|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/103|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/104|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/105|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/106|direct|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/direct/107|direct|regression-only|isolated|safety|0|general||splendid|mp|distinguishable-wrong|",
  "isolated/direct/108|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/109|direct|regression-only|isolated|safety|0|general||splendid|mp|distinguishable-wrong|",
  "isolated/direct/110|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/111|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/112|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/113|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/114|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/115|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/116|direct|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/direct/117|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/118|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/119|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/120|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/121|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/122|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/123|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/124|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/125|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/126|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/127|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/128|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/129|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/130|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/131|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/132|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/133|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/direct/134|direct|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/001|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/002|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/003|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/004|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/005|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/006|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/007|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/008|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/009|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/010|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/011|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/012|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/013|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/014|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/015|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/016|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/017|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/018|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/019|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/020|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/021|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/022|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/023|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/024|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/025|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/026|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/027|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/028|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/029|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/030|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/031|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/032|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/033|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/034|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/035|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/036|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/037|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/038|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/039|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/040|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/041|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/042|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/043|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/044|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/045|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/046|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/047|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/048|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/049|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/050|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/051|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/052|tone|discovery|isolated|scoring|1|general||splendid|mp|correct|",
  "isolated/tone/053|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/054|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/055|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/056|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/057|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/058|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/059|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/060|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/061|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/062|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/063|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/064|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/065|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/066|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/067|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/068|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/069|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/070|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/071|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/072|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/073|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/074|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/075|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/076|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/077|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/078|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/079|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/080|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/081|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/082|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/083|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/084|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/085|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/086|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/087|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/088|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/089|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/090|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/091|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/092|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/093|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/094|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/095|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/096|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/097|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/098|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/099|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/100|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/101|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/102|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/103|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/104|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/105|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/106|tone|discovery|isolated|scoring|1|course-clear||splendid|mp|correct|",
  "isolated/tone/107|tone|regression-only|isolated|safety|0|general||splendid|mp|distinguishable-wrong|",
  "isolated/tone/108|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/109|tone|regression-only|isolated|safety|0|general||splendid|mp|distinguishable-wrong|",
  "isolated/tone/110|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/111|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/112|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/113|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/114|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/115|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/116|tone|regression-only|isolated|diagnostic|0|general||splendid|mp|ambiguous-harmonic|",
  "isolated/tone/117|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/118|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/119|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/120|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/121|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/122|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/123|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/124|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/125|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/126|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/127|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/128|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/129|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/130|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/131|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/132|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/133|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "isolated/tone/134|tone|regression-only|isolated|safety|0|course-clear||splendid|mp|omitted-bass|",
  "regression/tone-salamander-v05-repeated-chord-late-advance|tone|regression-only|safety-regression|safety|0|safety-regression|1000|salamander|v05||",
  "regression/tone-course-clear-333-shared-pitch-false-advance|tone|regression-only|safety-regression|safety|0|safety-regression|333.3333333333333|splendid|mp||",
  "regression/isolated-direct-122|direct|regression-only|safety-regression|safety|0|isolated-omitted-bass||splendid|mp|omitted-bass|",
  "regression/isolated-tone-124|tone|regression-only|safety-regression|safety|0|isolated-omitted-bass||splendid|mp|omitted-bass|",
  "round-two/r2-repeated-low-triad-direct-splendid-pp/correct|direct|discovery|round-two-paired|scoring|1|round-two-repeated-identical|167|splendid|pp|correct|detached",
  "round-two/r2-repeated-low-triad-direct-splendid-pp/omitted-bass|direct|discovery|round-two-paired|safety|0|round-two-repeated-identical|167|splendid|pp|omitted-bass|detached",
  "round-two/r2-repeated-low-triad-direct-splendid-pp/distinguishable-wrong|direct|discovery|round-two-paired|safety|0|round-two-repeated-identical|167|splendid|pp|distinguishable-wrong|detached",
  "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/correct|tone|discovery|round-two-paired|scoring|1|round-two-repeated-identical|500|salamander|v13|correct|sustained-shared",
  "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/omitted-bass|tone|discovery|round-two-paired|safety|0|round-two-repeated-identical|500|salamander|v13|omitted-bass|sustained-shared",
  "round-two/r2-repeated-mid-tetrad-tone-salamander-v13/distinguishable-wrong|tone|discovery|round-two-paired|safety|0|round-two-repeated-identical|500|salamander|v13|distinguishable-wrong|sustained-shared",
  "round-two/r2-paired-mid-triad-direct-salamander-v10/correct|direct|discovery|round-two-paired|scoring|1|round-two-paired|500|salamander|v10|correct|normal",
  "round-two/r2-paired-mid-triad-direct-salamander-v10/omitted-bass|direct|discovery|round-two-paired|safety|0|round-two-paired|500|salamander|v10|omitted-bass|normal",
  "round-two/r2-paired-mid-triad-direct-salamander-v10/distinguishable-wrong|direct|discovery|round-two-paired|safety|0|round-two-paired|500|salamander|v10|distinguishable-wrong|normal",
  "round-two/r2-paired-high-tetrad-tone-splendid-ff/correct|tone|discovery|round-two-paired|scoring|1|round-two-paired|500|splendid|ff|correct|legato",
  "round-two/r2-paired-high-tetrad-tone-splendid-ff/omitted-bass|tone|discovery|round-two-paired|safety|0|round-two-paired|500|splendid|ff|omitted-bass|legato",
  "round-two/r2-paired-high-tetrad-tone-splendid-ff/distinguishable-wrong|tone|discovery|round-two-paired|safety|0|round-two-paired|500|splendid|ff|distinguishable-wrong|legato",
  "round-two/r2-repeated-high-triad-tone-splendid-mf/correct|tone|confirmation|round-two-paired|scoring|1|round-two-repeated-identical|333|splendid|mf|correct|normal",
  "round-two/r2-repeated-high-triad-tone-splendid-mf/omitted-bass|tone|confirmation|round-two-paired|safety|0|round-two-repeated-identical|333|splendid|mf|omitted-bass|normal",
  "round-two/r2-repeated-high-triad-tone-splendid-mf/distinguishable-wrong|tone|confirmation|round-two-paired|safety|0|round-two-repeated-identical|333|splendid|mf|distinguishable-wrong|normal",
  "round-two/r2-repeated-mid-tetrad-direct-salamander-v03/correct|direct|confirmation|round-two-paired|scoring|1|round-two-repeated-identical|500|salamander|v03|correct|legato",
  "round-two/r2-repeated-mid-tetrad-direct-salamander-v03/omitted-bass|direct|confirmation|round-two-paired|safety|0|round-two-repeated-identical|500|salamander|v03|omitted-bass|legato",
  "round-two/r2-repeated-mid-tetrad-direct-salamander-v03/distinguishable-wrong|direct|confirmation|round-two-paired|safety|0|round-two-repeated-identical|500|salamander|v03|distinguishable-wrong|legato",
  "round-two/r2-paired-low-tetrad-tone-salamander-v05/correct|tone|confirmation|round-two-paired|scoring|1|round-two-paired|333|salamander|v05|correct|detached",
  "round-two/r2-paired-low-tetrad-tone-salamander-v05/omitted-bass|tone|confirmation|round-two-paired|safety|0|round-two-paired|333|salamander|v05|omitted-bass|detached",
  "round-two/r2-paired-low-tetrad-tone-salamander-v05/distinguishable-wrong|tone|confirmation|round-two-paired|safety|0|round-two-paired|333|salamander|v05|distinguishable-wrong|detached",
  "round-two/r2-paired-high-triad-direct-splendid-mp/correct|direct|confirmation|round-two-paired|scoring|1|round-two-paired|500|splendid|mp|correct|sustained-shared",
  "round-two/r2-paired-high-triad-direct-splendid-mp/omitted-bass|direct|confirmation|round-two-paired|safety|0|round-two-paired|500|splendid|mp|omitted-bass|sustained-shared",
  "round-two/r2-paired-high-triad-direct-splendid-mp/distinguishable-wrong|direct|confirmation|round-two-paired|safety|0|round-two-paired|500|splendid|mp|distinguishable-wrong|sustained-shared",
]);

/** `DeterministicHasher` restated here, so an archive's identity is recomputed. */
function deterministicDigest(write) {
  let hash = 0x811c9dc5;
  const scratch = new DataView(new ArrayBuffer(8));
  const byte = (value) => {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193) >>> 0;
  };
  write({
    text(value, terminate = true) {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        byte(code & 0xff);
        byte(code >>> 8);
      }
      if (terminate) byte(0);
    },
    number(value) {
      scratch.setFloat64(0, value);
      for (let index = 0; index < 8; index += 1) byte(scratch.getUint8(index));
    },
  });
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The captured corpus's identity, recomputed from the archived captures. */
export const ROUND_TWO_CAPTURE_IDENTITY_FIELDS = Object.freeze([
  "traceId",
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
]);

/**
 * The captured corpus's identity, recomputed from the archived captures.
 *
 * It covers every field a gate's domains are grouped on, not only the four that
 * name a row: a copied corpus whose speeds, layers, or articulations had drifted
 * would otherwise keep this digest while silently re-grouping every domain.
 */
export function capturedCorpusIdentity(captures) {
  return deterministicDigest((hasher) => {
    hasher.number(captures.length);
    for (const capture of captures) {
      for (const field of ROUND_TWO_CAPTURE_IDENTITY_FIELDS) {
        const value = capture?.[field];
        hasher.text(value === true ? "1" : value === false ? "0" : String(value ?? ""));
      }
    }
  });
}

/**
 * The frozen list, parsed into the shape a capture takes.
 *
 * The extra fields are the ones each gate groups its domains on — renderer,
 * speed, family, piano, layer, case kind, and whether the row scores. They are
 * part of the frozen corpus rather than of the archive, so a gate's domain
 * membership is derived from the manifest instead of taken from whatever
 * grouping an archive chose to report.
 */
export function roundTwoCaptureIdentityRows() {
  return ROUND_TWO_CAPTURE_IDENTITIES.map((entry) => {
    const [
      traceId,
      rendererKey,
      partition,
      suite,
      evidenceRole,
      scoreEligible,
      sequenceFamily,
      intervalMs,
      piano,
      layer,
      caseKind,
      articulation,
    ] = entry.split("|");
    return {
      traceId,
      rendererKey,
      partition,
      suite,
      evidenceRole,
      scoreEligible: scoreEligible === "1",
      sequenceFamily,
      intervalMs,
      piano,
      layer,
      caseKind,
      articulation,
    };
  });
}

// The list and the digest are two statements of one fact, so they are bound at
// load rather than left to agree by inspection.
if (capturedCorpusIdentity(roundTwoCaptureIdentityRows()) !==
    ROUND_TWO_CONFIRMATION_MATRIX.captureIdentityDigest) {
  throw new Error(
    "The frozen capture identity list does not hash to the pinned capture identity digest.",
  );
}

/**
 * What each frozen gate compares, and on which rows.
 *
 * Every gate in this set is a paired non-regression against the incumbent on the
 * identical corpus — the validation policy states it directly
 * (`correctnessEligibility: "paired-non-regression"`, with the absolute
 * recognition rates recorded as product debt rather than as eligibility). That is
 * what makes independent re-derivation possible without freezing a second copy of
 * any threshold here: for all but the latency gates the comparison is "this
 * counter did not fall below the incumbent's on the same domain", and the two
 * latency gates carry the only frozen scalars, restated from the benchmark.
 *
 * `counter` names the per-domain measure. `absolute` gates fail on any nonzero
 * value rather than on a fall from the baseline.
 */
export const ROUND_TWO_LATENCY_LIMIT_MS = 400;
export const ROUND_TWO_LATENCY_REGRESSION_TOLERANCE_MS = 32;
/** A single row may lose one independent event before its layer gate fails. */
export const ROUND_TWO_LAYER_INDEPENDENT_LOSS_ALLOWANCE = 1;
/** An improvement must be present in more than one sequence family. */
export const ROUND_TWO_FAMILY_BREADTH_MINIMUM = 2;

export const ROUND_TWO_GATE_MEASURES = Object.freeze({
  "replay-trace-reuse": Object.freeze({ kind: "replay-reuse" }),
  "replay-baseline-parity": Object.freeze({ kind: "replay-parity" }),
  // The dedicated families gate absolutely, at every speed, and the carried-bass
  // rule is one of the four counts it reads.
  "safety-isolated-false-advance": Object.freeze({ kind: "absolute-unsafe" }),
  "safety-sequence-dedicated-families": Object.freeze({ kind: "absolute-unsafe" }),
  "safety-sequence-introduced-advance": Object.freeze({ kind: "introduced-unsafe" }),
  "safety-dynamics-introduced-advance": Object.freeze({ kind: "introduced-unsafe" }),
  "safety-committed-regression": Object.freeze({ kind: "committed-regression" }),
  "release-isolated-recognition": Object.freeze({ kind: "no-fall", counter: "correctAdvanceCount" }),
  "release-isolated-course-clear": Object.freeze({
    kind: "no-fall",
    counter: "courseClearCorrectAdvanceCount",
  }),
  "release-isolated-latency": Object.freeze({ kind: "latency-absolute" }),
  "release-dynamics-piano-recognition": Object.freeze({
    kind: "no-fall",
    counter: "independentMatchCount",
  }),
  "release-dynamics-layer-loss": Object.freeze({ kind: "layer-loss" }),
  "consistency-sequence-speed-recognition": Object.freeze({
    kind: "no-fall",
    counter: "independentMatchCount",
  }),
  "consistency-sequence-ordered-progress": Object.freeze({ kind: "ordered-progress" }),
  "consistency-sequence-family-breadth": Object.freeze({ kind: "family-breadth" }),
  "consistency-sequence-latency": Object.freeze({ kind: "latency-regression" }),
  "consistency-dynamics-piano-recognition": Object.freeze({
    kind: "no-fall",
    counter: "independentMatchCount",
  }),
  "consistency-dynamics-layer-loss": Object.freeze({ kind: "layer-loss" }),
});

/**
 * The per-domain measures every archived summary row must carry.
 *
 * `incompleteCarriedBassAdvances` is one of them because the dedicated sequence
 * families gate treats it as an absolute failure at every speed, exactly like a
 * false, skipped, or duplicate advance. Omitting it from the archive would make
 * that quarter of the rule unrecomputable.
 */
export const ROUND_TWO_DOMAIN_SUMMARY_COUNTERS = Object.freeze([
  "correctAdvanceCount",
  "courseClearCorrectAdvanceCount",
  "independentMatchCount",
  "orderedAdvanceCount",
  "completePassageCount",
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvances",
]);

/**
 * Which captured rows each gate reads, and how it groups them into domains.
 *
 * `suites` and `role` narrow the gate's partitions to the rows it actually
 * judges — a speed-recognition gate reads scored sequence rows, not every
 * discovery row — and `groupBy` names the manifest fields whose distinct
 * combinations are that gate's domains. Membership is therefore derived from the
 * frozen corpus rather than from whatever grouping an archive chose to report,
 * and it is compared as a partition of trace identifiers rather than by label,
 * so an archive is free to name its domains however it likes and still has to
 * have measured the same groups.
 *
 * This recipe is a reading of the benchmark's own domain construction rather than
 * something the benchmark exports. It is the part of this validator most worth
 * re-checking against `listenProfileValidationBenchmark.ts` before a later round
 * relies on it; emitting the mapping from that module as a digest-bound artifact
 * would remove the judgement entirely.
 */
const SEQUENCE_SUITES = Object.freeze(["sequence"]);
const DYNAMICS_SUITES = Object.freeze(["dynamics-constant", "dynamics-mixed", "articulation"]);
/** The piano groupings exclude articulation, which has no piano leaf of its own. */
const PIANO_SUITES = Object.freeze(["dynamics-constant", "dynamics-mixed"]);
/**
 * One leaf per constant layer, per mixed run, and per articulation.
 *
 * Grouping by renderer, piano, and layer alone merges every articulation sharing
 * the default piano and layer with each other and with a constant-layer row, so
 * one leaf's loss could be offset inside the combined domain. Adding the suite
 * and the articulation separates them exactly as the benchmark's own leaf
 * definitions do.
 */
const LAYER_LEAF_GROUP = Object.freeze([
  "rendererKey",
  "suite",
  "piano",
  "layer",
  "articulation",
]);
const ISOLATED_SUITES = Object.freeze(["isolated"]);

export const ROUND_TWO_GATE_DOMAINS = Object.freeze({
  "safety-isolated-false-advance": Object.freeze({
    suites: ISOLATED_SUITES,
    role: "safety",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "safety-sequence-dedicated-families": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: "safety",
    groupBy: Object.freeze(["rendererKey", "intervalMs"]),
  }),
  "safety-sequence-introduced-advance": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: null,
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "safety-dynamics-introduced-advance": Object.freeze({
    suites: DYNAMICS_SUITES,
    role: null,
    groupBy: Object.freeze(["rendererKey", "piano"]),
  }),
  "release-isolated-recognition": Object.freeze({
    suites: ISOLATED_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "release-isolated-course-clear": Object.freeze({
    suites: ISOLATED_SUITES,
    role: "scoring",
    sequenceFamily: "course-clear",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "release-isolated-latency": Object.freeze({
    suites: ISOLATED_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "release-dynamics-piano-recognition": Object.freeze({
    suites: PIANO_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey", "piano"]),
  }),
  "release-dynamics-layer-loss": Object.freeze({
    suites: DYNAMICS_SUITES,
    role: "scoring",
    groupBy: LAYER_LEAF_GROUP,
  }),
  "consistency-sequence-speed-recognition": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey", "intervalMs"]),
  }),
  "consistency-sequence-ordered-progress": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  // Netted across renderers, so the family alone is the domain.
  "consistency-sequence-family-breadth": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["sequenceFamily"]),
  }),
  "consistency-sequence-latency": Object.freeze({
    suites: SEQUENCE_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey"]),
  }),
  "consistency-dynamics-piano-recognition": Object.freeze({
    suites: PIANO_SUITES,
    role: "scoring",
    groupBy: Object.freeze(["rendererKey", "piano"]),
  }),
  "consistency-dynamics-layer-loss": Object.freeze({
    suites: DYNAMICS_SUITES,
    role: "scoring",
    groupBy: LAYER_LEAF_GROUP,
  }),
});

/**
 * The one problem a completed archive cannot fix.
 *
 * Task 13 froze the gate partitions against manifest version 1; version 2
 * re-partitioned the corpus and left the release gates with no rows to read.
 * That is an unfrozen round-two policy rather than a defect in any archive, so
 * it is reported but does not stop the rest of the archive from being held to
 * its own evidence.
 */
export const ROUND_TWO_UNFROZEN_SCOPE = "its round-two scope is not frozen";

/**
 * The committed regressions the gate reads, frozen by identity and expectation.
 *
 * Requiring only a well-shaped row would let one invented safe fixture stand in
 * for both diagnosed cases, which is the whole evidence that gate exists to
 * carry. The identifiers and expectations are the fixtures' own.
 */
export const ROUND_TWO_COMMITTED_REGRESSIONS = Object.freeze([
  Object.freeze({
    fixtureId: "tone-salamander-v05-repeated-chord-late-advance",
    expectation: "late-advance",
  }),
  Object.freeze({
    fixtureId: "tone-course-clear-333-shared-pitch-false-advance",
    expectation: "reported-unsafe-advance",
  }),
]);

/** The exact domains one gate reads, as a partition of trace identifiers. */
export function roundTwoGateDomainMembership(gate, captures = roundTwoCaptureIdentityRows()) {
  const recipe = ROUND_TWO_GATE_DOMAINS[gate.code];
  if (recipe === undefined) return null;
  const scoped = captures.filter((capture) => (
    gate.partitions.includes(capture.partition) &&
    recipe.suites.includes(capture.suite) &&
    (recipe.role === null || capture.evidenceRole === recipe.role) &&
    (recipe.sequenceFamily === undefined || capture.sequenceFamily === recipe.sequenceFamily)
  ));
  const domains = new Map();
  for (const capture of scoped) {
    const key = recipe.groupBy.map((field) => capture[field]).join("|");
    domains.set(key, [...(domains.get(key) ?? []), capture.traceId]);
  }
  return [...domains.values()].map((traceIds) => traceIds.slice().sort());
}

/**
 * The gates that read no manifest-version-2 row, and so cannot be re-derived.
 *
 * Empty is the only value that lets a completed run clear a candidate; while it
 * is non-empty, a round-two gate scope has to be frozen as policy first.
 */
export function roundTwoUnfrozenGateScopes(captures = roundTwoCaptureIdentityRows()) {
  return CONFIRMATION_EVIDENCE.gates
    .filter((gate) => roundTwoGateDomainMembership(gate, captures)?.length === 0)
    .map(({ code }) => code);
}

/** Two partitions of trace identifiers, compared as sets of groups. */
function samePartition(left, right) {
  if (left.length !== right.length) return false;
  const encode = (groups) => groups.map((group) => group.join("\u0001")).sort();
  return sameList(encode(left), encode(right));
}

/** The four counts the dedicated-family gate holds at zero, every speed. */
const ABSOLUTE_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvances",
]);

/** The three a candidate may not worsen relative to its incumbent. */
const INTRODUCED_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
]);

function domainSummaryIndex(summaries) {
  const index = new Map();
  for (const row of summaries) {
    index.set(`${row?.profileId}\u0000${row?.gateCode}\u0000${row?.domainId}`, row);
  }
  return index;
}

/**
 * Rederives one gate's verdict for one candidate from the archived summaries.
 *
 * Each branch restates the benchmark's own rule for that gate rather than a
 * convenient approximation of it: a re-derivation that is merely rule-shaped
 * would clear candidates the real evaluator rejects, which is worse than not
 * re-deriving at all. Returns the failures the measurements produce; the
 * archive's own `passed` is never consulted here.
 */
function rederiveGateVerdict(options) {
  const { gate, profileId, summaries, index, outcomes, captures, baselineProfileId } = options;
  const measure = ROUND_TWO_GATE_MEASURES[gate.code];
  const rows = summaries.filter((row) => (
    row?.gateCode === gate.code && row?.profileId === profileId
  ));
  const baselineOf = (row) => index.get(
    `${baselineProfileId}\u0000${gate.code}\u0000${row.domainId}`,
  );
  const failures = [];
  if (measure.kind === "replay-reuse") {
    const captureById = new Map(captures.map((capture) => [capture.traceId, capture]));
    for (const row of outcomes) {
      const capture = captureById.get(row?.traceId);
      if (capture === undefined) continue;
      if (row.capturePcmHash !== capture.processLocalPcmHash ||
          row.captureTraceHash !== capture.processLocalTraceHash) {
        failures.push(row.traceId);
      }
    }
    return failures;
  }
  if (measure.kind === "replay-parity") {
    for (const capture of captures) {
      const baselineRow = outcomes.find((row) => (
        row?.traceId === capture.traceId && row?.profileId === baselineProfileId
      ));
      if (baselineRow?.outcomeDigest !== capture.baselineOutcomeDigest) {
        failures.push(capture.traceId);
      }
    }
    return failures;
  }
  if (measure.kind === "committed-regression") {
    // A diagnosed case is not held to absolute zero: it is held to not
    // worsening. The known Tone 333 ms false advance may stay exactly as
    // diagnosed, and an absolute rule would reject the incumbent's own evidence.
    // A pinned late advance is a recovery rather than a safety event — it may
    // move earlier — but it may never become unsafe.
    for (const outcome of options.committedRegressions) {
      if (outcome?.worseThanBaseline === true) {
        failures.push(`${outcome.fixtureId}:worse-than-baseline`);
        continue;
      }
      if (outcome?.expectation !== "late-advance") continue;
      if (outcome.falseAdvance === true || (outcome.skippedAdvanceCount ?? 0) > 0 ||
          (outcome.duplicateAdvanceCount ?? 0) > 0) {
        failures.push(`${outcome.fixtureId}:late-advance-became-unsafe`);
      }
    }
    return failures;
  }
  if (measure.kind === "absolute-unsafe") {
    // Zero at every domain, not on average: a profile that is safe on average is
    // not safe.
    for (const row of rows) {
      for (const counter of ABSOLUTE_UNSAFE_COUNTERS) {
        if ((row[counter] ?? 0) > 0) failures.push(`${row.domainId}:${counter}`);
      }
    }
    return failures;
  }
  if (measure.kind === "introduced-unsafe") {
    for (const row of rows) {
      const baseline = baselineOf(row);
      for (const counter of INTRODUCED_UNSAFE_COUNTERS) {
        if ((row[counter] ?? 0) > (baseline?.[counter] ?? 0)) {
          failures.push(`${row.domainId}:${counter}`);
        }
      }
    }
    return failures;
  }
  if (measure.kind === "latency-absolute") {
    // The isolated gate rejects an absent percentile, applies the absolute
    // limit, and then the regression tolerance.
    for (const row of rows) {
      const baseline = baselineOf(row);
      const candidateP95 = row.p95OnsetToAdvanceMs;
      const baselineP95 = baseline?.p95OnsetToAdvanceMs ?? null;
      if (candidateP95 === null || candidateP95 === undefined) {
        failures.push(`${row.domainId}:absent`);
      } else if (candidateP95 >= ROUND_TWO_LATENCY_LIMIT_MS) {
        failures.push(`${row.domainId}:limit`);
      } else if (baselineP95 !== null &&
          candidateP95 > baselineP95 + ROUND_TWO_LATENCY_REGRESSION_TOLERANCE_MS) {
        failures.push(`${row.domainId}:regression`);
      }
    }
    return failures;
  }
  if (measure.kind === "latency-regression") {
    // The sequence gate checks only the regression, and only where both
    // percentiles exist: an absent p95 is not a failure there, and no absolute
    // limit applies. Sharing the isolated rule here would reject candidates the
    // real evaluator clears.
    for (const row of rows) {
      const baseline = baselineOf(row);
      const candidateP95 = row.p95OnsetToAdvanceMs ?? null;
      const baselineP95 = baseline?.p95OnsetToAdvanceMs ?? null;
      if (candidateP95 !== null && baselineP95 !== null &&
          candidateP95 > baselineP95 + ROUND_TWO_LATENCY_REGRESSION_TOLERANCE_MS) {
        failures.push(`${row.domainId}:regression`);
      }
    }
    return failures;
  }
  if (measure.kind === "layer-loss") {
    // A single row may lose one independent event; the gate fails beyond that.
    for (const row of rows) {
      const baseline = baselineOf(row);
      const delta = (row.independentMatchCount ?? 0) - (baseline?.independentMatchCount ?? 0);
      if (delta < -ROUND_TWO_LAYER_INDEPENDENT_LOSS_ALLOWANCE) {
        failures.push(`${row.domainId}:independentMatchCount`);
      }
    }
    return failures;
  }
  if (measure.kind === "ordered-progress") {
    // Both halves: ordered advances and completed passages, each per renderer,
    // so a gain in one cannot offset a loss in the other.
    for (const row of rows) {
      const baseline = baselineOf(row);
      for (const counter of ["orderedAdvanceCount", "completePassageCount"]) {
        if ((row[counter] ?? 0) < (baseline?.[counter] ?? 0)) {
          failures.push(`${row.domainId}:${counter}`);
        }
      }
    }
    return failures;
  }
  if (measure.kind === "no-fall") {
    for (const row of rows) {
      const baseline = baselineOf(row);
      if ((row[measure.counter] ?? 0) < (baseline?.[measure.counter] ?? 0)) {
        failures.push(`${row.domainId}:${measure.counter}`);
      }
    }
    return failures;
  }
  // Family breadth: netted per family across renderers, and only asked when the
  // candidate actually claims a gain.
  const orderedNetByFamily = new Map();
  const independentNetByFamily = new Map();
  for (const row of rows) {
    const baseline = baselineOf(row);
    orderedNetByFamily.set(
      row.domainId,
      (row.orderedAdvanceCount ?? 0) - (baseline?.orderedAdvanceCount ?? 0),
    );
    independentNetByFamily.set(
      row.domainId,
      (row.independentMatchCount ?? 0) - (baseline?.independentMatchCount ?? 0),
    );
  }
  const sum = (values) => [...values].reduce((total, value) => total + value, 0);
  const orderedNetTotal = sum(orderedNetByFamily.values());
  const independentNetTotal = sum(independentNetByFamily.values());
  const orderedImproved = [...orderedNetByFamily]
    .filter(([, net]) => net > 0).map(([family]) => family).sort();
  const independentImproved = new Set([...independentNetByFamily]
    .filter(([, net]) => net > 0).map(([family]) => family));
  const improved = [...new Set([...orderedImproved, ...independentImproved])];
  if (orderedNetTotal > 0 || independentNetTotal > 0) {
    if (improved.length < ROUND_TWO_FAMILY_BREADTH_MINIMUM) {
      failures.push(`breadth:${improved.length}`);
    }
    // Cascade amplification is disproved in the same family the claim is made
    // in, so the two sets are intersected rather than both merely non-empty.
    const corroborated = orderedImproved.filter((family) => independentImproved.has(family));
    if (orderedNetTotal > 0 && corroborated.length === 0) {
      failures.push("corroboration:none");
    }
  }
  return failures;
}

/**
 * Every frozen gate's verdict for one candidate, rederived from the archive's
 * own measurements.
 *
 * This is the whole point of archiving domain summaries: a `passed` boolean is a
 * claim, and a claim beside a consistent failure list is still a claim. Each
 * verdict here is recomputed from the counters the gate actually compares and
 * returned beside its code, so the caller can hold the report to its own
 * evidence.
 */
export function rederiveRoundTwoGateVerdicts(run, profileId) {
  const summaries = Array.isArray(run?.domainSummaries) ? run.domainSummaries : [];
  const outcomes = Array.isArray(run?.outcomes) ? run.outcomes : [];
  const captures = Array.isArray(run?.captures) ? run.captures : [];
  const index = domainSummaryIndex(summaries);
  return CONFIRMATION_EVIDENCE.gates.map((gate) => ({
    code: gate.code,
    role: gate.role,
    failures: rederiveGateVerdict({
      gate,
      profileId,
      summaries,
      index,
      outcomes,
      captures,
      committedRegressions: (run?.committedRegressions ?? [])
        .filter((outcome) => outcome?.profileId === profileId),
      baselineProfileId: ROUND_TWO_CONFIRMATION_MATRIX.baselineProfileId,
    }),
  }));
}

/**
 * Unsafe advances a candidate introduced that its baseline did not, recomputed
 * per trace from the archived outcome rows.
 *
 * A gate verdict is a claim about these rows. `passed: true` beside an empty
 * failure list is internally consistent and can still be false, so the claim is
 * checked against the measurements it is about: a candidate that advanced falsely
 * where the incumbent did not has introduced an unsafe event, whatever its gate
 * report says. The comparison is per trace and per counter rather than over a
 * corpus total, because a corpus aggregate hides a regression on one trace behind
 * an improvement on another.
 */
export function introducedUnsafeEvents(outcomes, baselineProfileId, profileId) {
  const baselineByTrace = new Map();
  for (const row of outcomes) {
    if (row?.profileId === baselineProfileId) baselineByTrace.set(row.traceId, row);
  }
  const introduced = [];
  for (const row of outcomes) {
    if (row?.profileId !== profileId) continue;
    const baseline = baselineByTrace.get(row.traceId);
    for (const counter of ["falseAdvanceCount", "skippedAdvanceCount", "duplicateAdvanceCount"]) {
      const candidateValue = row[counter] ?? 0;
      const baselineValue = baseline?.[counter] ?? 0;
      if (candidateValue > baselineValue) {
        introduced.push({
          traceId: row.traceId,
          counter,
          baseline: baselineValue,
          candidate: candidateValue,
        });
      }
    }
  }
  return introduced;
}

/**
 * Everything a decoded repeated-chord observation must actually record.
 *
 * The comparison treats an absent flag as false and an absent count as zero, so
 * a row of `{}` reads as a clean, unregressed measurement. It is not a
 * measurement at all, and a completed run may not derive eligibility from one.
 */
function observationProblems(row, where) {
  const matrix = ROUND_TWO_CONFIRMATION_MATRIX;
  const observation = row?.observation;
  if (typeof observation !== "object" || observation === null) {
    return [`${where} archives no observation for ${row?.groupId}`];
  }
  const problems = [];
  const at = `${where} ${row.groupId}`;
  for (const flag of matrix.observationFlags) {
    if (typeof observation[flag] !== "boolean") {
      problems.push(`${at} records no ${flag}`);
    }
  }
  if (observation.evaluated !== true) problems.push(`${at} was never evaluated`);
  if (observation.structurallyValid !== true) problems.push(`${at} is not structurally valid`);
  for (const counter of ["falseAdvanceCount", "skippedAdvanceCount", "duplicateAdvanceCount"]) {
    if (!Number.isInteger(observation[counter]) || observation[counter] < 0) {
      problems.push(`${at} records ${counter} ${printable(observation[counter])}`);
    }
  }
  const { sourceDistance, attributionDelayMs } = observation;
  if (sourceDistance !== null && (!Number.isInteger(sourceDistance) || sourceDistance < 0)) {
    problems.push(`${at} records source distance ${printable(sourceDistance)}`);
  }
  if (attributionDelayMs !== null &&
      (!Number.isFinite(attributionDelayMs) || attributionDelayMs < 0)) {
    problems.push(`${at} records attribution delay ${printable(attributionDelayMs)}`);
  }
  // The policy requires the pair together: one without the other would make a
  // regression or a gain incomparable.
  if ((sourceDistance === null) !== (attributionDelayMs === null)) {
    problems.push(`${at} records a source distance and delay that do not travel together`);
  }
  return problems;
}

function censusKey(partition, suite) {
  return `${partition}/${suite}`;
}

/** The per-partition, per-suite coverage the archived captures actually show. */
function recomputedCaptureCensus(captures) {
  const counts = new Map();
  for (const capture of captures) {
    const key = censusKey(capture?.partition, capture?.suite);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Everything that must be true of one archived Task 28 repetition.
 *
 * The checks are independent and all of them run, so a wrong file reports every
 * way it is wrong at once. They are stated against the frozen matrix rather than
 * against the other archive, because two archives can agree perfectly and still
 * both be the wrong evidence — which is exactly what comparing hashes alone
 * cannot see. Nothing the file says about its own coverage is taken as coverage:
 * the census, the trace count, the confirmation reads, and the per-profile
 * outcome rows are all recomputed from the archived captures and outcomes.
 */
export function roundTwoConfirmationMatrixProblems(record, label, candidateProfileIds, expected) {
  const problems = [];
  const report = (message) => problems.push(`${label}: ${message}`);
  const results = Array.isArray(record) ? record : [record];
  if (results.length !== 1 || typeof results[0] !== "object" || results[0] === null) {
    return [`${label}: holds ${results.length} benchmark results, and the matrix is one`];
  }
  const [run] = results;
  const matrix = ROUND_TWO_CONFIRMATION_MATRIX;
  const check = (what, actual, wanted) => {
    if (actual !== wanted) report(`${what} ${printable(actual)}, expected ${printable(wanted)}`);
  };
  check("command", run.name, matrix.name);
  check("format version", run.formatVersion, matrix.formatVersion);
  check("manifest version", run.manifest?.version, matrix.manifestVersion);
  check("manifest hash", run.manifest?.hash, matrix.manifestHash);
  check("corpus hash", run.manifest?.corpusHash, matrix.manifestCorpusHash);
  check("registry version", run.registryVersion, matrix.registryVersion);
  check("policy version", run.selectionPolicy?.version, matrix.policyVersion);
  check("policy hash", run.selectionPolicy?.hash, matrix.policyHash);
  check("baseline column", run.baselineProfileId, matrix.baselineProfileId);
  // The archive names the frozen candidate set it measured, so a run of some
  // other round's columns cannot be quoted as this round's confirmation.
  check("candidate manifest digest", run.candidateManifestDigest,
    expected.candidateManifestDigest);
  if (!sameList([...(run.rendererKeys ?? [])].sort(), [...matrix.rendererKeys].sort())) {
    problems.push(`${label}: renderer columns ${printable(run.rendererKeys)}`);
  }
  if (!sameList([...(run.candidateProfileIds ?? [])].sort(), [...candidateProfileIds].sort())) {
    problems.push(
      `${label}: measured columns ${printable(run.candidateProfileIds)}, and the candidate ` +
        `manifest froze ${printable(candidateProfileIds)}`,
    );
  }
  // An identifier is a label. A run measured under altered thresholds keeps every
  // expected name, so the values are bound to an identity chained from Task 27:
  // the archive records the whole registry generation it replayed from, that
  // generation must hash to the digest the candidate manifest froze, and each
  // column's replayed thresholds must be that generation's entry for its
  // identifier, field for field.
  check("registry digest", run.registryDigest, expected.completeness?.registryDigest);
  check("generator version", run.generatorVersion, expected.completeness?.generatorVersion);
  const registry = run.registry;
  const registryEntries = new Map();
  if (typeof registry !== "object" || registry === null || !Array.isArray(registry.profiles)) {
    report("records no registry generation, so its columns are identifiers without values");
  } else {
    for (const entry of registry.profiles) {
      if (typeof entry?.id === "string") {
        const { id: _id, ...thresholds } = entry;
        registryEntries.set(entry.id, thresholds);
      }
    }
    // The recipe is Task 27's own registry digest: version, default, shared fixed
    // policy, and every profile's complete threshold set in registry order.
    const recomputed = canonicalJsonDigest({
      version: registry.version,
      defaultProfileId: registry.defaultProfileId,
      fixedPolicy: registry.fixedPolicy,
      profiles: registry.profiles,
    });
    check("recomputed registry digest", recomputed, expected.completeness?.registryDigest);
    check("registry version", registry.version, expected.completeness?.registryVersion);
  }
  const replayed = run.profiles ?? {};
  for (const profileId of [matrix.baselineProfileId, ...candidateProfileIds]) {
    const thresholds = replayed[profileId];
    if (typeof thresholds !== "object" || thresholds === null) {
      report(`${profileId} was replayed without recording the thresholds it used`);
      continue;
    }
    const registered = registryEntries.get(profileId);
    if (registered === undefined) {
      report(`${profileId} was replayed from outside the registry generation it names`);
      continue;
    }
    // Shape as well as values: an extra or missing field is a different profile
    // than the one the registry froze under that identifier.
    if (!sameList(Object.keys(thresholds).sort(), Object.keys(registered).sort())) {
      report(
        `${profileId} was replayed with fields ${printable(Object.keys(thresholds).sort())}, and ` +
          `the registry froze ${printable(Object.keys(registered).sort())}`,
      );
      continue;
    }
    const moved = Object.keys(registered).filter((key) => thresholds[key] !== registered[key]);
    if (moved.length > 0) {
      report(
        `replayed ${profileId} at ${moved
          .map((key) => `${key}=${printable(thresholds[key])}`)
          .join(", ")}, not the values its registry entry froze`,
      );
    }
  }
  const baselineRegistered = registryEntries.get(matrix.baselineProfileId);
  if (baselineRegistered !== undefined) {
    const moved = Object.entries(matrix.baselineThresholds)
      .filter(([key, value]) => baselineRegistered[key] !== value)
      .map(([key]) => key);
    if (moved.length > 0) {
      report(
        `registers ${matrix.baselineProfileId} at ${moved
          .map((key) => `${key}=${printable(baselineRegistered[key])}`)
          .join(", ")}, not the frozen incumbent values`,
      );
    }
  }

  // --- Coverage, recomputed from the captures rather than read as a total.
  const captures = Array.isArray(run.captures) ? run.captures : [];
  if (captures.length === 0) {
    report("archives no captured traces, so its coverage is a self-report");
  } else {
    const incomplete = captures.find((capture) => matrix.captureFields.some((field) => (
      typeof capture?.[field] !== "string" || capture[field].length === 0
    )));
    if (incomplete !== undefined) {
      report(`capture ${printable(incomplete.traceId)} does not record what it rendered`);
    }
    const badHash = captures.find((capture) => [
      "recognitionStructureHash",
      "processLocalPcmHash",
      "processLocalTraceHash",
    ].some((field) => !DIGEST_PATTERN.test(capture?.[field] ?? "")));
    if (badHash !== undefined) {
      report(`capture ${printable(badHash.traceId)} records a placeholder in place of a hash`);
    }
    const traceIds = captures.map(({ traceId }) => traceId);
    if (new Set(traceIds).size !== traceIds.length) {
      report("captured the same trace twice, so its census counts duplicates as coverage");
    }
    // Counts say how many of each kind were captured; they do not say that these
    // were the manifest's traces. The identity does, and the frozen list names
    // what is missing rather than only reporting that a digest moved.
    check("captured corpus identity", capturedCorpusIdentity(captures),
      matrix.captureIdentityDigest);
    const captured = new Set(traceIds);
    const absent = roundTwoCaptureIdentityRows()
      .filter(({ traceId }) => !captured.has(traceId))
      .map(({ traceId }) => traceId);
    if (absent.length > 0) {
      report(
        `never captured ${absent.length} of the frozen corpus (first ${absent[0]})`,
      );
    }
    const counts = recomputedCaptureCensus(captures);
    for (const { partition, suite, traceCount } of matrix.census) {
      const measured = counts.get(censusKey(partition, suite)) ?? 0;
      if (measured !== traceCount) {
        report(
          `captured ${measured} ${partition}/${suite} traces, expected ${traceCount}`,
        );
      }
      counts.delete(censusKey(partition, suite));
    }
    for (const [key, measured] of counts) {
      report(`captured ${measured} traces in ${key}, which the version-2 census does not contain`);
    }
    check("captured traces", captures.length, matrix.capturedTraceCount);
    // The scalars the archive states must agree with what it archived, so a run
    // cannot claim coverage its own captures contradict.
    check("declared captured traces", run.capturedTraceCount, captures.length);
    const confirmationRead = captures
      .filter(({ partition }) => partition === "confirmation").length;
    check("declared confirmation traces read", run.confirmationTraceCountRead, confirmationRead);

    // --- Every column must have judged every trace.
    const columnProfileIds = [matrix.baselineProfileId, ...candidateProfileIds];
    const outcomes = Array.isArray(run.outcomes) ? run.outcomes : [];
    const seen = new Set(outcomes.map((row) => `${row?.traceId}\u0000${row?.profileId}`));
    const missing = [];
    for (const traceId of traceIds) {
      for (const profileId of columnProfileIds) {
        if (!seen.has(`${traceId}\u0000${profileId}`)) missing.push(`${profileId}@${traceId}`);
      }
    }
    if (missing.length > 0) {
      report(
        `is missing ${missing.length} of ${traceIds.length * columnProfileIds.length} per-profile ` +
          `outcome rows (first ${missing[0]})`,
      );
    }
    if (outcomes.length !== traceIds.length * columnProfileIds.length) {
      report(
        `archives ${outcomes.length} outcome rows for ${traceIds.length} traces across ` +
          `${columnProfileIds.length} columns`,
      );
    }
    // A row of `{traceId, profileId}` records that a column existed, not what it
    // decided, so each must carry its own outcome digest and the counters the
    // gates read. The archive's stated outcome identity is then recomputed from
    // them under the Task 13 recipe.
    const emptyOutcome = outcomes.find((row) => (
      !DIGEST_PATTERN.test(row?.outcomeDigest ?? "") ||
      ROUND_TWO_DOMAIN_SUMMARY_COUNTERS.some((counter) => (
        !Number.isInteger(row?.[counter]) || row[counter] < 0
      ))
    ));
    if (emptyOutcome !== undefined) {
      report(
        `outcome row ${printable(emptyOutcome.profileId)}@${printable(emptyOutcome.traceId)} ` +
          "records that a column ran, not what it decided",
      );
    } else {
      check("outcome identity", fnv1a32(outcomes.map((row) => (
        `${row.traceId}:${row.profileId}:${row.outcomeDigest}`
      ))), run.outcomeIdentityDigest);
    }
  }

  // --- The repeated-chord census, both halves, with roles and strata.
  const census = Array.isArray(run.repeatedChordCensus) ? run.repeatedChordCensus : [];
  const declared = census.map(({ groupId }) => groupId).sort();
  const frozen = matrix.repeatedChordCensus.map(({ groupId }) => groupId).sort();
  if (!sameList(declared, frozen)) {
    problems.push(
      `${label}: declares repeated-chord groups ${printable(declared)}, and the frozen census is ` +
        `${printable(frozen)}`,
    );
  } else {
    for (const group of census) {
      const expectedGroup = ROUND_TWO_REPEATED_CENSUS_BY_ID.get(group.groupId);
      if (group.evidenceRole !== expectedGroup.evidenceRole ||
          group.stratum !== expectedGroup.stratum) {
        problems.push(
          `${label}: ${group.groupId} is declared ${printable(group.evidenceRole)}/` +
            `${printable(group.stratum)}, not ${expectedGroup.evidenceRole}/` +
            `${expectedGroup.stratum}`,
        );
      }
    }
  }
  const groupIds = frozen;
  const complete = (rows, what) => {
    const measured = (rows ?? []).map(({ groupId }) => groupId);
    if (!sameList([...measured].sort(), groupIds)) {
      problems.push(
        `${label}: ${what} measures ${measured.length} of ${groupIds.length} frozen groups`,
      );
      return;
    }
    // The stratum travels with the measurement, because the aggregation groups
    // by it: a row filed under another stratum moves a completeness verdict.
    const misfiled = (rows ?? []).find((row) => (
      row.stratum !== ROUND_TWO_REPEATED_CENSUS_BY_ID.get(row.groupId)?.stratum
    ));
    if (misfiled !== undefined) {
      problems.push(`${label}: ${what} files ${misfiled.groupId} under ${misfiled.stratum}`);
    }
    for (const row of rows ?? []) {
      problems.push(...observationProblems(row, `${label}: ${what}`));
    }
  };
  complete(run.baselineRepeatedMeasurements, "the baseline column");
  for (const profileId of candidateProfileIds) {
    const column = (run.repeatedRecovery ?? []).find((row) => row.profileId === profileId);
    if (column === undefined) {
      report(`${profileId} has no archived repeated-recovery column`);
      continue;
    }
    if (column.comparedAgainstProfileId !== matrix.baselineProfileId) {
      report(`${profileId} is compared against ${printable(column.comparedAgainstProfileId)}`);
    }
    complete(column.measurements, `${profileId}`);
  }

  // --- Complete per-domain summaries, so every gate verdict can be rederived.
  const summaries = Array.isArray(run.domainSummaries) ? run.domainSummaries : [];
  if (summaries.length === 0) {
    report("archives no per-domain summaries, so its gate verdicts cannot be rederived");
  } else {
    const columnProfileIds = [matrix.baselineProfileId, ...candidateProfileIds];
    const malformed = summaries.find((row) => (
      typeof row?.domainId !== "string" || row.domainId.length === 0 ||
      typeof row?.gateCode !== "string" ||
      !columnProfileIds.includes(row?.profileId) ||
      !Array.isArray(row?.traceIds) || row.traceIds.length === 0 ||
      // A percentile is a duration: null, or a finite non-negative number. Any
      // JavaScript number would admit a negative latency and an Infinity parsed
      // from an extreme JSON exponent.
      !(row.p95OnsetToAdvanceMs === null || (
        typeof row.p95OnsetToAdvanceMs === "number" &&
        Number.isFinite(row.p95OnsetToAdvanceMs) &&
        row.p95OnsetToAdvanceMs >= 0
      )) ||
      ROUND_TWO_DOMAIN_SUMMARY_COUNTERS.some((counter) => (
        !Number.isInteger(row[counter]) || row[counter] < 0
      ))
    ));
    if (malformed !== undefined) {
      report(
        `domain summary ${printable(malformed.gateCode)}/${printable(malformed.domainId)} is not ` +
          "a complete measurement",
      );
    }
    const index = domainSummaryIndex(summaries);
    if (index.size !== summaries.length) {
      report("summarises one domain twice for one gate and column");
    }
    // Each gate's domains are derived from the frozen corpus, so a losing speed,
    // layer, or family cannot be dropped, re-cut, or replaced by a clean paired
    // row. The comparison is over trace membership rather than domain labels: an
    // archive may name its groups however it likes and must still have measured
    // these groups.
    for (const gate of CONFIRMATION_EVIDENCE.gates) {
      const expectedDomains = roundTwoGateDomainMembership(gate, captures);
      if (expectedDomains === null) continue;
      // A gate that reads no row cannot be re-derived, and a gate that cannot be
      // re-derived cannot clear a candidate. This is not a defect in the archive:
      // Task 13 froze these partitions against manifest version 1, where
      // `confirmation` still held the isolated and dynamics corpora. Manifest
      // version 2 re-partitioned those into discovery and regression-only and
      // left `confirmation` holding only the twelve authored paired rows, so the
      // release gates have no held-back evidence to read. Choosing new partitions
      // here would be freezing round-two policy inside a verifier, which is the
      // one thing this chain exists to prevent.
      if (expectedDomains.length === 0) {
        report(
          `gate ${gate.code} reads no manifest-version-2 row in ` +
            `${printable(gate.partitions)}: ${ROUND_TWO_UNFROZEN_SCOPE}, so no completed ` +
            "run can clear a candidate on it",
        );
        continue;
      }
      for (const profileId of columnProfileIds) {
        const gateRows = summaries.filter((row) => (
          row?.gateCode === gate.code && row?.profileId === profileId
        ));
        if (gateRows.length === 0) {
          report(`gate ${gate.code} summarises no domain for ${profileId}`);
          break;
        }
        const measured = gateRows.map(({ traceIds }) => (
          Array.isArray(traceIds) ? traceIds.slice().sort() : []
        ));
        if (!samePartition(measured, expectedDomains)) {
          report(
            `gate ${gate.code} summarises ${measured.length} domains over ` +
              `${measured.reduce((total, group) => total + group.length, 0)} traces for ` +
              `${profileId}, and the frozen corpus groups it into ${expectedDomains.length} ` +
              `domains over ${expectedDomains.reduce((total, g) => total + g.length, 0)}`,
          );
          break;
        }
      }
    }
    // Every counter a summary states is the sum of the outcome rows it names, so
    // a per-trace regression cannot be smoothed away by a clean summary — or a
    // clean per-trace record contradicted by an invented summary.
    const outcomeByKey = new Map(
      (Array.isArray(run.outcomes) ? run.outcomes : [])
        .map((row) => [`${row?.profileId}\u0000${row?.traceId}`, row]),
    );
    for (const row of summaries) {
      const mismatched = ROUND_TWO_DOMAIN_SUMMARY_COUNTERS.find((counter) => {
        const total = (row.traceIds ?? []).reduce((sum, traceId) => (
          sum + (outcomeByKey.get(`${row.profileId}\u0000${traceId}`)?.[counter] ?? 0)
        ), 0);
        return total !== row[counter];
      });
      if (mismatched !== undefined) {
        report(
          `domain summary ${row.gateCode}/${row.domainId} for ${row.profileId} states ` +
            `${mismatched} ${printable(row[mismatched])}, and its own outcome rows sum to ` +
            `${(row.traceIds ?? []).reduce((sum, traceId) => (
              sum + (outcomeByKey.get(`${row.profileId}\u0000${traceId}`)?.[mismatched] ?? 0)
            ), 0)}`,
        );
        break;
      }
    }
  }

  // --- The diagnosed cases, which the committed-regression gate reads directly.
  const regressions = Array.isArray(run.committedRegressions) ? run.committedRegressions : [];
  for (const profileId of candidateProfileIds) {
    const rows = regressions.filter((outcome) => outcome?.profileId === profileId);
    if (rows.length === 0) {
      report(`${profileId} archives no committed-regression outcomes`);
      continue;
    }
    // Exactly the frozen census, once each, under its own expectation.
    const declared = rows.map(({ fixtureId }) => fixtureId).sort();
    const frozenIds = ROUND_TWO_COMMITTED_REGRESSIONS.map(({ fixtureId }) => fixtureId).sort();
    if (!sameList(declared, frozenIds)) {
      report(
        `${profileId} reports committed regressions ${printable(declared)}, and the frozen ` +
          `census is ${printable(frozenIds)}`,
      );
      continue;
    }
    for (const frozen of ROUND_TWO_COMMITTED_REGRESSIONS) {
      const outcome = rows.find(({ fixtureId }) => fixtureId === frozen.fixtureId);
      if (outcome.expectation !== frozen.expectation) {
        report(
          `${profileId} reports ${frozen.fixtureId} as ${printable(outcome.expectation)}, and it ` +
            `is diagnosed ${frozen.expectation}`,
        );
      }
    }
    const malformedOutcome = rows.find((outcome) => (
      typeof outcome.fixtureId !== "string" || outcome.fixtureId.length === 0 ||
      typeof outcome.expectation !== "string" ||
      typeof outcome.worseThanBaseline !== "boolean" ||
      typeof outcome.falseAdvance !== "boolean" ||
      !Number.isInteger(outcome.skippedAdvanceCount) || outcome.skippedAdvanceCount < 0 ||
      !Number.isInteger(outcome.duplicateAdvanceCount) || outcome.duplicateAdvanceCount < 0
    ));
    if (malformedOutcome !== undefined) {
      report(
        `${profileId} records an incomplete committed-regression outcome for ` +
          `${printable(malformedOutcome.fixtureId)}`,
      );
    }
  }

  // --- The gate set, frozen whole, and applied by every candidate.
  problems.push(...roundTwoGateProblems(run.gates, label, candidateProfileIds, run));
  return problems;
}

/**
 * The complete frozen gate set, and every candidate's judgement under it.
 *
 * The definitions are Task 13's, restated by identity rather than by count: a
 * run that declared one invented gate and applied it would otherwise clear a
 * candidate while omitting every real Task 23 gate. Each candidate must then
 * report an outcome for every gate, under the gate's own role and domain, and
 * every gate must have been applied — the Task 23 rule that a complete run with
 * a required gate unapplied fails rather than yielding an eligible candidate.
 */
export function roundTwoGateProblems(gates, label, candidateProfileIds, run = {}) {
  const definitions = CONFIRMATION_EVIDENCE.gates;
  if (typeof gates !== "object" || gates === null) {
    return [`${label}: archives no gate evidence`];
  }
  const problems = gateDefinitionProblems(gates, label);
  if (gates.evidenceComplete !== true) {
    problems.push(`${label}: gate evidence is not marked complete`);
  } else if (!Array.isArray(gates.incompleteEvidenceReasons) ||
      gates.incompleteEvidenceReasons.length > 0) {
    // Complete evidence has no reason to be incomplete; a run that names one
    // while claiming completeness is describing two different runs.
    problems.push(
      `${label}: marks its evidence complete while naming ` +
        `${printable(gates.incompleteEvidenceReasons ?? null)} as incomplete`,
    );
  }
  // A waiver is a decision taken after seeing a measured loss, which by
  // definition cannot precede the run the confirmation partition is spent on.
  if (!Array.isArray(gates.reviewedLayerLosses) || gates.reviewedLayerLosses.length > 0) {
    problems.push(
      `${label}: declares ${printable(gates.reviewedLayerLosses ?? null)} as reviewed layer ` +
        "loss waivers, and a frozen confirmation declares none",
    );
  }
  const candidates = Array.isArray(gates.candidates) ? gates.candidates : [];
  if (!sameList(
    candidates.map((candidate) => candidate?.profileId),
    [...candidateProfileIds],
  )) {
    problems.push(
      `${label}: gates judged ${printable(candidates.map((candidate) => candidate?.profileId))}, ` +
        `not the frozen candidates ${printable([...candidateProfileIds])}`,
    );
    return problems;
  }
  for (const candidate of candidates) {
    const where = `${label}: ${candidate.profileId}`;
    const outcomes = Array.isArray(candidate.gates) ? candidate.gates : [];
    if (!sameList(outcomes.map((gate) => gate?.code), definitions.map(({ code }) => code))) {
      problems.push(
        `${where} reports ${outcomes.length} gate outcomes, not all ${definitions.length} frozen ` +
          "gates; a narrowed report cannot show which gates were never applied",
      );
      continue;
    }
    const malformed = outcomes.find((gate) => (
      typeof gate.applied !== "boolean" ||
      typeof gate.passed !== "boolean" ||
      !Array.isArray(gate.failures)
    ));
    if (malformed !== undefined) {
      problems.push(`${where} gate ${malformed.code} records no applied/passed verdict`);
      continue;
    }
    const mismatched = definitions.find(({ role, domain }, index) => (
      outcomes[index].role !== role || outcomes[index].domain !== domain
    ));
    if (mismatched !== undefined) {
      problems.push(`${where} judged gate ${mismatched.code} under another role or domain`);
    }
    const unapplied = outcomes.filter((gate) => !gate.applied).map(({ code }) => code);
    if (unapplied.length > 0) {
      problems.push(
        `${where} never applied ${unapplied.length} of ${definitions.length} gates ` +
          `(${unapplied.join(", ")}), and a complete matrix applies all of them`,
      );
    }
    // `passed` is a claim about the failures beside it, so the two must agree:
    // a gate that recorded failures did not pass, and one that recorded none did
    // not fail. Task 13's scope and failure-identity checks apply unchanged,
    // because a verdict is only as good as the rows it read and the failures it
    // can name.
    const inconsistent = outcomes.find((gate) => gate.passed !== (gate.failures.length === 0));
    if (inconsistent !== undefined) {
      problems.push(
        `${where} gate ${inconsistent.code} records passed ${inconsistent.passed} beside ` +
          `${inconsistent.failures.length} failures`,
      );
    }
    problems.push(...gateScopeProblems(outcomes, where, true));
    problems.push(...gateFailureProblems(outcomes, where));
    // The per-role counters are what a report quotes; they are recomputed from
    // the outcomes rather than read.
    for (const [counter, role] of ROLE_FAILURE_COUNTERS) {
      const measured = outcomes
        .filter((gate) => gate.role === role)
        .reduce((total, gate) => total + gate.failures.length, 0);
      if (candidate[counter] !== measured) {
        problems.push(
          `${where} records ${counter} ${printable(candidate[counter])}, recomputed ${measured}`,
        );
      }
    }
    if (candidate.eligible !== undefined &&
        candidate.eligible !== outcomes.every((gate) => gate.passed)) {
      problems.push(`${where} names an eligibility its own gate outcomes contradict`);
    }
    // Every verdict is checked against the rows it is a verdict about. A `passed`
    // boolean is a claim, and a claim beside a consistent failure list is still a
    // claim, so all eighteen are rederived from the archived measurements.
    const rederived = rederiveRoundTwoGateVerdicts(run, candidate.profileId);
    for (const [index, verdict] of rederived.entries()) {
      const reported = outcomes[index];
      const shouldPass = verdict.failures.length === 0;
      if (reported.passed !== shouldPass) {
        problems.push(
          `${where} reports gate ${verdict.code} as ${reported.passed ? "passed" : "failed"}, and ` +
            `its own measurements rederive ${shouldPass ? "a pass" : "a failure"}` +
            `${shouldPass ? "" : ` (${verdict.failures.slice(0, 3).join(", ")})`}`,
        );
      }
    }
    // The per-trace safety comparison is kept beside the per-domain one: a
    // corpus or domain total can absorb a regression on one trace behind an
    // improvement on another, and this chain requires it per trace.
    const introduced = introducedUnsafeEvents(
      Array.isArray(run?.outcomes) ? run.outcomes : [],
      ROUND_TWO_CONFIRMATION_MATRIX.baselineProfileId,
      candidate.profileId,
    );
    const safetyCleared = outcomes
      .filter((gate) => gate.role === "safety")
      .every((gate) => gate.passed);
    if (introduced.length > 0 && safetyCleared) {
      const [first] = introduced;
      problems.push(
        `${where} cleared every safety gate while introducing ${introduced.length} unsafe ` +
          `advances its baseline did not make (${first.counter} ${first.baseline}\u2192` +
          `${first.candidate} on ${first.traceId})`,
      );
    }
  }
  return problems;
}

/**
 * Re-derives the manifest's candidate entries from the archived measurements.
 *
 * The entries are the whole point of the completed branch, and a manifest that
 * merely states them is a self-report. Each candidate's Task 24 labels are
 * recomputed from both sides of its archived comparison under the frozen
 * boundaries, with the confirmation groups labelled by the frozen census rather
 * than by the archive's copy of it, and eligibility is recomputed from every
 * gate's own pass verdict rather than read from a list of failures the archive
 * supplies.
 */
export function rederiveRoundTwoEligibilityEntries(record, candidateProfileIds, expected) {
  const [run] = Array.isArray(record) ? record : [record];
  const roles = new Map(ROUND_TWO_CONFIRMATION_MATRIX.repeatedChordCensus.map((group) => (
    [group.groupId, group.evidenceRole]
  )));
  const gateCandidates = new Map(
    (run?.gates?.candidates ?? []).map((candidate) => [candidate.profileId, candidate]),
  );
  return candidateProfileIds.map((profileId) => {
    const column = (run?.repeatedRecovery ?? []).find((row) => row.profileId === profileId);
    const groups = recomputeRepeatedRecoveryGroups(
      run?.baselineRepeatedMeasurements,
      column?.measurements,
      expected.repeatedRecoveryBoundaries,
    );
    const evaluation = aggregateRepeatedRecovery(
      groups,
      expected.knownDiscoveryGroupIds,
      roles,
    );
    // Every frozen gate must have been applied and passed. An absent outcome is
    // not a pass, so a candidate with no gate record is ineligible rather than
    // unjudged.
    const outcomes = gateCandidates.get(profileId)?.gates ?? [];
    // Every gate must have been applied, and must rederive to a pass from the
    // archive's own measurements. The reported `passed` is not consulted here at
    // all: it is checked against this elsewhere, and trusting it would make the
    // whole re-derivation decorative.
    //
    // A gate whose round-two scope is not frozen reads no row, so it produces no
    // failure and would otherwise read as a pass. That is the one case where an
    // absent failure is not evidence of safety, so eligibility fails closed on
    // it: this function must not contradict the rule that no completed run can
    // clear a candidate on an unscoped gate.
    const gatesCleared = outcomes.length === CONFIRMATION_EVIDENCE.gates.length &&
      outcomes.every((gate) => gate?.applied === true) &&
      roundTwoUnfrozenGateScopes().length === 0 &&
      rederiveRoundTwoGateVerdicts(run, profileId)
        .every(({ failures }) => failures.length === 0);
    // Eligibility is derived from the measurements as well as from the verdicts,
    // so a gate report that cleared a candidate the outcome rows condemn cannot
    // carry it through.
    const introduced = introducedUnsafeEvents(
      Array.isArray(run?.outcomes) ? run.outcomes : [],
      ROUND_TWO_CONFIRMATION_MATRIX.baselineProfileId,
      profileId,
    );
    return {
      profileId,
      // Failing confirmation no-regression makes a candidate ineligible, and so
      // does any frozen gate it did not clear or any unsafe advance it introduced.
      automatedEligible: evaluation.noRegression && gatesCleared && introduced.length === 0,
      repeatedRecoveryOutcome: evaluation.repeatedRecoveryOutcome,
      confirmationReproductionStatus: evaluation.confirmationReproductionStatus,
    };
  });
}

/**
 * Everything that makes the Task 28 file the frozen eligibility manifest.
 *
 * `candidateManifest` is the parsed Task 27 record and `evidenceRuns` the parsed
 * Task 26 repetitions. The whole chain is rerun here rather than compared: the
 * stop rule is recomputed from each archive's own measurements, the candidate
 * manifest's digest from its own fields, and the eligibility manifest's from
 * its own. A chain whose three artifacts each verify in isolation while
 * disagreeing with one another fails, which is the failure a stated result is
 * most exposed to.
 */
export function roundTwoEligibilityManifestProblems(
  artifact,
  result,
  candidateManifest,
  evidenceRuns,
  archives = null,
) {
  const expected = artifact.roundTwoEligibilityManifest;
  if (expected === undefined) return [];
  const problems = [];
  if (Array.isArray(result) || typeof result !== "object" || result === null) {
    return [`${artifact.name}: the eligibility manifest is one record, not a list`];
  }
  const check = (label, actual, wanted) => {
    if (actual !== wanted) {
      problems.push(
        `${artifact.name}: ${label} ${printable(actual)}, expected ${printable(wanted)}`,
      );
    }
  };
  check("command", result.name, expected.name);
  check("format version", result.formatVersion, expected.formatVersion);
  check("round", result.roundId, expected.roundId);
  check("run status", result.runStatus, expected.runStatus);
  check("candidate manifest digest", result.candidateManifestDigest,
    expected.candidateManifestDigest);
  check("terminal outcome", result.task26TerminalOutcome, expected.task26TerminalOutcome);
  check("Task 26 evidence digest", result.task26EvidenceDigest, expected.task26EvidenceDigest);
  check("digest algorithm", result.digest?.algorithm, "fnv1a-32-canonical-json");
  check("digest", result.digest?.value, expected.digest);

  // The branch is taken from `runStatus` alone. Reading an empty entry list as
  // "not run" would erase the difference between a round that spent its
  // single-use confirmation fixtures and one that did not.
  const branchKeys = ELIGIBILITY_MANIFEST_KEYS[result.runStatus];
  if (branchKeys === undefined) {
    problems.push(`${artifact.name}: unknown run status ${printable(result.runStatus)}`);
    return problems;
  }
  for (const key of branchKeys) {
    if (!Object.hasOwn(result, key)) problems.push(`${artifact.name}: missing ${key}`);
  }
  for (const key of Object.keys(result)) {
    if (!branchKeys.includes(key)) {
      problems.push(`${artifact.name}: ${result.runStatus} carries forbidden field ${key}`);
    }
  }

  const entries = Array.isArray(result.entries) ? result.entries : null;
  if (entries === null) {
    problems.push(`${artifact.name}: the entry list is missing`);
  } else {
    if (entries.length !== expected.entryCount) {
      problems.push(
        `${artifact.name}: ${entries.length} candidate entries, expected ${expected.entryCount}`,
      );
    }
    entries.forEach((entry, index) => {
      const where = `${artifact.name}: entry ${index}`;
      for (const key of ELIGIBILITY_ENTRY_KEYS) {
        if (!Object.hasOwn(entry ?? {}, key)) problems.push(`${where} is missing ${key}`);
      }
      if (entry?.profileId === "baseline-v1") {
        problems.push(`${where} names baseline-v1, which the live harness supplies itself`);
      }
      if (!REPEATED_RECOVERY_OUTCOMES.includes(entry?.repeatedRecoveryOutcome)) {
        problems.push(`${where} records outcome ${printable(entry?.repeatedRecoveryOutcome)}`);
      }
      if (!CONFIRMATION_REPRODUCTION_STATUSES.includes(entry?.confirmationReproductionStatus)) {
        problems.push(
          `${where} records reproduction status ` +
            `${printable(entry?.confirmationReproductionStatus)}`,
        );
      }
      if (entry?.repeatedRecoveryOutcome === "confirmed-full-resolution" &&
          entry?.confirmationReproductionStatus !== "reproduced") {
        problems.push(`${where} claims confirmed full resolution with no reproducing group`);
      }
      // Task 23's confirmation no-regression condition is a gate, not a label.
      if (entry?.repeatedRecoveryOutcome === "regressed" && entry?.automatedEligible === true) {
        problems.push(`${where} regressed a repeated-chord group and is marked eligible`);
      }
      if (entry?.confirmationReproductionStatus === "not-run") {
        problems.push(`${where} was confirmed against fixtures it records as never run`);
      }
    });
  }

  // The not-run branch's central claim, measured against the corpus census it
  // carries rather than read as a sentence: the whole partition is present, none
  // of it is decoded, its fixtures are the ones version 2 authored, and the
  // first-observed ledger that separates unseen evidence from prior rounds has
  // not moved.
  const partition = result.confirmationPartition ?? {};
  for (const [key, wanted] of Object.entries(expected.confirmationPartition)) {
    check(`confirmation partition ${key}`, partition[key], wanted);
  }
  // The pin loop above fixes the census and both identities in either branch, so
  // a completed record cannot satisfy `decodedTraceCount === traceCount` with an
  // empty partition, nor pass with twelve rows that are no longer these twelve.
  if (result.runStatus === "not-run-no-confirmable-candidate") {
    check("not-run reason", result.reason, expected.reason);
    if ((entries?.length ?? 0) > 0) {
      problems.push(`${artifact.name}: the not-run branch confirmed nothing and may hold no entry`);
    }
    if (partition.decodedTraceCount !== 0) {
      problems.push(
        `${artifact.name}: the not-run branch decoded ${printable(partition.decodedTraceCount)} ` +
          "confirmation traces",
      );
    }
  } else {
    const evidence = result.confirmationEvidence ?? {};
    for (const field of ["runOneSha256", "runTwoSha256"]) {
      if (!SHA256_PATTERN.test(evidence[field] ?? "")) {
        problems.push(`${artifact.name}: confirmation evidence ${field} is not a SHA-256`);
      }
    }
    for (const field of ["runOneArchive", "runTwoArchive"]) {
      if (typeof evidence[field] !== "string" || evidence[field].length === 0) {
        problems.push(`${artifact.name}: confirmation evidence names no ${field}`);
      }
    }
    if (!SHA256_PATTERN.test(evidence.comparisonDigest ?? "")) {
      problems.push(`${artifact.name}: confirmation evidence comparisonDigest is not a SHA-256`);
    }
    problems.push(...confirmationArchiveEvidenceProblems(artifact.name, evidence, archives));
    problems.push(...completedEntryProblems(
      artifact.name,
      result,
      candidateManifest,
      evidence,
      archives,
      expected,
    ));
    if (partition.decodedTraceCount !== partition.traceCount) {
      problems.push(
        `${artifact.name}: a completed run decodes the whole confirmation partition, and this ` +
          `record decoded ${printable(partition.decodedTraceCount)} of ` +
          `${printable(partition.traceCount)}`,
      );
    }
  }

  const { digest: _digest, ...digestInput } = result;
  check("recomputed digest", canonicalJsonDigest(digestInput), expected.digest);

  // The link to Task 27, recomputed from that record rather than read off it.
  if (typeof candidateManifest !== "object" || candidateManifest === null ||
      Array.isArray(candidateManifest)) {
    problems.push(`${artifact.name}: the candidate manifest it chains to is not a record`);
    return problems;
  }
  const { digest: _candidateDigest, ...candidateInput } = candidateManifest;
  const candidateDigest = canonicalJsonDigest(candidateInput);
  if (candidateManifest.digest?.value !== candidateDigest) {
    problems.push(
      `${artifact.name}: the candidate manifest records digest ` +
        `${printable(candidateManifest.digest?.value)}, recomputed ${candidateDigest}`,
    );
  }
  if (result.candidateManifestDigest !== candidateDigest) {
    problems.push(
      `${artifact.name}: chains to candidate manifest ` +
        `${printable(result.candidateManifestDigest)}, and that record hashes to ` +
        `${candidateDigest}`,
    );
  }
  for (const [label, key] of [
    ["Task 26 terminal outcome", "task26TerminalOutcome"],
    ["Task 26 evidence digest", "task26EvidenceDigest"],
  ]) {
    if (result[key] !== candidateManifest[key]) {
      problems.push(
        `${artifact.name}: the chain disagrees about the ${label}: ${printable(result[key])} ` +
          `against ${printable(candidateManifest[key])}`,
      );
    }
  }
  // Round-two completeness. A round-one archive or a narrowed smoke fails these
  // regardless of how well formed its own record is.
  for (const [key, wanted] of Object.entries(expected.completeness)) {
    check(`candidate manifest ${key}`, candidateManifest[key], wanted);
  }
  if (result.runStatus === "not-run-no-confirmable-candidate") {
    if (result.reason !== candidateManifest.notRunReason) {
      problems.push(
        `${artifact.name}: carries reason ${printable(result.reason)}, and the candidate ` +
          `manifest records ${printable(candidateManifest.notRunReason)}`,
      );
    }
    if ((candidateManifest.candidateProfileIds ?? []).length > 0) {
      problems.push(
        `${artifact.name}: the not-run branch is taken only over a candidate manifest that ` +
          "registered nothing",
      );
    }
  } else {
    if (candidateManifest.notRunReason !== null) {
      problems.push(
        `${artifact.name}: a completed confirmation ran against a candidate manifest whose ` +
          `notRunReason is ${printable(candidateManifest.notRunReason)}`,
      );
    }
    const confirmed = (entries ?? []).map(({ profileId }) => profileId).sort();
    const frozen = [...(candidateManifest.candidateProfileIds ?? [])].sort();
    if (!sameList(confirmed, frozen)) {
      problems.push(
        `${artifact.name}: reports on ${confirmed.join(", ") || "nothing"}, and the candidate ` +
          `manifest froze ${frozen.join(", ") || "nothing"}`,
      );
    }
  }

  // The Task 26 root is mandatory in this branch too, not only in the completed
  // one: a chain whose archives do not rerun to what it records is broken.
  if (!Array.isArray(evidenceRuns) || evidenceRuns.length !== expected.evidencePaths.length) {
    problems.push(`${artifact.name}: expected ${expected.evidencePaths.length} Task 26 repetitions`);
    return problems;
  }
  evidenceRuns.forEach((run, index) => {
    const label = `${artifact.name}: ${expected.evidencePaths[index]}`;
    const [record] = Array.isArray(run) ? run : [];
    if (record === undefined) {
      problems.push(`${label} is not one Task 26 record`);
      return;
    }
    const rerun = rerunRoundTwoSelection(record, expected);
    if (rerun.evidenceDigest !== result.task26EvidenceDigest) {
      problems.push(
        `${label} recomputes to digest ${rerun.evidenceDigest}, and the chain references ` +
          `${printable(result.task26EvidenceDigest)}`,
      );
    }
    if (rerun.terminalOutcome !== result.task26TerminalOutcome) {
      problems.push(
        `${label} reruns to terminal outcome ${rerun.terminalOutcome}, and the chain records ` +
          `${printable(result.task26TerminalOutcome)}`,
      );
    }
    const rerunReason = result.runStatus === "not-run-no-confirmable-candidate"
      ? result.reason
      : null;
    if (rerun.notRunReason !== rerunReason) {
      problems.push(
        `${label} reruns to reason ${printable(rerun.notRunReason)}, and the chain records ` +
          `${printable(rerunReason)}`,
      );
    }
    if (rerun.ablationId !== candidateManifest.ablationId) {
      problems.push(
        `${label} reruns to ablation ${printable(rerun.ablationId)}, and the chain names ` +
          `${printable(candidateManifest.ablationId)}`,
      );
    }
  });
  return problems;
}

/**
 * Holds the completed branch's archives to the frozen matrix, and its entries to
 * those archives.
 *
 * Equal hashes prove the two files agree; they say nothing about what either
 * file is. Both are therefore validated against the round-two matrix, and each
 * candidate's Task 24 labels and eligibility are recomputed from the archived
 * measurements and compared to what the manifest recorded, so a label the
 * evidence does not produce fails here rather than being carried into Task 29.
 */
function completedEntryProblems(label, result, candidateManifest, evidence, archives, expected) {
  const problems = [];
  if (archives === null) return problems;
  const candidateProfileIds = [...(candidateManifest?.candidateProfileIds ?? [])];
  const names = [evidence.runOneArchive, evidence.runTwoArchive];
  const validated = [];
  for (const [index, name] of names.entries()) {
    const archive = archives.get(name);
    if (archive?.record === undefined) continue;
    const where = `${label}: ${index === 0 ? "runOneArchive" : "runTwoArchive"}`;
    const matrixProblems = roundTwoConfirmationMatrixProblems(
      archive.record,
      where,
      candidateProfileIds,
      { ...expected, candidateManifestDigest: result.candidateManifestDigest },
    );
    problems.push(...matrixProblems);
    // The unfrozen release-gate scope is a policy gap, not a defect this archive
    // could have avoided, so it does not stop the entries from being held to the
    // measurements the archive does carry.
    const blocking = matrixProblems
      .filter((problem) => !problem.includes(ROUND_TWO_UNFROZEN_SCOPE));
    if (blocking.length === 0) validated.push({ where, archive });
  }
  if (validated.length === 0) return problems;
  const recorded = (result.entries ?? []).map((entry) => ({
    profileId: entry.profileId,
    automatedEligible: entry.automatedEligible,
    repeatedRecoveryOutcome: entry.repeatedRecoveryOutcome,
    confirmationReproductionStatus: entry.confirmationReproductionStatus,
  }));
  for (const { where, archive } of validated) {
    const rederived = rederiveRoundTwoEligibilityEntries(
      archive.record,
      candidateProfileIds,
      expected,
    );
    const byProfileId = new Map(recorded.map((entry) => [entry.profileId, entry]));
    for (const entry of rederived) {
      const stated = byProfileId.get(entry.profileId);
      if (stated === undefined) {
        problems.push(`${where}: ${entry.profileId} was measured and is not in the manifest`);
        continue;
      }
      for (const field of [
        "automatedEligible",
        "repeatedRecoveryOutcome",
        "confirmationReproductionStatus",
      ]) {
        if (stated[field] !== entry[field]) {
          problems.push(
            `${where}: ${entry.profileId} re-derives ${field} ${printable(entry[field])}, and ` +
              `the manifest records ${printable(stated[field])}`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * The not-run branch writes no confirmation archive.
 *
 * The version-2 confirmation fixtures are the round's only genuinely unseen
 * evidence and can be spent exactly once. A placeholder matrix archive here would
 * later read as a confirmation run that rejected everything rather than one that
 * never happened, so the only Task 28 file the repository may hold is the
 * eligibility manifest itself.
 *
 * This prohibition belongs to the not-run branch alone. A completed round's two
 * archived repetitions are Task 28 files it is required to produce, so applying
 * the rule unconditionally would reject the very evidence the completed branch
 * exists to record.
 */
export function roundTwoConfirmationArchiveProblems(fileNames, manifestPath, runStatus) {
  if (runStatus !== "not-run-no-confirmable-candidate") return [];
  const manifestFile = manifestPath.split("/").at(-1);
  const strays = fileNames
    .filter((name) => /task28/i.test(name) && name !== manifestFile)
    .sort();
  return strays.length === 0
    ? []
    : [`The not-run branch wrote no confirmation archive, but found ${strays.join(", ")}`];
}

/**
 * The zero branch writes no search archive.
 *
 * A placeholder archive would later read as a search that found nothing rather
 * than one that never ran, so the only Task 27 file the repository may hold is
 * the candidate manifest itself.
 */
export function roundTwoSearchArchiveProblems(fileNames, manifestPath) {
  const manifestFile = manifestPath.split("/").at(-1);
  const strays = fileNames
    .filter((name) => /task27/i.test(name) && name !== manifestFile)
    .sort();
  return strays.length === 0
    ? []
    : [`The zero branch wrote no search archive, but found ${strays.join(", ")}`];
}

/* ------------------------------------------------------------------------- *
 * Task 29: the approved-profile list
 * ------------------------------------------------------------------------- */

const APPROVED_PROFILES_KEYS = [
  "name",
  "formatVersion",
  "roundId",
  "outcome",
  "reason",
  "selectedDefaultProfileId",
  "incumbentProfileId",
  "approvedProfileIds",
  "eligibilityRunStatus",
  "eligibilityManifestDigest",
  "candidateManifestDigest",
  "task26TerminalOutcome",
  "task26EvidenceDigest",
  "liveCorpus",
  "repeatedChordResult",
  "confirmationPartition",
  "ablations",
  "digest",
];

const DECISION_OUTCOMES = [
  "promoted-candidate",
  // Candidates passed every gate and are offerable by calibration, but the frozen
  // ordered rule did not separate them or the winner was not materially better,
  // so the global default did not move. Approval and promotion are different.
  "approved-without-material-improvement",
  "round-two-candidate-set-exhausted",
  "round-two-grid-produced-no-eligible-improvement",
];

const LIVE_GATE_STATUSES = ["passed", "failed", "not-collected"];

const APPROVED_INCUMBENT_PROFILE_ID = "baseline-v1";

/**
 * The membership rule, recomputed from the eligibility manifest and the live
 * results the list itself carries.
 *
 * The incumbent is approved in every branch; a candidate is approved only when
 * the automated matrix cleared it *and* its live gates were collected and
 * passed. A live row for a profile the automated matrix did not clear is a fault
 * rather than an approval, because live evidence cannot promote a candidate
 * around the automated gates.
 */
export function rederiveApprovedProfileIds(eligibility, liveResults) {
  const problems = [];
  const entries = eligibility?.runStatus === "completed" ? (eligibility.entries ?? []) : [];
  const automatedEligible = new Set(
    entries.filter(({ automatedEligible: eligible }) => eligible === true)
      .map(({ profileId }) => profileId),
  );
  const passed = new Set();
  const seen = new Set();
  for (const row of liveResults ?? []) {
    if (!LIVE_GATE_STATUSES.includes(row?.status)) {
      problems.push(`a live-corpus result records status ${printable(row?.status)}`);
      continue;
    }
    if (seen.has(row.profileId)) {
      problems.push(`the live corpus reports on ${row.profileId} twice`);
      continue;
    }
    seen.add(row.profileId);
    if (!automatedEligible.has(row.profileId)) {
      problems.push(
        `the live corpus reports on ${row.profileId}, which the eligibility manifest does not ` +
          "mark automated-eligible",
      );
      continue;
    }
    if (row.status === "passed") passed.add(row.profileId);
  }
  const approved = [...automatedEligible].filter((profileId) => passed.has(profileId));
  return { approved: [APPROVED_INCUMBENT_PROFILE_ID, ...approved].sort(), problems };
}

/* --- The live corpus, read and rederived ---------------------------------- */

const LIVE_ARCHIVE_NAME = "listen-round-two-live-corpus";
const LIVE_BASELINE_PROFILE_ID = "baseline-v1";
const LIVE_SOURCE_FAMILIES = Object.freeze({
  "acoustic-piano": "acoustic",
  "digital-piano-speakers": "digital",
  "digital-line-output": "digital",
});
const LIVE_REQUIRED_SOURCE_FAMILIES = Object.freeze(["acoustic", "digital"]);
const LIVE_REQUIRED_TRIAL_CLASSES = Object.freeze([
  "single-note",
  "chord",
  "repeated-chord",
  "wrong-note",
  "wrong-chord-member",
  "added-note",
  "omitted-bass",
  "silence-noise",
]);
const LIVE_NEGATIVE_TRIAL_CLASSES = Object.freeze([
  "wrong-note",
  "wrong-chord-member",
  "added-note",
  "omitted-bass",
  "silence-noise",
]);
const LIVE_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvanceCount",
]);
/** Task 24's frozen repeated-chord boundaries, and one decoder hop of latency. */
const LIVE_REPEATED_SOURCE_DISTANCE_NO_REGRESSION = 0;
const LIVE_REPEATED_DELAY_NO_REGRESSION_MS = 32;
const LIVE_LATENCY_REGRESSION_TOLERANCE_MS = 32;
const LIVE_GATE_CODES = Object.freeze([
  "live-coverage",
  "live-safety",
  "live-correctness",
  "live-repeated-recovery",
  "live-latency",
]);

/**
 * Reads the live archives a decision names, by path and by content.
 *
 * The record states a file SHA-256 and a record digest for each session; both are
 * recomputed here, so a decision cannot cite a corpus whose bytes have moved
 * since it read them, or one that is not in the repository at all.
 */
export async function readRoundTwoLiveArchives(references, root = REPOSITORY_ROOT) {
  const archives = [];
  for (const reference of references ?? []) {
    const path = reference?.path;
    if (typeof path !== "string" || path.length === 0) {
      archives.push({ reference, unreadable: "the reference names no file" });
      continue;
    }
    try {
      const bytes = await readFile(resolve(root, path));
      const record = JSON.parse(bytes.toString("utf8"));
      archives.push({ reference, path, fileSha256: sha256(bytes), record });
    } catch (error) {
      archives.push({ reference, path, unreadable: error.message });
    }
  }
  return archives;
}

/**
 * Everything that must be true of the live archives a decision cites.
 *
 * They are bound to the eligibility manifest they were collected against and to
 * the candidate set that manifest cleared, so a corpus collected for another
 * round, or one that replayed a profile the automated matrix rejected, is refused
 * before any of its trials are read.
 */
export function roundTwoLiveArchiveProblems(label, archives, options) {
  const problems = [];
  for (const archive of archives) {
    const where = `${label}: ${archive.path ?? "live archive"}`;
    if (archive.unreadable !== undefined) {
      problems.push(`${where} could not be read: ${archive.unreadable}`);
      continue;
    }
    if (archive.reference?.sha256 !== archive.fileSha256) {
      problems.push(
        `${where} records SHA-256 ${printable(archive.reference?.sha256)}, and that file hashes ` +
          `to ${archive.fileSha256}`,
      );
    }
    const record = archive.record ?? {};
    const { digest: _digest, ...rest } = record;
    const digest = canonicalJsonDigest(rest);
    if (record.digest?.value !== digest) {
      problems.push(
        `${where} records digest ${printable(record.digest?.value)}, recomputed ${digest}`,
      );
    }
    if (archive.reference?.digest !== digest) {
      problems.push(
        `${where} is cited as digest ${printable(archive.reference?.digest)}, and that record ` +
          `hashes to ${digest}`,
      );
    }
    if (record.name !== LIVE_ARCHIVE_NAME) {
      problems.push(`${where} names ${printable(record.name)}`);
    }
    if (record.eligibilityManifestDigest !== options.eligibilityManifestDigest) {
      problems.push(
        `${where} was collected against eligibility manifest ` +
          `${printable(record.eligibilityManifestDigest)}, and this decision concludes ` +
          `${options.eligibilityManifestDigest}`,
      );
    }
    if (record.baselineProfileId !== LIVE_BASELINE_PROFILE_ID) {
      problems.push(`${where} replays incumbent ${printable(record.baselineProfileId)}`);
    }
    for (const profileId of record.profileIds ?? []) {
      if (profileId === LIVE_BASELINE_PROFILE_ID) continue;
      if (!options.automatedEligibleProfileIds.includes(profileId)) {
        problems.push(
          `${where} replayed ${profileId}, which the eligibility manifest does not mark ` +
            "automated-eligible",
        );
      }
    }
    for (const setup of record.setups ?? []) {
      for (const trial of setup.trials ?? []) {
        const reported = new Set((trial.outcomes ?? []).map(({ profileId }) => profileId));
        for (const profileId of record.profileIds ?? []) {
          if (!reported.has(profileId)) {
            problems.push(`${where}: trial ${trial.trialId} has no outcome for ${profileId}`);
          }
        }
        // The trial has to be replayable evidence, not a verdict: the authored
        // score it was played against and the decoded trace the harness captured
        // once, with no audio in the export.
        if (!Array.isArray(trial.sequence?.targets) || trial.sequence.targets.length === 0 ||
            !Array.isArray(trial.sequence?.attacks) || trial.sequence.attacks.length === 0) {
          problems.push(
            `${where}: trial ${trial.trialId} carries no authored score, so its target and ` +
              "played pitches are unrecorded and the matcher cannot be replayed over it",
          );
        }
        if (!Array.isArray(trial.decodedTrace?.frames) || trial.decodedTrace.frames.length === 0) {
          problems.push(
            `${where}: trial ${trial.trialId} carries no decoded recognition trace`,
          );
        }
        if (trial.decodedTrace !== undefined && Object.hasOwn(trial.decodedTrace, "pcm")) {
          problems.push(`${where}: trial ${trial.trialId} exports audio`);
        }
        if (typeof trial.musical !== "object" || trial.musical === null) {
          problems.push(`${where}: trial ${trial.trialId} records no musical context`);
        }
        // The class decides the flag, in both directions.
        const expectedForClass = !LIVE_NEGATIVE_TRIAL_CLASSES.includes(trial.trialClass);
        if (trial.expectedCorrect !== expectedForClass) {
          problems.push(
            `${where}: trial ${trial.trialId} is a ${trial.trialClass} trial and records ` +
              `expectedCorrect ${printable(trial.expectedCorrect)}; the class requires ` +
              `${expectedForClass}`,
          );
        }
        for (const outcome of trial.outcomes ?? []) {
          const unsafe = LIVE_UNSAFE_COUNTERS
            .reduce((total, counter) => total + (outcome[counter] ?? 0), 0);
          if (unsafe > 0 && outcome.advanced !== true) {
            problems.push(
              `${where}: trial ${trial.trialId} reports an unsafe advance for ` +
                `${outcome.profileId} without advancing`,
            );
          }
          if (outcome.correctAdvance === true && outcome.advanced !== true) {
            problems.push(
              `${where}: trial ${trial.trialId} records a correct advance for ` +
                `${outcome.profileId} without advancing`,
            );
          }
          if (outcome.advanced === false && outcome.latencyMs !== null) {
            problems.push(
              `${where}: trial ${trial.trialId} records a latency for ${outcome.profileId} ` +
                "without advancing",
            );
          }
        }
      }
    }
  }
  return problems;
}

function liveTrialRows(archives, profileId) {
  return archives.flatMap((archive) => (archive.record?.setups ?? []).flatMap((setup) => (
    (setup.trials ?? []).map((trial) => ({
      setup,
      trial,
      baseline: (trial.outcomes ?? [])
        .find((row) => row.profileId === LIVE_BASELINE_PROFILE_ID),
      candidate: (trial.outcomes ?? []).find((row) => row.profileId === profileId),
    }))
  )).filter(({ baseline }) => baseline !== undefined));
}

/**
 * Rederives one candidate's live gates from the archived trials.
 *
 * This repeats, independently of the application code, the comparison the
 * decision claims: per trial, per counter, per setup. A corpus total is never
 * formed, so an acoustic safety failure cannot be paid for with a digital gain.
 */
export function rederiveLiveGateResult(profileId, archives) {
  const rows = liveTrialRows(archives, profileId);
  const measured = rows.filter(({ candidate }) => candidate !== undefined);
  const setups = [...new Map(measured.map(({ setup }) => [setup.setupId, setup])).values()];
  const setupCoverage = setups.map((setup) => ({
    setupId: setup.setupId,
    sourceFamily: LIVE_SOURCE_FAMILIES[setup.source],
    trialCount: measured.filter(({ setup: owner }) => owner.setupId === setup.setupId).length,
  }));
  if (measured.length === 0) {
    return { profileId, status: "not-collected", setupCoverage: [], failures: [] };
  }
  const failures = [];
  const fail = (gate, measure, detail) => failures.push({ gate, measure, ...detail });
  for (const family of LIVE_REQUIRED_SOURCE_FAMILIES) {
    if (!setupCoverage.some((setup) => setup.sourceFamily === family)) {
      fail("live-coverage", `${family}-setup-count`, { setupId: "", trialId: null });
    }
  }
  for (const setup of setups) {
    const classes = new Set(measured
      .filter(({ setup: owner }) => owner.setupId === setup.setupId)
      .map(({ trial }) => trial.trialClass));
    for (const trialClass of LIVE_REQUIRED_TRIAL_CLASSES) {
      if (!classes.has(trialClass)) {
        fail("live-coverage", `${trialClass}-trial-count`, {
          setupId: setup.setupId,
          trialId: null,
        });
      }
    }
  }
  for (const row of rows) {
    if (row.candidate === undefined) {
      fail("live-coverage", "candidate-outcome", {
        setupId: row.setup.setupId,
        trialId: row.trial.trialId,
      });
    }
  }
  for (const { setup, trial, baseline, candidate } of measured) {
    const where = { setupId: setup.setupId, trialId: trial.trialId };
    for (const counter of LIVE_UNSAFE_COUNTERS) {
      if ((candidate[counter] ?? 0) > (baseline[counter] ?? 0)) {
        fail("live-safety", counter, where);
      }
    }
    if (LIVE_NEGATIVE_TRIAL_CLASSES.includes(trial.trialClass) && candidate.advanced === true) {
      fail("live-safety", "advanced", where);
    }
    if (trial.expectedCorrect === true && baseline.correctAdvance === true &&
        candidate.correctAdvance !== true) {
      fail("live-correctness", "correctAdvance", where);
    }
    if (trial.trialClass === "repeated-chord" &&
        baseline.repeatedRecovery?.sourceDistance != null) {
      const candidateRecovery = candidate.repeatedRecovery;
      if (candidateRecovery?.sourceDistance == null) {
        fail("live-repeated-recovery", "sourceDistance", where);
      } else {
        if (candidateRecovery.sourceDistance - baseline.repeatedRecovery.sourceDistance >
            LIVE_REPEATED_SOURCE_DISTANCE_NO_REGRESSION) {
          fail("live-repeated-recovery", "sourceDistance", where);
        }
        if ((candidateRecovery.attributionDelayMs ?? 0) -
            (baseline.repeatedRecovery.attributionDelayMs ?? 0) >
            LIVE_REPEATED_DELAY_NO_REGRESSION_MS) {
          fail("live-repeated-recovery", "attributionDelayMs", where);
        }
      }
    }
    if (trial.expectedCorrect === true && baseline.latencyMs !== null &&
        candidate.latencyMs !== null && candidate.latencyMs !== undefined &&
        candidate.latencyMs - baseline.latencyMs > LIVE_LATENCY_REGRESSION_TOLERANCE_MS) {
      fail("live-latency", "latencyMs", where);
    }
  }
  return {
    profileId,
    status: failures.length === 0 ? "passed" : "failed",
    setupCoverage,
    failures,
  };
}

/** Rederives every automated-eligible candidate's live result. */
export function rederiveLiveGateResults(eligibility, archives) {
  const entries = eligibility?.runStatus === "completed" ? (eligibility.entries ?? []) : [];
  return entries
    .filter(({ automatedEligible }) => automatedEligible === true)
    .map(({ profileId }) => rederiveLiveGateResult(profileId, archives));
}

/* --- The ordered selection rule, rederived -------------------------------- */

const SELECTION_STEPS = Object.freeze([
  "live-safety",
  "live-correct-advancement",
  "automated-independent-recognition",
  "ordered-and-complete-progress",
  "latency",
  "distance-from-baseline",
]);

const ARCHIVE_UNSAFE_COUNTERS = Object.freeze([
  "falseAdvanceCount",
  "skippedAdvanceCount",
  "duplicateAdvanceCount",
  "incompleteCarriedBassAdvances",
]);

/** The registry generation the ranking's last step measures distance against. */
const REGISTRY_THRESHOLDS = Object.freeze({
  "baseline-v1": Object.freeze([0.6, 0.5, 0.35, 0.97]),
  "balanced-v1": Object.freeze([0.5, 0.5, 0.35, 0.99]),
  "sensitive-v1": Object.freeze([0.45, 0.5, 0.2, 0.99]),
  "early-open-v2": Object.freeze([0.45, 0.5, 0.2, 0.99]),
  "steady-open-v2": Object.freeze([0.5, 0.5, 0.2, 0.99]),
  "early-held-v2": Object.freeze([0.45, 0.5, 0.275, 0.99]),
  "steady-held-v2": Object.freeze([0.5, 0.5, 0.275, 0.99]),
});

function profileDistanceFromBaseline(profileId) {
  const profile = REGISTRY_THRESHOLDS[profileId];
  const baseline = REGISTRY_THRESHOLDS[LIVE_BASELINE_PROFILE_ID];
  if (profile === undefined) return null;
  return profile.reduce((total, value, index) => total + Math.abs(value - baseline[index]), 0);
}

function liveStepValues(archives, profileId, field) {
  const values = new Map();
  for (const archive of archives) {
    for (const setup of archive.record?.setups ?? []) {
      const rows = (setup.trials ?? []).map((trial) => ({
        trial,
        outcome: (trial.outcomes ?? []).find((row) => row.profileId === profileId),
      })).filter(({ outcome }) => outcome !== undefined);
      values.set(setup.setupId, field === "unsafe"
        ? rows.reduce((total, { outcome }) => (
          total + LIVE_UNSAFE_COUNTERS.reduce((sum, counter) => sum + (outcome[counter] ?? 0), 0)
        ), 0)
        : rows.filter(({ trial, outcome }) => (
          trial.expectedCorrect === true && outcome.correctAdvance === true
        )).length);
    }
  }
  return values;
}

/**
 * The automated values of one step, keyed by leaf.
 *
 * A leaf is a renderer *and* an instrument, because the plan ranks independent
 * recognition across renderers and instruments: a renderer total that averages a
 * gain on one piano over a loss on another has already hidden the comparison.
 * Ordered advances and complete passages are two keys rather than a sum, so an
 * ordered gain cannot conceal a complete-passage loss.
 */
function automatedStepValues(archive, profileId, field) {
  const record = Array.isArray(archive) ? archive[0] : archive;
  const leafByTrace = new Map((record?.captures ?? []).map((capture) => [
    capture.traceId,
    `${capture.rendererKey}/${capture.piano ?? "none"}`,
  ]));
  const rows = (record?.outcomes ?? []).filter((row) => row.profileId === profileId);
  const leaves = [...new Set([...leafByTrace.values()])].sort();
  const values = new Map();
  for (const leaf of leaves) {
    const leafRows = rows.filter((row) => leafByTrace.get(row.traceId) === leaf);
    if (field === "latency") {
      const percentiles = (record?.domainSummaries ?? [])
        .filter((summary) => summary.profileId === profileId &&
          (summary.traceIds ?? []).some((traceId) => leafByTrace.get(traceId) === leaf))
        .map((summary) => summary.p95OnsetToAdvanceMs)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      values.set(leaf, percentiles.length === 0 ? null : Math.max(...percentiles));
      continue;
    }
    const sum = (counter) => leafRows.reduce((total, row) => total + (row[counter] ?? 0), 0);
    if (field === "independent") {
      values.set(leaf, sum("independentMatchCount"));
      continue;
    }
    values.set(`${leaf}:ordered`, sum("orderedAdvanceCount"));
    values.set(`${leaf}:complete`, sum("completePassageCount"));
  }
  return values;
}

function stepDominance(left, right, better) {
  let leftBetter = false;
  let rightBetter = false;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key) ?? null;
    const b = right.get(key) ?? null;
    if (a === null || b === null) {
      if (a === null && b !== null) rightBetter = true;
      if (b === null && a !== null) leftBetter = true;
      continue;
    }
    if (a === b) continue;
    if (better === "higher" ? a > b : a < b) leftBetter = true;
    else rightBetter = true;
  }
  if (leftBetter && !rightBetter) return -1;
  if (rightBetter && !leftBetter) return 1;
  return 0;
}

function selectionStepValues(step, profileId, liveArchives, confirmationArchive) {
  switch (step) {
    case "live-safety":
      return { values: liveStepValues(liveArchives, profileId, "unsafe"), better: "lower" };
    case "live-correct-advancement":
      return { values: liveStepValues(liveArchives, profileId, "correct"), better: "higher" };
    case "automated-independent-recognition":
      return {
        values: automatedStepValues(confirmationArchive, profileId, "independent"),
        better: "higher",
      };
    case "ordered-and-complete-progress":
      return {
        values: automatedStepValues(confirmationArchive, profileId, "ordered"),
        better: "higher",
      };
    case "latency":
      return {
        values: automatedStepValues(confirmationArchive, profileId, "latency"),
        better: "lower",
      };
    default:
      return {
        values: new Map([["registry", profileDistanceFromBaseline(profileId)]]),
        better: "lower",
      };
  }
}

/* --- The frozen promotion materiality, rederived --------------------------- */

/** Task 23's frozen boundaries, restated so materiality can be recomputed here. */
export const PROMOTION_MATERIAL_IMPROVEMENT = Object.freeze({
  minimumRateGain: 0.01,
  rateComparisonEpsilon: 1e-12,
  minimumLatencyReductionMs: 32,
  latencyComparisonEpsilonMs: 1e-9,
  minimumUnsafeEventReduction: 1,
});

function rateGain(id, baselineRate, profileRate) {
  const improvement = profileRate - baselineRate;
  return {
    id,
    kind: "rate-gain",
    improvement,
    material: improvement + PROMOTION_MATERIAL_IMPROVEMENT.rateComparisonEpsilon >=
      PROMOTION_MATERIAL_IMPROVEMENT.minimumRateGain,
  };
}

function latencyReduction(id, baselineMs, profileMs) {
  const improvement = baselineMs - profileMs;
  return {
    id,
    kind: "latency-reduction",
    improvement,
    material: improvement + PROMOTION_MATERIAL_IMPROVEMENT.latencyComparisonEpsilonMs >=
      PROMOTION_MATERIAL_IMPROVEMENT.minimumLatencyReductionMs,
  };
}

function unsafeEventReduction(id, baselineCount, profileCount) {
  const improvement = baselineCount - profileCount;
  return {
    id,
    kind: "unsafe-event-reduction",
    improvement,
    material: improvement >= PROMOTION_MATERIAL_IMPROVEMENT.minimumUnsafeEventReduction,
  };
}

function summaryFor(renderer, profileId) {
  return (renderer?.profiles ?? []).find((row) => row.profileId === profileId);
}

/**
 * Rederives Task 23's promotion materiality from one archived repetition.
 *
 * The axes are the policy's own — isolated correct-advance and Course Clear
 * rates and latency, the sequence independent, ordered, and complete-passage
 * rates and latency, the dynamics equal-piano suites, and cross-domain
 * unsafe-event reduction — recomputed here rather than taken from the decision,
 * so a promotion earned on an axis the policy does not name, or refused on one it
 * does, fails verification instead of shipping.
 */
export function rederivePromotionMateriality(archive, profileId) {
  const record = Array.isArray(archive) ? archive[0] : archive;
  const assessments = [];
  const baselineId = LIVE_BASELINE_PROFILE_ID;
  for (const renderer of record?.isolated?.renderers ?? []) {
    const profile = summaryFor(renderer, profileId);
    const baseline = summaryFor(renderer, baselineId);
    if (profile === undefined || baseline === undefined) continue;
    for (const [metric, census, baselineCount, profileCount] of [
      [
        "isolated-correct-advance-rate",
        renderer.correctTrialCount,
        baseline.correctAdvanceCount,
        profile.correctAdvanceCount,
      ],
      [
        "course-clear-correct-advance-rate",
        baseline.courseClearCorrectTrialCount,
        baseline.courseClearAdvanceCount,
        profile.courseClearAdvanceCount,
      ],
    ]) {
      assessments.push(rateGain(
        `isolated/${renderer.rendererKey}/${metric}`,
        census === 0 ? 0 : baselineCount / census,
        census === 0 ? 0 : profileCount / census,
      ));
    }
    if (profile.summary?.p95OnsetToAdvanceMs != null &&
        baseline.summary?.p95OnsetToAdvanceMs != null) {
      assessments.push(latencyReduction(
        `isolated/${renderer.rendererKey}/p95-onset-to-advance-ms`,
        baseline.summary.p95OnsetToAdvanceMs,
        profile.summary.p95OnsetToAdvanceMs,
      ));
    }
  }
  for (const renderer of record?.sequence?.renderers ?? []) {
    const profile = summaryFor(renderer, profileId);
    const baseline = summaryFor(renderer, baselineId);
    if (profile === undefined || baseline === undefined) continue;
    for (const metric of [
      "independentMatchRate",
      "orderedAdvanceRate",
      "completePassageRate",
    ]) {
      const label = metric.replace(/([A-Z])/g, "-$1").toLowerCase();
      assessments.push(rateGain(
        `sequence/${renderer.rendererKey}/${label}`,
        baseline.totals?.[metric] ?? 0,
        profile.totals?.[metric] ?? 0,
      ));
    }
    if (profile.totals?.p95OrderedAdvanceLatencyMs != null &&
        baseline.totals?.p95OrderedAdvanceLatencyMs != null) {
      assessments.push(latencyReduction(
        `sequence/${renderer.rendererKey}/p95-ordered-advance-ms`,
        baseline.totals.p95OrderedAdvanceLatencyMs,
        profile.totals.p95OrderedAdvanceLatencyMs,
      ));
    }
  }
  for (const renderer of record?.dynamics?.renderers ?? []) {
    const profile = summaryFor(renderer, profileId);
    const baseline = summaryFor(renderer, baselineId);
    if (profile === undefined || baseline === undefined) continue;
    for (const suite of profile.equalPiano ?? []) {
      const baselineSuite = (baseline.equalPiano ?? [])
        .find((row) => row.suite === suite.suite);
      if (baselineSuite === undefined) continue;
      for (const metric of [
        "independentMatchRate",
        "orderedAdvanceRate",
        "completePassageRate",
      ]) {
        if (baselineSuite[metric] == null || suite[metric] == null) continue;
        const label = metric.replace(/([A-Z])/g, "-$1").toLowerCase();
        assessments.push(rateGain(
          `dynamics/${renderer.rendererKey}/${suite.suite}/${label}`,
          baselineSuite[metric],
          suite[metric],
        ));
      }
    }
  }
  const unsafeTotal = (id) => {
    const isolated = (record?.isolated?.renderers ?? []).reduce((total, renderer) => (
      total + (summaryFor(renderer, id)?.summary?.falseAdvanceCount ?? 0)
    ), 0);
    const sequence = (record?.sequence?.renderers ?? []).reduce((total, renderer) => {
      const row = summaryFor(renderer, id);
      return total +
        (row?.totals?.falseAdvanceCount ?? 0) + (row?.totals?.skippedAdvanceCount ?? 0) +
        (row?.totals?.duplicateAdvanceCount ?? 0) +
        (row?.regressionTotals?.falseAdvanceCount ?? 0) +
        (row?.regressionTotals?.skippedAdvanceCount ?? 0) +
        (row?.regressionTotals?.duplicateAdvanceCount ?? 0);
    }, 0);
    const dynamics = (record?.dynamics?.renderers ?? []).reduce((total, renderer) => {
      const row = summaryFor(renderer, id);
      return total + (row?.safety?.falseAdvanceCount ?? 0) +
        (row?.safety?.skippedAdvanceCount ?? 0) + (row?.safety?.duplicateAdvanceCount ?? 0);
    }, 0);
    return isolated + sequence + dynamics;
  };
  assessments.push(unsafeEventReduction(
    "cross-domain/unsafe-event-count",
    unsafeTotal(baselineId),
    unsafeTotal(profileId),
  ));
  return assessments;
}

/**
 * Rederives which approved candidate the frozen ordered rule promotes.
 *
 * The winner must beat every other approved candidate pairwise, and dominance is
 * a partial order, so "no winner" is a real answer. This reports the identifier
 * the rule produces and the step that decided each pair; it deliberately does not
 * reproduce the material-improvement assessment, which the decision records and
 * which is checked as agreement between the record and its own promotion.
 */
export function rederiveSelectedDefault(options) {
  const candidates = [...options.approvedCandidateProfileIds];
  const comparisons = [];
  if (candidates.length === 0) return { winner: null, comparisons };
  const wins = new Map(candidates.map((profileId) => [profileId, 0]));
  for (const [index, left] of candidates.entries()) {
    for (const right of candidates.slice(index + 1)) {
      let order = 0;
      let decidedByStep = null;
      for (const step of SELECTION_STEPS) {
        const leftValues = selectionStepValues(
          step, left, options.liveArchives, options.confirmationArchive,
        );
        const rightValues = selectionStepValues(
          step, right, options.liveArchives, options.confirmationArchive,
        );
        order = stepDominance(leftValues.values, rightValues.values, leftValues.better);
        if (order !== 0) {
          decidedByStep = step;
          break;
        }
      }
      const winner = order === -1 ? left : order === 1 ? right : null;
      if (winner !== null) wins.set(winner, wins.get(winner) + 1);
      comparisons.push({ left, right, winner, decidedByStep });
    }
  }
  const outright = candidates.filter((profileId) => wins.get(profileId) === candidates.length - 1);
  return { winner: outright.length === 1 ? outright[0] : null, comparisons };
}

/**
 * Everything that makes the Task 29 file the round's production decision.
 *
 * The list is never read as a conclusion. Both digest links are recomputed from
 * the records they name, the Task 26 root is rerun from both archived
 * repetitions, membership is rederived from the eligibility manifest under the
 * rule above, the bounded outcome is rederived from the branch and that
 * membership, and the ablation record is recomputed from the archives rather than
 * copied — so a decision that states a conclusion its own chain does not produce
 * fails here.
 */
export function roundTwoApprovedProfilesProblems(
  artifact,
  result,
  eligibility,
  candidateManifest,
  evidenceRuns,
  requirementBytes,
  liveArchives = [],
  confirmationArchives = [],
) {
  const expected = artifact.roundTwoApprovedProfiles;
  if (expected === undefined) return [];
  if (Array.isArray(result) || typeof result !== "object" || result === null) {
    return [`${artifact.name}: the approved-profile list is one record, not a list`];
  }
  const problems = [];
  const check = (label, actual, wanted) => {
    if (actual !== wanted) {
      problems.push(
        `${artifact.name}: ${label} ${printable(actual)}, expected ${printable(wanted)}`,
      );
    }
  };
  check("command", result.name, expected.name);
  check("format version", result.formatVersion, expected.formatVersion);
  check("round", result.roundId, expected.roundId);
  check("outcome", result.outcome, expected.outcome);
  check("reason", result.reason, expected.reason);
  check("selected default", result.selectedDefaultProfileId, expected.selectedDefaultProfileId);
  check("incumbent", result.incumbentProfileId, APPROVED_INCUMBENT_PROFILE_ID);
  check("eligibility run status", result.eligibilityRunStatus, expected.eligibilityRunStatus);
  check("eligibility manifest digest", result.eligibilityManifestDigest,
    expected.eligibilityManifestDigest);
  check("candidate manifest digest", result.candidateManifestDigest,
    expected.candidateManifestDigest);
  check("terminal outcome", result.task26TerminalOutcome, expected.task26TerminalOutcome);
  check("Task 26 evidence digest", result.task26EvidenceDigest, expected.task26EvidenceDigest);
  check("digest algorithm", result.digest?.algorithm, "fnv1a-32-canonical-json");
  check("digest", result.digest?.value, expected.digest);
  if (!DECISION_OUTCOMES.includes(result.outcome)) {
    problems.push(`${artifact.name}: unknown outcome ${printable(result.outcome)}`);
  }
  const requirementOwed = result.outcome !== "promoted-candidate" ||
    (result.repeatedChordResult ?? []).find(
      ({ profileId }) => profileId === result.selectedDefaultProfileId,
    )?.repeatedRecoveryOutcome !== "confirmed-full-resolution";
  const keys = [
    ...APPROVED_PROFILES_KEYS,
    ...(Object.hasOwn(result, "selection") ? ["selection"] : []),
    ...(requirementOwed ? ["modelEvidenceRequirement"] : []),
  ];
  for (const key of keys) {
    if (!Object.hasOwn(result, key)) problems.push(`${artifact.name}: missing ${key}`);
  }
  for (const key of Object.keys(result)) {
    if (!keys.includes(key)) problems.push(`${artifact.name}: carries forbidden field ${key}`);
  }

  const { digest: _digest, ...digestInput } = result;
  check("recomputed digest", canonicalJsonDigest(digestInput), expected.digest);

  // The residual is carried by a written requirement, referenced by the digest of
  // its actual bytes: a requirement that can be emptied after the decision cites
  // it is not a carried residual.
  if (requirementOwed) {
    const requirement = result.modelEvidenceRequirement ?? {};
    check("requirement path", requirement.path, expected.modelEvidenceRequirementPath);
    if (requirementBytes === null || requirementBytes === undefined) {
      problems.push(
        `${artifact.name}: ${printable(requirement.path)} is not in the repository`,
      );
    } else {
      const digest = sha256(requirementBytes);
      if (requirement.sha256 !== digest) {
        problems.push(
          `${artifact.name}: the requirement records SHA-256 ${printable(requirement.sha256)}, ` +
            `and that file hashes to ${digest}`,
        );
      }
    }
  } else if (result.modelEvidenceRequirement !== undefined) {
    problems.push(
      `${artifact.name}: a confirmed full resolution still carries a residual requirement`,
    );
  }

  // The chain: this record to the eligibility manifest, that one to the candidate
  // manifest, and that one to the Task 26 archives, each recomputed from the
  // record it describes rather than compared to the digest it states about itself.
  if (typeof eligibility !== "object" || eligibility === null || Array.isArray(eligibility)) {
    problems.push(`${artifact.name}: the eligibility manifest it chains to is not a record`);
    return problems;
  }
  const { digest: _eligibilityDigest, ...eligibilityInput } = eligibility;
  const eligibilityDigest = canonicalJsonDigest(eligibilityInput);
  if (eligibility.digest?.value !== eligibilityDigest) {
    problems.push(
      `${artifact.name}: the eligibility manifest records digest ` +
        `${printable(eligibility.digest?.value)}, recomputed ${eligibilityDigest}`,
    );
  }
  if (result.eligibilityManifestDigest !== eligibilityDigest) {
    problems.push(
      `${artifact.name}: chains to eligibility manifest ` +
        `${printable(result.eligibilityManifestDigest)}, and that record hashes to ` +
        `${eligibilityDigest}`,
    );
  }
  const { digest: _candidateDigest, ...candidateInput } = candidateManifest ?? {};
  const candidateDigest = canonicalJsonDigest(candidateInput);
  if (candidateManifest?.digest?.value !== candidateDigest) {
    problems.push(
      `${artifact.name}: the candidate manifest records digest ` +
        `${printable(candidateManifest?.digest?.value)}, recomputed ${candidateDigest}`,
    );
  }
  for (const [label, stated] of [
    ["the approved-profile list", result.candidateManifestDigest],
    ["the eligibility manifest", eligibility.candidateManifestDigest],
  ]) {
    if (stated !== candidateDigest) {
      problems.push(
        `${artifact.name}: ${label} chains to candidate manifest ${printable(stated)}, and that ` +
          `record hashes to ${candidateDigest}`,
      );
    }
  }
  // The outcome, the reason, and the run status have to agree at every step, or
  // the conclusion describes a round the chain did not measure.
  if (result.eligibilityRunStatus !== eligibility.runStatus) {
    problems.push(
      `${artifact.name}: records run status ${printable(result.eligibilityRunStatus)}, and the ` +
        `eligibility manifest records ${printable(eligibility.runStatus)}`,
    );
  }
  for (const key of ["task26TerminalOutcome", "task26EvidenceDigest"]) {
    for (const [label, record] of [
      ["the eligibility manifest", eligibility],
      ["the candidate manifest", candidateManifest ?? {}],
    ]) {
      if (result[key] !== record[key]) {
        problems.push(
          `${artifact.name}: the chain disagrees about ${key}: ${printable(result[key])} against ` +
            `${label} ${printable(record[key])}`,
        );
      }
    }
  }
  const expectedReason = eligibility.runStatus === "not-run-no-confirmable-candidate"
    ? eligibility.reason
    : null;
  if (result.reason !== expectedReason) {
    problems.push(
      `${artifact.name}: records reason ${printable(result.reason)}, and the eligibility ` +
        `manifest records ${printable(expectedReason)}`,
    );
  }
  if (result.reason !== (candidateManifest?.notRunReason ?? null)) {
    problems.push(
      `${artifact.name}: records reason ${printable(result.reason)}, and the candidate manifest ` +
        `records ${printable(candidateManifest?.notRunReason)}`,
    );
  }
  if (!sameCanonicalValue(result.confirmationPartition, eligibility.confirmationPartition)) {
    problems.push(
      `${artifact.name}: its confirmation partition is not the one the eligibility manifest ` +
        "measured",
    );
  }

  // Membership, the bounded outcome, the live corpus, and the promoted default,
  // all rederived from the archives rather than read from the record.
  const liveResults = Array.isArray(result.liveCorpus?.results) ? result.liveCorpus.results : null;
  const automatedEligibleProfileIds = (eligibility.runStatus === "completed"
    ? (eligibility.entries ?? [])
    : []).filter(({ automatedEligible }) => automatedEligible === true)
    .map(({ profileId }) => profileId);
  if (liveResults === null) {
    problems.push(`${artifact.name}: records no live-corpus result list`);
  } else {
    const status = liveResults.length > 0 ? "collected" : "not-collected";
    if (result.liveCorpus?.status !== status) {
      problems.push(
        `${artifact.name}: the live corpus reports status ${printable(result.liveCorpus?.status)} ` +
          `with ${liveResults.length} results`,
      );
    }
    if (eligibility.runStatus === "not-run-no-confirmable-candidate" && liveResults.length > 0) {
      problems.push(
        `${artifact.name}: the not-run branch confirmed no candidate, and a live corpus was ` +
          "collected for one",
      );
    }
    if (liveResults.length > 0) {
      // A stated live result is an approval, so it is checked against the trials
      // that produced it. Without the archives there is nothing to check it
      // against, and an unverifiable approval is refused rather than accepted.
      if (!Array.isArray(result.liveCorpus?.archives) ||
          result.liveCorpus.archives.length === 0) {
        problems.push(
          `${artifact.name}: states live results and names no archive they came from`,
        );
      } else if (liveArchives.length === 0) {
        problems.push(
          `${artifact.name}: the live archives it names could not be read for verification`,
        );
      } else {
        problems.push(...roundTwoLiveArchiveProblems(artifact.name, liveArchives, {
          eligibilityManifestDigest: eligibilityDigest,
          automatedEligibleProfileIds,
        }));
        const rederived = rederiveLiveGateResults(eligibility, liveArchives);
        const stateStated = liveResults.map((row) => ({
          profileId: row.profileId,
          status: row.status,
          failures: (row.gates ?? []).flatMap((gate) => (gate.failures ?? []).map((failure) => ({
            gate: failure.gate,
            measure: failure.measure,
            setupId: failure.setupId,
            trialId: failure.trialId,
          }))),
          setupCoverage: row.setupCoverage,
        }));
        const stateDerived = rederived.map((row) => ({
          profileId: row.profileId,
          status: row.status,
          failures: row.failures,
          setupCoverage: row.setupCoverage,
        }));
        if (canonicalJson(stateStated) !== canonicalJson(stateDerived)) {
          problems.push(
            `${artifact.name}: its live results are not what its own archives produce; the ` +
              `archives rederive ${canonicalJson(stateDerived.map(({ profileId, status }) => (
                `${profileId}=${status}`
              )))}`,
          );
        }
      }
    }
  }
  const verifiedLiveResults = liveArchives.length > 0
    ? rederiveLiveGateResults(eligibility, liveArchives)
    : (liveResults ?? []);
  const { approved, problems: membershipProblems } =
    rederiveApprovedProfileIds(eligibility, verifiedLiveResults);
  for (const problem of membershipProblems) problems.push(`${artifact.name}: ${problem}`);
  const stated = Array.isArray(result.approvedProfileIds) ? result.approvedProfileIds : [];
  if (new Set(stated).size !== stated.length) {
    problems.push(`${artifact.name}: the approved list names a profile twice`);
  }
  if (stated[0] !== APPROVED_INCUMBENT_PROFILE_ID) {
    problems.push(
      `${artifact.name}: the approved list heads with ${printable(stated[0])} rather than the ` +
        `measured incumbent ${APPROVED_INCUMBENT_PROFILE_ID}`,
    );
  }
  if (!sameList([...stated].sort(), approved)) {
    problems.push(
      `${artifact.name}: approves ${stated.join(", ") || "nothing"}, and its own evidence ` +
        `approves ${approved.join(", ")}`,
    );
  }
  if (!stated.includes(result.selectedDefaultProfileId)) {
    problems.push(
      `${artifact.name}: the selected default ${printable(result.selectedDefaultProfileId)} is ` +
        "not a member of the list it heads",
    );
  }
  const approvedCandidates = approved
    .filter((profileId) => profileId !== APPROVED_INCUMBENT_PROFILE_ID);
  // The promoted identifier is rederived from the frozen ordered rule over the
  // same archives. A record that names the top of a sweep, a caller's preference,
  // or a tie resolved by hand fails here rather than shipping.
  let ruleWinner = null;
  if (approvedCandidates.length > 0) {
    if (confirmationArchives.length < 2) {
      problems.push(
        `${artifact.name}: ranking approved candidates needs both archived confirmation ` +
          "repetitions, and they were not available for verification",
      );
    } else {
      const rankings = confirmationArchives.map((archive) => rederiveSelectedDefault({
        approvedCandidateProfileIds: approvedCandidates,
        liveArchives,
        confirmationArchive: archive,
      }));
      const [first, ...rest] = rankings;
      if (rest.some((ranking) => canonicalJson(ranking) !== canonicalJson(first))) {
        problems.push(
          `${artifact.name}: the confirmation repetitions rank the approved candidates ` +
            "differently, so the ranking is a ranking of one run",
        );
      }
      ruleWinner = first.winner;
      // Materiality is rederived here rather than accepted from the record: a
      // promotion earned on an axis Task 23's policy does not name, or refused on
      // one it does, must fail verification rather than ship.
      if (ruleWinner !== null) {
        const assessments = confirmationArchives
          .map((archive) => rederivePromotionMateriality(archive, ruleWinner));
        const [firstAssessment, ...otherAssessments] = assessments;
        if (otherAssessments.some((other) => (
          canonicalJson(other) !== canonicalJson(firstAssessment)
        ))) {
          problems.push(
            `${artifact.name}: the confirmation repetitions assess ${ruleWinner}'s materiality ` +
              "differently, so the promotion rests on one run",
          );
        }
        const material = firstAssessment.filter(({ material: met }) => met);
        const promotedProfile = result.selection?.promotedProfileId ?? null;
        if (material.length === 0 && promotedProfile !== null) {
          problems.push(
            `${artifact.name}: promotes ${printable(promotedProfile)}, and the frozen Task 23 ` +
              "materiality finds no material axis in the archived measurements",
          );
        }
        if (material.length > 0 && promotedProfile === null &&
            result.selection?.notPromotedReason === "no-material-improvement") {
          problems.push(
            `${artifact.name}: refuses ${ruleWinner} for no material improvement, and the frozen ` +
              `Task 23 materiality finds ${material.map(({ id }) => id).join(", ")}`,
          );
        }
        // The record's own assessment must be the policy's, axis for axis.
        const statedMaterial = (result.selection?.materialImprovement ?? [])
          .map(({ id, material: met }) => `${id}=${met === true}`).sort();
        const derivedMaterial = firstAssessment
          .map(({ id, material: met }) => `${id}=${met === true}`).sort();
        if (statedMaterial.length > 0 &&
            canonicalJson(statedMaterial) !== canonicalJson(derivedMaterial)) {
          problems.push(
            `${artifact.name}: its material-improvement record is not the frozen Task 23 ` +
              "assessment of its own archives",
          );
        }
      }
      const statedComparisons = (result.selection?.comparisons ?? []).map((comparison) => ({
        winner: comparison.winnerProfileId === "" ? null : comparison.winnerProfileId,
        decidedByStep: comparison.decidedByStep,
      }));
      const derivedComparisons = first.comparisons
        .map(({ winner, decidedByStep }) => ({ winner, decidedByStep }));
      if (canonicalJson(statedComparisons) !== canonicalJson(derivedComparisons)) {
        problems.push(
          `${artifact.name}: its selection record is not the comparison the frozen ordered rule ` +
            "produces from its own archives",
        );
      }
      const promotedProfileId = result.selection?.promotedProfileId ?? null;
      if (promotedProfileId !== null && promotedProfileId !== ruleWinner) {
        problems.push(
          `${artifact.name}: promotes ${printable(promotedProfileId)}, and the frozen ordered ` +
            `rule produces ${printable(ruleWinner)}`,
        );
      }
      if (ruleWinner === null && result.selection?.notPromotedReason !==
          "ordered-rule-did-not-separate") {
        problems.push(
          `${artifact.name}: the ordered rule separates no candidate, and the record records ` +
            `${printable(result.selection?.notPromotedReason)}`,
        );
      }
    }
  } else if (result.selection !== undefined) {
    problems.push(
      `${artifact.name}: carries a selection record for a round that approved no candidate`,
    );
  }
  const promotedProfileId = approvedCandidates.length > 0
    ? (result.selection?.promotedProfileId ?? null)
    : null;
  const derivedOutcome = promotedProfileId !== null
    ? "promoted-candidate"
    : approvedCandidates.length > 0
    ? "approved-without-material-improvement"
    : eligibility.runStatus === "completed"
    ? "round-two-candidate-set-exhausted"
    : "round-two-grid-produced-no-eligible-improvement";
  if (result.outcome !== derivedOutcome) {
    problems.push(
      `${artifact.name}: records outcome ${printable(result.outcome)}, and its own evidence ` +
        `produces ${derivedOutcome}`,
    );
  }
  if (derivedOutcome !== "promoted-candidate" &&
      result.selectedDefaultProfileId !== APPROVED_INCUMBENT_PROFILE_ID) {
    problems.push(
      `${artifact.name}: the round promoted nothing and records default ` +
        `${printable(result.selectedDefaultProfileId)}`,
    );
  }
  if (derivedOutcome === "promoted-candidate" &&
      result.selectedDefaultProfileId !== ruleWinner) {
    problems.push(
      `${artifact.name}: records default ${printable(result.selectedDefaultProfileId)}, and the ` +
        `frozen ordered rule produces ${printable(ruleWinner)}`,
    );
  }
  // Task 24's two labels are copied from the eligibility entries, never restated,
  // so a recovery cannot be claimed here without the per-group evidence behind it.
  const copied = (eligibility.runStatus === "completed" ? (eligibility.entries ?? []) : [])
    .map(({ profileId, repeatedRecoveryOutcome, confirmationReproductionStatus }) => ({
      profileId,
      repeatedRecoveryOutcome,
      confirmationReproductionStatus,
    }));
  if (!sameCanonicalValue(result.repeatedChordResult, copied)) {
    problems.push(
      `${artifact.name}: its repeated-chord result is not a copy of the eligibility manifest's ` +
        "own labels",
    );
  }

  // What each ablation selected and which rule refused it, recomputed from both
  // archived repetitions. A conclusion that reports the round as having found
  // nothing, when the stop rule refused ablations that did select profiles, fails
  // here rather than reading as a bounded finding.
  if (!Array.isArray(evidenceRuns) || evidenceRuns.length !== expected.evidencePaths.length) {
    problems.push(`${artifact.name}: expected ${expected.evidencePaths.length} Task 26 repetitions`);
    return problems;
  }
  evidenceRuns.forEach((run, index) => {
    const label = `${artifact.name}: ${expected.evidencePaths[index]}`;
    const [record] = Array.isArray(run) ? run : [];
    if (record === undefined) {
      problems.push(`${label} is not one Task 26 record`);
      return;
    }
    const rerun = rerunRoundTwoSelection(record, expected);
    if (rerun.evidenceDigest !== result.task26EvidenceDigest) {
      problems.push(
        `${label} recomputes to digest ${rerun.evidenceDigest}, and the chain references ` +
          `${printable(result.task26EvidenceDigest)}`,
      );
    }
    if (rerun.terminalOutcome !== result.task26TerminalOutcome) {
      problems.push(
        `${label} reruns to terminal outcome ${rerun.terminalOutcome}, and the chain records ` +
          `${printable(result.task26TerminalOutcome)}`,
      );
    }
    if (rerun.notRunReason !== result.reason) {
      problems.push(
        `${label} reruns to reason ${printable(rerun.notRunReason)}, and the chain records ` +
          `${printable(result.reason)}`,
      );
    }
    const recomputed = rerun.ablations.map(({ ablation, selectedProfileIds, stop }) => ({
      ablation,
      selectedProfileIds,
      stopSatisfied: stop.satisfied,
      stopReasons: stop.reasons,
      registrable: stop.satisfied && rerun.ablationId === ablation,
    }));
    if (!sameCanonicalValue(result.ablations, recomputed)) {
      problems.push(
        `${label} reruns to ablations ${canonicalJson(recomputed)}, and the chain records ` +
          `${canonicalJson(result.ablations ?? [])}`,
      );
    }
  });
  return problems;
}

/** Canonical-form equality, so field order never decides whether two records agree. */
function sameCanonicalValue(left, right) {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

/**
 * A decision that collected no live corpus wrote no live-corpus archive.
 *
 * The not-run branch's live outcome is that no session happened, so any other
 * Task 29 file in `benchmark-results` is either a corpus this branch forbids or a
 * placeholder that would later read as one.
 */
export function roundTwoLiveCorpusArchiveProblems(fileNames, listPath, liveCorpusStatus) {
  if (liveCorpusStatus !== "not-collected") return [];
  const listFile = listPath.split("/").at(-1);
  const strays = fileNames
    .filter((name) => /task29/i.test(name) && name !== listFile)
    .sort();
  return strays.length === 0
    ? []
    : [`No live corpus was collected, but found ${strays.join(", ")}`];
}

/** Verifies the committed Task 08, 10, 11, 22, 24, 26, 27, 28, and 29 evidence against frozen pins. */
export async function verifyFrozenEvidence() {
  const problems = [];
  for (const artifact of EVIDENCE_ARTIFACTS) {
    const bytes = await readFile(join(REPOSITORY_ROOT, artifact.path));
    const result = JSON.parse(bytes.toString("utf8"));
    const fileDigest = sha256(bytes);
    let evidenceDigest;
    if (artifact.evidenceSha256 !== undefined) {
      // The newline is part of the canonical byte format, matching the archived
      // pretty-printed JSON files and making the recipe unambiguous across tools.
      const evidenceBytes = `${canonicalJson(result, artifact.omittedFields)}\n`;
      evidenceDigest = sha256(evidenceBytes);
    }

    if (fileDigest !== artifact.fileSha256) {
      problems.push(`${artifact.name}: file SHA-256 ${fileDigest}, expected ${artifact.fileSha256}`);
    }
    if (artifact.evidenceSha256 !== undefined && evidenceDigest !== artifact.evidenceSha256) {
      problems.push(
        `${artifact.name}: evidence SHA-256 ${evidenceDigest}, expected ${artifact.evidenceSha256}`,
      );
    }

    let candidateArchive;
    if (artifact.candidateArchiveDigest !== undefined) {
      const benchmarkResults = Array.isArray(result) ? result : [result];
      const candidateArchives = benchmarkResults
        .map((benchmarkResult) => benchmarkResult.candidateArchive)
        .filter((archive) => archive !== undefined);
      if (candidateArchives.length !== 1) {
        problems.push(`${artifact.name}: found ${candidateArchives.length} candidate archives`);
      } else {
        [candidateArchive] = candidateArchives;
        if (candidateArchive.digest?.algorithm !== "fnv1a-32-canonical-json") {
          problems.push(`${artifact.name}: unexpected candidate archive digest algorithm`);
        }
        if (candidateArchive.digest?.value !== artifact.candidateArchiveDigest) {
          problems.push(
            `${artifact.name}: candidate digest ${candidateArchive.digest?.value}, expected ` +
              `${artifact.candidateArchiveDigest}`,
          );
        }
        if (candidateArchive.candidateCount !== artifact.candidateCount ||
            candidateArchive.candidates?.length !== artifact.candidateCount) {
          problems.push(
            `${artifact.name}: candidate count ${candidateArchive.candidateCount}/` +
              `${candidateArchive.candidates?.length}, expected ${artifact.candidateCount}`,
          );
        }
      }
    }

    if (artifact.bassQualification !== undefined) {
      problems.push(...bassQualificationProblems(artifact, result));
    }
    if (artifact.task24DomainArchive !== undefined) {
      problems.push(...task24DomainArchiveProblems(artifact, result));
    }
    if (artifact.roundTwoAblation !== undefined) {
      problems.push(...roundTwoAblationProblems(artifact, result));
    }
    if (artifact.roundTwoCandidateManifest !== undefined) {
      const evidenceRuns = await Promise.all(
        artifact.roundTwoCandidateManifest.evidencePaths.map(async (path) => JSON.parse(
          (await readFile(join(REPOSITORY_ROOT, path))).toString("utf8"),
        )),
      );
      problems.push(...roundTwoCandidateManifestProblems(artifact, result, evidenceRuns));
      problems.push(...roundTwoSearchArchiveProblems(
        await readdir(join(REPOSITORY_ROOT, "benchmark-results")),
        artifact.path,
      ));
    }
    if (artifact.roundTwoApprovedProfiles !== undefined) {
      const expected = artifact.roundTwoApprovedProfiles;
      const [eligibility, candidateManifest, ...evidenceRuns] = await Promise.all([
        expected.eligibilityManifestPath,
        expected.candidateManifestPath,
        ...expected.evidencePaths,
      ].map(async (path) => JSON.parse(
        (await readFile(join(REPOSITORY_ROOT, path))).toString("utf8"),
      )));
      // The requirement is read rather than trusted: the decision references it by
      // the digest of its actual bytes, so those bytes have to exist.
      let requirementBytes = null;
      try {
        requirementBytes = await readFile(join(
          REPOSITORY_ROOT,
          result.modelEvidenceRequirement?.path ?? expected.modelEvidenceRequirementPath,
        ));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      // A collected live corpus is read from the files the record names, and the
      // ranking from the confirmation repetitions the eligibility manifest names,
      // so both are rederived from bytes rather than from the record's summary.
      const liveArchives = await readRoundTwoLiveArchives(result.liveCorpus?.archives ?? []);
      const confirmationArchives = eligibility.runStatus === "completed"
        ? [...(await readRoundTwoConfirmationArchives([
          eligibility.confirmationEvidence?.runOneArchive,
          eligibility.confirmationEvidence?.runTwoArchive,
        ])).values()]
          .filter((archive) => archive.record !== undefined)
          .map((archive) => archive.record)
        : [];
      problems.push(...roundTwoApprovedProfilesProblems(
        artifact,
        result,
        eligibility,
        candidateManifest,
        evidenceRuns,
        requirementBytes,
        liveArchives,
        confirmationArchives,
      ));
      problems.push(...roundTwoLiveCorpusArchiveProblems(
        await readdir(join(REPOSITORY_ROOT, "benchmark-results")),
        artifact.path,
        result.liveCorpus?.status,
      ));
    }
    if (artifact.roundTwoEligibilityManifest !== undefined) {
      const expected = artifact.roundTwoEligibilityManifest;
      const [candidateManifest, ...evidenceRuns] = await Promise.all(
        [expected.candidateManifestPath, ...expected.evidencePaths].map(async (path) => JSON.parse(
          (await readFile(join(REPOSITORY_ROOT, path))).toString("utf8"),
        )),
      );
      // A completed run's evidence is two files, so they are read and hashed
      // here rather than taken on the strength of the names it recorded.
      const archives = result.runStatus === "completed"
        ? await readRoundTwoConfirmationArchives([
          result.confirmationEvidence?.runOneArchive,
          result.confirmationEvidence?.runTwoArchive,
        ])
        : null;
      problems.push(...roundTwoEligibilityManifestProblems(
        artifact,
        result,
        candidateManifest,
        evidenceRuns,
        archives,
      ));
      problems.push(...roundTwoConfirmationArchiveProblems(
        await readdir(join(REPOSITORY_ROOT, "benchmark-results")),
        artifact.path,
        result.runStatus,
      ));
    }

    let lateAdvances;
    let profileLateAdvances;
    if (artifact.serializedLateAdvanceCount !== undefined) {
      lateAdvances = collectLateAdvances(result);
      profileLateAdvances = collectProfileLateAdvances(result);
      const incompleteRecordIndex = lateAdvances.findIndex((record) => (
        !REQUIRED_FORENSIC_FIELDS.every((field) => Object.hasOwn(record, field))
      ));
      if (lateAdvances.length !== artifact.serializedLateAdvanceCount) {
        problems.push(
          `${artifact.name}: ${lateAdvances.length} serialized late advances, expected ` +
            `${artifact.serializedLateAdvanceCount}`,
        );
      }
      if (profileLateAdvances.length !== artifact.profileLateAdvanceCount) {
        problems.push(
          `${artifact.name}: ${profileLateAdvances.length} profile-level late advances, expected ` +
            `${artifact.profileLateAdvanceCount}`,
        );
      }
      if (incompleteRecordIndex !== -1) {
        problems.push(`${artifact.name}: late-advance record ${incompleteRecordIndex} is incomplete`);
      }
    }

    const details = [`file=${fileDigest}`];
    if (artifact.roundTwoEligibilityManifest !== undefined) {
      details.push(
        `status=${result.runStatus}`,
        `entries=${(result.entries ?? []).length}`,
        `reason=${result.reason ?? "none"}`,
        `confirmationDecoded=${result.confirmationPartition?.decodedTraceCount}/` +
          `${result.confirmationPartition?.traceCount}`,
        `candidateManifest=${result.candidateManifestDigest}`,
        `manifest=${result.digest?.value}`,
      );
    }
    if (artifact.roundTwoApprovedProfiles !== undefined) {
      details.push(
        `outcome=${result.outcome}`,
        `reason=${result.reason ?? "none"}`,
        `default=${result.selectedDefaultProfileId}`,
        `approved=${(result.approvedProfileIds ?? []).join("+")}`,
        `liveCorpus=${result.liveCorpus?.status}`,
        `eligibility=${result.eligibilityManifestDigest}`,
        `list=${result.digest?.value}`,
      );
    }
    if (artifact.roundTwoCandidateManifest !== undefined) {
      details.push(
        `candidates=${(result.candidateProfileIds ?? []).length}`,
        `reason=${result.notRunReason}`,
        `task26=${result.task26TerminalOutcome}/${result.task26EvidenceDigest}`,
        `manifest=${result.digest?.value}`,
      );
    }
    if (candidateArchive !== undefined) {
      details.push(
        `candidate=${candidateArchive.digest.value}`,
        `rows=${candidateArchive.candidateCount}`,
      );
    }
    if (evidenceDigest !== undefined) details.push(`evidence=${evidenceDigest}`);
    if (lateAdvances !== undefined) {
      details.push(
        `late=${lateAdvances.length} serialized/${profileLateAdvances.length} profile-level`,
      );
    }
    console.log(`${artifact.name}: ${details.join(" ")}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return false;
  }
  return true;
}

function sameList(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index]);
}

/**
 * Everything that must be true of one archived Task 13 repetition.
 *
 * The checks are independent and all of them run, so a wrong file reports every
 * way it is wrong at once instead of one failure per invocation. They are stated
 * against the frozen matrix rather than against the other file: two archives can
 * agree perfectly and still both be the wrong evidence.
 */
export function confirmationEvidenceProblems(result, label) {
  const problems = [];
  const report = (message) => problems.push(`${label}: ${message}`);
  if (!Array.isArray(result) || result.length !== 1) {
    report(
      `holds ${Array.isArray(result) ? result.length : "no"} benchmark results, and a ` +
        "confirmation repetition is exactly one complete unified run",
    );
    return problems;
  }
  const [run] = result;
  if (run?.name !== CONFIRMATION_EVIDENCE.name) {
    report(`is ${JSON.stringify(run?.name)}, not ${CONFIRMATION_EVIDENCE.name}`);
  }
  const gates = run?.gates;
  if (gates === null || typeof gates !== "object") {
    report("carries no gate report, so it cannot be a unified validation run");
    return problems;
  }
  if (gates.registryVersion !== CONFIRMATION_EVIDENCE.registryVersion) {
    report(
      `was measured against profile registry version ${gates.registryVersion}, not ` +
      `${CONFIRMATION_EVIDENCE.registryVersion}`,
    );
  }
  if (CONFIRMATION_EVIDENCE.policyVersion === null) {
    if (Object.hasOwn(gates, "policyVersion")) {
      report(
        `was measured under policy version ${JSON.stringify(gates.policyVersion)}, but the ` +
          "frozen Task 13 evidence is the unversioned round-one policy",
      );
    }
  } else if (gates.policyVersion !== CONFIRMATION_EVIDENCE.policyVersion) {
    report(
      `was measured under policy version ${JSON.stringify(gates.policyVersion)}, not ` +
        `${CONFIRMATION_EVIDENCE.policyVersion}`,
    );
  }
  if (gates.baselineProfileId !== CONFIRMATION_EVIDENCE.baselineProfileId) {
    report(`replayed baseline ${gates.baselineProfileId}, not ${CONFIRMATION_EVIDENCE.baselineProfileId}`);
  }
  if (!sameList(gates.candidateProfileIds, CONFIRMATION_EVIDENCE.candidateProfileIds)) {
    report(
      `replayed candidates ${JSON.stringify(gates.candidateProfileIds)}, not the four frozen ` +
        `${JSON.stringify(CONFIRMATION_EVIDENCE.candidateProfileIds)}`,
    );
  }
  const columnProfileIds = [
    CONFIRMATION_EVIDENCE.baselineProfileId,
    ...CONFIRMATION_EVIDENCE.candidateProfileIds,
  ];
  const measuredProfiles = Array.isArray(gates.profiles) ? gates.profiles : [];
  const measuredColumn = measuredProfiles.map((profile) => profile?.profileId);
  if (!sameList(measuredColumn, columnProfileIds)) {
    report(
      `measured profile columns ${JSON.stringify(measuredColumn)}, not ` +
        `${JSON.stringify(columnProfileIds)}`,
    );
  }
  for (const [index, profileId] of columnProfileIds.entries()) {
    const thresholds = CONFIRMATION_EVIDENCE.profiles[profileId];
    const measured = measuredProfiles[index];
    if (measured?.profileId !== profileId) continue;
    const differing = Object.keys(thresholds)
      .filter((key) => measured.profile?.[key] !== thresholds[key]);
    if (differing.length > 0) {
      report(
        `measured ${profileId} at ${JSON.stringify(measured.profile ?? null)}, not the frozen ` +
          `${JSON.stringify(thresholds)} (${differing.join(", ")})`,
      );
    }
  }
  problems.push(...gateDefinitionProblems(gates, label));
  problems.push(...decisionEvidenceProblems(gates, columnProfileIds, label));
  problems.push(...domainSummaryProblems(run, columnProfileIds, label));
  if (gates.evidenceComplete !== true) {
    report(
      "did not measure the complete frozen matrix, so it can reject a candidate but never clear " +
        `one: ${(gates.incompleteEvidenceReasons ?? []).join(" ") || "no reason recorded"}`,
    );
  } else if (!Array.isArray(gates.incompleteEvidenceReasons) ||
      gates.incompleteEvidenceReasons.length > 0) {
    // The two are one statement in the report that writes them, so a file that
    // calls itself complete while still listing what it missed is contradicting
    // itself, and neither half of it can be relied on.
    report(
      "calls itself complete evidence while still reporting " +
        `${JSON.stringify(gates.incompleteEvidenceReasons ?? null)} as incomplete`,
    );
  }
  const domains = Array.isArray(gates.domains) ? gates.domains : [];
  const measuredDomains = domains.map((domain) => domain?.domain);
  const expectedDomains = CONFIRMATION_EVIDENCE.domains.map(({ domain }) => domain);
  if (!sameList(measuredDomains, expectedDomains)) {
    report(`measured domains ${JSON.stringify(measuredDomains)}, not ${JSON.stringify(expectedDomains)}`);
  }
  for (const expected of CONFIRMATION_EVIDENCE.domains) {
    const domain = domains.find((entry) => entry?.domain === expected.domain);
    if (!domain || domain.present !== true) {
      report(`did not measure the ${expected.domain} domain`);
      continue;
    }
    const where = `${expected.domain} domain`;
    if (domain.manifestVersion !== CONFIRMATION_EVIDENCE.manifestVersion ||
        domain.manifestHash !== CONFIRMATION_EVIDENCE.manifestHash ||
        domain.manifestCorpusHash !== CONFIRMATION_EVIDENCE.manifestCorpusHash) {
      report(
        `${where} names manifest ${domain.manifestVersion}/${domain.manifestHash}/` +
          `${domain.manifestCorpusHash}, not ${CONFIRMATION_EVIDENCE.manifestVersion}/` +
          `${CONFIRMATION_EVIDENCE.manifestHash}/${CONFIRMATION_EVIDENCE.manifestCorpusHash}`,
      );
    }
    if (!sameList([...(domain.rendererKeys ?? [])].sort(), [...CONFIRMATION_EVIDENCE.rendererKeys].sort())) {
      report(
        `${where} covered renderers ${JSON.stringify(domain.rendererKeys)}, not ` +
          `${JSON.stringify(CONFIRMATION_EVIDENCE.rendererKeys)}`,
      );
    }
    if (domain.capturedTraceCount !== expected.capturedTraceCount) {
      report(
        `${where} captured ${domain.capturedTraceCount} traces, not the frozen ` +
          `${expected.capturedTraceCount}`,
      );
    }
    // Against the domain's own count, not the frozen one: that comparison is
    // made above, and restating it here would report one narrowing twice.
    const traceIdentities = domain.traceIdentities ?? [];
    if (traceIdentities.length !== domain.capturedTraceCount) {
      report(
        `${where} carries ${traceIdentities.length} trace identities for ` +
          `${domain.capturedTraceCount} captured traces`,
      );
    }
    if (!sameList(domain.partitions, expected.partitions)) {
      report(
        `${where} spans partitions ${JSON.stringify(domain.partitions)}, not the frozen ` +
          `${JSON.stringify(expected.partitions)}`,
      );
    }
    if ((domain.evidenceRole ?? null) !== expected.evidenceRole) {
      report(
        `${where} claims evidence role ${JSON.stringify(domain.evidenceRole ?? null)}, not ` +
          `${JSON.stringify(expected.evidenceRole)}`,
      );
    }
    // Renderer and partition are checked against the frozen values rather than
    // against the trace's own claim about itself, which would be circular: a row
    // and its identity can agree perfectly on a renderer that does not exist.
    const foreign = traceIdentities.find((identity) => (
      !CONFIRMATION_EVIDENCE.rendererKeys.includes(identity?.rendererKey) ||
      !expected.partitions.includes(identity?.partition)
    ));
    if (foreign !== undefined) {
      report(
        `${where} captured ${JSON.stringify(foreign.traceId)} under renderer ` +
          `${JSON.stringify(foreign.rendererKey)} and partition ` +
          `${JSON.stringify(foreign.partition)}, which the frozen matrix does not contain`,
      );
    }
    const misnamed = traceIdentities.find((identity) => !expected.suites.some((suite) => (
      String(identity?.traceId).startsWith(`${suite}/${identity?.rendererKey}/`)
    )));
    if (misnamed !== undefined) {
      report(
        `${where} captured ${JSON.stringify(misnamed.traceId)} under renderer ` +
          `${JSON.stringify(misnamed.rendererKey)}, which is not a ` +
          `${expected.suites.join(", ")} trace of that renderer`,
      );
    }
    // Required to be present, never compared between processes: an archive that
    // recorded no raw identity at all cannot show that its columns replayed one
    // waveform, and a placeholder that repeats across two runs would read as a
    // diagnostic that agreed.
    const undiagnosed = traceIdentities.find((identity) => (
      !DIGEST_PATTERN.test(String(identity?.processLocalPcmHash)) ||
      !DIGEST_PATTERN.test(String(identity?.processLocalTraceHash))
    ));
    if (undiagnosed !== undefined) {
      report(
        `${where} captured ${JSON.stringify(undiagnosed.traceId)} with process-local PCM hash ` +
          `${printable(undiagnosed.processLocalPcmHash)} and trace hash ` +
          `${printable(undiagnosed.processLocalTraceHash)}, which are not both recorded ` +
          `diagnostics`,
      );
    }
    if (domain.traceReuseVerified !== true) report(`${where} did not verify trace reuse`);
    if (domain.baselineParityVerified !== true) report(`${where} did not verify baseline parity`);
    problems.push(...outcomeIdentityProblems(domain, expected, columnProfileIds, label));
  }
  return problems;
}

/**
 * The eighteen frozen gates, as the archived report must define them.
 *
 * The gate list is the standard both repetitions were judged against, so it is
 * part of the evidence rather than context around it: a report that dropped a
 * gate would show every candidate clearing every gate it still had.
 */
function gateDefinitionProblems(gates, label) {
  const measured = Array.isArray(gates.gates) ? gates.gates : [];
  const definitions = CONFIRMATION_EVIDENCE.gates;
  if (!sameList(measured.map((gate) => gate?.code), definitions.map(({ code }) => code))) {
    return [
      `${label}: defines gates ${JSON.stringify(measured.map((gate) => gate?.code))}, not the ` +
        `${definitions.length} frozen ${JSON.stringify(definitions.map(({ code }) => code))}`,
    ];
  }
  const problems = [];
  for (const [index, definition] of definitions.entries()) {
    // `partitions` is the coverage a complete run reads for this gate, checked
    // against each candidate's outcome below; the definition list does not
    // carry it, and requiring it here would reject every real archive.
    const differing = Object.keys(definition)
      .filter((key) => key !== "partitions" && measured[index][key] !== definition[key]);
    if (differing.length > 0) {
      problems.push(
        `${label}: gate ${definition.code} defines ${differing.join(", ")} as ` +
          `${differing.map((key) => JSON.stringify(measured[index][key])).join(", ")}, not ` +
          `${differing.map((key) => JSON.stringify(definition[key])).join(", ")}`,
      );
    }
  }
  return problems;
}

/** The four per-role failure counters a candidate report sums for itself. */
export const ROLE_FAILURE_COUNTERS = [
  ["replayIntegrityFailureCount", "replay-integrity"],
  ["safetyFailureCount", "safety"],
  ["releaseFailureCount", "release"],
  ["discoveryConsistencyFailureCount", "discovery-consistency"],
];

/**
 * The rows each gate is allowed to have read.
 *
 * Task 12 states the scoping rule the report has to obey: safety gates read
 * every partition, release gates read only held-back `confirmation` rows, and
 * the sequence and discovery-side dynamics gates are labeled
 * `discovery-consistency` so no discovery number can be quoted as
 * generalization. A gate outcome that claims otherwise is describing a different
 * standard than the one this task froze, and the partitions it names are what a
 * report quotes when it says which evidence a verdict rests on.
 */
export const GATE_SCOPE_BY_ROLE = {
  "replay-integrity": ["confirmation", "discovery", "regression-only"],
  safety: ["confirmation", "discovery", "regression-only"],
  release: ["confirmation"],
  "discovery-consistency": ["discovery"],
};

export const GATE_SCOPE_BY_DOMAIN = {
  isolated: ["confirmation"],
  sequence: ["discovery", "regression-only"],
  dynamics: ["confirmation", "discovery", "regression-only"],
  regression: ["regression-only"],
  "cross-domain": ["confirmation", "discovery", "regression-only"],
};

/** A measured gate value: `number | string | boolean | null`, and nothing else. */
function isGateValue(value) {
  return value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean";
}

/** The evidence role a set of partitions carries, as the report computes it. */
export function partitionEvidenceRole(partitions) {
  if (partitions.length === 0 || partitions.includes("regression-only")) return null;
  const distinct = [...new Set(partitions)];
  if (distinct.length === 1) return distinct[0] === "discovery" ? "discovery" : "confirmation";
  return "mixed";
}

/** Which rows each gate read, and the evidence role that makes. */
function gateScopeProblems(outcomes, where, evidenceComplete) {
  const problems = [];
  for (const [index, gate] of outcomes.entries()) {
    const partitions = Array.isArray(gate.partitions) ? gate.partitions : null;
    if (partitions === null) {
      problems.push(`${where} gate ${gate.code} does not say which rows it read`);
      continue;
    }
    if (gate.applied !== (partitions.length > 0)) {
      problems.push(gate.applied
        ? `${where} gate ${gate.code} was applied to no rows`
        : `${where} gate ${gate.code} was not applied, yet names ${JSON.stringify(partitions)} rows`);
      continue;
    }
    const allowed = (GATE_SCOPE_BY_ROLE[gate.role] ?? [])
      .filter((partition) => (GATE_SCOPE_BY_DOMAIN[gate.domain] ?? []).includes(partition));
    const foreign = partitions.filter((partition) => !allowed.includes(partition));
    if (foreign.length > 0) {
      problems.push(
        `${where} gate ${gate.code} read ${JSON.stringify(foreign)} rows, which a ` +
          `${gate.role} gate on the ${gate.domain} domain may not read`,
      );
      continue;
    }
    // Coverage is pinned, not merely bounded. A complete matrix reads exactly
    // these rows for this gate, so a report that gated safety on the
    // confirmation rows alone is refused rather than read as a subset.
    const required = CONFIRMATION_EVIDENCE.gates[index].partitions;
    if (evidenceComplete && !sameList(partitions, required)) {
      problems.push(
        `${where} gate ${gate.code} read ${JSON.stringify(partitions)} rows, and a complete ` +
          `matrix reads ${JSON.stringify(required)}`,
      );
      continue;
    }
    const evidenceRole = partitionEvidenceRole(partitions);
    if ((gate.evidenceRole ?? null) !== evidenceRole) {
      problems.push(
        `${where} gate ${gate.code} labels ${JSON.stringify(partitions)} rows ` +
          `${JSON.stringify(gate.evidenceRole ?? null)}, not ${JSON.stringify(evidenceRole)}`,
      );
    }
  }
  return problems;
}

/**
 * Each recorded failure, which is the identity of what went wrong.
 *
 * A failure with nothing in it satisfies a count and says nothing: the report's
 * whole purpose is that a rejected candidate names the rows, the baseline and
 * candidate values, and the reason. An empty record would compare equal between
 * two runs while describing nothing either of them measured.
 */
function gateFailureProblems(outcomes, where) {
  const problems = [];
  for (const gate of outcomes) {
    for (const [index, failure] of gate.failures.entries()) {
      const at = `${where} gate ${gate.code} failure ${index}`;
      if (failure === null || typeof failure !== "object") {
        problems.push(`${at} records nothing`);
        continue;
      }
      if (failure.code !== gate.code) {
        problems.push(`${at} is filed under ${JSON.stringify(failure.code)}`);
      }
      if (!Array.isArray(failure.domainIds) || failure.domainIds.length === 0 ||
          failure.domainIds.some((id) => typeof id !== "string" || id.trim().length === 0)) {
        problems.push(`${at} names no renderer, speed, instrument, layer, family, or trace`);
      }
      for (const key of ["baselineValue", "candidateValue"]) {
        if (!Object.hasOwn(failure, key)) {
          problems.push(`${at} records no ${key}`);
        } else if (!isGateValue(failure[key])) {
          // The report's own type admits only a scalar or null here, and a
          // structure in its place is a value nothing could have measured.
          problems.push(`${at} records ${key} ${JSON.stringify(failure[key])}, not a gate value`);
        }
      }
      if (typeof failure.explanation !== "string" || failure.explanation.trim().length === 0) {
        problems.push(`${at} explains nothing`);
      }
    }
  }
  return problems;
}

/**
 * The decision the archived run reached, which is the evidence Task 13 quotes.
 *
 * Identity metadata says the right matrix was measured; it does not say what the
 * measurement decided. A file truncated to its identities would still compare
 * equal to another truncated the same way, and the comparison would then be
 * silent about exactly the gate outcomes, failure identities, eligibility set,
 * and recommendation the release decision rests on. Each candidate's verdict is
 * therefore required and checked for internal consistency, so a report cannot
 * name an eligibility its own gate outcomes contradict.
 */
function decisionEvidenceProblems(gates, columnProfileIds, label) {
  const problems = [];
  const candidateProfileIds = columnProfileIds.slice(1);
  // The frozen confirmation declares no waiver: a waiver is a decision taken
  // after seeing a measured loss, which by definition cannot precede the run.
  if (!Array.isArray(gates.reviewedLayerLosses) || gates.reviewedLayerLosses.length > 0) {
    problems.push(
      `${label}: declares ${JSON.stringify(gates.reviewedLayerLosses ?? null)} as reviewed layer ` +
        "loss waivers, and the frozen confirmation declares none",
    );
  }
  const candidates = Array.isArray(gates.candidates) ? gates.candidates : [];
  if (!sameList(candidates.map((candidate) => candidate?.profileId), candidateProfileIds)) {
    return [
      ...problems,
      `${label}: reports verdicts for ${JSON.stringify(candidates.map((c) => c?.profileId))}, ` +
        `not for the four frozen candidates ${JSON.stringify(candidateProfileIds)}`,
    ];
  }
  const definitions = CONFIRMATION_EVIDENCE.gates;
  for (const candidate of candidates) {
    const where = `${label}: ${candidate.profileId}`;
    const thresholds = CONFIRMATION_EVIDENCE.profiles[candidate.profileId];
    if (Object.keys(thresholds).some((key) => candidate.profile?.[key] !== thresholds[key])) {
      problems.push(`${where} was judged at ${JSON.stringify(candidate.profile ?? null)}, not ` +
        `the frozen ${JSON.stringify(thresholds)}`);
    }
    const outcomes = Array.isArray(candidate.gates) ? candidate.gates : [];
    if (!sameList(outcomes.map((gate) => gate?.code), definitions.map(({ code }) => code))) {
      problems.push(
        `${where} reports ${outcomes.length} gate outcomes, not all ${definitions.length} frozen ` +
          "gates; a narrowed report cannot show which gates were never applied",
      );
      continue;
    }
    const malformed = outcomes.find((gate) => (
      typeof gate.applied !== "boolean" ||
      typeof gate.passed !== "boolean" ||
      !Array.isArray(gate.failures)
    ));
    if (malformed !== undefined) {
      problems.push(`${where} gate ${malformed.code} records no applied/passed verdict`);
      continue;
    }
    const mismatched = definitions.find(({ role, domain }, index) => (
      outcomes[index].role !== role || outcomes[index].domain !== domain
    ));
    if (mismatched !== undefined) {
      problems.push(`${where} judged gate ${mismatched.code} under another role or domain`);
    }
    // A complete matrix applies every gate: an unapplied gate contributes no
    // pass, so a report that applied none of them would clear a candidate
    // without ever having judged it.
    const unapplied = outcomes.filter((gate) => !gate.applied).map(({ code }) => code);
    if (unapplied.length > 0 && gates.evidenceComplete === true) {
      problems.push(
        `${where} never applied ${unapplied.length} of ${definitions.length} gates ` +
          `(${unapplied.join(", ")}), and a complete matrix applies all of them`,
      );
    }
    // `passed` is `applied && no failures` in the report that writes it, so a
    // gate that passed while recording failures, or passed without being
    // applied, is not a verdict this comparison can carry.
    const inconsistent = outcomes.find((gate) => (
      gate.passed !== (gate.applied && gate.failures.length === 0)
    ));
    if (inconsistent !== undefined) {
      problems.push(
        `${where} records gate ${inconsistent.code} as applied=${inconsistent.applied} ` +
          `passed=${inconsistent.passed} with ${inconsistent.failures.length} failure(s)`,
      );
    }
    problems.push(...gateScopeProblems(outcomes, where, gates.evidenceComplete === true));
    problems.push(...gateFailureProblems(outcomes, where));
    const failed = outcomes.filter((gate) => gate.applied && !gate.passed).map(({ code }) => code);
    if (!sameList(candidate.failedGateCodes, failed)) {
      problems.push(
        `${where} lists failed gates ${JSON.stringify(candidate.failedGateCodes)}, but its gate ` +
          `outcomes failed ${JSON.stringify(failed)}`,
      );
    }
    // The four role counters are sums over the failed outcomes, so they are
    // recomputed rather than believed: a stale counter is a changed claim about
    // how a candidate failed.
    for (const [key, role] of ROLE_FAILURE_COUNTERS) {
      const counted = outcomes
        .filter((gate) => gate.applied && !gate.passed && gate.role === role)
        .reduce((total, gate) => total + gate.failures.length, 0);
      if (candidate[key] !== counted) {
        problems.push(`${where} reports ${key} ${JSON.stringify(candidate[key])}, not ${counted}`);
      }
    }
    // Eligibility is `rejected` when any applied gate failed and `eligible`
    // otherwise, because a complete matrix is required above; a verdict that
    // does not follow from the outcomes beside it is not evidence of anything.
    const eligibility = failed.length > 0 ? "rejected" : "eligible";
    if (candidate.eligibility !== eligibility || candidate.eligible !== (eligibility === "eligible")) {
      problems.push(
        `${where} is recorded ${JSON.stringify(candidate.eligibility)}/${candidate.eligible} ` +
          `while failing ${failed.length} applied gate(s)`,
      );
    }
    for (const key of ["safety", "lateAdvance", "layerLosses", "regressedSequenceTraceIds"]) {
      if (candidate[key] === undefined) problems.push(`${where} reports no ${key}`);
    }
  }
  const eligible = candidates
    .filter((candidate) => candidate.eligible === true)
    .map(({ profileId }) => profileId);
  if (!sameList(gates.eligibleProfileIds, eligible)) {
    problems.push(
      `${label}: names ${JSON.stringify(gates.eligibleProfileIds)} eligible, but its candidate ` +
        `verdicts make ${JSON.stringify(eligible)} eligible`,
    );
  }
  const recommendation = gates.recommendation;
  const code = eligible.length > 0 ? "eligible-candidates" : "no-safe-candidate";
  if (recommendation?.code !== code) {
    problems.push(
      `${label}: recommends ${JSON.stringify(recommendation?.code)} with ${eligible.length} ` +
        `eligible candidate(s), where a complete matrix recommends ${code}`,
    );
  }
  if (!sameList(recommendation?.eligibleProfileIds, eligible)) {
    problems.push(
      `${label}: recommendation names ${JSON.stringify(recommendation?.eligibleProfileIds)}, not ` +
        `the eligible ${JSON.stringify(eligible)}`,
    );
  }
  if (typeof recommendation?.explanation !== "string" || recommendation.explanation.length === 0) {
    problems.push(`${label}: recommends a verdict without stating why`);
  }
  return problems;
}

/**
 * The three measured matrices themselves, beside the decision drawn from them.
 *
 * Without these an export could be identity metadata and a verdict, with none of
 * the per-renderer, per-profile scores the report has to quote and the decision
 * has to be checkable against.
 */
function domainSummaryProblems(run, columnProfileIds, label) {
  const problems = [];
  for (const { domain } of CONFIRMATION_EVIDENCE.domains) {
    const summary = run[domain];
    if (summary === null || typeof summary !== "object") {
      problems.push(`${label}: exports no ${domain} matrix, only its identity`);
      continue;
    }
    const renderers = Array.isArray(summary.renderers) ? summary.renderers : [];
    if (!sameList(renderers.map((renderer) => renderer?.rendererKey), CONFIRMATION_EVIDENCE.rendererKeys)) {
      problems.push(
        `${label}: the ${domain} matrix reports renderers ` +
          `${JSON.stringify(renderers.map((renderer) => renderer?.rendererKey))}, not ` +
          `${JSON.stringify(CONFIRMATION_EVIDENCE.rendererKeys)}`,
      );
      continue;
    }
    for (const renderer of renderers) {
      const profileIds = (renderer.profiles ?? []).map((profile) => profile?.profileId);
      if (!sameList(profileIds, columnProfileIds)) {
        problems.push(
          `${label}: the ${domain} ${renderer.rendererKey} matrix scores ` +
            `${JSON.stringify(profileIds)}, not the frozen column ` +
            `${JSON.stringify(columnProfileIds)}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The per-trace, per-profile outcome rows this comparison is stated over.
 *
 * A count alone accepts fabricated coverage: five rows naming any five profiles
 * on any trace satisfy it. The rows are therefore read against the domain's own
 * captured traces, block by block — each captured trace, in the order it was
 * captured, followed by exactly the frozen profile column in its frozen order,
 * with the renderer and partition the trace was captured under. The aggregate
 * digest is then recomputed from the rows, so it describes this evidence rather
 * than travelling beside it.
 */
function outcomeIdentityProblems(domain, expected, columnProfileIds, label) {
  const problems = [];
  const where = `${label}: ${expected.domain} domain`;
  const rows = domain.outcomeIdentities;
  if (!Array.isArray(rows)) {
    return [`${where} carries no per-trace outcome identities, so its discrete outcomes cannot be compared`];
  }
  const traceIdentities = Array.isArray(domain.traceIdentities) ? domain.traceIdentities : [];
  const expectedRowCount = domain.capturedTraceCount * columnProfileIds.length;
  if (rows.length !== expectedRowCount) {
    problems.push(
      `${where} carries ${rows.length} outcome identities, not the ${expectedRowCount} its ` +
        `${domain.capturedTraceCount} traces and ${columnProfileIds.length} profile columns require`,
    );
  }
  if (new Set(traceIdentities.map((identity) => identity?.traceId)).size !== traceIdentities.length) {
    problems.push(`${where} lists the same captured trace more than once`);
  }
  // Only the first offending trace is reported: one fabricated archive would
  // otherwise print the same complaint 268 times.
  for (const [traceIndex, identity] of traceIdentities.entries()) {
    const block = rows.slice(
      traceIndex * columnProfileIds.length,
      (traceIndex + 1) * columnProfileIds.length,
    );
    const traceProblems = [];
    if (block.length !== columnProfileIds.length) {
      traceProblems.push(`${where} has no outcome rows for ${identity.traceId}`);
    } else {
      if (!sameList(block.map((row) => row?.traceId), block.map(() => identity.traceId))) {
        traceProblems.push(
          `${where} reports ${JSON.stringify(block.map((row) => row?.traceId))} where its ` +
            `${traceIndex + 1}th captured trace is ${identity.traceId}`,
        );
      }
      if (!sameList(block.map((row) => row?.profileId), columnProfileIds)) {
        traceProblems.push(
          `${where} measured ${identity.traceId} under ` +
            `${JSON.stringify(block.map((row) => row?.profileId))}, not the frozen column ` +
            `${JSON.stringify(columnProfileIds)}`,
        );
      }
      for (const key of ["rendererKey", "partition"]) {
        if (block.some((row) => row?.[key] !== identity[key])) {
          traceProblems.push(
            `${where} files ${identity.traceId} outcomes under ${key} ` +
              `${JSON.stringify(block.find((row) => row?.[key] !== identity[key])?.[key])}, but ` +
              `the trace was captured under ${JSON.stringify(identity[key])}`,
          );
        }
      }
      const malformed = block.find((row) => !DIGEST_PATTERN.test(String(row?.outcomeDigest)));
      if (malformed !== undefined) {
        traceProblems.push(
          `${where} row ${identity.traceId}/${malformed.profileId} has no outcome digest`,
        );
      }
    }
    if (traceProblems.length > 0) {
      problems.push(...traceProblems);
      break;
    }
  }
  const measuredIdentityDigest = fnv1a32(traceIdentities.map((identity) => (
    `${identity.traceId}:${identity.recognitionStructureHash}:${identity.frameCount}`
  )));
  if (measuredIdentityDigest !== domain.identityDigest) {
    problems.push(
      `${where} reports corpus identity ${domain.identityDigest}, but its trace identities ` +
        `digest to ${measuredIdentityDigest}`,
    );
  }
  const measuredOutcomeDigest = fnv1a32(rows.map((row) => (
    `${row?.traceId}:${row?.profileId}:${row?.outcomeDigest}`
  )));
  if (measuredOutcomeDigest !== domain.outcomeDigest) {
    problems.push(
      `${where} reports outcome digest ${domain.outcomeDigest}, but its outcome rows digest to ` +
        `${measuredOutcomeDigest}`,
    );
  }
  return problems;
}

function printable(value) {
  if (value === undefined) return "<missing>";
  const serialized = JSON.stringify(value);
  return serialized.length <= 240 ? serialized : `${serialized.slice(0, 237)}...`;
}

/** CLI implementation kept exportable so its refusal paths can be tested. */
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0) {
    if (!await verifyFrozenEvidence()) process.exitCode = 1;
    return;
  }
  if (args[0] !== "--compare" || args.length !== 3) {
    throw new Error(
      "Usage: verify_listen_benchmark_evidence.mjs [--compare <first-run.json> <second-run.json>]",
    );
  }
  const [leftPath, rightPath] = args.slice(1).map((path) => resolve(process.cwd(), path));
  const [leftBytes, rightBytes] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  const left = JSON.parse(leftBytes.toString("utf8"));
  const right = JSON.parse(rightBytes.toString("utf8"));
  // Both files are held to the frozen matrix before they are held to each other:
  // agreement between two runs of the wrong matrix is not confirmation evidence.
  const evidenceProblems = [
    ...confirmationEvidenceProblems(left, "first run"),
    ...confirmationEvidenceProblems(right, "second run"),
  ];
  if (evidenceProblems.length > 0) {
    throw new Error(
      `Not a complete frozen confirmation repetition:\n  ${evidenceProblems.join("\n  ")}`,
    );
  }
  const result = compareEvidenceRuns(left, right);
  if (!result.equal) {
    const difference = result.difference;
    throw new Error(
      `Benchmark repetitions differ at ${difference?.path ?? "an unknown path"}: ` +
        `first=${printable(difference?.left)} second=${printable(difference?.right)} ` +
        `(sha256 ${result.leftSha256} != ${result.rightSha256})`,
    );
  }
  const domainDigests = left[0].gates.domains
    .map((domain) => `${domain.domain}=${domain.identityDigest}/${domain.outcomeDigest}`)
    .join(" ");
  console.log(
    `Benchmark repetitions match: evidence=${result.leftSha256} ` +
      `omitted=${[...CROSS_RUN_OMITTED_FIELDS].join(",")}`,
  );
  console.log(
    `Both runs are the complete frozen matrix: manifest=${CONFIRMATION_EVIDENCE.manifestVersion}/` +
      `${CONFIRMATION_EVIDENCE.manifestHash}/${CONFIRMATION_EVIDENCE.manifestCorpusHash} ` +
      `registry=${CONFIRMATION_EVIDENCE.registryVersion} ` +
      `candidates=${CONFIRMATION_EVIDENCE.candidateProfileIds.join(",")} ` +
      `identity/outcome ${domainDigests}`,
  );
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
