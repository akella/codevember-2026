// node tools/tripanel.mjs <shot.png>: moves every slider of the triangle's panel to both ends, and says
// which ones changed nothing. Then checks that reset works and that settings survive a reload.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const [out] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 240)); });
await page.goto("http://localhost:5275/?panel");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
const result = await page.evaluate(async () => {
  const t = window.__triangle;
  const W = 700, H = 450;
  const small = document.createElement("canvas");
  small.width = W; small.height = H;
  const c = small.getContext("2d", { willReadFrequently: true });
  const at = 8.4;
  const grab = () => { t.copy(at, c); return c.getImageData(0, 0, W, H).data.slice(); };
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return +(s / (a.length / 4)).toFixed(2); };
  const rows = [...document.querySelectorAll(".lil-gui .controller.number")];
  t.changed();
  const start = grab();
  const floor = diff(start, grab());
  const keys = Object.keys(t.settings);
  const saved = { ...t.settings };
  const ranges = { height: [0.3, 2.5], tuft: [0.5, 2.5], tops: [0, 1], sides: [0, 1], sideHeight: [0.1, 1.2], density: [0.1, 1], arrive: [0.4, 3], life: [3, 8.6], rim: [0, 3], sway: [0, 1.5], gold: [0, 1], dark: [0, 1], fruit: [0, 6], dew: [0, 2.5], splay: [0, 2.5], wander: [0, 3], leaf: [0.4, 2.2], width: [0.4, 2.5], open: [0.3, 1.5], curl: [-0.6, 1], warmth: [-0.5, 0.5], saturation: [0, 2], brightness: [0.3, 2], glow: [0, 3], seconds: [0.8, 3], jump: [0.6, 3.5], blur: [0, 3], mossBall: [false, true], strand: [0.2, 1.3], strands: [0.2, 1], inertia: [0, 2], spring: [0.6, 3.5], damping: [0.1, 0.9], drag: [0, 2], across: [-0.5, 1.5], onLanding: [false, true], growth: [0.3, 3] };
  const effect = {};
  for (const key of keys) {
    const [lo, hi] = ranges[key];
    t.settings[key] = lo; t.changed();
    const a = diff(start, grab());
    t.settings[key] = hi; t.changed();
    const b = diff(start, grab());
    t.settings[key] = saved[key]; t.changed();
    effect[key] = Math.max(a, b);
  }
  const back = diff(start, grab());
  return { floor, controls: rows.length, keys: keys.length, effect, back };
});
const dead = Object.entries(result.effect).filter(([, v]) => v < 0.05).map(([k]) => k);
console.log(JSON.stringify({ floor: result.floor, sliders: result.controls, settings: result.keys, deadAtThisMoment: dead, backToStart: result.back }));
console.log("effects", Object.entries(result.effect).map(([k, v]) => `${k} ${v}`).join("  "));
// memory and reset, through the real controls
const persisted = await page.evaluate(() => { const t = window.__triangle; t.settings.height = 1.7; t.changed(); return t.settings.height; });
await page.reload();
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
const after = await page.evaluate(() => window.__triangle.settings.height);
await page.getByText("reset", { exact: true }).click();
const reset = await page.evaluate(() => window.__triangle.settings.height);
await page.evaluate(() => localStorage.clear());
console.log(JSON.stringify({ set: persisted, afterReload: after, afterReset: reset, errors }));
await page.evaluate(() => { for (const f of document.querySelectorAll(".lil-gui .title")) if (["leaves", "colour"].includes(f.textContent)) f.click(); });
await page.evaluate(() => window.__triangle.at(8.4));
await page.evaluate(() => new Promise(requestAnimationFrame));
await page.evaluate(() => window.__triangle.at(8.4));
await page.screenshot({ path: out });
await browser.close();
