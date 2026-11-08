// node --experimental-strip-types --no-warnings tools/crossing.ts [density] [width]
// The closest two ribbons ever come, measured finely. Each pass repeats a turn further out at the same
// share of radius, so one crossing, swept in small steps around its tightest moment, answers for all.
import { Vector3 } from "three/webgpu";
import { spec, spiral } from "../src/shape.ts";

const [density = 1.49, width = 0.12] = process.argv.slice(2).map(Number);
spec.growth /= density;
spec.width = width;

const spacing = 0.0016;
function sample(lo: number, hi: number) {
  const geometry = spiral();
  const at = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(at, index.getX(i));
    if (a.length() < lo || a.length() > hi) continue;
    b.fromBufferAttribute(at, index.getX(i + 1));
    c.fromBufferAttribute(at, index.getX(i + 2));
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / spacing));
    for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
      p.set(0, 0, 0).addScaledVector(a, u / n).addScaledVector(b, v / n).addScaledVector(c, 1 - (u + v) / n);
      out.push(p.x, p.y, p.z);
    }
  }
  return Float32Array.from(out);
}

const ribbon = sample(0.55, 1);
const cell = 0.012;
const hash = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + z + 512;
let best = { share: Infinity, degrees: 0, plane: "" };
const sweep = (from: number, to: number, step: number) => {
  for (let degrees = from; degrees < to; degrees += step) {
    const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
    const grid = new Map<number, number[]>();
    const here = new Float32Array(ribbon.length);
    for (let i = 0; i < ribbon.length; i += 3) {
      here[i] = c * ribbon[i] - s * ribbon[i + 1];
      here[i + 1] = s * ribbon[i] + c * ribbon[i + 1];
      here[i + 2] = ribbon[i + 2];
      if (Math.abs(here[i]) > 0.02) continue;
      const key = hash(Math.floor(here[i] / cell), Math.floor(here[i + 1] / cell), Math.floor(here[i + 2] / cell));
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    }
    for (let j = 0; j < here.length; j += 3) {
      const x = here[j + 2], y = here[j], z = here[j + 1];
      if (Math.abs(z) > 0.02) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const list = grid.get(hash(gx + a, gy + b, gz + d));
        if (!list) continue;
        for (const n of list) {
          const share = Math.hypot(here[n] - x, here[n + 1] - y, here[n + 2] - z) / Math.hypot(here[n], here[n + 1], here[n + 2]);
          if (share < best.share) best = { share, degrees, plane: "" };
        }
      }
    }
  }
};
sweep(0, 360, 2);
console.log(`coarse: ${(best.share * 100).toFixed(3)}% at ${best.degrees} degrees`);
const around = best.degrees;
sweep(around - 3, around + 3, 0.1);
console.log(`fine: ${(best.share * 100).toFixed(3)}% of radius at ${best.degrees.toFixed(1)} degrees, sampled every ${(spacing * 100).toFixed(2)}%`);
