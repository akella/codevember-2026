// node --experimental-strip-types tools/cputt.ts: solves the pushes for crowd.html?putt. The crowd is run
// headless with unseen tries let out beside every real litter (see `lab` in sim.ts); each period every
// litter takes one step of Newton's method towards pushes that roll each daughter, of herself, to where
// she will stand. Prints how far short they stop, period by period, and writes src/crowd/putts.json.
import { writeFileSync } from "node:fs";
import { C, Crowd, sign } from "../src/crowd/sim.ts";
Object.assign(C, { putt: true, lab: true }, JSON.parse(process.env.SET ?? "{}"));
const sim = new Crowd();
// (for the report: how far each daughter's aim was moved off her place, by something standing on it, when her try stopped)
const blocked = new Map<number, number>();
const tried = sim.tried.bind(sim);
sim.tried = (g, x, z) => {
  if (!Number.isNaN(x)) {
    const aim = [0, 0];
    sim.clear(g.R, g.tx, g.tz, aim);
    blocked.set(g.from * sim.K + g.slot, Math.hypot(aim[0] - g.tx, aim[1] - g.tz) / g.R);
  }
  tried(g, x, z);
};
const q = (a: number[], f: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);
for (let n = 0; n < C.labFor; n++) {
  const t0 = performance.now();
  sim.labLog = [];
  for (let i = 0; i < sim.TS; i++) sim.tick();
  const plain = sim.labLog.map((r) => r[3]).filter(Number.isFinite),
    best = sim.labLog.map((r) => r[4]).filter(Number.isFinite);
  const picks = [0, 0, 0, 0, 0]; // (same, a nudged one, -, Newton, half)
  for (const r of sim.labLog) picks[r[2]]++;
  console.log(
    `period ${String(n + 1).padStart(2)}: ${sim.labLog.length} litters tried; how far short they stop of themselves, in the mother's radii (root mean square a litter): with the pushes so far median ${q(plain, 0.5).toFixed(3)}, 90% ${q(plain, 0.9).toFixed(3)}; best try median ${q(best, 0.5).toFixed(3)}, 90% ${q(best, 0.9).toFixed(3)}; best was [same, a nudged one, Newton, half] ${[picks[0], picks[1], picks[3], picks[4]].join("/")}; ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
}
// each daughter, with the pushes kept: how far short (her own radii), how hard the push, whether her place was taken
const rows: number[][] = [];
for (let m = 0; m < sim.M; m++)
  for (let k = 0; k < sim.K; k++) {
    const at = m * sim.K + k;
    if (Number.isNaN(sim.short[at * 2])) continue;
    rows.push([Math.hypot(sim.short[at * 2], sim.short[at * 2 + 1]) / sim.s, Math.hypot(sim.push[at * 2], sim.push[at * 2 + 1]), blocked.get(at) ?? 0, m, k, sim.lands[at]]);
  }
rows.sort((a, b) => a[0] - b[0]);
const col = (i: number) => rows.map((r) => r[i]);
console.log(
  `daughters: ${rows.length}; short of herself (own radii) median ${q(col(0), 0.5).toFixed(2)}, 75% ${q(col(0), 0.75).toFixed(2)}, 90% ${q(col(0), 0.9).toFixed(2)}; at the push limit ${rows.filter((r) => r[1] > C.puttPush - 1e-3).length}; place taken when she stopped ${rows.filter((r) => r[2] > 0.05).length}`,
);
console.log(
  "  worst: " +
    rows
      .slice(-10)
      .map((r) => `m${r[3]}k${r[4]}->${r[5]} short ${r[0].toFixed(2)} push ${r[1].toFixed(2)} taken ${r[2].toFixed(2)}`)
      .join("\n         "),
);
const out = process.env.OUT ?? "src/crowd/putts.json";
writeFileSync(out, JSON.stringify({ sign: sign(), push: [...sim.push].map((v) => Math.round(v * 1e6) / 1e6), lands: [...sim.lands], C: JSON.parse(process.env.SET ?? "{}") }));
console.log(`written ${out}`);
