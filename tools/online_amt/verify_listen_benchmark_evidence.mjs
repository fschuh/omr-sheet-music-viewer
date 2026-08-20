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
];

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

/** Fields that are diagnostic rather than cross-process confirmation evidence. */
const CROSS_RUN_OMITTED_FIELDS = new Set(["maximumInferenceMs", "peak", "rms"]);

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

/** Verifies the committed Task 08, 10, and 11 evidence against their frozen pins. */
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
  const result = compareEvidenceRuns(
    JSON.parse(leftBytes.toString("utf8")),
    JSON.parse(rightBytes.toString("utf8")),
  );
  if (!result.equal) {
    const difference = result.difference;
    throw new Error(
      `Benchmark repetitions differ at ${difference?.path ?? "an unknown path"}: ` +
        `first=${printable(difference?.left)} second=${printable(difference?.right)} ` +
        `(sha256 ${result.leftSha256} != ${result.rightSha256})`,
    );
  }
  console.log(
    `Benchmark repetitions match: evidence=${result.leftSha256} ` +
      `omitted=${[...CROSS_RUN_OMITTED_FIELDS].join(",")}`,
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
