// A mask from a scan. A mask only has a front, so the scan is flattened to a depth map seen straight on, and everything
// behind that surface is solid: nothing needs sealing, and whatever lies behind the face in the scan is ignored.
//
//   node tools/bake_relief.mjs <in.stl> <out-name> <pose.json> [preview.png]
//
// pose.json: { centre: [x,y,z], yaw, pitch, roll (degrees), scale, shift: [x,y,z], smooth, hairSmooth (cells), hairline }
import fs from 'fs'
import zlib from 'zlib'
import { cut, smax, toHalf } from './mask_shape.mjs'

const [src, out, poseFile, preview] = process.argv.slice(2)
const pose = JSON.parse(fs.readFileSync(poseFile))
const file = fs.readFileSync(src)
const triCount = file.readUInt32LE(80)

const rad = Math.PI / 180
const [cy, sy] = [Math.cos(pose.yaw * rad), Math.sin(pose.yaw * rad)]
const [cp, sp] = [Math.cos(pose.pitch * rad), Math.sin(pose.pitch * rad)]
const [cr, sr] = [Math.cos(pose.roll * rad), Math.sin(pose.roll * rad)]
// the scan is Z up. Turned so the face looks along -Y, then to the demo's Y up, front +Z, sized to the same landmarks
const place = (x, y, z) => {
  const dx = x - pose.centre[0], dy = y - pose.centre[1], dz = z - pose.centre[2]
  const ax = cy * dx - sy * dy, ay = sy * dx + cy * dy // yaw about Z
  const by = cp * ay - sp * dz, bz = sp * ay + cp * dz // pitch about X
  const cx2 = cr * ax - sr * bz, cz2 = sr * ax + cr * bz // roll about Y
  const shift = pose.shift ?? [0, 0, 0]
  return [cx2 * pose.scale + shift[0], cz2 * pose.scale + 1.15 + shift[1], -by * pose.scale + 0.3 + shift[2]]
}

const h = 0.00625
const lo = [-0.8, 0.2, -0.25]
const hi = [0.8, 2.2, 0.85]
const dims = lo.map((v, a) => Math.ceil((hi[a] - v) / h))
const [nx, ny, nz] = dims

// nearest surface from the front at each column
const depth = new Float32Array(nx * ny).fill(-Infinity)
const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
for (let t = 0; t < triCount; t++) {
  const o = 84 + t * 50 + 12
  for (let k = 0; k < 3; k++) v[k] = place(file.readFloatLE(o + k * 12), file.readFloatLE(o + k * 12 + 4), file.readFloatLE(o + k * 12 + 8))
  const px = v.map((p) => (p[0] - lo[0]) / h - 0.5)
  const py = v.map((p) => (p[1] - lo[1]) / h - 0.5)
  const d = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
  if (Math.abs(d) < 1e-9) continue
  const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(nx - 1, Math.ceil(Math.max(...px)))
  const y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(ny - 1, Math.ceil(Math.max(...py)))
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const a = ((py[1] - py[2]) * (x - px[2]) + (px[2] - px[1]) * (y - py[2])) / d
      const b = ((py[2] - py[0]) * (x - px[2]) + (px[0] - px[2]) * (y - py[2])) / d
      const c = 1 - a - b
      if (a < -0.02 || b < -0.02 || c < -0.02) continue
      const z = a * v[0][2] + b * v[1][2] + c * v[2][2]
      if (z > depth[y * nx + x]) depth[y * nx + x] = z
    }
}

// holes in the scan fill in from their edges
let holes = 0
const known = new Uint8Array(nx * ny)
for (let i = 0; i < depth.length; i++) known[i] = depth[i] > -Infinity ? 1 : 0
// only small ones: run further and it smears the edge of the head across the empty room
for (let pass = 0; pass < 10; pass++) {
  let left = 0
  const next = depth.slice()
  for (let y = 1; y < ny - 1; y++)
    for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x
      if (depth[i] > -Infinity) continue
      left++
      let sum = 0, n = 0
      for (const j of [i - 1, i + 1, i - nx, i + nx]) if (depth[j] > -Infinity) { sum += depth[j]; n++ }
      if (n) next[i] = sum / n
    }
  depth.set(next)
  if (pass === 0) holes = left
  if (!left) break
}
for (let i = 0; i < depth.length; i++) if (depth[i] === -Infinity) depth[i] = -0.1

// grain out, features in: a scan is noisy at the size of its triangles, and a face is not
const blurDepth = (sigma) => {
  const r = Math.ceil(sigma * 3)
  const k = Array.from({ length: r * 2 + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const total = k.reduce((a, b) => a + b)
  const tmp = new Float32Array(depth.length)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += depth[y * nx + Math.min(nx - 1, Math.max(0, x + i))] * k[i + r]
      tmp[y * nx + x] = s / total
    }
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += tmp[Math.min(ny - 1, Math.max(0, y + i)) * nx + x] * k[i + r]
      depth[y * nx + x] = s / total
    }
}
// Hair is not a surface a mask can have. Blurred it stays a lump, so above the hairline it is replaced outright: each column
// carries on from the forehead below it, at the slope it was leaving at, curving back like a skull.
if (pose.forehead) {
  const { from, to, reach, curve, lean: back } = pose.forehead
  const rowOf = (y) => Math.round((y - lo[1]) / h - 0.5)
  const top = rowOf(from), below = rowOf(from - reach)
  const base = new Float32Array(nx), good = new Float32Array(nx)
  const smoothColumns = (values) => {
    const out = new Float32Array(nx)
    const r = 30, sigma = 12
    for (let x = 0; x < nx; x++) {
      let sum = 0, weight = 0
      for (let i = -r; i <= r; i++) {
        const c = x + i
        if (c < 0 || c >= nx || !good[c]) continue
        const w = Math.exp(-(i * i) / (2 * sigma * sigma))
        sum += values[c] * w
        weight += w
      }
      out[x] = weight ? sum / weight : -0.1
    }
    return out
  }
  const band = 6
  for (let x = 0; x < nx; x++) {
    let a = 0, b = 0
    for (let i = 0; i < band; i++) {
      a += depth[(top - i) * nx + x]
      b += depth[(below + i) * nx + x]
    }
    a /= band
    b /= band
    good[x] = a > 0 && b > 0 ? 1 : 0
    base[x] = a
  }
  const edge = smoothColumns(base)
  for (let y = top - band; y < ny; y++) {
    const dy = (y - top) * h
    const t = Math.min(1, Math.max(0, (lo[1] + (y + 0.5) * h - from) / (to - from)))
    const blend = t * t * (3 - 2 * t)
    for (let x = 0; x < nx; x++) {
      // a set lean and not the measured one: a real forehead leaves the brow steeply, and carried on that reads as a flat cap
      const skull = edge[x] + back * dy - curve * dy * Math.abs(dy)
      depth[y * nx + x] += (skull - depth[y * nx + x]) * blend
    }
  }
}

// hair is all edges, and a mirror would turn it to crumpled foil: above the hairline it melts into one soft form
if (pose.hairSmooth) {
  const sharp = depth.slice()
  blurDepth(pose.hairSmooth)
  for (let y = 0; y < ny; y++) {
    const t = Math.min(1, Math.max(0, ((lo[1] + (y + 0.5) * h) - pose.hairline + 0.05) / 0.16))
    const hair = t * t * (3 - 2 * t)
    for (let x = 0; x < nx; x++) depth[y * nx + x] = sharp[y * nx + x] + (depth[y * nx + x] - sharp[y * nx + x]) * hair
  }
}
blurDepth(pose.smooth)

// A mirror shows slope, so the low lumps of scanned skin swirl far more than their height deserves, and blur strong
// enough to lose them loses the eyes as well. Features are tall and lumps are not: what stands off a broad base by less
// than the threshold is dropped, and what stands higher keeps its full height.
if (pose.core) {
  const fine = depth.slice()
  blurDepth(pose.core.base)
  for (let i = 0; i < depth.length; i++) {
    const detail = fine[i] - depth[i]
    // no threshold to cross: anything with a corner in it leaves contour lines all over the skin
    depth[i] += (detail * detail * detail) / (detail * detail + pose.core.height ** 2)
  }
  blurDepth(1.2)
}

if (preview) {
  // shaded from the upper left, so that the pose can be judged by eye
  const raw = Buffer.alloc((nx * 3 + 1) * ny)
  for (let row = 0; row < ny; row++) {
    const y = ny - 1 - row
    raw[row * (nx * 3 + 1)] = 0
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x
      const gx = (depth[y * nx + Math.min(x + 1, nx - 1)] - depth[y * nx + Math.max(x - 1, 0)]) / (2 * h)
      const gy = (depth[Math.min(y + 1, ny - 1) * nx + x] - depth[Math.max(y - 1, 0) * nx + x]) / (2 * h)
      const l = Math.hypot(gx, gy, 1)
      const shade = Math.max(0, (gx * 0.45 - gy * 0.55 + 0.7) / l)
      const c = Math.round(Math.min(1, shade) * 255)
      // guides: the eye line at 1.28, the chin at 0.55, the middle
      const wy = lo[1] + (y + 0.5) * h, wx = lo[0] + (x + 0.5) * h
      const guide = Math.abs(wy - 1.28) < h || Math.abs(wy - 0.55) < h || Math.abs(wx) < h / 1.2
      const at = row * (nx * 3 + 1) + 1 + x * 3
      raw[at] = guide ? 255 : c
      raw[at + 1] = guide ? 60 : c
      raw[at + 2] = guide ? 60 : c
    }
  }
  const table = new Int32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c
  })
  const crc = (b) => {
    let c = -1
    for (const q of b) c = table[(c ^ q) & 255] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const a = Buffer.alloc(4), b = Buffer.alloc(4)
    a.writeUInt32BE(data.length)
    b.writeUInt32BE(crc(body))
    return Buffer.concat([a, body, b])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(nx, 0)
  head.writeUInt32BE(ny, 4)
  head.set([8, 2, 0, 0, 0], 8)
  fs.writeFileSync(preview, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
let tip = -9, tipAt = [0, 0]
for (let y = 0; y < ny; y++)
  for (let x = 0; x < nx; x++) {
    const wx = lo[0] + (x + 0.5) * h, wy = lo[1] + (y + 0.5) * h
    if (Math.abs(wx) < 0.3 && wy > 0.75 && wy < 1.35 && depth[y * nx + x] > tip) {
      tip = depth[y * nx + x]
      tipAt = [wx, wy]
    }
  }
console.log('columns', nx, ny, 'holes filled', holes, 'nose tip', tip.toFixed(3), 'at', tipAt.map((v) => v.toFixed(3)).join(' '))
if (out === '-') process.exit(0)

// The face is worked on at full detail above. cells only sets the grid it is written into, 320 being one cell per column.
const fh = 2 / Number(process.env.CELLS ?? pose.cells ?? 320)
const fieldDims = lo.map((v, a) => Math.ceil((hi[a] - v) / fh))
const [fx, fy, fz] = fieldDims
const depthAt = (wx, wy) => {
  const cx = Math.min(nx - 1.001, Math.max(0, (wx - lo[0]) / h - 0.5))
  const cy = Math.min(ny - 1.001, Math.max(0, (wy - lo[1]) / h - 0.5))
  const ix = Math.floor(cx), iy = Math.floor(cy), tx = cx - ix, ty = cy - iy
  const i = iy * nx + ix
  return (depth[i] * (1 - tx) + depth[i + 1] * tx) * (1 - ty) + (depth[i + nx] * (1 - tx) + depth[i + nx + 1] * tx) * ty
}
const count = fx * fy * fz
const dist = new Float32Array(count)
const inside = new Uint8Array(count)
const band = fh * 3
let solid = 0
for (let z = 0; z < fz; z++)
  for (let y = 0; y < fy; y++)
    for (let x = 0; x < fx; x++) {
      const wx = lo[0] + (x + 0.5) * fh, wy = lo[1] + (y + 0.5) * fh, wz = lo[2] + (z + 0.5) * fh
      const gx = (depthAt(wx + h, wy) - depthAt(wx - h, wy)) / (2 * h)
      const gy = (depthAt(wx, wy + h) - depthAt(wx, wy - h)) / (2 * h)
      // height over a sloped surface, brought back to a distance: good near the surface and nowhere else
      const face = (wz - depthAt(wx, wy)) / Math.sqrt(1 + gx * gx + gy * gy)
      const edge = cut(wx, wy, wz, pose.outline.centre, pose.outline.radius)
      const d = smax(face, edge, 0.05)
      const at = (z * fy + y) * fx + x
      inside[at] = d < 0 ? 1 : 0
      dist[at] = Math.abs(d) < band ? Math.abs(d) : Infinity
      if (d < 0) solid++
    }

// everything further out is swept from that band, so that shadows and rays read a true distance
const update = (i, x, y, z) => {
  const a = Math.min(x > 0 ? dist[i - 1] : Infinity, x < fx - 1 ? dist[i + 1] : Infinity)
  const b = Math.min(y > 0 ? dist[i - fx] : Infinity, y < fy - 1 ? dist[i + fx] : Infinity)
  const c = Math.min(z > 0 ? dist[i - fx * fy] : Infinity, z < fz - 1 ? dist[i + fx * fy] : Infinity)
  const p = Math.min(a, b, c), r = Math.max(a, b, c), q = a + b + c - p - r
  if (p === Infinity) return
  let u = p + fh
  if (u > q) {
    u = (p + q + Math.sqrt(Math.max(0, 2 * fh * fh - (p - q) * (p - q)))) / 2
    if (u > r && r < Infinity) {
      const s3 = p + q + r
      u = (s3 + Math.sqrt(Math.max(0, s3 * s3 - 3 * (p * p + q * q + r * r - fh * fh)))) / 3
    }
  }
  if (u < dist[i]) dist[i] = u
}
for (let s = 0; s < 8; s++) {
  const xs = s & 1 ? -1 : 1, ys = s & 2 ? -1 : 1, zs = s & 4 ? -1 : 1
  for (let z = zs > 0 ? 0 : fz - 1; z >= 0 && z < fz; z += zs)
    for (let y = ys > 0 ? 0 : fy - 1; y >= 0 && y < fy; y += ys)
      for (let x = xs > 0 ? 0 : fx - 1; x >= 0 && x < fx; x += xs) {
        const i = (z * fy + y) * fx + x
        if (dist[i] >= band || dist[i] === Infinity) update(i, x, y, z)
      }
}
const data = new Uint16Array(count)
for (let i = 0; i < count; i++) data[i] = toHalf(inside[i] ? -dist[i] : dist[i])
fs.writeFileSync(`public/sdf/${out}.bin`, Buffer.from(data.buffer))
fs.writeFileSync(`public/sdf/${out}.json`, JSON.stringify({ dims: fieldDims, origin: lo, cell: fh, height: 2 }))
console.log(out, fieldDims.join('x'), (data.byteLength / 1e6).toFixed(1) + ' MB', 'solid', solid)
