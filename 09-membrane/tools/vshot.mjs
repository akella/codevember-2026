// node tools/vshot.mjs <out.png> [seconds=6,8,...] [width=1280] [height=720]: the volvox page held at those
// moments, tiled. SET='{"V":{},"look":{},"lens":{}}' changes settings (V ones start over), DPR, URL, COLS,
// PERF=seconds lets it run and times the frames, POKE=8:0 pokes colony 0 at 8 seconds.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const [out = "shot.png", list = "6", w = "1280", h = "720"] = process.argv.slice(2);
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
await page.goto(process.env.URL ?? "http://localhost:5309/");
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__volvox, null, { timeout: 60000 }).catch(() => bad.push("never started"));
await page.evaluate((s) => {
  const c = window.__volvox;
  c.state.hold = true;
  if (!s) return;
  const v = JSON.parse(s);
  for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
  if (v.V) c.restart();
  if (v.lens) c.compose();
  c.refresh();
}, process.env.SET ?? "");
// WATCH=0 keeps colony 0 in focus from the start
if (process.env.WATCH) await page.evaluate((w) => (window.__volvox.sim.hover = { body: window.__volvox.sim.tops[w], until: 1e12 }), +process.env.WATCH);
await new Promise((r) => setTimeout(r, 800));
const dir = fs.mkdtempSync(os.tmpdir() + "/volvox-");
const times = list.split(",").map(Number);
// POKE=8:0,12:3 pokes colony 0 at 8 seconds and colony 3 at 12, from where the camera is
const pokes = (process.env.POKE ?? "")
  .split(",")
  .filter(Boolean)
  .map((p) => p.split(":").map(Number));
for (const [i, t] of times.entries()) {
  const ms = await page.evaluate(
    ([t, pokes]) => {
      const c = window.__volvox;
      const to = Math.round(t * 120);
      if (to < c.sim.step) c.restart();
      const t0 = performance.now();
      const n = to - c.sim.step;
      // pokes due on the way are made at their moments
      for (const [at, which] of pokes) {
        const s = Math.round(at * 120);
        if (s >= c.sim.step && s <= to) {
          c.run(s - c.sim.step);
          c.pop(which);
        }
      }
      c.run(to - c.sim.step);
      return n ? (performance.now() - t0) / n : 0;
    },
    [t, pokes],
  );
  // the camera and the focus ease frame by frame: give them time to arrive
  await new Promise((r) => setTimeout(r, i === 0 ? +(process.env.WAIT ?? 2500) : +(process.env.EACH ?? 700)));
  await page.screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
  if (i === 0) console.log(`step ${ms.toFixed(2)} ms`, await page.evaluate(() => JSON.stringify(window.__volvox.painter.counts)));
}
if (process.env.PERF) {
  await page.evaluate(() => (window.__volvox.state.hold = false));
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
  console.log(`frame ${ms.toFixed(1)} ms, physics ${await page.evaluate(() => window.__volvox.state.ms.toFixed(2))} ms`);
}
await browser.close();
const cols = +(process.env.COLS ?? Math.min(times.length, 3));
if (times.length === 1) fs.copyFileSync(`${dir}/000.png`, out);
else execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `tile=${cols}x${Math.ceil(times.length / cols)}`, "-frames:v", "1", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
