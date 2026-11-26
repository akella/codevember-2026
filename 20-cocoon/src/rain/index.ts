/**
 * Some twenty cocoons coming slowly down on their threads, at many depths. At some point the web of each starts to
 * tear, rope by rope; it leans, hangs by what is left, and falls; the rest of its web is drawn back up (fall.ts).
 * Lit by the networks of cocoons that were learnt alone (../alone), each drawn with as many hairs as it has pixels for.
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
import { CORNER, FIELD_H, FIELD_W, GX, GY, GZ, depth as deep } from "./depth";
import fieldCode from "./field.wgsl?raw";
import splatCode from "./splat.wgsl?raw";
import { EMBERS, brightness, inside, lantern } from "./lantern";
import { foldGlow, foldLamps, netCode, type Lamp } from "../net";
import lensCode from "./lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "./shade-on.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shellCode from "./shell.wgsl?raw";
import cordCode from "./cord.wgsl?raw";
import glazeCode from "./glaze.wgsl?raw";
import type { Tear } from "../alone/tear";
import { COLUMNS, FAR, LIFE, OVER, TEARS, cordPoints, layOut, where, type Pose } from "./fall";
import plainCode from "./plain.wgsl?raw";
import wireCode from "./wire.wgsl?raw";
import weaveCode from "./weave.wgsl?raw";
import veilCode from "./veil.wgsl?raw";
import shadeStrand from "./shade-strand.wgsl?raw";

const DURATION = LIFE;
/** lantern.html: the same, with light inside the cocoons */
const LANTERN = document.documentElement.dataset.page === "lantern";
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
  lens: 0.11,
  focus: 0,
  /** how far before and behind the focus everything is quite sharp */
  sharp: 1.6,
  /** how far the air moves loose silk, in units of half a cocoon */
  air: 0.014,
    /** how dark one cocoon's shadow on another is (the light also comes through it) */
  shadow: 0.8,
  /** how much the lines sway; how much the torn silk crinkles; how wide a hair is drawn, in pixels */
  sway: 1,
  /** cocoons that hardly turn are lit every other frame */
  thrifty: true,
  /** how much dimmer for every unit farther */
  dim: 0.12,
  frizz: 1.1,
  /** how thick the web's strands are: thinner ones are fainter, and don't add up to white */
  web: 0.55,
  hair: 0.8,
  /** debug: what lights it (the networks, a shader written by hand, nothing), and the lines it is made of */
  light: "neural" as "neural" | "classic" | "unlit",
  wire: "off" as "off" | "over" | "alone",
  /** debug: every how many-th line of the shells' mesh is drawn */
  mesh: 4,
  /** lantern.html: the light inside, and what it throws on the others */
  inside: 1.75,
  others: 2.2,
  /** as a candle is (1) or steady (0) */
  flicker: 1,
  /** the pupa: how large, and how far it shows through the silk right before it; the light inside that has no direction */
  pupa: 0.9,
  through: 0.5,
  ambient: 0.12,
  /** light off the strands' skin; how much the webs shade themselves */
  glint: 0.25,
  strands: 3,
  shells: true,
  wound: true,
  fuzz: true,
  floss: true,
  thread: true,
};

/** azimuth from the camera's side (0 in front, 180 behind), elevation, power (1 makes a facing wall white) */
const lamps = {
  key: { azimuth: -85, elevation: 42, power: 0.5, colour: "#e2eaff" },
  back: { azimuth: 152, elevation: 4, power: 1.0, colour: "#ffd2a0" },
  rim: { azimuth: -150, elevation: 12, power: 0.5, colour: "#ffdcb4" },
};

if (LANTERN) {
  // warm inside, cool outside: the silk before the glow is of another colour than it
  Object.assign(look, { exposure: 1.3, bloom: 0.05, crisp: 1.0, glint: 0.45 });
  Object.assign(lamps.key, { azimuth: -95, elevation: 35, power: 0.07, colour: "#9fb8ff" });
  Object.assign(lamps.back, { azimuth: 160, elevation: 25, power: 0.6, colour: "#8fa8ff" });
  Object.assign(lamps.rim, { azimuth: -140, elevation: 10, power: 0.42, colour: "#a8c0ff" });
}
const INSIDE = [1, 0.66, 0.34];

const linear = (hex: string) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2) as [number, number, number];

const pick = <T,>(withLight: T, without: T) => (LANTERN ? withLight : without);
const [commonCode, shadeText, onText, strandText, freeText, glazeText, veilText] = [
  pick(lantern.common(deep.common(common)), deep.common(common)),
  pick(lantern.shade(shadeCode), shadeCode),
  pick(lantern.on(deep.on(shadeOn)), deep.on(shadeOn)),
  pick(lantern.strand(deep.strand(shadeStrand)), deep.strand(shadeStrand)),
  pick(lantern.free(deep.free(shadeFree)), deep.free(shadeFree)),
  pick(lantern.glaze(deep.glaze(glazeCode)), deep.glaze(glazeCode)),
  pick(lantern.veil(deep.veil(veilCode)), deep.veil(veilCode)),
];

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
  // how the web of each of the four tears
  const tears = await Promise.all(
    TEARS.map(
      (options, id) =>
        new Promise<Tear>((done) => {
          const worker = new Worker(new URL("../alone/tear.worker.ts", import.meta.url), { type: "module" });
          worker.onmessage = ({ data }) => {
            worker.terminate();
            done(data);
          };
          const { A, B, p } = head.cocoons[id];
          worker.postMessage({ shape: { A, B, p }, options });
        }),
    ),
  );
  let columns = layOut(width / height, tears);

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
  const N = COLUMNS;
  const BODIES = [...columns.map((c) => c.id), ...columns.map(() => 0)].map((id, b) => ({ id, world: b >= N, of: b % N, buffer: buffer(224, UNIFORM), seen: true, d: 0, fresh: true, was: false, turn: 0, R: [] as number[] }));

  // the still strands' points, and after them the threads', as they hang and as they are
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const cord = cordPoints(F.radius);
  const each = cord.data.length / 4;
  // the webs: their strands' two halves, twice
  const WEB = 34;
  const COPIES = 2;
  const webN = tears[0].halves * COPIES;
  const cordFirst = still + each;
  const webFirst = cordFirst + each * N;
  const pointData = new Float32Array((webFirst + webN * WEB * N) * 4);
  pointData.set(cocoon.points);
  pointData.set(cord.data, still * 4);
  const points = buffer(pointData, STORAGE);
  const codes = buffer(padded(cocoon.codes), STORAGE);
  // the relief is made here, not downloaded
  const { relief, view: detail } = makeRelief(device, head);

  /** layers of four numbers, with smaller copies for when it is far */
  const texture = (name: "coarse" | "fine", mips: boolean) => {
    const { u, v } = head[name];
    // (and, after those, of light inside)
    const layers = head[name].layers + (LANTERN && name === "coarse" ? 8 : 0);
    const levels = mips ? 5 : 1;
    const t = device.createTexture({ size: [u, v, layers], format: "rgba8unorm", mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const all = name === "coarse" ? (LANTERN ? Uint8Array.from([...cocoon.section("coarse"), ...cocoon.section("glow")]) : cocoon.section(name)) : cocoon[name];
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
      return [name, { ...code, heads: name === "strand" ? [buffer(code.head * 16, UNIFORM)] : columns.map(() => buffer(code.head * 16, UNIFORM)) }];
    }),
  ) as Record<(typeof netNames)[number], ReturnType<typeof netCode> & { heads: GPUBuffer[] }>;

  const glows = (["glowShell", "glowOn"] as const).map((name) => {
    if (!LANTERN) return undefined;
    const code = netCode(name, head.nets[name], 2, 1, device.features.has("shader-f16"));
    return { name, ...code, heads: columns.map(() => buffer(code.head * 16, UNIFORM)) };
  });
  const [glowShell, glowOn] = glows;

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
    base: layout(COMPUTE | VERTEX | FRAGMENT, ["uniform", "uniform", "uniform", "uniform"]),
    on: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "texture", "texture", "sampler", "texture", "texture", ...(LANTERN ? (["read-only-storage"] as const) : [])]),
    free: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage"]),
    veil: layout(COMPUTE, ["uniform", "read-only-storage", "storage", "read-only-storage"]),
    splat: layout(COMPUTE, ["uniform", "read-only-storage", "storage"]),
    field: layout(COMPUTE, ["read-only-storage", "store", "uniform"]),
    head: layout(COMPUTE | FRAGMENT, LANTERN ? ["uniform", "uniform"] : ["uniform"]),
    fibre: layout(VERTEX, ["uniform", "read-only-storage", "read-only-storage", "uniform"]),
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "uniform", "texture", "sampler", "uniform"]),
    wire: layout(VERTEX, ["uniform", "read-only-storage", "uniform", "read-only-storage"]),
    cord: layout(COMPUTE, ["uniform", "storage"]),
    weave: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage"]),
    glaze: layout(COMPUTE, ["texture", "texture", "sampler", "texture", "store", "uniform", "texture"]),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const noTextures = (code: string) => code.replace(/@group\(1\) @binding\((?:[6789]|10|11)\).*\n/g, "");
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), commonCode + nets.on.code + deep.shade(LANTERN ? lantern.withEmbers(shadeText) : shadeText).replace("SHADE", onText)),
    free: await compute(pipeLayout(L.base, L.free, L.head), commonCode + nets.free.code + noTextures(shadeText.replace("SHADE", freeText))),
    strand: await compute(pipeLayout(L.base, L.free, L.head), commonCode + nets.strand.code + noTextures(shadeText.replace("SHADE", strandText))),
  };
  const emberPipe = glowOn && (await compute(pipeLayout(L.base, L.on, L.head), commonCode + glowOn.code + lantern.ember(shadeText, shadeOn)));
  // the same without the networks (modules of their own, so that the neural ones are what they were)
  const unbound = (code: string) => code.replace(/@group\(1\) @binding\((?:[6789]|10|11)\).*\n/g, "");
  const plainPipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), common + plainCode + shadeCode.replace("SHADE", shadeOn.replace("shaded(run_on(&x), veilAt(i, t))", "plainFibre(tangent, view, normal, 1.0, veilAt(i, t))"))),
    free: await compute(pipeLayout(L.base, L.free, L.head), common + plainCode + unbound(shadeCode.replace("SHADE", shadeFree.replace("run_free(&x)", "plainFibre(tangent, view, normalize(p), 1.0, veilAt(i, t))")))),
    strand: await compute(pipeLayout(L.base, L.free, L.head), common + plainCode + unbound(shadeCode.replace("SHADE", shadeStrand.replace("shaded(run_strand(&x), veilAt(i, t))", "plainFibre(tangent, view, view, 0.0, veilAt(i, t))")))),
  };
  const plainGlaze = await compute(pipeLayout(L.base, L.glaze, L.head), common + plainCode + glazeCode.replace("shaded(run_shell(&x), shade)", "plainShell(normal, shade)"));
  const veilPipe = await compute(pipeLayout(L.base, L.veil), commonCode + veilText);
  const cordPipe = await compute(pipeLayout(L.cord), cordCode);
  const splatPipe = await compute(pipeLayout(L.splat), deep.splat(splatCode));
  const fieldPipe = await compute(pipeLayout(L.base, L.field), commonCode + deep.field(fieldCode));
  const weavePipe = await compute(pipeLayout(L.weave), weaveCode);
  const glazePipe = await compute(pipeLayout(L.base, L.glaze, L.head), commonCode + nets.shell.code + (glowShell?.code ?? "") + glazeText);
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
  const shadowBuffer = buffer((4 + 24 * 3 + 6 + 3 + 7) * 16, UNIFORM);
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
  const zeros = owned(Array(Math.max(webN, cord.n)).fill(0));
  BODIES.forEach((b, body) => {
    if (!b.world) plans.push({ name: "floss", kind: "floss", body, first: cocoon.first.floss + b.id * coat * F.points, n: coat, points: F.points, map: owned(count(coat, b.id * coat)) });
    else {
      plans.push({ name: "thread", kind: "thread", body, first: webFirst + b.of * webN * WEB, n: webN, points: WEB, map: zeros });
      plans.push({ name: "thread", kind: "thread", body, first: cordFirst + b.of * each, n: cord.n, points: cord.points, map: zeros });
    }
  });
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE);
  // at how many places along each the shadows are worked out
  const veilsOf = (k: KindName) => (head.kinds[k].on ? 3 : 6);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p.kind)) - p.n * veilsOf(p.kind));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);
  const gridBufferOf = buffer(GX * GY * GZ * N * 4, STORAGE);
  const fieldTexture = device.createTexture({ size: [FIELD_W, FIELD_H, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const fieldView = fieldTexture.createView({ dimension: "2d-array" });
  let emberRoom = 0;
  const emberFirst = plans.map((p) => (head.kinds[p.kind].on ? (emberRoom += p.n * EMBERS) - p.n * EMBERS : 0));
  const embers = buffer(LANTERN ? emberRoom * 8 : 16, STORAGE);
  const none = buffer(16, STORAGE);

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(64, UNIFORM);
    const data = new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, 0, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p.kind), p.points, 1, 0, emberFirst[q]]);
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    let step = 0.04;
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
      plain: plainPipes[p.kind === "thread" ? "strand" : k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail, fieldView, ...(LANTERN ? [of(embers)] : [])]) : bind(L.free, shared), bind(L.head, [of(p.kind === "thread" ? nets.strand.heads[0] : nets[k.on ? "on" : "free"].heads[p.body]), ...(glowOn ? [of(glowOn.heads[BODIES[p.body].of])] : [])])],
      veil: bind(L.veil, [of(b), of(points), of(veils), of(gridBufferOf)]),
      ember: LANTERN && k.on ? bind(L.on, [of(b), of(points), of(codes), of(embers), of(ownerBuffer), of(veils), coarse, fine, around, detail, fieldView, of(none)]) : undefined,
      data,
      buffer: b,
      // of the fibres so many, of their points so many: as it has pixels for
      now: { n: p.n, points: p.points, stride: 1 },
      draw: [bases[p.body], bind(L.fibre, [of(b), of(points), of(lit), of(splitBuffer)])],
      step,
      splitBuffer,
    };
  });

  const cordJobs = columns.map((_, i) => {
    const b = buffer(128, UNIFORM);
    return { buffer: b, out: cordFirst + each * i, group: bind(L.cord, [of(b), of(points)]), dispatch: Math.ceil(each / 64) };
  });
  const motions = tears.map((t) => ({ places: buffer(t.places, STORAGE), length: buffer(t.length, STORAGE) }));
  const weaves = columns.map((c) => {
    const b = buffer(160, UNIFORM);
    return { buffer: b, group: bind(L.weave, [of(b), of(motions[c.id].places), of(motions[c.id].length), of(points)]), dispatch: Math.ceil((webN * WEB) / 64) };
  });

  // the webs' silk, cell by cell; and what falls on each cocoon
  const splats = columns.map(() => {
    const b = buffer(32, UNIFORM);
    return { buffer: b, group: bind(L.splat, [of(b), of(points), of(gridBufferOf)]), dispatch: Math.ceil((webN * WEB) / 64) };
  });
  const fields = columns.map((_, i) => bind(L.field, [of(gridBufferOf), fieldView, of(buffer(new Uint32Array([FIELD_W, FIELD_H, i, LANTERN ? 1 : 0]), UNIFORM))]));

  // the shells' light, on a grid over each: so fine, and this much of it
  const FINE = 512;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeStore = glazeTexture.createView({ dimension: "2d-array" });
  const glazes = columns.map((_, i) => {
    const b = buffer(16, UNIFORM);
    return { buffer: b, group: bind(L.glaze, [coarse, fine, around, detail, glazeStore, of(b), fieldView]), head: bind(L.head, [of(nets.shell.heads[i]), ...(glowShell ? [of(glowShell.heads[i])] : [])]), w: 0 };
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

  // ---------------------------------------------------------------- debug: the lines of it

  const WIRE = "rgba8unorm" as const;
  const wireModule = module(common + wireCode);
  const wireDraw = (m: GPUShaderModule, l: GPUPipelineLayout, entryPoint: string, topology: GPUPrimitiveTopology, hides = false) =>
    device.createRenderPipeline({
      layout: l,
      vertex: { module: m, entryPoint: "vertex" },
      fragment: { module: m, entryPoint, targets: [{ format: WIRE, blend: over, writeMask: hides ? 0 : GPUColorWrite.ALL }] },
      primitive: { topology, cullMode: hides ? "back" : "none" },
      depthStencil: { ...depth(hides), depthCompare: "less-equal", depthBias: hides ? 4 : 0, depthBiasSlopeScale: hides ? 2 : 0 },
      multisample: { count: SAMPLES },
    });
  const wirePipes = {
    hide: wireDraw(shellModule, pipeLayout(L.base, L.shell), "none", "triangle-list", true),
    shell: wireDraw(shellModule, pipeLayout(L.base, L.shell), "wire", "line-list"),
    fibre: wireDraw(wireModule, pipeLayout(L.base, L.wire), "fragment", "line-list"),
  };
  const layModule = module(`
    @group(0) @binding(0) var src: texture_2d<f32>;
    @vertex fn screen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0); }
    @fragment fn lay(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(src, vec2i(p.xy), 0); }`);
  const layOverPipe = device.createRenderPipeline({ layout: "auto", vertex: { module: layModule }, fragment: { module: layModule, targets: [{ format, blend: over }] } });
  const noSnaps = buffer(new Float32Array([1e9]), STORAGE);
  const snapBuffers = tears.map((t) => buffer(Float32Array.from(t.snaps, (x) => Math.min(x, 1e9)), STORAGE));
  const COLOURS = { wound: [0.42, 0.6, 0.95, 0.1], fuzz: [0.55, 0.8, 1, 0.3], floss: [0.65, 0.95, 0.75, 0.55], thread: [1, 0.95, 0.85, 0.75] };
  const [HOLDS, TORN] = [
    [0.35, 1, 0.55, 0.75],
    [1, 0.36, 0.24, 0.75],
  ];
  const wires = sets.map((k) => {
    const b = buffer(48, UNIFORM);
    const web = k.kind === "thread" && k.points === WEB;
    const of_ = BODIES[k.body].of;
    return { set: k, web, buffer: b, group: bind(L.wire, [of(k.buffer), of(points), of(b), of(web ? snapBuffers[columns[of_].id] : noSnaps)]) };
  });
  /** the lines of the mesh the shells are drawn with: every m-th of them, and (all of them) the triangles' diagonals */
  const meshLines = (m: number) => {
    const out: number[] = [];
    const at = (u: number, v: number) => v * GU + (u % GU);
    for (let v = 0; v <= GV; v += 2)
      for (let u = 0; u < GU; u += 2) {
        if ((v / 2) % m === 0 && v > 0 && v < GV) out.push(at(u, v), at(u + 2, v));
        if ((u / 2) % m === 0 && v < GV) out.push(at(u, v), at(u, v + 2));
        if (m === 1 && v < GV) out.push(at(u + 2, v), at(u, v + 2));
      }
    return { m, count: out.length, buffer: buffer(new Uint32Array(out), INDEX) };
  };
  let lines: ReturnType<typeof meshLines> | undefined;
  type WireTargets = { w: number; h: number; many: GPUTexture; one: GPUTexture; group: GPUBindGroup };
  let wireTargets: WireTargets | undefined;
  const wireInto = (w: number, h: number): WireTargets => {
    if (wireTargets?.w === w && wireTargets.h === h) return wireTargets;
    wireTargets?.many.destroy();
    wireTargets?.one.destroy();
    const { RENDER_ATTACHMENT, TEXTURE_BINDING } = GPUTextureUsage;
    const many = device.createTexture({ size: [w, h], format: WIRE, sampleCount: SAMPLES, usage: RENDER_ATTACHMENT });
    const one = device.createTexture({ size: [w, h], format: WIRE, usage: RENDER_ATTACHMENT | TEXTURE_BINDING });
    return (wireTargets = { w, h, many, one, group: device.createBindGroup({ layout: layOverPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: one.createView() }] }) });
  };

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
  const debug = gui.addFolder("debug");
  debug.add(look, "light", ["neural", "classic", "unlit"]);
  debug.add(look, "wire", { off: "off", "over the picture": "over", alone: "alone" });
  debug.add(look, "mesh", [1, 2, 4, 8]).name("mesh line, every");
  const picture = gui.addFolder("picture");
  if (LANTERN) {
    picture.add(look, "inside", 0, 8);
    picture.add(look, "others", 0, 3);
    picture.add(look, "flicker", 0, 1);
    picture.add(look, "pupa", 0.3, 1.2);
    picture.add(look, "through", 0, 0.8);
    picture.add(look, "ambient", 0, 1);
  }
  picture.add(look, "glint", 0, 3);
  picture.add(look, "strands", 0, 6);
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
  picture.add(look, "thrifty");
  picture.add(look, "frizz", 0, 2.5);
  picture.add(look, "web", 0.2, 1.5);
  picture.add(look, "hair", 0.4, 2);
  picture.add(look, "dim", 0, 0.3);
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
  const state = { t: 0, eye: [0, 0, 0] as number[], hold: undefined as number | undefined, frame: 0, ms: 0, time: undefined as ((ms: Record<string, number>) => void) | undefined };
  const due = frameCap();
  const frameData = new Float32Array(32);
  const viewProj = new Matrix4();

  wrap.render = ({ playhead }) => {
    if (state.hold === undefined && !due()) return;
    const t = state.hold ?? playhead;
    state.t = t;
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
    frameData.set([look.dim, far - 1.5, look.light === "unlit" ? 2 : 0, look.fibre], 24);
    const widest = h * 0.022;
    const focus = Math.max(0.5, far - look.focus);
    // opened less the closer it is, or there would be nothing but blur
    frameData.set([t * Math.PI * 2, look.lens * (far / 15.6) ** 0.75, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);

    // ---- where everything is
    const eye = camera.position.toArray() as [number, number, number];
    const list = Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"] };
    });
    const hung = columns.map((c) => where(c, tears, t, look.sway));
    const middles = hung.map((h) => h.body.t);
    const nowhere: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
    // every one when frames are asked for one by one, and when the eye moves
    const all = state.hold !== undefined || Math.hypot(...eye.map((x, q) => x - state.eye[q])) > 0.02;
    state.eye = eye;
    BODIES.forEach((b, i) => {
      const m = b.world ? nowhere : hung[b.of].body;
      const c = middles[b.of];
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      // in the picture, or nearly: a cocoon; or any of its line, from the ends of its web up
      const e = viewProj.elements;
      const at = (r: number, y: number) => e[r] * c[0] + e[4 + r] * y + e[8 + r] * c[2] + e[12 + r];
      const line = hung[b.of];
      const [x0, y0, z0] = [line.above.t[0], line.above.t[1], line.above.t[2]];
      const at0 = (r: number, y: number) => e[r] * x0 + e[4 + r] * y + e[8 + r] * z0 + e[12 + r];
      const scale = pixels / (w / 2);
      const up = pixels / (h / 2);
      const depthOf = Math.max(at(3, c[1]), 0.1);
      b.seen = columns[b.of].away
        ? false
        : b.world
        ? Math.abs(at0(0, y0 + OVER)) < Math.max(at0(3, y0 + OVER), 0.1) + 1.6 * scale && at0(1, y0 + 0.2) < Math.max(at0(3, y0), 0.1)
        : Math.abs(at(0, c[1])) < depthOf + 1.6 * scale && Math.abs(at(1, c[1])) < depthOf + 1.9 * up;
      b.d = Math.hypot(...c.map((x, q) => x - eye[q]));
      // lit anew every other frame while it hardly turns: what it was lit a frame ago is still on its own hairs
      const turned_ = b.R.length ? Math.max(...m.R.map((x, q) => Math.abs(x - b.R[q]))) : 1;
      // (in the turn fewer others have)
      if (b.seen && !b.was && !b.world) {
        const busy = [0, 1].map((q) => BODIES.reduce((a, o) => a + (!o.world && o !== b && o.was && o.turn === q ? 1 / o.d : 0), 0));
        b.turn = busy[0] <= busy[1] ? 0 : 1;
      }
      b.fresh = b.world || !look.thrifty || all || !b.was || line.gone > 0 || turned_ > 0.008 || ((b.turn + state.frame) & 1) === 0;
      if (b.fresh) b.R = m.R;
      b.was = b.seen;
      // who may stand in its light: those that the way to some lamp passes near
      const from = b.world ? [c[0], c[1] + 1.8, c[2]] : c;
      const size = b.world ? 1.6 : 1.15;
      const who = middles
        .map((o, j) => ({ j, v: o.map((x, k) => x - from[k]) }))
        .filter(({ j, v }) => (b.world || j !== b.of) && !columns[j].away && v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < 70)
        .map(({ j, v }) => {
          let gap = Infinity;
          for (const l of list) {
            const along = v[0] * l.dir[0] + v[1] * l.dir[1] + v[2] * l.dir[2];
            if (along < -size) continue;
            const off = Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along * along));
            gap = Math.min(gap, off - size - 1.1 - 0.12 * Math.max(along, 0));
          }
          // a web's own cocoon always may: left out, the lamps behind it would shine through it
          return { j, gap: j === b.of ? -Infinity : gap };
        })
        .filter(({ gap }) => gap < 0)
        .sort((p, q) => p.gap - q.gap)
        .slice(0, 12);
      const data = new Float32Array(56);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      const ids = new Uint32Array(data.buffer);
      ids.set([b.id, i, 0, 0], 16);
      ids.fill(99, 20, 40);
      data.set([line.above.t[0] + CORNER[0], line.above.t[1] + CORNER[1], line.above.t[2] + CORNER[2], b.of], 40);
      if (LANTERN && !b.world) {
        const { lamp, pupa, spine } = inside(m.R, line.age, b.of, look.pupa);
        data.set([...lamp, look.ambient, ...pupa, ...spine, look.through], 44);
      }
      who.forEach(({ j }, k) => (ids[20 + k] = j));
      // lantern.html: whose light comes to it most
      if (LANTERN)
        middles
          .map((o, j) => ({ j, d: Math.hypot(...o.map((x, k) => x - c[k])) }))
          .filter(({ j, d }) => (b.world || j !== b.of) && !columns[j].away && d < 8)
          .sort((p, q) => p.d - q.d)
          .slice(0, 8)
          .forEach(({ j }, k) => (ids[32 + k] = j));
      device.queue.writeBuffer(b.buffer, 0, data);
      if (!b.seen || b.world) return;
      const turned = list.map((l) => ({ dir: back(l.dir), colour: l.colour }));
      for (const name of ["shell", "on", "free"] as const) device.queue.writeBuffer(nets[name].heads[i], 0, foldLamps(head, name, turned));
    });
    device.queue.writeBuffer(nets.strand.heads[0], 0, foldLamps(head, "strand", list));
    // the cocoons as what stands in the light: each scaled to a ball
    const shade = new Float32Array((4 + 24 * 3 + 6 + 3 + 7) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.10, look.glint, look.strands], 12);
    hung.forEach(({ body: m, age }, i) => {
      // a new one comes out of nowhere above the picture: its shadow doesn't
      shade[(4 + 24 * 3) * 4 + i] = Math.min(1, age / 2.2) ** 2 * (3 - 2 * Math.min(1, age / 2.2));
      const c = head.cocoons[columns[i].id];
      [c.A, c.B, c.B].forEach((size, r) => {
        const w = [0, 1, 2].map((k) => m.R[k * 3 + r] / (size * 0.97));
        shade.set([...w, -(w[0] * m.t[0] + w[1] * m.t[1] + w[2] * m.t[2])], 16 + i * 12 + r * 4);
      });
    });
    list.forEach((l, n) => shade.set([...l.colour, 0], (4 + 24 * 3 + 6 + n) * 4));
    if (glowOn && glowShell) {
      columns.forEach((c, i) => {
        const { age, gone, frame } = hung[i];
        const tear = tears[c.id];
        const now = frame / tear.fps;
        let torn = 0;
        for (const x of tear.snaps) if (x <= now) torn++;
        const b = c.away ? 0 : look.inside * (0.55 + 0.6 * ((i * 0.618034) % 1)) * brightness(age, torn / tear.snaps.length, gone, i, look.flicker);
        const lights = [0, 0, 1].map((k) => INSIDE.map((q) => q * k * b) as [number, number, number]);
        for (const g of [glowOn, glowShell]) device.queue.writeBuffer(g.heads[i], 0, foldGlow(head, g.name, lights));
        shade[(4 + 24 * 3 + 6 + 3) * 4 + i] = 0.30 * b * look.others * Math.min(1, age / 2.5) ** 2 * (3 - 2 * Math.min(1, age / 2.5));
      });
      shade.set(INSIDE.map((q, k) => q * [1, 0.9, 0.78][k]), (4 + 24 * 3 + 6 + 3 + 6) * 4);
    }
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    const rows = (d: Float32Array, m: Pose, at: number) => [0, 1, 2].forEach((r) => d.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], at + r * 4));
    cordJobs.forEach((k, i) => {
      if (!BODIES[N + i].seen) return;
      const d = new Float32Array(32);
      new Uint32Array(d.buffer).set([still, each, k.out, 0]);
      d.set([0, OVER, OVER + 10, 0], 4);
      rows(d, hung[i].cord, 8);
      rows(d, nowhere, 20);
      device.queue.writeBuffer(k.buffer, 0, d);
    });
    weaves.forEach((k, i) => {
      const tear = tears[columns[i].id];
      const d = new Float32Array(40);
      new Uint32Array(d.buffer).set([tear.halves, COPIES, tear.frames, tear.nodes, WEB, webFirst + i * webN * WEB, 0, tear.halves / 2]);
      d.set([hung[i].frame, 0, 0, 0, tear.step, look.frizz, F.radius * look.web, 0.10], 8);
      rows(d, hung[i].above, 16);
      rows(d, hung[i].below, 28);
      device.queue.writeBuffer(k.buffer, 0, d);
    });
    splats.forEach((k, i) => {
      const d = new Float32Array(8);
      new Uint32Array(d.buffer).set([webFirst + i * webN * WEB, webN * WEB, WEB, i]);
      d.set([hung[i].above.t[0] + CORNER[0], hung[i].above.t[1] + CORNER[1], hung[i].above.t[2] + CORNER[2], 0], 4);
      device.queue.writeBuffer(k.buffer, 0, d);
    });
    // as many hairs as come out about a pixel wide, and as many points as show
    for (const k of sets) {
      const b = BODIES[k.body];
      if (!b.seen) continue;
      const each = (2 * head.kinds[k.kind === "thread" ? "floss" : k.kind].radius * look.fibre * pixels) / b.d;
      const part = k.kind === "wound" || k.kind === "fuzz" ? Math.ceil(Math.min(1, Math.max(0.28, each / look.hair)) * 32) / 32 : 1;
      const size = (2 * pixels) / b.d;
      const stride = k.kind === "thread" ? 1 : k.kind === "floss" ? (size > 430 ? 1 : 3) : size > 430 ? 1 : 2;
      const n = Math.ceil(k.n * part);
      const pts = Math.ceil((k.points - 1) / stride) + 1;
      // what was lit is of other hairs than these
      if (n > k.now.n || stride !== k.now.stride) b.fresh = true;
      k.now.n = n;
      k.now.stride = stride;
      k.now.points = pts;
      k.data[1] = k.now.n;
      k.data[2] = k.now.points;
      k.data[6] = k.now.n * k.now.points;
      k.data[13] = stride;
      new Float32Array(k.data.buffer)[14] = 1 / part;
      device.queue.writeBuffer(k.buffer, 0, k.data);
    }
    glazes.forEach((g, i) => {
      // about as fine as the screen
      const fine_ = (2 * pixels) / Math.max(1, BODIES[i].d - 0.5) > 520 ? FINE : FINE / 2;
      if (fine_ !== g.w) BODIES[i].fresh = true;
      g.w = fine_;
      const d = new DataView(new ArrayBuffer(16));
      [g.w, g.w / 2, i].forEach((x, k) => d.setUint32(k * 4, x, true));
      d.setFloat32(12, Math.log2(1024 / g.w), true);
      device.queue.writeBuffer(g.buffer, 0, d.buffer);
    });
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    if (look.strands > 0) encoder.clearBuffer(gridBufferOf);
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(cordPipe);
    cordJobs.forEach((k, i) => {
      if (!BODIES[N + i].seen) return;
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    });
    cp.setPipeline(weavePipe);
    weaves.forEach((k, i) => {
      if (!BODIES[N + i].seen && !BODIES[i].seen) return;
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    });
    const pictured = look.wire !== "alone";
    if (pictured) {
      if (look.strands > 0) {
        cp.setPipeline(splatPipe);
        splats.forEach((k, i) => {
          if (!BODIES[N + i].seen && !BODIES[i].seen) return;
          cp.setBindGroup(0, k.group);
          cp.dispatchWorkgroups(k.dispatch);
        });
      }
      cp.setPipeline(fieldPipe);
      fields.forEach((g, i) => {
        if (!BODIES[i].seen || !BODIES[i].fresh) return;
        cp.setBindGroup(0, bases[i]);
        cp.setBindGroup(1, g);
        cp.dispatchWorkgroups(FIELD_W / 8, FIELD_H / 8);
      });
    }
    if (look.shells && pictured) {
      cp.setPipeline(look.light === "neural" ? glazePipe : plainGlaze);
      glazes.forEach((g, i) => {
        if (!BODIES[i].seen || !BODIES[i].fresh) return;
        cp.setBindGroup(0, bases[i]);
        cp.setBindGroup(1, g.group);
        cp.setBindGroup(2, g.head);
        cp.dispatchWorkgroups(Math.ceil((g.w + 1) / 8), Math.ceil(g.w / 16));
      });
    }
    cp.setPipeline(veilPipe);
    for (const k of pictured ? sets : []) {
      if (!look[k.name] || !BODIES[k.body].seen || !BODIES[k.body].fresh) continue;
      cp.setBindGroup(0, bases[k.body]);
      cp.setBindGroup(1, k.veil);
      cp.dispatchWorkgroups(Math.ceil((k.now.n * veilsOf(k.kind)) / 64));
    }
    if (emberPipe) {
      cp.setPipeline(emberPipe);
      for (const k of pictured ? sets : []) {
        if (!k.ember || !look[k.name] || !BODIES[k.body].seen || !BODIES[k.body].fresh) continue;
        cp.setBindGroup(0, k.groups[0]);
        cp.setBindGroup(1, k.ember);
        cp.setBindGroup(2, k.groups[2]);
        cp.dispatchWorkgroups(Math.ceil((k.now.n * EMBERS) / 64));
      }
    }
    for (const k of pictured ? sets : []) {
      if (!look[k.name] || !BODIES[k.body].seen || !BODIES[k.body].fresh) continue;
      cp.setPipeline(look.light === "neural" ? k.pipe : k.plain);
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
        const split = Math.max(1, Math.min(6, Math.round((k.step * k.now.stride * pixels) / BODIES[k.body].d / 8)));
        device.queue.writeBuffer(k.splitBuffer, 0, new Uint32Array([split, airy(look.air * AIR[k.name]), 0, 0]));
        k.draw.forEach((g, i) => pass.setBindGroup(i, g));
        pass.draw(4, k.now.n * (k.now.points - 1) * split);
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
    if (look.wire !== "off") {
      const to = wireInto(w, h);
      if (lines?.m !== look.mesh) {
        lines?.buffer.destroy();
        lines = meshLines(look.mesh);
      }
      const p = encoder.beginRenderPass({
        colorAttachments: [{ view: to.many.createView(), resolveTarget: to.one.createView(), loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: targets.deep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
      });
      const shown = BODIES.map((_, i) => i).filter((i) => !BODIES[i].world && BODIES[i].seen);
      if (look.shells)
        for (const [pipe, ib, n] of [
          [wirePipes.hide, indexBuffer, index.length],
          [wirePipes.shell, lines.buffer, lines.count],
        ] as const) {
          p.setPipeline(pipe);
          p.setIndexBuffer(ib, "uint32");
          for (const i of shown) {
            p.setBindGroup(0, bases[i]);
            p.setBindGroup(1, shellGroups[i]);
            p.drawIndexed(n, 1, 0, 0, BODIES[i].id);
          }
        }
      p.setPipeline(wirePipes.fibre);
      for (const { set: k, web, buffer: b, group: g } of wires) {
        if (!look[k.name] || !BODIES[k.body].seen) continue;
        const i = BODIES[k.body].of;
        const tear = tears[columns[i].id];
        const d = new Float32Array(12);
        d.set([...(web ? HOLDS : COLOURS[k.name]), ...TORN, hung[i].frame / tear.fps], 0);
        new Uint32Array(d.buffer)[9] = web ? tear.halves / 2 : 0;
        device.queue.writeBuffer(b, 0, d);
        p.setBindGroup(0, bases[k.body]);
        p.setBindGroup(1, g);
        // of a web's strands, which are drawn a few times over, one
        p.draw(2, (web ? tear.halves : k.now.n) * (k.now.points - 1));
      }
      p.end();
      const q = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: pictured ? "load" : "clear", storeOp: "store", clearValue: [0.012, 0.014, 0.018, 1] }] });
      q.setPipeline(layOverPipe);
      q.setBindGroup(0, to.group);
      q.draw(3);
      q.end();
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

  Object.assign(window, { __cocoon: { look, lamps, state, home, camera, controls, device, DURATION, columns: () => columns } });

  wrap.resize = ({ width, height }) => {
    columns = layOut(width / height, tears);
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
