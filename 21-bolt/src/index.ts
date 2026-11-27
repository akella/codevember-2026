// Bolt: shards of glass stacked into a bolt, and lightning let down through them on to a wet floor.
//
// The glass is flat-faced and every ray exact (trace.wgsl), so there is no noise; the floor's mirror picture is
// traced sharp and blurred afterwards (show.wgsl). The lightning is grown once, a few takes of it (bolt.ts).
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { at, BLADES, len, packBlades, sculpture, sub, type V3 } from "./blades.ts";
import { coarse, random, strike, tree } from "./bolt.ts";
import { frameCap } from "./cap.ts";
import traceCode from "./trace.wgsl?raw";
import showCode from "./show.wgsl?raw";

const LOOP = 10; // seconds
const TAKES = 6; // of the lightning
const LONG = 10; // coarse pieces of one (as in trace.wgsl)
const BOXES = 6;
const GLOWS = 7;
const MAP = 1024; // texels across a map of the light on the floor
const LOT = 1 << 20; // photons at a time

const NAMES = [
  "size",
  "eye",
  "right",
  "up",
  "fore",
  "bolt",
  "hot",
  "skin",
  "glow",
  "haze",
  "lit",
  "lamp",
  "back",
  "back2",
  "room",
  "glass",
  "tint",
  "dust",
  "sheen",
  "floor",
  "tile",
  "tune",
  "maps",
  "thrown",
] as const;
type Name = (typeof NAMES)[number];
const paramsCode = `struct Params {\n${NAMES.map((n) => `  ${n}: vec4f,`).join("\n")}\n};\n`;

export const look = {
  seed: 5,
  // the lightning
  cell: 0.07,
  eta: 4.5,
  rho: 2,
  forks: 4,
  sparks: 60,
  stray: 0.22, // how far the next stroke's way is from the last's
  core: 0.0075,
  hot: 20,
  hotTone: "#ffc27a",
  skin: 0.7,
  skinTone: "#ff7a1e",
  branches: 0.5,
  haze: 0.011,
  hazeTone: "#ff8a35",
  hazeNear: 0.28,
  shine: 1.05, // its light on things
  shineTone: "#ff9a48",
  // the glass
  ior: 1.5,
  coat: 0.12,
  bevel: 0.008,
  bevelShine: 0.35,
  bevelLamp: 0.5,
  tint: "#1d2126",
  soak: 0.35,
  dust: 0.03,
  waves: 0.012,
  veil: 0.022, // how much of the lamps the wiped faces hold
  sheen: 1.4, // of the bolt, smeared along wiped faces
  sheenWide: 0.16,
  edgeRays: 2, // more rays for a pixel an edge goes through
  // the room
  lampPower: 2.4,
  lampTone: "#bcd2ff",
  lampSoft: 0.5,
  back: "#0b0f16",
  backLow: "#0e131c",
  fog: 0.012,
  // the floor
  caustics: 14, // the light on it that comes by way of glass, over what it would be
  castTone: "#ffb468", // what colour that is
  bends: 0.08, // how far apart the glass bends its colours
  ripple: 0.14, // how uneven the faces are to it
  hots: 4, // how many places it comes from, where the bolt touches glass, from the lowest; and how wide they are
  hotWide: 0.02,
  crisp: 2, // how much more the bright of it shows than the dim
  reach: 9, // how far each way the maps of that go
  lots: 40, // millions of photons for each
  stone: 0.07,
  mirror: 0.45,
  roughLow: 0.004,
  roughHigh: 0.03,
  tilt: 0.004,
  tile: 3.1,
  seam: 0.02,
  // the eye
  fov: 34,
  far: 22,
  high: 4.4,
  lookAt: 3.7,
  sway: 10,
  // the picture
  exposure: 1.05,
  bloom: 0.1,
  spread: 0.85,
  colour: 1.08,
  grain: 0.02,
  vignette: 0.45,
  detail: 1.6, // millions of pixels it is traced with, at most
  adapt: true, // fewer while frames come late
  rays: 16,
  cutoff: 0.035,
  dimFine: 0.15, // rays dimmer than this leave out the branches, the haze, and the light on what they meet
  dimHaze: 0.25,
  dimLit: 0.15,
  cost: false,
};
const ranges: Record<string, [number, number, number]> = {
  seed: [1, 99, 1],
  cell: [0.04, 0.2, 0.005],
  eta: [2.5, 10, 0.1],
  rho: [1, 4, 0.1],
  forks: [0, 12, 1],
  sparks: [0, 160, 1],
  stray: [0, 1, 0.01],
  core: [0.003, 0.06, 0.001],
  hot: [0, 60, 0.5],
  skin: [0, 6, 0.05],
  branches: [0, 2, 0.05],
  haze: [0, 0.2, 0.001],
  hazeNear: [0.01, 0.5, 0.005],
  shine: [0, 5, 0.05],
  ior: [1, 2.2, 0.01],
  coat: [0, 0.6, 0.01],
  bevel: [0, 0.06, 0.001],
  bevelShine: [0, 4, 0.05],
  bevelLamp: [0, 6, 0.05],
  soak: [0, 2, 0.01],
  dust: [0, 0.2, 0.001],
  waves: [0, 0.1, 0.001],
  veil: [0, 0.4, 0.002],
  sheen: [0, 8, 0.05],
  sheenWide: [0.02, 0.6, 0.01],
  edgeRays: [0, 8, 1],
  lampPower: [0, 8, 0.05],
  lampSoft: [0.02, 1, 0.01],
  fog: [0, 0.15, 0.001],
  caustics: [0, 30, 0.1],
  bends: [0, 0.3, 0.005],
  ripple: [0, 0.4, 0.005],
  hots: [1, 8, 1],
  crisp: [1, 3, 0.05],
  hotWide: [0.005, 0.5, 0.005],
  reach: [3, 20, 0.5],
  lots: [1, 200, 1],
  stone: [0, 0.4, 0.005],
  mirror: [0, 0.6, 0.01],
  roughLow: [0, 0.2, 0.001],
  roughHigh: [0, 0.4, 0.001],
  tilt: [0, 0.1, 0.001],
  tile: [0.5, 8, 0.1],
  seam: [0, 0.1, 0.002],
  fov: [15, 80, 1],
  far: [8, 50, 0.1],
  high: [0.3, 14, 0.1],
  lookAt: [0, 10, 0.1],
  sway: [0, 60, 1],
  exposure: [0.1, 4, 0.01],
  bloom: [0, 0.6, 0.005],
  spread: [0.3, 1.2, 0.01],
  colour: [0, 2, 0.01],
  grain: [0, 0.1, 0.005],
  vignette: [0, 1.5, 0.01],
  detail: [0.2, 9, 0.1],
  rays: [1, 60, 1],
  dimFine: [0, 1, 0.01],
  dimHaze: [0, 1, 0.01],
  dimLit: [0, 1, 0.01],
  cutoff: [0.001, 0.1, 0.001],
};
const rebake = new Set(["ior", "coat", "waves", "tint", "soak", "reach", "lots", "bends", "ripple", "hots", "hotWide", "crisp"]);
const regrow = new Set(["hots", "seed", "cell", "eta", "rho", "forks", "sparks", "stray"]);

// the way down: from over the picture, by the glass's edges, to the floor
const WAY: V3[] = [
  at(-60, -20, 0.5),
  at(150, 165, 0.4),
  at(335, 290, 0.35),
  at(525, 360, 0.2),
  at(352, 520, 0.35),
  at(500, 660, 0.6),
  at(735, 770, 0.3),
  at(700, 865, 0.6),
  at(600, 960, 0.2),
  [0.5, 0.02, 0.9],
];

// the lamps: middle, half across, half up, how strong, and how far from white (red, green)
const LAMPS: { c: V3; u: V3; v: V3; power: number }[] = [
  { c: [3, 17, -4], u: [7, 0, 0], v: [0, 0.6, 3.2], power: 2.4 },
  { c: [-13, 9, 3], u: [0, 0, 3.5], v: [0.6, 5, 0], power: 1.2 },
  { c: [13, 6, 4], u: [0, 0, -2.2], v: [-0.5, 5.5, 0], power: 1.5 },
  { c: [5, 9, 17], u: [2.2, 0, 0.3], v: [0, 4.5, -1], power: 0.9 },
  { c: [-9, 13, 10], u: [3, 0, 2], v: [0.5, 1.5, -2.5], power: 1.3 },
  { c: [7.6, 5.5, -13], u: [0.55, 0, 0], v: [0, 3.2, 0], power: 0.4 },
];

const tone = (hex: string, power = 1) => new Color(hex).toArray().map((v) => v * power);
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// when the strokes come, which take each is, and how bright
const STROKES = (() => {
  const rand = random(21);
  const out: { t: number; take: number; gain: number }[] = [];
  let t = 1.9;
  let take = 0;
  while (t < 7.6) {
    out.push({ t, take: take++ % TAKES, gain: out.length ? 0.55 + 0.45 * rand() : 1.25 });
    t += out.length % 3 ? 0.14 + 0.16 * rand() : 0.5 + 0.5 * rand();
  }
  return out;
})();
const DARK = 8.6; // it is out by then

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

  const module = (code: string) => device.createShaderModule({ code });
  const paint = (m: GPUShaderModule, entryPoint: string, formats: GPUTextureFormat[], add = false) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: m, entryPoint: "vert" },
      fragment: {
        module: m,
        entryPoint,
        targets: formats.map((format) => ({
          format,
          blend: add
            ? { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } }
            : undefined,
        })),
      },
    });
  const HDR: GPUTextureFormat = "rgba16float";
  const traceModule = module(paramsCode + traceCode);
  const tracePipe = paint(traceModule, "frag", [HDR, HDR, HDR]);
  // pixels an edge goes through are listed, traced some more, and those mixed in
  const MARKS = 1 << 18;
  const compute = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: traceModule, entryPoint } });
  const gatherPipe = compute("gather");
  const mendPipe = compute("mend");
  const marked = device.createBuffer({ size: 16 + MARKS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const more = device.createBuffer({ size: MARKS * 48, usage: GPUBufferUsage.STORAGE });
  const asked = device.createBuffer({ size: 32, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const countPipe = compute("count");
  const photonsPipe = compute("photons");
  const settlePipe = compute("settle");
  const openPipe = compute("open");
  const mixPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: traceModule, entryPoint: "spot" },
    fragment: {
      module: traceModule,
      entryPoint: "blend",
      targets: [HDR, HDR, HDR].map((format) => ({
        format,
        blend: {
          color: { srcFactor: "constant", dstFactor: "one-minus-constant" },
          alpha: { srcFactor: "constant", dstFactor: "one-minus-constant" },
        } as GPUBlendState,
      })),
    },
    primitive: { topology: "point-list" },
  });
  const showModule = module(showCode);
  const halvePipe = paint(showModule, "halve", [HDR]);
  const joinPipe = paint(showModule, "join", [HDR]);
  const downPipe = paint(showModule, "down", [HDR]);
  const upPipe = paint(showModule, "up", [HDR], true);
  const showPipe = paint(showModule, "frag", [format]);

  const uniform = (size: number, usage = GPUBufferUsage.UNIFORM) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(NAMES.length * 4);
  const params = uniform(data.byteLength);
  const put = (name: Name, ...v: number[]) => data.set(v, NAMES.indexOf(name) * 4);
  const blades = sculpture();
  const bladeData = packBlades(blades);
  const bladeBuffer = uniform(bladeData.byteLength);
  device.queue.writeBuffer(bladeBuffer, 0, bladeData);
  const sceneData = new Float32Array((2 * 2 + 2 + BOXES * 3 + LONG * 4) * 4);
  const scene = uniform(sceneData.byteLength);
  const shown = uniform(48);
  const soft = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });

  // a picture of noise that repeats (see `noise` in trace.wgsl)
  const noises = (() => {
    const [n, cells] = [512, 32];
    const rand = random(77);
    const octave = (cells: number) => {
      const grid = Float32Array.from({ length: cells * cells }, rand);
      const out = new Float32Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const [u, v] = [(x / n) * cells, (y / n) * cells];
          const [i, j] = [Math.floor(u), Math.floor(v)];
          const [a, b] = [ease(u - i), ease(v - j)];
          const at = (p: number, q: number) => grid[(q % cells) * cells + (p % cells)];
          out[y * n + x] = (at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - b) + (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * b;
        }
      return out;
    };
    const os = [1, 2, 4, 8].map((k) => octave(cells * k));
    const [g, h] = [octave(cells), octave(cells)];
    let level: Float32Array[] = [os[0].map((v, i) => 0.5 * v + 0.25 * os[1][i] + 0.125 * os[2][i] + 0.0625 * os[3][i]), g, h];
    const t = device.createTexture({ size: [n, n], format: "rgba8unorm", mipLevelCount: 10, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    for (let m = 0, w = n; m < 10; m++, w >>= 1) {
      const bytes = new Uint8Array(w * w * 4);
      level.forEach((l, c) => l.forEach((v, i) => (bytes[i * 4 + c] = Math.round(v * 255))));
      device.queue.writeTexture({ texture: t, mipLevel: m }, bytes, { bytesPerRow: w * 4 }, [w, w]);
      const s = w >> 1;
      if (s)
        level = level.map((l) =>
          Float32Array.from({ length: s * s }, (_, i) => {
            const k = (i % s) * 2 + Math.floor(i / s) * 2 * w;
            return (l[k] + l[k + 1] + l[k + w] + l[k + w + 1]) / 4;
          }),
        );
    }
    return t.createView();
  })();
  const rep = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });

  // the lightning
  type Take = { from: number; mid: number; to: number; hot: V3[]; chord: number; long: { a: V3; b: V3; s: number }[] };
  let takes: Take[] = [];
  let nodes: GPUBuffer;
  let pieces: GPUBuffer;
  const state = { frame: 0, hold: null as number | null, pieces: 0, grown: 0, time: 0, scale: 1, skies: 1, busy: 1 };
  const growAll = () => {
    const t0 = performance.now();
    const rand = random(look.seed * 101);
    let way = WAY;
    let old: V3[][] | undefined;
    const all: { nodes: Float32Array; pieces: Float32Array; count: number }[] = [];
    takes = [];
    let [n0, p0] = [0, 0];
    for (let k = 0; k < TAKES; k++) {
      const bolt = strike(way, look.seed * 31 + k, { ...look, old, keep: old ? 2 : 0 });
      old ??= bolt.path;
      // the channel in a tree of its own, so that dim rays can leave out the rest
      const wide = () => look.core * 5;
      const parts = [bolt.pieces.filter((p) => p.main), bolt.pieces.filter((p) => !p.main)].map((list) => {
        const t = tree(list, wide);
        const count = t.nodes.length / 8;
        for (let i = 0; i < count; i++) {
          t.nodes[i * 8 + 3] += n0;
          if (t.nodes[i * 8 + 7] >= 0) t.nodes[i * 8 + 7] += p0 * 8;
        }
        all.push(t);
        n0 += count;
        p0 += t.count;
        return count;
      });
      const long = coarse(bolt, LONG);
      const run = (list: { a: V3; b: V3 }[]) => list.reduce((s, p) => s + len(sub(p.b, p.a)), 0);
      takes.push({ from: n0 - parts[0] - parts[1], mid: n0 - parts[1], to: n0, hot: way.slice(-1 - look.hots), chord: run(long), long });
      way = WAY.map((p, i) => (i ? (p.map((v, c) => (c === 1 && i === WAY.length - 1 ? v : v + (rand() - 0.5) * 2 * look.stray)) as V3) : p));
    }
    const buffer = (list: Float32Array[]) => {
      const b = device.createBuffer({
        size: list.reduce((s, a) => s + a.byteLength, 0),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      let at = 0;
      for (const a of list) {
        device.queue.writeBuffer(b, at, a as Float32Array<ArrayBuffer>);
        at += a.byteLength;
      }
      return b;
    };
    nodes?.destroy();
    pieces?.destroy();
    nodes = buffer(all.map((a) => a.nodes));
    pieces = buffer(all.map((a) => a.pieces));
    state.pieces = p0 / TAKES;
    state.grown = performance.now() - t0;
    traceBind = mendBind = null;
    toBake = takes.map((_, i) => i);
    baking = null;
  };

  type Bound = GPUBuffer | GPUTextureView | GPUSampler;
  const bind = (of: GPURenderPipeline | GPUComputePipeline, entries: Record<number, Bound>) =>
    device.createBindGroup({
      layout: of.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([binding, e]) => ({ binding: +binding, resource: e instanceof GPUBuffer ? { buffer: e } : e })),
    });
  let traceBind: GPUBindGroup | null = null;
  let mendBind: GPUBindGroup | null = null;

  // the light on the floor: for each bolt, photons followed through the glass, and what comes straight
  const LEVELS = 7;
  const floorMap = () =>
    device.createTexture({
      size: [MAP, MAP, TAKES],
      format: HDR,
      mipLevelCount: LEVELS,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  const floors = floorMap();
  const sharp = device.createTexture({ size: [MAP, MAP], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  const slant = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 8 });
  const tallied = device.createBuffer({ size: MAP * MAP * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bakeBuffer = uniform(32 + 12 * 16);
  let toBake: number[] = [];
  let baking: { take: number; lot: number } | null = null;
  const bakeSome = (lots: number) => {
    if (!baking) {
      if (!toBake.length) return;
      baking = { take: toBake.shift()!, lot: 0 };
      const clear = device.createCommandEncoder();
      clear.clearBuffer(tallied);
      device.queue.submit([clear.finish()]);
    }
    const take = takes[baking.take];
    const run = (pipe: GPUComputePipeline, entries: Record<number, Bound>, lot: number, groups: [number, number?]) => {
      const buffer = new ArrayBuffer(32 + 12 * 16);
      new Uint32Array(buffer).set([lot, MAP]);
      const texel = (2 * look.reach) / MAP;
      const n = take.hot.length;
      new Float32Array(buffer).set([(4 * Math.PI * take.chord) / (look.lots * LOT) / (texel * texel), take.chord, look.bends, look.ripple, look.hotWide, n], 2);
      take.hot.forEach((h, i) => new Float32Array(buffer).set([h[0], Math.max(h[1], 0.3), h[2], h[1] < 0.1 ? 0.22 : 1], 8 + i * 4));
      device.queue.writeBuffer(bakeBuffer, 0, buffer);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bind(pipe, { 16: bakeBuffer, ...entries }));
      pass.dispatchWorkgroups(...groups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    };
    for (let i = 0; i < lots && baking.lot < look.lots; i++, baking.lot++)
      run(photonsPipe, { 0: params, 1: bladeBuffer, 11: noises, 12: rep, 17: tallied }, baking.lot, [LOT / 64]);
    if (baking.lot < look.lots) return;
    const layer = (t: GPUTexture, level: number) => t.createView({ dimension: "2d", baseArrayLayer: baking!.take, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 });
    run(openPipe, { 0: params, 1: bladeBuffer, 18: sharp.createView() }, 0, [MAP / 8, MAP / 8]);
    run(settlePipe, { 18: layer(floors, 0), 19: tallied, 20: sharp.createView() }, 0, [MAP / 8, MAP / 8]);
    const encoder = device.createCommandEncoder();
    for (let level = 1; level < LEVELS; level++) draw(encoder, [layer(floors, level)], halvePipe, bind(halvePipe, { 1: layer(floors, level - 1), 2: soft }));
    device.queue.submit([encoder.finish()]);
    baking = null;
  };
  growAll();
  const countBind = bind(countPipe, { 0: params, 6: marked, 8: asked });
  const mixBind = bind(mixPipe, { 0: params, 9: marked, 10: more });

  // the pictures, made again when the size changes
  let pics: {
    size: [number, number];
    seen: GPUTextureView;
    aux: GPUTextureView;
    mirrored: GPUTextureView;
    mirrors: GPUTextureView[];
    joined: GPUTextureView;
    glows: GPUTextureView[];
    binds: { gather: GPUBindGroup; halve: GPUBindGroup[]; join: GPUBindGroup; down: GPUBindGroup[]; up: GPUBindGroup[]; show: GPUBindGroup };
    all: GPUTexture[];
  } | null = null;
  const makePics = (w: number, h: number) => {
    pics?.all.forEach((t) => t.destroy());
    const all: GPUTexture[] = [];
    const tex = (w: number, h: number, mipLevelCount = 1) => {
      const t = device.createTexture({
        size: [Math.max(1, w), Math.max(1, h)],
        format: HDR,
        mipLevelCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      all.push(t);
      return t;
    };
    const seen = tex(w, h).createView();
    const aux = tex(w, h).createView();
    const levels = 7;
    const mirrorTex = tex(w, h, levels);
    const mirrors = Array.from({ length: levels }, (_, i) => mirrorTex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    const mirrored = mirrorTex.createView();
    const joined = tex(w, h).createView();
    const glows = Array.from({ length: GLOWS }, (_, i) => tex(w >> (i + 1), h >> (i + 1)).createView());
    pics = {
      size: [w, h],
      seen,
      aux,
      mirrored,
      mirrors,
      joined,
      glows,
      all,
      binds: {
        gather: bind(gatherPipe, { 0: params, 5: seen, 6: marked }),
        halve: mirrors.slice(1).map((_, i) => bind(halvePipe, { 1: mirrors[i], 2: soft })),
        join: bind(joinPipe, { 0: shown, 1: seen, 2: soft, 3: mirrored, 4: aux }),
        down: glows.map((_, i) => bind(downPipe, { 1: i ? glows[i - 1] : joined, 2: soft })),
        up: glows.slice(1).map((g) => bind(upPipe, { 0: shown, 1: g, 2: soft })),
        show: bind(showPipe, { 0: shown, 1: joined, 2: soft, 3: glows[0] }),
      },
    };
  };
  const draw = (encoder: GPUCommandEncoder, to: GPUTextureView[], of: GPURenderPipeline, bound: GPUBindGroup, load = false) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: to.map((view) => ({ view, loadOp: load ? "load" : "clear", storeOp: "store" }) as GPURenderPassColorAttachment),
    });
    pass.setPipeline(of);
    pass.setBindGroup(0, bound);
    pass.draw(3);
    pass.end();
  };

  // the eye: it sways by itself, and a drag adds to that
  const camera = new PerspectiveCamera(look.fov, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.495;
  const place = () => {
    camera.position.set(0, look.high, look.far);
    controls.target.set(0, look.lookAt, 0);
    controls.update();
  };
  place();

  // how it is at a moment of the loop
  const moment = (t: number) => {
    const list: { take: number; head: number; lead: number; front: number; fire: number }[] = [];
    const out = 1 - ease(clamp((t - 7.5) / (DARK - 7.5)));
    let last = -1;
    STROKES.forEach((s, i) => {
      if (t >= s.t) last = i;
    });
    if (last < 0) {
      const first = STROKES[0].t;
      const k = clamp((t - 0.5) / (first - 0.5));
      // by steps, and faster as it nears the floor
      const along = Math.pow(k, 1.6);
      const steps = 26;
      const head = k <= 0 ? -1 : (Math.floor(along * steps) + ease(clamp(((along * steps) % 1) * 3))) / steps;
      list.push({ take: STROKES[0].take, head, lead: k > 0 ? 0.16 : 0, front: 2, fire: 0 });
    } else {
      for (const i of [last, last - 1]) {
        if (i < 0) continue;
        const s = STROKES[i];
        const age = t - s.t;
        const next = STROKES[i + 1]?.t ?? Infinity;
        const buzz = 1 + 0.12 * Math.sin(age * 91 + i) + 0.08 * Math.sin(age * 203 + i * 2);
        let fire = s.gain * (0.4 + 0.6 * Math.exp(-age / 0.16)) * buzz * out;
        if (i !== last) fire *= Math.exp(-(t - next) / 0.06);
        // the stroke runs up from the floor
        const front = i === 0 ? 1.05 - 1.2 * clamp(age / 0.07) : -1;
        list.push({ take: s.take, head: i === 0 && age < 0.07 ? 2 : -1, lead: i === 0 ? 0.16 : 0, front, fire: fire < 0.003 ? 0 : fire });
      }
    }
    return list;
  };

  const stats = new Stats();
  document.body.append(stats.dom);
  const gui = new GUI();
  const folders: Record<string, (keyof typeof look)[]> = {
    lightning: ["seed", "cell", "eta", "rho", "forks", "sparks", "stray", "core", "hot", "hotTone", "skin", "skinTone", "branches", "haze", "hazeTone", "hazeNear", "shine", "shineTone"],
    glass: ["ior", "coat", "bevel", "bevelShine", "bevelLamp", "tint", "soak", "dust", "waves", "veil", "sheen", "sheenWide"],
    room: ["lampPower", "lampTone", "lampSoft", "back", "backLow", "fog"],
    floor: ["caustics", "castTone", "bends", "ripple", "hotWide", "reach", "lots", "stone", "mirror", "roughLow", "roughHigh", "tilt", "tile", "seam"],
    eye: ["fov", "far", "high", "lookAt", "sway"],
    picture: ["exposure", "bloom", "spread", "colour", "grain", "vignette", "detail", "adapt", "edgeRays", "rays", "cutoff", "dimFine", "dimHaze", "dimLit", "cost"],
  };
  const changed = (k: string) => {
    if (regrow.has(k)) growAll();
    if (rebake.has(k)) {
      toBake = takes.map((_, i) => i);
      baking = null;
    }
    if (["far", "high", "lookAt"].includes(k)) place();
  };
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name).close();
    for (const k of keys) {
      const c = typeof look[k] === "string" ? f.addColor(look, k) : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
      (regrow.has(k) || rebake.has(k) ? c.onFinishChange(() => changed(k)) : c.onChange(() => changed(k)));
    }
  }
  gui.close();
  const play = { pause: false };
  gui.add(play, "pause");

  const cap = frameCap(60);
  let clock = 0;
  let [late, since, scale, roof] = [0.0167, 0, 1, 1 / 0.97];
  let before = performance.now();
  const right = new Vector3();
  const up = new Vector3();
  const fore = new Vector3();
  const eye = new Vector3();

  wrap.render = () => {
    if (state.hold === null && !cap()) return;
    const now = performance.now();
    if (!play.pause && !(state.busy && clock < 0.05)) clock += Math.min(0.1, (now - before) / 1000);
    const gone = Math.min(0.1, (now - before) / 1000);
    before = now;
    const t = ((state.hold ?? clock) % LOOP + LOOP) % LOOP;
    state.time = t;
    const [cw, ch] = [canvas.width, canvas.height];
    // late frames: fewer pixels, at once; in time for a while: some more, but not up to where it was last too many
    if (state.busy) late = 0.0167;
    else if (look.adapt && state.hold === null) {
      late += (gone - late) * 0.12;
      if (++since > 24 && late > 0.021) {
        roof = scale;
        scale = Math.max(0.4, scale * Math.max(0.7, Math.sqrt(0.0175 / late)));
        since = 0;
      } else if (since > 150 && late < 0.0176 && scale < 1) {
        scale = Math.min(1, scale * 1.07, since > 700 ? 1 : roof * 0.97);
        since = since > 700 ? 0 : 60;
      }
    } else if (!look.adapt || state.hold !== null) scale = 1;
    state.scale = scale;
    const share = scale * Math.min(1, Math.sqrt((look.detail * 1e6) / (cw * ch)));
    const [w, h] = [Math.max(16, Math.round(cw * share)), Math.max(16, Math.round(ch * share))];
    if (!pics || pics.size[0] !== w || pics.size[1] !== h) makePics(w, h);
    mendBind ??= bind(mendPipe, { 14: floors.createView(), 15: slant, 0: params, 1: bladeBuffer, 2: scene, 3: nodes, 4: pieces, 6: marked, 7: more, 11: noises, 12: rep });
    traceBind ??= bind(tracePipe, { 14: floors.createView(), 15: slant, 0: params, 1: bladeBuffer, 2: scene, 3: nodes, 4: pieces, 11: noises, 12: rep });

    controls.update();
    camera.fov = look.fov;
    camera.aspect = cw / ch;
    // (a tall frame sees as far across as a square one)
    const half = Math.tan((look.fov * Math.PI) / 360) * Math.max(1 + 0.2 * clamp((camera.aspect - 0.8) / 0.5), 0.86 / camera.aspect);
    const turn = ((look.sway * Math.PI) / 180) * Math.sin((t / LOOP) * 2 * Math.PI);
    const target = controls.target;
    eye.copy(camera.position).sub(target).applyAxisAngle(new Vector3(0, 1, 0), turn).add(target);
    fore.copy(target).sub(eye).normalize();
    right.crossVectors(fore, new Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, fore);

    put("size", w, h, (2 * half) / h, t);
    put("eye", ...eye.toArray(), look.cost ? 2 : 1);
    put("right", ...right.multiplyScalar(half * camera.aspect).toArray(), 0);
    put("up", ...up.multiplyScalar(half).toArray(), 0);
    put("fore", ...fore.toArray(), 0);
    put("bolt", look.core);
    put("hot", ...tone(look.hotTone, look.hot));
    put("skin", ...tone(look.skinTone, look.skin));
    
    put("haze", ...tone(look.hazeTone, look.haze));
    put("lit", ...tone(look.shineTone, look.shine));
    put("lamp", ...tone(look.lampTone, look.lampPower), look.mirror);
    put("back", ...tone(look.back), look.fog);
    put("back2", ...tone(look.backLow));
    put("room", look.lampSoft, Math.min(BLADES, blades.length), look.rays, look.cutoff);
    put("glass", look.ior, look.coat, look.bevel, look.bevelShine);
    const tint = new Color(look.tint).toArray().map((v) => (1 - v) * look.soak);
    put("tint", ...tint);
    put("dust", look.dust, look.bevelLamp * 0.1, look.waves, look.sheenWide);
    put("sheen", ...tone(look.shineTone, look.sheen * look.shine), look.edgeRays);
    put("tune", look.dimFine, look.dimHaze, look.dimLit, look.veil);
    put("floor", look.stone, look.roughLow, look.roughHigh, look.tilt);
    put("tile", look.tile, Math.cos(0.55), Math.sin(0.55), look.seam);

    sceneData.fill(0);
    const now2 = moment(t);
    const longAt = 4 * (6 + BOXES * 3);
    let live = 0;
    put("maps", look.reach, now2[0]?.take ?? 0, now2[1]?.take ?? 0, look.crisp);
    put("thrown", ...tone(look.castTone, look.shine * look.caustics));
    now2.forEach((m, k) => {
      const shines = (s: number) => (s > m.front ? m.fire : 0) + (s < m.head ? m.lead * 0.15 : 0);
      // (the floor's light is from the lowest part of the bolt, so it is that part's brightness that counts)
      sceneData[16 + k * 4] = Array.from({ length: 16 }, (_, i) => shines(0.6 + (0.4 * (i + 0.5)) / 16)).reduce((a, b) => a + b) / 16;
      const take = takes[m.take];
      sceneData.set([take.from, take.to, m.head, m.lead, m.front, m.fire, look.branches, take.mid], k * 8);
      take.long.forEach((l) => {
        const power = shines(l.s);
        // (what the last stroke left is a flicker of the same shape: not worth its light on things)
        if (power > (k ? 0.05 : 0.002)) sceneData.set([...l.a, power, ...l.b, 0], longAt + live++ * 8);
      });
    });
    put("glow", look.haze, look.hazeNear, live);
    device.queue.writeBuffer(params, 0, data);
    const lampTone = tone(look.lampTone, 1);
    LAMPS.forEach((l, i) =>
      sceneData.set([...l.c, l.power * look.lampPower * lampTone[2], ...l.u, lampTone[0] / lampTone[2], ...l.v, lampTone[1] / lampTone[2]], 24 + i * 12),
    );
    device.queue.writeBuffer(scene, 0, sceneData);
    device.queue.writeBuffer(
      shown,
      0,
      new Float32Array([cw, ch, look.exposure, look.grain, state.hold === null ? state.frame % 64 : 0, look.vignette, look.bloom, look.spread, (2 * half) / h, 1, look.colour, eye.y]),
    );

    bakeSome(state.frame < 3 ? 0 : 3);
    state.busy = toBake.length + (baking ? 1 : 0);
    const p = pics!;
    const encoder = device.createCommandEncoder();
    draw(encoder, [p.seen, p.mirrors[0], p.aux], tracePipe, traceBind);
    if (look.edgeRays) {
      encoder.clearBuffer(marked, 0, 16);
      let pass = encoder.beginComputePass();
      pass.setPipeline(gatherPipe);
      pass.setBindGroup(0, p.binds.gather);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.setPipeline(countPipe);
      pass.setBindGroup(0, countBind);
      pass.dispatchWorkgroups(1);
      pass.end();
      pass = encoder.beginComputePass();
      pass.setPipeline(mendPipe);
      pass.setBindGroup(0, mendBind);
      pass.dispatchWorkgroupsIndirect(asked, 0);
      pass.end();
      const mix = encoder.beginRenderPass({
        colorAttachments: [p.seen, p.mirrors[0], p.aux].map((view) => ({ view, loadOp: "load", storeOp: "store" }) as GPURenderPassColorAttachment),
      });
      const k = look.edgeRays / (look.edgeRays + 1);
      mix.setBlendConstant([k, k, k, k]);
      mix.setPipeline(mixPipe);
      mix.setBindGroup(0, mixBind);
      mix.drawIndirect(asked, 16);
      mix.end();
    }
    p.binds.halve.forEach((b, i) => draw(encoder, [p.mirrors[i + 1]], halvePipe, b));
    draw(encoder, [p.joined], joinPipe, p.binds.join);
    p.binds.down.forEach((b, i) => draw(encoder, [p.glows[i]], downPipe, b));
    for (let i = GLOWS - 2; i >= 0; i--) draw(encoder, [p.glows[i]], upPipe, p.binds.up[i], true);
    draw(encoder, [context.getCurrentTexture().createView()], showPipe, p.binds.show);
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
  Object.assign(window, { __bolt: { look, state, changed, device, camera, controls, maps: [floors], render: () => wrap.render!({} as never) } });
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
