// node tools/triball.mjs: the moss ball's strands are a sum over the ball's past, so they should move
// without a jump, come back exactly after a turn, and the ball should cross the split unseen.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(m.text().slice(0, 300)); });
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });
const result = await page.evaluate(() => {
  const T = window.__triangle;
  const loop = T.loop();
  const dt = 1 / 240;
  // where a tip is in the world, which is what must not jump: against the ball it jumps whenever the ball does
  const tip = (t) => { const at = T.ballAt(t).real; return T.strands(t).map((q) => q.map((v, k) => v + at[k])); };
  // how far a tip goes in one step, and how much that changes from one step to the next
  const moves = [[], [], []];
  let [a, b] = [tip(0), tip(dt)];
  for (let t = 2 * dt; t < 1.5 * 2; t += dt) {
    const c = tip(t);
    c.forEach((q, m) => moves[m].push({ t, step: Math.hypot(...q.map((v, k) => v - b[m][k])), kick: Math.hypot(...q.map((v, k) => v - 2 * b[m][k] + a[m][k])) }));
    [a, b] = [b, c];
  }
  const stat = (m) => {
    const steps = moves[m].map((s) => s.step);
    const kicks = moves[m].map((s) => s.kick);
    const sorted = [...steps].sort((x, y) => x - y);
    return { reach: +Math.max(...tipsOver(m)).toFixed(3), medianStep: +sorted[sorted.length >> 1].toFixed(5), biggestStep: +sorted.at(-1).toFixed(4), biggestKick: +Math.max(...kicks).toFixed(4) };
  };
  const tipsOver = (m) => { const out = []; for (let t = 0; t < 3; t += 0.02) out.push(Math.hypot(...T.strands(t)[m])); return out; };
  let closes = 0;
  for (let t = 0; t < loop; t += 0.137) tip(t).forEach((q, m) => q.forEach((v, k) => (closes = Math.max(closes, Math.abs(v - tip(t + loop)[m][k])))));
  // the same frame a whole turn later
  const c = document.createElement("canvas");
  c.width = 700; c.height = 450;
  const x = c.getContext("2d", { willReadFrequently: true });
  const grab = (t) => { T.copy(t, x); return x.getImageData(0, 0, 700, 450).data.slice(); };
  const diff = (p, q) => { let s = 0; for (let i = 0; i < p.length; i += 4) s += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); return +(s / (p.length / 4)).toFixed(4); };
  const one = grab(1.31);
  const floor = diff(one, grab(1.31));
  const turn = diff(one, grab(1.31 + loop));
  return { speeds: [stat(0), stat(1), stat(2)], tipsClose: +closes.toExponential(2), floor, turn };
});
console.log(JSON.stringify(result));
await browser.close();
