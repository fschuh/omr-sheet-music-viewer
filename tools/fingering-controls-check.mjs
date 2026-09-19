import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export async function checkControls(call, evaluate, traceEvents) {
  const wait = async condition => {
    for (let i = 0; i < 200; i++) {
      const error = await evaluate("document.documentElement.dataset.error");
      if (error) throw new Error(error);
      if (await evaluate(condition)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${condition}`);
  };
  const url = new URL("../webapp/tools/fingering-controls-review.html", import.meta.url).href;
  await call("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1800, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  await wait("Number(document.querySelector('#review-state')?.dataset.count) > 0");
  const count = await evaluate("Number(document.querySelector('#review-state').dataset.count)");
  assert.ok(count > 100);
  const initialPosts = await evaluate("window.fingeringLifecycle.posted.length");
  const clickText = async text => {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  };
  await evaluate("document.querySelector('details').open = true");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await wait("document.querySelector('#review-state').dataset.count === '0'");
  await clickText("Undo exclusion change");
  await wait(`Number(document.querySelector('#review-state').dataset.count) === ${count}`);
  await clickText("Draw exclusion on this page");
  await wait("Boolean(document.querySelector('.fingering-exclusions'))");
  await evaluate("document.querySelector('[aria-label=\"Fit page\"]').click()");
  await new Promise(resolve => setTimeout(resolve, 200));
  const coords = await evaluate(`(() => {
    const svg = document.querySelector('.overlay'), r = svg.getBoundingClientRect();
    const a = JSON.parse(document.querySelector('#review-state').dataset.anchor);
    const s = svg.viewBox.baseVal;
    return { x: r.left + a[0] / s.width * r.width, y: r.top + a[1] / s.height * r.height };
  })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x - 6, y: coords.y - 6, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x + 6, y: coords.y + 6, button: "left", buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x + 6, y: coords.y + 6, button: "left", clickCount: 1 });
  await wait("document.querySelector('#review-state').dataset.regions === '1'");
  const excludedCount = await evaluate("Number(document.querySelector('#review-state').dataset.count)");
  assert.ok(excludedCount < count, "Drawing must hide affected labels");
  await clickText("Finish drawing");
  assert.equal(await evaluate("window.fingeringLifecycle.posted.length"), initialPosts, "Policy edits must reuse placement and ink");
  await evaluate("document.querySelector('#switch-document').click()");
  await wait(`Number(document.querySelector('#review-state').dataset.count) === ${count}`);
  await evaluate("document.querySelector('#switch-document').click()");
  await wait(`Number(document.querySelector('#review-state').dataset.count) === ${excludedCount}`);
  await call("Page.reload");
  await wait(`Boolean(document.querySelector('#review-state')) && Number(document.querySelector('#review-state').dataset.count) === ${excludedCount}`);
  await evaluate("document.querySelector('details').open = true");
  await clickText("Remove region 1");
  await wait(`Number(document.querySelector('#review-state').dataset.count) === ${count}`);
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/fingering-controls-review.png", Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ controls: "passed", placedStacks: count, afterExclusion: excludedCount,
    checks: ["document disable", "undo", "pointer rectangle", "document isolation", "reload persistence", "remove restores"] }));

  await call("Page.navigate", { url: url + "?long" });
  await wait("JSON.parse(document.querySelector('#review-state')?.dataset.cached || '[]').length >= 2");
  await evaluate("window.fingeringLifecycle.longTasks = []");
  await call("Profiler.enable"); await call("Profiler.start");
  await call("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
  let maxCached = 0;
  for (let i = 0; i < 10; i++) {
    await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 650, y: 900, deltaX: 0, deltaY: 2500 });
    await new Promise(resolve => setTimeout(resolve, 250));
    const cached = await evaluate("JSON.parse(document.querySelector('#review-state').dataset.cached)");
    maxCached = Math.max(maxCached, cached.length);
    assert.ok(cached.length <= 3, "Layout cache must remain bounded");
  }
  const measurements = await evaluate(`({ ...window.fingeringLifecycle, cached: JSON.parse(document.querySelector('#review-state').dataset.cached),
    heapBytes: performance.memory?.usedJSHeapSize })`);
  const { profile } = await call("Profiler.stop");
  await call("Tracing.end"); await new Promise(resolve => setTimeout(resolve, 200));
  await writeFile("/tmp/fingering-scroll-trace.json", JSON.stringify(traceEvents));
  await writeFile("/tmp/fingering-scroll.cpuprofile", JSON.stringify(profile));
  assert.ok(Math.max(...measurements.posted) > 10, "Scrolling must prioritize later visible pages");
  assert.ok(!measurements.cached.includes(0), "Off-screen first page must be evicted");
  assert.deepEqual(measurements.longTasks, [], "Scrolling must not introduce main-thread tasks over 50 ms");
  console.log(JSON.stringify({ lifecycle: "passed", syntheticRepeatedPages: 20, maxCached, ...measurements }));
  await call("Page.navigate", { url: url + "?long&nooverlay" });
  await wait("Boolean(document.querySelector('.document-page'))");
  await new Promise(resolve => setTimeout(resolve, 500));
  await evaluate("window.fingeringLifecycle.longTasks = []");
  for (let i = 0; i < 10; i++) {
    await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 650, y: 900, deltaX: 0, deltaY: 2500 });
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.log(JSON.stringify({ baseline: "overlay-off", ...await evaluate("window.fingeringLifecycle") }));
}
