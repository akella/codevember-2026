// node tools/vperf.mjs [width=1600] [height=1000] [dpr=2] [seconds=8]: where a frame of the volvox page goes.
// Lets it play for a while, then for a few spells says how long a frame took, and how much of that was the
// physics and the painter's own arithmetic (the rest is the GPU, or waiting for it). Then draws it with one
// kind of thing left out at a time.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [w = "1600", h = "1000", dpr = "2", secs = "8"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on("pageerror", (e) => console.log("error", e.message.slice(0, 300)));
await page.goto(process.env.URL ?? "http://localhost:5309/");
await page.waitForFunction(() => window.__volvox, null, { timeout: 60000 });
if (process.env.SET)
  await page.evaluate((s) => {
    const c = window.__volvox,
      v = JSON.parse(s);
    for (const k of Object.keys(v)) Object.assign(c[k], v[k]);
    if (v.V) c.restart();
    c.refresh();
  }, process.env.SET);
await page.waitForTimeout(+secs * 1000);
await page.evaluate(() => {
  const c = window.__volvox,
    p = c.painter;
  const plain = p.update.bind(p);
  window.__paint = { ms: 0, n: 0 };
  p.update = (...a) => {
    const t0 = performance.now();
    plain(...a);
    window.__paint.ms += performance.now() - t0;
    window.__paint.n++;
  };
});
const spell = (hide) =>
  page.evaluate(
    (hide) =>
      new Promise((done) => {
        const c = window.__volvox;
        // (the reflection may be a scene of its own, `below`)
        const meshes = [...c.painter.scene.children, ...(c.painter.below?.children ?? [])];
        const kinds = meshes.map((m) => (m.geometry.isInstancedBufferGeometry ? "cells" : m.geometry.getAttribute("aC") ? "jelly" : "floor"));
        const mirrored = meshes.map((m) =>
          c.painter.below?.children.includes(m) || m.material.side === 1 || (m.geometry.isInstancedBufferGeometry && m.geometry.instanceCount < c.painter.cellCount + c.painter.speckCount) ? 1 : 0,
        );
        meshes.forEach((m, i) => (m.visible = !(hide === kinds[i] || (hide === "mirrors" && mirrored[i]) || hide === "all")));
        window.__paint.ms = 0;
        window.__paint.n = 0;
        let n = 0,
          t0 = 0;
        const tick = () => {
          if (n === 10) t0 = performance.now();
          if (++n === 70) {
            meshes.forEach((m) => (m.visible = true));
            done({ frame: (performance.now() - t0) / 59, paint: window.__paint.ms / Math.max(1, window.__paint.n), physics: c.state.ms, counts: c.painter.counts });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    hide,
  );
console.log(`${w}x${h} at ${dpr}: ${+w * +dpr}x${+h * +dpr} pixels`);
for (let k = 0; k < 3; k++) {
  const r = await spell("");
  console.log(
    `  frame ${r.frame.toFixed(1)} ms (${(1000 / r.frame).toFixed(0)} fps)  physics ${r.physics.toFixed(1)}  painter's arithmetic ${r.paint.toFixed(1)}  the rest ${(r.frame - r.physics - r.paint).toFixed(1)}  ${JSON.stringify(r.counts)}`,
  );
}
for (const hide of ["cells", "jelly", "mirrors", "floor", "all"]) {
  const r = await spell(hide);
  console.log(`  without ${hide.padEnd(8)} ${r.frame.toFixed(1)} ms`);
}
await browser.close();
