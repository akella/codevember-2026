// Finite-difference checks of the rod energy against the analytic forces in rods.ts, then the
// behaviours the paper promises. Run: node --experimental-strip-types sim/check.ts
import { defaults, makeRopes, type Params } from "./paths.ts";
import { Rods } from "./rods.ts";

const p: Params = { ...defaults, count: 1, rMin: 0.8, rMax: 0.8, window: 30, lag: 3, bend: Number(process.env.BEND ?? 1.3), twist: 0.9, spin: 2, tighten: 0 };
const rods = new Rods(p, makeRopes(p));
const r = rods as unknown as Record<string, any>;
for (let i = 0; i < 3; i++) rods.advance();

// shake the free nodes, so nothing is near a symmetric point
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
const lo = rods.lo[0];
const hi = rods.hi[0];
for (let i = lo; i <= hi; i++) for (let c = 0; c < 3; c++) rods.x[i * 3 + c] += rand();
// the paper's gradients hold on the inextensible manifold: edges at their rest length
rods.project(30, 1e-12);
r.updateFrames();

const energy = () => {
  // bending from the binormal; twisting from θ held fixed and the reference frame transported to the new shape
  let E = 0;
  for (let i = lo - 1; i <= hi + 1; i++) {
    const g = i * 3;
    const x = rods.x;
    const e0 = [x[g] - x[g - 3], x[g + 1] - x[g - 2], x[g + 2] - x[g - 1]];
    const e1 = [x[g + 3] - x[g], x[g + 4] - x[g + 1], x[g + 5] - x[g + 2]];
    const l0 = rods.rest[i - 1];
    const l1 = rods.rest[i];
    const D = l0 * l1 + e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2];
    const k = [
      (2 * (e0[1] * e1[2] - e0[2] * e1[1])) / D,
      (2 * (e0[2] * e1[0] - e0[0] * e1[2])) / D,
      (2 * (e0[0] * e1[1] - e0[1] * e1[0])) / D,
    ];
    E += (p.bend * (k[0] ** 2 + k[1] ** 2 + k[2] ** 2)) / (l0 + l1);
    E += (p.twist * rods.twistAt(i) ** 2) / (l0 + l1);
  }
  return E;
};

const snapshot = () => ({ t: rods.t.slice(), u: rods.u.slice(), twist: rods.refTwist.slice() });
const restore = (s: ReturnType<typeof snapshot>) => {
  rods.t.set(s.t);
  rods.u.set(s.u);
  rods.refTwist.set(s.twist);
};
/** frames follow the shape, θ does not: the derivative the paper takes at fixed θ */
const refresh = () => {
  const theta = rods.theta.slice();
  const twist = p.twist;
  p.twist = 0;
  r.updateFrames();
  p.twist = twist;
  rods.theta.set(theta);
};

r.accumulateForces();
const analytic = rods.force.slice();
let worst = 0;
const h = 1e-6;
for (const i of [lo + 2, lo + 9, hi - 2]) {
  for (let c = 0; c < 3; c++) {
    const before = snapshot();
    const value = rods.x[i * 3 + c];
    rods.x[i * 3 + c] = value + h;
    refresh();
    const up = energy();
    restore(before);
    rods.x[i * 3 + c] = value - h;
    refresh();
    const down = energy();
    restore(before);
    rods.x[i * 3 + c] = value;
    const numeric = -(up - down) / (2 * h);
    const error = Math.abs(numeric - analytic[i * 3 + c]) / (Math.abs(numeric) + 1e-3);
    worst = Math.max(worst, error);
    console.log(`node ${i} axis ${c}: analytic ${analytic[i * 3 + c].toFixed(5)}  numeric ${numeric.toFixed(5)}`);
  }
}
console.log(`worst relative error ${worst.toExponential(2)}`);
if (worst > 1e-3) process.exit(1);
