/**
 * Types for the evidence verifier, which is plain JavaScript so it can read an
 * archived benchmark result without the webapp build.
 *
 * `listenProfileValidationBenchmark.test.ts` imports the frozen contract from
 * here to check it against the definitions the benchmark actually applies, so
 * the verifier's restatement of the frozen matrix cannot drift away from it.
 */

export interface ListenEvidenceGateDefinition {
  code: string;
  /** The rows a complete matrix reads for this gate, in sorted order. */
  partitions: string[];
  role: string;
  domain: string;
  label: string;
  requirement: string;
}

export interface ListenEvidenceProfileThresholds {
  onsetThreshold: number;
  targetNoteThreshold: number;
  activeTargetThreshold: number;
  extraNoteThreshold: number;
  requireFreshBassOnset: boolean;
}

export interface ListenEvidenceDomainExpectation {
  domain: string;
  capturedTraceCount: number;
  suites: string[];
  /** Every partition this domain's frozen corpus spans, sorted. */
  partitions: string[];
  /** Null when the domain contains gating rows, which carry no scored role. */
  evidenceRole: string | null;
}

/** Everything one archived Task 13 repetition must show, fixed before any run. */
export declare const CONFIRMATION_EVIDENCE: {
  name: string;
  manifestVersion: number;
  manifestHash: string;
  manifestCorpusHash: string;
  registryVersion: number;
  baselineProfileId: string;
  candidateProfileIds: string[];
  rendererKeys: string[];
  domains: ListenEvidenceDomainExpectation[];
  profiles: Record<string, ListenEvidenceProfileThresholds>;
  gates: ListenEvidenceGateDefinition[];
};

/** The partitions a gate of each role, and of each domain, may have read. */
export declare const GATE_SCOPE_BY_ROLE: Record<string, string[]>;
export declare const GATE_SCOPE_BY_DOMAIN: Record<string, string[]>;

export declare function canonicalJson(value: unknown, omittedFields?: Set<string>): string;

export declare function firstEvidenceDifference(
  left: unknown,
  right: unknown,
  omittedFields?: Set<string>,
  path?: string,
): { path: string; left: unknown; right: unknown } | null;

export declare function compareEvidenceRuns(
  left: unknown,
  right: unknown,
  omittedFields?: Set<string>,
): {
  equal: boolean;
  leftSha256: string;
  rightSha256: string;
  difference: { path: string; left: unknown; right: unknown } | null;
};

/** Every way one archived run is not a complete repetition of the frozen matrix. */
export declare function confirmationEvidenceProblems(
  result: unknown,
  label: string,
): string[];

export declare function verifyFrozenEvidence(): Promise<boolean>;

export declare function main(args?: string[]): Promise<void>;
