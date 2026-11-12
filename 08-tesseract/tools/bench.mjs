// node tools/bench.mjs [size] : GPU ms per frame for a few settings, at the dive's AT (default 0.3)
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [size = "1280x800"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(process.env.DPR ?? 1) });
page.on("pageerror", (e) => console.log("error", e.message));
await page.goto(process.env.URL ?? "http://localhost:5308/fractal.html");
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
await page.evaluate(() => {
  const t = window.__tess;
  t.defaults = JSON.parse(JSON.stringify({ shape: t.shape, light: t.light, render: t.render, dive: t.dive }));
});
const cases = JSON.parse(process.env.CASES ?? '[{}]');
for (const c of cases) {
  const ms = await page.evaluate(async (c) => {
    const t = window.__tess;
    t.hold = +(c.at ?? 0.3);
    for (const k of ["shape", "light", "render", "dive"]) Object.assign(t[k], t.defaults[k], c[k] ?? {});
    t.refresh();
    await new Promise((r) => setTimeout(r, 300));
    return t.bench(20);
  }, c);
  console.log(`${ms.toFixed(1)} ms`, JSON.stringify(c));
}
await browser.close();
