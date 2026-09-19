// Actual browser SVG/font/worker review using Node's built-in CDP WebSocket client.
import { spawn } from "node:child_process";
import { readFile, writeFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkControls } from "./fingering-controls-check.mjs";

const root = fileURLToPath(new URL("../testdata/fingering-prototype/", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const split = option("--split", "development"), id = option("--id"), width = Number(option("--width", "1300"));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "fingering-cdp-"));
const chrome = spawn("google-chrome", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--allow-file-access-from-files", "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
let socket;
try {
  let port;
  for (let i = 0; i < 150; i++) {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error("Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  const traceEvents = [];
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Tracing.dataCollected") traceEvents.push(...message.params.value);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  if (process.argv.includes("--controls")) await checkControls(call, evaluate, traceEvents);
  for (const name of (process.argv.includes("--controls") ? [] : (await readdir(root)).sort())) {
    if (id && name !== id) continue;
    let packet;
    try { packet = JSON.parse((await readFile(join(root, name, "packet.js"), "utf8")).replace(/^window.fingeringFixture=/, "").replace(/;$/, "")); } catch { continue; }
    if (split !== "all" && packet.split !== split) continue;
    const [sourceWidth, sourceHeight] = packet.sidecar.source_image_size;
    await call("Emulation.setDeviceMetricsOverride", { width, height: Math.ceil(sourceHeight / sourceWidth * width), deviceScaleFactor: 1, mobile: false });
    let first;
    for (const mode of ["annotated", "original", "debug"]) {
      const url = pathToFileURL(join(root, name, "review.html")).href + `?view=${mode}`;
      await call("Page.navigate", { url });
      let ready;
      for (let i = 0; i < 200; i++) {
        ready = await evaluate(`location.href === ${JSON.stringify(url)} && document.documentElement.dataset.ready`);
        if (ready) break;
        await delay(100);
      }
      if (!ready) throw new Error(`Prototype timeout: ${name}`);
      const report = JSON.parse(await evaluate("document.querySelector('#metrics').textContent"));
      if (report.error) throw new Error(report.error);
      if (report.id !== name) throw new Error(`Wrong document returned for ${name}`);
      if (first && JSON.stringify(report.bounds) !== JSON.stringify(first.bounds)) throw new Error(`Unstable layout: ${name}`);
      first ??= report;
      await evaluate("Promise.all(Array.from(document.images, img => img.decode())).then(() => true)");
      const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(root, name, `${mode}-${width}.png`), Buffer.from(screenshot.data, "base64"));
    }
    first.stableAcrossLoads = true;
    await writeFile(join(root, name, `metrics-${width}.json`), JSON.stringify(first, null, 2));
    const { metrics, bounds, ...summary } = first;
    console.log(JSON.stringify(summary));
  }
} finally {
  socket?.close(); chrome.kill();
}
