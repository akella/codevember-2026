// node tools/shot.mjs <out.png> [--steps 2000] [--size 1400x900] [--eye x,y,z] [--target x,y,z] [--query form=orb] [--dpr 1] [--port 5275]
// Real WebGPU in headless Chromium, on the Mac's GPU. Prints the gpu log, the draw counts and a frame time.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const args = process.argv.slice(2);
const out = args.shift();
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const [w, h] = opt("size", "1400x900").split("x").map(Number);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +opt("dpr", 1) });
page.on("console", (m) => { if (m.type() !== "debug") console.log(m.type() + ":", m.text().slice(0, 1200)); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const query = opt("query", "");
await page.goto(`http://localhost:${opt("port", 5275)}/ring.html?${query}`);
await page.waitForFunction(() => window.__moss || document.querySelector("#loading")?.textContent !== "growing", null, { timeout: 90000 });
await page.addStyleTag({ content: ".lil-gui,#hint,#forms{display:none!important}" });
const result = await page.evaluate(
  async ({ steps, eye, target, focus }) => {
    const m = window.__moss;
    if (!m) return "no piece";
    m.pause();
    const t0 = performance.now();
    if (steps) await m.advance(steps);
    const grow = performance.now() - t0;
    if (eye) m.camera.position.set(...eye);
    if (target) m.controls.target.set(...target);
    await m.still(focus);
    const ms = await m.time(12);
    return { grow: Math.round(grow), ms: +ms.toFixed(2), ...(await m.counts()) };
  },
  {
    steps: +opt("steps", 0),
    eye: opt("eye") ? opt("eye").split(",").map(Number) : null,
    target: opt("target") ? opt("target").split(",").map(Number) : null,
    focus: opt("focus") ? +opt("focus") : undefined,
  },
);
console.log(JSON.stringify(result));
await page.screenshot({ path: out });
await browser.close();
