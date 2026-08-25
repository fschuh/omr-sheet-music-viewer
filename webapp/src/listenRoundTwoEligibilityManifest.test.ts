import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LISTEN_CONFIRMATION_REPRODUCTION_STATUSES,
  LISTEN_REPEATED_RECOVERY_OUTCOMES,
} from "./listenMatcherSelectionPolicy";
import {
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS,
  LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE,
} from "./listenRoundTwoCandidateManifest";
import {
  LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT,
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE,
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_KEYS,
  LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME,
  LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH,
  LISTEN_ROUND_TWO_TRACE_GENERATION_HASH,
  assertListenRoundTwoEligibilityManifestUnchanged,
  assertValidListenRoundTwoEligibilityManifest,
  listenRoundTwoArtifactChainProblems,
  listenRoundTwoAutomatedEligibleProfileIds,
  listenRoundTwoConfirmationPartitionState,
  listenRoundTwoConfirmationUntouchedProblems,
  listenRoundTwoEligibilityManifest,
  listenRoundTwoEligibilityManifestDigest,
  listenRoundTwoEligibilityManifestProblems,
  type ListenRoundTwoEligibilityManifest,
} from "./listenRoundTwoEligibilityManifest";
import {
  LISTEN_PRIOR_TRACE_LEDGER_HASH,
  LISTEN_TRACE_MANIFEST,
  type ListenTraceDescriptor,
  type ListenTraceManifest,
} from "./listenTraceManifest";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readArtifact(path: string): unknown {
  return JSON.parse(readFileSync(join(REPOSITORY_ROOT, path), "utf8"));
}

function readArtifactBytes(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), "utf8");
}

const committedCandidateManifest = () => readArtifact(LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE);
const committedEvidence = () =>
  LISTEN_ROUND_TWO_ABLATION_EVIDENCE_PATHS.map((path) => readArtifact(path));
const committedEligibility = () => readArtifact(LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE);

function emit() {
  return listenRoundTwoEligibilityManifest({
    candidateManifest: committedCandidateManifest(),
    evidenceRepetitions: committedEvidence(),
  });
}

/** A record with its digest recomputed, so the digest never masks the mutation. */
function amended(
  source: unknown,
  amend: (record: Record<string, unknown>) => void,
): Record<string, unknown> {
  const record = structuredClone(source) as Record<string, unknown>;
  amend(record);
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest(record),
  };
  return record;
}

/**
 * A schema-valid completed manifest.
 *
 * The round took the not-run branch, so no completed artifact exists and none can
 * be derived from the committed evidence. The branch is still reachable by every
 * later round, and each of its rules — required archive hashes, entries that
 * cover the frozen candidate set, a decoded confirmation partition, forbidden
 * reason code — needs a record that satisfies the others in order to be tested
 * one at a time.
 */
function completedManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const candidate = committedCandidateManifest() as Record<string, unknown>;
  const record: Record<string, unknown> = {
    name: LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_NAME,
    formatVersion: 1,
    roundId: "round-two",
    runStatus: "completed",
    candidateManifestDigest: (candidate.digest as { value: string }).value,
    task26TerminalOutcome: candidate.task26TerminalOutcome,
    task26EvidenceDigest: candidate.task26EvidenceDigest,
    entries: [
      {
        profileId: "early-open-v3",
        automatedEligible: true,
        rejectionReasons: [],
        repeatedRecoveryOutcome: "material-partial-recovery",
        confirmationReproductionStatus: "reproduced",
      },
      {
        profileId: "steady-open-v3",
        automatedEligible: false,
        rejectionReasons: ["confirmation-no-regression-failed"],
        repeatedRecoveryOutcome: "regressed",
        confirmationReproductionStatus: "reproduced",
      },
    ],
    confirmationPartition: {
      traceCount: LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT,
      decodedTraceCount: LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT,
      priorLedgerHash: LISTEN_PRIOR_TRACE_LEDGER_HASH,
      traceGenerationHash: LISTEN_ROUND_TWO_TRACE_GENERATION_HASH,
      traceIdentityHash: LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH,
    },
    confirmationEvidence: {
      runOneArchive: "benchmark-results/listen-profile-validation-task28-run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "benchmark-results/listen-profile-validation-task28-run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
    ...overrides,
  };
  record.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest(record),
  };
  return record;
}

/** The candidate manifest a completed round would have frozen. */
function completedCandidateManifest(profileIds: string[]): Record<string, unknown> {
  const candidate = structuredClone(committedCandidateManifest()) as Record<string, unknown>;
  candidate.candidateProfileIds = profileIds;
  candidate.notRunReason = null;
  candidate.ablationId = "ablation-2-refined-family";
  const { digest: _digest, ...rest } = candidate;
  candidate.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest({ ...rest, digest: undefined }),
  };
  return candidate;
}

/* ------------------------------------------------------------------------- *
 * The not-run branch, as the round actually took it
 * ------------------------------------------------------------------------- */

test("the not-run branch is derived by rerunning the chain, not by reading it", () => {
  const { manifest, candidateManifest, reproducedEvidence } = emit();
  assert.equal(manifest.runStatus, "not-run-no-confirmable-candidate");
  assert.equal(manifest.reason, "no-ablation-accepted");
  assert.deepEqual([...manifest.entries], []);
  // The reason and the outcome came from a rerun of both Task 26 repetitions.
  assert.equal(reproducedEvidence.notRunReason, "no-ablation-accepted");
  assert.equal(reproducedEvidence.terminalOutcome, "bass-axis-unsupported");
  assert.equal(reproducedEvidence.acceptedAblation, null);
  assert.equal(manifest.task26EvidenceDigest, reproducedEvidence.digest);
  assert.equal(manifest.candidateManifestDigest, candidateManifest.digest.value);
  // Two emissions of one chain are the same record.
  assert.deepEqual(emit().manifest, manifest);
});

test("the committed artifact is the record this commit's chain re-derives", () => {
  const { manifest } = emit();
  assert.deepEqual(committedEligibility(), JSON.parse(JSON.stringify(manifest)));
  assert.equal(
    readArtifactBytes(LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  assert.deepEqual(listenRoundTwoEligibilityManifestProblems(committedEligibility()), []);
});

test("Task 27's candidate manifest is byte-identical after Task 28 ran", () => {
  // Task 28 emits a new artifact and never edits the link it chains to. The
  // committed bytes are compared against the record Task 27's own emitter
  // reproduces, so a re-serialization that preserved the digest would still fail.
  const { candidateManifest } = emit();
  assert.equal(
    readArtifactBytes(LISTEN_ROUND_TWO_CANDIDATE_MANIFEST_FILE),
    `${JSON.stringify(candidateManifest, null, 2)}\n`,
  );
});

test("a frozen eligibility manifest cannot be edited in place or revised", () => {
  const { manifest } = emit();
  assert.throws(() => {
    (manifest as { reason: string }).reason = "no-supported-parameterization";
  });
  assert.throws(() => {
    (manifest.entries as unknown as string[]).push("early-open-v3");
  });
  assert.throws(() => assertListenRoundTwoEligibilityManifestUnchanged(
    amended(manifest, (record) => {
      record.reason = "no-supported-parameterization";
    }),
    manifest,
  ));
  assert.doesNotThrow(() => assertListenRoundTwoEligibilityManifestUnchanged(
    committedEligibility(),
    manifest,
  ));
});

test("the emitter refuses a candidate manifest this commit's evidence does not re-derive", () => {
  const relabelled = structuredClone(committedCandidateManifest()) as Record<string, unknown>;
  relabelled.notRunReason = "no-supported-parameterization";
  assert.throws(
    () => listenRoundTwoEligibilityManifest({
      candidateManifest: relabelled,
      evidenceRepetitions: committedEvidence(),
    }),
    /not the record this commit's Task 26 archives re-derive/,
  );
  // One repetition is not the round's result, so the chain cannot be resolved.
  assert.throws(
    () => listenRoundTwoEligibilityManifest({
      candidateManifest: committedCandidateManifest(),
      evidenceRepetitions: committedEvidence().slice(0, 1),
    }),
    /at least two archived Task 26 repetitions/,
  );
});

/* ------------------------------------------------------------------------- *
 * The confirmation partition, measured rather than asserted
 * ------------------------------------------------------------------------- */

function manifestWithConfirmationTraces(
  amend: (trace: ListenTraceDescriptor) => ListenTraceDescriptor,
): ListenTraceManifest {
  return {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.map((trace) => (
      trace.partition === "confirmation" ? amend(trace) : trace
    )),
  };
}

test("the version-2 confirmation fixtures record no decode", () => {
  const state = listenRoundTwoConfirmationPartitionState();
  assert.equal(state.traceCount, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
  assert.equal(state.decodedTraceCount, 0);
  assert.equal(state.priorLedgerHash, LISTEN_PRIOR_TRACE_LEDGER_HASH);
  assert.equal(state.traceGenerationHash, LISTEN_ROUND_TWO_TRACE_GENERATION_HASH);
  assert.equal(state.traceIdentityHash, LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH);
  assert.deepEqual(listenRoundTwoConfirmationUntouchedProblems(state), []);
  // Every confirmation row is still structurally authored and unobserved.
  const confirmation = LISTEN_TRACE_MANIFEST.traces
    .filter(({ partition }) => partition === "confirmation");
  assert.equal(confirmation.length, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
  assert.ok(confirmation.every(({ decodeStatus, fixtureVersion, firstObservedManifestVersion }) => (
    decodeStatus === "not-decoded-until-task-28" &&
      fixtureVersion === null &&
      firstObservedManifestVersion === 2
  )));
});

test("a decoded confirmation fixture is counted, and refuses the not-run emission", () => {
  const decoded = manifestWithConfirmationTraces((trace) => (
    trace.pairedCaseRole === "correct" ? { ...trace, fixtureVersion: "task28-v1" } : trace
  ));
  const state = listenRoundTwoConfirmationPartitionState(decoded);
  assert.equal(state.decodedTraceCount, 4);
  assert.ok(listenRoundTwoConfirmationUntouchedProblems(state, decoded)
    .some((problem) => problem.includes("record a decoded structure")));
  assert.throws(
    () => listenRoundTwoEligibilityManifest({
      candidateManifest: committedCandidateManifest(),
      evidenceRepetitions: committedEvidence(),
      traceManifest: decoded,
    }),
    /record a decoded structure/,
  );
});

test("a substituted confirmation fixture moves the hash even at the same count", () => {
  // The count alone would accept a fixture decoded elsewhere and renamed into
  // the partition, so the identity of every row is hashed — and identity means
  // the rendered content it stands for, not only its name. A row re-pointed at
  // different content keeps its identifier and its count.
  for (const amend of [
    (trace: ListenTraceDescriptor) => ({ ...trace, id: `${trace.id}-replacement` }),
    (trace: ListenTraceDescriptor) => ({ ...trace, contentKey: `${trace.contentKey}-other` }),
    (trace: ListenTraceDescriptor) => ({ ...trace, musicalInputHash: "00000000" }),
    (trace: ListenTraceDescriptor) => ({ ...trace, pairedGroupHash: "00000000" }),
  ]) {
    const swapped = manifestWithConfirmationTraces((trace) => (
      trace.pairedCaseRole === "correct" ? amend(trace) : trace
    ));
    const state = listenRoundTwoConfirmationPartitionState(swapped);
    assert.equal(state.decodedTraceCount, 0);
    assert.equal(state.traceCount, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
    assert.notEqual(state.traceIdentityHash, LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH);
    assert.ok(listenRoundTwoConfirmationUntouchedProblems(state, swapped)
      .some((problem) => problem.includes("confirmation fixtures hash to")));
    assert.throws(() => listenRoundTwoEligibilityManifest({
      candidateManifest: committedCandidateManifest(),
      evidenceRepetitions: committedEvidence(),
      traceManifest: swapped,
    }));
  }
});

test("an internally invalid corpus is named by its rule, not only by a moved hash", () => {
  // The pins alone would reject this manifest, but only as "hashes to X, not Y".
  // Validating the generation says which rule it breaks, which is the difference
  // between a corpus that was edited and one that is incoherent.
  const split: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.map((trace) => (
      trace.partition === "confirmation" && trace.pairedCaseRole === "correct"
        ? { ...trace, partition: "discovery" as const }
        : trace
    )),
  };
  const problems = listenRoundTwoConfirmationUntouchedProblems(
    listenRoundTwoConfirmationPartitionState(split),
    split,
  );
  assert.ok(problems.some((problem) => problem.startsWith("The trace manifest is invalid:")));
  assert.throws(() => listenRoundTwoEligibilityManifest({
    candidateManifest: committedCandidateManifest(),
    evidenceRepetitions: committedEvidence(),
    traceManifest: split,
  }), /The trace manifest is invalid/);
});

test("the confirmation rows are validated as part of one frozen generation", () => {
  // A confirmation row can keep its own identity while the corpus it is drawn
  // from moves underneath it, so the whole manifest is validated and held to its
  // pinned generation and corpus hashes before the partition is read at all.
  // The two pins cover different fields, so both are checked: the corpus hash
  // carries the musical definition behind each row, and the protocol hash carries
  // its partition, weight, and structural metadata.
  const elsewhere: Array<[string, ListenTraceManifest, string]> = [
    [
      "musical input",
      {
        ...LISTEN_TRACE_MANIFEST,
        traces: LISTEN_TRACE_MANIFEST.traces.map((trace) => (
          trace.partition === "discovery" && trace.suite === "round-two-paired"
            ? { ...trace, musicalInputHash: "00000000" }
            : trace
        )),
      },
      "musical corpus hashes to",
    ],
    [
      "leaf domain",
      {
        ...LISTEN_TRACE_MANIFEST,
        traces: LISTEN_TRACE_MANIFEST.traces.map((trace) => (
          trace.partition === "discovery" && trace.suite === "round-two-paired"
            ? { ...trace, domain: `${trace.domain}-moved` }
            : trace
        )),
      },
      "trace manifest generation hashes to",
    ],
  ];
  for (const [what, moved, expected] of elsewhere) {
    const state = listenRoundTwoConfirmationPartitionState(moved);
    // The confirmation rows themselves are untouched, and it still fails.
    assert.equal(state.traceIdentityHash, LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH);
    assert.equal(state.traceCount, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
    assert.ok(
      listenRoundTwoConfirmationUntouchedProblems(state, moved)
        .some((problem) => problem.includes(expected)),
      `a moved ${what} was accepted as untouched`,
    );
    assert.throws(() => listenRoundTwoEligibilityManifest({
      candidateManifest: committedCandidateManifest(),
      evidenceRepetitions: committedEvidence(),
      traceManifest: moved,
    }));
  }
});

test("a shrunken confirmation partition is not the frozen one", () => {
  const narrowed: ListenTraceManifest = {
    ...LISTEN_TRACE_MANIFEST,
    traces: LISTEN_TRACE_MANIFEST.traces.filter((trace) => (
      trace.partition !== "confirmation" || trace.pairedCaseRole === "correct"
    )),
  };
  assert.ok(listenRoundTwoConfirmationUntouchedProblems(
    listenRoundTwoConfirmationPartitionState(narrowed),
    narrowed,
  ).some((problem) => problem.includes("holds 4 traces")));
});

/* ------------------------------------------------------------------------- *
 * The discriminated schema
 * ------------------------------------------------------------------------- */

test("the two branches carry disjoint evidence fields", () => {
  const notRun = committedEligibility() as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(notRun).sort(),
    [...LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_KEYS["not-run-no-confirmable-candidate"]].sort(),
  );
  assert.deepEqual(
    Object.keys(completedManifest()).sort(),
    [...LISTEN_ROUND_TWO_ELIGIBILITY_MANIFEST_KEYS.completed].sort(),
  );

  // Archive hashes on a run that never happened are the fabricated evidence the
  // discriminator exists to prevent, so they are forbidden rather than nulled.
  assert.ok(listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
    record.confirmationEvidence = {
      runOneArchive: "run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    };
  })).some((problem) => problem.includes("forbidden field confirmationEvidence")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
    record.confirmationEvidence = null;
  })).some((problem) => problem.includes("forbidden field confirmationEvidence")));

  // And a completed run may not carry the reason code that describes not running.
  assert.ok(listenRoundTwoEligibilityManifestProblems(
    completedManifest({ reason: "no-ablation-accepted" }),
  ).some((problem) => problem.includes("forbidden field reason")));
});

test("the not-run branch may hold no entry and must name a known reason", () => {
  const notRun = committedEligibility();
  assert.ok(listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
    record.entries = [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "material-partial-recovery",
      confirmationReproductionStatus: "reproduced",
    }];
  })).some((problem) => problem.includes("may hold no entry")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
    record.reason = "round-two-candidate-set-exhausted";
  })).some((problem) => problem.includes("records reason")));
  // Both zero-branch reasons are valid here; they are Task 29's to describe.
  assert.deepEqual(
    listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
      record.reason = "no-supported-parameterization";
    })).filter((problem) => problem.includes("reason")),
    [],
  );
  // A not-run record may not claim the fixtures were decoded.
  assert.ok(listenRoundTwoEligibilityManifestProblems(amended(notRun, (record) => {
    (record.confirmationPartition as { decodedTraceCount: number }).decodedTraceCount = 12;
  })).some((problem) => problem.includes("decoded no confirmation trace")));
});

test("a completed branch requires entries, both archive hashes, and a decoded partition", () => {
  assert.deepEqual(listenRoundTwoEligibilityManifestProblems(completedManifest()), []);
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({ entries: [] }))
    .some((problem) => problem.includes("records the candidates it measured")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    confirmationEvidence: {
      runOneArchive: "run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "run2.json",
      comparisonDigest: "c".repeat(64),
    },
  })).some((problem) => problem.includes("runTwoSha256 is not a SHA-256")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    confirmationPartition: {
      traceCount: 12,
      decodedTraceCount: 0,
      priorLedgerHash: LISTEN_PRIOR_TRACE_LEDGER_HASH,
      traceGenerationHash: LISTEN_ROUND_TWO_TRACE_GENERATION_HASH,
      traceIdentityHash: LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH,
    },
  })).some((problem) => problem.includes("decodes the whole confirmation partition")));
});

test("repetition is proven by two archives, not by their bytes differing", () => {
  // Two runs of a deterministic matrix may legitimately hash alike, so equal
  // content hashes across two named archives are accepted.
  assert.deepEqual(listenRoundTwoEligibilityManifestProblems(completedManifest({
    confirmationEvidence: {
      runOneArchive: "benchmark-results/listen-profile-validation-task28-run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "benchmark-results/listen-profile-validation-task28-run2.json",
      runTwoSha256: "a".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
  })), []);
  // One archive quoted twice is one run, whatever its hashes say.
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    confirmationEvidence: {
      runOneArchive: "benchmark-results/listen-profile-validation-task28-run1.json",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "benchmark-results/listen-profile-validation-task28-run1.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
  })).some((problem) => problem.includes("quoted twice rather than repeated")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    confirmationEvidence: {
      runOneArchive: "",
      runOneSha256: "a".repeat(64),
      runTwoArchive: "run2.json",
      runTwoSha256: "b".repeat(64),
      comparisonDigest: "c".repeat(64),
    },
  })).some((problem) => problem.includes("names no runOneArchive")));
});

test("a completed run over an empty confirmation partition is not a confirmation", () => {
  // `decodedTraceCount === traceCount` is satisfied by 0 === 0, so the census is
  // pinned in both branches rather than only in the not-run untouched check.
  const empty = completedManifest({
    confirmationPartition: {
      traceCount: 0,
      decodedTraceCount: 0,
      priorLedgerHash: LISTEN_PRIOR_TRACE_LEDGER_HASH,
      traceGenerationHash: LISTEN_ROUND_TWO_TRACE_GENERATION_HASH,
      traceIdentityHash: LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH,
    },
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "confirmed-full-resolution",
      confirmationReproductionStatus: "reproduced",
    }],
  });
  assert.ok(listenRoundTwoEligibilityManifestProblems(empty)
    .some((problem) => problem.includes("holds 0 traces")));

  // The identity and the frozen manifest generation are pinned in both branches
  // too: twelve rows renamed or re-pointed still fail.
  for (const [field, value] of [
    ["traceIdentityHash", "00000000"],
    ["traceGenerationHash", "00000000"],
    ["priorLedgerHash", "00000000"],
  ] as const) {
    const moved = completedManifest({
      confirmationPartition: {
        traceCount: LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT,
        decodedTraceCount: LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT,
        priorLedgerHash: LISTEN_PRIOR_TRACE_LEDGER_HASH,
        traceGenerationHash: LISTEN_ROUND_TWO_TRACE_GENERATION_HASH,
        traceIdentityHash: LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH,
        [field]: value,
      },
    });
    assert.ok(
      listenRoundTwoEligibilityManifestProblems(moved).length > 0,
      `${field} is not pinned on the completed branch`,
    );
  }
});

test("a genuinely decoded corpus satisfies the completed branch", () => {
  // The completed branch is defined by decoding the confirmation fixtures, so a
  // partition identity that moved when they were decoded would describe a state
  // no real completed round can reach. The generation hash normalizes the
  // confirmation partition's decode state out for exactly that reason, and this
  // test builds the corpus a completed round would leave behind and requires the
  // schema to accept the state the state function derives from it.
  const decoded = manifestWithConfirmationTraces((trace) => ({
    ...trace,
    decodeStatus: "captured" as const,
    fixtureVersion: "task28-v1",
  }));
  const state = listenRoundTwoConfirmationPartitionState(decoded);
  assert.equal(state.traceCount, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
  assert.equal(state.decodedTraceCount, LISTEN_ROUND_TWO_CONFIRMATION_TRACE_COUNT);
  assert.equal(state.traceGenerationHash, LISTEN_ROUND_TWO_TRACE_GENERATION_HASH);
  assert.equal(state.traceIdentityHash, LISTEN_ROUND_TWO_CONFIRMATION_IDENTITY_HASH);
  assert.deepEqual(
    listenRoundTwoEligibilityManifestProblems(completedManifest({
      confirmationPartition: { ...state },
    })),
    [],
  );

  // And the same corpus is refused by the not-run branch, which is the only
  // place decoding is prohibited.
  assert.ok(listenRoundTwoConfirmationUntouchedProblems(state, decoded)
    .some((problem) => problem.includes("record a decoded structure")));
});

test("a candidate that regressed a repeated-chord group cannot be eligible", () => {
  // Task 23's confirmation no-regression condition is a gate: recording the
  // failure and the eligibility together is a contradiction, not a nuance.
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "regressed",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("failing confirmation no-regression")));
  // The same outcome recorded as a rejection is the coherent form.
  assert.deepEqual(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: false,
      rejectionReasons: ["confirmation-no-regression-failed"],
      repeatedRecoveryOutcome: "regressed",
      confirmationReproductionStatus: "reproduced",
    }],
  })), []);
});

test("every completed entry carries its Task 24 recovery labels", () => {
  for (const field of ["repeatedRecoveryOutcome", "confirmationReproductionStatus"]) {
    const missing = completedManifest();
    const [entry] = missing.entries as Record<string, unknown>[];
    delete entry[field];
    assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
      entries: missing.entries,
    })).some((problem) => problem.includes(`is missing ${field}`)));
  }
  // The labels are the policy's own vocabularies, so an invented one is refused.
  assert.ok(LISTEN_REPEATED_RECOVERY_OUTCOMES.includes("confirmed-full-resolution"));
  assert.ok(LISTEN_CONFIRMATION_REPRODUCTION_STATUSES.includes("inconclusive-no-reproduction"));
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "resolved",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("repeated-recovery outcome")));

  // A zero-reproduction confirmation withholds `confirmed-full-resolution`.
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "confirmed-full-resolution",
      confirmationReproductionStatus: "inconclusive-no-reproduction",
    }],
  })).some((problem) => problem.includes("claims confirmed full resolution")));

  // A completed entry cannot say the confirmation matrix never ran.
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "material-partial-recovery",
      confirmationReproductionStatus: "not-run",
    }],
  })).some((problem) => problem.includes("fixtures it records as never run")));

  // Eligible-and-rejected at once, and rejected with no reason, are both refused.
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: true,
      rejectionReasons: ["confirmation-no-regression-failed"],
      repeatedRecoveryOutcome: "material-partial-recovery",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("automated-eligible and rejected at once")));
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "early-open-v3",
      automatedEligible: false,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "regressed",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("rejected without naming a reason")));
});

test("no artifact in the chain carries the baseline column", () => {
  assert.ok(listenRoundTwoEligibilityManifestProblems(completedManifest({
    entries: [{
      profileId: "baseline-v1",
      automatedEligible: true,
      rejectionReasons: [],
      repeatedRecoveryOutcome: "unchanged",
      confirmationReproductionStatus: "reproduced",
    }],
  })).some((problem) => problem.includes("names baseline-v1")));
});

test("a moved field breaks the digest it is covered by", () => {
  const notRun = structuredClone(committedEligibility()) as Record<string, unknown>;
  notRun.reason = "no-supported-parameterization";
  assert.ok(listenRoundTwoEligibilityManifestProblems(notRun)
    .some((problem) => problem.includes("recomputed")));
  assert.throws(() => assertValidListenRoundTwoEligibilityManifest(notRun));
});

test("consumers branch on runStatus rather than on an empty list", () => {
  const notRun = assertValidListenRoundTwoEligibilityManifest(committedEligibility());
  assert.deepEqual(listenRoundTwoAutomatedEligibleProfileIds(notRun), []);
  const completed = assertValidListenRoundTwoEligibilityManifest(completedManifest());
  assert.deepEqual(listenRoundTwoAutomatedEligibleProfileIds(completed), ["early-open-v3"]);
  // A completed matrix that rejected everything is still a completed run, and
  // reading its empty column list as "not run" would erase that difference.
  const exhausted = completedManifest({
    entries: [{
      profileId: "steady-open-v3",
      automatedEligible: false,
      rejectionReasons: ["confirmation-no-regression-failed"],
      repeatedRecoveryOutcome: "regressed",
      confirmationReproductionStatus: "reproduced",
    }],
  }) as unknown as ListenRoundTwoEligibilityManifest;
  assert.equal(exhausted.runStatus, "completed");
  assert.deepEqual(listenRoundTwoAutomatedEligibleProfileIds(exhausted), []);
});

/* ------------------------------------------------------------------------- *
 * The chain
 * ------------------------------------------------------------------------- */

test("both digest links resolve and all three artifacts agree", () => {
  const { manifest, reproducedEvidence } = emit();
  assert.deepEqual(listenRoundTwoArtifactChainProblems({
    eligibility: manifest,
    candidateManifest: committedCandidateManifest(),
    reproducedEvidence,
  }), []);
});

test("a chain whose artifacts each pass their own schema but disagree is refused", () => {
  const { manifest, reproducedEvidence } = emit();
  const candidate = committedCandidateManifest() as Record<string, unknown>;

  // The eligibility link is recomputed from the candidate record, so a manifest
  // pointing at a digest that record does not hash to fails even though both
  // digests verify against their own contents.
  const elsewhere = amended(manifest, (record) => {
    record.candidateManifestDigest = "00000000";
  });
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: elsewhere,
    candidateManifest: candidate,
  }).some((problem) => problem.includes("chains to candidate manifest")));

  // Semantic disagreement across an intact digest chain.
  const otherOutcome = amended(manifest, (record) => {
    record.task26TerminalOutcome = "grid-supported";
  });
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: otherOutcome,
    candidateManifest: candidate,
  }).some((problem) => problem.includes("disagrees about the Task 26 terminal outcome")));

  const otherReason = amended(manifest, (record) => {
    record.reason = "no-supported-parameterization";
  });
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: otherReason,
    candidateManifest: candidate,
  }).some((problem) => problem.includes("carries reason")));

  // The Task 26 root is mandatory in this branch too: a chain that does not
  // rerun to the outcome it records is broken rather than reconcilable.
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: manifest,
    candidateManifest: candidate,
    reproducedEvidence: { ...reproducedEvidence, digest: "00000000" },
  }).some((problem) => problem.includes("recompute to digest 00000000")));
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: manifest,
    candidateManifest: candidate,
    reproducedEvidence: { ...reproducedEvidence, acceptedAblation: "ablation-3-bass-axis" },
  }).some((problem) => problem.includes("rerun to ablation")));
});

test("the not-run branch is taken only over a candidate manifest that registered nothing", () => {
  const { manifest } = emit();
  const registered = completedCandidateManifest(["early-open-v3"]);
  registered.notRunReason = "no-ablation-accepted";
  const { digest: _digest, ...rest } = registered;
  registered.digest = {
    algorithm: "fnv1a-32-canonical-json",
    value: listenRoundTwoEligibilityManifestDigest({ ...rest, digest: undefined }),
  };
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: manifest,
    candidateManifest: registered,
  }).some((problem) => problem.includes("registered nothing")));
});

test("a completed manifest must report on exactly the frozen candidate set", () => {
  const candidate = completedCandidateManifest(["early-open-v3", "steady-open-v3"]);
  const completed = completedManifest({
    candidateManifestDigest: (candidate.digest as { value: string }).value,
  });
  assert.deepEqual(listenRoundTwoArtifactChainProblems({
    eligibility: completed,
    candidateManifest: candidate,
  }), []);

  const narrowed = completedManifest({
    candidateManifestDigest: (candidate.digest as { value: string }).value,
    entries: (completedManifest().entries as unknown[]).slice(0, 1),
  });
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: narrowed,
    candidateManifest: candidate,
  }).some((problem) => problem.includes("the candidate manifest froze")));

  // A completed run against a candidate manifest that never ran a search.
  assert.ok(listenRoundTwoArtifactChainProblems({
    eligibility: completedManifest(),
    candidateManifest: committedCandidateManifest(),
  }).some((problem) => problem.includes("notRunReason is")));
});
