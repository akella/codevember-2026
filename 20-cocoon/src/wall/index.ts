/**
 * Cocoons as pixels: a wall of hundreds, each turned its side or its end to us and lit as strongly as its part of a
 * picture. Only so many poses of them are lit in a frame, by the networks, and each cocoon is drawn as the nearest.
 */
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Matrix4, PerspectiveCamera, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { frameCap } from "../cap";
import common from "./common.wgsl?raw";
import fibreCode from "./fibre.wgsl?raw";
import { KINDS, load, type KindName } from "../load";
import { makeRelief } from "../relief";
import { foldLamps, netCode, type Lamp } from "../net";
import lensCode from "../rain/lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "./shade-on.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shellCode from "./shell.wgsl?raw";
import glazeCode from "./glaze.wgsl?raw";
import { PICTURES, makePicture } from "./picture";
import veilCode from "../rain/veil.wgsl?raw";
import shadeStrand from "./shade-strand.wgsl?raw";

const DURATION = 12;
type Pose = { R: number[]; t: number[] };
/** how many poses, of how many cocoons, are lit; and how far apart the wall's cocoons are */
const TILTS = 32;
const IDS = [0, 2];
const [DX, DY] = [1.62, 2.12];
const MOST = 700;
const PLACES = IDS.flatMap((id) => Array.from({ length: TILTS }, (_, k) => ({ id, tilt: (k / (TILTS - 1)) * (Math.PI / 2) })));
/** a lamp's light as much stronger as the relief faces it more than the smooth shell does */
const SHARPEN = `
fn sharpened(light: array<vec3f, 3>, normal: vec3f, smooth_: vec3f) -> array<vec3f, 3> {
  var out = light;
  for (var k = 0u; k < 3u; k++) {
    let w = shadow.lamps[k].xyz;
    let l = body.x.xyz * w.x + body.y.xyz * w.y + body.z.xyz * w.z;
    let r = (max(dot(normal, l), 0.0) + 0.22) / (max(dot(smooth_, l), 0.0) + 0.22);
    out[k] *= mix(1.0, clamp(r, 0.35, 1.9), shadow.look.z);
  }
  return out;
}
`;
/** the relief: not what the networks were shown, but they are told which way it faces */
const PEBBLES = undefined;
const FAR = 58;
const SAMPLES = 4;
const GLOWS = 6;
const AIR = { wound: 0, fuzz: 0.22, floss: 1, thread: 0.7, web: 0 };
const bits = new DataView(new ArrayBuffer(4));
const airy = (x: number) => (bits.setFloat32(0, x), bits.getUint32(0));

const look = {
  exposure: 1.25,
  gamma: 1,
  bloom: 0.03,
  spread: 0.95,
  fibre: 1,
  /** contrast among neighbouring strands, put back */
  crisp: 0.7,
  /** how wide the lens opens (half a cocoon is 1), and how far before the middle of the view it is focused */
  lens: 0,
  focus: 0,
  /** how far before and behind the focus everything is quite sharp */
  sharp: 1.5,
  /** how far the air moves loose silk, in units of half a cocoon */
  air: 0.014,
    /** how dark one cocoon's shadow on another is (the light also comes through it) */
  shadow: 0.8,
  /** how much the lines sway; how much the torn silk crinkles; how wide a hair is drawn, in pixels */
  sway: 1,
  picture: "moth",
  /** how much dimmer for every unit farther */
  dim: 0,
  /** the wall behind: how light, and how much darker towards its corners */
  wall: 0.0035,
  fall: 0.8,
  /** how wide the lamps are (radians) */
  wide: 0.15,
  /** how much of the cocoons' light comes back on the silk before them */
  bounce: 1,
  /** how far the light the silk has warmed is made white again */
  white: 0.15,
  /** how far the relief's own directions sharpen what the networks make of it */
  relief: 0.15,
  /** how many of the hairs lying on the cocoons */
  hairs: 1,
  /** how thick the web's strands are: thinner ones are fainter, and don't add up to white */
  web: 1,
  hair: 0.9,
  shells: true,
  wound: true,
  fuzz: true,
  floss: true,
  thread: true,
};

/** azimuth from the camera's side (0 in front, 180 behind), elevation, power (1 makes a facing wall white) */
const lamps = {
  key: { azimuth: -24, elevation: 26, power: 1.2, colour: "#fff3e2" },
  fill: { azimuth: -150, elevation: 20, power: 0.4, colour: "#ffc98e" },
  back: { azimuth: 140, elevation: 35, power: 0.22, colour: "#bcd2ff" },
};

const linear = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2) as [number, number, number];

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    document.querySelector("#loader")?.classList.add("failed");
    return;
  }
  const timed = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({ requiredFeatures: (["timestamp-query", "shader-f16"] as const).filter((f) => adapter.features.has(f)) });
  const context = canvas.getContext("webgpu")! as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const cocoon = await load("./compact/");
  const { head } = cocoon;
  // ---------------------------------------------------------------- what is on the card

  const buffer = (data: ArrayBufferView | number, usage: number) => {
    const size = typeof data === "number" ? data : data.byteLength;
    const b = device.createBuffer({ size: Math.ceil(size / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST });
    if (typeof data !== "number") device.queue.writeBuffer(b, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return b;
  };
  const { UNIFORM, STORAGE, INDEX } = GPUBufferUsage;
  const padded = (a: Uint8Array) => {
    const out = new Uint8Array(Math.ceil(a.length / 4) * 4);
    out.set(a);
    return out;
  };
  const frameBuffer = buffer(128, UNIFORM);
  const shapes = new Float32Array(4 * 20);
  head.cocoons.forEach((c, n) => {
    shapes.set([...c.c, 0, ...c.M[0], 0, ...c.M[1], 0, ...c.M[2], 0, c.A, c.B, c.p, 0], n * 20);
  });
  const shapeBuffer = buffer(shapes, UNIFORM);

  // what moves as one: the cocoons, and (their points are in the world already) each one's thread
  const N = PLACES.length;
  const BODIES = [...PLACES.map((c) => c.id), 0].map((id, b) => ({ id, world: b >= N, of: b % N, buffer: buffer(128, UNIFORM), seen: true, d: 0 }));

  // the still strands' points, and after them the threads', as they hang and as they are
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const COLS = 41;
  const threadData = new Float32Array(COLS * 3 * 24 * 4);
  for (let c = 0; c < COLS; c++)
    for (let k = 0; k < 3; k++)
      for (let j = 0; j < 24; j++) threadData.set([(c - (COLS - 1) / 2) * DX + 0.035 * Math.sin(j * 1.7 + k * 2.1 + c), 22 - (j / 23) * 44, 0.035 * Math.cos(j * 1.9 + k * 2.1), F.radius * 7], ((c * 3 + k) * 24 + j) * 4);
  const webs = [{ data: threadData, n: COLS * 3, points: 24, step: 1.9 }];
  let room = still;
  const webFirst = webs.map((w) => (room += w.n * w.points) - w.n * w.points);
  const pointData = new Float32Array(room * 4);
  pointData.set(cocoon.points);
  webs.forEach((w, i) => pointData.set(w.data, webFirst[i] * 4));
  const points = buffer(pointData, STORAGE);
  const codes = buffer(padded(cocoon.codes), STORAGE);
  // the relief is made here, not downloaded
  const { relief, view: detail } = makeRelief(device, head, PEBBLES);

  /** layers of four numbers, with smaller copies for when it is far */
  const texture = (name: "coarse" | "fine", mips: boolean) => {
    const { u, v, layers } = head[name];
    const levels = mips ? 5 : 1;
    const t = device.createTexture({ size: [u, v, layers], format: "rgba8unorm", mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const all = name === "coarse" ? cocoon.section(name) : cocoon[name];
    for (let l = 0; l < layers; l++) {
      let data = all.subarray(l * u * v * 4, (l + 1) * u * v * 4);
      let [w, h] = [u, v];
      for (let m = 0; m < levels; m++) {
        device.queue.writeTexture({ texture: t, mipLevel: m, origin: [0, 0, l] }, data as Uint8Array<ArrayBuffer>, { bytesPerRow: w * 4 }, [w, h]);
        const half = new Uint8Array((w / 2) * (h / 2) * 4);
        for (let y = 0; y < h / 2; y++)
          for (let x = 0; x < w / 2; x++)
            for (let c = 0; c < 4; c++) {
              const o = (y * 2 * w + x * 2) * 4 + c;
              half[((y * w) / 2 + x) * 4 + c] = (data[o] + data[o + 4] + data[o + w * 4] + data[o + w * 4 + 4] + 2) >> 2;
            }
        data = half;
        w /= 2;
        h /= 2;
      }
    }
    return t.createView({ dimension: "2d-array" });
  };
  const coarse = texture("coarse", false);
  const fine = texture("fine", true);
  const around = device.createSampler({ addressModeU: "repeat", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 4 });
  const plain = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });

  const netNames = ["shell", "on", "free", "strand"] as const;
  const nets = Object.fromEntries(
    netNames.map((name) => {
      const code = netCode(name, head.nets[name], 2, 0, device.features.has("shader-f16"), Object.keys(lamps).length);
      return [name, { ...code, heads: name === "strand" ? [buffer(code.head * 16, UNIFORM)] : PLACES.map(() => buffer(code.head * 16, UNIFORM)) }];
    }),
  ) as Record<(typeof netNames)[number], ReturnType<typeof netCode> & { heads: GPUBuffer[] }>;

  // ---------------------------------------------------------------- pipelines

  const module = (code: string) => device.createShaderModule({ code: code.includes("mat4x4h") ? "enable f16;\n" + code : code });
  const group = (pipeline: GPURenderPipeline | GPUComputePipeline, index: number, resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries: resources.map((resource, binding) => ({ binding, resource })) });
  const of = (b: GPUBuffer) => ({ buffer: b });

  const HDR = "rgba16float" as const;
  const SOFT = "rgba16float" as const;
  const over: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
  const depth = (write: boolean): GPUDepthStencilState => ({ format: "depth24plus", depthWriteEnabled: write, depthCompare: "less" });

  const { COMPUTE, VERTEX, FRAGMENT } = GPUShaderStage;
  type Bind = "uniform" | "storage" | "read-only-storage" | "texture" | "sampler" | "store";
  const layout = (visibility: number, kinds: Bind[]) =>
    device.createBindGroupLayout({
      entries: kinds.map((k, binding) => ({
        binding,
        visibility,
        ...(k === "texture" ? { texture: { viewDimension: "2d-array" } } : k === "sampler" ? { sampler: {} } : k === "store" ? { storageTexture: { format: HDR, viewDimension: "2d-array" } } : { buffer: { type: k } }),
      })),
    });
  const bind = (l: GPUBindGroupLayout, resources: GPUBindingResource[]) => device.createBindGroup({ layout: l, entries: resources.map((resource, binding) => ({ binding, resource })) });
  const pipeLayout = (...bindGroupLayouts: GPUBindGroupLayout[]) => device.createPipelineLayout({ bindGroupLayouts });
  const L = {
    base: device.createBindGroupLayout({
      entries: ([0, 1, 2, 3, 4] as const).map((binding) => ({ binding, visibility: COMPUTE | VERTEX | FRAGMENT, buffer: { type: binding === 4 ? ("read-only-storage" as const) : ("uniform" as const) } })),
    }),
    on: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "texture", "texture", "sampler", "texture"]),
    free: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage"]),
    veil: layout(COMPUTE, ["uniform", "read-only-storage", "storage"]),
    head: layout(COMPUTE | FRAGMENT, ["uniform"]),
    fibre: layout(VERTEX, ["uniform", "read-only-storage", "read-only-storage", "uniform"]),
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "uniform", "texture", "sampler", "uniform"]),
    glaze: layout(COMPUTE, ["texture", "texture", "sampler", "texture", "store", "uniform"]),
  };
  const smoother = (code: string) => code.replace("textureSampleLevel(fineTex, around, uv, n * 2u + l, 0.0)", "textureSampleLevel(fineTex, around, uv, n * 2u + l, 0.0)").replace("shaded(run_shell(&x), shade)", "shaded(sharpened(run_shell(&x), normal, d), shade)") + SHARPEN;
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), common + nets.on.code + shadeCode.replace("SHADE", shadeOn)),
    free: await compute(pipeLayout(L.base, L.free, L.head), common + nets.free.code + shadeCode.replace("SHADE", shadeFree.replace("run_free(&x)", "shaded(run_free(&x), veilAt(i, t))") + "\n  let key = 0.0;").replace(/@group\(1\) @binding\([6789]\).*\n/g, "")),
    strand: await compute(pipeLayout(L.base, L.free, L.head), common + nets.strand.code + shadeCode.replace("SHADE", shadeStrand).replace(/@group\(1\) @binding\([6789]\).*\n/g, "")),
  };
  const veilPipe = await compute(pipeLayout(L.base, L.veil), common + veilCode);
  const glazePipe = await compute(pipeLayout(L.base, L.glaze, L.head), common + nets.shell.code + smoother(glazeCode));
  const shellModule = module(common + shellCode);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell),
    vertex: { module: shellModule },
    fragment: { module: shellModule, entryPoint: "fragment", targets: [{ format: HDR }, { format: SOFT }] },
    primitive: { cullMode: "back" },
    depthStencil: depth(true),
    multisample: { count: SAMPLES },
  });
  const fibreModule = module(common + fibreCode);
  const fibrePipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.fibre),
    vertex: { module: fibreModule },
    fragment: { module: fibreModule, targets: [{ format: HDR, blend: over }, { format: SOFT, blend: over }] },
    primitive: { topology: "triangle-strip" },
    depthStencil: depth(false),
    multisample: { count: SAMPLES },
  });
  const shadowBuffer = buffer((4 + 24 * 3 + 6 + 3) * 16, UNIFORM);
  const copyBuffer = buffer((MOST + 1) * 16, STORAGE);
  const bases = BODIES.map((b) => bind(L.base, [of(frameBuffer), of(shapeBuffer), of(b.buffer), of(shadowBuffer), of(copyBuffer)]));

  // ---------------------------------------------------------------- the sets of fibres

  const owners: number[] = [];
  const owned = (list: number[]) => {
    const at = owners.length;
    owners.push(...list);
    return at;
  };
  const count = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
  let litRoom = 0;
  const plans: { name: KindName; kind: KindName; body: number; first: number; n: number; points: number; map: number }[] = [];
  for (const name of ["wound", "fuzz"] as const) {
    const k = head.kinds[name];
    const per = k.n / head.cocoons.length;
    BODIES.forEach((b, body) => {
      if (!b.world) plans.push({ name, kind: name, body, first: cocoon.first[name] + b.id * per * k.points, n: name === "wound" ? 260 : 300, points: k.points, map: owned(count(per, b.id * per).slice(0, 300)) });
    });
  }
  const coat = F.n / head.cocoons.length;
  const zeros = owned(Array(Math.max(...webs.map((w) => w.n))).fill(0));
  BODIES.forEach((b, body) => {
    if (b.world) webs.forEach((w, i) => plans.push({ name: "thread", kind: "thread", body, first: webFirst[i], n: w.n, points: w.points, map: zeros }));
  });
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE);
  // at how many places along each the shadows are worked out
  const veilsOf = (k: KindName) => (head.kinds[k].on ? 3 : 6);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p.kind)) - p.n * veilsOf(p.kind));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(64, UNIFORM);
    const data = new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, 0, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p.kind), p.points, 1, 0, 0]);
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    let step = webs.find((w) => w.n === p.n && w.points === p.points)?.step ?? 0.03;
    if (p.kind !== "thread") {
      step = 0;
      for (let i = 0; i < 200; i++) {
        const o = (p.first + Math.floor((i / 200) * Math.min(p.n, 60)) * p.points + 3) * 4;
        step += Math.hypot(...[0, 1, 2].map((c) => pointData[o + c] - pointData[o + 4 + c])) / 200;
      }
    }
    const shared = [of(b), of(points), of(codes), of(lit), of(ownerBuffer), of(veils)];
    return {
      ...p,
      pipe: shadePipes[p.kind === "thread" ? "strand" : k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail]) : bind(L.free, shared), bind(L.head, [of(p.kind === "thread" ? nets.strand.heads[0] : nets[k.on ? "on" : "free"].heads[p.body])])],
      veil: bind(L.veil, [of(b), of(points), of(veils)]),
      data,
      buffer: b,
      // of the fibres so many, of their points so many: as it has pixels for
      now: { n: p.n, points: p.points, stride: 1 },
      draw: [bases[p.body], bind(L.fibre, [of(b), of(points), of(lit), of(splitBuffer)])],
      step,
      splitBuffer,
    };
  });

  // the shells' light, on a grid over each: so fine, and this much of it
  const FINE = 256;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeStore = glazeTexture.createView({ dimension: "2d-array" });
  const glazes = PLACES.map((_, i) => {
    const b = buffer(16, UNIFORM);
    return { buffer: b, group: bind(L.glaze, [coarse, fine, around, detail, glazeStore, of(b)]), head: bind(L.head, [of(nets.shell.heads[i])]), w: 0 };
  });

  const { u: GU, v: GV, lo, hi } = head.relief;
  const gridData = new DataView(new ArrayBuffer(16));
  gridData.setUint32(0, GU, true);
  gridData.setUint32(4, GV, true);
  gridData.setFloat32(8, lo, true);
  gridData.setFloat32(12, hi, true);
  // every other line of the grid: the rest of the relief is in the shading
  const index = new Uint32Array(((GU * GV) / 64) * 6);
  for (let v = 0, o = 0; v < GV; v += 8)
    for (let u = 0; u < GU; u += 8) {
      const [a, b, c, d] = [v * GU + u, v * GU + ((u + 8) % GU), (v + 8) * GU + u, (v + 8) * GU + ((u + 8) % GU)];
      index.set([a, c, b, b, c, d], o);
      o += 6;
    }
  const indexBuffer = buffer(index, INDEX);
  const gridBuffer = buffer(new Uint8Array(gridData.buffer), UNIFORM);
  const shellGroups = glazes.map((g) => bind(L.shell, [of(relief), of(gridBuffer), glazeTexture.createView({ dimension: "2d-array" }), plain, of(g.buffer)]));

  const wallModule = module(`
    struct Wall { light: vec4f, size: vec4f }
    @group(0) @binding(0) var<uniform> wall: Wall;
    @vertex fn screen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 1.0, 1.0); }
    struct Ink { @location(0) light: vec4f, @location(1) soft: vec4f }
    @fragment fn wash(@builtin(position) p: vec4f) -> Ink {
      let q = p.xy / wall.size.xy;
      // the light falls on it from the left, and off towards the far corners
      let d = (q - vec2f(0.30, 0.42)) * vec2f(1.0, 0.85);
      let l = mix(1.0, exp(-2.1 * dot(d, d)), wall.light.w);
      return Ink(vec4f(wall.light.rgb * l, 1.0), vec4f(0.0));
    }`);
  const wallBuffer = buffer(32, UNIFORM);
  const wallPipe = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: wallModule },
    fragment: { module: wallModule, targets: [{ format: HDR }, { format: SOFT }] },
    depthStencil: { ...depth(false), depthCompare: "always" },
    multisample: { count: SAMPLES },
  });
  const wallGroup = device.createBindGroup({ layout: wallPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: of(wallBuffer) }] });
  const postModule = module(postCode);
  const postBuffer = buffer(64, UNIFORM);
  const screenPipe = (entryPoint: string, target: GPUTextureFormat, blend?: GPUBlendState) =>
    device.createRenderPipeline({ layout: "auto", vertex: { module: postModule, entryPoint: "screen" }, fragment: { module: postModule, entryPoint, targets: [{ format: target, blend }] } });
  const add: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
  const downPipe = screenPipe("down", HDR);
  const upPipe = screenPipe("up", HDR, add);
  const finalPipe = screenPipe("final_", format);
  const lensModule = module(lensCode);
  const lensBuffer = buffer(16, UNIFORM);
  const lensPipe = (entryPoint: string) =>
    device.createRenderPipeline({ layout: "auto", vertex: { module: lensModule, entryPoint: "screen" }, fragment: { module: lensModule, entryPoint, targets: [{ format: HDR }] } });
  const halfPipe = lensPipe("half_");
  const smallPipe = lensPipe("small");
  const gatherPipe = lensPipe("gather");
  const layPipe = lensPipe("lay");

  // ---------------------------------------------------------------- the picture's textures

  type Targets = ReturnType<typeof makeTargets>;
  const makeTargets = (w: number, h: number) => {
    const { RENDER_ATTACHMENT, TEXTURE_BINDING, TRANSIENT_ATTACHMENT } = GPUTextureUsage as typeof GPUTextureUsage & { TRANSIENT_ATTACHMENT?: number };
    const transient = RENDER_ATTACHMENT | (TRANSIENT_ATTACHMENT ?? 0);
    const color = device.createTexture({ size: [w, h], format: HDR, sampleCount: SAMPLES, usage: transient });
    const deep = device.createTexture({ size: [w, h], format: "depth24plus", sampleCount: SAMPLES, usage: transient });
    const soft = device.createTexture({ size: [w, h], format: SOFT, sampleCount: SAMPLES, usage: transient });
    const [sharp, blurs] = ([HDR, SOFT] as const).map((format) => device.createTexture({ size: [w, h], format, usage: RENDER_ATTACHMENT | TEXTURE_BINDING }));
    const SMALLS = 4;
    const [small, spread] = [SMALLS, 1].map((mipLevelCount) =>
      device.createTexture({ size: [Math.max(8, w >> 1), Math.max(8, h >> 1)], mipLevelCount, format: HDR, usage: RENDER_ATTACHMENT | TEXTURE_BINDING }),
    );
    const smalls = Array.from({ length: SMALLS }, (_, i) => small.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    const [sharpView, blursView, smallView, spreadView] = [sharp, blurs, small, spread].map((t) => t.createView());
    const lensGroup = (pipe: GPURenderPipeline, entries: [number, GPUBindingResource][]) =>
      device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map(([binding, resource]) => ({ binding, resource })) });
    const flat = device.createTexture({ size: [w, h], format: HDR, usage: RENDER_ATTACHMENT | TEXTURE_BINDING });
    const glows = Array.from({ length: GLOWS }, (_, i) =>
      device.createTexture({ size: [Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))], format: HDR, usage: RENDER_ATTACHMENT | TEXTURE_BINDING }),
    );
    const views = [flat, ...glows].map((t) => t.createView());
    return {
      w,
      h,
      color: color.createView(),
      soft: soft.createView(),
      sharp: sharpView,
      blurs: blursView,
      lens: [
        { view: smalls[0], pipe: halfPipe, group: lensGroup(halfPipe, [[1, sharpView], [2, plain], [3, blursView]]) },
        ...smalls.slice(1).map((view, i) => ({ view, pipe: smallPipe, group: lensGroup(smallPipe, [[1, smalls[i]], [2, plain]]) })),
        { view: spreadView, pipe: gatherPipe, group: lensGroup(gatherPipe, [[0, of(lensBuffer)], [1, smallView], [2, plain], [3, blursView]]) },
        { view: views[0], pipe: layPipe, group: lensGroup(layPipe, [[1, sharpView], [2, plain], [3, blursView], [4, spreadView]]) },
      ],
      deep: deep.createView(),
      views,
      down: glows.map((_, i) => device.createBindGroup({ layout: downPipe.getBindGroupLayout(0), entries: [{ binding: 1, resource: views[i] }, { binding: 2, resource: plain }] })),
      up: glows.slice(1).map((_, i) =>
        device.createBindGroup({ layout: upPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: of(postBuffer) }, { binding: 1, resource: views[i + 2] }, { binding: 2, resource: plain }] }),
      ),
      final: device.createBindGroup({
        layout: finalPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: of(postBuffer) }, { binding: 1, resource: views[0] }, { binding: 2, resource: plain }, { binding: 3, resource: views[1] }],
      }),
      drop: () => [color, soft, sharp, blurs, small, spread, deep, flat, ...glows].forEach((t) => t.destroy()),
    };
  };
  let targets: Targets | undefined;

  // ---------------------------------------------------------------- camera and controls

  const camera = new PerspectiveCamera(head.fov, width / height, 5, 160);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 2.2;
  controls.maxDistance = 90;
  // what the networks were shown
  controls.minPolarAngle = Math.PI / 2 - (36 * Math.PI) / 180;
  controls.maxPolarAngle = Math.PI / 2 + (28 * Math.PI) / 180;
  const home = (az = 0, el = 0, dist = FAR, target: [number, number, number] = [0, 0, 0]) => {
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    controls.target.set(...target);
    camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(controls.target);
    controls.update();
  };
  home();

  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  const gui = new GUI({ title: "cocoon" });
  const picture = gui.addFolder("picture");
  picture.add(look, "picture", Object.keys(PICTURES));
  picture.add(look, "exposure", 0.1, 4);
  picture.add(look, "gamma", 0.6, 1.6);
  picture.add(look, "bloom", 0, 0.4);
  picture.add(look, "fibre", 0.3, 3).name("fibre width");
  picture.add(look, "crisp", 0, 3);
  picture.add(look, "lens", 0, 0.6);
  picture.add(look, "focus", -1.5, 2);
  picture.add(look, "sharp", 0, 4);
  picture.add(look, "air", 0, 0.06);
  picture.add(look, "shadow", 0, 1);
  picture.add(look, "sway", 0, 2);
  picture.add(look, "web", 0.2, 1.5);
  picture.add(look, "hair", 0.4, 2);
  picture.add(look, "wall", 0, 0.5);
  picture.add(look, "fall", 0, 1);
  picture.add(look, "wide", 0, 1);
  picture.add(look, "bounce", 0, 2);
  picture.add(look, "white", 0, 1);
  picture.add(look, "relief", 0, 2);
  picture.add(look, "hairs", 0.02, 1);
  for (const [name, l] of Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`);
    f.add(l, "azimuth", -180, 180);
    f.add(l, "elevation", -36, 80);
    f.add(l, "power", 0, 6);
    f.addColor(l, "colour");
  }
  const parts = gui.addFolder("parts").close();
  for (const k of ["shells", ...KINDS] as const) parts.add(look, k);

  const [drawNow, drawThen, drawLast] = [makePicture(), makePicture(), makePicture()];

  // ---------------------------------------------------------------- a frame

  // how long the passes take the card (tools/perf.mjs asks)
  const times = timed ? { set: device.createQuerySet({ type: "timestamp", count: 6 }), raw: device.createBuffer({ size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) } : undefined;
  const stamp = (i: number) => (times && state.time ? { querySet: times.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } : undefined);
  const state = { hold: undefined as number | undefined, frame: 0, ms: 0, time: undefined as ((ms: Record<string, number>) => void) | undefined };
  const due = frameCap();
  const frameData = new Float32Array(32);
  const viewProj = new Matrix4();

  wrap.render = ({ playhead }) => {
    if (state.hold === undefined && !due()) return;
    const t = state.hold ?? playhead;
    controls.update();
    stats.update();
    const [w, h] = [canvas.width, canvas.height];
    if (!targets || targets.w !== w || targets.h !== h) {
      targets?.drop();
      targets = makeTargets(w, h);
    }
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const far = camera.position.distanceTo(controls.target);
    const pixels = h / 2 / Math.tan((head.fov * Math.PI) / 360);
    frameData.set(viewProj.elements, 0);
    frameData.set([...camera.position.toArray(), 1], 16);
    // and how much blur, in pixels, still counts as sharp: what all of the layer has
    const within = look.lens * (far / 15.6) ** 0.75 * pixels * (1 / Math.max(0.5, far - look.focus - look.sharp) - 1 / Math.max(0.5, far - look.focus));
    frameData.set([w, h, pixels, within], 20);
    frameData.set([look.dim, far - 1.5, 0, look.fibre], 24);
    const widest = h * 0.022;
    const focus = Math.max(0.5, far - look.focus);
    // opened less the closer it is, or there would be nothing but blur
    frameData.set([t * Math.PI * 2, look.lens * (far / 15.6) ** 0.75, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);

    /** lamps as wide as softboxes: each the mean of several, the last layer being linear in them */
    const RING = 7;
    const wideLamps = (name: (typeof netNames)[number], lampList: Lamp[], back: (v: number[]) => Lamp["dir"]) => {
      let sum: Float32Array | undefined;
      for (let q = 0; q < RING; q++) {
        const part = foldLamps(
          { ...head, tint: head.tint.map((c) => c.map((x) => x + (Math.max(...c) * 0.97 - x) * look.white)) },
          name,
          lampList.map((l) => {
            const [x, y, z] = l.dir;
            const s = Math.hypot(x, z) || 1;
            const [u, v] = [[z / s, 0, -x / s], [(-x * y) / s, s, (-z * y) / s]];
            const a = (q / (RING - 1)) * Math.PI * 2;
            const [cu, cv] = q === RING - 1 ? [0, 0] : [Math.cos(a) * look.wide, Math.sin(a) * look.wide];
            const d = [0, 1, 2].map((k) => l.dir[k] + u[k] * cu + v[k] * cv);
            const n = Math.hypot(...d);
            return { dir: back(d.map((e) => e / n)), colour: l.colour };
          }),
        );
        if (!sum) sum = part.map((e) => e / RING) as Float32Array;
        else part.forEach((e, k) => (sum![k] += e / RING));
      }
      return sum as Float32Array<ArrayBuffer>;
    };

    // ---- where everything is
    const eye = camera.position.toArray() as [number, number, number];
    const list = Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"] };
    });
    const cluster: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
    // side on (its long axis up) to end on
    const hung = PLACES.map(({ id, tilt }) => {
      const [c, s] = [Math.cos(tilt), Math.sin(tilt)];
      const f = 0.9 + id * 1.7;
      const [cf, sf] = [Math.cos(f), Math.sin(f)];
      const x = [0.12 * c, 0.99 * c, s];
      const n = Math.hypot(...x);
      const ax = x.map((e) => e / n);
      const y0 = [ax[1], -ax[0], 0];
      const yn = Math.hypot(...y0) || 1;
      const y1 = y0.map((e) => e / yn);
      const z1 = [ax[1] * y1[2] - ax[2] * y1[1], ax[2] * y1[0] - ax[0] * y1[2], ax[0] * y1[1] - ax[1] * y1[0]];
      const y = y1.map((e, k) => e * cf + z1[k] * sf);
      const z = z1.map((e, k) => e * cf - y1[k] * sf);
      return { body: { R: [ax[0], y[0], z[0], ax[1], y[1], z[1], ax[2], y[2], z[2]], t: [0, 0, 0] } as Pose };
    });
    // each of the wall's: how light the picture is where it is, and (a little later, it has to turn) how far it has turned
    const halfY = FAR * Math.tan((head.fov * Math.PI) / 360);
    const halfX = halfY * (w / h);
    const cols = Math.min(COLS, 2 * Math.ceil(halfX / DX) + 1);
    const rowsN = 2 * Math.ceil(halfY / DY) + 1;
    const [bright, turned0, turned1] = [drawNow(look.picture, t), drawThen(look.picture, t - 0.3 / DURATION), drawLast(look.picture, t - 0.55 / DURATION)].map((f) => f);
    const buckets: number[][] = PLACES.map(() => []);
    let total = 0;
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rowsN && total < MOST; r++, total++) {
        const col = c - (cols - 1) / 2;
        const x = col * DX;
        const own = Math.sin(col * 127.1 + r * 311.7) * 43758.5453;
        const jitter = own - Math.floor(own);
        const y = ((rowsN - 1) / 2 - r) * DY + (Math.abs(col) % 2 ? DY / 2 : 0) + 0.12 * (jitter - 0.5);
        // over the whole wall, the picture's shape kept
        const s = Math.min(halfX / 50, halfY / 34);
        const [u, v] = [0.5 + x / s / 128, 0.5 - y / s / 72];
        const k = bright(u, v);
        const turned = 0.5 * turned0(u, v) + 0.5 * turned1(u, v);
        const tilt = (1 - turned) * 0.96 + 0.04 * Math.sin(t * Math.PI * 2 * 2 + jitter * 6.28) * look.sway;
        const pose = Math.min(TILTS - 1, Math.max(0, Math.round(tilt * (TILTS - 1))));
        buckets[((c + r) % IDS.length) * TILTS + pose].push(x + 0.03 * Math.sin(t * Math.PI * 2 + jitter * 6.28) * look.sway, y, 0, 0.02 + 0.95 * k ** 1.4);
      }
    const copyData = new Float32Array((MOST + 1) * 4);
    copyData.set([0, 0, 0, 0.12]);
    let at_ = 1;
    const firsts = buckets.map((b) => {
      copyData.set(b, at_ * 4);
      at_ += b.length / 4;
      return at_ - b.length / 4;
    });
    device.queue.writeBuffer(copyBuffer, 0, copyData);
    const middles = hung.map((h) => h.body.t);
    BODIES.forEach((b, i) => {
      const m = b.world ? cluster : hung[b.of].body;
      const c = b.world ? [0, 0, 0] : middles[b.of];
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      b.d = Math.hypot(...c.map((x, q) => x - eye[q]));
      const data = new Float32Array(32);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      const ids = new Uint32Array(data.buffer);
      ids.set([b.id, i, b.world ? 0 : firsts[i], 0], 16);
      b.seen = b.world || buckets[i].length > 0;
      ids.fill(99, 20, 32);
      device.queue.writeBuffer(b.buffer, 0, data);
      for (const name of b.world ? (["strand"] as const) : (["shell", "on", "free"] as const)) device.queue.writeBuffer(nets[name].heads[b.world ? 0 : i], 0, wideLamps(name, list, back));
    });
    // the cocoons as what stands in the light: each scaled to a ball
    const shade = new Float32Array((4 + 24 * 3 + 6 + 3) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.10 + 0.5 * look.wide, look.relief, look.bounce], 12);
    list.forEach((l, n) => shade.set([...l.colour, 0], (4 + 24 * 3 + 6 + n) * 4));
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    // as many hairs as come out about a pixel wide, and as many points as show
    for (const k of sets) {
      const b = BODIES[k.body];
      const each = (2 * head.kinds[k.kind === "thread" ? "floss" : k.kind].radius * look.fibre * pixels) / b.d;
      const part = k.kind === "wound" || k.kind === "fuzz" ? 1 : 1;
      const size = (2 * pixels) / b.d;
      const stride = k.kind === "thread" ? 1 : true ? 2 : k.kind === "floss" ? (size > 430 ? 1 : 3) : size > 430 ? 1 : 2;
      k.now.n = Math.ceil(k.n * part);
      k.now.stride = stride;
      k.now.points = Math.ceil((k.points - 1) / stride) + 1;
      k.data[1] = k.now.n;
      k.data[2] = k.now.points;
      k.data[6] = k.now.n * k.now.points;
      k.data[13] = stride;
      new Float32Array(k.data.buffer)[14] = k.kind === "thread" ? look.web : 3.0;
      device.queue.writeBuffer(k.buffer, 0, k.data);
    }
    glazes.forEach((g, i) => {
      // about as fine as the screen
      g.w = (2 * pixels) / Math.max(1, BODIES[i].d - 0.5) > 0 ? FINE : FINE;
      const d = new DataView(new ArrayBuffer(16));
      [g.w, g.w / 2, i].forEach((x, k) => d.setUint32(k * 4, x, true));
      d.setFloat32(12, Math.log2(1024 / g.w), true);
      device.queue.writeBuffer(g.buffer, 0, d.buffer);
    });
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    const pictured = true;
    if (look.shells && pictured) {
      cp.setPipeline(glazePipe);
      glazes.forEach((g, i) => {
        if (!BODIES[i].seen) return;
        cp.setBindGroup(0, bases[i]);
        cp.setBindGroup(1, g.group);
        cp.setBindGroup(2, g.head);
        cp.dispatchWorkgroups(Math.ceil((g.w + 1) / 8), Math.ceil(g.w / 16));
      });
    }
    cp.setPipeline(veilPipe);
    for (const k of pictured ? sets : []) {
      if (!look[k.name] || !BODIES[k.body].seen) continue;
      cp.setBindGroup(0, bases[k.body]);
      cp.setBindGroup(1, k.veil);
      cp.dispatchWorkgroups(Math.ceil((k.now.n * veilsOf(k.kind)) / 64));
    }
    for (const k of pictured ? sets : []) {
      if (!look[k.name] || !BODIES[k.body].seen) continue;
      cp.setPipeline(k.pipe);
      k.groups.forEach((g, i) => cp.setBindGroup(i, g));
      cp.dispatchWorkgroups(Math.ceil((k.now.n * k.now.points) / 64));
    }
    cp.end();

    if (pictured) {
      const pass = encoder.beginRenderPass({
        timestampWrites: stamp(1),
        colorAttachments: [
          { view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 1] },
          { view: targets.soft, resolveTarget: targets.blurs, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
        ],
        depthStencilAttachment: { view: targets.deep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
      });
      device.queue.writeBuffer(wallBuffer, 0, new Float32Array([look.wall, look.wall, look.wall * 1.005, look.fall, w, h, 0, 0]));
      pass.setPipeline(wallPipe);
      pass.setBindGroup(0, wallGroup);
      pass.draw(3);
      if (look.shells) {
        pass.setPipeline(shellPipe);
        pass.setIndexBuffer(indexBuffer, "uint32");
        // the near ones first, so that hidden pixels of the far ones are never shaded
        const order = BODIES.map((b, i) => i).filter((i) => !BODIES[i].world && BODIES[i].seen);
        order.sort((a, b) => BODIES[a].d - BODIES[b].d);
        for (const i of order) {
          pass.setBindGroup(0, bases[i]);
          pass.setBindGroup(1, shellGroups[i]);
          pass.drawIndexed(index.length, buckets[i].length / 4, 0, 0, 0);
        }
      }
      pass.setPipeline(fibrePipe);
      for (const k of sets) {
        if (!look[k.name] || !BODIES[k.body].seen) continue;
        // a ribbon for every eight pixels or so
        const split = Math.max(1, Math.min(1, Math.round((k.step * k.now.stride * pixels) / BODIES[k.body].d / 8)));
        device.queue.writeBuffer(k.splitBuffer, 0, new Uint32Array([split, airy(look.air * AIR[k.name]), 0, 0]));
        k.draw.forEach((g, i) => pass.setBindGroup(i, g));
        pass.draw(4, k.now.n * (k.now.points - 1) * split * (BODIES[k.body].world ? 1 : buckets[k.body].length / 4));
      }
      pass.end();
    }

    const quad = (view: GPUTextureView, pipe: GPURenderPipeline, g: GPUBindGroup, keep = false, time?: GPURenderPassTimestampWrites) => {
      const p = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: keep ? "load" : "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], timestampWrites: time });
      p.setPipeline(pipe);
      p.setBindGroup(0, g);
      p.draw(3);
      p.end();
    };
    const screen = context.getCurrentTexture().createView();
    if (pictured) {
      for (const l of targets.lens) quad(l.view, l.pipe, l.group, false, l.pipe === gatherPipe ? stamp(2) : undefined);
      targets.down.forEach((g, i) => quad(targets!.views[i + 1], downPipe, g));
      for (let i = GLOWS - 2; i >= 0; i--) quad(targets.views[i + 1], upPipe, targets.up[i], true);
      quad(screen, finalPipe, targets.final);
    }
    const { time } = state;
    const back = time && times ? device.createBuffer({ size: 48, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
    if (back && times) {
      encoder.resolveQuerySet(times.set, 0, 6, times.raw, 0);
      encoder.copyBufferToBuffer(times.raw, 0, back, 0, 48);
    }
    device.queue.submit([encoder.finish()]);
    back?.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigUint64Array(back.getMappedRange());
      const ms = (i: number) => Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
      time?.({ shade: ms(0), draw: ms(1), lens: ms(2) });
      back.destroy();
    });
    // once the card has really drawn a picture
    if (state.frame++ === 2) device.queue.onSubmittedWorkDone().then(() => document.querySelector("#loader")?.classList.add("done"));
  };

  Object.assign(window, { __cocoon: { look, lamps, state, home, camera, controls, device, DURATION } });

  wrap.resize = ({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    stats.dom.remove();
    device.destroy();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  animate: true,
  duration: DURATION * 1000,
  // no playFps: ssam's drops frames (see cap.ts), so the render caps itself at 60
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
