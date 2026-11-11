// node tools/watch.mjs <page.html> <out.png> [seconds, comma separated] [size]: lets a live page run, and
// tiles screenshots taken at those seconds after it starts (for simulations, which can't be held); SET
// merges settings in (JSON, by object), CAM places the camera, PROBE reads the particles back, UNTIL starts the clock at a phase
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [file = "fill.html", out = "watch.png", list = "2,5,8,12", size = "500"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +size, height: +size }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 300)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) bad.push(m.text().replace(/\s+/g, " ").slice(0, 300)); });
await page.goto(`http://localhost:5307/${file}`);
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__fill, null, { timeout: 60000 });
if (process.env.SET) await page.evaluate((s) => { const h = window.__fill; for (const [k, v] of Object.entries(JSON.parse(s))) Object.assign(h[k], v); h.restart?.(); }, process.env.SET);
// CAM="x,y,z,tx,ty,tz": where the camera is, and what it looks at
if (process.env.CAM) await page.evaluate((c) => { const [x, y, z, a, b, d] = c.split(",").map(Number); const h = window.__fill; h.camera.position.set(x, y, z); h.controls.target.set(a, b, d); h.controls.update(); }, process.env.CAM);
// UNTIL=spill: the seconds count from when it reaches that phase
if (process.env.UNTIL) await page.waitForFunction((p) => window.__fill.state().phase === p, process.env.UNTIL, { timeout: 180000, polling: 100 });
const dir = fs.mkdtempSync(os.tmpdir() + "/watch-");
const t0 = Date.now();
const times = list.split(",").map(Number);
for (const [i, t] of times.entries()) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await page.locator("canvas").screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
  console.log(`${t}s:`, JSON.stringify(await page.evaluate(() => window.__fill.state())));
  // PROBE=1: where the particles are, too (read back from the GPU)
  if (process.env.PROBE) console.log("   ", JSON.stringify(await page.evaluate(() => window.__fill.probe())));
}
await browser.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `scale=${size}:-1,tile=${Math.min(times.length, 4)}x${Math.ceil(times.length / 4)}`, "-frames:v", "1", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
