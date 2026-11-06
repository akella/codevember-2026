// node sim/live-film.mjs <outDir>: the live knot and the baked knot at the same four moments of the loop
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [out, preset = "knot"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hide = "document.querySelector('.lil-gui')?.remove()";
for (const kind of ["live", "bake"]) {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(`http://localhost:5174/?bake=${kind === "live" ? "live-" + preset : preset}`);
  await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
  await page.evaluate(hide);
  for (const [n, phase] of [0.1, 0.35, 0.6, 0.85].entries()) {
    if (kind === "live") {
      await page.waitForFunction((p) => { const s = window.__live.sim; return Math.abs(s.clock / s.p.period - p) < 0.02; }, phase, { timeout: 20000, polling: 16 });
    } else await page.evaluate((p) => window.__stage.seek(p), phase);
    await wait(50);
    await page.screenshot({ path: `${out}/${kind}${n}.png` });
  }
  await page.close();
}
await browser.close();
