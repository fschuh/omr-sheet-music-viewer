/**
 * Emits the frozen Task 27 candidate manifest from the archived Task 26
 * repetitions.
 *
 * This is a Node entry point, not application code: it is bundled and run by
 * `npm --prefix webapp run emit:round-two-candidate-manifest` and imports the
 * same frozen policy the search itself ran under, so the manifest is derived by
 * the code that made the decision rather than by a second implementation of it.
 *
 * The round took the zero branch, so there is no search to run and no result
 * archive to write. Re-running this command must reproduce the committed
 * manifest byte for byte; it refuses to revise one that already exists.
 */

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE,
  assertListenRoundTwoCandidateManifestUnchanged,
  listenRoundTwoCandidateManifestFromRepetitions,
} from "./listenRoundTwoCandidateManifest";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LISTEN_ROUND_TWO_EVIDENCE_PATHS = LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS;

export const LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH = LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(REPOSITORY_ROOT, path), "utf8"));
}

async function main(): Promise<number> {
  const evidenceRepetitions = await Promise.all(
    LISTEN_ROUND_TWO_EVIDENCE_PATHS.map((path) => readJson(path)),
  );
  const { manifest, reproductions } = listenRoundTwoCandidateManifestFromRepetitions({
    evidenceRepetitions,
  });
  for (const [index, reproduction] of reproductions.entries()) {
    console.log(
      `${LISTEN_ROUND_TWO_EVIDENCE_PATHS[index]}: recomputed ${reproduction.terminalOutcome} ` +
        `(${reproduction.ablations
          .map(({ ablation, stop }) => `${ablation}=${stop.satisfied ? "accepted" : "rejected"}`)
          .join(", ")}), evidence digest ${reproduction.digest}`,
    );
  }
  const target = join(REPOSITORY_ROOT, LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing !== null) {
    assertListenRoundTwoCandidateManifestUnchanged(JSON.parse(existing), manifest);
    if (existing !== serialized) {
      throw new Error(
        `${LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH} holds the same manifest in different bytes.`,
      );
    }
    console.log(
      `${LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH}: reproduced unchanged, digest ` +
        `${manifest.digest.value}`,
    );
    return 0;
  }
  await writeFile(target, serialized);
  console.log(
    `${LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH}: wrote ${manifest.candidateProfileIds.length} ` +
      `candidates, reason ${manifest.notRunReason}, digest ${manifest.digest.value}`,
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
const COMMAND_ENTRY_POINT = "listenRoundTwoCandidateManifestCli";

if (basename(process.argv[1] ?? "").replace(/\.[^.]*$/, "") === COMMAND_ENTRY_POINT) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
