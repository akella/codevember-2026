// node sim/live-record.mjs <out.mp4> [query] [size] [fps]: presses "record a loop" and saves what the page hands over
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [out, query = "", size = "720", fps = "60"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 }, acceptDownloads: true });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("404")) console.log(m.type(), m.text().slice(0, 300)); });
await page.goto(`http://localhost:5174/?${query}`);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
await page.evaluate(([size, fps]) => {
  for (const row of document.querySelectorAll(".lil-gui .controller")) {
    const name = row.querySelector(".name")?.textContent;
    const choice = row.querySelector("select");
    if (!choice) continue;
    const want = name === "size" ? size : name === "fps" ? fps : null;
    if (want === null) continue;
    choice.selectedIndex = [...choice.options].findIndex((o) => o.textContent === want);
    choice.dispatchEvent(new Event("change"));
  }
}, [size, fps]);
const started = Date.now();
const saved = page.waitForEvent("download", { timeout: 590000 });
await page.evaluate(() => [...document.querySelectorAll(".lil-gui button")].find((b) => b.textContent.includes("record a loop")).click());
const ticker = setInterval(async () => console.log(((Date.now() - started) / 1000).toFixed(0) + " s", await page.evaluate(() => document.querySelector("#loading p")?.textContent ?? "(no panel)").catch(() => "")), 15000);
const file = await saved;
clearInterval(ticker);
await file.saveAs(out);
console.log(`${file.suggestedFilename()} after ${((Date.now() - started) / 1000).toFixed(0)} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
await new Promise((r) => setTimeout(r, 1500));
console.log("back to live, canvas opacity", await page.evaluate(() => getComputedStyle(document.querySelector("#stage")).opacity), "panel", await page.evaluate(() => !!document.querySelector("#loading")));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
