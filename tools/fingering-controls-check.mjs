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
  const stableDigits = await evaluate("Object.fromEntries(Array.from(document.querySelectorAll('[data-fingering-note]'), n => [n.dataset.fingeringNote, [n.getAttribute('x'),n.getAttribute('y'),n.getAttribute('font-size')]]))");
  const postsBeforeSelection = await evaluate("window.fingeringLifecycle.posted.length");
  const anchor = await evaluate(`(() => { const s = document.querySelector('.overlay'), r = s.getBoundingClientRect();
    const a = JSON.parse(document.querySelector('#review-state').dataset.anchor);
    return {x: r.left + a[0] / s.viewBox.baseVal.width * r.width, y: r.top + a[1] / s.viewBox.baseVal.height * r.height}; })()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...anchor, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...anchor, button: "left", clickCount: 1 });
  await wait("Boolean(document.querySelector('#review-state').dataset.selected)");
  await evaluate("document.querySelector('[aria-label=\"Reset zoom to 100%\"]').click()");
  await new Promise(resolve => setTimeout(resolve, 150));
  await evaluate("document.querySelector('[aria-label=\"Fit page\"]').click()");
  await new Promise(resolve => setTimeout(resolve, 150));
  const afterSelection = await evaluate("Object.fromEntries(Array.from(document.querySelectorAll('[data-fingering-note]'), n => [n.dataset.fingeringNote, [n.getAttribute('x'),n.getAttribute('y'),n.getAttribute('font-size')]]))");
  for (const [id, positions] of Object.entries(afterSelection)) assert.deepEqual(positions, stableDigits[id]);
  assert.equal(await evaluate("window.fingeringLifecycle.posted.length"), postsBeforeSelection);
  const beforePinch = await evaluate("document.querySelector('.document-content').style.transform");
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 600, y: 900, id: 1 }, { x: 700, y: 900, id: 2 }] });
  await call("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 550, y: 900, id: 1 }, { x: 750, y: 900, id: 2 }] });
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(`document.querySelector('.document-content').style.transform !== ${JSON.stringify(beforePinch)}`);
  assert.equal(await evaluate("window.fingeringLifecycle.posted.length"), postsBeforeSelection);
  await call("Emulation.setTouchEmulationEnabled", { enabled: false });
  await evaluate("document.querySelector('[aria-label=\"Fit page\"]').click()");
  await new Promise(resolve => setTimeout(resolve, 150));
  const editSelect = "document.querySelector('section[aria-label=\"Selected note fingerings\"] select')";
  await wait(`${editSelect} && !${editSelect}.disabled`);
  const noteId = await evaluate(`${editSelect}.getAttribute('aria-label').replace('Finger for ', '')`);
  const originalFinger = await evaluate("document.querySelector('#review-state').dataset.finger");
  await evaluate(`(() => { const s = ${editSelect}; s.value = '5'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await wait("document.querySelector('#review-state').dataset.finger === '5' && document.querySelector('#review-state').dataset.source === 'user'");
  await evaluate("document.querySelector('#toggle-keyboard').click()");
  await wait("Array.from(document.querySelectorAll('.piano-key-fingering')).some(n => n.textContent.endsWith('5'))");
  const editorScreenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/fingering-editor-review.png", Buffer.from(editorScreenshot.data, "base64"));
  await evaluate("document.querySelector('section[aria-label=\"Selected note fingerings\"] input').click()");
  await wait(`Number(document.querySelector('#review-state').dataset.count) < ${count}`);
  assert.equal(await evaluate("document.querySelector('#review-state').dataset.finger"), "5");
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.piano-key-fingering')).some(n => n.textContent.endsWith('5'))"));
  await clickText("Undo finger edit");
  await wait(`Number(document.querySelector('#review-state').dataset.count) === ${count}`);
  await evaluate(`(() => { const s = ${editSelect}; s.value = ''; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await wait(`document.querySelector('#review-state').dataset.finger === ${JSON.stringify(originalFinger)} && document.querySelector('#review-state').dataset.source === 'prediction'`);
  await clickText("Undo finger edit");
  await wait("document.querySelector('#review-state').dataset.finger === '5'");
  await call("Page.reload");
  await wait(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent === '5'`);
  await evaluate("document.querySelector('#switch-document').click()");
  await wait(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent === ${JSON.stringify(originalFinger)}`);
  await evaluate("document.querySelector('#switch-document').click()");
  await wait(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent === '5'`);
  await evaluate("document.querySelector('#change-recognition').click()");
  await wait(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent === ${JSON.stringify(originalFinger)} && document.querySelector('#review-state').dataset.stale === '1'`);
  await clickText("Discard edits needing review");
  await wait("document.querySelector('#review-state').dataset.stale === '0'");
  await clickText("Undo finger edit");
  await wait("document.querySelector('#review-state').dataset.stale === '1'");
  assert.equal(await evaluate(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent`), originalFinger);
  await clickText("Discard edits needing review");
  await wait("document.querySelector('#review-state').dataset.stale === '0'");
  await evaluate("document.querySelector('#change-recognition').click()");
  await wait(`document.querySelector('[data-fingering-note="${noteId}"]')?.textContent === ${JSON.stringify(originalFinger)}`);
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/fingering-controls-review.png", Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ controls: "passed", placedStacks: count, afterExclusion: excludedCount,
    checks: ["document disable", "undo", "pointer rectangle", "document isolation", "reload persistence", "remove restores", "selection", "zoom stability", "emulated two-finger pinch", "value override", "keyboard agreement", "separate note hiding", "value reset/undo", "edit reopen/isolation", "changed recognition review/discard"] }));

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
