// node tools/fitstatue.mjs <in_basename> <out_basename> [height=2.12] [floor=0]: takes a statue baked by
// the "prepare sdf stream" demo's tools/bake.py (<in>.sdf, SDF1, and <in>.mesh, MSH1, in the same space) and
// refits both to fill.html's space, as Venus is: this tall, standing on this floor, centred on the y axis.
// Positions, the field's box and its distances (and the mesh's thickness) all scale together.
import fs from "node:fs";

const [src, out, height = "2.12", floor = "0"] = process.argv.slice(2);
const toFloat = (h) => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15);
};
const toHalf = (f) => {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, f);
  const x = b.getUint32(0), sign = (x >> 16) & 0x8000, e = ((x >> 23) & 255) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return sign | ((m | 0x800000) >> (14 - e)) >> 0;
  if (e >= 31) return sign | 0x7c00;
  return sign | (e << 10) | ((m + 0x1000) >> 13);
};

const mesh = fs.readFileSync(`${src}.mesh`);
const V = mesh.readUInt32LE(4), I = mesh.readUInt32LE(8);
const pos = new Float32Array(mesh.buffer.slice(mesh.byteOffset + 12, mesh.byteOffset + 12 + V * 12));
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], pos[v * 3 + a])), (hi[a] = Math.max(hi[a], pos[v * 3 + a]));
const scale = +height / (hi[1] - lo[1]);
const shift = [-((lo[0] + hi[0]) / 2) * scale, +floor - lo[1] * scale, -((lo[2] + hi[2]) / 2) * scale];
const fit = (p, a) => p * scale + shift[a];

// the mesh: positions moved, normals as they were, thickness scaled
const outMesh = Buffer.from(mesh);
for (let v = 0; v < V; v++) for (let a = 0; a < 3; a++) outMesh.writeFloatLE(fit(pos[v * 3 + a], a), 12 + (v * 3 + a) * 4);
for (let v = 0; v < V; v++) outMesh.writeFloatLE(mesh.readFloatLE(12 + V * 24 + v * 4) * scale, 12 + V * 24 + v * 4);

// the field: its box moved, its distances scaled
const sdf = fs.readFileSync(`${src}.sdf`);
const outSdf = Buffer.from(sdf);
for (let a = 0; a < 3; a++) {
  outSdf.writeFloatLE(fit(sdf.readFloatLE(16 + a * 4), a), 16 + a * 4);
  outSdf.writeFloatLE(fit(sdf.readFloatLE(28 + a * 4), a), 28 + a * 4);
}
const n = [4, 8, 12].map((o) => sdf.readUInt32LE(o)).reduce((x, y) => x * y);
for (let k = 0; k < n; k++) outSdf.writeUInt16LE(toHalf(toFloat(sdf.readUInt16LE(40 + k * 2)) * scale), 40 + k * 2);

fs.writeFileSync(`${out}.mesh`, outMesh);
fs.writeFileSync(`${out}.sdf`, outSdf);
console.log(`${out}: ${V} vertices, ${I / 3} triangles; scaled ${scale.toFixed(3)}, ${(hi[1] - lo[1]).toFixed(3)} tall to ${height}`);
