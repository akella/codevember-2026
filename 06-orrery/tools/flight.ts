// node --experimental-strip-types --no-warnings tools/flight.ts [curve] [orbits] [dive] [object speed] [steps] [density] [width] [wing]
// Flies the real loop and reports the nearest anything comes to the lens, and what it was. Every level
// that can reach the camera, all three spirals, wings at both ends of the beat, at every step.
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, dodge, eyesFrom, flatten, foldAt, fit, flightAt, flying, layerTurn, perch, ratio, shellLead, spec, spiral } from "../src/shape.ts";

const [curve = flying.curve, orbits = flying.orbits, levels = 4, pace = 1, steps = 2100, density = 1.49, width = 0.12, wing = 1.27] = process.argv.slice(2).map(Number);
flying.curve = curve; flying.orbits = orbits;

// the shipped defaults
spec.growth /= density; spec.width = width; spec.wing = wing; spec.layered = 1;
fit();
spec.lead = Math.max(spec.lead, shellLead());
spec.drift = pace / levels;
spec.turn = ((173 * Math.PI) / 180) * spec.drift; spec.tilt = (25 * Math.PI) / 180;
spec.settle = Number(process.env.SETTLE ?? spec.settle);
const t0 = performance.now();
const plan = dodge(eyesFrom(new Vector3(0.14, 0.09, 1.75)), levels, pace);
console.log(`dodge took ${(performance.now() - t0).toFixed(0)}ms, chose phase ${plan.phase.toFixed(2)}, expected ${plan.gap.toFixed(3)}`);

const take = (g: BufferGeometry, place = new Matrix4()) => {
  const at = g.getAttribute("position"), v = new Vector3(), out: number[] = [];
  for (let i = 0; i < at.count; i += 2) { v.fromBufferAttribute(at, i).applyMatrix4(place); out.push(v.x, v.y, v.z); }
  return out;
};
const { at, forward, up, side } = perch();
const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);
const hinge = (a: number) => seat.clone().multiply(new Matrix4().makeRotationX(a));
const ribbon = take(spiral());
const bird = [...take(birdBody(), seat), ...[-spec.upstroke, spec.downstroke].flatMap((f) => [...take(birdWing(1), hinge(f)), ...take(birdWing(-1), hinge(-f))])];
const level = Float32Array.from([...ribbon, ...bird]);

const axis = new Vector3(1, 1, 1).normalize();
const upright = new Quaternion().setFromUnitVectors(axis, new Vector3(0, 0, 1));
const thirds = [0, 1, 2].map((i) => new Quaternion().setFromAxisAngle(axis, (i * Math.PI * 2) / 3));
const per = Math.log(ratio());
const m = new Matrix4(), q = new Quaternion(), spin = new Quaternion(), s = new Vector3(), zero = new Vector3();
const Z = new Vector3(0, 0, 1);

const eyes = eyesFrom(new Vector3(0.14, 0.09, 1.75)).map((e) => e.toArray());
const nearest = eyes.map(() => ({ gap: Infinity, t: 0, what: "" }));
const path = flightAt(0, 1);
for (let step = 0; step < steps; step++) {
  const t = step / steps;
  const passed = t * levels, whole = Math.floor(passed), through = passed - whole;
  flightAt(t, levels * per, path);
  spin.setFromAxisAngle(Z, t * pace * Math.PI * 2);
  for (let k = 0; k <= Math.ceil(Math.log(30) / per); k++) {
    const place = k + through;
    const size = Math.exp(per * place) * path.scale;
    const folded = foldAt(place, t);
    const turn = layerTurn(place, (k - whole) % 2 !== 0, undefined, folded).multiply(upright);
    const fold = flatten(folded);
    for (const third of thirds) {
      q.copy(path.turn).multiply(turn).multiply(third).multiply(fold).multiply(spin);
      m.compose(zero, q, s.setScalar(size));
      const e = m.elements;
      for (let i = 0; i < level.length; i += 3) {
        const a = level[i], b = level[i + 1], c = level[i + 2];
        const x = e[0] * a + e[4] * b + e[8] * c, y = e[1] * a + e[5] * b + e[9] * c, z = e[2] * a + e[6] * b + e[10] * c;
        for (let j = 0; j < eyes.length; j++) {
          const [ex, ey, ez] = eyes[j];
          const d = (x - ex) * (x - ex) + (y - ey) * (y - ey) + (z - ez) * (z - ez);
          if (d < nearest[j].gap) nearest[j] = { gap: d, t, what: i >= ribbon.length ? "bird" : "ribbon" };
        }
      }
    }
  }
}
nearest.forEach((n, j) => console.log(`${j ? `dragged ${j}` : "as flown "}: nearest ${Math.sqrt(n.gap).toFixed(3)}, a ${n.what}, at ${n.t.toFixed(3)} of the loop`));
