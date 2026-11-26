// node tools/perf.mjs [WxH]: how long a frame takes the card, by parts (waits on onSubmittedWorkDone). SET='{"light":"classic"}' changes look values; ONLY='all' runs only those; BENCH=1 times whole frames back to back instead.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = (process.argv[2] ?? "1100x1100").split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(process.env.DPR ?? 2) });
await page.goto(process.env.URL ?? "http://localhost:5420/");
await page.waitForFunction(() => window.__cocoon?.state.frame > 2, null, { timeout: 60000 });
const all = { shells: true, wound: true, fuzz: true, floss: true, thread: true, ...(process.env.DOWN ? { down: true } : {}) };
const every = [["all", {}], ["no lens", { lens: 0 }], ["nothing", Object.fromEntries(Object.keys(all).map((k) => [k, false]))], ...Object.keys(all).map((k) => ["without " + k, { [k]: false }])];
// ONLY='all,no lens': just those
const runs = process.env.ONLY ? every.filter(([n]) => process.env.ONLY.split(",").includes(n)) : every;
for (const at of [undefined, [15, 5, 5, [0.2, 0.6, 0.3]]]) {
  console.log(at ? "near" : "far");
  for (const [name, set] of runs) {
    const ms = await page.evaluate(
      async ([set, all, at, more, bench]) => {
        const r = window.__cocoon;
        Object.assign(r.look, all, { lens: 0.12 }, more, set);
        if (at) r.home(...at);
        const frames = async (n) => {
          const f0 = r.state.frame;
          while (r.state.frame < f0 + n) await new Promise(requestAnimationFrame);
          await r.device.queue.onSubmittedWorkDone();
        };
        await frames(3);
        if (bench) {
          // frames back to back: the card never idles, so it doesn't slow its clock (which it does under the 60 fps cap)
          r.bench(8, 0.3);
          await r.device.queue.onSubmittedWorkDone();
          const t0 = performance.now();
          r.bench(40, 0.3);
          await r.device.queue.onSubmittedWorkDone();
          return `${((performance.now() - t0) / 40).toFixed(2)} ms a frame`;
        }
        const got = [];
        r.state.time = (t) => got.push(t);
        while (got.length < 8) {
          await new Promise(requestAnimationFrame);
          await r.device.queue.onSubmittedWorkDone();
        }
        r.state.time = undefined;
        const mid = (k) => got.map((g) => g[k]).sort((a, b) => a - b)[got.length >> 1].toFixed(1);
        return Object.keys(got[0]).map((k) => `${k} ${mid(k)}`).join(" ");
      },
      [set, all, at, JSON.parse(process.env.SET ?? "{}"), !!process.env.BENCH],
    );
    console.log(`  ${name.padEnd(16)} ${ms}`);
  }
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
