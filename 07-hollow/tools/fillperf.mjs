// node tools/fillperf.mjs: ms a frame on fill.html once full (the hold), over rAF, for each style (STYLES), at DPR, with FLUID settings merged in
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const dpr = +(process.env.DPR ?? 2);
for (const style of (process.env.STYLES ?? "liquid,beads").split(",")) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: dpr });
  await page.goto("http://localhost:5307/fill.html?timing");
  await page.waitForFunction(() => window.__fill, null, { timeout: 60000 });
  const r = await page.evaluate(async ([style, extra]) => {
    const h = window.__fill; h.liquid.style = style; Object.assign(h.fluid, { hold: 6, ...extra }); h.restart();
    while (h.state().phase !== "hold") await new Promise((r) => setTimeout(r, 200));
    const t = performance.now(); let n = 0;
    while (performance.now() - t < 3000) { await new Promise((r) => requestAnimationFrame(r)); n++; }
    const probe = await h.probe();
    return { ms: ((performance.now() - t) / n).toFixed(1), gpu: h.state().gpu, count: h.state().count, sleeping: probe.sleeping, speed: probe.speed, crowd: probe.crowd, close: probe.closerThanRadius, y: probe.y };
  }, [style, JSON.parse(process.env.FLUID ?? "{}")]);
  console.log(`dpr ${dpr} ${style}: ${r.ms} ms (gpu: sim ${r.gpu.compute}, picture ${r.gpu.render}), ${r.count} particles, ${r.sleeping} asleep; speed ${r.speed}; crowd ${r.crowd}; closer than r ${r.close}; y ${r.y}`);
  await page.close();
}
await browser.close();
