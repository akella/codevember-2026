// node tools/phases.mjs <out.png> <page.html> [phases, comma separated, 0..1] [tile size] [columns]
// Holds each moment of the loop on a page that exposes window.__<name>.hold(t), and tiles them.
// Env SET='{"choreo":{...},"settings":{...}}' merges into those objects on the page first.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [out = "phases.png", file = "shapes.html", list = "0,0.125,0.25,0.375,0.5,0.625,0.75,0.875", size = "540", cols = "4"] = process.argv.slice(2);
const phases = list.split(",").map(Number);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +size, height: +size }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 400)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 400)); });
await page.goto(`http://localhost:5307/${file}`);
await page.waitForFunction(() => window.__shapes || window.__swarm || window.__cage || window.__paper || window.__smoke, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
if (process.env.SET) await page.evaluate((s) => {
  const h = window.__shapes ?? window.__swarm ?? window.__cage ?? window.__paper ?? window.__smoke;
  for (const [k, v] of Object.entries(JSON.parse(s))) Object.assign(h[k], v);
  h.rebuild?.();
  h.apply?.();
}, process.env.SET);
const dir = fs.mkdtempSync(os.tmpdir() + "/phases-");
const t0 = Date.now();
for (const [i, t] of phases.entries()) {
  await page.evaluate((t) => {
    (window.__shapes ?? window.__swarm ?? window.__cage ?? window.__paper ?? window.__smoke).hold(t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  }, t);
  await page.locator("canvas").screenshot({ path: `${dir}/${String(i).padStart(3, "0")}.png` });
}
await browser.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `scale=${size}:-1,tile=${cols}x${Math.ceil(phases.length / +cols)}`, "-frames:v", "1", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${phases.length} moments in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(bad.length ? bad.join("\n") : "clean");
