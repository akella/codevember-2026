/**
 * Three white cocoons in a net on grey, as in a photographer's studio, to be seen close: the studio's cocoon
 * (bake/studio.py), learnt on its own, drawn three times, each turned its own way. The net, the cords and the strays
 * are the studio page's (../studio/web.ts). The camera goes from all of it to the silk of one and back.
 */
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { frameCap } from "../cap";
import common from "../rain/common.wgsl?raw";
import fibreCode from "../rain/fibre.wgsl?raw";
import { HERO, load, type HeroHead, type HeroKind } from "../hero/load";
import { makeRelief } from "../relief";
import type { Head } from "../load";
import { foldLamps, netCode, type Lamp } from "../net";
import { foldHero, heroCode } from "../hero/net";
import lensCode from "../rain/lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "../rain/shade-on.wgsl?raw";
import shadeCode from "../rain/shade.wgsl?raw";
import shellCode from "../rain/shell.wgsl?raw";
import glazeCode from "../rain/glaze.wgsl?raw";
import fieldCode from "../hero/field.wgsl?raw";
import { glow, inside } from "../hero/hang";
import { PLACES, clusterAt, makeWeb, standing, type Pose } from "../studio/web";
import veilCode from "../rain/veil.wgsl?raw";
import shadeStrand from "../rain/shade-strand.wgsl?raw";
import { depth as deep } from "../rain/depth";
import { nearLens } from "../rain/near-lens";

const DURATION = 36;
const FAR = 13.4;
const N = PLACES.length;
type KindName = HeroKind | "thread";
const KINDS = [...HERO, "thread"] as const;
/** the field's grid, over the cocoon */
const [FIELD_W, FIELD_H] = [512, 256];

// ---- the shaders, as rain.html's, changed here and there
const commonCode = deep
  .common(common)
  // the balls only stand in for the cocoons; what lies on one (the net, or another's fibres where they touch) is in its
  // shadow only where the lamp is behind its silk, not wherever it is a little inside the ball
  .replace(
    "  return (1.0 - smoothstep(1.0 - soft, 1.0 + soft, near)) * smoothstep(-0.15, 0.35, along);",
    `  let ball = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, near)) * smoothstep(-0.15, 0.35, along);
  let behind = smoothstep(0.05, -0.30, dot(normalize(q), w / l));
  return mix(ball, behind, smoothstep(1.14, 1.04, length(q)));`,
  )
  .replace("box: vec4f, lamp", "lamp")
  .replace("colours: array<vec4f, 3> }", "colours: array<vec4f, 3>, tint: vec4f }") + `
fn warmed(f: f32) -> vec3f { let g = max(f, 0.0); return g * vec3f(1.0, pow(g + 0.02, 0.17), pow(g + 0.02, 0.42)); }
`;
const onText = shadeOn.replace(
  "let c = shaded(run_on(&x), veilAt(i, t));",
  `let field = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);
  let L = run_on(&x);
  let vv = field.rgb * veilAt(i, t);
  let c = shaded(L.lamps, vv) + glints(tangent, view, normal, 1.0, i, t, vv) + L.inner * warmed(field.a);`,
);
const freeText = shadeFree.replace("let c = run_free(&x);", `let L = run_free(&x);
  let vv = veilAt(i, t);
  let c = shaded(L.lamps, vv) + glints(tangent, view, view, 0.0, i, t, vv) + L.inner * 0.75;`);
const strandText = shadeStrand.replace(
  "let c = shaded(run_strand(&x), veilAt(i, t));",
  `let vv = veilAt(i, t);
  let here = length(p);
  // strands learnt dimmer than this silk: lit up to it (shadow.tint.w)
  var c = shaded(run_strand(&x), vv) * shadow.tint.w + glints(tangent, view, view, 0.0, i, t, vv);
  // the network knows strands alone in the dark: near a cocoon its silk lights them too
  let wp = place(p);
  for (var o = 0u; o < 3u; o++) {
    let b = shadow.now[o];
    let q = vec3f(dot(b.x.xyz, wp) + b.x.w, dot(b.y.xyz, wp) + b.y.w, dot(b.z.xyz, wp) + b.z.w);
    let n = normalize(b.x.xyz * q.x + b.y.xyz * q.y + b.z.xyz * q.z);
    let near = exp(-max(length(q) - 1.0, 0.0) * 3.5) * 0.5;
    for (var l = 0u; l < 3u; l++) { c += shadow.colours[l].rgb * vv[l] * near * shadow.look.w * max(dot(n, shadow.lamps[l].xyz) * 0.8 + 0.2, 0.0); }
    c += shadow.tint.rgb * near * 0.4;
  }
  _ = here;`,
);
const onCode_ = shadeCode.replace("@group(1) @binding(9)", "@group(1) @binding(10) var fieldTex: texture_2d_array<f32>;\n@group(1) @binding(9)");
const glazeText = glazeCode
  .replace("@compute", "@group(1) @binding(6) var fieldTex: texture_2d_array<f32>;\n@compute")
  .replace("  textureStore(lightTex", `  let fieldAt = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);
  let L = run_shell(&x);
  let lin = normalize(body.lamp.xyz - p);
  let crease = mix(1.0, clamp((dot(-normal, lin) + 0.3) / (dot(-d, lin) + 0.3), 0.35, 1.9), 0.75 * smoothstep(-0.2, 0.2, dot(-d, lin)));
  textureStore(lightTex`)
  .replace("shaded(run_shell(&x), shade)", "shaded(L.lamps, shade * fieldAt.rgb) + L.inner * warmed(fieldAt.a * crease)");
/** the relief has a finer grid, and finer felt (bake/hero.py) */
const finer = (code: string) =>
  code
    .replace("const NU = 1536u;", "const NU = 3072u;")
    .replace("const NV = 768u;", "const NV = 1536u;")
    .replace("const SIGMA = 11.0;", "const SIGMA = 22.0;")
    .replaceAll("var k = -33; k <= 33;", "var k = -66; k <= 66;")
    .replace("+ 0.0011 * felt;", "+ 0.0011 * felt + 0.00045 * noise(p / 0.0066, 771u) + 0.0011 * abs(noise(p / 0.019, 772u)) - 0.0004;")
    .replace("sum / 18.0 - 0.0015", "sum / 18.0 - 0.0012");

const SAMPLES = 4;
const GLOWS = 6;
const AIR = { wound: 0, fuzz: 0.5, down: 0.3, floss: 1, thread: 0.7 };
const bits = new DataView(new ArrayBuffer(4));
const airy = (x: number) => (bits.setFloat32(0, x), bits.getUint32(0));

const look = {
  /** the camera goes round of itself (till it is moved by hand) */
  tour: true,
  /** the cocoons but the nearest lit every other frame */
  thrift: true,
  /** light inside: never; comes and goes; always */
  mode: "day" as "breathe" | "lantern" | "day",
  exposure: 0.5,
  gamma: 1,
  bloom: 0.012,
  spread: 0.95,
  fibre: 1,
  /** contrast among neighbouring strands, put back */
  crisp: 0.25,
  /** how wide the lens opens (half a cocoon is 1), and how far before the middle of the view it is focused. Shut: at
   * 1.5 to 2 pixels to a point the small blurs near the focus went blotchy (an ellipse on the near cocoon) */
  lens: 0,
  focus: 0,
  /** how far before and behind the focus everything is quite sharp */
  sharp: 0.5,
  /** how far the air moves loose silk */
  air: 0.010,
  sway: 1,
  /** the light inside, how it flickers, and what of it has no direction */
  inside: 0.9,
  flicker: 1,
  ambient: 0.04,
  /** the pupa: how large, and how far it shows through the silk right before it */
  pupa: 0.02,
  through: 0,
  /** light off the strands' skin */
  glint: 0.2,
  /** how thick the web's strands are drawn; what the cocoons throw back on them */
  web: 0.9,
  bounce: 1,
  /** how much brighter than they were learnt the web's strands are */
  strand: 1.5,
  /** how wide the lamps are (radians) */
  wide: 0.36,
  /** the wall behind: how light, and how much darker towards its corners */
  wall: 0.19,
  fall: 0.8,
  dim: 0,
  shadow: 0.8,
  shells: true,
  wound: true,
  fuzz: true,
  down: true,
  floss: true,
  thread: true,
};

/** azimuth from the camera's side (0 in front, 180 behind), elevation, power (1 makes a facing wall white) */
const lamps = {
  key: { azimuth: -58, elevation: 50, power: 1.5, colour: "#fffdf8" },
  fill: { azimuth: 30, elevation: 4, power: 0.22, colour: "#f6f8ff" },
  back: { azimuth: 165, elevation: 45, power: 0.8, colour: "#ffffff" },
};

/** where the camera is, through the loop: all of them, nearer, one's silk close, round, and back */
const tourAt = (t: number) => {
  const u = ((t % 1) + 1) % 1;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  // how near: far for a while, in, held, out
  const near = ease((u - 0.08) / 0.3) * (1 - ease((u - 0.72) / 0.24));
  // in on the side away from the key, so that it rakes the silk; up to the edge of one, where the back lamp lights its
  // hairs against the wall; slowly along it while near
  const az = -10 + 26 * Math.sin(Math.PI * 2 * u) * (1 - near) + near * (35 + 18 * (u - 0.55));
  const el = 3 + 8 * near - 4 * Math.sin(Math.PI * 4 * u) * (1 - near);
  const dist = FAR * Math.exp(Math.log(3.4 / FAR) * near);
  const at = (a: number[], b: number[], k: number) => a.map((x, i) => x + (b[i] - x) * k) as [number, number, number];
  const target = at([0.03, 0.72, 0], [1.2, 0.45 + 0.25 * (u - 0.55), 0.1], near);
  return { az, el, dist, target };
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

  const cocoon = await load("./macro/");
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

  // what moves as one: the cocoons, and (their points are in the world already) the net and the cords
  const BODIES = Array.from({ length: N + 1 }, (_, b) => ({ id: 0, of: b, world: b === N, buffer: buffer(208, UNIFORM), d: 0, seen: true, now: true }));

  // the still strands' points, and after them the threads', as they hang and as they are
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const one = { A: head.cocoons[0].A, B: head.cocoons[0].B };
  const webs = makeWeb([one, one, one, one], F.radius);
  let room = still;
  const webFirst = webs.map((w) => (room += w.n * w.points) - w.n * w.points);
  const pointData = new Float32Array(room * 4);
  pointData.set(cocoon.points);
  webs.forEach((w, i) => pointData.set(w.data, webFirst[i] * 4));
  const points = buffer(pointData, STORAGE);
  const codes = buffer(padded(cocoon.codes), STORAGE);
  // the relief is made here, not downloaded
  const { relief, view: detail } = makeRelief(device, head as unknown as Head, undefined, finer);

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

  const half = device.features.has("shader-f16");
  const names = ["shell", "on", "free"] as const;
  const nets = Object.fromEntries(
    names.map((name) => {
      const code = heroCode(name, head.nets[name], half, Object.keys(lamps).length);
      return [name, { ...code, buffers: PLACES.map(() => buffer(code.head * 16, UNIFORM)) }];
    }),
  ) as Record<(typeof names)[number], { code: string; head: number; buffers: GPUBuffer[] }>;
  const strandNet = netCode("strand", head.nets.strand, 2, 0, half, Object.keys(lamps).length);
  const strandHead = { ...head, lamp: head.strandLamp, tint: head.strandTint } as unknown as Head;
  const strandBuffer = buffer(strandNet.head * 16, UNIFORM);

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
    on: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "texture", "texture", "sampler", "texture", "texture"]),
    free: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage"]),
    veil: layout(COMPUTE, ["uniform", "read-only-storage", "storage"]),
    head: layout(COMPUTE | FRAGMENT, ["uniform"]),
    fibre: layout(VERTEX, ["uniform", "read-only-storage", "read-only-storage", "uniform"]),
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "uniform", "texture", "sampler", "uniform"]),
    glaze: layout(COMPUTE, ["texture", "texture", "sampler", "texture", "store", "uniform", "texture"]),
    field: layout(COMPUTE, ["store", "uniform"]),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const noTextures = (code: string) => code.replace(/@group\(1\) @binding\((?:[6789]|10)\).*\n/g, "");
  const unitOr = "fn unitOr(v: vec3f) -> vec3f { let l = length(v); return select(vec3f(0.0, 1.0, 0.0), v / max(l, 1e-20), l > 1e-9); }\n";
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head), commonCode + nets.on.code + onCode_.replace("SHADE", onText)),
    free: await compute(pipeLayout(L.base, L.free, L.head), commonCode + nets.free.code + noTextures(shadeCode.replace("SHADE", freeText))),
    // where a net's strand curls tight, the points either side of one can be the same: its way is then nowhere (NaN, drawn black)
    strand: await compute(pipeLayout(L.base, L.free, L.head), commonCode + strandNet.code + unitOr + noTextures(shadeCode.replace("SHADE", strandText).replace("let tangent = normalize(", "let tangent = unitOr("))),
  };
  const veilPipe = await compute(pipeLayout(L.base, L.veil), commonCode + veilCode);
  const fieldPipe = await compute(pipeLayout(L.base, L.field), commonCode + fieldCode);
  const glazePipe = await compute(pipeLayout(L.base, L.glaze, L.head), commonCode + nets.shell.code + glazeText);
  const shellModule = module(commonCode + shellCode);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell),
    vertex: { module: shellModule },
    fragment: { module: shellModule, entryPoint: "fragment", targets: [{ format: HDR }, { format: SOFT }] },
    primitive: { cullMode: "back" },
    depthStencil: depth(true),
    multisample: { count: SAMPLES },
  });
  const fibreModule = module(commonCode + fibreCode);
  const fibrePipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.fibre),
    vertex: { module: fibreModule },
    fragment: { module: fibreModule, targets: [{ format: HDR, blend: over }, { format: SOFT, blend: over }] },
    primitive: { topology: "triangle-strip" },
    depthStencil: depth(false),
    multisample: { count: SAMPLES },
  });
  const shadowBuffer = buffer((4 + 24 * 3 + 6 + 3 + 1) * 16, UNIFORM);
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
  const plans: { name: KindName; kind: HeroKind; body: number; first: number; n: number; points: number; map: number }[] = [];
  const maps = Object.fromEntries(HERO.map((name) => [name, owned(count(head.kinds[name].n))])) as Record<HeroKind, number>;
  for (let b = 0; b < N; b++)
    for (const name of HERO) {
      const k = head.kinds[name];
      plans.push({ name, kind: name, body: b, first: cocoon.first[name], n: k.n, points: k.points, map: maps[name] });
    }
  const zeros = owned(Array(Math.max(...webs.map((w) => w.n))).fill(0));
  webs.forEach((w, i) => plans.push({ name: "thread", kind: "floss", body: N, first: webFirst[i], n: w.n, points: w.points, map: zeros }));
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE);
  // at how many places along each the shadows are worked out: the net's long strands go over the backs of the cocoons
  // and round to their fronts, and at 6 places a shadow behind darkened a front a fifth of a strand long
  const veilsOf = (p: { name: string; kind: HeroKind; points: number }) => (p.name === "thread" ? Math.max(6, Math.ceil(p.points / 5)) : head.kinds[p.kind].on ? 3 : 6);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p)) - p.n * veilsOf(p));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);
  const fieldTexture = device.createTexture({ size: [FIELD_W, FIELD_H, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const fieldView = fieldTexture.createView({ dimension: "2d-array" });
  const fieldGroups = PLACES.map((_, b) => bind(L.field, [fieldView, of(buffer(new Uint32Array([FIELD_W, FIELD_H, b, 1]), UNIFORM))]));

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(64, UNIFORM);
    const data = new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, 0, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p), p.points, 1, 0, 0]);
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    let step = webs.find((w) => w.n === p.n && w.points === p.points)?.step ?? 0.03;
    if (p.name !== "thread") {
      step = 0;
      for (let i = 0; i < 200; i++) {
        const o = (p.first + Math.floor((i / 200) * Math.min(p.n, 60)) * p.points + 3) * 4;
        step += Math.hypot(...[0, 1, 2].map((c) => pointData[o + c] - pointData[o + 4 + c])) / 200;
      }
    }
    const shared = [of(b), of(points), of(codes), of(lit), of(ownerBuffer), of(veils)];
    return {
      ...p,
      pipe: shadePipes[p.name === "thread" ? "strand" : k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail, fieldView]) : bind(L.free, shared), bind(L.head, [of(p.name === "thread" ? strandBuffer : nets[k.on ? "on" : "free"].buffers[p.body])])],
      veil: bind(L.veil, [of(b), of(points), of(veils)]),
      veilsEach: veilsOf(p),
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
  const FINE = 2048;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeView = glazeTexture.createView({ dimension: "2d-array" });
  const glazes = PLACES.map((_, b) => {
    const info = buffer(16, UNIFORM);
    return { w: FINE, info, group: bind(L.glaze, [coarse, fine, around, detail, glazeView, of(info), fieldView]), head: bind(L.head, [of(nets.shell.buffers[b])]) };
  });

  const { u: GU, v: GV, lo, hi } = head.relief;
  const gridData = new DataView(new ArrayBuffer(16));
  gridData.setUint32(0, GU, true);
  gridData.setUint32(4, GV, true);
  gridData.setFloat32(8, lo, true);
  gridData.setFloat32(12, hi, true);
  const index = new Uint32Array(GU * GV * 6);
  for (let v = 0, o = 0; v < GV; v++)
    for (let u = 0; u < GU; u++) {
      const [a, b, c, d] = [v * GU + u, v * GU + ((u + 1) % GU), (v + 1) * GU + u, (v + 1) * GU + ((u + 1) % GU)];
      index.set([a, c, b, b, c, d], o);
      o += 6;
    }
  const indexBuffer = buffer(index, INDEX);
  const gridBuffer = buffer(new Uint8Array(gridData.buffer), UNIFORM);
  const shellGroups = glazes.map((g) => bind(L.shell, [of(relief), of(gridBuffer), glazeView, plain, of(g.info)]));

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
  // small blurs at full size, and sharp hairs over blurred silk kept (../rain/near-lens.ts)
  const lensModule = module(nearLens(lensCode));
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

  const camera = new PerspectiveCamera(head.fov, width / height, 0.2, 40);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 0.9;
  controls.maxDistance = 22;
  // moved by hand: the tour stops
  controls.addEventListener("start", () => (look.tour = false));
  const home = (az = 0, el = 3, dist = FAR, target: [number, number, number] = [0.03, 0.72, 0], touring = false) => {
    if (!touring) look.tour = false;
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    controls.target.set(...target);
    camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(controls.target);
    controls.update();
  };
  home(undefined, undefined, undefined, undefined, true);

  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  const gui = new GUI({ title: "cocoon" });
  const picture = gui.addFolder("picture");
  picture.add(look, "tour").listen();
  picture.add(look, "mode", ["day", "breathe", "lantern"]);
  const range: [keyof typeof look, number, number][] = [["exposure", 0.1, 4], ["gamma", 0.6, 1.6], ["bloom", 0, 0.4], ["fibre", 0.3, 3], ["crisp", 0, 3], ["lens", 0, 0.6], ["focus", -1, 1.5], ["sharp", 0, 2], ["air", 0, 0.04], ["sway", 0, 2], ["inside", 0, 5], ["flicker", 0, 3], ["ambient", 0, 1], ["pupa", 0, 1.2], ["through", 0, 0.9], ["glint", 0, 3], ["web", 0.2, 2], ["bounce", 0, 2], ["strand", 0.5, 4], ["wide", 0, 0.8], ["wall", 0, 0.5], ["fall", 0, 1]];
  for (const [k, a, b] of range) picture.add(look as unknown as Record<string, number>, k, a, b);
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
  const state = { hold: undefined as number | undefined, frame: 0, ms: 0, time: undefined as ((ms: Record<string, number>) => void) | undefined };
  const due = frameCap();
  const frameData = new Float32Array(32);
  const viewProj = new Matrix4();

  wrap.render = ({ playhead }) => {
    if (state.hold === undefined && !due()) return;
    const t = state.hold ?? playhead;
    if (look.tour) {
      const { az, el, dist, target } = tourAt(t);
      home(az, el, dist, target, true);
    }
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
    const within = look.lens * (far / 4.6) ** 0.75 * pixels * (1 / Math.max(0.5, far - look.focus - look.sharp) - 1 / Math.max(0.5, far - look.focus));
    frameData.set([w, h, pixels, within], 20);
    frameData.set([look.dim, far - 1.5, 0, look.fibre], 24);
    const widest = h * 0.022;
    const focus = Math.max(0.5, far - look.focus);
    // opened less the closer it is, or there would be nothing but blur
    frameData.set([t * Math.PI * 2, look.lens * (far / 4.6) ** 0.75, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);

    // ---- where everything is
    const eye = camera.position.toArray() as [number, number, number];
    const inner = PLACES.map((_, b) => glow(t + 0.31 * b, look.mode, look.flicker));
    // with light inside, the room is darker
    const room = 1 - 0.55 * Math.min(1, Math.max(...inner));
    const list = Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      // they stand in the room, as the camera first sees it: the camera goes by them
      const dir = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
      const m = 1;
      return { dir: dir.map((v) => v / m) as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power * room) as Lamp["colour"] };
    });
    /** lamps as wide as softboxes: each the mean of several, the last layer being linear in them */
    const RING = 7;
    const wideLamps = (fold: (l: Lamp[]) => Float32Array, back: (v: number[]) => Lamp["dir"]) => {
      let sum: Float32Array | undefined;
      for (let q = 0; q < RING; q++) {
        const part = fold(
          list.map((l) => {
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
    const cluster = clusterAt(t, look.sway);
    const turnBy = (v: number[]) => [0, 1, 2].map((k) => cluster.R[k * 3] * v[0] + cluster.R[k * 3 + 1] * v[1] + cluster.R[k * 3 + 2] * v[2] + cluster.t[k]);
    const hung: Pose[] = PLACES.map((c) => {
      const S = standing(c);
      const R: number[] = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R.push(cluster.R[i * 3] * S[j] + cluster.R[i * 3 + 1] * S[3 + j] + cluster.R[i * 3 + 2] * S[6 + j]);
      return { R, t: turnBy(c.at) };
    });
    BODIES.forEach((b) => {
      const m = b.world ? cluster : hung[b.of];
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      b.d = b.world ? Math.hypot(...eye.map((x, k) => x - controls.target.getComponent(k))) : Math.hypot(...m.t.map((x, q) => x - eye[q]));
      const data = new Float32Array(52);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      const ids = new Uint32Array(data.buffer);
      ids.set([0, b.world ? 0 : b.of, 0, 0], 16);
      ids.fill(99, 20, 40);
      // who may stand in its light: the others (and all of them, of the net)
      ids.set(PLACES.map((_, j) => j).filter((j) => b.world || j !== b.of), 20);
      if (!b.world) {
        const { lamp, pupa, spine } = inside(m.R, t + 0.31 * b.of, look.pupa);
        data.set([...lamp, look.ambient, ...pupa, ...spine, look.through], 40);
      }
      device.queue.writeBuffer(b.buffer, 0, data.buffer as ArrayBuffer, 0, 208);
      if (b.world) device.queue.writeBuffer(strandBuffer, 0, wideLamps((l) => foldLamps(strandHead, "strand", l), back));
      else {
        const tint = [1, 0.62, 0.3].map((c) => c * inner[b.of] * look.inside) as [number, number, number];
        for (const name of names) device.queue.writeBuffer(nets[name].buffers[b.of], 0, wideLamps((l) => foldHero(head, name, l, tint), back));
      }
    });
    const shade = new Float32Array((4 + 24 * 3 + 6 + 3 + 1) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.10 + 0.5 * look.wide, look.glint, look.bounce], 12);
    const ball = head.cocoons[0];
    hung.forEach((m, i) => {
      shade[(4 + 24 * 3) * 4 + i] = 1;
      [ball.A, ball.B, ball.B].forEach((size, r) => {
        const w = [0, 1, 2].map((k) => m.R[k * 3 + r] / (size * 0.97));
        shade.set([...w, -(w[0] * m.t[0] + w[1] * m.t[1] + w[2] * m.t[2])], 16 + i * 12 + r * 4);
      });
    });
    list.forEach((l, n) => shade.set([...l.colour, 0], (4 + 24 * 3 + 6 + n) * 4));
    shade.set([...[1, 0.62, 0.3].map((c) => c * Math.max(...inner) * look.inside), look.strand], (4 + 24 * 3 + 6 + 3) * 4);
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    // as many hairs as come out about a pixel wide
    for (const k of sets) {
      const b = BODIES[k.body];
      const each = (2 * head.kinds[k.kind].radius * look.fibre * pixels) / Math.max(0.8, b.d - 0.6);
      const part = k.name === "wound" || k.name === "down" ? Math.ceil(Math.min(1, Math.max(0.25, each / 0.75)) * 32) / 32 : 1;
      k.now.n = Math.ceil(k.n * part);
      k.data[1] = k.now.n;
      k.data[2] = k.now.points;
      k.data[6] = k.now.n * k.now.points;
      new Float32Array(k.data.buffer)[14] = k.name === "thread" ? look.web : 1 / part;
      device.queue.writeBuffer(k.buffer, 0, k.data);
    }
    // which are in view; the nearest is lit every frame, the others every other (the camera goes slowly)
    const nearest = PLACES.map((_, i) => i).sort((p, q) => BODIES[p].d - BODIES[q].d)[0];
    BODIES.forEach((b, i) => {
      if (!b.world) {
        const c = new Vector3(...hung[i].t).applyMatrix4(viewProj);
        const r = (1.25 * pixels) / Math.max(0.3, b.d) / (h / 2);
        b.seen = Math.abs(c.x) < 1 + r * (h / w) && Math.abs(c.y) < 1 + r && b.d > 0.4;
      }
      b.now = b.seen && (b.world || i === nearest || !look.thrift || state.frame < 3 || (state.frame + i) % 2 === 0);
    });
    glazes.forEach((g, i) => {
      // about as fine as the screen
      const size = (2 * pixels) / Math.max(0.8, BODIES[i].d - 0.6);
      g.w = size > 1600 ? FINE : size > 900 ? 1536 : size > 450 ? 1024 : 512;
      const gd = new DataView(new ArrayBuffer(16));
      [g.w, g.w / 2, i].forEach((x, k) => gd.setUint32(k * 4, x, true));
      gd.setFloat32(12, Math.log2(2048 / g.w), true);
      device.queue.writeBuffer(g.info, 0, gd.buffer);
    });
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(fieldPipe);
    fieldGroups.forEach((g, i) => {
      if (!BODIES[i].now) return;
      cp.setBindGroup(0, bases[i]);
      cp.setBindGroup(1, g);
      cp.dispatchWorkgroups(FIELD_W / 8, FIELD_H / 8);
    });
    if (look.shells) {
      cp.setPipeline(glazePipe);
      glazes.forEach((g, i) => {
        if (!BODIES[i].now) return;
        cp.setBindGroup(0, bases[i]);
        cp.setBindGroup(1, g.group);
        cp.setBindGroup(2, g.head);
        cp.dispatchWorkgroups(Math.ceil((g.w + 1) / 8), g.w / 16);
      });
    }
    cp.setPipeline(veilPipe);
    for (const k of sets) {
      if (!look[k.name] || !BODIES[k.body].now) continue;
      cp.setBindGroup(0, bases[k.body]);
      cp.setBindGroup(1, k.veil);
      cp.dispatchWorkgroups(Math.ceil((k.now.n * k.veilsEach) / 64));
    }
    for (const k of sets) {
      if (!look[k.name] || !BODIES[k.body].now) continue;
      cp.setPipeline(k.pipe);
      k.groups.forEach((g, i) => cp.setBindGroup(i, g));
      cp.dispatchWorkgroups(Math.ceil((k.now.n * k.now.points) / 64));
    }
    cp.end();

    {
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
        const order = PLACES.map((_, i) => i).filter((i) => BODIES[i].seen).sort((p, q) => BODIES[p].d - BODIES[q].d);
        for (const i of order) {
          pass.setBindGroup(0, bases[i]);
          pass.setBindGroup(1, shellGroups[i]);
          pass.drawIndexed(index.length, 1, 0, 0, 0);
        }
      }
      pass.setPipeline(fibrePipe);
      for (const k of sets) {
        if (!look[k.name] || !BODIES[k.body].seen) continue;
        // a ribbon for every eight pixels or so
        const split = Math.max(1, Math.min(6, Math.round((k.step * pixels) / Math.max(0.7, BODIES[k.body].d - 0.6) / 7)));
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
    {
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

  // (tools/perf.mjs BENCH=1: so many frames back to back, the card kept busy, at time t)
  const bench = (n: number, t: number) => {
    const was = state.hold;
    state.hold = t;
    for (let i = 0; i < n; i++) wrap.render?.({ playhead: t } as never);
    state.hold = was;
  };
  Object.assign(window, { __cocoon: { bench, look, lamps, state, home, camera, controls, device, DURATION } });

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
