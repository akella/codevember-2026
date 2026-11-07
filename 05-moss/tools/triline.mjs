// node tools/triline.mjs [samples=18] [threshold=6] ['{"height":2.5}']: the picture is drawn in two halves, and where they meet must
// not show. So move the split a few pixels and compare: nothing should change. Any seam, whatever made
// it, shows as a column of changed pixels at the old and new split. Rows are the upper and lower half.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";

const samples = +(process.argv[2] ?? 18);
const threshold = +(process.argv[3] ?? 6);
const settings = JSON.parse(process.argv[4] ?? "{}");
const base = os.homedir() + "/Library/Caches/ms-playwright/chromium-1243/";
const d = fs.readdirSync(base).find((n) => n.startsWith("chrome-"));
const app = fs.readdirSync(base + d).find((n) => n.endsWith(".app"));
const browser = await chromium.launch({
  executablePath: `${base}${d}/${app}/Contents/MacOS/${app.replace(".app", "")}`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) console.log(m.text().slice(0, 300)); });
await page.goto("http://localhost:5275/");
await page.waitForFunction(() => window.__triangle, null, { timeout: 120000 });

const result = await page.evaluate(async ({ samples, threshold, settings }) => {
  const T = window.__triangle;
  Object.assign(T.settings, settings);
  T.changed();
  const stage = document.querySelector("#stage");
  const [w, h] = [stage.width, stage.height];
  const make = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c.getContext("2d", { willReadFrequently: true });
  };
  const [a, b] = [make(), make()];
  const SHIFT = 24;
  const line = T.line();
  const luma = (p, i) => p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722;
  const rows = [];
  let worst = { score: -1 };
  for (let k = 0; k < samples; k++) {
    // nine hops, sampled off the hop boundaries so that every part of a move gets looked at
    const t = T.loop() * ((k + 0.37) / samples);
    T.nudge(0);
    T.copy(t, a);
    T.nudge(SHIFT);
    T.copy(t, b);
    T.nudge(0);
    const x0 = line - 60;
    const span = SHIFT + 120;
    const one = a.getImageData(x0, 0, span, h).data;
    const two = b.getImageData(x0, 0, span, h).data;
    const halves = [new Uint32Array(span), new Uint32Array(span)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < span; x++) {
        const i = (y * span + x) * 4;
        if (Math.abs(luma(one, i) - luma(two, i)) > threshold) halves[y < h / 2 ? 0 : 1][x]++;
      }
    }
    const row = { hop: +((t / 1.5) % 9).toFixed(2) };
    ["upper", "lower"].forEach((name, n) => {
      const counts = halves[n];
      // a seam is confined to a few columns at either split, and those between them may differ too
      const at = (c) => Math.max(...[-2, -1, 0, 1, 2].map((o) => counts[c + o]));
      row[name] = [at(60), at(60 + SHIFT)];
    });
    rows.push(row);
    const score = Math.max(...row.upper, ...row.lower);
    if (score > worst.score) worst = { score, t };
  }
  return { rows, line, worst };
}, { samples, threshold, settings });

let total = 0;
for (const r of result.rows) {
  total += Math.max(...r.upper, ...r.lower);
  console.log(String(r.hop).padStart(5), "upper", r.upper.join(" / ").padEnd(12), "lower", r.lower.join(" / "));
}
console.log(JSON.stringify({ line: result.line, worstRows: result.worst.score, atSeconds: +result.worst.t.toFixed(2), sum: total }));
await browser.close();
