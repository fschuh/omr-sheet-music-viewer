import assert from "node:assert/strict";
import test from "node:test";
import {
  LISTEN_SEQUENCE_INTERVALS_MS,
  bundledListenSequences,
  courseClearArticulationDefinitions,
} from "./listenSequenceBenchmark";
import {
  listenSequenceCaseDefinition,
  listenSequenceCaseDefinitions,
  listenSequenceCaseInterval,
} from "./listenSequenceCaseBenchmark";

test("a focused case can reproduce every corpus and articulation passage", () => {
  const definitions = listenSequenceCaseDefinitions();
  const expected = [
    ...bundledListenSequences().map(({ id }) => id),
    ...courseClearArticulationDefinitions().map(({ id }) => id),
  ];
  assert.deepEqual(definitions.map(({ id }) => id), expected);
  assert.equal(new Set(expected).size, expected.length);
  assert.equal(listenSequenceCaseDefinition("course-clear-27").family, "course-clear");
});

test("an unknown sequence names the passages that exist", () => {
  assert.throws(
    () => listenSequenceCaseDefinition("course-clear"),
    /Unknown sequence course-clear\. Available: .*course-clear-27/,
  );
});

/**
 * The 333 ms corpus speed is `1000 / 3`. Rendering at a typed 333 instead would
 * silently produce a different passage from the one under investigation, so a
 * requested speed resolves to the exact corpus value or fails.
 */
test("a requested interval resolves to the exact corpus speed", () => {
  assert.equal(listenSequenceCaseInterval(333.33), LISTEN_SEQUENCE_INTERVALS_MS[2]);
  assert.equal(listenSequenceCaseInterval(1_000 / 3), LISTEN_SEQUENCE_INTERVALS_MS[2]);
  assert.notEqual(listenSequenceCaseInterval(333.33), 333.33);
  for (const intervalMs of LISTEN_SEQUENCE_INTERVALS_MS) {
    assert.equal(listenSequenceCaseInterval(intervalMs), intervalMs);
  }
  assert.throws(() => listenSequenceCaseInterval(300), /not a corpus speed/);
  assert.throws(() => listenSequenceCaseInterval(Number.NaN), /not a finite number/);
});
