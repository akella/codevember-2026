// node tools/fperf.mjs [width=1600] [height=1000] [dpr=2] [from=2] : where a frame of the run goes. Lets it
// play through one period from `from` periods in, and for each twelfth says how long a frame took, and how
// much of that was the physics and the painter's own arithmetic (the rest is the GPU, or waiting for it).
// Then, held at the slowest of those moments, draws it with one kind of thing left out at a time.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [w = "1600", h = "1000", dpr = "2", from = "2"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on("pageerror", (e) => console.log("error", e.message.slice(0, 300)));
await page.goto(process.env.URL ?? "http://localhost:5309/crowd.html");
await page.waitForFunction(() => window.__crowd, null, { timeout: 60000 });
await page.evaluate((s) => {
  const c = window.__crowd;
  c.state.hold = true;
  if (s) {
    const v = JSON.parse(s);
    for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
    if (v.C) c.restart();
  }
}, process.env.SET ?? "");
for (;;) {
  const left = await page.evaluate((t) => {
    const c = window.__crowd;
    const to = Math.round(t * c.sim.TS);
    c.run(Math.min(600, to - c.sim.step));
    return to - c.sim.step;
  }, +from);
  if (left <= 0) break;
}
// time the painter's own work
await page.evaluate(() => {
  const c = window.__crowd,
    p = c.painter;
  const plain = p.update.bind(p);
  window.__paint = { ms: 0, n: 0 };
  p.update = (...a) => {
    const t0 = performance.now();
    plain(...a);
    window.__paint.ms += performance.now() - t0;
    window.__paint.n++;
  };
  c.state.hold = false;
});
console.log(`${w}x${h} at ${dpr}: ${+w * +dpr}x${+h * +dpr} pixels`);
let worst = { ms: 0, at: 0 };
for (let k = 0; k < 12; k++) {
  const r = await page.evaluate(
    () =>
      new Promise((done) => {
        const c = window.__crowd;
        window.__paint.ms = 0;
        window.__paint.n = 0;
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          if (++n === 60)
            done({
              frame: (performance.now() - t0) / 60,
              paint: window.__paint.ms / Math.max(1, window.__paint.n),
              physics: c.state.ms,
              at: c.sim.step / c.sim.TS,
              bodies: c.painter.counts.awake,
              flying: c.painter.counts.flying,
            });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(
    `  at ${r.at.toFixed(2)}  frame ${r.frame.toFixed(1)} ms (${(1000 / r.frame).toFixed(0)} fps)  physics ${r.physics.toFixed(1)}  painter's arithmetic ${r.paint.toFixed(1)}  the rest ${(r.frame - r.physics - r.paint).toFixed(1)}   ${r.bodies} awake, ${r.flying} cells in the air`,
  );
  if (r.frame > worst.ms) worst = { ms: r.frame, at: r.at };
}
// back to the slowest moment, held, and leave things out
await page.evaluate(() => (window.__crowd.state.hold = true));
for (;;) {
  const left = await page.evaluate((t) => {
    const c = window.__crowd;
    let to = Math.round(t * c.sim.TS);
    if (to < c.sim.step) to += c.sim.TS;
    c.run(Math.min(600, to - c.sim.step));
    return to - c.sim.step;
  }, worst.at - 0.04);
  if (left <= 0) break;
}
const timeIt = (hide) =>
  page.evaluate(
    (hide) =>
      new Promise((done) => {
        const c = window.__crowd;
        const meshes = c.painter.scene.children;
        // the order they were added in: walls; skins of the big, mirrored twice and plain; of the small, the same; cells x3; daughters x3
        const kinds = ["walls", "skin", "skin", "cells", "cells", "daughters", "daughters"];
        const mirrored = [0, 1, 0, 1, 0, 1, 0];
        meshes.forEach((m, i) => (m.visible = !(hide === kinds[i] || (hide === "mirrors" && mirrored[i]) || hide === "all")));
        let n = 0,
          t0 = 0;
        const tick = () => {
          if (n === 10) t0 = performance.now();
          if (++n === 50) {
            meshes.forEach((m) => (m.visible = true));
            done((performance.now() - t0) / 39);
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    hide,
  );
console.log(`held just before the slowest moment (${worst.at.toFixed(2)}):`);
for (const hide of ["nothing", "cells", "skin", "daughters", "mirrors", "walls", "all"]) console.log(`  without ${hide.padEnd(10)} ${(await timeIt(hide)).toFixed(1)} ms`);
await browser.close();
