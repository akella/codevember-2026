// node tools/tripops.mjs [steps]: walks a whole turn in small even steps and reports the biggest jump
// between neighbouring frames, and how far the last frame is from the first. A pop shows up as an outlier.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const steps = +(process.argv[2] ?? 540);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 450 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
const result = await page.evaluate(async (steps) => {
  const t = window.__triangle;
  const small = document.createElement("canvas");
  small.width = 350; small.height = 225;
  const c = small.getContext("2d", { willReadFrequently: true });
  const grab = (time) => { t.copy(time, c); return c.getImageData(0, 0, 350, 225).data.slice(); };
  const diff = (a, b) => { let s = 0, worst = 0; for (let i = 0; i < a.length; i += 4) { const e = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); s += e; if (e > worst) worst = e; } return { mean: s / (a.length / 4), worst }; };
  const out = [];
  const first = grab(0);
  const again = diff(first, grab(0));
  let prev = first;
  for (let i = 1; i <= steps; i++) {
    const now = grab((i / steps) * t.loop());
    out.push({ i, ...diff(prev, now) });
    prev = now;
  }
  const end = diff(prev, first);
  return { out, end, again };
}, steps);
const means = result.out.map((o) => o.mean).sort((a, b) => a - b);
const median = means[means.length >> 1];
const top = [...result.out].sort((a, b) => b.mean - a.mean).slice(0, 6).map((o) => `${o.i}:${o.mean.toFixed(2)}`);
console.log(JSON.stringify({ median: +median.toFixed(2), max: +means.at(-1).toFixed(2), top, closes: result.end, sameFrameTwice: result.again }));
await browser.close();
