// The renderer, the camera, the baked field and the frame loop.
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export const query = new URLSearchParams(location.search)
export const param = (key, fallback) => {
  const v = query.get(key)
  if (v === null) return fallback
  return typeof fallback === 'number' ? Number(v) : v
}

const halfToFloat = (h) => {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 31
  const m = h & 1023
  if (e === 0) return s * m * 2 ** -24
  return s * (1 + m / 1024) * 2 ** (e - 15)
}

// Undoes tools/pack_field.mjs: the gzip in the browser, then each step added back on. The file is not called .gz because
// servers that see that serve it as compressed, the browser unzips it first, and this then has nothing to unzip.
const unpack = async (response) => {
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  const planes = new Uint8Array(await new Response(stream).arrayBuffer())
  const count = planes.length / 2
  const data = new Uint16Array(count)
  let last = 0
  for (let i = 0; i < count; i++) {
    last = (last + ((planes[i] << 8) | planes[count + i])) & 0xffff
    data[i] = last
  }
  return data
}

export async function loadField(name) {
  const base = `${import.meta.env.BASE_URL}sdf/${name}`
  const [meta, data] = await Promise.all([fetch(`${base}.json`).then((r) => r.json()), fetch(`${base}.field`).then(unpack)])
  const [nx, ny, nz] = meta.dims
  const texture = new THREE.Data3DTexture(data, nx, ny, nz)
  texture.format = THREE.RedFormat
  texture.type = THREE.HalfFloatType
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  const boxMin = new THREE.Vector3(...meta.origin)
  const boxSize = new THREE.Vector3(nx, ny, nz).multiplyScalar(meta.cell)
  const sample = (x, y, z) => halfToFloat(data[(z * ny + y) * nx + x])
  return { meta, data, texture, boxMin, boxSize, sample, nx, ny, nz }
}

export async function createStage({ title }) {
  if (!navigator.gpu) {
    document.body.innerHTML = '<p style="padding:24px">This demo needs WebGPU.</p>'
    throw new Error('no WebGPU')
  }
  // the default binding limit is 128 MB, and the grid passes that at 192 cells: past it, compute fails and only logs
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    document.body.innerHTML = '<p style="padding:24px">This demo needs WebGPU.</p>'
    throw new Error('no WebGPU adapter')
  }
  const big = Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize, 2 ** 31)
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    trackTimestamp: false,
    requiredLimits: { maxStorageBufferBindingSize: big, maxBufferSize: big },
  })
  const pixelRatio = param('dpr', 1)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)
  await renderer.init()

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15161a)
  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 40)
  camera.position.set(0.9, 1.25, 4.4)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1, 0)
  controls.enableDamping = true
  if (param('lock', 0)) controls.enabled = false // test windows are real windows, and pick up a passing mouse
  controls.update()

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  const hud = document.createElement('pre')
  hud.style.cssText =
    'position:fixed;left:12px;top:10px;margin:0;color:#d8d8d8;font:12px/1.45 ui-monospace,Menlo,monospace;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre'
  if (!param('stats', 0)) hud.style.display = 'none'
  document.body.appendChild(hud)
  document.title = title

  return { renderer, scene, camera, controls, hud, title }
}

// One frame is timed from submit to the GPU going idle. Waiting for the queue costs a little
// parallelism, so this reads slightly high: it is the honest cost of the work, not vsync's opinion.
export function createLoop(stage, { step, extraInfo, duration = 30 }) {
  const { renderer, scene, camera, controls, hud, title } = stage
  const device = renderer.backend.device
  const samples = []
  const wall = []
  let last = performance.now()
  let simTime = 0
  let frame = 0
  let running = true
  const bench = param('bench', 0) > 0
  const burst = param('burst', 0)
  const draw = param('draw', 1) > 0
  const bursts = []
  const dtFixed = 1 / 60

  const state = { paused: false, speed: param('speed', 1) }
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') state.paused = !state.paused
  })

  const tick = async () => {
    if (!running) return
    const t0 = performance.now()
    if (!state.paused) {
      step(dtFixed * state.speed, simTime)
      simTime += dtFixed * state.speed
    }
    controls.update()
    if (draw) renderer.render(scene, camera)
    await device.queue.onSubmittedWorkDone()
    const t1 = performance.now()
    // waiting on every frame can hide work, so a burst queues many frames and divides
    if (burst && frame % 90 === 89 && !state.paused) {
      const b0 = performance.now()
      for (let i = 0; i < burst; i++) {
        step(dtFixed * state.speed, simTime)
        simTime += dtFixed * state.speed
        if (draw) renderer.render(scene, camera)
      }
      await device.queue.onSubmittedWorkDone()
      bursts.push((performance.now() - b0) / burst)
      if (bursts.length > 12) bursts.shift()
    }
    frame++
    if (frame > 20) {
      samples.push(t1 - t0)
      wall.push(t0 - last)
    }
    last = t0
    if (samples.length > 240) {
      samples.shift()
      wall.shift()
    }
    if (frame % 15 === 0) {
      const s = [...samples].sort((a, b) => a - b)
      const mid = s[s.length >> 1] ?? 0
      const p95 = s[Math.floor(s.length * 0.95)] ?? 0
      hud.textContent = `${title}\n${mid.toFixed(1)} ms median   ${p95.toFixed(1)} ms p95   ${(1000 / Math.max(mid, 0.01)).toFixed(0)} fps possible\nt ${simTime.toFixed(1)} s   ${renderer.domElement.width}x${renderer.domElement.height}\n${extraInfo ? extraInfo() : ''}`
    }
    window.__melt = { frame, simTime, ...summary(samples), burst: bursts.at(-1), info: extraInfo?.() }
    if (bench && simTime >= duration) {
      running = false
      window.__meltDone = true
    }
    requestAnimationFrame(tick)
  }

  const summary = (list) => {
    const s = [...list].sort((a, b) => a - b)
    if (!s.length) return {}
    return { median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }
  }

  requestAnimationFrame(tick)
  return state
}
