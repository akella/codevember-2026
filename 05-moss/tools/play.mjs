// node tools/play.mjs <dir>: drives the page like a person, with the real frame loop running
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const [dir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 300)); });
await page.goto("http://localhost:5275/ring.html");
await page.waitForFunction(() => window.__moss, null, { timeout: 90000 });

const fps = (ms) => page.evaluate((ms) => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : done(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(f);
}), ms);
const state = () => page.evaluate(() => ({ eye: window.__moss.camera.position.toArray().map((v) => +v.toFixed(2)), target: window.__moss.controls.target.toArray().map((v) => +v.toFixed(2)), ms: +window.__moss.quality.ms.toFixed(1), ratio: window.__moss.quality.ratio, canvas: document.querySelector("canvas").width }));

console.log("fps early", await fps(3000), await state());
await page.screenshot({ path: `${dir}/1-early.png` });

// plant on bare stone, low on the left, and watch it take
const spot = await page.evaluate(() => { const m = window.__moss; for (const [x, y] of [[560, 640], [520, 560], [600, 690]]) { const h = m.pick(x, y); if (h && h.point[1] > -0.9) return [x, y]; } return null; });
console.log("planting at", spot, "autoRotate before", await page.evaluate(() => window.__moss.controls.autoRotate));
await page.mouse.click(spot[0], spot[1]);
console.log("hint gone", await page.evaluate(() => document.querySelector("#hint").classList.contains("gone")));
await page.waitForTimeout(6000);
await page.screenshot({ path: `${dir}/2-planted.png` });
console.log("fps mid", await fps(3000), await state());

// zoom in under the pointer
await page.mouse.move(760, 200);
for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
await page.waitForTimeout(1200);
console.log("zoomed", await state(), "fps", await fps(2000));
await page.screenshot({ path: `${dir}/3-zoom.png` });
for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(40); }
await page.waitForTimeout(2500);
console.log("back out", await state());

// a different form, twice quickly
await page.click("#forms button:nth-child(2)");
await page.click("#forms button:nth-child(3)");
await page.waitForTimeout(5000);
console.log("form now", await page.evaluate(() => [window.__moss.settings.form, document.querySelector("#forms .on")?.textContent]));
await page.screenshot({ path: `${dir}/4-form.png` });
console.log("errors", errors);
await browser.close();
