// node --experimental-strip-types tools/kinks.ts [seconds after fusing=4]: sharp turns left in a fused membrane
import { Sim, P, N } from "../src/sim.ts";
if (process.env.SET) Object.assign(P, JSON.parse(process.env.SET));
const sim = new Sim();
const TS = sim.TS;
const after = +(process.argv[2] ?? 4);
while (sim.step < 2 * TS + Math.round(after * P.hz)) sim.tick();
const G = sim.gens.find((G) => sim.age(G) >= 0 && sim.age(G) < 1)!;
const b = G.bodies[0],
  L = b.loop,
  n = L.n,
  e = sim.edge2 * b.S;
let total = 0;
const sharp: string[] = [];
for (let i = 0; i < n; i++) {
  const a = (i + n - 1) % n,
    c = (i + 1) % n;
  const ux = L.x[i] - L.x[a],
    uy = L.y[i] - L.y[a],
    vx = L.x[c] - L.x[i],
    vy = L.y[c] - L.y[i];
  const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  total += turn;
  if (Math.abs(turn) > 0.5) sharp.push(`${i}: ${(turn * 57.3).toFixed(0)}° (edges ${(Math.hypot(ux, uy) / e).toFixed(2)}, ${(Math.hypot(vx, vy) / e).toFixed(2)})`);
}
console.log(`${after} s after fusing: turns ${(total / 2 / Math.PI).toFixed(3)} times round, sharp corners: ${sharp.join("; ") || "none"}`);
