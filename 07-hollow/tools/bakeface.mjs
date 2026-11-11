// node tools/bakeface.mjs [field name] [step]: meshes a baked distance field (from day 3, public/sdf/<name>)
// once, for cagemesh.html, and writes public/<name>-mesh.bin and .json.
//
// Surface nets: a vertex in every cell the surface passes through, at the mean of where it crosses the
// cell's edges, and a quad across every edge whose ends differ in sign. Normals from the field's
// gradient. Centred on its deepest point inside and scaled so its furthest point is 1 from there: a cage's
// holes are placed by direction from the middle, and a cage's size is its reach.
// `step` samples every n-th cell, for a lighter mesh.
import fs from "node:fs";
import zlib from "node:zlib";

const [name = "me-256", stepArg = "1"] = process.argv.slice(2);
const step = Number(stepArg);
const dir = new URL("../public/", import.meta.url).pathname;
const meta = JSON.parse(fs.readFileSync(`${dir}sdf/${name}.json`));
// undo day 3's packing: gzip, then each value added on to the last
const planes = zlib.gunzipSync(fs.readFileSync(`${dir}sdf/${name}.field`));
const count = planes.length / 2;
const half = new Uint16Array(count);
let last = 0;
for (let i = 0; i < count; i++) half[i] = last = (last + ((planes[i] << 8) | planes[count + i])) & 0xffff;
const toFloat = (h) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15);
};
const [NX, NY, NZ] = meta.dims;
const field = new Float32Array(count);
for (let i = 0; i < count; i++) field[i] = toFloat(half[i]);
const at = (x, y, z) => field[(Math.min(z, NZ - 1) * NY + Math.min(y, NY - 1)) * NX + Math.min(x, NX - 1)];

const nx = Math.floor((NX - 1) / step), ny = Math.floor((NY - 1) / step), nz = Math.floor((NZ - 1) / step);
const value = (x, y, z) => at(x * step, y * step, z * step);
const cellIndex = (x, y, z) => (z * ny + y) * nx + x;
const vertexOf = new Int32Array(nx * ny * nz).fill(-1);
const positions = [];
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const v = new Float32Array(8);
for (let z = 0; z < nz - 1; z++)
  for (let y = 0; y < ny - 1; y++)
    for (let x = 0; x < nx - 1; x++) {
      let inside = 0;
      for (let k = 0; k < 8; k++) {
        v[k] = value(x + corners[k][0], y + corners[k][1], z + corners[k][2]);
        if (v[k] < 0) inside++;
      }
      if (inside === 0 || inside === 8) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of edges) {
        if (v[a] < 0 === v[b] < 0) continue;
        const t = v[a] / (v[a] - v[b]);
        sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
        sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
        sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
        n++;
      }
      vertexOf[cellIndex(x, y, z)] = positions.length / 3;
      positions.push(x + sx / n, y + sy / n, z + sz / n);
    }
// quads across sign-changing edges, wound so the outside (positive) is in front
const index = [];
const quad = (a, b, c, d, flip) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  if (flip) index.push(a, b, c, a, c, d);
  else index.push(a, c, b, a, d, c);
};
for (let z = 1; z < nz - 1; z++)
  for (let y = 1; y < ny - 1; y++)
    for (let x = 1; x < nx - 1; x++) {
      const here = value(x, y, z) < 0;
      if (here !== value(x + 1, y, z) < 0) quad(vertexOf[cellIndex(x, y - 1, z - 1)], vertexOf[cellIndex(x, y, z - 1)], vertexOf[cellIndex(x, y, z)], vertexOf[cellIndex(x, y - 1, z)], here);
      if (here !== value(x, y + 1, z) < 0) quad(vertexOf[cellIndex(x - 1, y, z - 1)], vertexOf[cellIndex(x - 1, y, z)], vertexOf[cellIndex(x, y, z)], vertexOf[cellIndex(x, y, z - 1)], here);
      if (here !== value(x, y, z + 1) < 0) quad(vertexOf[cellIndex(x - 1, y - 1, z)], vertexOf[cellIndex(x, y - 1, z)], vertexOf[cellIndex(x, y, z)], vertexOf[cellIndex(x - 1, y, z)], here);
    }

// grid units to the field's world, normals from the field's gradient there (trilinear)
const sample = (gx, gy, gz) => {
  const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
  const fx = gx - x0, fy = gy - y0, fz = gz - z0;
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const [cx, cy, cz] = corners[k];
    s += at(x0 + cx, y0 + cy, z0 + cz) * (cx ? fx : 1 - fx) * (cy ? fy : 1 - fy) * (cz ? fz : 1 - fz);
  }
  return s;
};
const n = positions.length / 3;
const world = new Float32Array(n * 3), normals = new Float32Array(n * 3);
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n; i++) {
  const gx = positions[i * 3] * step, gy = positions[i * 3 + 1] * step, gz = positions[i * 3 + 2] * step;
  const p = [meta.origin[0] + gx * meta.cell, meta.origin[1] + gy * meta.cell, meta.origin[2] + gz * meta.cell];
  for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], p[a])), (hi[a] = Math.max(hi[a], p[a]));
  world.set(p, i * 3);
  const e = 0.75;
  const g = [sample(gx + e, gy, gz) - sample(gx - e, gy, gz), sample(gx, gy + e, gz) - sample(gx, gy - e, gz), sample(gx, gy, gz + e) - sample(gx, gy, gz - e)];
  const l = Math.hypot(...g) || 1;
  normals.set(g.map((c) => c / l), i * 3);
}
// the middle: the deepest point inside, the centre of the biggest ball that fits, so the cage inside it
// (a fixed share of its size) sits clear of the skin all round
let deepest = 0, centre = lo.map((l, a) => (l + hi[a]) / 2);
for (let z = 0; z < NZ; z++)
  for (let y = 0; y < NY; y++)
    for (let x = 0; x < NX; x++) {
      const d = field[(z * NY + y) * NX + x];
      if (d < deepest) (deepest = d), (centre = [meta.origin[0] + x * meta.cell, meta.origin[1] + y * meta.cell, meta.origin[2] + z * meta.cell]);
    }
let reach = 0, nearest = Infinity;
for (let i = 0; i < n; i++) {
  const r = Math.hypot(world[i * 3] - centre[0], world[i * 3 + 1] - centre[1], world[i * 3 + 2] - centre[2]);
  reach = Math.max(reach, r);
  nearest = Math.min(nearest, r);
}
for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) world[i * 3 + a] = (world[i * 3 + a] - centre[a]) / reach;

const indices = new Uint32Array(index);
const out = Buffer.concat([Buffer.from(world.buffer), Buffer.from(normals.buffer), Buffer.from(indices.buffer)]);
fs.writeFileSync(`${dir}${name}-mesh.bin`, out);
fs.writeFileSync(`${dir}${name}-mesh.json`, JSON.stringify({ vertices: n, indices: indices.length, nearest: nearest / reach, centre }));
console.log(`${name}: ${n} vertices, ${indices.length / 3} triangles, ${(out.length / 1e6).toFixed(1)} MB; nearest point ${(nearest / reach).toFixed(3)} of its reach from the middle`);
