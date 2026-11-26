/**
 * Cocoons that are each on their own: learnt alone, in their own frame, from all sides, so any of them can be
 * anywhere and turned any way. What one does to another's light is worked out here (soft shadows of ellipsoids).
 * Five hang on threads of their own; everything moves by sines that fit the loop.
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
import lensCode from "../lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "./shade-on.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shellCode from "./shell.wgsl?raw";
import cordCode from "./cord.wgsl?raw";
import glazeCode from "./glaze.wgsl?raw";
import { HANGING, NECK, TEARING, TOP, TWISTING, cordPoints, poseOf, standing, twoThreads, type Pose } from "./hang";
import { matOf, type Tear } from "./tear";
import weaveCode from "./weave.wgsl?raw";
import veilCode from "./veil.wgsl?raw";
import shadeStrand from "./shade-strand.wgsl?raw";

const DURATION = 16;
/** tear.html: how long after the start what is left of the web is drawn up, and a new one let down */
const TORN_FOR = 11.2;
const OVER = 3.0;
const WIDE = 1.45;
const UP = [9.2, 11.2] as const;
const LIFT = 6.4;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const SAMPLES = 4;
const GLOWS = 6;
const AIR = { wound: 0, fuzz: 0.22, floss: 1, thread: 0.7, web: 0 };
const bits = new DataView(new ArrayBuffer(4));
const airy = (x: number) => (bits.setFloat32(0, x), bits.getUint32(0));

const look = {
  exposure: 1.2,
  gamma: 1,
  bloom: 0.03,
  spread: 0.95,
  fibre: 1,
  /** contrast among neighbouring strands, put back */
  crisp: 0.9,
  /** how wide the lens opens (half a cocoon is 1), and how far before the middle of the view it is focused */
  lens: 0.07,
  focus: 0.75,
  /** how far the air moves loose silk, in units of half a cocoon */
  air: 0.014,
    /** how dark one cocoon's shadow on another is (the light also comes through it) */
  shadow: 0.8,
  /** how much the hanging cocoons sway, rock and turn */
  sway: 1,
  shells: true,
  wound: true,
  fuzz: true,
  floss: true,
  thread: true,
};

/** azimuth from the camera's side (0 in front, 180 behind), elevation, power (1 makes a facing wall white) */
const lamps = {
  key: { azimuth: -80, elevation: 42, power: 0.42, colour: "#fff5e8" },
  back: { azimuth: 152, elevation: 4, power: 0.9, colour: "#ffdcb2" },
  rim: { azimuth: -150, elevation: 12, power: 0.55, colour: "#ffe8ce" },
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
  // how the first one is torn out of its web, all of it
  const tear = TEARING
    ? await new Promise<Tear>((done) => {
        const worker = new Worker(new URL("./tear.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }) => {
          worker.terminate();
          done(data);
        };
        const { A, B, p } = head.cocoons[HANGING[0].id];
        worker.postMessage({ shape: { A, B, p }, options: { seconds: TORN_FOR, over: OVER, wide: WIDE, standing: standing(HANGING[0]), seed: 8, tire: 1.5, lopsided: 0.6, kin: 0.3 } });
      })
    : undefined;

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
  const N = HANGING.length;
  const BODIES = [...HANGING.map((h) => h.id), ...HANGING.map(() => 0)].map((id, b) => ({ id, world: b >= N, of: b % N, buffer: buffer(96, UNIFORM), seen: true, d: 0 }));

  // the still strands' points, and after them the threads', as they hang and as they are
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const cords = HANGING.map((h, i) => (tear && i === 0 ? twoThreads(WIDE, OVER, F.radius * 1.15) : cordPoints(h, head.cocoons[h.id], F.radius * 1.15)));
  const each = cords[0].data.length / 4;
  // the web: its strands' two halves, three of each
  const WEB = 110;
  const COPIES = 3;
  const webFirst = still + each * N * 2;
  const webN = tear ? tear.halves * COPIES : 0;
  const pointData = new Float32Array((webFirst + webN * WEB) * 4);
  pointData.set(cocoon.points);
  cords.forEach((c, i) => pointData.set(c.data, (still + each * i) * 4));
  const points = buffer(pointData, STORAGE);
  const codes = buffer(padded(cocoon.codes), STORAGE);
  // the relief is made here, not downloaded
  const { relief, view: detail } = makeRelief(device, head);

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
      return [name, { ...code, heads: BODIES.map(() => buffer(code.head * 16, UNIFORM)) }];
    }),
  ) as Record<(typeof netNames)[number], ReturnType<typeof netCode> & { heads: GPUBuffer[] }>;

  // ---------------------------------------------------------------- pipelines

  const module = (code: string) => device.createShaderModule({ code: code.includes("mat4x4h") ? "enable f16;\n" + code : code });
  const group = (pipeline: GPURenderPipeline | GPUComputePipeline, index: number, resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries: resources.map((resource, binding) => ({ binding, resource })) });
  const of = (b: GPUBuffer) => ({ buffer: b });

  const HDR = "rgba16float" as const;
  const SOFT = "rg16float" as const;
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
    base: layout(COMPUTE | VERTEX | FRAGMENT, ["uniform", "uniform", "uniform", "uniform"]),
    on: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "texture", "texture", "sampler", "texture"]),
    free: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage"]),
    veil: layout(COMPUTE, ["uniform", "read-only-storage", "storage"]),
    head: layout(COMPUTE | FRAGMENT, ["uniform"]),
    fibre: layout(VERTEX, ["uniform", "read-only-storage", "read-only-storage", "uniform"]),
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "uniform", "texture", "sampler", "uniform"]),
    cord: layout(COMPUTE, ["uniform", "storage"]),
    weave: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage"]),
    glaze: layout(COMPUTE, ["texture", "texture", "sampler", "texture", "store", "uniform"]),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), common + nets.on.code + shadeCode.replace("SHADE", shadeOn)),
    free: await compute(pipeLayout(L.base, L.free, L.head), common + nets.free.code + shadeCode.replace("SHADE", shadeFree.replace("run_free(&x)", "shaded(run_free(&x), veilAt(i, t))")).replace(/@group\(1\) @binding\([6789]\).*\n/g, "")),
    strand: await compute(pipeLayout(L.base, L.free, L.head), common + nets.strand.code + shadeCode.replace("SHADE", shadeStrand).replace(/@group\(1\) @binding\([6789]\).*\n/g, "")),
  };
  const veilPipe = await compute(pipeLayout(L.base, L.veil), common + veilCode);
  const cordPipe = await compute(pipeLayout(L.cord), cordCode);
  const weavePipe = await compute(pipeLayout(L.weave), weaveCode);
  const glazePipe = await compute(pipeLayout(L.base, L.glaze, L.head), common + nets.shell.code + glazeCode);
  const shellModule = module(common + shellCode);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell),
    vertex: { module: shellModule },
    fragment: { module: shellModule, targets: [{ format: HDR }, { format: SOFT }] },
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
  const shadowBuffer = buffer((4 + 8 * 3) * 16, UNIFORM);
  const bases = BODIES.map((b) => bind(L.base, [of(frameBuffer), of(shapeBuffer), of(b.buffer), of(shadowBuffer)]));

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
      if (!b.world) plans.push({ name, kind: name, body, first: cocoon.first[name] + b.id * per * k.points, n: per, points: k.points, map: owned(count(per, b.id * per)) });
    });
  }
  const coat = F.n / head.cocoons.length;
  BODIES.forEach((b, body) => {
    if (!b.world) plans.push({ name: "floss", kind: "floss", body, first: cocoon.first.floss + b.id * coat * F.points, n: coat, points: F.points, map: owned(count(coat, b.id * coat)) });
    else {
      if (tear && b.of === 0) plans.push({ name: "thread", kind: "thread", body, first: webFirst, n: webN, points: WEB, map: owned(Array(webN).fill(0)) });
      plans.push({ name: "thread", kind: "thread", body, first: still + each * (N + b.of), n: cords[b.of].n, points: cords[b.of].points, map: owned(Array(cords[b.of].n).fill(0)) });
    }
  });
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE);
  // at how many places along each the shadows are worked out
  const veilsOf = (k: KindName) => (head.kinds[k].on ? 3 : 12);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p.kind)) - p.n * veilsOf(p.kind));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, p.n * p.points, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p.kind)]), UNIFORM);
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    const web = p.first === webFirst;
    let step = web ? 0.03 : 0;
    for (let i = 0; i < (web ? 0 : 200); i++) {
      const from = p.kind === "thread" ? still + each * BODIES[p.body].of : p.first;
      const o = (from + Math.floor((i / 200) * Math.min(p.n, 60)) * p.points + 3) * 4;
      step += Math.hypot(...[0, 1, 2].map((c) => pointData[o + c] - pointData[o + 4 + c])) / 200;
    }
    const shared = [of(b), of(points), of(codes), of(lit), of(ownerBuffer), of(veils)];
    return {
      ...p,
      pipe: shadePipes[p.kind === "thread" ? "strand" : k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail]) : bind(L.free, shared), bind(L.head, [of(nets[p.kind === "thread" ? "strand" : k.on ? "on" : "free"].heads[p.body])])],
      veil: bind(L.veil, [of(b), of(points), of(veils)]),
      veilDispatch: Math.ceil((p.n * veilsOf(p.kind)) / 64),
      dispatch: Math.ceil((p.n * p.points) / 64),
      draw: [bases[p.body], bind(L.fibre, [of(b), of(points), of(lit), of(splitBuffer)])],
      stretches: p.n * (p.points - 1),
      step,
      splitBuffer,
    };
  });

  const cordJobs = cords.map((_, i) => {
    const b = buffer(128, UNIFORM);
    return { buffer: b, first: still + each * i, out: still + each * (N + i), group: bind(L.cord, [of(b), of(points)]), dispatch: Math.ceil(each / 64) };
  });

  const weave = tear && { buffer: buffer(80, UNIFORM), dispatch: Math.ceil((webN * WEB) / 64) };
  const weaveGroup = weave && tear && bind(L.weave, [of(weave.buffer), of(buffer(tear.places, STORAGE)), of(buffer(tear.length, STORAGE)), of(points)]);

  // the shells' light, on a grid over each: so fine, and this much of it
  const FINE = 1024;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeStore = glazeTexture.createView({ dimension: "2d-array" });
  const glazes = HANGING.map((_, i) => {
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
  const index = new Uint32Array(((GU * GV) / 4) * 6);
  for (let v = 0, o = 0; v < GV; v += 2)
    for (let u = 0; u < GU; u += 2) {
      const [a, b, c, d] = [v * GU + u, v * GU + ((u + 2) % GU), (v + 2) * GU + u, (v + 2) * GU + ((u + 2) % GU)];
      index.set([a, c, b, b, c, d], o);
      o += 6;
    }
  const indexBuffer = buffer(index, INDEX);
  const gridBuffer = buffer(new Uint8Array(gridData.buffer), UNIFORM);
  const shellGroups = glazes.map((g) => bind(L.shell, [of(relief), of(gridBuffer), glazeTexture.createView({ dimension: "2d-array" }), plain, of(g.buffer)]));

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

  const camera = new PerspectiveCamera(head.fov, width / height, 0.3, 60);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 2.2;
  controls.maxDistance = 20;
  // what the networks were shown
  controls.minPolarAngle = Math.PI / 2 - (36 * Math.PI) / 180;
  controls.maxPolarAngle = Math.PI / 2 + (28 * Math.PI) / 180;
  const home = (az = 0, el = 2, dist = 15.5, target: [number, number, number] = [0, 0.1, 0]) => {
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
  picture.add(look, "exposure", 0.1, 4);
  picture.add(look, "gamma", 0.6, 1.6);
  picture.add(look, "bloom", 0, 0.4);
  picture.add(look, "fibre", 0.3, 3).name("fibre width");
  picture.add(look, "crisp", 0, 3);
  picture.add(look, "lens", 0, 0.6);
  picture.add(look, "focus", -1.5, 2);
  picture.add(look, "air", 0, 0.06);
  picture.add(look, "shadow", 0, 1);
  picture.add(look, "sway", 0, 2);
  for (const [name, l] of Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`);
    f.add(l, "azimuth", -180, 180);
    f.add(l, "elevation", -36, 80);
    f.add(l, "power", 0, 6);
    f.addColor(l, "colour");
  }
  const parts = gui.addFolder("parts").close();
  for (const k of ["shells", ...KINDS] as const) parts.add(look, k);

  // ---------------------------------------------------------------- a frame

  // how long the passes take the card (tools/perf.mjs asks)
  const times = timed ? { set: device.createQuerySet({ type: "timestamp", count: 6 }), raw: device.createBuffer({ size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) } : undefined;
  const stamp = (i: number) => (times && state.time ? { querySet: times.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } : undefined);
  const state = { hold: undefined as number | undefined, frame: 0, ms: 0, exact: undefined as { which: number; lights: Lamp[] } | undefined, time: undefined as ((ms: Record<string, number>) => void) | undefined };
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
    const pixels = h / 2 / Math.tan((head.fov * Math.PI) / 360);
    const nearest = Math.max(1, camera.position.distanceTo(controls.target) - 0.8);
    frameData.set(viewProj.elements, 0);
    frameData.set([...camera.position.toArray(), 1], 16);
    frameData.set([w, h, pixels, 0], 20);
    frameData.set([0, 0, 0, look.fibre], 24);
    const widest = h * 0.022;
    const far = camera.position.distanceTo(controls.target);
    const focus = Math.max(0.5, far - look.focus);
    // opened less the closer it is, or there would be nothing but blur
    frameData.set([t * Math.PI * 2, look.lens * (far / 15.6) ** 0.75, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);

    // ---- where everything is
    const eye = camera.position.toArray() as [number, number, number];
    const list = state.exact?.lights ?? Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"] };
    });
    const hung = HANGING.map((h) => poseOf(h, t, look.sway));
    // (for tools/truth.mjs: one of them alone, as it was learnt)
    if (state.exact) hung.forEach((h, i) => (h.body = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, i === HANGING.findIndex((q) => q.id === state.exact!.which) ? 0 : 1e3, 0] }));
    if (tear && !state.exact) {
      // the torn one, and its web, drawn up and let down again
      const s = (((t % 1) + 1) % 1) * DURATION;
      const fresh = s >= TORN_FOR;
      const lift = fresh ? LIFT * (1 - smooth(TORN_FOR, DURATION, s)) : LIFT * smooth(UP[0], UP[1], s);
      const g = fresh ? 0 : Math.min(s * tear.fps, tear.frames - 1.001);
      const f = Math.floor(g);
      const mix = (k: number) => tear.body[f * 7 + k] * (1 - (g - f)) + tear.body[f * 7 + 7 + k] * (g - f);
      const turned = [3, 4, 5, 6].map((k) => tear.body[f * 7 + k]);
      const next = [3, 4, 5, 6].map((k) => tear.body[f * 7 + 7 + k]);
      const sign = turned.reduce((a, x, k) => a + x * next[k], 0) < 0 ? -1 : 1;
      let Q = turned.map((x, k) => x * (1 - (g - f)) + sign * next[k] * (g - f));
      const l = Math.hypot(...Q);
      Q = Q.map((x) => x / l);
      const at = HANGING[0].at;
      hung[0].body = { R: matOf(Q), t: [mix(0) + at[0], mix(1) + at[1] + (fresh ? lift : 0), mix(2) + at[2]] };
      const d = new ArrayBuffer(80);
      new Uint32Array(d).set([tear.halves, COPIES, tear.frames, tear.nodes, WEB, webFirst, 0, 0]);
      new Float32Array(d).set([g, 0, 0, 0, tear.step, 1.25, F.radius, 0.22, at[0], at[1] + lift, at[2], 0], 8);
      device.queue.writeBuffer(weave!.buffer, 0, d);
      hung[0].spin = 0;
      hung[0].rock = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
      hung[0].sway = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [at[0], at[1] + lift, at[2]] };
    }
    const middles = hung.map((h) => h.body.t);
    const nowhere: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
    BODIES.forEach((b, i) => {
      const m = b.world ? nowhere : hung[b.of].body;
      const c = middles[b.of];
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      // in the picture, or nearly
      const q = [c[0], c[1] + (b.world ? 1.5 : 0), c[2]];
      const e = viewProj.elements;
      const at = (r: number) => e[r] * q[0] + e[4 + r] * q[1] + e[8 + r] * q[2] + e[12 + r];
      const room = (1.5 * pixels * 2) / h + (b.world ? 2 : 0);
      b.seen = Math.abs(at(0)) < Math.max(at(3), 0) + room * Math.max(1, h / w) && (b.world || Math.abs(at(1)) < Math.max(at(3), 0) + room);
      b.d = Math.hypot(...c.map((x, q) => x - eye[q]));
      // who may stand in its light: those that the way to some lamp passes near
      const from = b.world ? [c[0], c[1] + 1.8, c[2]] : c;
      const size = b.world ? 2.2 : 1.15;
      const who = middles
        .map((o, j) => ({ j, v: o.map((x, k) => x - from[k]) }))
        .filter(({ j }) => b.world || j !== b.of)
        .map(({ j, v }) => {
          let gap = Infinity;
          for (const l of list) {
            const along = v[0] * l.dir[0] + v[1] * l.dir[1] + v[2] * l.dir[2];
            if (along < -size) continue;
            const off = Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along * along));
            gap = Math.min(gap, off - size - 1.1 - 0.12 * Math.max(along, 0));
          }
          return { j, gap };
        })
        .filter(({ gap }) => gap < 0)
        .sort((p, q) => p.gap - q.gap)
        .slice(0, 4);
      const data = new Float32Array(24);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      const ids = new Uint32Array(data.buffer);
      ids.set([b.id, i, 0, 0], 16);
      ids.set([99, 99, 99, 99], 20);
      who.forEach(({ j }, k) => (ids[20 + k] = j));
      device.queue.writeBuffer(b.buffer, 0, data);
      if (!b.seen) return;
      const turned = list.map((l) => ({ dir: back(l.dir), colour: l.colour }));
      for (const name of netNames)
        if (b.world === (name === "strand")) device.queue.writeBuffer(nets[name].heads[i], 0, foldLamps(head, name, turned));
    });
    // the cocoons as what stands in the light: each scaled to a ball
    const shade = new Float32Array((4 + 24) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.10, 0, 0], 12);
    hung.forEach(({ body: m }, i) => {
      const c = head.cocoons[HANGING[i].id];
      [c.A, c.B, c.B].forEach((size, r) => {
        const w = [0, 1, 2].map((k) => m.R[k * 3 + r] / (size * 0.97));
        shade.set([...w, -(w[0] * m.t[0] + w[1] * m.t[1] + w[2] * m.t[2])], 16 + i * 12 + r * 4);
      });
    });
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    cordJobs.forEach((k, i) => {
      const d = new Float32Array(32);
      new Uint32Array(d.buffer).set([k.first, each, k.out, 0]);
      d.set([hung[i].spin, NECK, TOP, TWISTING ? 1 : 0], 4);
      const rows = (m: Pose, at: number) => [0, 1, 2].forEach((r) => d.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], at + r * 4));
      rows(hung[i].sway, 8);
      rows(hung[i].rock, 20);
      device.queue.writeBuffer(k.buffer, 0, d);
    });
    glazes.forEach((g, i) => {
      // about as fine as the screen
      g.w = (2 * pixels) / Math.max(1, BODIES[i].d - 0.5) > 1300 ? FINE : FINE / 2;
      const d = new DataView(new ArrayBuffer(16));
      [g.w, g.w / 2, i].forEach((x, k) => d.setUint32(k * 4, x, true));
      d.setFloat32(12, g.w === FINE ? 0 : 1, true);
      device.queue.writeBuffer(g.buffer, 0, d.buffer);
    });
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(cordPipe);
    for (const k of cordJobs) {
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    }
    if (weave && weaveGroup) {
      cp.setPipeline(weavePipe);
      cp.setBindGroup(0, weaveGroup);
      cp.dispatchWorkgroups(weave.dispatch);
    }
    if (look.shells) {
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
    for (const k of sets) {
      if (!look[k.name] || !BODIES[k.body].seen) continue;
      cp.setBindGroup(0, bases[k.body]);
      cp.setBindGroup(1, k.veil);
      cp.dispatchWorkgroups(k.veilDispatch);
    }
    for (const k of sets) {
      if (!look[k.name] || !BODIES[k.body].seen) continue;
      cp.setPipeline(k.pipe);
      k.groups.forEach((g, i) => cp.setBindGroup(i, g));
      cp.dispatchWorkgroups(Math.min(k.dispatch, 65535), Math.ceil(k.dispatch / 65535));
    }
    cp.end();

    const pass = encoder.beginRenderPass({
      timestampWrites: stamp(1),
      colorAttachments: [
        { view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 1] },
        { view: targets.soft, resolveTarget: targets.blurs, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: { view: targets.deep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
    });
    if (look.shells) {
      pass.setPipeline(shellPipe);
      pass.setIndexBuffer(indexBuffer, "uint32");
      // the near ones first, so that hidden pixels of the far ones are never shaded
      const order = BODIES.map((b, i) => i).filter((i) => !BODIES[i].world && BODIES[i].seen);
      order.sort((a, b) => BODIES[a].d - BODIES[b].d);
      for (const i of order) {
        pass.setBindGroup(0, bases[i]);
        pass.setBindGroup(1, shellGroups[i]);
        pass.drawIndexed(index.length, 1, 0, 0, BODIES[i].id);
      }
    }
    pass.setPipeline(fibrePipe);
    for (const k of sets) {
      if (!look[k.name] || !BODIES[k.body].seen) continue;
      // a ribbon for every eight pixels or so
      const split = Math.max(1, Math.min(6, Math.round((k.step * pixels) / nearest / 8)));
      device.queue.writeBuffer(k.splitBuffer, 0, new Uint32Array([split, airy(look.air * AIR[k.name]), 0, 0]));
      k.draw.forEach((g, i) => pass.setBindGroup(i, g));
      pass.draw(4, k.stretches * split);
    }
    pass.end();

    const quad = (view: GPUTextureView, pipe: GPURenderPipeline, g: GPUBindGroup, keep = false, time?: GPURenderPassTimestampWrites) => {
      const p = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: keep ? "load" : "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], timestampWrites: time });
      p.setPipeline(pipe);
      p.setBindGroup(0, g);
      p.draw(3);
      p.end();
    };
    for (const l of targets.lens) quad(l.view, l.pipe, l.group, false, l.pipe === gatherPipe ? stamp(2) : undefined);
    targets.down.forEach((g, i) => quad(targets!.views[i + 1], downPipe, g));
    for (let i = GLOWS - 2; i >= 0; i--) quad(targets.views[i + 1], upPipe, targets.up[i], true);
    quad(context.getCurrentTexture().createView(), finalPipe, targets.final);
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
