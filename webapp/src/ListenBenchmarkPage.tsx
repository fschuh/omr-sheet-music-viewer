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

let automaticBenchmarkStarted = false;

export function ListenBenchmarkPage() {
  const [runningTask, setRunningTask] = useState<
    "online_amt" | "spectral" | "sequence" | "articulation" | null
  >(null);
  const running = runningTask !== null;
  const [progress, setProgress] = useState("");
  const [progressTask, setProgressTask] = useState<
    "isolated" | "sequence" | "articulation"
  >("isolated");
  const [error, setError] = useState<string | null>(null);
  const [automated, setAutomated] = useState<ListenBenchmarkSummary | null>(null);
  const [sequenceResult, setSequenceResult] = useState<ListenSequenceBenchmarkResult | null>(null);
  const [articulationResult, setArticulationResult] =
    useState<ListenArticulationMatrixResult | null>(null);
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
    if (query.get("listen-articulation") === "auto") {
      automaticBenchmarkStarted = true;
      void runArticulation();
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
      });
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

  async function runSequence() {
    setRunningTask("sequence");
    setProgressTask("sequence");
    setError(null);
    setProgress("Preparing continuous passages…");
    document.body.dataset.status = "running";
    try {
      const result = await runBundledListenSequenceBenchmark((complete, total, label) => {
        setProgress(`${complete} / ${total} sequences · ${label}`);
      });
      setSequenceResult(result);
      (window as typeof window & {
        listenSequenceBenchmarkResult?: ListenSequenceBenchmarkResult;
      }).listenSequenceBenchmarkResult = result;
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
      });
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
  const automatedCorrectAdvances = automated?.trials.filter((trial) => (
    trial.expectedCorrect && trial.advanced
  )).length ?? 0;
  const automatedCourseClearAdvances = automated?.trials.filter((trial) => (
    trial.fixtureGroup === "course-clear" && trial.expectedCorrect && trial.advanced
  )).length ?? 0;
  const percentageDelta = (value: number) => (
    `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`
  );

  return (
    <main className="benchmark-page">
      <h1>Listen-mode benchmark</h1>
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
