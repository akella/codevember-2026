/**
 * The falling loop. A cocoon falls in on the left, the one that hung there goes down into the lowest place and
 * the one that hung there is torn free, strand by strand. Everything that moves was worked out beforehand
 * (bake/drop*.py) and is a cocoon's one life, drawn a loop apart; the light is the still cluster's (../index.ts),
 * each cocoon lit as it would be in its place there, by lamps turned as it has not.
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
import { foldLamps, netCode, type Lamp } from "../net";
import lensCode from "../lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "./shade-on.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shellCode from "./shell.wgsl?raw";
import { loadDrop, type Pose } from "./load";
import skinCode from "./skin.wgsl?raw";
import veilCode from "./veil.wgsl?raw";
import weaveCode from "./weave.wgsl?raw";

const DURATION = 8;
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
  /** how much the loose silk crinkles */
  frizz: 1,
  /** how dark one cocoon's shadow on another is (the light also comes through it) */
  shadow: 0.8,
  shells: true,
  wound: true,
  fuzz: true,
  floss: true,
  thread: true,
  web: true,
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

  const [cocoon, drop] = await Promise.all([load("./"), loadDrop("./")]);
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

  // what moves as one: the top cocoon, the right one, the three on their way (a loop apart); and what doesn't
  const BODIES = [0, 1, 2, 2, 2, 0].map((id, b) => ({ id, pose: [0, 1, 3, 4, 5, -1][b], buffer: buffer(80, UNIFORM), world: b === 5, seen: true, x: 0, d: 0 }));
  const WORLD = BODIES[5];

  // the still strands' points, and after them room for those that move
  const still = cocoon.points.length / 4;
  const WEB = 96;
  const { across, thread } = drop.head;
  const F = head.kinds.floss;
  const T = head.kinds.thread;
  let room = still;
  const take = (n: number) => (room += n) - n;
  const skins = [
    { first: cocoon.first.floss + across[0] * F.points, n: across[1] - across[0], points: F.points, mode: 0, a: 0, b: 1, fade: 0, kind: "floss" as KindName, code: across[0] },
    ...([["A", 0, 0], ["B", 1, 0], ["C", 0, 1], ["A2", 0, 0]] as const).map(([k, b, fade]) => ({
      first: cocoon.first.thread + thread[k][0] * T.points,
      n: thread[k][1] - thread[k][0],
      points: T.points,
      mode: 1,
      a: 0,
      b,
      fade,
      kind: "thread" as KindName,
      code: thread[k][0],
    })),
  ].map((k) => ({ ...k, out: take(k.n * k.points) }));
  const webs = (["P", "M"] as const).map((name) => {
    const { n, copies, frames } = drop.head[name];
    return { name, n, copies, frames, out: take(n * copies * WEB), ...drop[name] };
  });
  const pointData = new Float32Array(room * 4);
  pointData.set(cocoon.points);
  const points = buffer(pointData, STORAGE);
  const codes = buffer(padded(cocoon.codes), STORAGE);
  const relief = buffer(padded(cocoon.section("relief")), STORAGE);

  /** layers of four numbers, with smaller copies for when it is far */
  const texture = (name: "coarse" | "fine" | "detail", mips: boolean) => {
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
  const detail = texture("detail", true);
  const around = device.createSampler({ addressModeU: "repeat", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 4 });
  const plain = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });

  const netNames = ["shell", "on", "free"] as const;
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
  type Bind = "uniform" | "storage" | "read-only-storage" | "texture" | "sampler";
  const layout = (visibility: number, kinds: Bind[]) =>
    device.createBindGroupLayout({
      entries: kinds.map((k, binding) => ({
        binding,
        visibility,
        ...(k === "texture" ? { texture: { viewDimension: "2d-array" } } : k === "sampler" ? { sampler: {} } : { buffer: { type: k } }),
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
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "texture", "texture", "sampler", "uniform", "texture"]),
    weave: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage"]),
    skin: layout(COMPUTE, ["uniform", "uniform", "storage"]),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), common + nets.on.code + shadeCode.replace("SHADE", shadeOn)),
    free: await compute(pipeLayout(L.base, L.free, L.head), common + nets.free.code + shadeCode.replace("SHADE", shadeFree.replace("run_free(&x)", "shaded(run_free(&x), veilAt(i, t))")).replace(/@group\(1\) @binding\([6789]\).*\n/g, "")),
  };
  const veilPipe = await compute(pipeLayout(L.base, L.veil), common + veilCode);
  const weavePipe = await compute(pipeLayout(L.weave), weaveCode);
  const skinPipe = await compute(pipeLayout(L.skin), skinCode);
  const shellModule = module(common + nets.shell.code + shellCode);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell, L.head),
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
  const shadowBuffer = buffer((4 + 9 * 3) * 16, UNIFORM);
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
  const plans: { name: KindName | "web"; kind: KindName; body: number; first: number; n: number; points: number; map: number }[] = [];
  for (const name of ["wound", "fuzz"] as const) {
    const k = head.kinds[name];
    const per = k.n / head.cocoons.length;
    BODIES.forEach((b, body) => {
      if (!b.world) plans.push({ name, kind: name, body, first: cocoon.first[name] + b.id * per * k.points, n: per, points: k.points, map: owned(count(per, b.id * per)) });
    });
  }
  const { coat } = drop.head;
  BODIES.forEach((b, body) => {
    const from = coat.first + b.id * coat.each;
    if (!b.world) plans.push({ name: "floss", kind: "floss", body, first: cocoon.first.floss + from * F.points, n: coat.each, points: F.points, map: owned(count(coat.each, from)) });
  });
  for (const k of skins) plans.push({ name: k.kind, kind: k.kind, body: 5, first: k.out, n: k.n, points: k.points, map: owned(count(k.n, k.code)) });
  for (const k of webs) plans.push({ name: "web", kind: "floss", body: 5, first: k.out, n: k.n * k.copies, points: WEB, map: owned(Array.from({ length: k.n * k.copies }, (_, i) => k.donor[i % k.n])) });
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
    let step = 0.026;
    if (p.name !== "web") {
      step = 0;
      const from = p.body === 5 ? cocoon.first[p.kind] : p.first;
      for (let i = 0; i < 200; i++) {
        const o = (from + Math.floor((i / 200) * Math.min(p.n, 60)) * k.points + 3) * 4;
        step += Math.hypot(...[0, 1, 2].map((c) => cocoon.points[o + c] - cocoon.points[o + 4 + c])) / 200;
      }
    }
    const shared = [of(b), of(points), of(codes), of(lit), of(ownerBuffer), of(veils)];
    return {
      ...p,
      pipe: shadePipes[k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail]) : bind(L.free, shared), bind(L.head, [of(nets[k.on ? "on" : "free"].heads[p.body])])],
      veil: bind(L.veil, [of(b), of(points), of(veils)]),
      veilDispatch: Math.ceil((p.n * veilsOf(p.kind)) / 64),
      dispatch: Math.ceil((p.n * p.points) / 64),
      draw: [bases[p.body], bind(L.fibre, [of(b), of(points), of(lit), of(splitBuffer)])],
      stretches: p.n * (p.points - 1),
      step,
      splitBuffer,
    };
  });

  const moveBuffer = buffer(144, UNIFORM);
  const skinJobs = skins.map((k) => {
    const d = new Uint32Array([k.first, k.n, k.points, k.out, k.mode, k.a, k.b, k.fade, 0, 0, 0, 0]);
    return { group: bind(L.skin, [of(buffer(d, UNIFORM)), of(moveBuffer), of(points)]), dispatch: Math.ceil((k.n * k.points) / 64) };
  });
  const weaveJobs = webs.map((k) => {
    const b = buffer(64, UNIFORM);
    return { ...k, buffer: b, group: bind(L.weave, [of(b), of(buffer(k.motion, STORAGE)), of(buffer(k.length, STORAGE)), of(points)]), dispatch: Math.ceil((k.n * k.copies * WEB) / 64) };
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
  const shellGroup = bind(L.shell, [of(relief), coarse, fine, around, of(buffer(new Uint8Array(gridData.buffer), UNIFORM)), detail]);
  const shellHeads = BODIES.map((_, b) => bind(L.head, [of(nets.shell.heads[b])]));

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
  const home = (az = 0, el = 2, dist = 16.2, target: [number, number, number] = [0, 0.42, 0]) => {
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
  picture.add(look, "frizz", 0, 2.5);
  picture.add(look, "shadow", 0, 1);
  for (const [name, l] of Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`);
    f.add(l, "azimuth", -180, 180);
    f.add(l, "elevation", -36, 80);
    f.add(l, "power", 0, 6);
    f.addColor(l, "colour");
  }
  const parts = gui.addFolder("parts").close();
  for (const k of ["shells", ...KINDS, "web"] as const) parts.add(look, k);

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
    const poses = drop.at(t);
    const eye = camera.position.toArray() as [number, number, number];
    const moves: Pose[] = [];
    const list = Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"] };
    });
    BODIES.forEach((b, i) => {
      const m: Pose = b.world ? { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] } : poses[b.pose];
      moves.push(m);
      const back = (v: number[]) => [0, 1, 2].map((c) => m.R[c] * v[0] + m.R[3 + c] * v[1] + m.R[6 + c] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, c) => x - m.t[c]));
      const c = head.cocoons[b.id].c;
      const at = [0, 1, 2].map((r) => m.R[r * 3] * c[0] + m.R[r * 3 + 1] * c[1] + m.R[r * 3 + 2] * c[2] + m.t[r]);
      b.seen = b.world || Math.abs(at[1] - controls.target.y) < far * Math.tan((head.fov * Math.PI) / 360) + 2.4;
      b.d = Math.hypot(...at.map((x, q) => x - eye[q]));
      const data = new Float32Array(20);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      new Uint32Array(data.buffer).set([b.id, b.world ? 99 : i, b.world ? 99 : b.id], 16);
      device.queue.writeBuffer(b.buffer, 0, data);
      if (!b.seen) return;
      const turned = list.map((l) => ({ dir: back(l.dir), colour: l.colour }));
      for (const name of netNames) if (!(b.world && name !== "free"))
         device.queue.writeBuffer(nets[name].heads[i], 0, foldLamps(head, name, turned));
    });
    // the cocoons as what stands in the light, now and at rest: each scaled to a ball
    const shade = new Float32Array((4 + 27) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.10, 2.2, 0], 12);
    const ball = (id: number, m?: Pose) => {
      const c = head.cocoons[id];
      const size = [c.A, c.B, c.B].map((x) => x * 0.97);
      const out: number[] = [];
      for (let r = 0; r < 3; r++) {
        const row = c.M[r].map((x) => x / size[r]);
        const off = -(row[0] * c.c[0] + row[1] * c.c[1] + row[2] * c.c[2]);
        if (!m) out.push(...row, off);
        else {
          // from the world back to rest, then as above
          const w = [0, 1, 2].map((k) => row[0] * m.R[k * 3] + row[1] * m.R[k * 3 + 1] + row[2] * m.R[k * 3 + 2]);
          out.push(...w, off - (w[0] * m.t[0] + w[1] * m.t[1] + w[2] * m.t[2]));
        }
      }
      return out;
    };
    BODIES.slice(0, 5).forEach((b, i) => shade.set(ball(b.id, moves[i]), 16 + i * 12));
    head.cocoons.forEach((_, id) => shade.set(ball(id), 16 + (5 + id) * 12));
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    const moveData = new Float32Array(36);
    [moves[0], moves[1], poses[2]].forEach((m, i) => {
      for (let r = 0; r < 3; r++) moveData.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], i * 12 + r * 4);
    });
    device.queue.writeBuffer(moveBuffer, 0, moveData);
    const seconds = (((t % 1) + 1) % 1) * DURATION;
    for (const k of weaveJobs) {
      const d = new ArrayBuffer(64);
      new Uint32Array(d).set([k.n, k.copies, k.frames, drop.head.nodes, WEB, k.out, 0, k.name === "P" ? 1 : 0]);
      new Float32Array(d).set([0, 1, 2, 3].map((c) => (c < k.copies ? (seconds + c * DURATION) * drop.head.fps : -1)), 8);
      new Float32Array(d).set([drop.head.step, look.frizz, F.radius, 0], 12);
      device.queue.writeBuffer(k.buffer, 0, d);
    }
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(skinPipe);
    for (const k of skinJobs) {
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    }
    cp.setPipeline(weavePipe);
    for (const k of weaveJobs) {
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
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
      pass.setBindGroup(1, shellGroup);
      pass.setIndexBuffer(indexBuffer, "uint32");
      // the near ones first, so that hidden pixels of the far ones are never shaded
      const order = BODIES.map((b, i) => i).filter((i) => !BODIES[i].world && BODIES[i].seen);
      order.sort((a, b) => BODIES[a].d - BODIES[b].d);
      for (const i of order) {
        pass.setBindGroup(0, bases[i]);
        pass.setBindGroup(2, shellHeads[i]);
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
