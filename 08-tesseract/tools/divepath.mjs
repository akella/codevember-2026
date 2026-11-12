// Search radial dive lines for clearance. Self-similar, so one level (|p| from 1 down to s) covers the
// whole infinite dive. Clearance is min over the segment of distance / |p|.
import { makeField } from "./field.mjs";
const s = +(process.argv[2] ?? 0.5);
const w = +(process.argv[3] ?? 0.015);
const map = makeField({ s, w, walls: false, margin: 1e9 });
const pix = (2 * Math.tan((31 * Math.PI) / 180)) / 540; // rough traced pixel
const clearance = (dir) => {
  let worst = Infinity;
  const m = Math.max(...dir.map(Math.abs));
  for (let k = 0; k <= 200; k++) {
    const c = Math.pow(s, k / 200);
    const p = dir.map((x) => (x / m) * c);
    const r = Math.hypot(...p);
    const d = map(p, pix * 0.05 * r).d;
    worst = Math.min(worst, d / r);
  }
  return worst;
};
const best = [];
for (let i = 0; i < 4000; i++) {
  // directions in the +x frustum, one octant by symmetry
  const y = Math.random(), z = Math.random() * y;
  const dir = [1, y, z];
  best.push({ dir, c: clearance(dir) });
}
best.sort((a, b) => b.c - a.c);
console.log("axis", clearance([1, 0, 0]).toFixed(4));
for (const b of best.slice(0, 12)) console.log(b.dir.map((x) => x.toFixed(4)).join(", "), b.c.toFixed(4));
