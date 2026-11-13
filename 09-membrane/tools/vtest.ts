// node --experimental-strip-types tools/vtest.ts [seconds=12]: run the colonies headless and say how
// they are: heights, volumes, how squashed, how fast, anything broken.
import { H, Sim, V } from "../src/volvox/soft.ts";

const seconds = Number(process.argv[2] ?? 12);
if (process.env.SET) Object.assign(V, JSON.parse(process.env.SET));
const sim = new Sim();
console.log(`${sim.tops.length} colonies, ${sim.kids.length} daughters, ${sim.tops.length * sim.big.n + sim.kids.length * sim.small.n} points, dish ${sim.bowl.toFixed(2)}`);
const t0 = performance.now();
let worst = 0;
for (let s = 1; s <= seconds; s++) {
  for (let i = 0; i < 1 / H; i++) {
    const a = performance.now();
    sim.tick();
    worst = Math.max(worst, performance.now() - a);
  }
  let low = 1e9,
    volLo = 1e9,
    volHi = 0,
    flat = 1e9,
    fast = 0,
    bad = 0,
    kidOut = 0,
    kidOff = 0;
  for (const b of sim.tops) {
    let top = -1e9,
      bottom = 1e9;
    for (let i = 0; i < b.n * 3; i += 3) {
      if (!Number.isFinite(b.x[i] + b.x[i + 1] + b.x[i + 2])) bad++;
      top = Math.max(top, b.x[i + 1]);
      bottom = Math.min(bottom, b.x[i + 1]);
      fast = Math.max(fast, Math.hypot(b.x[i] - b.p[i], b.x[i + 1] - b.p[i + 1], b.x[i + 2] - b.p[i + 2]) / H);
    }
    low = Math.min(low, bottom);
    flat = Math.min(flat, (top - bottom) / (2 * b.R));
    volLo = Math.min(volLo, b.vol);
    volHi = Math.max(volHi, b.vol);
    for (const k of b.kids) {
      const d = Math.hypot(k.c[0] - b.c[0], k.c[1] - b.c[1], k.c[2] - b.c[2]);
      kidOut = Math.max(kidOut, (d + k.R) / b.R);
      kidOff = Math.max(kidOff, Math.hypot(k.c[0] - k.aim[0], k.c[1] - k.aim[1], k.c[2] - k.aim[2]) / b.R);
    }
  }
  const high = Math.max(...sim.tops.map((b) => b.c[1] / b.R));
  console.log(
    `${String(s).padStart(3)}s  lowest ${low.toFixed(3)}  highest middle ${high.toFixed(2)}R  volume ${volLo.toFixed(2)}..${volHi.toFixed(2)}  flattest ${flat.toFixed(2)}  fastest ${fast.toFixed(1)}/s  daughters reach ${kidOut.toFixed(2)}R, off place ${kidOff.toFixed(2)}R${bad ? `  BROKEN ${bad}` : ""}`,
  );
}
console.log(`${((performance.now() - t0) / (seconds / H)).toFixed(3)} ms a step (worst ${worst.toFixed(2)}), two steps a frame`);
