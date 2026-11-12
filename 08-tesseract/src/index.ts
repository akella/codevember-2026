import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { frameCap } from "./cap";
import { MathUtils, Matrix4, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import common from "./common.wgsl?raw";
import postCode from "./post.wgsl?raw";
import traceCode from "./trace.wgsl?raw";

const DURATION = 24_000;

const shape = {
  /** half size of the inner cube, as a share of the outer one */
  inner: 0.5,
  /** beam radius, in the units of the cell it belongs to */
  beam: 0.015,
  /** diagonal (w edge) radius against the cube edges' */
  diagonal: 0.7,
  /** levels drawn above the camera's own */
  outer: 4,
  /** the most levels a point walks down */
  deepest: 24,
  /** beams thinner than this many traced pixels aren't drawn, nor anything inside them */
  detail: 1.5,
};

const light = {
  mood: "ember" as "ember" | "daylight",
  azimuth: 35,
  elevation: 58,
  sun: 0,
  /** angular radius in degrees, which sets how soft shadows are */
  size: 1.2,
  sky: 0.04,
  /** the nested cubes are the lights; with only them glowing they are sampled directly */
  glow: 5,
  glowOn: "cubes" as "cubes" | "w edges" | "both",
};

const moods = {
  /** lit only by the nested cubes, in the dark */
  ember: { sun: 0, sky: 0.04, glow: 5, glowOn: "cubes", exposure: 1.1 },
  /** a white lattice under sun and sky, the cubes faintly lit */
  daylight: { sun: 2.2, sky: 0.9, glow: 0.6, glowOn: "cubes", exposure: 0.7 },
} as const;

const render = {
  /** traced pixels per css pixel, per side, whatever the device pixel ratio */
  scale: 0.5,
  bounces: 2,
  /** frames averaged while moving */
  trail: 10,
  exposure: 1.1,
  /** step factor, below 1 for safety since the stretch estimate is local */
  step: 0.95,
  walls: false,
  /** how far past a cell wall a step may go, in pixels */
  margin: 40,
  /** bounce and shadow rays widen by this many radians per unit travelled, so they see less detail */
  cone: 0.1,
  /** colour by level, or show the cost of each pixel */
  view: "render" as "render" | "levels" | "cost",
};

const dive = {
  on: true,
  /** levels passed per loop */
  levels: 4,
  /** whole turns about the dive axis per loop */
  roll: 1,
  /** degrees the view swings off the axis */
  sway: 9,
  /** direction of the dive, from the centre */
  line: [1, 0.5803, 0.5078],
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
  const accumPipeline = device.createComputePipeline({ layout: "auto", compute: { module: postModule, entryPoint: "accumulate" } });
  const showPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: postModule, entryPoint: "vs" },
    fragment: { module: postModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  const uniforms = new Float32Array(68);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const linear = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  // traced frame, then two histories and two depths that swap each frame
  type Targets = { w: number; h: number; color: GPUTexture; hist: GPUTexture[]; depth: GPUTexture[]; groups: GPUBindGroup[][] };
  let targets: Targets | undefined;
  const makeTargets = (w: number, h: number): Targets => {
    const tex = (format: GPUTextureFormat) =>
      device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const color = tex("rgba16float");
    const hist = [tex("rgba16float"), tex("rgba16float")];
    const depth = [tex("r32float"), tex("r32float")];
    const ub = { binding: 0, resource: { buffer: uniformBuffer } };
    const groups = [0, 1].map((i) => [
      device.createBindGroup({
        layout: tracePipeline.getBindGroupLayout(0),
        entries: [ub, { binding: 1, resource: color.createView() }, { binding: 2, resource: depth[i].createView() }],
      }),
      device.createBindGroup({
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
          ub,
          { binding: 1, resource: color.createView() },
          { binding: 2, resource: depth[i].createView() },
          { binding: 3, resource: hist[1 - i].createView() },
          { binding: 4, resource: depth[1 - i].createView() },
          { binding: 6, resource: hist[i].createView() },
        ],
      }),
      device.createBindGroup({
        layout: showPipeline.getBindGroupLayout(0),
        entries: [ub, { binding: 5, resource: linear }, { binding: 7, resource: hist[i].createView() }],
      }),
    ]);
    return { w, h, color, hist, depth, groups };
  };
  const ensureTargets = (cw: number, ch: number) => {
    const w = Math.max(8, Math.round(cw * render.scale));
    const h = Math.max(8, Math.round(ch * render.scale));
    if (targets && targets.w === w && targets.h === h) return targets;
    if (targets) for (const t of [targets.color, ...targets.hist, ...targets.depth]) t.destroy();
    targets = makeTargets(w, h);
    reset = true;
    return targets;
  };

  const camera = new PerspectiveCamera(62, width / height, 0.001, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  let controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enabled = false;

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  // the coordinates rescale by 1/s each time the camera passes into the next inner cube, which keeps it
  // at level 0 and the numbers near 1; `prevScale` is what last frame's lengths are multiplied by
  let prevScale = 1;
  let diveTotal = -1;
  let reset = true;
  const prevViewProj = new Matrix4();
  const viewProj = new Matrix4();
  const prevEye = new Vector3();
  let frame = 0;

  const rescale = (k: number) => {
    camera.position.multiplyScalar(k);
    controls.target.multiplyScalar(k);
    prevScale *= k;
  };
  const chebyshev = (v: Vector3) => Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  /** keeps the camera between the outer cube (|eye| = 1) and the inner one (|eye| = s) */
  const keepAtLevelZero = () => {
    const s = shape.inner;
    for (let n = 0; n < 64 && chebyshev(camera.position) < s; n++) rescale(1 / s);
    for (let n = 0; n < 64 && chebyshev(camera.position) > 1; n++) rescale(s);
  };

  const f = new Vector3();
  const r = new Vector3();
  const up = new Vector3();
  const placeDiveCamera = (playhead: number) => {
    const s = shape.inner;
    const total = playhead * dive.levels;
    if (diveTotal >= 0) {
      // levels crossed since last frame, counting the jump back at the end of the loop as one more
      let crossed = Math.floor(total) - Math.floor(diveTotal);
      if (total < diveTotal - dive.levels / 2) crossed += dive.levels;
      prevScale *= Math.pow(1 / s, crossed);
    }
    diveTotal = total;
    const phi = total - Math.floor(total);
    const roll = Math.PI * 2 * playhead * dive.roll;
    const tau = Math.PI * 2 * playhead;
    const yaw = MathUtils.degToRad(dive.sway) * Math.sin(tau * 2);
    const pitch = MathUtils.degToRad(dive.sway) * 0.7 * Math.sin(tau * 3 + 1.3);
    // straight at the centre along a line found by tools/divepath.mjs to keep well clear of beams
    camera.position.fromArray(dive.line).multiplyScalar(Math.pow(s, phi) / chebyshev(f.fromArray(dive.line)));
    f.copy(camera.position).negate().normalize();
    r.set(0, 1, 0).cross(f).normalize();
    up.crossVectors(f, r).applyAxisAngle(f, roll);
    r.crossVectors(f, up);
    f.addScaledVector(r, Math.tan(yaw)).addScaledVector(up, Math.tan(pitch)).normalize();
    camera.up.copy(up);
    camera.lookAt(camera.position.clone().add(f));
  };

  /** hand the camera to OrbitControls where the dive left it, keeping its roll */
  const takeOver = () => {
    if (!dive.on) return;
    dive.on = false;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    controls.dispose();
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    // zoom can go on for ever only towards the centre, the one point the structure is the same around
    // at every scale, so the target eases there and panning is off
    controls.enablePan = false;
    camera.getWorldDirection(f);
    controls.target.copy(camera.position).addScaledVector(f, camera.position.length());
    controls.update();
    diveTotal = -1;
  };
  window.addEventListener("pointerdown", (e) => e.target === canvas && takeOver(), { capture: true });
  window.addEventListener("wheel", (e) => e.target === canvas && takeOver(), { capture: true });

  const gui = new GUI({ title: "tesseract" });
  const changed = () => (reset = true);
  const g1 = gui.addFolder("tesseract");
  g1.add(shape, "inner", 0.25, 0.75, 0.005).name("inner cube").onChange(changed);
  g1.add(shape, "beam", 0.005, 0.12, 0.001).onChange(changed);
  g1.add(shape, "diagonal", 0, 1.5, 0.01).name("w edges").onChange(changed);
  g1.add(shape, "outer", 1, 8, 1).name("levels above").onChange(changed);
  g1.add(shape, "deepest", 1, 40, 1).name("deepest level").onChange(changed);
  g1.add(shape, "detail", 0.25, 4, 0.05).name("cull below px").onChange(changed);
  const g2 = gui.addFolder("light");
  g2.add(light, "mood", ["ember", "daylight"]).onChange((m: keyof typeof moods) => {
    const { exposure, ...rest } = moods[m];
    Object.assign(light, rest);
    render.exposure = exposure;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    changed();
  });
  g2.add(light, "azimuth", -180, 180, 1).onChange(changed);
  g2.add(light, "elevation", -10, 90, 1).onChange(changed);
  g2.add(light, "sun", 0, 8, 0.05).onChange(changed);
  g2.add(light, "size", 0.1, 8, 0.1).name("sun size").onChange(changed);
  g2.add(light, "sky", 0, 3, 0.01).onChange(changed);
  g2.add(light, "glow", 0, 20, 0.1).onChange(changed);
  g2.add(light, "glowOn", ["cubes", "w edges", "both"]).name("glow on").onChange(changed);
  const g3 = gui.addFolder("render");
  g3.add(render, "scale", 0.2, 2, 0.05).name("resolution").onChange(changed);
  g3.add(render, "bounces", 0, 4, 1).onChange(changed);
  g3.add(render, "trail", 1, 60, 1).name("frames in motion");
  g3.add(render, "exposure", 0.2, 3, 0.01);
  g3.add(render, "step", 0.3, 1, 0.01).onChange(changed);
  g3.add(render, "walls").name("respect cells").onChange(changed);
  g3.add(render, "margin", 0, 40, 0.5).name("wall margin px").onChange(changed);
  g3.add(render, "cone", 0, 0.2, 0.005).name("bounce cone").onChange(changed);
  g3.add(render, "view", ["render", "levels", "cost"]).onChange(changed);
  const g4 = gui.addFolder("dive");
  g4.add(dive, "on")
    .name("dive")
    .onChange((v: boolean) => {
      if (v) {
        controls.dispose();
        controls = new OrbitControls(camera, canvas);
        controls.enabled = false;
        reset = true;
      } else {
        dive.on = true;
        takeOver();
      }
    });
  g4.add(dive, "levels", 1, 12, 1).name("levels per loop");
  g4.add(dive, "roll", -3, 3, 1).name("turns per loop");
  g4.add(dive, "sway", 0, 30, 0.5);

  const sunDir = new Vector3();
  const writeUniforms = (t: Targets, still: boolean) => {
    const s = shape.inner;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // last frame's camera seen from this frame's coordinates: x_old = x_new / prevScale
    const prev = prevViewProj.clone().multiply(new Matrix4().makeScale(1 / prevScale, 1 / prevScale, 1 / prevScale));
    uniforms.set(prev.elements, 0);

    const e = camera.matrixWorld.elements;
    const tanY = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    const tanX = tanY * camera.aspect;
    const phi = Math.log(chebyshev(camera.position)) / Math.log(s);
    const fade = 1 - MathUtils.clamp(phi, 0, 1);
    const az = MathUtils.degToRad(light.azimuth);
    const el = MathUtils.degToRad(light.elevation);
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const glowOn = { cubes: 0, "w edges": 1, both: 2 }[light.glowOn];
    const most = reset ? 1 : still ? 2000 : render.trail;
    const rows = [
      [camera.position.x, camera.position.y, camera.position.z, frame],
      [e[0], e[1], e[2], tanX],
      [e[4], e[5], e[6], tanY],
      [-e[8], -e[9], -e[10], (2 * tanY) / t.h],
      [s, shape.beam, shape.diagonal, Math.pow(s, shape.outer)],
      [(1 + s) / (1 - s), (-2 * s) / (1 - s), fade, shape.detail],
      [sunDir.x, sunDir.y, sunDir.z, light.sun],
      [render.exposure, light.glow, render.bounces, glowOn],
      [shape.deepest, render.step, render.margin, render.walls ? 1 : 0],
      [t.w, t.h, 1 / t.w, 1 / t.h],
      [prevEye.x * prevScale, prevEye.y * prevScale, prevEye.z * prevScale, prevScale],
      [most, Math.cos(MathUtils.degToRad(light.size)), light.sky, { render: 0, levels: 1, cost: 2 }[render.view]],
      [render.cone, still && !reset ? 1 : 0, 0, 0],
    ];
    rows.forEach((row, k) => uniforms.set(row, 16 + k * 4));
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  };

  let lastViewProj = new Matrix4();
  const isStill = () => {
    const a = viewProj.elements;
    const b = lastViewProj.elements;
    for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-7) return false;
    return prevScale === 1;
  };

  const tess = {
    /** set to a playhead to hold the dive there, for stills */
    hold: undefined as number | undefined,
    camera,
    get controls() {
      return controls;
    },
    shape,
    light,
    render,
    dive,
    takeOver,
    refresh: changed,
    get frame() {
      return frame;
    },
  };
  (window as any).__tess = tess;

  let lastSize = { width, height, playhead: 0 };
  const due = frameCap(60);
  wrap.render = ({ playhead, width, height, recording }) => {
    lastSize = { width, height, playhead };
    // an exported frame is always drawn; on screen, no more than 60 a second
    if (!recording && !due()) return;
    draw(playhead, width, height);
    stats.update();
  };

  /** GPU milliseconds per frame, waiting for each to finish (the page's own fps can be capped) */
  const bench = async (frames = 30) => {
    await device.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) {
      draw(lastSize.playhead, lastSize.width, lastSize.height);
      await device.queue.onSubmittedWorkDone();
    }
    return (performance.now() - t0) / frames;
  };
  (tess as any).bench = bench;

  const draw = (playhead: number, width: number, height: number) => {
    const t = ensureTargets(width, height);
    if (dive.on) placeDiveCamera(tess.hold ?? playhead);
    else {
      if (controls.target.lengthSq() > 1e-12) controls.target.multiplyScalar(0.94);
      else controls.target.set(0, 0, 0);
      controls.update();
    }
    keepAtLevelZero();
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const still = isStill();
    writeUniforms(t, still);

    const groups = t.groups[frame & 1];
    const encoder = device.createCommandEncoder();
    const cp = encoder.beginComputePass();
    const gx = Math.ceil(t.w / 8);
    const gy = Math.ceil(t.h / 8);
    cp.setPipeline(tracePipeline);
    cp.setBindGroup(0, groups[0]);
    cp.dispatchWorkgroups(gx, gy);
    cp.setPipeline(accumPipeline);
    cp.setBindGroup(0, groups[1]);
    cp.dispatchWorkgroups(gx, gy);
    cp.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(showPipeline);
    pass.setBindGroup(0, groups[2]);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);

    prevViewProj.copy(viewProj);
    lastViewProj.copy(viewProj);
    prevEye.copy(camera.position);
    prevScale = 1;
    reset = false;
    frame++;
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
