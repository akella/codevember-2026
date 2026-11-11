// node tools/tunnelrecord.mjs <out.mp4> [size=1024]: records the tunnel's loop (index.html), frame by frame. Each frame
// is the loop held at its own moment (frame / total), drawn at DPR (default 2) times the size and finished
// on the GPU before it's captured, then scaled down: smooth however slow the capture is, and the last
// frame leads into the first. FPS (default 60); SET merges settings in (JSON, by object); EVERY=n keeps
// every nth frame only and tiles them into <out>.png (a quick look at the whole loop). BASE: another server
// (a built copy, say, which editing the source does not reload mid-recording). FROM=n starts at frame n,
// to carry on a recording that was stopped: every frame depends only on its own moment, so parts join
// exactly (ffmpeg -f concat -safe 0 -i parts.txt -c copy whole.mp4).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";

const [out = "output/tunnel-loop-1024.mp4", size = "1024"] = process.argv.slice(2);
const dpr = +(process.env.DPR ?? 2),
  fps = +(process.env.FPS ?? 60),
  every = +(process.env.EVERY ?? 1);
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
await page.goto(`${process.env.BASE ?? "http://localhost:5307"}/index.html`);
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
await page.waitForFunction(() => window.__tunnel, null, { timeout: 60000 });
await page.evaluate((s) => {
  const t = window.__tunnel;
  t.view.auto = false;
  t.view.detail = devicePixelRatio;
  if (s) for (const [k, v] of Object.entries(JSON.parse(s))) Object.assign(t[k], v);
}, process.env.SET ?? "");
// the cells are baked in the background: not before they're there (and again, had a setting changed them)
for (let k = 0; k < 2; k++) {
  await page.waitForFunction(() => window.__tunnel.ready(), null, { timeout: 120000, polling: 200 });
  await new Promise((r) => setTimeout(r, 800));
}
const seconds = await page.evaluate(() => window.__tunnel.seconds);
const total = Math.round(seconds * fps);
console.log(`${total} frames (${seconds} s at ${fps}), ${await page.evaluate(() => window.__tunnel.cellCount())}`);
const dir = fs.mkdtempSync(os.tmpdir() + "/tunnel-");
const encoder =
  every > 1
    ? null
    : spawn("ffmpeg", [
        "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
        "-vf", `scale=${size}:${size}:flags=lanczos,format=yuv420p`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", out,
      ], { stdio: ["pipe", "inherit", "inherit"] });
const done = encoder && new Promise((r) => encoder.on("close", r));
const t0 = Date.now();
let kept = 0;
for (let f = +(process.env.FROM ?? 0); f < total; f += every) {
  // drawn at its moment, and once more so what's on screen is that frame
  await page.evaluate(async (t) => {
    await window.__tunnel.frame(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, f / total);
  const shot = { clip: { x: 0, y: 0, width: +size, height: +size }, timeout: 300000 };
  if (encoder) {
    const png = await page.screenshot(shot);
    if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
  } else await page.screenshot({ ...shot, path: `${dir}/${String(kept).padStart(5, "0")}.png` });
  if (++kept % 240 === 0) console.log(`  ${kept} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
if (encoder) {
  encoder.stdin.end();
  await done;
} else {
  const cols = Math.min(kept, 6);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%05d.png`, "-vf", `scale=320:-1,tile=${cols}x${Math.ceil(kept / cols)}`, "-frames:v", "1", out.replace(/\.\w+$/, ".png")]);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${kept} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(bad.length ? [...new Set(bad)].join("\n") : "clean");
