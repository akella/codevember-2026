// node tools/shot.mjs <out.png> [size] [seconds to wait]: renders the page headless with real WebGPU, no flags.
// Env CAM="x,y,z,tx,ty,tz" places the camera, SET='{"look":{...},"physics":{...}}' changes settings.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [out = "shot.png", size = "900", wait = "3"] = process.argv.slice(2);
const url = process.env.URL ?? "http://localhost:5307/";
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h ?? w }, deviceScaleFactor: +(process.env.DPR ?? 1) });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 400)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => window.__hollow || window.__paper || window.__smoke || window.__shapes, null, { timeout: 60000 }).catch(() => bad.push("never started"));
if (process.env.SET) await page.evaluate((s) => { const h = window.__hollow ?? window.__paper ?? window.__shapes; const v = JSON.parse(s); Object.assign(h.look ?? h.settings, v.look ?? {}); if (h.physics) Object.assign(h.physics, v.physics ?? {}); if (v.restart) h.restart(); }, process.env.SET);
const cam = process.env.CAM?.split(",").map(Number);
if (cam) await page.evaluate((c) => { const { camera, controls } = window.__hollow ?? window.__paper ?? window.__shapes; controls.target.set(c[3], c[4], c[5]); camera.position.set(c[0], c[1], c[2]); controls.update(); }, cam);
await new Promise((r) => setTimeout(r, +wait * 1000));
await page.addStyleTag({ content: ".lil-gui,canvas+div{display:none!important}" });
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 30) requestAnimationFrame(f); else r(30000 / (performance.now() - t0)); }; requestAnimationFrame(f); }));
fs.writeFileSync(out, await page.screenshot({ timeout: 60000 }));
console.log(`fps ${fps.toFixed(1)}`, bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
