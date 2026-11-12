// node tools/rollmotion.mjs <prefix> [size] [frames] : steps the rolling page's loop by one 60 fps frame per
// rendered frame from AT seconds, shoots the last moving frame, then holds and shoots it converged.
// EVERY=k also saves every k-th moving frame (prefix_0000.png ...). SET as in shot.mjs.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [prefix = "roll", size = "1280x800", frames = "60"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h ?? w }, deviceScaleFactor: +(process.env.DPR ?? 1) });
page.on("pageerror", (e) => console.log("error", e.message));
const seen = new Set();
page.on("console", (m) => { const t = m.text().slice(0, 300); if (m.type() === "error" && !seen.has(t)) { seen.add(t); console.log("console", t); } });
await page.goto(process.env.URL ?? "http://localhost:5308/");
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,body>div:not(:has(canvas)){display:none!important}" });
await page.evaluate((s) => {
  const t = window.__tess;
  const v = JSON.parse(s);
  for (const k of Object.keys(v)) Object.assign(t[k], v[k]);
  t.refresh();
}, process.env.SET ?? "{}");
const start = +(process.env.AT ?? 0);
const every = +(process.env.EVERY ?? 0);
const next = (time) =>
  page.evaluate((time) => {
    const t = window.__tess;
    t.hold = time;
    const f = t.frame;
    return new Promise((r) => { const w = () => (t.frame > f ? r() : requestAnimationFrame(w)); requestAnimationFrame(w); });
  }, time);
// warm up converged at the start, as the page would be after a rest
await next(start);
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < +frames; i++) {
  await next(start + i / 60);
  if (every && i % every === 0) fs.writeFileSync(`${prefix}_${String(i).padStart(4, "0")}.png`, await page.screenshot());
}
fs.writeFileSync(`${prefix}_moving.png`, await page.screenshot());
await new Promise((r) => setTimeout(r, 6000));
fs.writeFileSync(`${prefix}_still.png`, await page.screenshot());
await browser.close();
