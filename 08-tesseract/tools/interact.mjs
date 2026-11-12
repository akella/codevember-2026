// Clicks to stop the dive, drags, then scrolls in through many levels and out again, shooting as it goes.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [prefix = "interact"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const seen = new Set();
page.on("pageerror", (e) => console.log("error", e.message));
page.on("console", (m) => { const t = m.text().slice(0, 300); if (m.type() === "error" && !t.includes("404") && !seen.has(t)) { seen.add(t); console.log("console", t); } });
await page.goto(process.env.URL ?? "http://localhost:5308/fractal.html");
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,body>div:not(:has(canvas)){display:none!important}" });
await new Promise((r) => setTimeout(r, 1500));
const state = () => page.evaluate(() => { const t = window.__tess; const p = t.camera.position; return { dive: t.dive.on, eye: [p.x, p.y, p.z].map((v) => +v.toFixed(3)) }; });
await page.mouse.move(300, 300);
await page.mouse.down();
await page.mouse.move(380, 330, { steps: 10 });
await page.mouse.up();
console.log("after drag", await state());
for (let k = 0; k < 6; k++) {
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 1500));
  console.log("zoom in", k, await state());
  fs.writeFileSync(`${prefix}_${k}.png`, await page.screenshot());
}
await browser.close();
