// node tools/film.mjs <out dir> [fps] [passes]: renders the rolling page's loop offline, every frame gathered
// from nothing until it is clean, at full traced resolution, then `ffmpeg` makes the video (printed).
// SIZE=1920x1080, FROM/TO=<frame> for a part, SET as in shot.mjs on top of the film settings.
// LENS=<radius> gives depth of field (FOCUS=<distance>, or it focuses on the tesseract), SHUTTER=<0..1>
// motion blur over that part of a frame: each pass is traced at its own moment in it.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [dir = "film", fps = "30", passes = "16"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
// CDP=http://127.0.0.1:9333 drives a Chrome that is already running, on another machine say (started
// with --headless=new --remote-debugging-port, its port and this page's forwarded over ssh)
const remote = process.env.CDP;
const browser = remote ? await chromium.connectOverCDP(remote) : await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = (process.env.SIZE ?? "1920x1080").split("x").map(Number);
const page = await (remote ? browser.contexts()[0] : browser).newPage();
await page.setViewportSize({ width: w, height: h });
page.on("pageerror", (e) => console.log("error", e.message));
await page.goto(process.env.URL ?? "http://localhost:5308/");
if (remote) console.log(await page.evaluate(async () => (navigator.gpu ? ((await navigator.gpu.requestAdapter())?.info?.architecture ?? "no adapter") : "no WebGPU")));
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,body>div:not(:has(canvas)),div[style*=\"z-index\"]{display:none!important}" });
// every traced pixel a screen pixel, many paths, inner panes reflecting from the first pass
const film = { half: false, auto: false, scale: 1, focus: 1, output: 1, spp: 4, sppTesseract: 8, bounces: 6, innerPanes: "reflect" };
const lens = +(process.env.LENS ?? 0);
const shutter = +(process.env.SHUTTER ?? 0);
// soft edges are meant, so the traced image is taken as it is, with no blur, and every pass counts the same
if (lens || shutter) Object.assign(film, { aperture: lens, focusAt: +(process.env.FOCUS ?? 0), raw: true, denoise: 0, sharpStill: +passes });
const seconds = await page.evaluate(
  ([film, extra]) => {
    const t = window.__tess;
    t.paused = true;
    Object.assign(t.render, film);
    for (const k of Object.keys(extra)) Object.assign(t[k], extra[k]);
    return t.loopSeconds();
  },
  [film, JSON.parse(process.env.SET ?? "{}")],
);
const total = Math.round(seconds * +fps);
const from = +(process.env.FROM ?? 0);
const to = Math.min(total, +(process.env.TO ?? total));
const t0 = Date.now();
for (let i = from; i < to; i++) {
  await page.evaluate(
    async ([time, passes, open]) => {
      const t = window.__tess;
      t.blend = open > 0;
      for (let k = 0; k < (open > 0 ? passes : 1); k++) {
        t.hold = Math.max(0, time + (open > 0 ? ((k + 0.5) / passes - 0.5) * open : 0));
        if (k === 0) t.refresh();
        await t.bench(open > 0 ? 1 : passes);
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    [i / +fps, +passes, shutter / +fps],
  );
  fs.writeFileSync(`${dir}/${String(i).padStart(5, "0")}.png`, await page.screenshot());
  if ((i - from) % 10 === 9) {
    const per = (Date.now() - t0) / (i - from + 1) / 1000;
    console.log(`${i + 1}/${to}  ${per.toFixed(1)} s a frame, ${Math.round((per * (to - i - 1)) / 60)} min left`);
  }
}
console.log(`ffmpeg -y -framerate ${fps} -i ${dir}/%05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p -movflags +faststart ${dir}.mp4`);
await page.close();
if (!remote) await browser.close();
process.exit(0);
