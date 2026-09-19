import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentViewer } from "../src/DocumentViewer";
import { FingeringPolicyControls } from "../src/FingeringPolicyControls";
import { useFingeringPolicy } from "../src/useFingeringPolicy";
import { applyFingeringPolicy } from "../src/fingeringPolicy";
import { stoppedRecognizerLifecycle, type ListenModeFeedback } from "../src/noteRecognizer";
import type { DocumentPage, LoadedDocument, VisualGroupRef, VisualSidecar } from "../src/types";
import { parseRealtimeMusicXml, type RealtimeScore } from "../src/realtime";
import { addPredictedFingeringsToMusicXml, type PredictedFingering } from "../src/fingering";
import { useScoreFingerings } from "../src/useScoreFingerings";
import type { FingeringWorkerPort } from "../src/fingeringScheduler";
import "../src/styles.css";

declare global { interface Window { fingeringFixture: { id: string; sidecar: VisualSidecar; musicXml: string };
  fingeringLifecycle: { posted: number[]; cloneMs: number[]; longTasks: number[]; created: number; terminated: number } } }
window.fingeringLifecycle = { posted: [], cloneMs: [], longTasks: [], created: 0, terminated: 0 };
new PerformanceObserver(list => { window.fingeringLifecycle.longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({ type: "longtask" });
const workerFactory = (): FingeringWorkerPort => {
  const worker = new Worker("../../testdata/fingering-prototype/worker.js");
  window.fingeringLifecycle.created++;
  const post = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
  worker.postMessage = message => { const start = performance.now(); post(message); window.fingeringLifecycle.posted.push(message.pageIndex); window.fingeringLifecycle.cloneMs.push(performance.now() - start); };
  worker.terminate = () => { window.fingeringLifecycle.terminated++; terminate(); };
  return worker as FingeringWorkerPort;
};
const fixture = window.fingeringFixture;
const page: DocumentPage = { index: 0, status: "complete", width: fixture.sidecar.source_image_size[0], height: fixture.sidecar.source_image_size[1],
  imageUrl: "../../testdata/fingering-prototype/chopin-25-9-1/page.png", visualSidecar: fixture.sidecar };
const reviewPages = Array.from({ length: new URLSearchParams(location.search).has("long") ? 20 : 1 }, (_, index) => ({ ...page, index }));
const feedback: ListenModeFeedback = { lifecycle: stoppedRecognizerLifecycle, targetPitches: [], detectedTargetPitches: [],
  extraPitches: [], targetPitchConfidences: [], recognizedActivePitches: [], attackPitches: [], successPitches: [], processingTimeMs: null };
function Review({ values, score }: { values: Record<string, PredictedFingering>; score: RealtimeScore }) {
  const [other, setOther] = useState(false);
  const store = useFingeringPolicy(`/cache/${(other ? "b" : "a").repeat(64)}`);
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState<VisualGroupRef | null>(null);
  const [visible, setVisible] = useState<number[]>([]);
  const loaded = useMemo<LoadedDocument>(() => ({ jobId: other ? "b" : "a", name: "fixture", pageCount: reviewPages.length,
    cacheStatus: "complete", status: "complete", pages: reviewPages, predictedFingerings: values }), [other, values]);
  const results = useScoreFingerings(loaded, score, !new URLSearchParams(location.search).has("nooverlay"), visible, workerFactory);
  const layout = results[0]?.layout;
  const rasterId = fixture.sidecar.ink_obstacles!.raster_sha256;
  const filtered = applyFingeringPolicy(layout, store.policy, 0, rasterId);
  return <main className="app-shell" style={{ height: "100vh" }}>
    <button id="switch-document" onClick={() => setOther(!other)}>Switch document identity</button>
    <output id="review-state" data-count={filtered?.placed.length} data-regions={store.policy.pages[0]?.regions.length ?? 0}
      data-cached={JSON.stringify(Object.entries(results).filter(([, p]) => p.layout).map(([id]) => Number(id)))}
      data-selected={selected?.visualGroupId ?? ""} data-anchor={JSON.stringify(layout?.placed[0]?.request.digits[0].anchor)} />
    <FingeringPolicyControls store={store} pages={[page]} editingPage={editing} onEdit={setEditing} />
    <section className="workspace debug-panel-hidden"><DocumentViewer documentKey={other ? "b" : "a"} pages={reviewPages}
      onVisiblePagesChange={setVisible}
      selectedGroup={selected} highlightAllNotes={false} showOriginalNoteheadContours={false} showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false} showRawStemContours={false} playbackActive={false} playbackNoteSoundsEnabled={false}
      playbackAvailable={false} playbackMoment={null} listenFeedback={feedback} onPlaybackCommand={() => {}}
      onSelectGroup={setSelected} onRetryPage={() => {}} scoreFingerings={{ ...results, 0: { layout: filtered, status: "ready" } }}
      exclusionEditor={editing === 0 ? { pageIndex: 0, regions: store.policy.pages[0]?.regions ?? [], onAdd: bounds => {
        const old = store.policy.pages[0] ?? { disabled: false, regions: [] };
        store.change({ ...store.policy, pages: { ...store.policy.pages, 0: { ...old,
          regions: [...old.regions, { id: crypto.randomUUID(), rasterId, bounds }] } } });
      } } : undefined} /></section>
  </main>;
}
async function start() {
  await document.fonts.ready;
  const prediction = await addPredictedFingeringsToMusicXml(fixture.musicXml, async notes => notes.map(n => ({ ...n, finger: n.sourceIndex % 5 + 1 })));
  const values = Object.fromEntries(reviewPages.flatMap(page => Object.entries(prediction.fingeringsByMusicXmlId).map(([id, value]) => [`page-${page.index + 1}-${id}`, value])));
  const parsed = parseRealtimeMusicXml(fixture.musicXml);
  const score = { ...parsed, measures: reviewPages.flatMap(page => parsed.measures.map(measure => ({ ...measure,
    notes: measure.notes.map(note => ({ ...note, musicXmlId: `page-${page.index + 1}-${note.musicXmlId}` })) }))) };
  createRoot(document.querySelector("#root")!).render(<Review values={values} score={score} />);
}
void start();
