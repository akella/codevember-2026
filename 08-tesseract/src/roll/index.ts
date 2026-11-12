import type { Sketch, SketchSettings } from "ssam";
import palettes from "nice-color-palettes";
import { ssam } from "ssam";
import { frameCap } from "../cap";
import { Color, MathUtils, Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { RectAreaLightTexturesLib } from "three/examples/jsm/lights/RectAreaLightTexturesLib.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import common from "./common.wgsl?raw";
import { blueNoise } from "./bluenoise";
import { EDGES, FACES, loopRepeats, makeProfile, parseMoves, poseAt, project } from "./motion";
import postCode from "./post.wgsl?raw";
import traceCode from "./trace.wgsl?raw";

/** roll sequences that bring the tesseract back where it started and turned the way it started */
const paths = {
  /** around a square on the floor, turning inside out between every two rolls */
  wander: { moves: "+x +w +z +w -x +w -z +w", start: [-1, -1] },
  /** inside out, again and again, in place */
  "inside out": { moves: "+w", start: [0, 0] },
  /** across and back, turning inside out twice at each end */
  across: { moves: "+x +w +w -x -x +w +w +x", start: [0, 0] },
} as const;

const roll = {
  path: "wander" as keyof typeof paths,
  /** seconds per roll, and resting between rolls */
  seconds: 1.25,
  rest: 0.45,
  /** how far the 4D eye is from the centre, in half sizes: nearer makes the inner cube smaller */
  distance: 3,
  /** beam radius against the half size */
  beam: 0.045,
  /** how slowly it creeps over the balance point, and how much it rocks back on landing */
  hesitate: 0.3,
  bounce: 0.22,
};

const metals = {
  chrome: [0.55, 0.56, 0.55],
  silver: [0.97, 0.96, 0.91],
  brass: [0.91, 0.75, 0.4],
  gold: [1.0, 0.77, 0.34],
  copper: [0.95, 0.64, 0.54],
} as const;
const plastics = {
  "black lacquer": [0.015, 0.015, 0.015],
  "white ceramic": [0.8, 0.79, 0.76],
  "red lacquer": [0.55, 0.03, 0.02],
} as const;
/** solid glass, by its colour through a sixth of a unit of it */
const glasses = {
  "clear glass": [0.9, 0.96, 0.94],
  "amber glass": [0.98, 0.7, 0.3],
} as const;
type Finish = keyof typeof metals | keyof typeof plastics | keyof typeof glasses;
const finishes = [...Object.keys(metals), ...Object.keys(plastics), ...Object.keys(glasses)] as Finish[];

const look = {
  frame: "chrome" as Finish,
  /** edges that ran along w before the first roll; they show how a roll swaps directions */
  wEdges: "brass" as Finish,
  roughness: 0.12,
  /** glass in the squares: none, the cubes' faces, the faces joining the cubes (that span w), all */
  panes: "joining" as "none" | "cubes" | "joining" | "all",
  tint: "#d6ecff",
  /** the glass's index of refraction, which sets how much it reflects: 1.5 is window glass (4% head
   * on), 2.4 diamond (17%) */
  ior: 2,
  /** plain tinted glass, or dichroic: each pane passes one colour (by the two 4D directions it spans)
   * and reflects the rest, so it throws coloured light on the sweep */
  glass: "coloured" as "plain" | "dichroic" | "coloured",
  dichroic: 0.85,
  /** coloured: every pane a colour of its own from one of nice-color-palettes' hundred, dealt by
   * `deal`, and how deep the colour is (full depth through several panes goes dark) */
  palette: 21,
  deal: 0,
  depth: 0.75,
  /** a thin film on the glass, in nanometres (0 for none): reflections swing through colours with angle */
  film: 110,
  /** how mirrored the panes are, 0 to 1: at 0.7 or so the inside repeats away into the distance */
  mirrored: 0,
  /** light the w edges give off, and its colour */
  glow: 0,
  glowColor: "#ff6a2a",
};

const studio = {
  setup: "soft white" as keyof typeof setups,
  sweep: "#e2ded8",
  /** roughness of the sweep's sheen */
  sheen: 0.42,
  /** big softbox front left, high */
  key: 5,
  /** tall one on the right, weaker */
  fill: 0.9,
  /** a long strip overhead */
  top: 2.2,
  /** two narrow strips behind, for the edges of the beams */
  rim: 7,
  rimLeft: "#ffffff",
  rimRight: "#ffffff",
  /** high at the back, aimed down the sweep, for a glow behind the tesseract */
  back: 2.5,
  /** what comes from the open side of the studio */
  ambient: 0.015,
  exposure: 1,
  /** what the softboxes' faces look like, in what reflects them */
  softbox: "plain" as "plain" | "grid" | "window" | "gradient",
};

const setups = {
  "soft white": { sweep: "#e2ded8", sheen: 0.42, key: 5, fill: 0.9, top: 2.2, rim: 7, rimLeft: "#ffffff", rimRight: "#ffffff", back: 2.5, ambient: 0.015, exposure: 1 },
  "low key": { sweep: "#1d1c1b", sheen: 0.22, key: 2.6, fill: 0, top: 0.8, rim: 16, rimLeft: "#ffffff", rimRight: "#ffffff", back: 9, ambient: 0, exposure: 1.15 },
  /** a dark polished floor, to mirror the tesseract */
  "gloss floor": { sweep: "#3a3938", sheen: 0.1, key: 4, fill: 0.6, top: 2.2, rim: 12, rimLeft: "#ffffff", rimRight: "#ffffff", back: 5, ambient: 0.01, exposure: 1.1 },
  gels: { sweep: "#2b2a2c", sheen: 0.25, key: 1.2, fill: 0, top: 0.6, rim: 20, rimLeft: "#4fb4ff", rimRight: "#ff8a3d", back: 4, ambient: 0, exposure: 1.1 },
} as const;

const follow = {
  /** the camera keeps the tesseract in the middle and swings round it as it rolls */
  on: true,
  /** orbit: it goes round with the tesseract, at its pace, so every roll is seen from the same side
   * (and from the back of the studio it looks out of the open front). swing: it stays in front and
   * sways from side to side */
  mode: "orbit" as "orbit" | "swing",
  /** orbit: where it stands against the way the tesseract is heading, in degrees: 0 is outside the
   * circle looking in, 90 is ahead of it, -90 behind */
  side: 0,
  /** swing: how far to each side, in degrees, and how many times in a loop */
  swing: 0,
  swings: 1,
  distance: 15,
  height: 10.2,
  /** seconds of the roll the aim is averaged over, so the camera glides while the tesseract tips */
  ease: 1.6,
};

const render = {
  /** traced pixels per output pixel, per side: the most, with `auto` on, or always, with it off */
  scale: 0.5,
  /** output pixels per screen pixel, per side */
  output: 1,
  /** how many times denser the traced pixels are over the tesseract than over the rest, per side */
  focus: 3,
  /** trace each image over two frames, while edges and motion are still drawn every frame: twice the
   * time for tracing, and what is reflected or shadowed follows a frame or two behind */
  half: false,
  /** trace fewer pixels when the GPU can't keep up, more when it can */
  auto: true,
  /** GPU milliseconds a frame may take, with `auto` */
  budget: 12,
  /** frames blended at full size, to smooth edges: while anything moves, and while nothing does */
  sharpTrail: 8,
  /** the softboxes' light on the sweep worked out exactly, rather than sampled */
  exact: true,
  /** upscale beams from the traced pixels around that face the same way, not just the nearest four */
  smoothBeams: true,
  /** lists of beams and panes by screen tile, for the full size first look */
  tiles: true,
  /** keep the first pane's reflection apart, its history following the mirror image; and how many
   * traced images that history holds in motion */
  mirror: true,
  reflectTrail: 16,
  /** trace only half the bare sweep's pixels each image, in a checkerboard that swaps */
  checker: false,
  /** paths that land on the sweep after their first bounce take its bounced light from a texture and end */
  cache: true,
  /** blue noise for the first two bounces, instead of white */
  blueNoise: true,
  sharpStill: 24,
  /** paths per pixel per frame */
  spp: 1,
  /** and on the tesseract and what shows through its glass */
  sppTesseract: 4,
  /** the widest blur spacing along the beams, in traced pixels (0 for none) */
  blurBeams: 4,
  bounces: 4,
  /** frames averaged while anything moves, on the tesseract and on the studio */
  trail: 6,
  floorTrail: 20,
  /** and on the beams, traced and at full size: short, as reflections don't move with their surface */
  /** and on glass over the sweep: short, as the reflections in it move with the pane, not the sweep */
  glassTrail: 4,
  beamTrail: 3,
  beamSharp: 4,
  /** panes behind the first one on a path: reflect at random, only tint, or reflect once nothing has
   * moved for a second */
  innerPanes: "when still" as "reflect" | "tint" | "when still",
  /** edge-aware blur: how much, how hard it stops at changes in brightness, and the samples a pixel
   * needs before the blur gives way to it entirely */
  denoise: 1,
  edges: 3,
  /** the widest blur spacing used on the tesseract, in traced pixels (the studio gets all, up to 8) */
  blurTesseract: 1,
  settled: 400,
  exposure: 1,
  clamp: 8,
  view: "render" as "render" | "normals",
  /** for the offline film: a lens (its radius, and how far away it is sharp; 0 focuses on the
   * tesseract), and taking the traced image as it is, which a lens or a shutter needs */
  aperture: 0,
  focusAt: 0,
  raw: false,
};

const WALL_Z = -10;
const COVE = 5;

const loopSeconds = (name: keyof typeof paths) => {
  const moves = parseMoves(paths[name].moves);
  return moves.length * loopRepeats(moves) * (roll.seconds + roll.rest);
};
const DURATION = loopSeconds(roll.path) * 1000;

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("this needs WebGPU");
  // timestamps, where the browser allows them, so the bench can say what each pass costs
  const canTime = adapter.features.has("timestamp-query");
  // the trace writes five textures, one over the default limit; desktop GPUs allow eight
  if (adapter.limits.maxStorageTexturesPerShaderStage < 5) throw new Error("this needs five storage textures in a shader stage");
  const device = await adapter.requestDevice({
    requiredFeatures: canTime ? ["timestamp-query"] : [],
    requiredLimits: { maxStorageTexturesPerShaderStage: 5 },
  });
  device.addEventListener("uncapturederror", (e) => console.error("gpu:", (e as GPUUncapturedErrorEvent).error.message));
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const compile = (code: string) => {
    const module = device.createShaderModule({ code: common + code });
    module.getCompilationInfo().then((info) => {
      for (const m of info.messages) if (m.type === "error") console.error(`wgsl ${m.lineNum}:${m.linePos} ${m.message}`);
    });
    return module;
  };
  const traceModule = compile(traceCode);
  const postModule = compile(postCode);
  const tracePipeline = device.createComputePipeline({ layout: "auto", compute: { module: traceModule, entryPoint: "trace" } });
  const bakePipeline = device.createComputePipeline({ layout: "auto", compute: { module: traceModule, entryPoint: "bake" } });
  const upscalePipeline = device.createComputePipeline({ layout: "auto", compute: { module: traceModule, entryPoint: "upscale" } });
  const accumPipeline = device.createComputePipeline({ layout: "auto", compute: { module: postModule, entryPoint: "accumulate" } });
  const atrousPipeline = device.createComputePipeline({ layout: "auto", compute: { module: postModule, entryPoint: "atrous" } });
  /** one uniform per blur pass, holding its spacing */
  const ATROUS = 4;
  const spacings = Array.from({ length: ATROUS }, (_, k) => {
    const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Float32Array([1 << k, 0, 0, 0]));
    return b;
  });
  const showPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: postModule, entryPoint: "vs" },
    fragment: { module: postModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // Two sets of uniforms and scene: one for the full size passes, every frame, and one for the traced
  // image, which holds still while that is traced over two frames (see `half`).
  const UNIFORMS = 172;
  const uniforms = new Float32Array(UNIFORMS);
  const uniformBuffer = device.createBuffer({ size: UNIFORMS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const traceUniforms = new Float32Array(UNIFORMS);
  const traceUniformBuffer = device.createBuffer({ size: UNIFORMS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // layout of Scene in common.wgsl, in 4-byte words
  const OFF = { verts: 0, prev: 64, edges: 128, beams: 256, bounds: 512, panes: 640, lights: 1120, shown: 1248, prevPlanes: 1312, paneTint: 1408, end: 1504 };
  const sceneData = new ArrayBuffer(OFF.end * 4);
  const sceneF = new Float32Array(sceneData);
  const sceneU = new Uint32Array(sceneData);
  const sceneBuffer = device.createBuffer({ size: sceneData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const traceSceneBuffer = device.createBuffer({ size: sceneData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const PASSES = ["trace", "accumulate", "denoise", "upscale", "show"];
  const querySet = canTime ? device.createQuerySet({ type: "timestamp", count: PASSES.length * 2 }) : undefined;
  const queryResolve = device.createBuffer({ size: PASSES.length * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const queryRead = device.createBuffer({ size: PASSES.length * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const stamps = (k: number) => (querySet ? { querySet, beginningOfPassWriteIndex: k * 2, endOfPassWriteIndex: k * 2 + 1 } : undefined);
  const linear = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // blue noise, shifted differently for each dimension of a path and packed four dimensions to a texel
  const BLUE = 64;
  const BLUE_DIMS = 16;
  const blueTile = blueNoise(BLUE);
  const bluePacked = new Float32Array(BLUE * BLUE * BLUE_DIMS);
  for (let d = 0; d < BLUE_DIMS; d++) {
    const ox = Math.floor(((d * 0.7548776662) % 1) * BLUE);
    const oy = Math.floor(((d * 0.569840291) % 1) * BLUE);
    for (let y = 0; y < BLUE; y++)
      for (let x = 0; x < BLUE; x++)
        bluePacked[(((d >> 2) * BLUE + y) * BLUE + x) * 4 + (d & 3)] = blueTile[((y + oy) % BLUE) * BLUE + ((x + ox) % BLUE)];
  }
  const blue = device.createTexture({ size: [BLUE, BLUE * (BLUE_DIMS / 4)], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: blue }, bluePacked, { bytesPerRow: BLUE * 16 }, [BLUE, BLUE * (BLUE_DIMS / 4)]);

  // tables for exact light from rectangles (linearly transformed cosines), as three.js ships them
  RectAreaLightTexturesLib.init();
  const lib = RectAreaLightTexturesLib as unknown as Record<"LTC_HALF_1" | "LTC_HALF_2", { image: { data: Uint16Array<ArrayBuffer> } }>;
  const ltc = [lib.LTC_HALF_1, lib.LTC_HALF_2].map((t) => {
    const tex = device.createTexture({ size: [64, 64], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, t.image.data, { bytesPerRow: 64 * 8 }, [64, 64]);
    return tex;
  });
  const clampLinear = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // The sweep's bounced light (see `bake` in trace.wgsl): gathered a step a frame after anything in
  // the studio changes. A step reads the one texture and writes the other, which is then copied back.
  const CACHE = [128, 256];
  const cacheUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const cache = [0, 1].map(() => device.createTexture({ size: CACHE, format: "rgba16float", usage: cacheUsage }));
  const bakeStep = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const BAKE_STEPS = 64;
  let bakeAt = 0;
  let bakedFor = "";

  // topology never changes
  EDGES.forEach(([a, b, axis], k) => sceneU.set([a, b, axis, 0], OFF.edges + k * 4));

  // Traced textures are made at the most traced pixels allowed and used from the top left corner, so the
  // traced size can change from frame to frame without making anything; the output is the screen's.
  // Which beams and panes can be in front of each tile of the screen, a bit each, for the full size
  // first look: camera rays next to each other see the same few, so it needn't try all 32 and 24.
  const TILES = [64, 40];
  const tileBits = new Uint32Array(TILES[0] * TILES[1] * 2);
  const tileBuffer = device.createBuffer({ size: tileBits.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const seen = new Vector3();
  const writeTiles = (paneCorners: number[][]) => {
    tileBits.fill(0);
    const tanY = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    const tanX = tanY * camera.aspect;
    const inv = camera.matrixWorldInverse;
    /** screen box (in tiles) of a ball, or of a point with r = 0; undefined if it comes too near the eye */
    const box = (i: number, r: number) => {
      seen.fromArray(proj, i * 4).applyMatrix4(inv);
      const d = -seen.z;
      if (d - r < 0.05) return undefined;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const depth of [d - r, d + r])
        for (const s of [-r, r]) {
          const x = (seen.x + s) / (depth * tanX);
          const y = (seen.y + s) / (depth * tanY);
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      return [x0, x1, y0, y1];
    };
    const mark = (boxes: (number[] | undefined)[], slot: number, bit: number) => {
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const b of boxes) {
        if (!b) [x0, x1, y0, y1] = [-1, 1, -1, 1];
        else [x0, x1, y0, y1] = [Math.min(x0, b[0]), Math.max(x1, b[1]), Math.min(y0, b[2]), Math.max(y1, b[3])];
      }
      // to tiles, top left first, with a little over for the sample points moving inside pixels
      const pad = 0.004;
      const i0 = Math.max(0, Math.floor((x0 * 0.5 + 0.5 - pad) * TILES[0]));
      const i1 = Math.min(TILES[0] - 1, Math.floor((x1 * 0.5 + 0.5 + pad) * TILES[0]));
      const j0 = Math.max(0, Math.floor((0.5 - y1 * 0.5 - pad) * TILES[1]));
      const j1 = Math.min(TILES[1] - 1, Math.floor((0.5 - y0 * 0.5 + pad) * TILES[1]));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tileBits[(j * TILES[0] + i) * 2 + slot] |= 1 << bit;
    };
    EDGES.forEach(([a, b], k) => mark([box(a, proj[a * 4 + 3]), box(b, proj[b * 4 + 3])], 0, k));
    paneCorners.forEach((corners, k) => mark(corners.map((c) => box(c, 0)), 1, k));
    device.queue.writeBuffer(tileBuffer, 0, tileBits);
  };

  const bakeGroup = device.createBindGroup({
    layout: bakePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: sceneBuffer } },
      { binding: 9, resource: clampLinear },
      { binding: 23, resource: cache[0].createView() },
      { binding: 24, resource: cache[1].createView() },
      { binding: 25, resource: { buffer: bakeStep } },
    ],
  });
  type Groups = { low: GPUBindGroup[][]; upscale: GPUBindGroup[][]; show: GPUBindGroup[] };
  type Targets = { w: number; h: number; lw: number; lh: number; groups: Groups; textures: GPUTexture[] };
  let targets: Targets | undefined;
  const makeTargets = (w: number, h: number, lw: number, lh: number): Targets => {
    const tex = (format: GPUTextureFormat, big = false) =>
      device.createTexture({ size: big ? [w, h] : [lw, lh], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const color = tex("rgba16float");
    const expected = tex("rgba32float");
    const reflect = tex("rgba16float");
    const histR = [tex("rgba16float"), tex("rgba16float")];
    const sum = tex("rgba16float");
    // these three alternate from one traced image to the next: the last one's are its history, and
    // stay on show while the next is traced
    const hist = [tex("rgba16float"), tex("rgba16float")];
    const geo = [tex("rgba32float"), tex("rgba32float")];
    const normal = [tex("rgba16float"), tex("rgba16float")];
    const blur = [tex("rgba16float"), tex("rgba16float")];
    // and these two from frame to frame
    const sharp = [tex("rgba16float", true), tex("rgba16float", true)];
    const ub = { binding: 0, resource: { buffer: uniformBuffer } };
    const tub = { binding: 0, resource: { buffer: traceUniformBuffer } };
    const denoised = blur[(ATROUS - 1) & 1];
    const low = [0, 1].map((i) => [
      device.createBindGroup({
        layout: tracePipeline.getBindGroupLayout(0),
        entries: [
          tub,
          { binding: 1, resource: { buffer: traceSceneBuffer } },
          { binding: 2, resource: color.createView() },
          { binding: 3, resource: geo[i].createView() },
          { binding: 4, resource: expected.createView() },
          { binding: 5, resource: normal[i].createView() },
          { binding: 6, resource: blue.createView() },
          { binding: 7, resource: ltc[0].createView() },
          { binding: 8, resource: ltc[1].createView() },
          { binding: 9, resource: clampLinear },
          { binding: 10, resource: cache[0].createView() },
          { binding: 11, resource: reflect.createView() },
        ],
      }),
      device.createBindGroup({
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
          tub,
          { binding: 1, resource: color.createView() },
          { binding: 2, resource: geo[i].createView() },
          { binding: 3, resource: expected.createView() },
          { binding: 4, resource: hist[1 - i].createView() },
          { binding: 5, resource: geo[1 - i].createView() },
          { binding: 6, resource: hist[i].createView() },
          { binding: 20, resource: reflect.createView() },
          { binding: 21, resource: histR[1 - i].createView() },
          { binding: 22, resource: histR[i].createView() },
          { binding: 23, resource: sum.createView() },
        ],
      }),
      // the blur reads the history, then bounces between its two textures
      ...spacings.map((sp, k) =>
        device.createBindGroup({
          layout: atrousPipeline.getBindGroupLayout(0),
          entries: [
            tub,
            { binding: 10, resource: (k === 0 ? sum : blur[(k - 1) & 1]).createView() },
            { binding: 11, resource: geo[i].createView() },
            { binding: 12, resource: normal[i].createView() },
            { binding: 13, resource: blur[k & 1].createView() },
            { binding: 14, resource: { buffer: sp } },
          ],
        }),
      ),
    ]);
    // by which traced image is on show, then by frame
    const upscale = [0, 1].map((i) =>
      [0, 1].map((j) =>
        device.createBindGroup({
          layout: upscalePipeline.getBindGroupLayout(0),
          entries: [
            ub,
            { binding: 1, resource: { buffer: sceneBuffer } },
            { binding: 30, resource: denoised.createView() },
            { binding: 31, resource: geo[i].createView() },
            { binding: 32, resource: normal[i].createView() },
            { binding: 35, resource: sharp[1 - j].createView() },
            { binding: 36, resource: linear },
            { binding: 37, resource: sharp[j].createView() },
            { binding: 39, resource: { buffer: tileBuffer } },
          ],
        }),
      ),
    );
    const show = [0, 1].map((j) =>
      device.createBindGroup({
        layout: showPipeline.getBindGroupLayout(0),
        entries: [ub, { binding: 7, resource: sharp[j].createView() }, { binding: 8, resource: linear }],
      }),
    );
    return { w, h, lw, lh, groups: { low, upscale, show }, textures: [color, expected, reflect, sum, ...histR, ...normal, ...hist, ...geo, ...blur, ...sharp] };
  };
  const ensureTargets = (cw: number, ch: number) => {
    const w = Math.max(8, Math.round(cw * render.output));
    const h = Math.max(8, Math.round(ch * render.output));
    const lw = Math.max(8, Math.ceil(w * render.scale));
    const lh = Math.max(8, Math.ceil(h * render.scale));
    if (targets && targets.w === w && targets.h === h && targets.lw === lw && targets.lh === lh) return targets;
    targets?.textures.forEach((t) => t.destroy());
    targets = makeTargets(w, h, lw, lh);
    reset = true;
    return targets;
  };

  /** traced pixels per output pixel, as `auto` has it now */
  let traced = Math.min(render.scale, 0.3);
  const traceSize = (t: Targets, scale: number) => [Math.min(t.lw, Math.max(8, Math.round(t.w * scale))), Math.min(t.lh, Math.max(8, Math.round(t.h * scale)))];
  let lastTraceSize = [0, 0];
  /** frames since anything moved: inner panes start reflecting only once a still frame has gathered
   * enough that their noise comes in too faintly to see (a rest between rolls is too short) */
  let stillFrames = 0;

  // where the output's samples sit inside their pixels, frame by frame: Halton (2, 3)
  const halton = (i: number, b: number) => {
    let f = 1;
    let r = 0;
    for (; i > 0; i = Math.floor(i / b)) {
      f /= b;
      r += f * (i % b);
    }
    return r;
  };

  // a long lens, low, three quarters on, as for a product shot
  const camera = new PerspectiveCamera(28, width / height, 0.05, 200);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(5.6, 4.9, 16.8);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.15, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = MathUtils.degToRad(88);
  controls.update();

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  let reset = true;
  let frame = 0;
  const prevViewProj = new Matrix4();
  const viewProj = new Matrix4();
  const prevEye = new Vector3();

  let profile = makeProfile(roll);
  const remakeProfile = () => {
    profile = makeProfile(roll);
    reset = true;
  };

  /** softboxes: one sided rectangles facing their target */
  const softboxes = () => [
    { pos: [-6.5, 6.5, 5.5], target: [0, 1.2, 0], w: 4.5, h: 4.5, power: studio.key, color: [1, 0.97, 0.92] },
    { pos: [9, 3.2, 4.5], target: [0, 1.4, 0], w: 3, h: 6, power: studio.fill, color: [0.92, 0.96, 1] },
    { pos: [0, 9.5, -1], target: [0, 0, -1], w: 9, h: 2.4, power: studio.top, color: [1, 1, 1] },
    { pos: [-5, 5.5, -7.5], target: [0, 1.6, 0], w: 1.1, h: 7, power: studio.rim, color: new Color(studio.rimLeft).toArray() },
    { pos: [5.5, 5.5, -7.5], target: [0, 1.6, 0], w: 1.1, h: 7, power: studio.rim, color: new Color(studio.rimRight).toArray() },
    // a strip high over the back of the stage, washing down the sweep behind the tesseract
    { pos: [-1.5, 8.5, -6.5], target: [-2, 1, -10], w: 14, h: 1.4, power: studio.back, color: [1, 0.98, 0.95] },
  ];
  const writeLights = () => {
    const boxes = softboxes().filter((b) => b.power > 0);
    const n = new Vector3();
    const right = new Vector3();
    const up = new Vector3();
    const weights = boxes.map((b) => b.power * b.w * b.h);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cdf = 0;
    boxes.forEach((b, k) => {
      n.fromArray(b.target).sub(new Vector3().fromArray(b.pos)).normalize();
      right.set(0, 1, 0).cross(n);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(right, n);
      // cross(u, v) has to point the way it shines
      const U = up.clone().multiplyScalar(b.h / 2);
      const V = right.clone().multiplyScalar(-b.w / 2);
      if (new Vector3().crossVectors(U, V).dot(n) < 0) V.negate();
      const p = weights[k] / total;
      cdf += p;
      const o = OFF.lights + k * 16;
      sceneF.set([...b.pos, k === boxes.length - 1 ? 1 : cdf], o);
      sceneF.set([U.x, U.y, U.z, b.w * b.h], o + 4);
      sceneF.set([V.x, V.y, V.z, p], o + 8);
      sceneF.set([b.color[0] * b.power, b.color[1] * b.power, b.color[2] * b.power, 0], o + 12);
    });
    return boxes.length;
  };

  const paneMask = () => {
    const w = 1 << 3;
    return FACES.map(([, , , , axes]) => {
      const joining = (axes & w) !== 0;
      return look.panes === "all" || (look.panes === "joining" && joining) || (look.panes === "cubes" && !joining) ? 1 : 0;
    });
  };

  const finish = (f: Finish) => {
    const c = ({ ...metals, ...plastics, ...glasses } as Record<string, readonly number[]>)[f];
    // 1 metal, 2 solid glass, 0 lacquer
    return { c, kind: f in metals ? 1 : f in glasses ? 2 : 0 };
  };
  /** dichroic panes, by the pair of original directions they span */
  const PANE_COLOURS: Record<number, number[]> = {
    3: [1, 0.5, 0.4],
    5: [0.45, 0.95, 0.55],
    6: [0.45, 0.55, 1],
    9: [0.4, 0.9, 1],
    10: [1, 0.45, 0.85],
    12: [1, 0.9, 0.4],
  };

  /** where the tesseract stands on the floor (x, z) at a time in the loop */
  const centreAt = (time: number) => {
    const p = paths[roll.path];
    const pose = poseAt(time, parseMoves(p.moves), { rollTime: roll.seconds, pause: roll.rest, beam: roll.beam, start: p.start as unknown as [number, number], profile });
    const eyeW = pose.centre[3] + roll.distance;
    let x = 0;
    let z = 0;
    for (const v of pose.corners) {
      const q = project(v, eyeW, roll.distance, roll.beam);
      x += q.x / 16;
      z += q.z / 16;
    }
    return [x, z];
  };

  /** how a path goes round on the floor: the angle it starts at about its middle, halfway through
   * its first roll, and how many times a loop it turns (once for one that goes nowhere) */
  const orbits = new Map<string, { start: number; turn: number }>();
  const orbitOf = (name: keyof typeof paths) => {
    const key = `${name} ${roll.seconds} ${roll.rest} ${roll.distance}`;
    let o = orbits.get(key);
    if (!o) {
      const whole = loopSeconds(name);
      const N = 96;
      const pts = Array.from({ length: N }, (_, i) => centreAt((i / N) * whole));
      const mx = pts.reduce((a, c) => a + c[0], 0) / N;
      const mz = pts.reduce((a, c) => a + c[1], 0) / N;
      // how many times it goes round its middle in a loop, signed
      let wound = 0;
      for (let i = 0; i < N; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % N];
        if (Math.hypot(a[0] - mx, a[1] - mz) < 1e-3 || Math.hypot(b[0] - mx, b[1] - mz) < 1e-3) continue;
        let d = Math.atan2(b[1] - mz, b[0] - mx) - Math.atan2(a[1] - mz, a[0] - mx);
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        wound += d;
      }
      const turn = Math.round(wound / (2 * Math.PI)) || 1;
      // the best steady turn through the angles it is really at
      let sin = 0;
      let cos = 0;
      for (let i = 0; i < N; i++) {
        const r = Math.hypot(pts[i][0] - mx, pts[i][1] - mz);
        if (r < 1e-3) continue;
        const d = Math.atan2(pts[i][1] - mz, pts[i][0] - mx) - turn * ((2 * Math.PI * i) / N);
        sin += Math.sin(d) * r;
        cos += Math.cos(d) * r;
      }
      o = { start: Math.hypot(sin, cos) > 1e-3 ? Math.atan2(sin, cos) : Math.PI / 2, turn };
      orbits.set(key, o);
    }
    return o;
  };

  const tint = new Color();
  const proj = new Float32Array(64);
  let lastProj = new Float32Array(64);
  const bound = { x: 0, y: 0, z: 0, r: 0 };
  let paneCount = 0;
  /** the corners of each pane in use, in the order they are packed */
  let glazed: number[][] = [];
  /** places the tesseract at `time` seconds into the loop and returns whether it moved */
  const writeTesseract = (time: number) => {
    const p = paths[roll.path];
    const moves = parseMoves(p.moves);
    const pose = poseAt(time, moves, { rollTime: roll.seconds, pause: roll.rest, beam: roll.beam, start: p.start as unknown as [number, number], profile });
    // the 4D eye follows the tesseract in w, so rolling inside out happens in place
    const eyeW = pose.centre[3] + roll.distance;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    pose.corners.forEach((v, i) => {
      const q = project(v, eyeW, roll.distance, roll.beam);
      proj.set([q.x, q.y, q.z, q.r], i * 4);
      cx += q.x / 16;
      cy += q.y / 16;
      cz += q.z / 16;
    });
    let r = 0;
    for (let i = 0; i < 16; i++) r = Math.max(r, Math.hypot(proj[i * 4] - cx, proj[i * 4 + 1] - cy, proj[i * 4 + 2] - cz) + proj[i * 4 + 3]);
    Object.assign(bound, { x: cx, y: cy, z: cz, r: r * 1.001 + 1e-3 });

    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    const e = new Vector3();
    EDGES.forEach(([i, j], k) => {
      sceneF.set(proj.subarray(i * 4, i * 4 + 4), OFF.beams + k * 8);
      sceneF.set(proj.subarray(j * 4, j * 4 + 4), OFF.beams + k * 8 + 4);
      a.fromArray(proj, i * 4);
      b.fromArray(proj, j * 4);
      const r = Math.max(proj[i * 4 + 3], proj[j * 4 + 3]);
      c.addVectors(a, b).multiplyScalar(0.5);
      sceneF.set([c.x, c.y, c.z, a.distanceTo(b) / 2 + r + 1e-4], OFF.bounds + k * 4);
    });
    // glazed squares, each as its plane and four edge planes facing in
    const mask = paneMask();
    let panes = 0;
    FACES.forEach((f, k) => {
      if (!mask[k]) return;
      const at = (q: number) => new Vector3().fromArray(proj, f[q & 3] * 4);
      n.copy(at(2)).sub(at(0)).cross(at(3).sub(at(1))).normalize();
      c.set(0, 0, 0);
      for (let q = 0; q < 4; q++) c.addScaledVector(at(q), 0.25);
      const o = OFF.panes + panes * 20;
      sceneF.set([n.x, n.y, n.z, n.dot(at(0))], o);
      let colour = [...tint.set(look.tint).toArray(), 0];
      if (look.glass === "dichroic") colour = [...PANE_COLOURS[f[4]], look.dichroic];
      if (look.glass === "coloured") {
        // dealt by the square's own number, so a pane keeps its colour as panes are switched on and off
        const five = palettes[look.palette % palettes.length];
        let h = Math.imul(k + 1, 2654435761) ^ Math.imul(look.deal + 1, 40503);
        h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
        tint.set(five[h % five.length]);
        colour = [...tint.toArray().map((v) => 1 + (v - 1) * look.depth), 0];
      }
      sceneF.set(colour, OFF.paneTint + panes * 4);
      for (let q = 0; q < 4; q++) {
        a.copy(at(q));
        e.crossVectors(n, b.copy(at(q + 1)).sub(a)).normalize();
        if (e.dot(c) < e.dot(a)) e.negate();
        sceneF.set([e.x, e.y, e.z, e.dot(a)], o + 4 + q * 4);
      }
      panes++;
    });
    paneCount = panes;
    glazed = FACES.filter((_, k) => mask[k]).map((f) => f.slice(0, 4));
    const metalB = look.wEdges !== look.frame;
    EDGES.forEach(([, , axis], k) => (sceneU[OFF.edges + k * 4 + 3] = metalB && axis === 3 ? 1 : 0));

    let moved = false;
    for (let k = 0; k < 64; k++) if (Math.abs(proj[k] - lastProj[k]) > 1e-7) moved = true;
    sceneF.set(proj, OFF.verts);
    sceneF.set(reset ? proj : lastProj, OFF.prev);
    lastProj = proj.slice();
    return moved;
  };

  // The traced grid's uneven spread (see common.wgsl): the tesseract's span of the screen, with room
  // around it, is `focus` times as dense as the rest, each way.
  let warp = [
    [0.25, 0.75, 0.25, 0.75],
    [0.25, 0.75, 0.25, 0.75],
  ];
  let lastWarp = warp;
  const centre = new Vector3();
  const writeWarp = () => {
    centre.set(bound.x, bound.y, bound.z);
    const dist = centre.distanceTo(camera.position);
    const tanY = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    centre.project(camera);
    // half the sphere's size on screen, in 0..1 of its height, and some room for its contact shadow
    const half = (bound.r / Math.sqrt(Math.max(dist * dist - bound.r * bound.r, 1e-6)) / tanY / 2) * 1.12;
    const span = (c: number, h: number) => {
      // on a grid of sixteenths, so the grid holds still for a while as the tesseract moves and
      // history is looked up pixel for pixel, not between pixels
      const a0 = Math.min(0.875, Math.max(1 / 32, Math.floor((c - h) * 16) / 16));
      const a1 = Math.max(a0 + 1 / 16, Math.min(31 / 32, Math.ceil((c + h) * 16) / 16));
      const w = a1 - a0;
      const k = render.focus;
      const all = k * w + 1 - w;
      return [a0, a1, a0 / all, (a0 + k * w) / all];
    };
    lastWarp = warp;
    warp = [span(centre.x * 0.5 + 0.5, half / camera.aspect), span(0.5 - centre.y * 0.5, half)];
  };

  const sweep = new Color();
  const glow = new Color();
  /** a traced image: the tesseract, camera, grid and size it is traced with */
  type Shot = { planes: Float32Array; proj: Float32Array; viewProj: Matrix4; eye: Vector3; basis: number[][]; warp: number[][]; res: number[]; index: number };
  const basisNow = () => {
    const e = camera.matrixWorld.elements;
    const tanY = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    return [
      [e[0], e[1], e[2], tanY * camera.aspect],
      [e[4], e[5], e[6], tanY],
      [-e[8], -e[9], -e[10], render.spp],
    ];
  };
  /**
   * Fills a set of uniforms. `from` is what its history was made with: last frame for the full size
   * passes, the traced image before for the trace. `shown` is the traced image on show.
   */
  const fillUniforms = (
    into: Float32Array,
    t: Targets,
    o: {
      res: number[];
      from: { viewProj: Matrix4; eye: Vector3; warp: number[][]; res: number[] };
      shown: Shot;
      still: boolean;
      index: number;
      lights: number;
      half: number;
      /** history lengths are in traced images: at half rate each stands for two frames */
      trail: number;
    },
  ) => {
    into.set(o.from.viewProj.elements, 0);
    const A = finish(look.frame);
    const B = finish(look.wEdges);
    tint.set(look.tint);
    sweep.set(studio.sweep);
    const cap = (n: number) => (reset ? 1 : o.still ? 4000 : Math.max(1, Math.ceil(n * o.trail)));
    const rows = [
      [camera.position.x, camera.position.y, camera.position.z, o.index],
      ...basisNow(),
      [o.res[0], o.res[1], 1 / o.res[0], 1 / o.res[1]],
      [o.from.eye.x, o.from.eye.y, o.from.eye.z, cap(render.trail)],
      [bound.x, bound.y, bound.z, bound.r],
      [render.exposure, render.bounces, o.still && !reset ? 1 : 0, o.lights],
      [...A.c, look.roughness],
      [...B.c, look.roughness],
      [sweep.r, sweep.g, sweep.b, studio.sheen],
      [tint.r, tint.g, tint.b, paneCount],
      [WALL_Z, COVE, studio.ambient, render.clamp],
      [A.kind, B.kind, render.view === "normals" ? 1 : 0, cap(render.floorTrail)],
      [render.denoise, render.edges, render.settled, render.exact ? 1 : 0],
      [t.w, t.h, 1 / t.w, 1 / t.h],
      [halton((frame % 16) + 1, 2) - 0.5, halton((frame % 16) + 1, 3) - 0.5, o.still ? render.sharpStill : render.sharpTrail, reset ? 1 : 0],
      warp[0],
      warp[1],
      o.from.warp[0],
      o.from.warp[1],
      [
        Math.max(1, Math.ceil(render.beamTrail * o.trail)),
        render.beamSharp,
        render.innerPanes === "tint" || (render.innerPanes === "when still" && stillFrames < 60) ? 1 : 0,
        Math.max(1, Math.ceil(render.glassTrail * o.trail)),
      ],
      [look.ior, render.sppTesseract, render.blurBeams, o.half],
      [o.from.res[0], o.from.res[1], render.blueNoise ? BLUE_DIMS : 0, render.blurTesseract],
    ];
    rows.forEach((row, k) => into.set(row, 16 + k * 4));
    const at = 16 + rows.length * 4;
    into.set(o.shown.viewProj.elements, at);
    const rest = [
      [o.shown.eye.x, o.shown.eye.y, o.shown.eye.z, render.cache && render.exact ? 1 : 0],
      ...o.shown.basis,
      [o.shown.res[0], o.shown.res[1], 1 / o.shown.res[0], 1 / o.shown.res[1]],
      o.shown.warp[0],
      o.shown.warp[1],
      [["plain", "grid", "window", "gradient"].indexOf(studio.softbox), look.film, look.mirrored, render.tiles ? 1 : 0],
      [render.aperture, render.focusAt || camera.position.distanceTo(centre.set(bound.x, bound.y, bound.z)), render.raw ? 1 : 0, 0],
      [...glow.set(look.glowColor).toArray().map((v) => v * look.glow), render.smoothBeams ? 1 : 0],
      [render.checker ? 1 : 0, cap(render.reflectTrail), render.mirror ? 1 : 0, 0],
    ];
    rest.forEach((row, k) => into.set(row, at + 16 + k * 4));
  };

  const gui = new GUI({ title: "rolling tesseract" });
  const live = { traced: "" };
  const changed = () => (reset = true);
  const g1 = gui.addFolder("roll");
  g1.add(roll, "path", ["wander", "inside out", "across"]).onChange(changed);
  g1.add(roll, "seconds", 0.4, 4, 0.05).name("seconds a roll");
  g1.add(roll, "rest", 0, 3, 0.05).name("rest between");
  g1.add(roll, "distance", 1.6, 12, 0.05).name("4D eye distance").onChange(changed);
  g1.add(roll, "beam", 0.01, 0.15, 0.001).onChange(changed);
  g1.add(roll, "hesitate", 0.05, 1, 0.01).onFinishChange(remakeProfile);
  g1.add(roll, "bounce", 0, 0.6, 0.01).onFinishChange(remakeProfile);
  const g2 = gui.addFolder("look");
  g2.add(look, "frame", finishes).onChange(changed);
  g2.add(look, "wEdges", finishes).name("w edges").onChange(changed);
  g2.add(look, "roughness", 0, 0.6, 0.005).onChange(changed);
  g2.add(look, "panes", ["none", "cubes", "joining", "all"]).onChange(changed);
  g2.add(look, "ior", 1.1, 3, 0.01).name("glass reflects (ior)").onChange(changed);
  g2.add(look, "glass", ["plain", "dichroic", "coloured"]).onChange(changed);
  g2.add(look, "palette", 0, palettes.length - 1, 1).onChange(changed);
  g2.add(look, "deal", 0, 50, 1).name("deal the colours").onChange(changed);
  g2.add(look, "depth", 0.1, 1, 0.01).name("colour depth").onChange(changed);
  g2.add(look, "dichroic", 0, 1, 0.01).name("dichroic strength").onChange(changed);
  g2.add(look, "film", 0, 900, 5).name("thin film (nm)").onChange(changed);
  g2.add(look, "mirrored", 0, 0.95, 0.01).name("mirrored panes").onChange(changed);
  g2.add(look, "glow", 0, 40, 0.5).name("w edges glow").onChange(changed);
  g2.addColor(look, "glowColor").name("glow colour").onChange(changed);
  g2.addColor(look, "tint").name("glass tint").onChange(changed);
  const g3 = gui.addFolder("studio");
  g3.add(studio, "softbox", ["plain", "grid", "window", "gradient"]).name("softbox faces").onChange(changed);
  g3.add(studio, "setup", ["soft white", "low key", "gloss floor", "gels"]).onChange((k: keyof typeof setups) => {
    Object.assign(studio, setups[k]);
    render.exposure = studio.exposure;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    changed();
  });
  g3.addColor(studio, "sweep").onChange(changed);
  g3.add(studio, "sheen", 0.05, 1, 0.01).onChange(changed);
  g3.add(studio, "key", 0, 20, 0.1).onChange(changed);
  g3.add(studio, "fill", 0, 10, 0.05).onChange(changed);
  g3.add(studio, "top", 0, 10, 0.05).onChange(changed);
  g3.add(studio, "rim", 0, 40, 0.1).onChange(changed);
  g3.addColor(studio, "rimLeft").name("rim left").onChange(changed);
  g3.addColor(studio, "rimRight").name("rim right").onChange(changed);
  g3.add(studio, "back", 0, 30, 0.1).name("background").onChange(changed);
  g3.add(studio, "ambient", 0, 0.5, 0.005).onChange(changed);
  const g5 = gui.addFolder("camera");
  g5.add(follow, "on").name("follow the tesseract");
  g5.add(follow, "mode", ["orbit", "swing"]);
  g5.add(follow, "side", -180, 180, 1).name("orbit: side (degrees)");
  g5.add(follow, "swing", 0, 85, 1).name("swing (degrees)");
  g5.add(follow, "swings", 0, 4, 1).name("swings a loop");
  g5.add(follow, "distance", 6, 24, 0.1);
  g5.add(follow, "height", 0.5, 12, 0.1);
  g5.add(follow, "ease", 0, 4, 0.05).name("ease (seconds)");
  const g4 = gui.addFolder("render");
  g4.add(render, "half").name("trace at half rate");
  g4.add(render, "auto").name("auto resolution");
  g4.add(render, "budget", 4, 40, 0.5).name("gpu ms budget");
  g4.add(render, "scale", 0.15, 1, 0.01).name("traced, at most").onChange((v: number) => {
    traced = Math.min(traced, v);
    changed();
  });
  g4.add(render, "focus", 1, 6, 0.1).name("focus on tesseract").onChange(changed);
  g4.add(live, "traced").name("traced now").listen().disable();
  g4.add(render, "output", 0.25, 1, 0.05).name("output size").onChange(changed);
  g4.add(render, "blueNoise").name("blue noise");
  g4.add(render, "exact").name("exact softboxes").onChange(changed);
  g4.add(render, "cache").name("studio light cache").onChange(changed);
  g4.add(render, "tiles").name("first look by tiles");
  g4.add(render, "smoothBeams").name("smooth beams");
  g4.add(render, "mirror").name("glass mirror history").onChange(changed);
  g4.add(render, "reflectTrail", 1, 60, 1).name("reflection frames");
  g4.add(render, "checker").name("sweep checkerboard").onChange(changed);
  g4.add(render, "sharpTrail", 1, 32, 1).name("edge frames moving");
  g4.add(render, "sharpStill", 1, 64, 1).name("edge frames still");
  g4.add(render, "spp", 1, 16, 1).name("paths, studio");
  g4.add(render, "sppTesseract", 1, 16, 1).name("paths, tesseract");
  g4.add(render, "blurBeams", [0, 1, 2, 4, 8]).name("denoise along beams");
  g4.add(render, "bounces", 1, 8, 1).onChange(changed);
  g4.add(render, "trail", 1, 30, 1).name("frames in motion");
  g4.add(render, "beamTrail", 1, 30, 1).name("beam frames");
  g4.add(render, "glassTrail", 1, 30, 1).name("glass frames");
  g4.add(render, "beamSharp", 1, 32, 1).name("beam edge frames");
  g4.add(render, "innerPanes", ["reflect", "tint", "when still"]).name("inner panes").onChange(changed);
  g4.add(render, "floorTrail", 1, 60, 1).name("studio frames");
  g4.add(render, "denoise", 0, 1, 0.01);
  g4.add(render, "blurTesseract", [0, 1, 2, 4, 8]).name("denoise tesseract");
  g4.add(render, "edges", 0.5, 10, 0.1).name("denoise edges");
  g4.add(render, "settled", 16, 4000, 1).name("denoise until spp");
  g4.add(render, "exposure", 0.2, 3, 0.01);
  g4.add(render, "clamp", 1, 100, 1).name("firefly clamp").onChange(changed);
  g4.add(render, "view", ["render", "normals"]).onChange(changed);

  let lastViewProj = new Matrix4();
  const tess = {
    /** set to seconds into the loop to hold the roll there, for stills */
    hold: undefined as number | undefined,
    camera,
    controls,
    roll,
    follow,
    look,
    studio,
    render,
    paths,
    loopSeconds: () => loopSeconds(roll.path),
    refresh: changed,
    get frame() {
      return frame;
    },
    bench: async (frames = 30) => 0,
    /** GPU milliseconds of each pass, averaged over `frames` (needs timestamp queries) */
    passes: async (frames = 30) => ({}) as Record<string, number>,
    still: false,
    /** gather on though the tesseract moves, for a shutter's motion blur in the offline film */
    blend: false,
    /** stops the page's own loop drawing, so a bench times only its own frames */
    paused: false,
  };
  (window as any).__tess = tess;

  let lastSize = { width, height, playhead: 0 };
  const due = frameCap(60);
  let recording = false;
  wrap.render = (props) => {
    lastSize = { width: props.width, height: props.height, playhead: props.playhead };
    recording = props.recording;
    // an exported frame is always drawn; on screen, no more than 60 a second
    if (!recording && (tess.paused || !due())) return;
    // timed whenever the last timing has come back, for `auto` to steer by
    draw(props.playhead, props.width, props.height, render.auto && !recording)?.then(steer);
    stats.update();
  };

  // Auto resolution. Tracing and its denoising cost about the traced pixel count, the full size passes
  // a fixed amount; so the traced side is scaled by the square root of what's left of the budget over
  // what tracing took, a few frames' worth at a time, and only when that's worth a change.
  let measured: { vary: number; fixed: number }[] = [];
  const steer = (ms: Record<string, number>) => {
    if (!render.auto || recording) return;
    // not the show pass: on Apple GPUs it overlaps the compute passes, so its stamps span their time too
    measured.push({ vary: ms.trace + ms.accumulate + ms.denoise, fixed: ms.upscale });
    const mid = (k: "vary" | "fixed") => measured.map((m) => m[k]).sort((a, b) => a - b)[measured.length >> 1];
    const vary = mid("vary");
    const room = Math.max(1, render.budget - mid("fixed"));
    // far over the budget frames are slow and timings few, so one is enough to act on
    const far = vary > room * 1.5;
    if (measured.length < (far ? 1 : 4)) return;
    measured = [];
    // while nothing moves the traced size stays, or the history would start over at every change;
    // unless it is far too slow, which would make the first frames of the next move crawl
    if (tess.still && !far) return;
    const want = Math.min(render.scale, Math.max(0.15, traced * Math.min(1.15, Math.max(0.5, Math.sqrt(room / vary)))));
    if (Math.abs(want / traced - 1) > 0.08) traced = want;
    live.traced = `${Math.round(traced * 100)}%`;
  };

  tess.bench = async (frames = 30) => {
    const was = tess.paused;
    tess.paused = true;
    await timing;
    await device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) {
      draw(lastSize.playhead, lastSize.width, lastSize.height);
      await device.queue.onSubmittedWorkDone();
    }
    tess.paused = was;
    return (performance.now() - t0) / frames;
  };
  tess.passes = async (frames = 30) => {
    if (!querySet) return {};
    const was = tess.paused;
    tess.paused = true;
    const sum: Record<string, number> = {};
    // at half rate only the frame that finishes a traced image is timed (its trace is half an image)
    let timed = 0;
    for (let k = 0; k < frames; k++) {
      await timing;
      const ms = await draw(lastSize.playhead, lastSize.width, lastSize.height, true);
      if (!ms) continue;
      timed++;
      for (const n in ms) sum[n] = (sum[n] ?? 0) + ms[n];
    }
    tess.paused = was;
    return Object.fromEntries(Object.entries(sum).map(([n, v]) => [n, +(v / timed).toFixed(2)]));
  };

  /** the timestamps of a frame on their way back, if any are */
  let timing: Promise<Record<string, number>> | undefined;

  /** the traced image on show, the one being traced (at half rate), and the last one finished */
  let shown: Shot | undefined;
  let pending: Shot | undefined;
  let images = 0;
  let movedSince = false;
  const traceScene = new Float32Array(OFF.end);

  const draw = (playhead: number, width: number, height: number, timed = false) => {
    const t = ensureTargets(canvas.width, canvas.height);
    // the export runs on the sketch's own loop; other paths repeat inside it on their own length
    const time = tess.hold ?? ((playhead * DURATION) / 1000) % loopSeconds(roll.path);
    controls.enabled = !follow.on;
    if (follow.on) {
      // Worked out from the time alone, so it loops with the roll and a held frame is exact: the aim
      // is the tesseract's place averaged over a stretch of the roll, the angle a slow swing.
      const whole = loopSeconds(roll.path);
      let x = 0;
      let z = 0;
      const TAPS = 12;
      for (let k = 0; k < TAPS; k++) {
        const c = centreAt((((time + ((k + 0.5) / TAPS - 0.5) * follow.ease) % whole) + whole) % whole);
        x += c[0] / TAPS;
        z += c[1] / TAPS;
      }
      let angle = MathUtils.degToRad(follow.swing) * Math.sin((2 * Math.PI * follow.swings * time) / whole);
      let px = x + Math.sin(angle) * follow.distance;
      let pz = z + Math.cos(angle) * follow.distance;
      if (follow.mode === "orbit") {
        // a steady turn, as many times a loop and the way the tesseract goes round: it runs ahead and rests in
        // turn, the camera keeps the average, so each roll is seen as the one before was
        const o = orbitOf(roll.path);
        angle = o.start + o.turn * ((2 * Math.PI * time) / whole) + MathUtils.degToRad(follow.side) * Math.sign(o.turn);
        px = x + Math.cos(angle) * follow.distance;
        pz = z + Math.sin(angle) * follow.distance;
        // not through the back wall: the far side of the circle is pressed flat against it
        const back = WALL_Z + 1.5;
        pz = back + Math.log1p(Math.exp((pz - back) * 2)) / 2;
      }
      controls.target.set(x, 1.15, z);
      camera.position.set(px, follow.height, pz);
      camera.lookAt(controls.target);
    } else {
      controls.update();
    }
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const moved = writeTesseract(time);
    const lights = writeLights();
    writeWarp();
    writeTiles(glazed);
    let still = !moved;
    const a = viewProj.elements;
    const b = lastViewProj.elements;
    for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-7) still = false;
    if (reset) {
      prevViewProj.copy(viewProj);
      prevEye.copy(camera.position);
      lastWarp = warp;
      shown = pending = undefined;
    }
    if (tess.blend && !reset) still = true;
    tess.still = still;
    stillFrames = still ? stillFrames + 1 : 0;
    movedSince ||= !still;

    const encoder = device.createCommandEncoder();
    // the studio's bounced light, a step a frame until it has settled
    const studioNow = JSON.stringify([studio, softboxes()]);
    if (studioNow !== bakedFor) {
      bakedFor = studioNow;
      bakeAt = 0;
    }
    if (bakeAt < BAKE_STEPS) {
      device.queue.writeBuffer(bakeStep, 0, new Float32Array([bakeAt, 0, 0, 0]));
      const bp = encoder.beginComputePass();
      bp.setPipeline(bakePipeline);
      bp.setBindGroup(0, bakeGroup);
      bp.dispatchWorkgroups(CACHE[0] / 8, CACHE[1] / 8);
      bp.end();
      encoder.copyTextureToTexture({ texture: cache[1] }, { texture: cache[0] }, CACHE);
      bakeAt++;
      // what was gathered while the cache was still filling is a little dark
      if (bakeAt === BAKE_STEPS) reset = true;
    }
    const run = (k: number, pipeline: GPUComputePipeline, sets: GPUBindGroup[], w: number, h: number, stamped: boolean) => {
      const cp = encoder.beginComputePass({ timestampWrites: stamped ? stamps(k) : undefined });
      cp.setPipeline(pipeline);
      for (const g of sets) {
        cp.setBindGroup(0, g);
        cp.dispatchWorkgroups(Math.ceil(w / 8), h);
      }
      cp.end();
    };

    // The traced image. All in this frame, or (`half`) every other band of rows now and the rest next
    // frame, with the tesseract and camera as they are now for both.
    const half = render.half && !recording && !reset;
    let finished = false;
    let doTime = false;
    if (!pending) {
      const res = traceSize(t, render.auto && !recording ? traced : render.scale);
      const planes = new Float32Array(96);
      for (let k = 0; k < 24; k++) planes.set(sceneF.subarray(OFF.panes + k * 20, OFF.panes + k * 20 + 4), k * 4);
      const shot: Shot = { planes, proj: proj.slice(), viewProj: viewProj.clone(), eye: camera.position.clone(), basis: basisNow(), warp, res, index: images & 1 };
      const from = shown ?? shot;
      // a change of traced size is a move as far as the traced history goes: it has to be looked up anew
      const stillImage = !movedSince && !!shown && from.res[0] === res[0] && from.res[1] === res[1];
      movedSince = false;
      traceScene.set(sceneF);
      traceScene.set(from.proj, OFF.prev);
      traceScene.set(from.planes, OFF.prevPlanes);
      device.queue.writeBuffer(traceSceneBuffer, 0, traceScene);
      fillUniforms(traceUniforms, t, { res, from, shown: shot, still: stillImage, index: images, lights, half: half ? 1 : 0, trail: half ? 0.5 : 1 });
      device.queue.writeBuffer(traceUniformBuffer, 0, traceUniforms);
      const bands = Math.ceil(res[1] / 8);
      doTime = timed && !!querySet && !timing && !half;
      run(0, tracePipeline, [t.groups.low[shot.index][0]], res[0], half ? Math.ceil(bands / 2) : bands, doTime);
      pending = shot;
      finished = !half;
    } else {
      // the other half: only which half changes
      traceUniforms[16 + 22 * 4 + 3] = 2;
      device.queue.writeBuffer(traceUniformBuffer, 0, traceUniforms);
      doTime = timed && !!querySet && !timing;
      run(0, tracePipeline, [t.groups.low[pending.index][0]], pending.res[0], Math.floor(Math.ceil(pending.res[1] / 8) / 2), doTime);
      finished = true;
    }
    if (finished && pending) {
      const low = t.groups.low[pending.index];
      const bands = Math.ceil(pending.res[1] / 8);
      run(1, accumPipeline, [low[1]], pending.res[0], bands, doTime);
      run(2, atrousPipeline, low.slice(2, 2 + ATROUS), pending.res[0], bands, doTime);
      shown = pending;
      pending = undefined;
      images++;
      lastTraceSize = shown.res;
    }

    // Full size, every frame. Until the first traced image is done there is nothing to show from.
    const on = shown!;
    sceneF.set(on.proj, OFF.shown);
    device.queue.writeBuffer(sceneBuffer, 0, sceneData);
    fillUniforms(uniforms, t, {
      res: on.res,
      from: { viewProj: prevViewProj, eye: prevEye, warp: lastWarp, res: on.res },
      shown: on,
      still,
      index: frame,
      lights,
      half: 0,
      trail: 1,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    const rows = Math.ceil(t.h / 8);
    run(3, upscalePipeline, [t.groups.upscale[on.index][frame & 1]], t.w, rows, doTime);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
      timestampWrites: doTime ? stamps(4) : undefined,
    });
    pass.setPipeline(showPipeline);
    pass.setBindGroup(0, t.groups.show[frame & 1]);
    pass.draw(3);
    pass.end();
    if (doTime) {
      encoder.resolveQuerySet(querySet!, 0, PASSES.length * 2, queryResolve, 0);
      encoder.copyBufferToBuffer(queryResolve, 0, queryRead, 0, PASSES.length * 16);
    }
    device.queue.submit([encoder.finish()]);

    prevViewProj.copy(viewProj);
    lastViewProj.copy(viewProj);
    prevEye.copy(camera.position);
    reset = false;
    frame++;
    if (!doTime) return undefined;
    timing = queryRead.mapAsync(GPUMapMode.READ).then(() => {
      const ts = new BigInt64Array(queryRead.getMappedRange());
      const ms = Object.fromEntries(PASSES.map((n, i) => [n, Number(ts[i * 2 + 1] - ts[i * 2]) / 1e6]));
      queryRead.unmap();
      timing = undefined;
      return ms;
    });
    return timing;
  };

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
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: DURATION,
  // no playFps: ssam's drops frames (see cap.ts), so the render caps itself at 60
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
