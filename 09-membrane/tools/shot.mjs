// node tools/shot.mjs <out.png> [periods=2,2.1,...] [width=1280] [height=720]: the page held at those moments
// (in periods from the start; whole numbers are fusions), tiled. SET='{"P":{},"look":{},"lens":{}}' changes
// settings (P ones restart the cells), DPR, URL, COLS.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const [out = "shot.png", list = "2", w = "1280", h = "720"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 600)));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 600));
});
await page.goto(process.env.URL ?? "http://localhost:5309/cells.html");
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__cells, null, { timeout: 60000 }).catch(() => bad.push("never started"));
await page.waitForFunction(() => !window.__cells.state.warming, null, { timeout: 60000, polling: 100 });
await page.evaluate((s) => {
  const c = window.__cells;
  c.state.hold = true;
  if (!s) return;
  const v = JSON.parse(s);
  for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
  if (v.P) c.restart();
  c.refresh();
}, process.env.SET ?? "");
await page.waitForFunction(() => !window.__cells.state.warming, null, { timeout: 60000, polling: 100 });
await new Promise((r) => setTimeout(r, 1200));
if (process.env.PERF) {
  // let it run, and time the frames
  await page.evaluate(() => (window.__cells.state.hold = false));
  await new Promise((r) => setTimeout(r, +process.env.PERF * 1000));
  const ms = await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (++n === 120 ? done((performance.now() - t0) / 120) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  console.log(
    `frame ${ms.toFixed(1)} ms, physics ${await page.evaluate(() => window.__cells.state.ms.toFixed(2))} ms, at ${await page.evaluate(() => (window.__cells.sim.step / window.__cells.sim.TS).toFixed(2))}`,
    await page.evaluate(() => JSON.stringify(window.__cells.painter.counts)),
  );
  await page.evaluate(() => (window.__cells.state.hold = true));
}
const dir = fs.mkdtempSync(os.tmpdir() + "/cells-");
const times = list.split(",").map(Number);
for (const [i, t] of times.entries()) {
  const ms = await page.evaluate((t) => {
    const c = window.__cells;
    const to = Math.round(t * c.sim.TS);
    if (to < c.sim.step) c.restart();
    const t0 = performance.now();
    const n = to - c.sim.step;
    c.run(n);
    return n ? (performance.now() - t0) / n : 0;
  }, t);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
  if (i === 0) console.log(`step ${ms.toFixed(2)} ms`, await page.evaluate(() => JSON.stringify(window.__cells.painter.counts)));
}
await browser.close();
const cols = +(process.env.COLS ?? Math.min(times.length, 3));
if (times.length === 1) fs.copyFileSync(`${dir}/000.png`, out);
else execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `tile=${cols}x${Math.ceil(times.length / cols)}`, "-frames:v", "1", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
