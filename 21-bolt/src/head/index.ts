// Bolt, the head by itself: Suzanne as a cloud (tools/suzanne-cloud.py, and the VDB clouds stamped over her), lightning
// through her, and every setting live. See head.wgsl, and face.html for the flight she is met on.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Color, Matrix4, PerspectiveCamera, Vector3 } from "three";
import type { V3 } from "../blades.ts";
import { random, strike, type Piece } from "../bolt.ts";
import { frameCap } from "../cap.ts";
import cloudCode from "./head.wgsl?raw";
import showCode from "../show.wgsl?raw";

const LOOP = 12;
const TAKES = 6;
const GLOWS = 7;
const DIM: V3 = [512, 416, 384]; // voxels of the block
const VOXEL = 0.0068;
const SOURCE = 0.01; // and of the clouds, at size 1
const HALF = DIM.map((v) => (v * VOXEL) / 2) as V3;
const GLOW = DIM.map((v) => v / 4) as V3; // of its light
const LEVELS = 4;
const CLOUDS = ["05", "02", "03", "07"];
const ROUTES = ["off", "crawl", "through", "eyes", "ears", "mouth", "down", "frame", "behind"] as const;
type Route = (typeof ROUTES)[number];

export const look = {
  // when
  rate: 1.4, // strikes a second
  restrikes: 3,
  tail: 0.4,
  hum: 0, // how bright they are all the while
  flicker: 0.5,
  only: "all",
  freeze: false,
  moment: 2,
  // where
  bolt1: "crawl" as Route,
  bolt2: "eyes" as Route,
  bolt3: "through" as Route,
  bolt4: "frame" as Route,
  bolt5: "mouth" as Route,
  bolt6: "behind" as Route,
  seed: 4,
  depth: 0.03, // how far under her skin they run, and how far in and out of that they go
  weave: 0.14,
  stray: 0.06,
  bends: 7,
  cell: 0.024,
  eta: 4.5,
  forks: 3,
  sparks: 18,
  // the bolt
  core: 0.0022,
  hot: 24,
  white: 0.75,
  halo: 2,
  haloWide: 5,
  branches: 0.6,
  // light
  flash: 0.42,
  toneA: "#98a8ff",
  toneB: "#98a8ff",
  near: 0.5, // how white the light is close by
  shade: 1,
  shadeDeep: 0.045,
  moon: 0.05,
  moonTone: "#8aa6d8",
  moonTurn: 140,
  moonHigh: 38,
  sky: 0.008,
  skyTone: "#33415f",
  lots: 8, // quarter millions of photons for each bolt
  // the cloud
  thick: 800,
  aside: 0.55,
  fray: 0.6,
  fraySize: 1.1,
  boil: 1, // how many times over its edges drift in a loop
  step: 0.007,
  // her
  swell: 0.14, // how far her skin swells in rounds, and how fine they are
  swellSize: 0.68,
  edge: 0.035,
  body: 0.14,
  clumpy: 0.58, // dense billows, thin channels between, and how fine
  clumpSize: 0.6,
  flesh: -0.05, // how far in from her skin she is solid
  hollow: 1,
  wall: 0.11,
  wisps: 1,
  eyes: 1,
  mouth: 1,
  ragged: 1,
  muzzle: 0.7,
  puffs: 1.2, // how large the clouds on her are, how far in, how dense
  sink: 0.45,
  puffPower: 1,
  front: 0.04, // how many of them are on her face
  // the eye
  fov: 34,
  sway: 0.12,
  // the picture
  exposure: 1,
  bloom: 0.075,
  spread: 0.85,
  colour: 1.05,
  grain: 0.025,
  vignette: 0.5,
  detail: 1.6, // millions of pixels the cloud is marched with
};
type Key = keyof typeof look;
const usual = { ...look };
const ranges: Record<string, [number, number, number]> = {
  rate: [0, 8, 0.1], restrikes: [0, 8, 1], tail: [0.05, 2, 0.01], hum: [0, 2, 0.01], flicker: [0, 1, 0.01], moment: [0, LOOP, 0.01],
  seed: [1, 99, 1], depth: [-0.3, 0.4, 0.005], weave: [0, 0.5, 0.005], stray: [0, 0.4, 0.005], bends: [3, 16, 1], cell: [0.012, 0.08, 0.001], eta: [2.5, 10, 0.1], forks: [0, 12, 1], sparks: [0, 160, 1],
  core: [0.0005, 0.02, 0.0001], hot: [0, 100, 0.5], white: [0, 1, 0.01], halo: [0, 30, 0.1], haloWide: [1, 20, 0.1], branches: [0, 2, 0.05],
  flash: [0, 4, 0.01], near: [0, 1, 0.01], shade: [0, 1, 0.01], shadeDeep: [0.005, 0.2, 0.001], moon: [0, 1.5, 0.005], moonTurn: [-180, 180, 1], moonHigh: [0, 90, 1], sky: [0, 0.4, 0.002], lots: [1, 64, 1],
  thick: [5, 1200, 1], aside: [0.05, 1, 0.01], fray: [0, 3, 0.05], fraySize: [0.2, 6, 0.05], boil: [0, 6, 1], step: [0.003, 0.03, 0.0005],
  swell: [0, 0.5, 0.005], swellSize: [0.2, 2, 0.01], edge: [0.005, 0.2, 0.005], body: [0.01, 0.5, 0.01], clumpy: [0, 1, 0.01], clumpSize: [0.2, 3, 0.01], flesh: [-0.1, 0.3, 0.005], hollow: [0, 1, 0.01], wall: [0.02, 0.5, 0.005], wisps: [0, 6, 0.05], eyes: [0, 2, 0.01], mouth: [0, 2, 0.01], ragged: [0, 4, 0.05], muzzle: [0.6, 1.2, 0.01],
  puffs: [0.3, 4, 0.05], sink: [0, 1, 0.01], puffPower: [0, 2, 0.05], front: [0, 1, 0.01],
  fov: [12, 80, 1], sway: [0, 1.5, 0.01],
  exposure: [0.1, 4, 0.01], bloom: [0, 0.6, 0.005], spread: [0.3, 1.2, 0.01], colour: [0, 2, 0.01], grain: [0, 0.1, 0.005], vignette: [0, 1.5, 0.01], detail: [0.2, 6, 0.1],
};
const folders: Record<string, Key[]> = {
  when: ["rate", "restrikes", "tail", "hum", "flicker", "only", "freeze", "moment"],
  "where the bolts go": ["bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends"],
  "the bolts": ["cell", "eta", "forks", "sparks", "branches", "core", "hot", "white", "halo", "haloWide"],
  light: ["flash", "toneA", "toneB", "near", "shade", "shadeDeep", "moon", "moonTone", "moonTurn", "moonHigh", "sky", "skyTone", "lots"],
  cloud: ["thick", "aside", "fray", "fraySize", "boil", "step"],
  suzanne: ["swell", "swellSize", "edge", "body", "clumpy", "clumpSize", "flesh", "hollow", "wall", "wisps", "eyes", "mouth", "ragged", "muzzle", "puffs", "sink", "puffPower", "front"],
  eye: ["fov", "sway"],
  picture: ["exposure", "bloom", "spread", "colour", "grain", "vignette", "detail"],
};
const tips: Record<string, string> = {
  rate: "strikes a second; 0: only the hum, and B", restrikes: "how many times each strike flickers again", tail: "how long a strike's light lasts, seconds", hum: "how bright the bolts are all the while", only: "one bolt alone",
  freeze: "stop at `moment`", depth: "how far under her skin the crawling bolts run (below 0: outside)", weave: "how far in and out of it they go", stray: "how far off its route a bolt is", bends: "how many points a crawling bolt goes by",
  cell: "how fine a bolt's kinks are", eta: "low: bushy, high: straight", white: "how white a bolt's middle is", toneA: "bolts 1, 3, 5", toneB: "bolts 2, 4, 6", near: "how white the light is close to a bolt", shade: "picked-out detail", shadeDeep: "how deep that looks",
  lots: "quarter millions of photons for each bolt: fewer is quicker and noisier", thick: "low: you see into her", aside: "low: the light goes deep, high: it stays by the bolt", boil: "how many times over the edges drift in a loop", swell: "low: the model, high: a cloud with no face",
  flesh: "how far in from her skin she starts", clumpy: "thin channels between the billows, for light to come out by", wall: "how thick she is, hollow", wisps: "cloud in the hollow", puffs: "how large the VDB clouds on her are", sink: "how far in they are", front: "how many of them are on her face", muzzle: "below 1: wider", step: "smaller: finer and slower", detail: "millions of pixels marched",
};
const grows = new Set<string>(["bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends", "cell", "eta", "forks", "sparks"]);
const rebuilds = new Set<string>(folders.suzanne);
const relights = new Set<string>(["thick", "aside", "lots"]);
const moons = new Set<string>(["thick", "moonTurn", "moonHigh"]);

// (each is what it changes of the usual)
const presets: Record<string, Partial<typeof look>> = {
  storm: {},
  "daylight, for the shape": { rate: 0, hum: 0, moon: 0.9, moonTone: "#ffe9cf", moonTurn: 55, moonHigh: 40, sky: 0.06, skyTone: "#5c7cb0" },
  amber: { toneA: "#ffb45c", toneB: "#ff8a3c", near: 0.45, skyTone: "#2a2f3c" },
  "two colours": { toneA: "#5c8cff", toneB: "#ff5ca8", hum: 0.06, near: 0.15 },
  "lit from inside": { bolt1: "eyes", bolt2: "mouth", bolt3: "ears", bolt4: "off", bolt5: "off", bolt6: "off", hum: 0.15, rate: 2, moon: 0.02 },
  "skin only": { bolt1: "crawl", bolt2: "crawl", bolt3: "crawl", bolt4: "crawl", bolt5: "crawl", bolt6: "crawl", hum: 0.03, rate: 2.4, depth: 0.01 },
  "thin, see the bolts": { thick: 160, hum: 0.12, aside: 0.8, clumpy: 0.9 },
};

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
  const gatherPipe = compute("gather");
  const downPipe = paint(showModule, "down", HDR);
  const upPipe = paint(showModule, "up", HDR, true);
  const showPipe = paint(showModule, "frag", format);

  const uniform = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(14 * 4);
  const params = uniform(data.byteLength);
  const wires = uniform(192);
  const gathered = uniform(208);
  const shown = uniform(48);
  const sliceBuffer = uniform(80);
  const sliceAll = device.createBuffer({ size: DIM[2] * 80, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
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

  const state = { frame: 0, hold: null as number | null, time: 0, scale: 1, skies: 1, busy: 1, pieces: 0, baked: 0, loaded: 0, composed: 0, grown: 0 };

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
  const distances = new Int8Array(bytes, 28, nx * ny * nz);
  const skin = volume([nx, ny, nz], "r8snorm", GPUTextureUsage.COPY_DST);
  device.queue.writeTexture({ texture: skin }, distances, { bytesPerRow: nx, rowsPerImage: ny }, [nx, ny, nz]);
  const places = new Float32Array(bytes, 28 + Math.ceil((nx * ny * nz) / 4) * 4, many * 7);
  state.loaded = performance.now() - t0;

  const R = GPUTextureUsage.RENDER_ATTACHMENT;
  const dense = volume(DIM, "r8unorm", R, LEVELS);
  const rough = volume(DIM.map((v) => v / 8) as V3, "r8unorm", R);
  const grain = volume([96, 96, 96], "rgba8unorm", GPUTextureUsage.STORAGE_BINDING);
  const still = volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING);
  const glows = Array.from({ length: TAKES }, () => volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING));
  const glow = volume(GLOW, HDR, GPUTextureUsage.STORAGE_BINDING);
  const tallied = device.createBuffer({ size: GLOW[0] * GLOW[1] * GLOW[2] * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const put = (slot: number, ...v: number[]) => data.set(v, slot * 4);
  const settings = () => {
    put(5, ...HALF, VOXEL);
    put(6, look.thick, look.aside, look.step, look.shadeDeep);
    const [turn, high] = [(look.moonTurn * Math.PI) / 180, (look.moonHigh * Math.PI) / 180];
    put(8, Math.sin(turn) * Math.cos(high), Math.sin(high), Math.cos(turn) * Math.cos(high));
  };

  let drafted = 0;
  // one slice after another of a block
  const slices = (to: GPUTexture, level: number, run: (p: GPURenderPassEncoder) => void) => {
    const n = Math.max(1, to.depthOrArrayLayers >> level);
    const head = [look.swellSize, look.swell, look.body, hx, hy, hz, look.flesh, look.eyes, look.mouth, look.ragged, look.muzzle, look.hollow, look.wall, look.wisps, look.edge, look.clumpy, look.clumpSize, 1 << level];
    const all = new Float32Array(n * 20);
    for (let z = 0; z < n; z++) all.set([z, ...head], z * 20);
    device.queue.writeBuffer(sliceAll, 0, all);
    const encoder = device.createCommandEncoder();
    for (let z = 0; z < n; z++) {
      encoder.copyBufferToBuffer(sliceAll, z * 80, sliceBuffer, 0, 80);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.createView({ baseMipLevel: level, mipLevelCount: 1 }), depthSlice: z, loadOp: "clear", storeOp: "store" }],
      });
      run(pass);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
  };
  // (a draft is of half the size: the voxels start a level down)
  const compose = (draft = 0) => {
    drafted = draft;
    settings();
    device.queue.writeBuffer(params, 0, data);
    const t0 = performance.now();
    // the clouds on her
    const list: number[] = [];
    const add = (cloud: number, x: V3, y: V3, z: V3, at: V3, size: number, power: number) => list.push(...x, cloud, ...y, power, ...z, clouds[cloud].most, ...at, size, ...clouds[cloud].half, 1);
    const rand = random(29);
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
      const scale = (size * look.puffs) / (clouds[cloud].half[0] * 2);
      const out = clouds[cloud].half[1] * scale * (1 - 2 * look.sink);
      const wide = 1 - (1 - look.muzzle) * ease(clamp((0.02 - py) / 0.4));
      const at = [px / wide, py, pz].map((v, c) => v + [qx, qy, qz][c] * out) as V3;
      add(cloud, a.toArray() as V3, up.toArray() as V3, b.toArray() as V3, at, scale, look.puffPower);
    }
    const buffer = device.createBuffer({ size: list.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, new Float32Array(list));
    const stampBind = bind(stampPipe, { 0: params, 1: lin, 7: grain, 8: rep, 11: sliceBuffer, 12: clouds[0].tex, 13: clouds[1].tex, 14: clouds[2].tex, 15: clouds[3].tex, 23: buffer });
    const fleshBind = bind(fleshPipe, { 0: params, 1: lin, 7: grain, 8: rep, 11: sliceBuffer, 24: skin });
    slices(dense, draft, (p) => {
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
    for (let level = draft + 1; level < LEVELS; level++) down(shrinkPipe, dense, level, dense.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }));
    down(roughPipe, rough, 0, dense.createView({ baseMipLevel: 2, mipLevelCount: 1 }));
    buffer.destroy();
    state.composed = performance.now() - t0;
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

  // where a bolt goes
  const farAt = (p: V3) => {
    const c = p.map((v, a) => clamp(Math.floor((v / [hx, hy, hz][a] + 1) * 0.5 * [nx, ny, nz][a]), 0, [nx, ny, nz][a] - 1));
    return (distances[(c[2] * ny + c[1]) * nx + c[0]] / 127) * 0.4;
  };
  const skinOut = (d: V3) => { // how far out her skin is, that way
    let out = 0.3;
    for (let r = 0.3; r < 1.7; r += 0.02) if (farAt(d.map((v) => v * r) as V3) < 0) out = r;
    return out;
  };
  const routeOf = (kind: Route, rand: () => number): V3[] => {
    const r = (a = 1) => (rand() - 0.5) * 2 * a;
    const side = rand() < 0.5 ? -1 : 1;
    const way: V3[] = [];
    const flip = (w: V3[]) => w.map(([x, y, z]) => [x * side, y, z] as V3);
    switch (kind) {
      case "crawl": {
        // over the front of her, from one side of her outline to the other, in and out of the skin
        const a = rand() * 2 * Math.PI;
        const b = a + Math.PI + r(0.9);
        const [mx, my] = [r(0.55), r(0.5)];
        const n = look.bends;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const lift = Math.sin(Math.PI * t);
          const e = [Math.cos(a) * (1 - t) + Math.cos(b) * t + mx * lift, Math.sin(a) * (1 - t) + Math.sin(b) * t + my * lift, lift * 1.1 - 0.15];
          const l = Math.hypot(...e) || 1;
          const d = e.map((v) => v / l) as V3;
          const ends = i === 0 || i === n - 1;
          const at = skinOut(d) - look.flesh + look.swell * 0.4 - (ends ? -0.25 : look.depth + look.weave * (i % 2 ? -1 : 1) * (0.5 + 0.5 * rand()));
          way.push(d.map((v) => v * at) as V3);
        }
        return way;
      }
      case "through": {
        const a = rand() * 2 * Math.PI;
        const d: V3 = [Math.cos(a), 0.35 + 0.65 * Math.sin(a), r(0.5)];
        return [1.75, 1.05, 0.5, 0, -0.5, -1.05, -1.75].map((s) => d.map((v, c) => v * s + (Math.abs(s) < 1.5 ? r(0.2) : 0) + (c === 2 ? 0.2 : 0)) as V3);
      }
      case "eyes":
        return flip([[1.75, 1.35, 0.3], [1.0, 0.95, 0.85], [0.42, 0.3, 1.0], [0.3, 0.2, 0.6], [0, 0.3, 0.4], [-0.3, 0.22, 0.6], [-0.4, 0.22, 1.02], [-0.95, -0.15, 0.95], [-1.6, -0.8, 0.8]]);
      case "ears":
        return flip([[1.85, 0.75, -0.1], [1.25, 0.25, -0.1], [0.7, 0.15, 0.1], [0.2, 0.3, 0.35], [-0.3, 0.1, 0.2], [-0.75, 0.2, 0], [-1.25, 0.2, -0.1], [-1.85, -0.35, 0.1]]);
      case "mouth":
        return flip([[0.5, 1.75, -0.2], [0.3, 1.0, 0.1], [0.1, 0.4, 0.3], [-0.12, -0.1, 0.45], [0.15, -0.55, 0.62], [-0.1, -0.72, 0.95], [0.05, -1.3, 1.1]]);
      case "down":
        return flip([[-0.35, 1.8, 0.1], [0.1, 1.05, 0.3], [-0.25, 0.6, 0.75], [0.1, 0.2, 0.65], [-0.15, -0.3, 0.75], [0.1, -0.75, 0.6], [-0.1, -1.4, 0.4]]);
      case "frame":
        return flip([[-0.75, -1.4, 0.7], [-1.1, -0.75, 0.65], [-1.4, 0.0, 0.6], [-1.1, 0.7, 0.65], [-0.5, 1.02, 0.7], [0.4, 1.04, 0.65], [1.05, 0.75, 0.7], [1.42, 0.1, 0.6], [1.15, -0.7, 0.75], [0.75, -1.4, 0.8]]);
      case "behind":
        return flip([[1.75, 1.5, -1.0], [1.0, 0.9, -1.05], [0.3, 0.45, -1.2], [-0.6, 0.6, -1.1], [-1.2, -0.1, -1.0], [-1.75, -0.9, -1.1]]);
    }
    return way;
  };
  // the bolts
  type Take = { first: number; count: number; main: number; mean: number; run: number };
  let takes: Take[] = [];
  let pieces: GPUBuffer;
  let toBake: number[] = [];
  let baking: { take: number; lot: number } | null = null;
  const grown: { key: string; main: Piece[]; rest: Piece[]; run: number }[] = [];
  const growAll = () => {
    const t0 = performance.now();
    const all: number[] = [];
    takes = [];
    for (let k = 0; k < TAKES; k++) {
      const kind = look[`bolt${k + 1}` as "bolt1"];
      const crawls = kind === "crawl" ? [look.flesh, look.swell, look.depth, look.weave, look.bends] : [];
      const key = [kind, look.seed, look.stray, look.cell, look.eta, look.forks, look.sparks, ...crawls].join();
      // (only what has changed)
      if (grown[k]?.key !== key) {
        const rand = random(look.seed * 101 + k * 17);
        const way = routeOf(kind, rand).map((p) => p.map((v) => v + (rand() - 0.5) * 2 * look.stray) as V3);
        const bolt = way.length ? strike(way, look.seed * 31 + k, { cell: look.cell, eta: look.eta, rho: 2, forks: look.forks, sparks: look.sparks, floor: -99 }) : { pieces: [] };
        const main = bolt.pieces.filter((p) => p.main);
        const run = main.reduce((s, p) => s + Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]), 0);
        grown[k] = { key, main, rest: bolt.pieces.filter((p) => !p.main), run };
        if (!toBake.includes(k)) toBake.push(k);
        if (baking?.take === k) baking = null;
      }
      const { main, rest, run } = grown[k];
      takes.push({ first: all.length / 8, count: main.length + rest.length, main: main.length, mean: run / Math.max(1, main.length), run });
      for (const p of [...main, ...rest]) all.push(...p.a, p.lum * (p.main ? 1 : -1), ...p.b, p.s);
    }
    pieces?.destroy();
    pieces = device.createBuffer({ size: Math.max(32, all.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(pieces, 0, new Float32Array(all));
    state.pieces = all.length / 8;
    sparkBind = null;
    state.grown = performance.now() - t0;
  };
  let sparkBind: GPUBindGroup | null = null;
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
      // (the one that shows most first)
      toBake.sort((a, b) => fires[b] - fires[a]);
      baking = { take: toBake.shift()!, lot: 0 };
      const clear = device.createCommandEncoder();
      clear.clearBuffer(tallied);
      device.queue.submit([clear.finish()]);
    }
    const take = takes[baking.take];
    if (!take.main) {
      baking = null;
      return;
    }
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
  const gatherBind = bind(gatherPipe, { 21: glow, 25: gathered, 26: glows[0], 27: glows[1], 28: glows[2], 29: glows[3], 30: glows[4], 31: glows[5] });
  const fires = new Float32Array(TAKES);

  const marchBind = bind(marchPipe, { 0: params, 1: lin, 2: dense, 3: rough, 4: still, 5: glow, 7: grain, 8: rep });

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

  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0.7, 0.2, 4.9);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.target.set(0, 0.02, 0);
  orbit.minDistance = 0.4;
  orbit.maxDistance = 14;

  // when: strikes at random moments of the loop, each again a few times
  type Stroke = { take: number; t: number; gain: number; fresh: boolean };
  let strokes: Stroke[] = [];
  let strokesKey = "";
  const plan = () => {
    const here = takes.flatMap((t, k) => (t.main ? [k] : []));
    const key = [look.rate, look.restrikes, look.seed, here].join();
    if (key === strokesKey) return;
    strokesKey = key;
    strokes = [];
    const rand = random(look.seed * 977 + 5);
    const n = Math.round(look.rate * LOOP);
    let left: number[] = [];
    let last = -1;
    for (let i = 0; i < n && here.length; i++) {
      if (!left.length) left = [...here];
      let pick = Math.floor(rand() * left.length);
      if (left[pick] === last && left.length > 1) pick = (pick + 1) % left.length;
      const take = (last = left.splice(pick, 1)[0]);
      let t = ((i + 0.15 + rand() * 0.7) / n) * LOOP;
      let gain = 0.7 + 0.6 * rand();
      for (let j = 0; j <= look.restrikes; j++) {
        strokes.push({ take, t: t % LOOP, gain, fresh: j === 0 });
        t += 0.05 + 0.16 * rand() ** 2;
        gain *= 0.55 + 0.45 * rand();
      }
    }
  };
  const called: { take: number; at: number }[] = []; // by hand, on the clock
  const call = () => {
    const here = takes.flatMap((t, k) => (t.main && (look.only === "all" || +look.only === k + 1) ? [k] : []));
    if (here.length) called.push({ take: here[Math.floor(Math.random() * here.length)], at: clock });
    if (called.length > 8) called.shift();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "b" || e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
    call();
  };
  window.addEventListener("keydown", key);
  const fade = (age: number) => 0.4 * Math.exp(-age / look.tail) + 0.6 * Math.exp(-age / (look.tail * 0.26));
  const fronts = new Float32Array(TAKES);
  const moment = (t: number) => {
    plan();
    fires.fill(0);
    fronts.fill(-1);
    const turn = (2 * Math.PI * t) / LOOP;
    const one = (take: number, age: number, gain: number, fresh: boolean) => {
      fires[take] += gain * fade(age);
      if (fresh && age < 0.06) fronts[take] = 1.05 - 1.2 * (age / 0.06); // (it runs up)
    };
    for (const s of strokes) {
      const age = (t - s.t + LOOP) % LOOP;
      if (age < Math.min(LOOP - 1, look.tail * 8)) one(s.take, age, s.gain, s.fresh);
    }
    if (state.hold === null && !look.freeze) for (const c of called) if (clock - c.at < 4) for (const [d, g] of [[0, 1.6], [0.14, 1], [0.24, 0.6]]) if (clock - c.at >= d) one(c.take, clock - c.at - d, g, d === 0);
    for (let k = 0; k < TAKES; k++) {
      // (it buzzes, and now and then nearly goes out)
      const slow = 0.5 + 0.5 * Math.sin(turn * (7 + k * 2) + k * 2.1) * Math.sin(turn * (13 + k * 3) + k);
      const buzz = 0.6 * Math.sin(turn * (173 + k * 14) + k) + 0.4 * Math.sin(turn * (388 - k * 22) + k * 3);
      fires[k] = fires[k] * (1 + 0.16 * look.flicker * buzz) + look.hum * (1 + look.flicker * ((slow - 0.5) * 1.6 + 0.2 * buzz));
      if (!takes[k].main || fires[k] < 0.002 || (look.only !== "all" && +look.only !== k + 1)) fires[k] = 0;
    }
  };

  const stats = new Stats();
  document.body.append(stats.dom);
  const gui = new GUI();
  gui.close();
  const todo = { grow: true, rebuild: 2, moon: true, relight: true, fresh: true };
  // (a bolt is grown again only once a slider is let go: it takes a while; all else goes on while it is dragged)
  const changed = (k: string, done = true) => {
    if (done && (grows.has(k) || k === "swell" || k === "flesh")) todo.grow = true;
    if (rebuilds.has(k)) todo.rebuild = Math.max(todo.rebuild, done ? 2 : 1);
    if (moons.has(k)) todo.moon = true;
    if (relights.has(k)) todo.relight = true;
    if (done) todo.fresh = true;
    state.busy = Math.max(state.busy, 1);
    if (state.hold === null) localStorage.setItem(STORE, JSON.stringify(different()));
  };
  const STORE = "bolt-head";
  const different = () => Object.fromEntries(Object.entries(look).filter(([k, v]) => v !== usual[k as Key]));
  const wear = (values: object) => {
    const before = { ...look };
    for (const [k, v] of Object.entries({ ...usual, ...values })) if (k in look && typeof v === typeof usual[k as Key]) (look as Record<string, unknown>)[k] = v;
    for (const k of Object.keys(look)) if (look[k as Key] !== before[k as Key]) changed(k);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  };
  const note = (c: { name: (s: string) => unknown }, said: string, usually: string) => {
    c.name(said);
    setTimeout(() => c.name(usually), 1500);
  };
  const acts = {
    preset: "storm",
    strike: call,
    "other bolts": () => wear({ ...look, seed: (look.seed % 99) + 1 }),
    copy: () =>
      navigator.clipboard.writeText(JSON.stringify(different(), null, 1)).then(
        () => note(copies, "copied", "copy settings"),
        () => note(copies, "the browser won't let me", "copy settings"),
      ),
    paste: () =>
      navigator.clipboard
        .readText()
        .then((s) => wear(JSON.parse(s)))
        .catch(() => note(pastes, "no settings there", "paste settings")),
    reset: () => wear({}),
  };
  gui.add(acts, "preset", Object.keys(presets)).onChange((name: string) => wear(presets[name]));
  gui.add(acts, "strike").name("strike (B)");
  gui.add(acts, "other bolts");
  const copies = gui.add(acts, "copy").name("copy settings");
  const pastes = gui.add(acts, "paste").name("paste settings");
  gui.add(acts, "reset");
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name).close();
    for (const k of keys) {
      const choices = k.startsWith("bolt") ? ROUTES : k === "only" ? ["all", "1", "2", "3", "4", "5", "6"] : null;
      const c = choices ? f.add(look, k, choices as string[]) : typeof look[k] === "string" ? f.addColor(look, k) : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
      c.onChange(() => changed(k, false));
      c.onFinishChange(() => changed(k));
      if (tips[k]) c.domElement.title = tips[k];
    }
  }
  try {
    wear(JSON.parse(localStorage.getItem(STORE) ?? "{}"));
  } catch {}

  const cap = frameCap(60);
  let clock = 0;
  let before = performance.now();
  const [right, up, fore, eye] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const Y = new Vector3(0, 1, 0);
  wrap.render = () => {
    if (state.hold === null && !cap()) return;
    const now = performance.now();
    if (!(state.busy && clock < 0.05)) clock += Math.min(0.1, (now - before) / 1000);
    before = now;
    const t = (((state.hold ?? (look.freeze ? look.moment : clock)) % LOOP) + LOOP) % LOOP;
    settings();
    if (todo.rebuild) compose(todo.rebuild === 1 ? 1 : 0);
    if (todo.grow) growAll();
    if (todo.rebuild || todo.moon) moonBake();
    if (todo.rebuild || todo.relight) {
      toBake = takes.map((_, i) => i);
      if (todo.fresh) baking = null; // (or else it is let finish, for something to be seen while a slider is dragged)
    }
    todo.grow = todo.moon = todo.relight = todo.fresh = false;
    todo.rebuild = 0;
    state.time = t;
    const [cw, ch] = [canvas.width, canvas.height];
    const share = Math.min(1, Math.sqrt((look.detail * 1e6) / (cw * ch)));
    const [w, h] = [Math.max(16, Math.round(cw * share)), Math.max(16, Math.round(ch * share))];
    const key = `${w} ${h} ${cw} ${ch}`;
    if (pics?.key !== key) makePics(key, w, h, cw, ch);

    const aspect = cw / ch;
    const half = Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.25 / aspect);
    orbit.update();
    const sway = look.sway * Math.sin((2 * Math.PI * t) / LOOP);
    eye.copy(camera.position).sub(orbit.target).applyAxisAngle(Y, sway);
    fore.copy(eye).normalize().negate();
    eye.add(orbit.target);
    right.crossVectors(fore, Y).normalize();
    up.crossVectors(right, fore);
    put(0, w, h, (2 * half) / h, t);
    put(1, ...eye.toArray(), 0);
    put(2, ...right.multiplyScalar(half * aspect).toArray(), 0);
    put(3, ...up.multiplyScalar(half).toArray(), 0);
    put(4, ...fore.toArray(), 0);
    moment(t);
    const wire = new Float32Array(48);
    const shine = new Float32Array(52);
    for (let k = 0; k < TAKES; k++) {
      const c = tone(k % 2 ? look.toneB : look.toneA);
      const [fire, front] = [fires[k], fronts[k]];
      wire.set([front, fire, 0, 0, ...c, 0], k * 8);
      shine.set([0, 1, 2, 3].map((q) => ([0.125, 0.375, 0.625, 0.875].filter((f) => (q + f) / 4 > front).length / 4) * fire * look.flash), k * 4);
      shine.set([...c, fire > 0 ? 1 : 0], 24 + k * 4);
    }
    shine.set([look.near, 2], 48);
    device.queue.writeBuffer(wires, 0, wire);
    device.queue.writeBuffer(gathered, 0, shine);
    put(7, look.fray, look.fraySize, (look.boil * t) / LOOP, look.shade);
    put(9, ...tone(look.moonTone, look.moon));
    put(10, ...tone(look.skyTone, look.sky * 10));
    put(11, look.core, look.branches, look.haloWide, look.hot);
    put(12, cw, ch, (2 * half) / ch, look.halo);
    put(13, look.white, drafted);
    device.queue.writeBuffer(params, 0, data);
    device.queue.writeBuffer(
      shown,
      0,
      new Float32Array([cw, ch, look.exposure, look.grain, state.hold === null ? state.frame % 64 : 0, look.vignette, look.bloom, look.spread, (2 * half) / h, 1, look.colour, 1]),
    );
    bakeSome(drafted ? 1 : 2);
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
    sparkBind ??= bind(sparkPipe, { 0: params, 1: lin, 2: dense, 7: grain, 8: rep, 9: pieces, 10: wires });
    const adds = encoder.beginComputePass();
    adds.setPipeline(gatherPipe);
    adds.setBindGroup(0, gatherBind);
    adds.dispatchWorkgroups(...GROUPS);
    adds.end();
    draw(p.marched, marchPipe, marchBind);
    draw(p.full, overPipe, p.over);
    pass(p.full, true, (r) => {
      r.setPipeline(sparkPipe);
      r.setBindGroup(0, sparkBind);
      takes.forEach((take, k) => fires[k] > 0 && r.draw(6, take.count, k * 10, take.first));
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
    window.removeEventListener("keydown", key);
    orbit.dispose();
    device.destroy();
  };
  Object.assign(window, { __bolt: { look, state, changed, device, camera, orbit, compose, render: () => wrap.render!({} as never) } });
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
