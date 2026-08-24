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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertListenRoundTwoCandidateManifestUnchanged,
  listenRoundTwoCandidateManifestFromRepetitions,
} from "./listenRoundTwoCandidateManifest";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LISTEN_ROUND_TWO_EVIDENCE_PATHS: readonly string[] = Object.freeze([
  "benchmark-results/listen-round-two-ablation-task26-run1.json",
  "benchmark-results/listen-round-two-ablation-task26-run2.json",
]);

export const LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_PATH =
  "benchmark-results/listen-round-two-candidate-manifest-task27.json";

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

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
