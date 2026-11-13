// node tools/crecord.mjs [file] [url]: has the crowd page export its video in headless Chromium (settled first,
// then one period frame by frame) and saves it.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [file = "output/crowd-1024.mp4", url = "http://localhost:5309/crowd.html"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 300)));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 300));
});
await page.goto(url);
await page.waitForFunction(() => window.__crowd, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
const size = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    return `${r.width}x${r.height} on screen, ${c.width}x${c.height} buffer`;
  });
if (process.env.SET)
  await page.evaluate((v) => {
    const c = window.__crowd;
    for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
    if (v.C) c.restart();
  }, JSON.parse(process.env.SET));
await new Promise((r) => setTimeout(r, 500));
console.log("before", await size());
const started = Date.now();
const saved = page.waitForEvent("download", { timeout: 1800000 });
await page.evaluate(() => {
  window.__done = window.__crowd.record().catch((e) => console.error(String(e)));
});
const download = await saved;
fs.mkdirSync(file.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await download.saveAs(file);
await new Promise((r) => setTimeout(r, 800));
console.log("after", await size());
console.log(`saved in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "console clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
