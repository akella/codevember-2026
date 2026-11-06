// A chrome mask floating over a white floor, crying metal.
import * as THREE from 'three/webgpu'
import {
  Fn, If, Break, Loop, float, int, vec2, vec3, vec4, uvec2, uvec3, uniform, uniformArray, texture, texture3D, textureStore,
  instanceIndex, screenUV, positionGeometry, cameraPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, mix, max, min,
  clamp, dot, normalize, smoothstep, reflect, sin, sqrt, exp, select, pow, luminance, mx_noise_float,
} from 'three/tsl'
import GUI from 'three/addons/libs/lil-gui.module.min.js'
import { createStage, createLoop, loadField, param } from './stage.js'
import { createDrips, LIMITS } from './drips.js'
import { createMatcap, loadMatcaps, MATCAPS } from './matcap.js'

const stage = await createStage({ title: 'Melt · Codevember 2026' })
stage.hud.style.color = '#333'
stage.hud.style.textShadow = 'none'
const { renderer, scene, camera, controls } = stage
const models = { mannequin: 'mask-256', me: 'me-256' }
const savedModel = (() => {
  try {
    return JSON.parse(localStorage.getItem('melt-face-4') ?? '{}').model
  } catch {
    return undefined
  }
})()
const modelName = param('model', savedModel ?? 'me')
const field = await loadField(param('field', models[modelName] ?? models.me))

const lift = param('lift', 0.95)
const cell = field.meta.cell
camera.position.set(param('cx', 0.5), param('cy', 3.0), param('cz', 7.6))
controls.target.set(0, param('ty', 0.5), 0.1) // low enough to keep the floor, and what it mirrors, in frame
controls.update()

// the field sits at its baked place, raised off the floor
const boxMin = field.boxMin.clone().add(new THREE.Vector3(0, lift, 0))
const boxMax = boxMin.clone().add(field.boxSize)
const lo = uniform(boxMin)
const hi = uniform(boxMax)
const size = uniform(field.boxSize.clone())
const centre = uniform(boxMin.clone().add(boxMax).multiplyScalar(0.5))
const halfSize = uniform(field.boxSize.clone().multiplyScalar(0.5))
const sdf = texture3D(field.texture, null, 0)


// everything the panel can reach, in one place, remembered between visits
// a real face needs a softer metal than a mannequin: a hard mirror breaks its features into abstract shapes
// what the arrows step through. Each carries its own grade: saturation, say, neutralises a blue cast on a photographed
// matcap and would take the colour out of gold
// Each entry is a whole setup and not just a surface: what stands behind it, how it is cut, how it is held, how it drips.
const plain = {
  exposure: 1, contrast: 1, gamma: 1, saturation: 1, hollows: 0.55, spin: 0,
  hollowMask: false, wall: 0.11, ragged: 0, lamp: 0, backdrop: 'paper', shine: 0.75, shadow: 0.58, tilt: 20, dropSize: 1, dripRate: 1,
  jadeDepth: 3, jadeGlow: 1, jadeVeins: 0.6,
}
// darkened hollows suit a mirror, and on a soft surface they are dirty patches beside the nose
const soft = { ...plain, hollows: 0 }
const torn = { hollowMask: true, wall: 0.11, ragged: 0.3 }
const black = { backdrop: 'black' }
const materials = [
  { name: 'Chrome', matcap: 'studio', ...plain, ...torn, ...black, saturation: 0.3, tilt: 24 },
  { name: 'Silver', matcap: 'silver', ...plain, ...torn, exposure: 1.15, contrast: 1.15, spin: -20 },
  { name: 'Bronze', matcap: 'bronze', ...plain, ...black, exposure: 1.25, contrast: 1.1, spin: 30, tilt: 30 },
  { name: 'Jade', matcap: 'jade', ...soft },
  { name: 'Jade shell', matcap: 'jadeshell', ...soft, ...torn, ...black, jadeDepth: 13, lamp: 1.7, wall: 0.06 }, // thinner than the rest: the lamp has to get through it
  { name: 'Amber', matcap: 'amber', ...soft, ...black, exposure: 1.15, tilt: 28, dripRate: 0.7, dropSize: 1.3 },
  { name: 'Bone', matcap: 'bone', ...soft, ...torn, ...black, tilt: 14, dripRate: 0.6 },
  { name: 'Glass', matcap: 'glass', ...plain, ...torn },
  { name: 'Gradient', matcap: 'gradient', ...soft, ...black, exposure: 1.2, spin: 90 },
  { name: 'Obsidian', matcap: 'ball', ...plain, ...torn, tilt: 28 },
]
// only what the list uses gets loaded. Both jades are computed, and keep just the reflections of silver
const computed = ['jade', 'jadeshell']
const usedFiles = Object.fromEntries(materials.filter((m) => !computed.includes(m.matcap)).map((m) => [m.matcap, MATCAPS[m.matcap]]))
const matcaps = await loadMatcaps(usedFiles)
for (const name of computed) matcaps[name] = matcaps.silver
const matcapNames = materials.map((m) => m.matcap)
// framing, which stays put as the looks change
const composition = { lower: 0.3, dripLength: 0.55 }
const gradeOf = (matcap) => {
  const { name, ...grade } = materials.find((m) => m.matcap === matcap) ?? {}
  return grade
}
const forModel = { me: 'silver', mannequin: 'studio' }
const remembered = () => {
  try {
    return JSON.parse(localStorage.getItem('melt-face-4') ?? '{}')
  } catch {
    return {}
  }
}
// What is kept is the look and your changes to it, so a look improved later still reaches this browser
const saved = remembered()
const firstLook = param('matcap', matcaps[saved.matcap] ? saved.matcap : forModel[modelName])
const defaults = { model: modelName, ...composition, ...gradeOf(forModel[modelName]) }
const settings = { ...defaults, ...gradeOf(firstLook), ...(firstLook === saved.matcap ? saved : {}), matcap: firstLook, model: modelName }
for (const key of Object.keys(composition)) settings[key] = saved[key] ?? composition[key]
for (const key of Object.keys(defaults)) settings[key] = param(key, settings[key])
if (!matcaps[settings.matcap]) Object.assign(settings, defaults)
settings.hollowMask = [true, 'true', '1'].includes(settings.hollowMask)
// tips the mask back about the middle of the face, so tears roll across it and not just down it
const pivot = [0, lift + 1.15, 0.3]
const pose = { cos: uniform(1), sin: uniform(0), lower: uniform(settings.lower) }
const pivotNode = vec3(...pivot)
const intoField = (p) => {
  const d = p.sub(pivotNode).add(vec3(0, pose.lower, 0)).toVar()
  return vec3(d.x, pose.cos.mul(d.y).sub(pose.sin.mul(d.z)), pose.sin.mul(d.y).add(pose.cos.mul(d.z))).add(pivotNode)
}
const look = {
  exposure: uniform(settings.exposure),
  contrast: uniform(settings.contrast),
  gamma: uniform(settings.gamma),
  saturation: uniform(settings.saturation),
  spin: uniform((settings.spin * Math.PI) / 180),
  hollows: uniform(settings.hollows),
  shadow: uniform(settings.shadow),
  jade: uniform(0),
  jadeDepth: uniform(settings.jadeDepth),
  jadeGlow: uniform(settings.jadeGlow),
  jadeVeins: uniform(settings.jadeVeins),
  carve: uniform(0),
  wall: uniform(settings.wall),
  lamp: uniform(settings.lamp),
  ragged: uniform(settings.ragged),
  shine: uniform(settings.shine),
  paper: uniform(new THREE.Vector3()),
  dark: uniform(0),
}
// how much of the image is sphere: photographed matcaps stop short of the edge, and looking past it shows their backdrop
look.fit = uniform(0.495)
const matcap = createMatcap(matcaps[settings.matcap], { spin: look.spin, fit: look.fit })
// Green stone lets green through and stops red first, so colour follows thickness: pale where thin, deep where not
const jadeAbsorbs = vec3(6.5, 2.6, 4.2)
const passes = (thickness) => exp(jadeAbsorbs.mul(thickness).mul(look.jadeDepth).negate())
const polish = (n, rd) => {
  const facing = max(dot(n, rd.negate()), 0)
  const fresnel = pow(float(1).sub(facing), 5).mul(0.5).add(0.04)
  const seen = luminance(matcap.shade(n, rd))
  return vec3(0.84, 0.97, 0.88).mul(pow(seen, float(4)).mul(0.6).add(seen.mul(fresnel).mul(0.7)))
}
// One stone, whatever the size of the piece. The light through it depends on thickness and the dark body is always there
const stone = (along, towards, veins, n, rd) => {
  const room = passes(along).mul(vec3(0.5, 0.72, 0.56)).mul(mix(float(0.6), float(0.12), look.dark)) // no white room to see through
  const backlit = passes(towards).mul(vec3(0.72, 0.9, 0.62)).mul(look.jadeGlow).mul(0.75)
  const wrap = dot(n, light).mul(0.5).add(0.5)
  // a dark green that clouds pale in places, with the light coming through it as a glow on top
  const body = mix(vec3(0.016, 0.075, 0.05), vec3(0.2, 0.33, 0.25), veins).mul(wrap.mul(0.9).add(0.3))
  return body.add(room).add(backlit).add(polish(n, rd))
}
// nothing is thinner than this, and a round drop is deepest through its middle and palest at its rim
// scaled against density, so that a drop keeps its colour however dense the mask is set
const thinnest = (n, rd) => float(param('jadeThin', 0.27)).mul(float(3).div(look.jadeDepth)).mul(max(dot(n, rd.negate()), 0).mul(0.8).add(0.5))
const metal = (n, rd) => {
  const raw = matcap.shade(n, rd).toVar()
  const toned = mix(vec3(luminance(raw)), raw, look.saturation)
  const curved = pow(max(toned, vec3(0)), vec3(look.gamma))
  // contrast turns around mid grey, which is about 0.22 before the screen's gamma
  const graded = clamp(curved.sub(0.22).mul(look.contrast).add(0.22).mul(look.exposure), 0, 1)
  // beads and droplets: flat tops face the light and catch more of it than a hanging drop does
  const thin = thinnest(n, rd).mul(1.5).toVar()
  return mix(graded, stone(thin, thin, float(0.2), n, rd), look.jade)
}

const smin = (a, b, k) => {
  const h = max(k.sub(a.sub(b).abs()), 0).div(k)
  return min(a, b).sub(h.mul(h).mul(k).mul(0.25))
}

const smax = (a, b, k) => smin(a.negate(), b.negate(), k).negate()

// Metal lying on the mask: a thickness in a coarser volume, so the surface is simply the mask minus this.
// It joins the face with no seam, and a bead that sags slowly down it is one extra read.
const coarse = 2
const tx = Math.ceil(field.nx / coarse), ty = Math.ceil(field.ny / coarse), tz = Math.ceil(field.nz / coarse)
const makeLayer = (name) => {
  const t = new THREE.Storage3DTexture(tx, ty, tz)
  t.name = name
  t.format = THREE.RGBAFormat
  t.type = THREE.HalfFloatType
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping
  return t
}
const layerA = makeLayer('layerA')
const layerB = makeLayer('layerB')
const heads = uniformArray(Array.from({ length: LIMITS.runners }, () => new THREE.Vector4()), 'vec4')
const layerStep = (read, write) =>
  Fn(() => {
    const id = instanceIndex
    const coord = uvec3(id.mod(tx), id.div(tx).mod(ty), id.div(tx * ty))
    const texel = vec3(1 / tx, 1 / ty, 1 / tz)
    const uvw = vec3(coord).add(0.5).mul(texel).toVar()
    const p = lo.add(uvw.mul(size)).toVar()
    // a slow slump, and a slower fade, so that old tracks leave the face
    const here = texture3D(read, uvw, 0).x
    const above = texture3D(read, uvw.add(vec3(0, pose.cos, pose.sin).mul(texel)), 0).x // up in the room, not up the mask
    const thick = mix(here, above, float(param('slump', 0.018))).mul(param('fade', 0.9998)).toVar()
    for (let i = 0; i < LIMITS.runners; i++) {
      const head = heads.element(i)
      const d = p.sub(head.xyz)
      const r2 = max(head.w.mul(head.w), 1e-6)
      thick.assign(max(thick, exp(dot(d, d).div(r2).negate()).mul(head.w).mul(param('bead', 0.95))))
    }
    textureStore(write, coord, vec4(thick, 0, 0, 1)).toWriteOnly()
  })()
    .compute(tx * ty * tz)
    .setName('layerStep')
const layerPasses = [layerStep(layerA, layerB), layerStep(layerB, layerA)]
const layer = texture3D(layerA, null, 0)

// A real mask is a skin. Its inside is the front of the face smoothed right out and pushed back by the wall, so features
// stay thick, the hollows beside them go thin, the back is open, and the skin ends in a thin edge wherever the face curves
// away behind that surface. One height per column is enough, because a face has only a front.
const makeInner = () => {
  const step = 2
  const ix = Math.ceil(field.nx / step), iy = Math.ceil(field.ny / step)
  const front = new Float32Array(ix * iy)
  const seen = new Float32Array(ix * iy)
  for (let y = 0; y < iy; y++)
    for (let x = 0; x < ix; x++) {
      const gx = Math.min(x * step, field.nx - 1), gy = Math.min(y * step, field.ny - 1)
      for (let z = field.nz - 1; z >= 0; z--)
        if (field.sample(gx, gy, z) < 0) {
          front[y * ix + x] = field.boxMin.z + (z + 0.5) * cell
          seen[y * ix + x] = 1
          break
        }
    }
  // weighted, so that the empty room around the face does not drag its edges down
  const sigma = param('innerBlur', 0.1) / (cell * step)
  const r = Math.ceil(sigma * 3)
  const kernel = Array.from({ length: r * 2 + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const blur = (from, dx, dy) => {
    const out = new Float32Array(from.length)
    for (let y = 0; y < iy; y++)
      for (let x = 0; x < ix; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) {
          const cx = Math.min(ix - 1, Math.max(0, x + k * dx)), cy = Math.min(iy - 1, Math.max(0, y + k * dy))
          sum += from[cy * ix + cx] * kernel[k + r]
        }
        out[y * ix + x] = sum
      }
    return out
  }
  const weighted = front.map((v, i) => v * seen[i])
  const top = blur(blur(weighted, 1, 0), 0, 1)
  const bottom = blur(blur(seen, 1, 0), 0, 1)
  const height = top.map((v, i) => (bottom[i] > 1e-4 ? v / bottom[i] : field.boxMin.z))
  // Torn metal: a second channel the surface is pushed by, strong at the edge of the face and nothing in the middle of it,
  // so the rim tears in long tongues and the wall the light comes through stays smooth
  const whole = kernel.reduce((a, b) => a + b) ** 2
  const smooth01 = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const tear = new Float32Array(height.length)
  for (let y = 0; y < iy; y++)
    for (let x = 0; x < ix; x++) {
      const wx = field.boxMin.x + x * step * cell, wy = field.boxMin.y + y * step * cell
      const n = Math.sin(wx * 7.3 + wy * 3.1 + 1) + 0.7 * Math.sin(wy * 13 - wx * 6 + 2.2) + 0.4 * Math.sin(wx * 23 + wy * 17)
      const tongues = 1 - 2 * Math.abs(Math.sin(wx * 5.1 - wy * 2.7 + n * 0.8))
      tear[y * ix + x] = (tongues * 0.75 + n * 0.14) * 0.2 * (1 - smooth01(0.72, 0.995, bottom[y * ix + x] / whole))
    }
  const half = new Uint16Array(height.length * 2)
  for (let i = 0; i < height.length; i++) {
    half[i * 2] = THREE.DataUtils.toHalfFloat(height[i])
    half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(tear[i])
  }
  const t = new THREE.DataTexture(half, ix, iy, THREE.RGFormat, THREE.HalfFloatType)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  // for the drips: the same surface, in the field's own space
  const at = (x, y) => {
    const fx = Math.min(ix - 1, Math.max(0, (x - field.boxMin.x) / (cell * step)))
    const fy = Math.min(iy - 1, Math.max(0, (y - field.boxMin.y) / (cell * step)))
    const i = Math.round(fy) * ix + Math.round(fx)
    return height[i] + tear[i] * settings.ragged
  }
  return { texture: t, at, span: new THREE.Vector2(ix, iy).multiplyScalar(step * cell) }
}
const inner = makeInner()
const innerMap = texture(inner.texture)
const innerSpan = uniform(inner.span)
const carved = (p, outer) => {
  const inside = innerMap.sample(p.xy.sub(lo.xy).div(innerSpan)).level(0).toVar()
  const back = inside.r.add(inside.g.mul(look.ragged)).sub(look.wall).sub(p.z).mul(0.6)
  return select(look.carve.greaterThan(0.5), smax(outer, back, float(0.02)), outer)
}

const mask = Fn(([room]) => {
  const p = intoField(room).toVar()
  const outside = max(p.sub(centre).abs().sub(halfSize), vec3(0)).length()
  const uvw = p.sub(lo).div(size).toVar()
  return carved(p, sdf.sample(uvw).r.sub(layer.sample(uvw).x).add(outside))
}).setLayout({ name: 'mask', type: 'float', inputs: [{ name: 'room', type: 'vec3' }] })

// A strand: a thread hanging straight down with a bulb on its end. Each is two vec4s, so a ray can ask about them cheaply.
const strandTop = uniformArray(Array.from({ length: LIMITS.strands }, () => new THREE.Vector4(0, -9, 0, 0)), 'vec4') // x, top, z, root radius
const strandTip = uniformArray(Array.from({ length: LIMITS.strands }, () => new THREE.Vector4(0, -9, 0, 0)), 'vec4') // tip, neck radius, bulb radius, unused
const strandCount = uniform(0, 'int')
const strand = Fn(([p, i]) => {
  const a = strandTop.element(i).toVar()
  const b = strandTip.element(i).toVar()
  const y = clamp(p.y, b.x, a.y).toVar()
  const along = a.y.sub(y).div(max(a.y.sub(b.x), 0.001))
  // wide where it leaves the metal, a neck for most of its length, swelling into the bulb
  const radius = mix(mix(a.w, b.y, smoothstep(0, 0.3, along)), b.z.mul(0.8), smoothstep(0.72, 1, along))
  const stem = vec3(p.x.sub(a.x), p.y.sub(y), p.z.sub(a.z)).length().sub(radius)
  const q = vec3(p.x.sub(a.x), p.y.sub(b.x.add(b.z)), p.z.sub(a.z))
  const bulb = vec3(q.x, q.y.mul(select(q.y.greaterThan(0), float(0.5), float(1))), q.z).length().sub(b.z)
  return smin(stem, bulb, float(0.03))
}).setLayout({ name: 'strand', type: 'float', inputs: [{ name: 'p', type: 'vec3' }, { name: 'i', type: 'int' }] })

const normalOf = (map, p) => {
  const e = float(param('normalEps', 0.019)) // a real distance and not a number of cells: a coarser grid should not soften the face
  const k1 = vec3(1, -1, -1), k2 = vec3(-1, -1, 1), k3 = vec3(-1, 1, -1), k4 = vec3(1, 1, 1)
  return normalize(
    k1.mul(map(p.add(k1.mul(e)))).add(k2.mul(map(p.add(k2.mul(e)))))
      .add(k3.mul(map(p.add(k3.mul(e))))).add(k4.mul(map(p.add(k4.mul(e)))))
  )
}

const light = vec3(-0.1, 1, 0.14).normalize()
// marched past the box too: the mask's distance keeps counting outside it, and a penumbra is all about the near misses
const softShadow = (p, width) => {
  const lit = float(1).toVar()
  const t = float(0.05).toVar()
  Loop(30, () => {
    If(t.greaterThan(4.5), () => { Break() })
    const d = mask(p.add(light.mul(t))).toVar()
    lit.assign(min(lit, clamp(d.div(t.mul(width)).mul(0.5).add(0.5), 0, 1)))
    t.addAssign(clamp(d, 0.05, 0.3))
  })
  return lit.mul(lit).mul(float(3).sub(lit.mul(2)))
}

// The floor keeps every bead that lands on it: a height map, stamped only when something lands
const floorHalf = 2.2
const floorSize = param('floorRes', 2048)
const floorMap = new THREE.StorageTexture(floorSize, floorSize)
floorMap.name = 'beads'
floorMap.format = THREE.RGBAFormat
floorMap.type = THREE.HalfFloatType
floorMap.minFilter = THREE.LinearFilter
floorMap.magFilter = THREE.LinearFilter
const floorScratch = floorMap.clone()
const stampList = uniformArray(Array.from({ length: LIMITS.stamps }, () => new THREE.Vector4()), 'vec4')
const stampPass = (read, write) =>
  Fn(() => {
    const id = instanceIndex
    const coord = uvec2(id.mod(floorSize), id.div(floorSize))
    const uv = vec2(coord).add(0.5).div(floorSize).toVar()
    const q = uv.mul(floorHalf * 2).sub(floorHalf).toVar()
    const height = texture(read).sample(uv).level(0).x.toVar()
    for (let i = 0; i < LIMITS.stamps; i++) {
      const s = stampList.element(i)
      const d = q.sub(s.xy).length().div(max(s.z, 1e-4))
      // a bead is a paraboloid of squared height, and its square root the dome. Added, not maxed: beads that touch merge
      // like liquid, and one landing in a puddle swells it
      height.addAssign(max(float(1).sub(d.mul(d)), 0).mul(s.z).mul(s.z))
    }
    textureStore(write, coord, vec4(min(height, 0.006), 0, 0, 1)).toWriteOnly()
  })()
    .compute(floorSize * floorSize)
    .setName('stamp')
// one pass a batch, swapping sides: run twice it would add every bead twice
const stampPasses = [stampPass(floorMap, floorScratch), stampPass(floorScratch, floorMap)]
const beads = texture(floorMap)
let floorSide = 0
const stampFloor = () => {
  renderer.compute(stampPasses[floorSide])
  floorSide = 1 - floorSide
  beads.value = floorSide ? floorScratch : floorMap
}
const beadAt = (q) => sqrt(max(beads.sample(q.div(floorHalf * 2).add(0.5)).level(0).x, 0))

const dropList = uniformArray(Array.from({ length: LIMITS.drops }, () => new THREE.Vector4()), 'vec4')
const dropCount = uniform(0, 'int')

// How far a ray stays in stone from here: the one thing a matcap cannot know
const throughMask = (p, n, dir) => {
  const s = float(0.012).toVar()
  const start = p.sub(n.mul(0.01)).toVar()
  const last = float(-0.01).toVar()
  const taken = float(0.012).toVar()
  Loop(param('jadeSteps', 18), () => {
    const d = mask(start.add(dir.mul(s))).toVar()
    If(d.greaterThan(0.002), () => {
      // between the last step inside and this one: whole steps show up in the glow as contour lines
      s.subAssign(taken.mul(d.div(max(d.sub(last), 1e-4))))
      Break()
    })
    last.assign(d)
    taken.assign(max(d.negate().mul(0.9), 0.02))
    s.addAssign(taken)
    If(s.greaterThan(1.4), () => { Break() })
  })
  return s
}
const behind = vec3(-0.3, 0.72, -0.62).normalize()
const jade = (p, n, rd) => {
  const q = intoField(p).toVar()
  const cloud = mx_noise_float(q.mul(2.6)).add(mx_noise_float(q.mul(6.1)).mul(0.5))
  const veins = smoothstep(0.02, 0.62, cloud).mul(look.jadeVeins).toVar()
  // the floor is for drips: on a carved shell it would flatten the very differences that draw the face
  const onSkin = mask(p).lessThan(0.02).toVar() // and not a drip, which has its own floor and no lamp behind it
  const onShell = look.carve.greaterThan(0.5).and(onSkin)
  const least = select(onShell, float(0.015), thinnest(n, rd)).toVar()
  const along = max(throughMask(p, n, normalize(rd.sub(n.mul(0.45)))), least)
  const towards = max(throughMask(p, n, behind), least)
  const lit = stone(along, towards, veins, n, rd).toVar()
  // a lamp behind the mask: straight through the wall towards the eye, so the thickness itself draws the face
  If(look.lamp.greaterThan(0.001).and(onShell), () => {
    const wall = max(throughMask(p, n, rd), 0.02)
    lit.addAssign(passes(wall).mul(vec3(1, 0.96, 0.72)).mul(look.lamp).mul(1.6))
  })
  return lit
}

const fragment = Fn(() => {
  const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1), 1, 1)
  const view = cameraProjectionMatrixInverse.mul(ndc)
  const rd = normalize(cameraWorldMatrix.mul(vec4(view.xyz.div(view.w), 0)).xyz).toVar()
  const ro = vec3(cameraPosition).toVar()

  // a seamless white sheet: nothing marks the floor but what falls on it
  const paper = look.paper
  const color = paper.toVar()
  const floorT = select(rd.y.lessThan(-0.0001), ro.y.negate().div(rd.y), float(1e9)).toVar()
  const onBead = float(0).toVar()
  If(floorT.lessThan(1e8), () => {
    const q = ro.add(rd.mul(floorT)).toVar()
    If(q.xz.length().lessThan(5), () => {
      const shade = softShadow(q.add(vec3(0, 0.01, 0)), float(param('penumbra', 0.32))).toVar()
      // a thread is too thin to march for: how close the line to the light passes it is enough
      Loop(strandCount, ({ i }) => {
        const a = strandTop.element(i).toVar()
        const b = strandTip.element(i).toVar()
        const height = clamp(a.x.mul(0).add(a.y.add(b.x).mul(0.5)), 0, 4).toVar()
        const offset = q.xz.add(light.xz.div(light.y).mul(height)).sub(vec2(a.x, a.z))
        const span = a.y.sub(b.x).mul(0.5).mul(light.xz.length().div(light.y)).add(0.02)
        const near = offset.length().sub(span)
        const w = height.mul(0.05).add(0.012)
        shade.mulAssign(mix(float(0.75), float(1), smoothstep(0, w, near)))
      })
      // light that has come through jade lands green
      const shadowTint = mix(vec3(1), vec3(0.8, 1, 0.88), look.jade)
      color.assign(paper.mul(mix(shadowTint.mul(float(1).sub(look.shadow)), vec3(1), shade)))
      // in the dark, the lamp behind a jade mask lays a pool of green under it
      color.addAssign(vec3(0.05, 0.42, 0.2).mul(float(1).sub(shade)).mul(look.lamp).mul(look.dark).mul(0.1))

      const height = beadAt(q.xz).toVar()
      const off = beadAt(q.xz.sub(light.xz.mul(0.03)))
      color.mulAssign(float(1).sub(smoothstep(0, 0.012, off).mul(0.4)))
      If(height.greaterThan(0.0006), () => {
        onBead.assign(1)
        const e = float((floorHalf * 2 * 2.5) / floorSize) // wide, or the seams where beads merge show as grit
        const gx = beadAt(q.xz.add(vec2(e, 0))).sub(beadAt(q.xz.sub(vec2(e, 0))))
        const gz = beadAt(q.xz.add(vec2(0, e))).sub(beadAt(q.xz.sub(vec2(0, e))))
        const n = normalize(vec3(gx.negate(), e.mul(2), gz.negate()))
        color.assign(metal(n, rd))
      })
    })
  })

  // which strands could this ray meet at all? Four at most, found once, so nearly every pixel pays for none
  const c0 = int(-1).toVar()
  const c1 = int(-1).toVar()
  const c2 = int(-1).toVar()
  const c3 = int(-1).toVar()
  const flat = rd.xz.length().toVar()
  const side = rd.xz.div(max(flat, 1e-4)).toVar()
  Loop(strandCount, ({ i }) => {
    const a = strandTop.element(i).toVar()
    const b = strandTip.element(i).toVar()
    const to = vec2(a.x, a.z).sub(ro.xz)
    const miss = to.x.mul(side.y).sub(to.y.mul(side.x)).abs()
    If(miss.lessThan(max(a.w, b.z).mul(1.6).add(0.05)), () => {
      If(c0.lessThan(0), () => { c0.assign(i) })
        .ElseIf(c1.lessThan(0), () => { c1.assign(i) })
        .ElseIf(c2.lessThan(0), () => { c2.assign(i) })
        .ElseIf(c3.lessThan(0), () => { c3.assign(i) })
    })
  })
  const world = (p) => {
    const d = mask(p).toVar()
    const k = float(0.05)
    If(c0.greaterThanEqual(0), () => {
      d.assign(smin(d, strand(p, c0), k))
      If(c1.greaterThanEqual(0), () => {
        d.assign(smin(d, strand(p, c1), k))
        If(c2.greaterThanEqual(0), () => {
          d.assign(smin(d, strand(p, c2), k))
          If(c3.greaterThanEqual(0), () => { d.assign(smin(d, strand(p, c3), k)) })
        })
      })
    })
    return d
  }

  // A polished black floor. A mirror is the same scene seen from a camera flipped under it, and flipping changes nothing in
  // x and z, so the strands this ray might meet are the same ones the flipped ray might meet.
  If(look.dark.mul(look.shine).greaterThan(0.01).and(floorT.lessThan(20)).and(onBead.lessThan(0.5)), () => {
    const mirrorFrom = vec3(ro.x, ro.y.negate(), ro.z).toVar()
    const mirrorDir = vec3(rd.x, rd.y.negate(), rd.z).toVar()
    const toFace = pivotNode.sub(vec3(0, pose.lower, 0)).sub(mirrorFrom).toVar()
    If(toFace.sub(mirrorDir.mul(dot(toFace, mirrorDir))).length().lessThan(2.2), () => {
      const s = floorT.add(0.01).toVar()
      const found = float(0).toVar()
      const q = vec3(0).toVar()
      Loop(64, () => {
        q.assign(mirrorFrom.add(mirrorDir.mul(s)))
        const d = world(q).toVar()
        If(d.lessThan(0.003), () => {
          found.assign(1)
          Break()
        })
        s.addAssign(max(d.mul(0.85), 0.004))
        If(q.y.greaterThan(3.6), () => { Break() })
      })
      If(found.greaterThan(0.5), () => {
        // strong close to the floor and gone by the height of the face, which is what keeps a floor looking like a floor
        const strength = exp(q.y.mul(-0.4)).mul(look.shine).mul(look.dark)
        color.assign(mix(color, metal(normalOf(world, q), mirrorDir), strength))
      })
    })
  })

  const top = float(hi.value.y + 0.5) // room for the mask to tip
  const startT = max(top.sub(ro.y).div(rd.y).mul(select(rd.y.lessThan(0), float(1), float(0))), 0).toVar()
  const end = min(floorT, float(14)).toVar()
  const t = startT.toVar()
  const hit = float(0).toVar()
  Loop(110, () => {
    const d = world(ro.add(rd.mul(t))).toVar()
    If(d.lessThan(0.0012), () => {
      hit.assign(1)
      Break()
    })
    t.addAssign(max(d.mul(0.8), 0.0015))
    If(t.greaterThan(end), () => { Break() })
  })
  If(hit.greaterThan(0.5), () => {
    const p = ro.add(rd.mul(t)).toVar()
    const n = normalOf(world, p).toVar()
    const r = reflect(rd, n).toVar()
    const seen = metal(n, rd).toVar()

    // Hollows darken by how tightly the surface closes around a cone along the reflection. A hard hit or miss here
    // leaves a dotted line along every edge of it, and a mirror has nowhere to hide that.
    const start = p.add(n.mul(0.012)).toVar()
    const open = float(1).toVar()
    const s = float(0.03).toVar()
    Loop(12, () => {
      const d = mask(start.add(r.mul(s))).toVar()
      open.assign(min(open, clamp(d.div(s.mul(0.45)), 0, 1)))
      s.addAssign(clamp(d, 0.02, 0.09))
    })
    If(look.jade.greaterThan(0.5), () => { seen.assign(jade(p, n, rd)) })
    seen.mulAssign(mix(float(1).sub(look.hollows), float(1), smoothstep(0, 1, open)))
    color.assign(seen)
  })

  // droplets in the air: too small and too quick to need more than a ray against a sphere
  const nearest = select(hit.greaterThan(0.5), t, end).toVar()
  Loop(dropCount, ({ i }) => {
    const s = dropList.element(i).toVar()
    const oc = ro.sub(s.xyz).toVar()
    const bb = dot(oc, rd).toVar()
    const disc = bb.mul(bb).sub(dot(oc, oc)).add(s.w.mul(s.w)).toVar()
    If(disc.greaterThan(0), () => {
      const th = bb.negate().sub(sqrt(disc)).toVar()
      If(th.greaterThan(0).and(th.lessThan(nearest)), () => {
        nearest.assign(th)
        color.assign(metal(normalize(ro.add(rd.mul(th)).sub(s.xyz)), rd))
      })
    })
  })
  return vec4(color, 1)
})

const material = new THREE.NodeMaterial()
material.vertexNode = vec4(positionGeometry.xy, 0, 1)
material.fragmentNode = fragment()
material.depthTest = false
material.depthWrite = false
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
quad.frustumCulled = false
scene.add(quad)

const drips = createDrips(field, { lift, floorHalf, pivot })
drips.setCarve((x, y, z) => (settings.hollowMask ? inner.at(x, y - lift) - settings.wall - z : -1))
renderer.compute(layerPasses)
stampFloor() // both sides built now, or the first splash stalls a third of a second while the shaders compile
stampFloor()

const clearFloor = [floorMap, floorScratch].map((target) =>
  Fn(() => {
    const id = instanceIndex
    textureStore(target, uvec2(id.mod(floorSize), id.div(floorSize)), vec4(0)).toWriteOnly()
  })().compute(floorSize * floorSize).setName('clearFloor'),
)

const gui = new GUI({ title: 'Melt' })
if (!param('panel', 0)) gui.close() // the arrows are the way in, and this is for those who go looking
if (param('film', 0)) gui.hide()
const save = () => {
  try {
    const base = { ...composition, ...gradeOf(settings.matcap) }
    const changed = Object.fromEntries(Object.entries(base).filter(([key, value]) => settings[key] !== value).map(([key]) => [key, settings[key]]))
    localStorage.setItem('melt-face-4', JSON.stringify({ ...changed, matcap: settings.matcap, model: settings.model }))
  } catch {
    // private windows refuse; the panel still works, it just forgets
  }
}
const backdrops = { paper: new THREE.Vector3(0.86, 0.855, 0.84), black: new THREE.Vector3(0.004, 0.004, 0.005) }
const backdropTarget = new THREE.Vector3()
let darkTarget = 0
// the arrows are for anyone who comes across the piece, so they are plain page controls and not part of the panel
const picker = document.createElement('div')
const applyAll = () => {
  matcap.node.value = matcaps[settings.matcap]
  for (const key of ['exposure', 'contrast', 'gamma', 'saturation', 'hollows', 'shadow', 'jadeDepth', 'jadeGlow', 'jadeVeins']) look[key].value = settings[key]
  look.jade.value = computed.includes(settings.matcap) ? 1 : 0
  look.carve.value = settings.hollowMask ? 1 : 0
  look.lamp.value = settings.lamp
  look.ragged.value = settings.ragged
  look.shine.value = settings.shine
  const onBlack = settings.backdrop === 'black'
  backdropTarget.copy(onBlack ? backdrops.black : backdrops.paper)
  darkTarget = onBlack ? 1 : 0
  const ink = onBlack ? '#d8d8d8' : '#333'
  stage.hud.style.color = ink
  picker.style.color = onBlack ? '#eee' : '#222'
  look.fit.value = param('fit', ['amber', 'bone'].includes(settings.matcap) ? 0.455 : 0.495)
  look.wall.value = settings.wall
  look.spin.value = (settings.spin * Math.PI) / 180
  const tilt = (settings.tilt * Math.PI) / 180
  pose.cos.value = Math.cos(tilt)
  pose.sin.value = Math.sin(tilt)
  drips.setTilt(tilt)
  pose.lower.value = settings.lower
  drips.setLower(settings.lower)
  drips.tuning.length = settings.dripLength
  drips.tuning.size = settings.dropSize
  drips.tuning.rate = settings.dripRate
  showMaterial()
  save()
}
// a different field means different texture sizes: simplest to come back with it
gui.add(settings, 'model', Object.keys(models)).onChange((name) => {
  Object.assign(settings, gradeOf(forModel[name]), { matcap: forModel[name], model: name })
  save()
  const url = new URL(location.href)
  url.searchParams.delete('model')
  location.href = url
})
gui.add(settings, 'lower', -0.2, 0.8, 0.01).name('lower face').onChange(applyAll)
gui.add(settings, 'tilt', -15, 45, 1).name('look up').onChange(applyAll)
gui.add(settings, 'hollowMask').name('hollow mask').onChange(applyAll)
gui.add(settings, 'wall', 0.03, 0.3, 0.005).name('mask wall').onChange(applyAll)
gui.add(settings, 'ragged', 0, 2, 0.01).name('ragged edge').onChange(applyAll)
const metalFolder = gui.addFolder('Metal')
metalFolder.add(settings, 'matcap', matcapNames).onChange((name) => {
  // a known material brings its own grade, or the last one's saturation follows it in
  Object.assign(settings, gradeOf(name))
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
  applyAll()
})
metalFolder.add(settings, 'exposure', 0.3, 2.5, 0.01).onChange(applyAll)
metalFolder.add(settings, 'contrast', 0.4, 2.5, 0.01).onChange(applyAll)
metalFolder.add(settings, 'gamma', 0.4, 2, 0.01).onChange(applyAll)
metalFolder.add(settings, 'saturation', 0, 1, 0.01).onChange(applyAll)
metalFolder.add(settings, 'spin', -180, 180, 1).name('turn lights').onChange(applyAll)
metalFolder.add(settings, 'hollows', 0, 1, 0.01).onChange(applyAll)
const jadeFolder = gui.addFolder('Jade')
jadeFolder.add(settings, 'jadeDepth', 0.3, 5, 0.01).name('density').onChange(applyAll)
jadeFolder.add(settings, 'jadeGlow', 0, 3, 0.01).name('backlight').onChange(applyAll)
jadeFolder.add(settings, 'jadeVeins', 0, 1, 0.01).name('veins').onChange(applyAll)
jadeFolder.add(settings, 'lamp', 0, 3, 0.01).name('lamp behind').onChange(applyAll)
const dripFolder = gui.addFolder('Drips')
dripFolder.add(settings, 'dripLength', 0.15, 1.5, 0.01).name('drip length').onChange(applyAll)
dripFolder.add(settings, 'dropSize', 0.4, 2, 0.01).name('drop size').onChange(applyAll)
dripFolder.add(settings, 'dripRate', 0.2, 3, 0.01).name('drip rate').onChange(applyAll)
const floorFolder = gui.addFolder('Floor')
floorFolder.add(settings, 'backdrop', ['paper', 'black']).name('background').onChange(applyAll)
floorFolder.add(settings, 'shine', 0, 1, 0.01).name('reflection').onChange(applyAll)
floorFolder.add(settings, 'shadow', 0, 1, 0.01).onChange(applyAll)
floorFolder.add({ clear: () => renderer.compute(clearFloor) }, 'clear').name('clear floor')
picker.style.cssText = 'position:fixed;left:50%;bottom:calc(44px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:4px;font:500 15px/1 ui-sans-serif,system-ui,sans-serif;color:#222;user-select:none'
const arrow = (label, glyph, step) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = glyph
  b.setAttribute('aria-label', label)
  b.style.cssText = 'width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:inherit;font:300 26px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;touch-action:manipulation'
  b.addEventListener('click', () => stepMaterial(step))
  return b
}
const title = document.createElement('span')
title.setAttribute('aria-live', 'polite')
title.style.cssText = 'min-width:96px;text-align:center'
picker.append(arrow('Previous material', '‹', -1), title, arrow('Next material', '›', 1))
document.body.appendChild(picker)
const currentMaterial = () => materials.findIndex((m) => m.matcap === settings.matcap)
const showMaterial = () => {
  title.textContent = materials[currentMaterial()]?.name ?? settings.matcap
}
const stepMaterial = (step) => {
  const at = currentMaterial()
  const next = materials[(Math.max(at, 0) + step + materials.length) % materials.length]
  Object.assign(settings, gradeOf(next.matcap))
  gui.controllersRecursive().forEach((c) => c.updateDisplay())
  applyAll()
}
addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea')) return
  if (e.code === 'ArrowLeft') stepMaterial(-1)
  if (e.code === 'ArrowRight') stepMaterial(1)
})

gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(settings)) }, 'copy').name('copy settings')
gui.add({ reset: () => { Object.assign(settings, composition, gradeOf(settings.matcap)); gui.controllersRecursive().forEach((c) => c.updateDisplay()); applyAll() } }, 'reset').name('reset')
applyAll()
look.paper.value.copy(backdropTarget)
look.dark.value = darkTarget

const syncDrips = () => {
  heads.array.forEach((v, i) => {
    const r = drips.runners[i]
    if (r) v.set(...drips.toField(...r.p), r.radius)
    else v.set(0, -9, 0, 0)
  })
  strandCount.value = drips.strands.length
  drips.strands.forEach((s, i) => {
    strandTop.array[i].set(s.x, s.top, s.z, s.root * s.show)
    strandTip.array[i].set(s.tip, s.neck * s.show, s.bulb * s.show, 0)
  })
  dropCount.value = drips.drops.length
  drips.drops.forEach((d, i) => dropList.array[i].set(d.p[0], d.p[1], d.p[2], d.r))
  if (drips.stamps.length) {
    stampList.array.forEach((v) => v.set(0, 0, 0, 0))
    drips.stamps.splice(0, LIMITS.stamps).forEach((s, i) => stampList.array[i].set(s.x, s.z, s.r, 0))
    stampFloor()
  }
}

const warp = param('warp', 0)
let clock = 0
const advance = (dt) => {
  clock += dt
  drips.step(dt, clock)
  syncDrips()
  renderer.compute(layerPasses)
}

// ?film=1 hands the clock to tools/film.mjs: every frame is stepped and drawn on request, so a recording is not at the mercy
// of the frame rate, and two looks can be drawn from the one moment of the same sim
if (param('film', 0)) {
  const pickLook = (matcap) => {
    Object.assign(settings, gradeOf(matcap), { matcap })
    applyAll()
    look.paper.value.copy(backdropTarget)
    look.dark.value = darkTarget
  }
  const device = renderer.backend.device
  window.__film = {
    pickLook,
    async warm(steps) {
      for (let i = 0; i < steps; i++) {
        advance(1 / 60)
        if (i % 120 === 119) await device.queue.onSubmittedWorkDone()
      }
      await device.queue.onSubmittedWorkDone()
    },
    step: () => advance(1 / 60),
    // the read has to come in the same task as the draw, while the frame is still the canvas's
    shoot(matcap, degrees, radius, height, target) {
      if (settings.matcap !== matcap) pickLook(matcap)
      const a = (degrees * Math.PI) / 180
      camera.position.set(Math.sin(a) * radius, height, 0.1 + Math.cos(a) * radius)
      camera.lookAt(0, target, 0.1)
      camera.updateMatrixWorld()
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/jpeg', 0.97)
    },
  }
} else {
  createLoop(stage, {
    duration: 1e9,
    extraInfo: () => `${drips.runners.length} runners, ${drips.strands.length} strands, ${drips.drops.length} droplets`,
    step: (dt) => {
      look.paper.value.lerp(backdropTarget, 0.05)
      look.dark.value += (darkTarget - look.dark.value) * 0.05
      for (let i = clock < warp ? 8 : 1; i > 0; i--) advance(dt)
    },
  })
}
