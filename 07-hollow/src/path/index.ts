import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { Grid, MAX_PLANES, packBubbles } from "../foam";
import code from "./path.wgsl?raw";
import { MAX_BALLS, MAX_SOFT, PathFoam, type PathSettings } from "./sim";

/** one trip of every soft body round the loop */
const DURATION = 40_000;
const RATE = 480;
const SLOTS = 12;
/** what an empty grid cell reads as, so it must be wider than any blend */
const MARGIN = 0.3;
const CELL = 0.2;

const look = {
  /** half the thickness of walls between soft bodies; 0 merges them into one channel */
  wall: 0,
  /** rounding: where bodies merge, or where walls meet */
  round: 0.14,
  inset: 0.07,
  rim: 0.03,
  /** rounding where the void breaks through the slab's faces */
  lip: 0.02,
  /** how much slab stays wrapped round a ball where the void passes it */
  gap: 0.0,
  /** rounding where the void meets a ball */
  wrap: 0.04,
  tint: 0,
  pores: 0,
  poreShare: 0.18,
  softness: 10,
  exposure: 1.3,
  /** 0 off, 1 normals, 2 no occlusion, 3 no sun shadow */
  debug: 0,
};

const physics: PathSettings = {
  slab: [0.95, 1.6, 0.32],
  balls: 12,
  size: 0.36,
  spread: 0.2,
  count: 16,
  squeeze: 0.55,
  depth: 1.2,
  pull: 150,
  pressure: 0.5,
  stiffness: 900,
  damping: 18,
  seed: 3,
};

const PLINTH = { height: 0.22, overhang: 0.14 };

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

  const foam = new PathFoam(physics);
  const bubbleData = new Float32Array(MAX_SOFT * (1 + MAX_PLANES) * 4);
  const neighbourData = new Uint32Array(MAX_SOFT * (MAX_PLANES + 1));
  const ballData = new Float32Array(MAX_BALLS * 20);

  const uniforms = new Float32Array(16 + 11 * 4);
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const uniformBuffer = buffer(uniforms.byteLength, GPUBufferUsage.UNIFORM);
  const bubbleBuffer = buffer(bubbleData.byteLength, GPUBufferUsage.STORAGE);
  const neighbourBuffer = buffer(neighbourData.byteLength, GPUBufferUsage.STORAGE);
  const ballBuffer = buffer(ballData.byteLength, GPUBufferUsage.STORAGE);

  // the grid covers the slab, since nothing outside it is ever hollowed
  const pad = 0.02;
  const gridLo = physics.slab.map((b) => -b - pad);
  const gridHi = physics.slab.map((b) => b + pad);
  const dims = physics.slab.map((b) => Math.max(1, Math.ceil((2 * b + 2 * pad) / CELL))) as [number, number, number];
  const gridSize = physics.slab.map((b, k) => (2 * b + 2 * pad) / dims[k]);
  const grid = new Grid(dims, SLOTS);
  const gridBuffer = buffer(grid.cells.byteLength, GPUBufferUsage.STORAGE);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [uniformBuffer, bubbleBuffer, neighbourBuffer, gridBuffer, ballBuffer].map((b, binding) => ({ binding, resource: { buffer: b } })),
  });

  const camera = new PerspectiveCamera(26, width / height, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(2.0, 0.5, 9.6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.12, 0);
  controls.enableDamping = true;
  controls.update();

  const sun = new Vector3(-0.78, 0.55, 0.3).normalize();
  const viewProj = new Matrix4();
  const inverse = new Matrix4();

  let simTime = 0;
  let clock = 0;
  const travel = () => (simTime * 1000) / DURATION;
  const settle = (seconds: number) => {
    const steps = Math.round(seconds * RATE);
    for (let s = 0; s < steps; s++) {
      simTime += 1 / RATE;
      foam.step(1 / RATE, travel());
    }
  };
  const restart = () => {
    foam.reset();
    simTime = 0;
    settle(3);
    foam.packBalls(ballData);
    device.queue.writeBuffer(ballBuffer, 0, ballData);
  };
  restart();

  const gui = new GUI({ title: "hollow path" });
  const scene = gui.addFolder("slab");
  scene.add(physics, "balls", 0, MAX_BALLS, 1).onFinishChange(restart);
  scene.add(physics, "squeeze", 0.1, 1, 0.01).name("room").onFinishChange(restart);
  scene.add(physics, "depth", 0, 2.5, 0.01).name("weave").onFinishChange(restart);
  scene.add(physics, "seed", 1, 200, 1).onFinishChange(restart);
  const soft = gui.addFolder("soft bodies");
  soft.add(physics, "count", 1, MAX_SOFT, 1).onFinishChange(restart);
  soft.add(physics, "size", 0.1, 0.6, 0.01).onFinishChange(restart);
  soft.add(physics, "spread", 0, 0.6, 0.01).onFinishChange(restart);
  soft.add(physics, "pull", 10, 600, 1);
  soft.add(physics, "pressure", 0, 1.5, 0.01);
  soft.add(physics, "stiffness", 100, 3000, 10);
  soft.add(physics, "damping", 0, 60, 0.1);
  const walls = gui.addFolder("carving");
  walls.add(look, "wall", 0, 0.06, 0.001).name("walls between");
  walls.add(look, "round", 0, 0.4, 0.005);
  walls.add(look, "inset", 0, 0.5, 0.005).name("window inset");
  walls.add(look, "gap", 0, 0.1, 0.001).name("skin on balls");
  walls.add(look, "wrap", 0, 0.2, 0.005).name("ball fillet");
  walls.add(look, "lip", 0, 0.2, 0.005).name("face lip");
  walls.add(look, "tint", -0.2, 0.2, 0.005).name("ball tint");
  walls.add(look, "pores", 0, 0.03, 0.001);
  const render = gui.addFolder("render");
  render.add(look, "softness", 2, 40, 0.5).name("shadow edge");
  render.add(look, "exposure", 0.5, 2, 0.01);
  render.close();

  const writeUniforms = (w: number, h: number) => {
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inverse.copy(viewProj).invert();
    uniforms.set(inverse.elements, 0);
    const [bx, by, bz] = physics.slab;
    const rows = [
      [camera.position.x, camera.position.y, camera.position.z, clock],
      [bx, by, bz, 0.015],
      [look.wall, look.round, look.inset, look.rim],
      [look.lip, look.pores, look.poreShare, MARGIN],
      [gridLo[0], gridLo[1], gridLo[2], gridSize[0]],
      [dims[0], dims[1], dims[2], gridSize[1]],
      [gridSize[2], -by - PLINTH.height, look.exposure, look.debug],
      [sun.x, sun.y, sun.z, look.softness],
      [w, h, 1 / w, 1 / h],
      [foam.balls.length, look.gap, look.wrap, look.tint],
      [PLINTH.height, PLINTH.overhang, 0, 0],
    ];
    rows.forEach((r, k) => uniforms.set(r, 16 + k * 4));
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  };

  let warned = "";
  const upload = () => {
    packBubbles(foam.bubbles, bubbleData, neighbourData);
    const overflow = grid.build(foam.bubbles, gridLo, gridHi, MARGIN);
    if (overflow && !warned) console.warn((warned = `grid full: ${overflow}`));
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
