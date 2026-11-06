// Paints matcaps by reflecting a made up studio off a sphere, so the hard edges of chrome come out right.
//
//   node tools/make_matcaps.mjs
//
// Writes public/matcaps/<name>.png. Each one is only an environment, so a new look is a new function.
import fs from 'fs'
import zlib from 'zlib'

const SIZE = 512
const AA = 3
const step = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const box = (x, y, cx, cy, w, h, edge = 0.012) =>
  step(-edge, edge, w - Math.abs(x - cx)) * step(-edge, edge, h - Math.abs(y - cy))

// Tall strip lights, not boxes: a body is close to a cylinder, so anything that varies by azimuth runs the length
// of it, and anything small lands on a flat chest as a spot. Under the horizon is a dark band, then the bright floor.
const studio = ([x, y, z]) => {
  const a = Math.atan2(x, z) / Math.PI // 0 is behind the camera, 1 behind the statue
  const bend = y + 0.06 * Math.sin(a * 9 + 0.6)
  const strip = (centre, width) => step(width + 0.012, width - 0.012, Math.abs(a - centre + 0.05 * Math.sin(y * 3)))
  let v = mix(0.9, 0.55, step(0, 1, bend))
  v = mix(v, 0.02, strip(-0.42, 0.1))
  v = mix(v, 0.02, strip(0.3, 0.05))
  v = mix(v, 1, strip(0.06, 0.07))
  v = mix(v, 0.015, strip(0.72, 0.14))
  v = mix(v, 0.015, strip(-0.8, 0.1))
  const floor = mix(0.02, 0.86, step(-0.3, -0.75, bend))
  return mix(floor, v, step(-0.232, -0.208, bend))
}

// nearly all paper with a few inked shapes, for a light backdrop
const ink = ([x, y, z]) => {
  const wave = Math.sin(x * 4.2 + y * 2.1 + 1.1) + 0.6 * Math.sin(y * 6.3 - x * 2.4)
  let v = mix(0.93, 0.74, step(0.1, 1, y))
  v = mix(v, 0.02, step(0.82, 0.86, wave))
  v = mix(v, 0.03, step(0.02, -0.02, y + 0.42 + 0.14 * Math.sin(x * 3.6)))
  v = mix(v, 0.62, step(-0.02, 0.02, -y - 0.8))
  v = mix(v, 1, box(x, y, -0.2, 0.55, 0.2, 0.1))
  return v + z * 0
}

// Soft lights placed by direction, so nothing pinches at the poles, and never quite black: coloured metal keeps its colour
// in the shadows, and a hard black shape on it reads as a photographic negative.
const near = (r, d, wide, edge) => {
  const l = Math.hypot(...d)
  const c = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / l
  return step(Math.cos(wide + edge), Math.cos(wide - edge), c)
}
const softStudio = (r) => {
  const [x, y] = r
  let v = 0.36 + 0.2 * y
  v = mix(v, 0.1, step(-0.05, -0.55, y + 0.12 * Math.sin(x * 3)) * 0.8) // the darker lower half of the room
  v = mix(v, 0.6, step(-0.6, -0.95, y)) // the floor coming back up
  v = mix(v, 1, near(r, [-0.45, 0.72, 0.5], 0.42, 0.14)) // the main softbox
  v = mix(v, 0.82, near(r, [0.8, 0.25, 0.5], 0.17, 0.09)) // a strip on the other side
  v = mix(v, 0.14, near(r, [-0.95, -0.05, 0.3], 0.26, 0.16)) // a dark card, for an edge to work against
  v = mix(v, 0.7, step(-0.55, -0.92, r[2])) // what lies behind, which is what a rim sees
  return v
}

// luminance to colour, in the order real metal goes: warm dark, saturated body, pale highlight
const ramp = (env, stops) => (r) => {
  const v = Math.min(1, Math.max(0, env(r)))
  for (let i = 1; i < stops.length; i++)
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i]
      const t = (v - a[0]) / (b[0] - a[0])
      return [mix(a[1][0], b[1][0], t), mix(a[1][1], b[1][1], t), mix(a[1][2], b[1][2], t)]
    }
  return stops[stops.length - 1][1]
}
const grey = (env) => (r) => {
  const v = env(r)
  return [v, v, v]
}

const looks = {
  chrome: grey(studio),
  ink: grey(ink),
  gold: ramp(softStudio, [[0, [0.16, 0.07, 0.01]], [0.3, [0.56, 0.33, 0.06]], [0.6, [0.93, 0.68, 0.18]], [0.85, [1, 0.87, 0.47]], [1, [1, 0.98, 0.86]]]),
  copper: ramp(softStudio, [[0, [0.15, 0.04, 0.02]], [0.3, [0.56, 0.22, 0.11]], [0.6, [0.9, 0.5, 0.31]], [0.85, [1, 0.74, 0.58]], [1, [1, 0.95, 0.88]]]),
  bronze: ramp(softStudio, [[0, [0.09, 0.05, 0.03]], [0.3, [0.32, 0.2, 0.11]], [0.6, [0.62, 0.43, 0.24]], [0.85, [0.87, 0.71, 0.48]], [1, [1, 0.93, 0.78]]]),
  silver: ramp(softStudio, [[0, [0.1, 0.1, 0.11]], [0.3, [0.38, 0.39, 0.41]], [0.6, [0.72, 0.73, 0.75]], [0.85, [0.93, 0.94, 0.95]], [1, [1, 1, 1]]]),
}

const render = (env) => {
  const out = Buffer.alloc((SIZE * 3 + 1) * SIZE)
  for (let py = 0; py < SIZE; py++) {
    out[py * (SIZE * 3 + 1)] = 0
    for (let px = 0; px < SIZE; px++) {
      const sum = [0, 0, 0]
      for (let j = 0; j < AA; j++)
        for (let i = 0; i < AA; i++) {
          let nx = ((px + (i + 0.5) / AA) / SIZE) * 2 - 1
          let ny = 1 - ((py + (j + 0.5) / AA) / SIZE) * 2
          const r = Math.hypot(nx, ny)
          if (r > 0.998) {
            nx *= 0.998 / r
            ny *= 0.998 / r
          }
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
          const c = env([2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1])
          for (let k = 0; k < 3; k++) sum[k] += c[k]
        }
      for (let k = 0; k < 3; k++) {
        const v = Math.min(1, Math.max(0, sum[k] / (AA * AA)))
        out[py * (SIZE * 3 + 1) + 1 + px * 3 + k] = Math.round(v * 255)
      }
    }
  }
  return out
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc = (b) => {
  let c = -1
  for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc(body))
  return Buffer.concat([head, body, tail])
}
const png = (raw) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync('public/matcaps', { recursive: true })
for (const [name, env] of Object.entries(looks)) {
  fs.writeFileSync(`public/matcaps/${name}.png`, png(render(env)))
  console.log(name)
}
