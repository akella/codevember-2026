// node --experimental-strip-types tools/cseam.ts [periods=6]: run the crowd headless. For each period: how
// many bodies there were at most and how many awake, whether every daughter was in its place and still
// before the period ended, how far the bodies were from the ones in their places a period before
// (measured just before the period ends, and partway through), and what a step costs.
import { H } from "../src/volvox/soft.ts";
import { readFileSync, existsSync } from "node:fs";
import { C, Crowd, baked } from "../src/crowd/sim.ts";
if (process.env.SET) Object.assign(C, JSON.parse(process.env.SET));
// (putt: the pushes solved for it, if there are any)
if (C.putt && existsSync("src/crowd/putts.json")) {
  const solved = JSON.parse(readFileSync("src/crowd/putts.json", "utf8"));
  Object.assign(C, solved.C ?? {});
  Object.assign(baked, solved);
}
const periods = Number(process.argv[2] ?? 6);
const sim = new Crowd();
const TS = sim.TS;
// (the world is turned back each period, so two a period apart are compared as they are)
const c = 1,
  sn = 0,
  ch = 1,
  sh = 0;
console.log(`${sim.M} colonies, ${sim.K} daughters each, reach ${sim.A.toFixed(1)}, closing in ${(1 / sim.s).toFixed(2)} times a period, room for ${sim.cells.length}`);
let was: Map<number, number[]>[] = [];
for (let n = 0; n < periods; n++) {
  const now: Map<number, number[]>[] = [];
  let most = 0,
    mostAwake = 0,
    cost = 0,
    worst = 0,
    bad = 0,
    lastAwake = 0,
    awakeSum = 0;
  for (let i = 0; i < TS; i++) {
    const a = performance.now();
    sim.tick();
    const d = performance.now() - a;
    cost += d;
    worst = Math.max(worst, d);
    most = Math.max(most, sim.live.length);
    let awake = 0;
    for (const b of sim.live) if (!b.asleep) awake++;
    mostAwake = Math.max(mostAwake, awake);
    awakeSum += awake;
    if (awake) lastAwake = (sim.step % TS) / TS || 1;
    const ph = sim.step % TS;
    if (ph === Math.round(TS * 0.7) || ph === TS - 1) now.push(sim.snapshot());
  }
  for (const b of sim.live) for (let i = 0; i < b.n * 3; i++) if (!Number.isFinite(b.x[i])) bad++;
  const say = now.map((snap, k) => {
    const old = was[k];
    if (!old) return "-";
    let far = 0,
      turn = 0,
      count = 0;
    for (const [key, v] of snap) {
      const o = old.get(key);
      if (!o) continue;
      // (each generation is turned from the last: the one before is turned by as much before the two are compared)
      const ox = c * o[0] - sn * o[2],
        oz = sn * o[0] + c * o[2];
      far = Math.max(far, Math.hypot(v[0] - ox, v[1] - o[1], v[2] - oz) / v[7]);
      const qx = ch * o[3] + sh * o[5],
        qy = ch * o[4] + sh * o[6],
        qz = ch * o[5] - sh * o[3],
        qw = ch * o[6] - sh * o[4];
      turn = Math.max(turn, 2 * Math.acos(Math.min(1, Math.abs(v[3] * qx + v[4] * qy + v[5] * qz + v[6] * qw))));
      count++;
    }
    return `${far.toExponential(1)} radii / ${((turn * 180) / Math.PI).toFixed(3)} deg (${count})`;
  });
  // at the very end: is everything that will be kept asleep, and where it should be?
  let out = 0,
    off = 0;
  for (const b of sim.live) {
    if (b.idx >= sim.M) continue;
    if (!b.asleep) out++;
    off = Math.max(off, Math.hypot(b.c[0] - b.tx, b.c[2] - b.tz) / b.R);
  }
  console.log(
    `period ${String(n + 1).padStart(2)}  most ${most} bodies, ${mostAwake} awake (${(awakeSum / TS).toFixed(0)} on average), last one still at ${lastAwake.toFixed(2)}; at the end ${out} not yet still, farthest from its place ${off.toExponential(1)}; against a period before: at 0.7 ${say[0] ?? "-"}, at the end ${say[1] ?? "-"}; ${(cost / TS).toFixed(2)} ms a step (worst ${worst.toFixed(1)})${bad ? "  BROKEN" : ""}${sim.missed ? `  no room for ${sim.missed}` : ""}`,
  );
  was = now;
}
void H;
