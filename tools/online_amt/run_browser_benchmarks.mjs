import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = process.argv[2] ?? "http://127.0.0.1:5173/online-amt-benchmark.html";
const CONFIGURATION_FILTER = process.argv[3];
const LISTEN_SMOKE_MODE = CONFIGURATION_FILTER === "listen-smoke";
const LISTEN_ACCURACY_MODE = CONFIGURATION_FILTER === "listen-accuracy";
const LISTEN_SEQUENCE_SUMMARY_MODE = CONFIGURATION_FILTER === "listen-sequence-summary";
const LISTEN_SEQUENCE_MODE = CONFIGURATION_FILTER === "listen-sequence" ||
  LISTEN_SEQUENCE_SUMMARY_MODE;
const LISTEN_THRESHOLD_SWEEP_MODE = CONFIGURATION_FILTER === "listen-threshold-sweep";
const LISTEN_RETRIGGER_SWEEP_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-retrigger-sweep-summary";
const LISTEN_RETRIGGER_SWEEP_MODE = CONFIGURATION_FILTER === "listen-retrigger-sweep" ||
  LISTEN_RETRIGGER_SWEEP_SUMMARY_MODE;
const LISTEN_ARTICULATION_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-articulation-summary";
const LISTEN_ARTICULATION_MODE = CONFIGURATION_FILTER === "listen-articulation" ||
  LISTEN_ARTICULATION_SUMMARY_MODE;
const LISTEN_INFERENCE_RESET_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-inference-reset-summary";
const LISTEN_INFERENCE_RESET_MODE = CONFIGURATION_FILTER === "listen-inference-reset" ||
  LISTEN_INFERENCE_RESET_SUMMARY_MODE;
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

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : null;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  if (port === null) throw new Error("Could not allocate a Chrome DevTools port");
  return port;
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
  const listeners = new Map();
  let nextId = 1;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
      return;
    }
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
    on(method, listener) {
      const registered = listeners.get(method) ?? [];
      registered.push(listener);
      listeners.set(method, registered);
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

async function runConfiguration(configuration) {
  const profile = await mkdtemp(join(tmpdir(), "online-amt-chrome-"));
  const port = await availableLoopbackPort();
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
      "--remote-debugging-address=127.0.0.1",
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
    const pageErrors = [];
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      pageErrors.push(
        exceptionDetails?.exception?.description ?? exceptionDetails?.text ??
          "Unreported page exception",
      );
    });
    client.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type !== "error") return;
      pageErrors.push(args?.map(({ value, description }) => value ?? description).join(" ") ??
        "Unreported console error");
    });
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    const pageUrl = LISTEN_PARITY_MODE
      ? BASE_URL.replace(/online-amt-benchmark\.html(?:\?.*)?$/, "listen-benchmark-parity.html")
      : (LISTEN_SMOKE_MODE || LISTEN_ACCURACY_MODE || LISTEN_SEQUENCE_MODE ||
        LISTEN_THRESHOLD_SWEEP_MODE ||
        LISTEN_RETRIGGER_SWEEP_MODE || LISTEN_ARTICULATION_MODE ||
        LISTEN_INFERENCE_RESET_MODE) &&
        /online-amt-benchmark\.html(?:\?|$)/.test(BASE_URL)
      ? BASE_URL.replace(/online-amt-benchmark\.html/, "index.html")
      : BASE_URL;
    const separator = pageUrl.includes("?") ? "&" : "?";
    await client.send("Page.navigate", {
      url: `${pageUrl}${separator}${configuration.query}`,
    });
    if (LISTEN_SMOKE_MODE) {
      return await evaluate(client, `(async () => {
        const startedAt = performance.now();
        const [{ captureIsolatedOnlineAmtBenchmark }, { OnlineAmtSession }, audio] =
          await Promise.all([
            import("/src/listenBenchmark.ts"),
            import("/src/onlineAmtSession.ts"),
            import("/src/listenBenchmarkAudio.ts"),
          ]);
        const renderer = new URLSearchParams(location.search).get("benchmark-renderer") === "tone"
          ? audio.LISTEN_BENCHMARK_TONE_RENDERER
          : audio.LISTEN_BENCHMARK_RENDERER;
        const session = await OnlineAmtSession.create({
          modelUrl: new URL("/models/online_amt_streaming.onnx", location.href).href,
          numThreads: 1,
          graphOptimizationLevel: "all",
          enableCpuMemArena: true,
          enableMemPattern: true,
          executionMode: "sequential",
        });
        try {
          const result = await captureIsolatedOnlineAmtBenchmark({
            generation: 1,
            targetPitches: [60, 64, 67],
            playedPitches: [60, 64, 67],
            session,
            renderer,
          });
          if (!result.advanced) {
            throw new Error("The smoke-test C-major chord did not advance.");
          }
          if (result.renderer?.version !== renderer.version) {
            throw new Error(
              \`Expected renderer \${renderer.version}, received \${result.renderer?.version}.\`,
            );
          }
          return {
            passed: true,
            renderer: result.renderer,
            targetPitches: [60, 64, 67],
            advanced: result.advanced,
            onsetToAdvanceMs: result.onsetToAdvanceMs,
            maximumInferenceMs: result.analysisMs,
            audioDiagnostics: result.audioDiagnostics,
            recognizedOnsets: result.recognizedOnsets,
            traceFrameCount: result.trace?.frames.length ?? 0,
            elapsedMs: performance.now() - startedAt,
          };
        } finally {
          await session.dispose();
        }
      })()`);
    }
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
      LISTEN_RETRIGGER_SWEEP_MODE
        ? 1_200_000
        : (LISTEN_ACCURACY_MODE || LISTEN_SEQUENCE_MODE || LISTEN_THRESHOLD_SWEEP_MODE ||
          LISTEN_ARTICULATION_MODE)
        ? 600_000
        : LISTEN_PARITY_MODE ? 180_000 : 120_000
    );
    let status = "";
    while (Date.now() < deadline) {
      status = await evaluate(client, "document.body?.dataset.status ?? ''");
      if (status === "complete" || status === "error") break;
      if (pageErrors.length > 0) {
        throw new Error(`${configuration.name} page error: ${pageErrors.join("\n")}`);
      }
      await delay(200);
    }
    if (status !== "complete") {
      const detail = await evaluate(client, `(() => ({
        href: location.href,
        readyState: document.readyState,
        status: document.body?.dataset.status ?? "",
        bodyText: document.body?.innerText ?? "",
        rootHtmlLength: document.querySelector("#root")?.innerHTML.length ?? 0,
      }))()`);
      throw new Error(`${configuration.name} failed: ${JSON.stringify(detail)}`);
    }
    return await evaluate(
      client,
      LISTEN_RETRIGGER_SWEEP_MODE
        ? `(() => {
            const result = window.listenRetriggerSweepResult;
            const exportCandidate = (candidate) => ({
              options: candidate.options,
              eligible: candidate.eligible,
              rejectedByDecoderSafety: candidate.rejectedByDecoderSafety,
              rejectedByMatcherSafety: candidate.rejectedByMatcherSafety,
              rejectionReasons: candidate.rejectionReasons,
              decoder: candidate.decoder,
              matcherProfiles: candidate.matcherProfiles,
            });
            return {
              renderer: result.renderer,
              benchmarkOnly: result.benchmarkOnly,
              productionEnabled: result.productionEnabled,
              replayParityVerified: result.replayParityVerified,
              traceIdentities: result.traceIdentities,
              audit: result.audit,
              gridSize: result.gridSize,
              candidatesEvaluated: result.candidatesEvaluated,
              uniqueSyntheticStreamsEvaluated: result.uniqueSyntheticStreamsEvaluated,
              candidatesRejectedByDecoderSafety: result.candidatesRejectedByDecoderSafety,
              candidatesRejectedByMatcherSafety: result.candidatesRejectedByMatcherSafety,
              matcherProfiles: result.matcherProfiles,
              candidates: result.candidates.map(exportCandidate),
              eligibleCandidates: result.eligibleCandidates.map(exportCandidate),
              recommendation: result.recommendation
                ? exportCandidate(result.recommendation)
                : null,
              diagnosticCandidate: result.diagnosticCandidate
                ? exportCandidate(result.diagnosticCandidate)
                : null,
              conclusion: result.conclusion,
            };
          })()`
        : LISTEN_INFERENCE_RESET_MODE
        ? `(() => {
            const result = window.listenInferenceResetBenchmarkResult;
            const control = (run) => ({
              independentMatchCount: run.summary.independentMatchCount,
              independentMatchRate: run.summary.independentMatchRate,
              orderedAdvanceCount: run.summary.orderedAdvanceCount,
              orderedAdvanceRate: run.summary.orderedAdvanceRate,
              falseAdvanceCount: run.summary.falseAdvanceCount,
              skippedAdvanceCount: run.summary.skippedAdvanceCount,
              duplicateAdvanceCount: run.summary.duplicateAdvanceCount,
              p50IndependentMatchLatencyMs: run.summary.p50IndependentMatchLatencyMs,
              p95IndependentMatchLatencyMs: run.summary.p95IndependentMatchLatencyMs,
              p50OrderedAdvanceLatencyMs: run.summary.p50OrderedAdvanceLatencyMs,
              p95OrderedAdvanceLatencyMs: run.summary.p95OrderedAdvanceLatencyMs,
            });
            return {
              sequenceId: result.sequenceId,
              intervalMs: result.intervalMs,
              renderer: result.renderer,
              audioDiagnostics: result.audioDiagnostics,
              audioSignature: result.audioSignature,
              resetPlan: result.resetPlan,
              conclusion: result.conclusion,
              summary: result.summary,
              controls: {
                isolated: {
                  independentMatchCount: result.events.filter((event) => event.isolated.event.independentlyMatched).length,
                  independentMatchRate: result.events.filter((event) => event.isolated.event.independentlyMatched).length / result.events.length,
                  orderedAdvanceCount: result.events.filter((event) => event.isolated.event.orderedAdvanced).length,
                  orderedAdvanceRate: result.events.filter((event) => event.isolated.event.orderedAdvanced).length / result.events.length,
                  falseAdvanceCount: 0,
                  skippedAdvanceCount: 0,
                  duplicateAdvanceCount: 0,
                },
                stateful: control(result.stateful),
                eventReset: control(result.eventReset),
              },
              classifications: result.events.map((event) => ({
                index: event.index,
                targetPitches: event.targetPitches,
                classification: event.classification,
                rawEvidenceDelta: event.rawEvidenceDelta,
                freshAttackDelta: event.freshAttackDelta,
                independentMatchDelta: event.independentMatchDelta,
                orderedAdvanceDelta: event.orderedAdvanceDelta,
                rawModelOutputChangedAfterReset: event.rawModelOutputChangedAfterReset,
                decoderEventsChangedAfterReset: event.decoderEventsChangedAfterReset,
                statefulSustainBecameResetOnset: event.statefulSustainBecameResetOnset,
                independentLatencyDeltaMs: event.independentLatencyDeltaMs,
                orderedLatencyDeltaMs: event.orderedLatencyDeltaMs,
              })),
            };
          })()`
        : LISTEN_ARTICULATION_MODE
        ? `(() => {
            const result = window.listenArticulationBenchmarkResult;
            return {
              renderer: result.renderer,
              intervalMs: result.intervalMs,
              eventCount: result.eventCount,
              conclusion: result.conclusion,
              profiles: result.runs.map((profile) => ({
                articulation: profile.articulation,
                summary: profile.summary,
                deltaFromNormal: profile.deltaFromNormal,
                failures: profile.run.events
                  .filter((event) => event.failureReasons.length > 0)
                  .map((event) => ({
                    position: event.index,
                    targetPitches: event.targetPitches,
                    playedPitches: event.playedPitches,
                    expectedPitchFailures: event.expectedPitches
                      .filter((pitch) => !pitch.requiredRawEvidencePresent || !pitch.thresholdQualified)
                      .map((pitch) => ({
                        midi: pitch.midi,
                        requiredAttackType: pitch.requiredAttackType,
                        observedAttackType: pitch.observedAttackType,
                        rawAttackDetected: pitch.rawAttackDetected,
                        maximumOnsetConfidence: pitch.maximumOnsetConfidence,
                        maximumActiveConfidence: pitch.maximumActiveConfidence,
                      })),
                    rawFailureReasons: event.rawFailureReasons,
                    independentFailureReasons: event.independentFailureReasons,
                    orderedFailureReasons: event.orderedFailureReasons,
                    primaryFailure: event.primaryFailure,
                    staleState: (() => {
                      const stale = profile.events[event.index];
                      return {
                        expectedFreshAttackCount: stale.expectedFreshAttackCount,
                        producedFreshAttackCount: stale.producedFreshAttackCount,
                        repeatedPitchesInSustain: stale.repeatedPitchesInSustain,
                        departingPitchesStillActive: stale.departingPitches
                          .filter((pitch) => pitch.activeAtNextAttack)
                          .map((pitch) => pitch.midi),
                        departingPitchesWithoutOffset: stale.departingPitches
                          .filter((pitch) => !pitch.offsetBeforeNextAttack)
                          .map((pitch) => pitch.midi),
                        confidentPreviousChordExtraPitches:
                          stale.confidentPreviousChordExtraPitches,
                        silenceGapRms: stale.silenceGap?.rms ?? null,
                        failureClassification: stale.failureClassification,
                      };
                    })(),
                  })),
              })),
            };
          })()`
        : LISTEN_THRESHOLD_SWEEP_MODE
        ? `(() => {
            const result = window.listenThresholdSweepResult;
            const exportCandidate = (candidate, detailed = false) => ({
              profile: candidate.profile,
              eligible: candidate.eligible,
              rejectedBySafety: candidate.rejectedBySafety,
              safety: candidate.safety,
              independentMatchCount: candidate.independentMatchCount,
              orderedAdvanceCount: candidate.orderedAdvanceCount,
              orderedPrefixCompleted: candidate.orderedPrefixCompleted,
              completePassageCount: candidate.completePassageCount,
              p95OrderedAdvanceLatencyMs: candidate.p95OrderedAdvanceLatencyMs,
              nonSafetyDeltasFromProduction: candidate.nonSafetyDeltasFromProduction,
              ...(detailed ? {
                speedSummaries: candidate.speedSummaries,
                familySpeedSummaries: candidate.familySpeedSummaries,
              } : {}),
            });
            return {
              productionProfile: result.productionProfile,
              gridSize: result.gridSize,
              profilesEvaluated: result.profilesEvaluated,
              profilesRejectedBySafety: result.profilesRejectedBySafety,
              productionBaseline: exportCandidate(result.productionBaseline, true),
              candidates: result.candidates.map(exportCandidate),
              paretoFrontier: result.paretoFrontier.map((candidate) => (
                exportCandidate(candidate, true)
              )),
              recommendation: exportCandidate(result.recommendation, true),
              noSafeImprovement: result.noSafeImprovement,
              replayParityVerified: result.replayParityVerified,
            };
          })()`
        : LISTEN_SEQUENCE_MODE
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

function pairedRendererConfigurations(name, query) {
  return [
    {
      name: `${name}-legacy`,
      query: `${query}&benchmark-renderer=legacy`,
    },
    {
      name: `${name}-tone`,
      query: `${query}&benchmark-renderer=tone`,
    },
  ];
}

const selectedConfigurations = FINGERING_SMOKE_MODE
  ? [{
      name: "fingering-smoke",
      query: `fingering-notes=${process.argv[4] ?? "500"}`,
    }]
  : LISTEN_SMOKE_MODE
  ? pairedRendererConfigurations("listen-smoke", "listen-smoke=auto")
  : LISTEN_RETRIGGER_SWEEP_MODE
  ? pairedRendererConfigurations(
      LISTEN_RETRIGGER_SWEEP_SUMMARY_MODE
        ? "listen-retrigger-sweep-summary"
        : "listen-retrigger-sweep",
      "listen-retrigger-sweep=auto",
    )
  : LISTEN_SEQUENCE_MODE
  ? pairedRendererConfigurations(
      LISTEN_SEQUENCE_SUMMARY_MODE ? "listen-sequence-summary" : "listen-sequence",
      "listen-sequence=auto",
    )
  : LISTEN_THRESHOLD_SWEEP_MODE
  ? pairedRendererConfigurations(
      "listen-threshold-sweep",
      "listen-threshold-sweep=auto",
    )
  : LISTEN_INFERENCE_RESET_MODE
  ? pairedRendererConfigurations(
      LISTEN_INFERENCE_RESET_SUMMARY_MODE
        ? "listen-inference-reset-summary"
        : "listen-inference-reset",
      "listen-inference-reset=auto",
    )
  : LISTEN_ARTICULATION_MODE
  ? pairedRendererConfigurations(
      LISTEN_ARTICULATION_SUMMARY_MODE
        ? "listen-articulation-summary"
        : "listen-articulation",
      "listen-articulation=auto",
    )
  : LISTEN_PARITY_MODE
  ? [{ name: "listen-parity", query: "" }]
  : LISTEN_ACCURACY_MODE
  ? pairedRendererConfigurations("listen-accuracy", "listen-benchmark=auto")
  : CONFIGURATION_FILTER
  ? CONFIGURATIONS.filter(({ name }) => name === CONFIGURATION_FILTER)
  : CONFIGURATIONS;
if (selectedConfigurations.length === 0) {
  throw new Error(`Unknown benchmark configuration: ${CONFIGURATION_FILTER}`);
}
const results = [];
for (let index = 0; index < selectedConfigurations.length; index += 1) {
  const configuration = selectedConfigurations[index];
  const result = await runConfiguration(configuration);
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
  const exportedResult = LISTEN_RETRIGGER_SWEEP_SUMMARY_MODE
    ? (() => {
        const selected = result.recommendation ?? result.diagnosticCandidate;
        const selectedSummary = selected ? {
          options: selected.options,
          eligible: selected.eligible,
          rejectionReasons: selected.rejectionReasons,
          decoder: {
            ...selected.decoder,
            syntheticEvents: selected.decoder.syntheticEvents.filter((event) => (
              event.recoveredMissingPhysicalAttack || event.unassigned ||
              event.duplicateNaturalAttack || event.duringHeldNote ||
              event.duringReleaseTail || event.duringLegatoNonsharedTransition ||
              event.duringIncompleteCarriedBassAttack
            )),
          },
          matcherProfiles: selected.matcherProfiles,
        } : null;
        return {
          renderer: result.renderer,
          benchmarkOnly: result.benchmarkOnly,
          productionEnabled: result.productionEnabled,
          replayParityVerified: result.replayParityVerified,
          traceIdentities: result.traceIdentities,
          audit: {
            conclusion: result.audit.conclusion,
            hiddenRiseCount: result.audit.hiddenRiseCount,
            classificationCounts: result.audit.classificationCounts,
            hiddenRiseOpportunities: result.audit.opportunities.filter(({ classification }) => (
              classification === "hidden-rise-under-sustain"
            )),
          },
          gridSize: result.gridSize,
          candidatesEvaluated: result.candidatesEvaluated,
          uniqueSyntheticStreamsEvaluated: result.uniqueSyntheticStreamsEvaluated,
          candidatesRejectedByDecoderSafety: result.candidatesRejectedByDecoderSafety,
          candidatesRejectedByMatcherSafety: result.candidatesRejectedByMatcherSafety,
          eligibleCandidateCount: result.eligibleCandidates.length,
          matcherProfiles: result.matcherProfiles,
          recommendation: result.recommendation ? selectedSummary : null,
          diagnosticCandidate: result.recommendation ? null : selectedSummary,
          conclusion: result.conclusion,
        };
      })()
    : LISTEN_INFERENCE_RESET_SUMMARY_MODE
    ? {
        sequenceId: result.sequenceId,
        intervalMs: result.intervalMs,
        renderer: result.renderer,
        audioDiagnostics: {
          frameCount: result.audioDiagnostics.frameCount,
          durationMs: result.audioDiagnostics.durationMs,
          peak: result.audioDiagnostics.peak,
          rms: result.audioDiagnostics.rms,
        },
        audioSignature: result.audioSignature,
        resetPlan: result.resetPlan,
        summary: result.summary,
        conclusion: result.conclusion,
        controls: result.controls,
      }
    : LISTEN_ARTICULATION_SUMMARY_MODE
    ? {
        renderer: result.renderer,
        intervalMs: result.intervalMs,
        eventCount: result.eventCount,
        conclusion: result.conclusion,
        profiles: result.profiles.map((profile) => ({
          articulation: profile.articulation,
          summary: profile.summary,
          deltaFromNormal: profile.deltaFromNormal,
        })),
      }
    : LISTEN_THRESHOLD_SWEEP_MODE
    ? (() => {
        const exportCandidate = (candidate, detailed = false) => ({
          profile: candidate.profile,
          eligible: candidate.eligible,
          rejectedBySafety: candidate.rejectedBySafety,
          safety: candidate.safety,
          independentMatchCount: candidate.independentMatchCount,
          orderedAdvanceCount: candidate.orderedAdvanceCount,
          orderedPrefixCompleted: candidate.orderedPrefixCompleted,
          completePassageCount: candidate.completePassageCount,
          p95OrderedAdvanceLatencyMs: candidate.p95OrderedAdvanceLatencyMs,
          nonSafetyDeltasFromProduction: candidate.nonSafetyDeltasFromProduction,
          ...(detailed ? {
            speedSummaries: candidate.speedSummaries,
            familySpeedSummaries: candidate.familySpeedSummaries,
          } : {}),
        });
        return {
          renderer: result.renderer,
          productionProfile: result.productionProfile,
          gridSize: result.gridSize,
          profilesEvaluated: result.profilesEvaluated,
          profilesRejectedBySafety: result.profilesRejectedBySafety,
          productionBaseline: exportCandidate(result.productionBaseline, true),
          candidates: result.candidates.map(exportCandidate),
          paretoFrontier: result.paretoFrontier.map((candidate) => (
            exportCandidate(candidate, true)
          )),
          recommendation: exportCandidate(result.recommendation, true),
          noSafeImprovement: result.noSafeImprovement,
          replayParityVerified: result.replayParityVerified,
        };
      })()
    : LISTEN_SEQUENCE_SUMMARY_MODE
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
  if (LISTEN_SMOKE_MODE) {
    console.error(
      `${configuration.name}: passed=${result.passed} ` +
      `advanced=${result.advanced} onset=${result.onsetToAdvanceMs}ms ` +
      `inference=${result.maximumInferenceMs.toFixed(2)}ms ` +
      `peak=${result.audioDiagnostics.peak.toFixed(6)} ` +
      `elapsed=${result.elapsedMs.toFixed(0)}ms`,
    );
  } else if (result.wall) {
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
  } else if (LISTEN_RETRIGGER_SWEEP_MODE) {
    const selected = result.recommendation ?? result.diagnosticCandidate;
    console.error(
      `${configuration.name}: conclusion=${result.conclusion.code} ` +
      `hidden=${result.audit.hiddenRiseCount} ` +
      `evaluated=${result.candidatesEvaluated}/${result.gridSize} ` +
      `streams=${result.uniqueSyntheticStreamsEvaluated} ` +
      `eligible=${result.eligibleCandidates.length} ` +
      `selected=${selected?.options.id ?? "none"} ` +
      `recovered=${selected?.decoder.recoveredMissingPhysicalAttacks ?? 0} ` +
      `synthetic=${selected?.decoder.syntheticEventCount ?? 0} ` +
      `false=${selected?.decoder.unassignedSyntheticEventCount ?? 0} ` +
      `duplicate=${selected?.decoder.duplicateNaturalEventCount ?? 0}`,
    );
  } else if (LISTEN_ARTICULATION_MODE) {
    const detached = result.profiles.find(({ articulation }) => articulation === "detached");
    console.error(
      `${configuration.name}: conclusion=${result.conclusion.code} ` +
      `detached-independent=${detached.summary.independentMatchCount}/${result.eventCount} ` +
      `delta=${detached.deltaFromNormal.independentMatchCount >= 0 ? "+" : ""}` +
      `${detached.deltaFromNormal.independentMatchCount} ` +
      `safety=${detached.summary.falseAdvanceCount}/` +
      `${detached.summary.skippedAdvanceCount}/${detached.summary.duplicateAdvanceCount}`,
    );
  } else if (LISTEN_INFERENCE_RESET_MODE) {
    const summary = result.summary;
    console.error(
      `${configuration.name}: conclusion=${result.conclusion.code} ` +
      `recovered/lost=${summary.recoveredEventCount}/${summary.lostEventCount} ` +
      `independent=${summary.independentMatchCounts.stateful}/` +
      `${summary.independentMatchCounts.eventReset} ` +
      `ordered=${summary.orderedAdvanceCounts.stateful}/` +
      `${summary.orderedAdvanceCounts.eventReset} ` +
      `safety=${summary.statefulSafety.total}/${summary.eventResetSafety.total} ` +
      `raw-delta=${summary.rawEvidenceDelta} ` +
      `audio=${result.audioSignature.pcmHash}`,
    );
  } else if (LISTEN_THRESHOLD_SWEEP_MODE) {
    console.error(
      `${configuration.name}: evaluated=${result.profilesEvaluated}/${result.gridSize} ` +
      `rejected-safety=${result.profilesRejectedBySafety} ` +
      `frontier=${result.paretoFrontier.length} ` +
      `recommendation=${result.recommendation.profile.id} ` +
      `no-safe-improvement=${result.noSafeImprovement}`,
    );
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
