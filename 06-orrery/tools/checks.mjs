// node tools/checks.mjs <dir> [url]: seam, frame rate, and the page with WebGPU taken away.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir = ".", url = "http://localhost:5286/"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const executablePath = `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (webgpu) => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  if (!webgpu) await page.addInitScript(() => { delete Navigator.prototype.gpu; });
  const bad = [];
  page.on("pageerror", (e) => bad.push(e.message.slice(0, 300)));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 300)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__orrery, null, { timeout: 60000 }).catch(() => bad.push("never started"));
  await wait(2500);
  return { browser, page, bad };
};
const close = (b) => Promise.race([b.close(), wait(2500)]);

{
  const { browser, page, bad } = await open(true);
  const frames = await page.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : done(n / 3); }; requestAnimationFrame(tick); }));
  const grab = async (t) => { await page.evaluate((t) => window.__orrery.hold(t), t); await wait(600); fs.writeFileSync(`${dir}/seam-${t}.png`, await page.screenshot()); };
  for (const t of [0, 1, 0.002, 0.998, 0.499, 0.501]) await grab(t);
  console.log(`webgpu: ${frames.toFixed(0)} frames a second, problems ${bad.length} ${bad[0] ?? ""}`);
  await close(browser);
}
{
  const { browser, page, bad } = await open(false);
  fs.writeFileSync(`${dir}/fallback.png`, await page.screenshot({ timeout: 30000 }));
  console.log(`no webgpu: navigator.gpu ${await page.evaluate(() => !!navigator.gpu)}, problems ${bad.length}\n  ${[...new Set(bad)].join("\n  ")}`);
  await close(browser);
}
process.exit(0);
