// Bakes a sealed STL into a signed distance grid the demos load as a 3D texture.
//
//   node tools/bake_sdf.mjs <in.stl> <out-name> <cells-tall>
//
// Writes public/sdf/<out-name>.bin (float16, x fastest) and <out-name>.json.
// World space of the output: Y up, front towards +Z, feet on y = 0, 2 units tall, centred on x and z.
// STL is Z up with the front towards -Y, so (x, y, z) becomes (x, z, -y), a rotation and not a mirror.

import fs from 'fs'
import path from 'path'

const [src, name, cellsArg] = process.argv.slice(2)
const cellsTall = Number(cellsArg)
const HEIGHT = 2
const MARGIN = 4 // cells of empty space around the statue, so that the field closes before the box does
const BAND = 7 // cells either side of the surface that each triangle writes to
const EXACT = 6 // past this a cell may only have heard from a triangle that is not its nearest

const file = fs.readFileSync(src)
const triCount = file.readUInt32LE(80)
if (84 + 50 * triCount !== file.length) throw new Error('expected a binary STL')

const tris = new Float32Array(triCount * 9)
for (let t = 0; t < triCount; t++) {
  const o = 84 + t * 50 + 12
  for (let v = 0; v < 3; v++) {
    tris[t * 9 + v * 3] = file.readFloatLE(o + v * 12)
    tris[t * 9 + v * 3 + 1] = file.readFloatLE(o + v * 12 + 8)
    tris[t * 9 + v * 3 + 2] = -file.readFloatLE(o + v * 12 + 4)
  }
}

const lo = [Infinity, Infinity, Infinity]
const hi = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < tris.length; i++) {
  lo[i % 3] = Math.min(lo[i % 3], tris[i])
  hi[i % 3] = Math.max(hi[i % 3], tris[i])
}
const scale = HEIGHT / (hi[1] - lo[1])
const centre = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
for (let i = 0; i < tris.length; i++) tris[i] = (tris[i] - centre[i % 3]) * scale
const size = [(hi[0] - lo[0]) * scale, HEIGHT, (hi[2] - lo[2]) * scale]

const h = HEIGHT / cellsTall
const dims = size.map((s) => Math.ceil(s / h) + MARGIN * 2)
const origin = [-(dims[0] * h) / 2, -MARGIN * h, -(dims[2] * h) / 2]
const [nx, ny, nz] = dims
const count = nx * ny * nz
const index = (x, y, z) => (z * ny + y) * nx + x
console.log(`${name}: ${triCount} tris, grid ${nx}x${ny}x${nz} = ${(count / 1e6).toFixed(2)}M, h ${h.toFixed(5)}`)

// exact distance near the surface
const dist = new Float32Array(count).fill(Infinity)
const closest = (px, py, pz, o) => {
  const ax = tris[o], ay = tris[o + 1], az = tris[o + 2]
  const abx = tris[o + 3] - ax, aby = tris[o + 4] - ay, abz = tris[o + 5] - az
  const acx = tris[o + 6] - ax, acy = tris[o + 7] - ay, acz = tris[o + 8] - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x, y, z) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return sq(apx - v * abx, apy - v * aby, apz - v * abz)
  }
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return sq(apx - w * acx, apy - w * acy, apz - w * acz)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    const bcx = acx - abx, bcy = acy - aby, bcz = acz - abz
    return sq(bpx - w * bcx, bpy - w * bcy, bpz - w * bcz)
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom, w = vc * denom
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w)
}

const cellOf = (p, a) => (p - origin[a]) / h - 0.5
for (let t = 0; t < triCount; t++) {
  const o = t * 9
  const b = [0, 1, 2].map((a) => {
    const v = [tris[o + a], tris[o + 3 + a], tris[o + 6 + a]].map((p) => cellOf(p, a))
    return [Math.max(0, Math.ceil(Math.min(...v) - BAND)), Math.min(dims[a] - 1, Math.floor(Math.max(...v) + BAND))]
  })
  for (let z = b[2][0]; z <= b[2][1]; z++)
    for (let y = b[1][0]; y <= b[1][1]; y++)
      for (let x = b[0][0]; x <= b[0][1]; x++) {
        const d = closest(origin[0] + (x + 0.5) * h, origin[1] + (y + 0.5) * h, origin[2] + (z + 0.5) * h, o)
        const i = index(x, y, z)
        if (d < dist[i]) dist[i] = d
      }
}
// A cell further out than the band holds the distance to whichever triangle's box happened to reach it.
// Kept, those show up in a mirror as rectangles the size of the triangles: the sweep below refills them.
for (let i = 0; i < count; i++) {
  dist[i] = Math.sqrt(dist[i])
  if (dist[i] > EXACT * h) dist[i] = Infinity
}
console.log('  band done')

// inside or outside: count crossings along x through every (y, z) cell centre
const inside = new Uint8Array(count)
const columns = new Map()
for (let t = 0; t < triCount; t++) {
  const o = t * 9
  const ay = cellOf(tris[o + 1], 1), az = cellOf(tris[o + 2], 2)
  const by = cellOf(tris[o + 4], 1), bz = cellOf(tris[o + 5], 2)
  const cy = cellOf(tris[o + 7], 1), cz = cellOf(tris[o + 8], 2)
  const ax = cellOf(tris[o], 0), bx = cellOf(tris[o + 3], 0), cx = cellOf(tris[o + 6], 0)
  const d = (by - ay) * (cz - az) - (cy - ay) * (bz - az)
  if (Math.abs(d) < 1e-14) continue
  const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), y1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy)))
  const z0 = Math.max(0, Math.ceil(Math.min(az, bz, cz))), z1 = Math.min(nz - 1, Math.floor(Math.max(az, bz, cz)))
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      // the small offset keeps rays off shared edges, where a crossing would count twice or not at all
      const py = y + 1.3e-4, pz = z + 1.7e-4
      const u = ((py - ay) * (cz - az) - (cy - ay) * (pz - az)) / d
      const v = ((by - ay) * (pz - az) - (py - ay) * (bz - az)) / d
      if (u < 0 || v < 0 || u + v > 1) continue
      const key = z * ny + y
      let list = columns.get(key)
      if (!list) columns.set(key, (list = []))
      list.push(ax + u * (bx - ax) + v * (cx - ax))
    }
}
let oddColumns = 0
for (const [key, list] of columns) {
  if (list.length % 2) oddColumns++
  list.sort((a, b) => a - b)
  const base = key * nx
  for (let i = 0; i + 1 < list.length; i += 2)
    for (let x = Math.max(0, Math.ceil(list[i])); x <= Math.min(nx - 1, Math.floor(list[i + 1])); x++) inside[base + x] = 1
}
if (oddColumns) console.warn(`  ${oddColumns} columns crossed an odd number of times: the mesh is not sealed`)

// the rest of the box: eikonal fast sweeping out from the band, 8 orderings
const update = (i, x, y, z) => {
  const a = Math.min(x > 0 ? dist[i - 1] : Infinity, x < nx - 1 ? dist[i + 1] : Infinity)
  const b = Math.min(y > 0 ? dist[i - nx] : Infinity, y < ny - 1 ? dist[i + nx] : Infinity)
  const c = Math.min(z > 0 ? dist[i - nx * ny] : Infinity, z < nz - 1 ? dist[i + nx * ny] : Infinity)
  let [p, q, r] = [a, b, c].sort((m, n) => m - n)
  if (p === Infinity) return
  let u = p + h
  if (u > q) {
    u = (p + q + Math.sqrt(Math.max(0, 2 * h * h - (p - q) * (p - q)))) / 2
    if (u > r) {
      const s = p + q + r
      u = (s + Math.sqrt(Math.max(0, s * s - 3 * (p * p + q * q + r * r - h * h)))) / 3
    }
  }
  if (u < dist[i]) dist[i] = u
}
for (let pass = 0; pass < 2; pass++)
  for (let s = 0; s < 8; s++) {
    const xs = s & 1 ? -1 : 1, ys = s & 2 ? -1 : 1, zs = s & 4 ? -1 : 1
    for (let z = zs > 0 ? 0 : nz - 1; z >= 0 && z < nz; z += zs)
      for (let y = ys > 0 ? 0 : ny - 1; y >= 0 && y < ny; y += ys)
        for (let x = xs > 0 ? 0 : nx - 1; x >= 0 && x < nx; x += xs) update(index(x, y, z), x, y, z)
  }
console.log('  sweeps done')

let solid = 0
const out = new Uint16Array(count)
const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
const toHalf = (v) => {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = ((x >>> 23) & 0xff) - 112
  if (exp <= 0) return sign
  if (exp >= 31) return sign | 0x7bff
  return sign | (exp << 10) | ((x >>> 13) & 0x3ff)
}
for (let i = 0; i < count; i++) {
  if (inside[i]) solid++
  out[i] = toHalf(inside[i] ? -dist[i] : dist[i])
}

const dir = path.resolve('public/sdf')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, `${name}.bin`), Buffer.from(out.buffer))
const meta = { dims, origin, cell: h, size, solidCells: solid, height: HEIGHT }
fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(meta))
console.log(`  solid ${solid}, volume ${(solid * h ** 3).toFixed(4)}, ${(out.byteLength / 1e6).toFixed(1)} MB`, 'odd columns', oddColumns)
