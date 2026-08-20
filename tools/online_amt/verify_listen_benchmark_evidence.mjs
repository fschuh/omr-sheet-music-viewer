import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable compact JSON with recursively sorted keys and selected fields omitted. */
function canonicalJson(value, omittedFields) {
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
  process.exitCode = 1;
}
