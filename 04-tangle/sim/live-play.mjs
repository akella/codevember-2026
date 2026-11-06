// node sim/live-play.mjs <url> <outDir>: plays with the live page like a person would, and checks it holds up
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [url, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log("console error", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto(url);
await page.waitForFunction(() => !document.querySelector("#loading") && window.__live, null, { timeout: 90000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1000);

// the whole state, boiled down: anything broken shows here
const health = (label) => page.evaluate(async (label) => {
  const { sim, W } = window.__live;
  const s = await sim.read();
  let nan = 0, longest = 0, far = 0, fast = 0;
  const lengths = [];
  for (const rope of sim.ropes) {
    const top = Math.floor(sim.headNow(rope)) + 3;
    for (let i = W - 4 - sim.p.window; i < W - 4 - sim.p.lag; i++) {
      const j = top - 255 + i, g = sim.slot(rope, j) * 4, f = sim.slot(rope, j + 1) * 4;
      const l = Math.hypot(s[g] - s[f], s[g + 1] - s[f + 1], s[g + 2] - s[f + 2]);
      if (!Number.isFinite(l)) { nan++; continue; }
      const r = l / s[g + 3];
      lengths.push(r); longest = Math.max(longest, r);
      far = Math.max(far, Math.hypot(s[g + 1], s[g + 2]));
      const v = sim.nodes * 8 + g;
      fast = Math.max(fast, Math.hypot(s[v], s[v + 1], s[v + 2]));
    }
  }
  lengths.sort((a, b) => a - b);
  return `${label}: nan ${nan}, edge/laid median ${lengths[lengths.length >> 1].toFixed(3)} worst ${longest.toFixed(3)}, furthest from axis ${far.toFixed(2)}, fastest ${fast.toFixed(1)}`;
}, label);

// a free node on screen, from the positions the page itself would pick from
const spot = (near) => page.evaluate((near) => {
  const { sim, camera } = window.__live;
  const p = sim.positions;
  const box = document.querySelector("canvas").getBoundingClientRect();
  let best = null, score = Infinity;
  for (let g = 0; g < sim.nodes; g++) {
    if (!sim.isFree(g)) continue;
    const v = camera.position.clone().set(p[g * 4] - sim.scroll, p[g * 4 + 1], p[g * 4 + 2]).project(camera);
    const x = box.left + (v.x + 1) / 2 * box.width, y = box.top + (1 - v.y) / 2 * box.height;
    const d = Math.hypot(x - near[0], y - near[1]);
    if (d < score) { score = d; best = { x, y, g }; }
  }
  return best;
}, near);
const nodePos = (g) => page.evaluate(async (g) => { const { sim, camera } = window.__live; await sim.refreshPositions(); const p = sim.positions; const v = camera.position.clone().set(p[g * 4] - sim.scroll, p[g * 4 + 1], p[g * 4 + 2]).project(camera); return [(v.x + 1) * 400, (1 - v.y) * 400].map(Math.round); }, g);

const fps = () => page.evaluate(() => new Promise((done) => { let n = 0; const t = performance.now(); const f = () => { if (++n === 90) done(+(90000 / (performance.now() - t)).toFixed(1)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log("page fps", await fps());
console.log(await health("start"));
await page.screenshot({ path: `${out}/1_before.png` });

// 1. drags: a strand buried in the knot, then a loose one near the heads
for (const [name, from, by] of [["buried", [300, 420], [-130, -200]], ["loose", [360, 230], [-160, -110]]]) {
  const a = await spot(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const heldNode = await page.evaluate(() => window.__live.held());
  const to = { x: a.x + by[0], y: a.y + by[1] };
  for (let i = 1; i <= 30; i++) { await page.mouse.move(a.x + (to.x - a.x) * i / 30, a.y + (to.y - a.y) * i / 30); await wait(16); }
  await wait(500);
  const at = await nodePos(heldNode);
  console.log(`${name}: pressed ${Math.round(a.x)},${Math.round(a.y)} hand ${Math.round(to.x)},${Math.round(to.y)} rope ${at} -> ${Math.round(Math.hypot(at[0] - to.x, at[1] - to.y))} px short of a ${Math.round(Math.hypot(...by))} px drag, still held ${await page.evaluate(() => window.__live.held() >= 0)}`);
  await page.screenshot({ path: `${out}/2_${name}.png` });
  console.log(await health(name));
  await page.mouse.up();
  await wait(1500);
}
await page.screenshot({ path: `${out}/3_released.png` });

// 2. yank as hard and as far as a pointer can
const b = await spot([260, 480]);
await page.mouse.move(b.x, b.y);
await page.mouse.down();
console.log("yank held", await page.evaluate(() => window.__live.held()));
for (let i = 0; i < 90; i++) { await page.mouse.move(400 + 390 * Math.cos(i * 0.7), 400 + 390 * Math.sin(i * 1.1)); await wait(16); }
await page.screenshot({ path: `${out}/4_yank.png` });
console.log("still held", await page.evaluate(() => window.__live.held()));
console.log(await health("yanking"));
console.log("page fps during a yank", await fps());
await page.mouse.up();
await wait(2000);
console.log(await health("after yank"));

// 3. gravity, heads stopped
await page.evaluate(() => { window.__live.settings.gravity = 8; });
await wait(2500);
await page.screenshot({ path: `${out}/5_gravity.png` });
console.log(await health("gravity 8"));
await page.evaluate(() => { window.__live.settings.flow = 0; });
await wait(3000);
await page.screenshot({ path: `${out}/6_gravity_stopped.png` });
console.log(await health("gravity, heads stopped"));
await page.evaluate(() => { window.__live.settings.gravity = 0; window.__live.settings.flow = 1; });
await wait(4000);
await page.screenshot({ path: `${out}/7_recovered.png` });
console.log(await health("gravity off"));
await browser.close();
