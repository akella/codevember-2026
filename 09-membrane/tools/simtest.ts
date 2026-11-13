// node --experimental-strip-types tools/simtest.ts [periods=4] [sheet.png] [from,to,count in periods]
// Runs the cells with no page: timing, health of the membranes, how nearly one period repeats the last,
// and a sheet of line drawings in the camera's view.
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { Sim, P, K, N } from "../src/sim.ts";

const [periods = "4", out = "", span = ""] = process.argv.slice(2);
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;

function view(sim: Sim) {
  const cam = sim.camera();
  const c = Math.cos(-cam.turn),
    s = Math.sin(-cam.turn);
  const at = (x: number, y: number) => [((x - cam.x) * c - (y - cam.y) * s) * cam.zoom, ((x - cam.x) * s + (y - cam.y) * c) * cam.zoom];
  return { cam, at };
}
// membranes by age, in view units
function snapshot(sim: Sim) {
  const { at } = view(sim);
  const snap = new Map<string, number[]>();
  for (const G of sim.gens) {
    const a = Math.round(sim.age(G) * 1000) / 1000;
    if (a >= 1 || a < -3) continue;
    G.bodies.forEach((b, k) => {
      const pts: number[] = [];
      for (let i = 0; i < b.loop.n; i++) pts.push(...at(b.loop.x[i], b.loop.y[i]));
      for (let i = 0; i < b.org.n; i++) pts.push(...at(b.org.x[i], b.org.y[i]));
      snap.set(`${a}/${k}`, pts);
    });
  }
  return snap;
}
function svg(sim: Sim, size = 420) {
  const { at, cam } = view(sim);
  const px = (v: number[]) => `${(size / 2 + v[0] * size).toFixed(1)},${(size / 2 - v[1] * size).toFixed(1)}`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#05080d"/>`;
  for (const G of sim.gens) {
    const a = sim.age(G);
    for (const b of G.bodies) {
      const L = b.loop;
      const pts = [];
      for (let i = 0; i < L.n; i++) pts.push(px(at(L.x[i], L.y[i])));
      s += `<polygon points="${pts.join(" ")}" fill="rgba(120,170,220,0.08)" stroke="${a >= 0 ? "#9cf" : "#fff"}" stroke-width="1"/>`;
      if (b.S * cam.zoom * size > 12) {
        for (let i = 0; i < L.n; i += 1)
          for (let k = 0; k < 2; k += 2) {
            const j = (i + 1) % L.n;
            const r = at(L.x[i], L.y[i]),
              t = at(L.x[i] + L.cox[i * 2 + k], L.y[i] + L.coy[i * 2 + k]);
            s += `<line x1="${px(r).split(",")[0]}" y1="${px(r).split(",")[1]}" x2="${px(t).split(",")[0]}" y2="${px(t).split(",")[1]}" stroke="rgba(200,230,255,0.35)" stroke-width="0.6"/>`;
          }
        for (const d of b.lodgers) {
          const pts = [];
          for (let i = 0; i < d.loop.n; i++) pts.push(px(at(d.loop.x[i], d.loop.y[i])));
          s += `<polygon points="${pts.join(" ")}" fill="${["rgba(120,200,255,0.25)", "rgba(90,220,120,0.3)", "rgba(230,200,90,0.3)"][d.kind]}" stroke="${["#9df", "#6e8", "#ec6"][d.kind]}" stroke-width="1.2"/>`;
        }
        const col = ["#7cf", "#fa4", "#8ff", "#f84", "#ffd", "#678"];
        for (const set of [b.org, b.dust])
          for (let i = 0; i < set.n; i++) {
            const r = set.r[i] * b.S * cam.zoom * size;
            if (r < 0.3) continue;
            const c = at(set.x[i], set.y[i]);
            s += `<circle cx="${px(c).split(",")[0]}" cy="${px(c).split(",")[1]}" r="${r.toFixed(2)}" fill="none" stroke="${col[set.kind[i]]}" stroke-width="0.7"/>`;
          }
      }
    }
  }
  return s + `<text x="6" y="14" fill="#fff" font-size="11" font-family="monospace">${(sim.step / TS).toFixed(3)}</text></svg>`;
}

const total = Math.round(+periods * TS);
const [from, to, count] = span ? span.split(",").map(Number) : [+periods - 1, +periods, 12];
const shots = out ? Array.from({ length: count }, (_, i) => Math.round((from + ((to - from) * i) / Math.max(1, count - 1)) * TS)) : [];
const dir = fs.mkdtempSync(os.tmpdir() + "/cells-");
let before: Map<string, number[]> | null = null;
const t0 = performance.now();
let worst = 0,
  shot = 0;
for (let s = 0; s <= total; s++) {
  if (shots.includes(sim.step)) fs.writeFileSync(`${dir}/${String(shot++).padStart(3, "0")}.svg`, svg(sim));
  if (sim.step % TS === Math.round(TS * 0.37)) {
    // one period on, each generation should sit where the one before it sat
    const now = snapshot(sim);
    if (before) {
      let far = 0;
      for (const [key, pts] of now) {
        const old = before.get(key);
        if (!old || old.length !== pts.length) continue;
        for (let i = 0; i < pts.length; i++) if (Math.abs(old[i]) < 0.9) far = Math.max(far, Math.abs(pts[i] - old[i]));
      }
      console.log(`period ${(sim.step / TS).toFixed(2)}: furthest any point is from a period ago ${(far * 1080).toFixed(3)} px of 1080`);
    }
    before = now;
  }
  if (s % Math.round(TS / 4) === 0) {
    if (process.env.V) console.log(`  healed so far ${sim.healed}`);
    const rows = sim.gens.map((G) => {
      const b = G.bodies[0],
        L = b.loop;
      let lo = Infinity,
        hi = 0;
      for (let i = 0; i < L.n; i++) {
        const j = (i + 1) % L.n;
        const d = Math.hypot(L.x[j] - L.x[i], L.y[j] - L.y[i]) / b.S;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      return `${sim.age(G).toFixed(2)}:${(L.area() / (Math.PI * b.S * b.S)).toFixed(3)}[${lo.toFixed(3)},${hi.toFixed(3)}]`;
    });
    if (process.env.V) console.log((sim.step / TS).toFixed(2), rows.join("  "));
  }
  if (process.env.NECK) {
    const G = sim.gens.find((G) => sim.age(G) >= 0 && sim.age(G) < 0.3);
    const since = G ? Math.round(sim.age(G) * TS) : -1;
    if (G && since % 12 === 0 && since <= 360) {
      const b = G.bodies[0],
        L = b.loop;
      const w = Math.hypot(L.x[N - 1] + L.x[N] - L.x[2 * N - 1] - L.x[0], L.y[N - 1] + L.y[N] - L.y[2 * N - 1] - L.y[0]) / 2 / b.S;
      let lo = Infinity,
        hi = 0,
        len = 0;
      for (let i = 0; i < L.n; i++) {
        const j = (i + 1) % L.n;
        const d = Math.hypot(L.x[j] - L.x[i], L.y[j] - L.y[i]) / b.S;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        len += d;
      }
      console.log(`  ${(since / P.hz).toFixed(1)} s after fusing: opening ${w.toFixed(2)} radii, edges ${lo.toFixed(4)}..${hi.toFixed(4)}, round ${len.toFixed(2)}, area ${(L.area() / Math.PI / b.S / b.S).toFixed(3)}`);
    }
  }
  const t = performance.now();
  sim.tick();
  worst = Math.max(worst, performance.now() - t);
}
console.log(`${total} steps, ${((performance.now() - t0) / total).toFixed(3)} ms each, worst ${worst.toFixed(1)} ms; bodies ${sim.gens.map((G) => G.bodies.length).join(",")}`);
console.log(`lodgers put back in shape: ${sim.healed}`);
let nan = 0;
for (const G of sim.gens) for (const b of G.bodies) for (let i = 0; i < b.loop.n; i++) if (!Number.isFinite(b.loop.x[i])) nan++;
if (nan) console.log(`BROKEN: ${nan} points are not numbers`);
if (out) {
  for (const f of fs.readdirSync(dir)) execFileSync("magick", [`${dir}/${f}`, `${dir}/${f.replace(".svg", ".png")}`]);
  const cols = Math.min(shots.length, 4);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${dir}/%03d.png`, "-vf", `tile=${cols}x${Math.ceil(shots.length / cols)}`, "-frames:v", "1", out]);
  console.log(out);
}
fs.rmSync(dir, { recursive: true, force: true });
