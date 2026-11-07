import { PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import bakeCode from "./bake.wgsl?raw";
import commonCode from "./common.wgsl?raw";
import cullCode from "./cull.wgsl?raw";
import dampCode from "./damp.wgsl?raw";
import formsCode from "./forms.wgsl?raw";
import growCode from "./grow.wgsl?raw";
import { dropMesh, fruitMesh, scatter, shootMesh, surfaceNets, trace, type Solid } from "./mesh";
import mossCode from "./moss.wgsl?raw";
import planCode from "./plan.wgsl?raw";
import postCode from "./post.wgsl?raw";
import shadeCode from "./shade.wgsl?raw";
import shootsCode from "./shoots.wgsl?raw";
import stoneCode from "./stone.wgsl?raw";

/** the distance grid: fine enough for the mesh */
const N = 192;
/** the growth grid */
const G = 128;
const SAMPLES = 4;
const FRAME_BYTES = 288;
const LEVELS = 3;
/** after the levels, the draws for sporophytes and for dew */
const FRUIT = LEVELS;
const DEW = LEVELS + 1;
const DRAWS = LEVELS + 2;
const GROUND = -1;
/** vertical field of view, in degrees, and the narrowest aspect that it still fits the form at */
const FOV = 22;
const WIDEST_CROP = 1.25;
/** past this many pixels the moss has all the detail it can use, and the frame rate pays for the rest */
const MOST_PIXELS = 5.2e6;

export const forms = { orb: 0, steps: 1, ring: 2, cube: 3 } as const;
export type FormName = keyof typeof forms;

const sunDirection = new Vector3(-0.74, 0.6, -0.34).normalize();

type Settings = {
  form: FormName;
  /** shoots per unit of area */
  density: number;
  /** growth steps per second */
  pace: number;
  aperture: number;
  /** how large the drops are, and 0 for none */
  dew: number;
};

export async function createPiece(canvas: HTMLCanvasElement, options: Partial<Settings> = {}, onPlant?: () => void) {
  const phone = navigator.maxTouchPoints > 0 && innerWidth < 900;
  const settings: Settings = { form: "ring", density: phone ? 15000 : 40000, pace: 48, aperture: 0.012, dew: 1, ...options };

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("this needs WebGPU");
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  device.addEventListener("uncapturederror", (e) => console.error("gpu:", (e as GPUUncapturedErrorEvent).error.message));

  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const module = (...code: string[]) => device.createShaderModule({ code: code.join("\n") });
  const compute = (code: GPUShaderModule, entryPoint: string) =>
    device.createComputePipeline({ layout: "auto", compute: { module: code, entryPoint } });
  /** a null leaves out a binding the entry point doesn't use, which auto layouts drop */
  const bindings = (pipeline: GPUPipelineBase, group: number, resources: (GPUBindingResource | null)[]) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(group),
      entries: resources.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])),
    });
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
  const upload = (data: ArrayBufferView<ArrayBuffer>, usage: number) => {
    const b = buffer(Math.ceil(data.byteLength / 4) * 4, usage | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(b, 0, data);
    return b;
  };

  const smooth3 = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
  });

  const frameBuffer = buffer(FRAME_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const frameData = new Float32Array(FRAME_BYTES / 4);

  const volume = device.createTexture({
    size: [N, N, N],
    dimension: "3d",
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  const volumeView = volume.createView();

  const fieldTexture = () =>
    device.createTexture({
      size: [G, G, G],
      dimension: "3d",
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
    });
  const fields = [fieldTexture(), fieldTexture()];
  const fieldViews = fields.map((f) => f.createView());

  // ---- bake ----

  const sdfBytes = N * N * N * 4;
  const sdfBuffer = buffer(sdfBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const sdfRead = buffer(sdfBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const bakeUniforms = buffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const bakeModule = module(commonCode, formsCode, bakeCode);
  const dampModule = module(commonCode, formsCode, dampCode);
  const distancePipeline = compute(bakeModule, "distance");
  const dampPipeline = compute(dampModule, "damp");

  let sdf = new Float32Array(0);

  const bakeForm = async (name: FormName) => {
    const head = new ArrayBuffer(32);
    new Uint32Array(head, 0, 2).set([N, forms[name]]);
    new Float32Array(head, 8, 3).set(sunDirection.toArray());
    device.queue.writeBuffer(bakeUniforms, 0, head);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    const groups = N / 4;
    pass.setPipeline(distancePipeline);
    pass.setBindGroup(0, bindings(distancePipeline, 0, [{ buffer: bakeUniforms }, { buffer: sdfBuffer }]));
    pass.dispatchWorkgroups(groups, groups, groups);
    pass.setPipeline(dampPipeline);
    pass.setBindGroup(0, bindings(dampPipeline, 0, [{ buffer: bakeUniforms }, { buffer: sdfBuffer }, volumeView]));
    pass.dispatchWorkgroups(groups, groups, groups);
    pass.end();
    encoder.copyBufferToBuffer(sdfBuffer, 0, sdfRead, 0, sdfBytes);
    device.queue.submit([encoder.finish()]);

    await sdfRead.mapAsync(GPUMapMode.READ);
    sdf = new Float32Array(sdfRead.getMappedRange().slice(0));
    sdfRead.unmap();
    return surfaceNets(sdf, N);
  };

  // ---- the stone ----

  const stoneModule = module(commonCode, stoneCode);
  const hdrFormat: GPUTextureFormat = "rgba16float";
  const multisample = { count: SAMPLES };
  const depthStencil: GPUDepthStencilState = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" };
  const solidPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: stoneModule,
      entryPoint: "solidVs",
      buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
      ],
    },
    fragment: { module: stoneModule, entryPoint: "solidFs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list" },
    depthStencil,
    multisample,
  });
  const groundPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: stoneModule, entryPoint: "groundVs" },
    fragment: { module: stoneModule, entryPoint: "groundFs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-strip" },
    depthStencil,
    multisample,
  });
  const skyPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: stoneModule, entryPoint: "skyVs" },
    fragment: { module: stoneModule, entryPoint: "skyFs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list" },
    depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "always" },
    multisample,
  });

  // ---- moss ----

  const levels = [
    shootMesh({ leaves: 22, rows: 2, widen: 1, stem: true }),
    shootMesh({ leaves: 9, rows: 1, widen: 1.3, stem: false }),
    shootMesh({ leaves: 5, rows: 1, widen: 2, stem: false }),
    fruitMesh(),
    dropMesh(),
  ];
  const vertexTotal = levels.reduce((sum, l) => sum + l.vertices.length, 0);
  const indexTotal = levels.reduce((sum, l) => sum + l.indices.length, 0);
  const meshVertices = new Float32Array(vertexTotal);
  const meshIndices = new Uint32Array(indexTotal);
  const drawTemplate = new Uint32Array(DRAWS * 5);
  {
    let v = 0;
    let i = 0;
    levels.forEach((level, l) => {
      meshVertices.set(level.vertices, v);
      meshIndices.set(level.indices, i);
      drawTemplate.set([level.indices.length, 0, i, v / 4, 0], l * 5);
      v += level.vertices.length;
      i += level.indices.length;
    });
  }
  const meshVertexBuffer = upload(meshVertices, GPUBufferUsage.VERTEX);
  const meshIndexBuffer = upload(meshIndices, GPUBufferUsage.INDEX);
  const drawBuffer = buffer(drawTemplate.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);

  const mossModule = module(commonCode, shootsCode, "const LEAF = 1.0;\nconst CROWN = 2.6;\nconst LOCAL_DEPTH = false;\nconst VARY = 1.0;\nconst SHRINK = 0.0;", mossCode);
  const mossPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: mossModule,
      entryPoint: "vs",
      buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
    },
    fragment: { module: mossModule, entryPoint: "fs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil,
    multisample,
  });

  const fruitPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: mossModule,
      entryPoint: "fruitVs",
      buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
    },
    fragment: { module: mossModule, entryPoint: "fruitFs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil,
    multisample,
  });

  const dropPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: mossModule,
      entryPoint: "dropVs",
      buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
    },
    fragment: { module: mossModule, entryPoint: "dropFs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil,
    multisample,
  });

  const planPipeline = compute(module(commonCode, shootsCode, planCode), "plan");
  const cullPipeline = compute(module(commonCode, shootsCode, cullCode), "cull");
  const spreadPipeline = compute(module(commonCode, growCode), "spread");
  const growUniforms = buffer(160, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const growData = new ArrayBuffer(160);
  const seedSlots = new Float32Array(growData, 0, 32);
  const growInts = new Uint32Array(growData, 128, 2);
  const growFloats = new Float32Array(growData, 136, 2);

  // ---- the lens ----

  // one form, so nothing here needs telling apart
  const shadeModule = module(commonCode, "const SHADE = 1.0;\nfn layerAt(at: vec2i) -> f32 { return 0.0; }", shadeCode);
  const shadePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shadeModule, entryPoint: "vs" },
    fragment: { module: shadeModule, entryPoint: "fs", targets: [{ format: hdrFormat }] },
    primitive: { topology: "triangle-list" },
  });
  const postModule = module(commonCode, postCode);
  const postPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: postModule, entryPoint: "vs" },
    fragment: { module: postModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const flat = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // ---- what depends on the form ----

  let solid: Solid;
  let solidPositions: GPUBuffer;
  let solidNormals: GPUBuffer;
  let solidIndices: GPUBuffer;
  let solidCount = 0;
  let shootCount = 0;
  let shootBuffer: GPUBuffer;
  let listBuffer: GPUBuffer;
  let grownBuffer: GPUBuffer;
  let levelUniforms: GPUBuffer[] = [];
  let cullGroup: [GPUBindGroup, GPUBindGroup];
  let mossGroup: GPUBindGroup;
  let levelGroups: GPUBindGroup[] = [];
  let fruitGroups: [GPUBindGroup, GPUBindGroup];
  let dropGroups: [GPUBindGroup, GPUBindGroup];
  let solidGroup: [GPUBindGroup, GPUBindGroup];
  let groundGroup: [GPUBindGroup, GPUBindGroup];
  let skyGroup: GPUBindGroup;
  let spreadGroups: [GPUBindGroup, GPUBindGroup];
  let current = 0;
  let tick = 0;
  let debt = 0;

  const clearField = () => {
    const zero = new Uint8Array(G * G * 8);
    for (const texture of fields) {
      for (let z = 0; z < G; z++) {
        device.queue.writeTexture({ texture, origin: [0, 0, z] }, zero, { bytesPerRow: G * 8, rowsPerImage: G }, [G, G, 1]);
      }
    }
    current = 0;
    tick = 0;
    seeds.length = 0;
  };

  /** the newest few planted spots; an older one is on its own once it drops off the end */
  const seeds: { point: number[]; radius: number }[] = [];
  const plant = (point: number[], radius = 0.09) => {
    if (seeds.length >= 8) seeds.shift();
    seeds.push({ point, radius });
  };

  const useForm = async (name: FormName) => {
    solid = await bakeForm(name);
    for (const old of [solidPositions, solidNormals, solidIndices, shootBuffer, listBuffer, grownBuffer, ...levelUniforms]) old?.destroy();
    solidPositions = upload(solid.positions, GPUBufferUsage.VERTEX);
    solidNormals = upload(solid.normals, GPUBufferUsage.VERTEX);
    // the mesh goes on across the ground for the moss to stand on, but the ground draws itself
    const y = solid.positions;
    const above = solid.indices.filter((_, k, all) => {
      const t = k - (k % 3);
      return Math.max(y[all[t] * 3 + 1], y[all[t + 1] * 3 + 1], y[all[t + 2] * 3 + 1]) > GROUND + 0.012;
    });
    solidCount = above.length;
    solidIndices = upload(above, GPUBufferUsage.INDEX);

    const { roots, count } = scatter(solid, settings.density, 1.42);
    shootCount = count;
    const rootBuffer = upload(roots, GPUBufferUsage.STORAGE);
    shootBuffer = buffer(count * 64, GPUBufferUsage.STORAGE);
    listBuffer = buffer(count * DRAWS * 4, GPUBufferUsage.STORAGE);
    grownBuffer = buffer(count * 8, GPUBufferUsage.STORAGE);

    writeFrame();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(planPipeline);
    pass.setBindGroup(0, bindings(planPipeline, 0, [{ buffer: frameBuffer }, { buffer: rootBuffer }, { buffer: shootBuffer }, volumeView, smooth3]));
    pass.dispatchWorkgroups(Math.ceil(count / 128));
    pass.end();
    device.queue.submit([encoder.finish()]);
    rootBuffer.destroy();

    const shared = (pipeline: GPUPipelineBase, view: GPUTextureView) => bindings(pipeline, 0, [{ buffer: frameBuffer }, volumeView, view, smooth3]);
    cullGroup = [0, 1].map((f) =>
      bindings(cullPipeline, 0, [
        { buffer: frameBuffer },
        { buffer: shootBuffer },
        { buffer: drawBuffer },
        { buffer: listBuffer },
        { buffer: grownBuffer },
        fieldViews[f],
        smooth3,
      ]),
    ) as [GPUBindGroup, GPUBindGroup];
    mossGroup = bindings(mossPipeline, 0, [{ buffer: frameBuffer }, { buffer: shootBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]);
    levelUniforms = levels.map((_, l) => upload(new Uint32Array([l * count, 0, 0, 0]), GPUBufferUsage.UNIFORM));
    levelGroups = levelUniforms.map((b) => bindings(mossPipeline, 1, [{ buffer: b }]));
    fruitGroups = [
      bindings(fruitPipeline, 0, [{ buffer: frameBuffer }, { buffer: shootBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]),
      bindings(fruitPipeline, 1, [{ buffer: levelUniforms[FRUIT] }]),
    ];
    dropGroups = [
      bindings(dropPipeline, 0, [{ buffer: frameBuffer }, { buffer: shootBuffer }, { buffer: listBuffer }, { buffer: grownBuffer }]),
      bindings(dropPipeline, 1, [{ buffer: levelUniforms[DEW] }]),
    ];
    solidGroup = [shared(solidPipeline, fieldViews[0]), shared(solidPipeline, fieldViews[1])];
    groundGroup = [shared(groundPipeline, fieldViews[0]), shared(groundPipeline, fieldViews[1])];
    skyGroup = bindings(skyPipeline, 0, [{ buffer: frameBuffer }]);
    spreadGroups = [0, 1].map((f) =>
      bindings(spreadPipeline, 0, [{ buffer: growUniforms }, fieldViews[f], fieldViews[1 - f], volumeView, smooth3]),
    ) as [GPUBindGroup, GPUBindGroup];
    clearField();
  };

  // ---- camera ----

  const camera = new PerspectiveCamera(FOV, 1, 0.05, 80);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  const home = new Vector3(0, -0.05, 0);
  camera.position.set(1.6, 0.2, 8);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  // zooming goes where the pointer is, or else every zoom into the ring would fly through its hole
  controls.zoomToCursor = true;
  controls.minDistance = 0.7;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.autoRotate = true;
  controls.autoRotateSpeed = -0.35;
  controls.target.copy(home);
  // the slow drift stops for a hand on the camera, and picks up again once it has been left alone
  let idle = 0;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(idle);
  });
  controls.addEventListener("end", () => {
    idle = window.setTimeout(() => (controls.autoRotate = true), 12000);
  });

  let focus = 6;
  const seconds = () => performance.now() / 1000;

  function writeFrame() {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const pxPerUnit = size.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const viewProj = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    frameData.set(viewProj.elements, 0);
    frameData.set(viewProj.clone().invert().elements, 16);
    frameData.set([...camera.position.toArray(), seconds() % 1000], 32);
    frameData.set([...sunDirection.toArray(), pxPerUnit], 36);
    frameData.set([3.0, 2.5, 1.75, shootCount], 40);
    frameData.set([0.32, 0.36, 0.32, focus], 44);
    frameData.set([0.07, 0.08, 0.055, settings.aperture], 48);
    frameData.set([size.w, size.h, 1 / size.w, 1 / size.h], 52);
    const axes = camera.matrixWorld.elements;
    const sun = sunDirection;
    frameData.set(
      [
        sun.x * axes[0] + sun.y * axes[1] + sun.z * axes[2],
        -(sun.x * axes[4] + sun.y * axes[5] + sun.z * axes[6]),
        -(sun.x * axes[8] + sun.y * axes[9] + sun.z * axes[10]),
        settings.dew,
      ],
      56,
    );
    frameData.set([1, 1, 1, 0], 60);
    frameData.set([0, 1, 1, 1], 64);
    device.queue.writeBuffer(frameBuffer, 0, frameData);
  }

  // ---- targets ----

  const size = { w: 1, h: 1 };
  let hdrMulti: GPUTexture;
  let hdr: GPUTexture;
  let shaded: GPUTexture;
  let depth: GPUTexture;
  let shadeGroup: GPUBindGroup;
  let postGroup: GPUBindGroup;

  const resize = () => {
    const ratio = Math.min(devicePixelRatio, quality.ratio, Math.sqrt(MOST_PIXELS / (canvas.clientWidth * canvas.clientHeight)));
    const w = Math.max(2, Math.floor(canvas.clientWidth * ratio));
    const h = Math.max(2, Math.floor(canvas.clientHeight * ratio));
    if (w === size.w && h === size.h) return;
    size.w = canvas.width = w;
    size.h = canvas.height = h;
    camera.aspect = w / h;
    // on a tall screen the form has to fit the width, so the lens widens to keep it in frame
    camera.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * Math.max(1, WIDEST_CROP / camera.aspect)) * 180) / Math.PI;
    for (const old of [hdrMulti, hdr, shaded, depth]) old?.destroy();
    hdrMulti = device.createTexture({ size: [w, h], format: hdrFormat, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    hdr = device.createTexture({ size: [w, h], format: hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    shaded = device.createTexture({ size: [w, h], format: hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    depth = device.createTexture({ size: [w, h], format: "depth32float", sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    shadeGroup = bindings(shadePipeline, 0, [{ buffer: frameBuffer }, hdr.createView()]);
    postGroup = bindings(postPipeline, 0, [{ buffer: frameBuffer }, shaded.createView(), flat]);
  };
  const quality = { ratio: 2, frames: 0, ms: 16 };
  addEventListener("resize", resize);

  // ---- a frame ----

  /** one step, submitted alone: each needs its own tick, or every step of a frame rolls the same spores */
  const growOnce = () => {
    seedSlots.fill(0);
    seeds.forEach((seed, i) => seedSlots.set([...seed.point, seed.radius], i * 4));
    growInts[0] = G;
    growInts[1] = tick++;
    growFloats[0] = 3e-8;
    growFloats[1] = 1;
    device.queue.writeBuffer(growUniforms, 0, growData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(spreadPipeline);
    pass.setBindGroup(0, spreadGroups[current]);
    pass.dispatchWorkgroups(G / 4, G / 4, G / 4);
    pass.end();
    device.queue.submit([encoder.finish()]);
    current = 1 - current;
  };

  const render = (steps: number) => {
    for (let i = 0; i < steps; i++) growOnce();
    writeFrame();
    device.queue.writeBuffer(drawBuffer, 0, drawTemplate);
    const encoder = device.createCommandEncoder();
    const computing = encoder.beginComputePass();
    computing.setPipeline(cullPipeline);
    computing.setBindGroup(0, cullGroup[current]);
    computing.dispatchWorkgroups(Math.ceil(shootCount / 128));
    computing.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: hdrMulti.createView(),
          resolveTarget: hdr.createView(),
          clearValue: [0, 0, 0, 60],
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setPipeline(skyPipeline);
    pass.setBindGroup(0, skyGroup);
    pass.draw(3);

    pass.setPipeline(solidPipeline);
    pass.setBindGroup(0, solidGroup[current]);
    pass.setVertexBuffer(0, solidPositions);
    pass.setVertexBuffer(1, solidNormals);
    pass.setIndexBuffer(solidIndices, "uint32");
    pass.drawIndexed(solidCount);

    pass.setPipeline(groundPipeline);
    pass.setBindGroup(0, groundGroup[current]);
    pass.draw(4);

    pass.setPipeline(mossPipeline);
    pass.setBindGroup(0, mossGroup);
    pass.setVertexBuffer(0, meshVertexBuffer);
    pass.setIndexBuffer(meshIndexBuffer, "uint32");
    for (let l = 0; l < LEVELS; l++) {
      pass.setBindGroup(1, levelGroups[l]);
      pass.drawIndexedIndirect(drawBuffer, l * 20);
    }
    pass.setPipeline(fruitPipeline);
    pass.setBindGroup(0, fruitGroups[0]);
    pass.setBindGroup(1, fruitGroups[1]);
    pass.drawIndexedIndirect(drawBuffer, FRUIT * 20);
    pass.setPipeline(dropPipeline);
    pass.setBindGroup(0, dropGroups[0]);
    pass.setBindGroup(1, dropGroups[1]);
    pass.drawIndexedIndirect(drawBuffer, DEW * 20);
    pass.end();

    const contact = encoder.beginRenderPass({
      colorAttachments: [{ view: shaded.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
    });
    contact.setPipeline(shadePipeline);
    contact.setBindGroup(0, shadeGroup);
    contact.draw(3);
    contact.end();

    const lens = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    lens.setPipeline(postPipeline);
    lens.setBindGroup(0, postGroup);
    lens.draw(3);
    lens.end();
    device.queue.submit([encoder.finish()]);
  };

  // ---- aiming ----

  const rayAt = (x: number, y: number) => {
    const point = new Vector3(x, y, 0.5).unproject(camera);
    return point.sub(camera.position).normalize().toArray();
  };
  const hitAt = (x: number, y: number) => trace(sdf, N, camera.position.toArray(), rayAt(x, y));

  /** the stone in the middle of the view, or if the middle is a hole, roughly where its front would be */
  const focusDistance = () => {
    const middle = camera.position.distanceTo(controls.target);
    const hit = hitAt(0, 0);
    return hit && hit.t < middle + 0.2 ? hit.t : middle - 0.45;
  };

  let pressed: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => (pressed = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener("pointerup", (e) => {
    if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) return;
    const hit = hitAt((e.clientX / canvas.clientWidth) * 2 - 1, 1 - (e.clientY / canvas.clientHeight) * 2);
    if (hit) {
      plant(hit.point);
      onPlant?.();
    }
  });

  // ---- running ----

  /** the first seed goes on the highest stone in view, where the damp collects and the viewer can see it */
  const start = () => {
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let best: number[] | null = null;
    for (let y = -0.2; y <= 0.8; y += 0.05) {
      for (const x of [-0.12, 0, 0.12]) {
        const hit = hitAt(x, y);
        if (hit && (!best || hit.point[1] > best[1])) best = hit.point;
      }
    }
    if (best) plant(best);
  };

  let running = true;
  let last = performance.now();
  const loop = (now: number) => {
    const elapsed = now - last;
    const dt = Math.min(0.05, elapsed / 1000);
    last = now;
    if (running) {
      // a slow machine gives up pixels rather than smoothness. Long gaps are a hidden tab, not a slow one
      if (elapsed < 200) quality.ms += (elapsed - quality.ms) * 0.03;
      if (++quality.frames > 120 && quality.ms > 26 && quality.ratio > 1) {
        quality.frames = 0;
        quality.ratio = Math.max(1, Math.min(quality.ratio, size.h / canvas.clientHeight) - 0.25);
        resize();
      }
      controls.update();
      // well out from the form, the view settles back on it however far the zoom wandered
      const away = camera.position.distanceTo(controls.target);
      if (away > 5) controls.target.lerp(home, Math.min(1, dt * (away - 5)));
      focus += (focusDistance() - focus) * Math.min(1, dt * 3);
      debt += dt * settings.pace;
      const steps = Math.min(8, Math.floor(debt));
      debt -= steps;
      render(steps);
    }
    requestAnimationFrame(loop);
  };

  resize();
  await useForm(settings.form);
  start();
  requestAnimationFrame(loop);

  /** one at a time: a bake takes the grid and buffers the frame loop is using */
  let busy = false;
  const grow = async (name: FormName) => {
    if (busy) return;
    busy = true;
    running = false;
    settings.form = name;
    await useForm(name);
    start();
    running = true;
    busy = false;
  };

  const gui = new GUI({ title: "moss" });
  gui.close();
  gui.add(settings, "pace", 0, 240, 1);
  gui.add(settings, "aperture", 0, 0.08, 0.001);
  gui.add(settings, "dew", 0, 2.5, 0.01);

  // for testing from the console and from tools/
  const debug = {
    settings,
    grow,
    /** the point on the stone under a page position */
    pick: (x: number, y: number) => hitAt((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2),
    quality,
    camera,
    controls,
    pause: () => (running = false),
    resume: () => (running = true),
    plant,
    /** runs the growth forward as fast as the GPU goes */
    async advance(steps: number) {
      running = false;
      for (let done = 0; done < steps; done++) {
        growOnce();
        if (done % 64 === 63) await device.queue.onSubmittedWorkDone();
      }
      await device.queue.onSubmittedWorkDone();
    },
    /** a frame with the camera where the test put it, focused on the middle of the screen */
    async still(focusAt?: number) {
      running = false;
      controls.update();
      focus = focusAt ?? focusDistance();
      for (let i = 0; i < 3; i++) {
        render(0);
        await device.queue.onSubmittedWorkDone();
      }
    },
    async time(frames = 20) {
      const start = performance.now();
      for (let i = 0; i < frames; i++) {
        render(0);
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
      return { shoots: shootCount, solid: solid.indices.length / 3, levels: [data[1], data[6], data[11], data[16], data[21]], tris: [0, 1, 2, 3, 4].reduce((s, l) => s + (data[l * 5 + 1] * data[l * 5]) / 3, 0) };
    },
  };
  (window as unknown as { __moss: typeof debug }).__moss = debug;
  return debug;
}

