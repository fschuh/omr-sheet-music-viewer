import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentViewer } from "../src/DocumentViewer";
import { FingeringPolicyControls } from "../src/FingeringPolicyControls";
import { useFingeringPolicy } from "../src/useFingeringPolicy";
import { applyFingeringPolicy } from "../src/fingeringPolicy";
import { stoppedRecognizerLifecycle, type ListenModeFeedback } from "../src/noteRecognizer";
import type { DocumentPage, VisualGroupRef, VisualSidecar } from "../src/types";
import { measureFingeringFont, type FingeringLayout } from "../src/fingeringLayout";
import { parseRealtimeMusicXml } from "../src/realtime";
import { addPredictedFingeringsToMusicXml } from "../src/fingering";
import "../src/styles.css";

declare global { interface Window { fingeringFixture: { id: string; sidecar: VisualSidecar; musicXml: string } } }
const fixture = window.fingeringFixture;
const page: DocumentPage = { index: 0, status: "complete", width: fixture.sidecar.source_image_size[0], height: fixture.sidecar.source_image_size[1],
  imageUrl: "../../testdata/fingering-prototype/chopin-25-9-1/page.png", visualSidecar: fixture.sidecar };
const feedback: ListenModeFeedback = { lifecycle: stoppedRecognizerLifecycle, targetPitches: [], detectedTargetPitches: [],
  extraPitches: [], targetPitchConfidences: [], recognizedActivePitches: [], attackPitches: [], successPitches: [], processingTimeMs: null };
function Review({ layout }: { layout: FingeringLayout }) {
  const [other, setOther] = useState(false);
  const store = useFingeringPolicy(`/cache/${(other ? "b" : "a").repeat(64)}`);
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState<VisualGroupRef | null>(null);
  const rasterId = fixture.sidecar.ink_obstacles!.raster_sha256;
  const filtered = applyFingeringPolicy(layout, store.policy, 0, rasterId);
  return <main className="app-shell" style={{ height: "100vh" }}>
    <button id="switch-document" onClick={() => setOther(!other)}>Switch document identity</button>
    <output id="review-state" data-count={filtered?.placed.length} data-regions={store.policy.pages[0]?.regions.length ?? 0}
      data-selected={selected?.visualGroupId ?? ""} data-anchor={JSON.stringify(layout.placed[0].request.digits[0].anchor)} />
    <FingeringPolicyControls store={store} pages={[page]} editingPage={editing} onEdit={setEditing} />
    <section className="workspace debug-panel-hidden"><DocumentViewer documentKey={other ? "b" : "a"} pages={[page]}
      selectedGroup={selected} highlightAllNotes={false} showOriginalNoteheadContours={false} showDetectedNoteheadContours={false}
      showRefinedNoteheadContours={false} showRawStemContours={false} playbackActive={false} playbackNoteSoundsEnabled={false}
      playbackAvailable={false} playbackMoment={null} listenFeedback={feedback} onPlaybackCommand={() => {}}
      onSelectGroup={setSelected} onRetryPage={() => {}} scoreFingerings={{ 0: { layout: filtered, status: "ready" } }}
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
  const values = Object.fromEntries(Object.entries(prediction.fingeringsByMusicXmlId).map(([id, value]) => [`page-1-${id}`, value]));
  const musicalNotes = Object.fromEntries(parseRealtimeMusicXml(fixture.musicXml).measures.flatMap((m, i) => m.notes.map(n => [`page-1-${n.musicXmlId}`, { ...n, measure: i }])));
  const worker = new Worker("../../testdata/fingering-prototype/worker.js");
  worker.onmessage = ({ data }) => {
    worker.terminate();
    if (data.error) throw new Error(data.error);
    createRoot(document.querySelector("#root")!).render(<Review layout={data.result} />);
  };
  worker.postMessage({ token: 1, pageIndex: 0, musicPageNumber: 1, sidecar: fixture.sidecar, values, musicalNotes,
    metrics: measureFingeringFont(document.createElement("canvas").getContext("2d")!) });
}
void start();
