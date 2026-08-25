/**
 * Task 27: the round-two candidate manifest, the first link of the round's
 * immutable artifact chain.
 *
 * Task 26 recorded `bass-axis-unsupported` in its grid-failed form, so this
 * round takes the zero branch: nothing is searched, no `v3` identifier is added,
 * the registry stays at version 2 byte-identical, and the manifest is emitted
 * with an empty candidate list. That is a result, not a gap — Task 29 reads the
 * reason code recorded here and must be able to tell the two zero-branch forms
 * apart.
 *
 * Nothing here reads a recorded conclusion. The branch, the reason code, the
 * terminal outcome, every stop verdict and every matched-pair support decision
 * are recomputed from the archived per-run measurements under Task 24's frozen
 * policy, and a Task 26 artifact whose stored verdicts do not follow from its own
 * evidence is refused rather than summarized.
 *
 * The manifest records candidacy only. It carries no eligibility field: Task 28
 * emits a separate artifact that references this manifest's digest.
 */

import {
  DEFAULT_LISTEN_MATCHER_PROFILE_ID,
  FIXED_LISTEN_MATCHER_POLICY,
  LISTEN_MATCHER_PROFILES,
  LISTEN_MATCHER_PROFILE_IDS,
  LISTEN_MATCHER_REGISTRY_VERSION,
  listenMatcherThresholds,
  type FixedListenMatcherPolicy,
  type ListenMatcherThresholds,
} from "./listenMatcherProfiles";
import {
  LISTEN_MATCHER_SELECTION_POLICY,
  LISTEN_MATCHER_SELECTION_POLICY_HASH,
  assertValidListenMatcherSelectionPolicy,
  evaluateListenAblationStop,
  evaluateListenBassAxisPairSupport,
  type ListenAblationStopResult,
  type ListenBassAxisPairSupportResult,
  type ListenRepeatedRecoveryEvaluation,
} from "./listenMatcherSelectionPolicy";
import {
  listenProductionThresholdShapeExcludesBassAxis,
  listenRoundTwoAblationEvidenceDigest,
  listenRoundTwoRepeatedGroups,
  listenRoundTwoRepeatedProfileReport,
  listenRoundTwoTerminalOutcome,
  type ListenRoundTwoAblationResult,
  type ListenRoundTwoRepeatedGroup,
  type ListenRoundTwoRepeatedMeasurement,
  type ListenRoundTwoTerminalOutcome,
} from "./listenRoundTwoAblationBenchmark";
import {
  LISTEN_ROUND_TWO_GENERATOR_VERSION,
  type ListenRoundTwoAblationId,
} from "./listenRoundTwoGenerator";
import {
  DeterministicHasher,
  LISTEN_TRACE_CORPUS_HASH,
  LISTEN_TRACE_MANIFEST_HASH,
  LISTEN_TRACE_MANIFEST_VERSION,
} from "./listenTraceManifest";

/** The round this manifest belongs to. Round one's artifacts are never amended. */
export const LISTEN_ROUND_TWO_ROUND_ID = "round-two";

export const LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME = "listen-round-two-candidate-manifest";

/**
 * The committed round-two artifact paths, declared beside the code that derives
 * them rather than inside a command entry point.
 *
 * Task 28's emitter needs the same three files, and importing them from the
 * Task 27 command would bundle that command's `main` into a second entry point,
 * where its self-invocation guard fires on the bundle's own module URL and runs
 * the Task 27 emission as a side effect of the Task 28 one.
 */
export const LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS: readonly string[] = Object.freeze([
  "benchmark-results/listen-round-two-ablation-task26-run1.json",
  "benchmark-results/listen-round-two-ablation-task26-run2.json",
]);

export const LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE =
  "benchmark-results/listen-round-two-candidate-manifest-task27.json";

/**
 * The registry version the round-two search measured against.
 *
 * The zero branch registers nothing, so the registry may not have moved past
 * this version by the time the manifest is emitted. Pinning it here rather than
 * reading `LISTEN_MATCHER_REGISTRY_VERSION` into the record unchecked is what
 * makes "the registry is untouched" a condition of emission instead of a
 * description of it.
 */
export const LISTEN_ROUND_TWO_SEARCH_REGISTRY_VERSION = 2;

/**
 * The identity of the registry generation the round-two search measured against.
 *
 * The zero branch registers nothing, so this digest may not move: it covers the
 * registry version, the default identifier, the shared fixed policy, and every
 * profile's complete threshold set in registry order. A changed `v1` or `v2`
 * threshold, a reordered identifier list, or an added entry all move it, which is
 * what "every registry entry stays byte-identical" has to mean to be enforceable.
 * Moving it deliberately is a new round, not a re-emission of this manifest.
 */
export const LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST = "d1b3f6a3";

/**
 * The two zero-branch forms, which are materially different findings.
 *
 * `no-ablation-accepted` means the stop rule accepted no ablation at all.
 * `no-supported-parameterization` means it accepted a grid whose only selected
 * profiles depend on a parameterization the round left unsupported. Task 29 must
 * not describe the second as discovery having selected nothing.
 */
export type ListenRoundTwoCandidateNotRunReason =
  | "no-ablation-accepted"
  | "no-supported-parameterization";

export type ListenRoundTwoCandidateBranch = "zero" | "nonempty";

/**
 * One ablation as recomputed from its own archived measurements.
 *
 * `stop` here is never the file's stored verdict: it is `evaluateListenAblationStop`
 * applied to repeated-recovery evaluations rebuilt from both sides of every
 * archived comparison.
 */
export interface ListenRoundTwoReproducedAblation {
  ablation: ListenRoundTwoAblationId;
  selectedProfileIds: string[];
  stop: ListenAblationStopResult;
  matchedPairs: Array<{
    axisProfileId: string;
    twinProfileId: string;
    support: ListenBassAxisPairSupportResult;
  }>;
}

/** Everything Task 27 branches on, all of it recomputed rather than read. */
export interface ListenRoundTwoReproducedEvidence {
  digest: string;
  terminalOutcome: ListenRoundTwoTerminalOutcome;
  terminalOutcomeReason: string;
  ablations: ListenRoundTwoReproducedAblation[];
  acceptedAblation: ListenRoundTwoAblationId | null;
  branch: ListenRoundTwoCandidateBranch;
  notRunReason: ListenRoundTwoCandidateNotRunReason | null;
}

/**
 * The frozen candidate manifest.
 *
 * Both branches emit this one shape, so every downstream consumer reads one
 * schema; the zero branch differs only in holding an empty candidate list and a
 * non-null `notRunReason`. The terminal outcome and the reason code are inside
 * this record's own digest, over the Task 26 evidence digest they were derived
 * from: a reason that first appeared downstream could be relabelled from
 * `no-supported-parameterization` to `no-ablation-accepted` with every digest
 * still verifying.
 */
export interface ListenRoundTwoCandidateManifest {
  name: typeof LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME;
  formatVersion: 1;
  roundId: typeof LISTEN_ROUND_TWO_ROUND_ID;
  /** Registry identifiers only. Empty on the zero branch, never null. */
  candidateProfileIds: readonly string[];
  registryVersion: number;
  /** The identity of the whole registry generation this round left untouched. */
  registryDigest: string;
  policyVersion: number;
  policyHash: string;
  traceManifestVersion: number;
  traceManifestHash: string;
  traceManifestCorpusHash: string;
  generatorVersion: number;
  /** The ablation the candidates were searched from; null when none was accepted. */
  ablationId: ListenRoundTwoAblationId | null;
  task26TerminalOutcome: ListenRoundTwoTerminalOutcome;
  task26EvidenceDigest: string;
  notRunReason: ListenRoundTwoCandidateNotRunReason | null;
  digest: {
    algorithm: "fnv1a-32-canonical-json";
    value: string;
  };
}

/* ------------------------------------------------------------------------- *
 * Reading a Task 26 artifact without trusting it
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

/**
 * The one Task 26 record a repetition file holds.
 *
 * A file with two records, or none, is not a repetition of the staged search,
 * and reading the first of several would let an appended record decide the
 * round.
 */
export function listenRoundTwoAblationEvidenceRecord(
  evidence: unknown,
): ListenRoundTwoAblationResult {
  const records = Array.isArray(evidence) ? evidence : [evidence];
  if (records.length !== 1) {
    throw new Error(`Task 26 evidence must hold exactly one record, not ${records.length}.`);
  }
  const [record] = records as [Record<string, unknown>];
  if (typeof record !== "object" || record === null) {
    throw new Error("Task 26 evidence is not a record.");
  }
  if (record.name !== "listen-round-two-ablation" || record.formatVersion !== 1) {
    throw new Error(
      `Task 26 evidence names ${JSON.stringify(record.name)} at format version ` +
        `${JSON.stringify(record.formatVersion)}.`,
    );
  }
  return record as unknown as ListenRoundTwoAblationResult;
}

function measurementsByGroup(
  measurements: readonly ListenRoundTwoRepeatedMeasurement[] | undefined,
  census: readonly ListenRoundTwoRepeatedGroup[],
  what: string,
): Map<string, ListenRoundTwoRepeatedMeasurement> {
  const rows = measurements ?? [];
  const byGroup = new Map(rows.map((row) => [row.groupId, row]));
  // A missing reference row reads as an unrecovered incumbent and turns any
  // candidate recovery into a categorical material gain, so an incomplete side
  // of a comparison is refused rather than evaluated.
  const missing = census.filter(({ groupId }) => !byGroup.has(groupId));
  if (missing.length > 0 || byGroup.size !== rows.length || rows.length !== census.length) {
    throw new Error(
      `${what} does not archive one measurement per repeated-chord group ` +
        `(missing ${JSON.stringify(missing.map(({ groupId }) => groupId))}).`,
    );
  }
  return byGroup;
}

function reproduceEvaluation(options: {
  census: readonly ListenRoundTwoRepeatedGroup[];
  reference: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>;
  candidate: ReadonlyMap<string, ListenRoundTwoRepeatedMeasurement>;
  profileId: string;
  comparedAgainstProfileId: string;
  recorded: ListenRepeatedRecoveryEvaluation | undefined;
  what: string;
}): ListenRepeatedRecoveryEvaluation {
  const report = listenRoundTwoRepeatedProfileReport({
    groups: options.census,
    reference: options.reference,
    candidate: options.candidate,
    profileId: options.profileId,
    comparedAgainstProfileId: options.comparedAgainstProfileId,
  });
  if (!sameCanonical(report.evaluation, options.recorded)) {
    throw new Error(
      `${options.what} records a repeated-recovery evaluation that does not follow from its own ` +
        "archived measurements.",
    );
  }
  // Reading confirmation evidence in the selection path is the one failure this
  // round cannot recover from, so it is checked on the recomputed evaluation
  // rather than on the file's copy of it.
  if (report.evaluation.confirmationReproductionStatus !== "not-run" ||
      report.evaluation.confirmedFullResolution) {
    throw new Error(`${options.what} read confirmation evidence during selection.`);
  }
  return report.evaluation;
}

/**
 * Recomputes a Task 26 artifact end to end and derives the branch Task 27 takes.
 *
 * Every value this returns is derived: the stop verdicts from the archived
 * per-run measurements, the matched-pair support from the ablation's own grid
 * rows rather than from the pair's copies of them, the terminal outcome from
 * those recomputed verdicts, and the evidence digest from the record itself.
 * Where the artifact states a conclusion, that conclusion is compared against
 * the recomputation and a disagreement throws.
 */
export function reproduceListenRoundTwoAblationEvidence(
  evidence: unknown,
): ListenRoundTwoReproducedEvidence {
  assertValidListenMatcherSelectionPolicy(LISTEN_MATCHER_SELECTION_POLICY);
  const record = listenRoundTwoAblationEvidenceRecord(evidence);
  if (record.generatorVersion !== LISTEN_ROUND_TWO_GENERATOR_VERSION) {
    throw new Error(
      `Task 26 evidence was staged by generator version ${record.generatorVersion}, and this ` +
        `commit's generator is version ${LISTEN_ROUND_TWO_GENERATOR_VERSION}.`,
    );
  }
  if (record.selectionPolicy?.version !== LISTEN_MATCHER_SELECTION_POLICY.version ||
      record.selectionPolicy?.hash !== LISTEN_MATCHER_SELECTION_POLICY_HASH) {
    throw new Error(
      "Task 26 evidence was measured under a different selection policy than this commit holds.",
    );
  }
  if (record.manifest?.version !== LISTEN_TRACE_MANIFEST_VERSION ||
      record.manifest?.hash !== LISTEN_TRACE_MANIFEST_HASH ||
      record.manifest?.corpusHash !== LISTEN_TRACE_CORPUS_HASH) {
    throw new Error(
      "Task 26 evidence was measured against a different trace manifest than this commit holds.",
    );
  }
  // The census is rebuilt from the fixtures rather than read from the file: a
  // narrowed census would let the hashed policy be applied to fewer strata than
  // it declares, which is an amendment rather than an application.
  const census = listenRoundTwoRepeatedGroups();
  if (!sameCanonical(record.repeatedChordCensus, census)) {
    throw new Error(
      "Task 26 evidence declares a repeated-chord census this commit's fixtures do not produce.",
    );
  }
  const digest = listenRoundTwoAblationEvidenceDigest(record);
  if (record.digest?.algorithm !== "fnv1a-32-canonical-json" || record.digest?.value !== digest) {
    throw new Error(
      `Task 26 evidence records digest ${JSON.stringify(record.digest?.value)}, recomputed ` +
        `${digest}.`,
    );
  }
  const ablations = Array.isArray(record.ablations) ? record.ablations : [];
  if (ablations.length === 0) throw new Error("Task 26 evidence records no ablation.");
  const reproduced = ablations.map((ablation): ListenRoundTwoReproducedAblation => {
    const what = `${ablation.ablation}`;
    if (ablation.confirmationTraceCountRead !== 0) {
      throw new Error(`${what} read ${ablation.confirmationTraceCountRead} confirmation traces.`);
    }
    const reference = measurementsByGroup(
      ablation.baselineRepeatedMeasurements,
      census,
      `${what}'s incumbent comparison`,
    );
    const selectedProfileIds = [...(ablation.selectedProfileIds ?? [])];
    const evaluations = new Map<string, ListenRepeatedRecoveryEvaluation>();
    for (const profileId of selectedProfileIds) {
      const report = (ablation.repeatedRecovery ?? [])
        .find((row) => row.profileId === profileId);
      if (report === undefined) {
        throw new Error(`${what} selected ${profileId} without archiving its recovery evidence.`);
      }
      evaluations.set(profileId, reproduceEvaluation({
        census,
        reference,
        candidate: measurementsByGroup(
          report.measurements,
          census,
          `${what}'s ${profileId} comparison`,
        ),
        profileId,
        comparedAgainstProfileId: report.comparedAgainstProfileId,
        recorded: report.evaluation,
        what: `${what} ${profileId}`,
      }));
    }
    const stop = evaluateListenAblationStop({
      selectedProfileIds,
      repeatedRecoveryByProfile: evaluations,
    });
    if (!sameCanonical(stop, ablation.stop)) {
      throw new Error(
        `${what} records stop verdict ${JSON.stringify(ablation.stop)}, recomputed ` +
          `${JSON.stringify(stop)}.`,
      );
    }
    const gridRows = new Map((ablation.domainRegret?.gridRows ?? []).map((row) => [
      row.profileId,
      row,
    ]));
    const matchedPairs = (ablation.matchedPairs ?? []).map((pair) => {
      const axisRow = gridRows.get(pair.axisProfileId);
      const twinRow = gridRows.get(pair.twinProfileId);
      if (axisRow === undefined || twinRow === undefined) {
        throw new Error(`${what} pairs a profile its own grid does not contain.`);
      }
      const evaluation = reproduceEvaluation({
        census,
        reference: measurementsByGroup(
          pair.twinRepeatedMeasurements,
          census,
          `${what}'s ${pair.twinProfileId} twin comparison`,
        ),
        candidate: measurementsByGroup(
          pair.repeatedRecoveryAgainstTwin?.measurements,
          census,
          `${what}'s ${pair.axisProfileId} axis comparison`,
        ),
        profileId: pair.axisProfileId,
        comparedAgainstProfileId: pair.twinProfileId,
        recorded: pair.repeatedRecoveryAgainstTwin?.evaluation,
        what: `${what} ${pair.axisProfileId} against ${pair.twinProfileId}`,
      });
      // An unsafe row carries no comparable regret, and the pair may not claim a
      // regret gain from its absence: the axis side falls back to zero and the
      // twin side to the axis's own value, which is the convention the pair was
      // measured under. The categorical safety rescue is evaluated separately.
      const axisWorstDomainRegret = axisRow.worstDomainRegret ?? 0;
      const support = evaluateListenBassAxisPairSupport({
        ablationStopSatisfied: stop.satisfied,
        axisProfileSelected: selectedProfileIds.includes(pair.axisProfileId),
        axisSafe: axisRow.safe,
        twinSafe: twinRow.safe,
        axisWorstDomainRegret,
        twinWorstDomainRegret: twinRow.worstDomainRegret ?? axisWorstDomainRegret,
        repeatedRecoveryAgainstTwin: evaluation,
      });
      if (support.supported !== pair.support?.supported ||
          !sameCanonical(support.reasons, pair.support?.reasons)) {
        throw new Error(
          `${what} records support ${JSON.stringify(pair.support)} for ${pair.axisProfileId} ` +
            `that does not follow from its own pair ${JSON.stringify(support)}.`,
        );
      }
      return {
        axisProfileId: pair.axisProfileId,
        twinProfileId: pair.twinProfileId,
        support,
      };
    });
    return { ablation: ablation.ablation, selectedProfileIds, stop, matchedPairs };
  });
  const { outcome, reason } = listenRoundTwoTerminalOutcome(reproduced);
  if (outcome !== record.terminalOutcome) {
    throw new Error(
      `Task 26 evidence records terminal outcome ${JSON.stringify(record.terminalOutcome)}, ` +
        `recomputed ${JSON.stringify(outcome)}.`,
    );
  }
  const acceptedAblation = reproduced.find(({ stop }) => stop.satisfied)?.ablation ?? null;
  const branch: ListenRoundTwoCandidateBranch = outcome === "bass-axis-unsupported"
    ? "zero"
    : "nonempty";
  return {
    digest,
    terminalOutcome: outcome,
    terminalOutcomeReason: reason,
    ablations: reproduced,
    acceptedAblation,
    branch,
    // Both zero-branch forms are reachable, and they are not the same finding.
    // The distinction is whether the stop rule accepted a grid at all, which is
    // recomputed above rather than read from the artifact.
    notRunReason: branch === "nonempty"
      ? null
      : acceptedAblation === null
      ? "no-ablation-accepted"
      : "no-supported-parameterization",
  };
}

/* ------------------------------------------------------------------------- *
 * Emitting the manifest
 * ------------------------------------------------------------------------- */

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/**
 * A registry, as the identity check reads it.
 *
 * The values are arguments rather than reads so the rule itself is testable: a
 * registry that has moved a threshold, reordered its identifiers, gained an
 * entry, moved its version or default, or let the experimental bass axis into the
 * production threshold shape has to fail the check, and asserting that in a test
 * requires being able to describe such a registry without shipping one.
 */
export interface ListenRoundTwoRegistryContent {
  version: number;
  profileIds: readonly string[];
  profiles: Readonly<Record<string, ListenMatcherThresholds>>;
  defaultProfileId: string;
  fixedPolicy: FixedListenMatcherPolicy;
}

/**
 * The identity of a whole registry generation, not a proxy for it.
 *
 * "Every registry entry stays byte-identical" is a claim about values, order, and
 * membership together, so the digest covers all three: the version, the default,
 * the fixed timing policy every profile shares, and each identifier in registry
 * order with its complete threshold set. Checking the version and the identifier
 * suffixes alone would accept a moved threshold, a reordered list, or a new
 * non-`v3` entry — each of which is a different registry claiming to be this one.
 */
export function listenRoundTwoRegistryDigest(registry: ListenRoundTwoRegistryContent): string {
  return canonicalDigest({
    version: registry.version,
    defaultProfileId: registry.defaultProfileId,
    fixedPolicy: { ...registry.fixedPolicy },
    profiles: registry.profileIds.map((id) => {
      const profile = registry.profiles[id];
      if (profile === undefined) throw new Error(`The registry has no profile ${id}.`);
      return { id, ...listenMatcherThresholds(profile) };
    }),
  });
}

export interface ListenRoundTwoRegistryState {
  version: number;
  profileIds: readonly string[];
  defaultProfileId: string;
  productionShapeExcludesBassAxis: boolean;
  digest: string;
}

/** This commit's registry, as the frozen manifest must find it. */
export function listenRoundTwoRegistryState(
  registry: ListenRoundTwoRegistryContent = {
    version: LISTEN_MATCHER_REGISTRY_VERSION,
    profileIds: LISTEN_MATCHER_PROFILE_IDS,
    profiles: LISTEN_MATCHER_PROFILES,
    defaultProfileId: DEFAULT_LISTEN_MATCHER_PROFILE_ID,
    fixedPolicy: FIXED_LISTEN_MATCHER_POLICY,
  },
  productionShapeExcludesBassAxis: boolean = listenProductionThresholdShapeExcludesBassAxis(),
): ListenRoundTwoRegistryState {
  return {
    version: registry.version,
    profileIds: registry.profileIds,
    defaultProfileId: registry.defaultProfileId,
    productionShapeExcludesBassAxis,
    digest: listenRoundTwoRegistryDigest(registry),
  };
}

/**
 * Everything about the registry that would make this manifest unfreezable.
 *
 * Both branches keep the default at `baseline-v1` and keep the unsupported bass
 * axis out of the production threshold shape. The zero branch additionally
 * registers nothing, so the registry it is frozen against must be the one the
 * search measured, entry for entry: the version, the digest of the whole
 * generation, and the absence of any `v3` identifier are all conditions of
 * emission. The digest is what makes "byte-identical" enforced rather than
 * asserted; the version and suffix checks are kept because they name the failure.
 */
export function listenRoundTwoRegistryProblems(
  branch: ListenRoundTwoCandidateBranch,
  registry: ListenRoundTwoRegistryState = listenRoundTwoRegistryState(),
): string[] {
  const problems: string[] = [];
  if (registry.defaultProfileId !== "baseline-v1") {
    problems.push(
      `Both branches keep the default at baseline-v1; it is ${registry.defaultProfileId}.`,
    );
  }
  if (!registry.productionShapeExcludesBassAxis) {
    problems.push("The production threshold shape carries the unsupported bass axis.");
  }
  if (branch === "zero") {
    if (registry.version !== LISTEN_ROUND_TWO_SEARCH_REGISTRY_VERSION) {
      problems.push(
        `The zero branch leaves the registry at version ` +
          `${LISTEN_ROUND_TWO_SEARCH_REGISTRY_VERSION}, and it is at version ${registry.version}.`,
      );
    }
    const registered = registry.profileIds.filter((id) => id.endsWith("-v3"));
    if (registered.length > 0) {
      problems.push(`The zero branch adds no v3 identifier; the registry holds ${registered}.`);
    }
    if (registry.digest !== LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST) {
      problems.push(
        `The zero branch leaves the searched registry byte-identical, and this one hashes to ` +
          `${registry.digest} rather than ${LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST}.`,
      );
    }
  }
  return problems;
}

/**
 * The manifest's field order and membership, declared once.
 *
 * Both branches emit this one schema; the zero branch differs only in the values
 * it fills. Naming the keys here lets a test hold the emitted record to the whole
 * schema rather than to the subset one branch happens to populate.
 */
export const LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_KEYS: readonly string[] = Object.freeze([
  "name",
  "formatVersion",
  "roundId",
  "candidateProfileIds",
  "registryVersion",
  "registryDigest",
  "policyVersion",
  "policyHash",
  "traceManifestVersion",
  "traceManifestHash",
  "traceManifestCorpusHash",
  "generatorVersion",
  "ablationId",
  "task26TerminalOutcome",
  "task26EvidenceDigest",
  "notRunReason",
  "digest",
]);

/**
 * Freezes the zero-branch candidate manifest from one Task 26 repetition.
 *
 * The zero branch registers nothing, so emission is refused if anything about the
 * registry has moved: a `v3` identifier, a bumped version, a moved default, a
 * production threshold shape that has gained the experimental bass axis, or any
 * change at all to the searched generation's own digest.
 *
 * A nonempty branch is refused outright rather than emitted from a caller's list.
 * The candidates that branch records must come from the search of the accepted
 * ablation and be registered as new `v3` identifiers at registry version 3, and
 * the manifest must be frozen against that search's own result archive. None of
 * that exists, because Task 26's evidence did not take this branch; accepting a
 * caller-supplied list here would let already-registered identifiers — including
 * round one's rejected `v2` candidates — be recorded as this round's selection
 * with nothing having selected them, which is the failure the zero branch's own
 * refusal exists to prevent.
 */
export function listenRoundTwoCandidateManifest(options: {
  evidence: unknown;
}): ListenRoundTwoCandidateManifest {
  const reproduced = reproduceListenRoundTwoAblationEvidence(options.evidence);
  if (reproduced.branch === "nonempty") {
    throw new Error(
      `Task 26 ended at ${reproduced.terminalOutcome}, which takes the nonempty branch: the ` +
        `search of ${reproduced.acceptedAblation} must run, freeze its own result archive, and ` +
        "register its selections as new v3 identifiers at registry version 3 before a manifest " +
        "can be frozen. This emitter only freezes the zero branch.",
    );
  }
  const candidateProfileIds: readonly string[] = [];
  const problems = listenRoundTwoRegistryProblems(reproduced.branch);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const manifest = {
    name: LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_NAME,
    formatVersion: 1,
    roundId: LISTEN_ROUND_TWO_ROUND_ID,
    candidateProfileIds,
    registryVersion: LISTEN_MATCHER_REGISTRY_VERSION,
    registryDigest: LISTEN_ROUND_TWO_SEARCH_REGISTRY_DIGEST,
    policyVersion: LISTEN_MATCHER_SELECTION_POLICY.version,
    policyHash: LISTEN_MATCHER_SELECTION_POLICY_HASH,
    traceManifestVersion: LISTEN_TRACE_MANIFEST_VERSION,
    traceManifestHash: LISTEN_TRACE_MANIFEST_HASH,
    traceManifestCorpusHash: LISTEN_TRACE_CORPUS_HASH,
    generatorVersion: LISTEN_ROUND_TWO_GENERATOR_VERSION,
    ablationId: reproduced.acceptedAblation,
    task26TerminalOutcome: reproduced.terminalOutcome,
    task26EvidenceDigest: reproduced.digest,
    notRunReason: reproduced.notRunReason,
  } as const;
  return deepFreeze({
    ...manifest,
    digest: {
      algorithm: "fnv1a-32-canonical-json" as const,
      value: canonicalDigest(manifest),
    },
  });
}

/**
 * Freezes one manifest from every archived repetition of the Task 26 search.
 *
 * Two repetitions that disagree about anything the manifest records are not two
 * emissions of one result, so the disagreement is raised instead of one of them
 * being adopted.
 */
export function listenRoundTwoCandidateManifestFromRepetitions(options: {
  evidenceRepetitions: readonly unknown[];
}): {
  manifest: ListenRoundTwoCandidateManifest;
  reproductions: ListenRoundTwoReproducedEvidence[];
} {
  if (options.evidenceRepetitions.length < 2) {
    throw new Error(
      "The candidate manifest is frozen from at least two archived Task 26 repetitions.",
    );
  }
  const reproductions = options.evidenceRepetitions
    .map((evidence) => reproduceListenRoundTwoAblationEvidence(evidence));
  const manifests = options.evidenceRepetitions
    .map((evidence) => listenRoundTwoCandidateManifest({ evidence }));
  const [manifest, ...rest] = manifests;
  for (const [index, other] of rest.entries()) {
    if (!sameCanonical(manifest, other)) {
      throw new Error(
        `Task 26 repetition ${index + 2} produces a different candidate manifest than repetition 1.`,
      );
    }
  }
  return { manifest, reproductions };
}

/**
 * The immutability rule, applied at the point of re-emission.
 *
 * The manifest is the first link of the round's artifact chain, so a second
 * emission may reproduce it and may not revise it. Anything else — a different
 * reason code, a candidate added later, a digest recomputed under a changed
 * field — has to start a new round rather than move this record.
 */
export function assertListenRoundTwoCandidateManifestUnchanged(
  existing: unknown,
  emitted: ListenRoundTwoCandidateManifest,
): void {
  if (!sameCanonical(existing, emitted)) {
    throw new Error(
      "The frozen round-two candidate manifest is immutable, and this emission differs from it.",
    );
  }
}
