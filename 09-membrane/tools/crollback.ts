// node --experimental-strip-types tools/crollback.ts [periods=22]: how natural the daughters' rolling is,
// over the last period. For each daughter, from being let out to beginning to settle: how far she went
// back against the way she went in all, once down (radii), whether she turned round while still moving, how much
// she was helped (putt), and how far off her place she still was when settling began. SET='{"putt":true}'.
import { readFileSync, existsSync } from "node:fs";
import { C, Crowd, baked, sign } from "../src/crowd/sim.ts";
Object.assign(C, JSON.parse(process.env.SET ?? "{}"));
const putts = process.env.PUTTS ?? "src/crowd/putts.json"; // (or a variant's, to compare)
if (C.putt && existsSync(putts)) {
  const solved = JSON.parse(readFileSync(putts, "utf8"));
  Object.assign(C, solved.C ?? {});
  Object.assign(baked, solved);
}
const sim = new Crowd();
if (C.putt) console.log(baked.sign === sign() ? "solved pushes in use" : "no solved pushes for this crowd");
const P = Number(process.argv[2] ?? 22);
for (let n = 0; n < P - 1; n++) for (let i = 0; i < sim.TS; i++) sim.tick();
type Track = { xs: number[]; zs: number[]; R: number; done: boolean; off: number; helped: number; steps: number; late: boolean };
const tracks = new Map<number, Track>();
// sisters in one another: the deepest each pair got, in the smaller one's radii (from when they are out of their mother)
const into = new Map<string, number>();
for (let i = 0; i < sim.TS + 600; i++) {
  sim.tick();
  if (i < sim.TS && i % 2 === 0) {
    const moving = sim.live.filter((b) => b.litter && !b.ghost && !b.asleep && (sim.step - b.born) / 120 > 0.3);
    for (let x = 0; x < moving.length; x++)
      for (let y = x + 1; y < moving.length; y++) {
        const a = moving[x],
          b = moving[y];
        if (a.litter !== b.litter) continue;
        const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]);
        const depth = (a.R + b.R - d) / Math.min(a.R, b.R);
        const key = `${a.id}-${b.id}`;
        if (depth > (into.get(key) ?? 0)) into.set(key, depth);
      }
  }
  for (const b of sim.live) {
    if (!b.litter || b.ghost) continue;
    let t = tracks.get(b.id);
    if (!t) {
      if (i >= sim.TS || sim.step - b.born > 2) continue;
      t = { xs: [], zs: [], R: b.R, done: false, off: 0, helped: 0, steps: 0, late: false };
      tracks.set(b.id, t);
    }
    if (t.done) continue;
    // (from when she is down: rolling off her sisters as she is let out is as it should be)
    if ((sim.step - b.born) / 120 < 0.8) continue;
    // (measured in her radii, so a seam between makes no difference)
    t.xs.push(b.c[0] / b.R);
    t.zs.push(b.c[2] / b.R);
    t.steps++;
    if (b.easing || b.asleep) {
      t.done = true;
      t.off = Math.hypot(b.tx - b.c[0], b.tz - b.c[2]) / b.R;
      t.helped = b.helped / t.steps;
      t.late = (sim.step - b.born) * (1 / 120) > C.sleepAt + 1.6 - 1e-9;
    }
  }
}
const backs: number[] = [],
  offs: number[] = [],
  helps: number[] = [];
let turned = 0,
  late = 0,
  n = 0;
for (const t of tracks.values()) {
  if (!t.done || t.xs.length < 10) continue;
  n++;
  const L = t.xs.length - 1;
  const dx = t.xs[L] - t.xs[0],
    dz = t.zs[L] - t.zs[0];
  const d = Math.hypot(dx, dz) || 1;
  let back = 0,
    peak = [0, 0],
    peakV = 0,
    turn = false;
  // (over a quarter of a second at a time: a soft body's middle wobbles as it rolls)
  const W = 30;
  for (let k = W; k <= L; k += W) {
    const vx = t.xs[k] - t.xs[k - W],
      vz = t.zs[k] - t.zs[k - W];
    back += Math.max(0, -(vx * dx + vz * dz) / d);
    const v = (Math.hypot(vx, vz) * 120) / W;
    if (v > peakV) {
      peakV = v;
      peak = [vx, vz];
    }
    // turned round: going against the way she went fastest, still at a fifth of a radius a second
    if (v > 0.2 && vx * peak[0] + vz * peak[1] < 0) turn = true;
  }
  backs.push(back);
  offs.push(t.off);
  helps.push(t.helped);
  if (turn) turned++;
  if (t.late) late++;
}
const q = (a: number[], f: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
const f2 = (v: number) => v.toFixed(2);
console.log(`${process.env.SET ?? "posted"}: ${n} daughters`);
console.log(`  went back against her way (radii): median ${f2(q(backs, 0.5))}, 90% ${f2(q(backs, 0.9))}, most ${f2(q(backs, 1))}; turned round while moving: ${turned} (${((100 * turned) / n).toFixed(0)}%)`);
console.log(`  off her place when settling began (radii): median ${f2(q(offs, 0.5))}, 90% ${f2(q(offs, 0.9))}, most ${f2(q(offs, 1))}; hurried ${late}`);
const deep = [...into.values()];
console.log(
  `  sisters in one another (deepest, own radii): pairs deeper than 0.25 ${deep.filter((v) => v > 0.25).length}, deeper than 0.5 ${deep.filter((v) => v > 0.5).length}, deepest ${deep.length ? Math.max(...deep).toFixed(2) : "0"}`,
);
if (C.putt) console.log(`  helped (radii/s/s, on average over her roll): median ${f2(q(helps, 0.5))}, 90% ${f2(q(helps, 0.9))}, most ${f2(q(helps, 1))}`);
