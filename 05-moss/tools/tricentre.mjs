// node tools/tricentre.mjs [frames=54]: where the figure's weight sits in a square frame, over a whole turn. A
// bounding box only knows the extremes, and a triangle has most of its weight towards one side, so this counts
// every pixel by how much it stands out from the backdrop. Numbers are pixels from the middle of a 1024 frame.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const samples = +(process.argv[2] ?? 54);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(m.text().slice(0, 300)); });
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
const result = await page.evaluate(async (samples) => {
  const T = window.__triangle;
  T.pause();
  const n = 512;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const x = c.getContext("2d", { willReadFrequently: true });
  const frames = [];
  for (let k = 0; k < samples; k++) {
    T.copy(T.loop() * ((k + 0.5) / samples), x);
    const p = x.getImageData(0, 0, n, n).data;
    const luma = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) luma[i] = p[i * 4] * 0.2126 + p[i * 4 + 1] * 0.7152 + p[i * 4 + 2] * 0.0722;
    frames.push(luma);
    if (k % 8 === 0) await new Promise(requestAnimationFrame);
  }
  // what never changes is the backdrop: everything moves off every pixel at some point
  const backdrop = new Float32Array(n * n).fill(1e9);
  for (const f of frames) for (let i = 0; i < n * n; i++) backdrop[i] = Math.min(backdrop[i], f[i]);
  let gx = 0, gy = 0, gw = 0;
  for (let i = 0; i < n * n; i++) { gx += (i % n) * backdrop[i]; gy += Math.floor(i / n) * backdrop[i]; gw += backdrop[i]; }
  const rows = frames.map((f) => {
    let area = 0, ax = 0, ay = 0, ink = 0, ix = 0, iy = 0;
    let [l, r, t, b] = [n, 0, n, 0];
    for (let i = 0; i < n * n; i++) {
      const e = f[i] - backdrop[i];
      if (e < 10) continue;
      const [px, py] = [i % n, Math.floor(i / n)];
      area++; ax += px; ay += py;
      ink += e; ix += px * e; iy += py * e;
      l = Math.min(l, px); r = Math.max(r, px); t = Math.min(t, py); b = Math.max(b, py);
    }
    return { area: [ax / area, ay / area], ink: [ix / ink, iy / ink], box: [(l + r) / 2, (t + b) / 2], edges: [l, n - 1 - r, t, n - 1 - b] };
  });
  return { rows, light: [gx / gw, gy / gw], n };
}, samples);
await browser.close();
const px = (v) => +((v - result.n / 2) * (1024 / result.n)).toFixed(1);
const mean = (key, a) => result.rows.reduce((s, r) => s + r[key][a], 0) / result.rows.length;
const swing = (key, a) => { const v = result.rows.map((r) => px(r[key][a])); return `${Math.min(...v)} to ${Math.max(...v)}`; };
for (const key of ["box", "area", "ink"]) console.log(key.padEnd(5), "x", String(px(mean(key, 0))).padStart(6), `(${swing(key, 0)})`, " y", String(px(mean(key, 1))).padStart(6), `(${swing(key, 1)})`);
console.log("light x", px(result.light[0]), " y", px(result.light[1]));
const e = [0, 1, 2, 3].map((k) => Math.min(...result.rows.map((r) => r.edges[k])) * (1024 / result.n));
console.log("tightest margins left, right, top, bottom:", e.join(", "));
