// Records the triangle as a seamless loop, frame by frame, and encodes it. One turn is nine hops and the
// piece repeats exactly, so nothing is blended: the frame after the last one simply is the first one.
//
//   node tools/film.mjs [out.mp4] [--start 0.5] [--frames 810] [--crf 16] [--settings '{"strand":1}'] [--keep]
//
// --start is the hop it opens on, which is also the picture people see before it plays. --settings takes
// what the panel's copy button gives. Needs `npm run dev`. Frames go to output/frames, and --keep leaves them.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const out = args[0]?.startsWith("--") || !args[0] ? "output/moss-loop-1024.mp4" : args[0];
const size = 1024;
const fps = 60;
const work = "output/frames";

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
// twice the pixels: halved again here, moss edges shimmer far less, and shimmer is what compression eats
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 2 });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });

const plan = await page.evaluate((settings) => {
  const T = window.__triangle;
  T.pause();
  Object.assign(T.settings, settings);
  T.changed();
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  window.__reel = c.getContext("2d");
  window.__reel.imageSmoothingQuality = "high";
  const stage = document.querySelector("#stage");
  return { seconds: T.settings.seconds, loop: T.loop(), width: stage.width, height: stage.height };
}, JSON.parse(opt("settings", "{}")));
if (plan.width !== size * 2 || plan.height !== size * 2) throw new Error(`stage is ${plan.width}x${plan.height}`);

const whole = Math.round(plan.loop * fps);
if (Math.abs(whole / fps - plan.loop) > 1e-6) throw new Error(`a turn of ${plan.loop} s is not a whole number of frames`);
const count = +opt("frames", whole);
const start = +opt("start", 0.5) * plan.seconds;
const began = Date.now();
for (let f = 0; f < count; f++) {
  const url = await page.evaluate(async (t) => {
    window.__triangle.copy(t, window.__reel);
    const blob = await new Promise((done) => window.__reel.canvas.toBlob(done, "image/png"));
    const data = await new Promise((done) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.readAsDataURL(blob);
    });
    return data;
  }, (start + f / fps) % plan.loop);
  fs.writeFileSync(path.join(work, `${String(f).padStart(5, "0")}.png`), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  if (f % 120 === 0) console.log(`frame ${f} of ${count}, ${((Date.now() - began) / 1000).toFixed(0)} s`);
}
await browser.close();

// the backdrop is a slow dark gradient, and without noise an encoder turns it into contours. Noise that moves
// is the first thing it throws away, so this holds still, grain and dither both: it costs next to nothing to
// keep, and it is too faint to see as a pattern. It took the longest flat run in the backdrop from 99 pixels to 7
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(work, "%05d.png"),
  "-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p,noise=c0s=3:c0f=u",
  "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-crf", opt("crf", "16"),
  // dark gradients band first, so that is where the bits go; capped under what X takes
  "-x264-params", "aq-mode=3:aq-strength=1.1:deblock=-1,-1",
  "-maxrate", "24M", "-bufsize", "48M",
  "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  "-movflags", "+faststart", "-an", out,
], { stdio: "inherit" });
if (!args.includes("--keep")) fs.rmSync(work, { recursive: true, force: true });
console.log("wrote", out, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
