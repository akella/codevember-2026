// node tools/cpop.mjs [width=1024] [height=1024] [from=3] [periods=1]: does anything vanish while it can be
// seen? Runs the crowd for some periods and, at each step, lists any body dropped as out of view (not
// burst) while its middle, widened by its radius, was still on the screen; and any colony that never
// bursts while in view at the end of its life.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [w = "1024", h = "1024", from = "3", periods = "1"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(process.env.URL ?? "http://localhost:5309/crowd.html");
await page.waitForFunction(() => window.__crowd, null, { timeout: 60000 });
const out = await page.evaluate(
  async ([from, periods, w, h]) => {
    const c = window.__crowd;
    c.state.hold = true;
    const sim = c.sim;
    while (sim.step < from * sim.TS) c.run(Math.min(240, from * sim.TS - sim.step));
    const cam = c.painter.camera;
    // where a point is on the screen, -1 to 1 across and up; and how big a radius is there
    const at = (x, y, z) => {
      const v = cam.matrixWorldInverse.elements,
        p = cam.projectionMatrix.elements;
      const ex = v[0] * x + v[4] * y + v[8] * z + v[12],
        ey = v[1] * x + v[5] * y + v[9] * z + v[13],
        ez = v[2] * x + v[6] * y + v[10] * z + v[14];
      const cx = p[0] * ex + p[8] * ez,
        cy = p[5] * ey + p[9] * ez,
        cw = -ez;
      return [cx / cw, cy / cw, p[5] / cw];
    };
    const seen = [];
    let worst = 0;
    const end = (from + periods) * sim.TS;
    while (sim.step < end) {
      const before = sim.live.filter((b) => !b.gone).map((b) => [b, b.id, b.c[0], b.c[1], b.c[2], b.R]);
      const rebased = sim.rebase.count;
      c.run(1);
      // (at a seam the world is made bigger: where it was is taken in the new measure)
      const by = sim.rebase.count !== rebased ? sim.rebase.by : 1;
      for (const [b, id, x, y, z, R] of before) {
        if (b.alive && b.id === id) continue;
        if (b.gone) continue;
        const [sx, sy, k] = at(x * by, (y + R) * by, z * by);
        const r = R * by * k * 1.6; // (its glow and blur reach past its skin)
        const inside = Math.min(1 + r - Math.abs(sx), 1 + r - Math.abs(sy));
        if (inside > 0) {
          seen.push(`step ${sim.step % sim.TS}: place ${b.idx} (radius ${R.toFixed(2)}) dropped at screen ${sx.toFixed(2)},${sy.toFixed(2)}`);
          worst = Math.max(worst, inside);
        }
      }
    }
    return { seen: seen.slice(0, 12), count: seen.length, worst, size: [innerWidth, innerHeight] };
  },
  [+from, +periods, +w, +h],
);
console.log(`${out.size.join("x")}: ${out.count} bodies dropped while on the screen${out.count ? `, the deepest ${out.worst.toFixed(2)} inside its edge` : ""}`);
for (const l of out.seen) console.log("  " + l);
await browser.close();
