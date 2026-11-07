// node tools/grow.mjs <dir> [form] [everySteps] [frames]: the same camera through a colony's life, as numbered PNGs
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const [dir, form = "ring", every = "400", frames = "9"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 450 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("console", (m) => { if (m.text().startsWith("gpu:")) console.log(m.text().slice(0, 400)); });
await page.goto(`http://localhost:5275/ring.html?form=${form}`);
await page.waitForFunction(() => window.__moss, null, { timeout: 90000 });
await page.addStyleTag({ content: ".lil-gui,#hint,#forms{display:none!important}" });
for (let i = 0; i < +frames; i++) {
  await page.evaluate(async (steps) => {
    const m = window.__moss;
    m.controls.autoRotate = false;
    m.pause();
    await m.advance(steps);
    await m.still();
  }, i ? +every : 1);
  await page.screenshot({ path: `${dir}/g${String(i).padStart(2, "0")}.png` });
}
await browser.close();
