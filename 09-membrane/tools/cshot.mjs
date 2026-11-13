// node tools/fshot.mjs <out.png> [periods=1.5,2,...] [width=1280] [height=720]: the crowd held at those
// moments (in periods from the start; whole numbers are where a period starts), tiled.
// SET='{"C":{},"look":{},"lens":{}}' changes settings (C ones start over), DPR, URL, COLS,
// PERF=seconds lets it run and times the frames.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const [out = "shot.png", list = "1.5", w = "1280", h = "720"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 900)));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 900));
});
await page.goto(process.env.URL ?? "http://localhost:5309/crowd.html");
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__crowd, null, { timeout: 60000 }).catch(() => bad.push("never started"));
await page.evaluate((s) => {
  const c = window.__crowd;
  c.state.hold = true;
  if (!s) return;
  const v = JSON.parse(s);
  for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
  if (v.C) c.restart();
  if (v.lens) c.compose();
  c.refresh();
}, process.env.SET ?? "");
await new Promise((r) => setTimeout(r, 800));
const dir = fs.mkdtempSync(os.tmpdir() + "/crowd-");
const times = list.split(",").map(Number);
for (const [i, t] of times.entries()) {
  // in slices, so the page is never busy for long
  let ms = 0;
  for (;;) {
    const left = await page.evaluate((t) => {
      const c = window.__crowd;
      const to = Math.round(t * c.sim.TS);
      if (to < c.sim.step) c.restart();
      const t0 = performance.now();
      const n = Math.min(600, to - c.sim.step);
      c.run(n);
      return [to - c.sim.step, n ? (performance.now() - t0) / n : 0];
    }, t);
    ms = left[1] || ms;
    if (left[0] <= 0) break;
  }
  await new Promise((r) => setTimeout(r, i === 0 ? +(process.env.WAIT ?? 1200) : +(process.env.EACH ?? 400)));
  await page.screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
  if (i === 0) console.log(`step ${ms.toFixed(2)} ms`, await page.evaluate(() => JSON.stringify(window.__crowd.painter.counts)));
}
if (process.env.PERF) {
  await page.evaluate(() => (window.__crowd.state.hold = false));
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
  console.log(`frame ${ms.toFixed(1)} ms, physics ${await page.evaluate(() => window.__crowd.state.ms.toFixed(2))} ms`);
}
await browser.close();
const cols = +(process.env.COLS ?? Math.min(times.length, 3));
if (times.length === 1) fs.copyFileSync(`${dir}/000.png`, out);
else execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `tile=${cols}x${Math.ceil(times.length / cols)}`, "-frames:v", "1", out]);
// KEEP=folder keeps the single frames too
if (process.env.KEEP) fs.cpSync(dir, process.env.KEEP, { recursive: true });
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
