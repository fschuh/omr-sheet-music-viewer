import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
function fnv1a32(parts) {
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

/** Verifies the committed Task 08, 10, 11, and 22 evidence against their frozen pins. */
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
const ROLE_FAILURE_COUNTERS = [
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
function partitionEvidenceRole(partitions) {
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
