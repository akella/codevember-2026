// Bolt, the second page: lightning in clouds. The clouds are VDBs (JangaFX's CloudPack, CC0) packed for the page by
// tools/pack-clouds.py and put together into one block of density; see clouds.wgsl for the rest.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Color, PerspectiveCamera, Vector3 } from "three";
import type { V3 } from "../blades.ts";
import { random, strike } from "../bolt.ts";
import { frameCap } from "../cap.ts";
import cloudCode from "./clouds.wgsl?raw";
import showCode from "../show.wgsl?raw";

const LOOP = 10;
const TAKES = 4;
const GLOWS = 7;
const DIM: V3 = [640, 288, 416]; // voxels of the block
const VOXEL = 0.01;
const HALF: V3 = [3.2, 1.44, 2.08];
const GLOW: V3 = [160, 72, 104]; // of its light
const LEVELS = 4;

export const look = {
  seed: 4,
  cell: 0.03,
  eta: 4.5,
  rho: 2,
  forks: 3,
  sparks: 18,
  stray: 0.12,
  // the bolt
  core: 0.0028,
  hot: 34,
  hotTone: "#cdd4ff",
  skin: 3,
  skinTone: "#7f8bff",
  skinWide: 5,
  branches: 0.6,
  // the clouds
  thick: 300,
  aside: 0.25,
  step: 0.009,
  fray: 0.6,
  fraySize: 0.85,
  // light
  flash: 0.42,
  flashTone: "#a9b2ff",
  shade: 1,
  shadeDeep: 0.03,
  moon: 0.05,
  moonTone: "#8aa6d8",
  moonTurn: 140,
  moonHigh: 38,
  sky: 0.03,
  skyTone: "#33415f",
  lots: 8, // quarter millions of photons for each bolt
  // the eye
  fov: 32,
  far: 6.2,
  high: -0.35,
  lookAt: -0.1,
  sway: 8,
  // the picture
  exposure: 1,
  bloom: 0.09,
  spread: 0.85,
  colour: 1.05,
  grain: 0.025,
  vignette: 0.7,
  detail: 1.1, // millions of pixels the clouds are marched with
};
const ranges: Record<string, [number, number, number]> = {
  seed: [1, 99, 1], cell: [0.015, 0.1, 0.001], eta: [2.5, 10, 0.1], rho: [1, 4, 0.1], forks: [0, 12, 1], sparks: [0, 160, 1], stray: [0, 1, 0.01],
  core: [0.001, 0.03, 0.0005], hot: [0, 100, 0.5], skin: [0, 30, 0.1], skinWide: [1, 20, 0.1], branches: [0, 2, 0.05],
  thick: [5, 600, 1], aside: [0.05, 1, 0.01], step: [0.004, 0.05, 0.001], fray: [0, 3, 0.05], fraySize: [0.2, 4, 0.05],
  flash: [0, 4, 0.01], shade: [0, 1, 0.01], shadeDeep: [0.01, 0.3, 0.005], moon: [0, 0.6, 0.005], moonTurn: [-180, 180, 1], moonHigh: [0, 90, 1], sky: [0, 0.4, 0.005], lots: [1, 64, 1],
  fov: [10, 80, 1], far: [2, 20, 0.1], high: [-4, 6, 0.05], lookAt: [-2, 2, 0.05], sway: [0, 60, 1],
  exposure: [0.1, 4, 0.01], bloom: [0, 0.6, 0.005], spread: [0.3, 1.2, 0.01], colour: [0, 2, 0.01], grain: [0, 0.1, 0.005], vignette: [0, 1.5, 0.01], detail: [0.1, 4, 0.1],
};
const regrow = new Set(["seed", "cell", "eta", "rho", "forks", "sparks", "stray"]);
const relight = new Set(["thick", "aside", "lots", "moonTurn", "moonHigh"]);

// which clouds, and how they stand: middle, turned about, over (head down), how large, how strong
const SPOTS: { cloud: string; at: V3; turn: number; over?: boolean; size: number; power: number }[] = [
  { cloud: "05", at: [0.2, 0.72, -0.1], turn: 0.2, over: true, size: 1.25, power: 1 },
  { cloud: "02", at: [-0.9, -0.35, 0.85], turn: 0.5, size: 0.72, power: 1 },
  { cloud: "03", at: [0.95, -0.2, -1.0], turn: 2.7, size: 0.95, power: 1 },
  { cloud: "07", at: [1.75, -0.75, 0.75], turn: -0.6, size: 0.5, power: 1 },
];
const WAY: V3[] = [
  [-1.7, 0.75, -0.2],
  [-0.9, 0.35, 0.2],
  [-0.15, 0.55, 0.3],
  [0.35, 0.1, -0.1],
  [-0.1, -0.35, 0.15],
  [0.5, -0.7, 0.1],
  [0.25, -1.38, 0.2],
];

const tone = (hex: string, power = 1) => new Color(hex).toArray().map((v) => v * power);
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const STROKES = (() => {
  const rand = random(33);
  const out: { t: number; take: number; gain: number }[] = [];
  let t = 2;
  while (t < 7.8) {
    out.push({ t, take: out.length % TAKES, gain: out.length ? 0.5 + 0.5 * rand() : 1.2 });
    t += out.length % 3 ? 0.14 + 0.16 * rand() : 0.6 + 0.6 * rand();
  }
  return out;
})();

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU is not available");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  const HDR: GPUTextureFormat = "rgba16float";
  const cloudModule = device.createShaderModule({ code: cloudCode });
  const showModule = device.createShaderModule({ code: showCode });
  const ADD: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
  const paint = (m: GPUShaderModule, entryPoint: string, format: GPUTextureFormat, add = false, vertex = "vert") =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: m, entryPoint: vertex },
      fragment: { module: m, entryPoint, targets: [{ format, blend: add ? ADD : undefined }] },
    });
  const compute = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: cloudModule, entryPoint } });
  const composePipe = paint(cloudModule, "compose", "r8unorm");
  const shrinkPipe = paint(cloudModule, "shrink", "r8unorm");
  const roughPipe = paint(cloudModule, "roughen", "r8unorm");
  const marchPipe = paint(cloudModule, "march", HDR);
  const overPipe = paint(cloudModule, "over", HDR);
  const sparkPipe = paint(cloudModule, "spark", HDR, true, "ribbon");
  const grainPipe = compute("makeGrain");
  const photonsPipe = compute("photons");
  const settlePipe = compute("settle");
  const moonPipe = compute("moonlight");
  const downPipe = paint(showModule, "down", HDR);
  const upPipe = paint(showModule, "up", HDR, true);
  const showPipe = paint(showModule, "frag", format);

  const uniform = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(19 * 4);
  const params = uniform(data.byteLength);
  const wires = uniform(64);
  const shown = uniform(48);
  const sliceBuffer = uniform(16 + 4 * 48);
  const bakeBuffer = uniform(48);
  const linear: GPUSamplerDescriptor = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
  const lin = device.createSampler(linear);
  const rep = device.createSampler({ ...linear, addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
  const volume = (size: V3, format: GPUTextureFormat, usage: number, mipLevelCount = 1) =>
    device.createTexture({ size, dimension: "3d", format, mipLevelCount, usage: GPUTextureUsage.TEXTURE_BINDING | usage });
  type Bound = GPUBuffer | GPUTextureView | GPUTexture | GPUSampler;
  const bind = (of: GPURenderPipeline | GPUComputePipeline, entries: Record<number, Bound>) =>
    device.createBindGroup({
      layout: of.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([binding, e]) => ({
        binding: +binding,
        resource: e instanceof GPUBuffer ? { buffer: e } : e instanceof GPUTexture ? e.createView() : e,
      })),
    });

  const state = { frame: 0, hold: null as number | null, time: 0, scale: 1, skies: 1, busy: 1, pieces: 0, baked: 0, loaded: 0 };

  // the clouds, from the server
  const t0 = performance.now();
  const clouds = await Promise.all(
    SPOTS.map(async ({ cloud }) => {
      const answer = await fetch(`${import.meta.env.BASE_URL}clouds/${cloud}.vol`);
      const bytes = await new Response(answer.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const [w, h, d, most] = new Float32Array(bytes, 0, 4);
      const tex = volume([w, h, d], "r8unorm", GPUTextureUsage.COPY_DST);
      device.queue.writeTexture({ texture: tex }, new Uint8Array(bytes, 16), { bytesPerRow: w, rowsPerImage: h }, [w, h, d]);
      return { tex, half: [w, h, d].map((v) => (v * VOXEL) / 2) as V3, most };
    }),
  );
  state.loaded = performance.now() - t0;

  const R = GPUTextureUsage.RENDER_ATTACHMENT;
  const dense = volume(DIM, "r8unorm", R, LEVELS);
  const rough = volume(DIM.map((v) => v / 8) as V3, "r8unorm", R);
  const grain = volume([96, 96, 96], "rgba8unorm", GPUTextureUsage.STORAGE_BINDING);
  const still = volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING);
  const glows = Array.from({ length: TAKES }, () => volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING));
  const tallied = device.createBuffer({ size: GLOW[0] * GLOW[1] * GLOW[2] * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const put = (slot: number, ...v: number[]) => data.set(v, slot * 4);
  const settings = () => {
    put(5, ...HALF, VOXEL);
    put(6, look.thick, look.aside, look.step, look.shadeDeep);
    const [turn, high] = [(look.moonTurn * Math.PI) / 180, (look.moonHigh * Math.PI) / 180];
    put(10, Math.sin(turn) * Math.cos(high), Math.sin(high), Math.cos(turn) * Math.cos(high));
  };

  // one slice after another of a block
  const slices = (pipe: GPURenderPipeline, to: GPUTexture, level: number, entries: Record<number, Bound>, spots?: Float32Array) => {
    const n = Math.max(1, to.depthOrArrayLayers >> level);
    const bound = bind(pipe, { 11: sliceBuffer, ...entries });
    for (let z = 0; z < n; z++) {
      const head = new Float32Array(4 + 48);
      head.set([z, SPOTS.length]);
      if (spots) head.set(spots, 4);
      device.queue.writeBuffer(sliceBuffer, 0, head);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.createView({ baseMipLevel: level, mipLevelCount: 1 }), depthSlice: z, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bound);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
  };
  const compose = () => {
    settings();
    device.queue.writeBuffer(params, 0, data);
    const spots = new Float32Array(48);
    SPOTS.forEach((s, i) =>
      spots.set([Math.cos(s.turn), Math.sin(s.turn), s.size, s.over ? -1 : 1, ...s.at, s.power, ...clouds[i].half, clouds[i].most], i * 12),
    );
    slices(composePipe, dense, 0, { 0: params, 1: lin, 12: clouds[0].tex, 13: clouds[1].tex, 14: clouds[2].tex, 15: clouds[3].tex }, spots);
    for (let level = 1; level < LEVELS; level++) slices(shrinkPipe, dense, level, { 16: dense.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) });
    slices(roughPipe, rough, 0, { 16: dense.createView({ baseMipLevel: 2, mipLevelCount: 1 }) });
  };
  const once = (pipe: GPUComputePipeline, entries: Record<number, Bound>, groups: [number, number?, number?]) => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind(pipe, entries));
    pass.dispatchWorkgroups(...groups);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  once(grainPipe, { 17: grain }, [24, 24, 24]);

  // the bolts
  type Take = { first: number; count: number; main: number; mean: number; run: number };
  let takes: Take[] = [];
  let pieces: GPUBuffer;
  let toBake: number[] = [];
  let baking: { take: number; lot: number } | null = null;
  const growAll = () => {
    const rand = random(look.seed * 101);
    const all: number[] = [];
    let way = WAY;
    let old: V3[][] | undefined;
    takes = [];
    for (let k = 0; k < TAKES; k++) {
      const bolt = strike(way, look.seed * 31 + k, { ...look, old, keep: old ? 2 : 0, floor: -99 });
      old ??= bolt.path;
      const main = bolt.pieces.filter((p) => p.main);
      const rest = bolt.pieces.filter((p) => !p.main);
      const run = main.reduce((s, p) => s + Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]), 0);
      takes.push({ first: all.length / 8, count: main.length + rest.length, main: main.length, mean: run / main.length, run });
      for (const p of [...main, ...rest]) all.push(...p.a, p.lum * (p.main ? 1 : -1), ...p.b, p.s);
      way = WAY.map((p) => p.map((v) => v + (rand() - 0.5) * 2 * look.stray) as V3);
    }
    pieces?.destroy();
    pieces = device.createBuffer({ size: all.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(pieces, 0, new Float32Array(all));
    state.pieces = all.length / 8 / TAKES;
    toBake = takes.map((_, i) => i);
    baking = null;
    binds.clear();
  };
  const binds = new Map<string, GPUBindGroup>();
  const GROUPS = GLOW.map((v) => v / 4) as V3;
  const moonBake = () => {
    settings();
    device.queue.writeBuffer(params, 0, data);
    device.queue.writeBuffer(bakeBuffer, 32, new Uint32Array([...GLOW, 0]));
    once(moonPipe, { 0: params, 1: lin, 2: dense, 18: bakeBuffer, 21: still }, GROUPS);
  };
  const bakeSome = (lots: number) => {
    if (!baking) {
      if (!toBake.length) return;
      baking = { take: toBake.shift()!, lot: 0 };
      const clear = device.createCommandEncoder();
      clear.clearBuffer(tallied);
      device.queue.submit([clear.finish()]);
    }
    const take = takes[baking.take];
    const LOT = 1 << 18;
    const cell = (VOXEL * 4) ** 3;
    const head = (turn: number) => {
      const buffer = new ArrayBuffer(48);
      new Uint32Array(buffer).set([take.first, take.main, turn, 0]);
      // (the light through a cell: the length of the ways through it, over its room; a unit of bolt gives out 1)
      new Float32Array(buffer).set([(VOXEL * 4 * take.run) / (look.lots * LOT * 64 * cell), take.mean], 4);
      new Uint32Array(buffer).set([...GLOW, 0], 8);
      device.queue.writeBuffer(bakeBuffer, 0, buffer);
    };
    for (let i = 0; i < lots && baking.lot < look.lots; i++, baking.lot++) {
      head(baking.lot);
      once(photonsPipe, { 0: params, 1: lin, 2: dense, 9: pieces, 18: bakeBuffer, 19: tallied }, [LOT / 64]);
    }
    if (baking.lot < look.lots) return;
    head(0);
    once(settlePipe, { 18: bakeBuffer, 20: tallied, 21: glows[baking.take] }, GROUPS);
    baking = null;
  };
  compose();
  moonBake();
  growAll();

  // the pictures
  let pics: {
    key: string;
    marched: GPUTextureView;
    full: GPUTextureView;
    glows: GPUTextureView[];
    over: GPUBindGroup;
    down: GPUBindGroup[];
    up: GPUBindGroup[];
    show: GPUBindGroup;
    all: GPUTexture[];
  } | null = null;
  const makePics = (key: string, w: number, h: number, cw: number, ch: number) => {
    pics?.all.forEach((t) => t.destroy());
    const all: GPUTexture[] = [];
    const tex = (w: number, h: number) => {
      const t = device.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | R });
      all.push(t);
      return t.createView();
    };
    const marched = tex(w, h);
    const full = tex(cw, ch);
    const gl = Array.from({ length: GLOWS }, (_, i) => tex(cw >> (i + 1), ch >> (i + 1)));
    pics = {
      key,
      marched,
      full,
      glows: gl,
      all,
      over: bind(overPipe, { 0: params, 1: lin, 22: marched }),
      down: gl.map((_, i) => bind(downPipe, { 1: i ? gl[i - 1] : full, 2: lin })),
      up: gl.slice(1).map((g) => bind(upPipe, { 0: shown, 1: g, 2: lin })),
      show: bind(showPipe, { 0: shown, 1: full, 2: lin, 3: gl[0] }),
    };
  };

  const camera = new PerspectiveCamera(look.fov, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const placeEye = () => {
    camera.position.set(0, look.high, look.far);
    controls.target.set(0, look.lookAt, 0);
    controls.update();
  };
  placeEye();

  const moment = (t: number) => {
    const list: { take: number; head: number; lead: number; front: number; fire: number }[] = [];
    const out = 1 - ease(clamp((t - 7.8) / 1.1));
    let last = -1;
    STROKES.forEach((s, i) => {
      if (t >= s.t) last = i;
    });
    if (last < 0) {
      const k = clamp((t - 0.5) / (STROKES[0].t - 0.5));
      const along = Math.pow(k, 1.6) * 26;
      const head = k <= 0 ? -1 : (Math.floor(along) + ease(clamp((along % 1) * 3))) / 26;
      list.push({ take: STROKES[0].take, head, lead: k > 0 ? 0.14 : 0, front: 2, fire: 0 });
    } else
      for (const i of [last, last - 1]) {
        if (i < 0) continue;
        const s = STROKES[i];
        const age = t - s.t;
        const next = STROKES[i + 1]?.t ?? Infinity;
        const buzz = 1 + 0.1 * Math.sin(age * 91 + i) + 0.07 * Math.sin(age * 203 + i * 2);
        let fire = s.gain * (0.35 + 0.65 * Math.exp(-age / 0.17)) * buzz * out;
        if (i !== last) fire *= Math.exp(-(t - next) / 0.06);
        list.push({ take: s.take, head: i === 0 && age < 0.07 ? 2 : -1, lead: i === 0 ? 0.14 : 0, front: i === 0 ? 1.05 - 1.2 * clamp(age / 0.07) : -1, fire: fire < 0.003 ? 0 : fire });
      }
    return list;
  };

  const stats = new Stats();
  document.body.append(stats.dom);
  const gui = new GUI();
  const folders: Record<string, (keyof typeof look)[]> = {
    bolt: ["seed", "cell", "eta", "rho", "forks", "sparks", "stray", "core", "hot", "hotTone", "skin", "skinTone", "skinWide", "branches"],
    clouds: ["thick", "aside", "step", "fray", "fraySize"],
    light: ["flash", "flashTone", "shade", "shadeDeep", "moon", "moonTone", "moonTurn", "moonHigh", "sky", "skyTone", "lots"],
    eye: ["fov", "far", "high", "lookAt", "sway"],
    picture: ["exposure", "bloom", "spread", "colour", "grain", "vignette", "detail"],
  };
  const changed = (k: string) => {
    if (regrow.has(k)) growAll();
    if (relight.has(k)) {
      moonBake();
      toBake = takes.map((_, i) => i);
      baking = null;
    }
    if (["far", "high", "lookAt"].includes(k)) placeEye();
  };
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name).close();
    for (const k of keys) {
      const c = typeof look[k] === "string" ? f.addColor(look, k) : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
      if (regrow.has(k) || relight.has(k)) c.onFinishChange(() => changed(k));
      else c.onChange(() => changed(k));
    }
  }
  gui.close();
  const play = { pause: false };
  gui.add(play, "pause");

  const cap = frameCap(60);
  let clock = 0;
  let before = performance.now();
  const [right, up, fore, eye] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  wrap.render = () => {
    if (state.hold === null && !cap()) return;
    const now = performance.now();
    if (!play.pause && !(state.busy && clock < 0.05)) clock += Math.min(0.1, (now - before) / 1000);
    before = now;
    const t = (((state.hold ?? clock) % LOOP) + LOOP) % LOOP;
    state.time = t;
    const [cw, ch] = [canvas.width, canvas.height];
    const share = Math.min(1, Math.sqrt((look.detail * 1e6) / (cw * ch)));
    const [w, h] = [Math.max(16, Math.round(cw * share)), Math.max(16, Math.round(ch * share))];
    const key = `${w} ${h} ${cw} ${ch}`;
    if (pics?.key !== key) makePics(key, w, h, cw, ch);

    controls.update();
    camera.aspect = cw / ch;
    const half = Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.25 / camera.aspect);
    const turn = ((look.sway * Math.PI) / 180) * Math.sin((t / LOOP) * 2 * Math.PI);
    eye.copy(camera.position).sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), turn).add(controls.target);
    fore.copy(controls.target).sub(eye).normalize();
    right.crossVectors(fore, new Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, fore);
    settings();
    put(0, w, h, (2 * half) / h, t);
    put(1, ...eye.toArray(), 0);
    put(2, ...right.multiplyScalar(half * camera.aspect).toArray(), 0);
    put(3, ...up.multiplyScalar(half).toArray(), 0);
    put(4, ...fore.toArray(), 0);
    const list = moment(t);
    const wire = new Float32Array(16);
    put(7, 0, 0, 0, 0);
    put(8, 0, 0, 0, 0);
    list.forEach((m, k) => {
      const shines = (s: number) => (s > m.front ? m.fire : 0) + (s < m.head ? m.lead * 0.15 : 0);
      put(7 + k, ...[0, 1, 2, 3].map((q) => [0.125, 0.375, 0.625, 0.875].reduce((v, f) => v + shines((q + f) / 4) / 4, 0)));
      wire.set([m.front, m.fire, 0, 0, m.head, m.lead, 0, 0], k * 8);
    });
    device.queue.writeBuffer(wires, 0, wire);
    put(9, ...tone(look.flashTone, look.flash), look.shade);
    put(11, ...tone(look.moonTone, look.moon));
    put(12, ...tone(look.skyTone, look.sky * 10));
    put(13, look.fray, look.fraySize);
    put(14, ...tone(look.hotTone, look.hot));
    put(15, ...tone(look.skinTone, look.skin));
    put(16, look.core, look.branches, look.skinWide);
    put(17, cw, ch, (2 * half) / ch);
    device.queue.writeBuffer(params, 0, data);
    device.queue.writeBuffer(
      shown,
      0,
      new Float32Array([cw, ch, look.exposure, look.grain, state.hold === null ? state.frame % 64 : 0, look.vignette, look.bloom, look.spread, (2 * half) / h, 1, look.colour, 1]),
    );
    bakeSome(state.frame < 3 ? 0 : 1);
    state.busy = toBake.length + (baking ? 1 : 0);

    const p = pics!;
    const encoder = device.createCommandEncoder();
    const pass = (to: GPUTextureView, load: boolean, run: (p: GPURenderPassEncoder) => void) => {
      const r = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: load ? "load" : "clear", storeOp: "store" }] });
      run(r);
      r.end();
    };
    const draw = (to: GPUTextureView, pipe: GPURenderPipeline, bound: GPUBindGroup, load = false) =>
      pass(to, load, (r) => {
        r.setPipeline(pipe);
        r.setBindGroup(0, bound);
        r.draw(3);
      });
    const [a, b] = [list[0]?.take ?? 0, list[1]?.take ?? list[0]?.take ?? 0];
    const pair = `${a} ${b}`;
    let marchBind = binds.get(pair);
    if (!marchBind) {
      marchBind = bind(marchPipe, { 0: params, 1: lin, 2: dense, 3: rough, 4: still, 5: glows[a], 6: glows[b], 7: grain, 8: rep });
      binds.set(pair, marchBind);
    }
    let sparkBind = binds.get("spark");
    if (!sparkBind) {
      sparkBind = bind(sparkPipe, { 0: params, 1: lin, 2: dense, 7: grain, 8: rep, 9: pieces, 10: wires });
      binds.set("spark", sparkBind);
    }
    draw(p.marched, marchPipe, marchBind);
    draw(p.full, overPipe, p.over);
    pass(p.full, true, (r) => {
      r.setPipeline(sparkPipe);
      r.setBindGroup(0, sparkBind);
      list.forEach((m, k) => r.draw(6, takes[m.take].count, k * 1000, takes[m.take].first));
    });
    p.down.forEach((b, i) => draw(p.glows[i], downPipe, b));
    for (let i = GLOWS - 2; i >= 0; i--) draw(p.glows[i], upPipe, p.up[i], true);
    draw(context.getCurrentTexture().createView(), showPipe, p.show);
    device.queue.submit([encoder.finish()]);
    state.frame++;
    stats.update();
  };
  wrap.resize = () => {};
  wrap.unload = () => {
    gui.destroy();
    stats.dom.remove();
    controls.dispose();
    device.destroy();
  };
  Object.assign(window, { __bolt: { look, state, changed, device, camera, controls, compose, SPOTS, WAY, growAll, moonBake, render: () => wrap.render!({} as never) } });
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: LOOP * 1000,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch as Sketch<"webgpu">, settings);
