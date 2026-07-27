import { useEffect, useMemo, useState } from "react";
import {
  runBundledListenBenchmark,
  runBundledOnlineAmtBenchmark,
  summarizeListenBenchmark,
  type ListenBenchmarkSummary,
  type ListenBenchmarkTrial,
} from "./listenBenchmark";

let automaticBenchmarkStarted = false;

export function ListenBenchmarkPage() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [automated, setAutomated] = useState<ListenBenchmarkSummary | null>(null);
  const [automatedEngine, setAutomatedEngine] = useState<"online_amt" | "spectral">("online_amt");
  const [manual, setManual] = useState<ListenBenchmarkTrial[]>([]);
  const [manualSource, setManualSource] = useState<"acoustic" | "digital">("acoustic");
  const [manualCorrect, setManualCorrect] = useState(true);
  const [manualAdvanced, setManualAdvanced] = useState(true);
  const [manualLatency, setManualLatency] = useState("300");
  const [manualAnalysis, setManualAnalysis] = useState("0");
  const manualSummary = useMemo(() => summarizeListenBenchmark(manual), [manual]);
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("listen-benchmark") === "auto" &&
      !automaticBenchmarkStarted
    ) {
      automaticBenchmarkStarted = true;
      void run("online_amt");
    }
  }, []);

  async function run(engine: "online_amt" | "spectral") {
    setRunning(true);
    setError(null);
    setAutomatedEngine(engine);
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
      setRunning(false);
    }
  }

  const summaryText = (summary: ListenBenchmarkSummary) => JSON.stringify({
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

  return (
    <main className="benchmark-page">
      <h1>Listen-mode benchmark</h1>
      <p>
        This page runs either local recognizer against isolated notes and one-to-six-note chords
        rendered from the bundled piano samples. The application default is online_amt; the
        spectral implementation remains available here for comparison. Acceptance is fixed at p95 latency under
        400 ms, at least 95% correct advancement overall and for the Course Clear score,
        and zero distinguishable wrong-note false advances. Exact upper-harmonic ties are
        reported separately because the spectrum alone cannot identify their source note.
      </p>
      <button type="button" disabled={running} onClick={() => void run("online_amt")}>
        {running && automatedEngine === "online_amt" ? "Running…" : "Run online_amt benchmark"}
      </button>
      <button type="button" disabled={running} onClick={() => void run("spectral")}>
        {running && automatedEngine === "spectral" ? "Running…" : "Run spectral benchmark"}
      </button>
      {progress ? <span className="benchmark-progress">{progress}</span> : null}
      {error ? <div className="error">{error}</div> : null}
      {automated ? <pre>{summaryText(automated)}</pre> : null}

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
