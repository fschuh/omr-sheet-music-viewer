/**
 * Task 29: the round-two production decision and the approved-profile list, the
 * third and last link of the round's immutable artifact chain.
 *
 * The decision is one thing: which profile identifier production runs, recorded
 * with the evidence that chose it. Everything else here exists so that decision
 * cannot be stated more widely than the round measured it.
 *
 * The approved-profile list is a separate statement from the registry. The
 * registry keeps every historical and rejected profile so a regression can be
 * reproduced and a default rolled back, so membership there is not approval;
 * approval is `baseline-v1` plus every candidate that passed *all* automated
 * gates and *all* required live gates. A candidate that cleared the automated
 * matrix and whose live gates failed or were never collected is not a member,
 * and the selected default must be one. Only members may be offered by any later
 * calibration path.
 *
 * Round two took the not-run branch. Task 26 accepted no ablation, Task 27
 * registered no candidate, Task 28 confirmed nothing and left the version-2
 * confirmation fixtures unobserved, so there is no candidate that could have
 * become a member and the list is exactly `[baseline-v1]`. That is the bounded
 * conclusion `round-two-grid-produced-no-eligible-improvement`, described by the
 * reason the chain carries — and it is bounded deliberately: the confirmation
 * pass evaluates a frozen candidate set, never every safe profile in the searched
 * grid, so no branch of this round can support a claim that the scalar-threshold
 * family is exhausted.
 *
 * Nothing here is read as a conclusion. The chain is resolved by rerunning it —
 * Task 24's frozen stop rule recomputed over both archived Task 26 repetitions,
 * the committed Task 27 record required to be what that rerun re-derives, the
 * committed Task 28 record required to be what the Task 28 emitter reproduces —
 * and the approved list, the outcome, and the reason are derived from that rerun
 * rather than copied from the artifacts that state them.
 */

import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  LISTEN_MATCHER_PROFILE_IDS,
  isListenMatcherProfileId,
  type ListenMatcherProfileId,
} from "./listenMatcherProfiles";
import {
  LISTEN_ROUND_TWO_ROUND_ID,
  listenRoundTwoCandidateManifestFromRepetitions,
  type ListenRoundTwoCandidateManifest,
  type ListenRoundTwoReproducedAblation,
  type ListenRoundTwoReproducedEvidence,
} from "./listenRoundTwoCandidateManifest";
import {
  assertListenRoundTwoEligibilityManifestUnchanged,
  listenRoundTwoArtifactChainProblems,
  listenRoundTwoCandidateManifestDigest,
  listenRoundTwoEligibilityManifest,
  listenRoundTwoEligibilityManifestDigest,
  listenRoundTwoEligibilityManifestProblems,
  type ListenRoundTwoConfirmationPartitionState,
  type ListenRoundTwoEligibilityEntry,
  type ListenRoundTwoEligibilityManifest,
} from "./listenRoundTwoEligibilityManifest";
import {
  LISTEN_LIVE_GATE_CODES,
  listenRoundTwoLiveResults,
  type ListenRoundTwoLiveResult,
  type ListenRoundTwoLiveGateStatus,
} from "./listenRoundTwoLiveEvidence";
import {
  listenRoundTwoAutomatedMeasurements,
  listenRoundTwoLiveMeasurements,
  listenRoundTwoSelectDefault,
  type ListenRoundTwoSelection,
} from "./listenRoundTwoDefaultSelection";
import { DeterministicHasher, type ListenTraceManifest } from "./listenTraceManifest";
import type { ListenRoundTwoTerminalOutcome } from "./listenRoundTwoAblationBenchmark";
import type {
  ListenConfirmationReproductionStatus,
  ListenRepeatedRecoveryOutcome,
} from "./listenMatcherSelectionPolicy";

export const LISTEN_ROUND_TWO_APPROVED_PROFILES_NAME = "listen-round-two-approved-profiles";

/** The committed artifact, named beside the code that derives it. */
export const LISTEN_ROUND_TWO_APPROVED_PROFILES_FILE =
  "benchmark-results/listen-round-two-approved-profiles-task29.json";

/**
 * The written requirement this task emits instead of a task in the calibration
 * plan, because model work is an explicit non-goal there.
 *
 * It is referenced by content digest rather than by name: a requirement that can
 * be emptied or retitled after the decision cites it is not a carried residual.
 */
export const LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE =
  "plans/listen-decoder-model-evidence-requirement.md";

/**
 * The incumbent, and the profile a round that promotes nothing ends on.
 *
 * It is also the one profile approval never has to derive: it is the shipped
 * default whose behaviour every candidate was measured against, so it is a member
 * of the approved list in every branch.
 */
export const LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID: ListenMatcherProfileId = "baseline-v1";

/**
 * The three admissible endings of a round, kept distinct because they are
 * different findings about different evidence.
 *
 * `round-two-candidate-set-exhausted` requires a confirmation matrix that ran and
 * rejected every candidate it froze. `round-two-grid-produced-no-eligible-improvement`
 * is the not-run branch under either reason code, where the matrix never ran and
 * the confirmation fixtures were never spent. Neither says anything about profiles
 * the round never confirmed.
 *
 * `approved-without-material-improvement` is the fourth real ending: candidates
 * passed every automated and live gate and are therefore approved and offerable
 * by calibration, but the frozen ordered rule either did not separate them or the
 * winner showed no material improvement over the incumbent, so the global default
 * did not move. Approval and promotion are different decisions, and collapsing
 * them would either ship an indistinguishable profile or hide approved ones from
 * the calibration path that may legitimately offer them.
 */
export type ListenRoundTwoDecisionOutcome =
  | "promoted-candidate"
  | "approved-without-material-improvement"
  | "round-two-candidate-set-exhausted"
  | "round-two-grid-produced-no-eligible-improvement";

/**
 * One candidate's live-gate result.
 *
 * This is never supplied: `listenRoundTwoLiveResults` rederives it from Task 15's
 * archived acoustic and digital trials, per setup, per trial, and per counter, and
 * the row carries the gates and the failures that produced its status. A
 * `{profileId, status: "passed"}` row would be an approval nobody measured, which
 * is the one thing the live corpus exists to prevent.
 *
 * `not-collected` is a distinct status rather than an absent row: a candidate
 * nobody played is not the same finding as one that was played and failed.
 * Neither is a member, and the recorded conclusion has to say which happened.
 */
export type { ListenRoundTwoLiveGateStatus, ListenRoundTwoLiveResult };

export const LISTEN_ROUND_TWO_LIVE_GATE_STATUSES: readonly ListenRoundTwoLiveGateStatus[] =
  Object.freeze(["passed", "failed", "not-collected"]);

/** One archived live session, named and bound by content digest. */
export interface ListenRoundTwoLiveArchiveReference {
  path: string;
  sha256: string;
  digest: string;
}

/**
 * The repeated-chord result, copied from the eligibility entries rather than
 * restated.
 *
 * Both of Task 24's labels travel together because either alone overstates the
 * other: `discovery-full-resolution` with `inconclusive-no-reproduction` means no
 * confirmation group reproduced the phenomenon, and is not the `v05` case being
 * fixed. The not-run branch has no entry, so it has neither label, and the record
 * says that rather than inventing one.
 */
export interface ListenRoundTwoRepeatedChordEntry {
  profileId: string;
  repeatedRecoveryOutcome: ListenRepeatedRecoveryOutcome;
  confirmationReproductionStatus: ListenConfirmationReproductionStatus;
}

/** What each staged ablation selected, and the rule that refused it. */
export interface ListenRoundTwoAblationConclusion {
  ablation: string;
  selectedProfileIds: string[];
  stopSatisfied: boolean;
  stopReasons: string[];
  registrable: boolean;
}

export interface ListenRoundTwoModelEvidenceRequirement {
  path: typeof LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE;
  sha256: string;
}

/**
 * The approved-profile list.
 *
 * The whole chain is restated here — eligibility digest, candidate digest, Task 26
 * terminal outcome and evidence digest — so the conclusion is checkable from this
 * one file, and so a conclusion that cites the bass grid's measurements while its
 * link to them dangles fails rather than reads as auditable.
 */
export interface ListenRoundTwoApprovedProfileList {
  name: typeof LISTEN_ROUND_TWO_APPROVED_PROFILES_NAME;
  formatVersion: 1;
  roundId: typeof LISTEN_ROUND_TWO_ROUND_ID;
  outcome: ListenRoundTwoDecisionOutcome;
  /** The not-run reason carried through the chain; null in every other branch. */
  reason: string | null;
  selectedDefaultProfileId: ListenMatcherProfileId;
  incumbentProfileId: ListenMatcherProfileId;
  approvedProfileIds: readonly ListenMatcherProfileId[];
  eligibilityRunStatus: ListenRoundTwoEligibilityManifest["runStatus"];
  eligibilityManifestDigest: string;
  candidateManifestDigest: string;
  task26TerminalOutcome: ListenRoundTwoTerminalOutcome;
  task26EvidenceDigest: string;
  /**
   * The Task 15 evidence, and the results rederived from it.
   *
   * `archives` appears only when a corpus was collected, and names each session
   * by path, file SHA-256, and record digest, so the rows below can be recomputed
   * from the same bytes this decision read. A corpus that was not collected
   * carries no archive list rather than an empty one, for the same reason the
   * not-run eligibility branch carries no confirmation-evidence field.
   */
  liveCorpus: {
    status: "collected" | "not-collected";
    archives?: readonly ListenRoundTwoLiveArchiveReference[];
    results: readonly ListenRoundTwoLiveResult[];
  };
  repeatedChordResult: readonly ListenRoundTwoRepeatedChordEntry[];
  confirmationPartition: ListenRoundTwoConfirmationPartitionState;
  ablations: readonly ListenRoundTwoAblationConclusion[];
  /**
   * The frozen ordered rule as applied, present whenever the round had approved
   * candidates to rank. It records the pairwise comparison that decided each
   * pair, the step that decided it, the material-improvement assessment of the
   * winner, and why the round did not promote when it did not.
   */
  selection?: ListenRoundTwoSelection;
  /** Absent only when the round promoted a `confirmed-full-resolution` default. */
  modelEvidenceRequirement?: ListenRoundTwoModelEvidenceRequirement;
  digest: {
    algorithm: "fnv1a-32-canonical-json";
    value: string;
  };
}

export const LISTEN_ROUND_TWO_APPROVED_PROFILES_KEYS: readonly string[] = Object.freeze([
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
]);

export const LISTEN_ROUND_TWO_DECISION_OUTCOMES: readonly ListenRoundTwoDecisionOutcome[] =
  Object.freeze([
    "promoted-candidate",
    "approved-without-material-improvement",
    "round-two-candidate-set-exhausted",
    "round-two-grid-produced-no-eligible-improvement",
  ]);

/* ------------------------------------------------------------------------- *
 * Membership
 * ------------------------------------------------------------------------- */

/**
 * The status a live row's own gates produce.
 *
 * A row that covered no setup was never played, whatever it says; a row missing
 * any of the five gate codes was not measured against all of them and fails
 * closed; otherwise the status is exactly whether every gate passed.
 */
export function listenRoundTwoLiveResultStatus(
  result: ListenRoundTwoLiveResult,
): ListenRoundTwoLiveGateStatus {
  if (result.setupCoverage.length === 0) return "not-collected";
  const reported = new Set(result.gates.map(({ gate }) => gate));
  if (LISTEN_LIVE_GATE_CODES.some((gate) => !reported.has(gate))) return "failed";
  return result.gates.every(({ passed }) => passed) ? "passed" : "failed";
}

/**
 * The membership rule, stated once and applied everywhere.
 *
 * A member is the incumbent, or a candidate whose eligibility entry marks it
 * automated-eligible *and* whose live gates were collected and passed. The
 * not-run branch has no entries, so it has no members beyond the incumbent —
 * derived from the manifest rather than special-cased, because a completed matrix
 * that rejected everything must reach the same list by the same rule.
 *
 * A live result for a profile the automated matrix never cleared is refused
 * rather than ignored: it is either a harness pointed at the wrong manifest or a
 * candidate promoted around the automated gates, and neither may quietly produce
 * an approved profile.
 *
 * A live row's status is not read either. It is recomputed from the gates the row
 * carries — all five of them, since a row that reports only the gates it passed
 * has not been measured against the others — so a `passed` status whose own gate
 * rows do not support it fails here rather than approving a profile.
 */
export function listenRoundTwoApprovedProfileIds(options: {
  eligibility: ListenRoundTwoEligibilityManifest;
  liveResults?: readonly ListenRoundTwoLiveResult[];
}): ListenMatcherProfileId[] {
  const entries: readonly ListenRoundTwoEligibilityEntry[] =
    options.eligibility.runStatus === "completed" ? options.eligibility.entries : [];
  const automatedEligible = new Set(
    entries.filter(({ automatedEligible: eligible }) => eligible).map(({ profileId }) => profileId),
  );
  const live = options.liveResults ?? [];
  const seen = new Set<string>();
  for (const result of live) {
    if (seen.has(result.profileId)) {
      throw new Error(`The live corpus reports on ${result.profileId} twice.`);
    }
    seen.add(result.profileId);
    if (!automatedEligible.has(result.profileId)) {
      throw new Error(
        `The live corpus reports on ${result.profileId}, which the eligibility manifest does ` +
          "not mark automated-eligible; live evidence cannot approve a profile the automated " +
          "gates rejected or never measured.",
      );
    }
    const derived = listenRoundTwoLiveResultStatus(result);
    if (derived !== result.status) {
      throw new Error(
        `The live corpus records ${result.profileId} as ${JSON.stringify(result.status)}, and ` +
          `its own gate rows produce ${derived}.`,
      );
    }
  }
  const passed = new Set(
    live.filter(({ status }) => status === "passed").map(({ profileId }) => profileId),
  );
  const approved = [...automatedEligible].filter((profileId) => passed.has(profileId));
  for (const profileId of approved) {
    if (!isListenMatcherProfileId(profileId)) {
      throw new Error(`Approved profile ${profileId} is not a registry identifier.`);
    }
  }
  // Registry order, so the list is a set rather than a record of the order two
  // independent sources happened to be read in.
  const members = new Set<string>([LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID, ...approved]);
  return LISTEN_MATCHER_PROFILE_IDS.filter((profileId) => members.has(profileId));
}

/**
 * The approved list as this commit ships it.
 *
 * It is a constant so production code can ask the question without reading a
 * benchmark artifact, and the emitter requires the list it derives from the chain
 * to be exactly this, so the constant cannot drift from the evidence that
 * approved it.
 */
export const LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS: readonly ListenMatcherProfileId[] =
  Object.freeze(["baseline-v1"] as const);

export function isApprovedListenMatcherProfileId(
  value: unknown,
): value is ListenMatcherProfileId {
  return isListenMatcherProfileId(value) &&
    LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS.includes(value);
}

/**
 * The guard every later calibration path must pass an identifier through.
 *
 * Registry membership is not approval, and `findListenMatcherProfile` answers the
 * registry question, so a calibration path that validated with it alone would
 * happily offer a rejected profile that is still retained for rollback.
 */
export function assertOfferableListenMatcherProfileId(value: unknown): ListenMatcherProfileId {
  if (!isApprovedListenMatcherProfileId(value)) {
    throw new Error(
      `${JSON.stringify(value)} is not an approved listen matcher profile; only ` +
        `${LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS.join(", ")} may be offered.`,
    );
  }
  return value;
}

/* ------------------------------------------------------------------------- *
 * The decision
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

/** The digest of an approved-profile list, over every field except the digest. */
export function listenRoundTwoApprovedProfilesDigest(record: unknown): string {
  const { digest: _digest, ...rest } = (record ?? {}) as Record<string, unknown>;
  return canonicalDigest(rest);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DIGEST_PATTERN = /^[0-9a-f]{8}$/;

/**
 * Whether the round still owes the decoder/model-evidence requirement.
 *
 * A shipped threshold is not a resolved missing re-onset, so the requirement is
 * owed by every branch except the one that promoted a default whose own entry
 * recorded `confirmed-full-resolution`. Material partial recovery owes it, an
 * unreproduced confirmation owes it, and a round that promoted nothing owes it.
 */
export function listenRoundTwoRequiresModelEvidenceRequirement(options: {
  outcome: ListenRoundTwoDecisionOutcome;
  selectedDefaultProfileId: string;
  repeatedChordResult: readonly ListenRoundTwoRepeatedChordEntry[];
}): boolean {
  if (options.outcome !== "promoted-candidate") return true;
  const selected = options.repeatedChordResult
    .find(({ profileId }) => profileId === options.selectedDefaultProfileId);
  return selected?.repeatedRecoveryOutcome !== "confirmed-full-resolution";
}

/**
 * The bounded outcome, derived from the chain rather than chosen.
 *
 * The distinction the plan turns on is `runStatus`, not emptiness: a matrix that
 * ran and rejected every candidate spent the round's confirmation fixtures and
 * can say the candidate set is exhausted; a matrix that never ran cannot say
 * anything about candidates, only about the grid that produced none.
 */
function decisionOutcome(
  eligibility: ListenRoundTwoEligibilityManifest,
  approvedCandidateIds: readonly string[],
  selection: ListenRoundTwoSelection | undefined,
): ListenRoundTwoDecisionOutcome {
  if (approvedCandidateIds.length > 0) {
    // Approval is not promotion. A round that approved candidates but could not
    // separate them, or whose winner was not materially better than the
    // incumbent, keeps the default and says so.
    return selection?.promotedProfileId != null
      ? "promoted-candidate"
      : "approved-without-material-improvement";
  }
  return eligibility.runStatus === "completed"
    ? "round-two-candidate-set-exhausted"
    : "round-two-grid-produced-no-eligible-improvement";
}

function ablationConclusions(
  evidence: ListenRoundTwoReproducedEvidence,
): ListenRoundTwoAblationConclusion[] {
  return evidence.ablations.map((ablation: ListenRoundTwoReproducedAblation) => ({
    ablation: ablation.ablation,
    selectedProfileIds: [...ablation.selectedProfileIds],
    stopSatisfied: ablation.stop.satisfied,
    stopReasons: [...ablation.stop.reasons],
    // Registrable means the round could have searched candidates from it: the
    // stop rule accepted it *and* it is the accepted ablation the chain names.
    // An ablation that selected profiles and was refused is recorded as what it
    // was, so the conclusion can report what was found rather than implying
    // nothing was.
    registrable: ablation.stop.satisfied && evidence.acceptedAblation === ablation.ablation,
  }));
}

/**
 * The two facts about the rollout that no artifact can state about itself.
 *
 * An approved-profile list can be internally consistent and still describe a
 * rollout that did not happen, so both are checked against this commit rather
 * than against the record: the identifier production actually resolves must be
 * the one the decision selects, and the list production would offer must be the
 * list the evidence approved. Without the first, the artifact could announce a
 * promotion the registry never made; without the second, the constant a later
 * calibration path reads could drift from the evidence that approved it.
 */
export function listenRoundTwoRolloutProblems(options: {
  approvedProfileIds: readonly string[];
  selectedDefaultProfileId: string;
  productionDefaultProfileId: string;
  shippedApprovedProfileIds?: readonly string[];
}): string[] {
  const problems: string[] = [];
  const shipped = options.shippedApprovedProfileIds ?? LISTEN_ROUND_TWO_APPROVED_PROFILE_IDS;
  if (options.productionDefaultProfileId !== options.selectedDefaultProfileId) {
    problems.push(
      `The decision selects ${options.selectedDefaultProfileId} and production resolves ` +
        `${options.productionDefaultProfileId}; the artifact may not describe a rollout the ` +
        "code did not perform.",
    );
  }
  if (!sameCanonical([...options.approvedProfileIds], [...shipped])) {
    problems.push(
      `The evidence approves [${options.approvedProfileIds.join(", ")}], and this commit ships ` +
        `[${shipped.join(", ")}]; the offered list must be the list the evidence produced.`,
    );
  }
  return problems;
}

/**
 * The ranking's automated half, rederived from every archived repetition.
 *
 * Both repetitions must produce identical measurements. A ranking supported by
 * one archive is a ranking of one run, and the round's own identity rule requires
 * two; a promoted default chosen from measurements the repetition does not
 * reproduce is exactly the result that rule exists to catch.
 */
function automatedMeasurements(
  archives: readonly unknown[] | undefined,
  profileIds: readonly string[],
) {
  if (archives === undefined || archives.length < 2) {
    throw new Error(
      "Ranking approved candidates needs both archived confirmation repetitions; the frozen " +
        "ordered rule is applied to measurements, not to one run's summary.",
    );
  }
  const measurements = archives
    .map((archive) => listenRoundTwoAutomatedMeasurements({ archive, profileIds }));
  const [first, ...rest] = measurements;
  for (const [index, other] of rest.entries()) {
    if (!sameCanonical(first, other)) {
      throw new Error(
        `Confirmation repetition ${index + 2} measures the ranking differently than repetition 1.`,
      );
    }
  }
  return first;
}

export interface ListenRoundTwoProductionDecision {
  record: ListenRoundTwoApprovedProfileList;
  eligibility: ListenRoundTwoEligibilityManifest;
  candidateManifest: ListenRoundTwoCandidateManifest;
  reproducedEvidence: ListenRoundTwoReproducedEvidence[];
}

/**
 * Makes the round's production decision from the committed chain.
 *
 * The chain is resolved by rerunning it before any conclusion is derived. Both
 * archived Task 26 repetitions are recomputed under Task 24's frozen stop rule
 * and must agree; the committed Task 27 record must be what that rerun
 * re-derives; the committed Task 28 record must be what the Task 28 emitter
 * reproduces from it on the not-run branch, or must satisfy the whole chain's
 * cross-artifact agreement on the completed one.
 *
 * The selected default is nobody's choice to supply. Live results are rederived
 * from Task 15's archives, membership from those results, and the default from
 * the frozen ordered rule applied to the live and confirmation measurements — so
 * the only identifier the caller provides is the one production actually resolves,
 * and the decision refuses to describe a rollout the code did not perform.
 */
export function listenRoundTwoProductionDecision(options: {
  eligibility: unknown;
  candidateManifest: unknown;
  evidenceRepetitions: readonly unknown[];
  /** Task 15's archived sessions, with the bytes they were read from. */
  liveArchives?: readonly unknown[];
  liveArchiveReferences?: readonly ListenRoundTwoLiveArchiveReference[];
  /** The two archived confirmation repetitions the completed branch ranks from. */
  confirmationArchives?: readonly unknown[];
  productionDefaultProfileId?: ListenMatcherProfileId;
  modelEvidenceRequirementSha256?: string;
  traceManifest?: ListenTraceManifest;
}): ListenRoundTwoProductionDecision {
  const schema = listenRoundTwoEligibilityManifestProblems(options.eligibility);
  if (schema.length > 0) throw new Error(schema.join(" "));
  const eligibility = options.eligibility as ListenRoundTwoEligibilityManifest;

  const { manifest: candidateManifest, reproductions } =
    listenRoundTwoCandidateManifestFromRepetitions({
      evidenceRepetitions: options.evidenceRepetitions,
    });
  if (!sameCanonical(options.candidateManifest, candidateManifest)) {
    throw new Error(
      "The committed Task 27 candidate manifest is not the record this commit's Task 26 " +
        "archives re-derive, so the chain is broken rather than extendable.",
    );
  }
  const [reproducedEvidence, ...otherReproductions] = reproductions;
  for (const [index, other] of otherReproductions.entries()) {
    if (!sameCanonical(reproducedEvidence.ablations, other.ablations)) {
      throw new Error(
        `Task 26 repetition ${index + 2} reruns to different ablation verdicts than repetition 1.`,
      );
    }
  }
  if (eligibility.runStatus === "not-run-no-confirmable-candidate") {
    // The not-run branch is reproducible end to end, so it is reproduced: the
    // committed record must be exactly what Task 28's emitter re-derives from
    // this commit's archives and this commit's corpus.
    const emission = listenRoundTwoEligibilityManifest({
      candidateManifest: options.candidateManifest,
      evidenceRepetitions: options.evidenceRepetitions,
      traceManifest: options.traceManifest,
    });
    assertListenRoundTwoEligibilityManifestUnchanged(eligibility, emission.manifest);
  }
  const chain = listenRoundTwoArtifactChainProblems({
    eligibility,
    candidateManifest: options.candidateManifest,
    reproducedEvidence,
  });
  if (chain.length > 0) throw new Error(chain.join(" "));

  // Live gates are measured, never reported: each candidate's result is rederived
  // from the archived acoustic and digital trials before membership is decided.
  const liveArchives = options.liveArchives ?? [];
  const { results: liveResults, problems: liveProblems } = listenRoundTwoLiveResults({
    eligibility,
    eligibilityManifestDigest: listenRoundTwoEligibilityManifestDigest(eligibility),
    archives: liveArchives,
  });
  if (liveProblems.length > 0) throw new Error(liveProblems.join(" "));
  const approvedProfileIds = listenRoundTwoApprovedProfileIds({ eligibility, liveResults });
  const approvedCandidateIds = approvedProfileIds
    .filter((profileId) => profileId !== LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID);

  // The default comes out of the frozen ordered rule applied to the same
  // archives, so no step of it is a preference expressed here.
  const selection = approvedCandidateIds.length === 0
    ? undefined
    : listenRoundTwoSelectDefault({
      approvedCandidateProfileIds: approvedCandidateIds,
      live: listenRoundTwoLiveMeasurements({
        archives: liveArchives as never,
        profileIds: approvedCandidateIds,
      }),
      automated: automatedMeasurements(options.confirmationArchives, approvedCandidateIds),
      confirmationArchive: (options.confirmationArchives ?? [])[0],
    });
  const selectedDefaultProfileId = selection?.selectedProfileId ??
    LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID;
  const outcome = decisionOutcome(eligibility, approvedCandidateIds, selection);
  const rollout = listenRoundTwoRolloutProblems({
    approvedProfileIds,
    selectedDefaultProfileId,
    productionDefaultProfileId: options.productionDefaultProfileId ??
      DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  });
  if (rollout.length > 0) throw new Error(rollout.join(" "));

  const repeatedChordResult: ListenRoundTwoRepeatedChordEntry[] =
    eligibility.runStatus === "completed"
      ? eligibility.entries.map(({
        profileId,
        repeatedRecoveryOutcome,
        confirmationReproductionStatus,
      }) => ({ profileId, repeatedRecoveryOutcome, confirmationReproductionStatus }))
      : [];
  const requiresRequirement = listenRoundTwoRequiresModelEvidenceRequirement({
    outcome,
    selectedDefaultProfileId,
    repeatedChordResult,
  });
  if (requiresRequirement && !SHA256_PATTERN.test(options.modelEvidenceRequirementSha256 ?? "")) {
    throw new Error(
      "This round does not resolve the recorded missing re-onset, so it must carry the " +
        `decoder/model-evidence requirement at ${LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE}, ` +
        "referenced by content digest.",
    );
  }
  const record = {
    name: LISTEN_ROUND_TWO_APPROVED_PROFILES_NAME,
    formatVersion: 1,
    roundId: LISTEN_ROUND_TWO_ROUND_ID,
    outcome,
    reason: eligibility.runStatus === "not-run-no-confirmable-candidate"
      ? eligibility.reason
      : null,
    selectedDefaultProfileId,
    incumbentProfileId: LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID,
    approvedProfileIds,
    eligibilityRunStatus: eligibility.runStatus,
    eligibilityManifestDigest: listenRoundTwoEligibilityManifestDigest(eligibility),
    candidateManifestDigest: listenRoundTwoCandidateManifestDigest(candidateManifest),
    task26TerminalOutcome: eligibility.task26TerminalOutcome,
    task26EvidenceDigest: eligibility.task26EvidenceDigest,
    liveCorpus: liveResults.length > 0
      ? {
        status: "collected" as const,
        archives: [...(options.liveArchiveReferences ?? [])],
        results: liveResults,
      }
      : { status: "not-collected" as const, results: [] },
    repeatedChordResult,
    confirmationPartition: { ...eligibility.confirmationPartition },
    ablations: ablationConclusions(reproducedEvidence),
    ...(selection === undefined ? {} : { selection }),
    ...(requiresRequirement
      ? {
        modelEvidenceRequirement: {
          path: LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE,
          sha256: options.modelEvidenceRequirementSha256!,
        },
      }
      : {}),
  };
  const listRecord = {
    ...record,
    digest: { algorithm: "fnv1a-32-canonical-json" as const, value: canonicalDigest(record) },
  } as ListenRoundTwoApprovedProfileList;
  const problems = listenRoundTwoApprovedProfilesProblems({
    record: listRecord,
    eligibility,
    candidateManifest,
    liveArchives,
    confirmationArchives: options.confirmationArchives,
  });
  if (problems.length > 0) throw new Error(problems.join(" "));
  return {
    record: listRecord,
    eligibility,
    candidateManifest,
    reproducedEvidence: reproductions,
  };
}

/* ------------------------------------------------------------------------- *
 * Validation
 * ------------------------------------------------------------------------- */

function keyProblems(
  record: Record<string, unknown>,
  expected: readonly string[],
  where: string,
): string[] {
  const problems: string[] = [];
  for (const key of expected) {
    if (!Object.hasOwn(record, key)) problems.push(`${where} is missing ${key}.`);
  }
  for (const key of Object.keys(record)) {
    if (!expected.includes(key)) problems.push(`${where} carries forbidden field ${key}.`);
  }
  return problems;
}

/**
 * Everything that must be true of an approved-profile list, including its links.
 *
 * The membership rule is recomputed from the eligibility manifest and the live
 * results the record itself carries, rather than compared to the list it states,
 * so a record that names an approved profile its own evidence does not approve
 * fails here. Both digest links are recomputed from the referenced records for
 * the same reason.
 */
export function listenRoundTwoApprovedProfilesProblems(options: {
  record: unknown;
  eligibility: unknown;
  candidateManifest: unknown;
  /** Required whenever the record states live results; they are recomputed from these. */
  liveArchives?: readonly unknown[];
  /** Required whenever the record promotes or ranks; the ranking is recomputed from these. */
  confirmationArchives?: readonly unknown[];
}): string[] {
  const { record } = options;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return ["The approved-profile list is one record, not a list."];
  }
  const list = record as Record<string, unknown>;
  const problems: string[] = [];
  problems.push(...keyProblems(
    list,
    [
      ...LISTEN_ROUND_TWO_APPROVED_PROFILES_KEYS,
      ...(Object.hasOwn(list, "selection") ? ["selection"] : []),
      ...(Object.hasOwn(list, "modelEvidenceRequirement") ? ["modelEvidenceRequirement"] : []),
    ],
    "The approved-profile list",
  ));
  if (list.name !== LISTEN_ROUND_TWO_APPROVED_PROFILES_NAME) {
    problems.push(`The approved-profile list names ${JSON.stringify(list.name)}.`);
  }
  if (list.formatVersion !== 1) {
    problems.push(`The approved-profile list is at format version ${list.formatVersion}.`);
  }
  if (list.roundId !== LISTEN_ROUND_TWO_ROUND_ID) {
    problems.push(`The approved-profile list belongs to round ${JSON.stringify(list.roundId)}.`);
  }
  const outcome = list.outcome as ListenRoundTwoDecisionOutcome;
  if (!LISTEN_ROUND_TWO_DECISION_OUTCOMES.includes(outcome)) {
    problems.push(`The approved-profile list records outcome ${JSON.stringify(outcome)}.`);
  }
  for (const field of ["eligibilityManifestDigest", "candidateManifestDigest",
    "task26EvidenceDigest"] as const) {
    if (typeof list[field] !== "string" || !DIGEST_PATTERN.test(list[field] as string)) {
      problems.push(`The approved-profile list's ${field} is not a digest.`);
    }
  }
  const approved = Array.isArray(list.approvedProfileIds) ? list.approvedProfileIds : null;
  if (approved === null) {
    problems.push("The approved-profile list carries no membership list.");
  } else {
    if (!approved.includes(LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID)) {
      problems.push(
        `The approved-profile list omits ${LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID}, which every ` +
          "branch approves as the measured incumbent.",
      );
    }
    if (new Set(approved).size !== approved.length) {
      problems.push("The approved-profile list names a profile twice.");
    }
    for (const profileId of approved) {
      if (!isListenMatcherProfileId(profileId)) {
        problems.push(`The approved-profile list names ${JSON.stringify(profileId)}, which is ` +
          "not a registry identifier.");
      }
    }
    if (!approved.includes(list.selectedDefaultProfileId)) {
      problems.push(
        `The selected default ${JSON.stringify(list.selectedDefaultProfileId)} is not a member ` +
          "of the list it heads.",
      );
    }
  }
  if (list.incumbentProfileId !== LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID) {
    problems.push(
      `The approved-profile list records incumbent ${JSON.stringify(list.incumbentProfileId)}.`,
    );
  }
  if (outcome !== "promoted-candidate" &&
      list.selectedDefaultProfileId !== LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID) {
    problems.push(
      `The round promoted nothing and records default ` +
        `${JSON.stringify(list.selectedDefaultProfileId)}.`,
    );
  }
  if (outcome === "promoted-candidate" &&
      list.selectedDefaultProfileId === LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID) {
    problems.push("The round records a promoted candidate and ends on the incumbent.");
  }

  const liveCorpus = list.liveCorpus as
    { status?: unknown; archives?: unknown; results?: unknown } | undefined;
  const liveResults = Array.isArray(liveCorpus?.results)
    ? liveCorpus.results as ListenRoundTwoLiveResult[]
    : null;
  if (liveResults === null) {
    problems.push("The approved-profile list records no live-corpus result list.");
  } else {
    const collected = liveResults.length > 0;
    if (liveCorpus?.status !== (collected ? "collected" : "not-collected")) {
      problems.push(
        `The live corpus reports status ${JSON.stringify(liveCorpus?.status)} with ` +
          `${liveResults.length} results.`,
      );
    }
    // The branches carry disjoint fields for the same reason the eligibility
    // manifest's do: an empty archive list on a corpus nobody collected is a
    // place for archive hashes that never existed.
    problems.push(...keyProblems(
      (liveCorpus ?? {}) as Record<string, unknown>,
      collected ? ["status", "archives", "results"] : ["status", "results"],
      "The live corpus",
    ));
    if (collected) {
      const archives = Array.isArray(liveCorpus?.archives)
        ? liveCorpus.archives as ListenRoundTwoLiveArchiveReference[]
        : null;
      if (archives === null || archives.length === 0) {
        problems.push("The live corpus states results and names no archive they came from.");
      } else {
        for (const [index, archive] of archives.entries()) {
          const where = `Live archive reference ${index}`;
          if (typeof archive?.path !== "string" || archive.path.length === 0) {
            problems.push(`${where} names no file.`);
          }
          if (!SHA256_PATTERN.test(archive?.sha256 ?? "")) {
            problems.push(`${where}'s sha256 is not a SHA-256.`);
          }
          if (typeof archive?.digest !== "string" || !DIGEST_PATTERN.test(archive.digest)) {
            problems.push(`${where}'s digest is not a digest.`);
          }
        }
      }
    }
    // Every status is recomputed from the gate rows beside it, so a `passed` no
    // gate supports fails here even before the archives are consulted.
    for (const result of liveResults) {
      if (typeof result?.profileId !== "string" || !Array.isArray(result?.gates) ||
          !Array.isArray(result?.setupCoverage)) {
        problems.push("A live-corpus result carries no profile, gates, or setup coverage.");
        continue;
      }
      const derived = listenRoundTwoLiveResultStatus(result);
      if (derived !== result.status) {
        problems.push(
          `The live corpus records ${result.profileId} as ${JSON.stringify(result.status)}, and ` +
            `its own gate rows produce ${derived}.`,
        );
      }
    }
  }

  const repeated = Array.isArray(list.repeatedChordResult)
    ? list.repeatedChordResult as ListenRoundTwoRepeatedChordEntry[]
    : null;
  if (repeated === null) {
    problems.push("The approved-profile list records no repeated-chord result.");
  }

  const requirement = list.modelEvidenceRequirement as
    ListenRoundTwoModelEvidenceRequirement | undefined;
  const owed = listenRoundTwoRequiresModelEvidenceRequirement({
    outcome,
    selectedDefaultProfileId: String(list.selectedDefaultProfileId),
    repeatedChordResult: repeated ?? [],
  });
  if (owed) {
    if (requirement === undefined) {
      problems.push(
        "This round does not resolve the recorded missing re-onset and carries no " +
          "decoder/model-evidence requirement.",
      );
    } else {
      if (requirement.path !== LISTEN_DECODER_EVIDENCE_REQUIREMENT_FILE) {
        problems.push(
          `The decoder/model-evidence requirement names ${JSON.stringify(requirement.path)}.`,
        );
      }
      if (!SHA256_PATTERN.test(requirement.sha256 ?? "")) {
        problems.push("The decoder/model-evidence requirement's sha256 is not a SHA-256.");
      }
    }
  } else if (requirement !== undefined) {
    problems.push(
      "The round promoted a confirmed full resolution and still carries a residual " +
        "decoder/model-evidence requirement.",
    );
  }

  const digest = list.digest as { algorithm?: unknown; value?: unknown } | undefined;
  const recomputed = listenRoundTwoApprovedProfilesDigest(list);
  if (digest?.algorithm !== "fnv1a-32-canonical-json") {
    problems.push(`The approved-profile list's digest algorithm is ${digest?.algorithm}.`);
  }
  if (digest?.value !== recomputed) {
    problems.push(
      `The approved-profile list records digest ${JSON.stringify(digest?.value)}, recomputed ` +
        `${recomputed}.`,
    );
  }

  problems.push(...chainProblems({
    list,
    eligibilityRecord: options.eligibility,
    candidateManifest: options.candidateManifest,
    liveResults,
    liveArchives: options.liveArchives,
    confirmationArchives: options.confirmationArchives,
  }));
  return problems;
}

/**
 * The third link, and the agreement the whole chain has to hold.
 *
 * Every digest is recomputed from the record it describes rather than read off
 * it, and the terminal outcome, the reason, and the run status must agree at each
 * step, so a chain whose artifacts each satisfy their own schema while disagreeing
 * with one another fails here rather than being reported as auditable.
 */
function chainProblems(options: {
  list: Record<string, unknown>;
  eligibilityRecord: unknown;
  candidateManifest: unknown;
  liveResults: readonly ListenRoundTwoLiveResult[] | null;
  liveArchives?: readonly unknown[];
  confirmationArchives?: readonly unknown[];
}): string[] {
  const { list, eligibilityRecord, candidateManifest, liveResults } = options;
  const problems = listenRoundTwoEligibilityManifestProblems(eligibilityRecord);
  if (problems.length > 0) return problems;
  const eligibility = eligibilityRecord as ListenRoundTwoEligibilityManifest;
  const eligibilityDigest = listenRoundTwoEligibilityManifestDigest(eligibility);
  if (list.eligibilityManifestDigest !== eligibilityDigest) {
    problems.push(
      `The approved-profile list chains to eligibility manifest ` +
        `${JSON.stringify(list.eligibilityManifestDigest)}, and that record hashes to ` +
        `${eligibilityDigest}.`,
    );
  }
  const candidateDigest = listenRoundTwoCandidateManifestDigest(candidateManifest);
  if (list.candidateManifestDigest !== candidateDigest) {
    problems.push(
      `The approved-profile list chains to candidate manifest ` +
        `${JSON.stringify(list.candidateManifestDigest)}, and that record hashes to ` +
        `${candidateDigest}.`,
    );
  }
  if (eligibility.candidateManifestDigest !== candidateDigest) {
    problems.push(
      `The eligibility manifest chains to candidate manifest ` +
        `${JSON.stringify(eligibility.candidateManifestDigest)}, and that record hashes to ` +
        `${candidateDigest}.`,
    );
  }
  if (list.eligibilityRunStatus !== eligibility.runStatus) {
    problems.push(
      `The approved-profile list records run status ` +
        `${JSON.stringify(list.eligibilityRunStatus)}, and the eligibility manifest records ` +
        `${JSON.stringify(eligibility.runStatus)}.`,
    );
  }
  for (const field of ["task26TerminalOutcome", "task26EvidenceDigest"] as const) {
    if (list[field] !== eligibility[field]) {
      problems.push(
        `The chain disagrees about ${field}: ${JSON.stringify(list[field])} against ` +
          `${JSON.stringify(eligibility[field])}.`,
      );
    }
  }
  if (!sameCanonical(list.confirmationPartition, eligibility.confirmationPartition)) {
    problems.push(
      "The approved-profile list's confirmation partition is not the one the eligibility " +
        "manifest measured.",
    );
  }
  const expectedReason = eligibility.runStatus === "not-run-no-confirmable-candidate"
    ? eligibility.reason
    : null;
  if (list.reason !== expectedReason) {
    problems.push(
      `The approved-profile list records reason ${JSON.stringify(list.reason)}, and the ` +
        `eligibility manifest records ${JSON.stringify(expectedReason)}.`,
    );
  }
  if (eligibility.runStatus === "not-run-no-confirmable-candidate") {
    // The not-run branch spent no confirmation evidence and collected no live
    // corpus, so a live result here is evidence of a corpus the branch forbids.
    if ((liveResults?.length ?? 0) > 0) {
      problems.push(
        "The not-run branch confirmed no candidate, and a live corpus was collected for one.",
      );
    }
    if (eligibility.confirmationPartition.decodedTraceCount !== 0) {
      problems.push(
        `The not-run branch decoded ${eligibility.confirmationPartition.decodedTraceCount} ` +
          "confirmation traces.",
      );
    }
  }
  // The live results are recomputed from the archives the record names, so a
  // stated gate outcome is checked against the trials that produced it rather
  // than against itself. A collected corpus with no archives to read is refused:
  // an unverifiable live result approves a profile on its own say-so.
  let liveEvidence = liveResults ?? [];
  if ((liveResults?.length ?? 0) > 0) {
    if (options.liveArchives === undefined) {
      problems.push(
        "The approved-profile list states live results, and the archives they were derived " +
          "from were not supplied for verification.",
      );
      return problems;
    }
    const rederived = listenRoundTwoLiveResults({
      eligibility,
      eligibilityManifestDigest: eligibilityDigest,
      archives: options.liveArchives,
    });
    problems.push(...rederived.problems);
    if (rederived.problems.length > 0) return problems;
    if (!sameCanonical(liveResults, rederived.results)) {
      problems.push(
        "The approved-profile list's live results are not what its own archives produce.",
      );
      return problems;
    }
    liveEvidence = rederived.results;
  }
  // The membership rule, recomputed rather than compared to what was stated.
  let derived: string[];
  try {
    derived = listenRoundTwoApprovedProfileIds({ eligibility, liveResults: liveEvidence });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return problems;
  }
  const derivedCandidateIds = derived
    .filter((profileId) => profileId !== LISTEN_ROUND_TWO_INCUMBENT_PROFILE_ID);
  // The selected default is rederived from the frozen ordered rule over the same
  // archives, so a promoted identifier that the rule does not produce — the top
  // of a sweep, a caller's preference, a tie resolved by hand — fails here.
  let selection: ListenRoundTwoSelection | undefined;
  if (derivedCandidateIds.length > 0) {
    try {
      selection = listenRoundTwoSelectDefault({
        approvedCandidateProfileIds: derivedCandidateIds,
        live: listenRoundTwoLiveMeasurements({
          archives: (options.liveArchives ?? []) as never,
          profileIds: derivedCandidateIds,
        }),
        automated: automatedMeasurements(options.confirmationArchives, derivedCandidateIds),
        confirmationArchive: (options.confirmationArchives ?? [])[0],
      });
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return problems;
    }
    if (!sameCanonical(list.selection, selection)) {
      problems.push(
        "The approved-profile list's selection record is not what the frozen ordered rule " +
          "produces from its own archives.",
      );
    }
    if (list.selectedDefaultProfileId !== selection.selectedProfileId) {
      problems.push(
        `The approved-profile list selects ` +
          `${JSON.stringify(list.selectedDefaultProfileId)}, and the frozen ordered rule ` +
          `produces ${selection.selectedProfileId}.`,
      );
    }
  } else if (list.selection !== undefined) {
    problems.push(
      "The approved-profile list carries a selection record for a round that approved no " +
        "candidate to rank.",
    );
  }
  // The bounded conclusion is recomputed from the branch, the membership its own
  // evidence produces, and whether the rule promoted. A not-run round that
  // relabelled itself `round-two-candidate-set-exhausted` would claim its
  // candidate set was tried, over confirmation fixtures it never decoded.
  const derivedOutcome = decisionOutcome(eligibility, derivedCandidateIds, selection);
  if (list.outcome !== derivedOutcome) {
    problems.push(
      `The approved-profile list records outcome ${JSON.stringify(list.outcome)}, and its own ` +
        `evidence produces ${derivedOutcome}.`,
    );
  }
  if (!sameCanonical(list.approvedProfileIds, derived)) {
    problems.push(
      `The approved-profile list states [${(list.approvedProfileIds as string[] ?? []).join(", ")}]` +
        `, and its own evidence approves [${derived.join(", ")}].`,
    );
  }
  const repeated = (list.repeatedChordResult ?? []) as ListenRoundTwoRepeatedChordEntry[];
  const entries: readonly ListenRoundTwoEligibilityEntry[] =
    eligibility.runStatus === "completed" ? eligibility.entries : [];
  const copied = entries.map(({
    profileId,
    repeatedRecoveryOutcome,
    confirmationReproductionStatus,
  }) => ({ profileId, repeatedRecoveryOutcome, confirmationReproductionStatus }));
  if (!sameCanonical(repeated, copied)) {
    problems.push(
      "The approved-profile list's repeated-chord result is not a copy of the eligibility " +
        "manifest's own labels.",
    );
  }
  return problems;
}

/**
 * The immutability rule, applied at the point of re-emission.
 *
 * The approved-profile list is the last link of a frozen chain, so a second
 * emission may reproduce it and may not revise it. A later decision — a promoted
 * profile, a collected live corpus, a different bounded conclusion — belongs to
 * the round that measured it and emits that round's own artifacts.
 */
export function assertListenRoundTwoApprovedProfilesUnchanged(
  existing: unknown,
  emitted: ListenRoundTwoApprovedProfileList,
): void {
  if (!sameCanonical(existing, emitted)) {
    throw new Error(
      "The frozen round-two approved-profile list is immutable, and this emission differs from it.",
    );
  }
}
