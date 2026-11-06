// node sim/live-browsers.mjs [base url] [dir for shots]: the page the way a visitor's browser runs it.
// Everything else in sim/ passes --enable-unsafe-webgpu, which skips a compiler pass that can fail.
// Counts console errors and how much of the frame isn't backdrop, so an empty page can't pass
import { chromium } from "playwright-core";
import fs from "node:fs"; import os from "node:os";
const [root = "http://localhost:5174/", shots] = process.argv.slice(2);
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const dir = fs.readdirSync(base).find((d) => d.startsWith("chrome-"));
const app = fs.readdirSync(base + dir).find((d) => d.endsWith(".app"));
const executablePath = `${base}${dir}/${app}/Contents/MacOS/${app.replace(".app", "")}`;
let failed = 0;
for (const [name, query, webgpu] of [["default", "", true], ["bake", "?bake=knot", true], ["cord", "?look=cord", true], ["lacquer", "?look=lacquer&bake=live-knot", true], ["no webgpu", "", false]]) {
  const browser = await chromium.launch({ executablePath, headless: true, args: [] });
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  if (!webgpu) await page.addInitScript(() => { delete Navigator.prototype.gpu; });
  const bad = [];
  page.on("pageerror", (e) => bad.push(e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) bad.push(m.text().replace(/\s+/g, " ").slice(0, 160)); });
  await page.goto(root + query);
  await page.waitForFunction(() => !document.querySelector("#loading") || document.querySelector("#loading.failed"), null, { timeout: 60000 }).catch(() => bad.push("never finished loading"));
  await page.addStyleTag({ content: ".lil-gui,#codevember{display:none!important}" });
  await new Promise((r) => setTimeout(r, 2500));
  const shot = await page.screenshot({ timeout: 20000 });
  if (shots) fs.writeFileSync(`${shots}/browser-${name.replace(" ", "-")}.png`, shot);
  const covered = await page.evaluate(async (data) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(100, 100);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 100, 100);
    const { data: px } = context.getImageData(0, 0, 100, 100);
    let rope = 0;
    // the backdrop is a soft lilac, so rope is what's far from it in hue or brightness
    for (let i = 0; i < px.length; i += 4) { const [r, g, b] = [px[i], px[i + 1], px[i + 2]]; if (Math.abs(r - g) > 60 || Math.abs(g - b) > 60 || Math.min(r, g, b) > 215 || Math.max(r, g, b) < 60) rope++; }
    return rope / 100;
  }, shot.toString("base64")).catch((e) => `unmeasured ${e.message}`);
  const choices = await page.evaluate(() => ({ gpu: !!navigator.gpu, bake: [...document.querySelectorAll(".lil-gui .controller")].find((c) => c.querySelector(".name")?.textContent === "bake")?.querySelector("select")?.selectedOptions[0].textContent }));
  const ok = bad.length === 0 && covered > 2;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: runs ${choices.bake}, navigator.gpu ${choices.gpu}, rope on ${covered}% of the frame, errors ${bad.length} ${bad[0] ?? ""}`);
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2500))]);
}
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(0);
