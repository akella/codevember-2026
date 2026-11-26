/**
 * One cocoon close up: 87 thousand fibres, learnt on its own (bake/hero.py). It turns on its thread; light comes up in
 * it, and what is inside stirs.
 */
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Matrix4, PerspectiveCamera, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { frameCap } from "../cap";
import common from "../rain/common.wgsl?raw";
import fibreCode from "../rain/fibre.wgsl?raw";
import { HERO, load, type HeroHead, type HeroKind } from "./load";
import { makeRelief } from "../relief";
import type { Head } from "../load";
import { foldLamps, netCode, type Lamp } from "../net";
import { foldHero, heroCode } from "./net";
import lensCode from "../rain/lens.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeFree from "../shade-free.wgsl?raw";
import shadeOn from "../rain/shade-on.wgsl?raw";
import shadeCode from "../rain/shade.wgsl?raw";
import shellCode from "../rain/shell.wgsl?raw";
import glazeCode from "../rain/glaze.wgsl?raw";
import fieldCode from "./field.wgsl?raw";
import { DURATION, STANDING, glow, inside, lineAt, makeWeb, type Pose } from "./hang";
import veilCode from "../rain/veil.wgsl?raw";
import shadeStrand from "../rain/shade-strand.wgsl?raw";
import { depth as deep } from "../rain/depth";
import { nearLens } from "../rain/near-lens";

const FAR = 5.7;
type KindName = HeroKind | "thread";
const KINDS = [...HERO, "thread"] as const;
/** the field's grid, over the cocoon */
const [FIELD_W, FIELD_H] = [512, 256];

// ---- the shaders, as rain.html's, changed here and there
const commonCode = deep
  .common(common)
  .replace("box: vec4f, lamp", "lamp")
  .replace("colours: array<vec4f, 3> }", "colours: array<vec4f, 3>, tint: vec4f }") + `
fn warmed(f: f32) -> vec3f { let g = max(f, 0.0); return g * vec3f(1.0, pow(g + 0.02, 0.17), pow(g + 0.02, 0.42)); }
`;
const onText = `if (sight(p, 0.03) != 0u && sight(points[row + pointOf(max(j, 1u) - 1u)].xyz, 0.03) != 0u && sight(points[row + pointOf(min(j + 1u, kind.points - 1u))].xyz, 0.03) != 0u) { return; }
  ` + shadeOn.replace(
  "let c = shaded(run_on(&x), veilAt(i, t));",
  `let field = textureSampleLevel(fieldTex, around, uv, 0, 0.0);
  let L = run_on(&x);
  let c = shaded(L.lamps, field.rgb) + glints(tangent, view, normal, 1.0, i, t, field.rgb) + L.inner * warmed(field.a);`,
);
const freeText = shadeFree.replace("let c = run_free(&x);", `let L = run_free(&x);
  let c = shaded(L.lamps, vec3f(1.0)) + glints(tangent, view, view, 0.0, i, t, vec3f(1.0)) + L.inner * 0.75;`);
const strandText = shadeStrand.replace(
  "let c = shaded(run_strand(&x), veilAt(i, t));",
  `let vv = veilAt(i, t);
  let here = length(p);
  let c = shaded(run_strand(&x), vv) + glints(tangent, view, view, 0.0, i, t, vv) + shadow.tint.rgb * 0.5 / max(here * here, 0.7);`,
);
/**
 * What is shaded: of the on-shell fibres none that lie off the picture or behind the shell, with its stretches on both
 * sides. The shell is drawn at half size first, how far it is (seen, group 3), with this frame's camera: what is skipped
 * is never in sight.
 */
const SEEN = `
@group(3) @binding(0) var seenTex: texture_2d<f32>;
// why a place (of the body's frame) is out of the picture: 1 behind the shell, 2 to 16 off one side or another, 32 behind
// the eye; 0, in it
fn sight(p: vec3f, margin: f32) -> u32 {
  let c = frame.viewProj * vec4f(place(p), 1.0);
  if (c.w < 0.05) { return 32u; }
  let q = c.xy / c.w;
  let off = select(0u, 2u, q.x < -1.12) | select(0u, 4u, q.x > 1.12) | select(0u, 8u, q.y < -1.12) | select(0u, 16u, q.y > 1.12);
  if (off != 0u) { return off; }
  let size = vec2i(textureDimensions(seenTex));
  let px = vec2i(floor((q * vec2f(0.5, -0.5) + 0.5) * vec2f(size) - 0.5));
  var deepest = 0.0;
  for (var k = 0; k < 4; k++) { deepest = max(deepest, textureLoad(seenTex, clamp(px + vec2i(k & 1, k >> 1), vec2i(0), size - 1), 0).x); }
  return select(0u, 1u, c.w > deepest + margin);
}
`;
const onCode_ = SEEN + shadeCode.replace("@group(1) @binding(9)", "@group(1) @binding(10) var fieldTex: texture_2d_array<f32>;\n@group(1) @binding(9)");
const glazeText = SEEN + glazeCode
  .replace("@compute", "@group(1) @binding(6) var fieldTex: texture_2d_array<f32>;\nvar<workgroup> away: array<u32, 4>;\n@compute")
  // a tile all of whose corners are out of sight for one reason
  .replace(
    "    corner[k0] = veil(o * radial(shapes[body.id.x], o));",
    `    let s_ = shapes[body.id.x];
    corner[k0] = veil(o * radial(s_, o));
    away[k0] = sight(s_.centre.xyz + (s_.x.xyz * o.x + s_.y.xyz * o.y + s_.z.xyz * o.z) * radial(s_, o), 0.06);`,
  )
  .replace("  workgroupBarrier();\n", "  workgroupBarrier();\n  if ((away[0] & away[1] & away[2] & away[3]) != 0u) { return; }\n")
  .replace("  textureStore(lightTex", `  let fieldAt = textureSampleLevel(fieldTex, around, uv, 0, 0.0);
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
  /** light inside: comes and goes; always; never */
  mode: "breathe" as "breathe" | "lantern" | "day",
  exposure: 1.15,
  gamma: 1,
  bloom: 0.035,
  spread: 0.95,
  fibre: 1,
  /** contrast among neighbouring strands, put back */
  crisp: 0.5,
  /** how wide the lens opens (half a cocoon is 1), and how far before the middle of the view it is focused */
  lens: 0.09,
  focus: 0.5,
  /** how far before and behind the focus everything is quite sharp */
  sharp: 0.22,
  /** how far the air moves loose silk */
  air: 0.006,
  sway: 1,
  /** the light inside, how it flickers, and what of it has no direction */
  inside: 0.62,
  flicker: 1,
  ambient: 0.10,
  /** the pupa: how large, and how far it shows through the silk right before it */
  pupa: 0.9,
  through: 0.55,
  /** light off the strands' skin */
  glint: 0.35,
  web: 0.4,
  dim: 0,
  shadow: 0.8,
  /** fibres shaded every other frame, by turns */
  turns: true,
  /** what is off the picture or behind the shell not shaded */
  cull: true,
  shells: true,
  wound: true,
  fuzz: true,
  down: true,
  floss: true,
  thread: true,
};

/** azimuth from the camera's side (0 in front, 180 behind), elevation, power (1 makes a facing wall white) */
const lamps = {
  key: { azimuth: -70, elevation: 36, power: 0.8, colour: "#eef1ff" },
  back: { azimuth: 150, elevation: 14, power: 1.0, colour: "#ffd9b0" },
  rim: { azimuth: -146, elevation: 20, power: 0.75, colour: "#d8e2ff" },
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

  // ?data=macro draws the studio cocoon's weights here, so tools/truth.mjs can set it beside its Cycles test views
  const cocoon = await load(`./${new URLSearchParams(location.search).get("data") ?? "hero"}/`);
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
  const BODIES = [0, 1].map((b) => ({ id: 0, world: b === 1, buffer: buffer(208, UNIFORM), d: 0 }));

  // the still strands' points, and after them the threads', as they hang and as they are
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const webs = makeWeb(head.cocoons[0], F.radius);
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
      return [name, { ...code, buffer: buffer(code.head * 16, UNIFORM) }];
    }),
  ) as Record<(typeof names)[number], { code: string; head: number; buffer: GPUBuffer }>;
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
    seen: device.createBindGroupLayout({ entries: [{ binding: 0, visibility: COMPUTE, texture: { sampleType: "unfilterable-float" } }] }),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const noTextures = (code: string) => code.replace(/@group\(1\) @binding\((?:[6789]|10)\).*\n/g, "");
  const shadePipes = {
    on: await compute(pipeLayout(L.base, L.on, L.head, L.seen), commonCode + nets.on.code + onCode_.replace("SHADE", onText)),
    free: await compute(pipeLayout(L.base, L.free, L.head), commonCode + nets.free.code + noTextures(shadeCode.replace("SHADE", freeText))),
    strand: await compute(pipeLayout(L.base, L.free, L.head), commonCode + strandNet.code + noTextures(shadeCode.replace("SHADE", strandText))),
  };
  const veilPipe = await compute(pipeLayout(L.base, L.veil), commonCode + veilCode);
  const fieldPipe = await compute(pipeLayout(L.base, L.field), commonCode + fieldCode);
  const glazePipe = await compute(pipeLayout(L.base, L.glaze, L.head, L.seen), commonCode + nets.shell.code + glazeText);
  const shellModule = module(
    commonCode + shellCode + "\n@fragment\nfn far_(@builtin(position) at: vec4f) -> @location(0) vec4f { return vec4f(1.0 / at.w, 0.0, 0.0, 1.0); }\n",
  );
  // how far the shell is, at half size, before anything is shaded
  const SEEN_FORMAT = "r32float" as const;
  const seenPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell),
    vertex: { module: shellModule },
    fragment: { module: shellModule, entryPoint: "far_", targets: [{ format: SEEN_FORMAT }] },
    primitive: { cullMode: "back" },
    depthStencil: depth(true),
  });
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
  for (const name of HERO) {
    const k = head.kinds[name];
    plans.push({ name, kind: name, body: 0, first: cocoon.first[name], n: k.n, points: k.points, map: owned(count(k.n)) });
  }
  const zeros = owned(Array(Math.max(...webs.map((w) => w.n))).fill(0));
  webs.forEach((w, i) => plans.push({ name: "thread", kind: "floss", body: 1, first: webFirst[i], n: w.n, points: w.points, map: zeros }));
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE);
  // at how many places along each the shadows are worked out
  const veilsOf = (k: HeroKind) => (head.kinds[k].on ? 3 : 6);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p.kind)) - p.n * veilsOf(p.kind));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);
  const fieldTexture = device.createTexture({ size: [FIELD_W, FIELD_H, 1], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const fieldView = fieldTexture.createView({ dimension: "2d-array" });
  const fieldGroup = bind(L.field, [fieldView, of(buffer(new Uint32Array([FIELD_W, FIELD_H, 0, 1]), UNIFORM))]);

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(64, UNIFORM);
    const data = new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, 0, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p.kind), p.points, 1, 0, 0]);
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
    // shaded by turns, the first half of the fibres and then the rest: each half as a kind of its own, so that the
    // shader is as it was and only the numbers it is given differ
    const halves = [0, 1].map(() => buffer(64, UNIFORM));
    const shadeGroup = (kb: GPUBuffer) => (k.on ? bind(L.on, [of(kb), ...shared.slice(1), coarse, fine, around, detail, fieldView]) : bind(L.free, [of(kb), ...shared.slice(1)]));
    return {
      ...p,
      pipe: shadePipes[p.name === "thread" ? "strand" : k.on ? "on" : "free"],
      halves,
      halfGroups: halves.map(shadeGroup),
      groups: [bases[p.body], shadeGroup(b), bind(L.head, [of(p.name === "thread" ? strandBuffer : nets[k.on ? "on" : "free"].buffer)])],
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

  // the shells' light, on a grid over each: so fine, and this much of it. (As fine as what the network is given, fine.avif:
  // at 2048 it was 3.3 ms more and the same to 61 dB close up.)
  const FINE = 1024;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, 1], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeView = glazeTexture.createView({ dimension: "2d-array" });
  const glazeInfo = buffer(16, UNIFORM);
  const glazeGroup = bind(L.glaze, [coarse, fine, around, detail, glazeView, of(glazeInfo), fieldView]);
  const shellHead = bind(L.head, [of(nets.shell.buffer)]);

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
  const shellGroup = bind(L.shell, [of(relief), of(gridBuffer), glazeView, plain, of(glazeInfo)]);

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
    const [sw, sh] = [Math.max(8, w >> 1), Math.max(8, h >> 1)];
    const seen = device.createTexture({ size: [sw, sh], format: SEEN_FORMAT, usage: RENDER_ATTACHMENT | TEXTURE_BINDING });
    const seenDeep = device.createTexture({ size: [sw, sh], format: "depth24plus", usage: RENDER_ATTACHMENT });
    return {
      w,
      h,
      seen: seen.createView(),
      seenDeep: seenDeep.createView(),
      seenGroup: bind(L.seen, [seen.createView()]),
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
      drop: () => [color, soft, sharp, blurs, small, spread, deep, flat, seen, seenDeep, ...glows].forEach((t) => t.destroy()),
    };
  };
  let targets: Targets | undefined;

  // ---------------------------------------------------------------- camera and controls

  const camera = new PerspectiveCamera(head.fov, width / height, 0.2, 40);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 1.35;
  controls.maxDistance = 9;
  const home = (az = 0, el = 3, dist = FAR, target: [number, number, number] = [0, 0.16, 0]) => {
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
  picture.add(look, "mode", ["breathe", "lantern", "day"]);
  const range: [keyof typeof look, number, number][] = [["exposure", 0.1, 4], ["gamma", 0.6, 1.6], ["bloom", 0, 0.4], ["fibre", 0.3, 3], ["crisp", 0, 3], ["lens", 0, 0.6], ["focus", -1, 1.5], ["sharp", 0, 2], ["air", 0, 0.04], ["sway", 0, 2], ["inside", 0, 5], ["flicker", 0, 3], ["ambient", 0, 1], ["pupa", 0.3, 1.2], ["through", 0, 0.9], ["glint", 0, 3], ["web", 0.2, 2]];
  for (const [k, a, b] of range) picture.add(look as unknown as Record<string, number>, k, a, b);
  for (const [name, l] of Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`);
    f.add(l, "azimuth", -180, 180);
    f.add(l, "elevation", -36, 80);
    f.add(l, "power", 0, 6);
    f.addColor(l, "colour");
  }
  const parts = gui.addFolder("parts").close();
  for (const k of ["turns", "cull", "shells", ...KINDS] as const) parts.add(look, k);

  // ---------------------------------------------------------------- a frame

  // how long the passes take the card (tools/perf.mjs asks)
  const times = timed ? { set: device.createQuerySet({ type: "timestamp", count: 8 }), raw: device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) } : undefined;
  const stamp = (i: number) => (times && state.time ? { querySet: times.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } : undefined);
  const state = { hold: undefined as number | undefined, frame: 0, ms: 0, exact: undefined as { which?: number; lights: Lamp[] } | Lamp[] | undefined, time: undefined as ((ms: Record<string, number>) => void) | undefined };
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
    // (for tools/truth.mjs: as it was learnt, alone in its own frame, nothing in it, under the view's lamps)
    const exact = state.exact ? (Array.isArray(state.exact) ? state.exact : state.exact.lights).slice(0, 3) : undefined;
    const inner = exact ? 0 : glow(t, look.mode, look.flicker);
    // with light inside, the room is darker
    const room = 1 - 0.55 * Math.min(1, inner);
    const list = exact ?? Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power * room) as Lamp["colour"] };
    });
    const tint = [1, 0.60, 0.27].map((c) => c * inner * look.inside) as [number, number, number];
    const line = lineAt(t, look.sway);
    const R: number[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R.push(line.R[i * 3] * STANDING[j] + line.R[i * 3 + 1] * STANDING[3 + j] + line.R[i * 3 + 2] * STANDING[6 + j]);
    const cocoonPose: Pose = exact ? { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] } : { R, t: line.t };
    if (exact) R.splice(0, 9, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    BODIES.forEach((b) => {
      const m = b.world ? line : cocoonPose;
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      b.d = Math.hypot(...m.t.map((x, q) => x - eye[q]));
      const data = new Float32Array(52);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      const ids = new Uint32Array(data.buffer);
      ids.fill(99, 20, 40);
      // the web may have the cocoon in its light
      ids.set(b.world ? [0] : [99], 20);
      if (!b.world) {
        const { lamp, pupa, spine } = inside(R, t, exact ? 0.02 : look.pupa);
        data.set([...lamp, look.ambient, ...pupa, ...spine, exact ? 0 : look.through], 40);
      }
      device.queue.writeBuffer(b.buffer, 0, data.buffer as ArrayBuffer, 0, 208);
      const turned = list.map((l) => ({ dir: back(l.dir), colour: l.colour }));
      if (b.world) device.queue.writeBuffer(strandBuffer, 0, foldLamps(strandHead, "strand", turned));
      else for (const name of names) device.queue.writeBuffer(nets[name].buffer, 0, foldHero(head, name, turned, tint));
    });
    const shade = new Float32Array((4 + 24 * 3 + 6 + 3 + 1) * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.12, look.glint, 0], 12);
    shade[(4 + 24 * 3) * 4] = 1;
    const ball = head.cocoons[0];
    [ball.A, ball.B, ball.B].forEach((size, r) => {
      const w = [0, 1, 2].map((k) => R[k * 3 + r] / (size * 0.97));
      shade.set([...w, -(w[0] * line.t[0] + w[1] * line.t[1] + w[2] * line.t[2])], 16 + r * 4);
    });
    list.forEach((l, n) => shade.set([...l.colour, 0], (4 + 24 * 3 + 6 + n) * 4));
    shade.set(tint, (4 + 24 * 3 + 6 + 3) * 4);
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
      const a = Math.ceil(k.now.n / 2);
      k.halves.forEach((hb, h) => {
        const [from, m, d] = [h ? a : 0, h ? k.now.n - a : a, k.data.slice()];
        d[0] += from * d[12];
        d[1] = m;
        d[6] = m * k.now.points;
        d[7] += from * k.now.points;
        d[8] += from;
        d[10] += from * d[11];
        device.queue.writeBuffer(hb, 0, d);
      });
    }
    const gd = new DataView(new ArrayBuffer(16));
    [FINE, FINE / 2, 0].forEach((x, k) => gd.setUint32(k * 4, x, true));
    device.queue.writeBuffer(glazeInfo, 0, gd.buffer);
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    {
      const pass = encoder.beginRenderPass({
        timestampWrites: stamp(3),
        colorAttachments: [{ view: targets.seen, loadOp: "clear", storeOp: "store", clearValue: [6e4, 0, 0, 0] }],
        depthStencilAttachment: { view: targets.seenDeep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
      });
      // (with cull off, nothing is behind it)
      if (look.shells && look.cull) {
        pass.setPipeline(seenPipe);
        pass.setIndexBuffer(indexBuffer, "uint32");
        pass.setBindGroup(0, bases[0]);
        pass.setBindGroup(1, shellGroup);
        pass.drawIndexed(index.length, 1, 0, 0, 0);
      }
      pass.end();
    }
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(fieldPipe);
    cp.setBindGroup(0, bases[0]);
    cp.setBindGroup(1, fieldGroup);
    cp.dispatchWorkgroups(FIELD_W / 8, FIELD_H / 8);
    if (look.shells) {
      cp.setPipeline(glazePipe);
      cp.setBindGroup(0, bases[0]);
      cp.setBindGroup(1, glazeGroup);
      cp.setBindGroup(2, shellHead);
      cp.setBindGroup(3, targets.seenGroup);
      cp.dispatchWorkgroups(Math.ceil((FINE + 1) / 8), FINE / 16);
    }
    cp.setPipeline(veilPipe);
    for (const k of sets) {
      if (k.name !== "thread" || !look.thread) continue;
      cp.setBindGroup(0, bases[k.body]);
      cp.setBindGroup(1, k.veil);
      cp.dispatchWorkgroups(Math.ceil((k.now.n * veilsOf(k.kind)) / 64));
    }
    // every other fibre by turns; all of them at first, and for truth.mjs
    const turns = !look.turns || exact || state.frame < 2 ? [0, 1] : [state.frame & 1];
    for (const k of sets) {
      if (!look[k.name]) continue;
      cp.setPipeline(k.pipe);
      k.groups.forEach((g, i) => cp.setBindGroup(i, g));
      if (k.pipe === shadePipes.on) cp.setBindGroup(3, targets.seenGroup);
      for (const turn of turns) {
        cp.setBindGroup(1, k.halfGroups[turn]);
        cp.dispatchWorkgroups(Math.ceil((Math.ceil(k.now.n / 2) * k.now.points) / 64));
      }
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
      if (look.shells) {
        pass.setPipeline(shellPipe);
        pass.setIndexBuffer(indexBuffer, "uint32");
        pass.setBindGroup(0, bases[0]);
        pass.setBindGroup(1, shellGroup);
        pass.drawIndexed(index.length, 1, 0, 0, 0);
      }
      pass.setPipeline(fibrePipe);
      for (const k of sets) {
        if (!look[k.name]) continue;
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
    const back = time && times ? device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) : undefined;
    if (back && times) {
      encoder.resolveQuerySet(times.set, 0, 8, times.raw, 0);
      encoder.copyBufferToBuffer(times.raw, 0, back, 0, 64);
    }
    device.queue.submit([encoder.finish()]);
    back?.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigUint64Array(back.getMappedRange());
      const ms = (i: number) => Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
      time?.({ seen: ms(3), shade: ms(0), draw: ms(1), lens: ms(2) });
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
