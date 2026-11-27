// node tools/bench.mjs [WxH] [moment]: GPU milliseconds a frame, the quickest of many goes
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [size = "1200x1600", at = "2.4"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(process.env.URL ?? "http://localhost:5321/");
await page.waitForFunction(() => window.__bolt?.state.frame > 5, null, { timeout: 60000 });
const sets = process.env.SETS ? JSON.parse(process.env.SETS) : [{}];
for (const set of [...sets, sets[0]]) {
  const ms = await page.evaluate(
    async ([set, at]) => {
      const b = window.__bolt;
      b.keep ??= { ...b.look };
      Object.assign(b.look, b.keep, { detail: 9 }, set);
      b.state.hold = at;
      // (four frames at a time, and the quickest few of those: something else may be using the GPU)
      const took = [];
      for (let k = 0; k < 40; k++) {
        await b.device.queue.onSubmittedWorkDone();
        const t = performance.now();
        for (let i = 0; i < 4; i++) b.render();
        await b.device.queue.onSubmittedWorkDone();
        took.push((performance.now() - t) / 4);
      }
      took.sort((x, y) => x - y);
      return (took[1] + took[2] + took[3]) / 3;
    },
    [set, +at],
  );
  console.log(JSON.stringify(set), ms.toFixed(2), "ms");
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
