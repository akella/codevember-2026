// A glass statue fills with pink fluid, after arc4g's pieces: it pours in at the head, splashes down
// through the neck, swirls and rises until the whole figure is full; then the plinth opens underneath,
// the fluid drains away through the floor, the level falling from the head down, and it starts again.
//
// The fluid is position-based (Macklin and Müller's PBF), all on the GPU in three's compute: each step the
// particles move under gravity, are kept inside the statue by its distance field (the "prepare sdf
// stream" demo's Venus), and are nudged a few times towards the density of water, from their neighbours,
// which they find through a grid of cells each particle claims a slot in with an atomic add.
//
// It's drawn as one smooth liquid, in screen space: every particle a sphere into a picture of depth, that
// smoothed across (only between depths close together, so edges stay sharp), normals from the smoothed
// depth, and shaded as a milky liquid. That shading is done by a quad in the scene itself, writing real
// depth, so the statue's glass (three's transmission sees what's drawn opaque behind it) bends it, and the
// contact shading darkens its folds. Or, as an option, as satin beads.
import type { Sketch, SketchSettings } from "ssam";
import { ssam } from "ssam";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { denoise } from "three/examples/jsm/tsl/display/DenoiseNode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import {
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  QuadMesh,
  RenderTarget,
  ShadowNodeMaterial,
} from "three/webgpu";
import {
  atomicAdd,
  atomicMax,
  atomicStore,
  cameraFar,
  cameraNear,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraWorldMatrix,
  color,
  cross,
  Discard,
  dot,
  exp,
  float,
  floor,
  Fn,
  hash,
  If,
  instancedArray,
  instanceIndex,
  int,
  ivec2,
  ivec3,
  Loop,
  max,
  min,
  mix,
  mrt,
  normalView,
  output,
  positionView,
  pass,
  pmremTexture,
  positionGeometry,
  positionLocal,
  reflect,
  renderOutput,
  screenCoordinate,
  screenUV,
  select,
  smoothstep,
  storage,
  texture,
  texture3D,
  textureLoad,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Box3,
  Data3DTexture,
  DirectionalLight,
  FloatType,
  HalfFloatType,
  HemisphereLight,
  InstancedMesh,
  LinearFilter,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PostProcessing,
  RedFormat,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { flattenSwizzles } from "../cage/pattern";
import palettes from "nice-color-palettes/200.json";

const STATUES = ["venus", "neptune"] as const;
/** most particles there can be: buffers are made this big */
const MOST = 120000;
/** particles a grid cell holds; more than that and the rest go unseen by their neighbours */
const CAP = 16;

const look = {
  top: "#bfe0dc",
  bottom: "#e6f3f1",
  /** how dark the shadows on the floor are */
  shadow: 0.35,
  fluid: "#f099ae",
  roughness: 0.42,
  coat: 0.3,
  /** a satin sheen over the beads, as velvet or soft plastic has */
  sheen: 0.6,
  glassTint: "#f7fcfb",
  glassRoughness: 0.02,
  ior: 1.45,
  /** how thick the glass is taken to be: how far it shifts what's seen through it (0: not at all) */
  glassThickness: 0.03,
  key: 2.6,
  /** a light from behind and to the right, for bright rims on the glass */
  rim: 2.2,
  sky: 1.1,
  reflections: 1.0,
  occlusion: 1.2,
  exposure: 1,
  /** drawn as beads, each one of a palette's five colours (from nice-color-palettes), or all the fluid's */
  colourful: true,
  palette: 21,
  /** the glass itself, to see the fluid alone */
  glass: true,
};

const liquid = {
  /** one smooth liquid, or every particle a satin bead */
  style: "beads" as "liquid" | "beads",
  /** each particle drawn this many radii big, so neighbours merge into one surface */
  blob: 2.2,
  /** how far the surface is smoothed, in radii, and how many times over */
  smoothing: 5,
  passes: 2,
  /** how milky: high is opaque, like paint; low lets the light through where it's thin */
  milk: 0.85,
  /** how glossy its skin is: the highlight's size, and the reflections' sharpness */
  gloss: 0.14,
  /** where thin, how much the backdrop behind bends through it */
  bend: 0.04,
  /** against the glass, take the glass's shape (as a liquid in a bottle does), not the particles' bumps */
  hug: true,
  /** the liquid's pictures, as a part of the drawing's size: 0 for half on dense screens, else full */
  resolution: 0,
};
/**
 * Taps either side, a smoothing pass. They're never more than a pixel and a quarter apart: spread wider,
 * they skipped pixels, and the skipping beat against the spheres' bumps in a fine crosshatch. Further
 * smoothing comes from more passes, not wider ones.
 */
const TAPS = 12;

const fluid = {
  /** particle radius, in the statue's units (it's 2.2 tall) */
  radius: 0.0105,
  /** how much of the statue fills */
  fill: 1.2,
  /** seconds to fill it */
  pour: 14,
  /** how fast it comes in, down */
  speed: 1.5,
  /** solver iterations a step, and steps a frame */
  iterations: 3,
  substeps: 6,
  gravity: 9.8,
  /**
   * PBF's artificial pressure (it keeps particles from clumping in pairs; in units of a squeeze, see
   * stiffness below), and a little viscosity.
   */
  tension: 0.1,
  viscosity: 0.02,
  /**
   * Particles that stay within this many radii of where they were, surrounded, for this many seconds go to
   * sleep: they stop, and stay in the grid as solid neighbours for the rest, until the drain wakes them
   * all. Deep packed fluid never quite comes to rest otherwise (it shivers under the weight above, and
   * blinked); asleep, they hold up the layer above, which calms and sleeps in turn, and cost almost nothing.
   * (Measured by speed, the shiver kept nearly all of them awake.)
   */
  still: 1,
  sleep: 0.5,
  /** how deep under the settled level, in radii, they stay awake whatever: the waves and splashes */
  awake: 6,
  /**
   * Inside, crowded and slow (not the stream, not the surface), a particle's speed is mostly the solver's
   * own corrections turned into momentum, and it overshoots: a shiver. This takes it away, per second.
   */
  calm: 20,
  /** seconds it holds full, and seconds it drains before starting again */
  hold: 3,
  spill: 6,
  /**
   * How it ends: drained away through the plinth, or spilled: the glass goes, and with it the bounds,
   * and the beads all flow down onto the floor and pile up there (it grips them: they don't spread thin)
   */
  ending: "spill" as "drain" | "spill",
  grip: 30,
  /** and spilled, thick: each drags its neighbours along (viscosity), so they slump into a mound and stop */
  thick: 0.35,
  /**
   * and spilled, heavy: a bead resting on others or on the floor loses its sideways speed as friction
   * would (μ·g a second), so the heap stops, at a slope, instead of creeping flat
   */
  friction: 0.6,
  /** how much each bead differs from the next (its friction, where it sits on the floor), 0 all alike */
  uneven: 0.9,
  /** spilled, the whole lot leans off to one side, a random one each time (m/s), and each bead jostles */
  lean: 0.8,
};

/**
 * The show (?show): one loop for the recording. Venus fills with liquid as the camera goes once round her,
 * holds, and drains; her glass fades and Neptune's comes; he fills with beads, his glass goes, and they fall
 * and pile on the floor; the pile shrinks away as Venus's glass fades back in, as at the start. Seconds, on
 * the simulation's own clock (each pour ends itself, when full; the rest is on time).
 */
const SHOW = {
  /** Venus: the pour starts, it drains, her glass fades out */
  venusPour: 0.3,
  venusDrain: 19.5,
  venusOut: 24,
  /** Neptune's glass fades in, he fills, his glass goes and the beads spill */
  swap: 25,
  neptunePour: 25.8,
  neptuneVanish: 43,
  /** the pile shrinks, and Venus's glass fades in: the loop's end is its start */
  fade: 49.5,
  length: 51,
  /** the camera: once round in the loop, from where it starts */
  orbit: {
    radius: 5.475,
    height: 1.35,
    target: 1.0,
    from: Math.atan2(0.9, 5.4),
  },
};

/** day 3's field format from the "prepare sdf stream" bake: "SDF1", dims, box, then half floats */
async function loadField(url: string) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const dims = [4, 8, 12].map((o) => dv.getUint32(o, true));
  const boxMin = new Vector3(
    dv.getFloat32(16, true),
    dv.getFloat32(20, true),
    dv.getFloat32(24, true),
  );
  const boxMax = new Vector3(
    dv.getFloat32(28, true),
    dv.getFloat32(32, true),
    dv.getFloat32(36, true),
  );
  const data = new Uint16Array(buf, 40, dims[0] * dims[1] * dims[2]);
  const tex = new Data3DTexture(data, dims[0], dims[1], dims[2]);
  tex.format = RedFormat;
  tex.type = HalfFloatType;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { tex, data, dims, boxMin, boxMax };
}
/** the matching mesh: "MSH1", counts, positions, normals, a thickness each, indices */
async function loadMesh(url: string) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const V = dv.getUint32(4, true),
    I = dv.getUint32(8, true);
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(buf, 12, V * 3), 3),
  );
  g.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array(buf, 12 + V * 12, V * 3), 3),
  );
  g.setIndex(new BufferAttribute(new Uint32Array(buf, 12 + V * 28, I), 1));
  return g;
}
const halfToFloat = (h: number) => {
  const s = h & 0x8000 ? -1 : 1,
    e = (h >> 10) & 31,
    m = h & 1023;
  return e === 0 ? s * m * 2 ** -24 : s * (1 + m / 1024) * 2 ** (e - 15);
};

/** a statue's container: its field and mesh, and what the pour needs to know of it, slice by slice */
function prepareStatue(
  field: Awaited<ReturnType<typeof loadField>>,
  mesh: BufferGeometry,
) {
  const { boxMin, boxMax, dims } = field;
  const boxSize = boxMax.clone().sub(boxMin);
  const voxel = boxSize.x / dims[0];
  // How much the statue holds, slice by slice up her, and each slice's deepest point. The fluid comes in
  // from a nozzle at the deepest point of a slice a little above the level, climbing as it rises: from her
  // chest it falls through her open body, and at the end it's in her head. (Fixed in the head, the stream
  // jammed in the narrow neck and sprayed out of it as rain; fixed in the chest, it could fill no higher.)
  const cell =
    (boxSize.x / dims[0]) * (boxSize.y / dims[1]) * (boxSize.z / dims[2]);
  const slices = Array.from({ length: dims[1] }, (_, y) => ({
    y: boxMin.y + ((y + 0.5) / dims[1]) * boxSize.y,
    below: 0,
    depth: 0,
    at: new Vector3(),
  }));
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const d = halfToFloat(field.data[(z * dims[1] + y) * dims[0] + x]);
        if (d >= 0) continue;
        const slice = slices[y];
        slice.below += cell;
        if (d < slice.depth)
          ((slice.depth = d),
            slice.at.set(
              boxMin.x + ((x + 0.5) / dims[0]) * boxSize.x,
              slice.y,
              boxMin.z + ((z + 0.5) / dims[2]) * boxSize.z,
            ));
      }
  // each slice's volume so far, from the bottom up
  for (let y = 1; y < dims[1]; y++) slices[y].below += slices[y - 1].below;
  const volume = slices[dims[1] - 1].below;
  // where the nozzle can go: slices with room for one (not the plinth's top), from her waist up
  const rooms = slices.filter(
    (s) => s.depth < -0.04 && s.y > boxMin.y + boxSize.y * 0.55,
  );
  // the roomiest in a stretch a little above the level (the first above it can be her narrow neck, and only
  // a trickle fits through a narrow nozzle); past her crown, the roomiest of her head
  const nozzleAt = (level: number) => {
    const from = Math.max(level + 0.1, rooms[0].y);
    const near = rooms.filter((s) => s.y >= from && s.y < from + 0.2);
    const choice = near.length
      ? near
      : rooms.filter((s) => s.y > rooms[rooms.length - 1].y - 0.3);
    return choice.reduce((a, b) => (b.depth < a.depth ? b : a));
  };
  const source = rooms[0].at.clone(),
    deepest = rooms[0].depth;
  return {
    field,
    mesh,
    boxMin,
    boxSize,
    dims,
    voxel,
    slices,
    volume,
    rooms,
    nozzleAt,
    source,
    deepest,
    /** the top of her head, as far as the nozzle goes */
    crown: rooms[rooms.length - 1].y,
    /** the floor she stands on, and where the plinth opens to drain */
    floorY: boxMin.y + voxel * 2,
    drainAt: boxMin.y + voxel * 5,
  };
}
type Statue = ReturnType<typeof prepareStatue>;

const sketch: Sketch<"webgpu"> = async ({
  wrap,
  canvas,
  width,
  height,
  pixelRatio,
}) => {
  if (import.meta.hot) import.meta.hot.dispose(() => wrap.dispose());
  // ?timing: the GPU's own time for the simulation and the picture, a frame (for tools/fillperf.mjs)
  const timing = new URLSearchParams(location.search).has("timing");
  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,
    trackTimestamp: timing,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  await renderer.init();
  flattenSwizzles(renderer);

  // which sculpture: ?statue=neptune (each baked by the "prepare sdf stream" demo's tools/bake.py, then
  // refitted to this space by tools/fitstatue.mjs)
  const params = new URLSearchParams(location.search);
  const statueName = STATUES.includes(params.get("statue") as any)
    ? (params.get("statue") as (typeof STATUES)[number])
    : "venus";
  // Both, ready: switched between without a reload (the recording goes from one to the other)
  const statues = Object.fromEntries(
    await Promise.all(
      STATUES.map(async (name) => {
        const [field, mesh] = await Promise.all([
          loadField(`./sdf/${name}.sdf`),
          loadMesh(`./sdf/${name}.mesh`),
        ]);
        return [name, prepareStatue(field, mesh)] as const;
      }),
    ),
  ) as Record<(typeof STATUES)[number], Statue>;
  // ?show plays the loop; ?record also waits to be stepped, a frame at a time (tools/record.mjs)
  const showing = params.has("show"),
    recording = params.has("record");
  let shown = statues[statueName],
    shownName = statueName;
  // the grids over her footprint and round her span every statue's box
  const room = new Box3();
  for (const one of Object.values(statues))
    room.union(new Box3(one.boxMin, one.field.boxMax));
  const roomMin = room.min,
    roomSize = room.getSize(new Vector3());

  // ---- scene: a pastel studio
  const scene = new Scene();
  const top = uniform(color(look.top)),
    bottom = uniform(color(look.bottom));
  scene.backgroundNode = mix(top, bottom, smoothstep(0.0, 1.0, screenUV.y));
  scene.environment = new PMREMGenerator(renderer).fromScene(
    new RoomEnvironment(),
    0.04,
  ).texture;
  const camera = new PerspectiveCamera(30, width / height, 0.05, 40);
  camera.position.set(0.9, 1.35, 5.4);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.update();
  const sky = new HemisphereLight(0xffffff, 0xcfe6e3, look.sky);
  scene.add(sky);
  const key = new DirectionalLight(0xffffff, look.key);
  key.position.set(-2.5, 5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, {
    left: -2,
    right: 2,
    top: 3,
    bottom: -1,
    near: 0.5,
    far: 15,
  });
  scene.add(key);
  const rim = new DirectionalLight(0xffffff, look.rim);
  rim.position.set(3, 3, -4);
  scene.add(rim);
  const floorY = shown.floorY;
  // shadows only, over the backdrop, so the studio has no horizon
  const ground = new Mesh(
    new PlaneGeometry(30, 30),
    new ShadowNodeMaterial({ opacity: 0.35 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = floorY;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- the fluid's buffers and settings
  const position = instancedArray(MOST, "vec3");
  const velocity = instancedArray(MOST, "vec3");
  const predicted = instancedArray(MOST, "vec3");
  const lambda = instancedArray(MOST, "float");
  const delta = instancedArray(MOST, "vec3");
  /**
   * Where each was when it last moved off (xyz), and the seconds since, still and surrounded (w; asleep
   * past fluid.sleep): one buffer, as a compute pass gets eight. And its density over rest.
   */
  const settling = instancedArray(MOST, "vec4");
  const crowd = instancedArray(MOST, "float");
  // The grid, hashed: each cell of space (h across) is a bucket in a table, picked by a hash of where it
  // is, so it covers anywhere the fluid goes (spilled across the floor too) for one table's memory. Two
  // cells can share a bucket; that only costs a few more neighbours to check, as they're checked by distance.
  // (A box of cells instead had to fit the buffers, and past them particles lost their neighbours and
  // their pressure, and packed down.)
  const TABLE = 1 << 19;
  const radius = uniform(fluid.radius),
    h = uniform(fluid.radius * 4);
  const cellCount = instancedArray(TABLE, "uint").toAtomic();
  // The same counts, read plainly: the passes that only read them would need atomicLoad, and three r182
  // dropped its value in an expression (it came out as min(0u, 16u): no neighbours, no pressure, and all
  // the fluid packed into the plinth). A non-atomic view of the buffer reads them as numbers.
  const cellCountRead = storage(cellCount.value, "uint", TABLE);
  const cellItems = instancedArray(TABLE * CAP, "uint");
  const dt = uniform(1 / 180),
    alive = uniform(0, "uint"),
    spawnFrom = uniform(0, "uint");
  const gravity = uniform(fluid.gravity),
    tension = uniform(fluid.tension),
    viscosity = uniform(fluid.viscosity);
  const rest = uniform(1),
    stiff = uniform(1),
    inflow = uniform(fluid.speed),
    sourceAt = uniform(shown.source.clone()),
    headRoom = uniform(
      Math.max(-shown.deepest - fluid.radius * 2, fluid.radius),
    );
  const floorAt = uniform(floorY),
    draining = uniform(0),
    // spilled: no bounds but the floor; wake: every sleeper up, this frame; grip: how much of its sliding
    // a particle on the floor keeps, a step
    released = uniform(0),
    wake = uniform(0),
    grip = uniform(1),
    friction = uniform(fluid.friction),
    calming = uniform(1),
    // (pouring, the stream's own crowd is spared: past this speed, squared, it's falling, not shivering)
    calmBelow = uniform(0.25),
    // just let go: the most it may move sideways (beyond its lean), m/s, while the squeeze it was held in
    // relaxes (PBF turns that into speed: a few millimetres a substep, and the statue burst outward)
    letGo = uniform(1e9),
    leanSpeed = uniform(new Vector3()),
    uneven = uniform(fluid.uneven),
    // the push it's given as it's let go: all one way (lean), and each its own bit (jostle)
    lean = uniform(new Vector3()),
    jostle = uniform(0),
    drainAt = uniform(shown.drainAt);
  const fieldMin = uniform(shown.boxMin.clone()),
    fieldSize = uniform(shown.boxSize.clone()),
    fieldStep = uniform(shown.voxel);
  const stillSpeed = uniform(fluid.still),
    sleepAfter = uniform(fluid.sleep),
    awakeBand = uniform(fluid.awake);
  const asleep = (i: any) => settling.element(i).w.greaterThan(sleepAfter);
  /** each bead's own, from 0 to 1: its friction, and how deep it sits in the floor */
  const own = (i: any, k: number) => hash(float(i).mul(0.7319).add(k));

  // the smoothing kernels (poly6 for density, spiky's gradient for pushing apart)
  const poly6 = (r2: any) => {
    const h2 = h.mul(h);
    const x = h2.sub(r2).max(0);
    return x
      .mul(x)
      .mul(x)
      .mul(float(315 / (64 * Math.PI)).div(h.pow(9)));
  };
  /**
   * From j to i, or, for two on top of each other, a direction of their own: with none, nothing could ever
   * push them apart, and pairs stayed merged for good.
   */
  const apart = (i: any, j: any, d: any) => {
    const seed = float(i).mul(0.618).add(float(j).mul(1.379));
    const nudge = vec3(hash(seed), hash(seed.add(3.1)), hash(seed.add(7.7)))
      .sub(0.5)
      .mul(radius.mul(0.02))
      .mul(select(i.greaterThan(j), float(1), float(-1)));
    return select(dot(d, d).lessThan(radius.mul(radius).mul(1e-4)), nudge, d);
  };
  const spikyGrad = (d: any, r: any) => {
    const x = h.sub(r).max(0);
    return d
      .div(r.max(1e-6))
      .mul(x.mul(x))
      .mul(float(-45 / Math.PI).div(h.pow(6)));
  };
  /** rest density: what a particle sees packed at its own spacing, on a lattice */
  const restDensity = () => {
    const H = fluid.radius * 4,
      s = fluid.radius * 2;
    let sum = 0;
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++)
        for (let z = -3; z <= 3; z++) {
          const r2 = (x * x + y * y + z * z) * s * s;
          if (r2 < H * H)
            sum += ((H * H - r2) ** 3 * 315) / (64 * Math.PI * H ** 9);
        }
    return sum;
  };
  /**
   * How stiff the solver is there: the sum of the constraint's squared gradients over the lattice, what
   * lambda divides by. The surface pull is scaled by it, so its setting is in the same units as a
   * squeeze (0.1: as hard as fluid 10% too dense pushes). Unscaled, at these sizes, it was ten times the
   * pressure itself, and every particle jittered a radius or two a step.
   */
  const stiffness = (restValue: number) => {
    const H = fluid.radius * 4,
      s = fluid.radius * 2;
    let sum = 0;
    for (let x = -3; x <= 3; x++)
      for (let y = -3; y <= 3; y++)
        for (let z = -3; z <= 3; z++) {
          const r = Math.sqrt(x * x + y * y + z * z) * s;
          if (r > 0 && r < H)
            sum += (((45 / Math.PI) * (H - r) ** 2) / H ** 6 / restValue) ** 2;
        }
    return sum;
  };

  // ---- the statue as a container: its distance field, a step back inside where a particle got out
  const fieldLookups: any[] = [];
  const fieldAt = (p: any) => {
    const uvw = p.sub(fieldMin).div(fieldSize);
    const outside = uvw.x
      .lessThan(0)
      .or(uvw.y.lessThan(0))
      .or(uvw.z.lessThan(0))
      .or(uvw.x.greaterThan(1))
      .or(uvw.y.greaterThan(1))
      .or(uvw.z.greaterThan(1));
    // (every lookup's node kept, to be pointed at another statue's field)
    const look = texture3D(shown.field.tex, uvw.clamp(0, 1));
    fieldLookups.push(look);
    return select(outside, float(1), look.level(float(0)).r);
  };
  const collide = Fn(([p, i]: [any, any]) => {
    const q = p.toVar();
    // draining, the plinth is open underneath: what reaches its bottom falls through, and away
    const throughFloor = draining.greaterThan(0.5).and(q.y.lessThan(drainAt));
    If(throughFloor.not().and(released.lessThan(0.5)), () => {
      const d = fieldAt(q);
      const margin = radius.mul(1.1);
      If(d.greaterThan(margin.negate()), () => {
        const e = fieldStep;
        const g = vec3(
          fieldAt(q.add(vec3(e, 0, 0))).sub(fieldAt(q.sub(vec3(e, 0, 0)))),
          fieldAt(q.add(vec3(0, e, 0))).sub(fieldAt(q.sub(vec3(0, e, 0)))),
          fieldAt(q.add(vec3(0, 0, e))).sub(fieldAt(q.sub(vec3(0, 0, e)))),
        );
        // outside the field's box it's flat, with no way back: normalising nothing gave NaN, which spread
        If(dot(g, g).greaterThan(1e-12), () => {
          q.subAssign(g.normalize().mul(d.add(margin)));
        });
      });
    });
    If(draining.lessThan(0.5), () => {
      q.y.assign(
        q.y.max(
          floorAt.add(radius.mul(own(i, 5.3).mul(uneven).mul(-0.45).add(1))),
        ),
      );
    });
    return q;
  });

  const cellOf = (p: any) => ivec3(floor(p.div(h)));
  // (mixed well: the plain xor of three primes kept the low bits' pattern, and taken mod the table, piled
  // neighbouring cells into the same buckets, which overflowed: lost neighbours, and five times the time)
  const cellIndex = (c: any) => {
    const k = uint(c.x)
      .mul(uint(0x8da6b343))
      .add(uint(c.y).mul(uint(0xd8163841)))
      .add(uint(c.z).mul(uint(0xcb1ab31f)));
    const a = k.bitXor(k.shiftRight(uint(16))).mul(uint(0x7feb352d));
    const b = a.bitXor(a.shiftRight(uint(15))).mul(uint(0x846ca68b));
    return b.bitXor(b.shiftRight(uint(16))).bitAnd(uint(TABLE - 1));
  };
  /** every particle in the 27 cells round p */
  const eachNeighbour = (p: any, body: (j: any) => void) => {
    const c = cellOf(p);
    (Loop as any)(
      { start: int(-1), end: int(2), type: "int" },
      { start: int(-1), end: int(2), type: "int" },
      { start: int(-1), end: int(2), type: "int" },
      ({ i, j, k }: any) => {
        const cell = cellIndex(c.add(ivec3(i, j, k)));
        const count = min(cellCountRead.element(cell), uint(CAP));
        Loop(
          { start: uint(0), end: count, type: "uint", name: "s" },
          ({ s }: any) => {
            body(cellItems.element(cell.mul(CAP).add(s)));
          },
        );
      },
    );
  };

  // ---- how high the settled liquid stands, column by column over her footprint: the highest particle
  // that's calm and crowded (not spray, not the stream) in each. Below it, all of her is drawn full, the
  // smallest folds too, which particles can't get into, and nothing there can blink.
  const COLUMNS = 96;
  const columnMin = uniform(new Vector3(roomMin.x, 0, roomMin.z)),
    columnSize = uniform(new Vector3(roomSize.x, 1, roomSize.z));
  const tops = instancedArray(COLUMNS * COLUMNS, "uint").toAtomic();
  const topsRead = storage(tops.value, "uint", COLUMNS * COLUMNS).toReadOnly();
  const columnOf = (p: any) =>
    ivec2(p.xz.sub(columnMin.xz).div(columnSize.xz).mul(COLUMNS).floor()).clamp(
      ivec2(0),
      ivec2(COLUMNS - 1),
    );
  /** heights kept as whole tenths of a millimetre above the floor */
  const TOP = 10000;
  const clearTops = Fn(() => {
    atomicStore(tops.element(instanceIndex), uint(0));
  })().compute(COLUMNS * COLUMNS);
  // And near each point, not just above it: a grid of cells about 2 cm, each holding the highest settled
  // particle in it and the cells round it. Glass under that is full. (By columns alone, a puddle left in
  // the pocket at her arm painted all of her side below it full, while it drained.)
  const NEAR = 0.02;
  const nearDims = new Vector3()
    .copy(roomSize)
    .divideScalar(NEAR)
    .ceil()
    .addScalar(1);
  const nearCells = nearDims.x * nearDims.y * nearDims.z;
  const nearSize = uniform(nearDims),
    nearMin = uniform(roomMin.clone());
  const nearby = instancedArray(nearCells, "uint").toAtomic();
  const nearbyRead = storage(nearby.value, "uint", nearCells).toReadOnly();
  const nearCellOf = (p: any) =>
    ivec3(p.sub(nearMin).div(NEAR).floor()).clamp(
      ivec3(0),
      ivec3(nearSize).sub(1),
    );
  const nearIndex = (c: any) =>
    c.x
      .add(c.y.mul(int(nearSize.x)))
      .add(c.z.mul(int(nearSize.x)).mul(int(nearSize.y)));
  const clearNearby = Fn(() => {
    atomicStore(nearby.element(instanceIndex), uint(0));
  })().compute(nearCells);
  const markTops = Fn(() => {
    const i = instanceIndex;
    const p = position.element(i);
    // Only the settled: slow, neighbours all round, and below the nozzle (the pool always is). The few
    // slow ones round the nozzle raised it, the nozzle climbed after it, and so on, runaway; asked to have
    // held their place a while, in a fluid that shivers, hardly any ever did.
    // (and calm a moment: where the stream lands it jams, crowded and slow, and counted)
    const settled = crowd
      .element(i)
      .greaterThan(0.9)
      .and(velocity.element(i).length().lessThan(0.5))
      .and(settling.element(i).w.greaterThan(0.1))
      .and(p.y.greaterThan(floorAt))
      .and(p.y.lessThan(sourceAt.y.sub(0.05)));
    If(i.lessThan(alive).and(settled), () => {
      const c = columnOf(p);
      const height = uint(p.y.sub(floorAt).add(radius).mul(TOP));
      atomicMax(tops.element(c.x.add(c.y.mul(COLUMNS))), height);
      // painting the glass wants them calmer still (a passing crest marked a block of it)
      const at = nearCellOf(p);
      If(settling.element(i).w.greaterThan(0.3), () => {
        for (let z = -1; z <= 1; z++)
          for (let y = -1; y <= 1; y++)
            for (let x = -1; x <= 1; x++) {
              const n = at
                .add(ivec3(x, y, z))
                .clamp(ivec3(0), ivec3(nearSize).sub(1));
              atomicMax(nearby.element(nearIndex(n)), height);
            }
      });
    });
  })().compute(MOST);

  // ---- the passes
  const clearGrid = Fn(() => {
    atomicStore(cellCount.element(instanceIndex), uint(0));
  })().compute(TABLE);
  // New particles, from a nozzle: this frame's in layers a particle apart, each a disc packed as a
  // sunflower's spiral at the fluid's own spacing, so they come in as one column and fall as a stream.
  // Packed any closer, the solver blew them apart into spray at once; scattered, they fell as rain.
  const nozzle = uniform(0.04),
    layers = uniform(1),
    turn = uniform(0);
  const spawn = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(spawnFrom).and(i.lessThan(alive)), () => {
      const k = float(i.sub(spawnFrom)),
        n = float(alive.sub(spawnFrom));
      const layer = k.mod(layers),
        j = k.div(layers).floor(),
        perLayer = n.div(layers).ceil();
      const along = j.add(0.5).div(perLayer).sqrt().mul(nozzle);
      const angle = j.mul(2.39996).add(turn).add(layer.mul(1.1));
      const p = sourceAt.add(
        vec3(
          angle.cos().mul(along),
          layer.mul(radius).mul(-2),
          angle.sin().mul(along),
        ),
      );
      position.element(i).assign(p);
      predicted.element(i).assign(p);
      velocity.element(i).assign(vec3(0, inflow.negate(), 0));
      settling.element(i).assign(vec4(p, 0));
      crowd.element(i).assign(0);
    });
  })().compute(MOST);
  const predict = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive), () => {
      // the drain wakes them all
      If(draining.greaterThan(0.5).or(wake.greaterThan(0.5)), () => {
        settling.element(i).w.assign(0);
      });
      If(asleep(i), () => {
        velocity.element(i).assign(vec3(0));
        predicted.element(i).assign(position.element(i));
      }).Else(() => {
        const v = velocity
          .element(i)
          .add(vec3(0, gravity.negate(), 0).mul(dt))
          .toVar();
        // let go: all of it leaning one way, each bead jostled its own
        If(wake.greaterThan(0.5).and(released.greaterThan(0.5)), () => {
          v.addAssign(
            lean.add(
              vec3(own(i, 1.1), own(i, 2.2).mul(0.5), own(i, 3.3))
                .sub(0.5)
                .mul(jostle),
            ),
          );
        });
        // no faster than a couple of particles a step, so nothing tunnels through the glass
        const most = radius.mul(2).div(dt);
        If(v.length().greaterThan(most), () => {
          v.assign(v.normalize().mul(most));
        });
        velocity.element(i).assign(v);
        predicted
          .element(i)
          .assign(collide(position.element(i).add(v.mul(dt)), i));
      });
      const p = predicted.element(i);
      const cell = cellIndex(cellOf(p));
      const slot = atomicAdd(cellCount.element(cell), uint(1));
      If(slot.lessThan(uint(CAP)), () => {
        cellItems.element(uint(cell).mul(CAP).add(slot)).assign(i);
      });
    });
  })().compute(MOST);
  // how far each is from water's density, and how hard it must move to get there
  // (asleep, a particle does none of this: it's a solid neighbour with no push of its own)
  const solveDensity = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive).and(asleep(i).not()), () => {
      const p = predicted.element(i);
      const density = float(0).toVar(),
        sumGrad = float(0).toVar();
      const gradSelf = vec3(0).toVar();
      eachNeighbour(p, (j: any) => {
        const d = apart(i, j, p.sub(predicted.element(j)));
        const r2 = dot(d, d);
        If(r2.lessThan(h.mul(h)), () => {
          density.addAssign(poly6(r2));
          If(j.notEqual(i), () => {
            const g = spikyGrad(d, r2.sqrt()).div(rest);
            gradSelf.addAssign(g);
            sumGrad.addAssign(dot(g, g));
          });
        });
      });
      // only ever pushed apart, never pulled together: a free surface, not a sticky one
      crowd.element(i).assign(density.div(rest));
      const C = density.div(rest).sub(1).max(0);
      lambda
        .element(i)
        .assign(C.negate().div(sumGrad.add(dot(gradSelf, gradSelf)).add(100)));
    });
  })().compute(MOST);
  const solveMove = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive).and(asleep(i).not()), () => {
      const p = predicted.element(i);
      const li = lambda.element(i);
      const move = vec3(0).toVar();
      const wq = poly6(h.mul(0.2).mul(h.mul(0.2)));
      eachNeighbour(p, (j: any) => {
        If(j.notEqual(i), () => {
          const d = apart(i, j, p.sub(predicted.element(j)));
          const r2 = dot(d, d);
          If(r2.lessThan(h.mul(h)), () => {
            const ratio = poly6(r2).div(wq);
            const corr = tension
              .negate()
              .div(stiff)
              .mul(ratio.mul(ratio).mul(ratio).mul(ratio));
            // a sleeper's lambda is stale: it pushes back as hard as it's pushed, like a wall
            const lj = select(asleep(j), li, lambda.element(j));
            move.addAssign(spikyGrad(d, r2.sqrt()).mul(li.add(lj).add(corr)));
          });
        });
      });
      delta.element(i).assign(move.div(rest));
    });
  })().compute(MOST);
  const applyMove = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive).and(asleep(i).not()), () => {
      // never more than a bead and a half a go: a crowd far from water's density moves out of it in steps,
      // not in one burst; tighter, and pressure couldn't lift the fluid up through her feet
      const move = delta.element(i).toVar();
      const most = radius.mul(1.5);
      If(move.length().greaterThan(most), () => {
        move.assign(move.normalize().mul(most));
      });
      predicted.element(i).assign(collide(predicted.element(i).add(move), i));
    });
  })().compute(MOST);
  // velocity from where it ended up, a little evened out with its neighbours' (XSPH viscosity)
  const update = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive).and(asleep(i).not()), () => {
      const p = predicted.element(i);
      const v = p.sub(position.element(i)).div(dt).toVar();
      const even = vec3(0).toVar();
      eachNeighbour(p, (j: any) => {
        If(j.notEqual(i), () => {
          const d = p.sub(predicted.element(j));
          const r2 = dot(d, d);
          If(r2.lessThan(h.mul(h)), () => {
            even.addAssign(
              predicted
                .element(j)
                .sub(position.element(j))
                .div(dt)
                .sub(v)
                .mul(poly6(r2)),
            );
          });
        });
      });
      const evened = v.add(even.mul(viscosity).div(rest));
      // spilled, on the floor, it grips: it loses its sliding, so they pile up and don't spread thin
      const onFloor = released
        .greaterThan(0.5)
        .and(p.y.lessThan(floorAt.add(radius.mul(1.6))));
      // each its own grip on the floor: some slide on further than others, so the edge isn't a circle
      const mine = own(i, 9.1).mul(1.6).add(0.2).sub(1).mul(uneven).add(1);
      const settled = select(
        onFloor,
        evened.mul(vec3(grip.pow(mine), 1, grip.pow(mine))),
        evened,
      ).toVar();
      // spilled and resting on something (crowded, or on the floor): friction takes its sideways speed,
      // and slow enough it stops dead, rather than creeping on and on flat
      const resting = released
        .greaterThan(0.5)
        .and(onFloor.or(crowd.element(i).greaterThan(0.6)));
      If(resting, () => {
        const side = settled.xz.length();
        const left = side.sub(friction.mul(mine).mul(gravity).mul(dt)).max(0);
        settled.x.assign(settled.x.mul(left.div(side.max(1e-6))));
        settled.z.assign(settled.z.mul(left.div(side.max(1e-6))));
      });
      // in her, crowded and slow: calmed, so the solver's jiggle doesn't carry over into the next step
      If(
        released
          .lessThan(0.5)
          .and(crowd.element(i).greaterThan(0.9))
          .and(dot(settled, settled).lessThan(calmBelow)),
        () => {
          settled.mulAssign(calming);
        },
      );
      If(released.greaterThan(0.5), () => {
        const drift = settled.xz.sub(leanSpeed.xz);
        const kept = drift.mul(letGo.div(drift.length().max(letGo)));
        settled.x.assign(leanSpeed.x.add(kept.x));
        settled.z.assign(leanSpeed.z.add(kept.y));
      });
      velocity.element(i).assign(settled);
      // staying put, give or take its shiver, and with neighbours all round (not at the surface, not in the
      // stream): towards sleep; moved off, it starts again from here
      // or well under the settled level in its column (last frame's), however it shivers: down there it's
      // full whatever each particle does, and frozen it can't blink
      const was = settling.element(i);
      const put = p.sub(was.xyz).length().lessThan(radius.mul(stillSpeed));
      const c = columnOf(p);
      const top = float(topsRead.element(c.x.add(c.y.mul(COLUMNS))))
        .div(TOP)
        .add(floorAt);
      // (the columns are her footprint's: spilled, they say nothing)
      const deep = p.y
        .lessThan(top.sub(radius.mul(awakeBand)))
        .and(released.lessThan(0.5));
      const quiet = put
        .or(deep)
        .and(
          crowd
            .element(i)
            .greaterThan(
              select(released.greaterThan(0.5), float(0.45), float(0.9)),
            ),
        )
        .and(draining.lessThan(0.5));
      settling
        .element(i)
        .assign(select(quiet, vec4(was.xyz, was.w.add(dt)), vec4(p, 0)));
    });
  })().compute(MOST);
  const settle = Fn(() => {
    const i = instanceIndex;
    If(i.lessThan(alive), () => {
      position.element(i).assign(predicted.element(i));
    });
  })().compute(MOST);

  // ---- drawn: satin beads, and the statue as clear glass round them
  const beadPaint = new MeshPhysicalNodeMaterial({
    color: look.fluid,
    roughness: look.roughness,
    clearcoat: look.coat,
    clearcoatRoughness: 0.25,
    sheen: look.sheen,
    sheenRoughness: 0.5,
    sheenColor: 0xffffff,
  });
  // each bead one of the palette's colours, picked by its number, so it keeps it all the way through
  const swatches = Array.from({ length: 5 }, () => uniform(color(look.fluid)));
  const colourful = uniform(1),
    plainBead = uniform(color(look.fluid));
  const pick = hash(float(instanceIndex).mul(0.731).add(3.7)).mul(5).floor();
  const beadColour = select(
    pick.lessThan(1),
    swatches[0],
    select(
      pick.lessThan(2),
      swatches[1],
      select(
        pick.lessThan(3),
        swatches[2],
        select(pick.lessThan(4), swatches[3], swatches[4]),
      ),
    ),
  );
  beadPaint.colorNode = mix(plainBead, beadColour, colourful);
  let paletteShown = -1;
  const usePalette = () => {
    paletteShown = Math.round(look.palette);
    const colours = palettes[paletteShown % palettes.length];
    swatches.forEach((u, k) => u.value.set(colours[k % colours.length]));
  };
  usePalette();
  const shrink = uniform(1);
  // gone once through the floor
  const at = position.element(instanceIndex);
  beadPaint.positionNode = positionLocal
    .mul(
      radius
        .mul(shrink)
        .mul(select(at.y.lessThan(floorAt), float(0), float(1))),
    )
    .add(at);
  const beads = new InstancedMesh(
    new SphereGeometry(1, 12, 8),
    beadPaint,
    MOST,
  );
  beads.frustumCulled = false;
  beads.castShadow = beads.receiveShadow = true;
  beads.count = 0;
  scene.add(beads);
  // Beads, or only their shadows: the key light's shadow camera sees layer 1 as well as the scene's, so
  // drawn as liquid the beads move to layer 1 and still cast its shadow on the floor (three keeps a shadow
  // camera's own layers when it has more than the first).
  key.shadow.camera.layers.enable(1);

  // ---- drawn as liquid: first every particle as a sphere of depth, facing the camera
  const blobRadius = uniform(fluid.radius * liquid.blob);
  const sphereSprite = () => {
    const paint = new MeshBasicNodeMaterial();
    const centre = position.element(instanceIndex);
    const r = blobRadius
      .mul(shrink)
      .mul(select(centre.y.lessThan(floorAt), float(0), float(1)));
    const centreView = cameraViewMatrix.mul(vec4(centre, 1)).xyz;
    paint.vertexNode = cameraProjectionMatrix.mul(
      vec4(centreView.add(vec3(positionGeometry.xy.mul(r), 0)), 1),
    );
    const corner = varying(positionGeometry.xy),
      centreZ = varying(centreView.z),
      size = varying(r);
    const d2 = dot(corner, corner);
    const nz = float(1).sub(d2).max(0).sqrt();
    const sprite = new InstancedMesh(new PlaneGeometry(2, 2), paint, MOST);
    sprite.frustumCulled = false;
    sprite.count = 0;
    return {
      paint,
      sprite,
      inside: d2.lessThan(1),
      z: centreZ.add(nz.mul(size)),
      through: nz.mul(size).mul(2),
    };
  };
  // nearest depth (positive, 0 is none), with the depth test
  const front = sphereSprite();
  front.paint.fragmentNode = Fn(() => {
    Discard(front.inside.not());
    return vec4(front.z.negate(), 0, 0, 1);
  })();
  front.paint.depthNode = viewZToPerspectiveDepth(
    front.z,
    cameraNear,
    cameraFar,
  );
  const frontScene = new Scene();
  frontScene.add(front.sprite);
  // and how much liquid there is along each ray, every sphere's chord added up (at half size: it's soft)
  const thick = sphereSprite();
  thick.paint.fragmentNode = Fn(() => {
    Discard(thick.inside.not());
    return vec4(thick.through, 0, 0, 1);
  })();
  Object.assign(thick.paint, {
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const thickScene = new Scene();
  thickScene.add(thick.sprite);

  // The statue's own surface, nearest to the camera: its normal and depth (0, none). Against it the liquid
  // takes its shape exactly; the particles, kept a margin inside, would leave a bead's worth of bumps.
  const wallPaint = new MeshBasicNodeMaterial();
  wallPaint.fragmentNode = vec4(normalView, positionView.z.negate());
  const wallScene = new Scene();
  const wallMesh = new Mesh(shown.mesh, wallPaint);
  wallScene.add(wallMesh);

  const drawn = new Vector2(1, 1);
  const wallTarget = new RenderTarget(1, 1, { type: FloatType });
  const frontTarget = new RenderTarget(1, 1, {
    type: FloatType,
    format: RedFormat,
  });
  const thickTarget = new RenderTarget(1, 1, {
    type: HalfFloatType,
    format: RedFormat,
    depthBuffer: false,
  });
  const smoothA = new RenderTarget(1, 1, {
    type: FloatType,
    format: RedFormat,
    depthBuffer: false,
  });
  const smoothB = new RenderTarget(1, 1, {
    type: FloatType,
    format: RedFormat,
    depthBuffer: false,
  });
  // the liquid's own pictures' size, and the drawing's (the liquid's can be half: it's smoothed anyway)
  const pixels = uniform(new Vector2(1, 1)),
    full = uniform(new Vector2(1, 1));
  // the smoothing's reach, in pixels at a depth of 1, and how far apart two depths can be and still mix
  const reach = uniform(1),
    across = uniform(1);
  /** then smoothed, one way across the picture, only between near depths (a bilateral filter) */
  const smoothing = (from: RenderTarget, way: [number, number]) => {
    const paint = new MeshBasicNodeMaterial();
    paint.fragmentNode = Fn(() => {
      const p = ivec2(screenCoordinate.xy);
      const z0 = textureLoad(from.texture, p).r;
      const out = float(0).toVar();
      If(z0.greaterThan(0), () => {
        const span = reach.div(z0).clamp(1, TAPS * 1.25);
        const sum = float(0).toVar(),
          weight = float(0).toVar();
        Loop(
          { start: int(-TAPS), end: int(TAPS + 1), type: "int" },
          ({ i }: any) => {
            const t = float(i).div(TAPS);
            const q = p
              .add(
                ivec2(
                  vec2(...way)
                    .mul(t.mul(span))
                    .round(),
                ),
              )
              .clamp(ivec2(0), ivec2(pixels).sub(1));
            const z = textureLoad(from.texture, q).r;
            If(z.greaterThan(0), () => {
              const dz = z.sub(z0).div(across);
              const w = exp(t.mul(t).mul(-2.5).sub(dz.mul(dz)));
              sum.addAssign(z.mul(w));
              weight.addAssign(w);
            });
          },
        );
        out.assign(sum.div(weight));
      });
      return vec4(out, 0, 0, 1);
    })();
    return new QuadMesh(paint);
  };
  const smoothFirst = smoothing(frontTarget, [1, 0]),
    smoothDown = smoothing(smoothA, [0, 1]),
    smoothAgain = smoothing(smoothB, [1, 0]);

  // ---- and shaded, by a quad over the whole picture, in the scene, where there's liquid
  const surfacePaint = new MeshBasicNodeMaterial();
  surfacePaint.vertexNode = vec4(positionGeometry.xy, 0, 1);
  const depthAt = (p: any) =>
    textureLoad(smoothB.texture, p.clamp(ivec2(0), ivec2(pixels).sub(1))).r;
  /** a pixel's point in view space, from its depth */
  const viewAt = (p: any, z: any, size: any = pixels) => {
    const ndc = vec2(p).add(0.5).div(size).mul(2).sub(1).mul(vec2(1, -1));
    return vec3(
      ndc.x.mul(z).div(cameraProjectionMatrix.element(int(0)).x),
      ndc.y.mul(z).div(cameraProjectionMatrix.element(int(1)).y),
      z.negate(),
    );
  };
  const px = ivec2(screenCoordinate.xy);
  const lowPx = ivec2(screenCoordinate.xy.mul(pixels).div(full));
  const here = depthAt(lowPx);
  const point = viewAt(lowPx, here);
  // the normal, each way from whichever neighbour is nearer in depth (so edges don't bend it)
  const side = (dx: number, dy: number) => {
    const a = viewAt(
      lowPx.add(ivec2(dx, dy)),
      depthAt(lowPx.add(ivec2(dx, dy))),
    ).sub(point);
    const b = point.sub(
      viewAt(lowPx.sub(ivec2(dx, dy)), depthAt(lowPx.sub(ivec2(dx, dy)))),
    );
    return select(a.z.abs().lessThan(b.z.abs()), a, b);
  };
  const crossed = cross(side(0, 1), side(1, 0));
  // (zero at a one-pixel sliver, and normalised that's NaN, which the contact shading's blur spread black)
  const facing = select(
    dot(crossed, crossed).greaterThan(1e-14),
    crossed.normalize(),
    vec3(0, 0, 1),
  );
  const free = select(facing.z.lessThan(0), facing.negate(), facing);
  // against the glass (the smoothed depth within a couple of drops of it), the glass's shape, a hair
  // behind it so the two don't fight over the same depth; away from it, the particles' free surface
  const wall = textureLoad(wallTarget.texture, px);
  const drop = uniform(fluid.radius * liquid.blob),
    hug = uniform(1);
  // in her (1), or spilled and free of her (0): then the glass's shape and fullness are nothing to it
  const contained = float(1).sub(released);
  // where the glass is, in the world, and whether it's below the settled liquid near it
  const wallWorld = cameraWorldMatrix.mul(
    vec4(viewAt(px, wall.a, full), 1),
  ).xyz;
  const highest = nearbyRead.element(nearIndex(nearCellOf(wallWorld)));
  const levelled = wall.a
    .greaterThan(0)
    .and(contained.greaterThan(0.5))
    .and(highest.greaterThan(uint(0)))
    .and(wallWorld.y.lessThan(float(highest).div(TOP).add(floorAt).sub(drop)));
  const loose = select(
    levelled,
    float(0),
    select(
      here.greaterThan(0),
      smoothstep(drop, drop.mul(2), here.sub(wall.a)).max(float(1).sub(hug)),
      float(1),
    ),
  );
  const depth = mix(wall.a.add(drop.mul(0.15)), here, loose);
  const blended = mix(
    wall.xyz,
    select(here.greaterThan(0), free, wall.xyz),
    loose,
  );
  const normal = select(
    dot(blended, blended).greaterThan(1e-8),
    blended.normalize(),
    vec3(0, 0, 1),
  );
  surfacePaint.depthNode = viewZToPerspectiveDepth(
    depth.negate(),
    cameraNear,
    cameraFar,
  );
  surfacePaint.mrtNode = mrt({ normal: vec4(normal, 1) });
  const fluidColour = uniform(color(look.fluid)),
    milk = uniform(liquid.milk),
    gloss = uniform(liquid.gloss),
    bend = uniform(liquid.bend);
  const keyDir = uniform(key.position.clone().normalize()),
    rimDir = uniform(rim.position.clone().normalize());
  const keyStrength = uniform(look.key),
    rimStrength = uniform(look.rim),
    skyStrength = uniform(look.sky),
    envStrength = uniform(look.reflections);
  const below = uniform(color(0xcfe6e3));
  const backdrop = (uv: any) => mix(top, bottom, smoothstep(0.0, 1.0, uv.y));
  surfacePaint.colorNode = Fn(() => {
    // nothing to see, or nothing but beads past her outline (the liquid is all inside her)
    Discard(
      wall.a
        .lessThanEqual(0)
        .and(contained.greaterThan(0.5))
        .or(here.lessThanEqual(0).and(levelled.not())),
    );
    const N = cameraWorldMatrix.mul(vec4(normal, 0)).xyz.normalize();
    const V = cameraWorldMatrix.mul(vec4(point.negate(), 0)).xyz.normalize();
    const nv = dot(N, V).max(1e-3);
    // Milky body: lit softly from the key (half Lambert, squared, so it wraps round and still falls
    // off), deeper and more saturated away from it, as light that's gone further through pink comes out;
    // the sky from above and the room round it lift it a little. Lit evenly from all round, as the room's
    // light alone would, it showed no shape at all.
    const toKey = dot(N, keyDir).mul(0.5).add(0.5);
    const deep = fluidColour.mul(fluidColour).mul(0.7);
    const hemi = mix(below, vec3(1), N.y.mul(0.5).add(0.5));
    const room = pmremTexture(scene.environment!, N, float(1)).rgb;
    const lit = mix(deep, fluidColour, toKey.pow(1.5)).mul(
      keyStrength
        .mul(0.3)
        .add(hemi.mul(skyStrength).mul(0.22))
        .add(room.mul(envStrength).mul(0.2)),
    );
    // where it's thin, the backdrop through it, bent and tinted
    const amount = texture(thickTarget.texture, screenUV).r;
    const behind = backdrop(
      screenUV.add(normal.xy.mul(bend).mul(vec2(-1, 1))),
    ).mul(exp(float(1).sub(fluidColour).mul(amount).mul(-60)));
    const body = mix(
      behind,
      lit,
      float(1)
        .sub(exp(amount.mul(-400)))
        .max(milk),
    );
    // a glossy skin over it: the room in its reflections, and highlights from the key and the rim
    const fresnel = float(0.04).add(float(0.96).mul(float(1).sub(nv).pow(5)));
    const shine = pmremTexture(
      scene.environment!,
      reflect(V.negate(), N),
      gloss,
    ).rgb.mul(envStrength);
    const a2 = gloss.mul(gloss).mul(gloss.mul(gloss));
    const highlight = (L: any, strength: any) => {
      const H = L.add(V).normalize();
      const nh = dot(N, H).max(0),
        nl = dot(N, L).max(0);
      const d = nh.mul(nh).mul(a2.sub(1)).add(1);
      return a2
        .div(d.mul(d).mul(Math.PI))
        .mul(0.25)
        .div(dot(L, H).max(0.1).pow(2))
        .mul(nl)
        .mul(strength)
        .mul(fresnel.max(0.04));
    };
    return body
      .mul(float(1).sub(fresnel))
      .add(shine.mul(fresnel))
      .add(highlight(keyDir, keyStrength))
      .add(highlight(rimDir, rimStrength));
  })();
  const surface = new Mesh(new PlaneGeometry(2, 2), surfacePaint);
  surface.frustumCulled = false;
  scene.add(surface);

  const glassPaint = new MeshPhysicalNodeMaterial({
    color: look.glassTint,
    transmission: 1,
    roughness: look.glassRoughness,
    ior: look.ior,
    thickness: look.glassThickness,
    metalness: 0,
  });
  const glass = new Mesh(shown.mesh, glassPaint);
  scene.add(glass);
  const glassFade = uniform(1);
  glassPaint.opacityNode = glassFade;
  glassPaint.transparent = true;

  // ---- picture
  const post = new PostProcessing(renderer);
  post.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const occlusion = ao(
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("normal"),
    camera,
  );
  occlusion.resolutionScale = 0.75;
  occlusion.radius.value = 0.09;
  occlusion.thickness.value = 0.05;
  const occlusionAmount = uniform(look.occlusion);
  const smooth = denoise(
    occlusion.getTextureNode(),
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("normal"),
    camera,
  );
  post.outputNode = smaa(
    renderOutput(
      vec4(
        scenePass
          .getTextureNode("output")
          .rgb.mul(mix(float(1), smooth.r, occlusionAmount)),
        1,
      ),
    ),
  );

  // ---- the cycle: pour until full, hold, let go and spill, again
  let target = 0,
    count = 0,
    phase = "pour",
    phaseTime = 0;
  // the settled level, read back from the columns a few times a second (-Infinity: none yet)
  let measured = -Infinity,
    reading = false,
    lastRead = 0,
    highWater = -Infinity,
    risenAt = 0;
  let computed = false;
  const readLevel = async () => {
    reading = true;
    try {
      const data = new Uint32Array(
        await renderer.getArrayBufferAsync(tops.value),
      );
      let most = 0;
      for (let k = 0; k < data.length; k++) most = Math.max(most, data[k]);
      measured =
        most > 0 ? most / TOP + floorAt.value - fluid.radius : -Infinity;
    } catch {
      // not on the GPU yet: next time
    }
    reading = false;
  };
  /** another statue to fill: its field for the particles, its mesh for the glass and the wall pass */
  const useStatue = (name: (typeof STATUES)[number]) => {
    shown = statues[name];
    shownName = name;
    for (const lookup of fieldLookups) lookup.value = shown.field.tex;
    fieldMin.value.copy(shown.boxMin);
    fieldSize.value.copy(shown.boxSize);
    fieldStep.value = shown.voxel;
    drainAt.value = shown.drainAt;
    floorAt.value = ground.position.y = shown.floorY;
    sourceAt.value.copy(shown.source);
    glass.geometry = wallMesh.geometry = shown.mesh;
  };
  const restart = () => {
    radius.value = fluid.radius;
    h.value = fluid.radius * 4;
    rest.value = restDensity();
    stiff.value = stiffness(rest.value);
    target = Math.min(
      MOST,
      Math.round((shown.volume / (2 * fluid.radius) ** 3) * 0.9 * fluid.fill),
    );
    count = 0;
    measured = highWater = -Infinity;
    risenAt = 0;
    phase = "pour";
    phaseTime = 0;
    draining.value = 0;
    released.value = 0;
    shrink.value = 1;
    // (the glass, if it went with a spill, fades back in as the pour starts)
  };
  restart();

  const gui = new GUI({ title: "glass fill" });
  const status = gui.add({ now: "" }, "now").name("now").disable();
  const choice = { statue: statueName as string };
  gui
    .add(choice, "statue", STATUES)
    .name("sculpture")
    .onChange((name: any) => {
      useStatue(name);
      restart();
    });
  gui.add(fluid, "ending", ["spill", "drain"]).name("ends by");
  gui.add({ restart }, "restart").name("start again");
  const sim = gui.addFolder("fluid");
  sim
    .add(fluid, "radius", 0.005, 0.02, 0.0005)
    .name("bead size")
    .onFinishChange(restart);
  sim
    .add(fluid, "fill", 0.2, 1.6, 0.01)
    .name("how full")
    .onFinishChange(restart);
  sim.add(fluid, "pour", 3, 40, 0.5).name("seconds to fill");
  sim.add(fluid, "speed", 0, 5, 0.01).name("pours in at");

  sim.add(fluid, "tension", 0, 1, 0.01).name("surface pull");
  sim.add(fluid, "viscosity", 0, 0.3, 0.001);
  sim.add(fluid, "iterations", 1, 6, 1);
  sim.add(fluid, "substeps", 1, 6, 1);
  sim.add(fluid, "still", 0, 3, 0.05).name("sleeps within (radii)");
  sim.add(fluid, "sleep", 0, 3, 0.05).name("sleeps after (s, 0 never)");
  sim.add(fluid, "awake", 2, 30, 0.5).name("awake under the surface (radii)");
  sim.add(fluid, "hold", 0, 10, 0.1).name("holds full (s)");
  sim.add(fluid, "spill", 2, 20, 0.1).name("ending lasts (s)");
  sim.add(fluid, "grip", 0, 100, 0.5).name("floor grip (spilled)");
  sim.add(fluid, "friction", 0, 1.5, 0.01).name("friction (spilled)");
  sim.add(fluid, "calm", 0, 60, 0.5).name("calm inside (filling)");
  sim.add(fluid, "uneven", 0, 1, 0.01).name("uneven beads (spilled)");
  sim.add(fluid, "lean", 0, 1.5, 0.01).name("lean as it falls (spilled)");
  sim.add(fluid, "thick", 0, 1, 0.01).name("thickness (spilled)");
  const lookFolder = gui.addFolder("look");
  lookFolder.add(liquid, "style", ["liquid", "beads"]).name("drawn as");
  const liquidFolder = lookFolder.addFolder("liquid");
  liquidFolder.add(liquid, "blob", 1, 4, 0.05).name("drop size (radii)");
  liquidFolder.add(liquid, "smoothing", 0, 12, 0.1).name("smoothing (radii)");
  liquidFolder.add(liquid, "passes", 1, 2, 1).name("smoothing passes");
  liquidFolder.add(liquid, "hug").name("takes the glass's shape");
  liquidFolder
    .add(liquid, "resolution", { auto: 0, half: 0.5, full: 1 })
    .name("liquid resolution");
  liquidFolder.add(liquid, "milk", 0, 1, 0.01).name("milky");
  liquidFolder.add(liquid, "gloss", 0.03, 0.6, 0.01).name("skin roughness");
  liquidFolder.add(liquid, "bend", 0, 0.2, 0.001).name("bends what's behind");
  lookFolder.addColor(look, "fluid");
  const beadFolder = lookFolder.addFolder("beads");
  beadFolder
    .add(fluid, "radius", 0.005, 0.02, 0.0005)
    .name("bead size (restarts)")
    .onFinishChange(restart);
  beadFolder.add(look, "colourful").name("palette colours");
  const paletteControl = beadFolder
    .add(look, "palette", 0, palettes.length - 1, 1)
    .name("palette")
    .onChange(usePalette);
  beadFolder
    .add(
      {
        shuffle: () =>
          paletteControl.setValue(Math.floor(Math.random() * palettes.length)),
      },
      "shuffle",
    )
    .name("another palette");
  lookFolder.add(look, "roughness", 0, 1, 0.01);
  lookFolder.add(look, "coat", 0, 1, 0.01);
  lookFolder.add(look, "sheen", 0, 1, 0.01);
  lookFolder.add(look, "glass").name("show glass");
  lookFolder.addColor(look, "glassTint").name("glass");
  lookFolder.add(look, "glassRoughness", 0, 0.5, 0.01).name("glass frost");
  lookFolder
    .add(look, "glassThickness", 0, 0.3, 0.005)
    .name("glass distortion");
  lookFolder.add(look, "ior", 1, 2, 0.01).name("glass ior (bend + shine)");
  lookFolder.addColor(look, "top");
  lookFolder.addColor(look, "bottom");
  lookFolder.add(look, "shadow", 0, 1, 0.01).name("floor shadow");
  lookFolder.add(look, "key", 0, 8, 0.01).name("key light");
  lookFolder.add(look, "rim", 0, 6, 0.01).name("rim light");
  lookFolder.add(look, "sky", 0, 4, 0.01).name("sky light");
  lookFolder.add(look, "reflections", 0, 2, 0.01);
  lookFolder.add(look, "occlusion", 0, 1.5, 0.01);
  lookFolder.add(look, "exposure", 0.3, 2, 0.01);
  if (innerWidth < 600) gui.close();
  /** for tests: where the particles are, read back from the GPU */
  const probe = async () => {
    const speeds = new Float32Array(
      await renderer.getArrayBufferAsync(velocity.value),
    );
    const crowds = new Float32Array(
      await renderer.getArrayBufferAsync(crowd.value),
    );
    const vs: number[] = [],
      cs: number[] = [];
    for (let i = 0; i < count; i++)
      (vs.push(Math.hypot(speeds[i * 4], speeds[i * 4 + 1], speeds[i * 4 + 2])),
        cs.push(crowds[i]));
    vs.sort((a, b) => a - b);
    cs.sort((a, b) => a - b);
    const spread = (a: number[]) =>
      [0.1, 0.25, 0.5, 0.75, 0.9].map((t) =>
        a[Math.floor(t * (a.length - 1))]?.toFixed(3),
      );
    const buckets = new Uint32Array(
      await renderer.getArrayBufferAsync(cellCount.value),
    );
    let overfull = 0,
      fullest = 0;
    for (let k = 0; k < buckets.length; k++)
      ((fullest = Math.max(fullest, buckets[k])),
        (overfull += buckets[k] > CAP ? 1 : 0));
    const calmData = new Float32Array(
      await renderer.getArrayBufferAsync(settling.value),
    );
    let sleeping = 0;
    for (let i = 0; i < count; i++)
      if (calmData[i * 4 + 3] > fluid.sleep) sleeping++;
    const data = new Float32Array(
      await renderer.getArrayBufferAsync(position.value),
    );
    const stride = data.length / MOST;
    const ys: number[] = [];
    let nan = 0,
      minD = Infinity,
      maxD = 0,
      pairs = 0;
    const n = Math.min(count, 2000);
    for (let i = 0; i < count; i++) {
      const y = data[i * stride + 1];
      if (!Number.isFinite(y)) nan++;
      else ys.push(y);
    }
    // nearest-neighbour distance over a sample
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < count; j += Math.max(1, Math.floor(count / 4000))) {
        if (j === i) continue;
        const dx = data[i * stride] - data[j * stride],
          dy = data[i * stride + 1] - data[j * stride + 1],
          dz = data[i * stride + 2] - data[j * stride + 2];
        best = Math.min(best, Math.hypot(dx, dy, dz));
      }
      if (best < fluid.radius) pairs++;
      minD = Math.min(minD, best);
      maxD = Math.max(maxD, best);
    }
    ys.sort((a, b) => a - b);
    const q = (t: number) => ys[Math.floor(t * (ys.length - 1))]?.toFixed(3);
    // which are outside her (the field, read on the CPU at the nearest voxel), and which shiver inside
    const { boxMin, boxSize, dims, field } = shown;
    const fieldAtCPU = (x: number, y: number, z: number) => {
      const v = [x, y, z].map((c, k) =>
        Math.floor(
          ((c - boxMin.getComponent(k)) / boxSize.getComponent(k)) * dims[k],
        ),
      );
      if (v.some((c, k) => c < 0 || c >= dims[k])) return Infinity;
      return halfToFloat(field.data[(v[2] * dims[1] + v[1]) * dims[0] + v[0]]);
    };
    let outside = 0;
    const outsideAt: string[] = [];
    const shivering: number[] = new Array(12).fill(0);
    for (let i = 0; i < count; i++) {
      const x = data[i * stride],
        y = data[i * stride + 1],
        z = data[i * stride + 2];
      const d = fieldAtCPU(x, y, z);
      if (d > 0) {
        outside++;
        if (outsideAt.length < 8)
          outsideAt.push(
            `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} d${d === Infinity ? "box" : d.toFixed(3)}`,
          );
      }
      if (
        speeds[i * 4 + 0] ** 2 +
          speeds[i * 4 + 1] ** 2 +
          speeds[i * 4 + 2] ** 2 >
          0.04 &&
        crowds[i] > 0.9
      )
        shivering[Math.min(11, Math.max(0, Math.floor((y / 2.2) * 12)))]++;
    }
    return {
      count,
      sleeping,
      buckets: { overfull, fullest },
      speed: spread(vs),
      crowd: spread(cs),
      stride,
      nan,
      y: [q(0), q(0.25), q(0.5), q(0.75), q(1)],
      closerThanRadius: `${pairs}/${n}`,
      minNeighbour: minD.toFixed(4),
      outside,
      outsideAt,
      /** crowded but moving faster than 0.2, by height (12 bands up her) */
      shivering,
    };
  };
  (window as any).__fill = {
    fluid,
    look,
    liquid,
    camera,
    controls,
    restart,
    probe,
    step: (n?: number) => step(n),
    useStatue,
    /** the pour stops here, and it holds (as long as it's left): a settled level, for a still */
    stopPour: () => ((phase = "hold"), (phaseTime = -1e9)),
    show: () => ({ time: showTime, length: SHOW.length, phase }),
    state: () => ({
      count,
      phase,
      target,
      ms: +frameMs.toFixed(2),
      gpu: { compute: +gpuCompute.toFixed(2), render: +gpuRender.toFixed(2) },
      level: +measured.toFixed(3),
      crown: +shown.crown.toFixed(3),
      shrink: +shrink.value.toFixed(3),
      glass: +glassFade.value.toFixed(3),
    }),
  };
  let frameMs = 16,
    gpuCompute = 0,
    gpuRender = 0;

  // the show: where it is in the loop, and what the glass should be doing
  let showTime = 0,
    showGlass = 1,
    simNow = 0;
  const startShow = () => {
    showTime = 0;
    useStatue("venus");
    liquid.style = "liquid";
    fluid.ending = "drain";
    restart();
    phase = "wait";
    showGlass = glassFade.value = 1;
  };
  /** the loop's own turns: what happens at each time, given what the cycle itself got to */
  const directShow = (frame: number) => {
    const was = showTime;
    showTime += frame;
    const passed = (t: number) => was < t && showTime >= t;
    if (showTime >= SHOW.length) return startShow();
    if (passed(SHOW.venusPour)) ((phase = "pour"), (phaseTime = 0));
    // (if the pour's still going at its end, it ends now: the times hold whatever the pour did)
    if (passed(SHOW.venusDrain) || passed(SHOW.neptuneVanish))
      ((phase = "hold"), (phaseTime = 1e6));
    if (passed(SHOW.venusOut)) showGlass = 0;
    // what's left in her pockets (drained, a few drops stay) goes with her glass, not after it
    if (showTime > SHOW.venusOut && showTime < SHOW.swap)
      shrink.value = Math.max(0, 1 - (showTime - SHOW.venusOut) / 0.8);
    if (passed(SHOW.swap)) {
      useStatue("neptune");
      liquid.style = "beads";
      fluid.ending = "spill";
      restart();
      phase = "wait";
      showGlass = 1;
    }
    if (passed(SHOW.neptunePour)) ((phase = "pour"), (phaseTime = 0));
    if (passed(SHOW.fade)) {
      // Venus's glass back, as the pile goes (her field too: spilled, nothing is held by it)
      useStatue("venus");
      showGlass = 1;
      phase = "fade";
      phaseTime = 0;
    }
    const o = SHOW.orbit,
      turn = o.from + (was / SHOW.length) * Math.PI * 2;
    camera.position.set(
      Math.sin(turn) * o.radius,
      o.height,
      Math.cos(turn) * o.radius,
    );
    controls.target.set(0, o.target, 0);
  };
  if (showing) {
    startShow();
    gui.hide();
  }

  let last = performance.now();
  const draw = (frame: number) => {
    simNow += frame * 1000;
    const now = simNow;
    // a wake lasts one frame
    wake.value = 0;
    phaseTime += frame;
    if (showing) directShow(frame);

    // the cycle
    // where the nozzle is: a little above the level the particles so far would fill to
    const estimate =
      shown.slices.find((s) => s.below * 0.9 >= count * (2 * fluid.radius) ** 3)
        ?.y ?? Infinity;
    const level = Number.isFinite(measured)
      ? Math.max(measured, estimate - 0.15)
      : estimate;
    if (computed && !reading && now - lastRead > 250)
      ((lastRead = now), readLevel());
    const at = shown.nozzleAt(level);
    sourceAt.value.copy(at.at);
    headRoom.value = Math.max(-at.depth - fluid.radius * 2.5, fluid.radius);
    // as many a frame as the pour wants, or as fit through it: a narrow neck takes them slower
    const perLayer = Math.max(
      Math.floor(Math.PI * (headRoom.value / (2.2 * fluid.radius)) ** 2),
      1,
    );
    const fastest = Math.min(
      2.5,
      (1.6 * fluid.radius) / (frame / fluid.substeps),
    );
    const most =
      perLayer *
      Math.max(Math.floor((fastest * frame) / (2 * fluid.radius)), 1);
    if (phase === "pour") {
      const was = count;
      count = Math.min(
        target,
        count + Math.min(Math.ceil((target / fluid.pour) * frame), most),
      );
      spawnFrom.value = was;
      // full to her crown (as measured), out of particles, or as full as it gets in twice the time
      // (her crown can't quite be reached: full is when the level, near the top, stops rising)
      if (measured > highWater + 2 * fluid.radius)
        ((highWater = measured), (risenAt = phaseTime));
      const full =
        measured > shown.crown - 0.04 ||
        (measured > shown.crown - 0.25 && phaseTime - risenAt > 1.5);
      if (
        ((count >= target || full) && phaseTime > 1) ||
        phaseTime > fluid.pour * 2
      )
        ((phase = "hold"), (phaseTime = 0));
    } else if (phase === "hold" && phaseTime > fluid.hold && !showing) {
      // drained through the plinth; or spilled: the glass goes first, the beads standing in her shape a
      // moment without it, and only then do they let go
      phase = fluid.ending === "drain" ? "drain" : "vanish";
      phaseTime = 0;
      if (phase === "drain") draining.value = 1;
    } else if (phase === "vanish" && glassFade.value <= 0) {
      phase = "spill";
      phaseTime = 0;
      {
        // its bounds gone, every sleeper woken to fall
        released.value = 1;
        wake.value = 1;
        const way = Math.random() * Math.PI * 2;
        // (a wake lasts the frame, every substep of it: so a substep's share each)
        lean.value
          .set(Math.cos(way), 0, Math.sin(way))
          .multiplyScalar(fluid.lean / fluid.substeps);
        // each bead's own jostle only a nudge: as big as the lean, the whole statue puffed out as it went
        jostle.value = (fluid.lean * 0.12) / fluid.substeps;
        leanSpeed.value.copy(lean.value).multiplyScalar(fluid.substeps);
      }
    } else if (phase === "hold" && showing && phaseTime > 1e5) {
      // (the show's own: the hold's end is on its time)
      phase = fluid.ending === "drain" ? "drain" : "vanish";
      phaseTime = 0;
      if (phase === "drain") draining.value = 1;
    } else if (phase === "drain" && phaseTime > fluid.spill && !showing)
      restart();
    else if (phase === "spill" && phaseTime > fluid.spill && !showing)
      ((phase = "fade"), (phaseTime = 0));
    else if (phase === "fade") {
      // the pile on the floor shrinks away, and it starts again
      const over = showing ? SHOW.length - SHOW.fade : 1.2;
      shrink.value = Math.max(0, 1 - phaseTime / over);
      if (phaseTime > over && !showing) restart();
    }
    // gone as it vanishes and while spilled; back as the pile goes (and in the show, when it says)
    const glassWanted =
      phase === "vanish" || (released.value > 0.5 && phase !== "fade")
        ? 0
        : showing
          ? showGlass
          : 1;
    glassFade.value = Math.min(
      Math.max(
        glassFade.value + (glassWanted < 0.5 ? -frame / 0.8 : frame / 1.2),
        0,
      ),
      1,
    );
    alive.value = count;
    beads.count = front.sprite.count = thick.sprite.count = count;
    const asLiquid = liquid.style === "liquid";
    beads.layers.mask = asLiquid ? 2 : 1;
    surface.visible = asLiquid;
    glass.visible = look.glass && glassFade.value > 0.01;

    // the fluid: a few steps a frame
    const steps = fluid.substeps;
    dt.value = frame / steps;
    grip.value = Math.exp(-fluid.grip * dt.value);
    friction.value = fluid.friction;
    calming.value = Math.exp(-fluid.calm * dt.value);
    calmBelow.value = phase === "pour" ? 0.25 : 1e9;
    letGo.value = phase === "spill" && phaseTime < 0.6 ? 0.2 : 1e9;
    uneven.value = fluid.uneven;
    gravity.value = fluid.gravity;
    tension.value = fluid.tension;
    viscosity.value =
      released.value > 0.5
        ? Math.max(fluid.viscosity, fluid.thick)
        : fluid.viscosity;
    inflow.value = fluid.speed;
    stillSpeed.value = fluid.still;
    sleepAfter.value = fluid.sleep > 0 ? fluid.sleep : 1e9;
    awakeBand.value = fluid.awake;

    // as many layers as the stream moves in a frame, and the nozzle as wide as a layer's share needs
    const batch = Math.max(count - spawnFrom.value, 1);
    layers.value = Math.max(
      Math.round((fluid.speed * frame) / (2 * fluid.radius)),
      Math.ceil(batch / perLayer),
      1,
    );
    inflow.value = Math.max(
      fluid.speed,
      (layers.value * 2 * fluid.radius) / frame,
    );
    nozzle.value = Math.min(
      1.1 *
        2 *
        fluid.radius *
        Math.sqrt(Math.ceil(batch / layers.value) / Math.PI),
      headRoom.value,
    );
    turn.value += 1.3;
    // each pass as big as what's there: the particles alive, the grid's own cells (launched for all the
    // buffers hold, 120k threads and 600k cells, six times a frame, even idle they cost)
    const live = Math.max(count, 1);
    if (phase === "pour") renderer.compute(spawn, live);
    for (let s = 0; s < steps; s++) {
      renderer.compute(clearGrid);
      renderer.compute(predict, live);
      for (let k = 0; k < fluid.iterations; k++) {
        renderer.compute(solveDensity, live);
        renderer.compute(solveMove, live);
        renderer.compute(applyMove, live);
      }
      renderer.compute(update, live);
      renderer.compute(settle, live);
      spawnFrom.value = count;
    }
    renderer.compute(clearTops);
    renderer.compute(clearNearby);
    renderer.compute(markTops, live);
    computed = true;

    // the look
    plainBead.value.set(look.fluid);
    if (Math.round(look.palette) !== paletteShown) usePalette();
    colourful.value = look.colourful ? 1 : 0;
    beadPaint.roughness = look.roughness;
    beadPaint.clearcoat = look.coat;
    beadPaint.sheen = look.sheen;
    rim.intensity = look.rim;
    glassPaint.color.set(look.glassTint);
    glassPaint.roughness = look.glassRoughness;
    glassPaint.ior = look.ior;
    glassPaint.thickness = look.glassThickness;
    top.value.set(look.top);
    bottom.value.set(look.bottom);
    (ground.material as ShadowNodeMaterial).opacity = look.shadow;
    key.intensity = look.key;
    sky.intensity = look.sky;
    scene.environmentIntensity = look.reflections;
    occlusionAmount.value = look.occlusion;
    renderer.toneMappingExposure = look.exposure;
    status.setValue(`${phase}, ${count.toLocaleString("en")} beads`);

    controls.update();
    camera.updateMatrixWorld();
    if (asLiquid) {
      renderer.getDrawingBufferSize(drawn);
      // the liquid at half the drawing's size where that's dense (2x screens): four smoothing passes of
      // 25 taps a pixel were most of its cost, and smoothed, it looks the same
      const scale =
        liquid.resolution > 0 ? liquid.resolution : drawn.y > 1500 ? 0.5 : 1;
      const lw = Math.ceil(drawn.x * scale),
        lh = Math.ceil(drawn.y * scale);
      if (
        drawn.x !== wallTarget.width ||
        drawn.y !== wallTarget.height ||
        lw !== frontTarget.width ||
        lh !== frontTarget.height
      ) {
        wallTarget.setSize(drawn.x, drawn.y);
        for (const t of [frontTarget, smoothA, smoothB]) t.setSize(lw, lh);
        thickTarget.setSize(Math.ceil(lw / 2), Math.ceil(lh / 2));
        pixels.value.set(lw, lh);
        full.value.copy(drawn);
      }
      blobRadius.value = drop.value = fluid.radius * liquid.blob;
      hug.value = liquid.hug && released.value < 0.5 ? 1 : 0;
      reach.value =
        fluid.radius *
        liquid.smoothing *
        camera.projectionMatrix.elements[5] *
        lh *
        0.5;
      across.value = fluid.radius * liquid.blob * 2;
      fluidColour.value.set(look.fluid);
      milk.value = liquid.milk;
      gloss.value = liquid.gloss;
      bend.value = liquid.bend;
      keyStrength.value = look.key;
      rimStrength.value = look.rim;
      skyStrength.value = look.sky;
      envStrength.value = look.reflections;
      const clear = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(frontTarget);
      renderer.render(frontScene, camera);
      renderer.setRenderTarget(wallTarget);
      renderer.render(wallScene, camera);
      renderer.setRenderTarget(thickTarget);
      renderer.render(thickScene, camera);
      // smoothed across, down, and across and down again
      renderer.setRenderTarget(smoothA);
      smoothFirst.render(renderer);
      renderer.setRenderTarget(smoothB);
      smoothDown.render(renderer);
      if (liquid.passes > 1) {
        renderer.setRenderTarget(smoothA);
        smoothAgain.render(renderer);
        renderer.setRenderTarget(smoothB);
        smoothDown.render(renderer);
      }
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, clear);
    }
    post.render();
    if (timing && !recording)
      Promise.all([
        renderer.resolveTimestampsAsync("compute"),
        renderer.resolveTimestampsAsync("render"),
      ]).then(() => {
        gpuCompute = gpuCompute * 0.9 + renderer.info.compute.timestamp * 0.1;
        gpuRender = gpuRender * 0.9 + renderer.info.render.timestamp * 0.1;
      });
  };
  wrap.render = () => {
    const real = performance.now();
    // One clock for all of it, the frame's own time (within reason): the pour, its layers, and the solver's
    // steps. With the solver on a fixed 1/60 and the pour on the clock, at 30 fps each frame's particles
    // came in twice as deep as the last frame's had moved, landed on them, and burst into spray.
    const frame = Math.min(Math.max((real - last) / 1000, 1 / 120), 1 / 40);
    frameMs = frameMs * 0.95 + (real - last) * 0.05;
    last = real;
    // recording, frames come only when asked for
    if (!recording) draw(frame);
  };
  /** recording: n frames of exactly 1/60, done on the GPU when it resolves */
  const step = async (n = 1) => {
    for (let k = 0; k < n; k++) draw(1 / 60);
    await (renderer.backend as any).device.queue.onSubmittedWorkDone();
  };

  wrap.resize = ({ width, height }) => {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  wrap.unload = () => {
    gui.destroy();
    controls.dispose();
    renderer.dispose();
  };
};

ssam(sketch, {
  mode: "webgpu",
  // the whole window, at most as many pixels as the 1080 square was at 2x (it's fill-heavy: the glass and the
  // liquid's passes are per pixel)
  pixelRatio: Math.min(
    window.devicePixelRatio,
    2,
    Math.sqrt((2160 * 2160) / (window.innerWidth * window.innerHeight)),
  ),
  animate: true,
  duration: 20000,
  playFps: 60,
  exportFps: 60,
  framesFormat: ["webm"],
} satisfies SketchSettings);
