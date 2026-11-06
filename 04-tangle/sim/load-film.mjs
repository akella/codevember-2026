// node sim/load-film.mjs <dir> [from] [to]: films picking `to` in the bake menu on page `from`, and counts frames while loading
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir, from = "knot", to = "live-knot"] = process.argv.slice(2);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) console.log("console error:", m.text().slice(0, 300)); });
// every frame the browser offers, with the gap since the last and whether the page was still loading
await page.addInitScript(() => {
  const log = (window.__frames = []);
  let last = performance.now();
  const beat = (now) => { log.push([Math.round(now), Math.round(now - last), !!document.querySelector("#loading")]); last = now; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
});
await page.goto(`http://localhost:5174/?bake=${from}`);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 30000 }).catch(async () => {
  console.log("stuck, loader says:", await page.locator("#loading p").textContent());
  process.exit(1);
});
await page.waitForTimeout(500);
// the browser's own stream of frames: it carries on through a reload, which a screenshot can't
const cdp = await page.context().newCDPSession(page);
const started = Date.now();
let n = 0;
cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
  fs.writeFileSync(`${dir}/${String(n++).padStart(4, "0")}-${String(Date.now() - started).padStart(5, "0")}.jpg`, Buffer.from(data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 700, maxHeight: 700 });
await page.waitForTimeout(300);
await page.locator(".lil-gui .controller.option", { has: page.locator('.name:text-is("bake")') }).locator("select").selectOption(to);
await page.waitForFunction((to) => !document.querySelector("#loading") && new URLSearchParams(location.search).get("bake") === to, to, { timeout: 30000 });
const ready = Date.now();
await page.waitForTimeout(1000);
await cdp.send("Page.stopScreencast");
const f = await page.evaluate(() => ({ frames: window.__frames }));
console.log("filmed", n);
const loading = f.frames.filter((x) => x[2]);
const gaps = loading.map((x) => x[1]).sort((a, b) => a - b);
console.log(JSON.stringify({ readyAfterMs: ready - started, framesWhileLoading: loading.length, longestGapMs: gaps.at(-1), medianGapMs: gaps[gaps.length >> 1], gapsOver100: gaps.filter((g) => g > 100).length }));
await browser.close();
