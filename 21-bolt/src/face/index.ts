// Bolt, the third page: a flight through storm clouds that repeat along the way, and lightning that shows one of them
// to be a huge face. The face is Suzanne (tools/suzanne-cloud.py) with some 1200 small copies of the VDB clouds stamped
// over her skin, tops outward. See face.wgsl, and clouds.html for the clouds and the light alone.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { Color, Matrix4, Vector3 } from "three";
import type { V3 } from "../blades.ts";
import { random, strike } from "../bolt.ts";
import { frameCap } from "../cap.ts";
import cloudCode from "./face.wgsl?raw";
import showCode from "../show.wgsl?raw";

const LOOP = 14;
const TAKES = 5;
const GLOWS = 7;
const DIM: V3 = [512, 352, 768]; // voxels of the block
const VOXEL = 0.0125;
const SOURCE = 0.01; // and of the clouds, at size 1
const HALF: V3 = [3.2, 2.2, 4.8];
const LONG = 9.6; // it repeats after
const GLOW: V3 = [128, 88, 192]; // of its light
const LEVELS = 4;

export const look = {
  seed: 4,
  cell: 0.03,
  eta: 4.5,
  rho: 2,
  forks: 3,
  sparks: 18,
  stray: 0.03,
  // the bolt
  core: 0.0028,
  hot: 24,
  hotTone: "#cdd4ff",
  skin: 2,
  skinTone: "#7f8bff",
  skinWide: 5,
  branches: 0.6,
  // the clouds
  thick: 300,
  aside: 0.55,
  step: 0.009,
  fray: 0.6,
  fraySize: 0.85,
  // light
  flash: 0.6,
  flashTone: "#a9b2ff",
  shade: 1,
  shadeDeep: 0.04,
  moon: 0.05,
  moonTone: "#8aa6d8",
  moonTurn: 140,
  moonHigh: 38,
  sky: 0.008,
  skyTone: "#33415f",
  lots: 8, // quarter millions of photons for each bolt
  // the face
  faceSize: 1.3,
  swell: 0.12, // how far its skin swells in rounds, and how fine they are
  swellSize: 0.52,
  front: 0.04, // how many of the clouds on it are on its face
  flesh: 0.0, // how far in from her skin she is solid
  puffs: 1.4, // how large the clouds on it are
  sink: 0.45,
  puffPower: 1,
  // the eye
  fov: 44,
  start: 8.4,
  ease: 0.6,
  wander: 0.3,
  reach: 9.2, // how far it sees
  murk: 0.16,
  // the picture
  exposure: 1,
  bloom: 0.075,
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
  faceSize: [0.5, 2, 0.01], swell: [0, 0.8, 0.01], swellSize: [0.1, 1.2, 0.01], front: [0, 1, 0.05], flesh: [-0.1, 0.3, 0.005], puffs: [0.5, 6, 0.05], sink: [0, 1, 0.01], puffPower: [0, 2, 0.05],
  fov: [20, 90, 1], start: [0, 12, 0.1], ease: [0, 1.5, 0.01], wander: [0, 1, 0.01], reach: [2, 16, 0.1], murk: [0, 1, 0.01],
  exposure: [0.1, 4, 0.01], bloom: [0, 0.6, 0.005], spread: [0.3, 1.2, 0.01], colour: [0, 2, 0.01], grain: [0, 0.1, 0.005], vignette: [0, 1.5, 0.01], detail: [0.1, 4, 0.1],
};
const regrow = new Set(["seed", "cell", "eta", "rho", "forks", "sparks", "stray"]);
const rebuild = new Set(["faceSize", "swell", "swellSize", "front", "flesh", "puffs", "sink", "puffPower"]);
const relight = new Set(["thick", "aside", "lots", "moonTurn", "moonHigh"]);

const CLOUDS = ["05", "02", "03", "07"];
// the clouds by the way: which, middle, turned about, over (head down), how large, how strong
const SPOTS: { cloud: number; at: V3; turn: number; over?: boolean; size: number; power: number }[] = [
  // under
  { cloud: 0, at: [-1.3, -1.75, 3.3], turn: 1.2, size: 0.75, power: 1 },
  { cloud: 1, at: [1.6, -1.7, 2.3], turn: 2.6, size: 0.7, power: 1 },
  { cloud: 3, at: [0.2, -1.85, 5.2], turn: 0.3, size: 0.8, power: 1 },
  { cloud: 2, at: [-1.6, -1.6, -3.0], turn: 4.0, size: 0.75, power: 1 },
  { cloud: 0, at: [1.4, -1.75, -2.6], turn: 5.4, size: 0.7, power: 1 },
  { cloud: 1, at: [0.1, -2.05, -0.5], turn: 0.9, size: 0.7, power: 1 },
  // over
  { cloud: 3, at: [-1.2, 1.95, 4.6], turn: 2.2, over: true, size: 0.75, power: 1 },
  { cloud: 0, at: [1.5, 1.9, 5.8], turn: 0.6, over: true, size: 0.7, power: 1 },
  { cloud: 2, at: [0.2, 2.05, -3.0], turn: 1.7, over: true, size: 0.8, power: 1 },
  // behind the face
  { cloud: 1, at: [-2.1, 0.8, -2.9], turn: 1.4, size: 0.62, power: 1 },
  { cloud: 0, at: [2.2, 0.5, -3.1], turn: 4.5, size: 0.62, power: 1 },
  // beside
  { cloud: 2, at: [-2.5, -0.1, 5.6], turn: 1.9, size: 0.6, power: 1 },
  { cloud: 1, at: [2.6, 0.3, 4.4], turn: 4.7, size: 0.55, power: 1 },
  { cloud: 3, at: [2.4, -0.3, -2.3], turn: 1.3, size: 0.6, power: 1 },
  { cloud: 0, at: [-2.6, 0.6, -2.4], turn: 4.4, size: 0.5, power: 1 },
  { cloud: 1, at: [-1.75, 0.5, 4.2], turn: 3.4, size: 0.42, power: 1 },
  { cloud: 0, at: [1.9, -0.9, 6.3], turn: 2.1, size: 0.5, power: 1 },
  { cloud: 3, at: [-1.9, -0.7, 6.6], turn: 5.2, size: 0.5, power: 1 },
  { cloud: 2, at: [1.8, 1.0, 6.9], turn: 0.9, size: 0.45, power: 1 },
  { cloud: 0, at: [-1.7, 1.2, 7.1], turn: 3.9, size: 0.42, power: 1 },
  // across the way: through this one she is come upon
  { cloud: 0, at: [0.35, 0.1, 6.9], turn: 0.25, size: 0.52, power: 0.8 },
  { cloud: 2, at: [-0.5, 0.85, 7.0], turn: 2.9, size: 0.4, power: 0.7 },
];
const FACE: V3 = [0, 0.32, 0];
// the bolts: two by the way, one behind the face, one before it, one in it
const WAYS: V3[][] = [
  [[-2.7, 1.9, 5.4], [-1.9, 1.1, 5.0], [-2.3, 0.3, 4.9], [-1.5, -0.5, 4.6], [-1.8, -1.5, 4.4]],
  [[2.6, 1.9, 6.5], [1.8, 1.2, 6.2], [2.3, 0.4, 6.1], [1.6, -0.5, 5.9], [1.9, -1.5, 5.6]],
  [[2.7, 2.0, -1.7], [1.5, 1.3, -1.5], [0.5, 0.7, -1.6], [-0.9, 0.9, -1.5], [-1.8, -0.1, -1.7], [-2.5, -1.2, -1.6]],
[[-1.7, -1.9, 1.3], [-2.25, -0.9, 1.0], [-2.1, 0.4, 1.15], [-1.55, 1.45, 1.0], [-0.5, 1.95, 1.1], [0.7, 1.9, 0.95], [1.65, 1.4, 1.1], [2.2, 0.3, 1.0], [2.0, -0.9, 1.2], [1.4, -1.9, 1.35]],
  [[0.6, 2.0, -0.3], [0.35, 1.1, 0.0], [0.5, 0.62, 0.35], [0.05, 0.75, 0.25], [-0.48, 0.6, 0.4], [-0.2, 0.2, 0.2], [0.1, -0.4, 0.6], [0.0, -0.9, 0.65], [0.15, -1.9, 0.4]],
];
// when the strokes come, which bolt, how bright
const STROKES: { t: number; take: number; gain: number }[] = (
  [
    [0.7, 0, 1.6], [0.86, 0, 1.0], [1.2, 0, 0.6], [2.0, 1, 1.5], [2.14, 1, 0.9], [2.5, 1, 0.6],
    [3.2, 0, 1.0], [3.34, 0, 0.6], [4.0, 1, 0.7], [4.15, 1, 0.4], [5.6, 2, 2.0], [5.76, 2, 1.3], [6.1, 2, 0.6],
    [6.7, 3, 3.0], [6.86, 3, 1.5], [7.12, 3, 2.4], [7.5, 3, 1.2], [7.66, 3, 2.0],
    [8.6, 4, 0.8], [8.76, 4, 0.7], [9.1, 4, 0.9], [9.6, 4, 0.6], [9.75, 4, 0.8],
    [10.5, 4, 0.3], [10.66, 4, 0.2], [11.4, 4, 0.12], [11.54, 4, 0.08], [12.2, 4, 0.11], [12.36, 4, 0.07],
  ] as [number, number, number][]
).map(([t, take, gain]) => ({ t, take, gain }));

const tone = (hex: string, power = 1) => new Color(hex).toArray().map((v) => v * power);
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
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
  const MOST: GPUBlendState = { color: { operation: "max", srcFactor: "one", dstFactor: "one" }, alpha: { operation: "max", srcFactor: "one", dstFactor: "one" } };
  const mostOf = (vertex: string, fragment: string) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: cloudModule, entryPoint: vertex },
      fragment: { module: cloudModule, entryPoint: fragment, targets: [{ format: "r8unorm", blend: MOST }] },
    });
  const stampPipe = mostOf("stampQuad", "stamp");
  const fleshPipe = mostOf("vert", "flesh");
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
  const sliceBuffer = uniform(48);
  const bakeBuffer = uniform(48);
  const linear: GPUSamplerDescriptor = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
  const lin = device.createSampler({ ...linear, addressModeW: "repeat" });
  const flat = device.createSampler(linear);
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

  const state = { frame: 0, hold: null as number | null, time: 0, scale: 1, skies: 1, busy: 1, pieces: 0, baked: 0, loaded: 0, eye: [0, 0, 0] as number[] };

  // the clouds, from the server
  const t0 = performance.now();
  const clouds = await Promise.all(
    CLOUDS.map(async (cloud) => {
      const answer = await fetch(`${import.meta.env.BASE_URL}clouds/${cloud}.vol`);
      const bytes = await new Response(answer.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const [w, h, d, most] = new Float32Array(bytes, 0, 4);
      const tex = volume([w, h, d], "r8unorm", GPUTextureUsage.COPY_DST);
      device.queue.writeTexture({ texture: tex }, new Uint8Array(bytes, 16), { bytesPerRow: w, rowsPerImage: h }, [w, h, d]);
      return { tex, half: [w, h, d].map((v) => (v * SOURCE) / 2) as V3, most };
    }),
  );
  const bytes = await new Response((await fetch(`${import.meta.env.BASE_URL}clouds/suzanne.bin`)).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const [nx, ny, nz, hx, hy, hz, many] = new Float32Array(bytes, 0, 7);
  const skin = volume([nx, ny, nz], "r8snorm", GPUTextureUsage.COPY_DST);
  device.queue.writeTexture({ texture: skin }, new Int8Array(bytes, 28, nx * ny * nz), { bytesPerRow: nx, rowsPerImage: ny }, [nx, ny, nz]);
  const places = new Float32Array(bytes, 28 + Math.ceil((nx * ny * nz) / 4) * 4, many * 7);
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
  const slices = (to: GPUTexture, level: number, run: (p: GPURenderPassEncoder) => void) => {
    const n = Math.max(1, to.depthOrArrayLayers >> level);
    const head = new Float32Array(12);
    head.set([0, 0, look.swellSize, look.swell, ...FACE, look.faceSize, hx, hy, hz, look.flesh], 0);
    for (let z = 0; z < n; z++) {
      head[0] = z;
      device.queue.writeBuffer(sliceBuffer, 0, head);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.createView({ baseMipLevel: level, mipLevelCount: 1 }), depthSlice: z, loadOp: "clear", storeOp: "store" }],
      });
      run(pass);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
  };
  const compose = () => {
    settings();
    device.queue.writeBuffer(params, 0, data);
    // the clouds by the way, and the ones on the face
    const list: number[] = [];
    const add = (cloud: number, x: V3, y: V3, z: V3, at: V3, size: number, power: number, face: boolean) =>
      list.push(...x, cloud, ...y, power, ...z, clouds[cloud].most, ...at, size, ...clouds[cloud].half, face ? 1 : 0);
    for (const s of SPOTS) {
      const [c, n] = [Math.cos(s.turn), Math.sin(s.turn)];
      add(s.cloud, [c, 0, n], [0, s.over ? -1 : 1, 0], [-n, 0, c], s.at, s.size, s.power, false);
    }
    const rand = random(look.seed * 7 + 1);
    const m = new Matrix4();
    for (let i = 0; i < many; i++) {
      const [px, py, pz, qx, qy, qz, size] = places.subarray(i * 7, i * 7 + 7);
      const up = new Vector3(qx, qy, qz).normalize();
      // (the face proper is left to its own swelling; the crown, the sides and the back are clouds)
      const before = (pz > 0.1 && qz > -0.1 && Math.abs(px) < 0.95 && py < 0.75) || Math.abs(px) > 0.9;
      const keep = rand();
      if (before ? keep > look.front || size > 0.22 : size < 0.14 && keep > 0.3) continue;
      const a = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(up).normalize();
      const b = new Vector3().crossVectors(a, up);
      m.makeBasis(a, up, b);
      const cloud = Math.floor(rand() * 4);
      const scale = (size * look.puffs * look.faceSize) / (clouds[cloud].half[0] * 2);
      const out = clouds[cloud].half[1] * scale * (1 - 2 * look.sink);
      const wide = 1 - 0.22 * ease(clamp((-0.15 - py) / 0.3));
      const at = [px / wide, py, pz].map((v, c) => FACE[c] + (v + 0) * look.faceSize + [qx, qy, qz][c] * out) as V3;
      add(cloud, a.toArray() as V3, up.toArray() as V3, b.toArray() as V3, at, scale, look.puffPower, true);
    }
    const buffer = device.createBuffer({ size: list.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, new Float32Array(list));
    const stampBind = bind(stampPipe, { 0: params, 1: flat, 7: grain, 8: rep, 11: sliceBuffer, 12: clouds[0].tex, 13: clouds[1].tex, 14: clouds[2].tex, 15: clouds[3].tex, 23: buffer });
    const fleshBind = bind(fleshPipe, { 0: params, 1: flat, 7: grain, 8: rep, 11: sliceBuffer, 24: skin });
    slices(dense, 0, (p) => {
      p.setPipeline(fleshPipe);
      p.setBindGroup(0, fleshBind);
      p.draw(3);
      p.setPipeline(stampPipe);
      p.setBindGroup(0, stampBind);
      p.draw(6, list.length / 20);
    });
    const down = (pipe: GPURenderPipeline, to: GPUTexture, level: number, below: GPUTextureView) => {
      const b = bind(pipe, { 11: sliceBuffer, 16: below });
      slices(to, level, (p) => {
        p.setPipeline(pipe);
        p.setBindGroup(0, b);
        p.draw(3);
      });
    };
    for (let level = 1; level < LEVELS; level++) down(shrinkPipe, dense, level, dense.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }));
    down(roughPipe, rough, 0, dense.createView({ baseMipLevel: 2, mipLevelCount: 1 }));
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
    takes = [];
    for (let k = 0; k < TAKES; k++) {
      const way = WAYS[k].map((p) => p.map((v) => v + (rand() - 0.5) * 2 * look.stray) as V3);
      const bolt = strike(way, look.seed * 31 + k, { ...look, floor: -99 });
      const main = bolt.pieces.filter((p) => p.main);
      const rest = bolt.pieces.filter((p) => !p.main);
      const run = main.reduce((s, p) => s + Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]), 0);
      takes.push({ first: all.length / 8, count: main.length + rest.length, main: main.length, mean: run / main.length, run });
      for (const p of [...main, ...rest]) all.push(...p.a, p.lum * (p.main ? 1 : -1), ...p.b, p.s);
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

  // the eye flies along z, the length of the block a loop; a drag looks about, and it comes back
  let [yaw, pitch, held] = [0, 0, false];
  const grab = (e: PointerEvent) => {
    held = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const drag = (e: PointerEvent) => {
    if (!held) return;
    yaw = clamp(yaw - e.movementX * 0.003, -1.2, 1.2);
    pitch = clamp(pitch + e.movementY * 0.003, -0.7, 0.7);
  };
  const drop = () => (held = false);
  canvas.addEventListener("pointerdown", grab);
  canvas.addEventListener("pointermove", drag);
  canvas.addEventListener("pointerup", drop);

  const moment = (t: number) => {
    const list: { take: number; head: number; lead: number; front: number; fire: number }[] = [];
    let last = -1;
    STROKES.forEach((s, i) => {
      if (t >= s.t) last = i;
    });
    for (const i of [last, last - 1]) {
      if (i < 0) continue;
      const s = STROKES[i];
      const age = t - s.t;
      const next = STROKES[i + 1]?.t ?? Infinity;
      const buzz = 1 + 0.1 * Math.sin(age * 91 + i) + 0.07 * Math.sin(age * 203 + i * 2);
      let fire = s.gain * (0.4 * Math.exp(-age / 0.5) + 0.6 * Math.exp(-age / 0.13)) * buzz * (1 - ease(clamp((t - 12.9) / 0.8)));
      if (i !== last) fire *= Math.exp(-(t - next) / 0.12);
      const fresh = STROKES[i - 1]?.take !== s.take && age < 0.06; // (a new bolt runs up)
      list.push({ take: s.take, head: -1, lead: 0, front: fresh ? 1.05 - 1.2 * (age / 0.06) : -1, fire: fire < 0.002 ? 0 : fire });
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
    face: ["faceSize", "swell", "swellSize", "front", "flesh", "puffs", "sink", "puffPower"],
    eye: ["fov", "start", "ease", "wander", "reach", "murk"],
    picture: ["exposure", "bloom", "spread", "colour", "grain", "vignette", "detail"],
  };
  const changed = (k: string) => {
    if (regrow.has(k)) growAll();
    if (relight.has(k)) {
      moonBake();
      toBake = takes.map((_, i) => i);
      baking = null;
    }
    if (rebuild.has(k)) {
      compose();
      moonBake();
      toBake = takes.map((_, i) => i);
      baking = null;
    }
  };
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name).close();
    for (const k of keys) {
      const c = typeof look[k] === "string" ? f.addColor(look, k) : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
      if (regrow.has(k) || relight.has(k) || rebuild.has(k)) c.onFinishChange(() => changed(k));
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

    const aspect = cw / ch;
    const half = Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.25 / aspect);
    if (!held) {
      yaw *= 0.95;
      pitch *= 0.95;
    }
    const s = t / LOOP;
    const turn = 2 * Math.PI;
    // (slower by the face, quicker through it)
    eye.set(look.wander * Math.sin(turn * s), 0.3 + look.wander * 0.35 * Math.sin(turn * 2 * s), look.start - LONG * s + look.ease * (Math.sin(turn * (s - 0.2)) + Math.sin(turn * 0.2)));
    fore.set(-0.1 * eye.x + Math.sin(yaw), -0.12 * (eye.y - 0.3) + Math.sin(pitch), -Math.cos(yaw)).normalize();
    right.crossVectors(fore, new Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, fore);
    state.eye = eye.toArray();
    settings();
    put(0, w, h, (2 * half) / h, t);
    put(1, ...eye.toArray(), 0);
    put(2, ...right.multiplyScalar(half * aspect).toArray(), 0);
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
    put(13, look.fray, look.fraySize, look.reach, look.murk);
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
      for (let copy = 0; copy < 3; copy++) list.forEach((m, k) => m.fire > 0 && r.draw(6, takes[m.take].count, k * 10 + copy * 100, takes[m.take].first));
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
    canvas.removeEventListener("pointerdown", grab);
    canvas.removeEventListener("pointermove", drag);
    canvas.removeEventListener("pointerup", drop);
    device.destroy();
  };
  Object.assign(window, { __bolt: { look, state, changed, device, compose, SPOTS, WAYS, growAll, moonBake, render: () => wrap.render!({} as never) } });
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
