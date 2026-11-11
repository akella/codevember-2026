// node tools/cageperf.mjs [resolution] [moments, comma separated]: ms a frame, held at each moment; PAGE=cagemesh.html for the mesh one
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [detail = "2", list = "0.95,0.05,0.4"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:5307/${process.env.PAGE ?? "cage.html"}`);
await page.waitForFunction(() => window.__cage, null, { timeout: 60000 });
const out = [];
for (const at of list.split(",").map(Number)) {
  const ms = await page.evaluate(async ([detail, at]) => {
    Object.assign(window.__cage.look, { detail, resolution: detail, auto: false });
    window.__cage.hold(at);
    await new Promise((r) => setTimeout(r, 1200));
    const t = performance.now(); let n = 0;
    while (performance.now() - t < 2500) { await new Promise((r) => requestAnimationFrame(r)); n++; }
    return (performance.now() - t) / n;
  }, [+detail, at]);
  out.push(`${at}: ${ms.toFixed(1)} ms`);
}
console.log(`resolution ${detail} | ` + out.join(" | "));
await browser.close();
