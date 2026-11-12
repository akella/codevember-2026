// node tools/diff.mjs a.png b.png [x y w h]: mean brightness of each (0..255) and their rms difference,
// over a region if given
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [a, b, ...rect] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage();
const url = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
const r = await page.evaluate(
  async ([ua, ub, rect]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    const [x, y, w, h] = rect.length ? rect.map(Number) : [0, 0, ia.width, ia.height];
    const px = (img) => { const c = new OffscreenCanvas(ia.width, ia.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(x, y, w, h).data; };
    const da = px(ia), db = px(ib);
    let s = 0, ma = 0, mb = 0;
    const n = (da.length / 4) * 3;
    for (let i = 0; i < da.length; i += 4) for (let k = 0; k < 3; k++) { s += (da[i + k] - db[i + k]) ** 2; ma += da[i + k]; mb += db[i + k]; }
    return `mean ${(ma / n).toFixed(2)} vs ${(mb / n).toFixed(2)}, rms ${Math.sqrt(s / n).toFixed(2)}`;
  },
  [url(a), url(b), rect],
);
console.log(r);
await browser.close();
