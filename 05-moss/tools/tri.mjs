// node tools/tri.mjs <out.png|dir> [--at seconds | --frames n] [--dpr 1] [--size 1400x900]
// One frame of the triangle, or n frames spread over a whole turn, with the gpu log and a frame time.
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
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(m.text().slice(0, 900)); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`http://localhost:${opt("port", 5275)}/`);
await page.waitForFunction(() => window.__triangle || document.querySelector("#loading")?.textContent !== "growing", null, { timeout: 120000 });
await page.addStyleTag({ content: ".lil-gui,#other{display:none!important}" });
const frames = +opt("frames", 0);
if (frames) {
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0; i < frames; i++) {
    await page.evaluate(async ([i, n]) => { const t = window.__triangle; await t.at((i / n) * t.loop()); }, [i, frames]);
    await page.screenshot({ path: `${out}/t${String(i).padStart(3, "0")}.png` });
  }
} else {
  const result = await page.evaluate(async (at) => {
    const t = window.__triangle;
    if (!t) return "no piece: " + document.querySelector("#loading")?.textContent;
    await t.at(at);
    const ms = await t.time(10);
    await t.at(at);
    return { ms: +ms.toFixed(2), ...(await t.counts()) };
  }, +opt("at", 5.3));
  console.log(JSON.stringify(result));
  await page.screenshot({ path: out });
}
await browser.close();
