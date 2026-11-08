// node --experimental-strip-types --no-warnings tools/wings.ts [name=value ...]
// Wings leave their own plane, so the spiral argument says nothing about them. This is the fine check:
// one bird, at every point of its flap, against the ribbons of the next plane round, as they spin.
import { Matrix4, Vector3, type BufferGeometry } from "three/webgpu";
import { birdBody, birdWing, fit, perch, ratio, shellLead, spec, spiral } from "../src/shape.ts";

for (const pair of process.argv.slice(2)) {
  const [name, value] = pair.split("=");
  (spec as Record<string, number>)[name] = Number(value);
}

if (spec.layered) {
  fit();
  spec.lead = Math.max(spec.lead, shellLead());
}
console.log(`beat ${(-spec.upstroke).toFixed(2)} to ${spec.downstroke.toFixed(2)}${spec.layered ? ", layered" : ""}`);

function surface(geometry: BufferGeometry, spacing: number, place = new Matrix4(), keep = (_: Vector3) => true) {
  const at = geometry.getAttribute("position");
  const index = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  const out: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(at, index.getX(i)).applyMatrix4(place);
    b.fromBufferAttribute(at, index.getX(i + 1)).applyMatrix4(place);
    c.fromBufferAttribute(at, index.getX(i + 2)).applyMatrix4(place);
    if (!keep(a)) continue;
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
const near = (v: Vector3) => v.length() > 0.7 && v.length() < 1.7;
const scale = (k: number) => new Matrix4().makeScale(ratio() ** k, ratio() ** k, ratio() ** k);
// as separate shells, a level only ever meets its own ribbons
const ribbons = Float32Array.from([...surface(spiral(), 0.0035, scale(0), near), ...(spec.layered ? [] : surface(spiral(), 0.0035, scale(1), near))]);

const cell = 0.03;
const hash = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + z + 512;
let worst = { gap: Infinity, flap: 0, degrees: 0, part: "", neighbour: "" };
const angles = [-spec.upstroke, (spec.downstroke - spec.upstroke) / 2, spec.downstroke];
for (const f of angles) {
  const before = worst.gap;
  worst.gap = Infinity;
  const hinge = (a: number) => seat.clone().multiply(new Matrix4().makeRotationX(a));
  const parts: [string, number[]][] = [...(f === angles[0] ? [["ribbon", surface(spiral(), 0.006, new Matrix4(), (v) => v.length() > 0.75 && v.length() < 1)] as [string, number[]]] : []), ["body", surface(birdBody(), 0.005, seat)], ["wing", [...surface(birdWing(1), 0.005, hinge(f)), ...surface(birdWing(-1), 0.005, hinge(-f))]]];
  for (const [part, points] of parts) {
    // the bird stays still and the other plane's ribbons turn: only the difference counts, both spin alike
    const grid = new Map<number, number[]>();
    for (let i = 0; i < points.length; i += 3) {
      const key = hash(Math.floor(points[i] / cell), Math.floor(points[i + 1] / cell), Math.floor(points[i + 2] / cell));
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    }
    const bx = points, n = ribbons.length;
    // the spirals have a handedness, so the planes either side of a bird are not mirror images
    for (const neighbour of ["next", "previous"])
    for (let degrees = 0; degrees < 360; degrees += 0.5) {
      const angle = (degrees * Math.PI) / 180;
      const c = Math.cos(angle), s = Math.sin(angle);
      // bird in plane z turned by -angle, ribbon in plane x turned by +angle: put both in the bird's frame
      for (let j = 0; j < n; j += 3) {
        const u = c * ribbons[j] - s * ribbons[j + 1], v = s * ribbons[j] + c * ribbons[j + 1], w = ribbons[j + 2];
        // ribbon's frame -> its plane: (u, v, w) -> (w, u, v) or (v, w, u), then undo the bird's own spin
        const wx = neighbour === "next" ? w : v, wy = neighbour === "next" ? u : w, wz = neighbour === "next" ? v : u;
        const x = c * wx + s * wy, y = -s * wx + c * wy, z = wz;
        if (Math.abs(z) > 0.4) continue;
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell), gz = Math.floor(z / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
          const list = grid.get(hash(gx + a, gy + b, gz + d));
          if (!list) continue;
          for (const i of list) {
            const gap = Math.hypot(bx[i] - x, bx[i + 1] - y, bx[i + 2] - z);
            if (gap < worst.gap) worst = { gap, flap: f, degrees, part, neighbour };
          }
        }
      }
    }
  }
  console.log(`wing at ${f.toFixed(2)}: ${worst.gap === Infinity ? "over 3% of the bird's size" : `${(worst.gap * 100).toFixed(2)}% of the bird's size, the ${worst.part}, ${worst.neighbour} plane, at ${worst.degrees} degrees`}`);
  worst.gap = Math.min(before, worst.gap);
}
console.log(worst.gap === Infinity ? `nothing within ${cell} of a bird` : `closest to a bird, over the whole flap: ${(worst.gap * 100).toFixed(2)}% of its size`);
