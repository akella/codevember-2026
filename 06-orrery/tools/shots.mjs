// node tools/shots.mjs <dir> [phases, comma separated] [size] [url]: real WebGPU in Playwright's cached Chromium.
// Runs with no flags, the way a visitor's browser does, and fails on any console error.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir = ".", phases = "0.1", size = "900", url = "http://localhost:5286/"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: process.env.FLAGS ? process.env.FLAGS.split(" ") : [] });
const page = await browser.newPage({ viewport: { width: +size, height: +size } });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 400)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => window.__orrery, null, { timeout: 60000 }).catch(() => bad.push("never started"));
await new Promise((r) => setTimeout(r, 2500));
await page.addStyleTag({ content: ".lil-gui{display:none!important}" });
if (process.env.EVAL) await page.evaluate(process.env.EVAL);
const cam = process.env.CAM?.split(",").map(Number);
if (cam) await page.evaluate((c) => { const { camera, controls } = window.__orrery; controls.minDistance = 0.1; controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; controls.target.set(c[3], c[4], c[5]); camera.position.set(c[0], c[1], c[2]); }, cam);
const name = process.env.NAME ?? "t";
const look = process.env.BIRD;
for (const t of phases.split(",")) {
  await page.evaluate((t) => window.__orrery.hold(+t), t);
  await new Promise((r) => setTimeout(r, 500));
  if (look) await page.evaluate((i) => { const { camera, controls, birds } = window.__orrery; controls.minDistance = 0.05; controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; const p = birds[+i].getWorldPosition(controls.target.clone()); controls.target.copy(p); camera.position.copy(p).add(p.clone().normalize().multiplyScalar(0.25)).add({ x: 0.15, y: 0.1, z: 0.45 }); }, look);
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(`${dir}/${name}${t}.png`, await page.screenshot({ timeout: 30000 }));
}
console.log(bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
