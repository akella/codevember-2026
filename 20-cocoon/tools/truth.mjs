// node tools/truth.mjs <dir>: the page drawn from the test views' eyes under their lamps (bake/compare.py sets them beside Cycles).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "bake/data/page", size = "800x800"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const views = JSON.parse(fs.readFileSync(process.env.VIEWS ?? "bake/data/test/views.json", "utf8"));
const url = process.env.URL ?? "http://localhost:5420/";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({
  viewport: { width: w, height: h ?? w },
  deviceScaleFactor: +(process.env.DPR ?? 1),
});
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 1500)));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("cocoon:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404"))
    bad.push(t.replace(/[ \t]+/g, " ").slice(0, 1500));
});
const t0 = Date.now();
await page.goto(url);
await page
  .waitForFunction(
    () => window.__cocoon && window.__cocoon.state.frame > 2,
    null,
    { timeout: +(process.env.WAIT ?? 30000) },
  )
  .catch(() => {
    console.log("never started:\n" + [...new Set(bad)].join("\n"));
    process.exit(1);
  });
console.log(`started in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.addStyleTag({
  content:
    "#loader,.lil-gui,#stats,canvas+div,body>div:not(:has(canvas)){display:none!important}",
});
await page.evaluate((s) => {
  const r = window.__cocoon;
  if (!r || !s) return;
  const { lamps, ...look } = JSON.parse(s);
  Object.assign(r.look, look);
  for (const k in lamps ?? {}) Object.assign(r.lamps[k], lamps[k]);
 
 
}, process.env.SET);
if (process.env.EVAL)
  console.log(JSON.stringify(await page.evaluate(process.env.EVAL)));
for (const [i, v] of views.entries()) {
  if (v.which === 4) continue;
  await page.evaluate(
    (v) =>
      new Promise((done) => {
        const r = window.__cocoon;
        Object.assign(r.look, { motion: "still", bloom: 0, lens: 0, air: 0, exposure: 1, gamma: 1 });
        r.state.hold = 0;
        const lights = v.lights.map((dir) => ({ dir, colour: [0.5, 0.5, 0.5] }));
        // alone.html has three lamps, and shows one cocoon of its own
        r.state.exact = v.which === undefined ? lights : { which: v.which, lights: lights.slice(0, 3) };
        if (v.which !== undefined) r.look.thread = false;
        Object.assign(r.controls, { minDistance: 0, maxDistance: 1e3, minPolarAngle: 0, maxPolarAngle: Math.PI, enableDamping: false, enablePan: true });
        r.controls.minTargetRadius = 0;
        r.controls.maxTargetRadius = 1e3;
        r.camera.position.set(...v.eye);
        r.controls.target.set(...v.target);
        let n = 0;
        const f = () => (++n < 8 ? requestAnimationFrame(f) : done());
        requestAnimationFrame(f);
      }),
    v,
  );
  fs.writeFileSync(path.join(out, `${String(i).padStart(4, "0")}.png`), await page.screenshot({ timeout: 60000 }));
}
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
