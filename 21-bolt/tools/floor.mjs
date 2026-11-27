// node tools/floor.mjs <out.png>: the first bolt's light on the floor (straight, then by way of glass)
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
const [out = "floor.png"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto(process.env.URL ?? "http://localhost:5321/");
await page.waitForFunction(() => window.__bolt?.state.frame > 5 && window.__bolt.state.busy === 0, null, { timeout: 60000 });
const maps = await page.evaluate(async () => {
  const { device, maps } = window.__bolt;
  const all = [];
  for (const t of maps) {
    const n = t.width;
    const b = device.createBuffer({ size: n * n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: n * 8 }, [n, n, 1]);
    device.queue.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    const h = new Uint16Array(b.getMappedRange());
    const f = (v) => { const e = (v >> 10) & 31, m = v & 1023; return e === 0 ? m * 2 ** -24 : e === 31 ? 99999 : (1 + m / 1024) * 2 ** (e - 15); };
    const px = [];
    for (let i = 0; i < n * n; i++) px.push(f(h[i * 4 + 1]));
    all.push({ n, px, rgb: Array.from({ length: n * n * 3 }, (_, i) => f(h[Math.floor(i / 3) * 4 + (i % 3)])), a: Array.from({ length: n * n }, (_, i) => f(h[i * 4 + 3])) });
  }
  return all;
});
const [m] = maps;
const files = [m.a.flatMap((v) => [v, v, v]), m.rgb].map((rgb, k) => {
  const n = m.n;
  const px = rgb.filter((_, i) => i % 3 === 1);
  const s = [...px].sort((a, b) => a - b);
  console.log(["straight", "bent"][k], "mean", (px.reduce((a, b) => a + b) / px.length).toFixed(3), "50/90/99/99.9/max %", [0.5, 0.9, 0.99, 0.999, 1].map((q) => s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2)).join(" "));
  const f = `${os.tmpdir()}/bolt-floor-${k}.ppm`;
  fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${n} ${n} 255\n`), Buffer.from(rgb.map((v) => 255 * Math.pow(1 - Math.exp(-v * 2), 1 / 2.2)))]));
  return f;
});
execFileSync("magick", [...files, "+append", out]);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
process.exit(0);
