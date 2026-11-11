// node tools/record.mjs <out.mp4> [size=1024]: records fill.html?show, the whole loop, frame by frame.
// The page waits to be stepped (?record): each frame is exactly 1/60 of the simulation, finished on the GPU,
// then captured, so the video is smooth however slow the capture is. The loop's last frame leads into its
// first. DPR=2 renders twice the size and scales down (smoother edges); EVERY=n keeps every nth frame only
// (a quick look at the timeline: tiles them into <out>.png); FROM/TO (seconds) record a stretch. Frames
// go straight into ffmpeg (at 2x, a loop's PNGs would be gigabytes).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";

const [out = "fill-loop.mp4", size = "1024"] = process.argv.slice(2);
const dpr = +(process.env.DPR ?? 2),
  every = +(process.env.EVERY ?? 1),
  fps = 60;
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: +size, height: +size }, deviceScaleFactor: dpr });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 300)));
page.on("crash", () => console.log("page crashed"));
page.on("framenavigated", (f) => f === page.mainFrame() && console.log(`navigated: ${f.url()}`));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) bad.push(m.text().replace(/\s+/g, " ").slice(0, 300));
});
await page.goto(`http://localhost:5307/fill.html?show&record`);
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__fill, null, { timeout: 60000 });
const { length } = await page.evaluate(() => window.__fill.show());
const total = Math.round(length * fps);
const from = Math.round(+(process.env.FROM ?? 0) * fps),
  to = Math.min(total, Math.round(+(process.env.TO ?? length) * fps));
const dir = fs.mkdtempSync(os.tmpdir() + "/record-");
const canvas = page.locator("canvas");
const encoder =
  every > 1
    ? null
    : spawn("ffmpeg", [
        "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        "-vf", `scale=${size}:${size}:flags=lanczos,format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", out,
      ], { stdio: ["pipe", "inherit", "inherit"] });
const done = encoder && new Promise((r) => encoder.on("close", r));
let lastPhase = "",
  kept = 0;
const t0 = Date.now();
for (let f = 0; f < to; f++) {
  await page.evaluate(() => window.__fill.step(1));
  const now = await page.evaluate(() => ({ ...window.__fill.show(), ...window.__fill.state() }));
  if (now.phase !== lastPhase) {
    console.log(`${(f / fps).toFixed(2)}s ${now.phase} (${now.count} beads, level ${now.level})`);
    lastPhase = now.phase;
  }
  if (f < from || f % every) continue;
  if (encoder) {
    // (the page's own clip, not the element's: an element shot waits for it to hold still, and with the GPU
    // busy that once took over the 30 s limit)
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: +size, height: +size }, timeout: 300000 });
    kept++;
    if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
  } else await canvas.screenshot({ path: `${dir}/${String(kept++).padStart(5, "0")}.png` });
  if (kept % 300 === 0) console.log(`  ${kept} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
if (every > 1) {
  const cols = 8;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%05d.png`, "-vf", `scale=240:-1,tile=${cols}x${Math.ceil(kept / cols)}`, "-frames:v", "1", out.replace(/\.\w+$/, ".png")]);
} else {
  encoder.stdin.end();
  await done;
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${kept} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
