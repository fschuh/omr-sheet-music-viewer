import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareEvidenceRuns,
  firstEvidenceDifference,
  main,
} from "./verify_listen_benchmark_evidence.mjs";

function repetitions() {
  const first = [{
    name: "listen-profile-validation",
    gates: {
      candidateProfileIds: ["early-open-v2"],
      candidates: [{ profileId: "early-open-v2", failedGateCodes: [] }],
    },
    domains: {
      isolated: { maximumInferenceMs: 12.5, identityDigest: "bff20df8" },
      sequence: { maximumInferenceMs: 18.25, orderedAdvanceCount: 104 },
      dynamics: { peak: 0.75, rms: 0.2, lateAdvanceCount: 3 },
    },
  }];
  const second = [{
    domains: {
      dynamics: { lateAdvanceCount: 3, peak: 0.76, rms: 0.21 },
      sequence: { orderedAdvanceCount: 104, maximumInferenceMs: 25 },
      isolated: { identityDigest: "bff20df8", maximumInferenceMs: 20 },
    },
    gates: {
      candidates: [{ failedGateCodes: [], profileId: "early-open-v2" }],
      candidateProfileIds: ["early-open-v2"],
    },
    name: "listen-profile-validation",
  }];
  return { first, second };
}

test("cross-run comparison ignores only the documented host-dependent fields", () => {
  const { first, second } = repetitions();
  const matching = compareEvidenceRuns(first, second);
  assert.equal(matching.equal, true);
  assert.equal(matching.leftSha256, matching.rightSha256);
  assert.equal(matching.difference, null);

  second[0].gates.candidates[0].failedGateCodes.push("release-isolated-recognition");
  const mismatch = compareEvidenceRuns(first, second);
  assert.equal(mismatch.equal, false);
  assert.deepEqual(mismatch.difference, {
    path: "$[0].gates.candidates[0].failedGateCodes.length",
    left: 0,
    right: 1,
  });
  assert.deepEqual(firstEvidenceDifference(first, second), mismatch.difference);
});

test("compare CLI passes matching repetitions and identifies a meaningful mismatch", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "listen-evidence-compare-"));
  const firstPath = join(temporaryDirectory, "first.json");
  const secondPath = join(temporaryDirectory, "second.json");
  try {
    const { first, second } = repetitions();
    await Promise.all([
      writeFile(firstPath, `${JSON.stringify(first, null, 2)}\n`),
      writeFile(secondPath, `${JSON.stringify(second, null, 2)}\n`),
    ]);
    const messages = [];
    const originalLog = console.log;
    console.log = (message) => messages.push(message);
    try {
      await main(["--compare", firstPath, secondPath]);
    } finally {
      console.log = originalLog;
    }
    assert.match(messages[0], /Benchmark repetitions match: evidence=[a-f0-9]{64}/);
    assert.match(messages[0], /omitted=maximumInferenceMs,peak,rms/);

    second[0].domains.sequence.orderedAdvanceCount = 103;
    await writeFile(secondPath, `${JSON.stringify(second, null, 2)}\n`);
    await assert.rejects(
      () => main(["--compare", firstPath, secondPath]),
      /Benchmark repetitions differ at \$\[0\]\.domains\.sequence\.orderedAdvanceCount: first=104 second=103/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true });
  }
});
