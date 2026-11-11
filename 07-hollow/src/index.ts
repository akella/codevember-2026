import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { Foam, Grid, MAX_BUBBLES, MAX_PLANES, type FoamSettings } from "./foam";
import code from "./hollow.wgsl?raw";

const DURATION = 12_000;
/** physics steps per second, fixed so the sim plays the same at any frame rate */
const RATE = 480;
const SLOTS = 12;
const CELL = 0.22;

const look = {
  /** half the thickness of a wall between two bubbles */
  wall: 0.018,
  /** rounding where walls meet, which is what turns edges into struts */
  round: 0.12,
  /** how far a window keeps from the edges of its face; 0.5 or more closes every wall */
  inset: 0.07,
  /** rounding of window rims */
  rim: 0.03,
  /** rounding where bubbles break through the block */
  lip: 0.1,
  pores: 0.012,
  poreShare: 0.18,
  softness: 10,
  exposure: 1.25,
};

const physics: FoamSettings = {
  count: 26,
  box: [0.8, 1.35, 0.6],
  reach: 0.08,
  fill: 1.45,
  spread: 0.35,
  breathe: 0.12,
  pressure: 0.6,
  stiffness: 900,
  damping: 18,
  gravity: 0,
  seed: 3,
};

const sketch: Sketch<"webgpu"> = async ({ wrap, canvas, width, height, pixelRatio }) => {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => wrap.dispose());
    import.meta.hot.accept(() => wrap.hotReload());
  }

  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("this needs WebGPU");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (e) => console.error("gpu:", (e as GPUUncapturedErrorEvent).error.message));
  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const module = device.createShaderModule({ code });
  module.getCompilationInfo().then((info) => {
    for (const m of info.messages) if (m.type === "error") console.error(`wgsl ${m.lineNum}:${m.linePos} ${m.message}`);
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  const foam = new Foam(physics);
  const bubbleData = new Float32Array(MAX_BUBBLES * (1 + MAX_PLANES) * 4);
  const neighbourData = new Uint32Array(MAX_BUBBLES * (MAX_PLANES + 1));
  let grid = new Grid([1, 1, 1], SLOTS);
  let gridLo = [0, 0, 0];
  let gridSize = [CELL, CELL, CELL];

  const uniforms = new Float32Array(16 + 9 * 4);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bubbleBuffer = device.createBuffer({ size: bubbleData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const neighbourBuffer = device.createBuffer({ size: neighbourData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  let gridBuffer: GPUBuffer;
  let bindGroup: GPUBindGroup;

  /** the grid covers the block, since nothing outside it is ever drawn */
  const layoutGrid = () => {
    const pad = 0.02;
    const box = physics.box;
    gridLo = box.map((b) => -b - pad);
    const dims = box.map((b) => Math.max(1, Math.ceil((2 * b + 2 * pad) / CELL))) as [number, number, number];
    gridSize = box.map((b, k) => (2 * b + 2 * pad) / dims[k]);
    grid = new Grid(dims, SLOTS);
    gridBuffer?.destroy();
    gridBuffer = device.createBuffer({ size: grid.cells.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: bubbleBuffer } },
        { binding: 2, resource: { buffer: neighbourBuffer } },
        { binding: 3, resource: { buffer: gridBuffer } },
      ],
    });
  };
  layoutGrid();

  const camera = new PerspectiveCamera(28, width / height, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(4.2, 1.6, 6.2);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.1, 0);
  controls.enableDamping = true;
  controls.update();

  const sun = new Vector3(-0.55, 0.75, 0.45).normalize();
  const viewProj = new Matrix4();
  const inverse = new Matrix4();

  let simTime = 0;
  let clock = 0;
  const settle = (seconds: number) => {
    const steps = Math.round(seconds * RATE);
    for (let s = 0; s < steps; s++) {
      simTime += 1 / RATE;
      foam.step(1 / RATE, (simTime * 1000) / DURATION);
    }
  };
  const restart = () => {
    foam.reset();
    simTime = 0;
    settle(4);
  };
  restart();

  const gui = new GUI({ title: "hollow" });
  const shape = gui.addFolder("bubbles");
  shape.add(physics, "count", 4, MAX_BUBBLES, 1).onFinishChange(restart);
  shape.add(physics, "fill", 0.6, 2.5, 0.01).onFinishChange(restart);
  shape.add(physics, "spread", 0, 0.8, 0.01).onFinishChange(restart);
  shape.add(physics, "reach", 0, 0.5, 0.01);
  shape.add(physics, "breathe", 0, 0.4, 0.01);
  shape.add(physics, "pressure", 0, 1.5, 0.01);
  shape.add(physics, "stiffness", 100, 3000, 10);
  shape.add(physics, "damping", 0, 60, 0.1);
  shape.add(physics, "gravity", 0, 10, 0.01);
  shape.add(physics, "seed", 1, 200, 1).onFinishChange(restart);
  const walls = gui.addFolder("walls");
  walls.add(look, "wall", 0.004, 0.08, 0.001);
  walls.add(look, "round", 0, 0.4, 0.005);
  walls.add(look, "inset", 0, 0.5, 0.005).name("window inset");
  walls.add(look, "rim", 0, 0.2, 0.005).name("window rim");
  walls.add(look, "lip", 0, 0.3, 0.005).name("block lip");
  walls.add(look, "pores", 0, 0.03, 0.001);
  walls.add(look, "poreShare", 0, 1, 0.01).name("pore share");
  const render = gui.addFolder("render");
  render.add(look, "softness", 2, 40, 0.5).name("shadow edge");
  render.add(look, "exposure", 0.5, 2, 0.01);

  const writeUniforms = (w: number, h: number) => {
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inverse.copy(viewProj).invert();
    uniforms.set(inverse.elements, 0);
    const [bx, by, bz] = physics.box;
    const dims = grid.dims;
    const rows = [
      [camera.position.x, camera.position.y, camera.position.z, clock],
      [bx, by, bz, 0.03],
      [look.wall, look.round, look.inset, look.rim],
      [look.lip, look.pores, look.poreShare, 0.12],
      [gridLo[0], gridLo[1], gridLo[2], gridSize[0]],
      [dims[0], dims[1], dims[2], gridSize[1]],
      [gridSize[2], -by, look.exposure, 0],
      [sun.x, sun.y, sun.z, look.softness],
      [w, h, 1 / w, 1 / h],
    ];
    rows.forEach((r, k) => uniforms.set(r, 16 + k * 4));
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  };

  const upload = () => {
    foam.pack(bubbleData, neighbourData);
    const hi = physics.box.map((b) => b + 0.02);
    // the margin is what an empty cell reads as, and a step can never be longer
    grid.build(foam.bubbles, gridLo, hi, 0.12);
    device.queue.writeBuffer(bubbleBuffer, 0, bubbleData);
    device.queue.writeBuffer(neighbourBuffer, 0, neighbourData);
    device.queue.writeBuffer(gridBuffer, 0, grid.cells);
  };

  (window as any).__hollow = { foam, camera, controls, physics, look, settle, restart, upload };

  wrap.render = ({ deltaTime, width, height }) => {
    const dt = Math.min(deltaTime, 50) / 1000;
    clock += dt;
    settle(dt);
    controls.update();
    upload();
    writeUniforms(width * pixelRatio, height * pixelRatio);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  wrap.resize = ({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    device.destroy();
  };
};

const settings: SketchSettings = {
  mode: "webgpu",
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: DURATION,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
};

ssam(sketch, settings);
