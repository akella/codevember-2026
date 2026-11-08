// node --experimental-strip-types --no-warnings tools/flatten.ts [density] [width] [wing]
// Folding the three planes of a level down into one: is there a point on the way where two spirals of
// the same level touch? Layers are separate shells, so a level only meets itself. Real meshes, every
// part, wings at both ends of the beat, at every spin, for each step of the fold.
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, fit, flatten, perch, shellLead, spec, spiral } from "../src/shape.ts";

const [density = 1.49, width = 0.12, wing = 1.27] = process.argv.slice(2).map(Number);
spec.growth /= density; spec.width = width; spec.wing = wing; spec.layered = 1;
fit();
spec.lead = Math.max(spec.lead, shellLead());

function surface(geometry: BufferGeometry, spacing: number, place = new Matrix4()) {
  const at = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(at, index.getX(i)).applyMatrix4(place);
    b.fromBufferAttribute(at, index.getX(i + 1)).applyMatrix4(place);
    c.fromBufferAttribute(at, index.getX(i + 2)).applyMatrix4(place);
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / spacing));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      p.set(0, 0, 0).addScaledVector(a, u / n).addScaledVector(b, v / n).addScaledVector(c, 1 - (u + v) / n);
      out.push(p.x, p.y, p.z);
    }
  }
  return out;
}

const { at, forward, up, side } = perch();
const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);
const hinge = (a: number) => seat.clone().multiply(new Matrix4().makeRotationX(a));
const step = Number(process.env.SPACING ?? 0.007);
const level = (flap: number) => Float32Array.from([
  ...surface(spiral(), step),
  ...surface(birdBody(), step, seat),
  ...surface(birdWing(1), step, hinge(flap)),
  ...surface(birdWing(-1), step, hinge(-flap)),
]);
const poses = [-spec.upstroke, spec.downstroke].map(level);
console.log(`${poses[0].length / 3} points a pose`);

const axis = new Vector3(1, 1, 1).normalize();
const third = new Quaternion().setFromAxisAngle(axis, (Math.PI * 2) / 3);
const Z = new Vector3(0, 0, 1);
const cell = 0.03;
const key = (x: number, y: number, z: number) => (Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;

// spiral 0 against spiral 1; the other pairs are the same pair turned a third. Spiral 0's points stay
// put in a grid, and spiral 1 is brought into its frame.
const grids = poses.map((a) => {
  const grid = new Map<number, number[]>();
  for (let i = 0; i < a.length; i += 3) {
    const k = key(a[i], a[i + 1], a[i + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  return grid;
});
const fold = new Quaternion(), spin = new Quaternion(), q0 = new Quaternion(), q1 = new Quaternion(), rel = new Quaternion();
const p = new Vector3();
let overall = { gap: Infinity, s: 0, degrees: 0 };
for (let s = 0; s <= 1.0001; s += 0.1) {
  flatten(s, fold);
  let worst = Infinity;
  for (let degrees = 0; degrees < 360; degrees += 3) {
    spin.setFromAxisAngle(Z, (degrees * Math.PI) / 180);
    q0.copy(fold).multiply(spin);
    q1.copy(third).multiply(fold).multiply(spin);
    rel.copy(q0).invert().multiply(q1);
    poses.forEach((a, ai) => poses.forEach((b) => {
      const grid = grids[ai];
      for (let j = 0; j < b.length; j += 3) {
        p.set(b[j], b[j + 1], b[j + 2]).applyQuaternion(rel);
        if (Math.abs(p.z) > 0.35) continue;
        const r = p.length();
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), gz = Math.floor(p.z / cell);
        for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) {
          const list = grid.get((gx + u + 512) * 1048576 + (gy + v + 512) * 1024 + gz + w + 512);
          if (list) for (const i of list) {
            const gap = Math.hypot(a[i] - p.x, a[i + 1] - p.y, a[i + 2] - p.z) / r;
            if (gap < worst) worst = gap;
            if (gap < overall.gap) overall = { gap, s, degrees };
          }
        }
      }
    }));
  }
  console.log(`fold ${s.toFixed(1)}: closest ${worst === Infinity ? "clear by a cell" : (worst * 100).toFixed(2) + "% of radius"}`);
}
console.log(`worst ${(overall.gap * 100).toFixed(2)}% at fold ${overall.s.toFixed(1)}, spin ${overall.degrees} degrees (sampled every ${step}, so true gaps are up to about that less)`);
