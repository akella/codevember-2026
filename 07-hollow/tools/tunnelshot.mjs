// node tools/tunnelshot.mjs <out.png> [playheads=0,0.25,0.5,0.75] [width=900] [height=900]: the tunnel (index.html) held at
// those moments of the loop, tiled; SET merges settings in (JSON, by object: shape, cells, light, view);
// QUERY="?skip=shadow" adds to the address; PERF=1 also lets it run and prints the time between frames at DPR (default 1), auto resolution off
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [out = "tunnel.png", list = "0,0.25,0.5,0.75", w = "900", h = "900"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 400)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) bad.push(m.text().replace(/\s+/g, " ").slice(0, 400)); });
await page.goto(`http://localhost:5307/index.html${process.env.QUERY ?? ""}`);
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__tunnel, null, { timeout: 60000 });
await page.evaluate((s) => { const t = window.__tunnel; t.view.auto = false; t.view.detail = devicePixelRatio; if (s) for (const [k, v] of Object.entries(JSON.parse(s))) Object.assign(t[k], v); }, process.env.SET ?? "");
await page.waitForFunction(() => window.__tunnel.ready(), null, { timeout: 60000, polling: 200 });
await new Promise((r) => setTimeout(r, 600));
await page.waitForFunction(() => window.__tunnel.ready(), null, { timeout: 60000, polling: 200 });
console.log(await page.evaluate(() => window.__tunnel.cellCount()));
if (process.env.FLIP) { await page.evaluate(() => window.__tunnel.flip(true)); await new Promise((r) => setTimeout(r, 3000)); }
if (process.env.PERF) {
  await new Promise((r) => setTimeout(r, 4000));
  const ms = await page.evaluate(() => new Promise((done) => { let n = 0, t0 = performance.now(); const tick = () => (++n === 90 ? done((performance.now() - t0) / 90) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }));
  console.log(`frame ${ms.toFixed(1)} ms`);
}
const dir = fs.mkdtempSync(os.tmpdir() + "/tunnel-");
const times = list.split(",").map(Number);
for (const [i, t] of times.entries()) {
  await page.evaluate((t) => window.__tunnel.hold(t), t);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
}
await browser.close();
const cols = Math.min(times.length, 4);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `tile=${cols}x${Math.ceil(times.length / cols)}`, "-frames:v", "1", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
