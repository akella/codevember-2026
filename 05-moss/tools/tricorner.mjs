// node tools/tricorner.mjs <dir> [x,y,w,h] [hops]: a close look at one place through a hop, as a contact sheet of PNGs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const [dir, box = "370,120,380,360", first = "4"] = process.argv.slice(2);
const [x, y, width, height] = box.split(",").map(Number);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
await page.addStyleTag({ content: ".lil-gui,#other{display:none!important}" });
for (const [i, h] of [0, 0.15, 0.3, 0.42, 0.5, 0.58, 0.7, 0.85, 0.95].entries()) {
  await page.evaluate(async (t) => { await window.__triangle.at(t); await new Promise(requestAnimationFrame); await window.__triangle.at(t); }, (+first + h) * 1.5);
  await page.screenshot({ path: `${dir}/c${i}.png`, clip: { x, y, width, height } });
}
await browser.close();
