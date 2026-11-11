// node tools/loopcheck.mjs [page.html] [fps]: steps the shapes page's simulation frame by frame through a
// whole loop and reports the biggest per-frame move and turn, where they happen, the steps around the
// loop point, and how far the state drifts after one loop. Stills can't show a flip; this can.
// Env SET='{"choreo":{...}}' merges into the page's objects first.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [file = "shapes.html", fps = "60"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
await page.goto(`http://localhost:5307/${file}`);
await page.waitForFunction(() => window.__shapes || window.__swarm);
const r = await page.evaluate(async ([fps, set]) => {
  const S = window.__shapes ?? window.__swarm;
  for (const [k, v] of Object.entries(JSON.parse(set))) Object.assign(S[k], v);
  S.rebuild();
  S.hold(0.5); // keeps the live clock off the flock
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const { flock } = S;
  const L = S.loopSeconds(), F = Math.round(L * fps);
  const n = flock.shapes.length;
  const snap = () => { const u = flock.u(flock.step); return { x: Float32Array.from(flock.x), q: flock.shapes.map((_, i) => S.facingOf(i, u)) }; };
  flock.reset(flock.shapes, -L); // a whole loop to settle
  flock.seek(0);
  const start = snap();
  let prev = start;
  const steps = [], turns = [];
  for (let f = 1; f <= F; f++) {
    flock.seek((f / F) * L);
    const now = snap();
    let m = 0, a = 0;
    for (let i = 0; i < n; i++) {
      m = Math.max(m, Math.hypot(now.x[i * 3] - prev.x[i * 3], now.x[i * 3 + 1] - prev.x[i * 3 + 1], now.x[i * 3 + 2] - prev.x[i * 3 + 2]));
      const d = Math.abs(now.q[i].reduce((s, v, k) => s + v * prev.q[i][k], 0));
      a = Math.max(a, 2 * Math.acos(Math.min(1, d)));
    }
    steps.push(m); turns.push(a); prev = now;
  }
  let drift = 0;
  for (let i = 0; i < n * 3; i++) drift = Math.max(drift, Math.abs(prev.x[i] - start.x[i]));
  const top = (arr) => arr.map((v, i) => [v, (i + 1) / F]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([v, u]) => `${v.toFixed(3)} at ${u.toFixed(3)}`);
  const around = [F - 3, F - 2, F - 1, 0, 1, 2].map((i) => `${steps[i].toFixed(4)}/${turns[i].toFixed(3)}`).join("  ");
  return { loop: `${L} s, ${F} frames`, drift, "move/turn around the loop point (the 4th crosses it)": around, "biggest moves": top(steps), "biggest turns (rad)": top(turns) };
}, [+fps, process.env.SET ?? "{}"]);
console.log(JSON.stringify(r, null, 1));
await browser.close();
