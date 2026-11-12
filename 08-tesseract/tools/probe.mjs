// node tools/probe.mjs "<js expression run in the page after N seconds>" [seconds]: prints the result
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
const [expr, wait = "3"] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const sub = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + sub).find((d) => d.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${sub}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true });
const [w, h] = (process.env.SIZE ?? "1280x800").split("x").map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +(process.env.DPR ?? 1) });
page.on("pageerror", (e) => console.log("error", e.message));
page.on("console", (m) => m.type() === "error" && console.log("console", m.text().slice(0, 400)));
await page.goto(process.env.URL ?? "http://localhost:5308/");
await page.waitForFunction(() => window.__tess, null, { timeout: 60000 });
if (process.env.AT) await page.evaluate((at) => { window.__tess.hold = +at; window.__tess.refresh(); }, process.env.AT);
await new Promise((r) => setTimeout(r, +wait * 1000));
console.log(JSON.stringify(await page.evaluate(`(async () => (${expr}))()`)));
await browser.close();
