/**
 * Four silk cocoons on a twisted thread, every fibre drawn, lit by lamps that can be put anywhere.
 *
 * How light gets about in there (through the silk, round the inside, from hair to hair) is path traced in
 * Cycles and learnt by small networks: see bake/. Here a compute pass asks the networks for the light at every
 * control point of every fibre, seen from where the camera is; the fibres are drawn as ribbons between those,
 * and the shells under them ask for theirs a pixel at a time.
 */
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { DataUtils, Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import { frameCap } from "./cap";
import common from "./common.wgsl?raw";
import fibreCode from "./fibre.wgsl?raw";
import { KINDS, load, type KindName } from "./load";
import { PROGRAMS, SKY_H, SKY_W, skyLamps } from "./light/programs";
import { foldHead, netCode, type Lamp } from "./net";
import lensCode from "./lens.wgsl?raw";
import postCode from "./post.wgsl?raw";
import shadeFree from "./shade-free.wgsl?raw";
import shadeOn from "./shade-on.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shellCode from "./shell.wgsl?raw";

/** seconds a loop takes: the cluster turns once */
/** sun.html, film.html: what the light does */
const PROGRAM = PROGRAMS[document.documentElement.dataset.page ?? ""]?.();
const DURATION = PROGRAM?.duration ?? 20;
const SAMPLES = 4;
const GLOWS = 6;
/** how freely each kind of fibre moves in the air */
const AIR = { wound: 0, fuzz: 0.22, floss: 1, thread: 0.7 };
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
  lens: 0.12,
  focus: 0.75,
  /** how far the air moves loose silk, in units of half a cocoon */
  air: 0.014,
  /** turns of the cluster in a loop, and how it turns: round and round, or to and fro on the thread */
  motion: "round" as "round" | "to and fro" | "still",
  sway: 70,
  shells: true,
  wound: true,
  fuzz: true,
  floss: true,
  thread: true,
};

if (PROGRAM) Object.assign(look, PROGRAM.look);

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

  const cocoon = await load("./");
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
  const points = buffer(cocoon.points, STORAGE);
  const lit = buffer((cocoon.points.length / 4) * 8, STORAGE);
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
      const code = netCode(name, head.nets[name], 2, 0, device.features.has("shader-f16"));
      return [name, { ...code, headBuffer: buffer(code.head * 16, UNIFORM) }];
    }),
  ) as Record<(typeof netNames)[number], ReturnType<typeof netCode> & { headBuffer: GPUBuffer }>;

  // ---------------------------------------------------------------- pipelines

  const module = (code: string) => device.createShaderModule({ code: code.includes("mat4x4h") ? "enable f16;\n" + code : code });
  const group = (pipeline: GPURenderPipeline | GPUComputePipeline, index: number, resources: GPUBindingResource[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries: resources.map((resource, binding) => ({ binding, resource })) });
  const of = (b: GPUBuffer) => ({ buffer: b });

  const HDR = "rgba16float" as const;
  const SOFT = "rg16float" as const;
  const over: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
  const depth = (write: boolean): GPUDepthStencilState => ({ format: "depth24plus", depthWriteEnabled: write, depthCompare: "less" });

  const shadeModules = {
    on: module(common + nets.on.code + shadeCode.replace("SHADE", shadeOn)),
    free: module(common + nets.free.code + shadeCode.replace("SHADE", shadeFree).replace(/@group\(1\) @binding\([4567]\).*\n/g, "")),
  };
  const shadePipes = {
    on: await device.createComputePipelineAsync({ layout: "auto", compute: { module: shadeModules.on, entryPoint: "main" } }),
    free: await device.createComputePipelineAsync({ layout: "auto", compute: { module: shadeModules.free, entryPoint: "main" } }),
  };
  const shellModule = module(common + nets.shell.code + shellCode);
  const shellPipe = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: shellModule },
    fragment: { module: shellModule, targets: [{ format: HDR }, { format: SOFT }] },
    primitive: { cullMode: "back" },
    depthStencil: depth(true),
    multisample: { count: SAMPLES },
  });
  const fibreModule = module(common + fibreCode);
  const fibrePipe = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: fibreModule },
    fragment: { module: fibreModule, targets: [{ format: HDR, blend: over }, { format: SOFT, blend: over }] },
    primitive: { topology: "triangle-strip" },
    depthStencil: depth(false),
    multisample: { count: SAMPLES },
  });

  const shade = KINDS.map((name) => {
    const k = head.kinds[name];
    const data = new Uint32Array([cocoon.first[name], k.n, k.points, k.knots, cocoon.codeFirst[name] / 4, k.own / 4, k.n * k.points, k.on ? k.n / 4 : 0]);
    const b = buffer(data, UNIFORM);
    const pipe = k.on ? shadePipes.on : shadePipes.free;
    const net = nets[k.on ? "on" : "free"];
    const shared = [of(b), of(points), of(codes), of(lit)];
    const splitBuffer = buffer(16, UNIFORM);
    // the usual distance between two control points
    let step = 0;
    for (let i = 0; i < 400; i++) {
      const o = (cocoon.first[name] + Math.floor((i / 400) * k.n) * k.points + 3) * 4;
      step += Math.hypot(...[0, 1, 2].map((c) => cocoon.points[o + c] - cocoon.points[o + 4 + c])) / 400;
    }
    return {
      name,
      pipe,
      groups: [
        group(pipe, 0, k.on ? [of(frameBuffer), of(shapeBuffer)] : [of(frameBuffer)]),
        group(pipe, 1, k.on ? [...shared, coarse, fine, around, detail] : shared),
        group(pipe, 2, [of(net.headBuffer)]),
      ],
      dispatch: Math.ceil((k.n * k.points) / 64),
      draw: [group(fibrePipe, 0, [of(frameBuffer), of(shapeBuffer)]), group(fibrePipe, 1, [of(b), of(points), of(lit), of(splitBuffer)])],
      stretches: k.n * (k.points - 1),
      step,
      splitBuffer,
    };
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
  const shellGroups = [
    group(shellPipe, 0, [of(frameBuffer), of(shapeBuffer)]),
    group(shellPipe, 1, [of(relief), coarse, fine, around, of(buffer(new Uint8Array(gridData.buffer), UNIFORM)), detail]),
    group(shellPipe, 2, [of(nets.shell.headBuffer)]),
  ];

  // sun.html, film.html: the sky, out of focus behind everything
  const skyData = new Float32Array(SKY_W * SKY_H * 4);
  const sky = PROGRAM && (() => {
    const m = module(`
      struct View { x: vec4f, y: vec4f, z: vec4f, size: vec4f }
      @group(0) @binding(0) var<uniform> view: View;
      @group(0) @binding(1) var sky: texture_2d<f32>;
      @group(0) @binding(2) var smp: sampler;
      @vertex fn screen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 1.0, 1.0); }
      struct Ink { @location(0) light: vec4f, @location(1) soft: vec4f }
      @fragment fn wash(@builtin(position) p: vec4f) -> Ink {
        let q = (p.xy / view.size.xy * 2.0 - 1.0) * vec2f(1.0, -1.0);
        let d = normalize(view.x.xyz * q.x * view.x.w + view.y.xyz * q.y * view.y.w + view.z.xyz);
        let uv = vec2f(atan2(d.x, d.z) / 6.2831853 + 1.0, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
        // smooth between its few places: a cubic B-spline, by four taps
        let size = vec2f(${SKY_W}.0, ${SKY_H}.0);
        let x = uv * size - 0.5;
        let f = fract(x);
        let i = floor(x);
        let w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
        let w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
        let w3 = f * f * f / 6.0;
        let w2 = 1.0 - w0 - w1 - w3;
        let g0 = w0 + w1;
        let g1 = w2 + w3;
        let h0 = (i - 0.5 + w1 / g0) / size + 0.0;
        let h1 = (i + 1.5 + w3 / g1) / size;
        let c = g0.y * (g0.x * textureSampleLevel(sky, smp, vec2f(h0.x, h0.y), 0.0).rgb + g1.x * textureSampleLevel(sky, smp, vec2f(h1.x, h0.y), 0.0).rgb)
              + g1.y * (g0.x * textureSampleLevel(sky, smp, vec2f(h0.x, h1.y), 0.0).rgb + g1.x * textureSampleLevel(sky, smp, vec2f(h1.x, h1.y), 0.0).rgb);
        let seen = c * view.z.w;
        return Ink(vec4f(seen / (1.0 + 1.6 * max(seen.r, max(seen.g, seen.b))), 1.0), vec4f(0.0));
      }`);
    const texture = device.createTexture({ size: [SKY_W, SKY_H], format: HDR, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const viewBuffer = buffer(64, UNIFORM);
    const pipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: m },
      fragment: { module: m, targets: [{ format: HDR }, { format: SOFT }] },
      depthStencil: { ...depth(false), depthCompare: "always" },
      multisample: { count: SAMPLES },
    });
    const g = group(pipe, 0, [of(viewBuffer), texture.createView(), device.createSampler({ addressModeU: "repeat", magFilter: "linear", minFilter: "linear" })]);
    return { texture, buffer: viewBuffer, pipe, group: g };
  })();

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
  const home = (az = 0, el = 2, dist = 15.6, target: [number, number, number] = [0, 0.62, 0]) => {
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
  if (PROGRAM) PROGRAM.gui?.(gui.addFolder("light"));
  const picture = gui.addFolder("picture");
  picture.add(look, "exposure", 0.1, 4);
  picture.add(look, "gamma", 0.6, 1.6);
  picture.add(look, "bloom", 0, 0.4);
  picture.add(look, "fibre", 0.3, 3).name("fibre width");
  picture.add(look, "crisp", 0, 3);
  picture.add(look, "lens", 0, 0.6);
  picture.add(look, "focus", -1.5, 2);
  picture.add(look, "air", 0, 0.06);
  picture.add(look, "motion", ["round", "to and fro", "still"]);
  for (const [name, l] of PROGRAM ? [] : Object.entries(lamps)) {
    const f = gui.addFolder(`${name} light`);
    f.add(l, "azimuth", -180, 180);
    f.add(l, "elevation", -36, 80);
    f.add(l, "power", 0, 6);
    f.addColor(l, "colour");
  }
  const parts = gui.addFolder("parts").close();
  for (const k of ["shells", ...KINDS] as const) parts.add(look, k);

  // ---------------------------------------------------------------- a frame

  // exact: lamps given outright, for tools/truth.mjs
  // how long the passes take the card (tools/perf.mjs asks)
  const times = timed ? { set: device.createQuerySet({ type: "timestamp", count: 6 }), raw: device.createBuffer({ size: 48, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) } : undefined;
  const stamp = (i: number) => (times && state.time ? { querySet: times.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } : undefined);
  const state = { hold: undefined as number | undefined, frame: 0, ms: 0, exact: undefined as Lamp[] | undefined, time: undefined as ((ms: Record<string, number>) => void) | undefined };
  const due = frameCap();
  const frameData = new Float32Array(32);
  const viewProj = new Matrix4();
  const right = new Vector3();
  const before = new Vector3();

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
    const turn = look.motion === "round" ? t * Math.PI * 2 : look.motion === "to and fro" ? (Math.sin(t * Math.PI * 2) * look.sway * Math.PI) / 180 : 0;

    const pixels = h / 2 / Math.tan((head.fov * Math.PI) / 360);
    const nearest = Math.max(1, camera.position.distanceTo(controls.target) - 0.8);
    frameData.set(viewProj.elements, 0);
    frameData.set([...camera.position.toArray(), 1], 16);
    frameData.set([w, h, pixels, 0], 20);
    // round and round, the thread turns whole: twisted, it would be a turn off after a loop
    frameData.set([turn, look.motion === "round" ? 1e6 : 5.2, look.motion === "round" ? 1e6 - 1 : 3.2, look.fibre], 24);
    const widest = h * 0.022;
    const far = camera.position.distanceTo(controls.target);
    const focus = Math.max(0.5, far - look.focus);
    // opened less the closer it is, or there would be nothing but blur
    frameData.set([t * Math.PI * 2, look.lens * (far / 15.6) ** 0.75, focus, widest], 28);
    device.queue.writeBuffer(lensBuffer, 0, new Float32Array([w / 2, h / 2, widest / 2, 0]));
    device.queue.writeBuffer(frameBuffer, 0, frameData);

    // the lamps stay with the camera's side of the room; the cocoons turn under them
    const list: Lamp[] = state.exact ?? Object.values(lamps).map((l) => {
      const [a, e] = [(l.azimuth * Math.PI) / 180 - turn, (l.elevation * Math.PI) / 180];
      return {
        dir: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)],
        colour: linear(l.colour).map((c) => c * l.power) as Lamp["colour"],
      };
    });
    if (PROGRAM && !state.exact) {
      list.length = 0;
      list.push(...PROGRAM.at(t, skyData), ...skyLamps(skyData, PROGRAM.gain.light));
      const [c, s] = [Math.cos(-turn), Math.sin(-turn)];
      for (const l of list) l.dir = [c * l.dir[0] + s * l.dir[2], l.dir[1], c * l.dir[2] - s * l.dir[0]];
      const halves = new Uint16Array(SKY_W * SKY_H * 4);
      skyData.forEach((v, i) => (halves[i] = DataUtils.toHalfFloat(Math.min(v, 100))));
      device.queue.writeTexture({ texture: sky!.texture }, halves, { bytesPerRow: SKY_W * 8 }, [SKY_W, SKY_H]);
      const e = camera.matrixWorld.elements;
      const ty = Math.tan((head.fov * Math.PI) / 360);
      device.queue.writeBuffer(sky!.buffer, 0, new Float32Array([e[0], e[1], e[2], ty * (w / h), e[4], e[5], e[6], ty, -e[8], -e[9], -e[10], PROGRAM.gain.seen, w, h, 0, 0]));
    }
    for (const name of netNames) device.queue.writeBuffer(nets[name].headBuffer, 0, foldHead(head, name, list));
    device.queue.writeBuffer(postBuffer, 0, new Float32Array([w, h, Math.max(3, h / 200), look.crisp, look.exposure, look.gamma, 0, 0, look.bloom, look.spread, 0, 0, 1, 1, 1, 1]));

    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass({ timestampWrites: stamp(0) });
    for (const k of shade) {
      if (!look[k.name as KindName]) continue;
      compute.setPipeline(k.pipe);
      k.groups.forEach((g, i) => compute.setBindGroup(i, g));
      compute.dispatchWorkgroups(Math.min(k.dispatch, 65535), Math.ceil(k.dispatch / 65535));
    }
    compute.end();

    const pass = encoder.beginRenderPass({
      timestampWrites: stamp(1),
      colorAttachments: [
        { view: targets.color, resolveTarget: targets.sharp, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 1] },
        { view: targets.soft, resolveTarget: targets.blurs, loadOp: "clear", storeOp: "discard", clearValue: [0, 0, 0, 0] },
      ],
      depthStencilAttachment: { view: targets.deep, depthLoadOp: "clear", depthStoreOp: "discard", depthClearValue: 1 },
    });
    if (sky) {
      pass.setPipeline(sky.pipe);
      pass.setBindGroup(0, sky.group);
      pass.draw(3);
    }
    if (look.shells) {
      pass.setPipeline(shellPipe);
      shellGroups.forEach((g, i) => pass.setBindGroup(i, g));
      pass.setIndexBuffer(indexBuffer, "uint32");
      // the near ones first, so that hidden pixels of the far ones are never shaded
      const order = head.cocoons.map((c, n) => {
        const p = before.set(c.c[0], c.c[1], c.c[2]).applyAxisAngle(right.set(0, 1, 0), turn);
        return [n, p.distanceTo(camera.position)];
      });
      order.sort((a, b) => a[1] - b[1]);
      for (const [n] of order) pass.drawIndexed(index.length, 1, 0, 0, n);
    }
    pass.setPipeline(fibrePipe);
    for (const k of shade) {
      if (!look[k.name as KindName]) continue;
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
