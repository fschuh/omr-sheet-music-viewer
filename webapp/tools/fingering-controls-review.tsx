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
import { useFingeringEdits } from "../src/useFingeringEdits";
import { hideEditedFingerings } from "../src/fingeringEdits";
import { FingeringEditor } from "../src/FingeringEditor";
import { PianoKeyboard } from "../src/PianoKeyboard";
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
  imageUrl: "../../testdata/fingering-prototype/chopin-25-9-1/page.png", visualSidecar: fixture.sidecar, musicXml: fixture.musicXml };
const reviewPages = Array.from({ length: new URLSearchParams(location.search).has("long") ? 20 : 1 }, (_, index) => ({ ...page, index }));
const feedback: ListenModeFeedback = { lifecycle: stoppedRecognizerLifecycle, targetPitches: [], detectedTargetPitches: [],
  extraPitches: [], targetPitchConfidences: [], recognizedActivePitches: [], attackPitches: [], successPitches: [], processingTimeMs: null };
function Review({ values, score }: { values: Record<string, PredictedFingering>; score: RealtimeScore }) {
  const [other, setOther] = useState(false);
  const store = useFingeringPolicy(`/cache/${(other ? "b" : "a").repeat(64)}`);
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState<VisualGroupRef | null>(null);
  const [visible, setVisible] = useState<number[]>([]);
  const [keyboard, setKeyboard] = useState(false);
  const [changedRecognition, setChangedRecognition] = useState(false);
  const revisionPages = useMemo(() => !changedRecognition ? reviewPages : reviewPages.map(p => ({ ...p,
    musicXml: p.musicXml + "\n<!-- regenerated -->" })), [changedRecognition]);
  const loaded = useMemo<LoadedDocument>(() => ({ jobId: other ? "b" : "a", name: "fixture", pageCount: reviewPages.length,
    cacheStatus: "complete", cachePath: `/cache/${(other ? "b" : "a").repeat(64)}`, fingeringStatus: "ready",
    status: "complete", pages: revisionPages, predictedFingerings: values }), [other, values, revisionPages]);
  const edits = useFingeringEdits(loaded);
  const effectiveDocument = useMemo(() => ({ ...loaded, predictedFingerings: edits.values }), [loaded, edits.values]);
  const results = useScoreFingerings(effectiveDocument, score, !new URLSearchParams(location.search).has("nooverlay"), visible, workerFactory);
  const layout = results[0]?.layout;
  const rasterId = fixture.sidecar.ink_obstacles!.raster_sha256;
  const filtered = hideEditedFingerings(applyFingeringPolicy(layout, store.policy, 0, rasterId), edits.edits, edits.revisions);
  const selectedNotes = fixture.sidecar.notes.filter(note => note.visual_group_id === selected?.visualGroupId);
  const selectedValue = selectedNotes.length ? edits.values?.[`page-1-${selectedNotes[0].musicxml_id}`] : undefined;
  return <main className="app-shell" style={{ height: "100vh" }}>
    <button id="switch-document" onClick={() => setOther(!other)}>Switch document identity</button>
    <button id="toggle-keyboard" onClick={() => setKeyboard(!keyboard)}>Toggle keyboard</button>
    <button id="change-recognition" onClick={() => setChangedRecognition(!changedRecognition)}>Change recognition revision</button>
    <output id="review-state" data-count={filtered?.placed.length} data-regions={store.policy.pages[0]?.regions.length ?? 0}
      data-cached={JSON.stringify(Object.entries(results).filter(([, p]) => p.layout).map(([id]) => Number(id)))}
      data-finger={selectedValue?.finger} data-source={selectedValue?.source}
      data-revisions={Object.keys(edits.revisions).length}
      data-stale={edits.staleCount}
      data-selected={selected?.visualGroupId ?? ""} data-anchor={JSON.stringify(layout?.placed[0]?.request.digits[0].anchor)} />
    <FingeringPolicyControls store={store} pages={[page]} editingPage={editing} onEdit={setEditing} />
    {selectedNotes.length || edits.staleCount || edits.canUndo ? <FingeringEditor store={edits} notes={selectedNotes} ordinal={1} /> : null}
    <section className="workspace debug-panel-hidden"><DocumentViewer documentKey={other ? "b" : "a"} pages={revisionPages}
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
    {keyboard ? <PianoKeyboard notes={selectedNotes.flatMap(note => note.pitch ? [{ pitch: note.pitch, ...edits.values?.[`page-1-${note.musicxml_id}`] }] : [])} /> : null}
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
