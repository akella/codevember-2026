// Bolt, a head grown: a cloud from CloudPack, simulated (warmth, vapour, condensing water, wind), steered by a
// controller that only warms, moistens, cools and dries the air until the cloud has grown into Suzanne; lightning
// through it all the while, and every setting live. See grow.wgsl; head.html is the head built rather than grown.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Color, PerspectiveCamera, Vector3 } from "three";
import type { V3 } from "../blades.ts";
import { random, strike, type Piece } from "../bolt.ts";
import { frameCap } from "../cap.ts";
import code from "./grow.wgsl?raw";
import showCode from "../show.wgsl?raw";

const LOOP = 12;
const TAKES = 6;
const GLOWS = 7;
const SIM: V3 = [160, 128, 120]; // cells of the simulation
const CELL = 0.0218;
const HALF = SIM.map((v) => (v * CELL) / 2) as V3;
const LOW = SIM.map((v) => v / 2) as V3; // of what is measured of it, and steered
const GLOW: V3 = [120, 96, 90]; // of its light
const STEP = CELL * 1.25; // of a photon
const CLOUDS = ["05", "02", "03", "07"];
const ROUTES = ["off", "crawl", "through", "eyes", "ears", "mouth", "down", "frame", "behind"] as const;
type Route = (typeof ROUTES)[number];

export const look = {
  // when
  rate: 1.4, // strikes a second
  restrikes: 3,
  tail: 0.4,
  hum: 0,
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
  depth: 0.03,
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
  near: 0.5,
  shade: 1,
  shadeDeep: 0.045,
  moon: 0.05,
  moonTone: "#8aa6d8",
  moonTurn: 140,
  moonHigh: 38,
  sky: 0.008,
  skyTone: "#33415f",
  lots: 3, // quarter millions of photons a time the light is worked out again
  blend: 0.5, // how much of the light is the new
  // the cloud, seen
  thick: 800,
  aside: 0.55,
  dense: 0.1, // density for a gram of water a kilogram of air
  fray: 0.35,
  fraySize: 1.6,
  carried: 3, // seconds the fine stuff is carried by the wind before it is begun again
  step: 0.007,
  // the weather
  run: true,
  speed: 1,
  hz: 30, // steps a second (each as long as speed over this)
  rise: 0.15, // how hard warm air rises
  weight: 0.3,
  ground: 290, // kelvin
  lapse: 6, // kelvin colder a unit up
  humid: 0.72,
  latent: 2.5, // kelvin a gram of vapour gives as it condenses
  stable: 1, // kelvin a unit
  lid: 6,
  lidAt: 1.05,
  condense: 4,
  swirl: 4,
  solve: 10,
  sharp: true,
  // the growing
  first: "05",
  firstX: 0,
  firstY: -0.55,
  firstZ: 0,
  firstSize: 0.62,
  firstWater: 1.6,
  firstWarm: 0.6,
  begins: 2, // seconds before she is steered toward
  ramp: 6,
  wet: 2, // what the controller does: moistens, mixes away, warms below
  mix: 1.5,
  outward: 0.8, // 1: she grows only out of cloud there is; 0: anywhere at once
  warm: 1.5,
  warmest: 2.5,
  now: 1, // for what falls short now, and so far
  sofar: 0.6,
  remember: 4,
  under: 0.25,
  pull: 0.8,
  calm: 3,
  full: 0.6, // grams of water a kilogram that are her
  // her
  flesh: -0.05,
  edge: 0.05,
  eyes: 1,
  mouth: 1,
  ragged: 1,
  muzzle: 0.7,
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
  detail: 1.6,
};
type Key = keyof typeof look;
const usual = { ...look };
const ranges: Record<string, [number, number, number]> = {
  rate: [0, 8, 0.1], restrikes: [0, 8, 1], tail: [0.05, 2, 0.01], hum: [0, 2, 0.01], flicker: [0, 1, 0.01], moment: [0, LOOP, 0.01],
  seed: [1, 99, 1], depth: [-0.3, 0.4, 0.005], weave: [0, 0.5, 0.005], stray: [0, 0.4, 0.005], bends: [3, 16, 1], cell: [0.012, 0.08, 0.001], eta: [2.5, 10, 0.1], forks: [0, 12, 1], sparks: [0, 160, 1],
  core: [0.0005, 0.02, 0.0001], hot: [0, 100, 0.5], white: [0, 1, 0.01], halo: [0, 30, 0.1], haloWide: [1, 20, 0.1], branches: [0, 2, 0.05],
  flash: [0, 4, 0.01], near: [0, 1, 0.01], shade: [0, 1, 0.01], shadeDeep: [0.005, 0.2, 0.001], moon: [0, 1.5, 0.005], moonTurn: [-180, 180, 1], moonHigh: [0, 90, 1], sky: [0, 0.4, 0.002], lots: [1, 32, 1], blend: [0.05, 1, 0.01],
  thick: [5, 1200, 1], aside: [0.05, 1, 0.01], dense: [0.01, 0.5, 0.005], fray: [0, 3, 0.05], fraySize: [0.2, 6, 0.05], carried: [0.5, 12, 0.1], step: [0.003, 0.03, 0.0005],
  speed: [0, 4, 0.05], hz: [10, 60, 1], rise: [0, 0.6, 0.005], weight: [0, 2, 0.01], ground: [275, 305, 0.5], lapse: [0, 15, 0.1], humid: [0.3, 1, 0.005], latent: [0, 6, 0.05], stable: [-1, 4, 0.05], lid: [0, 20, 0.1], lidAt: [-0.5, 1.4, 0.01], condense: [0.2, 20, 0.1], swirl: [0, 10, 0.05], solve: [2, 60, 1],
  firstX: [-1.5, 1.5, 0.01], firstY: [-1.4, 1.4, 0.01], firstZ: [-1.3, 1.3, 0.01], firstSize: [0.2, 1.2, 0.01], firstWater: [0, 4, 0.05], firstWarm: [-2, 4, 0.05],
  begins: [0, 30, 0.1], ramp: [0, 30, 0.1], warm: [0, 12, 0.05], mix: [0, 10, 0.05], outward: [0, 1, 0.01], warmest: [0, 10, 0.05], wet: [0, 8, 0.05], now: [0, 4, 0.01], sofar: [0, 4, 0.01], remember: [0.2, 20, 0.1], under: [-0.3, 0.6, 0.005], pull: [0, 2, 0.01], calm: [0, 10, 0.05], full: [0.05, 3, 0.01],
  flesh: [-0.15, 0.3, 0.005], edge: [0.01, 0.2, 0.005], eyes: [0, 2, 0.01], mouth: [0, 2, 0.01], ragged: [0, 4, 0.05], muzzle: [0.6, 1.2, 0.01],
  fov: [12, 80, 1], sway: [0, 1.5, 0.01],
  exposure: [0.1, 4, 0.01], bloom: [0, 0.6, 0.005], spread: [0.3, 1.2, 0.01], colour: [0, 2, 0.01], grain: [0, 0.1, 0.005], vignette: [0, 1.5, 0.01], detail: [0.2, 6, 0.1],
};
const folders: Record<string, Key[]> = {
  growing: ["begins", "ramp", "outward", "wet", "mix", "warm", "warmest", "now", "sofar", "remember", "under", "pull", "calm", "full"],
  "the first cloud": ["first", "firstX", "firstY", "firstZ", "firstSize", "firstWater", "firstWarm"],
  weather: ["run", "speed", "hz", "rise", "weight", "ground", "lapse", "humid", "latent", "stable", "lid", "lidAt", "condense", "swirl", "solve", "sharp"],
  suzanne: ["flesh", "edge", "eyes", "mouth", "ragged", "muzzle"],
  when: ["rate", "restrikes", "tail", "hum", "flicker", "only", "freeze", "moment"],
  "where the bolts go": ["bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends"],
  "the bolts": ["cell", "eta", "forks", "sparks", "branches", "core", "hot", "white", "halo", "haloWide"],
  light: ["flash", "toneA", "toneB", "near", "shade", "shadeDeep", "moon", "moonTone", "moonTurn", "moonHigh", "sky", "skyTone", "lots", "blend"],
  "the cloud, seen": ["thick", "aside", "dense", "fray", "fraySize", "carried", "step"],
  eye: ["fov", "sway"],
  picture: ["exposure", "bloom", "spread", "colour", "grain", "vignette", "detail"],
};
const tips: Record<string, string> = {
  begins: "seconds the cloud is left to itself before it is steered", ramp: "seconds the steering takes to come in full", warm: "how much it warms the air below where she falls short, for it to rise into her", warmest: "kelvin warmer than the air round it, at the most, the controller makes it",
  wet: "how much vapour the controller adds where she falls short: what condenses of it is cloud", outward: "1: she grows only out of cloud there is already; 0: out of clear air, anywhere at once", mix: "how fast it mixes the air round about into cloud where there is too much: it thins and evaporates", now: "how much it answers to what falls short now", sofar: "how much to what has fallen short a while",
  remember: "seconds what has fallen short is remembered", under: "how far below where she falls short it warms", pull: "a push on the cloud toward her (for the ears, which rising air won't build)",
  calm: "how much stiller the air is where she is there", full: "grams of water a kilogram that count as her",
  first: "the CloudPack cloud it begins from (none: clear air)", firstWarm: "how much warmer than the air round it the first cloud is (it rises)",
  run: "the weather goes on", speed: "how fast", hz: "simulation steps a second: fewer is quicker, coarser in time", rise: "how hard warm air rises", weight: "how much the cloud's water pulls it down",
  ground: "kelvin at the bottom", lapse: "kelvin colder a unit up: the air holds less vapour higher", humid: "how humid the air is, of what it could hold", latent: "kelvin condensing a gram gives: what makes clouds boil up",
  stable: "how much colder than its surroundings rising air comes to be", lid: "and above the lid, more: the cloud spreads under it", lidAt: "where the lid is", condense: "how fast vapour condenses",
  swirl: "swirls given back that are lost between the cells", solve: "pressure steps: more, truer and slower", sharp: "MacCormack: the cloud's edges stay sharp as it moves",
  flesh: "how far in from her skin she is", edge: "how soft her edge is", muzzle: "below 1: wider",
  dense: "how dense a gram of water a kilogram looks", carried: "seconds the fine stuff is carried by the wind before it is begun again", lots: "quarter millions of photons each time a bolt's light is worked out again", blend: "how much of the light is the newest: low is smoother, high follows the cloud",
  rate: "strikes a second; 0: only the hum, and B", hum: "how bright the bolts are all the while", only: "one bolt alone", freeze: "stop the strikes at `moment`",
  depth: "how far under her skin the crawling bolts run", weave: "how far in and out of it they go", thick: "low: you see into it", aside: "low: the light goes deep, high: it stays by the bolt", detail: "millions of pixels marched",
};
const grows = new Set<string>(["bolt1", "bolt2", "bolt3", "bolt4", "bolt5", "bolt6", "seed", "depth", "weave", "stray", "bends", "cell", "eta", "forks", "sparks", "flesh"]);
const aims = new Set<string>(folders.suzanne);
const begins = new Set<string>(folders["the first cloud"]);

// (each is what it changes of the usual)
const presets: Record<string, Partial<typeof look>> = {
  storm: {},
  "daylight, for the shape": { rate: 0, hum: 0, moon: 0.9, moonTone: "#ffe9cf", moonTurn: 55, moonHigh: 40, sky: 0.06, skyTone: "#5c7cb0" },
  "from clear air": { first: "none" },
  "left to itself": { warm: 0, wet: 0, mix: 0, pull: 0, calm: 0 },
  amber: { toneA: "#ffb45c", toneB: "#ff8a3c", near: 0.45, skyTone: "#2a2f3c" },
  "lit from inside": { bolt1: "eyes", bolt2: "mouth", bolt3: "ears", bolt4: "off", bolt5: "off", bolt6: "off", hum: 0.15, rate: 2, moon: 0.02 },
};

const tone = (hex: string, power = 1) => new Color(hex).toArray().map((v) => v * power);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
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
  const module = device.createShaderModule({ code });
  const showModule = device.createShaderModule({ code: showCode });
  const ADD: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
  const paint = (m: GPUShaderModule, entryPoint: string, format: GPUTextureFormat, add = false, vertex = "vert") =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: m, entryPoint: vertex },
      fragment: { module: m, entryPoint, targets: [{ format, blend: add ? ADD : undefined }] },
    });
  const compute = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
  const marchPipe = paint(module, "march", HDR);
  const overPipe = paint(module, "over", HDR);
  const sparkPipe = paint(module, "spark", HDR, true, "ribbon");
  const pipes = Object.fromEntries(
    ["makeGrain", "begin", "clearPres", "clearLow", "aim", "advect", "sharpen", "swirl", "measure", "weather", "diverge", "relax", "project", "carry", "photons", "settle", "moonlight", "gather"].map((n) => [n, compute(n)]),
  );
  const downPipe = paint(showModule, "down", HDR);
  const upPipe = paint(showModule, "up", HDR, true);
  const showPipe = paint(showModule, "frag", format);

  const uniform = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(14 * 4);
  const params = uniform(data.byteLength);
  const simBuffer = uniform(10 * 16);
  const aimBuffer = uniform(48);
  const reds = [0, 1].map((k) => {
    const b = uniform(16);
    device.queue.writeBuffer(b, 0, new Uint32Array([k, 0, 0, 0]));
    return b;
  });
  const wires = uniform(192);
  const gathered = uniform(208);
  const shown = uniform(48);
  const bakeBuffer = uniform(48);
  const linear: GPUSamplerDescriptor = { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" };
  const lin = device.createSampler(linear);
  const rep = device.createSampler({ ...linear, addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
  const ALL = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const volume = (size: V3, format: GPUTextureFormat = HDR, usage = ALL) => device.createTexture({ size, dimension: "3d", format, usage });
  type Bound = GPUBuffer | GPUTextureView | GPUTexture | GPUSampler;
  const bind = (of: GPURenderPipeline | GPUComputePipeline, entries: Record<number, Bound>) =>
    device.createBindGroup({
      layout: of.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([binding, e]) => ({
        binding: +binding,
        resource: e instanceof GPUBuffer ? { buffer: e } : e instanceof GPUTexture ? e.createView() : e,
      })),
    });

  const state = { frame: 0, hold: null as number | null, time: 0, simT: 0, skies: 1, busy: 1, pieces: 0, loaded: 0, grown: 0, steps: 0 };

  // the clouds it may begin from, and her
  const t0 = performance.now();
  const clouds = await Promise.all(
    CLOUDS.map(async (cloud) => {
      const answer = await fetch(`${import.meta.env.BASE_URL}clouds/${cloud}.vol`);
      const bytes = await new Response(answer.body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      const [w, h, d] = new Float32Array(bytes, 0, 4);
      const tex = volume([w, h, d], "r8unorm", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
      device.queue.writeTexture({ texture: tex }, new Uint8Array(bytes, 16), { bytesPerRow: w, rowsPerImage: h }, [w, h, d]);
      return tex;
    }),
  );
  const bytes = await new Response((await fetch(`${import.meta.env.BASE_URL}clouds/suzanne.bin`)).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const [nx, ny, nz, hx, hy, hz] = new Float32Array(bytes, 0, 7);
  const distances = new Int8Array(bytes, 28, nx * ny * nz);
  const skin = volume([nx, ny, nz], "r8snorm", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
  device.queue.writeTexture({ texture: skin }, distances, { bytesPerRow: nx, rowsPerImage: ny }, [nx, ny, nz]);
  state.loaded = performance.now() - t0;

  // the weather, twice over where a step reads one and writes the other
  const vel = [volume(SIM), volume(SIM)];
  const heat = [volume(SIM), volume(SIM), volume(SIM)];
  const curl = volume(SIM);
  const div = volume(SIM, "r32float");
  const pres = volume(SIM, "r32float");
  const ctl = [volume(LOW), volume(LOW)];
  const aimed = volume(LOW);
  const shape = volume(LOW);
  const carriedA = [volume(LOW), volume(LOW)];
  const carriedB = [volume(LOW), volume(LOW)];
  const grain = volume([96, 96, 96], "rgba8unorm", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING);
  const still = volume(GLOW);
  const glows = Array.from({ length: TAKES }, () => [volume(GLOW), volume(GLOW)]);
  const lit = new Uint8Array(TAKES); // which of each two is the light now
  const glow = volume(GLOW);
  const tallied = device.createBuffer({ size: GLOW[0] * GLOW[1] * GLOW[2] * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const put = (slot: number, ...v: number[]) => data.set(v, slot * 4);
  const settings = () => {
    put(5, ...HALF, CELL);
    put(6, look.thick, look.aside, look.step, look.shadeDeep);
    const [turn, high] = [(look.moonTurn * Math.PI) / 180, (look.moonHigh * Math.PI) / 180];
    put(8, Math.sin(turn) * Math.cos(high), Math.sin(high), Math.cos(turn) * Math.cos(high));
    put(13, look.white, look.dense);
  };
  const groups = (n: V3, by = 4) => n.map((v) => Math.ceil(v / by)) as [number, number, number];
  const run = (encoder: GPUCommandEncoder, list: [GPUComputePipeline, GPUBindGroup, [number, number, number]][]) => {
    const pass = encoder.beginComputePass();
    for (const [pipe, bound, g] of list) {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, bound);
      pass.dispatchWorkgroups(...g);
    }
    pass.end();
  };
  const once = (pipe: GPUComputePipeline, entries: Record<number, Bound>, g: [number, number, number]) => {
    const encoder = device.createCommandEncoder();
    run(encoder, [[pipe, bind(pipe, entries), g]]);
    device.queue.submit([encoder.finish()]);
  };
  once(pipes.makeGrain, { 17: grain }, [24, 24, 24]);

  // what the weather is, a step
  const weatherOf = (t: number, resetA: boolean, resetB: boolean) => {
    const dt = look.speed / look.hz;
    const steer = smooth(look.begins, look.begins + Math.max(look.ramp, 0.01), t);
    const first = look.first === "none" ? -1 : CLOUDS.indexOf(look.first);
    device.queue.writeBuffer(
      simBuffer,
      0,
      new Float32Array([
        dt, CELL, look.rise, look.weight,
        look.ground, look.lapse, look.humid, look.latent,
        look.stable, look.lid, look.lidAt, look.condense,
        look.swirl, look.warm, look.wet, look.pull * steer,
        look.now * steer, look.sofar * steer, look.under, look.calm * steer,
        look.full, Math.exp(-dt / look.remember), 1, look.mix,
        look.firstX, look.firstY, look.firstZ, look.firstSize,
        look.firstWater, look.firstWarm, first >= 0 ? 1 : 0, 0,
        look.sharp ? 1 : 0, resetA ? 1 : 0, resetB ? 1 : 0, Math.max(look.warmest, 0.01),
        look.outward, 0, 0, 0,
      ]),
    );
  };
  const S = { 0: params, 1: lin, 54: simBuffer };
  const stepBinds = [
    [pipes.advect, bind(pipes.advect, { ...S, 40: vel[0], 41: heat[0], 42: vel[1], 43: heat[1] }), groups(SIM)],
    [pipes.sharpen, bind(pipes.sharpen, { ...S, 40: vel[0], 41: heat[0], 63: heat[1], 43: heat[2] }), groups(SIM)],
    [pipes.swirl, bind(pipes.swirl, { 54: simBuffer, 40: vel[1], 45: curl }), groups(SIM)],
    [pipes.measure, bind(pipes.measure, { 54: simBuffer, 41: heat[2], 46: ctl[0], 47: ctl[1], 48: aimed, 55: shape }), groups(LOW)],
    [pipes.weather, bind(pipes.weather, { ...S, 40: vel[1], 41: heat[2], 44: curl, 46: ctl[1], 48: aimed, 42: vel[0], 43: heat[0] }), groups(SIM)],
    [pipes.diverge, bind(pipes.diverge, { 54: simBuffer, 40: vel[0], 50: div }), groups(SIM)],
  ] as [GPUComputePipeline, GPUBindGroup, [number, number, number]][];
  const relaxBinds = reds.map((r) => bind(pipes.relax, { 54: simBuffer, 49: div, 51: pres, 53: r }));
  const projectBind = bind(pipes.project, { 54: simBuffer, 40: vel[0], 52: pres, 42: vel[1] });
  const carryBind = bind(pipes.carry, { ...S, 40: vel[0], 57: carriedA[0], 59: carriedB[0], 58: carriedA[1], 60: carriedB[1] });
  const half = groups([SIM[0] / 2, SIM[1], SIM[2]]);
  const step = (encoder: GPUCommandEncoder) => {
    const list = [...stepBinds];
    for (let i = 0; i < look.solve; i++) for (const r of relaxBinds) list.push([pipes.relax, r, half]);
    list.push([pipes.project, projectBind, groups(SIM)]);
    run(encoder, list);
    encoder.copyTextureToTexture({ texture: vel[1] }, { texture: vel[0] }, SIM);
    encoder.copyTextureToTexture({ texture: ctl[1] }, { texture: ctl[0] }, LOW);
  };
  const begin = () => {
    settings();
    device.queue.writeBuffer(params, 0, data);
    weatherOf(0, true, true);
    const first = Math.max(0, CLOUDS.indexOf(look.first));
    const encoder = device.createCommandEncoder();
    run(encoder, [
      [pipes.begin, bind(pipes.begin, { ...S, 42: vel[0], 43: heat[0], 56: clouds[first] }), groups(SIM)],
      [pipes.clearPres, bind(pipes.clearPres, { 51: pres }), groups(SIM)],
      [pipes.clearLow, bind(pipes.clearLow, { 0: params, 47: ctl[0], 58: carriedA[0], 60: carriedB[0] }), groups(LOW)],
    ]);
    device.queue.submit([encoder.finish()]);
    state.simT = 0;
    // (the cloud as it is at first is measured, for the light to be worked out of)
    const e2 = device.createCommandEncoder();
    step(e2);
    device.queue.submit([e2.finish()]);
  };
  const aim = () => {
    settings();
    device.queue.writeBuffer(params, 0, data);
    device.queue.writeBuffer(aimBuffer, 0, new Float32Array([hx, hy, hz, look.flesh, look.eyes, look.mouth, look.ragged, look.muzzle, look.edge, 0, 0, 0]));
    once(pipes.aim, { 0: params, 1: lin, 7: grain, 8: rep, 47: aimed, 61: skin, 62: aimBuffer }, groups(LOW));
  };

  // where a bolt goes
  const farAt = (p: V3) => {
    const c = p.map((v, a) => clamp(Math.floor((v / [hx, hy, hz][a] + 1) * 0.5 * [nx, ny, nz][a]), 0, [nx, ny, nz][a] - 1));
    return (distances[(c[2] * ny + c[1]) * nx + c[0]] / 127) * 0.4;
  };
  const skinOut = (d: V3) => {
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
          const at = skinOut(d) - look.flesh - (ends ? -0.25 : look.depth + look.weave * (i % 2 ? -1 : 1) * (0.5 + 0.5 * rand()));
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
  const fresh = new Set<number>(); // whose light is to be worked out from nothing
  let baking: { take: number; lot: number } | null = null;
  const bakedAt = new Float64Array(TAKES).fill(-1e9);
  const grown: { key: string; main: Piece[]; rest: Piece[]; run: number }[] = [];
  let photonBind: GPUBindGroup | null = null;
  let sparkBind: GPUBindGroup | null = null;
  const growAll = () => {
    const t0 = performance.now();
    const all: number[] = [];
    takes = [];
    for (let k = 0; k < TAKES; k++) {
      const kind = look[`bolt${k + 1}` as "bolt1"];
      const crawls = kind === "crawl" ? [look.flesh, look.depth, look.weave, look.bends] : [];
      const key = [kind, look.seed, look.stray, look.cell, look.eta, look.forks, look.sparks, ...crawls].join();
      if (grown[k]?.key !== key) {
        const rand = random(look.seed * 101 + k * 17);
        const way = routeOf(kind, rand).map((p) => p.map((v) => v + (rand() - 0.5) * 2 * look.stray) as V3);
        const bolt = way.length ? strike(way, look.seed * 31 + k, { cell: look.cell, eta: look.eta, rho: 2, forks: look.forks, sparks: look.sparks, floor: -99 }) : { pieces: [] };
        const main = bolt.pieces.filter((p) => p.main);
        const run = main.reduce((s, p) => s + Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]), 0);
        grown[k] = { key, main, rest: bolt.pieces.filter((p) => !p.main), run };
        fresh.add(k);
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
    sparkBind = photonBind = null;
    state.grown = performance.now() - t0;
  };
  const GROUPS = groups(GLOW);
  const moonBind = bind(pipes.moonlight, { 0: params, 1: lin, 2: heat[0], 3: shape, 18: bakeBuffer, 21: still });
  const moonBake = (encoder: GPUCommandEncoder) => {
    device.queue.writeBuffer(bakeBuffer, 32, new Uint32Array([...GLOW, 0]));
    run(encoder, [[pipes.moonlight, moonBind, GROUPS]]);
  };
  // the light of the bolts, worked out again and again as the cloud changes: the one about to strike first
  const LOT = 1 << 18;
  const cellRoom = GLOW.reduce((s, v, a) => s * ((2 * HALF[a]) / v), 1);
  const upcoming = new Float32Array(TAKES);
  const pick = () => {
    const ready = takes.flatMap((t, k) => (t.main ? [k] : []));
    if (!ready.length) return -1;
    const new_ = ready.filter((k) => fresh.has(k));
    if (new_.length) return new_.sort((a, b) => upcoming[b] + fires[b] - (upcoming[a] + fires[a]))[0];
    if (!look.run) return -1; // (the cloud stands still: its light is as it was)
    let best = -1;
    let most = -1;
    for (const k of ready) {
      const score = (state.frame - bakedAt[k]) * (1 + 4 * upcoming[k] + 2 * (fires[k] > 0 ? 1 : 0));
      if (score > most) [best, most] = [k, score];
    }
    return best;
  };
  const bakeSome = (lots: number) => {
    if (!baking) {
      const k = pick();
      if (k < 0) return;
      baking = { take: k, lot: 0 };
      const clear = device.createCommandEncoder();
      clear.clearBuffer(tallied);
      device.queue.submit([clear.finish()]);
    }
    const take = takes[baking.take];
    const head = (turn: number, blend: number) => {
      const buffer = new ArrayBuffer(48);
      new Uint32Array(buffer).set([take.first, take.main, turn, state.frame]);
      new Float32Array(buffer).set([(STEP * take.run) / (look.lots * LOT * 64 * cellRoom), take.mean, STEP, blend], 4);
      new Uint32Array(buffer).set([...GLOW, 0], 8);
      device.queue.writeBuffer(bakeBuffer, 0, buffer);
    };
    photonBind ??= bind(pipes.photons, { 0: params, 1: lin, 2: heat[0], 3: shape, 9: pieces, 18: bakeBuffer, 19: tallied });
    for (let i = 0; i < lots && baking.lot < look.lots; i++, baking.lot++) {
      head(baking.lot, 0);
      const encoder = device.createCommandEncoder();
      run(encoder, [[pipes.photons, photonBind, [LOT / 64, 1, 1]]]);
      device.queue.submit([encoder.finish()]);
    }
    if (baking.lot < look.lots) return;
    const k = baking.take;
    head(0, fresh.has(k) ? 1 : look.blend);
    once(pipes.settle, { 18: bakeBuffer, 20: tallied, 21: glows[k][1 - lit[k]], 34: glows[k][lit[k]] }, GROUPS);
    lit[k] = 1 - lit[k];
    fresh.delete(k);
    bakedAt[k] = state.frame;
    gatherBind = null;
    baking = null;
  };
  let gatherBind: GPUBindGroup | null = null;
  const fires = new Float32Array(TAKES);
  const marchBind = bind(marchPipe, { 0: params, 1: lin, 2: heat[0], 3: shape, 4: still, 5: glow, 6: carriedA[0], 32: carriedB[0], 7: grain, 8: rep });

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
  const R = GPUTextureUsage.RENDER_ATTACHMENT;
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
  const called: { take: number; at: number }[] = [];
  const call = () => {
    const here = takes.flatMap((t, k) => (t.main && (look.only === "all" || +look.only === k + 1) ? [k] : []));
    if (here.length) called.push({ take: here[Math.floor(Math.random() * here.length)], at: clock });
    if (called.length > 8) called.shift();
  };
  const key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
    if (e.key === "b") call();
    if (e.key === "r") todo.begin = true;
  };
  window.addEventListener("keydown", key);
  const fade = (age: number) => 0.4 * Math.exp(-age / look.tail) + 0.6 * Math.exp(-age / (look.tail * 0.26));
  const fronts = new Float32Array(TAKES);
  const moment = (t: number) => {
    plan();
    fires.fill(0);
    fronts.fill(-1);
    upcoming.fill(0);
    const turn = (2 * Math.PI * t) / LOOP;
    const one = (take: number, age: number, gain: number, fresh: boolean) => {
      fires[take] += gain * fade(age);
      if (fresh && age < 0.06) fronts[take] = 1.05 - 1.2 * (age / 0.06);
    };
    for (const s of strokes) {
      const age = (t - s.t + LOOP) % LOOP;
      if (age < Math.min(LOOP - 1, look.tail * 8)) one(s.take, age, s.gain, s.fresh);
      if (LOOP - age < 0.5) upcoming[s.take] = 1;
    }
    if (state.hold === null && !look.freeze) for (const c of called) if (clock - c.at < 4) for (const [d, g] of [[0, 1.6], [0.14, 1], [0.24, 0.6]]) if (clock - c.at >= d) one(c.take, clock - c.at - d, g, d === 0);
    for (let k = 0; k < TAKES; k++) {
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
  const todo = { grow: true, aim: true, begin: true };
  const changed = (k: string, done = true) => {
    if (done && grows.has(k)) todo.grow = true;
    if (aims.has(k)) todo.aim = true;
    if (done && begins.has(k)) todo.begin = true;
    if (k === "lots" && baking) baking = null;
    if (state.hold === null) localStorage.setItem(STORE, JSON.stringify(different()));
  };
  const STORE = "bolt-grow";
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
  const shownTime = { t: "0.0 s" };
  const acts = {
    preset: "storm",
    again: () => (todo.begin = true),
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
  gui.add(shownTime, "t").name("grown for").disable().listen();
  gui.add(acts, "again").name("grow again (R)");
  gui.add(acts, "preset", Object.keys(presets)).onChange((name: string) => {
    wear(presets[name]);
    todo.begin = true;
  });
  gui.add(acts, "strike").name("strike (B)");
  gui.add(acts, "other bolts");
  const copies = gui.add(acts, "copy").name("copy settings");
  const pastes = gui.add(acts, "paste").name("paste settings");
  gui.add(acts, "reset");
  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name);
    if (name !== "growing") f.close();
    for (const k of keys) {
      const choices = k.startsWith("bolt") ? ROUTES : k === "only" ? ["all", "1", "2", "3", "4", "5", "6"] : k === "first" ? [...CLOUDS, "none"] : null;
      const c = choices
        ? f.add(look, k, choices as string[])
        : typeof look[k] === "string"
          ? f.addColor(look, k)
          : typeof look[k] === "boolean"
            ? f.add(look, k as "seed")
            : f.add(look, k as "seed", ...((ranges[k] ?? []) as [number, number, number]));
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
  let owed = 0;
  let lastStep = performance.now();
  let phaseA = 0;
  let phaseB = 0;
  wrap.render = () => {
    if (state.hold === null && !cap()) return;
    const now = performance.now();
    clock += Math.min(0.1, (now - before) / 1000);
    before = now;
    const t = (((state.hold ?? (look.freeze ? look.moment : clock)) % LOOP) + LOOP) % LOOP;
    settings();
    device.queue.writeBuffer(params, 0, data);
    if (todo.aim) aim();
    if (todo.grow) growAll();
    if (todo.begin) {
      begin();
      phaseA = phaseB = 0;
      for (let k = 0; k < TAKES; k++) fresh.add(k);
      baking = null;
    }
    todo.grow = todo.aim = todo.begin = false;
    state.time = t;
    const [cw, ch] = [canvas.width, canvas.height];
    const share = Math.min(1, Math.sqrt((look.detail * 1e6) / (cw * ch)));
    const [w, h] = [Math.max(16, Math.round(cw * share)), Math.max(16, Math.round(ch * share))];
    const key = `${w} ${h} ${cw} ${ch}`;
    if (pics?.key !== key) makePics(key, w, h, cw, ch);

    const encoder = device.createCommandEncoder();
    // the weather, a frame of it
    // (at so many steps a second of the clock, not a frame: it goes as fast whatever the frames do, and at 60 frames
    // a second it steps every other one)
    owed = Math.min(owed + (look.run ? Math.min(0.1, (now - lastStep) / 1000) * look.hz : 0), 1.5);
    lastStep = now;
    if (look.run && look.speed > 0 && owed >= 1) {
      owed -= 1;
      const dt = look.speed / look.hz;
      const A = Math.floor(state.simT / look.carried);
      const B = Math.floor(state.simT / look.carried + 0.5);
      weatherOf(state.simT, A !== phaseA, B !== phaseB);
      [phaseA, phaseB] = [A, B];
      step(encoder);
      run(encoder, [[pipes.carry, carryBind, groups(LOW)]]);
      encoder.copyTextureToTexture({ texture: carriedA[1] }, { texture: carriedA[0] }, LOW);
      encoder.copyTextureToTexture({ texture: carriedB[1] }, { texture: carriedB[0] }, LOW);
      state.simT += dt;
      state.steps++;
      if (state.steps % 4 === 0) moonBake(encoder);
    } else if (!look.run && state.frame % 30 === 0) moonBake(encoder);
    shownTime.t = `${state.simT.toFixed(1)} s`;
    const a = (state.simT / look.carried) % 1;

    const aspect = cw / ch;
    const halfFov = Math.tan((look.fov * Math.PI) / 360) * Math.max(1, 1.25 / aspect);
    orbit.update();
    const sway = look.sway * Math.sin((2 * Math.PI * t) / LOOP);
    eye.copy(camera.position).sub(orbit.target).applyAxisAngle(Y, sway);
    fore.copy(eye).normalize().negate();
    eye.add(orbit.target);
    right.crossVectors(fore, Y).normalize();
    up.crossVectors(right, fore);
    put(0, w, h, (2 * halfFov) / h, t);
    put(1, ...eye.toArray(), 0);
    put(2, ...right.multiplyScalar(halfFov * aspect).toArray(), 0);
    put(3, ...up.multiplyScalar(halfFov).toArray(), 0);
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
    put(7, look.fray, look.fraySize, 1 - Math.abs(2 * a - 1), look.shade);
    put(9, ...tone(look.moonTone, look.moon));
    put(10, ...tone(look.skyTone, look.sky * 10));
    put(11, look.core, look.branches, look.haloWide, look.hot);
    put(12, cw, ch, (2 * halfFov) / ch, look.halo);
    device.queue.writeBuffer(params, 0, data);
    device.queue.writeBuffer(
      shown,
      0,
      new Float32Array([cw, ch, look.exposure, look.grain, state.hold === null ? state.frame % 64 : 0, look.vignette, look.bloom, look.spread, (2 * halfFov) / h, 1, look.colour, 1]),
    );
    device.queue.submit([encoder.finish()]);
    bakeSome(1);
    state.busy = fresh.size + (baking ? 1 : 0);

    const p = pics!;
    const draws = device.createCommandEncoder();
    const pass = (to: GPUTextureView, load: boolean, run: (p: GPURenderPassEncoder) => void) => {
      const r = draws.beginRenderPass({ colorAttachments: [{ view: to, loadOp: load ? "load" : "clear", storeOp: "store" }] });
      run(r);
      r.end();
    };
    const draw = (to: GPUTextureView, pipe: GPURenderPipeline, bound: GPUBindGroup, load = false) =>
      pass(to, load, (r) => {
        r.setPipeline(pipe);
        r.setBindGroup(0, bound);
        r.draw(3);
      });
    sparkBind ??= bind(sparkPipe, { 0: params, 1: lin, 2: heat[0], 3: shape, 6: carriedA[0], 32: carriedB[0], 7: grain, 8: rep, 9: pieces, 10: wires });
    gatherBind ??= bind(pipes.gather, { 21: glow, 25: gathered, ...Object.fromEntries(glows.map((g, k) => [26 + k, g[lit[k]]])) });
    run(draws, [[pipes.gather, gatherBind, GROUPS]]);
    draw(p.marched, marchPipe, marchBind);
    draw(p.full, overPipe, p.over);
    pass(p.full, true, (r) => {
      r.setPipeline(sparkPipe);
      r.setBindGroup(0, sparkBind!);
      takes.forEach((take, k) => fires[k] > 0 && r.draw(6, take.count, k * 10, take.first));
    });
    p.down.forEach((b, i) => draw(p.glows[i], downPipe, b));
    for (let i = GLOWS - 2; i >= 0; i--) draw(p.glows[i], upPipe, p.up[i], true);
    draw(context.getCurrentTexture().createView(), showPipe, p.show);
    device.queue.submit([draws.finish()]);
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
  // (what the weather is, read back: for looking at)
  const probe = async () => {
    const read = async (tex: GPUTexture, size: V3) => {
      const row = Math.ceil((size[0] * 8) / 256) * 256;
      const buf = device.createBuffer({ size: row * size[1] * size[2], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e = device.createCommandEncoder();
      e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: row, rowsPerImage: size[1] }, size);
      device.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const raw = new Float16Array(buf.getMappedRange().slice(0));
      buf.destroy();
      const out = new Float32Array(size[0] * size[1] * size[2] * 4);
      const per = row / 2;
      for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) out.set(raw.subarray((z * size[1] + y) * per, (z * size[1] + y) * per + size[0] * 4), ((z * size[1] + y) * size[0]) * 4);
      return out;
    };
    const [h, v, c] = [await read(heat[0], SIM), await read(vel[0], SIM), await read(ctl[0], LOW)];
    const st = (a: Float32Array, ch: number, n = 4) => {
      let [lo, hi, sum] = [Infinity, -Infinity, 0];
      for (let i = ch; i < a.length; i += n) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); sum += a[i]; }
      return [lo, hi, sum / (a.length / n)].map((x) => +x.toFixed(4));
    };
    const where = (a: Float32Array, ch: number, sign: number) => {
      let [best, at] = [-Infinity, 0];
      for (let i = ch; i < a.length; i += 4) if (a[i] * sign > best) [best, at] = [a[i] * sign, (i - ch) / 4];
      const x = at % SIM[0], y = Math.floor(at / SIM[0]) % SIM[1], z = Math.floor(at / SIM[0] / SIM[1]);
      return [x, y, z, ...h.subarray(at * 4, at * 4 + 3), ...v.subarray(at * 4, at * 4 + 3)].map((q) => +q.toFixed(2));
    };
    const extremes = { cold: where(h, 0, -1), wet: where(h, 1, 1), water: where(h, 2, 1) };
    let fast = 0;
    for (let i = 0; i < v.length; i += 4) fast = Math.max(fast, Math.hypot(v[i], v[i + 1], v[i + 2]));
    // slices through the middle, front to back: cloud water, warmth, rising, what falls short
    const cv = document.createElement("canvas");
    const [W2, H2] = [SIM[0], SIM[1]];
    cv.width = W2 * 4;
    cv.height = H2 * 2;
    const g = cv.getContext("2d")!;
    const img = g.createImageData(W2 * 4, H2 * 2);
    const z0 = SIM[2] >> 1;
    const paintOf = (col: number, rowOff: number, f: (x: number, y: number) => number) => {
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        const val = f(x, y);
        const i = ((rowOff + H2 - 1 - y) * W2 * 4 + col * W2 + x) * 4;
        img.data.set([clamp(val) * 255, clamp(-val) * 255, clamp(Math.abs(val) * 0.3) * 255, 255], i);
      }
    };
    const at = (a: Float32Array, x: number, y: number, z: number, ch: number, n: V3) => a[((z * n[1] + y) * n[0] + x) * 4 + ch];
    for (const [row, z] of [[0, z0], [1, Math.round(SIM[2] * 0.72)]] as const) {
      paintOf(0, row * H2, (x, y) => at(h, x, y, z, 2, SIM) / 2);
      paintOf(1, row * H2, (x, y) => at(h, x, y, z, 0, SIM) / 3);
      paintOf(2, row * H2, (x, y) => at(v, x, y, z, 1, SIM) / 1);
      paintOf(3, row * H2, (x, y) => at(c, x >> 1, y >> 1, z >> 1, 1, LOW));
    }
    g.putImageData(img, 0, 0);
    return { extremes, theta: st(h, 0), vapour: st(h, 1), water: st(h, 2), fast: +fast.toFixed(3), there: st(c, 0), short: st(c, 1), sofar: st(c, 2), slices: cv.toDataURL() };
  };
  Object.assign(window, { __bolt: { look, state, changed, device, camera, orbit, probe, again: () => (todo.begin = true), render: () => wrap.render!({} as never) } });
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
