// node --experimental-strip-types tools/vpop.ts [which=0] [at=8] [for=10]: poke one colony and follow
// what was inside it: how far the daughters are thrown, how they land and grow, whether anything breaks.
import { H, Sim, V } from "../src/volvox/soft.ts";
if (process.env.SET) Object.assign(V, JSON.parse(process.env.SET));
const [which = 0, at = 8, span = 10] = process.argv.slice(2).map(Number);
const sim = new Sim();
for (let i = 0; i < at / H; i++) sim.tick();
const b = sim.tops[which];
const kids = [...b.kids];
const from = [...b.c];
console.log(`colony ${which}, radius ${b.R.toFixed(2)}, ${kids.length} daughters; ${sim.free.length} bodies loose`);
sim.prodAt(b, [0, 0.5, 0.866]);
let worst = 0;
for (let s = 1; s <= span * 4; s++) {
  for (let i = 0; i < 0.25 / H; i++) {
    const a = performance.now();
    sim.tick();
    worst = Math.max(worst, performance.now() - a);
  }
  let bad = 0,
    far = 0,
    high = 0,
    low = 1e9,
    fast = 0,
    vol = 1e9;
  for (const k of kids) {
    for (let i = 0; i < k.n * 3; i++) if (!Number.isFinite(k.x[i])) bad++;
    far = Math.max(far, Math.hypot(k.c[0] - from[0], k.c[2] - from[2]));
    high = Math.max(high, k.c[1] / k.R);
    low = Math.min(low, k.c[1] / k.R);
    fast = Math.max(fast, Math.hypot(k.c[0] - k.was[0], k.c[1] - k.was[1], k.c[2] - k.was[2]) / H);
    vol = Math.min(vol, k.vol);
  }
  if (s <= 8 || s % 8 === 0)
    console.log(
      `${(s / 4).toFixed(2).padStart(6)}s  gone ${b.gone}  loose ${sim.free.length} ghosts ${sim.ghosts.length}  daughters: farthest ${far.toFixed(2)}, middles ${low.toFixed(2)}..${high.toFixed(2)}R up, fastest ${fast.toFixed(1)}/s, least volume ${vol.toFixed(2)}, radius ${kids[0]?.R.toFixed(3)} grown ${kids[0]?.grown.toFixed(2)}${bad ? "  BROKEN" : ""}`,
    );
}
console.log(`worst step ${worst.toFixed(2)} ms`);
