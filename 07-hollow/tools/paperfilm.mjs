// Records the cut paper page as a seamless loop, frame by frame: each frame is held at its exact phase,
// so the frame after the last one simply is the first one. Nothing is blended.
//
//   node tools/paperfilm.mjs [out.mp4] [--size 1024] [--fps 60] [--crf 16] [--settings '{"settings":{...},"play":{...}}'] [--keep]
//
// The loop is the clip, 3.4 s. Balls must be on a schedule (keepie-uppie or juggle): physics balls and
// the mouse trail don't repeat. Drawn at twice the size and scaled down. Needs `npm run dev` on 5307.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const out = args[0]?.startsWith("--") || !args[0] ? "output/paper-loop-1024.mp4" : args[0];
const size = +opt("size", 1024);
const fps = +opt("fps", 60);
const crf = opt("crf", "16");
// the page's own defaults unless told otherwise
const overrides = JSON.parse(opt("settings", "{}"));
const LOOP = 3.4;
const frames = Math.round(LOOP * fps);
const work = "output/paper-frames";

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 2 });
const bad = [];
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) bad.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => bad.push("pageerror: " + e.message));
await page.goto("http://localhost:5307/paper.html");
await page.waitForFunction(() => window.__paper, null, { timeout: 120000 });
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
const status = await page.evaluate((o) => {
  const P = window.__paper;
  Object.assign(P.settings, o.settings ?? {});
  Object.assign(P.play, o.play ?? {});
  P.replan();
  return P.status.text;
}, overrides);
console.log(`plan: ${status}; ${frames} frames`);
const canvas = await page.$("canvas");
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  // hold the phase, then let the page draw it at least twice before taking it
  await page.evaluate((t) => {
    window.__paper.hold(t);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  }, i / frames);
  await canvas.screenshot({ path: `${work}/${String(i).padStart(4, "0")}.png` });
  if (i % 40 === 0) console.log(`frame ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
if (bad.length) console.log(bad.join("\n"));

fs.mkdirSync("output", { recursive: true });
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", String(fps), "-i", `${work}/%04d.png`,
  "-vf", `scale=${size}:${size}:flags=lanczos,format=yuv420p`,
  // ipratio 1: x264 encodes keyframes sharper than the frames between, and a loop's first frame is
  // always one, so its seam would flicker; the same quality throughout keeps it seamless
  "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-x264-params", "ipratio=1.0", "-movflags", "+faststart",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  out,
]);
if (!args.includes("--keep")) fs.rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out}`);
process.exit(0);
