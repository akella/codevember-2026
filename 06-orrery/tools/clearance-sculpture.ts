// node --experimental-strip-types --no-warnings tools/clearance.ts
// Turns the real meshes through a full revolution and reports how close any two come.
// The three spirals are the same part turned 120 degrees, so one pair stands for all three.
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, perch, spec, spiral } from "../src/sculpture/shape.ts";

for (const pair of process.argv.slice(2)) {
  const [name, value] = pair.split("=");
  (spec as Record<string, number>)[name] = Number(value);
}
const spacing = 0.009;
const slab = 0.09; // flat parts can only come close near the other plane

function surface(geometry: BufferGeometry, place = new Matrix4()) {
  const at = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(at, index.getX(i)).applyMatrix4(place);
    b.fromBufferAttribute(at, index.getX(i + 1)).applyMatrix4(place);
    c.fromBufferAttribute(at, index.getX(i + 2)).applyMatrix4(place);
    const n = Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / spacing);
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      p.set(0, 0, 0).addScaledVector(a, u / n).addScaledVector(b, v / n).addScaledVector(c, 1 - (u + v) / n);
      if (p.length() > spec.hub) out.push(p.x, p.y, p.z);
    }
  }
  return new Float32Array(out);
}

const { at, forward, up, side } = perch();
const frame = new Matrix4().makeBasis(forward, up, side).setPosition(at);
const flap = (angle: number, sign: 1 | -1) => frame.clone().multiply(new Matrix4().makeRotationX(angle * sign));
const flaps = [-spec.flap, spec.flap];

const ribbon = surface(spiral());
const birdParts = [surface(birdBody(), frame), ...flaps.flatMap((f) => [surface(birdWing(1), flap(f, 1)), surface(birdWing(-1), flap(f, -1))])];
const bird = Float32Array.from(birdParts.flatMap((p) => [...p]));
const body = Float32Array.from([...ribbon, ...bird]);
const owner = new Uint8Array(body.length / 3).fill(1, ribbon.length / 3);

const cell = 0.06;
const key = (x: number, y: number, z: number) => (Math.floor(x / cell) + 512) * 1048576 + (Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;
const turned = (angle: number) => {
  const out = new Float32Array(body.length);
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < body.length; i += 3) {
    out[i] = c * body[i] - s * body[i + 1];
    out[i + 1] = s * body[i] + c * body[i + 1];
    out[i + 2] = body[i + 2];
  }
  return out;
};

const step = 2;
let closest = { gap: Infinity, angle: 0, kinds: "", where: [0, 0, 0] };
for (let degrees = 0; degrees < 360; degrees += step) {
  const a = turned((degrees * Math.PI) / 180);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < a.length; i += 3) {
    if (!owner[i / 3] && Math.abs(a[i] - spec.offset) > slab) continue;
    const k = key(a[i], a[i + 1], a[i + 2]);
    const list = grid.get(k);
    if (list) list.push(i); else grid.set(k, [i]);
  }
  // the same body, moved to the x plane: (x, y, z) -> (z, x, y)
  for (let j = 0; j < a.length; j += 3) {
    const x = a[j + 2], y = a[j], z = a[j + 1];
    if (!owner[j / 3] && Math.abs(z - spec.offset) > slab) continue;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) {
      const list = grid.get((cx + i + 512) * 1048576 + (cy + k + 512) * 1024 + cz + l + 512);
      if (!list) continue;
      for (const n of list) {
        const gap = Math.hypot(a[n] - x, a[n + 1] - y, a[n + 2] - z);
        if (gap < closest.gap) closest = { gap, angle: degrees, kinds: `${owner[n / 3] ? "bird" : "ribbon"} / ${owner[j / 3] ? "bird" : "ribbon"}`, where: [x, y, z] };
      }
    }
  }
}
console.log(`spiral to spiral: ${closest.gap.toFixed(4)} at ${closest.angle} degrees, ${closest.kinds}, at ${closest.where.map((v) => v.toFixed(3))}, ${Math.hypot(...closest.where).toFixed(3)} from the centre`);

// Anything spinning against what stands still: with the hub's axis vertical, how low and how far out.
const axis = new Vector3(1, 1, 1).normalize();
const lift = new Quaternion().setFromUnitVectors(axis, new Vector3(0, 1, 0));
let lowest = Infinity, tightest = Infinity, tightAt = 0;
const v = new Vector3();
const stand = { neck: 0.06, drumTop: -0.5, drum: 0.28 };
for (let degrees = 0; degrees < 360; degrees += 2) {
  const a = turned((degrees * Math.PI) / 180);
  for (let i = 0; i < a.length; i += 3) {
    v.set(a[i], a[i + 1], a[i + 2]).applyQuaternion(lift);
    lowest = Math.min(lowest, v.y);
    if (v.y < 0) {
      const out = Math.hypot(v.x, v.z) - (v.y < stand.drumTop ? stand.drum : stand.neck);
      if (out < tightest) { tightest = out; tightAt = v.y; }
    }
  }
}
console.log(`lowest point ${lowest.toFixed(3)}, closest to the stand ${tightest.toFixed(4)} at height ${tightAt.toFixed(3)}`);
