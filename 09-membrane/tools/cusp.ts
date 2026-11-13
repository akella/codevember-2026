// node --experimental-strip-types tools/cusp.ts: the points either side of a fresh join, in edge lengths,
// in a frame with the seam upright
import { Sim, P, N } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
while (sim.step < 2 * TS) sim.tick();
const G = sim.gens.find((G) => sim.age(G) === 0)!;
const b = G.bodies[0],
  L = b.loop;
const e = sim.edge1 * b.S;
// frame: origin between the two joins, y along the seam
const frame = () => {
  const ox = (L.x[N - 1] + L.x[N] + L.x[2 * N - 1] + L.x[0]) / 4,
    oy = (L.y[N - 1] + L.y[N] + L.y[2 * N - 1] + L.y[0]) / 4;
  return { ox, oy };
};
const { ox, oy } = frame();
const k1 = b.kids[0].loop,
  k2 = b.kids[1].loop;
let ax = k2.cx - k1.cx,
  ay = k2.cy - k1.cy;
const al = Math.hypot(ax, ay);
ax /= al;
ay /= al; // across the seam
for (const at of (process.env.AT ?? "0,6,24,60,96").split(",").map(Number)) {
  while (sim.step < 2 * TS + at) sim.tick();
  const { ox, oy } = frame();
  const row = [];
  for (let i = N - 8; i < N + 8; i++) row.push(`${(((L.x[i] - ox) * ax + (L.y[i] - oy) * ay) / e).toFixed(1)},${((-(L.x[i] - ox) * ay + (L.y[i] - oy) * ax) / e).toFixed(1)}`);
  console.log(`+${at}: ${row.join("  ")}`);
}
