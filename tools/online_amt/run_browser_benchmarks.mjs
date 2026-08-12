import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.argv[2] ?? "http://127.0.0.1:5173/online-amt-benchmark.html";
const CONFIGURATION_FILTER = process.argv[3];
const LISTEN_ACCURACY_MODE = CONFIGURATION_FILTER === "listen-accuracy";
const LISTEN_SEQUENCE_SUMMARY_MODE = CONFIGURATION_FILTER === "listen-sequence-summary";
const LISTEN_SEQUENCE_MODE = CONFIGURATION_FILTER === "listen-sequence" ||
  LISTEN_SEQUENCE_SUMMARY_MODE;
const LISTEN_PARITY_MODE = CONFIGURATION_FILTER === "listen-parity";
const FINGERING_SMOKE_MODE = CONFIGURATION_FILTER === "fingering-smoke";
const CONFIGURATIONS = [
  { name: "threads-1-all", query: "threads=1&graph=all&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-2-all", query: "threads=2&graph=all&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-4-all", query: "threads=4&graph=all&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-8-all", query: "threads=8&graph=all&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-1-disabled", query: "threads=1&graph=disabled&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-1-basic", query: "threads=1&graph=basic&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-1-extended", query: "threads=1&graph=extended&arena=1&pattern=1&mode=sequential&frames=60" },
  { name: "threads-1-no-arena", query: "threads=1&graph=all&arena=0&pattern=1&mode=sequential&frames=60" },
  { name: "threads-1-no-pattern", query: "threads=1&graph=all&arena=1&pattern=0&mode=sequential&frames=60" },
  { name: "threads-4-parallel", query: "threads=4&graph=all&arena=1&pattern=1&mode=parallel&frames=60" },
];

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForDevTools(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((candidate) => candidate.type === "page");
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome has not opened its debugging socket yet.
    }
    await delay(100);
  }
  throw new Error(`Chrome DevTools did not start on port ${port}`);
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = () => rejectOpen(new Error("Chrome DevTools WebSocket failed"));
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "Browser evaluation failed",
    );
  }
  return response.result?.value;
}

async function runConfiguration(configuration, index) {
  const profile = await mkdtemp(join(tmpdir(), "online-amt-chrome-"));
  const port = 9330 + index;
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--no-crash-upload",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let client;
  try {
    const webSocketUrl = await waitForDevTools(port);
    client = cdpClient(webSocketUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    const pageUrl = LISTEN_PARITY_MODE
      ? BASE_URL.replace(/online-amt-benchmark\.html(?:\?.*)?$/, "listen-benchmark-parity.html")
      : (LISTEN_ACCURACY_MODE || LISTEN_SEQUENCE_MODE) &&
        /online-amt-benchmark\.html(?:\?|$)/.test(BASE_URL)
      ? BASE_URL.replace(/online-amt-benchmark\.html/, "index.html")
      : BASE_URL;
    const separator = pageUrl.includes("?") ? "&" : "?";
    await client.send("Page.navigate", {
      url: `${pageUrl}${separator}${configuration.query}`,
    });
    if (FINGERING_SMOKE_MODE) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (await evaluate(client, "document.readyState === 'complete'")) break;
        await delay(100);
      }
      return await evaluate(client, `(async () => {
        const startedAt = performance.now();
        const { predictPianoFingerings } = await import("/src/fingeringModel.ts");
        const noteCount = Number(
          new URLSearchParams(location.search).get("fingering-notes") ?? "4",
        );
        const notes = Array.from({ length: noteCount }, (_, sourceIndex) => ({
          left: sourceIndex % 2 === 0,
          note: 48 + (sourceIndex % 25),
          time: Math.floor(sourceIndex / 2) * 125,
          duration: 500,
          sourceIndex,
        }));
        const predictions = await Promise.race([
          predictPianoFingerings(notes),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error("Fingering inference timed out after 20 seconds")),
            20_000,
          )),
        ]);
        return {
          crossOriginIsolated,
          elapsedMs: performance.now() - startedAt,
          predictionCount: predictions.length,
          firstPrediction: predictions[0],
          lastPrediction: predictions[predictions.length - 1],
        };
      })()`);
    }
    const deadline = Date.now() + (
      LISTEN_SEQUENCE_MODE ? 600_000 : LISTEN_PARITY_MODE ? 180_000 : 120_000
    );
    let status = "";
    while (Date.now() < deadline) {
      status = await evaluate(client, "document.body?.dataset.status ?? ''");
      if (status === "complete" || status === "error") break;
      await delay(200);
    }
    if (status !== "complete") {
      const detail = await evaluate(
        client,
        "[document.querySelector('#status')?.textContent, " +
          "document.querySelector('#result')?.textContent].filter(Boolean).join('\\n') " +
          "|| document.body?.innerText",
      );
      throw new Error(`${configuration.name} failed: ${detail}`);
    }
    return await evaluate(
      client,
      LISTEN_SEQUENCE_MODE
        ? `(() => {
            const result = window.listenSequenceBenchmarkResult;
            const exportSummary = (summary) => ({
              ...summary,
              rawRecognitionPercentage: summary.rawCompleteEvidenceRate * 100,
              thresholdQualifiedPercentage: summary.thresholdQualifiedEventRate * 100,
              independentMatcherPercentage: summary.independentMatchRate * 100,
              orderedAdvancementPercentage: summary.orderedAdvanceRate * 100,
              reasonCodeCounts: summary.reasonCounts ?? summary.failureClassifications,
              independentLatencyPercentiles: {
                p50: summary.p50IndependentMatchLatencyMs,
                p95: summary.p95IndependentMatchLatencyMs,
              },
              orderedLatencyPercentiles: {
                p50: summary.p50OrderedAdvanceLatencyMs,
                p95: summary.p95OrderedAdvanceLatencyMs,
              },
            });
            const exportEvent = (event) => ({
              position: event.index,
              targetPitches: event.targetPitches,
              playedPitches: event.playedPitches,
              scheduledAttackTimeMs: event.scheduledAttackTimeMs,
              allRequiredRawEvidencePresent: event.allRequiredRawEvidencePresent,
              thresholdQualified: event.thresholdQualified,
              independentlyMatched: event.independentlyMatched,
              independentMatchAtMs: event.independentMatchAtMs,
              independentMatchLatencyMs: event.independentMatchLatencyMs,
              orderedAdvanced: event.orderedAdvanced,
              orderedAdvancedAtMs: event.orderedAdvancedAtMs,
              orderedAdvanceLatencyMs: event.orderedAdvanceLatencyMs,
              activeTargetIndexAtAttack: event.activeTargetIndexAtAttack,
              blockedByPriorStall: event.blockedByPriorStall,
              firstRawEvidenceTimeMs: event.firstRawEvidenceTimeMs,
              firstThresholdQualifiedEvidenceTimeMs:
                event.firstThresholdQualifiedEvidenceTimeMs,
              confidentUnexpectedPitches: event.confidentUnexpectedPitches,
              expectedPitches: event.expectedPitches,
              rawFailureReasons: event.rawFailureReasons,
              independentFailureReasons: event.independentFailureReasons,
              orderedFailureReasons: event.orderedFailureReasons,
              failureReasons: event.failureReasons,
              primaryFailure: event.primaryFailure,
              unexpectedPitches: event.unexpectedPitches,
              falseAdvance: event.falseAdvance,
              skipped: event.skipped,
              duplicate: event.duplicate,
            });
            const exportRun = (run) => {
              const causalStall = run.summary.firstCausalStallIndex === null
                ? null
                : run.events[run.summary.firstCausalStallIndex] ?? null;
              return {
                policy: run.policy,
                sequenceId: run.sequenceId,
                family: run.family,
                intervalMs: run.intervalMs,
                eventRate: run.eventRate,
                ...exportSummary(run.summary),
                firstCausalStall: run.summary.firstCausalStallIndex,
                causalStall: causalStall ? exportEvent(causalStall) : null,
                blockedEventPositions: run.summary.blockedEventPositions,
                blockedEvents: run.events
                  .filter((event) => event.blockedByPriorStall)
                  .map(exportEvent),
                falseAdvanceCount: run.summary.falseAdvanceCount,
                skippedAdvanceCount: run.summary.skippedAdvanceCount,
                duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
              };
            };
            return {
              policy: result.policy,
              renderer: result.renderer,
              baseline: result.baseline,
              experimental: {
                policy: result.experimental.policy,
                bufferMs: result.experimental.bufferMs,
                comparison: result.experimental.comparison,
                perSpeed: result.experimental.speedSummaries.map(exportSummary),
                sequences: result.experimental.runs.map(exportRun),
                incompleteSequences: result.experimental.runs
                  .filter((run) => !run.summary.complete)
                  .map((run) => ({
                    sequenceId: run.sequenceId,
                    family: run.family,
                    intervalMs: run.intervalMs,
                    eventRate: run.eventRate,
                    firstStallPosition: run.summary.firstStallIndex,
                    summary: run.summary,
                    failures: run.events
                      .filter((event) => event.failureReasons.length > 0)
                      .map(exportEvent),
                  })),
              },
              perSpeed: result.speedSummaries.map(exportSummary),
              sequences: result.runs.map(exportRun),
              incompleteSequences: result.runs
                .filter((run) => !run.summary.complete)
                .map((run) => ({
                  sequenceId: run.sequenceId,
                  family: run.family,
                  intervalMs: run.intervalMs,
                  eventRate: run.eventRate,
                  firstStallPosition: run.summary.firstStallIndex,
                  summary: run.summary,
                  failures: run.events
                    .filter((event) => event.failureReasons.length > 0)
                    .map(exportEvent),
                })),
            };
          })()`
        : LISTEN_ACCURACY_MODE
        ? `(() => {
            const result = window.listenBenchmarkResult;
            return {
              renderer: result.renderer,
              correctTrialCount: result.correctTrialCount,
              successRate: result.successRate,
              falseAdvanceCount: result.falseAdvanceCount,
              ambiguousAdvanceCount: result.ambiguousAdvanceCount,
              p95OnsetToAdvanceMs: result.p95OnsetToAdvanceMs,
              courseClear: result.courseClear,
              acceptance: result.acceptance,
              failures: result.trials
                .filter((trial) =>
                  (trial.expectedCorrect && !trial.advanced) ||
                  (!trial.expectedCorrect && !trial.mathematicallyAmbiguous && trial.advanced)
                )
                .map((trial) => ({
                  fixtureGroup: trial.fixtureGroup,
                  measure: trial.measure,
                  moment: trial.moment,
                  targetPitches: trial.targetPitches,
                  playedPitches: trial.playedPitches,
                  advanced: trial.advanced,
                  recognizedOnsets: trial.recognizedOnsets,
                })),
            };
          })()`
        : LISTEN_PARITY_MODE
        ? "window.listenBenchmarkParityResult"
        : "window.onlineAmtBenchmarkResult",
    );
  } finally {
    client?.close();
    chrome.kill();
    await Promise.race([
      new Promise((resolveExit) => chrome.once("exit", resolveExit)),
      delay(2_000),
    ]);
    const resolvedProfile = resolve(profile);
    const temporaryRoot = resolve(tmpdir()) + sep;
    if (
      resolvedProfile.startsWith(temporaryRoot) &&
      basename(resolvedProfile).startsWith("online-amt-chrome-")
    ) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(resolvedProfile, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 4) {
            console.error(`Could not remove temporary Chrome profile: ${error}`);
          } else {
            await delay(500);
          }
        }
      }
    }
  }
}

const selectedConfigurations = FINGERING_SMOKE_MODE
  ? [{
      name: "fingering-smoke",
      query: `fingering-notes=${process.argv[4] ?? "500"}`,
    }]
  : LISTEN_SEQUENCE_MODE
  ? [{
      name: LISTEN_SEQUENCE_SUMMARY_MODE ? "listen-sequence-summary" : "listen-sequence",
      query: "listen-sequence=auto",
    }]
  : LISTEN_PARITY_MODE
  ? [{ name: "listen-parity", query: "" }]
  : LISTEN_ACCURACY_MODE
  ? [{ name: "listen-accuracy", query: "listen-benchmark=auto" }]
  : CONFIGURATION_FILTER
  ? CONFIGURATIONS.filter(({ name }) => name === CONFIGURATION_FILTER)
  : CONFIGURATIONS;
if (selectedConfigurations.length === 0) {
  throw new Error(`Unknown benchmark configuration: ${CONFIGURATION_FILTER}`);
}
const results = [];
for (let index = 0; index < selectedConfigurations.length; index += 1) {
  const configuration = selectedConfigurations[index];
  const result = await runConfiguration(configuration, index);
  const conciseSpeed = (summary) => ({
    intervalMs: summary.intervalMs,
    eventRate: summary.eventRate,
    sequenceCount: summary.sequenceCount,
    completePassageCount: Math.round(summary.completePassageRate * summary.sequenceCount),
    completePassageRate: summary.completePassageRate,
    rawCompleteEvidenceCount: summary.rawCompleteEvidenceCount,
    rawCompleteEvidenceRate: summary.rawCompleteEvidenceRate,
    independentMatchCount: summary.independentMatchCount,
    independentMatchRate: summary.independentMatchRate,
    orderedAdvanceCount: summary.orderedAdvanceCount,
    orderedAdvanceRate: summary.orderedAdvanceRate,
    correctAdvanceCount: summary.correctAdvanceCount,
    expectedEventCount: summary.expectedEventCount,
    recognizedButBlockedCount: summary.recognizedButBlockedCount,
    firstStalls: summary.firstStalls,
    failureClassifications: summary.failureClassifications,
    falseAdvanceCount: summary.falseAdvanceCount,
    skippedAdvanceCount: summary.skippedAdvanceCount,
    duplicateAdvanceCount: summary.duplicateAdvanceCount,
    p95IndependentMatchLatencyMs: summary.p95IndependentMatchLatencyMs,
    p95OrderedAdvanceLatencyMs: summary.p95OrderedAdvanceLatencyMs,
  });
  const conciseSafety = (runs) => ({
    falseAdvanceCount: runs.reduce((total, run) => total + run.falseAdvanceCount, 0),
    skippedAdvanceCount: runs.reduce((total, run) => total + run.skippedAdvanceCount, 0),
    duplicateAdvanceCount: runs.reduce((total, run) => total + run.duplicateAdvanceCount, 0),
    runs: runs.map((run) => ({
      sequenceId: run.sequenceId,
      intervalMs: run.intervalMs,
      correctAdvanceRate: run.correctAdvanceRate,
      falseAdvanceCount: run.falseAdvanceCount,
      skippedAdvanceCount: run.skippedAdvanceCount,
      duplicateAdvanceCount: run.duplicateAdvanceCount,
    })),
  });
  const exportedResult = LISTEN_SEQUENCE_SUMMARY_MODE
    ? {
        renderer: result.renderer,
        baseline: result.baseline,
        perSpeed: result.perSpeed.map(conciseSpeed),
        experimental: {
          comparison: result.experimental.comparison,
          perSpeed: result.experimental.perSpeed.map(conciseSpeed),
        },
        safety: {
          current: conciseSafety(result.sequences.filter(({ family }) => family === "safety")),
          buffered: conciseSafety(
            result.experimental.sequences.filter(({ family }) => family === "safety"),
          ),
        },
      }
    : result;
  results.push({ name: configuration.name, ...exportedResult });
  if (result.wall) {
    console.error(
      `${configuration.name}: p50=${result.wall.p50Ms.toFixed(2)}ms ` +
      `p95=${result.wall.p95Ms.toFixed(2)}ms p99=${result.wall.p99Ms.toFixed(2)}ms`,
    );
  } else if (FINGERING_SMOKE_MODE) {
    console.error(
      `${configuration.name}: ${result.predictionCount} predictions in ` +
      `${result.elapsedMs.toFixed(2)}ms`,
    );
  } else if (LISTEN_PARITY_MODE) {
    console.error(`${configuration.name}: ${result.checks.length} parity checks passed`);
  } else if (LISTEN_SEQUENCE_MODE) {
    const slowest = result.perSpeed[0];
    const fastest = result.perSpeed.at(-1);
    const comparison = result.experimental.comparison;
    console.error(
      `${configuration.name}: complete=${(slowest.completePassageRate * 100).toFixed(1)}%` +
      `→${(fastest.completePassageRate * 100).toFixed(1)}% ` +
      `incomplete=${result.incompleteSequences.length} ` +
      `fast-p95=${fastest.p95OnsetToAdvanceMs ?? "n/a"}ms ` +
      `buffer-correct=${comparison.correctAdvanceImprovement >= 0 ? "+" : ""}` +
      `${comparison.correctAdvanceImprovement} ` +
      `buffer-complete=${comparison.completePassageImprovement >= 0 ? "+" : ""}` +
      `${comparison.completePassageImprovement} ` +
      `buffer-safety=${comparison.bufferedFalseAdvanceCount}/` +
      `${comparison.bufferedSkippedAdvanceCount}/${comparison.bufferedDuplicateAdvanceCount} ` +
      `accepted=${comparison.accepted}`,
    );
  } else {
    console.error(
      `${configuration.name}: success=${(result.successRate * 100).toFixed(1)}% ` +
      `false-advances=${result.falseAdvanceCount} ` +
      `p95=${result.p95OnsetToAdvanceMs ?? "n/a"}ms`,
    );
  }
}
console.log(JSON.stringify(results, null, 2));
