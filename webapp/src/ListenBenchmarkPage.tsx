import { useEffect, useMemo, useState } from "react";
import {
  runBundledListenBenchmark,
  runBundledOnlineAmtBenchmark,
  summarizeListenBenchmark,
  type ListenBenchmarkSummary,
  type ListenBenchmarkTrial,
} from "./listenBenchmark";
import {
  runBundledListenSequenceBenchmark,
  runCourseClearArticulationMatrix,
  type ListenArticulationMatrixResult,
  type ListenSequenceBenchmarkResult,
} from "./listenSequenceBenchmark";
import {
  runListenThresholdSweep,
  type ListenThresholdSweepResult,
} from "./listenMatcherSweepBenchmark";
import {
  runListenInferenceResetBenchmark,
  type ListenInferenceResetBenchmarkResult,
} from "./listenInferenceResetBenchmark";
import {
  runListenRetriggerSweep,
  thresholdSweepRecommendedListenMatcherProfile,
  type ListenRetriggerSweepResult,
} from "./listenRetriggerBenchmark";
import {
  LISTEN_BENCHMARK_RENDERER,
  LISTEN_BENCHMARK_TONE_RENDERER,
  type ListenBenchmarkRendererConfiguration,
} from "./listenBenchmarkAudio";
import {
  conciseCourseClearDynamicsResult,
  runCourseClearConstantLayerDynamics,
  runCourseClearMixedDynamics,
  type CourseClearDynamicsSuiteResult,
  type CourseClearMixedDynamicsSuiteResult,
} from "./listenDynamicsBenchmark";

let automaticBenchmarkStarted = false;

function requestedRenderer(): ListenBenchmarkRendererConfiguration {
  const query = new URLSearchParams(window.location.search);
  return query.get("benchmark-renderer") === "tone"
    ? LISTEN_BENCHMARK_TONE_RENDERER
    : LISTEN_BENCHMARK_RENDERER;
}

export function ListenBenchmarkPage() {
  const benchmarkRenderer = useMemo(requestedRenderer, []);
  const [runningTask, setRunningTask] = useState<
    "online_amt" | "spectral" | "sequence" | "threshold-sweep" | "retrigger-sweep" |
      "articulation" | "reset-comparison" | null
      | "dynamics-constant" | "dynamics-mixed"
  >(null);
  const running = runningTask !== null;
  const [progress, setProgress] = useState("");
  const [progressTask, setProgressTask] = useState<
    "isolated" | "sequence" | "threshold-sweep" | "retrigger-sweep" | "articulation" |
      "reset-comparison"
      | "dynamics-constant" | "dynamics-mixed"
  >("isolated");
  const [error, setError] = useState<string | null>(null);
  const [automated, setAutomated] = useState<ListenBenchmarkSummary | null>(null);
  const [sequenceResult, setSequenceResult] = useState<ListenSequenceBenchmarkResult | null>(null);
  const [thresholdSweepResult, setThresholdSweepResult] =
    useState<ListenThresholdSweepResult | null>(null);
  const [articulationResult, setArticulationResult] =
    useState<ListenArticulationMatrixResult | null>(null);
  const [retriggerSweepResult, setRetriggerSweepResult] =
    useState<ListenRetriggerSweepResult | null>(null);
  const [resetComparisonResult, setResetComparisonResult] =
    useState<ListenInferenceResetBenchmarkResult | null>(null);
  const [dynamicsResult, setDynamicsResult] =
    useState<CourseClearDynamicsSuiteResult | null>(null);
  const [mixedDynamicsResult, setMixedDynamicsResult] =
    useState<CourseClearMixedDynamicsSuiteResult | null>(null);
  const [manual, setManual] = useState<ListenBenchmarkTrial[]>([]);
  const [manualSource, setManualSource] = useState<"acoustic" | "digital">("acoustic");
  const [manualCorrect, setManualCorrect] = useState(true);
  const [manualAdvanced, setManualAdvanced] = useState(true);
  const [manualLatency, setManualLatency] = useState("300");
  const [manualAnalysis, setManualAnalysis] = useState("0");
  const manualSummary = useMemo(() => summarizeListenBenchmark(manual), [manual]);
  useEffect(() => {
    if (automaticBenchmarkStarted) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("listen-dynamics-constant") === "auto") {
      automaticBenchmarkStarted = true;
      void runDynamicsConstant();
    } else if (query.get("listen-dynamics-mixed") === "auto") {
      automaticBenchmarkStarted = true;
      void runDynamicsMixed();
    } else if (query.get("listen-retrigger-sweep") === "auto") {
      automaticBenchmarkStarted = true;
      void runRetriggerSweep();
    } else if (query.get("listen-threshold-sweep") === "auto") {
      automaticBenchmarkStarted = true;
      void runThresholdSweep();
    } else if (query.get("listen-articulation") === "auto") {
      automaticBenchmarkStarted = true;
      void runArticulation();
    } else if (query.get("listen-inference-reset") === "auto") {
      automaticBenchmarkStarted = true;
      void runResetComparison();
    } else if (query.get("listen-sequence") === "auto") {
      automaticBenchmarkStarted = true;
      void runSequence();
    } else if (query.get("listen-benchmark") === "auto") {
      automaticBenchmarkStarted = true;
      void run("online_amt");
    }
  }, []);

  async function run(engine: "online_amt" | "spectral") {
    setRunningTask(engine);
    setProgressTask("isolated");
    setError(null);
    document.body.dataset.status = "running";
    try {
      const benchmark = engine === "online_amt"
        ? runBundledOnlineAmtBenchmark
        : runBundledListenBenchmark;
      const result = await benchmark((complete, total) => {
        setProgress(`${complete} / ${total} fixtures`);
      }, benchmarkRenderer);
      setAutomated(result);
      (window as typeof window & { listenBenchmarkResult?: ListenBenchmarkSummary })
        .listenBenchmarkResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runSequence(): Promise<ListenSequenceBenchmarkResult | null> {
    setRunningTask("sequence");
    setProgressTask("sequence");
    setError(null);
    setProgress("Preparing continuous passages…");
    document.body.dataset.status = "running";
    try {
      const result = await runBundledListenSequenceBenchmark((complete, total, label) => {
        setProgress(`${complete} / ${total} sequences · ${label}`);
      }, benchmarkRenderer);
      setSequenceResult(result);
      (window as typeof window & {
        listenSequenceBenchmarkResult?: ListenSequenceBenchmarkResult;
      }).listenSequenceBenchmarkResult = result;
      document.body.dataset.status = "complete";
      return result;
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
    return null;
  }

  async function runThresholdSweep() {
    setRunningTask("threshold-sweep");
    setProgressTask("threshold-sweep");
    setError(null);
    document.body.dataset.status = "running";
    try {
      const corpus = sequenceResult ?? await runSequence();
      if (!corpus) return;
      setRunningTask("threshold-sweep");
      setProgressTask("threshold-sweep");
      document.body.dataset.status = "running";
      const result = await runListenThresholdSweep(corpus, (complete, total, label) => {
        setProgress(`${complete} / ${total} profiles · ${label}`);
      });
      setThresholdSweepResult(result);
      (window as typeof window & {
        listenThresholdSweepResult?: ListenThresholdSweepResult;
      }).listenThresholdSweepResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runRetriggerSweep() {
    setRunningTask("retrigger-sweep");
    setProgressTask("retrigger-sweep");
    setError(null);
    setProgress("Preparing retained stateful trace corpus…");
    document.body.dataset.status = "running";
    try {
      const corpus = sequenceResult ?? await runSequence();
      if (!corpus) return;
      setRunningTask("retrigger-sweep");
      setProgressTask("retrigger-sweep");
      document.body.dataset.status = "running";
      let articulations = articulationResult;
      if (!articulations) {
        setProgress("Capturing corrected Course Clear articulation traces…");
        articulations = await runCourseClearArticulationMatrix((complete, total, label) => {
          setProgress(`${complete} / ${total} articulations · ${label}`);
        }, benchmarkRenderer);
        setArticulationResult(articulations);
        (window as typeof window & {
          listenArticulationBenchmarkResult?: ListenArticulationMatrixResult;
        }).listenArticulationBenchmarkResult = articulations;
      }
      const matcherRecommendation = thresholdSweepResult?.recommendation.profile ??
        thresholdSweepRecommendedListenMatcherProfile;
      setProgress("Verifying decoder parity and auditing hidden score rises…");
      const result = await runListenRetriggerSweep(
        corpus,
        articulations,
        matcherRecommendation,
        (complete, total, label) => {
          setProgress(`${complete} / ${total} retrigger profiles · ${label}`);
        },
      );
      setRetriggerSweepResult(result);
      (window as typeof window & {
        listenRetriggerSweepResult?: ListenRetriggerSweepResult;
      }).listenRetriggerSweepResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runArticulation() {
    setRunningTask("articulation");
    setProgressTask("articulation");
    setError(null);
    setProgress("Preparing Course Clear articulation profiles…");
    document.body.dataset.status = "running";
    try {
      const result = await runCourseClearArticulationMatrix((complete, total, label) => {
        setProgress(`${complete} / ${total} articulations · ${label}`);
      }, benchmarkRenderer);
      setArticulationResult(result);
      (window as typeof window & {
        listenArticulationBenchmarkResult?: ListenArticulationMatrixResult;
      }).listenArticulationBenchmarkResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runResetComparison() {
    setRunningTask("reset-comparison");
    setProgressTask("reset-comparison");
    setError(null);
    setProgress("Preparing stateful/reset comparison…");
    document.body.dataset.status = "running";
    try {
      const result = await runListenInferenceResetBenchmark(
        (stage) => setProgress(stage),
        benchmarkRenderer,
      );
      setResetComparisonResult(result);
      (window as typeof window & {
        listenInferenceResetBenchmarkResult?: ListenInferenceResetBenchmarkResult;
      }).listenInferenceResetBenchmarkResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runDynamicsConstant() {
    setRunningTask("dynamics-constant");
    setProgressTask("dynamics-constant");
    setError(null);
    setProgress("Preparing recorded piano layers…");
    document.body.dataset.status = "running";
    try {
      const result = await runCourseClearConstantLayerDynamics(
        (complete, total, label) => setProgress(`${complete} / ${total} layers · ${label}`),
        benchmarkRenderer,
      );
      setDynamicsResult(result);
      (window as typeof window & {
        listenDynamicsBenchmarkResult?: CourseClearDynamicsSuiteResult;
      }).listenDynamicsBenchmarkResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  async function runDynamicsMixed() {
    setRunningTask("dynamics-mixed");
    setProgressTask("dynamics-mixed");
    setError(null);
    setProgress("Preparing continuous crescendo-decrescendo passages…");
    document.body.dataset.status = "running";
    try {
      const result = await runCourseClearMixedDynamics(
        (complete, total, label) => setProgress(`${complete} / ${total} pianos · ${label}`),
        benchmarkRenderer,
      );
      setMixedDynamicsResult(result);
      (window as typeof window & {
        listenMixedDynamicsBenchmarkResult?: CourseClearMixedDynamicsSuiteResult;
      }).listenMixedDynamicsBenchmarkResult = result;
      document.body.dataset.status = "complete";
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : String(benchmarkError));
      document.body.dataset.status = "error";
    } finally {
      setRunningTask(null);
    }
  }

  const summaryText = (summary: ListenBenchmarkSummary) => JSON.stringify({
    renderer: summary.renderer,
    trials: summary.trials.length,
    correctTrials: summary.correctTrialCount,
    successRate: `${(summary.successRate * 100).toFixed(1)}%`,
    distinguishableFalseAdvances: summary.falseAdvanceCount,
    mathematicallyAmbiguousAdvances: summary.ambiguousAdvanceCount,
    p95OnsetToAdvanceMs: summary.p95OnsetToAdvanceMs,
    courseClear: {
      correctTrials: summary.courseClear.correctTrialCount,
      successRate: summary.courseClear.successRate === null
        ? null
        : `${(summary.courseClear.successRate * 100).toFixed(1)}%`,
      passed: summary.courseClear.passed,
    },
    acceptance: summary.acceptance,
    diagnostics: summary.trials.map((trial) => ({
      fixtureGroup: trial.fixtureGroup,
      measure: trial.measure,
      moment: trial.moment,
      mathematicallyAmbiguous: trial.mathematicallyAmbiguous,
      target: trial.targetPitches,
      played: trial.playedPitches,
      advanced: trial.advanced,
      analysisMs: Math.round(trial.analysisMs),
      audioDiagnostics: trial.audioDiagnostics,
      recognizedOnsets: trial.recognizedOnsets
        ?.filter((onset) => onset.confidence >= 0.4 || onset.noteConfidence >= 0.2)
        .map((onset) => ({
          ...onset,
          confidence: Number(onset.confidence.toFixed(3)),
          noteConfidence: Number(onset.noteConfidence.toFixed(3)),
          fundamentalProminenceDb: onset.fundamentalProminenceDb === undefined
            ? undefined
            : Number(onset.fundamentalProminenceDb.toFixed(1)),
          fundamentalRelativeDb: onset.fundamentalRelativeDb === undefined
            ? undefined
            : Number(onset.fundamentalRelativeDb.toFixed(1)),
          independentEvidenceRelativeDb: onset.independentEvidenceRelativeDb === undefined
            ? undefined
            : Number(onset.independentEvidenceRelativeDb.toFixed(1)),
        })),
    })),
  }, null, 2);

  const sequenceDiagnostics = (result: ListenSequenceBenchmarkResult) => JSON.stringify({
    renderer: result.renderer,
    baseline: result.baseline,
    current: {
      policy: result.policy,
      perSpeed: result.speedSummaries,
    },
    experimental: {
      policy: result.experimental.policy,
      bufferMs: result.experimental.bufferMs,
      comparison: result.experimental.comparison,
      perSpeed: result.experimental.speedSummaries,
    },
    sequences: [...result.runs, ...result.experimental.runs].map((run) => ({
      policy: run.policy,
      sequenceId: run.sequenceId,
      family: run.family,
      intervalMs: run.intervalMs,
      eventRate: run.eventRate,
      summary: run.summary,
      attacks: run.attacks,
      events: run.events,
      trace: {
        renderer: run.trace.renderer,
        audioDiagnostics: run.trace.audioDiagnostics,
        frameCount: run.trace.frames.length,
        relevantPitches: run.trace.relevantPitches,
        maximumInferenceMs: run.trace.maximumInferenceMs,
        maximumProcessingBacklogMs: run.trace.maximumProcessingBacklogMs,
      },
    })),
  }, null, 2);
  const articulationDiagnostics = (result: ListenArticulationMatrixResult) => JSON.stringify({
    renderer: result.renderer,
    intervalMs: result.intervalMs,
    eventCount: result.eventCount,
    conclusion: result.conclusion,
    profiles: result.runs.map((profile) => ({
      articulation: profile.articulation,
      summary: profile.summary,
      deltaFromNormal: profile.deltaFromNormal,
      staleStateEvents: profile.events,
      failures: profile.run.events
        .filter((event) => event.failureReasons.length > 0)
        .map((event) => ({
          index: event.index,
          targetPitches: event.targetPitches,
          expectedPitches: event.expectedPitches,
          confidentUnexpectedPitches: event.confidentUnexpectedPitches,
          rawFailureReasons: event.rawFailureReasons,
          independentFailureReasons: event.independentFailureReasons,
          orderedFailureReasons: event.orderedFailureReasons,
          primaryFailure: event.primaryFailure,
        })),
      trace: {
        audioDiagnostics: profile.run.trace.audioDiagnostics,
        frameCount: profile.run.trace.frames.length,
        maximumInferenceMs: profile.run.trace.maximumInferenceMs,
        maximumProcessingBacklogMs: profile.run.trace.maximumProcessingBacklogMs,
      },
    })),
  }, null, 2);
  const retriggerDiagnostics = (result: ListenRetriggerSweepResult) => {
    const selected = result.recommendation ?? result.diagnosticCandidate;
    return JSON.stringify({
      renderer: result.renderer,
      benchmarkOnly: result.benchmarkOnly,
      productionEnabled: result.productionEnabled,
      replayParityVerified: result.replayParityVerified,
      conclusion: result.conclusion,
      traceIdentities: result.traceIdentities,
      audit: result.audit,
      gridSize: result.gridSize,
      candidatesEvaluated: result.candidatesEvaluated,
      uniqueSyntheticStreamsEvaluated: result.uniqueSyntheticStreamsEvaluated,
      candidatesRejectedByDecoderSafety: result.candidatesRejectedByDecoderSafety,
      candidatesRejectedByMatcherSafety: result.candidatesRejectedByMatcherSafety,
      matcherProfiles: result.matcherProfiles,
      eligibleCandidateIds: result.eligibleCandidates.map(({ options }) => options.id),
      selectedCandidate: selected ? {
        options: selected.options,
        decoder: selected.decoder,
        matcherProfiles: selected.matcherProfiles,
        eligible: selected.eligible,
        rejectionReasons: selected.rejectionReasons,
        falseOrDuplicateSyntheticEvents: selected.decoder.syntheticEvents.filter((event) => (
          event.unassigned || event.duplicateNaturalAttack || event.duringHeldNote ||
          event.duringReleaseTail || event.duringLegatoNonsharedTransition ||
          event.duringIncompleteCarriedBassAttack
        )),
      } : null,
      candidateGateSummary: result.candidates.map((candidate) => ({
        id: candidate.options.id,
        eligible: candidate.eligible,
        rejectionReasons: candidate.rejectionReasons,
        recoveredMissingPhysicalAttacks: candidate.decoder.recoveredMissingPhysicalAttacks,
        syntheticEventCount: candidate.decoder.syntheticEventCount,
        unassignedSyntheticEventCount: candidate.decoder.unassignedSyntheticEventCount,
        duplicateNaturalEventCount: candidate.decoder.duplicateNaturalEventCount,
        heldNoteSyntheticEventCount: candidate.decoder.heldNoteSyntheticEventCount,
        matcherProfiles: candidate.matcherProfiles.map((profile) => ({
          label: profile.label,
          passed: profile.passed,
          independentMatchDelta: profile.independentMatchDelta,
          orderedAdvanceDelta: profile.orderedAdvanceDelta,
          targetedFailureReduction: profile.targetedFailureReduction,
          rejectionReasons: profile.rejectionReasons,
        })),
      })),
    }, null, 2);
  };
  const resetComparisonDiagnostics = (result: ListenInferenceResetBenchmarkResult) => JSON.stringify({
    sequenceId: result.sequenceId,
    intervalMs: result.intervalMs,
    renderer: result.renderer,
    audioDiagnostics: result.audioDiagnostics,
    audioSignature: result.audioSignature,
    resetPlan: result.resetPlan,
    summary: result.summary,
    conclusion: result.conclusion,
    isolatedEvents: result.isolatedEvents.map((isolated) => ({
      key: isolated.key,
      targetPitches: isolated.targetPitches,
      scoreEventIndices: isolated.scoreEventIndices,
      summary: isolated.run.summary,
    })),
    events: result.events.map((event) => ({
      index: event.index,
      targetPitches: event.targetPitches,
      classification: event.classification,
      isolated: event.isolated.event,
      stateful: event.stateful.event,
      eventReset: event.eventReset.event,
      pitches: event.pitches,
      rawModelOutputChangedAfterReset: event.rawModelOutputChangedAfterReset,
      decoderEventsChangedAfterReset: event.decoderEventsChangedAfterReset,
      statefulSustainBecameResetOnset: event.statefulSustainBecameResetOnset,
    })),
  }, null, 2);
  const automatedCorrectAdvances = automated?.trials.filter((trial) => (
    trial.expectedCorrect && trial.advanced
  )).length ?? 0;
  const automatedCourseClearAdvances = automated?.trials.filter((trial) => (
    trial.fixtureGroup === "course-clear" && trial.expectedCorrect && trial.advanced
  )).length ?? 0;
  const percentageDelta = (value: number) => (
    `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`
  );
  const resetControlRows = resetComparisonResult ? [
    {
      label: "Isolated",
      independent: resetComparisonResult.events.filter(({ isolated }) => isolated.event.independentlyMatched).length,
      ordered: resetComparisonResult.events.filter(({ isolated }) => isolated.event.orderedAdvanced).length,
      safety: "—",
    },
    {
      label: "Stateful continuous",
      independent: resetComparisonResult.summary.independentMatchCounts.stateful,
      ordered: resetComparisonResult.summary.orderedAdvanceCounts.stateful,
      safety: `${resetComparisonResult.summary.statefulSafety.falseAdvanceCount} / ${resetComparisonResult.summary.statefulSafety.skippedAdvanceCount} / ${resetComparisonResult.summary.statefulSafety.duplicateAdvanceCount}`,
    },
    {
      label: "Event-reset continuous",
      independent: resetComparisonResult.summary.independentMatchCounts.eventReset,
      ordered: resetComparisonResult.summary.orderedAdvanceCounts.eventReset,
      safety: `${resetComparisonResult.summary.eventResetSafety.falseAdvanceCount} / ${resetComparisonResult.summary.eventResetSafety.skippedAdvanceCount} / ${resetComparisonResult.summary.eventResetSafety.duplicateAdvanceCount}`,
    },
  ] : [];

  return (
    <main className="benchmark-page">
      <h1>Listen-mode benchmark</h1>
      <p>
        Renderer: <code>{benchmarkRenderer.version}</code>. Automated commands run the historical
        direct mixer and the app-equivalent Tone graph as separate, side-by-side configurations.
      </p>
      <p>
        This page keeps isolated recognition checks separate from continuous playing tests.
        The application default is online_amt; the spectral implementation remains available
        for isolated comparison. Isolated acceptance is fixed at p95 latency under
        400 ms, at least 95% correct advancement overall and for the Course Clear score,
        and zero distinguishable wrong-note false advances. Exact upper-harmonic ties are
        reported separately because the spectrum alone cannot identify their source note.
      </p>
      <h2>Isolated notes and chords</h2>
      <button type="button" disabled={running} onClick={() => void run("online_amt")}>
        {runningTask === "online_amt" ? "Running…" : "Run online_amt benchmark"}
      </button>
      <button type="button" disabled={running} onClick={() => void run("spectral")}>
        {runningTask === "spectral" ? "Running…" : "Run spectral benchmark"}
      </button>
      {progress && progressTask === "isolated"
        ? <span className="benchmark-progress">{progress}</span>
        : null}
      {error ? <div className="error">{error}</div> : null}
      {automated ? (
        <>
          <section className="benchmark-result-summary">
            <h3>Isolated benchmark summary</h3>
            <p className={automated.acceptance.passed
              ? "benchmark-outcome benchmark-outcome-pass"
              : "benchmark-outcome benchmark-outcome-fail"}>
              <strong>{automated.acceptance.passed
                ? "Passed all acceptance checks"
                : "One or more acceptance checks failed"}</strong>
            </p>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Result</th>
                    <th>Requirement</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Correct advancement</td>
                    <td>{automatedCorrectAdvances}/{automated.correctTrialCount} ({(automated.successRate * 100).toFixed(1)}%)</td>
                    <td>At least 95%</td>
                    <td>{automated.acceptance.successRate ? "Pass" : "Fail"}</td>
                  </tr>
                  <tr>
                    <td>Course Clear advancement</td>
                    <td>{automatedCourseClearAdvances}/{automated.courseClear.correctTrialCount} ({automated.courseClear.successRate === null
                      ? "not run"
                      : `${(automated.courseClear.successRate * 100).toFixed(1)}%`})</td>
                    <td>At least 95%</td>
                    <td>{automated.acceptance.courseClearSuccessRate ? "Pass" : "Fail"}</td>
                  </tr>
                  <tr>
                    <td>p95 onset-to-advance latency</td>
                    <td>{automated.p95OnsetToAdvanceMs === null
                      ? "No successful trials"
                      : `${automated.p95OnsetToAdvanceMs.toFixed(0)} ms`}</td>
                    <td>Under 400 ms</td>
                    <td>{automated.acceptance.latency ? "Pass" : "Fail"}</td>
                  </tr>
                  <tr>
                    <td>Distinguishable false advances</td>
                    <td>{automated.falseAdvanceCount}</td>
                    <td>Zero</td>
                    <td>{automated.acceptance.falseAdvances ? "Pass" : "Fail"}</td>
                  </tr>
                  <tr>
                    <td>Mathematically ambiguous advances</td>
                    <td>{automated.ambiguousAdvanceCount}</td>
                    <td>Reported separately</td>
                    <td>Information</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <h3>Detailed isolated diagnostics</h3>
          <pre>{summaryText(automated)}</pre>
        </>
      ) : null}

      <section className="sequence-benchmark">
        <h2>Continuous sequences</h2>
        <p>
          Each passage is rendered as one uninterrupted 16 kHz stream. Recognition runs once,
          then the current exact matcher replays the target-independent trace without resetting
          between score events. These results characterize behavior only; they do not impose a
          fast-playing acceptance threshold.
        </p>
        <button type="button" disabled={running} onClick={() => void runSequence()}>
          {runningTask === "sequence" ? "Running…" : "Run continuous-sequence benchmark"}
        </button>
        {progress && progressTask === "sequence"
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {sequenceResult ? (
          <>
            <p>
              Experimental {sequenceResult.experimental.bufferMs} ms next-onset buffer: {" "}
              <strong>{sequenceResult.experimental.comparison.accepted
                ? "accepted by the safety criteria"
                : "not accepted by the safety criteria"}</strong>.
              Correct-advance change {sequenceResult.experimental.comparison.correctAdvanceImprovement >= 0 ? "+" : ""}
              {sequenceResult.experimental.comparison.correctAdvanceImprovement}; ordered-prefix change {" "}
              {sequenceResult.experimental.comparison.orderedPrefixImprovement >= 0 ? "+" : ""}
              {sequenceResult.experimental.comparison.orderedPrefixImprovement}; complete-passage change {" "}
              {sequenceResult.experimental.comparison.completePassageImprovement >= 0 ? "+" : ""}
              {sequenceResult.experimental.comparison.completePassageImprovement}.
            </p>
            <p>
              Independent match evaluates each scheduled event against its intended target.
              Ordered advance measures actual score progress and may be reduced by an earlier
              stall.
            </p>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Family</th>
                    <th>Interval</th>
                    <th>Rate</th>
                    <th>Raw evidence</th>
                    <th>Threshold qualified</th>
                    <th>Independent match</th>
                    <th>Succeeded / total</th>
                    <th>Ordered advance</th>
                    <th>Blocked after stall</th>
                    <th>First causal stall</th>
                    <th>Primary failure</th>
                    <th>Independent p50 / p95</th>
                    <th>Ordered p50 / p95</th>
                    <th>False / skip / duplicate</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...sequenceResult.familySpeedSummaries.map((summary) => ({
                      policy: "Current",
                      summary,
                    })),
                    ...sequenceResult.experimental.familySpeedSummaries.map((summary) => ({
                      policy: "Buffered",
                      summary,
                    })),
                  ].map(({ policy, summary }) => (
                    <tr key={`${policy}-${summary.family}-${summary.intervalMs}`}>
                      <td>{policy}</td>
                      <td>{summary.family}</td>
                      <td>{Number.isInteger(summary.intervalMs)
                        ? summary.intervalMs
                        : summary.intervalMs.toFixed(1)} ms</td>
                      <td>{summary.eventRate.toFixed(1)}/s</td>
                      <td>{(summary.rawCompleteEvidenceRate * 100).toFixed(1)}%</td>
                      <td>{(summary.thresholdQualifiedEventRate * 100).toFixed(1)}%</td>
                      <td>{(summary.independentMatchRate * 100).toFixed(1)}%</td>
                      <td>{summary.correctAdvanceCount} / {summary.expectedEventCount}</td>
                      <td>{(summary.orderedAdvanceRate * 100).toFixed(1)}%</td>
                      <td>{summary.recognizedButBlockedCount}</td>
                      <td>{summary.firstStalls.length === 0
                        ? "—"
                        : summary.firstStalls
                          .map((stall) => `${stall.sequenceId}:${stall.position}`)
                          .join(", ")}</td>
                      <td>{summary.firstStalls
                        .map(({ primaryFailure }) => primaryFailure)
                        .find((reason) => reason !== null) ?? "—"}</td>
                      <td>{summary.p50IndependentMatchLatencyMs ?? "—"} / {summary.p95IndependentMatchLatencyMs ?? "—"} ms</td>
                      <td>{summary.p50OrderedAdvanceLatencyMs ?? "—"} / {summary.p95OrderedAdvanceLatencyMs ?? "—"} ms</td>
                      <td>{summary.falseAdvanceCount} / {summary.skippedAdvanceCount} / {summary.duplicateAdvanceCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Detailed continuous diagnostics</h3>
            <pre>{sequenceDiagnostics(sequenceResult)}</pre>
          </>
        ) : null}
      </section>

      <section className="sequence-benchmark retrigger-sweep-benchmark">
        <h2>Replay retrigger detector</h2>
        <p>
          Benchmark only. This action captures or reuses the stateful six-speed and corrected
          articulation traces, verifies disabled decoder parity, audits genuinely missing
          physical attacks, and re-decodes the retained raw scores through the fixed 432-profile
          score-rise grid. It never enables retrigger detection in Listen mode.
        </p>
        <button type="button" disabled={running} onClick={() => void runRetriggerSweep()}>
          {runningTask === "retrigger-sweep" ? "Replaying…" : "Replay retrigger detector"}
        </button>
        {progress && progressTask === "retrigger-sweep"
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {retriggerSweepResult ? (() => {
          const selected = retriggerSweepResult.recommendation ??
            retriggerSweepResult.diagnosticCandidate;
          const hidden = retriggerSweepResult.audit.opportunities.filter(({ classification }) => (
            classification === "hidden-rise-under-sustain"
          ));
          return (
            <>
              <p className={retriggerSweepResult.recommendation
                ? "benchmark-outcome benchmark-outcome-pass"
                : "benchmark-outcome benchmark-outcome-fail"}>
                <strong>{retriggerSweepResult.conclusion.text}</strong>
              </p>
              <p>
                Hidden-rise opportunities: {hidden.length}. Evaluated {retriggerSweepResult.candidatesEvaluated} / {retriggerSweepResult.gridSize}
                candidates across {retriggerSweepResult.uniqueSyntheticStreamsEvaluated} exact synthetic streams; {retriggerSweepResult.candidatesRejectedByDecoderSafety} rejected by decoder safety and {" "}
                {retriggerSweepResult.candidatesRejectedByMatcherSafety} rejected by matcher safety. Production enabled: no.
              </p>
              {hidden.length > 0 ? (
                <p>
                  Locations: {hidden.map((opportunity) => (
                    `${opportunity.sequenceId}@${Number.isInteger(opportunity.intervalMs)
                      ? opportunity.intervalMs
                      : opportunity.intervalMs.toFixed(1)}ms#${opportunity.attackIndex}:${opportunity.midi}`
                  )).join(", ")}
                </p>
              ) : null}
              <div className="benchmark-table-wrap">
                <table className="benchmark-table">
                  <thead>
                    <tr>
                      <th>Matcher profile</th>
                      <th>Baseline independent / ordered</th>
                      <th>Candidate independent / ordered</th>
                      <th>Targeted failures removed</th>
                      <th>Safety false / skip / duplicate / carried bass</th>
                      <th>Gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retriggerSweepResult.matcherProfiles.map((baseline) => {
                      const evaluation = selected?.matcherProfiles.find(({ label }) => (
                        label === baseline.label
                      ));
                      const candidate = evaluation?.candidate;
                      return (
                        <tr key={baseline.label}>
                          <td>{baseline.label}</td>
                          <td>{baseline.baseline.independentMatchCount} / {baseline.baseline.orderedAdvanceCount}</td>
                          <td>{candidate
                            ? `${candidate.independentMatchCount} / ${candidate.orderedAdvanceCount}`
                            : "—"}</td>
                          <td>{evaluation?.targetedFailureReduction ?? "—"}</td>
                          <td>{candidate
                            ? `${candidate.falseAdvanceCount} / ${candidate.skippedAdvanceCount} / ${candidate.duplicateAdvanceCount} / ${candidate.incompleteCarriedBassAdvances}`
                            : "—"}</td>
                          <td>{evaluation ? (evaluation.passed ? "Pass" : "Fail") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selected ? (
                <p>
                  {selected.eligible ? "Recommended" : "Best diagnostic"} candidate: <code>{selected.options.id}</code>.{" "}
                  Recovered {selected.decoder.recoveredMissingPhysicalAttacks} / {selected.decoder.missingPhysicalAttacksInProduction} missing physical attacks with {selected.decoder.syntheticEventCount} synthetic events; {" "}
                  unassigned {selected.decoder.unassignedSyntheticEventCount}, duplicate {selected.decoder.duplicateNaturalEventCount}, held-note {selected.decoder.heldNoteSyntheticEventCount}, release-tail {selected.decoder.releaseTailSyntheticEventCount}, legato-nonshared {selected.decoder.legatoNonsharedSyntheticEventCount}, incomplete carried-bass {selected.decoder.incompleteCarriedBassSyntheticEventCount}.
                </p>
              ) : null}
              <h3>Detailed retrigger audit, assignments, deltas, and safety gates</h3>
              <pre>{retriggerDiagnostics(retriggerSweepResult)}</pre>
            </>
          );
        })() : null}
      </section>

      <section className="sequence-benchmark threshold-sweep-benchmark">
        <h2>Threshold replay sweep</h2>
        <p>
          Replays the retained stateful traces with fixed timing and no new rendering or
          inference. The sweep is available after continuous traces exist and never changes the
          production profile automatically.
        </p>
        <button
          type="button"
          disabled={running || sequenceResult === null}
          onClick={() => void runThresholdSweep()}
        >
          {runningTask === "threshold-sweep" ? "Sweeping…" : "Replay threshold sweep"}
        </button>
        {progress && progressTask === "threshold-sweep"
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {thresholdSweepResult ? (
          <>
            <p>
              Evaluated {thresholdSweepResult.profilesEvaluated} / {thresholdSweepResult.gridSize}
              profiles; {thresholdSweepResult.profilesRejectedBySafety} rejected by safety.{" "}
              Recommendation: <strong>{thresholdSweepResult.recommendation.profile.id}</strong>{" "}
              ({thresholdSweepResult.noSafeImprovement ? "production retained" : "safe improvement"}).
            </p>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Safe</th>
                    <th>Independent</th>
                    <th>Ordered</th>
                    <th>Complete passages</th>
                    <th>Latency p95</th>
                    <th>Safety false / skip / duplicate</th>
                    <th>Carried-bass incomplete</th>
                  </tr>
                </thead>
                <tbody>
                  {[thresholdSweepResult.productionBaseline, ...thresholdSweepResult.paretoFrontier
                    .filter((candidate) => (
                      candidate.profile.id !== thresholdSweepResult.productionBaseline.profile.id
                    ))
                    .slice(0, 7)]
                    .map((candidate) => (
                      <tr key={candidate.profile.id}>
                        <td><code>{candidate.profile.id}</code></td>
                        <td>{candidate.safety.passed ? "Yes" : "No"}</td>
                        <td>{candidate.independentMatchCount}</td>
                        <td>{candidate.orderedAdvanceCount}</td>
                        <td>{candidate.completePassageCount}</td>
                        <td>{candidate.p95OrderedAdvanceLatencyMs ?? "—"} ms</td>
                        <td>{candidate.safety.falseAdvanceCount} / {candidate.safety.skippedAdvanceCount} / {candidate.safety.duplicateAdvanceCount}</td>
                        <td>{candidate.safety.incompleteCarriedBassAdvances}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <h3>Recommendation deltas by speed</h3>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Interval</th>
                    <th>Independent</th>
                    <th>Ordered</th>
                    <th>Prefix</th>
                    <th>Complete passages</th>
                    <th>Latency p95</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholdSweepResult.recommendation.nonSafetyDeltasFromProduction
                    .map((delta) => (
                      <tr key={delta.intervalMs}>
                        <td>{Number.isInteger(delta.intervalMs)
                          ? delta.intervalMs
                          : delta.intervalMs.toFixed(1)} ms</td>
                        <td>{delta.independentMatchDelta >= 0 ? "+" : ""}{delta.independentMatchDelta}</td>
                        <td>{delta.orderedAdvanceDelta >= 0 ? "+" : ""}{delta.orderedAdvanceDelta}</td>
                        <td>{delta.orderedPrefixDelta >= 0 ? "+" : ""}{delta.orderedPrefixDelta}</td>
                        <td>{delta.completePassageDelta >= 0 ? "+" : ""}{delta.completePassageDelta}</td>
                        <td>{delta.p95OrderedAdvanceLatencyDeltaMs === null
                          ? "—"
                          : `${delta.p95OrderedAdvanceLatencyDeltaMs >= 0 ? "+" : ""}${delta.p95OrderedAdvanceLatencyDeltaMs.toFixed(1)} ms`}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <h3>Production baseline and candidate configuration</h3>
            <pre>{JSON.stringify({
              renderer: thresholdSweepResult.renderer,
              production: thresholdSweepResult.productionProfile,
              recommendation: thresholdSweepResult.recommendation.profile,
              paretoFrontier: thresholdSweepResult.paretoFrontier.map((candidate) => ({
                profile: candidate.profile,
                eligible: candidate.eligible,
                safety: candidate.safety,
                perSpeedDeltas: candidate.nonSafetyDeltasFromProduction,
              })),
            }, null, 2)}</pre>
          </>
        ) : null}
      </section>

      <section className="sequence-benchmark articulation-benchmark">
        <h2>Course Clear articulation matrix</h2>
        <p>
          Four independent continuous traces use the same 27 targets and 1000 ms attack
          timestamps. Only hold scheduling changes. Detached leaves a 400 ms silent gap,
          normal is the canonical 420 ms hold, legato overlaps by 250 ms, and
          sustained-shared attacks only newly introduced chord tones.
        </p>
        <button type="button" disabled={running} onClick={() => void runArticulation()}>
          {runningTask === "articulation" ? "Running…" : "Run articulation matrix"}
        </button>
        {progress && progressTask === "articulation"
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {articulationResult ? (
          <>
            <p>
              <strong>{articulationResult.conclusion.text}</strong>{" "}
              “Substantial” is fixed at {articulationResult.conclusion.substantialThresholdCount}
              /{articulationResult.eventCount} additional independent matches ({(
                articulationResult.conclusion.substantialThresholdRate * 100
              ).toFixed(1)} percentage points) without added safety errors.
            </p>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Articulation</th>
                    <th>Raw evidence</th>
                    <th>Fresh attacks</th>
                    <th>Independent match</th>
                    <th>Ordered advance</th>
                    <th>Complete</th>
                    <th>Stale sustain</th>
                    <th>Carry-over events</th>
                    <th>False / skip / duplicate</th>
                    <th>Δ raw / independent / ordered</th>
                  </tr>
                </thead>
                <tbody>
                  {articulationResult.runs.map((profile) => (
                    <tr key={profile.articulation}>
                      <td>{profile.articulation}</td>
                      <td>{profile.summary.rawEvidenceCount}/{profile.summary.expectedEventCount} ({(
                        profile.summary.rawEvidenceRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{profile.summary.producedFreshAttackCount}/{profile.summary.expectedFreshAttackCount} ({(
                        profile.summary.freshAttackRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{profile.summary.independentMatchCount}/{profile.summary.expectedEventCount} ({(
                        profile.summary.independentMatchRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{profile.summary.orderedAdvanceCount}/{profile.summary.expectedEventCount} ({(
                        profile.summary.orderedAdvanceRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{profile.summary.completePassage ? "Yes" : "No"}</td>
                      <td>{profile.summary.staleSustainPitchCount}</td>
                      <td>{profile.summary.carryOverEventCount}</td>
                      <td>{profile.summary.falseAdvanceCount} / {profile.summary.skippedAdvanceCount} / {profile.summary.duplicateAdvanceCount}</td>
                      <td>{percentageDelta(profile.deltaFromNormal.rawEvidenceRate)} / {percentageDelta(
                        profile.deltaFromNormal.independentMatchRate
                      )} / {percentageDelta(profile.deltaFromNormal.orderedAdvanceRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Detailed articulation diagnostics</h3>
            <pre>{articulationDiagnostics(articulationResult)}</pre>
          </>
        ) : null}
      </section>

      <section className="sequence-benchmark dynamics-benchmark">
        <h2>Course Clear piano dynamics</h2>
        <p>
          Constant-layer runs cover all 4 Splendid and 16 Salamander recordings. The mixed
          suite keeps one uninterrupted 27-attack recognition trace while moving through every
          layer and back down. Pitch, 1000 ms timing, normal articulation, and matcher policy
          remain fixed.
        </p>
        <button type="button" disabled={running} onClick={() => void runDynamicsConstant()}>
          {runningTask === "dynamics-constant" ? "Running…" : "Run all constant layers"}
        </button>{" "}
        <button type="button" disabled={running} onClick={() => void runDynamicsMixed()}>
          {runningTask === "dynamics-mixed" ? "Running…" : "Run mixed dynamics"}
        </button>
        {progress && (progressTask === "dynamics-constant" || progressTask === "dynamics-mixed")
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {dynamicsResult ? (
          <>
            <h3>Constant-layer results</h3>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead><tr>
                  <th>Piano / layer</th><th>Independent</th><th>Ordered</th><th>Complete</th>
                  <th>Misses</th><th>False / skip / duplicate</th><th>p95 latency</th>
                  <th>Peak / RMS</th><th>PCM</th>
                </tr></thead>
                <tbody>
                  {dynamicsResult.runs.map((run) => (
                    <tr key={`${run.piano}-${run.layer}`}>
                      <td>{run.pianoName} · {run.layer}</td>
                      <td>{run.recognition.summary.independentMatchCount}/27 ({(
                        run.recognition.summary.independentMatchRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{run.recognition.summary.orderedAdvanceCount}/27 ({(
                        run.recognition.summary.orderedAdvanceRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{run.recognition.summary.complete ? "Yes" : "No"}</td>
                      <td>{run.recognition.summary.missedCount}</td>
                      <td>{run.recognition.summary.falseAdvanceCount} / {run.recognition.summary.skippedAdvanceCount} / {run.recognition.summary.duplicateAdvanceCount}</td>
                      <td>{run.recognition.summary.p95OrderedAdvanceLatencyMs === null
                        ? "—"
                        : `${run.recognition.summary.p95OrderedAdvanceLatencyMs.toFixed(0)} ms`}</td>
                      <td>{run.peak.toFixed(4)} / {run.rms.toFixed(4)}</td>
                      <td><code>{run.pcmSignature.pcmHash}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead><tr>
                  <th>Aggregate</th><th>Independent</th><th>Ordered</th><th>Complete</th>
                  <th>Safety F/S/D</th><th>Worst layer</th>
                </tr></thead>
                <tbody>
                  {[...dynamicsResult.pianos, {
                    piano: "cross" as const,
                    pianoName: "Cross-piano (equal weight)",
                    ...dynamicsResult.crossPiano,
                  }].map((summary) => (
                    <tr key={summary.piano}>
                      <td>{summary.pianoName}</td>
                      <td>{(summary.independentMatchRate * 100).toFixed(1)}%</td>
                      <td>{(summary.orderedAdvanceRate * 100).toFixed(1)}%</td>
                      <td>{summary.completePassageCount}/{summary.runCount} ({(
                        summary.completePassageRate * 100
                      ).toFixed(1)}%)</td>
                      <td>{summary.falseAdvanceCount} / {summary.skippedAdvanceCount} / {summary.duplicateAdvanceCount}</td>
                      <td>{summary.worstPerformingLayer ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre>{JSON.stringify(conciseCourseClearDynamicsResult(dynamicsResult), null, 2)}</pre>
          </>
        ) : null}
        {mixedDynamicsResult ? (
          <>
            <h3>Mixed crescendo-decrescendo results</h3>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead><tr>
                  <th>Piano</th><th>Layer path</th><th>Independent</th><th>Ordered</th>
                  <th>Complete</th><th>Misses</th><th>False / skip / duplicate</th>
                  <th>Peak / RMS</th><th>PCM</th>
                </tr></thead>
                <tbody>
                  {mixedDynamicsResult.runs.map((run) => (
                    <tr key={run.piano}>
                      <td>{run.pianoName}</td>
                      <td><code>{run.attackLayers.join(" ")}</code></td>
                      <td>{run.recognition.summary.independentMatchCount}/27</td>
                      <td>{run.recognition.summary.orderedAdvanceCount}/27</td>
                      <td>{run.recognition.summary.complete ? "Yes" : "No"}</td>
                      <td>{run.recognition.summary.missedCount}</td>
                      <td>{run.recognition.summary.falseAdvanceCount} / {run.recognition.summary.skippedAdvanceCount} / {run.recognition.summary.duplicateAdvanceCount}</td>
                      <td>{run.peak.toFixed(4)} / {run.rms.toFixed(4)}</td>
                      <td><code>{run.pcmSignature.pcmHash}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre>{JSON.stringify(conciseCourseClearDynamicsResult(mixedDynamicsResult), null, 2)}</pre>
          </>
        ) : null}
      </section>

      <section className="sequence-benchmark reset-comparison-benchmark">
        <h2>Stateful/reset inference comparison</h2>
        <p>
          Diagnostic only: one canonical normal-articulation Course Clear passage is rendered once,
          then captured with current stateful inference and with a paired session/decoder reset
          before each event’s frame-aligned warm-up window. Isolated one-event controls preserve
          the corresponding attack’s 512-sample frame phase and are reused only when chord and phase match.
        </p>
        <button type="button" disabled={running} onClick={() => void runResetComparison()}>
          {runningTask === "reset-comparison" ? "Running…" : "Run stateful/reset comparison"}
        </button>
        {progress && progressTask === "reset-comparison"
          ? <span className="benchmark-progress">{progress}</span>
          : null}
        {resetComparisonResult ? (
          <>
            <p>
              <strong>{resetComparisonResult.conclusion.text}</strong>{" "}
              Recovered {resetComparisonResult.summary.recoveredEventCount}, lost {resetComparisonResult.summary.lostEventCount};
              raw Δ {resetComparisonResult.summary.rawEvidenceDelta >= 0 ? "+" : ""}
              {resetComparisonResult.summary.rawEvidenceDelta}, independent Δ {resetComparisonResult.summary.independentMatchDelta >= 0 ? "+" : ""}
              {resetComparisonResult.summary.independentMatchDelta}, ordered Δ {resetComparisonResult.summary.orderedAdvanceDelta >= 0 ? "+" : ""}
              {resetComparisonResult.summary.orderedAdvanceDelta}.
            </p>
            <div className="benchmark-table-wrap">
              <table className="benchmark-table">
                <thead>
                  <tr>
                    <th>Control</th>
                    <th>Independent match</th>
                    <th>Ordered advancement</th>
                    <th>False / skip / duplicate</th>
                  </tr>
                </thead>
                <tbody>
                  {resetControlRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.independent}/{resetComparisonResult.events.length} ({(
                        row.independent / resetComparisonResult.events.length * 100
                      ).toFixed(1)}%)</td>
                      <td>{row.ordered}/{resetComparisonResult.events.length} ({(
                        row.ordered / resetComparisonResult.events.length * 100
                      ).toFixed(1)}%)</td>
                      <td>{row.safety}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Recovered/lost pitches: {resetComparisonResult.summary.recoveredPitchCount} / {resetComparisonResult.summary.lostPitchCount}.{" "}
              Sustain-to-onset: {resetComparisonResult.summary.sustainToOnsetCount}.{" "}
              Audio signature: <code>{resetComparisonResult.audioSignature.pcmHash}</code> ({resetComparisonResult.audioSignature.chunkHashes.length} chunks).{" "}
              {resetComparisonResult.summary.safetyErrorsIncreased ? "Safety errors increased." : "No safety-error increase."}
            </p>
            <h3>Detailed reset comparison diagnostics</h3>
            <pre>{resetComparisonDiagnostics(resetComparisonResult)}</pre>
          </>
        ) : null}
      </section>

      <h2>Manual acoustic and digital-piano trials</h2>
      <p>
        Run listen mode in the score, then enter each correct or deliberately wrong trial.
        Use the toolbar analysis duration and measure onset-to-advance latency externally.
      </p>
      <div className="benchmark-form">
        <label>Source
          <select value={manualSource} onChange={(event) => setManualSource(event.target.value as "acoustic" | "digital")}>
            <option value="acoustic">Acoustic piano</option>
            <option value="digital">Digital piano</option>
          </select>
        </label>
        <label><input type="checkbox" checked={manualCorrect} onChange={(event) => setManualCorrect(event.target.checked)} /> Correct target</label>
        <label><input type="checkbox" checked={manualAdvanced} onChange={(event) => setManualAdvanced(event.target.checked)} /> Viewer advanced</label>
        <label>Onset-to-advance ms<input type="number" value={manualLatency} onChange={(event) => setManualLatency(event.target.value)} /></label>
        <label>Analysis ms<input type="number" value={manualAnalysis} onChange={(event) => setManualAnalysis(event.target.value)} /></label>
        <button type="button" onClick={() => setManual((trials) => [...trials, {
          source: manualSource,
          targetPitches: [],
          playedPitches: [],
          expectedCorrect: manualCorrect,
          advanced: manualAdvanced,
          onsetToAdvanceMs: manualAdvanced ? Number(manualLatency) : null,
          analysisMs: Number(manualAnalysis),
        }])}>Record trial</button>
        <button type="button" disabled={manual.length === 0} onClick={() => setManual([])}>Clear manual trials</button>
      </div>
      {manual.length > 0 ? <pre>{summaryText(manualSummary)}</pre> : null}
    </main>
  );
}
