// node tools/paperballs.mjs <out.png> '<play json>' [frames] [gap s]: a strip of the paper page with balls on a schedule.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [out = "balls.png", json = "{}", frames = "6", gap = "0.25"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 420 } });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().slice(0, 300)); });
await page.goto("http://localhost:5307/paper.html");
await page.waitForFunction(() => window.__paper, null, { timeout: 60000 });
await page.addStyleTag({ content: ".lil-gui,canvas+div{display:none!important}" });
const status = await page.evaluate((j) => { const p = window.__paper; Object.assign(p.play, JSON.parse(j)); p.replan(); const { camera, controls } = p; controls.target.set(0, 0, -0.3); camera.position.set(0, 0, 4.9); controls.update(); return p.status.text; }, json);
await new Promise((r) => setTimeout(r, 1200));
const files = [];
for (let i = 0; i < +frames; i++) {
  const f = `${out}.${i}.png`;
  fs.writeFileSync(f, await page.screenshot());
  files.push(f);
  await new Promise((r) => setTimeout(r, +gap * 1000));
}
execFileSync("python3", ["-c", `
import sys
from PIL import Image
fs=sys.argv[2:]; ims=[Image.open(f) for f in fs]; w,h=ims[0].size
s=Image.new('RGB',(w*len(ims),h))
for k,im in enumerate(ims): s.paste(im,(k*w,0))
s.save(sys.argv[1])`, out, ...files]);
files.forEach((f) => fs.unlinkSync(f));
console.log("plan:", status, bad.length ? bad.join("\n") : "clean");
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
