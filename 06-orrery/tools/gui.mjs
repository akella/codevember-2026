// node tools/gui.mjs <dir> [url]: moves the real sliders, checks the seam still closes, grabs a frame of each.
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir = ".", url = "http://localhost:5286/"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
const bad = [];
page.on("pageerror", (e) => bad.push(e.message.slice(0, 300)));
page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => window.__orrery, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const set = async (values) => { await page.evaluate((v) => { for (const c of window.__orrery.gui.controllersRecursive()) if (c.property in v) c.setValue(v[c.property]); }, values); await wait(500); };
const shot = async (name, t) => { await page.evaluate((t) => window.__orrery.hold(t), t); await wait(600); fs.writeFileSync(`${dir}/${name}.png`, await page.screenshot()); };
const read = () => page.evaluate(() => ({ text: window.__orrery.tune.clearance, birds: window.__orrery.birds.length }));
const only = process.env.ONLY;
for (const [name, values] of [
  ["mine", {}],
  ["orbits", { orbits: 3, curve: 1 }],
  ["straight", { orbits: 1, curve: 0 }],
  ["fast", { orbits: 1, curve: 0.8, levels: 16, pace: 2 }],
  ["uneven", { levels: 7, pace: 3 }],
  ["matte", { shine: 0, curve: 0.8 }],
  ["default", { density: 1, width: 0.056, levels: 2, pace: 2, wings: 1, layers: false }],
  ["levels", { density: 1, width: 0.056, levels: 3, wings: 1, layers: false }],
  ["layers", { density: 1, width: 0.056, levels: 2, wings: 1, layers: true, turn: 90, tilt: 25 }],
  ["odd", { density: 1, width: 0.056, levels: 3, wings: 1, layers: true, turn: 133, tilt: 40 }],
  ["hard", { density: 2, width: 0.04, levels: 2, wings: 0.6, layers: true, turn: 180, tilt: 60 }],
]) {
  if (only && !only.split(",").includes(name)) continue;
  await set(values);
  await wait(300);
  await shot(`gui-${name}`, 0.37);
  await shot(`gui-${name}-a`, 0);
  await shot(`gui-${name}-b`, 1);
  // the wrap inside the loop, where layers hand over, against an ordinary step: 0.25 of 2 levels is mid-level
  for (const [tag, t] of [["w0", 0.4995], ["w1", 0.5005], ["m0", 0.2495], ["m1", 0.2505]]) await shot(`gui-${name}-${tag}`, t);
  const { text, birds } = await read();
  console.log(`${name}: clearance ${text}, ${birds} birds`);
}
console.log(bad.length ? `${bad.length} problems:\n${[...new Set(bad)].join("\n")}` : "console clean");
await Promise.race([browser.close(), wait(2500)]);
process.exit(0);
