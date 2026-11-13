// node tools/cboot.mjs [width=1600] [height=1000] [dpr=2] [seconds=12]: open the crowd as a visitor would and
// say what the first seconds cost: every task that held the page for long, and every late frame.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [w = "1600", h = "1000", dpr = "2", secs = "12"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
await page.addInitScript(() => {
  const log = (window.__boot = { tasks: [], gaps: [], marks: [] });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => log.tasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ["longtask"] });
  let last = performance.now();
  const tick = (t) => {
    if (t - last > 50) log.gaps.push([Math.round(last), Math.round(t - last)]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const poll = setInterval(() => {
    if (window.__crowd) {
      log.marks.push(["page ready", Math.round(performance.now())]);
      clearInterval(poll);
    }
  }, 5);
});
await page.goto(process.env.URL ?? "http://localhost:5309/crowd.html");
await new Promise((r) => setTimeout(r, +secs * 1000));
const log = await page.evaluate(() => window.__crowd.boot);
console.log("marks:", log.marks.map((m) => `${m[0]} at ${m[1]} ms`).join("; "));
console.log(
  "tasks over 50 ms:",
  log.tasks.length,
  "the first few (start:length):",
  log.tasks
    .slice(0, 12)
    .map((t) => `${t[0]}:${t[1]}`)
    .join("  "),
);
console.log("each second (frames/steps/ms physics/ms painter/ms handing over):", (log.seconds ?? []).map((x) => x.join("/")).join("  "));
console.log(
  "frames late by over 50 ms (start, gap):",
  log.gaps
    .slice(0, 14)
    .map((t) => `${t[0]}:${t[1]}`)
    .join("  "),
);
await browser.close();
