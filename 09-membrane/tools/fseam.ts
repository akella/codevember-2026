// node --experimental-strip-types tools/fseam.ts [periods=10]: run the channel headless and say, for each
// period, how far every body is from where the body in its place was one period before (in the measure
// of the moment: the pack's radii), halfway through the period and just before the front one bursts.
import { H } from "../src/volvox/soft.ts";
import { F, Flow } from "../src/flow/sim.ts";
if (process.env.SET) Object.assign(F, JSON.parse(process.env.SET));
const periods = Number(process.argv[2] ?? 10);
const sim = new Flow();
const TS = sim.TS;
const fuse = Math.round(F.fuse / H);
let was: Map<number, number[]>[] = [];
let cost = 0,
  worst = 0;
for (let n = 0; n < periods; n++) {
  const now: Map<number, number[]>[] = [];
  let bad = 0,
    most = 0;
  sim.drawn = sim.went = 0;
  for (let i = 0; i < TS; i++) {
    const a = performance.now();
    sim.tick();
    const d = performance.now() - a;
    cost += d;
    worst = Math.max(worst, d);
    most = Math.max(most, sim.free.length);
    const ph = sim.step % TS;
    if (ph === Math.round(TS / 2) || ph === TS - fuse - 2) now.push(sim.snapshot());
  }
  for (const b of sim.free) for (let i = 0; i < b.n * 3; i++) if (!Number.isFinite(b.x[i])) bad++;
  const say = now.map((snap, k) => {
    const old = was[k];
    if (!old) return "-";
    let far = 0,
      turn = 0,
      n = 0,
      lost = 0;
    for (const [key, v] of snap) {
      const o = old.get(key);
      if (!o) {
        lost++;
        continue;
      }
      far = Math.max(far, Math.hypot(v[0] - o[0], v[1] - o[1], v[2] - o[2]));
      turn = Math.max(turn, 2 * Math.acos(Math.min(1, Math.abs(v[3] * o[3] + v[4] * o[4] + v[5] * o[5] + v[6] * o[6]))));
      n++;
    }
    return `${far.toExponential(1)} / ${((turn * 180) / Math.PI).toFixed(2)}deg (${n}${lost ? `, ${lost} new` : ""})`;
  });
  const pack = sim.packs[sim.packs.length - 1];
  const xs = pack ? pack.members.map((m) => m.c[0].toFixed(1)).join(" ") : "";
  console.log(
    `period ${String(n + 1).padStart(2)}  seams ${sim.seams}  loose ${sim.free.length} (most ${most})  halfway ${say[0] ?? "-"}  before the burst ${say[1] ?? "-"}  drawn ${((100 * sim.drawn) / (sim.went || 1)).toFixed(1)}% of the way  pack along the channel: ${xs}${bad ? "  BROKEN" : ""}${sim.missed ? `  no room for ${sim.missed}` : ""}`,
  );
  was = now;
}
console.log(`${(cost / (periods * TS)).toFixed(2)} ms a step, worst ${worst.toFixed(1)}`);
