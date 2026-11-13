// node --experimental-strip-types tools/drift.ts: where a cell's contents sit on average, in its own frame
// (x along its length, in radii), as it ages
import { Sim, P } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const g = 6;
while (sim.step < 2 * TS) sim.tick();
for (let s = 0; s <= 4 * TS; s++) {
  if (s % (TS / 4) === 0) {
    const G = sim.gen(g);
    if (G && !G.merged) {
      const out = G.bodies.map((b) => {
        const L = b.loop;
        L.measure();
        const c = Math.cos(L.ang),
          sn = Math.sin(L.ang);
        let mx = 0,
          my = 0,
          rr = 0;
        for (let i = 0; i < b.org.n; i++) {
          const dx = b.org.x[i] - L.cx,
            dy = b.org.y[i] - L.cy;
          mx += dx * c + dy * sn;
          my += -dx * sn + dy * c;
          rr += Math.hypot(dx, dy);
        }
        const k = b.kids[0]?.loop;
        const kid = k ? `kid ${(((k.cx - L.cx) * c + (k.cy - L.cy) * sn) / b.S).toFixed(3)},${((-(k.cx - L.cx) * sn + (k.cy - L.cy) * c) / b.S).toFixed(3)}` : "";
        return `${(mx / b.org.n / b.S).toFixed(3)},${(my / b.org.n / b.S).toFixed(3)} spread ${(rr / b.org.n / b.S).toFixed(3)} ${kid}`;
      });
      console.log(`age ${sim.age(G).toFixed(2)}: A ${out[0]}   B ${out[1]}`);
    }
  }
  sim.tick();
}
