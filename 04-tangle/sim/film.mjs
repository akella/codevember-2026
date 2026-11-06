// node film.mjs <url> <dir> <frames> [size]: steps through one loop and writes numbered PNGs
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [url, dir, n = "180", size = "720"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +size, height: +size } });
await page.goto(url);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
for (let i = 0; i < +n; i++) {
  await page.evaluate(async (p) => { const s = window.__stage; s.pause(); await s.seek(p); }, i / +n);
  await page.screenshot({ path: `${dir}/f${String(i).padStart(4, "0")}.png` });
}
await browser.close();
