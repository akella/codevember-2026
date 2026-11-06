// node sim/live-tails.mjs <preset> [seconds]: how often a rope's cut end comes into the default shot
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [preset = "knot", seconds = "40"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto(`http://localhost:5174/?bake=live-${preset}`);
await page.waitForFunction(() => !document.querySelector("#loading") && window.__live, null, { timeout: 90000 });
const result = await page.evaluate(async (seconds) => {
  const { sim, camera } = window.__live;
  const columns = [213, 241, 300, 365];
  const seen = columns.map(() => 0), deepest = columns.map(() => 0), who = columns.map(() => new Set());
  let samples = 0;
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await new Promise((done) => setTimeout(done, 250));
    samples++;
    const state = await sim.read();
    for (const rope of sim.ropes) {
      columns.forEach((col, k) => {
        const at = camera.position.clone().set(...sim.columnIn(state, rope, col)).project(camera);
        const inside = 1 - Math.max(Math.abs(at.x), Math.abs(at.y));
        if (inside > 0) { seen[k]++; deepest[k] = Math.max(deepest[k], inside); who[k].add(rope.index); }
      });
    }
  }
  return columns.map((col, k) => `col ${col}: ${(100 * seen[k] / (samples * sim.ropes.length)).toFixed(1)}% of rope time, ${who[k].size} ropes, deepest ${(deepest[k] * 50).toFixed(0)}% of the way in`);
}, +seconds);
console.log(preset, "\n  " + result.join("\n  "));
await browser.close();
