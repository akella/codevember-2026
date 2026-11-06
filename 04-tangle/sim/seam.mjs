// node seam.mjs <url>: mean pixel difference across the loop seam, against an ordinary one-frame step
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const url = process.argv[2];
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
console.log(await page.evaluate(async () => {
  const s = window.__stage;
  const diff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i += 4) t += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]); return +(t / ((a.length/4)*3)).toFixed(3); };
  const at = async (p) => (await s.pixelsAt(p, 512)).slice();
  const f = 1 / 360;
  const a = await at(1 - f), b = await at(0), c = await at(f), d = await at(0.5), e = await at(0.5 + f);
  const again = await at(0);
  return JSON.stringify({ acrossSeam: diff(a, b), justAfterSeam: diff(b, c), midLoopStep: diff(d, e), sameFrameTwice: diff(b, again) });
}));
await browser.close();
