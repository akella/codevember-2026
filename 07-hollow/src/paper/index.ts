import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import { AnimationMixer, Color, Matrix4, Mesh, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3, WebGPUCoordinateSystem, type Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Balls, READBACK, type BallSettings } from "./balls";
import { ballCount, juggle, keepieUppie, LIMBS, parseSiteswap, position, type Layer, type Limb, type PlanSettings, type Schedule, type Tracks } from "./plan";
import debugCode from "./debug.wgsl?raw";
import paperCode from "./paper.wgsl?raw";
import sdfCode from "./sdf.wgsl?raw";

/** the dance, played once per loop */
const DURATION = 3400;
/** the distance map's size in pixels */
const SIZE = 1024;
const MAX_SHEETS = 24;
const MAX_BALLS = 32;
const MAX_TRAIL = 160;

const palettes: Record<string, string[]> = {
  ember: ["#d8432c", "#ea6a2a", "#f39a3c", "#f5c56a", "#e9dfb4", "#a9d3dc", "#74b3d8", "#4b8bc9", "#2f66a8", "#2a7f8f", "#2f8f78", "#1f5f5a"],
  bloom: ["#c4245c", "#e0508c", "#8a5cc4", "#4f72cf", "#6cb0e4", "#b9e0ee", "#f1e3c6", "#f2a54a", "#ec6b2c", "#c63a22", "#9bbf4a", "#2b2424"],
  dusk: ["#2b2d42", "#3d405b", "#5c5f84", "#81839f", "#a8a6b8", "#d6cfc7", "#e8b59a", "#e07a5f", "#c55a43", "#8d3b2f", "#5a2a27", "#2a1a1a"],
  paper: ["#f1ede6", "#e7e1d6", "#ddd5c7", "#d3c9b8", "#c9bda9", "#bfb19a", "#b5a58b", "#ab997c", "#a18d6d", "#97815e", "#8d754f", "#836940"],
};

const settings = {
  palette: "ember",
  sheets: 19,
  /** how far outside the figure the front sheet is cut */
  bleed: 0.05,
  /** how much each sheet's cut steps in from the one before */
  step: 0.015,
  /** rounding of the inner cuts, in pixels of the distance map */
  round: 6,
  /** spacing between sheets */
  spacing: 0.032,
  /** how far the front sheet sits behind the frame's face */
  recess: 0.14,
  thickness: 0.007,
  penumbra: 0.06,
  occlusion: 0.55,
  glow: 0.0,
  grain: 0.06,
  edge: 0.18,
  exposure: 1.25,
  /** which way the figure faces, in degrees */
  turn: 0,
  /**
   * cut out: the true outline is the front sheet's hole, contours step inward. inverted: the figure is the
   * white front sheet, contours step outward. middle: the true outline sits on a sheet inside the stack,
   * with outward contours in front of it and inward ones behind.
   */
  mode: "middle" as "cut out" | "inverted" | "middle",
  /** in middle mode, how far down the stack the true outline sits, 0 front to 1 back */
  outlineAt: 0.45,
  /** in middle mode, print the outline sheet white */
  whiteOutline: true,
  /** whether eyeballs and lashes count towards the silhouette */
  eyes: false,
  /** whether the model's quiver and arrows do; without them the dancer is just a person */
  quiver: false,
  /** a flat look at what the paper is cut from: the distance map, or the raw silhouette with the map's outline over it */
  debug: "off" as "off" | "distance" | "shape",
  /** whether the debug distance includes the balls and the trail */
  debugBalls: true,
  /** uncut paper kept round every sheet inside the frame */
  border: 0.05,
  /** how softly balls, trail and dancer merge where they meet */
  blend: 0.06,
  /** how far a sheet's cut strays from the true offset, at the deepest sheet */
  wobble: 0.035,
  /** how many wobbles across the frame */
  wobbleScale: 3.5,
  /** 0 strays the same at every depth, 1 only deep sheets stray */
  wobbleDepth: 0.85,
  /** fine ragged detail on top */
  wobbleFine: 0.6,
};

const ballSettings: BallSettings = {
  count: 9,
  size: 0.085,
  spread: 0.35,
  gravity: 0,
  drag: 0.35,
  bounce: 0.75,
  kick: 1.4,
  seed: 4,
};

/** balls on a schedule that loops with the dance, instead of free physics */
const play = {
  mode: "juggle" as "physics" | "keepie-uppie" | "juggle",
  /** the figure's size in the frame, so balls have air to fly in */
  figure: 0.72,
  /** and how far down the frame he dances */
  drop: 0.2,
  /** a ceiling: gravity is the strongest that keeps the highest arc in the frame */
  gravity: 60,
  /** share of throws sent off a side wall */
  walls: 0.25,
  size: 0.06,
  seed: 2,
  // keepie-uppie
  kicks: 4,
  keepieBalls: 1,
  kickWith: "feet" as "feet" | "hands" | "all",
  // juggling
  pattern: "3",
  beats: 6,
  juggleWith: "feet" as "feet" | "hands" | "hand and foot",
  /** how long a ball rests on a limb before it's thrown again, in beats */
  dwell: 0.35,
  // a second juggle on other limbs, half a beat behind, mostly off the walls
  extraPattern: "3",
  extraWith: "hands" as "feet" | "hands" | "hand and foot",
  extraWalls: 0.7,
  /** how flat a wall throw may be, sideways speed against upward: lower keeps them rounder */
  steep: 1,
};

const trail = {
  /** radius of a fresh cut */
  width: 0.05,
  /** seconds for a cut to heal shut */
  heal: 2.2,
  /** whether the pointer shoves the balls too */
  push: true,
};

/**
 * Which vertices belong to things carried on the back rather than worn: the model is an archer, and her
 * quiver and arrows come in the clothes mesh. Split it into its connected pieces, welding seams by
 * position; a piece that lies wholly behind the back in the rest pose (z in cm, facing +z) is gear,
 * while every garment wraps round to the front.
 */
function behindBack(position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }, triangles: number[], back = -16) {
  const n = position.count;
  const weld = new Map<string, number>();
  const root = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${position.getX(i).toFixed(2)},${position.getY(i).toFixed(2)},${position.getZ(i).toFixed(2)}`;
    if (!weld.has(key)) weld.set(key, i);
    root[i] = weld.get(key)!;
  }
  const find = (x: number): number => {
    while (root[x] !== x) x = root[x] = root[root[x]];
    return x;
  };
  for (let i = 0; i < triangles.length; i += 3) {
    const a = find(triangles[i]);
    for (const j of [triangles[i + 1], triangles[i + 2]]) {
      const b = find(j);
      if (a !== b) root[b] = a;
    }
  }
  const front = new Float32Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) front[find(i)] = Math.max(front[find(i)], position.getZ(i));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = front[find(i)] < back ? 1 : 0;
  return out;
}

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
  const shader = (code: string) => {
    const module = device.createShaderModule({ code });
    module.getCompilationInfo().then((info) => {
      for (const m of info.messages) if (m.type === "error") console.error(`wgsl ${m.lineNum}:${m.linePos} ${m.message}`);
    });
    return module;
  };

  // ---- the character, posed on the CPU each frame
  const gltf = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "dancing.glb");
  const root = gltf.scene;
  const clip = gltf.animations[0];
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  const meshes: Mesh[] = [];
  root.traverse((o: Object3D) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const offsets: number[] = [];
  let vertexCount = 0;
  const indices: number[] = [];
  // eyeballs and lashes go last, so the silhouette can leave them out: they sit inside the head, and
  // whole eyeball spheres poke past the face where it turns side on
  const inside = (m: Mesh) => /eye|lash/i.test(Array.isArray(m.material) ? m.material[0].name : m.material.name);
  const gear: number[] = [];
  const extras: number[] = [];
  for (const m of meshes) {
    offsets.push(vertexCount);
    const g = m.geometry;
    const n = g.attributes.position.count;
    const list = g.index ? Array.from({ length: g.index.count }, (_, i) => g.index!.getX(i)) : Array.from({ length: n }, (_, i) => i);
    const carried = inside(m) ? null : behindBack(g.attributes.position, list);
    for (let i = 0; i < list.length; i += 3) {
      const into = !carried ? extras : carried[list[i]] ? gear : indices;
      into.push(list[i] + vertexCount, list[i + 1] + vertexCount, list[i + 2] + vertexCount);
    }
    vertexCount += n;
  }
  // body, then the quiver, then the eyes, so each can be drawn or left out as a range
  const ranges = { body: indices.length, gear: gear.length, eyes: extras.length };
  indices.push(...gear, ...extras);
  const world = new Float32Array(vertexCount * 3);
  const flat = new Float32Array(vertexCount * 2);
  const v = new Vector3();

  const pose = (time: number) => {
    mixer.setTime(time);
    root.updateMatrixWorld(true);
    meshes.forEach((m, k) => {
      const n = m.geometry.attributes.position.count;
      const o = offsets[k];
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld);
        world[(o + i) * 3] = v.x;
        world[(o + i) * 3 + 1] = v.y;
        world[(o + i) * 3 + 2] = v.z;
      }
    });
  };

  /** the sheet that carries the true outline in middle mode */
  const outlineIndex = () => Math.round(settings.outlineAt * (settings.sheets - 2));

  /** fit the whole dance into the opening, once per facing */
  const fit = { cx: 0, cy: 0, scale: 1, drop: 0 };
  const refit = () => {
    const a = (settings.turn * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let f = 0; f < 40; f++) {
      pose((f / 40) * clip.duration);
      for (let i = 0; i < vertexCount; i += 5) {
        const x = c * world[i * 3] + s * world[i * 3 + 2];
        const y = world[i * 3 + 1];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    fit.cx = (x0 + x1) / 2;
    fit.cy = (y0 + y1) / 2;
    // leave room for the bleed and a margin of plain paper
    // contours that spread outward need some of the frame
    const outward = settings.mode === "inverted" ? settings.sheets * 0.5 : settings.mode === "middle" ? outlineIndex() : 0;
    const room = 1 - (settings.bleed + outward * settings.step + 0.06);
    fit.scale = (2 * room) / Math.max(x1 - x0, y1 - y0);
    // with balls on a schedule, a smaller dancer lower down leaves them air
    fit.drop = 0;
    if (play.mode !== "physics") {
      fit.scale *= play.figure;
      fit.drop = -Math.min(play.drop, room * (1 - play.figure));
    }
  };
  refit();

  const project = () => {
    const a = (settings.turn * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < vertexCount; i++) {
      flat[i * 2] = (c * world[i * 3] + s * world[i * 3 + 2] - fit.cx) * fit.scale;
      flat[i * 2 + 1] = (world[i * 3 + 1] - fit.cy) * fit.scale + fit.drop;
    }
  };

  // ---- limb tips over the loop, for the schedules
  const tipBones: Record<Limb, Object3D | undefined> = {
    "left foot": undefined,
    "right foot": undefined,
    "left hand": undefined,
    "right hand": undefined,
  };
  let hips: Object3D | undefined;
  root.traverse((o: Object3D) => {
    if (o.name.startsWith("LeftToe_End")) tipBones["left foot"] = o;
    if (o.name.startsWith("RightToe_End")) tipBones["right foot"] = o;
    if (o.name.startsWith("LeftHandMiddle4")) tipBones["left hand"] = o;
    if (o.name.startsWith("RightHandMiddle4")) tipBones["right hand"] = o;
    if (o.name.startsWith("Hips")) hips = o;
  });
  const SAMPLES = 360;
  const tracks: Tracks = {
    samples: SAMPLES,
    tips: Object.fromEntries(LIMBS.map((l) => [l, new Float32Array(SAMPLES * 2)])) as Record<Limb, Float32Array>,
    centre: new Float32Array(SAMPLES * 2),
  };
  const sampleTracks = () => {
    const a = (settings.turn * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const flatten = (o: Object3D | undefined, out: Float32Array, i: number) => {
      if (!o) return;
      o.getWorldPosition(v);
      out[i * 2] = (c * v.x + s * v.z - fit.cx) * fit.scale;
      out[i * 2 + 1] = (v.y - fit.cy) * fit.scale + fit.drop;
    };
    for (let i = 0; i < SAMPLES; i++) {
      mixer.setTime((i / SAMPLES) * clip.duration);
      root.updateMatrixWorld(true);
      for (const l of LIMBS) flatten(tipBones[l], tracks.tips[l], i);
      flatten(hips, tracks.centre, i);
    }
  };

  let schedule: Schedule = { paths: [], gravity: 0 };
  const planSettings = (): PlanSettings => ({
    gravity: play.gravity,
    room: 0.96 - play.size - settings.bleed,
    radius: play.size,
    offset: play.size + 0.012,
    walls: play.walls,
    steep: play.steep,
    seed: play.seed,
  });
  const status = { text: "" };
  const replan = () => {
    refit();
    sampleTracks();
    const ps = planSettings();
    if (play.mode === "keepie-uppie") {
      const limbs: Limb[] = play.kickWith === "feet" ? ["left foot", "right foot"] : play.kickWith === "hands" ? ["left hand", "right hand"] : [...LIMBS];
      schedule = keepieUppie(tracks, limbs, play.kicks, play.keepieBalls, ps);
    } else if (play.mode === "juggle") {
      const pairOf = (w: string): [Limb, Limb] =>
        w === "feet" ? ["left foot", "right foot"] : w === "hands" ? ["left hand", "right hand"] : ["right hand", "left foot"];
      // limbs alternate by beat, so an odd count would swap them every loop
      const beats = play.beats + (play.beats % 2);
      const main = parseSiteswap(play.pattern);
      // the second layer is optional: an empty pattern leaves it out
      const extra = play.extraPattern.trim() ? parseSiteswap(play.extraPattern) : [];
      if (typeof main === "string") schedule = { paths: [], gravity: 0, error: main };
      else if (typeof extra === "string") schedule = { paths: [], gravity: 0, error: "second: " + extra };
      else {
        const layers: Layer[] = [{ pattern: main, beats, limbs: pairOf(play.juggleWith), dwell: play.dwell, offset: 0, walls: play.walls }];
        if (extra.length) layers.push({ pattern: extra, beats, limbs: pairOf(play.extraWith), dwell: play.dwell, offset: 0.5, walls: play.extraWalls });
        schedule = juggle(tracks, layers, ps);
      }
    } else schedule = { paths: [], gravity: 0 };
    status.text = schedule.error ?? (play.mode === "physics" ? "" : `${ballCount(schedule)} balls, gravity ${schedule.gravity.toFixed(1)}`);
  };
  replan();

  // ---- silhouette mask
  const maskTex = device.createTexture({ size: [SIZE, SIZE], format: "r8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const vertexBuffer = device.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const indexData = new Uint32Array(indices);
  const indexBuffer = device.createBuffer({ size: indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(indexBuffer, 0, indexData);
  const sdfModule = shader(sdfCode);
  const maskPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: sdfModule, entryPoint: "maskVs", buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }] },
    fragment: { module: sdfModule, entryPoint: "maskFs", targets: [{ format: "r8unorm" }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });

  // ---- jump flood to a distance map
  const compute = (entryPoint: string) => device.createComputePipeline({ layout: "auto", compute: { module: sdfModule, entryPoint } });
  const seedPipe = compute("seed");
  const floodPipe = compute("flood");
  const resolvePipe = compute("resolve");
  const blurPipe = compute("blur");
  const seedBuffers = [0, 1].map(() => device.createBuffer({ size: SIZE * SIZE * 8, usage: GPUBufferUsage.STORAGE }));
  const sdfTex = [0, 1].map(() =>
    device.createTexture({ size: [SIZE, SIZE], format: "rgba16float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }),
  );
  const steps: number[] = [];
  for (let s = SIZE / 2; s >= 1; s /= 2) steps.push(s);
  steps.push(1);
  // a small uniform per pass, so every pass can go in one encoder
  const passUniform = () => device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const seedU = passUniform();
  const floodU = steps.map(passUniform);
  const resolveU = passUniform();
  const blurU = [passUniform(), passUniform()];
  const group = (pipe: GPUComputePipeline, index: number, entries: [number, GPUBindingResource][]) =>
    device.createBindGroup({ layout: pipe.getBindGroupLayout(index), entries: entries.map(([binding, resource]) => ({ binding, resource })) });
  const maskView = maskTex.createView();
  const seedGroup = group(seedPipe, 0, [[0, { buffer: seedU }], [1, maskView], [3, { buffer: seedBuffers[0] }]]);
  const floodGroups = steps.map((_, k) =>
    group(floodPipe, 0, [[0, { buffer: floodU[k] }], [2, { buffer: seedBuffers[k % 2] }], [3, { buffer: seedBuffers[(k + 1) % 2] }]]),
  );
  const finalSeeds = seedBuffers[steps.length % 2];
  const resolveGroups = [
    group(resolvePipe, 0, [[0, { buffer: resolveU }], [1, maskView], [2, { buffer: finalSeeds }]]),
    group(resolvePipe, 1, [[0, sdfTex[0].createView()]]),
  ];
  const blurGroups = [
    [group(blurPipe, 0, [[0, { buffer: blurU[0] }]]), group(blurPipe, 1, [[0, sdfTex[1].createView()], [1, sdfTex[0].createView()]])],
    [group(blurPipe, 0, [[0, { buffer: blurU[1] }]]), group(blurPipe, 1, [[0, sdfTex[0].createView()], [1, sdfTex[1].createView()]])],
  ];
  const half = 1; // the map spans the opening's larger side, from -1 to 1
  const writePass = (buffer: GPUBuffer, step: number, axis = 0) => {
    const d = new ArrayBuffer(32);
    const view = new DataView(d);
    view.setUint32(0, SIZE, true);
    view.setUint32(4, step, true);
    view.setFloat32(8, (2 * half) / SIZE, true);
    view.setFloat32(12, settings.round, true);
    view.setUint32(16, axis, true);
    device.queue.writeBuffer(buffer, 0, d);
  };
  const writePasses = () => {
    writePass(seedU, 0);
    steps.forEach((s, k) => writePass(floodU[k], s));
    writePass(resolveU, 0);
    writePass(blurU[0], 0, 0);
    writePass(blurU[1], 0, 1);
  };

  // ---- balls and trail, merged in; and a small copy of the dancer's map read back for the balls
  const composePipe = compute("compose");
  const shrinkPipe = compute("shrink");
  const shapesU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shapeData = new Float32Array((MAX_BALLS + MAX_TRAIL * 2) * 4);
  const shapeBuffer = device.createBuffer({ size: shapeData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const smallBuffer = device.createBuffer({ size: READBACK * READBACK * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = [0, 1].map(() => ({ buffer: device.createBuffer({ size: READBACK * READBACK * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false }));
  const composeGroups = [
    group(composePipe, 0, [[0, { buffer: resolveU }]]),
    group(composePipe, 1, [[0, sdfTex[1].createView()], [1, sdfTex[0].createView()]]),
    group(composePipe, 2, [[0, { buffer: shapesU }], [1, { buffer: shapeBuffer }]]),
  ];
  const shrinkGroups = [
    group(shrinkPipe, 0, [[0, { buffer: resolveU }]]),
    group(shrinkPipe, 1, [[1, sdfTex[0].createView()]]),
    group(shrinkPipe, 2, [[0, { buffer: shapesU }], [2, { buffer: smallBuffer }]]),
  ];

  const balls = new Balls(ballSettings);
  /** the trail: points with the time they were made, and breaks where the pointer lifted */
  const points: { x: number; y: number; t: number; start: boolean }[] = [];
  let clock = 0;
  let held: number | null = null;
  let pointer: { x: number; y: number; vx: number; vy: number; r: number; t: number } | null = null;
  let breakNext = true;

  const writeShapes = () => {
    const n = Math.min(balls.x.length, MAX_BALLS);
    for (let i = 0; i < n; i++) shapeData.set([balls.x[i], balls.y[i], balls.r[i], 0], i * 4);
    // a cut narrows as it heals, the old end first
    const radius = (t: number) => trail.width * Math.pow(Math.max(0, 1 - (clock - t) / trail.heal), 0.6);
    let segs = 0;
    for (let k = 1; k < points.length && segs < MAX_TRAIL; k++) {
      const a = points[k - 1], b = points[k];
      if (b.start) continue;
      const o = (n + segs * 2) * 4;
      shapeData.set([a.x, a.y, b.x, b.y, radius(a.t), radius(b.t), 0, 0], o);
      segs++;
    }
    device.queue.writeBuffer(shapeBuffer, 0, shapeData);
    const u = new ArrayBuffer(16);
    const view = new DataView(u);
    view.setUint32(0, n, true);
    view.setUint32(4, segs, true);
    view.setFloat32(8, settings.blend, true);
    view.setUint32(12, READBACK, true);
    device.queue.writeBuffer(shapesU, 0, u);
  };

  // ---- the shadow box
  const paperModule = shader(paperCode);
  const paperPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: paperModule, entryPoint: "vs" },
    fragment: { module: paperModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const uniforms = new Float32Array(16 + 10 * 4 + MAX_SHEETS * 4);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const paperGroup = device.createBindGroup({
    layout: paperPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sdfTex[1].createView() },
      { binding: 2, resource: sampler },
    ],
  });

  // ---- debug: the distance map or the silhouette, flat
  const debugModule = shader(debugCode);
  const debugPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: debugModule, entryPoint: "vs" },
    fragment: { module: debugModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const debugUniforms = new Float32Array(8);
  const debugBuffer = device.createBuffer({ size: debugUniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const debugGroup = device.createBindGroup({
    layout: debugPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: debugBuffer } },
      { binding: 1, resource: sdfTex[1].createView() },
      { binding: 2, resource: sdfTex[0].createView() },
      { binding: 3, resource: maskView },
      { binding: 4, resource: sampler },
    ],
  });

  const camera = new PerspectiveCamera(30, width / height, 0.05, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(1.9, 0.5, 5.4);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, -0.3);
  controls.enableDamping = true;
  controls.update();
  const light = new Vector3(-0.42, 0.55, 0.78).normalize();

  // the pointer, met on the front sheet's plane; hovering cuts, dragging still orbits
  const ray = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const onMove = (e: PointerEvent) => {
    if (e.buttons) {
      breakNext = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const plane = new Plane(new Vector3(0, 0, 1), settings.recess);
    if (!ray.ray.intersectPlane(plane, hit) || Math.max(Math.abs(hit.x), Math.abs(hit.y)) > 1 - trail.width) {
      breakNext = true;
      pointer = null;
      return;
    }
    if (pointer) {
      const dt = Math.max(clock - pointer.t, 1 / 240);
      pointer = { x: hit.x, y: hit.y, vx: (hit.x - pointer.x) / dt, vy: (hit.y - pointer.y) / dt, r: trail.width, t: clock };
    } else pointer = { x: hit.x, y: hit.y, vx: 0, vy: 0, r: trail.width, t: clock };
    const last = points[points.length - 1];
    if (breakNext || !last || Math.hypot(hit.x - last.x, hit.y - last.y) > 0.012) {
      points.push({ x: hit.x, y: hit.y, t: clock, start: breakNext });
      breakNext = false;
    }
  };
  const onLeave = () => {
    breakNext = true;
    pointer = null;
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  const viewProj = new Matrix4();
  const inverse = new Matrix4();
  const colour = new Color();

  const writeUniforms = (w: number, h: number, time: number) => {
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    inverse.copy(viewProj).invert();
    uniforms.set(inverse.elements, 0);
    const s = settings;
    const depth = s.recess + s.spacing * s.sheets + 0.04;
    const rows = [
      [camera.position.x, camera.position.y, camera.position.z, time],
      [1, 1, 0.16, depth],
      [s.recess, s.spacing, s.sheets, s.thickness],
      [s.bleed, s.step, s.penumbra, s.occlusion],
      [light.x, light.y, light.z, 0],
      [s.exposure, s.grain, s.edge, s.glow],
      [w, h, 1 / w, 1 / h],
      [s.wobble, s.wobbleScale, s.wobbleDepth, s.wobbleFine],
      [s.mode === "inverted" ? 1 : s.mode === "middle" ? 2 : 0, outlineIndex(), s.whiteOutline ? 1 : 0, s.border],
    ];
    rows.forEach((r, k) => uniforms.set(r, 16 + k * 4));
    // the palette spread over the sheets behind the white front one
    const stops = palettes[s.palette];
    for (let k = 0; k < MAX_SHEETS; k++) {
      const f = Math.min(Math.max((k - 1) / Math.max(s.sheets - 2, 1), 0), 1) * (stops.length - 1);
      const i = Math.min(Math.floor(f), stops.length - 2);
      colour.set(stops[i]).lerp(new Color(stops[i + 1]), f - i);
      // Color.set from hex gives linear values with three's colour management
      uniforms.set([colour.r, colour.g, colour.b, 1], 16 + 10 * 4 + k * 4);
    }
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    // the debug view's lines are where the sheets are cut, wobble aside: from the deepest cut to the shallowest
    const n = s.sheets - 1;
    const [lo, hi] =
      s.mode === "inverted" ? [s.bleed, s.bleed + n * s.step]
      : s.mode === "middle" ? [s.bleed - (n - outlineIndex()) * s.step, s.bleed + outlineIndex() * s.step]
      : [s.bleed - n * s.step, s.bleed];
    debugUniforms.set([s.debug === "shape" ? 2 : 1, s.debugBalls ? 1 : 0, s.step, s.bleed, w, h, lo, hi]);
    device.queue.writeBuffer(debugBuffer, 0, debugUniforms);
  };

  const gui = new GUI({ title: "cut paper" });
  gui.add(settings, "mode", ["cut out", "inverted", "middle"]).onChange(replan);
  gui.add(settings, "outlineAt", 0, 1, 0.01).name("outline depth").onFinishChange(replan);
  gui.add(settings, "whiteOutline").name("white outline");
  gui.add(settings, "border", 0, 0.2, 0.001).name("paper border");
  gui.add(settings, "palette", Object.keys(palettes));
  gui.add(settings, "sheets", 3, MAX_SHEETS, 1);
  gui.add(settings, "bleed", 0, 0.2, 0.001).onFinishChange(replan);
  gui.add(settings, "step", 0.005, 0.06, 0.001);
  gui.add(settings, "round", 0.5, 24, 0.5).name("rounding");
  gui.add(settings, "spacing", 0.01, 0.08, 0.001);
  gui.add(settings, "recess", 0, 0.4, 0.005);
  gui.add(settings, "thickness", 0, 0.03, 0.001);
  gui.add(settings, "penumbra", 0, 0.3, 0.005);
  gui.add(settings, "occlusion", 0, 1, 0.01);
  gui.add(settings, "glow", 0, 1, 0.01);
  gui.add(settings, "grain", 0, 0.3, 0.005);
  gui.add(settings, "edge", 0, 0.6, 0.01).name("edge dark");
  gui.add(settings, "exposure", 0.5, 2, 0.01);
  gui.add(settings, "turn", -180, 180, 1).onFinishChange(replan);
  gui.add(settings, "blend", 0, 0.2, 0.001).name("merge");
  gui.add(settings, "quiver").name("quiver and arrows");
  const debugFolder = gui.addFolder("debug");
  debugFolder.add(settings, "debug", ["off", "distance", "shape"]).name("view");
  debugFolder.add(settings, "debugBalls").name("with balls and trail");
  const cuts = gui.addFolder("hand cut");
  cuts.add(settings, "wobble", 0, 0.12, 0.001).name("stray");
  cuts.add(settings, "wobbleScale", 0.5, 12, 0.1).name("scale");
  cuts.add(settings, "wobbleDepth", 0, 1, 0.01).name("deeper strays more");
  cuts.add(settings, "wobbleFine", 0, 2, 0.01).name("ragged");
  const playFolder = gui.addFolder("ball play");
  const back = () => {
    if (play.mode === "physics") balls.reset();
    replan();
  };
  playFolder.add(play, "mode", ["physics", "keepie-uppie", "juggle"]).onChange(back);
  playFolder.add(status, "text").name("plan").listen().disable();
  playFolder.add(play, "figure", 0.3, 1, 0.01).name("dancer size").onFinishChange(replan);
  playFolder.add(play, "drop", 0, 0.6, 0.01).name("dancer lower").onFinishChange(replan);
  playFolder.add(play, "size", 0.02, 0.15, 0.001).name("ball size").onFinishChange(replan);
  playFolder.add(play, "gravity", 1, 120, 0.1).name("max gravity").onFinishChange(replan);
  playFolder.add(play, "walls", 0, 1, 0.01).name("off the walls").onFinishChange(replan);
  playFolder.add(play, "seed", 1, 100, 1).name("wall seed").onFinishChange(replan);
  playFolder.add(play, "kicks", 1, 16, 1).name("kicks a loop").onFinishChange(replan);
  playFolder.add(play, "keepieBalls", 1, 4, 1).name("keepie balls").onFinishChange(replan);
  playFolder.add(play, "kickWith", ["feet", "hands", "all"]).name("kick with").onChange(replan);
  playFolder.add(play, "pattern").name("siteswap").onFinishChange(replan);
  playFolder.add(play, "beats", 2, 24, 2).name("beats a loop").onFinishChange(replan);
  playFolder.add(play, "juggleWith", ["feet", "hands", "hand and foot"]).name("juggle with").onChange(replan);
  playFolder.add(play, "dwell", 0, 0.9, 0.01).name("dwell").onFinishChange(replan);
  playFolder.add(play, "extraPattern").name("second siteswap").onFinishChange(replan);
  playFolder.add(play, "extraWith", ["feet", "hands", "hand and foot"]).name("second with").onChange(replan);
  playFolder.add(play, "extraWalls", 0, 1, 0.01).name("second off walls").onFinishChange(replan);
  playFolder.add(play, "steep", 0.2, 4, 0.01).name("wall throw flatness").onFinishChange(replan);
  const ballFolder = gui.addFolder("balls");
  ballFolder.add(ballSettings, "count", 0, MAX_BALLS, 1).onFinishChange(() => balls.reset());
  ballFolder.add(ballSettings, "size", 0.02, 0.2, 0.001).onFinishChange(() => balls.reset());
  ballFolder.add(ballSettings, "spread", 0, 0.8, 0.01).onFinishChange(() => balls.reset());
  ballFolder.add(ballSettings, "gravity", 0, 3, 0.01);
  ballFolder.add(ballSettings, "drag", 0, 3, 0.01);
  ballFolder.add(ballSettings, "bounce", 0, 1, 0.01);
  ballFolder.add(ballSettings, "kick", 0, 4, 0.01);
  ballFolder.add(ballSettings, "seed", 1, 100, 1).onFinishChange(() => balls.reset());
  const trailFolder = gui.addFolder("trail");
  trailFolder.add(trail, "width", 0.01, 0.15, 0.001);
  trailFolder.add(trail, "heal", 0.2, 10, 0.1).name("heal seconds");
  trailFolder.add(trail, "push").name("pushes balls");

    /**
   * How well the clip itself loops: body movement from its last frame to its first, against the usual
   * movement between neighbouring frames, over `frames` steps a loop.
   */
  const seam = (frames: number) => {
    const step = (a: number, b: number) => {
      pose(a * clip.duration);
      const before = world.slice();
      pose(b * clip.duration);
      let sum = 0;
      for (let i = 0; i < vertexCount; i += 3) sum += Math.hypot(world[i * 3] - before[i * 3], world[i * 3 + 1] - before[i * 3 + 1], world[i * 3 + 2] - before[i * 3 + 2]);
      return (sum / Math.ceil(vertexCount / 3)) * fit.scale;
    };
    const steps = Array.from({ length: frames - 1 }, (_, i) => step(i / frames, (i + 1) / frames));
    // the wrap: the last frame of one loop to the first of the next
    const wrapStep = step((frames - 1) / frames, 0);
    steps.sort((a, b) => a - b);
    return { wrap: wrapStep, median: steps[steps.length >> 1], max: steps[steps.length - 1] };
  };

  (window as any).__paper = {
    camera, controls, settings, refit, balls, points, trail, play, replan, status, tracks, seam,
    schedule: () => schedule,
    hold: (t: number | null) => (held = t),
  };

  wrap.render = ({ playhead: live, deltaTime, width, height }) => {
    // a recording holds the loop at exact phases
    const playhead = held ?? live;
    const dt = Math.min(deltaTime, 50) / 1000;
    clock += dt;
    // a few steps a frame, so a quick limb can't pass through a ball
    const sub = 4;
    if (play.mode === "physics") {
      for (let k = 0; k < sub; k++) balls.step(dt / sub, settings.bleed, trail.push ? pointer : null);
    } else {
      // on a schedule: where each ball is at this point of the loop, nothing carried over
      const n = Math.min(ballCount(schedule), MAX_BALLS);
      const ps = planSettings();
      balls.x.length = balls.y.length = balls.r.length = n;
      for (let i = 0; i < n; i++) {
        const [x, y] = position(schedule, tracks, i, playhead, ps);
        balls.x[i] = x;
        balls.y[i] = y;
        balls.r[i] = play.size;
      }
    }
    while (points.length && clock - points[0].t > trail.heal) points.shift();
    if (points.length) points[0].start = true;
    writeShapes();
    pose(playhead * clip.duration);
    project();
    device.queue.writeBuffer(vertexBuffer, 0, flat);
    writePasses();
    controls.update();
    writeUniforms(width * pixelRatio, height * pixelRatio, playhead * DURATION * 0.001);

    const encoder = device.createCommandEncoder();
    const mask = encoder.beginRenderPass({ colorAttachments: [{ view: maskView, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    mask.setPipeline(maskPipeline);
    mask.setVertexBuffer(0, vertexBuffer);
    mask.setIndexBuffer(indexBuffer, "uint32");
    mask.drawIndexed(ranges.body);
    if (settings.quiver) mask.drawIndexed(ranges.gear, 1, ranges.body);
    if (settings.eyes) mask.drawIndexed(ranges.eyes, 1, ranges.body + ranges.gear);
    mask.end();

    const groups = SIZE / 8;
    const c = encoder.beginComputePass();
    c.setPipeline(seedPipe);
    c.setBindGroup(0, seedGroup);
    c.dispatchWorkgroups(groups, groups);
    c.setPipeline(floodPipe);
    for (const g of floodGroups) {
      c.setBindGroup(0, g);
      c.dispatchWorkgroups(groups, groups);
    }
    c.setPipeline(resolvePipe);
    c.setBindGroup(0, resolveGroups[0]);
    c.setBindGroup(1, resolveGroups[1]);
    c.dispatchWorkgroups(groups, groups);
    c.setPipeline(blurPipe);
    for (const [g0, g1] of blurGroups) {
      c.setBindGroup(0, g0);
      c.setBindGroup(1, g1);
      c.dispatchWorkgroups(groups, groups);
    }
    c.setPipeline(shrinkPipe);
    shrinkGroups.forEach((g, k) => c.setBindGroup(k, g));
    c.dispatchWorkgroups(READBACK / 8, READBACK / 8);
    c.setPipeline(composePipe);
    composeGroups.forEach((g, k) => c.setBindGroup(k, g));
    c.dispatchWorkgroups(groups, groups);
    c.end();

    // read the dancer back for the balls whenever a staging buffer is free; it lands a frame or two late
    const free = staging.find((b) => !b.busy);
    if (free) encoder.copyBufferToBuffer(smallBuffer, 0, free.buffer, 0, READBACK * READBACK * 4);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    const debugging = settings.debug !== "off";
    pass.setPipeline(debugging ? debugPipeline : paperPipeline);
    pass.setBindGroup(0, debugging ? debugGroup : paperGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    if (free) {
      free.busy = true;
      const sent = clock;
      free.buffer.mapAsync(GPUMapMode.READ).then(
        () => {
          balls.receive(new Float32Array(free.buffer.getMappedRange()).slice(), sent);
          free.buffer.unmap();
          free.busy = false;
        },
        () => (free.busy = false),
      );
    }
  };

  wrap.resize = ({ width, height }) => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  wrap.unload = () => {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    gui.destroy();
    controls.dispose();
    device.destroy();
  };
};

ssam(sketch, {
  mode: "webgpu",
  pixelRatio: window.devicePixelRatio,
  animate: true,
  duration: DURATION,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
