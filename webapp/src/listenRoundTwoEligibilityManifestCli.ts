/**
 * Emits the frozen Task 28 eligibility manifest from the committed artifact
 * chain.
 *
 * This is a Node entry point, not application code: it is bundled and run by
 * `npm --prefix webapp run emit:round-two-eligibility-manifest`. It needs no
 * browser and no dev server, because the round took the not-run branch — the
 * confirmation matrix did not run, the version-2 confirmation fixtures were not
 * decoded, and no result archive exists to read.
 *
 * The chain is resolved by rerunning it rather than by reading it: the two
 * archived Task 26 repetitions are recomputed under the frozen stop rule, the
 * committed Task 27 manifest must be the record that rerun produces, and the
 * confirmation partition is re-measured from the trace manifest to prove nothing
 * was decoded. Re-running this command reproduces the committed manifest byte for
 * byte; it refuses to revise one that already exists.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE,
} from "./listenRoundTwoCandidateManifest";
import {
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE,
  assertListenRoundTwoEligibilityManifestUnchanged,
  listenRoundTwoEligibilityManifest,
} from "./listenRoundTwoEligibilityManifest";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_PATH =
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(REPOSITORY_ROOT, path), "utf8"));
}

async function main(): Promise<number> {
  const [candidateManifest, ...evidenceRepetitions] = await Promise.all([
    readJson(LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE),
    ...LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.map((path) => readJson(path)),
  ]);
  const emission = listenRoundTwoEligibilityManifest({ candidateManifest, evidenceRepetitions });
  const { manifest, reproducedEvidence, confirmationPartition } = emission;
  console.log(
    `${LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE}: re-derived from ` +
      `${LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.length} Task 26 repetitions, recomputed ` +
      `${reproducedEvidence.terminalOutcome} at evidence digest ${reproducedEvidence.digest}, ` +
      `reason ${reproducedEvidence.notRunReason}, manifest digest ` +
      `${manifest.candidateManifestDigest}`,
  );
  console.log(
    `confirmation partition: ${confirmationPartition.traceCount} traces, ` +
      `${confirmationPartition.decodedTraceCount} decoded, fixtures ` +
      `${confirmationPartition.traceIdentityHash}, generation ` +
      `${confirmationPartition.traceGenerationHash}, prior ledger ` +
      `${confirmationPartition.priorLedgerHash}`,
  );
  const target = join(REPOSITORY_ROOT, LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_PATH);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing !== null) {
    assertListenRoundTwoEligibilityManifestUnchanged(JSON.parse(existing), manifest);
    if (existing !== serialized) {
      throw new Error(
        `${LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_PATH} holds the same manifest in different bytes.`,
      );
    }
    console.log(
      `${LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_PATH}: reproduced unchanged, digest ` +
        `${manifest.digest.value}`,
    );
    return 0;
  }
  await writeFile(target, serialized);
  console.log(
    `${LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_PATH}: wrote runStatus ${manifest.runStatus}, ` +
      `reason ${manifest.reason}, ${manifest.entries.length} entries, digest ` +
      `${manifest.digest.value}`,
  );
  return 0;
}

/**
 * Runs only when this command is itself the process entry point.
 *
 * `import.meta.url` is the bundle's own path once esbuild has inlined this
 * module, so comparing it to `process.argv[1]` is true for *any* bundle that
 * happens to contain this file — importing one command from another, or from a
 * test, would silently run its `main` as a side effect. Matching the entry
 * point's basename instead keeps each command bound to the bundle built for it.
 */
const COMMAND_ENTRY_POINT = "listenRoundTwoEligibilityManifestCli";

if (basename(process.argv[1] ?? "").replace(/\.[^.]*$/, "") === COMMAND_ENTRY_POINT) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
