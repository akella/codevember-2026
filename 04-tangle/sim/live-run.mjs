// node sim/live-run.mjs <url> [seconds]: opens a page headless with real WebGPU and prints its console
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const url = process.argv[2];
const limit = Number(process.argv[3] ?? 120) * 1000;
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
let done;
const finished = new Promise((r) => (done = r));
page.on("console", (m) => { const t = m.text(); console.log(t); if (t.includes("DONE") || t.includes("FAILED")) done(); });
page.on("pageerror", (e) => { console.log("PAGE ERROR", e.message); done(); });
await page.goto(url);
await Promise.race([finished, new Promise((r) => setTimeout(r, limit))]);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
