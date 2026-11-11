// node tools/paperplay.mjs <out prefix>: draws a mouse stroke over the paper page and shoots frames as it heals.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [out = "play"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) bad.push(m.text().slice(0, 300)); });
await page.goto("http://localhost:5307/paper.html");
await page.waitForFunction(() => window.__paper, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,canvas+div{display:none!important}" });
await page.evaluate(() => { const { camera, controls } = window.__paper; controls.target.set(0, 0, -0.3); camera.position.set(0.6, 0.2, 4.4); controls.update(); });
await new Promise((r) => setTimeout(r, 1500));
const shots = [];
shots.push(await page.screenshot());
// a stroke: an S across the frame
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  await page.mouse.move(180 + 440 * t, 400 + 170 * Math.sin(t * Math.PI * 2));
  await new Promise((r) => setTimeout(r, 16));
}
shots.push(await page.screenshot());
await new Promise((r) => setTimeout(r, 1000));
shots.push(await page.screenshot());
await new Promise((r) => setTimeout(r, 1500));
shots.push(await page.screenshot());
const state = await page.evaluate(() => { const b = window.__paper.balls; return { got: !!b.now, speeds: b.vx.map((v, i) => Math.hypot(v, b.vy[i]).toFixed(2)).join(" ") }; });
shots.forEach((s, i) => fs.writeFileSync(`${out}${i}.png`, s));
console.log(JSON.stringify(state), bad.length ? bad.join("\n") : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
