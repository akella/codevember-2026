// node tools/shot.mjs <out.png> [size] [seconds to wait]: renders the page headless with real WebGPU, no flags.
// Env SET='{"shape":{...},"light":{...},"render":{...},"dive":{...}}' changes settings,
// CAM="x,y,z,tx,ty,tz" stops the dive and places the camera, AT=<0..1> holds the dive at that point in the loop.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [out = "shot.png", size = "900", wait = "3"] = process.argv.slice(2);
const url = process.env.URL ?? "http://localhost:5308/fractal.html";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h ?? w }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 400)));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 400));
});
await page.goto(url);
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 }).catch(() => bad.push("never started"));
if (process.env.SET)
  await page.evaluate((s) => {
    const t = window.__tess;
    const v = JSON.parse(s);
    for (const k of Object.keys(v)) Object.assign(t[k], v[k]);
    t.refresh();
  }, process.env.SET);
const cam = process.env.CAM?.split(",").map(Number);
if (cam)
  await page.evaluate((c) => {
    const t = window.__tess;
    if (!t.takeOver) {
      // the rolling page: orbit controls from the start
      t.camera.position.set(c[0], c[1], c[2]);
      t.controls.target.set(c[3], c[4], c[5]);
      t.controls.update();
      t.refresh();
      return;
    }
    t.takeOver();
    t.camera.up.set(0, 1, 0);
    t.controls.dispose();
    t.camera.position.set(c[0], c[1], c[2]);
    t.camera.lookAt(c[3], c[4], c[5]);
    t.dive.on = false;
    t.refresh();
  }, cam);
if (process.env.AT)
  await page.evaluate((at) => {
    // ssam's own playhead keeps running, so pin the dive by pausing with the keyboard shortcut is not
    // available headless; instead freeze the playhead the dive reads
    window.__tess.hold = +at;
    window.__tess.refresh();
  }, process.env.AT);
await new Promise((r) => setTimeout(r, +wait * 1000));
await page.addStyleTag({ content: ".lil-gui,canvas+div,body>div:not(:has(canvas)){display:none!important}" });
const info = await page.evaluate(
  () =>
    new Promise((r) => {
      let n = 0;
      const f0 = window.__tess.frame;
      const t0 = performance.now();
      const f = () => {
        if (++n < 30) requestAnimationFrame(f);
        else r({ fps: (window.__tess.frame - f0) / ((performance.now() - t0) / 1000), frame: window.__tess.frame });
      };
      requestAnimationFrame(f);
    }),
);
fs.writeFileSync(out, await page.screenshot({ timeout: 60000 }));
console.log(`fps ${info.fps.toFixed(1)} after ${info.frame} frames`, bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
