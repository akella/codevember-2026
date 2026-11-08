// node --experimental-strip-types --no-warnings tools/clearance.ts
// The piece has no size, so a gap only means something as a share of how far out it is: the same
// share holds at every level, for ever. So one level is tested against its neighbours, through a full
// revolution, using the real meshes, and then the camera's line is checked. This is a coarse sweep:
// it samples every 2% of radius, so it can't resolve a pass finer than that. tools/wings.ts can.
import { Matrix4, Quaternion, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, perch, ratio, spec, spiral } from "../src/shape.ts";

const fineness = 0.02; // sample spacing as a share of radius

function surface(geometry: BufferGeometry, place = new Matrix4()) {
  const at = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(at, index.getX(i)).applyMatrix4(place);
    b.fromBufferAttribute(at, index.getX(i + 1)).applyMatrix4(place);
    c.fromBufferAttribute(at, index.getX(i + 2)).applyMatrix4(place);
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (fineness * a.length())));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      p.set(0, 0, 0).addScaledVector(a, u / n).addScaledVector(b, v / n).addScaledVector(c, 1 - (u + v) / n);
      out.push(p.x, p.y, p.z);
    }
  }
  return out;
}

const { at, forward, up, side } = perch();
const seat = new Matrix4().makeBasis(forward, up, side).setPosition(at);
const flapped = (angle: number) => seat.clone().multiply(new Matrix4().makeRotationX(angle));
const ribbon = surface(spiral());
const bird = [...surface(birdBody(), seat), ...[-spec.upstroke, spec.downstroke].flatMap((f) => [...surface(birdWing(1), flapped(f)), ...surface(birdWing(-1), flapped(-f))])];
const level = Float32Array.from([...ribbon, ...bird]);
const isBird = (i: number) => i >= ribbon.length;
console.log(`${level.length / 3} points a level, ${ratio().toFixed(3)} times larger each level`);

const scaled = (k: number) => level.map((v) => v * ratio() ** k);
const others = [-1, 0, 1].map((k) => ({ k, points: scaled(k) }));

const cell = 0.05; // pairs further apart than this are never compared, and the report says so
const shell = 0.2; // one level spans this much radius: anything smaller repeats what is tested here
const hash = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + z + 512;
const slab = 0.06;
let worst = { share: Infinity, degrees: 0, kinds: "", radius: 0 };
for (let degrees = 0; degrees < 360; degrees += 5) {
  const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
  const grid = new Map<number, number[]>();
  const here = new Float32Array(level.length);
  for (let i = 0; i < level.length; i += 3) {
    here[i] = c * level[i] - s * level[i + 1];
    here[i + 1] = s * level[i] + c * level[i + 1];
    here[i + 2] = level[i + 2];
    if (!isBird(i) && (Math.abs(here[i]) > slab || Math.hypot(here[i], here[i + 1]) < shell)) continue; // flat parts only come close near the other plane
    const key = hash(Math.floor(here[i] / cell), Math.floor(here[i + 1] / cell), Math.floor(here[i + 2] / cell));
    const list = grid.get(key);
    if (list) list.push(i); else grid.set(key, [i]);
  }
  for (const { k, points } of others) {
    for (let j = 0; j < points.length; j += 3) {
      // the same part in the next plane round: (x, y, z) -> (z, x, y)
      const px = c * points[j] - s * points[j + 1], py = s * points[j] + c * points[j + 1], pz = points[j + 2];
      const x = pz, y = px, z = py;
      if (!isBird(j) && (Math.abs(z) > slab || Math.hypot(px, py) < shell / 2)) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const list = grid.get(hash(gx + a, gy + b, gz + d));
        if (!list) continue;
        for (const n of list) {
          const radius = Math.hypot(here[n], here[n + 1], here[n + 2]);
          const share = Math.hypot(here[n] - x, here[n + 1] - y, here[n + 2] - z) / radius;
          if (share < worst.share) worst = { share, degrees, kinds: `${isBird(n) ? "bird" : "ribbon"} / ${isBird(j) ? "bird" : "ribbon"} ${k}`, radius };
        }
      }
    }
  }
}
console.log(worst.share === Infinity ? `nothing came within ${cell}` : `closest pass: ${(worst.share * 100).toFixed(2)}% of its radius, ${worst.kinds}, at ${worst.degrees} degrees, radius ${worst.radius.toFixed(3)}`);

// The camera sits still while all of this grows past it, one level per loop, in each of the three planes.
const eye = new Vector3(0.14, 0.09, 1.75).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(1, 1, 1).normalize(), new Vector3(0, 0, 1)).invert());
let nearest = { gap: Infinity, kind: "" };
const spins = 1;
const views = [eye.toArray(), [eye.y, eye.z, eye.x], [eye.z, eye.x, eye.y]];
for (let step = 0; step < 90; step++) {
  const t = step / 90;
  const angle = t * spins * Math.PI * 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let k = -2; k <= 3; k++) {
    const size = ratio() ** (k + t);
    for (let i = 0; i < level.length; i += 3) {
      const x = (c * level[i] - s * level[i + 1]) * size, y = (s * level[i] + c * level[i + 1]) * size, z = level[i + 2] * size;
      for (const [ex, ey, ez] of views) {
        const gap = Math.hypot(x - ex, y - ey, z - ez);
        if (gap < nearest.gap) nearest = { gap, kind: isBird(i) ? "bird" : "ribbon" };
      }
    }
  }
}
console.log(`nearest anything comes to the camera: ${nearest.gap.toFixed(3)}, a ${nearest.kind}`);
