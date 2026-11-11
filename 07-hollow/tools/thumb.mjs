// node tools/thumb.mjs <out-dir> [levels=1.0,1.3,1.6] [size=1024]: close-ups of the liquid filling glass Venus
// for a thumbnail. Steps fill.html?record (each frame 1/60, as the recording), drawn as liquid, and when the
// settled level passes each height, saves a frame from each camera in CAMS ("x,y,z,tx,ty,tz;..."), at DPR
// (default 2) times the size.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const [outDir = "output/thumbs", list = "1.0,1.3,1.6", size = "1024"] = process.argv.slice(2);
const levels = list.split(",").map(Number);
const cams = (process.env.CAMS ?? "0.55,1.45,2.3,0,1.3,0;-0.9,1.2,2.1,0,1.25,0")
  .split(";")
  .map((c) => c.split(",").map(Number));
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: +size, height: +size },
  deviceScaleFactor: +(process.env.DPR ?? 2),
});
await page.goto(`http://localhost:5307/fill.html?record`);
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__fill, null, { timeout: 60000 });
await page.evaluate(() => {
  const h = window.__fill;
  h.useStatue("venus");
  h.liquid.style = "liquid";
  h.restart();
});
fs.mkdirSync(outDir, { recursive: true });
const place = (c) =>
  page.evaluate(([x, y, z, a, b, d]) => {
    const h = window.__fill;
    h.camera.position.set(x, y, z);
    h.controls.target.set(a, b, d);
    h.controls.update();
  }, c);
let next = 0;
// (with SETTLE, one level a run: the pour doesn't go on after it)
for (let f = 0; f < 60 * 30 && next < levels.length; f++) {
  await page.evaluate(() => window.__fill.step(1));
  const { level, phase } = await page.evaluate(() => window.__fill.state());
  if (level < levels[next] && phase === "pour") continue;
  // SETTLE=seconds: the pour stops there and the stream runs down into a clean surface first
  if (process.env.SETTLE) {
    await page.evaluate(() => window.__fill.stopPour());
    await page.evaluate((n) => window.__fill.step(n), Math.round(+process.env.SETTLE * 60));
  }
  // each camera in turn, the moment held (a frame drawn from each, the sim a frame on: barely moved)
  for (const [k, c] of cams.entries()) {
    await place(c);
    await page.evaluate(() => window.__fill.step(1));
    await page.locator("canvas").screenshot({ path: `${outDir}/level${levels[next]}-cam${k}.png` });
  }
  console.log(`level ${level} at ${(f / 60).toFixed(1)} s`);
  next++;
}
await browser.close();
