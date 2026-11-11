// node tools/smokeloop.mjs <out prefix> [phases]: holds the smoke loop at given phases and shoots each,
// then reports the pixel difference between phase 0 and phase 1, which must be noise only.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [out = "smoke", phases = "0,0.25,0.5,0.75,1"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().slice(0, 300)); });
await page.goto("http://localhost:5307/smoke.html");
await page.waitForFunction(() => window.__smoke, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,canvas+div{display:none!important}" });
if (process.env.SET) await page.evaluate((s) => Object.assign(window.__smoke.settings, JSON.parse(s)), process.env.SET);
for (const t of phases.split(",")) {
  await page.evaluate((t) => window.__smoke.hold(+t), t);
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(`${out}${t}.png`, await page.screenshot());
}
console.log(bad.length ? bad.join("\n") : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
