// node sim/lace-sheet.mjs <dir> [query]: every palette at one moment, picked through the panel like a person would
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [dir, query = "look=lace"] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((x) => x.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((x) => x.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await page.goto(`http://localhost:5174/?${query}`);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 90000 });
const choice = (name) => page.locator(".lil-gui .controller.option", { has: page.locator(`.name:text-is("${name}")`) });
const shot = async (path) => {
  await page.addStyleTag({ content: ".lil-gui{visibility:hidden}" });
  await page.waitForTimeout(400);
  await page.screenshot({ path });
  await page.evaluate(() => document.head.lastChild.remove());
};
await page.evaluate(() => window.__stage.seek(0.3));
const names = await choice("palette").locator("option").allTextContents();
console.log("palettes", names.join(" "), "| shown in lace:", await choice("palette").isVisible());
for (const name of names) {
  await choice("palette").locator("select").selectOption(name);
  await shot(`${dir}/${name}.png`);
}
for (const look of ["cord", "lacquer"]) {
  await choice("look").locator("select").selectOption(look);
  console.log(look, "palette shown:", await choice("palette").isVisible());
  await shot(`${dir}/${look}.png`);
}
await browser.close();
