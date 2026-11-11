// node tools/prepmesh.mjs <dir> <name>: takes a statue baked for the "prepare sdf stream" demo (<name>.mesh,
// MSH1, and <name>.sdf, SDF1, from its tools/bake.py, in the same space) and writes it for cagemesh.html
// as public/<name>-mesh.bin and .json, the same layout tools/bakeface.mjs writes: positions centred on the
// deepest point inside (the centre of the biggest ball that fits, from the field) and scaled so the
// furthest is 1, then normals, then indices.
import fs from "node:fs";

const [dir, name] = process.argv.slice(2);
const half = (h) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15);
};
const sdf = fs.readFileSync(`${dir}/${name}.sdf`);
const dims = [4, 8, 12].map((o) => sdf.readUInt32LE(o));
const lo = [16, 20, 24].map((o) => sdf.readFloatLE(o)), hi = [28, 32, 36].map((o) => sdf.readFloatLE(o));
const [nx, ny, nz] = dims;
let deepest = 0, centre = [0, 0, 0];
for (let z = 0; z < nz; z++)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const d = half(sdf.readUInt16LE(40 + 2 * ((z * ny + y) * nx + x)));
      if (d < deepest) (deepest = d), (centre = [x, y, z].map((v, a) => lo[a] + ((v + 0.5) / dims[a]) * (hi[a] - lo[a])));
    }

const mesh = fs.readFileSync(`${dir}/${name}.mesh`);
const V = mesh.readUInt32LE(4), I = mesh.readUInt32LE(8);
const floats = (offset, count) => new Float32Array(mesh.buffer.slice(mesh.byteOffset + offset, mesh.byteOffset + offset + count * 4));
const position = floats(12, V * 3);
const normal = floats(12 + V * 12, V * 3);
const index = new Uint32Array(mesh.buffer.slice(mesh.byteOffset + 12 + V * 28, mesh.byteOffset + 12 + V * 28 + I * 4));
let reach = 0, nearest = Infinity;
for (let v = 0; v < V; v++) {
  for (let a = 0; a < 3; a++) position[v * 3 + a] -= centre[a];
  const r = Math.hypot(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
  reach = Math.max(reach, r);
  nearest = Math.min(nearest, r);
}
for (let i = 0; i < position.length; i++) position[i] /= reach;

const out = new URL("../public/", import.meta.url).pathname;
fs.writeFileSync(`${out}${name}-mesh.bin`, Buffer.concat([Buffer.from(position.buffer), Buffer.from(normal.buffer), Buffer.from(index.buffer)]));
fs.writeFileSync(`${out}${name}-mesh.json`, JSON.stringify({ vertices: V, indices: I, nearest: nearest / reach, centre }));
console.log(`${name}: ${V} vertices, ${I / 3} triangles; nearest ${(nearest / reach).toFixed(3)} of its reach from its deepest point`);
