import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// Measured results are only comparable within one browser build, so the browser
// stays explicit rather than discovered. CHROME_PATH names it on machines where
// the Windows development install is not the one running the benchmark.
const CHROME = process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");
const BASE_URL = process.argv[2] ?? "http://127.0.0.1:5173/online-amt-benchmark.html";
const CONFIGURATION_FILTER = process.argv[3];
const LISTEN_SMOKE_MODE = CONFIGURATION_FILTER === "listen-smoke";
const LISTEN_DYNAMICS_SMOKE_MODE = CONFIGURATION_FILTER === "listen-dynamics-smoke";
const LISTEN_ACCURACY_MODE = CONFIGURATION_FILTER === "listen-accuracy";
const LISTEN_SEQUENCE_SUMMARY_MODE = CONFIGURATION_FILTER === "listen-sequence-summary";
const LISTEN_SEQUENCE_MODE = CONFIGURATION_FILTER === "listen-sequence" ||
  LISTEN_SEQUENCE_SUMMARY_MODE;
const LISTEN_THRESHOLD_SWEEP_MODE = CONFIGURATION_FILTER === "listen-threshold-sweep";
const LISTEN_MULTIDOMAIN_SWEEP_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-matcher-multidomain-sweep-summary";
const LISTEN_MULTIDOMAIN_SWEEP_MODE = CONFIGURATION_FILTER ===
  "listen-matcher-multidomain-sweep" || LISTEN_MULTIDOMAIN_SWEEP_SUMMARY_MODE;
// Full evidence commands can archive their complete JSON directly. The output
// environment variable is honored for every command. Task 08's positional path
// remains supported; validation matrices also accept a path after their optional
// corpus-filter argument, including renderer-scoped variants.
const POSITIONAL_LISTEN_VALIDATION_OUTPUT_FILTERS = new Set([
  "listen-sequence-profile-validation",
  "listen-sequence-profile-validation-legacy",
  "listen-sequence-profile-validation-tone",
  "listen-dynamics-profile-validation",
  "listen-dynamics-profile-validation-legacy",
  "listen-dynamics-profile-validation-tone",
]);
const LISTEN_BENCHMARK_OUTPUT_PATH = process.env.LISTEN_BENCHMARK_OUTPUT_PATH ?? (
  CONFIGURATION_FILTER === "listen-matcher-multidomain-sweep"
    ? process.argv[4]
    : POSITIONAL_LISTEN_VALIDATION_OUTPUT_FILTERS.has(CONFIGURATION_FILTER)
    ? process.argv[5]
    : undefined
);
const LISTEN_PROFILE_VALIDATION_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-profile-validation-summary";
// The unified production-candidate gate: all three matrices in one pass, then
// one eligibility decision. The historical per-domain commands are unchanged.
const LISTEN_PROFILE_VALIDATION_MODE = [
  "listen-profile-validation",
  "listen-profile-validation-legacy",
  "listen-profile-validation-tone",
].includes(CONFIGURATION_FILTER) || LISTEN_PROFILE_VALIDATION_SUMMARY_MODE;
// A focused smoke narrows the corpus; the gate then reports incomplete evidence
// rather than eligibility, because an absolute floor needs its whole corpus.
const PROFILE_VALIDATION_INTERVALS_MS = LISTEN_PROFILE_VALIDATION_MODE
  ? process.argv[4]
  : undefined;
const PROFILE_VALIDATION_SUITES = LISTEN_PROFILE_VALIDATION_MODE
  ? process.argv[5]
  : undefined;
const LISTEN_ISOLATED_VALIDATION_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-isolated-profile-validation-summary";
const LISTEN_ISOLATED_VALIDATION_MODE = [
  "listen-isolated-profile-validation",
  "listen-isolated-profile-validation-legacy",
  "listen-isolated-profile-validation-tone",
].includes(CONFIGURATION_FILTER) || LISTEN_ISOLATED_VALIDATION_SUMMARY_MODE;
const LISTEN_SEQUENCE_VALIDATION_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-sequence-profile-validation-summary";
const LISTEN_SEQUENCE_VALIDATION_MODE = [
  "listen-sequence-profile-validation",
  "listen-sequence-profile-validation-legacy",
  "listen-sequence-profile-validation-tone",
].includes(CONFIGURATION_FILTER) || LISTEN_SEQUENCE_VALIDATION_SUMMARY_MODE;
// A focused smoke names one or more corpus speeds; absent, all six are captured.
const SEQUENCE_VALIDATION_INTERVALS_MS = LISTEN_SEQUENCE_VALIDATION_MODE
  ? process.argv[4]
  : undefined;
const LISTEN_DYNAMICS_VALIDATION_SUMMARY_MODE = CONFIGURATION_FILTER ===
  "listen-dynamics-profile-validation-summary";
const LISTEN_DYNAMICS_VALIDATION_MODE = [
  "listen-dynamics-profile-validation",
  "listen-dynamics-profile-validation-legacy",
  "listen-dynamics-profile-validation-tone",
].includes(CONFIGURATION_FILTER) || LISTEN_DYNAMICS_VALIDATION_SUMMARY_MODE;
// A focused smoke names one or more suites; absent, all three are captured.
const DYNAMICS_VALIDATION_SUITES = LISTEN_DYNAMICS_VALIDATION_MODE
  ? process.argv[4]
  : undefined;
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
const LISTEN_DYNAMICS_CONSTANT_MODE = [
  "listen-dynamics-constant",
  "listen-dynamics-constant-legacy",
  "listen-dynamics-constant-tone",
].includes(CONFIGURATION_FILTER);
const LISTEN_DYNAMICS_MIXED_MODE = [
  "listen-dynamics-mixed",
  "listen-dynamics-mixed-legacy",
  "listen-dynamics-mixed-tone",
].includes(CONFIGURATION_FILTER);
const LISTEN_DYNAMICS_CASE_MODE = [
  "listen-dynamics-case",
  "listen-dynamics-case-legacy",
  "listen-dynamics-case-tone",
].includes(CONFIGURATION_FILTER);
const DYNAMICS_CASE_PIANO = process.argv[4] ?? "salamander";
const DYNAMICS_CASE_LAYER = process.argv[5] ?? "v05";
const LISTEN_SEQUENCE_CASE_MODE = [
  "listen-sequence-case",
  "listen-sequence-case-legacy",
  "listen-sequence-case-tone",
].includes(CONFIGURATION_FILTER);
const SEQUENCE_CASE_SEQUENCE = process.argv[4] ?? "course-clear-27";
const SEQUENCE_CASE_INTERVAL_MS = process.argv[5] ?? "333.33";
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
      : (LISTEN_SMOKE_MODE || LISTEN_DYNAMICS_SMOKE_MODE || LISTEN_ACCURACY_MODE || LISTEN_SEQUENCE_MODE ||
        LISTEN_THRESHOLD_SWEEP_MODE || LISTEN_MULTIDOMAIN_SWEEP_MODE ||
        LISTEN_PROFILE_VALIDATION_MODE ||
        LISTEN_ISOLATED_VALIDATION_MODE || LISTEN_SEQUENCE_VALIDATION_MODE ||
        LISTEN_DYNAMICS_VALIDATION_MODE ||
        LISTEN_RETRIGGER_SWEEP_MODE || LISTEN_ARTICULATION_MODE ||
        LISTEN_INFERENCE_RESET_MODE || LISTEN_DYNAMICS_CONSTANT_MODE ||
        LISTEN_DYNAMICS_MIXED_MODE || LISTEN_DYNAMICS_CASE_MODE ||
        LISTEN_SEQUENCE_CASE_MODE) &&
        /online-amt-benchmark\.html(?:\?|$)/.test(BASE_URL)
      ? BASE_URL.replace(/online-amt-benchmark\.html/, "index.html")
      : BASE_URL;
    const separator = pageUrl.includes("?") ? "&" : "?";
    await client.send("Page.navigate", {
      url: `${pageUrl}${separator}${configuration.query}`,
    });
    if (LISTEN_SMOKE_MODE || LISTEN_DYNAMICS_SMOKE_MODE) {
      return await evaluate(client, `(async () => {
        const startedAt = performance.now();
        const [{ captureIsolatedOnlineAmtBenchmark }, { OnlineAmtSession }, audio, parity] =
          await Promise.all([
            import("/src/listenBenchmark.ts"),
            import("/src/onlineAmtSession.ts"),
            import("/src/listenBenchmarkAudio.ts"),
            import("/src/listenBaselineParity.ts"),
          ]);
        const renderer = new URLSearchParams(location.search).get("benchmark-renderer") === "tone"
          ? audio.LISTEN_BENCHMARK_TONE_RENDERER
          : audio.LISTEN_BENCHMARK_RENDERER;
        const query = new URLSearchParams(location.search);
        const piano = query.get("benchmark-piano") ?? "splendid";
        const layer = query.get("benchmark-layer") ?? "mp";
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
            piano,
            layer,
          });
          if (!result.advanced && !${LISTEN_DYNAMICS_SMOKE_MODE}) {
            throw new Error("The smoke-test C-major chord did not advance.");
          }
          if (
            !Number.isFinite(result.audioDiagnostics?.peak) ||
            !Number.isFinite(result.audioDiagnostics?.rms) ||
            result.audioDiagnostics.peak <= 0 || result.audioDiagnostics.rms <= 0
          ) {
            throw new Error("The piano/layer smoke rendered silent or non-finite PCM.");
          }
          if (result.renderer?.version !== renderer.version) {
            throw new Error(
              \`Expected renderer \${renderer.version}, received \${result.renderer?.version}.\`,
            );
          }
          if (result.piano?.id !== piano || result.piano?.layer !== layer) {
            throw new Error(
              \`Expected piano/layer \${piano}/\${layer}, received \` +
              \`\${result.piano?.id}/\${result.piano?.layer}.\`,
            );
          }
          const canonicalSmoke = piano === "splendid" && layer === "mp"
            ? {
                rendererVersion: result.renderer?.version,
                piano: result.piano?.id,
                layer: result.piano?.layer,
                targetPitches: [60, 64, 67],
                advanced: result.advanced,
                onsetToAdvanceMs: result.onsetToAdvanceMs,
                pcmFrameCount: result.audioDiagnostics.frameCount,
                pcmDurationMs: result.audioDiagnostics.durationMs,
                recognitionStructureHash: result.trace
                  ? parity.listenRecognitionStructureHash(result.trace)
                  : "untraced",
                peak: result.audioDiagnostics.peak,
                rms: result.audioDiagnostics.rms,
                traceFrameCount: result.trace?.frames.length ?? 0,
                recognizedOnsets: result.recognizedOnsets ?? [],
              }
            : null;
          if (canonicalSmoke && !${LISTEN_DYNAMICS_SMOKE_MODE}) {
            parity.assertCanonicalIsolatedSmokeBaseline(canonicalSmoke);
          }
          return {
            passed: true,
            baselineParity: canonicalSmoke === null || ${LISTEN_DYNAMICS_SMOKE_MODE}
              ? "not-applicable"
              : "matched-recorded-baseline",
            traceIdentity: result.trace === undefined ? null : {
              pcmHash: result.trace.audioSignature?.pcmHash ?? "unsigned",
              recognitionHash: parity.listenRecognitionTraceHash(result.trace),
              recognitionStructureHash: parity.listenRecognitionStructureHash(result.trace),
            },
            renderer: result.renderer,
            piano: result.piano,
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
      // The multi-domain sweep renders and recognizes both renderers' discovery
      // and regression corpora, then replays 1,000 profiles against each trace.
      LISTEN_MULTIDOMAIN_SWEEP_MODE
        ? 7_200_000
        // The unified gate captures the isolated, sequence, dynamics, and
        // articulation corpora under both renderers in one pass.
        : LISTEN_PROFILE_VALIDATION_MODE
        ? 12_600_000
        // Both renderers' complete isolated corpus is rendered and recognized
        // once per fixture, then replayed through every frozen profile.
        : LISTEN_ISOLATED_VALIDATION_MODE
        ? 3_600_000
        // Both renderers' complete sequence corpus is rendered and recognized
        // once per passage, then replayed through every frozen profile.
        : LISTEN_SEQUENCE_VALIDATION_MODE
        ? 5_400_000
        // Both renderers' twenty velocity layers, two mixed runs, and four
        // articulations are rendered and recognized once, then replayed through
        // every frozen profile.
        : LISTEN_DYNAMICS_VALIDATION_MODE
        ? 5_400_000
        : (LISTEN_RETRIGGER_SWEEP_MODE || LISTEN_DYNAMICS_CONSTANT_MODE)
        ? 1_200_000
        : (LISTEN_ACCURACY_MODE || LISTEN_SEQUENCE_MODE || LISTEN_THRESHOLD_SWEEP_MODE ||
          LISTEN_ARTICULATION_MODE || LISTEN_DYNAMICS_CASE_MODE ||
          LISTEN_SEQUENCE_CASE_MODE)
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
      LISTEN_SEQUENCE_CASE_MODE
        ? `(async () => {
            const result = window.listenSequenceCaseResult;
            const { conciseListenSequenceCaseResult } =
              await import("/src/listenSequenceCaseBenchmark.ts");
            return conciseListenSequenceCaseResult(result);
          })()`
        : LISTEN_DYNAMICS_CASE_MODE
        ? `(async () => {
            const result = window.listenDynamicsCaseResult;
            const { conciseCourseClearDynamicsCaseResult } =
              await import("/src/listenDynamicsBenchmark.ts");
            return conciseCourseClearDynamicsCaseResult(result);
          })()`
        : (LISTEN_DYNAMICS_CONSTANT_MODE || LISTEN_DYNAMICS_MIXED_MODE)
        ? `(() => {
            const constant = ${LISTEN_DYNAMICS_CONSTANT_MODE};
            const result = constant
              ? window.listenDynamicsBenchmarkResult
              : window.listenMixedDynamicsBenchmarkResult;
            return {
              suite: result.suite,
              renderer: result.renderer,
              pianos: result.pianos,
              crossPiano: result.crossPiano,
              safety: {
                falseAdvanceCount: result.crossPiano.falseAdvanceCount,
                skippedAdvanceCount: result.crossPiano.skippedAdvanceCount,
                duplicateAdvanceCount: result.crossPiano.duplicateAdvanceCount,
                lateAdvanceCount: result.crossPiano.lateAdvanceCount,
                carriedBassMatcherConfigurationChanged: false,
              },
              runs: result.runs.map((run) => ({
                renderer: run.renderer,
                piano: run.piano,
                pianoName: run.pianoName,
                layer: run.layer,
                dynamicProfile: run.dynamicProfile,
                ...(run.dynamicProfile === "crescendo-decrescendo"
                  ? { attackLayers: run.attackLayers }
                  : {}),
                sampleLibraryVersion: run.sampleLibraryVersion,
                peak: run.peak,
                rms: run.rms,
                pcmSignature: {
                  sampleRate: run.pcmSignature.sampleRate,
                  frameCount: run.pcmSignature.frameCount,
                  pcmByteLength: run.pcmSignature.pcmByteLength,
                  chunkSize: run.pcmSignature.chunkSize,
                  pcmHash: run.pcmSignature.pcmHash,
                },
                summary: {
                  complete: run.recognition.summary.complete,
                  independentMatchCount: run.recognition.summary.independentMatchCount,
                  independentMatchRate: run.recognition.summary.independentMatchRate,
                  orderedAdvanceCount: run.recognition.summary.orderedAdvanceCount,
                  orderedAdvanceRate: run.recognition.summary.orderedAdvanceRate,
                  missedCount: run.recognition.summary.missedCount,
                  falseAdvanceCount: run.recognition.summary.falseAdvanceCount,
                  skippedAdvanceCount: run.recognition.summary.skippedAdvanceCount,
                  duplicateAdvanceCount: run.recognition.summary.duplicateAdvanceCount,
                  lateAdvanceCount: run.recognition.summary.lateAdvanceCount,
                  firstStallIndex: run.recognition.summary.firstStallIndex,
                  p95IndependentMatchLatencyMs:
                    run.recognition.summary.p95IndependentMatchLatencyMs,
                  p95OrderedAdvanceLatencyMs:
                    run.recognition.summary.p95OrderedAdvanceLatencyMs,
                },
              })),
            };
          })()`
        : LISTEN_RETRIGGER_SWEEP_MODE
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
        : LISTEN_PROFILE_VALIDATION_MODE
        ? `(async () => {
            const result = window.listenProfileValidationResult;
            const { conciseListenProfileValidationResult } =
              await import("/src/listenProfileValidationBenchmark.ts");
            return conciseListenProfileValidationResult(result);
          })()`
        : LISTEN_ISOLATED_VALIDATION_MODE
        ? `(async () => {
            const result = window.listenIsolatedProfileValidationResult;
            const { conciseListenIsolatedProfileValidationResult } =
              await import("/src/listenProfileValidationBenchmark.ts");
            return conciseListenIsolatedProfileValidationResult(result);
          })()`
        : LISTEN_SEQUENCE_VALIDATION_MODE
        ? `(async () => {
            const result = window.listenSequenceProfileValidationResult;
            const { conciseListenSequenceProfileValidationResult } =
              await import("/src/listenProfileValidationBenchmark.ts");
            return conciseListenSequenceProfileValidationResult(result);
          })()`
        : LISTEN_DYNAMICS_VALIDATION_MODE
        ? `(async () => {
            const result = window.listenDynamicsProfileValidationResult;
            const { conciseListenDynamicsProfileValidationResult } =
              await import("/src/listenProfileValidationBenchmark.ts");
            return conciseListenDynamicsProfileValidationResult(result);
          })()`
        : LISTEN_MULTIDOMAIN_SWEEP_MODE
        ? `(async () => {
            const result = window.listenMatcherMultiDomainSweepResult;
            const {
              conciseListenMatcherMultiDomainSweepResult,
              fullListenMatcherMultiDomainSweepResult,
            } =
              await import("/src/listenMatcherSweepBenchmark.ts");
            return ${LISTEN_MULTIDOMAIN_SWEEP_SUMMARY_MODE}
              ? conciseListenMatcherMultiDomainSweepResult(result)
              : fullListenMatcherMultiDomainSweepResult(result);
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
              lateAdvance: event.lateAdvance,
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
                lateAdvanceCount: run.summary.lateAdvanceCount,
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

/**
 * The committed-regression, re-verification, and forensic detail every focused
 * case prints. Both the dynamics and the sequence case report it identically, so
 * one diagnosed advancement reads the same however it was reproduced.
 */
function reportFocusedCase(configuration, result) {
  console.error(
    `${configuration.name}: committed regressions=${result.regressions.fixtureCount} ` +
    `outcomes=${result.regressions.outcomes.length} ` +
    `deviations=${result.regressions.deviationCount} ` +
    `passed=${result.regressions.passed}`,
  );
  for (const outcome of result.regressions.outcomes) {
    console.error(
      `${configuration.name}: regression ${outcome.fixtureId} ${outcome.profileId} ` +
      `expected=${outcome.expectation} advanced=${outcome.advancedAtMs}ms ` +
      `source-attack=${outcome.sourceAttackIndex} ` +
      `late=${outcome.lateAdvance} false=${outcome.falseAdvance} ` +
      `satisfied=${outcome.satisfied}` +
      (outcome.deviations.length > 0 ? ` deviations="${outcome.deviations.join("; ")}"` : "") +
      (outcome.newlyUnsafeTargets.length > 0
        ? ` NEWLY-UNSAFE=${outcome.newlyUnsafeTargets
            .map(({ targetIndex, classifications }) => `${targetIndex}:${classifications.join("+")}`)
            .join(",")}`
        : ""),
    );
  }
  for (const verification of result.verifications) {
    console.error(
      `${configuration.name}: verified ${verification.fixtureId} ` +
      `structure=${verification.actualRecognitionStructureHash} ` +
      `expected=${verification.expectedRecognitionStructureHash}`,
    );
  }
  for (const forensic of result.forensics) {
    console.error(
      `${configuration.name}: ${forensic.classification.join("+")} ` +
      `target=${forensic.targetIndex} [${forensic.targetPitches.join(" ")}] ` +
      `at=${forensic.advancedAtMs}ms delay=${forensic.attributionDelayMs}ms ` +
      `source-attack=${forensic.sourceAttackIndex} ` +
      `detected=[${forensic.detectedTargetPitches.join(" ")}] ` +
      `extras=[${forensic.extraPitches.join(" ")}] ` +
      `carry-in=[${forensic.carryOverPitchesAtTargetStart.join(" ")}]`,
    );
  }
}

function pairedRendererConfigurations(name, query) {
  const configurations = [
    {
      name: `${name}-legacy`,
      query: `${query}&benchmark-renderer=legacy`,
    },
    {
      name: `${name}-tone`,
      query: `${query}&benchmark-renderer=tone`,
    },
  ];
  return CONFIGURATION_FILTER === `${name}-legacy` ||
      CONFIGURATION_FILTER === `${name}-tone`
    ? configurations.filter(({ name: candidate }) => candidate === CONFIGURATION_FILTER)
    : configurations;
}

function dynamicsSmokeConfigurations() {
  return [
    { piano: "splendid", layer: "mp" },
    { piano: "salamander", layer: "v01" },
    { piano: "salamander", layer: "v16" },
  ].flatMap(({ piano, layer }) => pairedRendererConfigurations(
    `listen-dynamics-smoke-${piano}-${layer}`,
    `listen-smoke=auto&benchmark-piano=${piano}&benchmark-layer=${layer}`,
  ));
}

const selectedConfigurations = FINGERING_SMOKE_MODE
  ? [{
      name: "fingering-smoke",
      query: `fingering-notes=${process.argv[4] ?? "500"}`,
    }]
  : LISTEN_SMOKE_MODE
  ? pairedRendererConfigurations("listen-smoke", "listen-smoke=auto")
  : LISTEN_DYNAMICS_SMOKE_MODE
  ? dynamicsSmokeConfigurations()
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
  : LISTEN_PROFILE_VALIDATION_MODE
  // One configuration: the gate is stated across renderers and domains, so it
  // captures both renderers itself rather than being paired by the runner.
  ? [{
      name: LISTEN_PROFILE_VALIDATION_SUMMARY_MODE
        ? "listen-profile-validation-summary"
        : CONFIGURATION_FILTER,
      query: "listen-profile-validation=auto" +
        (CONFIGURATION_FILTER === "listen-profile-validation-legacy"
          ? "&benchmark-renderer=legacy"
          : CONFIGURATION_FILTER === "listen-profile-validation-tone"
          ? "&benchmark-renderer=tone"
          : "") +
        (PROFILE_VALIDATION_INTERVALS_MS
          ? `&benchmark-interval=${PROFILE_VALIDATION_INTERVALS_MS}`
          : "") +
        (PROFILE_VALIDATION_SUITES ? `&benchmark-suite=${PROFILE_VALIDATION_SUITES}` : ""),
    }]
  : LISTEN_ISOLATED_VALIDATION_MODE
  // One configuration by default: the isolated matrix captures both renderers
  // itself, because its gates are stated per renderer against one manifest.
  ? [{
      name: LISTEN_ISOLATED_VALIDATION_SUMMARY_MODE
        ? "listen-isolated-profile-validation-summary"
        : CONFIGURATION_FILTER,
      query: "listen-isolated-profile-validation=auto" +
        (CONFIGURATION_FILTER === "listen-isolated-profile-validation-legacy"
          ? "&benchmark-renderer=legacy"
          : CONFIGURATION_FILTER === "listen-isolated-profile-validation-tone"
          ? "&benchmark-renderer=tone"
          : ""),
    }]
  : LISTEN_SEQUENCE_VALIDATION_MODE
  // One configuration by default: the sequence matrix captures both renderers
  // itself, because its per-renderer deltas are stated against one manifest.
  ? [{
      name: LISTEN_SEQUENCE_VALIDATION_SUMMARY_MODE
        ? "listen-sequence-profile-validation-summary"
        : CONFIGURATION_FILTER,
      query: "listen-sequence-profile-validation=auto" +
        (CONFIGURATION_FILTER === "listen-sequence-profile-validation-legacy"
          ? "&benchmark-renderer=legacy"
          : CONFIGURATION_FILTER === "listen-sequence-profile-validation-tone"
          ? "&benchmark-renderer=tone"
          : "") +
        (SEQUENCE_VALIDATION_INTERVALS_MS
          ? `&benchmark-interval=${SEQUENCE_VALIDATION_INTERVALS_MS}`
          : ""),
    }]
  : LISTEN_DYNAMICS_VALIDATION_MODE
  // One configuration by default: the dynamics matrix captures both renderers
  // itself, because its per-renderer and per-piano deltas are stated against one
  // manifest.
  ? [{
      name: LISTEN_DYNAMICS_VALIDATION_SUMMARY_MODE
        ? "listen-dynamics-profile-validation-summary"
        : CONFIGURATION_FILTER,
      query: "listen-dynamics-profile-validation=auto" +
        (CONFIGURATION_FILTER === "listen-dynamics-profile-validation-legacy"
          ? "&benchmark-renderer=legacy"
          : CONFIGURATION_FILTER === "listen-dynamics-profile-validation-tone"
          ? "&benchmark-renderer=tone"
          : "") +
        (DYNAMICS_VALIDATION_SUITES ? `&benchmark-suite=${DYNAMICS_VALIDATION_SUITES}` : ""),
    }]
  : LISTEN_MULTIDOMAIN_SWEEP_MODE
  // One configuration, not a renderer pair: the multi-domain sweep captures both
  // renderers itself because its worst-domain metric spans them.
  ? [{
      name: LISTEN_MULTIDOMAIN_SWEEP_SUMMARY_MODE
        ? "listen-matcher-multidomain-sweep-summary"
        : "listen-matcher-multidomain-sweep",
      query: "listen-matcher-multidomain-sweep=auto",
    }]
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
  : LISTEN_DYNAMICS_CONSTANT_MODE
  ? pairedRendererConfigurations(
      "listen-dynamics-constant",
      "listen-dynamics-constant=auto",
    )
  : LISTEN_DYNAMICS_MIXED_MODE
  ? pairedRendererConfigurations(
      "listen-dynamics-mixed",
      "listen-dynamics-mixed=auto",
    )
  : LISTEN_SEQUENCE_CASE_MODE
  ? pairedRendererConfigurations(
      "listen-sequence-case",
      `listen-sequence-case=auto&benchmark-sequence=${SEQUENCE_CASE_SEQUENCE}` +
        `&benchmark-interval=${SEQUENCE_CASE_INTERVAL_MS}`,
    )
  : LISTEN_DYNAMICS_CASE_MODE
  ? pairedRendererConfigurations(
      "listen-dynamics-case",
      `listen-dynamics-case=auto&benchmark-piano=${DYNAMICS_CASE_PIANO}` +
        `&benchmark-layer=${DYNAMICS_CASE_LAYER}`,
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
    lateAdvanceCount: summary.lateAdvanceCount,
    p95IndependentMatchLatencyMs: summary.p95IndependentMatchLatencyMs,
    p95OrderedAdvanceLatencyMs: summary.p95OrderedAdvanceLatencyMs,
  });
  const conciseSafety = (runs) => ({
    falseAdvanceCount: runs.reduce((total, run) => total + run.falseAdvanceCount, 0),
    skippedAdvanceCount: runs.reduce((total, run) => total + run.skippedAdvanceCount, 0),
    duplicateAdvanceCount: runs.reduce((total, run) => total + run.duplicateAdvanceCount, 0),
    lateAdvanceCount: runs.reduce((total, run) => total + (run.lateAdvanceCount ?? 0), 0),
    runs: runs.map((run) => ({
      sequenceId: run.sequenceId,
      intervalMs: run.intervalMs,
      correctAdvanceRate: run.correctAdvanceRate,
      falseAdvanceCount: run.falseAdvanceCount,
      skippedAdvanceCount: run.skippedAdvanceCount,
      duplicateAdvanceCount: run.duplicateAdvanceCount,
      lateAdvanceCount: run.lateAdvanceCount ?? 0,
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
    : LISTEN_PROFILE_VALIDATION_SUMMARY_MODE
    ? {
        baselineProfileId: result.gates.baselineProfileId,
        candidateProfileIds: result.gates.candidateProfileIds,
        profiles: result.gates.profiles,
        evidenceComplete: result.gates.evidenceComplete,
        incompleteEvidenceReasons: result.gates.incompleteEvidenceReasons,
        reviewedLayerLosses: result.gates.reviewedLayerLosses,
        eligibleProfileIds: result.gates.eligibleProfileIds,
        recommendation: result.gates.recommendation,
        // Identities are folded to their digest here. The unabridged export
        // keeps every trace hash, which is what a second repetition compares.
        domains: result.gates.domains.map((domain) => ({
          domain: domain.domain,
          present: domain.present,
          manifestVersion: domain.manifestVersion,
          manifestHash: domain.manifestHash,
          manifestCorpusHash: domain.manifestCorpusHash,
          capturedTraceCount: domain.capturedTraceCount,
          rendererKeys: domain.rendererKeys,
          partitions: domain.partitions,
          evidenceRole: domain.evidenceRole,
          traceReuseVerified: domain.traceReuseVerified,
          baselineParityVerified: domain.baselineParityVerified,
          traceIdentityCount: domain.traceIdentities.length,
          identityDigest: domain.identityDigest,
        })),
        candidates: result.gates.candidates.map((candidate) => ({
          profileId: candidate.profileId,
          profile: candidate.profile,
          eligibility: candidate.eligibility,
          eligible: candidate.eligible,
          failedGateCodes: candidate.failedGateCodes,
          replayIntegrityFailureCount: candidate.replayIntegrityFailureCount,
          safetyFailureCount: candidate.safetyFailureCount,
          releaseFailureCount: candidate.releaseFailureCount,
          discoveryConsistencyFailureCount: candidate.discoveryConsistencyFailureCount,
          safety: candidate.safety,
          lateAdvance: candidate.lateAdvance,
          layerLosses: candidate.layerLosses,
          regressedSequenceTraceIds: candidate.regressedSequenceTraceIds,
          gates: candidate.gates,
        })),
      }
    : LISTEN_ISOLATED_VALIDATION_SUMMARY_MODE
    ? {
        manifest: result.manifest,
        partitions: result.partitions,
        baselineProfileId: result.baselineProfileId,
        candidateProfileIds: result.candidateProfileIds,
        traceReuseVerified: result.traceReuseVerified,
        baselineParityVerified: result.baselineParityVerified,
        renderers: result.renderers.map((renderer) => ({
          rendererKey: renderer.rendererKey,
          renderer: renderer.renderer,
          caseCount: renderer.caseCount,
          correctTrialCount: renderer.correctTrialCount,
          profiles: renderer.profiles,
        })),
      }
    : LISTEN_SEQUENCE_VALIDATION_SUMMARY_MODE
    ? {
        manifest: result.manifest,
        evidenceRole: result.evidenceRole,
        partitions: result.partitions,
        baselineProfileId: result.baselineProfileId,
        candidateProfileIds: result.candidateProfileIds,
        traceReuseVerified: result.traceReuseVerified,
        baselineParityVerified: result.baselineParityVerified,
        renderers: result.renderers.map((renderer) => ({
          rendererKey: renderer.rendererKey,
          renderer: renderer.renderer,
          scoredCaseCount: renderer.scoredCaseCount,
          safetyCaseCount: renderer.safetyCaseCount,
          intervalsMs: renderer.intervalsMs,
          families: renderer.families,
          profiles: renderer.profiles.map((profile) => ({
            profileId: profile.profileId,
            profile: profile.profile,
            totals: profile.totals,
            regressionTotals: profile.regressionTotals,
            bySpeed: profile.bySpeed,
            byFamily: profile.byFamily,
            safety: profile.safety,
            lateAdvances: profile.lateAdvances,
            deltaFromBaseline: profile.deltaFromBaseline,
          })),
          unsafeAdvances: renderer.unsafeAdvances,
        })),
      }
    : LISTEN_MULTIDOMAIN_SWEEP_SUMMARY_MODE
    ? {
        manifest: result.manifest,
        renderers: result.renderers,
        baselineProfile: result.baselineProfile,
        gridSize: result.gridSize,
        profilesEvaluated: result.profilesEvaluated,
        profilesRejectedBySafety: result.profilesRejectedBySafety,
        rejectionCounts: result.rejectionCounts,
        selectionRule: result.selectionRule,
        noSafeImprovement: result.noSafeImprovement,
        replayParityVerified: result.replayParityVerified,
        baseline: { profile: result.baseline.profile, metrics: result.baseline.metrics,
          totals: result.baseline.totals, safety: result.baseline.safety },
        paretoFrontier: result.paretoFrontier.map((candidate) => ({
          profile: candidate.profile,
          metrics: candidate.metrics,
          totals: candidate.totals,
        })),
        selected: result.selected,
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
  if (LISTEN_SMOKE_MODE || LISTEN_DYNAMICS_SMOKE_MODE) {
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
  } else if (LISTEN_SEQUENCE_CASE_MODE) {
    console.error(
      `${configuration.name}: ${result.sequenceId} at ${result.intervalMs.toFixed(2)}ms ` +
      `pcm=${result.traceIdentity.pcmHash} trace=${result.traceIdentity.recognitionHash} ` +
      `structure=${result.recognitionStructureHash} ` +
      `independent=${result.summary.independentMatchCount}/${result.summary.expectedEventCount} ` +
      `ordered=${result.summary.orderedAdvanceCount}/${result.summary.expectedEventCount} ` +
      `safety=${result.summary.falseAdvanceCount}/${result.summary.skippedAdvanceCount}/` +
      `${result.summary.duplicateAdvanceCount} late=${result.summary.lateAdvanceCount}`,
    );
    reportFocusedCase(configuration, result);
  } else if (LISTEN_DYNAMICS_CASE_MODE) {
    console.error(
      `${configuration.name}: ${result.piano}/${result.layer} ` +
      `pcm=${result.pcmSignature.pcmHash} trace=${result.traceIdentity.recognitionHash} ` +
      `independent=${result.summary.independentMatchCount}/27 ` +
      `ordered=${result.summary.orderedAdvanceCount}/27 ` +
      `safety=${result.summary.falseAdvanceCount}/${result.summary.skippedAdvanceCount}/` +
      `${result.summary.duplicateAdvanceCount}`,
    );
    reportFocusedCase(configuration, result);
  } else if (LISTEN_DYNAMICS_CONSTANT_MODE || LISTEN_DYNAMICS_MIXED_MODE) {
    const unsafeRuns = result.runs.filter(({ summary }) => (
      summary.falseAdvanceCount > 0 ||
      summary.skippedAdvanceCount > 0 ||
      summary.duplicateAdvanceCount > 0
    ));
    console.error(
      `${configuration.name}: runs=${result.runs.length} ` +
      `ordered=${(result.crossPiano.orderedAdvanceRate * 100).toFixed(1)}% ` +
      `independent=${(result.crossPiano.independentMatchRate * 100).toFixed(1)}% ` +
      `safety=${result.crossPiano.falseAdvanceCount}/` +
      `${result.crossPiano.skippedAdvanceCount}/${result.crossPiano.duplicateAdvanceCount} ` +
      `late=${result.crossPiano.lateAdvanceCount}`,
    );
    for (const run of unsafeRuns) {
      console.error(
        `${configuration.name}: unsafe ${run.piano}/${run.layer ?? run.dynamicProfile} ` +
        `${run.summary.falseAdvanceCount}/${run.summary.skippedAdvanceCount}/` +
        `${run.summary.duplicateAdvanceCount}`,
      );
    }
    for (const run of result.runs.filter(({ summary }) => summary.lateAdvanceCount > 0)) {
      console.error(
        `${configuration.name}: late ${run.piano}/${run.layer ?? run.dynamicProfile} ` +
        `${run.summary.lateAdvanceCount}`,
      );
    }
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
  } else if (LISTEN_PROFILE_VALIDATION_MODE) {
    const gates = result.gates;
    console.error(
      `${configuration.name}: recommendation=${gates.recommendation.code} ` +
      `eligible=${gates.eligibleProfileIds.join(",") || "none"} ` +
      `evidence-complete=${gates.evidenceComplete} ` +
      `baseline=${gates.baselineProfileId} ` +
      `candidates=${gates.candidateProfileIds.join(",")}`,
    );
    for (const domain of gates.domains) {
      console.error(
        `${configuration.name}: ${domain.domain} present=${domain.present} ` +
        `manifest=${domain.manifestVersion}/${domain.manifestHash} ` +
        `captured=${domain.capturedTraceCount} ` +
        `renderers=${domain.rendererKeys.join(",") || "none"} ` +
        `partitions=${domain.partitions.join(",") || "none"} ` +
        `identity=${domain.identityDigest} ` +
        `trace-reuse=${domain.traceReuseVerified} ` +
        `baseline-parity=${domain.baselineParityVerified}`,
      );
    }
    for (const reason of gates.incompleteEvidenceReasons) {
      console.error(`${configuration.name}: incomplete-evidence: ${reason}`);
    }
    for (const candidate of gates.candidates) {
      console.error(
        `${configuration.name}: ${candidate.profileId} ${candidate.eligibility} ` +
        `replay=${candidate.replayIntegrityFailureCount} ` +
        `safety=${candidate.safetyFailureCount} ` +
        `release=${candidate.releaseFailureCount} ` +
        `consistency=${candidate.discoveryConsistencyFailureCount} ` +
        `isolated-false=${candidate.safety.isolatedDistinguishableFalseAdvances} ` +
        `sequence-unsafe=${candidate.safety.sequenceFalseAdvances}/` +
        `${candidate.safety.sequenceSkippedAdvances}/` +
        `${candidate.safety.sequenceDuplicateAdvances}/` +
        `${candidate.safety.sequenceIncompleteCarriedBassAdvances} ` +
        `sequence-introduced=${candidate.safety.sequenceIntroducedUnsafeTraceIds.length}/` +
        `${candidate.safety.sequenceWorsenedUnsafeTraceIds.length} ` +
        `dynamics-introduced=${candidate.safety.dynamicsIntroducedUnsafeTraceIds.length}/` +
        `${candidate.safety.dynamicsWorsenedUnsafeTraceIds.length} ` +
        `regression-worse=${candidate.safety.regressionWorseThanBaselineCount} ` +
        `late=${candidate.lateAdvance.sequence?.lateAdvanceCount ?? "n/a"}/` +
        `${candidate.lateAdvance.dynamics?.lateAdvanceCount ?? "n/a"} ` +
        `gates=${candidate.failedGateCodes.join(",") || "all-passed"}`,
      );
      for (const gate of candidate.gates) {
        for (const failure of gate.failures) {
          console.error(
            `${configuration.name}: ${candidate.profileId} ${gate.code} [${gate.role}/` +
            `${gate.evidenceRole ?? "gating"}] ` +
            `domains=${failure.domainIds.join(",")} ` +
            `baseline=${String(failure.baselineValue)} ` +
            `candidate=${String(failure.candidateValue)} :: ${failure.explanation}`,
          );
        }
      }
      for (const loss of candidate.layerLosses) {
        console.error(
          `${configuration.name}: ${candidate.profileId} layer-loss ${loss.rendererKey} ` +
          `${loss.groupKey} [${loss.evidenceRole}] ` +
          `independent=${loss.independentMatchDelta} ordered=${loss.orderedAdvanceDelta} ` +
          `reviewed=${loss.reviewed}`,
        );
      }
    }
  } else if (LISTEN_ISOLATED_VALIDATION_MODE) {
    console.error(
      `${configuration.name}: manifest=${result.manifest.version}/${result.manifest.hash} ` +
      `captured=${result.manifest.capturedTraceCount} ` +
      `partitions=${result.partitions.join(",")} ` +
      `candidates=${result.candidateProfileIds.join(",")} ` +
      `trace-reuse=${result.traceReuseVerified} baseline-parity=${result.baselineParityVerified}`,
    );
    for (const renderer of result.renderers) {
      for (const profile of renderer.profiles) {
        const delta = profile.deltaFromBaseline;
        console.error(
          `${configuration.name}: ${renderer.rendererKey} ${profile.profileId} ` +
          `correct=${profile.correctAdvanceCount}/${profile.correctTrialCount} ` +
          `course-clear=${profile.courseClearAdvanceCount}/` +
          `${profile.courseClearCorrectTrialCount} ` +
          `false=${profile.distinguishableFalseAdvanceCount} ` +
          `ambiguous=${profile.ambiguousAdvanceCount} ` +
          `p95=${profile.p95OnsetToAdvanceMs ?? "n/a"}ms ` +
          `gate=${profile.acceptance.passed ? "pass" : "fail"}` +
          (delta
            ? ` delta-correct=${delta.correctAdvanceCount >= 0 ? "+" : ""}` +
              `${delta.correctAdvanceCount} delta-false=${delta.distinguishableFalseAdvanceCount}` +
              (delta.lostCorrectTraceIds.length > 0
                ? ` LOST=${delta.lostCorrectTraceIds.join(",")}`
                : "")
            : ""),
        );
      }
    }
  } else if (LISTEN_SEQUENCE_VALIDATION_MODE) {
    console.error(
      `${configuration.name}: manifest=${result.manifest.version}/${result.manifest.hash} ` +
      `captured=${result.manifest.capturedTraceCount} ` +
      `evidence=${result.evidenceRole} ` +
      `partitions=${result.partitions.join(",")} ` +
      `candidates=${result.candidateProfileIds.join(",")} ` +
      `trace-reuse=${result.traceReuseVerified} baseline-parity=${result.baselineParityVerified}`,
    );
    for (const renderer of result.renderers) {
      console.error(
        `${configuration.name}: ${renderer.rendererKey} scored=${renderer.scoredCaseCount} ` +
        `safety=${renderer.safetyCaseCount} ` +
        `speeds=${renderer.intervalsMs.map((value) => value.toFixed(2)).join(",")}`,
      );
      for (const profile of renderer.profiles) {
        const delta = profile.deltaFromBaseline;
        const totals = profile.totals;
        console.error(
          `${configuration.name}: ${renderer.rendererKey} ${profile.profileId} ` +
          `independent=${totals.independentMatchCount}/${totals.expectedEventCount} ` +
          `ordered=${totals.orderedAdvanceCount}/${totals.expectedEventCount} ` +
          `prefix=${totals.orderedPrefixCompleted} ` +
          `complete=${totals.completePassageCount}/${totals.sequenceCount} ` +
          `late=${totals.lateAdvanceCount} ` +
          `carry-over=${totals.carryOverBlockedEventCount} ` +
          `p95=${totals.p95OrderedAdvanceLatencyMs ?? "n/a"}ms ` +
          `backlog=${totals.maximumProcessingBacklogMs.toFixed(1)}ms ` +
          `gate-ordered=${profile.regressionTotals.orderedAdvanceCount}/` +
          `${profile.regressionTotals.expectedEventCount} ` +
          `gate-complete=${profile.regressionTotals.completePassageCount}/` +
          `${profile.regressionTotals.sequenceCount} ` +
          `safety=${profile.safety.passed ? "pass" : "FAIL"} ` +
          `unsafe=${profile.safety.falseAdvanceCount}/${profile.safety.skippedAdvanceCount}/` +
          `${profile.safety.duplicateAdvanceCount}/${profile.safety.incompleteCarriedBassAdvances}` +
          (delta
            ? ` delta-independent=${delta.independentMatchCount >= 0 ? "+" : ""}` +
              `${delta.independentMatchCount}` +
              ` delta-ordered=${delta.orderedAdvanceCount >= 0 ? "+" : ""}` +
              `${delta.orderedAdvanceCount}` +
              ` delta-complete=${delta.completePassageCount >= 0 ? "+" : ""}` +
              `${delta.completePassageCount}` +
              (delta.lostCompletePassageTraceIds.length > 0
                ? ` LOST=${delta.lostCompletePassageTraceIds.join(",")}`
                : "")
            : ""),
        );
      }
    }
  } else if (LISTEN_DYNAMICS_VALIDATION_MODE) {
    console.error(
      `${configuration.name}: manifest=${result.manifest.version}/${result.manifest.hash} ` +
      `captured=${result.manifest.capturedTraceCount} ` +
      `evidence=${result.evidenceRole} ` +
      `suites=${result.suites.join(",")} ` +
      `partitions=${result.partitions.join(",")} ` +
      `candidates=${result.candidateProfileIds.join(",")} ` +
      `trace-reuse=${result.traceReuseVerified} baseline-parity=${result.baselineParityVerified}`,
    );
    for (const renderer of result.renderers) {
      console.error(
        `${configuration.name}: ${renderer.rendererKey} scored=${renderer.scoredCaseCount} ` +
        `regression=${renderer.regressionCaseCount} pianos=${renderer.pianos.join(",")}`,
      );
      for (const profile of renderer.profiles) {
        // Every group is printed with the partitions it spans, so a line can
        // never be read as confirmation unless it says so.
        for (const group of profile.groups) {
          if (!["corpus", "partition", "suite", "piano"].includes(group.kind)) continue;
          const delta = group.deltaFromBaseline;
          console.error(
            `${configuration.name}: ${renderer.rendererKey} ${profile.profileId} ` +
            `${group.key} evidence=${group.evidenceRole} ` +
            `independent=${group.totals.independentMatchCount}/` +
            `${group.totals.expectedEventCount} ` +
            `ordered=${group.totals.orderedAdvanceCount}/${group.totals.expectedEventCount} ` +
            `complete=${group.totals.completePassageCount}/${group.totals.sequenceCount} ` +
            `late=${group.totals.lateAdvanceCount}` +
            (delta
              ? ` delta-independent=${delta.independentMatchCount >= 0 ? "+" : ""}` +
                `${delta.independentMatchCount}` +
                ` delta-ordered=${delta.orderedAdvanceCount >= 0 ? "+" : ""}` +
                `${delta.orderedAdvanceCount}` +
                (delta.regressedOrderedAdvanceTraceIds.length > 0
                  ? ` REGRESSED=${delta.regressedOrderedAdvanceTraceIds.join(",")}`
                  : "")
              : ""),
          );
        }
        for (const equal of profile.equalPiano) {
          console.error(
            `${configuration.name}: ${renderer.rendererKey} ${profile.profileId} ` +
            `equal-piano/${equal.suite} [${equal.evidenceRole ?? "n/a"}] ` +
            `independent=${equal.independentMatchRate === null
              ? "n/a"
              : (equal.independentMatchRate * 100).toFixed(2)}% ` +
            `ordered=${equal.orderedAdvanceRate === null
              ? "n/a"
              : (equal.orderedAdvanceRate * 100).toFixed(2)}% ` +
            `complete=${equal.completePassageRate === null
              ? "n/a"
              : (equal.completePassageRate * 100).toFixed(2)}% ` +
            `worst-piano=${equal.worstPiano ?? "n/a"} ` +
            equal.pianos
              .map(({ piano, worstLayer, worstLayerOrderedAdvanceRate }) => (
                `${piano}-worst-layer=${worstLayer ?? "n/a"}` +
                `@${worstLayerOrderedAdvanceRate === null
                  ? "n/a"
                  : (worstLayerOrderedAdvanceRate * 100).toFixed(1)}%`
              ))
              .join(" "),
          );
        }
        console.error(
          `${configuration.name}: ${renderer.rendererKey} ${profile.profileId} ` +
          `safety=${profile.safety.passed ? "pass" : "FAIL"} ` +
          `unsafe=${profile.safety.falseAdvanceCount}/${profile.safety.skippedAdvanceCount}/` +
          `${profile.safety.duplicateAdvanceCount} ` +
          `late=${profile.safety.lateAdvanceCount} ` +
          `regressions=${profile.safety.regressions.worseThanBaselineCount}worse/` +
          `${profile.safety.regressions.deviationCount}deviating` +
          (profile.safety.introducedUnsafeTraceIds.length > 0
            ? ` INTRODUCED=${profile.safety.introducedUnsafeTraceIds.join(",")}`
            : ""),
        );
      }
      for (const regression of renderer.regressionCases) {
        for (const profile of regression.profiles) {
          console.error(
            `${configuration.name}: ${renderer.rendererKey} regression ${regression.traceId} ` +
            `${profile.profileId} ordered=${profile.orderedAdvanceCount} ` +
            `late=${profile.lateAdvanceCount} ` +
            `unsafe=${profile.falseAdvanceCount}/${profile.skippedAdvanceCount}/` +
            `${profile.duplicateAdvanceCount} ` +
            `late-at=${profile.lateAdvances
              .map(({ targetIndex, advanceTimeMs, sourceAttackIndex }) => (
                `${targetIndex}@${advanceTimeMs}<-attack${sourceAttackIndex}`
              ))
              .join(",") || "none"}`,
          );
        }
      }
    }
  } else if (LISTEN_MULTIDOMAIN_SWEEP_MODE) {
    console.error(
      `${configuration.name}: manifest=${result.manifest.version}/${result.manifest.hash} ` +
      `captured=${result.manifest.capturedTraceCount} ` +
      `scored=${result.manifest.scoredTraceCount} ` +
      `evaluated=${result.profilesEvaluated}/${result.gridSize} ` +
      `rejected-safety=${result.profilesRejectedBySafety} ` +
      `frontier=${result.paretoFrontier.length} ` +
      `selected=${result.selected.map(({ profile }) => profile.id).join(",") || "none"} ` +
      `no-safe-improvement=${result.noSafeImprovement}`,
    );
    for (const reason of result.rejectionCounts) {
      console.error(`${configuration.name}: rejected ${reason.reason}=${reason.profileCount}`);
    }
    for (const candidate of [result.baseline, ...result.selected]) {
      console.error(
        `${configuration.name}: ${candidate.profile.id} ` +
        `worst-domain=${candidate.metrics.worstDomainIndependentRate?.toFixed(4)} ` +
        `equal-domain=${candidate.metrics.equalDomainIndependentRate?.toFixed(4)} ` +
        `prefix=${candidate.metrics.orderedPrefixRate?.toFixed(4)} ` +
        `complete=${candidate.metrics.completePassageRate?.toFixed(4)} ` +
        `late=${candidate.totals.lateAdvanceCount} ` +
        `p95=${candidate.metrics.p95LatencyMs?.toFixed(1)}ms ` +
        `distance=${candidate.metrics.distanceFromBaseline}`,
      );
    }
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
const serializedResults = JSON.stringify(
  results,
  null,
  LISTEN_DYNAMICS_CONSTANT_MODE || LISTEN_DYNAMICS_MIXED_MODE ? 0 : 2,
);
if (LISTEN_BENCHMARK_OUTPUT_PATH) {
  const outputPath = resolve(LISTEN_BENCHMARK_OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serializedResults}\n`, "utf8");
  console.error(`Archived benchmark result at ${outputPath}`);
}
// Do not duplicate the 3.4 MB Task 08 candidate archive on stdout when it was
// written to a file. Without an output path the non-summary command still emits
// the full result, while the explicit summary command remains compact.
const stdoutResults = LISTEN_MULTIDOMAIN_SWEEP_MODE && LISTEN_BENCHMARK_OUTPUT_PATH
  ? results.map(({ candidateArchive: _candidateArchive, ...summary }) => summary)
  : results;
console.log(JSON.stringify(
  stdoutResults,
  null,
  LISTEN_DYNAMICS_CONSTANT_MODE || LISTEN_DYNAMICS_MIXED_MODE ? 0 : 2,
));
