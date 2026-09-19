import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export async function checkControls(call, evaluate) {
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
  await wait("Boolean(document.querySelector('#review-state'))");
  const count = await evaluate("Number(document.querySelector('#review-state').dataset.count)");
  assert.ok(count > 100);
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
}
