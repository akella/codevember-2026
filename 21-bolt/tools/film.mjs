// node tools/film.mjs <out.mp4> [WxH=1024x1024] [fps=30]: the loop as a film, frame by frame from the page held at
// each moment, so no frame is dropped. The light of the bolts is worked out a little every frame the page draws, so
// the film is stepped as the page runs: two of the page's frames to one of the film's at 30 a second, and three
// seconds of them before the first, for the light to be where it would be. SET='{"toneA":"#98a8ff"}' changes look
// values; URL; DPR=2 draws it twice the size and brings it down, for cleaner edges; CRF; FROM, TO (seconds) for a part.
// node tools/film.mjs <out.jpg> [WxH] at AT=12.3 (seconds): one frame, as it is in the film.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const [out = "output/bolt_x.mp4", size = "1024x1024", fps = "30"] = process.argv.slice(2);
const url = process.env.URL ?? "http://localhost:5321/";
const LOOP = 40;
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(process.env.DPR ?? 2) });
page.on("pageerror", (e) => console.log("page:", e.message));
await page.goto(url);
await page.waitForFunction(() => window.__bolt && window.__bolt.state.frame > 2, null, { timeout: 90000 });
await page.addStyleTag({ content: "#loader,#bar,#stats,.lil-gui{display:none!important}" });
await page.evaluate((s) => {
  const m = window.__bolt;
  const look = JSON.parse(s ?? "{}");
  Object.assign(m.look, look);
  for (const k of Object.keys(look)) m.changed(k);
  m.state.film = true; // (its grain goes on changing, held or not)
}, process.env.SET);
// the page at a moment, after as many of its own frames as go by in a film's frame
const step = 60 / +fps;
const at = (t) =>
  page.evaluate(
    ([t, step]) =>
      new Promise((done) => {
        const m = window.__bolt;
        m.state.hold = t;
        const f0 = m.state.frame;
        const f = () => (m.state.frame - f0 < step ? requestAnimationFrame(f) : done(0));
        requestAnimationFrame(f);
      }),
    [((t % LOOP) + LOOP) % LOOP, step],
  );
const still = /\.(jpe?g|png)$/.test(out);
const from = still ? +(process.env.AT ?? 12.3) : +(process.env.FROM ?? 0);
const to = still ? from : +(process.env.TO ?? LOOP);
const n = still ? 1 : Math.round((to - from) * +fps);
// (the three seconds before, unseen)
for (let i = -3 * +fps; i < 0; i++) await at(from + i / +fps);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
if (still) {
  await at(from);
  const png = out.replace(/\.[a-z]+$/, ".film.png");
  fs.writeFileSync(png, await page.screenshot({ timeout: 60000 }));
  await browser.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-q:v", "2", out]);
  fs.rmSync(png);
  console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(2)} MB, at ${from} s`);
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bolt-film-"));
const t0 = Date.now();
// (a bar above Claude Code's prompt while it renders, and a notification when it is done: ~/.claude/progress)
const shown = await import(path.join(os.homedir(), ".claude/progress/progress.mjs")).then(({ job }) => job(path.basename(out, ".mp4"), n, { unit: "frames" }), () => undefined);
for (let i = 0; i < n; i++) {
  await at(from + i / +fps);
  fs.writeFileSync(path.join(tmp, `f${String(i).padStart(4, "0")}.png`), await page.screenshot({ timeout: 60000 }));
  shown?.tick(i + 1);
  if (i % 60 === 59) console.log(`${i + 1}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
await browser.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps, "-i", path.join(tmp, "f%04d.png"), "-vf", `scale=${w}:${h}:flags=lanczos`, "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", process.env.CRF ?? "16", "-preset", "slow", "-movflags", "+faststart", out]);
fs.rmSync(tmp, { recursive: true });
console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${n} frames at ${fps} fps`);
shown?.finish(`${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
