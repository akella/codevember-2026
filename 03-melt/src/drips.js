// Everything that decides where metal goes, on the CPU: a few dozen points, and nothing to read back from the GPU.
//   runners  crawl down the mask's surface from the eyes, leaving a bead behind them
//   strands  hang from wherever a runner reaches an overhang, stretch, thin at the root and fall whole
//   drops    small droplets thrown out by an impact, which land as beads on the floor

export const LIMITS = { runners: 12, strands: 14, drops: 40, stamps: 16 }


const mulberry = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function createDrips(field, { lift, floorHalf, pivot, seed = 7 }) {
  const rand = mulberry(seed)
  const tuning = { size: 1, rate: 1, length: 1 }
  const ease = (t) => {
    const c = Math.min(1, Math.max(0, t))
    return c * c * (3 - 2 * c)
  }

  // The mask can tip back about its pivot. Its field never moves: points are turned into it to be looked up.
  const pose = { cos: 1, sin: 0, lower: 0 }
  const setTilt = (radians) => {
    pose.cos = Math.cos(radians)
    pose.sin = Math.sin(radians)
  }
  // on a hollow mask the skin stops where this goes positive, and metal that reaches the rim falls from it
  let carve = null
  const setCarve = (fn) => { carve = fn }
  const atRim = (p) => (carve ? carve(...toField(...p)) > -0.015 : false)
  const toField = (x, y, z) => {
    const dy = y - pivot[1] + pose.lower, dz = z - pivot[2]
    return [x, pivot[1] + pose.cos * dy - pose.sin * dz, pivot[2] + pose.sin * dy + pose.cos * dz]
  }
  const toRoom = (x, y, z) => {
    const dy = y - pivot[1], dz = z - pivot[2]
    return [x, pivot[1] - pose.lower + pose.cos * dy + pose.sin * dz, pivot[2] - pose.sin * dy + pose.cos * dz]
  }
  const bulbLimit = () => 0.021 * tuning.size
  const range = (a, b) => a + (b - a) * rand()
  const { boxMin, meta, nx, ny, nz } = field
  const h = meta.cell

  // the mask's distance at a point in the room, filtered: a walker on raw cells would feel every step
  const phi = (wx, wy, wz) => {
    const [x, y, z] = toField(wx, wy, wz)
    const fx = (x - boxMin.x) / h - 0.5
    const fy = (y - lift - boxMin.y) / h - 0.5
    const fz = (z - boxMin.z) / h - 0.5
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz)
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx - 1 || iy >= ny - 1 || iz >= nz - 1) return 1
    const tx = fx - ix, ty = fy - iy, tz = fz - iz
    const s = field.sample
    const l = (a, b, t) => a + (b - a) * t
    return l(
      l(l(s(ix, iy, iz), s(ix + 1, iy, iz), tx), l(s(ix, iy + 1, iz), s(ix + 1, iy + 1, iz), tx), ty),
      l(l(s(ix, iy, iz + 1), s(ix + 1, iy, iz + 1), tx), l(s(ix, iy + 1, iz + 1), s(ix + 1, iy + 1, iz + 1), tx), ty),
      tz,
    )
  }
  const normal = (x, y, z) => {
    const e = h * 2
    const g = [
      phi(x + e, y, z) - phi(x - e, y, z),
      phi(x, y + e, z) - phi(x, y - e, z),
      phi(x, y, z + e) - phi(x, y, z - e),
    ]
    const l = Math.hypot(...g) || 1
    return g.map((v) => v / l)
  }
  const settle = (p) => {
    for (let i = 0; i < 3; i++) {
      const d = phi(...p)
      const n = normal(...p)
      for (let k = 0; k < 3; k++) p[k] -= n[k] * d
    }
    return p
  }
  // shoot in along the mask's own axis to land on the face, whichever way it is tipped
  const onFace = (x, y) => {
    for (let z = 0.95; z > -0.1; z -= h) {
      const p = toRoom(x, y, z)
      if (phi(...p) < 0) return settle(p)
    }
    return null
  }

  const runners = []
  const strands = []
  const drops = []
  const stamps = []

  const sources = [
    { x: -0.3, y: 1.27, every: [3.5, 6.5], tear: true },
    { x: 0.31, y: 1.27, every: [4, 7], tear: true },
    { x: -0.17, y: 1.255, every: [5, 9], tear: true },
    { x: 0.16, y: 1.255, every: [5.5, 10], tear: true },
    { x: -0.24, y: 1.245, every: [6, 11], tear: true },
    { x: 0.24, y: 1.245, every: [7, 12], tear: true },
    { x: 0.38, y: 1.5, every: [12, 20], tear: false },
    { x: -0.16, y: 0.82, every: [8, 14], tear: false },
    { x: 0.14, y: 0.8, every: [9, 15], tear: false },
  ].map((s, i) => ({ ...s, next: s.tear ? i * 1.1 : range(3, 12) }))

  const spawnRunner = (s) => {
    if (runners.length >= LIMITS.runners) return
    const p = onFace(s.x, s.y + lift)
    if (!p) return
    // a tear wells up in place before it rolls: nothing arrives at full size
    runners.push({ p, speed: range(0.035, 0.07), full: s.tear ? range(0.036, 0.052) : range(0.04, 0.065), radius: 0, well: s.tear ? range(2, 3.5) : range(2.5, 4), drift: range(-1, 1), phase: range(0, 6), age: 0 })
  }

  const spawnStrand = (p, radius) => {
    // a stream that arrives where one already hangs just feeds it
    const near = strands.find((s) => !s.falling && Math.hypot(s.x - p[0], s.z - p[2]) < 0.07)
    if (near) {
      near.reach += range(0.1, 0.25)
      near.bulb = Math.min(near.bulb + 0.002, bulbLimit())
      return
    }
    if (strands.length >= LIMITS.strands) return
    strands.push({ x: p[0], z: p[2], top: p[1] + 0.012, tip: p[1] - 0.01, root: radius * 0.55 * tuning.size, neck: radius * 0.3 * tuning.size, bulb: radius * 0.3 * tuning.size, speed: 0, reach: range(0.45, 1.1), falling: false, letting: 0, age: 0, show: 0 })
  }

  const splash = (s) => {
    // Metal does not vanish: what arrived stays, as a splat holding the volume of the bulb and the thread it drew in
    const flung = 0.12
    const radius = Math.min(Math.max(Math.cbrt((s.volume * (1 - flung)) / 0.55), 0.03), 0.095)
    stamps.push({ x: s.x, z: s.z, r: radius })
    const lobes = Math.round(range(5, 9))
    const turn = range(0, 6.28)
    for (let i = 0; i < lobes; i++) {
      const angle = turn + (i / lobes) * 6.283 + range(-0.3, 0.3)
      const out = radius * range(0.75, 1.15)
      stamps.push({ x: s.x + Math.cos(angle) * out, z: s.z + Math.sin(angle) * out, r: radius * range(0.28, 0.5) })
    }
    const count = Math.round(range(9, 18))
    const spin = range(0, 6.28)
    for (let i = 0; i < count && drops.length < LIMITS.drops; i++) {
      // a crown breaks into a ring of fingers, so the droplets leave in near even spokes and not at random
      const angle = spin + (i / count) * 6.283 + range(-0.13, 0.13)
      const out = range(0.5, 1.5) * (i % 3 === 0 ? 1.5 : 1)
      drops.push({ p: [s.x, 0.02, s.z], v: [Math.cos(angle) * out, range(0.9, 2), Math.sin(angle) * out], r: range(0.0035, 0.0095) * tuning.size })
    }
  }

  const step = (dt, time) => {
    for (const s of sources)
      if (time >= s.next) {
        s.next = time + range(...s.every) / tuning.rate
        spawnRunner(s)
      }

    for (let i = runners.length - 1; i >= 0; i--) {
      const r = runners[i]
      r.age += dt
      const swell = ease(r.age / r.well)
      r.radius = r.full * swell
      const n = normal(...r.p)
      // gravity along the surface, with a slow wander so that no two tears take the same line
      const along = [n[0] * n[1], n[1] * n[1] - 1, n[2] * n[1]]
      const pull = Math.hypot(...along)
      const wander = Math.sin(r.age * 1.3 + r.phase) * 0.03 * r.drift * swell
      const pace = r.speed * (0.5 + pull) * (1 + 0.4 * Math.sin(r.age * 0.8 + r.phase)) * swell * swell
      r.p[0] += (along[0] / (pull + 1e-3) * pace + wander) * dt
      r.p[1] += (along[1] / (pull + 1e-3)) * pace * dt
      r.p[2] += (along[2] / (pull + 1e-3)) * pace * dt
      settle(r.p)
      const gone = Math.abs(phi(...r.p)) > 0.03 || r.age > 90
      // past the point where the surface faces more down than out, metal lets go of it
      if ((n[1] < -0.45 || gone || atRim(r.p)) && swell > 0.99) {
        if (!gone || r.p[1] > lift) spawnStrand(r.p, r.full)
        runners.splice(i, 1)
      }
    }

    for (let i = strands.length - 1; i >= 0; i--) {
      const s = strands[i]
      if (s.falling) {
        // nothing here ever moves up. The top falls faster than the tip, so the tail shortens into the drop
        s.speed += 5.5 * dt
        s.tip -= s.speed * dt
        s.tail += 7 * dt
        s.top = Math.max(s.top - (s.speed + s.tail) * dt, s.tip + s.bulb * 2.2)
        if (s.tip <= 0) {
          splash(s)
          strands.splice(i, 1)
        }
        continue
      }
      s.age += dt
      s.show = ease(s.age / 1.8) // grows out of the metal it hangs from
      const length = s.top - s.tip
      // creeps while it is short, then its own weight takes it
      s.speed = Math.min(s.speed + dt * 0.03 * (1 + length * 5) * s.show, 0.42)
      s.tip -= s.speed * dt
      s.bulb = Math.min(s.bulb + dt * 0.0009, bulbLimit())
      s.neck = Math.max(s.root * 0.8 / (1 + length * 3.5), 0.0032)
      if (length > s.reach * tuning.length || s.tip < 0.22) s.letting += dt
      if (s.letting > 0) {
        // the root thins to the width of the neck before it lets go, or a wide stub would drop away from the face
        s.root += (s.neck - s.root) * Math.min(dt * 5, 1)
        s.letting += dt
        if (s.letting > 0.7) {
          s.falling = true
          s.tail = 0
          s.volume = 4.19 * s.bulb ** 3 + 3.14 * s.neck ** 2 * (s.top - s.tip) * 2.5 // the neck is the thin end of a thread that tapers
        }
      }
    }

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]
      d.v[1] -= 5.5 * dt
      for (let k = 0; k < 3; k++) d.p[k] += d.v[k] * dt
      if (d.p[1] <= d.r * 0.4) {
        if (Math.abs(d.p[0]) < floorHalf && Math.abs(d.p[2]) < floorHalf) stamps.push({ x: d.p[0], z: d.p[2], r: d.r * range(1.1, 1.6) })
        drops.splice(i, 1)
      }
    }
  }

  // whatever is on the mask or hanging from it goes with it. What has already let go keeps falling
  const setLower = (value) => {
    const move = value - pose.lower
    pose.lower = value
    for (const r of runners) r.p[1] -= move
    for (const s of strands)
      if (!s.falling) {
        s.top -= move
        s.tip -= move
      }
  }

  return { step, tuning, setTilt, setLower, setCarve, toField, runners, strands, drops, stamps }
}
