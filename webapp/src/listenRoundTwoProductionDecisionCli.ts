/**
 * Emits the frozen Task 29 approved-profile list from the committed artifact
 * chain.
 *
 * This is a Node entry point, not application code: it is bundled and run by
 * `npm --prefix webapp run emit:round-two-approved-profiles`. It needs no browser
 * and no dev server, because the round took the not-run branch — no confirmation
 * matrix ran, no live corpus was collected, and there is nothing to decode.
 *
 * The chain is resolved by rerunning it rather than by reading it: both archived
 * Task 26 repetitions are recomputed under Task 24's frozen stop rule, the
 * committed Task 27 record must be what that rerun re-derives, the committed
 * Task 28 record must be what Task 28's own emitter reproduces from it, and the
 * decoder/model-evidence requirement is referenced by the digest of its actual
 * bytes. Re-running this command reproduces the committed list byte for byte; it
 * refuses to revise one that already exists.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_LISTEN_MATCHER_PROFILE_ID } from "./listenMatcherProfiles";
import {
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE,
} from "./listenRoundTwoCandidateManifest";
import { LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE } from "./listenRoundTwoEligibilityManifest";
import {
  LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE,
  LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE,
  assertListenRoundTwoApprovedProfilesUnchanged,
  listenRoundTwoProductionDecision,
} from "./listenRoundTwoProductionDecision";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LISTEN_ROUND_TWO_APPROVED_PROFILES_PATH = LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(REPOSITORY_ROOT, path), "utf8"));
}

async function main(): Promise<number> {
  const [eligibility, candidateManifest, ...evidenceRepetitions] = await Promise.all([
    readJson(LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE),
    readJson(LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE),
    ...LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.map((path) => readJson(path)),
  ]);
  const requirementBytes = await readFile(
    join(REPOSITORY_ROOT, LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE),
  );
  const modelEvidenceRequirementSha256 = createHash("sha256").update(requirementBytes).digest("hex");
  const decision = listenRoundTwoProductionDecision({
    eligibility,
    candidateManifest,
    evidenceRepetitions,
    // The not-run branch collected no live corpus, so no archive is passed and
    // none can be invented: a live result would have to come from a session that
    // played candidates the round never confirmed, and the live evidence reader
    // refuses an archive that names a manifest holding no eligible candidate.
    liveArchives: [],
    productionDefaultProfileId: DEFAULT_LISTEN_MATCHER_PROFILE_ID,
    modelEvidenceRequirementSha256,
  });
  const { record } = decision;
  console.log(
    `${LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE}: reproduced from ` +
      `${LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.length} Task 26 repetitions, run status ` +
      `${record.eligibilityRunStatus}, reason ${record.reason ?? "none"}, digest ` +
      `${record.eligibilityManifestDigest} over candidate manifest ` +
      `${record.candidateManifestDigest} over Task 26 ${record.task26TerminalOutcome} at ` +
      `${record.task26EvidenceDigest}`,
  );
  for (const ablation of record.ablations) {
    console.log(
      `${ablation.ablation}: selected ${ablation.selectedProfileIds.join(", ") || "nothing"}; ` +
        `${ablation.stopSatisfied ? "accepted" : `refused by ${ablation.stopReasons.join(", ")}`}; ` +
        `${ablation.registrable ? "registrable" : "not registrable"}`,
    );
  }
  console.log(
    `decision: ${record.outcome}, default ${record.selectedDefaultProfileId}, approved ` +
      `[${record.approvedProfileIds.join(", ")}], live corpus ${record.liveCorpus.status}, ` +
      `requirement ${record.modelEvidenceRequirement?.sha256 ?? "none"}`,
  );
  const target = join(REPOSITORY_ROOT, LISTEN_ROUND_TWO_APPROVED_PROFILES_PATH);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing !== null) {
    assertListenRoundTwoApprovedProfilesUnchanged(JSON.parse(existing), record);
    if (existing !== serialized) {
      throw new Error(
        `${LISTEN_ROUND_TWO_APPROVED_PROFILES_PATH} holds the same list in different bytes.`,
      );
    }
    console.log(
      `${LISTEN_ROUND_TWO_APPROVED_PROFILES_PATH}: reproduced unchanged, digest ` +
        `${record.digest.value}`,
    );
    return 0;
  }
  await writeFile(target, serialized);
  console.log(
    `${LISTEN_ROUND_TWO_APPROVED_PROFILES_PATH}: wrote outcome ${record.outcome}, ` +
      `${record.approvedProfileIds.length} approved profiles, digest ${record.digest.value}`,
  );
  return 0;
}

/**
 * Runs only when this command is itself the process entry point, matched by the
 * entry bundle's basename rather than by `import.meta.url`, which esbuild inlines
 * into every bundle that contains this module.
 */
const COMMAND_ENTRY_POINT = "listenRoundTwoProductionDecisionCli";

if (basename(process.argv[1] ?? "").replace(/\.[^.]*$/, "") === COMMAND_ENTRY_POINT) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
