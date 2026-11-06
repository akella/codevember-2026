// node sim/cover.mjs <dir> [seconds ...]: the page as it opens, at gallery size, once it has been running that long
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir, ...times] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const folder = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + folder).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${folder}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto("http://localhost:5174/");
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
const started = Date.now();
for (const t of times.map(Number)) {
  await new Promise((r) => setTimeout(r, Math.max(0, t * 1000 - (Date.now() - started))));
  await page.screenshot({ path: `${dir}/cover-${t}.jpg`, type: "jpeg", quality: 88, timeout: 20000 });
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
