import { measureFingeringFont } from "../src/fingeringLayout";
import type { MusicalNoteIdentity } from "../src/scoreFingerings";
import { parseRealtimeMusicXml } from "../src/realtime";
import { addPredictedFingeringsToMusicXml } from "../src/fingering";
import type { VisualSidecar } from "../src/types";
import type { FingeringLayout } from "../src/fingeringLayout";
import type { FingeringRequests } from "../src/scoreFingerings";

declare global { interface Window { fingeringFixture: { id: string; sidecar: VisualSidecar; musicXml: string } } }
const ns = "http://www.w3.org/2000/svg";
const element = (tag: string, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

async function review() {
  await document.fonts.ready;
  const fixture = window.fingeringFixture;
  const sidecar = fixture.sidecar;
  const prediction = await addPredictedFingeringsToMusicXml(fixture.musicXml, async notes =>
    notes.map(n => ({ ...n, finger: (n.sourceIndex % 5) + 1 })));
  const values = Object.fromEntries(Object.entries(prediction.fingeringsByMusicXmlId).map(([id, value]) => [`page-1-${id}`, value]));
  const musical: Record<string, MusicalNoteIdentity> = {};
  parseRealtimeMusicXml(fixture.musicXml).measures.forEach((measure, index) => {
    for (const note of measure.notes) musical[`page-1-${note.musicXmlId}`] = { ...note, measure: index };
  });
  const metrics = measureFingeringFont(document.createElement("canvas").getContext("2d")!);
  const workResult = await new Promise<{ requests: FingeringRequests; result: FingeringLayout; milliseconds: number; integralBytes: number }>((resolve, reject) => {
    const worker = new Worker("../worker.js");
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Annotation worker timeout")); }, 15000);
    worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data); };
    worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error("Annotation worker failed")); };
    worker.postMessage({ token: 1, pageIndex: 0, musicPageNumber: 1, sidecar, values, musicalNotes: musical, metrics });
  });
  const { requests, result, milliseconds, integralBytes } = workResult;
  const [width, height] = sidecar.source_image_size;
  const svg = element("svg", { viewBox: `0 0 ${width} ${height}` });
  const mode = new URLSearchParams(location.search).get("view");
  if (mode === "debug") {
    const artifact = sidecar.ink_obstacles!;
    const [w, h] = artifact.mask_size;
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(w, h), binary = atob(artifact.data);
    for (let i = 0; i < w * h; i++) {
      if ((binary.charCodeAt(i >>> 3) >>> (7 - (i & 7))) & 1) {
        pixels.data[i * 4] = 255; pixels.data[i * 4 + 3] = 110;
      }
    }
    context.putImageData(pixels, 0, 0);
    svg.append(element("image", { href: canvas.toDataURL(), x: 0, y: 0,
      width: w * artifact.source_pixels_per_cell[0], height: h * artifact.source_pixels_per_cell[1] }));
    for (const staff of sidecar.annotation_geometry!.staffs) {
      for (const line of staff.lines) svg.append(element("polyline", { points: line.map(p => p.join(",")).join(" "), fill: "none", stroke: "#00c8c8", "stroke-width": 1.5 }));
    }
    for (const placed of result.placed) {
      const [x0, y0, x1, y1] = placed.bounds;
      svg.append(element("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: "none", stroke: "green" }));
    }
    for (const suppressed of result.suppressed) {
      svg.append(element("circle", { cx: suppressed.request.anchor[0], cy: suppressed.request.anchor[1], r: 8, fill: "none", stroke: "red", "stroke-width": 2 }));
    }
  }
  if (mode !== "original") {
    for (const placed of result.placed) {
      placed.request.digits.forEach((digit, i) => {
        const text = element("text", { x: placed.x, y: placed.baselines[i], "font-family": metrics.family, "font-size": placed.fontSize, "text-anchor": "middle", fill: "#154cad" });
        text.textContent = String(digit.value.finger); svg.append(text);
      });
    }
  }
  document.querySelector("#page")!.append(svg);
  const reasonCounts: Record<string, number> = {};
  for (const omission of requests.omissions) reasonCounts[omission.reason] = (reasonCounts[omission.reason] ?? 0) + 1;
  for (const omission of result.suppressed) reasonCounts[omission.reason] = (reasonCounts[omission.reason] ?? 0) + omission.request.digits.length;
  const report = { id: fixture.id, counts: requests.counts, placed: result.placed.reduce((sum, p) => sum + p.request.digits.length, 0),
    placedStacks: result.placed.filter(p => p.request.digits.length > 1).length, reasons: reasonCounts,
    milliseconds, integralBytes, metrics,
    bounds: result.placed.map(p => ({ id: p.request.id, bounds: p.bounds, digits: p.request.digits.map(d => d.documentId) })) };
  document.querySelector("#metrics")!.textContent = JSON.stringify(report);
  document.documentElement.dataset.ready = "true";
}
review().catch(error => {
  document.querySelector("#metrics")!.textContent = JSON.stringify({ error: String(error) });
  document.documentElement.dataset.ready = "error";
});
