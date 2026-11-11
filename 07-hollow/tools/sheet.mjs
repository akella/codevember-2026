// node tools/sheet.mjs <out.png> [frames] [seconds apart] [size]: a contact sheet of the live page over time.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os"; import { execFileSync } from "node:child_process";
const [out = "sheet.png", frames = "6", gap = "1", size = "500x600"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = size.split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(process.env.URL ?? "http://localhost:5307/");
await page.waitForFunction(() => window.__hollow || window.__paper || window.__smoke || window.__shapes, null, { timeout: 60000 });
if (process.env.SET) await page.evaluate((s) => { const h = window.__hollow ?? window.__paper ?? window.__shapes; const v = JSON.parse(s); Object.assign(h.look ?? h.settings, v.look ?? {}); if (h.physics) Object.assign(h.physics, v.physics ?? {}); if (v.restart) h.restart(); }, process.env.SET);
const cam = process.env.CAM?.split(",").map(Number);
if (cam) await page.evaluate((c) => { const { camera, controls } = window.__hollow ?? window.__paper ?? window.__shapes; controls.target.set(c[3], c[4], c[5]); camera.position.set(c[0], c[1], c[2]); controls.update(); }, cam);
await page.addStyleTag({ content: ".lil-gui,canvas+div{display:none!important}" });
await new Promise((r) => setTimeout(r, 1500));
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
fs=sys.argv[2:]; ims=[Image.open(f) for f in fs]; w,h=ims[0].size; n=len(ims); cols=min(n,6); rows=(n+cols-1)//cols
s=Image.new('RGB',(w*cols,h*rows))
for k,im in enumerate(ims): s.paste(im,((k%cols)*w,(k//cols)*h))
s.save(sys.argv[1])`, out, ...files]);
files.forEach((f) => fs.unlinkSync(f));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
