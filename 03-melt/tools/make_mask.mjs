// Cuts a floating mask out of a baked head: a torn outline, a flat back, cropped to what is left.
// Static, so the noise of the torn edge is paid for here and not in every step of every ray.
//
//   node tools/make_mask.mjs <in-name> <out-name> [cells-tall]
//
// With cells-tall the finished field is resampled onto a coarser grid, which keeps the shape exactly as it was cut.
import fs from 'fs'
import { cut, smax, toHalf } from './mask_shape.mjs'

const [src, out, cellsArg] = process.argv.slice(2)
const meta = JSON.parse(fs.readFileSync(`public/sdf/${src}.json`))
const bin = fs.readFileSync(`public/sdf/${src}.bin`)
const half = new Uint16Array(bin.buffer, bin.byteOffset, bin.length / 2)
const [nx, ny, nz] = meta.dims
const h = meta.cell

const toFloat = (v) => {
  const s = v & 0x8000 ? -1 : 1
  const e = (v >> 10) & 31
  const m = v & 1023
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15)
}
const sampleHead = (x, y, z) => {
  const gx = Math.round((x - meta.origin[0]) / h - 0.5)
  const gy = Math.round((y - meta.origin[1]) / h - 0.5)
  const gz = Math.round((z - meta.origin[2]) / h - 0.5)
  return toFloat(half[(gz * ny + gy) * nx + gx])
}
const smin = (a, b, k) => -smax(-a, -b, k)

// The holes were sealed flat, which reads as blank open eyes. An eyeball pushes the seal out into a closed lid,
// and a groove along the lower edge of it is the lashes' line.
const eyeY = 1.285
const eyes = [-0.225, 0.225].map((x) => {
  let z = meta.origin[2] + (nz - 2) * h
  while (z > 0 && sampleHead(x, eyeY, z) > 0) z -= h
  return { x, y: eyeY, z: z - 0.095, r: 0.125 }
})
console.log('eyes', eyes.map((e) => e.z.toFixed(3)).join(' '))
const lids = (d, x, y, z) => {
  let out = d
  for (const e of eyes) {
    const q = Math.hypot((x - e.x) * 0.78, y - e.y, z - e.z)
    out = smin(out, q - e.r, 0.07)
  }
  for (const e of eyes) {
    const dx = (x - e.x) / 0.135
    if (Math.abs(dx) >= 1 || z < 0.2) continue
    const lid = e.y - 0.034 + 0.03 * dx * dx + 0.012 * dx * Math.sign(e.x)
    const across = (y - lid) / 0.011
    out += 0.016 * Math.exp(-across * across) * (1 - dx ** 4)
  }
  return out
}

const lo = [-0.8, 0.2, -0.25]
const hi = [0.8, 2.2, 0.85]
const start = lo.map((v, a) => Math.max(0, Math.floor((v - meta.origin[a]) / h)))
const end = hi.map((v, a) => Math.min(meta.dims[a], Math.ceil((v - meta.origin[a]) / h)))
const dims = end.map((v, a) => v - start[a])
const count = dims[0] * dims[1] * dims[2]
const field = new Float32Array(count)
let solid = 0
for (let z = 0; z < dims[2]; z++)
  for (let y = 0; y < dims[1]; y++)
    for (let x = 0; x < dims[0]; x++) {
      const gx = x + start[0], gy = y + start[1], gz = z + start[2]
      const wx = meta.origin[0] + (gx + 0.5) * h
      const wy = meta.origin[1] + (gy + 0.5) * h
      const wz = meta.origin[2] + (gz + 0.5) * h
      const d = smax(lids(toFloat(half[(gz * ny + gy) * nx + gx]), wx, wy, wz), cut(wx, wy, wz), 0.05)
      field[(z * dims[1] + y) * dims[0] + x] = d
      if (d < 0) solid++
    }

// a mirror shows the slope of a field, and this one is built from triangles: a little blur takes the grain out
const blur = (axis, stride, n) => {
  const copy = field.slice()
  for (let i = 0; i < count; i++) {
    const c = Math.floor(i / stride) % n
    field[i] = (copy[c > 0 ? i - stride : i] + 2 * copy[i] + copy[c < n - 1 ? i + stride : i]) / 4
  }
}
for (let pass = 0; pass < 2; pass++) {
  blur(0, 1, dims[0])
  blur(1, dims[0], dims[1])
  blur(2, dims[0] * dims[1], dims[2])
}

const fh = cellsArg ? 2 / Number(cellsArg) : h
const outDims = dims.map((d) => Math.floor((d * h) / fh))
const [ox, oy, oz] = outDims
const at = (x, y, z) => field[(z * dims[1] + y) * dims[0] + x]
const data = new Uint16Array(ox * oy * oz)
for (let z = 0; z < oz; z++)
  for (let y = 0; y < oy; y++)
    for (let x = 0; x < ox; x++) {
      const px = Math.min(dims[0] - 1.001, Math.max(0, ((x + 0.5) * fh) / h - 0.5))
      const py = Math.min(dims[1] - 1.001, Math.max(0, ((y + 0.5) * fh) / h - 0.5))
      const pz = Math.min(dims[2] - 1.001, Math.max(0, ((z + 0.5) * fh) / h - 0.5))
      const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz)
      const tx = px - ix, ty = py - iy, tz = pz - iz
      const lerp = (a, b, t) => a + (b - a) * t
      data[(z * oy + y) * ox + x] = toHalf(lerp(
        lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), tx), lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
        lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty),
        tz,
      ))
    }
fs.writeFileSync(`public/sdf/${out}.bin`, Buffer.from(data.buffer))
const origin = start.map((v, a) => meta.origin[a] + v * h)
fs.writeFileSync(`public/sdf/${out}.json`, JSON.stringify({ dims: outDims, origin, cell: fh, height: meta.height }))
console.log(out, outDims.join('x'), (data.byteLength / 1e6).toFixed(1) + ' MB', 'solid', solid)
