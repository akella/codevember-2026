/**
 * index.html (the day's page; built as glow.html): rain.html again, close and few. Nine of the hero cocoon (bake/hero.py, learnt with the light inside it),
 * each let down on its thread, cream white; the light comes up in it, and when it is all aglow its web tears and it
 * falls (./life.ts). Three are where the lens is sharp, the others before and behind it, as soft as the lens makes them.
 *
 * What it costs is spent where it shows (as rain.html does, and more so): of a cocoon that is small, or blurred, so
 * many fewer hairs (each drawn the wider), points and places of its grid; and the blurred ones lit anew less often.
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
import { HERO, load, type HeroKind } from "../hero/load";
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
import cordCode from "../rain/cord.wgsl?raw";
import weaveCode from "../rain/weave.wgsl?raw";
import { inside } from "../hero/hang";
import { brightness } from "../rain/lantern";
import { OVER, TEARS, cordPoints } from "../rain/fall";
import type { Tear } from "../alone/tear";
import { COLUMNS, EYE, LIFE, aglow, high, where, type Pose } from "./life";
import veilCode from "../rain/veil.wgsl?raw";
import shadeStrand from "../rain/shade-strand.wgsl?raw";
import { depth as deep } from "../rain/depth";
import { nearLens } from "../rain/near-lens";

const DURATION = LIFE;
const N = COLUMNS.length;
type KindName = HeroKind | "thread";
const KINDS = [...HERO, "thread"] as const;
/** the field's grid, over the cocoon */
const [FIELD_W, FIELD_H] = [512, 256];
/** the warm of the light inside */
const INSIDE = [1, 0.6, 0.27];

// ---- the shaders, as macro.html's, changed here and there
const commonCode = deep
  .common(common)
  // the balls only stand in for the cocoons; what lies on one (its web, or another's fibres where they touch) is in its
  // shadow only where the lamp is behind its silk, not wherever it is a little inside the ball
  .replace(
    "  return (1.0 - smoothstep(1.0 - soft, 1.0 + soft, near)) * smoothstep(-0.15, 0.35, along);",
    `  let ball = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, near)) * smoothstep(-0.15, 0.35, along);
  let behind = smoothstep(0.05, -0.30, dot(normalize(q), w / l));
  return mix(ball, behind, smoothstep(1.14, 1.04, length(q)));`,
  )
  .replace("box: vec4f, lamp", "lamp")
  // (and how aglow each cocoon is, for its web)
  .replace("colours: array<vec4f, 3> }", "colours: array<vec4f, 3>, tint: vec4f, glows: array<vec4f, 2> }") + `
fn warmed(f: f32) -> vec3f { let g = max(f, 0.0); return g * vec3f(1.0, pow(g + 0.02, 0.17), pow(g + 0.02, 0.42)); }
`;
const onText = shadeOn.replace(
  "let c = shaded(run_on(&x), veilAt(i, t));",
  `let field = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);
  let L = run_on(&x);
  let vv = field.rgb * veilAt(i, t);
  let c = shaded(L.lamps, vv) + glints(tangent, view, normal, 1.0, i, t, vv);
  let cin = L.inner * warmed(field.a);`,
);
const freeText = shadeFree.replace("let c = run_free(&x);", `let L = run_free(&x);
  let vv = veilAt(i, t);
  let c = shaded(L.lamps, vv) + glints(tangent, view, view, 0.0, i, t, vv);
  let cin = L.inner * 0.75;`);
const strandText = shadeStrand.replace(
  "let c = shaded(run_strand(&x), veilAt(i, t));",
  `let vv = veilAt(i, t);
  let here = length(p);
  // strands learnt dimmer than this silk: lit up to it (shadow.tint.w)
  var c = shaded(run_strand(&x), vv) * shadow.tint.w + glints(tangent, view, view, 0.0, i, t, vv);
  // the network knows strands alone in the dark: near its cocoon (body.id.z) the silk lights them too, and its glow
  let o = body.id.z;
  let ball = shadow.now[o];
  let qb = vec3f(dot(ball.x.xyz, p) + ball.x.w, dot(ball.y.xyz, p) + ball.y.w, dot(ball.z.xyz, p) + ball.z.w);
  let nb = normalize(ball.x.xyz * qb.x + ball.y.xyz * qb.y + ball.z.xyz * qb.z);
  let near = exp(-max(length(qb) - 1.0, 0.0) * 3.5) * 0.5 * shadow.dark[o >> 2u][o & 3u];
  for (var l = 0u; l < 3u; l++) { c += shadow.colours[l].rgb * vv[l] * near * shadow.look.w * max(dot(nb, shadow.lamps[l].xyz) * 0.8 + 0.2, 0.0); }
  c += shadow.tint.rgb * shadow.glows[o >> 2u][o & 3u] * exp(-max(length(qb) - 1.0, 0.0) * 2.2) * 0.6;
  _ = here;`,
);
/** how aglow a cocoon is now, and how much of the light from outside comes to it (see `apart`) */
const GLOW_OF = "bitcast<f32>(body.lit[0].x)";
const ROOM_OF = "bitcast<f32>(body.lit[0].y)";
/**
 * The light along a fibre changes slowly: it is worked out at every `kind.rest`-th of the points it is drawn through
 * (and the last), and mixed between those. The shading has a kind of its own, with that stride.
 */
const lightCode = fibreCode.replace(
  `  let q = kind.lit + i * kind.points + j;
  let l = lit[q];
  let m = lit[q + 1u];
  o.light = mix(vec3f(unpack2x16float(l.x), unpack2x16float(l.y).x), vec3f(unpack2x16float(m.x), unpack2x16float(m.y).x), t);`,
  `  o.light = mix(lightAt(i, j), lightAt(i, j + 1u), t);`,
) + `
fn litAt(q: u32) -> vec3f {
  let l = lit[q];
  let g = glowLit[q];
  // (the light inside, as learnt, dips below nothing here and there: what is added up may not)
  return max(vec3f(unpack2x16float(l.x), unpack2x16float(l.y).x) * ${ROOM_OF} + vec3f(unpack2x16float(g.x), unpack2x16float(g.y).x) * ${GLOW_OF}, vec3f(0.0));
}
@group(1) @binding(4) var<storage, read> glowLit: array<vec2u>;
fn lightAt(i: u32, j: u32) -> vec3f {
  let every = max(kind.rest, 1u);
  let s = kind.stride * every;
  let lit_ = (kind.full - 1u + s - 1u) / s + 1u;
  let f = min(j * kind.stride, kind.full - 1u);
  let a = f / s;
  let b = min(a + 1u, lit_ - 1u);
  let fa = a * s;
  let fb = min(b * s, kind.full - 1u);
  let row = kind.lit + i * lit_;
  return mix(litAt(row + a), litAt(row + b), select(0.0, f32(f - fa) / f32(fb - fa), fb > fa));
}
`;
/**
 * The light from outside and the light inside, kept apart (lit, glowLit; and the shells' two grids): how much of each
 * there is now, a cocoon's glow and how far its room darkens (body.lit[0]), is put in as it is drawn, every frame. The
 * camera stands still, so one that hangs still need not be lit anew while its light comes and goes and flickers.
 */
const apart = (code: string, binding: number) =>
  code.replace(
    "  lit[kind.lit + at] = vec2u(pack2x16float(min(c.rg, vec2f(200.0))), pack2x16float(vec2f(min(c.b, 200.0), 0.0)));",
    `  lit[kind.lit + at] = vec2u(pack2x16float(min(c.rg, vec2f(200.0))), pack2x16float(vec2f(min(c.b, 200.0), 0.0)));
  glowLit[kind.lit + at] = vec2u(pack2x16float(min(cin.rg, vec2f(200.0))), pack2x16float(vec2f(min(cin.b, 200.0), 0.0)));`,
  ) + `\n@group(1) @binding(${binding}) var<storage, read_write> glowLit: array<vec2u>;\n`;
const onCode_ = shadeCode.replace("@group(1) @binding(9)", "@group(1) @binding(10) var fieldTex: texture_2d_array<f32>;\n@group(1) @binding(9)");
const glazeText = glazeCode
  .replace("@compute", "@group(1) @binding(6) var fieldTex: texture_2d_array<f32>;\n@compute")
  .replace("  textureStore(lightTex", `  let fieldAt = textureSampleLevel(fieldTex, around, uv, body.id.y, 0.0);
  let L = run_shell(&x);
  let lin = normalize(body.lamp.xyz - p);
  let crease = mix(1.0, clamp((dot(-normal, lin) + 0.3) / (dot(-d, lin) + 0.3), 0.35, 1.9), 0.75 * smoothstep(-0.2, 0.2, dot(-d, lin)));
  textureStore(lightTex`)
  .replace(
    "textureStore(lightTex, id.xy, glaze.layer, vec4f(min(shaded(run_shell(&x), shade), vec3f(200.0)), 1.0));",
    `textureStore(lightTex, id.xy, glaze.layer, vec4f(sane(shaded(L.lamps, shade * fieldAt.rgb)), 1.0));
  textureStore(innerTex, id.xy, glaze.layer, vec4f(sane(L.inner * warmed(fieldAt.a * crease)), 1.0));`,
  )
  .replace("@compute", "@group(1) @binding(7) var innerTex: texture_storage_2d_array<rgba16float, write>;\n// (what is not a number, or below nothing, is nothing)\nfn sane(v: vec3f) -> vec3f { return select(clamp(v, vec3f(0.0), vec3f(200.0)), vec3f(0.0), v != v); }\n@compute");
const shellText = shellCode
  .replace("textureSampleLevel(lightTex, smp, at, glaze.layer, 0.0).rgb * dimmed(o.clip.w)", `max(textureSampleLevel(lightTex, smp, at, glaze.layer, 0.0).rgb * ${ROOM_OF} + textureSampleLevel(innerTex, smp, at, glaze.layer, 0.0).rgb * ${GLOW_OF}, vec3f(0.0)) * dimmed(o.clip.w)`)
  .replace("@vertex", "@group(1) @binding(5) var innerTex: texture_2d_array<f32>;\n@vertex");
/** the relief has a finer grid, and finer felt (bake/hero.py) */
const finer = (code: string) =>
  code
    .replace("const NU = 1536u;", "const NU = 3072u;")
    .replace("const NV = 768u;", "const NV = 1536u;")
    .replace("const SIGMA = 11.0;", "const SIGMA = 22.0;")
    .replaceAll("var k = -33; k <= 33;", "var k = -66; k <= 66;")
    .replace("+ 0.0011 * felt;", "+ 0.0011 * felt + 0.00045 * noise(p / 0.0066, 771u) + 0.0011 * abs(noise(p / 0.019, 772u)) - 0.0004;")
    .replace("sum / 18.0 - 0.0015", "sum / 18.0 - 0.0012");

const SAMPLES = +(new URLSearchParams(location.search).get("msaa") ?? 4);
const GLOWS = 6;
const AIR = { wound: 0, fuzz: 0.5, down: 0.3, floss: 1, thread: 0.7 };
/** how wide (pixels, times look.hair) each kind's hairs may be drawn, fewer of them: the down is short, and a haze */
const HAIR = { wound: 1.3, fuzz: 1.3, down: 1.6, floss: 1, thread: 1 };
const bits = new DataView(new ArrayBuffer(4));
const airy = (x: number) => (bits.setFloat32(0, x), bits.getUint32(0));

const look = {
  /** fewer hairs, points and grid where the lens blurs them, and those lit anew less often */
  thrift: true,
  /** the light along a fibre worked out at fewer points than it is drawn through */
  coarse: true,
  /** the shells drawn through every other line of their grid (the relief is in the light on it) */
  rough: true,
  /** how long (pixels) a fibre's ribbons are, between two of its points: fewer of them, its curve less smooth */
  ribbon: 12,
  /** lit anew at once when it has turned this far (radians) since it last was */
  turn: 0.03,
  exposure: 1.15,
  gamma: 1,
  bloom: 0.035,
  spread: 0.95,
  fibre: 1,
  /** how wide the hairs may be drawn (pixels, times HAIR): fewer of them, as much silk */
  hair: 1,
  /** contrast among neighbouring strands, put back */
  crisp: 0.5,
  /** how wide the lens opens (half a cocoon is 1), and how far before the middle of the view it is focused */
  lens: 0.11,
  focus: 0.1,
  /** how far before and behind the focus everything is quite sharp */
  sharp: 0.9,
  /** how far the air moves loose silk */
  air: 0.006,
  sway: 1,
  /** the light inside, how it flickers, and what of it has no direction */
  inside: 1.1,
  /** how much less it is lit from outside when aglow */
  room: 0.65,
  flicker: 1,
  ambient: 0.1,
  /** the pupa: how large, and how far it shows through the silk right before it */
  pupa: 0.9,
  through: 0.3,
  /** light off the strands' skin */
  glint: 0.35,
  /** how thick the web's strands are drawn; what the cocoons throw back on them; how much brighter than learnt */
  web: 0.55,
  bounce: 1,
  strand: 1.2,
  frizz: 1,
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

  const cocoon = await load("./hero/");
  const { head } = cocoon;
  const shape = head.cocoons[0];
  // how each of the four webs tears, worked out at the start (as rain.html's, round this cocoon)
  const tears = await Promise.all(
    TEARS.map(
      (options) =>
        new Promise<Tear>((done) => {
          const worker = new Worker(new URL("../alone/tear.worker.ts", import.meta.url), { type: "module" });
          worker.onmessage = ({ data }) => {
            worker.terminate();
            done(data);
          };
          worker.postMessage({ shape: { A: shape.A, B: shape.B, p: shape.p }, options });
        }),
    ),
  );

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

  // what moves as one: the cocoons; and (their points are in the world already) each one's web and thread
  const BODIES = Array.from({ length: 2 * N }, (_, b) => ({ of: b % N, world: b >= N, buffer: buffer(208, UNIFORM), d: 0, blur: 0, seen: true, now: true, fresh: true, R: [] as number[] }));

  // the still strands' points; then the thread as it is made, and as each one's is; then the webs' strands
  const still = cocoon.points.length / 4;
  const F = head.kinds.floss;
  const cord = cordPoints(F.radius);
  const each = cord.data.length / 4;
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
      return [name, { ...code, buffers: COLUMNS.map(() => buffer(code.head * 16, UNIFORM)) }];
    }),
  ) as Record<(typeof names)[number], { code: string; head: number; buffers: GPUBuffer[] }>;
  const strandNet = netCode("strand", head.nets.strand, 2, 0, half, Object.keys(lamps).length);
  const strandHead = { ...head, lamp: head.strandLamp, tint: head.strandTint } as unknown as Head;
  const strandBuffer = buffer(strandNet.head * 16, UNIFORM);

  // ---------------------------------------------------------------- pipelines

  const module = (code: string) => device.createShaderModule({ code: code.includes("mat4x4h") ? "enable f16;\n" + code : code });
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
    on: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "texture", "texture", "sampler", "texture", "texture", "storage"]),
    free: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage", "read-only-storage", "read-only-storage", "storage"]),
    veil: layout(COMPUTE, ["uniform", "read-only-storage", "storage"]),
    head: layout(COMPUTE | FRAGMENT, ["uniform"]),
    fibre: layout(VERTEX, ["uniform", "read-only-storage", "read-only-storage", "uniform", "read-only-storage"]),
    shell: layout(VERTEX | FRAGMENT, ["read-only-storage", "uniform", "texture", "sampler", "uniform", "texture"]),
    glaze: layout(COMPUTE, ["texture", "texture", "sampler", "texture", "store", "uniform", "texture", "store"]),
    field: layout(COMPUTE, ["store", "uniform"]),
    cord: layout(COMPUTE, ["uniform", "storage"]),
    weave: layout(COMPUTE, ["uniform", "read-only-storage", "read-only-storage", "storage"]),
  };
  const compute = (l: GPUPipelineLayout, code: string) => device.createComputePipelineAsync({ layout: l, compute: { module: module(code), entryPoint: "main" } });
  const noTextures = (code: string) => code.replace(/@group\(1\) @binding\((?:[6789]|10)\).*\n/g, "");
  const unitOr = "fn unitOr(v: vec3f) -> vec3f { let l = length(v); return select(vec3f(0.0, 1.0, 0.0), v / max(l, 1e-20), l > 1e-9); }\n";
  const [on_, free_, strand_, veilPipe, fieldPipe, glazePipe, cordPipe, weavePipe] = await Promise.all([
    compute(pipeLayout(L.base, L.on, L.head), commonCode + nets.on.code + apart(onCode_.replace("SHADE", onText), 11)),
    compute(pipeLayout(L.base, L.free, L.head), commonCode + nets.free.code + apart(noTextures(shadeCode.replace("SHADE", freeText)), 6)),
    // where a strand curls tight, the points either side of one can be the same: its way is then nowhere (NaN, drawn black)
    compute(pipeLayout(L.base, L.free, L.head), commonCode + strandNet.code + unitOr + noTextures(shadeCode.replace("SHADE", strandText).replace("let tangent = normalize(", "let tangent = unitOr("))),
    compute(pipeLayout(L.base, L.veil), commonCode + veilCode),
    // the pupa's shadow in the light from behind: faint while it is cream white, darker as the light comes up in it
    compute(pipeLayout(L.base, L.field), commonCode + fieldCode.replace("1.0 - 0.8 * through", "1.0 - (0.2 + 0.4 * clamp(shadow.glows[body.id.y >> 2u][body.id.y & 3u] * 1.6, 0.0, 1.0)) * through")),
    compute(pipeLayout(L.base, L.glaze, L.head), commonCode + nets.shell.code + glazeText),
    compute(pipeLayout(L.cord), cordCode),
    compute(pipeLayout(L.weave), weaveCode),
  ]);
  const shadePipes = { on: on_, free: free_, strand: strand_ };
  const shellModule = module(commonCode + shellText);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.shell),
    vertex: { module: shellModule },
    fragment: { module: shellModule, entryPoint: "fragment", targets: [{ format: HDR }, { format: SOFT }] },
    primitive: { cullMode: "back" },
    depthStencil: depth(true),
    multisample: { count: SAMPLES },
  });
  const fibreModule = module(commonCode + lightCode);
  const fibrePipe = await device.createRenderPipelineAsync({
    layout: pipeLayout(L.base, L.fibre),
    vertex: { module: fibreModule },
    fragment: { module: fibreModule, targets: [{ format: HDR, blend: over }, { format: SOFT, blend: over }] },
    primitive: { topology: "triangle-strip" },
    depthStencil: depth(false),
    multisample: { count: SAMPLES },
  });
  const SHADOW = 4 + 24 * 3 + 6 + 3 + 1 + 2;
  const shadowBuffer = buffer(SHADOW * 16, UNIFORM);
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
  const zeros = owned(Array(Math.max(webN, cord.n)).fill(0));
  for (let i = 0; i < N; i++) {
    plans.push({ name: "thread", kind: "floss", body: N + i, first: webFirst + i * webN * WEB, n: webN, points: WEB, map: zeros });
    plans.push({ name: "thread", kind: "floss", body: N + i, first: cordFirst + i * each, n: cord.n, points: cord.points, map: zeros });
  }
  const litFirst = plans.map((p) => (litRoom += p.n * p.points) - p.n * p.points);
  const lit = buffer(litRoom * 8, STORAGE | GPUBufferUsage.COPY_SRC);
  const glowLit = buffer(litRoom * 8, STORAGE | GPUBufferUsage.COPY_SRC);
  // at how many places along each the shadows are worked out
  const veilsOf = (p: { name: string; kind: HeroKind; points: number }) => (p.name === "thread" ? Math.max(6, Math.ceil(p.points / 8)) : head.kinds[p.kind].on ? 3 : 6);
  let veilRoom = 0;
  const veilFirst = plans.map((p) => (veilRoom += p.n * veilsOf(p)) - p.n * veilsOf(p));
  const veils = buffer(veilRoom * 8, STORAGE);
  const ownerBuffer = buffer(new Uint32Array(owners), STORAGE);
  const fieldTexture = device.createTexture({ size: [FIELD_W, FIELD_H, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const fieldView = fieldTexture.createView({ dimension: "2d-array" });
  const fieldGroups = COLUMNS.map((_, b) => bind(L.field, [fieldView, of(buffer(new Uint32Array([FIELD_W, FIELD_H, b, 1]), UNIFORM))]));

  const sets = plans.map((p, q) => {
    const k = head.kinds[p.kind];
    const b = buffer(64, UNIFORM);
    const data = new Uint32Array([p.first, p.n, p.points, k.knots, cocoon.codeFirst[p.kind] / 4, k.own / 4, 0, litFirst[q], p.map, k.on ? 1 : 0, veilFirst[q], veilsOf(p), p.points, 1, 0, 0]);
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    let step = 0.03;
    if (p.name !== "thread") {
      step = 0;
      for (let i = 0; i < 200; i++) {
        const o = (p.first + Math.floor((i / 200) * Math.min(p.n, 60)) * p.points + 3) * 4;
        step += Math.hypot(...[0, 1, 2].map((c) => pointData[o + c] - pointData[o + 4 + c])) / 200;
      }
    }
    // (the kind it is shaded as: at fewer points)
    const light = buffer(64, UNIFORM);
    const shared = [of(light), of(points), of(codes), of(lit), of(ownerBuffer), of(veils)];
    return {
      ...p,
      pipe: shadePipes[p.name === "thread" ? "strand" : k.on ? "on" : "free"],
      groups: [bases[p.body], k.on ? bind(L.on, [...shared, coarse, fine, around, detail, fieldView, of(glowLit)]) : bind(L.free, [...shared, of(glowLit)]), bind(L.head, [of(p.name === "thread" ? strandBuffer : nets[k.on ? "on" : "free"].buffers[p.body])])],
      veil: bind(L.veil, [of(b), of(points), of(veils)]),
      veilsEach: veilsOf(p),
      data,
      buffer: b,
      light,
      // of the fibres so many, of their points so many: as it has pixels for; lit at every so many of those
      now: { n: p.n, points: p.points, stride: 1, every: 1 },
      draw: [bases[p.body], bind(L.fibre, [of(b), of(points), of(lit), of(splitBuffer), of(glowLit)])],
      step,
      splitBuffer,
    };
  });

  // the threads and the webs, made anew every frame (as rain.html's)
  const cordJobs = COLUMNS.map((_, i) => {
    const b = buffer(128, UNIFORM);
    return { buffer: b, group: bind(L.cord, [of(b), of(points)]), dispatch: Math.ceil(each / 64) };
  });
  const motions = tears.map((t) => ({ places: buffer(t.places, STORAGE), length: buffer(t.length, STORAGE) }));
  const weaves = COLUMNS.map((c) => {
    const b = buffer(160, UNIFORM);
    return { buffer: b, group: bind(L.weave, [of(b), of(motions[c.id].places), of(motions[c.id].length), of(points)]), dispatch: Math.ceil((webN * WEB) / 64) };
  });

  // the shells' light, on a grid over each: as fine as the screen, at most as fine as what the network is given
  const FINE = 1024;
  const glazeTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const glazeView = glazeTexture.createView({ dimension: "2d-array" });
  const innerTexture = device.createTexture({ size: [FINE + 1, FINE / 2, N], format: HDR, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const innerView = innerTexture.createView({ dimension: "2d-array" });
  const glazes = COLUMNS.map((_, b) => {
    const info = buffer(16, UNIFORM);
    return { w: FINE, info, group: bind(L.glaze, [coarse, fine, around, detail, glazeView, of(info), fieldView, innerView]), head: bind(L.head, [of(nets.shell.buffers[b])]) };
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
  // every other line of it, for what is small or blurred: the relief is in the light on the grid anyway
  const coarseIndex = new Uint32Array(((GU * GV) / 4) * 6);
  for (let v = 0, o = 0; v < GV; v += 2)
    for (let u = 0; u < GU; u += 2) {
      const [a, b, c, d] = [v * GU + u, v * GU + ((u + 2) % GU), (v + 2) * GU + u, (v + 2) * GU + ((u + 2) % GU)];
      coarseIndex.set([a, c, b, b, c, d], o);
      o += 6;
    }
  const coarseBuffer = buffer(coarseIndex, INDEX);
  const gridBuffer = buffer(new Uint8Array(gridData.buffer), UNIFORM);
  const shellGroups = glazes.map((g) => bind(L.shell, [of(relief), of(gridBuffer), glazeView, plain, of(g.info), innerView]));

  const postModule = module(postCode);
  const postBuffer = buffer(64, UNIFORM);
  const screenPipe = (entryPoint: string, target: GPUTextureFormat, blend?: GPUBlendState) =>
    device.createRenderPipeline({ layout: "auto", vertex: { module: postModule, entryPoint: "screen" }, fragment: { module: postModule, entryPoint, targets: [{ format: target, blend }] } });
  const add: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
  const downPipe = screenPipe("down", HDR);
  const upPipe = screenPipe("up", HDR, add);
  const finalPipe = screenPipe("final_", format);
  // small blurs at full size, and sharp hairs over blurred silk kept (../rain/near-lens.ts)
  // (64 taps, not 96: what is blurred here is blurred a lot, and smoothly)
  const lensModule = module(nearLens(lensCode).replace("const COUNT = 96;", `const COUNT = ${+(new URLSearchParams(location.search).get("taps") ?? 64)};`));
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

  const camera = new PerspectiveCamera(28, width / height, 0.2, 60);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 30;
  const home = (az = 0, el = 0, dist = EYE.dist, target: [number, number, number] = [0, EYE.y, 0]) => {
    const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
    controls.target.set(...target);
    camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(dist).add(controls.target);
    controls.update();
  };
  home();

  const stats = new Stats();
  stats.dom.id = "stats";
  document.body.appendChild(stats.dom);
  const gui = new GUI({ title: "cocoons" });
  const picture = gui.addFolder("picture");
  picture.add(look, "thrift");
  picture.add(look, "coarse");
  picture.add(look, "rough");
  const range: [keyof typeof look, number, number][] = [["exposure", 0.1, 4], ["gamma", 0.6, 1.6], ["bloom", 0, 0.4], ["fibre", 0.3, 3], ["hair", 0.5, 3], ["ribbon", 3, 30], ["crisp", 0, 3], ["lens", 0, 0.6], ["focus", -3, 3], ["sharp", 0, 2], ["air", 0, 0.04], ["sway", 0, 2], ["inside", 0, 5], ["room", 0, 1], ["flicker", 0, 3], ["ambient", 0, 1], ["pupa", 0, 1.2], ["through", 0, 0.9], ["glint", 0, 3], ["web", 0.2, 2], ["bounce", 0, 2], ["strand", 0.5, 4], ["frizz", 0, 3]];
  for (const [k, a, b] of range) picture.add(look as unknown as Record<string, number>, k, a, b);
  for (const [name, l] of Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`).close();
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
  const state = { lit: 0, why: [] as number[], bench: false, hold: undefined as number | undefined, frame: 0, ms: 0, eye: [0, 0, 0], time: undefined as ((ms: Record<string, number>) => void) | undefined };
  const due = frameCap();
  const frameData = new Float32Array(32);
  const viewProj = new Matrix4();
  const nowhere: Pose = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  const rows = (d: Float32Array, m: Pose, at: number) => [0, 1, 2].forEach((r) => d.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], at + r * 4));
  const smooth = (x: number) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

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
    const pixels = h / 2 / Math.tan((camera.fov * Math.PI) / 360);
    frameData.set(viewProj.elements, 0);
    frameData.set([...camera.position.toArray(), 1], 16);
    // and how much blur, in pixels, still counts as sharp: what all of the layer has
    const opening = look.lens * (far / 4.6) ** 0.75;
    const within = opening * pixels * (1 / Math.max(0.5, far - look.focus - look.sharp) - 1 / Math.max(0.5, far - look.focus));
    frameData.set([w, h, pixels, within], 20);
    frameData.set([look.dim, far - 1.5, 0, look.fibre], 24);
    const widest = h * 0.022;
    const focus = Math.max(0.5, far - look.focus);
    frameData.set([t * Math.PI * 2, opening, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);
    /** the lens's blur at a depth, in pixels (as blurAt in common.wgsl) */
    const blurAt = (d: number) => Math.min(widest, Math.max(0, opening * pixels * Math.abs(1 / focus - 1 / Math.max(d, 0.3)) - within));

    // ---- where everything is
    const eye = camera.position.toArray() as [number, number, number];
    // every one anew when frames are asked for one by one, or the eye moves
    const all = (state.hold !== undefined && !state.bench) || !look.thrift || state.frame < 3 || Math.hypot(...eye.map((x, q) => x - state.eye[q])) > 0.02;
    state.eye = eye;
    const list = Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180, (l.elevation * Math.PI) / 180];
      return { dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] as Lamp["dir"], colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"] };
    });
    const wide = Math.min(1.9, Math.max(0.8, w / h));
    const hung = COLUMNS.map((c) => where(c, tears, t, look.sway, wide));
    const middles = hung.map((x) => x.body.t);
    // how aglow each is: the light comes up, gutters as its web tears, and goes out as it falls
    const inner = COLUMNS.map((_, i) => {
      const { age, torn, gone } = hung[i];
      return aglow(age) * brightness(age, torn, gone, i, look.flicker);
    });
    // seen (in the picture or nearly), how far, how blurred
    BODIES.forEach((b, i) => {
      const c = middles[b.of];
      const v = new Vector3(...c).applyMatrix4(viewProj);
      b.d = Math.hypot(...c.map((x, q) => x - eye[q]));
      b.blur = blurAt(b.d);
      const r = (1.3 * pixels) / Math.max(0.3, b.d) / (h / 2);
      // (a web: from its cocoon up out of the picture)
      b.seen = b.world ? Math.abs(v.x) < 1 + r * (h / w) && v.y < 1 + r : Math.abs(v.x) < 1 + r * (h / w) && Math.abs(v.y) < 1 + r && b.d > 0.4;
      // the camera stands still: what changes is how each is turned, and its glow (put in as it is drawn). Lit anew
      // every so many frames, staggered so that each frame has about as much; and at once when it has turned
      const R = hung[b.of].body.R;
      const turned = b.R.length ? Math.max(...R.map((x, q) => Math.abs(x - b.R[q]))) : 1;
      // lit anew more often while the light inside moves (the lamp in it, the pupa), or a falling one's shadow goes by
      const glowing = aglow(hung[b.of].age) > 0.01 && hung[b.of].gone < 3;
      const passing = hung.some((o, j) => j !== b.of && o.gone > 0 && o.gone < 3 && Math.hypot(...o.body.t.map((x, k) => x - c[k])) < 4);
      const every = glowing || passing ? (b.blur > 8 ? 8 : 6) : 12;
      // (a web: with its cocoon, and every frame while it tears and is drawn up)
      const moving = hung[b.of].frame > 0 && hung[b.of].gone < 6;
      b.now = b.seen && (all || b.fresh || (b.world ? moving : turned > look.turn) || (state.frame + b.of) % every === 0);
      if (b.now) b.R = R;
      b.fresh = false;
    });
    // as many hairs as come out about a pixel wide, as many points as show; and fewer where the lens spreads them,
    // each drawn the wider (as much silk, softer)
    for (const k of sets) {
      const b = BODIES[k.body];
      if (k.name === "thread") {
        k.data[6] = k.n * k.points;
        // (how thick the webs are is in their points: weave.wgsl)
        new Float32Array(k.data.buffer)[14] = 1;
        device.queue.writeBuffer(k.buffer, 0, k.data);
        device.queue.writeBuffer(k.light, 0, k.data);
        continue;
      }
      const each_ = (2 * head.kinds[k.kind].radius * look.fibre * pixels) / Math.max(0.8, b.d - 0.6);
      const floor = k.name === "floss" ? 1 : k.name === "fuzz" ? 0.4 : k.name === "down" ? 0.15 : 0.25;
      let part = Math.min(1, Math.max(floor, each_ / (look.hair * HAIR[k.name])));
      if (look.thrift) part *= Math.min(1, Math.max(0.12, 3 / (1 + 0.5 * b.blur)));
      part = Math.ceil(part * 32) / 32;
      const size = (2 * pixels) / Math.max(0.8, b.d - 0.6);
      const stride = !look.thrift || k.name === "down" ? 1 : k.name === "floss" ? (b.blur > 5 || size < 500 ? 3 : 1) : b.blur > 5 || size < 400 ? 2 : 1;
      const n = Math.ceil(k.n * part);
      const pts = Math.ceil((k.points - 1) / stride) + 1;
      // lit at every other point it is drawn through, every third where blurred (the long loose ones, more seldom)
      const every = !look.thrift || !look.coarse || k.name === "down" ? 1 : k.name === "floss" ? (b.blur > 5 ? 4 : 3) : b.blur > 5 ? 3 : 2;
      // what was lit is of other hairs than these
      if (n > k.now.n || stride !== k.now.stride || every !== k.now.every) b.now = b.seen;
      k.now.n = n;
      k.now.stride = stride;
      k.now.points = pts;
      k.now.every = every;
      k.data[1] = n;
      k.data[2] = pts;
      k.data[6] = n * pts;
      k.data[13] = stride;
      k.data[15] = every;
      new Float32Array(k.data.buffer)[14] = 1 / part;
      device.queue.writeBuffer(k.buffer, 0, k.data);
      // the kind it is shaded as
      const lp = Math.ceil((k.points - 1) / (stride * every)) + 1;
      const d = k.data.slice();
      d[2] = lp;
      d[6] = n * lp;
      d[13] = stride * every;
      d[15] = 1;
      device.queue.writeBuffer(k.light, 0, d);
    }
    glazes.forEach((g, i) => {
      const b = BODIES[i];
      // about as fine as the screen, and coarser where the lens blurs it
      const size = (2 * pixels) / Math.max(0.8, b.d - 0.6) / (look.thrift ? 1 + b.blur / 6 : 1);
      const w_ = size > 700 ? FINE : size > 350 ? 512 : 256;
      if (w_ !== g.w) b.now = b.seen;
      g.w = w_;
      const gd = new DataView(new ArrayBuffer(16));
      [g.w, g.w / 2, i].forEach((x, k) => gd.setUint32(k * 4, x, true));
      gd.setFloat32(12, Math.log2(FINE / g.w), true);
      device.queue.writeBuffer(g.info, 0, gd.buffer);
    });
    BODIES.forEach((b, i) => {
      const m = b.world ? nowhere : hung[b.of].body;
      const back = (v: number[]) => [0, 1, 2].map((k) => m.R[k] * v[0] + m.R[3 + k] * v[1] + m.R[6 + k] * v[2]) as Lamp["dir"];
      const local = back(eye.map((x, k) => x - m.t[k]));
      const data = new Float32Array(52);
      for (let r = 0; r < 3; r++) data.set([...m.R.slice(r * 3, r * 3 + 3), m.t[r]], r * 4);
      data.set([...local, 1], 12);
      // how aglow it is now, and how much of the light from outside comes to it (as it is drawn)
      data.set(b.world ? [0, 1] : [inner[b.of], 1 - look.room * Math.min(1, inner[b.of])], 32);
      const ids = new Uint32Array(data.buffer);
      ids.set([0, b.of, b.of, 0], 16);
      ids.fill(99, 20, 32);
      // who may stand in its light: the cocoons near it (and, of a web, its own)
      const near = middles
        .map((o, j) => ({ j, d: Math.hypot(...o.map((x, k) => x - middles[b.of][k])) }))
        .filter(({ j, d }) => (b.world || j !== b.of) && d < 6)
        .sort((p, q) => p.d - q.d)
        .slice(0, 6);
      near.forEach(({ j }, k) => (ids[20 + k] = j));
      if (!b.world) {
        const { lamp, pupa, spine } = inside(m.R, t + COLUMNS[b.of].phase, look.pupa);
        data.set([...lamp, look.ambient, ...pupa, ...spine, look.through], 40);
      }
      device.queue.writeBuffer(b.buffer, 0, data.buffer as ArrayBuffer, 0, 208);
      if (b.world || !b.now) return;
      // (as much light inside as when it is all aglow: how much there is now, and how much less from outside, is put
      // in as it is drawn; aglow, it is lit less from outside, as hero.html's room darkens, and reads as a lantern)
      const turned = list.map((l) => ({ dir: back(l.dir), colour: l.colour }));
      const tint = INSIDE.map((c) => c * look.inside) as [number, number, number];
      for (const name of names) device.queue.writeBuffer(nets[name].buffers[b.of], 0, foldHero(head, name, turned, tint));
      void i;
    });
    device.queue.writeBuffer(strandBuffer, 0, foldLamps(strandHead, "strand", list));
    const shade = new Float32Array(SHADOW * 4);
    list.forEach((l, n) => shade.set([...l.dir, 0], n * 4));
    shade.set([look.shadow, 0.12, look.glint, look.bounce], 12);
    hung.forEach(({ body: m, age }, i) => {
      // a new one comes out of nowhere above the picture: its shadow doesn't
      shade[(4 + 24 * 3) * 4 + i] = smooth(age / 2.2);
      [shape.A, shape.B, shape.B].forEach((size, r) => {
        const v = [0, 1, 2].map((k) => m.R[k * 3 + r] / (size * 0.97));
        shade.set([...v, -(v[0] * m.t[0] + v[1] * m.t[1] + v[2] * m.t[2])], 16 + i * 12 + r * 4);
      });
      shade[(SHADOW - 2) * 4 + i] = inner[i] * look.inside;
    });
    list.forEach((l, n) => shade.set([...l.colour, 0], (4 + 24 * 3 + 6 + n) * 4));
    shade.set([...INSIDE, look.strand], (4 + 24 * 3 + 6 + 3) * 4);
    device.queue.writeBuffer(shadowBuffer, 0, shade);
    cordJobs.forEach((k, i) => {
      const d = new Float32Array(32);
      new Uint32Array(d.buffer).set([still, each, cordFirst + each * i, 0]);
      d.set([0, OVER, OVER + 10, 0], 4);
      rows(d, hung[i].cord, 8);
      rows(d, nowhere, 20);
      device.queue.writeBuffer(k.buffer, 0, d);
    });
    weaves.forEach((k, i) => {
      const tear = tears[COLUMNS[i].id];
      const d = new Float32Array(40);
      new Uint32Array(d.buffer).set([tear.halves, COPIES, tear.frames, tear.nodes, WEB, webFirst + i * webN * WEB, 0, tear.halves / 2]);
      d.set([hung[i].frame, 0, 0, 0, tear.step, look.frizz, F.radius * look.web, 0.1], 8);
      rows(d, hung[i].above, 16);
      rows(d, hung[i].below, 28);
      device.queue.writeBuffer(k.buffer, 0, d);
    });

    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    // (how many were lit anew, for tools)
    state.lit = BODIES.filter((b) => !b.world && b.now).length;
    state.why = BODIES.filter((b) => !b.world && b.now).map((b) => b.of);
    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass({ timestampWrites: stamp(0) });
    cp.setPipeline(cordPipe);
    cordJobs.forEach((k, i) => {
      if (!BODIES[N + i].seen) return;
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    });
    cp.setPipeline(weavePipe);
    weaves.forEach((k, i) => {
      if (!BODIES[N + i].seen) return;
      cp.setBindGroup(0, k.group);
      cp.dispatchWorkgroups(k.dispatch);
    });
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
      cp.dispatchWorkgroups(Math.ceil((k.now.n * (Math.ceil((k.points - 1) / (k.now.stride * k.now.every)) + 1)) / 64));
    }
    cp.end();

    {
      const pass = encoder.beginRenderPass({
        timestampWrites: stamp(1),
        colorAttachments: [
          // (one sample a pixel: drawn straight into what the lens reads)
          SAMPLES > 1 ? { view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 1] } : { view: targets.sharp, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
          SAMPLES > 1 ? { view: targets.soft, resolveTarget: targets.blurs, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] } : { view: targets.blurs, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
        ],
        depthStencilAttachment: { view: targets.deep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
      });
      const order = COLUMNS.map((_, i) => i)
        .filter((i) => BODIES[i].seen)
        .sort((p, q) => BODIES[p].d - BODIES[q].d);
      if (look.shells) {
        pass.setPipeline(shellPipe);
        // the near ones first, so that hidden pixels of the far ones are never shaded
        for (const i of order) {
          const rough = look.thrift && look.rough;
          pass.setIndexBuffer(rough ? coarseBuffer : indexBuffer, "uint32");
          pass.setBindGroup(0, bases[i]);
          pass.setBindGroup(1, shellGroups[i]);
          pass.drawIndexed(rough ? coarseIndex.length : index.length, 1, 0, 0, 0);
        }
      }
      pass.setPipeline(fibrePipe);
      for (const k of sets) {
        if (!look[k.name] || !BODIES[k.body].seen) continue;
        // a ribbon for every so many pixels (look.ribbon) along it
        const split = Math.max(1, Math.min(6, Math.round((k.step * k.now.stride * pixels) / Math.max(0.7, BODIES[k.body].d - 0.6) / look.ribbon)));
        device.queue.writeBuffer(k.splitBuffer, 0, new Uint32Array([split, airy(look.air * (k.points === WEB ? 0 : AIR[k.name])), 0, 0]));
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
    // as it goes live: a 60th of a second apart, the thrift at work
    state.bench = true;
    for (let i = 0; i < n; i++) {
      state.hold = t + i / 60 / DURATION;
      wrap.render?.({ playhead: state.hold } as never);
    }
    state.hold = was;
    state.bench = false;
  };
  // (for tools: where each is, at a time)
  const columnsAt = (t: number) => COLUMNS.map((c) => where(c, tears, t, look.sway, 1)).map((x) => ({ age: x.age, y: x.body.t[1], torn: x.torn, gone: x.gone, high: high(0) }));
  // (for tools: what of the light is not a number, below nothing or too much, set by set)
  const readLit = async () => {
    const out: Record<string, number | string>[] = [];
    for (const [name, b] of [["lit", lit], ["glowLit", glowLit]] as const) {
      const r = device.createBuffer({ size: litRoom * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const e = device.createCommandEncoder();
      e.copyBufferToBuffer(b, 0, r, 0, litRoom * 8);
      device.queue.submit([e.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const u = new Uint16Array(r.getMappedRange());
      const half = (h: number) => {
        const e_ = (h >> 10) & 31;
        const f = h & 1023;
        return e_ === 31 ? (f ? NaN : Infinity) : (h >> 15 ? -1 : 1) * (e_ ? 2 ** (e_ - 15) * (1 + f / 1024) : 2 ** -24 * f);
      };
      sets.forEach((k, q) => {
        let nan = 0, neg = 0, big = 0, first = -1;
        const n = k.now.n * (Math.ceil((k.points - 1) / (k.now.stride * k.now.every)) + 1);
        for (let i = 0; i < n; i++)
          for (let c = 0; c < 3; c++) {
            const v = half(u[(litFirst[q] + i) * 4 + c]);
            if (Number.isNaN(v)) { nan++; if (first < 0) first = i; }
            else if (v < -1e-3) neg++;
            else if (v > 100) big++;
          }
        if (nan || neg || big) out.push({ buffer: name, set: q, kind: k.name, body: k.body, nan, neg, big, first });
      });
      r.unmap();
      r.destroy();
    }
    return out;
  };
  Object.assign(window, { __cocoon: { readLit, bench, look, lamps, state, home, camera, controls, device, DURATION, columnsAt } });

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
  // at most one and a half pixels to a point (?dpr=2 to record finer)
  pixelRatio: Math.min(window.devicePixelRatio, +(new URLSearchParams(location.search).get("dpr") ?? 1.5)),
  animate: true,
  duration: DURATION * 1000,
  // no playFps: ssam's drops frames (see cap.ts), so the render caps itself at 60
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
