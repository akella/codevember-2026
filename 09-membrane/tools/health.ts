// node --experimental-strip-types tools/health.ts [periods=14]: the first moments a cell is not as it should be:
// its area off, an edge far too long, or two cells of a pair overlapping
import { Sim, P, N } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const periods = +(process.argv[2] ?? 14);
let said = 0;
while (sim.step < periods * TS && said < 12) {
  sim.tick();
  if (sim.step % 12) continue;
  for (const G of sim.gens) {
    const a = sim.age(G);
    if (a < -2 || a > 1) continue;
    const bad: string[] = [];
    for (const b of G.bodies) {
      const L = b.loop;
      const want = (b.side === 2 ? 2 : 1) * Math.PI * b.S * b.S;
      const area = L.area() / want;
      let long = 0;
      for (let i = 0; i < L.n; i++) {
        const j = (i + 1) % L.n;
        long = Math.max(long, Math.hypot(L.x[j] - L.x[i], L.y[j] - L.y[i]));
      }
      long /= b.sp.edge1 * b.S;
      if (Math.abs(area - 1) > 0.08) bad.push(`area ${area.toFixed(2)}`);
      if (long > (b.side === 2 ? 5 : 2.2)) bad.push(`an edge ${long.toFixed(1)} times its length`);
      for (const d of b.lodgers) {
        const r = d.loop.area() / (d.room * d.S * d.S);
        if (r < 0.6) bad.push(`lodger at ${r.toFixed(2)} of its size`);
      }
    }
    if (!G.merged && G.bodies.length === 2) {
      const [A, B] = G.bodies;
      A.loop.measure();
      B.loop.measure();
      const d = Math.hypot(A.loop.cx - B.loop.cx, A.loop.cy - B.loop.cy) / A.S;
      if (d < 1.2) bad.push(`pair ${d.toFixed(2)} radii apart`);
    }
    if (bad.length) {
      console.log(`at ${(sim.step / TS).toFixed(3)}, age ${a.toFixed(3)}: ${bad.join("; ")}`);
      said++;
    }
  }
}
console.log(`ran to ${(sim.step / TS).toFixed(2)}; lodgers put back in shape ${sim.healed}`);
