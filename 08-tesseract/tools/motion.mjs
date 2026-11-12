// node tools/motion.mjs <prefix> : steps the dive by one 60 fps frame per rendered frame, then shoots,
// and shoots a converged still at the same moment for reference. Env SET as in shot.mjs.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [prefix = "motion", size = "800", frames = "90"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +size, height: +size } });
page.on("pageerror", (e) => console.log("error", e.message));
const seen = new Set();
page.on("console", (m) => { const t = m.text().slice(0, 300); if (m.type() === "error" && !seen.has(t)) { seen.add(t); console.log("console", t); } });
await page.goto(process.env.URL ?? "http://localhost:5308/fractal.html");
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,body>div:not(:has(canvas)){display:none!important}" });
const start = +(process.env.AT ?? 0.3);
await page.evaluate(
  async ({ s, start, frames }) => {
    const t = window.__tess;
    const v = JSON.parse(s);
    for (const k of ["shape", "light", "render", "dive"]) Object.assign(t[k], v[k] ?? {});
    t.hold = start;
    t.refresh();
    const step = 1 / 60 / 24; // one 60 fps frame of a 24 s loop
    for (let i = 0; i < frames; i++) {
      t.hold = start + i * step;
      const f = t.frame;
      await new Promise((r) => { const w = () => (t.frame > f ? r() : requestAnimationFrame(w)); requestAnimationFrame(w); });
    }
  },
  { s: process.env.SET ?? "{}", start, frames: +frames },
);
fs.writeFileSync(`${prefix}_moving.png`, await page.screenshot());
await new Promise((r) => setTimeout(r, 5000));
fs.writeFileSync(`${prefix}_still.png`, await page.screenshot());
await browser.close();
