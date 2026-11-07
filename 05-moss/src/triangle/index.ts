import { Matrix4, Vector3 } from "three";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import commonCode from "../common.wgsl?raw";
import { dropMesh, fruitMesh, scatter, shootMesh, surfaceNets, type Solid } from "../mesh";
import mossCode from "../moss.wgsl?raw";
import postCode from "../post.wgsl?raw";
import shadeCode from "../shade.wgsl?raw";
import shootsCode from "../shoots.wgsl?raw";
import ballCode from "./ball.wgsl?raw";
import blockCode from "./block.wgsl?raw";
import cullCode from "./cull.wgsl?raw";
import pathCode from "./path.wgsl?raw";
import planCode from "./plan.wgsl?raw";
import sceneCode from "./scene.wgsl?raw";
import surfaceCode from "./surface.wgsl?raw";
import stoneCode from "./stone.wgsl?raw";

const STONES = 9;
const STEP = 3.2;
/** half a stone's side, and how far its surface stands from that on top */
const STONE = 0.94;
const LIFT = 0.03;
/** shoots planted per unit of area. The panel's density is a share of these */
const MOST_SHOOTS = 1600;
/** the path's distance grid, per stone */
const N = 128;
const SAMPLES = 4;
/** where the ball comes down, along the path: the second stone, which is about to set off */
const LANDING = 1;
/** when in a hop it comes down, and the share of a hop it then spends on the stone, being carried */
const TOUCHDOWN = 0.1;
const CONTACT = 0.32;
const RADIUS = 0.5;
/** the moss ball: strands planted over its sphere, and the three speeds they swing at against the panel's */
const STRANDS = 8000;
const SPEEDS = [1.35, 1, 0.72];
const STRAND_LEAF = 2.7;
const STRAND_CROWN = 13;
/** how far behind a stone the tips of its moss are, in seconds */
const SWAY = 0.13;
/**
 * These stones are about two centimetres across, so against the ring a leaf is many times the size.
 * With the leaves only near the tips it would be a mat, so here they come a long way down the stem.
 */
const LEAF = 4.8;
const CROWN = 4.0;
const FAR = 400;

const view = new Vector3(1, 1, 1).normalize();
const sunDirection = new Vector3(-0.45, 0.62, 0.64).normalize();

/** same as onPath in path.wgsl */
const onPath = (u: number) => {
  const wind = Math.floor(u / STONES);
  const v = u - wind * STONES;
  const run = [Math.min(v, 3), Math.min(Math.max(v - 6, 0), 3), Math.min(Math.max(v - 3, 0), 3)];
  return run.map((r) => (r + wind * 3) * STEP);
};

const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

/**
 * Two stones either side of a corner would pass through each other if they moved together, so along
 * each edge the moves are staggered: the stone leaving a corner goes first, the one arriving goes
 * last. tools/triclear.mjs checks that nothing touches. It also runs a ripple along each row.
 */
const STARTS = [0, 0.11, 0.22];
const SPAN = 0.78;
const stepFrom = (place: number, hop: number) => smoother(Math.min(1, Math.max(0, (hop - STARTS[place % 3]) / SPAN)));

const main = async () => {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
  const defaults = {
    // how it grows
    height: 1,
    tuft: 1,
    tops: 0.95,
    sides: 0.44,
    sideHeight: 0.5115,
    density: 0.5,
    // how it lives
    arrive: 2.015,
    life: 7.224,
    rim: 0,
    sway: 1.5,
    onLanding: true,
    growth: 0.3,
    // what it is
    gold: 0.42,
    dark: 0.435,
    fruit: 5.85,
    dew: 2.0375,
    splay: 2.5,
    wander: 1.455,
    // leaves
    leaf: 1.134,
    width: 1,
    open: 1,
    curl: 0,
    // colour
    warmth: 0,
    saturation: 1,
    brightness: 1,
    glow: 1,
    // everything else
    seconds: 1.5,
    jump: 2.1,
    blur: 0.4,
    across: 0.6,
    // the ball
    mossBall: true,
    strand: 0.572,
    strands: 1,
    inertia: 1.07,
    spring: 1.5,
    damping: 0.3,
    drag: 0,
  };
  const remembered = "moss-triangle";
  const recall = () => {
    // private windows refuse, and then the panel just forgets
    try {
      return JSON.parse(localStorage.getItem(remembered) ?? "{}");
    } catch {
      return {};
    }
  };
  const settings = { ...defaults, ...recall() };
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("this needs WebGPU");
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize, maxStorageBuffersPerShaderStage: 8 },
  });
  device.addEventListener("uncapturederror", (e) => console.error("gpu:", (e as GPUUncapturedErrorEvent).error.message));
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const module = (...code: string[]) => device.createShaderModule({ code: code.join("\n") });
  const compute = (code: GPUShaderModule, entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: code, entryPoint } });
  const bindings = (pipeline: GPUPipelineBase, group: number, resources: (GPUBindingResource | null)[]) =>
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(group), entries: resources.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])) });
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
  const upload = (data: ArrayBufferView<ArrayBuffer>, usage: number) => {
    const b = buffer(Math.ceil(data.byteLength / 4) * 4, usage | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(b, 0, data);
    return b;
  };

  const frameData = new Float32Array(72);
  const frameBuffer = buffer(288, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const sceneData = new Float32Array(50 * 4);
  const sceneBuffer = buffer(sceneData.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const seeds = Array.from({ length: STONES }, (_, i) => 3.1 + i * 7.3);

  // ---- nine stones, baked one after the other ----

  const bakePipeline = compute(module(commonCode, pathCode, blockCode), "distance");
  const bytes = N * N * N * 4;
  const sdfBuffer = buffer(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const sdfRead = buffer(bytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const bakeUniforms = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

  const facing = (solid: Solid) => {
    // the stones only ever slide, and the camera never moves, so their far sides are never seen
    const q = solid.normals;
    const kept = solid.indices.filter((_, k, all) => {
      const t = k - (k % 3);
      return [all[t], all[t + 1], all[t + 2]].some((v) => q[v * 3] * view.x + q[v * 3 + 1] * view.y + q[v * 3 + 2] * view.z > -0.3);
    });
    return { ...solid, indices: kept };
  };

  const meshes: Solid[] = [];
  const rootParts: Float32Array[] = [];
  for (let i = 0; i < STONES; i++) {
    const head = new ArrayBuffer(16);
    new Uint32Array(head, 0, 1)[0] = N;
    new Float32Array(head, 4, 1)[0] = seeds[i];
    device.queue.writeBuffer(bakeUniforms, 0, head);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(bakePipeline);
    pass.setBindGroup(0, bindings(bakePipeline, 0, [{ buffer: bakeUniforms }, { buffer: sdfBuffer }]));
    pass.dispatchWorkgroups(N / 4, N / 4, N / 4);
    pass.end();
    encoder.copyBufferToBuffer(sdfBuffer, 0, sdfRead, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await sdfRead.mapAsync(GPUMapMode.READ);
    const sdf = new Float32Array(sdfRead.getMappedRange().slice(0));
    sdfRead.unmap();

    const solid = facing(surfaceNets(sdf, N));
    meshes.push(solid);
    const { roots, count } = scatter(solid, MOST_SHOOTS, 9, true);
    // only faces that show grow moss: a shoot from one that doesn't would just stick out past the edge
    const shown: number[] = [];
    for (let k = 0; k < count; k++) {
      const facingEye = roots[k * 8 + 4] * view.x + roots[k * 8 + 5] * view.y + roots[k * 8 + 6] * view.z;
      if (facingEye > 0.15) {
        roots[k * 8 + 3] = i;
        shown.push(...roots.subarray(k * 8, k * 8 + 8));
      }
    }
    rootParts.push(new Float32Array(shown));
  }
  sdfBuffer.destroy();
  sdfRead.destroy();

  const join = <T extends Float32Array | Uint32Array>(parts: T[], make: new (n: number) => T) => {
    const out = new make(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p as never, at);
      at += p.length;
    }
    return out;
  };
  let firstVertex = 0;
  const shifted = meshes.map((m) => {
    const out = m.indices.map((v) => v + firstVertex);
    firstVertex += m.positions.length / 3;
    return out;
  });
  const solidPositions = upload(join(meshes.map((m) => m.positions), Float32Array) as Float32Array<ArrayBuffer>, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const solidNormals = upload(join(meshes.map((m) => m.normals), Float32Array) as Float32Array<ArrayBuffer>, GPUBufferUsage.STORAGE);
  const owners = join(meshes.map((m, i) => new Float32Array(m.positions.length / 3).fill(i)), Float32Array) as Float32Array<ArrayBuffer>;
  const solidOwners = upload(owners, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const solidShape = buffer(owners.length * 16, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const solidTone = buffer(owners.length * 16, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE);
  const solidIndexData = join(shifted, Uint32Array) as Uint32Array<ArrayBuffer>;
  const solidIndices = upload(solidIndexData, GPUBufferUsage.INDEX);

  const roots = join(rootParts, Float32Array) as Float32Array<ArrayBuffer>;
  const count = roots.length / 8;
  const rootBuffer = upload(roots, GPUBufferUsage.STORAGE);

  // ---- pipelines ----

  const hdrFormat: GPUTextureFormat = "rgba16float";
  /** which stone each pixel shows, for the shade pass: see Picture in common.wgsl */
  const layerFormat: GPUTextureFormat = "r16float";
  const multisample = { count: SAMPLES };
  const depthStencil: GPUDepthStencilState = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" };
  const floats = (location: number, n: number): GPUVertexBufferLayout => ({
    arrayStride: n * 4,
    attributes: [{ shaderLocation: location, offset: 0, format: n === 1 ? "float32" : (`float32x${n}` as GPUVertexFormat) }],
  });
  const stoneModule = module(commonCode, pathCode, sceneCode, stoneCode);
  const pipeline = (code: GPUShaderModule, vs: string, fs: string, buffers: GPUVertexBufferLayout[], extra: Partial<GPURenderPipelineDescriptor> = {}) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: code, entryPoint: vs, buffers },
      fragment: { module: code, entryPoint: fs, targets: [{ format: hdrFormat }, { format: layerFormat }] },
      primitive: { topology: "triangle-list" },
      depthStencil,
      multisample,
      ...extra,
    });
  const skyPipeline = pipeline(stoneModule, "skyVs", "skyFs", [], { depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "always" } });
  const solidPipeline = pipeline(stoneModule, "solidVs", "solidFs", [floats(0, 3), floats(1, 4), floats(2, 1), floats(3, 4)]);
  const ballPipeline = pipeline(stoneModule, "ballVs", "ballFs", [floats(0, 4)], { primitive: { topology: "triangle-list", cullMode: "back" } });
  const mossModule = module(commonCode, shootsCode, `const LEAF = ${LEAF};\nconst CROWN = ${CROWN};\nconst LOCAL_DEPTH = true;\nconst VARY = 0.7;\nconst SHRINK = 0.3;`, mossCode);
  const mossPipeline = pipeline(mossModule, "vs", "fs", [floats(0, 4)]);
  const dropPipeline = pipeline(mossModule, "dropVs", "dropFs", [floats(0, 4)], { primitive: { topology: "triangle-list", cullMode: "back" } });
  const fruitPipeline = pipeline(mossModule, "fruitVs", "fruitFs", [floats(0, 4)]);
  const planPipeline = compute(module(commonCode, shootsCode, pathCode, sceneCode, planCode), "plan");
  const surfacePipeline = compute(module(commonCode, pathCode, sceneCode, surfaceCode), "surface");
  const cullPipeline = compute(module(commonCode, shootsCode, pathCode, sceneCode, cullCode), "cull");
  const ballCullPipeline = compute(module(commonCode, shootsCode, pathCode, sceneCode, ballCode), "ball");
  const strandModule = module(commonCode, shootsCode, `const LEAF = ${STRAND_LEAF};\nconst CROWN = ${STRAND_CROWN};\nconst LOCAL_DEPTH = true;\nconst VARY = 0.7;\nconst SHRINK = 0.3;`, mossCode);
  const strandPipeline = pipeline(strandModule, "vs", "fs", [floats(0, 4)]);

  const screen = (code: GPUShaderModule, target: GPUTextureFormat) =>
    device.createRenderPipeline({
      layout: "auto",
      vertex: { module: code, entryPoint: "vs" },
      fragment: { module: code, entryPoint: "fs", targets: [{ format: target }] },
      primitive: { topology: "triangle-list" },
    });
  const shadePipeline = screen(
    module(commonCode, "const SHADE = 3.0;\n@group(0) @binding(2) var layers: texture_2d<f32>;\nfn layerAt(at: vec2i) -> f32 { return textureLoad(layers, at, 0).r; }", shadeCode),
    hdrFormat,
  );
  const postPipeline = screen(module(commonCode, postCode), format);
  const flat = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ---- meshes and shoots ----

  const shoot = shootMesh({ leaves: 18, rows: 2, widen: 1, stem: false });
  const drop = dropMesh(10, 14);
  const fruit = fruitMesh();
  const ball = dropMesh(40, 56);
  const meshVertices = new Float32Array([...shoot.vertices, ...drop.vertices, ...fruit.vertices]);
  const meshIndices = new Uint32Array([...shoot.indices, ...drop.indices, ...fruit.indices]);
  const meshVertexBuffer = upload(meshVertices, GPUBufferUsage.VERTEX);
  const meshIndexBuffer = upload(meshIndices, GPUBufferUsage.INDEX);
  const strand = shootMesh({ leaves: 30, rows: 2, widen: 1, stem: false });
  const strandVertices = upload(strand.vertices, GPUBufferUsage.VERTEX);
  const strandIndices = upload(strand.indices, GPUBufferUsage.INDEX);
  const ballVertices = upload(ball.vertices, GPUBufferUsage.VERTEX);
  const ballIndices = upload(ball.indices, GPUBufferUsage.INDEX);

  const draw = (mesh: { indices: Uint32Array }, firstIndex: number, baseVertex: number) => [mesh.indices.length, 0, firstIndex, baseVertex, 0];
  const mossDraw = draw(shoot, 0, 0);
  const dropDraw = draw(drop, shoot.indices.length, shoot.vertices.length / 4);
  const fruitDraw = draw(fruit, shoot.indices.length + drop.indices.length, (shoot.vertices.length + drop.vertices.length) / 4);
  const drawTemplate = new Uint32Array([...mossDraw, ...mossDraw, ...dropDraw, ...dropDraw, ...fruitDraw, ...fruitDraw]);
  const drawBuffer = buffer(drawTemplate.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);

  const storage = GPUBufferUsage.STORAGE;
  const shootBuffer = buffer(count * 64, storage);
  const fateBuffer = buffer(count * 16, storage);
  const liveBuffer = buffer(count * 2 * 64, storage);
  const grownBuffer = buffer(count * 2 * 8, storage);
  const listBuffer = buffer(count * 6 * 4, storage);

  const strandDrawTemplate = new Uint32Array([...draw(strand, 0, 0), ...draw(strand, 0, 0)]);
  const strandDraws = buffer(strandDrawTemplate.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
  const strandLive = buffer(STRANDS * 2 * 64, storage);
  const strandGrown = buffer(STRANDS * 2 * 8, storage);
  const strandList = buffer(STRANDS * 2 * 4, storage);
  const ballCullGroup = bindings(ballCullPipeline, 0, [{ buffer: frameBuffer }, { buffer: strandDraws }, { buffer: strandList }, { buffer: strandLive }, { buffer: strandGrown }, { buffer: sceneBuffer }]);
  const strandGroup = bindings(strandPipeline, 0, [{ buffer: frameBuffer }, { buffer: strandLive }, { buffer: strandList }, { buffer: strandGrown }]);
  const strandLists = [0, STRANDS].map((first) => bindings(strandPipeline, 1, [{ buffer: upload(new Uint32Array([first, 0, 0, 0]), GPUBufferUsage.UNIFORM) }]));

  const cullGroup = bindings(cullPipeline, 0, [
    { buffer: frameBuffer },
    { buffer: shootBuffer },
    { buffer: fateBuffer },
    { buffer: drawBuffer },
    { buffer: listBuffer },
    { buffer: liveBuffer },
    { buffer: grownBuffer },
    { buffer: sceneBuffer },
  ]);
  const mossGroup = bindings(mossPipeline, 0, [{ buffer: frameBuffer }, { buffer: liveBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]);
  const dropGroup = bindings(dropPipeline, 0, [{ buffer: frameBuffer }, { buffer: liveBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]);
  const fruitGroup = bindings(fruitPipeline, 0, [{ buffer: frameBuffer }, { buffer: liveBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]);
  const listBases = [0, 1, 2, 3, 4, 5].map((k) => upload(new Uint32Array([k * count, 0, 0, 0]), GPUBufferUsage.UNIFORM));
  const mossLists = [0, 1].map((k) => bindings(mossPipeline, 1, [{ buffer: listBases[k] }]));
  const dropLists = [2, 3].map((k) => bindings(dropPipeline, 1, [{ buffer: listBases[k] }]));
  const fruitLists = [4, 5].map((k) => bindings(fruitPipeline, 1, [{ buffer: listBases[k] }]));
  const sideBuffers = [0, 1].map((k) => upload(new Uint32Array([k, 0, 0, 0]), GPUBufferUsage.UNIFORM));
  const solidSides = sideBuffers.map((b) => bindings(solidPipeline, 1, [{ buffer: b }]));
  const ballSides = sideBuffers.map((b) => bindings(ballPipeline, 1, [{ buffer: b }]));
  const solidGroup = bindings(solidPipeline, 0, [{ buffer: frameBuffer }, { buffer: sceneBuffer }]);
  const ballGroup = bindings(ballPipeline, 0, [{ buffer: frameBuffer }, { buffer: sceneBuffer }]);
  const skyGroup = bindings(skyPipeline, 0, [{ buffer: frameBuffer }]);

  // ---- the view: orthographic and straight down the helix, or the triangle doesn't close ----

  const corners = [0, 3, 6].map((u) => new Vector3(...onPath(u)));
  const middle = corners.reduce((sum, c) => sum.add(c), new Vector3()).multiplyScalar(1 / 3);
  const up = new Vector3(0, 1, 0).addScaledVector(view, -view.y).normalize();
  const right = new Vector3().crossVectors(up, view).normalize();
  // centred by its width, then moved by eye. A triangle pointing right has most of its weight on the left, so
  // with equal margins it looks pushed left. Its weight in the middle would crowd the point against the edge,
  // and where it looks centred is between the two, a little high, with room over it for the ball: tools/tricentre.mjs
  const reach = corners.map((c) => c.dot(right));
  const centred = middle.clone().addScaledVector(right, (Math.max(...reach) + Math.min(...reach)) / 2 - middle.dot(right)).addScaledVector(up, 0.4);
  const eye = new Vector3();

  const size = { w: 1, h: 1, tall: 1 };
  const quality = { ratio: 2, frames: 0, ms: 16 };
  let viewProj = new Matrix4();
  let hdrMulti: GPUTexture, hdr: GPUTexture, layersMulti: GPUTexture, layers: GPUTexture, shaded: GPUTexture, depth: GPUTexture;
  let shadeGroup: GPUBindGroup, postGroup: GPUBindGroup;

  /** the panel's `across` is how far right of that the figure stands */
  const aim = () => {
    eye.copy(centred).addScaledVector(right, -settings.across).addScaledVector(view, FAR);
    const viewMatrix = new Matrix4().makeBasis(right, up, view).setPosition(eye).invert();
    const halfY = size.tall / 2;
    const halfX = halfY * (size.w / size.h);
    const projection = new Matrix4().set(1 / halfX, 0, 0, 0, 0, 1 / halfY, 0, 0, 0, 0, -1 / (FAR * 1.5), -1 / 6, 0, 0, 0, 1);
    viewProj = projection.multiply(viewMatrix);
  };

  const resize = () => {
    const ratio = Math.min(devicePixelRatio, quality.ratio, Math.sqrt(5.2e6 / (canvas.clientWidth * canvas.clientHeight)));
    const w = Math.max(2, Math.floor(canvas.clientWidth * ratio));
    const h = Math.max(2, Math.floor(canvas.clientHeight * ratio));
    size.w = canvas.width = w;
    size.h = canvas.height = h;
    // fit the whole figure whichever way round the window is
    size.tall = Math.max(14, 14 / (w / h));
    aim();

    for (const old of [hdrMulti, hdr, layersMulti, layers, shaded, depth]) old?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    hdrMulti = device.createTexture({ size: [w, h], format: hdrFormat, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    hdr = device.createTexture({ size: [w, h], format: hdrFormat, usage });
    layersMulti = device.createTexture({ size: [w, h], format: layerFormat, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    layers = device.createTexture({ size: [w, h], format: layerFormat, usage });
    shaded = device.createTexture({ size: [w, h], format: hdrFormat, usage });
    depth = device.createTexture({ size: [w, h], format: "depth32float", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    shadeGroup = bindings(shadePipeline, 0, [{ buffer: frameBuffer }, hdr.createView(), layers.createView()]);
    postGroup = bindings(postPipeline, 0, [{ buffer: frameBuffer }, shaded.createView(), flat]);
  };
  addEventListener("resize", resize);
  resize();

  /**
   * A cyclic overlap has no depth order, but any part of it does. So it is drawn twice, split by a
   * vertical line through the top and bottom rows. The stones on the first run of the path sit one
   * whole turn nearer on the left, which puts them in front of the column that runs up to them. On
   * the right they don't, and that side has the same break at the right hand corner. Each side's
   * break falls on the other side of the line. A turn is straight along the line of sight, so this
   * changes what covers what and nothing else: no stone moves on screen.
   */
  const turn = 3 * STEP;
  /** moves the split, for tools/triline.mjs: nothing on screen should depend on where exactly it falls */
  let nudge = 0;
  const lineX = () => {
    const p = new Vector3(...onPath(1.5)).applyMatrix4(viewProj);
    return Math.round((p.x * 0.5 + 0.5) * size.w) + nudge;
  };
  const distanceTo = (p: number[]) => eye.distanceTo(new Vector3(...p));

  let time = 0;
  /** for comparing frames: grain changes every frame, and would hide whether anything else did */
  let steadyGrain = false;

  /** the blow pushes a stone down a little, and it rides back up */
  const giveAt = (since: number) => -0.11 * Math.exp(-since * 5) * Math.sin(Math.min(since / 0.42, 1) * Math.PI);

  /** how far along the path a stone is at a time, on any lap */
  const alongPath = (i: number, t: number) => {
    const hops = t / settings.seconds;
    const whole = Math.floor(hops);
    const from = (((i + whole) % STONES) + STONES) % STONES;
    return from + stepFrom(from, hops - whole);
  };

  /** what it stands on: the strands underneath are pressed in, so the moss ball sits a little into its own length */
  const CORE = 0.33;
  const standsAt = () => (settings.mossBall ? CORE + settings.strand * 0.3 : RADIUS);

  /** where the ball is at any time: the ball rides the stone it landed on, then leaps back up the row */
  const ballAt = (t: number) => {
    const hops = t / settings.seconds;
    const beat = (((hops - TOUCHDOWN) % 1) + 1) % 1;
    const landed = onPath(LANDING);
    const carriedTo = (b: number) => stepFrom(LANDING, b + TOUCHDOWN) * STEP;
    const dip = giveAt(beat);
    let back: number, height: number, tall: number;
    if (beat < CONTACT) {
      back = carriedTo(beat);
      height = 0;
      tall = 1.14 - 0.36 * Math.sin((beat / CONTACT) * Math.PI);
    } else {
      const a = (beat - CONTACT) / (1 - CONTACT);
      back = carriedTo(CONTACT) * (1 - a);
      height = 4 * settings.jump * a * (1 - a);
      tall = 1 + 0.14 * (1 - 2 * a) ** 2;
    }
    if (settings.mossBall) tall = 1 + (tall - 1) * 0.4;
    const top = STONE + LIFT + dip;
    return { real: [landed[0] + back, landed[1] + top + standsAt() * tall + height, landed[2]], tall };
  };

  /**
   * A strand's tip is a damped spring on the ball. The answer to that is a sum over where the ball has
   * been, weighted by how a spring rings, and the ball's path is known at any time, so nothing has to
   * be simulated or remembered: it costs a few hundred sums, and it loops exactly as the ball does.
   * Sag is the spring holding up the tip. In free fall the spring's own answer cancels it, so a strand
   * hangs at rest and floats at the top of a jump with nothing written to make it. Air drag grows with
   * the square of the speed, and pushes on the tip like everything else, through the spring: added on
   * afterwards it would stop dead when the ball does, and the strands would snap.
   */
  const strands = (t: number) => {
    const omega = settings.spring * 2 * Math.PI;
    const zeta = settings.damping;
    const taps = 512;
    const step = Math.min(5 / (zeta * omega * SPEEDS[2]), 3) / taps;
    const now = ballAt(t).real;
    const follow = SPEEDS.map(() => [0, 0, 0]);
    const weights = SPEEDS.map(() => 0);
    let later = ballAt(t + step * 0.5).real;
    for (let k = 0; k < taps; k++) {
      const tau = (k + 0.5) * step;
      const was = ballAt(t - tau).real;
      const moving = later.map((v, a) => (v - was[a]) / step);
      const blown = settings.drag * 0.06 * Math.hypot(...moving);
      later = was;
      SPEEDS.forEach((speed, m) => {
        const w = omega * speed;
        const weight = Math.exp(-zeta * w * tau) * Math.sin(w * Math.sqrt(1 - zeta * zeta) * tau);
        weights[m] += weight;
        for (let a = 0; a < 3; a++) follow[m][a] += (settings.inertia * was[a] - blown * moving[a]) * weight;
      });
    }
    const falling = (8 * settings.jump) / ((1 - CONTACT) * settings.seconds) ** 2;
    return SPEEDS.map((s, m) => {
      const sag = falling / (omega * s) ** 2;
      return now.map((v, a) => follow[m][a] / weights[m] - settings.inertia * (v + (a === 1 ? sag : 0)));
    });
  };

  const place = (t: number) => {
    const hops = t / settings.seconds;
    const whole = Math.floor(hops);
    const hop = hops - whole;

    for (let i = 0; i < STONES; i++) {
      const u = alongPath(i, t);
      // a tip follows where its stone was a moment ago: a delay, so it costs nothing and loops exactly
      let earlier = alongPath(i, t - SWAY);
      if (earlier > u + STONES / 2) earlier -= STONES;
      const was = onPath(earlier);
      const now = onPath(u);
      sceneData.set([was[0] - now[0], was[1] - now[1], was[2] - now[2], 0], (32 + i) * 4);

      // hops since this stone was under the ball, on the clock rather than the eased step
      const since = (((i + hops - TOUCHDOWN - LANDING) % STONES) + STONES) % STONES;
      const p = onPath(u);
      p[1] += giveAt(since);
      for (let side = 0; side < 2; side++) {
        const near = side === 0 && u < 3 ? turn : 0;
        const at = p.map((v) => v + near);
        sceneData.set([...at, distanceTo(at)], (side * STONES + i) * 4);
      }
      sceneData.set([u, since, seeds[i], 0], (18 + i) * 4);
    }

    const { real, tall } = ballAt(t);
    sceneData.set([...real.map((v) => v + turn), distanceTo(real.map((v) => v + turn))], 27 * 4);
    sceneData.set([...real, distanceTo(real)], 28 * 4);
    const mossy = settings.mossBall;
    // the sun and the stones see all of it, strands and all
    sceneData.set([...real, mossy ? CORE + settings.strand * 0.5 : RADIUS], 29 * 4);
    sceneData.set([tall, 1 / Math.sqrt(tall), mossy ? 1 : 0, mossy ? CORE : RADIUS], 30 * 4);
    if (mossy) {
      const lags = strands(t);
      lags.forEach((lag, k) => sceneData.set([...lag, 0], (45 + k) * 4));
      sceneData.set([settings.strand, CORE, settings.strands, 0], 48 * 4);
    }
    sceneData.set([lineX(), size.h * 0.012, 0, 0], 31 * 4);
    const m = settings;
    sceneData.set(
      // mossData, in the order scene.moss reads it
      [m.height, m.tuft, m.tops, m.sides, m.sideHeight, m.splay, m.wander, m.density, m.arrive, m.life, m.rim, m.fruit, m.gold, m.dark, m.sway, m.onLanding ? 1 : 0],
      41 * 4,
    );
    // moss that bursts out of a landing has to be there at once, or it stops looking like the landing did it
    sceneData.set([(m.onLanding ? 0.2 : 0.42) / m.growth, 0, 0, 0], 49 * 4);
    device.queue.writeBuffer(sceneBuffer, 0, sceneData);
  };

  const writeFrame = () => {
    frameData.set(viewProj.elements, 0);
    frameData.set(viewProj.clone().invert().elements, 16);
    frameData.set([...eye.toArray(), steadyGrain ? 0 : time % 1000], 32);
    frameData.set([...sunDirection.toArray(), (size.h / size.tall) * FAR], 36);
    frameData.set([3.0, 2.5, 1.75, count], 40);
    frameData.set([0.32, 0.36, 0.32, FAR], 44);
    frameData.set([0.07, 0.08, 0.055, settings.blur], 48);
    frameData.set([size.w, size.h, 1 / size.w, 1 / size.h], 52);
    frameData.set([sunDirection.dot(right), -sunDirection.dot(up), sunDirection.dot(view) * -1, settings.dew], 56);
    frameData.set([settings.leaf, settings.width, settings.open, settings.curl], 60);
    frameData.set([settings.warmth, settings.saturation, settings.brightness, settings.glow], 64);
    device.queue.writeBuffer(frameBuffer, 0, frameData);
  };

  const planGroup = bindings(planPipeline, 0, [null, { buffer: rootBuffer }, { buffer: shootBuffer }, { buffer: fateBuffer }, { buffer: sceneBuffer }]);
  const surfaceGroup = bindings(surfacePipeline, 0, [{ buffer: solidPositions }, { buffer: solidNormals }, { buffer: solidOwners }, { buffer: solidShape }, { buffer: solidTone }, { buffer: sceneBuffer }]);

  /** what each shoot will be and where the stones are stained. Cheap enough to do on every slider move */
  const plan = () => {
    writeFrame();
    place(time);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(planPipeline);
    pass.setBindGroup(0, planGroup);
    pass.dispatchWorkgroups(Math.ceil(count / 128));
    pass.setPipeline(surfacePipeline);
    pass.setBindGroup(0, surfaceGroup);
    pass.dispatchWorkgroups(Math.ceil(owners.length / 128));
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  plan();

  const render = () => {
    writeFrame();
    place(time);
    device.queue.writeBuffer(drawBuffer, 0, drawTemplate);
    device.queue.writeBuffer(strandDraws, 0, strandDrawTemplate);
    const encoder = device.createCommandEncoder();
    const computing = encoder.beginComputePass();
    computing.setPipeline(cullPipeline);
    computing.setBindGroup(0, cullGroup);
    computing.dispatchWorkgroups(Math.ceil(count / 128));
    if (settings.mossBall) {
      computing.setPipeline(ballCullPipeline);
      computing.setBindGroup(0, ballCullGroup);
      computing.dispatchWorkgroups(Math.ceil(STRANDS / 64));
    }
    computing.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: hdrMulti.createView(), resolveTarget: hdr.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "discard" },
        { view: layersMulti.createView(), resolveTarget: layers.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "discard" },
      ],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setPipeline(skyPipeline);
    pass.setBindGroup(0, skyGroup);
    pass.draw(3);

    const line = Math.min(size.w, Math.max(0, lineX()));
    for (let side = 0; side < 2; side++) {
      if (side === 0) pass.setScissorRect(0, 0, line, size.h);
      else pass.setScissorRect(line, 0, size.w - line, size.h);

      pass.setPipeline(solidPipeline);
      pass.setBindGroup(0, solidGroup);
      pass.setBindGroup(1, solidSides[side]);
      pass.setVertexBuffer(0, solidPositions);
      pass.setVertexBuffer(1, solidShape);
      pass.setVertexBuffer(2, solidOwners);
      pass.setVertexBuffer(3, solidTone);
      pass.setIndexBuffer(solidIndices, "uint32");
      pass.drawIndexed(solidIndexData.length);

      pass.setPipeline(ballPipeline);
      pass.setBindGroup(0, ballGroup);
      pass.setBindGroup(1, ballSides[side]);
      pass.setVertexBuffer(0, ballVertices);
      pass.setIndexBuffer(ballIndices, "uint32");
      pass.drawIndexed(ball.indices.length);

      pass.setPipeline(mossPipeline);
      pass.setBindGroup(0, mossGroup);
      pass.setBindGroup(1, mossLists[side]);
      pass.setVertexBuffer(0, meshVertexBuffer);
      pass.setIndexBuffer(meshIndexBuffer, "uint32");
      pass.drawIndexedIndirect(drawBuffer, side * 20);

      pass.setPipeline(dropPipeline);
      pass.setBindGroup(0, dropGroup);
      pass.setBindGroup(1, dropLists[side]);
      pass.drawIndexedIndirect(drawBuffer, (2 + side) * 20);

      pass.setPipeline(fruitPipeline);
      pass.setBindGroup(0, fruitGroup);
      pass.setBindGroup(1, fruitLists[side]);
      pass.drawIndexedIndirect(drawBuffer, (4 + side) * 20);

      if (settings.mossBall) {
        pass.setPipeline(strandPipeline);
        pass.setBindGroup(0, strandGroup);
        pass.setBindGroup(1, strandLists[side]);
        pass.setVertexBuffer(0, strandVertices);
        pass.setIndexBuffer(strandIndices, "uint32");
        pass.drawIndexedIndirect(strandDraws, side * 20);
      }
    }
    pass.end();

    const contact = encoder.beginRenderPass({ colorAttachments: [{ view: shaded.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    contact.setPipeline(shadePipeline);
    contact.setBindGroup(0, shadeGroup);
    contact.draw(3);
    contact.end();

    const lens = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    lens.setPipeline(postPipeline);
    lens.setBindGroup(0, postGroup);
    lens.draw(3);
    lens.end();
    device.queue.submit([encoder.finish()]);
  };

  let running = true;
  let last = performance.now();
  const loop = (now: number) => {
    const elapsed = now - last;
    // everything is worked out from the time alone, so a slow frame can jump ahead: holding it back would put
    // the piece in slow motion on a busy machine, and out of step with the film of it
    const dt = Math.min(0.25, elapsed / 1000);
    last = now;
    if (running) {
      // a slow machine gives up pixels rather than smoothness. Long gaps are a hidden tab, not a slow one
      if (elapsed < 200) quality.ms += (elapsed - quality.ms) * 0.03;
      if (++quality.frames > 120 && quality.ms > 26 && quality.ratio > 1) {
        quality.frames = 0;
        quality.ratio = Math.max(1, Math.min(quality.ratio, size.h / canvas.clientHeight) - 0.25);
        resize();
      }
      time = (time + dt) % (settings.seconds * STONES);
      render();
    }
    requestAnimationFrame(loop);
  };
  time = settings.seconds * 0.5;
  requestAnimationFrame(loop);

  const gui = new GUI({ title: "moss" });
  if (!new URLSearchParams(location.search).has("panel")) gui.close();
  const changed = () => {
    aim();
    plan();
    try {
      localStorage.setItem(remembered, JSON.stringify(settings));
    } catch {
      // the panel still works, it just won't remember
    }
  };
  const slider = (folder: GUI, key: keyof typeof defaults, min: number, max: number, name: string) =>
    folder.add(settings, key, min, max, (max - min) / 200).name(name).listen().onChange(changed);

  const growth = gui.addFolder("growth");
  slider(growth, "height", 0.3, 2.5, "height");
  slider(growth, "tuft", 0.5, 2.5, "tufts, big to small");
  slider(growth, "density", 0.1, 1, "density");
  slider(growth, "tops", 0, 1, "cover on tops");
  slider(growth, "sides", 0, 1, "cover on sides");
  slider(growth, "sideHeight", 0.1, 1.2, "height on sides");

  const lifetime = gui.addFolder("life");
  lifetime.add(settings, "onLanding").name("starts on landing").listen().onChange(changed);
  slider(lifetime, "growth", 0.3, 3, "grows, slow to fast");
  slider(lifetime, "arrive", 0.4, 3, "spreads over a stone");
  slider(lifetime, "life", 3, 8.6, "lasts, in hops");
  slider(lifetime, "rim", 0, 3, "rim dies early");
  slider(lifetime, "sway", 0, 1.5, "sway");

  const shape = gui.addFolder("shoots");
  slider(shape, "splay", 0, 2.5, "splay out of a tuft");
  slider(shape, "wander", 0, 3, "untidiness");
  slider(shape, "gold", 0, 1, "gold kind");
  slider(shape, "dark", 0, 1, "dark kind");
  slider(shape, "fruit", 0, 6, "spore stalks");
  slider(shape, "dew", 0, 2.5, "dew");

  const leaves = gui.addFolder("leaves").close();
  slider(leaves, "leaf", 0.4, 2.2, "size");
  slider(leaves, "width", 0.4, 2.5, "width");
  slider(leaves, "open", 0.3, 1.5, "open, tight to wide");
  slider(leaves, "curl", -0.6, 1, "curl");

  const colour = gui.addFolder("colour").close();
  slider(colour, "warmth", -0.5, 0.5, "cool to warm");
  slider(colour, "saturation", 0, 2, "saturation");
  slider(colour, "brightness", 0.3, 2, "brightness");
  slider(colour, "glow", 0, 3, "sun through leaves");

  const ballFolder = gui.addFolder("moss ball");
  ballFolder.add(settings, "mossBall").name("moss ball").listen().onChange(changed);
  slider(ballFolder, "strand", 0.2, 1.3, "strand length");
  slider(ballFolder, "strands", 0.2, 1, "strands");
  slider(ballFolder, "inertia", 0, 2, "inertia");
  slider(ballFolder, "spring", 0.6, 3.5, "spring, loose to stiff");
  slider(ballFolder, "damping", 0.1, 0.9, "damping");
  slider(ballFolder, "drag", 0, 2, "air drag");

  const scene = gui.addFolder("scene");
  slider(scene, "seconds", 0.8, 3, "seconds a hop");
  slider(scene, "jump", 0.6, 3.5, "jump");
  slider(scene, "blur", 0, 3, "blur");
  slider(scene, "across", -0.5, 1.5, "figure, left to right");

  gui.add({ reset: () => (Object.assign(settings, defaults), changed()) }, "reset");
  gui.add(
    {
      copy: () => {
        const text = JSON.stringify(settings, null, 2);
        console.log(text);
        navigator.clipboard?.writeText(text);
      },
    },
    "copy",
  ).name("copy settings");

  const debug = {
    settings,
    changed,
    /** each stone's real reach along each axis, either way: they bulge past the cube they started as */
    bounds: () =>
      meshes.map((m) => {
        const lo = [9, 9, 9];
        const hi = [-9, -9, -9];
        m.positions.forEach((v, k) => {
          lo[k % 3] = Math.min(lo[k % 3], v);
          hi[k % 3] = Math.max(hi[k % 3], v);
        });
        return [...lo, ...hi].map((v) => +v.toFixed(3));
      }),
    quality,
    nudge: (pixels: number) => (nudge = pixels),
    strands,
    ballAt,
    line: lineX,
    /** seconds for one whole turn of nine hops */
    loop: () => settings.seconds * STONES,
    pause: () => (running = false),
    resume: () => (running = true),
    async at(t: number) {
      running = false;
      time = t;
      for (let i = 0; i < 2; i++) {
        render();
        await device.queue.onSubmittedWorkDone();
      }
    },
    /** draws `t` and copies it out in one task: a WebGPU canvas holds its picture for that long and no longer */
    copy(t: number, into: CanvasRenderingContext2D) {
      running = false;
      steadyGrain = true;
      time = t;
      render();
      into.drawImage(canvas, 0, 0, into.canvas.width, into.canvas.height);
    },
    async time(frames = 20) {
      const start = performance.now();
      for (let i = 0; i < frames; i++) {
        render();
        await device.queue.onSubmittedWorkDone();
      }
      return (performance.now() - start) / frames;
    },
    async counts() {
      const out = buffer(drawTemplate.byteLength, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(drawBuffer, 0, out, 0, drawTemplate.byteLength);
      device.queue.submit([encoder.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(out.getMappedRange().slice(0));
      out.destroy();
      return { shoots: count, solid: solidIndexData.length / 3, drawn: [data[1], data[6], data[11], data[16], data[21], data[26]], tris: [0, 1, 2, 3, 4, 5].reduce((s, l) => s + (data[l * 5 + 1] * data[l * 5]) / 3, 0) };
    },
  };
  (window as unknown as { __triangle: typeof debug }).__triangle = debug;
};

const loading = document.querySelector("#loading")!;
main()
  .then(() => loading.remove())
  .catch((error) => {
    console.error(error);
    loading.textContent = String(error.message ?? error);
  });
