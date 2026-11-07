// node tools/triseams.mjs: everything discontinuous in the path (a stone wrapping round, the depth
// switch at a corner, the ball changing stones) happens exactly on a hop. So a tiny step of time
// across each hop should change no more than the same tiny step in mid air. Anything more is a pop.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
console.log(JSON.stringify(await page.evaluate(() => {
  const t = window.__triangle;
  const W = 1400, H = 900;
  const small = document.createElement("canvas");
  small.width = W; small.height = H;
  const c = small.getContext("2d", { willReadFrequently: true });
  const grab = (time) => { t.copy(time, c); return c.getImageData(0, 0, W, H).data.slice(); };
  const diff = (a, b) => { let s = 0, big = 0; for (let i = 0; i < a.length; i += 4) { const e = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); s += e; if (e > 24) big++; } return { mean: +(s / (a.length / 4)).toFixed(3), big }; };
  const hop = t.settings.seconds, e = 2e-4, turn = t.loop();
  const across = (at) => diff(grab((at - e + turn) % turn), grab((at + e) % turn));
  const hops = Array.from({ length: 9 }, (_, k) => across(k * hop));
  const air = [0.35, 0.5, 0.65].map((f) => across((3 + f) * hop));
  return { hops, air };
})));
await browser.close();
