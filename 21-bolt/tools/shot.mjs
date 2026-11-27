// node tools/shot.mjs <out.png> [WxH] [moments of the loop ...]: the page, headless with real WebGPU; several
// moments are tiled into one sheet. SET='{"sunHigh":12}' changes look values (ground and sky are remade as
// needed); DPR; COLS for the sheet; URL (the dev server is expected on 5321).
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "shot.png", size = "1280x720", ...shots] = process.argv.slice(2);
if (!shots.length) shots.push("0");
const url = process.env.URL ?? "http://localhost:5321/";
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
page.on("pageerror", (e) => bad.push(e.message.slice(0, 3000)));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("bolt:")) console.log(t);
  if (["error", "warning"].includes(m.type()) && !t.includes("404"))
    bad.push(t.replace(/[ \t]+/g, " ").slice(0, 3000));
});
const t0 = Date.now();
await page.goto(url);
await page
  .waitForFunction(
    () => window.__bolt && window.__bolt.state.frame > 2,
    null,
    { timeout: 90000 },
  )
  .catch(() => bad.push("never started"));
console.log(`started in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.addStyleTag({
  content: ".lil-gui,body>div{display:none!important}",
});
const files = [];
if (!bad.includes("never started")) {
  const remade = await page.evaluate(async (set) => {
    const m = window.__bolt;
    const before = { ...m.look };
    Object.assign(m.look, JSON.parse(set ?? "{}"));
    const keys = Object.keys(m.look).filter((k) => m.look[k] !== before[k]);
    for (const k of keys) m.changed(k);
    return keys;
  }, process.env.SET);
  if (remade.length) await page.waitForTimeout(600);
  for (const [i, shot] of shots.entries()) {
    await page.evaluate((v) => (window.__bolt.state.hold = v), +shot);
    await page
      .waitForFunction(
        () =>
          window.__bolt.state.skies > 0 && window.__bolt.state.busy === 0,
        null,
        { timeout: 120000 },
      )
      .catch(() => bad.push("the sky never came"));
    const f0 = await page.evaluate(() => window.__bolt.state.frame);
    await page
      .waitForFunction((f) => window.__bolt.state.frame > f + 3, f0, {
        timeout: 60000,
      })
      .catch(() => bad.push("stuck"));
    const file =
      shots.length > 1
        ? path.join(os.tmpdir(), `bolt-shot-${process.pid}-${i}.png`)
        : out;
    fs.writeFileSync(file, await page.screenshot({ timeout: 60000 }));
    files.push(file);
  }
  if (shots.length > 1) {
    const cols = +(process.env.COLS ?? Math.ceil(Math.sqrt(shots.length)));
    execFileSync("magick", [
      "montage",
      ...files,
      "-tile",
      `${cols}x`,
      "-geometry",
      "+2+2",
      "-background",
      "#111",
      out,
    ]);
    files.forEach((f) => fs.unlinkSync(f));
  }
  console.log(JSON.stringify(await page.evaluate(() => window.__bolt.state)));
}
console.log(
  bad.length
    ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}`
    : "clean",
);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
