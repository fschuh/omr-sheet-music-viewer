/**
 * Task 28: the round-two eligibility manifest, the second link of the round's
 * immutable artifact chain.
 *
 * Task 27 froze an empty candidate manifest with reason `no-ablation-accepted`,
 * so this round has no candidate it can both register and confirm and Task 28
 * takes its not-run branch: the version-2 confirmation fixtures are not decoded,
 * the matrix is not run, and the corpus is not touched. Those fixtures are the
 * round's only genuinely unseen evidence and can be spent exactly once; spending
 * them on a round that produced nothing to confirm would burn them for nothing.
 * They stay unobserved and remain valid confirmation evidence for a later round.
 *
 * The manifest still exists in that branch, because the chain must stay intact
 * and Tasks 14, 15, and 29 read one schema in every branch. The schema is
 * therefore explicitly discriminated by `runStatus`, and the two branches carry
 * disjoint evidence fields: a single undifferentiated shape would force the
 * not-run branch to invent placeholder archive hashes for a run that never
 * happened, which is exactly the fabricated evidence this chain exists to
 * prevent.
 *
 * Nothing here is read as a conclusion. The branch, the reason code, the terminal
 * outcome, and the Task 26 evidence digest are re-derived by rerunning Task 24's
 * frozen stop rule over the archived Task 26 repetitions, the candidate manifest
 * this references is required to be the record that rerun produces, and the claim
 * that no confirmation trace was decoded is recomputed from the trace manifest
 * rather than asserted.
 */

import {
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_KEYS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME,
  LISTEN_ROUND_TWO_ROUND_ID,
  listenRoundTwoCandidateManifestFromRepetitions,
  type ListenRoundTwoCandidateManifest,
  type ListenRoundTwoCandidateNotRunReason,
  type ListenRoundTwoReproducedEvidence,
} from "./listenRoundTwoCandidateManifest";
import type { ListenRoundTwoTerminalOutcome } from "./listenRoundTwoAblationBenchmark";
import {
  LISTEN_CONFIRMATION_REPRODUCTION_STATUSES,
  LISTEN_REPEATED_RECOVERY_OUTCOMES,
  type ListenConfirmationReproductionStatus,
  type ListenRepeatedRecoveryOutcome,
} from "./listenMatcherSelectionPolicy";
import {
  DeterministicHasher,
  LISTEN_PRIOR_TRACE_LEDGER_HASH,
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST,
  LISTEN_TRACE_MANIFEST_HASH,
  listenPriorTraceLedgerHash,
  listenTraceCorpusHash,
  listenTraceManifestHash,
  validateListenTraceManifest,
  type ListenTraceManifest,
} from "./listenTraceManifest";

export const LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME = "listen-round-two-eligibility-manifest";

/** The committed artifact, named beside the code that derives it. */
export const LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE =
  "benchmark-results/listen-round-two-eligibility-manifest-task28.json";

/**
 * The status discriminator, deliberately binary.
 *
 * Every consumer branches once on this value; the two not-run findings are
 * distinguished by `reason`, which only Task 29's recorded conclusion reads.
 * Making the status ternary instead would push that distinction into every
 * consumer that does not care about it.
 */
export type ListenRoundTwoEligibilityRunStatus =
  | "completed"
  | "not-run-no-confirmable-candidate";

/** Carried through from the candidate manifest, never re-derived downstream. */
export type ListenRoundTwoEligibilityNotRunReason = ListenRoundTwoCandidateNotRunReason;

/**
 * One confirmed candidate.
 *
 * `repeatedRecoveryOutcome` and `confirmationReproductionStatus` are Task 24's
 * labels, derived from the per-group confirmation records and covered by this
 * manifest's digest, so a recovery claim cannot be stated at the summary level
 * without the per-group evidence that produced it. The not-run branch carries no
 * entry and therefore no invented recovery result.
 *
 * `baseline-v1` is never a member: the live harness adds the baseline column
 * itself, and an eligibility manifest describes candidates only.
 */
export interface ListenRoundTwoEligibilityEntry {
  profileId: string;
  automatedEligible: boolean;
  /** Empty exactly when `automatedEligible` is true. */
  rejectionReasons: readonly string[];
  repeatedRecoveryOutcome: ListenRepeatedRecoveryOutcome;
  confirmationReproductionStatus: ListenConfirmationReproductionStatus;
}

/**
 * The confirmation partition as recomputed from the trace manifest.
 *
 * `decodedTraceCount` is counted from the rows themselves — a confirmation row
 * that has gained a decoded-structure identity or lost its `not-decoded-until-
 * task-28` status counts as decoded — so "the fixtures were never observed" is a
 * measurement of the corpus rather than a sentence in a report. Under the not-run
 * branch it must be zero, and under `completed` it must be the whole partition:
 * that is what ties the status discriminator to whether the round's single-use
 * evidence was actually spent. `traceCount` is pinned in both branches, because
 * `decodedTraceCount === traceCount` is satisfied by an empty partition too, and
 * a completed run over no fixtures is not a confirmation.
 *
 * Identity is covered at two scales, and the count is neither of them.
 * `traceIdentityHash` covers every confirmation row — decoded or not, so the pin
 * holds in both branches — over the fields that say which musical evidence the row
 * is: its identifier, its rendered-content key, its musical input, and its paired
 * group. `traceGenerationHash` covers the whole manifest generation those rows
 * live in, with their decode state normalized out so one pin describes both
 * branches. Without the first, a fixture re-pointed at different rendered content
 * keeps its name and its count; without the second, a change anywhere else in the
 * corpus that the confirmation rows depend on goes unnoticed here.
 */
export interface ListenRoundTwoConfirmationPartitionState {
  traceCount: number;
  decodedTraceCount: number;
  priorLedgerHash: string;
  /**
   * The generation's identity with the confirmation partition's decode state held
   * at its authored value, so one pin covers both branches.
   */
  traceGenerationHash: string;
  /** The frozen identity of every confirmation row, decoded or not. */
  traceIdentityHash: string;
}

interface ListenRoundTwoEligibilityManifestCommon {
  name: typeof LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME;
  formatVersion: 1;
  roundId: typeof LISTEN_ROUND_TWO_ROUND_ID;
  runStatus: ListenRoundTwoEligibilityRunStatus;
  /** The Task 27 record this chains to. Required in both branches. */
  candidateManifestDigest: string;
  /** The Task 26 root, restated so the whole chain is checkable from this file. */
  task26TerminalOutcome: ListenRoundTwoTerminalOutcome;
  task26EvidenceDigest: string;
  entries: readonly ListenRoundTwoEligibilityEntry[];
  confirmationPartition: ListenRoundTwoConfirmationPartitionState;
  digest: {
    algorithm: "fnv1a-32-canonical-json";
    value: string;
  };
}

/**
 * Both archived repetitions and the digest the evidence verifier compared them by.
 *
 * The repetition is proven by two distinct archives, not by their bytes
 * differing: two runs of a deterministic matrix may legitimately hash alike, and
 * requiring them to differ would refuse the cleanest possible evidence while
 * still accepting one archive quoted twice under two names it never had.
 */
export interface ListenRoundTwoConfirmationEvidence {
  /**
   * The two archived repetitions, named so the repetition is provable against the
   * files themselves. The evidence verifier resolves both names, requires them to
   * be distinct files, and recomputes their hashes and comparison digest.
   */
  runOneArchive: string;
  runOneSha256: string;
  runTwoArchive: string;
  runTwoSha256: string;
  comparisonDigest: string;
}

export interface ListenRoundTwoCompletedEligibilityManifest
  extends ListenRoundTwoEligibilityManifestCommon {
  runStatus: "completed";
  confirmationEvidence: ListenRoundTwoConfirmationEvidence;
}

export interface ListenRoundTwoNotRunEligibilityManifest
  extends ListenRoundTwoEligibilityManifestCommon {
  runStatus: "not-run-no-confirmable-candidate";
  entries: readonly [];
  reason: ListenRoundTwoEligibilityNotRunReason;
}

export type ListenRoundTwoEligibilityManifest =
  | ListenRoundTwoCompletedEligibilityManifest
  | ListenRoundTwoNotRunEligibilityManifest;

/**
 * The exact key set of each branch, declared once.
 *
 * "Forbidden" is enforced as an unknown key rather than as a null value: a
 * not-run record that carries `confirmationEvidence: null` still defines a place
 * for archive hashes that never existed, and a `completed` record carrying a
 * `reason` would describe a run that happened as one that did not.
 */
export const LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_COMMON_KEYS: readonly string[] = Object.freeze([
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
]);

export const LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_KEYS:
  Readonly<Record<ListenRoundTwoEligibilityRunStatus, readonly string[]>> = Object.freeze({
    completed: Object.freeze([
      ...LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_COMMON_KEYS,
      "confirmationEvidence",
    ]),
    "not-run-no-confirmable-candidate": Object.freeze([
      ...LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_COMMON_KEYS,
      "reason",
    ]),
  });

export const LISTEN_ROUND_TWO_ELIGIBILITY_ENTRY_KEYS: readonly string[] = Object.freeze([
  "profileId",
  "automatedEligible",
  "rejectionReasons",
  "repeatedRecoveryOutcome",
  "confirmationReproductionStatus",
]);

export const LISTEN_ROUND_TWO_ELIGIBILITY_RUN_STATUSES:
  readonly ListenRoundTwoEligibilityRunStatus[] = Object.freeze([
    "completed",
    "not-run-no-confirmable-candidate",
  ]);

export const LISTEN_ROUND_TWO_ELIGIBILITY_NOT_RUN_REASONS:
  readonly ListenRoundTwoEligibilityNotRunReason[] = Object.freeze([
    "no-ablation-accepted",
    "no-supported-parameterization",
  ]);

/** The baseline is the harness's own column, never a manifest member. */
export const LISTEN_ROUND_TWO_ELIGIBILITY_EXCLUDED_PROFILE_ID = "baseline-v1";

/* ------------------------------------------------------------------------- *
 * Hashing
 * ------------------------------------------------------------------------- */

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function canonicalDigest(value: unknown): string {
  const hasher = new DeterministicHasher();
  hasher.text(canonicalJson(value), false);
  return hasher.digest;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** The digest of any eligibility manifest, over every field except the digest. */
export function listenRoundTwoEligibilityManifestDigest(record: unknown): string {
  const { digest: _digest, ...rest } = (record ?? {}) as Record<string, unknown>;
  return canonicalDigest(rest);
}

/** The digest of a candidate manifest, recomputed rather than read from it. */
export function listenRoundTwoCandidateManifestDigest(record: unknown): string {
  const { digest: _digest, ...rest } = (record ?? {}) as Record<string, unknown>;
  return canonicalDigest(rest);
}

/* ------------------------------------------------------------------------- *
 * The confirmation partition, measured rather than asserted
 * ------------------------------------------------------------------------- */

const CONFIRMATION_UNDECODED_STATUS = "not-decoded-until-task-28";

/**
 * Recomputes what the confirmation partition currently records.
 *
 * A confirmation row counts as decoded once it stops carrying the undecoded
 * status or gains a pinned decoded-structure identity, which are the two ways an
 * observation of these fixtures would show up in the corpus.
 *
 * The identity hash covers every confirmation row rather than only the undecoded
 * ones, so the same pin holds in both branches, and it covers what makes a row
 * that evidence rather than a name: the identifier, the rendered-content key, the
 * musical input, and the authored pair it belongs to. `decodeStatus` and
 * `fixtureVersion` are deliberately excluded, because those are what
 * `decodedTraceCount` measures; folding them in would make the identity move for
 * the expected reason and hide a substituted fixture behind it.
 */
export function listenRoundTwoConfirmationPartitionState(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): ListenRoundTwoConfirmationPartitionState {
  const confirmation = manifest.traces.filter(({ partition }) => partition === "confirmation");
  const undecoded = confirmation.filter((trace) => (
    trace.decodeStatus === CONFIRMATION_UNDECODED_STATUS && trace.fixtureVersion === null
  ));
  const hasher = new DeterministicHasher();
  hasher.number(confirmation.length);
  for (const trace of confirmation) {
    hasher.text(trace.id);
    hasher.text(trace.contentKey);
    hasher.text(trace.musicalInputHash);
    hasher.text(trace.suite);
    hasher.text(trace.rendererKey);
    hasher.text(trace.pairedGroupId ?? "");
    hasher.text(trace.pairedGroupHash ?? "");
    hasher.text(trace.pairedCaseRole ?? "");
    hasher.number(trace.firstObservedManifestVersion);
  }
  return {
    traceCount: confirmation.length,
    decodedTraceCount: confirmation.length - undecoded.length,
    priorLedgerHash: listenPriorTraceLedgerHash(),
    traceGenerationHash: listenRoundTwoTraceGenerationHash(manifest),
    traceIdentityHash: hasher.digest,
  };
}

/**
 * Pinned from the version-2 corpus. Moving it means a confirmation row was
 * renamed, re-pointed at different rendered content, re-authored, or moved
 * between pairs — none of which any branch may do, decoded or not.
 */
export const LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH = "a5695acc";

/**
 * The manifest generation's identity, with the confirmation partition's decode
 * state held at its authored value.
 *
 * `listenTraceManifestHash` folds `decodeStatus` and `fixtureVersion` into its
 * digest, so decoding the confirmation fixtures — the one thing the completed
 * branch is defined by doing — moves it. Pinning the raw manifest hash in both
 * branches would therefore describe a corpus no completed round can produce.
 * Normalizing only the confirmation rows' decode fields, and only for this hash,
 * leaves every other field of every row covered by the same recipe while making
 * the pin mean what it is for: the generation these rows live in has not moved
 * underneath them. Whether they were decoded is a separate question, measured by
 * `decodedTraceCount` and constrained per branch.
 */
export function listenRoundTwoTraceGenerationHash(
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): string {
  return listenTraceManifestHash({
    ...manifest,
    traces: manifest.traces.map((trace) => (
      trace.partition === "confirmation"
        ? { ...trace, decodeStatus: CONFIRMATION_UNDECODED_STATUS, fixtureVersion: null }
        : trace
    )),
  });
}

/**
 * Pinned from version 2, and equal to `LISTEN_TRACE_MANIFEST_HASH` only while the
 * confirmation fixtures remain undecoded. It stays at this value once they are
 * decoded, which is the point of normalizing them out.
 */
export const LISTEN_ROUND_TWO_TRACE_GENERATION_HASH = "d1971fa3";

/** The confirmation-partition census the version-2 manifest freezes. */
export const LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT = 12;

/**
 * Everything that would make the not-run branch's central claim false.
 *
 * The claim is that the round's single-use evidence was not spent, so it is
 * checked against the corpus: the whole partition is still present, none of it
 * is decoded, the identifiers are the ones version 2 authored, and the
 * first-observed ledger that separates unseen evidence from prior rounds is
 * unchanged.
 */
export function listenRoundTwoConfirmationUntouchedProblems(
  state: ListenRoundTwoConfirmationPartitionState = listenRoundTwoConfirmationPartitionState(),
  manifest: ListenTraceManifest = LISTEN_TRACE_MANIFEST,
): string[] {
  const problems: string[] = [];
  // The confirmation rows are part of one frozen generation, so the generation
  // is validated as a whole first. A row can keep its own identity while the
  // corpus it is drawn from moves underneath it, and a partition-scoped check
  // alone would call that untouched.
  for (const { code, message } of validateListenTraceManifest(manifest)) {
    problems.push(`The trace manifest is invalid: ${code}: ${message}`);
  }
  const corpusHash = listenTraceCorpusHash(manifest);
  // The not-run branch leaves the fixtures undecoded, so the generation hash and
  // the manifest's own pinned hash must both hold and must agree.
  if (state.traceGenerationHash !== LISTEN_ROUND_TWO_TRACE_GENERATION_HASH ||
      listenTraceManifestHash(manifest) !== LISTEN_TRACE_MANIFEST_HASH) {
    problems.push(
      `The trace manifest generation hashes to ${state.traceGenerationHash}, not ` +
        `${LISTEN_ROUND_TWO_TRACE_GENERATION_HASH}.`,
    );
  }
  if (corpusHash !== LISTEN_TRACE_CORPUS_HASH) {
    problems.push(
      `The musical corpus hashes to ${corpusHash}, not ${LISTEN_TRACE_CORPUS_HASH}.`,
    );
  }
  if (state.traceCount !== LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT) {
    problems.push(
      `The confirmation partition holds ${state.traceCount} traces, not ` +
        `${LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT}.`,
    );
  }
  if (state.decodedTraceCount !== 0) {
    problems.push(
      `${state.decodedTraceCount} confirmation traces record a decoded structure, and the ` +
        "not-run branch decodes none.",
    );
  }
  if (state.priorLedgerHash !== LISTEN_PRIOR_TRACE_LEDGER_HASH) {
    problems.push(
      `The first-observed ledger hashes to ${state.priorLedgerHash}, not ` +
        `${LISTEN_PRIOR_TRACE_LEDGER_HASH}.`,
    );
  }
  if (state.traceIdentityHash !== LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH) {
    problems.push(
      `The confirmation fixtures hash to ${state.traceIdentityHash}, not ` +
        `${LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH}.`,
    );
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * Schema validation, for both branches
 * ------------------------------------------------------------------------- */

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{8}$/;

function keyProblems(record: Record<string, unknown>, expected: readonly string[], where: string) {
  const problems: string[] = [];
  const actual = Object.keys(record);
  for (const key of expected) {
    if (!Object.hasOwn(record, key)) problems.push(`${where} is missing ${key}.`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) problems.push(`${where} carries forbidden field ${key}.`);
  }
  return problems;
}

function entryProblems(entry: unknown, index: number): string[] {
  const where = `Eligibility entry ${index}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return [`${where} is not a record.`];
  }
  const record = entry as Record<string, unknown>;
  const problems = keyProblems(record, LISTEN_ROUND_TWO_ELIGIBILITY_ENTRY_KEYS, where);
  if (typeof record.profileId !== "string" || record.profileId.length === 0) {
    problems.push(`${where} has no profile identifier.`);
  } else if (record.profileId === LISTEN_ROUND_TWO_ELIGIBILITY_EXCLUDED_PROFILE_ID) {
    problems.push(
      `${where} names ${LISTEN_ROUND_TWO_ELIGIBILITY_EXCLUDED_PROFILE_ID}, which the live ` +
        "harness supplies as its own baseline column rather than reading from this manifest.",
    );
  }
  if (typeof record.automatedEligible !== "boolean") {
    problems.push(`${where} does not mark itself automated-eligible or rejected.`);
  }
  const reasons = record.rejectionReasons;
  if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== "string")) {
    problems.push(`${where} has no rejection-reason list.`);
  } else if (record.automatedEligible === true && reasons.length > 0) {
    problems.push(`${where} is automated-eligible and rejected at once.`);
  } else if (record.automatedEligible === false && reasons.length === 0) {
    problems.push(`${where} is rejected without naming a reason.`);
  }
  const outcome = record.repeatedRecoveryOutcome as ListenRepeatedRecoveryOutcome;
  const status = record.confirmationReproductionStatus as ListenConfirmationReproductionStatus;
  if (!LISTEN_REPEATED_RECOVERY_OUTCOMES.includes(outcome)) {
    problems.push(`${where} records repeated-recovery outcome ${JSON.stringify(outcome)}.`);
  }
  if (!LISTEN_CONFIRMATION_REPRODUCTION_STATUSES.includes(status)) {
    problems.push(`${where} records reproduction status ${JSON.stringify(status)}.`);
  }
  // A completed run decoded the confirmation fixtures, so `not-run` cannot be
  // the reproduction status of an entry that only exists because they were read.
  if (status === "not-run") {
    problems.push(`${where} was confirmed against fixtures it records as never run.`);
  }
  if (outcome === "confirmed-full-resolution" && status !== "reproduced") {
    problems.push(
      `${where} claims confirmed full resolution with reproduction status ` +
        `${JSON.stringify(status)}; no confirmation group reproduced the phenomenon.`,
    );
  }
  // Task 23's no-regression condition is a gate, not a label: failing it on a
  // reproducing group makes the candidate ineligible, so recording the failure
  // and the eligibility together is a contradiction rather than a nuance.
  if (outcome === "regressed" && record.automatedEligible === true) {
    problems.push(
      `${where} regressed a reproducing repeated-chord group and is marked ` +
        "automated-eligible; failing confirmation no-regression makes a candidate ineligible.",
    );
  }
  return problems;
}

/**
 * Everything that must be true of an eligibility manifest of either branch.
 *
 * The branch is taken from `runStatus` alone, never from whether the entry list
 * happens to be empty: a completed matrix that rejected every candidate still has
 * entries, and reading emptiness as "not run" would erase the difference between
 * a round that spent its confirmation fixtures and one that did not.
 */
export function listenRoundTwoEligibilityManifestProblems(record: unknown): string[] {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return ["The eligibility manifest is one record, not a list."];
  }
  const manifest = record as Record<string, unknown>;
  const runStatus = manifest.runStatus as ListenRoundTwoEligibilityRunStatus;
  if (!LISTEN_ROUND_TWO_ELIGIBILITY_RUN_STATUSES.includes(runStatus)) {
    return [`The eligibility manifest records runStatus ${JSON.stringify(runStatus)}.`];
  }
  const problems = keyProblems(
    manifest,
    LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_KEYS[runStatus],
    "The eligibility manifest",
  );
  if (manifest.name !== LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME) {
    problems.push(`The eligibility manifest names ${JSON.stringify(manifest.name)}.`);
  }
  if (manifest.formatVersion !== 1) {
    problems.push(`The eligibility manifest is at format version ${manifest.formatVersion}.`);
  }
  if (manifest.roundId !== LISTEN_ROUND_TWO_ROUND_ID) {
    problems.push(`The eligibility manifest belongs to round ${JSON.stringify(manifest.roundId)}.`);
  }
  for (const field of ["candidateManifestDigest", "task26EvidenceDigest"]) {
    const value = manifest[field];
    if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
      problems.push(`The eligibility manifest's ${field} is not a digest.`);
    }
  }
  if (typeof manifest.task26TerminalOutcome !== "string") {
    problems.push("The eligibility manifest carries no Task 26 terminal outcome.");
  }
  const entries = manifest.entries;
  if (!Array.isArray(entries)) {
    problems.push("The eligibility manifest carries no entry list.");
  } else {
    entries.forEach((entry, index) => problems.push(...entryProblems(entry, index)));
    const ids = entries.map((entry) => (entry as { profileId?: unknown }).profileId);
    if (new Set(ids).size !== ids.length) {
      problems.push("The eligibility manifest lists a profile twice.");
    }
  }
  const partition = manifest.confirmationPartition as
    ListenRoundTwoConfirmationPartitionState | undefined;
  if (typeof partition !== "object" || partition === null) {
    problems.push("The eligibility manifest records no confirmation partition.");
  } else {
    for (const field of ["traceCount", "decodedTraceCount"] as const) {
      if (!Number.isInteger(partition[field]) || partition[field] < 0) {
        problems.push(`The confirmation partition's ${field} is not a count.`);
      }
    }
    for (const field of ["priorLedgerHash", "traceGenerationHash", "traceIdentityHash"] as const) {
      if (typeof partition[field] !== "string" || !DIGEST_PATTERN.test(partition[field])) {
        problems.push(`The confirmation partition's ${field} is not a digest.`);
      }
    }
    // The census and the identity are pinned in both branches. Without the
    // census, `decodedTraceCount === traceCount` is satisfied by an empty
    // partition, so a completed run that decoded nothing would validate; without
    // the identity, twelve rows renamed or re-pointed at other rendered content
    // would still count as twelve.
    if (partition.traceCount !== LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT) {
      problems.push(
        `The confirmation partition holds ${partition.traceCount} traces, not ` +
          `${LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT}.`,
      );
    }
    if (partition.traceIdentityHash !== LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH) {
      problems.push(
        `The confirmation fixtures hash to ${partition.traceIdentityHash}, not ` +
          `${LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH}.`,
      );
    }
    if (partition.traceGenerationHash !== LISTEN_ROUND_TWO_TRACE_GENERATION_HASH) {
      problems.push(
        `The confirmation partition names generation ${partition.traceGenerationHash}, not ` +
          `${LISTEN_ROUND_TWO_TRACE_GENERATION_HASH}.`,
      );
    }
    if (partition.priorLedgerHash !== LISTEN_PRIOR_TRACE_LEDGER_HASH) {
      problems.push(
        `The first-observed ledger hashes to ${partition.priorLedgerHash}, not ` +
          `${LISTEN_PRIOR_TRACE_LEDGER_HASH}.`,
      );
    }
  }
  if (runStatus === "not-run-no-confirmable-candidate") {
    if (Array.isArray(entries) && entries.length > 0) {
      problems.push(
        `The not-run branch confirmed nothing, so it may hold no entry; it holds ` +
          `${entries.length}.`,
      );
    }
    const reason = manifest.reason as ListenRoundTwoEligibilityNotRunReason;
    if (!LISTEN_ROUND_TWO_ELIGIBILITY_NOT_RUN_REASONS.includes(reason)) {
      problems.push(`The not-run branch records reason ${JSON.stringify(reason)}.`);
    }
    if (partition !== undefined && partition !== null && partition.decodedTraceCount !== 0) {
      problems.push(
        `The not-run branch decoded no confirmation trace, and this record counts ` +
          `${partition.decodedTraceCount}.`,
      );
    }
  } else {
    if (Array.isArray(entries) && entries.length === 0) {
      problems.push("A completed confirmation matrix records the candidates it measured.");
    }
    const evidence = manifest.confirmationEvidence as
      ListenRoundTwoConfirmationEvidence | undefined;
    if (typeof evidence !== "object" || evidence === null) {
      problems.push("A completed run records both archived repetitions and their comparison.");
    } else {
      for (const field of ["runOneSha256", "runTwoSha256"] as const) {
        if (typeof evidence[field] !== "string" || !SHA256_PATTERN.test(evidence[field])) {
          problems.push(`The confirmation evidence's ${field} is not a SHA-256.`);
        }
      }
      for (const field of ["runOneArchive", "runTwoArchive"] as const) {
        if (typeof evidence[field] !== "string" || evidence[field].length === 0) {
          problems.push(`The confirmation evidence names no ${field}.`);
        }
      }
      // The canonical comparison digest is the Task 13 recipe — SHA-256 over the
      // canonical JSON with the host-dependent fields omitted — not a short
      // record digest, so it is shaped like the thing it actually is.
      if (typeof evidence.comparisonDigest !== "string" ||
          !SHA256_PATTERN.test(evidence.comparisonDigest)) {
        problems.push("The confirmation evidence's comparisonDigest is not a SHA-256.");
      }
      if (evidence.runOneArchive === evidence.runTwoArchive) {
        problems.push(
          `Both confirmation repetitions name archive ${JSON.stringify(evidence.runOneArchive)}, ` +
            "so one run was quoted twice rather than repeated.",
        );
      }
    }
    if (partition !== undefined && partition !== null &&
        partition.decodedTraceCount !== partition.traceCount) {
      problems.push(
        `A completed run decodes the whole confirmation partition, and this record decoded ` +
          `${partition.decodedTraceCount} of ${partition.traceCount}.`,
      );
    }
  }
  const digest = manifest.digest as { algorithm?: unknown; value?: unknown } | undefined;
  const recomputed = listenRoundTwoEligibilityManifestDigest(manifest);
  if (digest?.algorithm !== "fnv1a-32-canonical-json") {
    problems.push(`The eligibility manifest's digest algorithm is ${digest?.algorithm}.`);
  }
  if (digest?.value !== recomputed) {
    problems.push(
      `The eligibility manifest records digest ${JSON.stringify(digest?.value)}, recomputed ` +
        `${recomputed}.`,
    );
  }
  return problems;
}

export function assertValidListenRoundTwoEligibilityManifest(
  record: unknown,
): ListenRoundTwoEligibilityManifest {
  const problems = listenRoundTwoEligibilityManifestProblems(record);
  if (problems.length > 0) throw new Error(problems.join(" "));
  return record as ListenRoundTwoEligibilityManifest;
}

/**
 * The profile columns a live harness replays beside its own baseline.
 *
 * It branches on `runStatus`, which is the rule every consumer of this artifact
 * follows: the not-run branch has no columns because nothing was confirmed, not
 * because a list happened to come back empty.
 */
export function listenRoundTwoAutomatedEligibleProfileIds(
  manifest: ListenRoundTwoEligibilityManifest,
): string[] {
  return manifest.runStatus === "not-run-no-confirmable-candidate"
    ? []
    : manifest.entries.filter(({ automatedEligible }) => automatedEligible)
      .map(({ profileId }) => profileId);
}

/* ------------------------------------------------------------------------- *
 * The chain: eligibility -> candidate manifest -> Task 26 ablation artifact
 * ------------------------------------------------------------------------- */

/**
 * Both digest links, and the semantic agreement across all three artifacts.
 *
 * Each link is recomputed from the referenced record rather than compared to the
 * digest it states about itself, so a chain whose artifacts each satisfy their
 * own schema while disagreeing with one another fails here. `notRunReason` and
 * `reason` must agree exactly: the reason is Task 27's finding, carried through,
 * and Task 29 describes the round from it.
 */
export function listenRoundTwoArtifactChainProblems(options: {
  eligibility: unknown;
  candidateManifest: unknown;
  reproducedEvidence?: ListenRoundTwoReproducedEvidence;
}): string[] {
  const problems = listenRoundTwoEligibilityManifestProblems(options.eligibility);
  const eligibility = options.eligibility as Record<string, unknown>;
  const candidate = options.candidateManifest as Record<string, unknown> | null;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    problems.push("The candidate manifest this chains to is not a record.");
    return problems;
  }
  problems.push(...keyProblems(
    candidate,
    LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_KEYS,
    "The candidate manifest",
  ));
  if (candidate.name !== LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME) {
    problems.push(`The candidate manifest names ${JSON.stringify(candidate.name)}.`);
  }
  const candidateDigest = listenRoundTwoCandidateManifestDigest(candidate);
  const statedCandidateDigest = (candidate.digest as { value?: unknown } | undefined)?.value;
  if (statedCandidateDigest !== candidateDigest) {
    problems.push(
      `The candidate manifest records digest ${JSON.stringify(statedCandidateDigest)}, ` +
        `recomputed ${candidateDigest}.`,
    );
  }
  if (eligibility.candidateManifestDigest !== candidateDigest) {
    problems.push(
      `The eligibility manifest chains to candidate manifest ` +
        `${JSON.stringify(eligibility.candidateManifestDigest)}, and that record hashes to ` +
        `${candidateDigest}.`,
    );
  }
  if (eligibility.task26TerminalOutcome !== candidate.task26TerminalOutcome) {
    problems.push(
      `The chain disagrees about the Task 26 terminal outcome: ` +
        `${JSON.stringify(eligibility.task26TerminalOutcome)} against ` +
        `${JSON.stringify(candidate.task26TerminalOutcome)}.`,
    );
  }
  if (eligibility.task26EvidenceDigest !== candidate.task26EvidenceDigest) {
    problems.push(
      `The chain disagrees about the Task 26 evidence digest: ` +
        `${JSON.stringify(eligibility.task26EvidenceDigest)} against ` +
        `${JSON.stringify(candidate.task26EvidenceDigest)}.`,
    );
  }
  const candidateIds = Array.isArray(candidate.candidateProfileIds)
    ? candidate.candidateProfileIds
    : null;
  if (candidateIds === null) {
    problems.push("The candidate manifest carries no candidate list.");
  }
  if (eligibility.runStatus === "not-run-no-confirmable-candidate") {
    if (eligibility.reason !== candidate.notRunReason) {
      problems.push(
        `The eligibility manifest carries reason ${JSON.stringify(eligibility.reason)}, and the ` +
          `candidate manifest records ${JSON.stringify(candidate.notRunReason)}.`,
      );
    }
    if (candidateIds !== null && candidateIds.length > 0) {
      problems.push(
        "The not-run branch is taken only when the candidate manifest registered nothing, and " +
          `this one registered ${candidateIds.length}.`,
      );
    }
  } else if (eligibility.runStatus === "completed") {
    if (candidate.notRunReason !== null) {
      problems.push(
        `A completed confirmation ran against a candidate manifest whose notRunReason is ` +
          `${JSON.stringify(candidate.notRunReason)} rather than null.`,
      );
    }
    const entries = Array.isArray(eligibility.entries) ? eligibility.entries : [];
    const confirmed = entries.map((entry) => (entry as { profileId?: unknown }).profileId);
    if (candidateIds !== null && !sameCanonical([...confirmed].sort(), [...candidateIds].sort())) {
      problems.push(
        `The confirmation reports on ${JSON.stringify(confirmed)}, and the candidate manifest ` +
          `froze ${JSON.stringify(candidateIds)}.`,
      );
    }
  }
  if (options.reproducedEvidence !== undefined) {
    const reproduced = options.reproducedEvidence;
    if (reproduced.digest !== candidate.task26EvidenceDigest) {
      problems.push(
        `The Task 26 archives recompute to digest ${reproduced.digest}, and the chain references ` +
          `${JSON.stringify(candidate.task26EvidenceDigest)}.`,
      );
    }
    if (reproduced.terminalOutcome !== candidate.task26TerminalOutcome) {
      problems.push(
        `The Task 26 archives rerun to terminal outcome ${reproduced.terminalOutcome}, and the ` +
          `chain records ${JSON.stringify(candidate.task26TerminalOutcome)}.`,
      );
    }
    if (reproduced.notRunReason !== candidate.notRunReason) {
      problems.push(
        `The Task 26 archives rerun to reason ${JSON.stringify(reproduced.notRunReason)}, and ` +
          `the chain records ${JSON.stringify(candidate.notRunReason)}.`,
      );
    }
    if (reproduced.acceptedAblation !== candidate.ablationId) {
      problems.push(
        `The Task 26 archives rerun to ablation ${JSON.stringify(reproduced.acceptedAblation)}, ` +
          `and the chain names ${JSON.stringify(candidate.ablationId)}.`,
      );
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- *
 * Emitting the not-run manifest
 * ------------------------------------------------------------------------- */

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export interface ListenRoundTwoEligibilityEmission {
  manifest: ListenRoundTwoNotRunEligibilityManifest;
  candidateManifest: ListenRoundTwoCandidateManifest;
  reproducedEvidence: ListenRoundTwoReproducedEvidence;
  confirmationPartition: ListenRoundTwoConfirmationPartitionState;
}

/**
 * Freezes the not-run eligibility manifest from the committed chain.
 *
 * The chain is resolved before anything else happens, and it is resolved by
 * rerunning it: the archived Task 26 repetitions are recomputed under the frozen
 * stop rule, the candidate manifest that rerun produces must be the committed one
 * byte for byte, and only then is its digest — recomputed from its own fields —
 * carried into this record. A candidate manifest that merely states the round's
 * result, or that this commit's evidence does not reproduce, is a broken chain
 * rather than a detail to reconcile.
 *
 * Only the not-run branch is emitted. A completed manifest must be frozen against
 * two archived repetitions of the confirmation matrix and their comparison
 * digest, and no such run exists: accepting entries and hashes from a caller here
 * would be exactly the fabricated confirmation evidence the discriminated schema
 * exists to make impossible.
 */
export function listenRoundTwoEligibilityManifest(options: {
  candidateManifest: unknown;
  evidenceRepetitions: readonly unknown[];
  traceManifest?: ListenTraceManifest;
}): ListenRoundTwoEligibilityEmission {
  const { manifest: reproducedCandidate, reproductions } =
    listenRoundTwoCandidateManifestFromRepetitions({
      evidenceRepetitions: options.evidenceRepetitions,
    });
  if (!sameCanonical(options.candidateManifest, reproducedCandidate)) {
    throw new Error(
      "The committed Task 27 candidate manifest is not the record this commit's Task 26 " +
        "archives re-derive, so the chain is broken rather than extendable.",
    );
  }
  const [reproducedEvidence] = reproductions;
  if (reproducedCandidate.notRunReason === null) {
    throw new Error(
      "The candidate manifest registered candidates, which takes the completed branch: the " +
        "confirmation matrix must run twice, archive both repetitions, and record their " +
        "comparison digest before an eligibility manifest can be frozen. This emitter only " +
        "freezes the not-run branch.",
    );
  }
  if (reproducedCandidate.candidateProfileIds.length > 0) {
    throw new Error(
      `The candidate manifest carries reason ${reproducedCandidate.notRunReason} and ` +
        `${reproducedCandidate.candidateProfileIds.length} candidates at once.`,
    );
  }
  const confirmationPartition = listenRoundTwoConfirmationPartitionState(options.traceManifest);
  const untouched = listenRoundTwoConfirmationUntouchedProblems(
    confirmationPartition,
    options.traceManifest ?? LISTEN_TRACE_MANIFEST,
  );
  if (untouched.length > 0) throw new Error(untouched.join(" "));
  const record = {
    name: LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME,
    formatVersion: 1,
    roundId: LISTEN_ROUND_TWO_ROUND_ID,
    runStatus: "not-run-no-confirmable-candidate",
    candidateManifestDigest: listenRoundTwoCandidateManifestDigest(reproducedCandidate),
    task26TerminalOutcome: reproducedCandidate.task26TerminalOutcome,
    task26EvidenceDigest: reproducedCandidate.task26EvidenceDigest,
    entries: [],
    confirmationPartition: { ...confirmationPartition },
    reason: reproducedCandidate.notRunReason,
  } as const;
  const manifest = deepFreeze({
    ...record,
    digest: {
      algorithm: "fnv1a-32-canonical-json" as const,
      value: canonicalDigest(record),
    },
  }) as ListenRoundTwoNotRunEligibilityManifest;
  const chain = listenRoundTwoArtifactChainProblems({
    eligibility: manifest,
    candidateManifest: options.candidateManifest,
    reproducedEvidence,
  });
  if (chain.length > 0) throw new Error(chain.join(" "));
  return {
    manifest,
    candidateManifest: reproducedCandidate,
    reproducedEvidence,
    confirmationPartition,
  };
}

/**
 * The immutability rule, applied at the point of re-emission.
 *
 * The eligibility manifest is a link in a frozen chain, so a second emission may
 * reproduce it and may not revise it. A round that has more to say emits a new
 * round's artifacts rather than moving this record.
 */
export function assertListenRoundTwoEligibilityManifestUnchanged(
  existing: unknown,
  emitted: ListenRoundTwoEligibilityManifest,
): void {
  if (!sameCanonical(existing, emitted)) {
    throw new Error(
      "The frozen round-two eligibility manifest is immutable, and this emission differs from it.",
    );
  }
}
